// Veri tablosu tutarlılığı: tüm özellik modülleri yüklendikten sonra (ITEMS/RECIPES/SHOPS/QUESTS'i genişletiyorlar)
// her referansın gerçekten var olduğunu ve her ikonun bir doku olarak üretildiğini doğrular.
import { fakeScene } from './_stub.mjs';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, RECIPES, SHOPS, QUESTS, CROPS, START_INVENTORY, DIFFICULTIES, HOTBAR_SIZE, INV_SIZE } from '../../js/config.js';
import { features } from '../../js/features/index.js';
import { generateTextures } from '../../js/textures.js';

const scene = fakeScene();
before(() => {
  generateTextures(scene);
  features.forEach((f) => f.textures?.(scene));
});

const missing = (ids) => [...new Set(ids)].filter((id) => !ITEMS[id]);

describe('Özellik modülleri', () => {
  test('hepsi kayıtlı, id\'ler benzersiz', () => {
    const ids = features.map((f) => f.id);
    assert.ok(ids.length >= 12, `beklenenden az özellik: ${ids}`);
    assert.equal(new Set(ids).size, ids.length, `yinelenen id: ${ids}`);
  });

  test('sözleşme: kancalar fonksiyon; save varsa load da var', () => {
    for (const f of features) {
      for (const k of ['textures', 'init', 'begin', 'update', 'save', 'load']) {
        if (f[k] !== undefined) assert.equal(typeof f[k], 'function', `${f.id}.${k}`);
      }
      if (f.save) assert.equal(typeof f.load, 'function', `${f.id}: save var ama load yok`);
    }
  });

  test('textures() hata vermeden çalışır', () => {
    for (const f of features) assert.doesNotThrow(() => f.textures?.(fakeScene()), `${f.id}.textures`);
  });
});

describe('ITEMS', () => {
  test('her eşyanın adı, türü ve ikonu var', () => {
    for (const [id, it] of Object.entries(ITEMS)) {
      assert.ok(it.name && typeof it.name === 'string', `${id}: name`);
      assert.ok(it.type && typeof it.type === 'string', `${id}: type`);
      assert.ok(it.icon && typeof it.icon === 'string', `${id}: icon`);
      if (it.onUse !== undefined) assert.equal(typeof it.onUse, 'function', `${id}: onUse`);
      if (it.sell !== undefined) assert.ok(Number.isFinite(it.sell) && it.sell >= 0, `${id}: sell`);
    }
  });

  test('her ikon üretilmiş bir doku', () => {
    const bad = Object.entries(ITEMS).filter(([, it]) => !scene.textureKeys.has(it.icon)).map(([id, it]) => `${id} → ${it.icon}`);
    assert.deepEqual(bad, []);
  });

  test('tohumlar geçerli bir ekine, ekinler geçerli bir eşyaya bağlı', () => {
    for (const [id, it] of Object.entries(ITEMS)) if (it.type === 'seed') assert.ok(CROPS[it.crop], `${id}: crop ${it.crop}`);
    assert.deepEqual(missing(Object.values(CROPS).map((c) => c.item)), []);
    for (const [k, c] of Object.entries(CROPS)) {
      assert.ok(c.hoursPerStage > 0, `${k}: hoursPerStage`);
      assert.ok(Array.isArray(c.yield) && c.yield[0] <= c.yield[1], `${k}: yield`);
    }
  });

  test('kalite varyantları temel eşyaya işaret eder', () => {
    for (const [id, it] of Object.entries(ITEMS)) if (it.baseItem) assert.ok(ITEMS[it.baseItem], `${id}: baseItem ${it.baseItem}`);
  });
});

describe('RECIPES', () => {
  test('çıktı ve maliyet eşyaları var, miktarlar pozitif', () => {
    for (const r of RECIPES) {
      const tag = `${r.out} ← ${JSON.stringify(r.cost)}`;
      assert.ok(ITEMS[r.out], `bilinmeyen çıktı: ${tag}`);
      assert.ok(Number.isInteger(r.qty) && r.qty > 0, `qty: ${tag}`);
      assert.ok(Object.keys(r.cost).length > 0, `boş maliyet: ${tag}`);
      for (const [id, n] of Object.entries(r.cost)) {
        assert.ok(ITEMS[id], `bilinmeyen malzeme ${id}: ${tag}`);
        assert.ok(Number.isInteger(n) && n > 0, `miktar ${id}: ${tag}`);
      }
    }
  });

  test('aynı tarif iki kez eklenmemiş (modül yeniden yüklenmesi belirtisi)', () => {
    const keys = RECIPES.map((r) => `${r.out}|${r.qty}|${JSON.stringify(r.cost)}`);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(dup, []);
  });
});

describe('SHOPS', () => {
  test('her teklif geçerli eşya, pozitif miktar ve fiyat', () => {
    for (const [shop, list] of Object.entries(SHOPS)) {
      assert.ok(Array.isArray(list), shop);
      for (const o of list) {
        assert.ok(ITEMS[o.id], `${shop}: bilinmeyen eşya ${o.id}`);
        assert.ok(Number.isInteger(o.qty) && o.qty > 0, `${shop}/${o.id}: qty`);
        assert.ok(Number.isFinite(o.price) && o.price > 0, `${shop}/${o.id}: price`);
      }
    }
  });

  test('satın alıp geri satarak para basılamaz', () => {
    const exploits = [];
    for (const [shop, list] of Object.entries(SHOPS)) {
      for (const o of list) {
        const sell = ITEMS[o.id]?.sell;
        if (sell && sell * o.qty > o.price) exploits.push(`${shop}/${o.id}: ${o.qty}x${sell} > ${o.price}`);
      }
    }
    assert.deepEqual(exploits, []);
  });
});

describe('QUESTS', () => {
  test('id benzersiz, alanlar geçerli', () => {
    const ids = QUESTS.map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length, 'yinelenen görev id');
    for (const q of QUESTS) {
      assert.ok(q.title && q.npc, q.id);
      assert.ok(Number.isFinite(q.amount) && q.amount > 0, `${q.id}: amount`);
      if (q.type === 'deliver') assert.ok(ITEMS[q.item], `${q.id}: teslim eşyası ${q.item}`);
      assert.deepEqual(missing(Object.keys(q.reward?.items || {})), [], `${q.id}: ödül eşyası`);
    }
  });

  test('görevi veren NPC\'nin dokusu var', () => {
    const bad = QUESTS.filter((q) => !scene.textureKeys.has(`npc_${q.npc}`)).map((q) => `${q.id} → ${q.npc}`);
    assert.deepEqual(bad, []);
  });
});

describe('Başlangıç ve sabitler', () => {
  test('başlangıç envanteri geçerli ve sığıyor', () => {
    assert.deepEqual(missing(START_INVENTORY.map(([id]) => id)), []);
    assert.ok(START_INVENTORY.length <= INV_SIZE);
    assert.ok(HOTBAR_SIZE <= INV_SIZE);
  });

  test('zorluk tanımları tutarlı', () => {
    for (const [k, d] of Object.entries(DIFFICULTIES)) {
      assert.equal(d.id, k);
      for (const f of ['count', 'hp', 'dmg', 'reward']) assert.ok(d[f] > 0, `${k}.${f}`);
    }
    assert.ok(DIFFICULTIES.normal);
  });
});
