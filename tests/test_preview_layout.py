import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HMI_DIR = ROOT / 'HMI/US/portrait/n2t-out-visual'
LAYOUT = ROOT / 'nspanel-lovelace-ui/rootfs/usr/bin/mqtt-manager/frontend/layouts/us-p.json'

spec = importlib.util.spec_from_file_location('gen_preview_layout', ROOT / 'scripts/gen_preview_layout.py')
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

EXCERPT = '''Page cardEntities
    Attributes
        ID                 : 0
        Width              : 320
        Back. Color        : 6371

    Events
        Preinitialize Event
            vis p0,0

Text tEntity1
    Attributes
        ID                  : 3
        x coordinate        : 49
        y coordinate        : 86
        Width               : 115
        Height              : 53
        Font ID             : 0
        Back. Color         : 6371
        Font Color          : 65535
        Horizontal Alignment: left
        Vertical Alignment  : center
        Text                : tEntity1

Variable (string) entn1
    Attributes
        ID                 : 9
'''


class ParsePageTests(unittest.TestCase):
    def test_component_geometry_and_style(self):
        page = gen.parse_page(EXCERPT)
        self.assertEqual(page['name'], 'cardEntities')
        self.assertEqual(page['width'], 320)
        self.assertEqual(page['bco'], 6371)
        by_name = {c['name']: c for c in page['components']}
        entity = by_name['tEntity1']
        self.assertEqual((entity['type'], entity['x'], entity['y'], entity['w'], entity['h']),
                         ('Text', 49, 86, 115, 53))
        self.assertEqual((entity['font'], entity['pco'], entity['bco']), (0, 65535, 6371))
        self.assertEqual((entity['xcen'], entity['ycen']), ('left', 'center'))

    def test_variables_are_not_visual_components(self):
        page = gen.parse_page(EXCERPT)
        self.assertNotIn('entn1', {c['name'] for c in page['components']})


@unittest.skipUnless(HMI_DIR.is_dir(), 'HMI sources not present')
class GeneratedLayoutTests(unittest.TestCase):
    def test_entities_page_has_expected_components(self):
        layout = gen.build_layout(HMI_DIR)['us-p']
        names = {c['name'] for c in layout['cardEntities']['components']}
        for expected in ['tHeading', 'bPrev', 'bNext'] + [f'tIcon{i}' for i in range(1, 7)] + \
                        [f'tEntity{i}' for i in range(1, 7)]:
            self.assertIn(expected, names)
        self.assertEqual(layout['cardEntities']['width'], 320)

    def test_all_needed_pages_present(self):
        layout = gen.build_layout(HMI_DIR)['us-p']
        for page in ('cardEntities', 'cardGrid', 'cardGrid2', 'screensaver', 'screensaver2', 'screensaver3'):
            self.assertIn(page, layout)
            self.assertTrue(layout[page]['components'])

    def test_committed_layout_matches_hmi_sources(self):
        self.assertTrue(LAYOUT.is_file(), 'run scripts/gen_preview_layout.py')
        self.assertEqual(json.loads(LAYOUT.read_text()), gen.build_layout(HMI_DIR))


if __name__ == '__main__':
    unittest.main()
