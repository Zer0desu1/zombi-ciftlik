import { Actor } from './Actor.js';
import { PLAYER_STATS } from '../config.js';
import { audio } from '../audio.js';

export class Player extends Actor {
  constructor(scene, x, y) {
    super(scene, x, y, 'player', PLAYER_STATS.maxHp);
    this.showHpBar = false; // can HUD'da gösterilir
    this.maxEnergy = PLAYER_STATS.maxEnergy;
    this.energy = this.maxEnergy;
    this.coins = PLAYER_STATS.startCoins;
    this.alive = true;
    this.invuln = 0;
    this.actionCd = 0;
    this.facing = new Phaser.Math.Vector2(1, 0);
    this.setCollideWorldBounds(true);
  }

  update(dt, keys, blocked) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.actionCd = Math.max(0, this.actionCd - dt);
    if (!this.alive) return;
    if (blocked) { this.halt(); return; }
    let vx = 0, vy = 0;
    if (keys.left.isDown || keys.a.isDown) vx -= 1;
    if (keys.right.isDown || keys.d.isDown) vx += 1;
    if (keys.up.isDown || keys.w.isDown) vy -= 1;
    if (keys.down.isDown || keys.s.isDown) vy += 1;
    // Klavye yoksa dokunmatik joystick (analog, 0..1 büyüklük)
    let mag = 1;
    const vm = this.scene.virtualMove;
    if (!vx && !vy && vm && (vm.x || vm.y)) { vx = vm.x; vy = vm.y; mag = Math.max(0.35, Math.min(1, Math.hypot(vx, vy))); }
    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      const v = new Phaser.Math.Vector2(vx, vy).normalize();
      this.facing.copy(v);
      v.scale(mag);
      const speed = PLAYER_STATS.speed * (this.energy <= 0 ? 0.6 : 1);
      this.setVelocity(v.x * speed, v.y * speed);
      if (vx !== 0) this.setFlipX(vx < 0);
    } else {
      this.setVelocity(0, 0);
    }
    this.walk(moving);
  }

  useEnergy(n) {
    if (this.energy < n) {
      this.scene.hud.notice('Çok yorgunsun! Bir şeyler ye.');
      audio.sfx('error');
      return false;
    }
    this.energy = Math.max(0, this.energy - n);
    return true;
  }

  restore(hp = 0, energy = 0) {
    this.hp = Math.min(this.maxHp, this.hp + hp);
    this.energy = Math.min(this.maxEnergy, this.energy + energy);
  }

  addCoins(n) {
    this.coins += n;
    if (n > 0) audio.sfx('coin');
  }

  takeDamage(n, source) {
    if (!this.alive || this.invuln > 0) return;
    this.hp -= n;
    this.invuln = 0.5;
    this.flash(0xff4444);
    if (source) this.knockback(source.x, source.y, 140);
    this.scene.cameras.main.shake(100, 0.004);
    audio.sfx('hurt');
    if (this.hp <= 0) this.die();
  }

  die() {
    this.hp = 0;
    this.alive = false;
    this.halt();
    this.setVelocity(0, 0);
    this.setAngle(90);
    audio.sfx('die');
    this.scene.events.emit('playerDied');
  }

  respawn(x, y) {
    this.setPosition(x, y);
    this.setAngle(0);
    this.alive = true;
    this.hp = this.maxHp;
    this.energy = Math.max(this.energy, this.maxEnergy * 0.5);
    this.invuln = 2;
  }
}
