import { Actor } from './Actor.js';
import { audio } from '../audio.js';

// Hayvan türleri (fiyat/ürün/kapasite verisi)
export const ANIMAL_TYPES = {
  chicken: { name: 'Tavuk', tex: 'a_chicken', icon: 'i_chicken', hp: 30, speed: 20, product: 'egg', productBig: 'egg_big', house: 'coop', cap: 6, h: 12 },
  cow:     { name: 'İnek',  tex: 'a_cow',     icon: 'i_cow',     hp: 45, speed: 11, product: 'milk', productBig: 'milk_big', house: 'barn', cap: 4, h: 16 }
};

export const ANIMAL_NAMES = {
  chicken: ['Pamuk', 'Fındık', 'Tüylü', 'Minnoş', 'Zeytin', 'Cıvcıv', 'Bıcır', 'Leblebi', 'Mısır', 'Kınalı'],
  cow: ['Sarıkız', 'Benekli', 'Papatya', 'Karamel', 'Menekşe', 'Nazlı', 'Duman', 'Kaymak']
};

// Ağıldaki tek bir hayvan: kendi başına dolaşır, yalaktan yer, gece kapı kapanınca içeri girer.
export class Animal extends Actor {
  constructor(scene, x, y, type, data = {}) {
    const def = ANIMAL_TYPES[type];
    super(scene, x, y, def.tex, def.hp);
    this.type = type;
    this.def = def;
    this.animalName = data.name || Phaser.Utils.Array.GetRandom(ANIMAL_NAMES[type]);
    const love = Number(data.love);
    this.love = Number.isFinite(love) ? Phaser.Math.Clamp(love, 0, 5) : 1;  // 0–5 kalp (0 da geçerli kayıt)
    this.fed = !!data.fed;          // bugün yedi mi
    this.petted = !!data.petted;    // bugün okşandı mı
    this.product = data.product || null; // toplanmayı bekleyen ürün eşya id'si
    this.hp = Phaser.Math.Clamp(Number(data.hp) || def.hp, 1, def.hp);
    this.hidden = false;
    this.inside = false;
    this.dead = false;
    this.radius = type === 'cow' ? 8 : 5;
    this.idle = Phaser.Math.FloatBetween(0, 2);
    this.goal = null;
    this.panic = 0;
    this.outDelay = 0;
    this.eatOffset = { x: Phaser.Math.Between(-6, 4), y: Phaser.Math.Between(-3, 4) };
    if (type === 'cow') this.body.setSize(16, 6).setOffset(4, 10);
    else this.body.setSize(8, 4).setOffset(2, 8);
    // Ürün hazır balonu
    this.bubble = scene.add.image(x, y, def.product === 'egg' ? 'i_egg' : 'i_milk').setScale(0.5).setVisible(false);
    this.refreshBubble();
  }

  get home() { return this.ranch.doorSpot(this.def.house); }

  refreshBubble() {
    if (!this.bubble) return;
    if (this.product) this.bubble.setTexture(ITEM_ICON[this.product] || 'i_egg');
  }

  preUpdate(t, d) {
    super.preUpdate(t, d);
    if (this.type === 'cow') this.shadow.setScale(1.8, 1.2);
    if (this.bubble) {
      const show = !!this.product && this.visible;
      this.bubble.setVisible(show);
      if (show) this.bubble.setPosition(this.x, this.y - this.def.h / 2 - 6 + Math.sin(t / 250) * 1.5).setDepth(10002);
    }
  }

  // env: { roam:{x0,y0,x1,y1}, doorsClosed, trough:{x,y}, hasFeed(), eat(animal) }
  tick(dt, env) {
    if (this.dead) return;
    if (this.inside) {
      if (!env.doorsClosed) { this.outDelay -= dt; if (this.outDelay <= 0) this.comeOut(); }
      return;
    }
    this.panic = Math.max(0, this.panic - dt);
    const r = env.roam;
    let speed = this.def.speed;

    // Kapılar kapandı → eve koş
    if (env.doorsClosed) {
      const h = this.home;
      if (this.moveToward(h.x, h.y, speed * 1.8) < 4) this.goInside();
      return;
    }
    // Saldırıdan kaç
    if (this.panic > 0 && this.goal) {
      if (this.moveToward(this.goal.x, this.goal.y, speed * 2.4) < 3) this.goal = null;
      this.clampTo(r);
      return;
    }
    // Aç ve yalakta yem var → yemeğe git
    if (!this.fed && env.hasFeed()) {
      const tx = env.trough.x + this.eatOffset.x, ty = env.trough.y + this.eatOffset.y;
      if (this.moveToward(tx, ty, speed * 1.3) < 4) {
        this.halt();
        env.eat(this);
        this.idle = 1.5;
        this.goal = null;
      }
      this.clampTo(r);
      return;
    }
    // Rastgele dolaşma
    if (this.idle > 0) {
      this.idle -= dt;
      if (this.anims.isPlaying || this.body.velocity.x || this.body.velocity.y) this.halt();
      // Tavuk yerde eşelenir
      if (this.type === 'chicken' && Math.random() < dt * 1.5) this.setFrame(this.frame.name === 1 ? 0 : 1);
      return;
    }
    if (!this.goal) this.goal = { x: Phaser.Math.Between(r.x0, r.x1), y: Phaser.Math.Between(r.y0, r.y1) };
    if (this.moveToward(this.goal.x, this.goal.y, speed) < 3) {
      this.goal = null;
      this.idle = Phaser.Math.FloatBetween(1, 4);
    }
    this.clampTo(r);
  }

  clampTo(r) {
    const x = Phaser.Math.Clamp(this.x, r.x0, r.x1), y = Phaser.Math.Clamp(this.y, r.y0, r.y1);
    if (x !== this.x || y !== this.y) { this.setPosition(x, y); this.goal = null; }
  }

  goInside() {
    this.inside = true;
    this.hidden = true;
    this.halt();
    this.setVisible(false);
    this.body.enable = false;
  }

  comeOut() {
    const h = this.home;
    this.inside = false;
    this.hidden = false;
    this.setPosition(h.x + Phaser.Math.Between(-3, 3), h.y + 4);
    this.setVisible(true);
    this.body.enable = true;
    this.goal = null;
    this.idle = 0;
  }

  // Zombiler extraTargets üzerinden çağırır
  takeDamage(n, src) {
    if (this.dead || this.inside) return;
    this.hp -= n;
    this.flash(0xff7777);
    audio.sfx('hit');
    this.scene.spawnParticles(this.x, this.y, 0xf4f1ea, 4);
    if (src) {
      const a = Phaser.Math.Angle.Between(src.x, src.y, this.x, this.y);
      this.goal = { x: this.x + Math.cos(a) * 40, y: this.y + Math.sin(a) * 40 };
      this.panic = 1.2;
    }
    this.ranch?.onHurt(this);
    if (this.hp <= 0) this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.scene.spawnParticles(this.x, this.y, 0xf4f1ea, 12);
    this.scene.spawnParticles(this.x, this.y, 0xd94f4f, 6);
    this.ranch?.onDeath(this);
    this.destroy();
  }

  serialize() {
    return { type: this.type, name: this.animalName, love: Math.round(this.love * 100) / 100, fed: this.fed, petted: this.petted, product: this.product, hp: Math.round(this.hp) };
  }

  destroy(fromScene) {
    this.bubble?.destroy();
    this.bubble = null;
    super.destroy(fromScene);
  }
}

// Ürün → balon ikonu
const ITEM_ICON = { egg: 'i_egg', egg_big: 'i_egg_big', milk: 'i_milk', milk_big: 'i_milk_big', wool: 'i_wool', wool_big: 'i_wool_big' };
