import { Actor } from './Actor.js';
import { audio } from '../audio.js';

// Zombi AI'ı: en yakın hedefi seç → yürü → saldır. Engelde takılırsa yana kayar.
export class Zombie extends Actor {
  constructor(scene, x, y, kind, wave) {
    const brute = kind === 'brute';
    super(scene, x, y, brute ? 'zombie_brute' : 'zombie', brute ? 14 + wave * 2 : 3 + Math.floor(wave / 2));
    this.kind = kind;
    this.speed = brute ? 20 : Math.min(42, 26 + wave * 1.5) * Phaser.Math.FloatBetween(0.85, 1.15);
    this.damage = brute ? 18 : 8;
    this.reward = brute ? 12 : 3;
    this.attackCd = 0;
    this.retarget = 0;
    this.target = null;
    this.blockedBy = null;
    this.stuckTime = 0;
    this.sidestep = 0;
    this.groanTimer = Phaser.Math.FloatBetween(2, 8);
    if (brute) this.setScale(1.35);
    this.dead = false;
  }

  update(dt) {
    if (this.dead) return;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.retarget -= dt;
    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      this.groanTimer = Phaser.Math.FloatBetween(4, 10);
      const p = this.scene.player;
      if (Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y) < 150) audio.sfx('groan');
    }
    if (this.retarget <= 0 || !this.target || !this.target.active || this.target.hidden) {
      this.retarget = 0.5;
      this.target = this.pickTarget();
    }

    // Barikata çarptıysa önce onu yık
    if (this.blockedBy && this.blockedBy.active) {
      const b = this.blockedBy;
      if (Phaser.Math.Distance.Between(this.x, this.y, b.x, b.y) < 18) { this.attack(b); return; }
      this.blockedBy = null;
    }

    const t = this.target;
    if (!t) { this.halt(); return; }
    const dist = t.distanceFrom ? t.distanceFrom(this.x, this.y) : Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y);
    const reach = t.distanceFrom ? 10 : 10 + (t.radius || 6) * 0.8 + (this.kind === 'brute' ? 3 : 0);
    if (dist <= reach) { this.attack(t); return; }

    // Takılma tespiti → bir süre yana kay
    if (this.body.blocked.none === false || this.body.touching.none === false) this.stuckTime += dt;
    else this.stuckTime = Math.max(0, this.stuckTime - dt);
    if (this.stuckTime > 0.4 && this.sidestep <= 0) { this.sidestep = 0.6; this.sideDir = Math.random() < 0.5 ? -1 : 1; }

    let a = Phaser.Math.Angle.Between(this.x, this.y, t.x, t.y);
    if (this.sidestep > 0) { this.sidestep -= dt; a += this.sideDir * Math.PI / 2; }
    this.setVelocity(Math.cos(a) * this.speed, Math.sin(a) * this.speed);
    if (Math.abs(this.body.velocity.x) > 2) this.setFlipX(this.body.velocity.x < 0);
    this.walk(true);
  }

  pickTarget() {
    let best = null, bestD = Infinity;
    for (const c of this.scene.zombieTargets()) {
      if (!c || !c.active || c.hidden) continue;
      // Yapılar daha az çekici; sığınak her zaman en son seçenek
      const w = c.isShelter ? 1.6 : c.isStructure ? 1.3 : 1;
      const d = Phaser.Math.Distance.Between(this.x, this.y, c.x, c.y) * w;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  attack(t) {
    this.setVelocity(0, 0);
    this.walk(false);
    if (Math.abs(t.x - this.x) > 1) this.setFlipX(t.x < this.x);
    if (this.attackCd > 0) return;
    this.attackCd = this.kind === 'brute' ? 1.4 : 1;
    this.scene.tweens.add({ targets: this, x: this.x + (t.x - this.x) * 0.15, y: this.y + (t.y - this.y) * 0.15, duration: 80, yoyo: true });
    t.takeDamage(this.damage, this);
  }

  takeDamage(n, source) {
    if (this.dead) return;
    this.hp -= n;
    this.flash();
    if (source) this.knockback(source.x, source.y, this.kind === 'brute' ? 40 : 110);
    this.scene.spawnParticles(this.x, this.y, 0x6b8f3a, 5);
    audio.sfx('hit');
    if (this.hp <= 0) this.die(true);
  }

  die(rewarded) {
    if (this.dead) return;
    this.dead = true;
    audio.sfx('zdie');
    this.scene.spawnParticles(this.x, this.y, rewarded ? 0x7fb069 : 0xf08a24, 12);
    if (rewarded) this.scene.events.emit('zombieKilled', this);
    this.destroy();
  }

  // Şafakta güneşte yanma
  burn() {
    if (this.dead) return;
    this.dead = true;
    this.setVelocity(0, 0);
    this.setTint(0xff8844);
    this.scene.tweens.add({ targets: this, alpha: 0, duration: 700, onComplete: () => this.destroy() });
    this.scene.spawnParticles(this.x, this.y, 0xf08a24, 10);
  }
}
