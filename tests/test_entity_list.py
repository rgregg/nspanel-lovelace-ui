import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1] / 'nspanel-lovelace-ui/rootfs/usr/bin/mqtt-manager'

STATES = [
    {'entity_id': 'switch.b', 'state': 'on', 'attributes': {}},
    {'entity_id': 'light.a', 'state': 'off', 'attributes': {'friendly_name': 'Lamp'}},
]


class ListEntitiesTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('entity_list_test_ha', BACKEND / 'libs/home_assistant.py')
        self.ha = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'websocket': types.ModuleType('websocket')}):
            spec.loader.exec_module(self.ha)

    def answer(self, result=None, error=None, call_id=1):
        def send(message, pending=None):
            self.sent = message
            pending['result'], pending['error'] = result, error
            pending['event'].set()
            return call_id
        return send

    def test_lists_sorted_with_names_and_domains(self):
        self.ha.send_message = self.answer(STATES)
        self.assertEqual(self.ha.list_entities(), [
            {'entity_id': 'light.a', 'name': 'Lamp', 'domain': 'light'},
            {'entity_id': 'switch.b', 'name': 'switch.b', 'domain': 'switch'}])
        self.assertEqual(self.sent, {'type': 'get_states'})

    def test_does_not_touch_the_live_cache(self):
        self.ha.home_assistant_entity_state_cache['x.y'] = {'state': '1'}
        self.ha.send_message = self.answer(STATES)
        self.ha.list_entities()
        self.assertEqual(list(self.ha.home_assistant_entity_state_cache), ['x.y'])

    def test_empty_when_not_connected(self):
        self.ha.send_message = lambda message, pending=None: None
        self.assertEqual(self.ha.list_entities(), [])

    def test_empty_on_error_or_bad_result(self):
        self.ha.send_message = self.answer(None, 'nope')
        self.assertEqual(self.ha.list_entities(), [])
        self.ha.send_message = self.answer({'not': 'a list'})
        self.assertEqual(self.ha.list_entities(), [])

    def test_empty_on_timeout_and_buffer_cleaned(self):
        def never(message, pending=None):
            self.ha.response_buffer[7] = pending
            return 7
        self.ha.send_message = never
        self.assertEqual(self.ha.list_entities(timeout=0.05), [])
        self.assertNotIn(7, self.ha.response_buffer)


if __name__ == '__main__':
    unittest.main()
