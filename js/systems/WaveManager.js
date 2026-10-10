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
    this.pending = [];
    this.bursts = 0;
    this.burstGap = 10;
    this.plan = null;       // aktif dalganın planı
    this.nextPlan = null;   // önizlemesi yapılmış bir sonraki dalga
    this.bloodMoon = false;
    this.bloodDecider = null; // (wave) => bool — zombies özelliği atar
  }

  get remaining() { return this.toSpawn + this.scene.zombies.countActive(true); }

  // Dalga kompozisyonu: { wave, blood, counts: {tür: adet}, sides: [kenar] }
  makePlan(w, blood = false) {
    // Sürü büyüklüğü dalgayla hızlanarak artar; zorluk seçimi çarpan uygular
    const diff = this.scene.difficulty?.count ?? 1;
    const total = Math.max(4, Math.round((6 + w * 4 + w * w * 0.35) * (blood ? 1.5 : 1) * diff));
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
    // Zombiler tek tek değil, aralıklı SÜRÜLER halinde gelir (gecenin ilk yarısında)
    this.bursts = Math.min(5, 2 + Math.floor(this.wave / 3));
    this.burstGap = 34 / this.bursts / (this.bloodMoon ? 1.3 : 1);
    this.spawnTimer = 3;
    this.pending = [];
    this.scene.events.emit('waveStart', this.wave);
  }

  // Şafak: dalga biter, kalan zombiler güneşte yanar
  end() {
    if (!this.active) return;
    this.active = false;
    this.toSpawn = 0;
    this.queue = [];
    this.pending = [];
    this.bloodMoon = false;
    this.scene.zombies.getChildren().slice().forEach((z) => z.burn());
    this.scene.events.emit('waveEnd', this.wave);
  }

  update(dt) {
    if (!this.active) return;
    // Bekleyen sürü üyelerini kısa aralıklarla aynı noktadan doğur
    if (this.pending.length) {
      for (const p of this.pending) p.t -= dt;
      while (this.pending.length && this.pending[0].t <= 0) {
        const p = this.pending.shift();
        this.spawnKind(p.kind, p.x, p.y);
      }
    }
    if (!this.queue.length) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const left = Math.max(1, this.bursts);
    const n = Math.ceil(this.queue.length / left);
    this.bursts = left - 1;
    this.spawnTimer = this.burstGap;
    const sides = this.plan?.sides?.length ? this.plan.sides : [0, 1, 2, 3];
    const side = Phaser.Utils.Array.GetRandom(sides);
    const pt = this.edgePoint(side);
    const at = this.pending.length ? this.pending[this.pending.length - 1].t : 0;
    // Sürü tek noktadan değil kenar boyunca yayılarak çıkar (kalabalık büyüdükçe cephe genişler)
    const along = side < 2, spread = Math.min(160, 40 + n * 6);
    for (let i = 0; i < n; i++) {
      const s = Phaser.Math.FloatBetween(-spread, spread), inward = Phaser.Math.Between(0, 18);
      const x = along ? pt.x + s : pt.x + (side === 2 ? inward : -inward);
      const y = along ? pt.y + (side === 0 ? inward : -inward) : pt.y + s;
      this.pending.push({ kind: this.queue.shift(), x, y, t: at + i * 0.2 });
    }
    this.scene.events.emit('hordeIncoming', { side, count: n, sideName: SIDE_NAMES[side], x: pt.x, y: pt.y });
  }

  spawnKind(kind, x, y) {
    const z = this.scene.spawnZombie(x, y, kind);
    this.toSpawn = Math.max(0, this.toSpawn - 1);
    if (kind === 'boss') this.scene.events.emit('bossSpawned', z);
    return z;
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
