// Gezgin canavarlar: slime doğumu, kılıç/mermi hasarı, jöle ganimeti, kral slime bölünmesi, kayıt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, assertNoErrors } from './_harness.mjs';

test('slime canavarları', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(800);

  const start = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const m = s.monsters;
    return {
      n: m.slimes.length,
      inHunt: m.slimes.every((x) => s.huntables.includes(x)),
      deerInHunt: (s.wildlife?.deer || []).every((d) => s.huntables.includes(d)),
      dots: s.minimapDots.some((fn) => (fn(s) || []).some((d) => ['#7bd389', '#7ac8ff', '#c08aff'].includes(d.color))),
      gel: !!s.textures.exists('i_slime_gel') && s.textures.get('mn_green').frameTotal >= 4
    };
  });
  assert.ok(start.n >= 1 && start.n <= 8, `yeni oyunda 1–8 slime olmalı (${start.n})`);
  assert.equal(start.inHunt, true, 'slime\'lar scene.huntables\'ta');
  assert.equal(start.deerInHunt, true, 'geyikler de huntables\'ta kalmalı');
  assert.equal(start.dots, true, 'mini harita noktası');
  assert.equal(start.gel, true, 'dokular');

  // Kılıç: hasar + ölünce jöle
  const sword = await page.evaluate(async () => {
    const { melee } = await import('./js/systems/PlayerActions.js');
    const s = game.scene.getScene('Game');
    const m = s.monsters.spawn({ kind: 'green', minDist: 0 });
    m.setAlpha(1);
    s.player.setPosition(m.x - 12, m.y);
    s.player.invuln = 5;
    const hp0 = m.hp;
    melee(s, m.x, m.y, 1);
    const hp1 = m.hp;
    const gel0 = s.inventory.count('slime_gel');
    m.hp = 0.5;
    melee(s, m.x, m.y, 1);
    return { hp0, hp1, dead: m.dead, gained: s.inventory.count('slime_gel') - gel0, listed: s.monsters.slimes.includes(m) };
  });
  assert.ok(sword.hp1 < sword.hp0, `kılıç hasar vermeli (${sword.hp0} → ${sword.hp1})`);
  assert.equal(sword.dead, true);
  assert.ok(sword.gained >= 1 && sword.gained <= 2, `1–2 jöle (${sword.gained})`);
  assert.equal(sword.listed, false, 'ölen slime listeden çıkar');

  // Mermi: scene.bullets çakışması
  const shot = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const m = s.monsters.spawn({ kind: 'blue', minDist: 0 });
    m.setAlpha(1); m.stunT = 10; m.setVelocity(0, 0);
    const hp = m.hp;
    s.player.setPosition(m.x - 100, m.y);
    s.fireBullet(m.x - 20, m.y, 0, 2, 320);
    await new Promise((r) => setTimeout(r, 400));
    return { hp, now: m.hp };
  });
  assert.ok(shot.now < shot.hp, `mermi slime'a hasar vermeli (${shot.hp} → ${shot.now})`);

  // Kral slime bölünmesi
  const split = await page.evaluate(async () => {
    const { hitTarget } = await import('./js/systems/PlayerActions.js');
    const s = game.scene.getScene('Game');
    const st = s.monsters;
    while (st.slimes.length > 4) { const x = st.slimes.pop(); x.destroy(); }
    const k = st.spawn({ kind: 'purple', minDist: 0 });
    s.player.setPosition(k.x - 60, k.y);
    const minis0 = st.slimes.filter((x) => x.kind === 'mini').length;
    hitTarget(s, k, 999, false, s.player, 'sword');
    return { dead: k.dead, minis: st.slimes.filter((x) => x.kind === 'mini').length - minis0 };
  });
  assert.equal(split.dead, true);
  assert.equal(split.minis, 2, 'kral slime 2 küçük slime\'a bölünür');

  // Temas hasarı + buz yavaşlatması
  const touch = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const m = s.monsters.spawn({ kind: 'blue', minDist: 0 });
    m.setAlpha(1);
    s.player.invuln = 0;
    s.player.hp = s.player.maxHp;
    s.player.setPosition(m.x, m.y);
    await new Promise((r) => setTimeout(r, 150));
    return { hp: s.player.hp, max: s.player.maxHp, slow: s.monsters.slowT > 0 };
  });
  assert.ok(touch.hp < touch.max, 'temas hasar verir');
  assert.equal(touch.slow, true, 'buz slime yavaşlatır');

  // Tarif + kayıt
  const saved = await page.evaluate(async () => {
    const { features } = await import('./js/features/index.js');
    const { RECIPES, ITEMS } = await import('./js/config.js');
    const s = game.scene.getScene('Game');
    const f = features.find((x) => x.id === 'monsters');
    const data = JSON.parse(JSON.stringify(f.save(s)));
    f.load(s, undefined);
    f.load(s, data);
    return { data, pending: s.monsters.pending, recipe: RECIPES.some((r) => r.cost.slime_gel), type: ITEMS.slime_gel.type };
  });
  assert.ok(Array.isArray(saved.data.kinds));
  assert.deepEqual(saved.pending.kinds, saved.data.kinds);
  assert.equal(saved.recipe, true);
  assert.equal(saved.type, 'material');

  await page.waitForTimeout(300);
  assertNoErrors(assert, errors);
});
