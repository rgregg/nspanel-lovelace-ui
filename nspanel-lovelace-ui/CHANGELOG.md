## Unreleased

- Add a `buttons` panel setting (and a **Physical buttons** section in the web editor) to choose what the panel's two buttons do: toggle their own relay, run Home Assistant services on a single, double, triple or hold press, or nothing. The add-on configures Tasmota (`SetOption73` and rule 3) to match.
- Fix cards staying blank on screen firmware that never sends `event,renderCurrentPage` after a page change: the add-on now sends a card's contents about 1.5 seconds after switching to it if the screen has not asked. Set `pageRenderFallback: false` on a panel to turn this off.
- Make `screensaver: {disable: true}` return the panel to its `defaultCard` when the idle time (`sleepTimeout`) is reached, instead of only skipping the screensaver at startup. The web editor's Screensaver tab has the checkbox, the idle time and the default card.
- Fix the grid card's **Button size** having no effect: `font` set on a `cardGrid` card is now the default for all its buttons (an entity's own `font` still wins).
- Reorder entities in the web editor by dragging the grip on each row, or with the up and down buttons beside it.
- Add an icon chooser to the web editor: each entity row has an **Icon** button that opens a searchable list of the icons the panel can draw. Add a **Go to card** row type (the second plus button) that links to another card, including hidden ones, by creating the `navigate.<key>` entity and giving the target card a navigation key when it has none. The Unlock card's destination uses the same card list.
- Redesign the web editor's visual editor. Panels are chosen from a dropdown with **New panel** and **Import YAML** (the left rail is gone), panels can be renamed, and panel-wide settings sit under **Advanced panel settings**. Cards are tabs with one editor for the selected card, editable titles, and icon buttons for add, remove and reorder. Adding or changing a card type opens a gallery showing what each type looks like. Each card shows only the options its type uses, and entity fields are a searchable Home Assistant entity picker. Every option stays editable under **Advanced**.
- Show a live preview beside the card editor (replacing the separate Preview tab): `cardEntities`, `cardGrid` and the screensaver on the US portrait panel (`model: us-p`), for the draft configuration, using current Home Assistant states. Text and icons are exactly what the panel will be sent; layout follows the HMI project, while fonts and the on/off switch are approximations. Nothing is sent to the panel.
- Subscribe only to the entities used in `panels.yaml` (plus `sun.sun`, and entities looked up at runtime) instead of loading every Home Assistant state and every state change. On large installations the initial load no longer takes tens of seconds or stalls. Set `track_all_entities: true` to restore the previous behavior; it is also the automatic fallback if Home Assistant rejects the subscription.
- Restore AppDaemon `timeAdditionalTemplate` (text below the time) and `dateAdditionalTemplate` (text after the date). Both update when their template result changes.
- Support `sunrise`/`sunset` brightness schedule times, with optional offsets such as `"sunset + 1:00:00"`, from Home Assistant's `sun.sun`. One-digit hours such as `"7:00:00"` are accepted.
- Restore AppDaemon `service.<domain>.<action>` buttons with `data` and optional `status`. Only configured card items can call actions.
- Show the date in the panel's `timeZone`, like the time.
- Fix a panel startup crash when `sleepBrightness` is an entity ID and `screenBrightness` is a number.

## 4.8.10

- Show the light-detail color wheel for RGBWW lights, including WLED entities supporting both color temperature and RGBWW.
- Use Kelvin attributes and `color_temp_kelvin` for light temperature control and popup rendering, preserving cold-to-warm slider direction.
- Safely handle missing or invalid light temperature limits, with compatibility for legacy mired attributes.
- Update only the open detail popup and suppress identical payloads instead of redrawing the parent card and both light popups on every state update.

## 4.8.9

- Retry unavailable Supervisor MQTT discovery every 10 seconds instead of starting with empty settings.
- Validate MQTT host and port with actionable errors; keep the editor available while retrying. Explicit broker settings and ESPHome mode bypass discovery.

## 4.8.8

- Restore AppDaemon-compatible `state_template`: true hides an item without reserving a grid slot; false shows it.
- Refresh conditional items when templates referencing other entities change. Support bare Jinja and `ha:` templates.
- Remove outdated migration warnings for supported state filters.

## 4.8.7

- Suppress unchanged screensaver weather, theme, and status messages; force a full refresh on page entry, panel requests, and connection recovery.
- Keep sensor display precision during Home Assistant reconnects and ignore older registry responses that arrive late.

## 4.8.6

- Fix icon templates displaying an exclamation mark instead of text or embedded `<I>mdi:...</I>` icons, including screensaver status icons and empty results.

## 4.8.5

- Restore dynamic entity names, hidden-card `navItem2`, and numeric or templated `cardPower` animation speeds, including reverse flow.
- Accept safe RGB color strings from Home Assistant templates, with fallback for invalid colors.
- Serialize WebSocket request IDs and correlate responses before sending; restore template and ESPHome subscriptions after reconnects.
- Share template subscriptions and refresh displayed entities when template results change; keep QR templates dynamic across renders.
- Refresh weather forecasts in the background with shared caching, an eight-second forecast timeout, and last-good results after transient errors. Support forecast index zero.

- Omit units from sensor values displayed in the icon area of `cardGrid` and its automatic `cardGrid2` layout, restoring AppDaemon behavior.
- Keep grid sensor text shorter so units do not get clipped or crowd out the font-selection suffix sent to the TFT.
- Preserve Home Assistant display precision and units on entity cards and screensavers.

## 4.8.4

- Add authenticated standalone web editor access using WEB_STANDALONE, WEB_USERNAME, and WEB_PASSWORD.
- Require a password for standalone access while preserving Supervisor ingress as the default.
- Use LOGLEVEL and LOGTOFILE environment settings outside Supervisor.
- Document Docker Compose configuration and standalone editor authentication.

## 4.8.3

- Restore per-entity grid font selection: `small`, `medium`, `medium-icon`, and `large` now work on `cardGrid` and its automatic `cardGrid2` layout.
- Apply font selection to sensor values displayed in place of grid icons, allowing more compact humidity and other numeric readings.
- Preserve existing screensaver status-icon font handling and non-grid card rendering.

## 4.8.2

- Respect Home Assistant sensor display precision on cards and screensavers, with automatic refresh when precision settings change.
- Restore daily schedules for `sleepBrightness` and `screenBrightness`, using the panel time zone and handling overnight periods and backend restarts.
- Support importing AppDaemon daily brightness schedules, with validation of schedule times and values.
- Clamp entity-driven brightness to 0–100 for dynamic control through numeric sensors or Home Assistant helpers.
- Fix brightness `0` being ignored, including in sleep overrides.
- Update configuration and migration documentation for sensor precision and dynamic brightness.

## 4.8.1

- Restore TFT update prompts and automatic/manual update modes for MQTT and compatible ESPHome panels.
- Support model-specific firmware URLs and custom target versions.
- Prevent duplicate update requests and keep normal page updates from replacing the firmware prompt.

## 4.8.0

- Add an ingress configuration editor for panels, cards, entities, and screensavers.
- Preview/import add-on and AppDaemon YAML, with migration warnings and validation.
- Back up configuration before atomic saves and reject stale editor revisions.
- Keep the editor available independently of panel connections.
- Handle atomic config changes, fix global locale inheritance and use_ha_api false, and respect shutdown signals.

<!-- https://developers.home-assistant.io/docs/add-ons/presentation#keeping-a-changelog -->

## 4.7.91

- Keep the new runtime entity and screensaver features while reverting the add-on config mount change

## 4.7.90

- Add support for `status` entities in HAEntity state lookup and subscriptions
- Add support for `state` and `state_not` entity filters, including YAML `on`/`off` normalization
- Support dict-style `icon` and `color` for internal `navigate` and `iText` entities
- Preserve configured `icon`, `color`, and `name` when `navigate` entities use a `status` entity
- Add `screensaver.disable: true` to skip the screensaver on startup

## 4.7.0

- Initial test of addon
