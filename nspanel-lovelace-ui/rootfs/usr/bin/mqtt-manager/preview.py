"""Render a draft configuration offline, for the editor's Preview tab.

Cards are built by the same ``card_factory`` and ``Screensaver`` classes the
running panel uses, against a fake panel whose output queue only records the
commands. Nothing is sent to MQTT or to a real panel.
"""
import datetime
import logging
import time

from dateutil import tz

import config_manager
import libs.home_assistant
import libs.panel_cmd
from ha_cards import Screensaver, card_factory
from libs.icon_mapping import icons
from libs.panel_format import format_date_text, format_time_text


class CapturingQueue:
    """Stands in for the panel's output queue and keeps what would have been sent."""

    def __init__(self):
        self.commands = []

    def put(self, item):
        self.commands.append(item[1])


class PreviewPanel:
    """The subset of LovelaceUIPanel that cards read while rendering."""

    def __init__(self, name, settings):
        self.name = name
        self.settings = settings
        self.msg_out_queue = CapturingQueue()
        self.sendTopic = "preview"
        self.model = settings.get("model", "eu")
        self.temp_unit = settings.get("temp_unit", "celsius")
        self.cards = {}
        self.hidden_cards = {}
        self.navigate_keys = {}

    def searchCard(self, iid):
        if iid in self.navigate_keys:
            iid = self.navigate_keys[iid]
        return self.cards.get(iid) or self.hidden_cards.get(iid)


def _panel_settings(config, name):
    settings = dict(config["nspanels"][name])
    settings.setdefault("timeZone", config.get("timeZone", "Europe/Berlin"))
    settings.setdefault("locale", config.get("locale", "en_US"))
    settings.setdefault("hiddenCards", config.get("hiddenCards", []))
    settings.setdefault("timeFormat", "%H:%M")
    settings.setdefault("dateFormat", "EEEE, dd.MMMM yyyy")
    return settings


def _wait_for_entities(entity_ids, wait_seconds):
    cache = libs.home_assistant.home_assistant_entity_state_cache
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline and any(e not in cache for e in entity_ids):
        time.sleep(0.05)


def _build(panel, settings, errors):
    """Create the cards the way LovelaceUIPanel.__init__ does, without its side effects."""
    cards = []
    for hidden, key in ((False, "cards"), (True, "hiddenCards")):
        for config in settings.get(key) or []:
            iid, card = card_factory(settings["locale"], config, panel)
            if not card:
                errors.append(f"Card type {config.get('type')!r} is not supported and was skipped.")
                continue
            card.hidden = hidden
            (panel.hidden_cards if hidden else panel.cards)[iid] = card
            if card.navigate_key:
                panel.navigate_keys[card.navigate_key] = iid
            cards.append(card)
    top = list(panel.cards.values())
    if len(top) > 1:
        for index, card in enumerate(top):
            card.iid_prev = top[index - 1].iid
            card.iid_next = top[(index + 1) % len(top)].iid
    return cards


_CHAR_TO_NAME = {}


def _icon_names(commands):
    """Map each single-character icon used in the commands back to its mdi icon name."""
    if not _CHAR_TO_NAME:
        for name, char in icons.items():
            _CHAR_TO_NAME.setdefault(char, name)
    used = {}
    for command in commands:
        for field in command.replace("|", "~").split("~"):  # shutter icons arrive as "up|stop|down|..."
            if len(field) == 1 and field in _CHAR_TO_NAME:
                used[field] = _CHAR_TO_NAME[field]
    return used


def _drain(panel):
    commands, panel.msg_out_queue.commands = panel.msg_out_queue.commands, []
    return commands


def _safe_render(card, errors):
    """Render one card; a card that fails is reported and skipped instead of hiding the rest."""
    try:
        card.render()
        return True
    except Exception as exc:
        logging.exception("Preview could not render %s", card.type)
        errors.append(f"Could not render {card.config.get('title') or card.type}: {exc}")
        return False


def _card_entities(panel, settings):
    ids = set()
    for card in list(panel.cards.values()) + list(panel.hidden_cards.values()):
        ids.update(e for e in card.get_entities() if e != card.iid)
    return ids


def render_preview(draft_yaml, panel_name=None, wait_seconds=2.0):
    """Return what each card and the screensaver of ``panel_name`` would send to the panel."""
    result = {"panels": [], "panel": None, "model": None, "cards": [],
              "screensaver": {"commands": []}, "time": "", "date": "", "icons": {}, "errors": []}
    errors = result["errors"]
    try:
        config = config_manager.parse_yaml(draft_yaml)
        panels = config.get("nspanels")
        if not isinstance(panels, dict) or not panels:
            raise config_manager.ConfigError("The configuration has no panels.")
    except (config_manager.ConfigError, ValueError, TypeError, AttributeError) as exc:
        errors.append(str(exc) or "Invalid configuration.")
        return result
    result["panels"] = sorted(panels)
    name = panel_name if panel_name in panels else result["panels"][0]
    result["panel"] = name
    try:
        settings = _panel_settings(config, name)
        panel = PreviewPanel(name, settings)
        result["model"] = panel.model
        cards = _build(panel, settings, errors)
        saver_config = settings.get("screensaver")
        screensaver = Screensaver(settings["locale"], saver_config, panel) if isinstance(saver_config, dict) and saver_config else None

        # First pass subscribes to unseen entities; then wait (bounded) for their values.
        wanted = _card_entities(panel, settings)
        if screensaver:
            wanted.update(screensaver.get_entities())
        for card in cards:
            _safe_render(card, errors)
        if screensaver:
            _safe_render(screensaver, errors)
        _drain(panel)
        _wait_for_entities(wanted, wait_seconds)

        for card in cards:
            if _safe_render(card, errors):
                result["cards"].append({"iid": card.iid, "type": card.type, "title": card.title,
                                        "hidden": card.hidden, "commands": _drain(panel)})
            _drain(panel)
        if screensaver:
            screensaver.invalidate()
            if _safe_render(screensaver, errors):
                result["screensaver"] = {"type": screensaver.type, "commands": _drain(panel)}
            _drain(panel)
        result["icons"] = _icon_names([c for card in result["cards"] for c in card["commands"]]
                                      + result["screensaver"]["commands"])
        now = datetime.datetime.now(tz.gettz(settings["timeZone"]))
        for key, formatter in (("time", format_time_text), ("date", format_date_text)):
            try:
                result[key] = formatter(settings, now)
            except Exception as exc:  # e.g. a malformed timeFormat or dateFormat
                errors.append(f"Could not format the {key}: {exc}")
    except Exception as exc:  # a bad draft must never break the editor
        logging.exception("Preview failed")
        errors.append(f"Preview failed: {exc}")
    return result
