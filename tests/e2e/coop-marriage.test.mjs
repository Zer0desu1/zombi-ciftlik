// Co-op evlilik: eş bilgisi oyuncu başına (misafir NPC ile evlenince host'un eşi değişmez), oyuncu–oyuncu evliliği
// (misafir yakındaki host'a ✋ ile teklif eder, host panelden kabul eder), çift bebeği ve kayıtta saklanma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoErrors } from './_harness.mjs';
import { setupMP, teleportGuest } from './_mp.mjs';

test('co-op: oyuncu başına eş, oyuncu–oyuncu evliliği, çift bebeği, kayıt', { timeout: 90000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t);

  // 1) Misafir bir NPC ile evlenir → yalnızca misafirin eşi olur
  const npcRes = await host.evaluate(async () => {
    const s = game.scene.getScene('Game'), net = s.net, g = [...net.guests.values()][0];
    const { Survivor } = await import('/js/entities/NPC.js');
    const d = s.shelter.door;
    const npc = new Survivor(s, d.x, d.y + 60, { name: 'Elif', variant: 0, slot: 0, arrived: s.timeSys.day });
    s.npcs.push(npc);
    net.withGuest(g, () => s.town.api.marryPlayer(npc));
    const out = { hostSpouse: s.town.spouse, guestSpouse: s.town.spouses.Veli, npc: npc.npcName, partner: npc.partner };
    // Temizle (oyuncu–oyuncu evliliği için ikisi de bekâr olmalı)
    delete s.town.spouses.Veli; npc.partner = null;
    return out;
  });
  assert.equal(npcRes.hostSpouse, null);
  assert.equal(npcRes.guestSpouse, npcRes.npc);
  assert.equal(npcRes.partner, 'Veli');

  // 2) Misafir host'un yanına gelir: ✋ etkileşimi "💍 Ali" olur
  const hp = await host.evaluate(() => { const p = game.scene.getScene('Game').player; return { x: p.x, y: p.y }; });
  await teleportGuest(host, guest, hp.x + 14, hp.y);
  await guest.waitForFunction(() => (game.scene.getScene('Game').net.hint || '').includes('💍'), null, { timeout: 5000 });
  await guest.evaluate(() => game.scene.getScene('Game').interact());
  await guest.waitForSelector('#modal-feature.show >> text=Evlenme teklif et', { timeout: 5000 });
  await guest.click('#modal-feature.show button:has-text("Evlenme teklif et")');

  // 3) Host'a teklif paneli gelir, kabul eder
  await host.waitForSelector('#modal-feature.show >> text=Kabul et', { timeout: 5000 });
  assert.ok((await host.textContent('#modal-feature .feature-body')).includes('Veli'));
  await host.click('#modal-feature.show button:has-text("Kabul et")');
  await host.waitForFunction(() => game.scene.getScene('Game').town.couples.Veli === '@host', null, { timeout: 4000 });
  await guest.waitForFunction(() => document.getElementById('banner')?.textContent.includes('Evlendiniz'), null, { timeout: 5000 });
  const st = await host.evaluate(() => {
    const s = game.scene.getScene('Game');
    return { c: { ...s.town.couples }, hostLabel: document.getElementById('banner')?.textContent || '' };
  });
  assert.deepEqual(st.c, { '@host': 'Veli', Veli: '@host' });
  assert.ok(st.hostLabel.includes('Evlendiniz'));

  // 4) Evliyken ikinci teklif seçeneği çıkmaz; çift bebeği; kayıt
  const r = await host.evaluate(() => {
    const s = game.scene.getScene('Game');
    const born = s.town.api.couplesBirth(true);
    s.saveGame(false);
    const c = JSON.parse(localStorage.getItem('zombi-ciftlik-save-v1') || '{}').features?.town?.couples || {};
    return { kids: born.map((b) => b.parents), saved: c['@host'] === 'Veli' && c.Veli === '@host' };
  });
  assert.equal(r.kids.length, 1);
  assert.deepEqual([...r.kids[0]].sort(), ['Ali', 'Veli']);
  assert.ok(r.saved, 'çift kayıtta olmalı');
  await guest.waitForFunction(() => !(game.scene.getScene('Game').net.hint || '').includes('💍'), null, { timeout: 5000 });

  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});
