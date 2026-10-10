import { TILE, MAP_W, MAP_H, FARM_ZONE, SHELTER_TILE, MARKET_TILE, FORGE_TILE } from '../config.js';
import { Shelter } from '../entities/Structures.js';
import { T } from './Farm.js';
import { makeCanvas, PAL, dith } from '../textures.js';

const inRect = (x, y, r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

// Keşif alanları (tile koordinatları): sol altta göl, doğuda terk edilmiş ev
export const LAKE_ZONE = { x: 3, y: 35, w: 8, h: 5 };
export const RUINS_ZONE = { x: 55, y: 27, w: 6, h: 5 };

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
  const buildings = [];
  const addBlock = (x, y, key, bw, bh, ox, oy, depthOffset) => {
    const img = obstacles.create(x, y, key);
    if (key !== 'fence') buildings.push(img);
    img.body.setSize(bw, bh).setOffset(ox, oy);
    img.setDepth(y + depthOffset);
    return img;
  };

  // Sığınak
  const sx = SHELTER_TILE.x * TILE + 32, sy = SHELTER_TILE.y * TILE + 28;
  const shelter = new Shelter(scene, sx, sy);
  buildings.push(shelter);

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
    { x: 10, y: 25, w: 18, h: 8 },
    { x: LAKE_ZONE.x - 1, y: LAKE_ZONE.y - 1, w: LAKE_ZONE.w + 2, h: LAKE_ZONE.h + 2 },
    { x: RUINS_ZONE.x - 1, y: RUINS_ZONE.y - 1, w: RUINS_ZONE.w + 2, h: RUINS_ZONE.h + 2 }
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

  // --- Göl (sol alt) ---
  const lz = LAKE_ZONE, lw = lz.w * TILE, lh = lz.h * TILE, lx = lz.x * TILE, ly = lz.y * TILE;
  if (scene.textures.exists('lake')) scene.lakeImage = scene.add.image(lx, ly, 'lake').setOrigin(0, 0).setDepth(-9.8);
  // Yuvarlak köşeli su gövdesi: iki görünmez blok (oyuncu kıyıda durabilir)
  const waterBlock = (x, y, w, h) => {
    const b = obstacles.create(x + w / 2, y + h / 2, 'px').setVisible(false);
    b.body.setSize(w, h);
    b.isWater = true;
    return b;
  };
  waterBlock(lx + 4, ly + 14, lw - 8, lh - 28);
  waterBlock(lx + 14, ly + 5, lw - 28, lh - 10);
  scene.lakeRect = new Phaser.Geom.Rectangle(lx + 3, ly + 3, lw - 6, lh - 6);

  // --- Terk edilmiş ev (doğu) ---
  const rz = RUINS_ZONE;
  const rx = (rz.x + 2) * TILE + 8, ry = rz.y * TILE + 26;
  if (scene.textures.exists('ruins')) {
    addBlock(rx, ry, 'ruins', 40, 18, 4, 24, 20);
    const chest = obstacles.create((rz.x + 4) * TILE + 12, (rz.y + 3) * TILE + 10, 'chest');
    chest.body.setSize(12, 6).setOffset(2, 9);
    chest.setDepth(chest.y + 6);
    scene.ruinChest = chest;
    // Etrafta dağınık tahta ve taş parçaları (yalnızca dekor)
    [[rz.x, rz.y + 4, 'debris'], [rz.x + 5, rz.y + 1, 'debris'], [rz.x + 1, rz.y + 4, 'rubble'], [rz.x + 5, rz.y + 4, 'rubble']]
      .forEach(([tx, ty, key]) => scene.add.image(tx * TILE + 8, ty * TILE + 10, key).setDepth(ty * TILE));
  }

  // --- Çiçek / çalı süslemeleri (çarpışmasız) ---
  if (scene.textures.exists('flower_0')) {
    let n = 46, tries = 0;
    while (n > 0 && tries++ < 2000) {
      const tx = rng.between(1, MAP_W - 2), ty = rng.between(2, MAP_H - 2);
      if (data[ty][tx] === T.PATH || data[ty][tx] === T.FARM || data[ty][tx] === T.STONE || used.has(`${tx},${ty}`)) continue;
      if (inRect(tx, ty, { x: fz.x - 1, y: fz.y - 1, w: fz.w + 2, h: fz.h + 2 }) || inRect(tx, ty, reserved[3]) || inRect(tx, ty, reserved[4])) continue;
      if (inRect(tx, ty, { x: 26, y: 12, w: 26, h: 20 })) continue; // kasaba binaları
      used.add(`${tx},${ty}`);
      const key = `flower_${rng.between(0, 3)}`;
      scene.add.image(tx * TILE + rng.between(4, 12), ty * TILE + rng.between(6, 12), key).setDepth(ty * TILE - 2);
      n--;
    }
  }

  paintGround(scene, data, used, buildings);
  placeBushes(scene, data, used, reserved);

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

// --- Zemin süsleri: tek bir canvas dokusuna boyanır (yüzlerce sprite yerine tek çizim, mobilde ucuz) ---
// Çarpışması yoktur ve kaynak/çiçek yerleşiminden SONRA ayrı bir tohumla üretilir; böylece ağaç/kaya
// dizilimi (ve kayıtlardaki kaynak sırası) değişmez.
function paintGround(scene, data, used, buildings) {
  const W = MAP_W * TILE, H = MAP_H * TILE;
  const rng = new Phaser.Math.RandomDataGenerator(['zombi-ciftlik-dekor']);
  const { c, ctx } = makeCanvas(W, H);
  const G = PAL.grass, D = PAL.dirt, S = PAL.stone;
  const tileAt = (tx, ty) => (tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H ? data[ty][tx] : -1);
  const isGrass = (tx, ty) => { const t = tileAt(tx, ty); return t >= 0 && t <= T.GRASS3; };
  const onGrass = (px, py) => isGrass(Math.floor(px / TILE), Math.floor(py / TILE));
  const dot = (px, py, col) => { ctx.fillStyle = col; ctx.fillRect(px, py, 1, 1); };
  const lake = scene.lakeRect;
  const inLake = (px, py) => lake && px >= lake.x - 4 && py >= lake.y - 4 && px < lake.right + 4 && py < lake.bottom + 4;

  // 1) Büyük ton lekeleri: karo tekrarını kırar (koyu ve açık, kareli tarama)
  for (let i = 0; i < 70; i++) {
    const cx = rng.between(0, W), cy = rng.between(0, H), rx = rng.between(10, 26), ry = rng.between(7, 16);
    const col = rng.frac() < 0.6 ? '#4a9646' : '#5eab53', th = rng.frac() * 0.25 - 0.3;
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
      const e = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      if (e > 1) continue;
      const px = cx + x, py = cy + y;
      if (dith(px, py) < th + (1 - e) * 0.3 && onGrass(px, py) && !inLake(px, py)) dot(px, py, col);
    }
  }

  // 2) Yol ve meydan kenarları: çim, kenar boyunca düzensizce yola taşar; altında koyu bir dudak
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    const t = data[ty][tx];
    if (t !== T.PATH && t !== T.STONE) continue;
    const lip = t === T.PATH ? D[3] : 'rgba(24,20,37,0.28)';
    for (const [dx, dy] of dirs) {
      if (!isGrass(tx + dx, ty + dy)) continue;
      let d = 1;
      for (let i = 0; i < TILE; i++) {
        d = Phaser.Math.Clamp(d + rng.between(-1, 1), 0, t === T.PATH ? 3 : 1);
        for (let k = 0; k <= d; k++) {
          const px = dx === 1 ? tx * TILE + 15 - k : dx === -1 ? tx * TILE + k : tx * TILE + i;
          const py = dy === 1 ? ty * TILE + 15 - k : dy === -1 ? ty * TILE + k : ty * TILE + i;
          dot(px, py, k < d ? (k === d - 1 && rng.frac() < 0.3 ? G[4] : G[3]) : lip);
        }
      }
    }
  }

  // 3) Yapıların zemine düşen gölgesi (güneş sol üstte → gölge sağ alta)
  ctx.fillStyle = 'rgba(24,20,37,0.2)';
  buildings.forEach((b) => {
    const w = b.width, h = b.height, left = Math.round(b.x - w / 2), bottom = Math.round(b.y + h / 2);
    ctx.fillRect(left + 4, bottom - 2, w - 2, 4);
    ctx.fillRect(left + w - 2, bottom - Math.round(h * 0.3), 3, Math.round(h * 0.3) + 2);
  });

  // 4) Basamak taşı patikaları: göle, terk edilmiş eve ve ev kapılarının önüne
  const stone = (px, py) => {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    if (!isGrass(tx, ty) || used.has(`${tx},${ty}`)) return;
    const w = rng.between(4, 5);
    ctx.fillStyle = 'rgba(24,20,37,0.3)'; ctx.fillRect(px - 1, py + 1, w + 1, 3);
    ctx.fillStyle = S[4]; ctx.fillRect(px, py, w, 3);
    ctx.fillStyle = S[5]; ctx.fillRect(px, py, w - 1, 1);
    ctx.fillStyle = S[3]; ctx.fillRect(px + 1, py + 2, w - 1, 1);
  };
  const trail = (x0, y0, x1, y1) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 8));
    for (let i = 0; i <= n; i++) stone(Math.round(x0 + ((x1 - x0) * i) / n + (i % 2 ? 3 : -2)), Math.round(y0 + ((y1 - y0) * i) / n));
  };
  if (lake) trail(7 * TILE + 6, 24 * TILE + 4, 7 * TILE + 6, lake.y - 8);
  trail((RUINS_ZONE.x - 1) * TILE + 6, 24 * TILE + 4, (RUINS_ZONE.x - 1) * TILE + 6, (RUINS_ZONE.y + 4) * TILE);
  buildings.forEach((b) => { if (b.texture.key === 'house') trail(b.x - 3, b.y + b.height / 2 + 4, b.x - 3, b.y + b.height / 2 + 22); });

  // 5) Göl kıyısı: nemli koyu çim halkası, sazlar ve çakıllar
  if (lake) {
    const cx = lake.centerX, cy = lake.centerY, hw = lake.width / 2, hh = lake.height / 2;
    for (let py = lake.y - 12; py < lake.bottom + 12; py++) for (let px = lake.x - 12; px < lake.right + 12; px++) {
      const ex = Math.max(0, Math.abs(px - cx) - hw + 10), ey = Math.max(0, Math.abs(py - cy) - hh + 10);
      const dist = Math.hypot(ex, ey) - 10;
      if (dist < 0 || dist > 9 || !onGrass(px, py)) continue;
      if (dith(px, py) < 0.35 - dist / 9) dot(px, py, dist < 3 ? G[1] : G[2]);
    }
    for (let i = 0; i < 16; i++) {
      const side = i % 4, f = rng.frac();
      const px = Math.round(side < 2 ? lake.x + f * lake.width : side === 2 ? lake.x - rng.between(3, 7) : lake.right + rng.between(2, 6));
      const py = Math.round(side === 0 ? lake.y - rng.between(4, 7) : side === 1 ? lake.bottom + rng.between(4, 8) : lake.y + f * lake.height);
      if (!onGrass(px, py)) continue;
      if (rng.frac() < 0.6) {
        ctx.fillStyle = G[1]; ctx.fillRect(px, py - 4, 1, 5); ctx.fillRect(px + 2, py - 3, 1, 4);
        ctx.fillStyle = G[4]; ctx.fillRect(px + 1, py - 6, 1, 7);
        ctx.fillStyle = D[2]; ctx.fillRect(px + 1, py - 7, 1, 3);
      } else { dot(px, py, S[4]); dot(px + 1, py, S[3]); dot(px, py - 1, S[5]); }
    }
  }

  // 6) Çiçek kümeleri, ot tutamları ve çakıllar (yalnızca çimde, kaynak karolarından uzak)
  const FL = PAL.flower;
  const freeGrass = (px, py) => onGrass(px, py) && !used.has(`${Math.floor(px / TILE)},${Math.floor(py / TILE)}`) && !inLake(px, py);
  for (let i = 0; i < 110; i++) {
    const cx = rng.between(8, W - 8), cy = rng.between(8, H - 8);
    if (!freeGrass(cx, cy)) continue;
    const a = FL[rng.between(0, FL.length - 1)], b = rng.frac() < 0.4 ? FL[rng.between(0, FL.length - 1)] : a;
    for (let k = rng.between(3, 7); k > 0; k--) {
      const px = cx + rng.between(-7, 7), py = cy + rng.between(-5, 5);
      if (!freeGrass(px, py)) continue;
      const col = rng.frac() < 0.5 ? a : b;
      dot(px, py + 1, G[1]);
      if (rng.frac() < 0.4) { dot(px - 1, py, col); dot(px + 1, py, col); dot(px, py - 1, col); dot(px, py, col === FL[0] ? FL[1] : FL[0]); }
      else dot(px, py, col);
    }
  }
  for (let i = 0; i < 260; i++) {
    const px = rng.between(2, W - 3), py = rng.between(2, H - 3);
    if (!freeGrass(px, py)) continue;
    dot(px, py, G[2]); dot(px + 2, py, G[2]); dot(px + 1, py + 1, G[2]); dot(px + 1, py, G[4]);
    if (rng.frac() < 0.3) dot(px + 1, py - 1, G[5]);
  }
  for (let i = 0; i < 70; i++) {
    const px = rng.between(2, W - 3), py = rng.between(2, H - 3);
    if (!freeGrass(px, py)) continue;
    dot(px, py, S[4]); dot(px + 1, py, S[3]); dot(px, py + 1, 'rgba(24,20,37,0.3)'); dot(px + 1, py + 1, 'rgba(24,20,37,0.3)');
  }

  if (scene.textures.exists('ground_decor')) scene.textures.remove('ground_decor');
  scene.textures.addCanvas('ground_decor', c);
  scene.groundDecor = scene.add.image(0, 0, 'ground_decor').setOrigin(0, 0).setDepth(-9.9);
}

// Çalılar: evlerin yanlarında ve kırlarda çarpışmasız süs; derinliği tabanına göre sıralanır
function placeBushes(scene, data, used, reserved) {
  if (!scene.textures.exists('bush')) return;
  const rng = new Phaser.Math.RandomDataGenerator(['zombi-ciftlik-cali']);
  scene.decorBushes = [];
  const add = (x, y) => scene.decorBushes.push(scene.add.image(x, y, 'bush').setDepth(y + 7));
  [[14, 27], [20, 27], [48, 31], [53, 13]].forEach(([tx, ty]) => { add(tx * TILE + 2, ty * TILE + 36); add(tx * TILE + 47, ty * TILE + 38); });
  let n = 22, tries = 0;
  while (n > 0 && tries++ < 800) {
    const tx = rng.between(1, MAP_W - 2), ty = rng.between(2, MAP_H - 2);
    if (reserved.some((r) => inRect(tx, ty, r)) || data[ty][tx] > T.GRASS3 || used.has(`${tx},${ty}`)) continue;
    if ([[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => data[ty + dy]?.[tx + dx] === T.PATH)) continue;
    used.add(`${tx},${ty}`);
    add(tx * TILE + rng.between(5, 11), ty * TILE + rng.between(6, 9));
    n--;
  }
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
