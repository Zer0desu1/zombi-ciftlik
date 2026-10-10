// Menü → yeni oyun: masaüstü ve mobil dikey; sayfa hatası yok, özellik modülleri sağlıklı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, assertNoErrors, DESKTOP, MOBILE } from './_harness.mjs';

for (const [name, context] of [['masaüstü 1366x768', DESKTOP], ['mobil dikey 390x844', MOBILE]]) {
  test(`${name}: menü → yeni oyun yüklenir`, { timeout: 60000 }, async (t) => {
    const { page, errors, url } = await setup(t, context);
    await newGame(page, url);
    await page.waitForTimeout(1500);

    const st = await page.evaluate(() => {
      const s = game.scene.getScene('Game');
      return {
        started: s.started, day: s.timeSys.day, night: s.timeSys.isNight, hp: s.player.hp,
        invCount: s.inventory.slots.filter(Boolean).length, menuHidden: !document.querySelector('#menu').classList.contains('show'),
        hotbar: document.querySelectorAll('#hotbar > *').length, canvas: !!document.querySelector('#game canvas'),
        scrollW: document.documentElement.scrollWidth, innerW: innerWidth, touch: document.body.classList.contains('is-touch')
      };
    });
    assert.equal(st.started, true);
    assert.equal(st.day, 1);
    assert.equal(st.night, false);
    assert.ok(st.hp > 0);
    assert.ok(st.invCount >= 5, 'başlangıç envanteri');
    assert.ok(st.menuHidden, 'menü kapanmalı');
    assert.ok(st.canvas, 'oyun canvas\'ı');
    assert.ok(st.hotbar > 0, 'hotbar çizilmeli');
    assert.ok(st.scrollW <= st.innerW + 1, `yatay taşma: ${st.scrollW} > ${st.innerW}`);
    if (context === MOBILE) assert.equal(st.touch, true, 'dokunmatik düzen');
    assertNoErrors(assert, errors, name);
  });
}

test('özellik modülleri: init sonrası update/save hata vermez, ikon dokuları mevcut', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  const r = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    // Aynı modül örneği (tarayıcı modül önbelleği) — sahnenin kullandığı liste
    const { features } = await import('/js/features/index.js');
    const { ITEMS } = await import('/js/config.js');
    const out = { ids: features.map((f) => f.id), failures: [], missingIcons: [] };
    for (const f of features) {
      try {
        for (let i = 0; i < 5; i++) f.update?.(s, 1 / 60);
        if (f.save) {
          const data = f.save(s);
          JSON.parse(JSON.stringify(data ?? null));
          f.load?.(s, JSON.parse(JSON.stringify(data ?? null)) ?? undefined);
        }
      } catch (e) { out.failures.push(`${f.id}: ${e.message}`); }
    }
    for (const [id, it] of Object.entries(ITEMS)) if (!s.textures.exists(it.icon)) out.missingIcons.push(`${id} → ${it.icon}`);
    out.menu = s.featureMenu.map((m) => m.id);
    return out;
  });
  assert.ok(r.ids.length >= 12, `özellikler: ${r.ids}`);
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.missingIcons, []);
  assert.ok(r.menu.length > 0, 'featureMenu boş');
  await page.waitForTimeout(500);
  assertNoErrors(assert, errors);
});
