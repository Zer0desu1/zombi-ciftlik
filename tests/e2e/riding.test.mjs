// Binekler: evcil ayıya bin → hız artar → in; Kemal'in atı (dükkân, kullan → belirir), ata bin, kayıt/yükleme;
// co-op: misafir ata binince hızlanır ve host hareket denetimi düzeltme yapmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, assertNoErrors, waitForScene } from './_harness.mjs';
import { setupMP } from './_mp.mjs';

// Sağa d tuşuyla ms boyunca yürü, alınan yol (px)
async function walkRight(page, ms) {
  const x0 = await page.evaluate(() => game.scene.getScene('Game').player.x);
  await page.keyboard.down('d');
  await page.waitForTimeout(ms);
  await page.keyboard.up('d');
  await page.waitForTimeout(80);
  return (await page.evaluate(() => game.scene.getScene('Game').player.x)) - x0;
}

// Açık çayır: köyün batısı (engelsiz düz yol için)
const clearSpot = () => {
  const s = game.scene.getScene('Game');
  s.player.invuln = 999;
  s.player.setPosition(12 * 16, 24 * 16 + 8);
  s.resources.getChildren().forEach((r) => { if (Math.abs(r.y - s.player.y) < 40 && r.x > s.player.x - 20 && r.x < s.player.x + 400) r.destroy(); });
  s.obstacles.getChildren().forEach((r) => { if (Math.abs(r.y - s.player.y) < 30 && r.x > s.player.x - 20 && r.x < s.player.x + 400 && r.texture.key !== 'fence') r.body.enable = false; });
};

test('binek: evcil ayı ve at, panel, hız, kayıt', { timeout: 90000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(500);
  await page.evaluate(clearSpot);

  const base = await walkRight(page, 600);
  assert.ok(base > 20, `yürüyerek ilerlemeli (${base})`);

  // Evcil ayı: E → panel → 🐎 Bin
  const rode = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const [b] = s.predators.spawn('bear', { at: { x: s.player.x + 16, y: s.player.y }, n: 1, fade: false });
    s.predators.makePet(b, null, { hp: 70 });
    // Çevredeki rastgele etkileşimler (mantar, böğürtlen…) yarışmasın: binek etkileşimini doğrudan seç
    const act = s.interactions.map((f) => f(s)).find((r) => /Bin/.test(r?.label || ''));
    const label = act?.label;
    act?.run();
    const btn = [...document.querySelectorAll('#modal-feature .feature-body button')].find((x) => /Bin/.test(x.textContent));
    btn?.click();
    return { label, mounted: !!s.player.mounted, mul: s.player.mountMul, rider: b.rider === s.player, body: b.body.enable, modal: s.hud.modal };
  });
  assert.match(rode.label || '', /Bin/, `etiket (${rode.label})`);
  assert.equal(rode.mounted, true, 'ayıya binildi');
  assert.equal(rode.mul, 1.35);
  assert.equal(rode.rider, true);
  assert.equal(rode.body, false, 'binerken binek gövdesi kapalı');
  assert.ok(!rode.modal, 'panel kapanır');

  await page.evaluate(clearSpot);
  const onBear = await walkRight(page, 600);
  assert.ok(onBear > base * 1.2, `ayıyla daha hızlı (${onBear} > ${base})`);
  const under = await page.evaluate(() => { const s = game.scene.getScene('Game'), b = s.player.mount; return { dx: Math.abs(b.x - s.player.x), above: b.depth > s.player.depth }; });
  assert.ok(under.dx < 1, 'binek binicinin altında');
  assert.equal(under.above, true, 'binek binicinin bacaklarını örter');

  // İn
  const off = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const b = s.player.mount;
    const act = s.bestInteraction();
    const label = act?.label;
    act?.run();
    return { label, mounted: !!s.player.mounted, mul: s.player.mountMul, body: b.body.enable, rider: !!b.rider };
  });
  assert.match(off.label || '', /İn/, `in etiketi (${off.label})`);
  assert.equal(off.mounted, false);
  assert.equal(off.mul, 1);
  assert.equal(off.body, true);
  assert.equal(off.rider, false);

  // At: Kemal'in dükkânında, kullanınca yanına gelir
  const horse = await page.evaluate(async () => {
    const { SHOPS } = await import('./js/config.js');
    const s = game.scene.getScene('Game');
    s.predators.pets.forEach((b) => { b.state = 'stay'; b.setPosition(b.x, b.y + 200); });
    s.inventory.add('horse', 1);
    s.player.actionCd = 0;
    const { ITEMS } = await import('./js/config.js');
    ITEMS.horse.onUse(s);
    const h = s.riding.horses[0];
    s.player.setPosition(h.x - 10, h.y);
    const act = s.interactions.map((f) => f(s)).find((r) => /🐎/.test(r?.label || ''));
    return { shop: SHOPS.merchant.some((o) => o.id === 'horse'), n: s.riding.horses.length, left: s.inventory.count('horse'), label: act?.label, mount: s.riding.mount(s.player, h), mul: s.player.mountMul, tex: s.textures.exists('mt_horse') && s.anims.exists('mt_horse_walk') };
  });
  assert.equal(horse.shop, true, 'Kemal at satar');
  assert.equal(horse.n, 1, 'at belirdi');
  assert.equal(horse.left, 0, 'eşya harcandı');
  assert.match(horse.label || '', /🐎/);
  assert.equal(horse.mount, true);
  assert.equal(horse.mul, 1.8);
  assert.equal(horse.tex, true);

  await page.evaluate(clearSpot);
  const onHorse = await walkRight(page, 600);
  assert.ok(onHorse > base * 1.5, `atla çok daha hızlı (${onHorse} > ${base})`);

  // Kayıt → yükleme: at geri gelir, oyuncu inmiş başlar
  await page.evaluate(() => game.scene.getScene('Game').saveGame(true));
  await page.goto(url + '?e2e=' + Date.now());
  await waitForScene(page);
  await page.waitForSelector('#menu.show', { timeout: 15000 });
  await page.click('#btn-continue');
  await page.waitForFunction(() => game.scene.getScene('Game').started === true, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  const loaded = await page.evaluate(() => { const s = game.scene.getScene('Game'); return { n: s.riding.horses.length, name: s.riding.horses[0]?.horseName, mounted: !!s.player.mounted, mul: s.player.mountMul || 1 }; });
  assert.equal(loaded.n, 1, 'at kayıttan geri geldi');
  assert.ok(loaded.name, 'atın adı korunur');
  assert.equal(loaded.mounted, false, 'yüklemede inmiş');
  assert.equal(loaded.mul, 1);

  assertNoErrors(assert, errors, 'binek');
});

test('binek co-op: misafir ata biner, hızlanır, host düzeltme yapmaz', { timeout: 90000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t);
  await host.waitForTimeout(400);
  const nid = await host.evaluate(() => {
    const s = game.scene.getScene('Game'), g = [...s.net.guests.values()][0];
    const h = s.riding.addHorse(g.player.x + 14, g.player.y, g.name);
    return { ok: s.riding.mount(g.player, h), mul: g.player.mountMul, corr: g.corrections || 0 };
  });
  assert.equal(nid.ok, true);
  assert.equal(nid.mul, 1.8);
  await guest.waitForFunction(() => game.scene.getScene('Game').player.mountMul === 1.8, null, { timeout: 4000 });
  await guest.bringToFront();
  await guest.evaluate(() => { const p = game.scene.getScene('Game').player; p.invuln = 999; });
  const moved = await walkRight(guest, 700);
  await host.waitForTimeout(500);
  // Host'ta at, misafirin son bildirilen konumuna bir sonraki karede oturur: konum mesajları kare dışında gelebilir
  await host.waitForFunction(() => { const s = game.scene.getScene('Game'), g = [...s.net.guests.values()][0], h = s.riding.horses[0]; return Math.abs(h.x - g.player.x) < 2; }, null, { timeout: 4000 }).catch(() => {});
  const after = await host.evaluate(() => { const s = game.scene.getScene('Game'), g = [...s.net.guests.values()][0]; const h = s.riding.horses[0]; return { corr: g.corrections || 0, dx: Math.abs(h.x - g.player.x) }; });
  assert.ok(moved > 60, `misafir atla ilerler (${moved})`);
  assert.equal(after.corr, nid.corr, 'host hız düzeltmesi yapmamalı');
  assert.ok(after.dx < 2, 'host\'ta at misafirin altında');
  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});
