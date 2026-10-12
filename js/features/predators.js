// 'predators' özellik modülü — Vahşi yırtıcılar: kurt (2–3'lük sürü, hızlı, az can), kaplan (tek başına, pusu + atılma),
// ayı (yavaş, dayanıklı, sert vurur).
//   • Köy/tarla çekirdeğinden uzakta, kendi yuvaları çevresinde gezinirler; güçlüleri daha uzakta doğar.
//   • Yaklaşan oyuncuya/NPC'ye/evcil hayvana saldırır; av çok uzaklaşınca ya da köye kaçınca yuvaya döner.
//   • Silahla avlanır (scene.huntables): çiğ yaban eti + post düşer. Şafakta, sınırın altındaysa yavaşça yenisi gelir.
//   • Evcilleştirme: canı %35'in altına düşen yırtıcı kısa süre sinir (💫); yanına git, çantanda çiğ et varken E
//     → şansa bağlı evcilleşir (başarısızsa et gider, hayvan toparlanıp saldırır).
//   • Evcil hayvan sahibini takip eder, zombilere ve saldırgan yaratıklara saldırır, can yeniler, bayılırsa bir süre
//     sonra kalkar. E ile Bekle/Takip et, yaralıyken et ile Besle, Deri Tasma ile güçlendir. Oyuncu başına en fazla 3.
//   • Çok oyunculu: evcilleştiren oyuncu (misafir bağlamı) sahibidir; hayvan onu takip eder, ganimet/ödül ona gider.
// Durum scene.predators üzerinde (wild / pets dizileri). Görünüm sıradan Arcade sprite + takipçi isim etiketi
// (net/mirror.js türden bağımsız aynalar). Misafir mini haritası için konumlar netState ile gider.
import { TILE, ITEMS, RECIPES, FARM_ZONE, SHELTER_TILE } from '../config.js';
import { addCanvas, makeCanvas, R, outline } from '../textures.js';
import { audio } from '../audio.js';
import { Actor } from '../entities/Actor.js';
import { hitTarget } from '../systems/PlayerActions.js';

// ---------- Veri tabloları ----------
Object.assign(ITEMS, {
  wild_meat:  { name: 'Çiğ Yaban Eti', type: 'material', icon: 'i_wild_meat',  sell: 10, desc: 'Yırtıcılardan çiğ et. Kızartılır ya da vahşi hayvanı evcilleştirmekte kullanılır.' },
  wolf_pelt:  { name: 'Kurt Postu',    type: 'material', icon: 'i_wolf_pelt',  sell: 25, desc: 'Kalın gri post. Deri Tasma yapımında kullanılır.' },
  tiger_pelt: { name: 'Kaplan Postu',  type: 'material', icon: 'i_tiger_pelt', sell: 55, desc: 'Çizgili, değerli bir post. Tüccar iyi para verir.' },
  bear_pelt:  { name: 'Ayı Postu',     type: 'material', icon: 'i_bear_pelt',  sell: 70, desc: 'Koca, sıcak bir ayı postu. Tüccar iyi para verir.' },
  pet_collar: { name: 'Deri Tasma',    type: 'material', icon: 'i_pet_collar', sell: 12, desc: 'Evcil hayvanının yanına gidip E ile tak: +%50 can, +%40 hasar.' }
});

RECIPES.push(
  { out: 'roast_venison', qty: 1, cost: { wild_meat: 1, wood: 1 } },
  { out: 'pet_collar',    qty: 1, cost: { wolf_pelt: 1, hide: 1 } },
  { out: 'pet_collar',    qty: 2, cost: { tiger_pelt: 1 } },
  { out: 'pet_collar',    qty: 2, cost: { bear_pelt: 1 } }
);

// ---------- Ayarlar ----------
const MAX_PETS = 3;          // oyuncu başına
const TAME_HP = 0.35;        // bu oranın altında evcilleştirilebilir
const COWER_TIME = 6;        // sn: zayıf düşünce sinme (saldırmaz)
const TAME_RANGE = 30;
const MEATS = ['wild_meat', 'venison'];
const CORE_PAD = 230;        // sığınağa bu kadar yakın av kovalanmaz
const TOWN = { x0: 22, y0: 7, x1: 60, y1: 38 };       // köy çekirdeği (tile)
const PET_DOWN_TIME = 25;
const COLLAR = { hp: 1.5, dmg: 1.4 };

// fw/fh: kare boyutu. walk/run: dolaşma/kovalama hızı. aggro: fark etme, giveUp: avı bırakma, leash: yuvadan uzaklık.
// minShelter: sığınağa en az bu uzaklıkta doğar (güçlüler daha uzakta). pet: evcil hâli.
const KINDS = {
  wolf: {
    name: 'Kurt', icon: '🐺', hp: 8, dmg: 6, cd: 1.0, wind: 0.25, reach: 12, aggro: 95, giveUp: 230, leash: 340, walk: 26, run: 76,
    fw: 20, fh: 12, minShelter: 380, group: [2, 3], cap: 6, loot: { wild_meat: 1, wolf_pelt: 1 }, tame: 0.6,
    pet: { hp: 30, dmg: 3, cd: 0.8, speed: 84 }, names: ['Karabaş', 'Duman', 'Bozkurt', 'Kurtcan', 'Asena', 'Kül', 'Tarçın']
  },
  tiger: {
    name: 'Kaplan', icon: '🐯', hp: 18, dmg: 9, cd: 1.1, wind: 0.3, reach: 13, aggro: 80, giveUp: 200, leash: 280, walk: 22, run: 62,
    pounce: { range: 72, speed: 190, time: 0.34, dmg: 14, cd: 4 },
    fw: 24, fh: 13, minShelter: 560, group: [1, 1], cap: 2, loot: { wild_meat: 2, tiger_pelt: 1 }, tame: 0.45,
    pet: { hp: 45, dmg: 5, cd: 0.9, speed: 82 }, names: ['Pars', 'Alev', 'Şeritli', 'Sultan', 'Kehribar', 'Zeytin']
  },
  bear: {
    name: 'Ayı', icon: '🐻', hp: 32, dmg: 16, cd: 1.5, wind: 0.5, reach: 14, aggro: 70, giveUp: 160, leash: 230, walk: 18, run: 46,
    fw: 22, fh: 16, minShelter: 680, group: [1, 1], cap: 2, loot: { wild_meat: 3, bear_pelt: 1 }, tame: 0.4,
    pet: { hp: 70, dmg: 7, cd: 1.3, speed: 68 }, names: ['Boncuk', 'Balkız', 'Koca', 'Pofuduk', 'Fındık', 'Ayıcan']
  }
};

// ---------- Dokular (yana bakan, sağa dönük; kare 0/1 yürüme, 2 saldırı) ----------
function drawWolf(ctx, f) {
  const B = '#8a8f99', L = '#b8bcc4', D = '#5a5f69', K = '#2a2630', E = '#f2c94c';
  const legs = f === 1 ? [4, 6, 11, 13] : [3, 7, 10, 14];
  legs.forEach((x, i) => { R(ctx, x, 9, 1, 2, i % 2 ? B : D); R(ctx, x, 11, 1, 1, K); });
  R(ctx, 0, 4, 2, 2, B); R(ctx, 1, 3, 2, 1, L); R(ctx, 0, 6, 1, 1, D);       // kuyruk
  R(ctx, 2, 4, 11, 5, B); R(ctx, 3, 4, 9, 1, L); R(ctx, 4, 8, 8, 1, L);      // gövde
  R(ctx, 5, 5, 5, 1, D);                                                      // sırt
  const hx = f === 2 ? 13 : 12, hy = f === 2 ? 4 : 3;
  R(ctx, hx, hy, 4, 4, B); R(ctx, hx + 4, hy + 2, 2, 2, B); R(ctx, hx + 5, hy + 2, 1, 1, K);
  R(ctx, hx + 1, hy - 2, 1, 2, D); R(ctx, hx + 3, hy - 2, 1, 2, D);          // kulaklar
  R(ctx, hx + 2, hy + 1, 1, 1, E);                                            // göz
  if (f === 2) R(ctx, hx + 4, hy + 4, 2, 1, '#f4ece0');                       // dişler
}

function drawTiger(ctx, f) {
  const B = '#e8892e', L = '#f4b064', S = '#2a1f1a', W = '#f4ece0', K = '#1b1622';
  const legs = f === 1 ? [5, 7, 14, 16] : [4, 8, 13, 17];
  legs.forEach((x, i) => { R(ctx, x, 10, 2, 2, i % 2 ? B : L); R(ctx, x, 12, 2, 1, K); });
  R(ctx, 0, 3, 1, 4, B); R(ctx, 1, 3, 2, 1, B); R(ctx, 0, 5, 1, 1, S);       // kuyruk
  R(ctx, 2, 5, 15, 5, B); R(ctx, 3, 5, 13, 1, L); R(ctx, 4, 9, 11, 1, W);    // gövde + karın
  [5, 8, 11, 14].forEach((x) => R(ctx, x, 5, 1, 3, S));                      // çizgiler
  const hx = f === 2 ? 18 : 17, hy = f === 2 ? 4 : 3;
  R(ctx, hx, hy, 5, 5, B); R(ctx, hx + 1, hy + 3, 4, 2, W); R(ctx, hx + 5, hy + 3, 1, 1, K);
  R(ctx, hx, hy - 1, 1, 1, B); R(ctx, hx + 3, hy - 1, 1, 1, B);              // kulaklar
  R(ctx, hx + 1, hy, 1, 2, S); R(ctx, hx + 3, hy + 1, 1, 1, '#7bd389');      // alın çizgisi + göz
  if (f === 2) R(ctx, hx + 3, hy + 5, 2, 1, W);
}

function drawBear(ctx, f) {
  const B = '#6b4a2f', L = '#8a6440', D = '#4a321f', M = '#c9a06b', K = '#1b1622';
  const legs = f === 1 ? [4, 7, 13, 16] : [3, 8, 12, 17];
  legs.forEach((x) => { R(ctx, x, 12, 2, 3, D); R(ctx, x, 15, 2, 1, K); });
  R(ctx, 1, 6, 1, 2, D);                                                      // kuyruk
  R(ctx, 2, 4, 15, 8, B); R(ctx, 3, 4, 13, 2, L); R(ctx, 5, 3, 6, 1, B); R(ctx, 6, 2, 4, 1, L); // gövde + hörgüç
  R(ctx, 4, 11, 11, 1, D);
  const hx = f === 2 ? 16 : 15, hy = f === 2 ? 5 : 4;
  R(ctx, hx, hy, 5, 5, B); R(ctx, hx + 4, hy + 2, 2, 3, M); R(ctx, hx + 5, hy + 2, 1, 1, K);
  R(ctx, hx, hy - 1, 2, 1, D); R(ctx, hx + 3, hy + 1, 1, 1, K);              // kulak + göz
  if (f === 2) R(ctx, hx + 4, hy + 4, 1, 1, '#ffffff');
}

const DRAW = { wolf: drawWolf, tiger: drawTiger, bear: drawBear };

function makeTextures(scene) {
  Object.entries(KINDS).forEach(([id, k]) => {
    const key = 'pd_' + id;
    const tex = addCanvas(scene, key, k.fw * 3, k.fh, (ctx) => {
      for (let f = 0; f < 3; f++) {
        const { c, ctx: fc } = makeCanvas(k.fw, k.fh);
        DRAW[id](fc, f);
        outline(fc, 0, 0, k.fw, k.fh, '#241c1a');
        ctx.drawImage(c, f * k.fw, 0);
      }
    });
    for (let f = 0; f < 3; f++) tex.add(f, 0, f * k.fw, 0, k.fw, k.fh);
    if (!scene.anims.exists(key + '_walk')) scene.anims.create({ key: key + '_walk', frames: [{ key, frame: 0 }, { key, frame: 1 }], frameRate: 7, repeat: -1 });
  });

  const icon = (key, fn) => addCanvas(scene, key, 16, 16, (ctx) => { fn(ctx); outline(ctx, 0, 0, 16, 16, '#3a2e2a'); });
  icon('i_wild_meat', (ctx) => {
    R(ctx, 3, 4, 9, 8, '#9a3a36'); R(ctx, 4, 3, 7, 1, '#9a3a36'); R(ctx, 4, 12, 6, 1, '#9a3a36');
    R(ctx, 4, 5, 6, 2, '#c0504a'); R(ctx, 5, 8, 5, 1, '#f2d7cf'); R(ctx, 6, 10, 3, 1, '#f2d7cf');
    R(ctx, 11, 8, 3, 2, '#f4ece0'); R(ctx, 13, 7, 2, 4, '#f4ece0');
  });
  const pelt = (key, base, light, mark) => icon(key, (ctx) => {
    R(ctx, 4, 3, 8, 10, base); R(ctx, 2, 4, 3, 3, base); R(ctx, 11, 4, 3, 3, base);
    R(ctx, 2, 10, 3, 3, base); R(ctx, 11, 10, 3, 3, base); R(ctx, 7, 13, 2, 2, base); R(ctx, 6, 1, 4, 2, base);
    R(ctx, 5, 5, 6, 6, light);
    mark?.(ctx);
  });
  pelt('i_wolf_pelt', '#7a7f89', '#a8adb6', (ctx) => { R(ctx, 7, 2, 2, 1, '#5a5f69'); R(ctx, 7, 6, 2, 4, '#8a8f99'); });
  pelt('i_tiger_pelt', '#e8892e', '#f4b064', (ctx) => { [5, 8, 11].forEach((y) => R(ctx, 4, y, 8, 1, '#2a1f1a')); });
  pelt('i_bear_pelt', '#5a3d26', '#7a5636', (ctx) => { R(ctx, 6, 7, 4, 2, '#4a321f'); });
  icon('i_pet_collar', (ctx) => {
    R(ctx, 4, 3, 8, 2, '#8a5a3a'); R(ctx, 4, 11, 8, 2, '#8a5a3a'); R(ctx, 2, 5, 2, 6, '#8a5a3a'); R(ctx, 12, 5, 2, 6, '#8a5a3a');
    R(ctx, 5, 3, 6, 1, '#a87048'); R(ctx, 6, 10, 4, 3, '#f2c94c'); R(ctx, 7, 11, 2, 1, '#8a5a3a');
    R(ctx, 7, 13, 2, 2, '#c9c9d4');
  });
}

// ---------- Yardımcılar ----------
const P = (scene) => scene.predators;
const shelterCenter = () => ({ x: SHELTER_TILE.x * TILE + 32, y: SHELTER_TILE.y * TILE + 28 });
const dist = (a, b) => Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
const worldTiles = (scene) => {
  const b = scene.physics?.world?.bounds;
  return { w: Math.floor((b?.width || 96 * TILE) / TILE), h: Math.floor((b?.height || 64 * TILE) / TILE) };
};

// Köy/tarla çekirdeği: yırtıcı buraya girmez, buradaki avı kovalamaz
function inCore(x, y) {
  const tx = x / TILE, ty = y / TILE, fz = FARM_ZONE;
  if (tx >= TOWN.x0 && ty >= TOWN.y0 && tx <= TOWN.x1 + 1 && ty <= TOWN.y1 + 1) return true;
  if (tx >= fz.x - 2 && ty >= fz.y - 2 && tx <= fz.x + fz.w + 2 && ty <= fz.y + fz.h + 2) return true;
  const sc = shelterCenter();
  return Phaser.Math.Distance.Between(sc.x, sc.y, x, y) < CORE_PAD;
}

function grassTile(scene, tx, ty) {
  const W = worldTiles(scene);
  if (tx < 1 || ty < 2 || tx >= W.w - 1 || ty >= W.h - 1) return false;
  if (inCore(tx * TILE + 8, ty * TILE + 8)) return false;
  if (scene.farm?.get?.(tx, ty)) return false;
  const t = scene.layer?.getTileAt(tx, ty);
  if (!t || t.index > 2) return false;
  if (scene.lakeRect && Phaser.Geom.Rectangle.Overlaps(scene.lakeRect, new Phaser.Geom.Rectangle(tx * TILE - 8, ty * TILE - 8, 32, 32))) return false;
  return scene.physics.overlapRect(tx * TILE + 1, ty * TILE + 1, 14, 14, true, true).length === 0;
}

function pickTile(scene, minShelter, minPlayer = 260) {
  const sc = shelterCenter(), W = worldTiles(scene);
  const players = scene.allPlayers ? scene.allPlayers() : [scene.player];
  for (let i = 0; i < 500; i++) {
    const tx = Phaser.Math.Between(1, W.w - 2), ty = Phaser.Math.Between(2, W.h - 2);
    const x = tx * TILE + 8, y = ty * TILE + 8;
    if (Phaser.Math.Distance.Between(sc.x, sc.y, x, y) < minShelter) continue;
    if (players.some((p) => p && Phaser.Math.Distance.Between(p.x, p.y, x, y) < minPlayer)) continue;
    if (grassTile(scene, tx, ty)) return { tx, ty, x, y };
  }
  return null;
}

function growl(scene, b, freq = 110) {
  if (!audio.ctx || audio.muted) return;
  const me = scene.netHostPlayer || scene.player;
  if (!me || Phaser.Math.Distance.Between(me.x, me.y, b.x, b.y) > 200) return;
  audio.tone({ type: 'sawtooth', freq, to: freq * 0.6, dur: 0.35, vol: 0.12 });
  audio.noise({ dur: 0.2, vol: 0.08, freq: 500 });
}

// Çok oyunculu: oyuncunun sahiplik anahtarı (host → null, misafir → adı)
function keyOf(scene, p) {
  if (!p || !p.netRemote) return null;
  return scene.net?.guestOf?.(p)?.name || null;
}
function ownerPlayer(scene, key) {
  if (!key) return scene.netHostPlayer || scene.player;
  const gs = scene.net?.guests;
  if (gs) for (const g of gs.values()) if (g.name === key && g.player) return g.player;
  return null;
}
const asOwner = (scene, owner, fn) => (owner?.netRemote && scene.net?.asPlayer ? scene.net.asPlayer(owner, fn) : fn());

function meatCount(scene) { return MEATS.reduce((n, id) => n + (scene.inventory.count(id) || 0), 0); }
function takeMeat(scene) { for (const id of MEATS) if (scene.inventory.count(id) > 0 && scene.inventory.remove(id, 1)) return id; return null; }

// Geyik + slime listesi monsters'ta her kare yeniden kurulur (scene.predators.wild'ı da ekler); arada da tutarlı kalsın
function huntAdd(scene, b) { if (!scene.huntables) scene.huntables = []; if (!scene.huntables.includes(b)) scene.huntables.push(b); }
function huntRemove(scene, b) { const h = scene.huntables; if (!h) return; const i = h.indexOf(b); if (i >= 0) h.splice(i, 1); }

// ---------- Yırtıcı / evcil hayvan ----------
class Beast extends Actor {
  constructor(scene, x, y, kind, home) {
    const k = KINDS[kind];
    super(scene, x, y, 'pd_' + kind, k.hp);
    this.isPredator = true;
    this.kind = kind;
    this.k = k;
    this.dead = false;
    this.tame = false;
    this.radius = Math.round(k.fw / 3);
    this.home = home || { x, y };
    this.state = 'wander';      // vahşi: wander | chase | attack | pounce | return | cower — evcil: follow | stay
    this.wait = Phaser.Math.FloatBetween(0.4, 2.5);
    this.goal = null;
    this.think = Math.random() * 0.25;
    this.attackCd = 0; this.windT = 0; this.stunT = 0; this.pounceCd = 1; this.cowerT = 0; this.tameCd = 0;
    this.target = null;
    this.cowered = false;
    this.lastHurt = -99999;
    this.label = null;
    const bw = k.fw - 8, bh = 6;
    this.body.setSize(bw, bh).setOffset(4, k.fh - bh - 1);
    this.setCollideWorldBounds(true);
  }

  preUpdate(t, d) {
    super.preUpdate(t, d);
    const feet = this.y + this.k.fh / 2 - 1;
    this.shadow.setPosition(this.x, feet).setDepth(feet - 1).setScale(this.k.fw / 12, 1).setAlpha(this.alpha);
    this.setDepth(feet);
    if (this.label?.active) this.label.setPosition(this.x, this.y - this.k.fh / 2 - 3).setVisible(this.visible && !this.rider);
  }

  setLabel(text, color = '#ffffff') {
    if (!text) { this.label?.destroy(); this.label = null; return; }
    if (!this.label) {
      this.label = this.scene.add.text(this.x, this.y - 10, '', { fontFamily: 'Outfit, sans-serif', fontSize: '7px', color, stroke: '#000', strokeThickness: 2, resolution: 4 })
        .setOrigin(0.5, 1).setDepth(15000);
      this.label.netFollow = this;
    }
    this.label.setText(text).setColor(color);
  }

  petLabel() {
    if (!this.tame) return;
    this.setLabel(`${this.collar ? '⭐' : ''}${this.petName}${this.downed ? ' 💤' : this.state === 'stay' ? ' ⏸' : ''}`, this.downed ? '#9aa3ad' : '#9effa0');
  }

  get feetY() { return this.y + 2; }

  destroy(fromScene) {
    this.label?.destroy();
    this.label = null;
    super.destroy(fromScene);
  }

  takeDamage(n, source) {
    if (this.dead || !this.active) return;
    if (this.tame) { petHurt(this.scene, this, n, source); return; }
    const scene = this.scene;
    this.hp -= n;
    this.lastHurt = scene.time.now;
    this.flash(0xffffff);
    audio.sfx('hit');
    scene.spawnParticles(this.x, this.y, 0xc0504a, 4);
    if (this.hp <= 0) { killBeast(scene, this, source); return; }
    if (this.state === 'cower') return;
    // Zayıf düştü: sinip kısa süre saldırmaz → evcilleştirme fırsatı
    if (!this.cowered && this.hp <= this.maxHp * TAME_HP) {
      this.cowered = true;
      this.state = 'cower';
      this.cowerT = COWER_TIME;
      this.windT = 0;
      this.clearTint();
      this.setLabel('💫', '#ffe08a');
      const st = P(scene);
      const att = attackerOf(scene, source);
      if (st && att && !att.isPredator) asOwner(scene, att, () => {
        if (st.hinted.has(keyOf(scene, att) || '')) return;
        st.hinted.add(keyOf(scene, att) || '');
        scene.hud?.toast?.(`💫 ${this.k.name} zayıf düştü! Çantanda çiğ et varken yanına git ve E: Evcilleştir.`, 'info');
      });
      return;
    }
    const att = attackerOf(scene, source);
    this.aggroOn(att || scene.nearestPlayer?.(this.x, this.y, 320)?.p || null);
    if (source?.x != null) this.knockback(source.x, source.y, this.kind === 'bear' ? 20 : 60);
  }

  aggroOn(t, spread = true) {
    if (!t || this.tame || this.dead || this.state === 'cower') return;
    const first = this.state !== 'chase' && this.state !== 'attack' && this.state !== 'pounce';
    this.target = t;
    if (first) {
      this.state = 'chase';
      this.setAlpha(1);
      growl(this.scene, this, this.kind === 'bear' ? 80 : this.kind === 'tiger' ? 130 : 180);
    }
    // Sürü: aynı yuvadaki kurtlar da saldırır
    if (spread) P(this.scene)?.wild.forEach((o) => { if (o !== this && o.home === this.home && !o.dead) o.aggroOn(t, false); });
  }
}

// Saldırının sahibi: oyuncu (mermi → sahibi), evcil hayvan ya da null
function attackerOf(scene, source) {
  if (!source) return null;
  if (source.isPredator && source.tame) return source;
  const pl = scene.allPlayers ? scene.allPlayers() : [scene.player];
  if (pl.includes(source)) return source;
  if (source.owner && pl.includes(source.owner)) return source.owner;
  return null;
}

// Vahşi hedefler: canlı oyuncular, görünür NPC'ler, ayakta evcil hayvanlar (köy çekirdeğindekiler hariç)
function wildTargets(scene) {
  const out = [];
  for (const p of (scene.allPlayers ? scene.allPlayers() : [scene.player])) if (p && p.alive !== false) out.push(p);
  for (const n of scene.npcs || []) if (n && !n.hidden && n.active) out.push(n);
  for (const pet of P(scene)?.pets || []) if (!pet.downed && pet.active) out.push(pet);
  return out;
}
const validTarget = (t) => t && t.active !== false && !t.hidden && !t.dead && !t.downed && t.alive !== false && !(t.isPredator && !t.tame);

function nearestOf(list, x, y, max) {
  let best = null, bd = max;
  for (const t of list) {
    const d = Phaser.Math.Distance.Between(x, y, t.x, t.y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

function biteTarget(scene, b, t, dmg) {
  const mul = t.isPredator ? 1 : (scene.difficulty?.dmg ?? 1);
  t.takeDamage(Math.max(1, Math.round(dmg * mul)), b);
  scene.spawnParticles(t.x, t.y, 0xeb5757, 4);
}

function tickWild(scene, b, dt) {
  const k = b.k;
  b.attackCd = Math.max(0, b.attackCd - dt);
  b.pounceCd = Math.max(0, b.pounceCd - dt);
  b.tameCd = Math.max(0, b.tameCd - dt);
  if (b.stunT > 0) { b.stunT -= dt; if (b.stunT <= 0) b.setVelocity(0, 0); return; }
  b.anims.timeScale = 1;
  switch (b.state) {
    case 'cower': {
      b.cowerT -= dt;
      const np = scene.nearestPlayer?.(b.x, b.y, 120)?.p;
      if (np && dist(np, b) < 40) {
        const a = Phaser.Math.Angle.Between(np.x, np.y, b.x, b.y);
        b.setVelocity(Math.cos(a) * k.walk * 0.6, Math.sin(a) * k.walk * 0.6);
        b.walk(true); b.anims.timeScale = 0.6;
      } else b.halt();
      if (b.cowerT <= 0) { b.state = 'return'; b.setLabel(null); }
      return;
    }
    case 'return': {
      if (b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + dt * b.maxHp * 0.05);
      const d = b.moveToward(b.home.x, b.home.y, k.run * 0.7);
      b.anims.timeScale = 1.4;
      if (d < 16) { b.state = 'wander'; b.goal = null; b.wait = 1; b.halt(); b.cowered = b.hp <= b.maxHp * TAME_HP; }
      return;
    }
    case 'attack': {
      b.windT -= dt;
      b.setVelocity(0, 0);
      if (b.windT > 0) return;
      b.clearTint();
      const t = b.target;
      if (validTarget(t) && dist(t, b) <= k.reach + (t.radius || 6) + 6) {
        biteTarget(scene, b, t, k.dmg);
        audio.sfx('hit');
      }
      b.attackCd = k.cd * Phaser.Math.FloatBetween(0.9, 1.15);
      b.state = 'chase';
      b.setFrame(0);
      b.stunT = 0.2;
      return;
    }
    case 'pounce': {
      const pc = k.pounce;
      if (b.windT > 0) {
        b.windT -= dt;
        b.setVelocity(0, 0);
        if (b.windT <= 0) {
          const t = b.target;
          const a = Phaser.Math.Angle.Between(b.x, b.y, t?.x ?? b.x, t?.y ?? b.y);
          b.setVelocity(Math.cos(a) * pc.speed, Math.sin(a) * pc.speed);
          b.setFlipX(Math.cos(a) < 0);
          b.clearTint();
          b.dashT = pc.time; b.dashHit = false;
          audio.sfx('whoosh');
        }
        return;
      }
      b.dashT -= dt;
      const t = b.target;
      if (!b.dashHit && validTarget(t) && dist(t, b) < k.reach + (t.radius || 6)) { b.dashHit = true; biteTarget(scene, b, t, pc.dmg); }
      if (b.dashT <= 0) { b.state = 'chase'; b.pounceCd = pc.cd; b.attackCd = 0.6; b.setVelocity(0, 0); b.setFrame(0); b.stunT = 0.3; }
      return;
    }
    case 'chase': {
      b.think -= dt;
      if (b.think <= 0) {
        b.think = 0.25;
        let t = b.target;
        if (!validTarget(t)) t = b.target = nearestOf(wildTargets(scene), b.x, b.y, k.aggro);
        const giveUp = !t || dist(t, b) > k.giveUp || dist(b, b.home) > k.leash || inCore(t.x, t.y) || inCore(b.x, b.y);
        if (giveUp) { b.state = 'return'; b.target = null; b.clearTint(); return; }
      }
      const t = b.target;
      if (!t) return;
      const d = dist(t, b);
      const reach = k.reach + (t.radius || 6);
      if (k.pounce && b.pounceCd <= 0 && d < k.pounce.range && d > reach + 6) {
        b.state = 'pounce'; b.windT = 0.38; b.halt(); b.setFrame(2); b.setTint(0xffb0a0);
        b.setFlipX(t.x < b.x);
        return;
      }
      if (d <= reach) {
        b.setFlipX(t.x < b.x);
        if (b.attackCd <= 0) { b.state = 'attack'; b.windT = k.wind; b.halt(); b.setFrame(2); b.setTint(0xff9a8a); }
        else b.halt();
        return;
      }
      b.moveToward(t.x, t.y, k.run);
      b.anims.timeScale = 1.8;
      return;
    }
    default: { // wander
      b.think -= dt;
      if (b.think <= 0) {
        b.think = 0.3;
        const t = nearestOf(wildTargets(scene), b.x, b.y, k.aggro);
        if (t && !inCore(t.x, t.y)) {
          b.aggroOn(t);
          if ((scene.allPlayers ? scene.allPlayers() : [scene.player]).includes(t)) warnPlayer(scene, b, t);
          return;
        }
      }
      if (b.goal) {
        const d = b.moveToward(b.goal.x, b.goal.y, k.walk);
        b.goalT -= dt;
        b.setAlpha(1);
        if (d < 3 || b.goalT <= 0) { b.goal = null; b.wait = Phaser.Math.FloatBetween(1.5, 4); b.halt(); }
      } else {
        b.wait -= dt;
        // Kaplan pusuda: dururken çimenlerde yarı saydam
        if (b.kind === 'tiger') b.setAlpha(0.6);
        if (b.wait <= 0) {
          const h = b.home, W = worldTiles(scene);
          b.goal = { x: Phaser.Math.Clamp(h.x + Phaser.Math.Between(-56, 56), 12, W.w * TILE - 12), y: Phaser.Math.Clamp(h.y + Phaser.Math.Between(-44, 44), 24, W.h * TILE - 12) };
          if (inCore(b.goal.x, b.goal.y)) b.goal = { x: h.x, y: h.y };
          b.goalT = 4;
        }
      }
    }
  }
}

function warnPlayer(scene, b, p) {
  const st = P(scene);
  const now = scene.time.now;
  if (!st || now - (st.warnAt.get(p) || -1e9) < 20000) return;
  st.warnAt.set(p, now);
  const what = b.kind === 'wolf' ? '🐺 Kurt sürüsü seni fark etti!' : b.kind === 'tiger' ? '🐯 Bir kaplan sana atılmak üzere!' : '🐻 Bir ayı sana saldırıyor!';
  asOwner(scene, p, () => scene.hud?.toast?.(`${what} Köye kaç ya da savaş.`, 'warn'));
}

// ---------- Evcil hayvan ----------
function petMaxHp(b) { return Math.round(b.k.pet.hp * (b.collar ? COLLAR.hp : 1)); }
function petDmg(b) { return Math.round(b.k.pet.dmg * (b.collar ? COLLAR.dmg : 1) * 10) / 10; }

function addTargetable(scene, b) { if (!scene.extraTargets.includes(b)) scene.extraTargets.push(b); }
function removeTargetable(scene, b) { const i = scene.extraTargets.indexOf(b); if (i >= 0) scene.extraTargets.splice(i, 1); }

function petHurt(scene, b, n, source) {
  if (b.downed) return;
  b.hp -= n;
  b.lastHurt = scene.time.now;
  b.flash(0xff6666);
  if (source?.x != null) b.knockback(source.x, source.y, 60);
  // Saldırgana karşılık ver
  if (source && !source.isShot && source.active !== false && (source.isPredator || scene.zombies?.contains?.(source))) b.target = source;
  if (b.hp > 0) return;
  b.hp = 0;
  b.downed = true;
  b.downT = PET_DOWN_TIME;
  b.target = null;
  b.halt();
  b.setAngle(b.flipX ? -90 : 90).setAlpha(0.65);
  removeTargetable(scene, b);
  b.petLabel();
  asOwner(scene, ownerPlayer(scene, b.ownerKey), () => scene.hud?.toast?.(`${b.k.icon} ${b.petName} bayıldı! ${PET_DOWN_TIME} sn sonra kendine gelir.`, 'warn'));
}

function petTargets(scene, b, owner) {
  const out = [];
  for (const z of scene.zombies?.getChildren?.() || []) if (!z.dead && z.active) out.push(z);
  for (const w of P(scene).wild) if (!w.dead && (w.state === 'chase' || w.state === 'attack' || w.state === 'pounce')) out.push(w);
  for (const s of scene.monsters?.slimes || []) if (!s.dead && s.chasing) out.push(s);
  const anchor = b.state === 'stay' || !owner ? b : owner;
  return out.filter((t) => Phaser.Math.Distance.Between(anchor.x, anchor.y, t.x, t.y) < (b.state === 'stay' ? 90 : 160));
}

function tickPet(scene, b, dt) {
  const k = b.k, owner = ownerPlayer(scene, b.ownerKey);
  if (b.downed) {
    b.downT -= dt;
    b.setVelocity(0, 0);
    if (b.downT <= 0) {
      b.downed = false;
      b.hp = Math.round(b.maxHp * 0.4);
      b.setAngle(0).setAlpha(1);
      addTargetable(scene, b);
      b.petLabel();
    }
    return;
  }
  b.attackCd = Math.max(0, b.attackCd - dt);
  // Can yenileme: savaş dışında hızlı
  if (b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + dt * (scene.time.now - b.lastHurt > 4000 ? 1.5 : 0.25));
  if (b.stunT > 0) { b.stunT -= dt; if (b.stunT <= 0) b.setVelocity(0, 0); return; }
  if (b.windT > 0) {
    b.windT -= dt;
    b.setVelocity(0, 0);
    if (b.windT <= 0) {
      b.setFrame(0);
      const t = b.target;
      if (t && t.active && !t.dead && dist(t, b) < k.reach + (t.radius || 6) + 8) {
        // Doğrudan hasar (silah XP'si/kritik yok); zombi ödülü sahibin bağlamında
        asOwner(scene, owner, () => t.takeDamage(petDmg(b), b));
        scene.spawnParticles(t.x, t.y, 0xeb5757, 3);
        audio.sfx('hit');
      }
      b.attackCd = k.pet.cd;
      b.stunT = 0.15;
    }
    return;
  }
  b.think -= dt;
  if (b.think <= 0) {
    b.think = 0.25;
    const t = b.target;
    const valid = t && t.active && !t.dead && t.state !== 'cower' && t.state !== 'return' && !(t.isPredator && t.tame);
    if (!valid) b.target = nearestOf(petTargets(scene, b, owner), b.x, b.y, 140);
    // Sahibinden çok uzaklaştıysa avı bırak
    if (b.target && owner && b.state === 'follow' && dist(owner, b) > 220) b.target = null;
  }
  const t = b.target;
  if (t) {
    const d = dist(t, b), reach = k.reach + (t.radius || 6);
    if (d <= reach) {
      b.setFlipX(t.x < b.x);
      if (b.attackCd <= 0) { b.windT = 0.15; b.halt(); b.setFrame(2); }
      else b.halt();
    } else { b.moveToward(t.x, t.y, k.pet.speed); b.anims.timeScale = 1.6; }
    return;
  }
  b.anims.timeScale = 1;
  if (b.state === 'stay' || !owner || owner.alive === false) {
    const sp = b.stayAt || (b.stayAt = { x: b.x, y: b.y });
    if (Phaser.Math.Distance.Between(b.x, b.y, sp.x, sp.y) > 10) b.moveToward(sp.x, sp.y, k.pet.speed * 0.6);
    else b.halt();
    return;
  }
  b.stayAt = null;
  const d = dist(owner, b);
  if (d > 420) { // sahibi ışınlandı / çok uzakta: yanına gel
    b.setPosition(owner.x + Phaser.Math.Between(-14, 14), owner.y + 10);
    b.halt();
    return;
  }
  const mine = P(scene).pets.filter((o) => o.ownerKey === b.ownerKey);
  const slot = Math.max(0, mine.indexOf(b));
  const back = owner.flipX ? 16 : -16;
  const gx = owner.x + back + (slot === 2 ? -back * 2 : 0), gy = owner.y + 6 + (slot === 1 ? 12 : slot === 2 ? -4 : 0);
  const dg = Phaser.Math.Distance.Between(b.x, b.y, gx, gy);
  if (dg > 10) { b.moveToward(gx, gy, d > 90 ? k.pet.speed * 1.3 : dg < 30 ? k.pet.speed * 0.7 : k.pet.speed); b.anims.timeScale = d > 90 ? 1.6 : 1; }
  else b.halt();
}

function petName(scene, kind) {
  const used = new Set(P(scene).pets.map((p) => p.petName));
  const free = KINDS[kind].names.filter((n) => !used.has(n));
  return free.length ? Phaser.Utils.Array.GetRandom(free) : `${KINDS[kind].name} ${P(scene).pets.length + 1}`;
}

// Vahşi hayvanı (ya da kayıttan yeni) evcil yap
function makePet(scene, b, ownerKey, opts = {}) {
  const st = P(scene);
  const wi = st.wild.indexOf(b);
  if (wi >= 0) st.wild.splice(wi, 1);
  huntRemove(scene, b);
  st.wildGroup.remove(b);
  st.petGroup.add(b);
  b.tame = true;
  b.ownerKey = ownerKey || null;
  b.petName = opts.name || petName(scene, b.kind);
  b.collar = !!opts.collar;
  b.maxHp = petMaxHp(b);
  b.hp = Phaser.Math.Clamp(opts.hp ?? Math.round(b.maxHp * 0.6), 1, b.maxHp);
  b.state = opts.mode === 'stay' ? 'stay' : 'follow';
  b.stayAt = b.state === 'stay' ? { x: b.x, y: b.y } : null;
  b.downed = false;
  b.target = null; b.windT = 0; b.stunT = 0; b.cowerT = 0;
  b.clearTint(); b.setAlpha(1); b.setAngle(0);
  b.think = 0;
  st.pets.push(b);
  addTargetable(scene, b);
  b.petLabel();
  return b;
}

function tryTame(scene, b) {
  const st = P(scene), p = scene.player;
  const key = keyOf(scene, p);
  if (b.dead || b.tame || b.hp > b.maxHp * TAME_HP) return false;
  if (st.pets.filter((o) => o.ownerKey === key).length >= MAX_PETS) { scene.hud.toast(`En fazla ${MAX_PETS} evcil hayvanın olabilir.`, 'warn'); return false; }
  const meat = takeMeat(scene);
  if (!meat) { scene.hud.toast('🍖 Evcilleştirmek için çantanda çiğ et (yaban eti / geyik eti) olmalı.', 'warn'); audio.sfx('error'); return false; }
  scene.hud.refreshInventory?.();
  const chance = tameChance(b);
  b.setFlipX(p.x < b.x);
  if (Math.random() < chance || st.forceTame) {
    makePet(scene, b, key);
    scene.spawnParticles(b.x, b.y - 4, 0xff7aa8, 10);
    audio.sfx('quest');
    scene.hud.toast(`${b.k.icon} ${b.k.name} evcilleşti! Adı: ${b.petName}. Yanına gidip E ile Bekle / Takip et.`, 'ok');
    scene.floatText(b.x, b.y - 12, '❤', '#ff7aa8');
    scene.events.emit('predatorTamed', b);
    return true;
  }
  // Başarısız: eti kaptı, toparlanıp saldırıyor
  b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.25);
  b.tameCd = 4;
  b.cowered = false;
  b.setLabel(null);
  b.state = 'wander';
  b.attackCd = 0;
  b.aggroOn(p, false);
  scene.hud.toast(`${b.k.icon} ${b.k.name} eti kaptı ama evcilleşmedi — saldırıyor!`, 'warn');
  audio.sfx('error');
  return false;
}

function tameChance(b) {
  const low = 1 - b.hp / (b.maxHp * TAME_HP); // 0..1 (canı azaldıkça artar)
  return Math.min(0.95, b.k.tame + Math.max(0, low) * 0.25 + (b.state === 'cower' ? 0.1 : 0));
}

function petAction(scene, b) {
  const p = scene.player;
  const hasCollar = scene.inventory.count('pet_collar') > 0;
  if (!b.collar && hasCollar) return { label: `🦴 ${b.petName}: Tasma tak`, run: () => {
    if (!scene.inventory.remove('pet_collar', 1)) return;
    const r = b.hp / b.maxHp;
    b.collar = true;
    b.maxHp = petMaxHp(b);
    b.hp = Math.max(1, Math.round(b.maxHp * r));
    b.petLabel();
    scene.hud.refreshInventory?.();
    scene.spawnParticles(b.x, b.y - 4, 0xf2c94c, 8);
    audio.sfx('craft');
    scene.hud.toast(`⭐ ${b.petName} tasmasını taktı: daha güçlü ve dayanıklı!`, 'ok');
  } };
  if (b.hp < b.maxHp * 0.5 && meatCount(scene) > 0) return { label: `🍖 ${b.petName}: Besle`, run: () => {
    if (!takeMeat(scene)) return;
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.6);
    scene.hud.refreshInventory?.();
    scene.floatText(b.x, b.y - 12, '❤', '#9effa0');
    audio.sfx('eat');
  } };
  const stay = b.state !== 'stay';
  // Binek modülü varsa panel: 🐎 Bin + Bekle/Takip (riding.js)
  if (scene.riding) return { label: `${b.k.icon} ${b.petName}: Bin / ${stay ? 'Bekle' : 'Takip et'}`, run: () => scene.riding.openPanel(b) };
  return { label: `${b.k.icon} ${b.petName}: ${stay ? 'Bekle' : 'Takip et'}`, run: () => setStay(scene, b, stay) };
}

function setStay(scene, b, stay) {
  const p = scene.player;
  b.state = stay ? 'stay' : 'follow';
  b.stayAt = stay ? { x: b.x, y: b.y } : null;
  b.target = null;
  b.halt();
  b.setFlipX(p.x < b.x);
  b.petLabel();
  audio.sfx('click');
  scene.hud.toast(stay ? `${b.petName} burada bekleyecek.` : `${b.petName} seni takip ediyor.`, 'info');
}

// ---------- Doğum / ölüm ----------
function addBeast(scene, kind, x, y, home, fade = true) {
  const st = P(scene);
  const b = new Beast(scene, x, y, kind, home);
  if (fade) { b.setAlpha(0); scene.tweens.add({ targets: b, alpha: 1, duration: 700 }); }
  b.setFlipX(Math.random() < 0.5);
  st.wildGroup.add(b);
  st.wild.push(b);
  huntAdd(scene, b);
  return b;
}

function countKind(scene, kind) { return P(scene).wild.filter((b) => b.kind === kind && !b.dead).length; }

function spawnGroup(scene, kind, opts = {}) {
  const st = P(scene), k = KINDS[kind];
  if (!st || !k) return [];
  const room = k.cap - countKind(scene, kind);
  if (room <= 0) return [];
  const spot = opts.at || pickTile(scene, opts.minShelter ?? k.minShelter, opts.minPlayer ?? 260);
  if (!spot) return [];
  const n = Math.min(room, opts.n || Phaser.Math.Between(k.group[0], k.group[1]));
  const home = { x: spot.x, y: spot.y };
  const out = [];
  const tx0 = Math.floor(spot.x / TILE), ty0 = Math.floor(spot.y / TILE);
  for (let i = 0; i < n * 5 && out.length < n; i++) {
    const tx = tx0 + (i ? Phaser.Math.Between(-2, 2) : 0), ty = ty0 + (i ? Phaser.Math.Between(-2, 2) : 0);
    if (i > 0 && !grassTile(scene, tx, ty)) continue;
    out.push(addBeast(scene, kind, tx * TILE + 8, ty * TILE + 8, home, opts.fade !== false));
  }
  return out;
}

function removeBeast(scene, b) {
  const st = P(scene);
  if (st) {
    let i = st.wild.indexOf(b); if (i >= 0) st.wild.splice(i, 1);
    i = st.pets.indexOf(b); if (i >= 0) st.pets.splice(i, 1);
  }
  huntRemove(scene, b);
  removeTargetable(scene, b);
  if (b.active) b.destroy();
}

function killBeast(scene, b, source) {
  const st = P(scene), k = b.k;
  b.dead = true;
  b.setVelocity(0, 0);
  b.anims.stop();
  b.body.enable = false;
  b.clearTint();
  b.setLabel(null);
  scene.spawnParticles(b.x, b.y, 0x8a5a3a, 10);
  audio.sfx('harvest');
  const give = () => {
    const parts = Object.entries(k.loot).map(([id, n]) => { scene.giveItem(id, n); return `+${n} ${ITEMS[id].name}`; });
    scene.floatText(b.x, b.y - 10, parts.join('  '), '#ffe08a');
    scene.hud?.toast?.(`${k.icon} ${k.name} avlandı: ${parts.join(', ')}`, 'ok');
    scene.hud?.refreshInventory?.();
  };
  // Evcil hayvanın öldürdüğü av sahibine; mermi/ok çarpışmaları zaten sahibin bağlamında gelir
  if (source?.isPredator && source.tame) asOwner(scene, ownerPlayer(scene, source.ownerKey), give);
  else give();
  if (st) { const i = st.wild.indexOf(b); if (i >= 0) st.wild.splice(i, 1); st.kills++; }
  huntRemove(scene, b);
  scene.events.emit('predatorKilled', b);
  // Sürünün kalanı öfkelenir
  const att = attackerOf(scene, source);
  if (att && st) st.wild.forEach((o) => { if (o.home === b.home && !o.dead) o.aggroOn(att, false); });
  scene.tweens.add({ targets: b, alpha: 0, angle: b.flipX ? -90 : 90, duration: 500, onComplete: () => b.destroy() });
}

// Yeni oyun / eksik tür: kurtlar daha yakında, kaplan ve ayı uzakta
function populate(scene, kinds) {
  kinds.forEach((kind) => spawnGroup(scene, kind, { minPlayer: 320 }));
}

// ---------- Modül ----------
export default {
  id: 'predators',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    const st = scene.predators = {
      wild: [], pets: [], wildGroup: scene.add.group(), petGroup: scene.add.group(),
      kills: 0, pending: null, hinted: new Set(), warnAt: new Map(), netDots: [], forceTame: false, kinds: KINDS,
      spawn: (kind, o) => spawnGroup(scene, kind, o), tame: (b) => tryTame(scene, b),
      makePet: (b, ownerKey, o) => makePet(scene, b, ownerKey, o), tameChance, setStay: (b, stay) => setStay(scene, b, stay)
    };
    if (!scene.huntables) scene.huntables = [];

    const solids = [scene.obstacles, scene.resources, scene.shelter].filter(Boolean);
    scene.physics.add.collider(st.wildGroup, solids);
    scene.physics.add.collider(st.petGroup, solids);
    const pair = (a, b) => (a.isPredator ? [b, a] : [a, b]);
    scene.physics.add.overlap(scene.bullets, st.wildGroup, (a, c) => {
      const [bl, b] = pair(a, c);
      if (!bl.active || b.dead || b.tame) return;
      const hit = () => b.takeDamage(bl.dmg || 1, bl);
      if (bl.owner?.netRemote && scene.net?.asPlayer) scene.net.asPlayer(bl.owner, hit); else hit();
      bl.destroy();
    });
    if (scene.shotGroup) scene.physics.add.overlap(scene.shotGroup, st.wildGroup, (a, c) => {
      const [sh, b] = pair(a, c);
      if (!sh.active || b.dead || b.tame) return;
      const hit = () => hitTarget(scene, b, sh.dmg || 1, sh.crit, sh, sh.weapon);
      if (sh.owner?.netRemote && scene.net?.asPlayer) scene.net.asPlayer(sh.owner, hit); else hit();
      sh.destroy();
    });

    // E: zayıf yırtıcıyı evcilleştir / kendi evcil hayvanına komut
    scene.addInteraction((s) => {
      const p = s.player, ps = s.predators;
      if (!p || p.alive === false || !ps) return null;
      let best = null, bd = TAME_RANGE;
      const key = keyOf(s, p);
      for (const b of ps.pets) {
        if (b.downed || b.rider || b.ownerKey !== key) continue;
        const d = dist(p, b);
        if (d < bd) { bd = d; best = b; }
      }
      for (const b of ps.wild) {
        if (b.dead || b.hp > b.maxHp * TAME_HP || b.tameCd > 0) continue;
        const d = dist(p, b);
        if (d < bd) { bd = d; best = b; }
      }
      if (!best) return null;
      if (best.tame) return { dist: bd, ...petAction(s, best) };
      const b = best;
      const full = ps.pets.filter((o) => o.ownerKey === key).length >= MAX_PETS;
      const label = full ? `Evcil hayvan sınırı dolu (${MAX_PETS})`
        : meatCount(s) <= 0 ? `🍖 ${b.k.name}: evcilleştirmek için çiğ et gerek`
          : `🍖 Evcilleştir: ${b.k.name} (%${Math.round(tameChance(b) * 100)})`;
      return { dist: bd, label, run: () => tryTame(s, b) };
    });

    scene.minimapDots = scene.minimapDots || [];
    scene.minimapDots.push((s) => {
      const ps = s.predators;
      if (!ps) return [];
      if (s.net?.isGuest) return ps.netDots.map(([x, y, t]) => ({ x, y, color: t ? '#6ee06e' : '#eb5757', r: t ? 2 : 1 }));
      const out = ps.wild.filter((b) => !b.dead).map((b) => ({ x: b.x, y: b.y, color: '#eb5757', r: b.kind === 'wolf' ? 1 : 2 }));
      ps.pets.forEach((b) => out.push({ x: b.x, y: b.y, color: '#6ee06e', r: 2 }));
      return out;
    });

    // Şafak: sınırın altındaki türlerden yavaşça yenisi gelir (güçlüler ilerleyen günlerde)
    scene.timeSys.on('dawn', (day) => {
      if (scene.net?.isGuest || !scene.started) return;
      const d = Number(day) || scene.timeSys.day || 1;
      Object.entries(KINDS).forEach(([kind, k]) => {
        if (kind === 'tiger' && d < 2) return;
        if (kind === 'bear' && d < 3) return;
        if (countKind(scene, kind) + k.group[0] <= k.cap && Math.random() < 0.45) spawnGroup(scene, kind);
      });
    });
  },

  begin(scene) {
    const st = P(scene);
    [...st.wild, ...st.pets].forEach((b) => removeBeast(scene, b));
    st.hinted.clear(); st.warnAt.clear();
    const pend = st.pending; st.pending = null;
    if (!pend) { populate(scene, ['wolf', 'tiger', 'bear']); return; }
    st.kills = pend.kills || 0;
    // Vahşiler: türleri korunur, yeni (rastgele, uzak) yuvalarda doğar
    const counts = {};
    pend.wild.forEach((kind) => { counts[kind] = (counts[kind] || 0) + 1; });
    Object.entries(counts).forEach(([kind, n]) => {
      for (let i = 0; i < 6 && n > 0; i++) n -= spawnGroup(scene, kind, { n: Math.min(n, KINDS[kind].group[1]), minPlayer: 320, fade: false }).length;
    });
    // Evcil hayvanlar: kayıtlı konumda
    pend.pets.forEach((r) => {
      const b = new Beast(scene, r.x, r.y, r.kind, { x: r.x, y: r.y });
      st.wildGroup.add(b); st.wild.push(b);
      makePet(scene, b, r.owner, r);
    });
  },

  update(scene, dt) {
    const st = P(scene);
    if (!st) return;
    for (let i = st.wild.length - 1; i >= 0; i--) {
      const b = st.wild[i];
      if (!b.active) { st.wild.splice(i, 1); huntRemove(scene, b); continue; }
      if (!b.dead) tickWild(scene, b, dt);
    }
    for (let i = st.pets.length - 1; i >= 0; i--) {
      const b = st.pets[i];
      if (!b.active) { st.pets.splice(i, 1); removeTargetable(scene, b); continue; }
      if (b.rider) continue; // binek: riding.js binicinin altına yerleştirir, kendi başına saldırmaz
      tickPet(scene, b, dt);
    }
    // monsters her kare huntables'ı yeniden kurar; o modül yoksa / eski sürümse bizimkiler eksik kalmasın
    for (const b of st.wild) if (!b.dead) huntAdd(scene, b);
  },

  save(scene) {
    const st = P(scene);
    return {
      kills: st.kills,
      wild: st.wild.filter((b) => !b.dead).map((b) => b.kind),
      pets: st.pets.map((b) => ({ kind: b.kind, name: b.petName, hp: Math.max(1, Math.round(b.downed ? b.maxHp * 0.4 : b.hp)), collar: !!b.collar, mode: b.state === 'stay' ? 'stay' : 'follow', x: Math.round(b.x), y: Math.round(b.y), owner: b.ownerKey || null }))
    };
  },

  load(scene, d) {
    if (!d || typeof d !== 'object') return; // eski kayıt: yeni oyun gibi doğar
    const wild = Array.isArray(d.wild) ? d.wild.filter((k) => KINDS[k]) : [];
    const pets = (Array.isArray(d.pets) ? d.pets : []).filter((r) => r && KINDS[r.kind] && Number.isFinite(r.x) && Number.isFinite(r.y))
      .map((r) => ({ kind: r.kind, name: String(r.name || KINDS[r.kind].name).slice(0, 24), hp: Number(r.hp) || 1, collar: !!r.collar, mode: r.mode === 'stay' ? 'stay' : 'follow', x: r.x, y: r.y, owner: typeof r.owner === 'string' ? r.owner : null }));
    P(scene).pending = { kills: Number(d.kills) || 0, wild, pets };
  },

  // Çok oyunculu: misafir mini haritası (konumlar 8 px'e yuvarlanır → seyrek değişir)
  netState(scene) {
    const st = P(scene);
    if (!st) return undefined;
    const r = (v) => Math.round(v / 8) * 8;
    return [...st.wild.filter((b) => !b.dead), ...st.pets].map((b) => [r(b.x), r(b.y), b.tame ? 1 : 0]);
  },
  netApply(scene, state) {
    if (P(scene)) P(scene).netDots = Array.isArray(state) ? state : [];
  }
};
