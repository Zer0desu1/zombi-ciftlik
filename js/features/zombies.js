// 'zombies' özellik modülü — zombi türleri, ganimet, Kanlı Ay, dalga önizlemesi, patron can barı, tehdit rehberi.
// Sözleşme için registry.js'e bak.
import { ITEMS, RECIPES } from '../config.js';
import { addCanvas, R, makeHumanoid, basePal, iconURL } from '../textures.js';
import { injectCSS, el, featureLayer } from '../ui/dom.js';
import { audio } from '../audio.js';
import { ZOMBIE_TYPES, updateZombieFx, clearZombieFx } from '../entities/Zombie.js';
import { SIDE_NAMES, KIND_ORDER } from '../systems/WaveManager.js';

// ---------- Yeni eşyalar ve tarifler ----------
ITEMS.scrap = { name: 'Hurda', type: 'material', icon: 'i_scrap', sell: 4, desc: 'Zombilerden düşen metal parçaları. Mermi yapımında kullanılır.' };
ITEMS.rare_core = { name: 'Nadir Çekirdek', type: 'material', icon: 'i_rare_core', sell: 60, desc: 'Parlayan gizemli çekirdek. Çok değerli; taret yapımında da işe yarar.' };
RECIPES.push({ out: 'ammo', qty: 8, cost: { scrap: 2 } });
RECIPES.push({ out: 'turret', qty: 1, cost: { rare_core: 1, scrap: 4 } });

// Hangi dalgadan itibaren görülür (rehber için)
const FROM_WAVE = { normal: 1, runner: 2, brute: 3, bloater: 3, spitter: 4, armored: 6, boss: 5 };
const LOOT_MAX = 60, MAGNET = 24, LOOT_LIFE = 90;

const isBloodNight = (w) => w % 7 === 0 || (w >= 3 && Math.random() < 0.1);

// ---------- Dokular ----------
function makeTextures(scene) {
  const zpal = (o) => basePal(Object.assign({ S: '#7fb069', E: '#ff3b3b', H: '#3c5a2e', C: '#5b6b7a', D: '#3e4a55', P: '#4a3f35' }, o));
  // Koşucu: sıska, kırmızı gözlü, yırtık kırmızı tişört
  makeHumanoid(scene, 'zombie_runner', zpal({ S: '#9bc46f', E: '#ff1a1a', H: '#2f4a22', C: '#a33a3a', D: '#7a2a2a', P: '#3a3a4a' }), (ctx, ox, f) => {
    R(ctx, ox + 5, 0, 1, 2, '#2f4a22'); R(ctx, ox + 9, 0, 1, 1, '#2f4a22'); R(ctx, ox + 11, 1, 1, 1, '#2f4a22');
    R(ctx, ox + 7, 10, 2, 2, '#9bc46f'); // yırtık
    R(ctx, ox + (f ? 1 : 2), 9, 1, 1, '#c8e6a0'); // hız izi
  });
  // Tükürükçü: sarımsı, salyalı ağız
  makeHumanoid(scene, 'zombie_spitter', zpal({ S: '#b5c95a', E: '#fff36b', H: '#55692a', C: '#4e7d3a', D: '#365a28', P: '#3d3a2a' }), (ctx, ox, f) => {
    R(ctx, ox + 6, 7, 4, 1, '#3a5a1a'); R(ctx, ox + 7, 8, 1, f ? 3 : 2, '#6dff3a'); R(ctx, ox + 9, 8, 1, 1, '#6dff3a');
    R(ctx, ox + 4, 3, 1, 1, '#d9ef7a');
  });
  // Patlayan: şiş göbek, sivilceler
  makeHumanoid(scene, 'zombie_bloater', zpal({ S: '#8fae5a', E: '#ff7a1a', H: '#4a5a2a', C: '#9aa860', D: '#7d8a48', P: '#4a3f35' }), (ctx, ox, f) => {
    R(ctx, ox + 2, 8, 12, 4, '#1b1622'); R(ctx, ox + 3, 8, 10, 4, '#b7c76b'); R(ctx, ox + 4, 9, 8, 2, '#c9d77a');
    R(ctx, ox + 5, 9, 1, 1, '#e0a23a'); R(ctx, ox + 10, 10, 1, 1, '#e0a23a'); R(ctx, ox + 8, 8 + f, 1, 1, '#ff7a1a');
  });
  // Zırhlı: miğfer ve göğüs plakası
  makeHumanoid(scene, 'zombie_armored', zpal({ S: '#7fb069', E: '#ff3b3b', H: '#8a8f99', C: '#6d737d', D: '#4d525b', P: '#3b3b45' }), (ctx, ox) => {
    R(ctx, ox + 4, 1, 8, 3, '#a8aeb8'); R(ctx, ox + 4, 1, 8, 1, '#c8ccd4'); R(ctx, ox + 4, 4, 1, 2, '#a8aeb8'); R(ctx, ox + 11, 4, 1, 2, '#a8aeb8');
    R(ctx, ox + 5, 8, 6, 3, '#9aa0aa'); R(ctx, ox + 6, 9, 4, 1, '#c8ccd4'); R(ctx, ox + 3, 9, 1, 2, '#8a8f99'); R(ctx, ox + 12, 9, 1, 2, '#8a8f99');
  });
  // Mezar Bekçisi: kemik taç, koyu pelerin, kürek
  makeHumanoid(scene, 'zombie_boss', zpal({ S: '#6d8a7a', E: '#ff5522', H: '#2a2a2a', C: '#3a2e4a', D: '#241c30', P: '#1c1c1c', B: '#111' }), (ctx, ox, f) => {
    R(ctx, ox + 4, 0, 1, 2, '#e8dcb0'); R(ctx, ox + 7, 0, 2, 1, '#e8dcb0'); R(ctx, ox + 11, 0, 1, 2, '#e8dcb0'); R(ctx, ox + 4, 1, 8, 1, '#c9b98a');
    R(ctx, ox + 2, 8, 1, 4, '#241c30'); R(ctx, ox + 13, 8, 1, 4, '#241c30');
    R(ctx, ox + 14, 3 + f, 1, 9, '#7a5a3a'); R(ctx, ox + 13, 11 + f, 3, 3, '#9aa0aa');
  });
  ['zombie_runner', 'zombie_spitter', 'zombie_bloater', 'zombie_armored', 'zombie_boss'].forEach((key) => {
    if (scene.anims.exists(`${key}_walk`)) return;
    scene.anims.create({ key: `${key}_walk`, frames: [{ key, frame: 0 }, { key, frame: 1 }], frameRate: key === 'zombie_runner' ? 8 : key === 'zombie_boss' ? 3 : 4, repeat: -1 });
  });

  // Ganimet ve efekt dokuları
  addCanvas(scene, 'i_scrap', 16, 16, (ctx) => {
    R(ctx, 3, 8, 6, 4, '#5a5f68'); R(ctx, 4, 8, 4, 1, '#9aa0aa'); R(ctx, 8, 5, 5, 3, '#6d737d'); R(ctx, 9, 5, 3, 1, '#b8bec8');
    R(ctx, 6, 11, 7, 2, '#4a4e56'); R(ctx, 11, 9, 2, 2, '#a86a3a'); R(ctx, 4, 6, 2, 2, '#8a8f99');
  });
  addCanvas(scene, 'i_rare_core', 16, 16, (ctx) => {
    R(ctx, 5, 3, 6, 10, '#3a1f5a'); R(ctx, 3, 5, 10, 6, '#3a1f5a'); R(ctx, 4, 4, 8, 8, '#7b3fd0');
    R(ctx, 5, 5, 6, 6, '#a86bff'); R(ctx, 6, 6, 3, 3, '#e6d2ff'); R(ctx, 7, 7, 1, 1, '#fff');
  });
  addCanvas(scene, 'z_coin', 6, 6, (ctx) => {
    R(ctx, 1, 0, 4, 6, '#8a5a14'); R(ctx, 0, 1, 6, 4, '#8a5a14'); R(ctx, 1, 1, 4, 4, '#f2c94c'); R(ctx, 2, 1, 1, 3, '#fff3b0');
  });
  addCanvas(scene, 'z_acid', 5, 5, (ctx) => {
    R(ctx, 1, 0, 3, 5, '#3f8a1a'); R(ctx, 0, 1, 5, 3, '#3f8a1a'); R(ctx, 1, 1, 3, 3, '#8fe04a'); R(ctx, 1, 1, 1, 1, '#e6ffb0');
  });
  addCanvas(scene, 'z_acid_pool', 14, 8, (ctx) => {
    R(ctx, 3, 0, 8, 8, '#4f9a22'); R(ctx, 1, 1, 12, 6, '#4f9a22'); R(ctx, 0, 2, 14, 4, '#4f9a22');
    R(ctx, 3, 2, 8, 4, '#7fd03a'); R(ctx, 4, 2, 2, 1, '#c8ff8a'); R(ctx, 9, 4, 1, 1, '#c8ff8a');
  });
}

// ---------- Arayüz ----------
const CSS = `
.zb-card { position: absolute; left: 50%; transform: translateX(-50%); max-width: min(92vw, 440px); padding: 7px 12px; border-radius: 12px;
  background: rgba(16, 20, 34, 0.82); border: 1px solid rgba(255,255,255,0.14); color: #fff; font-size: 12.5px; line-height: 1.35;
  pointer-events: auto; cursor: pointer; display: none; text-align: center; box-shadow: 0 6px 20px rgba(0,0,0,.35); }
.zb-card.show { display: block; animation: zbIn .35s ease; }
.zb-card.blood { background: rgba(70, 6, 14, 0.88); border-color: rgba(255, 90, 90, 0.55); }
.zb-card b { font-weight: 700; }
.zb-card .zb-chips { display: flex; flex-wrap: wrap; gap: 4px 8px; justify-content: center; margin-top: 3px; }
.zb-card .zb-chips span { white-space: nowrap; }
.zb-card .zb-dir { color: #ffd166; margin-top: 2px; font-size: 11.5px; }
.zb-arrow { position: absolute; display: none; font-size: 20px; line-height: 1; color: #ff5b5b; text-shadow: 0 0 8px rgba(255,40,40,.8), 0 2px 4px #000;
  pointer-events: none; text-align: center; font-weight: 800; }
.zb-arrow small { display: block; font-size: 10px; color: #ffd0d0; font-weight: 600; }
.zb-arrow.show { display: block; animation: zbPulse 1s ease-in-out infinite; }
.zb-arrow.n { left: 50%; transform: translateX(-50%); }
.zb-arrow.s { left: 50%; transform: translateX(-50%); bottom: max(140px, 19vh); }
.zb-arrow.w { left: 6px; top: 46%; }
.zb-arrow.e { right: 6px; top: 46%; }
.zb-boss { position: absolute; left: 50%; transform: translateX(-50%); width: min(80vw, 420px); display: none; text-align: center; pointer-events: none; }
.zb-boss.show { display: block; }
.zb-boss .zb-bname { font-weight: 700; font-size: 13px; color: #ffd0b0; text-shadow: 0 2px 4px #000; letter-spacing: .5px; }
.zb-boss .zb-bbar { height: 9px; border-radius: 99px; background: rgba(0,0,0,.55); border: 1px solid rgba(255,140,100,.6); overflow: hidden; margin-top: 3px; }
.zb-boss .zb-bbar i { display: block; height: 100%; width: 100%; background: linear-gradient(90deg, #b3202a, #ff6b4a); transition: width .2s ease; }
.zb-codex { display: grid; gap: 8px; }
.zb-codex .zb-head { padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.06); font-size: 13px; }
.zb-codex .zb-head.blood { background: rgba(150, 10, 25, .35); }
.zb-codex .zb-row { display: grid; grid-template-columns: 34px 1fr auto; gap: 10px; align-items: center; padding: 6px 8px; border-radius: 10px; background: rgba(255,255,255,.04); }
.zb-codex .zb-row img { width: 32px; height: 32px; image-rendering: pixelated; }
.zb-codex .zb-row.locked img { filter: brightness(0); opacity: .5; }
.zb-codex .zb-row b { font-size: 13px; }
.zb-codex .zb-row span { display: block; font-size: 11.5px; opacity: .75; }
.zb-codex .zb-row i { font-style: normal; font-size: 12px; opacity: .85; white-space: nowrap; }
@keyframes zbIn { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes zbPulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
.zb-arrow.n.show, .zb-arrow.s.show { animation: zbPulse 1s ease-in-out infinite; }
`;

function hudBottom() {
  const h = document.getElementById('hud-top');
  const r = h ? h.getBoundingClientRect() : null;
  let bottom = r && r.height ? Math.round(r.bottom) : 60;
  // Dar ekranda hava rozeti ve mini harita kartla çakışır → onların altına in
  if (window.innerWidth < 640) {
    for (const sel of ['#wx-badge.show', '#jc-minimap.show']) {
      const n = document.querySelector(sel);
      const nr = n ? n.getBoundingClientRect() : null;
      if (nr && nr.height) bottom = Math.max(bottom, Math.round(nr.bottom));
    }
  }
  return bottom;
}

function buildUI(scene) {
  injectCSS('zombies', CSS);
  const layer = featureLayer() || document.getElementById('ui') || document.body;
  layer.querySelectorAll('.zb-ui').forEach((n) => n.remove()); // sahne yeniden başlarsa
  const card = el('div', 'zb-card zb-ui');
  card.addEventListener('click', () => { audio.sfx('click'); openCodex(scene); });
  const boss = el('div', 'zb-boss zb-ui', '<div class="zb-bname">👑 Mezar Bekçisi</div><div class="zb-bbar"><i></i></div>');
  const arrows = ['n', 's', 'w', 'e'].map((c, i) =>
    el('div', `zb-arrow ${c} zb-ui`, `${['▲', '▼', '◀', '▶'][i]}<small>${SIDE_NAMES[i]}</small>`));
  [card, boss, ...arrows].forEach((n) => layer.appendChild(n));
  return { card, boss, bossFill: boss.querySelector('i'), arrows };
}

function placeTop(ui) {
  const top = hudBottom() + 8;
  ui.card.style.top = `${top}px`;
  ui.boss.style.top = `${top}px`;
  const cardH = ui.card.classList.contains('show') ? ui.card.getBoundingClientRect().height + 6 : 0;
  ui.arrows[0].style.top = `${top + cardH + 4}px`;
}

// Türkçe küçük harf ('İri' → 'iri'; toLowerCase 'i̇ri' üretir)
const lname = (k) => ZOMBIE_TYPES[k].name.toLocaleLowerCase('tr-TR');

function planChips(plan) {
  return KIND_ORDER.filter((k) => plan.counts[k] > 0)
    .map((k) => `<span>${ZOMBIE_TYPES[k].icon} ${plan.counts[k]} ${lname(k)}</span>`).join('');
}
const sideText = (plan) => plan.sides.map((s) => SIDE_NAMES[s]).join(', ');
const planTotal = (plan) => Object.values(plan.counts).reduce((a, b) => a + (b || 0), 0);

function showPreview(scene, plan) {
  const st = scene.zst;
  const ui = st.ui;
  ui.card.classList.toggle('blood', plan.blood);
  ui.card.innerHTML = `<b>${plan.blood ? '🩸 KANLI AY · ' : '🌙 Bu gece · '}Dalga ${plan.wave}</b>${plan.counts.boss ? ' · 👑 Patron!' : ''}`
    + `<div class="zb-chips">${planChips(plan)}</div><div class="zb-dir">⚠ Geliş yönü: ${sideText(plan)}</div>`;
  ui.card.classList.add('show');
  ui.arrows.forEach((a, i) => a.classList.toggle('show', plan.sides.includes(i)));
  placeTop(ui);
  st.previewShown = plan.wave;
}

function hidePreview(scene) {
  const ui = scene.zst.ui;
  ui.card.classList.remove('show');
  ui.arrows.forEach((a) => a.classList.remove('show'));
  scene.zst.previewShown = 0;
}

// ---------- Tehdit rehberi (featureMenu) ----------
function openCodex(scene) {
  const st = scene.zst, w = scene.waves;
  const next = w.active ? w.plan : w.nextPlan;
  const toBlood = 7 - (w.wave % 7);
  const wrap = el('div', 'zb-codex');
  let head = `<b>${w.active ? `Şu an: Dalga ${w.wave}` : `Sıradaki: Dalga ${w.wave + 1}`}</b>`;
  if (next) head += `<div class="zb-chips" style="display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:4px">${planChips(next)}</div><div style="margin-top:3px;color:#ffd166">⚠ Geliş yönü: ${sideText(next)} · toplam ${planTotal(next)}</div>`;
  else head += '<div style="opacity:.8;margin-top:3px">Keşif raporu saat 19:00\'da gelir.</div>';
  head += `<div style="margin-top:4px;opacity:.85">🩸 ${next?.blood ? 'Bu gece Kanlı Ay! Zombiler 1.5×, ganimet 2×.' : `Kanlı Ay'a en geç ${toBlood === 7 && !w.active ? 7 : toBlood} gece (bazen habersiz gelir).`}</div>`;
  head += `<div style="margin-top:4px;opacity:.75">🎒 Zombiler para, hurda, mermi ve nadiren 💜 Nadir Çekirdek düşürür. Yaklaşınca kendiliğinden toplanır.</div>`;
  wrap.appendChild(el('div', `zb-head${next?.blood ? ' blood' : ''}`, head));
  for (const k of KIND_ORDER) {
    const d = ZOMBIE_TYPES[k];
    const known = st.seen.includes(k);
    const img = scene.textures.exists(d.tex) ? iconURL(scene, d.tex) : '';
    wrap.appendChild(el('div', `zb-row${known ? '' : ' locked'}`,
      `<img src="${img}" alt=""><div><b>${known ? `${d.icon} ${d.name}` : '???'}</b><span>${known ? d.desc : `Dalga ${FROM_WAVE[k]}${k === 'boss' ? ', 10, 15…' : '+'} ile ortaya çıkar.`}</span></div><i>☠ ${st.kills[k] || 0}</i>`));
  }
  scene.hud.openPanel('🧟 Tehdit Rehberi', wrap);
}

// ---------- Ganimet ----------
function dropLoot(scene, x, y, kind, id, n) {
  const st = scene.zst;
  if (st.loot.length >= LOOT_MAX) { const old = st.loot.shift(); old.img.destroy(); }
  const tex = kind === 'coin' ? 'z_coin' : ITEMS[id]?.icon || 'i_scrap';
  const img = scene.add.image(x, y, tex).setDepth(y + 4);
  if (kind !== 'coin') img.setScale(0.6);
  const tx = x + Phaser.Math.Between(-12, 12), ty = y + Phaser.Math.Between(-8, 10);
  const l = { img, kind, id, n, x: tx, y: ty, life: LOOT_LIFE, mag: false, ready: false, phase: Math.random() * 6 };
  // Küçük zıplama ile saçıl
  scene.tweens.add({ targets: img, x: tx, duration: 380, ease: 'Quad.easeOut' });
  scene.tweens.add({ targets: img, y: { from: y, to: ty }, duration: 380, ease: 'Bounce.easeOut', onComplete: () => { l.ready = true; } });
  st.loot.push(l);
}

function rollLoot(scene, z) {
  const blood = scene.waves.bloodMoon;
  const rolls = blood ? 2 : 1;
  if (z.kind === 'boss') {
    let coins = Phaser.Math.Between(50, 80) * rolls;
    const piles = 8;
    for (let i = 0; i < piles; i++) {
      const v = i === piles - 1 ? coins : Math.floor(coins / (piles - i));
      coins -= v;
      dropLoot(scene, z.x, z.y, 'coin', null, v);
    }
    dropLoot(scene, z.x, z.y, 'item', 'rare_core', rolls);
    dropLoot(scene, z.x, z.y, 'item', 'scrap', 3 * rolls);
    return;
  }
  for (let r = 0; r < rolls; r++) {
    if (Math.random() < 0.4) dropLoot(scene, z.x, z.y, 'coin', null, Phaser.Math.Between(1, 4) * (z.kind === 'brute' ? 2 : 1));
    if (Math.random() < 0.08) {
      const opts = [['ammo', Phaser.Math.Between(3, 5)], ['scrap', Phaser.Math.Between(1, 2)]];
      if (ITEMS.arrow) opts.push(['arrow', Phaser.Math.Between(3, 5)]);
      const [id, n] = Phaser.Utils.Array.GetRandom(opts);
      dropLoot(scene, z.x, z.y, 'item', id, n);
    }
    if (Math.random() < 0.01) dropLoot(scene, z.x, z.y, 'item', 'rare_core', 1);
  }
}

function collect(scene, l) {
  const p = scene.player;
  if (l.kind === 'coin') {
    p.addCoins(l.n);
    scene.floatText(l.img.x, l.img.y - 6, `+${l.n}🪙`, '#ffd166');
    return true;
  }
  if (!ITEMS[l.id]) return true;
  const left = scene.inventory.add(l.id, l.n);
  if (left >= l.n) { scene.hud.notice('Envanter dolu! Ganimeti alamıyorsun.'); return false; }
  audio.sfx('coin');
  scene.floatText(l.img.x, l.img.y - 6, `+${l.n - left} ${ITEMS[l.id].name}`, l.id === 'rare_core' ? '#d6b0ff' : '#e6f0ff');
  if (l.id === 'rare_core') scene.hud.toast('💜 Nadir Çekirdek buldun!', 'ok');
  l.n = left;
  return left <= 0;
}

function updateLoot(scene, dt) {
  const st = scene.zst, p = scene.player, t = scene.time.now / 1000;
  for (let i = st.loot.length - 1; i >= 0; i--) {
    const l = st.loot[i];
    l.life -= dt;
    if (l.life <= 0) { l.img.destroy(); st.loot.splice(i, 1); continue; }
    if (!l.ready) continue;
    if (l.life < 8) l.img.setVisible(Math.floor(l.life * 6) % 2 === 0);
    if (l.blocked > 0) l.blocked -= dt;
    const d = p.alive ? Phaser.Math.Distance.Between(p.x, p.y + 4, l.x, l.y) : Infinity;
    if (!l.mag && d <= MAGNET && !(l.blocked > 0)) { l.mag = true; l.v = 50; }
    if (l.mag && !p.alive) l.mag = false;
    if (l.mag) {
      l.v = Math.min(260, l.v + 500 * dt);
      const a = Math.atan2(p.y + 4 - l.y, p.x - l.x), step = Math.min(d, l.v * dt);
      l.x += Math.cos(a) * step; l.y += Math.sin(a) * step;
      if (d <= 6) {
        if (collect(scene, l)) { l.img.destroy(); st.loot.splice(i, 1); continue; }
        l.mag = false; l.blocked = 3; // envanter dolu: biraz bekle
      }
    }
    l.img.setPosition(l.x, l.y - (l.mag ? 0 : Math.abs(Math.sin(t * 3 + l.phase)) * 2)).setDepth(l.y + 4);
  }
}

// ---------- Kanlı Ay katmanı ----------
function updateBloodOverlay(scene, dt) {
  const st = scene.zst, w = scene.waves;
  const m = scene.timeSys.minutes;
  const preBlood = !w.active && w.nextPlan?.blood && m >= 19 * 60 && m < 20 * 60;
  const target = w.active && w.bloodMoon ? 0.2 : preBlood ? 0.08 : 0;
  st.bloodA += (target - st.bloodA) * Math.min(1, dt * 1.5);
  const a = st.bloodA * (1 + Math.sin(scene.time.now / 700) * 0.15);
  st.overlay.setVisible(a > 0.005).setFillStyle(0x9a0010, a);
}

function decideBlood(w) { return isBloodNight(w); }

export default {
  id: 'zombies',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    const st = scene.zst = {
      kills: {}, seen: ['normal'], loot: [], bloodNights: 0,
      ui: buildUI(scene), previewShown: 0, hideArrowsAt: 0, boss: null, bossHp: -1,
      bloodA: 0, checkT: 0
    };
    clearZombieFx(scene);
    scene.zfx = { acid: [], pools: [] };
    scene.waves.bloodDecider = decideBlood;

    // Kanlı Ay kırmızı tonu (kamera merkezli, büyük dikdörtgen)
    const cam = scene.cameras.main;
    st.overlay = scene.add.rectangle(cam.width / 2, cam.height / 2, 6000, 6000, 0x9a0010, 0).setScrollFactor(0).setDepth(20001).setVisible(false);

    scene.featureMenu.push({ id: 'zombies', icon: '🧟', label: 'Tehdit', open: (s) => openCodex(s) });

    // Nadir çekirdek ve asit gölcükleri hafifçe parlar
    scene.lightSources.push((s) => {
      const out = [];
      for (const l of s.zst.loot) if (l.id === 'rare_core') out.push({ x: l.x, y: l.y, r: 18 });
      if (s.zfx) for (const g of s.zfx.pools) out.push({ x: g.x, y: g.y, r: 14 });
      return out;
    });

    const ev = scene.events;
    ev.on('waveStart', (w) => {
      const plan = scene.waves.plan;
      if (!plan) return;
      // Yeni türleri tanıt
      const fresh = KIND_ORDER.filter((k) => plan.counts[k] > 0 && !st.seen.includes(k));
      fresh.forEach((k, i) => {
        st.seen.push(k);
        if (k !== 'boss') scene.time.delayedCall(3600 + i * 1400, () => scene.hud.toast(`Yeni tür: ${ZOMBIE_TYPES[k].icon} ${ZOMBIE_TYPES[k].name} — ${ZOMBIE_TYPES[k].desc}`, 'warn'));
      });
      showPreview(scene, plan);
      st.hideArrowsAt = scene.time.now + 15000;
      if (plan.blood) {
        st.bloodNights++;
        scene.time.delayedCall(3300, () => {
          scene.hud.banner('🩸 Kanlı Ay', `Zombiler 1.5 kat daha kalabalık · ganimet 2 kat!`);
          audio.sfx('alarm');
          scene.cameras.main.shake(250, 0.004);
        });
      }
    });
    ev.on('waveEnd', () => {
      hidePreview(scene);
      clearZombieFx(scene);
      st.boss = null;
      st.ui.boss.classList.remove('show');
    });
    ev.on('zombieKilled', (z) => {
      st.kills[z.kind] = (st.kills[z.kind] || 0) + 1;
      rollLoot(scene, z);
      if (z.isBoss) {
        scene.hud.banner('👑 Mezar Bekçisi düştü!', 'Ganimetini topla!');
        audio.sfx('quest');
      }
    });
    const onBoss = (z) => {
      if (!z) return;
      st.boss = z; st.bossHp = -1;
      if (!st.seen.includes('boss')) st.seen.push('boss');
      hidePreview(scene);
      st.ui.boss.classList.add('show');
      placeTop(st.ui);
      scene.hud.banner('👑 Mezar Bekçisi', 'Patron uyandı! Yer sarsıntısından uzak dur.');
      audio.sfx('alarm');
      scene.cameras.main.shake(400, 0.006);
    };
    ev.on('bossSpawned', onBoss);
    ev.once('shutdown', () => {
      ev.off('bossSpawned', onBoss);
      document.querySelectorAll('.zb-ui').forEach((n) => n.remove());
    });
  },

  begin(scene, isNewGame) {
    if (isNewGame) {
      const st = scene.zst;
      st.kills = {}; st.seen = ['normal']; st.bloodNights = 0;
    }
  },

  update(scene, dt) {
    const st = scene.zst;
    if (!st) return;
    updateZombieFx(scene, dt);
    updateLoot(scene, dt);
    updateBloodOverlay(scene, dt);

    // Önizleme kontrolü (yarım saniyede bir)
    st.checkT -= dt;
    if (st.checkT <= 0) {
      st.checkT = 0.5;
      const w = scene.waves, m = scene.timeSys.minutes;
      if (!w.active && m >= 19 * 60 && m < 20 * 60) {
        if (!w.validPlan(w.nextPlan, w.wave + 1)) w.planNext(decideBlood(w.wave + 1));
        if (st.previewShown !== w.nextPlan.wave) {
          const plan = w.nextPlan;
          showPreview(scene, plan);
          const kinds = KIND_ORDER.filter((k) => plan.counts[k] > 0).map((k) => `${plan.counts[k]} ${lname(k)}`).join(', ');
          scene.hud.toast(`${plan.blood ? '🩸 Kanlı Ay yaklaşıyor! ' : '🔭 Keşif: '}Bu gece ${kinds} — ${sideText(plan)}`, 'warn');
          if (plan.blood) audio.sfx('alarm');
        }
      }
      if (w.active && st.hideArrowsAt && scene.time.now > st.hideArrowsAt) { st.hideArrowsAt = 0; hidePreview(scene); }
    }

    // Patron can barı (sadece değişince DOM yaz)
    if (st.boss) {
      if (!st.boss.active || st.boss.dead) { st.boss = null; st.ui.boss.classList.remove('show'); }
      else if (st.boss.hp !== st.bossHp) {
        st.bossHp = st.boss.hp;
        st.ui.bossFill.style.width = `${Math.max(0, (st.boss.hp / st.boss.maxHp) * 100)}%`;
      }
    }
  },

  save(scene) {
    const st = scene.zst;
    const w = scene.waves;
    return {
      kills: st.kills, seen: st.seen, bloodNights: st.bloodNights,
      plan: w.validPlan(w.nextPlan, w.wave + 1) ? w.nextPlan : null
    };
  },

  load(scene, d) {
    const st = scene.zst;
    if (!d || typeof d !== 'object') return;
    if (d.kills && typeof d.kills === 'object') st.kills = { ...d.kills };
    if (Array.isArray(d.seen)) st.seen = [...new Set(['normal', ...d.seen.filter((k) => ZOMBIE_TYPES[k])])];
    st.bloodNights = d.bloodNights || 0;
    const w = scene.waves;
    if (d.plan && w.validPlan(d.plan, w.wave + 1)) w.nextPlan = d.plan;
  }
};
