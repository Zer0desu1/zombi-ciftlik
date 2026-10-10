// 'wildlife' özellik modülü — Yaban hayatı ve harita olayları:
//   • Gündüz kasabadan uzak çayırlarda dolaşan, avlanabilir geyik sürüleri (oyuncu/zombi görünce kaçar, gece ormana çekilir)
//   • Paraşütle düşen yardım kolisi (günde en fazla bir kez, akşam açılmamışsa kaybolur)
//   • Şafakta ara sıra gelen geyik sürüsü göçü
// Sözleşme için registry.js'e bak. Durum scene.wildlife üzerinde tutulur (sahne yeniden başlarsa sıfırlanır).
import { TILE, MAP_W, MAP_H, ITEMS, RECIPES, FARM_ZONE, SHELTER_TILE } from '../config.js';
import { addCanvas, makeCanvas, R, outline } from '../textures.js';
import { audio } from '../audio.js';
import { Actor } from '../entities/Actor.js';
import { hitTarget } from '../systems/PlayerActions.js';

// ---------- Veri tabloları ----------
Object.assign(ITEMS, {
  venison:       { name: 'Çiğ Geyik Eti',      type: 'material', icon: 'i_venison',       sell: 8,  desc: 'Avlanmış geyikten çiğ et. Odun ateşinde kızart.' },
  hide:          { name: 'Deri',               type: 'material', icon: 'i_hide',          sell: 6,  desc: 'Geyik derisi. Ok yapımında işe yarar.' },
  roast_venison: { name: 'Kızarmış Geyik Eti', type: 'food',     icon: 'i_roast_venison', sell: 20, heal: 35, energy: 25 }
});

RECIPES.push(
  { out: 'roast_venison', qty: 1,  cost: { venison: 1, wood: 1 } },
  { out: 'arrow',         qty: 10, cost: { hide: 1, wood: 2 } }
);

// ---------- Ayarlar ----------
const MAX_DEER = 6;
const DEER_HP = 6;
const SPEED = { graze: 20, flee: 92, leave: 70 };
const SCARE_PLAYER = 70;      // oyuncu bu kadar yaklaşırsa kaçar
const SCARE_ZOMBIE = 110;     // zombi görünce kaçar
const RESPAWN_EVERY = 45;     // gündüz: sürü azaldıysa yeni sürü denemesi (sn)
const MIGRATION_CHANCE = 0.35;
const CRATE_CHANCE = 0.5;
const CRATE_HOURS = [11, 15]; // koli öğleye doğru düşer
const TOWN = { x0: 22, y0: 7, x1: 60, y1: 38 };       // kasaba + çevresi (tile)
const PEN = { x0: 22, y0: 2, x1: 32, y1: 12 };        // ağıl alanı (tile)

const DIRS = [ // [ad, -e hâli, -de hâli]
  ['Doğu', 'Doğuya', 'Doğuda'], ['Güneydoğu', 'Güneydoğuya', 'Güneydoğuda'], ['Güney', 'Güneye', 'Güneyde'], ['Güneybatı', 'Güneybatıya', 'Güneybatıda'],
  ['Batı', 'Batıya', 'Batıda'], ['Kuzeybatı', 'Kuzeybatıya', 'Kuzeybatıda'], ['Kuzey', 'Kuzeye', 'Kuzeyde'], ['Kuzeydoğu', 'Kuzeydoğuya', 'Kuzeydoğuda']
];

// ---------- Dokular ----------
function drawDeer(ctx, f) {
  const B = '#a0673a', L = '#b97d4a', D = '#7a4a28', W = '#f4ece0', Be = '#e8d2b0', A = '#d9c49a', K = '#2a1f1a';
  const legs = f ? [4, 5, 10, 11] : [3, 6, 9, 12];
  legs.forEach((x, i) => { R(ctx, x, 10, 1, 3, i % 2 ? B : D); R(ctx, x, 13, 1, 1, K); });
  R(ctx, 1, 4, 2, 2, W);                                       // kuyruk
  R(ctx, 2, 5, 11, 5, B); R(ctx, 3, 5, 9, 1, L);               // gövde
  R(ctx, 4, 9, 8, 1, Be);                                      // karın
  R(ctx, 5, 6, 1, 1, Be); R(ctx, 8, 7, 1, 1, Be); R(ctx, 10, 6, 1, 1, Be); // benekler
  R(ctx, 11, 3, 3, 4, B);                                      // boyun
  R(ctx, 12, 2, 4, 3, B); R(ctx, 16, 3, 1, 2, D);              // baş + burun
  R(ctx, 16, 3, 1, 1, K); R(ctx, 14, 3, 1, 1, '#1b1622');      // burun ucu + göz
  R(ctx, 11, 2, 1, 1, D);                                      // kulak
  R(ctx, 12, 0, 1, 2, A); R(ctx, 11, 0, 1, 1, A);              // boynuzlar
  R(ctx, 14, 0, 1, 2, A); R(ctx, 15, 0, 1, 1, A);
}

function makeTextures(scene) {
  const FW = 18, FH = 14;
  const tex = addCanvas(scene, 'wl_deer', FW * 2, FH, (ctx) => {
    for (let f = 0; f < 2; f++) {
      const { c, ctx: fc } = makeCanvas(FW, FH);
      drawDeer(fc, f);
      outline(fc, 0, 0, FW, FH, '#3a2e2a');
      ctx.drawImage(c, f * FW, 0);
    }
  });
  tex.add(0, 0, 0, 0, FW, FH);
  tex.add(1, 0, FW, 0, FW, FH);
  if (!scene.anims.exists('wl_deer_walk')) scene.anims.create({ key: 'wl_deer_walk', frames: [{ key: 'wl_deer', frame: 0 }, { key: 'wl_deer', frame: 1 }], frameRate: 6, repeat: -1 });

  // Yardım kolisi (14x12) ve paraşüt (18x10)
  addCanvas(scene, 'wl_crate', 14, 12, (ctx) => {
    R(ctx, 1, 2, 12, 9, '#a87048'); R(ctx, 1, 2, 12, 2, '#c9a06b'); R(ctx, 1, 10, 12, 1, '#6b4a2f');
    R(ctx, 6, 2, 2, 9, '#e8c867'); R(ctx, 1, 6, 12, 1, '#8a5a3a');
    R(ctx, 2, 7, 3, 3, '#eb5757'); R(ctx, 3, 7, 1, 3, '#ffffff'); R(ctx, 2, 8, 3, 1, '#ffffff');
    outline(ctx, 0, 0, 14, 12, '#3a2e2a');
  });
  addCanvas(scene, 'wl_chute', 18, 14, (ctx) => {
    for (let i = 0; i < 4; i++) R(ctx, 5 - i, i, 8 + i * 2, 1, i % 2 ? '#f2f2f2' : '#eb5757');
    R(ctx, 1, 4, 16, 1, '#c94040');
    for (let i = 0; i < 9; i++) { R(ctx, 2 + i * 0.5, 5 + i, 1, 1, '#d8d1c3'); R(ctx, 15 - i * 0.5, 5 + i, 1, 1, '#d8d1c3'); }
  });

  // Eşya ikonları (16x16)
  const icon = (key, fn) => addCanvas(scene, key, 16, 16, fn);
  icon('i_venison', (ctx) => {
    R(ctx, 3, 4, 9, 8, '#c0504a'); R(ctx, 4, 3, 7, 1, '#c0504a'); R(ctx, 4, 12, 6, 1, '#c0504a');
    R(ctx, 4, 5, 6, 2, '#e07a70'); R(ctx, 6, 8, 4, 1, '#f2d7cf'); R(ctx, 5, 10, 3, 1, '#f2d7cf');
    R(ctx, 11, 9, 3, 2, '#f4ece0'); R(ctx, 13, 8, 2, 4, '#f4ece0');
    outline(ctx, 0, 0, 16, 16, '#3a2e2a');
  });
  icon('i_hide', (ctx) => {
    R(ctx, 4, 3, 8, 10, '#a0673a'); R(ctx, 2, 4, 3, 3, '#a0673a'); R(ctx, 11, 4, 3, 3, '#a0673a');
    R(ctx, 2, 10, 3, 3, '#a0673a'); R(ctx, 11, 10, 3, 3, '#a0673a'); R(ctx, 7, 13, 2, 2, '#a0673a');
    R(ctx, 5, 5, 6, 6, '#b97d4a'); R(ctx, 6, 6, 1, 1, '#e8d2b0'); R(ctx, 9, 8, 1, 1, '#e8d2b0');
    outline(ctx, 0, 0, 16, 16, '#3a2e2a');
  });
  icon('i_roast_venison', (ctx) => {
    R(ctx, 1, 11, 14, 3, '#e6edf3'); R(ctx, 2, 14, 12, 1, '#9aa3ad');
    R(ctx, 3, 5, 9, 6, '#8a4a2a'); R(ctx, 4, 4, 7, 1, '#8a4a2a'); R(ctx, 4, 5, 6, 2, '#b8693a');
    R(ctx, 5, 8, 4, 1, '#5d2f1a'); R(ctx, 11, 7, 3, 2, '#f4ece0'); R(ctx, 13, 6, 2, 4, '#f4ece0');
    R(ctx, 6, 1, 1, 2, 'rgba(255,255,255,0.6)'); R(ctx, 9, 0, 1, 3, 'rgba(255,255,255,0.6)');
    outline(ctx, 0, 0, 16, 16, '#3a2e2a');
  });
}

// ---------- Yardımcılar ----------
const W = (scene) => scene.wildlife;

function dirOf(x, y) {
  const cx = SHELTER_TILE.x * TILE + 32, cy = SHELTER_TILE.y * TILE + 28;
  const a = Math.atan2(y - cy, x - cx);
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return DIRS[i];
}

// Boş çim karesi mi? (yol/göl/bina/tarla/kasaba/ağıl dışı, fizik gövdesi yok)
function grassTile(scene, tx, ty) {
  if (tx < 1 || ty < 2 || tx >= MAP_W - 1 || ty >= MAP_H - 1) return false;
  if (tx >= TOWN.x0 && ty >= TOWN.y0 && tx <= TOWN.x1 && ty <= TOWN.y1) return false;
  if (tx >= PEN.x0 && ty >= PEN.y0 && tx <= PEN.x1 && ty <= PEN.y1) return false;
  const fz = FARM_ZONE;
  if (tx >= fz.x - 1 && ty >= fz.y - 1 && tx <= fz.x + fz.w && ty <= fz.y + fz.h) return false;
  if (scene.farm?.get(tx, ty)) return false;
  const t = scene.layer?.getTileAt(tx, ty);
  if (!t || t.index > 2) return false;
  if (scene.lakeRect && Phaser.Geom.Rectangle.Overlaps(scene.lakeRect, new Phaser.Geom.Rectangle(tx * TILE - 8, ty * TILE - 8, 32, 32))) return false;
  return scene.physics.overlapRect(tx * TILE + 1, ty * TILE + 2, 14, 12, true, true).length === 0;
}

// Oyuncudan uzak rastgele boş kare; region: {x0,x1} tile aralığı (isteğe bağlı)
function pickTile(scene, minDist = 170, region = null) {
  const players = scene.allPlayers ? scene.allPlayers() : [scene.player];
  for (let i = 0; i < 400; i++) {
    const tx = region ? Phaser.Math.Between(region.x0, region.x1) : Phaser.Math.Between(1, MAP_W - 2);
    const ty = Phaser.Math.Between(2, MAP_H - 2);
    const x = tx * TILE + 8, y = ty * TILE + 8;
    if (players.some((p) => p && Phaser.Math.Distance.Between(p.x, p.y, x, y) < minDist)) continue;
    if (grassTile(scene, tx, ty)) return { tx, ty, x, y };
  }
  return null;
}

// ---------- Geyik ----------
class Deer extends Actor {
  constructor(scene, x, y, herd) {
    super(scene, x, y, 'wl_deer', DEER_HP);
    this.isDeer = true;
    this.dead = false;
    this.radius = 7;
    this.herd = herd;               // {x, y} sürü merkezi (otlama alanı)
    this.mode = 'graze';            // graze | flee | leave
    this.wait = Phaser.Math.FloatBetween(0.3, 2.5);
    this.goal = null;
    this.fleeT = 0;
    this.think = Math.random() * 0.2;
    this.body.setSize(12, 8).setOffset(3, 4); // mermilerin isabet edebileceği kadar yüksek
    this.setCollideWorldBounds(true);
    this.setFlipX(Math.random() < 0.5);
  }

  preUpdate(t, d) {
    super.preUpdate(t, d);
    this.shadow.setScale(1.5, 1);
  }

  // dx,dy yönünden uzağa kaç (sürüdeki diğer geyikleri de ürküt)
  scare(fromX, fromY, spread = true) {
    if (this.dead || this.mode === 'leave') return;
    const a = Phaser.Math.Angle.Between(fromX, fromY, this.x, this.y) + Phaser.Math.FloatBetween(-0.4, 0.4);
    this.fleeAng = a;
    this.mode = 'flee';
    this.fleeT = Phaser.Math.FloatBetween(1.6, 2.6);
    if (spread) W(this.scene)?.deer.forEach((o) => {
      if (o !== this && o.herd === this.herd && o.mode !== 'flee') o.scare(fromX, fromY, false);
    });
  }

  takeDamage(n, source) {
    if (this.dead) return;
    this.hp -= n;
    this.flash(0xffffff);
    audio.sfx('hit');
    this.scene.spawnParticles(this.x, this.y, 0xc0504a, 4);
    const sx = source?.x ?? this.scene.player.x, sy = source?.y ?? this.scene.player.y;
    if (this.hp <= 0) { killDeer(this.scene, this); return; }
    this.scare(sx, sy);
  }

  tick(scene, dt) {
    if (this.dead) return;
    if (this.mode === 'leave') return; // ayrılırken tween yönetir
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.2;
      // Çok oyunculu: herhangi bir oyuncu yaklaşınca kaçar
      const np = scene.nearestPlayer ? scene.nearestPlayer(this.x, this.y, SCARE_PLAYER)?.p : (scene.player?.alive !== false && Phaser.Math.Distance.Between(scene.player.x, scene.player.y, this.x, this.y) < SCARE_PLAYER ? scene.player : null);
      if (np) this.scare(np.x, np.y);
      else {
        const zs = scene.zombies.getChildren();
        for (let i = 0; i < zs.length; i++) {
          const z = zs[i];
          if (!z.dead && z.active && Math.abs(z.x - this.x) < SCARE_ZOMBIE && Math.abs(z.y - this.y) < SCARE_ZOMBIE
            && Phaser.Math.Distance.Between(z.x, z.y, this.x, this.y) < SCARE_ZOMBIE) { this.scare(z.x, z.y); break; }
        }
      }
    }
    if (this.mode === 'flee') {
      this.fleeT -= dt;
      this.setVelocity(Math.cos(this.fleeAng) * SPEED.flee, Math.sin(this.fleeAng) * SPEED.flee);
      if (Math.abs(this.body.velocity.x) > 1) this.setFlipX(this.body.velocity.x < 0);
      this.walk(true);
      this.anims.timeScale = 2.2;
      if (this.fleeT <= 0) {
        // Kaçtığı yerde yeni otlama alanı kur
        this.mode = 'graze';
        this.herd.x = this.x; this.herd.y = this.y;
        this.goal = null; this.wait = Phaser.Math.FloatBetween(0.5, 1.5);
        this.halt();
      }
      return;
    }
    this.anims.timeScale = 1;
    if (this.goal) {
      const d = this.moveToward(this.goal.x, this.goal.y, SPEED.graze);
      this.goalT -= dt;
      if (d < 3 || this.goalT <= 0) { this.goal = null; this.wait = Phaser.Math.FloatBetween(1, 3.5); this.halt(); }
    } else {
      this.wait -= dt;
      if (this.wait <= 0) {
        const h = this.herd;
        this.goal = { x: Phaser.Math.Clamp(h.x + Phaser.Math.Between(-40, 40), 12, MAP_W * TILE - 12), y: Phaser.Math.Clamp(h.y + Phaser.Math.Between(-30, 30), 24, MAP_H * TILE - 12) };
        this.goalT = 4;
      }
    }
  }

  // Gece: ormana (harita kenarına) çekilip kaybol
  leave() {
    if (this.dead || this.mode === 'leave') return;
    this.mode = 'leave';
    const mw = MAP_W * TILE, mh = MAP_H * TILE;
    const ex = this.x < mw / 2 ? -1 : 1, ey = this.y < mh / 2 ? -0.4 : 0.4;
    const a = Math.atan2(ey, ex);
    this.setVelocity(Math.cos(a) * SPEED.leave, Math.sin(a) * SPEED.leave);
    this.setFlipX(ex < 0);
    this.walk(true);
    this.anims.timeScale = 1.8;
    this.scene.tweens.add({ targets: this, alpha: 0, duration: 2600, onComplete: () => removeDeer(this.scene, this) });
  }
}

function removeDeer(scene, d) {
  const st = W(scene);
  if (st) { const i = st.deer.indexOf(d); if (i >= 0) st.deer.splice(i, 1); }
  if (d.active) d.destroy();
}

function killDeer(scene, d) {
  d.dead = true;
  d.setVelocity(0, 0);
  d.anims.stop();
  scene.spawnParticles(d.x, d.y, 0xa0673a, 8);
  audio.sfx('harvest');
  scene.giveItem('venison', 2);
  scene.giveItem('hide', 1);
  scene.floatText(d.x, d.y - 10, `+2 ${ITEMS.venison.name}  +1 ${ITEMS.hide.name}`, '#ffe08a');
  scene.hud.toast(`🦌 Geyik avlandı: +2 ${ITEMS.venison.name}, +1 ${ITEMS.hide.name}`, 'ok');
  scene.hud.refreshInventory?.();
  scene.events.emit('deerHunted', d);
  // Kalan sürü dağılır
  W(scene)?.deer.forEach((o) => { if (o !== d && o.herd === d.herd) o.scare(d.x, d.y, false); });
  const st = W(scene);
  if (st) { const i = st.deer.indexOf(d); if (i >= 0) st.deer.splice(i, 1); }
  d.body.enable = false;
  scene.tweens.add({ targets: d, alpha: 0, angle: d.flipX ? -90 : 90, duration: 450, onComplete: () => d.destroy() });
}

function spawnHerd(scene, opts = {}) {
  const st = W(scene);
  const room = MAX_DEER - st.deer.length;
  if (room < 2) return null;
  const spot = pickTile(scene, opts.minDist ?? 170, opts.region);
  if (!spot) return null;
  const n = Math.min(room, Phaser.Math.Between(opts.min || 2, opts.max || 4));
  const herd = { x: spot.x, y: spot.y };
  let made = 0;
  for (let i = 0; i < n * 4 && made < n; i++) {
    const tx = spot.tx + Phaser.Math.Between(-2, 2), ty = spot.ty + Phaser.Math.Between(-2, 2);
    if (i > 0 && !grassTile(scene, tx, ty)) continue;
    const d = new Deer(scene, tx * TILE + 8 + Phaser.Math.Between(-3, 3), ty * TILE + 8, herd);
    d.setAlpha(0);
    scene.tweens.add({ targets: d, alpha: 1, duration: 700 });
    st.group.add(d);
    st.deer.push(d);
    made++;
  }
  return made ? spot : null;
}

// ---------- Yardım kolisi ----------
function dropCrate(scene, at = null, instant = false) {
  const st = W(scene);
  const spot = at || pickTile(scene, 140);
  if (!spot) return null;
  const x = spot.x, y = spot.y;
  const sprite = scene.add.image(x, instant ? y : y - 110, 'wl_crate').setDepth(y + 6);
  const crate = { x, y, sprite, landed: instant, chute: null };
  st.crate = crate;
  if (!instant) {
    crate.chute = scene.add.image(x, y - 120, 'wl_chute').setDepth(y + 7);
    const fall = { targets: [sprite], y, duration: 2600, ease: 'Sine.easeIn' };
    scene.tweens.add({ ...fall, onUpdate: () => crate.chute?.setPosition(sprite.x, sprite.y - 11), onComplete: () => {
      if (st.crate !== crate) return;
      crate.landed = true;
      scene.spawnParticles(x, y + 4, 0xc9a06b, 8);
      audio.sfx('place');
      const ch = crate.chute; crate.chute = null;
      if (ch) scene.tweens.add({ targets: ch, alpha: 0, x: ch.x + 10, y: ch.y + 6, duration: 700, onComplete: () => ch.destroy() });
    } });
    scene.tweens.add({ targets: sprite, angle: { from: -6, to: 6 }, duration: 500, yoyo: true, repeat: 2 });
    const dir = dirOf(x, y);
    scene.hud.toast(`📦 ${dir[1]} bir yardım kolisi düştü! (Mini haritada sarı)`, 'info');
    audio.sfx('whoosh');
  }
  return crate;
}

function removeCrate(scene) {
  const st = W(scene), c = st.crate;
  if (!c) return;
  st.crate = null;
  c.chute?.destroy();
  if (c.sprite?.active) scene.tweens.add({ targets: c.sprite, alpha: 0, duration: 400, onComplete: () => c.sprite.destroy() });
}

function openCrate(scene) {
  const c = W(scene).crate;
  if (!c || !c.landed) return;
  const seed = Phaser.Utils.Array.GetRandom(['seed_wheat', 'seed_carrot', 'seed_pumpkin'].filter((id) => ITEMS[id]));
  const loot = [['ammo', Phaser.Math.Between(8, 15)], ['bread', Phaser.Math.Between(1, 2)]];
  if (seed) loot.push([seed, Phaser.Math.Between(3, 5)]);
  if (ITEMS.arrow && Math.random() < 0.5) loot.push(['arrow', Phaser.Math.Between(5, 10)]);
  const coins = Phaser.Math.Between(20, 50);
  loot.forEach(([id, n]) => scene.giveItem(id, n));
  scene.player.addCoins(coins);
  const txt = loot.map(([id, n]) => `${n}× ${ITEMS[id].name}`).join(', ');
  scene.hud.toast(`📦 Koli açıldı: ${txt}, +${coins} 🪙`, 'ok');
  scene.floatText(c.x, c.y - 10, `+${coins}🪙`, '#ffd166');
  scene.spawnParticles(c.x, c.y, 0xe8c867, 10);
  audio.sfx('coin');
  scene.hud.refreshInventory?.();
  scene.events.emit('crateOpened', loot);
  removeCrate(scene);
}

// ---------- Modül ----------
export default {
  id: 'wildlife',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    const st = scene.wildlife = {
      deer: [], group: scene.add.group(), crate: null, crateDay: 0, respawnT: 20, pending: null,
      spawnHerd: (o) => spawnHerd(scene, o), dropCrate: (at, instant) => dropCrate(scene, at, instant), openCrate: () => openCrate(scene)
    };
    scene.huntables = st.deer; // PlayerActions.melee bunları da tarar

    scene.physics.add.collider(st.group, [scene.obstacles, scene.resources, scene.shelter]);
    // Mermiler (tabanca/NPC: scene.bullets; yay/pompalı: combat'ın scene.shotGroup'u)
    const pair = (a, b) => (a.isDeer ? [b, a] : [a, b]);
    scene.physics.add.overlap(scene.bullets, st.group, (a, b) => {
      const [bl, d] = pair(a, b);
      if (!bl.active || d.dead) return;
      d.takeDamage(bl.dmg || 1, bl);
      bl.destroy();
    });
    if (scene.shotGroup) scene.physics.add.overlap(scene.shotGroup, st.group, (a, b) => {
      const [s, d] = pair(a, b);
      if (!s.active || d.dead) return;
      hitTarget(scene, d, s.dmg || 1, s.crit, s, s.weapon);
      s.destroy();
    });

    scene.addInteraction((s) => {
      const c = s.wildlife.crate;
      if (!c || !c.landed) return null;
      const d = Phaser.Math.Distance.Between(s.player.x, s.player.y, c.x, c.y);
      return d < 24 ? { dist: d, label: 'Koliyi aç', run: () => openCrate(s) } : null;
    });

    scene.minimapDots = scene.minimapDots || [];
    scene.minimapDots.push((s) => {
      const w = s.wildlife, out = w.deer.filter((d) => !d.dead).map((d) => ({ x: d.x, y: d.y, color: '#c8925a', r: 1 }));
      if (w.crate) out.push({ x: w.crate.x, y: w.crate.y, color: '#ffd166', r: 2 });
      return out;
    });

    const ts = scene.timeSys;
    ts.on('dusk', () => {
      st.deer.slice().forEach((d) => d.leave());
      if (st.crate) { removeCrate(scene); scene.hud.toast('📦 Açılmayan yardım kolisi karanlıkta kayboldu.', 'warn'); }
    });
    ts.on('dawn', () => {
      st.respawnT = RESPAWN_EVERY;
      spawnHerd(scene);
      if (Math.random() < MIGRATION_CHANCE) {
        const west = Math.random() < 0.5;
        const spot = spawnHerd(scene, { region: west ? { x0: 1, x1: 12 } : { x0: MAP_W - 6, x1: MAP_W - 2 }, min: 3, max: 4, minDist: 120 });
        if (spot) scene.time.delayedCall(2500, () => scene.hud?.toast(`🦌 Bir geyik sürüsü ${dirOf(spot.x, spot.y)[2].toLocaleLowerCase('tr')}ki ormana geldi.`, 'info'));
      }
    });
  },

  begin(scene) {
    const st = W(scene);
    st.deer.slice().forEach((d) => removeDeer(scene, d));
    removeCrate(scene);
    const pend = st.pending; st.pending = null;
    if (pend) {
      st.crateDay = pend.crateDay || 0;
      if (pend.crate && !scene.timeSys.isNight) dropCrate(scene, { x: pend.crate.x, y: pend.crate.y }, true);
    }
    if (scene.timeSys.isNight) return;
    const want = pend ? Phaser.Math.Clamp(Math.floor(Number(pend.deer) || 0), 0, MAX_DEER) : Phaser.Math.Between(4, 6);
    for (let i = 0; i < 4 && st.deer.length < want; i++) spawnHerd(scene, { minDist: 200, max: Math.min(4, Math.max(2, want - st.deer.length)) });
  },

  update(scene, dt) {
    const st = W(scene);
    if (!st) return;
    const ts = scene.timeSys;
    for (let i = st.deer.length - 1; i >= 0; i--) {
      const d = st.deer[i];
      if (!d.active) { st.deer.splice(i, 1); continue; }
      d.tick(scene, dt);
    }
    if (ts.isNight) return;
    const h = ts.hour;
    // Gündüz sürü azaldıysa uzakta yenisi belirir
    if (h >= 7 && h < 17) {
      st.respawnT -= dt;
      if (st.respawnT <= 0) {
        st.respawnT = RESPAWN_EVERY;
        if (st.deer.length < 3) spawnHerd(scene, { minDist: 220 });
      }
    }
    // Günde bir kez öğleye doğru yardım kolisi zarı
    if (h >= CRATE_HOURS[0] && h < CRATE_HOURS[1] && st.crateDay !== ts.day) {
      st.crateDay = ts.day;
      if (!st.crate && Math.random() < CRATE_CHANCE) dropCrate(scene);
    }
  },

  save(scene) {
    const st = W(scene);
    const c = st.crate;
    return { crateDay: st.crateDay, crate: c ? { x: Math.round(c.x), y: Math.round(c.y) } : null, deer: st.deer.filter((d) => !d.dead).length };
  },

  load(scene, d) {
    if (!d || typeof d !== 'object') return;
    const c = d.crate && Number.isFinite(d.crate.x) && Number.isFinite(d.crate.y) ? { x: d.crate.x, y: d.crate.y } : null;
    W(scene).pending = { crateDay: Number(d.crateDay) || 0, crate: c, deer: Number(d.deer) || 0 };
  }
};
