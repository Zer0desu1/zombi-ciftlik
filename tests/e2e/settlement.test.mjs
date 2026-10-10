// Boş köy başlangıcı: hazır tarla/ağıl yok, NPC'ler davetle ya da kurtarılarak köye katılır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, waitForScene, assertNoErrors } from './_harness.mjs';

const CORE = ['farmer', 'merchant', 'blacksmith', 'guard', 'doctor', 'hunter'];

test('boş köy: tarla her yerde, ağıl inşası, davet ve kurtarma', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(500);

  const start = await page.evaluate((core) => {
    const s = game.scene.getScene('Game');
    return {
      villagers: s.npcs.filter((n) => core.includes(n.key)).length,
      outsiders: s.outsiders.length,
      plots: s.farm.plots.size,
      meadow: s.farm.inZone(10, 12),
      road: s.farm.inZone(10, 23),
      farFromVillage: s.farm.inZone(50, 38),
      pen: s.ranch.built,
      animals: s.ranch.animals.length
    };
  }, CORE);
  assert.equal(start.villagers, 0, 'köy boş başlamalı');
  assert.equal(start.outsiders, 6);
  assert.equal(start.plots, 0, 'hazır tarla olmamalı');
  assert.equal(start.meadow, true, 'çayır sürülebilir');
  assert.equal(start.road, false, 'yol sürülemez');
  assert.equal(start.pen, false, 'ağıl hazır gelmemeli');
  assert.equal(start.animals, 0);

  // Ağıl kur + tüccarı davet et
  const built = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    s.giveItem('wood', 30); s.giveItem('stone', 10); s.player.coins = 200;
    s.player.setPosition(26 * 16 + 2, 12 * 16 + 10);
    const act = s.bestInteraction();
    act?.run();
    const m = s.outsiders.find((n) => n.key === 'merchant');
    s.talkTo(m);
    document.querySelector('#modal-dialog .options button.primary')?.click();
    s.hud.closeAll();
    return { label: act?.label, pen: s.ranch.built, merchantIn: s.npcs.includes(m), wood: s.inventory.count('wood') };
  });
  assert.match(built.label || '', /Ağıl kur/);
  assert.equal(built.pen, true);
  assert.equal(built.merchantIn, true, 'Kemal davetle köye katılmalı');
  assert.equal(built.wood, 4, 'ağıl 20 + davet 10 odun harcar');

  // Demirciyi kurtar: yaklaşınca kuşatma başlar, zombiler ölünce köye katılır
  await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const b = s.outsiders.find((n) => n.key === 'blacksmith');
    s.player.setPosition(b.x, b.y + 60);
  });
  await page.waitForFunction(() => game.scene.getScene('Game').outsiders.find((n) => n.key === 'blacksmith')?.siege, null, { timeout: 5000 });
  await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    s.outsiders.find((n) => n.key === 'blacksmith').siege.forEach((z) => z.takeDamage(999));
  });
  await page.waitForFunction(() => game.scene.getScene('Game').npcs.some((n) => n.key === 'blacksmith'), null, { timeout: 5000 });

  // Dikey barikat dizisi dikey doku kullanır
  const tex = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    const a = s.addStructure('barricade', 40 * 16 + 8, 30 * 16 + 8);
    const b = s.addStructure('barricade', 40 * 16 + 8, 31 * 16 + 8);
    const c = s.addStructure('barricade', 44 * 16 + 8, 30 * 16 + 8);
    const d = s.addStructure('barricade', 45 * 16 + 8, 30 * 16 + 8);
    return [a.texture.key, b.texture.key, c.texture.key, d.texture.key];
  });
  assert.deepEqual(tex, ['barricade_v', 'barricade_v', 'barricade', 'barricade']);

  // Kayıt → yenile → devam: katılanlar köyde, diğerleri dışarıda kalır
  await page.evaluate(() => game.scene.getScene('Game').saveGame(true));
  await page.reload();
  await waitForScene(page);
  await page.waitForSelector('#menu.show', { timeout: 15000 });
  await page.click('#btn-continue');
  await page.waitForFunction(() => game.scene.getScene('Game').started === true, null, { timeout: 10000 });
  const after = await page.evaluate(() => {
    const s = game.scene.getScene('Game');
    return { outsiders: s.outsiders.map((n) => n.key).sort(), pen: s.ranch.built, villagers: s.npcs.map((n) => n.key).sort() };
  });
  assert.deepEqual(after.outsiders, ['doctor', 'farmer', 'guard', 'hunter']);
  assert.deepEqual(after.villagers, ['blacksmith', 'merchant']);
  assert.equal(after.pen, true);

  await page.waitForTimeout(300);
  assertNoErrors(assert, errors);
});
