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
  for (const f of i.fields) { assert.ok(f.key && f.label && ['entity', 'text', 'select', 'modes', 'font'].includes(f.kind), `${type}.${f.key}`); }
}
assert.equal(Object.keys(INFO).length, TYPES.length);

// review fixes: modes keep unknown values and order; unlock needs pin + navigate destination; rename reports topic changes
assert.deepEqual(M.toggleMode(['cool', 'heat'], 'off', true), ['cool', 'heat', 'off']);
assert.deepEqual(M.toggleMode(['arm_home', 'arm_custom_bypass'], 'arm_away', true), ['arm_home', 'arm_custom_bypass', 'arm_away']);
assert.deepEqual(M.toggleMode(['cool', 'heat'], 'cool', false), ['heat']);
assert.deepEqual(M.toggleMode(['heat'], 'heat', true), ['heat']);
assert.deepEqual(M.toggleMode(undefined, 'heat', true), ['heat']);
const un = INFO.cardUnlock.fields.map(f => `${f.key}:${f.kind}`);
assert.ok(un.includes('pin:text') && un.includes('destination:text'), un.join());
assert.equal(M.domainsFor('cardUnlock'), null);
assert.ok(INFO.cardAlarm.fields.find(f => f.key === 'supported_modes').options.includes('arm_custom_bypass'));
c = config(); assert.equal(M.renamePanel(c, 'a', 'k'), true);
c = config(); assert.equal(M.renamePanel(c, 'b', 'k'), false);
console.log('editor model ok');
