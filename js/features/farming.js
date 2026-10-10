// 'farming' özellik modülü — sözleşme için registry.js'e bak.
// Yeni ekinler, mevsim, kalite, gübre, fıskiye, korkuluk, karga, solma ve hasat efektleri.
import { TILE, ITEMS, CROPS, CROP_STAGES, RECIPES, SHOPS, QUESTS } from '../config.js';
import { addCanvas, R, drawRows } from '../textures.js';
import { iconURL } from '../textures.js';
import { audio } from '../audio.js';
import { canPlace, useSelected } from '../systems/PlayerActions.js';
import { SEASON_NAMES, QUALITY_SUFFIX, FERT_GROWTH } from '../systems/Farm.js';
import { el, injectCSS } from '../ui/dom.js';

// ---------------- Veri (modül yüklenirken config'e eklenir) ----------------
const NEW_CROPS = {
  tomato:     { name: 'Domates', item: 'tomato',     hoursPerStage: 6, yield: [1, 2], seedBack: 0, regrow: true, regrowHours: 30, seasons: ['spring', 'summer'], sell: 18, food: [4, 8],  seedCol: '#e04a3a', price: 20 },
  corn:       { name: 'Mısır',   item: 'corn',       hoursPerStage: 8, yield: [1, 2], seedBack: 0, regrow: true, regrowHours: 36, seasons: ['summer', 'autumn'], sell: 22, food: null,    seedCol: '#f2d33a', price: 30 },
  strawberry: { name: 'Çilek',   item: 'strawberry', hoursPerStage: 5, yield: [1, 3], seedBack: 0, regrow: true, regrowHours: 30, seasons: ['spring', 'summer'], sell: 28, food: [6, 12], seedCol: '#ff5c7a', price: 40 },
  potato:     { name: 'Patates', item: 'potato',     hoursPerStage: 5, yield: [1, 4], seedBack: 0, seasons: ['spring', 'autumn', 'winter'], sell: 14, food: null, seedCol: '#b98a52', price: 18 }
};

// Mevcut ekinlere mevsim (mevsim sistemi yoksa etkisiz)
Object.assign(CROPS.wheat, { seasons: ['spring', 'summer', 'autumn'] });
Object.assign(CROPS.carrot, { seasons: ['spring', 'autumn', 'winter'] });
Object.assign(CROPS.pumpkin, { seasons: ['summer', 'autumn'] });

for (const [type, d] of Object.entries(NEW_CROPS)) {
  CROPS[type] = { item: d.item, hoursPerStage: d.hoursPerStage, yield: d.yield, seedBack: d.seedBack, regrow: !!d.regrow, regrowHours: d.regrowHours, seasons: d.seasons };
  ITEMS[`seed_${type}`] = { name: `${d.name} Tohumu`, type: 'seed', crop: type, icon: `i_seed_${type}` };
  ITEMS[d.item] = d.food
    ? { name: d.name, type: 'food', icon: `i_${d.item}`, sell: d.sell, heal: d.food[0], energy: d.food[1] }
    : { name: d.name, type: 'crop', icon: `i_${d.item}`, sell: d.sell };
  SHOPS.merchant.push({ id: `seed_${type}`, qty: 5, price: d.price });
}

// Tohum açıklamaları: mevsim + çoklu hasat bilgisi
const seasonText = (list) => (list ? list.map((s) => SEASON_NAMES[s]).join(', ') : 'Her mevsim');
for (const type of Object.keys(CROPS)) {
  const seed = ITEMS[`seed_${type}`];
  const c = CROPS[type];
  if (!seed) continue;
  const total = c.hoursPerStage * (CROP_STAGES - 1);
  seed.desc = `${seasonText(c.seasons)} · ${total} saatte olgunlaşır${c.regrow ? ' · çoklu hasat' : ''}. Sulanmış toprağa ek.`;
}

// Gübre, fıskiye, korkuluk + yeni yemekler
Object.assign(ITEMS, {
  fertilizer: { name: 'Gübre',            type: 'farm',  icon: 'i_fertilizer', sell: 3, desc: 'Sürülmüş toprağa uygula: büyüme +%25, kaliteli ürün şansı artar.' },
  sprinkler:  { name: 'Fıskiye',          type: 'place', icon: 'sprinkler',    desc: 'Her şafakta çevresindeki 3x3 alanı sular. Tıklayarak yerleştir.' },
  sprinkler2: { name: 'Gelişmiş Fıskiye', type: 'place', icon: 'sprinkler2',   desc: 'Her şafakta çevresindeki 5x5 alanı sular. Tıklayarak yerleştir.' },
  scarecrow:  { name: 'Korkuluk',         type: 'place', icon: 'i_scarecrow',  desc: '4 tile çevresindeki ekinleri kargalardan korur. Tıklayarak yerleştir.' },
  baked_potato: { name: 'Fırın Patates',  type: 'food',  icon: 'i_baked_potato', sell: 40, heal: 30, energy: 30 },
  jam:        { name: 'Çilek Reçeli',     type: 'crop',  icon: 'i_jam',        sell: 110, desc: 'Tüccara iyi fiyata satılır.' },
  corn_bread: { name: 'Mısır Ekmeği',     type: 'food',  icon: 'i_corn_bread', sell: 55, heal: 35, energy: 45 },
  salad:      { name: 'Domates Salatası', type: 'food',  icon: 'i_salad',      sell: 50, heal: 40, energy: 25 }
});

// Kalite varyantları: ayrı eşya kimlikleri (X_s gümüş, X_g altın)
const QUALITY = [null, { name: 'Gümüş', mul: 1.25 }, { name: 'Altın', mul: 1.5 }];
const CROP_ITEMS = [...new Set(Object.values(CROPS).map((c) => c.item))];
for (const id of CROP_ITEMS) {
  const base = ITEMS[id];
  if (!base) continue;
  for (let q = 1; q <= 2; q++) {
    const Q = QUALITY[q];
    const it = { ...base, name: `${Q.name} ${base.name}`, icon: `${base.icon}${QUALITY_SUFFIX[q]}`, quality: q, baseItem: id, sell: Math.round((base.sell || 1) * Q.mul) };
    if (base.heal) it.heal = Math.round(base.heal * Q.mul);
    if (base.energy) it.energy = Math.round(base.energy * Q.mul);
    it.desc = `${Q.name} kalite · satış x${Q.mul}`;
    ITEMS[id + QUALITY_SUFFIX[q]] = it;
  }
}

RECIPES.push(
  { out: 'fertilizer', qty: 3, cost: { wood: 2, stone: 1 } },
  { out: 'sprinkler', qty: 1, cost: { stone: 3, wood: 2, ammo: 1 } },
  { out: 'sprinkler2', qty: 1, cost: { sprinkler: 1, stone: 4, ammo: 2 } },
  { out: 'scarecrow', qty: 1, cost: { wood: 6 } },
  { out: 'baked_potato', qty: 1, cost: { potato: 2 } },
  { out: 'salad', qty: 1, cost: { tomato: 2, carrot: 1 } },
  { out: 'corn_bread', qty: 1, cost: { corn: 2, wheat: 1 } },
  { out: 'jam', qty: 1, cost: { strawberry: 3 } }
);
SHOPS.merchant.push({ id: 'fertilizer', qty: 1, price: 10 });

QUESTS.push(
  { id: 'q_tomato', npc: 'farmer',   title: 'Kırmızı Hasat',  desc: 'Ayşe\'ye 6 domates getir.',  type: 'deliver', item: 'tomato', amount: 6, reward: { coins: 70, items: { sprinkler: 1 } } },
  { id: 'q_corn',   npc: 'merchant', title: 'Mısır Siparişi', desc: 'Kemal\'e 5 mısır getir.',    type: 'deliver', item: 'corn',   amount: 5, reward: { coins: 130, items: { fertilizer: 5 } } }
);

// ---------------- Durum (sahne başına sıfırlanır) ----------------
const SCARE_R = 4 * TILE;       // korkuluk koruma yarıçapı
const CROW_CHANCE = 0.03;       // günlük ekin kaybı şansı
const MAX_SPRINKLERS = 40, MAX_SCARECROWS = 12;
let st = { sprinklers: [], scarecrows: [] };

// ---------------- Dokular ----------------
function makeTextures(scene) {
  const P = (ctx, rows, pal, ox = 0, oy = 0) => drawRows(ctx, rows, pal, ox, oy);
  const sprout = (ctx, col) => { R(ctx, 7, 11, 2, 2, '#4f8f41'); R(ctx, 6, 10, 1, 1, col); R(ctx, 9, 10, 1, 1, col); };

  // Domates: kazıklı çalı, yeşil → kırmızı meyve
  for (let s = 0; s < 4; s++) addCanvas(scene, `crop_tomato_${s}`, 16, 16, (ctx) => {
    if (s === 0) return sprout(ctx, '#6fbf5a');
    R(ctx, 11, 16 - (4 + s * 3), 1, 4 + s * 3, '#8a5a3a');
    const h = 2 + s * 3;
    R(ctx, 7, 15 - h, 2, h, '#3f8f34');
    R(ctx, 5, 14 - h + 2, 6, 2, '#4f9f3e'); R(ctx, 4, 13 - Math.floor(h / 2), 8, 3, '#5aaa48');
    if (s >= 2) { R(ctx, 5, 9, 2, 2, s === 3 ? '#e04a3a' : '#8fcf5a'); R(ctx, 9, 11, 2, 2, s === 3 ? '#e04a3a' : '#8fcf5a'); }
    if (s === 3) { R(ctx, 6, 6, 2, 2, '#e04a3a'); R(ctx, 5, 9, 1, 1, '#ff8a7a'); R(ctx, 9, 11, 1, 1, '#ff8a7a'); }
  });
  // Mısır: uzun sap (16x24), olgunlukta sarı koçan
  for (let s = 0; s < 4; s++) addCanvas(scene, `crop_corn_${s}`, 16, 24, (ctx) => {
    if (s === 0) { R(ctx, 7, 19, 2, 2, '#4f8f41'); R(ctx, 6, 18, 1, 1, '#7cc455'); R(ctx, 9, 18, 1, 1, '#7cc455'); return; }
    const h = [0, 8, 16, 20][s];
    R(ctx, 7, 23 - h, 2, h, '#4f9f3e');
    for (let y = 23 - h + 3; y < 22; y += 4) { R(ctx, 4, y, 3, 1, '#6fbf5a'); R(ctx, 9, y + 2, 3, 1, '#6fbf5a'); }
    if (s >= 2) R(ctx, 6, 23 - h, 4, 2, '#d9c08a');
    if (s === 3) { R(ctx, 9, 9, 3, 6, '#f2d33a'); R(ctx, 9, 9, 1, 6, '#c9a443'); R(ctx, 11, 8, 2, 2, '#6fbf5a'); R(ctx, 4, 12, 3, 5, '#f2d33a'); R(ctx, 6, 12, 1, 5, '#c9a443'); }
  });
  // Çilek: alçak çalı, beyaz çiçek → kırmızı meyve
  for (let s = 0; s < 4; s++) addCanvas(scene, `crop_strawberry_${s}`, 16, 16, (ctx) => {
    if (s === 0) return sprout(ctx, '#5aaa48');
    const w = 4 + s * 2;
    R(ctx, 8 - w / 2, 14 - s * 2, w, s * 2, '#3f8f34');
    R(ctx, 8 - w / 2 + 1, 13 - s * 2, w - 2, 1, '#5aaa48');
    if (s === 2) { R(ctx, 5, 10, 1, 1, '#ffffff'); R(ctx, 10, 9, 1, 1, '#ffffff'); }
    if (s === 3) {
      for (const [x, y] of [[4, 11], [8, 12], [11, 10]]) { R(ctx, x, y, 2, 2, '#ff3b5c'); R(ctx, x, y + 2, 1, 1, '#d42a46'); R(ctx, x, y, 1, 1, '#ffd34d'); }
    }
  });
  // Patates: yapraklı çalı, olgunlukta mor çiçek + toprakta patates
  for (let s = 0; s < 4; s++) addCanvas(scene, `crop_potato_${s}`, 16, 16, (ctx) => {
    if (s === 0) return sprout(ctx, '#7cc455');
    const h = 2 + s * 2;
    R(ctx, 4, 14 - h, 8, h, '#4f9f3e'); R(ctx, 3, 15 - h, 10, 2, '#5aaa48');
    if (s === 3) { R(ctx, 5, 6, 2, 2, '#b06ad9'); R(ctx, 9, 7, 2, 2, '#b06ad9'); R(ctx, 3, 13, 3, 2, '#b98a52'); R(ctx, 11, 14, 3, 2, '#b98a52'); }
  });
  // Kurumuş ekin
  addCanvas(scene, 'crop_dead', 16, 16, (ctx) => {
    for (const [x, h] of [[4, 5], [7, 7], [10, 4], [12, 3]]) { R(ctx, x, 14 - h, 1, h, '#8a7550'); R(ctx, x - 1, 14 - h, 1, 1, '#6b5a3a'); }
    R(ctx, 3, 13, 10, 1, '#6b5a3a');
  });
  // Gübre izi
  addCanvas(scene, 'fert_dots', 16, 16, (ctx) => {
    for (const [x, y] of [[2, 3], [6, 12], [11, 5], [13, 13], [8, 8], [3, 10]]) R(ctx, x, y, 1, 1, '#2a1a0e');
    for (const [x, y] of [[4, 6], [12, 9]]) R(ctx, x, y, 1, 1, '#a6c94a');
  });

  // Fıskiyeler (16x16, aynı zamanda ikon)
  const sprink = (key, head) => addCanvas(scene, key, 16, 16, (ctx) => {
    R(ctx, 4, 11, 8, 4, '#5a5d66'); R(ctx, 4, 11, 8, 1, '#8d8f99');
    R(ctx, 7, 5, 2, 6, '#9aa3ad');
    R(ctx, 5, 4, 6, 2, head); R(ctx, 4, 5, 1, 1, '#7ab0e6'); R(ctx, 11, 5, 1, 1, '#7ab0e6');
    R(ctx, 2, 3, 1, 1, '#7ab0e6'); R(ctx, 13, 3, 1, 1, '#7ab0e6');
  });
  sprink('sprinkler', '#4f8fd0');
  sprink('sprinkler2', '#e8c867');

  // Korkuluk (16x24 dünya, 16x16 ikon)
  const scarePal = { H: '#c9a443', h: '#8a6a2a', S: '#e8c89a', E: '#1b1622', C: '#c94040', c: '#8a2a2a', W: '#8a5a3a', Y: '#e8c867' };
  const scareRows = [
    '................',
    '......HHHH......',
    '....HHHHHHHH....',
    '.....hhhhhh.....',
    '.....SSSSSS.....',
    '.....SESSES.....',
    '.....SSSSSS.....',
    '.......WW.......',
    '.YCCCCCCCCCCCCY.',
    '..CCCCCCCCCCCC..',
    '.....CccccC.....',
    '.....CCCCCC.....',
    '.....CCCCCC.....',
    '.....YYYYYY.....',
    '.......WW.......',
    '.......WW.......',
    '.......WW.......',
    '.......WW.......',
    '.......WW.......',
    '.......WW.......',
    '.......WW.......',
    '......WWWW......',
    '.....W.WW.W.....',
    '................'
  ];
  addCanvas(scene, 'scarecrow', 16, 24, (ctx) => P(ctx, scareRows, scarePal));
  addCanvas(scene, 'i_scarecrow', 16, 16, (ctx) => P(ctx, scareRows.slice(0, 16), scarePal));

  // Karga
  addCanvas(scene, 'crow', 10, 8, (ctx) => {
    R(ctx, 2, 3, 6, 3, '#1b1622'); R(ctx, 7, 2, 2, 2, '#1b1622'); R(ctx, 9, 3, 1, 1, '#e8c867');
    R(ctx, 0, 1, 4, 2, '#2a2a3a'); R(ctx, 3, 6, 1, 2, '#e8c867'); R(ctx, 5, 6, 1, 2, '#e8c867');
  });

  // İkonlar
  const icon = (key, fn) => addCanvas(scene, key, 16, 16, fn);
  const seed = (key, col) => icon(key, (ctx) => { R(ctx, 4, 3, 8, 11, '#d9c08a'); R(ctx, 4, 3, 8, 2, '#b39e74'); R(ctx, 6, 7, 4, 4, col); });
  for (const [type, d] of Object.entries(NEW_CROPS)) seed(`i_seed_${type}`, d.seedCol);
  icon('i_tomato', (ctx) => { R(ctx, 3, 5, 10, 9, '#e04a3a'); R(ctx, 2, 7, 12, 5, '#e04a3a'); R(ctx, 4, 6, 2, 2, '#ff8a7a'); R(ctx, 6, 3, 4, 2, '#4f9f3e'); R(ctx, 7, 2, 2, 1, '#3f8f34'); });
  icon('i_corn', (ctx) => { R(ctx, 6, 2, 5, 11, '#f2d33a'); for (let y = 3; y < 13; y += 2) R(ctx, 7, y, 3, 1, '#c9a443'); R(ctx, 3, 6, 3, 9, '#6fbf5a'); R(ctx, 11, 6, 3, 9, '#5aaa48'); R(ctx, 7, 13, 3, 2, '#6fbf5a'); });
  icon('i_strawberry', (ctx) => { R(ctx, 3, 5, 10, 5, '#ff3b5c'); R(ctx, 4, 10, 8, 2, '#ff3b5c'); R(ctx, 6, 12, 4, 2, '#ff3b5c'); for (const [x, y] of [[5, 7], [9, 6], [7, 10], [10, 9]]) R(ctx, x, y, 1, 1, '#ffd34d'); R(ctx, 4, 3, 8, 2, '#4f9f3e'); R(ctx, 7, 1, 2, 2, '#3f8f34'); });
  icon('i_potato', (ctx) => { R(ctx, 3, 5, 10, 8, '#b98a52'); R(ctx, 4, 4, 7, 10, '#b98a52'); R(ctx, 4, 5, 3, 2, '#d9ab72'); for (const [x, y] of [[6, 9], [10, 7], [9, 11]]) R(ctx, x, y, 1, 1, '#7a5a32'); });
  icon('i_fertilizer', (ctx) => { R(ctx, 3, 4, 10, 11, '#8a6a3a'); R(ctx, 4, 3, 8, 2, '#6b4a2f'); R(ctx, 3, 4, 10, 1, '#a8814f'); R(ctx, 6, 8, 4, 4, '#4f9f3e'); R(ctx, 7, 7, 2, 1, '#6fbf5a'); });
  icon('i_baked_potato', (ctx) => { R(ctx, 2, 10, 12, 4, '#e6edf3'); R(ctx, 3, 6, 10, 6, '#b98a52'); R(ctx, 5, 6, 6, 2, '#f2e086'); R(ctx, 7, 5, 2, 1, '#ffffff'); });
  icon('i_jam', (ctx) => { R(ctx, 4, 5, 8, 9, '#d42a46'); R(ctx, 4, 5, 8, 1, '#ff5c7a'); R(ctx, 3, 2, 10, 3, '#e8c867'); R(ctx, 5, 8, 2, 2, '#ff8a9a'); });
  icon('i_corn_bread', (ctx) => { R(ctx, 2, 6, 12, 7, '#e0b040'); R(ctx, 3, 5, 10, 2, '#f2d33a'); for (const x of [4, 8, 11]) R(ctx, x, 8, 2, 1, '#c9902a'); });
  icon('i_salad', (ctx) => { R(ctx, 2, 8, 12, 5, '#e6edf3'); R(ctx, 3, 6, 10, 3, '#5aaa48'); R(ctx, 5, 5, 2, 2, '#e04a3a'); R(ctx, 9, 6, 2, 2, '#e04a3a'); R(ctx, 7, 7, 2, 1, '#e8792b'); });

  // Kalite ikonları: temel ikon + köşede yıldız
  const STAR = ['..X..', '.XXX.', 'XXXXX', '.XXX.', '.X.X.'];
  const qcol = ['', '#dfe6ef', '#ffd34d'];
  for (const id of CROP_ITEMS) {
    const baseKey = ITEMS[id]?.icon;
    if (!baseKey || !scene.textures.exists(baseKey)) continue;
    for (let q = 1; q <= 2; q++) {
      addCanvas(scene, baseKey + QUALITY_SUFFIX[q], 16, 16, (ctx) => {
        const src = scene.textures.get(baseKey).getSourceImage();
        ctx.drawImage(src, 0, 0, 16, 16, 0, 0, 16, 16);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) P(ctx, STAR, { X: '#1b1622' }, 11 + dx, 11 + dy);
        P(ctx, STAR, { X: qcol[q] }, 11, 11);
      });
    }
  }
}

// ---------------- Yerleştirilebilir nesneler ----------------
function tileOf(x, y) { return { tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) }; }

function makeObject(scene, kind, tx, ty, lvl = 1) {
  const cx = tx * TILE + 8, cy = ty * TILE + 8;
  const isScare = kind === 'scarecrow';
  const tex = isScare ? 'scarecrow' : (lvl >= 2 ? 'sprinkler2' : 'sprinkler');
  const sprite = scene.add.image(cx, isScare ? cy + 8 : cy + 4, tex).setOrigin(0.5, isScare ? 1 : 0.75).setDepth(cy + 4);
  const zone = scene.add.zone(cx, cy + 2, 10, 8);
  st.blockers.add(zone);
  const o = { kind, tx, ty, x: cx, y: cy, lvl, sprite, zone };
  (isScare ? st.scarecrows : st.sprinklers).push(o);
  scene.farm.blocked.add(scene.farm.key(tx, ty));
  return o;
}

function removeObject(scene, o) {
  o.sprite.destroy();
  o.zone.destroy();
  const list = o.kind === 'scarecrow' ? st.scarecrows : st.sprinklers;
  const i = list.indexOf(o);
  if (i >= 0) list.splice(i, 1);
  scene.farm.blocked.delete(scene.farm.key(o.tx, o.ty));
}

function clearObjects(scene) {
  [...st.sprinklers, ...st.scarecrows].forEach((o) => removeObject(scene, o));
}

function rangeRing(scene, x, y, r, color) {
  const g = scene.add.graphics().setDepth(9400);
  g.lineStyle(1, color, 0.9).strokeCircle(x, y, r);
  g.fillStyle(color, 0.12).fillCircle(x, y, r);
  scene.tweens.add({ targets: g, alpha: 0, duration: 1600, delay: 600, onComplete: () => g.destroy() });
}

function rangeRect(scene, x, y, half, color) {
  const g = scene.add.graphics().setDepth(9400);
  const s = (half * 2 + 1) * TILE;
  g.lineStyle(1, color, 0.9).strokeRect(x - s / 2, y - s / 2, s, s);
  g.fillStyle(color, 0.12).fillRect(x - s / 2, y - s / 2, s, s);
  scene.tweens.add({ targets: g, alpha: 0, duration: 1600, delay: 600, onComplete: () => g.destroy() });
}

function placeOnUse(kind, lvl) {
  return (scene, ctx) => {
    const fail = (msg) => { audio.sfx('error'); scene.hud.notice(msg); };
    const isScare = kind === 'scarecrow';
    const list = isScare ? st.scarecrows : st.sprinklers;
    if (list.length >= (isScare ? MAX_SCARECROWS : MAX_SPRINKLERS)) return fail('Bu nesneden daha fazla yerleştiremezsin');
    if (!canPlace(scene, ctx.cx, ctx.cy)) return fail('Buraya yerleştirilemez');
    if (scene.farm.blocked.has(scene.farm.key(ctx.tx, ctx.ty))) return fail('Burada zaten bir şey var');
    const id = ctx.slot.id;
    if (!scene.inventory.remove(id, 1)) return;
    const o = makeObject(scene, kind, ctx.tx, ctx.ty, lvl);
    scene.player.actionCd = 0.3;
    audio.sfx('place');
    if (isScare) { rangeRing(scene, o.x, o.y, SCARE_R, 0xe8c867); scene.hud.toast('Korkuluk kargaları uzak tutacak', 'ok'); }
    else { rangeRect(scene, o.x, o.y, lvl >= 2 ? 2 : 1, 0x7ab0e6); scene.hud.toast('Fıskiye her şafakta çevresini sular', 'ok'); }
  };
}

// Gübre: sürülmüş toprağa uygulanır
function fertilizeOnUse(scene, ctx) {
  const fail = (msg) => { audio.sfx('error'); if (msg) scene.hud.notice(msg); };
  if (!ctx.inReach) return fail('Çok uzak');
  const plot = scene.farm.get(ctx.tx, ctx.ty);
  if (!plot) return fail('Önce çapa ile toprağı sür');
  if (plot.crop?.dead) return fail('Önce kurumuş ekini temizle');
  if (plot.fert) return fail('Bu toprak zaten gübreli');
  if (!scene.farm.fertilize(ctx.tx, ctx.ty)) return;
  scene.inventory.remove(ctx.slot.id, 1);
  scene.player.actionCd = 0.25;
  scene.spawnParticles(ctx.cx, ctx.cy + 2, 0x5a3a20, 8);
  scene.floatText(ctx.cx, ctx.cy - 6, 'Gübrelendi', '#a6e07a');
  audio.sfx('plant');
}

ITEMS.fertilizer.onUse = fertilizeOnUse;
ITEMS.sprinkler.onUse = placeOnUse('sprinkler', 1);
ITEMS.sprinkler2.onUse = placeOnUse('sprinkler', 2);
ITEMS.scarecrow.onUse = placeOnUse('scarecrow', 1);

// Fıskiye / korkuluk paneli (topla, yükselt)
const UPGRADE_COST = { stone: 4, ammo: 2 };
function openObjectPanel(scene, o) {
  const isScare = o.kind === 'scarecrow';
  const body = el('div', 'farm-panel');
  const itemId = isScare ? 'scarecrow' : (o.lvl >= 2 ? 'sprinkler2' : 'sprinkler');
  const info = isScare
    ? `Çevresindeki ${SCARE_R / TILE} tile içindeki ekinleri kargalardan korur.`
    : `Her şafakta ${o.lvl >= 2 ? '5x5' : '3x3'} alanı otomatik sular.`;
  body.appendChild(el('div', 'shop-row', `<img src="${iconURL(scene, ITEMS[itemId].icon)}" alt=""><div class="rinfo"><b>${ITEMS[itemId].name}</b><span class="muted">${info}</span></div>`));
  const btns = el('div', 'farm-btns');
  if (!isScare && o.lvl < 2) {
    const ok = scene.inventory.has(UPGRADE_COST);
    const up = el('button', 'primary', `Yükselt (5x5) · ${UPGRADE_COST.stone} taş + ${UPGRADE_COST.ammo} mermi`);
    up.disabled = !ok;
    up.addEventListener('click', () => {
      if (!scene.inventory.has(UPGRADE_COST)) return;
      Object.entries(UPGRADE_COST).forEach(([id, n]) => scene.inventory.remove(id, n));
      o.lvl = 2;
      o.sprite.setTexture('sprinkler2');
      audio.sfx('craft');
      scene.hud.toast('Fıskiye yükseltildi: 5x5 sulama', 'ok');
      scene.hud.closeAll();
      rangeRect(scene, o.x, o.y, 2, 0x7ab0e6);
    });
    btns.appendChild(up);
  }
  const take = el('button', '', 'Topla');
  take.addEventListener('click', () => {
    if (scene.inventory.add(itemId, 1) > 0) { scene.hud.toast('Envanter dolu!', 'warn'); audio.sfx('error'); return; }
    removeObject(scene, o);
    audio.sfx('place');
    scene.hud.closeAll();
  });
  btns.appendChild(take);
  const show = el('button', '', 'Alanı göster');
  show.addEventListener('click', () => {
    scene.hud.closeAll();
    if (isScare) rangeRing(scene, o.x, o.y, SCARE_R, 0xe8c867); else rangeRect(scene, o.x, o.y, o.lvl >= 2 ? 2 : 1, 0x7ab0e6);
  });
  btns.appendChild(show);
  body.appendChild(btns);
  scene.hud.openPanel(isScare ? 'Korkuluk' : 'Fıskiye', body);
}

// ---------------- Şafak olayları ----------------
function runSprinklers(scene) {
  const view = scene.cameras.main.worldView;
  let n = 0;
  for (const o of st.sprinklers) {
    const r = o.lvl >= 2 ? 2 : 1;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (scene.farm.water(o.tx + dx, o.ty + dy)) n++;
    }
    if (view.contains(o.x, o.y)) {
      scene.spawnParticles(o.x, o.y - 4, 0x7ab0e6, 8);
      scene.tweens.add({ targets: o.sprite, scaleY: 0.85, duration: 120, yoyo: true, repeat: 2 });
    }
  }
  return n;
}

function protectedByScarecrow(x, y) {
  for (const s of st.scarecrows) {
    const dx = s.x - x, dy = s.y - y;
    if (dx * dx + dy * dy <= SCARE_R * SCARE_R) return true;
  }
  return false;
}

function crowAttack(scene) {
  const eaten = [];
  for (const p of scene.farm.plots.values()) {
    if (!p.crop || p.crop.dead) continue;
    const x = p.tx * TILE + 8, y = p.ty * TILE + 8;
    if (protectedByScarecrow(x, y)) continue;
    if (Math.random() < CROW_CHANCE) eaten.push(p);
  }
  eaten.forEach((p, i) => {
    p.crop = null;
    p.fert = 0;
    scene.farm.refresh(p);
    if (i < 3) flyCrow(scene, p.tx * TILE + 8, p.ty * TILE + 6, i * 250);
  });
  if (eaten.length) scene.hud.toast(`Kargalar ${eaten.length} ekinini yedi! Korkuluk yap (6 odun).`, 'warn');
}

function flyCrow(scene, x, y, delay) {
  const dir = Math.random() < 0.5 ? -1 : 1;
  const c = scene.add.image(x, y, 'crow').setDepth(9300).setFlipX(dir < 0).setAlpha(0);
  scene.tweens.add({
    targets: c, alpha: 1, delay, duration: 150,
    onComplete: () => scene.tweens.add({ targets: c, x: x + dir * 140, y: y - 90, alpha: 0, duration: 1400, ease: 'Quad.easeIn', onComplete: () => c.destroy() })
  });
}

function onDawn(scene) {
  // Farm.onDawn (GameScene) önce çalışır: kuraklık sayacı ve toprak kuruması
  let withered = 0;
  for (const p of scene.farm.plots.values()) if (scene.farm.isWithered(p)) withered++;
  const watered = runSprinklers(scene);
  crowAttack(scene);
  if (watered) scene.time.delayedCall(2600, () => scene.hud?.toast(`Fıskiyeler ${watered} tarlayı suladı 💧`, 'info'));
  if (withered) scene.time.delayedCall(3600, () => scene.hud?.toast(`${withered} ekin soluyor! Sulamazsan yarın kuruyacak.`, 'warn'));
}

// ---------------- Hasat efekti ----------------
function onHarvest(scene, e) {
  if (!e) return;
  const it = ITEMS[e.item];
  if (!it || !scene.textures.exists(it.icon)) return;
  // Ürün tarladan zıplar ve kaybolur
  const img = scene.add.image(e.x, e.y, it.icon).setDepth(15000).setScale(0.75);
  scene.tweens.add({ targets: img, y: e.y - 14, duration: 220, ease: 'Quad.easeOut', yoyo: true, onComplete: () => {
    scene.tweens.add({ targets: img, alpha: 0, scale: 0.4, duration: 200, onComplete: () => img.destroy() });
  } });
  if (e.quality > 0) {
    scene.spawnParticles(e.x, e.y - 6, e.quality === 2 ? 0xffd34d : 0xdfe6ef, e.quality === 2 ? 12 : 8);
    scene.time.delayedCall(250, () => scene.floatText(e.x, e.y - 18, e.quality === 2 ? '★ Altın kalite!' : '☆ Gümüş kalite', e.quality === 2 ? '#ffd34d' : '#dfe6ef'));
    if (e.quality === 2) audio.sfx('coin');
  }
}

// ---------------- Etkileşimler ----------------
function cropInteraction(scene) {
  const pl = scene.player;
  if (!pl?.alive) return null;
  const px = pl.x, py = pl.y + 4;
  const { tx, ty } = tileOf(px, py);
  let best = null, bestD = 24;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const p = scene.farm.get(tx + dx, ty + dy);
    if (!p || !p.crop || !scene.farm.isRipe(p.tx, p.ty)) continue;
    const d = Math.hypot(p.tx * TILE + 8 - px, p.ty * TILE + 8 - py);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) return null;
  const p = best;
  if (p.crop.dead) return { dist: bestD, label: 'Kurumuş ekini temizle', run: () => { scene.farm.clearDead(p); audio.sfx('till'); } };
  const name = ITEMS[CROPS[p.crop.type].item]?.name || 'Ekin';
  return { dist: bestD, label: `Hasat et · ${name}`, run: () => useSelected(scene, p.tx * TILE + 8, p.ty * TILE + 8) };
}

function objectInteraction(scene) {
  const pl = scene.player;
  if (!pl?.alive) return null;
  let best = null, bestD = 20;
  for (const list of [st.sprinklers, st.scarecrows]) for (const o of list) {
    const d = Math.hypot(o.x - pl.x, o.y - pl.y);
    if (d < bestD) { bestD = d; best = o; }
  }
  if (!best) return null;
  const o = best;
  return { dist: bestD + 2, label: o.kind === 'scarecrow' ? 'Korkuluk' : 'Fıskiye', run: () => openObjectPanel(scene, o) };
}

// ---------------- Tarla Defteri paneli ----------------
function openFarmBook(scene) {
  const farm = scene.farm;
  const season = farm.season();
  const s = { plots: 0, crops: 0, ripe: 0, dry: 0, withered: 0, dead: 0, fert: 0 };
  for (const p of farm.plots.values()) {
    s.plots++;
    if (p.fert) s.fert++;
    if (!p.crop) continue;
    if (p.crop.dead) { s.dead++; continue; }
    s.crops++;
    if (p.crop.stage >= CROP_STAGES - 1) s.ripe++;
    if (!p.watered) s.dry++;
    if (farm.isWithered(p)) s.withered++;
  }
  const body = el('div', 'farm-panel');
  body.appendChild(el('div', 'farm-stats',
    `<div><b>${season ? SEASON_NAMES[season] : 'Mevsim yok'}</b><span>Mevsim</span></div>` +
    `<div><b>${s.crops}</b><span>Ekin</span></div><div><b>${s.ripe}</b><span>Olgun</span></div>` +
    `<div class="${s.dry ? 'warn' : ''}"><b>${s.dry}</b><span>Susuz</span></div>` +
    `<div class="${s.withered ? 'warn' : ''}"><b>${s.withered}</b><span>Solgun</span></div>` +
    `<div class="${s.dead ? 'warn' : ''}"><b>${s.dead}</b><span>Kurumuş</span></div>` +
    `<div><b>${s.fert}</b><span>Gübreli</span></div><div><b>${st.sprinklers.length}</b><span>Fıskiye</span></div><div><b>${st.scarecrows.length}</b><span>Korkuluk</span></div>`));
  const list = el('div', 'farm-crops');
  for (const [type, c] of Object.entries(CROPS)) {
    const it = ITEMS[c.item];
    if (!it) continue;
    const ok = farm.inSeason(type, season);
    const total = c.hoursPerStage * (CROP_STAGES - 1);
    const sell = it.sell ? `${it.sell} / ${ITEMS[c.item + '_s']?.sell ?? '-'} / ${ITEMS[c.item + '_g']?.sell ?? '-'} 🪙` : '';
    list.appendChild(el('div', `shop-row farm-crop ${ok ? '' : 'off'}`,
      `<img src="${iconURL(scene, it.icon)}" alt=""><div class="rinfo"><b>${it.name}${ok ? '' : ' · mevsim dışı'}</b>` +
      `<span class="muted">${seasonText(c.seasons)} · ${total} sa${c.regrow ? ` · çoklu hasat (${c.regrowHours || c.hoursPerStage} sa)` : ''} · verim ${c.yield[0]}–${c.yield[1]}</span>` +
      `<span class="muted">Satış normal/gümüş/altın: ${sell}</span></div>`));
  }
  body.appendChild(list);
  body.appendChild(el('div', 'farm-tips',
    `<b>İpuçları</b><br>• Ekinler yalnızca sulanmışken büyür. 2 gün susuz kalan ekin solar, 3. gün kurur.<br>` +
    `• Gübre büyümeyi %${Math.round((FERT_GROWTH - 1) * 100)} hızlandırır ve gümüş/altın kalite şansını artırır (altın %5→%15, gümüş %20→%35).<br>` +
    `• Fıskiye (3 taş + 2 odun + 1 mermi) her şafakta sular; yanına gidip yükseltebilirsin.<br>` +
    `• Korkuluk (6 odun) olmayan tarlalarda kargalar her gün ekinlerin %3'ünü yer.<br>` +
    `• Olgun ekinin yanında etkileşim tuşu ile de hasat edebilirsin.`));
  scene.hud.openPanel('🌱 Tarla Defteri', body);
}

const CSS = `
.farm-panel { display: flex; flex-direction: column; gap: 10px; }
.farm-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 6px; }
.farm-stats > div { background: rgba(255,255,255,0.06); border-radius: 10px; padding: 6px 8px; text-align: center; }
.farm-stats b { display: block; font-size: 15px; }
.farm-stats span { font-size: 11px; opacity: 0.7; }
.farm-stats .warn b { color: #ff9f6b; }
.farm-crops { display: flex; flex-direction: column; gap: 6px; max-height: 46vh; overflow-y: auto; }
.farm-crop .rinfo { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.farm-crop.off { opacity: 0.55; }
.farm-tips { font-size: 12px; line-height: 1.5; opacity: 0.85; background: rgba(255,255,255,0.04); border-radius: 10px; padding: 8px 10px; }
.farm-btns { display: flex; flex-wrap: wrap; gap: 8px; }
.farm-btns button { min-height: 44px; flex: 1 1 140px; }
`;

// ---------------- Modül ----------------
export default {
  id: 'farming',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    st = { sprinklers: [], scarecrows: [], blockers: scene.physics.add.staticGroup() };
    scene.physics.add.collider(scene.player, st.blockers);
    injectCSS('farming', CSS);
    scene.addInteraction(cropInteraction);
    scene.addInteraction(objectInteraction);
    scene.featureMenu.push({ id: 'farming', icon: '🌱', label: 'Tarla', open: (s) => openFarmBook(s) });
    scene.timeSys.on('dawn', () => onDawn(scene));
    const harvest = (e) => onHarvest(scene, e);
    const died = (n) => scene.time.delayedCall(3000, () => scene.hud?.toast(`${n} ekin susuzluktan kurudu 🥀`, 'warn'));
    scene.events.on('cropHarvested', harvest);
    scene.events.on('cropsDied', died);
    scene.events.once('shutdown', () => { scene.events.off('cropHarvested', harvest); scene.events.off('cropsDied', died); });
  },

  begin(scene, isNewGame) {
    if (isNewGame) {
      clearObjects(scene);
      scene.inventory.add('seed_potato', 3);
      scene.inventory.add('fertilizer', 3);
    }
  },

  update(scene) {
    // Gübre seçiliyken tile imlecini göster
    const slot = scene.inventory.slots[scene.selected];
    if (slot && slot.id === 'fertilizer' && scene.marker && !scene.hud.isModalOpen()) scene.marker.setVisible(true);
  },

  save() {
    return {
      sprinklers: st.sprinklers.map((o) => ({ tx: o.tx, ty: o.ty, lvl: o.lvl })),
      scarecrows: st.scarecrows.map((o) => ({ tx: o.tx, ty: o.ty }))
    };
  },

  load(scene, data) {
    clearObjects(scene);
    if (!data) return;
    (data.sprinklers || []).slice(0, MAX_SPRINKLERS).forEach((d) => { if (Number.isFinite(d?.tx) && Number.isFinite(d?.ty)) makeObject(scene, 'sprinkler', d.tx, d.ty, d.lvl >= 2 ? 2 : 1); });
    (data.scarecrows || []).slice(0, MAX_SCARECROWS).forEach((d) => { if (Number.isFinite(d?.tx) && Number.isFinite(d?.ty)) makeObject(scene, 'scarecrow', d.tx, d.ty); });
  }
};
