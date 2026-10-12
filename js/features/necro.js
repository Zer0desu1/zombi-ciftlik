// 'necro' özellik modülü — Sınıflar: Şövalye (bugünkü karakter, kılıçla başlar) ve Nekromant (asayla başlar).
//   • Sınıf menüde seçilir (ui/charPick.js), yeni oyunda uygulanır; kayıtta saklanır (eski kayıt → Şövalye).
//     Co-op: her oyuncu kendi sınıfını seçer (hello.cls), misafirinki host kaydında adına göre (playerState).
//   • Asa (ITEMS.staff.onUse): yakında taze zombi cesedi varsa onu GÖLGE ASKER olarak diriltir; yoksa hedefteki
//     zombiye karanlık bir büyü fırlatır; hedef yoksa enerji harcayıp yerden temel bir gölge çağırır.
//   • Gölge askerler sahibini takip eder, en yakın zombiye / saldırgan yaratığa saldırır; dirildiği zombinin
//     türüne göre güçlüdür (iri → dayanıklı, koşucu → hızlı). Sınır 3, Savaş becerisi seviyesiyle artar (en çok 8).
//     Şafakta güneşte erirler; kaydedilmezler. Ödül/XP sahibin bağlamında (asOwner).
//   • Simülasyon host'ta; gölgeler sıradan Arcade sprite olduğundan mirror.js ile misafire aynalanır.
//   • Nekromansi (💀 menü): nekromantın ya da gölgelerinin öldürdüğü zombiler Ruh Özü (🔮) verir; ruhla ordu
//     büyüklüğü, gölge gücü/dayanıklılığı/çevikliği, asa ve "Sonsuz Gece" (gölgeler şafakta erimez) yükseltilir.
//     Ruh ve yükseltmeler oyuncu başına (PS), kayıtta saklanır.
import { ITEMS } from '../config.js';
import { el } from '../ui/dom.js';
import { addCanvas, R, makeHumanoid, basePal } from '../textures.js';
import { audio } from '../audio.js';
import { Actor } from '../entities/Actor.js';
import { hitTarget, rollDamage } from '../systems/PlayerActions.js';
import { prefClass, CLASSES } from '../ui/charPick.js';

const CORPSE_TTL = 8;        // sn: ceset bu süre "taze" (dirilebilir)
const RAISE_R = 72;          // px: oyuncuya bu yakınlıktaki ceset diriltilir
const RAISE_EN = 6, SUMMON_EN = 18, BOLT_EN = 1;
const BOLT_RANGE = 120, BOLT_DMG = 1.5;
const MAX_CAP = 13;
const TINT = 0x8a62e0;       // gölge tonu (doku rengiyle çarpılır → koyu mor)
const BASE = { hp: 14, dmg: 2, speed: 62, cd: 0.9, reach: 12, scale: 1 };
// Dirilen zombinin türüne göre çarpanlar (bilinmeyen tür → sıradan)
const KIND_MUL = {
  runner: { hp: 0.7, speed: 1.5, cd: 0.7 },
  brute: { hp: 2.2, dmg: 1.6, speed: 0.75, cd: 1.2, scale: 1.3 },
  spitter: { hp: 0.9 },
  bloater: { hp: 1.1, dmg: 1.2 },
  armored: { hp: 1.6 },
  boss: { hp: 4, dmg: 2.5, speed: 0.7, scale: 1.6 },
  summon: { hp: 0.7, dmg: 0.8 }
};

// Nekromansi yükseltmeleri: seviye başına ruh bedeli (dizinin uzunluğu = en yüksek seviye)
const UPGRADES = {
  army:  { icon: '👥', name: 'Ordu',         desc: (l) => `Asker sınırı +${l}`,                              cost: [10, 20, 35, 50, 70] },
  power: { icon: '⚔️', name: 'Karanlık Güç', desc: (l) => `Gölge hasarı +%${l * 20}`,                        cost: [8, 16, 28, 40, 55] },
  vigor: { icon: '🛡️', name: 'Dayanıklılık', desc: (l) => `Gölge canı +%${l * 25}`,                          cost: [8, 16, 28, 40, 55] },
  haste: { icon: '💨', name: 'Çeviklik',     desc: (l) => `Gölge hızı +%${l * 10}, saldırı hızı +%${l * 8}`, cost: [10, 22, 36] },
  staff: { icon: '🔮', name: 'Asa Ustalığı', desc: (l) => `Büyü hasarı +%${l * 30}, diriltme/çağırma daha ucuz`, cost: [12, 25, 40] },
  night: { icon: '🌙', name: 'Sonsuz Gece',  desc: () => 'Gölgeler şafakta erimez (sayfa yenilenene kadar kalır)', cost: [80] }
};
// Zombi türüne göre ruh (bilinmeyen tür 1)
const SOUL = { runner: 1, spitter: 2, bloater: 2, armored: 3, brute: 3, boss: 20 };
const upLv = (k) => PS?.up?.[k] || 0;
const raiseCost = () => Math.max(2, RAISE_EN - upLv('staff'));
const summonCost = () => Math.max(8, SUMMON_EN - 3 * upLv('staff'));

// Sahne başına durum
let S = null;
// O anki bağlamın (host ya da misafir) oyuncu başına durumu: { cls, kit } — NetHost bağlam takasında değiştirir
let PS = null;

const dist = (a, b) => Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
const keyOf = (scene, p) => (p?.netRemote ? scene.net?.guestOf?.(p)?.name || null : null);
function ownerPlayer(scene, key) {
  if (!key) return scene.netHostPlayer || scene.player;
  const gs = scene.net?.guests;
  if (gs) for (const g of gs.values()) if (g.name === key && g.player) return g.player;
  return null;
}
const asOwner = (scene, owner, fn) => (owner?.netRemote && scene.net?.asPlayer ? scene.net.asPlayer(owner, fn) : fn());
const players = (scene) => (scene.allPlayers ? scene.allPlayers(true) : [scene.player]);
export const isNecro = (p) => p?.cls === 'necro';
const anyNecro = (scene) => players(scene).some(isNecro);
function capOf(scene) {
  const lv = scene.prog?.lv?.combat || 1;
  return Math.min(MAX_CAP, 3 + Math.floor((lv - 1) / 2) + upLv('army'));
}
const mine = (scene, key) => S.shadows.filter((o) => o.ownerKey === key && !o.dead);

// ---------- Eşya ----------
ITEMS.staff = {
  name: 'Nekromant Asası', type: 'weapon', icon: 'i_staff', dmg: BOLT_DMG,
  desc: 'Taze zombi cesedini gölge asker olarak diriltir; zombiye karanlık büyü atar; boşta gölge çağırır (enerji).',
  onUse: (scene, ctx) => useStaff(scene, ctx)
};

// ---------- Dokular ve ses ----------
function makeTextures(scene) {
  addCanvas(scene, 'i_staff', 16, 16, (ctx) => {
    for (let i = 0; i < 10; i++) R(ctx, 3 + i, 13 - i, 2, 1, i % 3 ? '#6b4a2f' : '#8a6040'); // eğri sap
    R(ctx, 11, 1, 4, 4, '#2a1840'); R(ctx, 12, 2, 2, 2, '#b07aff'); R(ctx, 12, 2, 1, 1, '#f0dcff'); // kafatası taşı
    R(ctx, 10, 3, 1, 2, '#2a1840'); R(ctx, 15, 2, 1, 2, '#2a1840');
  });
  // Çağrılmış gölge asker: başlıklı, parlayan mor gözler, kısa kara kılıç (2 kare + yürüme)
  makeHumanoid(scene, 'necro_shadow', basePal({ O: '#0d0716', S: '#3a2a55', E: '#d6a8ff', H: '#1a1028', C: '#2c1f44', D: '#1e1530', P: '#160f24', B: '#0d0716' }), (ctx, ox, f) => {
    R(ctx, ox + 4, 1, 8, 3, '#1a1028'); R(ctx, ox + 5, 0, 6, 1, '#1a1028'); // başlık
    R(ctx, ox + 13, 6 + f, 1, 5, '#6a4a9a'); R(ctx, ox + 12, 10 + f, 3, 1, '#3a2a55'); // kılıç
  });
  if (!scene.anims.exists('necro_shadow_walk')) {
    scene.anims.create({ key: 'necro_shadow_walk', frames: [{ key: 'necro_shadow', frame: 0 }, { key: 'necro_shadow', frame: 1 }], frameRate: 6, repeat: -1 });
  }
  addCanvas(scene, 'necro_wisp', 7, 7, (ctx) => {
    R(ctx, 2, 0, 3, 7, '#7a4fd0'); R(ctx, 0, 2, 7, 3, '#7a4fd0'); R(ctx, 1, 1, 5, 5, '#a37aff'); R(ctx, 2, 2, 3, 3, '#e2ccff');
  });
  addCanvas(scene, 'necro_bolt', 6, 6, (ctx) => {
    R(ctx, 1, 0, 4, 6, '#5a2fb0'); R(ctx, 0, 1, 6, 4, '#5a2fb0'); R(ctx, 1, 1, 4, 4, '#b07aff'); R(ctx, 2, 2, 2, 2, '#ffffff');
  });
}

// Özel sesler (misafire ad olarak gider; sarmalayıcı her iki tarafta da yüklü)
const sfx0 = audio.sfx.bind(audio);
audio.sfx = (name) => {
  const a = audio;
  if (!a.ctx || a.muted || (name !== 'raise' && name !== 'hex')) return sfx0(name);
  if (name === 'raise') {
    a.tone({ type: 'sawtooth', freq: 70, to: 140, dur: 0.5, vol: 0.22 });
    a.tone({ type: 'triangle', freq: 330, to: 220, dur: 0.4, vol: 0.12, delay: 0.1 });
    a.noise({ dur: 0.35, vol: 0.18, freq: 500, attack: 0.08 });
  } else { a.tone({ type: 'square', freq: 520, to: 180, dur: 0.12, vol: 0.12 }); a.noise({ dur: 0.08, vol: 0.12, freq: 2400 }); }
};

// ---------- Gölge asker ----------
class Shade extends Actor {
  constructor(scene, x, y, tex, st, ownerKey) {
    super(scene, x, y, tex, Math.round(st.hp));
    this.st = st;
    this.ownerKey = ownerKey;
    this.isShade = true;
    this.dead = false;
    this.target = null;
    this.think = Math.random() * 0.25;
    this.attackCd = 0; this.windT = 0;
    this.radius = Math.round(6 * st.scale);
    this.setScale(st.scale).setTint(TINT).setAlpha(0.82);
    this.body.setSize(8, 6).setOffset(4, 10);
  }

  walk(moving) {
    const k = `${this.texKey}_walk`;
    if (moving && this.scene.anims.exists(k)) this.anims.play(k, true);
    else if (!moving) { this.anims.stop(); this.setFrame(0); }
  }

  // Vurulma flaşı gölge tonunu silmesin
  flash() {
    this.setTintFill(0xe2ccff);
    this.scene.time.delayedCall(80, () => { if (this.active) this.setTint(TINT); });
  }

  takeDamage(n, source) {
    if (this.dead) return;
    this.hp -= n;
    this.flash();
    if (source?.x != null) this.knockback(source.x, source.y, 50);
    if (source && !source.isShot && source.active !== false && this.scene.zombies?.contains?.(source)) this.target = source;
    if (this.hp <= 0) dissolve(this.scene, this);
  }
}

// Asker gücü: dirildiği tür × Savaş seviyesi × sahibinin (o anki bağlam PS) yükseltmeleri
function statsFor(scene, kind) {
  const m = KIND_MUL[kind] || {};
  const lv = scene.prog?.lv?.combat || 1;
  const k = 1 + 0.1 * (lv - 1);
  return {
    hp: BASE.hp * (m.hp ?? 1) * k * (1 + 0.25 * upLv('vigor')),
    dmg: BASE.dmg * (m.dmg ?? 1) * k * (1 + 0.2 * upLv('power')),
    speed: BASE.speed * (m.speed ?? 1) * (1 + 0.1 * upLv('haste')),
    cd: BASE.cd * (m.cd ?? 1) * (1 - 0.08 * upLv('haste')), reach: BASE.reach, scale: m.scale ?? BASE.scale
  };
}

// Yükseltme alınınca sahibinin mevcut askerleri de güçlenir (can oranı korunur)
function refreshMine(scene, key) {
  for (const sh of mine(scene, key)) {
    const ratio = sh.hp / Math.max(1, sh.maxHp);
    sh.st = { ...statsFor(scene, sh.kind), scale: sh.st.scale };
    sh.maxHp = Math.round(sh.st.hp);
    sh.hp = Math.max(1, Math.round(sh.maxHp * ratio));
    sh.persist = upLv('night') > 0;
  }
}

function spawnShade(scene, x, y, tex, kind, ownerKey) {
  if (!scene.textures.exists(tex)) tex = 'necro_shadow';
  const sh = new Shade(scene, x, y, tex, statsFor(scene, kind), ownerKey);
  sh.kind = kind;
  sh.persist = upLv('night') > 0;
  S.shadows.push(sh);
  if (!scene.extraTargets.includes(sh)) scene.extraTargets.push(sh);
  // Yerden yükselme
  const sc = sh.st.scale;
  sh.setScale(sc, sc * 0.2).setAlpha(0);
  scene.tweens.add({ targets: sh, scaleY: sc, alpha: 0.82, duration: 380, ease: 'Back.easeOut' });
  riseFx(scene, x, y);
  return sh;
}

function riseFx(scene, x, y) {
  scene.spawnParticles(x, y + 4, 0x7a4fd0, 10);
  scene.spawnParticles(x, y + 4, 0x1a1028, 8);
  const ring = scene.add.circle(x, y + 6, 4, 0x7a4fd0, 0.35).setStrokeStyle(1, 0xb07aff, 0.9).setDepth(y + 5);
  ring.netFx = true; // kozmetik: misafir aynalamaz (parçacıklar zaten yerel)
  scene.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
  scene.floatText?.(x, y - 14, 'Kalk!', '#c9a2ff');
}

function dissolve(scene, sh, melt = false) {
  if (sh.dead) return;
  sh.dead = true;
  sh.target = null;
  sh.setVelocity(0, 0);
  const i = scene.extraTargets.indexOf(sh);
  if (i >= 0) scene.extraTargets.splice(i, 1);
  S.shadows = S.shadows.filter((o) => o !== sh);
  scene.spawnParticles(sh.x, sh.y, melt ? 0xf0b060 : 0x7a4fd0, 8);
  scene.tweens.add({ targets: sh, alpha: 0, scaleY: sh.scaleY * 0.3, duration: 450, onComplete: () => sh.destroy() });
}

function shadeTargets(scene, sh, owner) {
  const out = [];
  for (const z of scene.zombies?.getChildren?.() || []) if (!z.dead && z.active) out.push(z);
  for (const w of scene.predators?.wild || []) if (!w.dead && !w.tame && (w.state === 'chase' || w.state === 'attack' || w.state === 'pounce')) out.push(w);
  for (const s of scene.monsters?.slimes || []) if (!s.dead && s.chasing) out.push(s);
  const anchor = owner || sh;
  return out.filter((t) => dist(anchor, t) < 170);
}

function nearest(list, x, y, max) {
  let best = null, bd = max;
  for (const t of list) { const d = Phaser.Math.Distance.Between(x, y, t.x, t.y); if (d < bd) { bd = d; best = t; } }
  return best;
}

function tickShade(scene, sh, dt, idx, count) {
  const owner = ownerPlayer(scene, sh.ownerKey);
  if (!owner) { dissolve(scene, sh); return; } // sahibi ayrıldı
  sh.attackCd = Math.max(0, sh.attackCd - dt);
  const st = sh.st;
  if (sh.windT > 0) {
    sh.windT -= dt;
    sh.setVelocity(0, 0);
    if (sh.windT <= 0) {
      const t = sh.target;
      if (t && t.active && !t.dead && dist(t, sh) < st.reach + (t.radius || 6) + 8) {
        asOwner(scene, owner, () => hitTarget(scene, t, Math.round(st.dmg * 10) / 10, false, sh, 'staff'));
        scene.spawnParticles(t.x, t.y, 0x7a4fd0, 3);
      }
      sh.attackCd = st.cd;
    }
    return;
  }
  sh.think -= dt;
  if (sh.think <= 0) {
    sh.think = 0.25;
    const t = sh.target;
    if (!(t && t.active && !t.dead)) sh.target = nearest(shadeTargets(scene, sh, owner), sh.x, sh.y, 150);
    if (sh.target && dist(owner, sh) > 230) sh.target = null; // sahibinden kopmasın
  }
  const t = sh.target;
  if (t) {
    const d = dist(t, sh), reach = st.reach + (t.radius || 6);
    if (d <= reach) {
      sh.setFlipX(t.x < sh.x);
      sh.halt();
      if (sh.attackCd <= 0) sh.windT = 0.15;
    } else sh.moveToward(t.x, t.y, st.speed * 1.15);
    return;
  }
  const d = dist(owner, sh);
  if (d > 420) { sh.setPosition(owner.x + Phaser.Math.Between(-14, 14), owner.y + 10); sh.halt(); return; }
  // Sahibinin çevresinde halka düzeni
  const a = (idx / Math.max(1, count)) * Math.PI * 2 + (owner.flipX ? 0 : Math.PI);
  const r = 20 + (count > 4 ? 6 : 0);
  const gx = owner.x + Math.cos(a) * r, gy = owner.y + 6 + Math.sin(a) * r * 0.6;
  const dg = Phaser.Math.Distance.Between(sh.x, sh.y, gx, gy);
  if (dg > 8) sh.moveToward(gx, gy, d > 90 ? st.speed * 1.4 : dg < 24 ? st.speed * 0.6 : st.speed);
  else sh.halt();
}

// ---------- Asa ----------
function useStaff(scene, ctx) {
  const p = scene.player;
  const key = keyOf(scene, p);
  const cap = capOf(scene);
  const n = mine(scene, key).length;
  const now = scene.time.now;
  // 1) Taze ceset: diriltmek her zaman önce (mobilde oto-hedef zombiye nişan alsa bile)
  if (n < cap) {
    const fresh = S.corpses.filter((c) => now - c.t < CORPSE_TTL * 1000);
    const c = nearest(fresh, p.x, p.y, RAISE_R) || nearest(fresh.filter((q) => dist(q, p) < BOLT_RANGE), ctx.wx, ctx.wy, 36);
    if (c) {
      if (p.energy < raiseCost()) { audio.sfx('error'); return; }
      p.energy -= raiseCost();
      p.actionCd = 0.5;
      removeCorpse(scene, c);
      spawnShade(scene, c.x, c.y, c.tex, c.kind, key);
      audio.sfx('raise');
      return;
    }
  }
  // 2) Hedefte zombi/av varsa karanlık büyü
  const targets = [...(scene.zombies?.getChildren?.() || []), ...(scene.huntables || [])].filter((z) => z.active && !z.dead && dist(z, p) < BOLT_RANGE);
  const z = nearest(targets, ctx.wx, ctx.wy, 30);
  if (z || n >= cap) { bolt(scene, p, z, ctx.wx, ctx.wy); return; }
  // 3) Boşta: yerden temel gölge çağır
  if (p.energy < summonCost()) { audio.sfx('error'); scene.hud.notice?.('Gölge çağırmak için enerji yetmiyor'); return; }
  p.energy -= summonCost();
  p.actionCd = 0.9;
  const a = Phaser.Math.Angle.Between(p.x, p.y, ctx.wx, ctx.wy);
  spawnShade(scene, p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 10 + 4, 'necro_shadow', 'summon', key);
  audio.sfx('raise');
}

function bolt(scene, p, z, wx, wy) {
  p.actionCd = 0.45;
  p.energy = Math.max(0, p.energy - BOLT_EN);
  const a = Phaser.Math.Angle.Between(p.x, p.y - 2, z ? z.x : wx, z ? z.y : wy);
  const len = z ? Math.min(BOLT_RANGE, dist(z, p)) : 70;
  const b = scene.add.image(p.x + Math.cos(a) * 8, p.y - 2 + Math.sin(a) * 8, 'necro_bolt').setDepth(p.y + 20);
  b.netFx = true;
  scene.tweens.add({
    targets: b, x: p.x + Math.cos(a) * len, y: p.y - 2 + Math.sin(a) * len, duration: 40 + len * 1.2,
    onComplete: () => { b.destroy(); scene.spawnParticles?.(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len, 0x7a4fd0, 4); }
  });
  audio.sfx('hex');
  if (z) { const r = rollDamage(scene, 'staff', BOLT_DMG * (1 + 0.3 * upLv('staff'))); hitTarget(scene, z, r.dmg, r.crit, p, 'staff'); }
}

// ---------- Cesetler ----------
function addCorpse(scene, z) {
  if (!anyNecro(scene) || z.x == null) return;
  const wisp = scene.add.image(z.x, z.y - 2, 'necro_wisp').setDepth(z.y + 6).setAlpha(0.85);
  scene.tweens.add({ targets: wisp, y: z.y - 6, alpha: 0.45, duration: 700, yoyo: true, repeat: -1 });
  S.corpses.push({ x: z.x, y: z.y, kind: z.isBoss ? 'boss' : z.kind, tex: z.texKey || 'zombie', t: scene.time.now, wisp });
  while (S.corpses.length > 20) removeCorpse(scene, S.corpses[0]);
}
function removeCorpse(scene, c) {
  S.corpses = S.corpses.filter((q) => q !== c);
  if (c.wisp?.active) { scene.tweens.killTweensOf(c.wisp); c.wisp.destroy(); }
}

// ---------- Başlangıç kiti / sınıf ----------
// Nekromant: başlangıç kılıcı asaya dönüşür (yalnız ilk kez; kayıttan dönüşte yapılmaz)
function giveKit(scene) {
  if (!PS || PS.kit) return;
  PS.kit = true;
  if (PS.cls !== 'necro') return;
  const inv = scene.inventory;
  const i = inv.slots.findIndex((x) => x?.id === 'sword');
  if (i >= 0) { inv.slots[i] = { ...inv.slots[i], id: 'staff' }; inv.emit(); } else inv.add('staff', 1);
}
function applyClass(scene) {
  if (!PS) return;
  if (scene.player) scene.player.cls = PS.cls;
  giveKit(scene);
}

// ---------- Nekromansi: ruh ve yükseltmeler ----------
// zombieKilled öldüren oyuncunun bağlamında yayılır (gölge vuruşları asOwner ile sahibin bağlamında): PS = öldüren
function gainSoul(z) {
  if (PS?.cls !== 'necro') return;
  PS.souls = (PS.souls || 0) + (z.isBoss ? SOUL.boss : SOUL[z.kind] || 1);
}

// Açık panel oyuncu başına (PS.panel; kayda yazılmaz) — co-op'ta host ve misafir aynı anda açabilir
function openNecro(scene) {
  if (!isNecro(scene.player)) { scene.hud.toast('Nekromansi yalnızca Nekromant sınıfına açık.', 'info'); return; }
  const body = el('div', 'nc-wrap');
  const ps = PS;
  scene.hud.openPanel('💀 Nekromansi', body, () => { ps.panel = null; });
  PS.panel = body;
  audio.sfx('click');
  renderNecro(scene);
}

function renderNecro(scene) {
  const body = PS?.panel;
  if (!body) return;
  const souls = PS.souls || 0;
  body.innerHTML = `<p class="nc-souls">🔮 Ruh Özü: <b>${souls}</b> <span class="muted">· senin ya da gölgelerinin öldürdüğü her zombi ruh bırakır (iri/zırhlı 3, boss 20)</span></p>
    <p class="muted">Ordu: ${mine(scene, keyOf(scene, scene.player)).length}/${capOf(scene)} gölge · diriltme ${raiseCost()} ⚡ · çağırma ${summonCost()} ⚡</p>`;
  for (const [k, u] of Object.entries(UPGRADES)) {
    const lv = upLv(k), max = u.cost.length, next = u.cost[lv];
    const row = el('div', 'nc-row', `<span class="ic">${u.icon}</span>
      <div class="tx"><b>${u.name}</b><span class="lv">${lv}/${max}</span><span class="muted">${lv ? u.desc(lv) : 'Henüz yok'}${lv < max ? ` → ${u.desc(lv + 1)}` : ''}</span></div>`);
    const b = el('button', 'nc-buy', lv >= max ? 'Tamam' : `🔮 ${next}`);
    if (lv >= max || souls < next) b.disabled = true;
    else b.addEventListener('click', () => buyUpgrade(scene, k));
    row.appendChild(b);
    body.appendChild(row);
  }
}

function buyUpgrade(scene, k) {
  const u = UPGRADES[k], lv = upLv(k), cost = u.cost[lv];
  if (!PS || cost == null || (PS.souls || 0) < cost) { audio.sfx('error'); return; }
  PS.souls -= cost;
  PS.up = { ...(PS.up || {}), [k]: lv + 1 };
  refreshMine(scene, keyOf(scene, scene.player));
  audio.sfx('quest');
  scene.spawnParticles?.(scene.player.x, scene.player.y - 6, 0x7a4fd0, 10);
  scene.hud.toast(`${u.icon} ${u.name} ${lv + 1}. seviye: ${u.desc(lv + 1)}`, 'ok');
  renderNecro(scene);
}

const NC_CSS = `
.nc-wrap { display: flex; flex-direction: column; gap: 8px; min-width: min(420px, 86vw); }
.nc-souls { font-size: 15px; } .nc-souls b { color: #c9a6ff; }
.nc-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(122, 79, 208, .12); border: 1px solid rgba(122, 79, 208, .3); }
.nc-row .ic { font-size: 22px; width: 28px; text-align: center; flex: none; }
.nc-row .tx { flex: 1; min-width: 0; } .nc-row .tx > span { display: block; font-size: 12px; }
.nc-row .tx > .lv { display: inline; margin-left: 6px; color: #c9a6ff; font-weight: 600; }
.nc-buy { flex: none; min-width: 64px; }`;

// ---------- HUD: aktif gölge sayısı ----------
function chip(text) {
  const box = document.getElementById('hud-extra');
  if (!box) return;
  let e = document.getElementById('nc-chip');
  if (!text) { e?.remove(); return; }
  if (!e) { e = document.createElement('span'); e.id = 'nc-chip'; e.title = 'Gölge askerler'; e.style.cssText = 'font-weight:600;white-space:nowrap'; box.appendChild(e); }
  if (e.textContent !== text) e.textContent = text;
}
const chipText = (scene) => (isNecro(scene.player) ? `💀 ${mine(scene, keyOf(scene, scene.player)).length}/${capOf(scene)} · 🔮 ${PS?.souls || 0}` : '');

export default {
  id: 'necro',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    S = { shadows: [], corpses: [], hudT: 0, host: null };
    PS = S.host = { cls: prefClass(), kit: false };
    if (scene.player) scene.player.cls = PS.cls;
    const onKill = (z) => { addCorpse(scene, z); gainSoul(z); renderNecro(scene); };
    scene.events.on('zombieKilled', onKill);
    scene.timeSys.on('dawn', () => {
      if (!S.shadows.length) return;
      const melt = S.shadows.filter((sh) => !sh.persist);
      melt.forEach((sh) => dissolve(scene, sh, true));
      if (melt.length) scene.toastAll?.('☀️ Gölge askerler güneşte eridi.', 'info');
    });
    scene.necro = { CLASSES, isNecro, capOf: () => capOf(scene), get ps() { return PS; }, upgrades: UPGRADES, get shadows() { return S.shadows; }, get corpses() { return S.corpses; } };
    scene.featureMenu.push({ id: 'necro', icon: '💀', label: 'Nekromansi', open: (s) => openNecro(s) });
    if (!document.getElementById('nc-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'nc-css', textContent: NC_CSS }));
    scene.events.once('shutdown', () => { scene.events.off('zombieKilled', onKill); chip(''); });
  },

  begin(scene, isNew) {
    if (scene.net?.isGuest) return;
    if (isNew) { S.host.cls = prefClass(); S.host.kit = false; }
    PS = S.host;
    applyClass(scene);
  },

  update(scene, dt) {
    if (scene.net?.isGuest) return;
    const now = scene.time.now;
    for (const c of S.corpses.slice()) if (now - c.t > CORPSE_TTL * 1000) removeCorpse(scene, c);
    const groups = new Map();
    for (const sh of S.shadows) { const k = sh.ownerKey || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(sh); }
    for (const list of groups.values()) list.forEach((sh, i) => { if (!sh.dead) tickShade(scene, sh, dt, i, list.length); });
    S.hudT -= dt;
    if (S.hudT <= 0) { S.hudT = 0.4; chip(chipText(scene)); }
  },

  save() { return { cls: S.host?.cls === 'necro' ? 'necro' : 'knight', souls: S.host?.souls || 0, up: S.host?.up || {} }; },
  load(scene, d) {
    S.host = { cls: d?.cls === 'necro' ? 'necro' : 'knight', kit: true, souls: d?.souls || 0, up: d?.up || {} };
    PS = S.host;
    if (scene.player) scene.player.cls = PS.cls;
  },

  // Co-op: sınıf oyuncu başına (host kaydında misafirin adıyla); yeni misafirin sınıfı hello.cls'den
  playerState: {
    get: () => PS,
    set: (_s, v) => { PS = v; },
    fresh: () => ({ cls: null, kit: false }),
    save: (v) => ({ cls: v?.cls === 'necro' ? 'necro' : 'knight', kit: true, souls: v?.souls || 0, up: v?.up || {} }),
    load: (_s, d) => ({ cls: d?.cls === 'necro' ? 'necro' : 'knight', kit: true, souls: d?.souls || 0, up: d?.up || {} }),
    apply: (s) => {
      if (!PS) return;
      if (!PS.cls) PS.cls = s.player?.helloCls === 'necro' ? 'necro' : 'knight';
      applyClass(s);
    }
  },

  netPlayerState(scene) { return chipText(scene); },
  netApplyPlayer(_scene, v) { chip(v || ''); }
};
