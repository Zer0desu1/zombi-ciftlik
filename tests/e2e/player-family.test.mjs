// Oyuncu karakteri ve ailesi: menüden cinsiyet seçimi (Kadın/Erkek + ad), kadın dokusu, karşı cinsten NPC ile
// kalp şartlı evlilik, zorla doğum, sınırsız işe alım, kayıt → yenile → devam: cinsiyet + eş + çocuk korunur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, waitForScene, assertNoErrors } from './_harness.mjs';

async function startWith(page, url, g, name) {
  await page.goto(url + '?e2e=' + Date.now());
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitForScene(page);
  await page.waitForSelector('#menu.show', { timeout: 15000 });
  await page.click(`#cp-${g}`);
  await page.fill('#cp-name', name);
  await page.click('#btn-new');
  await page.click('#diff-pick button.primary');
  await page.waitForFunction(() => game.scene.getScene('Game').started === true, null, { timeout: 10000 });
  await page.waitForTimeout(300);
}

test('oyuncu ailesi: karakter seçimi, evlilik, bebek, kayıt', { timeout: 90000 }, async (t) => {
  const { page, errors, url } = await setup(t);

  // ---- Erkek oyuncu: kadın NPC ile evlenebilir, erkek NPC ile değil ----
  await startWith(page, url, 'm', 'Kerem');
  const m = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const { Survivor } = await import('/js/entities/NPC.js');
    const d = s.shelter.door;
    const mk = (name, slot) => { const n = new Survivor(s, d.x + slot * 6, d.y + 60, { name, variant: 0, slot, arrived: s.timeSys.day }); s.npcs.push(n); return n; };
    const btns = () => [...document.querySelectorAll('#modal-dialog .options button')].map((b) => b.textContent);
    const ali = mk('Ali', 0), elif = mk('Elif', 1);
    s.talkTo(ali); const aliBtn = btns().some((b) => b.includes('Evlen')); s.hud.closeAll();
    s.town.rel['surv:Elif'] = { pts: 450, talk: 0, gift: 0, claimed: [] };
    s.talkTo(elif); const elifBtn = btns().some((b) => b.includes('Evlen'));
    [...document.querySelectorAll('#modal-dialog .options button')].find((b) => b.textContent.includes('Evlen'))?.click();
    s.hud.closeAll();
    return { gender: s.player.gender, tex: s.player.texKey, aliBtn, elifBtn, spouse: s.town.spouse, partner: elif.partner };
  });
  assert.equal(m.gender, 'm');
  assert.equal(m.tex, 'player');
  assert.equal(m.aliBtn, false, 'erkek oyuncu erkek NPC ile evlenemez');
  assert.equal(m.elifBtn, true, 'kadın NPC diyaloğunda Evlen');
  assert.equal(m.spouse, 'Elif');
  assert.equal(m.partner, 'Kerem');

  // ---- Kadın oyuncu ----
  await startWith(page, url, 'f', 'Deniz');
  const r = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const { Survivor } = await import('/js/entities/NPC.js');
    const d = s.shelter.door;
    const out = {};
    const mk = (name, slot) => { const n = new Survivor(s, d.x + slot * 6, d.y + 60, { name, variant: slot % 3, slot, arrived: s.timeSys.day }); s.npcs.push(n); return n; };
    const btns = () => [...document.querySelectorAll('#modal-dialog .options button')];
    const click = (txt) => btns().find((b) => b.textContent.includes(txt))?.click();
    const dlg = () => document.querySelector('#modal-dialog')?.textContent || '';
    out.gender = s.player.gender; out.tex = s.player.texKey;
    out.walk = s.anims.exists('player_f_walk');
    out.cpOn = document.querySelector('#cp-f')?.classList.contains('on');

    // İşe alım sınırı yok: 6 yetişkin de işe alınır
    s.player.coins = 5000;
    const crew = ['Can', 'Emre', 'Burak', 'Mert', 'Kaan', 'Ali'].map((n, i) => mk(n, i));
    out.hired = crew.map((c) => s.town.api.hire(c, 'lumberjack')).filter(Boolean).length;
    const ali = crew[5];
    const elif = mk('Elif', 7);

    // Aynı cinsiyet: Evlen yok
    s.talkTo(elif); out.elifBtn = btns().some((b) => b.textContent.includes('Evlen')); s.hud.closeAll();
    // Karşı cins, kalp yetersiz → neden
    s.talkTo(ali);
    out.aliBtn = btns().some((b) => b.textContent.includes('Evlen'));
    out.talkPts = s.town.rel['surv:Ali']?.pts;
    click('Evlen'); out.reason = dlg(); s.hud.closeAll();
    out.spouse0 = s.town.spouse;
    // Hediye survivor kalbini artırır
    s.giveItem('carrot', 1);
    s.talkTo(ali); click('Hediye ver'); click('Havuç'); s.hud.closeAll();
    out.giftPts = s.town.rel['surv:Ali']?.pts;
    // Kalp yeterli → evlilik
    s.town.rel['surv:Ali'].pts = 420;
    s.talkTo(ali); click('Evlen'); out.yes = dlg(); s.hud.closeAll();
    out.spouse = s.town.spouse; out.partner = ali.partner;
    s.talkTo(ali); out.meta = document.querySelector('#modal-dialog .town-hearts')?.textContent || ''; s.hud.closeAll();
    // Doğum (zorla)
    if (s.pantry) s.pantry.pantry = 999;
    const baby = s.town.api.playerBirth(true);
    out.baby = baby ? { parents: baby.parents, child: baby.child } : null;
    s.saveGame(true);
    return out;
  });
  assert.equal(r.gender, 'f');
  assert.equal(r.tex, 'player_f');
  assert.equal(r.walk, true);
  assert.equal(r.cpOn, true);
  assert.equal(r.hired, 6, 'işe alım sınırı yok');
  assert.equal(r.elifBtn, false);
  assert.equal(r.aliBtn, true);
  assert.equal(r.talkPts, 20, 'konuşma hayatta kalan kalbi verir');
  assert.match(r.reason, /4♥/);
  assert.equal(r.spouse0, null);
  assert.ok(r.giftPts > 20, `hediye puanı ${r.giftPts}`);
  assert.match(r.yes, /yuva/);
  assert.equal(r.spouse, 'Ali');
  assert.equal(r.partner, 'Deniz');
  assert.match(r.meta, /Eşin/);
  assert.deepEqual(r.baby, { parents: ['Deniz', 'Ali'], child: 3 });

  // ---- Yenile → menüde Erkek seç → Devam Et: kayıttaki kadın karakter geçerli ----
  await page.reload();
  await waitForScene(page);
  await page.waitForSelector('#menu.show', { timeout: 15000 });
  await page.click('#cp-m');
  await page.click('#btn-continue');
  await page.waitForFunction(() => game.scene.getScene('Game').started === true, null, { timeout: 10000 });
  const after = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const ali = s.npcs.find((n) => n.npcName === 'Ali');
    const kid = s.npcs.find((n) => n.key === 'survivor' && n.child);
    return { gender: s.player.gender, tex: s.player.texKey, spouse: s.town.spouse, partner: ali?.partner, kid: kid?.parents, jobs: s.npcs.filter((n) => n.job).length };
  });
  assert.deepEqual(after, { gender: 'f', tex: 'player_f', spouse: 'Ali', partner: 'Deniz', kid: ['Deniz', 'Ali'], jobs: 6 });
  assertNoErrors(assert, errors, 'player-family');
});
