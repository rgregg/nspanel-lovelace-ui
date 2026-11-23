"""The panel's two physical buttons: settings, Tasmota setup commands and Home Assistant actions."""
from pathlib import Path
import sys
import types
import unittest
from queue import Queue
from unittest.mock import Mock, patch

BACKEND = Path(__file__).resolve().parents[1] / 'nspanel-lovelace-ui/rootfs/usr/bin/mqtt-manager'
sys.path.insert(0, str(BACKEND))
import buttons


class NormalizeTests(unittest.TestCase):
    def test_no_buttons_setting_leaves_the_panel_alone(self):
        self.assertIsNone(buttons.normalize({}))

    def test_defaults_left_relay_right_off(self):
        self.assertEqual(buttons.normalize({'buttons': {}}), {1: {'mode': 'relay'}, 2: {'mode': 'off'}})

    def test_actions_are_read_per_gesture(self):
        result = buttons.normalize({'buttons': {'right': {'mode': 'actions', 'single': {
            'service': 'scene.turn_on', 'entity': 'scene.bright'}, 'hold': {'service': 'light.toggle', 'entity': ['light.a', 'light.b'], 'data': {'brightness': 5}}}}})
        self.assertEqual(result[2]['mode'], 'actions')
        self.assertEqual(result[2]['single'], {'service': 'scene.turn_on', 'entity': ['scene.bright'], 'data': {}})
        self.assertEqual(result[2]['hold']['entity'], ['light.a', 'light.b'])

    def test_unquoted_yaml_off_means_off(self):
        # YAML reads a bare `off` as False; it must not fall back to the default (relay on the left).
        import yaml
        settings = yaml.safe_load('buttons:\n  left: {mode: off}\n  right:\n    mode: off\n    single: {service: scene.turn_on}\n')
        result = buttons.normalize(settings)
        self.assertEqual(result[1]['mode'], 'off')
        self.assertEqual(result[2]['mode'], 'off')
        self.assertEqual(buttons.tasmota_commands(result), [('SetOption73', '1'), ('Rule3', '0')])

    def test_yaml_on_is_rejected(self):
        with self.assertRaises(ValueError):
            buttons.normalize({'buttons': {'left': {'mode': True}}})

    def test_invalid_settings_are_rejected(self):
        bad = [{'buttons': []}, {'buttons': {'middle': {}}}, {'buttons': {'left': {'mode': 'dance'}}},
               {'buttons': {'left': {'mode': 'actions', 'single': {'service': 'turn_on'}}}},
               {'buttons': {'left': {'mode': 'actions', 'single': {'service': 'a.b', 'data': 'x'}}}},
               {'buttons': {'left': {'mode': 'actions', 'wiggle': {'service': 'a.b'}}}}]
        for settings in bad:
            with self.subTest(settings), self.assertRaises(ValueError):
                buttons.normalize(settings)


class TasmotaCommandTests(unittest.TestCase):
    def test_native_behaviour_when_both_buttons_drive_their_relays(self):
        cmds = buttons.tasmota_commands(buttons.normalize({'buttons': {'left': {'mode': 'relay'}, 'right': {'mode': 'relay'}}}))
        self.assertEqual(cmds, [('SetOption73', '0'), ('Rule3', '0')])

    def test_one_relay_and_one_action_button(self):
        cmds = buttons.tasmota_commands(buttons.normalize({'buttons': {'left': {'mode': 'relay'}, 'right': {'mode': 'actions'}}}))
        self.assertEqual(cmds, [('SetOption73', '1'),
                                ('Rule3', 'ON Button1#Action=SINGLE DO Power1 TOGGLE ENDON'), ('Rule3', '1')])

    def test_no_relay_buttons_disables_the_rule(self):
        cmds = buttons.tasmota_commands(buttons.normalize({'buttons': {'left': {'mode': 'off'}, 'right': {'mode': 'actions'}}}))
        self.assertEqual(cmds, [('SetOption73', '1'), ('Rule3', '0')])

    def test_nothing_without_settings(self):
        self.assertEqual(buttons.tasmota_commands(None), [])


class TopicAndEventTests(unittest.TestCase):
    def test_topics(self):
        self.assertEqual(buttons.stat_topic('tele/kitchen_panel/RESULT'), 'stat/kitchen_panel/RESULT')
        self.assertIsNone(buttons.stat_topic('custom/panel'))
        self.assertEqual(buttons.command_topic('cmnd/kitchen_panel/CustomSend', 'Rule3'), 'cmnd/kitchen_panel/Rule3')
        self.assertIsNone(buttons.command_topic('custom/send', 'Rule3'))

    def test_parse_event(self):
        self.assertEqual(buttons.parse_event('{"Button2":{"Action":"DOUBLE"}}'), (2, 'double'))
        self.assertEqual(buttons.parse_event('{"Button1":{"Action":"HOLD"}}'), (1, 'hold'))
        for ignored in ('{"POWER1":"ON"}', '{"Button1":{"Action":"QUAD"}}', 'nope', '{"Button3":{"Action":"SINGLE"}}', '[]'):
            self.assertIsNone(buttons.parse_event(ignored), ignored)


class RunActionTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.cfg = buttons.normalize({'buttons': {'right': {'mode': 'actions', 'single': {
            'service': 'scene.turn_on', 'entity': 'scene.a'}, 'double': {'service': 'script.foo'}}}})

    def call(self, entity_name, domain, service, service_data):
        self.calls.append((entity_name, domain, service, service_data))
        return True

    def test_runs_the_service_for_each_entity(self):
        self.cfg[2]['single']['entity'] = ['scene.a', 'scene.b']
        buttons.run_action(self.cfg, 2, 'single', self.call)
        self.assertEqual(self.calls, [('scene.a', 'scene', 'turn_on', {}), ('scene.b', 'scene', 'turn_on', {})])

    def test_service_without_an_entity(self):
        buttons.run_action(self.cfg, 2, 'double', self.call)
        self.assertEqual(self.calls, [(None, 'script', 'foo', {})])

    def test_nothing_for_unset_gestures_or_other_modes(self):
        buttons.run_action(self.cfg, 2, 'hold', self.call)
        buttons.run_action(self.cfg, 1, 'single', self.call)   # left is relay mode
        buttons.run_action(None, 2, 'single', self.call)
        self.assertEqual(self.calls, [])


class ConfigValidationTests(unittest.TestCase):
    def test_editor_rejects_a_bad_buttons_setting_and_keeps_good_ones(self):
        from config_manager import ConfigError, parse_yaml, validate
        config = parse_yaml((BACKEND / 'panels.yaml.example').read_text())
        panel = next(iter(config['nspanels'].values()))
        panel['buttons'] = {'right': {'mode': 'actions', 'single': {'service': 'scene.turn_on', 'entity': 'scene.a'}}}
        validate(config)
        panel['buttons'] = {'right': {'mode': 'actions', 'single': {'service': 'nodot'}}}
        with self.assertRaisesRegex(ConfigError, 'domain.service'):
            validate(config)


try:
    import mqtt as mqtt_module
except ImportError:  # paho is not installed outside the add-on
    mqtt_module = None
STUBS = ('websocket', 'dateutil', 'dateutil.parser', 'babel', 'babel.dates')
with patch.dict(sys.modules, {name: types.ModuleType(name) for name in STUBS}):
    sys.modules['dateutil'].tz = types.ModuleType('tz')
    try:
        import panel as panel_module
    except ImportError:
        panel_module = None


@unittest.skipIf(mqtt_module is None, 'add-on dependencies not installed')
class MqttWiringTests(unittest.TestCase):
    def make(self, settings_panel):
        manager = mqtt_module.MqttManager.__new__(mqtt_module.MqttManager)
        manager.settings = {'nspanels': {'k': settings_panel}}
        manager.button_topics = {}
        manager.msg_out_queue_list = {settings_panel['panelRecvTopic']: Queue()}
        return manager

    def test_subscribes_to_button_events_and_forwards_them(self):
        manager = self.make({'panelRecvTopic': 'tele/k/RESULT', 'buttons': {}})
        client = Mock(subscribe=Mock(return_value=(0, 1)))
        manager.on_mqtt_connect(client, None, None, 0)
        client.subscribe.assert_any_call('stat/k/RESULT')
        manager.on_mqtt_message(client, None, types.SimpleNamespace(topic='stat/k/RESULT', payload=b'{"Button2":{"Action":"HOLD"}}'))
        queue = manager.msg_out_queue_list['tele/k/RESULT']
        items = [queue.get_nowait() for _ in range(queue.qsize())]
        self.assertIn(('BUTTON:', (2, 'hold')), items)

    def test_no_button_subscription_without_the_setting(self):
        manager = self.make({'panelRecvTopic': 'tele/k/RESULT'})
        client = Mock(subscribe=Mock(return_value=(0, 1)))
        manager.on_mqtt_connect(client, None, None, 0)
        self.assertNotIn('stat/k/RESULT', [c.args[0] for c in client.subscribe.call_args_list])


@unittest.skipIf(panel_module is None, 'add-on dependencies not installed')
class PanelWiringTests(unittest.TestCase):
    def make(self, button_settings):
        panel = panel_module.LovelaceUIPanel.__new__(panel_module.LovelaceUIPanel)
        panel.name = 'k'
        panel.use_ha_api = False
        panel.sendTopic = 'cmnd/k/CustomSend'
        panel.msg_out_queue = Queue()
        panel.buttons = buttons.normalize({'buttons': button_settings})
        return panel

    def test_setup_publishes_the_tasmota_commands(self):
        panel = self.make({'left': {'mode': 'relay'}, 'right': {'mode': 'actions'}})
        panel.setup_buttons()
        sent = [panel.msg_out_queue.get_nowait() for _ in range(panel.msg_out_queue.qsize())]
        self.assertEqual(sent[0], ('cmnd/k/SetOption73', '1'))
        self.assertEqual(sent[-1], ('cmnd/k/Rule3', '1'))

    def test_button_event_calls_home_assistant(self):
        panel = self.make({'right': {'single': {'service': 'scene.turn_on', 'entity': 'scene.a'}}})
        with patch.object(panel_module.libs.home_assistant, 'call_service', return_value=True) as call:
            panel.button_event(2, 'single')
        call.assert_called_once_with('scene.a', 'scene', 'turn_on', {})


if __name__ == '__main__':
    unittest.main()
