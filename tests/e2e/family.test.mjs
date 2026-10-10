// Aile sistemi: cinsiyet, karşı cinsten eşleşme, ana NPC ile evlilik, bebeği engelleyen koşulun diyalogda görünmesi,
// şafakta doğum ve kayıt/yükleme. Şafak elle tetiklenir; uzun simülasyon yok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, assertNoErrors } from './_harness.mjs';

test('aile: cinsiyet, eşleşme, ana NPC evliliği, bebek koşulları, kayıt', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(300);

  const r = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const { Survivor } = await import('/js/entities/NPC.js');
    const town = (await import('/js/features/town.js')).default;
    const d = s.shelter.door;
    const out = {};
    const mk = (name, slot, dx) => { const n = new Survivor(s, d.x + dx, d.y + 60, { name, variant: slot % 3, slot, arrived: s.timeSys.day }); s.npcs.push(n); return n; };
    const btns = () => [...document.querySelectorAll('#modal-dialog .options button')];
    const click = (txt) => btns().find((b) => b.textContent.includes(txt))?.click();
    const dlg = () => document.querySelector('#modal-dialog')?.textContent || '';
    const meta = () => document.querySelector('#modal-dialog .town-hearts')?.textContent || '';
    // Ana NPC'yi köye kat (settlement davetinin yaptığı gibi)
    const join = (key) => {
      const n = s.outsiders.find((o) => o.key === key);
      s.outsiders.splice(s.outsiders.indexOf(n), 1);
      n.outsider = null; n.siege = null;
      s.npcs.push(n);
      n.sm.set(n.workState);
      return n;
    };
    const kids = () => s.npcs.filter((n) => n.key === 'survivor' && n.child);
    const dawn = () => {
      const rnd = Math.random;
      Math.random = () => rnd() * 0.3; // bebek şansını (%40) garanti et
      try { s.timeSys.emit('dawn', s.timeSys.day); } finally { Math.random = rnd; }
    };

    // Cinsiyet ve görünüm
    out.mainGenders = Object.fromEntries([...s.npcs, ...s.outsiders].filter((n) => n.key !== 'survivor').map((n) => [n.npcName, n.gender]));
    const ali = mk('Ali', 0, 0), can = mk('Can', 1, 2), elif = mk('Elif', 2, 40);
    out.genders = [ali.gender, can.gender, elif.gender];
    out.tex = [ali.texKey, elif.texKey];

    // Karşı cinsten eşleşme: Can daha yakın olsa da Ali'nin eşi Elif olur
    s.talkTo(ali); click('Eş bul'); s.hud.closeAll();
    out.pair1 = [ali.partner, elif.partner];
    s.talkTo(can); click('Eş bul'); out.canReason = dlg(); out.canPartner = can.partner; s.hud.closeAll();

    // Ana NPC ile evlilik: Kemal köye katılır; 3♥ yoksa nedenini söyler
    const kemal = join('merchant');
    kemal.setPosition(d.x + 10, d.y + 60);
    s.talkTo(kemal);
    out.kemalBtn = btns().some((b) => b.textContent.includes('Eş bul'));
    click('Eş bul'); out.kemalReason = dlg(); s.hud.closeAll();
    s.town.rel.merchant.pts = 300;
    const gul = mk('Gül', 3, 12);
    s.talkTo(kemal); click('Eş bul'); s.hud.closeAll();
    out.pair2 = [kemal.partner, gul.partner];
    s.talkTo(kemal); out.kemalMeta = meta(); s.hud.closeAll();

    // Kiler kullanılmış ve boş: engel diyalogda görünür, şafakta bebek olmaz
    s.pantry.donated = 5; s.pantry.pantry = 0;
    s.talkTo(ali); out.blockMeta = meta(); s.hud.closeAll();
    dawn();
    out.kidsHungry = kids().length;

    // Kiler dolu: iki çifte de bebek
    s.pantry.pantry = 999;
    s.talkTo(ali); out.okMeta = meta(); s.hud.closeAll();
    dawn();
    out.kids = kids().map((k) => ({ parents: k.parents, child: k.child, scale: k.scaleX, gender: k.gender, role: k.role }));
    s.talkTo(ali); out.gapMeta = meta(); s.hud.closeAll();

    // Kayıt → yükle
    const saved = JSON.parse(JSON.stringify(town.save(s)));
    out.savedMain = saved.main;
    kemal.partner = null;
    town.load(s, saved);
    const gul2 = s.npcs.find((n) => n.npcName === 'Gül');
    out.loaded = { kemal: kemal.partner, gul: gul2?.partner, gulGender: gul2?.gender, gulTex: gul2?.texKey, kids: kids().map((k) => k.parents) };

    // Eski kayıt: cinsiyet/main alanı yok → addan çıkarılır, ana NPC'nin eşi sıfırlanır
    town.load(s, { rel: {}, survivors: [{ name: 'Derya', variant: 2, slot: 0, partner: 'Hasan' }, { name: 'Hasan', variant: 1, slot: 1, partner: 'Derya' }, { name: 'Zeynep', slot: 2 }] });
    const sv = s.npcs.filter((n) => n.key === 'survivor');
    out.old = { genders: sv.map((n) => `${n.npcName}:${n.gender}`), derya: sv.find((n) => n.npcName === 'Derya')?.partner, kemal: kemal.partner };
    return out;
  });

  assert.deepEqual(r.mainGenders, { Ayşe: 'f', Kemal: 'm', Zeynep: 'f', Demir: 'm', Selin: 'f', Murat: 'm' });
  assert.deepEqual(r.genders, ['m', 'm', 'f']);
  assert.equal(r.tex[0], 'npc_surv0');
  assert.equal(r.tex[1], 'npc_survf2', 'kadın dokusu');
  assert.deepEqual(r.pair1, ['Elif', 'Ali'], 'karşı cinsten eşleşme');
  assert.equal(r.canPartner, null);
  assert.match(r.canReason, /eşi olmayan bir kadın yok/);
  assert.equal(r.kemalBtn, true, 'ana NPC diyaloğunda Eş bul');
  assert.match(r.kemalReason, /3♥/);
  assert.deepEqual(r.pair2, ['Gül', 'Kemal'], 'ana NPC ile evlilik');
  assert.match(r.kemalMeta, /Eşi: Gül/);
  assert.match(r.blockMeta, /Kiler boş olduğu için bebek düşünmüyoruz/);
  assert.equal(r.kidsHungry, 0, 'kiler boşken bebek olmaz');
  assert.match(r.okMeta, /bebek düşünüyoruz/);
  assert.equal(r.kids.length, 2, 'iki çifte de bebek');
  assert.ok(r.kids.some((k) => k.parents.join() === 'Gül,Kemal'), 'ana NPC çiftinin bebeği');
  assert.ok(r.kids.every((k) => k.child === 3 && k.scale === 0.65 && k.role === 'Çocuk' && (k.gender === 'f' || k.gender === 'm')));
  assert.match(r.gapMeta, /gün sonra yeniden/);
  assert.deepEqual(r.savedMain, { merchant: { partner: 'Gül', lastBaby: r.savedMain.merchant.lastBaby } });
  assert.ok(r.savedMain.merchant.lastBaby > 0);
  assert.equal(r.loaded.kemal, 'Gül');
  assert.equal(r.loaded.gul, 'Kemal');
  assert.equal(r.loaded.gulGender, 'f');
  assert.match(r.loaded.gulTex, /^npc_survf/);
  assert.equal(r.loaded.kids.length, 2);
  assert.deepEqual(r.old.genders, ['Derya:f', 'Hasan:m', 'Zeynep:f']);
  assert.equal(r.old.derya, 'Hasan');
  assert.equal(r.old.kemal, null);
  assertNoErrors(assert, errors, 'family');
});
