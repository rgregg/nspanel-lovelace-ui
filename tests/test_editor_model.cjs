const assert = require('node:assert/strict');
const dir = require('node:path').resolve(__dirname, '../nspanel-lovelace-ui/rootfs/usr/bin/mqtt-manager/frontend');
const M = require(dir + '/editor-model.js');
const INFO = require(dir + '/card-info.js');
const TYPES = ['cardEntities', 'cardGrid', 'cardQR', 'cardPower', 'cardMedia', 'cardThermo', 'cardAlarm', 'cardUnlock'];

const config = () => ({mqtt_server: 'm', nspanels: {
  a: {panelRecvTopic: 'tele/a/RESULT', panelSendTopic: 'cmnd/a/CustomSend', weird: {x: 1}, cards: [{type: 'cardEntities', title: 'T', mystery: 5}]},
  b: {panelRecvTopic: 'custom/in', panelSendTopic: 'custom/out'}, c: {}}});

// rename
let c = config(); M.renamePanel(c, 'a', 'lounge');
assert.deepEqual(Object.keys(c.nspanels), ['lounge', 'b', 'c']);
assert.equal(c.nspanels.lounge.panelRecvTopic, 'tele/lounge/RESULT');
assert.equal(c.nspanels.lounge.panelSendTopic, 'cmnd/lounge/CustomSend');
assert.deepEqual(c.nspanels.lounge.weird, {x: 1});
assert.equal(c.nspanels.lounge.cards[0].mystery, 5);
c = config(); M.renamePanel(c, 'b', 'bb');
assert.equal(c.nspanels.bb.panelRecvTopic, 'custom/in');
assert.equal(c.nspanels.bb.panelSendTopic, 'custom/out');
assert.equal(c.mqtt_server, 'm');

// names
const panels = config().nspanels;
assert.ok(M.validPanelName('', panels)); assert.ok(M.validPanelName('   ', panels));
assert.ok(M.validPanelName('__proto__', panels)); assert.ok(M.validPanelName('a', panels));
assert.equal(M.validPanelName('new one', panels), null);

// new panel
const np = M.newPanel('x');
assert.equal(np.model, 'us-p'); assert.equal(np.panelSendTopic, 'cmnd/x/CustomSend'); assert.deepEqual(np.cards, []);

// cards
const p = {cards: [{type: 'cardEntities', title: '1', extra: true}, {type: 'cardGrid', title: '2'}], hiddenCards: [{type: 'cardQR', title: 'h'}]};
assert.deepEqual(M.cardList(p).map(e => `${e.key}:${e.index}:${e.card.title}`), ['cards:0:1', 'cards:1:2', 'hiddenCards:0:h']);
assert.equal(M.moveCard(p, 'cards', 0, -1), 0); assert.equal(M.moveCard(p, 'cards', 1, 1), 1);
assert.equal(M.moveCard(p, 'cards', 0, 1), 1); assert.deepEqual(p.cards.map(x => x.title), ['2', '1']);
const original = p.cards[1];
let at = M.setHidden(p, 'cards', 1, true);
assert.deepEqual(at, {key: 'hiddenCards', index: 1}); assert.equal(p.hiddenCards[1], original); assert.equal(original.extra, true);
at = M.setHidden(p, 'hiddenCards', 1, false);
assert.deepEqual(at, {key: 'cards', index: 1}); assert.equal(M.setHidden(p, 'cards', 1, false).index, 1);
const q = {}; at = M.setHidden(Object.assign(q, {cards: [{type: 'cardQR'}]}), 'cards', 0, true);
assert.deepEqual(q.cards, []); assert.equal(q.hiddenCards.length, 1);
const e = {}; assert.deepEqual(M.addCard(e, 'cardGrid', 'Grid'), {key: 'cards', index: 0}); assert.equal(e.cards[0].type, 'cardGrid');
M.deleteCard(e, 'cards', 0); assert.deepEqual(e.cards, []);

// domains and info
assert.deepEqual(M.domainsFor('cardThermo'), ['climate']); assert.equal(M.domainsFor('cardEntities'), null);
for (const type of TYPES) {
  const i = INFO[type]; assert.ok(i, type); assert.ok(i.label && i.summary.length > 10, type);
  assert.ok(Array.isArray(i.fields), type);
  for (const f of i.fields) { assert.ok(f.key && f.label && ['entity', 'text', 'select', 'modes', 'font', 'cardlink'].includes(f.kind), `${type}.${f.key}`); }
}
assert.equal(Object.keys(INFO).length, TYPES.length);

// review fixes: modes keep unknown values and order; unlock needs pin + navigate destination; rename reports topic changes
assert.deepEqual(M.toggleMode(['cool', 'heat'], 'off', true), ['cool', 'heat', 'off']);
assert.deepEqual(M.toggleMode(['arm_home', 'arm_custom_bypass'], 'arm_away', true), ['arm_home', 'arm_custom_bypass', 'arm_away']);
assert.deepEqual(M.toggleMode(['cool', 'heat'], 'cool', false), ['heat']);
assert.deepEqual(M.toggleMode(['heat'], 'heat', true), ['heat']);
assert.deepEqual(M.toggleMode(undefined, 'heat', true), ['heat']);
const un = INFO.cardUnlock.fields.map(f => `${f.key}:${f.kind}`);
assert.ok(un.includes('pin:text') && un.includes('destination:cardlink'), un.join());
assert.equal(M.domainsFor('cardUnlock'), null);
assert.ok(INFO.cardAlarm.fields.find(f => f.key === 'supported_modes').options.includes('arm_custom_bypass'));
c = config(); assert.equal(M.renamePanel(c, 'a', 'k'), true);
c = config(); assert.equal(M.renamePanel(c, 'b', 'k'), false);
// icons: stored as mdi:<name>; search ranks names that start with the query first
assert.equal(M.iconName('mdi:lightbulb'), 'lightbulb');
assert.equal(M.iconName('ha:{{ x }}'), null);
assert.equal(M.iconName(undefined), null);
assert.equal(M.iconValue('sofa'), 'mdi:sofa');
const names = ['lamp', 'floor-lamp', 'lamps', 'sofa', 'table-lamp'];
assert.deepEqual(M.filterIcons(names, 'lamp'), ['lamp', 'lamps', 'floor-lamp', 'table-lamp']);
assert.deepEqual(M.filterIcons(names, 'lamp', 2), ['lamp', 'lamps']);
assert.deepEqual(M.filterIcons(names, 'floor lamp'), ['floor-lamp']);
assert.deepEqual(M.filterIcons(names, '  '), names.slice(0, 120));

// go-to-card: entity navigate.<key>; cards without a key get one made from the title
assert.equal(M.linkKey('navigate.lights'), 'lights');
assert.equal(M.linkKey('light.kitchen'), null);
assert.equal(M.linkKey(undefined), null);
const lp = () => ({cards: [{type: 'cardEntities', title: 'Main', key: 'home'}, {type: 'cardGrid', title: 'Kitchen Lights!'}],
  hiddenCards: [{type: 'cardQR', title: 'Kitchen Lights'}, {type: 'cardGrid'}]});
let panel = lp();
assert.deepEqual(M.linkTargets(panel, panel.cards[0]).map(t => [t.label, t.hidden]),
  [['Kitchen Lights!', false], ['Kitchen Lights', true], ['cardGrid', true]]);
assert.equal(M.ensureKey(panel, panel.cards[0]), 'home');
assert.equal(M.ensureKey(panel, panel.cards[1]), 'kitchen-lights');
assert.equal(panel.cards[1].key, 'kitchen-lights');
assert.equal(M.ensureKey(panel, panel.hiddenCards[0]), 'kitchen-lights-2');
assert.equal(M.ensureKey(panel, panel.hiddenCards[1]), 'cardgrid');
assert.equal(M.ensureKey(panel, panel.hiddenCards[1]), 'cardgrid');
panel = {cards: [{type: 'cardQR', title: '!!!'}]};
assert.equal(M.ensureKey(panel, panel.cards[0]), 'card');
// drag reordering: where an entity lands when dropped before/after another row
assert.equal(M.dropIndex(0, 2, false), 1); assert.equal(M.dropIndex(0, 2, true), 2);
assert.equal(M.dropIndex(3, 1, false), 1); assert.equal(M.dropIndex(3, 1, true), 2);
assert.equal(M.dropIndex(1, 1, true), 1); assert.equal(M.dropIndex(1, 0, true), 1); assert.equal(M.dropIndex(1, 2, false), 1);
const order = (from, to) => { const l = ['a', 'b', 'c', 'd']; M.moveItem(l, from, to); return l.join(''); };
assert.equal(order(0, 2), 'bcad'); assert.equal(order(3, 0), 'dabc'); assert.equal(order(1, 1), 'abcd');
assert.equal(order(0, 9), 'abcd'); assert.equal(order(-1, 2), 'abcd');
assert.equal(M.moveItem(['a', 'b'], 0, 1), 1); assert.equal(M.moveItem(['a', 'b'], 0, 7), 0);
// physical buttons
let bp = {};
assert.equal(M.buttonMode(bp, 'left'), 'relay'); assert.equal(M.buttonMode(bp, 'right'), 'off');
M.setButtonMode(bp, 'right', 'actions');
assert.deepEqual(bp.buttons, {right: {mode: 'actions'}});
assert.equal(M.buttonMode(bp, 'right'), 'actions');
assert.equal(M.buttonMode({buttons: {right: {single: {service: 'a.b'}}}}, 'right'), 'actions');
assert.equal(M.defaultService('scene.x'), 'scene.turn_on'); assert.equal(M.defaultService('light.x'), 'light.toggle');
assert.equal(M.defaultService('weird.x'), ''); assert.equal(M.defaultService(''), '');
assert.ok(M.servicesFor('light.x').includes('light.turn_off')); assert.deepEqual(M.servicesFor(''), []);
M.setButtonAction(bp, 'right', 'single', {entity: 'scene.bright'});
assert.deepEqual(bp.buttons.right.single, {service: 'scene.turn_on', entity: 'scene.bright'});
M.setButtonAction(bp, 'right', 'single', {service: 'scene.turn_on', data: {transition: 2}});
assert.deepEqual(bp.buttons.right.single.data, {transition: 2});
M.setButtonAction(bp, 'right', 'single', {data: {}});
assert.equal('data' in bp.buttons.right.single, false);
assert.deepEqual(M.buttonAction(bp, 'right', 'single'), {service: 'scene.turn_on', entity: 'scene.bright', data: {}});
bp.buttons.right.hold = {service: 'light.toggle', entity: ['light.a', 'light.b']};
assert.equal(M.buttonAction(bp, 'right', 'hold').entity, 'light.a');  // lists are edited in the JSON box; kept as they are
M.setButtonAction(bp, 'right', 'hold', {service: 'light.turn_on'});
assert.deepEqual(bp.buttons.right.hold.entity, ['light.a', 'light.b']);
M.setButtonAction(bp, 'right', 'single', {service: '', entity: ''});
assert.equal('single' in bp.buttons.right, false);
console.log('editor model ok');
