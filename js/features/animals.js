// 'animals' özellik modülü — Hayvancılık: tavuk/inek, ağıl, yalak, sevgi, günlük ürün, gece tehdidi.
// Sözleşme için registry.js'e bak.
import { TILE, ITEMS, RECIPES, SHOPS, QUESTS, FARM_ZONE } from '../config.js';
import { addCanvas, makeCanvas, R } from '../textures.js';
import { audio } from '../audio.js';
import { injectCSS, el } from '../ui/dom.js';
import { Animal, ANIMAL_TYPES, ANIMAL_NAMES } from '../entities/Animal.js';

// ---------- Veri tabloları (modül yüklenirken genişletilir) ----------
Object.assign(ITEMS, {
  egg:            { name: 'Yumurta',         type: 'crop', icon: 'i_egg',      sell: 15, desc: 'Tavuktan taze yumurta.' },
  egg_big:        { name: 'Büyük Yumurta',   type: 'crop', icon: 'i_egg_big',  sell: 23, desc: 'Mutlu tavuktan (4+ kalp) iri yumurta.' },
  milk:           { name: 'Süt',             type: 'food', icon: 'i_milk',     sell: 25, heal: 5, energy: 12, desc: 'İnekten taze süt.' },
  milk_big:       { name: 'Kaliteli Süt',    type: 'food', icon: 'i_milk_big', sell: 38, heal: 8, energy: 18, desc: 'Mutlu inekten (4+ kalp) yağlı süt.' },
  cheese:         { name: 'Peynir',          type: 'crop', icon: 'i_cheese',   sell: 70, desc: 'Olgun köy peyniri. İyi para eder.' },
  omelet:         { name: 'Omlet',           type: 'food', icon: 'i_omelet',   sell: 40, heal: 30, energy: 20 },
  cake:           { name: 'Kek',             type: 'food', icon: 'i_cake',     sell: 90, heal: 50, energy: 50 },
  feed:           { name: 'Yem',             type: 'material', icon: 'i_feed', sell: 1, desc: 'Ağıldaki yalağa koy (E). Her hayvan günde 1 yer.', onUse: (s) => useFeed(s) },
  animal_chicken: { name: 'Tavuk',           type: 'material', icon: 'i_chicken', desc: 'Kullan → ağıldaki kümese yerleşir.', onUse: (s) => useAnimalItem(s, 'chicken') },
  animal_cow:     { name: 'İnek',            type: 'material', icon: 'i_cow',     desc: 'Kullan → ağıldaki ahıra yerleşir.', onUse: (s) => useAnimalItem(s, 'cow') }
});

RECIPES.push(
  { out: 'feed',   qty: 4, cost: { wheat: 1 } },
  { out: 'omelet', qty: 1, cost: { egg: 2 } },
  { out: 'omelet', qty: 1, cost: { egg_big: 1 } },
  { out: 'cheese', qty: 1, cost: { milk: 2 } },
  { out: 'cheese', qty: 3, cost: { milk_big: 2 } },
  { out: 'cake',   qty: 1, cost: { egg: 1, milk: 1, wheat: 2 } }
);

// Hayvan Pazarı (ağıl tabelası + Hayvanlar paneli); Kemal de yem ve hayvan satar
SHOPS.animals = [
  { id: 'animal_chicken', qty: 1, price: 120 },
  { id: 'animal_cow', qty: 1, price: 400 },
  { id: 'feed', qty: 1, price: 5 },
  { id: 'feed', qty: 10, price: 45 }
];
SHOPS.merchant.push({ id: 'feed', qty: 10, price: 45 }, { id: 'animal_chicken', qty: 1, price: 120 }, { id: 'animal_cow', qty: 1, price: 400 });

// Hayvan ürünleri isteyen görevler (zinciri mevcut görevlerin sonuna eklenir)
[
  { id: 'q_eggs',   npc: 'farmer',   title: 'Taze Yumurta',   desc: "Ayşe'ye 6 yumurta getir.", type: 'deliver', item: 'egg',    amount: 6, reward: { coins: 70, items: { feed: 10 } } },
  { id: 'q_cheese', npc: 'merchant', title: 'Köy Peyniri',     desc: "Kemal'e 2 peynir getir.",  type: 'deliver', item: 'cheese', amount: 2, reward: { coins: 180 } }
].forEach((q) => { if (!QUESTS.some((o) => o.id === q.id)) QUESTS.push(q); });

// ---------- Ağıl yerleşimi (tile) — çiftliğin doğusu ----------
const PEN = { x0: 23, y0: 3, x1: 31, y1: 11, gate: 27 };         // çit çerçevesi (dahil)
const T = (n) => n * TILE;
const ROAM = { x0: T(24) + 6, y0: T(6) + 6, x1: T(31) - 7, y1: T(11) - 5 };
const COOP = { x: T(25), y: T(6) - 14 };     // 32x28 doku merkezi
const BARN = { x: T(29) - 4, y: T(6) - 20 }; // 48x40 doku merkezi
const TROUGH = { x: T(30) - 4, y: T(10) + 6 };
const SIGN = { x: T(26) + 2, y: T(12) + 4 };
const TROUGH_CAP = 40;
const MAX_LOVE = 5;

// ---------- Dokular ----------
// Saydam olmayan piksellerin çevresine 1px kontur çizer
function outline(ctx, w, h, col) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) R(ctx, x, y, 1, 1, col);
  }
}

function drawChicken(ctx, f) {
  const W = '#f6f3ec', G = '#d8d1c3', Rd = '#d94f4f', Y = '#f2b13c', E = '#1b1622', L = '#e89a2c';
  const hy = f ? 1 : 0; // gagalarken baş iner
  R(ctx, 1, 2, 1, 1, W); R(ctx, 1, 3, 2, 3, W);               // kuyruk
  R(ctx, 3, 4, 4, 1, W); R(ctx, 2, 5, 7, 4, W);               // gövde
  R(ctx, 7, 2 + hy, 3, 4, W);                                 // baş
  R(ctx, 7, 1 + hy, 3, 1, Rd);                                // ibik
  R(ctx, 9, 3 + hy, 1, 1, E);                                 // göz
  R(ctx, 10, 4 + hy, 1, 1, Y);                                // gaga
  R(ctx, 9, 5 + hy, 1, 1, Rd);                                // sakal
  R(ctx, 4, 6, 3, 2, G); R(ctx, 4, 6, 3, 1, '#ebe5d9');      // kanat
  R(ctx, 3, 8, 6, 1, G);
  if (f) { R(ctx, 5, 9, 1, 2, L); R(ctx, 6, 9, 1, 2, L); R(ctx, 5, 10, 2, 1, L); }
  else { R(ctx, 4, 9, 1, 2, L); R(ctx, 7, 9, 1, 2, L); R(ctx, 3, 10, 2, 1, L); R(ctx, 7, 10, 2, 1, L); }
}

function drawCow(ctx, f) {
  const W = '#f2efe8', B = '#2b2420', P = '#e8a0a0', H = '#e6dcc0', D = '#cfc8bb', K = '#3a2a22';
  const hy = f ? 1 : 0;
  const legs = f ? [5, 8, 12, 15] : [4, 7, 13, 16];
  legs.forEach((x) => { R(ctx, x, 11, 2, 3, x % 2 ? W : D); R(ctx, x, 14, 2, 1, K); });
  R(ctx, 2, 4, 1, 4, W); R(ctx, 1, 7, 1, 2, B);               // kuyruk
  R(ctx, 3, 4, 15, 7, W);                                     // gövde
  R(ctx, 5, 4, 4, 3, B); R(ctx, 11, 6, 4, 3, B); R(ctx, 4, 8, 2, 2, B); // benekler
  R(ctx, 4, 10, 13, 1, D);
  R(ctx, 10, 11, 3, 1, P);                                    // meme
  R(ctx, 16, 2 + hy, 1, 1, '#d8cfc0');                        // kulak
  R(ctx, 17, 2 + hy, 5, 6, W);                                // baş
  R(ctx, 18, 2 + hy, 2, 2, B);
  R(ctx, 17, 1 + hy, 1, 1, H); R(ctx, 20, 1 + hy, 1, 1, H);   // boynuz
  R(ctx, 20, 4 + hy, 1, 1, '#1b1622');                        // göz
  R(ctx, 19, 6 + hy, 4, 3, P); R(ctx, 21, 7 + hy, 1, 1, '#a85f5f'); // burun
}

// 2 karelik hayvan sayfası: her kare ayrı tuvalde konturlanır
function animalSheet(scene, key, fw, fh, draw) {
  const tex = addCanvas(scene, key, fw * 2, fh, (ctx) => {
    for (let f = 0; f < 2; f++) {
      const { c, ctx: fc } = makeCanvas(fw, fh);
      draw(fc, f);
      outline(fc, fw, fh, '#3a2e2a');
      ctx.drawImage(c, f * fw, 0);
    }
  });
  tex.add(0, 0, 0, 0, fw, fh);
  tex.add(1, 0, fw, 0, fw, fh);
}

function makeTextures(scene) {
  animalSheet(scene, 'a_chicken', 12, 12, drawChicken);
  animalSheet(scene, 'a_cow', 24, 16, drawCow);

  // Kümes (32x28): kapı açık/kapalı
  const coop = (closed) => (ctx) => {
    for (let i = 0; i < 10; i++) R(ctx, 15 - i * 1.5, 2 + i, 2 + i * 3, 1, i % 3 ? '#c0503f' : '#9a3a2e');
    R(ctx, 3, 12, 26, 14, '#c9a06b');
    for (let y = 14; y < 26; y += 3) R(ctx, 3, y, 26, 1, '#a87f4f');
    R(ctx, 2, 25, 28, 3, '#6b4a2f');
    R(ctx, 22, 15, 5, 4, '#f6d77a'); R(ctx, 24, 15, 1, 4, '#6b4a2f');
    R(ctx, 11, 16, 10, 10, '#6b4a2f');
    if (closed) { R(ctx, 12, 17, 8, 9, '#8a5a3a'); R(ctx, 12, 21, 8, 1, '#5d3c27'); R(ctx, 18, 20, 1, 2, '#e8c867'); }
    else { R(ctx, 12, 17, 8, 9, '#24180f'); R(ctx, 13, 23, 2, 1, '#f6f3ec'); }
  };
  addCanvas(scene, 'a_coop', 32, 28, coop(false));
  addCanvas(scene, 'a_coop_closed', 32, 28, coop(true));

  // Ahır (48x40)
  const barn = (closed) => (ctx) => {
    for (let i = 0; i < 14; i++) { const hw = 8 + i * 1.15; R(ctx, 24 - hw, 1 + i, hw * 2, 1, i % 3 ? '#a83b33' : '#8a2e28'); }
    R(ctx, 3, 15, 42, 23, '#b8442f');
    for (let x = 5; x < 45; x += 4) R(ctx, x, 16, 1, 22, '#9a3627');
    R(ctx, 3, 15, 42, 1, '#f3e9d8');
    R(ctx, 20, 5, 8, 6, '#f3e9d8'); R(ctx, 21, 6, 6, 4, '#3a2a22');
    R(ctx, 15, 22, 18, 16, '#f3e9d8');
    if (closed) {
      R(ctx, 16, 23, 16, 15, '#8a2e28');
      for (let t = 0; t < 16; t++) { R(ctx, 16 + t, 23 + Math.floor(t * 14 / 15), 1, 1, '#f3e9d8'); R(ctx, 31 - t, 23 + Math.floor(t * 14 / 15), 1, 1, '#f3e9d8'); }
      R(ctx, 23, 23, 2, 15, '#f3e9d8');
    } else { R(ctx, 16, 23, 16, 15, '#22160e'); R(ctx, 18, 33, 12, 5, '#c9a443'); }
    R(ctx, 2, 38, 44, 2, '#6b4a2f');
  };
  addCanvas(scene, 'a_barn', 48, 40, barn(false));
  addCanvas(scene, 'a_barn_closed', 48, 40, barn(true));

  // Yalak (boş / dolu)
  const trough = (full) => (ctx) => {
    R(ctx, 2, 8, 2, 2, '#5d3c27'); R(ctx, 12, 8, 2, 2, '#5d3c27');
    R(ctx, 1, 3, 14, 6, '#8a5a3a'); R(ctx, 1, 3, 14, 1, '#a87048');
    R(ctx, 2, 4, 12, 2, full ? '#e8c867' : '#3a2a1a');
    if (full) [[3, 4], [7, 5], [11, 4]].forEach(([x, y]) => R(ctx, x, y, 1, 1, '#c9a443'));
  };
  addCanvas(scene, 'a_trough', 16, 10, trough(false));
  addCanvas(scene, 'a_trough_full', 16, 10, trough(true));

  // Tabela
  addCanvas(scene, 'a_sign', 14, 16, (ctx) => {
    R(ctx, 6, 8, 2, 8, '#6b4a2f');
    R(ctx, 1, 2, 12, 7, '#5d3c27'); R(ctx, 2, 3, 10, 5, '#c9a06b');
    R(ctx, 4, 4, 5, 3, '#f6f3ec'); R(ctx, 5, 4, 2, 1, '#2b2420'); R(ctx, 9, 4, 1, 2, '#f6f3ec'); R(ctx, 9, 6, 1, 1, '#e8a0a0');
  });

  // ---------- İkonlar (16x16) ----------
  const icon = (key, fn) => addCanvas(scene, key, 16, 16, fn);
  const egg = (base, shade, sparkle) => (ctx) => {
    R(ctx, 6, 3, 4, 1, base); R(ctx, 5, 4, 6, 1, base); R(ctx, 4, 5, 8, 7, base); R(ctx, 5, 12, 6, 1, base); R(ctx, 6, 13, 4, 1, shade);
    R(ctx, 10, 8, 1, 4, shade); R(ctx, 9, 12, 2, 1, shade); R(ctx, 5, 6, 1, 3, '#ffffff');
    if (sparkle) { R(ctx, 13, 1, 1, 3, '#ffffff'); R(ctx, 12, 2, 3, 1, '#ffffff'); }
  };
  icon('i_egg', egg('#f3ece0', '#d9ccb3'));
  icon('i_egg_big', egg('#e9c58a', '#c99a5a', true));
  const milk = (cap, label, sparkle) => (ctx) => {
    R(ctx, 6, 1, 4, 1, cap); R(ctx, 6, 2, 4, 2, '#d8e4ee');
    R(ctx, 5, 4, 6, 1, '#e6eef5'); R(ctx, 4, 5, 8, 10, '#f4f8fb');
    R(ctx, 4, 9, 8, 3, label); R(ctx, 5, 6, 1, 8, '#ffffff'); R(ctx, 11, 5, 1, 10, '#c9d6e2');
    if (sparkle) { R(ctx, 13, 1, 1, 3, '#ffffff'); R(ctx, 12, 2, 3, 1, '#ffffff'); }
  };
  icon('i_milk', milk('#4f8fd0', '#5ab0ff'));
  icon('i_milk_big', milk('#ffd166', '#f2b13c', true));
  icon('i_cheese', (ctx) => {
    R(ctx, 2, 8, 12, 6, '#f2c94c');
    for (let i = 0; i < 5; i++) R(ctx, 2 + i * 2, 7 - i, 12 - i * 2, 1, '#f7d96a');
    R(ctx, 2, 13, 12, 1, '#d9a62e'); R(ctx, 5, 10, 2, 2, '#d9a62e'); R(ctx, 10, 9, 1, 1, '#d9a62e'); R(ctx, 9, 12, 2, 1, '#d9a62e');
  });
  icon('i_omelet', (ctx) => {
    R(ctx, 2, 8, 12, 1, '#e6edf3'); R(ctx, 1, 9, 14, 4, '#e6edf3'); R(ctx, 2, 13, 12, 1, '#9aa3ad');
    R(ctx, 3, 7, 10, 4, '#f2c94c'); R(ctx, 4, 6, 8, 1, '#f7d96a');
    R(ctx, 6, 8, 1, 1, '#4f9f3e'); R(ctx, 9, 7, 1, 1, '#4f9f3e'); R(ctx, 11, 9, 1, 1, '#e86d5a');
  });
  icon('i_cake', (ctx) => {
    R(ctx, 2, 8, 12, 6, '#c98b3a'); R(ctx, 2, 11, 12, 1, '#e8c867');
    R(ctx, 2, 6, 12, 2, '#fff3e0'); R(ctx, 4, 8, 1, 2, '#fff3e0'); R(ctx, 9, 8, 1, 1, '#fff3e0'); R(ctx, 12, 8, 1, 2, '#fff3e0');
    R(ctx, 7, 3, 2, 2, '#d94f4f'); R(ctx, 8, 2, 1, 1, '#4f7f3a'); R(ctx, 1, 14, 14, 1, '#e6edf3');
  });
  icon('i_feed', (ctx) => {
    R(ctx, 3, 5, 10, 9, '#d9c08a'); R(ctx, 4, 4, 8, 1, '#d9c08a'); R(ctx, 5, 2, 6, 2, '#b39e74'); R(ctx, 3, 13, 10, 1, '#b39e74');
    R(ctx, 6, 8, 4, 3, '#8a5a3a'); R(ctx, 7, 9, 2, 1, '#e8c867');
    [[2, 14], [13, 13], [12, 14]].forEach(([x, y]) => R(ctx, x, y, 1, 1, '#e8c867'));
  });
  icon('i_chicken', (ctx) => {
    const { c, ctx: fc } = makeCanvas(12, 12);
    drawChicken(fc, 0); outline(fc, 12, 12, '#3a2e2a');
    ctx.drawImage(c, 2, 2);
  });
  icon('i_cow', (ctx) => {
    const W = '#f2efe8';
    R(ctx, 1, 5, 2, 2, '#d8cfc0'); R(ctx, 13, 5, 2, 2, '#d8cfc0');
    R(ctx, 4, 2, 1, 2, '#e6dcc0'); R(ctx, 11, 2, 1, 2, '#e6dcc0');
    R(ctx, 3, 4, 10, 8, W); R(ctx, 4, 4, 3, 3, '#2b2420');
    R(ctx, 5, 7, 1, 1, '#1b1622'); R(ctx, 10, 7, 1, 1, '#1b1622');
    R(ctx, 4, 10, 8, 4, '#e8a0a0'); R(ctx, 6, 12, 1, 1, '#a85f5f'); R(ctx, 9, 12, 1, 1, '#a85f5f');
    outline(ctx, 16, 16, '#3a2e2a');
  });

  [['a_chicken', 6], ['a_cow', 4]].forEach(([key, rate]) => {
    if (!scene.anims.exists(`${key}_walk`)) scene.anims.create({ key: `${key}_walk`, frames: [{ key, frame: 0 }, { key, frame: 1 }], frameRate: rate, repeat: -1 });
  });
}

// ---------- Ağıl yönetimi ----------
const st = (scene) => scene.ranch;

function buildPen(scene) {
  const S = st(scene);
  // Ağıl alanındaki ağaç/kayaları temizle
  scene.resources.getChildren().slice().forEach((r) => {
    const tx = Math.floor(r.x / TILE), ty = Math.floor((r.y + 4) / TILE);
    if (tx >= PEN.x0 - 1 && tx <= PEN.x1 + 1 && ty >= PEN.y0 - 2 && ty <= PEN.y1 + 2) r.destroy();
  });
  const g = scene.physics.add.staticGroup();
  const block = (x, y, key, bw, bh, ox, oy, depth) => {
    const img = g.create(x, y, key);
    img.body.setSize(bw, bh).setOffset(ox, oy);
    img.setDepth(depth);
    return img;
  };
  // Tarla çitiyle bitişik kısımda çift çit çizme; o aralıkta tarlanın sağ çiti duvar görevi görür
  const sharesFarm = (y) => FARM_ZONE.x + FARM_ZONE.w === PEN.x0 - 1 && y >= FARM_ZONE.y - 1;
  for (let x = PEN.x0; x <= PEN.x1; x++) {
    block(T(x) + 8, T(PEN.y0) + 8, 'fence', 16, 6, 0, 8, T(PEN.y0) + 14);
    if (x === PEN.gate) continue;
    // Köşedeki ilk parça, tarla çitine kadar uzanan geniş gövdeyle aradaki boşluğu kapatır
    if (x === PEN.x0 && sharesFarm(PEN.y1 - 1)) block(T(x) + 8, T(PEN.y1) + 8, 'fence', 22, 6, -6, 8, T(PEN.y1) + 14);
    else block(T(x) + 8, T(PEN.y1) + 8, 'fence', 16, 6, 0, 8, T(PEN.y1) + 14);
  }
  for (let y = PEN.y0 + 1; y < PEN.y1; y++) {
    if (!sharesFarm(y)) block(T(PEN.x0) + 8, T(y) + 8, 'fence', 4, 16, 6, 0, T(y) + 14);
    block(T(PEN.x1) + 8, T(y) + 8, 'fence', 4, 16, 6, 0, T(y) + 14);
  }
  S.coop = block(COOP.x, COOP.y, 'a_coop', 28, 12, 2, 14, COOP.y + 14);
  S.barn = block(BARN.x, BARN.y, 'a_barn', 44, 18, 2, 20, BARN.y + 20);
  S.trough = block(TROUGH.x, TROUGH.y, 'a_trough', 14, 5, 1, 4, TROUGH.y + 5);
  S.sign = scene.add.image(SIGN.x, SIGN.y, 'a_sign').setDepth(SIGN.y + 8);
  scene.physics.add.collider(scene.player, g);
  S.solids = g;
}

const doorSpot = (house) => (house === 'coop' ? { x: COOP.x, y: COOP.y + 16 } : { x: BARN.x, y: BARN.y + 22 });

function refreshVisuals(scene) {
  const S = st(scene);
  S.coop.setTexture(S.doorsClosed ? 'a_coop_closed' : 'a_coop');
  S.barn.setTexture(S.doorsClosed ? 'a_barn_closed' : 'a_barn');
  S.trough.setTexture(S.feed > 0 ? 'a_trough_full' : 'a_trough');
}

function countType(scene, type) { return st(scene).animals.filter((a) => a.type === type).length; }

function spawnAnimal(scene, type, data = {}) {
  const S = st(scene);
  const h = doorSpot(ANIMAL_TYPES[type].house);
  const a = new Animal(scene, h.x + Phaser.Math.Between(-4, 4), h.y + 6, type, data);
  a.ranch = S.api;
  S.animals.push(a);
  scene.extraTargets.push(a);
  if (S.doorsClosed) a.goInside();
  return a;
}

function removeAnimal(scene, a) {
  const S = st(scene);
  S.animals = S.animals.filter((x) => x !== a);
  const i = scene.extraTargets.indexOf(a);
  if (i >= 0) scene.extraTargets.splice(i, 1);
}

// Yeni hayvanı ağıla ekle (kapasite kontrolü ile)
function addAnimal(scene, type) {
  const def = ANIMAL_TYPES[type];
  if (countType(scene, type) >= def.cap) { scene.hud.notice(`${def.house === 'coop' ? 'Kümes' : 'Ahır'} dolu! (en fazla ${def.cap} ${def.name.toLowerCase()})`); audio.sfx('error'); return null; }
  const used = new Set(st(scene).animals.map((x) => x.animalName));
  const pool = ANIMAL_NAMES[type].filter((n) => !used.has(n));
  const a = spawnAnimal(scene, type, { name: pool.length ? Phaser.Utils.Array.GetRandom(pool) : undefined });
  scene.hud.toast(`🎉 ${a.animalName} adlı ${def.name.toLowerCase()} ağıla yerleşti!`, 'ok');
  return a;
}

function useAnimalItem(scene, type) {
  const id = `animal_${type}`;
  if (!addAnimal(scene, type)) return;
  scene.inventory.remove(id, 1);
  scene.player.actionCd = 0.4;
  audio.sfx('place');
}

const nearTrough = (scene, r = 30) => Phaser.Math.Distance.Between(scene.player.x, scene.player.y, TROUGH.x, TROUGH.y) < r;

// Envanterdeki yemi (yoksa buğdayı) yalağa doldur
function fillTrough(scene) {
  const S = st(scene), inv = scene.inventory;
  const room = TROUGH_CAP - S.feed;
  if (room <= 0) { scene.hud.notice('Yalak zaten dolu'); return; }
  let added = 0;
  const feedN = Math.min(room, inv.count('feed'));
  if (feedN > 0) { inv.remove('feed', feedN); added += feedN; }
  if (added === 0) {
    const wheatN = Math.min(Math.ceil(room / 2), inv.count('wheat'));
    if (wheatN > 0) { inv.remove('wheat', wheatN); added += Math.min(room, wheatN * 2); }
  }
  if (!added) { scene.hud.notice('Yemin yok! Kemal\'den al ya da buğdaydan üret.'); audio.sfx('error'); return; }
  S.feed += added;
  refreshVisuals(scene);
  scene.spawnParticles(TROUGH.x, TROUGH.y, 0xe8c867, 8);
  scene.floatText(TROUGH.x, TROUGH.y - 8, `+${added} yem`, '#ffe08a');
  audio.sfx('plant');
}

function useFeed(scene) {
  if (nearTrough(scene, 44)) fillTrough(scene);
  else scene.hud.notice('Yemi ağıldaki yalağa koy (çiftliğin doğusu)');
}

function collect(scene, a) {
  const id = a.product;
  a.product = null;
  scene.giveItem(id, 1);
  scene.floatText(a.x, a.y - 10, `+1 ${ITEMS[id].name}`, '#ffe08a');
  scene.spawnParticles(a.x, a.y - 4, 0xffe08a, 6);
  audio.sfx('harvest');
}

function pet(scene, a) {
  a.petted = true;
  a.love = Math.min(MAX_LOVE, a.love + 0.2);
  a.halt(); a.idle = 1.2;
  a.setFlipX(scene.player.x < a.x);
  scene.floatText(a.x, a.y - 10, '♥', '#ff8fb1');
  scene.tweens.add({ targets: a, scaleY: 0.85, duration: 90, yoyo: true });
  audio.sfx('plant');
}

function toggleDoors(scene) {
  const S = st(scene);
  S.doorsClosed = !S.doorsClosed;
  if (!S.doorsClosed) S.animals.forEach((a, i) => { a.outDelay = 0.2 + i * 0.25; });
  refreshVisuals(scene);
  audio.sfx('place');
  scene.hud.toast(S.doorsClosed ? '🔒 Kümes ve ahır kapıları kapandı. Hayvanlar güvende.' : '🔓 Kapılar açıldı, hayvanlar ağıla çıkıyor.', 'info');
}

// E tuşu / mobil eylem butonu etkileşimleri
function interaction(scene) {
  const S = st(scene);
  if (!S?.built) return null;
  const p = scene.player;
  let best = null;
  const offer = (dist, label, run) => { if (!best || dist < best.dist) best = { dist, label, run }; };
  for (const a of S.animals) {
    if (a.inside) continue;
    const d = Phaser.Math.Distance.Between(p.x, p.y, a.x, a.y);
    if (d > 20) continue;
    if (a.product) offer(d, `Topla: ${ITEMS[a.product].name} (${a.animalName})`, () => collect(scene, a));
    else if (!a.petted) offer(d, `Okşa: ${a.animalName} ♥`, () => pet(scene, a));
  }
  const dt = Phaser.Math.Distance.Between(p.x, p.y, TROUGH.x, TROUGH.y);
  if (dt < 26) {
    const inv = scene.inventory;
    const what = inv.count('feed') ? 'yem' : inv.count('wheat') ? 'buğday' : null;
    offer(dt + 2, what ? `Yalağa ${what} koy (${S.feed}/${TROUGH_CAP})` : `Yalak: ${S.feed}/${TROUGH_CAP} yem`, () => fillTrough(scene));
  }
  for (const house of ['coop', 'barn']) {
    const ds = doorSpot(house);
    const d = Phaser.Math.Distance.Between(p.x, p.y, ds.x, ds.y);
    if (d < 22) offer(d + 3, S.doorsClosed ? 'Kapıları aç' : 'Kapıları kapat (hayvanları koru)', () => toggleDoors(scene));
  }
  const dsn = Phaser.Math.Distance.Between(p.x, p.y, SIGN.x, SIGN.y + 6);
  if (dsn < 22) offer(dsn, 'Hayvan Pazarı', () => openPanel(scene, 'shop'));
  return best;
}

// ---------- Günlük döngü ----------
function onDawn(scene) {
  const S = st(scene);
  if (!S.animals.length) { if (S.doorsClosed) { S.doorsClosed = false; refreshVisuals(scene); } return; }
  let made = 0;
  const hungry = [];
  S.animals.forEach((a) => {
    if (a.fed) {
      if (!a.product) { a.product = a.love >= 4 ? a.def.productBig : a.def.product; a.refreshBubble(); made++; }
    } else {
      a.love = Math.max(0, a.love - 0.3);
      hungry.push(a.animalName);
    }
    a.fed = false;
    a.petted = false;
    a.hp = a.maxHp;
  });
  // Şafakta kapılar kendiliğinden açılır
  if (S.doorsClosed) toggleDoorsQuiet(scene);
  scene.time.delayedCall(2500, () => {
    if (made) scene.hud.toast(`🥚 Ağılda ${made} ürün toplanmayı bekliyor.`, 'ok');
    if (hungry.length) scene.hud.toast(`Aç kalan hayvanlar ürün vermedi: ${hungry.slice(0, 3).join(', ')}${hungry.length > 3 ? '…' : ''}`, 'warn');
  });
}

function toggleDoorsQuiet(scene) {
  const S = st(scene);
  S.doorsClosed = false;
  S.animals.forEach((a, i) => { a.outDelay = 0.5 + i * 0.3; });
  refreshVisuals(scene);
}

// ---------- Panel ----------
const CSS = `
.anm { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 100%; }
.anm .tabs { display: flex; gap: 6px; }
.anm .tabs button { flex: 1; min-height: 40px; }
.anm .tabs button.on { border-color: var(--accent); background: rgba(255, 209, 102, 0.16); }
.anm .sum { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; }
.anm .chip { padding: 4px 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.08); border: 1px solid var(--stroke); white-space: nowrap; }
.anm .chip.bad { border-color: rgba(235, 87, 87, 0.6); color: #ffb3b3; }
.anm .chip.good { border-color: rgba(110, 224, 110, 0.5); color: #b9f5b9; }
.anm .list { display: flex; flex-direction: column; gap: 6px; max-height: min(52vh, 420px); overflow-y: auto; -webkit-overflow-scrolling: touch; }
.anm .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(255, 255, 255, 0.05); }
.anm .row img { width: 32px; height: 32px; image-rendering: pixelated; flex: none; }
.anm .row .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.anm .row .info b { font-size: 14px; }
.anm .hearts { color: #ff8fb1; letter-spacing: 1px; font-size: 13px; }
.anm .hearts i { color: rgba(255, 255, 255, 0.22); font-style: normal; }
.anm .tags { display: flex; flex-wrap: wrap; gap: 4px; font-size: 11px; }
.anm .row button { min-height: 44px; min-width: 76px; }
.anm .tip { font-size: 12px; color: var(--muted); line-height: 1.45; }
/* style.css'teki #modal-feature { width: 560px } kimlik seçicisi mobil alt sayfa genişliğini eziyordu */
body.is-touch.portrait #modal-feature { width: 100%; }
`;

const hearts = (love) => {
  const full = Math.floor(love + 0.001);
  return `${'♥'.repeat(full)}<i>${'♥'.repeat(MAX_LOVE - full)}</i>`;
};

function openPanel(scene, tab = 'mine') {
  injectCSS('animals', CSS);
  const root = el('div', 'anm');
  const render = (t) => {
    tab = t;
    const S = st(scene), hud = scene.hud;
    root.innerHTML = '';
    const tabs = el('div', 'tabs');
    [['mine', '🐔 Hayvanlarım'], ['shop', '🛒 Hayvan Pazarı']].forEach(([id, label]) => {
      const b = el('button', tab === id ? 'on' : '', label);
      b.addEventListener('click', () => { audio.sfx('click'); render(id); });
      tabs.appendChild(b);
    });
    root.appendChild(tabs);
    const sum = el('div', 'sum',
      `<span class="chip ${S.feed ? '' : 'bad'}">Yalak: ${S.feed}/${TROUGH_CAP} yem</span>` +
      `<span class="chip ${S.doorsClosed ? 'good' : ''}">Kapılar: ${S.doorsClosed ? 'Kapalı 🔒' : 'Açık 🔓'}</span>` +
      `<span class="chip">Kümes ${countType(scene, 'chicken')}/${ANIMAL_TYPES.chicken.cap}</span>` +
      `<span class="chip">Ahır ${countType(scene, 'cow')}/${ANIMAL_TYPES.cow.cap}</span>` +
      `<span class="chip">${scene.player.coins} 🪙</span>`);
    root.appendChild(sum);
    const list = el('div', 'list');
    if (tab === 'mine') {
      if (!S.animals.length) list.appendChild(el('p', 'tip', 'Henüz hayvanın yok. Hayvan Pazarı\'ndan tavuk ya da inek al.'));
      S.animals.forEach((a) => {
        const tags = [
          a.fed ? '<span class="chip good">Tok</span>' : '<span class="chip bad">Aç</span>',
          a.product ? `<span class="chip good">${ITEMS[a.product].name} hazır</span>` : '',
          a.petted ? '<span class="chip">Okşandı</span>' : '',
          a.inside ? '<span class="chip">İçeride</span>' : '',
          a.hp < a.maxHp ? `<span class="chip bad">Can ${Math.ceil(a.hp)}/${a.maxHp}</span>` : '',
          a.love >= 4 ? '<span class="chip good">Kaliteli ürün</span>' : ''
        ].join('');
        list.appendChild(el('div', 'row', `<img src="${hud.icon(a.def.icon)}" alt=""><div class="info"><b>${a.animalName} <span class="muted" style="font-weight:400;font-size:12px">${a.def.name}</span></b><span class="hearts">${hearts(a.love)}</span><div class="tags">${tags}</div></div>`));
      });
      root.appendChild(list);
      root.appendChild(el('p', 'tip', 'Ağıl çiftliğin doğusunda. Yalağa yem koy: tok hayvan şafakta ürün verir. Her gün okşa (+♥). 4+ kalpte ürünler kaliteli olur (x1.5). Gece zombiler hayvanlara saldırır: akşam kümes/ahır kapısını kapat, şafakta kendiliğinden açılır.'));
    } else {
      SHOPS.animals.forEach((o) => {
        const d = ITEMS[o.id];
        const ok = scene.player.coins >= o.price;
        const row = el('div', 'row', `<img src="${hud.icon(o.id)}" alt=""><div class="info"><b>${d.name}${o.qty > 1 ? ` ×${o.qty}` : ''}</b><span class="muted" style="font-size:12px">${d.desc || ''}</span></div><button class="${ok ? 'primary' : ''}" ${ok ? '' : 'disabled'}>${o.price} 🪙</button>`);
        row.querySelector('button').addEventListener('click', () => {
          if (scene.player.coins < o.price) { audio.sfx('error'); return; }
          if (o.id.startsWith('animal_')) {
            if (!addAnimal(scene, o.id.slice(7))) return;
          } else {
            const left = scene.inventory.add(o.id, o.qty);
            if (left === o.qty) { hud.toast('Envanter dolu!', 'warn'); audio.sfx('error'); return; }
          }
          scene.player.addCoins(-o.price);
          audio.sfx('coin');
          render(tab);
        });
        list.appendChild(row);
      });
      root.appendChild(list);
      root.appendChild(el('p', 'tip', 'Satın aldığın hayvan doğrudan ağıla gelir. Yemi yalağa koymak için ağıla git. Buğday da yem yerine geçer (1 buğday = 2 yem) ya da envanterde 1 buğdaydan 4 yem üretebilirsin.'));
    }
  };
  render(tab);
  scene.hud.openPanel('🐄 Hayvancılık', root);
  audio.sfx('click');
}

// ---------- Özellik modülü ----------
export default {
  id: 'animals',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    const S = scene.ranch = { animals: [], feed: 0, doorsClosed: false, built: false, loaded: false, warnAt: 0 };
    S.api = {
      doorSpot,
      onHurt: (a) => {
        const now = scene.time.now;
        if (now - S.warnAt > 4000) { S.warnAt = now; scene.hud.toast(`⚠️ ${a.animalName} saldırı altında! Ağıla koş!`, 'warn'); }
      },
      onDeath: (a) => {
        removeAnimal(scene, a);
        scene.hud.toast(`💀 ${a.def.name} ${a.animalName} zombilere yem oldu…`, 'warn');
        scene.events.emit('animalDied', a);
      }
    };
    buildPen(scene);
    S.built = true;
    refreshVisuals(scene);
    S.env = {
      roam: ROAM,
      trough: { x: TROUGH.x - 12, y: TROUGH.y + 2 },
      get doorsClosed() { return S.doorsClosed; },
      hasFeed: () => S.feed > 0,
      eat: (a) => {
        if (S.feed <= 0 || a.fed) return;
        S.feed--;
        a.fed = true;
        a.love = Math.min(MAX_LOVE, a.love + 0.1);
        if (S.feed === 0) refreshVisuals(scene);
      }
    };
    scene.addInteraction(interaction);
    scene.featureMenu.push({ id: 'animals', icon: '🐔', label: 'Hayvanlar', open: (s) => openPanel(s, 'mine') });
    // Ahır feneri
    scene.lightSources.push(() => (S.animals.length ? [{ x: BARN.x, y: BARN.y + 26, r: 42 }] : null));
    scene.timeSys.on('dawn', () => onDawn(scene));
    scene.timeSys.on('dusk', () => {
      if (!S.doorsClosed && S.animals.some((a) => !a.inside)) scene.hud.toast('🐔 Kümes/ahır kapıları açık! Zombiler hayvanlarına saldırabilir.', 'warn');
    });
    scene.timeSys.on('hour', (h) => {
      if (h === 19 && !S.doorsClosed && S.animals.length) scene.time.delayedCall(1500, () => scene.hud.toast('Akşam oluyor: ağıla gidip kapıları kapatmayı unutma.', 'info'));
    });
    scene.events.once('shutdown', () => { S.animals = []; });
  },

  begin(scene) {
    const S = st(scene);
    if (S.loaded) return;
    // Yeni oyun (ya da hayvan verisi olmayan eski kayıt): başlangıç tavukları
    spawnAnimal(scene, 'chicken', { name: 'Pamuk' });
    spawnAnimal(scene, 'chicken', { name: 'Fındık' });
    S.feed = 6;
    refreshVisuals(scene);
    scene.time.delayedCall(4200, () => scene.hud.toast('🐔 Çiftliğin doğusundaki ağılda 2 tavuğun var. Yalağa yem koy, yumurta topla!', 'info'));
  },

  update(scene, dt) {
    const S = st(scene);
    if (!S) return;
    for (let i = 0; i < S.animals.length; i++) S.animals[i].tick(dt, S.env);
  },

  save(scene) {
    const S = st(scene);
    return { v: 1, feed: S.feed, doorsClosed: S.doorsClosed, animals: S.animals.filter((a) => !a.dead).map((a) => a.serialize()) };
  },

  load(scene, data) {
    const S = st(scene);
    if (!data || !Array.isArray(data.animals)) return;
    S.loaded = true;
    S.feed = Phaser.Math.Clamp(Number(data.feed) || 0, 0, TROUGH_CAP);
    S.doorsClosed = !!data.doorsClosed;
    data.animals.forEach((d) => {
      if (!d || !ANIMAL_TYPES[d.type]) return;
      if (d.product && !ITEMS[d.product]) d.product = null;
      spawnAnimal(scene, d.type, d);
    });
    refreshVisuals(scene);
  }
};
