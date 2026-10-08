// Tüm pixel-art dokular çalışma anında canvas ile üretilir (harici asset gerekmez).

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
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

export function makeHumanoid(scene, key, pal, extra) {
  const tex = addCanvas(scene, key, 32, 16, (ctx) => {
    for (let f = 0; f < 2; f++) {
      drawRows(ctx, BODY.concat(LEGS[f]), pal, f * 16, 0);
      if (extra) extra(ctx, f * 16, f);
    }
  });
  tex.add(0, 0, 0, 0, 16, 16);
  tex.add(1, 0, 16, 0, 16, 16);
}

export const basePal = (o) => Object.assign({ O: '#1b1622', E: '#1b1622', S: '#f1c29a', H: '#5a3a22', C: '#3f7fd0', D: '#2f5f9e', P: '#3b3b55', B: '#2a1f1a' }, o);

function makeCharacters(scene) {
  makeHumanoid(scene, 'player', basePal({ H: '#3a2a1a', C: '#e05a4f', D: '#a83b33', P: '#2f4a7a' }), (ctx, ox) => {
    R(ctx, ox + 5, 11, 6, 1, '#6b4a2f'); // kemer
  });
  // Çiftçi: hasır şapka
  makeHumanoid(scene, 'npc_farmer', basePal({ H: '#c98b3a', C: '#6aa84f', D: '#4f7f3a', P: '#6b4a2f' }), (ctx, ox) => {
    R(ctx, ox + 2, 2, 12, 1, '#e8c867'); R(ctx, ox + 4, 0, 8, 2, '#e8c867'); R(ctx, ox + 4, 1, 8, 1, '#c9a443');
  });
  // Tüccar: mor sarık
  makeHumanoid(scene, 'npc_merchant', basePal({ S: '#d9a77c', H: '#7b3fa0', C: '#d9a62e', D: '#a77b1c', P: '#5b2d6e' }), (ctx, ox) => {
    R(ctx, ox + 4, 1, 8, 3, '#7b3fa0'); R(ctx, ox + 7, 0, 2, 1, '#e8c867');
  });
  // Muhafız: miğfer + zırh
  makeHumanoid(scene, 'npc_guard', basePal({ H: '#9aa3ad', C: '#7d8894', D: '#5a636d', P: '#3b3b55' }), (ctx, ox) => {
    R(ctx, ox + 4, 1, 8, 3, '#b8c1cb'); R(ctx, ox + 7, 0, 2, 2, '#c94040');
  });
  // Demirci: önlük
  makeHumanoid(scene, 'npc_blacksmith', basePal({ S: '#c98d68', H: '#222', C: '#8a8a8a', D: '#6b4a2f', P: '#3a2a1a' }), (ctx, ox) => {
    R(ctx, ox + 6, 9, 4, 3, '#6b4a2f');
  });
  // Zombi
  makeHumanoid(scene, 'zombie', basePal({ S: '#7fb069', E: '#ff3b3b', H: '#3c5a2e', C: '#5b6b7a', D: '#3e4a55', P: '#4a3f35' }), (ctx, ox) => {
    R(ctx, ox + 6, 9, 1, 2, '#7fb069'); R(ctx, ox + 9, 11, 1, 1, '#7fb069'); R(ctx, ox + 5, 6, 1, 1, '#5a8a48');
  });
  makeHumanoid(scene, 'zombie_brute', basePal({ S: '#9c7fc0', E: '#ffdd33', H: '#4b3466', C: '#6e2f2f', D: '#4d1f1f', P: '#2c2c2c' }), (ctx, ox) => {
    R(ctx, ox + 3, 9, 1, 2, '#9c7fc0'); R(ctx, ox + 12, 9, 1, 2, '#9c7fc0');
  });
}

// ---------- Zemin tileset ----------
function makeTiles(scene) {
  addCanvas(scene, 'tiles', 128, 16, (ctx) => {
    noise(ctx, 16, 16, '#5c9e4c', ['#4f8f41', '#6aae57', '#57964a'], 0.35, 0);
    noise(ctx, 16, 16, '#5c9e4c', ['#4f8f41', '#6aae57'], 0.3, 16);
    [[3, 4, '#f2e86d'], [11, 9, '#f5f5f5'], [6, 12, '#e86d9a']].forEach(([x, y, c]) => { R(ctx, 16 + x, y, 1, 1, c); R(ctx, 16 + x, y + 1, 1, 1, '#3f7a34'); });
    noise(ctx, 16, 16, '#5c9e4c', ['#4f8f41', '#57964a'], 0.3, 32);
    [[3, 5], [10, 3], [7, 11], [12, 12]].forEach(([x, y]) => { R(ctx, 32 + x, y, 1, 2, '#3f7a34'); R(ctx, 33 + x, y + 1, 1, 1, '#3f7a34'); });
    noise(ctx, 16, 16, '#b8915e', ['#a8814f', '#c7a06b', '#9d7748'], 0.4, 48);           // 3 yol
    noise(ctx, 16, 16, '#6e4b2e', ['#5d3f26', '#7a5636'], 0.3, 64);                       // 4 sürülmüş
    for (let y = 2; y < 16; y += 4) R(ctx, 64, y, 16, 1, '#4f341f');
    noise(ctx, 16, 16, '#4a3220', ['#3d2919', '#553a26'], 0.3, 80);                       // 5 ıslak
    for (let y = 2; y < 16; y += 4) R(ctx, 80, y, 16, 1, '#2f1f13');
    [[4, 6], [11, 13]].forEach(([x, y]) => R(ctx, 80 + x, y, 1, 1, '#7aa6c9'));
    noise(ctx, 16, 16, '#6aa956', ['#5e9c4c', '#78b663'], 0.3, 96);                       // 6 tarla çimi
    R(ctx, 112, 0, 16, 16, '#8d8f99');                                                     // 7 taş zemin
    for (let i = 0; i < 4; i++) { R(ctx, 112, i * 4, 16, 1, '#6f717b'); R(ctx, 112 + ((i % 2) ? 4 : 10), i * 4, 1, 4, '#6f717b'); }
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
      });
    }
  });
}

// ---------- Yapılar / dünya objeleri ----------
function makeProps(scene) {
  addCanvas(scene, 'tree', 16, 24, (ctx) => {
    R(ctx, 6, 15, 4, 9, '#6b4a2f'); R(ctx, 6, 15, 1, 9, '#4f341f');
    R(ctx, 2, 4, 12, 11, '#2f6f3a'); R(ctx, 4, 1, 8, 15, '#2f6f3a'); R(ctx, 1, 6, 14, 6, '#2f6f3a');
    R(ctx, 4, 3, 5, 4, '#3f8f4a'); R(ctx, 3, 7, 4, 3, '#3f8f4a'); R(ctx, 9, 8, 3, 3, '#285c30');
  });
  addCanvas(scene, 'stump', 16, 16, (ctx) => { R(ctx, 5, 9, 6, 5, '#6b4a2f'); R(ctx, 5, 9, 6, 2, '#c9a06b'); });
  addCanvas(scene, 'rock', 16, 16, (ctx) => {
    R(ctx, 3, 7, 10, 7, '#7d808a'); R(ctx, 5, 5, 6, 3, '#7d808a'); R(ctx, 4, 6, 4, 3, '#a2a6b0'); R(ctx, 3, 13, 10, 1, '#5a5d66');
  });
  addCanvas(scene, 'shelter', 64, 56, (ctx) => {
    R(ctx, 4, 22, 56, 32, '#8a5a3a');
    for (let y = 24; y < 54; y += 5) R(ctx, 4, y, 56, 1, '#6b4429');
    for (let i = 0; i < 18; i++) R(ctx, 30 - i * 1.7, 4 + i, 4 + i * 3.4, 1, i % 3 ? '#a83b33' : '#8a2e28');
    R(ctx, 0, 21, 64, 3, '#5a2620');
    R(ctx, 26, 38, 12, 16, '#4a2f1f'); R(ctx, 27, 39, 10, 15, '#5d3c27'); R(ctx, 35, 46, 1, 2, '#e8c867');
    R(ctx, 10, 30, 9, 8, '#f6d77a'); R(ctx, 45, 30, 9, 8, '#f6d77a'); R(ctx, 14, 30, 1, 8, '#4a2f1f'); R(ctx, 49, 30, 1, 8, '#4a2f1f');
    R(ctx, 22, 12, 20, 6, '#e8dcc0'); R(ctx, 24, 14, 16, 2, '#8a2e28'); // tabela
  });
  addCanvas(scene, 'house', 48, 44, (ctx) => {
    R(ctx, 4, 18, 40, 24, '#c9b48a'); for (let y = 20; y < 42; y += 4) R(ctx, 4, y, 40, 1, '#b39e74');
    for (let i = 0; i < 16; i++) R(ctx, 22 - i * 1.4, 2 + i, 4 + i * 2.8, 1, i % 3 ? '#4f6f9e' : '#3e5a82');
    R(ctx, 20, 30, 8, 12, '#5d3c27'); R(ctx, 8, 24, 8, 7, '#9fd0f0'); R(ctx, 32, 24, 8, 7, '#9fd0f0');
  });
  addCanvas(scene, 'market', 48, 36, (ctx) => {
    R(ctx, 4, 14, 2, 22, '#5d3c27'); R(ctx, 42, 14, 2, 22, '#5d3c27');
    for (let i = 0; i < 8; i++) R(ctx, i * 6, 4, 6, 10, i % 2 ? '#f5f0e6' : '#d94f4f');
    R(ctx, 0, 13, 48, 2, '#a83b33');
    R(ctx, 2, 24, 44, 10, '#8a5a3a'); R(ctx, 2, 24, 44, 2, '#a87048');
    [[8, '#e8792b'], [16, '#f08a24'], [26, '#e8c867'], [36, '#6fbf5a']].forEach(([x, c]) => R(ctx, x, 20, 5, 4, c));
  });
  addCanvas(scene, 'forge', 48, 40, (ctx) => {
    R(ctx, 2, 10, 44, 28, '#6f717b'); for (let y = 12; y < 38; y += 5) R(ctx, 2, y, 44, 1, '#5a5d66');
    R(ctx, 0, 6, 48, 5, '#3a3a44'); R(ctx, 34, 0, 8, 8, '#4a4a55');
    R(ctx, 8, 22, 14, 14, '#1f1a1a'); R(ctx, 10, 28, 10, 8, '#f08a24'); R(ctx, 12, 30, 6, 4, '#ffd166');
    R(ctx, 28, 30, 12, 3, '#2c2c34'); R(ctx, 31, 33, 6, 4, '#2c2c34'); // örs
  });
  addCanvas(scene, 'fence', 16, 16, (ctx) => {
    R(ctx, 2, 4, 2, 11, '#8a5a3a'); R(ctx, 12, 4, 2, 11, '#8a5a3a'); R(ctx, 0, 6, 16, 2, '#a87048'); R(ctx, 0, 11, 16, 2, '#a87048');
  });
  addCanvas(scene, 'barricade', 16, 16, (ctx) => {
    R(ctx, 1, 6, 14, 3, '#8a5a3a'); R(ctx, 1, 11, 14, 3, '#8a5a3a');
    for (const x of [2, 7, 12]) { R(ctx, x, 3, 2, 12, '#6b4429'); R(ctx, x, 2, 2, 1, '#c8c8d0'); }
  });
  addCanvas(scene, 'turret', 16, 16, (ctx) => {
    R(ctx, 3, 10, 10, 5, '#5a5d66'); R(ctx, 4, 6, 8, 5, '#7d808a'); R(ctx, 5, 7, 6, 3, '#9aa3ad');
    R(ctx, 10, 7, 6, 2, '#2c2c34'); R(ctx, 7, 7, 2, 2, '#ff5a5a');
  });
  addCanvas(scene, 'bullet', 4, 4, (ctx) => { R(ctx, 1, 0, 2, 4, '#ffd166'); R(ctx, 0, 1, 4, 2, '#ffd166'); R(ctx, 1, 1, 2, 2, '#fff'); });
  addCanvas(scene, 'px', 2, 2, (ctx) => R(ctx, 0, 0, 2, 2, '#ffffff'));
  addCanvas(scene, 'shadow', 12, 4, (ctx) => { R(ctx, 2, 0, 8, 4, 'rgba(0,0,0,0.25)'); R(ctx, 0, 1, 12, 2, 'rgba(0,0,0,0.25)'); });
  addCanvas(scene, 'cursor', 16, 16, (ctx) => {
    const c = 'rgba(255,255,255,0.85)';
    R(ctx, 0, 0, 4, 1, c); R(ctx, 0, 0, 1, 4, c); R(ctx, 12, 0, 4, 1, c); R(ctx, 15, 0, 1, 4, c);
    R(ctx, 0, 15, 4, 1, c); R(ctx, 0, 12, 1, 4, c); R(ctx, 12, 15, 4, 1, c); R(ctx, 15, 12, 1, 4, c);
  });
  addCanvas(scene, 'slash', 16, 16, (ctx) => {
    for (let i = 0; i < 12; i++) R(ctx, 2 + i, 2 + Math.round(Math.sin(i / 11 * Math.PI) * -1 + i * 0.6), 2, 2, 'rgba(255,255,255,0.9)');
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
export function iconURL(scene, key) {
  if (iconCache[key]) return iconCache[key];
  const tex = scene.textures.get(key);
  const src = tex.getSourceImage();
  const fw = Math.min(src.width, 16), fh = Math.min(src.height, 16);
  const { c, ctx } = makeCanvas(fw, fh);
  ctx.drawImage(src, 0, 0, fw, fh, 0, 0, fw, fh);
  return (iconCache[key] = c.toDataURL());
}
