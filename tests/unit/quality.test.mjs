// Inventory: kalite varyantlarının sayımı ve tüketim sırası. Çalıştır: node tests/inventory.test.mjs
import assert from 'node:assert/strict';
import { ITEMS } from '../../js/config.js';
import { Inventory } from '../../js/systems/Inventory.js';

// farming.js'in ürettiği kalite varyantlarının asgari taklidi (o modül tarayıcı ister)
Object.assign(ITEMS, {
  wheat_s: { ...ITEMS.wheat, quality: 1, baseItem: 'wheat', sell: 10 },
  wheat_g: { ...ITEMS.wheat, quality: 2, baseItem: 'wheat', sell: 12 }
});

const fresh = (...pairs) => { const inv = new Inventory(10); pairs.forEach(([id, n]) => inv.add(id, n)); return inv; };
let ok = 0;
const test = (name, fn) => { fn(); ok++; console.log('✓', name); };

test('temel ürün sayımı kaliteli varyantları içerir', () => {
  const inv = fresh(['wheat_g', 2], ['wheat', 1], ['wheat_s', 3]);
  assert.equal(inv.count('wheat'), 6);
  assert.equal(inv.countExact('wheat'), 1);
  assert.equal(inv.count('wheat_s'), 3);
  assert.ok(inv.has({ wheat: 6 }));
  assert.ok(!inv.has({ wheat: 7 }));
});

test('tüketim: önce normal, sonra gümüş, en son altın', () => {
  const inv = fresh(['wheat_g', 2], ['wheat', 1], ['wheat_s', 3]);
  assert.ok(inv.remove('wheat', 3));
  assert.equal(inv.countExact('wheat'), 0);
  assert.equal(inv.countExact('wheat_s'), 1);
  assert.equal(inv.countExact('wheat_g'), 2);
  assert.ok(inv.remove('wheat', 2));
  assert.equal(inv.countExact('wheat_s'), 0);
  assert.equal(inv.countExact('wheat_g'), 1);
});

test('yetersizse hiçbir şey harcanmaz', () => {
  const inv = fresh(['wheat', 1], ['wheat_g', 1]);
  assert.equal(inv.remove('wheat', 3), false);
  assert.equal(inv.count('wheat'), 2);
});

test('varyant kimliğiyle silme yalnızca o varyantı alır', () => {
  const inv = fresh(['wheat', 5], ['wheat_g', 1]);
  assert.equal(inv.remove('wheat_s', 1), false);
  assert.ok(inv.remove('wheat_g', 1));
  assert.equal(inv.countExact('wheat'), 5);
});

test('tarif yalnızca kaliteli ürünle de üretilir', () => {
  const inv = fresh(['wheat_s', 2], ['wheat_g', 1]);
  assert.ok(inv.craft({ out: 'bread', qty: 1, cost: { wheat: 3 } }));
  assert.equal(inv.count('wheat'), 0);
  assert.equal(inv.count('bread'), 1);
});

console.log(`${ok} test geçti`);
