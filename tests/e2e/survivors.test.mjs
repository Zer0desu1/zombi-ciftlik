// Hayatta kalan meslekleri (oduncu/madenci/çiftçi) ve aile (eş + bebek) — durumlar elle tetiklenir, uzun simülasyon yok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, assertNoErrors } from './_harness.mjs';

test('hayatta kalanlar: meslekler, eş bulma, bebek, kayıt', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(300);

  const r = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const { Survivor } = await import('/js/entities/NPC.js');
    const town = (await import('/js/features/town.js')).default;
    const d = s.shelter.door;
    const mk = (name, slot) => { const n = new Survivor(s, d.x, d.y + 60, { name, variant: slot % 3, slot, arrived: s.timeSys.day }); s.npcs.push(n); return n; };
    const a = mk('Ali', 0), b = mk('Elif', 1);
    s.player.coins = 1000;
    const out = {};

    // Diyalogdan işe al: 4 meslek butonu
    s.talkTo(a);
    const btns = [...document.querySelectorAll('#modal-dialog .options button')].map((x) => x.textContent);
    out.jobBtns = ['Çiftçi', 'Savaşçı', 'Oduncu', 'Madenci'].every((j) => btns.some((t) => t.includes(j)));
    out.mateBtn = btns.some((t) => t.includes('Eş bul'));
    [...document.querySelectorAll('#modal-dialog .options button')].find((x) => x.textContent.includes('Oduncu'))?.click();
    out.role = a.role;
    out.job = a.job;
    s.hud.closeAll();

    // Oduncu: en yakın ağaç seçilir, vuruşlarla kesilir, odun taşınır, kapıda teslim edilir
    const tree = a.findResource('tree');
    out.foundTree = !!tree;
    a.sm.set('goRes', tree);
    a.setPosition(tree.x + a.side, tree.y + 8);
    a.update(0.016);
    out.state1 = a.sm.name;
    for (let i = 0; i < 12 && !tree.depleted; i++) a.update(1.4);
    out.depleted = tree.depleted;
    out.carry = a.carry.wood || 0;
    // Teslimat köy sandığına (storage) gider; sandık yoksa/doluysa oyuncuya
    const woodAll = () => s.inventory.count('wood') + (s.storage?.count('wood') || 0);
    const before = woodAll();
    a.unload();
    out.delivered = woodAll() - before;

    // Madenci
    b.setJob('miner');
    out.minerRole = b.role;
    out.rock = !!b.findResource('rock');

    // Eş bul + bebek
    s.talkTo(a);
    [...document.querySelectorAll('#modal-dialog .options button')].find((x) => x.textContent.includes('Eş bul'))?.click();
    out.partners = [a.partner, b.partner];
    out.metaText = document.querySelector('#modal-dialog .town-hearts')?.textContent || '';
    s.hud.closeAll();
    if (s.pantry) s.pantry.pantry = 999;
    const rnd = Math.random;
    Math.random = () => rnd() * 0.3; // bebek şansını (%35) garanti et, UUID üretimi bozulmasın
    try { s.timeSys.emit('dawn', s.timeSys.day); } finally { Math.random = rnd; }
    const baby = s.npcs.find((n) => n.key === 'survivor' && n.child);
    out.baby = baby ? { role: baby.role, child: baby.child, scale: baby.scaleX } : null;
    out.babyHire = baby ? (() => { s.talkTo(baby); const t = [...document.querySelectorAll('#modal-dialog .options button')].some((x) => x.textContent.includes('Oduncu')); s.hud.closeAll(); return t; })() : null;

    // Kayıt / yükleme
    const saved = JSON.parse(JSON.stringify(town.save(s)));
    town.load(s, saved);
    const sv = s.npcs.filter((n) => n.key === 'survivor');
    out.loaded = sv.map((n) => ({ name: n.npcName, job: n.job, partner: n.partner, child: n.child }));
    // Eski kayıt: yeni alanlar yok
    town.load(s, { rel: {}, survivors: [{ name: 'Cem', variant: 1, job: 'sentry', arrived: 1, slot: 0 }] });
    const cem = s.npcs.find((n) => n.npcName === 'Cem');
    out.old = cem ? { job: cem.job, role: cem.role, partner: cem.partner, child: cem.child } : null;

    // Büyüme: child 1 iken şafakta yetişkin olur
    const kid = new Survivor(s, d.x, d.y + 60, { name: 'Nur', slot: 2, child: 1 });
    s.npcs.push(kid);
    s.timeSys.emit('dawn', s.timeSys.day);
    out.grown = { child: kid.child, scale: kid.scaleX, role: kid.role };
    return out;
  });

  assert.equal(r.jobBtns, true, '4 meslek butonu');
  assert.equal(r.mateBtn, true);
  assert.equal(r.job, 'lumberjack');
  assert.equal(r.role, 'Oduncu');
  assert.equal(r.foundTree, true);
  assert.equal(r.state1, 'work');
  assert.equal(r.depleted, true, 'ağaç kesilmeli');
  assert.ok(r.carry >= 2 && r.carry <= 4, `taşınan odun ${r.carry}`);
  assert.equal(r.delivered, r.carry, 'odun sandığa/oyuncuya teslim edilmeli');
  assert.equal(r.minerRole, 'Madenci');
  assert.equal(r.rock, true);
  assert.deepEqual(r.partners, ['Elif', 'Ali']);
  assert.match(r.metaText, /Eşi: Elif/);
  assert.ok(r.baby, 'bebek doğmalı');
  assert.equal(r.baby.role, 'Çocuk');
  assert.equal(r.baby.child, 3);
  assert.equal(r.baby.scale, 0.65);
  assert.equal(r.babyHire, false, 'çocuk işe alınamaz');
  assert.equal(r.loaded.length, 3);
  assert.equal(r.loaded.find((n) => n.name === 'Ali').partner, 'Elif');
  assert.equal(r.loaded.find((n) => n.child).child, 3);
  assert.deepEqual(r.old, { job: 'sentry', role: 'Savaşçı', partner: null, child: 0 });
  assert.deepEqual(r.grown, { child: 0, scale: 1, role: 'Hayatta Kalan' });
  assertNoErrors(assert, errors, 'survivors');
});
