"use strict";
// Icon chooser: a searchable grid of every icon the panel's font can draw. Icons are stored as "mdi:<name>".
(() => {
  let names = null;
  async function loadNames() {
    if (names && names.length) return names;
    try { names = (await api("icons")).icons || []; } catch (error) { names = []; }
    return names;
  }
  // Resolves with the chosen icon name, or null when the dialog is cancelled.
  function choose(currentName) {
    const dialog = $("icon-dialog"), grid = $("icon-grid"), search = $("icon-search"), count = $("icon-count");
    search.value = ""; grid.replaceChildren(); count.textContent = "Loading icons...";
    return new Promise(resolve => {
      let finished = false, all = [];
      const done = value => { if (finished) return; finished = true; if (dialog.open) dialog.close(); resolve(value); };
      dialog.onclose = () => done(null);
      $("icon-cancel").onclick = () => done(null);
      function draw() {
        const shown = EditorModel.filterIcons(all, search.value);
        grid.replaceChildren();
        for (const name of shown) {
          const cell = element("button", undefined, "icon-cell");
          cell.type = "button"; cell.title = name; cell.setAttribute("aria-label", name);
          cell.setAttribute("aria-pressed", String(name === currentName));
          cell.append(element("span", undefined, `mdi mdi-${name}`), element("small", name));
          cell.onclick = () => done(name);
          grid.append(cell);
        }
        count.textContent = all.length
          ? (shown.length ? `Showing ${shown.length}. Type to narrow the list.` : "No icons match.")
          : "The icon list is unavailable. Type an icon name and press Enter.";
      }
      search.oninput = draw;
      search.onkeydown = event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const typed = search.value.trim().toLowerCase();
        if (all.length ? all.includes(typed) : typed) done(typed);
      };
      dialog.showModal(); search.focus();
      loadNames().then(list => { if (finished) return; all = list; draw(); });
    });
  }
  // A button showing the current icon; clicking it opens the chooser. Templates ("ha:...") are shown as text and kept.
  function field({value, onChange, label}) {
    const wrap = element("div", undefined, "icon-field"), name = EditorModel.iconName(value);
    const open = element("button", undefined, "icon-choose");
    open.type = "button";
    open.setAttribute("aria-label", `${label || "Icon"}: ${value ? name || value : "none"}. Choose icon`);
    if (name) open.append(element("span", undefined, `mdi mdi-${name}`));
    open.append(element("small", name || value || "Choose icon"));
    open.onclick = async () => { const picked = await choose(name); if (picked) onChange(EditorModel.iconValue(picked)); };
    wrap.append(open);
    if (value) {
      const reset = iconButton("restore", "Use the default icon", () => onChange(""), "icon-reset");
      wrap.append(reset);
    }
    return wrap;
  }
  window.IconPicker = {choose, field, loadNames};
})();
