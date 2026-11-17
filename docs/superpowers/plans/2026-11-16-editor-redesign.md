# Editor redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, in-session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rebuild the add-on's Visual editor: panel selector on top, editable panel name, card tabs plus one editor for the selected card, a card-type gallery with real thumbnails, per-type options, an HA entity picker, icon buttons, and finally a sticky live preview beside the editor.

**Architecture:** Backend gains two read-only data sources served through the existing localhost preview server and proxied by `web.py`: the full HA entity list and card-type thumbnails (rendered by `preview.py` from fixed sample entities). The frontend stays buildless (plain scripts, no inline code, CSP-safe). Pure editing logic lives in `editor-model.js` so it can be unit-tested with node; DOM code in `editor.js`, `entity-picker.js`, `card-gallery.js`, `card-info.js`; drawing stays in `preview.js`, which now exposes `window.NSPreview`.

**Tech Stack:** Python 3 (stdlib http.server, unittest), plain JS, Playwright (existing `tests/test_editor_browser.cjs`), node for model tests.

**Spec:** `docs/superpowers/specs/2026-11-16-editor-redesign-design.md`

## Global Constraints

- Add-on dir: `nspanel-lovelace-ui/rootfs/usr/bin/mqtt-manager` (MM). Frontend: `MM/frontend`.
- No build step, no CDN, no inline `<script>`/`<style>`/`style=` in `index.html` (tests enforce; CSP `script-src 'self'; style-src 'self'`). Every new asset must be added to the `assets` map in `web.py` `do_GET`. Setting `element.style.x` from JS is allowed (already used by preview.js).
- YAML format, card rendering and MQTT protocol unchanged; `render_preview` behaviour unchanged for existing callers.
- Round trip: open + save with no edits must not drop/reorder keys; every existing option stays editable (per-card/per-entity/per-panel "Advanced (JSON)" boxes stay).
- Only `us-p` is drawn. No Claude/AI attribution in commits, code or docs (author is Ryan Gregg; plain commit messages).
- Do NOT deploy to Home Assistant until the user says so.
- Test commands: `python3 -m unittest discover -s tests` (system python; render tests skip without deps); venv with runtime deps for the full run: `/tmp/claude-1000/-home-ryan-github-rgregg-home-docs/3b4735d1-0f46-4fee-8905-f8f93b83e2ac/scratchpad/bev/bin/python -m unittest discover -s tests`; browser: `NODE_PATH=/home/ryan/playwrite/node_modules node tests/test_editor_browser.cjs` with chromium at `~/.cache/ms-playwright/chromium-1148/chrome-linux/chrome` (the existing test shows how it launches; add `executablePath` via env if needed).

## Review Focus

- Entity picker with HA unreachable / zero entities: falls back to a plain text field, never blocks editing.
- A config whose card has keys the editor does not know: unchanged after switching card, renaming panel, moving cards.
- Renaming a panel with custom topics or to an existing/blank/`__proto__` name: custom topics kept, bad names rejected.
- Panel with zero cards, only hidden cards, or only a screensaver: strip and editor still usable.
- A thumbnail that fails to render for one card type: gallery still shows the others with a text-only tile.

---

### Task 1: Full entity list (backend)

**Files:** Modify `MM/libs/home_assistant.py`, `MM/preview_server.py`, `MM/web.py`; Test `tests/test_preview_server.py` (+ `tests/test_entity_list.py`).

**Interfaces:**
- Produces: `libs.home_assistant.list_entities(timeout=5.0) -> list[dict]` each `{"entity_id": str, "name": str, "domain": str}` sorted by entity_id; `[]` when not connected, on timeout or error. Uses `send_message({"type":"get_states"}, pending={"event": Event(), "result": None, "error": None})` (same pattern as `execute_script`; pending has no `kind`, so the result handler pops it and sets the event; the live cache is NOT replaced). `name` = `attributes.friendly_name` or the entity_id.
- Produces: preview server `POST /entities` (token required, body `{"refresh": bool}`) -> `{"entities": [...]}`; cached in the server for 60 s unless `refresh`. `make_server(port, token, render=..., entities=_default_entities, thumbnails=...)`.
- Produces: `GET /api/entities` in `web.py` -> proxy via `forward_preview`-style helper `forward_backend(path, body)` (refactor `forward_preview` onto it; keep `forward_preview` name working); `?refresh=1` passes refresh.

- [ ] Write failing tests: `list_entities` with a fake `send_message` that fires the pending event with a `get_states` result (entities with/without friendly_name; sorted; domain derived); returns `[]` when `send_message` returns None and on timeout; preview server `/entities` requires token (403 without), caches (callable invoked once for two calls, twice with refresh); web `/api/entities` returns 503 JSON when the backend is down.
- [ ] Run them, confirm failures.
- [ ] Implement `list_entities`, the `/entities` handler (injectable `entities` callable, time-based cache), and the web proxy route (GET and POST are both fine; GET is what the frontend uses).
- [ ] Run the full suite (venv + system python). Commit "Add entity list endpoint for the editor".

### Task 2: Card-type thumbnails (backend)

**Files:** Modify `MM/preview.py`, `MM/preview_server.py`, `MM/web.py`; Test `tests/test_preview_render.py`, `tests/test_preview_server.py`.

**Interfaces:**
- Produces: `preview.SAMPLES: dict[str, dict]` one sample card config per `config_manager.CARD_TYPES` (using ids `light.preview_sample_1` etc. plus matching fake states in `SAMPLE_STATES`), and `preview.render_thumbnails() -> {card_type: {"type","commands","icons","errors"}}`. It temporarily inserts `SAMPLE_STATES` into `libs.home_assistant.home_assistant_entity_state_cache` (under a lock, removed in `finally`), builds one card per type via the existing `_build`/`_safe_render` path with `wait_seconds=0`, and never lets one type's failure affect others (that type maps to `{"commands": [], "icons": {}, "errors": [msg]}`). Result includes top-level `"time"`/`"date"` strings are NOT needed (thumbnails are cards only; screensaver is not a card type here).
- Produces: preview server `POST /thumbnails` -> `render_thumbnails()` result, computed once and cached in memory; `GET /api/thumbnails` in `web.py` proxies it.

- [ ] Failing tests (render tests skip without deps): every type in `CARD_TYPES` has a result with a non-empty `entityUpd~`-style or card command list (print one command string per type to check the expected prefix: `entityUpd~` for entities/grid, the type's own update command for others, confirm against `ha_cards.py`); sample ids are absent from the cache after the call (even if a render raises: patch one card class to raise); a raising type does not remove others; preview server `/thumbnails` requires token and calls the callable once for two requests.
- [ ] Run, confirm failures.
- [ ] Implement `SAMPLES`, `SAMPLE_STATES`, `render_thumbnails`, server route, web proxy.
- [ ] Run suites; commit "Add card thumbnail rendering for the editor".

### Task 3: Editor model (pure logic) and card info

**Files:** Create `MM/frontend/editor-model.js`, `MM/frontend/card-info.js`, `tests/test_editor_model.cjs`; Modify `tests/test_config_editor.py` (a test that runs the node file when `node` exists, else skips); Modify `MM/web.py` assets.

**Interfaces (`editor-model.js`, plain script that sets `window.EditorModel` in browsers and `module.exports` under node):**
- `validPanelName(name, panels) -> string|null` (error text or null): non-empty after trim, not in `{__proto__, constructor, prototype}`, not already a key.
- `renamePanel(config, oldName, newName) -> void`: rebuilds `config.nspanels` preserving key order with the new key in the same position; rewrites `panelRecvTopic`/`panelSendTopic` only when equal to `tele/<old>/RESULT` / `cmnd/<old>/CustomSend`.
- `newPanel(name) -> object`: same shape as today's add-panel but `model: "us-p"`.
- `cardList(panel) -> [{key:"cards"|"hiddenCards", index, card}]` visible first then hidden.
- `moveCard(panel, key, index, delta)`; `setHidden(panel, key, index, hidden) -> {key,index}` moves the card between arrays (creates arrays as needed, removes nothing else); `addCard(panel, type) -> {key,index}`; `deleteCard(panel, key, index)`.
- `domainsFor(cardType) -> string[]|null` (null = any).
**Interfaces (`card-info.js`, sets `window.CARD_INFO`/module.exports):** `{cardEntities:{label,summary,domains,fields,entityList:true}, ...}` for all 8 `CARD_TYPES`, one plain sentence each (see the gallery sketch in the spec conversation: Entities = list of up to 6 things; Grid = big icon buttons; Thermostat; Media; Alarm; Unlock; Power; QR code). `fields` is the ordered list of `{key,label,kind:"entity"|"text"|"select"|"multi"|"font",options?}` the card type needs; derive from `ha_cards.py` (QR `qrCode`; Thermostat `entity`,`supported_modes`; Alarm `entity`,`supported_modes`; Unlock `entity`+`destination`; Media `entity`; Power entities with per-entity `speed`; Grid `font`; Entities/Grid/Power `entityList`, `navItem1`, `navItem2`). Audit `ha_cards.py` for each class and correct this list; record findings in the commit message.

- [ ] Write `tests/test_editor_model.cjs` (node `assert`): rename keeps order and unknown keys, rewrites default topics only, keeps custom topics, rejects dup/blank/`__proto__`; moveCard bounds; setHidden moves between arrays and keeps card object identity and unknown keys; addCard creates arrays; newPanel defaults; `domainsFor`; every `CARD_TYPES` entry has CARD_INFO with non-empty summary.
- [ ] Run (`node tests/test_editor_model.cjs`), confirm failing, implement both files, pass.
- [ ] Add both scripts to `web.py` assets and `index.html` script tags (before `editor.js`); extend `PreviewTabStaticTests`-style static test to check they are served and referenced.
- [ ] Commit "Editor model and card info".

### Task 4: Entity picker component

**Files:** Create `MM/frontend/entity-picker.js`; Modify `style.css`, `web.py` assets, `index.html`; Test `tests/test_editor_browser.cjs` (new section) and `tests/test_entity_picker_static.py` if needed.

**Interfaces:** `window.EntityPicker.create({value, domains, onChange(entityId), label}) -> HTMLElement`. Loads the list once via `api("entities")` (module cache; refresh on focus after 60 s). A text input with a dropdown list (ARIA combobox: `role=combobox`, `aria-expanded`, `role=listbox`/`option`, Up/Down/Enter/Escape). Shows `name` and `entity_id`, filter matches either, limited to `domains` unless the "show all" checkbox is on; a typed value not in the list is allowed (kept as written). If the list is empty or the call fails, it renders as a plain text input and shows no dropdown.

- [ ] In the browser test, stub `/api/entities` via `page.route` (the test server has no preview backend) to return 3 entities; assert typing "lamp" shows the matching option, Enter selects, `onChange` value ends up in the YAML, and with the route returning 503 the control is a plain input that still accepts text.
- [ ] Implement, style (dark-mode tokens already in style.css), run test, commit "Add entity picker".

### Task 5: Page shell, panel header, card strip, card editor

**Files:** Modify `MM/frontend/index.html`, `editor.js`, `style.css`; Test `tests/test_editor_browser.cjs` (update existing flow), `tests/test_config_editor.py` static checks.

**Behaviour (replaces `render()` and `renderCards()`; keep `field`, `advanced`, `api`, YAML/import/save logic):**
- Remove `<aside>`; the top bar has panel `<select aria-label="Panel">`, `New panel` and `Import YAML` icon+text buttons, plus Reload/Export/Save & apply as today. New panel = inline name field (no `prompt()`), validated with `EditorModel.validPanelName`, created with `EditorModel.newPanel`.
- Panel header: name is a heading with a pencil `button[aria-label="Rename panel"]` that turns it into an input (Enter/blur applies via `renamePanel`, Escape cancels, errors via `message()`); "Advanced" `<details>` (collapsed) holds the existing panel fields, firmware field, and "All panel options (JSON)"; Delete panel stays there.
- Card strip: tabs from `EditorModel.cardList(panel)` plus a `Screensaver` tab and a `+` button; selected tab `aria-pressed`; hidden cards get a "hidden" marker; each tab has no drag (up/down arrow icon buttons on the selected card's header; drag is out of scope this task).
- Card editor for the selected card: header = title as heading with pencil rename (same pattern), a type button showing the current type label (opens the gallery in Task 6; for now it is a `<select>`), a hidden checkbox ("Hidden card", uses `setHidden`), move-left/right and delete icon buttons (aria-labels "Move card earlier", "Move card later", "Delete card"). Below: the Entities editor with icon-only add (`+`, aria-label "Add entity") and remove (`🗑`/SVG-free text glyph in a button with aria-label "Remove entity") buttons; each entity row = entity input (plain text field until Task 4's picker is wired in Task 7), name field with pencil-less inline edit, and a per-row `<details>` "Advanced" containing the remaining entity keys (icon, color, state, state_not, status, etc.) as a JSON textarea using the existing `advanced()` helper (object = the entity).
- Selection state: `selected` (panel name), `selectedCard` = `{key,index}` or `"saver"`; clamp after any change; empty panel shows "No cards yet. Press + to add one.".
- Mobile: top bar wraps, strip scrolls horizontally, no horizontal page scroll.

- [ ] Update `test_editor_browser.cjs` to the new UI (panel selector instead of rail buttons, Locale now under Advanced: open the details first; rename a panel and confirm the YAML key and default topics changed; add a card via `+`; switch to hidden and back; remove an entity via its icon button; viewport 390 has no horizontal scroll; no page errors).
- [ ] Run it, confirm failure; implement; confirm pass. Run all Python suites.
- [ ] Commit "Redesign the visual editor layout".

### Task 6: Card-type gallery with thumbnails

**Files:** Create `MM/frontend/card-gallery.js`; Modify `preview.js` (expose `window.NSPreview = {drawCard(card, context) -> HTMLElement, loadLayout}`; `context = {icons, time, date}`; refactor so module-level `data` is set from `context` for the synchronous draw only), `index.html` (a `<dialog id="card-gallery">`), `style.css`, `web.py` assets; Test browser test.

**Interfaces:** `window.CardGallery.choose(currentType) -> Promise<string|null>` opens the dialog with a tile per `CARD_INFO` type: scaled-down (CSS `transform: scale(.4)` wrapper) screen from `NSPreview.drawCard` using `GET api/thumbnails`; label + `summary`; current type marked; Escape/Cancel resolves null. A type whose thumbnail has errors or no commands shows a text-only tile. Used by the `+` button (new card gets `type` and default title from the label) and by the type button in the card editor (changing type only changes `type`; other keys untouched, then re-render).

- [ ] Browser test with `page.route` stubs for `/api/thumbnails` (two types with simple commands) and `/api/entities`: `+` opens the gallery, choosing Grid adds a card of type `cardGrid`; the type button on an existing card opens it and keeps the other keys.
- [ ] Implement; confirm pass; commit "Add card type gallery".

### Task 7: Per-type options and entity picker wiring

**Files:** Modify `editor.js`, `card-info.js`; Test `tests/test_editor_browser.cjs`, `tests/test_editor_model.cjs`.

- [ ] For the selected card render `CARD_INFO[type].fields` only: `entity` -> `EntityPicker` with `domainsFor(type)`, `text` -> input, `select`/`font` -> select, `multi` (`supported_modes`) -> checkbox group; `entityList` -> the entity rows from Task 5 with `EntityPicker` as the entity control. Keys on the card that no field covers stay in the config and are visible in the card's "Advanced (JSON)" box (kept, collapsed).
- [ ] Tests: a QR card shows only the QR field (no entity list); a thermostat shows entity + modes; switching type from Entities to QR keeps `entities` in the YAML and in the JSON box; node test that `fields` keys exist for every type.
- [ ] Commit "Per-card-type options".

### Task 8: Sticky live preview beside the editor (final milestone)

**Files:** Modify `index.html`, `editor.js`, `preview.js`, `style.css`; Test browser test.

- [ ] Replace the Preview tab: `#preview-pane` sits right of the editor (CSS grid, sticky, `top:16px`), visible only in Visual mode; below 1100 px it stacks under the editor. It shows the selected card (or the screensaver tab) of the selected panel via `NSPreview`; data comes from `POST api/preview` with `draftYaml()` after a 600 ms debounce following `changed()` or selection changes (latest request wins; show "Preview unavailable" text on error without blocking editing). Remove the Preview tab button and the old `showPreview` entry; keep a small Refresh icon button in the pane.
- [ ] Browser test with `page.route` stub for `/api/preview` returning a minimal card: pane appears next to the editor at 1360 px, stacks at 390 px, changes when another tab is selected, and an error response shows the message.
- [ ] Commit "Show the preview beside the card editor".

### Task 9: Docs and final verification

- [ ] Update `docs-standalone/docs/configuration.md` (editor layout, gallery, picker, preview pane; replace the Preview tab section) and `nspanel-lovelace-ui/CHANGELOG.md`.
- [ ] Run every Python suite (venv + system), `node tests/test_editor_model.cjs`, the browser test, and a headless screenshot at 1360 px and 390 px of the new editor against a local fake HA cache (reuse the approach in earlier scratch scripts); look at them.
- [ ] Commit "Document the editor redesign"; push `editor-redesign`. Report; wait for the user before merging to the test branch or deploying.
