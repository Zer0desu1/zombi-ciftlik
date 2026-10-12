// Sınıflar: menüden Şövalye / Nekromant seçimi. Şövalye kılıçla, Nekromant asayla başlar; asa taze zombi cesedini
// gölge askere çevirir, gölge zombiye saldırır, boşta gölge çağırır; sınıf kayda yazılır. Co-op: misafir nekromant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, waitForScene, assertNoErrors } from './_harness.mjs';
import { launchMP, joinGuest, guestUse } from './_mp.mjs';
import { startServer, collectErrors } from './_harness.mjs';

const SHOT = process.env.SHOT_DIR || '';

async function startAs(page, url, cls) {
  await page.goto(url + '?e2e=' + Date.now());
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitForScene(page);
  await page.waitForSelector('#menu.show', { timeout: 15000 });
  await page.click(`#cp-${cls}`);
  await page.click('#btn-new');
  await page.click('#diff-pick button.primary');
  await page.waitForFunction(() => game.scene.getScene('Game').started === true, null, { timeout: 10000 });
  await page.waitForTimeout(300);
}

const invIds = (page) => page.evaluate(() => game.scene.getScene('Game').inventory.slots.filter(Boolean).map((x) => x.id));

test('sınıf: şövalye kılıçla, nekromant asayla başlar; asa diriltir, gölge saldırır, sınıf kayda yazılır', { timeout: 90000 }, async (t) => {
  const { page, errors, url } = await setup(t);

  await startAs(page, url, 'knight');
  let ids = await invIds(page);
  assert.ok(ids.includes('sword') && !ids.includes('staff'), `şövalye envanteri: ${ids}`);
  assert.equal(await page.evaluate(() => game.scene.getScene('Game').player.cls), 'knight');

  await startAs(page, url, 'necro');
  ids = await invIds(page);
  assert.ok(ids.includes('staff') && !ids.includes('sword'), `nekromant envanteri: ${ids}`);

  // Zombi öldür → taze ceset → asa ile dirilt
  const raised = await page.evaluate(async () => {
    const s = game.scene.getScene('Game'), p = s.player;
    const z = s.spawnZombie(p.x + 30, p.y, 'brute');
    z.takeDamage(9999, p);
    const corpses = s.necro.corpses.length;
    s.selectSlot(s.inventory.slots.findIndex((x) => x?.id === 'staff'));
    p.actionCd = 0; p.energy = p.maxEnergy;
    const { useSelected } = await import('/js/systems/PlayerActions.js');
    useSelected(s, p.x + 30, p.y);
    const sh = s.necro.shadows[0];
    return { corpses, n: s.necro.shadows.length, tex: sh?.texKey, hp: sh?.maxHp, left: s.necro.corpses.length, en: p.energy };
  });
  assert.equal(raised.corpses, 1);
  assert.equal(raised.n, 1);
  assert.equal(raised.tex, 'zombie_brute');
  assert.ok(raised.hp > 20, `iri gölge dayanıklı: ${raised.hp}`);
  assert.equal(raised.left, 0);

  // Gölge yakındaki zombiye saldırır
  await page.evaluate(() => {
    const s = game.scene.getScene('Game'), p = s.player;
    const z = s.spawnZombie(p.x - 40, p.y + 10, 'normal');
    z.maxHp = z.hp = 200; z.speed = 0; window.__z = z;
  });
  await page.waitForFunction(() => window.__z.hp < 200, null, { timeout: 8000 });

  // Boşta: gölge çağır (sınır 3) ve HUD sayacı
  const summon = await page.evaluate(async () => {
    const s = game.scene.getScene('Game'), p = s.player;
    window.__z.takeDamage(9999, p);
    s.necro.corpses.splice(0).forEach((c) => c.wisp?.destroy());
    const { useSelected } = await import('/js/systems/PlayerActions.js');
    for (let i = 0; i < 4; i++) { p.actionCd = 0; p.energy = p.maxEnergy; useSelected(s, p.x, p.y + 30); }
    return { n: s.necro.shadows.length, cap: s.necro.capOf() };
  });
  assert.equal(summon.cap, 3);
  assert.equal(summon.n, 3, 'sınırda çağırma büyü atışına döner');
  await page.waitForFunction(() => (document.getElementById('nc-chip')?.textContent || '') === '💀 3/3', null, { timeout: 3000 });
  if (SHOT) { await page.waitForTimeout(600); await page.screenshot({ path: `${SHOT}/necro.png` }); }

  // Kayıt → sınıf
  const saved = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    s.saveGame(true);
    return JSON.parse(localStorage.getItem('zombi-ciftlik-save-v1')).features.necro;
  });
  assert.equal(saved.cls, 'necro');

  // Şafakta gölgeler erir
  await page.evaluate(() => game.scene.getScene('Game').timeSys.emit('dawn'));
  await page.waitForFunction(() => game.scene.getScene('Game').necro.shadows.length === 0, null, { timeout: 3000 });
  assertNoErrors(assert, errors);
});

test('sınıf co-op: misafir nekromant asayla katılır, asası host\'ta misafir adına diriltir', { timeout: 90000 }, async (t) => {
  const srv = await startServer();
  const browser = await launchMP();
  t.after(async () => { await browser.close().catch(() => {}); await srv.close(); });
  const ctx = await browser.newContext({ viewport: { width: 760, height: 480 } });
  const host = await ctx.newPage(), guest = await ctx.newPage();
  const hostErr = collectErrors(host), guestErr = collectErrors(guest);
  await host.goto(`${srv.url}?net=local`);
  await host.evaluate(() => localStorage.clear());
  await host.reload();
  await waitForScene(host);
  await host.waitForSelector('#menu.show', { timeout: 15000 });
  await host.click('#btn-mp');
  await host.fill('#mp-name', 'Ali');
  await host.click('#mp-pick button[data-diff="normal"]');
  await host.waitForFunction(() => game.scene.getScene('Game').started && game.scene.getScene('Game').net?.code, null, { timeout: 10000 });
  const code = await host.evaluate(() => game.scene.getScene('Game').net.code);
  // Aynı bağlam = ortak localStorage: misafirin tercihi nekromant
  await host.evaluate(() => localStorage.setItem('zombi-ciftlik-class', 'necro'));
  await joinGuest(guest, srv.url, code, 'Veli');
  await host.waitForFunction(() => game.scene.getScene('Game').netPlayers?.length >= 1, null, { timeout: 5000 });

  const info = await host.evaluate(() => {
    const s = game.scene.getScene('Game'), g = [...s.net.guests.values()][0];
    return { hostCls: s.player.cls, guestCls: g.player.cls, guestInv: g.inv.slots.filter(Boolean).map((x) => x.id) };
  });
  assert.equal(info.hostCls, 'knight');
  assert.equal(info.guestCls, 'necro');
  assert.ok(info.guestInv.includes('staff') && !info.guestInv.includes('sword'), `misafir envanteri: ${info.guestInv}`);
  await guest.waitForFunction(() => game.scene.getScene('Game').inventory.slots.some((x) => x?.id === 'staff'), null, { timeout: 5000 });

  // Misafirin yanında zombi öldür, misafir asayı kullanır
  const gp = await host.evaluate(() => {
    const s = game.scene.getScene('Game'), g = [...s.net.guests.values()][0], p = g.player;
    const z = s.spawnZombie(p.x + 24, p.y, 'runner');
    z.takeDamage(9999, p);
    return { x: p.x, y: p.y };
  });
  await guestUse(guest, 'staff', gp.x + 24, gp.y);
  await host.waitForFunction(() => game.scene.getScene('Game').necro.shadows.some((o) => o.ownerKey === 'Veli'), null, { timeout: 5000 });
  const sh = await host.evaluate(() => { const o = game.scene.getScene('Game').necro.shadows[0]; return { tex: o.texKey, sp: o.st.speed }; });
  assert.equal(sh.tex, 'zombie_runner');
  assert.ok(sh.sp > 62, 'koşucu gölge hızlı');
  await guest.waitForFunction(() => (document.getElementById('nc-chip')?.textContent || '').startsWith('💀 1/'), null, { timeout: 5000 });

  // Misafir kaydı: sınıf host kaydında adıyla
  const fs = await host.evaluate(() => {
    const s = game.scene.getScene('Game'), g = [...s.net.guests.values()][0];
    s.net.storeGuest(g);
    return s.netGuestStore.Veli.fs.necro;
  });
  assert.equal(fs.cls, 'necro');
  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});
