// Co-op eşya/para paylaşımı: envanterdeki "🎁 Ver" satırıyla host→misafir ve misafir→host (misafir tıklaması
// host'a 'ui' click olarak gider, host doğrular ve iki envanteri de mevcut senkron yoluyla günceller).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoErrors } from './_harness.mjs';
import { setupMP } from './_mp.mjs';

const ITEM = 'rare_core';
const giveRow = '#modal-inventory .inv-give .give-row';

test('co-op: takım arkadaşına eşya ve para verme (host→misafir, misafir→host)', { timeout: 90000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t);

  // Host → misafir: host kendi panelinde eşyayı seçer, "Hepsi" ile Veli'ye verir
  const hi = await host.evaluate((id) => {
    const s = game.scene.getScene('Game');
    s.inventory.add(id, 5);
    s.hud.toggleInventory();
    return s.inventory.slots.findIndex((x) => x?.id === id);
  }, ITEM);
  assert.ok(hi >= 0);
  await host.click(`#modal-inventory #inv-grid .slot:nth-child(${hi + 1})`);
  await host.waitForSelector(`${giveRow} >> text=Veli`, { timeout: 4000 });
  await host.locator(giveRow, { hasText: 'Veli' }).locator('button', { hasText: 'Hepsi' }).click();
  await guest.waitForFunction((id) => game.scene.getScene('Game').inventory.count(id) === 5, ITEM, { timeout: 5000 });
  assert.equal(await host.evaluate((id) => game.scene.getScene('Game').inventory.count(id), ITEM), 0);
  await guest.waitForFunction(() => document.getElementById('toasts')?.textContent.includes('Ali sana 5'), null, { timeout: 4000 });
  await host.evaluate(() => game.scene.getScene('Game').hud.closeAll());

  // Misafir → host: misafirin paneli host'tan gelir; slot seçimi ve "🎁 1" tıklaması host'ta doğrulanır
  const coins0 = await host.evaluate(() => game.scene.getScene('Game').player.coins);
  await guest.evaluate(() => game.scene.getScene('Game').hud.toggleInventory());
  await guest.waitForSelector('#modal-inventory.show #inv-grid .slot img', { timeout: 5000 });
  const gi = await guest.evaluate((id) => game.scene.getScene('Game').inventory.slots.findIndex((x) => x?.id === id), ITEM);
  assert.ok(gi >= 0);
  await guest.click(`#modal-inventory #inv-grid .slot:nth-child(${gi + 1})`);
  await guest.waitForSelector(`${giveRow} >> text=🎁 1`, { timeout: 5000 });
  await guest.locator(giveRow, { hasText: 'Ali' }).locator('button', { hasText: '🎁 1' }).click();
  await host.waitForFunction((id) => game.scene.getScene('Game').inventory.count(id) === 1, ITEM, { timeout: 5000 });
  await guest.waitForFunction((id) => game.scene.getScene('Game').inventory.count(id) === 4, ITEM, { timeout: 5000 });
  await host.waitForFunction(() => document.getElementById('toasts')?.textContent.includes('Veli sana 1'), null, { timeout: 4000 });

  // Para: misafir host'a 10 🪙 verir
  const gc0 = await guest.evaluate(() => game.scene.getScene('Game').player.coins);
  await guest.locator(giveRow, { hasText: 'Ali' }).locator('button', { hasText: '🪙 10' }).click();
  await host.waitForFunction((c) => game.scene.getScene('Game').player.coins === c + 10, coins0, { timeout: 5000 });
  await guest.waitForFunction((c) => game.scene.getScene('Game').player.coins === c - 10, gc0, { timeout: 5000 });

  // Doğrulama: olmayan oyuncuya / boş slottan verme reddedilir (host otoritesi)
  const bad = await host.evaluate(() => {
    const n = game.scene.getScene('Game').net;
    return [n.giveItem('g999', 0, 1), n.giveCoins('h', 5)]; // host kendine veremez
  });
  assert.deepEqual(bad, [0, 0]);
  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});
