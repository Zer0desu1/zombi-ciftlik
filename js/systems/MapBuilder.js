import { TILE, MAP_W, MAP_H, LEGACY_MAP_W, LEGACY_MAP_H, V2_MAP_W, V2_MAP_H, FARM_ZONE, SHELTER_TILE, MARKET_TILE, FORGE_TILE } from '../config.js';
import { Shelter } from '../entities/Structures.js';
import { T } from './Farm.js';
import { makeCanvas, PAL, dith } from '../textures.js';

const inRect = (x, y, r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

// Keşif alanları (tile koordinatları): sol altta göl, doğuda terk edilmiş ev
export const LAKE_ZONE = { x: 3, y: 35, w: 8, h: 5 };
export const RUINS_ZONE = { x: 55, y: 27, w: 6, h: 5 };

// --- Sürüm 3 (128×88) yeni alanı: doğu şeridi (x ≥ 94) ve güney şeridi (y ≥ 62) ---
// Göller (eski göl dokusuyla aynı 8×5 boyut), taş ocağı, yaşlı koru, terk edilmiş kamp, güney mezrası ve
// yaban hayvanlarına açık çayırlar. Hepsi tile koordinatı; eski alanlara dokunmaz.
export const NEW_LAKES = [
  { x: 114, y: 30, w: 8, h: 5, flip: true },
  { x: 10, y: 72, w: 8, h: 5 },
  { x: 84, y: 78, w: 8, h: 5, flip: true }
];
export const QUARRY_ZONE = { x: 98, y: 62, w: 9, h: 7 };
export const GROVE_ZONE = { x: 60, y: 64, w: 18, h: 8 };
export const CAMP_ZONE = { x: 116, y: 60, w: 6, h: 5 };
const HAMLET_ZONE = { x: 42, y: 68, w: 16, h: 6 };
const HAMLET_HOUSES = [[44, 70], [52, 70]];
// Yaban hayvanı çayırları: ağaç/kaya konmaz (wildlife/predators isterse scene.wildAreas'tan okur)
export const MEADOWS = [
  { id: 'ne_meadow', x: 98, y: 4, w: 24, h: 15 },
  { id: 'e_meadow', x: 96, y: 40, w: 12, h: 16 },
  { id: 's_meadow', x: 20, y: 64, w: 20, h: 8 }
];
// Yeni yollar: güney yolu (y=74, dikey ana yoldan doğuya) + doğu yolu (x=110, yatay ana yoldan güneye) → halka
const ROAD_S = { y: 74, x0: 33, x1: 110 };
const ROAD_E = { x: 110, y0: 24, y1: 74 };

// --- Orman sınırı: haritanın dört kenarında oyuncunun giremediği sık orman şeridi ---
// Zombiler ve hayvanlar bu şeritle çarpışmaz (ormandan çıkıp gelirler); yalnızca oyuncu durdurulur.
export const FOREST_TILES = 2;
export const FOREST_PX = FOREST_TILES * TILE;
export const inForest = (tx, ty) => tx < FOREST_TILES || ty < FOREST_TILES || tx >= MAP_W - FOREST_TILES || ty >= MAP_H - FOREST_TILES;
// İleride açılacak geçitler (kilitli keşif bölgeleri için): yolların harita kenarına ulaştığı yerler.
// side: 0 kuzey, 1 güney, 2 batı, 3 doğu · t: yolun tile sütunu/satırı. Şimdilik kütüklerle kapalıdır;
// scene.forestEdge.openGate(id) çarpışmayı ve kütük yığınını kaldırır.
export const FOREST_GATES = [
  { id: 'north', side: 0, t: 32 },
  { id: 'east', side: 3, t: 23 },
  { id: 'south', side: 1, t: 32 },
  { id: 'west', side: 2, t: 23 }
];
// Geçidin kenar boyunca piksel aralığı (2 kare genişlik, yolu ortalar)
const gateSpan = (g) => [g.t * TILE - 8, g.t * TILE + 24];
// Geçide uzanan yol kareleri (kaynak/süs buraya konmaz)
function gatePathTiles() {
  const out = [];
  for (const g of FOREST_GATES) {
    if (g.side === 0) for (let y = 0; y < 4; y++) out.push([g.t, y]);
    else if (g.side === 1) for (let y = MAP_H - 4; y < MAP_H; y++) out.push([g.t, y]);
    else if (g.side === 2) for (let x = 0; x < 3; x++) out.push([x, g.t]);
    else for (let x = MAP_W - 3; x < MAP_W; x++) out.push([x, g.t]);
  }
  return out;
}
const GATE_TILES = new Set(gatePathTiles().map(([x, y]) => `${x},${y}`));
const edgeBlocked = (tx, ty) => inForest(tx, ty) || GATE_TILES.has(`${tx},${ty}`);

// --- Eski (64×44) harita uyumu ---
// Harita büyütülünce eski alandaki ağaç/kaya dizilimi aynı kalsın diye eski alan, eski RNG akışı ve eski
// kenar/yol kurallarıyla yerleştirilir; yeni alan ayrı bir tohumla doldurulur. Böylece kaynak sırası
// (0..LEGACY_RES-1) ve konumları sürüm 1 ile birebir aynıdır.
const LW = LEGACY_MAP_W, LH = LEGACY_MAP_H;
const legacyGate = new Set([
  ...[0, 1, 2, 3].map((y) => `32,${y}`), ...[LH - 4, LH - 3, LH - 2, LH - 1].map((y) => `32,${y}`),
  ...[0, 1, 2].map((x) => `${x},23`), ...[LW - 3, LW - 2, LW - 1].map((x) => `${x},23`)
]);
const legacyEdgeBlocked = (tx, ty) => tx < FOREST_TILES || ty < FOREST_TILES || tx >= LW - FOREST_TILES || ty >= LH - FOREST_TILES || legacyGate.has(`${tx},${ty}`);
// Eski haritada yatay yol x=60'ta, dikey yol y=40'ta bitiyordu (uzatılan kısımlar eski yerleşimde yol değildi)
const legacyPath = (data, tx, ty) => data[ty][tx] === T.PATH && !(ty === 23 && tx > LW - 4) && !(tx === 32 && ty > LH - 4);
export const LEGACY_RES = 92; // eski haritadaki kaynak sayısı (60 ağaç + 32 kaya)

// --- Sürüm 2 (96×64) harita uyumu ---
// 96×64 alanının ek kaynakları sürüm 2'deki kenar/geçit kurallarıyla aynı 'zombi-ciftlik-genis' akışından
// yerleştirilir; böylece kaynak sırası 0..V2_RES-1 sürüm 2 ile birebir aynıdır. Sürüm 3 alanı ayrı tohumla dolar.
const VW = V2_MAP_W, VH = V2_MAP_H;
const v2Gate = new Set([
  ...[0, 1, 2, 3].map((y) => `32,${y}`), ...[VH - 4, VH - 3, VH - 2, VH - 1].map((y) => `32,${y}`),
  ...[0, 1, 2].map((x) => `${x},23`), ...[VW - 3, VW - 2, VW - 1].map((x) => `${x},23`)
]);
const v2EdgeBlocked = (tx, ty) => tx < FOREST_TILES || ty < FOREST_TILES || tx >= VW - FOREST_TILES || ty >= VH - FOREST_TILES || v2Gate.has(`${tx},${ty}`);
export const V2_RES = LEGACY_RES + 71 + 38; // sürüm 2 haritasındaki kaynak sayısı
// Alan oranı (96×64'e göre): zemin süsü sayıları buna göre ölçeklenir
const AREA_K = (MAP_W * MAP_H) / (VW * VH);

// Dünyayı (zemin, binalar, kaynaklar) kurar. Aynı tohumla her seferinde aynı harita oluşur.
export function buildWorld(scene) {
  const rng = new Phaser.Math.RandomDataGenerator(['zombi-ciftlik']);
  // Yeni alan (x ≥ 64 ya da y ≥ 44) için ayrı tohum: eski akış değişmesin
  const rng2 = new Phaser.Math.RandomDataGenerator(['zombi-ciftlik-genis']);
  // Sürüm 3 alanı (x ≥ 96 ya da y ≥ 64) için üçüncü tohum: sürüm 2 akışı değişmesin
  const rng3 = new Phaser.Math.RandomDataGenerator(['zombi-ciftlik-genis-3']);
  const grass = (r) => (r < 0.08 ? T.GRASS2 : r < 0.2 ? T.GRASS3 : T.GRASS);
  const data = [];
  for (let y = 0; y < MAP_H; y++) data.push(new Array(MAP_W));
  for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) data[y][x] = grass(rng.frac());
  for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) if (x >= LW || y >= LH) data[y][x] = grass(rng2.frac());
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (x >= VW || y >= VH) data[y][x] = grass(rng3.frac());
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) data[y][x] = t; };

  // Hazır tarla yok: FARM_ZONE yalnızca ağaçsız açık bir çayır olarak bırakılır, tarlayı oyuncu kurar
  // Yollar
  for (let x = 3; x < MAP_W - 3; x++) set(x, 23, T.PATH);
  for (let y = 4; y < MAP_H - 3; y++) set(32, y, T.PATH);
  for (let x = 22; x <= 32; x++) set(x, 14, T.PATH);
  for (let x = 33; x <= 48; x++) set(x, 17, T.PATH);
  for (let y = 23; y <= 27; y++) set(44, y, T.PATH);
  // Sürüm 3: güney ve doğu yolları (yalnızca yeni alanda)
  for (let x = ROAD_S.x0; x <= ROAD_S.x1; x++) set(x, ROAD_S.y, T.PATH);
  for (let y = ROAD_E.y0; y <= ROAD_E.y1; y++) set(ROAD_E.x, y, T.PATH);
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
  // Güney mezrası (sürüm 3): terk edilmiş iki ev
  HAMLET_HOUSES.forEach(([tx, ty]) => addBlock(tx * TILE + 24, ty * TILE + 22, 'house', 40, 20, 4, 22, 20));

  const fz = FARM_ZONE;

  // Kaynaklar: ağaç ve kaya (kasaba/tarla/yol dışında)
  const resources = scene.physics.add.staticGroup();
  const reserved = [
    { x: fz.x - 3, y: fz.y - 3, w: fz.w + 6, h: fz.h + 6 },
    { x: 24, y: 9, w: 34, h: 27 },
    { x: 10, y: 25, w: 18, h: 8 },
    { x: LAKE_ZONE.x - 1, y: LAKE_ZONE.y - 1, w: LAKE_ZONE.w + 2, h: LAKE_ZONE.h + 2 },
    { x: RUINS_ZONE.x - 1, y: RUINS_ZONE.y - 1, w: RUINS_ZONE.w + 2, h: RUINS_ZONE.h + 2 }
  ];
  // Sürüm 3 alanında ayrılmış yerler (yalnızca yeni alanın yerleşimini etkiler; eski akışlara dokunmaz).
  // Sıra önemli: ilk 'poiN' tanesi göl/ocak/koru/kamp/mezra (süsler de kaçınır), sonrakiler çayırlar.
  const pad = (r, m = 1) => ({ x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 });
  const reserved3 = [
    ...NEW_LAKES.map((l) => pad(l)), pad(QUARRY_ZONE), pad(GROVE_ZONE, 0), pad(CAMP_ZONE), HAMLET_ZONE, ...MEADOWS
  ];
  const poiN = NEW_LAKES.length + 4;
  const used = new Set();
  // 'legacy': eski alan, eski RNG ve eski kurallar · 'v2': 96×64 alanı (rng2, sürüm 2 kuralları)
  // 'v3': 128×88'in yeni alanı (rng3) · region verilirse (v3) yalnızca o dikdörtgende küme halinde
  const nextTo = (tx, ty, fn) => [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => fn(tx + dx, ty + dy));
  const place = (kind, count, mode = 'legacy', region = null) => {
    let tries = 0;
    while (count > 0 && tries++ < 3000) {
      let tx, ty;
      if (mode === 'legacy') {
        tx = rng.between(1, LW - 2); ty = rng.between(2, LH - 2);
        if (reserved.some((r) => inRect(tx, ty, r)) || legacyPath(data, tx, ty) || used.has(`${tx},${ty}`)) continue;
      } else if (mode === 'v2') {
        tx = rng2.between(FOREST_TILES, VW - FOREST_TILES - 1); ty = rng2.between(FOREST_TILES, VH - FOREST_TILES - 1);
        // Yalnızca 64×44 haritada olmayan (ya da onun orman şeridi olan) kareler
        if (tx < LW - FOREST_TILES && ty < LH - FOREST_TILES) continue;
        if (v2EdgeBlocked(tx, ty) || reserved.some((r) => inRect(tx, ty, r)) || data[ty][tx] === T.PATH || used.has(`${tx},${ty}`)) continue;
        if (nextTo(tx, ty, (x, y) => v2Gate.has(`${x},${y}`))) continue;
      } else {
        if (region) { tx = rng3.between(region.x, region.x + region.w - 1); ty = rng3.between(region.y, region.y + region.h - 1); }
        else { tx = rng3.between(FOREST_TILES, MAP_W - FOREST_TILES - 1); ty = rng3.between(FOREST_TILES, MAP_H - FOREST_TILES - 1); }
        // Yalnızca 96×64 haritada olmayan (ya da onun orman şeridi olan) kareler
        if (tx < VW - FOREST_TILES && ty < VH - FOREST_TILES) continue;
        if (edgeBlocked(tx, ty) || data[ty][tx] === T.PATH || used.has(`${tx},${ty}`)) continue;
        if (!region && reserved3.some((r) => inRect(tx, ty, r))) continue;
        if (nextTo(tx, ty, (x, y) => GATE_TILES.has(`${x},${y}`))) continue;
        // Yeni yolların kenarına konmaz (yollar ve geçiş açık kalsın)
        if (nextTo(tx, ty, (x, y) => data[y]?.[x] === T.PATH)) continue;
      }
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
  // Orman şeridine / geçit yoluna düşen kaynakları içeri kaydır. Tohumlu yerleşim ve kaynak SIRASI
  // değişmez (kayıtlar ve çok oyunculu eşitleme kaynakları sıra numarasıyla tutar); yalnızca konum düzeltilir.
  // Eski alanın kaynakları eski kenar kurallarıyla kaydırılır (eski haritadakiyle aynı konum).
  relocateEdgeResources(resources, data, used, reserved);
  // Yeni alan: eski yoğunlukla orantılı (eski iç alan ~2816 kare → 60 ağaç / 32 kaya; eklenen ~3328 kare)
  place('tree', 71, 'v2');
  place('rock', 38, 'v2');
  // Sürüm 3 alanı (~4900 yeni kare): dağınık kaynak + yaşlı koru ve taş ocağı kümeleri
  place('tree', 74, 'v3');
  place('rock', 34, 'v3');
  place('tree', 30, 'v3', GROVE_ZONE);
  place('rock', 16, 'v3', QUARRY_ZONE);

  // --- Göller: sol alttaki ilk göl (scene.lakeRect) + sürüm 3 alanındaki yeni göller (scene.lakeRects hepsini tutar) ---
  // Yuvarlak köşeli su gövdesi: iki görünmez blok (oyuncu kıyıda durabilir)
  const waterBlock = (x, y, w, h) => {
    const b = obstacles.create(x + w / 2, y + h / 2, 'px').setVisible(false);
    b.body.setSize(w, h);
    b.isWater = true;
    return b;
  };
  scene.lakeRects = [];
  scene.lakeImages = [];
  const makeLake = (lz) => {
    const lw = lz.w * TILE, lh = lz.h * TILE, lx = lz.x * TILE, ly = lz.y * TILE;
    if (scene.textures.exists('lake')) scene.lakeImages.push(scene.add.image(lx, ly, 'lake').setOrigin(0, 0).setDepth(-9.8).setFlipX(!!lz.flip));
    waterBlock(lx + 4, ly + 14, lw - 8, lh - 28);
    waterBlock(lx + 14, ly + 5, lw - 28, lh - 10);
    const rect = new Phaser.Geom.Rectangle(lx + 3, ly + 3, lw - 6, lh - 6);
    scene.lakeRects.push(rect);
    return rect;
  };
  scene.lakeRect = makeLake(LAKE_ZONE);
  scene.lakeImage = scene.lakeImages[0];
  NEW_LAKES.forEach(makeLake);

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

  // --- Terk edilmiş kamp (sürüm 3, doğu yolunun yanı): yıkık kulübe + dağınık enkaz; ganimet sandıkları events.js'te ---
  const cz = CAMP_ZONE;
  if (scene.textures.exists('ruins')) {
    addBlock((cz.x + 2) * TILE + 8, cz.y * TILE + 26, 'ruins', 40, 18, 4, 24, 20).setFlipX(true);
    [[cz.x, cz.y + 1, 'debris'], [cz.x + 5, cz.y + 4, 'debris'], [cz.x + 1, cz.y + 4, 'rubble'], [cz.x + 4, cz.y + 4, 'rubble']]
      .forEach(([tx, ty, key]) => scene.add.image(tx * TILE + 8, ty * TILE + 10, key).setDepth(ty * TILE));
  }
  // Taş ocağı: kayaların arasında moloz (yalnızca dekor)
  if (scene.textures.exists('rubble')) {
    const qz = QUARRY_ZONE;
    [[qz.x + 1, qz.y + 1], [qz.x + 6, qz.y + 2], [qz.x + 3, qz.y + 5], [qz.x + 8, qz.y + 6]].forEach(([tx, ty]) => {
      if (!used.has(`${tx},${ty}`)) scene.add.image(tx * TILE + 8, ty * TILE + 10, 'rubble').setDepth(ty * TILE);
    });
  }

  // İlgi noktaları (events.js ganimet sandıkları; diğer modüller de okuyabilir) — tile dikdörtgenleri
  scene.mapPOIs = [
    { id: 'quarry', name: 'Taş Ocağı', ...QUARRY_ZONE },
    { id: 'grove', name: 'Yaşlı Koru', ...GROVE_ZONE },
    { id: 'camp', name: 'Terk Edilmiş Kamp', ...CAMP_ZONE },
    { id: 'hamlet', name: 'Güney Mezrası', ...HAMLET_ZONE },
    ...NEW_LAKES.map((l, i) => ({ id: `lake${i + 2}`, name: 'Göl Kıyısı', x: l.x - 2, y: l.y - 2, w: l.w + 4, h: l.h + 4 }))
  ];
  // Yaban hayvanları için geniş, açık alanlar (tile): çayırlar (ağaçsız) + koru (yırtıcılar için)
  scene.wildAreas = [...MEADOWS.map((m) => ({ ...m, kind: 'meadow' })), { id: 'grove', kind: 'forest', ...GROVE_ZONE }];

  // --- Çiçek / çalı süslemeleri (çarpışmasız) ---
  scene.decorFlowers = [];
  if (scene.textures.exists('flower_0')) {
    // 96×64 alanı sürüm 2 sınırları/kurallarıyla (aynı dizilim), sonra yeni alan ayrı tohumla
    let n = 100, tries = 0;
    while (n > 0 && tries++ < 4400) {
      const tx = rng.between(1, VW - 2), ty = rng.between(2, VH - 2);
      if (data[ty][tx] === T.PATH || data[ty][tx] === T.FARM || data[ty][tx] === T.STONE || used.has(`${tx},${ty}`)) continue;
      if (v2EdgeBlocked(tx, ty)) continue; // orman şeridi
      if (inRect(tx, ty, { x: fz.x - 1, y: fz.y - 1, w: fz.w + 2, h: fz.h + 2 }) || inRect(tx, ty, reserved[3]) || inRect(tx, ty, reserved[4])) continue;
      if (inRect(tx, ty, { x: 26, y: 12, w: 26, h: 20 })) continue; // kasaba binaları
      used.add(`${tx},${ty}`);
      const key = `flower_${rng.between(0, 3)}`;
      scene.decorFlowers.push(scene.add.image(tx * TILE + rng.between(4, 12), ty * TILE + rng.between(6, 12), key).setDepth(ty * TILE - 2));
      n--;
    }
    n = 80; tries = 0;
    while (n > 0 && tries++ < 4000) {
      const tx = rng3.between(1, MAP_W - 2), ty = rng3.between(2, MAP_H - 2);
      if (tx < VW - FOREST_TILES && ty < VH - FOREST_TILES) continue;
      if (data[ty][tx] > T.GRASS3 || used.has(`${tx},${ty}`) || edgeBlocked(tx, ty)) continue;
      if (reserved3.some((r, i) => i < poiN && inRect(tx, ty, r))) continue; // göl/ocak/koru/kamp/mezra
      used.add(`${tx},${ty}`);
      const key = `flower_${rng3.between(0, 3)}`;
      scene.decorFlowers.push(scene.add.image(tx * TILE + rng3.between(4, 12), ty * TILE + rng3.between(6, 12), key).setDepth(ty * TILE - 2));
      n--;
    }
  }

  // Geçit yolları kenara kadar uzar (yerleşimden SONRA: tohumlu sıra etkilenmez)
  gatePathTiles().forEach(([x, y]) => { data[y][x] = T.PATH; layer.putTileAt(T.PATH, x, y); });

  paintGround(scene, data, used, buildings);
  placeBushes(scene, data, used, [...reserved, ...reserved3.slice(0, poiN)]);
  buildForestEdge(scene);

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
  const lakes = scene.lakeRects || (scene.lakeRect ? [scene.lakeRect] : []), lake = scene.lakeRect;
  const inLake = (px, py) => lakes.some((l) => px >= l.x - 4 && py >= l.y - 4 && px < l.right + 4 && py < l.bottom + 4);
  const nK = (n) => Math.round(n * AREA_K); // süs sayıları alanla ölçeklenir

  // 1) Büyük ton lekeleri: karo tekrarını kırar (koyu ve açık, kareli tarama)
  for (let i = 0; i < nK(150); i++) {
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
  // Sürüm 3: doğu yolundan kampa ve taş ocağına, güney yolundan güney göllerine
  trail((ROAD_E.x + 1) * TILE + 4, (CAMP_ZONE.y + 3) * TILE + 6, CAMP_ZONE.x * TILE - 4, (CAMP_ZONE.y + 3) * TILE + 6);
  trail((ROAD_E.x - 1) * TILE + 6, (QUARRY_ZONE.y + 3) * TILE + 6, (QUARRY_ZONE.x + QUARRY_ZONE.w) * TILE + 6, (QUARRY_ZONE.y + 3) * TILE + 6);
  NEW_LAKES.forEach((l) => {
    if (l.y < ROAD_S.y) return;
    const x = (l.x + l.w / 2) * TILE + 6;
    trail(x, (ROAD_S.y + 1) * TILE + 4, x, l.y * TILE - 8);
  });

  // 5) Göl kıyıları: nemli koyu çim halkası, sazlar ve çakıllar
  for (const lake of lakes) {
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
  for (let i = 0; i < nK(240); i++) {
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
  for (let i = 0; i < nK(560); i++) {
    const px = rng.between(2, W - 3), py = rng.between(2, H - 3);
    if (!freeGrass(px, py)) continue;
    dot(px, py, G[2]); dot(px + 2, py, G[2]); dot(px + 1, py + 1, G[2]); dot(px + 1, py, G[4]);
    if (rng.frac() < 0.3) dot(px + 1, py - 1, G[5]);
  }
  for (let i = 0; i < nK(150); i++) {
    const px = rng.between(2, W - 3), py = rng.between(2, H - 3);
    if (!freeGrass(px, py)) continue;
    dot(px, py, S[4]); dot(px + 1, py, S[3]); dot(px, py + 1, 'rgba(24,20,37,0.3)'); dot(px + 1, py + 1, 'rgba(24,20,37,0.3)');
  }

  if (scene.textures.exists('ground_decor')) scene.textures.remove('ground_decor');
  scene.textures.addCanvas('ground_decor', c);
  scene.groundDecor = scene.add.image(0, 0, 'ground_decor').setOrigin(0, 0).setDepth(-9.9);
  // Sürülen karedeki çim süslerini, çiçekleri ve çalıları kaldır (tarla her yerde açılabilir)
  scene.clearDecorAt = (tx, ty) => {
    const tex = scene.textures.get('ground_decor');
    tex.context?.clearRect(tx * TILE, ty * TILE, TILE, TILE);
    tex.refresh?.();
    const inTile = (o) => o.active && Math.floor(o.x / TILE) === tx && Math.floor((o.y - 1) / TILE) === ty;
    for (const list of [scene.decorFlowers, scene.decorBushes]) {
      if (!list) continue;
      for (let i = list.length - 1; i >= 0; i--) if (inTile(list[i])) { list[i].destroy(); list.splice(i, 1); }
    }
  };
}

// Çalılar: evlerin yanlarında ve kırlarda çarpışmasız süs; derinliği tabanına göre sıralanır
function placeBushes(scene, data, used, reserved) {
  if (!scene.textures.exists('bush')) return;
  const rng = new Phaser.Math.RandomDataGenerator(['zombi-ciftlik-cali']);
  scene.decorBushes = [];
  const add = (x, y) => scene.decorBushes.push(scene.add.image(x, y, 'bush').setDepth(y + 7));
  [[14, 27], [20, 27], [48, 31], [53, 13]].forEach(([tx, ty]) => { add(tx * TILE + 2, ty * TILE + 36); add(tx * TILE + 47, ty * TILE + 38); });
  HAMLET_HOUSES.forEach(([tx, ty]) => { add(tx * TILE + 2, ty * TILE + 36); add(tx * TILE + 47, ty * TILE + 38); });
  let n = Math.round(48 * AREA_K), tries = 0;
  while (n > 0 && tries++ < 1750 * AREA_K) {
    const tx = rng.between(1, MAP_W - 2), ty = rng.between(2, MAP_H - 2);
    if (reserved.some((r) => inRect(tx, ty, r)) || data[ty][tx] > T.GRASS3 || used.has(`${tx},${ty}`)) continue;
    if (edgeBlocked(tx, ty)) continue;
    if ([[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => data[ty + dy]?.[tx + dx] === T.PATH)) continue;
    used.add(`${tx},${ty}`);
    add(tx * TILE + rng.between(5, 11), ty * TILE + rng.between(6, 9));
    n--;
  }
}

// Orman şeridine/geçit yoluna düşen ağaç ve kayayı en yakın boş kareye taşı (rastgele sayı kullanmaz → her açılışta aynı)
function relocateEdgeResources(resources, data, used, reserved) {
  // Yalnızca eski alanın kaynakları için çağrılır: eski harita sınırları ve kenar kuralları
  const free = (tx, ty) => tx >= 0 && ty >= 0 && tx < LW && ty < LH && !legacyEdgeBlocked(tx, ty)
    && !reserved.some((r) => inRect(tx, ty, r)) && !legacyPath(data, tx, ty) && !used.has(`${tx},${ty}`);
  resources.getChildren().forEach((r) => {
    const tx = Math.floor(r.x / TILE), ty = Math.floor(r.y / TILE);
    if (!legacyEdgeBlocked(tx, ty)) return;
    let spot = null;
    for (let d = 1; d <= 5 && !spot; d++) {
      // Önce içeri (harita merkezine) doğru, sonra çevresine bak
      const ix = tx < LW / 2 ? 1 : -1, iy = ty < LH / 2 ? 1 : -1;
      const cands = [[tx + ix * d, ty], [tx, ty + iy * d], [tx + ix * d, ty + iy * d], [tx - ix * d, ty + iy * d], [tx + ix * d, ty - iy * d]];
      spot = cands.find(([x, y]) => free(x, y)) || null;
    }
    // Yedek: halkalar halinde tüm komşu kareler (göl gibi ayrılmış alanların dibinde kalınırsa)
    for (let d = 1; d <= 8 && !spot; d++) {
      for (let dy = -d; dy <= d && !spot; dy++) for (let dx = -d; dx <= d && !spot; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === d && free(tx + dx, ty + dy)) spot = [tx + dx, ty + dy];
      }
    }
    if (!spot) return;
    const [nx, ny] = spot;
    used.delete(`${tx},${ty}`);
    used.add(`${nx},${ny}`);
    const dx = (nx - tx) * TILE, dy = (ny - ty) * TILE;
    r.setPosition(r.x + dx, r.y + dy);
    r.setDepth(r.y + (r.kind === 'tree' ? 11 : 6));
    const b = r.body;
    b.x += dx; b.y += dy; // StaticBody x/y ayarlayıcıları statik ağacı da günceller
    b.updateCenter?.();
  });
}

// --- Orman kenarı: görünmez çarpışma şeritleri + tek seferde canvas'a boyanmış sık ağaç tepeleri ---
function buildForestEdge(scene) {
  const W = MAP_W * TILE, H = MAP_H * TILE, B = FOREST_PX;
  const group = scene.physics.add.staticGroup();
  const block = (x, y, w, h) => {
    const b = group.create(x + w / 2, y + h / 2, 'px').setVisible(false);
    b.body.setSize(w, h);
    b.isForest = true;
    return b;
  };
  // Kenarı geçit boşluklarını atlayarak parçalara böl
  const along = (side, len) => {
    const gaps = FOREST_GATES.filter((g) => g.side === side).map(gateSpan).sort((a, b) => a[0] - b[0]);
    const segs = [];
    let a = 0;
    for (const [g0, g1] of gaps) { if (g0 > a) segs.push([a, g0]); a = g1; }
    if (a < len) segs.push([a, len]);
    return segs;
  };
  along(0, W).forEach(([a, b]) => block(a, 0, b - a, B));
  along(1, W).forEach(([a, b]) => block(a, H - B, b - a, B));
  along(2, H).forEach(([a, b]) => block(0, a, B, b - a));
  along(3, H).forEach(([a, b]) => block(W - B, a, B, b - a));

  makeGateTextures(scene);
  const gates = FOREST_GATES.map((g) => {
    const [a0, a1] = gateSpan(g), horiz = g.side < 2;
    const rect = horiz ? new Phaser.Geom.Rectangle(a0, g.side === 0 ? 0 : H - B, a1 - a0, B) : new Phaser.Geom.Rectangle(g.side === 2 ? 0 : W - B, a0, B, a1 - a0);
    const body = block(rect.x, rect.y, rect.width, rect.height);
    body.isGate = g.id;
    // Kütük yığını geçidin iç ağzında durur
    const bx = horiz ? rect.centerX : g.side === 2 ? B - 6 : W - B + 6;
    const by = horiz ? (g.side === 0 ? B - 4 : H - B + 6) : rect.centerY + 4;
    const img = scene.add.image(bx, by, horiz ? 'forest_gate' : 'forest_gate_v').setDepth(by + 8);
    return { id: g.id, side: g.side, rect, body, img, open: false };
  });

  const canopy = paintForest(scene);
  shadeForestGround(scene);

  scene.forestEdge = {
    group, gates, canopy,
    playable: new Phaser.Geom.Rectangle(B, B, W - B * 2, H - B * 2),
    openGate(id) {
      const g = gates.find((o) => o.id === id);
      if (!g || g.open) return false;
      g.open = true;
      g.body.destroy();
      g.img.destroy();
      return true;
    }
  };
  return scene.forestEdge;
}

// Geçidi kapatan devrik kütük + diken çalısı (yatay: kuzey/güney, dikey: batı/doğu)
function makeGateTextures(scene) {
  const Wd = PAL.wood, L = PAL.leaf;
  const draw = (key, w, h, vertical) => {
    if (scene.textures.exists(key)) return;
    const { c, ctx } = makeCanvas(w, h);
    const log = (x, y, len) => {
      if (vertical) {
        ctx.fillStyle = Wd[2]; ctx.fillRect(x, y, 6, len); ctx.fillStyle = Wd[4]; ctx.fillRect(x, y, 2, len); ctx.fillStyle = Wd[1]; ctx.fillRect(x + 5, y, 1, len);
        ctx.fillStyle = Wd[5]; ctx.fillRect(x + 1, y, 4, 2); ctx.fillStyle = Wd[3]; ctx.fillRect(x + 2, y, 2, 1);
      } else {
        ctx.fillStyle = Wd[2]; ctx.fillRect(x, y, len, 6); ctx.fillStyle = Wd[4]; ctx.fillRect(x, y, len, 2); ctx.fillStyle = Wd[1]; ctx.fillRect(x, y + 5, len, 1);
        ctx.fillStyle = Wd[5]; ctx.fillRect(x, y + 1, 2, 4); ctx.fillStyle = Wd[3]; ctx.fillRect(x, y + 2, 1, 2);
      }
    };
    const bush = (x, y) => { ctx.fillStyle = L[1]; ctx.fillRect(x - 3, y - 2, 7, 5); ctx.fillStyle = L[3]; ctx.fillRect(x - 2, y - 2, 4, 2); ctx.fillStyle = L[4]; ctx.fillRect(x - 1, y - 2, 1, 1); };
    if (vertical) { bush(4, 4); bush(14, h - 4); log(3, 4, h - 8); log(10, 2, h - 6); bush(9, h / 2); }
    else { bush(4, 5); bush(w - 4, 12); log(2, 5, w - 6); log(5, 11, w - 8); bush(w / 2, 4); }
    scene.textures.addCanvas(key, c);
  };
  draw('forest_gate', 32, 20, false);
  draw('forest_gate_v', 20, 34, true);
}

// Sık ağaç tepeleri: kuzey şeridi oyuncunun ARKASINDA, güney/batı/doğu şeritleri önünde çizilir
// (zombiler gölgeli ağaçların altından çıkıyormuş gibi görünür). Ayrı tohum: harita dizilimini etkilemez.
function paintForest(scene) {
  const W = MAP_W * TILE, H = MAP_H * TILE, B = FOREST_PX;
  const rng = new Phaser.Math.RandomDataGenerator(['zombi-ciftlik-orman']);
  const src = scene.textures.exists('tree') ? scene.textures.get('tree').getSourceImage() : null;
  // Ağaç çeşitleri: normal, koyu, aynalı
  const variants = [];
  if (src) {
    for (let k = 0; k < 4; k++) {
      const { c, ctx } = makeCanvas(16, 24);
      if (k & 1) { ctx.translate(16, 0); ctx.scale(-1, 1); }
      ctx.drawImage(src, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (k >= 2) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(6,22,16,0.32)'; ctx.fillRect(0, 0, 16, 24); }
      variants.push(c);
    }
  }
  const BG = '#15301f', DEEP = 'rgba(5,14,10,';
  const spans = (side) => FOREST_GATES.filter((g) => g.side === side).map(gateSpan);
  const out = [];
  const make = (key, x0, y0, w, h, depth, side, fill, plant, grad) => {
    const { c, ctx } = makeCanvas(w, h);
    // Zemin: koyu orman tabanı (çim görünmesin)
    ctx.fillStyle = BG;
    fill(ctx);
    // Ağaçlar (taban y'sine göre sıralı → üst üste binen tepeler)
    const trees = plant().sort((a, b) => a.y - b.y);
    if (variants.length) trees.forEach((t) => ctx.drawImage(variants[t.v], Math.round(t.x - 8 - x0), Math.round(t.y - 23 - y0)));
    // Dış kenara doğru koyulaşan gölge (yalnızca boyalı piksellerde)
    ctx.globalCompositeOperation = 'source-atop';
    const g = grad(ctx);
    g.addColorStop(0, `${DEEP}0.72)`); g.addColorStop(0.55, `${DEEP}0.35)`); g.addColorStop(1, `${DEEP}0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    if (scene.textures.exists(key)) scene.textures.remove(key);
    scene.textures.addCanvas(key, c);
    const img = scene.add.image(x0, y0, key).setOrigin(0, 0).setDepth(depth);
    out.push(img);
    return img;
  };
  const v = (outer) => (outer ? 2 : 0) + rng.between(0, 1);

  // Kuzey (oyuncunun arkasında)
  const nG = spans(0);
  const inN = (x) => nG.some(([a, b]) => x > a - 5 && x < b + 5);
  make('forest_n', 0, 0, W, B + 8, B + 2, 0,
    (ctx) => { let a = 0; for (const [g0, g1] of nG) { ctx.fillRect(a, 0, g0 - a, B - 6); a = g1; } ctx.fillRect(a, 0, W - a, B - 6); },
    () => {
      const t = [];
      for (let by = 3; by <= B + 3; by += 5) for (let x = rng.between(-6, 0); x < W + 8; x += rng.between(6, 9)) {
        if (inN(x)) continue;
        t.push({ x, y: Math.min(B + 3, by + rng.between(-2, 2)), v: v(by < B - 8) });
      }
      return t;
    },
    (ctx) => ctx.createLinearGradient(0, 0, 0, B + 8));

  // Güney (önde)
  const sG = spans(1), sy0 = H - B - 26;
  const inS = (x) => sG.some(([a, b]) => x > a - 5 && x < b + 5);
  make('forest_s', 0, sy0, W, H - sy0, 8000, 1,
    (ctx) => { const y = H - B + 8 - sy0; let a = 0; for (const [g0, g1] of sG) { ctx.fillRect(a, y, g0 - a, H); a = g1; } ctx.fillRect(a, y, W - a, H); },
    () => {
      const t = [];
      for (let by = H - B + 22; by <= H + 14; by += 5) for (let x = rng.between(-6, 0); x < W + 8; x += rng.between(6, 9)) {
        if (inS(x)) continue;
        t.push({ x, y: by + rng.between(-1, 2), v: v(by > H - 4) });
      }
      return t;
    },
    (ctx) => ctx.createLinearGradient(0, H - sy0, 0, 0));

  // Batı / doğu (önde)
  const side = (key, s, x0, w, xs, outerX) => {
    const G = spans(s);
    const inG = (y) => G.some(([a, b]) => y > a + 2 && y < b + 20);
    make(key, x0, 0, w, H, 8000, s,
      (ctx) => { const fx = s === 2 ? 0 : w - (B - 8); let a = 0; for (const [g0, g1] of G) { ctx.fillRect(fx, a, B - 8, g0 - a); a = g1; } ctx.fillRect(fx, a, B - 8, H - a); },
      () => {
        const t = [];
        for (let by = rng.between(-4, 2); by < H + 22; by += rng.between(5, 7)) {
          if (inG(by)) continue;
          xs.forEach((x) => t.push({ x: x + rng.between(-2, 2), y: by + rng.between(-1, 1), v: v(x === outerX) }));
        }
        return t;
      },
      (ctx) => (s === 2 ? ctx.createLinearGradient(0, 0, w, 0) : ctx.createLinearGradient(w, 0, 0, 0)));
  };
  side('forest_w', 2, 0, B + 8, [3, 10, 17, 23], 3);
  side('forest_e', 3, W - B - 8, B + 8, [W - 3, W - 10, W - 17, W - 23], W - 3);
  return out;
}

// Orman kenarının çimene düşen gölgesi (zemin süs canvas'ına; rastgelelik yok)
function shadeForestGround(scene) {
  const tex = scene.textures.exists('ground_decor') ? scene.textures.get('ground_decor') : null;
  const ctx = tex?.context;
  if (!ctx) return;
  const W = MAP_W * TILE, H = MAP_H * TILE, B = FOREST_PX, d = 12;
  const band = (x0, y0, x1, y1, w, h) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(10,22,16,0.42)'); g.addColorStop(1, 'rgba(10,22,16,0)');
    ctx.fillStyle = g; ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), w, h);
  };
  band(0, B - 2, 0, B + d, W, d + 2);
  band(0, H - B + 2, 0, H - B - d, W, d + 2);
  band(B - 2, 0, B + d, 0, d + 2, H);
  band(W - B + 2, 0, W - B - d, 0, d + 2, H);
  // Şeridin içi: tamamen koyu orman tabanı
  ctx.fillStyle = '#15301f';
  ctx.fillRect(0, 0, W, B - 4); ctx.fillRect(0, H - B + 4, W, B); ctx.fillRect(0, 0, B - 4, H); ctx.fillRect(W - B + 4, 0, B, H);
  // Geçit ağızları açık kalır (altındaki patika görünsün)
  FOREST_GATES.forEach((g) => {
    const [a0, a1] = gateSpan(g);
    if (g.side === 0) ctx.clearRect(a0, 0, a1 - a0, B);
    else if (g.side === 1) ctx.clearRect(a0, H - B, a1 - a0, B);
    else if (g.side === 2) ctx.clearRect(0, a0, B, a1 - a0);
    else ctx.clearRect(W - B, a0, B, a1 - a0);
  });
  tex.refresh?.();
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
