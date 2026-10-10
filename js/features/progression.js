// 'progression' özellik modülü — beceri XP'si, yetenek ağacı, başarımlar, istatistikler,
// alet yükseltmeleri ve çanta genişletme. Sözleşme için registry.js'e bak.
import { TILE, ITEMS, INV_SIZE } from '../config.js';
import { audio } from '../audio.js';
import { iconURL } from '../textures.js';
import { Zombie } from '../entities/Zombie.js';
import { injectCSS, el, topExtra } from '../ui/dom.js';

// ---------------- Veri tabloları ----------------
const MAX_LV = 10;
const need = (lv) => Math.round(100 * Math.pow(lv, 1.5)); // lv → lv+1 için gereken XP

const SKILLS = {
  farm:   { name: 'Çiftçilik',    icon: '🌾', color: '#8fd16a' },
  combat: { name: 'Savaş',        icon: '⚔️', color: '#ff7b6b' },
  gather: { name: 'Toplayıcılık', icon: '🪓', color: '#6fb6ff' }
};
const XP = { harvest: 5, zombie: 8, brute: 20, boss: 100, gather: 3 };

// Yetenek ağacı: 3 dal x 4 düğüm; her düğüm 1 puan, sırayla ve dal seviyesine bağlı açılır
const REQ_LV = [2, 4, 6, 8];
const TREE = [
  { id: 'f1', branch: 'farm', icon: '🌱', name: 'Yeşil Parmak', desc: 'Sulanan ekinler %10 daha hızlı büyür.' },
  { id: 'f2', branch: 'farm', icon: '🫘', name: 'Tutumlu Ekici', desc: 'Ekimde %25 şansla tohum harcanmaz.' },
  { id: 'f3', branch: 'farm', icon: '🧺', name: 'Bereket', desc: 'Hasatta %25 şansla +1 ürün.' },
  { id: 'f4', branch: 'farm', icon: '💹', name: 'Pazar Ustası', desc: 'Ekin ve yiyecekler %15 daha pahalıya satılır.' },
  { id: 'c1', branch: 'combat', icon: '❤️', name: 'Sağlam Yapı', desc: 'Maksimum can +20.' },
  { id: 'c2', branch: 'combat', icon: '💥', name: 'Savaş Öfkesi', desc: 'Zombilere verilen tüm hasar +%15.' },
  { id: 'c3', branch: 'combat', icon: '🪙', name: 'Ganimetçi', desc: 'Zombi altın ödülü +%50.' },
  { id: 'c4', branch: 'combat', icon: '🩸', name: 'Can Emici', desc: 'Öldürdüğün her zombi +2 can verir.' },
  { id: 'g1', branch: 'gather', icon: '🪵', name: 'Oduncu', desc: 'Ağaç kesince +1 odun.' },
  { id: 'g2', branch: 'gather', icon: '🪨', name: 'Taşçı', desc: 'Kaya kırınca +1 taş.' },
  { id: 'g3', branch: 'gather', icon: '⚡', name: 'Dayanıklılık', desc: 'Maksimum enerji +20.' },
  { id: 'g4', branch: 'gather', icon: '💎', name: 'Hazine Avcısı', desc: 'Kaynak toplarken %15 şansla 5–20 altın bulursun.' }
];
TREE.forEach((n) => { n.tier = TREE.filter((m) => m.branch === n.branch).indexOf(n); });

// Başarımlar: [id, ad, ikon, açıklama, ilerleme(st, P), hedef, altın ödülü]
const ACH = [
  ['first_harvest', 'İlk Hasat', '🌾', 'İlk ekinini hasat et.', (s) => s.harvests, 1, 10],
  ['harvest_50', 'Bereketli Toprak', '🧺', '50 hasat yap.', (s) => s.harvests, 50, 40],
  ['harvest_200', 'Toprak Ana', '🌻', '200 hasat yap.', (s) => s.harvests, 200, 120],
  ['first_kill', 'İlk Kan', '🗡️', 'İlk zombini öldür.', (s) => s.kills, 1, 10],
  ['kills_100', 'Zombi Avcısı', '💀', '100 zombi öldür.', (s) => s.kills, 100, 60],
  ['kills_500', 'Kıyamet Savaşçısı', '☠️', '500 zombi öldür.', (s) => s.kills, 500, 200],
  ['brute_10', 'Dev Avcısı', '👹', '10 iri zombi öldür.', (s) => s.brutes, 10, 60],
  ['boss_1', 'Bekçi Düştü', '👑', 'Bir boss zombiyi yen.', (s) => s.bosses, 1, 100],
  ['wave_5', 'Beşinci Gece', '🌙', '5. dalgayı atlat.', (s) => s.bestWave, 5, 50],
  ['wave_10', 'On Gece', '🌕', '10. dalgayı atlat.', (s) => s.bestWave, 10, 150],
  ['streak_5', 'Yılmaz', '🛡️', '5 gece üst üste bayılmadan hayatta kal.', (s) => s.bestStreak, 5, 80],
  ['night_25', 'Gece Bekçisi', '🔦', 'Tek gecede 25 zombi öldür.', (s) => s.bestNightKills, 25, 60],
  ['coins_1000', 'Tüccar Ruhu', '🪙', 'Toplam 1000 altın kazan.', (s) => s.coinsEarned, 1000, 50],
  ['coins_5000', 'Kasaba Zengini', '💰', 'Toplam 5000 altın kazan.', (s) => s.coinsEarned, 5000, 150],
  ['wood_100', 'Oduncu Ruhu', '🪵', '100 odun topla.', (s) => s.wood, 100, 30],
  ['stone_100', 'Taş Ocağı', '🪨', '100 taş topla.', (s) => s.stone, 100, 30],
  ['level_5', 'Usta', '⭐', 'Bir beceride 5. seviyeye ulaş.', (s, P) => Math.max(...Object.values(P.lv)), 5, 50],
  ['level_10', 'Efsane', '🌟', 'Bir beceride 10. seviyeye ulaş.', (s, P) => Math.max(...Object.values(P.lv)), 10, 200],
  ['tool_max', 'Demirci Dostu', '🔨', 'Bir aleti son seviyeye yükselt.', (s, P) => Math.max(P.tools.hoe, P.tools.can), 2, 40],
  ['bag_max', 'Büyük Çanta', '🎒', 'Çantanı 40 slota genişlet.', (s, P) => P.bag, 2, 40]
];

// Alet ve çanta yükseltmeleri
const TOOL_UP = {
  hoe: [
    { name: 'Bakır Çapa', area: '3x1', coins: 150, stone: 5, desc: 'Baktığın yönde 3 kare sürer.' },
    { name: 'Demir Çapa', area: '3x3', coins: 400, stone: 15, desc: 'Hedef etrafında 3x3 alan sürer.' }
  ],
  can: [
    { name: 'Bakır Sulama Kabı', area: '3x1', coins: 150, stone: 5, desc: 'Baktığın yönde 3 kare sular.' },
    { name: 'Demir Sulama Kabı', area: '3x3', coins: 400, stone: 15, desc: 'Hedef etrafında 3x3 alan sular.' }
  ]
};
const BAG_UP = [{ size: 32, coins: 300 }, { size: 40, coins: 800 }];

const STAT_DEFAULTS = {
  kills: 0, brutes: 0, bosses: 0, nightKills: 0, bestNightKills: 0,
  harvests: 0, grown: 0, tilled: 0, watered: 0, wood: 0, stone: 0, forage: 0,
  coinsEarned: 0, coinsSpent: 0, nights: 0, bestWave: 0, deaths: 0, streak: 0, bestStreak: 0,
  diedTonight: false, playTime: 0
};

// Genel ITEMS değişiklikleri (isim/açıklama/satış/onUse) yeni oyunda geri alınabilsin diye ilk hâl
let ORIG = null;
function captureOrig() {
  if (ORIG) return;
  ORIG = { sell: {}, hoe: { ...ITEMS.hoe }, can: { ...ITEMS.can } };
  Object.entries(ITEMS).forEach(([id, d]) => { if (d.sell) ORIG.sell[id] = d.sell; });
}
function restoreOrig() {
  for (const k of ['hoe', 'can']) {
    ITEMS[k].name = ORIG[k].name; ITEMS[k].desc = ORIG[k].desc;
    if (ORIG[k].onUse) ITEMS[k].onUse = ORIG[k].onUse; else delete ITEMS[k].onUse;
  }
  Object.entries(ORIG.sell).forEach(([id, v]) => { if (ITEMS[id]) ITEMS[id].sell = v; });
}

// Zombi hasar çarpanı (Savaş Öfkesi) — prototip bir kez sarılır, aktif sahnenin durumunu okur
let zombiePatched = false;
function patchZombie() {
  if (zombiePatched) return;
  zombiePatched = true;
  const orig = Zombie.prototype.takeDamage;
  Zombie.prototype.takeDamage = function (n, src) {
    const m = this.scene?.prog?.dmgMul || 1;
    if (m !== 1 && typeof n === 'number' && n > 0) {
      const v = n * m; // tam sayı hasarı koru: küsurat olasılıkla yuvarlanır
      n = Number.isInteger(n) ? Math.floor(v) + (Math.random() < v % 1 ? 1 : 0) : v;
    }
    return orig.call(this, n, src);
  };
}

// ---------------- Durum ----------------
function freshState() {
  return {
    xp: { farm: 0, combat: 0, gather: 0 }, lv: { farm: 1, combat: 1, gather: 1 }, points: 0,
    skills: new Set(), ach: new Set(), stats: { ...STAT_DEFAULTS }, tools: { hoe: 0, can: 0 }, bag: 0,
    dmgMul: 1, applied: { hp: 0, en: 0 }, panel: null, tab: 'skills', sel: null
  };
}
const has = (scene, id) => !!scene.prog?.skills.has(id);

// ---------------- XP ve seviye ----------------
function addXP(scene, skill, amt, x, y) {
  const P = scene.prog;
  if (!P || !SKILLS[skill]) return;
  if (P.lv[skill] >= MAX_LV) { checkAch(scene); return; }
  P.xp[skill] += amt;
  if (x != null) scene.floatText(x, y, `+${amt} XP`, '#c9a7ff');
  while (P.lv[skill] < MAX_LV && P.xp[skill] >= need(P.lv[skill])) {
    P.xp[skill] -= need(P.lv[skill]);
    P.lv[skill]++;
    P.points++;
    levelUp(scene, skill, P.lv[skill]);
  }
  if (P.lv[skill] >= MAX_LV) P.xp[skill] = 0;
  refreshBadge(scene);
  checkAch(scene);
}

function levelUp(scene, skill, level) {
  const S = SKILLS[skill];
  // Ses ve parıltı juice modülünde (levelUp olayı)
  scene.hud.banner(`${S.icon} ${S.name} Sv. ${level}`, `+1 yetenek puanı · Yetenekler menüsünden (L) harca`);
  scene.events.emit('levelUp', { skill, level });
  const p = scene.player;
  if (p?.alive) { p.restore(15, 15); scene.spawnParticles(p.x, p.y - 6, 0xffd166, 14); }
}

// ---------------- Başarımlar ----------------
function checkAch(scene) {
  const P = scene.prog;
  if (!P || P.checking) return;
  P.checking = true;
  try {
    for (const a of ACH) {
      if (P.ach.has(a[0])) continue;
      if (a[4](P.stats, P) >= a[5]) {
        P.ach.add(a[0]);
        scene.hud.toast(`🏆 Başarım: <b>${a[1]}</b> · +${a[6]} 🪙`, 'ok');
        audio.sfx('achievement');
        scene.player.addCoins(a[6]);
        scene.events.emit('achievement', { id: a[0], name: a[1] });
      }
    }
  } finally { P.checking = false; }
  refreshBadge(scene);
}

// ---------------- Yetenek etkileri ----------------
function applyEffects(scene) {
  const P = scene.prog, p = scene.player;
  // Can / enerji bonusları: önceki uygulanan farkı geri alıp yenisini ekle (idempotent)
  const hp = has(scene, 'c1') ? 20 : 0, en = has(scene, 'g3') ? 20 : 0;
  p.maxHp += hp - P.applied.hp; P.applied.hp = hp;
  p.maxEnergy += en - P.applied.en; P.applied.en = en;
  p.hp = Math.min(p.hp, p.maxHp); p.energy = Math.min(p.energy, p.maxEnergy);
  P.dmgMul = has(scene, 'c2') ? 1.15 : 1;
  // Satış fiyatları (genel tablo — yeni oyunda restoreOrig geri alır)
  const mul = has(scene, 'f4') ? 1.15 : 1;
  Object.entries(ORIG.sell).forEach(([id, v]) => {
    const t = ITEMS[id]?.type;
    if (t === 'crop' || t === 'food') ITEMS[id].sell = Math.round(v * mul);
  });
  syncTools(scene);
}

function canLearn(P, n) {
  if (P.skills.has(n.id) || P.points < 1) return false;
  if (P.lv[n.branch] < REQ_LV[n.tier]) return false;
  const prev = TREE.find((m) => m.branch === n.branch && m.tier === n.tier - 1);
  return !prev || P.skills.has(prev.id);
}

function learn(scene, n) {
  const P = scene.prog;
  if (!canLearn(P, n)) { audio.sfx('error'); return; }
  P.points--;
  P.skills.add(n.id);
  applyEffects(scene);
  audio.sfx('craft');
  scene.hud.toast(`Yetenek öğrenildi: ${n.icon} ${n.name}`, 'ok');
  refreshBadge(scene);
}

// ---------------- Alet yükseltmeleri (onUse sarmalama) ----------------
function areaTiles(scene, ctx, level) {
  const { tx, ty } = ctx;
  if (level >= 2) {
    const out = [[tx, ty]];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) out.push([tx + dx, ty + dy]);
    return out;
  }
  const p = scene.player;
  let dx = ctx.cx - p.x, dy = ctx.cy - (p.y + 4);
  if (Math.abs(dx) < 4 && Math.abs(dy) < 4) { dx = p.facing?.x || 1; dy = p.facing?.y || 0; }
  const step = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
  return [0, 1, 2].map((i) => [tx + step[0] * i, ty + step[1] * i]);
}

function toolUse(kind) {
  return (scene, ctx) => {
    const P = scene.prog, p = scene.player, farm = scene.farm;
    const level = P?.tools[kind] || 0;
    const orig = ORIG[kind].onUse;
    if (!ctx.inReach) { audio.sfx('error'); scene.hud.notice('Çok uzak'); return; }
    let tiles = areaTiles(scene, ctx, level);
    // Başka bir modülün orijinal davranışı varsa merkez kareyi ona bırak
    if (orig) { orig(scene, ctx); tiles = tiles.slice(1); }
    const ok = kind === 'hoe'
      ? ([x, y]) => farm.inZone(x, y) && !farm.get(x, y)
      : ([x, y]) => { const pl = farm.get(x, y); return pl && !pl.watered; };
    tiles = tiles.filter(ok);
    if (!tiles.length) {
      if (!orig && kind === 'hoe' && !farm.inZone(ctx.tx, ctx.ty)) { audio.sfx('error'); scene.hud.notice('Sadece çitle çevrili tarlada sürebilirsin'); }
      return;
    }
    // Enerji: ilk kare tam bedel, sonrakiler indirimli; yetmeyen kareler atlanır
    const first = orig ? (kind === 'hoe' ? 1 : 0.5) : (kind === 'hoe' ? 2 : 1), extra = kind === 'hoe' ? 1 : 0.5;
    const afford = p.energy >= first ? 1 + Math.floor((p.energy - first) / extra) : 0;
    if (!afford) { if (!orig) p.useEnergy(first); return; }
    tiles = tiles.slice(0, afford);
    p.useEnergy(first + extra * (tiles.length - 1));
    for (const [x, y] of tiles) {
      if (kind === 'hoe') farm.till(x, y); else farm.water(x, y);
      scene.spawnParticles(x * TILE + 8, y * TILE + 9, kind === 'hoe' ? 0x6e4b2e : 0x7ab0e6, 4);
    }
    P.stats[kind === 'hoe' ? 'tilled' : 'watered'] += tiles.length;
    p.actionCd = 0.35;
    if (!orig) audio.sfx(kind === 'hoe' ? 'till' : 'water');
  };
}
const TOOL_FN = { hoe: toolUse('hoe'), can: toolUse('can') };

function syncTools(scene) {
  for (const k of ['hoe', 'can']) {
    const lv = scene.prog.tools[k];
    if (lv > 0) {
      const up = TOOL_UP[k][lv - 1];
      ITEMS[k].onUse = TOOL_FN[k];
      ITEMS[k].name = up.name;
      ITEMS[k].desc = `${ORIG[k].desc} Alan: ${up.area}.`;
    } else {
      ITEMS[k].name = ORIG[k].name; ITEMS[k].desc = ORIG[k].desc;
      if (ORIG[k].onUse) ITEMS[k].onUse = ORIG[k].onUse; else delete ITEMS[k].onUse;
    }
  }
  scene.hud?.renderHotbar?.();
}

function buyTool(scene, k) {
  const P = scene.prog, p = scene.player, inv = scene.inventory;
  const up = TOOL_UP[k][P.tools[k]];
  if (!up) return;
  if (p.coins < up.coins || inv.count('stone') < up.stone) { audio.sfx('error'); scene.hud.toast('Yeterli altın veya taş yok!', 'warn'); return; }
  p.addCoins(-up.coins);
  inv.remove('stone', up.stone);
  P.tools[k]++;
  syncTools(scene);
  audio.sfx('craft');
  scene.hud.toast(`🔨 ${up.name} hazır! (${up.area} alan)`, 'ok');
  checkAch(scene);
}

function buyBag(scene) {
  const P = scene.prog, p = scene.player;
  const up = BAG_UP[P.bag];
  if (!up) return;
  if (p.coins < up.coins) { audio.sfx('error'); scene.hud.toast(`Çanta için ${up.coins} 🪙 gerekli`, 'warn'); return; }
  p.addCoins(-up.coins);
  P.bag++;
  scene.inventory.resize(up.size);
  audio.sfx('craft');
  scene.hud.toast(`🎒 Çanta genişledi: ${up.size} slot`, 'ok');
  checkAch(scene);
}

// ---------------- Arayüz ----------------
const CSS = `
#prog-badge{pointer-events:auto;display:inline-flex;align-items:center;gap:4px;padding:3px 9px;font-size:12px;border-radius:999px;position:relative;min-height:28px}
#prog-badge .dot{position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--red);color:#fff;font-size:10px;line-height:16px;font-weight:700;display:none}
#prog-badge.pts .dot{display:block}
.pg-tabs{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.pg-tabs button{min-height:38px;flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pg-tabs button.on{background:rgba(255,209,102,.22);border-color:rgba(255,209,102,.6)}
.pg-skills{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px}
.pg-sk{background:rgba(255,255,255,.05);border:1px solid var(--stroke);border-radius:10px;padding:8px;font-size:12px}
.pg-sk b{font-size:13px}.pg-sk .lv{float:right;color:var(--accent);font-weight:600}
.pg-bar{height:6px;background:rgba(255,255,255,.1);border-radius:4px;overflow:hidden;margin:6px 0 3px}
.pg-bar i{display:block;height:100%;border-radius:4px}
.pg-pts{font-size:13px;margin:6px 0 10px}.pg-pts b{color:var(--accent)}
.pg-tree{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.pg-col{display:flex;flex-direction:column;gap:6px}
.pg-node{min-height:54px;padding:6px 8px;text-align:left;display:flex;gap:6px;align-items:center;font-size:12px;line-height:1.2}
.pg-node .ic{font-size:20px;flex-shrink:0}.pg-node small{display:block;color:var(--muted);font-size:10px}
.pg-node.own{border-color:rgba(110,224,110,.7);background:rgba(110,224,110,.14)}
.pg-node.ready{border-color:rgba(255,209,102,.8);box-shadow:0 0 0 1px rgba(255,209,102,.35) inset}
.pg-node.lock{opacity:.55}
.pg-node.sel{outline:2px solid var(--blue);outline-offset:1px}
.pg-detail{margin-top:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,.06);display:flex;gap:10px;align-items:center;font-size:13px;min-height:58px}
.pg-detail div{flex:1}.pg-detail button{min-height:40px}
.pg-ach{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.pg-a{display:flex;gap:8px;align-items:center;padding:7px 9px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid var(--stroke);font-size:12px}
.pg-a .ic{font-size:20px}.pg-a div{flex:1;min-width:0}.pg-a small{color:var(--muted);display:block}
.pg-a.done{border-color:rgba(110,224,110,.6);background:rgba(110,224,110,.1)}
.pg-a:not(.done) .ic{filter:grayscale(1);opacity:.6}
.pg-stats{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:13px}
.pg-stats div{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.07)}
.pg-stats b{color:var(--accent)}
.pg-row{display:flex;gap:10px;align-items:center;padding:8px;border-radius:10px;background:rgba(255,255,255,.05);margin-bottom:6px;font-size:13px}
.pg-row img{width:32px;height:32px;image-rendering:pixelated}.pg-row .ic{font-size:26px;width:32px;text-align:center}
.pg-row div{flex:1}.pg-row small{color:var(--muted);display:block}.pg-row button{min-height:40px;white-space:nowrap}
.pg-invbar{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap}
.pg-invbar button{min-height:34px;font-size:12px;padding:6px 10px}
#modal-inventory.pg-big #inv-grid{max-height:min(46vh,360px);overflow-y:auto;padding-right:4px}
/* style.css'teki #modal-feature{width:560px} ID seçicisi mobil alt sayfa kuralını eziyor; panelimiz için düzelt */
body.is-touch.portrait #modal-feature:has(.pg-wrap){width:100%}
@media (max-width:600px){
 .pg-tabs{gap:4px}.pg-tabs button{padding:6px 4px;font-size:12px}
 .pg-skills{gap:5px}.pg-sk{padding:6px;font-size:11px}.pg-sk .lv{float:none;display:block}
 .pg-tree{gap:5px}.pg-node{flex-direction:column;text-align:center;gap:2px;padding:6px 4px;font-size:11px;min-height:64px}
 .pg-ach,.pg-stats{grid-template-columns:1fr}
}`;

function refreshBadge(scene) {
  const b = scene.prog?.badge;
  if (!b) return;
  const P = scene.prog;
  const total = P.lv.farm + P.lv.combat + P.lv.gather;
  b.firstChild.textContent = `⭐ ${total}`;
  b.lastChild.textContent = P.points;
  b.classList.toggle('pts', P.points > 0);
}

const TITLES = { skills: 'Yetenekler', ach: 'Başarımlar', stats: 'İstatistikler', shop: 'Atölye' };

function openPanel(scene, tab) {
  const P = scene.prog;
  if (!P || !scene.started || scene.gameOver) return;
  P.tab = tab;
  const body = el('div', 'pg-wrap');
  scene.hud.openPanel(TITLES[tab], body, () => { P.panel = null; });
  P.panel = body;
  audio.sfx('click');
  render(scene);
}

function render(scene) {
  const P = scene.prog, body = P.panel;
  if (!body) return;
  const title = document.querySelector('#modal-feature .feature-title');
  if (title) title.textContent = TITLES[P.tab];
  body.innerHTML = '';
  const tabs = el('div', 'pg-tabs');
  [['skills', '🌟 Yetenek'], ['ach', `🏆 ${P.ach.size}/${ACH.length}`], ['stats', '📊 İstatistik'], ['shop', '🔨 Atölye']].forEach(([id, label]) => {
    const b = el('button', P.tab === id ? 'on' : '', label);
    b.addEventListener('click', () => { P.tab = id; audio.sfx('click'); render(scene); });
    tabs.appendChild(b);
  });
  body.appendChild(tabs);
  ({ skills: renderSkills, ach: renderAch, stats: renderStats, shop: renderShop })[P.tab](scene, body);
}

function renderSkills(scene, body) {
  const P = scene.prog;
  const sk = el('div', 'pg-skills');
  Object.entries(SKILLS).forEach(([k, S]) => {
    const max = P.lv[k] >= MAX_LV;
    const pct = max ? 100 : Math.floor((P.xp[k] / need(P.lv[k])) * 100);
    sk.appendChild(el('div', 'pg-sk', `<span class="lv">Sv. ${P.lv[k]}</span><b>${S.icon} ${S.name}</b>
      <div class="pg-bar"><i style="width:${pct}%;background:${S.color}"></i></div>
      <span class="muted">${max ? 'Maksimum' : `${Math.floor(P.xp[k])}/${need(P.lv[k])} XP`}</span>`));
  });
  body.appendChild(sk);
  body.appendChild(el('div', 'pg-pts', `Harcanabilir yetenek puanı: <b>${P.points}</b> <span class="muted">· her seviye +1 puan</span>`));
  const tree = el('div', 'pg-tree');
  Object.keys(SKILLS).forEach((br) => {
    const col = el('div', 'pg-col');
    TREE.filter((n) => n.branch === br).forEach((n) => {
      const own = P.skills.has(n.id), ready = canLearn(P, n);
      const b = el('button', `pg-node ${own ? 'own' : ready ? 'ready' : 'lock'}${P.sel === n.id ? ' sel' : ''}`,
        `<span class="ic">${n.icon}</span><span>${n.name}<small>${own ? '✔ Açık' : `Sv. ${REQ_LV[n.tier]}`}</small></span>`);
      b.addEventListener('click', () => { P.sel = n.id; audio.sfx('click'); render(scene); });
      col.appendChild(b);
    });
    tree.appendChild(col);
  });
  body.appendChild(tree);
  // Seçili düğüm ayrıntısı (dokunmatikte hover olmadığı için)
  const n = TREE.find((m) => m.id === P.sel);
  const det = el('div', 'pg-detail');
  if (!n) det.innerHTML = '<div class="muted">Ayrıntı için bir yeteneğe dokun. Her sütun bir daldır; yetenekler yukarıdan aşağıya sırayla açılır.</div>';
  else {
    const own = P.skills.has(n.id), ready = canLearn(P, n);
    let why = '';
    if (!own && !ready) {
      if (P.lv[n.branch] < REQ_LV[n.tier]) why = `${SKILLS[n.branch].name} Sv. ${REQ_LV[n.tier]} gerekli.`;
      else if (P.points < 1) why = 'Yetenek puanın yok.';
      else why = 'Önce üstteki yeteneği aç.';
    }
    det.innerHTML = `<span style="font-size:26px">${n.icon}</span><div><b>${n.name}</b><br><span class="muted">${n.desc}</span>${why ? `<br><span style="color:var(--red);font-size:12px">${why}</span>` : ''}</div>`;
    const btn = el('button', ready ? 'primary' : '', own ? 'Öğrenildi' : 'Öğren (1 puan)');
    btn.disabled = !ready;
    btn.addEventListener('click', () => { learn(scene, n); render(scene); });
    det.appendChild(btn);
  }
  body.appendChild(det);
}

function renderAch(scene, body) {
  const P = scene.prog;
  const list = el('div', 'pg-ach');
  ACH.forEach(([id, name, icon, desc, prog, goal, reward]) => {
    const done = P.ach.has(id);
    const cur = Math.min(goal, Math.floor(prog(P.stats, P)));
    list.appendChild(el('div', `pg-a${done ? ' done' : ''}`, `<span class="ic">${icon}</span><div><b>${name}</b><small>${desc}</small>
      ${done ? '' : `<div class="pg-bar"><i style="width:${(cur / goal) * 100}%;background:var(--accent)"></i></div>`}</div>
      <small>${done ? '✔' : `${cur}/${goal}`}<br>${reward}🪙</small>`));
  });
  body.appendChild(list);
}

function renderStats(scene, body) {
  const s = scene.prog.stats;
  const mins = Math.floor(s.playTime / 60);
  const rows = [
    ['🧟 Öldürülen zombi', s.kills], ['👹 İri zombi', s.brutes], ['👑 Boss', s.bosses],
    ['🔦 Tek gecede en çok', s.bestNightKills], ['🌙 Atlatılan gece', s.nights], ['🌊 En yüksek dalga', s.bestWave],
    ['🛡️ Bayılmadan seri (şimdi)', s.streak], ['🏅 En uzun seri', s.bestStreak], ['💫 Bayılma', s.deaths],
    ['🌾 Hasat', s.harvests], ['🌱 Büyüyen ekin aşaması', s.grown], ['⛏️ Sürülen / sulanan', `${s.tilled} / ${s.watered}`],
    ['🪵 Odun', s.wood], ['🪨 Taş', s.stone], ['🍄 Toplanan', s.forage],
    ['🪙 Kazanılan altın', s.coinsEarned], ['💸 Harcanan altın', s.coinsSpent], ['⏱️ Oynama süresi', `${Math.floor(mins / 60)} sa ${mins % 60} dk`]
  ];
  body.appendChild(el('div', 'pg-stats', rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')));
}

function renderShop(scene, body) {
  const P = scene.prog, p = scene.player, inv = scene.inventory;
  body.appendChild(el('div', 'pg-pts', `Elinde: <b>${p.coins} 🪙</b> · <b>${inv.count('stone')}</b> taş`));
  for (const k of ['hoe', 'can']) {
    const lv = P.tools[k], up = TOOL_UP[k][lv];
    const row = el('div', 'pg-row', `<img src="${iconURL(scene, ORIG[k].icon)}" alt=""><div><b>${up ? up.name : ITEMS[k].name}</b>
      <small>${up ? `${up.desc} · ${up.coins}🪙 + ${up.stone} taş` : 'Son seviyede (3x3).'}</small></div>`);
    const b = el('button', up ? 'primary' : '', up ? 'Yükselt' : '✔ Maks');
    b.disabled = !up || p.coins < up.coins || inv.count('stone') < up.stone;
    b.addEventListener('click', () => { buyTool(scene, k); render(scene); });
    row.appendChild(b);
    body.appendChild(row);
  }
  const bu = BAG_UP[P.bag];
  const row = el('div', 'pg-row', `<span class="ic">🎒</span><div><b>Çanta (${inv.slots.length} slot)</b>
    <small>${bu ? `${bu.size} slota genişlet · ${bu.coins}🪙` : 'En büyük çanta.'}</small></div>`);
  const b = el('button', bu ? 'primary' : '', bu ? 'Genişlet' : '✔ Maks');
  b.disabled = !bu || p.coins < bu.coins;
  b.addEventListener('click', () => { buyBag(scene); render(scene); });
  row.appendChild(b);
  body.appendChild(row);
  const sort = el('div', 'pg-row', `<span class="ic">⇅</span><div><b>Çantayı sırala</b><small>Türe ve ada göre dizer, yığınları birleştirir (hotbar sabit kalır).</small></div>`);
  const sb = el('button', '', 'Sırala');
  sb.addEventListener('click', () => { sortBag(scene); scene.hud.toast('Çanta sıralandı', 'ok'); });
  sort.appendChild(sb);
  body.appendChild(sort);
}

// Sıralama sonrası seçili (yer değiştirme bekleyen) slot artık geçersiz
function sortBag(scene) {
  if (scene.hud) scene.hud.pickedSlot = null;
  scene.inventory.sort();
  audio.sfx('click');
}

// Envanter penceresine sıralama + çanta butonları
function buildInvBar(scene) {
  document.getElementById('pg-invbar')?.remove();
  const grid = document.getElementById('inv-grid');
  if (!grid) return;
  const bar = el('div', 'pg-invbar');
  bar.id = 'pg-invbar';
  const sort = el('button', '', '⇅ Sırala');
  sort.addEventListener('click', () => sortBag(scene));
  const bag = el('button', 'accent', '');
  bag.addEventListener('click', () => { buyBag(scene); updateInvBar(scene); });
  bar.append(sort, bag);
  grid.parentNode.insertBefore(bar, grid);
  scene.prog.invBag = bag;
  updateInvBar(scene);
}

function updateInvBar(scene) {
  const P = scene.prog, b = P?.invBag;
  if (!b) return;
  const up = BAG_UP[P.bag];
  b.textContent = up ? `🎒 Genişlet → ${up.size} slot (${up.coins}🪙)` : `🎒 ${scene.inventory.slots.length} slot (maks)`;
  b.disabled = !up;
  document.getElementById('modal-inventory')?.classList.toggle('pg-big', scene.inventory.slots.length > INV_SIZE);
}

// ---------------- Modül ----------------
export default {
  id: 'progression',

  init(scene) {
    captureOrig();
    restoreOrig();
    patchZombie();
    injectCSS('progression', CSS);
    const P = scene.prog = freshState();
    const st = P.stats;

    // Rozet (üst bar): toplam seviye + harcanmamış puan; dokununca yetenek paneli
    document.getElementById('prog-badge')?.remove();
    const badge = el('button', '', '<span></span><span class="dot"></span>');
    badge.id = 'prog-badge';
    badge.title = 'Yetenekler (L)';
    badge.addEventListener('click', () => { if (!scene.hud.isModalOpen()) openPanel(scene, 'skills'); });
    topExtra()?.appendChild(badge);
    P.badge = badge;
    refreshBadge(scene);
    buildInvBar(scene);
    scene.inventory.onChange(() => updateInvBar(scene));

    scene.featureMenu.push(
      { id: 'skills', icon: '🌟', label: 'Yetenekler', key: 'L', open: (s) => openPanel(s, 'skills') },
      { id: 'achievements', icon: '🏆', label: 'Başarımlar', key: 'J', open: (s) => openPanel(s, 'ach') },
      { id: 'workshop', icon: '🔨', label: 'Atölye', open: (s) => openPanel(s, 'shop') }
    );

    // Klavye: L yetenekler, J başarımlar (açıkken tekrar basınca kapanır)
    const onKey = (ev) => {
      if (!scene.started || scene.gameOver) return;
      const k = ev.key.toLowerCase();
      if (k !== 'l' && k !== 'j') return;
      const tab = k === 'l' ? 'skills' : 'ach';
      if (P.panel) { if (P.tab === tab) scene.hud.closeAll(); else { P.tab = tab; render(scene); } return; }
      if (scene.hud.isModalOpen()) return;
      openPanel(scene, tab);
    };
    scene.input.keyboard?.on('keydown', onKey);
    // GameScene'in temizlemediği (world modülü) olaylar: yalnızca kendi dinleyicilerimizi kaldır
    const onForage = (id, n) => { st.forage += n || 1; addXP(scene, 'gather', XP.gather); };
    const onFish = () => { st.forage++; addXP(scene, 'gather', XP.gather); };
    scene.events.on('foraged', onForage);
    scene.events.on('fishCaught', onFish);
    scene.events.once('shutdown', () => {
      scene.input.keyboard?.off('keydown', onKey);
      scene.events.off('foraged', onForage);
      scene.events.off('fishCaught', onFish);
      P.panel = null;
    });

    // --- Olay ve sistem kancaları ---
    const farm = scene.farm;
    const oAdvance = farm.advance.bind(farm);
    farm.advance = (m) => oAdvance(has(scene, 'f1') ? m * 1.1 : m);
    const oPlant = farm.plant.bind(farm);
    farm.plant = (tx, ty, type) => {
      const ok = oPlant(tx, ty, type);
      // Tohum korunur: çağıran sonra 1 tohum düşeceği için önceden 1 ekle
      if (ok && has(scene, 'f2') && Math.random() < 0.25 && ITEMS[`seed_${type}`]) {
        scene.inventory.add(`seed_${type}`, 1);
        scene.floatText(tx * TILE + 8, ty * TILE - 2, 'Tohum korundu', '#b8f28a');
      }
      return ok;
    };
    const oHarvest = farm.harvest.bind(farm);
    farm.harvest = (tx, ty) => {
      const r = oHarvest(tx, ty);
      if (r) {
        if (has(scene, 'f3') && Math.random() < 0.25) r.qty += 1;
        st.harvests++;
        addXP(scene, 'farm', XP.harvest, tx * TILE + 8, ty * TILE - 8);
      }
      return r;
    };
    // Kesim/kırma giveItem üzerinden gelir; görev ödülü, hediye, sandık gibi kaynaklar
    // bonus/XP vermesin diye yalnızca elde balta/kazma varken sayılır
    const oGive = scene.giveItem.bind(scene);
    scene.giveItem = (id, n) => {
      const sel = scene.inventory.slots[scene.selected]?.id;
      if ((id === 'wood' && sel === 'axe') || (id === 'stone' && sel === 'pickaxe')) {
        if (has(scene, id === 'wood' ? 'g1' : 'g2')) n += 1;
        st[id] += n;
        const p = scene.player;
        addXP(scene, 'gather', XP.gather, p.x, p.y - 20);
        if (has(scene, 'g4') && Math.random() < 0.15) {
          const c = Phaser.Math.Between(5, 20);
          p.addCoins(c);
          scene.floatText(p.x, p.y - 28, `💎 +${c}🪙`, '#ffd166');
        }
      }
      return oGive(id, n);
    };
    // Altın kazanç/harcama istatistiği
    const p = scene.player;
    const oCoins = p.addCoins.bind(p);
    p.addCoins = (n) => {
      oCoins(n);
      if (n > 0) st.coinsEarned += n; else if (n < 0) st.coinsSpent -= n;
      if (n > 0) checkAch(scene);
    };

    scene.events.on('zombieKilled', (z) => {
      st.kills++; st.nightKills++;
      st.bestNightKills = Math.max(st.bestNightKills, st.nightKills);
      const boss = z.kind === 'boss' || z.isBoss || z.boss === true;
      if (boss) st.bosses++; else if (z.kind === 'brute') st.brutes++;
      addXP(scene, 'combat', boss ? XP.boss : z.kind === 'brute' ? XP.brute : XP.zombie);
      const pl = scene.player;
      if (has(scene, 'c3') && z.reward && Phaser.Math.Distance.Between(z.x, z.y, pl.x, pl.y) < 260) pl.addCoins(Math.ceil(z.reward * 0.5));
      if (has(scene, 'c4') && pl.alive) pl.restore(2, 0);
    });
    scene.events.on('cropGrew', () => { st.grown++; });
    scene.events.on('waveStart', () => { st.nightKills = 0; st.diedTonight = false; });
    scene.events.on('waveEnd', (w) => {
      st.nights++;
      st.bestWave = Math.max(st.bestWave, w || 0);
      if (st.diedTonight) st.streak = 0; else st.streak++;
      st.bestStreak = Math.max(st.bestStreak, st.streak);
      st.diedTonight = false;
      addXP(scene, 'combat', 10 + 5 * (w || 0));
    });
    scene.events.on('playerDied', () => { st.deaths++; st.diedTonight = true; if (!scene.waves.active) st.streak = 0; });
    // Oyun sonu ekranına özet ekle (GameScene dinleyicisinden sonra çalışır)
    scene.events.on('shelterFallen', () => {
      const s = document.querySelector('#gameover .stats');
      if (s) s.textContent += ` · Hasat: ${st.harvests} · Kazanç: ${st.coinsEarned}🪙 · Başarım: ${P.ach.size}/${ACH.length} · Seviyeler: 🌾${P.lv.farm} ⚔️${P.lv.combat} 🪓${P.lv.gather}`;
    });
  },

  begin(scene) {
    applyEffects(scene);
    refreshBadge(scene);
    updateInvBar(scene);
  },

  update(scene, dt) {
    if (scene.prog) scene.prog.stats.playTime += dt;
  },

  save(scene) {
    const P = scene.prog;
    return {
      xp: { ...P.xp }, lv: { ...P.lv }, points: P.points, skills: [...P.skills], ach: [...P.ach],
      stats: { ...P.stats }, tools: { ...P.tools }, bag: P.bag
    };
  },

  load(scene, d) {
    const P = scene.prog;
    if (!P || !d || typeof d !== 'object') return;
    const num = (v, def, lo = 0, hi = Infinity) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
    for (const k of Object.keys(SKILLS)) {
      P.lv[k] = Math.floor(num(d.lv?.[k], 1, 1, MAX_LV));
      P.xp[k] = num(d.xp?.[k], 0);
    }
    P.points = Math.floor(num(d.points, 0));
    P.skills = new Set((d.skills || []).filter((id) => TREE.some((n) => n.id === id)));
    P.ach = new Set((d.ach || []).filter((id) => ACH.some((a) => a[0] === id)));
    Object.keys(STAT_DEFAULTS).forEach((k) => {
      const v = d.stats?.[k];
      if (typeof STAT_DEFAULTS[k] === 'boolean') P.stats[k] = !!v; else P.stats[k] = num(v, 0);
    });
    P.tools.hoe = Math.floor(num(d.tools?.hoe, 0, 0, 2));
    P.tools.can = Math.floor(num(d.tools?.can, 0, 0, 2));
    P.bag = Math.floor(num(d.bag, 0, 0, BAG_UP.length));
    if (P.bag > 0) scene.inventory.resize(BAG_UP[P.bag - 1].size);
    // begin() etkileri uygular
  }
};
