// Co-op bağlantı sağlamlığı (?net=local): arka plan sekmesi yanlış kopma üretmez, zorla kapatılan bağlantı
// otomatik döner (konum + envanter korunur, neden gösterilir), host sayfası yenilenince aynı oda kodu geri alınır
// ve misafir döner, yüksek kayıp/gecikmede kopma olmaz, büyük ilk görüntü parçalı gönderilir (PeerJS 16 KB sınırı).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForScene } from './_harness.mjs';
import { setupMP, teleportGuest, waitSynced } from './_mp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = (list) => [...new Set(list)];

test('co-op sağlamlık: misafir sekmesi arka planda 20 sn sessiz kalsa da kopma sayılmaz', { timeout: 90000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t);
  await guest.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await host.waitForFunction(() => [...game.scene.getScene('Game').net.guests.values()][0]?.hidden === true, null, { timeout: 5000 });
  // Donmuş sekme benzetimi: misafirden hiçbir şey gitmesin
  await guest.evaluate(() => { const c = game.scene.getScene('Game').net.conn; c._realOut = c._out; c._out = () => {}; });
  await sleep(20000);
  const st = await host.evaluate(() => { const n = game.scene.getScene('Game').net; const g = [...n.guests.values()][0]; return { n: n.guests.size, silent: g ? performance.now() - g.lastSeen : -1 }; });
  assert.equal(st.n, 1, 'host misafiri düşürmemeli');
  assert.ok(st.silent > 18000, `sessizlik gerçekten yaşandı (${st.silent} ms)`);
  const gs = await guest.evaluate(() => ({ open: game.scene.getScene('Game').net.conn.open, drops: game.scene.getScene('Game').net.drops }));
  assert.deepEqual(gs, { open: true, drops: 0 });
  // Geri dön: görünür + gönderim açılır
  await guest.evaluate(() => {
    const c = game.scene.getScene('Game').net.conn; c._out = c._realOut;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await host.waitForFunction(() => [...game.scene.getScene('Game').net.guests.values()][0]?.hidden === false, null, { timeout: 5000 });
  assert.deepEqual(errs(hostErr), []);
  assert.deepEqual(errs(guestErr), []);
});

test('co-op sağlamlık: taşıyıcı zorla kapanınca misafir otomatik döner, konum + envanter korunur, neden görünür', { timeout: 90000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t);
  await teleportGuest(host, guest, 260, 300);
  await host.evaluate(() => { const g = [...game.scene.getScene('Game').net.guests.values()][0]; g.inv.add('barricade', 3); });
  await guest.waitForFunction(() => game.scene.getScene('Game').inventory.count('barricade') === 3, null, { timeout: 5000 });

  // 1) Taşıyıcı kapanır (iki taraf da görür) → host misafiri düşürür, misafir yeniden katılır, konum korunur
  await guest.evaluate(() => game.scene.getScene('Game').net.conn.close('dc-closed'));
  await guest.waitForFunction(() => { const n = game.scene.getScene('Game').net; return n.welcomed && n.conn.open && n.reconnects >= 1; }, null, { timeout: 15000 });
  await host.waitForFunction(() => game.scene.getScene('Game').netPlayers.length === 1, null, { timeout: 5000 });
  const a = await guest.evaluate(() => {
    const s = game.scene.getScene('Game'), n = s.net;
    return { x: s.player.x, y: s.player.y, bar: s.inventory.count('barricade'), reason: n.lastReason, why: document.querySelector('#net-reconnect .nr-why')?.textContent || '', shown: document.querySelector('#net-reconnect')?.classList.contains('show') };
  });
  assert.ok(Math.abs(a.x - 260) < 3 && Math.abs(a.y - 300) < 3, `konum korunmalı: ${a.x},${a.y}`);
  assert.equal(a.bar, 3, 'envanter korunmalı');
  assert.equal(a.reason, 'dc-closed');
  assert.match(a.why, /Veri kanalı kapandı/);
  assert.equal(a.shown, false, 'bağlanınca gösterge kapanır');
  const hp = await host.evaluate(() => { const p = game.scene.getScene('Game').netPlayers[0]; return [p.x, p.y]; });
  assert.ok(Math.abs(hp[0] - 260) < 3 && Math.abs(hp[1] - 300) < 3, 'host tarafında da aynı konum');

  // 2) Yalnızca misafir koptuğunu sanır (host fark etmeden): aynı karakter devralınır, ad değişmez ("Veli2" olmaz)
  await guest.evaluate(() => game.scene.getScene('Game').net.conn._fire('ping-timeout'));
  await guest.waitForFunction(() => { const n = game.scene.getScene('Game').net; return n.welcomed && n.conn.open && n.reconnects >= 2; }, null, { timeout: 15000 });
  await sleep(500);
  const h = await host.evaluate(() => { const n = game.scene.getScene('Game').net; return { n: n.guests.size, names: [...n.guests.values()].map((g) => g.name), bar: [...n.guests.values()][0].inv.count('barricade') }; });
  assert.deepEqual(h, { n: 1, names: ['Veli'], bar: 3 });
  // Teşhis paneli: neden ve günlük
  const d = await guest.evaluate(async () => {
    const n = game.scene.getScene('Game').net;
    document.querySelector('#net-panel .np-diag-btn').click();
    const info = await n.diagInfo();
    await new Promise((r) => setTimeout(r, 300));
    if (!document.querySelector('#net-panel .np-lines').textContent.includes('Son kopma')) throw new Error('panelde Son kopma yok');
    const { netLogText } = await import('/js/net/diag.js');
    return { lines: Object.fromEntries(info.lines), log: netLogText({}) };
  });
  assert.match(d.lines['Son kopma'], /Ping zaman aşımı/);
  assert.match(d.log, /lost/);
  const sync = await waitSynced(host, guest, 5000, ['min']);
  assert.deepEqual(sync.diff, []);
  assert.deepEqual(errs(hostErr), []);
  assert.deepEqual(errs(guestErr), []);
});

test('co-op sağlamlık: host sayfası yenilenince aynı oda kodu alınır ve misafir otomatik döner', { timeout: 120000 }, async (t) => {
  const { host, guest, code, guestErr } = await setupMP(t);
  await teleportGuest(host, guest, 240, 280);
  await host.evaluate(() => { const s = game.scene.getScene('Game'); [...s.net.guests.values()][0].inv.add('stone', 7); s.saveGame(true); });
  await host.reload();
  await waitForScene(host);
  await host.waitForSelector('#menu.show', { timeout: 15000 });
  await host.click('#btn-mp');
  await host.fill('#mp-name', 'Ali'); // aynı tarayıcı bağlamında ad localStorage'da ortak
  await host.click('#mp-pick .mp-cont');
  await host.waitForFunction(() => game.scene.getScene('Game').net?.code, null, { timeout: 10000 });
  assert.equal(await host.evaluate(() => game.scene.getScene('Game').net.code), code, 'aynı oda kodu');
  await guest.waitForFunction(() => { const n = game.scene.getScene('Game').net; return n.welcomed && n.conn.open && n.reconnects >= 1; }, null, { timeout: 30000 });
  await host.waitForFunction(() => game.scene.getScene('Game').netPlayers.length === 1, null, { timeout: 5000 });
  const g = await guest.evaluate(() => { const s = game.scene.getScene('Game'); return { stone: s.inventory.count('stone'), x: s.player.x, y: s.player.y }; });
  assert.ok(g.stone >= 7, 'envanter kayıttan geri gelir');
  assert.ok(Math.abs(g.x - 240) < 3 && Math.abs(g.y - 280) < 3, `60 sn içinde dönünce konum korunur: ${g.x},${g.y}`);
  const sync = await waitSynced(host, guest, 6000, ['min']);
  assert.deepEqual(sync.diff, []);
  assert.deepEqual(errs(guestErr), []);
});

test('co-op sağlamlık: yüksek kayıp + gecikmede (loss=30, lag=400, jitter=200) kopma yok', { timeout: 90000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t, { q: '&lag=400&jitter=200&loss=30' });
  await guest.keyboard.down('d'); await sleep(1500); await guest.keyboard.up('d');
  await guest.keyboard.down('s'); await sleep(1500); await guest.keyboard.up('s');
  await sleep(6000);
  const g = await guest.evaluate(() => { const n = game.scene.getScene('Game').net; return { drops: n.drops, open: n.conn.open, rtt: Math.round(n.rtt || 0) }; });
  const h = await host.evaluate(() => game.scene.getScene('Game').net.guests.size);
  console.log(`[kayıp/gecikme] rtt ${g.rtt} ms`);
  assert.equal(g.drops, 0, 'misafir kopmamalı');
  assert.ok(g.open);
  assert.equal(h, 1, 'host misafiri tutmalı');
  assert.deepEqual(errs(hostErr), []);
  assert.deepEqual(errs(guestErr), []);
});

test('co-op sağlamlık: büyük ilk dünya görüntüsü parçalı gönderilir (16 KB sınırı benzetimi)', { timeout: 90000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t, { q: '&maxMsg=16300' });
  // Dünyayı büyüt: çok sayıda zombi (hareketsiz) → yeniden katılmada tam görüntü büyük
  await host.evaluate(() => {
    const s = game.scene.getScene('Game');
    for (let i = 0; i < 250; i++) { const z = s.spawnZombie(400 + (i % 25) * 14, 500 + Math.floor(i / 25) * 14, 'normal'); z.speed = 0; z.damage = 0; }
  });
  await sleep(500);
  const progress = [];
  await guest.exposeFunction('__prog', (a, b) => progress.push([a, b]));
  await guest.evaluate(() => {
    const n = game.scene.getScene('Game').net;
    n.conn.close('dc-closed');
    const orig = n.attach.bind(n);
    n.attach = (c) => { orig(c); const p = c.onProgress; c.onProgress = (a, b) => { window.__prog(a, b); p(a, b); }; };
  });
  await guest.waitForFunction(() => { const n = game.scene.getScene('Game').net; return n.welcomed && n.conn.open && n.reconnects >= 1; }, null, { timeout: 20000 });
  const st = await host.evaluate(() => { const g = [...game.scene.getScene('Game').net.guests.values()][0]; return { ...g.conn.stats }; });
  const gst = await guest.evaluate(() => ({ ...game.scene.getScene('Game').net.conn.stats }));
  console.log(`[parçalı] en büyük mesaj ${st.maxMsg} krk · ${st.chunked} parçalı mesaj / ${st.chunks} parça · aşan iletim ${st.tooBig}/${gst.tooBig}`);
  assert.ok(st.maxMsg > 16300, `ilk görüntü 16 KB'tan büyük olmalı (${st.maxMsg})`);
  assert.ok(st.chunked >= 1 && st.chunks >= 5, 'parçalı gönderim');
  assert.equal(st.tooBig, 0, 'sınırı aşan iletim yok (host)');
  assert.equal(gst.tooBig, 0, 'sınırı aşan iletim yok (misafir)');
  assert.ok(progress.length >= 5, 'ilerleme bildirildi');
  const sync = await waitSynced(host, guest, 6000, ['min']);
  assert.deepEqual(sync.diff, []);
  assert.deepEqual(errs(hostErr), []);
  assert.deepEqual(errs(guestErr), []);
});
