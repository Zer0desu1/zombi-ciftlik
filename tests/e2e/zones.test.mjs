// Keşif bölgeleri (zones.js): kilitli geçit, anahtar/köprü ile açılış, ışınlanma, zor zombiler, ganimet, kayıt,
// co-op'ta misafirin bölgeye girip çıkması ve orman kenarı çarpışması. Kısa, hedefli kontroller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { setup, newGame, waitForScene, assertNoErrors, startServer, CHROME_PATH, collectErrors, DESKTOP } from './_harness.mjs';

test('keşif bölgeleri: kilit, açılış, ışınlanma, zombi, ganimet, kayıt', { timeout: 90000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(500);

  // Kilitli kuzey geçidine yürünemez
  const B = await page.evaluate(async () => (await import('./js/systems/MapBuilder.js')).FOREST_PX);
  const blocked = await page.evaluate(async () => {
    const s = game.scene.getScene('Game'), g = s.zones.gate('mine');
    s.player.setPosition(g.mouth.x, g.mouth.y + 6);
    s.virtualMove = { x: 0, y: -1 };
    await new Promise((r) => setTimeout(r, 900));
    s.virtualMove = { x: 0, y: 0 };
    return { y: s.player.y, inZone: s.zones.zoneAt(s.player.x, s.player.y), label: s.bestInteraction()?.label };
  });
  assert.ok(blocked.y >= B - 4, `kilitli geçit geçilmez (y=${blocked.y})`);
  assert.equal(blocked.inZone, null);
  assert.match(blocked.label, /Paslı Anahtar gerekli/);

  // Anahtarla aç, geçide yürüyünce madene ışınlan
  const opened = await page.evaluate(async () => {
    const s = game.scene.getScene('Game'), Z = s.zones, g = Z.gate('mine');
    s.inventory.add('rusty_key', 1);
    s.player.setPosition(g.mouth.x, g.mouth.y + 6);
    const act = s.bestInteraction();
    const label = act?.label;
    act?.run();
    const open = Z.state.mine.open, keys = s.inventory.count('rusty_key'), gateOpen = s.forestEdge.gates.find((o) => o.id === 'north').open;
    s.virtualMove = { x: 0, y: -1 };
    await new Promise((r) => setTimeout(r, 1200));
    s.virtualMove = { x: 0, y: 0 };
    const cam = s.cameras.main;
    return { label, open, keys, gateOpen, zone: Z.zoneAt(s.player.x, s.player.y), camX: cam._bounds.x, ox: Z.defs[0].ox, alive: Z.alive('mine'),
      kinds: [...new Set(s.zombies.getChildren().filter((z) => z.zoneId === 'mine').map((z) => z.kind))] };
  });
  assert.equal(opened.label, 'Paslı Anahtar ile geçidi aç');
  assert.equal(opened.open, true);
  assert.equal(opened.gateOpen, true);
  assert.equal(opened.keys, 0, 'anahtar harcanır');
  assert.equal(opened.zone, 'mine', 'açık geçitten madene ışınlanır');
  assert.equal(opened.camX, opened.ox, 'kamera bölge sınırlarında');
  assert.ok(opened.alive >= 8, `bölgede zombiler: ${opened.alive}`);
  assert.ok(opened.kinds.includes('miner'), 'bölgeye özel Kazmacı var');

  // Zor zombi: gündüz yanmaz, yalnızca bölgedeki oyuncuya saldırır; ana harita zombisi bölgedeki oyuncuyu hedeflemez
  const zb = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const zs = s.zombies.getChildren().filter((z) => z.zoneId === 'mine');
    const z = zs.find((o) => o.kind === 'miner');
    z.burn();
    s.player.invuln = 99;
    s.player.setPosition(z.x + 30, z.y);
    s.waves.active = true; s.waves.end(); // şafak: ana harita zombileri yanar
    const main = s.spawnZombie(300, 300, 'normal');
    const mt = main.pickTarget();
    main.destroy();
    await new Promise((r) => setTimeout(r, 700));
    return { dead: z.dead, active: z.active, target: z.target === s.player, mainTargetsPlayer: mt === s.player, hp: z.maxHp, count: s.zombies.countActive(true) };
  });
  assert.equal(zb.dead, false, 'bölge zombisi güneşte yanmaz');
  assert.equal(zb.active, true);
  assert.equal(zb.target, true, 'yakındaki oyuncuyu hedefler');
  assert.equal(zb.mainTargetsPlayer, false, 'ana harita zombisi bölgedeki oyuncuyu hedeflemez');
  assert.ok(zb.hp >= 15, `güçlendirilmiş can: ${zb.hp}`);
  assert.equal(zb.count, 0, 'dalga sayımı bölge zombilerini saymaz');

  // Sandık ganimeti, kasa kilidi, temizlik → kasa
  const loot = await page.evaluate(async () => {
    const s = game.scene.getScene('Game'), Z = s.zones;
    const chests = Z.chests.mine, c = chests.find((o) => !o.vault), v = chests.find((o) => o.vault);
    const near = (x, y) => { s.player.setPosition(x, y + 6); return s.bestInteraction(); };
    const coins = s.player.coins, ore = s.inventory.count('meteor_ore');
    const a = near(c.x, c.y);
    const chestLabel = a?.label; a?.run();
    const got = { coins: s.player.coins - coins, ore: s.inventory.count('meteor_ore') - ore };
    const vl = near(v.x, v.y)?.label;
    s.zombies.getChildren().filter((z) => z.zoneId === 'mine').forEach((z) => z.die(true));
    await new Promise((r) => setTimeout(r, 800));
    const cleared = Z.state.mine.cleared;
    const core = s.inventory.count('rare_core');
    const v2 = near(v.x, v.y);
    const vaultLabel = v2?.label; v2?.run();
    return { chestLabel, got, vl, cleared, vaultLabel, core: s.inventory.count('rare_core') - core, looted: Z.state.mine.looted.length };
  });
  assert.equal(loot.chestLabel, 'Sandığı aç');
  assert.ok(loot.got.coins > 0 && loot.got.ore >= 1, 'maden sandığı göktaşı + para verir');
  assert.equal(loot.vl, 'Kasa (bölgeyi temizle)');
  assert.ok(Number.isFinite(loot.cleared), 'bölge temizlendi');
  assert.equal(loot.vaultLabel, 'Kasayı aç');
  assert.ok(loot.core >= 1, 'kasa nadir çekirdek verir');
  assert.equal(loot.looted, 2);

  // Çıkış merdiveni → köy; kamera ana haritaya döner
  const out = await page.evaluate(async () => {
    const s = game.scene.getScene('Game'), Z = s.zones, e = Z.defs[0].exit;
    s.player.setPosition(e.x, e.y - 30);
    await new Promise((r) => setTimeout(r, 1600)); // ışınlanma bekleme süresi
    s.player.setPosition(e.x, e.y - 4);
    await new Promise((r) => setTimeout(r, 300));
    return { zone: Z.zoneAt(s.player.x, s.player.y), x: s.player.x, y: s.player.y, camX: s.cameras.main._bounds.x, camW: s.cameras.main._bounds.width };
  });
  assert.equal(out.zone, null, 'köye döner');
  assert.ok(out.y > B && out.y < 120, `kuzey geçidinin köy tarafı (y=${out.y})`);
  assert.equal(out.camX, 0);
  assert.equal(out.camW, 96 * 16);

  // Askeri Üs: kırık köprü odun + taş + hurda ile onarılır; hastane kartı Selin'de
  const mil = await page.evaluate(async () => {
    const s = game.scene.getScene('Game'), Z = s.zones, g = Z.gate('military');
    s.player.setPosition(g.mouth.x - 4, g.mouth.y);
    const before = s.bestInteraction()?.label;
    s.inventory.add('wood', 30); s.inventory.add('stone', 20); s.inventory.add('scrap', 8);
    const act = s.bestInteraction();
    const label = act?.label; act?.run();
    const { SHOPS } = await import('./js/config.js');
    return { before, label, open: Z.state.military.open, bridge: Z.bridge.texture.key, wood: s.inventory.count('wood'), card: SHOPS.doctor.some((o) => o.id === 'hospital_card') };
  });
  assert.match(mil.before, /Kırık köprü/);
  assert.match(mil.label, /Kırık köprüyü onar/);
  assert.equal(mil.open, true);
  assert.equal(mil.bridge, 'zn_bridge');
  assert.equal(mil.card, true, 'Hastane Kartı doktorda satılır');

  // Kayıt bölge içindeyken alınır → yüklemede köy tarafında uyanılır, geçit açık kalır
  await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    s.timeSys.minutes = 10 * 60;
    s.zones.enter(s.player, 'military');
    s.saveGame(true);
  });
  await page.reload();
  await waitForScene(page);
  await page.waitForSelector('#menu.show', { timeout: 15000 });
  await page.click('#btn-continue');
  await page.waitForFunction(() => game.scene.getScene('Game').started === true, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  const loaded = await page.evaluate(() => {
    const s = game.scene.getScene('Game'), Z = s.zones;
    return {
      mine: Z.state.mine.open, mil: Z.state.military.open, hosp: Z.state.hospital.open, cleared: Z.state.mine.cleared, looted: Z.state.mine.looted.length,
      zone: Z.zoneAt(s.player.x, s.player.y), x: s.player.x, gates: s.forestEdge.gates.map((g) => g.id + ':' + g.open), milAlive: Z.alive('military')
    };
  });
  assert.equal(loaded.mine, true);
  assert.equal(loaded.mil, true);
  assert.equal(loaded.hosp, false);
  assert.ok(Number.isFinite(loaded.cleared));
  assert.equal(loaded.looted, 2);
  assert.equal(loaded.zone, null, 'yüklemede köye döner');
  assert.ok(loaded.x < 96 * 16, 'ana haritada');
  assert.deepEqual(loaded.gates, ['north:true', 'east:true', 'south:false', 'west:false']);
  assert.ok(loaded.milAlive > 0, 'temizlenmemiş bölge yeniden dolar');

  // Eski kayıt (bölge verisi yok) bozmaz
  const old = await page.evaluate(async () => {
    const { features } = await import('./js/features/index.js');
    const s = game.scene.getScene('Game'), f = features.find((x) => x.id === 'zones');
    f.load(s, undefined); f.begin(s, false);
    return Object.values(s.zones.state).map((z) => z.open);
  });
  assert.deepEqual(old, [false, false, false]);

  await page.waitForTimeout(300);
  assertNoErrors(assert, errors);
});

const launchBrowser = () => chromium.launch({
  executablePath: CHROME_PATH,
  args: ['--use-angle=swiftshader', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows']
});

test('co-op: misafir bölgeye girip çıkar, orman kenarından geçemez', { timeout: 90000 }, async (t) => {
  const srv = await startServer();
  const browser = await launchBrowser();
  t.after(async () => { await browser.close().catch(() => {}); await srv.close(); });
  const ctx = await browser.newContext({ ...DESKTOP, viewport: { width: 760, height: 480 } });
  const host = await ctx.newPage();
  const guest = await ctx.newPage();
  const hostErr = collectErrors(host), guestErr = collectErrors(guest);

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
  await guest.goto(`${srv.url}?net=local&oda=${code}`);
  await waitForScene(guest);
  await guest.waitForSelector('#mp-pick.show', { timeout: 15000 });
  await guest.fill('#mp-name', 'Veli');
  await guest.click('#mp-join');
  await guest.waitForFunction(() => game.scene.getScene('Game').net?.started && game.scene.getScene('Game').started, null, { timeout: 15000 });
  await host.waitForFunction(() => game.scene.getScene('Game').netPlayers?.length === 1, null, { timeout: 5000 });
  const B = await guest.evaluate(async () => (await import('/js/systems/MapBuilder.js')).FOREST_PX);

  // Misafir batı orman kenarından geçemez (yerel çarpışma)
  // (uzak ışınlanmayı host yapar: misafirin kendi ışınlanması hız sınırı doğrulamasına takılır)
  const tp = (x, y) => host.evaluate(([x, y]) => { const n = game.scene.getScene('Game').net; n.teleport([...n.guests.values()][0], x, y); }, [x, y]);
  await tp(70, 200);
  await guest.waitForFunction(() => Math.abs(game.scene.getScene('Game').player.x - 70) < 1, null, { timeout: 5000 });
  const west = await guest.evaluate(async () => {
    const s = game.scene.getScene('Game');
    s.virtualMove = { x: -1, y: 0 };
    await new Promise((r) => setTimeout(r, 900));
    s.virtualMove = { x: 0, y: 0 };
    return { x: s.player.x };
  });
  assert.ok(west.x >= B - 1, `misafir batı ormanına girmemeli (x=${west.x})`);
  // Konum ormanın içinde bildirilse bile host düzeltir
  await guest.evaluate(() => game.scene.getScene('Game').player.setPosition(8, 200));
  await host.waitForFunction((b) => game.scene.getScene('Game').netPlayers[0].x >= b, B, { timeout: 5000 });
  await guest.waitForFunction((b) => game.scene.getScene('Game').player.x >= b, B, { timeout: 5000 });

  // Host maden geçidini açar → misafirde geçit açılır
  await host.evaluate(() => game.scene.getScene('Game').zones.open('mine'));
  await guest.waitForFunction(() => game.scene.getScene('Game').forestEdge.gates.find((g) => g.id === 'north').open, null, { timeout: 5000 });

  // Misafir geçide yürür → host ışınlar → misafir madende, kamerası bölgede
  const mouth = await guest.evaluate(() => { const g = game.scene.getScene('Game').zones.gate('mine'); return [g.mouth.x, g.mouth.y + 4]; });
  await tp(mouth[0], mouth[1]);
  await guest.waitForFunction(([x, y]) => Math.hypot(game.scene.getScene('Game').player.x - x, game.scene.getScene('Game').player.y - y) < 1, mouth, { timeout: 5000 });
  await guest.evaluate(() => { game.scene.getScene('Game').virtualMove = { x: 0, y: -1 }; });
  await guest.waitForFunction(() => game.scene.getScene('Game').zones.zoneAt(game.scene.getScene('Game').player.x, game.scene.getScene('Game').player.y) === 'mine', null, { timeout: 6000 });
  const inMine = await guest.evaluate(async () => {
    const s = game.scene.getScene('Game');
    s.virtualMove = { x: 0, y: 0 };
    await new Promise((r) => setTimeout(r, 400));
    const z = s.zones.defs[0];
    return { camX: s.cameras.main._bounds.x, ox: z.ox, zombies: s.zombies.getChildren().filter((o) => o.visible && s.zones.zoneAt(o.x, o.y) === 'mine').length };
  });
  assert.equal(inMine.camX, inMine.ox, 'misafir kamerası bölgede');
  await host.waitForFunction(() => game.scene.getScene('Game').zones.zoneAt(game.scene.getScene('Game').netPlayers[0].x, game.scene.getScene('Game').netPlayers[0].y) === 'mine', null, { timeout: 5000 });
  await guest.waitForFunction(() => { const s = game.scene.getScene('Game'); return s.zombies.getChildren().some((o) => o.visible && s.zones.zoneAt(o.x, o.y) === 'mine'); }, null, { timeout: 5000 });

  // Misafir E ile "Köye dön"
  const ex = await guest.evaluate(() => { const e = game.scene.getScene('Game').zones.defs[0].exit; return [e.x + 14, e.y - 10]; });
  await tp(ex[0], ex[1]);
  await guest.waitForFunction(() => /Köye dön/.test(game.scene.getScene('Game').net.hint), null, { timeout: 5000 });
  await guest.evaluate(() => game.scene.getScene('Game').interact());
  await guest.waitForFunction(() => { const s = game.scene.getScene('Game'); return !s.zones.zoneAt(s.player.x, s.player.y) && s.player.x < 96 * 16; }, null, { timeout: 5000 });
  const back = await guest.evaluate(() => { const s = game.scene.getScene('Game'); return { camX: s.cameras.main._bounds.x, y: s.player.y }; });
  assert.equal(back.camX, 0);
  assert.ok(back.y > B, 'köy tarafında');

  await guest.waitForTimeout(400);
  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});
