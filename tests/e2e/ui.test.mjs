// Envanter/üretim paneli ve özellik menüsündeki her panel açılır, oyunu duraklatır, kapanır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, assertNoErrors, DESKTOP, MOBILE } from './_harness.mjs';

for (const [name, context] of [['masaüstü', DESKTOP], ['mobil', MOBILE]]) {
  test(`${name}: envanter ve üretim paneli`, { timeout: 60000 }, async (t) => {
    const { page, errors, url } = await setup(t, context);
    await newGame(page, url);
    await page.evaluate(() => { const s = game.scene.getScene('Game'); s.giveItem('wood', 8); s.hud.toggleInventory(); });
    await page.waitForSelector('#modal-inventory.show', { timeout: 5000 });
    const inv = await page.evaluate(() => ({
      slots: document.querySelectorAll('#inv-grid > *').length,
      recipes: document.querySelectorAll('#craft-list > *').length,
      modal: game.scene.getScene('Game').hud.isModalOpen()
    }));
    assert.ok(inv.slots >= 24, `slot sayısı ${inv.slots}`);
    assert.ok(inv.recipes > 0, 'tarif listesi boş');
    assert.equal(inv.modal, true);

    // Zaman modal açıkken durmalı
    const m0 = await page.evaluate(() => game.scene.getScene('Game').timeSys.minutes);
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => game.scene.getScene('Game').timeSys.minutes), m0, 'modal açıkken zaman akmamalı');

    // Barikat üret (4 odun) — UI düğmesi yerine envanter API'si; düğme düzeni modüllere göre değişebiliyor
    const crafted = await page.evaluate(async () => {
      const s = game.scene.getScene('Game');
      const { RECIPES } = await import('/js/config.js');
      const r = RECIPES.find((x) => x.out === 'barricade' && x.cost.wood && Object.keys(x.cost).length === 1);
      const before = s.inventory.count('barricade');
      s.inventory.craft(r);
      s.hud.refreshInventory();
      return s.inventory.count('barricade') - before;
    });
    assert.equal(crafted, 1);

    await page.evaluate(() => game.scene.getScene('Game').hud.closeAll());
    assert.equal(await page.isVisible('#modal-inventory.show'), false);
    assertNoErrors(assert, errors, name);
  });
}

test('her özellik paneli açılıp kapanır', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  const res = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const out = [];
    for (const m of s.featureMenu) {
      try {
        m.open(s);
        await new Promise((r) => setTimeout(r, 120));
        out.push({ id: m.id, ok: true });
      } catch (e) { out.push({ id: m.id, ok: false, err: e.message }); }
      s.hud.closeAll();
    }
    return { out, modal: s.hud.isModalOpen() };
  });
  assert.deepEqual(res.out.filter((r) => !r.ok), []);
  assert.equal(res.modal, false);
  await page.waitForTimeout(300);
  assertNoErrors(assert, errors);
});
