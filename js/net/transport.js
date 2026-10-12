// Ağ taşıyıcıları: PeerJS (WebRTC, internet üzerinden, sunucusuz) ve yerel BroadcastChannel
// (aynı tarayıcıdaki iki sekme; testler için ?net=local). İkisi de aynı bağlantı arayüzünü verir:
//   conn = { id, open, reason, send(obj), sendFast(obj), close(reason), onData(fn), onClose(fn), info() }
// Mesajlar JSON nesneleridir. PeerJS yalnızca çok oyunculu mod açılınca (tembel) yüklenir;
// böylece tek oyunculu oyun internetsiz de eskisi gibi çalışır.
//
// Sağlamlık:
// - PeerJS 'json' serileştirmesi 16300 bayttan büyük mesajı REDDEDER ('message-too-big'): büyük mesajlar (ilk dünya
//   görüntüsü, panel HTML'i) burada ~4000 karakterlik parçalara bölünür, karşıda sırayla birleştirilir.
// - Güvenilir kanalda bufferedAmount akış kontrolü (yüksek su seviyesinde kuyruk, 'bufferedamountlow' ile devam);
//   hızlı (güvenilmez) kanalda tampon doluysa konum paketi atılır (yenisi zaten gelir).
// - ICE 'disconnected' hemen kopma sayılmaz (10 sn bekler); 'failed' → temiz yeniden bağlanma (PeerJS ICE restart
//   desteklemiyor). Sinyal sunucusu kopması veri kanallarını etkilemez: geri çekilerek peer.reconnect().
// - Birden fazla STUN (Google, Cloudflare) + yerleşik TURN (NET_CONFIG.turnEndpoint'ten kısa ömürlü kimlik)
//   + kullanıcı TURN'ü (ayar / davet linki) + PeerJS'in genel TURN'ü (son çare).
import { netLog, selectedPair } from './diag.js';
import { NET_CONFIG } from './netConfig.js';

export const PEERJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js';
const ID_PREFIX = 'hasat-hayatta-kal-v1-';     // genel PeerJS sunucusunda başka uygulamalarla çakışmasın
const LETTERS = 'ABCDEFGHJKLMNPRSTUVYZ';       // karışabilecek harfler (I/O/Q/W/X) yok
const TURN_KEY = 'zombi-ciftlik-turn';

const qs = () => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } };

export function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return `ZC-${s}`;
}

// Kullanıcının yazdığını (zc-abcde, ZCABCDE, abcde, " zc - abcde ") 'ZC-ABCDE' biçimine getirir; geçersizse null
export function normalizeCode(raw) {
  let s = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length === 7 && s.startsWith('ZC')) s = s.slice(2);
  return s.length === 5 ? `ZC-${s}` : null;
}

const peerIdOf = (code) => ID_PREFIX + code.slice(3).toLowerCase();

// ?net=local → BroadcastChannel taşıyıcısı
export function isLocalNet() { return qs().get('net') === 'local'; }

// ---------------- ICE (STUN/TURN) ayarları ----------------
const STUN = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' }
];
// PeerJS kütüphanesinin kendi varsayılanındaki genel TURN (kütüphaneyle birlikte dağıtılan, herkese açık kimlik).
// Garanti edilmez: yoğun / erişilemez olabilir. Güvenilir aktarma için kullanıcı kendi TURN'ünü girer.
const PEERJS_TURN = { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' };

// Kullanıcı girdisinden TURN ayarı: adres alanı bir ana makine adı (standard.relay.metered.ca), virgüllü
// turn:/turns: URL listesi ya da sağlayıcının verdiği iceServers JSON dizisi olabilir.
export function parseTurn(addr, username, credential) {
  const a = String(addr || '').trim();
  if (!a) return null;
  if (a.startsWith('[') || a.startsWith('{')) {
    let arr = JSON.parse(a);
    if (!Array.isArray(arr)) arr = arr.iceServers || [arr];
    const servers = arr.filter((s) => s && s.urls).map((s) => ({ urls: s.urls, username: s.username, credential: s.credential }))
      .filter((s) => [].concat(s.urls).some((u) => /^turns?:/i.test(u)));
    if (!servers.length) throw new Error('JSON içinde turn: adresi yok');
    return { servers };
  }
  let urls = a.split(/[\s,]+/).filter(Boolean);
  if (urls.length === 1 && !/^(turns?|stun):/i.test(urls[0])) {
    const h = urls[0].replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
    urls = h.includes(':')
      ? [`turn:${h}`, `turn:${h}?transport=tcp`]
      : [`turn:${h}:80`, `turn:${h}:80?transport=tcp`, `turn:${h}:443`, `turns:${h}:443?transport=tcp`];
  }
  if (!urls.every((u) => /^turns?:/i.test(u))) throw new Error('Adres turn: ya da turns: ile başlamalı');
  if (!username || !credential) throw new Error('Kullanıcı adı ve şifre gerekli');
  return { servers: [{ urls, username: String(username), credential: String(credential) }] };
}

export function getTurn() {
  try { const v = JSON.parse(localStorage.getItem(TURN_KEY) || 'null'); return v?.servers?.length ? v : null; } catch { return null; }
}
export function setTurn(cfg) {
  try { if (cfg) localStorage.setItem(TURN_KEY, JSON.stringify(cfg)); else localStorage.removeItem(TURN_KEY); } catch { /* yok say */ }
}
// Davet linki için kısa kodlama (base64url)
export function encodeTurn(cfg) {
  if (!cfg) return '';
  const s = JSON.stringify(cfg.servers.map((x) => [x.urls, x.username || '', x.credential || '']));
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeTurn(str) {
  try {
    const b = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const arr = JSON.parse(decodeURIComponent(escape(atob(b))));
    const servers = arr.map(([urls, username, credential]) => ({ urls, username, credential }))
      .filter((s) => [].concat(s.urls).every((u) => /^turns?:/i.test(u)));
    return servers.length ? { servers } : null;
  } catch { return null; }
}
export function turnLabel(cfg = getTurn()) {
  if (!cfg) return '';
  const u = [].concat(cfg.servers[0].urls)[0] || '';
  return u.replace(/^turns?:/i, '').replace(/\?.*$/, '');
}

// URL: ?turn=<davet kodlaması> ya da ?turnUrl=…&turnUser=…&turnPass=… → kalıcı ayara yazılır
(function turnFromUrl() {
  const q = qs();
  try {
    let cfg = null;
    if (q.get('turn')) cfg = decodeTurn(q.get('turn'));
    else if (q.get('turnUrl')) cfg = parseTurn(q.get('turnUrl'), q.get('turnUser'), q.get('turnPass'));
    if (cfg) setTurn(cfg);
  } catch (e) { console.warn('TURN parametresi geçersiz', e); }
})();

// ---------------- Yerleşik TURN (uç noktadan kısa ömürlü kimlik) ----------------
// Kabul edilen yanıtlar: iceServers dizisi (Metered), { iceServers: [...] } ya da { iceServers: {…} } (Cloudflare),
// isteğe bağlı { ttl } saniye. Yalnızca turn:/turns: adresleri alınır; tarayıcıların zaman aşımına uğradığı :53 atılır.
export function parseIceResponse(body) {
  const list = Array.isArray(body) ? body : [].concat(body?.iceServers || []);
  const servers = list
    .map((x) => ({ ...x, urls: [].concat(x?.urls || []).filter((u) => /^turns?:/i.test(u) && !/:53(\?|$)/.test(u)) }))
    .filter((x) => x.urls.length && x.username && x.credential)
    .map((x) => ({ urls: x.urls, username: String(x.username), credential: String(x.credential) }));
  if (!servers.length) return null;
  const ttl = Number(body?.ttl) > 0 ? Number(body.ttl) : 6 * 3600;
  return { servers, exp: Date.now() + ttl * 1000 };
}

const turnEndpoint = () => qs().get('turnApi') || NET_CONFIG.turnEndpoint || '';
let managed = null, managedReq = null;
const managedFresh = () => managed && managed.exp - Date.now() > 15 * 60 * 1000;

// Uç noktadan TURN kimliği al (önbellekli). Asla hata fırlatmaz: alınamazsa yerleşik TURN'süz devam edilir.
export function ensureManagedTurn() {
  const url = turnEndpoint();
  if (!url || managedFresh()) return Promise.resolve(managed);
  if (managedReq) return managedReq;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), 5000);
  managedReq = fetch(url, { signal: ctl?.signal, cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((body) => {
      const cfg = parseIceResponse(body);
      if (!cfg) throw new Error('yanıtta turn: sunucusu yok');
      managed = cfg;
      netLog('ağ', 'turn-ok', turnLabel(cfg));
      return managed;
    })
    .catch((e) => { netLog('ağ', 'turn-fail', e?.message || String(e)); return managed; })
    .finally(() => { clearTimeout(timer); managedReq = null; });
  return managedReq;
}
export const turnStatus = () => (!turnEndpoint() ? 'ayarlanmamış (netConfig.js)' : managed ? `${turnLabel(managed)}${managedFresh() ? '' : ' (yenileniyor)'}` : 'alınamadı');

export function iceConfig() {
  const user = getTurn();
  const iceServers = [...STUN, ...(managed ? managed.servers : []), ...(user ? user.servers : []), PEERJS_TURN];
  const cfg = { iceServers, sdpSemantics: 'unified-plan' };
  if (qs().get('relay') === '1') cfg.iceTransportPolicy = 'relay'; // teşhis: yalnızca TURN üzerinden
  return cfg;
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
// ?maxMsg=16300 → tek iletimin en büyük boyutu (bayt); aşan iletim düşer (PeerJS/SCTP sınırı benzetimi).
// ?chunk=N → parça boyutu (karakter; test için küçültülebilir).
// ?relDrop=N → güvenilir kanalda anlık görüntü (t:'s') mesajlarının yüzde N'i HİÇ teslim edilmez: alıcıda uygulanamayan /
// yarı açık bağlantıda kaybolan fark benzetimi (kendini onaran özetin testi). Bağlantı başına conn.dropSnap ile de ayarlanır.
function simConfig() {
  const q = qs();
  const lag = Math.max(0, +q.get('lag') || 0), jitter = Math.max(0, +q.get('jitter') || 0);
  const loss = Math.min(0.9, Math.max(0, (+q.get('loss') || 0) / 100));
  return lag || jitter || loss ? { lag, jitter, loss } : null;
}
export const NET_SIM = simConfig();
const MAX_MSG_SIM = Math.max(0, +qs().get('maxMsg') || 0);
const SNAP_DROP_SIM = Math.min(1, Math.max(0, (+qs().get('relDrop') || 0) / 100));
const CHUNK = Math.max(200, Math.min(4000, +qs().get('chunk') || 4000)); // 4000 krk × ≤3 bayt + zarf < 16300
const PEER_MAX_BYTES = 16000;            // PeerJS json sınırı (16300) altında güvenli pay
const BUF_HIGH = 512 * 1024;             // güvenilir kanal: bu tampon seviyesinin üstünde kuyrukta bekle
const BUF_LOW = 128 * 1024;
const FAST_BUF_MAX = 64 * 1024;          // hızlı kanal: tampon bunu aşarsa konum paketini at
const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const byteLen = (s) => (enc ? enc.encode(s).length : s.length * 3);
let chunkSeq = 0;

// Ortak bağlantı nesnesi. send = güvenilir + sıralı (olaylar, yapı/tarla/envanter değişiklikleri);
// sendFast = güvenilmez, en son kazanır (konum akışı; alıcı sıra numarasıyla eskiyi atar).
// io: { send(obj), fast?(obj) | null, buf?() → bayt, fastBuf?() → bayt, waitLow?(cb), close() }
function makeConn(id, io) {
  const sim = NET_SIM;
  let relAt = 0; // sim: güvenilir kanalda bir sonraki en erken teslim zamanı (sıra korunur)
  const relQ = [];
  const outQ = []; // akış kontrolü kuyruğu (güvenilir)
  let waiting = false;
  const parts = new Map(); // gelen parçalar: id → { n, got, d[] }
  const pump = () => {
    if (!relQ.length) return;
    const wait = relQ[0][0] - performance.now();
    if (wait > 0) { setTimeout(pump, wait); return; }
    while (relQ.length && relQ[0][0] <= performance.now() + 0.5) relQ.shift()[1]();
    if (relQ.length) pump();
  };
  const tooBig = (obj) => {
    if (!MAX_MSG_SIM) return false;
    const n = byteLen(JSON.stringify(obj));
    if (n <= MAX_MSG_SIM) return false;
    c.stats.tooBig++;
    netLog(c.role, 'msg-too-big', `${n} bayt > ${MAX_MSG_SIM} (benzetim)`);
    return true;
  };
  const rawRel = (obj) => {
    try { if (!tooBig(obj)) io.send(obj); } catch (e) { console.warn('Ağ gönderimi başarısız', e); }
  };
  const flushQ = () => {
    waiting = false;
    while (outQ.length && c.open) {
      const b = io.buf ? io.buf() : 0;
      if (b > c.stats.peakBuf) c.stats.peakBuf = b;
      if (b > BUF_HIGH) { waitLow(); return; }
      rawRel(outQ.shift());
    }
  };
  const waitLow = () => {
    if (waiting) return;
    waiting = true;
    c.stats.stalls++;
    let done = false;
    const go = () => { if (done) return; done = true; flushQ(); };
    try { io.waitLow?.(go); } catch { /* yok say */ }
    setTimeout(go, 60);
  };
  const transmit = (obj, fast) => {
    if (!c.open) return;
    if (fast && io.fast) {
      const b = io.fastBuf ? io.fastBuf() : 0;
      if (b > FAST_BUF_MAX) { c.stats.fastDropped++; return; }
      try { if (!tooBig(obj)) io.fast(obj); } catch (e) { console.warn('Hızlı kanal gönderimi başarısız', e); }
      return;
    }
    const b = io.buf ? io.buf() : 0;
    if (b > c.stats.peakBuf) c.stats.peakBuf = b;
    if (outQ.length || b > BUF_HIGH) { outQ.push(obj); waitLow(); return; }
    rawRel(obj);
  };
  const c = {
    id, open: true, reason: null, role: '-', _data: null, _close: null, _fired: false, fastFn: null,
    dropSnap: SNAP_DROP_SIM,
    stats: { simDropped: 0, out: 0, in: 0, outMsgs: 0, inMsgs: 0, fastOut: 0, dropped: 0, fastDropped: 0, chunked: 0, chunks: 0, maxMsg: 0, peakBuf: 0, stalls: 0, tooBig: 0, t0: performance.now() },
    send(m) { c._out(m, false); },
    sendFast(m) { c._out(m, true); },
    get fastOpen() { return !!(c.fastFn || io.fast); },
    _out(m, fast) {
      if (!c.open) return;
      if (c.dropSnap && !fast && m?.t === 's' && Math.random() < c.dropSnap) { c.stats.simDropped++; return; } // benzetim
      let s;
      try { s = JSON.stringify(m); } catch (e) { console.warn('Ağ mesajı serileştirilemedi', e); return; }
      const n = s.length;
      c.stats.out += n; c.stats.outMsgs++;
      if (n > c.stats.maxMsg) c.stats.maxMsg = n;
      // Büyük mesaj: parçala (güvenilir kanaldan; hızlı kanaldaki büyük paket de güvenilire düşer)
      let pieces;
      if (n > CHUNK || (io.maxBytes && n * 3 > io.maxBytes && byteLen(s) > io.maxBytes)) {
        fast = false;
        const cid = ++chunkSeq, total = Math.ceil(n / CHUNK);
        pieces = [];
        for (let i = 0; i < total; i++) pieces.push({ _ck: [cid, i, total], d: s.slice(i * CHUNK, (i + 1) * CHUNK) });
        c.stats.chunked++; c.stats.chunks += total;
      } else pieces = [m];
      if (fast) c.stats.fastOut += n;
      fast = fast && !!io.fast;
      for (const obj of pieces) {
        const go = () => transmit(obj, fast);
        if (!sim) { go(); continue; }
        const now = performance.now();
        let at = now + sim.lag + Math.random() * sim.jitter;
        if (fast) {
          if (Math.random() < sim.loss) { c.stats.dropped++; continue; }
          setTimeout(go, at - now);
          continue;
        }
        // Güvenilir: tek kuyruktan sırayla teslim (ayrı setTimeout'lar ms yuvarlamasıyla sırayı bozabiliyordu)
        if (Math.random() < sim.loss) at += Math.max(200, sim.lag * 3);
        at = relAt = Math.max(at, relAt);
        relQ.push([at, go]);
        if (relQ.length === 1) pump();
      }
    },
    // reason: diag.js REASONS kodu. Karşı tarafa kapanış iletilir (taşıyıcı düzeyinde)
    close(reason = 'manual') { if (!c.open) return; c.reason = c.reason || reason; c.open = false; try { io.close(); } catch { /* yok say */ } c._fire(reason); },
    onData(fn) { c._data = fn; },
    onClose(fn) { c._close = fn; },
    // Bağlantı bilgisi (teşhis paneli): { ice, pair, buf, maxMsgSize }
    async info() {
      const pc = io.pc?.();
      const out = { kind: io.kind || '?', ice: pc ? pc.iceConnectionState : (c.open ? 'yerel' : 'kapalı'), buf: io.buf ? io.buf() : 0 };
      if (pc) {
        out.pair = await selectedPair(pc);
        out.maxMsgSize = pc.sctp?.maxMessageSize ?? null;
      }
      return out;
    },
    _recv(m, bytes) {
      if (!c.open) return;
      c.stats.inMsgs++; if (bytes) c.stats.in += bytes;
      c.lastIn = performance.now();
      if (m && m._ck) {
        const [cid, i, total] = m._ck;
        let p = parts.get(cid);
        if (!p) { p = { n: total, got: 0, d: new Array(total) }; parts.set(cid, p); if (parts.size > 8) parts.delete(parts.keys().next().value); }
        if (p.d[i] == null) { p.d[i] = m.d; p.got++; }
        try { c.onProgress?.(p.got, p.n); } catch { /* yok say */ }
        if (p.got < p.n) return;
        parts.delete(cid);
        try { m = JSON.parse(p.d.join('')); } catch (e) { netLog(c.role, 'handler-error', 'parça birleştirme: ' + e.message); return; }
      }
      try { c._data?.(m); } catch (e) {
        console.warn('Ağ mesajı işlenemedi', m?.t, e);
        const now = performance.now();
        if (!c._errAt || now - c._errAt > 5000) { c._errAt = now; netLog(c.role, 'handler-error', `${m?.t}: ${e?.message || e}`); }
      }
    },
    _fire(reason) {
      if (!c.reason && reason) c.reason = reason;
      c.open = false;
      if (c._fired) return;
      c._fired = true;
      try { c.onClose2?.(); } catch { /* yok say */ }
      try { io.cleanup?.(); } catch { /* yok say */ }
      c._close?.(c.reason);
    }
  };
  return c;
}

function withTimeout(p, ms, msg, code) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => { const e = new Error(msg); e.code = code; rej(e); }, ms))]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- PeerJS ----------------
const parseIn = (d) => (typeof d === 'string' ? JSON.parse(d) : d);

function wrapPeerConn(dc, { cleanup, role } = {}) {
  let fdc = null;
  const rawBuf = (x) => x?.dataChannel?.bufferedAmount ?? 0;
  const io = {
    kind: 'webrtc',
    maxBytes: PEER_MAX_BYTES,
    send: (m) => dc.send(m),
    fast: null,
    buf: () => rawBuf(dc),
    fastBuf: () => rawBuf(fdc),
    waitLow: (cb) => {
      const ch = dc.dataChannel;
      if (!ch) return;
      ch.bufferedAmountLowThreshold = BUF_LOW;
      ch.addEventListener('bufferedamountlow', cb, { once: true });
    },
    pc: () => dc.peerConnection,
    close: () => { try { dc.close(); } catch { /* yok say */ } },
    cleanup: () => { try { fdc?.close(); } catch { /* yok say */ } clearTimeout(discT); cleanup?.(); }
  };
  const c = makeConn(dc.peer, io);
  c.role = role || '-';
  c.attachFast = (f) => {
    fdc = f;
    io.fast = (m) => f.send(m);
    c.fastFn = io.fast;
    f.on('data', (d) => c._recv(parseIn(d), typeof d === 'string' ? d.length : 0));
    const off = () => { io.fast = null; c.fastFn = null; };
    f.on('close', off);
    f.on('error', (e) => { if (e?.type !== 'message-too-big' && e?.type !== 'not-open-yet') off(); });
  };
  dc.on('data', (d) => c._recv(parseIn(d), typeof d === 'string' ? d.length : 0));
  dc.on('close', () => c._fire('dc-closed'));
  dc.on('error', (e) => {
    const ty = e?.type || '';
    if (ty === 'negotiation-failed') c._fire('ice-failed');
    else if (ty === 'connection-closed') c._fire('dc-closed');
    else netLog(c.role, ty === 'message-too-big' ? 'msg-too-big' : 'dc-error', `${ty} ${e?.message || ''}`);
  });
  // ICE durumu: 'disconnected' geçici olabilir (10 sn tolerans), 'failed' → kopmuş say (PeerJS de kapatır)
  let discT = null;
  const pc = dc.peerConnection;
  pc?.addEventListener?.('iceconnectionstatechange', () => {
    const st = pc.iceConnectionState;
    c.iceState = st;
    if (st === 'disconnected') {
      netLog(c.role, 'ice-disconnected', 'geçici olabilir, 10 sn bekleniyor');
      clearTimeout(discT);
      discT = setTimeout(() => { if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') c.close('ice-disconnected'); }, 10000);
    } else if (st === 'connected' || st === 'completed') {
      if (discT) { clearTimeout(discT); discT = null; netLog(c.role, 'ice-recovered', st); }
    } else if (st === 'failed') c._fire('ice-failed');
    else if (st === 'closed') c._fire('dc-closed');
  });
  return c;
}

// Sinyal sunucusu bağlantısını canlı tut: koparsa geri çekilerek peer.reconnect() (oda id'si korunur)
function keepSignal(peer, role, onState) {
  let tries = 0, timer = null;
  const state = { ok: true, tries: 0 };
  const set = (ok) => { state.ok = ok; state.tries = tries; onState?.(state); };
  peer.on('disconnected', () => {
    if (peer.destroyed) return;
    set(false);
    netLog(role, 'signal-lost', `deneme ${tries + 1}`);
    clearTimeout(timer);
    const delay = Math.min(10000, 1000 * Math.pow(2, Math.min(tries, 4)));
    tries++;
    timer = setTimeout(() => {
      if (peer.destroyed || !peer.disconnected) return;
      try { peer.reconnect(); } catch (e) { console.warn('PeerJS yeniden bağlanma', e); }
    }, delay);
  });
  peer.on('open', () => { if (tries) netLog(role, 'signal-ok', `${tries} denemede`); tries = 0; set(true); });
  peer.on('error', (e) => {
    const ty = e?.type || String(e);
    // network / server-error / socket-error / socket-closed: PeerJS 'disconnected' de yayar → yukarıdaki döngü
    // unavailable-id (yeniden bağlanırken eski kayıt hâlâ duruyor): yine 'disconnected' → bekleyip tekrar
    // peer-unavailable: bağlanılmak istenen eş yok (misafirde katılma sırasında ele alınır)
    if (ty !== 'peer-unavailable') netLog(role, 'signal-error', ty);
  });
  peer.on('close', () => clearTimeout(timer));
  return state;
}

// PeerJS + yerleşik TURN kimliği birlikte hazırlanır (TURN alınamasa da bağlanmaya devam edilir)
async function prepare() {
  const [Peer] = await Promise.all([loadPeerJS(), ensureManagedTurn()]);
  return Peer;
}

function openPeer(Peer, id) {
  const opts = { debug: 0, config: iceConfig(), ...(NET_CONFIG.peerServer || {}) };
  const peer = id ? new Peer(id, opts) : new Peer(opts);
  return withTimeout(new Promise((resolve, reject) => {
    peer.once('open', () => resolve(peer));
    peer.once('error', reject);
  }), 15000, 'Sinyal sunucusuna bağlanılamadı', 'signal-error').catch((e) => { try { peer.destroy(); } catch { /* yok say */ } throw e; });
}

async function hostPeer(onConn, { preferCode, onStatus } = {}) {
  const Peer = await prepare();
  let peer = null, code = null, lastErr = null;
  // Önce önceki oda kodunu geri almayı dene (sayfa yenilendiyse misafirler aynı koda döner).
  // Eski oturum sinyal sunucusunda hâlâ kayıtlıysa 'unavailable-id' gelir: kısa bekleyip tekrar.
  if (preferCode) {
    for (let i = 0; i < 8 && !peer; i++) {
      try { peer = await openPeer(Peer, peerIdOf(preferCode)); code = preferCode; } catch (e) {
        lastErr = e;
        if (e?.type !== 'unavailable-id') break;
        onStatus?.(`Önceki oda kodu (${preferCode}) geri alınıyor… (${i + 1})`);
        netLog('host', 'unavailable-id', `${preferCode} deneme ${i + 1}`);
        await sleep(2500);
      }
    }
  }
  for (let attempt = 0; attempt < 4 && !peer; attempt++) {
    const c = makeCode();
    try { peer = await openPeer(Peer, peerIdOf(c)); code = c; } catch (e) {
      lastErr = e;
      if (e?.type === 'unavailable-id') continue; // kod kullanımda → yenisini dene
      throw e;
    }
  }
  if (!peer) throw lastErr || new Error('Oda kodu alınamadı');
  let handler = onConn;
  const byPeer = new Map(), pendingFast = new Map();
  peer.on('connection', (dc) => {
    if (dc.metadata?.lane === 'fast') {
      dc.on('open', () => { const c = byPeer.get(dc.peer); if (c?.open) c.attachFast(dc); else pendingFast.set(dc.peer, dc); });
      return;
    }
    dc.on('open', () => {
      const c = wrapPeerConn(dc, { role: 'host', cleanup: () => { if (byPeer.get(dc.peer) === c) byPeer.delete(dc.peer); } });
      byPeer.set(dc.peer, c);
      const f = pendingFast.get(dc.peer);
      if (f) { pendingFast.delete(dc.peer); c.attachFast(f); }
      try { handler(c); } catch (e) { console.warn('Bağlantı işlenemedi', e); }
    });
  });
  const handle = { code, signal: { ok: true, tries: 0 } };
  handle.signal = keepSignal(peer, 'host', () => handle.onSignal?.(handle.signal));
  handle.signalOk = () => !!(peer.open && !peer.disconnected && !peer.destroyed);
  // rebind: oyun yeniden başlayınca aynı oda (aynı kod) yeni oturuma devredilir
  handle.rebind = (fn) => { handler = fn; };
  // Host saatlerce açık kalabilir: TURN kimliği eskimeden yenilenir; PeerJS yeni bağlantılarda options.config'i okur
  const refresh = setInterval(() => {
    if (!turnEndpoint() || managedFresh()) return;
    ensureManagedTurn().then(() => { if (!peer.destroyed) peer.options.config = iceConfig(); });
  }, 5 * 60 * 1000);
  handle.close = () => { clearInterval(refresh); try { peer.destroy(); } catch { /* yok say */ } };
  return handle;
}

async function joinPeer(code, { onStatus } = {}) {
  const Peer = await prepare();
  const peer = await openPeer(Peer, null);
  keepSignal(peer, 'misafir');
  const destroy = () => setTimeout(() => { try { peer.destroy(); } catch { /* yok say */ } }, 200);
  // peer-unavailable: host henüz kaydolmamış / sinyali anlık kopmuş olabilir → birkaç kez kısa aralıkla dene
  let dc = null;
  for (let i = 0; i < 4; i++) {
    dc = peer.connect(peerIdOf(code), { reliable: true, serialization: 'json' });
    try {
      await withTimeout(new Promise((resolve, reject) => {
        dc.once('open', resolve);
        dc.once('error', (e) => { const err = new Error(e?.type === 'negotiation-failed' ? 'Ağ bağlantısı kurulamadı (NAT engelliyor olabilir; farklı ağlardaysanız TURN ekleyin)' : (e?.message || 'Veri kanalı hatası')); err.code = e?.type === 'negotiation-failed' ? 'ice-failed' : 'join-failed'; reject(err); });
        const onErr = (e) => {
          if (e?.type !== 'peer-unavailable') return;
          peer.off('error', onErr);
          const err = new Error('Oda bulunamadı (host çevrimdışı ya da kod yanlış)'); err.code = 'room-not-found'; reject(err);
        };
        peer.on('error', onErr);
      }), 20000, 'Odaya bağlanılamadı (ağ engelliyor olabilir; farklı ağlardaysanız TURN ekleyin)', 'join-failed');
      break;
    } catch (e) {
      try { dc.close(); } catch { /* yok say */ }
      if (e.code === 'room-not-found' && i < 3) { onStatus?.(`Oda aranıyor… (${i + 2}/4)`); await sleep(1500); continue; }
      netLog('misafir', e.code || 'join-failed', e.message);
      try { peer.destroy(); } catch { /* yok say */ }
      throw e;
    }
  }
  const c = wrapPeerConn(dc, { role: 'misafir', cleanup: destroy });
  // Hızlı kanal (açılamazsa konumlar güvenilir kanaldan gider)
  try {
    const fdc = peer.connect(peerIdOf(code), { reliable: false, serialization: 'json', metadata: { lane: 'fast' } });
    fdc.on('open', () => { if (c.open) c.attachFast(fdc); });
  } catch (e) { console.warn('Hızlı kanal açılamadı', e); }
  return c;
}

// ---------------- Yerel (BroadcastChannel) ----------------
function hostLocal(onConn, { preferCode } = {}) {
  const code = preferCode || makeCode();
  const ch = new BroadcastChannel(`zc-net-${code}`);
  const conns = new Map();
  let handler = onConn;
  ch.onmessage = (ev) => {
    const m = ev.data;
    if (!m || m.to && m.to !== 'host') return;
    if (m.k === 'hello') {
      if (conns.has(m.from)) return;
      const c = makeConn(m.from, {
        kind: 'yerel',
        send: (d) => ch.postMessage({ k: 'msg', from: 'host', to: m.from, d: JSON.stringify(d) }),
        close: () => ch.postMessage({ k: 'bye', from: 'host', to: m.from })
      });
      c.role = 'host';
      conns.set(m.from, c);
      c.onClose2 = () => conns.delete(m.from);
      ch.postMessage({ k: 'ack', from: 'host', to: m.from });
      try { handler(c); } catch (e) { console.warn('Bağlantı işlenemedi', e); }
    } else if (m.k === 'msg') conns.get(m.from)?._recv(JSON.parse(m.d), m.d.length);
    else if (m.k === 'bye') conns.get(m.from)?._fire('dc-closed');
  };
  const bye = () => conns.forEach((c) => c.close('dc-closed'));
  // Sayfa kapanırken önce host'un son mesajları (beforeHide: kayıt + "host ayrılıyor") gitsin, sonra kanallar kapansın
  const onHide = () => { try { api.beforeHide?.(); } catch (e) { console.warn(e); } bye(); };
  window.addEventListener('pagehide', onHide);
  const api = {
    code, signal: { ok: true, tries: 0 }, signalOk: () => true, beforeHide: null,
    rebind: (fn) => { handler = fn; },
    close: () => { bye(); window.removeEventListener('pagehide', onHide); ch.close(); }
  };
  return Promise.resolve(api);
}

function joinLocal(code) {
  const ch = new BroadcastChannel(`zc-net-${code}`);
  const me = 'g' + Math.random().toString(36).slice(2, 10);
  let c = null;
  const onHide = () => c?.close('dc-closed');
  return withTimeout(new Promise((resolve) => {
    ch.onmessage = (ev) => {
      const m = ev.data;
      if (!m || m.to !== me) return;
      if (m.k === 'ack' && !c) {
        c = makeConn('host', {
          kind: 'yerel',
          send: (d) => ch.postMessage({ k: 'msg', from: me, to: 'host', d: JSON.stringify(d) }),
          close: () => ch.postMessage({ k: 'bye', from: me, to: 'host' }),
          cleanup: () => { window.removeEventListener('pagehide', onHide); setTimeout(() => { try { ch.close(); } catch { /* yok say */ } }, 50); }
        });
        c.role = 'misafir';
        window.addEventListener('pagehide', onHide);
        resolve(c);
      } else if (m.k === 'msg') c?._recv(JSON.parse(m.d), m.d.length);
      else if (m.k === 'bye') c?._fire('dc-closed');
    };
    ch.postMessage({ k: 'hello', from: me, to: 'host' });
  }), 3000, 'Oda bulunamadı', 'room-not-found').catch((e) => { ch.close(); throw e; });
}

// ---------------- Dışa açık API ----------------
// Oda kurar: { code, close(), rebind(fn), signalOk() } döner; her yeni misafir için onConn(conn) çağrılır.
// opts.preferCode: önce bu kodu geri almayı dene (host sayfası yenilendiyse)
export function openRoom(onConn, { local = isLocalNet(), preferCode = null, onStatus = null } = {}) {
  return local ? hostLocal(onConn, { preferCode }) : hostPeer(onConn, { preferCode, onStatus });
}

// Odaya bağlanır: conn döner
export function joinRoom(code, { local = isLocalNet(), onStatus = null } = {}) {
  return local ? joinLocal(code) : joinPeer(code, { onStatus });
}
