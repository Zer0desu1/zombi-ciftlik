// 'monsters' özellik modülü — Gündüz de haritada dolaşan gezgin canavarlar (slime'lar):
//   • Yeşil Slime: yavaş zıplar, temasta küçük hasar
//   • Buz Slime'ı (mavi): temasta oyuncuyu kısa süre yavaşlatır
//   • Mor Kral Slime (büyük): ölünce 2 küçük mor slime'a bölünür
// Köyden/sığınaktan/tarladan uzak çimlerde belirir (en fazla MAX_SLIMES), kendi bölgesinde gezinir;
// oyuncu yaklaşınca ona doğru zıplar, çok uzaklaşınca bırakır. Gece yenisi çıkmaz, mevcutlar kalır.
// Durum scene.monsters üzerinde; canavarlar scene.monsters.slimes dizisinde ve scene.huntables'ta
// (geyiklerle birleşik liste, her kare yenilenir) durur → PlayerActions.melee ve çok oyunculu eşitleme görür.
// Her canavar sıradan bir Phaser Arcade sprite'ıdır (Actor): görünüm yalnızca texture/frame/x/y/flipX/alpha/tint.
import { TILE, MAP_W, MAP_H, ITEMS, RECIPES, FARM_ZONE, SHELTER_TILE } from '../config.js';
import { addCanvas, makeCanvas, R, outline } from '../textures.js';
import { audio } from '../audio.js';
import { Actor } from '../entities/Actor.js';
import { hitTarget } from '../systems/PlayerActions.js';

// ---------- Veri tabloları ----------
Object.assign(ITEMS, {
  slime_gel: { name: 'Jöle', type: 'material', icon: 'i_slime_gel', sell: 4, desc: 'Slime\'lardan düşen yapışkan jöle. Kompostta gübreye dönüşür.' }
});

RECIPES.push(
  { out: 'fertilizer', qty: 2, cost: { slime_gel: 2 } } // jöle kompostu
);

// ---------- Ayarlar ----------
const MAX_SLIMES = 8;
const AGGRO = 80;            // oyuncu bu kadar yaklaşınca kovalar
const LEASH = 170;           // oyuncu bundan uzaktaysa bırakır
const HOME_LEASH = 260;      // yuvasından bu kadar uzaklaştıysa bırakır
const SAFE_FROM_SHELTER = 230; // sığınağa bu mesafeden yakına doğmaz
const RESPAWN_EVERY = 25;    // gündüz yeni slime denemesi (sn)
const SLOW_TIME = 2.2, SLOW_MUL = 0.55;
const TOWN = { x0: 22, y0: 7, x1: 60, y1: 38 };
const PEN = { x0: 22, y0: 2, x1: 32, y1: 12 };

// fw/fh: kare boyutu; sizes: [normal, ezilme, uzama] gövde (genişlik, yükseklik)
const KINDS = {
  green:  { name: 'Yeşil Slime',      hp: 4,  dmg: 5, hop: 62, air: 0.36, rest: [0.9, 1.6], chaseRest: [0.35, 0.6], reach: 10, loot: [1, 2], weight: 55,
            fw: 16, fh: 14, sizes: [[12, 9], [14, 7], [10, 12]], pal: { base: '#5fc25a', light: '#a8ec8a', dark: '#3a8a3e', ink: '#1f4a28' }, dot: '#7bd389' },
  blue:   { name: 'Buz Slime\'ı',      hp: 4,  dmg: 4, hop: 72, air: 0.34, rest: [0.8, 1.5], chaseRest: [0.3, 0.55], reach: 10, loot: [1, 2], weight: 30, slow: true,
            fw: 16, fh: 14, sizes: [[12, 9], [14, 7], [10, 12]], pal: { base: '#5aa8e8', light: '#bfe6ff', dark: '#336fb0', ink: '#1a3358' }, dot: '#7ac8ff' },
  purple: { name: 'Mor Kral Slime',   hp: 10, dmg: 8, hop: 52, air: 0.42, rest: [1.2, 2.0], chaseRest: [0.5, 0.8], reach: 14, loot: [2, 2], weight: 15, split: 'mini',
            fw: 24, fh: 22, sizes: [[18, 13], [22, 10], [14, 17]], pal: { base: '#9a5ad0', light: '#d2a8f2', dark: '#683a9a', ink: '#2e1846' }, dot: '#c08aff', crown: true },
  mini:   { name: 'Küçük Mor Slime',  hp: 2,  dmg: 3, hop: 78, air: 0.28, rest: [0.6, 1.1], chaseRest: [0.25, 0.45], reach: 8, loot: [1, 1], weight: 0,
            fw: 12, fh: 11, sizes: [[8, 6], [10, 5], [6, 8]], pal: { base: '#a86ad8', light: '#dcb8f6', dark: '#70429e', ink: '#2e1846' }, dot: '#c08aff' }
};

// ---------- Dokular ----------
// Kubbe biçimli jöle gövdesi: alt kenar (fh-2) hizalı, ortalanmış
function drawSlime(ctx, k, f) {
  const { fw, fh, pal } = k;
  const [bw, bh] = k.sizes[f];
  const x0 = Math.round((fw - bw) / 2), y0 = fh - 1 - bh;
  for (let yy = 0; yy < bh; yy++) {
    const t = (yy + 0.5) / bh;
    const u = Math.min(1, t / 0.72);
    let hw = (bw / 2) * Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u)));
    if (yy === bh - 1) hw -= 1; // alt köşeler yuvarlak
    const w = Math.max(1, Math.round(hw * 2));
    const x = x0 + Math.round((bw - w) / 2);
    const col = yy >= bh - 2 ? pal.dark : pal.base;
    R(ctx, x, y0 + yy, w, 1, col);
  }
  // parlaklık (sol üst) + yansıma noktası
  R(ctx, x0 + Math.round(bw * 0.22), y0 + Math.max(1, Math.round(bh * 0.18)), Math.max(1, Math.round(bw * 0.18)), 1, pal.light);
  R(ctx, x0 + Math.round(bw * 0.2), y0 + Math.max(2, Math.round(bh * 0.18) + 1), 1, 1, pal.light);
  R(ctx, x0 + Math.round(bw * 0.72), y0 + Math.max(1, Math.round(bh * 0.25)), 1, 1, '#ffffff');
  // gözler (ezilince aşağı, uzayınca yukarı)
  const ey = y0 + Math.round(bh * 0.5);
  const ex1 = x0 + Math.round(bw * 0.32), ex2 = x0 + Math.round(bw * 0.62);
  const eh = k.fw >= 20 ? 2 : 1 + (f === 2 ? 1 : 0);
  R(ctx, ex1, ey, 1, eh, '#1b1622'); R(ctx, ex2, ey, 1, eh, '#1b1622');
  if (k.fw >= 20) { R(ctx, ex1 + 1, ey, 1, eh, '#1b1622'); R(ctx, ex2 + 1, ey, 1, eh, '#1b1622'); R(ctx, ex1, ey, 1, 1, '#ffffff'); R(ctx, ex2, ey, 1, 1, '#ffffff'); }
  // ağız
  if (k.fw >= 12) R(ctx, x0 + Math.round(bw * 0.46), ey + eh + 1, Math.max(1, Math.round(bw * 0.1)), 1, pal.dark);
  // taç (kral slime)
  if (k.crown) {
    const cx = x0 + Math.round(bw / 2) - 3, cy = y0 - 2;
    R(ctx, cx, cy, 7, 2, '#f2c94c'); R(ctx, cx, cy - 2, 1, 2, '#f2c94c'); R(ctx, cx + 3, cy - 2, 1, 2, '#f2c94c'); R(ctx, cx + 6, cy - 2, 1, 2, '#f2c94c');
    R(ctx, cx + 3, cy, 1, 1, '#eb5757');
  }
}

function makeTextures(scene) {
  Object.entries(KINDS).forEach(([id, k]) => {
    const key = 'mn_' + id;
    const tex = addCanvas(scene, key, k.fw * 3, k.fh, (ctx) => {
      for (let f = 0; f < 3; f++) {
        const { c, ctx: fc } = makeCanvas(k.fw, k.fh);
        drawSlime(fc, k, f);
        outline(fc, 0, 0, k.fw, k.fh, k.pal.ink);
        ctx.drawImage(c, f * k.fw, 0);
      }
    });
    for (let f = 0; f < 3; f++) tex.add(f, 0, f * k.fw, 0, k.fw, k.fh);
  });
  addCanvas(scene, 'i_slime_gel', 16, 16, (ctx) => {
    R(ctx, 3, 7, 10, 7, '#5fc25a'); R(ctx, 4, 5, 8, 2, '#5fc25a'); R(ctx, 6, 3, 4, 2, '#5fc25a');
    R(ctx, 2, 12, 12, 2, '#3a8a3e'); R(ctx, 5, 6, 2, 1, '#a8ec8a'); R(ctx, 4, 7, 1, 2, '#a8ec8a');
    R(ctx, 10, 6, 1, 1, '#ffffff'); R(ctx, 12, 14, 1, 1, '#3a8a3e'); R(ctx, 7, 14, 2, 1, '#3a8a3e');
    outline(ctx, 0, 0, 16, 16, '#1f4a28');
  });
}

// ---------- Yardımcılar ----------
const M = (scene) => scene.monsters;
const shelterCenter = () => ({ x: SHELTER_TILE.x * TILE + 32, y: SHELTER_TILE.y * TILE + 28 });

function grassTile(scene, tx, ty) {
  if (tx < 1 || ty < 2 || tx >= MAP_W - 1 || ty >= MAP_H - 1) return false;
  if (tx >= TOWN.x0 && ty >= TOWN.y0 && tx <= TOWN.x1 && ty <= TOWN.y1) return false;
  if (tx >= PEN.x0 && ty >= PEN.y0 && tx <= PEN.x1 && ty <= PEN.y1) return false;
  const fz = FARM_ZONE;
  if (tx >= fz.x - 2 && ty >= fz.y - 2 && tx <= fz.x + fz.w + 1 && ty <= fz.y + fz.h + 1) return false;
  if (scene.farm?.get(tx, ty)) return false;
  const t = scene.layer?.getTileAt(tx, ty);
  if (!t || t.index > 2) return false;
  if (scene.lakeRect && Phaser.Geom.Rectangle.Overlaps(scene.lakeRect, new Phaser.Geom.Rectangle(tx * TILE - 8, ty * TILE - 8, 32, 32))) return false;
  return scene.physics.overlapRect(tx * TILE + 1, ty * TILE + 1, 14, 14, true, true).length === 0;
}

function pickTile(scene, minDist = 160) {
  const sc = shelterCenter();
  const players = scene.allPlayers ? scene.allPlayers() : [scene.player];
  for (let i = 0; i < 400; i++) {
    const tx = Phaser.Math.Between(1, MAP_W - 2), ty = Phaser.Math.Between(2, MAP_H - 2);
    const x = tx * TILE + 8, y = ty * TILE + 8;
    if (players.some((p) => p && Phaser.Math.Distance.Between(p.x, p.y, x, y) < minDist)) continue;
    if (Phaser.Math.Distance.Between(sc.x, sc.y, x, y) < SAFE_FROM_SHELTER) continue;
    if (grassTile(scene, tx, ty)) return { tx, ty, x, y };
  }
  return null;
}

function randomKind() {
  let r = Math.random() * 100;
  for (const [id, k] of Object.entries(KINDS)) { if (!k.weight) continue; if ((r -= k.weight) < 0) return id; }
  return 'green';
}

// Geyik + canavar birleşik avlanabilir listesi (melee ve çok oyunculu eşitleme okur)
function syncHuntables(scene) {
  const st = M(scene);
  if (!st) return;
  const h = st.hunt;
  h.length = 0;
  (scene.wildlife?.deer || []).forEach((d) => h.push(d));
  st.slimes.forEach((s) => h.push(s));
  (scene.predators?.wild || []).forEach((b) => { if (!b.dead) h.push(b); }); // predators.js: vahşi yırtıcılar
  scene.huntables = h;
}

// ---------- Slime ----------
class Slime extends Actor {
  constructor(scene, x, y, kind, home) {
    const k = KINDS[kind];
    super(scene, x, y, 'mn_' + kind, k.hp);
    this.isMonster = true;
    this.kind = kind;
    this.k = k;
    this.dead = false;
    this.showHpBar = false; // ayrı görsel nesne yok: vuruş flaşı yeterli
    this.radius = Math.round(k.sizes[0][0] / 2);
    this.home = home || { x, y };
    this.phase = 'rest';    // rest | crouch | air | land
    this.t = Phaser.Math.FloatBetween(0.2, 1.5);
    this.chasing = false;
    this.stunT = 0;
    this.think = Math.random() * 0.2;
    const [bw, bh] = k.sizes[0];
    const w = bw - 2, h = Math.max(5, bh - 2);
    this.body.setSize(w, h).setOffset((k.fw - w) / 2, k.fh - 1 - h);
    this.setCollideWorldBounds(true);
    this.setFrame(0);
  }

  preUpdate(t, d) {
    super.preUpdate(t, d);
    const feet = this.y + this.k.fh / 2 - 1;
    this.shadow.setPosition(this.x, feet).setDepth(feet - 1).setScale(this.k.sizes[0][0] / 10, this.phase === 'air' ? 0.7 : 1);
    this.setDepth(feet);
  }

  takeDamage(n, source) {
    if (this.dead) return;
    this.hp -= n;
    this.flash(0xffffff);
    audio.sfx('hit');
    this.scene.spawnParticles(this.x, this.y, Phaser.Display.Color.HexStringToColor(this.k.pal.base).color, 4);
    if (this.hp <= 0) { killSlime(this.scene, this); return; }
    const sx = source?.x ?? this.scene.player.x, sy = source?.y ?? this.scene.player.y;
    const a = Phaser.Math.Angle.Between(sx, sy, this.x, this.y);
    const f = this.kind === 'purple' ? 90 : 150;
    this.setVelocity(Math.cos(a) * f, Math.sin(a) * f);
    this.setFrame(1);
    this.stunT = 0.22;
    this.phase = 'rest'; this.t = 0.3;
    this.chasing = true; // vurulan slime saldırgana döner
  }

  startHop(scene) {
    const p = this.prey || scene.player;
    let tx, ty;
    if (this.chasing && p) { tx = p.x; ty = p.y; }
    else {
      const h = this.home;
      const far = Phaser.Math.Distance.Between(this.x, this.y, h.x, h.y) > 60;
      tx = far ? h.x : h.x + Phaser.Math.Between(-48, 48);
      ty = far ? h.y : h.y + Phaser.Math.Between(-40, 40);
    }
    const a = Phaser.Math.Angle.Between(this.x, this.y, tx, ty) + (this.chasing ? 0 : Phaser.Math.FloatBetween(-0.3, 0.3));
    const spd = this.k.hop * (this.chasing ? 1.15 : 1);
    this.setVelocity(Math.cos(a) * spd, Math.sin(a) * spd);
    if (Math.abs(Math.cos(a)) > 0.15) this.setFlipX(Math.cos(a) < 0);
    this.setFrame(2);
    this.phase = 'air';
    this.t = this.k.air;
  }

  tick(scene, dt) {
    if (this.dead) return;
    // Çok oyunculu: temas tüm oyunculara; kovalanan av en yakın oyuncu
    const players = scene.allPlayers ? scene.allPlayers() : [scene.player].filter((q) => q && q.alive !== false);
    let p = null, dp = Infinity;
    for (const q of players) {
      const d = Phaser.Math.Distance.Between(q.x, q.y, this.x, this.y + 2);
      if (d < dp) { dp = d; p = q; }
    }
    this.prey = p;
    // Temas hasarı (oyuncunun dokunulmazlık süresi tekrar vurmayı sınırlar)
    if (this.alpha > 0.6) for (const q of players) {
      const d = Phaser.Math.Distance.Between(q.x, q.y, this.x, this.y + 2);
      if (d < this.k.reach + 4) {
        const could = q.invuln <= 0;
        q.takeDamage(this.k.dmg * (scene.difficulty?.dmg ?? 1), this);
        if (could && q.invuln > 0) {
          this.chasing = true;
          if (this.k.slow) slowPlayer(scene, q);
          // geri sekme
          const a = Phaser.Math.Angle.Between(q.x, q.y, this.x, this.y);
          this.setVelocity(Math.cos(a) * 80, Math.sin(a) * 80);
          this.stunT = 0.18; this.phase = 'rest'; this.t = 0.5; this.setFrame(1);
        }
      }
    }
    if (this.stunT > 0) {
      this.stunT -= dt;
      if (this.stunT <= 0) { this.setVelocity(0, 0); this.setFrame(0); }
      return;
    }
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.2;
      const alive = p && p.alive !== false;
      const dp = alive ? Phaser.Math.Distance.Between(p.x, p.y, this.x, this.y) : Infinity;
      if (!this.chasing && dp < AGGRO) this.chasing = true;
      else if (this.chasing && (dp > LEASH || Phaser.Math.Distance.Between(this.x, this.y, this.home.x, this.home.y) > HOME_LEASH)) this.chasing = false;
    }
    this.t -= dt;
    if (this.t > 0) return;
    const k = this.k;
    switch (this.phase) {
      case 'rest': this.phase = 'crouch'; this.t = 0.12; this.setFrame(1); break;
      case 'crouch': this.startHop(scene); break;
      case 'air':
        this.setVelocity(0, 0); this.setFrame(1);
        this.phase = 'land'; this.t = 0.1;
        break;
      default: {
        this.setFrame(0);
        const r = this.chasing ? k.chaseRest : k.rest;
        this.phase = 'rest'; this.t = Phaser.Math.FloatBetween(r[0], r[1]);
      }
    }
  }
}

function slowPlayer(scene, p = scene.player) {
  const st = M(scene);
  if (!st) return;
  scene.spawnParticles(p.x, p.y, 0xbfe6ff, 6);
  // Misafir: hareket misafirin kendi ekranında → yavaşlatma ona mesajla gider
  if (p.netRemote?.send) {
    if (!(p.slowUntil > scene.time.now)) scene.net?.asPlayer?.(p, () => scene.hud?.toast?.('❄ Buz Slime\'ı seni dondurdu! Kısa süre yavaşsın.', 'warn'));
    p.slowUntil = scene.time.now + SLOW_TIME * 1000;
    p.netRemote.send({ t: 'slow', d: SLOW_TIME, k: SLOW_MUL });
    return;
  }
  if (st.slowT <= 0) scene.hud?.toast?.('❄ Buz Slime\'ı seni dondurdu! Kısa süre yavaşsın.', 'warn');
  st.slowT = SLOW_TIME;
}

function addSlime(scene, kind, x, y, home, fade = true) {
  const st = M(scene);
  const s = new Slime(scene, x, y, kind, home);
  if (fade) { s.setAlpha(0); scene.tweens.add({ targets: s, alpha: 1, duration: 600 }); }
  st.group.add(s);
  st.slimes.push(s);
  syncHuntables(scene);
  return s;
}

function spawnSlime(scene, opts = {}) {
  const st = M(scene);
  if (!st || st.slimes.length >= MAX_SLIMES) return null;
  const spot = opts.at || pickTile(scene, opts.minDist ?? 160);
  if (!spot) return null;
  const kind = opts.kind && KINDS[opts.kind] ? opts.kind : randomKind();
  return addSlime(scene, kind, spot.x, spot.y, { x: spot.x, y: spot.y });
}

function removeSlime(scene, s) {
  const st = M(scene);
  if (st) { const i = st.slimes.indexOf(s); if (i >= 0) st.slimes.splice(i, 1); }
  if (s.active) s.destroy();
  syncHuntables(scene);
}

function killSlime(scene, s) {
  const st = M(scene);
  s.dead = true;
  s.setVelocity(0, 0);
  s.body.enable = false;
  const k = s.k;
  scene.spawnParticles(s.x, s.y, Phaser.Display.Color.HexStringToColor(k.pal.base).color, 10);
  audio.sfx('pop');
  const n = Phaser.Math.Between(k.loot[0], k.loot[1]);
  scene.giveItem('slime_gel', n);
  scene.floatText(s.x, s.y - 10, `+${n} ${ITEMS.slime_gel.name}`, '#a8ec8a');
  scene.hud?.refreshInventory?.();
  if (st) { const i = st.slimes.indexOf(s); if (i >= 0) st.slimes.splice(i, 1); st.kills++; }
  // Bölünme: kral slime iki küçük slime'a ayrılır
  if (k.split && st) {
    for (let i = 0; i < 2; i++) {
      const dir = i ? 1 : -1;
      const c = addSlime(scene, k.split, s.x + dir * 6, s.y, s.home, false);
      c.chasing = true;
      c.setVelocity(dir * 110, Phaser.Math.Between(-40, 40));
      c.stunT = 0.25; c.setFrame(2);
    }
    scene.hud?.toast?.('👑 Kral Slime ikiye bölündü!', 'info');
  }
  scene.events.emit('monsterKilled', s);
  syncHuntables(scene);
  s.setFrame(1);
  scene.tweens.add({ targets: s, alpha: 0, duration: 380, onComplete: () => s.destroy() });
}

// ---------- Modül ----------
export default {
  id: 'monsters',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    const st = scene.monsters = {
      slimes: [], hunt: [], group: scene.add.group(), respawnT: RESPAWN_EVERY, slowT: 0, kills: 0, pending: null,
      spawn: (o) => spawnSlime(scene, o), kinds: KINDS
    };
    syncHuntables(scene);

    scene.physics.add.collider(st.group, [scene.obstacles, scene.resources, scene.shelter].filter(Boolean));
    const pair = (a, b) => (a.isMonster ? [b, a] : [a, b]);
    scene.physics.add.overlap(scene.bullets, st.group, (a, b) => {
      const [bl, s] = pair(a, b);
      if (!bl.active || s.dead) return;
      // Misafirin mermisi: ganimet/görev/XP misafire
      const hit = () => s.takeDamage(bl.dmg || 1, bl);
      if (bl.owner && scene.net?.asPlayer) scene.net.asPlayer(bl.owner, hit); else hit();
      bl.destroy();
    });
    if (scene.shotGroup) scene.physics.add.overlap(scene.shotGroup, st.group, (a, b) => {
      const [sh, s] = pair(a, b);
      if (!sh.active || s.dead) return;
      const hit = () => hitTarget(scene, s, sh.dmg || 1, sh.crit, sh, sh.weapon);
      if (sh.owner && scene.net?.asPlayer) scene.net.asPlayer(sh.owner, hit); else hit();
      sh.destroy();
    });

    scene.minimapDots = scene.minimapDots || [];
    scene.minimapDots.push((s) => (s.monsters?.slimes || []).filter((m) => !m.dead)
      .map((m) => ({ x: m.x, y: m.y, color: m.k.dot, r: m.kind === 'purple' ? 2 : 1 })));
  },

  begin(scene) {
    const st = M(scene);
    st.slimes.slice().forEach((s) => removeSlime(scene, s));
    st.slowT = 0;
    const pend = st.pending; st.pending = null;
    if (pend) {
      st.kills = pend.kills || 0;
      // Kayıttaki türler yeniden (rastgele yerlerde) oluşur; gece de olsa mevcutlar kalır
      pend.kinds.slice(0, MAX_SLIMES).forEach((kind) => spawnSlime(scene, { kind, minDist: 200 }));
      return;
    }
    if (scene.timeSys.isNight) return;
    const want = Phaser.Math.Between(4, 6);
    for (let i = 0; i < want; i++) spawnSlime(scene, { minDist: 220 });
  },

  update(scene, dt) {
    const st = M(scene);
    if (!st) return;
    for (let i = st.slimes.length - 1; i >= 0; i--) {
      const s = st.slimes[i];
      if (!s.active) { st.slimes.splice(i, 1); continue; }
      s.tick(scene, dt);
    }
    syncHuntables(scene);
    // Buz yavaşlatması: oyuncunun bu karedeki hızını kıs (yuvarlanma hariç)
    if (st.slowT > 0) {
      st.slowT -= dt;
      const p = scene.player;
      if (p?.body && !(p.rollT > 0)) { p.body.velocity.x *= SLOW_MUL; p.body.velocity.y *= SLOW_MUL; }
      if (Math.random() < dt * 6) scene.spawnParticles(p.x, p.y + 4, 0xbfe6ff, 1);
    }
    const ts = scene.timeSys;
    if (ts.isNight) return; // gece yeni slime çıkmaz
    st.respawnT -= dt;
    if (st.respawnT <= 0) {
      st.respawnT = RESPAWN_EVERY;
      if (st.slimes.length < MAX_SLIMES - 2) spawnSlime(scene, { minDist: 220 });
    }
  },

  save(scene) {
    const st = M(scene);
    return { kills: st.kills, kinds: st.slimes.filter((s) => !s.dead).map((s) => s.kind).slice(0, MAX_SLIMES) };
  },

  load(scene, d) {
    if (!d || typeof d !== 'object') return; // eski kayıt: yeni oyun gibi doğar
    const kinds = Array.isArray(d.kinds) ? d.kinds.filter((k) => KINDS[k]) : [];
    M(scene).pending = { kills: Number(d.kills) || 0, kinds };
  }
};
