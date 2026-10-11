// Co-op bağlantı teşhisi: kopma nedenleri (Türkçe), son 20 olaylık kalıcı günlük (localStorage), arka planda
// kısılmayan Worker zamanlayıcısı ve WebRTC seçilen aday çifti (host/srflx/relay) ölçümü.
// Günlük oda panelindeki "Bağlantı" bölümünden kopyalanabilir (kullanıcı geliştiriciye yapıştırır).

const LOG_KEY = 'zombi-ciftlik-net-log';
const LOG_MAX = 20;

// Kopma / olay nedeni kodları → kullanıcıya gösterilen Türkçe açıklama
export const REASONS = {
  'ping-timeout': 'Ping zaman aşımı: karşı taraftan uzun süre veri gelmedi (internet kesildi ya da sayfa dondu)',
  'peer-hidden': 'Arkadaşın sekmeyi arka plana aldı / telefonu kilitlendi, uzun süre yanıt vermedi',
  'self-hidden': 'Sekmen arka planda kaldı (telefon kilitlendi ya da uygulama değişti); bağlantı yenileniyor',
  'ice-failed': 'Ağ bağlantısı (ICE) başarısız: NAT/güvenlik duvarı doğrudan bağlantıyı engelliyor olabilir (TURN gerekebilir)',
  'ice-disconnected': 'Ağ yolu kesildi ve düzelmedi (Wi-Fi/mobil veri değişti ya da sinyal zayıf)',
  'dc-closed': 'Veri kanalı kapandı: karşı taraf sayfayı kapattı/yeniledi ya da ağ koptu',
  'dc-error': 'Veri kanalı hatası',
  'host-closed': 'Host odayı kapattı',
  'host-left': 'Host sekmeyi kapattı ya da yeniledi; aynı oda koduyla dönerse otomatik bağlanırsın',
  'peer-left': 'Karşı taraf oyundan ayrıldı',
  'signal-lost': 'Sinyal sunucusu (PeerJS) bağlantısı koptu; oyun bağlantısı etkilenmez, yeniden bağlanılıyor',
  'signal-error': 'Sinyal sunucusu hatası',
  'room-not-found': 'Oda bulunamadı (host çevrimdışı ya da kod yanlış)',
  'join-failed': 'Odaya bağlanılamadı',
  'msg-too-big': 'Çok büyük mesaj (parçalanmadan gönderilmeye çalışıldı)',
  'handler-error': 'Ağ mesajı işlenirken hata (oyun sürüyor)',
  'replaced': 'Aynı oyuncu yeni bağlantıyla döndü (eski bağlantı kapatıldı)',
  'welcome-stall': 'İlk dünya verisi gelmedi (15 sn ilerleme yok); yeniden deneniyor',
  'manual': 'Bağlantı elle kapatıldı'
};

export const reasonText = (code) => REASONS[code] || String(code || 'bilinmiyor');

let mem = null;
function load() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); if (!Array.isArray(mem)) mem = []; } catch { mem = []; }
  return mem;
}

// Olay kaydı: { at: ISO zaman, r: rol (host/misafir), e: olay kodu, d: ayrıntı }
export function netLog(role, ev, detail) {
  const L = load();
  const rec = { at: new Date().toISOString(), r: role || '-', e: ev };
  if (detail != null && detail !== '') rec.d = String(detail).slice(0, 200);
  L.push(rec);
  while (L.length > LOG_MAX) L.shift();
  try { localStorage.setItem(LOG_KEY, JSON.stringify(L)); } catch { /* gizli mod / kota: yalnızca bellekte */ }
  try { console.info(`[net] ${rec.r} ${ev}${rec.d ? ' · ' + rec.d : ''}`); } catch { /* yok say */ }
  return rec;
}

export function netLogList() { return load().slice(); }

export function clearNetLog() {
  mem = [];
  try { localStorage.removeItem(LOG_KEY); } catch { /* yok say */ }
}

// Kopyalanabilir metin: ortam + anlık durum + günlük
export function netLogText(state) {
  const nc = navigator.connection;
  const env = [
    `Zaman: ${new Date().toISOString()}`,
    `Tarayıcı: ${navigator.userAgent}`,
    `Ağ: ${nc ? `${nc.type || '?'} / ${nc.effectiveType || '?'} / rtt ${nc.rtt ?? '?'} ms` : 'bilinmiyor'} · çevrimiçi: ${navigator.onLine}`,
    `Sayfa: ${location.href.replace(/turnPass=[^&]*/i, 'turnPass=***')}`
  ];
  const st = state ? Object.entries(state).map(([k, v]) => `${k}: ${v}`) : [];
  const log = netLogList().map((x) => `${x.at} [${x.r}] ${x.e}${x.d ? ' — ' + x.d : ''}`);
  return ['== Hasat co-op bağlantı günlüğü ==', ...env, '-- Durum --', ...st, '-- Son olaylar --', ...(log.length ? log : ['(yok)'])].join('\n');
}

// Arka plan sekmesinde de kısılmayan aralıklı zamanlayıcı (Dedicated Worker). Kurulamazsa setInterval.
// Döner: durdurma fonksiyonu
export function workerInterval(fn, ms) {
  const safe = () => { try { fn(); } catch (e) { console.warn('Zamanlayıcı', e); } };
  try {
    const src = 'let t=null;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data);};';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = safe;
    w.postMessage(ms);
    return () => { try { w.postMessage(0); w.terminate(); } catch { /* yok say */ } };
  } catch {
    const id = setInterval(safe, ms);
    return () => clearInterval(id);
  }
}

// RTCPeerConnection.getStats → seçilen aday çifti: { local, remote, proto, rtt } (ör. host/srflx/relay)
export async function selectedPair(pc) {
  if (!pc?.getStats) return null;
  try {
    const st = await pc.getStats();
    let pairId = null;
    const byId = new Map();
    st.forEach((r) => {
      byId.set(r.id, r);
      if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
    });
    let pair = pairId ? byId.get(pairId) : null;
    if (!pair) st.forEach((r) => { if (r.type === 'candidate-pair' && (r.selected || (r.nominated && r.state === 'succeeded'))) pair = pair || r; });
    if (!pair) return null;
    const l = byId.get(pair.localCandidateId), rm = byId.get(pair.remoteCandidateId);
    return {
      local: l?.candidateType || '?', remote: rm?.candidateType || '?',
      proto: l?.protocol || l?.relayProtocol || '?',
      rtt: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null
    };
  } catch { return null; }
}

// Aday türünün kısa Türkçe açıklaması
export function pairText(p) {
  if (!p) return '—';
  const name = { host: 'doğrudan (aynı ağ)', srflx: 'STUN (NAT üzerinden doğrudan)', prflx: 'doğrudan (eş yansımalı)', relay: 'TURN aktarma' };
  const kind = p.local === 'relay' || p.remote === 'relay' ? 'relay' : p.local === 'host' && p.remote === 'host' ? 'host' : (p.local === 'srflx' || p.remote === 'srflx') ? 'srflx' : p.local;
  return `${p.local}/${p.remote} · ${p.proto} · ${name[kind] || kind}`;
}
