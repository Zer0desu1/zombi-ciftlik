// Co-op karakter cinsiyeti: host kadın, misafir erkek seçer; her ekranda diğer oyuncu doğru dokuyla görünür.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, waitForScene, collectErrors, assertNoErrors } from './_harness.mjs';
import { launchMP } from './_mp.mjs';

test('co-op: oyuncu cinsiyeti iki ekranda doğru', { timeout: 60000 }, async (t) => {
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
  await host.click('#cp-f');
  await host.click('#btn-mp');
  await host.fill('#mp-name', 'Ayla');
  await host.click('#mp-pick button[data-diff="normal"]');
  await host.waitForFunction(() => game.scene.getScene('Game').started && game.scene.getScene('Game').net?.code, null, { timeout: 10000 });
  const code = await host.evaluate(() => game.scene.getScene('Game').net.code);

  // Misafir (aynı tarayıcı profili) kendi tercihini Erkek yapar; host'un karakteri zaten seçildi
  await guest.goto(`${srv.url}?net=local&oda=${code}`);
  await waitForScene(guest);
  await guest.waitForSelector('#mp-pick.show', { timeout: 15000 });
  await guest.click('#cp-m');
  await guest.fill('#mp-name', 'Veli');
  await guest.click('#mp-join');
  await guest.waitForFunction(() => game.scene.getScene('Game').net?.started && game.scene.getScene('Game').started, null, { timeout: 15000 });
  await host.waitForFunction(() => game.scene.getScene('Game').netPlayers?.length >= 1, null, { timeout: 5000 });
  await guest.waitForFunction(() => game.scene.getScene('Game').net.avatars.size >= 1, null, { timeout: 5000 });

  const h = await host.evaluate(() => {
    const s = game.scene.getScene('Game');
    return { me: s.player.texKey, guest: [...s.net.guests.values()][0].player.texKey };
  });
  const g = await guest.evaluate(() => {
    const s = game.scene.getScene('Game');
    return { me: s.player.texKey, host: s.net.avatars.get('h')?.spr.texture.key };
  });
  assert.deepEqual(h, { me: 'player_f', guest: 'player' });
  assert.deepEqual(g, { me: 'player', host: 'player_f' });
  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'guest');
});
