// Harita olayları (events.js) ve orman sınırı (MapBuilder): her olay elle tetiklenir, kısa kontroller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, assertNoErrors } from './_harness.mjs';

test('orman sınırı ve rastgele harita olayları', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(600);

  // --- Orman sınırı ---
  const edge = await page.evaluate(async () => {
    const { inForest, FOREST_PX } = await import('./js/systems/MapBuilder.js');
    const s = game.scene.getScene('Game');
    const T = 16;
    const res = s.resources.getChildren().filter((r) => inForest(Math.floor(r.x / T), Math.floor(r.y / T))).length;
    return { B: FOREST_PX, has: !!s.forestEdge, gates: s.forestEdge.gates.map((g) => g.id + ':' + g.open), res, canopy: s.forestEdge.canopy.length };
  });
  assert.equal(edge.has, true);
  assert.equal(edge.res, 0, 'orman şeridinde kaynak olmamalı');
  assert.equal(edge.canopy, 4);
  assert.deepEqual(edge.gates, ['north:false', 'east:false', 'south:false', 'west:false']);

  // Oyuncuyu batıya ve kuzeye it: şeride giremez
  const push = async (x, y, vx, vy) => {
    await page.evaluate(({ x, y, vx, vy }) => { const s = game.scene.getScene('Game'); s.player.setPosition(x, y); s.virtualMove = { x: vx, y: vy }; }, { x, y, vx, vy });
    await page.waitForTimeout(900);
    return page.evaluate(() => { const s = game.scene.getScene('Game'); s.virtualMove = { x: 0, y: 0 }; return { x: s.player.x, y: s.player.y }; });
  };
  const w = await push(70, 200, -1, 0);
  assert.ok(w.x >= edge.B - 1, `oyuncu batı ormanına girmemeli (x=${w.x})`);
  const n = await push(200, 70, 0, -1);
  assert.ok(n.y >= edge.B - 4, `oyuncu kuzey ormanına girmemeli (y=${n.y})`);
  const g = await push(32 * 16 + 8, 70, 0, -1); // kapalı kuzey geçidi
  assert.ok(g.y >= edge.B - 4, `kapalı geçit de geçilmez (y=${g.y})`);

  // Zombi kenardan (orman içinden) doğup içeri yürür
  const z = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    s.player.setPosition(s.shelter.x, s.shelter.y + 60);
    const p = s.waves.edgePoint(2);
    const zz = s.spawnZombie(p.x, 300, 'normal');
    const x0 = zz.x;
    await new Promise((r) => setTimeout(r, 2500));
    const out = { x0, x1: zz.x };
    zz.destroy();
    return out;
  });
  assert.ok(z.x0 < 40 && z.x1 > z.x0 + 15, `zombi ormandan içeri yürümeli (${z.x0} → ${z.x1})`);

  // --- Olaylar ---
  const ev = await page.evaluate(async () => {
    const s = game.scene.getScene('Game'), E = s.mapEvents, out = {};
    const near = (x, y) => { s.player.setPosition(x, y); return s.bestInteraction(); };
    // Gezgin tüccar
    out.trader = E.trigger('trader');
    const a = E.active;
    const act = near(a.tx, a.ty + 8);
    out.traderLabel = act?.label;
    act?.run();
    out.shopOpen = s.hud.modal;
    out.stock = (window.__shops = (await import('./js/config.js')).SHOPS).traveler?.length;
    s.hud.closeAll();
    // Yaralı yabancı
    out.survivor = E.trigger('survivor');
    out.survType = E.active?.type;
    out.outsider = !!s.outsiders.find((o) => o.npcName === E.active?.name && o.outsider?.mode === 'rescue');
    // Hasat festivali
    const { ITEMS } = await import('./js/config.js');
    const base = ITEMS.wheat.sell;
    out.festival = E.trigger('festival');
    out.boosted = ITEMS.wheat.sell > base;
    E.end();
    out.restored = ITEMS.wheat.sell === base;
    // Zombi yuvası
    out.nest = E.trigger('nest');
    const ns = E.nest;
    const coins = s.player.coins;
    for (let i = 0; i < 30 && E.nest; i++) { s.player.actionCd = 0; near(ns.x, ns.y + 14)?.run(); }
    out.nestGone = !E.nest && s.player.coins > coins;
    // Ganimet sandığı
    const c = E.spawnChest({ x: s.player.x + 10, y: s.player.y });
    const c0 = s.player.coins;
    const ca = near(c.x, c.y + 6);
    out.chestLabel = ca?.label;
    ca?.run();
    out.chestCoins = s.player.coins > c0;
    // Sisli gece (world hava sistemi)
    out.fog = E.trigger('fog');
    out.weather = s.weather;
    s.setWeather('clear', true);
    E.end();
    // Göktaşı
    out.meteor = E.trigger('meteor');
    return out;
  });
  assert.equal(ev.trader, true);
  assert.equal(ev.traderLabel, 'Gezgin tüccarla ticaret');
  assert.equal(ev.shopOpen, 'shop');
  assert.ok(ev.stock >= 3, 'tüccarın nadir eşya listesi');
  assert.equal(ev.survivor, true);
  assert.equal(ev.survType, 'survivor');
  assert.equal(ev.outsider, true, 'yaralı yabancı kurtarılmayı bekleyen dışarıdaki olarak eklenir');
  assert.equal(ev.festival, true);
  assert.equal(ev.boosted, true, 'festivalde ekin fiyatı artar');
  assert.equal(ev.restored, true, 'festival bitince fiyat geri döner');
  assert.equal(ev.nest, true);
  assert.equal(ev.nestGone, true, 'yuva bozulur ve ganimet verir');
  assert.equal(ev.chestLabel, 'Ganimet sandığını aç');
  assert.equal(ev.chestCoins, true);
  assert.equal(ev.fog, true);
  assert.equal(ev.weather, 'fog');
  assert.equal(ev.meteor, true);

  await page.waitForTimeout(3600); // göktaşı düşer
  const met = await page.evaluate(() => {
    const s = game.scene.getScene('Game'), E = s.mapEvents, m = E.meteor;
    if (!m) return { landed: false };
    const ore = s.inventory.count('meteor_ore');
    s.player.setPosition(m.x, m.y + 14);
    for (let i = 0; i < 10 && E.meteor; i++) { s.player.actionCd = 0; s.player.energy = 100; s.bestInteraction()?.run(); }
    return { landed: true, mined: !E.meteor, ore: s.inventory.count('meteor_ore') - ore };
  });
  assert.equal(met.landed, true, 'göktaşı yere iner');
  assert.equal(met.mined, true, 'kazmayla kırılır');
  assert.ok(met.ore >= 1, 'nadir göktaşı parçası verir');

  // Kayıt: JSON'a çevrilebilir, eski kayıt (veri yok) bozmaz
  const saved = await page.evaluate(async () => {
    const { features } = await import('./js/features/index.js');
    const s = game.scene.getScene('Game');
    const f = features.find((x) => x.id === 'events');
    const data = JSON.parse(JSON.stringify(f.save(s)));
    f.load(s, undefined);
    f.load(s, data);
    f.begin(s, false);
    return { data, chests: s.mapEvents.chests.length };
  });
  assert.ok(Array.isArray(saved.data.chests));
  assert.equal(saved.chests, saved.data.chests.length);

  await page.waitForTimeout(300);
  assertNoErrors(assert, errors);
});
