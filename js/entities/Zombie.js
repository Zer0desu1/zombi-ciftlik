import { Actor } from './Actor.js';
import { audio } from '../audio.js';

// Zombi türleri. normal/brute eski kayıt ve modüllerle uyumlu kalır; diğerleri features/zombies.js dokularını kullanır.
const baseHp = (w) => 4 + Math.floor(w * 0.75);
const baseSpeed = (w) => Math.min(42, 26 + w * 1.5) * Phaser.Math.FloatBetween(0.85, 1.15);
export const ZOMBIE_TYPES = {
  normal:  { name: 'Zombi',          icon: '🧟', tex: 'zombie',          hp: baseHp,                                   speed: baseSpeed,                                  dmg: 8,  reward: 3,  cd: 1,   kb: 110, desc: 'Sıradan, yavaş ama kalabalık.' },
  brute:   { name: 'İri Zombi',      icon: '💪', tex: 'zombie_brute',    hp: (w) => 14 + w * 2,                       speed: () => 20,                                   dmg: 18, reward: 12, cd: 1.4, kb: 40,  scale: 1.35, desc: 'Yavaş, çok dayanıklı, sert vurur.' },
  runner:  { name: 'Koşucu',         icon: '💨', tex: 'zombie_runner',   hp: (w) => Math.max(1, Math.round(baseHp(w) * 0.5)), speed: (w) => Math.min(78, baseSpeed(w) * 1.8), dmg: 5,  reward: 4,  cd: 0.8, kb: 130, desc: 'Çok hızlı ama kırılgan.' },
  spitter: { name: 'Tükürükçü',      icon: '🤮', tex: 'zombie_spitter',  hp: (w) => Math.ceil(baseHp(w) * 0.9),       speed: (w) => baseSpeed(w) * 0.85,                 dmg: 4,  reward: 6,  cd: 1,   kb: 110, desc: '120px mesafeden asit tükürür, yerde gölcük bırakır.' },
  bloater: { name: 'Patlayan',       icon: '💥', tex: 'zombie_bloater',  hp: (w) => baseHp(w) + 2,                    speed: (w) => baseSpeed(w) * 0.75,                 dmg: 6,  reward: 5,  cd: 1,   kb: 70,  scale: 1.12, desc: 'Yaklaşınca patlar (yapılara çift hasar). Öldürülünce de patlar!' },
  armored: { name: 'Zırhlı',         icon: '🛡️', tex: 'zombie_armored',  hp: (w) => baseHp(w) + 2,                    speed: (w) => baseSpeed(w) * 0.9,                  dmg: 10, reward: 7,  cd: 1.1, kb: 60,  armor: 6, desc: 'İlk 6 hasarı zırhı emer.' },
  boss:    { name: 'Mezar Bekçisi',  icon: '👑', tex: 'zombie_boss',     hp: (w) => 120 + Math.max(0, w - 5) * 12,    speed: () => 17,                                   dmg: 25, reward: 20, cd: 1.6, kb: 0,   scale: 1.8, desc: 'Her 5. dalganın patronu. 3 sn\'de bir yeri sarsar.' }
};

const BLOAT_TRIGGER = 24, BLOAT_RADIUS = 40, BLOAT_DMG = 25;
const SPIT_RANGE = 120, SPIT_CD = 2, ACID_DMG = 5;
const SLAM_RADIUS = 60, SLAM_CD = 3, SLAM_DMG = 12;
// Isırık telegrafı (sn): canlılara saldırmadan önce kırmızı parlayıp geri çekilir — yuvarlanma/vurma fırsatı
const BITE_TIME = { normal: 0.32, runner: 0.22, brute: 0.5, spitter: 0.3, bloater: 0.3, armored: 0.34, boss: 0.45 };
const RAID_FROM = 3; // bu dalgadan itibaren bazı zombiler tarlaya/hayvanlara yönelir

// Prosedürel kısa sesler (audio.js'e dokunmadan)
function zsfx(name) {
  if (!audio.ctx || audio.muted) return;
  if (name === 'boom') { audio.noise({ dur: 0.45, vol: 0.5, freq: 500 }); audio.tone({ type: 'sawtooth', freq: 120, to: 30, dur: 0.4, vol: 0.3 }); }
  else if (name === 'spit') { audio.noise({ dur: 0.12, vol: 0.2, freq: 2200 }); audio.tone({ type: 'sine', freq: 420, to: 180, dur: 0.12, vol: 0.12 }); }
  else if (name === 'splat') audio.noise({ dur: 0.15, vol: 0.2, freq: 1200 });
  else if (name === 'slam') { audio.noise({ dur: 0.5, vol: 0.5, freq: 300 }); audio.tone({ type: 'square', freq: 70, to: 30, dur: 0.45, vol: 0.35 }); }
  else if (name === 'clank') audio.tone({ type: 'square', freq: 1600, to: 1100, dur: 0.05, vol: 0.15 });
  else if (name === 'fuse') audio.tone({ type: 'square', freq: 600, to: 1200, dur: 0.5, vol: 0.1 });
}

// Hedefe uzaklık (sığınak için gövde kenarına)
const distTo = (t, x, y) => (t.distanceFrom ? t.distanceFrom(x, y) : Phaser.Math.Distance.Between(x, y, t.x, t.y));

// Alan hasarı: oyuncu, NPC, yapılar (barikatlar dahil) ve isteğe bağlı diğer zombiler
export function areaDamage(scene, x, y, r, dmg, { structMul = 1, zombieDmg = 0, source = null } = {}) {
  const hit = new Set();
  // Savunma modülünün yapıları (duvar, kapı, tuzak, lamba) da patlamadan etkilenir
  const list = [...scene.zombieTargets(), ...scene.barricades.getChildren(), ...(scene.defStructs?.getChildren() || [])];
  for (const t of list) {
    if (!t || !t.active || t.hidden || hit.has(t)) continue;
    const pad = t.distanceFrom ? 0 : (t.radius || 6) * 0.5;
    if (distTo(t, x, y) - pad > r) continue;
    hit.add(t);
    const struct = t.isStructure || t.isShelter;
    t.takeDamage(Math.round(dmg * (struct ? structMul : 1)), source || { x, y });
  }
  if (zombieDmg > 0) {
    scene.zombies.getChildren().slice().forEach((z) => {
      if (z === source || z.dead) return;
      if (Phaser.Math.Distance.Between(x, y, z.x, z.y) <= r) z.takeDamage(zombieDmg, source || { x, y });
    });
  }
}

// Yerde büyüyen tehlike alanı: patlama/sarsıntı menzilini önceden gösterir
function warnCircle(scene, x, y, r, dur) {
  const c = scene.add.circle(x, y, r, 0xff3030, 0.14).setStrokeStyle(1, 0xff5a4a, 0.85).setDepth(3).setScale(0.3);
  scene.tweens.add({ targets: c, scale: 1, duration: dur * 1000, ease: 'Quad.easeOut' });
  scene.tweens.add({ targets: c, alpha: 0.5, duration: 120, yoyo: true, repeat: -1 });
  scene.time.delayedCall(dur * 1000 + 60, () => c.destroy());
}

// Kuşatmada çiğnenebilecek ekin: zombiler için hafif hedef nesnesi
function cropTarget(scene, plot) {
  const farm = scene.farm;
  return {
    x: plot.tx * 16 + 8, y: plot.ty * 16 + 8, radius: 4, isCrop: true,
    get active() { return farm.get(plot.tx, plot.ty) === plot && !!plot.crop && !plot.crop.dead; },
    takeDamage() {
      const c = plot.crop;
      if (!c || c.dead) return;
      // Her ısırık bir büyüme evresi geri alır; filizi yerse ekin ölür
      if (c.stage > 0) { c.stage--; c.growth = 0; } else c.dead = true;
      farm.refresh(plot);
      scene.spawnParticles(this.x, this.y, 0x6aa84f, 5);
      if (c.dead) scene.events.emit('cropTrampled', plot);
    }
  };
}

function ring(scene, x, y, r, color, dur = 350) {
  const c = scene.add.circle(x, y, r, color, 0).setStrokeStyle(2, color, 0.9).setDepth(9400).setScale(0.15);
  scene.tweens.add({ targets: c, scale: 1, alpha: 0, duration: dur, ease: 'Cubic.easeOut', onComplete: () => c.destroy() });
}

// ---------- Asit mermileri ve gölcükler (zombies özelliği her kare updateZombieFx çağırır) ----------
function fx(scene) { return scene.zfx || (scene.zfx = { acid: [], pools: [] }); }

export function spitAcid(scene, x, y, tx, ty) {
  const f = fx(scene);
  if (f.acid.length >= 20) return;
  const d = Math.max(1, Phaser.Math.Distance.Between(x, y, tx, ty));
  const img = scene.add.image(x, y - 4, 'z_acid').setDepth(9300);
  // İniş noktası işareti: asitten kaçmak için nereye düşeceğini göster
  const mark = scene.add.circle(tx, ty, 6, 0x8fe04a, 0.18).setStrokeStyle(1, 0xc8ff8a, 0.9).setDepth(3);
  f.acid.push({ img, mark, sx: x, sy: y - 4, tx, ty, t: 0, dur: d / 120 });
  zsfx('spit');
}

function acidImpact(scene, x, y) {
  zsfx('splat');
  scene.spawnParticles(x, y, 0x8fe04a, 6);
  areaDamage(scene, x, y, 10, ACID_DMG);
  const f = fx(scene);
  if (f.pools.length >= 12) { f.pools.shift().img.destroy(); }
  const img = scene.add.image(x, y + 2, 'z_acid_pool').setDepth(2).setAlpha(0.85);
  f.pools.push({ img, x, y: y + 2, life: 2, tick: 0 });
}

export function updateZombieFx(scene, dt) {
  const f = scene.zfx;
  if (!f) return;
  for (let i = f.acid.length - 1; i >= 0; i--) {
    const a = f.acid[i];
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    // Hafif kavisli uçuş
    a.img.setPosition(a.sx + (a.tx - a.sx) * k, a.sy + (a.ty - a.sy) * k - Math.sin(k * Math.PI) * 10).setRotation(a.t * 8);
    a.mark?.setScale(0.6 + 0.4 * k);
    if (k >= 1) { a.img.destroy(); a.mark?.destroy(); f.acid.splice(i, 1); acidImpact(scene, a.tx, a.ty); }
  }
  const p = scene.player;
  for (let i = f.pools.length - 1; i >= 0; i--) {
    const g = f.pools[i];
    g.life -= dt;
    g.tick -= dt;
    if (g.life < 0.5) g.img.setAlpha(Math.max(0, g.life / 0.5) * 0.85);
    if (g.tick <= 0 && p.alive && Math.abs(p.x - g.x) < 8 && Math.abs(p.y + 6 - g.y) < 6) { g.tick = 0.5; p.takeDamage(1); }
    if (g.life <= 0) { g.img.destroy(); f.pools.splice(i, 1); }
  }
}

export function clearZombieFx(scene) {
  const f = scene.zfx;
  if (!f) return;
  f.acid.forEach((a) => { a.img.destroy(); a.mark?.destroy(); });
  f.pools.forEach((g) => g.img.destroy());
  f.acid.length = 0; f.pools.length = 0;
}

// Zombi AI'ı: en yakın hedefi seç → yürü → saldır. Engelde takılırsa yana kayar.
export class Zombie extends Actor {
  constructor(scene, x, y, kind, wave) {
    const def = ZOMBIE_TYPES[kind] || ZOMBIE_TYPES.normal;
    const tex = scene.textures.exists(def.tex) ? def.tex : 'zombie';
    super(scene, x, y, tex, def.hp(wave));
    this.kind = ZOMBIE_TYPES[kind] ? kind : 'normal';
    this.def = def;
    this.speed = def.speed(wave);
    // Denge: ilk iki gece öğretici kadar yumuşak, 5. geceden sonra hasar her gece %6 artar
    const tier = wave <= 1 ? 0.6 : wave === 2 ? 0.75 : 1 + Math.max(0, wave - 4) * 0.06;
    this.damage = Math.max(1, Math.round(def.dmg * tier));
    this.biteTime = (BITE_TIME[this.kind] || 0.32) * (wave <= 2 ? 1.35 : 1);
    // Rol: yağmacı tarlaya/hayvanlara, iri zombiler sığınağa yüklenir
    this.role = this.kind === 'brute' ? 'sapper'
      : wave >= RAID_FROM && (this.kind === 'normal' || this.kind === 'runner') && Math.random() < 0.22 ? 'raider' : 'hunter';
    // Kenardan yelpaze gibi yayılarak yaklaşma
    this.flank = Phaser.Math.FloatBetween(-1, 1);
    this.reward = def.reward;
    this.armor = def.armor || 0;
    this.attackCd = 0;
    this.retarget = 0;
    this.target = null;
    this.blockedBy = null;
    this.stuckTime = 0;
    this.sidestep = 0;
    this.groanTimer = Phaser.Math.FloatBetween(2, 8);
    this.spitCd = Phaser.Math.FloatBetween(0.6, SPIT_CD);
    this.slamCd = SLAM_CD;
    this.windup = 0;     // tükürük / sarsıntı hazırlığı
    this.fuse = -1;      // patlayan: geri sayım
    if (def.scale) this.setScale(def.scale);
    if (this.kind === 'boss') this.isBoss = true;
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

    // Patlayan: fitil yanıyorsa sadece titre ve patla
    if (this.fuse >= 0) {
      this.setVelocity(0, 0);
      this.fuse -= dt;
      if (this.fuse < 0) { this.explode(); this.die(false); }
      return;
    }
    // Hazırlık animasyonu (tükürük / sarsıntı)
    if (this.windup > 0) {
      this.setVelocity(0, 0);
      this.windup -= dt;
      if (this.windup <= 0) this.release();
      return;
    }

    if (this.retarget <= 0 || !this.target || !this.target.active || this.target.hidden) {
      this.retarget = 0.5;
      this.target = this.pickTarget();
    }

    // Barikata çarptıysa önce onu yık
    if (this.blockedBy && this.blockedBy.active) {
      const b = this.blockedBy;
      if (Phaser.Math.Distance.Between(this.x, this.y, b.x, b.y) < 18 * (this.scaleX || 1)) { this.engage(b); return; }
      this.blockedBy = null;
    }

    const t = this.target;
    if (!t) { this.halt(); return; }
    const dist = distTo(t, this.x, this.y);
    const big = this.kind === 'brute' ? 3 : this.kind === 'boss' ? 6 : 0;
    const reach = t.distanceFrom ? 10 + big : 10 + (t.radius || 6) * 0.8 + big;

    if (this.kind === 'bloater' && dist <= Math.max(reach, t.distanceFrom ? BLOAT_TRIGGER - 10 : BLOAT_TRIGGER)) { this.startFuse(); return; }
    if (this.kind === 'boss') {
      this.slamCd -= dt;
      if (this.slamCd <= 0 && dist <= SLAM_RADIUS * 0.8) { this.slamCd = SLAM_CD; this.beginWindup('slam', 0.45); return; }
    }
    if (dist <= reach) { this.attack(t); return; }
    if (this.kind === 'spitter') {
      this.spitCd -= dt;
      if (dist <= SPIT_RANGE) {
        this.halt();
        if (Math.abs(t.x - this.x) > 1) this.setFlipX(t.x < this.x);
        if (this.spitCd <= 0) { this.spitCd = SPIT_CD; this.beginWindup('spit', 0.35); }
        return;
      }
    }

    // Takılma tespiti → bir süre yana kay
    if (this.body.blocked.none === false || this.body.touching.none === false) this.stuckTime += dt;
    else this.stuckTime = Math.max(0, this.stuckTime - dt);
    if (this.stuckTime > 0.4 && this.sidestep <= 0) { this.sidestep = 0.6; this.sideDir = Math.random() < 0.5 ? -1 : 1; }

    let a = Phaser.Math.Angle.Between(this.x, this.y, t.x, t.y);
    if (dist > 90) a += this.flank * 0.55 * Math.min(1, (dist - 90) / 220);
    if (this.sidestep > 0) { this.sidestep -= dt; a += this.sideDir * Math.PI / 2; }
    // speedMul: diğer modüllerin geçici yavaşlatma/hızlandırma çarpanı (ör. tuzak, ışık)
    const spd = this.speed * (this.speedMul ?? 1);
    this.setVelocity(Math.cos(a) * spd, Math.sin(a) * spd);
    if (Math.abs(this.body.velocity.x) > 2) this.setFlipX(this.body.velocity.x < 0);
    this.walk(true);
  }

  pickTarget() {
    const s = this.scene, role = this.role, p = s.player;
    let best = null, bestD = Infinity;
    for (const c of s.zombieTargets()) {
      if (!c || !c.active || c.hidden) continue;
      // Yapılar daha az çekici; sığınak normalde en son seçenek (iri zombiler hariç)
      let w = c.isShelter ? (role === 'sapper' ? 0.9 : 1.6) : c.isStructure ? 1.3 : 1;
      if (role === 'raider') w *= c === p ? 1.5 : c.ranch ? 0.6 : 1;
      const d = Phaser.Math.Distance.Between(this.x, this.y, c.x, c.y) * w;
      if (d < bestD) { bestD = d; best = c; }
    }
    // Yağmacı: oyuncu dibinde değilse en yakın ekini çiğnemeye gider
    if (role === 'raider' && s.farm?.plots && !(best === p && bestD < 90)) {
      if (this.cropGoal?.active) return this.cropGoal;
      let plot = null, pd = bestD * 0.8;
      for (const pl of s.farm.plots.values()) {
        if (!pl.crop || pl.crop.dead) continue;
        const d = Phaser.Math.Distance.Between(this.x, this.y, pl.tx * 16 + 8, pl.ty * 16 + 8);
        if (d < pd) { pd = d; plot = pl; }
      }
      if (plot) return (this.cropGoal = cropTarget(s, plot));
    }
    return best;
  }

  // Engelle karşılaşınca: patlayan fitili yakar, diğerleri vurur
  engage(t) {
    if (this.kind === 'bloater') this.startFuse();
    else this.attack(t);
  }

  attack(t) {
    this.setVelocity(0, 0);
    this.walk(false);
    if (Math.abs(t.x - this.x) > 1) this.setFlipX(t.x < this.x);
    if (this.attackCd > 0) return;
    // Canlılara (oyuncu, NPC, hayvan) önce telegraf; yapılara/ekinlere doğrudan
    if (!t.isStructure && !t.isShelter && !t.isCrop && !t.distanceFrom) {
      this.biteTarget = t;
      this.beginWindup('bite', this.biteTime);
      return;
    }
    this.strike(t);
  }

  strike(t) {
    this.attackCd = this.def.cd;
    this.scene.tweens.add({ targets: this, x: this.x + (t.x - this.x) * 0.15, y: this.y + (t.y - this.y) * 0.15, duration: 80, yoyo: true });
    t.takeDamage(this.damage, this);
  }

  beginWindup(action, time) {
    this.windupAction = action;
    this.windup = time;
    this.halt();
    this.setTint(action === 'spit' ? 0xb8ff7a : 0xff4a3a);
    const s = this.scene;
    if (action === 'slam') {
      s.tweens.add({ targets: this, scaleY: this.def.scale * 1.12, duration: time * 1000 * 0.8, yoyo: true });
      warnCircle(s, this.x, this.y + 6, SLAM_RADIUS, time);
    } else if (action === 'bite' && this.biteTarget === s.player) {
      // Oyuncuya yönelik ısırıkta başının üstünde "!" belirir
      const m = s.add.text(this.x, this.y - 10 * this.scaleY, '!', { fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: '#ff4a3a', stroke: '#000', strokeThickness: 2 })
        .setOrigin(0.5, 1).setDepth(10003).setResolution(2);
      s.tweens.add({ targets: m, y: m.y - 3, duration: time * 1000, onComplete: () => m.destroy() });
    }
  }

  release() {
    this.clearTint();
    const t = this.target;
    if (this.windupAction === 'bite') {
      const b = this.biteTarget;
      this.biteTarget = null;
      const big = this.kind === 'brute' ? 3 : this.kind === 'boss' ? 6 : 0;
      // Telegraf sırasında uzaklaştıysa ıskalar (yuvarlanma/geri çekilme işe yarar)
      if (b && b.active && !b.hidden && distTo(b, this.x, this.y) <= 16 + (b.radius || 6) * 0.8 + big) this.strike(b);
      else this.attackCd = this.def.cd * 0.5;
      return;
    }
    if (this.windupAction === 'spit') {
      if (!t || !t.active) return;
      // Sığınağa gövdenin en yakın noktasına nişan al
      let tx = t.x, ty = t.y;
      if (t.isShelter && t.body) { tx = Phaser.Math.Clamp(this.x, t.body.x, t.body.right); ty = Phaser.Math.Clamp(this.y, t.body.y, t.body.bottom); }
      spitAcid(this.scene, this.x, this.y, tx, ty);
    } else if (this.windupAction === 'slam') this.slam();
  }

  slam() {
    const s = this.scene;
    zsfx('slam');
    ring(s, this.x, this.y + 6, SLAM_RADIUS, 0xc9a26b, 450);
    s.spawnParticles(this.x, this.y + 8, 0x8a6a45, 16);
    if (Phaser.Math.Distance.Between(this.x, this.y, s.player.x, s.player.y) < 200) s.cameras.main.shake(250, 0.008);
    areaDamage(s, this.x, this.y, SLAM_RADIUS, SLAM_DMG, { structMul: 1.5, source: this });
  }

  startFuse() {
    if (this.fuse >= 0) return;
    this.fuse = 0.6;
    this.halt();
    warnCircle(this.scene, this.x, this.y, BLOAT_RADIUS, 0.6);
    zsfx('fuse');
    this.setTint(0xff5a3a);
    this.scene.tweens.add({ targets: this, x: this.x + 1, duration: 40, yoyo: true, repeat: 7 });
    this.scene.tweens.add({ targets: this, scaleX: this.scaleX * 1.2, scaleY: this.scaleY * 1.2, duration: 600 });
  }

  explode() {
    if (this.exploded) return;
    this.exploded = true;
    const s = this.scene;
    zsfx('boom');
    ring(s, this.x, this.y, BLOAT_RADIUS, 0x9bd35a, 380);
    s.spawnParticles(this.x, this.y, 0x9bd35a, 14);
    s.spawnParticles(this.x, this.y, 0xf08a24, 8);
    if (Phaser.Math.Distance.Between(this.x, this.y, s.player.x, s.player.y) < 180) s.cameras.main.shake(200, 0.006);
    areaDamage(s, this.x, this.y, BLOAT_RADIUS, BLOAT_DMG, { structMul: 2, zombieDmg: 6, source: this });
  }

  takeDamage(n, source) {
    if (this.dead) return;
    // Zırh önce hasarı emer
    if (this.armor > 0 && n > 0) {
      const soak = Math.min(this.armor, n);
      this.armor -= soak;
      n -= soak;
      this.scene.spawnParticles(this.x, this.y - 2, 0xc8ccd4, 3);
      zsfx('clank');
      if (this.armor <= 0) this.breakArmor();
      if (n <= 0) {
        this.flash(0xc8ccd4);
        if (source) this.knockback(source.x, source.y, this.def.kb * 0.4);
        return;
      }
    }
    this.hp -= n;
    // Isırık hazırlığında vurulan zombi sendeler (saldırı iptal)
    if (this.windup > 0 && this.windupAction === 'bite') { this.windup = 0; this.biteTarget = null; this.attackCd = Math.max(this.attackCd, 0.4); }
    this.flash();
    if (source && this.def.kb > 0 && this.fuse < 0) this.knockback(source.x, source.y, this.def.kb);
    this.scene.spawnParticles(this.x, this.y, 0x6b8f3a, 5);
    audio.sfx('hit');
    if (this.hp <= 0) this.die(true);
  }

  breakArmor() {
    this.texKey = 'zombie';
    this.setTexture('zombie', 0);
    this.scene.spawnParticles(this.x, this.y, 0x9aa0aa, 10);
    this.scene.floatText(this.x, this.y - 12, 'Zırh kırıldı!', '#c8ccd4');
  }

  die(rewarded) {
    if (this.dead) return;
    this.dead = true;
    if (this.kind === 'bloater') this.explode();
    if (this.isBoss) {
      this.scene.cameras.main.shake(400, 0.01);
      this.scene.spawnParticles(this.x, this.y, 0x6d8a7a, 24);
    }
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
