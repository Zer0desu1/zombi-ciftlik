// Yaban hayatı: geyik sürüleri, avlama ganimeti, yardım kolisi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, assertNoErrors } from './_harness.mjs';

test('geyik avı ve yardım kolisi', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(800);

  const start = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    return { deer: s.wildlife.deer.length, huntables: s.wildlife.deer.every((d) => s.huntables.includes(d)), dots: s.minimapDots.length > 0 };
  });
  assert.ok(start.deer >= 2 && start.deer <= 6, `yeni oyunda 2–6 geyik olmalı (${start.deer})`);
  assert.equal(start.huntables, true);

  // Kılıçla (melee) geyik avı: menzil + koni kontrolü huntables'ı da taramalı
  const hunt = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const d = s.wildlife.deer[0];
    d.hp = 1;
    s.player.setPosition(d.x - 12, d.y);
    const before = { v: s.inventory.count('venison'), h: s.inventory.count('hide') };
    return { before, x: d.x, y: d.y };
  });
  await page.evaluate(async ({ x, y }) => {
    const { melee } = await import('./js/systems/PlayerActions.js');
    const s = game.scene.getScene('Game');
    melee(s, x, y, 5);
  }, hunt);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    return { v: s.inventory.count('venison'), h: s.inventory.count('hide') };
  });
  assert.equal(after.v - hunt.before.v, 2, 'geyik ölünce 2 çiğ et');
  assert.equal(after.h - hunt.before.h, 1, 'geyik ölünce 1 deri');

  // Mermi ile vuruş: scene.bullets çakışması
  const shot = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    if (!s.wildlife.deer.length) s.wildlife.spawnHerd({ minDist: 0 });
    const d = s.wildlife.deer[0];
    // Geyik kaçmasın (yük altında kare hızı düşünce mermi yolundan çıkıyordu) ve sabit süre yerine oyun durumunu bekle
    d.tick = () => {}; d.setVelocity(0, 0);
    const hp = d.hp;
    s.player.setPosition(d.x - 100, d.y);
    s.fireBullet(d.x - 20, d.y, 0, 2, 320);
    for (let i = 0; i < 40 && d.hp >= hp; i++) await new Promise((r) => setTimeout(r, 100));
    return { hp, now: d.hp };
  });
  assert.ok(shot.now < shot.hp, `mermi geyiğe hasar vermeli (${shot.hp} → ${shot.now})`);

  // Ok/saçma: combat'ın scene.shotGroup çakışması
  const arrow = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    if (!s.wildlife.deer.length) s.wildlife.spawnHerd({ minDist: 0 });
    const d = s.wildlife.deer[0];
    d.tick = () => {}; d.setVelocity(0, 0);
    const hp = d.hp;
    s.player.setPosition(d.x - 100, d.y);
    const a = s.shotGroup.create(d.x - 20, d.y, 'cb_arrow');
    Object.assign(a, { isShot: true, dmg: 1, crit: false, weapon: 'bow', pierce: 0, sx: a.x, sy: a.y, range: 200 });
    a.setVelocity(300, 0);
    for (let i = 0; i < 40 && (d.hp >= hp || a.active); i++) await new Promise((r) => setTimeout(r, 100));
    return { hp, now: d.hp, gone: !a.active };
  });
  assert.ok(arrow.now < arrow.hp, `ok geyiğe hasar vermeli (${arrow.hp} → ${arrow.now})`);
  assert.equal(arrow.gone, true, 'isabet eden ok yok olur');

  // Yardım kolisi: düşer, iner, açılınca ganimet verir
  const crate = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const c = s.wildlife.dropCrate();
    for (let i = 0; i < 100 && !c.landed; i++) await new Promise((r) => setTimeout(r, 100)); // iniş oyun zamanında (yükte yavaş)
    s.player.setPosition(c.x, c.y + 10);
    const before = { ammo: s.inventory.count('ammo'), bread: s.inventory.count('bread'), coins: s.player.coins };
    const act = s.bestInteraction();
    const label = act?.label;
    act?.run();
    return { landed: c.landed, label, before, ammo: s.inventory.count('ammo'), bread: s.inventory.count('bread'), coins: s.player.coins, left: !!s.wildlife.crate };
  });
  assert.equal(crate.landed, true, 'koli yere inmeli');
  assert.equal(crate.label, 'Koliyi aç');
  assert.ok(crate.ammo > crate.before.ammo, 'koliden mermi');
  assert.ok(crate.bread > crate.before.bread, 'koliden ekmek');
  assert.ok(crate.coins > crate.before.coins, 'koliden altın');
  assert.equal(crate.left, false, 'açılan koli kaybolur');

  // Kayıt: save() JSON'a çevrilebilir; eski kayıt (veri yok) load'u bozmaz
  const saved = await page.evaluate(async () => {
    const { features } = await import('./js/features/index.js');
    const s = game.scene.getScene('Game');
    const f = features.find((x) => x.id === 'wildlife');
    const data = JSON.parse(JSON.stringify(f.save(s)));
    f.load(s, undefined);
    f.load(s, data);
    return { data, pending: s.wildlife.pending };
  });
  assert.equal(typeof saved.data.deer, 'number');
  assert.equal(saved.data.crate, null, 'açılmış koli kayda girmez');
  assert.equal(saved.pending.deer, saved.data.deer);

  await page.waitForTimeout(300);
  assertNoErrors(assert, errors);
});
