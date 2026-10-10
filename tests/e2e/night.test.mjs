// Zamanı TimeSystem üzerinden ileri sarar: akşam → dalga başlar, zombi doğar → şafak gelir, dalga biter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, assertNoErrors } from './_harness.mjs';

test('gece dalgası ve şafak döngüsü', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);

  await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    window.__ev = [];
    ['waveStart', 'waveEnd', 'hordeIncoming', 'zombieKilled'].forEach((e) => s.events.on(e, () => window.__ev.push(e)));
    ['dusk', 'dawn'].forEach((e) => s.timeSys.on(e, () => window.__ev.push(e)));
    s.player.hp = s.player.maxHp = 1e6; // test sırasında bayılıp akışı bozmasın
    s.timeSys.minutes = 20 * 60 - 1;
  });

  await page.waitForFunction(() => window.__ev.includes('dusk') && window.__ev.includes('waveStart'), null, { timeout: 10000 });
  const night = await page.evaluate(() => { const s = game.scene.getScene('Game'); return { active: s.waves.active, wave: s.waves.wave, night: s.timeSys.isNight, toSpawn: s.waves.toSpawn }; });
  assert.equal(night.active, true);
  assert.equal(night.wave, 1);
  assert.equal(night.night, true);
  assert.ok(night.toSpawn > 0, 'doğum kuyruğu');

  // İlk sürü ~3 sn sonra çıkar; yavaş (swiftshader) karelere pay bırak
  await page.waitForFunction(() => game.scene.getScene('Game').zombies.countActive(true) > 0, null, { timeout: 25000 });
  const z = await page.evaluate(() => game.scene.getScene('Game').zombies.countActive(true));
  assert.ok(z > 0, 'zombi doğmalı');

  await page.evaluate(() => { const s = game.scene.getScene('Game'); s.timeSys.minutes = 6 * 60 - 0.5; });
  await page.waitForFunction(() => window.__ev.includes('dawn') && window.__ev.includes('waveEnd'), null, { timeout: 10000 });
  const dawn = await page.evaluate(() => { const s = game.scene.getScene('Game'); return { active: s.waves.active, day: s.timeSys.day, night: s.timeSys.isNight, ev: window.__ev }; });
  assert.equal(dawn.active, false);
  assert.equal(dawn.day, 2);
  assert.equal(dawn.night, false);
  assert.ok(dawn.ev.indexOf('dusk') < dawn.ev.indexOf('dawn'), `olay sırası: ${dawn.ev}`);

  // Güneşte yanan zombiler kısa sürede temizlenir
  await page.waitForFunction(() => game.scene.getScene('Game').zombies.countActive(true) === 0, null, { timeout: 15000 }).catch(() => {});
  const left = await page.evaluate(() => game.scene.getScene('Game').zombies.countActive(true));
  assert.equal(left, 0, 'şafakta zombi kalmamalı');
  assertNoErrors(assert, errors);
});
