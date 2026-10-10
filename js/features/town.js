// 'town' özellik modülü — kasaba ve NPC ilişkileri.
// Kalp (arkadaşlık) sistemi, hediyeler, kalp ödülleri (indirim/tarif/özel hediye),
// Doktor Selin + Avcı Murat (NPC.js), hayatta kalanlar (işe alınabilir yardımcılar), ilan panosu (günlük görevler).
import { ITEMS, RECIPES, SHOPS, QUESTS } from '../config.js';
import { addCanvas, R, makeHumanoid, basePal, iconURL } from '../textures.js';
import { audio } from '../audio.js';
import { injectCSS, el } from '../ui/dom.js';
import { Survivor, SURVIVOR_JOBS, SURV_NAMES_F, SURV_NAMES_M } from '../entities/NPC.js';

// ---------------- Eşyalar ----------------
function useHeal(scene, ctx) {
  const p = scene.player, item = ITEMS[ctx.slot.id];
  if (p.hp >= p.maxHp) { audio.sfx('error'); scene.hud.notice('Canın zaten dolu'); return; }
  scene.inventory.remove(ctx.slot.id, 1);
  p.restore(item.heal || 0, item.energy || 0);
  p.actionCd = 0.5;
  scene.spawnParticles(p.x, p.y - 4, 0x7dffa0, 8);
  scene.floatText(p.x, p.y - 12, `+${item.heal} ❤`, '#7dffa0');
  audio.sfx('eat');
}

const addItem = (id, def) => { if (!ITEMS[id]) ITEMS[id] = def; };
addItem('bandage', { name: 'Sargı', type: 'food', icon: 'i_bandage', heal: 40, energy: 0, sell: 10, desc: 'Canı 40 yeniler (enerji doluyken de kullanılabilir).', onUse: useHeal });
addItem('medkit', { name: 'İlk Yardım Kiti', type: 'food', icon: 'i_medkit', heal: 100, energy: 20, sell: 35, desc: 'Canı tamamen yeniler.', onUse: useHeal });
addItem('veggie_stew', { name: 'Sebze Güveci', type: 'food', icon: 'i_veggie_stew', heal: 45, energy: 50, sell: 45, desc: 'Ayşe\'nin aile tarifi.' });
addItem('spice_bread', { name: 'Baharatlı Çörek', type: 'food', icon: 'i_spice_bread', heal: 30, energy: 45, sell: 40, desc: 'Kemal\'in gizli tarifi.' });

// Ok varsa (combat modülü) avcı ok satar, yoksa mermi
const arrowId = () => (ITEMS.arrow ? 'arrow' : 'ammo');

// ---------------- Dükkânlar ----------------
SHOPS.doctor = SHOPS.doctor || [
  { id: 'bandage', qty: 1, price: 30 },
  { id: 'bandage', qty: 3, price: 80 },
  { id: 'medkit', qty: 1, price: 90 }
];
SHOPS.hunter = SHOPS.hunter || [];
function syncHunterShop() {
  const list = SHOPS.hunter;
  list.length = 0;
  if (ITEMS.arrow) list.push({ id: 'arrow', qty: 10, price: 20 }, { id: 'arrow', qty: 30, price: 50 });
  else list.push({ id: 'ammo', qty: 10, price: 14 });
  if (ITEMS.bow) list.push({ id: 'bow', qty: 1, price: 150 });
  list.push({ id: 'bandage', qty: 1, price: 35 });
}
syncHunterShop();

// ---------------- Görevler ----------------
const addQuest = (q) => { if (!QUESTS.some((o) => o.id === q.id)) QUESTS.push(q); };
addQuest({ id: 'q_doc_carrot', npc: 'doctor', title: 'Vitamin Kürü', desc: 'Selin\'e 6 havuç getir.', type: 'deliver', item: 'carrot', amount: 6, reward: { coins: 40, items: { bandage: 3 } } });
addQuest({ id: 'q_doc_soup', npc: 'doctor', title: 'Hasta Çorbası', desc: 'Selin\'e 2 balkabağı çorbası getir.', type: 'deliver', item: 'soup', amount: 2, reward: { coins: 80, items: { medkit: 1 } } });
addQuest({ id: 'q_hunt_wood', npc: 'hunter', title: 'Ok Gövdesi', desc: 'Murat\'a 15 odun getir.', type: 'deliver', item: 'wood', amount: 15, reward: { coins: 40, items: { [arrowId()]: 20 } } });
addQuest({ id: 'q_hunt_kill', npc: 'hunter', title: 'Av Mevsimi', desc: '15 zombi öldür.', type: 'kill', amount: 15, reward: { coins: 90 } });

// ---------------- Kalp sistemi verileri ----------------
const PTS_PER_HEART = 100, MAX_PTS = 1000;
const GIFT_PTS = { loved: 80, liked: 45, neutral: 20, disliked: -40 };
const TALK_PTS = 20, QUEST_PTS = 60, BOARD_PTS = 40;

// Listedeki eşya oyunda yoksa (başka modül tanımlamadıysa) arayüzde gösterilmez
const REL = {
  farmer: {
    loved: ['strawberry', 'soup', 'veggie_stew'], liked: ['carrot', 'wheat', 'pumpkin', 'bread', 'egg', 'egg_big', 'milk', 'milk_big', 'berry'], disliked: ['ammo', 'stone', 'rare_core'],
    recipe: () => ({ out: 'veggie_stew', qty: 1, cost: { carrot: 2, wheat: 2 } }), gift: () => ({ items: { seed_pumpkin: 6, soup: 2 } })
  },
  merchant: {
    loved: ['fish_gold', 'cheese', 'pumpkin'], liked: ['bread', 'soup', 'egg', 'egg_big', 'milk', 'milk_big', 'spice_bread', 'fish_bass', 'fish_grilled'], disliked: ['wood', 'stone', 'scrap'],
    recipe: () => ({ out: 'spice_bread', qty: 1, cost: { wheat: 2, carrot: 1 } }), gift: () => ({ coins: 250 })
  },
  blacksmith: {
    loved: ['stone', 'rare_core'], liked: ['wood', 'ammo', 'bread', 'scrap'], disliked: ['carrot', 'seed_wheat', 'seed_carrot', 'strawberry'],
    recipe: () => ({ out: 'ammo', qty: 12, cost: { wood: 2, stone: 2 } }), gift: () => ({ items: { turret: 1 } })
  },
  guard: {
    loved: ['bread', 'arrow'], liked: ['ammo', 'soup', 'spice_bread', 'veggie_stew'], disliked: ['carrot', 'wheat', 'seed_wheat'],
    recipe: () => ({ out: 'turret', qty: 1, cost: { wood: 3, stone: 4, ammo: 6 } }), gift: () => ({ items: { ammo: 40 } })
  },
  doctor: {
    loved: ['veggie_stew', 'carrot', 'strawberry'], liked: ['soup', 'bread', 'milk', 'egg', 'berry', 'mushroom', 'fish_grilled'], disliked: ['ammo', 'pistol', 'rare_core', 'scrap'],
    recipe: () => ({ out: 'medkit', qty: 1, cost: { bandage: 2, carrot: 1 } }), gift: () => ({ items: { medkit: 3 } })
  },
  hunter: {
    loved: ['soup', 'arrow', 'cheese'], liked: ['bread', 'wood', 'carrot', 'spice_bread', 'fish_grilled', 'fish_carp', 'mushroom'], disliked: ['seed_wheat', 'wheat', 'pumpkin'],
    recipe: () => (ITEMS.arrow ? { out: 'arrow', qty: 10, cost: { wood: 2, stone: 1 } } : { out: 'ammo', qty: 8, cost: { wood: 1, stone: 2 } }),
    gift: () => ({ items: { [arrowId()]: 30 } })
  }
};
const REL_KEYS = Object.keys(REL);

const REACT = {
  loved: ['Bu benim en sevdiğim şey! Nereden bildin?', 'Vay! Gerçekten bayıldım, çok teşekkürler!', 'Bunu hiç unutmayacağım!'],
  liked: ['Ne hoş bir hediye, sağ ol!', 'Bunu severim, teşekkürler.', 'Düşünceli davrandın.'],
  neutral: ['Ah… teşekkürler sanırım.', 'Hmm, işe yarar belki.', 'Sağ ol.'],
  disliked: ['Bunu neden verdin ki?', 'Hiç hoşuma gitmedi açıkçası.', 'Eee… bunu geri alsan?']
};

// 4♥ dostluk ödülü: her gece başında NPC'nin verdiği yardım (dostlar savunmaya katkı sağlar)
const HELP_HEARTS = 4;
const NIGHT_HELP = {
  farmer: { desc: 'her gece azık', run: (s) => giveHelp(s, ITEMS.bread ? { bread: 1 } : { carrot: 3 }) },
  merchant: { desc: 'her gece mermi', run: (s) => giveHelp(s, { ammo: 8 }) },
  blacksmith: {
    desc: 'gece başında sığınak onarımı',
    run: (s) => {
      const sh = s.shelter, n = Math.round(sh.maxHp * 0.15);
      if (sh.hp >= sh.maxHp) return null;
      sh.repair(n);
      return `sığınağı ${n} onardı`;
    }
  },
  guard: { desc: 'gece %50 hızlı ateş', run: () => 'seninle omuz omuza, daha hızlı ateş ediyor' },
  doctor: { desc: 'her gece sargı', run: (s) => giveHelp(s, { bandage: 1 }) },
  hunter: { desc: 'gece %50 hızlı ok', run: () => 'nöbette daha hızlı ok atıyor' }
};

function giveHelp(scene, items) {
  const parts = [];
  Object.entries(items).forEach(([id, n]) => { if (ITEMS[id]) { scene.giveItem(id, n); parts.push(`${n}× ${itemName(id)}`); } });
  return parts.length ? `sana ${parts.join(', ')} verdi` : null;
}

// Savaşan dostlar (Demir, Murat) 4♥'de daha hızlı ateş eder — NPC.js friendRate okur
function applyFriendPerks(scene) {
  ['guard', 'hunter'].forEach((key) => {
    const npc = npcByKey(scene, key);
    if (npc) npc.friendRate = heartsOf(scene, key) >= HELP_HEARTS ? 1.5 : 1;
  });
}

function nightHelp(scene) {
  const msgs = [];
  REL_KEYS.forEach((key) => {
    if (heartsOf(scene, key) < HELP_HEARTS) return;
    const npc = npcByKey(scene, key);
    if (!npc) return; // köye katılmamış dost yardım edemez
    const m = NIGHT_HELP[key]?.run(scene);
    if (m && npc) msgs.push(`${npc.npcName} ${m}`);
  });
  if (msgs.length) scene.hud.toast(`♥ Dost yardımı: ${msgs.join(' · ')}`, 'ok');
}

// Hayatta kalan adları cinsiyete göre NPC.js'te (SURV_NAMES_F / SURV_NAMES_M); ana NPC adlarıyla çakışmaz
// MAX_SURVIVORS: gelen yetişkin + işe alım sınırı; MAX_POP: doğumlar dahil toplam hayatta kalan nüfusu
const MAX_SURVIVORS = 4, MAX_POP = 10, HIRE_COST = 100, WAGE = 10;
// Bebek: ilk bebek için bekleme yok (doğum yalnızca şafakta, yani eşleşmeden sonraki ilk şafaktan itibaren);
// sonraki bebekler arasında BABY_GAP gün. Ana NPC'nin eş olabilmesi için oyuncuyla MATE_HEARTS kalp dostluk gerekir.
const BABY_GAP = 4, BABY_CHANCE = 0.4, GROW_DAYS = 3, MATE_HEARTS = 3;
const JOB_IDS = Object.keys(SURVIVOR_JOBS);
// Diyalogda işe alma metinleri
const JOB_THANKS = {
  waterer: 'Teşekkürler! Tarlayı sular, olanı toplayıp kapına getiririm.',
  sentry: 'Teşekkürler! Gece nöbeti bende.',
  lumberjack: 'Teşekkürler! Baltamı kaptım, odunlar yolda.',
  miner: 'Teşekkürler! Kazmamla taş getiririm.'
};

// ---------------- Yardımcılar ----------------
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const today = (scene) => scene.timeSys.day;
const relOf = (scene, key) => {
  const t = scene.town.rel;
  if (!t[key]) t[key] = { pts: 0, talk: 0, gift: 0, claimed: [] };
  return t[key];
};
const heartsOf = (scene, key) => Math.floor(relOf(scene, key).pts / PTS_PER_HEART);
const npcByKey = (scene, key) => scene.npcs.find((n) => n.key === key);
const itemName = (id) => ITEMS[id]?.name || id;
const icon = (scene, id) => iconURL(scene, ITEMS[id]?.icon || id);

function discount(scene, key) {
  if (!REL[key]) return 0;
  const h = heartsOf(scene, key);
  return h >= 6 ? 0.2 : h >= 3 ? 0.1 : 0;
}

function giftCategory(key, id) {
  const r = REL[key];
  if (r.loved.includes(id)) return 'loved';
  if (r.liked.includes(id)) return 'liked';
  if (r.disliked.includes(id)) return 'disliked';
  return 'neutral';
}

function heartsHTML(h) {
  return `<span class="th-full">${'♥'.repeat(h)}</span><span class="th-empty">${'♥'.repeat(10 - h)}</span>`;
}

// Dükkânı olmayan NPC'ler indirim yerine 3♥'de küçük bir altın hediyesi verir
const TIER3_COINS = 40;
function nextRewardText(h, hasShop, key) {
  if (h < 3) return hasShop ? '3♥: dükkânda %10 indirim' : `3♥: ${TIER3_COINS}🪙 hediye`;
  if (h < 4) return `4♥: gece yardımı (${NIGHT_HELP[key]?.desc || ''})`;
  if (h < 6) return hasShop ? '6♥: %20 indirim + özel tarif' : '6♥: özel tarif';
  if (h < 8) return '8♥: özel hediye';
  return 'Tüm ödüller açıldı';
}

// Kalp puanı ekle; eşik geçişlerinde ödülleri ver
function addPoints(scene, key, n, showFloat = true) {
  if (!REL[key]) return;
  const r = relOf(scene, key);
  const before = Math.floor(r.pts / PTS_PER_HEART);
  r.pts = Phaser.Math.Clamp(r.pts + n, 0, MAX_PTS);
  const after = Math.floor(r.pts / PTS_PER_HEART);
  const npc = npcByKey(scene, key);
  if (showFloat && npc && !npc.hidden) scene.floatText(npc.x, npc.y - 18, n >= 0 ? `+${n} ♥` : `${n} ♥`, n >= 0 ? '#ff7ab6' : '#9aa3ad');
  if (after > before) {
    const name = npc?.npcName || key;
    scene.hud.toast(`${name} ile dostluğun arttı: ${after} ♥`, 'ok');
    checkTierRewards(scene, key);
    scene.events.emit('heartsChanged', { key, hearts: after });
  }
  if (after !== before) applyFriendPerks(scene);
}

function checkTierRewards(scene, key) {
  const r = relOf(scene, key), h = heartsOf(scene, key), def = REL[key];
  const npc = npcByKey(scene, key), name = npc?.npcName || key;
  const claim = (tier) => { if (h >= tier && !r.claimed.includes(tier)) { r.claimed.push(tier); return true; } return false; };
  if (claim(3)) {
    if (npc?.shop) scene.hud.toast(`${name} artık sana %10 indirim yapıyor!`, 'ok');
    else { scene.player.addCoins(TIER3_COINS); scene.hud.toast(`${name} dostluğunuz için ${TIER3_COINS} 🪙 verdi!`, 'ok'); }
  }
  if (claim(HELP_HEARTS)) {
    scene.hud.toast(`${name} artık gece sana yardım edecek: ${NIGHT_HELP[key].desc}`, 'ok');
  }
  if (claim(6)) {
    const rec = def.recipe();
    syncRecipes(scene);
    scene.hud.banner(`${name}: 6 ♥`, `Özel tarif açıldı: ${itemName(rec.out)}${npc?.shop ? ' · %20 indirim' : ''}`);
    audio.sfx('quest');
  }
  if (claim(8)) {
    const g = def.gift();
    if (g.coins) scene.player.addCoins(g.coins);
    Object.entries(g.items || {}).forEach(([id, n]) => { if (ITEMS[id]) scene.giveItem(id, n); });
    const parts = [];
    if (g.coins) parts.push(`${g.coins}🪙`);
    Object.entries(g.items || {}).forEach(([id, n]) => { if (ITEMS[id]) parts.push(`${n}× ${itemName(id)}`); });
    scene.hud.banner(`${name}: 8 ♥`, `Sana özel bir hediye verdi: ${parts.join(', ')}`);
    audio.sfx('quest');
  }
}

// 6 kalp tariflerini RECIPES listesine ekle/çıkar (yeniden başlatmada temizlenir)
function syncRecipes(scene) {
  for (let i = RECIPES.length - 1; i >= 0; i--) if (RECIPES[i].townNpc) RECIPES.splice(i, 1);
  REL_KEYS.forEach((key) => {
    const r = scene.town.rel[key];
    if (!r || !r.claimed.includes(6)) return;
    const rec = REL[key].recipe();
    if (ITEMS[rec.out] && Object.keys(rec.cost).every((id) => ITEMS[id])) RECIPES.push({ ...rec, townNpc: key });
  });
}

// ---------------- Konuşma ve hediye ----------------
function onTalk(scene, npc) {
  if (!REL[npc.key]) return;
  const r = relOf(scene, npc.key);
  if (r.talk === today(scene)) return;
  r.talk = today(scene);
  addPoints(scene, npc.key, TALK_PTS);
}

function giftableItems(scene) {
  const seen = new Map();
  scene.inventory.slots.forEach((s) => {
    if (!s || !ITEMS[s.id] || ITEMS[s.id].type === 'tool') return;
    seen.set(s.id, (seen.get(s.id) || 0) + s.count);
  });
  return [...seen.entries()];
}

function openGiftChooser(scene, npc) {
  const hud = scene.hud;
  const list = giftableItems(scene);
  if (!list.length) { hud.renderDialog('Verebileceğin bir şeyin yok gibi görünüyor.'); return; }
  scene.town.giftMode = true;
  hud.renderDialog(`${npc.npcName} için ne hediye etmek istersin? (Günde bir hediye)`, [
    ...list.slice(0, 14).map(([id, n]) => [`<img class="town-ico" src="${icon(scene, id)}" alt="">${itemName(id)} <small>×${n}</small>`, () => giveGift(scene, npc, id), 'town-gift-btn']),
    ['Vazgeç', () => hud.renderDialog(npc.talkLine()), 'ghost']
  ]);
  scene.town.giftMode = false;
}

function giveGift(scene, npc, id) {
  const r = relOf(scene, npc.key), hud = scene.hud;
  if (r.gift === today(scene)) { hud.renderDialog('Bugün zaten bir hediye verdin, yarın tekrar gel!'); return; }
  if (!scene.inventory.remove(id, 1)) return;
  const cat = giftCategory(npc.key, id);
  r.gift = today(scene);
  addPoints(scene, npc.key, GIFT_PTS[cat]);
  if (cat === 'loved') { audio.sfx('quest'); scene.spawnParticles(npc.x, npc.y - 10, 0xff7ab6, 10); } else if (cat === 'disliked') audio.sfx('error'); else audio.sfx('coin');
  hud.renderDialog(pick(REACT[cat]));
}

// ---------------- Diyalog / dükkân eklemeleri (HUD dosyasına dokunmadan örnek üzerinde sarmalama) ----------------
function patchHUD(scene) {
  const hud = scene.hud;
  const origOpen = hud.openDialog.bind(hud);
  hud.openDialog = (npc) => { try { onTalk(scene, npc); } catch (e) { console.warn(e); } origOpen(npc); };

  const origRender = hud.renderDialog.bind(hud);
  hud.renderDialog = (text, custom) => {
    origRender(text, custom);
    try { decorateDialog(scene, custom); } catch (e) { console.warn('town diyalog', e); }
  };

  const origShop = hud.renderShop.bind(hud);
  hud.renderShop = () => {
    const npc = hud.npc, key = npc?.shop, disc = npc ? discount(scene, npc.key) : 0;
    const orig = SHOPS[key];
    if (hud.shopTab === 'buy' && disc && orig) {
      SHOPS[key] = orig.map((o) => ({ ...o, price: Math.max(1, Math.round(o.price * (1 - disc))) }));
      try { origShop(); } finally { SHOPS[key] = orig; }
    } else origShop();
    const title = hud.e.shop.querySelector('.shop-title');
    let badge = title?.querySelector('.town-disc');
    if (disc && title) {
      if (!badge) { badge = el('span', 'town-disc'); title.appendChild(badge); }
      badge.textContent = `♥ -%${Math.round(disc * 100)}`;
    } else badge?.remove();
  };
}

// HUD'un bilmediği yeni NPC durumlarının Türkçe adları
const STATE_NAMES = {
  clinic: 'klinikte', treat: 'yaralı tedavi ediyor', stand: 'tezgâhta', post: 'nöbette', fight: 'savaşıyor', idle: 'iş bekliyor',
  seek: 'kaynak arıyor', goRes: 'işe gidiyor', work: 'çalışıyor', deliver: 'teslimata gidiyor', goHarvest: 'hasada gidiyor', harvesting: 'hasat ediyor',
  goPlant: 'ekime gidiyor', planting: 'tohum ekiyor'
};

// Hayatta kalanlar için duruma göre daha açıklayıcı ad
function stateName(npc) {
  const name = npc.sm?.name;
  if (npc.key === 'survivor') {
    if (npc.child && name === 'idle') return 'oynuyor';
    if (npc.job === 'sentry' && name === 'stand') return 'çevreyi kolluyor';
    if (name === 'work') return npc.job === 'miner' ? 'taş kırıyor' : 'ağaç kesiyor';
  }
  return STATE_NAMES[name];
}

function decorateDialog(scene, custom) {
  const hud = scene.hud, npc = hud.npc, d = hud.e.dialog;
  if (!npc) return;
  const body = d.querySelector('.dlg-body') || d;
  const st = stateName(npc);
  const roleEl = body.querySelector('.npc-role');
  if (st && roleEl) roleEl.textContent = `${npc.role} · ${st}`;
  let row = body.querySelector('.town-hearts');
  if (!row) {
    row = el('div', 'town-hearts');
    const role = body.querySelector('.npc-role');
    if (role) role.after(row); else body.prepend(row);
  }
  const opts = d.querySelector('.options');
  opts?.classList.toggle('town-gifts', !!scene.town.giftMode);

  if (REL[npc.key]) {
    const r = relOf(scene, npc.key), h = heartsOf(scene, npc.key), day = today(scene);
    const disc = discount(scene, npc.key);
    row.style.display = '';
    const fam = familyMeta(scene, npc);
    row.innerHTML = `${heartsHTML(h)} <span class="th-meta">${h}/10 · 💬${r.talk === day ? '✓' : '—'} 🎁${r.gift === day ? '✓' : '—'}${disc && npc.shop ? ` · -%${Math.round(disc * 100)}` : ''}${fam ? ` · ${fam}` : ''}</span>`;
  } else if (npc.key === 'survivor') {
    row.style.display = '';
    row.innerHTML = `<span class="th-meta">${survivorMeta(npc, scene)}</span>`;
  } else { row.style.display = 'none'; return; }

  if (custom || !opts) return;
  const add = (label, fn, cls = '') => {
    const b = el('button', cls, label);
    b.addEventListener('click', () => { audio.sfx('click'); fn(); });
    opts.insertBefore(b, opts.lastElementChild);
  };

  if (REL[npc.key]) {
    const r = relOf(scene, npc.key);
    if (r.gift !== today(scene)) add('🎁 Hediye ver', () => openGiftChooser(scene, npc));
  }
  if (npc.key === 'doctor') {
    const p = scene.player;
    const free = heartsOf(scene, 'doctor') >= 6;
    if (p.hp < p.maxHp) add(`🩺 Muayene ol (${free ? 'ücretsiz' : '20🪙'})`, () => {
      if (!free && p.coins < 20) { audio.sfx('error'); hud.renderDialog('Muayene 20 altın, üzgünüm. Sargı da işini görür.'); return; }
      if (!free) p.addCoins(-20);
      p.restore(p.maxHp, 20);
      scene.spawnParticles(p.x, p.y - 4, 0x7dffa0, 10);
      audio.sfx('eat');
      hud.renderDialog('İşte, turp gibisin! Dikkatli ol dışarıda.');
    }, 'accent');
  }
  if (npc.key === 'survivor' && !npc.child) {
    if (!npc.job) {
      JOB_IDS.forEach((j) => add(`${SURVIVOR_JOBS[j].icon} ${SURVIVOR_JOBS[j].name} yap (${HIRE_COST}🪙)`, () => hire(scene, npc, j), 'accent'));
    } else {
      JOB_IDS.filter((j) => j !== npc.job).forEach((j) => add(`🔁 ${SURVIVOR_JOBS[j].icon} ${SURVIVOR_JOBS[j].name} olsun`, () => { npc.setJob(j); hud.renderDialog(npc.talkLine()); }));
      add('👋 İşten çıkar', () => { npc.setJob(null); hud.renderDialog('Anlıyorum… Yine de burada kalabilir miyim?'); }, 'ghost');
    }
  }
  if (canMarry(npc) && !npc.partner) add('💞 Eş bul', () => {
    const { mate, reason } = findMate(scene, npc);
    if (!mate) { hud.renderDialog(reason); return; }
    pair(scene, npc, mate);
    hud.renderDialog(`${mate.npcName} ile birlikte olmak beni çok mutlu ediyor. Burada bir yuva kurabiliriz.`);
  });
}

// Diyalog/ilişkiler panelinde hayatta kalan özeti
function survivorMeta(s, scene) {
  const parts = [];
  if (s.child) parts.push(`Çocuk · ${s.child} gün sonra büyüyecek`);
  else parts.push(s.job ? `İşe alındı · günlük maaş ${WAGE}🪙` : `İşe alınabilir · ${HIRE_COST}🪙 + günlük ${WAGE}🪙`);
  if (s.child && s.parents?.length) parts.push(`Ailesi: ${s.parents.join(' & ')}`);
  const fam = scene ? familyMeta(scene, s) : (s.partner ? `Eşi: ${s.partner}` : '');
  if (fam) parts.push(fam);
  return parts.join(' · ');
}

// ---------------- Aile ----------------
// Köydekiler scene.npcs'te, katılmamışlar scene.outsiders'ta (settlement). Eş bağı ad ile tutulur (adlar benzersiz).
const people = (scene) => [...scene.npcs, ...(scene.outsiders || [])];
const partnerOf = (scene, s) => (s.partner ? scene.npcs.find((o) => o !== s && o.npcName === s.partner) || null : null);
const canMarry = (n) => (n.key === 'survivor' || !!REL[n.key]) && !n.child && !n.outsider && (n.gender === 'f' || n.gender === 'm');
const GENDER_WORD = { f: 'kadın', m: 'erkek' };

// Kiler sistemi kullanılıyorsa (en az bir bağış yapılmışsa) ve kiler günlük ihtiyacı karşılamıyorsa kasaba aç sayılır.
// Kiler hiç kullanılmadıysa bebek için engel sayılmaz.
function pantryShort(scene) {
  const P = scene.pantry;
  if (!P || !(P.donated > 0)) return null;
  const need = 2 * scene.npcs.length;
  return P.pantry < need ? { have: P.pantry, need } : null;
}

// Çiftin neden bebek düşünmediği (null = engel yok)
function babyBlock(scene, a) {
  const b = partnerOf(scene, a);
  if (!b) return `${a.partner} köyde olmadığı için bebek düşünmüyoruz`;
  const pop = survivors(scene).length;
  if (pop >= MAX_POP) return `Köy çok kalabalık (${pop}/${MAX_POP}), şimdilik bebek düşünmüyoruz`;
  const last = Math.max(a.lastBaby || 0, b.lastBaby || 0), day = today(scene);
  if (last && day - last < BABY_GAP) return `Bebeğimiz daha çok küçük; ${BABY_GAP - (day - last)} gün sonra yeniden düşünürüz`;
  const short = pantryShort(scene);
  if (short) return `Kiler boş olduğu için bebek düşünmüyoruz (kiler ${short.have}/${short.need}, günlük ihtiyacı karşılamalı)`;
  return null;
}

// Diyalogda eş + bebek durumu
function familyMeta(scene, n) {
  if (!n.partner) return '';
  const block = babyBlock(scene, n);
  return `💞 Eşi: ${n.partner} · 👶 ${block || `Bir bebek düşünüyoruz (her şafak %${Math.round(BABY_CHANCE * 100)} şans)`}`;
}

// Karşı cinsten, eşi olmayan, köydeki en yakın yetişkin (ana NPC'ler dahil; onlar için oyuncuyla MATE_HEARTS♥ gerekir)
function findMate(scene, s) {
  if (REL[s.key] && heartsOf(scene, s.key) < MATE_HEARTS) {
    return { mate: null, reason: `Seni daha yakından tanımadan böyle şeyleri konuşmam. (Dostluğunuz en az ${MATE_HEARTS}♥ olmalı)` };
  }
  const want = s.gender === 'f' ? 'm' : 'f', word = GENDER_WORD[want];
  const adults = scene.npcs.filter((o) => o !== s && o.gender === want && canMarry(o));
  if (!adults.length) return { mate: null, reason: `Köyde hiç ${word} yok… Belki ileride biri gelir.` };
  const free = adults.filter((o) => !o.partner);
  if (!free.length) return { mate: null, reason: `Köyde eşi olmayan bir ${word} yok. Belki ileride…` };
  const ok = free.filter((o) => !REL[o.key] || heartsOf(scene, o.key) >= MATE_HEARTS);
  if (!ok.length) return { mate: null, reason: `${free.map((o) => o.npcName).join(', ')} ile tanışmak isterdim ama önce senin onunla dostluğun en az ${MATE_HEARTS}♥ olmalı.` };
  let best = null, bd = Infinity;
  ok.forEach((o) => {
    const d = Phaser.Math.Distance.Between(s.x, s.y, o.x, o.y);
    if (d < bd) { bd = d; best = o; }
  });
  return { mate: best, reason: '' };
}

function pair(scene, a, b) {
  a.partner = b.npcName;
  b.partner = a.npcName;
  audio.sfx('quest');
  scene.spawnParticles(a.x, a.y - 8, 0xff8fb0, 8);
  scene.spawnParticles(b.x, b.y - 8, 0xff8fb0, 8);
  scene.hud.toast(`💞 ${a.npcName} ve ${b.npcName} artık bir çift!`, 'ok');
}

// Eşi artık hiçbir yerde olmayan (ayrılmış/silinmiş) kişinin eş bilgisini temizle
function fixPartners(scene) {
  const all = people(scene);
  all.forEach((s) => { if (s.partner && !all.some((o) => o !== s && o.npcName === s.partner)) s.partner = null; });
}

// Cinsiyete uygun, kimsenin kullanmadığı bir ad (liste biterse "Ali 2" gibi)
function freshName(scene, gender) {
  const taken = new Set(people(scene).map((n) => n.npcName));
  const list = gender === 'f' ? SURV_NAMES_F : SURV_NAMES_M;
  const free = list.filter((n) => !taken.has(n));
  if (free.length) return pick(free);
  for (let i = 2; i < 999; i++) { const n = `${pick(list)} ${i}`; if (!taken.has(n)) return n; }
  return `${list[0]} ${Date.now() % 1000}`;
}

// Şafakta: çocuklar büyür, engeli olmayan çiftlere bebek doğabilir (ana NPC çiftleri dahil; bebek hep hayatta kalan çocuk olur)
function familyDawn(scene) {
  const day = today(scene);
  survivors(scene).forEach((s) => {
    if (!s.child) return;
    s.child--;
    if (!s.child) {
      s.arrived = day; // işsiz ayrılma sayacı büyüdüğü günden başlar
      s.growUp();
      scene.hud.toast(`🎉 ${s.npcName} büyüdü! Artık işe alınabilir.`, 'ok');
    }
  });
  const seen = new Set();
  scene.npcs.slice().forEach((a) => {
    if (!a.partner || seen.has(a)) return;
    const b = partnerOf(scene, a);
    if (!b) return;
    seen.add(a); seen.add(b);
    if (babyBlock(scene, a)) return;
    if (Math.random() >= BABY_CHANCE) return;
    const gender = Math.random() < 0.5 ? 'f' : 'm';
    const name = freshName(scene, gender);
    const [mom, dad] = a.gender === 'f' ? [a, b] : [b, a];
    const baby = spawnSurvivor(scene, { name, gender, variant: rand(0, 2), job: null, arrived: day, child: GROW_DAYS, parents: [mom.npcName, dad.npcName] }, false);
    a.lastBaby = b.lastBaby = day;
    scene.spawnParticles(baby.x, baby.y - 6, 0xff8fb0, 10);
    audio.sfx('levelup');
    scene.hud.toast(`👶 ${mom.npcName} ve ${dad.npcName} bir ${gender === 'f' ? 'kız' : 'erkek'} bebek sahibi oldu: ${name}!`, 'ok');
  });
}

// ---------------- Hayatta kalanlar ----------------
function freeSlot(scene) {
  const used = new Set(survivors(scene).map((s) => s.slot));
  for (let i = 0; i < MAX_POP; i++) if (!used.has(i)) return i;
  return 0;
}
const survivors = (scene) => scene.npcs.filter((n) => n.key === 'survivor');

function spawnSurvivor(scene, data, announce) {
  const d = scene.shelter.door;
  const slot = data.slot ?? freeSlot(scene);
  const s = new Survivor(scene, d.x - 30 + (slot % 4) * 20, d.y + 74, { ...data, slot });
  scene.npcs.push(s);
  if (announce) {
    // Yeni gelen köye kendiliğinden girmez: haritada bekler, davet edilir ya da kurtarılır (settlement)
    const rec = scene.settlement?.strand(s);
    s.setAlpha(0);
    scene.tweens.add({ targets: s, alpha: 1, duration: 600 });
    if (rec) scene.hud.toast(rec.mode === 'rescue'
      ? `📻 Telsizden yardım çağrısı: ${s.npcName} zombilerin arasında mahsur! Haritada ❗ olarak görünüyor.`
      : `👣 ${s.npcName} adında bir hayatta kalan köyün yakınlarında dolaşıyor. Bulup davet edebilirsin.`, 'info');
    else scene.hud.toast(`Hayatta kalan ${s.npcName} kasabaya sığındı! Konuşup işe alabilirsin.`, 'ok');
  }
  return s;
}

function removeSurvivor(scene, s) {
  const i = scene.npcs.indexOf(s);
  if (i >= 0) scene.npcs.splice(i, 1);
  s.destroy();
  fixPartners(scene);
}

function hire(scene, s, job) {
  const p = scene.player, hud = scene.hud;
  if (s.child) { hud.toast(`${s.npcName} daha çocuk, çalışamaz`, 'warn'); return false; }
  if (s.job) { s.setJob(job); return true; }
  if (survivors(scene).filter((o) => o.job).length >= MAX_SURVIVORS) { hud.toast('Daha fazla yardımcı alamazsın', 'warn'); return false; }
  if (p.coins < HIRE_COST) {
    audio.sfx('error');
    if (hud.modal === 'dialog' && hud.npc === s) hud.renderDialog(`${HIRE_COST} altının yok mu? Bekleyebilirim…`);
    else hud.toast(`${HIRE_COST} 🪙 gerekli`, 'warn');
    return false;
  }
  p.addCoins(-HIRE_COST);
  s.setJob(job);
  audio.sfx('quest');
  hud.toast(`${SURVIVOR_JOBS[job]?.icon || ''} ${s.npcName} artık ${SURVIVOR_JOBS[job]?.name || 'yardımcı'}!`, 'ok');
  if (hud.modal === 'dialog' && hud.npc === s) hud.renderDialog(JOB_THANKS[job] || 'Teşekkürler!');
  return true;
}

function maybeSurvivorArrives(scene, wave) {
  if (wave % 3 !== 0) return;
  const adults = survivors(scene).filter((s) => !s.child).length;
  if (adults + (scene.settlement?.strays() || 0) >= MAX_SURVIVORS || survivors(scene).length >= MAX_POP) return;
  const t = scene.town;
  if (t.everArrived && Math.random() >= 0.6) return; // ilk seferde garanti, sonra %60
  t.everArrived = true;
  const gender = Math.random() < 0.5 ? 'f' : 'm';
  spawnSurvivor(scene, { name: freshName(scene, gender), gender, variant: rand(0, 2), job: null, arrived: today(scene) }, true);
}

// Şafakta maaş öde; ödenemeyen istifa eder, uzun süre işe alınmayan ayrılır
function payWages(scene) {
  const p = scene.player;
  let paid = 0;
  survivors(scene).forEach((s) => {
    if (s.job) {
      if (p.coins >= WAGE) { p.addCoins(-WAGE); paid += WAGE; }
      else { s.setJob(null); scene.hud.toast(`${s.npcName} maaşını alamadı ve işi bıraktı!`, 'warn'); }
    } else if (!s.child && !s.partner && today(scene) - (s.arrived || 0) > 3) {
      // Çocuklar ve eşi olanlar köye bağlıdır, ayrılmaz
      scene.hud.toast(`${s.npcName} iş bulamadı ve kasabadan ayrıldı.`, 'info');
      removeSurvivor(scene, s);
    }
  });
  if (paid) scene.hud.toast(`Yardımcı maaşları ödendi: -${paid} 🪙`, 'info');
}

// ---------------- İlan panosu ----------------
// Her şafakta 3 seçenek: bir teslim, bir öldür/topla, bir hayatta kal. Ödüller dalga ve günle ölçeklenir.
const boardScale = (scene) => 1 + Math.min(2.5, scene.waves.wave * 0.15 + (today(scene) - 1) * 0.04);

function makeTask(scene, type, i) {
  const day = today(scene), w = scene.waves.wave, k = boardScale(scene);
  const t = { id: `b${day}_${i}`, type, npc: pick(REL_KEYS), progress: 0, accepted: false, done: false };
  const pay = (base) => Math.round(Phaser.Math.Clamp(base, 30, 120) * k);
  if (type === 'deliver') {
    const pool = [['wheat', 6, 12], ['carrot', 4, 8], ['pumpkin', 2, 3], ['wood', 10, 18], ['stone', 8, 14], ['bread', 2, 3],
      ['egg', 3, 5], ['milk', 2, 3], ['strawberry', 3, 6], ['fish_carp', 2, 4], ['mushroom', 3, 6], ['cheese', 1, 2]].filter(([id]) => ITEMS[id]);
    const [id, a, b] = pick(pool);
    t.item = id; t.amount = rand(a, b);
    t.reward = pay(t.amount * (ITEMS[id].sell || 3) * 1.3 + 15);
  } else if (type === 'kill') {
    t.amount = rand(8, 14) + w * 2;
    t.reward = pay(t.amount * 4 + 10);
  } else if (type === 'gather') {
    t.item = pick(['wood', 'stone']);
    t.amount = rand(10, 22);
    t.reward = pay(t.amount * 3 + 20);
  } else {
    // Hayatta kal: ya bu gece hiç bayılma ya da sığınak canı belli bir oranın altına inmesin
    t.cond = Math.random() < 0.5 ? 'noFaint' : 'shelter';
    t.pct = t.cond === 'shelter' ? Phaser.Math.Clamp(80 - w * 2, 50, 80) : 0;
    t.amount = 1;
    t.reward = pay(t.cond === 'noFaint' ? 55 + w * 6 : 45 + w * 5);
  }
  return t;
}

function genBoard(scene) {
  const day = today(scene);
  // Kabul edilmiş, bitmemiş teslim/toplama ilanları ertesi güne taşınır (gece görevleri o geceyle biter)
  const carry = (scene.town.board?.tasks || []).filter((t) => t.accepted && !t.done && (t.type === 'deliver' || t.type === 'gather')).slice(0, 2);
  const types = Phaser.Utils.Array.Shuffle(['deliver', pick(['kill', 'kill', 'gather']), 'survive']);
  scene.town.board = { day, tasks: [...carry, ...types.map((type, i) => makeTask(scene, type, i))] };
  syncGather(scene);
  scene.events.emit('questsChanged');
}

function taskText(scene, t) {
  const who = npcByKey(scene, t.npc)?.npcName || 'Biri';
  if (t.type === 'deliver') return { title: `${itemName(t.item)} Siparişi`, desc: `${who} ${t.amount} ${itemName(t.item)} istiyor.` };
  if (t.type === 'kill') return { title: 'Zombi Temizliği', desc: `${who}: ${t.amount} zombi öldür.` };
  if (t.type === 'survive') {
    const d = t.cond === 'noFaint' ? 'Bu geceyi hiç bayılmadan atlat.' : `Bu gece sığınağın canı %${t.pct} altına düşmesin.`;
    return { title: 'Gece Nöbeti', desc: `${who}: ${d}${t.failed ? ' (başarısız)' : ''}` };
  }
  return { title: `${itemName(t.item)} Toplama`, desc: `${who} için ${t.amount} ${itemName(t.item)} topla (kabulden sonra).` };
}

function taskProgress(scene, t) {
  if (t.type === 'deliver') return Math.min(t.amount, scene.inventory.count(t.item));
  return Math.min(t.amount, t.progress);
}

// Toplama görevleri için envanter farkı takibi
// Sayım envanter başına tutulur: çok oyunculuda misafir bağlamında scene.inventory misafirin envanteridir
function syncGather(scene) {
  const inv = scene.inventory, c = {};
  ['wood', 'stone'].forEach((id) => { c[id] = inv.count(id); });
  inv.gatherCounts = c;
  if (!scene.player?.netRemote) scene.town.lastCounts = c;
}

function onInventoryChange(scene) {
  const t = scene.town;
  if (!t?.board) return;
  const active = t.board.tasks.filter((x) => x.type === 'gather' && x.accepted && !x.done);
  if (!active.length) return;
  let changed = false;
  const inv = scene.inventory;
  if (!inv.gatherCounts) { if (!scene.player?.netRemote) inv.gatherCounts = t.lastCounts || {}; else { syncGather(scene); return; } }
  const last = inv.gatherCounts;
  for (const id of Object.keys(last)) {
    const now = inv.count(id);
    const delta = now - (last[id] || 0);
    last[id] = now;
    if (delta > 0) active.forEach((x) => { if (x.item === id) { x.progress = Math.min(x.amount, x.progress + delta); changed = true; } });
  }
  if (changed) { autoComplete(scene); scene.hud.renderQuests(); }
}

function completeTask(scene, t) {
  if (t.done || !t.accepted || taskProgress(scene, t) < t.amount) return false;
  if (t.type === 'deliver' && !scene.inventory.remove(t.item, t.amount)) return false;
  t.done = true;
  scene.player.addCoins(t.reward);
  addPoints(scene, t.npc, BOARD_PTS, false);
  audio.sfx('quest');
  scene.hud.toast(`İlan tamamlandı! +${t.reward} 🪙, ${npcByKey(scene, t.npc)?.npcName || ''} +♥`, 'ok');
  scene.events.emit('boardTaskDone', t);
  scene.events.emit('questsChanged');
  return true;
}

// Teslim dışındaki ilanlar hedefe ulaşınca kendiliğinden ödenir (panoya dönmeye gerek yok)
function autoComplete(scene) {
  scene.town.board.tasks.forEach((t) => { if (t.type !== 'deliver' && t.accepted && !t.done && t.progress >= t.amount) completeTask(scene, t); });
}

function openBoard(scene) {
  const body = el('div', 'town-panel');
  const render = () => {
    const b = scene.town.board;
    body.innerHTML = `<p class="town-sub">Gün ${b.day} ilanları · her şafakta 3 yeni seçenek. Ödüller ilerledikçe artar (x${boardScale(scene).toFixed(2)}). Teslim dışındakiler bitince kendiliğinden ödenir.</p>`;
    b.tasks.forEach((t) => {
      const { title, desc } = taskText(scene, t);
      const prog = taskProgress(scene, t);
      const npc = npcByKey(scene, t.npc);
      const status = t.failed ? 'Başarısız' : t.accepted ? `${prog}/${t.amount}` : 'Kabul edilmedi';
      const card = el('div', `town-card${t.done || t.failed ? ' done' : ''}`,
        `${npc ? `<img class="town-por" src="${iconURL(scene, npc.texKey)}" alt="">` : ''}
         <div class="town-info"><b>${title}</b><span>${desc}</span>
         <span class="town-prog">${status} · ${t.reward}🪙 + ♥</span></div>`);
      const btn = el('button', t.done || t.failed ? 'ghost' : t.accepted ? 'primary' : 'accent');
      if (t.done) { btn.textContent = '✓ Bitti'; btn.disabled = true; }
      else if (t.failed) { btn.textContent = '✗'; btn.disabled = true; }
      else if (!t.accepted) {
        // Gece nöbeti gece ortasında kabul edilemez (şafağa yakın kabul edip ödül almayı engeller)
        const late = t.type === 'survive' && scene.waves.active;
        btn.textContent = late ? 'Gündüz kabul' : 'Kabul et';
        btn.disabled = late;
        btn.onclick = () => {
          t.accepted = true;
          if (t.type === 'gather') syncGather(scene);
          audio.sfx('click');
          scene.events.emit('questsChanged');
          render();
        };
      } else if (t.type === 'deliver') {
        btn.textContent = 'Teslim et';
        btn.disabled = prog < t.amount;
        btn.onclick = () => { if (completeTask(scene, t)) render(); else audio.sfx('error'); };
      } else { btn.textContent = t.type === 'survive' ? '🌙 Gece' : '⏳ Sürüyor'; btn.disabled = true; }
      card.appendChild(btn);
      body.appendChild(card);
    });
  };
  render();
  scene.hud.openPanel('📋 İlan Panosu', body);
}

// Gece nöbeti ilanlarını şafakta değerlendir (pano yenilenmeden önce çalışır)
function judgeSurvive(scene) {
  const t = scene.town;
  t.board.tasks.forEach((x) => {
    if (x.type !== 'survive' || !x.accepted || x.done || x.failed) return;
    const ok = x.cond === 'noFaint' ? !t.faintedTonight : t.minShelter * 100 >= x.pct;
    if (ok) { x.progress = 1; completeTask(scene, x); } else x.failed = true;
  });
}

// ---------------- İlişkiler paneli ----------------
function openRelations(scene) {
  const body = el('div', 'town-panel');
  const render = () => {
    const day = today(scene);
    body.innerHTML = '<p class="town-sub">Her gün konuş (+20) ve hediye ver (günde 1). 3♥ indirim (dükkânı yoksa altın) · 4♥ gece yardımı · 6♥ %20 + özel tarif · 8♥ özel hediye.</p>';
    REL_KEYS.forEach((key) => {
      const npc = npcByKey(scene, key);
      if (!npc) return;
      const r = relOf(scene, key), h = heartsOf(scene, key);
      const icons = (ids) => ids.filter((id) => ITEMS[id]).map((id) => `<img class="town-ico" src="${icon(scene, id)}" title="${itemName(id)}" alt="${itemName(id)}">`).join('');
      const loved = icons(REL[key].loved), disliked = icons(REL[key].disliked);
      body.appendChild(el('div', 'town-card',
        `<img class="town-por" src="${iconURL(scene, npc.texKey)}" alt="">
         <div class="town-info"><b>${npc.npcName} <small>${npc.role}</small></b>
         <span class="town-h">${heartsHTML(h)}</span>
         <span class="town-prog">${npc.partner ? `💞 ${npc.partner} · ` : ''}💬${r.talk === day ? '✓' : '—'} 🎁${r.gift === day ? '✓' : '—'} · Sever: ${loved || '?'} · Sevmez: ${disliked || '?'} · ${nextRewardText(h, !!npc.shop, key)}</span></div>`));
    });
    const list = survivors(scene);
    body.appendChild(el('h4', 'town-h4', `Hayatta kalanlar (${list.length}/${MAX_POP} · çalışan ${list.filter((s) => s.job).length}/${MAX_SURVIVORS})`));
    if (!list.length) body.appendChild(el('p', 'town-sub', 'Her 3 dalgada bir kasabaya hayatta kalanlar gelebilir. İşe alınca çiftçi, savaşçı, oduncu ya da madenci olurlar.'));
    list.forEach((s) => {
      const card = el('div', 'town-card',
        `<img class="town-por" src="${iconURL(scene, s.texKey)}" alt="">
         <div class="town-info"><b>${s.npcName} <small>${s.role}</small></b>
         <span class="town-prog">${survivorMeta(s, scene)}${s.hidden ? ' · sığınakta' : ''}</span></div>`);
      const btns = el('div', 'town-btns');
      const mk = (label, cls, fn) => { const b = el('button', cls, label); b.onclick = () => { audio.sfx('click'); fn(); render(); }; btns.appendChild(b); };
      if (s.child) { /* çocuklar çalışmaz */ } else if (!s.job) {
        JOB_IDS.forEach((j) => mk(`${SURVIVOR_JOBS[j].icon} ${SURVIVOR_JOBS[j].name}`, 'accent', () => hire(scene, s, j)));
      } else {
        JOB_IDS.filter((j) => j !== s.job).forEach((j) => mk(`${SURVIVOR_JOBS[j].icon} ${SURVIVOR_JOBS[j].name}`, '', () => s.setJob(j)));
        mk('Çıkar', 'ghost', () => s.setJob(null));
      }
      card.appendChild(btns);
      body.appendChild(card);
    });
  };
  render();
  scene.hud.openPanel('❤️ İlişkiler', body);
}

// ---------------- Dokular ----------------
// Basit koyulaştırma (#rrggbb)
const shadeHex = (hex, k = 0.75) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
function makeTextures(scene) {
  // Doktor: beyaz önlük, kırmızı haç
  makeHumanoid(scene, 'npc_doctor', basePal({ H: '#4a2b1a', C: '#eef2f5', D: '#c5d0d8', P: '#3b5b7a' }), (ctx, ox) => {
    R(ctx, ox + 9, 9, 3, 1, '#d94040'); R(ctx, ox + 10, 8, 1, 3, '#d94040');
  });
  // Avcı: kahverengi şapka, yeşil yelek, sırtta yay
  makeHumanoid(scene, 'npc_hunter', basePal({ S: '#d6a07a', H: '#3a2a1a', C: '#5c6b3a', D: '#4a3a22', P: '#4a3a22' }), (ctx, ox) => {
    R(ctx, ox + 3, 2, 10, 1, '#6b4a2f'); R(ctx, ox + 5, 0, 6, 2, '#7a5636'); R(ctx, ox + 9, 1, 2, 1, '#c94040');
    R(ctx, ox + 13, 7, 1, 7, '#8a5a3a'); R(ctx, ox + 14, 8, 1, 5, '#e6edf3');
  });
  // Hayatta kalanlar: yıpranmış kıyafetler
  const sp = [
    { H: '#2a2a2a', C: '#8a6a4a', D: '#6b5038', P: '#4a4a5a' },
    { S: '#e0b48c', H: '#b04a2a', C: '#4a6a8a', D: '#3a5068', P: '#5a4a3a' },
    { S: '#c48a64', H: '#d8d0c0', C: '#7a4a6a', D: '#5a3450', P: '#3a3a3a' }
  ];
  sp.forEach((p, i) => makeHumanoid(scene, `npc_surv${i}`, basePal(p), (ctx, ox) => { R(ctx, ox + 5, 10, 1, 1, '#2a1f1a'); R(ctx, ox + 10, 8, 1, 1, '#2a1f1a'); }));
  // Kadın hayatta kalanlar: omuzlara inen uzun saç, etek ve saç tokası; renkler erkeklerden ayrışır
  const fp = [
    { H: '#7a3a1c', C: '#c0607a', D: '#9a4560', P: '#4a3a4a', bow: '#ffd166' },
    { S: '#e8bf98', H: '#e0c070', C: '#4f9a7a', D: '#3a7a5e', P: '#3a4a5a', bow: '#ff7ab6' },
    { S: '#b47a56', H: '#1e1a24', C: '#7a64b8', D: '#5c4a94', P: '#3a3040', bow: '#e05a4f' }
  ];
  fp.forEach((p, i) => makeHumanoid(scene, `npc_survf${i}`, basePal(p), (ctx, ox) => {
    R(ctx, ox + 3, 3, 2, 6, p.H); R(ctx, ox + 11, 3, 2, 6, p.H);   // uzun saç
    R(ctx, ox + 3, 8, 1, 1, shadeHex(p.H)); R(ctx, ox + 12, 8, 1, 1, shadeHex(p.H));
    R(ctx, ox + 4, 12, 8, 2, p.D); R(ctx, ox + 4, 12, 8, 1, p.C);   // etek
    R(ctx, ox + 10, 1, 2, 2, p.bow);                                 // toka
    R(ctx, ox + 5, 10, 1, 1, '#2a1f1a');                             // yama
  }));
  ['npc_doctor', 'npc_hunter', 'npc_surv0', 'npc_surv1', 'npc_surv2', 'npc_survf0', 'npc_survf1', 'npc_survf2'].forEach((key) => {
    if (!scene.anims.exists(`${key}_walk`)) scene.anims.create({ key: `${key}_walk`, frames: [{ key, frame: 0 }, { key, frame: 1 }], frameRate: 7, repeat: -1 });
  });

  addCanvas(scene, 'town_arrow', 10, 3, (ctx) => {
    R(ctx, 2, 1, 6, 1, '#c9a06b'); R(ctx, 8, 0, 2, 3, '#d0d4da'); R(ctx, 0, 0, 2, 1, '#e05a4f'); R(ctx, 0, 2, 2, 1, '#e05a4f');
  });
  addCanvas(scene, 'town_board', 24, 26, (ctx) => {
    R(ctx, 3, 12, 2, 14, '#5d3c27'); R(ctx, 19, 12, 2, 14, '#5d3c27');
    R(ctx, 0, 2, 24, 14, '#8a5a3a'); R(ctx, 1, 3, 22, 12, '#a87048'); R(ctx, 0, 1, 24, 2, '#6b4a2f');
    R(ctx, 3, 5, 5, 6, '#f5f0e6'); R(ctx, 10, 4, 5, 7, '#f2e3b3'); R(ctx, 17, 5, 4, 5, '#f5f0e6');
    R(ctx, 5, 5, 1, 1, '#d94040'); R(ctx, 12, 4, 1, 1, '#d94040'); R(ctx, 18, 5, 1, 1, '#d94040');
    for (const [x, y] of [[4, 7], [11, 6], [11, 8], [18, 7]]) R(ctx, x, y, 3, 1, '#8d8f99');
  });
  addCanvas(scene, 'town_clinic', 32, 28, (ctx) => {
    for (let i = 0; i < 12; i++) R(ctx, 16 - i * 1.3, 2 + i, i * 2.6 + 1, 1, i % 4 === 3 ? '#cfd8df' : '#eef2f5');
    R(ctx, 1, 14, 30, 13, '#e3e9ee'); R(ctx, 1, 14, 30, 1, '#b8c3cc');
    R(ctx, 12, 17, 8, 10, '#5a6b7a');
    R(ctx, 14, 5, 4, 1, '#d94040'); R(ctx, 15, 4, 2, 3, '#d94040');
    R(ctx, 4, 18, 5, 2, '#d94040'); R(ctx, 5.5, 16.5, 2, 5, '#d94040');
  });
  addCanvas(scene, 'town_rack', 26, 20, (ctx) => {
    R(ctx, 2, 4, 2, 16, '#5d3c27'); R(ctx, 22, 4, 2, 16, '#5d3c27'); R(ctx, 0, 3, 26, 2, '#6b4a2f');
    R(ctx, 6, 5, 6, 9, '#a87048'); R(ctx, 7, 6, 4, 7, '#c9a06b');
    R(ctx, 15, 5, 1, 12, '#8a5a3a'); R(ctx, 16, 5, 1, 1, '#e6edf3'); R(ctx, 16, 16, 1, 1, '#e6edf3');
    R(ctx, 18, 6, 1, 10, '#c9a06b'); R(ctx, 18, 5, 1, 1, '#d0d4da');
  });

  // İkonlar
  const ic = (key, draw) => addCanvas(scene, key, 16, 16, draw);
  ic('i_bandage', (ctx) => { R(ctx, 3, 5, 10, 6, '#f2e3c9'); R(ctx, 3, 5, 10, 1, '#fff'); R(ctx, 6, 6, 4, 4, '#e6d2b0'); R(ctx, 7, 7, 2, 2, '#d94040'); });
  ic('i_medkit', (ctx) => { R(ctx, 2, 5, 12, 9, '#e6edf3'); R(ctx, 2, 5, 12, 1, '#fff'); R(ctx, 6, 3, 4, 2, '#9aa3ad'); R(ctx, 7, 7, 2, 5, '#d94040'); R(ctx, 5, 9, 6, 1.5, '#d94040'); R(ctx, 2, 13, 12, 1, '#9aa3ad'); });
  ic('i_veggie_stew', (ctx) => { R(ctx, 2, 7, 12, 6, '#8a5a3a'); R(ctx, 3, 7, 10, 2, '#b8723a'); R(ctx, 4, 7, 2, 1, '#e8792b'); R(ctx, 8, 7, 2, 1, '#6fbf5a'); R(ctx, 11, 7, 1, 1, '#e8c867'); R(ctx, 4, 13, 8, 1, '#5d3c27'); R(ctx, 6, 3, 1, 3, 'rgba(255,255,255,0.6)'); R(ctx, 9, 2, 1, 3, 'rgba(255,255,255,0.6)'); });
  ic('i_spice_bread', (ctx) => { R(ctx, 3, 6, 10, 7, '#b8723a'); R(ctx, 4, 5, 8, 2, '#d08a48'); for (const [x, y] of [[5, 8], [8, 7], [10, 10], [6, 11]]) R(ctx, x, y, 1, 1, '#5d2f1a'); });
}

// ---------------- Dünya nesneleri ----------------
function placeProps(scene) {
  const d = scene.shelter.door;
  const t = scene.town;
  t.boardPos = { x: d.x + 88, y: d.y - 4 };
  t.clinicPos = { x: d.x - 66, y: d.y + 28 };
  const prop = (x, y, key, bw, bh, ox, oy) => {
    const img = scene.obstacles.create(x, y, key);
    img.body.setSize(bw, bh).setOffset(ox, oy);
    img.setDepth(y + img.height / 2 - 2);
    return img;
  };
  prop(t.boardPos.x, t.boardPos.y, 'town_board', 20, 4, 2, 22);
  prop(t.clinicPos.x, t.clinicPos.y, 'town_clinic', 28, 8, 2, 20);
  const hunter = npcByKey(scene, 'hunter');
  if (hunter) prop(hunter.stall.x + 18, hunter.stall.y - 12, 'town_rack', 22, 4, 2, 16);
}

// ---------------- Özellik modülü ----------------
const CSS = `
.town-hearts { margin: 2px 0 4px; font-size: 13px; letter-spacing: 1px; line-height: 1.2; }
.th-full { color: #ff5c8a; text-shadow: 0 0 4px rgba(255,92,138,.5); }
.th-empty { color: rgba(255,255,255,.18); }
.th-meta { font-size: 11px; letter-spacing: 0; opacity: .8; margin-left: 4px; }
.town-ico { width: 18px; height: 18px; image-rendering: pixelated; vertical-align: middle; margin-right: 4px; }
.options.town-gifts { max-height: 40vh; overflow-y: auto; }
.town-disc { margin-left: 8px; font-size: 12px; color: #ff7ab6; background: rgba(255,122,182,.15); padding: 2px 6px; border-radius: 8px; }
.town-panel { display: flex; flex-direction: column; gap: 8px; max-height: 62vh; overflow-y: auto; }
.town-sub { font-size: 12px; opacity: .75; margin: 0 0 2px; }
.town-h4 { margin: 8px 0 0; font-size: 14px; }
.town-card { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.06); }
.town-card.done { opacity: .55; }
.town-por { width: 36px; height: 36px; image-rendering: pixelated; flex: none; }
.town-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.town-info small { opacity: .65; font-weight: 400; }
.town-h { font-size: 13px; letter-spacing: 1px; }
.town-prog { font-size: 11.5px; opacity: .8; }
.town-prog .town-ico { width: 14px; height: 14px; margin: 0 1px; }
.town-card > button, .town-btns button { min-height: 40px; min-width: 84px; flex: none; }
.town-btns { display: flex; flex-direction: column; gap: 6px; }
.town-prog, .town-sub { overflow-wrap: anywhere; }
.town-panel { max-width: 100%; min-width: 0; }
/* #modal-feature'ın sabit 560px genişliği dikey mobilde taşıyor; yalnızca kasaba panellerinde düzelt */
body.is-touch.portrait #modal-feature:has(.town-panel) { width: 100%; }
@media (max-width: 520px) {
  .town-card { flex-wrap: wrap; }
  .town-card > button { width: 100%; min-height: 44px; }
  .town-btns { flex-direction: row; width: 100%; }
  .town-btns button { flex: 1; min-height: 44px; }
  .town-hearts { font-size: 12px; }
}
`;

export default {
  id: 'town',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    scene.town = { rel: {}, board: { day: 0, tasks: [] }, everArrived: false, lastCounts: {}, giftMode: false, faintedTonight: false, minShelter: 1 };
    REL_KEYS.forEach((k) => relOf(scene, k));
    syncHunterShop();
    injectCSS('town', CSS);
    placeProps(scene);
    patchHUD(scene);

    // Takipçiye kabul edilmiş ilanları ekle
    scene.quests.addProvider?.(() => scene.town.board.tasks.filter((t) => t.accepted && !t.done).map((t) => {
      const { title, desc } = taskText(scene, t);
      return { id: t.id, title: `📋 ${title}`, desc, progress: taskProgress(scene, t), amount: t.amount };
    }));

    // E / mobil etkileşim: ilan panosu
    scene.addInteraction((s) => {
      const b = s.town.boardPos;
      const dist = Phaser.Math.Distance.Between(s.player.x, s.player.y, b.x, b.y + 10);
      return dist < 28 ? { dist, label: 'İlan panosuna bak', run: () => openBoard(s) } : null;
    });
    scene.featureMenu.push({ id: 'town-rel', icon: '❤️', label: 'İlişkiler', open: (s) => openRelations(s) });
    scene.featureMenu.push({ id: 'town-board', icon: '📋', label: 'İlan Panosu', open: (s) => openBoard(s) });

    // Gece ışıkları: klinik feneri, nöbetteki avcı
    scene.lightSources.push((s) => {
      const out = [{ x: s.town.clinicPos.x, y: s.town.clinicPos.y + 6, r: 42 }];
      const h = npcByKey(s, 'hunter');
      if (h && !h.hidden) out.push({ x: h.x, y: h.y, r: 40 });
      return out;
    });

    // Olaylar
    const onQuest = (q) => { if (REL[q?.npc]) addPoints(scene, q.npc, QUEST_PTS); };
    const onKill = () => {
      let ch = false;
      scene.town.board.tasks.forEach((t) => { if (t.type === 'kill' && t.accepted && !t.done && t.progress < t.amount) { t.progress++; ch = true; } });
      if (ch) { autoComplete(scene); scene.hud.renderQuests(); }
    };
    const onWaveEnd = (w) => { judgeSurvive(scene); maybeSurvivorArrives(scene, w); };
    const onWaveStart = () => {
      scene.town.faintedTonight = false;
      scene.town.minShelter = 1;
      nightHelp(scene);
    };
    const onDied = () => {
      if (!scene.waves.active) return;
      scene.town.faintedTonight = true;
      scene.town.board.tasks.forEach((t) => { if (t.type === 'survive' && t.cond === 'noFaint' && t.accepted && !t.done) t.failed = true; });
    };
    scene.events.on('questCompleted', onQuest);
    scene.events.on('zombieKilled', onKill);
    scene.events.on('waveEnd', onWaveEnd);
    scene.events.on('waveStart', onWaveStart);
    scene.events.on('playerDied', onDied);
    scene.events.once('shutdown', () => {
      scene.events.off('questCompleted', onQuest);
      scene.events.off('zombieKilled', onKill);
      scene.events.off('waveEnd', onWaveEnd);
      scene.events.off('waveStart', onWaveStart);
      scene.events.off('playerDied', onDied);
    });
    scene.inventory.onChange(() => onInventoryChange(scene));
    // Çok oyunculu: misafirin topladığı odun/taş da toplama ilanlarına sayılır (host misafir bağlamında yayar)
    scene.events.on('guestInventoryChanged', () => onInventoryChange(scene));
    scene.events.once('shutdown', () => scene.events.off('guestInventoryChanged'));
    scene.timeSys.on('dawn', () => {
      genBoard(scene);
      payWages(scene);
      familyDawn(scene);
      const doc = npcByKey(scene, 'doctor');
      if (doc?.treatedTonight) { scene.hud.toast(`Selin gece sığınakta yaralıları ${doc.treatedTonight} kez tedavi etti ✚`, 'info'); doc.treatedTonight = 0; }
      scene.time.delayedCall(2500, () => scene.hud.toast('📋 İlan panosunda yeni görevler var', 'info'));
    });
  },

  begin(scene, isNew) {
    if (isNew) {
      scene.town.rel = {};
      REL_KEYS.forEach((k) => relOf(scene, k));
      survivors(scene).forEach((s) => removeSurvivor(scene, s));
      people(scene).forEach((n) => { n.partner = null; n.lastBaby = 0; });
      scene.town.everArrived = false;
    }
    if (scene.town.board.day !== today(scene) || !scene.town.board.tasks.length) genBoard(scene);
    syncRecipes(scene);
    syncGather(scene);
    applyFriendPerks(scene);
    if (isNew) scene.time.delayedCall(4200, () => scene.hud.toast('Yeni: Doktor Selin ve Avcı Murat kasabada. ❤️ İlişkiler ve 📋 İlan Panosu menüde.', 'info'));
  },

  // Gece nöbeti ilanı için sığınağın gece içindeki en düşük can oranı
  update(scene) {
    const t = scene.town, sh = scene.shelter;
    if (scene.waves.active && sh?.maxHp) t.minShelter = Math.min(t.minShelter, sh.hp / sh.maxHp);
  },

  save(scene) {
    const t = scene.town;
    return {
      rel: t.rel,
      board: t.board,
      everArrived: t.everArrived,
      // Ana NPC'lerin eş bilgisi (eş adı + son bebek günü)
      main: Object.fromEntries(people(scene).filter((n) => REL[n.key] && n.partner).map((n) => [n.key, { partner: n.partner, lastBaby: n.lastBaby || 0 }])),
      survivors: survivors(scene).map((s) => ({
        name: s.npcName, gender: s.gender, variant: s.variant, job: s.job || null, arrived: s.arrived, slot: s.slot,
        partner: s.partner || null, child: s.child || 0, lastBaby: s.lastBaby || 0, carry: s.carry || {}, parents: s.parents || null
      }))
    };
  },

  load(scene, data) {
    const t = scene.town;
    if (!data || typeof data !== 'object') return;
    t.rel = {};
    Object.entries(data.rel || {}).forEach(([k, r]) => {
      if (!r) return;
      t.rel[k] = { pts: Number(r.pts) || 0, talk: r.talk || 0, gift: r.gift || 0, claimed: Array.isArray(r.claimed) ? r.claimed : [] };
    });
    REL_KEYS.forEach((k) => relOf(scene, k));
    if (data.board && Array.isArray(data.board.tasks)) {
      t.board = { day: data.board.day || 0, tasks: data.board.tasks.filter((x) => x && x.type && x.amount && (x.type !== 'deliver' || ITEMS[x.item])) };
    }
    t.everArrived = !!data.everArrived;
    survivors(scene).forEach((s) => removeSurvivor(scene, s));
    const main = data.main && typeof data.main === 'object' ? data.main : {};
    people(scene).forEach((n) => {
      if (!REL[n.key]) return;
      const m = main[n.key];
      n.partner = m && typeof m.partner === 'string' ? m.partner : null;
      n.lastBaby = Number(m?.lastBaby) || 0;
    });
    (data.survivors || []).slice(0, MAX_POP).forEach((s) => {
      if (!s || !s.name) return;
      spawnSurvivor(scene, {
        name: s.name, gender: s.gender, parents: s.parents, variant: s.variant || 0, job: SURVIVOR_JOBS[s.job] ? s.job : null, arrived: s.arrived || 1, slot: s.slot,
        partner: typeof s.partner === 'string' ? s.partner : null, child: Math.max(0, Number(s.child) || 0), lastBaby: Number(s.lastBaby) || 0,
        carry: s.carry && typeof s.carry === 'object' ? s.carry : null
      }, false);
    });
    fixPartners(scene);
    syncRecipes(scene);
  }
};
