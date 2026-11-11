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
        Word wrap           : enabled

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
        self.assertIs(entity['wrap'], True)

    def test_variables_are_not_visual_components(self):
        page = gen.parse_page(EXCERPT)
        self.assertNotIn('entn1', {c['name'] for c in page['components']})


HANDLER = '''            if(tInstruction.txt=="weatherUpdate")
            {
                spstr strCommand.txt,tMainText.txt,"~",6
                spstr strCommand.txt,d1Icon.txt,"~",9
                spstr strCommand.txt,tTmp.txt,"~",10
                covx tTmp.txt,d1Icon.pco,0,0
            }
            if(tInstruction.txt=="other")
            {
                spstr strCommand.txt,x.txt,"~",1
            }
'''


class BindingTests(unittest.TestCase):
    def test_bindings_read_text_and_colour_fields_of_one_instruction(self):
        self.assertEqual(gen.parse_bindings(HANDLER, 'weatherUpdate'), [
            {'comp': 'tMainText', 'attr': 'txt', 'field': 6},
            {'comp': 'd1Icon', 'attr': 'txt', 'field': 9},
            {'comp': 'd1Icon', 'attr': 'pco', 'field': 10},
        ])

    def test_missing_instruction_gives_no_bindings(self):
        self.assertEqual(gen.parse_bindings(HANDLER, 'nope'), [])


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

    def test_screensaver2_bindings_match_the_hmi_script(self):
        saver = gen.build_layout(HMI_DIR)['us-p']['screensaver2']['bindings']
        weather = {(b['comp'], b['attr']): b['field'] for b in saver['weatherUpdate']}
        self.assertEqual(weather[('tMainIcon', 'txt')], 3)
        self.assertEqual(weather[('tMainText', 'txt')], 6)
        self.assertEqual(weather[('d1Val', 'txt')], 12)
        self.assertEqual(weather[('e1Name', 'txt')], 29)
        status = {(b['comp'], b['attr']): b['field'] for b in saver['statusUpdate']}
        self.assertEqual(status[('tIcon1', 'txt')], 1)
        self.assertEqual(status[('tIcon2', 'pco')], 4)

    def test_entity_card_field_layout_matches_the_hmi_script(self):
        # The preview assumes: navigation at fields 2-13, first entity at field 14, six fields each.
        script = (HMI_DIR.parent / 'n2t-out/cardEntities.txt').read_text(errors='replace')
        for expected in ('spstr strCommand.txt,type1.txt,"~",14', 'spstr strCommand.txt,tEntity1.txt,"~",18',
                         'spstr strCommand.txt,type2.txt,"~",20', 'bText1.pco=1374', 'tTmp.txt=="disable"'):
            self.assertIn(expected, script)
        grid = (HMI_DIR.parent / 'n2t-out/cardGrid.txt').read_text(errors='replace')
        for expected in ('spstr strCommand.txt,bEntity1.txt,"~",16', 'spstr strCommand.txt,tEntity1.txt,"~",18'):
            self.assertIn(expected, grid)

    def test_committed_layout_matches_hmi_sources(self):
        self.assertTrue(LAYOUT.is_file(), 'run scripts/gen_preview_layout.py')
        self.assertEqual(json.loads(LAYOUT.read_text()), gen.build_layout(HMI_DIR))


if __name__ == '__main__':
    unittest.main()


FRONTEND = ROOT / 'nspanel-lovelace-ui/rootfs/usr/bin/mqtt-manager/frontend'


class PreviewTabStaticTests(unittest.TestCase):
    def test_index_has_tab_and_view_without_inline_code(self):
        html = (FRONTEND / 'index.html').read_text()
        self.assertIn('id="preview-tab"', html)
        self.assertIn('id="preview-view"', html)
        self.assertIn('src="preview.js"', html)
        self.assertNotRegex(html, r'<script(?![^>]*\bsrc=)')
        self.assertNotIn('<style', html)
        self.assertNotIn(' style=', html)
        self.assertNotRegex(html, r'https?://')

    def test_font_and_license_are_bundled_and_referenced_locally(self):
        self.assertTrue((FRONTEND / 'fonts/materialdesignicons-webfont.woff2').is_file())
        self.assertIn('Apache', (FRONTEND / 'fonts/LICENSE-mdi.txt').read_text())
        css = (FRONTEND / 'mdi.css').read_text()
        self.assertIn('url("fonts/materialdesignicons-webfont.woff2")', css)
        self.assertNotRegex(css, r'url\("?https?://')

    def test_web_server_serves_every_new_asset(self):
        source = (FRONTEND.parent / 'web.py').read_text()
        for path in ('/preview.js', '/mdi.css', '/layouts/us-p.json', '/fonts/materialdesignicons-webfont.woff2'):
            self.assertIn(f'"{path}"', source)
