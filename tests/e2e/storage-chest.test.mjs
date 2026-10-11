// Köy Sandığı (storage): oduncu topladığını sandığa koyar, oyuncu panelden alır/koyar, kayıt/yükleme,
// co-op'ta misafir host'taki ortak sandıktan kendi çantasına alır (tıklama host'ta misafir bağlamında).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, waitForScene, assertNoErrors } from './_harness.mjs';
import { setupMP, teleportGuest } from './_mp.mjs';

test('köy sandığı: NPC teslimatı, al/koy paneli, kayıt/yükleme', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(300);

  const r = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const { Survivor } = await import('/js/entities/NPC.js');
    s.timeSys.minutes = 10 * 60;
    s.zombies.getChildren().forEach((z) => z.destroy());
    const out = {};
    const chests = s.storage.chests;
    out.starter = { n: chests.length, starter: chests[0]?.starter, dist: Math.round(Math.hypot(chests[0].x - s.shelter.door.x, chests[0].y - s.shelter.door.y)) };
    const c = chests[0];
    const d = s.shelter.door;

    // Oduncu: ağacı keser, deliver durumunda sandığa yürür ve bırakır
    const a = new Survivor(s, d.x, d.y + 60, { name: 'Ali', slot: 0, arrived: s.timeSys.day, job: 'lumberjack' });
    s.npcs.push(a);
    const tree = a.findResource('tree');
    a.sm.set('goRes', tree);
    a.setPosition(tree.x + a.side, tree.y + 8);
    a.update(0.016);
    for (let i = 0; i < 12 && !tree.depleted; i++) a.update(1.4);
    out.carry = a.carry.wood || 0;
    const invWood = s.inventory.count('wood');
    a.sm.set('deliver');
    out.dropAt = a.dropAt === c;
    a.setPosition(c.x, c.y + 12);
    a.update(0.016);
    out.afterDeliver = { state: a.sm.name, chestWood: c.inv.count('wood'), invWood: s.inventory.count('wood') - invWood, carry: Object.keys(a.carry).length };

    // Sandık yokken eski davranış: oyuncuya
    const real = s.storage.forCarry;
    s.storage.forCarry = () => null;
    a.carry = { stone: 3 };
    const st0 = s.inventory.count('stone');
    a.unload();
    out.fallback = s.inventory.count('stone') - st0;
    s.storage.forCarry = real;

    // Oyuncu sandığın yanına: etkileşim etiketi (Ali kenara çekilsin)
    a.hide(); a.sm.set('sheltered');
    s.player.setPosition(c.x, c.y + 14);
    const act = s.bestInteraction();
    out.label = act?.label || '';
    act?.run();
    out.panel = !!document.querySelector('#modal-feature.show .stg-chest');
    return out;
  });
  assert.deepEqual({ n: r.starter.n, starter: r.starter.starter }, { n: 1, starter: true }, 'başlangıç sandığı');
  assert.ok(r.starter.dist < 100, `sandık sığınağa yakın (${r.starter.dist})`);
  assert.ok(r.carry >= 2, 'odun taşınmalı');
  assert.equal(r.dropAt, true, 'deliver hedefi sandık');
  assert.equal(r.afterDeliver.chestWood, r.carry, 'odun sandığa konmalı ' + JSON.stringify(r));
  assert.equal(r.afterDeliver.invWood, 0, 'oyuncuya gitmemeli');
  assert.equal(r.afterDeliver.carry, 0);
  assert.equal(r.afterDeliver.state, 'seek');
  assert.equal(r.fallback, 3, 'sandık yoksa oyuncuya verilir');
  assert.match(r.label, /Köy Sandığı/);
  assert.equal(r.panel, true, 'panel açılmalı');

  // Sandıktaki odun yığınına tıkla → çantaya
  const w0 = await page.evaluate(() => game.scene.getScene('Game').inventory.count('wood'));
  await page.click('#modal-feature .stg-chest .slot:has(img)');
  const took = await page.evaluate(() => { const s = game.scene.getScene('Game'); return { inv: s.inventory.count('wood'), chest: s.storage.count('wood') }; });
  assert.equal(took.chest, 0, 'sandık boşalmalı');
  assert.equal(took.inv - w0, r.carry, 'odun çantaya geçmeli');

  // Çantadaki bir eşyaya tıkla → sandığa koy; Tümünü Al geri alır
  const idx = await page.evaluate(() => { const s = game.scene.getScene('Game'); s.inventory.add('rare_core', 2); s.hud.closeAll(); s.bestInteraction().run(); return s.inventory.slots.findIndex((x) => x?.id === 'rare_core'); });
  await page.click(`#modal-feature .stg-bag .slot:nth-child(${idx + 1})`);
  assert.equal(await page.evaluate(() => game.scene.getScene('Game').storage.count('rare_core')), 2, 'koy');
  await page.click('#modal-feature .stg-takeall');
  assert.deepEqual(await page.evaluate(() => { const s = game.scene.getScene('Game'); return [s.storage.count('rare_core'), s.inventory.count('rare_core')]; }), [0, 2], 'tümünü al');

  // Kayıt / yükleme: içerik ve ek (üretilmiş) sandık korunur
  const saved = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const { ITEMS, RECIPES, TILE } = await import('/js/config.js');
    const { canPlace } = await import('/js/systems/PlayerActions.js');
    s.hud.closeAll();
    const c = s.storage.chests[0];
    c.inv.add('stone', 7); c.inv.add('bread', 2);
    // Tarifle üret, oyuncunun yanına yerleştir
    const rec = RECIPES.find((x) => x.out === 'storage_chest');
    s.inventory.add('wood', rec.cost.wood);
    s.inventory.craft(rec);
    const p = s.player;
    let ctx = null;
    for (let dy = -2; dy <= 2 && !ctx; dy++) for (let dx = -2; dx <= 2 && !ctx; dx++) {
      const tx = Math.floor(p.x / TILE) + dx, ty = Math.floor(p.y / TILE) + dy, cx = tx * TILE + 8, cy = ty * TILE + 8;
      if ((dx || dy) && canPlace(s, cx, cy) && !s.farm.blocked?.has(s.farm.key(tx, ty))) ctx = { tx, ty, cx, cy, inReach: true, slot: { id: 'storage_chest' } };
    }
    if (ctx) ITEMS.storage_chest.onUse(s, ctx);
    const placed = s.storage.chests.length === 2 && s.inventory.count('storage_chest') === 0;
    s.saveGame(true);
    return { n: s.storage.chests.length, placed, crafted: !!rec };
  });
  assert.equal(saved.crafted, true, 'tarif olmalı');
  assert.equal(saved.placed, true, 'üretilen sandık yerleştirilmeli');
  await page.reload();
  await waitForScene(page);
  await page.waitForSelector('#menu.show', { timeout: 15000 });
  await page.click('#btn-continue');
  await page.waitForFunction(() => game.scene.getScene('Game').started === true, null, { timeout: 10000 });
  const loaded = await page.evaluate(() => { const s = game.scene.getScene('Game'); return { n: s.storage.chests.length, starters: s.storage.chests.filter((c) => c.starter).length, stone: s.storage.count('stone'), bread: s.storage.count('bread') }; });
  assert.deepEqual(loaded, { n: saved.n, starters: 1, stone: 7, bread: 2 }, 'kayıttan sandıklar yüklenmeli');
  assertNoErrors(assert, errors);
});

test('co-op: misafir ortak sandıktan kendi çantasına alır ve koyar', { timeout: 90000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t);
  const pos = await host.evaluate(() => {
    const s = game.scene.getScene('Game');
    s.zombies.getChildren().forEach((z) => z.destroy());
    const c = s.storage.chests[0];
    c.inv.add('rare_core', 4);
    return { x: c.x, y: c.y + 14 };
  });
  await teleportGuest(host, guest, pos.x, pos.y);
  await guest.evaluate(() => game.scene.getScene('Game').interact());
  await guest.waitForSelector('#modal-feature.show .stg-chest .slot img', { timeout: 6000 });
  await guest.click('#modal-feature .stg-chest .slot:has(img)');
  await guest.waitForFunction(() => game.scene.getScene('Game').inventory.count('rare_core') === 4, null, { timeout: 5000 });
  const h = await host.evaluate(() => {
    const s = game.scene.getScene('Game');
    return { chest: s.storage.count('rare_core'), hostInv: s.inventory.count('rare_core'), guestInv: [...s.net.guests.values()][0].inv.count('rare_core') };
  });
  assert.deepEqual(h, { chest: 0, hostInv: 0, guestInv: 4 }, 'misafirin çantasına geçmeli');

  // Host aynı anda sandığa koyunca misafirin açık paneli yenilenir; misafir çantasından geri koyar
  await host.evaluate(() => game.scene.getScene('Game').storage.chests[0].inv.add('stone', 5));
  await guest.waitForFunction(() => document.querySelectorAll('#modal-feature.show .stg-chest .slot img').length === 1, null, { timeout: 5000 });
  const gi = await guest.evaluate(() => game.scene.getScene('Game').inventory.slots.findIndex((x) => x?.id === 'rare_core'));
  assert.ok(gi >= 0);
  await guest.click(`#modal-feature .stg-bag .slot:nth-child(${gi + 1})`);
  await host.waitForFunction(() => game.scene.getScene('Game').storage.count('rare_core') === 4, null, { timeout: 5000 });
  await guest.waitForFunction(() => game.scene.getScene('Game').inventory.count('rare_core') === 0, null, { timeout: 5000 });
  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});
