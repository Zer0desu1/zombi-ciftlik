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
    this.scene.spawnParticles(this.x, this.y, 0x8a5a3a, 10);
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
    if (hp != null) { this.hp = hp; this.updateBar(); }
  }
}

export class Turret extends Structure {
  constructor(scene, x, y, hp) {
    super(scene, x, y, 'turret', 50);
    this.kind = 'turret';
    this.range = 110;
    this.cooldown = 0;
    this.fireRate = 0.7;
    if (hp != null) { this.hp = hp; this.updateBar(); }
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
    this.scene.fireBullet(this.x, this.y - 2, a, 1, 260);
    audio.sfx('turret');
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
