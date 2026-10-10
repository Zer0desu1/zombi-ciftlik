// Kaydet → sayfayı yenile → Devam Et: oyuncu, envanter, zaman ve özellik durumları korunur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, waitForScene, assertNoErrors } from './_harness.mjs';

const snapshot = () => {
  const s = game.scene.getScene('Game');
  return {
    coins: s.player.coins, hp: Math.round(s.player.hp), x: Math.round(s.player.x), y: Math.round(s.player.y),
    inv: s.inventory.serialize(), day: s.timeSys.day, minutes: Math.floor(s.timeSys.minutes),
    wave: s.waves.wave, kills: s.kills, difficulty: s.difficulty?.id, features: Object.keys(JSON.parse(localStorage.getItem('zombi-ciftlik-save-v1') || '{}').features || {})
  };
};

test('kaydet → yenile → devam et durumu korur', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(800);

  const before = await page.evaluate((snap) => {
    const s = game.scene.getScene('Game');
    s.giveItem('stone', 17);
    s.giveItem('bread', 2);
    s.player.coins = 777;
    s.player.hp = 63;
    s.timeSys.day = 3;
    s.timeSys.minutes = 10 * 60 + 30;
    s.kills = 12;
    s.saveGame(true);
    return (0, eval)(`(${snap})`)();
  }, snapshot.toString());
  assert.ok(before.features.length > 0, 'özellik kayıtları yazılmalı');

  await page.reload();
  await waitForScene(page);
  await page.waitForSelector('#menu.show', { timeout: 15000 });
  assert.equal(await page.isVisible('#btn-continue'), true, 'Devam Et görünmeli');
  await page.click('#btn-continue');
  await page.waitForFunction(() => game.scene.getScene('Game').started === true, null, { timeout: 10000 });

  const after = await page.evaluate((snap) => (0, eval)(`(${snap})`)(), snapshot.toString());
  assert.equal(after.coins, 777);
  assert.equal(after.hp, 63);
  assert.equal(after.day, 3);
  assert.ok(Math.abs(after.minutes - before.minutes) <= 15, `saat: ${before.minutes} → ${after.minutes}`);
  assert.equal(after.kills, 12);
  assert.equal(after.difficulty, before.difficulty);
  assert.ok(Math.abs(after.x - before.x) <= 2 && Math.abs(after.y - before.y) <= 2, 'oyuncu konumu');
  const count = (inv, id) => inv.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
  for (const id of ['stone', 'bread', 'hoe', 'seed_wheat']) assert.equal(count(after.inv, id), count(before.inv, id), id);
  assertNoErrors(assert, errors);
});
