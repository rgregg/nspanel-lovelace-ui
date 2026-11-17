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

  // Entity domains each card type can use; null means any.
  const DOMAINS = {
    cardThermo: ["climate"], cardMedia: ["media_player"], cardAlarm: ["alarm_control_panel"],
  };
  function domainsFor(cardType) { return DOMAINS[cardType] || null; }

  const api = {validPanelName, renamePanel, toggleMode, newPanel, cardList, moveCard, setHidden, addCard, deleteCard, domainsFor};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.EditorModel = api;
})(typeof window !== "undefined" ? window : globalThis);
