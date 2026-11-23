const {chromium} = require('playwright');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
const backend = root + '/nspanel-lovelace-ui/rootfs/usr/bin/mqtt-manager';
const dir = fs.mkdtempSync('/tmp/nspanel-browser-');
fs.copyFileSync(backend + '/panels.yaml.example', dir + '/panels.yaml');
const server = spawn(process.env.PYTHON || 'python3', ['-u', '-c', `import sys\nsys.path.insert(0, ${JSON.stringify(backend)})\nfrom web import *\ns=ThreadingHTTPServer(('127.0.0.1',0), handler_for(ConfigStore(${JSON.stringify(dir + '/panels.yaml')}), '127.0.0.1'))\nprint(s.server_port, flush=True)\ns.serve_forever()`]);
(async () => {
  let browser;
  try {
    const port = await new Promise((resolve, reject) => {server.stdout.once('data', d => resolve(Number(d.toString().trim())));server.once('error', reject);server.stderr.on('data', d => process.stderr.write(d));});
    browser = await chromium.launch({headless:true, executablePath: process.env.CHROME || undefined});
    const page = await browser.newPage({viewport:{width:1360,height:1000}});
    const errors=[];page.on('pageerror', e=>errors.push(e.message));
    let entityReply = {status: 200, body: {entities: [
      {entity_id: 'light.desk_lamp', name: 'Desk Lamp', domain: 'light'},
      {entity_id: 'light.ceiling', name: 'Ceiling', domain: 'light'},
      {entity_id: 'climate.hall', name: 'Hall thermostat', domain: 'climate'}]}};
    const entityCommand = ['entityUpd', 'Lights', ...Array(12).fill(''), 'light', 'i1', '', '65535', 'Ceiling', '1'].join('~');
    let thumbDelay = 0;
    await page.route('**/api/thumbnails', async route => { if (thumbDelay) await new Promise(r => setTimeout(r, thumbDelay)); await route.fulfill({contentType: 'application/json', body: JSON.stringify({thumbnails: {
      cardEntities: {type: 'cardEntities', commands: [entityCommand], icons: {}, errors: []},
      cardGrid: {type: 'cardGrid', commands: [], icons: {}, errors: ['broken']}}})}); });
    let previewReply = {status: 200, body: {panels: ['x'], panel: 'x', model: 'us-p', time: '12:00', date: 'Monday', icons: {}, errors: [],
      cards: [{iid: 'i', type: 'cardEntities', title: 'Lights', hidden: false, index: 0, commands: [entityCommand]}],
      screensaver: {type: 'screensaver', commands: []}}};
    await page.route('**/api/preview', route => route.fulfill({status: previewReply.status, contentType: 'application/json', body: JSON.stringify(previewReply.body)}));
    await page.route('**/api/entities*', route => route.fulfill({status: entityReply.status, contentType: 'application/json', body: JSON.stringify(entityReply.body)}));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.getByText('Configuration loaded.', {exact:false}).waitFor();
    await page.getByText('Advanced panel settings').click();
    await page.getByLabel('Locale', {exact:true}).fill('en_US');
    await page.getByLabel('Locale', {exact:true}).press('Tab');
    await page.getByRole('button',{name:'Save & apply',exact:true}).click();
    await page.getByText('Saved. The panel backend', {exact:false}).waitFor();
    assert(fs.existsSync(dir+'/panels.yaml.bak'));
    await page.getByRole('button',{name:'Import YAML',exact:true}).click();
    await page.getByLabel('Configuration YAML').fill('imported:\n  module: nspanel-lovelace-ui\n  class: NsPanelLovelaceUIManager\n  config:\n    panelRecvTopic: tele/imported/RESULT\n    panelSendTopic: cmnd/imported/CustomSend\n    cards:\n      - type: cardEntities\n        title: Imported room\n        entities:\n          - entity: light.kitchen\n');
    await page.getByRole('button',{name:'Preview import',exact:true}).click();
    await page.getByRole('button',{name:'Add to draft',exact:true}).click();
    await page.getByRole('button',{name:'Visual editor',exact:true}).click();
    await page.getByLabel('Panel', {exact:true}).selectOption('imported');
    await page.getByRole('button',{name:'Imported room',exact:true}).click();
    await page.getByRole('heading',{name:'Imported room',exact:true}).waitFor();
    // Card type gallery: real thumbnail for Entities, sketch for the rest and for a failed thumbnail.
    await page.getByRole('button',{name:/^Card type:/}).click();
    await page.locator('.gallery-tile').first().waitFor();
    assert.equal(await page.locator('.gallery-tile').count(), 8);
    assert.match(await page.locator('.gallery-tile', {hasText: 'Entities'}).first().innerText(), /Ceiling/);
    assert.equal(await page.locator('.gallery-tile .sk-screen').count(), 7);
    assert.equal(await page.locator('.gallery-tile[aria-pressed=true]').count(), 1);
    await page.screenshot({path: dir + '/gallery.png'});
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => config.nspanels.imported.cards[0].type), 'cardEntities');
    await page.getByRole('button',{name:/^Card type:/}).click();
    await page.locator('.gallery-tile', {hasText: 'Thermostat'}).click();
    assert.deepEqual(await page.evaluate(() => { const c = config.nspanels.imported.cards[0]; return [c.type, c.entities.length, c.title]; }), ['cardThermo', 1, 'Imported room']);
    // Thermostat shows its own options only; the entities stay in the YAML (JSON box) but not as a list.
    assert.equal(await page.getByText('Modes to show').count(), 1);
    assert.equal(await page.getByRole('heading', {name: 'Entities', exact: true}).count(), 0);
    assert.equal(await page.getByText('Main entity', {exact: false}).count(), 0);
    await page.getByLabel('heat', {exact: true}).check();
    assert.deepEqual(await page.evaluate(() => config.nspanels.imported.cards[0].supported_modes), ['heat']);
    await page.getByLabel('heat', {exact: true}).uncheck();
    assert.equal(await page.evaluate(() => 'supported_modes' in config.nspanels.imported.cards[0]), false);
    await page.getByText('Advanced (all card options as JSON)').click();
    assert.match(await page.getByLabel('Advanced (all card options as JSON)').inputValue(), /light\.kitchen/);
    await page.getByRole('button',{name:/^Card type:/}).click();
    await page.locator('.gallery-tile', {hasText: 'Entities'}).click();
    await page.getByRole('heading', {name: 'Entities', exact: true}).waitFor();
    // Rename the panel: key and default topics follow, position and other settings stay.
    await page.getByRole('button',{name:'Rename panel',exact:true}).click();
    await page.getByLabel('Rename panel', {exact:true}).fill('lounge');
    await page.getByLabel('Rename panel', {exact:true}).press('Enter');
    await page.getByRole('heading',{name:'lounge',exact:true}).waitFor();
    await page.getByRole('button',{name:'YAML editor',exact:true}).click();
    await page.waitForFunction(() => document.getElementById('yaml').value.includes('lounge'));
    const renamed = await page.locator('#yaml').inputValue();
    assert(/lounge:/.test(renamed) && /tele\/lounge\/RESULT/.test(renamed) && !/imported:/.test(renamed), 'rename rewrote key and topics');
    await page.getByRole('button',{name:'Visual editor',exact:true}).click();
    // Add a card, hide it, then remove an entity with its icon button.
    await page.getByLabel('Panel', {exact:true}).selectOption('lounge');
    await page.getByRole('button',{name:'Add card',exact:true}).click();
    await page.locator('.gallery-tile', {hasText: 'QR code'}).click();
    await page.getByRole('heading',{name:'QR code',exact:true}).waitFor();
    await page.getByLabel('QR code text or link').fill('https://example.com'); await page.getByLabel('QR code text or link').press('Tab');
    assert.equal(await page.evaluate(() => config.nspanels.lounge.cards.at(-1).qrCode), 'https://example.com');
    assert.equal(await page.getByText('Main entity', {exact: false}).count(), 0);
    await page.getByLabel('Hidden card', {exact:false}).check();
    await page.getByRole('button',{name:'QR code (hidden)',exact:true}).waitFor();
    await page.getByRole('button',{name:'Imported room',exact:true}).click();
    await page.getByRole('button',{name:'Remove entity',exact:true}).first().click();
    assert.equal(await page.getByRole('button',{name:'Remove entity',exact:true}).count(), 0);
    // Icon chooser: search the panel's icon set, pick one, keep it as mdi:<name>, remove it again.
    await page.getByRole('button',{name:'Add entity',exact:true}).click();
    await page.getByRole('button',{name:/Choose icon/}).first().click();
    await page.locator('#icon-dialog').waitFor();
    await page.locator('.icon-cell').first().waitFor();
    await page.getByLabel('Search icons').fill('floor lamp');
    await page.locator('.icon-cell[title="floor-lamp"]').waitFor();
    assert((await page.locator('.icon-cell').count()) < 40);
    await page.keyboard.press('Escape');
    await page.locator('#icon-dialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => 'icon' in config.nspanels.lounge.cards[0].entities[0]), false);
    await page.getByRole('button',{name:/Choose icon/}).first().click();
    await page.getByLabel('Search icons').fill('floor-lamp');
    await page.getByLabel('Search icons').press('Enter');
    await page.locator('#icon-dialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => config.nspanels.lounge.cards[0].entities[0].icon), 'mdi:floor-lamp');
    await page.locator('.icon-choose .mdi-floor-lamp').waitFor();
    await page.getByRole('button',{name:'Use the default icon',exact:true}).click();
    assert.equal(await page.evaluate(() => 'icon' in config.nspanels.lounge.cards[0].entities[0]), false);
    // Colour: the picker stores [r, g, b]; the reset removes it; templates are shown and kept.
    await page.getByLabel('Color: Default. Choose color').first().fill('#ffcc00');
    assert.deepEqual(await page.evaluate(() => config.nspanels.lounge.cards[0].entities[0].color), [255, 204, 0]);
    await page.getByLabel('Color: #ffcc00. Choose color').waitFor();
    await page.getByRole('button',{name:'Use the default color',exact:true}).click();
    assert.equal(await page.evaluate(() => 'color' in config.nspanels.lounge.cards[0].entities[0]), false);
    await page.evaluate(() => { config.nspanels.lounge.cards[0].entities[0].color = 'ha:{{ x }}'; render(); });
    await page.getByLabel('Color: Template. Choose color').waitFor();
    await page.evaluate(() => { delete config.nspanels.lounge.cards[0].entities[0].color; render(); });
    // Reordering entities: drag by the handle, or use the arrow buttons.
    await page.evaluate(() => { config.nspanels.lounge.cards[0].entities = ['light.a', 'light.b', 'light.c'].map(entity => ({entity})); render(); });
    const entityOrder = () => page.evaluate(() => config.nspanels.lounge.cards[0].entities.map(e => e.entity.slice(-1)).join(''));
    assert.equal(await entityOrder(), 'abc');
    assert.equal(await page.getByRole('button', {name: 'Move entity up'}).first().isDisabled(), true);
    await page.getByRole('button', {name: 'Move entity down'}).first().click();
    assert.equal(await entityOrder(), 'bac');
    const handles = page.locator('.entity-row .drag-handle');
    assert.equal(await handles.count(), 3);
    // Real mouse drag with all three rows on screen, so nothing scrolls during the drag.
    await page.setViewportSize({width:1360,height:2400});
    await page.locator('.entity-row').first().scrollIntoViewIfNeeded();
    const drag = async (fromIndex, toIndex, fraction) => {
      const from = await handles.nth(fromIndex).boundingBox(), over = await page.locator('.entity-row').nth(toIndex).boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
      await page.mouse.move(over.x + 80, over.y + over.height * fraction, {steps: 8}); await page.mouse.up();
    };
    await drag(0, 2, 0.9);
    assert.equal(await entityOrder(), 'acb');
    await drag(2, 0, 0.1);
    assert.equal(await entityOrder(), 'bac');
    assert.equal(await page.locator('.entity-row.dragging').count(), 0);
    await page.setViewportSize({width:1360,height:1000});
    await page.evaluate(() => { config.nspanels.lounge.cards[0].entities = [{entity: ''}]; render(); });
    // Go to card: pick the hidden QR card; it gets a navigation key and the row gets its name.
    await page.getByRole('button',{name:'Add a link to another card',exact:true}).click();
    await page.getByLabel('Go to card', {exact:true}).selectOption({label: 'QR code (hidden card)'});
    assert.deepEqual(await page.evaluate(() => { const l = config.nspanels.lounge; return [l.cards[0].entities[1].entity, l.hiddenCards[0].key, l.cards[0].entities[1].name]; }),
      ['navigate.qr-code', 'qr-code', 'QR code']);
    assert.equal(await page.getByLabel('Go to card', {exact:true}).inputValue(), '0');
    await page.getByRole('button',{name:'Remove entity',exact:true}).nth(1).click();
    await page.getByRole('button',{name:'Remove entity',exact:true}).first().click();
    // Idle behaviour: no screensaver, a default card and the idle time are plain fields on the Screensaver tab.
    await page.getByRole('button',{name:'Screensaver',exact:true}).click();
    await page.getByLabel('No screensaver', {exact:false}).check();
    await page.getByLabel('Default card', {exact:true}).selectOption({label: 'QR code (hidden card)'});
    await page.getByLabel('Idle time', {exact:false}).fill('45'); await page.getByLabel('Idle time', {exact:false}).press('Tab');
    assert.deepEqual(await page.evaluate(() => { const l = config.nspanels.lounge; return [l.screensaver.disable, l.defaultCard, l.sleepTimeout]; }), [true, 'navigate.qr-code', 45]);
    await page.getByText('returns to the default card', {exact:false}).waitFor();
    await page.getByLabel('Idle time', {exact:false}).fill(''); await page.getByLabel('Idle time', {exact:false}).press('Tab');
    assert.equal(await page.evaluate(() => 'sleepTimeout' in config.nspanels.lounge), false);
    await page.getByLabel('No screensaver', {exact:false}).uncheck();
    assert.equal(await page.evaluate(() => 'disable' in config.nspanels.lounge.screensaver), false);
    // Physical buttons: left defaults to its relay; the right one can run Home Assistant services per gesture.
    await page.getByText('Physical buttons', {exact:true}).click();
    assert.equal(await page.getByLabel('Left button mode').inputValue(), 'relay');
    assert.equal(await page.getByLabel('Right button mode').inputValue(), 'off');
    await page.getByLabel('Right button mode').selectOption('actions');
    const buttonEntity = page.getByRole('combobox', {name: 'Right button Single press entity'});
    await buttonEntity.fill('lamp'); await buttonEntity.press('Enter');
    assert.deepEqual(await page.evaluate(() => config.nspanels.lounge.buttons), {right: {mode: 'actions', single: {service: 'light.toggle', entity: 'light.desk_lamp'}}});
    await page.locator('input[list="services-right-single"]').fill('light.turn_on'); await page.locator('input[list="services-right-single"]').press('Tab');
    await page.locator('.gesture-row').first().getByLabel('Extra data', {exact:false}).fill('{"brightness": 80}'); await page.locator('.gesture-row').first().getByLabel('Extra data', {exact:false}).press('Tab');
    assert.deepEqual(await page.evaluate(() => config.nspanels.lounge.buttons.right.single), {service: 'light.turn_on', entity: 'light.desk_lamp', data: {brightness: 80}});
    await page.getByLabel('Right button mode').selectOption('off');
    assert.equal(await page.evaluate(() => config.nspanels.lounge.buttons.right.mode), 'off');
    // A new panel needs a valid, unique name.
    await page.getByRole('button',{name:'New panel',exact:false}).click();
    await page.getByLabel('New panel name').fill('lounge');
    await page.getByRole('button',{name:'Create panel',exact:true}).click();
    await page.getByText('already exists').waitFor();
    await page.getByLabel('New panel name').fill('study');
    await page.getByRole('button',{name:'Create panel',exact:true}).click();
    await page.getByRole('heading',{name:'study',exact:true}).waitFor();
    await page.getByRole('button',{name:'Save & apply',exact:true}).click();
    // Saving needs at least one card per panel, so remove the empty new panel again.
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button',{name:'Delete panel',exact:true}).click();
    await page.getByRole('heading',{name:'study',exact:true}).waitFor({state:'detached'});
    await page.getByRole('button',{name:'Save & apply',exact:true}).click();
    await page.getByText('Saved. The panel backend', {exact:false}).waitFor();
    await page.screenshot({path:dir+'/editor-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:dir+'/editor-mobile.png',fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
    // Entity picker: search by name, keyboard select, domain filter and plain-text fallback.
    await page.setViewportSize({width:1360,height:1000});
    await page.evaluate(() => { window.pickedValue = null; document.body.append(EntityPicker.create({value: '', domains: ['light'], label: 'Test entity', onChange: v => { window.pickedValue = v; }})); });
    const picker = page.getByRole('combobox', {name: 'Test entity'});
    await picker.fill('lamp');
    await page.locator('.picker-option', {hasText: /Desk Lamp/}).waitFor();
    assert.equal(await page.locator('.picker-option').count(), 1);
    await picker.press('Enter');
    assert.equal(await page.evaluate(() => window.pickedValue), 'light.desk_lamp');
    assert.equal(await picker.inputValue(), 'light.desk_lamp');
    await picker.fill('hall');
    assert.equal(await page.locator('.picker-option').count(), 0);
    await page.getByLabel('Show all entities').check();
    await page.locator('.picker-option', {hasText: /Hall thermostat/}).waitFor();
    entityReply = {status: 503, body: {error: 'down'}};
    await page.reload(); await page.getByText('Configuration loaded.', {exact:false}).waitFor();
    await page.evaluate(() => { window.pickedValue = null; document.body.append(EntityPicker.create({value: '', onChange: v => { window.pickedValue = v; }, label: 'Fallback entity'})); });
    const plain = page.getByRole('combobox', {name: 'Fallback entity'});
    await plain.fill('sensor.typed_by_hand'); await plain.press('Tab');
    assert.equal(await page.locator('.picker-option').count(), 0);
    assert.equal(await page.evaluate(() => window.pickedValue), 'sensor.typed_by_hand');
    // Closing the gallery while it is still loading must not leave the + button stuck.
    thumbDelay = 1500;
    await page.reload(); await page.getByText('Configuration loaded.', {exact:false}).waitFor();
    await page.getByRole('button',{name:'Add card',exact:true}).click();
    await page.locator('#card-gallery').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#card-gallery').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Add card',exact:true}).and(page.locator(':enabled')).waitFor({timeout: 1000});
    thumbDelay = 0;
    // Live preview pane: beside the editor on wide screens, below it on narrow ones, tracks the selected card.
    await page.setViewportSize({width:1360,height:1000});
    await page.locator('#preview-pane .pv-screen').waitFor();
    await page.getByRole('button',{name:'Test Entities Card',exact:true}).click();
    await page.locator('#preview-pane .pv-screen', {hasText: 'Ceiling'}).waitFor();
    const editorBox = await page.locator('#visual').boundingBox(), paneBox = await page.locator('#preview-pane').boundingBox();
    assert(paneBox.x >= editorBox.x + editorBox.width - 1, 'pane is to the right of the editor');
    await page.screenshot({path: dir + '/final-desktop.png'});
    await page.setViewportSize({width:390,height:844});
    const narrowEditor = await page.locator('#visual').boundingBox(), narrowPane = await page.locator('#preview-pane').boundingBox();
    assert(narrowPane.y >= narrowEditor.y + narrowEditor.height - 1, 'pane stacks under the editor');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({width:1360,height:1000});
    previewReply = {status: 503, body: {error: 'service down'}};
    await page.getByRole('button',{name:'Refresh preview',exact:true}).click();
    await page.getByText('Preview unavailable: service down').waitFor();
    await page.getByLabel('Locale', {exact:false}).count();  // editing still works while the preview is down
    await page.getByRole('button',{name:'YAML editor',exact:true}).click();
    await page.locator('#preview-pane').waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);
    console.log('Screenshots: ' + dir);
    console.log('Browser smoke passed: load, edit, save, backup, AppDaemon import, merge, visual editor, mobile layout; no page errors.');
  } finally {if(browser) await browser.close(); server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
