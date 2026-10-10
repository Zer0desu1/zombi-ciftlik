import { audio } from '../audio.js';

// Statik fizik gövdeli, canı olan yapı tabanı
class Structure extends Phaser.Physics.Arcade.Image {
  constructor(scene, x, y, key, maxHp) {
    super(scene, x, y, key);
    scene.add.existing(this);
    scene.physics.add.existing(this, true);
    this.isStructure = true;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.radius = 8;
    this.setDepth(y + this.height / 2);
    this.bar = scene.add.rectangle(x - 7, y - this.height / 2 - 3, 14, 2, 0x6ee06e).setOrigin(0, 0.5).setDepth(10000).setVisible(false);
  }

  takeDamage(n) {
    if (!this.active) return;
    this.hp -= n;
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(70, () => { if (this.active) this.clearTint(); });
    audio.sfx('chop');
    this.updateBar();
    if (this.hp <= 0) this.demolish();
  }

  repair(n) {
    this.hp = Math.min(this.maxHp, this.hp + n);
    this.updateBar();
  }

  updateBar() {
    const r = Math.max(0, this.hp / this.maxHp);
    this.bar.setVisible(r < 1).setSize(14 * r, 2).setFillStyle(r > 0.5 ? 0x6ee06e : r > 0.25 ? 0xf2c94c : 0xeb5757);
  }

  demolish() {
    this.scene.spawnParticles(this.x, this.y, this.debris || 0x8a5a3a, 10);
    this.scene.events.emit('structureDestroyed', this);
    this.destroy();
  }

  destroy(fromScene) {
    this.bar?.destroy();
    super.destroy(fromScene);
  }
}

export class Barricade extends Structure {
  constructor(scene, x, y, hp) {
    super(scene, x, y, 'barricade', 80);
    this.kind = 'barricade';
    this.label = 'Barikat';
    if (hp != null) { this.hp = hp; this.updateBar(); }
  }
}

// Taret seviyeleri: 1 temel, 2 hasar+menzil, 3 atış hızı (+%40)
export const TURRET_LEVELS = [
  null,
  { dmg: 1, range: 110, fireRate: 0.7, maxHp: 50 },
  { dmg: 2, range: 130, fireRate: 0.7, maxHp: 70, cost: { coins: 60, stone: 6 } },
  { dmg: 2, range: 130, fireRate: 0.5, maxHp: 90, cost: { coins: 140, stone: 10 } }
];

export class Turret extends Structure {
  constructor(scene, x, y, hp) {
    super(scene, x, y, 'turret', 50);
    this.kind = 'turret';
    this.label = 'Taret';
    this.cooldown = 0;
    this.level = 1;
    this.applyLevel();
    if (hp != null) { this.hp = hp; this.updateBar(); }
  }

  applyLevel() {
    const L = TURRET_LEVELS[this.level] || TURRET_LEVELS[1];
    this.dmg = L.dmg;
    this.range = L.range;
    this.fireRate = L.fireRate;
    this.maxHp = L.maxHp;
  }

  // Seviye ata (yükseltmede canı da artar); seviye pipleri ve doku
  setLevel(lv, heal) {
    const before = this.maxHp;
    this.level = Phaser.Math.Clamp(lv | 0, 1, TURRET_LEVELS.length - 1);
    this.applyLevel();
    if (heal) this.hp += this.maxHp - before;
    this.hp = Math.min(this.hp, this.maxHp);
    const key = this.level > 1 ? `turret_lv${this.level}` : 'turret';
    if (this.scene.textures.exists(key)) this.setTexture(key);
    if (this.level > 1) {
      const pk = `def_pips${this.level}`;
      if (!this.pips) this.pips = this.scene.add.image(this.x, this.y + 9, pk).setDepth(this.depth + 1);
      else this.pips.setTexture(pk);
    }
    this.updateBar();
  }

  update(dt) {
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    let best = null, bestD = this.range;
    this.scene.zombies.getChildren().forEach((z) => {
      if (z.dead) return;
      const d = Phaser.Math.Distance.Between(this.x, this.y, z.x, z.y);
      if (d < bestD) { bestD = d; best = z; }
    });
    if (!best) return;
    this.cooldown = this.fireRate;
    const a = Phaser.Math.Angle.Between(this.x, this.y, best.x, best.y);
    this.setFlipX(Math.cos(a) < 0);
    this.scene.fireBullet(this.x, this.y - 2, a, this.dmg, 260);
    audio.sfx('turret');
  }

  destroy(fromScene) {
    this.pips?.destroy();
    super.destroy(fromScene);
  }
}

// ---------- Savunma yapıları (features/defense.js yönetir) ----------
// blocksPlayer / blocksZombie: defense.js çarpışma süzgeci bunlara bakar

export class StoneWall extends Structure {
  constructor(scene, x, y, hp) {
    super(scene, x, y, 'stone_wall', 300);
    Object.assign(this, { kind: 'stone_wall', label: 'Taş duvar', blocksPlayer: true, blocksZombie: true, debris: 0x8d8f99 });
    if (hp != null) { this.hp = Math.min(hp, this.maxHp); this.updateBar(); }
  }
}

// Kapı: oyuncu/NPC içinden geçer, zombi geçemez. Oyuncu yaklaşınca açılır.
export class Gate extends Structure {
  constructor(scene, x, y, hp) {
    super(scene, x, y, 'gate', 200);
    Object.assign(this, { kind: 'gate', label: 'Kapı', blocksPlayer: false, blocksZombie: true, debris: 0x8a5a3a, open: false });
    if (hp != null) { this.hp = Math.min(hp, this.maxHp); this.updateBar(); }
  }

  setOpen(v) {
    if (this.open === v) return;
    this.open = v;
    this.setTexture(v ? 'gate_open' : 'gate');
  }
}

// Dikenli tuzak: can = kalan kullanım. Zombiler hedef almaz, üstünden geçer.
export class SpikeTrap extends Structure {
  constructor(scene, x, y, hp) {
    super(scene, x, y, 'spike_trap', 40);
    Object.assign(this, { kind: 'spike_trap', label: 'Dikenli tuzak', blocksPlayer: false, blocksZombie: false, debris: 0x9aa3ad, tick: 0 });
    this.setDepth(y - 8);
    if (hp != null) { this.hp = Math.min(hp, this.maxHp); this.updateBar(); }
  }

  // Bir kullanım harca (aşınma)
  wear() {
    this.hp -= 1;
    this.updateBar();
    if (this.hp <= 0) this.demolish();
  }
}

export class LampPost extends Structure {
  constructor(scene, x, y, hp) {
    super(scene, x, y, 'lamp_post', 60);
    Object.assign(this, { kind: 'lamp_post', label: 'Işık direği', blocksPlayer: true, blocksZombie: true, debris: 0xffd166, lightR: 90 });
    this.body.setSize(6, 6).setOffset(5, 10);
    if (hp != null) { this.hp = Math.min(hp, this.maxHp); this.updateBar(); }
  }
}

// Alev tareti: 50px koni içinde 0.2 sn'de 1 hasar + yanma. Odunla çalışır.
export const FLAME = { range: 50, cone: 0.55, tick: 0.2, burn: 2, fuelPerWood: 20, maxFuel: 180, startFuel: 60 };

export class FlameTurret extends Structure {
  constructor(scene, x, y, hp, fuel) {
    super(scene, x, y, 'flame_turret', 90);
    Object.assign(this, { kind: 'flame_turret', label: 'Alev tareti', blocksPlayer: true, blocksZombie: true, debris: 0xf08a24 });
    this.fuel = fuel ?? FLAME.startFuel;
    this.cooldown = 0;
    this.firing = 0;
    this.fuelBar = scene.add.rectangle(x - 7, y + 9, 14, 2, 0xf08a24).setOrigin(0, 0.5).setDepth(10000);
    this.updateFuel();
    if (hp != null) { this.hp = Math.min(hp, this.maxHp); this.updateBar(); }
  }

  updateFuel() {
    const r = Phaser.Math.Clamp(this.fuel / FLAME.maxFuel, 0, 1);
    this.fuelBar.setSize(Math.max(1, 14 * r), 2).setFillStyle(this.fuel > 0 ? 0xf08a24 : 0x555555);
  }

  addFuel(sec) { this.fuel = Math.min(FLAME.maxFuel, this.fuel + sec); this.updateFuel(); }

  // ignite(z): defense.js yanma etkisini uygular
  update(dt, ignite) {
    this.cooldown -= dt;
    this.firing = Math.max(0, this.firing - dt);
    if (this.cooldown > 0) return;
    this.cooldown = FLAME.tick;
    if (this.fuel <= 0) return;
    const R2 = FLAME.range * FLAME.range;
    let best = null, bestD = R2;
    const zs = this.scene.zombies.getChildren();
    for (const z of zs) {
      if (z.dead) continue;
      const dx = z.x - this.x, dy = z.y - this.y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = z; }
    }
    if (!best) return;
    const a = Math.atan2(best.y - this.y, best.x - this.x);
    this.setFlipX(Math.cos(a) < 0);
    this.fuel = Math.max(0, this.fuel - FLAME.tick);
    this.firing = 0.3;
    this.updateFuel();
    // Koni içindeki tüm zombiler
    for (const z of zs.slice()) {
      if (z.dead) continue;
      const dx = z.x - this.x, dy = z.y - this.y;
      if (dx * dx + dy * dy > R2) continue;
      if (Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - a)) > FLAME.cone) continue;
      ignite(z);
      z.takeDamage(1, null);
    }
    // Alev parçacıkları (sınırlı)
    for (let i = 0; i < 3; i++) {
      const s = Phaser.Math.FloatBetween(-FLAME.cone, FLAME.cone) * 0.8, L = Phaser.Math.Between(20, FLAME.range);
      const p = this.scene.add.rectangle(this.x + Math.cos(a) * 6, this.y - 2 + Math.sin(a) * 6, 3, 3, i ? 0xf08a24 : 0xffd166).setDepth(9500);
      this.scene.tweens.add({ targets: p, x: this.x + Math.cos(a + s) * L, y: this.y - 2 + Math.sin(a + s) * L, alpha: 0, scale: 0.4, duration: 260, onComplete: () => p.destroy() });
    }
  }

  destroy(fromScene) {
    this.fuelBar?.destroy();
    super.destroy(fromScene);
  }
}

// Kasabanın kalbi: düşerse oyun biter. NPC'ler gece burada saklanır.
export class Shelter extends Phaser.Physics.Arcade.Image {
  constructor(scene, x, y) {
    super(scene, x, y, 'shelter');
    scene.add.existing(this);
    scene.physics.add.existing(this, true);
    this.body.setSize(60, 34).setOffset(2, 20);
    this.isShelter = true;
    this.maxHp = 600;
    this.hp = this.maxHp;
    this.radius = 30;
    this.setDepth(y + 26);
    this.door = { x, y: y + 34 };
  }

  // Gövde dikdörtgenine en yakın mesafe (köşelerden de saldırılabilsin)
  distanceFrom(x, y) {
    const b = this.body;
    const cx = Phaser.Math.Clamp(x, b.x, b.right), cy = Phaser.Math.Clamp(y, b.y, b.bottom);
    return Phaser.Math.Distance.Between(x, y, cx, cy);
  }

  takeDamage(n) {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - n);
    this.setTint(0xff9999);
    this.scene.time.delayedCall(80, () => this.clearTint());
    if (this.hp <= 0) this.scene.events.emit('shelterFallen');
  }

  repair(n) { this.hp = Math.min(this.maxHp, this.hp + n); }
}
