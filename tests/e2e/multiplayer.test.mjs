// Çok oyunculu (co-op): aynı tarayıcıda iki sayfa, yerel taşıyıcı (?net=local, BroadcastChannel).
// Misafir bağlanır, iki oyuncu birbirini görür, misafir yürür / zombiye vurur / toprak sürer; host otoriterdir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startServer, CHROME_PATH, collectErrors, waitForScene, assertNoErrors, DESKTOP } from './_harness.mjs';

// İki sayfa aynı anda oynar: arka plandaki sekmenin rAF/zamanlayıcı kısıtlaması kapalı olmalı
const launchBrowser = () => chromium.launch({
  executablePath: CHROME_PATH,
  args: ['--use-angle=swiftshader', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows']
});


test('co-op: host + misafir aynı dünyada', { timeout: 90000 }, async (t) => {
  const srv = await startServer();
  const browser = await launchBrowser();
  t.after(async () => { await browser.close().catch(() => {}); await srv.close(); });
  // Küçük pencere: iki oyun aynı anda yazılımsal WebGL'de çizildiği için kare hızı yeterli kalsın
  const ctx = await browser.newContext({ ...DESKTOP, viewport: { width: 760, height: 480 } });
  const host = await ctx.newPage();
  const guest = await ctx.newPage();
  const hostErr = collectErrors(host), guestErr = collectErrors(guest);

  // --- Host: menü → Çok Oyunculu → oda kur (Normal) ---
  await host.goto(srv.url + '?net=local');
  await host.evaluate(() => localStorage.clear());
  await host.reload();
  await waitForScene(host);
  await host.waitForSelector('#menu.show', { timeout: 15000 });
  await host.click('#btn-mp');
  await host.fill('#mp-name', 'Ali');
  await host.click('#mp-pick button[data-diff="normal"]');
  await host.waitForFunction(() => game.scene.getScene('Game').started && game.scene.getScene('Game').net?.code, null, { timeout: 10000 });
  const code = await host.evaluate(() => game.scene.getScene('Game').net.code);
  assert.match(code, /^ZC-[A-Z]{5}$/);
  assert.ok(await host.isVisible('#net-panel'), 'oda paneli görünmeli');

  // --- Misafir: davet linki → ad → Katıl ---
  await guest.goto(`${srv.url}?net=local&oda=${code}`);
  await waitForScene(guest);
  await guest.waitForSelector('#mp-pick.show', { timeout: 15000 });
  assert.equal(await guest.inputValue('#mp-code'), code);
  await guest.fill('#mp-name', 'Veli');
  await guest.click('#mp-join');
  await guest.waitForFunction(() => game.scene.getScene('Game').net?.started && game.scene.getScene('Game').started, null, { timeout: 15000 });

  // İki oyuncu birbirini görür
  await host.waitForFunction(() => game.scene.getScene('Game').netPlayers?.length === 1, null, { timeout: 5000 });
  await guest.waitForFunction(() => game.scene.getScene('Game').net.avatars.size === 1, null, { timeout: 5000 });
  const seen = await guest.evaluate(() => {
    const s = game.scene.getScene('Game'), a = [...s.net.avatars.values()][0], h = s.net.roster;
    return { visible: a.spr.visible, label: a.label.text, roster: h.map((x) => x.name), inv: s.inventory.slots.filter(Boolean).length, proxies: s.net.mirror.objs.size };
  });
  assert.equal(seen.visible, true);
  assert.equal(seen.label, 'Ali');
  assert.deepEqual(seen.roster, ['Ali', 'Veli']);
  assert.ok(seen.inv >= 3, 'misafir başlangıç envanteri');
  assert.ok(seen.proxies > 5, `aynalanan nesne sayısı: ${seen.proxies}`);

  // --- Misafir yürür → host'ta konumu değişir ---
  const before = await host.evaluate(() => { const p = game.scene.getScene('Game').netPlayers[0]; return { x: p.x, y: p.y }; });
  await guest.keyboard.down('d');
  await guest.waitForTimeout(700);
  await guest.keyboard.up('d');
  const gpos = await guest.evaluate(() => { const p = game.scene.getScene('Game').player; return { x: p.x, y: p.y }; });
  assert.ok(gpos.x > before.x + 15, `misafir yerelde yürümeli: ${before.x} → ${gpos.x}`);
  await host.waitForFunction((x) => Math.abs(game.scene.getScene('Game').netPlayers[0].x - x) < 3, gpos.x, { timeout: 5000 });

  // --- Misafir zombiye vurur → hasar host'ta uygulanır ---
  await host.evaluate(() => {
    const s = game.scene.getScene('Game'), p = s.netPlayers[0];
    const z = s.spawnZombie(p.x + 14, p.y, 'normal');
    z.maxHp = z.hp = 50; z.speed = 0; z.damage = 0; z.update = () => {}; // hedef sabit dursun
    s.__testZ = z;
  });
  // Zombi misafirde görünür
  await guest.waitForFunction(() => game.scene.getScene('Game').zombies.getChildren().some((z) => z.visible), null, { timeout: 5000 });
  const hit = await guest.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const z = s.zombies.getChildren().find((o) => o.visible);
    const empty = s.inventory.slots.findIndex((x, i) => i < 8 && !x);
    s.selectSlot(empty >= 0 ? empty : 7); // boş el: yumruk
    s.player.actionCd = 0;
    const { useSelected } = await import('/js/systems/PlayerActions.js');
    useSelected(s, z.x, z.y);
    return { zx: z.x, px: s.player.x };
  });
  assert.ok(Math.abs(hit.zx - hit.px) < 30, 'zombi misafirin yanında');
  await host.waitForFunction(() => game.scene.getScene('Game').__testZ.hp < 50, null, { timeout: 5000 });

  // --- Misafir toprak sürer → tarla iki tarafta da görünür ---
  // Misafir hareketi istemci otoriterdir: açık çayıra (FARM_ZONE) geç, host konumu alsın
  // (ışınlanmayı host yapar: misafirin kendi ışınlanması hız sınırına takılıp geri alınır)
  await host.evaluate(() => { const n = game.scene.getScene('Game').net; n.teleport([...n.guests.values()][0], 12 * 16 + 8, 14 * 16 + 8); });
  await guest.waitForFunction(() => Math.abs(game.scene.getScene('Game').player.x - 200) < 3, null, { timeout: 5000 });
  const tile = await guest.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const hoe = s.inventory.slots.findIndex((x) => x?.id === 'hoe');
    s.selectSlot(hoe);
    // Oyuncunun çevresinde sürülebilir bir kare bul
    const px = Math.floor(s.player.x / 16), py = Math.floor((s.player.y + 4) / 16);
    let target = null;
    for (let dy = -2; dy <= 2 && !target; dy++) for (let dx = -2; dx <= 2 && !target; dx++) {
      const tx = px + dx, ty = py + dy;
      if (Math.hypot(tx * 16 + 8 - s.player.x, ty * 16 + 8 - s.player.y - 4) > 36) continue;
      if (s.farm.inZone(tx, ty) && !s.farm.get(tx, ty)) target = { tx, ty };
    }
    if (!target) return null;
    s.player.actionCd = 0;
    const { useSelected } = await import('/js/systems/PlayerActions.js');
    useSelected(s, target.tx * 16 + 8, target.ty * 16 + 8);
    return target;
  });
  assert.ok(tile, 'sürülebilir kare bulunmalı');
  await host.waitForFunction(({ tx, ty }) => !!game.scene.getScene('Game').farm.get(tx, ty), tile, { timeout: 5000 });
  await guest.waitForFunction(({ tx, ty }) => !!game.scene.getScene('Game').farm.get(tx, ty), tile, { timeout: 5000 });
  const tileIdx = await guest.evaluate(({ tx, ty }) => game.scene.getScene('Game').layer.getTileAt(tx, ty).index, tile);
  assert.ok(tileIdx === 4 || tileIdx === 5, `misafirde toprak karosu: ${tileIdx}`);

  // --- Uzak panel: misafir envanteri host'ta açılır, HTML misafire gelir ---
  await guest.evaluate(() => game.scene.getScene('Game').hud.toggleInventory());
  await guest.waitForFunction(() => document.querySelector('#modal-inventory.show #inv-grid .slot img'), null, { timeout: 5000 });
  await guest.evaluate(() => game.scene.getScene('Game').hud.closeAll());

  // Host'un kendi durumu misafirden etkilenmedi
  const hostState = await host.evaluate(() => {
    const s = game.scene.getScene('Game');
    return { modal: s.hud.isModalOpen(), hp: s.player.hp, selected: s.selected, paused: s.physics.world.isPaused };
  });
  assert.equal(hostState.modal, false);
  assert.equal(hostState.paused, false);

  await guest.waitForTimeout(500);
  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});
