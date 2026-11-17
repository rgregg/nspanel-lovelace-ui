# Editor redesign (Visual editor) - design

Date: 2026-11-16. Status: draft for review. Branch: `editor-redesign` (from `preview-tab`).

## Why

The add-on's web editor works but is awkward. The author (the add-on's main user) and
anyone who has never touched YAML should be able to build a panel without reading docs.
Audience: mostly the author, friendly to anyone.

## Goals

1. Replace the left rail ("Your panels") with a panel selector at the top of the page,
   next to **New** and **Import** actions.
2. Make the panel name editable (rename). Hide the panel-level advanced options
   (model, topics, formats, etc.) behind a collapsed "Advanced" section.
3. Adding a card or changing its type opens a gallery of the card types. Each tile shows a
   thumbnail of the real panel screen and one plain sentence on what the card is for.
4. Each card shows only the options that card type needs.
5. Entity fields are type-ahead pickers over the user's real Home Assistant entities
   (friendly name plus entity id), like Home Assistant's own picker.
6. Add and remove entity (and card) are small icon buttons, not text buttons.
7. A card's title is the card's header, editable in place with a pencil icon.
8. After 1-7 are done, the Preview moves from its own tab to a sticky panel on the right of
   the card editor.

## Non-goals

- No change to the YAML format, to how the add-on renders cards, or to the MQTT protocol.
- No change to the YAML editor tab, import/export, or save/revision conflict handling.
- Only the US portrait (`us-p`) model is drawn in previews/thumbnails (as today).
- No new card types.

## Anti-goals (failure even if it technically works)

- Config the user already has must round-trip unchanged: opening and saving without edits
  must not drop or reorder unknown keys.
- Hidden advanced options must still be fully reachable (every existing option stays
  editable; nothing becomes YAML-only that is editable today).
- No external network calls or CDN assets (the add-on is self-contained, as the Preview is).

## Decisions (made with the author)

- Layout: top bar (panel dropdown, New, Import, Save & apply) -> panel header (editable name
  with pencil, collapsed "Advanced") -> a **strip of card tabs** across the top with a + at
  the end -> **one editor for the selected card** -> preview on the right (item 8).
  (Author first saw a left card list vs a top strip; chose "list of cards then a single editor";
  the strip was picked by the assistant as its call; swapping to a vertical list is cheap.)
- Card type gallery uses **real thumbnails** (the preview engine with sample data), not icons.
- Per-entity settings beyond entity and name (icon, colour, state filter, etc.): all remain
  accessible but under an "Advanced" disclosure on each entity row.

## Assistant's calls (builder may adjust; flag if you do)

- Renaming a panel rewrites its key under `nspanels:` and updates the selector; the name must
  be unique and non-empty.
- Card tabs can be reordered by drag; the screensaver is a fixed final tab, not draggable.
- The entity picker is filtered to the domains each card type supports, with a "show all"
  toggle. Entities come from the add-on's existing Home Assistant state cache via a new
  read-only endpoint; if HA is unreachable the picker falls back to a plain text field.
- Per-type option sets are derived from what `ha_cards.py` reads for each card (e.g. QR:
  `qrCode`; Thermostat/Alarm: entity and `supported_modes`; Unlock: `destination`; Grid:
  `font`; Entities/Grid: entities and `navItem1`/`navItem2`; Screensaver: type, entities,
  `theme`, `statusIcon1`/`statusIcon2`). Options a type does not use are not shown; anything
  already present in the config but not shown must still be preserved.
- Thumbnails are rendered from the preview engine with fixed sample entities, so they do not
  depend on the user's HA data. They may be generated at build time or on first use and cached.
- Mobile/narrow screens: the preview stacks under the editor.

## Left to the builder

Visual styling consistent with the existing editor, picker keyboard behaviour and
accessibility (labels, focus), file organisation of the frontend code, and tests.
The frontend currently has no build step and no inline script/style (Content-Security-Policy
style rules enforced by tests); keep it that way.

## Further calls from the builder check (assistant's decisions)

- **Entity source:** the picker must list every HA entity, not only the ones in the config
  (the state cache is filtered unless `track_all_entities` is set). Add a backend call that
  fetches all states once on demand over the HA websocket (`get_states`), served through the
  localhost preview server (the web process has no cache), cached briefly (about 60 s) with a
  refresh. If that fails or returns nothing, the picker is a plain text field.
- **Hidden cards:** one strip. Hidden cards appear after the visible ones with a "hidden"
  marker; each card has a "hidden" toggle that moves it between the `cards` and `hiddenCards`
  arrays. Reordering applies within each list. Up/down buttons are the no-drag fallback
  (touch included); drag is optional.
- **Round-trip:** the editor keeps editing the parsed object and serializing with the
  existing `/api/serialize` (key order kept; YAML comments are already dropped today and
  stay dropped). The per-card "Advanced options (JSON)" box stays as the escape hatch for
  anything not shown as a field.
- **Option sets:** the builder audits every card type in `ha_cards.py` for its option set and
  entity domains. An incomplete audit is acceptable only because the JSON box stays.
- **Thumbnails:** `render_preview` gains an optional sample-state input so thumbnails render
  from fixed fake entities (additive; normal rendering unchanged). Descriptions are written
  by the builder, one plain sentence each. Thumbnails are generated on first use and cached
  in memory; no build step.
- **Preview rollout:** item 8 is the last milestone of this work. The Preview tab stays until
  then, and is removed when the sticky preview lands. The sticky preview shows the selected
  card (or the screensaver) of the selected panel, in Visual mode only.
- **Rename:** rewriting the key also updates `panelRecvTopic`/`panelSendTopic` only when they
  still equal the defaults derived from the old name; custom topics are left alone. Same
  validation as the add-panel flow (non-empty, unique, no reserved names such as `__proto__`).
- **New panel:** replaces `prompt()` with an inline name field; default model `us-p` (the
  one the previews draw), shown and changeable under Advanced.
