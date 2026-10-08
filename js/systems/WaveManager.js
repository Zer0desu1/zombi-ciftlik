import { TILE, MAP_W, MAP_H } from '../config.js';

// Gece zombi dalgalarını planlar ve harita kenarlarından doğurur.
export class WaveManager {
  constructor(scene) {
    this.scene = scene;
    this.wave = 0;          // tamamlanan + aktif dalga numarası
    this.active = false;
    this.toSpawn = 0;
    this.spawnTimer = 0;
    this.interval = 3;
    this.killedThisWave = 0;
  }

  get remaining() { return this.toSpawn + this.scene.zombies.countActive(true); }

  start() {
    this.wave++;
    this.active = true;
    this.killedThisWave = 0;
    this.toSpawn = 5 + this.wave * 3;
    this.interval = Math.max(0.8, 3.2 - this.wave * 0.25);
    this.spawnTimer = 1.5;
    this.scene.events.emit('waveStart', this.wave);
  }

  // Şafak: dalga biter, kalan zombiler güneşte yanar
  end() {
    if (!this.active) return;
    this.active = false;
    this.toSpawn = 0;
    this.scene.zombies.getChildren().slice().forEach((z) => z.burn());
    this.scene.events.emit('waveEnd', this.wave);
  }

  update(dt) {
    if (!this.active || this.toSpawn <= 0) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = this.interval * Phaser.Math.FloatBetween(0.6, 1.3);
    // Bazen küçük gruplar halinde gelsinler
    const group = Math.min(this.toSpawn, Phaser.Math.Between(1, 1 + Math.floor(this.wave / 2)));
    const p = this.edgePoint();
    for (let i = 0; i < group; i++) {
      const brute = this.wave >= 3 && Math.random() < Math.min(0.35, 0.08 * this.wave);
      this.scene.spawnZombie(p.x + Phaser.Math.Between(-20, 20), p.y + Phaser.Math.Between(-20, 20), brute ? 'brute' : 'normal');
      this.toSpawn--;
    }
  }

  edgePoint() {
    const W = MAP_W * TILE, H = MAP_H * TILE, m = 24;
    switch (Phaser.Math.Between(0, 3)) {
      case 0: return { x: Phaser.Math.Between(m, W - m), y: m };
      case 1: return { x: Phaser.Math.Between(m, W - m), y: H - m };
      case 2: return { x: m, y: Phaser.Math.Between(m, H - m) };
      default: return { x: W - m, y: Phaser.Math.Between(m, H - m) };
    }
  }

  serialize() { return { wave: this.wave }; }
  load(d) { if (d) this.wave = d.wave || 0; }
}
