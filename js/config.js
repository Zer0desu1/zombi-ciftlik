// Oyun genel sabitleri ve veri tabloları
export const TILE = 16;
// Harita 64×44 → 96×64 → 128×88 büyütüldü: eski alanlar aynı koordinatlarda kaldı, yeni alan hep sağa ve aşağıya eklendi.
export const MAP_W = 128;
export const MAP_H = 88;
// Eski (sürüm 1) harita boyutu: tohumlu kaynak dizilimi bu alanda eskisiyle birebir aynı üretilir
export const LEGACY_MAP_W = 64;
export const LEGACY_MAP_H = 44;
// Sürüm 2 harita boyutu: 96×64 alanının dizilimi de sürüm 2 ile birebir aynı üretilir
export const V2_MAP_W = 96;
export const V2_MAP_H = 64;
export const MAP_VERSION = 3;
export const ZOOM = 3;

// Zaman (oyun dakikası)
export const DAY_START = 6 * 60;      // 06:00
export const NIGHT_START = 20 * 60;   // 20:00
export const GAME_MIN_PER_SEC = 4;    // (eski) — artık gündüz/gece süreleri aşağıda
// Gerçek süreler: gündüz (06–20) ~3 dk, gece (20–06) ~80 sn. Dalga erken temizlenirse şafağa hızla geçilir.
export const DAY_SECONDS = 180;
export const NIGHT_SECONDS = 80;

// Zorluk: count = zombi sayısı, hp = zombi canı, dmg = zombi hasarı, reward = dalga ödülü çarpanı
export const DIFFICULTIES = {
  easy:   { id: 'easy',   name: 'Kolay',  icon: '🌱', count: 0.7,  hp: 0.8,  dmg: 0.75, reward: 1,   desc: 'Rahat çiftçilik, seyrek sürüler.' },
  normal: { id: 'normal', name: 'Normal', icon: '⚔️', count: 1,    hp: 1,    dmg: 1,    reward: 1.2, desc: 'Dengeli: geceye hazırlanmazsan kaybedersin.' },
  hard:   { id: 'hard',   name: 'Zor',    icon: '💀', count: 1.35, hp: 1.25, dmg: 1.25, reward: 1.5, desc: 'Her gece bir kuşatma. Hata affetmez.' }
};

// Harita sürümü → o sürümdeki harita boyutu (kayıt göçü: ana harita dışındaki konumlar kaydırılır)
export const MAP_SIZES = { 1: { w: LEGACY_MAP_W, h: LEGACY_MAP_H }, 2: { w: V2_MAP_W, h: V2_MAP_H }, 3: { w: MAP_W, h: MAP_H } };

// Bölgeler (tile koordinatları)
export const FARM_ZONE = { x: 6, y: 8, w: 16, h: 13 };
export const SHELTER_TILE = { x: 30, y: 18 };      // sığınak sol üst
export const MARKET_TILE = { x: 42, y: 14 };
export const FORGE_TILE = { x: 42, y: 25 };

export const SAVE_KEY = 'zombi-ciftlik-save-v1';
export const HOTBAR_SIZE = 8;
export const INV_SIZE = 24;

export const ITEMS = {
  hoe:          { name: 'Çapa',            type: 'tool',   icon: 'i_hoe',      desc: 'Çimeni sürer (sadece tarla alanında).' },
  can:          { name: 'Sulama Kabı',     type: 'tool',   icon: 'i_can',      desc: 'Ekili toprağı sular.' },
  axe:          { name: 'Balta',           type: 'tool',   icon: 'i_axe',      desc: 'Ağaç keser → Odun.' },
  pickaxe:      { name: 'Kazma',           type: 'tool',   icon: 'i_pickaxe',  desc: 'Kaya kırar → Taş.' },
  sword:        { name: 'Kılıç',           type: 'weapon', icon: 'i_sword',    dmg: 2, desc: 'Yakın dövüş silahı.' },
  pistol:       { name: 'Tabanca',         type: 'gun',    icon: 'i_pistol',   dmg: 3, desc: 'Mermi kullanır. Fareye doğru ateş eder.' },
  ammo:         { name: 'Mermi',           type: 'material', icon: 'i_ammo',   sell: 1 },
  wood:         { name: 'Odun',            type: 'material', icon: 'i_wood',   sell: 2 },
  stone:        { name: 'Taş',             type: 'material', icon: 'i_stone',  sell: 2 },
  seed_wheat:   { name: 'Buğday Tohumu',   type: 'seed', crop: 'wheat',   icon: 'i_seed_wheat' },
  seed_carrot:  { name: 'Havuç Tohumu',    type: 'seed', crop: 'carrot',  icon: 'i_seed_carrot' },
  seed_pumpkin: { name: 'Balkabağı Tohumu',type: 'seed', crop: 'pumpkin', icon: 'i_seed_pumpkin' },
  wheat:        { name: 'Buğday',          type: 'crop', icon: 'i_wheat',   sell: 8 },
  carrot:       { name: 'Havuç',           type: 'food', icon: 'i_carrot',  sell: 12, heal: 5,  energy: 10 },
  pumpkin:      { name: 'Balkabağı',       type: 'crop', icon: 'i_pumpkin', sell: 30 },
  bread:        { name: 'Ekmek',           type: 'food', icon: 'i_bread',   sell: 20, heal: 25, energy: 35 },
  soup:         { name: 'Balkabağı Çorbası', type: 'food', icon: 'i_soup',  sell: 60, heal: 60, energy: 60 },
  barricade:    { name: 'Barikat',         type: 'place', icon: 'barricade', desc: 'Zombileri yavaşlatır. Tıklayarak yerleştir.' },
  turret:       { name: 'Taret',           type: 'place', icon: 'turret',    desc: 'Otomatik ateş eder. Tıklayarak yerleştir.' }
};

// Ekinler: hoursPerStage = sulanmış halde bir aşama için gereken oyun saati
export const CROPS = {
  wheat:   { item: 'wheat',   hoursPerStage: 4,  yield: [2, 3], seedBack: 1 },
  carrot:  { item: 'carrot',  hoursPerStage: 5,  yield: [1, 3], seedBack: 0 },
  pumpkin: { item: 'pumpkin', hoursPerStage: 9,  yield: [1, 2], seedBack: 0 }
};
export const CROP_STAGES = 4; // 0..3 (3 = olgun)

export const RECIPES = [
  { out: 'barricade', qty: 1, cost: { wood: 4 } },
  { out: 'turret',    qty: 1, cost: { wood: 4, stone: 6, ammo: 10 } },
  { out: 'ammo',      qty: 5, cost: { wood: 1, stone: 1 } },
  { out: 'pistol',    qty: 1, cost: { wood: 5, stone: 8 } },
  { out: 'bread',     qty: 1, cost: { wheat: 3 } },
  { out: 'soup',      qty: 1, cost: { pumpkin: 1, carrot: 2 } },
  { out: 'seed_wheat',qty: 2, cost: { wheat: 1 } }
];

// Tüccar ve demirci satış listeleri
export const SHOPS = {
  merchant: [
    { id: 'seed_wheat', qty: 5, price: 15 },
    { id: 'seed_carrot', qty: 5, price: 20 },
    { id: 'seed_pumpkin', qty: 3, price: 30 },
    { id: 'bread', qty: 1, price: 30 }
  ],
  blacksmith: [
    { id: 'ammo', qty: 10, price: 15 },
    { id: 'barricade', qty: 1, price: 25 },
    { id: 'turret', qty: 1, price: 110 },
    { id: 'pistol', qty: 1, price: 120 }
  ]
};

export const QUESTS = [
  { id: 'q_carrot',  npc: 'farmer',     title: 'Havuç Hasadı',     desc: 'Ayşe\'ye 5 havuç getir.',            type: 'deliver', item: 'carrot',  amount: 5,  reward: { coins: 40, items: { seed_pumpkin: 3 } } },
  { id: 'q_wheat',   npc: 'farmer',     title: 'Kış Hazırlığı',    desc: 'Ayşe\'ye 10 buğday getir.',          type: 'deliver', item: 'wheat',   amount: 10, reward: { coins: 60, items: { soup: 1 } } },
  { id: 'q_hunt',    npc: 'guard',      title: 'Gece Avcısı',      desc: '10 zombi öldür.',                     type: 'kill',    amount: 10, reward: { coins: 60, items: { ammo: 20 } } },
  { id: 'q_survive', npc: 'guard',      title: 'Dalga Kıran',      desc: '3. dalgayı atlat.',                   type: 'survive', amount: 3,  reward: { coins: 120, items: { turret: 1 } } },
  { id: 'q_mats',    npc: 'blacksmith', title: 'Hammadde',         desc: 'Zeynep\'e 10 odun getir.',            type: 'deliver', item: 'wood',    amount: 10, reward: { coins: 30, items: { barricade: 2 } } },
  { id: 'q_stone',   npc: 'blacksmith', title: 'Örs İçin Taş',     desc: 'Zeynep\'e 12 taş getir.',             type: 'deliver', item: 'stone',   amount: 12, reward: { coins: 40, items: { pistol: 1 } } },
  { id: 'q_pumpkin', npc: 'merchant',   title: 'Balkabağı Siparişi', desc: 'Kemal\'e 3 balkabağı getir.',       type: 'deliver', item: 'pumpkin', amount: 3,  reward: { coins: 150 } }
];

export const START_INVENTORY = [
  ['hoe', 1], ['can', 1], ['sword', 1], ['axe', 1], ['pickaxe', 1],
  ['seed_wheat', 10], ['seed_carrot', 5], ['wood', 4]
];

export const PLAYER_STATS = { maxHp: 100, maxEnergy: 100, speed: 70, startCoins: 60 };
