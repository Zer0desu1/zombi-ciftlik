// 'world' özellik modülü — mevsimler, hava durumu, göl ve balık tutma, yabani ürünler, terk edilmiş ev.
// Sözleşme için registry.js'e bak. Mevsim bilgisi: scene.timeSys.season / seasonIndex (TimeSystem.js).
// Hava: scene.weather ('clear' | 'rain' | 'fog' | 'storm'), scene.weatherInfo; olaylar scene.events:
//   'weatherChanged' (type, info), 'seasonChanged' (season, index), 'foraged' (itemId), 'fishCaught' (itemId)
import { ITEMS, RECIPES, SHOPS, TILE, MAP_W, MAP_H, FARM_ZONE } from '../config.js';
import { addCanvas, R, makeCanvas, PAL, shade, dith, litFill, outline, dropShadow } from '../textures.js';
import { injectCSS, el, featureLayer } from '../ui/dom.js';
import { audio } from '../audio.js';
import { SEASONS, SEASON_DAYS } from '../systems/TimeSystem.js';
import { LAKE_ZONE } from '../systems/MapBuilder.js';

// ---------------- Veri ----------------
export const WEATHERS = {
  clear: { id: 'clear', name: 'Açık',    icon: '☀️', dim: 0,    desc: 'Güzel bir gün. Ekinlerini sulamayı unutma.' },
  rain:  { id: 'rain',  name: 'Yağmur',  icon: '🌧️', dim: 0.16, desc: 'Yağmur tarladaki tüm toprağı sular. Balıklar daha iştahlı.' },
  fog:   { id: 'fog',   name: 'Sis',     icon: '🌫️', dim: 0.12, desc: 'Görüş azalır, ışıklar kısalır. Zombiler seni ancak yakından fark eder.' },
  storm: { id: 'storm', name: 'Fırtına', icon: '⛈️', dim: 0.3,  desc: 'Sağanak tarlayı sular, şimşekler çakar. Zombiler %10 daha hızlı!' }
};
// Mevsime göre hava olasılıkları [açık, yağmur, sis, fırtına]
const WEATHER_ODDS = {
  spring: [0.55, 0.25, 0.12, 0.08],
  summer: [0.62, 0.16, 0.06, 0.16],
  autumn: [0.50, 0.26, 0.18, 0.06],
  winter: [0.52, 0.24, 0.20, 0.04]
};
// Mevsim görselleri: zemin üstü renk katmanı + ağaç tonu
const SEASON_FX = {
  spring: { color: 0x9cff8a, alpha: 0.05, tree: 0xffffff, desc: 'Her şey yeşeriyor. Mantar ve böğürtlen bol.' },
  summer: { color: 0xffe08a, alpha: 0.07, tree: 0xf4ffd8, desc: 'Sıcak günler, sık fırtınalar. Böğürtlen mevsimi.' },
  autumn: { color: 0xe0813a, alpha: 0.17, tree: 0xffb27a, desc: 'Yapraklar dökülüyor, sis sıklaşıyor. Mantar zamanı.' },
  winter: { color: 0xe8f2ff, alpha: 0.30, tree: 0xdde8f5, desc: 'Kar yağar, yabani ürün azalır. Göl yine de balık verir.' }
};
const FISH = [
  { id: 'fish_gold', chance: 0.05, speed: 2.1, zone: 0.22, label: 'Altın Balık' },
  { id: 'fish_bass', chance: 0.30, speed: 1.35, zone: 0.27, label: 'Levrek' },
  { id: 'fish_carp', chance: 1,    speed: 0.85, zone: 0.32, label: 'Sazan' }
];
const CHEST_LOOT = [
  [['wood', 3, 6], 3], [['stone', 3, 6], 3], [['ammo', 4, 8], 2], [['seed_carrot', 2, 4], 2],
  [['seed_pumpkin', 1, 2], 1], [['bread', 1, 1], 1], [['mushroom', 2, 3], 1], [['coins', 10, 30], 2]
];
const MAX_FORAGE = 14;
const FOG_DETECT = 72;    // sisli gecede zombinin oyuncuyu fark ettiği mesafe
const FOG_LIGHT = 0.7;    // sisli havada ışık yarıçapı çarpanı
const STORM_SPEED = 1.1;

// ---------------- Eşyalar / tarif / dükkân ----------------
Object.assign(ITEMS, {
  fishing_rod:  { name: 'Olta',          type: 'tool',     icon: 'i_rod',          desc: 'Göl kenarında kullan. Balığı yeşil alanın içinde tut!', onUse: (scene) => tryFish(scene, true) },
  fish_carp:    { name: 'Sazan',         type: 'food',     icon: 'i_fish_carp',    sell: 15,  heal: 6,  energy: 10, desc: 'Gölün en yaygın balığı.' },
  fish_bass:    { name: 'Levrek',        type: 'food',     icon: 'i_fish_bass',    sell: 35,  heal: 12, energy: 16, desc: 'Çevik ve lezzetli.' },
  fish_gold:    { name: 'Altın Balık',   type: 'material', icon: 'i_fish_gold',    sell: 120, desc: 'Nadir bir balık! Kemal bayılır.' },
  fish_grilled: { name: 'Izgara Balık',  type: 'food',     icon: 'i_fish_grilled', sell: 40,  heal: 35, energy: 35, desc: 'Sazan + odun ile pişir.' },
  mushroom:     { name: 'Mantar',        type: 'food',     icon: 'i_mushroom',     sell: 6,   heal: 2,  energy: 15, desc: 'Ağaç diplerinde biter.' },
  berry:        { name: 'Böğürtlen',     type: 'food',     icon: 'i_berry',        sell: 5,   heal: 8,  energy: 4,  desc: 'Yabani çalılarda yetişir.' }
});
RECIPES.push({ out: 'fish_grilled', qty: 1, cost: { fish_carp: 1, wood: 1 } });
SHOPS.merchant.push({ id: 'fishing_rod', qty: 1, price: 80 });

// ---------------- Dokular ----------------
function makeWorldTextures(scene) {
  // Göl (8x5 tile, yuvarlak köşe): kum kıyı → ıslak kum → köpüklü sığlık → derinleşen su (kareli geçişler)
  const LW = LAKE_ZONE.w * TILE, LH = LAKE_ZONE.h * TILE;
  const WA = PAL.water, DI = PAL.dirt, LF = PAL.leaf;
  addCanvas(scene, 'lake', LW, LH, (ctx) => {
    const hx = LW / 2, hy = LH / 2;
    // Yuvarlak dikdörtgenin içine olan uzaklık (kenarda 0, merkeze doğru artar). Kıyı 18px köşe
    // yarıçapıyla, derinlik eğrileri ise daha büyük yarıçapla hesaplanır ki iç halkalar oval dursun.
    const sdf = (x, y, rad) => {
      const qx = Math.abs(x + 0.5 - hx) - (hx - rad), qy = Math.abs(y + 0.5 - hy) - (hy - rad);
      return -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad);
    };
    const depth = (x, y) => sdf(x, y, 18);
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      const d = depth(x, y);
      if (d < 0) continue;
      let col;
      if (d < 1) col = DI[4];
      else if (d < 3.4) col = dith(x, y) < -0.3 ? DI[6] : DI[5];
      else if (d < 4.6) col = DI[3];
      else {
        const wob = Math.sin(x * 0.21 + y * 0.07) * 1.6 + Math.cos(y * 0.33 - x * 0.05) * 1.2; // kıvrımlı derinlik eğrileri
        const t = Math.min(d - 4.6, sdf(x, y, hy - 2) - 3 + wob) + dith(x, y) * 2.4;
        col = t < 1 ? WA[5] : t < 5 ? WA[4] : t < 11 ? WA[3] : t < 19 ? WA[2] : WA[1];
      }
      R(ctx, x, y, 1, 1, col);
    }
    // Üst kıyının suya düşen gölgesi ve dalgacıklar
    for (let x = 0; x < LW; x++) for (let y = 0; y < LH / 2; y++) { const d = depth(x, y); if (d >= 4.6 && d < 6.6 && y < 10) R(ctx, x, y, 1, 1, 'rgba(20,54,94,0.35)'); }
    [[24, 20], [70, 30], [44, 52], [96, 46], [30, 62], [84, 16], [58, 40]].forEach(([x, y]) => { R(ctx, x, y, 6, 1, WA[5]); R(ctx, x + 2, y + 1, 4, 1, WA[4]); R(ctx, x - 1, y + 1, 1, 1, WA[4]); });
    // Nilüferler (çentikli yaprak) ve çiçek
    [[18, 40], [104, 26], [92, 62], [36, 30]].forEach(([x, y], i) => {
      R(ctx, x, y + 1, 6, 3, LF[3]); R(ctx, x + 1, y, 4, 5, LF[3]); R(ctx, x + 1, y + 1, 3, 1, LF[5]); R(ctx, x + 1, y + 4, 4, 1, LF[2]);
      R(ctx, x + 3, y + 2, 1, 2, WA[2]); R(ctx, x + 1, y + 5, 4, 1, 'rgba(20,54,94,0.4)');
      if (i % 2 === 0) { R(ctx, x + 1, y + 1, 2, 2, '#f6a3c7'); R(ctx, x + 1, y + 1, 1, 1, '#ffffff'); R(ctx, x + 2, y + 2, 1, 1, '#fee761'); }
    });
    // Sazlar (kumda kök salar)
    [[3, 30], [4, 46], [LW - 5, 36], [60, 2], [62, LH - 3], [7, 60], [LW - 6, 54], [100, LH - 3]].forEach(([x, y]) => {
      R(ctx, x, y - 4, 1, 5, LF[2]); R(ctx, x + 1, y - 6, 1, 7, LF[4]); R(ctx, x + 2, y - 3, 1, 4, LF[2]);
      R(ctx, x + 1, y - 8, 1, 3, PAL.wood[2]); R(ctx, x + 1, y - 8, 1, 1, PAL.wood[4]);
    });
    // Kumda çakıllar
    [[10, 8], [LW - 14, 9], [16, LH - 5], [LW - 22, LH - 4], [54, 1]].forEach(([x, y]) => { R(ctx, x, y, 2, 1, PAL.stone[4]); R(ctx, x, y + 1, 2, 1, DI[3]); });
  });
  // Terk edilmiş ev: çökmüş çatı, tahtalı pencere, sarmaşık
  addCanvas(scene, 'ruins', 48, 44, (ctx) => {
    const ST = PAL.stone, WD = PAL.wood;
    R(ctx, 4, 18, 40, 24, '#9a8a68'); for (let y = 21; y < 42; y += 4) R(ctx, 4, y, 40, 1, '#7d6f52');
    R(ctx, 4, 18, 1, 24, '#b0a07a'); R(ctx, 41, 18, 3, 24, '#7d6f52'); R(ctx, 4, 18, 40, 2, 'rgba(24,20,37,0.35)');
    [[10, 22], [26, 34], [36, 20], [14, 37]].forEach(([x, y]) => { R(ctx, x, y, 3, 1, '#6a5c42'); R(ctx, x + 1, y + 1, 1, 1, '#6a5c42'); }); // çatlaklar
    for (let i = 0; i < 16; i++) {
      const w = (4 + i * 2.8) * (i > 8 ? 0.55 : 1), x = 22 - i * 1.4;
      R(ctx, x, 2 + i, w, 1, i % 3 === 2 ? ST[1] : ST[2]); R(ctx, x, 2 + i, 2, 1, ST[3]);
    }
    R(ctx, 30, 10, 14, 8, '#1f1a24'); R(ctx, 32, 12, 2, 6, WD[2]); R(ctx, 38, 9, 2, 9, WD[2]); R(ctx, 38, 9, 1, 9, WD[3]); // açık çatı kirişleri
    R(ctx, 19, 29, 10, 13, '#2a1f1a'); R(ctx, 20, 30, 3, 12, WD[2]); R(ctx, 20, 30, 1, 12, WD[3]);
    R(ctx, 8, 24, 8, 7, '#1f1a24'); R(ctx, 7, 25, 10, 2, WD[3]); R(ctx, 7, 25, 10, 1, WD[4]); R(ctx, 7, 28, 10, 2, WD[2]); R(ctx, 7, 28, 10, 1, WD[3]);
    R(ctx, 32, 24, 8, 7, ST[2]); R(ctx, 33, 25, 3, 2, ST[5]); R(ctx, 36, 27, 1, 3, '#1f1a24'); R(ctx, 37, 26, 1, 1, '#1f1a24');
    // Sarmaşık ve otlar
    [[4, 32, 3, 10], [40, 30, 4, 12], [16, 18, 2, 6]].forEach(([x, y, w, h]) => { R(ctx, x, y, w, h, LF[2]); R(ctx, x, y, 1, h, LF[3]); R(ctx, x + 1, y - 2, w - 1, 2, LF[4]); });
    R(ctx, 12, 40, 6, 2, WD[2]); R(ctx, 30, 41, 7, 1, WD[2]);
    outline(ctx, 0, 0, 48, 44);
  });
  const chest = (key, open) => addCanvas(scene, key, 16, 16, (ctx) => {
    R(ctx, 2, 7, 12, 8, '#7a4a28'); R(ctx, 2, 7, 12, 1, '#a8693a'); R(ctx, 2, 14, 12, 1, '#4f2f18'); R(ctx, 13, 7, 1, 8, '#5e3a20');
    R(ctx, 2, 10, 12, 1, '#c9a443'); R(ctx, 2, 7, 1, 8, '#c9a443'); R(ctx, 13, 7, 1, 8, '#a8862f');
    if (open) { R(ctx, 2, 2, 12, 4, '#8a5530'); R(ctx, 2, 2, 12, 1, '#a8693a'); R(ctx, 3, 6, 10, 1, '#2a1a10'); R(ctx, 4, 7, 3, 1, '#fee761'); }
    else { R(ctx, 2, 4, 12, 4, '#8a5530'); R(ctx, 2, 4, 12, 1, '#b57a45'); R(ctx, 7, 7, 2, 3, '#e8c867'); R(ctx, 7, 7, 1, 1, '#fff3c0'); R(ctx, 3, 5, 1, 1, '#ffe8a3'); }
    outline(ctx, 0, 0, 16, 16);
    dropShadow(ctx, 8, 15, 6, 0, 0.3);
  });
  chest('chest', false); chest('chest_open', true);
  addCanvas(scene, 'debris', 16, 12, (ctx) => {
    R(ctx, 1, 6, 12, 2, '#8a5a3a'); R(ctx, 1, 6, 12, 1, '#a87048'); R(ctx, 4, 3, 2, 8, '#6b4429'); R(ctx, 4, 3, 1, 8, '#8a5a3a');
    R(ctx, 9, 8, 6, 2, '#a87048'); R(ctx, 9, 8, 6, 1, '#c9905e'); R(ctx, 2, 10, 4, 1, '#c8c8d0');
    outline(ctx, 0, 0, 16, 12);
  });
  addCanvas(scene, 'rubble', 16, 12, (ctx) => {
    const ST = PAL.stone;
    R(ctx, 2, 6, 5, 4, ST[3]); R(ctx, 2, 6, 5, 1, ST[4]); R(ctx, 8, 7, 6, 3, ST[2]); R(ctx, 8, 7, 6, 1, ST[4]);
    R(ctx, 5, 4, 4, 3, ST[4]); R(ctx, 5, 4, 3, 1, ST[5]); R(ctx, 10, 5, 2, 2, ST[3]);
    outline(ctx, 0, 0, 16, 12);
  });
  // Çiçek ve çalı süsleri: dört taç yapraklı çiçekler, yaprak ve gövdeyle
  const fl = [[PAL.flower[0], PAL.flower[1]], [PAL.flower[3], '#ffffff'], [PAL.flower[6], '#ffffff']];
  fl.forEach(([a, b], i) => addCanvas(scene, `flower_${i}`, 16, 16, (ctx) => {
    [[3, 8], [8, 5], [11, 10], [6, 11]].forEach(([x, y], k) => {
      const c = k % 2 ? b : a;
      R(ctx, x, y + 1, 1, 4, LF[2]); R(ctx, x + 1, y + 3, 1, 1, LF[4]); R(ctx, x - 1, y + 2, 1, 1, LF[3]);
      R(ctx, x - 1, y, 3, 1, c); R(ctx, x, y - 1, 1, 3, c); R(ctx, x - 1, y - 1, 1, 1, shade(c, 1.25)); R(ctx, x + 1, y + 1, 1, 1, shade(c, 0.75));
      R(ctx, x, y, 1, 1, c === PAL.flower[0] ? PAL.flower[1] : PAL.flower[0]);
    });
  }));
  addCanvas(scene, 'flower_3', 16, 16, (ctx) => {
    const m = (x, y) => [[8, 11, 4.4], [5, 12, 2.8], [11, 12, 2.8], [7, 9, 2.6]].some(([cx, cy, r]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) && y < 15;
    litFill(ctx, 16, 15, m, 5, 8, 8, [LF[1], LF[2], LF[3], LF[4], LF[5]], -0.1);
    outline(ctx, 0, 0, 16, 16, '#132a22');
    dropShadow(ctx, 8, 15, 5, 0, 0.28);
  });
  // Yabani ürünler (dünyada)
  addCanvas(scene, 'f_mushroom', 16, 16, (ctx) => {
    R(ctx, 4, 10, 2, 4, '#efe6d2'); R(ctx, 5, 10, 1, 4, '#cfc4ae'); R(ctx, 2, 7, 6, 3, '#d94f4f'); R(ctx, 3, 6, 4, 1, '#d94f4f'); R(ctx, 3, 6, 2, 1, '#f07a6a'); R(ctx, 3, 8, 1, 1, '#fff'); R(ctx, 6, 7, 1, 1, '#fff'); R(ctx, 2, 9, 6, 1, '#a8323b');
    R(ctx, 10, 11, 2, 3, '#efe6d2'); R(ctx, 8, 9, 6, 2, '#c98b3a'); R(ctx, 9, 8, 4, 1, '#c98b3a'); R(ctx, 9, 8, 2, 1, '#e0ab5e'); R(ctx, 10, 9, 1, 1, '#f2d29b');
    outline(ctx, 0, 0, 16, 16);
    dropShadow(ctx, 8, 14, 6, 0, 0.25);
  });
  addCanvas(scene, 'f_berry', 16, 16, (ctx) => {
    const m = (x, y) => [[8, 9.5, 5.2], [5, 10.5, 3.6], [11, 10.5, 3.6], [8, 6.5, 3.6]].some(([cx, cy, r]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) && y < 14;
    litFill(ctx, 16, 14, m, 5, 5, 10, [LF[0], LF[1], LF[2], LF[3], LF[4]], -0.2);
    [[4, 9], [7, 7], [10, 10], [11, 7], [6, 11], [8, 10]].forEach(([x, y]) => { R(ctx, x, y, 2, 2, '#3a1f5a'); R(ctx, x, y, 1, 1, '#a868d0'); });
    outline(ctx, 0, 0, 16, 16, '#132a22');
    dropShadow(ctx, 8, 14, 6, 0, 0.28);
  });
  // Hava efektleri
  addCanvas(scene, 'fx_rain', 1, 6, (ctx) => { R(ctx, 0, 0, 1, 2, 'rgba(200,225,255,0.35)'); R(ctx, 0, 2, 1, 4, 'rgba(210,232,255,0.85)'); });
  addCanvas(scene, 'fx_snow', 2, 2, (ctx) => R(ctx, 0, 0, 2, 2, 'rgba(255,255,255,0.95)'));
  const { c, ctx } = makeCanvas(128, 128);
  const blob = (x, y, r, a) => {
    for (const dx of [-128, 0, 128]) for (const dy of [-128, 0, 128]) {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, `rgba(225,232,240,${a})`); g.addColorStop(1, 'rgba(225,232,240,0)');
      ctx.fillStyle = g; ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    }
  };
  ctx.fillStyle = 'rgba(215,222,232,0.35)'; ctx.fillRect(0, 0, 128, 128);
  [[20, 30, 40, 0.6], [80, 20, 34, 0.5], [60, 80, 48, 0.55], [110, 100, 36, 0.5], [16, 100, 30, 0.45], [100, 60, 26, 0.4]].forEach((b) => blob(...b));
  if (scene.textures.exists('fog_tile')) scene.textures.remove('fog_tile');
  scene.textures.addCanvas('fog_tile', c);

  // Eşya ikonları
  const icon = (key, fn) => addCanvas(scene, key, 16, 16, fn);
  icon('i_rod', (ctx) => {
    for (let i = 0; i < 12; i++) R(ctx, 2 + i, 14 - i, 1, 2, i < 4 ? '#5d3c27' : '#a87048');
    R(ctx, 3, 11, 3, 3, '#3a3a44'); R(ctx, 4, 12, 1, 1, '#9aa3ad');
    R(ctx, 14, 3, 1, 9, 'rgba(240,240,255,0.8)'); R(ctx, 13, 12, 1, 2, '#c8c8d0'); R(ctx, 12, 13, 1, 1, '#c8c8d0'); R(ctx, 14, 8, 2, 2, '#e05a4f');
  });
  const fish = (key, body, belly, fin, stripes, shine) => icon(key, (ctx) => {
    R(ctx, 3, 6, 9, 5, body); R(ctx, 4, 5, 6, 1, body); R(ctx, 4, 11, 6, 1, body); R(ctx, 4, 9, 7, 2, belly);
    R(ctx, 12, 7, 1, 3, body); R(ctx, 13, 5, 2, 3, fin); R(ctx, 13, 9, 2, 3, fin); R(ctx, 6, 4, 3, 1, fin);
    R(ctx, 4, 7, 1, 1, '#1b1622'); R(ctx, 2, 8, 1, 1, body);
    if (stripes) [6, 8, 10].forEach((x) => R(ctx, x, 6, 1, 3, stripes));
    if (shine) { R(ctx, 13, 1, 1, 1, '#fff'); R(ctx, 1, 4, 1, 1, '#fff8c0'); R(ctx, 7, 6, 2, 1, '#fff3c0'); }
  });
  fish('i_fish_carp', '#9c8a5a', '#d9c99a', '#7a6a40');
  fish('i_fish_bass', '#5d7f5a', '#c9d9b0', '#3f5f3e', '#3f5f3e');
  fish('i_fish_gold', '#f0a020', '#ffe08a', '#e05a1f', null, true);
  icon('i_fish_grilled', (ctx) => {
    R(ctx, 1, 11, 14, 3, '#e6edf3'); R(ctx, 2, 14, 12, 1, '#9aa3ad');
    R(ctx, 3, 6, 9, 5, '#a8693a'); R(ctx, 4, 5, 6, 1, '#a8693a'); R(ctx, 12, 7, 2, 3, '#7a4a28'); R(ctx, 14, 5, 1, 7, '#7a4a28');
    [5, 7, 9].forEach((x) => R(ctx, x, 6, 1, 4, '#5d3c27')); R(ctx, 4, 7, 1, 1, '#1b1622'); R(ctx, 2, 4, 1, 2, 'rgba(255,255,255,0.5)');
  });
  icon('i_mushroom', (ctx) => { R(ctx, 6, 9, 4, 6, '#efe6d2'); R(ctx, 2, 4, 12, 5, '#d94f4f'); R(ctx, 4, 2, 8, 2, '#d94f4f'); R(ctx, 4, 4, 2, 2, '#fff'); R(ctx, 10, 3, 2, 2, '#fff'); R(ctx, 8, 6, 1, 1, '#fff'); });
  icon('i_berry', (ctx) => {
    [[3, 6], [7, 4], [10, 7], [5, 10], [9, 11]].forEach(([x, y]) => { R(ctx, x, y, 4, 4, '#3a1f5a'); R(ctx, x + 1, y, 2, 1, '#7b4fa0'); R(ctx, x, y + 1, 1, 1, '#7b4fa0'); });
    R(ctx, 8, 1, 1, 3, '#4f7f3a'); R(ctx, 9, 1, 3, 2, '#6fbf5a');
  });
}

// ---------------- Arayüz (rozet + paneller) ----------------
const CSS = `
#wx-badge { position: absolute; top: 14px; left: 14px; padding: 6px 10px; display: none; flex-direction: column; gap: 1px;
  font-size: 12px; line-height: 1.25; pointer-events: auto; cursor: pointer; min-width: 92px; }
#wx-badge.show { display: flex; }
#wx-badge b { font-weight: 600; } #wx-badge .s { color: var(--muted); font-size: 11px; }
#wx-badge:active { transform: scale(0.97); }
@media (max-width: 900px) {
  #wx-badge { top: calc(env(safe-area-inset-top, 0px) + 62px); left: 8px; padding: 4px 8px; font-size: 11px; min-width: 0; }
  #wx-badge .s { font-size: 10px; }
}
/* mobile.css alt sayfa genişliği #modal-feature { width: 560px } kuralına yeniliyordu (ID özgüllüğü) */
body.is-touch.portrait #modal-feature { width: 100%; }
.wx-info { display: grid; gap: 10px; font-size: 14px; }
.wx-info .row { display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 10px; background: rgba(255,255,255,0.05); }
.wx-info .ic { font-size: 26px; line-height: 1; } .wx-info p { color: var(--muted); font-size: 13px; margin-top: 2px; }
.wx-seasons { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; text-align: center; font-size: 12px; }
.wx-seasons div { padding: 6px 2px; border-radius: 8px; background: rgba(255,255,255,0.04); }
.wx-seasons .on { background: rgba(255,209,102,0.18); outline: 1px solid rgba(255,209,102,0.5); }
.fish-wrap { display: grid; grid-template-columns: 64px 18px minmax(0, 1fr); gap: 12px; align-items: stretch; touch-action: none; user-select: none; -webkit-user-select: none; }
.fish-track { position: relative; height: 230px; border-radius: 12px; background: linear-gradient(#2f6aa8, #1d4a7c); overflow: hidden; border: 1px solid var(--stroke); }
.fish-zone { position: absolute; left: 4px; right: 4px; bottom: 0; border-radius: 8px; background: rgba(110,224,110,0.35); border: 2px solid rgba(110,224,110,0.9); transition: background 0.1s; }
.fish-zone.in { background: rgba(110,224,110,0.6); }
.fish-fish { position: absolute; left: 50%; bottom: 0; width: 26px; height: 26px; margin-left: -13px; image-rendering: pixelated; }
.fish-prog { position: relative; height: 230px; border-radius: 99px; background: rgba(255,255,255,0.1); overflow: hidden; }
.fish-prog i { position: absolute; left: 0; right: 0; bottom: 0; height: 20%; background: linear-gradient(0deg, #ffd166, #6ee06e); border-radius: inherit; }
.fish-side { display: flex; flex-direction: column; gap: 10px; justify-content: space-between; font-size: 13px; min-width: 0; overflow-wrap: anywhere; }
.fish-side .msg { font-size: 15px; font-weight: 600; min-height: 40px; }
.fish-btn { width: 100%; min-height: 64px; font-size: 16px; border-radius: 14px; touch-action: none; }
.fish-btn.hold { filter: brightness(1.25); transform: scale(0.98); }
`;

function ensureBadge(scene) {
  injectCSS('world', CSS);
  const layer = featureLayer();
  if (!layer) return null;
  let b = document.getElementById('wx-badge');
  if (!b) { b = el('div', 'glass', ''); b.id = 'wx-badge'; layer.appendChild(b); }
  b.onclick = () => { if (scene.started && !scene.hud.isModalOpen()) openInfo(scene); };
  return b;
}

function renderBadge(scene) {
  const st = scene._world, b = st?.badge;
  if (!b) return;
  const t = scene.timeSys, w = WEATHERS[st.weather], s = t.seasonInfo;
  const icon = st.weather === 'clear' && t.isNight ? '🌙' : w.icon;
  const name = st.weather === 'rain' && t.season === 'winter' ? 'Kar' : w.name;
  const html = `<b>${icon} ${name}</b><span class="s">${s.icon} ${s.name} ${t.seasonDay}/${SEASON_DAYS}</span>`;
  if (html !== st.badgeHTML) { st.badgeHTML = html; b.innerHTML = html; }
  b.classList.add('show');
}

function openInfo(scene) {
  const st = scene._world, t = scene.timeSys;
  const w = WEATHERS[st.weather], n = WEATHERS[st.next] || WEATHERS.clear;
  const snow = t.season === 'winter';
  const label = (x) => (x.id === 'rain' && snow ? 'Kar' : x.name);
  const body = el('div', 'wx-info', `
    <div class="row"><span class="ic">${w.icon}</span><div><b>Bugün: ${label(w)}</b><p>${w.desc}</p></div></div>
    <div class="row"><span class="ic">${n.icon}</span><div><b>Yarın: ${label(n)}</b><p>Hava tahmini (değişebilir).</p></div></div>
    <div class="row"><span class="ic">${t.seasonInfo.icon}</span><div><b>${t.seasonInfo.name} · ${t.seasonDay}/${SEASON_DAYS}. gün · ${t.year}. yıl</b><p>${SEASON_FX[t.season].desc}</p></div></div>
    <div class="wx-seasons">${SEASONS.map((s, i) => `<div class="${i === t.seasonIndex ? 'on' : ''}">${s.icon}<br>${s.name}</div>`).join('')}</div>
    <p class="muted" style="font-size:12px">İpucu: Olta ile göl kenarında (sol alt) balık tut. Ağaç diplerinde mantar, çalılarda böğürtlen topla. Doğudaki terk edilmiş evin sandığı her gün yenilenir.</p>`);
  scene.hud.openPanel('Hava & Mevsim', body);
}

// ---------------- Hava durumu ----------------
function rollWeather(season) {
  const odds = WEATHER_ODDS[season] || WEATHER_ODDS.spring;
  const ids = ['clear', 'rain', 'fog', 'storm'];
  let r = Math.random();
  for (let i = 0; i < ids.length; i++) { r -= odds[i]; if (r < 0) return ids[i]; }
  return 'clear';
}

const isWet = (w) => w === 'rain' || w === 'storm';

function setWeather(scene, type, silent) {
  const st = scene._world;
  if (!WEATHERS[type]) type = 'clear';
  const changed = st.weather !== type;
  st.weather = type;
  scene.weather = type;
  scene.weatherInfo = WEATHERS[type];
  scene.timeSys.weatherDim = WEATHERS[type].dim;
  st.lightMul = type === 'fog' ? FOG_LIGHT : 1;
  st.boltTimer = Phaser.Math.FloatBetween(6, 14);
  const snow = scene.timeSys.season === 'winter';
  const wet = isWet(type);
  st.rain.emitting = false; st.snow.emitting = false;
  if (wet) { if (snow) st.snow.start(); else st.rain.start(); }
  else { st.rain.stop(); st.snow.stop(); }
  st.fog.setVisible(type === 'fog');
  if (wet) waterFarm(scene);
  renderBadge(scene);
  if (changed || !silent) scene.events.emit('weatherChanged', type, WEATHERS[type]);
  if (!silent) {
    const w = WEATHERS[type];
    if (type === 'rain') scene.toastAll(snow ? '❄️ Kar yağıyor. Tarla nemli kalacak.' : '🌧️ Yağmur yağıyor: tarlan kendiliğinden sulanıyor!', 'info');
    else if (type === 'storm') scene.toastAll('⛈️ Fırtına! Tarla sulandı ama bu gece zombiler daha hızlı.', 'warn');
    else if (type === 'fog') scene.toastAll('🌫️ Sisli bir gün. Zombiler seni zor fark eder.', 'info');
    else if (Math.random() < 0.3) scene.toastAll(`${w.icon} Hava açık. Ekinlerini sulamayı unutma.`, 'info');
  }
}

// Yağmurda tüm sürülmüş toprak sulanır
function waterFarm(scene) {
  const farm = scene.farm;
  if (!farm?.plots) return 0;
  let n = 0;
  for (const p of farm.plots.values()) if (!p.watered && farm.water(p.tx, p.ty)) n++;
  return n;
}

// Kamera görüş alanı değişince yağmur alanını ve ömrünü güncelle (scrollFactor 0 koordinatları)
function fitRain(scene) {
  const st = scene._world, cam = scene.cameras.main;
  const key = `${cam.width}x${cam.height}@${cam.zoom}`;
  if (key === st.camKey) return;
  st.camKey = key;
  const vw = cam.width / cam.zoom, vh = cam.height / cam.zoom;
  const x0 = cam.width / 2 - vw / 2, y0 = cam.height / 2 - vh / 2;
  st.rainRect.setTo(x0 - 10, y0 - 12, vw + 50, 6);
  st.snowRect.setTo(x0 - 20, y0 - 8, vw + 40, 4);
  const touch = window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 700;
  const maxRain = touch ? 60 : 150, maxSnow = touch ? 50 : 110;
  const rainLife = ((vh + 24) / 360) * 1000, snowLife = ((vh + 16) / 55) * 1000;
  st.rain.setParticleLifespan(rainLife); st.rain.maxAliveParticles = maxRain; st.rain.setFrequency(rainLife / maxRain, 1);
  st.snow.setParticleLifespan(snowLife); st.snow.maxAliveParticles = maxSnow; st.snow.setFrequency(snowLife / maxSnow, 1);
}

function thunder(scene) {
  const st = scene._world;
  scene.cameras.main.flash(160, 225, 232, 255);
  scene.time.delayedCall(Phaser.Math.Between(250, 900), () => {
    audio.noise({ dur: 0.5, vol: 0.55, freq: 220 });
    audio.noise({ dur: 0.5, vol: 0.4, freq: 130, delay: 0.3 });
    audio.tone({ type: 'sawtooth', freq: 60, to: 30, dur: 0.9, vol: 0.12 });
  });
  // Gece ekrandaki bir zombiye yıldırım düşebilir (misafirde yalnızca görsel şimşek; hasar host'ta)
  if (scene.net?.isGuest || !scene.timeSys.isNight || Math.random() > 0.4) return;
  const v = scene.cameras.main.worldView;
  const list = scene.zombies.getChildren().filter((z) => !z.dead && v.contains(z.x, z.y));
  if (!list.length) return;
  const z = Phaser.Utils.Array.GetRandom(list);
  const g = scene.add.graphics().setDepth(20001);
  g.lineStyle(2, 0xf4f7ff, 1);
  g.beginPath();
  let x = z.x + Phaser.Math.Between(-20, 20), y = v.y - 4;
  g.moveTo(x, y);
  while (y < z.y - 8) { y += Phaser.Math.Between(10, 22); x += Phaser.Math.Between(-8, 8); g.lineTo(x, Math.min(y, z.y)); }
  g.lineTo(z.x, z.y);
  g.strokePath();
  scene.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  scene.spawnParticles(z.x, z.y, 0xfff3a0, 10);
  z.takeDamage(8 + (scene.waves?.wave || 0) * 2, null);
  st.strikes = (st.strikes || 0) + 1;
}

// ---------------- Yabani ürünler ----------------
const FORAGE_KINDS = { mushroom: 'f_mushroom', berry: 'f_berry' };

function addForage(scene, kind, tx, ty) {
  const st = scene._world;
  const x = tx * TILE + 8, y = ty * TILE + 10;
  const sprite = scene.add.image(x, y, FORAGE_KINDS[kind]).setDepth(y - 2);
  st.forage.push({ kind, tx, ty, x, y, sprite });
}

function clearForage(scene) {
  const st = scene._world;
  st.forage.forEach((f) => f.sprite?.destroy());
  st.forage = [];
}

function freeTile(scene, tx, ty) {
  if (tx < 1 || ty < 2 || tx >= MAP_W - 1 || ty >= MAP_H - 1) return false;
  const fz = FARM_ZONE;
  if (tx >= fz.x - 1 && ty >= fz.y - 1 && tx <= fz.x + fz.w && ty <= fz.y + fz.h) return false;
  if (scene.farm.get(tx, ty)) return false;
  if (tx >= 24 && ty >= 9 && tx < 58 && ty < 36) return false;              // kasaba
  const t = scene.layer.getTileAt(tx, ty);
  if (!t || t.index > 2) return false;                                       // yalnızca çimen
  const tr = new Phaser.Geom.Rectangle(tx * TILE - 4, ty * TILE - 4, 24, 24);
  if ((scene.lakeRects || [scene.lakeRect]).some((r) => r && Phaser.Geom.Rectangle.Overlaps(r, tr))) return false;
  if (scene._world.forage.some((f) => f.tx === tx && f.ty === ty)) return false;
  return scene.physics.overlapRect(tx * TILE + 2, ty * TILE + 4, 12, 10, false, true).length === 0;
}

function spawnForage(scene, count) {
  const st = scene._world;
  count = Math.min(count, MAX_FORAGE - st.forage.length);
  const season = scene.timeSys.season;
  const berryOdds = { spring: 0.4, summer: 0.7, autumn: 0.3, winter: 0 }[season] ?? 0.4;
  const trees = scene.resources.getChildren().filter((r) => r.kind === 'tree' && !r.depleted);
  let tries = 0;
  while (count > 0 && tries++ < 300) {
    const kind = Math.random() < berryOdds ? 'berry' : 'mushroom';
    let tx, ty;
    if (kind === 'mushroom' && trees.length) {
      const t = Phaser.Utils.Array.GetRandom(trees);
      tx = Math.floor(t.x / TILE) + Phaser.Math.Between(-1, 1); ty = Math.floor(t.y / TILE) + Phaser.Math.Between(0, 1);
    } else { tx = Phaser.Math.Between(1, MAP_W - 2); ty = Phaser.Math.Between(2, MAP_H - 2); }
    if (!freeTile(scene, tx, ty)) continue;
    addForage(scene, kind, tx, ty);
    count--;
  }
}

function pickForage(scene, f) {
  const st = scene._world;
  const i = st.forage.indexOf(f);
  if (i < 0) return;
  st.forage.splice(i, 1);
  const qty = f.kind === 'berry' ? Phaser.Math.Between(2, 4) : Phaser.Math.Between(1, 2);
  scene.giveItem(f.kind, qty);
  scene.floatText(f.x, f.y - 10, `+${qty} ${ITEMS[f.kind].name}`, '#c9ffb0');
  scene.spawnParticles(f.x, f.y - 2, f.kind === 'berry' ? 0x7b4fa0 : 0xd94f4f, 6);
  audio.sfx('harvest');
  scene.tweens.add({ targets: f.sprite, scale: 0, alpha: 0, duration: 180, onComplete: () => f.sprite.destroy() });
  scene.events.emit('foraged', f.kind, qty);
  scene.hud.refreshInventory?.();
}

// ---------------- Terk edilmiş ev sandığı ----------------
function openChest(scene) {
  const st = scene._world, c = scene.ruinChest;
  if (!c || !st.chestReady) return;
  st.chestReady = false;
  c.setTexture('chest_open');
  const pool = [];
  CHEST_LOOT.forEach(([e, w]) => { for (let i = 0; i < w; i++) pool.push(e); });
  const picks = new Set();
  const n = Math.random() < 0.3 ? 3 : 2;
  while (picks.size < n) picks.add(Phaser.Utils.Array.GetRandom(pool));
  const got = [];
  picks.forEach(([id, a, b]) => {
    const q = Phaser.Math.Between(a, b);
    if (id === 'coins') { scene.player.addCoins(q); got.push(`${q}🪙`); }
    else if (ITEMS[id]) { scene.giveItem(id, q); got.push(`${q}× ${ITEMS[id].name}`); }
  });
  // Nadiren sandıkta olta bulunur
  if (!scene.inventory.count('fishing_rod') && Math.random() < 0.08) { scene.giveItem('fishing_rod', 1); got.push('Olta!'); }
  audio.sfx('coin');
  scene.spawnParticles(c.x, c.y - 4, 0xffd166, 10);
  scene.hud.toast(`📦 Sandıktan çıktı: ${got.join(', ')}`, 'ok');
  scene.events.emit('chestOpened', got);
  scene.hud.refreshInventory?.();
}

// ---------------- Balık tutma ----------------
// Haritadaki tüm göllerin (scene.lakeRects) en yakınına uzaklık
function lakeDist(scene) {
  const p = scene.player, lakes = scene.lakeRects || (scene.lakeRect ? [scene.lakeRect] : []);
  if (!lakes.length || !p) return Infinity;
  const px = p.x, py = p.y + 4;
  let best = Infinity;
  for (const r of lakes) {
    const dx = Math.max(r.x - px, 0, px - r.right), dy = Math.max(r.y - py, 0, py - r.bottom);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

function tryFish(scene, fromItem) {
  if (scene.hud.isModalOpen() || !scene.player.alive) return;
  if (lakeDist(scene) > 18) {
    if (fromItem) { scene.hud.notice('Olta için bir gölün kıyısına git (köyün sol altı ya da doğu/güney kırları).'); audio.sfx('error'); }
    return;
  }
  if (!scene.player.useEnergy(3)) return;
  // Çok oyunculu misafir: mini oyun misafirin ekranında oynanır, balığı host seçer ve sonucu doğrular
  const p = scene.player;
  if (p.netRemote?.send) {
    const fish = pickFish(scene);
    p.netFish = { id: fish.id, at: performance.now() };
    p.netRemote.send({ t: 'fish', id: fish.id });
    return;
  }
  startFishing(scene);
}

// Yakalanan balığın ödülü (bağlamdaki oyuncuya)
function rewardFish(scene, fish) {
  const item = ITEMS[fish.id];
  scene.giveItem(fish.id, 1);
  scene.floatText(scene.player.x, scene.player.y - 14, `+1 ${item.name}`, fish.id === 'fish_gold' ? '#ffd166' : '#9fd0f0');
  audio.sfx(fish.id === 'fish_gold' ? 'quest' : 'harvest');
  scene.events.emit('fishCaught', fish.id);
  if (fish.id === 'fish_gold') scene.hud.toast('✨ Altın balık! Çok nadir bir av.', 'ok');
}

// Host: misafirin mini oyun sonucu (misafir bağlamında). Süre makul değilse (hile/eski istek) yok sayılır.
function onFishResult(scene, m) {
  const p = scene.player, f = p.netFish;
  if (!f) return;
  p.netFish = null;
  const dt = performance.now() - f.at;
  const fish = FISH.find((x) => x.id === f.id);
  if (!fish || !m.ok || dt < 1200 || dt > 30000) return;
  rewardFish(scene, fish);
}

function pickFish(scene) {
  const wet = isWet(scene._world.weather), night = scene.timeSys.isNight;
  const r = Math.random();
  const gold = 0.05 + (night ? 0.02 : 0), bass = 0.30 + (wet ? 0.12 : 0);
  if (r < gold) return FISH[0];
  if (r < gold + bass) return FISH[1];
  return FISH[2];
}

// onResult verilirse (çok oyunculu misafir) ödül yerelde verilmez, sonuç host'a bildirilir
function startFishing(scene, fish = pickFish(scene), onResult = null) {
  const body = el('div', '', `
    <div class="fish-wrap">
      <div class="fish-track"><div class="fish-zone"></div><img class="fish-fish" alt=""></div>
      <div class="fish-prog"><i></i></div>
      <div class="fish-side">
        <div class="msg">Bir şey oltaya takıldı!</div>
        <div class="muted">Butonu <b>basılı tut</b> (veya Boşluk): yeşil alan yükselir. Bırakınca düşer. Balığı alanın içinde tutarak çubuğu doldur.</div>
        <button class="fish-btn primary">🎣 Çek</button>
      </div>
    </div>`);
  const $ = (s) => body.querySelector(s);
  const zoneEl = $('.fish-zone'), fishEl = $('.fish-fish'), progEl = $('.fish-prog i'), msgEl = $('.msg'), btn = $('.fish-btn');
  fishEl.src = scene.hud.icon ? scene.hud.icon(fish.id) : '';
  const TRACK = 230, FISH_PX = 26;
  // Alan balığın altında başlar; ilk 1.2 sn ilerleme düşmez (oyuncu panele alışsın)
  const g = { zone: 0.5 - fish.zone / 2, zv: 0, size: fish.zone, fishY: 0.5, fishT: 0.5, fishTimer: 1.2, prog: 0.3, hold: false, time: 0, done: false, raf: 0, last: performance.now() };
  zoneEl.style.height = `${g.size * TRACK}px`;

  const setHold = (v) => { g.hold = v; btn.classList.toggle('hold', v); };
  const down = (e) => { e.preventDefault(); setHold(true); };
  const up = () => setHold(false);
  const key = (e) => { if (e.code === 'Space') { e.preventDefault(); setHold(e.type === 'keydown'); } };
  body.addEventListener('pointerdown', down);
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  window.addEventListener('keydown', key); window.addEventListener('keyup', key);
  const cleanup = () => {
    g.done = true; cancelAnimationFrame(g.raf);
    window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    window.removeEventListener('keydown', key); window.removeEventListener('keyup', key);
  };

  const finish = (ok) => {
    if (g.done) return;
    g.done = true;
    cancelAnimationFrame(g.raf);
    if (onResult) onResult(ok);
    if (ok) {
      const item = ITEMS[fish.id];
      msgEl.innerHTML = `🎉 ${item.name} yakaladın!`;
      if (!onResult) rewardFish(scene, fish);
    } else {
      msgEl.textContent = '💨 Balık kaçtı…';
      audio.sfx('error');
    }
    setTimeout(() => { if (scene.hud.isModalOpen() && scene.hud.modal === 'feature' && body.isConnected) scene.hud.closeAll(); }, 950);
  };

  const step = (now) => {
    if (g.done) return;
    const dt = Math.min(0.05, (now - g.last) / 1000);
    g.last = now; g.time += dt;
    // Oyuncu alanı: basılıyken yükselir, bırakınca düşer (yumuşak fizik)
    g.zv += (g.hold ? 2.4 : -2.0) * dt;
    g.zv = Phaser.Math.Clamp(g.zv, -1.1, 1.1);
    g.zone += g.zv * dt;
    if (g.zone < 0) { g.zone = 0; g.zv = Math.max(0, g.zv) * -0.3; }
    if (g.zone > 1 - g.size) { g.zone = 1 - g.size; g.zv = Math.min(0, g.zv) * -0.3; }
    // Balık: rastgele hedeflere atılır
    g.fishTimer -= dt;
    if (g.fishTimer <= 0) { g.fishTimer = Phaser.Math.FloatBetween(0.35, 1.2) / fish.speed; g.fishT = Phaser.Math.FloatBetween(0.05, 0.95); }
    g.fishY += (g.fishT - g.fishY) * Math.min(1, dt * 2.2 * fish.speed);
    const fc = (g.fishY * (TRACK - FISH_PX) + FISH_PX / 2) / TRACK; // balığın merkezi (0..1)
    const inZone = fc >= g.zone && fc <= g.zone + g.size;
    if (inZone) g.prog += dt / 2;            // ~2 sn alanda tut
    else if (g.time > 1.2) g.prog -= dt / 4;
    zoneEl.style.transform = `translateY(${-g.zone * TRACK}px)`;
    zoneEl.classList.toggle('in', inZone);
    fishEl.style.transform = `translateY(${-(g.fishY * (TRACK - FISH_PX))}px)`;
    progEl.style.height = `${Phaser.Math.Clamp(g.prog, 0, 1) * 100}%`;
    if (g.prog >= 1) return finish(true);
    if (g.prog <= 0 || g.time > 20) return finish(false);
    g.raf = requestAnimationFrame(step);
  };
  scene.hud.openPanel(`🎣 Balık Tutma · ${fish.label === 'Altın Balık' ? 'Güçlü bir çekiş!' : 'Göl'}`, body, cleanup);
  g.raf = requestAnimationFrame(step);
  audio.sfx('water');
}

// ---------------- Misafir (çok oyunculu) ----------------
// Host'tan gelen hava durumunu yalnızca görsel olarak uygula (tarla sulama/olay/bildirim host'ta)
function applyWeatherVisual(scene, type) {
  const st = scene._world;
  if (!WEATHERS[type]) type = 'clear';
  st.weather = type;
  scene.weather = type;
  scene.weatherInfo = WEATHERS[type];
  st.lightMul = type === 'fog' ? FOG_LIGHT : 1;
  const snow = scene.timeSys.season === 'winter', wet = isWet(type);
  st.rain.emitting = false; st.snow.emitting = false;
  if (wet) { if (snow) st.snow.start(); else st.rain.start(); }
  else { st.rain.stop(); st.snow.stop(); }
  st.fog.setVisible(type === 'fog');
  st.wetKey = `${type}|${snow}`;
  renderBadge(scene);
}

// Görsel kare güncellemesi (host'ta update içinde, misafirde guestUpdate)
function updateVisuals(scene) {
  const st = scene._world, v = scene.cameras.main.worldView;
  st.seasonRect.setPosition(v.x - 2, v.y - 2).setSize(v.width + 4, v.height + 4);
  if (st.fog.visible) {
    const w = Math.ceil(v.width) + 4, h = Math.ceil(v.height) + 4;
    if (st.fog.width !== w || st.fog.height !== h) st.fog.setSize(w, h);
    st.fog.setPosition(v.x - 2, v.y - 2);
    st.fog.tilePositionX = v.x * 0.9 + scene.time.now * 0.006;
    st.fog.tilePositionY = v.y * 0.9 + Math.sin(scene.time.now / 4000) * 6;
    st.fog.setAlpha(scene.timeSys.isNight ? 0.45 : 0.7);
  }
  if (st.rain.emitting || st.snow.emitting) fitRain(scene);
}

// ---------------- Mevsim görselleri ----------------
function applySeason(scene) {
  const st = scene._world, fx = SEASON_FX[scene.timeSys.season] || SEASON_FX.spring;
  st.seasonRect.setFillStyle(fx.color, fx.alpha);
  scene.resources.getChildren().forEach((r) => { if (r.kind === 'tree') { if (fx.tree === 0xffffff) r.clearTint(); else r.setTint(fx.tree); } });
  scene.decorBushes?.forEach((b) => { if (fx.tree === 0xffffff) b.clearTint(); else b.setTint(fx.tree); });
  renderBadge(scene);
}

// ---------------- Modül ----------------
export default {
  id: 'world',

  textures(scene) { makeWorldTextures(scene); },

  init(scene) {
    const st = scene._world = {
      weather: 'clear', next: 'clear', forage: [], chestReady: true, loaded: false,
      lightMul: 1, boltTimer: 10, boostTimer: 0, camKey: '', badgeHTML: '',
      rainRect: new Phaser.Geom.Rectangle(0, 0, 10, 4), snowRect: new Phaser.Geom.Rectangle(0, 0, 10, 4)
    };
    scene.weather = 'clear';
    scene.weatherInfo = WEATHERS.clear;
    scene.setWeather = (type, silent) => setWeather(scene, type, silent); // olaylar (events.js: sisli gece) kullanır

    // Katmanlar: mevsim zemin tonu (zeminin hemen üstü), sis (karanlığın altı), yağmur/kar (ekran sabit)
    st.seasonRect = scene.add.rectangle(0, 0, 10, 10, 0xffffff, 0).setOrigin(0, 0).setDepth(-9.5);
    st.fog = scene.add.tileSprite(0, 0, 32, 32, 'fog_tile').setOrigin(0, 0).setDepth(19990).setVisible(false);
    st.rain = scene.add.particles(0, 0, 'fx_rain', {
      emitZone: { type: 'random', source: st.rainRect }, speedY: { min: 330, max: 400 }, speedX: { min: -55, max: -40 },
      rotate: 7, alpha: { start: 0.85, end: 0.4 }, lifespan: 1000, frequency: 10, quantity: 1, emitting: false
    }).setScrollFactor(0).setDepth(19995);
    st.snow = scene.add.particles(0, 0, 'fx_snow', {
      emitZone: { type: 'random', source: st.snowRect }, speedY: { min: 40, max: 70 }, speedX: { min: -18, max: 12 },
      scale: { min: 0.5, max: 1 }, alpha: { start: 0.95, end: 0.6 }, lifespan: 6000, frequency: 60, quantity: 1, emitting: false
    }).setScrollFactor(0).setDepth(19995);

    // Sisli havada ışık yarıçapı küçülür: ışık damgasının ölçeğini çarpanla küçült (GameScene'e dokunmadan)
    const stamp = scene.lightStamp;
    if (stamp && !stamp._wxPatched) {
      const orig = stamp.setScale.bind(stamp);
      stamp.setScale = (x, y) => orig(x * (scene._world?.lightMul || 1), (y ?? x) * (scene._world?.lightMul || 1));
      stamp._wxPatched = true;
    }

    // Etkileşimler (E / mobil eylem butonu)
    scene.addInteraction((s) => {
      const p = s.player, w = s._world;
      let best = null, bd = 20;
      for (const f of w.forage) {
        const d = Math.abs(f.x - p.x) + Math.abs(f.y - (p.y + 4));
        if (d < bd) { bd = d; best = f; }
      }
      return best ? { dist: bd, label: `${ITEMS[best.kind].name} topla`, run: () => pickForage(s, best) } : null;
    });
    scene.addInteraction((s) => {
      const c = s.ruinChest;
      if (!c || !s._world.chestReady) return null;
      const d = Phaser.Math.Distance.Between(s.player.x, s.player.y, c.x, c.y);
      return d < 26 ? { dist: d, label: 'Sandığı aç', run: () => openChest(s) } : null;
    });
    scene.addInteraction((s) => {
      if (!(s.lakeRects || [s.lakeRect]).some((r) => r && Math.abs(s.player.x - r.centerX) < 120 && Math.abs(s.player.y - r.centerY) < 90)) return null;
      const d = lakeDist(s);
      if (d > 18 || !s.inventory.count('fishing_rod')) return null;
      return { dist: d + 6, label: 'Balık tut', run: () => tryFish(s, false) };
    });

    // Olaylar
    const ts = scene.timeSys;
    ts.on('dawn', () => {
      const today = st.next || rollWeather(ts.season);
      st.next = rollWeather(ts.season);
      st.chestReady = true;
      scene.ruinChest?.setTexture('chest');
      spawnForage(scene, Phaser.Math.Between(6, 10));
      setWeather(scene, today, false);
    });
    ts.on('hour', () => {
      if (isWet(st.weather)) waterFarm(scene);  // yeni sürülen toprak da ıslanır
      renderBadge(scene);
    });
    ts.on('dusk', () => renderBadge(scene));
    ts.on('seasonChanged', (season, idx) => {
      applySeason(scene);
      if (st.weather === 'rain' || st.weather === 'storm') setWeather(scene, st.weather, true); // yağmur ↔ kar
      scene.events.emit('seasonChanged', season, idx);
      const s = SEASONS[idx];
      scene.time.delayedCall(3500, () => scene.hud.banner(`${s.icon} ${s.name}`, SEASON_FX[season].desc));
    });
    scene.events.once('shutdown', () => ['weatherChanged', 'seasonChanged', 'foraged', 'fishCaught', 'chestOpened'].forEach((e) => scene.events.off(e)));

    scene.featureMenu.push({ id: 'world', icon: '🌦️', label: 'Hava & Mevsim', open: (s) => openInfo(s) });
    st.badge = ensureBadge(scene);
    if (st.badge) st.badge.classList.remove('show');
    // Yerel görsel katmanlar: misafirde de görünür kalsın (host bunları zaten aynalamaz)
    [st.seasonRect, st.fog, st.rain, st.snow].forEach((o) => { o.netLocal = true; });

    // Çok oyunculu: misafirin balık tutma mini oyunu
    const onNet = (m) => {
      if (m?.t !== 'fish') return;
      const fish = FISH.find((x) => x.id === m.id);
      if (fish && !scene.hud.isModalOpen()) startFishing(scene, fish, (ok) => scene.net?.send({ t: 'fishDone', ok: ok ? 1 : 0 }));
    };
    const onGuest = (m) => { if (m?.t === 'fishDone') onFishResult(scene, m); };
    scene.events.on('netMsg', onNet);
    scene.events.on('netGuestMsg', onGuest);
    scene.events.once('shutdown', () => { scene.events.off('netMsg', onNet); scene.events.off('netGuestMsg', onGuest); });
  },

  // Çok oyunculu: hava/mevsim misafirde görsel olarak (yağmur, kar, sis, zemin tonu, rozet)
  netState(scene) {
    const st = scene._world;
    return st ? [st.weather, st.next, st.chestReady ? 1 : 0] : undefined;
  },
  netApply(scene, v) {
    const st = scene._world;
    if (!st || !Array.isArray(v)) return;
    st.next = v[1];
    st.chestReady = !!v[2];
    const key = `${v[0]}|${scene.timeSys.season === 'winter'}`;
    if (key !== st.wetKey) applyWeatherVisual(scene, v[0]);
  },
  guestUpdate(scene, dt) {
    const st = scene._world;
    if (!st) return;
    // Mevsim değişimi (gün host'tan gelir): ağaç tonu + yağmur↔kar
    const season = scene.timeSys.season;
    if (season !== st.guestSeason) {
      st.guestSeason = season;
      applySeason(scene);
      applyWeatherVisual(scene, st.weather);
    }
    updateVisuals(scene);
    if (st.weather === 'storm') {
      st.boltTimer -= dt;
      if (st.boltTimer <= 0) { st.boltTimer = Phaser.Math.FloatBetween(20, 40); thunder(scene); }
    }
    st.badgeT = (st.badgeT || 0) - dt;
    if (st.badgeT <= 0) { st.badgeT = 1; renderBadge(scene); }
  },

  begin(scene) {
    const st = scene._world;
    if (!st.loaded) {
      // Yeni oyun: ilk gün açık hava, çevrede birkaç yabani ürün
      st.weather = 'clear';
      st.next = rollWeather(scene.timeSys.season);
      st.chestReady = true;
      clearForage(scene);
      spawnForage(scene, 8);
    }
    applySeason(scene);
    setWeather(scene, st.weather, true);
    scene.ruinChest?.setTexture(st.chestReady ? 'chest' : 'chest_open');
    renderBadge(scene);
  },

  update(scene, dt) {
    const st = scene._world;
    if (!st) return;
    // Zemin tonu ve sis kamerayı takip eder
    updateVisuals(scene);

    // Fırtına: şimşek
    if (st.weather === 'storm') {
      st.boltTimer -= dt;
      if (st.boltTimer <= 0) { st.boltTimer = Phaser.Math.FloatBetween(20, 40); thunder(scene); }
    }

    // Fırtınada zombiler %10 hızlı (yarım saniyede bir kontrol)
    st.boostTimer -= dt;
    if (st.boostTimer <= 0) {
      st.boostTimer = 0.5;
      const storm = st.weather === 'storm';
      for (const z of scene.zombies.getChildren()) {
        if (storm && !z._wxBoost) { z.speed *= STORM_SPEED; z._wxBoost = true; }
        else if (!storm && z._wxBoost) { z.speed /= STORM_SPEED; z._wxBoost = false; }
      }
    }

    // Sis: zombiler oyuncuyu ancak yakından fark eder → uzaktakiler başka hedefe yönelir
    if (st.weather === 'fog' && scene.timeSys.isNight) {
      // (çok oyunculu: misafir karakterleri de sisin korumasından yararlanır)
      const ps = scene.allPlayers ? scene.allPlayers() : [scene.player];
      let alts = null;
      for (const z of scene.zombies.getChildren()) {
        const p = z.target;
        if (z.dead || !ps.includes(p)) continue;
        if (Phaser.Math.Distance.Between(z.x, z.y, p.x, p.y) <= FOG_DETECT) continue;
        if (!alts) alts = scene.zombieTargets().filter((t) => !ps.includes(t) && t.active !== false && !t.hidden);
        let best = null, bd = Infinity;
        for (const t of alts) {
          const w = t.isShelter ? 1.6 : t.isStructure ? 1.3 : 1;
          const d = Phaser.Math.Distance.Between(z.x, z.y, t.x, t.y) * w;
          if (d < bd) { bd = d; best = t; }
        }
        if (best) z.target = best;
      }
    }
  },

  save(scene) {
    const st = scene._world;
    if (!st) return undefined;
    return {
      weather: st.weather, next: st.next, chestReady: st.chestReady,
      forage: st.forage.map((f) => [f.kind === 'berry' ? 1 : 0, f.tx, f.ty])
    };
  },

  load(scene, d) {
    const st = scene._world;
    if (!st || !d) return;
    st.loaded = true;
    st.weather = WEATHERS[d.weather] ? d.weather : 'clear';
    st.next = WEATHERS[d.next] ? d.next : 'clear';
    st.chestReady = d.chestReady !== false;
    clearForage(scene);
    (Array.isArray(d.forage) ? d.forage : []).slice(0, MAX_FORAGE).forEach((f) => {
      if (Array.isArray(f) && Number.isFinite(f[1]) && Number.isFinite(f[2])) addForage(scene, f[0] === 1 ? 'berry' : 'mushroom', f[1], f[2]);
    });
  }
};
