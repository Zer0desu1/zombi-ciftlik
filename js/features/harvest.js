// 'harvest' özellik modülü — çiftliği hayatta kalmaya bağlar:
//  1) Güç yemekleri: pişmiş yemekler bir sonraki şafağa kadar savaş güçlendirmesi verir
//  2) Kiler + kasaba morali: bağışlanan yiyecek NPC savunucuların hasarını/atış hızını belirler
//  3) Tarladan silah/savunma: balkabağı bombası, buğdaydan barikat
//  4) Zombiler geceleri ekinleri çiğner → tarlayı da savunmak gerekir
import { TILE, ITEMS, RECIPES } from '../config.js';
import { addCanvas, R } from '../textures.js';
import { injectCSS, el, topExtra } from '../ui/dom.js';
import { audio } from '../audio.js';

// ---------------- Güç yemekleri ----------------
// Değerler toplanır; aynı anda en fazla MAX_BUFFS farklı güçlendirme aktif olur
const BUFFS = {
  bread:        { icon: '🍞', name: 'Tokluk',       desc: '+20 maksimum can',                 maxHp: 20 },
  soup:         { icon: '💪', name: 'Güç',          desc: '+%30 hasar',                       dmg: 0.3 },
  corn_bread:   { icon: '🛡️', name: 'Dayanıklılık', desc: '%25 daha az hasar alırsın',        armor: 0.25 },
  salad:        { icon: '💨', name: 'Çeviklik',     desc: '+%20 hız, +%10 kritik',            speed: 0.2, crit: 0.1 },
  baked_potato: { icon: '🔥', name: 'Sıcak Karın',  desc: 'Gece saniyede 1 can yenilenir',    regen: 1 },
  carrot_juice: { icon: '👁️', name: 'Keskin Göz',   desc: 'Gece ışığın geniş, +%15 kritik',   light: 1.7, crit: 0.15 },
  warrior_stew: { icon: '⚔️', name: 'Savaşçı',      desc: '+%40 hasar, +30 maksimum can',     dmg: 0.4, maxHp: 30 }
};
const MAX_BUFFS = 2;

// ---------------- Kiler değerleri (1 adet = erzak puanı) ----------------
const FOOD_VAL = {
  wheat: 2, carrot: 3, potato: 3, tomato: 3, corn: 4, strawberry: 2, pumpkin: 8,
  egg: 2, egg_big: 4, milk: 3, milk_big: 5, cheese: 8, berry: 1, mushroom: 2,
  fish_carp: 3, fish_bass: 4, fish_gold: 6, fish_grilled: 8,
  bread: 6, soup: 15, corn_bread: 10, salad: 10, baked_potato: 9, carrot_juice: 8, warrior_stew: 18, omelette: 8
};
const MORALE = {
  feast:  { id: 'feast',  icon: '🎉', name: 'Ziyafet', dmg: 1.6,  rate: 1.5,  desc: 'Savunucular +%60 hasar, +%50 atış hızı. Şafakta sığınak onarılır.' },
  fed:    { id: 'fed',    icon: '😊', name: 'Tok',     dmg: 1.3,  rate: 1.25, desc: 'Savunucular +%30 hasar, +%25 atış hızı.' },
  hungry: { id: 'hungry', icon: '😟', name: 'Aç',      dmg: 0.75, rate: 0.7,  desc: 'Savunucular zayıf: -%25 hasar, -%30 atış hızı.' }
};

// ---------------- Yeni eşyalar ve tarifler ----------------
Object.assign(ITEMS, {
  carrot_juice: { name: 'Havuç Suyu',        type: 'food', icon: 'i_carrot_juice', sell: 45, heal: 10, energy: 30 },
  warrior_stew: { name: 'Savaşçı Güveci',    type: 'food', icon: 'i_warrior_stew', sell: 90, heal: 50, energy: 50 },
  pumpkin_bomb: { name: 'Balkabağı Bombası', type: 'throw', icon: 'i_pumpkin_bomb', sell: 20, desc: 'Fareye/hedefe fırlat: 45px alanda 8 hasar ve geri itme.' }
});
RECIPES.push(
  { out: 'carrot_juice', qty: 1, cost: { carrot: 3 } },
  { out: 'warrior_stew', qty: 1, cost: { potato: 2, carrot: 2, tomato: 1 } },
  { out: 'pumpkin_bomb', qty: 2, cost: { pumpkin: 1, ammo: 2 } },
  { out: 'barricade', qty: 1, cost: { wheat: 5 } } // saman balyası: buğdaydan ucuz barikat
);
// Güç yemeklerinin açıklamalarına güçlendirmeyi yaz
for (const [id, b] of Object.entries(BUFFS)) {
  if (ITEMS[id]) ITEMS[id].desc = `${b.icon} ${b.name} (şafağa kadar): ${b.desc}`;
}

// ---------------- Durum ----------------
const fresh = () => ({ pantry: 0, donated: 0, buffs: [], eaten: 0, appliedHp: 0, morale: null, trampleWarned: false });
let S = fresh();
let tickT = 0;
let crate = null;
let lastBadge = '';

const baseOf = (id) => ITEMS[id]?.baseItem || id;
const qualityMul = (id) => ({ 1: 1.25, 2: 1.5 })[ITEMS[id]?.quality] || 1;
const foodValue = (id) => (FOOD_VAL[baseOf(id)] ? Math.round(FOOD_VAL[baseOf(id)] * qualityMul(id)) : 0);
const dailyNeed = (scene) => 2 * scene.npcs.length;

function forecast(scene) {
  const need = dailyNeed(scene);
  if (S.pantry >= need * 2) return MORALE.feast;
  if (S.pantry >= need) return MORALE.fed;
  return MORALE.hungry;
}

// ---------------- Güçlendirmeleri uygula ----------------
function applyBuffs(scene) {
  const sum = (k) => S.buffs.reduce((n, id) => n + (BUFFS[id]?.[k] || 0), 0);
  if (scene.combat) { scene.combat.buffDmg = sum('dmg'); scene.combat.buffCrit = sum('crit'); }
  const p = scene.player;
  p.buffSpeed = sum('speed');
  p.dmgTakenMul = 1 - Math.min(0.6, sum('armor'));
  const hp = sum('maxHp');
  p.maxHp += hp - S.appliedHp;
  S.appliedHp = hp;
  p.hp = Math.min(p.hp, p.maxHp);
}

function eatMeal(scene, id) {
  const p = scene.player;
  const base = baseOf(id);
  const it = ITEMS[id];
  if (!scene.inventory.remove(id, 1)) return;
  p.restore(it.heal || 0, it.energy || 0);
  p.actionCd = 0.4;
  audio.sfx('eat');
  const b = BUFFS[base];
  if (b) {
    S.buffs = S.buffs.filter((x) => x !== base);
    S.buffs.push(base);
    while (S.buffs.length > MAX_BUFFS) S.buffs.shift();
    S.eaten++;
    applyBuffs(scene);
    scene.floatText(p.x, p.y - 14, `${b.icon} ${b.name}!`, '#ffe08a');
    scene.hud.toast(`${b.icon} ${b.name}: ${b.desc} (şafağa kadar)`, 'ok');
  } else {
    scene.floatText(p.x, p.y - 12, `+${it.heal || 0} ❤  +${it.energy || 0} ⚡`, '#9effa0');
  }
}

// ---------------- Balkabağı bombası ----------------
function throwBomb(scene, ctx) {
  const p = scene.player;
  if (p.actionCd > 0 || !scene.inventory.remove('pumpkin_bomb', 1)) return;
  p.actionCd = 0.6;
  // Uzak tıklamada veya mobil eylem butonunda (hedef oyuncunun dibinde): en yakın zombiye at
  let tx = ctx.wx, ty = ctx.wy;
  const near = nearestZombie(scene, p.x, p.y, 130);
  const d0 = Phaser.Math.Distance.Between(p.x, p.y, tx, ty);
  if (near && (d0 > 130 || d0 < 30)) { tx = near.x; ty = near.y; }
  const a = Phaser.Math.Angle.Between(p.x, p.y, tx, ty);
  const dist = Math.min(120, Phaser.Math.Distance.Between(p.x, p.y, tx, ty));
  const ex = p.x + Math.cos(a) * dist, ey = p.y + Math.sin(a) * dist;
  const bomb = scene.add.image(p.x, p.y - 4, 'i_pumpkin_bomb').setDepth(9800);
  audio.sfx('swing');
  scene.tweens.add({
    targets: bomb, x: ex, duration: 420, ease: 'Linear',
    onUpdate: (tw) => { const k = tw.progress; bomb.y = p.y - 4 + (ey - p.y) * k - Math.sin(k * Math.PI) * 26; bomb.rotation = k * 8; },
    onComplete: () => { bomb.destroy(); explode(scene, ex, ey); }
  });
}

function explode(scene, x, y) {
  const r = 45, dmg = 8 * (1 + (scene.combat?.buffDmg || 0));
  scene.zombies.getChildren().slice().forEach((z) => {
    if (z.dead || Phaser.Math.Distance.Between(x, y, z.x, z.y) > r) return;
    z.takeDamage(dmg, { x, y });
  });
  const ring = scene.add.circle(x, y, r, 0xf08a24, 0.35).setDepth(9500).setScale(0.2);
  scene.tweens.add({ targets: ring, scale: 1, alpha: 0, duration: 320, onComplete: () => ring.destroy() });
  scene.spawnParticles(x, y, 0xf08a24, 16);
  scene.spawnParticles(x, y, 0xffd166, 10);
  scene.cameras.main.shake(140, 0.006);
  audio.sfx('shoot');
  audio.sfx('zdie');
}

function nearestZombie(scene, x, y, max) {
  let best = null, bd = max;
  for (const z of scene.zombies.getChildren()) {
    if (z.dead) continue;
    const d = Phaser.Math.Distance.Between(x, y, z.x, z.y);
    if (d < bd) { bd = d; best = z; }
  }
  return best;
}

// ---------------- Kiler paneli ----------------
function openPantry(scene) {
  const body = el('div', 'hv-pantry');
  const render = () => {
    const need = dailyNeed(scene), m = forecast(scene);
    body.innerHTML = `
      <div class="hv-head"><div><b>${S.pantry}</b><span>erzak</span></div><div><b>${need}</b><span>günlük ihtiyaç</span></div>
      <div><b>${m.icon} ${m.name}</b><span>bu geceki moral</span></div></div>
      <p class="muted">${m.desc} Kasaba her şafakta ${need} erzak tüketir (NPC başına 2). Ziyafet için ${need * 2}+ erzak gerekir.</p>`;
    const list = el('div', 'hv-list');
    const seen = new Set();
    scene.inventory.slots.forEach((s) => {
      if (!s || seen.has(s.id) || !foodValue(s.id)) return;
      seen.add(s.id);
      const v = foodValue(s.id), n = scene.inventory.countExact(s.id);
      const row = el('div', 'shop-row', `<img src="${scene.hud.icon(s.id)}" alt=""><div class="rinfo"><b>${ITEMS[s.id].name}</b><span class="muted">Elinde ${n} · adet başı ${v} erzak</span></div><button>1 koy</button><button class="primary">Hepsi (+${v * n})</button>`);
      const [one, all] = row.querySelectorAll('button');
      one.onclick = () => donate(scene, s.id, 1, render);
      all.onclick = () => donate(scene, s.id, scene.inventory.countExact(s.id), render);
      list.appendChild(row);
    });
    if (!seen.size) list.innerHTML = '<p class="muted center">Bağışlayacak yiyeceğin yok. Ekin hasat et, yumurta/süt topla veya balık tut.</p>';
    body.appendChild(list);
    const tips = el('div', 'hv-buffs', '<h4>Güç yemekleri (şafağa kadar sürer, en fazla 2)</h4>' +
      Object.entries(BUFFS).filter(([id]) => ITEMS[id]).map(([id, b]) =>
        `<div class="${S.buffs.includes(id) ? 'on' : ''}"><img src="${scene.hud.icon(id)}" alt=""><b>${b.icon} ${ITEMS[id].name}</b><span>${b.desc}</span></div>`).join(''));
    body.appendChild(tips);
  };
  render();
  scene.hud.openPanel('🧺 Kiler & Moral', body);
}

function donate(scene, id, n, render) {
  if (n <= 0 || !scene.inventory.remove(id, n)) return;
  const v = foodValue(id) * n;
  S.pantry += v;
  S.donated += v;
  audio.sfx('coin');
  scene.hud.toast(`Kilere +${v} erzak (${S.pantry})`, 'ok');
  render();
}

// ---------------- Üst bar rozeti ----------------
function renderBadge(scene) {
  const host = topExtra();
  if (!host) return;
  let b = document.getElementById('hv-badge');
  if (!b) {
    b = el('button', 'hv-badge');
    b.id = 'hv-badge';
    b.title = 'Kiler ve yemek güçlendirmeleri';
    b.onclick = () => openPantry(scene);
    host.appendChild(b);
  }
  const m = scene.timeSys.isNight && S.morale ? S.morale : forecast(scene);
  const html = `🧺 ${S.pantry}/${dailyNeed(scene)} ${m.icon}${S.buffs.map((id) => ` ${BUFFS[id].icon}`).join('')}`;
  if (html !== lastBadge) { b.innerHTML = html; lastBadge = html; }
}

// Misafir: rozet host'tan gelen değerlerle; dokununca host'taki kiler paneli açılır
const netBadge = { shared: null, buffs: '' };
function renderNetBadge(scene) {
  const host = topExtra();
  if (!host || !netBadge.shared) return;
  let b = document.getElementById('hv-badge');
  if (!b) {
    b = el('button', 'hv-badge');
    b.id = 'hv-badge';
    b.title = 'Kiler ve yemek güçlendirmeleri';
    host.appendChild(b);
  }
  b.onclick = () => { if (!scene.hud.isModalOpen()) scene.featureMenu.find((m) => m.id === 'pantry')?.open(scene); };
  const [pantry, need, icon] = netBadge.shared;
  const html = `🧺 ${pantry}/${need} ${icon}${netBadge.buffs ? ` ${netBadge.buffs}` : ''}`;
  if (html !== lastBadge) { b.innerHTML = html; lastBadge = html; }
}

// ---------------- Zombiler ekinleri çiğner ----------------
function trample(scene) {
  let hit = null;
  for (const z of scene.zombies.getChildren()) {
    // Yağmacılar ekini ısırarak zaten zarar veriyor (Zombie.js); çift ceza olmasın
    if (z.dead || z.role === 'raider') continue;
    const p = scene.farm.get(Math.floor(z.x / TILE), Math.floor((z.y + 6) / TILE));
    if (!p || !p.crop || p.trampled || p.crop.stage <= 0) continue;
    p.crop.stage--;
    p.crop.growth = 0;
    p.trampled = true;
    scene.farm.refresh(p);
    scene.spawnParticles(p.tx * TILE + 8, p.ty * TILE + 10, 0x6b8f3a, 6);
    hit = p;
  }
  if (hit && !S.trampleWarned) {
    S.trampleWarned = true;
    scene.hud.toast('🧟 Zombiler tarlanı çiğniyor! Tarlayı da korumalısın.', 'warn');
  }
}

export default {
  id: 'harvest',

  textures(scene) {
    addCanvas(scene, 'i_carrot_juice', 16, 16, (ctx) => {
      R(ctx, 5, 3, 6, 11, '#e6edf3'); R(ctx, 6, 6, 4, 7, '#f08a24'); R(ctx, 6, 6, 4, 1, '#ffb15c'); R(ctx, 7, 1, 1, 4, '#6fbf5a'); R(ctx, 8, 2, 2, 1, '#6fbf5a');
    });
    addCanvas(scene, 'i_warrior_stew', 16, 16, (ctx) => {
      R(ctx, 2, 7, 12, 7, '#5a5d66'); R(ctx, 3, 7, 10, 2, '#a8502a'); R(ctx, 5, 7, 2, 1, '#e8792b'); R(ctx, 9, 8, 2, 1, '#e04a3a'); R(ctx, 7, 7, 1, 1, '#f2d29b');
      R(ctx, 1, 8, 1, 3, '#3a3a44'); R(ctx, 14, 8, 1, 3, '#3a3a44'); R(ctx, 5, 3, 1, 3, 'rgba(255,255,255,.6)'); R(ctx, 9, 2, 1, 4, 'rgba(255,255,255,.6)');
    });
    addCanvas(scene, 'i_pumpkin_bomb', 16, 16, (ctx) => {
      R(ctx, 3, 5, 10, 9, '#f08a24'); R(ctx, 3, 5, 10, 1, '#c96d18'); R(ctx, 7, 5, 1, 9, '#c96d18');
      R(ctx, 5, 8, 2, 2, '#2a1f1a'); R(ctx, 9, 8, 2, 2, '#2a1f1a'); R(ctx, 5, 11, 6, 1, '#2a1f1a');
      R(ctx, 8, 1, 1, 4, '#8a5a3a'); R(ctx, 9, 0, 2, 2, '#ffd166');
    });
    addCanvas(scene, 'pantry_crate', 16, 16, (ctx) => {
      R(ctx, 1, 5, 14, 10, '#8a5a3a'); R(ctx, 1, 5, 14, 2, '#a87048'); R(ctx, 1, 10, 14, 1, '#6b4429');
      R(ctx, 3, 2, 3, 4, '#e8c867'); R(ctx, 7, 3, 3, 3, '#e8792b'); R(ctx, 11, 3, 3, 3, '#f08a24'); R(ctx, 6, 1, 1, 2, '#6fbf5a');
    });
  },

  init(scene) {
    S = fresh();
    tickT = 0;
    lastBadge = '';
    scene.morale = null;
    scene.pantry = S;

    injectCSS('harvest', `
      .hv-badge { padding: 4px 9px; font-size: 12px; border-radius: 99px; white-space: nowrap; }
      .hv-pantry .hv-head { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
      .hv-pantry .hv-head div { background: rgba(255,255,255,.06); border-radius: 10px; padding: 8px; text-align: center; }
      .hv-pantry .hv-head b { display: block; font-size: 16px; } .hv-pantry .hv-head span { font-size: 11px; color: var(--muted); }
      .hv-pantry .hv-list { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; max-height: 34vh; overflow: auto; }
      .hv-pantry .shop-row { flex-wrap: wrap; } .hv-pantry .rinfo { min-width: 0; }
      .hv-buffs { display: grid; gap: 6px; } .hv-buffs h4 { margin-top: 6px; }
      .hv-buffs div { display: grid; grid-template-columns: 24px auto 1fr; align-items: center; gap: 8px; font-size: 12px; padding: 5px 8px; border-radius: 8px; background: rgba(255,255,255,.04); }
      .hv-buffs div.on { background: rgba(255,209,102,.16); border: 1px solid rgba(255,209,102,.4); }
      .hv-buffs img { width: 24px; height: 24px; image-rendering: pixelated; } .hv-buffs span { color: var(--muted); }
      @media (max-width: 520px) { .hv-buffs div { grid-template-columns: 24px 1fr; } .hv-buffs span { grid-column: 2; } }
    `);

    // Yemek ve bomba davranışları
    for (const id of Object.keys(ITEMS)) {
      if (BUFFS[baseOf(id)] && ITEMS[id].type === 'food') ITEMS[id].onUse = (s) => eatMeal(s, id);
    }
    ITEMS.pumpkin_bomb.onUse = (s, ctx) => throwBomb(s, ctx);

    // Kiler sandığı (sığınak kapısının sağında)
    const d = scene.shelter.door;
    crate = scene.add.image(d.x + 30, d.y - 2, 'pantry_crate').setDepth(d.y + 6);
    scene.addInteraction((s) => {
      const dist = Phaser.Math.Distance.Between(s.player.x, s.player.y, crate.x, crate.y + 6);
      return dist < 24 ? { dist, label: `Kiler (${S.pantry} erzak) — yiyecek bağışla`, run: () => openPantry(s) } : null;
    });
    scene.featureMenu.push({ id: 'pantry', icon: '🧺', label: 'Kiler & Moral', open: (s) => openPantry(s) });

    // Keskin Göz: gece daha geniş ışık
    scene.lightSources.push((s) => (S.buffs.some((id) => BUFFS[id].light) && s.player.alive ? [{ x: s.player.x, y: s.player.y, r: 85 * 1.7 }] : []));

    const onWaveStart = () => {
      S.morale = forecast(scene);
      scene.morale = S.morale;
      S.trampleWarned = false;
      scene.hud.toast(`${S.morale.icon} Kasaba morali: ${S.morale.name}. ${S.morale.desc}`, S.morale.id === 'hungry' ? 'warn' : 'ok');
    };
    scene.events.on('waveStart', onWaveStart);
    scene.timeSys.on('dawn', () => {
      const need = dailyNeed(scene);
      const wasFeast = S.morale?.id === 'feast';
      const eaten = Math.min(S.pantry, need);
      S.pantry -= eaten;
      if (eaten < need) scene.hud.toast(`😟 Kilerde yeterli yiyecek yoktu (${eaten}/${need}). Hasat edip kilere bağışla, yoksa savunucular zayıf kalır.`, 'warn');
      if (wasFeast) { scene.shelter.repair(scene.shelter.maxHp * 0.2); scene.hud.toast('🎉 Ziyafet sonrası kasaba sığınağı onardı (+%20).', 'ok'); }
      S.morale = null;
      scene.morale = forecast(scene);
      for (const p of scene.farm.plots.values()) p.trampled = false;
      const clear = () => { if (S.buffs.length) { S.buffs = []; applyBuffs(scene); scene.hud.toast('Yemek güçlendirmelerinin etkisi geçti. Gece için yeniden ye!', 'info'); } };
      clear();
      scene.net?.eachGuest?.(clear); // misafirlerin kendi güçlendirmeleri
    });
    scene.events.once('shutdown', () => { scene.events.off('waveStart', onWaveStart); document.getElementById('hv-badge')?.remove(); });
  },

  begin(scene, isNew) {
    // Yeni oyun: ilk gece için bir günlük erzak; sonrası çiftliğe bağlı
    if (isNew) { scene.inventory.add('bread', 1); S.pantry = dailyNeed(scene); }
    scene.morale = scene.timeSys.isNight ? (S.morale || forecast(scene)) : forecast(scene);
    applyBuffs(scene);
    renderBadge(scene);
  },

  update(scene, dt) {
    const p = scene.player;
    if (scene.timeSys.isNight && p.alive && S.buffs.includes('baked_potato') && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + dt);
    if (!scene.timeSys.isNight) scene.morale = forecast(scene);
    tickT -= dt;
    if (tickT > 0) return;
    tickT = 0.4;
    if (scene.waves.active) trample(scene);
    renderBadge(scene);
  },

  // Çok oyunculu: kiler ortak; yemek güçlendirmeleri oyuncu başına (misafir bağlamında takas edilir)
  playerState: {
    get: () => ({ buffs: S.buffs, appliedHp: S.appliedHp }),
    set: (scene, v) => {
      S.buffs = v.buffs; S.appliedHp = v.appliedHp;
      const sum = (k) => S.buffs.reduce((n, id) => n + (BUFFS[id]?.[k] || 0), 0);
      if (scene.combat) { scene.combat.buffDmg = sum('dmg'); scene.combat.buffCrit = sum('crit'); }
    },
    fresh: () => ({ buffs: [], appliedHp: 0 }),
    save: (v) => ({ buffs: v.buffs.slice() }),
    load: (_scene, d) => ({ buffs: Array.isArray(d?.buffs) ? d.buffs.filter((id) => BUFFS[id]).slice(-MAX_BUFFS) : [], appliedHp: 0 }),
    apply: (scene) => applyBuffs(scene),
    // Fırın patates: gece can yenileme (misafir karakterinde)
    tick: (scene, dt) => {
      const p = scene.player;
      if (scene.timeSys.isNight && p.alive && S.buffs.includes('baked_potato') && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + dt);
    }
  },

  // Misafir rozeti: ortak kiler + kendi güçlendirmeleri
  netState(scene) {
    const m = scene.timeSys.isNight && S.morale ? S.morale : forecast(scene);
    return [S.pantry, dailyNeed(scene), m.icon];
  },
  netPlayerState() { return S.buffs.map((id) => BUFFS[id].icon).join(' '); },
  netApply(scene, v) { netBadge.shared = v; renderNetBadge(scene); },
  netApplyPlayer(scene, v) { netBadge.buffs = v || ''; renderNetBadge(scene); },

  save() { return { pantry: S.pantry, donated: S.donated, buffs: S.buffs.slice(), eaten: S.eaten }; },

  load(scene, d) {
    if (!d) return;
    S.pantry = Math.max(0, d.pantry | 0);
    S.donated = Math.max(0, d.donated | 0);
    S.eaten = d.eaten | 0;
    S.buffs = Array.isArray(d.buffs) ? d.buffs.filter((id) => BUFFS[id]).slice(-MAX_BUFFS) : [];
  }
};
