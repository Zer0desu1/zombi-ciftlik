// Oyun yönetmeni: tempo (erken gece / erken şafak), adım adım hedefler, ana hedef (Radyo Kulesi → kurtarma = zafer),
// sürü uyarıları. Oyunun "ne yapmalıyım?" ve "neden devam etmeliyim?" sorularına cevap verir.
import { ITEMS, NIGHT_START } from '../config.js';
import { addCanvas, R } from '../textures.js';
import { injectCSS, el, featureLayer } from '../ui/dom.js';
import { audio } from '../audio.js';

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
  { id: 'turret',    text: 'Taret kur',                               hint: 'Taret: 4 odun + 6 taş + 10 mermi (veya Zeynep\'ten al)', goal: 1, prog: (s) => s.turrets.countActive(true), reward: 30 },
  { id: 'tower1',    text: 'Radyo Kulesi\'nin 1. aşamasını kur',      hint: 'Sığınağın solundaki kule temeline git',       goal: 1, prog: (s, st) => Math.min(1, st.tower), reward: 0 }
];

// ---------------- Radyo Kulesi (ana hedef) ----------------
const STAGES = [
  { cost: { wood: 15, stone: 10 },              coins: 0,   perk: 'Kule ışığı + sığınak +100 can' },
  { cost: { wood: 12, stone: 18 },              coins: 150, perk: 'Kule tüfeği: yakındaki zombilere ateş eder' },
  { cost: { stone: 20, ammo: 20, wood: 10 },    coins: 300, perk: 'Sığınak +200 can, kule tüfeği 2x hızlı' },
  { cost: { wood: 20, stone: 25 },              coins: 500, perk: 'Kurtarma çağrısı: 3 gün sonra SON GECE' }
];
const RESCUE_DELAY = 3;
const SHELTER_BONUS = [0, 100, 100, 300, 300];

const st0 = () => ({ done: [], tower: 0, rescueDay: 0, harvested: false, sold: false, earlyStart: false, finalNight: false });
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
  if (st.rescueDay) {
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

export default {
  id: 'director',

  textures(scene) {
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
    `);
    featureLayer()?.querySelector('#dr-objective')?.remove();
    featureLayer()?.appendChild(el('div', '', '')).setAttribute('id', 'dr-objective');

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
      if (st.rescueDay && scene.timeSys.day >= st.rescueDay) {
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
        scene.hud.banner('🚁 Kurtarma geldi!', 'Kasaba hayatta kaldı!');
        scene.time.delayedCall(2600, () => scene.onVictory());
      }
    };
    ev.on('hordeIncoming', onHorde);
    ev.on('waveStart', onWaveStart);
    ev.on('waveEnd', onWaveEnd);
    // Son gece: kanlı ay + garantili boss
    const prevDecider = scene.waves.bloodDecider;
    scene.waves.bloodDecider = (w) => (st.rescueDay && scene.timeSys.day >= st.rescueDay) || (prevDecider ? prevDecider(w) : false);
    const makePlan = scene.waves.makePlan.bind(scene.waves);
    scene.waves.makePlan = (w, blood) => {
      const plan = makePlan(w, blood);
      if (st.rescueDay && scene.timeSys.day >= st.rescueDay) {
        plan.counts.boss = Math.max(1, plan.counts.boss || 0);
        plan.sides = [0, 1, 2, 3];
      }
      return plan;
    };
    scene.timeSys.on('dawn', () => { ff = false; scene.timeSys.speedMul = 1; });
    scene.events.once('shutdown', () => {
      ev.off('hordeIncoming', onHorde); ev.off('waveStart', onWaveStart); ev.off('waveEnd', onWaveEnd);
      document.getElementById('dr-objective')?.remove();
    });
  },

  begin(scene, isNew) {
    applyPerks(scene);
    if (isNew) scene.time.delayedCall(3500, () => scene.hud.toast('🎯 Ekranın üstündeki hedefleri takip et. Ana hedef: Radyo Kulesi\'ni kurup kurtarma çağırmak.', 'info'));
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
    applyPerks(scene);
  }
};
