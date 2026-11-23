!!! note "Legacy AppDaemon reference"
    These examples target AppDaemon and may use unsupported options in the new backend. Use the [current card reference](cards.md) and [migration guide](config-migration-standalone.md) for the add-on.

# Change behaviour of hardware buttons

## Add-on `buttons` setting

The add-on can set up the two buttons for you (Physical buttons in the editor, or `buttons:` in `panels.yaml`):

```yaml
buttons:
  left: {mode: relay}     # the button toggles its own relay
  right:
    mode: actions         # the button calls Home Assistant services
    single: {service: scene.turn_on, entity: scene.kitchen_bright}
```

`mode` is `relay`, `actions` or `off` (the button does nothing). With every button on `relay` the add-on sends `SetOption73 0` and `Rule3 0`. Otherwise it sends `SetOption73 1`, which detaches **both** buttons from their relays, and writes rule 3 so each `relay` button still toggles its relay; with no `relay` buttons it sends `Rule3 0`. These settings are stored on the panel and are re-sent every time the add-on starts.

Rule 3 belongs to the add-on, so keep your own rules in rule 1 or 2, and don't also toggle a relay from your own rule while that button is set to `relay`, or the relay toggles twice and appears not to change.

Leave out the `buttons:` setting entirely if you manage the buttons yourself with Tasmota rules: the add-on then never sends `SetOption73` or touches rule 3.


## Tasmota Rules

You can configure the buttons to mimic an UI element on the screen by configuring tasmota rules.

The following rule will change the behaviour of the two buttons to do page navigation.

```
Rule2 on Button1#state do Publish tele/%topic%/RESULT {"CustomRecv":"event,buttonPress2,navPrev,button"} endon on Button2#state do Publish tele/%topic%/RESULT {"CustomRecv":"event,buttonPress2,navNext,button"} endon

Rule2 1
```

## Decouple buttons from controlling power outputs

If you do not want your NSPanel physical buttons to trigger the relays and prefer to have them as software configurable buttons, open the Tasmota console of your NSPanel and enter the following:
   
`SetOption73 1`
 
Your relays will now appear as switches in HomeAssistant and you can control your buttons by using automations:
   
   ![image](https://user-images.githubusercontent.com/57167030/169677954-5b811d12-dab8-4415-89aa-e4196732765e.png)

You may reverse this change by entering the following in the Tasmota console of your NSPanel:

`SetOption73 0`

Please note: Doing this will mean that if HomeAssistant is not working for any reason your buttons will not function correctly.
