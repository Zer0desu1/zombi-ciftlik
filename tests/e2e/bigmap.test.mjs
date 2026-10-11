// Büyütülmüş harita (128×88): sınırlar, eski alanların (64×44 ve 96×64) kaynak dizilimi, eski (sürüm 1/2) kayıt uyumu,
// zombi doğma mesafesi ve co-op harita özeti. Kısa ölçümler; uzun simülasyon yok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, waitForScene, assertNoErrors } from './_harness.mjs';
import { setupMP } from './_mp.mjs';

// Harita özeti: kaynak konumları + zemin karoları (host ve misafir aynı tohumla aynı haritayı kurmalı)
const mapDigest = () => {
  const s = game.scene.getScene('Game');
  let h = 0;
  const add = (v) => { h = (h * 31 + v) | 0; };
  s.resources.getChildren().forEach((r) => { add(Math.round(r.x)); add(Math.round(r.y)); add(r.kind === 'tree' ? 1 : 2); });
  s.layer.layer.data.forEach((row) => row.forEach((t) => add(t.index)));
  return { h, n: s.resources.getChildren().length, w: s.layer.layer.width, hgt: s.layer.layer.height };
};

test('büyük harita: sınırlar, eski dizilim, eski kayıt, zombi mesafesi', { timeout: 90000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(500);

  const info = await page.evaluate(async () => {
    const { MAP_W, MAP_H } = await import('./js/config.js');
    const { FOREST_PX, LEGACY_RES, V2_RES } = await import('./js/systems/MapBuilder.js');
    const { T } = await import('./js/systems/Farm.js');
    const s = game.scene.getScene('Game');
    const res = s.resources.getChildren();
    // Eski (64×44) yerleşim algoritmasının birebir kopyası: ilk LEGACY_RES kaynak aynı konumda olmalı
    const rng = new Phaser.Math.RandomDataGenerator(['zombi-ciftlik']);
    const W = 64, H = 44, data = [];
    for (let y = 0; y < H; y++) { const row = []; for (let x = 0; x < W; x++) { const r = rng.frac(); row.push(r < 0.08 ? 1 : r < 0.2 ? 2 : 0); } data.push(row); }
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) data[y][x] = v; };
    for (let x = 3; x < W - 3; x++) set(x, 23, T.PATH);
    for (let y = 4; y < H - 3; y++) set(32, y, T.PATH);
    for (let x = 22; x <= 32; x++) set(x, 14, T.PATH);
    for (let x = 33; x <= 48; x++) set(x, 17, T.PATH);
    for (let y = 23; y <= 27; y++) set(44, y, T.PATH);
    for (let y = 21; y <= 25; y++) for (let x = 27; x <= 37; x++) set(x, y, T.STONE);
    const inRect = (x, y, r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
    const reserved = [{ x: 3, y: 5, w: 22, h: 19 }, { x: 24, y: 9, w: 34, h: 27 }, { x: 10, y: 25, w: 18, h: 8 }, { x: 2, y: 34, w: 10, h: 7 }, { x: 54, y: 26, w: 8, h: 7 }];
    const used = new Set(), out = [];
    const place = (kind, count) => {
      let tries = 0;
      while (count > 0 && tries++ < 3000) {
        const tx = rng.between(1, W - 2), ty = rng.between(2, H - 2);
        if (reserved.some((r) => inRect(tx, ty, r)) || data[ty][tx] === T.PATH || used.has(`${tx},${ty}`)) continue;
        used.add(`${tx},${ty}`); out.push({ tx, ty, kind }); count--;
      }
    };
    place('tree', 60); place('rock', 32);
    const gate = new Set(['32,0', '32,1', '32,2', '32,3', '32,40', '32,41', '32,42', '32,43', '0,23', '1,23', '2,23', '61,23', '62,23', '63,23']);
    const eb = (x, y) => x < 2 || y < 2 || x >= W - 2 || y >= H - 2 || gate.has(`${x},${y}`);
    const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !eb(x, y) && !reserved.some((r) => inRect(x, y, r)) && data[y][x] !== T.PATH && !used.has(`${x},${y}`);
    for (const o of out) {
      if (!eb(o.tx, o.ty)) continue;
      let spot = null;
      for (let d = 1; d <= 5 && !spot; d++) {
        const ix = o.tx < W / 2 ? 1 : -1, iy = o.ty < H / 2 ? 1 : -1, tx = o.tx, ty = o.ty;
        spot = [[tx + ix * d, ty], [tx, ty + iy * d], [tx + ix * d, ty + iy * d], [tx - ix * d, ty + iy * d], [tx + ix * d, ty - iy * d]].find(([x, y]) => free(x, y)) || null;
      }
      for (let d = 1; d <= 8 && !spot; d++) for (let dy = -d; dy <= d && !spot; dy++) for (let dx = -d; dx <= d && !spot; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === d && free(o.tx + dx, o.ty + dy)) spot = [o.tx + dx, o.ty + dy];
      }
      if (!spot) continue;
      used.delete(`${o.tx},${o.ty}`); used.add(`${spot[0]},${spot[1]}`);
      o.tx = spot[0]; o.ty = spot[1];
    }
    const legacyMismatch = out.filter((o, i) => {
      const r = res[i];
      return !r || r.kind !== o.kind || Math.round(r.x) !== o.tx * 16 + 8 || Math.round(r.y) !== o.ty * 16 + (o.kind === 'tree' ? 4 : 8);
    }).length;
    // Sürüm 2 (96×64) alanı: 'zombi-ciftlik-genis' akışı ve sürüm 2 kenar/geçit kurallarıyla birebir aynı olmalı
    const rng2 = new Phaser.Math.RandomDataGenerator(['zombi-ciftlik-genis']);
    const VW = 96, VH = 64, d2 = [];
    for (let y = 0; y < VH; y++) { const row = []; for (let x = 0; x < VW; x++) row.push(x < W && y < H ? data[y][x] : 0); d2.push(row); }
    for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) if (x >= W || y >= H) rng2.frac();
    for (let x = 3; x < VW - 3; x++) d2[23][x] = T.PATH;
    for (let y = 4; y < VH - 3; y++) d2[y][32] = T.PATH;
    const gate2 = new Set(['32,0', '32,1', '32,2', '32,3', '32,60', '32,61', '32,62', '32,63', '0,23', '1,23', '2,23', '93,23', '94,23', '95,23']);
    const eb2 = (x, y) => x < 2 || y < 2 || x >= VW - 2 || y >= VH - 2 || gate2.has(`${x},${y}`);
    const out2 = [];
    const place2 = (kind, count) => {
      let tries = 0;
      while (count > 0 && tries++ < 3000) {
        const tx = rng2.between(2, VW - 3), ty = rng2.between(2, VH - 3);
        if (tx < W - 2 && ty < H - 2) continue;
        if (eb2(tx, ty) || reserved.some((r) => inRect(tx, ty, r)) || d2[ty][tx] === T.PATH || used.has(`${tx},${ty}`)) continue;
        if ([[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => gate2.has(`${tx + dx},${ty + dy}`))) continue;
        used.add(`${tx},${ty}`); out2.push({ tx, ty, kind }); count--;
      }
    };
    place2('tree', 71); place2('rock', 38);
    const v2Mismatch = out2.filter((o, i) => {
      const r = res[LEGACY_RES + i];
      return !r || r.kind !== o.kind || Math.round(r.x) !== o.tx * 16 + 8 || Math.round(r.y) !== o.ty * 16 + (o.kind === 'tree' ? 4 : 8);
    }).length;
    const newArea = res.slice(V2_RES).filter((r) => r.x >= 94 * 16 || r.y >= 62 * 16);
    return {
      MAP_W, MAP_H, B: FOREST_PX, LEGACY_RES, V2_RES, legacyMismatch, v2Mismatch, v2n: out2.length, total: res.length,
      newTrees: newArea.filter((r) => r.kind === 'tree').length, newRocks: newArea.filter((r) => r.kind === 'rock').length,
      pois: (s.mapPOIs || []).map((o) => o.id), lakes: (s.lakeRects || []).length, wild: (s.wildAreas || []).length,
      waterBodies: s.obstacles.getChildren().filter((o) => o.isWater).length,
      roadS: s.layer.getTileAt(60, 74).index === T.PATH, roadE: s.layer.getTileAt(110, 50).index === T.PATH,
      worldW: s.physics.world.bounds.width, camW: s.cameras.main._bounds.width, camH: s.cameras.main._bounds.height,
      gates: s.forestEdge.gates.map((g) => `${g.id}:${Math.floor(g.rect.centerX / 16)},${Math.floor(g.rect.centerY / 16)}`),
      oldStrip: s.forestEdge.group.getChildren().filter((b) => b.body && (Math.abs(b.body.x - 94 * 16) < 2 || Math.abs(b.body.y - 62 * 16) < 2 || Math.abs(b.body.x - 62 * 16) < 2 || Math.abs(b.body.y - 42 * 16) < 2)).length,
      pathE: s.layer.getTileAt(122, 23).index === T.PATH, pathS: s.layer.getTileAt(32, 82).index === T.PATH,
      statics: s.physics.world.staticBodies.size,
      zoneX: s.zones.defs[0].ox
    };
  });
  console.log(`[bigmap] kaynak ${info.total} (yeni alan ${info.newTrees} ağaç / ${info.newRocks} kaya) · statik gövde ${info.statics}`);
  assert.equal(info.MAP_W, 128);
  assert.equal(info.MAP_H, 88);
  assert.equal(info.camW, 128 * 16);
  assert.equal(info.camH, 88 * 16);
  assert.equal(info.legacyMismatch, 0, 'eski 64×44 alanının ağaç/kaya dizilimi aynı kalmalı');
  assert.equal(info.v2n, info.V2_RES - info.LEGACY_RES);
  assert.equal(info.v2Mismatch, 0, '96×64 alanının ağaç/kaya dizilimi sürüm 2 ile aynı kalmalı');
  assert.ok(info.newTrees >= 80 && info.newRocks >= 35, `yeni alanda kaynak var (${info.newTrees} ağaç, ${info.newRocks} kaya)`);
  assert.equal(info.oldStrip, 0, 'eski kenarlarda orman şeridi kalmamalı');
  assert.ok(info.pathE && info.pathS, 'yollar yeni kenarlara uzanır');
  assert.ok(info.roadS && info.roadE, 'yeni güney/doğu yolları');
  assert.deepEqual(info.gates, ['north:32,1', 'east:127,23', 'south:32,87', 'west:1,23']);
  assert.ok(info.zoneX > 128 * 16, 'keşif bölgeleri yeni haritanın sağında');
  assert.equal(info.lakes, 4, 'eski göl + 3 yeni göl');
  assert.equal(info.waterBodies, 8);
  assert.ok(['quarry', 'grove', 'camp', 'hamlet'].every((id) => info.pois.includes(id)), `ilgi noktaları (${info.pois})`);
  assert.ok(info.wild >= 3, 'yaban hayvanı alanları');
  assert.ok(info.statics < 900, `statik gövde sayısı makul (${info.statics})`);

  // Oyuncu yeni doğu/güney kenarlarına kadar yürür ama orman şeridine giremez
  const push = async (x, y, vx, vy) => {
    await page.evaluate(({ x, y, vx, vy }) => { const s = game.scene.getScene('Game'); s.player.setPosition(x, y); s.virtualMove = { x: vx, y: vy }; }, { x, y, vx, vy });
    await page.waitForTimeout(900);
    return page.evaluate(() => { const s = game.scene.getScene('Game'); s.virtualMove = { x: 0, y: 0 }; return { x: s.player.x, y: s.player.y }; });
  };
  const W = 128 * 16, H = 88 * 16;
  // Yollar engelsiz (yeni alanda kaynaklar yol kenarına konmaz): yatay yol y=23, dikey yol x=32
  const e = await push(W - 90, 23 * 16 + 8, 1, 0);
  assert.ok(e.x > W - info.B - 30 && e.x <= W - info.B + 1, `doğu kenarına ulaşır ama şeride girmez (x=${e.x})`);
  const so = await push(32 * 16 + 8, H - 90, 0, 1);
  assert.ok(so.y > H - info.B - 30 && so.y <= H - info.B + 4, `güney kenarına ulaşır ama şeride girmez (y=${so.y})`);

  // Zombi doğma noktası sığınaktan makul uzaklıkta; uzak kenardan yürüyüş süresi ölçülür
  const z = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    s.player.setPosition(s.shelter.x, s.shelter.y + 60);
    let maxD = 0;
    for (let side = 0; side < 4; side++) for (let i = 0; i < 20; i++) {
      const p = s.waves.edgePoint(side);
      maxD = Math.max(maxD, Math.hypot(p.x - s.shelter.x, p.y - s.shelter.y));
    }
    const p = s.waves.edgePoint(3);
    const zz = s.spawnZombie(p.x, s.shelter.y, 'normal');
    const d0 = Math.hypot(zz.x - s.shelter.x, zz.y - s.shelter.y);
    await new Promise((r) => setTimeout(r, 3000));
    const d1 = Math.hypot(zz.x - s.shelter.x, zz.y - s.shelter.y);
    zz.destroy();
    return { maxD, d0, d1 };
  });
  const speed = (z.d0 - z.d1) / 3;
  const eta = z.d0 / Math.max(1, speed);
  console.log(`[bigmap] en uzak doğma ${Math.round(z.maxD)} px · doğu sürüsü ${Math.round(z.d0)} px, hız ${speed.toFixed(1)} px/sn, tahmini varış ${eta.toFixed(1)} sn`);
  assert.ok(z.maxD <= 760, `doğma noktası sığınaktan en fazla ~47 kare (${Math.round(z.maxD)})`);
  assert.ok(speed > 5, 'zombi sığınağa doğru yürür');
  assert.ok(eta < 45, `zombi gece içinde makul sürede ulaşır (${eta.toFixed(1)} sn)`);

  // Eski (sürüm 1) kayıt: mapVersion yok; oyuncu/yapı/tarla korunur, keşif bölgesindeki konum köye döner
  const before = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    s.player.setPosition(40 * 16, 30 * 16);
    s.addStructure('barricade', 44 * 16 + 8, 30 * 16 + 8);
    let tilled = null;
    for (let tx = 10; tx < 20 && !tilled; tx++) if (s.farm.inZone(tx, 12)) { s.farm.till(tx, 12); tilled = [tx, 12]; }
    s.saveGame(true);
    const d = JSON.parse(localStorage.getItem('zombi-ciftlik-save-v1'));
    const v = d.mapVersion;
    delete d.mapVersion;
    localStorage.setItem('zombi-ciftlik-save-v1', JSON.stringify(d));
    return { v, x: s.player.x, y: s.player.y, tilled, structs: d.structures.length };
  });
  assert.equal(before.v, 3, 'yeni kayıtlar harita sürümü 3 yazar');
  assert.ok(before.tilled, 'tarla açıldı');
  const load = async () => {
    await page.reload();
    await waitForScene(page);
    await page.waitForSelector('#menu.show', { timeout: 15000 });
    await page.click('#btn-continue');
    await page.waitForFunction(() => game.scene.getScene('Game').started === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);
  };
  await load();
  const after = await page.evaluate((tl) => {
    const s = game.scene.getScene('Game');
    return { x: s.player.x, y: s.player.y, ver: s.loadedMapVersion, plot: !!s.farm.get(tl[0], tl[1]), structs: s.barricades.getChildren().length + s.turrets.getChildren().length };
  }, before.tilled);
  assert.equal(after.ver, 1);
  assert.equal(Math.round(after.x), Math.round(before.x));
  assert.equal(Math.round(after.y), Math.round(before.y));
  assert.ok(after.plot, 'tarla korunur');
  assert.equal(after.structs, before.structs, 'yapılar korunur');

  // Eski kayıtta oyuncu eski keşif bölgesindeydi (x = 64*16 + 192 + …): yüklemede köy tarafındaki geçide döner
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('zombi-ciftlik-save-v1'));
    d.player.x = 64 * 16 + 192 + 100; d.player.y = 100; delete d.mapVersion;
    localStorage.setItem('zombi-ciftlik-save-v1', JSON.stringify(d));
  });
  await load();
  const zr = await page.evaluate(() => { const s = game.scene.getScene('Game'); return { x: s.player.x, y: s.player.y, zone: s.zones.zoneAt(s.player.x, s.player.y) }; });
  assert.equal(zr.zone, null);
  assert.ok(Math.abs(zr.x - (32 * 16 + 8)) < 24 && zr.y < 100, `eski bölge konumu kuzey geçidinin köy tarafına döner (${zr.x},${zr.y})`);

  // Sürüm 2 kaydı: 96×64 içindeki konum aynen geçerli; eski keşif bölgesi konumu (x = 96*16 + 192 + …) köye döner
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('zombi-ciftlik-save-v1'));
    d.player.x = 90 * 16 + 8; d.player.y = 23 * 16 + 8; d.mapVersion = 2;
    localStorage.setItem('zombi-ciftlik-save-v1', JSON.stringify(d));
  });
  await load();
  const v2 = await page.evaluate(() => { const s = game.scene.getScene('Game'); return { x: s.player.x, y: s.player.y, ver: s.loadedMapVersion }; });
  assert.equal(v2.ver, 2);
  assert.equal(Math.round(v2.x), 90 * 16 + 8);
  assert.equal(Math.round(v2.y), 23 * 16 + 8);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('zombi-ciftlik-save-v1'));
    d.player.x = 96 * 16 + 192 + 100; d.player.y = 100; d.mapVersion = 2;
    localStorage.setItem('zombi-ciftlik-save-v1', JSON.stringify(d));
  });
  await load();
  const zr2 = await page.evaluate(() => { const s = game.scene.getScene('Game'); return { x: s.player.x, y: s.player.y, zone: s.zones.zoneAt(s.player.x, s.player.y) }; });
  assert.equal(zr2.zone, null);
  assert.ok(Math.abs(zr2.x - (32 * 16 + 8)) < 24 && zr2.y < 100, `sürüm 2 bölge konumu kuzey geçidinin köy tarafına döner (${zr2.x},${zr2.y})`);
  assertNoErrors(assert, errors);
});

test('büyük harita co-op: host ve misafir aynı haritayı kurar; ağıl/olay engelleri misafire katı bildirilir', { timeout: 90000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t);
  const [a, b] = await Promise.all([host.evaluate(`(${mapDigest})()`), guest.evaluate(`(${mapDigest})()`)]);
  assert.equal(a.w, 128);
  assert.equal(a.hgt, 88);
  assert.deepEqual(b, a, 'harita özeti eşit');

  // Host'ta olay kayası (meteor) → misafire katı gövde (sb) olarak gider
  const solid = await host.evaluate(() => {
    const s = game.scene.getScene('Game');
    const img = s.mapEvents.solids.create(40 * 16, 34 * 16, 'ev_meteor');
    img.body?.setSize?.(20, 10);
    s.mapEvents.solids.refresh?.();
    return { ok: s.net.playerSolid(img), x: img.x, y: img.y };
  });
  assert.equal(solid.ok, true, 'olay kayası host için oyuncu engeli');
  await guest.waitForFunction(([x, y]) => {
    const n = game.scene.getScene('Game').net;
    return n.solids.getChildren().some((z) => Math.abs(z.x - x) < 20 && Math.abs(z.y - y) < 20);
  }, [solid.x, solid.y], { timeout: 6000 });
  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});
