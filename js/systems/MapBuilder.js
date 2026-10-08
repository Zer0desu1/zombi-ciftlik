import { TILE, MAP_W, MAP_H, FARM_ZONE, SHELTER_TILE, MARKET_TILE, FORGE_TILE } from '../config.js';
import { Shelter } from '../entities/Structures.js';
import { T } from './Farm.js';

const inRect = (x, y, r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

// Dünyayı (zemin, binalar, kaynaklar) kurar. Aynı tohumla her seferinde aynı harita oluşur.
export function buildWorld(scene) {
  const rng = new Phaser.Math.RandomDataGenerator(['zombi-ciftlik']);
  const data = [];
  for (let y = 0; y < MAP_H; y++) {
    const row = [];
    for (let x = 0; x < MAP_W; x++) {
      const r = rng.frac();
      row.push(r < 0.08 ? T.GRASS2 : r < 0.2 ? T.GRASS3 : T.GRASS);
    }
    data.push(row);
  }
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) data[y][x] = t; };

  // Tarla zemini
  for (let y = FARM_ZONE.y; y < FARM_ZONE.y + FARM_ZONE.h; y++)
    for (let x = FARM_ZONE.x; x < FARM_ZONE.x + FARM_ZONE.w; x++) set(x, y, T.FARM);
  // Yollar
  for (let x = 3; x < MAP_W - 3; x++) set(x, 23, T.PATH);
  for (let y = 4; y < MAP_H - 3; y++) set(32, y, T.PATH);
  for (let x = 22; x <= 32; x++) set(x, 14, T.PATH);
  for (let x = 33; x <= 48; x++) set(x, 17, T.PATH);
  for (let y = 23; y <= 27; y++) set(44, y, T.PATH);
  // Meydan
  for (let y = 21; y <= 25; y++) for (let x = 27; x <= 37; x++) set(x, y, T.STONE);

  const map = scene.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
  const tiles = map.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0);
  const layer = map.createLayer(0, tiles, 0, 0).setDepth(-10);

  const obstacles = scene.physics.add.staticGroup();
  const addBlock = (x, y, key, bw, bh, ox, oy, depthOffset) => {
    const img = obstacles.create(x, y, key);
    img.body.setSize(bw, bh).setOffset(ox, oy);
    img.setDepth(y + depthOffset);
    return img;
  };

  // Sığınak
  const sx = SHELTER_TILE.x * TILE + 32, sy = SHELTER_TILE.y * TILE + 28;
  const shelter = new Shelter(scene, sx, sy);

  // Pazar tezgâhı ve demirhane
  const mx = MARKET_TILE.x * TILE + 24, my = MARKET_TILE.y * TILE + 18;
  addBlock(mx, my, 'market', 44, 10, 2, 24, 16);
  const fx = FORGE_TILE.x * TILE + 24, fy = FORGE_TILE.y * TILE + 20;
  addBlock(fx, fy, 'forge', 44, 22, 2, 14, 18);
  // Dekoratif evler
  [[14, 27], [20, 27], [48, 31], [53, 13]].forEach(([tx, ty]) => addBlock(tx * TILE + 24, ty * TILE + 22, 'house', 40, 20, 4, 22, 20));

  // Tarla çiti (sağda ve altta giriş boşlukları)
  const fz = FARM_ZONE;
  for (let x = fz.x - 1; x <= fz.x + fz.w; x++) {
    addBlock(x * TILE + 8, (fz.y - 1) * TILE + 8, 'fence', 16, 6, 0, 8, 6);
    if (x < 12 || x > 15) addBlock(x * TILE + 8, (fz.y + fz.h) * TILE + 8, 'fence', 16, 6, 0, 8, 6);
  }
  for (let y = fz.y; y < fz.y + fz.h; y++) {
    addBlock((fz.x - 1) * TILE + 8, y * TILE + 8, 'fence', 4, 16, 6, 0, 6);
    if (y < 12 || y > 15) addBlock((fz.x + fz.w) * TILE + 8, y * TILE + 8, 'fence', 4, 16, 6, 0, 6);
  }

  // Kaynaklar: ağaç ve kaya (kasaba/tarla/yol dışında)
  const resources = scene.physics.add.staticGroup();
  const reserved = [
    { x: fz.x - 3, y: fz.y - 3, w: fz.w + 6, h: fz.h + 6 },
    { x: 24, y: 9, w: 34, h: 27 },
    { x: 10, y: 25, w: 18, h: 8 }
  ];
  const used = new Set();
  const place = (kind, count) => {
    let tries = 0;
    while (count > 0 && tries++ < 3000) {
      const tx = rng.between(1, MAP_W - 2), ty = rng.between(2, MAP_H - 2);
      if (reserved.some((r) => inRect(tx, ty, r)) || data[ty][tx] === T.PATH || used.has(`${tx},${ty}`)) continue;
      used.add(`${tx},${ty}`);
      const x = tx * TILE + 8, y = ty * TILE + (kind === 'tree' ? 4 : 8);
      const r = resources.create(x, y, kind);
      r.kind = kind;
      r.maxHits = kind === 'tree' ? 4 : 3;
      r.hits = r.maxHits;
      r.depleted = false;
      if (kind === 'tree') r.body.setSize(6, 5).setOffset(5, 18);
      else r.body.setSize(10, 6).setOffset(3, 8);
      r.setDepth(y + (kind === 'tree' ? 11 : 6));
      count--;
    }
  };
  place('tree', 60);
  place('rock', 32);

  return {
    map, layer, obstacles, resources, shelter,
    spots: {
      player: { x: sx, y: sy + 60 },
      farmer: { x: (fz.x + 6) * TILE, y: (fz.y + 5) * TILE },
      merchant: { x: mx, y: my + 30 },
      blacksmith: { x: fx + 8, y: fy + 34 },
      guard: { x: sx - 70, y: sy - 50 }
    },
    lights: [
      { x: sx, y: sy + 10, r: 120 },
      { x: fx - 6, y: fy + 10, r: 70 },
      { x: mx, y: my + 10, r: 55 }
    ]
  };
}

// Kaynak tükendiğinde / yeniden doğduğunda görünüm
export function depleteResource(r) {
  r.depleted = true;
  if (r.kind === 'tree') { r.setTexture('stump'); r.body.enable = false; }
  else { r.setVisible(false); r.body.enable = false; }
}

export function regrowResource(r) {
  r.depleted = false;
  r.hits = r.maxHits;
  r.setTexture(r.kind).setVisible(true);
  r.body.enable = true;
}
