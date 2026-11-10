import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

BACKEND = Path(__file__).resolve().parents[1] / 'nspanel-lovelace-ui/rootfs/usr/bin/mqtt-manager'

CONFIG = {
    'nspanels': {
        'panel': {
            'sleepTracking': 'person.alice',
            'sleepBrightness': 'input_number.sleep_brightness',
            'sleepOverride': {'entity': 'switch.bedroom_lamp', 'brightness': 10},
            'screensaver': {'entities': [
                {'entity': 'weather.home', 'attr': 'temperature'},
                {'entity': 'weather.home', 'day': 1},
            ]},
            'cards': [
                {'type': 'cardEntities', 'title': 'Lights', 'entities': [
                    {'entity': 'light.interior_lights'},
                    {'entity': 'navigate.home', 'status': 'sensor.status'},
                    {'entity': 'iText.hello'},
                    {'entity': 'service.light.turn_on', 'status': 'light.kitchen'},
                    {'entity': 'light.hallway', 'name': 'ha:{{ states("sensor.label") }}'},
                ]},
            ],
        },
    },
    'hiddenCards': [{'type': 'cardEntities', 'entities': [{'entity': 'lock.front_door'}]}],
    'mqtt_server': 'mqtt.lan',
    'home_assistant_token': 'abc.def.ghi',
}


class EntitySubscriptionTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('entity_subscription_test_ha', BACKEND / 'libs/home_assistant.py')
        self.ha = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'websocket': types.ModuleType('websocket')}):
            spec.loader.exec_module(self.ha)
        self.ha.ws = Mock()
        self.ha.on_ha_update = Mock()
        self.ha.settings = {**CONFIG}

    def message(self, message):
        self.ha.on_message(None, json.dumps(message))

    def sent(self):
        return [json.loads(call.args[0]) for call in self.ha.ws.send.call_args_list]

    def connect(self):
        self.message({'type': 'auth_ok'})
        return [m for m in self.sent() if m['type'] == 'subscribe_entities']

    def test_collects_only_home_assistant_entities(self):
        self.assertEqual(self.ha.collect_config_entities(CONFIG), {
            'person.alice', 'input_number.sleep_brightness', 'switch.bedroom_lamp', 'weather.home',
            'light.interior_lights', 'sensor.status', 'light.kitchen', 'light.hallway',
            'sensor.label', 'lock.front_door',
        })

    def test_auth_subscribes_to_configured_entities_not_everything(self):
        subscriptions = self.connect()
        self.assertEqual(len(subscriptions), 1)
        self.assertEqual(subscriptions[0]['entity_ids'], sorted(self.ha.collect_config_entities(CONFIG) | {'sun.sun'}))
        types_sent = [m['type'] for m in self.sent()]
        self.assertNotIn('get_states', types_sent)
        self.assertFalse([m for m in self.sent() if m.get('event_type') == 'state_changed'])

    def test_track_all_entities_restores_full_subscription(self):
        self.ha.settings['track_all_entities'] = True
        self.message({'type': 'auth_ok'})
        sent = self.sent()
        self.assertIn('get_states', [m['type'] for m in sent])
        self.assertTrue([m for m in sent if m.get('event_type') == 'state_changed'])
        self.assertFalse([m for m in sent if m['type'] == 'subscribe_entities'])

    def entities_id(self):
        return [m for m in self.sent() if m['type'] == 'subscribe_entities'][0]['id']

    def test_initial_snapshot_fills_cache_and_notifies_only_those_entities(self):
        self.connect()
        sub_id = self.entities_id()
        self.message({'id': sub_id, 'type': 'result', 'success': True, 'result': None})
        self.message({'id': sub_id, 'type': 'event', 'event': {'a': {
            'light.interior_lights': {'s': 'on', 'a': {'brightness': 200}, 'c': 'ctx1', 'lc': 1700000000.5},
            'weather.home': {'s': 'rainy', 'a': {'temperature': 54}, 'c': 'ctx2', 'lc': 1700000001, 'lu': 1700000002},
        }}})
        data = self.ha.get_entity_data('light.interior_lights')
        self.assertEqual(data['state'], 'on')
        self.assertEqual(data['attributes'], {'brightness': 200})
        self.assertEqual(data['entity_id'], 'light.interior_lights')
        self.assertEqual(data['context'], {'id': 'ctx1'})
        self.assertEqual(data['last_updated'], data['last_changed'])
        self.assertTrue(data['last_changed'].startswith('2023-11-14T22:13:20'))
        self.assertEqual(self.ha.get_entity_data('weather.home')['attributes']['temperature'], 54)
        self.assertEqual({c.args[0] for c in self.ha.on_ha_update.call_args_list},
                         {'light.interior_lights', 'weather.home'})
        self.assertTrue(self.ha.is_existent('weather.home'))

    def test_changes_merge_attributes_and_remove_keys(self):
        self.connect()
        sub_id = self.entities_id()
        self.message({'id': sub_id, 'type': 'result', 'success': True, 'result': None})
        self.message({'id': sub_id, 'type': 'event', 'event': {'a': {
            'light.hallway': {'s': 'on', 'a': {'brightness': 10, 'color_mode': 'hs', 'hs_color': [1, 2]}, 'c': 'c1', 'lc': 1}}}})
        self.ha.on_ha_update.reset_mock()
        self.message({'id': sub_id, 'type': 'event', 'event': {'c': {'light.hallway': {
            '+': {'s': 'off', 'a': {'brightness': 99}, 'lc': 5, 'c': 'c2'},
            '-': {'a': ['hs_color']}}}}})
        data = self.ha.get_entity_data('light.hallway')
        self.assertEqual(data['state'], 'off')
        self.assertEqual(data['attributes'], {'brightness': 99, 'color_mode': 'hs'})
        self.assertEqual(data['context'], {'id': 'c2'})
        self.assertEqual(data['last_updated'], data['last_changed'])
        self.ha.on_ha_update.assert_called_once_with('light.hallway')

    def test_attribute_only_change_keeps_state_and_last_changed(self):
        self.connect()
        sub_id = self.entities_id()
        self.message({'id': sub_id, 'type': 'result', 'success': True, 'result': None})
        self.message({'id': sub_id, 'type': 'event', 'event': {'a': {
            'sun.sun': {'s': 'above_horizon', 'a': {'elevation': 20.0}, 'c': 'c1', 'lc': 100.0, 'lu': 200.0}}}})
        # Shape observed from a live Home Assistant: only updated fields are present.
        self.message({'id': sub_id, 'type': 'event', 'event': {'c': {'sun.sun': {
            '+': {'lu': 300.0, 'c': 'c2', 'a': {'elevation': 24.86, 'azimuth': 175.38}}}}}})
        data = self.ha.get_entity_data('sun.sun')
        self.assertEqual(data['state'], 'above_horizon')
        self.assertEqual(data['attributes'], {'elevation': 24.86, 'azimuth': 175.38})
        self.assertEqual(data['last_changed'], self.ha._timestamp(100.0))
        self.assertEqual(data['last_updated'], self.ha._timestamp(300.0))
        self.assertEqual(data['context'], {'id': 'c2'})

    def test_change_for_unseen_entity_and_removal(self):
        self.connect()
        sub_id = self.entities_id()
        self.message({'id': sub_id, 'type': 'result', 'success': True, 'result': None})
        self.message({'id': sub_id, 'type': 'event', 'event': {'c': {'light.kitchen': {'+': {'s': 'on'}}}}})
        self.assertEqual(self.ha.get_entity_data('light.kitchen')['state'], 'on')
        self.message({'id': sub_id, 'type': 'event', 'event': {'r': ['light.kitchen']}})
        self.assertNotIn('light.kitchen', self.ha.home_assistant_entity_state_cache)
        self.ha.on_ha_update.assert_called_with('light.kitchen')

    def test_unconfigured_lookup_subscribes_once(self):
        self.connect()
        self.ha.ws.send.reset_mock()
        self.assertIsNone(self.ha.get_entity_data('sensor.not_configured'))
        self.assertIsNone(self.ha.get_entity_data('sensor.not_configured'))
        self.assertFalse(self.ha.is_existent('sensor.not_configured'))
        late = [m for m in self.sent() if m['type'] == 'subscribe_entities']
        self.assertEqual(len(late), 1)
        self.assertEqual(late[0]['entity_ids'], ['sensor.not_configured'])
        sub_id = late[0]['id']
        self.message({'id': sub_id, 'type': 'result', 'success': True, 'result': None})
        self.message({'id': sub_id, 'type': 'event', 'event': {'a': {'sensor.not_configured': {'s': '4', 'a': {}}}}})
        self.assertEqual(self.ha.get_entity_data('sensor.not_configured')['state'], '4')

    def test_lookup_of_non_entities_never_subscribes(self):
        self.connect()
        self.ha.ws.send.reset_mock()
        for value in ('screensaver', 'navigate.home', 'service.light.turn_on', '', None, 5):
            self.assertIsNone(self.ha.get_entity_data(value))
        self.assertEqual(self.sent(), [])

    def test_reconnect_resubscribes_including_late_entities(self):
        self.connect()
        self.ha.get_entity_data('sensor.late')
        self.ha.ws.send.reset_mock()
        subscriptions = self.connect()
        self.assertEqual(len(subscriptions), 1)
        self.assertIn('sensor.late', subscriptions[0]['entity_ids'])
        self.assertIn('light.interior_lights', subscriptions[0]['entity_ids'])

    def test_failed_subscription_falls_back_to_full_states(self):
        self.connect()
        sub_id = self.entities_id()
        self.ha.ws.send.reset_mock()
        self.message({'id': sub_id, 'type': 'result', 'success': False, 'error': {'code': 'unknown_command'}})
        sent = self.sent()
        self.assertIn('get_states', [m['type'] for m in sent])
        self.assertTrue([m for m in sent if m.get('event_type') == 'state_changed'])


if __name__ == '__main__':
    unittest.main()
