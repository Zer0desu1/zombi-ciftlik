// 'juice' özellik modülü — his, ses ve görsel cila. Sözleşme için registry.js'e bak.
// Hasar sayıları, hit-stop, vuruş kıvılcımı, ölüm lekesi, ayak tozu, hasat uçuşu,
// ortam sesleri + müzik yoğunluğu, dalga vinyeti, mini harita (N), ağaç sallanması,
// gece ışık parıltısı/ateş böcekleri, su parıltısı ve otomatik düşük efekt modu (scene.lowFx).
import { TILE, MAP_W, MAP_H, ITEMS } from '../config.js';
import { audio } from '../audio.js';
import { Zombie } from '../entities/Zombie.js';
import { Player } from '../entities/Player.js';
import { addCanvas, R } from '../textures.js';
import { injectCSS, el, featureLayer } from '../ui/dom.js';

// ---------------- Ayarlar (cihaza özel → localStorage) ----------------
const LS_KEY = 'zombi-ciftlik-juice';
const DEF = { quality: 'auto', dmgNums: true, shake: true, minimap: true, mapBig: false, music: 1, sfx: 1, amb: 1 };
let cfg = loadCfg();
function loadCfg() {
  try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch { return { ...DEF }; }
}
function saveCfg() { try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* depolama kapalı */ } }

const isTouch = () => document.body.classList.contains('is-touch') || !!window.matchMedia?.('(pointer:coarse)').matches;

// Modül durumu (sahne yeniden başlarsa init'te sıfırlanır)
const J = { scene: null };
const NUM_LIFE = 0.6;

// ---------------- Prototip kancaları (modül yüklenirken bir kez) ----------------
// Hasar sonrası can farkını ölçer → zırh/kritik gibi başka modüllerin değişikliklerini de yakalar.
if (!Zombie.prototype.__juice) {
  Zombie.prototype.__juice = true;
  const origHit = Zombie.prototype.takeDamage;
  Zombie.prototype.takeDamage = function (n, source, opts) {
    const before = this.hp, wasDead = this.dead;
    const r = origHit.apply(this, arguments);
    if (!wasDead && J.scene === this.scene) onZombieHit(this, before - this.hp, source, opts);
    return r;
  };
  const origDie = Zombie.prototype.die;
  Zombie.prototype.die = function () {
    const was = this.dead;
    const info = was ? null : { x: this.x, y: this.y, key: this.texture.key, flip: this.flipX, sx: this.scaleX, sy: this.scaleY, boss: isBoss(this), tint: this.tintTopLeft };
    const r = origDie.apply(this, arguments);
    if (info && J.scene) onZombieDeath(J.scene, info);
    return r;
  };
}
if (!Player.prototype.__juice) {
  Player.prototype.__juice = true;
  const origPHit = Player.prototype.takeDamage;
  Player.prototype.takeDamage = function () {
    const before = this.hp;
    const r = origPHit.apply(this, arguments);
    const d = before - this.hp;
    if (d > 0 && J.scene === this.scene) onPlayerHit(this, d);
    return r;
  };
}

const isBoss = (z) => !!(z.isBoss || z.kind === 'boss');

// ---------------- Dokular ----------------
function makeTextures(scene) {
  addCanvas(scene, 'fx_dust', 6, 6, (ctx) => {
    R(ctx, 1, 2, 4, 2, 'rgba(214,196,160,0.85)'); R(ctx, 2, 1, 2, 4, 'rgba(214,196,160,0.85)'); R(ctx, 2, 2, 1, 1, 'rgba(240,228,200,0.9)');
  });
  addCanvas(scene, 'fx_spark', 9, 9, (ctx) => {
    R(ctx, 4, 0, 1, 9, '#fff'); R(ctx, 0, 4, 9, 1, '#fff'); R(ctx, 3, 3, 3, 3, '#fff');
    R(ctx, 2, 2, 1, 1, '#fff7c2'); R(ctx, 6, 2, 1, 1, '#fff7c2'); R(ctx, 2, 6, 1, 1, '#fff7c2'); R(ctx, 6, 6, 1, 1, '#fff7c2');
  });
  // Yeşil zombi lekesi varyasyonları
  for (let v = 0; v < 3; v++) {
    addCanvas(scene, `fx_splat${v}`, 16, 10, (ctx) => {
      const cols = ['#3f5f2a', '#4f7a34', '#2f4a20'];
      R(ctx, 4, 3, 8, 4, cols[0]); R(ctx, 3, 4, 10, 2, cols[0]); R(ctx, 6, 4, 4, 2, cols[1]);
      for (let i = 0; i < 7; i++) {
        const x = 1 + ((Math.random() * 14) | 0), y = 1 + ((Math.random() * 8) | 0);
        R(ctx, x, y, 1 + (Math.random() < 0.3 ? 1 : 0), 1, cols[(Math.random() * 3) | 0]);
      }
    });
  }
  addCanvas(scene, 'fx_firefly', 3, 3, (ctx) => { R(ctx, 1, 0, 1, 3, 'rgba(230,255,140,0.6)'); R(ctx, 0, 1, 3, 1, 'rgba(230,255,140,0.6)'); R(ctx, 1, 1, 1, 1, '#f6ffb0'); });
  addCanvas(scene, 'fx_glint', 5, 5, (ctx) => { R(ctx, 2, 0, 1, 5, 'rgba(255,255,255,0.8)'); R(ctx, 0, 2, 5, 1, 'rgba(255,255,255,0.8)'); R(ctx, 2, 2, 1, 1, '#fff'); });
}

// Ağaç sallanması: mevcut 'tree' dokusundan tepe satırları 1px kaydırılmış iki varyant (piksel-dostu)
function makeSwayTextures(scene) {
  if (!scene.textures.exists('tree')) return false;
  const src = scene.textures.get('tree').getSourceImage();
  const w = src.width, h = src.height, cut = Math.round(h * 0.3);
  [['tree_sway_l', -1], ['tree_sway_r', 1]].forEach(([key, s]) => {
    addCanvas(scene, key, w, h, (ctx) => {
      ctx.drawImage(src, 0, cut, w, h - cut, 0, cut, w, h - cut);
      ctx.drawImage(src, 0, 0, w, cut, s, 0, w, cut);
    });
  });
  return true;
}

// ---------------- CSS ----------------
const CSS = `
#jc-vignette { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .25s ease;
  background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(200,20,20,.55) 100%); }
#jc-vignette.wave { animation: jcWave 1.6s ease-out forwards; }
#jc-vignette.hurt { animation: jcHurt .45s ease-out forwards; }
#jc-vignette.dawn { background: radial-gradient(ellipse at center, rgba(255,220,120,0) 45%, rgba(255,200,90,.45) 100%); animation: jcHurt 1.4s ease-out forwards; }
#jc-vignette.low { opacity: 1; animation: jcLow 1s ease-in-out infinite; }
@keyframes jcWave { 0% { opacity: 0 } 12% { opacity: 1 } 30% { opacity: .55 } 45% { opacity: .95 } 100% { opacity: 0 } }
@keyframes jcHurt { 0% { opacity: .9 } 100% { opacity: 0 } }
@keyframes jcLow { 0%,100% { opacity: .35 } 50% { opacity: .8 } }
#jc-minimap { position: absolute; top: 74px; right: 66px; width: 128px; height: 88px; padding: 0; border-radius: 10px;
  overflow: hidden; pointer-events: auto; cursor: pointer; display: none; transition: width .2s ease, height .2s ease; }
#jc-minimap.show { display: block; }
#jc-minimap canvas { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
#jc-minimap.big { width: 256px; height: 176px; }
#jc-minimap .jc-lbl { position: absolute; left: 6px; bottom: 3px; font-size: 9px; color: rgba(255,255,255,.7); text-shadow: 0 1px 2px #000; pointer-events: none; }
body.is-touch #jc-minimap { top: calc(env(safe-area-inset-top, 0px) + 124px); right: 8px; width: 96px; height: 66px; border-radius: 8px; }
body.is-touch #jc-minimap.big { width: 192px; height: 132px; }
@media (max-width: 600px) {
  #jc-minimap { top: calc(env(safe-area-inset-top, 0px) + 124px); right: 8px; width: 96px; height: 66px; border-radius: 8px; }
  #jc-minimap.big { width: 192px; height: 132px; }
}
.jc-set { display: grid; gap: 12px; font-size: 14px; }
.jc-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; min-height: 44px; }
.jc-row input[type=range] { width: 150px; accent-color: var(--accent, #ffd166); }
.jc-row .jc-seg { display: flex; gap: 4px; }
.jc-row .jc-seg button, .jc-row .jc-tog { min-height: 36px; min-width: 44px; padding: 6px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,.18);
  background: rgba(255,255,255,.06); color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
.jc-row .jc-seg button.on, .jc-row .jc-tog.on { background: rgba(255,209,102,.25); border-color: rgba(255,209,102,.6); }
.jc-note { font-size: 12px; color: var(--muted, #aaa); }
`;

// ---------------- Yardımcılar ----------------
const lowFx = () => !!J.scene?.lowFx;
const inView = (scene, x, y, pad = 24) => {
  const v = scene.cameras.main.worldView;
  return x > v.x - pad && y > v.y - pad && x < v.right + pad && y < v.bottom + pad;
};

function weatherRain(scene) {
  const w = scene.weather;
  const id = String(typeof w === 'string' ? w : (w?.id || w?.type || w?.kind || w?.key || w?.name || '')).toLowerCase();
  if (/storm|fırtına|firtina/.test(id)) return 1;
  if (/rain|yağmur|yagmur/.test(id)) return 0.7;
  return 0;
}

// ---------------- Hasar sayıları (havuzlu) ----------------
function buildNumPool(scene) {
  J.nums = [];
  for (let i = 0; i < 20; i++) {
    const t = scene.add.text(0, 0, '', { fontFamily: '"Pixelify Sans", Outfit, sans-serif', fontSize: '8px', color: '#fff', stroke: '#000', strokeThickness: 2, resolution: 4 })
      .setOrigin(0.5).setDepth(15500).setVisible(false);
    t.life = 0;
    J.nums.push(t);
  }
}

function showNum(x, y, str, color, big) {
  if (!J.nums) return;
  let n = J.nums.find((t) => t.life <= 0);
  if (!n) n = J.nums.reduce((a, b) => (a.life < b.life ? a : b)); // en eskiyi yeniden kullan
  n.setText(str).setColor(color).setFontSize(big ? '11px' : '8px');
  n.x0 = x + Phaser.Math.Between(-4, 4); n.y0 = y; n.big = big;
  n.drift = Phaser.Math.FloatBetween(-6, 6);
  n.life = NUM_LIFE;
  n.setPosition(n.x0, n.y0).setAlpha(1).setScale(1).setVisible(true);
}

function updateNums(dt) {
  if (!J.nums) return;
  for (const n of J.nums) {
    if (n.life <= 0) continue;
    n.life -= dt;
    if (n.life <= 0) { n.setVisible(false); continue; }
    const t = 1 - n.life / NUM_LIFE;
    const e = 1 - (1 - t) * (1 - t);
    n.setPosition(n.x0 + n.drift * e, n.y0 - 16 * e);
    n.setAlpha(t > 0.55 ? (1 - t) / 0.45 : 1);
    n.setScale(t < 0.15 ? 1 + (0.15 - t) * (n.big ? 6 : 3) : 1);
  }
}

// ---------------- Vuruş olayları ----------------
function onZombieHit(z, dmg, source, opts) {
  const scene = J.scene;
  if (!scene) return;
  // combatHit olayı bu vuruşun kritik olduğunu önceden bildirir (z.lastHitCrit kalıcı olduğu için tek başına güvenilmez)
  const crit = !!(opts === true || opts?.crit || source?.crit || J.critTarget === z);
  J.critTarget = null;
  if (dmg > 0) J.queue.push({ target: z, x: z.x, y: z.y - 10 * (z.scaleY || 1), dmg, crit, kind: 'z' });
  // Vuruş kıvılcımı
  spark(scene, z.x + Phaser.Math.Between(-2, 2), z.y - 2, crit ? 0xffd166 : 0xffffff);
  // Yakın dövüş → hit-stop
  const p = scene.player;
  const melee = source && (source === p || source.isPlayer || source.melee);
  if (melee && dmg > 0) hitStop(scene, isBoss(z) ? 90 : 50);
}

function onPlayerHit(p, dmg) {
  const scene = J.scene;
  J.queue.push({ target: p, x: p.x, y: p.y - 12, dmg, crit: false, kind: 'p' });
  vignette('hurt');
  if (navigator.vibrate && isTouch()) { try { navigator.vibrate(25); } catch { /* yok say */ } }
  scene.spawnParticles?.(p.x, p.y, 0xd94f4f, 4);
}

function onZombieDeath(scene, info) {
  if (!inView(scene, info.x, info.y, 40)) return;
  // Yerde kalıcı leke (havuzlu, yavaşça kaybolur)
  const max = lowFx() ? 12 : 30;
  let s = J.splats.find((o) => !o.visible);
  if (!s && J.splats.length < max) { s = scene.add.image(0, 0, 'fx_splat0').setDepth(-5); J.splats.push(s); }
  if (!s) s = J.splats.reduce((a, b) => (a.born < b.born ? a : b));
  scene.tweens.killTweensOf(s);
  s.setTexture(`fx_splat${Phaser.Math.Between(0, 2)}`).setPosition(info.x, info.y + 6 * info.sy).setVisible(true)
    .setAlpha(0.85).setScale(info.boss ? 2 : info.sx).setFlipX(Math.random() < 0.5);
  s.born = scene.time.now;
  scene.tweens.add({ targets: s, alpha: 0, delay: 9000, duration: 3000, onComplete: () => s.setVisible(false) });
  // Devrilen ceset hayaleti
  if (!lowFx() && scene.textures.exists(info.key)) {
    const g = scene.add.image(info.x, info.y, info.key, 0).setFlipX(info.flip).setScale(info.sx, info.sy).setDepth(info.y).setTintFill(0xffffff);
    scene.tweens.add({ targets: g, angle: info.flip ? -90 : 90, y: info.y + 4, duration: 220, ease: 'Quad.easeIn' });
    scene.time.delayedCall(70, () => { if (g.active) g.clearTint().setTint(0x8aa070); });
    scene.tweens.add({ targets: g, alpha: 0, delay: 350, duration: 700, onComplete: () => g.destroy() });
  }
  scene.spawnParticles(info.x, info.y, 0x2f4a20, 4); // çekirdek zaten 12 parçacık saçıyor; koyu ton ekle
  if (info.boss) scene.cameras.main.shake(350, 0.01);
  else if (info.sx > 1.2) scene.cameras.main.shake(90, 0.003);
}

function spark(scene, x, y, tint) {
  if (!J.sparks) return;
  let s = J.sparks.find((o) => !o.visible) || J.sparks[0];
  scene.tweens.killTweensOf(s);
  s.setPosition(x, y).setTint(tint).setVisible(true).setAlpha(1).setScale(0.6).setAngle(Phaser.Math.Between(0, 3) * 22);
  scene.tweens.add({ targets: s, scale: 1.3, alpha: 0, duration: 140, ease: 'Quad.easeOut', onComplete: () => s.setVisible(false) });
}

// Kısa fizik + tween dondurma (vuruş hissi)
function hitStop(scene, ms) {
  if (scene.gameOver || scene.hud.isModalOpen()) return;
  const now = performance.now();
  if (J.stopUntil && now < J.stopUntil + 80) return; // art arda kilitlenmesin
  const w = scene.physics.world;
  if (w.isPaused) return;
  J.stopUntil = now + ms;
  w.pause();
  const ts = scene.tweens.timeScale;
  scene.tweens.timeScale = 0.05;
  setTimeout(() => {
    if (J.scene !== scene) return;
    scene.tweens.timeScale = ts || 1;
    if (!scene.gameOver && !scene.hud.isModalOpen() && w.isPaused) w.resume();
  }, ms);
}

function processQueue(scene) {
  if (!J.queue.length) return;
  for (const q of J.queue) {
    if (q.kind === 'p') { if (cfg.dmgNums) showNum(q.x, q.y, `-${fmt(q.dmg)}`, '#ff5a5a', false); continue; }
    if (q.crit) { audio.sfx('crit'); scene.spawnParticles(q.x, q.y + 6, 0xffd166, lowFx() ? 2 : 4); }
    if (cfg.dmgNums && inView(scene, q.x, q.y)) showNum(q.x, q.y, q.crit ? `${fmt(q.dmg)}!` : fmt(q.dmg), q.crit ? '#ffd166' : '#ffffff', q.crit);
  }
  J.queue.length = 0;
}
const fmt = (n) => String(Math.round(n * 10) / 10);

// Başka modüller kritik vuruşu olayla bildirirse aynı karedeki sayıyı sarıya çevir
function markCrit(p) {
  const t = p?.target || p?.zombie || p;
  const q = J.queue.find((e) => e.target === t) || J.queue[J.queue.length - 1];
  if (q) q.crit = true;
}

// ---------------- Vinyet ----------------
function vignette(kind) {
  const v = J.vig;
  if (!v) return;
  if (kind === 'low') { v.classList.add('low'); return; }
  if (kind === 'nolow') { v.classList.remove('low'); return; }
  v.classList.remove('wave', 'hurt', 'dawn');
  void v.offsetWidth;
  v.classList.add(kind);
}

// ---------------- Hareket efektleri ----------------
function updateMotion(scene, dt) {
  const p = scene.player;
  if (!p.alive || !p.body) return;
  const vx = p.body.velocity.x, vy = p.body.velocity.y;
  const sp = Math.hypot(vx, vy);
  const rolling = p.rolling || p.isRolling || p.dodging || sp > 115;
  if (rolling) {
    J.trailT -= dt;
    if (J.trailT <= 0) { J.trailT = 0.035; ghost(scene, p); }
  }
  if (sp > 20) {
    J.dustT -= dt;
    if (J.dustT <= 0) {
      J.dustT = lowFx() ? 0.36 : 0.18;
      dust(scene, p.x - Math.sign(vx) * 2, p.y + 7);
    }
  } else J.dustT = 0.05;
}

function dust(scene, x, y) {
  let d = J.dusts.find((o) => !o.visible);
  if (!d) return;
  d.setPosition(x + Phaser.Math.Between(-1, 1), y).setVisible(true).setAlpha(0.8).setScale(0.6).setDepth(y - 2);
  scene.tweens.add({ targets: d, y: y - 3, scale: 1.3, alpha: 0, duration: 380, ease: 'Quad.easeOut', onComplete: () => d.setVisible(false) });
}

function ghost(scene, p) {
  let g = J.ghosts.find((o) => !o.visible);
  if (!g) return;
  g.setTexture(p.texture.key, p.frame.name).setPosition(p.x, p.y).setFlipX(p.flipX).setScale(p.scaleX, p.scaleY)
    .setAngle(p.angle).setDepth(p.depth - 1).setVisible(true).setAlpha(0.45).setTintFill(0x9ad0ff);
  scene.tweens.add({ targets: g, alpha: 0, duration: 200, onComplete: () => g.setVisible(false) });
}

// ---------------- Hasat uçuşu ----------------
function flyToPlayer(scene, x, y, itemId, delay) {
  const icon = ITEMS[itemId]?.icon;
  if (!icon || !scene.textures.exists(icon)) return;
  const img = scene.add.image(x, y, icon).setDepth(14000).setScale(0.7);
  const hop = Phaser.Math.Between(18, 26), side = Phaser.Math.Between(-10, 10);
  const o = { t: 0 };
  scene.tweens.add({
    targets: o, t: 1, delay, duration: 480, ease: 'Sine.easeIn',
    onUpdate: () => {
      const p = scene.player, t = o.t;
      const ex = p.x, ey = p.y - 6;
      const cx = (x + ex) / 2 + side, cy = Math.min(y, ey) - hop;
      // İkinci dereceden Bezier: hedef oyuncu hareket etse de takip eder
      img.setPosition((1 - t) * (1 - t) * x + 2 * (1 - t) * t * cx + t * t * ex, (1 - t) * (1 - t) * y + 2 * (1 - t) * t * cy + t * t * ey);
      img.setScale(0.7 + Math.sin(t * Math.PI) * 0.25 - t * 0.3);
    },
    onComplete: () => {
      img.destroy();
      audio.sfx('pop');
      const p = scene.player;
      scene.spawnParticles(p.x, p.y - 6, 0xfff2a8, lowFx() ? 2 : 4);
      // Oyuncu küçük bir "esneme"
      if (!J.squash) {
        J.squash = true;
        scene.tweens.add({ targets: p, scaleY: 0.88, scaleX: 1.1, duration: 60, yoyo: true, onComplete: () => { J.squash = false; p.setScale(1); } });
      }
    }
  });
}

function wrapHarvest(scene) {
  const farm = scene.farm;
  if (!farm || farm.__juice) return;
  const orig = farm.harvest;
  farm.harvest = function (tx, ty) {
    const r = orig.apply(this, arguments);
    if (r && r.item) {
      const x = tx * TILE + 8, y = ty * TILE + 6;
      const n = Math.min(3, r.qty || 1);
      for (let i = 0; i < n; i++) flyToPlayer(scene, x, y, r.item, i * 80);
      if (r.seed && r.seedQty) flyToPlayer(scene, x, y, r.seed, n * 80);
    }
    return r;
  };
  farm.__juice = true;
}

// ---------------- Ağaç sallanması ----------------
function resetTrees(scene) {
  J.swayed = false;
  scene.resources?.getChildren().forEach((r) => { if (r.texture.key.startsWith('tree_sway')) r.setTexture('tree'); });
}

function updateTrees(scene) {
  if (!J.swayOk || lowFx()) { if (J.swayed) resetTrees(scene); return; }
  const t = scene.time.now / 1000;
  const gust = 0.6 + 0.6 * Math.sin(t * 0.23) + 0.3 * weatherRain(scene); // rüzgar şiddeti
  const v = scene.cameras.main.worldView;
  J.swayed = true;
  for (const r of scene.resources.getChildren()) {
    if (r.kind !== 'tree' || r.depleted || !r.visible) continue;
    const k = r.texture.key;
    if (k !== 'tree' && k !== 'tree_sway_l' && k !== 'tree_sway_r') continue;
    if (r.x < v.x - 20 || r.x > v.right + 20 || r.y < v.y - 30 || r.y > v.bottom + 30) continue;
    const s = Math.sin(t * 1.6 + r.x * 0.07 + r.y * 0.031) * gust;
    const want = s > 0.55 ? 'tree_sway_r' : s < -0.55 ? 'tree_sway_l' : 'tree';
    if (want !== k) r.setTexture(want);
  }
}

// ---------------- Gece ışıkları ve ateş böcekleri ----------------
function buildGlows(scene) {
  J.glows = (scene.staticLights || []).map((l) => scene.add.image(l.x, l.y, 'light').setDepth(19990).setBlendMode(Phaser.BlendModes.ADD)
    .setTint(0xff9a40).setScale((l.r * 1.1) / 128).setAlpha(0).setVisible(false));
  J.flies = [];
  for (let i = 0; i < 10; i++) {
    const f = scene.add.image(0, 0, 'fx_firefly').setDepth(20005).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    f.ph = Math.random() * 10;
    J.flies.push(f);
  }
}

function updateNightFx(scene, dt) {
  const dark = scene.timeSys.darkness;
  const on = dark > 0.25;
  const t = scene.time.now / 1000;
  // Fener/ocak titremesi (sıcak parıltı)
  J.glows.forEach((g, i) => {
    g.setVisible(on);
    if (on) g.setAlpha((0.16 + Math.sin(t * 9 + i * 2) * 0.03 + Math.sin(t * 23 + i) * 0.02) * dark);
  });
  const flies = on && !lowFx();
  const v = scene.cameras.main.worldView;
  for (const f of J.flies) {
    if (!flies) { f.setVisible(false); continue; }
    if (!f.visible || f.x < v.x - 30 || f.x > v.right + 30 || f.y < v.y - 30 || f.y > v.bottom + 30) {
      f.setPosition(v.x + Math.random() * v.width, v.y + Math.random() * v.height).setVisible(true);
      f.vx = Phaser.Math.FloatBetween(-6, 6); f.vy = Phaser.Math.FloatBetween(-6, 6);
    }
    f.vx += Phaser.Math.FloatBetween(-20, 20) * dt; f.vy += Phaser.Math.FloatBetween(-20, 20) * dt;
    f.vx = Phaser.Math.Clamp(f.vx, -10, 10); f.vy = Phaser.Math.Clamp(f.vy, -10, 10);
    f.x += f.vx * dt; f.y += f.vy * dt;
    f.setAlpha(0.35 + 0.65 * Math.max(0, Math.sin(t * 2.2 + f.ph)));
  }
}

// ---------------- Su parıltısı (haritada mavi tonlu tile varsa) ----------------
function updateWater(scene) {
  if (!J.waterIdx || !J.waterIdx.size || lowFx() || !J.glints) return;
  const v = scene.cameras.main.worldView;
  const data = scene.layer?.layer?.data;
  if (!data) return;
  for (let k = 0; k < 3; k++) {
    const tx = Math.floor((v.x + Math.random() * v.width) / TILE), ty = Math.floor((v.y + Math.random() * v.height) / TILE);
    const tile = data[ty]?.[tx];
    if (!tile || !J.waterIdx.has(tile.index)) continue;
    const g = J.glints.find((o) => !o.visible);
    if (!g) return;
    g.setPosition(tx * TILE + Phaser.Math.Between(2, 14), ty * TILE + Phaser.Math.Between(2, 14)).setVisible(true).setAlpha(0).setScale(0.5);
    scene.tweens.add({ targets: g, alpha: 0.9, scale: 1, duration: 260, yoyo: true, onComplete: () => g.setVisible(false) });
  }
}

// ---------------- Mini harita ----------------
const MM_W = MAP_W * 2, MM_H = MAP_H * 2; // 128x88 (2px/tile)

// Tile index → ortalama renk (tileset'ten örneklenir; yeni tile türleri de otomatik çalışır)
function tileColors(scene) {
  const out = {};
  const ts = scene.layer?.tileset?.[0];
  const img = ts?.image?.getSourceImage?.();
  if (!img) return out;
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const cols = Math.floor(img.width / TILE), rows = Math.floor(img.height / TILE);
  J.waterIdx = new Set();
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const d = ctx.getImageData(q * TILE, r * TILE, TILE, TILE).data;
    let rr = 0, gg = 0, bb = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; }
    if (!n) continue;
    rr = rr / n | 0; gg = gg / n | 0; bb = bb / n | 0;
    const idx = (ts.firstgid || 0) + r * cols + q;
    out[idx] = `rgb(${rr},${gg},${bb})`;
    if (bb > rr + 25 && bb > gg + 5) J.waterIdx.add(idx);
  }
  return out;
}

function buildMinimapBg(scene) {
  const bg = J.mmBg || (J.mmBg = document.createElement('canvas'));
  bg.width = MM_W; bg.height = MM_H;
  const ctx = bg.getContext('2d');
  if (!J.tileCols) J.tileCols = tileColors(scene);
  const data = scene.layer?.layer?.data || [];
  ctx.fillStyle = '#3d6b35'; ctx.fillRect(0, 0, MM_W, MM_H);
  for (let y = 0; y < data.length; y++) {
    const row = data[y];
    for (let x = 0; x < row.length; x++) {
      const c = J.tileCols[row[x].index];
      if (c) { ctx.fillStyle = c; ctx.fillRect(x * 2, y * 2, 2, 2); }
    }
  }
  const s = 2 / TILE;
  const rect = (o, col) => {
    const w = (o.displayWidth || 16) * s, h = (o.displayHeight || 16) * s;
    ctx.fillStyle = col; ctx.fillRect(Math.round(o.x * s - w / 2), Math.round(o.y * s - h / 2), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  };
  scene.obstacles?.getChildren().forEach((o) => { if (o.visible) rect(o, o.texture?.key === 'fence' ? '#8a5a3a' : '#5d3c27'); });
  scene.resources?.getChildren().forEach((r) => {
    if (r.depleted || !r.visible) return;
    ctx.fillStyle = r.kind === 'tree' ? '#1f4a26' : '#8d8f99';
    ctx.fillRect(Math.round(r.x * s) - 1, Math.round(r.y * s) - 1, 2, 2);
  });
  if (scene.shelter) rect(scene.shelter, '#c94040');
  J.mmBgDirty = false;
}

function buildMinimap(scene) {
  const layer = featureLayer();
  if (!layer) return;
  document.getElementById('jc-minimap')?.remove();
  const box = el('div', 'glass', '');
  box.id = 'jc-minimap';
  const cv = document.createElement('canvas');
  cv.width = MM_W; cv.height = MM_H;
  box.appendChild(cv);
  box.appendChild(el('span', 'jc-lbl', 'N'));
  box.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    cfg.mapBig = !cfg.mapBig; saveCfg();
    box.classList.toggle('big', cfg.mapBig);
  });
  layer.appendChild(box);
  J.mm = box; J.mmCtx = cv.getContext('2d');
  box.classList.toggle('big', !!cfg.mapBig);
  setMinimap(cfg.minimap, true);
  buildMinimapBg(scene);
}

function setMinimap(on, silent) {
  cfg.minimap = !!on; saveCfg();
  J.mm?.classList.toggle('show', cfg.minimap && J.scene?.started !== false);
  if (!silent) J.scene?.hud.toast(cfg.minimap ? 'Mini harita açık 🗺️' : 'Mini harita kapalı', 'info');
}

function drawMinimap(scene) {
  if (!J.mmCtx || !cfg.minimap || document.hidden) return;
  if (J.mmBgDirty) buildMinimapBg(scene);
  const ctx = J.mmCtx, s = 2 / TILE;
  ctx.drawImage(J.mmBg, 0, 0);
  const dark = scene.timeSys.darkness;
  if (dark > 0.05) { ctx.fillStyle = `rgba(7,11,34,${dark * 0.45})`; ctx.fillRect(0, 0, MM_W, MM_H); }
  const dot = (x, y, col, r = 1) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x * s) - r, Math.round(y * s) - r, r * 2, r * 2); };
  scene.barricades?.getChildren().forEach((b) => dot(b.x, b.y, '#c9a06b', 1));
  scene.turrets?.getChildren().forEach((t) => dot(t.x, t.y, '#ffd166', 1));
  for (const n of scene.npcs || []) if (!n.hidden && n.visible) dot(n.x, n.y, '#5ad0ff', 1);
  (scene.minimapDots || []).forEach((fn) => { try { (fn(scene) || []).forEach((d) => dot(d.x, d.y, d.color || '#fff', d.r || 1)); } catch { /* yok say */ } });
  scene.zombies?.getChildren().forEach((z) => { if (!z.dead) dot(z.x, z.y, isBoss(z) ? '#ff2bd6' : '#ff3b3b', z.scaleX > 1.2 || isBoss(z) ? 2 : 1); });
  // Kamera görüş alanı
  const v = scene.cameras.main.worldView;
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(v.x * s) + 0.5, Math.round(v.y * s) + 0.5, Math.round(v.width * s), Math.round(v.height * s));
  // Oyuncu (yanıp sönen)
  const p = scene.player;
  ctx.fillStyle = '#000'; ctx.fillRect(Math.round(p.x * s) - 2, Math.round(p.y * s) - 2, 4, 4);
  ctx.fillStyle = (scene.time.now % 1000) < 600 ? '#ffffff' : '#ffe08a'; ctx.fillRect(Math.round(p.x * s) - 1, Math.round(p.y * s) - 1, 2, 2);
}

// ---------------- Düşük efekt modu (FPS izleme) ----------------
function updatePerf(scene, dt) {
  if (cfg.quality !== 'auto') { scene.lowFx = cfg.quality === 'low'; return; }
  J.perfT += dt;
  if (J.perfT < 1) return;
  J.perfT = 0;
  const fps = scene.game.loop.actualFps || 60;
  if (fps < 45) { J.bad++; J.good = 0; } else if (fps > 55) { J.good++; J.bad = Math.max(0, J.bad - 1); }
  if (!scene.lowFx && J.bad >= 4) { scene.lowFx = true; J.bad = 0; }
  else if (scene.lowFx && J.good >= 20) { scene.lowFx = false; J.good = 0; }
}

// ---------------- Ses ortamı ----------------
function updateSoundscape(scene) {
  const night = scene.timeSys.isNight;
  const rain = weatherRain(scene);
  audio.setAmbient({ day: !night && scene.timeSys.hour >= 5 && scene.timeSys.hour < 19, night: night || scene.timeSys.hour >= 19, rain });
  // Gece zombi yoğunluğuna göre müzik katmanları/tempo
  const n = scene.waves.active ? scene.zombies.countActive(true) : 0;
  audio.setIntensity(night ? Math.min(1, n / 16 + (scene.waves.active ? 0.15 : 0)) : 0);
  // Düşük can: kalp atışı + kırmızı nabız
  const p = scene.player;
  const low = p.alive && p.hp > 0 && p.hp / p.maxHp < 0.3;
  if (low !== J.lowHp) { J.lowHp = low; vignette(low ? 'low' : 'nolow'); }
  if (low) audio.sfx('heartbeat');
}

// ---------------- Ayarlar paneli ----------------
function openSettings(scene) {
  const body = el('div', 'jc-set');
  const row = (label, ctrl) => { const r = el('div', 'jc-row'); r.appendChild(el('span', '', label)); r.appendChild(ctrl); body.appendChild(r); };
  const slider = (key) => {
    const i = document.createElement('input');
    i.type = 'range'; i.min = '0'; i.max = '100'; i.value = String(Math.round(cfg[key] * 100));
    i.addEventListener('input', () => { cfg[key] = Number(i.value) / 100; audio.setVolumes({ [key]: cfg[key] }); saveCfg(); });
    return i;
  };
  const toggle = (key, onChange) => {
    const b = el('button', `jc-tog ${cfg[key] ? 'on' : ''}`, cfg[key] ? 'Açık' : 'Kapalı');
    b.addEventListener('click', () => {
      cfg[key] = !cfg[key]; saveCfg();
      b.classList.toggle('on', cfg[key]); b.textContent = cfg[key] ? 'Açık' : 'Kapalı';
      onChange?.(cfg[key]); audio.sfx('click');
    });
    return b;
  };
  row('🎵 Müzik', slider('music'));
  row('🔊 Efektler', slider('sfx'));
  row('🐦 Ortam sesleri', slider('amb'));
  const seg = el('div', 'jc-seg');
  [['auto', 'Otomatik'], ['high', 'Yüksek'], ['low', 'Düşük']].forEach(([k, label]) => {
    const b = el('button', cfg.quality === k ? 'on' : '', label);
    b.addEventListener('click', () => {
      cfg.quality = k; saveCfg();
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      scene.lowFx = k === 'low'; J.bad = 0; J.good = 0;
      audio.sfx('click');
    });
    seg.appendChild(b);
  });
  row('✨ Efekt kalitesi', seg);
  row('💥 Hasar sayıları', toggle('dmgNums'));
  row('📳 Ekran sarsıntısı', toggle('shake'));
  row('🗺️ Mini harita (N)', toggle('minimap', (v) => setMinimap(v, true)));
  const note = el('p', 'jc-note', `Çalan parça: ${audio.songName || '—'} · ${scene.lowFx ? 'Düşük efekt modu etkin' : 'Tam efekt'}`);
  body.appendChild(note);
  scene.hud.openPanel('Görüntü ve Ses', body);
}

// ---------------- Özellik ----------------
export default {
  id: 'juice',

  textures(scene) {
    makeTextures(scene);
  },

  init(scene) {
    Object.assign(J, {
      scene, queue: [], critTarget: null, stopUntil: 0, dustT: 0, trailT: 0, perfT: 0, bad: 0, good: 0, sndT: 0, treeT: 0, mmT: 0, waterT: 0,
      lowHp: false, swayed: false, squash: false, tileCols: null, waterIdx: null, mmBgDirty: true
    });
    // 'auto' modunda mobile modülünün dokunmatik ön ayarını koru; FPS iyiyse updatePerf yükseltir
    scene.lowFx = cfg.quality === 'auto' ? !!scene.lowFx : cfg.quality === 'low';
    injectCSS('juice', CSS);
    audio.setVolumes({ music: cfg.music, sfx: cfg.sfx, amb: cfg.amb });

    // Havuzlar
    buildNumPool(scene);
    J.sparks = Array.from({ length: 6 }, () => scene.add.image(0, 0, 'fx_spark').setDepth(15400).setVisible(false));
    J.dusts = Array.from({ length: 10 }, () => scene.add.image(0, 0, 'fx_dust').setVisible(false));
    J.ghosts = Array.from({ length: 8 }, () => scene.add.image(0, 0, 'player').setVisible(false));
    J.glints = Array.from({ length: 6 }, () => scene.add.image(0, 0, 'fx_glint').setDepth(-4).setVisible(false));
    J.splats = [];
    buildGlows(scene);
    J.swayOk = makeSwayTextures(scene);

    // Parçacık sayısını düşük efekt modunda yarıya indir
    const origP = scene.spawnParticles.bind(scene);
    scene.spawnParticles = (x, y, color, n = 6) => origP(x, y, color, scene.lowFx ? Math.max(1, Math.ceil(n / 2)) : n);
    // Sarsıntı ayarı (kapalıysa tüm sarsıntılar yok sayılır)
    const cam = scene.cameras.main;
    const origShake = cam.shake.bind(cam);
    cam.shake = (...a) => (cfg.shake ? origShake(...a) : cam);

    wrapHarvest(scene);

    // DOM: vinyet + mini harita
    const layer = featureLayer();
    document.getElementById('jc-vignette')?.remove();
    if (layer) {
      J.vig = el('div', '');
      J.vig.id = 'jc-vignette';
      layer.prepend(J.vig);
    }
    buildMinimap(scene);
    scene.minimapDots = scene.minimapDots || []; // diğer modüller: fn(scene) → [{x,y,color,r}]

    // Menü girişleri (mobil menü + masaüstü dock)
    scene.featureMenu.push({ id: 'minimap', icon: '🗺️', label: 'Mini Harita', key: 'N', open: () => setMinimap(!cfg.minimap) });
    scene.featureMenu.push({ id: 'juice-settings', icon: '🎛️', label: 'Görüntü & Ses', open: (s) => openSettings(s) });

    // N tuşu
    const onKey = (ev) => {
      if (ev.key?.toLowerCase() !== 'n' || !scene.started || scene.gameOver || scene.hud.isModalOpen()) return;
      setMinimap(!cfg.minimap);
    };
    scene.input.keyboard?.on('keydown', onKey);

    // Olaylar
    const on = [];
    const listen = (name, fn) => { scene.events.on(name, fn); on.push([name, fn]); };
    listen('waveStart', () => {
      vignette('wave');
      scene.cameras.main.shake(250, 0.006);
      audio.sfx('drum');
      if (navigator.vibrate && isTouch()) { try { navigator.vibrate([40, 60, 40]); } catch { /* yok say */ } }
    });
    listen('waveEnd', () => { vignette('dawn'); J.mmBgDirty = true; });
    listen('structureDestroyed', (s) => {
      if (!s) return;
      scene.spawnParticles(s.x, s.y, 0x8a5a3a, 10);
      audio.sfx('break');
      if (inView(scene, s.x, s.y)) scene.cameras.main.shake(120, 0.004);
    });
    listen('levelUp', () => {
      const p = scene.player;
      audio.sfx('levelup');
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = scene.add.rectangle(p.x, p.y, 2, 2, 0xffd166).setDepth(15000);
        scene.tweens.add({ targets: r, x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18, alpha: 0, duration: 500, ease: 'Quad.easeOut', onComplete: () => r.destroy() });
      }
    });
    ['crit', 'criticalHit'].forEach((n) => listen(n, markCrit));
    listen('combatHit', (h) => { J.critTarget = h?.crit ? h.target : null; });
    listen('playerDodge', (d) => {
      audio.sfx('roll');
      // Yuvarlanma başında arkada küçük toz bulutu
      const n = lowFx() ? 1 : 3;
      for (let i = 0; i < n; i++) dust(scene, (d?.x ?? scene.player.x) - (d?.dx || 0) * 4 + Phaser.Math.Between(-3, 3), (d?.y ?? scene.player.y) + 7);
    });
    listen('fishCaught', () => audio.sfx('splash'));
    listen('bossSpawned', () => {
      vignette('wave');
      scene.cameras.main.shake(400, 0.008);
      audio.sfx('drum');
    });
    listen('weatherChanged', () => updateSoundscape(scene));
    listen('seasonChanged', () => {
      // Mevsim dokusu değişmiş olabilir: ağaçları sıfırla, varyantları biraz sonra yeniden üret
      resetTrees(scene); J.swayOk = false;
      scene.time.delayedCall(150, () => { J.swayOk = makeSwayTextures(scene); J.tileCols = null; J.mmBgDirty = true; });
    });
    listen('shelterFallen', () => { audio.setAmbient(null); audio.setIntensity(0); vignette('nolow'); });
    const dawn = () => { J.mmBgDirty = true; };
    scene.timeSys.on('dawn', dawn);

    scene.events.once('shutdown', () => {
      on.forEach(([n, fn]) => scene.events.off(n, fn));
      scene.timeSys.off('dawn', dawn);
      scene.input.keyboard?.off('keydown', onKey);
      J.queue = [];
      if (J.scene === scene) J.scene = null;
    });
  },

  begin(scene) {
    setMinimap(cfg.minimap, true);
    J.mm?.classList.toggle('show', cfg.minimap);
    J.mmBgDirty = true;
    updateSoundscape(scene);
  },

  update(scene, dt) {
    processQueue(scene);
    updateNums(dt);
    updateMotion(scene, dt);
    updatePerf(scene, dt);

    J.sndT -= dt;
    if (J.sndT <= 0) { J.sndT = 1; updateSoundscape(scene); }
    J.treeT -= dt;
    if (J.treeT <= 0) { J.treeT = 0.25; updateTrees(scene); }
    J.mmT -= dt;
    if (J.mmT <= 0) { J.mmT = 0.25; drawMinimap(scene); } // 4 Hz
    J.waterT -= dt;
    if (J.waterT <= 0) { J.waterT = 0.35; updateWater(scene); }
    updateNightFx(scene, dt);
  }
};
