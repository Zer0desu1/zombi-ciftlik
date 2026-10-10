import { Actor } from './Actor.js';
import { StateMachine } from '../systems/StateMachine.js';
import { TILE, FARM_ZONE } from '../config.js';
import { audio } from '../audio.js';

const BEDTIME = 19 * 60 + 30;
const WAKE = 6 * 60 + 30;

// Ok mermisi: scene.bullets grubuna eklenir, böylece çekirdekteki mermi-zombi çarpışması hasarı uygular
export function fireArrow(scene, x, y, angle, dmg, range = 160, speed = 260) {
  const key = scene.textures.exists('town_arrow') ? 'town_arrow' : 'bullet';
  const b = scene.physics.add.image(x, y, key).setDepth(y + 20);
  b.body.setSize(4, 4);
  b.dmg = dmg;
  b.isArrow = true;
  b.setRotation(angle);
  b.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  scene.bullets.add(b);
  scene.time.delayedCall((range / speed) * 1000 + 80, () => { if (b.active) b.destroy(); });
  return b;
}

// Otonom NPC tabanı. Her alt sınıf kendi durum makinesini kurar.
export class NPC extends Actor {
  constructor(scene, x, y, cfg) {
    super(scene, x, y, cfg.texture, cfg.hp || 30);
    this.key = cfg.key;
    this.npcName = cfg.name;
    this.role = cfg.role;
    this.speed = cfg.speed || 38;
    this.lines = cfg.lines;
    this.shop = cfg.shop || null;
    this.hidden = false;
    this.wait = 0;
    this.goal = null;
    this.body.setImmovable(true);
    this.label = scene.add.text(x, y, this.npcName, {
      fontFamily: 'Outfit, sans-serif', fontSize: '6px', color: '#ffffff', stroke: '#000000', strokeThickness: 2, resolution: 4
    }).setOrigin(0.5, 1);
    this.bubble = scene.add.text(x, y, '', { fontSize: '7px', resolution: 4 }).setOrigin(0.5, 1);
  }

  get timeSys() { return this.scene.timeSys; }
  get shelter() { return this.scene.shelter; }
  get isBedtime() { const m = this.timeSys.minutes; return m >= BEDTIME || m < WAKE; }

  setActivity(icon) { if (this.bubble.text !== icon) this.bubble.setText(icon); }

  preUpdate(t, d) {
    super.preUpdate(t, d);
    const top = this.y - 9 * this.scaleY;
    this.label.setPosition(this.x, top).setDepth(10002).setVisible(this.visible);
    this.bubble.setPosition(this.x, top - 7).setDepth(10002).setVisible(this.visible);
  }

  update(dt) {
    if (this.hidden) this.hp = Math.min(this.maxHp, this.hp + dt * 4); // sığınakta iyileşir
    this.sm.update(dt);
  }

  // Hedefe yürü; varınca true
  goTo(x, y) {
    const d = this.moveToward(x, y, this.speed);
    if (d < 4) { this.halt(); return true; }
    return false;
  }

  nearestZombie(maxDist, fromX = this.x, fromY = this.y) {
    let best = null, bestD = maxDist;
    this.scene.zombies.getChildren().forEach((z) => {
      if (z.dead) return;
      const dd = Phaser.Math.Distance.Between(fromX, fromY, z.x, z.y);
      if (dd < bestD) { bestD = dd; best = z; }
    });
    return best;
  }

  hide() {
    this.hidden = true;
    this.halt();
    this.setVisible(false);
    this.body.enable = false;
  }

  emerge() {
    const door = this.shelter.door;
    this.setPosition(door.x + Phaser.Math.Between(-8, 8), door.y + 4);
    this.hidden = false;
    this.setVisible(true);
    this.body.enable = true;
  }

  takeDamage(n, source) {
    if (this.hidden) return;
    this.hp -= n;
    this.flash(0xff4444);
    if (source) this.knockback(source.x, source.y, 100);
    audio.sfx('hurt');
    if (this.hp <= 0) {
      this.hp = 1;
      this.scene.hud.toast(`${this.npcName} yaralandı ve sığınağa taşındı!`, 'warn');
      this.hide();
      this.sm.set('sheltered');
    }
  }

  talkLine() {
    const pool = this.timeSys.isNight ? this.lines.night : this.lines.day;
    return Phaser.Utils.Array.GetRandom(pool);
  }

  // Ortak durumlar: sığınağa git + saklan
  commonStates() {
    return {
      goShelter: {
        enter: (n) => n.setActivity('🏠'),
        update: (n) => { if (n.goTo(n.shelter.door.x, n.shelter.door.y)) n.sm.set('sheltered'); }
      },
      sheltered: {
        enter: (n) => { n.hide(); n.setActivity('💤'); },
        update: (n) => {
          // Sabah olunca ve tamamen iyileşince dışarı çık
          if (!n.isBedtime && !n.timeSys.isNight && n.hp >= n.maxHp * 0.6 && !n.nearestZombie(120, n.shelter.door.x, n.shelter.door.y)) {
            n.emerge();
            n.sm.set(n.workState);
          }
        }
      },
      flee: {
        enter: (n) => { n.setActivity('😱'); n.speed *= 1.6; },
        exit: (n) => { n.speed /= 1.6; },
        update: (n) => { if (n.goTo(n.shelter.door.x, n.shelter.door.y)) n.sm.set('sheltered'); }
      }
    };
  }

  // Sivil NPC'ler için: yakında zombi varsa veya yatma saati geldiyse sığınağa
  civilianChecks() {
    if (this.hidden) return true;
    if (this.nearestZombie(70)) { this.sm.set('flee'); return true; }
    if (this.isBedtime) { this.sm.set('goShelter'); return true; }
    return false;
  }

  destroy(fromScene) {
    this.label?.destroy();
    this.bubble?.destroy();
    super.destroy(fromScene);
  }
}

// Sulama davranışı (Çiftçi ve işe alınan Sulayıcı ortak kullanır). n.zone tarla dikdörtgeni olmalı.
function waterStates() {
  return {
    tend: {
      enter: (n) => { n.setActivity('🌾'); n.wait = 0; n.goal = null; },
      update: (n, dt) => {
        if (n.civilianChecks()) return;
        const dry = n.scene.farm.unwatered();
        if (dry.length) { n.sm.set('goWater', Phaser.Utils.Array.GetRandom(dry)); return; }
        if (n.wait > 0) { n.wait -= dt; return; }
        if (!n.goal) n.goal = n.zone.getRandomPoint();
        if (n.goTo(n.goal.x, n.goal.y)) { n.goal = null; n.wait = Phaser.Math.FloatBetween(1.5, 4); }
      }
    },
    goWater: {
      enter: (n, plot) => { n.plot = plot; n.setActivity('💧'); },
      update: (n) => {
        if (n.civilianChecks()) return;
        const p = n.plot;
        if (!p || p.watered || !p.crop || n.sm.timeInState > 15) { n.sm.set('tend'); return; }
        if (n.goTo(p.tx * TILE + 8, p.ty * TILE + 4)) n.sm.set('watering');
      }
    },
    watering: {
      update: (n) => {
        if (n.sm.timeInState > 1) {
          const p = n.plot;
          if (p && n.scene.farm.water(p.tx, p.ty)) n.scene.spawnParticles(p.tx * TILE + 8, p.ty * TILE + 10, 0x7ab0e6, 6);
          n.sm.set('tend');
        }
      }
    }
  };
}

const farmRect = () => new Phaser.Geom.Rectangle(FARM_ZONE.x * TILE, FARM_ZONE.y * TILE, FARM_ZONE.w * TILE, FARM_ZONE.h * TILE);

// ---------------- Çiftçi: ekinleri sular, tarlada dolaşır ----------------
export class Farmer extends NPC {
  constructor(scene, x, y) {
    super(scene, x, y, {
      key: 'farmer', name: 'Ayşe', role: 'Çiftçi', texture: 'npc_farmer', speed: 34,
      lines: {
        day: ['Sulanmayan ekin büyümez, unutma!', 'Buğday en hızlı büyür. Balkabağı sabır ister ama çok para eder.', 'Çapa ile çimi sür, tohumu ek, sonra sula.', 'Senin tarlanı da suluyorum, merak etme.'],
        night: ['Burada ne arıyorsun? İçeri gir!', 'Zombilerin iniltisini duyuyor musun?']
      }
    });
    this.workState = 'tend';
    this.zone = farmRect();
    this.sm = new StateMachine(this, { ...this.commonStates(), ...waterStates() }, 'tend');
  }
}

// ---------------- Tüccar: tezgâhta bekler, meydanda dolaşır ----------------
export class Merchant extends NPC {
  constructor(scene, x, y) {
    super(scene, x, y, {
      key: 'merchant', name: 'Kemal', role: 'Tüccar', texture: 'npc_merchant', shop: 'merchant',
      lines: {
        day: ['Taze tohumlar, uygun fiyatlar!', 'Ürününü bana sat, adil fiyat veririm.', 'Balkabağı bulursan bana getir, iyi para var.'],
        night: ['Dükkân kapalı! Hayatta kalmaya bak.']
      }
    });
    this.workState = 'tradeStand';
    this.stall = { x, y };
    this.sm = new StateMachine(this, {
      ...this.commonStates(),
      tradeStand: {
        enter: (n) => { n.setActivity('💰'); n.wait = Phaser.Math.FloatBetween(6, 12); },
        update: (n, dt) => {
          if (n.civilianChecks()) return;
          if (n.goTo(n.stall.x, n.stall.y)) n.setFlipX(n.scene.player.x < n.x);
          n.wait -= dt;
          if (n.wait <= 0) n.sm.set('stroll');
        }
      },
      stroll: {
        enter: (n) => { n.setActivity('🚶'); n.goal = { x: n.stall.x + Phaser.Math.Between(-60, -10), y: n.stall.y + Phaser.Math.Between(10, 70) }; },
        update: (n) => {
          if (n.civilianChecks()) return;
          if (n.goTo(n.goal.x, n.goal.y) || n.sm.timeInState > 6) n.sm.set('tradeStand');
        }
      }
    }, 'tradeStand');
  }
}

// ---------------- Demirci: gündüz örs başında, gece barikat tamir eder ----------------
export class Blacksmith extends NPC {
  constructor(scene, x, y) {
    super(scene, x, y, {
      key: 'blacksmith', name: 'Zeynep', role: 'Demirci', texture: 'npc_blacksmith', shop: 'blacksmith', hp: 40,
      lines: {
        day: ['Barikatları gece ben onarırım, sen yeter ki dik.', 'Taretler için taş ve odun lazım.', 'Tabanca mı? Mermi olmadan süs eşyası.'],
        night: ['Çekiçle zombi de dövülür ama tavsiye etmem!', 'Hasarlı barikat görürsem onarırım.']
      }
    });
    this.workState = 'forge';
    this.anvil = { x, y };
    this.hammer = 0;
    this.sm = new StateMachine(this, {
      ...this.commonStates(),
      forge: {
        enter: (n) => n.setActivity('🔨'),
        update: (n, dt) => {
          if (n.hidden) return;
          if (n.nearestZombie(70)) { n.sm.set('flee'); return; }
          if (n.timeSys.isNight || n.isBedtime) { n.sm.set('findRepair'); return; }
          if (n.shelter.hp < n.shelter.maxHp) { n.sm.set('fixShelter'); return; }
          if (!n.goTo(n.anvil.x, n.anvil.y)) return;
          n.hammer -= dt;
          if (n.hammer <= 0) {
            n.hammer = 0.8;
            n.scene.spawnParticles(n.x + (n.flipX ? -6 : 6), n.y - 2, 0xffd166, 3);
          }
        }
      },
      fixShelter: {
        enter: (n) => n.setActivity('🛠'),
        update: (n, dt) => {
          if (n.civilianChecks()) return;
          if (n.shelter.hp >= n.shelter.maxHp) { n.sm.set('forge'); return; }
          if (n.goTo(n.shelter.door.x + 20, n.shelter.door.y)) n.shelter.repair(dt * 15);
        }
      },
      // Gece: güvenli bir tamir işi ara, yoksa sığınağa gir
      findRepair: {
        enter: (n) => n.setActivity('🔍'),
        update: (n) => {
          if (!n.timeSys.isNight && !n.isBedtime) { n.sm.set('forge'); return; }
          const job = n.scene.barricades.getChildren().find((b) => b.hp < b.maxHp && !n.nearestZombie(90, b.x, b.y));
          if (job) n.sm.set('repair', job);
          else n.sm.set('goShelter');
        }
      },
      repair: {
        enter: (n, b) => { n.job = b; n.setActivity('🛠'); },
        update: (n, dt) => {
          const b = n.job;
          if (!b || !b.active || b.hp >= b.maxHp) { n.sm.set('findRepair'); return; }
          if (n.nearestZombie(60)) { n.sm.set('flee'); return; }
          if (n.goTo(b.x, b.y + 12)) {
            b.repair(dt * 12);
            n.hammer -= dt;
            if (n.hammer <= 0) { n.hammer = 0.5; n.scene.spawnParticles(b.x, b.y, 0xffd166, 3); }
          }
        }
      }
    }, 'forge');
    // Saklanırken de geceleri tamir işi kontrol et
    const sheltered = this.sm.states.sheltered;
    const baseUpdate = sheltered.update;
    this.recheck = 3;
    sheltered.update = (n, dt) => {
      baseUpdate(n, dt);
      if (!n.hidden) return;
      n.recheck -= dt;
      if (n.recheck <= 0 && n.timeSys.isNight && n.hp > n.maxHp * 0.6) {
        n.recheck = 3;
        const job = n.scene.barricades.getChildren().find((b) => b.hp < b.maxHp * 0.7 && !n.nearestZombie(110, b.x, b.y));
        if (job && !n.nearestZombie(100, n.shelter.door.x, n.shelter.door.y)) { n.emerge(); n.sm.set('repair', job); }
      }
    };
  }
}

// ---------------- Muhafız: gündüz devriye, gece savunma ----------------
export class Guard extends NPC {
  constructor(scene, x, y) {
    super(scene, x, y, {
      key: 'guard', name: 'Demir', role: 'Muhafız', texture: 'npc_guard', hp: 90, speed: 44,
      lines: {
        day: ['Gece olunca ben de nöbetteyim. Taretleri sığınağın çevresine kur.', 'Dalgalar her gece büyüyor.', 'İri mor olanlardan uzak dur, sert vururlar.'],
        night: ['Arkamı kolla!', 'Sığınağı korumalıyız, düşerse her şey biter!']
      }
    });
    this.workState = 'patrol';
    this.shootCd = 0;
    const s = scene.shelter;
    this.route = [
      { x: s.x - 70, y: s.y - 50 }, { x: s.x + 70, y: s.y - 50 },
      { x: s.x + 70, y: s.y + 70 }, { x: s.x - 70, y: s.y + 70 }
    ];
    this.wp = 0;
    this.sm = new StateMachine(this, {
      ...this.commonStates(),
      patrol: {
        enter: (n) => n.setActivity('🛡'),
        update: (n, dt) => {
          if (n.hidden) return;
          const z = n.nearestZombie(n.timeSys.isNight ? 220 : 150);
          if (z) { n.sm.set('combat', z); return; }
          if (n.wait > 0) { n.wait -= dt; n.halt(); return; }
          const p = n.route[n.wp];
          if (n.goTo(p.x, p.y)) { n.wp = (n.wp + 1) % n.route.length; n.wait = n.timeSys.isNight ? 0.3 : 1.5; }
        }
      },
      combat: {
        enter: (n, z) => { n.foe = z; n.setActivity('⚔'); },
        update: (n, dt) => {
          n.shootCd -= dt;
          if (n.hp < n.maxHp * 0.35) { n.sm.set('retreat'); return; }
          if (!n.foe || n.foe.dead || !n.foe.active) {
            n.foe = n.nearestZombie(220);
            if (!n.foe) { n.sm.set('patrol'); return; }
          }
          const z = n.foe;
          const d = Phaser.Math.Distance.Between(n.x, n.y, z.x, z.y);
          // Mesafeyi koru: yakınsa geri çekil, uzaksa yaklaş
          if (d > 90) n.moveToward(z.x, z.y, n.speed);
          else if (d < 40) n.moveToward(n.x - (z.x - n.x), n.y - (z.y - n.y), n.speed * 0.8);
          else { n.halt(); n.setFlipX(z.x < n.x); }
          if (d < 120 && n.shootCd <= 0) {
            n.shootCd = 1.1;
            n.scene.fireBullet(n.x, n.y - 2, Phaser.Math.Angle.Between(n.x, n.y, z.x, z.y), 1, 240);
            audio.sfx('turret');
          }
        }
      },
      retreat: {
        enter: (n) => { n.setActivity('🩹'); n.scene.hud.toast('Demir geri çekiliyor, yaralı!', 'warn'); },
        update: (n) => { if (n.goTo(n.shelter.door.x, n.shelter.door.y)) n.sm.set('heal'); }
      },
      heal: {
        enter: (n) => { n.hide(); n.setActivity('🩹'); },
        update: (n) => {
          if (n.hp >= n.maxHp * 0.9 && !n.nearestZombie(40, n.shelter.door.x, n.shelter.door.y)) { n.emerge(); n.sm.set('patrol'); }
        }
      }
    }, 'patrol');
  }

  // Muhafız yaralanınca bayılmaz, geri çekilir
  takeDamage(n, source) {
    if (this.hidden) return;
    this.hp -= n;
    this.flash(0xff4444);
    if (source) this.knockback(source.x, source.y, 80);
    audio.sfx('hurt');
    if (this.hp <= this.maxHp * 0.35 && this.sm.name !== 'retreat' && this.sm.name !== 'heal') this.sm.set('retreat');
    if (this.hp <= 0) { this.hp = 1; this.hide(); this.sm.set('heal'); }
  }
}

// ---------------- Doktor: gündüz klinik + yaralı tedavisi, gece sığınakta hasta bakar ----------------
export class Doctor extends NPC {
  constructor(scene, x, y) {
    super(scene, x, y, {
      key: 'doctor', name: 'Selin', role: 'Doktor', texture: 'npc_doctor', shop: 'doctor', speed: 36,
      lines: {
        day: ['Yaralanırsan sargı kullan, kanaman durur.', 'Yorgun düşersen sana bakarım, ama ücretsiz değil!', 'Gece sığınakta yaralılarla ilgileniyorum.', 'Havuç göze iyi gelir derler. Bilimsel değil ama yine de ye.'],
        night: ['İçeride yaralılar var, acele et!', 'Isırıldın mı? Hemen göster!']
      }
    });
    this.workState = 'clinic';
    this.clinic = { x, y };
    this.healTick = 3;
    this.treatedTonight = 0;
    this.sm = new StateMachine(this, {
      ...this.commonStates(),
      clinic: {
        enter: (n) => { n.setActivity('⚕'); n.scanCd = 1; },
        update: (n, dt) => {
          if (n.civilianChecks()) return;
          if (n.goTo(n.clinic.x, n.clinic.y)) n.setFlipX(n.scene.player.x < n.x);
          n.scanCd -= dt;
          if (n.scanCd > 0) return;
          n.scanCd = 2;
          // Yaralı bir komşu varsa yanına git
          const hurt = n.scene.npcs.find((o) => o !== n && !o.hidden && o.active && o.hp < o.maxHp * 0.7 && !n.nearestZombie(90, o.x, o.y));
          if (hurt) n.sm.set('treat', hurt);
        }
      },
      treat: {
        enter: (n, o) => { n.patient = o; n.setActivity('🩺'); },
        update: (n) => {
          if (n.civilianChecks()) return;
          const o = n.patient;
          if (!o || !o.active || o.hidden || o.hp >= o.maxHp * 0.95 || n.sm.timeInState > 12) { n.sm.set('clinic'); return; }
          const close = Phaser.Math.Distance.Between(n.x, n.y, o.x, o.y) < 14;
          if (!close) { n.moveToward(o.x + (o.x < n.x ? 10 : -10), o.y, n.speed); return; }
          n.halt();
          if (n.sm.timeInState > 1.2) {
            o.hp = Math.min(o.maxHp, o.hp + 30);
            n.scene.spawnParticles(o.x, o.y - 4, 0x7dffa0, 8);
            n.scene.floatText(o.x, o.y - 12, '+30 ✚', '#7dffa0');
            n.sm.set('clinic');
          }
        }
      }
    }, 'clinic');
    // Sığınaktayken gece diğer saklanan yaralıları iyileştir
    const sheltered = this.sm.states.sheltered;
    const baseUpdate = sheltered.update;
    sheltered.update = (n, dt) => {
      baseUpdate(n, dt);
      if (!n.hidden) return;
      n.healTick -= dt;
      if (n.healTick > 0) return;
      n.healTick = 3;
      let healed = 0;
      n.scene.npcs.forEach((o) => {
        if (o === n || !o.hidden || o.hp >= o.maxHp) return;
        o.hp = Math.min(o.maxHp, o.hp + 10);
        healed++;
      });
      if (healed) {
        n.treatedTonight += healed;
        const d = n.shelter.door;
        n.scene.floatText(d.x, d.y - 26, '✚', '#7dffa0');
      }
    };
  }
}

// ---------------- Silahlı NPC tabanı (Avcı + Nöbetçi): gündüz yerinde, gece nöbet noktasında savaş ----------------
// Alt sınıf şunları tanımlar: stall {x,y}, post {x,y}, range, dmg, fireRate, projectile ('arrow'|'bullet'), roam, standIcon
export class Fighter extends NPC {
  fighterStates() {
    return {
      stand: {
        enter: (n) => { n.setActivity(n.standIcon); n.goal = null; n.wait = 0; },
        update: (n, dt) => {
          if (n.hidden) return;
          const z = n.nearestZombie(n.range);
          if (z) { n.sm.set('fight', z); return; }
          if (n.timeSys.isNight || n.isBedtime) { n.sm.set('post'); return; }
          if (n.wait > 0) { n.wait -= dt; return; }
          if (!n.goal) n.goal = { x: n.stall.x + Phaser.Math.Between(-n.roam, n.roam), y: n.stall.y + Phaser.Math.Between(-n.roam / 2, n.roam / 2) };
          if (n.goTo(n.goal.x, n.goal.y)) {
            n.goal = null;
            n.wait = Phaser.Math.FloatBetween(2, 5);
            if (!n.roam) n.setFlipX(n.scene.player.x < n.x);
          }
        }
      },
      post: {
        enter: (n) => n.setActivity('🎯'),
        update: (n) => {
          if (n.hidden) return;
          const z = n.nearestZombie(n.range + 30);
          if (z) { n.sm.set('fight', z); return; }
          if (!n.timeSys.isNight && !n.isBedtime) { n.sm.set('stand'); return; }
          if (n.goTo(n.post.x, n.post.y)) n.setFlipX(n.post.x < n.shelter.x);
        }
      },
      fight: {
        enter: (n, z) => { n.foe = z; n.setActivity(n.projectile === 'arrow' ? '🏹' : '⚔'); },
        update: (n, dt) => {
          n.shootCd = (n.shootCd || 0) - dt;
          if (n.hp < n.maxHp * 0.35) { n.sm.set('retreat'); return; }
          if (!n.foe || n.foe.dead || !n.foe.active) {
            n.foe = n.nearestZombie(n.range + 30);
            if (!n.foe) { n.sm.set(n.timeSys.isNight || n.isBedtime ? 'post' : 'stand'); return; }
          }
          const z = n.foe;
          const d = Phaser.Math.Distance.Between(n.x, n.y, z.x, z.y);
          // Okçu uzaktan vurur: çok yakına gelirse geri çekil, menzil dışındaysa yaklaş (nöbet noktasından fazla uzaklaşma)
          const far = Phaser.Math.Distance.Between(n.x, n.y, n.post.x, n.post.y) > 110;
          if (d > n.range * 0.9 && !far) n.moveToward(z.x, z.y, n.speed);
          else if (d < 40) n.moveToward(n.x - (z.x - n.x), n.y - (z.y - n.y), n.speed * 0.85);
          else if (far && d > n.range * 0.9) { n.foe = null; n.sm.set('post'); return; }
          else { n.halt(); n.setFlipX(z.x < n.x); }
          if (d < n.range && n.shootCd <= 0) {
            n.shootCd = n.fireRate;
            const a = Phaser.Math.Angle.Between(n.x, n.y - 2, z.x, z.y);
            if (n.projectile === 'arrow') { fireArrow(n.scene, n.x, n.y - 2, a, n.dmg, n.range + 20); audio.sfx('swing'); }
            else { n.scene.fireBullet(n.x, n.y - 2, a, n.dmg, 240); audio.sfx('turret'); }
          }
        }
      },
      retreat: {
        enter: (n) => { n.setActivity('🩹'); n.scene.hud.toast(`${n.npcName} yaralı, geri çekiliyor!`, 'warn'); },
        update: (n) => { if (n.goTo(n.shelter.door.x, n.shelter.door.y)) n.sm.set('heal'); }
      },
      heal: {
        enter: (n) => { n.hide(); n.setActivity('🩹'); },
        update: (n) => {
          if (n.hp >= n.maxHp * 0.85 && !n.nearestZombie(40, n.shelter.door.x, n.shelter.door.y)) {
            n.emerge();
            n.sm.set(n.timeSys.isNight || n.isBedtime ? 'post' : 'stand');
          }
        }
      }
    };
  }

  takeDamage(n, source) {
    if (this.hidden) return;
    this.hp -= n;
    this.flash(0xff4444);
    if (source) this.knockback(source.x, source.y, 80);
    audio.sfx('hurt');
    if (this.hp <= this.maxHp * 0.35 && this.sm.states.retreat && this.sm.name !== 'retreat' && this.sm.name !== 'heal') this.sm.set('retreat');
    if (this.hp <= 0) { this.hp = 1; this.hide(); this.sm.set(this.sm.states.heal ? 'heal' : 'sheltered'); }
  }
}

// ---------------- Avcı: gündüz ok satar, gece sığınak önünde okla savunur ----------------
export class Hunter extends Fighter {
  constructor(scene, x, y) {
    super(scene, x, y, {
      key: 'hunter', name: 'Murat', role: 'Avcı', texture: 'npc_hunter', shop: 'hunter', hp: 60, speed: 42,
      lines: {
        day: ['Okun sesi zombileri çekmez, tabancadan iyidir.', 'Gece sığınağın önünde ben beklerim.', 'Ok ucu için taş, gövdesi için odun lazım.', 'Kafasına nişan al. Ya da en azından kafasına yakın bir yere.'],
        night: ['Yay gergin, gözler açık!', 'Arkamda dur, önüme geçme!']
      }
    });
    this.workState = 'stand';
    this.stall = { x, y };
    const d = scene.shelter.door;
    this.post = { x: d.x + 30, y: d.y + 22 };
    // NPC savunucular destek amaçlı: asıl savunma oyuncunun işi
    this.range = 140;
    this.dmg = 2;
    this.fireRate = 1.6;
    this.projectile = 'arrow';
    this.roam = 0;
    this.standIcon = '🏹';
    this.sm = new StateMachine(this, { ...this.commonStates(), ...this.fighterStates() }, 'stand');
  }
}

// ---------------- Hayatta kalan: işe alınınca Sulayıcı veya Nöbetçi olur ----------------
const SURVIVOR_LINES = {
  idle: { day: ['Kasabanız güvenli görünüyor… Bana iş var mı?', 'Günlük 10 altına çalışırım, söz.', 'Uzun zamandır düzgün bir yemek yemedim.'], night: ['İçeri girelim, lütfen!', 'O iniltiler… yine geliyorlar.'] },
  waterer: { day: ['Tarlayı ben suluyorum, sen rahat ol.', 'Kuru toprak görmeye dayanamıyorum.'], night: ['Sığınakta bekliyorum, sabah tarlaya dönerim.'] },
  sentry: { day: ['Çevreyi kolluyorum.', 'Mermim azaldıysa haber veririm.'], night: ['Nöbetteyim!', 'Buraya kadar gelemezler!'] }
};

export class Survivor extends Fighter {
  constructor(scene, x, y, data) {
    super(scene, x, y, {
      key: 'survivor', name: data.name, role: 'Hayatta Kalan', texture: `npc_surv${data.variant || 0}`, hp: 45, speed: 36,
      lines: SURVIVOR_LINES.idle
    });
    this.variant = data.variant || 0;
    this.arrived = data.arrived || 1;
    this.slot = data.slot || 0;
    this.zone = farmRect();
    const d = scene.shelter.door;
    const posts = [{ x: d.x - 60, y: d.y - 6 }, { x: d.x + 60, y: d.y - 6 }, { x: d.x - 34, y: d.y + 40 }, { x: d.x + 64, y: d.y + 40 }];
    this.post = posts[this.slot % posts.length];
    this.camp = { x: d.x - 30 + (this.slot % 4) * 20, y: d.y + 74 };
    this.range = 120;
    this.dmg = 1;
    this.fireRate = 0.9;
    this.projectile = 'bullet';
    this.standIcon = '👁';
    this.setJob(data.job || null);
  }

  setJob(job) {
    this.sm?.current?.exit?.(this);
    this.job = job;
    this.role = job === 'waterer' ? 'Sulayıcı' : job === 'sentry' ? 'Nöbetçi' : 'Hayatta Kalan';
    this.lines = SURVIVOR_LINES[job || 'idle'];
    this.goal = null;
    this.wait = 0;
    const wasHidden = this.hidden;
    let states, initial;
    if (job === 'waterer') {
      states = { ...this.commonStates(), ...waterStates() };
      initial = 'tend';
    } else if (job === 'sentry') {
      this.stall = this.post;
      this.roam = 30;
      states = { ...this.commonStates(), ...this.fighterStates() };
      initial = 'stand';
    } else {
      states = {
        ...this.commonStates(),
        idle: {
          enter: (n) => { n.setActivity('❔'); n.goal = null; n.wait = 0; },
          update: (n, dt) => {
            if (n.civilianChecks()) return;
            if (n.wait > 0) { n.wait -= dt; return; }
            if (!n.goal) n.goal = { x: n.camp.x + Phaser.Math.Between(-16, 16), y: n.camp.y + Phaser.Math.Between(-8, 8) };
            if (n.goTo(n.goal.x, n.goal.y) || n.sm.timeInState > 8) { n.goal = null; n.wait = Phaser.Math.FloatBetween(2, 6); n.sm.timeInState = 0; }
          }
        }
      };
      initial = 'idle';
    }
    this.workState = initial;
    this.sm = new StateMachine(this, states, null);
    // Sığınaktaysa orada beklesin, değilse yeni işe başlasın
    this.sm.set(wasHidden ? (states.heal && job === 'sentry' ? 'heal' : 'sheltered') : initial);
    this.label.setText(this.npcName);
  }

  takeDamage(n, source) {
    if (this.job === 'sentry') { super.takeDamage(n, source); return; }
    NPC.prototype.takeDamage.call(this, n, source);
  }
}

export function createNPCs(scene, spots) {
  const d = scene.shelter.door;
  return [
    new Farmer(scene, spots.farmer.x, spots.farmer.y),
    new Merchant(scene, spots.merchant.x, spots.merchant.y),
    new Blacksmith(scene, spots.blacksmith.x, spots.blacksmith.y),
    new Guard(scene, spots.guard.x, spots.guard.y),
    new Doctor(scene, spots.doctor?.x ?? d.x - 64, spots.doctor?.y ?? d.y + 46),
    new Hunter(scene, spots.hunter?.x ?? d.x + 72, spots.hunter?.y ?? d.y + 46)
  ];
}
