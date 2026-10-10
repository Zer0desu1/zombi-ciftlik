// 'events' özellik modülü — Rastgele harita olayları ve ganimet sandıkları.
//   Gündüz olayları (günde en fazla bir büyük olay, %85): gezgin tüccar, yaralı yabancı (işaret fişeği),
//     göktaşı düşmesi, zombi yuvası, hasat festivali.
//   Gece olayları (%40): sisli gece, göktaşı düşmesi.
//   Ganimet sandıkları: terk edilmiş evin çevresinde ve orman kıyılarında; her şafak birkaç tane yenilenir.
//   Ayrıca orman sınırının (MapBuilder.buildForestEdge) oyuncu çarpışmasını kurar.
// Yardım kolisi ve geyik göçü wildlife.js'tedir. Durum scene.mapEvents üzerinde tutulur.
// Test/hata ayıklama: scene.mapEvents.trigger('trader'|'survivor'|'meteor'|'nest'|'festival'|'fog'), scene.mapEvents.spawnChest()
import { TILE, MAP_W, MAP_H, ITEMS, RECIPES, SHOPS, CROPS, SHELTER_TILE } from '../config.js';
import { addCanvas, R, outline, makeHumanoid, basePal } from '../textures.js';
import { audio } from '../audio.js';
import { Survivor } from '../entities/NPC.js';
import { RUINS_ZONE, inForest } from '../systems/MapBuilder.js';

// ---------- Veri ----------
Object.assign(ITEMS, {
  meteor_ore: { name: 'Göktaşı Parçası', type: 'material', icon: 'i_meteor_ore', sell: 45, desc: 'Gökten düşmüş, hafifçe parlayan metal. Değerli; mermi dökümünde de kullanılır.' },
  relic:      { name: 'Antika Madalyon', type: 'material', icon: 'i_relic',      sell: 90, desc: 'Eski zamanlardan kalma altın madalyon. Tüccarlar iyi para verir.' }
});
RECIPES.push({ out: 'ammo', qty: 20, cost: { meteor_ore: 1, stone: 2 } });

// ---------- Ayarlar ----------
const DAY_EVENT_CHANCE = 0.85;
const NIGHT_EVENT_CHANCE = 0.4;
const DAY_EVENT_HOURS = [8, 13];   // büyük gündüz olayının başlayabileceği saat aralığı
const TRADER_LEAVES = 18;          // tüccar bu saatte toplanır
const MAX_CHESTS = 4;
const NEST_HP = 16;
const METEOR_HITS = 6;
const FESTIVAL_SELL = 1.5;         // festivalde ekin satış fiyatı çarpanı
const MAX_SURVIVORS = 4;           // town.js ile aynı sınır (yetişkin + bekleyen)
const TRADER = { npcName: 'Seyyah Rıza', role: 'Gezgin Tüccar', shop: 'traveler', key: 'traveler', texKey: 'ev_trader' };
const NAMES = ['Deniz', 'Cem', 'Ece', 'Mert', 'Selin', 'Kaan', 'Elif', 'Bora', 'Derya', 'Onur', 'Nazlı', 'Tuna', 'Sevgi', 'Umut'];
const TOWN = { x0: 22, y0: 7, x1: 60, y1: 38 };     // kasaba + çevresi (tile)
const SQUARE = { x0: 27, y0: 21, x1: 37, y1: 25 };   // meydan (tile)

const DIRS = [ // [ad, -e hâli, -de hâli]
  ['Doğu', 'Doğuya', 'Doğuda'], ['Güneydoğu', 'Güneydoğuya', 'Güneydoğuda'], ['Güney', 'Güneye', 'Güneyde'], ['Güneybatı', 'Güneybatıya', 'Güneybatıda'],
  ['Batı', 'Batıya', 'Batıda'], ['Kuzeybatı', 'Kuzeybatıya', 'Kuzeybatıda'], ['Kuzey', 'Kuzeye', 'Kuzeyde'], ['Kuzeydoğu', 'Kuzeydoğuya', 'Kuzeydoğuda']
];

// ---------- Dokular ----------
function makeTextures(scene) {
  const icon = (key, fn) => addCanvas(scene, key, 16, 16, (ctx) => { fn(ctx); outline(ctx, 0, 0, 16, 16, '#2a2233'); });
  icon('i_meteor_ore', (ctx) => {
    R(ctx, 3, 5, 10, 8, '#3a3550'); R(ctx, 4, 4, 7, 1, '#3a3550'); R(ctx, 4, 5, 5, 3, '#56507a');
    R(ctx, 6, 8, 1, 3, '#7fe3ff'); R(ctx, 7, 10, 3, 1, '#7fe3ff'); R(ctx, 10, 6, 1, 3, '#b8f3ff'); R(ctx, 5, 6, 1, 1, '#d6fbff');
  });
  icon('i_relic', (ctx) => {
    R(ctx, 7, 1, 2, 3, '#a8323b'); R(ctx, 4, 4, 8, 8, '#e8b84a'); R(ctx, 5, 3, 6, 10, '#e8b84a'); R(ctx, 3, 5, 10, 6, '#e8b84a');
    R(ctx, 5, 5, 6, 6, '#c98f2a'); R(ctx, 7, 6, 2, 4, '#fff2b0'); R(ctx, 6, 7, 4, 2, '#fff2b0'); R(ctx, 4, 4, 2, 1, '#fff7d6');
  });
  // Tüccar kampı: çizgili çadır + yük sandığı (32x24)
  addCanvas(scene, 'ev_camp', 32, 24, (ctx) => {
    for (let y = 0; y < 16; y++) {
      const hw = Math.round(1 + y * 0.85);
      for (let x = -hw; x <= hw; x++) R(ctx, 12 + x, 4 + y, 1, 1, ((x + 40) >> 1) % 2 ? '#7a3fa0' : '#e8c867');
    }
    R(ctx, 10, 13, 5, 7, '#2a1f30'); R(ctx, 12, 1, 1, 4, '#5e3a2e'); R(ctx, 13, 1, 4, 2, '#eb5757');
    R(ctx, 22, 13, 9, 7, '#9a6240'); R(ctx, 22, 13, 9, 2, '#b87a4e'); R(ctx, 22, 16, 9, 1, '#5e3a2e'); R(ctx, 26, 13, 1, 7, '#5e3a2e');
    outline(ctx, 0, 0, 32, 24, '#2a1f1a');
  });
  makeHumanoid(scene, 'ev_trader', basePal({ C: '#7a3fa0', D: '#5a2a7a', H: '#e8d2b0', P: '#4a3a2a' }), (ctx, ox) => {
    R(ctx, ox + 3, 0, 10, 2, '#c94040'); R(ctx, ox + 5, 0, 6, 1, '#e8c867'); // sarık
  });
  // Göktaşı: koyu kaya, parlayan çatlaklar (20x16) ve düşen ateş topu (10x10)
  addCanvas(scene, 'ev_meteor', 20, 16, (ctx) => {
    R(ctx, 3, 5, 14, 10, '#3a3550'); R(ctx, 5, 3, 10, 2, '#3a3550'); R(ctx, 2, 8, 1, 6, '#3a3550'); R(ctx, 17, 8, 1, 6, '#2c2840');
    R(ctx, 5, 4, 7, 4, '#56507a'); R(ctx, 6, 4, 3, 1, '#77709a');
    R(ctx, 8, 8, 1, 4, '#7fe3ff'); R(ctx, 9, 11, 4, 1, '#7fe3ff'); R(ctx, 13, 6, 1, 4, '#7fe3ff'); R(ctx, 5, 10, 2, 1, '#b8f3ff'); R(ctx, 13, 6, 1, 1, '#e6fdff');
    R(ctx, 1, 14, 18, 2, 'rgba(24,20,37,0.35)');
    outline(ctx, 0, 0, 20, 16, '#1b1622');
  });
  addCanvas(scene, 'ev_fireball', 10, 10, (ctx) => {
    R(ctx, 2, 2, 6, 6, '#ff9a3a'); R(ctx, 1, 3, 8, 4, '#ff9a3a'); R(ctx, 3, 1, 4, 8, '#ff9a3a');
    R(ctx, 3, 3, 4, 4, '#ffe08a'); R(ctx, 4, 4, 2, 2, '#ffffff');
  });
  // Zombi yuvası: kazılmış toprak höyüğü, kemikler, yeşil parıltı (24x18)
  addCanvas(scene, 'ev_nest', 24, 18, (ctx) => {
    R(ctx, 2, 8, 20, 8, '#5e3a2e'); R(ctx, 4, 6, 16, 2, '#5e3a2e'); R(ctx, 3, 7, 8, 3, '#7a4e36');
    R(ctx, 8, 9, 8, 5, '#1b1622'); R(ctx, 9, 8, 6, 1, '#1b1622'); R(ctx, 10, 11, 4, 2, '#3c7a2a'); R(ctx, 11, 11, 2, 1, '#8fe04a');
    R(ctx, 3, 12, 4, 1, '#e8e0cc'); R(ctx, 2, 11, 1, 3, '#e8e0cc'); R(ctx, 18, 10, 1, 4, '#e8e0cc'); R(ctx, 17, 13, 4, 1, '#e8e0cc');
    R(ctx, 6, 2, 1, 5, '#7a4a30'); R(ctx, 4, 3, 5, 1, '#7a4a30'); // eğri mezar haçı
    R(ctx, 1, 16, 22, 2, 'rgba(24,20,37,0.35)');
    outline(ctx, 0, 0, 24, 18, '#1b1622');
  });
  // İşaret fişeği (6x10)
  addCanvas(scene, 'ev_flare', 6, 10, (ctx) => { R(ctx, 2, 3, 2, 7, '#a8323b'); R(ctx, 2, 3, 1, 7, '#d04a48'); R(ctx, 1, 0, 4, 3, '#ffd166'); R(ctx, 2, 1, 2, 1, '#ffffff'); });
  // Ganimet sandığı (14x12) ve açık hâli
  const chest = (key, open) => addCanvas(scene, key, 14, 12, (ctx) => {
    if (open) { R(ctx, 1, 1, 12, 3, '#4a3426'); R(ctx, 2, 4, 10, 2, '#1b1622'); R(ctx, 3, 4, 3, 1, '#e8c867'); }
    else { R(ctx, 1, 2, 12, 4, '#6b4a2f'); R(ctx, 1, 2, 12, 1, '#8a6040'); }
    R(ctx, 1, 6, 12, 5, '#5a3e28'); R(ctx, 1, 6, 12, 1, '#7a5638');
    R(ctx, 3, 2, 1, 9, '#8b9bb4'); R(ctx, 10, 2, 1, 9, '#8b9bb4'); R(ctx, 6, 5, 2, 3, '#e8c867');
    outline(ctx, 0, 0, 14, 12, '#1b1622');
  });
  chest('ev_chest', false); chest('ev_chest_open', true);
  // Festival süsleri: renkli bayrak dizisi (48x10) ve fener (6x9)
  addCanvas(scene, 'ev_bunting', 48, 10, (ctx) => {
    const cols = ['#e43b44', '#fee761', '#3f8a46', '#5b88c8', '#f77622', '#b55088'];
    for (let x = 0; x < 48; x++) R(ctx, x, 1 + Math.round(Math.sin((x / 47) * Math.PI) * 2), 1, 1, '#3e2731');
    for (let i = 0; i < 7; i++) {
      const x = 2 + i * 6.5, y = 2 + Math.round(Math.sin(((x + 2) / 47) * Math.PI) * 2);
      for (let k = 0; k < 4; k++) R(ctx, x + k * 0.5, y + k, 4 - k, 1, cols[i % cols.length]);
    }
  });
  addCanvas(scene, 'ev_lantern', 6, 9, (ctx) => { R(ctx, 2, 0, 2, 1, '#3e2731'); R(ctx, 1, 1, 4, 6, '#e43b44'); R(ctx, 2, 2, 2, 4, '#ffd166'); R(ctx, 1, 7, 4, 1, '#3e2731'); R(ctx, 2, 8, 2, 1, '#fee761'); });
}

// ---------- Yardımcılar ----------
const S = (scene) => scene.mapEvents;
const shelterXY = () => ({ x: SHELTER_TILE.x * TILE + 32, y: SHELTER_TILE.y * TILE + 28 });
const dist = (a, b, c, d) => Phaser.Math.Distance.Between(a, b, c, d);

function dirOf(x, y) {
  const c = shelterXY();
  const a = Math.atan2(y - c.y, x - c.x);
  return DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

// Boş çim karesi: orman/kasaba/tarla/göl/yol dışı, fizik gövdesi yok. size: kare yarıçapı (0 = tek kare)
function freeTile(scene, tx, ty, size = 0, allowTown = false) {
  for (let dy = -size; dy <= size; dy++) for (let dx = -size; dx <= size; dx++) {
    const x = tx + dx, y = ty + dy;
    if (inForest(x, y) || x < 3 || y < 3 || x > MAP_W - 4 || y > MAP_H - 4) return false;
    if (!allowTown && x >= TOWN.x0 && y >= TOWN.y0 && x <= TOWN.x1 && y <= TOWN.y1) return false;
    if (scene.farm?.get(x, y)) return false;
    const t = scene.layer?.getTileAt(x, y);
    if (!t || t.index > 2) return false;
  }
  if (scene.lakeRect && Phaser.Geom.Rectangle.Overlaps(scene.lakeRect, new Phaser.Geom.Rectangle((tx - size) * TILE - 8, (ty - size) * TILE - 8, (size * 2 + 1) * TILE + 16, (size * 2 + 1) * TILE + 16))) return false;
  const w = (size * 2 + 1) * TILE;
  return scene.physics.overlapRect((tx - size) * TILE + 1, (ty - size) * TILE + 1, w - 2, w - 2, true, true).length === 0;
}

// Rastgele uygun kare. o: { minPlayer, minShelter, maxShelter, size, region:{x0,x1,y0,y1}, near:(tx,ty)=>bool, allowTown }
function pickSpot(scene, o = {}) {
  const sh = shelterXY();
  const players = scene.allPlayers ? scene.allPlayers() : [scene.player];
  const rg = o.region || { x0: 3, x1: MAP_W - 4, y0: 3, y1: MAP_H - 4 };
  for (let i = 0; i < 500; i++) {
    const tx = Phaser.Math.Between(rg.x0, rg.x1), ty = Phaser.Math.Between(rg.y0, rg.y1);
    const x = tx * TILE + 8, y = ty * TILE + 8;
    if (players.some((p) => p && dist(p.x, p.y, x, y) < (o.minPlayer ?? 120))) continue;
    const ds = dist(sh.x, sh.y, x, y);
    if (ds < (o.minShelter ?? 0) || ds > (o.maxShelter ?? Infinity)) continue;
    if (o.near && !o.near(tx, ty)) continue;
    if (freeTile(scene, tx, ty, o.size || 0, o.allowTown)) return { tx, ty, x, y };
  }
  return null;
}

const hasPickaxe = (scene) => scene.inventory.slots.some((s) => s && /pickaxe/.test(s.id));
const loot = (scene, list) => {
  const got = [];
  list.forEach(([id, n]) => { if (ITEMS[id] && n > 0) { scene.giveItem(id, n); got.push(`${n}× ${ITEMS[id].name}`); } });
  scene.hud.refreshInventory?.();
  return got;
};

// ================= Gezgin tüccar =================
function rollStock(scene) {
  const seeds = Object.keys(ITEMS).filter((id) => id.startsWith('seed_') && !['seed_wheat', 'seed_carrot', 'seed_pumpkin'].includes(id));
  const pool = [
    { id: 'shotgun', qty: 1, price: 190 }, { id: 'bow', qty: 1, price: 85 }, { id: 'spear', qty: 1, price: 70 },
    { id: 'rare_core', qty: 1, price: 75 }, { id: 'fertilizer', qty: 5, price: 35 }, { id: 'sprinkler', qty: 1, price: 80 },
    { id: 'pumpkin_bomb', qty: 2, price: 45 }, { id: 'fishing_rod', qty: 1, price: 35 }, { id: 'arrow', qty: 20, price: 22 },
    { id: 'turret', qty: 1, price: 95 }, { id: 'meteor_ore', qty: 1, price: 70 }, { id: 'soup', qty: 2, price: 70 },
    ...Phaser.Utils.Array.Shuffle(seeds.slice()).slice(0, 2).map((id) => ({ id, qty: 5, price: 40 }))
  ].filter((o) => ITEMS[o.id]);
  return Phaser.Utils.Array.Shuffle(pool).slice(0, 5);
}

function startTrader(scene, restore) {
  const st = S(scene);
  const spot = restore ? { x: restore.x, y: restore.y } : pickSpot(scene, { minShelter: 150, maxShelter: 430, size: 1, minPlayer: 100 });
  if (!spot) return false;
  const stock = Array.isArray(restore?.stock) ? restore.stock.filter((o) => o && ITEMS[o.id] && o.price > 0) : rollStock(scene);
  SHOPS.traveler = stock;
  const camp = scene.add.image(spot.x, spot.y, 'ev_camp').setDepth(spot.y + 10);
  const man = scene.add.image(spot.x + 18, spot.y + 4, 'ev_trader', 0).setDepth(spot.y + 12);
  scene.tweens.add({ targets: man, y: man.y - 1, duration: 600, yoyo: true, repeat: -1 });
  st.active = { type: 'trader', x: spot.x, y: spot.y, tx: man.x, ty: man.y, stock, objs: [camp, man] };
  if (!restore) {
    [camp, man].forEach((o) => { o.setAlpha(0); scene.tweens.add({ targets: o, alpha: 1, duration: 800 }); });
    scene.hud.toast(`🐪 Gezgin bir tüccar ${dirOf(spot.x, spot.y)[2].toLocaleLowerCase('tr')} kamp kurdu! Nadir eşyalar satıyor (saat ${TRADER_LEAVES}:00'e kadar).`, 'info');
    audio.sfx('coin');
  }
  return true;
}

// ================= Yaralı yabancı (işaret fişeği) =================
function survivorRoom(scene) {
  const surv = (scene.npcs || []).filter((n) => n.key === 'survivor');
  const adults = surv.filter((n) => !n.child).length;
  return scene.settlement && adults + (scene.settlement.strays?.() || 0) < MAX_SURVIVORS && surv.length < 10;
}

function startSurvivor(scene, restore) {
  const st = S(scene);
  let n = null, spot;
  if (restore) {
    n = (scene.outsiders || []).find((o) => o.npcName === restore.name);
    if (!n) return false;
    spot = { x: restore.x, y: restore.y };
  } else {
    if (!survivorRoom(scene)) return false;
    spot = pickSpot(scene, { minShelter: 220, minPlayer: 160 });
    if (!spot) return false;
    const all = [...(scene.npcs || []), ...(scene.outsiders || [])];
    const taken = new Set(all.map((o) => o.npcName));
    const slots = new Set(all.filter((o) => o.key === 'survivor').map((o) => o.slot));
    let slot = 0; while (slots.has(slot) && slot < 9) slot++;
    const name = Phaser.Utils.Array.GetRandom(NAMES.filter((x) => !taken.has(x))) || 'Yabancı';
    n = new Survivor(scene, spot.x, spot.y, { name, variant: Phaser.Math.Between(0, 2), job: null, arrived: scene.timeSys.day, slot });
    const rec = scene.settlement.strand(n, { tile: [spot.tx, spot.ty], mode: 'rescue' });
    if (rec) rec.ask = 'Yaralıyım… fişeğimi gördüğüne sevindim! Etrafımdaki zombileri temizle, köyüne gelip çalışırım.';
  }
  const flare = scene.add.image(spot.x + 12, spot.y + 2, 'ev_flare').setDepth(spot.y + 8);
  st.active = { type: 'survivor', x: spot.x, y: spot.y, name: n.npcName, npc: n, objs: [flare], smokeT: 0 };
  if (!restore) {
    scene.hud.toast(`🧨 ${dirOf(spot.x, spot.y)[2]} kırmızı bir işaret fişeği yükseliyor! Yaralı ${n.npcName} yardım bekliyor.`, 'warn');
    audio.sfx('whoosh');
    // Gökyüzüne yükselen fişek
    const spark = scene.add.image(spot.x + 12, spot.y, 'ev_fireball').setScale(0.5).setDepth(9500);
    scene.tweens.add({ targets: spark, y: spot.y - 90, alpha: 0.2, duration: 1400, ease: 'Quad.easeOut', onComplete: () => spark.destroy() });
  }
  return true;
}

function puff(scene, x, y, color = 0xd04a48) {
  const c = scene.add.circle(x + Phaser.Math.Between(-1, 1), y, Phaser.Math.Between(2, 3), color, 0.55).setDepth(y + 40);
  scene.tweens.add({ targets: c, y: y - Phaser.Math.Between(26, 40), x: c.x + Phaser.Math.Between(-6, 6), scale: 2.4, alpha: 0, duration: 1800, onComplete: () => c.destroy() });
}

// ================= Göktaşı =================
function startMeteor(scene) {
  const st = S(scene);
  if (st.meteor) return false;
  const spot = pickSpot(scene, { minShelter: 120, minPlayer: 90, size: 1 });
  if (!spot) return false;
  const { x, y } = spot;
  st.active = { type: 'meteor', x, y, objs: [] };
  scene.hud.toast(`☄️ Gökyüzünde parlayan bir şey var… ${dirOf(x, y)[1].toLocaleLowerCase('tr')} düşüyor!`, 'warn');
  audio.sfx('whoosh');
  scene.time.delayedCall(1800, () => {
    if (!scene.sys.isActive() || S(scene) !== st) return;
    const ball = scene.add.image(x - 160, y - 220, 'ev_fireball').setDepth(9600).setScale(1.4);
    const trail = scene.time.addEvent({ delay: 40, loop: true, callback: () => {
      const r = scene.add.rectangle(ball.x, ball.y, 3, 3, Phaser.Utils.Array.GetRandom([0xff9a3a, 0xffe08a, 0xffffff]), 0.9).setDepth(9590);
      scene.tweens.add({ targets: r, alpha: 0, scale: 0.3, duration: 450, onComplete: () => r.destroy() });
    } });
    scene.tweens.add({ targets: ball, x, y, duration: 1300, ease: 'Quad.easeIn', onComplete: () => {
      trail.remove();
      ball.destroy();
      placeMeteor(scene, x, y, METEOR_HITS, true);
      if (st.active?.type === 'meteor') st.active = null;
    } });
  });
  return true;
}

function placeMeteor(scene, x, y, hits, impact) {
  const st = S(scene);
  const img = st.solids.create(x, y, 'ev_meteor');
  img.body.setSize(16, 8).setOffset(2, 7);
  img.setDepth(y + 8);
  st.meteor = { x, y, hits, img };
  if (!impact) return;
  scene.spawnParticles(x, y + 4, 0x7fe3ff, 14);
  scene.spawnParticles(x, y + 4, 0x5e3a2e, 10);
  const ring = scene.add.circle(x, y + 4, 6, 0xffe08a, 0).setStrokeStyle(2, 0xffe08a, 0.9).setDepth(9400);
  scene.tweens.add({ targets: ring, scale: 5, alpha: 0, duration: 600, onComplete: () => ring.destroy() });
  audio.sfx('explode');
  if (scene.shakeAt) scene.shakeAt(x, y, 220, 260, 0.008); // çok oyunculu: yakındaki her oyuncunun ekranı
  else if (Phaser.Geom.Rectangle.Contains(scene.cameras.main.worldView, x, y)) scene.cameras.main.shake(260, 0.008);
  scene.hud.toast('☄️ Göktaşı yere çakıldı! Kazmayla kırarsan nadir malzeme çıkar.', 'info');
}

function mineMeteor(scene) {
  const st = S(scene), m = st.meteor, p = scene.player;
  if (!m || p.actionCd > 0) return;
  if (!hasPickaxe(scene)) { audio.sfx('error'); scene.hud.toast('Göktaşını kırmak için kazma gerekli.', 'warn'); return; }
  if (!p.useEnergy(2)) return;
  p.actionCd = 0.35;
  m.hits--;
  audio.sfx('mine');
  scene.spawnParticles(m.x, m.y + 2, 0x7fe3ff, 5);
  scene.tweens.add({ targets: m.img, x: m.x + 1, duration: 40, yoyo: true, repeat: 1 });
  if (m.hits > 0) return;
  const list = [['stone', Phaser.Math.Between(8, 12)], ['meteor_ore', Phaser.Math.Between(1, 2) + (Math.random() < 0.3 ? 1 : 0)]];
  if (Math.random() < 0.25) list.push(['rare_core', 1]);
  const got = loot(scene, list);
  scene.hud.toast(`☄️ Göktaşı parçalandı: ${got.join(', ')}`, 'ok');
  scene.floatText(m.x, m.y - 10, `+${ITEMS.meteor_ore.name}`, '#7fe3ff');
  audio.sfx('break');
  m.img.destroy();
  st.meteor = null;
  scene.events.emit('meteorMined', list);
}

// ================= Zombi yuvası =================
function startNest(scene) {
  const st = S(scene);
  if (st.nest) return false;
  // Orman kıyısına yakın, sığınaktan uzak
  const e = 9;
  const spot = pickSpot(scene, { minShelter: 230, minPlayer: 140, size: 1, near: (tx, ty) => tx < e || ty < e || tx > MAP_W - 1 - e || ty > MAP_H - 1 - e });
  if (!spot) return false;
  placeNest(scene, spot.x, spot.y, NEST_HP, true);
  st.active = null; // yuva büyük olay kuyruğunu kilitlemez; yok edilene kadar haritada kalır
  return true;
}

function placeNest(scene, x, y, hp, announce) {
  const st = S(scene);
  const img = st.solids.create(x, y, 'ev_nest');
  img.body.setSize(18, 8).setOffset(3, 8);
  img.setDepth(y + 8);
  img.isNest = true;
  st.nest = { x, y, hp, img, spawned: 0, t: 4 };
  if (announce) {
    img.setAlpha(0);
    scene.tweens.add({ targets: img, alpha: 1, duration: 900 });
    scene.spawnParticles(x, y, 0x5e3a2e, 10);
    scene.hud.toast(`🕳️ ${dirOf(x, y)[2]} bir zombi yuvası belirdi! Gece olmadan yok et, yoksa oradan zombi çıkar.`, 'warn');
    audio.sfx('groan');
  }
}

function damageNest(scene, n) {
  const st = S(scene), nest = st.nest;
  if (!nest || n <= 0) return;
  nest.hp -= n;
  nest.img.setTintFill(0xffffff);
  scene.time.delayedCall(80, () => nest.img.active && nest.img.clearTint());
  scene.spawnParticles(nest.x, nest.y, 0x7a4e36, 4);
  audio.sfx('hit');
  if (nest.hp > 0) return;
  const list = [['ammo', Phaser.Math.Between(8, 12)], ['scrap', Phaser.Math.Between(3, 5)]];
  if (Math.random() < 0.35) list.push(['rare_core', 1]);
  if (Math.random() < 0.15) list.push(['relic', 1]);
  const coins = Phaser.Math.Between(25, 50);
  scene.player.addCoins(coins);
  const got = loot(scene, list);
  scene.hud.toast(`🕳️ Zombi yuvası yok edildi! +${coins} 🪙${got.length ? `, ${got.join(', ')}` : ''}`, 'ok');
  scene.floatText(nest.x, nest.y - 10, `+${coins}🪙`, '#ffd166');
  scene.spawnParticles(nest.x, nest.y, 0x8fe04a, 12);
  audio.sfx('break');
  nest.img.destroy();
  st.nest = null;
  scene.events.emit('nestDestroyed');
}

function hitNestByHand(scene) {
  const p = scene.player;
  if (p.actionCd > 0) return;
  const slot = scene.inventory.slots[scene.selected];
  const it = slot ? ITEMS[slot.id] : null;
  const dmg = it && (it.type === 'weapon' || /axe|pickaxe|hammer/.test(slot.id)) ? Math.max(2, it.dmg || 2) : 1;
  p.actionCd = 0.35;
  p.energy = Math.max(0, p.energy - 1);
  audio.sfx('swing');
  damageNest(scene, dmg);
}

// Gece: dalga doğumu sürerken yuvadan ara ara zombi çıkar
function updateNest(scene, dt) {
  const st = S(scene), nest = st.nest, w = scene.waves;
  if (!nest || !w.active) return;
  const max = Math.min(8, 3 + Math.floor(w.wave / 2));
  if (nest.spawned >= max || (!w.queue.length && !w.pending.length)) return;
  nest.t -= dt;
  if (nest.t > 0) return;
  nest.t = Phaser.Math.FloatBetween(7, 10);
  const n = Math.min(max - nest.spawned, w.wave >= 5 ? 2 : 1);
  for (let i = 0; i < n; i++) {
    const kind = w.wave >= 4 && Math.random() < 0.25 ? 'runner' : 'normal';
    scene.spawnZombie(nest.x + Phaser.Math.Between(-10, 10), nest.y + 10 + Phaser.Math.Between(0, 6), kind);
    nest.spawned++;
  }
  scene.spawnParticles(nest.x, nest.y, 0x8fe04a, 6);
  if (nest.spawned <= n) scene.hud.toast(`🕳️ Yok edilmeyen yuvadan zombiler çıkıyor (${dirOf(nest.x, nest.y)[0].toLocaleLowerCase('tr')})!`, 'warn');
}

// ================= Hasat festivali =================
const origSell = new Map();
function cropItemIds() {
  const ids = new Set();
  Object.values(CROPS).forEach((c) => ['', '_s', '_g'].forEach((sfx) => { if (ITEMS[c.item + sfx]) ids.add(c.item + sfx); }));
  return [...ids];
}
function boostPrices(on) {
  if (on) {
    cropItemIds().forEach((id) => {
      if (!ITEMS[id].sell || origSell.has(id)) return;
      origSell.set(id, ITEMS[id].sell);
      ITEMS[id].sell = Math.round(ITEMS[id].sell * FESTIVAL_SELL);
    });
  } else {
    origSell.forEach((v, id) => { if (ITEMS[id]) ITEMS[id].sell = v; });
    origSell.clear();
  }
}

function startFestival(scene, restore) {
  const st = S(scene);
  st.active = { type: 'festival', objs: [] };
  boostPrices(true);
  // Bereket: tüm tarla sulanır
  let watered = 0;
  for (const p of scene.farm.plots.values()) if (!p.watered && scene.farm.water(p.tx, p.ty)) watered++;
  // Meydan süsleri: bayrak dizileri ve fenerler
  const x0 = SQUARE.x0 * TILE, x1 = (SQUARE.x1 + 1) * TILE, y0 = SQUARE.y0 * TILE, y1 = (SQUARE.y1 + 1) * TILE;
  for (let x = x0 + 24; x < x1 - 8; x += 50) {
    st.active.objs.push(scene.add.image(x, y0 - 4, 'ev_bunting').setDepth(y0 + 30));
    st.active.objs.push(scene.add.image(x + 6, y1 + 6, 'ev_bunting').setDepth(y1 + 30).setFlipX(true));
  }
  const lanterns = [[x0 + 4, y0 + 2], [x1 - 4, y0 + 2], [x0 + 4, y1 - 2], [x1 - 4, y1 - 2]];
  lanterns.forEach(([x, y]) => {
    const l = scene.add.image(x, y, 'ev_lantern').setDepth(y + 20);
    scene.tweens.add({ targets: l, angle: { from: -6, to: 6 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    st.active.objs.push(l);
  });
  st.active.lights = lanterns.map(([x, y]) => ({ x, y, r: 40 }));
  st.active.confT = 0;
  st.festDay = scene.timeSys.day;
  if (!restore) {
    scene.hud.banner('🎉 Hasat Festivali', 'Bugün hasat 2 kat! Tüccarlar ekinlere %50 fazla ödüyor.');
    scene.hud.toast(`🎉 Köy meydanında festival var! Bereket yağmuru: ${watered} tarla karesi sulandı.`, 'ok');
    audio.sfx('drum');
  }
  return true;
}

function confetti(scene) {
  const x = Phaser.Math.Between(SQUARE.x0, SQUARE.x1) * TILE + 8, y = SQUARE.y0 * TILE + Phaser.Math.Between(0, 40);
  const cols = [0xe43b44, 0xfee761, 0x5b88c8, 0x3f8a46, 0xf77622, 0xb55088];
  for (let i = 0; i < 8; i++) {
    const r = scene.add.rectangle(x, y, 2, 2, Phaser.Utils.Array.GetRandom(cols)).setDepth(9400);
    scene.tweens.add({ targets: r, x: x + Phaser.Math.Between(-18, 18), y: y + Phaser.Math.Between(10, 30), angle: 180, alpha: 0, duration: Phaser.Math.Between(700, 1200), onComplete: () => r.destroy() });
  }
}

// ================= Sisli gece =================
function startFog(scene) {
  const st = S(scene);
  if (!scene.setWeather) return false;
  scene.setWeather('fog', true);
  st.active = { type: 'fog', objs: [] };
  scene.hud.toast('🌫️ Sisli Gece: ormandan yoğun bir sis çöktü. Görüş kısa, zombiler seni ancak yakından fark eder. Şafağa kadar dayanırsan ödül var.', 'warn');
  return true;
}

// ================= Ganimet sandıkları =================
function spawnChest(scene, at) {
  const st = S(scene);
  if (st.chests.length >= MAX_CHESTS && !at) return null;
  let spot = at;
  if (!spot) {
    const rz = RUINS_ZONE, edge = 6;
    const ruins = Math.random() < 0.45;
    const taken = (tx, ty) => st.chests.some((c) => Math.abs(c.x - (tx * TILE + 8)) < 48 && Math.abs(c.y - (ty * TILE + 8)) < 48);
    spot = ruins
      ? pickSpot(scene, { region: { x0: rz.x - 4, x1: rz.x + rz.w + 3, y0: rz.y - 4, y1: rz.y + rz.h + 3 }, allowTown: true, minPlayer: 60,
        near: (tx, ty) => !(tx >= rz.x - 1 && ty >= rz.y - 1 && tx <= rz.x + rz.w && ty <= rz.y + rz.h) && !taken(tx, ty) })
      : pickSpot(scene, { minPlayer: 100, minShelter: 180, near: (tx, ty) => (tx < edge || ty < edge || tx > MAP_W - 1 - edge || ty > MAP_H - 1 - edge || nearTrees(scene, tx, ty)) && !taken(tx, ty) });
    if (!spot) return null;
  }
  const img = scene.add.image(spot.x, spot.y, 'ev_chest').setDepth(spot.y + 6);
  const c = { x: spot.x, y: spot.y, img, opened: false };
  st.chests.push(c);
  return c;
}

// Kare çevresinde en az 3 ağaç var mı (ormanlık alan)
function nearTrees(scene, tx, ty) {
  const x = tx * TILE + 8, y = ty * TILE + 8;
  let n = 0;
  for (const r of scene.resources.getChildren()) if (r.kind === 'tree' && Math.abs(r.x - x) < 56 && Math.abs(r.y - y) < 56 && ++n >= 3) return true;
  return false;
}

function openChest(scene, c) {
  const st = S(scene);
  if (c.opened) return;
  c.opened = true;
  c.img.setTexture('ev_chest_open');
  const seed = Phaser.Utils.Array.GetRandom(['seed_wheat', 'seed_carrot', 'seed_pumpkin'].filter((id) => ITEMS[id]));
  const table = [['wood', 3, 6], ['stone', 3, 6], ['ammo', 5, 10], ['bread', 1, 1], ['arrow', 5, 10], [seed, 2, 4], ['hide', 1, 2], ['scrap', 2, 4], ['berry', 2, 3]]
    .filter(([id]) => id && ITEMS[id]);
  const list = Phaser.Utils.Array.Shuffle(table).slice(0, 2).map(([id, a, b]) => [id, Phaser.Math.Between(a, b)]);
  let rare = null;
  if (Math.random() < 0.08) {
    rare = Phaser.Utils.Array.GetRandom(['relic', 'meteor_ore', 'rare_core'].filter((id) => ITEMS[id]));
    list.push([rare, 1]);
  }
  const coins = Phaser.Math.Between(8, 25);
  scene.player.addCoins(coins);
  const got = loot(scene, list);
  scene.hud.toast(`${rare ? '✨ Nadir ganimet! ' : '🧰 '}Sandıktan: ${got.join(', ')}, +${coins} 🪙`, rare ? 'ok' : 'info');
  scene.floatText(c.x, c.y - 10, `+${coins}🪙`, '#ffd166');
  scene.spawnParticles(c.x, c.y, rare ? 0x7fe3ff : 0xe8c867, rare ? 14 : 8);
  audio.sfx(rare ? 'achievement' : 'coin');
  scene.events.emit('lootChestOpened', { items: list, rare });
  scene.time.delayedCall(1500, () => {
    const i = st.chests.indexOf(c);
    if (i >= 0) st.chests.splice(i, 1);
    if (c.img.active) scene.tweens.add({ targets: c.img, alpha: 0, duration: 500, onComplete: () => c.img.destroy() });
  });
}

function clearChests(scene) {
  const st = S(scene);
  st.chests.forEach((c) => c.img?.destroy());
  st.chests.length = 0;
}

// ================= Olay yönetimi =================
const STARTERS = { trader: startTrader, survivor: startSurvivor, meteor: startMeteor, nest: startNest, festival: startFestival, fog: startFog };

function endActive(scene, quiet) {
  const st = S(scene), a = st.active;
  if (!a) return;
  st.active = null;
  if (a.type === 'festival') boostPrices(false);
  if (a.type === 'trader') delete SHOPS.traveler;
  (a.objs || []).forEach((o) => {
    if (!o?.active) return;
    if (quiet) o.destroy();
    else scene.tweens.add({ targets: o, alpha: 0, duration: 700, onComplete: () => o.destroy() });
  });
  if (quiet) return;
  if (a.type === 'trader') scene.hud.toast('🐪 Gezgin tüccar kampını toplayıp yoluna devam etti.', 'info');
  if (a.type === 'festival') scene.hud.toast('🎉 Festival sona erdi. Fiyatlar normale döndü.', 'info');
}

function trigger(scene, type) {
  const st = S(scene);
  const fn = STARTERS[type];
  if (!fn) return false;
  if (st.active && type !== 'nest') endActive(scene, true);
  const ok = !!fn(scene);
  if (ok) { st.lastType = type; scene.events.emit('mapEvent', type); }
  return ok;
}

function pickWeighted(list) {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [id, w] of list) if ((r -= w) < 0) return id;
  return null;
}

function rollDayEvent(scene) {
  const st = S(scene), day = scene.timeSys.day;
  const opts = [
    ['trader', 3],
    ['survivor', survivorRoom(scene) ? 2 : 0],
    ['meteor', st.meteor ? 0 : 2],
    ['nest', !st.nest && day >= 3 ? 2 : 0],
    ['festival', scene.farm.plots.size >= 4 && st.festDay < day - 2 ? 2 : 0]
  ].filter(([id, w]) => w > 0 && id !== st.lastType);
  return pickWeighted(opts);
}

function planDay(scene) {
  const st = S(scene), ts = scene.timeSys;
  st.plan = null;
  if (ts.day < 2 || Math.random() >= DAY_EVENT_CHANCE) return;
  st.plan = { day: ts.day, hour: Phaser.Math.Between(DAY_EVENT_HOURS[0], DAY_EVENT_HOURS[1]) };
}

function onHour(scene, h) {
  const st = S(scene), ts = scene.timeSys;
  if (st.active?.type === 'trader' && h >= TRADER_LEAVES) endActive(scene);
  if (ts.isNight || !st.plan || st.plan.day !== ts.day || h < st.plan.hour) return;
  if (st.active) { st.plan.hour = h + 1; if (st.plan.hour > 15) st.plan = null; return; }
  const type = rollDayEvent(scene);
  st.plan = null;
  if (type) trigger(scene, type);
}

function onDusk(scene) {
  const st = S(scene);
  if (st.active && st.active.type !== 'meteor') endActive(scene);
  if (st.nest) scene.time.delayedCall(2500, () => st.nest && scene.hud?.toast('🕳️ Zombi yuvası kıpırdanıyor… bu gece oradan da zombi gelecek!', 'warn'));
  if (Math.random() >= NIGHT_EVENT_CHANCE || scene.timeSys.day < 2) return;
  const fogOk = scene.setWeather && scene.weather === 'clear' && !scene.waves.bloodMoon;
  const type = pickWeighted([['fog', fogOk ? 3 : 0], ['meteor', st.meteor ? 0 : 2]].filter(([, w]) => w > 0));
  if (type) scene.time.delayedCall(type === 'fog' ? 1500 : Phaser.Math.Between(9000, 20000), () => {
    if (S(scene) === st && scene.timeSys.isNight && !st.active) trigger(scene, type);
  });
}

function onDawn(scene) {
  const st = S(scene);
  if (st.active?.type === 'fog') {
    st.active = null;
    const coins = 20 + Math.min(40, scene.waves.wave * 3);
    scene.player.addCoins(coins);
    scene.time.delayedCall(2600, () => scene.hud?.toast(`🌫️ Sisli geceyi atlattın: +${coins} 🪙`, 'ok'));
  } else if (st.active) endActive(scene, true);
  if (st.nest) { st.nest.spawned = 0; st.nest.t = 4; }
  const add = Phaser.Math.Between(1, 2);
  for (let i = 0; i < add; i++) spawnChest(scene);
  planDay(scene);
}

// ---------- Modül ----------
export default {
  id: 'events',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    boostPrices(false);
    const st = scene.mapEvents = {
      active: null, plan: null, lastType: null, festDay: -9, meteor: null, nest: null, chests: [], pending: null,
      solids: scene.physics.add.staticGroup(),
      trigger: (type) => trigger(scene, type),
      spawnChest: (at) => spawnChest(scene, at),
      end: () => endActive(scene, true)
    };
    scene.events.once('shutdown', () => boostPrices(false));

    // Orman sınırı: yalnızca oyuncu durur (zombi/hayvan ormandan geçip gelir)
    if (scene.forestEdge?.group) scene.physics.add.collider(scene.player, scene.forestEdge.group);
    scene.physics.add.collider(scene.player, st.solids);

    // Hasat festivali: hasat 2 kat (Farm örneği sarmalanır; NPC hasatları da dahil)
    const farm = scene.farm, origHarvest = farm.harvest.bind(farm);
    farm.harvest = (...a) => {
      const r = origHarvest(...a);
      if (r && S(scene)?.active?.type === 'festival') r.qty *= 2;
      return r;
    };

    // Mermiler yuvayı da vurur
    const shotHit = (a, b) => {
      const [shot, nest] = a.isNest ? [b, a] : [a, b];
      if (!shot.active || !nest.isNest) return;
      damageNest(scene, shot.dmg || 1);
      shot.destroy();
    };
    scene.physics.add.overlap(scene.bullets, st.solids, shotHit);
    if (scene.shotGroup) scene.physics.add.overlap(scene.shotGroup, st.solids, shotHit);

    // Etkileşimler
    scene.addInteraction((s) => {
      const e = S(s), p = s.player;
      if (!e) return null;
      let best = null;
      const offer = (d, label, run) => { if (!best || d < best.dist) best = { dist: d, label, run }; };
      const a = e.active;
      if (a?.type === 'trader') {
        const d = dist(p.x, p.y, a.tx, a.ty);
        if (d < 28) offer(d, 'Gezgin tüccarla ticaret', () => { audio.sfx('click'); s.hud.openShop({ ...TRADER }); });
      }
      if (e.meteor) {
        const d = dist(p.x, p.y, e.meteor.x, e.meteor.y);
        if (d < 26) offer(d, hasPickaxe(s) ? 'Göktaşını kaz' : 'Göktaşı (kazma gerekli)', () => mineMeteor(s));
      }
      if (e.nest) {
        const d = dist(p.x, p.y, e.nest.x, e.nest.y);
        if (d < 28) offer(d, `Yuvayı boz (${Math.max(0, Math.ceil(e.nest.hp))})`, () => hitNestByHand(s));
      }
      for (const c of e.chests) {
        if (c.opened) continue;
        const d = dist(p.x, p.y, c.x, c.y);
        if (d < 22) offer(d, 'Ganimet sandığını aç', () => openChest(s, c));
      }
      return best;
    });

    scene.minimapDots = scene.minimapDots || [];
    scene.minimapDots.push((s) => {
      const e = S(s), out = [];
      if (!e) return out;
      const a = e.active;
      if (a?.type === 'trader') out.push({ x: a.x, y: a.y, color: '#c78cff', r: 2 });
      if (a?.type === 'survivor') out.push({ x: a.x, y: a.y, color: '#ff5f5f', r: 2 });
      if (e.meteor) out.push({ x: e.meteor.x, y: e.meteor.y, color: '#7fe3ff', r: 2 });
      if (e.nest) out.push({ x: e.nest.x, y: e.nest.y, color: '#8fe04a', r: 2 });
      e.chests.forEach((c) => { if (!c.opened) out.push({ x: c.x, y: c.y, color: '#e0b060', r: 1 }); });
      return out;
    });

    scene.lightSources.push((s) => {
      const e = S(s), out = [];
      if (!e) return out;
      if (e.meteor) out.push({ x: e.meteor.x, y: e.meteor.y, r: 30 });
      if (e.nest) out.push({ x: e.nest.x, y: e.nest.y, r: 18 });
      if (e.active?.lights) out.push(...e.active.lights);
      return out;
    });

    const ts = scene.timeSys;
    ts.on('hour', (h) => S(scene) === st && onHour(scene, h));
    ts.on('dusk', () => S(scene) === st && onDusk(scene));
    ts.on('dawn', () => S(scene) === st && onDawn(scene));
  },

  begin(scene, isNew) {
    const st = S(scene);
    // Eski kayıttan oyuncu orman şeridinde kaldıysa içeri al
    const pr = scene.forestEdge?.playable, p = scene.player;
    if (pr && p) p.setPosition(Phaser.Math.Clamp(p.x, pr.x + 6, pr.right - 6), Phaser.Math.Clamp(p.y, pr.y + 2, pr.bottom - 10));

    endActive(scene, true);
    clearChests(scene);
    st.meteor?.img?.destroy(); st.meteor = null;
    st.nest?.img?.destroy(); st.nest = null;
    const d = isNew ? null : st.pending;
    st.pending = null;
    const ts = scene.timeSys;
    if (!d) {
      for (let i = 0; i < 3; i++) spawnChest(scene);
      if (!isNew) planDay(scene); // olay verisi olmayan eski kayıt
      return;
    }
    st.lastType = typeof d.lastType === 'string' ? d.lastType : null;
    st.festDay = Number(d.festDay) || -9;
    st.plan = d.plan && d.plan.day === ts.day && Number.isFinite(d.plan.hour) ? { day: d.plan.day, hour: d.plan.hour } : null;
    const ok = (o) => o && Number.isFinite(o.x) && Number.isFinite(o.y);
    if (ok(d.meteor)) placeMeteor(scene, d.meteor.x, d.meteor.y, Phaser.Math.Clamp(d.meteor.hits | 0, 1, METEOR_HITS), false);
    if (ok(d.nest)) placeNest(scene, d.nest.x, d.nest.y, Phaser.Math.Clamp(Number(d.nest.hp) || NEST_HP, 1, NEST_HP), false);
    (Array.isArray(d.chests) ? d.chests : []).slice(0, MAX_CHESTS).forEach((c) => {
      if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) spawnChest(scene, { x: c[0], y: c[1] });
    });
    // Aktif olay: yalnızca gündüz ve süresi dolmamışsa geri kurulur (aksi hâlde güvenle iptal)
    const a = d.active;
    if (a && !ts.isNight) {
      try {
        if (a.type === 'trader' && ok(a) && ts.hour < TRADER_LEAVES) startTrader(scene, a);
        else if (a.type === 'survivor' && ok(a) && a.name) startSurvivor(scene, a);
        else if (a.type === 'festival' && Number(d.festDay) === ts.day) startFestival(scene, a);
      } catch (e) { console.warn('olay geri yüklenemedi', e); st.active = null; }
    }
  },

  update(scene, dt) {
    const st = S(scene);
    if (!st) return;
    const a = st.active;
    if (a?.type === 'survivor') {
      // Yabancı köye katıldıysa (kuşatma temizlendi) fişek söner
      if (!a.npc?.active || !(scene.outsiders || []).includes(a.npc)) endActive(scene, false);
      else if ((a.smokeT -= dt) <= 0) { a.smokeT = 0.35; puff(scene, a.x + 12, a.y - 2); }
    } else if (a?.type === 'festival') {
      if ((a.confT -= dt) <= 0) {
        a.confT = 1.4;
        const v = scene.cameras.main.worldView;
        if (Phaser.Geom.Rectangle.Overlaps(v, new Phaser.Geom.Rectangle(SQUARE.x0 * TILE, SQUARE.y0 * TILE, (SQUARE.x1 - SQUARE.x0 + 1) * TILE, (SQUARE.y1 - SQUARE.y0 + 1) * TILE))) confetti(scene);
      }
    }
    if (st.nest) updateNest(scene, dt);
    if (st.meteor && Math.random() < dt * 2) {
      const m = st.meteor;
      const r = scene.add.rectangle(m.x + Phaser.Math.Between(-6, 6), m.y + Phaser.Math.Between(-2, 4), 1, 1, 0xb8f3ff).setDepth(m.y + 9);
      scene.tweens.add({ targets: r, y: r.y - 8, alpha: 0, duration: 700, onComplete: () => r.destroy() });
    }
  },

  save(scene) {
    const st = S(scene);
    if (!st) return undefined;
    const a = st.active;
    let active = null;
    if (a?.type === 'trader') active = { type: 'trader', x: Math.round(a.x), y: Math.round(a.y), stock: a.stock.map((o) => ({ id: o.id, qty: o.qty, price: o.price })) };
    else if (a?.type === 'survivor') active = { type: 'survivor', x: Math.round(a.x), y: Math.round(a.y), name: a.name };
    else if (a?.type === 'festival') active = { type: 'festival' };
    return {
      plan: st.plan, lastType: st.lastType, festDay: st.festDay, active,
      meteor: st.meteor ? { x: Math.round(st.meteor.x), y: Math.round(st.meteor.y), hits: st.meteor.hits } : null,
      nest: st.nest ? { x: Math.round(st.nest.x), y: Math.round(st.nest.y), hp: st.nest.hp } : null,
      chests: st.chests.filter((c) => !c.opened).map((c) => [Math.round(c.x), Math.round(c.y)])
    };
  },

  load(scene, d) {
    if (!d || typeof d !== 'object') return;
    S(scene).pending = d;
  }
};

