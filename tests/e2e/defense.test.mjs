// Yeni savunma araçları: yerleştirme, zombilere etki, kayıt→yükle ve kazık yönü.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, waitForScene, assertNoErrors } from './_harness.mjs';

const NEW = ['catapult', 'archer_tower', 'tar_pit', 'mine', 'stake_wall', 'repair_station'];
const B = { x: 40 * 16 + 8, y: 30 * 16 + 8 }; // açık alan (settlement testi de kullanır)

// Sahnedeki zombileri ve savunma yapılarını temizle
const clear = (page) => page.evaluate(() => {
  const s = game.scene.getScene('Game');
  s.zombies.getChildren().slice().forEach((z) => z.destroy());
  s.defStructs.getChildren().slice().forEach((o) => o.destroy());
});

test('yeni savunma araçları: yerleştir, etki, kayıt/yükle', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(300);

  // 1) Yerleştirme: her aracı oyuncunun çevresindeki boş bir karoya ITEMS[id].onUse ile koy
  const placed = await page.evaluate(async (ids) => {
    const { ITEMS, RECIPES } = await import('/js/config.js');
    const s = game.scene.getScene('Game');
    s.player.hp = s.player.maxHp = 1e6;
    const px = Math.floor(s.player.x / 16), py = Math.floor(s.player.y / 16);
    const tiles = [];
    for (let r = 1; r <= 2; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r) tiles.push([px + dx, py + dy]);
    }
    const ok = {};
    for (const id of ids) {
      s.giveItem(id, 1);
      for (const [tx, ty] of tiles) {
        const before = s.inventory.count(id);
        const cx = tx * 16 + 8, cy = ty * 16 + 8;
        ITEMS[id].onUse(s, { wx: cx, wy: cy, tx, ty, cx, cy, inReach: true, slot: null });
        if (s.inventory.count(id) < before) { ok[id] = true; break; }
      }
    }
    const tower = s.defStructs.getChildren().find((o) => o.kind === 'archer_tower');
    return {
      ok,
      kinds: s.defStructs.getChildren().map((o) => o.kind),
      types: ids.map((id) => ITEMS[id].type),
      recipes: ids.filter((id) => RECIPES.some((r) => r.out === id)),
      towerBody: tower && { top: tower.body.y - tower.y, bottom: tower.body.bottom - tower.y }
    };
  }, NEW);
  for (const id of NEW) assert.ok(placed.ok[id], `${id} yerleştirilebilmeli`);
  for (const id of NEW) assert.ok(placed.kinds.includes(id), `${id} defStructs içinde`);
  assert.deepEqual(placed.types, NEW.map(() => 'place'));
  assert.deepEqual(placed.recipes, NEW);
  assert.ok(placed.towerBody.bottom <= 8.5 && placed.towerBody.top >= -8, `kule gövdesi taban karosunda: ${JSON.stringify(placed.towerBody)}`);

  // 2) Kayıt → yükle: yapılar, mancınık taşı ve kule seviyesi korunur
  await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const c = s.defStructs.getChildren().find((o) => o.kind === 'catapult');
    c.ammo = 7;
    s.defStructs.getChildren().find((o) => o.kind === 'archer_tower').setLevel(2, true);
    s.saveGame(true);
  });
  await page.reload();
  await waitForScene(page);
  await page.waitForSelector('#menu.show', { timeout: 15000 });
  await page.click('#btn-continue');
  await page.waitForFunction(() => game.scene.getScene('Game').started === true, null, { timeout: 10000 });
  const loaded = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const all = s.defStructs.getChildren();
    return {
      kinds: all.map((o) => o.kind).sort(),
      ammo: all.find((o) => o.kind === 'catapult')?.ammo,
      level: all.find((o) => o.kind === 'archer_tower')?.level,
      tex: all.find((o) => o.kind === 'archer_tower')?.texture.key,
      targets: s.extraTargets.filter((o) => ['catapult', 'archer_tower', 'repair_station'].includes(o.kind)).length
    };
  });
  for (const id of NEW) assert.ok(loaded.kinds.includes(id), `${id} kayıttan yüklenmeli`);
  assert.equal(loaded.ammo, 7);
  assert.equal(loaded.level, 2);
  assert.equal(loaded.tex, 'archer_tower_lv2');
  assert.equal(loaded.targets, 3, 'kule tipi yapılar zombi hedefi');
  await clear(page);

  // Yardımcı: test yapı/zombi kurulumu
  await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    s.player.hp = s.player.maxHp = 1e6;
    s.player.setPosition(10 * 16, 10 * 16);
    window.__z = (x, y, kind = 'normal') => { const z = s.spawnZombie(x, y, kind); z.setAlpha(1); return z; };
  });

  // 3) Katran: üstündeki zombi yavaşlar (defTar ayarlanır)
  const tar = await page.evaluate(async (b) => {
    const s = game.scene.getScene('Game');
    s.defSpawn('tar_pit', b.x, b.y);
    const z = __z(b.x, b.y - 4);
    await new Promise((r) => setTimeout(r, 300));
    return { slowed: z.defTar > 0, hp: z.hp, max: z.maxHp };
  }, B);
  assert.ok(tar.slowed, 'katran zombiyi yavaşlatmalı');
  assert.equal(tar.hp, tar.max, 'katran hasar vermez');
  await clear(page);

  // 4) Kazık duvarı: dibindeki zombiye hasar; dikey dizide dikey doku
  const stake = await page.evaluate(async (b) => {
    const s = game.scene.getScene('Game');
    s.defSpawn('stake_wall', b.x, b.y);
    const z = __z(b.x + 12, b.y, 'brute');
    await new Promise((r) => setTimeout(r, 1200));
    const hurt = z.dead || z.hp < z.maxHp;
    const a = s.defSpawn('stake_wall', b.x + 80, b.y);
    const v = s.defSpawn('stake_wall', b.x + 80, b.y + 16);
    const h1 = s.defSpawn('stake_wall', b.x + 128, b.y);
    const h2 = s.defSpawn('stake_wall', b.x + 144, b.y);
    return { hurt, tex: [a.texture.key, v.texture.key, h1.texture.key, h2.texture.key], blocks: !!a.blocksZombie };
  }, B);
  assert.ok(stake.hurt, 'kazık zombiye hasar vermeli');
  assert.ok(stake.blocks);
  assert.deepEqual(stake.tex, ['stake_wall_v', 'stake_wall_v', 'stake_wall', 'stake_wall']);
  await clear(page);

  // 5) Mayın: kurulunca basan zombiyle patlar, tek kullanımlık
  const mine = await page.evaluate(async (b) => {
    const s = game.scene.getScene('Game');
    const m = s.defSpawn('mine', b.x, b.y);
    await new Promise((r) => setTimeout(r, 1100));
    const z = __z(b.x, b.y - 4);
    const z2 = __z(b.x + 20, b.y - 4);
    await new Promise((r) => setTimeout(r, 700));
    return { gone: !m.active, dead: z.dead || !z.active, splash: z2.dead || !z2.active || z2.hp < z2.maxHp, playerHp: s.player.hp };
  }, B);
  assert.ok(mine.gone, 'mayın patlamalı');
  assert.ok(mine.dead, 'üstündeki zombi ölmeli');
  assert.ok(mine.splash, 'yandaki zombi alan hasarı almalı');
  await clear(page);

  // 6) Mancınık: menzildeki kalabalığa taş atar (taş harcar, alan hasarı)
  const cata = await page.evaluate(async (b) => {
    const s = game.scene.getScene('Game');
    const c = s.defSpawn('catapult', b.x, b.y);
    const start = c.ammo;
    const zs = [__z(b.x + 90, b.y, 'brute'), __z(b.x + 96, b.y + 6, 'brute'), __z(b.x + 90, b.y + 10, 'brute')];
    zs.forEach((z) => { z.speed = 0; });
    const t0 = performance.now();
    while (performance.now() - t0 < 4000 && !zs.some((z) => z.hp < z.maxHp)) await new Promise((r) => setTimeout(r, 100));
    return { used: start - c.ammo, hit: zs.filter((z) => z.hp < z.maxHp).length };
  }, B);
  assert.ok(cata.used >= 1, 'mancınık taş harcamalı');
  assert.ok(cata.hit >= 2, `alan hasarı birden çok zombiye: ${cata.hit}`);
  await clear(page);

  // 7) Okçu kulesi: menzildeki zombiye ok atar
  const tower = await page.evaluate(async (b) => {
    const s = game.scene.getScene('Game');
    s.defSpawn('archer_tower', b.x, b.y);
    const z = __z(b.x + 70, b.y, 'brute');
    z.speed = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 3000 && z.hp >= z.maxHp) await new Promise((r) => setTimeout(r, 100));
    return { hit: z.hp < z.maxHp };
  }, B);
  assert.ok(tower.hit, 'kule zombiyi vurmalı');
  await clear(page);

  // 8) Onarım tezgâhı: gece yakındaki hasarlı yapıyı onarır
  const heal = await page.evaluate(async (b) => {
    const s = game.scene.getScene('Game');
    s.defSpawn('repair_station', b.x, b.y);
    const w = s.defSpawn('stone_wall', b.x + 32, b.y, 100);
    const far = s.defSpawn('stone_wall', b.x + 200, b.y, 100);
    s.defState.healClock = 0.1;
    s.timeSys.minutes = 23 * 60;
    await new Promise((r) => setTimeout(r, 600));
    const out = { near: w.hp, far: far.hp };
    s.timeSys.minutes = 10 * 60;
    s.waves.end?.();
    return out;
  }, B);
  assert.ok(heal.near > 100, `yakın duvar onarılmalı (${heal.near})`);
  assert.equal(heal.far, 100, 'menzil dışı onarılmaz');
  await clear(page);

  await page.waitForTimeout(200);
  assertNoErrors(assert, errors);
});
