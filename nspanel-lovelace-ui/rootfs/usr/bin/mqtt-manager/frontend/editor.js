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
function changed() { dirty = true; $("dirty").textContent = "Unsaved changes"; }
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
function entities(parent, card, title = "Entities") {
  parent.append(element("h3", title));
  const list = element("div"); parent.append(list);
  for (const [index, entity] of (card.entities || []).entries()) {
    const row = element("div", undefined, "entity-row"), main = element("div", undefined, "entity-main");
    field(main, entity, "entity", "Entity ID"); field(main, entity, "name", "Display name");
    main.append(iconButton("close", "Remove entity", () => { card.entities.splice(index, 1); changed(); render(); }, "danger"));
    row.append(main); advanced(row, entity, "Advanced (icon, colour, state filters...)");
    list.append(row);
  }
  parent.append(iconButton("plus", "Add entity", () => { (card.entities ||= []).push({entity: ""}); changed(); render(); }, "add"));
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
  field(fields, card, "type", "Card type", cardTypes); field(fields, card, "key", "Navigation key");
  field(fields, card, "entity", "Main entity (media, climate, alarm)");
  box.append(fields); entities(box, card); advanced(box, card, "Advanced (all card options as JSON)");
  view.append(box);
}
function saverEditor(view, panel) {
  const screen = element("article", undefined, "card"); panel.screensaver ||= {};
  screen.append(element("h3", "Screensaver"));
  const fields = element("div", undefined, "fields");
  field(fields, panel.screensaver, "type", "Screensaver style", ["screensaver", "screensaver2", "screensaver3"]);
  screen.append(fields); entities(screen, panel.screensaver, "Weather and status entities");
  advanced(screen, panel.screensaver, "Advanced (all screensaver options as JSON)"); view.append(screen);
}
function renderPanel(view, panel) {
  const heading = element("div", undefined, "panel-header");
  heading.append(editableTitle(selected, selected, "Rename panel", value => {
    if (value === selected) { render(); return; }
    const problem = EditorModel.validPanelName(value, config.nspanels);
    if (problem) throw new Error(problem);
    EditorModel.renamePanel(config, selected, value); selected = value; changed(); render();
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

  const cards = EditorModel.cardList(panel), strip = element("div", undefined, "strip");
  if (selectedCard !== "saver" && !(panel[selectedCard?.key] || [])[selectedCard?.index]) selectedCard = cards.length ? {key: cards[0].key, index: cards[0].index} : "saver";
  for (const entry of cards) strip.append(cardTab(panel, entry));
  strip.append(iconButton("plus", "Add card", () => {
    selectedCard = EditorModel.addCard(panel, "cardEntities", "New card"); changed(); render();
  }, "add"));
  const saver = action("Screensaver", () => { selectedCard = "saver"; render(); }, "tab saver-tab");
  saver.setAttribute("aria-pressed", String(selectedCard === "saver")); strip.append(saver);
  view.append(strip);
  if (selectedCard === "saver") saverEditor(view, panel);
  else cardEditor(view, panel);
  if (!cards.length && selectedCard === "saver") view.append(element("p", "No cards yet. Press + to add one."));
}
function render() {
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
async function visualMode() {
  if (yamlMode) config = (await api("parse", {yaml: $("yaml").value})).config;
  yamlMode = false; $("yaml-view").hidden = true; $("preview-view").hidden = true; $("visual").hidden = false;
  $("visual-tab").setAttribute("aria-pressed", "true"); $("yaml-tab").setAttribute("aria-pressed", "false");
  $("preview-tab").setAttribute("aria-pressed", "false"); render();
}
async function load() {
  const data = await api("config"); revision = data.revision; cardTypes = data.cardTypes;
  $("yaml").value = data.yaml; yamlMode = true;
  try { await visualMode(); } catch (error) {
    $("yaml-view").hidden = false; $("visual").hidden = true;
    message(`Configuration needs repair: ${error.message}`, true); return;
  }
  dirty = false; $("dirty").textContent = ""; message("Configuration loaded. Changes stay in your draft until saved.");
}
function bind(id, fn) { $(id).onclick = async () => { try { await fn(); } catch (error) { message(error.message, true); } }; }
bind("visual-tab", visualMode);
bind("yaml-tab", async () => {
  $("yaml").value = await draftYaml(); yamlMode = true; $("visual").hidden = true; $("yaml-view").hidden = false;
  $("preview-view").hidden = true;
  $("visual-tab").setAttribute("aria-pressed", "false"); $("yaml-tab").setAttribute("aria-pressed", "true");
  $("preview-tab").setAttribute("aria-pressed", "false");
});
bind("preview-tab", async () => {
  const text = await draftYaml(); // the current draft, from whichever editor was used last
  $("visual").hidden = true; $("yaml-view").hidden = true; $("preview-view").hidden = false;
  $("visual-tab").setAttribute("aria-pressed", "false"); $("yaml-tab").setAttribute("aria-pressed", "false");
  $("preview-tab").setAttribute("aria-pressed", "true");
  await window.showPreview(text, selected);
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
  $("yaml-view").hidden = false; $("visual").hidden = true; $("preview-view").hidden = true;
  $("visual-tab").setAttribute("aria-pressed", "false"); $("yaml-tab").setAttribute("aria-pressed", "true");
  $("preview-tab").setAttribute("aria-pressed", "false");
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
