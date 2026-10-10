// Ağ taşıyıcıları: PeerJS (WebRTC, internet üzerinden, sunucusuz) ve yerel BroadcastChannel
// (aynı tarayıcıdaki iki sekme; testler için ?net=local). İkisi de aynı bağlantı arayüzünü verir:
//   conn = { id, open, send(obj), close(), onData(fn), onClose(fn) }
// Mesajlar JSON nesneleridir. PeerJS yalnızca çok oyunculu mod açılınca (tembel) yüklenir;
// böylece tek oyunculu oyun internetsiz de eskisi gibi çalışır.

export const PEERJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js';
const ID_PREFIX = 'hasat-hayatta-kal-v1-';     // genel PeerJS sunucusunda başka uygulamalarla çakışmasın
const LETTERS = 'ABCDEFGHJKLMNPRSTUVYZ';       // karışabilecek harfler (I/O/Q/W/X) yok

export function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return `ZC-${s}`;
}

// Kullanıcının yazdığını (zc-abcde, ZCABCDE, abcde) 'ZC-ABCDE' biçimine getirir; geçersizse null
export function normalizeCode(raw) {
  let s = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length === 7 && s.startsWith('ZC')) s = s.slice(2);
  return s.length === 5 ? `ZC-${s}` : null;
}

const peerIdOf = (code) => ID_PREFIX + code.slice(3).toLowerCase();

// ?net=local → BroadcastChannel taşıyıcısı
export function isLocalNet() {
  try { return new URLSearchParams(location.search).get('net') === 'local'; } catch { return false; }
}

let peerLib = null;
function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (peerLib) return peerLib;
  peerLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEERJS_URL;
    s.async = true;
    s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS yüklenemedi')));
    s.onerror = () => { peerLib = null; reject(new Error('PeerJS yüklenemedi (internet bağlantısı?)')); };
    document.head.appendChild(s);
  });
  return peerLib;
}

// Test/geliştirme: yapay ağ koşulları (?lag=120&jitter=40&loss=5). lag/jitter ms (tek yön, giden mesajlara),
// loss yüzde. Güvenilir kanalda kayıp = yeniden iletim gecikmesi (sıra korunur, arkadakiler bekler: SCTP gibi);
// hızlı (güvenilmez) kanalda kayıp = mesaj düşer, sıra karışabilir.
function simConfig() {
  try {
    const q = new URLSearchParams(location.search);
    const lag = Math.max(0, +q.get('lag') || 0), jitter = Math.max(0, +q.get('jitter') || 0);
    const loss = Math.min(0.9, Math.max(0, (+q.get('loss') || 0) / 100));
    return lag || jitter || loss ? { lag, jitter, loss } : null;
  } catch { return null; }
}
export const NET_SIM = simConfig();

// Ortak bağlantı nesnesi. send = güvenilir + sıralı (olaylar, yapı/tarla/envanter değişiklikleri);
// sendFast = güvenilmez, en son kazanır (konum akışı; alıcı sıra numarasıyla eskiyi atar).
// stats: giden/gelen bayt (JSON uzunluğu) ölçümü.
function makeConn(id, sendFn, closeFn) {
  const sim = NET_SIM;
  let relAt = 0; // güvenilir kanalda bir sonraki en erken teslim zamanı (sıra korunur)
  const relQ = [];
  const pump = () => {
    if (!relQ.length) return;
    const wait = relQ[0][0] - performance.now();
    if (wait > 0) { setTimeout(pump, wait); return; }
    while (relQ.length && relQ[0][0] <= performance.now() + 0.5) relQ.shift()[1]();
    if (relQ.length) pump();
  };
  const c = {
    id, open: true, _data: null, _close: null, _fired: false, fastFn: null,
    stats: { out: 0, in: 0, outMsgs: 0, inMsgs: 0, fastOut: 0, dropped: 0, t0: performance.now() },
    send(m) { c._out(m, false); },
    sendFast(m) { c._out(m, true); },
    _out(m, fast) {
      if (!c.open) return;
      const fn = fast && c.fastFn ? c.fastFn : sendFn;
      let n = 0;
      try { n = JSON.stringify(m).length; } catch { /* yok say */ }
      c.stats.out += n; c.stats.outMsgs++;
      if (fast) c.stats.fastOut += n;
      const go = () => { if (!c.open) return; try { fn(m); } catch (e) { console.warn('Ağ gönderimi başarısız', e); } };
      if (!sim) { go(); return; }
      const now = performance.now();
      let at = now + sim.lag + Math.random() * sim.jitter;
      if (fast) {
        if (Math.random() < sim.loss) { c.stats.dropped++; return; }
        setTimeout(go, at - now);
        return;
      }
      // Güvenilir: tek kuyruktan sırayla teslim (ayrı setTimeout'lar ms yuvarlamasıyla sırayı bozabiliyordu)
      if (Math.random() < sim.loss) at += Math.max(200, sim.lag * 3);
      at = relAt = Math.max(at, relAt);
      relQ.push([at, go]);
      if (relQ.length === 1) pump();
    },
    close() { if (!c.open) return; c.open = false; try { closeFn?.(); } catch { /* yok say */ } c._fire(); },
    onData(fn) { c._data = fn; },
    onClose(fn) { c._close = fn; },
    _recv(m, bytes) { if (!c.open) return; c.stats.inMsgs++; if (bytes) c.stats.in += bytes; c._data?.(m); },
    _fire() { c.open = false; if (c._fired) return; c._fired = true; c.onClose2?.(); c._close?.(); }
  };
  return c;
}

function withTimeout(p, ms, msg) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

// ---------------- PeerJS ----------------
function wrapPeerConn(dc, onClosed) {
  const c = makeConn(dc.peer, (m) => dc.send(m), () => { dc.close(); onClosed?.(); });
  dc.on('data', (d) => (typeof d === 'string' ? c._recv(JSON.parse(d), d.length) : c._recv(d)));
  dc.on('close', () => c._fire());
  dc.on('error', () => c._fire());
  // ICE koptuğunda 'close' geç gelebilir
  dc.peerConnection?.addEventListener?.('iceconnectionstatechange', () => {
    const st = dc.peerConnection?.iceConnectionState;
    if (st === 'failed' || st === 'closed') c._fire();
  });
  return c;
}

// Hızlı (güvenilmez, sırasız) ikinci veri kanalı: konum akışı yeniden iletimi beklemesin (sıra tıkanması yok)
function attachFast(c, fdc) {
  c.fastFn = (m) => fdc.send(m);
  fdc.on('data', (d) => (typeof d === 'string' ? c._recv(JSON.parse(d), d.length) : c._recv(d)));
  const off = () => { c.fastFn = null; };
  fdc.on('close', off);
  fdc.on('error', off);
  c.onClose2 = () => { try { fdc.close(); } catch { /* yok say */ } };
}

async function hostPeer(onConn) {
  const Peer = await loadPeerJS();
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = makeCode();
    const peer = new Peer(peerIdOf(code), { debug: 0 });
    try {
      await withTimeout(new Promise((resolve, reject) => {
        peer.once('open', resolve);
        peer.once('error', reject);
      }), 15000, 'Sinyal sunucusuna bağlanılamadı');
    } catch (e) {
      lastErr = e;
      try { peer.destroy(); } catch { /* yok say */ }
      if (e?.type === 'unavailable-id') continue; // kod kullanımda → yenisini dene
      throw e;
    }
    let handler = onConn;
    const byPeer = new Map(), pendingFast = new Map();
    peer.on('connection', (dc) => {
      if (dc.metadata?.lane === 'fast') {
        dc.on('open', () => { const c = byPeer.get(dc.peer); if (c?.open) attachFast(c, dc); else pendingFast.set(dc.peer, dc); });
        return;
      }
      dc.on('open', () => {
        const c = wrapPeerConn(dc);
        byPeer.set(dc.peer, c);
        const f = pendingFast.get(dc.peer);
        if (f) { pendingFast.delete(dc.peer); attachFast(c, f); }
        handler(c);
      });
    });
    // Sinyal sunucusu bağlantısı koparsa yeniden bağlan (mevcut veri kanalları etkilenmez)
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch { /* yok say */ } }, 1500); });
    peer.on('error', (e) => console.warn('PeerJS:', e?.type || e));
    // rebind: oyun yeniden başlayınca aynı oda (aynı kod) yeni oturuma devredilir
    return { code, rebind: (fn) => { handler = fn; }, close: () => { try { peer.destroy(); } catch { /* yok say */ } } };
  }
  throw lastErr || new Error('Oda kodu alınamadı');
}

async function joinPeer(code) {
  const Peer = await loadPeerJS();
  const peer = new Peer({ debug: 0 });
  await withTimeout(new Promise((resolve, reject) => { peer.once('open', resolve); peer.once('error', reject); }), 15000, 'Sinyal sunucusuna bağlanılamadı');
  const dc = peer.connect(peerIdOf(code), { reliable: true, serialization: 'json' });
  try {
    await withTimeout(new Promise((resolve, reject) => {
      dc.once('open', resolve);
      dc.once('error', reject);
      peer.once('error', (e) => reject(e?.type === 'peer-unavailable' ? new Error('Oda bulunamadı') : e));
    }), 15000, 'Odaya bağlanılamadı (kod doğru mu?)');
  } catch (e) {
    try { peer.destroy(); } catch { /* yok say */ }
    throw e;
  }
  const c = wrapPeerConn(dc, () => setTimeout(() => { try { peer.destroy(); } catch { /* yok say */ } }, 200));
  // Hızlı kanal (açılamazsa konumlar güvenilir kanaldan gider)
  try {
    const fdc = peer.connect(peerIdOf(code), { reliable: false, serialization: 'json', metadata: { lane: 'fast' } });
    fdc.on('open', () => { if (c.open) attachFast(c, fdc); });
  } catch (e) { console.warn('Hızlı kanal açılamadı', e); }
  return c;
}

// ---------------- Yerel (BroadcastChannel) ----------------
function hostLocal(onConn) {
  const code = makeCode();
  const ch = new BroadcastChannel(`zc-net-${code}`);
  const conns = new Map();
  let handler = onConn;
  ch.onmessage = (ev) => {
    const m = ev.data;
    if (!m || m.to && m.to !== 'host') return;
    if (m.k === 'hello') {
      if (conns.has(m.from)) return;
      const c = makeConn(m.from, (d) => ch.postMessage({ k: 'msg', from: 'host', to: m.from, d: JSON.stringify(d) }), () => ch.postMessage({ k: 'bye', from: 'host', to: m.from }));
      conns.set(m.from, c);
      c.onClose(() => conns.delete(m.from));
      ch.postMessage({ k: 'ack', from: 'host', to: m.from });
      handler(c);
    } else if (m.k === 'msg') conns.get(m.from)?._recv(JSON.parse(m.d), m.d.length);
    else if (m.k === 'bye') conns.get(m.from)?._fire();
  };
  const bye = () => conns.forEach((c) => c.close());
  window.addEventListener('pagehide', bye);
  return Promise.resolve({ code, rebind: (fn) => { handler = fn; }, close: () => { bye(); window.removeEventListener('pagehide', bye); ch.close(); } });
}

function joinLocal(code) {
  const ch = new BroadcastChannel(`zc-net-${code}`);
  const me = 'g' + Math.random().toString(36).slice(2, 10);
  return withTimeout(new Promise((resolve) => {
    let c = null;
    ch.onmessage = (ev) => {
      const m = ev.data;
      if (!m || m.to !== me) return;
      if (m.k === 'ack' && !c) {
        c = makeConn('host', (d) => ch.postMessage({ k: 'msg', from: me, to: 'host', d: JSON.stringify(d) }), () => { ch.postMessage({ k: 'bye', from: me, to: 'host' }); ch.close(); });
        window.addEventListener('pagehide', () => c.close());
        resolve(c);
      } else if (m.k === 'msg') c?._recv(JSON.parse(m.d), m.d.length);
      else if (m.k === 'bye') c?._fire();
    };
    ch.postMessage({ k: 'hello', from: me, to: 'host' });
  }), 3000, 'Oda bulunamadı').catch((e) => { ch.close(); throw e; });
}

// ---------------- Dışa açık API ----------------
// Oda kurar: { code, close() } döner; her yeni misafir için onConn(conn) çağrılır
export function openRoom(onConn, { local = isLocalNet() } = {}) {
  return local ? hostLocal(onConn) : hostPeer(onConn);
}

// Odaya bağlanır: conn döner
export function joinRoom(code, { local = isLocalNet() } = {}) {
  return local ? joinLocal(code) : joinPeer(code);
}
