// 'storage' özellik modülü — Köy Sandığı (sözleşme için registry.js'e bak).
// Toplayıcı NPC'ler (çiftçi, oduncu, madenci) topladıklarını en yakın köy sandığına bırakır; oyuncular
// sandığı açıp (E) eşya alır/koyar. Yeni oyunda sığınağın yanına bir başlangıç sandığı konur, fazlası
// odundan üretilip yerleştirilir. Co-op: sandıklar ortaktır, host otoriterdir (misafir paneli host'ta
// misafir bağlamında çizilir, tıklamalar orada çalışır → alınan eşya tıklayanın çantasına gider).
// events.js'teki ganimet sandıklarından (ev_chest) bağımsızdır.
//
// API (scene.storage): chests, nearest(x,y,max?,needRoom?), deposit(chest,id,n) → kalan, count(id),
//   take(id,n) → alınan, open(chest), place(tx,ty,starter?)
import { TILE, ITEMS, RECIPES, HOTBAR_SIZE } from '../config.js';
import { addCanvas, R, outline } from '../textures.js';
import { audio } from '../audio.js';
import { canPlace } from '../systems/PlayerActions.js';
import { Inventory } from '../systems/Inventory.js';
import { el, injectCSS } from '../ui/dom.js';

export const CHEST_SLOTS = 40;
const MAX_CHESTS = 6;          // başlangıç sandığı dahil
const OPEN_R = 22;             // etkileşim mesafesi

ITEMS.storage_chest = {
  name: 'Köy Sandığı', type: 'place', icon: 'stg_chest',
  desc: `${CHEST_SLOTS} yuvalı ortak depo. İşçiler topladıklarını en yakın sandığa koyar. Tıklayarak yerleştir.`
};
RECIPES.push({ out: 'storage_chest', qty: 1, cost: { wood: 10 } });

let st = null;
const S = () => st;

// ---------------- Dokular ----------------
function makeTextures(scene) {
  const chest = (key, open) => addCanvas(scene, key, 16, 14, (ctx) => {
    if (open) { R(ctx, 1, 0, 14, 4, '#5a4026'); R(ctx, 2, 4, 12, 2, '#1b1622'); R(ctx, 3, 4, 3, 1, '#c99a5a'); R(ctx, 9, 4, 2, 1, '#9aa3ad'); }
    else { R(ctx, 1, 2, 14, 4, '#7a5a34'); R(ctx, 1, 2, 14, 1, '#9a7448'); R(ctx, 1, 5, 14, 1, '#5a4026'); }
    R(ctx, 1, 6, 14, 7, '#6b4c2c'); R(ctx, 1, 6, 14, 1, '#8a6640');
    R(ctx, 1, 9, 14, 1, '#4f3820');                               // tahta aralığı
    R(ctx, 2, 2, 1, 11, '#3f6b3a'); R(ctx, 13, 2, 1, 11, '#3f6b3a'); // yeşil köy kuşakları (ganimet sandığından ayırt edilir)
    R(ctx, 7, 6, 2, 3, '#c9ced6'); R(ctx, 7, 7, 2, 1, '#5d6670');   // kilit
    R(ctx, 1, 13, 14, 1, 'rgba(24,20,37,0.35)');
    outline(ctx, 0, 0, 16, 14, '#1b1622');
  });
  chest('stg_chest', false); chest('stg_chest_open', true);
}

// ---------------- Sandık nesneleri ----------------
let nextId = 1;
function makeChest(scene, tx, ty, starter = false, slots = null) {
  const x = tx * TILE + 8, y = ty * TILE + 8;
  const sprite = scene.add.image(x, y + 6, 'stg_chest').setOrigin(0.5, 1).setDepth(y + 6);
  const zone = scene.add.zone(x, y + 2, 14, 8);
  st.blockers.add(zone);
  sprite.netSolid = zone;            // co-op: görünmez gövde, görünen sprite üzerinden misafire gider
  sprite.blocksPlayer = zone.blocksPlayer = true;
  const inv = new Inventory(CHEST_SLOTS);
  if (Array.isArray(slots)) inv.load(slots.slice(0, CHEST_SLOTS));
  inv.onChange(() => { st.ver++; });
  const c = { id: nextId++, tx, ty, x, y, starter: !!starter, inv, sprite, zone, alive: true, lidT: 0 };
  st.chests.push(c);
  scene.farm?.blocked?.add?.(scene.farm.key(tx, ty));
  st.ver++;
  return c;
}

function removeChest(scene, c) {
  c.alive = false;
  c.sprite.destroy();
  c.zone.destroy();
  const i = st.chests.indexOf(c);
  if (i >= 0) st.chests.splice(i, 1);
  scene.farm?.blocked?.delete?.(scene.farm.key(c.tx, c.ty));
  st.ver++;
}

function clearChests(scene) { [...st.chests].forEach((c) => removeChest(scene, c)); }

const used = (c) => c.inv.slots.filter(Boolean).length;
const hasRoom = (c, id) => c.inv.slots.some((s) => !s || (s.id === id && s.count < 99));

// Kapak kısa süre açık görünsün (NPC bıraktı / panel açık)
function lid(c, sec = 0.7) {
  if (!c.alive) return;
  c.lidT = Math.max(c.lidT, sec);
  if (c.sprite.texture.key !== 'stg_chest_open') c.sprite.setTexture('stg_chest_open');
}

// Başlangıç sandığı: sığınak kapısının yakınında boş bir kare
function placeStarter(scene) {
  const d = scene.shelter.door;
  const offs = [[40, 18], [-40, 18], [44, 6], [-44, 6], [40, 32], [-40, 32], [56, 20], [-56, 20], [28, 34], [-28, 34], [72, 10], [-72, 10]];
  for (const [ox, oy] of offs) {
    const tx = Math.floor((d.x + ox) / TILE), ty = Math.floor((d.y + oy) / TILE);
    const cx = tx * TILE + 8, cy = ty * TILE + 8;
    if (scene.farm?.get(tx, ty)) continue;
    if (st.chests.some((c) => c.tx === tx && c.ty === ty)) continue;
    if (scene.physics.overlapRect(cx - 7, cy - 7, 14, 14, false, true).length) continue;
    return makeChest(scene, tx, ty, true);
  }
  // Hiç boş yer yoksa kapının sağına zorla koy (engel olsa da erişilebilir)
  return makeChest(scene, Math.floor((d.x + 40) / TILE), Math.floor((d.y + 18) / TILE), true);
}

// ---------------- Depolama işlemleri ----------------
function nearest(x, y, max = Infinity, needRoom = null) {
  let best = null, bd = max;
  for (const c of st?.chests || []) {
    if (!c.alive || (needRoom && !hasRoom(c, needRoom === true ? null : needRoom))) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// Taşınanların sığacağı en yakın sandık (hiçbirine sığmıyorsa null)
function forCarry(x, y, carry, max = Infinity) {
  const ids = Object.keys(carry || {}).filter((id) => carry[id] > 0);
  let best = null, bd = max;
  for (const c of st?.chests || []) {
    if (!c.alive || (ids.length && !ids.some((id) => hasRoom(c, id)))) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function deposit(c, id, n) {
  if (!c?.alive || !ITEMS[id] || !(n > 0)) return n;
  return c.inv.add(id, n);
}

// NPC teslimatı: taşınanları sandığa koy, görsel geri bildirim. Dönüş: { stored: {id:q}, left: {id:q} }
function depositCarry(scene, c, carry) {
  const stored = {}, left = {};
  for (const [id, q] of Object.entries(carry || {})) {
    if (!ITEMS[id] || !(q > 0)) continue;
    const l = deposit(c, id, q);
    if (q - l > 0) stored[id] = q - l;
    if (l > 0) left[id] = l;
  }
  const kinds = Object.keys(stored);
  if (kinds.length) {
    lid(c);
    scene.spawnParticles(c.x, c.y - 4, 0xffe08a, 6);
    const first = kinds[0];
    scene.floatText(c.x, c.y - 12, `+${stored[first]} ${ITEMS[first].name}${kinds.length > 1 ? ' …' : ''}`, '#ffe08a');
    if (scene.tweens) scene.tweens.add({ targets: c.sprite, scaleY: 0.86, duration: 80, yoyo: true });
  }
  return { stored, left };
}

const count = (id) => (st?.chests || []).reduce((n, c) => n + c.inv.count(id), 0);

// Sandıklardan (en yakından başlayarak) eşya al: alınan miktar
function takeAny(id, n, x = 0, y = 0) {
  let got = 0;
  const list = [...(st?.chests || [])].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
  for (const c of list) {
    if (got >= n) break;
    const k = Math.min(n - got, c.inv.count(id));
    if (k > 0 && c.inv.remove(id, k)) got += k;
  }
  return got;
}

// ---------------- Yerleştirme ----------------
ITEMS.storage_chest.onUse = (scene, ctx) => {
  const fail = (msg) => { audio.sfx('error'); scene.hud.notice(msg); };
  if (st.chests.length >= MAX_CHESTS) return fail(`En fazla ${MAX_CHESTS} köy sandığı kurulabilir`);
  if (!canPlace(scene, ctx.cx, ctx.cy)) return fail('Buraya yerleştirilemez');
  if (scene.farm.blocked?.has(scene.farm.key(ctx.tx, ctx.ty))) return fail('Burada zaten bir şey var');
  if (!scene.inventory.remove('storage_chest', 1)) return;
  const c = makeChest(scene, ctx.tx, ctx.ty, false);
  scene.player.actionCd = 0.3;
  audio.sfx('place');
  lid(c, 0.5);
  scene.hud.toast('📦 Köy sandığı kuruldu. İşçiler topladıklarını en yakın sandığa koyacak.', 'ok');
};

// ---------------- Panel ----------------
// Açık paneller: { chest, content, render, g } — g: misafir bağlamı (co-op) ya da null (host/tek oyunculu)
function openChest(scene, c) {
  if (!c?.alive) return;
  const hud = scene.hud;
  const viewer = { chest: c, g: scene.net?.ctx || null, sig: '' };
  const body = el('div', 'stg-panel');
  const content = hud.openPanel('📦 Köy Sandığı', body, () => { const i = st.viewers.indexOf(viewer); if (i >= 0) st.viewers.splice(i, 1); });
  viewer.content = content;
  audio.sfx('click');
  lid(c, 1);

  const render = () => {
    if (!c.alive) { scene.hud.closeAll(); return true; }
    const inv = scene.inventory;
    viewer.sig = sigOf(c, inv);
    body.innerHTML = '';
    const head = el('div', 'stg-head', `<span><b>${used(c)}</b>/${CHEST_SLOTS} yuva</span>`);
    const btn = (label, cls, fn, off) => {
      const b = el('button', cls || '', label);
      if (off) b.disabled = true; else b.addEventListener('click', fn);
      head.appendChild(b);
      return b;
    };
    btn('⬆ Tümünü Al', 'primary stg-takeall', () => { takeAll(scene, c); render(); }, !used(c));
    const packed = inv.slots.some((s, i) => s && i >= HOTBAR_SIZE);
    btn('⬇ Çantayı Boşalt', 'stg-putall', () => { putAll(scene, c); render(); }, !packed);
    body.appendChild(head);

    const grid = el('div', 'stg-grid stg-chest');
    c.inv.slots.forEach((s, i) => {
      const node = el('div', 'slot', s ? hud.slotHTML(s, 99) : '');
      if (s) {
        node.title = `${ITEMS[s.id]?.name || s.id} ×${s.count} · al`;
        node.addEventListener('click', () => { takeSlot(scene, c, i); render(); });
      }
      grid.appendChild(node);
    });
    body.appendChild(grid);
    body.appendChild(el('div', 'stg-tip muted', 'Sandıktaki yığına tıkla → çantana al · Çantandaki eşyaya tıkla → sandığa koy'));
    body.appendChild(el('h4', 'stg-sub', '🎒 Çantan'));
    const bag = el('div', 'stg-grid stg-bag');
    inv.slots.forEach((s, i) => {
      const node = el('div', `slot${i < HOTBAR_SIZE ? ' hot' : ''}`, hud.slotHTML(s, i));
      if (s) {
        node.title = `${ITEMS[s.id]?.name || s.id} ×${s.count} · koy`;
        node.addEventListener('click', () => { putSlot(scene, c, i); render(); });
      }
      bag.appendChild(node);
    });
    body.appendChild(bag);
    if (!c.starter) {
      const foot = el('div', 'stg-foot');
      const rm = el('button', 'ghost', 'Sandığı kaldır');
      if (used(c)) { rm.disabled = true; rm.title = 'Önce sandığı boşalt'; }
      else rm.addEventListener('click', () => {
        if (used(c) || !c.alive) return;
        if (scene.inventory.add('storage_chest', 1) > 0) { scene.hud.toast('Çanta dolu!', 'warn'); audio.sfx('error'); return; }
        removeChest(scene, c);
        audio.sfx('place');
        scene.hud.closeAll();
      });
      foot.appendChild(rm);
      body.appendChild(foot);
    }
    return true;
  };
  viewer.render = render;
  st.viewers.push(viewer);
  render();
}

const sigOf = (c, inv) => `${st.ver}|${inv.slots.map((s) => (s ? `${s.id}:${s.count}` : '')).join(',')}|${c.alive ? 1 : 0}`;

function takeSlot(scene, c, i) {
  const s = c.inv.slots[i];
  if (!s || !c.alive) return 0;
  const id = s.id, n = s.count;
  const left = scene.inventory.add(id, n);
  const moved = n - left;
  if (moved <= 0) { scene.hud.toast('Çantan dolu!', 'warn'); audio.sfx('error'); return 0; }
  c.inv.removeAt(i, moved);
  audio.sfx('pop');
  if (left > 0) scene.hud.toast(`Çantan doldu: ${left}× ${ITEMS[id].name} sandıkta kaldı`, 'warn');
  return moved;
}

function takeAll(scene, c) {
  let moved = 0, full = false;
  for (let i = 0; i < c.inv.slots.length; i++) {
    const s = c.inv.slots[i];
    if (!s) continue;
    const left = scene.inventory.add(s.id, s.count);
    const k = s.count - left;
    if (k > 0) { c.inv.removeAt(i, k); moved += k; }
    if (left > 0) full = true;
  }
  if (moved) audio.sfx('pop'); else audio.sfx('error');
  if (full) scene.hud.toast('Çantan doldu, kalanlar sandıkta.', 'warn');
  return moved;
}

function putSlot(scene, c, i) {
  const inv = scene.inventory, s = inv.slots[i];
  if (!s || !c.alive) return 0;
  const left = c.inv.add(s.id, s.count);
  const moved = s.count - left;
  if (moved <= 0) { scene.hud.toast('Sandık dolu!', 'warn'); audio.sfx('error'); return 0; }
  if (moved >= s.count && scene.hud.pickedSlot === i) scene.hud.pickedSlot = null;
  inv.removeAt(i, moved);
  audio.sfx('click');
  return moved;
}

function putAll(scene, c) {
  const inv = scene.inventory;
  let moved = 0, full = false;
  for (let i = HOTBAR_SIZE; i < inv.slots.length; i++) {
    const s = inv.slots[i];
    if (!s) continue;
    const left = c.inv.add(s.id, s.count);
    const k = s.count - left;
    if (k > 0) { inv.removeAt(i, k); moved += k; }
    if (left > 0) full = true;
  }
  if (moved) audio.sfx('click');
  if (full) scene.hud.toast('Sandık doldu, kalanlar çantanda.', 'warn');
  return moved;
}

// Açık panelleri sandık/çanta değişince yenile (co-op'ta host/misafir aynı anda kullanabilir)
function refreshViewers(scene) {
  for (const v of [...st.viewers]) {
    const inv = v.g ? v.g.inv : scene.inventory;
    if (!inv || sigOf(v.chest, inv) === v.sig) continue;
    let ok;
    if (v.g) ok = scene.net?.withGuest?.(v.g, v.render);
    else if (!scene.net?.ctx) ok = v.render();
    if (v.g && !ok) { const i = st.viewers.indexOf(v); if (i >= 0) st.viewers.splice(i, 1); } // misafir ayrıldı
  }
}

const CSS = `
.stg-panel { display: flex; flex-direction: column; gap: 8px; }
.stg-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.stg-head > span { margin-right: auto; color: var(--muted); }
.stg-head > span b { color: var(--text, #fff); }
.stg-grid { display: grid; grid-template-columns: repeat(8, 44px); gap: 5px; justify-content: center; }
.stg-grid .slot { width: 44px; height: 44px; }
.stg-grid .slot img { width: 30px; height: 30px; }
.stg-grid.stg-chest { padding: 6px; border-radius: 10px; background: rgba(63, 107, 58, 0.16); border: 1px solid rgba(120, 190, 110, 0.25); }
.stg-bag .slot.hot { border-color: rgba(255, 209, 102, 0.28); }
.stg-sub { margin: 2px 0 0; font-size: 13px; }
.stg-tip { font-size: 12px; text-align: center; }
.stg-foot { display: flex; justify-content: flex-end; }
body.is-touch .stg-grid { grid-template-columns: repeat(6, 44px); }
@media (max-width: 520px) { .stg-grid { grid-template-columns: repeat(6, 40px); } .stg-grid .slot { width: 40px; height: 40px; } }
`;

// ---------------- Modül ----------------
export default {
  id: 'storage',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    st = { chests: [], viewers: [], ver: 0, blockers: scene.physics.add.staticGroup(), t: 0 };
    nextId = 1;
    scene.physics.add.collider(scene.player, st.blockers);
    injectCSS('storage', CSS);
    scene.storage = {
      get chests() { return st.chests; },
      nearest, forCarry, deposit, count, take: takeAny,
      depositCarry: (c, carry) => depositCarry(scene, c, carry),
      open: (c) => openChest(scene, c),
      place: (tx, ty, starter) => makeChest(scene, tx, ty, starter),
      ensureStarter: () => (st.chests.some((c) => c.starter) ? null : placeStarter(scene))
    };

    scene.addInteraction((s) => {
      const p = s.player;
      if (!p?.alive || !st.chests.length) return null;
      let best = null, bd = OPEN_R;
      for (const c of st.chests) {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) return null;
      const c = best;
      return { dist: bd, label: `Köy Sandığı (${used(c)}/${CHEST_SLOTS})`, run: () => openChest(s, c) };
    });

    scene.minimapDots = scene.minimapDots || [];
    scene.minimapDots.push(() => (st?.chests || []).map((c) => ({ x: c.x, y: c.y, color: '#7fbf5a', r: 1 })));
  },

  begin(scene) {
    // Yeni oyun ya da sandık sistemi öncesinden kalan kayıt: sığınağın yanına başlangıç sandığı
    if (!st.chests.some((c) => c.starter)) placeStarter(scene);
  },

  update(scene, dt) {
    for (const c of st.chests) {
      if (c.lidT > 0) {
        c.lidT -= dt;
        const watched = st.viewers.some((v) => v.chest === c);
        if (c.lidT <= 0 && !watched) c.sprite.setTexture('stg_chest');
        else if (c.lidT <= 0) c.lidT = 0.3;
      }
    }
    st.t -= dt;
    if (st.t <= 0 && st.viewers.length) { st.t = 0.2; refreshViewers(scene); }
  },

  save() {
    return {
      chests: st.chests.map((c) => ({ tx: c.tx, ty: c.ty, starter: c.starter ? 1 : 0, slots: c.inv.serialize() }))
    };
  },

  load(scene, data) {
    clearChests(scene);
    st.viewers.length = 0;
    (Array.isArray(data?.chests) ? data.chests : []).slice(0, MAX_CHESTS).forEach((d) => {
      if (!Number.isFinite(d?.tx) || !Number.isFinite(d?.ty)) return;
      makeChest(scene, d.tx | 0, d.ty | 0, !!d.starter, Array.isArray(d.slots) ? d.slots : null);
    });
  }
};
