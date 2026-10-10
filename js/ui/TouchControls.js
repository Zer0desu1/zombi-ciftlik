// Dokunmatik kontroller: yüzen joystick, EYLEM / ETKİLEŞ / çanta / menü butonları ve otomatik hedefleme.
import { TILE, ITEMS } from '../config.js';
import { useSelected, canPlace } from '../systems/PlayerActions.js';
import { audio } from '../audio.js';
import { el } from './dom.js';
import { vibrate } from './mobileSettings.js';

const REACH = 40;      // PlayerActions ile aynı erişim
const JOY_R = 56;      // joystick taban yarıçapı (112px çap)
const DEAD = 0.15;     // ölü bölge
const REPEAT_MS = 160; // basılı tutunca tekrar aralığı
const MELEE_RANGE = 140, GUN_RANGE = 200;

const VERBS = { hoe: 'Sür', can: 'Sula', axe: 'Kes', pickaxe: 'Kaz' };
const TYPE_VERBS = { seed: 'Ek', weapon: 'Vur', gun: 'Ateş', food: 'Ye', place: 'Kur', tool: 'Kullan' };

// ---------- Otomatik hedefleme ----------
function nearestZombie(scene, range) {
  const p = scene.player;
  let best = null, bestD = range;
  for (const z of scene.zombies.getChildren()) {
    if (z.dead || !z.active) continue;
    const d = Phaser.Math.Distance.Between(p.x, p.y, z.x, z.y);
    if (d < bestD) { bestD = d; best = z; }
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

  // Sürükleyerek elle nişan (Brawl Stars tarzı)
  if (aim) return { x: p.x + aim.x * 48, y: p.y + aim.y * 48, label: verb, kind: 'aim' };

  if (!item || type === 'weapon' || type === 'gun') {
    const z = nearestZombie(scene, type === 'gun' ? GUN_RANGE : MELEE_RANGE);
    if (z) return { x: z.x, y: z.y, label: verb, kind: 'zombie' };
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
export class TouchControls {
  constructor() {
    this.scene = null;
    this.joyId = null;
    this.actId = null;
    this.aim = null;
    this.repeat = null;
    this.lastLabel = null;
    this.lastIcon = null;
    this.lastAct = null;
    this.build();
  }

  build() {
    const root = el('div', '', `
      <div class="mc-joyzone"><div class="mc-joy idle"><div class="mc-knob"></div></div></div>
      <div class="mc-cluster">
        <button class="mc-btn mc-interact" type="button"><span class="ic">✋</span><span class="lb"></span></button>
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
    this.btnAct = root.querySelector('.mc-action');
    this.actImg = this.btnAct.querySelector('img');
    this.actLbl = this.btnAct.querySelector('.lb');
    this.btnInt = root.querySelector('.mc-interact');
    this.intLbl = this.btnInt.querySelector('.lb');
    this.btnInv = root.querySelector('.mc-inv');
    this.btnMenu = root.querySelector('.mc-menu');
    this.menuDot = this.btnMenu.querySelector('.dot');

    // Dokunuşlar Phaser'a / tarayıcı jestlerine geçmesin
    root.addEventListener('touchstart', (e) => { if (e.target.closest('.mc-joyzone,.mc-btn')) e.preventDefault(); }, { passive: false });

    this.bindJoystick();
    this.bindAction();
    this.tap(this.btnInt, () => { if (this.ready()) { this.scene.interact(); vibrate(10); } });
    this.tap(this.btnInv, () => { if (this.scene?.started && !this.scene.gameOver) { this.scene.hud.toggleInventory(); audio.sfx('click'); } });
    this.tap(this.btnMenu, () => { if (this.scene?.started && !this.scene.gameOver) this.onMenu?.(this.scene); });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
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

  // ---------- Joystick ----------
  bindJoystick() {
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      if (this.joyId !== null) return;
      e.preventDefault();
      this.joyId = e.pointerId;
      try { z.setPointerCapture(e.pointerId); } catch { /* yoksay */ }
      // Taban parmağın değdiği yerde belirir (ekrandan taşmasın)
      const ox = Phaser.Math.Clamp(e.clientX, JOY_R + 6, window.innerWidth - JOY_R - 6);
      const oy = Phaser.Math.Clamp(e.clientY, JOY_R + 6, window.innerHeight - JOY_R - 6);
      this.origin = { x: ox, y: oy };
      this.joy.classList.remove('idle');
      this.joy.style.left = `${ox}px`;
      this.joy.style.top = `${oy}px`;
      this.joy.style.bottom = this.joy.style.right = 'auto';
      this.moveJoy(e.clientX, e.clientY);
    });
    z.addEventListener('pointermove', (e) => { if (e.pointerId === this.joyId) this.moveJoy(e.clientX, e.clientY); });
    const end = (e) => { if (e.pointerId === this.joyId) this.releaseJoy(); };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
    z.addEventListener('lostpointercapture', end);
  }

  moveJoy(px, py) {
    let dx = px - this.origin.x, dy = py - this.origin.y;
    const d = Math.hypot(dx, dy);
    if (d > JOY_R) { dx = (dx / d) * JOY_R; dy = (dy / d) * JOY_R; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(1, d / JOY_R);
    const vm = this.scene?.virtualMove;
    if (!vm) return;
    if (m < DEAD) { vm.x = 0; vm.y = 0; return; }
    // Yön birim vektör, büyüklük ölü bölge sonrası 0..1
    const mag = (m - DEAD) / (1 - DEAD);
    const len = Math.hypot(dx, dy) || 1;
    vm.x = (dx / len) * mag;
    vm.y = (dy / len) * mag;
  }

  releaseJoy() {
    this.joyId = null;
    this.knob.style.transform = '';
    this.joy.classList.add('idle');
    this.joy.style.left = this.joy.style.top = this.joy.style.bottom = this.joy.style.right = '';
    const vm = this.scene?.virtualMove;
    if (vm) { vm.x = 0; vm.y = 0; }
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

  releaseAll() { this.releaseJoy(); this.releaseAction(); }

  // ---------- Periyodik arayüz güncellemesi (150ms) ----------
  refresh(target) {
    const s = this.scene;
    if (!s?.started) return;
    // Etkileş butonu
    const act = s.player?.alive ? s.bestInteraction() : null;
    const label = act ? act.label : '';
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      this.intLbl.textContent = label;
      this.btnInt.classList.toggle('show', !!label);
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
    if (verb !== this.lastAct) { this.lastAct = verb; this.actLbl.textContent = verb; }
  }

  setMenuDot(on) { this.menuDot.classList.toggle('show', !!on); }
}

// Uzaktaki dünya dokunuşlarını Phaser'a iletme (yalnız yakındaki hedeflere tap-to-use)
export function installTapFilter(getScene) {
  window.addEventListener('touchstart', (e) => {
    const s = getScene();
    if (!s || !s.started || s.gameOver || !s.hud || s.hud.isModalOpen()) return;
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
