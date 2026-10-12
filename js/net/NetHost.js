// Host (oda kurucu) oturumu: tüm simülasyon burada çalışır. Her misafir için sahnede ikinci bir Player,
// kendi Inventory'si ve seçili slotu tutulur. Misafir girdileri "bağlam takası" ile (scene.player /
// inventory / selected + HUD durumu geçici olarak misafirinkine çevrilerek) mevcut oyun koduyla uygulanır.
// Dünya durumu ~12 Hz'de güvenilir fark, konumlar ~20 Hz'de hızlı (güvenilmez) akış olarak yayınlanır (bkz. mirror.js).
// Özellik modülleri için ağ sözleşmesi (registry.js): netState/netApply (ortak HUD durumu), netPlayerState/
// netApplyPlayer (oyuncuya özel HUD), playerState {get,set,fresh,save,load} (oyuncu başına kalıcı durum: yetenek,
// silah seviyesi, yemek güçlendirmesi — misafir bağlamında takas edilir), guestUpdate (misafirde görsel kare).
import { START_INVENTORY, PLAYER_STATS, MAP_W, MAP_H, TILE, ITEMS } from '../config.js';
import { features } from '../features/registry.js';
import { audio } from '../audio.js';
import { Player } from '../entities/Player.js';
import { Inventory } from '../systems/Inventory.js';
import { useSelected } from '../systems/PlayerActions.js';
import { iconCacheEntries } from '../textures.js';
import { MirrorWriter, hashStr, setHash, packBits, invSig } from './mirror.js';
import { openRoom, getTurn, iceConfig, turnStatus } from './transport.js';
import { RoomPanel, inviteLink, packIcons, byPath } from './NetUI.js';
import { netLog, reasonText, workerInterval, pairText } from './diag.js';

const ROOM_KEY = 'zombi-ciftlik-net-room';  // son oda kodu: host sayfası yenilenince aynı kod geri alınır
const ROOM_TTL = 12 * 3600 * 1000;
const SILENT_MS = 12000;                    // bu kadar sessizlik → kopmuş say
const SILENT_HIDDEN_MS = 45000;             // karşı taraf arka planda ise (tarayıcı zamanlayıcıları kısar/dondurur)
const HOLD_MS = 60000;                      // kopan misafirin konumu bu süre içinde dönerse korunur
export function lastRoomCode() {
  try { const r = JSON.parse(localStorage.getItem(ROOM_KEY) || 'null'); return r && Date.now() - r.t < ROOM_TTL ? r.code : null; } catch { return null; }
}
function saveRoomCode(code) { try { localStorage.setItem(ROOM_KEY, JSON.stringify({ code, t: Date.now() })); } catch { /* yok say */ } }

export const PROTO = 1;
export const MAX_GUESTS = 3;
export const PLAYER_COLORS = [0xffffff, 0x8fd3ff, 0xffa8a8, 0xb8f5a0];
const SNAP_DT = 1 / 12;
const FAST_DT = 1 / 20;
const FS_DT = 0.25;                         // özellik HUD durumları
const DIGEST_DT = 5;                        // sn: kendini onaran durum özeti (bkz. sendDigest)
const RSYNC_MIN = 1.5;                      // sn: aynı misafirden iki yeniden eşitleme isteği arası en az
const GLOBAL_SFX = new Set(['alarm', 'dawn']); // host'ta bağlam dışında çalınınca herkese duyurulur
const MOVE_SLACK = 1.35;                    // misafir hız sınırı payı (yemek hızı + ağ dalgalanması)
const MOVE_BURST = 170;                     // px: birikebilecek en büyük hareket bütçesi (yuvarlanma + gecikme patlaması)
const HUD_FIELDS = ['e', 'modal', 'modalName', 'npc', 'shopTab', 'pickedSlot', 'craftTab', 'onPanelClose', 'lastNotice', 'lastNoticeAt'];
const MODAL_EL = { inventory: 'inv', dialog: 'dialog', shop: 'shop', feature: 'feature' };
const r1 = (v) => Math.round(v * 10) / 10;

// obj[key]'i geçici olarak değiştir; geri alma fonksiyonu döndürür (kalıtılmış alanı siler, kendi alanı geri yazar)
function patch(obj, key, val) {
  const own = Object.prototype.hasOwnProperty.call(obj, key);
  const old = obj[key];
  obj[key] = val;
  return () => { if (own) obj[key] = old; else delete obj[key]; };
}

const nameStyle = { fontFamily: 'Outfit, sans-serif', fontSize: '7px', color: '#ffffff', stroke: '#000', strokeThickness: 2, resolution: 4 };

export class NetHost {
  constructor(scene, { name, room = null }) {
    this.isHost = true;
    this.scene = scene;
    this.name = name || 'Host';
    this.guests = new Map();
    this.seq = 0;
    this.snapT = 0;
    this.slowT = 0;
    this.ctx = null;
    this.code = null;
    this.mirror = new MirrorWriter(scene, (o) => this.skip(o), (o) => this.playerSolid(o));
    this.farmSig = new Map();
    this.farmRecs = new Map(); // anahtar → misafirlere gönderilmiş son tarla kaydı (yeniden eşitleme için)
    this.digestT = 1;
    this.digestDt = DIGEST_DT; // test: kısaltılabilir
    this.heals = { req: 0, m: 0, f: 0, s: 0, i: 0 };
    this.resKey = '';
    this.lastQuests = '';
    this.fastT = 0;
    this.fastSeq = 0;
    this.fsT = 0;
    this.lastFs = '';
    this.fsState = {};
    this.fxq = [];
    this.hist = null; // test: host konum geçmişi (bkz. recordHistory)
    this.hasTick = features.some((f) => f.playerState?.tick);
    scene.netPlayers = [];
    scene.netGuestStore = scene.netGuestStore || {};

    // Aynalanmayacak yerel nesneler
    const p = scene.player;
    [p, p.shadow, p.hpBg, p.hpFg, scene.marker, scene.ghost].forEach((o) => { if (o) o.netSkip = true; });
    if (scene._world) { scene._world.seasonRect && (scene._world.seasonRect.netSkip = true); }

    this.panel = new RoomPanel();
    this.panel.onToast = (m) => scene.hud.toast(m, 'ok');
    this.panel.setStatus('Oda açılıyor…');
    this.panel.setDiagProvider(() => this.diagInfo());
    this.refreshRoster();
    this.held = new Map(); // ad → { sid, t }: kopan misafirler (konum netGuestStore'da)

    this.installHooks();
    // Oyun yeniden başlatıldıysa aynı oda (aynı kod) devralınır: misafirler aynı kodla geri döner.
    // Sayfa yenilendiyse son oda kodu (localStorage) geri alınmaya çalışılır.
    const preferCode = room ? null : lastRoomCode();
    const ready = room ? Promise.resolve(room).then((h) => { h.rebind?.((conn) => this.onConn(conn)); return h; })
      : openRoom((conn) => this.onConn(conn), { preferCode, onStatus: (t) => this.panel.setStatus(t) });
    ready.then((h) => {
      if (this.closed) { if (!this.keepRoom) h.close(); return; }
      this.handle = h;
      h.beforeHide = () => this.onPageHide(); // yerel taşıyıcı: kanallar kapanmadan önce
      this.code = h.code;
      saveRoomCode(h.code);
      netLog('host', 'room-open', `${h.code}${preferCode ? (preferCode === h.code ? ' (önceki kod geri alındı)' : ` (önceki ${preferCode} alınamadı)`) : ''} · TURN: ${getTurn() ? 'kullanıcı' : 'yok'}`);
      this.panel.setCode(h.code, true);
      this.statusLine();
      h.onSignal = () => this.statusLine();
      scene.hud.toast(room ? `Yeni oyun aynı odada: ${h.code}` : `Oda kuruldu: ${h.code} · Davet linki için 🔗`, 'ok');
    }).catch((e) => {
      console.warn('Oda kurulamadı', e);
      netLog('host', 'room-failed', e?.type || e?.message || String(e));
      this.panel.setCode('Çevrimdışı', false);
      this.panel.setStatus(`Oda kurulamadı: ${e?.message || e}`, true);
      scene.hud.toast('Oda kurulamadı; tek başına devam ediyorsun.', 'warn');
    });
    // Ping/zaman aşımı denetimi Worker zamanlayıcısıyla: arka plan sekmesinde setInterval dakikada bire düşebilir
    this.stopPing = workerInterval(() => this.heartbeat(), 2000);
    this.onVis = () => {
      const hidden = document.visibilityState === 'hidden';
      netLog('host', hidden ? 'tab-hidden' : 'tab-visible');
      this.broadcast({ t: 'vis', h: hidden ? 1 : 0 });
      // Dönüşte (mobilde sayfa donmuş olabilir) misafirlerin sessizliğini hemen kopma sayma: 5 sn tanı
      if (!hidden) { const now = performance.now(); for (const g of this.guests.values()) g.lastSeen = Math.max(g.lastSeen, now - SILENT_MS + 5000); }
    };
    document.addEventListener('visibilitychange', this.onVis);
    // Sekme kapanıyor/yenileniyor: misafirlerin son ilerlemesi kayda yazılsın (otomatik kayıt 60 sn'de bir) ve
    // misafirlere net bir neden gitsin (yalnızca "veri kanalı kapandı" değil). Oda kodu korunur, misafirler yeniden dener.
    this.onPageHide = () => {
      if (this.closed || this.leaving) return;
      this.leaving = true;
      setTimeout(() => { this.leaving = false; }, 1000); // bfcache'ten dönülürse tekrar çalışabilsin
      try { scene.saveGame?.(false); } catch (e) { console.warn('Çıkış kaydı', e); }
      this.broadcast({ t: 'hostleave' });
    };
    window.addEventListener('pagehide', this.onPageHide, true); // yakalama: taşıyıcının kapanışından önce çalışsın
    this.keepAlive(scene.game);
    scene.events.once('shutdown', () => this.close());
  }

  statusLine() {
    if (!this.handle) return;
    const ok = this.handle.signalOk?.() ?? true;
    this.panel.setStatus(ok ? `Arkadaşlarını davet et (en fazla 3) · sinyal ✔` : 'Sinyal sunucusu koptu, yeniden bağlanılıyor… (oyun sürer)', !ok);
  }

  // Teşhis paneli verisi
  async diagInfo() {
    const now = performance.now(), lines = [];
    const sig = this.handle ? (this.handle.signalOk?.() ? 'kayıtlı ✔' : `koptu (deneme ${this.handle.signal?.tries || 0})`) : 'oda açılmadı';
    lines.push(['Rol', `host · oda ${this.code || '—'}`], ['Sinyal sunucusu', sig], ['TURN', getTurn() ? 'kullanıcı TURN ✔' : 'yok (STUN + PeerJS genel TURN)']);
    if (document.visibilityState === 'hidden') lines.push(['Sekme', 'arka planda']);
    let advice = '';
    for (const g of this.guests.values()) {
      const inf = await g.conn.info().catch(() => ({}));
      lines.push([g.name, `ICE ${inf.ice || '?'} · ${pairText(inf.pair)} · ping ${Math.round(g.ping)} ms · son mesaj ${((now - g.lastSeen) / 1000).toFixed(1)} sn${g.hidden ? ' · arka planda' : ''}${inf.maxMsgSize ? ` · maxMsg ${inf.maxMsgSize}` : ''}`]);
      if (inf.pair && inf.pair.local !== 'relay' && inf.pair.remote !== 'relay' && (this.drops?.[g.name] || 0) >= 2 && !getTurn()) advice = `${g.name} sık kopuyor ve bağlantı TURN üzerinden değil: farklı ağlardaysanız aşağıya bir TURN sunucusu ekleyin.`;
    }
    if (!this.guests.size) lines.push(['Misafir', 'yok']);
    if (this.lastDrop) lines.push(['Son kopma', `${this.lastDrop.name}: ${reasonText(this.lastDrop.reason)} (${new Date(this.lastDrop.at).toLocaleTimeString()})`]);
    lines.push(['Eşitleme onarımı', `${this.heals.req} istek · ${this.heals.m} nesne · ${this.heals.f} tarla · ${this.heals.s} özellik · ${this.heals.i} envanter`]);
    lines.push(['Kopma sayısı', Object.values(this.drops || {}).reduce((a, b) => a + b, 0)]);
    lines.push(['ICE sunucuları', iceConfig().iceServers.map((x) => [].concat(x.urls)[0].replace(/\?.*$/, '')).join(', ')]);
    lines.push(['Yerleşik TURN', turnStatus()]);
    return { lines, advice };
  }

  // Host sekmesi arka plana geçince (başka sekme/pencere) tarayıcı rAF'ı durdurur/kısar ve Phaser oyunu duraklatır:
  // misafirlerin dünyası donardı. Barındırırken duraklatma kapatılır; rAF 50 ms'den uzun gelmezse oyun döngüsü
  // bir Worker zamanlayıcısıyla (arka planda kısılmaz) ~30 Hz adımlanır.
  keepAlive(game) {
    const E = Phaser.Core.Events;
    if (game.__netKeepAlive) return;
    game.__netKeepAlive = true;
    game.events.off(E.HIDDEN, game.onHidden, game);
    game.events.off(E.VISIBLE, game.onVisible, game);
    try {
      const src = 'let t=null;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data);};';
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = () => {
        // rAF durmuş ya da kısılmışsa (gizli/odak dışı sekme) döngüyü elle adımla
        const loop = game.loop, now = performance.now();
        // rAF döngüsü bir istisnayla ölmüşse (loop.running ama adım gelmiyor) de bu yol oyunu sürdürür
        if (!loop?.running || now - (loop.now || 0) < 50) return;
        try { loop.step(now); } catch (e) { console.warn('Arka plan adımı', e); }
      };
      w.postMessage(30);
      game.__netWorker = w;
    } catch (e) { console.warn('Arka plan zamanlayıcısı kurulamadı', e); }
  }

  // ---------------- Kurulum ----------------
  installHooks() {
    const s = this.scene;
    // Misafirlerin ışıkları ve mini harita noktaları (host ekranı). Misafirler oyuncu ışıklarını kendileri çizer.
    const lp = () => s.netPlayers.filter((p) => p.alive).map((p) => ({ x: p.x, y: p.y, r: 85 }));
    lp.netPlayers = true;
    s.lightSources.push(lp);
    s.minimapDots = s.minimapDots || [];
    s.minimapDots.push(() => s.netPlayers.map((p) => ({ x: p.x, y: p.y, color: '#8fd3ff', r: 2 })));
    // Banner'lar herkese
    const hud = s.hud, origBanner = hud.banner;
    hud.banner = (a, b) => { origBanner.call(hud, a, b); if (!this.ctx) this.broadcast({ t: 'banner', a, b }); };

    const onDied = (p) => this.onRemoteDied(p);
    const onKill = (z) => {
      // Yakındaki diğer oyunculara da ödül (o anki scene.player'ı GameScene zaten ödüllendirdi)
      const cur = s.player;
      for (const p of [s.netHostPlayer || null, ...s.netPlayers]) {
        if (!p || p === cur || !p.alive) continue;
        if (Phaser.Math.Distance.Between(z.x, z.y, p.x, p.y) < 260) p.addCoins(z.reward || 0);
      }
    };
    const onWaveEnd = (w) => {
      const reward = Math.round(15 * w * (s.difficulty?.reward ?? 1));
      for (const g of this.guests.values()) { g.player.coins += reward; g.out.push({ t: 'toast', m: `${w}. dalgayı atlattınız · +${reward} 🪙`, ty: 'ok' }); }
    };
    const onDawn = () => { for (const g of this.guests.values()) { const p = g.player; p.energy = Math.max(p.energy, p.maxEnergy * 0.8); } };
    s.netHostPlayer = s.player;
    this.hostInv = s.inventory; // misafir bağlamında s.inventory takas edilir: eşya verme için host'unki
    // Takım arkadaşının yanında E: envanteri aç (eşya/para verme satırı orada)
    const giveNear = (sc) => {
      const me = sc.player;
      if (!me?.alive || !this.guests.size || sc.hud.modal) return null;
      let best = null, bd = 18;
      for (const q of [sc.netHostPlayer, ...sc.netPlayers]) {
        if (!q || q === me || !q.alive) continue;
        const d = Phaser.Math.Distance.Between(me.x, me.y, q.x, q.y);
        if (d < bd) { bd = d; best = q; }
      }
      if (!best) return null;
      const name = best === sc.netHostPlayer ? this.name : this.guestOf(best)?.name;
      // Ceza payı: kapı/NPC gibi gerçek etkileşimler yakınsa onlar önce gelsin
      return { dist: bd + 12, label: `🎁 ${name || 'Arkadaşına'} eşya ver`, run: () => { if (sc.hud.modal !== 'inventory') sc.hud.toggleInventory(); } };
    };
    s.addInteraction(giveNear);
    // Parçacık ve uçan yazılar aynalanmaz: misafirde yerel olarak (akıcı) yeniden üretilir
    const undo = [];
    const origP = s.spawnParticles, origT = s.floatText;
    const markNew = (from) => { const L = s.children.list; for (let i = from; i < L.length; i++) L[i].netSkip = true; };
    undo.push(patch(s, 'spawnParticles', (x, y, color, n = 6) => {
      const from = s.children.list.length;
      origP.call(s, x, y, color, n);
      markNew(from);
      if (this.guests.size && this.fxq.length < 80) this.fxq.push(['p', r1(x), r1(y), color, n]);
    }));
    undo.push(patch(s, 'floatText', (x, y, text, color = '#fff') => {
      const from = s.children.list.length;
      origT.call(s, x, y, text, color);
      markNew(from);
      if (this.guests.size && this.fxq.length < 80) this.fxq.push(['t', r1(x), r1(y), String(text), color]);
    }));
    // Genel uyarı sesleri (alarm, şafak) herkese
    const origSfx = audio.sfx;
    undo.push(patch(audio, 'sfx', (n, ...a) => {
      const r = origSfx.call(audio, n, ...a);
      if (!this.ctx && GLOBAL_SFX.has(n) && this.guests.size) this.broadcast({ t: 'sfx', l: [n] });
      return r;
    }));
    s.events.on('remotePlayerDied', onDied);
    s.events.on('zombieKilled', onKill);
    s.events.on('waveEnd', onWaveEnd);
    s.timeSys.on('dawn', onDawn);
    this.unhook = () => {
      undo.reverse().forEach((u) => u());
      s.events.off('remotePlayerDied', onDied);
      s.events.off('zombieKilled', onKill);
      s.events.off('waveEnd', onWaveEnd);
      s.timeSys.off('dawn', onDawn);
      s.interactions = s.interactions.filter((f) => f !== giveNear);
    };
  }

  skip(o) {
    if (o.netSkip || o.netFx || this.scene.worldStatic?.has(o)) return true;
    if (o.scrollFactorX === 0) return true;
    if (o.depth >= 8990 && o.depth <= 9010) return true; // imleç / yerleştirme önizlemeleri (yalnız host'a ait)
    const tk = o.texture?.key;
    return !!tk && (tk.startsWith('crop_') || tk === 'fert_dots'); // tarla ayrı senkronlanır
  }

  // ---------------- Bağlantılar ----------------
  onConn(conn) {
    if (this.closed) { conn.close('host-closed'); return; } // oda yeni oturuma devredilirken gelen bağlantı: misafir yeniden dener
    let g = null;
    const timer = setTimeout(() => { if (!g) conn.close('join-failed'); }, 15000);
    conn.onData((m) => {
      if (!m || typeof m !== 'object') return;
      if (!g) {
        if (m.t !== 'hello') return;
        clearTimeout(timer);
        try {
          // Aynı oyuncu (oturum kimliği / aynı ad + eski bağlantı sessiz) yeni bağlantıyla döndü: karakteri devral
          const old = this.findReturning(m);
          if (old) { old.gender = (m.gender === 'f' ? 'f' : 'm'); old.player.setGender?.(old.gender); g = this.takeover(old, conn); return; } // karakter cinsiyeti (town/charPick)
          if (this.guests.size >= MAX_GUESTS) { conn.send({ t: 'full' }); setTimeout(() => conn.close('manual'), 300); return; }
          if (this.scene.gameOver) { conn.send({ t: 'over', stats: null }); setTimeout(() => conn.close('manual'), 300); return; }
          g = this.addGuest(conn, m.name, m.sid, (m.gender === 'f' ? 'f' : 'm'));
        } catch (e) {
          console.warn('Misafir eklenemedi', e);
          netLog('host', 'handler-error', `hello: ${e?.message || e}`);
        }
        return;
      }
      if (g.conn !== conn) return; // devralınmış eski bağlantı
      g.lastSeen = performance.now();
      try { this.onMsg(g, m); } catch (e) {
        console.warn('Misafir mesajı işlenemedi', m?.t, e);
        const now = performance.now();
        if (!this.errAt || now - this.errAt > 5000) { this.errAt = now; netLog('host', 'handler-error', `${m?.t}: ${e?.message || e}`); }
      }
    });
    conn.onClose((reason) => { clearTimeout(timer); if (g && g.conn === conn) this.removeGuest(g, reason || conn.reason); });
  }

  findReturning(m) {
    const now = performance.now();
    for (const g of this.guests.values()) {
      if (m.sid && g.sid === m.sid) return g;
      if (g.name === String(m.name || '').trim().slice(0, 14) && now - g.lastSeen > 3000) return g;
    }
    return null;
  }

  // Bağlantı değişimi: karakter, envanter, konum aynen kalır; yeni bağlantıya tam dünya gönderilir
  takeover(g, conn) {
    const old = g.conn;
    g.conn = conn;
    g.lastSeen = performance.now();
    g.hidden = false;
    g.mvQ = 0; g.lastMe = ''; g.uiModal = null; g.uiHtml = ''; g.lastQuests = ''; g.invDirty = true;
    try { old.close('replaced'); } catch { /* yok say */ }
    netLog('host', 'guest-returned', `${g.name} (bağlantı devralındı)`);
    this.sendSnapshot();
    this.welcome(g);
    this.scene.hud.toast(`${g.name} yeniden bağlandı`, 'ok');
    this.refreshRoster();
    return g;
  }

  welcome(g) {
    const s = this.scene, p = g.player;
    const turn = getTurn();
    this.send(g, {
      t: 'welcome', v: PROTO, id: g.id, name: g.name, color: g.color, diff: s.difficulty?.id || 'normal', x: p.x, y: p.y,
      snap: this.fullSnapshot(), quests: this.withGuest(g, () => this.questList()) || [], roster: this.rosterList(),
      ice: turn ? turn.servers : undefined // misafir yeniden bağlanırken aynı TURN'ü kullansın
    });
    this.sendMe(g, true);
  }

  addGuest(conn, rawName, sid, gender = 'm') {
    const s = this.scene;
    const base = String(rawName || 'Misafir').trim().slice(0, 14) || 'Misafir';
    let name = base;
    const taken = new Set([this.name, ...[...this.guests.values()].map((x) => x.name)]);
    for (let i = 2; taken.has(name); i++) name = `${base.slice(0, 12)}${i}`;
    const used = new Set([...this.guests.values()].map((x) => x.slot));
    let slot = 1; while (used.has(slot)) slot++;
    const id = `g${++this.seq}`;
    const door = s.shelter.door;
    const p = new Player(s, door.x - 16 + slot * 8, door.y + 14);
    const g = {
      id, slot, conn, name, sid: sid || null, hidden: false, color: PLAYER_COLORS[slot] || 0xffffff, player: p, inv: new Inventory(), selected: 0,
      hud: null, out: [], sfx: [], lastMe: '', invDirty: true, uiInvDirty: false, uiModal: null, uiHtml: '',
      lastSeen: performance.now(), ping: 0, tx: p.x, ty: p.y, flip: false, moving: false, angle: 0, hint: '', hintT: 0, sentTp: -1, gender
    };
    p.setGender?.(gender);
    p.netRemote = {
      hurt: (dmg, src) => this.send(g, { t: 'hurt', d: r1(dmg), x: src ? r1(src.x) : null, y: src ? r1(src.y) : null }),
      send: (m) => this.send(g, m) // özellik modüllerinin misafire özel mesajları (balık, buz yavaşlatma…)
    };
    p.netTp = 0;
    p.setTint(g.color);
    [p, p.shadow, p.hpBg, p.hpFg].forEach((o) => { o.netSkip = true; });
    g.label = s.add.text(p.x, p.y - 12, name, nameStyle).setOrigin(0.5, 1).setDepth(10002);
    g.label.netSkip = true;
    // Kayıtlı misafir verisi (aynı adla tekrar katılırsa eşyaları geri gelir)
    const saved = s.netGuestStore?.[name];
    if (saved) {
      g.inv.load(saved.inv);
      p.coins = saved.coins ?? PLAYER_STATS.startCoins;
      p.hp = Math.max(1, Math.min(p.maxHp, saved.hp ?? p.maxHp));
      p.energy = Math.min(p.maxEnergy, saved.energy ?? p.maxEnergy);
      g.selected = saved.selected || 0;
      // Kısa süre önce koptuysa kaldığı yerden devam (konum + hayatta olma)
      const pos = saved.pos;
      if (pos && Date.now() - pos.t < HOLD_MS && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        p.setPosition(pos.x, pos.y);
        g.restored = true;
      }
    } else START_INVENTORY.forEach(([iid, n]) => g.inv.add(iid, n));
    g.tx = p.x; g.ty = p.y;
    g.inv.onChange(() => {
      g.invDirty = true; g.uiInvDirty = true;
      this.withGuest(g, () => s.events.emit('guestInventoryChanged')); // ör. ilan panosu toplama görevleri
    });
    g.hud = this.makeHudState();
    this.guests.set(id, g);
    s.netPlayers.push(p);
    this.initGuestState(g, saved);
    // Özellikler misafir karakterine kendi sarmalayıcılarını kursun (ör. para istatistiği, satış hedefi)
    try { s.events.emit('netPlayerAdded', p, g); } catch (e) { console.warn('netPlayerAdded', e); }

    // Mevcut misafirlerin taban durumu güncel olsun, sonra yeniye tamamını gönder
    if (this.guests.size > 1) this.sendSnapshot();
    else this.resetBaseline();
    if (g.restored) { try { s.netMoveCheck?.(g); } catch (e) { console.warn('Konum doğrulama', e); } }
    this.welcome(g);
    const back = this.held.has(name);
    this.held.delete(name);
    netLog('host', back ? 'guest-returned' : 'guest-joined', `${name}${g.restored ? ' (konum korundu)' : ''}`);
    s.hud.toast(back ? `${name} geri döndü 👋` : `${name} oyuna katıldı 👋`, 'ok');
    this.broadcast({ t: 'toast', m: back ? `${name} geri döndü 👋` : `${name} oyuna katıldı 👋`, ty: 'ok' }, g);
    this.refreshRoster();
    return g;
  }

  removeGuest(g, reason) {
    if (!this.guests.has(g.id)) return;
    const s = this.scene;
    if (this.ctx === g) this.ctx = null;
    this.storeGuest(g);
    this.guests.delete(g.id);
    s.netPlayers = s.netPlayers.filter((p) => p !== g.player);
    g.player.destroy();
    g.label.destroy();
    const voluntary = reason === 'peer-left' || reason === 'manual' || reason === 'host-closed';
    if (!this.closed) {
      netLog('host', 'guest-lost', `${g.name}: ${reasonText(reason)}`);
      if (!voluntary) {
        this.drops = this.drops || {};
        this.drops[g.name] = (this.drops[g.name] || 0) + 1;
        this.lastDrop = { name: g.name, reason, at: Date.now() };
        this.held.set(g.name, { sid: g.sid, t: Date.now() });
      }
      s.hud.toast(voluntary ? `${g.name} ayrıldı` : `${g.name} bağlantısı koptu (${reasonText(reason).split(':')[0]}); 60 sn içinde dönerse kaldığı yerden devam eder`, 'warn');
    }
    this.broadcast({ t: 'toast', m: voluntary ? `${g.name} ayrıldı` : `${g.name} bağlantısı koptu, bekleniyor…`, ty: 'warn' });
    this.refreshRoster();
  }

  storeGuest(g) {
    const p = g.player, fs = {};
    for (const f of features) {
      if (!f.playerState || !g.fstate?.[f.id]) continue;
      try { fs[f.id] = f.playerState.save(g.fstate[f.id]); } catch (e) { console.warn(f.id, e); }
    }
    const pos = p.alive ? { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, t: Date.now() } : null;
    this.scene.netGuestStore[g.name] = { inv: g.inv.serialize(), coins: p.coins, hp: Math.max(1, Math.round(p.hp)), energy: Math.round(p.energy), selected: g.selected, fs, pos };
  }

  // Oyuncu başına özellik durumları (yetenek ağacı, silah seviyeleri, güçlendirmeler): kayıttan ya da sıfırdan
  initGuestState(g, saved) {
    const s = this.scene;
    g.fstate = {};
    for (const f of features) {
      if (!f.playerState) continue;
      try {
        const d = saved?.fs?.[f.id];
        g.fstate[f.id] = d != null ? f.playerState.load(s, d) : f.playerState.fresh(s);
      } catch (e) { console.warn(f.id, e); g.fstate[f.id] = f.playerState.fresh(s); }
    }
    // Kalıcı etkileri (ör. +20 can yeteneği) misafirin karakterine uygula
    this.withGuest(g, () => features.forEach((f) => { try { f.playerState?.apply?.(s); } catch (e) { console.warn(f.id, e); } }));
  }

  // fn'i her misafirin bağlamında bir kez çalıştır (ör. dalga sonu XP'si herkese)
  eachGuest(fn) { for (const g of [...this.guests.values()]) this.withGuest(g, fn); }

  guestOf(p) {
    for (const g of this.guests.values()) if (g.player === p) return g;
    return null;
  }

  // fn'i p oyuncusunun bağlamında çalıştır (ör. misafirin mermisiyle ölen zombinin ödülü/XP'si misafire)
  asPlayer(p, fn) {
    const g = p && p.netRemote ? this.guestOf(p) : null;
    return g ? this.withGuest(g, fn) : fn();
  }

  // ---------------- Takım arkadaşına eşya / para verme ----------------
  // Host otoriter: misafirin "Ver" tıklaması 'ui' click olarak gelir ve burada misafir bağlamında çalışır;
  // veren = o anki bağlam (s.player / s.inventory). Envanter değişiklikleri mevcut 'me' akışıyla gider.
  teammates() {
    const me = this.ctx, out = [];
    if (me) out.push({ id: 'h', name: this.name, color: PLAYER_COLORS[0] });
    for (const g of this.guests.values()) if (g !== me) out.push({ id: g.id, name: g.name, color: g.color });
    return out;
  }

  mate(id) {
    if (id === 'h') return this.ctx ? { name: this.name, player: this.scene.netHostPlayer, inv: this.hostInv, g: null } : null;
    const g = this.guests.get(id);
    return g && g !== this.ctx ? { name: g.name, player: g.player, inv: g.inv, g } : null;
  }

  // Alıcıya bildirim: misafirse doğrudan mesaj; host ise bağlam bittikten sonra (toast/HUD takaslı olabilir)
  notifyMate(to, msg) {
    if (to.g) { this.send(to.g, { t: 'toast', m: msg, ty: 'ok' }); this.send(to.g, { t: 'sfx', l: ['coin'] }); return; }
    const s = this.scene;
    queueMicrotask(() => {
      if (this.closed || !s.hud) return;
      if (this.ctx) return; // (olası değil) hâlâ bir bağlamın içindeysek atla
      s.hud.toast(msg, 'ok');
      audio.sfx('coin');
      this.hostInv?.emit(); // dinleyiciler (hotbar, cephane, panel) misafir bağlamında yanlış envanteri gördü: host bağlamında yenile
    });
  }

  // Herkese toast: host ekranı + tüm misafirler (misafir bağlamında çağrılsa da; o anki hud.toast misafire yönlenir)
  toastAll(msg, ty = 'info') {
    const s = this.scene, m = String(msg);
    if (this.ctx) {
      this.ctx.out.push({ t: 'toast', m, ty });
      queueMicrotask(() => { if (!this.closed && s.hud) s.hud.toast(m, ty); });
    } else s.hud.toast(m, ty);
    for (const g of this.guests.values()) if (g !== this.ctx) this.send(g, { t: 'toast', m, ty });
  }

  giverName() { return this.ctx ? this.ctx.name : this.name; }

  giveItem(toId, idx, n) {
    const s = this.scene, inv = s.inventory, to = this.mate(toId);
    const it = Number.isInteger(idx) ? inv.slots[idx] : null;
    if (!to || !to.inv || to.inv === inv || !it || !ITEMS[it.id]) { s.hud.toast('Eşya verilemedi (oyuncu ayrılmış olabilir).', 'warn'); return 0; }
    n = Math.max(1, Math.min(it.count, Math.floor(+n) || 1));
    const id = it.id, name = ITEMS[id].name;
    const moved = n - to.inv.add(id, n); // alıcının çantası doluysa yalnızca sığan kadar
    if (moved <= 0) { s.hud.toast(`${to.name} adlı oyuncunun çantası dolu.`, 'warn'); return 0; }
    if (moved >= it.count) s.hud.pickedSlot = null;
    inv.removeAt(idx, moved);
    s.hud.toast(`🎁 ${to.name} oyuncusuna ${moved} ${name} verdin${moved < n ? ` (çantası doldu, ${n - moved} sende kaldı)` : ''}`, 'ok');
    this.notifyMate(to, `🎁 ${this.giverName()} sana ${moved} ${name} verdi`);
    return moved;
  }

  giveCoins(toId, n) {
    const s = this.scene, from = s.player, to = this.mate(toId);
    n = Math.min(Math.floor(+n) || 0, Math.floor(from?.coins || 0));
    if (!to || !to.player || to.player === from) { s.hud.toast('Para verilemedi (oyuncu ayrılmış olabilir).', 'warn'); return 0; }
    if (n <= 0) { s.hud.toast('Yeterli paran yok.', 'warn'); return 0; }
    from.coins -= n;
    to.player.coins += n;
    s.hud.toast(`🪙 ${to.name} oyuncusuna ${n} para verdin`, 'ok');
    this.notifyMate(to, `🪙 ${this.giverName()} sana ${n} para verdi`);
    // Panellerdeki para düğmeleri (yetersiz bakiye → pasif) yenilensin
    if (this.ctx) this.ctx.uiInvDirty = true; else s.hud.refreshInventory();
    if (to.g) to.g.uiInvDirty = true;
    return n;
  }

  // Konumlu ekran sarsıntısı: yakındaki misafirlerin kamerası da sarsılsın
  shakeAt(x, y, range, dur, intensity) {
    for (const g of this.guests.values()) {
      const p = g.player;
      if (Phaser.Math.Distance.Between(x, y, p.x, p.y) < range) g.out.push({ t: 'shake', d: dur, i: intensity });
    }
  }

  // Oyun yeniden başlarken oda kapanmasın: kod korunur, misafirler yeniden bağlanır
  detachRoom() {
    if (!this.handle) return null;
    this.keepRoom = true;
    return this.handle;
  }

  // Kayıttan önce bağlı misafirlerin güncel verisini depoya yaz
  syncStore() { for (const g of this.guests.values()) this.storeGuest(g); }

  send(g, m) { g.conn.send(m); }

  broadcast(m, except) { for (const g of this.guests.values()) if (g !== except) g.conn.send(m); }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopPing?.();
    document.removeEventListener('visibilitychange', this.onVis);
    window.removeEventListener('pagehide', this.onPageHide, true);
    this.unhook?.();
    this.broadcast(this.keepRoom ? { t: 'restart' } : { t: 'bye' });
    for (const g of [...this.guests.values()]) g.conn.close('host-closed');
    if (!this.keepRoom) setTimeout(() => this.handle?.close(), 300);
    this.panel.destroy();
  }

  heartbeat() {
    const now = performance.now();
    for (const g of [...this.guests.values()]) {
      const limit = g.hidden ? SILENT_HIDDEN_MS : SILENT_MS;
      if (now - g.lastSeen > limit) { g.conn.close(g.hidden ? 'peer-hidden' : 'ping-timeout'); this.removeGuest(g, g.hidden ? 'peer-hidden' : 'ping-timeout'); continue; }
      this.send(g, { t: 'ping', c: now });
    }
    for (const [n, h] of this.held) if (Date.now() - h.t > HOLD_MS) this.held.delete(n);
    if (this.code && (!this.roomSavedAt || now - this.roomSavedAt > 30000)) { this.roomSavedAt = now; saveRoomCode(this.code); }
    if (this.handle) this.statusLine();
    this.refreshRoster();
  }

  rosterList() {
    return [{ id: 'h', name: this.name, color: PLAYER_COLORS[0], ping: 0, host: true, gender: this.scene.player?.gender || 'm' },
      ...[...this.guests.values()].map((g) => ({ id: g.id, name: g.name, color: g.color, ping: Math.round(g.ping), gender: g.gender || 'm' }))];
  }

  refreshRoster() {
    const list = this.rosterList();
    this.panel.setRoster(list.map((x) => ({ ...x, me: x.host })));
    if (this.guests.size) this.broadcast({ t: 'roster', l: list });
  }

  // ---------------- Misafir mesajları ----------------
  onMsg(g, m) {
    const s = this.scene, p = g.player;
    switch (m.t) {
      case 'mv': {
        if (m.tp !== p.netTp || !p.alive) return;
        if (m.q != null) { if (m.q <= (g.mvQ || 0)) return; g.mvQ = m.q; } // hızlı kanal: eski paket
        const nx = Phaser.Math.Clamp(+m.x || 0, 4, Math.max(MAP_W * TILE, s.physics.world.bounds.right) - 4); // keşif bölgeleri harita dışında
        const ny = Phaser.Math.Clamp(+m.y || 0, 4, Math.max(MAP_H * TILE, s.physics.world.bounds.bottom) - 4);
        g.flip = !!m.f; g.moving = !!m.m; g.angle = +m.a || 0;
        if (!this.validMove(g, nx, ny)) return;
        g.tx = nx; g.ty = ny;
        s.netMoveCheck?.(g); // zones: orman şeridi / kilitli bölge doğrulaması (gerekirse ışınlayıp düzeltir)
        return;
      }
      case 'use':
        if (Number.isInteger(m.s)) g.selected = m.s;
        if (!s.started || s.gameOver) return;
        // Host'taki bekleme süresi (ör. kılıç 0.35 sn) misafirin yerel tahmininden uzunsa tık kaybolmasın: kısa tampon
        if (p.actionCd > 0) { g.pendingUse = { m, left: 0.6 }; return; } // oyun zamanı (düşük FPS'de de tutarlı)
        this.applyUse(g, m);
        return;
      case 'int':
        if (Number.isInteger(m.s)) g.selected = m.s;
        if (!p.alive) return;
        this.withGuest(g, () => s.bestInteraction()?.run());
        return;
      case 'sel':
        if (Number.isInteger(m.s) && m.s >= 0 && m.s < g.inv.slots.length) g.selected = m.s;
        return;
      case 'dodge':
        this.withGuest(g, () => p.dodge());
        return;
      case 'reload':
        this.withGuest(g, () => s.combat?.reload?.());
        return;
      case 'ui':
        this.onUi(g, m);
        return;
      case 'rsync':
        this.onResync(g, m);
        return;
      case 'ping':
        this.send(g, { t: 'pong', c: m.c });
        return;
      case 'pong':
        g.ping = performance.now() - (+m.c || 0);
        return;
      case 'bye':
        g.conn.close('peer-left');
        return;
      case 'vis': // misafir sekmesi arka plana geçti / döndü: zaman aşımı eşiği buna göre
        g.hidden = !!m.h;
        netLog('host', m.h ? 'peer-hidden' : 'peer-visible', g.name);
        if (m.h) s.hud.toast(`${g.name} sekmeyi arka plana aldı`, 'info');
        return;
      default:
        // Özellik modüllerinin misafir istekleri (ör. balık tutma sonucu): misafir bağlamında
        this.withGuest(g, () => s.events.emit('netGuestMsg', m, g));
    }
  }

  applyUse(g, m) {
    const s = this.scene, p = g.player;
    g.pendingUse = null;
    p.netCharge = m.ch != null ? Phaser.Math.Clamp(+m.ch || 0, 0, 1) : null; // yay germe oranı (misafirde ölçülür)
    this.withGuest(g, () => useSelected(s, +m.x, +m.y));
    p.netCharge = null;
  }

  // İstemci-otoriter hareket doğrulaması: hız bütçesi (ışınlanma/hız hilesi) + katı engel içine girme.
  // İhlalde host'un bildiği son geçerli konuma ışınlayıp misafire düzeltme gönderir.
  validMove(g, x, y) {
    const s = this.scene, p = g.player, now = performance.now();
    const dt = Math.min(1.5, Math.max(0, (now - (g.mvAt || now)) / 1000));
    g.mvAt = now;
    const speed = PLAYER_STATS.speed * (1 + (p.buffSpeed || 0)) * MOVE_SLACK;
    g.mvBudget = Math.min(MOVE_BURST, (g.mvBudget ?? MOVE_BURST) + speed * dt);
    const dist = Math.hypot(x - g.tx, y - g.ty);
    if (dist > g.mvBudget) { this.correct(g, 'hız'); return false; }
    g.mvBudget -= dist;
    // Katı engel: yeni konum engelin içinde, eskisi değilse reddet (birkaç kez üst üste olursa düzelt)
    if (dist > 0.01 && this.blocked(x, y) && !this.blocked(g.tx, g.ty)) {
      g.wallHits = (g.wallHits || 0) + 1;
      if (g.wallHits >= 4) this.correct(g, 'duvar');
      return false;
    }
    g.wallHits = 0;
    return true;
  }

  // Oyuncu gövdesi (8x6, ayak hizası) bu konumda oyuncuyu durduran bir statik gövdeyle çakışıyor mu?
  blocked(x, y) {
    const s = this.scene;
    const bodies = s.physics.overlapRect(x - 4, y + 2, 8, 6, false, true);
    for (const b of bodies) if (b.gameObject && this.playerSolid(b.gameObject)) return true;
    return false;
  }

  // Oyuncuyu durduran statik gövde mi? (host doğrulaması ve misafirin yerel çarpışması aynı kural)
  // Özellik engelleri de dahil: ağıl çiti/ahır (ranch.solids), olay kayaları (mapEvents.solids), fıskiye/korkuluk
  // (farmBlockers; görünmez bölge → görünen sprite'ın netSolid'i), savunma yapıları (blocksPlayer).
  playerSolid(o) {
    const s = this.scene, src = o.netSolid || o, b = src.body;
    if (!b || !b.enable || o.depleted || o.blocksPlayer === false) return false;
    return !!(s.obstacles?.contains(o) || s.resources?.contains(o) || o === s.shelter || s.barricades?.contains(o) || s.turrets?.contains(o) || o.blocksPlayer
      || s.ranch?.solids?.contains?.(o) || s.mapEvents?.solids?.contains?.(o) || s.farmBlockers?.contains?.(src));
  }

  // Host otoritesiyle misafiri ışınla (bölge geçişi, test, kurtarma)
  teleport(g, x, y) {
    const p = g.player;
    p.setPosition(x, y);
    g.tx = x; g.ty = y; g.mvBudget = MOVE_BURST;
    p.netTp++;
    this.sendMe(g, true);
  }

  correct(g, why) {
    const p = g.player;
    g.wallHits = 0;
    g.mvBudget = MOVE_BURST;
    g.corrections = (g.corrections || 0) + 1;
    p.setPosition(g.tx, g.ty);
    p.netTp++;
    this.sendMe(g, true);
    if (why) console.info(`[net] ${g.name} konumu düzeltildi (${why})`);
  }

  onUi(g, m) {
    const s = this.scene;
    if (m.op === 'inv') this.withGuest(g, () => s.hud.toggleInventory());
    else if (m.op === 'menu') {
      const entry = s.featureMenu.find((x) => x.id === m.id);
      if (entry) this.withGuest(g, () => entry.open(s));
    } else if (m.op === 'click') {
      const key = MODAL_EL[g.hud.modal];
      if (!key || g.hud.modal !== m.m) return;
      const node = byPath(g.hud.e[key], m.p);
      if (node) this.withGuest(g, () => node.click());
    } else if (m.op === 'input') {
      // Uzak paneldeki giriş/kaydırıcı değeri: host'taki kopyaya yaz ve olayları tetikle
      const key = MODAL_EL[g.hud.modal];
      if (!key || g.hud.modal !== m.m) return;
      const node = byPath(g.hud.e[key], m.p);
      if (!node || !('value' in node)) return;
      this.withGuest(g, () => {
        if (node.type === 'checkbox' || node.type === 'radio') node.checked = !!m.c;
        else node.value = String(m.v ?? '').slice(0, 200);
        node.dispatchEvent(new Event('input', { bubbles: true }));
        if (m.ch) node.dispatchEvent(new Event('change', { bubbles: true }));
      });
    } else if (m.op === 'close') {
      g.uiModal = null; // misafir zaten kapattı; geri bildirim gönderme
      this.withGuest(g, () => s.hud.closeAll());
      g.uiModal = null;
    }
  }

  // ---------------- Bağlam takası ----------------
  makeHudState() {
    const real = this.scene.hud.e;
    const clone = (node) => { const c = node.cloneNode(true); c.classList.remove('show'); c.removeAttribute('id'); return c; };
    const e = {};
    for (const k of Object.keys(real)) e[k] = document.createElement('div');
    e.inv = clone(real.inv);
    e.invGrid = e.inv.querySelector('#inv-grid');
    e.craftList = e.inv.querySelector('#craft-list');
    e.invInfo = e.inv.querySelector('#inv-info');
    e.dialog = clone(real.dialog);
    e.shop = clone(real.shop);
    e.feature = clone(real.feature);
    // Kopyalar olay dinleyicilerini taşımaz: özellikler kendi sabit düğmelerini bağlar
    features.forEach((f) => { try { f.netCloneHud?.(this.scene, e); } catch (err) { console.warn(f.id, err); } });
    return { e, modal: null, modalName: null, npc: null, shopTab: 'buy', pickedSlot: null, craftTab: undefined, onPanelClose: null, lastNotice: null, lastNoticeAt: 0 };
  }

  hudOverrides(g) {
    return {
      open(name) {
        this.closeAll(true);
        this.modal = name; this.modalName = name;
        this.e[MODAL_EL[name] || name]?.classList.add('show');
      },
      closeAll() {
        ['inv', 'dialog', 'shop', 'feature'].forEach((k) => this.e[k]?.classList.remove('show'));
        if (this.onPanelClose) { const fn = this.onPanelClose; this.onPanelClose = null; try { fn(); } catch (err) { console.warn(err); } }
        this.modal = null; this.pickedSlot = null;
      },
      toast: (msg, ty) => g.out.push({ t: 'toast', m: String(msg), ty: ty || 'info' }),
      notice: (msg) => g.out.push({ t: 'notice', m: String(msg) }),
      banner: (a, b) => g.out.push({ t: 'banner', a, b }),
      renderHotbar() {}, renderQuests() {}, update() {}, hint() {}, showTip() {}, hideTip() {}, centerSelected() {}, buildHotbar() {}
    };
  }

  // fn'i misafir g adına çalıştır: oyun kodu scene.player/inventory/selected/hud üzerinden misafiri görür
  // İç içe çağrılabilir (ör. misafir A'nın eylemi misafir B'nin ödülünü tetikler): önceki bağlam yığın gibi geri gelir.
  withGuest(g, fn) {
    if (this.ctx === g) return fn();
    if (!this.guests.has(g.id)) return undefined;
    const prevCtx = this.ctx;
    const s = this.scene, hud = s.hud;
    const saved = { player: s.player, inventory: s.inventory, selected: s.selected };
    s.player = g.player; s.inventory = g.inv; s.selected = g.selected;
    // Oyuncu başına özellik durumlarını takas et
    const swaps = [];
    if (g.fstate) for (const f of features) {
      const ps = f.playerState;
      if (!ps || !g.fstate[f.id]) continue;
      try { swaps.push([ps, ps.get(s), f.id]); ps.set(s, g.fstate[f.id]); } catch (e) { console.warn(f.id, e); }
    }
    const hudSaved = {};
    HUD_FIELDS.forEach((k) => { hudSaved[k] = hud[k]; hud[k] = g.hud[k]; });
    const undo = Object.entries(g.over || (g.over = this.hudOverrides(g))).map(([k, v]) => patch(hud, k, v));
    undo.push(patch(audio, 'sfx', (n) => { g.sfx.push(n); }));
    undo.push(patch(audio, 'tone', () => {}));
    undo.push(patch(audio, 'noise', () => {}));
    const cam = s.cameras.main;
    undo.push(patch(cam, 'shake', () => cam));
    this.ctx = g;
    try { return fn(); }
    catch (e) { console.warn('Misafir eylemi hata verdi', e); return undefined; }
    finally {
      this.ctx = prevCtx;
      g.selected = s.selected;
      HUD_FIELDS.forEach((k) => { g.hud[k] = hud[k]; hud[k] = hudSaved[k]; });
      undo.reverse().forEach((u) => u());
      // Misafirin (değişmiş olabilecek) durumunu sakla, host'unkini geri koy
      for (const [ps, v, id] of swaps.reverse()) { try { g.fstate[id] = ps.get(s); ps.set(s, v); } catch (e) { console.warn(e); } }
      s.player = saved.player; s.inventory = saved.inventory; s.selected = saved.selected;
      this.flush(g);
    }
  }

  // Bağlam sonrası: uzak panel, sesler, bildirimler
  flush(g) {
    const st = g.hud;
    if (st.modal) {
      const node = st.e[MODAL_EL[st.modal]];
      const h = node ? packIcons(node.innerHTML, iconCacheEntries()) : '';
      if (h !== g.uiHtml || st.modal !== g.uiModal) { g.uiHtml = h; g.uiModal = st.modal; this.send(g, { t: 'ui', m: st.modal, h }); }
    } else if (g.uiModal) {
      g.uiModal = null; g.uiHtml = '';
      this.send(g, { t: 'ui', m: null });
    }
    if (g.sfx.length) { this.send(g, { t: 'sfx', l: [...new Set(g.sfx)].slice(0, 6) }); g.sfx.length = 0; }
    if (g.out.length) { g.out.forEach((m) => this.send(g, m)); g.out.length = 0; }
  }

  // ---------------- Kare güncellemesi ----------------
  // Ağ güncellemesindeki bir istisna oyun döngüsünü öldürmesin (Phaser rAF döngüsü istisnada durur)
  update(dt) {
    try { this.updateInner(dt); } catch (e) {
      console.warn('Ağ güncellemesi hata verdi', e);
      const now = performance.now();
      if (!this.updErrAt || now - this.updErrAt > 5000) { this.updErrAt = now; netLog('host', 'handler-error', `update: ${e?.message || e}`); }
    }
  }

  updateInner(dt) {
    for (const g of this.guests.values()) { try { this.tickGuest(g, dt); } catch (e) { console.warn('tickGuest', g.name, e); } }
    if (this.hist) this.recordHistory();
    if (!this.guests.size) return;
    this.snapT -= dt;
    if (this.snapT <= 0) {
      this.snapT = SNAP_DT;
      this.sendSnapshot();
      // Özet hemen anlık görüntünün ardından (aynı sıralı kanalda): misafir onu aldığında bu ana kadarki tüm farkları
      // uygulamış olur → iki tarafın özeti birebir aynı olmalı
      this.digestT -= SNAP_DT;
      if (this.digestT <= 0) { this.digestT = this.digestDt; this.sendDigest(); }
    }
    this.fastT -= dt;
    if (this.fastT <= 0) { this.fastT = FAST_DT; this.sendFast(); }
    this.fsT -= dt;
    if (this.fsT <= 0) { this.fsT = FS_DT; this.sendFeatureState(); }
    this.slowT -= dt;
    if (this.slowT <= 0) {
      this.slowT = 1;
      // Görev listesi misafir bağlamında: "teslim et" ilerlemesi misafirin kendi envanterinden
      for (const g of this.guests.values()) {
        const q = this.withGuest(g, () => this.questList()) || [], key = JSON.stringify(q);
        if (key !== g.lastQuests) { g.lastQuests = key; this.send(g, { t: 'quests', l: q }); }
      }
    }
  }

  // Ortak (netState) ve oyuncuya özel (netPlayerState) özellik HUD durumları
  featureStates() {
    const s = this.scene, out = {};
    for (const f of features) {
      if (!f.netState) continue;
      try { const v = f.netState(s); if (v !== undefined) out[f.id] = v; } catch (e) { console.warn(f.id, e); }
    }
    return out;
  }

  sendFeatureState() {
    const fs = this.featureStates(), key = JSON.stringify(fs);
    if (key !== this.lastFs) { this.lastFs = key; this.fsState = fs; this.broadcast({ t: 'fs', s: fs }); }
    for (const g of this.guests.values()) {
      g.pfs = this.withGuest(g, () => {
        const out = {};
        for (const f of features) {
          if (!f.netPlayerState) continue;
          try { const v = f.netPlayerState(this.scene); if (v !== undefined) out[f.id] = v; } catch (e) { console.warn(f.id, e); }
        }
        return out;
      });
    }
  }

  // Hızlı akış: hareket eden nesnelerin konumları + oyuncular + ışıklar, host zaman damgasıyla
  sendFast() {
    const m = { t: 'f', q: ++this.fastSeq, ht: Math.round(performance.now()), p: this.mirror.positions(), pl: this.playersList() };
    const L = this.lightsList();
    if (L) m.L = L;
    for (const g of this.guests.values()) g.conn.sendFast(m);
  }

  // ---------------- Test / ölçüm ----------------
  // Kare başına host konumları (yalnızca hist açıkken): misafirin enterpolasyon hatasını ölçmek için
  recordHistory() {
    const t = performance.now(), pos = {};
    for (const o of this.scene.children.list) if (o.__nid && o.visible) pos[o.__nid] = [o.x, o.y];
    for (const g of this.guests.values()) pos[g.id] = [g.player.x, g.player.y];
    const h = this.scene.netHostPlayer;
    if (h) pos.h = [h.x, h.y];
    this.hist.push([t, pos]);
    if (this.hist.length > 1500) this.hist.shift();
  }

  // Dünya durumu özeti (iki tarafta aynı olmalı): görünür aynalanan nesnelerin doku histogramı, tarla, kaynaklar…
  syncSummary() {
    const s = this.scene, tex = {};
    for (const o of s.children.list) {
      if ((o.type !== 'Image' && o.type !== 'Sprite') || this.skip(o) || !o.visible || o.alpha < 0.01) continue;
      const k = o.texture?.key || '?';
      tex[k] = (tex[k] || 0) + 1;
    }
    const plots = [...s.farm.plots.values()].map((p) => this.plotRec(p).join(':')).sort();
    return {
      tex, plots: plots.length, farm: plots.join(';'), res: this.resList().join(','),
      day: s.timeSys.day, min: Math.floor(s.timeSys.minutes), wave: s.waves.wave, active: !!s.waves.active, shelter: Math.round(s.shelter.hp),
      players: 1 + this.guests.size,
      zones: Object.entries(s.zones?.state || {}).filter(([, v]) => v?.open).map(([k]) => k).sort().join(',')
    };
  }

  tickGuest(g, dt) {
    const p = g.player, s = this.scene;
    p.invuln = Math.max(0, p.invuln - dt);
    p.actionCd = Math.max(0, p.actionCd - dt);
    p.rollCd = Math.max(0, p.rollCd - dt);
    if (p.rollT > 0) p.rollT = Math.max(0, p.rollT - dt);
    p.setVelocity(0, 0);
    if (p.alive) {
      const k = Math.min(1, dt * 15);
      const dx = g.tx - p.x, dy = g.ty - p.y;
      if (Math.abs(dx) + Math.abs(dy) > 64) p.setPosition(g.tx, g.ty);
      else if (dx || dy) p.setPosition(p.x + dx * k, p.y + dy * k);
      p.setFlipX(g.flip);
      if (p.rollT <= 0) p.setAngle(g.angle);
      p.walk(g.moving);
    }
    if (!p.isTinted) p.setTint(g.color);
    g.label.setPosition(p.x, p.y - 10).setVisible(p.visible);
    if (g.pendingUse) {
      g.pendingUse.left -= dt;
      if (g.pendingUse.left <= 0 || !p.alive) g.pendingUse = null;
      else if (p.actionCd <= 0) this.applyUse(g, g.pendingUse.m);
    }
    // Misafirin hareket/kaçış dışı "can yenileme" gibi kare başı kişisel etkileri
    if (g.fstate && this.hasTick) this.withGuest(g, () => features.forEach((f) => { if (f.playerState?.tick) f.playerState.tick(s, dt); }));
    if (p.cbState && (p.cbState.reload > 0 || p.cbState.bloom > 0)) this.withGuest(g, () => s.combat?.tickPlayer?.(dt));
    if (g.uiInvDirty && (g.hud.modal === 'inventory' || g.hud.modal === 'shop')) {
      g.uiInvDirty = false;
      this.withGuest(g, () => s.hud.refreshInventory());
    }
    g.hintT -= dt;
    if (g.hintT <= 0) {
      g.hintT = 0.25;
      g.hint = (p.alive && this.withGuest(g, () => s.bestInteraction())?.label) || '';
    }
  }

  onRemoteDied(p) {
    const g = [...this.guests.values()].find((x) => x.player === p);
    if (!g) return;
    const s = this.scene;
    const lost = Math.floor(p.coins * 0.2);
    p.coins -= lost;
    g.out.push({ t: 'toast', m: `Bayıldın! ${lost} 🪙 kaybettin. Sığınakta uyanacaksın…`, ty: 'warn' });
    g.out.push({ t: 'sfx', l: ['die'] });
    this.flush(g);
    s.hud.toast(`${g.name} bayıldı!`, 'warn');
    s.time.delayedCall(3000, () => {
      if (s.gameOver || !this.guests.has(g.id)) return;
      p.respawn(s.shelter.door.x, s.shelter.door.y + 8);
      p.netTp++;
      g.tx = p.x; g.ty = p.y; g.angle = 0;
      this.sendMe(g, true);
    });
  }

  // ---------------- Anlık görüntü ----------------
  playersList() {
    const s = this.scene, h = s.netHostPlayer || s.player;
    const row = (id, p) => [id, r1(p.x), r1(p.y), p.flipX ? 1 : 0, p.body && (p.body.velocity.x || p.body.velocity.y) ? 1 : 0, Math.round(p.angle), p.alive ? 1 : 0];
    return [row('h', h), ...[...this.guests.values()].map((g) => [g.id, r1(g.player.x), r1(g.player.y), g.flip ? 1 : 0, g.moving ? 1 : 0, Math.round(g.player.angle), g.player.alive ? 1 : 0])];
  }

  lightsList() {
    // Oyuncu ışıkları hariç: misafir onları enterpole edilmiş avatar konumlarında kendisi çizer
    const s = this.scene;
    if (s.timeSys.darkness <= 0.02) return null;
    const out = [];
    const add = (x, y, r) => out.push(Math.round(x), Math.round(y), Math.round(r));
    s.turrets.getChildren().forEach((t) => add(t.x, t.y, 34));
    s.npcs.forEach((n) => { if (!n.hidden && n.key === 'guard') add(n.x, n.y, 45); });
    s.bullets.getChildren().forEach((b) => add(b.x, b.y, 14));
    s.lightSources.forEach((fn) => { if (fn.netPlayers) return; try { (fn(s) || []).forEach((l) => add(l.x, l.y, l.r)); } catch { /* yok say */ } });
    return out;
  }

  plotRec(p) {
    const c = p.crop;
    return [p.tx, p.ty, p.watered ? 1 : 0, p.fert || 0, p.dryDays || 0, c ? c.type : '', c ? c.stage : 0, c?.dead ? 1 : 0];
  }

  farmDiff(full) {
    const plots = this.scene.farm.plots, add = [], del = [];
    const seen = new Set();
    for (const [key, p] of plots) {
      seen.add(key);
      const rec = this.plotRec(p), sig = rec.join('|');
      if (full || this.farmSig.get(key) !== sig) { add.push(rec); this.farmSig.set(key, sig); this.farmRecs.set(key, rec); }
    }
    if (!full) for (const key of [...this.farmSig.keys()]) if (!seen.has(key)) { del.push(key); this.farmSig.delete(key); this.farmRecs.delete(key); }
    return { add, del };
  }

  resList() {
    const out = [];
    this.scene.resources.getChildren().forEach((r, i) => { if (r.depleted) out.push(i); });
    return out;
  }

  // ---------------- Kendini onaran eşitleme ----------------
  // Kaynak durumu (tükenmiş = 1) bit kümesi olarak her özette TAM gider (~60 krk): misafir doğrudan uygular.
  // Aynalanan nesneler, tarla, ortak özellik durumu ve envanter için yalnızca özet gider; misafir kendi hesapladığıyla
  // uyuşmazsa 'rsync' ile o bölümün tamamını ister (onResync). Bant genişliği: ~150 bayt / 5 sn / misafir.
  resBits() {
    const list = this.scene.resources.getChildren();
    return { r: packBits(list.map((r) => !!r.depleted)), rn: list.length };
  }

  farmDigest() { return setHash(this.farmSig.values()); }

  sendDigest() {
    const base = { t: 'dg', ...this.resBits(), m: this.mirror.digest(), f: this.farmDigest(), s: this.lastFs ? hashStr(this.lastFs) : 0 };
    for (const g of this.guests.values()) {
      if (g.invDirty) this.sendMe(g); // envanter özeti gönderilmiş durumu anlatsın
      this.send(g, { ...base, i: hashStr(invSig(g.inv)) });
    }
  }

  onResync(g, m) {
    const now = performance.now();
    if (g.rsyncAt && now - g.rsyncAt < RSYNC_MIN * 1000) return;
    g.rsyncAt = now;
    this.heals.req++;
    const parts = [];
    // Yanıt, şimdiye kadar gönderilmiş (ve sıralı kanalda bundan önce teslim edilecek) durumun tamamı
    if (m.m) { this.send(g, { t: 'rso', o: this.mirror.full(), ht: Math.round(performance.now()) }); this.heals.m++; parts.push('nesne'); }
    if (m.f) { this.send(g, { t: 'rsf', fa: [...this.farmRecs.values()] }); this.heals.f++; parts.push('tarla'); }
    if (m.s && this.lastFs) { this.send(g, { t: 'fs', s: JSON.parse(this.lastFs) }); this.heals.s++; parts.push('özellik'); }
    if (m.i) { g.invDirty = true; this.sendMe(g); this.heals.i++; parts.push('envanter'); }
    if (parts.length) netLog('host', 'resync', `${g.name}: ${parts.join(', ')}`);
  }

  common() {
    const s = this.scene, t = s.timeSys;
    return {
      tm: [r1(t.minutes), t.day, Math.round((t.weatherDim || 0) * 100) / 100],
      wv: [s.waves.wave, s.waves.active ? 1 : 0, s.waves.remaining],
      sh: [Math.round(s.shelter.hp), s.shelter.maxHp]
    };
  }

  resetBaseline() {
    this.mirror.prev.clear();
    this.mirror.pos.clear();
    this.farmSig.clear();
    this.farmRecs.clear();
    this.mirror.diff();
    this.farmDiff(false);
    this.resKey = this.resList().join(',');
  }

  fullSnapshot() {
    const f = this.farmDiff(true);
    return { ...this.common(), pl: this.playersList(), o: this.mirror.full(), fa: f.add, rs: this.resList(), fs: this.featureStates() };
  }

  sendSnapshot() {
    const d = this.mirror.diff();
    const f = this.farmDiff(false);
    const snap = { t: 's', ...this.common() };
    if (d.o) snap.o = d.o;
    if (d.x) snap.x = d.x;
    if (f.add.length) snap.fa = f.add;
    if (f.del.length) snap.fd = f.del;
    const res = this.resList(), rk = res.join(',');
    if (rk !== this.resKey) { this.resKey = rk; snap.rs = res; }
    if (this.fxq.length) { snap.fx = this.fxq; this.fxq = []; }
    this.broadcast(snap);
    for (const g of this.guests.values()) { this.sendMe(g); this.flush(g); }
  }

  sendMe(g, force) {
    const p = g.player;
    const me = { t: 'me', hp: r1(Math.max(0, p.hp)), mhp: p.maxHp, en: r1(p.energy), men: p.maxEnergy, c: p.coins, al: p.alive ? 1 : 0, tp: p.netTp, h: g.hint };
    if (p.netTp !== g.sentTp || force) { me.px = r1(p.x); me.py = r1(p.y); g.sentTp = p.netTp; }
    if (g.invDirty || force) { me.inv = g.inv.serialize(); g.invDirty = false; }
    if (g.pfs) me.fs = g.pfs;
    const key = JSON.stringify(me);
    if (key === g.lastMe && !force) return;
    g.lastMe = key;
    this.send(g, me);
  }

  questList() {
    try { return this.scene.quests.activeList().map((q) => ({ title: q.title, desc: q.desc, progress: q.progress, amount: q.amount })); } catch { return []; }
  }

  gameOver(stats) {
    this.broadcast({ t: 'over', stats });
  }

  inviteLink() { return this.code ? inviteLink(this.code) : ''; }
}
