// Doğadaki tavuk/inek/koyun: yakala → kendi başına ağıla yürür → ağıl hayvanı olur → kayıtta kalır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, waitForScene, assertNoErrors } from './_harness.mjs';

// Oyuncunun yanına tek hayvanlık sürü koy ve en yakın etkileşimi döndür
const placeAndHint = ({ kind, x, y }) => {
  const s = game.scene.getScene('Game');
  const [a] = s.wildstock.spawnHerd({ kind, n: 1, instant: true, at: { x, y } });
  a.wait = 99; a.halt();
  s.player.setPosition(x - 10, y);
  s.player.setVelocity(0, 0);
  window.__stray = a;
  return s.bestInteraction()?.label || '';
};

const waitPen = async (page, kind, n) => page.waitForFunction(({ kind, n }) => {
  const s = game.scene.getScene('Game');
  return s.ranch.animals.filter((a) => a.type === kind).length >= n;
}, { kind, n }, { timeout: 20000, polling: 200 });

test('doğadaki hayvanı yakala → ağıla girer → kayıtta kalır', { timeout: 90000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(600);

  const start = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const w = s.wildstock.list;
    return { n: w.length, kinds: [...new Set(w.map((a) => a.kind))], built: s.ranch.built, sheepType: !!s.ranch && !!s.textures.exists('a_sheep') };
  });
  assert.ok(start.n >= 2, `yeni oyunda yaban sürüleri olmalı (${start.n})`);
  assert.equal(start.built, false);
  assert.equal(start.sheepType, true, 'koyun dokusu');

  // Ağıl yokken: halatsız koyun yakalanamaz; halatla yakalanınca peşinden gelir
  const spot = { kind: 'sheep', x: 420, y: 330 };
  const noRope = await page.evaluate(placeAndHint, spot);
  assert.match(noRope, /Yakala: Koyun \(Halat gerekir\)/);
  const follow = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    s.bestInteraction().run();
    const refused = window.__stray.mode;
    s.giveItem('rope', 2);
    s.player.actionCd = 0;
    const label = s.bestInteraction()?.label;
    s.bestInteraction().run();
    return { refused, label, mode: window.__stray.mode, rope: s.inventory.count('rope') };
  });
  assert.equal(follow.refused, 'graze', 'halatsız yakalanmaz');
  assert.equal(follow.label, '🪢 Yakala: Koyun');
  assert.equal(follow.mode, 'follow', 'ağıl yokken peşinden gelir');
  assert.equal(follow.rope, 1, 'halat harcanır');

  // Ağılı kur → peşteki koyun kendi başına ağıla yürür
  await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    s.giveItem('wood', 20); s.giveItem('stone', 10); s.player.coins += 100;
    s.player.setPosition(418, 202);
    const act = s.bestInteraction();
    if (!/Ağıl kur/.test(act?.label || '')) throw new Error('ağıl etkileşimi yok: ' + act?.label);
    act.run();
  });
  await page.waitForFunction(() => window.__stray.mode === 'lead' || !window.__stray.active, null, { timeout: 5000 });
  await waitPen(page, 'sheep', 1);

  // Ağıl varken: inek yakalanır, doğrudan ağıla yürür
  const cow = await page.evaluate(placeAndHint, { kind: 'cow', x: 520, y: 330 });
  assert.equal(cow, '🪢 Yakala: İnek');
  const cowMode = await page.evaluate(() => { game.scene.getScene('Game').bestInteraction().run(); return window.__stray.mode; });
  assert.equal(cowMode, 'lead');
  await waitPen(page, 'cow', 1);

  // Tavuk halatsız yakalanır (şansa bağlı: tutana kadar dene)
  await page.evaluate(placeAndHint, { kind: 'chicken', x: 470, y: 300 });
  const chicken = await page.evaluate(() => {
    const s = game.scene.getScene('Game'), a = window.__stray;
    for (let i = 0; i < 30 && !a.tame; i++) { a.mode = 'graze'; a.setPosition(s.player.x + 10, s.player.y); s.wildstock.catch(a); }
    return a.mode;
  });
  assert.equal(chicken, 'lead');
  await waitPen(page, 'chicken', 1);

  const ranch = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const r = s.ranch;
    // Ağıl doluyken yakalama reddedilir (kapasite)
    const cap = r.canAdmit('cow', 99);
    return { types: r.animals.map((a) => a.type).sort(), tame: s.wildstock.list.filter((a) => a.tame).length, cap };
  });
  assert.deepEqual(ranch.types, ['chicken', 'cow', 'sheep']);
  assert.equal(ranch.tame, 0, 'ağıla giren yaban listesinden çıkar');
  assert.equal(ranch.cap, 'full');

  // Kaydet → yenile → devam: ağıldaki yakalanmış hayvanlar ve yoldaki evcil hayvan korunur
  await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    s.ranch.doorsClosed = false;
    const [a] = s.wildstock.spawnHerd({ kind: 'sheep', n: 1, instant: true, at: { x: 1200, y: 800 } });
    s.giveItem('rope', 1);
    s.player.setPosition(a.x - 10, a.y);
    s.wildstock.catch(a);
    s.saveGame(true);
  });
  await page.reload();
  await waitForScene(page);
  await page.waitForSelector('#menu.show', { timeout: 15000 });
  await page.click('#btn-continue');
  await page.waitForFunction(() => game.scene.getScene('Game').started === true, null, { timeout: 10000 });
  const after = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    return { built: s.ranch.built, types: s.ranch.animals.map((a) => a.type).sort(), tame: s.wildstock.list.filter((a) => a.tame).map((a) => a.kind), wild: s.wildstock.list.length };
  });
  assert.equal(after.built, true);
  assert.deepEqual(after.types, ['chicken', 'cow', 'sheep']);
  assert.deepEqual(after.tame, ['sheep'], 'yoldaki evcil koyun kayıttan döner');
  assert.ok(after.wild > after.tame.length, 'yaban sürüleri yeniden belirir');

  await page.waitForTimeout(300);
  assertNoErrors(assert, errors);
});
