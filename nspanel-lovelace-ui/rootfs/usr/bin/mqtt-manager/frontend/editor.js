"use strict";
const $ = id => document.getElementById(id);
let config = null, revision, selected, selectedCard = "saver", cardTypes = [], dirty = false, yamlMode = false, preview;
const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);
function element(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function message(text, error = false) { $("message").textContent = text; $("message").classList.toggle("error", error); }
function changed() { dirty = true; $("dirty").textContent = "Unsaved changes"; schedulePreview(); }
// The preview pane redraws shortly after any edit or selection change; only the newest request is shown.
let previewTimer, previewSeq = 0;
function schedulePreview(delay = 600) { clearTimeout(previewTimer); previewTimer = setTimeout(() => refreshPreview(), delay); }
async function refreshPreview() {
  if (yamlMode || !config || !selected || $("visual-wrap").hidden) return;
  const seq = ++previewSeq;
  try {
    const yaml = (await api("serialize", {config})).yaml;
    await NSPreview.show(yaml, selected, selectedCard, () => seq === previewSeq);
  } catch (error) { if (seq === previewSeq) NSPreview.error(error.message); }
}
window.refreshPreview = refreshPreview;
async function api(path, body) {
  const response = await fetch(`api/${path}`, body === undefined ? {} : {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function action(text, callback, cls) {
  const button = element("button", text, cls);
  button.type = "button";
  button.onclick = async () => {
    button.disabled = true;
    try { await callback(); } catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  };
  return button;
}
function field(parent, object, key, title, options) {
  const label = element("label", title);
  const input = element(options ? "select" : "input");
  if (options) for (const value of options) {
    const option = element("option", value); option.value = value; input.append(option);
  }
  input.value = object[key] ?? (options ? options[0] : "");
  input.onchange = () => { if (input.value === "") delete object[key]; else object[key] = input.value; changed(); };
  label.append(input); parent.append(label);
}
function advanced(parent, object, title = "Advanced options (JSON)") {
  const details = element("details"), summary = element("summary", title), input = element("textarea");
  input.setAttribute("aria-label", title);
  details.append(summary, input);
  details.ontoggle = () => { if (details.open) input.value = JSON.stringify(object, null, 2); };
  details.append(action("Apply advanced options to draft", () => {
    const replacement = JSON.parse(input.value);
    if (!replacement || Array.isArray(replacement) || typeof replacement !== "object") throw new Error("Expected a JSON object.");
    if (Object.keys(replacement).some(key => unsafeKeys.has(key))) throw new Error("Reserved property name.");
    for (const key of Object.keys(object)) delete object[key];
    Object.assign(object, replacement); changed(); render();
  }));
  parent.append(details);
}
function iconButton(icon, label, callback, cls) {
  const button = action("", callback, cls ? `icon-button ${cls}` : "icon-button");
  button.append(element("span", undefined, `mdi mdi-${icon}`));
  button.firstChild.setAttribute("aria-hidden", "true");
  button.setAttribute("aria-label", label); button.title = label;
  return button;
}
// A heading with a pencil that swaps it for an input; Enter or leaving the box commits, Escape cancels.
function editableTitle(text, fallback, label, commit, level = "h2") {
  const box = element("div", undefined, "title-edit"), heading = element(level, text || fallback);
  const pencil = iconButton("pencil", label, () => {
    const input = element("input"); input.value = text || ""; input.setAttribute("aria-label", label); input.placeholder = fallback;
    let done = false;
    const finish = save => {
      if (done) return; done = true;
      if (save) { try { commit(input.value.trim()); } catch (error) { message(error.message, true); render(); } } else render();
    };
    input.onkeydown = event => { if (event.key === "Enter") finish(true); else if (event.key === "Escape") finish(false); };
    input.onblur = () => finish(true);
    box.replaceChildren(input); input.focus(); input.select();
  });
  box.append(heading, pencil);
  return box;
}
function setOrDelete(object, key, value) { if (value === "" || value === undefined || (Array.isArray(value) && !value.length)) delete object[key]; else object[key] = value; changed(); }
function entityField(parent, object, key, title, domains) {
  const label = element("label", title);
  label.append(EntityPicker.create({value: object[key] ?? "", domains, label: title, onChange: value => setOrDelete(object, key, value)}));
  parent.append(label);
}
// One option of a card, drawn from CARD_INFO: text, select, entity picker or a group of checkboxes.
function optionField(parent, card, spec) {
  if (spec.kind === "entity") { entityField(parent, card, spec.key, spec.label, EditorModel.domainsFor(card.type)); return; }
  if (spec.kind === "cardlink") {
    const label = element("label", spec.label);
    label.append(cardLinkSelect(config.nspanels[selected], card, card[spec.key], spec.label, value => { setOrDelete(card, spec.key, value); render(); }));
    parent.append(label); return;
  }
  if (spec.kind === "modes") {
    const group = element("fieldset", undefined, "modes"); group.append(element("legend", spec.label));
    const chosen = Array.isArray(card[spec.key]) ? card[spec.key] : [];
    for (const mode of spec.options) {
      const label = element("label", mode.replaceAll("_", " "), "check"), box = element("input");
      box.type = "checkbox"; box.checked = chosen.includes(mode);
      box.onchange = () => setOrDelete(card, spec.key, EditorModel.toggleMode(card[spec.key], mode, box.checked));
      label.prepend(box); group.append(label);
    }
    group.append(element("p", "None ticked: the modes Home Assistant reports are used.", "hint"));
    parent.append(group); return;
  }
  if (spec.kind === "select" || spec.kind === "font") {
    const label = element("label", spec.label), input = element("select");
    for (const value of ["", ...spec.options]) { const option = element("option", value || "(default)"); option.value = value; input.append(option); }
    input.value = card[spec.key] ?? ""; input.onchange = () => setOrDelete(card, spec.key, input.value);
    label.append(input); parent.append(label); return;
  }
  field(parent, card, spec.key, spec.label);
}
// A dropdown of the panel's other cards; picking one stores navigate.<card key> (the card gets a key if it has none).
function cardLinkSelect(panel, card, value, title, onChange) {
  const targets = EditorModel.linkTargets(panel, card), key = EditorModel.linkKey(value);
  const select = element("select");
  select.setAttribute("aria-label", title);
  const add = (text, val) => { const option = element("option", text); option.value = val; select.append(option); };
  add("(choose a card)", "");
  targets.forEach((target, index) => add(target.label + (target.hidden ? " (hidden card)" : ""), String(index)));
  const match = key === null ? -1 : targets.findIndex(target => target.card.key === key);
  if (key !== null && match < 0) add(`${value} (not one of this panel's cards)`, "custom");
  select.value = match >= 0 ? String(match) : key !== null ? "custom" : "";
  select.onchange = () => {
    if (select.value === "custom") return;
    if (select.value === "") { onChange("", null); return; }
    const target = targets[Number(select.value)];
    onChange(`navigate.${EditorModel.ensureKey(panel, target.card)}`, target);
  };
  return select;
}
const pendingLinks = new WeakSet();  // rows added with "Go to card" that have no target yet
// Drag handle plus up/down buttons for one entity row. Only the handle is draggable, so text in the fields stays selectable.
function reorderControls(row, list, index, onMove) {
  const box = element("div", undefined, "reorder");
  const handle = element("span", undefined, "drag-handle mdi mdi-drag");
  handle.title = "Drag to reorder"; handle.setAttribute("aria-hidden", "true"); handle.draggable = true;
  const up = iconButton("chevron-up", "Move entity up", () => onMove(index, index - 1));
  const down = iconButton("chevron-down", "Move entity down", () => onMove(index, index + 1));
  up.disabled = index === 0; down.disabled = index === list.length - 1;
  box.append(handle, up, down);
  handle.ondragstart = event => {
    event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(index));
    event.dataTransfer.setDragImage(row, 20, 20);
    row.classList.add("dragging"); row.dataset.dragFrom = String(index);
  };
  handle.ondragend = () => { row.classList.remove("dragging"); document.querySelectorAll(".drop-before,.drop-after").forEach(n => n.classList.remove("drop-before", "drop-after")); };
  row.ondragover = event => {
    if (!document.querySelector(".entity-row.dragging")) return;
    event.preventDefault();
    const box = row.getBoundingClientRect(), after = event.clientY > box.top + box.height / 2;
    row.classList.toggle("drop-after", after); row.classList.toggle("drop-before", !after);
  };
  row.ondragleave = event => { if (!row.contains(event.relatedTarget)) row.classList.remove("drop-before", "drop-after"); };
  row.ondrop = event => {
    const dragging = document.querySelector(".entity-row.dragging");
    if (!dragging) return;
    event.preventDefault();
    const after = row.classList.contains("drop-after");
    onMove(Number(dragging.dataset.dragFrom), EditorModel.dropIndex(Number(dragging.dataset.dragFrom), index, after));
  };
  return box;
}
function entities(parent, card, title = "Entities") {
  parent.append(element("h3", title));
  const list = element("div"), panel = config.nspanels[selected]; parent.append(list);
  const moveEntity = (from, to) => { if (EditorModel.moveItem(card.entities, from, to) !== from || from === to) { changed(); render(); } };
  for (const [index, entity] of (card.entities || []).entries()) {
    const row = element("div", undefined, "entity-row"), body = element("div", undefined, "entity-body"), main = element("div", undefined, "entity-main");
    const link = pendingLinks.has(entity) || EditorModel.linkKey(entity.entity) !== null;
    if (link) {
      const label = element("label", "Go to card");
      label.append(cardLinkSelect(panel, card, entity.entity, "Go to card", (value, target) => {
        if (value) pendingLinks.delete(entity);
        setOrDelete(entity, "entity", value);
        if (target && !entity.name) entity.name = target.label;
        render();
      }));
      main.append(label);
    } else entityField(main, entity, "entity", "Entity", null);
    field(main, entity, "name", "Display name");
    const iconLabel = element("div", undefined, "icon-label"); iconLabel.append(element("span", "Icon"));
    iconLabel.append(IconPicker.field({value: entity.icon, label: "Icon", onChange: value => { setOrDelete(entity, "icon", value); render(); }}));
    main.append(iconLabel);
    main.append(iconButton("trash-can-outline", "Remove entity", () => { card.entities.splice(index, 1); changed(); render(); }, "danger"));
    body.append(main); advanced(body, entity, "Advanced (colour, state filters...)");
    row.append(reorderControls(row, card.entities, index, moveEntity), body);
    list.append(row);
  }
  const buttons = element("div", undefined, "add-row");
  buttons.append(iconButton("plus", "Add entity", () => { (card.entities ||= []).push({entity: ""}); changed(); render(); }, "add"),
    iconButton("arrow-right-bold-box-outline", "Add a link to another card", () => {
      const entity = {entity: ""}; pendingLinks.add(entity); (card.entities ||= []).push(entity); changed(); render();
    }, "add"));
  parent.append(buttons);
}
function cardTab(panel, entry) {
  const label = entry.card.title || (window.CARD_INFO?.[entry.card.type]?.label ?? entry.card.type);
  const tab = action(entry.key === "hiddenCards" ? `${label} (hidden)` : label, () => { selectedCard = {key: entry.key, index: entry.index}; render(); }, "tab");
  const current = selectedCard !== "saver" && selectedCard.key === entry.key && selectedCard.index === entry.index;
  tab.setAttribute("aria-pressed", String(current));
  return tab;
}
function cardEditor(view, panel) {
  const {key, index} = selectedCard, card = panel[key][index];
  const box = element("article", undefined, "card"), head = element("div", undefined, "card-heading");
  head.append(editableTitle(card.title, card.type, "Edit card title", value => { if (value) card.title = value; else delete card.title; changed(); render(); }, "h3"));
  const controls = element("div", undefined, "actions");
  controls.append(
    iconButton("chevron-left", "Move card earlier", () => { selectedCard = {key, index: EditorModel.moveCard(panel, key, index, -1)}; changed(); render(); }),
    iconButton("chevron-right", "Move card later", () => { selectedCard = {key, index: EditorModel.moveCard(panel, key, index, 1)}; changed(); render(); }),
    iconButton("trash-can-outline", "Delete card", () => {
      if (!confirm("Remove this card from the draft?")) return;
      EditorModel.deleteCard(panel, key, index); selectedCard = {key, index: Math.max(0, index - 1)}; changed(); render();
    }, "danger"));
  head.append(controls); box.append(head);
  const hidden = element("label", "Hidden card (reached by navigation only)", "check"), checkbox = element("input");
  checkbox.type = "checkbox"; checkbox.checked = key === "hiddenCards";
  checkbox.onchange = () => { selectedCard = EditorModel.setHidden(panel, key, index, checkbox.checked); changed(); render(); };
  hidden.prepend(checkbox); box.append(hidden);
  const fields = element("div", undefined, "fields");
  const typeLabel = element("label", "Card type"), typeButton = action(CARD_INFO[card.type]?.label ?? card.type, async () => {
    const type = await CardGallery.choose(card.type);
    if (type && type !== card.type) { card.type = type; changed(); render(); }
  }, "type-button");
  typeButton.setAttribute("aria-label", `Card type: ${CARD_INFO[card.type]?.label ?? card.type}. Change`);
  typeLabel.append(typeButton); fields.append(typeLabel);
  const info = CARD_INFO[card.type];
  // A card type we do not know keeps the generic fields; known types show only what they use.
  for (const spec of info ? info.fields : [{key: "key", label: "Navigation key", kind: "text"}, {key: "entity", label: "Main entity", kind: "entity"}]) optionField(fields, card, spec);
  box.append(fields);
  if (!info || info.entityList) entities(box, card, info?.listLabel || "Entities");
  advanced(box, card, "Advanced (all card options as JSON)");
  view.append(box);
}
function saverEditor(view, panel) {
  const screen = element("article", undefined, "card"); panel.screensaver ||= {};
  screen.append(element("h3", "Screensaver"));
  const fields = element("div", undefined, "fields");
  field(fields, panel.screensaver, "type", "Screensaver style", ["screensaver", "screensaver2", "screensaver3"]);
  screen.append(fields);
  // What the panel does when it has been idle: show the screensaver, or go back to a chosen card.
  const idle = element("fieldset", undefined, "idle"); idle.append(element("legend", "When the panel is idle"));
  const off = element("label", "No screensaver: return to the default card instead", "check"), offBox = element("input");
  offBox.type = "checkbox"; offBox.checked = panel.screensaver.disable === true;
  offBox.onchange = () => { setOrDelete(panel.screensaver, "disable", offBox.checked ? true : ""); render(); };
  off.prepend(offBox); idle.append(off);
  const seconds = element("label", "Idle time before this happens (seconds, 0 = never)"), secondsInput = element("input");
  secondsInput.type = "number"; secondsInput.min = "0"; secondsInput.step = "1"; secondsInput.value = panel.sleepTimeout ?? "";
  secondsInput.placeholder = "20";
  secondsInput.onchange = () => { const n = Math.floor(Number(secondsInput.value)); setOrDelete(panel, "sleepTimeout", secondsInput.value === "" || !(n >= 0) ? "" : n); };
  seconds.append(secondsInput); idle.append(seconds);
  const home = element("label", "Default card");
  home.append(cardLinkSelect(panel, null, panel.defaultCard, "Default card", value => { setOrDelete(panel, "defaultCard", value); render(); }));
  idle.append(home);
  idle.append(element("p", offBox.checked ? "After the idle time the panel dims and returns to the default card. Touching it wakes it." : "After the idle time the panel dims and shows the screensaver. The default card is where tapping the screensaver leads.", "hint"));
  screen.append(idle); entities(screen, panel.screensaver, "Weather and status entities");
  advanced(screen, panel.screensaver, "Advanced (all screensaver options as JSON)"); view.append(screen);
}
const BUTTON_MODES = [["relay", "Toggles its own relay"], ["actions", "Runs Home Assistant actions"], ["off", "Does nothing"]];
const GESTURE_LABELS = {single: "Single press", double: "Double press", triple: "Triple press", hold: "Hold"};
// The panel's two physical buttons. The add-on sets Tasmota up to match and calls the Home Assistant services.
function buttonsEditor(view, panel) {
  const details = element("details", undefined, "panel-buttons");
  details.open = !!panel.buttons;
  details.append(element("summary", "Physical buttons"));
  details.append(element("p", "The two buttons on the panel. The add-on configures the panel's firmware (Tasmota) to match when it connects.", "hint"));
  for (const [side, title] of [["left", "Left button"], ["right", "Right button"]]) {
    const box = element("fieldset", undefined, "button-box"); box.append(element("legend", title));
    const mode = element("label", "When pressed"), select = element("select");
    for (const [value, label] of BUTTON_MODES) { const o = element("option", label); o.value = value; select.append(o); }
    select.value = EditorModel.buttonMode(panel, side);
    select.setAttribute("aria-label", `${title} mode`);
    select.onchange = () => { EditorModel.setButtonMode(panel, side, select.value); changed(); render(); };
    mode.append(select); box.append(mode);
    if (select.value === "actions") for (const gesture of EditorModel.GESTURES) {
      const current = EditorModel.buttonAction(panel, side, gesture), row = element("div", undefined, "gesture-row");
      row.append(element("strong", GESTURE_LABELS[gesture]));
      const service = element("label", "Service"), input = element("input"), list = element("datalist");
      list.id = `services-${side}-${gesture}`; input.setAttribute("list", list.id); input.value = current.service; input.placeholder = "e.g. scene.turn_on";
      const suggest = entityId => {
        list.replaceChildren();
        for (const name of EditorModel.servicesFor(entityId)) { const o = element("option"); o.value = name; list.append(o); }
      };
      suggest(current.entity);
      input.onchange = () => { EditorModel.setButtonAction(panel, side, gesture, {service: input.value.trim()}); changed(); };
      service.append(input, list);
      // Updated in place: re-rendering here would remove the picker while it still has focus.
      const entity = element("label", "Entity");
      entity.append(EntityPicker.create({value: current.entity, domains: null, label: `${title} ${GESTURE_LABELS[gesture]} entity`,
        onChange: value => {
          EditorModel.setButtonAction(panel, side, gesture, {entity: value}); changed();
          input.value = EditorModel.buttonAction(panel, side, gesture).service; suggest(value);
        }}));
      const data = element("label", "Extra data (JSON, optional)"), dataInput = element("input");
      dataInput.value = Object.keys(current.data).length ? JSON.stringify(current.data) : "";
      dataInput.onchange = () => {
        try {
          const value = dataInput.value.trim() ? JSON.parse(dataInput.value) : {};
          if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("Expected a JSON object.");
          if (Object.keys(value).some(key => unsafeKeys.has(key))) throw new Error("Reserved property name.");
          dataInput.removeAttribute("aria-invalid"); EditorModel.setButtonAction(panel, side, gesture, {data: value}); changed();
        } catch (error) { dataInput.setAttribute("aria-invalid", "true"); message(`${title} ${GESTURE_LABELS[gesture]}: ${error.message}`, true); }
      };
      data.append(dataInput); row.append(entity, service, data); box.append(row);
    }
    details.append(box);
  }
  view.append(details);
}
function renderPanel(view, panel) {
  const heading = element("div", undefined, "panel-header");
  heading.append(editableTitle(selected, selected, "Rename panel", value => {
    if (value === selected) { render(); return; }
    const problem = EditorModel.validPanelName(value, config.nspanels);
    if (problem) throw new Error(problem);
    const topicsChanged = EditorModel.renamePanel(config, selected, value); selected = value; changed(); render();
    if (topicsChanged) message(`Renamed. The MQTT topics now use "${value}" (tele/${value}/RESULT, cmnd/${value}/CustomSend): update the panel device to match, or set custom topics under Advanced panel settings.`);
  }));
  heading.append(iconButton("trash-can-outline", "Delete panel", () => {
    if (confirm(`Remove ${selected} from the draft?`)) { delete config.nspanels[selected]; changed(); render(); }
  }, "danger"));
  view.append(heading);
  const details = element("details", undefined, "panel-advanced");
  details.append(element("summary", "Advanced panel settings"));
  const fields = element("div", undefined, "fields");
  for (const [key, title] of [["panelRecvTopic", "Receive topic"], ["panelSendTopic", "Send topic"], ["locale", "Locale"], ["timeZone", "Time zone"], ["timeFormat", "Time format"], ["dateFormat", "Date format"]]) field(fields, panel, key, title);
  field(fields, panel, "model", "Panel model", ["eu", "us-p", "us-l"]);
  field(fields, panel, "updateMode", "TFT firmware updates", ["auto-notify", "manual", "auto"]);
  details.append(fields); advanced(details, panel, "All panel options (JSON)"); view.append(details);
  buttonsEditor(view, panel);

  const cards = EditorModel.cardList(panel), strip = element("div", undefined, "strip");
  if (selectedCard !== "saver" && !(panel[selectedCard?.key] || [])[selectedCard?.index]) selectedCard = cards.length ? {key: cards[0].key, index: cards[0].index} : "saver";
  for (const entry of cards) strip.append(cardTab(panel, entry));
  strip.append(iconButton("plus", "Add card", async () => {
    const type = await CardGallery.choose(null);
    if (!type) return;
    selectedCard = EditorModel.addCard(panel, type, CARD_INFO[type]?.label ?? "New card"); changed(); render();
  }, "add"));
  const saver = action("Screensaver", () => { selectedCard = "saver"; render(); }, "tab saver-tab");
  saver.setAttribute("aria-pressed", String(selectedCard === "saver")); strip.append(saver);
  view.append(strip);
  if (selectedCard === "saver") saverEditor(view, panel);
  else cardEditor(view, panel);
  if (!cards.length && selectedCard === "saver") view.append(element("p", "No cards yet. Press + to add one."));
}
function render() {
  schedulePreview(200);
  const view = $("visual"), picker = $("panel-select"); view.replaceChildren(); picker.replaceChildren();
  if (!config || !config.nspanels || Array.isArray(config.nspanels) || typeof config.nspanels !== "object") {
    view.append(element("p", "Use the YAML editor or import a configuration to get started.")); return;
  }
  const names = Object.keys(config.nspanels);
  if (!Object.hasOwn(config.nspanels, selected)) selected = names[0];
  for (const name of names) { const option = element("option", name); option.value = name; picker.append(option); }
  picker.value = selected || "";
  if (!selected) { view.append(element("h2", "A home for every panel"), element("p", "Add a panel or import your existing configuration.")); return; }
  const panel = config.nspanels[selected];
  if (!panel || typeof panel !== "object" || Array.isArray(panel)) { view.append(element("p", "Invalid panel. Fix it in the YAML editor.")); return; }
  renderPanel(view, panel);
}
async function draftYaml() { return yamlMode ? $("yaml").value : (await api("serialize", {config})).yaml; }
function showTab(name) {
  $("visual-wrap").hidden = name !== "visual"; $("yaml-view").hidden = name !== "yaml";
  $("visual-tab").setAttribute("aria-pressed", String(name === "visual")); $("yaml-tab").setAttribute("aria-pressed", String(name === "yaml"));
}
async function visualMode() {
  if (yamlMode) config = (await api("parse", {yaml: $("yaml").value})).config;
  yamlMode = false; showTab("visual"); render();
}
async function load() {
  const data = await api("config"); revision = data.revision; cardTypes = data.cardTypes;
  $("yaml").value = data.yaml; yamlMode = true;
  try { await visualMode(); } catch (error) {
    showTab("yaml");
    message(`Configuration needs repair: ${error.message}`, true); return;
  }
  dirty = false; $("dirty").textContent = ""; message("Configuration loaded. Changes stay in your draft until saved.");
}
function bind(id, fn) { $(id).onclick = async () => { try { await fn(); } catch (error) { message(error.message, true); } }; }
bind("visual-tab", visualMode);
bind("yaml-tab", async () => {
  $("yaml").value = await draftYaml(); yamlMode = true; showTab("yaml");
});
$("yaml").oninput = changed;
bind("reload", async () => { if (!dirty || confirm("Discard unsaved changes and reload?")) await load(); });
bind("save", async () => {
  $("save").disabled = true;
  try {
    const data = await api("config", {yaml: await draftYaml(), revision}); revision = data.revision;
    dirty = false; $("dirty").textContent = ""; message("Saved. The panel backend will reload. Previous configuration: panels.yaml.bak.");
  } finally { $("save").disabled = false; }
});
bind("export", async () => {
  const url = URL.createObjectURL(new Blob([await draftYaml()], {type: "text/yaml"}));
  const link = element("a"); link.href = url; link.download = "panels.yaml"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("panel-select").onchange = () => { selected = $("panel-select").value; selectedCard = "saver"; render(); };
bind("add-panel", async () => {
  await visualMode(); $("new-panel-form").hidden = false; $("new-panel-name").value = ""; $("new-panel-name").focus();
});
bind("new-panel-cancel", () => { $("new-panel-form").hidden = true; });
$("new-panel-form").onsubmit = event => {
  event.preventDefault();
  const name = $("new-panel-name").value.trim(), problem = EditorModel.validPanelName(name, config?.nspanels);
  if (problem) { message(problem, true); return; }
  (config.nspanels ||= {})[name] = EditorModel.newPanel(name);
  selected = name; selectedCard = "saver"; $("new-panel-form").hidden = true; changed(); render();
};
function clearPreview() { preview = null; $("import-result").textContent = ""; $("import-merge").hidden = true; $("import-replace").hidden = true; }
bind("import-open", () => { clearPreview(); $("import-dialog").showModal(); });
bind("import-cancel", () => $("import-dialog").close());
$("import-yaml").oninput = clearPreview;
$("file").onchange = async event => {
  const file = event.target.files[0]; if (!file) return; clearPreview();
  if (file.size > 1024 * 1024) { $("import-result").textContent = "File exceeds 1 MiB."; return; }
  $("import-yaml").value = await file.text();
};
bind("preview-import", async () => {
  clearPreview();
  try {
    preview = await api("import", {yaml: $("import-yaml").value});
    $("import-result").textContent = `${preview.format}: ${Object.keys(preview.config.nspanels || {}).join(", ")}\n${preview.warnings.join("\n")}\n${preview.errors.map(e => `Fix before saving: ${e}`).join("\n")}`;
    $("import-merge").hidden = false; $("import-replace").hidden = false;
  } catch (error) { $("import-result").textContent = error.message; }
});
async function applyImport(merge) {
  if (!preview) return;
  let next = structuredClone(preview.config);
  if (merge) {
    const existing = yamlMode ? (await api("parse", {yaml: $("yaml").value})).config : config;
    const collisions = Object.keys(next.nspanels).filter(name => Object.hasOwn(existing.nspanels || {}, name));
    if (collisions.length) throw new Error(`Panel names already exist: ${collisions.join(", ")}. Rename them in the import YAML or replace the draft.`);
    next = {...existing, nspanels: {...existing.nspanels, ...next.nspanels}};
  } else if (!confirm("Replace the entire draft, including connection settings, with this import?")) return;
  config = next; $("yaml").value = (await api("serialize", {config})).yaml; yamlMode = true;
  // Keep migration errors editable without requiring the visual form to understand invalid values.
  showTab("yaml");
  changed(); $("import-dialog").close(); message("Import added to draft. Review YAML and migration warnings before saving.");
}
for (const [id, merge] of [["import-merge", true], ["import-replace", false]]) {
  bind(id, async () => {
    try { await applyImport(merge); }
    catch (error) { $("import-result").textContent = error.message; }
  });
}
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
load().catch(error => message(error.message, true));
