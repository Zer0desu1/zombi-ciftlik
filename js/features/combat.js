// 'combat' özellik modülü — oyuncu savaşı ve silahlar (sözleşme için registry.js'e bak).
// Kaçış yuvarlanması (Shift), kritik vuruş, yay/pompalı/mızrak, tabanca şarjörü (R),
// Q ile hızlı silah değişimi, Zeynep'te silah seviye yükseltme.
import { ITEMS, RECIPES, SHOPS, HOTBAR_SIZE } from '../config.js';
import { audio } from '../audio.js';
import { addCanvas, R } from '../textures.js';
import { injectCSS, el, featureLayer, topExtra } from '../ui/dom.js';
import { isTouch, touchCapable } from '../ui/device.js';
import { melee, rollDamage, hitTarget, fail } from '../systems/PlayerActions.js';
import { DODGE } from '../entities/Player.js';
import { aimAssist, setAimAssist } from '../ui/TouchControls.js';

const MAG_SIZE = 8;         // tabanca şarjörü
const RELOAD_TIME = 1.2;    // sn
const BOW_CHARGE = 0.4;     // tam gerilme süresi (sn)
const MAX_SHOTS = 60;       // aynı anda en fazla mermi/ok
const MAX_LEVEL = 3;
const UPGRADE_COST = { 2: { coins: 80, stone: 5 }, 3: { coins: 200, stone: 10 } };
const WEAPONS = ['sword', 'spear', 'bow', 'pistol', 'shotgun'];
const DEG = Math.PI / 180;
const COMBO_WINDOW = 0.8;   // kılıç kombosu: bu süre içinde tekrar vurursan seri sürer
const BLOOM_MAX = 7 * DEG;  // tabanca seri atış sapması
const BLOOM_DECAY = 18 * DEG; // sn başına toparlanma

// Sahne başına durum (init'te sıfırlanır)
let S = null;
const fresh = () => ({
  levels: {}, mag: 0, reload: 0, recent: [], charge: null, shots: null, gfx: null, gfxOn: false,
  selKey: '', ammoTxt: null, ammoEl: null, dodgeBtn: null, lastTap: { i: -1, t: 0 }, cleanup: [],
  combo: 0, comboT: -9, bloom: 0, dryAt: 0, hurtEl: null
});

// ---------------- Yardımcılar ----------------
// Oyuncuya özel savaş durumu: çok oyunculuda host'taki misafir karakterlerinin kendi şarjörü/kombosu olur
const PS = (scene) => (scene.player?.netRemote ? (scene.player.cbState ||= { mag: 0, reload: 0, combo: 0, comboT: -9, bloom: 0, dryAt: 0 }) : S);
const lvl = (id) => Phaser.Math.Clamp(S?.levels?.[id] || 1, 1, MAX_LEVEL);
const selectedSlot = (scene) => scene.inventory.slots[scene.selected];
const isWeapon = (id) => !!id && WEAPONS.includes(id);

function zeynep(scene, range = 40) {
  const n = scene.npcs?.find((x) => x.key === 'blacksmith');
  if (!n || n.hidden || !n.active) return null;
  const d = Phaser.Math.Distance.Between(scene.player.x, scene.player.y, n.x, n.y);
  return d <= range ? { npc: n, dist: d } : null;
}

// Mermi/ok/saçma üret (kendi fizik grubumuzda; delip geçme ve kritik bilgisi taşır)
function spawnShot(scene, x, y, ang, o) {
  if (S.shots.countActive(true) >= MAX_SHOTS) return null;
  const s = S.shots.create(x, y, o.tex);
  s.body.setSize(4, 4);
  s.setRotation(ang).setDepth(y + 20);
  s.setVelocity(Math.cos(ang) * o.speed, Math.sin(ang) * o.speed);
  Object.assign(s, { isShot: true, dmg: o.dmg, crit: o.crit, weapon: o.weapon, pierce: o.pierce || 0, sx: x, sy: y, range: o.range, hitSet: null, owner: scene.player });
  if (o.crit) s.setTint(0xfff2a0);
  return s;
}

function onShotHit(scene, a, b) {
  // Phaser grup-grup çakışmasında argüman sırası değişebilir
  const s = a.isShot ? a : b, z = a.isShot ? b : a;
  if (!s.active || !z.active || z.dead || typeof z.takeDamage !== 'function') return;
  if (s.hitSet && s.hitSet.has(z)) return;
  // Çok oyunculu: misafirin oku/mermisi → hasar, ödül ve XP misafir bağlamında
  if (s.owner?.netRemote && scene.net?.asPlayer) scene.net.asPlayer(s.owner, () => hitTarget(scene, z, s.dmg, s.crit, s, s.weapon));
  else hitTarget(scene, z, s.dmg, s.crit, s, s.weapon);
  if (s.pierce > 0) {
    s.pierce--;
    (s.hitSet ||= new Set()).add(z);
  } else s.destroy();
}

// Mühimmat bitti: kaçırılamayacak uyarı (oyuncunun üstünde kırmızı yazı + kuru tetik sesi + sayaç sallanır)
function noAmmo(scene, msg, short) {
  const now = scene.time.now, C = PS(scene);
  scene.player.actionCd = Math.max(scene.player.actionCd, 0.25);
  if (now - C.dryAt < 600) return;
  C.dryAt = now;
  fail(scene, msg);
  audio.tone({ type: 'square', freq: 2200, to: 1800, dur: 0.03, vol: 0.12 });
  const p = scene.player;
  scene.floatText(p.x, p.y - 16, short, '#ff5b5b');
  if (S.ammoEl && C === S) { S.ammoEl.classList.remove('shake'); void S.ammoEl.offsetWidth; S.ammoEl.classList.add('shake'); }
}

// ---------------- Silah davranışları (ITEMS[id].onUse) ----------------
// Kılıç: 3 vuruşluk seri; 3. vuruş geniş, iki kat hasarlı ve geri savurur
function useSword(scene, ctx) {
  const p = scene.player, now = scene.time.now / 1000, C = PS(scene);
  if (now - C.comboT > COMBO_WINDOW) C.combo = 0;
  C.combo = (C.combo % 3) + 1;
  C.comboT = now;
  const dmg = ITEMS.sword.dmg;
  if (C.combo < 3) {
    melee(scene, ctx.wx, ctx.wy, dmg, { weapon: 'sword', range: 25, cone: 1.25, cd: 0.26 });
    return;
  }
  const hits = melee(scene, ctx.wx, ctx.wy, dmg * 2, { weapon: 'sword', range: 31, cone: 1.7, cd: 0.5, energy: 1.2 });
  const a = Phaser.Math.Angle.Between(p.x, p.y, ctx.wx, ctx.wy);
  const fx = scene.add.image(p.x + Math.cos(a) * 12, p.y + Math.sin(a) * 12, 'slash').setRotation(a).setDepth(p.depth + 2).setTint(0xffd166).setScale(1.5);
  scene.tweens.add({ targets: fx, alpha: 0, scale: 2.3, duration: 220, onComplete: () => fx.destroy() });
  audio.tone({ type: 'square', freq: 420, to: 140, dur: 0.12, vol: 0.2 });
  if (!hits) return;
  scene.cameras.main.shake(90, 0.005);
  scene.floatText(p.x, p.y - 16, 'KOMBO!', '#ffd166');
  for (const z of scene.zombies.getChildren()) {
    if (z.dead || !z.active || z.def?.kb === 0) continue;
    if (Phaser.Math.Distance.Between(p.x, p.y, z.x, z.y) < 34) z.knockback(p.x, p.y, 90);
  }
}

function useSpear(scene, ctx) {
  melee(scene, ctx.wx, ctx.wy, ITEMS.spear.dmg, { weapon: 'spear', range: 36, cone: 0.42, cd: 0.45, energy: 0.7, fx: 'thrust' });
}

function usePistol(scene, ctx) {
  const p = scene.player, C = PS(scene);
  if (C.reload > 0) { scene.hud.notice('Dolduruluyor…'); return; }
  if (C.mag <= 0) { startReload(scene, false); return; }
  C.mag--;
  p.actionCd = 0.28;
  // Seri atışta sapma büyür; ilk atış her zaman isabetli
  const a = Phaser.Math.Angle.Between(p.x, p.y - 2, ctx.wx, ctx.wy) + Phaser.Math.FloatBetween(-C.bloom, C.bloom);
  C.bloom = Math.min(BLOOM_MAX, C.bloom + 2.5 * DEG);
  const r = rollDamage(scene, 'pistol', ITEMS.pistol.dmg);
  spawnShot(scene, p.x, p.y - 2, a, { tex: 'bullet', speed: 320, range: 230, dmg: r.dmg, crit: r.crit, weapon: 'pistol' });
  // Geri tepme + namlu alevi
  p.body.velocity.x -= Math.cos(a) * 30;
  p.body.velocity.y -= Math.sin(a) * 30;
  const fl = scene.add.circle(p.x + Math.cos(a) * 9, p.y - 2 + Math.sin(a) * 9, 3, 0xfff2a0, 1).setDepth(p.depth + 2);
  scene.tweens.add({ targets: fl, alpha: 0, scale: 1.8, duration: 70, onComplete: () => fl.destroy() });
  scene.cameras.main.shake(50, 0.0025);
  audio.sfx('shoot');
  if (C.mag <= 0) startReload(scene, true); // boşalınca otomatik doldur
  refreshAmmo(scene);
}

function startReload(scene, auto) {
  const C = PS(scene);
  if (C.reload > 0) return;
  if (C.mag >= MAG_SIZE) { if (!auto) scene.hud.notice('Şarjör zaten dolu'); return; }
  if (scene.inventory.count('ammo') <= 0) {
    noAmmo(scene, auto ? 'Şarjör boşaldı, yedek mermin yok! Hurdadan üret ya da Zeynep\'ten al.' : 'Mermin yok! Hurdadan üret ya da Zeynep\'ten al.', 'MERMİ YOK!');
    return;
  }
  C.reload = RELOAD_TIME;
  audio.tone({ type: 'square', freq: 520, to: 300, dur: 0.06, vol: 0.12 });
  refreshAmmo(scene);
}

function finishReload(scene) {
  const C = PS(scene);
  const n = Math.min(MAG_SIZE - C.mag, scene.inventory.count('ammo'));
  if (n > 0 && scene.inventory.remove('ammo', n)) C.mag += n;
  audio.tone({ type: 'square', freq: 700, to: 1100, dur: 0.07, vol: 0.14 });
  refreshAmmo(scene);
}

function useShotgun(scene, ctx) {
  const p = scene.player;
  if (scene.inventory.count('ammo') < 2) return noAmmo(scene, 'Pompalı için en az 2 mermi gerek!', 'MERMİ YOK!');
  scene.inventory.remove('ammo', 2);
  p.actionCd = 0.9;
  const base = Phaser.Math.Angle.Between(p.x, p.y - 2, ctx.wx, ctx.wy);
  for (let i = 0; i < 5; i++) {
    const a = base + (-18 + i * 9 + Phaser.Math.FloatBetween(-2, 2)) * DEG;
    const r = rollDamage(scene, 'shotgun', ITEMS.shotgun.dmg);
    spawnShot(scene, p.x, p.y - 2, a, { tex: 'cb_pellet', speed: Phaser.Math.Between(290, 330), range: 110, dmg: r.dmg, crit: r.crit, weapon: 'shotgun' });
  }
  // Geri tepme
  p.body.velocity.x -= Math.cos(base) * 90;
  p.body.velocity.y -= Math.sin(base) * 90;
  scene.cameras.main.shake(110, 0.006);
  audio.noise({ dur: 0.25, vol: 0.5, freq: 2200 });
  audio.tone({ type: 'square', freq: 300, to: 60, dur: 0.18, vol: 0.25 });
  refreshAmmo(scene);
}

function useBow(scene, ctx) {
  if (S.charge) return;
  if (scene.inventory.count('arrow') <= 0) return noAmmo(scene, 'Okun yok! 1 odun + 1 taştan 5 ok üret.', 'OK YOK!');
  const ptr = scene.input.activePointer;
  // Çok oyunculu misafir: germe girdisi host'ta yok → tam gerilmiş ok
  // (misafir yayı kendi ekranında gerer; gerilme oranı 'use' mesajıyla gelir → scene.player.netCharge)
  if (scene.player?.netRemote) { fireArrow(scene, Phaser.Math.Angle.Between(scene.player.x, scene.player.y - 2, ctx.wx, ctx.wy), scene.player.netCharge ?? 1); return; }
  // Fare/boşluk basılıysa ger, bırakınca at; dokunmatik/mobil butonda otomatik tam gerilme
  if (ptr.isDown && !ptr.wasTouch && ptr.leftButtonDown()) S.charge = { t: 0, src: 'mouse' };
  else if (S.space?.isDown) S.charge = { t: 0, src: 'space' };
  else { fireArrow(scene, Phaser.Math.Angle.Between(scene.player.x, scene.player.y - 2, ctx.wx, ctx.wy), 1); return; }
  scene.player.speedMul = 0.55;
  audio.tone({ type: 'triangle', freq: 220, to: 330, dur: 0.3, vol: 0.08 });
}

function fireArrow(scene, ang, ratio) {
  const p = scene.player;
  if (!scene.inventory.remove('arrow', 1)) return fail(scene, 'Okun yok!');
  p.actionCd = 0.45;
  const r = rollDamage(scene, 'bow', ITEMS.bow.dmg * (0.5 + 0.5 * ratio));
  spawnShot(scene, p.x, p.y - 2, ang, { tex: 'cb_arrow', speed: 140 + 200 * ratio, range: 120 + 130 * ratio, dmg: r.dmg, crit: r.crit, weapon: 'bow', pierce: 1 });
  if (Math.abs(Math.cos(ang)) > 0.1) p.setFlipX(Math.cos(ang) < 0);
  audio.tone({ type: 'triangle', freq: 900, to: 300, dur: 0.12, vol: 0.18 });
  audio.noise({ dur: 0.08, vol: 0.15, freq: 3500 });
  refreshAmmo(scene);
}

function releaseCharge(scene, cancel) {
  const c = S.charge;
  S.charge = null;
  scene.player.speedMul = 1;
  if (cancel || !c) return;
  const wp = scene.input.activePointer.positionToCamera(scene.cameras.main);
  const p = scene.player;
  fireArrow(scene, Phaser.Math.Angle.Between(p.x, p.y - 2, wp.x, wp.y), Math.min(1, c.t / BOW_CHARGE));
}

// ---------------- Hızlı geçiş (Q / slota çift dokunma) ----------------
function trackSelection(scene) {
  const slot = selectedSlot(scene);
  const key = `${scene.selected}:${slot?.id || ''}`;
  if (key === S.selKey) return;
  S.selKey = key;
  if (S.charge && slot?.id !== 'bow') releaseCharge(scene, true);
  if (slot && isWeapon(slot.id) && S.recent[0] !== slot.id) S.recent = [slot.id, S.recent[0]].filter(Boolean);
  // Boş şarjörlü tabancaya geçince sessizce doldurmaya başla (ilk tıklama boşa gitmesin)
  if (slot?.id === 'pistol' && S.mag <= 0 && scene.player.alive) startReload(scene, true);
  // Masaüstünde silah elindeyken nişangâh imleci
  if (!isTouch && scene.game.canvas) {
    const t = slot ? ITEMS[slot.id]?.type : null;
    scene.game.canvas.style.cursor = t === 'weapon' || t === 'gun' ? 'crosshair' : '';
  }
  refreshAmmo(scene);
}

function quickSwap(scene) {
  const cur = selectedSlot(scene);
  const want = cur && isWeapon(cur.id) ? S.recent[1] : S.recent[0];
  if (!want) { scene.hud.notice('Geçiş yapılacak ikinci silah yok'); return; }
  const inv = scene.inventory.slots;
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    if (inv[i]?.id === want && i !== scene.selected) { scene.selectSlot(i); audio.sfx('click'); return; }
  }
  scene.hud.notice(`${ITEMS[want].name} hotbarda değil`);
}

// ---------------- Silah yükseltme paneli ----------------
function openWeaponPanel(scene) {
  const body = el('div', 'cb-panel');
  const render = () => {
    const z = zeynep(scene);
    const owned = WEAPONS.filter((id) => scene.inventory.count(id) > 0);
    const crit = Math.round(scene.combat.critChance() * 100);
    let html = `<p class="muted">${z ? '🔨 Zeynep örsün başında, silahını yükseltebilir.' : '🔨 Yükseltmek için Zeynep\'in yanına git.'}</p>`;
    html += `<div class="cb-stats"><span>🎯 Kritik %${crit} (x2)</span><span>💨 Yuvarlanma ${DODGE.energy}⚡</span>`;
    html += isTouch ? '<span>Slota çift dokun: hızlı geçiş</span></div>' : '<span>Shift kaç · Q geçiş · R doldur</span></div>';
    if (!owned.length) html += '<p class="muted">Henüz silahın yok.</p>';
    body.innerHTML = html;
    if (isTouch) {
      const names = ['Kapalı', 'Yumuşak', 'Güçlü'];
      const row = el('div', 'cb-aim', `<span>🎯 Nişan yardımı</span>${names.map((n, i) => `<button class="${aimAssist.level === i ? 'primary' : 'ghost'}" data-l="${i}">${n}</button>`).join('')}`);
      row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { setAimAssist(Number(b.dataset.l)); audio.sfx('click'); render(); }));
      body.appendChild(row);
    }
    owned.forEach((id) => {
      const it = ITEMS[id], lv = lvl(id), next = lv + 1, cost = UPGRADE_COST[next];
      const dmg = Math.round(it.dmg * scene.combat.damageMult(id) * 10) / 10;
      const ok = z && cost && scene.player.coins >= cost.coins && scene.inventory.count('stone') >= cost.stone;
      const stars = '★'.repeat(lv) + `<i>${'★'.repeat(MAX_LEVEL - lv)}</i>`;
      const row = el('div', 'shop-row',
        `<img src="${scene.hud.icon(id)}" alt=""><div class="rinfo"><b>${it.name} <span class="cb-stars">${stars}</span></b>` +
        `<span class="muted">Hasar ${dmg}${id === 'shotgun' ? ' ×5' : ''}${cost ? ` → ${Math.round(it.dmg * (1 + 0.25 * lv) * 10) / 10}` : ' · en üst seviye'}</span></div>` +
        `<button class="primary" ${ok ? '' : 'disabled'}>${cost ? `Sv.${next} · ${cost.coins}🪙 + ${cost.stone} taş` : 'Maks.'}</button>`);
      row.querySelector('button').addEventListener('click', () => { upgrade(scene, id); render(); });
      body.appendChild(row);
    });
    if (z) {
      const talk = el('button', 'ghost cb-talk', `💬 ${z.npc.npcName} ile konuş`);
      talk.addEventListener('click', () => { scene.hud.closeAll(); scene.talkTo(z.npc); });
      body.appendChild(talk);
    }
  };
  render();
  scene.hud.openPanel('⚔️ Silahlar', body);
}

function upgrade(scene, id) {
  const next = lvl(id) + 1, cost = UPGRADE_COST[next];
  if (!cost || !zeynep(scene)) return;
  const p = scene.player;
  if (p.coins < cost.coins || scene.inventory.count('stone') < cost.stone) { audio.sfx('error'); return; }
  p.addCoins(-cost.coins);
  scene.inventory.remove('stone', cost.stone);
  S.levels[id] = next;
  audio.sfx('craft');
  scene.hud.toast(`${ITEMS[id].name} Sv.${next} oldu! Hasar +%25`, 'ok');
  scene.events.emit('weaponUpgraded', { id, level: next });
}

// ---------------- Arayüz ----------------
const CSS = `
.cb-ammo { display:none; align-items:center; gap:4px; font-size:12px; font-weight:600; padding:2px 8px; border-radius:8px;
  background:rgba(255,255,255,.08); pointer-events:auto; cursor:pointer; white-space:nowrap; font-variant-numeric:tabular-nums; }
.cb-ammo.show { display:inline-flex; }
.cb-ammo.empty { color:var(--red,#eb5757); }
.cb-ammo.reload { color:var(--accent,#ffd166); }
.cb-dodge { position:absolute; width:48px; height:48px; border-radius:50%; pointer-events:auto; touch-action:none;
  right:calc(env(safe-area-inset-right, 0px) + 112px); bottom:calc(env(safe-area-inset-bottom, 0px) + 104px);
  background:rgba(18,22,32,.55); border:1px solid rgba(255,255,255,.22); color:#fff; font-size:20px; display:none;
  align-items:center; justify-content:center; padding:0; -webkit-user-select:none; user-select:none; z-index:5; }
.cb-dodge.show { display:flex; }
body.modal-open .cb-dodge, body:not(.playing) .cb-dodge { display:none; }
.cb-dodge.cd { opacity:.45; }
.cb-dodge:active { transform:scale(.92); }
.cb-panel .cb-stats { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0 10px; font-size:12px; }
.cb-panel .cb-stats span { background:rgba(255,255,255,.07); padding:3px 8px; border-radius:8px; }
.cb-panel .shop-row { margin-bottom:6px; }
.cb-panel .shop-row .rinfo { flex:1; min-width:0; }
.cb-panel .shop-row button { min-height:40px; flex-shrink:0; max-width:46%; white-space:normal; line-height:1.2; }
.cb-stars { color:var(--accent,#ffd166); font-size:11px; letter-spacing:1px; }
.cb-stars i { font-style:normal; opacity:.3; filter:grayscale(1); }
.cb-talk { width:100%; margin-top:6px; min-height:44px; }
.cb-ammo.shake { animation: cbShake .4s ease; color:var(--red,#eb5757); }
@keyframes cbShake { 0%,100% { transform:none; } 20%,60% { transform:translateX(-4px); } 40%,80% { transform:translateX(4px); } }
.cb-aim { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin:0 0 10px; font-size:12px; }
.cb-aim span { flex:1 0 100%; opacity:.85; }
.cb-aim button { flex:1; min-height:40px; padding:4px 6px; }
.cb-hurt { position:absolute; inset:0; pointer-events:none; opacity:0; z-index:4; }
.cb-hurt.on { animation: cbHurt .5s ease-out forwards; }
@keyframes cbHurt { 0% { opacity:1; } 100% { opacity:0; } }
`;

function buildUI(scene) {
  injectCSS('combat', CSS);
  const top = topExtra();
  if (top) {
    S.ammoEl = el('span', 'cb-ammo');
    S.ammoEl.title = 'Tıkla: şarjörü doldur (R)';
    const onTap = (e) => { e.stopPropagation(); if (selectedSlot(scene)?.id === 'pistol') startReload(scene, false); };
    S.ammoEl.addEventListener('click', onTap);
    top.appendChild(S.ammoEl);
    S.cleanup.push(() => S.ammoEl?.remove());
  }
  const layer = featureLayer();
  if (layer) {
    S.hurtEl = el('div', 'cb-hurt');
    layer.appendChild(S.hurtEl);
    S.cleanup.push(() => S.hurtEl?.remove());
  }
  // Dokunmatik ekranlı her cihazda kurulur; görünürlüğü body.is-touch ile mobile.css belirler (ayardan anında açılıp kapanır)
  if (layer && (isTouch || touchCapable)) {
    const b = el('button', 'cb-dodge', '💨');
    b.setAttribute('aria-label', 'Kaçış yuvarlanması');
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!scene.started || scene.gameOver || scene.hud.isModalOpen()) return;
      scene.player.dodge();
    });
    layer.appendChild(b);
    S.dodgeBtn = b;
    S.cleanup.push(() => b.remove());
  }
}

// Şarjör / mühimmat etiketi: yalnızca değiştiğinde DOM'a yazar
function refreshAmmo(scene) {
  if (!S?.ammoEl || scene.player?.netRemote) return;
  const id = selectedSlot(scene)?.id;
  const inv = scene.inventory;
  let txt = '', cls = '';
  if (id === 'pistol') {
    const reserve = inv.count('ammo');
    txt = S.reload > 0 ? '🔫 Dolduruluyor…' : `🔫 ${S.mag}/${MAG_SIZE} · ${reserve}`;
    cls = S.reload > 0 ? 'reload' : (S.mag === 0 ? 'empty' : '');
  } else if (id === 'shotgun') {
    const n = inv.count('ammo');
    txt = `💥 ${n} mermi`; cls = n < 2 ? 'empty' : '';
  } else if (id === 'bow') {
    const n = inv.count('arrow');
    txt = `🏹 ${n} ok`; cls = n === 0 ? 'empty' : '';
  }
  const key = txt + '|' + cls;
  if (key === S.ammoTxt) return;
  S.ammoTxt = key;
  S.ammoEl.textContent = txt;
  S.ammoEl.className = `cb-ammo${txt ? ' show' : ''}${cls ? ' ' + cls : ''}`;
}

// Vurulunca darbenin geldiği yönde ekran kenarı kızarır (juice'un genel vinyetine yön bilgisi ekler)
function onHurt(scene, e) {
  const box = S.hurtEl, p = scene.player;
  if (!box || !p) return;
  const dx = e.x - p.x, dy = e.y - p.y;
  const a = Math.hypot(dx, dy) > 2 ? Math.round(Math.atan2(dx, -dy) / DEG) : null;
  const k = Math.min(0.75, 0.3 + e.dmg / 30);
  box.style.background = a === null
    ? `radial-gradient(ellipse at center, rgba(200,0,20,0) 55%, rgba(200,0,20,${k}) 100%)`
    : `linear-gradient(${a}deg, rgba(200,0,20,0) 62%, rgba(220,10,30,${k}) 100%)`;
  box.classList.remove('on'); void box.offsetWidth; box.classList.add('on');
}

// Oyuncunun üstünde ilerleme çubuğu (yay gerilmesi / şarjör doldurma) ya da kılıç kombo noktaları
function drawBar(scene) {
  const p = scene.player;
  let r = -1, col = 0xffd166;
  if (S.charge) { r = Math.min(1, S.charge.t / BOW_CHARGE); col = r >= 1 ? 0x9effa0 : 0xffd166; }
  else if (S.reload > 0 && selectedSlot(scene)?.id === 'pistol') { r = 1 - S.reload / RELOAD_TIME; col = 0x5ab0ff; }
  const combo = S.combo > 0 && S.combo < 3 && scene.time.now / 1000 - S.comboT < COMBO_WINDOW && selectedSlot(scene)?.id === 'sword';
  const g = S.gfx;
  if (r < 0 && !combo) { if (S.gfxOn) { g.clear(); S.gfxOn = false; } return; }
  S.gfxOn = true;
  g.clear();
  const x = p.x - 7, y = p.y - 13;
  if (combo) {
    // Üç nokta: dolanlar seriyi, son nokta güçlü vuruşu gösterir
    for (let i = 0; i < 3; i++) g.fillStyle(i < S.combo ? 0xffd166 : 0x000000, i < S.combo ? 1 : 0.5).fillRect(x + 2 + i * 4, y, 2, 2);
    return;
  }
  g.fillStyle(0x000000, 0.6).fillRect(x, y, 14, 2);
  g.fillStyle(col, 1).fillRect(x, y, 14 * r, 2);
}

// ---------------- Eşyalar / tarifler / dükkân (modül yüklenirken) ----------------
ITEMS.spear = { name: 'Mızrak', type: 'weapon', icon: 'i_spear', dmg: 3, desc: 'Uzun menzilli dar saplama (36px).', onUse: useSpear };
ITEMS.bow = { name: 'Yay', type: 'gun', icon: 'i_bow', dmg: 4, desc: 'Basılı tutup ger, bırakınca ok atar. Ok bir hedefi delip geçer.', onUse: useBow };
ITEMS.arrow = { name: 'Ok', type: 'material', icon: 'i_arrow', sell: 1 };
ITEMS.shotgun = { name: 'Pompalı Tüfek', type: 'gun', icon: 'i_shotgun', dmg: 2, desc: '5 saçma, yakında yıkıcı. Atış başına 2 mermi.', onUse: useShotgun };
if (ITEMS.sword) {
  ITEMS.sword.onUse = useSword;
  ITEMS.sword.desc = 'Üç vuruşluk seri: 3. vuruş geniş açılı, iki kat hasarlı ve geri savurur.';
}
if (ITEMS.pistol) {
  ITEMS.pistol.onUse = usePistol;
  ITEMS.pistol.desc = `Şarjör ${MAG_SIZE} mermi; R ile doldur, boşalınca kendiliğinden dolar.`;
}
RECIPES.push(
  { out: 'bow', qty: 1, cost: { wood: 5, stone: 2 } },
  { out: 'arrow', qty: 5, cost: { wood: 1, stone: 1 } },
  { out: 'spear', qty: 1, cost: { wood: 4, stone: 3 } }
);
SHOPS.blacksmith.push({ id: 'arrow', qty: 10, price: 12 }, { id: 'shotgun', qty: 1, price: 260 });

export default {
  id: 'combat',

  textures(scene) {
    const icon = (key, fn) => addCanvas(scene, key, 16, 16, fn);
    icon('i_bow', (ctx) => {
      for (let y = 2; y <= 14; y++) R(ctx, 4 + Math.round(7 * Math.sin(Math.PI * (y - 2) / 12)), y, 2, 1, '#8a5a3a');
      R(ctx, 4, 2, 1, 13, '#e6edf3');
      R(ctx, 2, 8, 11, 1, '#c9a06b'); R(ctx, 12, 7, 2, 3, '#b8c1cb'); R(ctx, 14, 8, 1, 1, '#b8c1cb');
      R(ctx, 1, 7, 2, 1, '#eb5757'); R(ctx, 1, 9, 2, 1, '#eb5757');
    });
    icon('i_arrow', (ctx) => {
      for (let i = 0; i < 9; i++) R(ctx, 3 + i, 12 - i, 1, 1, '#c9a06b');
      R(ctx, 11, 2, 3, 2, '#b8c1cb'); R(ctx, 12, 4, 2, 1, '#b8c1cb');
      R(ctx, 1, 12, 2, 2, '#eb5757'); R(ctx, 3, 14, 2, 1, '#eb5757'); R(ctx, 2, 11, 1, 1, '#f2f2f2');
    });
    icon('i_shotgun', (ctx) => {
      R(ctx, 1, 5, 10, 2, '#3a3a44'); R(ctx, 1, 5, 10, 1, '#5a5d66'); R(ctx, 1, 7, 9, 1, '#2a2a30');
      R(ctx, 3, 8, 4, 2, '#8a5a3a'); R(ctx, 10, 5, 3, 4, '#3a3a44');
      R(ctx, 12, 6, 3, 3, '#6b4a2f'); R(ctx, 13, 9, 3, 3, '#6b4a2f'); R(ctx, 11, 9, 1, 2, '#3a3a44');
    });
    icon('i_spear', (ctx) => {
      for (let i = 0; i < 10; i++) R(ctx, 2 + i, 13 - i, 2, 2, '#8a5a3a');
      R(ctx, 11, 2, 3, 3, '#cfd6de'); R(ctx, 13, 1, 2, 2, '#e6edf3'); R(ctx, 10, 4, 2, 2, '#9aa3ad');
      R(ctx, 9, 6, 2, 1, '#c9a443');
    });
    addCanvas(scene, 'cb_arrow', 9, 3, (ctx) => {
      R(ctx, 1, 1, 6, 1, '#c9a06b'); R(ctx, 7, 0, 1, 3, '#e6edf3'); R(ctx, 8, 1, 1, 1, '#e6edf3');
      R(ctx, 0, 0, 2, 1, '#eb5757'); R(ctx, 0, 2, 2, 1, '#eb5757');
    });
    addCanvas(scene, 'cb_pellet', 3, 3, (ctx) => { R(ctx, 0, 1, 3, 1, '#ffb347'); R(ctx, 1, 0, 1, 3, '#ffb347'); R(ctx, 1, 1, 1, 1, '#fff'); });
    addCanvas(scene, 'fx_thrust', 12, 3, (ctx) => {
      R(ctx, 0, 1, 9, 1, 'rgba(255,255,255,0.55)'); R(ctx, 8, 0, 3, 3, 'rgba(230,237,243,0.95)'); R(ctx, 11, 1, 1, 1, '#ffffff');
    });
  },

  init(scene) {
    S = fresh();
    S.shots = scene.physics.add.group();
    scene.shotGroup = S.shots; // diğer modüller (wildlife) atışlarla çakışma kurabilsin
    S.gfx = scene.add.graphics().setDepth(10002);
    scene.physics.add.overlap(S.shots, scene.zombies, (s, z) => onShotHit(scene, s, z));
    scene.lightSources.push(() => S.shots.getChildren().map((s) => ({ x: s.x, y: s.y, r: 10 })));

    // Diğer modüller için API (ör. progression: scene.combat.critBonus += 0.05)
    scene.combat = {
      critBonus: 0,
      dmgBonus: 0,
      // buffDmg/buffCrit: yemek güçlendirmeleri (harvest modülü), kalıcı bonuslardan ayrı tutulur
      buffDmg: 0,
      buffCrit: 0,
      critChance() { return Math.min(0.9, 0.1 + (this.critBonus || 0) + (this.buffCrit || 0)); },
      damageMult(id) { return (1 + 0.25 * (lvl(id) - 1)) * (1 + (this.dmgBonus || 0) + (this.buffDmg || 0)); },
      weaponLevel: (id) => lvl(id),
      dodge: () => scene.player.dodge(),
      reload: () => startReload(scene, false),
      quickSwap: () => quickSwap(scene),
      openPanel: () => openWeaponPanel(scene),
      get mag() { return S.mag; },
      // Çok oyunculu: host, misafir bağlamında (scene.player = misafir) her kare çağırır
      tickPlayer(dt) {
        const C = PS(scene);
        if (C === S) return;
        if (C.bloom > 0) C.bloom = Math.max(0, C.bloom - BLOOM_DECAY * dt);
        if (C.reload > 0) { C.reload -= dt; if (C.reload <= 0) { C.reload = 0; finishReload(scene); } }
      }
    };

    // Klavye: Shift kaçış, Q hızlı geçiş, R doldurma
    const kb = scene.input.keyboard;
    if (kb) {
      S.space = kb.addKey('SPACE', false);
      const onKey = (ev) => {
        if (!scene.started || scene.gameOver || scene.hud.isModalOpen() || ev.repeat) return;
        const k = ev.key.toLowerCase();
        if (k === 'shift') scene.player.dodge();
        else if (k === 'q') quickSwap(scene);
        else if (k === 'r') {
          if (selectedSlot(scene)?.id === 'pistol' || scene.inventory.count('pistol') > 0) startReload(scene, false);
        }
      };
      kb.on('keydown', onKey);
      S.cleanup.push(() => kb.off('keydown', onKey));
    }

    // Mobil/masaüstü: aynı hotbar slotuna çift dokunma → son silaha geç
    const onTap = (e) => {
      const slot = e.target.closest?.('#hotbar .slot');
      if (!slot || !scene.started) return;
      const i = slot.dataset.i != null ? Number(slot.dataset.i) : [...slot.parentNode.children].indexOf(slot);
      const now = performance.now();
      if (S.lastTap.i === i && now - S.lastTap.t < 350 && isWeapon(scene.inventory.slots[i]?.id)) {
        S.lastTap.i = -1;
        quickSwap(scene);
      } else S.lastTap = { i, t: now };
    };
    document.addEventListener('click', onTap);
    S.cleanup.push(() => document.removeEventListener('click', onTap));

    // Zeynep yanında silah elindeyken: yükseltme (paneldeki butonla konuşmaya da geçilir)
    scene.addInteraction((s) => {
      const slot = selectedSlot(s);
      if (!slot || !isWeapon(slot.id)) return null;
      const z = zeynep(s, 24);
      if (!z) return null;
      return { dist: z.dist - 0.5, label: 'Zeynep: Silah Yükselt', run: () => openWeaponPanel(s) };
    });
    scene.featureMenu.push({ id: 'combat', icon: '⚔️', label: 'Silahlar', open: (s) => openWeaponPanel(s) });

    scene.inventory.onChange(() => refreshAmmo(scene));
    buildUI(scene);
    const hurt = (e) => onHurt(scene, e);
    scene.events.on('playerHurt', hurt);
    S.cleanup.push(() => scene.events.off('playerHurt', hurt));
    scene.events.once('shutdown', () => { S?.cleanup.forEach((fn) => fn()); });
  },

  begin(scene) {
    S.dodgeBtn?.classList.add('show');
    S.selKey = '';
    trackSelection(scene);
  },

  update(scene, dt) {
    trackSelection(scene);
    const p = scene.player;

    // Yay germe: bırakınca at
    if (S.charge) {
      if (!p.alive) releaseCharge(scene, true);
      else {
        S.charge.t += dt;
        const held = S.charge.src === 'mouse' ? scene.input.activePointer.isDown : S.space?.isDown;
        if (!held) releaseCharge(scene, false);
      }
    }

    if (S.bloom > 0) S.bloom = Math.max(0, S.bloom - BLOOM_DECAY * dt);

    // Şarjör doldurma
    if (S.reload > 0) {
      S.reload -= dt;
      if (S.reload <= 0) { S.reload = 0; finishReload(scene); }
    }

    // Menzili dolan mermiler
    const shots = S.shots.getChildren();
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      if (Phaser.Math.Distance.Between(s.sx, s.sy, s.x, s.y) > s.range) s.destroy();
      else s.setDepth(s.y + 20);
    }

    drawBar(scene);
    if (S.dodgeBtn) {
      const cd = p.rollCd > 0 || p.energy < DODGE.energy;
      if (cd !== S.dodgeCd) { S.dodgeCd = cd; S.dodgeBtn.classList.toggle('cd', cd); }
    }
  },

  // Çok oyunculu: silah seviyeleri oyuncu başına (misafirinki host kaydında adına göre saklanır)
  playerState: {
    get: () => S.levels,
    set: (_scene, v) => { S.levels = v; },
    fresh: () => ({}),
    save: (v) => ({ ...v }),
    load: (_scene, d) => {
      const levels = {};
      for (const id of WEAPONS) { const v = Number(d?.[id]); if (v >= 1) levels[id] = Phaser.Math.Clamp(Math.floor(v), 1, MAX_LEVEL); }
      return levels;
    }
  },

  // Misafir: seçili slot değişince mühimmat etiketini yenile (simülasyon host'ta)
  guestUpdate(scene) {
    if (!S) return;
    const slot = selectedSlot(scene), key = `${scene.selected}:${slot?.id || ''}`;
    if (key !== S.selKey) { S.selKey = key; refreshAmmo(scene); }
  },

  // Misafirin şarjör göstergesi (host'taki kendi şarjör durumu)
  netPlayerState(scene) {
    const C = PS(scene);
    return [C.mag, C.reload > 0 ? 1 : 0];
  },
  netApplyPlayer(scene, v) {
    if (!S || !Array.isArray(v)) return;
    if (S.mag === v[0] && (S.reload > 0) === !!v[1]) return;
    S.mag = v[0]; S.reload = v[1] ? RELOAD_TIME : 0;
    refreshAmmo(scene);
  },

  save() {
    return { levels: { ...S.levels }, mag: S.mag, recent: S.recent.slice(0, 2) };
  },

  load(scene, d) {
    if (!d || typeof d !== 'object') return;
    const levels = {};
    for (const id of WEAPONS) {
      const v = Number(d.levels?.[id]);
      if (v >= 1) levels[id] = Phaser.Math.Clamp(Math.floor(v), 1, MAX_LEVEL);
    }
    S.levels = levels;
    S.mag = Phaser.Math.Clamp(Number(d.mag) || 0, 0, MAG_SIZE);
    S.recent = Array.isArray(d.recent) ? d.recent.filter((id) => isWeapon(id)).slice(0, 2) : [];
    S.ammoTxt = null;
    refreshAmmo(scene);
  }
};
