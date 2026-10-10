// İsteğe bağlı, internet gerektirir: gerçek PeerJS (genel sinyal sunucusu + WebRTC) üzerinden iki ayrı tarayıcı
// bağlamıyla bağlan, birkaç saniye hareket + saldırı + inşa yap, senkron özetlerini karşılaştır.
// İnternet / sinyal sunucusu yoksa atlanır. Ayrıca çalıştırmak için: node --test tests/e2e/coop-peerjs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, collectErrors, waitForScene } from './_harness.mjs';
import { launchMP, waitSynced, guestUse } from './_mp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function online() {
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch('https://0.peerjs.com/peerjs/id', { signal: ctl.signal });
    clearTimeout(tm);
    return r.ok;
  } catch { return false; }
}

test('co-op gerçek ağ: PeerJS ile iki bağlam bağlanır, eylemler senkron kalır, kopunca geri döner', { timeout: 200000 }, async (t) => {
  if (!(await online())) { t.skip('İnternet / PeerJS sinyal sunucusu erişilemiyor'); return; }
  const srv = await startServer();
  const browser = await launchMP();
  t.after(async () => { await browser.close().catch(() => {}); await srv.close(); });
  const hctx = await browser.newContext({ viewport: { width: 760, height: 480 } });
  const gctx = await browser.newContext({ viewport: { width: 760, height: 480 } });
  const host = await hctx.newPage(), guest = await gctx.newPage();
  const hostErr = collectErrors(host), guestErr = collectErrors(guest);

  await host.goto(srv.url);
  await host.evaluate(() => localStorage.clear());
  await host.reload();
  await waitForScene(host);
  await host.waitForSelector('#menu.show', { timeout: 15000 });
  await host.click('#btn-mp');
  await host.fill('#mp-name', 'Ali');
  await host.click('#mp-pick button[data-diff="normal"]');
  const ok = await host.waitForFunction(() => game.scene.getScene('Game').net?.code, null, { timeout: 25000 }).then(() => true, () => false);
  if (!ok) { t.skip('Oda kurulamadı (sinyal sunucusu yanıt vermedi)'); return; }
  const code = await host.evaluate(() => game.scene.getScene('Game').net.code);

  const t0 = Date.now();
  await guest.goto(`${srv.url}?oda=${code}`);
  await waitForScene(guest);
  await guest.waitForSelector('#mp-pick.show', { timeout: 15000 });
  await guest.fill('#mp-name', 'Veli');
  await guest.click('#mp-join');
  const joined = await guest.waitForFunction(() => game.scene.getScene('Game').net?.started, null, { timeout: 40000 }).then(() => true, () => false);
  // Genel sinyal sunucusu / NAT kaynaklı bağlantı kurulamazsa ortam sorunu sayılır (isteğe bağlı test)
  if (!joined) { t.skip(`Misafir bağlanamadı: ${await guest.textContent('.mp-status').catch(() => '?')}`); return; }
  const joinMs = Date.now() - t0;
  await host.waitForFunction(() => game.scene.getScene('Game').netPlayers?.length === 1, null, { timeout: 10000 });
  // Hızlı (güvenilmez) kanalın açılması
  const fast = await guest.waitForFunction(() => !!game.scene.getScene('Game').net.conn.fastFn, null, { timeout: 10000 }).then(() => true, () => false);

  // Hareket + saldırı + inşa
  await guest.keyboard.down('d'); await sleep(600); await guest.keyboard.up('d');
  const gp = await guest.evaluate(() => { const p = game.scene.getScene('Game').player; return [p.x, p.y]; });
  await host.waitForFunction(([x, y]) => { const p = game.scene.getScene('Game').netPlayers[0]; return Math.hypot(p.x - x, p.y - y) < 2; }, gp, { timeout: 5000 });
  const zp = await host.evaluate(() => { const s = game.scene.getScene('Game'), p = s.netPlayers[0]; const z = s.spawnZombie(p.x + 12, p.y, 'normal'); z.hp = 1; z.speed = 0; z.damage = 0; return [z.x, z.y]; });
  await sleep(600);
  await guestUse(guest, 'sword', zp[0], zp[1]);
  await host.evaluate(() => { const g = [...game.scene.getScene('Game').net.guests.values()][0]; g.inv.add('barricade', 1); });
  await guest.waitForFunction(() => game.scene.getScene('Game').inventory.count('barricade') === 1, null, { timeout: 5000 });
  const bp = await guest.evaluate(() => { const p = game.scene.getScene('Game').player; return [Math.floor(p.x / 16) * 16 + 8, Math.floor(p.y / 16) * 16 - 8]; });
  await guestUse(guest, 'barricade', bp[0], bp[1]);
  await sleep(1500);
  const sync = await waitSynced(host, guest, 6000, ['min']);
  const st = await host.evaluate(() => { const g = [...game.scene.getScene('Game').net.guests.values()][0]; return { ping: Math.round(g.ping), out: g.conn.stats.out, sec: (performance.now() - g.conn.stats.t0) / 1000, fast: !!g.conn.fastFn }; });
  console.log(`[PeerJS] katılma ${joinMs} ms · ping ${st.ping} ms · hızlı kanal misafir:${fast} host:${st.fast} · ort. ${(st.out / st.sec / 1024).toFixed(1)} KB/sn · özet: ${sync.diff.length ? sync.diff.join(' | ') : 'aynı'}`);
  assert.deepEqual(sync.diff, [], 'gerçek ağda dünya özetleri eşleşmeli');
  // Teşhis: ilk görüntü boyutu (PeerJS json kanalı 16300 bayttan büyük tek mesajı reddeder → parçalanmalı), aday çifti
  const diag = await host.evaluate(async () => {
    const g = [...game.scene.getScene('Game').net.guests.values()][0];
    const inf = await g.conn.info();
    return { maxMsg: g.conn.stats.maxMsg, chunked: g.conn.stats.chunked, chunks: g.conn.stats.chunks, peak: g.conn.stats.peakBuf, pair: inf.pair, sctp: inf.maxMsgSize };
  });
  console.log(`[PeerJS] en büyük mesaj ${diag.maxMsg} krk · ${diag.chunked} parçalı (${diag.chunks} parça) · tampon tepe ${diag.peak} B · aday ${JSON.stringify(diag.pair)} · SCTP maxMessageSize ${diag.sctp}`);

  // Yeniden bağlanma: misafir veri kanalını kapatır → otomatik döner, konum korunur
  await host.evaluate(() => { const g = [...game.scene.getScene('Game').net.guests.values()][0]; g.inv.add('stone', 5); });
  await guest.waitForFunction(() => game.scene.getScene('Game').inventory.count('stone') >= 5, null, { timeout: 5000 });
  const before = await guest.evaluate(() => { const p = game.scene.getScene('Game').player; return [p.x, p.y]; });
  const r0 = Date.now();
  await guest.evaluate(() => game.scene.getScene('Game').net.conn.close('dc-closed'));
  const back = await guest.waitForFunction(() => { const n = game.scene.getScene('Game').net; return n.welcomed && n.conn.open && n.reconnects >= 1; }, null, { timeout: 45000 }).then(() => true, () => false);
  assert.ok(back, 'misafir gerçek ağda yeniden bağlanmalı');
  await host.waitForFunction(() => game.scene.getScene('Game').netPlayers?.length === 1, null, { timeout: 10000 });
  const after = await guest.evaluate(() => { const s = game.scene.getScene('Game'); return [s.player.x, s.player.y, s.inventory.count('stone')]; });
  console.log(`[PeerJS] yeniden bağlanma ${Date.now() - r0} ms · konum farkı ${Math.hypot(after[0] - before[0], after[1] - before[1]).toFixed(1)} px`);
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 4, 'konum korunmalı');
  assert.ok(after[2] >= 5, 'envanter korunmalı');
  assert.deepEqual([...new Set(hostErr)], [], 'host hataları');
  assert.deepEqual([...new Set(guestErr)].filter((e) => !/peerjs|webrtc|ice/i.test(e)), [], 'misafir hataları');
});
