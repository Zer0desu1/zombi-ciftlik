import { Actor } from './Actor.js';
import { StateMachine } from '../systems/StateMachine.js';
import { TILE, ITEMS, CROPS } from '../config.js';
import { audio } from '../audio.js';
import { depleteResource } from '../systems/MapBuilder.js';

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

// Kiler (harvest modülü) günlük ihtiyacı karşılamıyorsa kasaba aç sayılır; gece moral durumuna bakılır
function townHungry(s) {
  if (s.timeSys.isNight && s.morale) return s.morale.id === 'hungry';
  return !!s.pantry && s.pantry.pantry < 2 * s.npcs.length;
}

// Cinsiyet: köyün ana NPC'leri sabit; hayatta kalanlar adlarına göre
const NPC_GENDER = { farmer: 'f', blacksmith: 'f', doctor: 'f', merchant: 'm', guard: 'm', hunter: 'm' };
export const SURV_NAMES_F = ['Elif', 'Derya', 'Nur', 'Sevgi', 'Leyla', 'Aslı', 'Ece', 'Defne', 'Gül', 'Merve', 'Ebru', 'Pınar', 'Seda', 'Nazlı', 'Hande', 'Yasemin', 'İpek', 'Damla'];
export const SURV_NAMES_M = ['Ali', 'Hasan', 'Cem', 'Burak', 'Orhan', 'Kerem', 'Mert', 'Emre', 'Can', 'Okan', 'Tolga', 'Serkan', 'Barış', 'Onur', 'Yusuf', 'Efe', 'Arda', 'Kaan'];
// Eski kayıtlarda geçebilen ama artık dağıtılmayan adlar
const LEGACY_F = ['Zeynep'];
// Addan cinsiyet çıkar ("Ali 2" gibi ekli adlar da tanınır); bilinmiyorsa null
export function genderOfName(name) {
  const base = String(name || '').split(' ')[0];
  if (SURV_NAMES_F.includes(base) || LEGACY_F.includes(base)) return 'f';
  if (SURV_NAMES_M.includes(base)) return 'm';
  return null;
}

// Otonom NPC tabanı. Her alt sınıf kendi durum makinesini kurar.
export class NPC extends Actor {
  constructor(scene, x, y, cfg) {
    super(scene, x, y, cfg.texture, cfg.hp || 30);
    this.key = cfg.key;
    this.npcName = cfg.name;
    this.role = cfg.role;
    this.gender = cfg.gender || NPC_GENDER[cfg.key] || null; // 'f' | 'm'
    this.partner = null;                                       // eşinin adı (aile sistemi, town.js)
    this.lastBaby = 0;                                         // son bebeğin doğduğu gün
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

  // Duruma göre satır: oyuncu yaralıysa, kasaba açsa, araları iyiyse (kalp) önce bunlardan biri gelir
  talkLine() {
    const L = this.lines, s = this.scene, p = s.player;
    const extra = [];
    if (L.lowHp && p && p.hp < p.maxHp * 0.35) extra.push(...L.lowHp);
    if (L.hungry && townHungry(s)) extra.push(...L.hungry);
    const hearts = Math.floor((s.town?.rel?.[this.key]?.pts || 0) / 100);
    if (hearts >= 5 && L.friend) extra.push(...L.friend);
    else if (hearts < 1 && L.stranger && !this.timeSys.isNight) extra.push(...L.stranger);
    if (extra.length && Math.random() < 0.7) return Phaser.Utils.Array.GetRandom(extra);
    return Phaser.Utils.Array.GetRandom(this.timeSys.isNight ? L.night : L.day);
  }

  // Ortak durumlar: sığınağa git + saklan
  commonStates() {
    return {
      goShelter: {
        enter: (n) => n.setActivity('🏠'),
        update: (n) => { if (n.goTo(n.shelter.door.x, n.shelter.door.y)) { n.unload?.(); n.sm.set('sheltered'); } }
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
        update: (n) => { if (n.goTo(n.shelter.door.x, n.shelter.door.y)) { n.unload?.(); n.sm.set('sheltered'); } }
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

// Sulayıcıların dolaştığı alan: oyuncunun kurduğu tarla (tarla yoksa açık çayır)
const farmZone = { get() { return this.scene.farm.area(); }, configurable: true };

// ---------------- Çiftçi: ekinleri sular, tarlada dolaşır ----------------
export class Farmer extends NPC {
  constructor(scene, x, y) {
    super(scene, x, y, {
      key: 'farmer', name: 'Ayşe', role: 'Çiftçi', texture: 'npc_farmer', speed: 34,
      lines: {
        day: ['Sulanmayan ekin büyümez, unutma!', 'Buğday en hızlı büyür. Balkabağı sabır ister ama çok para eder.', 'Çapa ile çimi sür, tohumu ek, sonra sula.', 'Senin tarlanı da suluyorum, merak etme.', 'Olgun ekini toplayıp yerine tohum ekerim, ürünü köy sandığına bırakırım.'],
        night: ['Burada ne arıyorsun? İçeri gir!', 'Zombilerin iniltisini duyuyor musun?'],
        lowHp: ['Yüzün bembeyaz olmuş! Bir şeyler ye, sonra konuşuruz.', 'Kanıyorsun… Selin\'e uğra, tarla bekler.'],
        hungry: ['Kiler bomboş… Fazla ürününü sandığa bırakır mısın?', 'Aç karınla kimse nöbet tutamaz. Kileri doldurmalıyız.'],
        friend: ['Sen olmasan bu tarla çoktan kurumuştu. İyi ki geldin.', 'Annemin güveç tarifini sana anlatmış mıydım? Sevgiyle pişer!'],
        stranger: ['Yenisin galiba. Tarlaya saygılı ol, yeter.']
      }
    });
    this.workState = 'tend';
    this.carry = {};
    this.target = null;
    Object.defineProperty(this, 'zone', farmZone);
    // Hayatta kalan Çiftçi ile aynı iş döngüsü: sula, hasat et, yeniden ek, ürünü kapıya getir
    this.sm = new StateMachine(this, { ...this.commonStates(), ...farmhandStates() }, 'tend');
  }

  nearPlayer(r = 160) { const p = this.scene.player; return !!p && Phaser.Math.Distance.Between(p.x, p.y, this.x, this.y) < r; }

  // Taşıdıklarını köy sandığına koy / oyuncuya ver (sığınağa girerken de çağrılır)
  unload(chest) { deliverCarry(this, '🌾', chest); }
}

// ---------------- Tüccar: tezgâhta bekler, meydanda dolaşır ----------------
export class Merchant extends NPC {
  constructor(scene, x, y) {
    super(scene, x, y, {
      key: 'merchant', name: 'Kemal', role: 'Tüccar', texture: 'npc_merchant', shop: 'merchant',
      lines: {
        day: ['Taze tohumlar, uygun fiyatlar!', 'Ürününü bana sat, adil fiyat veririm.', 'Balkabağı bulursan bana getir, iyi para var.'],
        night: ['Dükkân kapalı! Hayatta kalmaya bak.', 'Kasam kilitli, ben de kilitliyim. İyi geceler!'],
        lowHp: ['Ölü müşteri alışveriş yapmaz, dostum. Önce kendine bak.', 'Sargı mı? Selin\'de var. Ben komisyon almam, söz.'],
        hungry: ['Kasabada yiyecek kıt, fiyatlar uçacak… Şaka şaka. Ama kileri doldur.', 'Aç kasabada ticaret de durur. Ürün bekliyorum!'],
        friend: ['Senin için en iyi malı ayırdım, kimseye söyleme.', 'Ortak olsak mı? Sen ekersin, ben satarım, zombiler kıskanır.'],
        stranger: ['Bakmak bedava, almak paralı. Hoş geldin.']
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
        night: ['Çekiçle zombi de dövülür ama tavsiye etmem!', 'Hasarlı barikat görürsem onarırım.'],
        lowHp: ['Zırhın yok, canın yok… Bu gidişle seni de onarmam gerekecek.', 'Otur biraz. Kırık kılıçla, yorgun kolla savaşılmaz.'],
        hungry: ['Örsün başında aç durulmuyor. Kiler ne âlemde?', 'Karnım guruldarken çekiç tutamam!'],
        friend: ['Barikatlarına özel perçin çaktım. Fark ettin mi?', 'Sen gelince ocak daha iyi yanıyor sanki.'],
        stranger: ['İşim var. Malzeme getirirsen konuşuruz.']
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
        night: ['Arkamı kolla!', 'Sığınağı korumalıyız, düşerse her şey biter!'],
        lowHp: ['Asker, geri çekil ve yaralarını sar. Bu bir emirdir!', 'Bu halde nöbete çıkma. Önce iyileş.'],
        hungry: ['Aç asker savaşmaz. Kiler boşsa bu gece zor geçer.', 'Erzak olmadan moral olmaz. Kileri doldur.'],
        friend: ['Sırtımı güvenle dönebildiğim tek kişi sensin.', 'Bu gece yanımda ol, ikimiz yeteriz.'],
        stranger: ['Seni tanımıyorum. Kendini gece kanıtla.']
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
            // Kasaba morali (kiler doluluğu) savunucuların atış hızını ve hasarını etkiler
            const mo = n.scene.morale;
            n.shootCd = 1.1 / (mo?.rate ?? 1) / (n.friendRate || 1);
            n.scene.fireBullet(n.x, n.y - 2, Phaser.Math.Angle.Between(n.x, n.y, z.x, z.y), 1 * (mo?.dmg ?? 1), 240);
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
        night: ['İçeride yaralılar var, acele et!', 'Isırıldın mı? Hemen göster!'],
        lowHp: ['Dur! Bu yaralarla dolaşamazsın. Muayene olmalısın.', 'Nabzın zayıf. Hemen bir sargı kullan, lütfen.'],
        hungry: ['Hastalarım aç. İlaç bile aç karına işe yaramıyor.', 'Kilere havuç ya da çorba bırakırsan herkes daha çabuk iyileşir.'],
        friend: ['Sağlığına dikkat ediyorsun, gurur duyuyorum. Biraz.', 'Senin için en iyi sargıları ayırıyorum.'],
        stranger: ['Yeni yüz. Aşı kartın var mı? Şaka, burada kart yok.']
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
            const mo = n.scene.morale;
            n.shootCd = n.fireRate / (mo?.rate ?? 1) / (n.friendRate || 1);
            const dmg = n.dmg * (mo?.dmg ?? 1);
            const a = Phaser.Math.Angle.Between(n.x, n.y - 2, z.x, z.y);
            if (n.projectile === 'arrow') { fireArrow(n.scene, n.x, n.y - 2, a, dmg, n.range + 20); audio.sfx('swing'); }
            else { n.scene.fireBullet(n.x, n.y - 2, a, dmg, 240); audio.sfx('turret'); }
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
        night: ['Yay gergin, gözler açık!', 'Arkamda dur, önüme geçme!'],
        lowHp: ['Yaralı av en kolay avdır. Saklan ve iyileş.', 'Kan kokusu onları çeker. Sargını sar!'],
        hungry: ['Av hayvanı kalmadı, kiler de boş. Tarla bize bakmalı.', 'Aç kurt cesur olur ama aç insan dikkatsiz.'],
        friend: ['Okçuluğu sana da öğretirim, ama önce nişan almayı.', 'İzini sürdüğüm en iyi dostsun.'],
        stranger: ['Ayak sesin çok gürültülü. Zombiler duyar.']
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

// ---------------- Hayatta kalan: işe alınınca Çiftçi, Savaşçı, Oduncu veya Madenci olur ----------------
// İş kimlikleri eski kayıtlarla uyum için korunur: 'waterer' = Çiftçi, 'sentry' = Savaşçı
export const SURVIVOR_JOBS = {
  waterer: { name: 'Çiftçi', icon: '🌾' },
  sentry: { name: 'Savaşçı', icon: '🛡' },
  lumberjack: { name: 'Oduncu', icon: '🪓' },
  miner: { name: 'Madenci', icon: '⛏' }
};

const SURVIVOR_LINES = {
  idle: { day: ['Kasabanız güvenli görünüyor… Bana iş var mı?', 'Günlük 10 altına çalışırım, söz.', 'Uzun zamandır düzgün bir yemek yemedim.'], night: ['İçeri girelim, lütfen!', 'O iniltiler… yine geliyorlar.'] },
  waterer: { day: ['Tarlayı ben suluyorum, olanı da toplarım.', 'Kuru toprak görmeye dayanamıyorum.', 'Hasadı köy sandığına koyuyorum.'], night: ['Sığınakta bekliyorum, sabah tarlaya dönerim.'] },
  sentry: { day: ['Çevreyi kolluyorum.', 'Mermim azaldıysa haber veririm.'], night: ['Nöbetteyim!', 'Buraya kadar gelemezler!'] },
  lumberjack: { day: ['Baltam keskin, ormanda ağaç çok.', 'Odunları köy sandığına yığıyorum.', 'Yakındaki ağaçlardan başlıyorum, uzağa gitmem.'], night: ['Gece ormana girilmez. Sabah devam.'] },
  miner: { day: ['Kayaları kırıp taşı köy sandığına koyuyorum.', 'Kazma ağır ama iş görür.', 'Taşsız barikat olmaz!'], night: ['Karanlıkta kazma sallanmaz. Sabah görüşürüz.'] },
  child: { day: ['Büyüyünce ben de zombi avlayacağım!', 'Saklambaç oynayalım mı?', 'Annem dışarı çok uzağa gitme dedi.'], night: ['Karanlıktan korkuyorum…', 'Sığınakta masal anlatır mısın?'] }
};

const CARRY_MAX = 6;        // bu kadar taşıyınca kapıya götürür
const HIT_EVERY = 1.3;      // oduncu/madenci vuruş aralığı (sn)

// Taşınan toplam
const carryCount = (n) => Object.values(n.carry).reduce((a, b) => a + b, 0);
const addCarry = (n, id, q) => { if (id && q > 0) n.carry[id] = (n.carry[id] || 0) + q; };

// Taşınanları köy sandığına koy (storage özelliği; chest verilmezse sığan en yakın sandık). Sandık yoksa ya da
// doluysa eski davranış: kalan oyuncuya verilir ve kapıda bildirilir (artan tohumlar dahil)
function deliverCarry(n, icon, chest) {
  if (!carryCount(n)) return;
  const store = n.scene.storage;
  if (chest && !chest.alive) chest = null;
  if (!chest && store) chest = store.forCarry(n.x, n.y, n.carry);
  const parts = [], stored = [];
  const name = (id, q) => `${q} ${ITEMS[id].name.toLocaleLowerCase('tr')}`;
  let carry = n.carry;
  if (chest) {
    const r = store.depositCarry(chest, carry);
    Object.entries(r.stored).forEach(([id, q]) => stored.push(name(id, q)));
    carry = r.left;
  }
  Object.entries(carry).forEach(([id, q]) => {
    if (!ITEMS[id] || q <= 0) return;
    n.scene.giveItem(id, q);
    parts.push(name(id, q));
  });
  n.carry = {};
  if (stored.length) n.scene.hud.toast(`${icon || '📦'} ${n.npcName} ${stored.join(', ')} köy sandığına koydu`, 'info');
  if (!parts.length) return;
  const d = n.shelter.door;
  n.scene.spawnParticles(d.x, d.y, 0xffe08a, 6);
  n.scene.hud.toast(`${icon || '📦'} ${n.npcName} ${parts.join(', ')} getirdi${chest ? ' (sandık dolu)' : ''}`, 'ok');
}

// Ekilebilir tohumlar (eşya kimliği → ekin). Özellik modülleri ITEMS/CROPS'a sonradan ekin
// eklediği için liste her çağrıda kurulur (küçük liste, ucuz).
const seedIds = () => Object.keys(ITEMS).filter((id) => ITEMS[id].type === 'seed' && CROPS[ITEMS[id].crop]);

// Mevsime uygun tohum seç: önce taşıdığı (hasattan gelen) tohum, sonra köy sandığı, yoksa oyuncunun envanteri.
// pref verilirse o ekinin tohumu öne alınır. Dönüş: { id, from: 'carry' | 'chest' | 'inv' } | null
function pickSeed(n, pref) {
  const farm = n.scene.farm, inv = n.scene.inventory;
  const ids = seedIds().filter((id) => farm.inSeason(ITEMS[id].crop));
  const pid = pref && `seed_${pref}`;
  if (pid && ids.includes(pid)) ids.unshift(...ids.splice(ids.indexOf(pid), 1));
  for (const id of ids) if ((n.carry[id] || 0) > 0) return { id, from: 'carry' };
  const store = n.scene.storage;
  if (store) for (const id of ids) if (store.count(id) > 0) return { id, from: 'chest' };
  if (inv) for (const id of ids) if (inv.count(id) > 0) return { id, from: 'inv' };
  return null;
}

// Kare hâlâ tarlada ve boş mu (oyuncu bu arada ekmiş/kaldırmış olabilir)
const emptyPlot = (n, p) => !!p && n.scene.farm.get(p.tx, p.ty) === p && !p.crop;

// Yakındaki boş (sürülmüş, ekinsiz) kare
function nearestEmpty(n) {
  let best = null, bd = Infinity;
  for (const p of n.scene.farm.plots.values()) {
    if (p.crop || claimed(n, p)) continue;
    const d = Phaser.Math.Distance.Between(n.x, n.y, p.tx * TILE + 8, p.ty * TILE + 4);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// Başka bir (görünür) NPC bu hedefi zaten seçmiş mi?
const claimed = (n, t) => n.scene.npcs.some((o) => o !== n && !o.hidden && o.target === t);

// En yakın (yeri olan) köy sandığına yürü, taşıdıklarını koy, işe dön. Sandık yoksa kapıya götürüp oyuncuya verir.
const dropChest = (n) => n.scene.storage?.forCarry(n.x, n.y, n.carry) || null;
function deliverState() {
  return {
    deliver: {
      enter: (n) => { n.setActivity('📦'); n.target = null; n.dropAt = dropChest(n); },
      exit: (n) => { n.dropAt = null; },
      update: (n) => {
        if (n.civilianChecks()) return;
        if (!carryCount(n)) { n.sm.set(n.workState); return; }
        if (n.dropAt && !n.dropAt.alive) n.dropAt = dropChest(n); // sandık kaldırıldı
        const c = n.dropAt;
        if (c ? n.goTo(c.x, c.y + 12) : n.goTo(n.shelter.door.x, n.shelter.door.y + 6)) {
          if (c) n.setFlipX(false);
          n.unload(c);
          n.sm.set(n.workState);
        }
      }
    }
  };
}

// Çiftçi (Ayşe ve hayatta kalan Çiftçi ortak): sular, olgun ekini hasat eder, boşalan/boş kareye
// mevsime uygun tohum eker (önce taşıdığı tohum, sonra oyuncunun envanteri), ürünü kapıya taşır
function farmhandStates() {
  const base = waterStates();
  return {
    ...base,
    ...deliverState(),
    tend: {
      enter: (n) => { n.setActivity('🌾'); n.wait = 0; n.goal = null; n.target = null; },
      update: (n, dt) => {
        if (n.civilianChecks()) return;
        const farm = n.scene.farm;
        const dry = farm.unwatered().filter((p) => !claimed(n, p));
        if (dry.length) { n.sm.set('goWater', Phaser.Utils.Array.GetRandom(dry)); return; }
        if (carryCount(n) < CARRY_MAX) {
          const ripe = farm.ripe().filter((p) => !claimed(n, p));
          if (ripe.length) {
            let best = ripe[0], bd = Infinity;
            ripe.forEach((p) => { const d = Phaser.Math.Distance.Between(n.x, n.y, p.tx * TILE + 8, p.ty * TILE + 4); if (d < bd) { bd = d; best = p; } });
            n.sm.set('goHarvest', best);
            return;
          }
        }
        // Sürülmüş ama boş kare + mevsime uygun tohum varsa ek
        const empty = nearestEmpty(n);
        if (empty && pickSeed(n)) { n.sm.set('goPlant', empty); return; }
        if (carryCount(n)) { n.sm.set('deliver'); return; }
        if (n.wait > 0) { n.wait -= dt; return; }
        if (!n.goal) n.goal = n.zone.getRandomPoint();
        if (n.goTo(n.goal.x, n.goal.y)) { n.goal = null; n.wait = Phaser.Math.FloatBetween(1.5, 4); }
      }
    },
    goWater: {
      enter: (n, plot) => { n.plot = plot; n.target = plot; n.setActivity('💧'); },
      update: base.goWater.update
    },
    goHarvest: {
      enter: (n, plot) => { n.plot = plot; n.target = plot; n.setActivity('🌾'); },
      update: (n) => {
        if (n.civilianChecks()) return;
        const p = n.plot;
        if (!p || !n.scene.farm.isRipe(p.tx, p.ty) || n.sm.timeInState > 15) { n.sm.set('tend'); return; }
        if (n.goTo(p.tx * TILE + 8, p.ty * TILE + 4)) n.sm.set('harvesting');
      }
    },
    harvesting: {
      enter: (n) => n.setActivity('🧺'),
      update: (n) => {
        if (n.sm.timeInState < 0.8) return;
        const p = n.plot;
        const type = p?.crop?.type;
        const r = p && n.scene.farm.harvest(p.tx, p.ty);
        if (r) {
          addCarry(n, r.item, r.qty);
          if (r.seed && r.seedQty) addCarry(n, r.seed, r.seedQty);
          n.scene.spawnParticles(p.tx * TILE + 8, p.ty * TILE + 8, 0xe8c867, 6);
          if (n.nearPlayer()) audio.sfx('harvest');
          // Yeniden büyümeyen ekin: aynı kareye hemen tohum ek (önce aynı türün tohumu)
          if (emptyPlot(n, p) && pickSeed(n, type)) { n.sm.set('planting', { plot: p, pref: type }); return; }
        }
        n.sm.set('tend');
      }
    },
    goPlant: {
      enter: (n, plot) => { n.plot = plot; n.target = plot; n.setActivity('🌱'); },
      update: (n) => {
        if (n.civilianChecks()) return;
        const p = n.plot;
        if (!emptyPlot(n, p) || !pickSeed(n) || n.sm.timeInState > 15) { n.sm.set('tend'); return; }
        if (n.goTo(p.tx * TILE + 8, p.ty * TILE + 4)) n.sm.set('planting', { plot: p });
      }
    },
    planting: {
      enter: (n, o) => { n.plot = o?.plot || n.plot; n.target = n.plot; n.plantPref = o?.pref || null; n.setActivity('🌱'); },
      update: (n) => {
        if (n.civilianChecks()) return;
        if (n.sm.timeInState < 1) return;
        const p = n.plot;
        // Kare bu arada dolduysa / kaldırıldıysa ya da tohum kalmadıysa vazgeç
        const s = emptyPlot(n, p) && pickSeed(n, n.plantPref);
        if (s && n.scene.farm.plant(p.tx, p.ty, ITEMS[s.id].crop)) {
          if (s.from === 'carry') { if (--n.carry[s.id] <= 0) delete n.carry[s.id]; }
          else if (s.from === 'chest') n.scene.storage.take(s.id, 1, n.x, n.y);
          else n.scene.inventory.remove(s.id, 1);
          n.scene.spawnParticles(p.tx * TILE + 8, p.ty * TILE + 10, 0x7fbf5a, 5);
          if (n.nearPlayer()) audio.sfx('plant');
        }
        n.sm.set('tend');
      }
    }
  };
}

// Oduncu / Madenci: en uygun ağacı/kayayı bul, kes/kır, taşı
function gatherStates(kind) {
  const item = kind === 'tree' ? 'wood' : 'stone';
  const icon = kind === 'tree' ? '🪓' : '⛏';
  return {
    ...deliverState(),
    seek: {
      enter: (n) => { n.setActivity(icon); n.target = null; n.goal = null; n.wait = 0; },
      update: (n, dt) => {
        if (n.civilianChecks()) return;
        if (carryCount(n) >= CARRY_MAX) { n.sm.set('deliver'); return; }
        if (n.wait > 0) {
          n.wait -= dt;
          if (n.goal && n.goTo(n.goal.x, n.goal.y)) n.goal = null;
          return;
        }
        const r = n.findResource(kind);
        if (r) { n.sm.set('goRes', r); return; }
        // Kaynak kalmadı: elindekini teslim et, yoksa kampta bekle
        if (carryCount(n)) { n.sm.set('deliver'); return; }
        n.setActivity('❔');
        n.wait = 3;
        n.goal = { x: n.camp.x + Phaser.Math.Between(-16, 16), y: n.camp.y + Phaser.Math.Between(-8, 8) };
      }
    },
    goRes: {
      enter: (n, r) => { n.target = r; n.side = Math.random() < 0.5 ? -9 : 9; n.setActivity('🚶'); },
      update: (n) => {
        if (n.civilianChecks()) return;
        const r = n.target;
        if (!r || !r.active || r.depleted) { n.sm.set('seek'); return; }
        if (n.sm.timeInState > 25) { n.badRes = r; n.sm.set('seek'); return; } // ulaşılamadı: bunu atla
        const by = r.y + (kind === 'tree' ? 8 : 2);
        if (n.goTo(r.x + n.side, by)) { n.setFlipX(n.side > 0); n.sm.set('work', r); }
      }
    },
    work: {
      enter: (n) => { n.hitCd = HIT_EVERY; n.setActivity(icon); },
      update: (n, dt) => {
        if (n.civilianChecks()) return;
        const r = n.target;
        if (!r || !r.active || r.depleted) { n.sm.set('seek'); return; }
        n.hitCd -= dt;
        if (n.hitCd > 0) return;
        n.hitCd = HIT_EVERY;
        r.hits--;
        n.scene.tweens.add({ targets: r, x: r.x + 1, duration: 40, yoyo: true, repeat: 1 });
        n.scene.spawnParticles(r.x, r.y + 6, kind === 'tree' ? 0x8a5a3a : 0xa2a6b0, 3);
        if (n.nearPlayer()) audio.sfx(kind === 'tree' ? 'chop' : 'mine');
        if (r.hits <= 0) {
          depleteResource(r);
          addCarry(n, item, Phaser.Math.Between(2, 4));
          n.sm.set('seek');
        }
      }
    }
  };
}

export class Survivor extends Fighter {
  constructor(scene, x, y, data) {
    // Cinsiyet: kayıtta varsa o, yoksa addan, o da yoksa rastgele. Kadınların ayrı dokuları var (npc_survf*)
    const gender = data.gender === 'f' || data.gender === 'm' ? data.gender : genderOfName(data.name) || (Math.random() < 0.5 ? 'f' : 'm');
    super(scene, x, y, {
      key: 'survivor', name: data.name, role: 'Hayatta Kalan', gender,
      texture: `npc_surv${gender === 'f' && scene.textures.exists('npc_survf0') ? 'f' : ''}${data.variant || 0}`, hp: 45, speed: 36,
      lines: SURVIVOR_LINES.idle
    });
    this.variant = data.variant || 0;
    this.parents = Array.isArray(data.parents) ? data.parents.filter((p) => typeof p === 'string').slice(0, 2) : null;
    this.arrived = data.arrived || 1;
    this.slot = data.slot || 0;
    this.partner = data.partner || null;           // eşinin adı
    this.child = Math.max(0, data.child | 0);      // büyümeye kalan gün (0 = yetişkin)
    this.lastBaby = data.lastBaby || 0;            // son bebeğin doğduğu gün
    this.carry = {};
    if (data.carry && typeof data.carry === 'object') Object.entries(data.carry).forEach(([id, q]) => { if (ITEMS[id]) addCarry(this, id, q | 0); });
    this.target = null;
    Object.defineProperty(this, 'zone', farmZone);
    const d = scene.shelter.door;
    const posts = [{ x: d.x - 60, y: d.y - 6 }, { x: d.x + 60, y: d.y - 6 }, { x: d.x - 34, y: d.y + 40 }, { x: d.x + 64, y: d.y + 40 }];
    this.post = posts[this.slot % posts.length];
    this.camp = { x: d.x - 30 + (this.slot % 4) * 20, y: d.y + 74 + Math.floor(this.slot / 4) * 12 };
    this.range = 120;
    this.dmg = 1;
    this.fireRate = 0.9;
    this.projectile = 'bullet';
    this.standIcon = '👁';
    if (this.child) this.setScale(0.65);
    this.setJob(this.child ? null : data.job || null);
  }

  get jobName() { return SURVIVOR_JOBS[this.job]?.name || null; }

  // Oyuncu yakınsa ses çal (uzaktaki işçiler sessiz)
  nearPlayer(r = 160) { const p = this.scene.player; return !!p && Phaser.Math.Distance.Between(p.x, p.y, this.x, this.y) < r; }

  // Sığınağa yakın, kimsenin seçmediği en uygun kaynak
  findResource(kind) {
    const door = this.shelter.door;
    let best = null, bs = Infinity;
    this.scene.resources.getChildren().forEach((r) => {
      if (r.kind !== kind || r.depleted || !r.active || r === this.badRes || claimed(this, r)) return;
      const s = Phaser.Math.Distance.Between(door.x, door.y, r.x, r.y) + 0.5 * Phaser.Math.Distance.Between(this.x, this.y, r.x, r.y);
      if (s < bs) { bs = s; best = r; }
    });
    if (!best && this.badRes) { this.badRes = null; } // atlanan tek kaynak kaldıysa sonra tekrar dene
    return best;
  }

  // Taşıdıklarını köy sandığına koy / oyuncuya ver
  unload(chest) { deliverCarry(this, SURVIVOR_JOBS[this.job]?.icon, chest); }

  updateRole() {
    this.role = this.child ? 'Çocuk' : this.jobName || 'Hayatta Kalan';
  }

  // Çocuk büyüyünce yetişkin olur, işe alınabilir
  growUp() {
    this.child = 0;
    this.setScale(1);
    this.setJob(null);
  }

  setJob(job) {
    // İş değişirken elindekini teslim etsin (kurulumda değil)
    if (this.sm && job !== this.job) this.unload();
    this.sm?.current?.exit?.(this);
    if (this.child || !SURVIVOR_JOBS[job]) job = null;
    this.job = job;
    this.updateRole();
    this.lines = SURVIVOR_LINES[this.child ? 'child' : job || 'idle'];
    this.goal = null;
    this.wait = 0;
    this.target = null;
    this.badRes = null;
    const wasHidden = this.hidden;
    let states, initial;
    if (job === 'waterer') {
      states = { ...this.commonStates(), ...farmhandStates() };
      initial = 'tend';
    } else if (job === 'sentry') {
      this.stall = this.post;
      this.roam = 30;
      states = { ...this.commonStates(), ...this.fighterStates() };
      initial = 'stand';
    } else if (job === 'lumberjack' || job === 'miner') {
      states = { ...this.commonStates(), ...gatherStates(job === 'lumberjack' ? 'tree' : 'rock') };
      initial = 'seek';
    } else {
      states = {
        ...this.commonStates(),
        idle: {
          enter: (n) => { n.setActivity(n.child ? '🧸' : '❔'); n.goal = null; n.wait = 0; },
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
