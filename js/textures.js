// Tüm pixel-art dokular çalışma anında canvas ile üretilir (harici asset gerekmez).

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

export const R = (ctx, x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };

export function addCanvas(scene, key, w, h, draw) {
  const { c, ctx } = makeCanvas(w, h);
  draw(ctx, w, h);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  return scene.textures.addCanvas(key, c);
}

export function drawRows(ctx, rows, pal, ox = 0, oy = 0) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (col) R(ctx, ox + x, oy + y, 1, 1, col);
    }
  });
}

export function noise(ctx, w, h, base, cols, density, ox = 0) {
  R(ctx, ox, 0, w, h, base);
  for (let i = 0; i < w * h * density; i++) {
    R(ctx, ox + ((Math.random() * w) | 0), (Math.random() * h) | 0, 1, 1, cols[(Math.random() * cols.length) | 0]);
  }
}

// ---------- Ortak palet ve çizim yardımcıları ----------
// Endesga 32 esintili rampalar (koyu → açık). Yeni çizimler tonlarını buradan seçer ki
// zemin, yapılar ve karakterler aynı ışık altında duruyormuş gibi görünsün.
export const PAL = {
  ink: '#181425',
  grass: ['#1f4d36', '#2e6b3c', '#3f8a46', '#52a04c', '#68b558', '#8fcf6c'],
  leaf: ['#173a2c', '#22543a', '#2f7343', '#3f914a', '#5aad55', '#86cc6a'],
  dirt: ['#3e2731', '#5e3a2e', '#7a4e36', '#9b6a45', '#b88a5a', '#d4ab76', '#ead4aa'],
  stone: ['#262b44', '#3a4466', '#5a6988', '#7686a2', '#8b9bb4', '#b2bfd2', '#dfe6ef'],
  wood: ['#3e2731', '#5e3a2e', '#7a4a30', '#9a6240', '#b87a4e', '#d89a63'],
  water: ['#14365e', '#124e89', '#1f6fb0', '#2f8fd0', '#5bb4e6', '#a8e0f5'],
  red: ['#4a1a26', '#7a2230', '#a8323b', '#d04a48', '#ee7466'],
  blue: ['#262b44', '#334a7a', '#4466a6', '#5b88c8', '#86b2e2'],
  flower: ['#fee761', '#f77622', '#e43b44', '#f6757a', '#b55088', '#ffffff', '#8bb4ff', '#c0a0ff']
};

// Tohumlu rastgele sayı (mulberry32): dokular her açılışta aynı çıkar
export function srand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// k < 1 koyulaştırır, k > 1 beyaza doğru açar. Hex olmayan renkleri (rgba) olduğu gibi döndürür.
export function shade(hex, k) {
  if (typeof hex !== 'string' || hex[0] !== '#') return hex;
  if (hex.length === 4) hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(k >= 1 ? v + (255 - v) * (k - 1) : v * k)));
  return '#' + ((f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, '0');
}

// 4x4 Bayer matrisi: ton geçişlerini piksel-art usulü kareli taramayla yumuşatır (-0.5..0.5)
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
export const dith = (x, y) => (BAYER[y & 3][x & 3] + 0.5) / 16 - 0.5;

// Işık kaynağına uzaklığa göre rampadan ton seçerek bir şekli boyar (sol üstten gelen güneş)
export function litFill(ctx, w, h, inside, lx, ly, span, ramp, bias = 0) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    const t = Math.hypot(x - lx, y - ly) / span;
    const i = Math.max(0, Math.min(ramp.length - 1, Math.round((1 - t) * (ramp.length - 1) + dith(x, y) * 0.9 + bias)));
    R(ctx, x, y, 1, 1, ramp[i]);
  }
}

// Opak piksellerin çevresine 1px koyu dış hat ekler. Zaten koyu hat olan ve tek başına duran
// pikseller (hız izi, kıvılcım gibi) atlanır; böylece efekt pikselleri lekeye dönüşmez.
export function outline(ctx, x0, y0, w, h, col = PAL.ink) {
  const img = ctx.getImageData(x0, y0, w, h), d = img.data;
  const hex = shade(col, 1);
  const n = parseInt(hex.slice(1, 7), 16), cr = n >> 16, cg = (n >> 8) & 255, cb = n & 255;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] >= 160;
  const ink = (x, y) => { const i = (y * w + x) * 4; return Math.abs(d[i] - cr) + Math.abs(d[i + 1] - cg) + Math.abs(d[i + 2] - cb) < 40; };
  const N = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (solid(x, y)) continue;
    const hit = N.some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return solid(nx, ny) && !ink(nx, ny) && N.some(([ex, ey]) => solid(nx + ex, ny + ey));
    });
    if (hit) out.push((y * w + x) * 4);
  }
  out.forEach((i) => { d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = 255; });
  ctx.putImageData(img, x0, y0);
}

// Nesnenin altına, yalnızca boş piksellere düşen yumuşak zemin gölgesi
export function dropShadow(ctx, cx, cy, rx, ry, a = 0.3) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  for (let y = -ry; y <= ry; y++) {
    const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y / (ry + 0.6)) ** 2)));
    ctx.fillStyle = `rgba(24,20,37,${Math.abs(y) === ry ? a * 0.6 : a})`;
    ctx.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2, 1);
  }
  ctx.restore();
}

// ---------- İnsan şablonu (2 kare yürüme) ----------
const BODY = [
  '................',
  '.....OOOOOO.....',
  '....OHHHHHHO....',
  '....OHHHHHHO....',
  '....OHSSSSHO....',
  '....OSESSESO....',
  '....OSSSSSSO....',
  '.....OSSSSO.....',
  '....OCCCCCCO....',
  '...OSCCCCCCSO...',
  '...OSCDDDDCSO...',
  '....OCCCCCCO....'
];
const LEGS = [
  ['....OPPPPPPO....', '....OPPOOPPO....', '....OPPOOPPO....', '....OBBOOBBO....'],
  ['....OPPPPPPO....', '....OPPOOPPO....', '...OPPO..OPPO...', '...OBBO..OBBO...']
];

// Saç/kıyafet/pantolonda sol kenar ışık, sağ kenar gölge alır; saçın tepesi parlar.
// Ek çizimlerden (şapka vb.) ÖNCE çalışır, böylece onları bozmaz.
const edgeCh = (ch) => ch === undefined || ch === '.' || ch === 'O';
function shadeFigure(ctx, rows, pal, ox) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x], col = pal[ch];
      if (!col || !'HCDPS'.includes(ch)) continue;
      if (edgeCh(row[x + 1])) R(ctx, ox + x, y, 1, 1, shade(col, ch === 'S' ? 0.84 : 0.7));
      else if (ch !== 'S' && (edgeCh(row[x - 1]) || (ch === 'H' && edgeCh(rows[y - 1]?.[x])))) R(ctx, ox + x, y, 1, 1, shade(col, 1.22));
    }
  });
}

export function makeHumanoid(scene, key, pal, extra) {
  const tex = addCanvas(scene, key, 32, 16, (ctx) => {
    for (let f = 0; f < 2; f++) {
      const rows = BODY.concat(LEGS[f]);
      drawRows(ctx, rows, pal, f * 16, 0);
      shadeFigure(ctx, rows, pal, f * 16);
      if (extra) extra(ctx, f * 16, f);
      outline(ctx, f * 16, 0, 16, 16, pal.O);
    }
  });
  tex.add(0, 0, 0, 0, 16, 16);
  tex.add(1, 0, 16, 0, 16, 16);
}

export const basePal = (o) => Object.assign({ O: '#1b1622', E: '#1b1622', S: '#f1c29a', H: '#5a3a22', C: '#3f7fd0', D: '#2f5f9e', P: '#3b3b55', B: '#2a1f1a' }, o);

function makeCharacters(scene) {
  makeHumanoid(scene, 'player', basePal({ H: '#3a2a1a', C: '#e05a4f', D: '#a83b33', P: '#2f4a7a' }), (ctx, ox) => {
    R(ctx, ox + 5, 11, 6, 1, '#6b4a2f'); R(ctx, ox + 7, 11, 2, 1, '#feae34'); // kemer + toka
    R(ctx, ox + 6, 8, 1, 3, '#7a4a30'); R(ctx, ox + 9, 8, 1, 3, '#7a4a30');   // sırt çantası askıları
    R(ctx, ox + 5, 2, 2, 1, '#6b5040');                                       // saç parlaması
  });
  // Çiftçi: hasır şapka
  makeHumanoid(scene, 'npc_farmer', basePal({ H: '#c98b3a', C: '#6aa84f', D: '#4f7f3a', P: '#6b4a2f' }), (ctx, ox) => {
    R(ctx, ox + 2, 2, 12, 1, '#e8c867'); R(ctx, ox + 4, 0, 8, 2, '#e8c867'); R(ctx, ox + 4, 1, 8, 1, '#c9a443');
    R(ctx, ox + 4, 0, 3, 1, '#f6e39a'); R(ctx, ox + 10, 2, 4, 1, '#b8902f');
  });
  // Tüccar: mor sarık
  makeHumanoid(scene, 'npc_merchant', basePal({ S: '#d9a77c', H: '#7b3fa0', C: '#d9a62e', D: '#a77b1c', P: '#5b2d6e' }), (ctx, ox) => {
    R(ctx, ox + 4, 1, 8, 3, '#7b3fa0'); R(ctx, ox + 4, 1, 3, 1, '#a868c8'); R(ctx, ox + 7, 0, 2, 1, '#e8c867');
  });
  // Muhafız: miğfer + zırh
  makeHumanoid(scene, 'npc_guard', basePal({ H: '#9aa3ad', C: '#7d8894', D: '#5a636d', P: '#3b3b55' }), (ctx, ox) => {
    R(ctx, ox + 4, 1, 8, 3, '#b8c1cb'); R(ctx, ox + 5, 1, 2, 1, '#e6edf3'); R(ctx, ox + 11, 2, 1, 2, '#7d8894'); R(ctx, ox + 7, 0, 2, 2, '#c94040');
  });
  // Demirci: önlük
  makeHumanoid(scene, 'npc_blacksmith', basePal({ S: '#c98d68', H: '#222', C: '#8a8a8a', D: '#6b4a2f', P: '#3a2a1a' }), (ctx, ox) => {
    R(ctx, ox + 6, 9, 4, 3, '#6b4a2f'); R(ctx, ox + 6, 9, 4, 1, '#8a6040');
  });
  // Zombi: sarkık çene, yırtık gömlek, öne uzanan ve yürürken sallanan kollar
  makeHumanoid(scene, 'zombie', basePal({ S: '#7fb069', E: '#ff3b3b', H: '#3c5a2e', C: '#5b6b7a', D: '#3e4a55', P: '#4a3f35' }), (ctx, ox, f) => {
    R(ctx, ox + 6, 9, 1, 2, '#7fb069'); R(ctx, ox + 9, 11, 1, 1, '#7fb069'); R(ctx, ox + 5, 6, 1, 1, '#5a8a48');
    R(ctx, ox + 7, 7, 2, 1, '#3a1a22'); R(ctx, ox + 9, 3, 1, 1, '#7fb069');
    R(ctx, ox + 2, 8 + f, 2, 1, '#7fb069'); R(ctx, ox + 12, 9 - f, 2, 1, '#6a9a58');
  });
  // İri zombi: geniş omuzlar, kocaman yumruklar, alnında dikiş, alt dişler
  makeHumanoid(scene, 'zombie_brute', basePal({ S: '#9c7fc0', E: '#ffdd33', H: '#4b3466', C: '#6e2f2f', D: '#4d1f1f', P: '#2c2c2c' }), (ctx, ox, f) => {
    R(ctx, ox + 2, 8, 2, 2, '#8a3a3a'); R(ctx, ox + 12, 8, 2, 2, '#5a2626');
    R(ctx, ox + 1, 10 + f, 3, 2, '#9c7fc0'); R(ctx, ox + 12, 11 - f, 3, 2, '#7d62a0');
    R(ctx, ox + 6, 4, 4, 1, '#4b3466'); R(ctx, ox + 7, 3, 1, 3, '#4b3466');
    R(ctx, ox + 6, 7, 4, 1, '#2a1630'); R(ctx, ox + 7, 7, 1, 1, '#efe6d2'); R(ctx, ox + 9, 7, 1, 1, '#efe6d2');
  });
}

// ---------- Zemin tileset ----------
// Her karo kendi tohumuyla üretilir; desenler 16px'te sarılır ki karo sınırları görünmesin.
function makeTiles(scene) {
  addCanvas(scene, 'tiles', 128, 16, (ctx) => {
    const G = PAL.grass, D = PAL.dirt;
    const px = (ox, x, y, c) => R(ctx, ox + (((x % 16) + 16) % 16), ((y % 16) + 16) % 16, 1, 1, c);
    const tuft = (ox, x, y, dark, lite) => { px(ox, x, y, dark); px(ox, x + 2, y, dark); px(ox, x + 1, y + 1, dark); px(ox, x + 1, y, lite); };
    const grass = (ox, seed, base, tufts) => {
      const r = srand(seed);
      R(ctx, ox, 0, 16, 16, base);
      for (let i = 0; i < 34; i++) px(ox, (r() * 16) | 0, (r() * 16) | 0, r() < 0.55 ? shade(base, 0.88) : shade(base, 1.1));
      for (let i = 0; i < tufts; i++) tuft(ox, (r() * 16) | 0, (r() * 16) | 0, G[2], G[4]);
      return r;
    };
    // 0-2 çim (düz / çiçekli / tutamlı)
    grass(0, 11, G[3], 3);
    const r1 = grass(16, 12, G[3], 2);
    [[4, 5], [11, 11]].forEach(([x, y], i) => {
      const c = PAL.flower[[0, 5][i]];
      px(16, x, y, c); px(16, x, y + 1, G[1]); if (r1() < 0.5) px(16, x + 1, y + 1, G[2]);
    });
    grass(32, 13, G[3], 6);
    [[3, 5], [10, 3], [7, 11], [12, 12]].forEach(([x, y]) => { px(32, x, y, G[1]); px(32, x, y + 1, G[1]); px(32, x + 1, y + 1, G[2]); px(32, x, y - 1, G[5]); });

    // 3 yol: sıkışmış toprak, çakıl taşları (üst ışık, alt gölge)
    {
      const r = srand(21);
      R(ctx, 48, 0, 16, 16, D[4]);
      for (let i = 0; i < 50; i++) px(48, (r() * 16) | 0, (r() * 16) | 0, r() < 0.5 ? shade(D[4], 0.92) : shade(D[4], 1.06));
      for (let i = 0; i < 3; i++) { const x = (r() * 16) | 0, y = (r() * 15) | 0; px(48, x, y, D[5]); px(48, x + 1, y, D[5]); px(48, x, y + 1, D[3]); px(48, x + 1, y + 1, D[3]); }
      for (let i = 0; i < 5; i++) px(48, (r() * 16) | 0, (r() * 16) | 0, D[2]);
    }
    // 4 sürülmüş toprak: sıra sıra karık (üst kenar ışık, oyuk gölge)
    {
      const r = srand(31), b = '#6e4b2e';
      R(ctx, 64, 0, 16, 16, b);
      for (let i = 0; i < 40; i++) px(64, (r() * 16) | 0, (r() * 16) | 0, r() < 0.5 ? '#5d3f26' : '#7a5636');
      for (let y = 2; y < 16; y += 4) for (let x = 0; x < 16; x++) {
        px(64, x, y, '#4a3020');
        if (dith(x, y + 1) < 0.25) px(64, x, y + 1, '#8a6440');
        if (dith(x, y - 1) < -0.2) px(64, x, y - 1, '#5a3c24');
      }
    }
    // 5 ıslak toprak: daha koyu, karıklarda su parıltısı
    {
      const r = srand(41);
      R(ctx, 80, 0, 16, 16, '#4a3220');
      for (let i = 0; i < 40; i++) px(80, (r() * 16) | 0, (r() * 16) | 0, r() < 0.5 ? '#3d2919' : '#553a26');
      for (let y = 2; y < 16; y += 4) for (let x = 0; x < 16; x++) {
        px(80, x, y, '#2a1a12');
        if (dith(x, y + 1) < 0.25) px(80, x, y + 1, '#5e4230');
      }
      [[4, 6], [11, 14], [8, 2], [13, 10]].forEach(([x, y]) => { px(80, x, y, '#5f86ae'); px(80, x + 1, y, '#3c5a7a'); });
    }
    // 6 tarla çimi (biraz daha açık, az tutam)
    grass(96, 61, '#66ad55', 2);
    // 7 taş zemin: şaşırtmalı kesme taşlar, üstte ışık altta gölge, harç aralıkları
    {
      const r = srand(71), S = PAL.stone, ox = 112;
      R(ctx, ox, 0, 16, 16, S[3]);
      const rowsX = [[0, 5, 11], [2, 8, 13], [0, 6, 11], [3, 9, 14]];
      rowsX.forEach((xs, ri) => {
        xs.forEach((x0, k) => {
          const x1 = k + 1 < xs.length ? xs[k + 1] : xs[0] + 16;
          const base = [S[4], shade(S[4], 0.95), shade(S[4], 1.05)][(r() * 3) | 0];
          for (let x = x0; x < x1 - 1; x++) for (let y = ri * 4; y < ri * 4 + 3; y++) {
            let c = base;
            if (y === ri * 4) c = shade(base, 1.14);
            else if (y === ri * 4 + 2 || x === x1 - 2) c = shade(base, 0.9);
            px(ox, x, y, c);
          }
          if (r() < 0.35) px(ox, x0 + 1 + ((r() * (x1 - x0 - 3)) | 0), ri * 4 + 1, shade(base, 0.88));
          if (r() < 0.2) px(ox, x0, ri * 4 + 2, PAL.leaf[3]);
        });
      });
    }
  });
}

// ---------- Ekinler ----------
function makeCrops(scene) {
  const defs = {
    wheat:   ['#7cc455', '#a6c94a', '#d9b84a', '#e8c867'],
    carrot:  ['#6fbf5a', '#4f9f3e', '#3f8f34', '#e8792b'],
    pumpkin: ['#6fbf5a', '#4f9f3e', '#d98a2b', '#f08a24']
  };
  Object.entries(defs).forEach(([type, cols]) => {
    for (let s = 0; s < 4; s++) {
      addCanvas(scene, `crop_${type}_${s}`, 16, 16, (ctx) => {
        if (s === 0) { R(ctx, 7, 11, 2, 2, '#4f8f41'); R(ctx, 6, 10, 1, 1, cols[0]); R(ctx, 9, 10, 1, 1, cols[0]); return; }
        if (type === 'wheat') {
          const h = 3 + s * 3;
          for (const x of [4, 7, 10]) { R(ctx, x, 14 - h, 1, h, '#8aa83a'); R(ctx, x - (s > 1 ? 1 : 0), 14 - h, s > 1 ? 3 : 1, Math.min(4, s + 1), cols[s]); }
        } else if (type === 'carrot') {
          const h = 2 + s * 2;
          for (const x of [5, 8, 10]) R(ctx, x, 13 - h, 1, h, cols[s === 3 ? 2 : s]);
          if (s === 3) { R(ctx, 6, 11, 4, 3, cols[3]); R(ctx, 7, 14, 2, 1, cols[3]); }
        } else {
          R(ctx, 3, 11, 10, 1, '#4f9f3e'); R(ctx, 4, 9, 2, 2, '#6fbf5a'); R(ctx, 10, 9, 2, 2, '#6fbf5a');
          if (s === 2) { R(ctx, 6, 9, 4, 4, cols[2]); }
          if (s === 3) { R(ctx, 4, 7, 9, 7, cols[3]); R(ctx, 4, 7, 9, 1, '#c96d18'); R(ctx, 7, 7, 1, 7, '#c96d18'); R(ctx, 10, 7, 1, 7, '#c96d18'); R(ctx, 8, 5, 1, 2, '#4f7f3a'); }
        }
        outline(ctx, 0, 0, 16, 16, '#22301e');
      });
    }
  });
}

// ---------- Yapılar / dünya objeleri ----------
const circ = (cs) => (x, y) => cs.some(([cx, cy, r]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r);

// Tahta kalas: sol/üst ışık, sağ/alt gölge
function plank(ctx, x, y, w, h, ramp = PAL.wood, i = 3) {
  R(ctx, x, y, w, h, ramp[i]);
  if (h > 1) R(ctx, x, y, w, 1, ramp[i + 1]);
  if (w > 1) R(ctx, x + w - 1, y, 1, h, ramp[i - 1]);
  if (h > 2) R(ctx, x, y + h - 1, w, 1, ramp[i - 1]);
}

// Çatı: yukarıdan aşağı genişleyen kiremit sıraları, sol yamaçta ışık
function roof(ctx, cx, top, rows, slope, ramp) {
  for (let i = 0; i < rows; i++) {
    const x = cx - 2 - i * slope, w = 4 + i * slope * 2;
    const band = (i % 3 === 2) ? ramp[1] : ramp[2];
    R(ctx, x, top + i, w, 1, band);
    if (i % 3 !== 2) for (let s = ((i / 3) | 0) % 2 ? 2 : 0; s < w; s += 5) R(ctx, x + s, top + i, 1, 1, ramp[1]);
    R(ctx, x, top + i, Math.max(2, Math.round(w * 0.18)), 1, i % 3 === 2 ? ramp[2] : ramp[3]);
    R(ctx, x + w - 2, top + i, 2, 1, ramp[0]);
  }
  R(ctx, cx - 2, top, 4, 1, ramp[4] || ramp[3]);
}

function windowPane(ctx, x, y, w, h, lit) {
  R(ctx, x - 1, y - 1, w + 2, h + 2, PAL.wood[1]);
  R(ctx, x, y, w, h, lit ? '#f6d77a' : PAL.blue[3]);
  R(ctx, x, y + h - 2, w, 2, lit ? '#e8a84a' : PAL.blue[2]);
  R(ctx, x + 1, y + 1, 2, 1, lit ? '#fff3c0' : PAL.blue[4]); R(ctx, x + 1, y + 2, 1, 1, lit ? '#fff3c0' : PAL.blue[4]);
  R(ctx, x + (w >> 1), y, 1, h, PAL.wood[1]); R(ctx, x, y + (h >> 1), w, 1, PAL.wood[1]);
  R(ctx, x - 1, y + h + 1, w + 2, 1, PAL.wood[4]);
}

function makeProps(scene) {
  const L = PAL.leaf, W = PAL.wood, S = PAL.stone;
  addCanvas(scene, 'tree', 16, 24, (ctx) => {
    // Gövde ve kökler
    R(ctx, 6, 14, 4, 9, W[3]); R(ctx, 6, 14, 1, 9, W[4]); R(ctx, 9, 14, 1, 9, W[1]); R(ctx, 7, 16, 1, 5, W[5]);
    R(ctx, 5, 21, 1, 2, W[3]); R(ctx, 10, 21, 1, 2, W[2]); R(ctx, 4, 22, 1, 1, W[3]); R(ctx, 11, 22, 1, 1, W[2]);
    // Taç: yuvarlak kümeler, sol üstten ışık, kareli geçişler
    const crown = circ([[8, 8, 6.6], [4.6, 10.8, 3.8], [11.4, 10.8, 3.8], [8, 4.6, 4.4], [5, 6.5, 3.4], [11, 6.5, 3.4]]);
    litFill(ctx, 16, 15, crown, 5, 3, 13.5, [L[1], L[2], L[3], L[4], L[5]], -0.15);
    const r = srand(5);
    for (let i = 0; i < 22; i++) {
      const x = (r() * 16) | 0, y = (r() * 15) | 0;
      if (crown(x, y) && crown(x, y + 1)) { R(ctx, x, y, 1, 1, L[1]); if (crown(x, y - 1)) R(ctx, x, y - 1, 1, 1, L[3]); }
    }
    R(ctx, 5, 13, 6, 1, L[0]); R(ctx, 7, 14, 2, 1, L[0]); // taç gövdeye gölge düşürür
    outline(ctx, 0, 0, 16, 24, '#132a22');
    dropShadow(ctx, 8, 22, 6, 1, 0.32);
  });
  addCanvas(scene, 'stump', 16, 16, (ctx) => {
    R(ctx, 5, 9, 6, 5, W[3]); R(ctx, 5, 9, 1, 5, W[4]); R(ctx, 10, 9, 1, 5, W[1]); R(ctx, 4, 13, 1, 1, W[3]); R(ctx, 11, 13, 1, 1, W[2]);
    R(ctx, 5, 8, 6, 2, PAL.dirt[5]); R(ctx, 6, 8, 4, 2, PAL.dirt[4]); R(ctx, 7, 8, 2, 1, PAL.dirt[6]); R(ctx, 7, 9, 2, 1, PAL.dirt[3]);
    outline(ctx, 0, 0, 16, 16);
    dropShadow(ctx, 8, 14, 5, 1, 0.3);
  });
  addCanvas(scene, 'rock', 16, 16, (ctx) => {
    const m = circ([[7, 9.6, 4.6], [10.6, 10.6, 3.6], [6, 7.4, 3.2]]);
    litFill(ctx, 16, 14, (x, y) => m(x, y) && y < 14, 5, 6, 10, [S[1], S[2], S[3], S[4], S[5]], 0.1);
    R(ctx, 8, 9, 1, 2, S[2]); R(ctx, 9, 11, 1, 1, S[2]); R(ctx, 5, 6, 2, 1, S[6]);
    R(ctx, 11, 8, 1, 1, L[3]); R(ctx, 12, 8, 1, 1, L[4]);
    outline(ctx, 0, 0, 16, 16);
    dropShadow(ctx, 8, 14, 6, 1, 0.3);
  });
  addCanvas(scene, 'shelter', 64, 56, (ctx) => {
    // Kütük duvar
    for (let y = 22; y < 54; y += 4) plank(ctx, 4, y, 56, 4, W, 3);
    for (let y = 24; y < 54; y += 8) { R(ctx, 4, y, 2, 2, W[5]); R(ctx, 58, y, 2, 2, W[2]); }
    R(ctx, 4, 22, 56, 3, 'rgba(24,20,37,0.35)'); // saçak gölgesi
    roof(ctx, 32, 3, 19, 1.65, PAL.red);
    R(ctx, 0, 21, 64, 2, PAL.red[0]); R(ctx, 0, 21, 64, 1, PAL.red[1]);
    // Kapı
    R(ctx, 25, 37, 14, 17, W[1]); R(ctx, 26, 38, 12, 16, W[2]);
    for (let x = 26; x < 38; x += 4) R(ctx, x, 38, 1, 16, W[1]);
    R(ctx, 26, 38, 12, 1, W[4]); R(ctx, 35, 46, 2, 2, '#feae34'); R(ctx, 24, 53, 16, 1, S[3]);
    // Pencereler (sıcak ışık)
    windowPane(ctx, 10, 30, 9, 8, true); windowPane(ctx, 45, 30, 9, 8, true);
    // Tabela
    R(ctx, 21, 11, 22, 8, W[1]); R(ctx, 22, 12, 20, 6, '#e8dcc0'); R(ctx, 22, 12, 20, 1, '#fff6e0');
    R(ctx, 24, 14, 16, 2, PAL.red[1]); R(ctx, 26, 14, 2, 2, PAL.red[3]);
    outline(ctx, 0, 0, 64, 56);
  });
  addCanvas(scene, 'house', 48, 44, (ctx) => {
    // Baca
    R(ctx, 33, 3, 5, 9, S[3]); R(ctx, 33, 3, 1, 9, S[4]); R(ctx, 32, 2, 7, 2, S[2]); R(ctx, 32, 2, 7, 1, S[4]);
    // Duvar: sıva + tahta şeritler
    R(ctx, 4, 18, 40, 24, '#d8bf92');
    for (let y = 21; y < 42; y += 4) R(ctx, 4, y, 40, 1, '#b89c70');
    R(ctx, 4, 18, 1, 24, '#ecd8b0'); R(ctx, 41, 18, 3, 24, '#b49668'); R(ctx, 4, 18, 40, 2, 'rgba(24,20,37,0.3)');
    R(ctx, 4, 40, 40, 2, S[3]);
    roof(ctx, 24, 2, 16, 1.4, PAL.blue);
    R(ctx, 2, 17, 44, 1, PAL.blue[0]);
    // Kapı + basamak
    R(ctx, 19, 29, 10, 13, W[1]); R(ctx, 20, 30, 8, 12, W[3]);
    R(ctx, 20, 30, 8, 1, W[4]); R(ctx, 23, 30, 1, 12, W[2]); R(ctx, 26, 36, 1, 2, '#feae34');
    R(ctx, 18, 42, 12, 2, S[4]); R(ctx, 18, 42, 12, 1, S[5]);
    // Pencereler + saksılar
    windowPane(ctx, 8, 24, 8, 7, false); windowPane(ctx, 32, 24, 8, 7, false);
    [[8, 32], [32, 32]].forEach(([x, y]) => { R(ctx, x - 1, y + 1, 10, 2, W[2]); [1, 4, 7].forEach((d, i) => R(ctx, x + d, y, 1, 1, PAL.flower[[2, 0, 3][i]])); });
    outline(ctx, 0, 0, 48, 44);
  });
  addCanvas(scene, 'market', 48, 36, (ctx) => {
    R(ctx, 4, 14, 2, 21, W[2]); R(ctx, 42, 14, 2, 21, W[2]); R(ctx, 4, 14, 1, 21, W[4]); R(ctx, 42, 14, 1, 21, W[4]);
    // Tente: şeritler, ışıklı üst, dalgalı alt kenar
    for (let i = 0; i < 8; i++) {
      const red = i % 2 === 0, c = red ? PAL.red[3] : '#f5efe2', d = red ? PAL.red[2] : '#d8cfc0';
      R(ctx, i * 6, 3, 6, 11, c); R(ctx, i * 6 + 4, 3, 2, 11, d); R(ctx, i * 6, 3, 6, 1, red ? PAL.red[4] : '#ffffff');
      R(ctx, i * 6 + 1, 14, 4, 1, c); R(ctx, i * 6 + 2, 15, 2, 1, d);
    }
    R(ctx, 0, 2, 48, 1, PAL.red[1]);
    R(ctx, 6, 15, 36, 3, 'rgba(24,20,37,0.25)');
    // Ürün sandıkları
    [[7, PAL.flower[1]], [15, '#f08a24'], [25, PAL.flower[0]], [35, PAL.grass[4]]].forEach(([x, c]) => {
      R(ctx, x, 21, 6, 3, W[3]); R(ctx, x, 21, 6, 1, W[4]);
      R(ctx, x + 1, 19, 4, 2, c); R(ctx, x + 1, 19, 2, 1, shade(c, 1.3)); R(ctx, x + 4, 20, 1, 1, shade(c, 0.7));
    });
    // Tezgâh
    plank(ctx, 2, 24, 44, 5, W, 3); plank(ctx, 2, 29, 44, 5, W, 2);
    R(ctx, 2, 24, 44, 1, W[5]); R(ctx, 3, 34, 2, 2, W[1]); R(ctx, 43, 34, 2, 2, W[1]);
    outline(ctx, 0, 0, 48, 36);
  });
  addCanvas(scene, 'forge', 48, 40, (ctx) => {
    // Taş duvar: şaşırtmalı bloklar
    R(ctx, 2, 10, 44, 28, S[2]);
    for (let row = 0, y = 11; y < 38; y += 4, row++) for (let x = 2 + (row % 2 ? 3 : 0) - 6; x < 46; x += 6) {
      const x0 = Math.max(2, x), w = Math.min(46, x + 5) - x0;
      if (w <= 0) continue;
      R(ctx, x0, y, w, 3, S[3]); R(ctx, x0, y, w, 1, S[4]); R(ctx, x0 + w - 1, y + 1, 1, 2, S[2]);
    }
    R(ctx, 2, 10, 44, 2, 'rgba(24,20,37,0.35)');
    // Arduvaz çatı + baca
    R(ctx, 34, 0, 8, 8, S[2]); R(ctx, 34, 0, 2, 8, S[3]); R(ctx, 33, 0, 10, 1, S[4]);
    R(ctx, 0, 5, 48, 6, S[1]); for (let x = 0; x < 48; x += 4) R(ctx, x, 6, 1, 4, S[0]); R(ctx, 0, 5, 48, 1, S[3]);
    // Ocak ağzı: sıcaktan kora
    R(ctx, 7, 21, 16, 16, S[1]); R(ctx, 8, 22, 14, 15, '#1f1a1a');
    R(ctx, 9, 27, 12, 10, '#a83b1a'); R(ctx, 10, 29, 10, 8, '#f08a24'); R(ctx, 12, 31, 6, 5, '#ffd166'); R(ctx, 14, 33, 2, 3, '#fff3c0');
    [[11, 28], [17, 28], [14, 27]].forEach(([x, y]) => R(ctx, x, y, 1, 1, '#ffd166'));
    R(ctx, 7, 21, 16, 1, S[4]);
    // Örs
    R(ctx, 28, 30, 12, 3, '#2c2c34'); R(ctx, 28, 30, 12, 1, '#6a6f80'); R(ctx, 26, 30, 2, 2, '#2c2c34'); R(ctx, 31, 33, 6, 4, '#2c2c34'); R(ctx, 30, 37, 8, 1, '#2c2c34');
    outline(ctx, 0, 0, 48, 40);
  });
  addCanvas(scene, 'fence', 16, 16, (ctx) => {
    for (const x of [2, 12]) { R(ctx, x, 4, 2, 11, W[3]); R(ctx, x, 4, 1, 11, W[4]); R(ctx, x + 1, 4, 1, 11, W[2]); R(ctx, x, 3, 2, 1, W[5]); }
    for (const y of [6, 11]) { R(ctx, 0, y, 16, 2, W[4]); R(ctx, 0, y, 16, 1, W[5]); R(ctx, 0, y + 2, 16, 1, 'rgba(24,20,37,0.3)'); }
    R(ctx, 2, 7, 1, 1, S[3]); R(ctx, 13, 12, 1, 1, S[3]);
    outline(ctx, 0, 0, 16, 16);
    dropShadow(ctx, 3, 15, 2, 0, 0.3); dropShadow(ctx, 13, 15, 2, 0, 0.3);
  });
  addCanvas(scene, 'barricade', 16, 16, (ctx) => {
    for (const y of [6, 11]) { R(ctx, 1, y, 14, 3, W[3]); R(ctx, 1, y, 14, 1, W[4]); R(ctx, 1, y + 2, 14, 1, W[2]); }
    for (const x of [2, 7, 12]) { R(ctx, x, 3, 2, 12, W[2]); R(ctx, x, 3, 1, 12, W[3]); R(ctx, x, 2, 2, 1, '#c8c8d0'); R(ctx, x, 1, 1, 1, '#eef2f5'); }
    outline(ctx, 0, 0, 16, 16);
    dropShadow(ctx, 8, 15, 7, 0, 0.3);
  });
  // Dikey dizilen barikat: yukarıdan-önden bakışta tahtalar ileri uzanır, kazıklar üst üste görünür
  addCanvas(scene, 'barricade_v', 16, 16, (ctx) => {
    R(ctx, 6, 0, 4, 16, W[3]); R(ctx, 6, 0, 1, 16, W[4]); R(ctx, 9, 0, 1, 16, W[2]);
    for (const y of [2, 10]) { R(ctx, 5, y, 6, 5, W[2]); R(ctx, 5, y, 6, 1, W[3]); R(ctx, 6, y - 1, 4, 1, '#c8c8d0'); R(ctx, 7, y - 2, 2, 1, '#eef2f5'); }
    outline(ctx, 0, 0, 16, 16);
    dropShadow(ctx, 8, 15, 4, 0, 0.3);
  });
  addCanvas(scene, 'turret', 16, 16, (ctx) => {
    R(ctx, 3, 10, 10, 5, S[2]); R(ctx, 3, 10, 10, 1, S[3]);
    R(ctx, 4, 6, 8, 5, S[3]); R(ctx, 5, 7, 6, 3, S[4]); R(ctx, 5, 6, 3, 1, S[5]);
    R(ctx, 10, 7, 6, 2, '#2c2c34'); R(ctx, 10, 7, 6, 1, '#4a4f60'); R(ctx, 7, 7, 2, 2, '#ff5a5a'); R(ctx, 7, 7, 1, 1, '#ffd0d0');
    outline(ctx, 0, 0, 16, 16);
    dropShadow(ctx, 8, 15, 6, 0, 0.3);
  });
  addCanvas(scene, 'bullet', 4, 4, (ctx) => { R(ctx, 1, 0, 2, 4, 'rgba(255,209,102,0.7)'); R(ctx, 0, 1, 4, 2, 'rgba(255,209,102,0.7)'); R(ctx, 1, 1, 2, 2, '#fff'); });
  addCanvas(scene, 'px', 2, 2, (ctx) => R(ctx, 0, 0, 2, 2, '#ffffff'));
  addCanvas(scene, 'shadow', 12, 4, (ctx) => { R(ctx, 2, 0, 8, 4, 'rgba(24,20,37,0.22)'); R(ctx, 0, 1, 12, 2, 'rgba(24,20,37,0.22)'); R(ctx, 3, 1, 6, 2, 'rgba(24,20,37,0.16)'); });
  addCanvas(scene, 'cursor', 16, 16, (ctx) => {
    const c = 'rgba(255,255,255,0.85)';
    R(ctx, 0, 0, 4, 1, c); R(ctx, 0, 0, 1, 4, c); R(ctx, 12, 0, 4, 1, c); R(ctx, 15, 0, 1, 4, c);
    R(ctx, 0, 15, 4, 1, c); R(ctx, 0, 12, 1, 4, c); R(ctx, 12, 15, 4, 1, c); R(ctx, 15, 12, 1, 4, c);
  });
  addCanvas(scene, 'slash', 16, 16, (ctx) => {
    for (let i = 0; i < 12; i++) R(ctx, 2 + i, 2 + Math.round(Math.sin(i / 11 * Math.PI) * -1 + i * 0.6), 2, 2, 'rgba(255,255,255,0.9)');
  });
  // Süs çalısı (çarpışmasız, MapBuilder yerleştirir)
  addCanvas(scene, 'bush', 16, 16, (ctx) => {
    const m = circ([[8, 10, 5.2], [4.6, 11.4, 3.4], [11.4, 11.4, 3.4], [7, 7, 3.2]]);
    litFill(ctx, 16, 15, (x, y) => m(x, y) && y < 15, 5, 6, 10, [L[1], L[2], L[3], L[4], L[5]], -0.1);
    [[6, 9], [10, 11], [4, 12]].forEach(([x, y]) => R(ctx, x, y, 1, 1, L[1]));
    outline(ctx, 0, 0, 16, 16, '#132a22');
    dropShadow(ctx, 8, 15, 6, 0, 0.3);
  });
  // Yumuşak ışık (gece karanlığından silinir)
  const { c, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  if (scene.textures.exists('light')) scene.textures.remove('light');
  scene.textures.addCanvas('light', c);
}

// ---------- Eşya ikonları ----------
function makeIcons(scene) {
  const icon = (key, fn) => addCanvas(scene, key, 16, 16, fn);
  const handle = (ctx) => { for (let i = 0; i < 9; i++) R(ctx, 3 + i, 12 - i, 2, 2, '#8a5a3a'); };
  icon('i_hoe', (ctx) => { handle(ctx); R(ctx, 9, 2, 6, 2, '#9aa3ad'); R(ctx, 13, 2, 2, 5, '#9aa3ad'); });
  icon('i_axe', (ctx) => { handle(ctx); R(ctx, 9, 1, 5, 6, '#b8c1cb'); R(ctx, 13, 1, 1, 6, '#e6edf3'); });
  icon('i_pickaxe', (ctx) => { handle(ctx); R(ctx, 6, 2, 9, 2, '#9aa3ad'); R(ctx, 5, 3, 2, 3, '#9aa3ad'); R(ctx, 14, 3, 2, 3, '#9aa3ad'); });
  icon('i_can', (ctx) => { R(ctx, 3, 6, 8, 8, '#4f8fd0'); R(ctx, 3, 6, 8, 2, '#7ab0e6'); R(ctx, 11, 7, 3, 2, '#4f8fd0'); R(ctx, 13, 5, 2, 2, '#4f8fd0'); R(ctx, 5, 3, 4, 1, '#2f5f9e'); R(ctx, 4, 3, 1, 3, '#2f5f9e'); R(ctx, 9, 3, 1, 3, '#2f5f9e'); });
  icon('i_sword', (ctx) => { for (let i = 0; i < 9; i++) R(ctx, 5 + i, 9 - i, 2, 2, '#e6edf3'); R(ctx, 3, 9, 5, 2, '#c9a443'); R(ctx, 5, 7, 2, 5, '#c9a443'); R(ctx, 2, 12, 3, 3, '#6b4a2f'); });
  icon('i_pistol', (ctx) => { R(ctx, 2, 5, 12, 4, '#3a3a44'); R(ctx, 2, 5, 12, 1, '#5a5d66'); R(ctx, 3, 9, 4, 5, '#6b4a2f'); R(ctx, 8, 9, 2, 2, '#3a3a44'); });
  icon('i_ammo', (ctx) => { for (const x of [3, 7, 11]) { R(ctx, x, 6, 3, 8, '#c9a443'); R(ctx, x, 4, 3, 3, '#b87333'); } });
  icon('i_wood', (ctx) => { R(ctx, 2, 5, 12, 4, '#8a5a3a'); R(ctx, 3, 9, 12, 4, '#a87048'); R(ctx, 12, 5, 2, 4, '#c9a06b'); R(ctx, 13, 9, 2, 4, '#c9a06b'); });
  icon('i_stone', (ctx) => { R(ctx, 3, 6, 10, 7, '#7d808a'); R(ctx, 5, 4, 6, 3, '#7d808a'); R(ctx, 4, 5, 4, 3, '#a2a6b0'); });
  const seed = (key, col) => icon(key, (ctx) => { R(ctx, 4, 3, 8, 11, '#d9c08a'); R(ctx, 4, 3, 8, 2, '#b39e74'); R(ctx, 6, 7, 4, 4, col); });
  seed('i_seed_wheat', '#e8c867'); seed('i_seed_carrot', '#e8792b'); seed('i_seed_pumpkin', '#f08a24');
  icon('i_wheat', (ctx) => { for (const x of [5, 8, 11]) { R(ctx, x, 6, 1, 9, '#a6c94a'); R(ctx, x - 1, 2, 3, 5, '#e8c867'); } });
  icon('i_carrot', (ctx) => { for (let i = 0; i < 8; i++) R(ctx, 4 + i, 5 + i, Math.max(1, 4 - (i >> 1)), 2, '#e8792b'); R(ctx, 3, 2, 2, 4, '#4f9f3e'); R(ctx, 5, 1, 2, 3, '#6fbf5a'); });
  icon('i_pumpkin', (ctx) => { R(ctx, 2, 5, 12, 9, '#f08a24'); R(ctx, 2, 5, 12, 1, '#c96d18'); R(ctx, 6, 5, 1, 9, '#c96d18'); R(ctx, 10, 5, 1, 9, '#c96d18'); R(ctx, 7, 2, 2, 3, '#4f7f3a'); });
  icon('i_bread', (ctx) => { R(ctx, 2, 6, 12, 7, '#c98b3a'); R(ctx, 3, 5, 10, 2, '#e0a85a'); for (const x of [5, 8, 11]) R(ctx, x, 6, 1, 3, '#f2d29b'); });
  icon('i_soup', (ctx) => { R(ctx, 2, 7, 12, 6, '#e6edf3'); R(ctx, 3, 7, 10, 2, '#f08a24'); R(ctx, 4, 13, 8, 1, '#9aa3ad'); R(ctx, 6, 3, 1, 3, 'rgba(255,255,255,0.6)'); R(ctx, 9, 2, 1, 3, 'rgba(255,255,255,0.6)'); });
}

export function generateTextures(scene) {
  makeCharacters(scene);
  makeTiles(scene);
  makeCrops(scene);
  makeProps(scene);
  makeIcons(scene);
}

// DOM tarafında ikon göstermek için dataURL önbelleği
const iconCache = {};
// Çok oyunculu: uzak panel HTML'inde dataURL'leri kısa anahtarlara çevirmek için (yalnızca okunur)
export const iconCacheEntries = () => Object.entries(iconCache);
export function iconURL(scene, key) {
  if (iconCache[key]) return iconCache[key];
  const tex = scene.textures.get(key);
  const src = tex.getSourceImage();
  const fw = Math.min(src.width, 16), fh = Math.min(src.height, 16);
  const { c, ctx } = makeCanvas(fw, fh);
  ctx.drawImage(src, 0, 0, fw, fh, 0, 0, fw, fh);
  return (iconCache[key] = c.toDataURL());
}
