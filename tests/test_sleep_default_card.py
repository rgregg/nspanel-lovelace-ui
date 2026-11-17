"""With the screensaver disabled, the panel returns to its default card when the sleep timeout is reached."""
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

BACKEND = Path(__file__).resolve().parents[1] / 'nspanel-lovelace-ui/rootfs/usr/bin/mqtt-manager'
sys.path.insert(0, str(BACKEND))
STUBS = ('websocket', 'dateutil', 'dateutil.parser', 'babel', 'babel.dates')
with patch.dict(sys.modules, {name: types.ModuleType(name) for name in STUBS}):
    sys.modules['dateutil'].tz = types.ModuleType('tz')
    try:
        import panel as panel_module
    except ImportError:  # the add-on's own dependencies (e.g. scheduler) are not installed
        panel_module = None


def make_panel(screensaver_settings, current='other'):
    panel = panel_module.LovelaceUIPanel.__new__(panel_module.LovelaceUIPanel)
    panel.name = 'p'
    panel.updater = types.SimpleNamespace(active=False)
    panel.settings = {'screensaver': screensaver_settings}
    panel.screensaver = 'SCREENSAVER'
    panel.privious_cards = []
    panel.current_card = current
    panel.get_default_card = Mock(return_value='DEFAULT')
    panel.render_current_page = Mock()
    return panel


@unittest.skipIf(panel_module is None, 'add-on dependencies not installed')
class SleepReachedTests(unittest.TestCase):
    def test_goes_to_the_screensaver_by_default(self):
        panel = make_panel({})
        panel.customrecv_event_callback('event,sleepReached,cardGrid')
        self.assertEqual(panel.current_card, 'SCREENSAVER')
        self.assertEqual(panel.privious_cards, ['other'])
        panel.render_current_page.assert_called_once_with(switchPages=True)

    def test_disabled_screensaver_returns_to_the_default_card(self):
        panel = make_panel({'disable': True}, current='hidden-page')
        panel.privious_cards = ['older']
        panel.customrecv_event_callback('event,sleepReached,cardGrid')
        self.assertEqual(panel.current_card, 'DEFAULT')
        self.assertEqual(panel.privious_cards, [])
        panel.render_current_page.assert_called_once_with(switchPages=True)


if __name__ == '__main__':
    unittest.main()
