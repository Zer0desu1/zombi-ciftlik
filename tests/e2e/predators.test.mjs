// Vahşi yırtıcılar: doğum, avlama ganimeti, evcilleştirme, takip/bekle, zombiyle dövüş, kayıt/yükleme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, assertNoErrors } from './_harness.mjs';

const poll = (fn, ms = 4000) => `(async () => { for (let i = 0; i < ${Math.ceil(ms / 100)}; i++) { if (${fn}) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`;

test('yırtıcılar: av, evcilleştirme, takip, kayıt', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(600);

  const start = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const st = s.predators;
    const sc = { x: 30 * 16 + 32, y: 18 * 16 + 28 };
    return {
      n: st.wild.length,
      kinds: [...new Set(st.wild.map((b) => b.kind))],
      inHunt: st.wild.every((b) => s.huntables.includes(b)),
      farFromShelter: st.wild.every((b) => Math.hypot(b.x - sc.x, b.y - sc.y) >= 300),
      tex: ['pd_wolf', 'pd_tiger', 'pd_bear'].every((k) => s.textures.get(k).frameTotal >= 4) && s.anims.exists('pd_wolf_walk'),
      dots: s.minimapDots.some((fn) => (fn(s) || []).some((d) => d.color === '#eb5757'))
    };
  });
  assert.ok(start.n >= 2, `yeni oyunda yırtıcı olmalı (${start.n})`);
  assert.ok(start.kinds.includes('wolf'), `kurt sürüsü olmalı (${start.kinds})`);
  assert.equal(start.inHunt, true, 'yırtıcılar scene.huntables\'ta');
  assert.equal(start.farFromShelter, true, 'köyden uzakta doğarlar');
  assert.equal(start.tex, true, 'dokular + yürüme animasyonu');
  assert.equal(start.dots, true, 'mini haritada kırmızı nokta');

  // Avlama: kılıçla öldür → et + post
  const hunt = await page.evaluate(async () => {
    const { melee } = await import('./js/systems/PlayerActions.js');
    const s = game.scene.getScene('Game');
    const st = s.predators;
    const w = st.wild.find((b) => b.kind === 'wolf');
    s.player.invuln = 999;
    s.player.setPosition(w.x - 12, w.y);
    w.state = 'cower'; w.cowerT = 99; w.setVelocity(0, 0);
    const before = { m: s.inventory.count('wild_meat'), p: s.inventory.count('wolf_pelt') };
    w.hp = 0.5;
    melee(s, w.x, w.y, 2);
    return { dead: w.dead, listed: st.wild.includes(w), hunt: s.huntables.includes(w), m: s.inventory.count('wild_meat') - before.m, p: s.inventory.count('wolf_pelt') - before.p, at: { x: w.x, y: w.y } };
  });
  assert.equal(hunt.dead, true, 'kurt ölmeli');
  assert.equal(hunt.listed, false, 'ölen listeden çıkar');
  assert.equal(hunt.hunt, false, 'ölen huntables\'tan çıkar');
  assert.equal(hunt.m, 1, '1 yaban eti');
  assert.equal(hunt.p, 1, '1 kurt postu');

  // Mermi isabeti (scene.bullets çakışması)
  const shot = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const [b] = s.predators.spawn('bear', { at: { x: s.player.x + 60, y: s.player.y }, n: 1, fade: false });
    b.state = 'cower'; b.cowerT = 99; b.setVelocity(0, 0);
    const hp = b.hp;
    s.fireBullet(b.x - 20, b.y, 0, 2, 320);
    for (let i = 0; i < 40 && b.hp >= hp; i++) await new Promise((r) => setTimeout(r, 100));
    return { hp, now: b.hp };
  });
  assert.ok(shot.now < shot.hp, `mermi ayıya hasar vermeli (${shot.hp} → ${shot.now})`);

  // Evcilleştirme: zayıf kurt + çiğ et + E
  const tame = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const st = s.predators;
    // Diğer vahşiler testi bozmasın: sinik kalsınlar (saldırmaz, evcil hayvan da onları hedeflemez)
    st.wild.forEach((b) => { b.state = 'cower'; b.cowerT = 999; b.setVelocity(0, 0); });
    const [w] = st.spawn('wolf', { at: { x: s.player.x + 20, y: s.player.y }, n: 1, fade: false });
    w.hp = w.maxHp * 0.2; w.state = 'cower'; w.cowerT = 99; w.cowered = true; w.setVelocity(0, 0);
    s.player.setPosition(w.x - 14, w.y);
    s.giveItem('venison', 1);
    const meat0 = s.inventory.count('venison') + s.inventory.count('wild_meat');
    st.forceTame = true;
    const act = s.bestInteraction();
    const label = act?.label;
    act?.run();
    st.forceTame = false;
    return {
      label, tame: w.tame, pets: st.pets.length, inWild: st.wild.includes(w), inHunt: s.huntables.includes(w),
      target: s.extraTargets.includes(w), name: w.petName, meat: meat0 - (s.inventory.count('venison') + s.inventory.count('wild_meat')),
      green: s.minimapDots.some((fn) => (fn(s) || []).some((d) => d.color === '#6ee06e'))
    };
  });
  assert.match(tame.label || '', /Evcilleştir/, `etkileşim etiketi (${tame.label})`);
  assert.equal(tame.tame, true, 'kurt evcilleşmeli');
  assert.equal(tame.pets, 1);
  assert.equal(tame.inWild, false);
  assert.equal(tame.inHunt, false, 'evcil hayvan avlanamaz');
  assert.equal(tame.target, true, 'zombiler evcil hayvanı hedefleyebilir');
  assert.ok(tame.name, 'evcil hayvanın adı var');
  assert.equal(tame.meat, 1, '1 et harcanır');
  assert.equal(tame.green, true, 'mini haritada yeşil nokta');

  // Takip: sahibi uzaklaşınca peşinden gelir
  await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    s.predators.wild.forEach((b) => { b.state = 'cower'; b.cowerT = 999; });
    s.player.setPosition(s.player.x + 110, s.player.y);
  });
  const followed = await page.evaluate(poll('(() => { const s = game.scene.getScene("Game"); const p = s.predators.pets[0]; return Math.hypot(p.x - s.player.x, p.y - s.player.y) < 40; })()', 5000));
  assert.equal(followed, true, 'evcil hayvan sahibini takip etmeli');

  // Bekle komutu
  const stay = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const pet = s.predators.pets[0];
    s.player.setPosition(pet.x - 10, pet.y);
    const act = s.bestInteraction();
    const label = act?.label;
    act?.run();
    return { label, state: pet.state };
  });
  assert.match(stay.label || '', /Bekle/, `komut etiketi (${stay.label})`);
  assert.equal(stay.state, 'stay');

  // Zombiye saldırır
  const fight = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const pet = s.predators.pets[0];
    const z = s.spawnZombie(pet.x + 30, pet.y, 'normal');
    z.maxHp = z.hp = 999; z.speed = 0;
    for (let i = 0; i < 50 && z.hp >= 999; i++) await new Promise((r) => setTimeout(r, 100));
    const hit = z.hp < 999;
    z.destroy();
    return { hit };
  });
  assert.equal(fight.hit, true, 'evcil hayvan zombiye saldırmalı');

  // Kayıt / yükleme
  const saved = await page.evaluate(async () => {
    const { features } = await import('./js/features/index.js');
    const s = game.scene.getScene('Game');
    const f = features.find((x) => x.id === 'predators');
    const pet = s.predators.pets[0];
    const name = pet.petName;
    const data = JSON.parse(JSON.stringify(f.save(s)));
    f.load(s, undefined);
    f.load(s, data);
    f.begin(s, false);
    const st = s.predators;
    const p2 = st.pets[0];
    return {
      data, name, pets: st.pets.length, name2: p2?.petName, mode: p2?.state, tame: p2?.tame, target: s.extraTargets.includes(p2),
      wild: st.wild.length, hunt: st.wild.every((b) => s.huntables.includes(b)), oldGone: !pet.active
    };
  });
  assert.equal(saved.data.pets.length, 1);
  assert.equal(saved.data.pets[0].kind, 'wolf');
  assert.equal(saved.data.pets[0].mode, 'stay');
  assert.equal(saved.pets, 1, 'evcil hayvan yüklenmeli');
  assert.equal(saved.name2, saved.name, 'adı korunur');
  assert.equal(saved.mode, 'stay', 'komut korunur');
  assert.equal(saved.tame, true);
  assert.equal(saved.target, true);
  assert.equal(saved.oldGone, true, 'eski nesne temizlenir');
  assert.ok(saved.wild >= 1 && saved.wild <= saved.data.wild.length, `vahşiler yeniden doğar (${saved.wild}/${saved.data.wild.length})`);
  assert.equal(saved.hunt, true);

  await page.waitForTimeout(300);
  assertNoErrors(assert, errors);
});
