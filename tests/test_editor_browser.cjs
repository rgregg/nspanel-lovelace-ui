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
    await page.route('**/api/thumbnails', route => route.fulfill({contentType: 'application/json', body: JSON.stringify({thumbnails: {
      cardEntities: {type: 'cardEntities', commands: [entityCommand], icons: {}, errors: []},
      cardGrid: {type: 'cardGrid', commands: [], icons: {}, errors: ['broken']}}})}));
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
    assert.deepEqual(errors,[]);
    console.log('Screenshots: ' + dir);
    console.log('Browser smoke passed: load, edit, save, backup, AppDaemon import, merge, visual editor, mobile layout; no page errors.');
  } finally {if(browser) await browser.close(); server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
