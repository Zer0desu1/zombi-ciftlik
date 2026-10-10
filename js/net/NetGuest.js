// Misafir oturumu: dünya aynı tohumla yerelde kurulur ama simülasyon çalışmaz. Host'tan gelen anlık
// görüntülerle görsel vekiller güncellenir; kendi karakteri yerelde anında hareket eder (konumu host'a
// bildirir), eylemler (kullan, etkileşim, yuvarlanma, paneller) host'a istek olarak gider.
// Konumlar host zaman damgasıyla tamponlanır ve sabit bir oynatma gecikmesiyle enterpole edilir (bkz. mirror.js).
import { DIFFICULTIES, ITEMS } from '../config.js';
import { audio } from '../audio.js';
import { iconURL } from '../textures.js';
import { features } from '../features/index.js';
import { regrowResource, depleteResource } from '../systems/MapBuilder.js';
import { MirrorReader, Interp, NetClock } from './mirror.js';
import { joinRoom } from './transport.js';
import { PROTO } from './NetHost.js';
import { RoomPanel, unpackIcons, pathOf } from './NetUI.js';

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

export class NetGuest {
  static async join(scene, code, name) {
    const conn = await joinRoom(code);
    const g = new NetGuest(scene, conn, code, name);
    conn.send({ t: 'hello', name, v: PROTO });
    return g;
  }

  constructor(scene, conn, code, name) {
    this.isGuest = true;
    this.scene = scene;
    this.code = code;
    this.name = name;
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
    this.groanT = 3;
    this.charge = null;
    this.lastSeen = performance.now();
    this.attach(conn);
    this.pingTimer = setInterval(() => this.heartbeat(), 2000);
    scene.events.once('shutdown', () => this.close());
  }

  attach(conn) {
    this.conn = conn;
    conn.onData((m) => {
      this.lastSeen = performance.now();
      try { this.onMsg(m); } catch (e) { console.warn('Host mesajı işlenemedi', m?.t, e); }
    });
    conn.onClose(() => { if (this.conn === conn) this.onLost(); });
  }

  send(m) { this.conn?.send(m); }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    this.send({ t: 'bye' });
    this.conn?.close();
    this.panel?.destroy();
    this.chargeGfx?.destroy();
  }

  heartbeat() {
    if (this.closed) return;
    if (this.conn?.open && performance.now() - this.lastSeen > 12000) { this.conn.close(); return; }
    this.send({ t: 'ping', c: performance.now() });
  }

  // ---------------- Bağlantı kopması / yeniden bağlanma ----------------
  onLost() {
    if (this.closed || this.ended) return;
    if (!this.started) { this.onFail?.('Bağlantı koptu'); return; }
    this.panel?.setStatus('Bağlantı koptu, yeniden bağlanılıyor…', true);
    this.scene.hud.toast('Host ile bağlantı koptu, yeniden bağlanılıyor…', 'warn');
    this.retries = 0;
    this.retry();
  }

  retry() {
    if (this.closed) return;
    if (this.retries++ >= 6) {
      this.panel?.setStatus('Bağlantı kurulamadı. Sayfayı yenileyip tekrar katıl.', true);
      this.scene.hud.toast('Host\'a yeniden bağlanılamadı.', 'warn');
      return;
    }
    joinRoom(this.code).then((conn) => {
      if (this.closed) { conn.close(); return; }
      this.attach(conn);
      this.lastSeen = performance.now();
      conn.send({ t: 'hello', name: this.name, v: PROTO });
    }).catch(() => { this.retryTimer = setTimeout(() => this.retry(), 2500); });
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
      case 'fs': if (this.started) this.applyFeatureState(m.s); return;
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
      case 'full': this.ended = true; this.onFail?.('Oda dolu (en fazla 4 oyuncu)'); this.conn.close(); return;
      case 'over': this.onOver(m.stats); return;
      case 'restart':
        // Host yeni oyun başlattı: oda kodu aynı, otomatik yeniden katıl
        this.ended = true;
        s.hud.toast('Host yeni oyun başlattı, odaya yeniden katılıyorsun…', 'info');
        s.time.delayedCall(400, () => this.rejoin());
        return;
      case 'bye':
        this.ended = true;
        if (this.started) { this.panel?.setStatus('Host odayı kapattı.', true); s.hud.toast('Host odayı kapattı.', 'warn'); }
        else this.onFail?.('Host odayı kapattı');
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
    if (!this.started) this.start(w);
    else {
      // Yeniden bağlanma: tüm vekilleri sıfırla
      this.mirror.clear();
      for (const a of this.avatars.values()) this.destroyAvatar(a);
      this.avatars.clear();
      this.panel.setStatus('');
      s.hud.toast('Yeniden bağlandın ✔', 'ok');
    }
    s.player.setPosition(w.x, w.y);
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
    for (const r of list) { const a = this.avatars.get(r.id); if (a && a.label.text !== r.name) a.label.setText(r.name); }
  }

  // ---------------- Anlık görüntü uygulama ----------------
  applySnap(d) {
    const s = this.scene;
    this.mirror.apply(d.o, d.x, this.rt ?? 0);
    if (d.pl) this.applyPlayers(d.pl, null);
    if (d.tm) {
      const t = s.timeSys;
      t.minutes = d.tm[0]; t.day = d.tm[1]; t.weatherDim = d.tm[2];
      t.wasNight = t.isNight;
      if (this.night !== t.isNight) { this.night = t.isNight; audio.setMusic(t.isNight ? 'night' : 'day'); }
    }
    if (d.wv) { s.waves.wave = d.wv[0]; s.waves.active = !!d.wv[1]; this.remaining = d.wv[2]; }
    if (d.sh) { s.shelter.hp = d.sh[0]; s.shelter.maxHp = d.sh[1]; }
    if (d.fa) for (const r of d.fa) this.applyPlot(r);
    if (d.fd) for (const key of d.fd) { const p = s.farm.plots.get(key); if (p) s.farm.removePlot(p); }
    if (d.rs) {
      const dep = new Set(d.rs);
      s.resources.getChildren().forEach((r, i) => {
        if (dep.has(i) && !r.depleted) depleteResource(r);
        else if (!dep.has(i) && r.depleted) regrowResource(r);
      });
    }
    if (d.fx) this.applyFx(d.fx);
    if (d.fs) this.applyFeatureState(d.fs);
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
    const spr = s.add.sprite(0, 0, 'player', 0);
    const shadow = s.add.image(0, 0, 'shadow');
    const r = this.roster?.find((x) => x.id === id);
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
      if (m && al) a.spr.play('player_walk', true); else { a.spr.anims.stop(); a.spr.setFrame(0); }
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
  update(dt) {
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
