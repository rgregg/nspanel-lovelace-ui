"""The panel's two physical buttons.

Panel setting (button 1 is the left button, button 2 the right):

    buttons:
      left:  {mode: relay}
      right:
        mode: actions
        single: {service: scene.turn_on, entity: scene.kitchen_bright}
        hold:   {service: light.toggle, entity: [light.a, light.b], data: {}}

`mode` is relay (the button toggles its own relay), actions or off. The add-on configures
Tasmota to match (SetOption73 plus rule 3) and turns Tasmota's button events into Home Assistant
service calls. Without a `buttons` setting the add-on does not touch the panel's buttons.
"""
import json
import logging

NAMES = {"left": 1, "right": 2}
MODES = ("relay", "actions", "off")
GESTURES = ("single", "double", "triple", "hold")
DEFAULTS = {1: "relay", 2: "off"}
RULE = 3  # the Tasmota rule slot this add-on owns


def _action(where, value):
    if not isinstance(value, dict):
        raise ValueError(f"{where} must be an object with a service.")
    service = value.get("service")
    if not isinstance(service, str) or service.count(".") != 1 or not all(service.split(".")):
        raise ValueError(f"{where}.service must look like domain.service.")
    entity = value.get("entity", [])
    entity = [entity] if isinstance(entity, str) else entity
    if not isinstance(entity, list) or not all(isinstance(e, str) and e for e in entity):
        raise ValueError(f"{where}.entity must be an entity id or a list of them.")
    data = value.get("data", {})
    if not isinstance(data, dict):
        raise ValueError(f"{where}.data must be a mapping.")
    return {"service": service, "entity": entity, "data": data}


def normalize(panel_settings):
    """Return {1: {...}, 2: {...}} or None when the panel has no `buttons` setting."""
    if "buttons" not in panel_settings:
        return None
    raw = panel_settings["buttons"]
    if raw is None:
        raw = {}
    if not isinstance(raw, dict) or set(raw) - set(NAMES):
        raise ValueError("buttons must be a mapping with left and/or right.")
    result = {}
    for name, number in NAMES.items():
        entry = raw.get(name) or {}
        if not isinstance(entry, dict):
            raise ValueError(f"buttons.{name} must be an object.")
        mode = entry.get("mode")
        if mode is False:  # YAML reads a bare `off` as false
            mode = "off"
        mode = mode or ("actions" if any(g in entry for g in GESTURES) else DEFAULTS[number])
        if mode not in MODES:
            raise ValueError(f"buttons.{name}.mode must be relay, actions or off.")
        unknown = set(entry) - {"mode", *GESTURES}
        if unknown:
            raise ValueError(f"buttons.{name} has unknown option {sorted(unknown)[0]}.")
        built = {"mode": mode}
        for gesture in GESTURES:
            if gesture in entry and entry[gesture]:
                built[gesture] = _action(f"buttons.{name}.{gesture}", entry[gesture])
        result[number] = built
    return result


def tasmota_commands(config):
    """(command, payload) pairs that make Tasmota behave as configured."""
    if not config:
        return []
    if all(config[n]["mode"] == "relay" for n in config):
        return [("SetOption73", "0"), (f"Rule{RULE}", "0")]
    rule = " ".join(f"ON Button{n}#Action=SINGLE DO Power{n} TOGGLE ENDON"
                    for n in sorted(config) if config[n]["mode"] == "relay")
    commands = [("SetOption73", "1")]
    return commands + ([(f"Rule{RULE}", rule), (f"Rule{RULE}", "1")] if rule else [(f"Rule{RULE}", "0")])


def stat_topic(recv_topic):
    """Tasmota publishes button events on stat/<name>/RESULT, beside tele/<name>/RESULT."""
    if recv_topic.startswith("tele/") and recv_topic.endswith("/RESULT"):
        return "stat/" + recv_topic[len("tele/"):]
    return None


def command_topic(send_topic, command):
    prefix, separator, suffix = send_topic.rpartition("/")
    return f"{prefix}/{command}" if separator and suffix == "CustomSend" else None


def parse_event(payload_text):
    try:
        data = json.loads(payload_text)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    for name, number in ((f"Button{n}", n) for n in NAMES.values()):
        entry = data.get(name)
        if isinstance(entry, dict) and str(entry.get("Action", "")).lower() in GESTURES:
            return number, str(entry["Action"]).lower()
    return None


def run_action(config, number, gesture, call_service):
    """Call the configured Home Assistant service. call_service(entity, domain, service, data) -> bool."""
    button = (config or {}).get(number)
    action = button.get(gesture) if button and button["mode"] == "actions" else None
    if not action:
        return
    domain, service = action["service"].split(".")
    for entity in action["entity"] or [None]:
        if not call_service(entity, domain, service, dict(action["data"])):
            logging.error("Button %s %s: Home Assistant service %s failed for %s", number, gesture, action["service"], entity)
