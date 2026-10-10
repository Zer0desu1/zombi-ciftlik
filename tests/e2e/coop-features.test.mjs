// Co-op özellik eksikleri: alan hasarı/temas misafire işler, misafir HUD/hava görselleri, tüm özellik panelleri
// misafirde açılıp kullanılır, ilerleme oyuncu başına, balık tutma, oyun sonu aynı odaya otomatik yeniden katılma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoErrors } from './_harness.mjs';
import { setupMP, teleportGuest, guestUse } from './_mp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ghp = (host) => host.evaluate(() => game.scene.getScene('Game').netPlayers[0].hp);

test('co-op: alan hasarı, asit, slime teması ve buz yavaşlatması misafire işler; ganimet misafire gider', { timeout: 120000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t);
  await teleportGuest(host, guest, 200, 232);

  // Patlayan zombi
  let before = await ghp(host);
  await host.evaluate(() => {
    const s = game.scene.getScene('Game'), p = s.netPlayers[0];
    const z = s.spawnZombie(p.x + 10, p.y, 'bloater');
    z.explode();
  });
  await host.waitForFunction((b) => game.scene.getScene('Game').netPlayers[0].hp < b, before, { timeout: 3000 });
  const after = await ghp(host);
  await guest.waitForFunction((v) => Math.abs(game.scene.getScene('Game').player.hp - v) < 1.5, after, { timeout: 3000 });

  // Asit gölcüğü (tükürükçü)
  before = await ghp(host);
  await host.evaluate(() => {
    const s = game.scene.getScene('Game'), p = s.netPlayers[0];
    p.invuln = 0;
    s.zfx.pools.push({ x: p.x, y: p.y + 6, life: 2, tick: 0, img: s.add.image(p.x, p.y + 6, 'shadow') });
  });
  await host.waitForFunction((b) => game.scene.getScene('Game').netPlayers[0].hp < b, before, { timeout: 3000 });

  // Buz slime'ı teması → hasar + misafirde yavaşlama
  await host.evaluate(() => { const p = game.scene.getScene('Game').netPlayers[0]; p.invuln = 0; p.hp = p.maxHp; });
  before = await ghp(host);
  await host.evaluate(() => { const s = game.scene.getScene('Game'), p = s.netPlayers[0]; s.monsters.spawn({ at: { x: p.x + 4, y: p.y - 2 }, kind: 'blue' }); });
  await host.waitForFunction((b) => game.scene.getScene('Game').netPlayers[0].hp < b, before, { timeout: 4000 });
  await guest.waitForFunction(() => game.scene.getScene('Game').net.slowT > 0, null, { timeout: 3000 });

  // Ganimet: misafirin yanına düşen altın misafire gider
  const coins = await host.evaluate(() => game.scene.getScene('Game').netPlayers[0].coins);
  await host.evaluate(() => {
    const s = game.scene.getScene('Game'), p = s.netPlayers[0];
    s.monsters.slimes.forEach((m) => m.destroy());
    const z = s.spawnZombie(p.x + 6, p.y, 'normal');
    z.reward = 0;
    s.events.emit('zombieKilled', z); // ganimet zarı (altın %40) — garanti için doğrudan altın bırak
    s.zst.loot.push({ img: s.add.image(p.x + 8, p.y, 'z_coin'), kind: 'coin', id: null, n: 7, x: p.x + 8, y: p.y + 4, life: 10, mag: false, ready: true, phase: 0 });
    z.destroy();
  });
  await host.waitForFunction((c) => game.scene.getScene('Game').netPlayers[0].coins >= c + 7, coins, { timeout: 4000 });
  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});

test('co-op: misafirde hava/HUD göstergeleri, tüm özellik panelleri, ilerleme oyuncu başına, balık tutma', { timeout: 150000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t);

  // Hava: host yağmur yağdırır → misafirde yağmur parçacığı, hava rozeti, kiler rozeti, yetenek rozeti
  await host.evaluate(() => game.scene.getScene('Game').setWeather('rain', true));
  await guest.waitForFunction(() => {
    const s = game.scene.getScene('Game'), w = s._world;
    return w.weather === 'rain' && (w.rain.emitting || w.snow.emitting) && document.querySelector('#wx-badge.show')
      && document.getElementById('hv-badge')?.textContent.includes('🧺') && document.querySelector('#prog-badge')?.textContent.includes('⭐');
  }, null, { timeout: 5000 });
  await host.evaluate(() => game.scene.getScene('Game').setWeather('fog', true));
  await guest.waitForFunction(() => { const w = game.scene.getScene('Game')._world; return w.fog.visible && !w.rain.emitting; }, null, { timeout: 5000 });

  // Mühimmat göstergesi: misafire tabanca + mermi verilir, seçilince şarjör etiketi görünür
  await host.evaluate(() => { const g = [...game.scene.getScene('Game').net.guests.values()][0]; g.inv.add('pistol', 1); g.inv.add('ammo', 12); });
  await guest.waitForFunction(() => game.scene.getScene('Game').inventory.count('pistol') === 1, null, { timeout: 4000 });
  await guest.evaluate(() => { const s = game.scene.getScene('Game'); s.selectSlot(s.inventory.slots.findIndex((x) => x?.id === 'pistol')); });
  await guest.waitForFunction(() => document.querySelector('.cb-ammo.show')?.textContent.includes('🔫'), null, { timeout: 4000 });

  // Tüm özellik panelleri misafirde host'ta açılır, ilk düğmesine basılır, kapanır
  const entries = await guest.evaluate(() => game.scene.getScene('Game').featureMenu.map((m) => m.id));
  const LOCAL = new Set(['minimap', 'juice-settings', 'help']);
  const opened = [];
  for (const id of entries) {
    if (LOCAL.has(id)) continue;
    await guest.evaluate((id) => game.scene.getScene('Game').featureMenu.find((m) => m.id === id).open(game.scene.getScene('Game')), id);
    const ok = await guest.waitForFunction(() => game.scene.getScene('Game').net.remoteModal && document.querySelector('.modal.show, #modal-feature.show, #modal-dialog.show, #modal-shop.show, #modal-inventory.show'), null, { timeout: 4000 }).then(() => true, () => false);
    if (ok) {
      // İlk etkin, kapatma olmayan düğme
      await guest.evaluate(() => {
        const s = game.scene.getScene('Game'), sel = { inventory: '#modal-inventory', dialog: '#modal-dialog', shop: '#modal-shop', feature: '#modal-feature' }[s.net.remoteModal];
        const b = [...document.querySelectorAll(`${sel} button`)].find((x) => !x.disabled && !x.closest('[data-close]') && !x.hasAttribute('data-close'));
        b?.click();
      });
      await sleep(300);
      await guest.evaluate(() => game.scene.getScene('Game').hud.closeAll());
      await sleep(150);
    }
    opened.push(`${id}:${ok ? 'açıldı' : 'AÇILMADI'}`);
  }
  console.log(`[paneller] ${opened.join(' · ')}`);
  assert.ok(!opened.some((x) => x.endsWith('AÇILMADI')), `açılmayan panel: ${opened.join(', ')}`);
  // Host'un kendi paneli/DOM'u etkilenmedi
  assert.equal(await host.evaluate(() => game.scene.getScene('Game').hud.isModalOpen()), false);

  // Uzak panelde giriş alanı değeri host'a gider (ör. envanter ipucu yerelde) — envanterde fareyle ipucu
  await guest.evaluate(() => game.scene.getScene('Game').hud.toggleInventory());
  await guest.waitForSelector('#modal-inventory.show #inv-grid .slot img', { timeout: 5000 });
  await guest.hover('#modal-inventory #inv-grid .slot:first-child');
  await guest.waitForFunction(() => document.querySelector('.tip.show, #tip.show, .item-tip.show') || game.scene.getScene('Game').hud.tip?.classList.contains('show'), null, { timeout: 3000 });
  await guest.evaluate(() => game.scene.getScene('Game').hud.closeAll());

  // İlerleme oyuncu başına: misafir zombi öldürür → misafirin Savaş XP'si artar, host'unki değişmez
  await teleportGuest(host, guest, 200, 232);
  const xp0 = await host.evaluate(() => { const s = game.scene.getScene('Game'), g = [...s.net.guests.values()][0]; return { h: s.prog.xp.combat, g: g.fstate.progression.xp.combat, hk: s.prog.stats.kills, gk: g.fstate.progression.stats.kills }; });
  const zp = await host.evaluate(() => { const s = game.scene.getScene('Game'), p = s.netPlayers[0]; const z = s.spawnZombie(p.x + 12, p.y, 'normal'); z.hp = 1; z.speed = 0; z.damage = 0; return [z.x, z.y]; });
  await sleep(400);
  await guestUse(guest, 'sword', zp[0], zp[1]);
  await host.waitForFunction((g0) => { const g = [...game.scene.getScene('Game').net.guests.values()][0]; return g.fstate.progression.stats.kills > g0; }, xp0.gk, { timeout: 4000 });
  const xp1 = await host.evaluate(() => { const s = game.scene.getScene('Game'), g = [...s.net.guests.values()][0]; return { h: s.prog.xp.combat, g: g.fstate.progression.xp.combat, hk: s.prog.stats.kills }; });
  assert.ok(xp1.g > xp0.g, 'misafirin XP\'si artmalı');
  assert.equal(xp1.h, xp0.h, 'host XP\'si değişmemeli');
  assert.equal(xp1.hk, xp0.hk, 'host öldürme sayısı değişmemeli');
  // Silah seviyesi oyuncu başına
  const lv = await host.evaluate(() => {
    const s = game.scene.getScene('Game'), n = s.net, g = [...n.guests.values()][0];
    g.fstate.combat.sword = 3;
    return { host: s.combat.weaponLevel('sword'), guest: n.withGuest(g, () => s.combat.weaponLevel('sword')), after: s.combat.weaponLevel('sword') };
  });
  assert.deepEqual(lv, { host: 1, guest: 3, after: 1 });

  // Balık tutma: misafir göl kıyısında oltayla etkileşir → mini oyun misafirde açılır → sonuç host'ta doğrulanır
  await host.evaluate(() => { const g = [...game.scene.getScene('Game').net.guests.values()][0]; g.inv.add('fishing_rod', 1); g.player.energy = g.player.maxEnergy; });
  const shore = await host.evaluate(() => { const r = game.scene.getScene('Game').lakeRect; return [r.right + 8, r.centerY]; });
  await teleportGuest(host, guest, shore[0], shore[1]);
  await guest.waitForFunction(() => game.scene.getScene('Game').inventory.count('fishing_rod') === 1, null, { timeout: 4000 });
  await guestUse(guest, 'fishing_rod', shore[0] - 20, shore[1]);
  await guest.waitForSelector('#modal-feature.show .fish-wrap', { timeout: 5000 });
  assert.equal(await guest.evaluate(() => game.scene.getScene('Game').net.remoteModal), null, 'mini oyun yerel panel');
  // Çok erken bildirilen sonuç reddedilir; makul sürede gelen kabul edilir
  await sleep(1400);
  const fish0 = await host.evaluate(() => [...game.scene.getScene('Game').net.guests.values()][0].inv.slots.filter((x) => x?.id?.startsWith('fish_')).length);
  await guest.evaluate(() => game.scene.getScene('Game').net.send({ t: 'fishDone', ok: 1 }));
  await host.waitForFunction((f0) => [...game.scene.getScene('Game').net.guests.values()][0].inv.slots.filter((x) => x?.id?.startsWith('fish_')).length > f0, fish0, { timeout: 4000 });
  await guest.evaluate(() => game.scene.getScene('Game').hud.closeAll());

  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});

test('co-op: oyun sonu → host yeniden başlatır → misafir aynı oda koduyla otomatik geri katılır', { timeout: 120000 }, async (t) => {
  const { host, guest, code, hostErr, guestErr } = await setupMP(t);
  await host.evaluate(() => game.scene.getScene('Game').onGameOver());
  await guest.waitForSelector('#gameover.show', { timeout: 5000 });
  assert.match(await guest.textContent('#gameover button'), /yeniden katıl/i);
  await host.waitForSelector('#gameover.show', { timeout: 5000 });
  await host.click('#gameover button');
  await host.waitForFunction((c) => { const s = game.scene.getScene('Game'); return s.started && !s.gameOver && s.net?.code === c; }, code, { timeout: 10000 });
  await guest.waitForFunction((c) => { const s = game.scene.getScene('Game'); return s.net?.started && s.started && !s.gameOver && s.net.code === c; }, code, { timeout: 20000 });
  await host.waitForFunction(() => game.scene.getScene('Game').net.guests.size === 1, null, { timeout: 5000 });
  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});
