// Co-op ödül/bildirim sahipliği: misafirin mermisiyle ölen slime'ın ganimeti misafire, ortak ödüller (rewardAll)
// ve genel olay bildirimleri (toastAll) herkese; host sekmesi kapanırken misafir ilerlemesi kaydedilir ve misafir
// kopma nedenini "host ayrıldı" olarak görür, sonra aynı odaya geri döner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoErrors } from './_harness.mjs';
import { setupMP, teleportGuest } from './_mp.mjs';

test('co-op: misafir mermisi ganimeti, ortak ödül ve genel bildirim misafire; host çıkışında kayıt + net neden', { timeout: 120000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t);
  await teleportGuest(host, guest, 200, 232);

  // 1) Misafirin mermisi slime'ı öldürür → jöle misafirin çantasına (host'a değil)
  const before = await host.evaluate(() => {
    const s = game.scene.getScene('Game'), n = s.net, g = [...n.guests.values()][0], p = g.player;
    const sl = s.monsters.spawn({ at: { x: p.x + 24, y: p.y }, kind: 'green' });
    sl.hp = 1; sl.speed = 0;
    s.__sl = sl;
    return { guest: g.inv.count('slime_gel'), host: s.inventory.count('slime_gel') };
  });
  await host.evaluate(() => {
    const s = game.scene.getScene('Game'), n = s.net, g = [...n.guests.values()][0], p = g.player, sl = s.__sl;
    n.withGuest(g, () => s.fireBullet(p.x, p.y, Phaser.Math.Angle.Between(p.x, p.y, sl.x, sl.y), 5, 260));
  });
  await host.waitForFunction(() => game.scene.getScene('Game').__sl.dead, null, { timeout: 4000 });
  const after = await host.evaluate(() => {
    const s = game.scene.getScene('Game'), g = [...s.net.guests.values()][0];
    return { guest: g.inv.count('slime_gel'), host: s.inventory.count('slime_gel') };
  });
  assert.ok(after.guest > before.guest, `jöle misafire gitmeli: ${JSON.stringify({ before, after })}`);
  assert.equal(after.host, before.host, 'host jöle almamalı');

  // 2) Ortak ödül: herkese para + bildirim; genel olay bildirimi misafirde görünür
  const c0 = await host.evaluate(() => { const s = game.scene.getScene('Game'); return [s.player.coins, s.netPlayers[0].coins]; });
  await host.evaluate(() => { const s = game.scene.getScene('Game'); s.rewardAll(7, 'ODUL-TEST'); s.toastAll('OLAY-TEST', 'warn'); });
  const c1 = await host.evaluate(() => { const s = game.scene.getScene('Game'); return [s.player.coins, s.netPlayers[0].coins]; });
  assert.deepEqual([c1[0] - c0[0], c1[1] - c0[1]], [7, 7], 'ödül iki oyuncuya');
  await guest.waitForFunction(() => { const t = game.scene.getScene('Game').hud.e.toasts.textContent; return t.includes('ODUL-TEST') && t.includes('OLAY-TEST'); }, null, { timeout: 4000 });
  assert.ok(await host.evaluate(() => game.scene.getScene('Game').hud.e.toasts.textContent.includes('OLAY-TEST')), 'host da görür');
  // Misafir bağlamından çağrılan toastAll host'a da ulaşır (ör. misafirin tetiklediği kuşatma uyarısı)
  await host.evaluate(() => { const s = game.scene.getScene('Game'), n = s.net; n.withGuest([...n.guests.values()][0], () => s.toastAll('BAGLAM-TEST')); });
  await host.waitForFunction(() => game.scene.getScene('Game').hud.e.toasts.textContent.includes('BAGLAM-TEST'), null, { timeout: 3000 });
  await guest.waitForFunction(() => game.scene.getScene('Game').hud.e.toasts.textContent.includes('BAGLAM-TEST'), null, { timeout: 3000 });

  // 3) Host sekmesi kapanıyor (pagehide): misafirin güncel envanteri kayda yazılır, misafir nedeni görür ve geri döner
  await host.evaluate(() => { const g = [...game.scene.getScene('Game').net.guests.values()][0]; g.inv.add('wood', 3); });
  const wood = await host.evaluate(() => [...game.scene.getScene('Game').net.guests.values()][0].inv.count('wood'));
  await host.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const saved = await host.evaluate(() => {
    const raw = Object.keys(localStorage).map((k) => localStorage.getItem(k)).find((v) => v && v.includes('"netGuests"'));
    const d = raw ? JSON.parse(raw) : null;
    const rec = d?.netGuests?.Veli;
    if (!rec) return null;
    return rec.inv.filter((x) => x?.id === 'wood').reduce((a, x) => a + x.count, 0);
  });
  assert.equal(saved, wood, 'misafirin odunu kayıtta');
  await guest.waitForFunction(() => game.scene.getScene('Game').net.lastReason === 'host-left', null, { timeout: 5000 });
  await guest.waitForFunction(() => game.scene.getScene('Game').net.welcomed, null, { timeout: 15000 });
  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});
