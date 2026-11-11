from pathlib import Path
import sys
import time
import unittest

BACKEND = Path(__file__).resolve().parents[1] / 'nspanel-lovelace-ui/rootfs/usr/bin/mqtt-manager'
sys.path.insert(0, str(BACKEND))

try:
    import babel  # noqa: F401
    import dateutil  # noqa: F401
    import scheduler  # noqa: F401
    import websocket  # noqa: F401
except ImportError as exc:  # CI does not install the add-on's runtime dependencies
    raise unittest.SkipTest(f'preview rendering needs the add-on dependencies: {exc}')

import libs.home_assistant as ha  # noqa: E402
import preview  # noqa: E402

DRAFT = '''
mqtt_server: mqtt.lan
timeZone: America/Los_Angeles
locale: en_US
nspanels:
  panel:
    model: us-p
    panelRecvTopic: tele/nspanel/RESULT
    panelSendTopic: cmnd/nspanel/CustomSend
    timeFormat: "%H:%M"
    dateFormat: "EEEE, dd.MMMM yyyy"
    screensaver:
      type: screensaver2
      entities:
        - entity: weather.home
    cards:
      - type: cardEntities
        title: Lights
        entities:
          - entity: light.interior_lights
'''


def state(entity_id, value, **attributes):
    return {'entity_id': entity_id, 'state': value, 'attributes': attributes, 'context': {}}


class PreviewRenderTests(unittest.TestCase):
    def setUp(self):
        self.saved = dict(ha.home_assistant_entity_state_cache)
        ha.home_assistant_entity_state_cache.clear()
        ha.home_assistant_entity_state_cache['light.interior_lights'] = state(
            'light.interior_lights', 'on', brightness=200, friendly_name='Interior')
        ha.home_assistant_entity_state_cache['weather.home'] = state(
            'weather.home', 'rainy', temperature=54, forecast=[])

    def tearDown(self):
        ha.home_assistant_entity_state_cache.clear()
        ha.home_assistant_entity_state_cache.update(self.saved)

    def render(self, draft=DRAFT, **kwargs):
        return preview.render_preview(draft, wait_seconds=kwargs.pop('wait_seconds', 0.2), **kwargs)

    def test_entities_card_uses_real_card_output(self):
        result = self.render()
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['panel'], 'panel')
        self.assertEqual(result['model'], 'us-p')
        card = result['cards'][0]
        self.assertEqual(card['type'], 'cardEntities')
        self.assertEqual(card['title'], 'Lights')
        update = [c for c in card['commands'] if c.startswith('entityUpd~')][0]
        self.assertIn('Lights', update)
        self.assertIn('~light~', update)
        self.assertIn('Interior', update)

    def test_response_names_the_icons_used(self):
        result = self.render()
        update = [c for c in result['cards'][0]['commands'] if c.startswith('entityUpd~')][0]
        char = update.split('~')[-4]  # icon of the last entity
        self.assertEqual(len(char), 1)
        self.assertIn(char, result['icons'])
        self.assertTrue(result['icons'][char].startswith('lightbulb'))

    def test_icons_inside_pipe_separated_values_are_named(self):
        names = preview._icon_names(['entityUpd~T~shutter~iid~\ue334~1~Name~\ue334|\ue334|\ue334|enable|enable|enable'])
        self.assertEqual(list(names), ['\ue334'])

    def test_grid_with_seven_entities_uses_grid2_layout(self):
        entities = ''.join(f'\n          - entity: light.l{i}' for i in range(7))
        draft = DRAFT.replace('- type: cardEntities\n        title: Lights\n        entities:\n'
                              '          - entity: light.interior_lights',
                              '- type: cardGrid\n        title: Grid\n        entities:' + entities)
        result = self.render(draft)
        self.assertEqual(result['cards'][0]['type'], 'cardGrid2')

    def test_screensaver_commands_and_time(self):
        result = self.render()
        commands = result['screensaver']['commands']
        self.assertTrue(any(c.startswith('weatherUpdate~') for c in commands))
        self.assertTrue(any(c.startswith('statusUpdate~') for c in commands))
        self.assertRegex(result['time'], r'^\d\d:\d\d')
        self.assertTrue(result['date'])

    def test_invalid_yaml_reports_error_without_raising(self):
        result = self.render('nspanels: [unclosed')
        self.assertTrue(result['errors'])
        self.assertEqual(result['cards'], [])

    def test_unknown_card_type_is_skipped_with_note(self):
        draft = DRAFT.replace('type: cardEntities', 'type: cardBogus')
        result = self.render(draft)
        self.assertEqual(result['cards'], [])
        self.assertTrue(any('cardBogus' in e for e in result['errors']))

    def test_one_failing_card_does_not_hide_the_others(self):
        from unittest.mock import patch
        import ha_cards
        two = DRAFT.replace('    cards:\n', '    cards:\n      - type: cardEntities\n        title: Broken\n        entities:\n'
                            '          - entity: light.interior_lights\n')
        original = ha_cards.EntitiesCard.render

        def render(card):
            if card.title == 'Broken':
                raise TypeError('bad attributes')
            return original(card)
        with patch.object(ha_cards.EntitiesCard, 'render', render):
            result = self.render(two)
        self.assertEqual([c['title'] for c in result['cards']], ['Lights'])
        self.assertTrue(any('Broken' in e and 'bad attributes' in e for e in result['errors']))
        self.assertTrue(result['screensaver']['commands'])

    def test_missing_screensaver_gives_empty_commands(self):
        draft = DRAFT.replace('    screensaver:\n      type: screensaver2\n      entities:\n'
                              '        - entity: weather.home\n', '')
        result = self.render(draft)
        self.assertEqual(result['screensaver']['commands'], [])

    def test_missing_entity_returns_within_wait(self):
        started = time.monotonic()
        result = self.render(DRAFT.replace('light.interior_lights', 'light.never_seen'), wait_seconds=0.3)
        self.assertLess(time.monotonic() - started, 1.5)
        self.assertEqual(len(result['cards']), 1)

    def test_nothing_is_put_on_a_real_queue(self):
        import queue
        from unittest.mock import patch
        with patch.object(queue.Queue, 'put') as put:
            self.render()
        put.assert_not_called()

    def test_panel_selection(self):
        second = DRAFT.replace('nspanels:\n  panel:', 'nspanels:\n  other:\n    model: us-p\n    cards: []\n    screensaver: {}\n  panel:')
        result = self.render(second, panel_name='panel')
        self.assertEqual(result['panels'], ['other', 'panel'])
        self.assertEqual(result['panel'], 'panel')


if __name__ == '__main__':
    unittest.main()
