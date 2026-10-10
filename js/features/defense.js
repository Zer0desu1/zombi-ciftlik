// 'defense' özellik modülü — savunma inşası: taş duvar, dikenli tuzak, kapı, ışık direği,
// alev tareti, taret seviyeleri ve çekiçle onarım. Sözleşme için registry.js'e bak.
import { ITEMS, RECIPES, SHOPS } from '../config.js';
import { audio } from '../audio.js';
import { addCanvas, R } from '../textures.js';
import { canPlace } from '../systems/PlayerActions.js';
import { injectCSS, el } from '../ui/dom.js';
import { StoneWall, Gate, SpikeTrap, LampPost, FlameTurret, TURRET_LEVELS, FLAME } from '../entities/Structures.js';

// ---------- Veri: eşyalar, tarifler, dükkân ----------
const KINDS = {
  stone_wall:   { cls: StoneWall,   name: 'Taş Duvar',     desc: 'Sağlam engel (300 can). Zombileri durdurur. Tıklayarak yerleştir.' },
  spike_trap:   { cls: SpikeTrap,   name: 'Dikenli Tuzak', desc: 'Üstünden geçen zombiye hasar verir ve yavaşlatır. 40 kullanımda kırılır.' },
  gate:         { cls: Gate,        name: 'Kapı',          desc: 'Sen ve kasabalılar geçersiniz, zombiler geçemez (200 can).' },
  lamp_post:    { cls: LampPost,    name: 'Işık Direği',   desc: 'Geceyi 90px aydınlatır. Işıktaki zombiler %15 yavaşlar.' },
  flame_turret: { cls: FlameTurret, name: 'Alev Tareti',   desc: 'Yakındaki zombileri yakar (50px koni). Yakıtı odun: E ile doldur.' },
  // --- Genişletilmiş savunma araçları (sınıflar aşağıda, bu dosyada) ---
  catapult:       { name: 'Mancınık',        target: true, desc: 'Yavaş ama uzun menzilli (180px) taş atar: kalabalığa 24px alan hasarı (4). Her atış 1 taş; E ile taş yükle.' },
  archer_tower:   { name: 'Okçu Kulesi',     target: true, icon: 'i_archer_tower', desc: 'Ucuz, odun ağırlıklı kule: 130px menzilden ok atar, mermi harcamaz. E ile yükselt (Sv.3\'e kadar).' },
  tar_pit:        { name: 'Katran Çukuru',   desc: 'Üstünden geçen zombiler %60 yavaşlar, çıkınca da bir süre ağır kalır. Hasar vermez; kullandıkça aşınır.' },
  mine:           { name: 'Mayın',           desc: 'Kurulduktan 1 sn sonra hazır. Zombi basınca patlar: 36px alan, 12 hasar (yapılara zarar vermez). Tek kullanımlık.' },
  stake_wall:     { name: 'Sivri Kazık Duvarı', desc: 'Engel (140 can). Dibindeki zombilere düzenli hasar verir. Dikey dizilince yönü kendiliğinden döner.' },
  repair_station: { name: 'Onarım Tezgâhı',  target: true, desc: 'Gece 72px içindeki yapıları (sığınak dahil) 2 sn\'de bir yavaşça onarır.' }
};
Object.entries(KINDS).forEach(([id, k]) => {
  ITEMS[id] = { name: k.name, type: 'place', icon: k.icon || (id === 'lamp_post' ? 'i_lamp_post' : id), desc: k.desc, onUse: (scene, ctx) => placeDefense(scene, id, ctx) };
});
ITEMS.hammer = { name: 'Çekiç', type: 'tool', icon: 'i_hammer', desc: 'Yapıya tıkla: 1 odun/taş harcayıp +25 can onarır.', onUse: (scene, ctx) => useHammer(scene, ctx) };
if (ITEMS.turret) ITEMS.turret.desc = 'Otomatik ateş eder. Yanına gidip E ile yükselt (Sv.3\'e kadar).';

const DEF_RECIPES = [
  { out: 'stone_wall', qty: 1, cost: { stone: 8 } },
  { out: 'spike_trap', qty: 1, cost: { wood: 3, stone: 2 } },
  { out: 'gate',       qty: 1, cost: { wood: 6, stone: 2 } },
  { out: 'lamp_post',  qty: 1, cost: { wood: 3, stone: 1 } },
  // Orta/geç oyun: hurda (zombi düşürür) ve ok gibi ara malzemelere dayanır
  { out: 'archer_tower',   qty: 1, cost: { wood: 12, arrow: 10 } },
  { out: 'tar_pit',        qty: 1, cost: { wood: 4, stone: 2, scrap: 1 } },
  { out: 'stake_wall',     qty: 1, cost: { wood: 8, scrap: 2 } },
  { out: 'mine',           qty: 1, cost: { scrap: 3, ammo: 4 } },
  { out: 'catapult',       qty: 1, cost: { wood: 12, stone: 10, scrap: 4 } },
  { out: 'repair_station', qty: 1, cost: { stone: 10, wood: 6, scrap: 6 } }
];
RECIPES.push(...DEF_RECIPES);
SHOPS.blacksmith.push(
  { id: 'hammer', qty: 1, price: 40 },
  { id: 'flame_turret', qty: 1, price: 200 },
  { id: 'mine', qty: 1, price: 35 },
  { id: 'stake_wall', qty: 1, price: 45 },
  { id: 'archer_tower', qty: 1, price: 90 }
);

const HAMMER_HEAL = 25;
const UPGRADE_REACH = 24;
const TRAP_DMG = 2, TRAP_TICK = 0.5, TRAP_SLOW = 0.5, LIGHT_SLOW = 0.85;

// ---------- Yeni savunma yapıları ----------
// Structures.js'deki dışa aktarılmayan taban sınıf (can, can çubuğu, hasar/onarım, yıkılma)
const Structure = Object.getPrototypeOf(StoneWall);

export const CATA = { range: 180, min: 36, reload: 3.2, radius: 24, dmg: 4, flight: 0.75, maxAmmo: 30, startAmmo: 10, load: 10 };
export const TOWER_LEVELS = [
  null,
  { dmg: 1, range: 130, rate: 1.1, maxHp: 60 },
  { dmg: 2, range: 140, rate: 1.1, maxHp: 80, cost: { coins: 50, wood: 10 } },
  { dmg: 2, range: 150, rate: 0.75, maxHp: 100, cost: { coins: 110, wood: 16 } }
];
export const TAR = { slow: 0.4, linger: 1.2, lingerSlow: 0.7 };
export const MINE = { arm: 1, fuse: 0.3, trigger: 10, radius: 36, dmg: 12 };
export const STAKE = { dmg: 1, tick: 0.7 };
export const STATION = { range: 72, tick: 2, heal: 2, shelterHeal: 3 };

function boom(scene, x, y, r, color) {
  audio.sfx('explode');
  const c = scene.add.circle(x, y, r, color, 0).setStrokeStyle(2, color, 0.9).setDepth(9400).setScale(0.15);
  scene.tweens.add({ targets: c, scale: 1, alpha: 0, duration: 320, ease: 'Cubic.easeOut', onComplete: () => c.destroy() });
  scene.spawnParticles(x, y, color, 10);
  scene.spawnParticles(x, y, 0xf08a24, 5);
  if (scene.shakeAt) scene.shakeAt(x, y, 160, 140, 0.004);
  else if (Phaser.Math.Distance.Between(x, y, scene.player.x, scene.player.y) < 160) scene.cameras.main.shake(140, 0.004);
}

// Yalnızca zombilere alan hasarı (oyuncu ve yapılar güvende); menzildeki mayınları da tetikler
function blast(scene, x, y, r, dmg, color) {
  boom(scene, x, y, r, color);
  const r2 = r * r;
  for (const z of scene.zombies.getChildren().slice()) {
    if (z.dead) continue;
    const dx = z.x - x, dy = z.y - y;
    if (dx * dx + dy * dy <= r2) z.takeDamage(dmg, { x, y });
  }
  for (const m of scene.defState?.mines || []) {
    if (m.active && !m.done && (m.x - x) ** 2 + (m.y - y) ** 2 <= r2) m.trigger();
  }
}

class Catapult extends Structure {
  constructor(scene, x, y, hp, ammo) {
    super(scene, x, y, 'catapult', 80);
    Object.assign(this, { kind: 'catapult', label: 'Mancınık', blocksPlayer: true, blocksZombie: true, debris: 0x8a5a3a });
    this.ammo = Phaser.Math.Clamp(Number.isFinite(ammo) ? ammo : CATA.startAmmo, 0, CATA.maxAmmo);
    this.cooldown = 1;
    this.ammoBar = scene.add.rectangle(x - 7, y + 9, 14, 2, 0xa2a6b0).setOrigin(0, 0.5).setDepth(10000);
    this.updateAmmo();
    if (hp != null) { this.hp = Math.min(hp, this.maxHp); this.updateBar(); }
  }

  updateAmmo() {
    const r = Phaser.Math.Clamp(this.ammo / CATA.maxAmmo, 0, 1);
    this.ammoBar.setSize(Math.max(1, 14 * r), 2).setFillStyle(this.ammo > 0 ? 0xa2a6b0 : 0x555555);
  }

  addAmmo(n) { this.ammo = Math.min(CATA.maxAmmo, this.ammo + n); this.updateAmmo(); }

  update(dt) {
    this.cooldown -= dt;
    if (this.cooldown > 0 || this.ammo <= 0) return;
    // En kalabalık zombi kümesini seç (eşitlikte en yakını)
    const zs = this.scene.zombies.getChildren(), R2 = CATA.radius * CATA.radius;
    let best = null, bestN = 0, bestD = Infinity;
    for (const z of zs) {
      if (z.dead) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, z.x, z.y);
      if (d < CATA.min || d > CATA.range) continue;
      let n = 0;
      for (const o of zs) if (!o.dead && (o.x - z.x) ** 2 + (o.y - z.y) ** 2 <= R2) n++;
      if (n > bestN || (n === bestN && d < bestD)) { best = z; bestN = n; bestD = d; }
    }
    if (!best) { this.cooldown = 0.4; return; }
    this.cooldown = CATA.reload;
    this.ammo--;
    this.updateAmmo();
    const v = best.body?.velocity, lead = CATA.flight * 0.8;
    const tx = best.x + (v ? v.x * lead : 0), ty = best.y + (v ? v.y * lead : 0);
    this.fire(tx, ty);
  }

  fire(tx, ty) {
    const scene = this.scene, sx = this.x, sy = this.y - 6;
    this.setFlipX(tx < this.x);
    audio.sfx('whoosh');
    scene.tweens.add({ targets: this, scaleY: 0.85, duration: 90, yoyo: true });
    const rock = scene.add.image(sx, sy, 'cata_rock').setDepth(9400);
    const mark = scene.add.circle(tx, ty, CATA.radius, 0xa2a6b0, 0.08).setStrokeStyle(1, 0xd0d4dc, 0.5).setDepth(3);
    const h = 30 + Phaser.Math.Distance.Between(sx, sy, tx, ty) * 0.25;
    scene.tweens.addCounter({
      from: 0, to: 1, duration: CATA.flight * 1000,
      onUpdate: (tw) => { const k = tw.getValue(); rock.setPosition(sx + (tx - sx) * k, sy + (ty - sy) * k - Math.sin(k * Math.PI) * h).setRotation(k * 8); },
      onComplete: () => { rock.destroy(); mark.destroy(); if (scene.sys?.isActive()) blast(scene, tx, ty, CATA.radius, CATA.dmg, 0xa2a6b0); }
    });
  }

  destroy(fromScene) {
    this.ammoBar?.destroy();
    super.destroy(fromScene);
  }
}

// 16x24 kule: taban karosu (x,y) merkezde, gövde yukarı uzanır
class ArcherTower extends Structure {
  constructor(scene, x, y, hp, level) {
    super(scene, x, y, 'archer_tower', 60);
    Object.assign(this, { kind: 'archer_tower', label: 'Okçu kulesi', blocksPlayer: true, blocksZombie: true, debris: 0xa8784a });
    this.setOrigin(0.5, 2 / 3);
    this.body.updateFromGameObject();
    this.body.setSize(12, 10, false);
    this.body.setOffset(2, 14);
    this.setDepth(y + 8);
    this.bar.setY(y - 19);
    this.cooldown = 0.5;
    this.level = 1;
    this.setLevel(level || 1, false);
    if (hp != null) { this.hp = Math.min(hp, this.maxHp); this.updateBar(); }
  }

  setLevel(lv, heal) {
    const before = this.maxHp;
    this.level = Phaser.Math.Clamp(lv | 0, 1, TOWER_LEVELS.length - 1);
    const L = TOWER_LEVELS[this.level];
    Object.assign(this, { dmg: L.dmg, range: L.range, rate: L.rate, maxHp: L.maxHp });
    if (heal) this.hp += this.maxHp - before;
    this.hp = Math.min(this.hp, this.maxHp);
    const key = this.level > 1 ? `archer_tower_lv${this.level}` : 'archer_tower';
    if (this.scene.textures.exists(key)) this.setTexture(key);
    if (this.level > 1) {
      const pk = `def_pips${this.level}`;
      if (!this.pips) this.pips = this.scene.add.image(this.x, this.y + 10, pk).setDepth(this.depth + 1);
      else this.pips.setTexture(pk);
    }
    this.updateBar();
  }

  update(dt) {
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    let best = null, bestD = this.range;
    for (const z of this.scene.zombies.getChildren()) {
      if (z.dead) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, z.x, z.y);
      if (d < bestD) { bestD = d; best = z; }
    }
    if (!best) { this.cooldown = 0.2; return; }
    this.cooldown = this.rate;
    const sx = this.x, sy = this.y - 10;
    const a = Phaser.Math.Angle.Between(sx, sy, best.x, best.y);
    const scene = this.scene;
    scene.fireBullet(sx, sy, a, this.dmg, 240);
    const b = scene.bullets.getChildren().at(-1);
    if (b && scene.textures.exists('cb_arrow')) b.setTexture('cb_arrow');
    audio.sfx('bow');
  }

  destroy(fromScene) {
    this.pips?.destroy();
    super.destroy(fromScene);
  }
}

// Zemin yapıları: çarpışmaz, zombiler hedef almaz (patlamalar yine zarar verir)
class TarPit extends Structure {
  constructor(scene, x, y, hp) {
    super(scene, x, y, 'tar_pit', 90);
    Object.assign(this, { kind: 'tar_pit', label: 'Katran çukuru', blocksPlayer: false, blocksZombie: false, debris: 0x2a2530 });
    this.setDepth(y - 8);
    if (hp != null) { this.hp = Math.min(hp, this.maxHp); this.updateBar(); }
  }

  wear() { this.hp -= 1; this.updateBar(); if (this.hp <= 0) this.demolish(); }
}

class Mine extends Structure {
  constructor(scene, x, y, hp) {
    super(scene, x, y, 'mine', 10);
    Object.assign(this, { kind: 'mine', label: 'Mayın', blocksPlayer: false, blocksZombie: false, debris: 0x4a4a55 });
    this.setDepth(y - 8);
    this.armT = MINE.arm;
    this.fuse = -1;
    this.done = false;
    if (hp != null) { this.hp = Math.min(hp, this.maxHp); this.updateBar(); }
  }

  trigger() {
    if (this.fuse >= 0 || this.done || !this.active) return;
    this.fuse = MINE.fuse;
    this.setTintFill(0xff4a3a);
    audio.sfx('reload');
  }

  tick(dt) {
    this.armT -= dt;
    if (this.fuse < 0) return;
    this.fuse -= dt;
    if (this.fuse < 0) this.demolish();
  }

  // Yıkılınca (basılma ya da hasar) patlar
  demolish() {
    if (this.done) return;
    this.done = true;
    const { scene, x, y } = this;
    super.demolish();
    blast(scene, x, y, MINE.radius, MINE.dmg, 0xf0c060);
  }
}

class StakeWall extends Structure {
  constructor(scene, x, y, hp) {
    super(scene, x, y, 'stake_wall', 140);
    Object.assign(this, { kind: 'stake_wall', label: 'Kazık duvarı', blocksPlayer: true, blocksZombie: true, debris: 0xa8784a });
    if (hp != null) { this.hp = Math.min(hp, this.maxHp); this.updateBar(); }
  }
}

class RepairStation extends Structure {
  constructor(scene, x, y, hp) {
    super(scene, x, y, 'repair_station', 70);
    Object.assign(this, { kind: 'repair_station', label: 'Onarım tezgâhı', blocksPlayer: true, blocksZombie: true, debris: 0x7d808a });
    if (hp != null) { this.hp = Math.min(hp, this.maxHp); this.updateBar(); }
  }
}

Object.assign(KINDS.catapult, { cls: Catapult, make: (scene, x, y, hp, extra) => new Catapult(scene, x, y, hp, extra?.ammo) });
Object.assign(KINDS.archer_tower, { cls: ArcherTower, make: (scene, x, y, hp, extra) => new ArcherTower(scene, x, y, hp, extra?.level) });
KINDS.tar_pit.cls = TarPit;
KINDS.mine.cls = Mine;
KINDS.stake_wall.cls = StakeWall;
KINDS.repair_station.cls = RepairStation;

// Kazık duvarı yönü: yalnızca üst/alt komşusu varsa dikey doku (barikat mantığının eşi)
const LINE_KINDS = new Set(['stake_wall', 'stone_wall', 'gate']);
export function stakeTexAt(scene, x, y, self = null) {
  const near = (dx, dy) => [...scene.barricades.getChildren(), ...scene.defStructs.getChildren()]
    .some((o) => o !== self && o.active && (o.kind === 'barricade' || LINE_KINDS.has(o.kind)) && Math.abs(o.x - (x + dx)) < 4 && Math.abs(o.y - (y + dy)) < 4);
  const vert = near(0, -16) || near(0, 16), horiz = near(-16, 0) || near(16, 0);
  return vert && !horiz ? 'stake_wall_v' : 'stake_wall';
}

function refreshStakes(scene) {
  scene.defStructs?.getChildren().forEach((s) => {
    if (!s.active || s.kind !== 'stake_wall') return;
    const key = stakeTexAt(scene, s.x, s.y, s);
    if (s.texture.key !== key && scene.textures.exists(key)) s.setTexture(key);
  });
}

// ---------- Yerleştirme ----------
function fail(scene, msg) { audio.sfx('error'); if (msg) scene.hud.notice(msg); }

function placeDefense(scene, id, ctx) {
  if (!canPlace(scene, ctx.cx, ctx.cy)) return fail(scene, 'Buraya yerleştirilemez');
  if (!scene.inventory.remove(id, 1)) return;
  const s = spawn(scene, id, ctx.cx, ctx.cy);
  scene.player.actionCd = 0.3;
  scene.spawnParticles(ctx.cx, ctx.cy + 4, s?.debris || 0x8a5a3a, 6);
  audio.sfx('place');
  const tips = {
    flame_turret: 'Alev tareti kuruldu. Yakıt bitince E ile odun ekle.',
    catapult: `Mancınık kuruldu (${CATA.startAmmo} taş yüklü). E ile taş ekle.`,
    mine: 'Mayın 1 sn içinde kurulur. Üstüne basma derdin yok, sadece zombileri vurur.',
    repair_station: 'Onarım tezgâhı gece yakındaki yapıları onarır.'
  };
  if (tips[id]) scene.hud.toast(tips[id], 'info');
}

function spawn(scene, kind, x, y, hp, extra) {
  const k = KINDS[kind];
  if (!k) return null;
  const s = kind === 'flame_turret' ? new FlameTurret(scene, x, y, hp, extra?.fuel)
    : k.make ? k.make(scene, x, y, hp, extra) : new k.cls(scene, x, y, hp);
  scene.defStructs.add(s);
  // Alev tareti ve kule tipi yapılar zombilerin hedefi olur (normal taret gibi)
  if (kind === 'flame_turret' || k.target) {
    scene.extraTargets.push(s);
    s.once('destroy', () => { const i = scene.extraTargets.indexOf(s); if (i >= 0) scene.extraTargets.splice(i, 1); });
  }
  if (kind === 'lamp_post') s.once('destroy', () => refreshLights(scene));
  refreshLights(scene);
  if (LINE_KINDS.has(kind)) refreshStakes(scene);
  return s;
}

// ---------- Çekiç: onarım ----------
function allStructures(scene) {
  return [...scene.barricades.getChildren(), ...scene.turrets.getChildren(), ...scene.defStructs.getChildren()];
}

function useHammer(scene, { wx, wy }) {
  const p = scene.player;
  let target = null, best = 14;
  // Önce tıklanan yapı, yoksa oyuncuya en yakın hasarlı yapı
  for (const s of allStructures(scene)) {
    if (!s.active) continue;
    const d = Phaser.Math.Distance.Between(wx, wy, s.x, s.y);
    if (d < best && s.hp < s.maxHp && Phaser.Math.Distance.Between(p.x, p.y, s.x, s.y) < 40) { best = d; target = s; }
  }
  if (!target) {
    best = 36;
    for (const s of allStructures(scene)) {
      if (!s.active || s.hp >= s.maxHp) continue;
      const d = Phaser.Math.Distance.Between(p.x, p.y, s.x, s.y);
      if (d < best) { best = d; target = s; }
    }
  }
  if (!target) {
    // Sığınak da onarılabilir
    const sh = scene.shelter;
    if (sh.hp < sh.maxHp && sh.distanceFrom(p.x, p.y) < 20) target = sh;
  }
  if (!target) return fail(scene, 'Yakında hasarlı yapı yok');
  const pref = target.kind === 'stone_wall' || target.isShelter ? ['stone', 'wood'] : ['wood', 'stone'];
  const mat = pref.find((m) => scene.inventory.count(m) > 0);
  if (!mat) return fail(scene, 'Onarım için odun ya da taş gerekli');
  if (!p.useEnergy(2)) return;
  scene.inventory.remove(mat, 1);
  target.repair(HAMMER_HEAL);
  p.actionCd = 0.4;
  p.setFlipX(target.x < p.x);
  scene.tweens.add({ targets: target, y: target.y - 1, duration: 50, yoyo: true });
  scene.spawnParticles(target.x, target.y + 2, mat === 'stone' ? 0xa2a6b0 : 0xc9a06b, 6);
  scene.floatText(target.x, target.y - 10, `+${HAMMER_HEAL} 🔧`, '#9effa0');
  audio.sfx(mat === 'stone' ? 'mine' : 'chop');
}

// ---------- Taret yükseltme / alev tareti yakıtı (E etkileşimi) ----------
function costText(c) { return `${c.coins}🪙 + ${c.stone} taş`; }

function upgradeTurret(scene, t) {
  const next = TURRET_LEVELS[t.level + 1];
  if (!next) return;
  const p = scene.player, c = next.cost;
  if (p.coins < c.coins || scene.inventory.count('stone') < c.stone) return fail(scene, `Yükseltme için ${costText(c)} gerekli`);
  p.addCoins(-c.coins);
  scene.inventory.remove('stone', c.stone);
  t.setLevel(t.level + 1, true);
  scene.spawnParticles(t.x, t.y, 0xffd166, 12);
  scene.floatText(t.x, t.y - 12, `Taret Sv.${t.level}!`, '#ffd166');
  scene.hud.toast(t.level === 2 ? 'Taret Sv.2: hasar +1, menzil +20' : 'Taret Sv.3: atış hızı +%40', 'ok');
  audio.sfx('craft');
}

function refuel(scene, f) {
  const room = Math.floor((FLAME.maxFuel - f.fuel) / FLAME.fuelPerWood);
  const n = Math.min(Math.max(1, room), scene.inventory.count('wood'), 5);
  if (n <= 0) return fail(scene, 'Yakıt için odun gerekli');
  if (f.fuel >= FLAME.maxFuel) return fail(scene, 'Depo dolu');
  scene.inventory.remove('wood', n);
  f.addFuel(n * FLAME.fuelPerWood);
  scene.floatText(f.x, f.y - 12, `+${n} odun 🔥`, '#ffb347');
  audio.sfx('place');
}

function towerCostText(c) { return `${c.coins}🪙 + ${c.wood} odun`; }

function upgradeTower(scene, t) {
  const next = TOWER_LEVELS[t.level + 1];
  if (!next) return;
  const p = scene.player, c = next.cost;
  if (p.coins < c.coins || scene.inventory.count('wood') < c.wood) return fail(scene, `Yükseltme için ${towerCostText(c)} gerekli`);
  p.addCoins(-c.coins);
  scene.inventory.remove('wood', c.wood);
  t.setLevel(t.level + 1, true);
  scene.spawnParticles(t.x, t.y - 8, 0xffd166, 12);
  scene.floatText(t.x, t.y - 20, `Kule Sv.${t.level}!`, '#ffd166');
  scene.hud.toast(t.level === 2 ? 'Okçu kulesi Sv.2: hasar +1, menzil +10' : 'Okçu kulesi Sv.3: atış hızı +%45', 'ok');
  audio.sfx('craft');
}

function loadCatapult(scene, c) {
  const n = Math.min(CATA.load, CATA.maxAmmo - c.ammo, scene.inventory.count('stone'));
  if (c.ammo >= CATA.maxAmmo) return fail(scene, 'Mancınık dolu');
  if (n <= 0) return fail(scene, 'Mancınık için taş gerekli');
  scene.inventory.remove('stone', n);
  c.addAmmo(n);
  scene.floatText(c.x, c.y - 12, `+${n} taş 🪨`, '#d0d4dc');
  audio.sfx('place');
}

// Okçu kulesi yükseltme + mancınık taş yükleme (interaction() içinden)
function extraInteraction(scene) {
  const p = scene.player, st = scene.defState;
  let best = null, bestD = UPGRADE_REACH, type = null;
  for (const t of st.towers) {
    if (!t.active || !TOWER_LEVELS[t.level + 1]) continue;
    const d = Phaser.Math.Distance.Between(p.x, p.y, t.x, t.y);
    if (d < bestD) { bestD = d; best = t; type = 'tower'; }
  }
  for (const c of st.catapults) {
    if (!c.active || c.ammo > CATA.maxAmmo - 5) continue;
    const d = Phaser.Math.Distance.Between(p.x, p.y, c.x, c.y);
    if (d < bestD) { bestD = d; best = c; type = 'cata'; }
  }
  if (!best) return null;
  if (type === 'cata') return { dist: bestD, label: `Mancınık: taş yükle (${best.ammo}/${CATA.maxAmmo})`, run: () => loadCatapult(scene, best) };
  const c = TOWER_LEVELS[best.level + 1].cost;
  return { dist: bestD, label: `Okçu kulesini yükselt Sv.${best.level}→${best.level + 1} (${towerCostText(c)})`, run: () => upgradeTower(scene, best) };
}

function interaction(scene) {
  const extra = extraInteraction(scene);
  const base = baseInteraction(scene);
  if (extra && (!base || extra.dist < base.dist)) return extra;
  return base;
}

function baseInteraction(scene) {
  const p = scene.player;
  let best = null, bestD = UPGRADE_REACH;
  for (const t of scene.turrets.getChildren()) {
    if (!t.active || !TURRET_LEVELS[(t.level || 1) + 1]) continue;
    const d = Phaser.Math.Distance.Between(p.x, p.y, t.x, t.y);
    if (d < bestD) { bestD = d; best = t; }
  }
  for (const f of scene.defStructs.getChildren()) {
    if (f.kind !== 'flame_turret' || !f.active || f.fuel > FLAME.maxFuel - FLAME.fuelPerWood) continue;
    const d = Phaser.Math.Distance.Between(p.x, p.y, f.x, f.y);
    if (d < bestD) { bestD = d; best = f; }
  }
  if (!best) return null;
  if (best.kind === 'flame_turret') {
    return { dist: bestD, label: `Alev tareti: odun ekle (yakıt ${Math.ceil(best.fuel)} sn)`, run: () => refuel(scene, best) };
  }
  const lv = best.level || 1, c = TURRET_LEVELS[lv + 1].cost;
  return { dist: bestD, label: `Tareti yükselt Sv.${lv}→${lv + 1} (${costText(c)})`, run: () => upgradeTurret(scene, best) };
}

// ---------- Işıklar ----------
function refreshLights(scene) {
  const st = scene.defState;
  st.lamps = scene.defStructs.getChildren().filter((s) => s.active && s.kind === 'lamp_post');
  st.flames = scene.defStructs.getChildren().filter((s) => s.active && s.kind === 'flame_turret');
  st.traps = scene.defStructs.getChildren().filter((s) => s.active && s.kind === 'spike_trap');
  st.gates = scene.defStructs.getChildren().filter((s) => s.active && s.kind === 'gate');
  const of = (k) => scene.defStructs.getChildren().filter((s) => s.active && s.kind === k);
  st.catapults = of('catapult');
  st.towers = of('archer_tower');
  st.tars = of('tar_pit');
  st.mines = of('mine');
  st.stakes = of('stake_wall');
  st.stations = of('repair_station');
}

function lightList(scene) {
  const st = scene.defState, out = st.lightBuf;
  out.length = 0;
  for (const s of st.stations) if (s.active) out.push({ x: s.x, y: s.y, r: 30 });
  for (const l of st.lamps) if (l.active) out.push({ x: l.x, y: l.y - 6, r: l.lightR });
  for (const f of st.flames) if (f.active && f.firing > 0) out.push({ x: f.x, y: f.y, r: 40 });
  return out;
}

// ---------- Savunma paneli (mobil + masaüstü) ----------
function openPanel(scene) {
  const inv = scene.inventory, icon = (id) => scene.hud.icon(id);
  const body = el('div', 'def-panel');
  const render = () => {
    const counts = {};
    allStructures(scene).forEach((s) => { const k = s.kind === 'turret' ? `turret${s.level || 1}` : s.kind; counts[k] = (counts[k] || 0) + 1; });
    const names = { barricade: 'Barikat', turret1: 'Taret Sv.1', turret2: 'Taret Sv.2', turret3: 'Taret Sv.3', stone_wall: 'Taş duvar', spike_trap: 'Tuzak', gate: 'Kapı', lamp_post: 'Işık', flame_turret: 'Alev tareti',
      catapult: 'Mancınık', archer_tower: 'Okçu kulesi', tar_pit: 'Katran', mine: 'Mayın', stake_wall: 'Kazık duvarı', repair_station: 'Onarım tezgâhı' };
    const chips = Object.entries(counts).map(([k, n]) => `<span class="def-chip">${names[k] || k} ×${n}</span>`).join('') || '<span class="muted">Henüz savunma yapın yok.</span>';
    body.innerHTML = `<div class="def-sec"><b>Kurulu yapılar</b><div class="def-chips">${chips}</div></div><div class="def-sec"><b>Savunma üret</b></div>`;
    DEF_RECIPES.forEach((r) => {
      const ok = inv.has(r.cost);
      const cost = Object.entries(r.cost).map(([id, n]) => `<span class="cost ${inv.count(id) >= n ? '' : 'miss'}"><img src="${icon(id)}" alt="">${inv.count(id)}/${n}</span>`).join('');
      const row = el('div', `recipe ${ok ? '' : 'locked'}`, `<img class="out" src="${icon(r.out)}" alt=""><div class="rinfo"><b>${ITEMS[r.out].name}</b><div>${cost}</div><span class="muted def-desc">${ITEMS[r.out].desc}</span></div><button ${ok ? '' : 'disabled'}>Üret</button>`);
      row.querySelector('button').addEventListener('click', () => {
        if (inv.craft(r)) { audio.sfx('craft'); scene.hud.toast(`${ITEMS[r.out].name} üretildi`, 'ok'); } else audio.sfx('error');
        render();
      });
      body.appendChild(row);
    });
    body.appendChild(el('div', 'def-sec muted def-tips',
      '🔧 <b>Çekiç</b> (Zeynep, 40🪙): hasarlı yapıya tıkla, +25 can.<br>⬆️ <b>Taret yükseltme</b>: tarete yaklaş, E / eylem butonu.<br>🔥 <b>Alev tareti</b> (Zeynep, 200🪙): yakıtı odun, E ile doldur.<br>🚪 <b>Kapı</b> sana açılır, zombilere kapalı kalır.<br>🏹 <b>Okçu kulesi</b>: E ile yükselt (altın + odun).<br>🪨 <b>Mancınık</b>: her atış 1 taş, E ile yükle.<br>💣 <b>Mayın</b> ve 🛢️ <b>katran</b> zemine konur, zombiler fark etmeden üstünden geçer.'));
  };
  render();
  scene.hud.openPanel('Savunma', body);
}

// ---------- Dokular ----------
function makeTextures(scene) {
  addCanvas(scene, 'stone_wall', 16, 16, (ctx) => {
    R(ctx, 0, 1, 16, 15, '#5d5f69');
    const rows = [[1, 0], [5, 4], [9, 0], [13, 4]];
    rows.forEach(([y, off]) => {
      for (let x = -off; x < 16; x += 8) { R(ctx, x + 1, y + 1, 6, 3, '#9a9da8'); R(ctx, x + 1, y + 1, 6, 1, '#b8bcc6'); }
    });
    R(ctx, 0, 15, 16, 1, '#3e4048');
  });
  const gate = (open) => (ctx) => {
    R(ctx, 0, 2, 3, 14, '#5d5f69'); R(ctx, 13, 2, 3, 14, '#5d5f69'); R(ctx, 0, 1, 3, 2, '#9a9da8'); R(ctx, 13, 1, 3, 2, '#9a9da8');
    if (open) { R(ctx, 3, 4, 2, 11, '#8a5a3a'); R(ctx, 11, 4, 2, 11, '#8a5a3a'); return; }
    R(ctx, 3, 4, 10, 11, '#8a5a3a');
    for (const x of [5, 8, 11]) R(ctx, x, 4, 1, 11, '#6b4429');
    R(ctx, 3, 6, 10, 1, '#4a4a55'); R(ctx, 3, 12, 10, 1, '#4a4a55'); R(ctx, 7, 9, 2, 2, '#e8c867');
  };
  addCanvas(scene, 'gate', 16, 16, gate(false));
  addCanvas(scene, 'gate_open', 16, 16, gate(true));
  addCanvas(scene, 'spike_trap', 16, 16, (ctx) => {
    R(ctx, 1, 9, 14, 5, '#6b4429'); R(ctx, 1, 9, 14, 1, '#8a5a3a');
    for (const x of [2, 6, 10, 13]) { R(ctx, x, 5, 1, 4, '#c8c8d0'); R(ctx, x, 4, 1, 1, '#ffffff'); }
    for (const x of [4, 8, 12]) { R(ctx, x, 7, 1, 2, '#9aa3ad'); }
  });
  const lamp = (ctx) => {
    R(ctx, 5, 13, 6, 3, '#4a4a55'); R(ctx, 7, 4, 2, 10, '#3a3a44');
    R(ctx, 5, 1, 6, 4, '#2c2c34'); R(ctx, 6, 2, 4, 2, '#ffd166'); R(ctx, 7, 2, 2, 1, '#fff6c2'); R(ctx, 4, 0, 8, 1, '#2c2c34');
  };
  addCanvas(scene, 'lamp_post', 16, 16, lamp);
  addCanvas(scene, 'i_lamp_post', 16, 16, lamp);
  addCanvas(scene, 'flame_turret', 16, 16, (ctx) => {
    R(ctx, 3, 10, 10, 5, '#5a3a2a'); R(ctx, 4, 6, 8, 5, '#a8452f'); R(ctx, 5, 7, 6, 3, '#d9643f');
    R(ctx, 10, 7, 5, 3, '#2c2c34'); R(ctx, 15, 7, 1, 3, '#f08a24'); R(ctx, 6, 4, 3, 2, '#3a3a44'); R(ctx, 7, 7, 2, 2, '#ffd166');
  });
  // Taret seviye dokuları
  const turret = (body, hi, barrel) => (ctx) => {
    R(ctx, 3, 10, 10, 5, '#5a5d66'); R(ctx, 4, 6, 8, 5, body); R(ctx, 5, 7, 6, 3, hi);
    R(ctx, 10, 7, 6, 2, barrel); R(ctx, 7, 7, 2, 2, '#ff5a5a');
  };
  addCanvas(scene, 'turret_lv2', 16, 16, turret('#4f7fb0', '#7ab0e6', '#2c2c34'));
  addCanvas(scene, 'turret_lv3', 16, 16, (ctx) => { turret('#b08a2f', '#e8c867', '#2c2c34')(ctx); R(ctx, 10, 9, 6, 1, '#2c2c34'); });
  addCanvas(scene, 'def_pips2', 7, 3, (ctx) => { R(ctx, 0, 0, 3, 3, '#1b1622'); R(ctx, 4, 0, 3, 3, '#1b1622'); R(ctx, 1, 1, 1, 1, '#ffd166'); R(ctx, 5, 1, 1, 1, '#ffd166'); });
  addCanvas(scene, 'def_pips3', 11, 3, (ctx) => { for (const x of [0, 4, 8]) { R(ctx, x, 0, 3, 3, '#1b1622'); R(ctx, x + 1, 1, 1, 1, '#ffd166'); } });
  addCanvas(scene, 'i_hammer', 16, 16, (ctx) => {
    for (let i = 0; i < 9; i++) R(ctx, 3 + i, 12 - i, 2, 2, '#8a5a3a');
    R(ctx, 8, 1, 7, 4, '#7d808a'); R(ctx, 8, 1, 7, 1, '#b8c1cb'); R(ctx, 14, 1, 1, 4, '#5a5d66');
  });
  makeNewTextures(scene);
}

function makeNewTextures(scene) {
  // Mancınık: tekerlekli kızak, kol ve kepçede taş
  addCanvas(scene, 'catapult', 16, 16, (ctx) => {
    R(ctx, 1, 11, 14, 3, '#6b4429'); R(ctx, 1, 11, 14, 1, '#8a5a3a');
    R(ctx, 2, 13, 3, 3, '#3a2a20'); R(ctx, 11, 13, 3, 3, '#3a2a20'); R(ctx, 3, 14, 1, 1, '#9a8a7a'); R(ctx, 12, 14, 1, 1, '#9a8a7a');
    R(ctx, 6, 6, 2, 6, '#5a3a2a'); R(ctx, 5, 5, 4, 1, '#3a2a20');
    for (let i = 0; i < 9; i++) R(ctx, 3 + i, 10 - i, 2, 1, '#c9a06b');
    R(ctx, 1, 8, 4, 3, '#5d5f69'); R(ctx, 1, 8, 4, 1, '#7d808a');
    R(ctx, 11, 1, 4, 2, '#5a3a2a'); R(ctx, 12, 0, 2, 1, '#a2a6b0'); R(ctx, 12, 0, 1, 1, '#d0d4dc');
  });
  addCanvas(scene, 'cata_rock', 5, 5, (ctx) => {
    R(ctx, 1, 0, 3, 5, '#7d808a'); R(ctx, 0, 1, 5, 3, '#7d808a'); R(ctx, 1, 1, 2, 2, '#b8bcc6'); R(ctx, 3, 3, 1, 1, '#5a5d66');
  });

  // Okçu kulesi (16x24) + seviye bayrakları
  const tower = (flag) => (ctx) => {
    R(ctx, 3, 12, 2, 12, '#6b4429'); R(ctx, 11, 12, 2, 12, '#6b4429');
    for (let i = 0; i < 6; i++) { R(ctx, 5 + i, 14 + i, 1, 1, '#5a3a2a'); R(ctx, 10 - i, 14 + i, 1, 1, '#5a3a2a'); }
    R(ctx, 1, 9, 14, 4, '#8a5a3a'); R(ctx, 1, 9, 14, 1, '#a8784a'); R(ctx, 5, 10, 1, 3, '#6b4429'); R(ctx, 10, 10, 1, 3, '#6b4429');
    R(ctx, 3, 4, 10, 5, '#7a4e2f'); R(ctx, 3, 4, 1, 5, '#8a5a3a'); R(ctx, 7, 5, 2, 3, '#1b1622'); R(ctx, 6, 6, 4, 1, '#e8c867');
    R(ctx, 1, 2, 14, 2, '#a8452f'); R(ctx, 3, 1, 10, 1, '#c45a3a'); R(ctx, 5, 0, 6, 1, '#d9643f');
    if (flag) { R(ctx, 13, 0, 1, 3, '#3a3a44'); R(ctx, 14, 0, 2, 2, flag); }
  };
  addCanvas(scene, 'archer_tower', 16, 24, tower(null));
  addCanvas(scene, 'archer_tower_lv2', 16, 24, tower('#4f7fb0'));
  addCanvas(scene, 'archer_tower_lv3', 16, 24, tower('#e8c867'));
  addCanvas(scene, 'i_archer_tower', 16, 16, (ctx) => {
    R(ctx, 4, 10, 2, 6, '#6b4429'); R(ctx, 10, 10, 2, 6, '#6b4429');
    R(ctx, 2, 8, 12, 3, '#8a5a3a'); R(ctx, 2, 8, 12, 1, '#a8784a');
    R(ctx, 4, 4, 8, 4, '#7a4e2f'); R(ctx, 7, 5, 2, 2, '#1b1622');
    R(ctx, 2, 2, 12, 2, '#a8452f'); R(ctx, 4, 1, 8, 1, '#c45a3a');
  });

  // Katran çukuru
  addCanvas(scene, 'tar_pit', 16, 16, (ctx) => {
    R(ctx, 3, 4, 10, 1, '#4a3d30'); R(ctx, 1, 5, 14, 8, '#4a3d30'); R(ctx, 3, 13, 10, 1, '#4a3d30');
    R(ctx, 3, 5, 10, 8, '#1d1a1f'); R(ctx, 2, 6, 12, 6, '#1d1a1f');
    R(ctx, 4, 6, 3, 1, '#3d3545'); R(ctx, 9, 9, 2, 1, '#4a4258'); R(ctx, 6, 10, 1, 1, '#5a5268'); R(ctx, 11, 7, 1, 1, '#3d3545');
  });

  // Mayın: toprağa gömülü plaka + kırmızı tetik
  addCanvas(scene, 'mine', 16, 16, (ctx) => {
    R(ctx, 2, 10, 12, 3, '#6b4c33'); R(ctx, 3, 9, 10, 1, '#6b4c33');
    R(ctx, 4, 8, 8, 3, '#4a4a55'); R(ctx, 5, 7, 6, 1, '#7d808a'); R(ctx, 5, 8, 6, 1, '#5d5f69');
    R(ctx, 7, 6, 2, 1, '#c84a3a'); R(ctx, 7, 6, 1, 1, '#ff7a6a');
  });

  // Sivri kazık duvarı: yatay (önden) ve dikey (yandan, dışa bakan kazıklar)
  addCanvas(scene, 'stake_wall', 16, 16, (ctx) => {
    R(ctx, 0, 12, 16, 2, '#5a3a2a');
    for (const x of [1, 5, 9, 13]) {
      R(ctx, x, 4, 3, 10, '#a8784a'); R(ctx, x, 4, 1, 10, '#c9a06b'); R(ctx, x + 2, 4, 1, 10, '#7a4e2f');
      R(ctx, x, 3, 3, 1, '#c9a06b'); R(ctx, x + 1, 1, 1, 2, '#e0cfa8');
    }
    R(ctx, 0, 7, 16, 1, '#6b5a3a'); R(ctx, 0, 14, 16, 1, '#3a2a20');
  });
  addCanvas(scene, 'stake_wall_v', 16, 16, (ctx) => {
    R(ctx, 6, 0, 4, 16, '#7a4e2f'); R(ctx, 6, 0, 1, 16, '#a8784a'); R(ctx, 9, 0, 1, 16, '#5a3a2a');
    for (const y of [1, 6, 11]) {
      R(ctx, 2, y, 4, 2, '#a8784a'); R(ctx, 1, y, 1, 1, '#e0cfa8'); R(ctx, 2, y, 4, 1, '#c9a06b');
      R(ctx, 10, y + 2, 4, 2, '#a8784a'); R(ctx, 14, y + 2, 1, 1, '#e0cfa8'); R(ctx, 10, y + 2, 4, 1, '#c9a06b');
    }
    R(ctx, 6, 7, 4, 1, '#6b5a3a');
  });

  // Onarım tezgâhı: örs, tezgâh ve yeşil artı tabelası
  addCanvas(scene, 'repair_station', 16, 16, (ctx) => {
    R(ctx, 3, 12, 2, 4, '#5a3a2a'); R(ctx, 11, 12, 2, 4, '#5a3a2a');
    R(ctx, 1, 9, 13, 3, '#8a5a3a'); R(ctx, 1, 9, 13, 1, '#a8784a');
    R(ctx, 3, 6, 7, 3, '#5d5f69'); R(ctx, 2, 6, 9, 1, '#7d808a'); R(ctx, 5, 8, 3, 1, '#4a4a55');
    R(ctx, 13, 3, 1, 9, '#3a3a44'); R(ctx, 11, 0, 5, 5, '#e8e8e8'); R(ctx, 13, 1, 1, 3, '#3aa845'); R(ctx, 12, 2, 3, 1, '#3aa845');
  });
}

// ---------- Yeni yapıların kare güncellemesi ----------
function updateNew(scene, dt, st, night, zs) {
  for (const c of st.catapults) if (c.active) c.update(dt);
  for (const t of st.towers) if (t.active) t.update(dt);
  for (const m of st.mines) if (m.active) m.tick(dt);

  // Katran / kazık / mayın: zombi başına tek geçiş
  if (st.tars.length || st.stakes.length || st.mines.length) {
    st.tarClock -= dt;
    const tarTick = st.tarClock <= 0;
    if (tarTick) st.tarClock = 1;
    for (const z of zs) {
      if (z.dead || !z.body) continue;
      let mul = 1;
      for (const t of st.tars) {
        if (t.active && Math.abs(z.x - t.x) < 8 && Math.abs(z.y + 4 - t.y) < 9) {
          mul = TAR.slow; z.defTar = TAR.linger;
          if (tarTick) t.wear();
          break;
        }
      }
      if (mul === 1 && z.defTar > 0) { z.defTar -= dt; mul = TAR.lingerSlow; }
      if (mul < 1) z.body.velocity.scale(mul);
      // Kazık: dibindeki zombiye düzenli hasar (geri itmesiz, saldırıyı kesmez)
      if (st.stakes.length) {
        z.defThorn = (z.defThorn || 0) - dt;
        if (z.defThorn <= 0) {
          for (const s of st.stakes) {
            if (s.active && Math.abs(z.x - s.x) < 14 && Math.abs(z.y - s.y) < 15) {
              z.defThorn = STAKE.tick;
              z.takeDamage(STAKE.dmg, null);
              break;
            }
          }
        }
      }
      if (z.dead) continue;
      for (const m of st.mines) {
        if (m.active && m.armT <= 0 && m.fuse < 0 && Math.abs(z.x - m.x) < MINE.trigger && Math.abs(z.y + 4 - m.y) < MINE.trigger) m.trigger();
      }
    }
  }

  // Onarım tezgâhı: gece yakındaki yapıları yavaşça onarır
  if (night && st.stations.length) {
    st.healClock -= dt;
    if (st.healClock <= 0) {
      st.healClock = STATION.tick;
      const R2 = STATION.range * STATION.range, all = allStructures(scene);
      for (const s of st.stations) {
        if (!s.active) continue;
        for (const o of all) {
          if (o === s || !o.active || o.hp >= o.maxHp || o.hp <= 0) continue;
          if ((o.x - s.x) ** 2 + (o.y - s.y) ** 2 > R2) continue;
          o.repair(STATION.heal);
          if (Math.random() < 0.5) scene.spawnParticles(o.x, o.y - 4, 0x6ee06e, 2);
        }
        const sh = scene.shelter;
        if (sh && sh.hp > 0 && sh.hp < sh.maxHp && sh.distanceFrom(s.x, s.y) < STATION.range) sh.repair(STATION.shelterHeal);
      }
    }
  }

  // Barikat sayısı değişince (yerleştirme) kazık yönlerini yenile
  const bn = scene.barricades.getChildren().length;
  if (bn !== st.barN) { st.barN = bn; if (st.stakes.length) refreshStakes(scene); }

  // Yerleştirme önizlemesi: kule tabanı karoya otursun, kazık doğru yöne baksın
  const g = scene.ghost, slot = scene.inventory.slots[scene.selected];
  if (g) {
    if (g.visible && slot?.id === 'archer_tower') g.setOrigin(0.5, 2 / 3);
    else if (g.originY !== 0.5) g.setOrigin(0.5);
    if (g.visible && slot?.id === 'stake_wall') {
      const key = stakeTexAt(scene, g.x, g.y);
      if (g.texture.key !== key) g.setTexture(key);
    }
  }
}

// ---------- Modül ----------
export default {
  id: 'defense',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    scene.defStructs = scene.add.group();
    scene.defState = {
      lamps: [], flames: [], traps: [], gates: [], lightBuf: [], burning: new Set(),
      catapults: [], towers: [], tars: [], mines: [], stakes: [], stations: [], tarClock: 1, healClock: STATION.tick, barN: 0
    };
    // Mini harita: savunma yapıları (zemin yapıları hariç)
    (scene.minimapDots ||= []).push((s) => s.defStructs.getChildren()
      .filter((o) => o.active && o.blocksZombie)
      .map((o) => ({ x: o.x, y: o.y, color: KINDS[o.kind]?.target || o.kind === 'flame_turret' ? '#ffb347' : '#a2a6b0', r: 1 })));
    // Barikat/kazık yıkılınca kazık yönlerini yenile
    scene.events.on('structureDestroyed', (s) => { if (s.kind === 'barricade' || LINE_KINDS.has(s.kind)) scene.time.delayedCall(0, () => refreshStakes(scene)); });
    // Çarpışma süzgeci: kapı ve tuzak oyuncuyu engellemez, tuzak zombiyi de engellemez
    scene.physics.add.collider(scene.player, scene.defStructs, null, (_p, s) => !!s.blocksPlayer);
    scene.physics.add.collider(scene.zombies, scene.defStructs, (z, s) => { z.blockedBy = s; }, (_z, s) => !!s.blocksZombie);
    scene.lightSources.push(lightList);
    scene.defSpawn = (kind, x, y, hp, extra) => spawn(scene, kind, x, y, hp, extra); // testler / diğer modüller için
    scene.addInteraction(interaction);
    scene.featureMenu.push({ id: 'defense', icon: '🛡️', label: 'Savunma', open: openPanel });
    scene.rangeGfx = scene.add.graphics().setDepth(8999);
    scene.events.on('structureDestroyed', (s) => { if (s.kind && KINDS[s.kind]) scene.time.delayedCall(0, () => refreshLights(scene)); });
    injectCSS('defense', `
      .def-panel .def-sec{margin:6px 0 8px}
      .def-panel .def-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
      .def-panel .def-chip{background:rgba(255,255,255,.1);border-radius:8px;padding:2px 8px;font-size:12px}
      .def-panel .def-desc{display:block;font-size:11px;line-height:1.25;margin-top:2px}
      .def-panel .def-tips{font-size:12px;line-height:1.5}
      .def-panel .recipe button{min-height:36px;min-width:64px}
    `);
  },

  update(scene, dt) {
    const st = scene.defState;
    if (!st) return;
    // Alev taretleri
    for (const f of st.flames) if (f.active) f.update(dt, (z) => { z.defBurn = FLAME.burn; z.defBurnTick = z.defBurnTick || 0.5; st.burning.add(z); });

    // Yanma hasarı (0.5 sn'de 1)
    for (const z of st.burning) {
      if (!z.active || z.dead) { st.burning.delete(z); continue; }
      z.defBurn -= dt; z.defBurnTick -= dt;
      if (z.defBurnTick <= 0) {
        z.defBurnTick = 0.5;
        if (Math.random() < 0.6) scene.spawnParticles(z.x, z.y - 4, 0xf08a24, 2);
        z.takeDamage(1, null);
        if (z.dead) { st.burning.delete(z); continue; }
      }
      if (z.defBurn <= 0) { st.burning.delete(z); z.defBurnTick = 0; }
    }

    // Tuzaklar + ışık yavaşlatması (zombi hızını bu karede ölçekle)
    const night = scene.timeSys.isNight;
    const zs = scene.zombies.getChildren();
    if (st.traps.length || (night && st.lamps.length)) {
      for (const t of st.traps) t.tick -= dt;
      for (const z of zs) {
        if (z.dead || !z.body) continue;
        let mul = 1;
        for (const t of st.traps) {
          if (!t.active) continue;
          if (Math.abs(z.x - t.x) < 8 && Math.abs(z.y + 4 - t.y) < 9) {
            mul *= TRAP_SLOW;
            if (t.tick <= 0) { z.takeDamage(TRAP_DMG, null); t.wear(); t.hitThisTick = true; }
            break;
          }
        }
        if (night) {
          for (const l of st.lamps) {
            if (!l.active) continue;
            const dx = z.x - l.x, dy = z.y - l.y;
            if (dx * dx + dy * dy < l.lightR * l.lightR) { mul *= LIGHT_SLOW; break; }
          }
        }
        if (mul < 1 && !z.dead && z.body) z.body.velocity.scale(mul);
      }
      for (const t of st.traps) if (t.tick <= 0) { t.tick = TRAP_TICK; if (t.hitThisTick) { t.hitThisTick = false; audio.sfx('swing'); } }
      if (st.traps.some((t) => !t.active)) refreshLights(scene);
    }

    updateNew(scene, dt, st, night, zs);

    // Kapılar: oyuncu yaklaşınca açılır
    const p = scene.player;
    // Çok oyunculu: herhangi bir oyuncu yaklaşınca açılır
    const near = scene.allPlayers ? scene.allPlayers() : [p];
    for (const g of st.gates) if (g.active) g.setOpen(near.some((q) => Math.abs(q.x - g.x) < 14 && Math.abs(q.y - g.y) < 16));

    // Menzil önizlemesi: yerleştirirken veya yakındaki tarette
    const gfx = scene.rangeGfx;
    gfx.clear();
    const slot = scene.inventory.slots[scene.selected];
    const ranges = { turret: TURRET_LEVELS[1].range, flame_turret: FLAME.range, lamp_post: 90, catapult: CATA.range, archer_tower: TOWER_LEVELS[1].range, repair_station: STATION.range, mine: MINE.radius };
    if (slot && ranges[slot.id] && scene.ghost?.visible) {
      const ok = canPlace(scene, scene.ghost.x, scene.ghost.y);
      gfx.lineStyle(1, ok ? 0x88ff88 : 0xff6666, 0.5).strokeCircle(scene.ghost.x, scene.ghost.y, ranges[slot.id]);
    } else {
      for (const t of scene.turrets.getChildren()) {
        if (Math.abs(p.x - t.x) < UPGRADE_REACH && Math.abs(p.y - t.y) < UPGRADE_REACH) { gfx.lineStyle(1, 0xffd166, 0.35).strokeCircle(t.x, t.y, t.range); break; }
      }
    }
  },

  save(scene) {
    const structs = scene.defStructs.getChildren().filter((s) => s.active).map((s) => {
      const o = { kind: s.kind, x: s.x, y: s.y, hp: s.hp };
      if (s.kind === 'flame_turret') o.fuel = Math.round(s.fuel);
      if (s.kind === 'catapult') o.ammo = s.ammo;
      if (s.kind === 'archer_tower') o.level = s.level;
      return o;
    });
    const turrets = scene.turrets.getChildren().filter((t) => (t.level || 1) > 1).map((t) => ({ x: t.x, y: t.y, level: t.level }));
    return { structs, turrets };
  },

  load(scene, data) {
    if (!data) return;
    (data.structs || []).forEach((s) => {
      if (s && KINDS[s.kind] && Number.isFinite(s.x) && Number.isFinite(s.y)) spawn(scene, s.kind, s.x, s.y, s.hp, s);
    });
    // Taret seviyeleri: GameScene taretleri konumla oluşturdu, eşleştir
    (data.turrets || []).forEach((d) => {
      const t = scene.turrets.getChildren().find((u) => Math.abs(u.x - d.x) < 1 && Math.abs(u.y - d.y) < 1);
      if (t && t.setLevel) t.setLevel(d.level || 1, false);
    });
  }
};

