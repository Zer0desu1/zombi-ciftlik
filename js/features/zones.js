// 'zones' özellik modülü — Keşfedilecek kilitli bölgeler (orman geçitlerinin ardında).
//   Terk Edilmiş Maden (kuzey geçidi, Paslı Anahtar), Eski Hastane (batı geçidi, Hastane Kartı),
//   Askeri Üs (doğu geçidi, kırık köprü onarılır). Güney geçidi ileride kullanılmak üzere kapalı kalır.
// Bölgeler ana haritanın SAĞINDA, dünya sınırları genişletilerek kurulan ayrı alanlardır (ana haritanın tohumlu
// yerleşimi ve kaynak sırası hiç değişmez). Açık geçide yürüyünce / E ile oyuncu bölgeye ışınlanır, çıkış
// merdiveni/kapısından köye döner. Kamera sınırları bulunulan alana göre ayarlanır.
//   - Zemin/duvarlar: el ile çizilmiş ASCII planlardan tek seferde canvas'a boyanır (çarpışma: görünmez statik gövdeler).
//     Bunlar sahnenin deterministik dünyasına (scene.worldStatic) eklenir: host aynalamaz, misafir aynısını kendisi kurar.
//   - Zombiler: mevcut türlerin güçlendirilmişi + bölgeye özel tür (Kazmacı, Hasta Koşucu, Zırhlı Asker). Gündüz
//     yanmaz, yalnızca bölgedeki oyunculara saldırır, gece azgınlaşır. Temizlenen bölge RESPAWN_DAYS gün boş kalır.
//   - Ganimet: bölgeye özel sandıklar + bölge temizlenince açılan kasa. Sandık/zombi görüntüleri sıradan Phaser
//     nesneleridir (mirror.js misafirlere kopyalar).
//   - Kayıt: açılan geçitler, temizlenme günleri, açılan sandıklar. Bölgede kaydedilen oyuncu yüklemede geçidin
//     köy tarafında uyanır.
//   - Co-op: ışınlanma host'ta yapılır (Player.netTp sayacı → misafir konumu düzeltir); misafire geçit durumu
//     'zn' mesajıyla gider. Host misafir konumunu doğrular (orman şeridine/kilitli bölgeye giremez).
// Test/hata ayıklama: scene.zones.open(id), scene.zones.enter(player, id), scene.zones.exit(player), scene.zones.alive(id)
import { TILE, MAP_W, MAP_H, ITEMS, RECIPES, SHOPS, QUESTS } from '../config.js';
import { addCanvas, R, outline, makeHumanoid, basePal, makeCanvas, srand } from '../textures.js';
import { audio } from '../audio.js';
import { Zombie, ZOMBIE_TYPES } from '../entities/Zombie.js';
import { FOREST_PX } from '../systems/MapBuilder.js';

// ---------- Geometri ----------
const W = MAP_W * TILE, H = MAP_H * TILE;
const ZW = 30, ZH = 20, ZPW = ZW * TILE, ZPH = ZH * TILE;
const ZONE_X0 = W + 192, ZONE_GAP = 64;
export const WORLD_W = ZONE_X0 + 3 * (ZPW + ZONE_GAP);
const RESPAWN_DAYS = 3;
const NIGHT_MUL = 1.3;  // gece bölge zombileri: hız ve hasar çarpanı
const AGGRO = 130;      // bu mesafede oyuncuyu fark eder (sonra peşini bırakmaz)

// Plan lejantı: # duvar · o engel · . zemin · S giriş · E çıkış · C sandık · V kasa
// Zombiler: z normal · r koşucu · b iri · s tükürükçü · a zırhlı · K Kazmacı · H Hasta Koşucu · A Zırhlı Asker
const KIND_OF = { z: 'normal', r: 'runner', b: 'brute', s: 'spitter', a: 'armored', K: 'miner', H: 'patient', A: 'soldier' };

export const ZONES = [
  {
    id: 'mine', gate: 'north', name: 'Terk Edilmiş Maden', icon: '⛏️', enter: 'Madene in', short: 'Maden', lvl: 5, seed: 7101,
    lock: { item: 'rusty_key' },
    map: [
      '##############################',
      '#o...o.....##.......o...K..V.#',
      '#..K.......##..b.........o...#',
      '#....oo....##.....ooo....z...#',
      '#..........##......o.........#',
      '#...z......oo...........o....#',
      '#.....C..........K.......oo..#',
      '#..........###########...o...#',
      '####...#####.........#.......#',
      '#......#.........C...#...z...#',
      '#..o...#.........o...#.......#',
      '#..o...#...ooo.......####..###',
      '#......#.....K..........b....#',
      '#......####..........o.......#',
      '#..C.......#####.............#',
      '#......z.......#....z........#',
      '#..oo..........#.........oo..#',
      '#.........S....#.............#',
      '#.............E..............#',
      '##############################'
    ]
  },
  {
    id: 'hospital', gate: 'west', name: 'Eski Hastane', icon: '🏥', enter: 'Hastaneye gir', short: 'Hastane', lvl: 7, seed: 7202,
    lock: { item: 'hospital_card' },
    map: [
      '##############################',
      '#V...#..o.o.o..#.o.o.o..#..H.#',
      '#....#.........#........#....#',
      '#..H.#....H....#...r....#.C..#',
      '#....#.........#........#....#',
      '##.###.###.#####.##.#####.####',
      '#............................#',
      '#..H......s........H.........#',
      '#............................#',
      '##.###.#####.####.#####.###.##',
      '#....#...o.o...#.o.o.o.#.....#',
      '#.C..#.........#.......#..s..#',
      '#....#...r.....#....H..#.....#',
      '#..o.#.........#.......#..o..#',
      '#....###.###.###.......#.###.#',
      '#............................#',
      '#.oo.......S.......r.....oo..#',
      '#.......................C....#',
      '#.............E..............#',
      '##############################'
    ]
  },
  {
    id: 'military', gate: 'east', name: 'Askeri Üs', icon: '🪖', enter: 'Askeri üsse gir', short: 'Askeri Üs', lvl: 9, seed: 7303,
    lock: { bridge: { wood: 30, stone: 20, scrap: 8 } },
    map: [
      '##############################',
      '#..o.o....#........#....o.o.V#',
      '#.........#...A....#.........#',
      '#..A......#........#....A....#',
      '#.........###..#####.........#',
      '#..oo..a.................oo..#',
      '#.............b..............#',
      '#####..####.......####..######',
      '#.........#..o.o..#..........#',
      '#..C......#.......#....a..C..#',
      '#.........#..A....#..........#',
      '#..s......###...###..........#',
      '#..........................A.#',
      '#....oooo..........oooo......#',
      '#.............a..............#',
      '#.oo......................oo.#',
      '#..........S.........C.......#',
      '#............................#',
      '#.............E..............#',
      '##############################'
    ]
  }
];
const DEF = {};
ZONES.forEach((z, i) => {
  DEF[z.id] = z;
  z.ox = ZONE_X0 + i * (ZPW + ZONE_GAP);
  z.oy = 0;
  z.rect = { x: z.ox, y: z.oy, w: ZPW, h: ZPH };
  z.spawns = []; z.chests = [];
  z.map.forEach((row, ty) => [...row].forEach((ch, tx) => {
    const px = z.ox + tx * TILE + 8, py = z.oy + ty * TILE + 8;
    if (ch === 'S') z.spawn = { x: px, y: py };
    else if (ch === 'E') z.exit = { x: px, y: py };
    else if (ch === 'C' || ch === 'V') z.chests.push({ i: z.chests.length, x: px, y: py + 2, vault: ch === 'V' });
    else if (KIND_OF[ch]) z.spawns.push([KIND_OF[ch], px, py]);
  }));
});

export function zoneIdAt(x, y) {
  for (const z of ZONES) if (x >= z.ox && y >= z.oy && x < z.ox + ZPW && y < z.oy + ZPH) return z.id;
  return null;
}

// ---------- Eşyalar, tarifler, dükkân, görev ----------
const rifleUse = (scene, ctx) => useRifle(scene, ctx);
Object.assign(ITEMS, {
  rusty_key: { name: 'Paslı Anahtar', type: 'material', icon: 'i_rusty_key', sell: 8, desc: 'Kuzeydeki terk edilmiş madenin kapısını açar. Demircide hurda + göktaşından dövülebilir.' },
  hospital_card: { name: 'Hastane Kartı', type: 'material', icon: 'i_hospital_card', sell: 15, desc: 'Batıdaki eski hastanenin giriş kartı. Doktor Selin\'de bulunur.' },
  health_pack: { name: 'Sağlık Çantası', type: 'food', icon: 'i_health_pack', heal: 60, energy: 10, sell: 30, desc: 'Canı 60 yeniler. Eski hastanenin dolaplarından.', onUse: ITEMS.bandage?.onUse },
  rifle: { name: 'Askeri Tüfek', type: 'gun', icon: 'i_rifle', dmg: 7, sell: 140, desc: 'Uzun menzilli, tek atışta ağır hasar. Atış başına 1 mermi.', onUse: rifleUse }
});
if (!RECIPES.some((r) => r.out === 'rusty_key')) RECIPES.push({ out: 'rusty_key', qty: 1, cost: { scrap: 6, meteor_ore: 1 } });
SHOPS.doctor = SHOPS.doctor || [];
if (!SHOPS.doctor.some((o) => o.id === 'hospital_card')) SHOPS.doctor.push({ id: 'hospital_card', qty: 1, price: 150 });
if (!QUESTS.some((q) => q.id === 'q_doc_card')) {
  QUESTS.push({ id: 'q_doc_card', npc: 'doctor', title: 'Eski Hastane', desc: 'Selin\'e 3 ekmek getir; karşılığında eski hastanenin giriş kartını verecek.', type: 'deliver', item: 'bread', amount: 3, reward: { coins: 20, items: { hospital_card: 1 } } });
}

// Bölgeye özel zombi türleri (rehberde/dalgalarda görünmez; yalnızca bölgelerde doğar)
Object.assign(ZOMBIE_TYPES, {
  miner:   { name: 'Kazmacı',      icon: '⛏️', tex: 'zombie_miner',   hp: (w) => 8 + w,                     speed: () => Phaser.Math.FloatBetween(26, 32), dmg: 12, reward: 8,  cd: 1.2, kb: 60,  armor: 3, scale: 1.1, desc: 'Madenin eski işçileri. Baretleri ilk darbeyi emer, kazmaları sert vurur.' },
  patient: { name: 'Hasta Koşucu', icon: '🩺', tex: 'zombie_patient', hp: (w) => 3 + Math.floor(w * 0.5), speed: () => Phaser.Math.FloatBetween(76, 88), dmg: 6,  reward: 6,  cd: 0.7, kb: 130, desc: 'Hastane önlüklü, çılgınca koşan hastalar. Kırılgan ama çok hızlı.' },
  soldier: { name: 'Zırhlı Asker', icon: '🪖', tex: 'zombie_soldier', hp: (w) => 10 + w,                    speed: () => Phaser.Math.FloatBetween(24, 29), dmg: 13, reward: 11, cd: 1.1, kb: 40,  armor: 10, desc: 'Çelik yelekli askerler. İlk 10 hasarı zırh emer.' }
});

// ---------- Ganimet tabloları ----------
const B = (a, b) => Phaser.Math.Between(a, b);
const maybe = (p, e) => (Math.random() < p ? [e] : []);
const LOOT = {
  mine: {
    chest: () => ({ coins: B(20, 40), items: [['stone', B(8, 14)], ['meteor_ore', B(1, 2)], ['scrap', B(2, 4)], ...maybe(0.35, ['rare_core', 1])] }),
    vault: () => ({ coins: B(80, 120), items: [['meteor_ore', B(3, 4)], ['rare_core', B(1, 2)], ['stone', 20], ...maybe(0.5, ['relic', 1])] })
  },
  hospital: {
    chest: () => ({ coins: B(15, 35), items: [['health_pack', B(1, 2)], ['bandage', B(1, 3)], ...maybe(0.3, ['medkit', 1]), ...maybe(0.4, ['bread', 2])] }),
    vault: () => ({ coins: B(80, 110), items: [['health_pack', 3], ['medkit', 1], ...maybe(0.3, ['relic', 1])] })
  },
  military: {
    chest: () => ({ coins: B(25, 45), items: [['ammo', B(20, 35)], ['scrap', B(3, 6)], ...maybe(0.15, ['shotgun', 1]), ...maybe(0.4, ['arrow', B(10, 15)])] }),
    vault: (s) => ({ coins: B(100, 140), items: [s.inventory.count('rifle') ? ['ammo', 60] : ['rifle', 1], ['ammo', 30], ['turret', 1], ['rare_core', 1]] })
  }
};

// ---------- Dokular ----------
const THEME = {
  mine: {
    floor(ctx, px, py, r) {
      R(ctx, px, py, 16, 16, '#4b3d36');
      for (let i = 0; i < 7; i++) R(ctx, px + r() * 16, py + r() * 16, 1, 1, r() < 0.5 ? '#5a4a41' : '#3d312c');
      if (r() < 0.25) { R(ctx, px + 3 + r() * 9, py + 3 + r() * 9, 2, 1, '#6d5f57'); }
    },
    wall(ctx, px, py, r, face, top) {
      R(ctx, px, py, 16, 16, '#271e24');
      for (let i = 0; i < 5; i++) R(ctx, px + r() * 15, py + r() * 9, 2, 1, '#33282f');
      if (top) R(ctx, px, py, 16, 1, '#4e3e3a');
      if (face) {
        R(ctx, px, py + 9, 16, 7, '#3e3036'); R(ctx, px, py + 9, 16, 1, '#5e4a43');
        R(ctx, px + 2 + r() * 4, py + 11, 3, 1, '#2e2329'); R(ctx, px + 9 + r() * 4, py + 13, 3, 1, '#2e2329');
        if (r() < 0.3) { const x = px + 2 + r() * 11; R(ctx, x, py + 11, 2, 2, '#7fe3ff'); R(ctx, x, py + 11, 1, 1, '#d6fbff'); }
      }
    },
    obstacle(ctx, px, py, r, tx, ty) {
      R(ctx, px + 2, py + 13, 13, 2, 'rgba(0,0,0,0.35)');
      if ((tx + ty) % 4 === 0) { // cevher arabası
        R(ctx, px + 2, py + 5, 12, 7, '#5e3a2e'); R(ctx, px + 2, py + 5, 12, 1, '#7a4e36'); R(ctx, px + 3, py + 3, 10, 2, '#6d6470'); R(ctx, px + 5, py + 3, 2, 1, '#7fe3ff');
        R(ctx, px + 3, py + 12, 3, 3, '#262b44'); R(ctx, px + 10, py + 12, 3, 3, '#262b44');
      } else {
        R(ctx, px + 2, py + 6, 12, 8, '#5f5866'); R(ctx, px + 4, py + 4, 8, 4, '#6f6878'); R(ctx, px + 4, py + 5, 5, 2, '#8b8296'); R(ctx, px + 10, py + 9, 3, 3, '#4c4652');
      }
    },
    exit(ctx, px, py) {
      ctx.fillStyle = 'rgba(255,233,160,0.28)'; ctx.fillRect(px - 2, py, 20, 16);
      R(ctx, px + 4, py, 1, 16, '#9a6240'); R(ctx, px + 11, py, 1, 16, '#9a6240');
      for (let k = 0; k < 4; k++) R(ctx, px + 4, py + 2 + k * 4, 8, 1, '#d89a63');
    },
    shade: 'rgba(0,0,0,0.3)', mini: { wall: '#271e24', floor: '#5a4a41', obs: '#8b8296' }
  },
  hospital: {
    floor(ctx, px, py, r) {
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) R(ctx, px + x * 8, py + y * 8, 8, 8, (x + y) % 2 ? '#c3cac6' : '#b3bbb7');
      R(ctx, px, py, 16, 1, '#9aa29e'); R(ctx, px, py, 1, 16, '#9aa29e');
      if (r() < 0.14) { const x = px + 2 + r() * 10, y = py + 2 + r() * 10; R(ctx, x, y, 4, 3, 'rgba(110,105,80,0.35)'); }
      if (r() < 0.07) { const x = px + 3 + r() * 9, y = py + 3 + r() * 9; R(ctx, x, y, 2, 2, '#7a2230'); R(ctx, x + 2, y + 1, 1, 1, '#7a2230'); R(ctx, x - 1, y + 3, 1, 1, '#a8323b'); }
    },
    wall(ctx, px, py, r, face, top) {
      R(ctx, px, py, 16, 16, '#3f4a50');
      if (top) R(ctx, px, py, 16, 1, '#5d6a70');
      if (face) {
        R(ctx, px, py + 7, 16, 9, '#7d8b91'); R(ctx, px, py + 7, 16, 1, '#a6b3b8'); R(ctx, px, py + 10, 16, 1, '#5f9c88');
        R(ctx, px, py + 14, 16, 2, '#4d5a60');
        if (r() < 0.2) R(ctx, px + 3 + r() * 8, py + 11, 3, 2, 'rgba(60,40,30,0.35)');
      }
    },
    obstacle(ctx, px, py) { // hastane yatağı
      R(ctx, px + 1, py + 14, 15, 2, 'rgba(0,0,0,0.3)');
      R(ctx, px + 1, py + 2, 14, 12, '#d8dde0'); R(ctx, px + 2, py + 5, 12, 8, '#7fa7c8'); R(ctx, px + 2, py + 5, 12, 1, '#a8c8e0');
      R(ctx, px + 3, py + 3, 10, 2, '#f4f6f7'); R(ctx, px + 1, py + 13, 2, 2, '#8b9bb4'); R(ctx, px + 13, py + 13, 2, 2, '#8b9bb4');
    },
    exit(ctx, px, py) {
      R(ctx, px + 2, py, 12, 16, '#1b1622'); R(ctx, px + 2, py, 12, 1, '#5d6a70'); R(ctx, px + 4, py + 2, 8, 3, '#3fbf5f'); R(ctx, px + 5, py + 3, 6, 1, '#c8ffd8');
    },
    shade: 'rgba(0,0,0,0.18)', mini: { wall: '#46535a', floor: '#bfc6c2', obs: '#7fa7c8' }
  },
  military: {
    floor(ctx, px, py, r) {
      R(ctx, px, py, 16, 16, '#666a58');
      for (let i = 0; i < 6; i++) R(ctx, px + r() * 16, py + r() * 16, 1, 1, r() < 0.5 ? '#5a5e4d' : '#727662');
      if (r() < 0.1) { let x = px + 2 + r() * 8, y = py + 2 + r() * 8; for (let k = 0; k < 5; k++) { R(ctx, x, y, 1, 1, '#4f5344'); x += r() < 0.5 ? 1 : 0; y += 1; } }
    },
    wall(ctx, px, py, r, face, top, tx, ty) {
      R(ctx, px, py, 16, 16, '#3c4033');
      if (top) R(ctx, px, py, 16, 1, '#5a604c');
      if (face) {
        R(ctx, px, py + 8, 16, 8, '#5d624f'); R(ctx, px, py + 8, 16, 1, '#7a806a'); R(ctx, px, py + 12, 16, 1, '#4b4f40');
        R(ctx, px + (ty % 2 ? 4 : 11), py + 8, 1, 4, '#4b4f40'); R(ctx, px + (ty % 2 ? 11 : 4), py + 12, 1, 4, '#4b4f40');
        if ((tx + ty) % 5 === 0) { R(ctx, px + 1, py + 13, 14, 2, '#c9a227'); for (let k = 0; k < 4; k++) R(ctx, px + 2 + k * 4, py + 13, 2, 2, '#1b1622'); }
      }
    },
    obstacle(ctx, px, py, r, tx, ty) {
      R(ctx, px + 1, py + 14, 15, 2, 'rgba(0,0,0,0.3)');
      if ((tx + ty) % 2) { // sandık
        R(ctx, px + 1, py + 2, 14, 12, '#7a5a30'); R(ctx, px + 1, py + 2, 14, 1, '#9a7440'); R(ctx, px + 1, py + 7, 14, 1, '#5e4424');
        R(ctx, px + 3, py + 4, 10, 1, '#9a7440'); R(ctx, px + 3, py + 10, 10, 1, '#9a7440'); R(ctx, px + 7, py + 8, 3, 2, '#2a1f1a');
      } else { // kum torbası
        for (let k = 0; k < 3; k++) { R(ctx, px + 1 + (k % 2) * 3, py + 3 + k * 4, 11, 4, '#8a7752'); R(ctx, px + 2 + (k % 2) * 3, py + 3 + k * 4, 9, 2, '#b3a074'); }
      }
    },
    exit(ctx, px, py) {
      R(ctx, px, py + 4, 16, 12, '#2a2a2a');
      for (let k = 0; k < 4; k++) R(ctx, px + k * 4, py + 4, 2, 3, '#e8c84a');
      R(ctx, px + 3, py + 9, 10, 1, '#5a5a5a');
    },
    shade: 'rgba(0,0,0,0.22)', mini: { wall: '#3c4033', floor: '#6b6f5e', obs: '#8a7752' }
  }
};

function paintZone(scene, z) {
  const key = `zn_floor_${z.id}`;
  const th = THEME[z.id], r = srand(z.seed);
  const at = (x, y) => z.map[y]?.[x] ?? '#';
  const wall = (x, y) => at(x, y) === '#';
  const { c, ctx } = makeCanvas(ZPW, ZPH);
  for (let ty = 0; ty < ZH; ty++) for (let tx = 0; tx < ZW; tx++) {
    if (wall(tx, ty)) continue;
    th.floor(ctx, tx * TILE, ty * TILE, r);
    if (wall(tx, ty - 1)) R(ctx, tx * TILE, ty * TILE, 16, 3, th.shade);
  }
  for (let ty = 0; ty < ZH; ty++) for (let tx = 0; tx < ZW; tx++) {
    if (wall(tx, ty)) th.wall(ctx, tx * TILE, ty * TILE, r, !wall(tx, ty + 1) && ty < ZH - 1, !wall(tx, ty - 1) && ty > 0, tx, ty);
  }
  for (let ty = 0; ty < ZH; ty++) for (let tx = 0; tx < ZW; tx++) {
    const ch = at(tx, ty);
    if (ch === 'o') th.obstacle(ctx, tx * TILE, ty * TILE, r, tx, ty);
    else if (ch === 'E') th.exit(ctx, tx * TILE, ty * TILE, r);
  }
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, c);
}

function makeTextures(scene) {
  const icon = (key, fn) => addCanvas(scene, key, 16, 16, (ctx) => { fn(ctx); outline(ctx, 0, 0, 16, 16, '#2a2233'); });
  icon('i_rusty_key', (ctx) => {
    R(ctx, 2, 4, 6, 6, '#8a4a22'); R(ctx, 3, 5, 4, 4, '#b8692e'); R(ctx, 4, 6, 2, 2, '#2a2233');
    R(ctx, 8, 6, 6, 2, '#a85a28'); R(ctx, 11, 8, 1, 2, '#a85a28'); R(ctx, 13, 8, 1, 3, '#a85a28'); R(ctx, 9, 6, 2, 1, '#d08a4a'); R(ctx, 3, 5, 1, 1, '#e0a060');
  });
  icon('i_hospital_card', (ctx) => {
    R(ctx, 2, 4, 12, 9, '#eef2f5'); R(ctx, 2, 4, 12, 2, '#3f7fd0'); R(ctx, 4, 8, 3, 1, '#d04a48'); R(ctx, 5, 7, 1, 3, '#d04a48');
    R(ctx, 9, 8, 4, 1, '#8b9bb4'); R(ctx, 9, 10, 3, 1, '#8b9bb4'); R(ctx, 11, 4, 2, 1, '#86b2e2');
  });
  icon('i_health_pack', (ctx) => {
    R(ctx, 6, 2, 4, 2, '#5e3a2e'); R(ctx, 2, 4, 12, 10, '#d04a48'); R(ctx, 2, 4, 12, 2, '#ee7466'); R(ctx, 7, 6, 2, 6, '#ffffff'); R(ctx, 5, 8, 6, 2, '#ffffff'); R(ctx, 2, 12, 12, 2, '#a8323b');
  });
  icon('i_rifle', (ctx) => {
    R(ctx, 1, 9, 5, 3, '#7a4a30'); R(ctx, 1, 9, 5, 1, '#9a6240'); R(ctx, 5, 8, 9, 2, '#3a3f4a'); R(ctx, 5, 8, 9, 1, '#5a6070'); R(ctx, 14, 8, 1, 1, '#3a3f4a');
    R(ctx, 7, 10, 2, 3, '#2a2e36'); R(ctx, 8, 6, 3, 2, '#2a2e36'); R(ctx, 9, 10, 2, 1, '#4f5d3a');
  });
  // Bölge zombileri
  const zpal = (o) => basePal(Object.assign({ S: '#7fb069', E: '#ff3b3b', H: '#3c5a2e', C: '#5b6b7a', D: '#3e4a55', P: '#4a3f35' }, o));
  makeHumanoid(scene, 'zombie_miner', zpal({ S: '#86a86a', C: '#3a4f7a', D: '#2a3a5e', P: '#2f3a55' }), (ctx, ox, f) => {
    R(ctx, ox + 4, 0, 8, 3, '#e8c84a'); R(ctx, ox + 4, 0, 8, 1, '#fff2a0'); R(ctx, ox + 7, 1, 2, 1, '#fff6d0');
    R(ctx, ox + 13, 3 + f, 1, 8, '#7a4a30'); R(ctx, ox + 11, 3 + f, 5, 2, '#9aa0aa');
  });
  makeHumanoid(scene, 'zombie_patient', zpal({ S: '#a8c49a', E: '#ff2a2a', H: '#55692a', C: '#a9c7d8', D: '#86a8bc', P: '#a9c7d8' }), (ctx, ox, f) => {
    R(ctx, ox + 4, 1, 8, 2, '#eef2f5'); R(ctx, ox + 10, 3, 1, 2, '#eef2f5');
    R(ctx, ox + 7, 9, 2, 2, '#7a2230'); R(ctx, ox + (f ? 2 : 1), 10, 1, 1, '#d6ecf5');
  });
  makeHumanoid(scene, 'zombie_soldier', zpal({ S: '#7fa069', H: '#3e4a2e', C: '#4f5d3a', D: '#3a4529', P: '#3a3f30' }), (ctx, ox) => {
    R(ctx, ox + 3, 0, 10, 3, '#4b5734'); R(ctx, ox + 3, 0, 10, 1, '#6a7a4a'); R(ctx, ox + 3, 3, 1, 1, '#4b5734'); R(ctx, ox + 12, 3, 1, 1, '#4b5734');
    R(ctx, ox + 5, 8, 6, 3, '#5e5a3a'); R(ctx, ox + 6, 9, 4, 1, '#7a7550'); R(ctx, ox + 5, 10, 1, 1, '#2a2e22');
  });
  ['zombie_miner', 'zombie_patient', 'zombie_soldier'].forEach((key) => {
    if (scene.anims.exists(`${key}_walk`)) return;
    scene.anims.create({ key: `${key}_walk`, frames: [{ key, frame: 0 }, { key, frame: 1 }], frameRate: key === 'zombie_patient' ? 9 : 4, repeat: -1 });
  });
  // Bölge sandığı (askerî sandık) ve kasa
  const crate = (key, open) => addCanvas(scene, key, 14, 12, (ctx) => {
    if (open) { R(ctx, 1, 1, 12, 3, '#3a4529'); R(ctx, 2, 4, 10, 2, '#1b1622'); R(ctx, 4, 4, 2, 1, '#7fe3ff'); R(ctx, 8, 4, 2, 1, '#e8c867'); }
    else { R(ctx, 1, 2, 12, 4, '#4f5d3a'); R(ctx, 1, 2, 12, 1, '#6a7a4a'); }
    R(ctx, 1, 6, 12, 5, '#3e4a2e'); R(ctx, 1, 6, 12, 1, '#5a6a42');
    R(ctx, 2, 2, 1, 9, '#8b9bb4'); R(ctx, 11, 2, 1, 9, '#8b9bb4'); R(ctx, 6, 5, 2, 3, '#e8c867');
    outline(ctx, 0, 0, 14, 12, '#1b1622');
  });
  crate('zn_crate', false); crate('zn_crate_open', true);
  const safe = (key, open) => addCanvas(scene, key, 16, 16, (ctx) => {
    R(ctx, 1, 2, 14, 13, '#3a4466'); R(ctx, 1, 2, 14, 1, '#5a6988'); R(ctx, 2, 14, 12, 1, '#262b44');
    if (open) { R(ctx, 3, 4, 10, 9, '#181425'); R(ctx, 4, 9, 3, 2, '#e8c867'); R(ctx, 8, 8, 3, 3, '#a86bff'); R(ctx, 13, 4, 2, 9, '#7686a2'); }
    else { R(ctx, 3, 4, 10, 9, '#5a6988'); R(ctx, 3, 4, 10, 1, '#8b9bb4'); R(ctx, 7, 7, 3, 3, '#e8c867'); R(ctx, 8, 8, 1, 1, '#5e3a2e'); R(ctx, 11, 6, 1, 5, '#b2bfd2'); }
    outline(ctx, 0, 0, 16, 16, '#1b1622');
  });
  safe('zn_safe', false); safe('zn_safe_open', true);
  // Kırık / onarılmış köprü (doğu geçidi): uçurum üstünde tahtalar
  const bridge = (key, broken) => addCanvas(scene, key, 32, 30, (ctx) => {
    R(ctx, 0, 3, 32, 24, '#0e0b14'); R(ctx, 0, 3, 32, 2, '#2a1f30'); R(ctx, 0, 25, 32, 2, '#2a1f30');
    for (let x = 0; x < 32; x += 3) {
      if (broken && x > 9 && x < 22) { if (x === 12 || x === 18) R(ctx, x, 8 + (x % 5), 2, 9, '#5e3a2e'); continue; }
      R(ctx, x, 5, 2, 20, '#9a6240'); R(ctx, x, 5, 1, 20, '#b87a4e'); R(ctx, x + 2, 5, 1, 20, '#3e2731');
    }
    R(ctx, 0, 4, broken ? 11 : 32, 1, '#d4ab76'); R(ctx, 0, 25, broken ? 11 : 32, 1, '#d4ab76');
    if (broken) { R(ctx, 22, 4, 10, 1, '#d4ab76'); R(ctx, 22, 25, 10, 1, '#d4ab76'); R(ctx, 11, 4, 2, 3, '#d4ab76'); R(ctx, 20, 24, 2, 3, '#d4ab76'); }
    R(ctx, 0, 1, 2, 28, '#5e3a2e'); R(ctx, 30, 1, 2, 28, '#5e3a2e');
  });
  bridge('zn_bridge_broken', true); bridge('zn_bridge', false);
  // Geçit tabelası
  addCanvas(scene, 'zn_sign', 12, 14, (ctx) => {
    R(ctx, 5, 6, 2, 8, '#5e3a2e'); R(ctx, 0, 1, 12, 6, '#9a6240'); R(ctx, 0, 1, 12, 1, '#b87a4e'); R(ctx, 0, 6, 12, 1, '#5e3a2e');
    R(ctx, 2, 3, 8, 1, '#3e2731'); outline(ctx, 0, 0, 12, 14, '#1b1622');
  });
  ZONES.forEach((z) => paintZone(scene, z));
}

// ---------- Yardımcılar ----------
const S = (scene) => scene.zones;
const dist = (a, b, c, d) => Phaser.Math.Distance.Between(a, b, c, d);
const localPlayer = (s) => (s.net?.isHost ? s.netHostPlayer || s.player : s.player);
function players(s) {
  const out = [];
  const h = s.netHostPlayer || s.player;
  if (h) out.push(h);
  for (const p of s.netPlayers || []) if (p && !out.includes(p)) out.push(p);
  return out;
}
function guestOf(s, p) {
  const net = s.net;
  if (!net?.isHost || !net.guests) return null;
  for (const g of net.guests.values()) if (g.player === p) return g;
  return null;
}
// Belirli oyuncuya bildirim (misafirse ağ üzerinden; host'a misafir bağlamı dışında)
function toastTo(s, p, msg, ty = 'info') {
  const g = guestOf(s, p);
  if (g) { s.net.send(g, { t: 'toast', m: msg, ty }); return; }
  if (p !== localPlayer(s)) return;
  if (s.net?.ctx) s.time.delayedCall(0, () => s.hud?.toast(msg, ty));
  else s.hud.toast(msg, ty);
}
function toastAll(s, msg, ty = 'info') {
  if (s.net?.ctx) s.time.delayedCall(0, () => s.hud?.toast(msg, ty)); else s.hud.toast(msg, ty);
  if (s.net?.isHost) s.net.broadcast({ t: 'toast', m: msg, ty });
}

// Geçit geometrisi: ağız (etkileşim), köy tarafı dönüş noktası, tabela
function gateGeo(scene, gid) {
  const g = scene.forestEdge?.gates?.find((o) => o.id === gid);
  if (!g) return null;
  const r = g.rect, Bp = FOREST_PX;
  switch (g.side) {
    case 0: return { g, mouth: { x: r.centerX, y: Bp + 8 }, back: { x: r.centerX, y: Bp + 34 }, sign: { x: r.centerX + 24, y: Bp + 10 } };
    case 1: return { g, mouth: { x: r.centerX, y: H - Bp - 10 }, back: { x: r.centerX, y: H - Bp - 34 }, sign: { x: r.centerX + 24, y: H - Bp - 12 } };
    case 2: return { g, mouth: { x: Bp + 8, y: r.centerY }, back: { x: Bp + 34, y: r.centerY }, sign: { x: Bp + 12, y: r.centerY - 22 } };
    default: return { g, mouth: { x: W - Bp - 8, y: r.centerY }, back: { x: W - Bp - 34, y: r.centerY }, sign: { x: W - Bp - 12, y: r.centerY - 22 } };
  }
}

const costText = (cost) => Object.entries(cost).map(([id, n]) => `${n} ${ITEMS[id]?.name.toLocaleLowerCase('tr') || id}`).join(' + ');
const aliveIn = (scene, id) => scene.zombies.getChildren().filter((z) => z.zoneId === id && z.active && !z.dead);

// ---------- Işınlanma ----------
function teleport(scene, p, x, y) {
  if (p.body?.reset) p.body.reset(x, y); else p.setPosition(x, y);
  const g = guestOf(scene, p);
  if (g) {
    p.netTp = (p.netTp || 0) + 1;
    g.tx = x; g.ty = y;
    scene.net.sendMe(g, true);
  } else if (p === localPlayer(scene)) updateCamera(scene, true);
}

function enterZone(scene, p, z) {
  const st = S(scene);
  if (!st.state[z.id].open || !p.alive) return false;
  p.zoneCd = 1.5;
  teleport(scene, p, z.spawn.x, z.spawn.y);
  const n = aliveIn(scene, z.id).length, zs = st.state[z.id];
  const msg = n ? `${z.icon} ${z.name}: ${n} zombi içeride! Çıkış ${z.id === 'mine' ? 'merdivende' : 'kapıda'} (güney).`
    : `${z.icon} ${z.name}: bölge temiz.${zs.cleared != null ? ` ${Math.max(1, zs.cleared + RESPAWN_DAYS - scene.timeSys.day)} gün sonra yeniden dolar.` : ''}`;
  toastTo(scene, p, msg, n ? 'warn' : 'info');
  if (scene.timeSys.isNight) toastTo(scene, p, '🌙 Gece bölge zombileri azgın (daha hızlı ve sert). Köy de saldırı altında!', 'warn');
  if (p === localPlayer(scene) && !scene.net?.ctx) audio.sfx('whoosh');
  scene.events.emit('zoneEntered', { zone: z.id, player: p });
  return true;
}

function exitZone(scene, p) {
  const z = DEF[zoneIdAt(p.x, p.y)];
  if (!z) return false;
  const geo = gateGeo(scene, z.gate);
  if (!geo) return false;
  p.zoneCd = 1.5;
  teleport(scene, p, geo.back.x, geo.back.y);
  toastTo(scene, p, `🏡 Köye döndün (${z.short}).`, 'info');
  scene.events.emit('zoneExited', { zone: z.id, player: p });
  return true;
}

// ---------- Geçitler ----------
function applyGate(scene, z) {
  const st = S(scene);
  if (!st) return;
  scene.forestEdge?.openGate?.(z.gate);
  st.applied.add(z.id);
  const sg = st.signs[z.id];
  sg?.label?.setText(`${z.icon} ${z.short}`).setColor('#d8ffd0');
  if (z.lock.bridge) st.bridge?.setTexture('zn_bridge');
}

function unlock(scene, z) {
  const st = S(scene), zs = st.state[z.id], inv = scene.inventory;
  if (zs.open) return;
  if (z.lock.item) {
    if (!inv.remove(z.lock.item, 1)) { audio.sfx('error'); return; }
  } else {
    if (!inv.has(z.lock.bridge)) { audio.sfx('error'); return; }
    Object.entries(z.lock.bridge).forEach(([id, n]) => inv.remove(id, n));
  }
  scene.hud.refreshInventory?.();
  zs.open = true;
  applyGate(scene, z);
  populate(scene, z);
  audio.sfx('quest');
  toastAll(scene, z.lock.item ? `${z.icon} ${z.name} geçidi açıldı! İçeride daha zor zombiler ve değerli ganimet var.`
    : `🌉 Köprü onarıldı! ${z.icon} ${z.name} artık ulaşılabilir.`, 'ok');
  scene.events.emit('zoneUnlocked', z.id);
  syncGuests(scene, true);
}

function lockHint(scene, z) {
  audio.sfx('error');
  if (z.lock.item === 'rusty_key') scene.hud.toast('🔒 Paslı Anahtar gerekli: zombi yuvalarından ve ganimet sandıklarından düşebilir ya da 6 hurda + 1 göktaşı parçasıyla üretilir.', 'info');
  else if (z.lock.item === 'hospital_card') scene.hud.toast('🔒 Hastane Kartı gerekli: Doktor Selin\'den satın alabilir ya da onun görevlerini bitirince kazanabilirsin.', 'info');
  else scene.hud.toast(`🌉 Köprüyü onarmak için ${costText(z.lock.bridge)} gerekli.`, 'info');
}

// ---------- Zombiler ----------
function spawnZoneZombie(scene, z, kind, x, y) {
  const lvl = z.lvl + Math.floor((scene.waves?.wave || 0) / 2);
  const zz = new Zombie(scene, x, y, kind, lvl);
  const d = scene.difficulty;
  zz.maxHp = zz.hp = Math.max(1, Math.round(zz.maxHp * 1.3 * (d?.hp ?? 1)));
  zz.baseDmg = Math.max(1, Math.round(zz.damage * 1.15 * (d?.dmg ?? 1)));
  zz.damage = zz.baseDmg;
  zz.reward = Math.round(zz.reward * 1.5);
  zz.zoneId = z.id;
  zz.role = 'hunter';
  zz.flank = 0;
  zz.zoneSpeed = zz.speed;
  scene.zombies.add(zz);
  return zz;
}

function clearZombies(scene, id) {
  scene.zombies.getChildren().slice().forEach((z) => { if (z.zoneId && (!id || z.zoneId === id)) z.destroy(); });
}

function populate(scene, z) {
  const zs = S(scene).state[z.id];
  clearZombies(scene, z.id);
  z.spawns.forEach(([kind, x, y]) => spawnZoneZombie(scene, z, kind, x, y));
  zs.populated = true;
}

// Bölge zombisi yalnızca kendi bölgesindeki oyunculara saldırır
function zoneTarget(zz) {
  const s = zz.scene;
  let best = null, bd = zz.aggro ? 600 : AGGRO;
  for (const p of players(s)) {
    if (!p.alive || !p.active || zoneIdAt(p.x, p.y) !== zz.zoneId) continue;
    const d = dist(zz.x, zz.y, p.x, p.y);
    if (d < bd) { bd = d; best = p; }
  }
  if (best) zz.aggro = true;
  else zz.aggro = false;
  return best;
}

// Zombie sınıfına küçük yamalar (bir kez): bölge zombisi hedef seçimi + güneşte yanmama; ana harita
// zombileri bölgedeki oyuncuları hedeflemez (dünyanın boşluğunda yürümesinler)
if (!Zombie.prototype.__zonesPatched) {
  Zombie.prototype.__zonesPatched = true;
  const pick = Zombie.prototype.pickTarget;
  Zombie.prototype.pickTarget = function () {
    if (this.zoneId) return zoneTarget(this);
    const s = this.scene;
    if (!s.zones) return pick.call(this);
    const hid = [];
    for (const p of players(s)) if (!p.hidden && zoneIdAt(p.x, p.y)) { p.hidden = true; hid.push(p); }
    try { return pick.call(this); } finally { hid.forEach((p) => { p.hidden = false; }); }
  };
  const burn = Zombie.prototype.burn;
  Zombie.prototype.burn = function () { if (this.zoneId) return; burn.call(this); };
}

// ---------- Sandıklar ----------
function makeChests(scene) {
  const st = S(scene);
  for (const list of Object.values(st.chests)) list.forEach((c) => c.img?.destroy());
  ZONES.forEach((z) => {
    const looted = st.state[z.id].looted;
    st.chests[z.id] = z.chests.map((c) => {
      const open = looted.includes(c.i);
      const tex = c.vault ? (open ? 'zn_safe_open' : 'zn_safe') : (open ? 'zn_crate_open' : 'zn_crate');
      const img = scene.add.image(c.x, c.y, tex).setDepth(c.y + 6);
      return { ...c, img };
    });
  });
}

function refreshChests(scene, z) {
  const st = S(scene), looted = st.state[z.id].looted;
  (st.chests[z.id] || []).forEach((c) => {
    const open = looted.includes(c.i);
    c.img?.setTexture(c.vault ? (open ? 'zn_safe_open' : 'zn_safe') : (open ? 'zn_crate_open' : 'zn_crate'));
  });
}

function openChest(scene, z, c) {
  const st = S(scene), zs = st.state[z.id];
  if (zs.looted.includes(c.i)) return;
  if (c.vault && zs.cleared == null) {
    audio.sfx('error');
    scene.hud.toast(`🔐 Kasa kilitli. Önce bölgeyi temizle (${aliveIn(scene, z.id).length} zombi kaldı).`, 'warn');
    return;
  }
  zs.looted.push(c.i);
  c.img?.setTexture(c.vault ? 'zn_safe_open' : 'zn_crate_open');
  const roll = LOOT[z.id][c.vault ? 'vault' : 'chest'](scene);
  const got = [];
  roll.items.forEach(([id, n]) => { if (ITEMS[id] && n > 0) { scene.giveItem(id, n); got.push(`${n}× ${ITEMS[id].name}`); } });
  scene.player.addCoins(roll.coins);
  scene.hud.refreshInventory?.();
  scene.hud.toast(`${c.vault ? '💰 Kasa' : '🧰 Sandık'} (${z.short}): ${got.join(', ')}, +${roll.coins} 🪙`, 'ok');
  scene.floatText(c.x, c.y - 10, `+${roll.coins}🪙`, '#ffd166');
  scene.spawnParticles(c.x, c.y, c.vault ? 0xa86bff : 0xe8c867, c.vault ? 16 : 8);
  audio.sfx(c.vault ? 'achievement' : 'coin');
  scene.events.emit('zoneChestOpened', { zone: z.id, vault: c.vault, items: roll.items });
}

// ---------- Periyodik kontrol (host) ----------
function tick(scene) {
  const st = S(scene), day = scene.timeSys.day, night = scene.timeSys.isNight;
  const occ = {};
  for (const p of players(scene)) { const id = zoneIdAt(p.x, p.y); if (id) (occ[id] ||= []).push(p); }
  for (const z of ZONES) {
    const zs = st.state[z.id];
    if (!zs.open) continue;
    const alive = aliveIn(scene, z.id);
    if (zs.populated && alive.length === 0) {
      zs.populated = false;
      zs.cleared = day;
      (occ[z.id] || []).forEach((p) => toastTo(scene, p, `✅ ${z.name} temizlendi! Kasa açılabilir. Bölge ${RESPAWN_DAYS} gün boyunca boş kalır.`, 'ok'));
      scene.events.emit('zoneCleared', z.id);
    } else if (!zs.populated && !occ[z.id]) {
      if (zs.cleared != null && day >= zs.cleared + RESPAWN_DAYS) {
        zs.cleared = null;
        zs.looted = [];
        refreshChests(scene, z);
      }
      if (zs.cleared == null) populate(scene, z);
    }
    // Gece azgınlığı
    const mul = night ? NIGHT_MUL : 1;
    for (const zz of alive) {
      zz.speedMul = mul;
      zz.damage = Math.max(1, Math.round((zz.baseDmg || zz.damage) * mul));
    }
  }
}

// Oyuncular geçitten girer / çıkış merdiveninden döner (host)
function movePlayers(scene, dt) {
  const st = S(scene);
  for (const p of players(scene)) {
    p.zoneCd = Math.max(0, (p.zoneCd || 0) - dt);
    if (!p.alive || p.zoneCd > 0) continue;
    const id = zoneIdAt(p.x, p.y);
    if (id) {
      const e = DEF[id].exit;
      if (Math.abs(p.x - e.x) < 8 && Math.abs(p.y + 4 - e.y) < 8) exitZone(scene, p);
      continue;
    }
    for (const z of ZONES) {
      if (!st.state[z.id].open) continue;
      const g = scene.forestEdge?.gates?.find((o) => o.id === z.gate);
      if (g && Phaser.Geom.Rectangle.Contains(g.rect, p.x, p.y + 4)) { enterZone(scene, p, z); break; }
    }
  }
}

// Host: misafir konumu doğrulaması (NetHost 'mv' mesajında çağırır). Orman şeridine / kilitli bölgeye giremez.
function checkGuestMove(scene, g) {
  const st = S(scene), p = g.player, x = g.tx, y = g.ty;
  const id = zoneIdAt(x, y);
  if (id && st.state[id].open) return;
  if (!id) {
    const pr = scene.forestEdge?.playable;
    if (!pr) return;
    if (x >= pr.x - 8 && y >= pr.y - 10 && x <= pr.right + 8 && y <= pr.bottom + 8) return;
    for (const z of ZONES) {
      if (!st.state[z.id].open) continue;
      const gr = scene.forestEdge.gates.find((o) => o.id === z.gate)?.rect;
      if (gr && x >= gr.x - 8 && y >= gr.y - 12 && x <= gr.right + 8 && y <= gr.bottom + 8) return;
    }
    teleport(scene, p, Phaser.Math.Clamp(x, pr.x + 6, pr.right - 6), Phaser.Math.Clamp(y, pr.y + 2, pr.bottom - 10));
    return;
  }
  const geo = gateGeo(scene, DEF[id].gate);
  if (geo) teleport(scene, p, geo.back.x, geo.back.y);
}

// Misafirlere geçit durumu (yeni katılan da alsın diye periyodik; küçük mesaj)
function syncGuests(scene, force) {
  const st = S(scene), net = scene.net;
  if (!net?.isHost || !net.guests?.size) return;
  st.syncT = force ? 0 : st.syncT;
  if (st.syncT > 0) return;
  st.syncT = 1.5;
  net.broadcast({ t: 'zn', o: ZONES.filter((z) => st.state[z.id].open).map((z) => z.id) });
}

// ---------- Kamera ve mini harita (host + misafir) ----------
function updateCamera(scene, force) {
  const st = S(scene), p = localPlayer(scene);
  if (!st || !p) return;
  const id = zoneIdAt(p.x, p.y) || 'main';
  if (id === st.camKey && !force) return;
  st.camKey = id;
  const cam = scene.cameras.main, z = DEF[id];
  if (z) cam.setBounds(z.ox, z.oy, ZPW, ZPH); else cam.setBounds(0, 0, W, H);
  cam.centerOn(p.x, p.y);
}

function buildMini(z) {
  const { c, ctx } = makeCanvas(128, 88);
  const th = THEME[z.id].mini;
  R(ctx, 0, 0, 128, 88, '#0d0b12');
  z.map.forEach((row, ty) => [...row].forEach((ch, tx) => {
    R(ctx, 4 + tx * 4, 4 + ty * 4, 4, 4, ch === '#' ? th.wall : ch === 'o' ? th.obs : ch === 'E' ? '#6ee06e' : th.floor);
  }));
  return c;
}

function drawZoneMinimap(scene) {
  const st = S(scene), p = localPlayer(scene);
  const id = p ? zoneIdAt(p.x, p.y) : null;
  if (!id) return;
  const box = document.getElementById('jc-minimap');
  const cv = box?.querySelector('canvas');
  if (!cv || !box.classList.contains('show') || document.hidden) return;
  const z = DEF[id], ctx = cv.getContext('2d');
  ctx.drawImage(st.mini[id], 0, 0);
  const mx = (x) => Math.round(4 + (x - z.ox) / 4), my = (y) => Math.round(4 + (y - z.oy) / 4);
  const dot = (x, y, col, r = 1) => { ctx.fillStyle = col; ctx.fillRect(mx(x) - r, my(y) - r, r * 2, r * 2); };
  if (!scene.net?.isGuest) {
    const looted = st.state[id].looted;
    z.chests.forEach((c) => { if (!looted.includes(c.i)) dot(c.x, c.y, c.vault ? '#c78cff' : '#e0b060', c.vault ? 2 : 1); });
  }
  scene.zombies?.getChildren().forEach((zz) => { if (!zz.dead && zz.visible !== false && zoneIdAt(zz.x, zz.y) === id) dot(zz.x, zz.y, '#ff3b3b', 1); });
  const others = scene.net?.isGuest ? [...scene.net.avatars.values()].map((a) => a.spr) : players(scene).filter((o) => o !== p);
  others.forEach((o) => { if (zoneIdAt(o.x, o.y) === id) dot(o.x, o.y, '#8fd3ff', 2); });
  ctx.fillStyle = '#000'; ctx.fillRect(mx(p.x) - 2, my(p.y) - 2, 4, 4);
  ctx.fillStyle = (scene.time.now % 1000) < 600 ? '#ffffff' : '#ffe08a'; ctx.fillRect(mx(p.x) - 1, my(p.y) - 1, 2, 2);
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '8px sans-serif'; ctx.fillText(`${z.icon} ${z.short}`, 5, 86);
}

// ---------- Askeri tüfek ----------
function useRifle(scene, ctx) {
  const p = scene.player;
  if (scene.inventory.count('ammo') < 1) { audio.sfx('error'); scene.hud.notice?.('Mermin yok!'); return; }
  scene.inventory.remove('ammo', 1);
  p.actionCd = 0.6;
  if (Math.abs(ctx.wx - p.x) > 2) p.setFlipX(ctx.wx < p.x);
  const a = Phaser.Math.Angle.Between(p.x, p.y - 2, ctx.wx, ctx.wy);
  const dmg = Math.round(ITEMS.rifle.dmg * (1 + (scene.combat?.buffDmg || 0)) * 10) / 10;
  scene.fireBullet(p.x, p.y - 2, a, dmg, 460);
  if (p.body) { p.body.velocity.x -= Math.cos(a) * 40; p.body.velocity.y -= Math.sin(a) * 40; }
  scene.cameras.main.shake(70, 0.004);
  audio.sfx('shoot');
}

// ---------- Statik bölge dünyası (host ve misafirde aynı kurulur) ----------
function buildZones(scene) {
  const st = S(scene);
  const stat = (o) => { scene.worldStatic?.add(o); return o; };
  const walls = st.walls = scene.physics.add.staticGroup();
  const block = (x, y, w, h) => {
    const b = stat(walls.create(x + w / 2, y + h / 2, 'px').setVisible(false));
    b.body.setSize(w, h);
    b.isZoneWall = true;
    return b;
  };
  ZONES.forEach((z) => {
    stat(scene.add.image(z.ox, z.oy, `zn_floor_${z.id}`).setOrigin(0, 0).setDepth(-10));
    // Duvar ve engel karelerini satır satır birleştir (az gövde)
    z.map.forEach((row, ty) => {
      let run = -1;
      for (let tx = 0; tx <= ZW; tx++) {
        const solid = tx < ZW && (row[tx] === '#' || row[tx] === 'o');
        if (solid && run < 0) run = tx;
        else if (!solid && run >= 0) { block(z.ox + run * TILE, z.oy + ty * TILE, (tx - run) * TILE, TILE); run = -1; }
      }
    });
    st.mini[z.id] = buildMini(z);
  });
  // Doğu kenarının dışı: açık doğu geçidinden boşluğa yürünmesin
  block(W, 0, 10, H);
  // Geçit tabelaları ve köprü
  ZONES.forEach((z) => {
    const geo = gateGeo(scene, z.gate);
    if (!geo) return;
    const sign = stat(scene.add.image(geo.sign.x, geo.sign.y, 'zn_sign').setDepth(geo.sign.y + 7));
    const label = stat(scene.add.text(geo.sign.x, geo.sign.y - 9, `🔒 ${z.short}`, { fontFamily: 'Outfit, sans-serif', fontSize: '6px', color: '#ffd9a8', stroke: '#000', strokeThickness: 2, resolution: 4 })
      .setOrigin(0.5, 1).setDepth(geo.sign.y + 40));
    st.signs[z.id] = { sign, label };
    if (z.lock.bridge) {
      const r = geo.g.rect;
      st.bridge = stat(scene.add.image(r.centerX, r.centerY, 'zn_bridge_broken').setDepth(r.centerY - 6));
    }
  });
  // Çarpışmalar: yerel oyuncu (host'ta host, misafirde misafir) ve zombiler
  scene.physics.add.collider(scene.player, walls);
  scene.physics.add.collider(scene.zombies, walls);
}

// ---------- Modül ----------
export default {
  id: 'zones',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    const st = scene.zones = {
      state: {}, chests: {}, signs: {}, mini: {}, applied: new Set(), walls: null, bridge: null,
      camKey: null, tickT: 0, syncT: 0, pending: null, returned: null,
      defs: ZONES, zoneAt: zoneIdAt,
      open: (id) => { const z = DEF[id]; if (z && !st.state[id].open) { st.state[id].open = true; applyGate(scene, z); populate(scene, z); syncGuests(scene, true); } return !!z; },
      enter: (p, id) => enterZone(scene, p || scene.player, DEF[id]),
      exit: (p) => exitZone(scene, p || scene.player),
      alive: (id) => aliveIn(scene, id).length,
      populate: (id) => populate(scene, DEF[id]),
      gate: (id) => gateGeo(scene, DEF[id].gate)
    };
    ZONES.forEach((z) => { st.state[z.id] = { open: false, cleared: null, looted: [], populated: false }; });

    // Dünya sınırları bölgeleri kapsar (kamera ana haritada kalır)
    scene.physics.world.setBounds(0, 0, WORLD_W, Math.max(H, ZPH));
    buildZones(scene);

    // Dalga sayımı (erken temizlik, kalan zombi) yalnızca ana harita zombilerini sayar
    const grp = scene.zombies;
    grp.countActive = function (value = true) {
      let n = 0;
      for (const c of this.getChildren()) if (c.active === value && !c.zoneId) n++;
      return n;
    };

    // Host: misafir konum doğrulaması
    scene.netMoveCheck = (g) => { try { checkGuestMove(scene, g); } catch (e) { console.warn('zones: konum doğrulanamadı', e); } };

    // Misafir: geçit durumu mesajı
    const onNet = (m) => {
      if (m?.t !== 'zn' || !Array.isArray(m.o)) return;
      m.o.forEach((id) => { const z = DEF[id]; if (!z) return; st.state[id].open = true; if (!st.applied.has(id)) applyGate(scene, z); });
    };
    scene.events.on('netMsg', onNet);

    // Paslı Anahtar düşmeleri (yuva / ganimet sandığı)
    const giveKey = (where) => {
      if (st.state.mine.open || scene.inventory.count('rusty_key') > 0) return;
      scene.giveItem('rusty_key', 1);
      scene.hud.toast(`🗝️ ${where} paslı bir anahtar çıktı! Kuzeydeki terk edilmiş madenin kapısını açabilir.`, 'ok');
    };
    const onNest = () => { if (Math.random() < 0.3) giveKey('Yuvadan'); };
    const onChest = () => { if (Math.random() < 0.07) giveKey('Sandıktan'); };
    scene.events.on('nestDestroyed', onNest);
    scene.events.on('lootChestOpened', onChest);
    scene.events.once('shutdown', () => {
      scene.events.off('netMsg', onNet);
      scene.events.off('nestDestroyed', onNest);
      scene.events.off('lootChestOpened', onChest);
    });

    // Etkileşimler (host; misafir bağlamında scene.player misafirdir)
    scene.addInteraction((s) => {
      const z0 = S(s);
      if (!z0 || s.net?.isGuest) return null;
      const p = s.player;
      let best = null;
      const offer = (d, label, run) => { if (!best || d < best.dist) best = { dist: d, label, run }; };
      const id = zoneIdAt(p.x, p.y);
      if (id) {
        const z = DEF[id], e = z.exit;
        const de = dist(p.x, p.y, e.x, e.y);
        if (de < 26) offer(de, 'Köye dön', () => exitZone(s, s.player));
        const looted = z0.state[id].looted;
        for (const c of z0.chests[id] || []) {
          if (looted.includes(c.i)) continue;
          const d = dist(p.x, p.y, c.x, c.y);
          if (d < 22) offer(d, c.vault ? (z0.state[id].cleared != null ? 'Kasayı aç' : 'Kasa (bölgeyi temizle)') : 'Sandığı aç', () => openChest(s, z, c));
        }
        return best;
      }
      for (const z of ZONES) {
        const geo = gateGeo(s, z.gate);
        if (!geo) continue;
        const d = dist(p.x, p.y, geo.mouth.x, geo.mouth.y);
        if (d > 34) continue;
        const zs = z0.state[z.id];
        if (zs.open) offer(d, `${z.enter} (${z.name})`, () => enterZone(s, s.player, z));
        else if (z.lock.item) {
          if (s.inventory.count(z.lock.item) > 0) offer(d, `${ITEMS[z.lock.item].name} ile geçidi aç`, () => unlock(s, z));
          else offer(d, `🔒 ${z.name} (${ITEMS[z.lock.item].name} gerekli)`, () => lockHint(s, z));
        } else if (s.inventory.has(z.lock.bridge)) offer(d, `Kırık köprüyü onar (${costText(z.lock.bridge)})`, () => unlock(s, z));
        else offer(d, `🌉 Kırık köprü (${costText(z.lock.bridge)})`, () => lockHint(s, z));
      }
      return best;
    });

    // Ana harita mini haritası: geçit simgeleri (turuncu kilitli, yeşil açık)
    scene.minimapDots = scene.minimapDots || [];
    scene.minimapDots.push((s) => {
      const out = [];
      for (const z of ZONES) {
        const geo = gateGeo(s, z.gate);
        if (geo) out.push({ x: geo.mouth.x, y: geo.mouth.y, color: S(s)?.state[z.id].open ? '#6ee06e' : '#ff9a3a', r: 2 });
      }
      return out;
    });

    // Çıkış ışıkları (gece)
    scene.lightSources.push(() => ZONES.filter((z) => st.state[z.id].open).map((z) => ({ x: z.exit.x, y: z.exit.y, r: 40 })));

    // Gece uyarıları: bölgedeki oyuncular köyden uzakta
    const ts = scene.timeSys;
    ts.on('hour', (h) => {
      if (S(scene) !== st || h !== 19) return;
      for (const p of players(scene)) if (zoneIdAt(p.x, p.y)) toastTo(scene, p, '🌆 Hava kararıyor! Gece bölge zombileri azgınlaşır, köy de saldırıya uğrar. Sığınağa dönmeyi düşün.', 'warn');
    });
    ts.on('dusk', () => {
      if (S(scene) !== st) return;
      for (const p of players(scene)) if (zoneIdAt(p.x, p.y)) toastTo(scene, p, '🌙 Gece çöktü! Köy saldırı altında ve sen uzaktasın. Bölgedeki zombiler artık daha hızlı ve sert.', 'warn');
    });
  },

  begin(scene, isNew) {
    const st = S(scene);
    clearZombies(scene);
    const d = isNew ? null : st.pending;
    st.pending = null;
    ZONES.forEach((z) => {
      const zs = st.state[z.id] = { open: false, cleared: null, looted: [], populated: false };
      const r = d?.z?.[z.id];
      if (r && typeof r === 'object') {
        zs.open = !!r.open;
        zs.cleared = Number.isFinite(r.cleared) ? r.cleared : null;
        zs.looted = Array.isArray(r.looted) ? r.looted.filter((i) => Number.isInteger(i) && i >= 0 && i < z.chests.length) : [];
      }
      if (zs.open) applyGate(scene, z);
    });
    makeChests(scene);
    st.tickT = 0;
    updateCamera(scene, true);
    if (st.returned) {
      const name = st.returned;
      st.returned = null;
      scene.time.delayedCall(1200, () => scene.hud?.toast(`Kayıt ${name} içindeydi; geçidin köy tarafında uyandın.`, 'info'));
    }
  },

  update(scene, dt) {
    const st = S(scene);
    if (!st) return;
    updateCamera(scene, false);
    drawZoneMinimap(scene);
    if (scene.net?.isGuest) return;
    movePlayers(scene, dt);
    st.tickT -= dt;
    if (st.tickT <= 0) { st.tickT = 0.5; tick(scene); }
    st.syncT -= dt;
    syncGuests(scene, false);
  },

  save(scene) {
    const st = S(scene);
    if (!st) return undefined;
    return { v: 1, z: Object.fromEntries(ZONES.map((z) => { const zs = st.state[z.id]; return [z.id, { open: zs.open, cleared: zs.cleared, looted: [...zs.looted] }]; })) };
  },

  load(scene, d) {
    const st = S(scene);
    st.pending = d && typeof d === 'object' ? d : null;
    // Bölgede (ya da ana harita dışında) kaydedildiyse geçidin köy tarafına al
    const p = scene.player;
    if (!p) return;
    const id = zoneIdAt(p.x, p.y);
    if (id || p.x > W || p.y > H) {
      const z = DEF[id] || DEF.military;
      const geo = gateGeo(scene, z.gate);
      if (geo) p.setPosition(geo.back.x, geo.back.y);
      st.returned = z.name;
    }
  }
};
