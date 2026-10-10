// Oyun yönetmeni: tempo (erken gece / erken şafak), adım adım hedefler, ana hedef (Radyo Kulesi → kurtarma = zafer),
// sürü uyarıları, hedef oku, tek seferlik ipuçları, yardım paneli ve zafer sonrası sonsuz mod.
// Oyunun "ne yapmalıyım?" ve "neden devam etmeliyim?" sorularına cevap verir.
import { ITEMS, NIGHT_START, TILE, FARM_ZONE } from '../config.js';
import { addCanvas, R } from '../textures.js';
import { injectCSS, el, featureLayer } from '../ui/dom.js';
import { audio } from '../audio.js';
import { loadRecords, recordEndlessNight } from '../systems/Records.js';

// ---------------- Adım adım hedefler ----------------
const cropsWhere = (s, fn) => { let n = 0; for (const p of s.farm.plots.values()) if (p.crop && fn(p)) n++; return n; };
const OBJECTIVES = [
  { id: 'till',      text: 'Çapayla tarlada 3 kare sür',            hint: 'Çapa seçiliyken soldaki çitli tarlaya tıkla', goal: 3, prog: (s) => s.farm.plots.size, reward: 10 },
  { id: 'plant',     text: '3 tohum ek',                              hint: 'Tohum seçip sürülmüş toprağa tıkla',          goal: 3, prog: (s) => cropsWhere(s, () => true), reward: 10 },
  { id: 'water',     text: 'Ekinlerini sula',                         hint: 'Sulama kabıyla ekili kareye tıkla',           goal: 3, prog: (s) => cropsWhere(s, (p) => p.watered), reward: 10 },
  { id: 'wood',      text: 'Baltayla ağaç kes',                       hint: 'Kasabanın dışındaki ağaçlara git',           goal: 10, prog: (s) => s.inventory.count('wood'), reward: 10 },
  { id: 'barricade', text: 'Barikat üret ve yerleştir',               hint: 'Envanter → Üretim → Barikat, sonra sığınağın önüne koy', goal: 1, prog: (s) => s.barricades.countActive(true), reward: 20 },
  { id: 'night1',    text: 'İlk geceyi atlat',                        hint: 'Sığınağı koru; sürüler kenarlardan gelir',    goal: 1, prog: (s) => s.waves.wave - (s.waves.active ? 1 : 0), reward: 25 },
  { id: 'harvest',   text: 'İlk hasadını yap',                        hint: 'Olgun ekine tıkla',                          goal: 1, prog: (s, st) => (st.harvested ? 1 : 0), reward: 15 },
  { id: 'sell',      text: 'Kemal\'e ürün sat',                       hint: 'Pazar tezgâhındaki Kemal ile konuş → Ticaret → Sat', goal: 1, prog: (s, st) => (st.sold ? 1 : 0), reward: 15 },
  { id: 'pantry',    text: 'Kilere yiyecek bağışla',                 hint: 'Sığınak kapısının sağındaki sandık: kasaba toksa savunucular güçlenir', goal: 1, prog: (s) => (s.pantry?.donated > 0 ? 1 : 0), reward: 15 },
  { id: 'meal',      text: 'Gece öncesi bir güç yemeği ye',          hint: 'Ekmek (3 buğday) veya çorba: şafağa kadar savaş güçlendirmesi verir', goal: 1, prog: (s) => (s.pantry?.eaten > 0 ? 1 : 0), reward: 15 },
  { id: 'turret',    text: 'Taret kur',                               hint: 'Taret: 4 odun + 6 taş + 10 mermi (veya Zeynep\'ten al)', goal: 1, prog: (s) => s.turrets.countActive(true), reward: 30 },
  { id: 'tower1',    text: 'Radyo Kulesi\'nin 1. aşamasını kur',      hint: 'Sığınağın solundaki kule temeline git',       goal: 1, prog: (s, st) => Math.min(1, st.tower), reward: 0 }
];

// Hedef okunun gösterdiği dünya konumu (yoksa null → ok gizlenir)
const farmCenter = () => ({ x: (FARM_ZONE.x + FARM_ZONE.w / 2) * TILE, y: (FARM_ZONE.y + FARM_ZONE.h / 2) * TILE });
const plotPos = (p) => ({ x: p.tx * TILE + 8, y: p.ty * TILE + 8 });
function nearest(s, list, pos = (o) => o) {
  let best = null, bd = Infinity;
  for (const o of list) {
    const q = pos(o), d = Phaser.Math.Distance.Squared(s.player.x, s.player.y, q.x, q.y);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
const npcPos = (s, key) => { const n = s.npcs.find((o) => o.key === key && !o.hidden); return n ? { x: n.x, y: n.y } : null; };
const doorFront = (s) => ({ x: s.shelter.door.x, y: s.shelter.door.y + 14 });
const TARGETS = {
  till: farmCenter,
  plant: (s) => nearest(s, [...s.farm.plots.values()].filter((p) => !p.crop), plotPos) || farmCenter(),
  water: (s) => nearest(s, s.farm.unwatered(), plotPos) || farmCenter(),
  wood: (s) => (s.inventory.count('axe') ? nearest(s, s.resources.getChildren().filter((r) => r.kind === 'tree' && !r.depleted)) : null),
  barricade: doorFront,
  night1: doorFront,
  harvest: (s) => nearest(s, s.farm.ripe(), plotPos),
  sell: (s) => npcPos(s, 'merchant'),
  pantry: (s) => ({ x: s.shelter.door.x + 30, y: s.shelter.door.y }),
  turret: doorFront,
  tower1: () => (tower ? { x: tower.x, y: tower.y + 16 } : null)
};

// ---------------- Radyo Kulesi (ana hedef) ----------------
const STAGES = [
  { cost: { wood: 15, stone: 10 },              coins: 0,   perk: 'Kule ışığı + sığınak +100 can' },
  { cost: { wood: 12, stone: 18 },              coins: 150, perk: 'Kule tüfeği: yakındaki zombilere ateş eder' },
  { cost: { stone: 20, ammo: 20, wood: 10 },    coins: 300, perk: 'Sığınak +200 can, kule tüfeği 2x hızlı' },
  { cost: { wood: 20, stone: 25 },              coins: 500, perk: 'Kurtarma çağrısı: 3 gün sonra SON GECE' }
];
const RESCUE_DELAY = 3;
const SHELTER_BONUS = [0, 100, 100, 300, 300];

const st0 = () => ({ done: [], tower: 0, rescueDay: 0, harvested: false, sold: false, earlyStart: false, finalNight: false, endless: false, endlessStart: 0 });
let st = st0();
let ff = false;            // gece temizlendi → şafağa hızlı ileri
let objTimer = 0;
let gunCd = 0;
let tower = null;
let baseShelterMax = 600;

function costText(stage) {
  const parts = Object.entries(stage.cost).map(([id, n]) => `${n} ${ITEMS[id]?.name || id}`);
  if (stage.coins) parts.push(`${stage.coins} 🪙`);
  return parts.join(', ');
}

function canAfford(s, stage) {
  return s.inventory.has(stage.cost) && s.player.coins >= stage.coins;
}

function applyPerks(s) {
  const sh = s.shelter;
  const max = baseShelterMax + SHELTER_BONUS[st.tower];
  const gain = max - sh.maxHp;
  sh.maxHp = max;
  if (gain > 0) sh.hp = Math.min(max, sh.hp + gain);
  sh.hp = Math.min(sh.hp, sh.maxHp);
  if (tower) tower.setTexture(`radio_tower_${st.tower}`);
}

function buildStage(s) {
  if (st.tower >= STAGES.length) return;
  const stage = STAGES[st.tower];
  if (!canAfford(s, stage)) { audio.sfx('error'); s.hud.notice(`Eksik malzeme: ${costText(stage)}`); return; }
  Object.entries(stage.cost).forEach(([id, n]) => s.inventory.remove(id, n));
  s.player.addCoins(-stage.coins);
  st.tower++;
  applyPerks(s);
  s.events.emit('towerBuilt', st.tower);
  audio.sfx('craft');
  s.spawnParticles(tower.x, tower.y - 20, 0xffd166, 18);
  s.cameras.main.shake(150, 0.004);
  if (st.tower >= STAGES.length) {
    st.rescueDay = s.timeSys.day + RESCUE_DELAY;
    s.hud.banner('📡 Sinyal gönderildi!', `Kurtarma ekibi ${st.rescueDay}. gün gecesi gelecek. O geceyi atlatırsan kazanırsın!`);
  } else {
    s.hud.banner(`Kule ${st.tower}/${STAGES.length}`, STAGES[st.tower - 1].perk);
  }
  s.saveGame(false);
}

function openTowerPanel(s) {
  const body = el('div', 'dr-tower');
  const render = () => {
    body.innerHTML = `<p class="muted">Kasabanın tek umudu: radyo kulesini tamamla, kurtarma ekibini çağır ve son geceyi atlat.</p>`;
    STAGES.forEach((stage, i) => {
      const done = i < st.tower, cur = i === st.tower;
      const row = el('div', `dr-stage ${done ? 'done' : ''} ${cur ? 'cur' : ''}`,
        `<div class="dr-n">${done ? '✓' : i + 1}</div><div class="rinfo"><b>${stage.perk}</b><span class="muted">${costText(stage)}</span></div>`);
      if (cur) {
        const b = el('button', canAfford(s, stage) ? 'primary' : '', 'İnşa et');
        b.disabled = !canAfford(s, stage);
        b.onclick = () => { buildStage(s); render(); };
        row.appendChild(b);
      }
      body.appendChild(row);
    });
    if (st.rescueDay) body.appendChild(el('p', 'dr-rescue', `🚁 Kurtarma: <b>${st.rescueDay}. gün</b> gecesi. Son geceye hazırlan!`));
  };
  render();
  s.hud.openPanel('📡 Radyo Kulesi', body);
}

function placeTower(s) {
  const sh = s.shelter;
  const spots = [[-84, -6], [-84, 40], [90, -40], [-120, -40]];
  for (const [dx, dy] of spots) {
    const x = sh.x + dx, y = sh.y + dy;
    if (!s.physics.overlapRect(x - 10, y + 10, 20, 12, true, true).length) return { x, y };
  }
  return { x: sh.x - 84, y: sh.y - 6 };
}

// ---------------- Sürü uyarısı (ekran kenarında ok) ----------------
function hordeAlert(s, h) {
  const layer = featureLayer();
  if (!layer) return;
  const pos = ['top', 'bottom', 'left', 'right'][h.side];
  const n = el('div', `dr-horde ${pos}`, `⚠️ ${h.count}`);
  layer.appendChild(n);
  setTimeout(() => n.remove(), 4000);
  const dir = { kuzey: 'Kuzeyden', güney: 'Güneyden', batı: 'Batıdan', doğu: 'Doğudan' }[h.sideName] || 'Kenardan';
  s.hud.toast(`${dir} ${h.count} zombilik sürü geliyor!`, 'warn');
}

function currentObjective() {
  return OBJECTIVES.find((o) => !st.done.includes(o.id)) || null;
}

function renderObjective(s) {
  const box = document.getElementById('dr-objective');
  if (!box) return;
  const night = s.timeSys.isNight;
  let html = '';
  const o = currentObjective();
  if (st.endless) {
    const n = s.waves.wave - st.endlessStart;
    html = `♾️ <b>Sonsuz Mod · kurtarmadan sonra ${n}. gece</b><span>Rekor: ${Math.max(loadRecords().bestEndless, s.waves.wave)}. gece · dalgalar her gece büyüyor</span>`;
  } else if (st.rescueDay) {
    const left = st.rescueDay - s.timeSys.day;
    html = left > 0 ? `🚁 <b>Kurtarma ${left} gün sonra</b><span>Savunmanı güçlendir, son gece büyük olacak</span>`
      : `🚁 <b>SON GECE!</b><span>Şafağa kadar dayan, helikopter geliyor</span>`;
  } else if (o) {
    const p = Math.min(o.goal, Math.max(0, o.prog(s, st)));
    html = `🎯 <b>${o.text}</b>${o.goal > 1 ? ` <i>${p}/${o.goal}</i>` : ''}<span>${o.hint}</span>`;
  } else if (st.tower < STAGES.length) {
    html = `📡 <b>Radyo Kulesi ${st.tower}/${STAGES.length}</b><span>Sonraki: ${costText(STAGES[st.tower])}</span>`;
  }
  box.innerHTML = html;
  box.classList.toggle('show', !!html && !night);
}

function checkObjectives(s) {
  const o = currentObjective();
  if (!o) return;
  if (o.prog(s, st) >= o.goal) {
    st.done.push(o.id);
    if (o.reward) s.player.addCoins(o.reward);
    audio.sfx('quest');
    s.hud.toast(`✅ Hedef tamam: ${o.text}${o.reward ? ` · +${o.reward} 🪙` : ''}`, 'ok');
  }
}

// Gösterilecek hedef konumu: önce adım hedefi, sonra kule (kurtarma çağrılana kadar)
function targetPos(s) {
  if (s.timeSys.isNight || st.endless || st.rescueDay) return null;
  const o = currentObjective();
  if (o) return TARGETS[o.id]?.(s) || null;
  return st.tower < STAGES.length && tower ? { x: tower.x, y: tower.y + 16 } : null;
}

// ---------------- Hedef oku (dünya içi) ----------------
let guide = null;
function makeGuide(s) {
  const arrow = s.add.image(0, 0, 'dr_arrow').setDepth(10003).setVisible(false);
  const dist = s.add.text(0, 0, '', { fontFamily: 'Outfit, sans-serif', fontSize: '6px', color: '#ffd166', stroke: '#000', strokeThickness: 2, resolution: 4 })
    .setOrigin(0.5).setDepth(10003).setVisible(false);
  const pin = s.add.image(0, 0, 'dr_pin').setDepth(10003).setVisible(false);
  guide = { arrow, dist, pin, t: 0 };
}

function updateGuide(s, dt) {
  if (!guide) return;
  const { arrow, dist, pin } = guide;
  const target = prefs.arrow && s.player.alive ? targetPos(s) : null;
  const p = s.player;
  const d = target ? Phaser.Math.Distance.Between(p.x, p.y, target.x, target.y) : 0;
  const show = !!target && d > 36;
  arrow.setVisible(show); dist.setVisible(show);
  pin.setVisible(!!target);
  if (!target) return;
  guide.t += dt;
  pin.setPosition(target.x, target.y - 14 + Math.sin(guide.t * 5) * 2);
  if (!show) return;
  const a = Phaser.Math.Angle.Between(p.x, p.y, target.x, target.y);
  const r = 18 + Math.sin(guide.t * 6) * 1.5;
  arrow.setPosition(p.x + Math.cos(a) * r, p.y - 2 + Math.sin(a) * r).setRotation(a);
  dist.setPosition(p.x + Math.cos(a) * (r + 10), p.y - 2 + Math.sin(a) * (r + 10)).setText(`${Math.round(d / TILE)}m`);
  if (!st.done.length) tip(s, 'arrow');
}

// ---------------- Tek seferlik bağlamsal ipuçları ----------------
const TIP_KEY = 'zombi-ciftlik-tips-v1';
const PREF_KEY = 'zombi-ciftlik-guide-v1';
const isTouch = () => document.body.classList.contains('is-touch');
const TIPS = {
  move: () => (isTouch() ? 'Sol alttaki joystick ile yürü, sağdaki büyük butonla seçili aleti kullan.' : 'WASD / ok tuşlarıyla yürü. Seçili aleti fareyle tıklayarak (ya da Boşluk) kullan. 1–8 ile alet seç.'),
  arrow: () => 'Sarı ok sıradaki hedefi gösteriyor; yanındaki sayı kalan mesafe. Hedefin üstünde de küçük bir işaret var.',
  talk: () => (isTouch() ? 'Yakındaki kişiyle ✋ butonuyla konuş: görev, ticaret ve hediye.' : 'E tuşuyla yakındaki kişiyle konuş: görev, ticaret ve hediye.'),
  dusk: () => 'Hava kararıyor: 20:00\'de zombiler gelir. Sığınağın yakınında ol ve silahını seç.',
  night: () => 'Sürüler harita kenarlarından gelir; kırmızı uyarı yönü gösterir. Sığınak düşerse oyun biter!',
  lowhp: () => 'Canın az! Yiyecek seçip kullan ya da Doktor Selin\'e git. Bayılırsan altının bir kısmını kaybedersin.',
  energy: () => 'Enerjin bitiyor. Yemek ye; şafakta enerjin de yenilenir.',
  board: () => 'Sığınağın sağındaki 📋 İlan Panosu\'nda her gün 3 yeni görev var: teslim, öldür, hayatta kal.',
  help: () => (isTouch() ? 'Takılırsan ☰ menüsündeki ❓ Yardım sayfasına bak.' : 'Takılırsan ❓ Yardım (H) sayfasına bak.')
};
let seenTips = new Set();
let prefs = { arrow: true };
let tipQueue = [];
let tipCd = 0;
let tipT = 0;

function loadTipState() {
  try { seenTips = new Set(JSON.parse(localStorage.getItem(TIP_KEY)) || []); } catch { seenTips = new Set(); }
  try { prefs = { arrow: true, ...(JSON.parse(localStorage.getItem(PREF_KEY)) || {}) }; } catch { prefs = { arrow: true }; }
}
function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* depolama kapalı */ } }

function tip(s, id) {
  if (seenTips.has(id) || tipQueue.includes(id)) return;
  tipQueue.push(id);
}

function showTip(id) {
  const box = document.getElementById('dr-tip');
  if (!box) return;
  seenTips.add(id);
  saveJSON(TIP_KEY, [...seenTips]);
  box.innerHTML = `<span>💡 ${TIPS[id]()}</span>`;
  const x = el('button', 'dr-tip-x', '✕');
  x.setAttribute('aria-label', 'Kapat');
  x.onclick = () => { box.classList.remove('show'); tipT = 0; };
  box.appendChild(x);
  box.classList.add('show');
  tipT = 8;
  placeTip();
}

// Hedef kutusu yüksekliği (mobilde birkaç satır) değişebildiği için ipucu her zaman onun altına yerleşir
function placeTip() {
  const box = document.getElementById('dr-tip'), ob = document.getElementById('dr-objective');
  if (!box || !ob) return;
  box.style.top = ob.classList.contains('show') ? `${ob.offsetTop + ob.offsetHeight + 8}px` : '';
}

function updateTips(s, dt) {
  const p = s.player, ts = s.timeSys;
  if (!ts.isNight && ts.minutes >= 18 * 60) tip(s, 'dusk');
  if (s.waves.active) tip(s, 'night');
  if (p.alive && p.hp < p.maxHp * 0.35) tip(s, 'lowhp');
  if (p.energy < p.maxEnergy * 0.2) tip(s, 'energy');
  if (ts.day >= 2 && !ts.isNight) tip(s, 'board');
  if (s.npcs.some((n) => !n.hidden && Phaser.Math.Distance.Between(p.x, p.y, n.x, n.y) < 30)) tip(s, 'talk');
  if (s.prog?.stats?.playTime > 50 || ts.day >= 2) tip(s, 'help');
  if (tipT > 0) {
    tipT -= dt;
    placeTip();
    if (tipT <= 0) document.getElementById('dr-tip')?.classList.remove('show');
    return;
  }
  tipCd -= dt;
  // Dalga/olay bannerı ekrandayken ipucu bekler; aksi halde üst üste biniyorlar
  if (tipCd > 0 || !tipQueue.length || s.hud.bannerTimer) return;
  showTip(tipQueue.shift());
  tipCd = 4;
}

// ---------------- Yardım paneli ----------------
function openHelp(s) {
  const touch = isTouch();
  const ctl = touch
    ? [['Yürü', 'Sol alttaki joystick'], ['Kullan / saldır', 'Sağdaki büyük buton (basılı tut = tekrar, sürükle = nişan)'], ['Konuş / etkileş', '✋ butonu'], ['Envanter', '🎒'], ['Tüm paneller', '☰ menü']]
    : [['Yürü', 'WASD / Ok tuşları'], ['Kullan / saldır', 'Sol tık veya Boşluk'], ['Alet seç', '1–8 / fare tekerleği'], ['Konuş / etkileş', 'E'], ['Envanter', 'I / Tab'], ['Kaçış', 'Shift'], ['Kaydet', 'K (gündüz)'], ['Yetenek / Başarım', 'L / J'], ['Yardım', 'H']];
  const body = el('div', 'dr-help', `
    <h4>🎯 Amaç</h4>
    <p>Gündüz tarlanı işle ve hazırlan, gece kasabayı zombilere karşı savun. <b>Radyo Kulesi</b>'ni 4 aşamada kur; kurtarma ekibi gelene kadar dayanırsan kazanırsın. Kurtarmadan sonra istersen <b>Sonsuz Mod</b> ile devam edebilirsin.</p>
    <h4>🎮 Kontroller</h4>
    <div class="dr-keys">${ctl.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>
    <h4>☀️ Gündüz</h4>
    <p>Çapala → tohum ek → sula (kuru toprakta ekin büyümez). Ağaç kes, taş kır, ürün sat. Ekranın üstündeki hedef ve sarı ok sıradaki adımı gösterir.</p>
    <h4>🌙 Gece</h4>
    <p>Sürüler kenarlardan gelir. Barikat ve taretleri sığınağın çevresine kur. Sürüyü erken temizlersen şafak çabuk gelir ve ödül alırsın.</p>
    <h4>❤️ Kasaba</h4>
    <p>Her gün konuş ve sevdikleri şeyleri hediye et. 3♥ indirim, 4♥ gece yardımı, 6♥ özel tarif, 8♥ özel hediye. 📋 İlan Panosu'nda her gün 3 görev var.</p>
    <h4>🧺 Kiler</h4>
    <p>Kasaba tokken savunucular güçlenir. Fazla ürünü sığınak kapısının sağındaki sandığa bağışla.</p>`);
  const row = el('div', 'dr-help-btns');
  const arrowBtn = el('button', '', '');
  const syncArrow = () => { arrowBtn.textContent = prefs.arrow ? '➤ Hedef oku: Açık' : '➤ Hedef oku: Kapalı'; };
  syncArrow();
  arrowBtn.onclick = () => { prefs.arrow = !prefs.arrow; saveJSON(PREF_KEY, prefs); audio.sfx('click'); syncArrow(); };
  const resetBtn = el('button', '', '💡 İpuçlarını yeniden göster');
  resetBtn.onclick = () => { seenTips.clear(); saveJSON(TIP_KEY, []); audio.sfx('click'); resetBtn.textContent = '✓ İpuçları sıfırlandı'; resetBtn.disabled = true; };
  row.append(arrowBtn, resetBtn);
  body.appendChild(row);
  s.hud.openPanel('❓ Yardım', body);
}

// ---------------- Sonsuz mod ----------------
function offerEndless(s) {
  if (s.gameOver) return;
  let won = false;
  const best = loadRecords().bestEndless;
  const body = el('div', 'dr-end', `
    <p>Helikopter indi, kasaba kurtarıldı! İstersen burada zaferle bitir ya da kalıp savunmaya devam et.</p>
    <p class="muted">Sonsuz modda dalgalar her gece büyür. Dayandığın en yüksek gece rekorlara yazılır${best ? ` (rekor: <b>${best}. gece</b>)` : ''}. Zafer puanın korunur.</p>`);
  const row = el('div', 'dr-help-btns');
  const win = el('button', '', '🏁 Zaferle bitir');
  const go = el('button', 'primary', '♾️ Devam et (sonsuz)');
  win.onclick = () => { won = true; s.hud.closeAll(); s.onVictory(); };
  go.onclick = () => s.hud.closeAll();
  row.append(win, go);
  body.appendChild(row);
  // Panel nasıl kapanırsa kapansın (Esc, arka plan) varsayılan devam etmektir: oyuncu ilerlemesini kaybetmesin
  s.hud.openPanel('🚁 Kurtarıldınız!', body, () => { if (!won) startEndless(s); });
}

function startEndless(s) {
  if (s.gameOver || st.endless) return;
  st.endless = true;
  st.finalNight = false;
  st.endlessStart = s.waves.wave;
  s.hud.banner('♾️ Sonsuz Mod', 'Kasaba seninle. Dalgalar her gece büyüyecek — ne kadar dayanabilirsin?');
  s.saveGame(false);
}

// Sonsuz modda oyun sonu: sonuç ekranını kurtarma sonrası geceleri anlatacak şekilde düzelt
function endlessGameOverText(s) {
  const g = document.getElementById('gameover');
  if (!g) return;
  const n = s.waves.wave - st.endlessStart;
  g.querySelector('.go-title').textContent = 'Sonsuz Mod Bitti';
  const stats = g.querySelector('.stats');
  const extra = stats.textContent.includes(' · Hasat:') ? stats.textContent.slice(stats.textContent.indexOf(' · Hasat:')) : '';
  stats.textContent = `Kurtarmadan sonra ${n} gece daha dayandın (${s.waves.wave}. gece). Öldürülen zombi: ${s.kills}${extra}`;
}

export default {
  id: 'director',

  textures(scene) {
    // Sağa bakan ok: önce koyu dış hat, sonra sarı gövde (döndürülerek hedefe çevrilir)
    addCanvas(scene, 'dr_arrow', 11, 11, (ctx) => {
      const shape = (c, o) => {
        R(ctx, 1 - o, 4 - o, 5 + o, 3 + o * 2, c);
        for (let i = 0; i < 5; i++) R(ctx, 5 + i, 1 + i - o, 1 + o, 9 - i * 2 + o * 2, c);
      };
      shape('#1a1a1a', 1);
      shape('#ffd166', 0);
    });
    addCanvas(scene, 'dr_pin', 7, 8, (ctx) => {
      R(ctx, 0, 0, 7, 3, '#1a1a1a'); R(ctx, 1, 3, 5, 2, '#1a1a1a'); R(ctx, 2, 5, 3, 2, '#1a1a1a'); R(ctx, 3, 7, 1, 1, '#1a1a1a');
      R(ctx, 1, 1, 5, 2, '#ffd166'); R(ctx, 2, 3, 3, 2, '#ffd166'); R(ctx, 3, 5, 1, 2, '#ffd166');
    });
    // Kule: 0 = temel kazıkları … 4 = tamamlanmış anten
    for (let k = 0; k <= 4; k++) {
      addCanvas(scene, `radio_tower_${k}`, 24, 56, (ctx) => {
        R(ctx, 2, 50, 20, 6, '#6f717b'); R(ctx, 2, 50, 20, 1, '#9aa3ad');
        if (k === 0) { for (const x of [4, 11, 18]) R(ctx, x, 44, 2, 6, '#8a5a3a'); return; }
        const top = 50 - k * 11;
        R(ctx, 5, top, 2, 50 - top, '#5a5d66'); R(ctx, 17, top, 2, 50 - top, '#5a5d66');
        for (let y = top; y < 50; y += 6) { R(ctx, 5, y, 14, 1, '#7d808a'); for (let i = 0; i < 6; i++) R(ctx, 6 + i * 2, y + i, 1, 1, '#7d808a'); }
        if (k >= 2) { R(ctx, 3, top - 3, 18, 3, '#3a3a44'); }
        if (k >= 3) { R(ctx, 10, top - 8, 4, 5, '#2c2c34'); R(ctx, 8, top - 6, 2, 2, '#ffd166'); }
        if (k >= 4) { R(ctx, 11, 0, 2, top - 8, '#9aa3ad'); R(ctx, 10, 0, 4, 2, '#ff5a5a'); R(ctx, 7, 6, 10, 1, '#9aa3ad'); }
      });
    }
  },

  init(scene) {
    st = st0();
    ff = false;
    objTimer = 0;
    gunCd = 0;
    baseShelterMax = scene.shelter.maxHp;
    tipQueue = [];
    tipCd = 2;
    tipT = 0;
    loadTipState();
    makeGuide(scene);

    injectCSS('director', `
      #dr-objective { position: absolute; left: 50%; top: calc(var(--hud-h, 72px) + 8px); transform: translateX(-50%) translateY(-6px);
        max-width: min(440px, calc(100vw - 32px)); padding: 8px 14px; border-radius: 12px; font-size: 13px; opacity: 0; pointer-events: none;
        background: var(--glass-strong); border: 1px solid rgba(255,209,102,.35); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        transition: opacity .25s, transform .25s; text-align: center; }
      #dr-objective.show { opacity: 1; transform: translateX(-50%); }
      #dr-objective b { font-weight: 600; } #dr-objective i { font-style: normal; color: var(--accent); margin-left: 4px; font-weight: 600; }
      #dr-objective span { display: block; font-size: 11px; color: var(--muted); margin-top: 2px; }
      .dr-horde { position: absolute; z-index: 30; padding: 6px 12px; border-radius: 99px; font-weight: 700; font-size: 14px; pointer-events: none;
        background: rgba(200, 40, 40, .85); color: #fff; box-shadow: 0 0 20px rgba(255,60,60,.6); animation: drPulse .6s ease-in-out infinite alternate; }
      .dr-horde.top { top: calc(var(--hud-h, 72px) + 50px); left: 50%; transform: translateX(-50%); }
      .dr-horde.bottom { bottom: 150px; left: 50%; transform: translateX(-50%); }
      .dr-horde.left { left: 12px; top: 45%; } .dr-horde.right { right: 64px; top: 45%; }
      @keyframes drPulse { from { opacity: .65; } to { opacity: 1; } }
      .dr-tower .dr-stage { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 10px; background: rgba(255,255,255,.05); margin-top: 8px; }
      .dr-tower .dr-stage.done { opacity: .55; } .dr-tower .dr-stage.cur { border: 1px solid rgba(255,209,102,.45); }
      .dr-tower .dr-n { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,.1); font-weight: 700; flex-shrink: 0; }
      .dr-tower .rinfo { min-width: 0; } .dr-rescue { margin-top: 12px; color: var(--accent); }
      #dr-tip { position: absolute; left: 50%; top: calc(var(--hud-h, 72px) + 66px); transform: translateX(-50%) translateY(-6px); z-index: 25;
        max-width: min(420px, calc(100vw - 32px)); display: flex; gap: 8px; align-items: flex-start; padding: 8px 8px 8px 12px; border-radius: 12px;
        font-size: 12.5px; line-height: 1.35; opacity: 0; pointer-events: none; transition: opacity .25s, transform .25s;
        background: var(--glass-strong); border: 1px solid rgba(110,182,255,.4); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
      #dr-tip.show { opacity: 1; transform: translateX(-50%); pointer-events: auto; }
      body.modal-open #dr-tip.show { opacity: 0; pointer-events: none; }
      #dr-tip span { flex: 1; }
      #dr-tip .dr-tip-x { min-width: 32px; min-height: 32px; padding: 0; flex: none; font-size: 12px; }
      .dr-help h4 { margin: 12px 0 4px; font-size: 14px; } .dr-help h4:first-child { margin-top: 0; }
      .dr-help p { margin: 0; font-size: 13px; line-height: 1.45; opacity: .9; }
      .dr-help, .dr-end { max-height: 64vh; overflow-y: auto; }
      .dr-keys { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 14px; font-size: 12.5px; }
      .dr-keys div { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
      .dr-keys b { color: var(--accent); font-weight: 600; text-align: right; }
      .dr-help-btns { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
      .dr-help-btns button { flex: 1 1 160px; min-height: 44px; }
      .dr-end p { margin: 0 0 8px; font-size: 13.5px; line-height: 1.45; }
      body.is-touch.portrait #modal-feature:has(.dr-help), body.is-touch.portrait #modal-feature:has(.dr-end) { width: 100%; }
      @media (max-width: 520px) { .dr-keys { grid-template-columns: 1fr; } }
    `);
    featureLayer()?.querySelector('#dr-objective')?.remove();
    featureLayer()?.appendChild(el('div', '', '')).setAttribute('id', 'dr-objective');
    featureLayer()?.querySelector('#dr-tip')?.remove();
    featureLayer()?.appendChild(el('div', '', '')).setAttribute('id', 'dr-tip');
    scene.featureMenu.push({ id: 'help', icon: '❓', label: 'Yardım', key: 'H', open: (s) => openHelp(s) });
    const onKey = (e) => {
      if (!scene.started || scene.gameOver || e.repeat) return;
      if (e.key.toLowerCase() !== 'h' && e.key !== '?') return;
      if (document.querySelector('#modal-feature .dr-help')) { scene.hud.closeAll(); return; }
      if (!scene.hud.isModalOpen()) openHelp(scene);
    };
    scene.input.keyboard?.on('keydown', onKey);

    // Kule
    const p = placeTower(scene);
    tower = scene.physics.add.staticImage(p.x, p.y, 'radio_tower_0');
    tower.body.setSize(20, 10).setOffset(2, 44);
    tower.setDepth(p.y + 26);
    scene.physics.add.collider(scene.player, tower);
    scene.physics.add.collider(scene.zombies, tower);
    scene.lightSources.push(() => (st.tower >= 1 ? [{ x: tower.x, y: tower.y - 10, r: 95 }] : []));
    scene.addInteraction((s) => {
      const d = Phaser.Math.Distance.Between(s.player.x, s.player.y, tower.x, tower.y + 20);
      if (d > 34) return null;
      const label = st.tower >= STAGES.length ? 'Radyo Kulesi (tamamlandı)' : `Radyo Kulesi: ${st.tower + 1}. aşama`;
      return { dist: d, label, run: () => openTowerPanel(s) };
    });
    scene.featureMenu.push({ id: 'tower', icon: '📡', label: 'Radyo Kulesi', open: (s) => openTowerPanel(s) });

    // Geceyi erken başlat (sığınak kapısında, gündüz)
    scene.addInteraction((s) => {
      const m = s.timeSys.minutes;
      if (s.timeSys.isNight || m < 8 * 60 || m > NIGHT_START - 30 || s.timeSys.speedMul > 1) return null;
      const d = Phaser.Math.Distance.Between(s.player.x, s.player.y, s.shelter.door.x, s.shelter.door.y);
      if (d > 26) return null;
      return {
        dist: d + 2, label: 'Geceyi erken başlat (+%30 ödül)',
        run: () => {
          st.earlyStart = true;
          s.timeSys.speedMul = 14;
          audio.sfx('alarm');
          s.hud.toast('Zaman hızlandı… Gece geliyor! Erken başlattığın için ödül +%30.', 'warn');
        }
      };
    });

    // Hasat ve satış tespiti (hedef zinciri için)
    const farm = scene.farm;
    const harvest = farm.harvest.bind(farm);
    farm.harvest = (...a) => { const r = harvest(...a); if (r) st.harvested = true; return r; };
    const player = scene.player;
    const addCoins = player.addCoins.bind(player);
    player.addCoins = (n) => { if (n > 0 && scene.hud?.modal === 'shop') st.sold = true; return addCoins(n); };

    const ev = scene.events;
    const onHorde = (h) => hordeAlert(scene, h);
    const onWaveStart = (w) => {
      ff = false;
      scene.timeSys.speedMul = 1;
      if (st.rescueDay && !st.endless && scene.timeSys.day >= st.rescueDay) {
        st.finalNight = true;
        scene.hud.banner('SON GECE', 'Kurtarma helikopteri şafakta geliyor. Dayan!');
      }
    };
    const onWaveEnd = (w) => {
      if (st.earlyStart) {
        const bonus = Math.round(15 * w * 0.3 * (scene.difficulty?.reward ?? 1));
        scene.player.addCoins(bonus);
        scene.hud.toast(`Erken başlatma ödülü: +${bonus} 🪙`, 'ok');
        st.earlyStart = false;
      }
      if (st.finalNight) {
        st.finalNight = false;
        scene.hud.banner('🚁 Kurtarma geldi!', 'Kasaba hayatta kaldı!');
        scene.events.emit('rescued');
        scene.time.delayedCall(2600, () => offerEndless(scene));
      } else if (st.endless) {
        scene.events.emit('endlessNight', w - st.endlessStart);
        if (recordEndlessNight(w)) scene.hud.toast(`♾️ Yeni sonsuz mod rekoru: ${w}. gece!`, 'ok');
      }
    };
    ev.on('hordeIncoming', onHorde);
    ev.on('waveStart', onWaveStart);
    ev.on('waveEnd', onWaveEnd);
    // Son gece: kanlı ay + garantili boss
    const prevDecider = scene.waves.bloodDecider;
    const finalNow = () => st.rescueDay && !st.endless && scene.timeSys.day >= st.rescueDay;
    scene.waves.bloodDecider = (w) => finalNow() || (prevDecider ? prevDecider(w) : false);
    const makePlan = scene.waves.makePlan.bind(scene.waves);
    scene.waves.makePlan = (w, blood) => {
      const plan = makePlan(w, blood);
      if (finalNow()) {
        plan.counts.boss = Math.max(1, plan.counts.boss || 0);
        plan.sides = [0, 1, 2, 3];
      } else if (st.endless) {
        // Sonsuz mod: normal büyümenin üstüne her gece %12 daha kalabalık, 3 gecede bir boss, 2. geceden sonra her yönden
        const k = Math.max(1, w - st.endlessStart);
        const mul = 1 + 0.12 * k;
        for (const key of Object.keys(plan.counts)) if (key !== 'boss') plan.counts[key] = Math.round(plan.counts[key] * mul);
        if (k % 3 === 0) plan.counts.boss = Math.max(1, plan.counts.boss || 0) + Math.floor(k / 6);
        if (k >= 2) plan.sides = [0, 1, 2, 3];
      }
      return plan;
    };
    // Sonsuz modda kaybedilse de kurtarma gerçekleşti: zafer sayılır, sonsuz gece rekoru işlenir
    const runStats = scene.runStats.bind(scene);
    scene.runStats = (victory) => (st.endless ? { ...runStats(true), endless: true } : runStats(victory));
    const onFallen = () => { if (st.endless) endlessGameOverText(scene); };
    ev.on('shelterFallen', onFallen);
    scene.timeSys.on('dawn', () => { ff = false; scene.timeSys.speedMul = 1; });
    scene.events.once('shutdown', () => {
      ev.off('hordeIncoming', onHorde); ev.off('waveStart', onWaveStart); ev.off('waveEnd', onWaveEnd); ev.off('shelterFallen', onFallen);
      scene.input.keyboard?.off('keydown', onKey);
      document.getElementById('dr-objective')?.remove();
      document.getElementById('dr-tip')?.remove();
      guide = null;
    });
  },

  begin(scene, isNew) {
    applyPerks(scene);
    if (isNew) {
      scene.time.delayedCall(3500, () => scene.hud.toast('🎯 Ekranın üstündeki hedefleri ve sarı oku takip et. Ana hedef: Radyo Kulesi\'ni kurup kurtarma çağırmak.', 'info'));
      tip(scene, 'move');
    }
    renderObjective(scene);
  },

  update(scene, dt) {
    const w = scene.waves;
    // Gündüz yavaş iyileşme: bir sonraki geceye tamamen yaralı başlanmasın (hızlı iyileşme için yemek/doktor)
    const p = scene.player;
    if (!scene.timeSys.isNight && p.alive && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + dt * 0.5);
    // Gece erken temizlendi → şafağa hızlı ilerle
    if (w.active && !ff && w.toSpawn === 0 && !(w.pending?.length) && scene.zombies.countActive(true) === 0) {
      ff = true;
      scene.timeSys.speedMul = 12;
      const bonus = Math.round(8 * w.wave * (scene.difficulty?.reward ?? 1));
      scene.player.addCoins(bonus);
      scene.hud.banner('Sürü temizlendi!', `Şafak yaklaşıyor · temizleme ödülü +${bonus} 🪙`);
    }
    // Kule tüfeği
    if (st.tower >= 2 && tower) {
      gunCd -= dt;
      if (gunCd <= 0) {
        let best = null, bd = 150;
        for (const z of scene.zombies.getChildren()) {
          if (z.dead) continue;
          const d = Phaser.Math.Distance.Between(tower.x, tower.y, z.x, z.y);
          if (d < bd) { bd = d; best = z; }
        }
        if (best) {
          gunCd = st.tower >= 3 ? 0.55 : 1.1;
          scene.fireBullet(tower.x, tower.y - 24, Phaser.Math.Angle.Between(tower.x, tower.y - 24, best.x, best.y), 2, 300);
          audio.sfx('turret');
        } else gunCd = 0.3;
      }
    }
    updateGuide(scene, dt);
    updateTips(scene, dt);
    objTimer -= dt;
    if (objTimer <= 0) {
      objTimer = 0.5;
      checkObjectives(scene);
      renderObjective(scene);
    }
  },

  save() { return { ...st }; },

  load(scene, d) {
    if (!d) return;
    st = { ...st0(), ...d, done: Array.isArray(d.done) ? d.done.filter((id) => OBJECTIVES.some((o) => o.id === id)) : [] };
    st.tower = Phaser.Math.Clamp(st.tower | 0, 0, STAGES.length);
    st.finalNight = false;
    st.earlyStart = false;
    st.endless = !!d.endless;
    st.endlessStart = st.endless ? Math.max(0, d.endlessStart | 0) : 0;
    applyPerks(scene);
  }
};
