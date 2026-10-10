// Dokunmatik kontroller: her zaman görünen joystick / D-pad, EYLEM / ETKİLEŞİM / çanta / menü butonları ve otomatik hedefleme.
import { TILE, ITEMS } from '../config.js';
import { useSelected, canPlace } from '../systems/PlayerActions.js';
import { audio } from '../audio.js';
import { el } from './dom.js';
import { vibrate, settings, onSettingsChange } from './mobileSettings.js';

const REACH = 40;      // PlayerActions ile aynı erişim
const JOY_R = 64;      // joystick taban yarıçapı (128px çap; gerçek değer CSS'ten ölçülür)
const DEAD = 0.18;     // ölü bölge (yarıçap oranı)
const FULL = 0.8;      // bu orandan sonra tam hız (başparmağı kenara itmek gerekmez)
const PAD_DEAD = 0.12; // D-pad merkezindeki boş bölge (genişlik oranı)
// Basılı tutunca yoklama aralığı: asıl hız actionCd ile sınırlanır, kısa aralık bekleme biter bitmez vurdurur
const REPEAT_MS = 50;
const MELEE_RANGE = 140, GUN_RANGE = 200;

// Nişan yardımı: 0 kapalı, 1 yumuşak, 2 güçlü (cihaza özel; combat panelinden değişir)
const AIM_KEY = 'zombi-ciftlik-nisan';
const AIM_CONE = [0, 20, 34]; // sürükleyerek nişanda yakalama açısı (derece)
export const aimAssist = { level: 1 };
try {
  const v = Number(localStorage.getItem(AIM_KEY));
  if (localStorage.getItem(AIM_KEY) !== null && [0, 1, 2].includes(v)) aimAssist.level = v;
} catch { /* depolama kapalı olabilir */ }
export function setAimAssist(level) {
  aimAssist.level = Phaser.Math.Clamp(Math.round(level), 0, 2);
  try { localStorage.setItem(AIM_KEY, String(aimAssist.level)); } catch { /* yoksay */ }
}

const VERBS = { hoe: 'Sür', can: 'Sula', axe: 'Kes', pickaxe: 'Kaz' };
const TYPE_VERBS = { seed: 'Ek', weapon: 'Vur', gun: 'Ateş', food: 'Ye', place: 'Kur', tool: 'Kullan' };

// ---------- Otomatik hedefleme ----------
// En uygun zombi: yakınlık + baktığı yöne yakınlık; oyuncuya ısırık hazırlayan öne alınır.
// dir verilirse (sürükleyerek nişan) yalnız o yönün koni içindekiler sayılır.
function nearestZombie(scene, range, dir = null) {
  const p = scene.player;
  const f = dir || p.facing || { x: 1, y: 0 };
  const fa = Math.atan2(f.y, f.x);
  const cone = dir ? AIM_CONE[aimAssist.level] * Math.PI / 180 : Math.PI;
  let best = null, bestS = Infinity;
  for (const z of scene.zombies.getChildren()) {
    if (z.dead || !z.active) continue;
    const d = Phaser.Math.Distance.Between(p.x, p.y, z.x, z.y);
    if (d > range) continue;
    const diff = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(z.y - p.y, z.x - p.x) - fa));
    if (diff > cone) continue;
    let s = d * (1 + diff * (dir ? 1.2 : 0.35));
    if (z.biteTarget === p) s *= 0.6;
    if (s < bestS) { bestS = s; best = z; }
  }
  return best;
}

// Erişimdeki tile'lar: önce baktığı yöndeki, sonra yöne yakınlığa göre
function candidateTiles(p) {
  const fx = p.x, fy = p.y + 4;
  const f = p.facing || { x: 1, y: 0 };
  const ax = fx + f.x * 12, ay = fy + f.y * 12;
  const ftx = Math.floor((fx + f.x * 14) / TILE), fty = Math.floor((fy + f.y * 14) / TILE);
  const ptx = Math.floor(fx / TILE), pty = Math.floor(fy / TILE);
  const list = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const tx = ptx + dx, ty = pty + dy, cx = tx * TILE + 8, cy = ty * TILE + 8;
      if (Phaser.Math.Distance.Between(fx, fy, cx, cy) > REACH) continue;
      const score = (tx === ftx && ty === fty) ? -1 : Phaser.Math.Distance.Between(ax, ay, cx, cy);
      list.push({ tx, ty, x: cx, y: cy, score });
    }
  }
  return list.sort((a, b) => a.score - b.score);
}

function front(p, dist) {
  const f = p.facing || { x: 1, y: 0 };
  return { x: p.x + f.x * dist, y: p.y + 4 + f.y * dist };
}

function isRipe(scene, t) { try { return scene.farm.isRipe(t.tx, t.ty); } catch { return false; } }

// Seçili eşyaya göre tile uygunluğu
function tilePredicate(scene, id, type) {
  const farm = scene.farm;
  if (id === 'hoe') return (t) => farm.inZone(t.tx, t.ty) && !farm.get(t.tx, t.ty);
  if (id === 'can') return (t) => { const pl = farm.get(t.tx, t.ty); return !!pl && !pl.watered && !!pl.crop && !pl.crop.dead; };
  if (type === 'seed') return (t) => { const pl = farm.get(t.tx, t.ty); return !!pl && !pl.crop; };
  if (type === 'place') return (t) => canPlace(scene, t.x, t.y);
  return null;
}

// Eylem butonunun uygulanacağı dünya noktası + etiket
export function autoTarget(scene, aim) {
  const p = scene.player;
  const slot = scene.inventory.slots[scene.selected];
  const id = slot?.id;
  const item = id ? ITEMS[id] : null;
  const type = item?.type || null;
  const verb = (id && VERBS[id]) || TYPE_VERBS[type] || (item ? 'Kullan' : 'Vur');

  const combat = !item || type === 'weapon' || type === 'gun';
  const range = type === 'gun' ? GUN_RANGE : MELEE_RANGE;
  // Sürükleyerek elle nişan (Brawl Stars tarzı); yardım açıksa koni içindeki zombiye yumuşakça kilitlenir
  if (aim) {
    const z = combat && aimAssist.level > 0 ? nearestZombie(scene, range, aim) : null;
    if (z) return { x: z.x, y: z.y, label: verb, kind: 'zombie', z };
    return { x: p.x + aim.x * 48, y: p.y + aim.y * 48, label: verb, kind: 'aim' };
  }

  if (combat && aimAssist.level > 0) {
    const z = nearestZombie(scene, range);
    if (z) return { x: z.x, y: z.y, label: verb, kind: 'zombie', z };
  }
  if (type === 'weapon' || type === 'gun') { const f = front(p, 20); return { ...f, label: verb, kind: 'aim' }; }
  if (type === 'food') return { x: p.x, y: p.y, label: verb, kind: 'self' };

  const tiles = candidateTiles(p);
  // Balta / kazma: erişimdeki en yakın ağaç / kaya
  if (id === 'axe' || id === 'pickaxe') {
    const ripe = tiles.find((t) => isRipe(scene, t));
    if (ripe) return { ...ripe, label: 'Hasat', kind: 'tile' };
    const kind = id === 'axe' ? 'tree' : 'rock';
    let best = null, bestD = REACH;
    for (const r of scene.resources.getChildren()) {
      if (r.kind !== kind || r.depleted) continue;
      const by = r.y + (kind === 'tree' ? 8 : 2);
      const d = Phaser.Math.Distance.Between(p.x, p.y, r.x, by);
      if (d < bestD) { bestD = d; best = { x: r.x, y: by }; }
    }
    if (best) return { ...best, label: verb, kind: 'resource' };
    const f = front(p, 14);
    return { ...f, label: verb, kind: 'none' };
  }

  const pred = tilePredicate(scene, id, type);
  for (const t of tiles) {
    if (type !== 'place' && isRipe(scene, t)) return { ...t, label: 'Hasat', kind: 'tile' };
    if (pred && pred(t)) return { ...t, label: verb, kind: 'tile' };
  }
  // Sulanacak ekin yoksa sulanmamış boş toprağa da izin ver
  if (id === 'can') {
    const t = tiles.find((c) => { const pl = scene.farm.get(c.tx, c.ty); return pl && !pl.watered; });
    if (t) return { ...t, label: verb, kind: 'tile' };
  }
  const f = front(p, 14);
  const tx = Math.floor(f.x / TILE), ty = Math.floor(f.y / TILE);
  return { x: tx * TILE + 8, y: ty * TILE + 8, tx, ty, label: verb, kind: 'none' };
}

// ---------- DOM kontrolleri ----------
// Hareket: her zaman görünen joystick tabanı (yüzen ya da sabit) veya 4/8 yönlü D-pad.
// Hepsi scene.virtualMove'a yazar (Player okur; misafir modunda da aynı yol).
export class TouchControls {
  constructor() {
    this.scene = null;
    this.joyId = null;
    this.padId = null;
    this.padDir = '';
    this.actId = null;
    this.aim = null;
    this.repeat = null;
    this.lastLabel = null;
    this.lastIcon = null;
    this.lastAct = null;
    this.build();
  }

  build() {
    const cells = [['ul', '◤'], ['u', '▲'], ['ur', '◥'], ['l', '◀'], ['c', ''], ['r', '▶'], ['dl', '◣'], ['d', '▼'], ['dr', '◢']]
      .map(([k, s]) => `<i class="d-${k}" data-d="${k}">${s}</i>`).join('');
    const root = el('div', '', `
      <div class="mc-joyzone"><div class="mc-joy"><div class="mc-knob"></div></div></div>
      <div class="mc-dpad" role="group" aria-label="Yön tuşları">${cells}</div>
      <div class="mc-cluster">
        <button class="mc-btn mc-interact off" type="button" aria-label="Etkileşim"><span class="ic">✋</span><span class="tag"></span></button>
        <button class="mc-btn mc-inv" type="button" aria-label="Envanter">🎒</button>
        <button class="mc-btn mc-action" type="button" aria-label="Eylem"><img alt=""><span class="lb">Kullan</span></button>
      </div>
      <button class="mc-btn mc-menu" type="button" aria-label="Menü">☰<i class="dot"></i></button>`);
    root.id = 'mobile-ui';
    const ui = document.getElementById('ui');
    ui.insertBefore(root, document.getElementById('backdrop'));
    this.root = root;
    this.zone = root.querySelector('.mc-joyzone');
    this.joy = root.querySelector('.mc-joy');
    this.knob = root.querySelector('.mc-knob');
    this.pad = root.querySelector('.mc-dpad');
    this.btnAct = root.querySelector('.mc-action');
    this.actImg = this.btnAct.querySelector('img');
    this.actLbl = this.btnAct.querySelector('.lb');
    this.btnInt = root.querySelector('.mc-interact');
    this.intLbl = this.btnInt.querySelector('.tag');
    this.btnInv = root.querySelector('.mc-inv');
    this.btnMenu = root.querySelector('.mc-menu');
    this.menuDot = this.btnMenu.querySelector('.dot');

    // Kontrollere dokunuşlar Phaser'a (dünyaya) / tarayıcı jestlerine geçmesin
    root.addEventListener('touchstart', (e) => { if (e.target.closest('.mc-joyzone,.mc-dpad,.mc-btn')) e.preventDefault(); }, { passive: false });

    this.bindJoystick();
    this.bindDpad();
    this.bindAction();
    this.tap(this.btnInt, () => this.onInteract());
    this.tap(this.btnInv, () => { if (this.scene?.started && !this.scene.gameOver) { this.scene.hud.toggleInventory(); audio.sfx('click'); } });
    this.tap(this.btnMenu, () => { if (this.scene?.started && !this.scene.gameOver) this.onMenu?.(this.scene); });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    // Hareket türü / el düzeni değişince basılı kalan yön sıfırlansın
    onSettingsChange(() => this.releaseAll());
  }

  attach(scene) {
    this.scene = scene;
    this.releaseAll();
    this.lastLabel = this.lastIcon = this.lastAct = null;
  }

  ready() {
    const s = this.scene;
    return !!(s && s.started && !s.gameOver && s.hud && !s.hud.isModalOpen() && s.player?.alive);
  }

  setMove(x, y) {
    const vm = this.scene?.virtualMove;
    if (vm) { vm.x = x; vm.y = y; }
  }

  // Basit dokunma butonu: pointerdown anında tepki (300ms tıklama gecikmesi yok)
  tap(btn, fn) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('pressed');
      fn();
    });
    const up = () => btn.classList.remove('pressed');
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }

  // Etkileşim: yakında bir şey varsa çalıştır; yoksa kısa bir ipucu göster
  onInteract() {
    if (!this.ready()) return;
    // Görünüm 100ms'de bir yenilenir; karar anlık duruma göre verilsin (NPC yürürken kaçmasın)
    if (!this.scene.bestInteraction()) {
      this.btnInt.classList.remove('nudge');
      void this.btnInt.offsetWidth; // animasyonu yeniden başlat
      this.btnInt.classList.add('nudge');
      this.intLbl.textContent = 'Yakında etkileşim yok';
      this.lastLabel = null; // sonraki refresh etiketi düzeltir
      return;
    }
    this.scene.interact();
    vibrate(10);
  }

  // ---------- Joystick ----------
  // Taban her zaman görünür (dinlenme yeri CSS'te). Yüzen: dokunulan yere taşınır; sabit: yerinde kalır.
  bindJoystick() {
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      if (this.joyId !== null) return;
      e.preventDefault();
      this.joyId = e.pointerId;
      try { z.setPointerCapture(e.pointerId); } catch { /* yoksay */ }
      const r = this.joy.getBoundingClientRect();
      const R = r.width / 2 || JOY_R;
      this.joyR = R;
      if (settings.joyMode === 'fixed') {
        this.origin = { x: r.left + R, y: r.top + R };
      } else {
        // Taban parmağın değdiği yerde belirir (ekrandan taşmasın)
        const ox = Phaser.Math.Clamp(e.clientX, R + 6, window.innerWidth - R - 6);
        const oy = Phaser.Math.Clamp(e.clientY, R + 6, window.innerHeight - R - 6);
        this.origin = { x: ox, y: oy };
        this.joy.style.left = `${ox}px`;
        this.joy.style.top = `${oy}px`;
        this.joy.classList.add('moved');
      }
      this.joy.classList.add('active');
      this.moveJoy(e.clientX, e.clientY);
    });
    z.addEventListener('pointermove', (e) => { if (e.pointerId === this.joyId) this.moveJoy(e.clientX, e.clientY); });
    const end = (e) => { if (e.pointerId === this.joyId) this.releaseJoy(); };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
    z.addEventListener('lostpointercapture', end);
  }

  moveJoy(px, py) {
    const R = this.joyR || JOY_R;
    let dx = px - this.origin.x, dy = py - this.origin.y;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(1, d / R);
    if (m < DEAD) { this.setMove(0, 0); return; }
    // Ölü bölge sonrası 0..1; yarıçapın %80'inde tam hız (başparmağı kenara itmek gerekmez)
    const mag = Math.min(1, (m - DEAD) / (FULL - DEAD));
    this.setMove((dx / d) * mag, (dy / d) * mag);
  }

  releaseJoy() {
    this.joyId = null;
    this.knob.style.transform = '';
    this.joy.classList.remove('active', 'moved');
    this.joy.style.left = this.joy.style.top = '';
    if (this.padId === null) this.setMove(0, 0);
  }

  // ---------- D-pad ----------
  // Tek bir öğe: parmak merkeze göre hangi yöndeyse o yön basılı (parmak kaydırınca yön değişir)
  bindDpad() {
    const p = this.pad;
    p.addEventListener('pointerdown', (e) => {
      if (this.padId !== null) return;
      e.preventDefault();
      this.padId = e.pointerId;
      try { p.setPointerCapture(e.pointerId); } catch { /* yoksay */ }
      this.movePad(e.clientX, e.clientY, true);
    });
    p.addEventListener('pointermove', (e) => { if (e.pointerId === this.padId) this.movePad(e.clientX, e.clientY, false); });
    const end = (e) => { if (e.pointerId === this.padId) this.releasePad(); };
    p.addEventListener('pointerup', end);
    p.addEventListener('pointercancel', end);
    p.addEventListener('lostpointercapture', end);
  }

  movePad(px, py, first) {
    const r = this.pad.getBoundingClientRect();
    const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2);
    let key = '', vx = 0, vy = 0;
    if (Math.hypot(dx, dy) >= r.width * PAD_DEAD) {
      if (settings.moveMode === 'dpad8') {
        const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
        const a = sector * (Math.PI / 4);
        vx = Math.round(Math.cos(a)); vy = Math.round(Math.sin(a));
      } else if (Math.abs(dx) >= Math.abs(dy)) vx = Math.sign(dx);
      else vy = Math.sign(dy);
      key = (vy < 0 ? 'u' : vy > 0 ? 'd' : '') + (vx < 0 ? 'l' : vx > 0 ? 'r' : '');
    }
    if (key !== this.padDir) {
      this.pad.querySelector('.on')?.classList.remove('on');
      if (key) { this.pad.querySelector(`[data-d="${key}"]`)?.classList.add('on'); if (!first) vibrate(6); }
      this.padDir = key;
    }
    if (first && key) vibrate(10);
    const len = Math.hypot(vx, vy) || 1;
    this.setMove(vx / len, vy / len);
  }

  releasePad() {
    this.padId = null;
    this.padDir = '';
    this.pad.querySelector('.on')?.classList.remove('on');
    if (this.joyId === null) this.setMove(0, 0);
  }

  // ---------- Eylem butonu ----------
  bindAction() {
    const b = this.btnAct;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.actId !== null) return;
      this.actId = e.pointerId;
      try { b.setPointerCapture(e.pointerId); } catch { /* yoksay */ }
      this.actStart = { x: e.clientX, y: e.clientY };
      this.aim = null;
      b.classList.add('pressed');
      this.fire(true);
      clearInterval(this.repeat);
      this.repeat = setInterval(() => this.fire(false), REPEAT_MS);
    });
    b.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.actId) return;
      const dx = e.clientX - this.actStart.x, dy = e.clientY - this.actStart.y, d = Math.hypot(dx, dy);
      this.aim = d > 18 ? { x: dx / d, y: dy / d } : null;
      b.classList.toggle('aiming', !!this.aim);
    });
    const end = (e) => { if (e.pointerId === this.actId) this.releaseAction(); };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', end);
  }

  fire(first) {
    if (!this.ready()) return;
    const s = this.scene;
    const slot = s.inventory.slots[s.selected];
    const type = slot ? ITEMS[slot.id]?.type : null;
    // Yiyecek ve yapı yerleştirme basılı tutunca tekrarlanmasın
    if (!first && (type === 'food' || type === 'place')) return;
    if (s.player.actionCd > 0) return;
    const t = autoTarget(s, this.aim);
    useSelected(s, t.x, t.y);
    if (first) vibrate(15);
  }

  releaseAction() {
    this.actId = null;
    this.aim = null;
    clearInterval(this.repeat);
    this.repeat = null;
    this.btnAct.classList.remove('pressed', 'aiming');
  }

  releaseAll() { this.releaseJoy(); this.releasePad(); this.releaseAction(); }

  // ---------- Periyodik arayüz güncellemesi (100ms) ----------
  refresh(target) {
    const s = this.scene;
    if (!s?.started) return;
    // Etkileşim butonu: her zaman görünür; yakında etkileşim yoksa soluk, varsa parlak + etiket
    const act = s.player?.alive ? s.bestInteraction() : null;
    const label = act ? (act.label || 'Etkileşim') : '';
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      this.intLbl.textContent = label;
      this.btnInt.classList.toggle('off', !label);
      this.btnInt.classList.remove('nudge');
      this.btnInt.setAttribute('aria-label', label || 'Etkileşim (yakında yok)');
    }
    // Eylem butonu ikonu + fiil
    const slot = s.inventory.slots[s.selected];
    const icon = slot ? s.hud.icon(slot.id) : '';
    if (icon !== this.lastIcon) {
      this.lastIcon = icon;
      if (icon) this.actImg.src = icon; else this.actImg.removeAttribute('src');
      this.btnAct.classList.toggle('empty', !icon);
    }
    const verb = target?.label || 'Kullan';
    const name = slot ? (ITEMS[slot.id]?.name || '') : '';
    const key = verb + '|' + name;
    if (key !== this.lastAct) {
      this.lastAct = key;
      this.actLbl.textContent = verb;
      this.btnAct.setAttribute('aria-label', name ? `${verb}: ${name}` : verb);
    }
  }

  setMenuDot(on) { this.menuDot.classList.toggle('show', !!on); }
}

// Uzaktaki dünya dokunuşlarını Phaser'a iletme (yalnız yakındaki hedeflere tap-to-use)
export function installTapFilter(getScene) {
  window.addEventListener('touchstart', (e) => {
    const s = getScene();
    if (!s || !s.started || s.gameOver || !s.hud || s.hud.isModalOpen()) return;
    if (!document.body.classList.contains('is-touch')) return; // dokunmatik düzen kapalıyken dokunuş = tık
    const canvas = s.game.canvas;
    if (e.target !== canvas) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const rect = canvas.getBoundingClientRect();
    const cam = s.cameras.main;
    const wp = cam.getWorldPoint(t.clientX - rect.left, t.clientY - rect.top);
    const slot = s.inventory.slots[s.selected];
    const type = slot ? ITEMS[slot.id]?.type : null;
    if (type === 'gun' || type === 'weapon') return; // dokunarak nişan al
    const p = s.player;
    const tx = Math.floor(wp.x / TILE), ty = Math.floor(wp.y / TILE);
    const near = Phaser.Math.Distance.Between(p.x, p.y + 4, tx * TILE + 8, ty * TILE + 8) <= REACH;
    // Ağaç/kaya gövdesi tile sınırını aşabilir; yakındaysa izin ver
    const nearRaw = Phaser.Math.Distance.Between(p.x, p.y, wp.x, wp.y) <= REACH + 8;
    if (near || nearRaw) return;
    e.stopPropagation();
    e.preventDefault();
  }, { capture: true, passive: false });
}
