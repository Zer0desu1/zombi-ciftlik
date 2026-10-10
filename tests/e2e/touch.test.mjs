// Dokunmatik kontroller: dikey ve yatay telefonda joystick tabanı + etkileşim butonu görünür, sürükleme
// oyuncuyu yürütür, D-pad çalışır, NPC yanında ✋ aktifleşip diyalog açar, kontroller arayüzle çakışmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, assertNoErrors, MOBILE } from './_harness.mjs';

const LANDSCAPE = { ...MOBILE, viewport: { width: 844, height: 390 } };

// Gerçek dokunuş (CDP): Chrome bundan pointer + touch olaylarını üretir
async function touch(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y), id: 1 })) });
  return {
    start: (x, y) => send('touchStart', [[x, y]]),
    move: (x, y) => send('touchMove', [[x, y]]),
    end: () => send('touchEnd', []),
    tap: async (x, y) => { await send('touchStart', [[x, y]]); await send('touchEnd', []); }
  };
}

const center = (r) => [r.x + r.width / 2, r.y + r.height / 2];
const rect = (page, sel) => page.evaluate((q) => {
  const e = document.querySelector(q);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, sel);

// Görünür kontrollerin ve arayüz öğelerinin kutuları
function boxes(page) {
  return page.evaluate(() => {
    const vis = (e) => {
      if (!e) return null;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    };
    const pick = (map) => Object.fromEntries(Object.entries(map).map(([k, q]) => [k, vis(document.querySelector(q))]).filter(([, v]) => v));
    const controls = pick({
      joy: document.body.classList.contains('mv-dpad') ? '.mc-dpad' : '.mc-joy', interact: '.mc-interact', tag: '.mc-interact .tag',
      action: '.mc-action', inv: '.mc-inv', menu: '.mc-menu', dodge: '.cb-dodge'
    });
    const ui = pick({ hotbar: '#hotbar', hud: '#hud-top', minimap: '#jc-minimap', wx: '#wx-badge', net: '#net-panel', objective: '#dr-objective', tip: '#dr-tip' });
    document.querySelectorAll('#toasts .toast').forEach((t, i) => { const b = vis(t); if (b) ui['toast' + i] = b; });
    return { controls, ui, vw: innerWidth, vh: innerHeight };
  });
}

function assertNoOverlap(b, label) {
  const hit = (a, c) => a.x < c.x + c.w - 1 && c.x < a.x + a.w - 1 && a.y < c.y + c.h - 1 && c.y < a.y + a.h - 1;
  const ctrl = Object.entries(b.controls);
  for (const [k, a] of ctrl) {
    assert.ok(a.x >= -1 && a.y >= -1 && a.x + a.w <= b.vw + 1 && a.y + a.h <= b.vh + 1, `${label}: ${k} ekran dışına taşıyor ${JSON.stringify(a)}`);
    for (const [k2, c] of ctrl) {
      if (k >= k2 || (k === 'interact' && k2 === 'tag') || (k === 'tag' && k2 === 'interact')) continue;
      assert.ok(!hit(a, c), `${label}: ${k} ile ${k2} üst üste ${JSON.stringify(a)} ${JSON.stringify(c)}`);
    }
    for (const [k2, c] of Object.entries(b.ui)) assert.ok(!hit(a, c), `${label}: ${k} ile ${k2} üst üste ${JSON.stringify(a)} ${JSON.stringify(c)}`);
  }
}

for (const [name, context] of [['dikey 390x844', MOBILE], ['yatay 844x390', LANDSCAPE]]) {
  test(`dokunmatik ${name}: kontroller görünür, hareket ve etkileşim çalışır`, { timeout: 60000 }, async (t) => {
    const { page, errors, url } = await setup(t, context);
    await newGame(page, url);
    await page.waitForTimeout(2800); // açılış ipucu bildirimi de görünsün (çakışma kontrolü için)
    const T = await touch(page);

    const st = await page.evaluate(() => ({
      touch: document.body.classList.contains('is-touch'),
      joy: getComputedStyle(document.querySelector('.mc-joy')).display !== 'none',
      intOff: document.querySelector('.mc-interact').classList.contains('off'),
      intVisible: getComputedStyle(document.querySelector('.mc-interact')).display !== 'none'
    }));
    assert.equal(st.touch, true, 'dokunmatik düzen açık olmalı');
    assert.ok(st.joy, 'joystick tabanı dokunmadan da görünmeli');
    assert.ok(st.intVisible, 'etkileşim butonu her zaman görünmeli');

    const b0 = await boxes(page);
    for (const k of ['joy', 'interact', 'action', 'inv']) assert.ok(b0.controls[k], `${k} görünmüyor`);
    assert.ok(b0.controls.interact.w >= 64 && b0.controls.action.w >= 64, 'ana butonlar ≥64px');
    assertNoOverlap(b0, name);

    // Joystick: tabandan sağa sürükle → oyuncu sağa yürür
    const jr = await rect(page, '.mc-joy');
    const [jx, jy] = center(jr);
    const x0 = await page.evaluate(() => game.scene.getScene('Game').player.x);
    await T.start(jx, jy);
    await T.move(jx + 20, jy);
    await T.move(jx + 55, jy);
    await page.waitForTimeout(450);
    const mv = await page.evaluate(() => { const s = game.scene.getScene('Game'); return { vx: s.virtualMove.x, x: s.player.x }; });
    await T.end();
    assert.ok(mv.vx > 0.8, `joystick virtualMove.x ${mv.vx}`);
    assert.ok(mv.x - x0 > 8, `oyuncu sağa yürümeli (${x0} → ${mv.x})`);
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => game.scene.getScene('Game').virtualMove.x), 0, 'bırakınca durmalı');

    // D-pad (8 yön): yukarı tuşu basılı → oyuncu yukarı yürür
    await page.evaluate(async () => { const m = await import('/js/ui/mobileSettings.js'); m.settings.moveMode = 'dpad8'; m.saveSettings(); });
    const b1 = await boxes(page);
    assertNoOverlap(b1, name + ' d-pad');
    const up = await rect(page, '.mc-dpad .d-u');
    assert.ok(up.width >= 56 && up.height >= 56, 'D-pad tuşu ≥56px');
    const y0 = await page.evaluate(() => game.scene.getScene('Game').player.y);
    await T.start(...center(up));
    await page.waitForTimeout(400);
    const dp = await page.evaluate(() => { const s = game.scene.getScene('Game'); return { vy: s.virtualMove.y, y: s.player.y }; });
    await T.end();
    assert.ok(dp.vy < -0.9, `D-pad virtualMove.y ${dp.vy}`);
    assert.ok(y0 - dp.y > 6, `oyuncu yukarı yürümeli (${y0} → ${dp.y})`);
    // Sabit joystick + solak düzen: taban yerinde kalır, bölgenin içinden sola sürükleyince sola yürür; düzen aynalanır
    await page.evaluate(async () => { const m = await import('/js/ui/mobileSettings.js'); Object.assign(m.settings, { moveMode: 'joy', joyMode: 'fixed', leftHanded: true }); m.saveSettings(); });
    assertNoOverlap(await boxes(page), name + ' solak');
    const jr2 = await rect(page, '.mc-joy');
    const zr = await rect(page, '.mc-joyzone');
    const [fx, fy] = center(jr2);
    assert.ok(fx > (await page.evaluate(() => innerWidth)) / 2, 'solakta joystick sağda');
    const x1 = await page.evaluate(() => game.scene.getScene('Game').player.x);
    await T.start(Math.max(zr.x + 4, fx - 70), fy); // tabanın dışında ama bölgede: sabit modda taban kıpırdamaz
    await page.waitForTimeout(400);
    const fixed = await page.evaluate(() => { const s = game.scene.getScene('Game'); return { vx: s.virtualMove.x, x: s.player.x }; });
    const jr3 = await rect(page, '.mc-joy');
    await T.end();
    assert.ok(fixed.vx < -0.8, `sabit joystick virtualMove.x ${fixed.vx}`);
    assert.ok(x1 - fixed.x > 6, `oyuncu sola yürümeli (${x1} → ${fixed.x})`);
    assert.ok(Math.abs(jr3.x - jr2.x) < 1 && Math.abs(jr3.y - jr2.y) < 1, 'sabit modda taban yerinde kalmalı');
    await page.evaluate(async () => { const m = await import('/js/ui/mobileSettings.js'); Object.assign(m.settings, { joyMode: 'float', leftHanded: false }); m.saveSettings(); });

    // NPC yanında ✋ aktifleşir, etiket gösterir, dokununca diyalog açılır
    const npc = await page.evaluate(() => {
      const s = game.scene.getScene('Game');
      // Başlangıçta kasabalılar köy dışında "outsider" olarak bekleyebilir (settlement modülü)
      const n = [...(s.npcs || []), ...(s.outsiders || [])].find((q) => !q.hidden && q.active && q.npcName);
      if (!n) return null;
      n.halt?.();
      s.player.setPosition(n.x + 10, n.y + 2);
      window.__npc = n.npcName;
      return n.npcName;
    });
    assert.ok(npc, 'görünür NPC bulunamadı');
    await page.waitForFunction(() => !document.querySelector('.mc-interact').classList.contains('off'), null, { timeout: 3000 });
    const tag = await page.textContent('.mc-interact .tag');
    assert.ok(tag && tag.length > 0, 'etkileşim etiketi boş');
    assertNoOverlap(await boxes(page), name + ' etiketli');
    // NPC yürüyebilir: dokunmadan hemen önce yeniden yanına konumlan
    await page.evaluate(() => {
      const s = game.scene.getScene('Game');
      const n = [...(s.npcs || []), ...(s.outsiders || [])].find((q) => q.npcName === window.__npc) || null;
      if (n) { n.halt?.(); s.player.setPosition(n.x + 10, n.y + 2); }
    });
    await T.tap(...center(await rect(page, '.mc-interact')));
    await page.waitForSelector('#modal-dialog.show', { timeout: 3000 }).catch(async (e) => {
      const d = await page.evaluate(() => { const s = game.scene.getScene('Game'); return JSON.stringify({ modal: s.hud.modal, alive: s.player.alive, cls: document.querySelector('.mc-interact').className, tag: document.querySelector('.mc-interact .tag').textContent, best: s.bestInteraction()?.label }); });
      throw new Error(`${e.message.split('\n')[0]} ${d}`);
    });
    assert.ok(await page.evaluate(() => document.querySelector('#modal-dialog .npc-name')?.textContent.length > 0), 'diyalog NPC adı');
    await page.evaluate(() => game.scene.getScene('Game').hud.closeAll());

    assertNoErrors(assert, errors, name);
  });
}

test('dokunmatik ayarı: Kapalı → masaüstü düzeni, Otomatik → geri açılır', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t, MOBILE);
  await newGame(page, url);
  const set = (v) => page.evaluate(async (mode) => { const m = await import('/js/ui/mobileSettings.js'); m.settings.touchMode = mode; m.saveSettings(); }, v);
  const state = () => page.evaluate(() => ({
    touch: document.body.classList.contains('is-touch'),
    ui: getComputedStyle(document.querySelector('#mobile-ui')).display !== 'none',
    dock: [...document.querySelectorAll('#feature-dock .dock-btn')].some((b) => b.textContent.includes('🎮'))
  }));
  await set('off');
  const off = await state();
  assert.equal(off.touch, false);
  assert.equal(off.ui, false, 'kapalıyken dokunmatik katman gizli');
  assert.ok(off.dock, 'masaüstü dock\'ta dokunmatik ayarı düğmesi olmalı');
  await set('auto');
  const on = await state();
  assert.equal(on.touch, true);
  assert.equal(on.ui, true);
  // Ayar kalıcı (localStorage)
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('zombi-ciftlik-mobil-ayar')).touchMode), 'auto');
  assertNoErrors(assert, errors);
});
