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


@unittest.skipIf(panel_module is None, 'add-on dependencies not installed')
class RenderFallbackTests(unittest.TestCase):
    """Some screen firmware never asks for a card's contents after a page switch; the add-on sends them anyway."""

    def make(self, **settings):
        panel = panel_module.LovelaceUIPanel.__new__(panel_module.LovelaceUIPanel)
        panel.name = 'p'
        panel.updater = types.SimpleNamespace(active=False)
        panel.settings = settings
        panel.msg_out_queue = Mock()
        panel.sendTopic = 'send'
        panel.current_card = types.SimpleNamespace(type='cardGrid', render=Mock())
        panel.screensaver = None
        panel._active_detail = None
        panel._last_detail_payload = None
        return panel

    def test_page_switch_schedules_a_render_if_the_screen_does_not_ask(self):
        panel = self.make()
        with patch.object(panel_module.threading, 'Timer') as timer, patch.object(panel_module.libs.panel_cmd, 'page_type'):
            panel.render_current_page(switchPages=True)
        timer.assert_called_once()
        self.assertTrue(timer.return_value.daemon)
        timer.return_value.start.assert_called_once()
        panel._render_fallback(panel._page_seq)
        panel.current_card.render.assert_called_once()

    def test_no_render_when_the_screen_already_asked(self):
        panel = self.make()
        with patch.object(panel_module.threading, 'Timer'), patch.object(panel_module.libs.panel_cmd, 'page_type'):
            panel.render_current_page(switchPages=True)
        panel.render_current_page(requested=True, force=True)
        panel.current_card.render.reset_mock()
        panel._render_fallback(panel._page_seq)
        panel.current_card.render.assert_not_called()

    def test_stale_timer_for_an_earlier_page_does_nothing(self):
        panel = self.make()
        with patch.object(panel_module.threading, 'Timer'), patch.object(panel_module.libs.panel_cmd, 'page_type'):
            panel.render_current_page(switchPages=True)
            first = panel._page_seq
            panel.render_current_page(switchPages=True)
        panel._render_fallback(first)
        panel.current_card.render.assert_not_called()

    def test_can_be_turned_off(self):
        panel = self.make(pageRenderFallback=False)
        with patch.object(panel_module.threading, 'Timer') as timer, patch.object(panel_module.libs.panel_cmd, 'page_type'):
            panel.render_current_page(switchPages=True)
        timer.assert_not_called()


if __name__ == '__main__':
    unittest.main()
