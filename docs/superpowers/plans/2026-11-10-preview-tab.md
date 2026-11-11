# Preview Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Preview" tab to the add-on editor that draws the draft config's `cardEntities`, `cardGrid` and screensaver as the 320x480 `us-p` panel would, using live Home Assistant states.

**Architecture:** The main process (which holds the HA state cache) runs the real `card_factory` / `Screensaver` code against a fake panel that captures the commands instead of sending them, and exposes the result on a localhost-only endpoint. `web.py` proxies `POST /api/preview` to it. The browser draws the captured commands using a layout JSON generated from the HMI project sources.

**Tech Stack:** Python 3.12 backend (stdlib `http.server`, PyYAML, existing `ha_cards`), plain JS/CSS frontend, `unittest`, bundled Material Design Icons webfont.

**Spec:** `docs/superpowers/specs/2026-11-10-preview-tab-design.md`

## Global Constraints

- Work on branch `preview-tab`; commits authored as Ryan Gregg with NO Claude attribution or Co-Authored-By lines.
- Editor CSP is `default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'`: no inline `<script>`/`<style>`/`style=` attributes in markup, no CDN. Setting `element.style.x` from JS and local `@font-face` are fine.
- The preview must never put anything on the real panel's MQTT queue.
- Model `us-p` only in v1, but the layout JSON is keyed by model name.
- Existing suite (76 tests) stays green; run with `python -m unittest discover -s tests -v` from the repo root.
- Rendered content comes from the add-on's card code, never a parallel implementation.
- If the HMI sources cannot be parsed in Task 1, STOP and bring the fallback to the user.

## Review Focus

- Invalid draft YAML or a card the factory rejects: a readable error/skip note in the response, never a 500.
- Panel with no `cards`, or no `screensaver` key: empty lists, no crash.
- Entity not yet received or `unavailable`: card renders with the placeholder text the real card would send; request returns within the bounded wait.
- A `cardGrid` with more than 6 entities becomes `cardGrid2` (different layout) and must use that layout.
- Request over 1 MiB, wrong content type, missing editor auth, or missing/incorrect internal token: rejected like the other endpoints.

## File Structure

- Create `scripts/gen_preview_layout.py`: parses `HMI/US/portrait/n2t-out-visual/*.txt` into layout JSON.
- Create `nspanel-lovelace-ui/rootfs/usr/bin/mqtt-manager/frontend/layouts/us-p.json`: generated output (committed).
- Create `.../mqtt-manager/preview.py`: offline rendering (`PreviewPanel`, `render_preview`).
- Create `.../mqtt-manager/preview_server.py`: localhost endpoint thread + token.
- Modify `.../mqtt-manager/main.py`: start the endpoint after panels are set up.
- Modify `.../mqtt-manager/web.py`: `/api/preview` proxy and static routes for the new assets.
- Modify `.../mqtt-manager/frontend/index.html`, `editor.js`, `style.css`; create `frontend/preview.js`, `frontend/fonts/`.
- Create `tests/test_preview_layout.py`, `tests/test_preview_render.py`, `tests/test_preview_server.py`.
- Modify `docs-standalone/docs/configuration.md` (or a new short page), `nspanel-lovelace-ui/CHANGELOG.md`.

### Task 1: HMI layout generator (spike first)

**Files:**
- Create: `scripts/gen_preview_layout.py`, `.../frontend/layouts/us-p.json`
- Test: `tests/test_preview_layout.py`

**Interfaces:**
- Produces: `parse_page(text: str) -> dict` returning `{"name", "width", "height", "bco", "components": [{"name", "type", "x", "y", "w", "h", "font", "pco", "bco", "xcen", "ycen", "value"?}]}` (keys present only when the source has them); `build_layout(hmi_dir: Path) -> dict` returning `{"us-p": {pageName: page}}` for `cardEntities`, `cardGrid`, `cardGrid2`, `screensaver` and the screensaver page the portrait model uses.
- Consumed by: Task 4 (`frontend/layouts/us-p.json`).

- [ ] **Step 1: Spike.** Read `HMI/US/portrait/n2t-out-visual/cardEntities.txt` and confirm per-component `x coordinate`, `y coordinate`, `Width`, `Height`, `Font ID`, `Font Color`, `Back. Color`, alignment are present. If not parseable, stop and report to the user.
- [ ] **Step 2: Write failing tests** in `tests/test_preview_layout.py`: `parse_page` on a trimmed excerpt returns `tEntity1` with the exact x/y/w/h from the file; page width is 320; `cardEntities` has components `tHeading`, `tIcon1`..`tIcon6`, `tEntity1`..`tEntity6`, `bPrev`, `bNext`; a test that `build_layout(HMI_DIR)` equals the committed `us-p.json` (drift test); skipped with a clear message if `HMI/` is absent.
- [ ] **Step 3: Run tests, confirm they fail.** `python -m unittest tests.test_preview_layout -v`
- [ ] **Step 4: Implement** `parse_page`, `build_layout`, and a `__main__` that writes the JSON with sorted, indented keys. Record in the script docstring which components are shown per entity `type` slot, taken from the page's `entityUpd` reparse handling (types such as light/text/button/shutter/number); keep that table in the JSON under `"slotRules"`.
- [ ] **Step 5: Generate JSON, run all layout tests, expect PASS.**
- [ ] **Step 6: Commit** `Add HMI layout generator for preview`.

### Task 2: Offline renderer

**Files:**
- Create: `.../mqtt-manager/preview.py`
- Modify: `.../mqtt-manager/panel.py` (extract time/date formatting into pure functions without changing behaviour)
- Test: `tests/test_preview_render.py`

**Interfaces:**
- Produces: `render_preview(draft_yaml: str, panel_name: str | None = None, wait_seconds: float = 2.0) -> dict` returning `{"panels": [names], "panel": name, "model": str, "cards": [{"iid", "type", "title", "commands": [str], "hidden": bool}], "screensaver": {"commands": [str]}, "time": str, "date": str, "errors": [str]}`. Never raises for bad input; problems go in `errors`.
- Produces: `format_time_text(settings, now) -> str` and `format_date_text(settings, now) -> str` in `panel.py`, used by `LovelaceUIPanel.update_time/update_date` and by the preview.
- Consumes: `ha_cards.card_factory(locale, settings, panel)`, `ha_cards.Screensaver`, `libs.home_assistant.track_entity` / `get_entity_data`.

- [ ] **Step 1: Write failing tests** (import via `importlib` with stubbed `websocket` like `tests/test_entity_subscription.py`, pre-fill `home_assistant_entity_state_cache`): a draft with one `cardEntities` Lights card returns a command starting `entityUpd~` containing the title and `light.interior_lights` state; a draft with a `cardGrid` of 7 entities returns type `cardGrid2`; invalid YAML returns a non-empty `errors` and no cards; unknown card type is skipped with an error note; no `screensaver` key returns empty commands; a missing entity still returns within `wait_seconds` plus 0.5 s; the real `msg_out_queue` of any live panel is never touched (use a sentinel queue and assert it is empty).
- [ ] **Step 2: Run, confirm fail.** `python -m unittest tests.test_preview_render -v`
- [ ] **Step 3: Implement** `PreviewPanel` exposing the attributes `ha_cards` and `panel_cards` read from a panel (name, settings, `msg_out_queue` = capturing list-like with `put`, `sendTopic`, `model`, `temp_unit`, `navigate_keys`, `entity_iids`, plus the iid_prev/iid_next wiring done in `LovelaceUIPanel.__init__`), without starting its scheduler, firmware updater or startup page. Discover the exact attribute list by running the tests. Call `track_entity` for each configured entity, wait up to `wait_seconds` for values, then call `card.render()` and collect commands.
- [ ] **Step 4: Refactor `panel.py`** time/date into the two pure functions; run the full suite to confirm no behaviour change.
- [ ] **Step 5: Run all tests, expect PASS.**
- [ ] **Step 6: Commit** `Add offline renderer for editor preview`.

### Task 3: Localhost endpoint and editor proxy

**Files:**
- Create: `.../mqtt-manager/preview_server.py`
- Modify: `.../mqtt-manager/main.py`, `.../mqtt-manager/web.py`
- Test: `tests/test_preview_server.py`

**Interfaces:**
- Produces: `start_preview_server(port: int = 8098, token_path: str = "/tmp/nspanel-preview.token") -> threading.Thread`; binds 127.0.0.1 only; `POST /render` with header `X-Preview-Token` and JSON `{"yaml": str, "panel": str | None}` returns `render_preview(...)` JSON; 403 on bad/missing token, 400 on bad body or >1 MiB.
- Produces: `web.py` route `POST /api/preview` (same auth, content-type and size checks as `do_POST`) that forwards to the endpoint with the token read from `token_path` and returns its JSON; 503 with a clear message if the main service is not up.
- Consumes: `preview.render_preview`.

- [ ] **Step 1: Write failing tests**: token file created with mode 0600 and non-empty; correct token returns the render JSON; wrong token returns 403; server socket address is `127.0.0.1`; oversized body returns 400; `web.py` handler returns 503 when the endpoint is down and 401/403 without editor auth (reuse the handler construction style of existing web tests if any, otherwise build the handler with `handler_for`).
- [ ] **Step 2: Run, confirm fail.**
- [ ] **Step 3: Implement** `preview_server.py` (stdlib `ThreadingHTTPServer`, `hmac.compare_digest` on the token); start it from `main.py` after `setup_panels()` (daemon thread; failure to bind logs a warning and does not stop panels); add the proxy and static routes (`/preview.js`, `/layouts/us-p.json`, `/fonts/<file>`) to `web.py`.
- [ ] **Step 4: Run tests, expect PASS; run full suite.**
- [ ] **Step 5: Commit** `Add preview endpoint and editor proxy`.

### Task 4: Preview tab in the editor

**Files:**
- Create: `.../frontend/preview.js`, `.../frontend/fonts/materialdesignicons-webfont.woff2`, `.../frontend/fonts/LICENSE-mdi.txt`
- Modify: `.../frontend/index.html`, `.../frontend/editor.js`, `.../frontend/style.css`
- Test: `tests/test_preview_layout.py` (static checks) plus a manual browser check

**Interfaces:**
- Consumes: `POST api/preview` (Task 3 response shape), `frontend/layouts/us-p.json` (Task 1), existing `draftYaml()` in `editor.js`.
- Produces: `renderPreview(container, response, layout)` in `preview.js`; a "Preview" tab button (`id="preview-tab"`) and `#preview-view` panel, with panel selector, Prev/Next card controls, screensaver entry and Refresh.

- [ ] **Step 1: Write failing static tests**: `index.html` contains `id="preview-tab"`; no inline `<script>`, `style=` attribute or CDN URL in `index.html`; the font file and license exist; `style.css` references the font with a relative URL.
- [ ] **Step 2: Run, confirm fail.**
- [ ] **Step 3: Implement** the tab, wiring it into the existing tab switching in `editor.js`, and `preview.js`: positions elements from layout JSON at 1:1 on a 320x480 box (scalable by CSS transform set from JS), shows the `entityUpd` slots by parsing the `~`-separated fields using the field order the card code emits (confirm against `HMI/README.md` and `panel_cards.Entity.render`), icons via the bundled MDI font using a char-to-name inverse of `libs/icon_mapping.py` supplied in the response as `iconName`, errors shown in the existing message area.
- [ ] **Step 4: Run static tests, expect PASS.**
- [ ] **Step 5: Manual check** with a local run against a fake config, screenshots of the three card kinds, compare to HMI geometry (record in the PR description, not committed).
- [ ] **Step 6: Commit** `Add Preview tab to the editor`.

### Task 5: Docs, changelog, and test build

**Files:**
- Modify: `docs-standalone/docs/configuration.md`, `nspanel-lovelace-ui/CHANGELOG.md`

- [ ] **Step 1:** Document the Preview tab (what it shows, limits: only entities/grid/screensaver, approximate fonts, `us-p` only, previews stay subscribed until restart).
- [ ] **Step 2:** Add a CHANGELOG entry.
- [ ] **Step 3:** Run the full suite; expect all green.
- [ ] **Step 4: Commit** `Document the Preview tab`; push `preview-tab` to origin. Do NOT deploy to Home Assistant until the user says to.
