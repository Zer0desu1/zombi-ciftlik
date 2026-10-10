// Co-op kaçış yuvarlanması (dash): iki yönde, art arda birkaç dash; normal ağ ve yapay gecikme altında.
// Dash bittikten sonra her iki ekranda: geride kalan hayalet/iz nesnesi yok, oyuncu/avatar açısı 0, alfa 1,
// kare/animasyon normal, konumlar eşleşiyor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoErrors } from './_harness.mjs';
import { setupMP, teleportGuest } from './_mp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sahnedeki görünür 'player' dokulu ek nesneler (gerçek oyuncu/avatar sprite'ları hariç) = yetim iz/vekil
const leftovers = (page) => page.evaluate(() => {
  const s = game.scene.getScene('Game'), keep = new Set([s.player, ...(s.netPlayers || [])]);
  if (s.net?.avatars) for (const a of s.net.avatars.values()) keep.add(a.spr);
  return s.children.list.filter((o) => !keep.has(o) && o.visible && o.alpha > 0.01 && o.texture?.key === 'player').length;
});

async function dashes(page, n) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.down('d');
    await sleep(60);
    await page.keyboard.press('Shift');
    await sleep(120);
    await page.keyboard.up('d');
    await sleep(700); // yuvarlanma bekleme süresi 0.6 sn
  }
}

async function check(host, guest, label) {
  await sleep(500);
  const [lh, lg] = [await leftovers(host), await leftovers(guest)];
  assert.equal(lh, 0, `${label}: host ekranında yetim iz/hayalet`);
  assert.equal(lg, 0, `${label}: misafir ekranında yetim iz/hayalet`);
  const g = await guest.evaluate(() => {
    const s = game.scene.getScene('Game'), p = s.player, a = s.net.avatars.get('h');
    return { me: [p.x, p.y, p.angle, p.alpha, p.rollT], av: a ? [a.spr.x, a.spr.y, a.spr.angle, a.spr.alpha, a.spr.anims.isPlaying ? 1 : 0, Number(a.spr.frame.name)] : null };
  });
  const h = await host.evaluate(() => {
    const s = game.scene.getScene('Game'), q = s.netPlayers[0], hp = s.player;
    return { guest: [q.x, q.y, q.angle, q.alpha], host: [hp.x, hp.y, hp.angle, hp.alpha] };
  });
  assert.equal(Math.round(g.me[2]), 0, `${label}: misafirin kendi açısı`);
  assert.equal(g.me[3], 1, `${label}: misafirin alfası`);
  assert.equal(Math.round(h.guest[2]), 0, `${label}: host'taki misafir karakterinin açısı`);
  assert.ok(Math.hypot(g.me[0] - h.guest[0], g.me[1] - h.guest[1]) < 2, `${label}: misafir konumu host'ta ${h.guest} / misafirde ${g.me}`);
  assert.ok(g.av, 'host avatarı');
  assert.equal(Math.round(g.av[2]), 0, `${label}: misafirdeki host avatarının açısı`);
  assert.equal(g.av[3], 1, `${label}: avatar alfası`);
  assert.equal(g.av[4], 0, `${label}: duran avatarın yürüme animasyonu durmalı`);
  assert.equal(g.av[5], 0, `${label}: duran avatar 0. karede`);
  assert.ok(Math.hypot(g.av[0] - h.host[0], g.av[1] - h.host[1]) < 2, `${label}: host konumu ${h.host} / misafirdeki avatar ${g.av}`);
}

for (const [name, q] of [['normal ağ', ''], ['gecikme (lag=120 jitter=40 loss=5)', '&lag=120&jitter=40&loss=5']]) {
  test(`co-op dash: iki yönde art arda dash, yetim iz yok, açı/konum eşleşir · ${name}`, { timeout: 120000 }, async (t) => {
    const { host, guest, hostErr, guestErr } = await setupMP(t, { q });
    await teleportGuest(host, guest, 200, 232);
    await host.evaluate(() => game.scene.getScene('Game').player.setPosition(300, 232));
    // (a) misafir dash atar
    await dashes(guest, 3);
    await check(host, guest, 'misafir dash');
    // (b) host dash atar
    await dashes(host, 3);
    await check(host, guest, 'host dash');
    // Aynı anda ikisi
    await Promise.all([dashes(guest, 2), dashes(host, 2)]);
    await check(host, guest, 'ikisi birlikte');
    assertNoErrors(assert, hostErr, 'host');
    assertNoErrors(assert, guestErr, 'misafir');
  });
}
