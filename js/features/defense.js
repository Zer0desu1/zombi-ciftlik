// 'defense' özellik modülü — savunma inşası: taş duvar, dikenli tuzak, kapı, ışık direği,
// alev tareti, taret seviyeleri ve çekiçle onarım. Sözleşme için registry.js'e bak.
import { ITEMS, RECIPES, SHOPS } from '../config.js';
import { audio } from '../audio.js';
import { addCanvas, R } from '../textures.js';
import { canPlace } from '../systems/PlayerActions.js';
import { injectCSS, el } from '../ui/dom.js';
import { StoneWall, Gate, SpikeTrap, LampPost, FlameTurret, TURRET_LEVELS, FLAME } from '../entities/Structures.js';

// ---------- Veri: eşyalar, tarifler, dükkân ----------
const KINDS = {
  stone_wall:   { cls: StoneWall,   name: 'Taş Duvar',     desc: 'Sağlam engel (300 can). Zombileri durdurur. Tıklayarak yerleştir.' },
  spike_trap:   { cls: SpikeTrap,   name: 'Dikenli Tuzak', desc: 'Üstünden geçen zombiye hasar verir ve yavaşlatır. 40 kullanımda kırılır.' },
  gate:         { cls: Gate,        name: 'Kapı',          desc: 'Sen ve kasabalılar geçersiniz, zombiler geçemez (200 can).' },
  lamp_post:    { cls: LampPost,    name: 'Işık Direği',   desc: 'Geceyi 90px aydınlatır. Işıktaki zombiler %15 yavaşlar.' },
  flame_turret: { cls: FlameTurret, name: 'Alev Tareti',   desc: 'Yakındaki zombileri yakar (50px koni). Yakıtı odun: E ile doldur.' }
};
Object.entries(KINDS).forEach(([id, k]) => {
  ITEMS[id] = { name: k.name, type: 'place', icon: id === 'lamp_post' ? 'i_lamp_post' : id, desc: k.desc, onUse: (scene, ctx) => placeDefense(scene, id, ctx) };
});
ITEMS.hammer = { name: 'Çekiç', type: 'tool', icon: 'i_hammer', desc: 'Yapıya tıkla: 1 odun/taş harcayıp +25 can onarır.', onUse: (scene, ctx) => useHammer(scene, ctx) };
if (ITEMS.turret) ITEMS.turret.desc = 'Otomatik ateş eder. Yanına gidip E ile yükselt (Sv.3\'e kadar).';

const DEF_RECIPES = [
  { out: 'stone_wall', qty: 1, cost: { stone: 8 } },
  { out: 'spike_trap', qty: 1, cost: { wood: 3, stone: 2 } },
  { out: 'gate',       qty: 1, cost: { wood: 6, stone: 2 } },
  { out: 'lamp_post',  qty: 1, cost: { wood: 3, stone: 1 } }
];
RECIPES.push(...DEF_RECIPES);
SHOPS.blacksmith.push(
  { id: 'hammer', qty: 1, price: 40 },
  { id: 'flame_turret', qty: 1, price: 200 }
);

const HAMMER_HEAL = 25;
const UPGRADE_REACH = 24;
const TRAP_DMG = 2, TRAP_TICK = 0.5, TRAP_SLOW = 0.5, LIGHT_SLOW = 0.85;

// ---------- Yerleştirme ----------
function fail(scene, msg) { audio.sfx('error'); if (msg) scene.hud.notice(msg); }

function placeDefense(scene, id, ctx) {
  if (!canPlace(scene, ctx.cx, ctx.cy)) return fail(scene, 'Buraya yerleştirilemez');
  if (!scene.inventory.remove(id, 1)) return;
  const s = spawn(scene, id, ctx.cx, ctx.cy);
  scene.player.actionCd = 0.3;
  scene.spawnParticles(ctx.cx, ctx.cy + 4, s?.debris || 0x8a5a3a, 6);
  audio.sfx('place');
  if (id === 'flame_turret') scene.hud.toast('Alev tareti kuruldu. Yakıt bitince E ile odun ekle.', 'info');
}

function spawn(scene, kind, x, y, hp, extra) {
  const k = KINDS[kind];
  if (!k) return null;
  const s = kind === 'flame_turret' ? new FlameTurret(scene, x, y, hp, extra?.fuel) : new k.cls(scene, x, y, hp);
  scene.defStructs.add(s);
  // Alev tareti zombilerin hedefi olur (normal taret gibi)
  if (kind === 'flame_turret') {
    scene.extraTargets.push(s);
    s.once('destroy', () => { const i = scene.extraTargets.indexOf(s); if (i >= 0) scene.extraTargets.splice(i, 1); });
  }
  if (kind === 'lamp_post') s.once('destroy', () => refreshLights(scene));
  refreshLights(scene);
  return s;
}

// ---------- Çekiç: onarım ----------
function allStructures(scene) {
  return [...scene.barricades.getChildren(), ...scene.turrets.getChildren(), ...scene.defStructs.getChildren()];
}

function useHammer(scene, { wx, wy }) {
  const p = scene.player;
  let target = null, best = 14;
  // Önce tıklanan yapı, yoksa oyuncuya en yakın hasarlı yapı
  for (const s of allStructures(scene)) {
    if (!s.active) continue;
    const d = Phaser.Math.Distance.Between(wx, wy, s.x, s.y);
    if (d < best && s.hp < s.maxHp && Phaser.Math.Distance.Between(p.x, p.y, s.x, s.y) < 40) { best = d; target = s; }
  }
  if (!target) {
    best = 36;
    for (const s of allStructures(scene)) {
      if (!s.active || s.hp >= s.maxHp) continue;
      const d = Phaser.Math.Distance.Between(p.x, p.y, s.x, s.y);
      if (d < best) { best = d; target = s; }
    }
  }
  if (!target) {
    // Sığınak da onarılabilir
    const sh = scene.shelter;
    if (sh.hp < sh.maxHp && sh.distanceFrom(p.x, p.y) < 20) target = sh;
  }
  if (!target) return fail(scene, 'Yakında hasarlı yapı yok');
  const pref = target.kind === 'stone_wall' || target.isShelter ? ['stone', 'wood'] : ['wood', 'stone'];
  const mat = pref.find((m) => scene.inventory.count(m) > 0);
  if (!mat) return fail(scene, 'Onarım için odun ya da taş gerekli');
  if (!p.useEnergy(2)) return;
  scene.inventory.remove(mat, 1);
  target.repair(HAMMER_HEAL);
  p.actionCd = 0.4;
  p.setFlipX(target.x < p.x);
  scene.tweens.add({ targets: target, y: target.y - 1, duration: 50, yoyo: true });
  scene.spawnParticles(target.x, target.y + 2, mat === 'stone' ? 0xa2a6b0 : 0xc9a06b, 6);
  scene.floatText(target.x, target.y - 10, `+${HAMMER_HEAL} 🔧`, '#9effa0');
  audio.sfx(mat === 'stone' ? 'mine' : 'chop');
}

// ---------- Taret yükseltme / alev tareti yakıtı (E etkileşimi) ----------
function costText(c) { return `${c.coins}🪙 + ${c.stone} taş`; }

function upgradeTurret(scene, t) {
  const next = TURRET_LEVELS[t.level + 1];
  if (!next) return;
  const p = scene.player, c = next.cost;
  if (p.coins < c.coins || scene.inventory.count('stone') < c.stone) return fail(scene, `Yükseltme için ${costText(c)} gerekli`);
  p.addCoins(-c.coins);
  scene.inventory.remove('stone', c.stone);
  t.setLevel(t.level + 1, true);
  scene.spawnParticles(t.x, t.y, 0xffd166, 12);
  scene.floatText(t.x, t.y - 12, `Taret Sv.${t.level}!`, '#ffd166');
  scene.hud.toast(t.level === 2 ? 'Taret Sv.2: hasar +1, menzil +20' : 'Taret Sv.3: atış hızı +%40', 'ok');
  audio.sfx('craft');
}

function refuel(scene, f) {
  const room = Math.floor((FLAME.maxFuel - f.fuel) / FLAME.fuelPerWood);
  const n = Math.min(Math.max(1, room), scene.inventory.count('wood'), 5);
  if (n <= 0) return fail(scene, 'Yakıt için odun gerekli');
  if (f.fuel >= FLAME.maxFuel) return fail(scene, 'Depo dolu');
  scene.inventory.remove('wood', n);
  f.addFuel(n * FLAME.fuelPerWood);
  scene.floatText(f.x, f.y - 12, `+${n} odun 🔥`, '#ffb347');
  audio.sfx('place');
}

function interaction(scene) {
  const p = scene.player;
  let best = null, bestD = UPGRADE_REACH;
  for (const t of scene.turrets.getChildren()) {
    if (!t.active || !TURRET_LEVELS[(t.level || 1) + 1]) continue;
    const d = Phaser.Math.Distance.Between(p.x, p.y, t.x, t.y);
    if (d < bestD) { bestD = d; best = t; }
  }
  for (const f of scene.defStructs.getChildren()) {
    if (f.kind !== 'flame_turret' || !f.active || f.fuel > FLAME.maxFuel - FLAME.fuelPerWood) continue;
    const d = Phaser.Math.Distance.Between(p.x, p.y, f.x, f.y);
    if (d < bestD) { bestD = d; best = f; }
  }
  if (!best) return null;
  if (best.kind === 'flame_turret') {
    return { dist: bestD, label: `Alev tareti: odun ekle (yakıt ${Math.ceil(best.fuel)} sn)`, run: () => refuel(scene, best) };
  }
  const lv = best.level || 1, c = TURRET_LEVELS[lv + 1].cost;
  return { dist: bestD, label: `Tareti yükselt Sv.${lv}→${lv + 1} (${costText(c)})`, run: () => upgradeTurret(scene, best) };
}

// ---------- Işıklar ----------
function refreshLights(scene) {
  const st = scene.defState;
  st.lamps = scene.defStructs.getChildren().filter((s) => s.active && s.kind === 'lamp_post');
  st.flames = scene.defStructs.getChildren().filter((s) => s.active && s.kind === 'flame_turret');
  st.traps = scene.defStructs.getChildren().filter((s) => s.active && s.kind === 'spike_trap');
  st.gates = scene.defStructs.getChildren().filter((s) => s.active && s.kind === 'gate');
}

function lightList(scene) {
  const st = scene.defState, out = st.lightBuf;
  out.length = 0;
  for (const l of st.lamps) if (l.active) out.push({ x: l.x, y: l.y - 6, r: l.lightR });
  for (const f of st.flames) if (f.active && f.firing > 0) out.push({ x: f.x, y: f.y, r: 40 });
  return out;
}

// ---------- Savunma paneli (mobil + masaüstü) ----------
function openPanel(scene) {
  const inv = scene.inventory, icon = (id) => scene.hud.icon(id);
  const body = el('div', 'def-panel');
  const render = () => {
    const counts = {};
    allStructures(scene).forEach((s) => { const k = s.kind === 'turret' ? `turret${s.level || 1}` : s.kind; counts[k] = (counts[k] || 0) + 1; });
    const names = { barricade: 'Barikat', turret1: 'Taret Sv.1', turret2: 'Taret Sv.2', turret3: 'Taret Sv.3', stone_wall: 'Taş duvar', spike_trap: 'Tuzak', gate: 'Kapı', lamp_post: 'Işık', flame_turret: 'Alev tareti' };
    const chips = Object.entries(counts).map(([k, n]) => `<span class="def-chip">${names[k] || k} ×${n}</span>`).join('') || '<span class="muted">Henüz savunma yapın yok.</span>';
    body.innerHTML = `<div class="def-sec"><b>Kurulu yapılar</b><div class="def-chips">${chips}</div></div><div class="def-sec"><b>Savunma üret</b></div>`;
    DEF_RECIPES.forEach((r) => {
      const ok = inv.has(r.cost);
      const cost = Object.entries(r.cost).map(([id, n]) => `<span class="cost ${inv.count(id) >= n ? '' : 'miss'}"><img src="${icon(id)}" alt="">${inv.count(id)}/${n}</span>`).join('');
      const row = el('div', `recipe ${ok ? '' : 'locked'}`, `<img class="out" src="${icon(r.out)}" alt=""><div class="rinfo"><b>${ITEMS[r.out].name}</b><div>${cost}</div><span class="muted def-desc">${ITEMS[r.out].desc}</span></div><button ${ok ? '' : 'disabled'}>Üret</button>`);
      row.querySelector('button').addEventListener('click', () => {
        if (inv.craft(r)) { audio.sfx('craft'); scene.hud.toast(`${ITEMS[r.out].name} üretildi`, 'ok'); } else audio.sfx('error');
        render();
      });
      body.appendChild(row);
    });
    body.appendChild(el('div', 'def-sec muted def-tips',
      '🔧 <b>Çekiç</b> (Zeynep, 40🪙): hasarlı yapıya tıkla, +25 can.<br>⬆️ <b>Taret yükseltme</b>: tarete yaklaş, E / eylem butonu.<br>🔥 <b>Alev tareti</b> (Zeynep, 200🪙): yakıtı odun, E ile doldur.<br>🚪 <b>Kapı</b> sana açılır, zombilere kapalı kalır.'));
  };
  render();
  scene.hud.openPanel('Savunma', body);
}

// ---------- Dokular ----------
function makeTextures(scene) {
  addCanvas(scene, 'stone_wall', 16, 16, (ctx) => {
    R(ctx, 0, 1, 16, 15, '#5d5f69');
    const rows = [[1, 0], [5, 4], [9, 0], [13, 4]];
    rows.forEach(([y, off]) => {
      for (let x = -off; x < 16; x += 8) { R(ctx, x + 1, y + 1, 6, 3, '#9a9da8'); R(ctx, x + 1, y + 1, 6, 1, '#b8bcc6'); }
    });
    R(ctx, 0, 15, 16, 1, '#3e4048');
  });
  const gate = (open) => (ctx) => {
    R(ctx, 0, 2, 3, 14, '#5d5f69'); R(ctx, 13, 2, 3, 14, '#5d5f69'); R(ctx, 0, 1, 3, 2, '#9a9da8'); R(ctx, 13, 1, 3, 2, '#9a9da8');
    if (open) { R(ctx, 3, 4, 2, 11, '#8a5a3a'); R(ctx, 11, 4, 2, 11, '#8a5a3a'); return; }
    R(ctx, 3, 4, 10, 11, '#8a5a3a');
    for (const x of [5, 8, 11]) R(ctx, x, 4, 1, 11, '#6b4429');
    R(ctx, 3, 6, 10, 1, '#4a4a55'); R(ctx, 3, 12, 10, 1, '#4a4a55'); R(ctx, 7, 9, 2, 2, '#e8c867');
  };
  addCanvas(scene, 'gate', 16, 16, gate(false));
  addCanvas(scene, 'gate_open', 16, 16, gate(true));
  addCanvas(scene, 'spike_trap', 16, 16, (ctx) => {
    R(ctx, 1, 9, 14, 5, '#6b4429'); R(ctx, 1, 9, 14, 1, '#8a5a3a');
    for (const x of [2, 6, 10, 13]) { R(ctx, x, 5, 1, 4, '#c8c8d0'); R(ctx, x, 4, 1, 1, '#ffffff'); }
    for (const x of [4, 8, 12]) { R(ctx, x, 7, 1, 2, '#9aa3ad'); }
  });
  const lamp = (ctx) => {
    R(ctx, 5, 13, 6, 3, '#4a4a55'); R(ctx, 7, 4, 2, 10, '#3a3a44');
    R(ctx, 5, 1, 6, 4, '#2c2c34'); R(ctx, 6, 2, 4, 2, '#ffd166'); R(ctx, 7, 2, 2, 1, '#fff6c2'); R(ctx, 4, 0, 8, 1, '#2c2c34');
  };
  addCanvas(scene, 'lamp_post', 16, 16, lamp);
  addCanvas(scene, 'i_lamp_post', 16, 16, lamp);
  addCanvas(scene, 'flame_turret', 16, 16, (ctx) => {
    R(ctx, 3, 10, 10, 5, '#5a3a2a'); R(ctx, 4, 6, 8, 5, '#a8452f'); R(ctx, 5, 7, 6, 3, '#d9643f');
    R(ctx, 10, 7, 5, 3, '#2c2c34'); R(ctx, 15, 7, 1, 3, '#f08a24'); R(ctx, 6, 4, 3, 2, '#3a3a44'); R(ctx, 7, 7, 2, 2, '#ffd166');
  });
  // Taret seviye dokuları
  const turret = (body, hi, barrel) => (ctx) => {
    R(ctx, 3, 10, 10, 5, '#5a5d66'); R(ctx, 4, 6, 8, 5, body); R(ctx, 5, 7, 6, 3, hi);
    R(ctx, 10, 7, 6, 2, barrel); R(ctx, 7, 7, 2, 2, '#ff5a5a');
  };
  addCanvas(scene, 'turret_lv2', 16, 16, turret('#4f7fb0', '#7ab0e6', '#2c2c34'));
  addCanvas(scene, 'turret_lv3', 16, 16, (ctx) => { turret('#b08a2f', '#e8c867', '#2c2c34')(ctx); R(ctx, 10, 9, 6, 1, '#2c2c34'); });
  addCanvas(scene, 'def_pips2', 7, 3, (ctx) => { R(ctx, 0, 0, 3, 3, '#1b1622'); R(ctx, 4, 0, 3, 3, '#1b1622'); R(ctx, 1, 1, 1, 1, '#ffd166'); R(ctx, 5, 1, 1, 1, '#ffd166'); });
  addCanvas(scene, 'def_pips3', 11, 3, (ctx) => { for (const x of [0, 4, 8]) { R(ctx, x, 0, 3, 3, '#1b1622'); R(ctx, x + 1, 1, 1, 1, '#ffd166'); } });
  addCanvas(scene, 'i_hammer', 16, 16, (ctx) => {
    for (let i = 0; i < 9; i++) R(ctx, 3 + i, 12 - i, 2, 2, '#8a5a3a');
    R(ctx, 8, 1, 7, 4, '#7d808a'); R(ctx, 8, 1, 7, 1, '#b8c1cb'); R(ctx, 14, 1, 1, 4, '#5a5d66');
  });
}

// ---------- Modül ----------
export default {
  id: 'defense',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    scene.defStructs = scene.add.group();
    scene.defState = { lamps: [], flames: [], traps: [], gates: [], lightBuf: [], burning: new Set() };
    // Çarpışma süzgeci: kapı ve tuzak oyuncuyu engellemez, tuzak zombiyi de engellemez
    scene.physics.add.collider(scene.player, scene.defStructs, null, (_p, s) => !!s.blocksPlayer);
    scene.physics.add.collider(scene.zombies, scene.defStructs, (z, s) => { z.blockedBy = s; }, (_z, s) => !!s.blocksZombie);
    scene.lightSources.push(lightList);
    scene.addInteraction(interaction);
    scene.featureMenu.push({ id: 'defense', icon: '🛡️', label: 'Savunma', open: openPanel });
    scene.rangeGfx = scene.add.graphics().setDepth(8999);
    scene.events.on('structureDestroyed', (s) => { if (s.kind && KINDS[s.kind]) scene.time.delayedCall(0, () => refreshLights(scene)); });
    injectCSS('defense', `
      .def-panel .def-sec{margin:6px 0 8px}
      .def-panel .def-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
      .def-panel .def-chip{background:rgba(255,255,255,.1);border-radius:8px;padding:2px 8px;font-size:12px}
      .def-panel .def-desc{display:block;font-size:11px;line-height:1.25;margin-top:2px}
      .def-panel .def-tips{font-size:12px;line-height:1.5}
      .def-panel .recipe button{min-height:36px;min-width:64px}
    `);
  },

  update(scene, dt) {
    const st = scene.defState;
    if (!st) return;
    // Alev taretleri
    for (const f of st.flames) if (f.active) f.update(dt, (z) => { z.defBurn = FLAME.burn; z.defBurnTick = z.defBurnTick || 0.5; st.burning.add(z); });

    // Yanma hasarı (0.5 sn'de 1)
    for (const z of st.burning) {
      if (!z.active || z.dead) { st.burning.delete(z); continue; }
      z.defBurn -= dt; z.defBurnTick -= dt;
      if (z.defBurnTick <= 0) {
        z.defBurnTick = 0.5;
        if (Math.random() < 0.6) scene.spawnParticles(z.x, z.y - 4, 0xf08a24, 2);
        z.takeDamage(1, null);
        if (z.dead) { st.burning.delete(z); continue; }
      }
      if (z.defBurn <= 0) { st.burning.delete(z); z.defBurnTick = 0; }
    }

    // Tuzaklar + ışık yavaşlatması (zombi hızını bu karede ölçekle)
    const night = scene.timeSys.isNight;
    const zs = scene.zombies.getChildren();
    if (st.traps.length || (night && st.lamps.length)) {
      for (const t of st.traps) t.tick -= dt;
      for (const z of zs) {
        if (z.dead || !z.body) continue;
        let mul = 1;
        for (const t of st.traps) {
          if (!t.active) continue;
          if (Math.abs(z.x - t.x) < 8 && Math.abs(z.y + 4 - t.y) < 9) {
            mul *= TRAP_SLOW;
            if (t.tick <= 0) { z.takeDamage(TRAP_DMG, null); t.wear(); t.hitThisTick = true; }
            break;
          }
        }
        if (night) {
          for (const l of st.lamps) {
            if (!l.active) continue;
            const dx = z.x - l.x, dy = z.y - l.y;
            if (dx * dx + dy * dy < l.lightR * l.lightR) { mul *= LIGHT_SLOW; break; }
          }
        }
        if (mul < 1 && !z.dead && z.body) z.body.velocity.scale(mul);
      }
      for (const t of st.traps) if (t.tick <= 0) { t.tick = TRAP_TICK; if (t.hitThisTick) { t.hitThisTick = false; audio.sfx('swing'); } }
      if (st.traps.some((t) => !t.active)) refreshLights(scene);
    }

    // Kapılar: oyuncu yaklaşınca açılır
    const p = scene.player;
    for (const g of st.gates) if (g.active) g.setOpen(Math.abs(p.x - g.x) < 14 && Math.abs(p.y - g.y) < 16);

    // Menzil önizlemesi: yerleştirirken veya yakındaki tarette
    const gfx = scene.rangeGfx;
    gfx.clear();
    const slot = scene.inventory.slots[scene.selected];
    const ranges = { turret: TURRET_LEVELS[1].range, flame_turret: FLAME.range, lamp_post: 90 };
    if (slot && ranges[slot.id] && scene.ghost?.visible) {
      const ok = canPlace(scene, scene.ghost.x, scene.ghost.y);
      gfx.lineStyle(1, ok ? 0x88ff88 : 0xff6666, 0.5).strokeCircle(scene.ghost.x, scene.ghost.y, ranges[slot.id]);
    } else {
      for (const t of scene.turrets.getChildren()) {
        if (Math.abs(p.x - t.x) < UPGRADE_REACH && Math.abs(p.y - t.y) < UPGRADE_REACH) { gfx.lineStyle(1, 0xffd166, 0.35).strokeCircle(t.x, t.y, t.range); break; }
      }
    }
  },

  save(scene) {
    const structs = scene.defStructs.getChildren().filter((s) => s.active).map((s) => {
      const o = { kind: s.kind, x: s.x, y: s.y, hp: s.hp };
      if (s.kind === 'flame_turret') o.fuel = Math.round(s.fuel);
      return o;
    });
    const turrets = scene.turrets.getChildren().filter((t) => (t.level || 1) > 1).map((t) => ({ x: t.x, y: t.y, level: t.level }));
    return { structs, turrets };
  },

  load(scene, data) {
    if (!data) return;
    (data.structs || []).forEach((s) => {
      if (s && KINDS[s.kind] && Number.isFinite(s.x) && Number.isFinite(s.y)) spawn(scene, s.kind, s.x, s.y, s.hp, s);
    });
    // Taret seviyeleri: GameScene taretleri konumla oluşturdu, eşleştir
    (data.turrets || []).forEach((d) => {
      const t = scene.turrets.getChildren().find((u) => Math.abs(u.x - d.x) < 1 && Math.abs(u.y - d.y) < 1);
      if (t && t.setLevel) t.setLevel(d.level || 1, false);
    });
  }
};

