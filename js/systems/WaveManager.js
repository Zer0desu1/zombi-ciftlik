import { TILE, MAP_W, MAP_H } from '../config.js';

// Kenar adları: 0 kuzey, 1 güney, 2 batı, 3 doğu
export const SIDE_NAMES = ['kuzey', 'güney', 'batı', 'doğu'];
// Doğum sırasındaki tür sırası (önizleme metni de bu sırayı kullanır)
export const KIND_ORDER = ['normal', 'runner', 'brute', 'spitter', 'bloater', 'armored', 'boss'];

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
    this.queue = [];
    this.plan = null;       // aktif dalganın planı
    this.nextPlan = null;   // önizlemesi yapılmış bir sonraki dalga
    this.bloodMoon = false;
    this.bloodDecider = null; // (wave) => bool — zombies özelliği atar
  }

  get remaining() { return this.toSpawn + this.scene.zombies.countActive(true); }

  // Dalga kompozisyonu: { wave, blood, counts: {tür: adet}, sides: [kenar] }
  makePlan(w, blood = false) {
    const total = Math.round((5 + w * 3) * (blood ? 1.5 : 1));
    const share = {
      runner: w >= 2 ? 0.2 : 0,
      brute: w >= 3 ? Math.min(0.3, 0.06 * w) : 0,
      bloater: w >= 3 ? Math.min(0.12, 0.03 * (w - 1)) : 0,
      spitter: w >= 4 ? Math.min(0.15, 0.04 * (w - 3)) : 0,
      armored: w >= 6 ? Math.min(0.2, 0.04 * (w - 5)) : 0
    };
    const counts = {};
    let used = 0;
    for (const k of ['runner', 'brute', 'bloater', 'spitter', 'armored']) {
      const n = share[k] > 0 ? Math.min(total - used, Math.floor(total * share[k] + Math.random())) : 0;
      if (n > 0) { counts[k] = n; used += n; }
    }
    counts.normal = Math.max(0, total - used);
    if (w % 5 === 0) counts.boss = 1;
    const nSides = Math.min(4, 1 + (w >= 3) + (w >= 6) + (w >= 10));
    const sides = Phaser.Utils.Array.Shuffle([0, 1, 2, 3]).slice(0, nSides).sort();
    return { wave: w, blood: !!blood, counts, sides };
  }

  // Bir sonraki dalgayı önceden planla (önizleme için)
  planNext(blood) {
    this.nextPlan = this.makePlan(this.wave + 1, blood);
    return this.nextPlan;
  }

  validPlan(p, w) {
    return p && p.wave === w && p.counts && typeof p.counts === 'object' && Array.isArray(p.sides) && p.sides.length > 0;
  }

  start() {
    this.wave++;
    this.active = true;
    this.killedThisWave = 0;
    const blood = this.bloodDecider ? !!this.bloodDecider(this.wave) : false;
    this.plan = this.validPlan(this.nextPlan, this.wave) ? this.nextPlan : this.makePlan(this.wave, blood);
    this.nextPlan = null;
    this.bloodMoon = !!this.plan.blood;
    // Doğum kuyruğu: karışık sıra, boss ortalarda
    const q = [];
    for (const k of KIND_ORDER) if (k !== 'boss') for (let i = 0; i < (this.plan.counts[k] || 0); i++) q.push(k);
    Phaser.Utils.Array.Shuffle(q);
    if (this.plan.counts.boss) q.splice(Math.floor(q.length / 2), 0, 'boss');
    this.queue = q;
    this.toSpawn = q.length;
    this.interval = Math.max(0.8, 3.2 - this.wave * 0.25) / (this.bloodMoon ? 1.3 : 1);
    this.spawnTimer = 1.5;
    this.scene.events.emit('waveStart', this.wave);
  }

  // Şafak: dalga biter, kalan zombiler güneşte yanar
  end() {
    if (!this.active) return;
    this.active = false;
    this.toSpawn = 0;
    this.queue = [];
    this.bloodMoon = false;
    this.scene.zombies.getChildren().slice().forEach((z) => z.burn());
    this.scene.events.emit('waveEnd', this.wave);
  }

  update(dt) {
    if (!this.active || this.toSpawn <= 0) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = this.interval * Phaser.Math.FloatBetween(0.6, 1.3);
    const sides = this.plan?.sides?.length ? this.plan.sides : [0, 1, 2, 3];
    const p = this.edgePoint(Phaser.Utils.Array.GetRandom(sides));
    // Boss tek başına gelir
    if (this.queue[0] === 'boss') { this.spawnNext(p.x, p.y); return; }
    // Bazen küçük gruplar halinde gelsinler
    const group = Math.min(this.toSpawn, Phaser.Math.Between(1, 1 + Math.floor(this.wave / 2)));
    for (let i = 0; i < group && this.queue[0] !== 'boss'; i++) {
      this.spawnNext(p.x + Phaser.Math.Between(-20, 20), p.y + Phaser.Math.Between(-20, 20));
    }
  }

  spawnNext(x, y) {
    // Kuyruk yoksa (eski davranış) rastgele normal/brute
    let kind = this.queue.shift();
    if (!kind) kind = this.wave >= 3 && Math.random() < Math.min(0.35, 0.08 * this.wave) ? 'brute' : 'normal';
    const z = this.scene.spawnZombie(x, y, kind);
    this.toSpawn = Math.max(0, this.toSpawn - 1);
    if (kind === 'boss') this.scene.events.emit('bossSpawned', z);
    return z;
  }

  edgePoint(side = Phaser.Math.Between(0, 3)) {
    const W = MAP_W * TILE, H = MAP_H * TILE, m = 24;
    switch (side) {
      case 0: return { x: Phaser.Math.Between(m, W - m), y: m };
      case 1: return { x: Phaser.Math.Between(m, W - m), y: H - m };
      case 2: return { x: m, y: Phaser.Math.Between(m, H - m) };
      default: return { x: W - m, y: Phaser.Math.Between(m, H - m) };
    }
  }

  serialize() { return { wave: this.wave }; }
  load(d) { if (d) this.wave = d.wave || 0; }
}
