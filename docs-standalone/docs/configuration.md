# Configuration: panels.yaml

The runtime reads one YAML file (default: `./panels.yaml`, add-on mode: `/config/panels.yaml`).

Use the [web editor](https://docs.nspanel.pky.eu/web-editor/) to manage this file. For a complete starting configuration, see [your first panel](getting-started.md). Snippets in the card and screensaver references belong under `nspanels.<panel_name>`. Do not wrap them in AppDaemon `module`, `class`, or `config` keys.

## Top-level keys

key | required | type | default | description
-- | -- | -- | -- | --
`nspanels` | yes | object | none | Map of panel definitions.
`home_assistant_address` | recommended | string | none | Home Assistant base URL. In add-on mode it is auto-filled as `http://supervisor` if missing.
`home_assistant_token` | recommended | string | none | Long-lived token or Supervisor token.
`mqtt_server` | required in MQTT mode | string | from env | MQTT host.
`mqtt_port` | required in MQTT mode | int | from env | MQTT port.
`mqtt_username` | required in MQTT mode | string | from env | MQTT username.
`mqtt_password` | required in MQTT mode | string | from env | MQTT password.
`use_ha_api` | optional | boolean | `false` | When true, MQTT input mode is disabled and HA event mode is used.
`track_all_entities` | optional | boolean | `false` | By default the backend subscribes only to entities referenced in `panels.yaml` (plus `sun.sun`, and any entity it looks up at runtime). Set to `true` to subscribe to every Home Assistant entity instead, which loads the full state list on each connect.
`timeZone` | optional | string | `Europe/Berlin` | Global fallback for panel `timeZone`.
`hiddenCards` | optional | list | `[]` | Global fallback for panel `hiddenCards`.

## Panel keys (`nspanels.<name>`)

key | required | type | default | description
-- | -- | -- | -- | --
`panelRecvTopic` | yes | string | none | Receive channel for panel events.
`panelSendTopic` | yes | string | none | Send channel for panel commands.
`locale` | yes | string | none | Locale used for translations and date formatting.
`timeZone` | recommended | string | from top-level `timeZone` | Time zone for clock.
`timeFormat` | yes | string | none | Python `strftime` format.
`dateFormat` | yes | string | none | Babel date format (example: `full`, `medium`).
`model` | optional | string | `eu` | Panel model (`eu`, `us-p`, `us-l`).
`temp_unit` | optional | string | `celsius` | Thermostat card unit (`celsius` or `fahrenheit`).
`sleepTimeout` | optional | int | `20` | Seconds before screensaver.
`sleepBrightness` | optional | int, entity_id, or schedule | `10` | Screensaver brightness.
`screenBrightness` | optional | int, entity_id, or schedule | `100` | Active-screen brightness.
`sleepTracking` | optional | entity_id | none | Forces sleep brightness to 0 when entity state matches `sleepTrackingZones`.
`sleepTrackingZones` | optional | list | `["not_home", "off"]` | States that trigger forced dimming.
`sleepOverride` | optional | object | none | Override sleep brightness when entity is `on`/`true`/`home`.
`defaultBackgroundColor` | optional | string | `ha-dark` | `ha-dark` or `black`.
`featExperimentalSliders` | optional | int | `0` | Forwarded in dimmode command.
`defaultCard` | optional | string | none | Default card when leaving screensaver (`navigate.<key>`).
`screensaver` | yes | object | none | Screensaver definition.
`cards` | yes | list | none | At least one supported top-level card is required when saving in the editor.
`hiddenCards` | optional | list | `[]` | Hidden cards addressable through `navigate.<key>`.

## Brightness behavior

- Integer values are used directly.
- Entity values read Home Assistant state and cast to number.
- Daily time/value schedules are supported for both sleep and active-screen brightness.

Example:

```yaml
sleepBrightness: input_number.nspanel_sleep
screenBrightness: input_number.nspanel_awake
sleepTracking: person.john
sleepTrackingZones: ["not_home", "off"]
sleepOverride:
  entity: light.bedroom
  brightness: 30
```

## Web editor (Home Assistant add-on)

From add-on version 4.8.0, **Open Web UI** provides a visual panel/card/entity editor and a full YAML editor. Import existing add-on or AppDaemon YAML into a draft, review warnings, and save to apply. Saves create `panels.yaml.bak` and reload the backend; stale browser drafts cannot overwrite newer disk revisions. Home Assistant ingress is the default access mode. Standalone Docker installations can opt into direct access with `WEB_STANDALONE=true` and `WEB_PASSWORD`; see the [standalone guide](https://docs.nspanel.pky.eu/standalone-runtime/).

### Using the visual editor

- **Panels:** pick a panel from the dropdown at the top, or add one with **New panel** or **Import YAML**. Click the pencil next to the panel name to rename it; the MQTT topics follow the name unless you set them yourself. Connection, language, date and time formats, model and other panel-wide settings are under **Advanced panel settings**.
- **Cards:** each card is a tab in the strip under the panel name; **+** adds one and the last tab is the screensaver. Choosing or changing a card type opens a gallery that shows what each type looks like and what it is for. A card's title is its heading: click the pencil to change it. Use the arrows to reorder and the **Hidden card** box for cards that are reached only by navigation.
- **Options:** a card shows only the options its type uses. Entity fields search your Home Assistant entities by name or ID (and fall back to a plain text field if Home Assistant cannot be reached). Each entity row has an **Advanced** section for the less common keys, and each card has **Advanced** with every option as JSON, so nothing is YAML-only.
- **Icons:** each entity row has an **Icon** button that opens a searchable list of every icon the panel can draw. The choice is stored as `icon: mdi:<name>`; the X beside it removes the icon.
- **Entity order:** drag an entity row by the grip on its left to move it up or down; the arrow buttons under the grip do the same from the keyboard or a touch screen. It works for a card's entities and for the screensaver's.
- **Go to card:** the second plus button under a card's entities adds a link to another card. Pick the card from the list and the row is stored as `navigate.<key>`. A card without a navigation key gets one made from its title, so hidden cards can be reached without editing YAML. The Unlock card's *Open this card after unlocking* uses the same list.

### Live preview

Beside the card editor, the preview draws the card you are editing (or the screensaver) the way the panel will, using the draft as it is now (saved or not) and your current Home Assistant states, so a light that is on shows as on. It updates shortly after each change; **Refresh** redraws it. On narrow screens it appears below the editor.

- **What it covers:** `cardEntities`, `cardGrid` and the screensaver, for the US portrait panel (`model: us-p`). Other card types and models say they are not drawn yet; they still work on the panel.
- **How accurate it is:** the text, icons, colors and values are exactly what the add-on would send to the panel, because the preview runs the same card code. Positions and sizes come from the panel's display project. Fonts and the on/off switch are drawn approximately, so text may wrap or clip slightly differently on the real screen.
- **Nothing is sent to the panel.** Entities that appear only in an unsaved draft are subscribed in Home Assistant until the add-on restarts.
- If the preview says the service is not running yet, wait for the add-on to finish starting and press **Refresh**.

## TFT firmware updates (4.8.1+)

At panel startup, the backend checks the reported TFT version and model against its pinned firmware target (currently protocol version 53, release v4.7.3, matching the former AppDaemon target). It does not query the latest GitHub release. A backend release can advance this target separately from its add-on version.

Set **TFT firmware updates** in the visual editor, or add the following under your panel:

```yaml
updateMode: auto-notify
```

- `auto-notify` (default): show an Install/Dismiss dialog on the physical panel when an update is needed.
- `auto`: start an update automatically when the installed version is older. A model change still requires confirmation.
- `manual`: do not offer or start TFT updates.

Dismissing a prompt suppresses further prompts until the backend restarts. A newer TFT on the same model is not downgraded. The backend sends at most one flash request per panel per backend run; check device logs before restarting to retry a failed transfer. Keep power connected while flashing. A new startup message reports the resulting version; no startup after ten minutes is logged as an unconfirmed update, not success.

Tasmota installations need the Berry driver with `FlashNextion` support and a `panelSendTopic` ending in `/CustomSend`. Compatible ESPHome installations use the existing `nspanelui_api_call` service with command `255`; support depends on the installed ESPHome component. TFTs older than protocol version 16 require manual flashing. Berry driver updates remain manual.

Advanced YAML options retain the AppDaemon names `displayURL-EU`, `displayURL-US-P`, and `displayURL-US-L`. Only the URL for the selected model is used. Custom URLs must use HTTP and be reachable from the panel. Set `displayFirmwareVersion` to the protocol version embedded in a custom TFT (not its release string), for example:

```yaml
updateMode: auto-notify
displayURL-EU: http://homeassistant.local:8123/local/nspanel.tft
displayFirmwareVersion: 53
```

## Dynamic brightness

Set the following under your panel in the YAML editor (or **All panel options** using JSON):

```yaml
timeZone: Europe/Berlin
sleepBrightness:
  - time: "07:00"
    value: 35
  - time: "22:00"
    value: 0
```

This uses brightness 35 during the day and 0 overnight. Times are daily local wall-clock times in the panel's `timeZone`; quote them in YAML. HH:MM and HH:MM:SS are accepted. Entries may be unordered but must have unique times and integer values from 0 to 100. The last entry from the previous day applies before the first entry, including after a restart. The backend checks schedules every second and sends a brightness command only when the resolved settings change. The same schedule format is supported by `screenBrightness`. Sunrise/sunset expressions are not supported.

For illumination-driven control, set `sleepBrightness: input_number.nspanel_sleep` and use a Home Assistant automation to update that helper from your illuminance sensor. A numeric sensor entity can also be used directly if its state already represents a desired brightness percentage. Values are clamped to 0–100; raw lux is not automatically converted into a brightness curve. Entity changes update the panel without a restart.

`sleepTracking` still forces sleep brightness to zero when its configured state matches; an active `sleepOverride` takes precedence over that and the schedule. An override brightness of zero is supported.

## Physical buttons

The panel has two buttons. By default Tasmota makes each one toggle its own relay, and nothing reaches Home Assistant. The `buttons` setting changes that: for each button choose whether it toggles its relay, runs Home Assistant services, or does nothing. The web editor has a **Physical buttons** section on each panel.

```yaml
nspanels:
  kitchen_panel:
    buttons:
      left:
        mode: relay                  # toggles relay 1 (the default for the left button)
      right:
        mode: actions                # the default for the right button is "off"
        single: {service: scene.turn_on, entity: scene.kitchen_bright}
        double: {service: scene.turn_on, entity: scene.kitchen_off}
        hold:   {service: light.toggle, entity: [light.island, light.sink], data: {}}
```

- `mode` is `relay`, `actions` or `off`. `left` is button 1 and `right` is button 2.
- Gestures are `single`, `double`, `triple` and `hold`. Each runs one Home Assistant service on its `entity` (an entity id or a list; omit it for services that need none). `data` is optional extra service data.
- When `buttons` is set, the add-on configures Tasmota itself (it needs MQTT topics in the usual `tele/<name>/RESULT` and `cmnd/<name>/CustomSend` form): it sets `SetOption73 1` so button presses are reported instead of switching relays directly, and it uses Tasmota rule 3 to toggle a relay for `relay` buttons. The commands are sent when the add-on connects and each time the panel starts. Do not use rule 3 for your own rules on that panel. If both buttons are `relay`, the panel returns to Tasmota's normal behaviour.
- Without a `buttons` setting the add-on does not touch the panel's button configuration.
- Only the single press of a `relay` button toggles the relay. Multi-press detection delays a single press slightly.
