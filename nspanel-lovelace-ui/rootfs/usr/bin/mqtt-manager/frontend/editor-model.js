"use strict";
// Pure editing logic for the visual editor (no DOM), so it can be tested with node.
(root => {
  const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
  const LISTS = ["cards", "hiddenCards"];

  function validPanelName(name, panels) {
    const text = typeof name === "string" ? name.trim() : "";
    if (!text) return "Enter a panel name.";
    if (UNSAFE.has(text)) return "That name is reserved.";
    if (Object.hasOwn(panels || {}, text)) return "A panel with that name already exists.";
    return null;
  }
  // Rebuilds nspanels so the renamed panel keeps its position; unknown keys are untouched.
  function renamePanel(config, oldName, newName) {
    const entries = Object.entries(config.nspanels).map(([key, value]) => [key === oldName ? newName : key, value]);
    const panel = config.nspanels[oldName];
    let topicsChanged = false;
    if (panel.panelRecvTopic === `tele/${oldName}/RESULT`) { panel.panelRecvTopic = `tele/${newName}/RESULT`; topicsChanged = true; }
    if (panel.panelSendTopic === `cmnd/${oldName}/CustomSend`) { panel.panelSendTopic = `cmnd/${newName}/CustomSend`; topicsChanged = true; }
    config.nspanels = Object.fromEntries(entries);
    return topicsChanged;  // the caller tells the user: the device must publish to the new topics
  }
  // Add or remove one mode, keeping every other value (including ones the editor does not offer) in its order.
  function toggleMode(list, mode, on) {
    const modes = Array.isArray(list) ? [...list] : [];
    if (on) return modes.includes(mode) ? modes : [...modes, mode];
    return modes.filter(m => m !== mode);
  }
  function newPanel(name) {
    return {panelRecvTopic: `tele/${name}/RESULT`, panelSendTopic: `cmnd/${name}/CustomSend`, model: "us-p",
      locale: "en_US", timeZone: "Europe/Berlin", timeFormat: "%H:%M", dateFormat: "full", cards: [], screensaver: {entities: []}};
  }
  function cardList(panel) {
    const list = [];
    for (const key of LISTS) (panel[key] || []).forEach((card, index) => list.push({key, index, card}));
    return list;
  }
  function moveCard(panel, key, index, delta) {
    const list = panel[key], target = index + delta;
    if (!list || target < 0 || target >= list.length) return index;
    [list[index], list[target]] = [list[target], list[index]];
    return target;
  }
  function setHidden(panel, key, index, hidden) {
    const want = hidden ? "hiddenCards" : "cards";
    if (key === want) return {key, index};
    const [card] = panel[key].splice(index, 1);
    (panel[want] ||= []).push(card);
    return {key: want, index: panel[want].length - 1};
  }
  function addCard(panel, type, title) {
    (panel.cards ||= []).push({type, title: title || "New card", entities: []});
    return {key: "cards", index: panel.cards.length - 1};
  }
  function deleteCard(panel, key, index) { panel[key].splice(index, 1); }

  // Icons are stored as "mdi:<name>"; anything else (a template such as "ha:...") is kept but not drawn as a choice.
  function iconName(value) { return typeof value === "string" && value.startsWith("mdi:") ? value.slice(4) : null; }
  function iconValue(name) { return `mdi:${name}`; }
  // Names containing every word of the query, those that start with the query first.
  function filterIcons(names, query, limit = 120) {
    const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return names.slice(0, limit);
    const hits = names.filter(name => words.every(word => name.includes(word)));
    const first = words[0];
    return [...hits.filter(n => n.startsWith(first)), ...hits.filter(n => !n.startsWith(first))].slice(0, limit);
  }

  // "Go to card" links are entities named navigate.<card key>.
  function linkKey(value) { return typeof value === "string" && value.startsWith("navigate.") ? value.slice(9) : null; }
  function linkTargets(panel, current) {
    return cardList(panel).filter(entry => entry.card !== current)
      .map(entry => ({card: entry.card, hidden: entry.key === "hiddenCards", label: entry.card.title || entry.card.type}));
  }
  // The card's navigation key; made from its title (unique within the panel) when it has none.
  function ensureKey(panel, card) {
    if (card.key) return card.key;
    const used = new Set(cardList(panel).map(entry => entry.card.key).filter(Boolean));
    const base = String(card.title || card.type || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "card";
    let key = base;
    for (let n = 2; used.has(key); n += 1) key = `${base}-${n}`;
    card.key = key;
    return key;
  }

  // Moves one item of a list; out-of-range positions leave it alone. Returns the item's new index.
  function moveItem(list, from, to) {
    if (!Array.isArray(list) || from < 0 || from >= list.length || to < 0 || to >= list.length) return from;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    return to;
  }
  // Final index of the dragged row when it is dropped before or after the row at `over`.
  function dropIndex(from, over, after) {
    if (after) return over < from ? over + 1 : over;
    return over > from ? over - 1 : over;
  }

  // Entity domains each card type can use; null means any.
  const DOMAINS = {
    cardThermo: ["climate"], cardMedia: ["media_player"], cardAlarm: ["alarm_control_panel"],
  };
  function domainsFor(cardType) { return DOMAINS[cardType] || null; }

  // Physical buttons (panel.buttons.left / .right): a mode, plus Home Assistant actions per gesture.
  const BUTTON_DEFAULTS = {left: "relay", right: "off"};
  const GESTURES = ["single", "double", "triple", "hold"];
  const SERVICES = {
    scene: ["turn_on"], script: ["turn_on", "toggle", "turn_off"], automation: ["trigger", "toggle", "turn_on", "turn_off"],
    light: ["toggle", "turn_on", "turn_off"], switch: ["toggle", "turn_on", "turn_off"], fan: ["toggle", "turn_on", "turn_off"],
    input_boolean: ["toggle", "turn_on", "turn_off"], cover: ["toggle", "open_cover", "close_cover", "stop_cover"],
    lock: ["lock", "unlock"], button: ["press"], input_button: ["press"], media_player: ["media_play_pause", "media_next_track", "media_previous_track", "volume_up", "volume_down"],
  };
  const DEFAULT_SERVICE = {scene: "turn_on", script: "turn_on", automation: "trigger", button: "press", input_button: "press", lock: "lock"};
  const domainOf = entity => String(entity || "").split(".")[0];
  function servicesFor(entity) { const d = domainOf(entity); return (SERVICES[d] || []).map(s => `${d}.${s}`); }
  function defaultService(entity) {
    const d = domainOf(entity);
    return SERVICES[d] ? `${d}.${DEFAULT_SERVICE[d] || "toggle"}` : "";
  }
  function buttonMode(panel, side) {
    const entry = (panel.buttons || {})[side] || {};
    return entry.mode || (GESTURES.some(g => g in entry) ? "actions" : BUTTON_DEFAULTS[side]);
  }
  function setButtonMode(panel, side, mode) {
    panel.buttons ||= {}; panel.buttons[side] ||= {}; panel.buttons[side].mode = mode;
  }
  function buttonAction(panel, side, gesture) {
    const a = ((panel.buttons || {})[side] || {})[gesture] || {};
    const entity = Array.isArray(a.entity) ? a.entity[0] || "" : a.entity || "";
    return {service: a.service || "", entity, data: a.data || {}};
  }
  // Merges {service, entity, data} into one gesture. Naming an entity fills in a likely service; an empty
  // action is removed. An entity list written in the JSON box stays a list unless a new entity is chosen.
  function setButtonAction(panel, side, gesture, patch) {
    panel.buttons ||= {}; const entry = panel.buttons[side] ||= {};
    const action = {...(entry[gesture] || {})};
    if ("entity" in patch) {
      if (patch.entity) action.entity = patch.entity; else delete action.entity;
      if (patch.entity && !action.service && !("service" in patch)) action.service = defaultService(patch.entity);
    }
    if ("service" in patch) { if (patch.service) action.service = patch.service; else delete action.service; }
    if ("data" in patch) { if (patch.data && Object.keys(patch.data).length) action.data = patch.data; else delete action.data; }
    if (!action.service && !action.entity) delete entry[gesture]; else entry[gesture] = action;
  }

  const api = {validPanelName, renamePanel, toggleMode, newPanel, cardList, moveCard, setHidden, addCard, deleteCard, domainsFor,
    iconName, iconValue, filterIcons, linkKey, linkTargets, ensureKey, moveItem, dropIndex,
    GESTURES, servicesFor, defaultService, buttonMode, setButtonMode, buttonAction, setButtonAction};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.EditorModel = api;
})(typeof window !== "undefined" ? window : globalThis);
