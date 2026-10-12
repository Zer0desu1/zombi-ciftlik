// Misafir oturumu: dünya aynı tohumla yerelde kurulur ama simülasyon çalışmaz. Host'tan gelen anlık
// görüntülerle görsel vekiller güncellenir; kendi karakteri yerelde anında hareket eder (konumu host'a
// bildirir), eylemler (kullan, etkileşim, yuvarlanma, paneller) host'a istek olarak gider.
// Konumlar host zaman damgasıyla tamponlanır ve sabit bir oynatma gecikmesiyle enterpole edilir (bkz. mirror.js).
import { DIFFICULTIES, ITEMS } from '../config.js';
import { audio } from '../audio.js';
import { iconURL } from '../textures.js';
import { features } from '../features/index.js';
import { regrowResource, depleteResource } from '../systems/MapBuilder.js';
import { MirrorReader, Interp, NetClock, hashStr, setHash, unpackBits, invSig } from './mirror.js';
import { joinRoom, getTurn, setTurn, iceConfig, turnStatus } from './transport.js';
import { PROTO } from './NetHost.js';
import { RoomPanel, unpackIcons, pathOf } from './NetUI.js';
import { netLog, reasonText, workerInterval, pairText } from './diag.js';

const SILENT_MS = 12000;           // host'tan bu kadar veri gelmezse kopmuş say
const SILENT_HIDDEN_MS = 45000;    // host (ya da biz) arka plandayken
const WELCOME_STALL_MS = 15000;    // ilk dünya verisi bu kadar ilerlemezse yeniden dene
const SID_KEY = 'zombi-ciftlik-net-sid';
function sessionId() {
  try {
    let s = sessionStorage.getItem(SID_KEY);
    if (!s) { s = Math.random().toString(36).slice(2, 12); sessionStorage.setItem(SID_KEY, s); }
    return s;
  } catch { return Math.random().toString(36).slice(2, 12); }
}

// Misafirde de çalışan özellik parçaları (yalnızca görsel/arayüz). Diğer özellikler guestInit/guestUpdate
// (registry sözleşmesi) ile yalnızca görsel kısımlarını misafirde çalıştırır.
const GUEST_BEGIN = new Set(['mobile', 'juice', 'combat']);
const GUEST_UPDATE = new Set(['mobile', 'juice', 'zones']); // zones: kamera sınırları + bölge mini haritası
// Yerel kalan menü girişleri (geri kalanı host'ta misafir adına açılır)
const LOCAL_MENU = new Set(['minimap', 'juice-settings', 'help']);
const MODAL_SEL = { inventory: '#modal-inventory', dialog: '#modal-dialog', shop: '#modal-shop', feature: '#modal-feature' };
const nameStyle = { fontFamily: 'Outfit, sans-serif', fontSize: '7px', color: '#ffffff', stroke: '#000', strokeThickness: 2, resolution: 4 };
const BOW_CHARGE = 0.4;
const HEAR = 230; // px: ortam seslerinin duyulduğu mesafe
const RSYNC_GAP = 2000; // ms: iki yeniden eşitleme isteği arası en az

export class NetGuest {
  static async join(scene, code, name, onStatus) {
    netLog('misafir', 'join', `${code} · TURN: ${getTurn() ? 'kullanıcı' : 'yok'}`);
    const conn = await joinRoom(code, { onStatus });
    const g = new NetGuest(scene, conn, code, name);
    g.onStatus = onStatus;
    g.hello();
    return g;
  }

  constructor(scene, conn, code, name) {
    this.isGuest = true;
    this.scene = scene;
    this.code = code;
    this.name = name;
    this.sid = sessionId();
    this.drops = 0;
    this.reconnects = 0;
    this.peerHidden = false;
    this.started = false;
    this.avatars = new Map();
    this.hint = '';
    this.tp = 0;
    this.quests = [];
    this.sendT = 0;
    this.lastMv = '';
    this.mvIdle = 0;
    this.mvQ = 0;
    this.remaining = 0;
    this.remoteModal = null;
    this.clock = new NetClock(50);
    this.fastQ = 0;
    this.Lbuf = [];          // [ht, ışık listesi] — oynatma zamanına göre seçilir
    this.rt = null;
    this.fs = {};
    this.fsKey = 0;          // son alınan ortak özellik durumunun özeti (host lastFs ile karşılaştırılır)
    this.heals = { res: 0, m: 0, f: 0, s: 0, i: 0, req: 0, digests: 0 }; // kendini onaran eşitleme sayaçları
    this.groanT = 3;
    this.charge = null;
    this.lastSeen = performance.now();
    this.attach(conn);
    // Ping + zaman aşımı Worker zamanlayıcısıyla (arka plan sekmesinde setInterval kısılır)
    this.stopPing = workerInterval(() => this.heartbeat(), 2000);
    this.onVis = () => this.visibility();
    document.addEventListener('visibilitychange', this.onVis);
    scene.events.once('shutdown', () => this.close());
  }

  hello() {
    this.welcomeWait = performance.now();
    this.send({ t: 'hello', name: this.name, v: PROTO, sid: this.sid, gender: this.scene.player?.gender || 'm' });
    if (document.visibilityState === 'hidden') this.send({ t: 'vis', h: 1 });
  }

  attach(conn) {
    this.conn = conn;
    conn.onData((m) => {
      if (this.conn !== conn) return;
      this.lastSeen = performance.now();
      try { this.onMsg(m); } catch (e) {
        console.warn('Host mesajı işlenemedi', m?.t, e);
        const now = performance.now();
        if (!this.errAt || now - this.errAt > 5000) { this.errAt = now; netLog('misafir', 'handler-error', `${m?.t}: ${e?.message || e}`); }
      }
    });
    // İlk dünya verisi parça parça gelir: ilerleme göster, takılırsa yeniden dene
    conn.onProgress = (got, n) => {
      this.welcomeWait = performance.now();
      if (!this.welcomed && n > 1) {
        const pct = Math.round((got / n) * 100);
        if (!this.started) this.onStatus?.(`Dünya yükleniyor… %${pct}`);
        else this.panel?.showReconnect(this.retries, reasonText(this.lastReason), this.tip(), () => this.giveUp(), `Dünya verisi alınıyor… %${pct}`);
      }
    };
    conn.onClose((reason) => { if (this.conn === conn) this.onLost(reason || conn.reason); });
  }

  send(m) { this.conn?.send(m); }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopPing?.();
    document.removeEventListener('visibilitychange', this.onVis);
    clearTimeout(this.retryTimer);
    this.send({ t: 'bye' });
    this.conn?.close('peer-left');
    this.panel?.destroy();
    this.chargeGfx?.destroy();
  }

  heartbeat() {
    if (this.closed || !this.conn?.open) return;
    const now = performance.now();
    // İlk dünya verisi (welcome) bekleniyor ve ilerlemiyor
    if (!this.welcomed && this.welcomeWait && now - this.welcomeWait > WELCOME_STALL_MS) {
      this.conn.close('welcome-stall');
      return;
    }
    const hidden = this.peerHidden || document.visibilityState === 'hidden';
    if (now - this.lastSeen > (hidden ? SILENT_HIDDEN_MS : SILENT_MS)) { this.conn.close(this.peerHidden ? 'peer-hidden' : 'ping-timeout'); return; }
    this.send({ t: 'ping', c: now });
  }

  // Sekme görünürlüğü: host'a bildir (eşiği uzatsın); dönüşte bağlantıyı hızla doğrula / yeniden bağlan
  visibility() {
    if (this.closed) return;
    const hidden = document.visibilityState === 'hidden';
    netLog('misafir', hidden ? 'tab-hidden' : 'tab-visible');
    if (this.conn?.open) this.send({ t: 'vis', h: hidden ? 1 : 0 });
    if (hidden) return;
    const now = performance.now();
    if (this.reconnecting) {
      // Bekleyen geri çekilmeyi atla, hemen dene
      clearTimeout(this.retryTimer);
      if (!this.joining) this.retry();
    } else if (this.conn?.open) {
      // Mobilde sayfa donmuş olabilir: 5 sn içinde host'tan veri gelmezse kopmuş say
      this.lastSeen = Math.max(this.lastSeen, now - SILENT_MS + 5000);
      this.send({ t: 'ping', c: now });
    }
  }

  // ---------------- Bağlantı kopması / yeniden bağlanma ----------------
  onLost(reason) {
    if (this.closed || this.ended) return;
    this.drops++;
    this.lastReason = this.hostLeft ? 'host-left' : (reason || 'dc-closed');
    this.hostLeft = false;
    this.lastLostAt = Date.now();
    this.welcomed = false;
    netLog('misafir', 'lost', `${this.lastReason} · ${reasonText(this.lastReason)}`);
    if (!this.started) {
      // İlk katılma: birkaç kez sessizce tekrar dene, sonra menüye hata
      this.preTries = (this.preTries || 0) + 1;
      if (this.preTries <= 3) {
        this.onStatus?.(`Bağlantı koptu (${reasonText(this.lastReason).split(':')[0]}), tekrar deneniyor… (${this.preTries}/3)`);
        this.reconnecting = true;
        this.retryTimer = setTimeout(() => this.retry(), 1500);
        return;
      }
      this.onFail?.(`Bağlantı yok: ${reasonText(this.lastReason)}`);
      return;
    }
    this.scene.hud.toast(`Host ile bağlantı koptu: ${reasonText(this.lastReason)}`, 'warn');
    this.panel?.setStatus(`Bağlantı koptu: ${reasonText(this.lastReason).split(':')[0]}`, true);
    this.reconnecting = true;
    this.retries = 0;
    this.retry();
  }

  tip() {
    const r = this.joinErr === 'ice-failed' || this.joinErr === 'join-failed' ? this.joinErr : this.lastReason;
    if (r === 'ice-failed' || r === 'ice-disconnected' || r === 'join-failed' || (this.drops >= 2 && this.pair && this.pair.local !== 'relay' && this.pair.remote !== 'relay'))
      return getTurn() ? '' : 'Farklı ağlardan bağlanıyorsanız oda panelindeki 📶 Bağlantı → TURN sunucusu ekleyin.';
    if (r === 'room-not-found' || r === 'host-left') return 'Host\'un sayfası açık mı? Host sayfayı yenilediyse aynı kodla geri gelmesi beklenir.';
    return '';
  }

  // Sınırsız, geri çekilen yeniden bağlanma (1, 2, 3, 5, 8, 10, 10… sn)
  retry() {
    if (this.closed || this.ended) return;
    this.retries = (this.retries || 0) + 1;
    this.reconnects++;
    if (this.started) this.panel?.showReconnect(this.retries, reasonText(this.lastReason), this.tip(), () => this.giveUp());
    this.joining = true;
    joinRoom(this.code, { onStatus: (t) => { if (this.started) this.panel?.showReconnect(this.retries, reasonText(this.lastReason), this.tip(), () => this.giveUp(), t); else this.onStatus?.(t); } }).then((conn) => {
      this.joining = false;
      if (this.closed || this.ended) { conn.close('peer-left'); return; }
      this.attach(conn);
      this.lastSeen = performance.now();
      this.hello();
      if (this.started) this.panel?.showReconnect(this.retries, reasonText(this.lastReason), '', () => this.giveUp(), 'Bağlandı, dünya verisi bekleniyor…');
    }).catch((e) => {
      this.joining = false;
      if (this.closed || this.ended) return;
      this.joinErr = e?.code || 'join-failed';
      if (!this.started) this.lastReason = this.joinErr;
      if (!this.started) {
        this.preTries = (this.preTries || 0) + 1;
        if (this.preTries > 3) { this.onFail?.(e?.message || 'Bağlanılamadı'); return; }
        this.onStatus?.(`${e?.message || 'Bağlanılamadı'} — tekrar deneniyor (${this.preTries}/3)`);
      }
      const delay = [1000, 2000, 3000, 5000, 8000][this.retries - 1] ?? 10000;
      if (this.started) this.panel?.showReconnect(this.retries, reasonText(this.lastReason), this.tip(), () => this.giveUp(), `Son deneme: ${e?.message || reasonText(this.joinErr)} — ${Math.round(delay / 1000)} sn sonra tekrar`);
      this.retryTimer = setTimeout(() => this.retry(), delay);
    });
  }

  // "Vazgeç": yeniden bağlanmayı bırak, ana menüye dön (davet linki korunur)
  giveUp() {
    netLog('misafir', 'give-up', `${this.retries || 0} deneme`);
    this.ended = true;
    this.close();
    try { location.reload(); } catch { /* yok say */ }
  }

  // Teşhis paneli verisi
  async diagInfo() {
    const now = performance.now(), c = this.conn;
    const inf = c ? await c.info().catch(() => ({})) : {};
    if (inf.pair) this.pair = inf.pair;
    const lines = [
      ['Rol', `misafir · oda ${this.code}`],
      ['Durum', c?.open ? (this.welcomed ? 'bağlı ✔' : 'dünya verisi bekleniyor') : (this.reconnecting ? `yeniden bağlanılıyor (${this.retries || 0})` : 'bağlı değil')],
      ['ICE', inf.ice || '—'],
      ['Aday çifti', pairText(inf.pair)],
      ['Ping', this.rtt != null ? `${Math.round(this.rtt)} ms` : '—'],
      ['Son mesaj', `${((now - this.lastSeen) / 1000).toFixed(1)} sn önce`],
      ['Hızlı kanal', c?.fastOpen ? 'açık' : 'yok (konumlar güvenilir kanaldan)'],
      ['Yeniden bağlanma', `${this.reconnects} deneme · ${this.drops} kopma`],
      ['Son kopma', this.lastReason ? `${reasonText(this.lastReason)} (${new Date(this.lastLostAt).toLocaleTimeString()})` : '—'],
      ['Host sekmesi', this.peerHidden ? 'arka planda' : 'açık'],
      ['TURN', getTurn() ? 'kullanıcı TURN ✔' : 'yok (STUN + PeerJS genel TURN)'],
      ['En büyük mesaj', c ? `${c.stats.maxMsg} krk giden · ${c.stats.chunked} parçalı · tampon tepe ${c.stats.peakBuf} B${inf.maxMsgSize ? ` · SCTP maxMsg ${inf.maxMsgSize}` : ''}` : '—'],
      ['Eşitleme onarımı', `${this.heals.digests} özet · ${this.heals.req} istek · ${this.heals.res} kaynak · ${this.heals.m} nesne · ${this.heals.f} tarla · ${this.heals.s} özellik · ${this.heals.i} envanter`],
      ['ICE sunucuları', iceConfig().iceServers.map((x) => [].concat(x.urls)[0].replace(/\?.*$/, '')).join(', ')],
      ['Yerleşik TURN', turnStatus()]
    ];
    let advice = '';
    if (this.drops >= 2 && inf.pair && inf.pair.local !== 'relay' && inf.pair.remote !== 'relay' && !getTurn())
      advice = 'Bağlantı sık kopuyor ve TURN aktarması kullanılmıyor: farklı ağlardaysanız aşağıya bir TURN sunucusu ekleyin (host da aynı bilgileri girsin).';
    return { lines, advice };
  }

  // Oyun bitti / host yeni oyun başlattı: sahneyi yeniden kur ve aynı oda koduyla tekrar katıl
  rejoin() {
    const s = this.scene, code = this.code, name = this.name;
    this.ended = true;
    this.close();
    document.getElementById('gameover')?.classList.remove('show');
    s.scene.restart({ netJoin: { code, name } });
  }

  // ---------------- Mesajlar ----------------
  onMsg(m) {
    const s = this.scene;
    switch (m.t) {
      case 'welcome': this.onWelcome(m); return;
      case 's': if (this.started) this.applySnap(m); return;
      case 'f': if (this.started) this.applyFast(m); return;
      case 'me': if (this.started) this.applyMe(m); return;
      case 'fs': if (this.started) { this.fsKey = hashStr(JSON.stringify(m.s)); this.applyFeatureState(m.s); } return;
      case 'dg': if (this.started) this.onDigest(m); return;
      case 'rso': if (this.started && m.o) { const n = this.mirror.applyFull(m.o, this.rt ?? 0); this.heals.m++; netLog('misafir', 'resync', `nesneler yeniden eşitlendi (${n} fazla vekil silindi)`); } return;
      case 'rsf': if (this.started && Array.isArray(m.fa)) { this.applyFarmFull(m.fa); this.heals.f++; netLog('misafir', 'resync', 'tarla yeniden eşitlendi'); } return;
      case 'ui': this.onUi(m); return;
      case 'toast': s.hud.toast(m.m, m.ty); return;
      case 'notice': s.hud.notice(m.m); return;
      case 'banner': s.hud.banner(m.a, m.b); return;
      case 'sfx': (m.l || []).forEach((n) => audio.sfx(n)); return;
      case 'shake': s.cameras.main.shake(m.d || 100, m.i || 0.004); return;
      case 'slow': this.slowT = Math.min(5, +m.d || 0); this.slowK = +m.k || 0.55; return; // buz yavaşlatması
      case 'hurt': this.onHurt(m); return;
      case 'quests': this.quests = m.l || []; s.hud.renderQuests(); return;
      case 'roster': this.setRoster(m.l); return;
      case 'ping': this.send({ t: 'pong', c: m.c }); return;
      case 'pong': this.rtt = performance.now() - m.c; return;
      case 'full': this.ended = true; this.onFail?.('Oda dolu (en fazla 4 oyuncu)'); this.conn.close('manual'); return;
      case 'over': this.onOver(m.stats); return;
      case 'restart':
        // Host yeni oyun başlattı: oda kodu aynı, otomatik yeniden katıl
        this.ended = true;
        s.hud.toast('Host yeni oyun başlattı, odaya yeniden katılıyorsun…', 'info');
        s.time.delayedCall(400, () => this.rejoin());
        return;
      case 'bye':
        this.ended = true;
        this.lastReason = 'host-closed';
        netLog('misafir', 'lost', 'host-closed · Host odayı kapattı');
        if (this.started) { this.panel?.hideReconnect(); this.panel?.setStatus('Host odayı kapattı.', true); s.hud.toast('Host odayı kapattı.', 'warn'); }
        else this.onFail?.('Host odayı kapattı');
        return;
      case 'hostleave': // host sekmesi kapanıyor/yenileniyor: kopma nedeni bu olsun (yeniden deneme sürer)
        this.hostLeft = true;
        netLog('misafir', 'host-left');
        return;
      case 'vis':
        this.peerHidden = !!m.h;
        if (this.started) {
          s.hud.toast(m.h ? 'Arkadaşın (host) sekmeyi arka plana aldı; oyun akmaya devam eder' : 'Host sekmeye geri döndü', 'info');
          this.panel?.setStatus(m.h ? 'Host sekmesi arka planda' : '');
        }
        if (!m.h) this.lastSeen = performance.now();
        return;
      default:
        s.events.emit('netMsg', m); // özellik modüllerinin mesajları (ör. zones 'zn', balık 'fish')
    }
  }

  onWelcome(w) {
    const s = this.scene;
    this.id = w.id;
    this.color = w.color;
    this.tp = 0;
    this.placed = false;
    this.welcomed = true;
    this.reconnecting = false;
    this.retries = 0;
    this.preTries = 0;
    this.joinErr = null;
    this.fastQ = 0;
    // Host'un TURN ayarı: bizde yoksa sakla (yeniden bağlanmalarda kullanılır)
    if (Array.isArray(w.ice) && w.ice.length && !getTurn()) { setTurn({ servers: w.ice }); netLog('misafir', 'turn-from-host', 'host TURN ayarı alındı'); }
    netLog('misafir', this.started ? 'reconnected' : 'joined', `${this.code}${this.conn?.stats ? ` · ilk veri ${this.conn.stats.in} B` : ''}`);
    if (!this.started) this.start(w);
    else {
      // Yeniden bağlanma: tüm vekilleri sıfırla
      this.mirror.clear();
      for (const a of this.avatars.values()) this.destroyAvatar(a);
      this.avatars.clear();
      this.Lbuf = [];
      this.clock = new NetClock(50);
      this.panel.setStatus('');
      this.panel.hideReconnect();
      // Tam görüntüde olmayan tarlalar (host kayıttan döndüyse) silinsin
      const keep = new Set((w.snap?.fa || []).map((r) => s.farm.key(r[0], r[1])));
      for (const [key, p] of [...s.farm.plots]) if (!keep.has(key)) s.farm.removePlot(p);
      s.hud.toast('Yeniden bağlandın ✔', 'ok');
    }
    s.player.setPosition(w.x, w.y);
    if (w.snap?.fs) this.fsKey = hashStr(JSON.stringify(w.snap.fs));
    this.rsyncAt = 0;
    this.applySnap(w.snap);
    this.quests = w.quests || [];
    s.hud.renderQuests();
    this.setRoster(w.roster);
  }

  // İlk welcome: sahneyi misafir moduna çevir
  start(w) {
    const s = this.scene;
    this.started = true;
    document.getElementById('menu')?.classList.remove('show');
    audio.init();
    s.difficulty = DIFFICULTIES[w.diff] || DIFFICULTIES.normal;

    // Yerelde kurulmuş dinamik nesneleri (NPC'ler, özelliklerin dünya nesneleri) gizle: görüntü host'tan gelir
    const p = s.player;
    const keep = new Set([p, p.shadow, p.hpBg, p.hpFg, s.marker, s.ghost, s.dark]);
    for (const o of s.children.list.slice()) {
      if (s.worldStatic?.has(o) || keep.has(o) || o.netLocal) continue;
      o.setVisible?.(false);
      if (o.body) o.body.enable = false;
    }
    // Vekil grupları (çarpışmalara bağlı eski grupların yerine)
    s.zombies = s.add.group();
    s.barricades = s.add.group();
    s.turrets = s.add.group();
    this.solids = s.physics.add.staticGroup();
    s.physics.add.collider(p, this.solids);
    this.mirror = new MirrorReader(s, { zombies: s.zombies, barricades: s.barricades, turrets: s.turrets, solids: this.solids });
    this.mirror.onEvent = (kind, m) => this.onProxyEvent(kind, m);

    // Paylaşılan durumların yerel görünümleri
    const net = this;
    Object.defineProperty(s.waves, 'remaining', { configurable: true, get: () => net.remaining });
    s.quests.activeList = () => net.quests;
    p.setTint(this.color);
    const dodge = p.dodge.bind(p);
    p.dodge = () => { const ok = dodge(); if (ok) net.send({ t: 'dodge' }); return ok; };

    this.patchHud();
    this.installKeys();
    for (const m of s.featureMenu) if (!LOCAL_MENU.has(m.id)) m.open = () => net.send({ t: 'ui', op: 'menu', id: m.id });
    features.forEach((f) => { if (GUEST_BEGIN.has(f.id)) { try { f.begin?.(s, false); } catch (e) { console.warn(f.id, e); } } });
    features.forEach((f) => { try { f.guestInit?.(s); } catch (e) { console.warn(f.id, e); } });
    s.minimapDots = s.minimapDots || [];
    s.minimapDots.push(() => [...net.avatars.values()].map((a) => ({ x: a.spr.x, y: a.spr.y, color: '#8fd3ff', r: 2 })));
    this.chargeGfx = s.add.graphics().setDepth(10003);
    this.chargeGfx.netLocal = true;
    this.spaceKey = s.input.keyboard?.addKey('SPACE', false);
    s.started = true;
    s.hud.renderHotbar();
    s.hud.renderQuests();
    this.panel = new RoomPanel();
    this.panel.onToast = (m) => s.hud.toast(m, 'ok');
    this.panel.setDiagProvider(() => this.diagInfo());
    this.panel.setCode(this.code, false);
    this.night = null;
    s.hud.toast(`Odaya katıldın: ${this.code}. İyi eğlenceler!`, 'ok');
  }

  patchHud() {
    const s = this.scene, hud = s.hud, net = this;
    hud.toggleInventory = () => { if (hud.modal) hud.closeAll(); else net.send({ t: 'ui', op: 'inv' }); };
    hud.refreshInventory = () => { hud.renderHotbar(); hud.renderQuests(); };
    const closeAll = hud.closeAll.bind(hud);
    hud.closeAll = (silent) => {
      const was = net.remoteModal;
      net.remoteModal = null;
      closeAll(silent);
      if (was && !net.fromHost) net.send({ t: 'ui', op: 'close' });
    };
    // Uzak panel tıklamaları: aynı öğe host'taki kopyada tıklanır; giriş/kaydırıcı değerleri de aktarılır
    for (const [name, sel] of Object.entries(MODAL_SEL)) {
      const root = document.querySelector(sel);
      if (!root) continue;
      root.addEventListener('click', (e) => {
        if (net.remoteModal !== name) return;
        if (e.target.closest?.('[data-close]')) { e.preventDefault(); e.stopPropagation(); hud.closeAll(); audio.sfx('click'); return; }
        // Giriş alanlarına tıklama yereldir (odaklanma); değer 'input/change' ile gider
        if (e.target.closest?.('input, textarea, select')) return;
        e.preventDefault(); e.stopPropagation();
        const p = pathOf(root, e.target);
        if (p) { net.send({ t: 'ui', op: 'click', m: name, p }); audio.sfx('click'); }
      }, true);
      let inT = 0;
      const onInput = (e) => {
        if (net.remoteModal !== name) return;
        const t = e.target;
        if (!t || !('value' in t)) return;
        const p = pathOf(root, t);
        if (!p) return;
        const now = performance.now();
        if (e.type === 'input' && now - inT < 120) return; // kaydırıcı sürüklenirken seyrelt
        inT = now;
        net.send({ t: 'ui', op: 'input', m: name, p, v: t.value, c: t.checked ? 1 : 0, ch: e.type === 'change' ? 1 : 0 });
      };
      root.addEventListener('input', onInput, true);
      root.addEventListener('change', onInput, true);
      // Envanter ipuçları: yerel envanter kopyasından (host HTML'i aynı sırayı kullanır)
      root.addEventListener('mouseover', (e) => {
        if (net.remoteModal !== name || name !== 'inventory') return;
        const slot = e.target.closest?.('#inv-grid .slot');
        if (!slot) return;
        const i = [...slot.parentNode.children].indexOf(slot);
        const it = s.inventory.slots[i];
        if (it) hud.showTip(slot, it.id, it.count); else hud.hideTip();
      });
      root.addEventListener('mouseout', (e) => { if (net.remoteModal === name && e.target.closest?.('#inv-grid .slot')) hud.hideTip(); });
    }
  }

  // Özellik kısayolları (L, J, H…) ve R: host'a yönlendir
  installKeys() {
    const s = this.scene, net = this;
    this.onKey = (ev) => {
      if (!s.started || s.gameOver || ev.repeat) return;
      const t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const k = String(ev.key || '').toLowerCase();
      if (k === 'r' && !s.hud.isModalOpen()) { ev.stopImmediatePropagation(); net.send({ t: 'reload' }); return; }
      const entry = s.featureMenu.find((m) => m.key && m.key.toLowerCase() === k && !LOCAL_MENU.has(m.id));
      if (entry && !s.hud.isModalOpen()) { ev.stopImmediatePropagation(); entry.open(s); }
    };
    window.addEventListener('keydown', this.onKey, true);
    s.events.once('shutdown', () => window.removeEventListener('keydown', this.onKey, true));
  }

  onUi(m) {
    const s = this.scene, hud = s.hud;
    if (!this.started) return;
    if (!m.m) {
      if (this.remoteModal) { this.fromHost = true; try { hud.closeAll(); } finally { this.fromHost = false; } }
      return;
    }
    const root = document.querySelector(MODAL_SEL[m.m]);
    if (!root) return;
    if (hud.modal !== m.m) {
      this.fromHost = true;
      try { hud.open(m.m); } finally { this.fromHost = false; }
    }
    this.remoteModal = m.m;
    // Odaktaki giriş alanı (yazarken/sürüklerken) yeniden çizimde kaybolmasın
    const act = document.activeElement;
    const focus = act && root.contains(act) && 'value' in act ? { p: pathOf(root, act), v: act.value, s: act.selectionStart, e: act.selectionEnd } : null;
    root.innerHTML = unpackIcons(m.h || '', (k) => iconURL(s, k));
    if (focus?.p) {
      let n = root;
      for (const i of focus.p) n = n?.children?.[i];
      if (n && 'value' in n) {
        n.value = focus.v;
        n.focus();
        try { if (focus.s != null) n.setSelectionRange(focus.s, focus.e); } catch { /* kaydırıcı */ }
      }
    }
  }

  onHurt(m) {
    const s = this.scene, p = s.player;
    p.flash(0xff4444);
    if (m.x != null) p.knockback(m.x, m.y, 140);
    s.cameras.main.shake(100, 0.004);
    audio.sfx('hurt');
    s.events.emit('playerHurt', { dmg: m.d, x: m.x ?? p.x, y: m.y ?? p.y });
  }

  onOver(stats) {
    const s = this.scene;
    this.ended = true;
    if (!this.started || !stats) { this.onFail?.('Oyun bitti'); return; }
    s.gameOver = true;
    audio.setMusic(null);
    s.hud.closeAll();
    s.hud.showGameOver({ ...stats, records: {} }, () => this.rejoin());
    // Buton metni: host yeni oyunu başlatınca otomatik katılınır, beklemeden de denenebilir
    const b = document.querySelector('#gameover button');
    if (b) b.textContent = '🔁 Odaya yeniden katıl';
  }

  setRoster(list) {
    if (!list || !this.panel) return;
    this.roster = list;
    this.panel.setRoster(list.map((x) => ({ ...x, me: x.id === this.id })));
    for (const r of list) {
      const a = this.avatars.get(r.id);
      if (a && a.label.text !== r.name) a.label.setText(r.name);
      const tex = avatarTex(r); // karakter cinsiyeti
      if (a && a.spr.texture.key !== tex) { a.spr.anims.stop(); a.spr.setTexture(tex, 0); }
    }
  }

  // ---------------- Anlık görüntü uygulama ----------------
  // Bölümler birbirinden yalıtılır: eskiden aynalama / tarla kısmındaki tek bir istisna aynı mesajdaki kaynak listesini
  // (rs) da düşürüyordu; rs yalnızca host'ta DEĞİŞİNCE gittiği için ağaç/kaya misafirde kalıcı olarak yanlış kalıyordu.
  applySnap(d) {
    const s = this.scene;
    const part = (name, fn) => {
      try { fn(); } catch (e) {
        this.snapErrs = (this.snapErrs || 0) + 1;
        console.warn('Anlık görüntü bölümü uygulanamadı', name, e);
        const now = performance.now();
        if (!this.snapErrAt || now - this.snapErrAt > 5000) { this.snapErrAt = now; netLog('misafir', 'handler-error', `s.${name}: ${e?.message || e}`); }
      }
    };
    part('o', () => this.mirror.apply(d.o, d.x, this.rt ?? 0));
    if (d.pl) part('pl', () => this.applyPlayers(d.pl, null));
    if (d.tm) part('tm', () => {
      const t = s.timeSys;
      t.minutes = d.tm[0]; t.day = d.tm[1]; t.weatherDim = d.tm[2];
      t.wasNight = t.isNight;
      if (this.night !== t.isNight) { this.night = t.isNight; audio.setMusic(t.isNight ? 'night' : 'day'); }
    });
    if (d.wv) part('wv', () => { s.waves.wave = d.wv[0]; s.waves.active = !!d.wv[1]; this.remaining = d.wv[2]; });
    if (d.sh) part('sh', () => { s.shelter.hp = d.sh[0]; s.shelter.maxHp = d.sh[1]; });
    if (d.fa) for (const r of d.fa) part('fa', () => this.applyPlot(r));
    if (d.fd) part('fd', () => { for (const key of d.fd) { const p = s.farm.plots.get(key); if (p) s.farm.removePlot(p); } });
    if (d.rs) part('rs', () => {
      const dep = new Set(d.rs);
      s.resources.getChildren().forEach((r, i) => this.setDepleted(r, dep.has(i)));
    });
    if (d.fx) part('fx', () => this.applyFx(d.fx));
    if (d.fs) part('fs', () => this.applyFeatureState(d.fs));
  }

  // Kaynağın tükenmiş/ayakta durumunu host'unkine getir; değiştiyse true
  setDepleted(r, dep) {
    if (dep && !r.depleted) { depleteResource(r); return true; }
    if (!dep && r.depleted) { regrowResource(r); return true; }
    return false;
  }

  // ---------------- Kendini onaran eşitleme (bkz. NetHost.sendDigest) ----------------
  farmDigest() {
    const sigs = [];
    for (const p of this.scene.farm.plots.values()) {
      const c = p.crop;
      sigs.push([p.tx, p.ty, p.watered ? 1 : 0, p.fert || 0, p.dryDays || 0, c ? c.type : '', c ? c.stage : 0, c?.dead ? 1 : 0].join('|'));
    }
    return setHash(sigs);
  }

  onDigest(d) {
    if (!this.welcomed) return; // yeniden bağlanırken: tam görüntü (welcome) zaten gelecek
    const s = this.scene, h = this.heals;
    h.digests++;
    // 1) Kaynaklar: tam durum bit kümesi → doğrudan uygula
    if (typeof d.r === 'string') {
      const list = s.resources.getChildren(), n = Math.min(list.length, d.rn | 0);
      if (d.rn !== list.length && !this.rnWarned) { this.rnWarned = true; netLog('misafir', 'handler-error', `kaynak sayısı farklı: host ${d.rn}, misafir ${list.length}`); }
      const bits = unpackBits(d.r, n);
      let fixed = 0;
      for (let i = 0; i < n; i++) { try { if (this.setDepleted(list[i], bits[i])) fixed++; } catch (e) { console.warn('Kaynak düzeltilemedi', i, e); } }
      if (fixed) { h.res += fixed; netLog('misafir', 'resync', `${fixed} ağaç/kaya host'a göre düzeltildi`); }
    }
    // 2) Özetler: uyuşmayan bölümün tamamını iste
    const req = {};
    const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];
    if (d.m && !same(d.m, this.mirror.digest())) req.m = 1;
    if (d.f && !same(d.f, this.farmDigest())) req.f = 1;
    if (d.s && d.s !== this.fsKey) req.s = 1;
    if (d.i != null && d.i !== hashStr(invSig(s.inventory))) req.i = 1;
    this.lastMismatch = Object.keys(req);
    if (!this.lastMismatch.length) return;
    const now = performance.now();
    if (this.rsyncAt && now - this.rsyncAt < RSYNC_GAP) return;
    this.rsyncAt = now;
    h.req++;
    if (req.s) h.s++;
    if (req.i) h.i++;
    netLog('misafir', 'resync-req', this.lastMismatch.join(','));
    this.send({ t: 'rsync', ...req });
  }

  // Tam tarla listesi: listede olmayan tarlalar silinir
  applyFarmFull(list) {
    const s = this.scene, keep = new Set(list.map((r) => s.farm.key(r[0], r[1])));
    for (const [key, p] of [...s.farm.plots]) if (!keep.has(key)) { try { s.farm.removePlot(p); } catch (e) { console.warn(e); } }
    for (const r of list) { try { this.applyPlot(r); } catch (e) { console.warn('Tarla uygulanamadı', r, e); } }
  }

  // Hızlı akış: konumlar + oyuncular + ışıklar (eski/sıra dışı paketler atılır)
  applyFast(m) {
    if (m.q <= this.fastQ) return;
    this.fastQ = m.q;
    this.clock.observe(m.ht);
    if (m.p) this.mirror.applyFast(m.p, m.ht);
    if (m.pl) this.applyPlayers(m.pl, m.ht);
    this.Lbuf.push([m.ht, m.L || null]);
    if (this.Lbuf.length > 20) this.Lbuf.shift();
  }

  // Parçacık / uçan yazı olayları: yalnızca ekrana yakınsa yerelde üret
  applyFx(list) {
    const s = this.scene, v = s.cameras.main.worldView;
    for (const e of list) {
      const x = e[1], y = e[2];
      if (x < v.x - 60 || x > v.right + 60 || y < v.y - 60 || y > v.bottom + 60) continue;
      if (e[0] === 'p') s.spawnParticles(x, y, e[3], e[4]);
      else if (e[0] === 't') s.floatText(x, y, e[3], e[4]);
    }
  }

  applyFeatureState(st) {
    if (!st) return;
    const s = this.scene;
    for (const f of features) {
      if (!f.netApply || !(f.id in st)) continue;
      try { f.netApply(s, st[f.id]); } catch (e) { console.warn('netApply', f.id, e); }
    }
    Object.assign(this.fs, st);
  }

  applyPlot([tx, ty, w, f, dd, type, stage, dead]) {
    const s = this.scene, farm = s.farm, key = farm.key(tx, ty);
    let p = farm.plots.get(key);
    if (!p) {
      p = { tx, ty, watered: false, fert: 0, dryDays: 0, crop: null, sprite: null, fx: null };
      farm.plots.set(key, p);
      s.clearDecorAt?.(tx, ty);
    }
    p.watered = !!w; p.fert = f; p.dryDays = dd;
    p.crop = type ? { type, stage, growth: 0, dead: !!dead } : null;
    farm.refresh(p);
  }

  makeAvatar(id) {
    const s = this.scene;
    const r = this.roster?.find((x) => x.id === id);
    const spr = s.add.sprite(0, 0, avatarTex(r), 0);
    const shadow = s.add.image(0, 0, 'shadow');
    const label = s.add.text(0, 0, r?.name || '', nameStyle).setOrigin(0.5, 1).setDepth(10002);
    return { id, spr, shadow, label, ip: new Interp(), color: r?.color ?? 0xffffff, alive: true };
  }

  destroyAvatar(a) { a.spr.destroy(); a.shadow.destroy(); a.label.destroy(); }

  // ht: host zaman damgası (hızlı akış) ya da null (welcome: doğrudan yerleştir)
  applyPlayers(list, ht) {
    const seen = new Set();
    for (const [id, x, y, f, m, ang, al] of list) {
      if (id === this.id) continue;
      seen.add(id);
      let a = this.avatars.get(id);
      if (!a) { a = this.makeAvatar(id); this.avatars.set(id, a); ht = ht ?? 0; a.ip.reset(ht, x, y); a.spr.setPosition(x, y); }
      else if (ht == null) { a.ip.reset(0, x, y); a.spr.setPosition(x, y); }
      else a.ip.push(ht, x, y);
      a.alive = !!al;
      a.spr.setFlipX(!!f);
      a.spr.setAngle(al ? ang : 90);
      if (m && al) a.spr.play(`${a.spr.texture.key}_walk`, true); else { a.spr.anims.stop(); a.spr.setFrame(0); }
      const r = this.roster?.find((q) => q.id === id);
      if (r) a.color = r.color;
    }
    for (const [id, a] of this.avatars) if (!seen.has(id)) { this.destroyAvatar(a); this.avatars.delete(id); }
  }

  applyMe(m) {
    const s = this.scene, p = s.player;
    p.hp = m.hp; p.maxHp = m.mhp; p.energy = m.en; p.maxEnergy = m.men; p.coins = m.c;
    if (m.h !== undefined) this.hint = m.h || '';
    if (m.px != null && (m.tp !== this.tp || !this.placed)) {
      if (this.placed && m.tp !== this.tp) this.corrections = (this.corrections || 0) + 1; // host konum düzeltmesi / yeniden doğma
      p.setPosition(m.px, m.py); this.placed = true;
    }
    this.tp = m.tp;
    const alive = !!m.al;
    if (alive !== p.alive) {
      p.alive = alive;
      if (!alive) { p.rollT = 0; s.tweens.killTweensOf(p); p.halt(); p.setAngle(90); }
      else { p.setAngle(0); p.invuln = 2; }
    }
    if (m.inv) s.inventory.load(m.inv);
    if (m.fs) for (const f of features) {
      if (!f.netApplyPlayer || !(f.id in m.fs)) continue;
      try { f.netApplyPlayer(s, m.fs[f.id]); } catch (e) { console.warn('netApplyPlayer', f.id, e); }
    }
  }

  // Vekillerden ortam sesleri: yakındaki zombiye vuruş (beyaz parlama), zombi ölümü (vekil silinmesi)
  onProxyEvent(kind, m) {
    const k = m.texture?.key || '';
    if (!k.startsWith('zombie') || !m.visible) return;
    const p = this.scene.player;
    const d = Phaser.Math.Distance.Between(p.x, p.y, m.x, m.y);
    if (d > HEAR) return;
    if (kind === 'flash') audio.sfx('hit');
    else if (kind === 'gone') audio.sfx('zdie');
  }

  // ---------------- Yerel eylemler (GameScene/PlayerActions buraya yönlendirir) ----------------
  use(wx, wy) {
    const s = this.scene, p = s.player;
    if (!p.alive || p.actionCd > 0 || this.charge) return;
    const slot = s.inventory.slots[s.selected];
    // Yay: basılı tutulurken yerelde gerilir, bırakınca gerilme oranıyla host'a gider
    if (slot?.id === 'bow' && s.inventory.count('arrow') > 0) {
      const ptr = s.input.activePointer;
      const src = ptr.isDown && !ptr.wasTouch && ptr.leftButtonDown() ? 'mouse' : this.spaceKey?.isDown ? 'space' : null;
      if (src) {
        this.charge = { t: 0, src };
        p.speedMul = 0.55;
        audio.tone({ type: 'triangle', freq: 220, to: 330, dur: 0.3, vol: 0.08 });
        return;
      }
    }
    this.sendUse(wx, wy, null);
  }

  sendUse(wx, wy, ch) {
    const s = this.scene, p = s.player;
    p.actionCd = 0.22;
    if (Math.abs(wx - p.x) > 2) p.setFlipX(wx < p.x);
    const m = { t: 'use', x: Math.round(wx * 10) / 10, y: Math.round(wy * 10) / 10, s: s.selected };
    if (ch != null) m.ch = Math.round(ch * 100) / 100;
    this.send(m);
  }

  updateCharge(dt) {
    const s = this.scene, p = s.player, g = this.chargeGfx, c = this.charge;
    g.clear();
    if (!c) return;
    const slot = s.inventory.slots[s.selected];
    if (!p.alive || slot?.id !== 'bow') { this.charge = null; p.speedMul = 1; return; }
    c.t += dt;
    const held = c.src === 'mouse' ? s.input.activePointer.isDown : this.spaceKey?.isDown;
    const r = Math.min(1, c.t / BOW_CHARGE);
    if (!held) {
      this.charge = null;
      p.speedMul = 1;
      const wp = s.input.activePointer.positionToCamera(s.cameras.main);
      this.sendUse(wp.x, wp.y, r);
      return;
    }
    const x = p.x - 7, y = p.y - 13;
    g.fillStyle(0x000000, 0.6).fillRect(x, y, 14, 2);
    g.fillStyle(r >= 1 ? 0x9effa0 : 0xffd166, 1).fillRect(x, y, 14 * r, 2);
  }

  interact() { this.send({ t: 'int', s: this.scene.selected }); }

  onSelect(i) { this.send({ t: 'sel', s: i }); }

  hintAction() { return this.hint ? { dist: 0, label: this.hint, run: () => this.interact() } : null; }

  // Gece ışıkları: kendi oyuncusu + diğer oyuncular (enterpole) + statik ışıklar + host listesi (oynatma zamanına göre)
  drawLights(light, flicker) {
    const s = this.scene;
    light(s.player.x, s.player.y, 85 * flicker);
    for (const a of this.avatars.values()) if (a.alive) light(a.spr.x, a.spr.y, 85 * flicker);
    s.staticLights.forEach((l) => light(l.x, l.y, l.r * flicker));
    const L = this.lightsAt(this.rt);
    if (L) for (let i = 0; i < L.length; i += 3) light(L[i], L[i + 1], L[i + 2]);
  }

  lightsAt(rt) {
    const b = this.Lbuf;
    if (!b.length) return null;
    if (rt == null) return b[b.length - 1][1];
    let best = b[0];
    for (const e of b) { if (e[0] <= rt) best = e; else break; }
    return best[1];
  }

  // ---------------- Kare güncellemesi (GameScene.update misafirde bunu çağırır) ----------------
  // Bir istisna Phaser döngüsünü öldürmesin
  update(dt) {
    try { this.updateInner(dt); } catch (e) {
      console.warn('Misafir güncellemesi hata verdi', e);
      const now = performance.now();
      if (!this.updErrAt || now - this.updErrAt > 5000) { this.updErrAt = now; netLog('misafir', 'handler-error', `update: ${e?.message || e}`); }
    }
  }

  updateInner(dt) {
    const s = this.scene;
    if (!this.started || !s.started) { s.drawDarkness(); return; }
    this.rt = this.clock.renderTime(dt);
    this.mirror.update(this.rt);
    for (const a of this.avatars.values()) {
      if (this.rt != null) {
        const q = a.ip.sample(this.rt);
        if (q) a.spr.setPosition(q[1], q[2]);
        a.ip.trim(this.rt);
      }
      const feet = a.spr.y + 7;
      a.spr.setDepth(feet);
      if (!a.spr.isTinted) a.spr.setTint(a.color);
      a.shadow.setPosition(a.spr.x, feet).setDepth(feet - 1);
      a.label.setPosition(a.spr.x, a.spr.y - 10);
    }
    const p = s.player;
    if (!p.isTinted) p.setTint(this.color);
    features.forEach((f) => { if (f.guestUpdate) { try { f.guestUpdate(s, dt); } catch (e) { console.warn('guestUpdate', f.id, e); } } });
    if (s.gameOver) { s.drawDarkness(); return; }
    const modal = s.hud.isModalOpen();
    s.updateMarker();
    p.update(dt, s.keys, modal);
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (p.body && !(p.rollT > 0)) { p.body.velocity.x *= this.slowK; p.body.velocity.y *= this.slowK; }
      if (Math.random() < dt * 6) s.spawnParticles(p.x, p.y + 4, 0xbfe6ff, 1);
    }
    this.updateCharge(dt);
    if (!modal) {
      s.updateClick(dt);
      features.forEach((f) => { if (GUEST_UPDATE.has(f.id)) f.update?.(s, dt); });
      const act = this.hintAction();
      if (act) s.hud.hint(`E · ${act.label}`);
      else if (s.hoverRipe) s.hud.hint('Tıkla · Hasat et');
      else s.hud.hint('');
    }
    this.ambient(dt);
    s.drawDarkness();
    s.hudTimer -= dt;
    if (s.hudTimer <= 0) { s.hudTimer = 0.1; s.hud.update(); }
    // Konum bildirimi (hızlı kanal, 20 Hz, değişince; durursa yarım saniyede bir)
    this.sendT -= dt;
    if (this.sendT <= 0 && p.alive) {
      this.sendT = 0.05;
      const moving = !!(p.body && (p.body.velocity.x || p.body.velocity.y));
      const mv = { t: 'mv', x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, f: p.flipX ? 1 : 0, m: moving ? 1 : 0, a: Math.round(p.angle), tp: this.tp };
      const key = `${mv.x},${mv.y},${mv.f},${mv.m},${mv.a},${mv.tp}`;
      this.mvIdle -= 0.05;
      if (key !== this.lastMv || this.mvIdle <= 0) {
        this.lastMv = key; this.mvIdle = 0.5;
        mv.q = ++this.mvQ;
        this.conn?.sendFast ? this.conn.sendFast(mv) : this.send(mv);
      }
    }
  }

  // Yakında zombi varsa ara sıra inilti
  ambient(dt) {
    this.groanT -= dt;
    if (this.groanT > 0) return;
    this.groanT = Phaser.Math.FloatBetween(4, 9);
    const p = this.scene.player;
    for (const z of this.scene.zombies.getChildren()) {
      if (z.visible && Phaser.Math.Distance.Between(p.x, p.y, z.x, z.y) < 150) { audio.sfx('groan'); return; }
    }
  }

  // ---------------- Test / ölçüm ----------------
  syncSummary() {
    const s = this.scene, tex = {};
    for (const m of this.mirror.objs.values()) {
      if (m.nk !== 'i' || !m.visible || m.alpha < 0.01) continue;
      const k = m.texture?.key || '?';
      tex[k] = (tex[k] || 0) + 1;
    }
    const plots = [...s.farm.plots.values()].map((p) => {
      const c = p.crop;
      return [p.tx, p.ty, p.watered ? 1 : 0, p.fert || 0, p.dryDays || 0, c ? c.type : '', c ? c.stage : 0, c?.dead ? 1 : 0].join(':');
    }).sort();
    const res = [];
    s.resources.getChildren().forEach((r, i) => { if (r.depleted) res.push(i); });
    return {
      tex, plots: plots.length, farm: plots.join(';'), res: res.join(','),
      day: s.timeSys.day, min: Math.floor(s.timeSys.minutes), wave: s.waves.wave, active: !!s.waves.active, shelter: Math.round(s.shelter.hp),
      players: 1 + this.avatars.size,
      zones: Object.entries(s.zones?.state || {}).filter(([, v]) => v?.open).map(([k]) => k).sort().join(',')
    };
  }

  // Enterpolasyon ölçümü: oynatma zamanı (host saatinde) + o anki vekil/avatar konumları
  debugPositions() {
    const objs = {};
    for (const [id, m] of this.mirror.objs) if (m.visible && !m.pa) objs[id] = [m.x, m.y];
    for (const [id, a] of this.avatars) objs[id] = [a.spr.x, a.spr.y];
    return { rt: this.rt, hostNow: this.clock.hostNow(), delay: this.clock.delay, objs };
  }
}

// Diğer oyuncunun karakter dokusu (roster'daki cinsiyete göre; eski host'ta alan yoksa erkek)
function avatarTex(r) { return r?.gender === 'f' ? 'player_f' : 'player'; }
