import http.client
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

BACKEND = Path(__file__).resolve().parents[1] / 'nspanel-lovelace-ui/rootfs/usr/bin/mqtt-manager'
sys.path.insert(0, str(BACKEND))
import preview_server  # noqa: E402
import web  # noqa: E402
from config_manager import ConfigStore  # noqa: E402

TOKEN = 'secret-token'


def post(port, path, body, headers=None):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    payload = body if isinstance(body, bytes) else json.dumps(body).encode()
    connection.request('POST', path, payload, {'Content-Type': 'application/json', **(headers or {})})
    response = connection.getresponse()
    data = json.loads(response.read() or b'{}')
    connection.close()
    return response.status, data


class PreviewServerTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.server = preview_server.make_server(0, TOKEN, lambda yaml_text, panel: self.calls.append((yaml_text, panel)) or {'ok': True})
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_binds_loopback_only(self):
        self.assertEqual(self.server.server_address[0], '127.0.0.1')

    def test_correct_token_renders(self):
        status, data = post(self.port, '/render', {'yaml': 'a: 1', 'panel': 'p'}, {'X-Preview-Token': TOKEN})
        self.assertEqual((status, data), (200, {'ok': True}))
        self.assertEqual(self.calls, [('a: 1', 'p')])

    def test_wrong_or_missing_token_is_forbidden(self):
        self.assertEqual(post(self.port, '/render', {'yaml': 'a'}, {'X-Preview-Token': 'nope'})[0], 403)
        self.assertEqual(post(self.port, '/render', {'yaml': 'a'})[0], 403)
        self.assertEqual(self.calls, [])

    def test_oversized_or_malformed_body_is_rejected(self):
        headers = {'X-Preview-Token': TOKEN}
        self.assertEqual(post(self.port, '/render', b'x' * (1024 * 1024 + 1), headers)[0], 400)
        self.assertEqual(post(self.port, '/render', b'not json', headers)[0], 400)
        self.assertEqual(post(self.port, '/render', {'yaml': 5}, headers)[0], 400)

    def test_token_file_is_private_and_not_empty(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'token'
            token = preview_server.write_token(str(path))
            self.assertTrue(token)
            self.assertEqual(path.read_text().strip(), token)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)


class EditorProxyTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.config = Path(self.folder.name) / 'panels.yaml'
        self.config.write_text('nspanels: {}\n')
        self.token_path = Path(self.folder.name) / 'token'
        self.editor = ThreadingHTTPServer(('127.0.0.1', 0), web.handler_for(ConfigStore(str(self.config)), '127.0.0.1'))
        threading.Thread(target=self.editor.serve_forever, daemon=True).start()
        self.port = self.editor.server_address[1]
        self.saved = (web.PREVIEW_PORT, web.PREVIEW_TOKEN_PATH)

    def tearDown(self):
        web.PREVIEW_PORT, web.PREVIEW_TOKEN_PATH = self.saved
        self.editor.shutdown()
        self.editor.server_close()
        self.folder.cleanup()

    def test_returns_503_when_main_service_is_down(self):
        web.PREVIEW_PORT, web.PREVIEW_TOKEN_PATH = 1, str(self.token_path)
        status, data = post(self.port, '/api/preview', {'yaml': 'a: 1'})
        self.assertEqual(status, 503)
        self.assertIn('error', data)

    def test_forwards_to_main_service_with_token(self):
        seen = []
        backend = preview_server.make_server(0, TOKEN, lambda y, p: seen.append((y, p)) or {'panel': 'x'})
        threading.Thread(target=backend.serve_forever, daemon=True).start()
        self.token_path.write_text(TOKEN)
        web.PREVIEW_PORT, web.PREVIEW_TOKEN_PATH = backend.server_address[1], str(self.token_path)
        try:
            status, data = post(self.port, '/api/preview', {'yaml': 'a: 1', 'panel': 'x'})
        finally:
            backend.shutdown()
            backend.server_close()
        self.assertEqual((status, data), (200, {'panel': 'x'}))
        self.assertEqual(seen, [('a: 1', 'x')])

    def test_editor_authentication_applies(self):
        self.editor.RequestHandlerClass = web.handler_for(ConfigStore(str(self.config)), '10.9.9.9')
        self.assertEqual(post(self.port, '/api/preview', {'yaml': 'a: 1'})[0], 403)

    def test_editor_rejects_wrong_content_type(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        connection.request('POST', '/api/preview', b'yaml: x', {'Content-Type': 'text/plain'})
        self.assertEqual(connection.getresponse().status, 415)


if __name__ == '__main__':
    unittest.main()
