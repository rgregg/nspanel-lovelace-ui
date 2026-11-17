"use strict";
// Type-ahead Home Assistant entity field. Falls back to a plain text field when the entity list is unavailable.
(() => {
  const FRESH_MS = 60000, MAX_OPTIONS = 50;
  let cache = null, loadedAt = 0, loading = null;
  function loadEntities(force) {
    if (!force && cache && cache.length && Date.now() - loadedAt < FRESH_MS) return Promise.resolve(cache);
    loading ||= api(force ? "entities?refresh=1" : "entities").then(data => data.entities || [], () => [])
      .then(list => { cache = list; loadedAt = Date.now(); loading = null; return list; });
    return loading;
  }
  function create({value, domains, onChange, label}) {
    const wrap = element("div", undefined, "picker");
    const input = element("input"), list = element("ul", undefined, "picker-list");
    input.type = "text"; input.value = value || ""; input.autocomplete = "off"; input.spellcheck = false;
    input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-label", label || "Entity"); input.placeholder = "Search entities";
    list.setAttribute("role", "listbox"); list.hidden = true;
    wrap.append(input, list);
    let showAll = !domains, entities = [], active = -1, shown = [];
    if (domains) {
      const box = element("label", "Show all entities", "picker-all"), check = element("input");
      check.type = "checkbox"; check.onchange = () => { showAll = check.checked; refresh(); };
      box.prepend(check); wrap.append(box);
    }
    function close() { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; }
    function choose(entity) { input.value = entity.entity_id; close(); onChange(entity.entity_id); }
    function highlight() {
      [...list.children].forEach((item, i) => item.setAttribute("aria-selected", String(i === active)));
      if (list.children[active]) list.children[active].scrollIntoView({block: "nearest"});
    }
    function refresh() {
      if (!entities.length) { close(); return; }  // no list available: behave as a plain text field
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      shown = entities.filter(e => (showAll || !domains || domains.includes(e.domain))
        && words.every(w => e.entity_id.toLowerCase().includes(w) || e.name.toLowerCase().includes(w))).slice(0, MAX_OPTIONS);
      list.replaceChildren();
      shown.forEach((entity, i) => {
        const item = element("li", undefined, "picker-option");
        item.setAttribute("role", "option"); item.setAttribute("aria-selected", "false");
        item.append(element("span", entity.name), element("small", entity.entity_id));
        item.onmousedown = event => { event.preventDefault(); choose(entity); };
        list.append(item);
      });
      active = shown.length ? 0 : -1; highlight();
      list.hidden = !shown.length; input.setAttribute("aria-expanded", String(shown.length > 0));
    }
    input.onfocus = async () => { entities = await loadEntities(false); refresh(); };
    input.oninput = () => refresh();
    input.onchange = () => onChange(input.value.trim());
    input.onblur = () => close();
    input.onkeydown = event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (list.hidden) { refresh(); } else if (shown.length) { active = (active + (event.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length; highlight(); }
        event.preventDefault();
      } else if (event.key === "Enter" && !list.hidden && shown[active]) { choose(shown[active]); event.preventDefault(); }
      else if (event.key === "Escape" && !list.hidden) { close(); event.preventDefault(); }
    };
    return wrap;
  }
  window.EntityPicker = {create, loadEntities};
})();
