// 'wildstock' özellik modülü — Doğadaki tavuk/inek/koyun sürüleri ve yakalama.
//   • Köyün dışındaki çayırlarda küçük yaban sürüleri dolaşır; oyuncu üstlerine koşunca kısa süre kaçarlar.
//   • Yakın dur → "🪢 Yakala". Tavuk elle yakalanır, inek/koyun için Halat gerekir (buğdaydan/yünden üretilir).
//   • Yakalanan hayvan kendi başına ağıla yürür ve normal ağıl hayvanı olur (animals.js scene.ranch.admit).
//     Ağıl yoksa yakalayanın peşinden gelir; ağıl kurulunca oraya yürür. Ağıl doluysa yakalama reddedilir.
//   • Sürüler gündüz yavaşça yenilenir. Yoldaki/peşteki (evcilleşmiş) hayvanlar kayda yazılır; yabanlar yazılmaz.
// Çok oyunculu: etkileşim host'ta misafir bağlamıyla çalışır (scene.player = yakalayan); sprite'lar görüntü aynasıyla gider.
import { TILE, MAP_W, MAP_H, FARM_ZONE } from '../config.js';
import { audio } from '../audio.js';
import { Actor } from '../entities/Actor.js';

// ---------- Ayarlar ----------
const KINDS = {
  chicken: { tex: 'a_chicken', hp: 4, graze: 16, flee: 78, tame: 46, rope: false, chance: 0.75, herd: [2, 4], body: [8, 4, 2, 8], shadow: 1 },
  sheep:   { tex: 'a_sheep',   hp: 6, graze: 13, flee: 62, tame: 40, rope: true,  chance: 1,    herd: [2, 3], body: [12, 5, 3, 8], shadow: 1.4 },
  cow:     { tex: 'a_cow',     hp: 8, graze: 10, flee: 40, tame: 36, rope: true,  chance: 1,    herd: [1, 2], body: [16, 6, 4, 10], shadow: 1.8 }
};
const MAX_WILD = 9;            // haritadaki toplam yaban hayvanı
const MAX_TAME = 6;            // yolda/peşte aynı anda en fazla
const RESPAWN_EVERY = 75;      // sn (gündüz): eksilen sürü yerine yenisi
const CATCH_R = 22;            // yakalama mesafesi
const SCARE_R = 46;            // oyuncu koşarak bu kadar yaklaşırsa kaçar
const TIRED = 2.6;             // kaçtıktan sonra bu süre yorgun (kaçmaz, yakalanabilir)
const TOWN = { x0: 22, y0: 2, x1: 60, y1: 38 };   // köy + ağıl çevresi (tile): yaban sürüsü burada doğmaz
const NAMES = { chicken: 'Tavuk', cow: 'İnek', sheep: 'Koyun' };

const S = (scene) => scene.wildstock;
// Dünya boyutu çalışma anında okunur (harita büyüyebilir)
const mapTiles = (scene) => ({ w: scene.layer?.layer?.width || MAP_W, h: scene.layer?.layer?.height || MAP_H });

// Boş çim karesi (köy/tarla/göl dışı, fizik gövdesi yok)
function grassTile(scene, tx, ty) {
  const m = mapTiles(scene);
  if (tx < 3 || ty < 3 || tx >= m.w - 3 || ty >= m.h - 3) return false;
  if (tx >= TOWN.x0 && ty >= TOWN.y0 && tx <= TOWN.x1 && ty <= TOWN.y1) return false;
  const fz = FARM_ZONE;
  if (tx >= fz.x - 2 && ty >= fz.y - 2 && tx <= fz.x + fz.w + 1 && ty <= fz.y + fz.h + 1) return false;
  if (scene.farm?.get?.(tx, ty)) return false;
  const t = scene.layer?.getTileAt(tx, ty);
  if (!t || t.index > 2) return false;
  if (scene.lakeRect && Phaser.Geom.Rectangle.Overlaps(scene.lakeRect, new Phaser.Geom.Rectangle(tx * TILE - 8, ty * TILE - 8, 32, 32))) return false;
  return scene.physics.overlapRect(tx * TILE + 1, ty * TILE + 2, 14, 12, true, true).length === 0;
}

function pickSpot(scene, minDist = 180) {
  const m = mapTiles(scene);
  const players = scene.allPlayers ? scene.allPlayers() : [scene.player];
  for (let i = 0; i < 300; i++) {
    const tx = Phaser.Math.Between(3, m.w - 4), ty = Phaser.Math.Between(3, m.h - 4);
    const x = tx * TILE + 8, y = ty * TILE + 8;
    if (players.some((p) => p && Phaser.Math.Distance.Between(p.x, p.y, x, y) < minDist)) continue;
    if (grassTile(scene, tx, ty)) return { tx, ty, x, y };
  }
  return null;
}

// ---------- Yaban / evcilleşen hayvan ----------
class Stray extends Actor {
  constructor(scene, x, y, kind, herd, data = {}) {
    const k = KINDS[kind];
    super(scene, x, y, k.tex, k.hp);
    this.kind = kind;
    this.k = k;
    this.isStray = true;
    this.herd = herd;              // {x,y} otlama merkezi
    this.mode = 'graze';           // graze | flee | follow | lead | gone
    this.wait = Phaser.Math.FloatBetween(0.3, 2.5);
    this.goal = null;
    this.fleeT = 0;
    this.tired = 0;
    this.think = Math.random() * 0.2;
    this.owner = null;             // peşinden gittiği oyuncu
    this.tameName = data.name || null;
    this.showHpBar = false;
    this.radius = 6;
    const [bw, bh, ox, oy] = k.body;
    this.body.setSize(bw, bh).setOffset(ox, oy);
    this.setFlipX(Math.random() < 0.5);
    this.rope = null;              // yakalanınca boynundaki halat işareti
  }

  preUpdate(t, d) {
    super.preUpdate(t, d);
    this.shadow.setScale(this.k.shadow, 1);
    if (this.rope) this.rope.setPosition(this.x + (this.flipX ? -3 : 3), this.y - 6).setDepth(this.depth + 1).setVisible(this.visible);
  }

  get tame() { return this.mode === 'follow' || this.mode === 'lead'; }

  scare(fx, fy, spread = true) {
    if (this.tame || this.mode === 'gone' || this.tired > 0) return;
    this.fleeAng = Phaser.Math.Angle.Between(fx, fy, this.x, this.y) + Phaser.Math.FloatBetween(-0.5, 0.5);
    this.mode = 'flee';
    this.fleeT = Phaser.Math.FloatBetween(0.8, 1.3);
    if (this.kind === 'chicken') audio.sfx('whoosh');
    if (spread) S(this.scene)?.list.forEach((o) => { if (o !== this && o.herd === this.herd && o.mode === 'graze' && Math.random() < 0.6) o.scare(fx, fy, false); });
  }

  // Yaban hayvanlarını öldürmek yok: vurulursa yalnızca ürker
  takeDamage(_n, src) { if (!this.tame) this.scare(src?.x ?? this.x - 1, src?.y ?? this.y); }

  tick(scene, dt) {
    if (this.mode === 'gone') return;
    if (this.tame) { this.tickTame(scene, dt); return; }
    this.tired = Math.max(0, this.tired - dt);
    this.think -= dt;
    if (this.think <= 0 && this.mode === 'graze') {
      this.think = 0.15;
      // Oyuncu üstüne koşuyorsa kaç (yürüyerek, yavaşça yaklaşan ya da duran oyuncu yakalayabilir)
      for (const p of scene.allPlayers ? scene.allPlayers() : [scene.player]) {
        const dx = this.x - p.x, dy = this.y - p.y, dd = Math.hypot(dx, dy);
        if (dd > SCARE_R || dd < 1) continue;
        const vx = p.body?.velocity.x || 0, vy = p.body?.velocity.y || 0, sp = Math.hypot(vx, vy);
        if (sp > 40 && (vx * dx + vy * dy) / (sp * dd) > 0.55) { this.scare(p.x, p.y); break; }
      }
    }
    if (this.mode === 'flee') {
      this.fleeT -= dt;
      this.setVelocity(Math.cos(this.fleeAng) * this.k.flee, Math.sin(this.fleeAng) * this.k.flee);
      if (Math.abs(this.body.velocity.x) > 1) this.setFlipX(this.body.velocity.x < 0);
      this.walk(true);
      this.anims.timeScale = 2;
      if (this.fleeT <= 0) {
        this.mode = 'graze';
        this.tired = TIRED;
        this.herd.x = (this.herd.x + this.x) / 2; this.herd.y = (this.herd.y + this.y) / 2;
        this.goal = null; this.wait = Phaser.Math.FloatBetween(1, 2.2);
        this.halt();
      }
      this.keepInMap(scene);
      return;
    }
    this.anims.timeScale = 1;
    if (this.goal) {
      const d = this.moveToward(this.goal.x, this.goal.y, this.k.graze);
      this.goalT -= dt;
      if (d < 3 || this.goalT <= 0) { this.goal = null; this.wait = Phaser.Math.FloatBetween(1.2, 4); this.halt(); }
    } else {
      this.wait -= dt;
      if (this.kind === 'chicken' && Math.random() < dt * 1.5) this.setFrame(this.frame.name === 1 ? 0 : 1);
      if (this.wait <= 0) {
        this.goal = { x: this.herd.x + Phaser.Math.Between(-36, 36), y: this.herd.y + Phaser.Math.Between(-28, 28) };
        this.goalT = 4;
      }
    }
    this.keepInMap(scene);
  }

  keepInMap(scene) {
    const m = mapTiles(scene);
    const x = Phaser.Math.Clamp(this.x, TILE * 2, (m.w - 2) * TILE), y = Phaser.Math.Clamp(this.y, TILE * 2, (m.h - 2) * TILE);
    if (x !== this.x || y !== this.y) { this.setPosition(x, y); this.goal = null; if (this.mode === 'flee') this.fleeAng += Math.PI; }
  }

  // Evcil: ağıla yürü (lead) ya da yakalayanın peşinden git (follow)
  tickTame(scene, dt) {
    const st = S(scene), R = scene.ranch;
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.5;
      if (this.mode === 'follow' && R && !R.canAdmit(this.kind, st.reserved(this.kind, this))) { this.mode = 'lead'; this.path = null; }
      else if (this.mode === 'lead' && R?.canAdmit(this.kind, st.reserved(this.kind, this)) === 'nopen') this.mode = 'follow';
    }
    if (this.mode === 'follow') {
      let p = this.owner;
      if (!p || !p.active || p.alive === false) p = this.owner = scene.nearestPlayer?.(this.x, this.y)?.p || scene.player;
      const d = Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y);
      if (d > 360) { this.setPosition(p.x - 14, p.y + 6); this.halt(); return; } // çok geride kaldıysa yetişir
      if (d > 22) this.moveToward(p.x, p.y + 4, d > 90 ? this.k.tame * 1.8 : this.k.tame * 1.2);
      else this.halt();
      return;
    }
    // lead: kapının dışı → kapı → içeri
    if (!this.path) this.path = [R.gate.out, R.gate.mid, R.gate.in];
    const wp = this.path[0];
    const d = this.moveToward(wp.x, wp.y, this.k.tame);
    if (d < 5) {
      this.path.shift();
      if (!this.path.length) st.arrive(this);
    }
  }
}

// ---------- Durum yönetimi ----------
function spawnHerd(scene, opts = {}) {
  const st = S(scene);
  const room = MAX_WILD - st.list.filter((a) => !a.tame).length;
  if (room < 1) return null;
  const kind = opts.kind || Phaser.Utils.Array.GetRandom(['chicken', 'chicken', 'sheep', 'sheep', 'cow']);
  const spot = opts.at || pickSpot(scene, opts.minDist ?? 180);
  if (!spot) return null;
  const [lo, hi] = KINDS[kind].herd;
  const n = Math.min(room, opts.n || Phaser.Math.Between(lo, hi));
  const herd = { x: spot.x, y: spot.y };
  const made = [];
  for (let i = 0; i < n; i++) {
    const a = new Stray(scene, spot.x + Phaser.Math.Between(-14, 14), spot.y + Phaser.Math.Between(-10, 10), kind, herd);
    if (!opts.instant) { a.setAlpha(0); scene.tweens.add({ targets: a, alpha: 1, duration: 700 }); }
    st.group.add(a);
    st.list.push(a);
    made.push(a);
  }
  return made;
}

function removeStray(scene, a) {
  const st = S(scene);
  const i = st.list.indexOf(a);
  if (i >= 0) st.list.splice(i, 1);
  a.mode = 'gone';
  a.rope?.destroy(); a.rope = null;
  if (a.active) a.destroy();
}

function makeTame(scene, a, owner) {
  a.mode = scene.ranch?.built ? 'lead' : 'follow';
  a.owner = owner;
  a.path = null;
  a.goal = null;
  a.alpha = 1;
  a.body.checkCollision.none = true; // ağıla giderken engellere takılmasın
  a.anims.timeScale = 1;
  a.rope = a.rope || scene.add.rectangle(a.x, a.y - 6, 2, 2, 0xc9a06b);
}

// Yakalama denemesi (scene.player = yakalayan oyuncu; misafir de olabilir)
function tryCatch(scene, a) {
  const st = S(scene), k = a.k, inv = scene.inventory, p = scene.player;
  if (a.mode === 'gone' || a.tame || !a.active) return;
  const name = NAMES[a.kind];
  const R = scene.ranch;
  const block = R ? R.canAdmit(a.kind, st.reserved(a.kind)) : 'nopen';
  if (block === 'full') { scene.hud.notice(R.fullText(a.kind)); audio.sfx('error'); return; }
  if (block === 'nopen' && st.list.filter((x) => x.tame).length >= MAX_TAME) { scene.hud.notice('Peşinde zaten çok hayvan var — önce ağılı kur!'); audio.sfx('error'); return; }
  if (k.rope && inv.count('rope') < 1) { scene.hud.notice(`${name} yakalamak için Halat gerekir (2 buğday → 1 halat, ya da Hayvan Pazarı).`); audio.sfx('error'); return; }
  p.actionCd = 0.35;
  // Tavuk kaçarken ya da şansı tutmazsa elden kayar
  const chance = a.mode === 'flee' ? k.chance * 0.5 : k.chance;
  if (Math.random() > chance) {
    scene.floatText(a.x, a.y - 10, 'Kaçtı!', '#ffb3b3');
    a.tired = 0;
    a.scare(p.x, p.y, false);
    a.fleeT += 0.6;
    audio.sfx('whoosh');
    return;
  }
  if (k.rope) inv.remove('rope', 1);
  makeTame(scene, a, p);
  scene.spawnParticles(a.x, a.y - 4, 0xc9a06b, 8);
  scene.floatText(a.x, a.y - 12, '🪢', '#ffe08a');
  audio.sfx('harvest');
  scene.hud.refreshInventory?.();
  scene.hud.toast(a.mode === 'lead' ? `🪢 ${name} yakalandı! Kendi başına ağıla yürüyor.` : `🪢 ${name} yakalandı! Ağıl kurulana kadar peşinden gelecek.`, 'ok');
  scene.events.emit('strayCaught', a);
}

function interaction(scene) {
  const st = S(scene);
  if (!st) return null;
  const p = scene.player;
  let best = null;
  for (const a of st.list) {
    if (a.tame || a.mode === 'gone') continue;
    if (Math.abs(a.x - p.x) > CATCH_R || Math.abs(a.y - p.y) > CATCH_R) continue;
    const d = Phaser.Math.Distance.Between(p.x, p.y, a.x, a.y);
    if (d > CATCH_R || (best && d >= best.dist)) continue;
    const need = a.k.rope && scene.inventory.count('rope') < 1 ? ' (Halat gerekir)' : '';
    best = { dist: d + 1, label: `🪢 Yakala: ${NAMES[a.kind]}${need}`, run: () => tryCatch(scene, a) };
  }
  return best;
}

// ---------- Modül ----------
export default {
  id: 'wildstock',

  init(scene) {
    const st = scene.wildstock = {
      list: [], group: scene.add.group(), respawnT: 30, pending: null,
      spawnHerd: (o) => spawnHerd(scene, o),
      catch: (a) => tryCatch(scene, a),
      // Bu türden yolda/peşte olan evcil hayvan sayısı (kendisi hariç) → ağıl kapasitesi ayırması
      reserved: (kind, self = null) => st.list.filter((x) => x !== self && x.kind === kind && x.mode === 'lead').length,
      arrive: (a) => {
        const R = scene.ranch;
        const block = R?.canAdmit(a.kind, st.reserved(a.kind, a));
        if (block) { a.mode = 'follow'; a.path = null; if (block === 'full') scene.hud.notice(R.fullText(a.kind)); return; }
        const pos = { x: a.x, y: a.y };
        removeStray(scene, a);
        const an = R.admit(a.kind, { name: a.tameName || undefined, at: pos });
        if (an) { scene.spawnParticles(pos.x, pos.y, 0xffe08a, 6); audio.sfx('place'); }
      }
    };
    scene.physics.add.collider(st.group, [scene.obstacles, scene.resources, scene.shelter].filter(Boolean));
    scene.addInteraction(interaction);
    scene.minimapDots = scene.minimapDots || [];
    scene.minimapDots.push((s) => s.wildstock.list.filter((a) => a.mode !== 'gone').map((a) => ({ x: a.x, y: a.y, color: a.tame ? '#ffe08a' : '#f4f1ea', r: 1 })));
    scene.events.once('shutdown', () => { st.list = []; });
  },

  begin(scene) {
    const st = S(scene);
    st.list.slice().forEach((a) => removeStray(scene, a));
    const pend = st.pending; st.pending = null;
    // Kayıttaki evcil (yolda/peşte) hayvanlar oyuncunun yanında yeniden belirir
    if (pend?.tame?.length) {
      const p = scene.player;
      pend.tame.slice(0, MAX_TAME).forEach((t, i) => {
        if (!KINDS[t?.kind]) return;
        const [a] = spawnHerd(scene, { kind: t.kind, n: 1, instant: true, at: { x: p.x - 16 - i * 6, y: p.y + 8 } }) || [];
        if (a) { a.tameName = typeof t.name === 'string' ? t.name.slice(0, 24) : null; makeTame(scene, a, p); }
      });
    }
    for (let i = 0; i < 6 && st.list.filter((a) => !a.tame).length < 6; i++) spawnHerd(scene, { minDist: 220 });
  },

  update(scene, dt) {
    const st = S(scene);
    if (!st) return;
    for (let i = st.list.length - 1; i >= 0; i--) {
      const a = st.list[i];
      if (!a.active) { st.list.splice(i, 1); continue; }
      a.tick(scene, dt);
    }
    if (scene.timeSys?.isNight) return;
    st.respawnT -= dt;
    if (st.respawnT <= 0) {
      st.respawnT = RESPAWN_EVERY;
      if (st.list.filter((a) => !a.tame).length < MAX_WILD - 2) spawnHerd(scene, { minDist: 260 });
    }
  },

  save(scene) {
    const st = S(scene);
    return { v: 1, tame: st.list.filter((a) => a.tame).map((a) => ({ kind: a.kind, name: a.tameName })) };
  },

  load(scene, d) {
    if (!d || typeof d !== 'object') return;
    S(scene).pending = { tame: Array.isArray(d.tame) ? d.tame : [] };
  }
};

