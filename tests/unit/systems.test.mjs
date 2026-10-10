// Saf mantık sistemleri: Inventory, StateMachine, Records, SaveSystem, TimeSystem
import './_stub.mjs';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory } from '../../js/systems/Inventory.js';
import { StateMachine } from '../../js/systems/StateMachine.js';
import * as Records from '../../js/systems/Records.js';
const { loadRecords, recordRun, scoreOf } = Records;
import { SaveSystem } from '../../js/systems/SaveSystem.js';
import { TimeSystem, SEASON_DAYS } from '../../js/systems/TimeSystem.js';
import { INV_SIZE, HOTBAR_SIZE, DAY_START, NIGHT_START, SAVE_KEY } from '../../js/config.js';

describe('Inventory', () => {
  test('varsayılan boyut ve boş slotlar', () => {
    const inv = new Inventory();
    assert.equal(inv.slots.length, INV_SIZE);
    assert.ok(inv.slots.every((s) => s === null));
  });

  test('yığınlanabilir eşya tek slotta birikir, 99\'da taşar', () => {
    const inv = new Inventory();
    assert.equal(inv.add('wood', 150), 0);
    assert.equal(inv.count('wood'), 150);
    assert.deepEqual(inv.slots.slice(0, 2).map((s) => s.count), [99, 51]);
  });

  test('alet/silah yığınlanmaz', () => {
    const inv = new Inventory();
    inv.add('sword', 3);
    assert.equal(inv.slots.filter((s) => s?.id === 'sword').length, 3);
    assert.ok(inv.slots.every((s) => !s || s.count === 1));
  });

  test('bilinmeyen eşya eklenmez, tamamı geri döner', () => {
    const inv = new Inventory();
    assert.equal(inv.add('yok_boyle_bir_sey', 4), 4);
    assert.equal(inv.count('yok_boyle_bir_sey'), 0);
  });

  test('dolu envanter artan miktarı döndürür', () => {
    const inv = new Inventory(2);
    assert.equal(inv.add('sword', 3), 1);
    assert.equal(inv.add('wood', 5), 5);
  });

  test('remove yetersizse hiçbir şey silmez', () => {
    const inv = new Inventory();
    inv.add('stone', 3);
    assert.equal(inv.remove('stone', 5), false);
    assert.equal(inv.count('stone'), 3);
    assert.equal(inv.remove('stone', 3), true);
    assert.ok(inv.slots.every((s) => s === null));
  });

  test('has / craft maliyeti düşer ve ürünü ekler', () => {
    const inv = new Inventory();
    inv.add('wood', 4);
    const r = { out: 'barricade', qty: 1, cost: { wood: 4 } };
    assert.equal(inv.has(r.cost), true);
    assert.equal(inv.craft(r), true);
    assert.equal(inv.count('wood'), 0);
    assert.equal(inv.count('barricade'), 1);
    assert.equal(inv.craft(r), false);
  });

  test('removeAt / swap', () => {
    const inv = new Inventory();
    inv.add('wood', 2); inv.add('sword', 1);
    inv.swap(0, 1);
    assert.equal(inv.slots[0].id, 'sword');
    inv.removeAt(1, 2);
    assert.equal(inv.slots[1], null);
    inv.removeAt(5); // boş slot: hata vermemeli
  });

  test('resize yalnızca büyütür', () => {
    const inv = new Inventory();
    inv.add('wood', 1);
    assert.equal(inv.resize(INV_SIZE - 1), false);
    assert.equal(inv.resize(INV_SIZE + 8), true);
    assert.equal(inv.slots.length, INV_SIZE + 8);
    assert.equal(inv.count('wood'), 1);
  });

  test('sort hotbar\'a dokunmaz, yığınları birleştirir, türe göre dizer', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: 'wood', count: 1 };
    inv.slots[HOTBAR_SIZE + 3] = { id: 'wood', count: 10 };
    inv.slots[HOTBAR_SIZE + 5] = { id: 'wood', count: 20 };
    inv.slots[HOTBAR_SIZE + 7] = { id: 'hoe', count: 1 };
    inv.sort();
    assert.deepEqual(inv.slots[0], { id: 'wood', count: 1 });
    assert.equal(inv.slots[HOTBAR_SIZE].id, 'hoe');
    assert.deepEqual(inv.slots[HOTBAR_SIZE + 1], { id: 'wood', count: 30 });
    assert.equal(inv.slots[HOTBAR_SIZE + 2], null);
  });

  test('serialize/load gidiş-dönüş; bilinmeyen eşyalar atılır, büyük kayıt çantayı büyütür', () => {
    const inv = new Inventory();
    inv.add('wood', 7); inv.add('hoe', 1);
    const data = inv.serialize();
    data[3] = { id: 'silinmis_esya', count: 2 };
    data.push(...new Array(4).fill(null));
    data[data.length - 1] = { id: 'stone', count: 9 };
    const inv2 = new Inventory();
    inv2.load(data);
    assert.equal(inv2.slots.length, INV_SIZE + 4);
    assert.equal(inv2.count('wood'), 7);
    assert.equal(inv2.count('hoe'), 1);
    assert.equal(inv2.count('stone'), 9);
    assert.equal(inv2.slots[3], null);
    inv2.load(null); // bozuk kayıt
    assert.ok(inv2.slots.every((s) => s === null));
  });

  test('serialize derin kopya verir', () => {
    const inv = new Inventory();
    inv.add('wood', 2);
    const data = inv.serialize();
    data[0].count = 50;
    assert.equal(inv.count('wood'), 2);
  });

  test('onChange dinleyicileri tetiklenir', () => {
    const inv = new Inventory();
    let n = 0;
    inv.onChange(() => n++);
    inv.add('wood', 1); inv.remove('wood', 1);
    assert.equal(n, 2);
  });
});

describe('StateMachine', () => {
  test('enter/exit sırası, veri ve timeInState', () => {
    const log = [];
    const owner = {};
    const sm = new StateMachine(owner, {
      idle: { enter: (o, d) => log.push(['enter-idle', o === owner, d]), exit: () => log.push(['exit-idle']), update: (o, dt) => log.push(['upd', dt]) },
      walk: { enter: (_o, d) => log.push(['enter-walk', d]) }
    }, 'idle');
    assert.equal(sm.name, 'idle');
    sm.update(0.5); sm.update(0.25);
    assert.equal(sm.timeInState, 0.75);
    sm.set('walk', 42);
    assert.equal(sm.timeInState, 0);
    assert.deepEqual(log, [['enter-idle', true, undefined], ['upd', 0.5], ['upd', 0.25], ['exit-idle'], ['enter-walk', 42]]);
  });

  test('aynı duruma geçiş yok sayılır, bilinmeyen durum hata atar', () => {
    let enters = 0;
    const sm = new StateMachine({}, { a: { enter: () => enters++ } }, 'a');
    sm.set('a');
    assert.equal(enters, 1);
    assert.throws(() => sm.set('b'), /Bilinmeyen durum/);
    assert.equal(sm.name, 'a');
  });

  test('başlangıç durumu olmadan update güvenli', () => {
    const sm = new StateMachine({}, { a: {} });
    assert.equal(sm.name, null);
    sm.update(1);
  });
});

describe('Records', () => {
  beforeEach(() => localStorage.clear());

  test('boş depoda varsayılanlar', () => {
    const r = loadRecords();
    for (const k of ['bestDay', 'bestWave', 'bestScore', 'wins', 'runs']) assert.equal(r[k], 0, k);
  });

  test('bozuk JSON varsayılana düşer', () => {
    localStorage.setItem('zombi-ciftlik-records-v1', '{bozuk');
    assert.equal(loadRecords().runs, 0);
  });

  test('scoreOf: zorluk çarpanı ve zafer bonusu', () => {
    const base = { wave: 3, day: 4, kills: 10, coins: 100 };
    const normal = scoreOf(base);
    assert.equal(normal, 3 * 120 + 4 * 40 + 10 * 5 + 20);
    assert.equal(scoreOf({ ...base, difficulty: 'hard' }), Math.round(normal * 1.5));
    assert.equal(scoreOf({ ...base, difficulty: 'easy' }), Math.round(normal * 0.7));
    assert.equal(scoreOf({ ...base, difficulty: 'bilinmeyen' }), normal);
    assert.equal(scoreOf({ ...base, victory: true }), normal + 2500);
    assert.equal(scoreOf({}), 0);
  });

  test('recordRun en iyileri günceller, düşük skor rekoru bozmaz', () => {
    const a = recordRun({ wave: 5, day: 6, kills: 30, victory: true });
    assert.equal(a.newBest, true);
    assert.equal(a.records.runs, 1);
    assert.equal(a.records.wins, 1);
    const b = recordRun({ wave: 1, day: 9 });
    assert.equal(b.newBest, false);
    assert.equal(b.records.runs, 2);
    assert.equal(b.records.bestWave, 5);
    assert.equal(b.records.bestDay, 9);
    assert.equal(b.records.bestScore, a.score);
    assert.deepEqual(loadRecords(), b.records);
  });
});

test('sonsuz mod gece rekoru yalnızca artar', { skip: !Records.recordEndlessNight && 'recordEndlessNight yok' }, () => {
  localStorage.clear();
  assert.equal(Records.recordEndlessNight(4), true);
  assert.equal(Records.recordEndlessNight(3), false);
  assert.equal(loadRecords().bestEndless, 4);
});

describe('SaveSystem', () => {
  beforeEach(() => localStorage.clear());

  test('kaydet/yükle/sil', () => {
    assert.equal(SaveSystem.exists(), false);
    assert.equal(SaveSystem.load(), null);
    assert.equal(SaveSystem.save({ kills: 3 }), true);
    assert.equal(SaveSystem.exists(), true);
    const d = SaveSystem.load();
    assert.equal(d.kills, 3);
    assert.equal(d.v, 1);
    assert.ok(Number.isFinite(d.savedAt));
    SaveSystem.clear();
    assert.equal(SaveSystem.exists(), false);
  });

  test('bozuk kayıt null döner (hata atmaz)', () => {
    localStorage.setItem(SAVE_KEY, 'not json');
    const warn = console.warn; console.warn = () => {};
    try { assert.equal(SaveSystem.load(), null); } finally { console.warn = warn; }
  });
});

describe('TimeSystem', () => {
  test('saat biçimi ve gece tespiti', () => {
    const t = new TimeSystem();
    assert.equal(t.clock, '07:00');
    assert.equal(t.isNight, false);
    t.minutes = NIGHT_START; assert.equal(t.isNight, true);
    t.minutes = DAY_START - 1; assert.equal(t.isNight, true);
    t.minutes = DAY_START; assert.equal(t.isNight, false);
  });

  test('akşam → dusk, şafak → dawn ve gün artışı', () => {
    const t = new TimeSystem();
    const ev = [];
    t.on('dusk', (d) => ev.push(['dusk', d]));
    t.on('dawn', (d) => ev.push(['dawn', d]));
    t.minutes = NIGHT_START - 1;
    t.update(1);
    assert.equal(t.isNight, true);
    t.minutes = DAY_START - 0.01;
    t.update(1);
    assert.deepEqual(ev, [['dusk', 1], ['dawn', 2]]);
    assert.equal(t.day, 2);
  });

  test('gece yarısı sarması', () => {
    const t = new TimeSystem();
    t.minutes = 1439.9; t.wasNight = true;
    t.update(1);
    assert.ok(t.minutes >= 0 && t.minutes < 60);
    assert.equal(t.day, 1);
  });

  test('her saat başı hour olayı', () => {
    const t = new TimeSystem();
    const hours = [];
    t.on('hour', (h) => hours.push(h));
    t.minutes = 8 * 60 - 0.5;
    t.update(0.5);
    assert.deepEqual(hours, [8]);
  });

  test('mevsim döngüsü ve seasonChanged', () => {
    const t = new TimeSystem();
    assert.equal(t.season, 'spring');
    t.day = SEASON_DAYS + 1;
    assert.equal(t.season, 'summer');
    assert.equal(t.seasonDay, 1);
    t.day = SEASON_DAYS * 4 + 1;
    assert.equal(t.season, 'spring');
    assert.equal(t.year, 2);
    const t2 = new TimeSystem();
    const changed = [];
    t2.on('seasonChanged', (s) => changed.push(s));
    t2.day = SEASON_DAYS; t2.minutes = DAY_START - 0.01; t2.wasNight = true;
    t2.update(1);
    assert.deepEqual(changed, ['summer']);
  });

  test('karanlık 0..0.8 aralığında, gece en karanlık', () => {
    const t = new TimeSystem();
    t.minutes = 12 * 60; assert.equal(t.darkness, 0);
    t.minutes = 23 * 60; assert.equal(t.darkness, 0.8);
    t.minutes = 19.5 * 60; assert.ok(t.darkness > 0 && t.darkness < 0.8);
    t.minutes = 12 * 60; t.weatherDim = 0.4; assert.equal(t.darkness, 0.4);
  });

  test('gece daha hızlı akar; speedMul çarpar', () => {
    const t = new TimeSystem();
    const day = t.speed;
    t.minutes = 22 * 60;
    const night = t.speed;
    assert.ok(night > day);
    t.speedMul = 3;
    assert.ok(Math.abs(t.speed - 3 * night) < 1e-9);
  });

  test('serialize/load; bozuk değerler yok sayılır', () => {
    const t = new TimeSystem();
    t.minutes = 21 * 60; t.day = 5;
    const t2 = new TimeSystem();
    t2.load(t.serialize());
    assert.equal(t2.day, 5);
    assert.equal(t2.isNight, true);
    assert.equal(t2.wasNight, true);
    t2.load({ minutes: NaN, day: -3 });
    assert.equal(t2.minutes, 21 * 60);
    assert.equal(t2.day, 1);
    t2.load(null);
  });
});

describe('WaveManager.makePlan', async () => {
  const { WaveManager } = await import('../../js/systems/WaveManager.js');
  const wm = (difficulty) => new WaveManager({ difficulty, zombies: { countActive: () => 0 } });
  const total = (p) => Object.values(p.counts).reduce((a, b) => a + b, 0);

  test('sayılar negatif değil, sürü dalgayla büyür', () => {
    const m = wm();
    let prev = 0;
    for (let w = 1; w <= 12; w++) {
      const p = m.makePlan(w);
      assert.ok(Object.values(p.counts).every((n) => Number.isInteger(n) && n >= 0), `dalga ${w}: ${JSON.stringify(p.counts)}`);
      const t = total(p) - (p.counts.boss || 0);
      assert.ok(t >= 4 && t >= prev, `dalga ${w}: ${t} < ${prev}`);
      prev = t;
    }
  });

  test('her 5. dalgada boss; kenar sayısı 1..4 ve benzersiz', () => {
    const m = wm();
    for (let w = 1; w <= 15; w++) {
      const p = m.makePlan(w);
      assert.equal(!!p.counts.boss, w % 5 === 0, `dalga ${w}`);
      assert.ok(p.sides.length >= 1 && p.sides.length <= 4);
      assert.equal(new Set(p.sides).size, p.sides.length);
      assert.ok(p.sides.every((s) => s >= 0 && s <= 3));
    }
  });

  test('kan ayı ve zorluk sürüyü büyütür', () => {
    const m = wm();
    const base = total(m.makePlan(4)) - 0;
    assert.ok(total(m.makePlan(4, true)) > base);
    assert.ok(total(wm({ count: 1.35 }).makePlan(4)) > total(wm({ count: 0.7 }).makePlan(4)));
  });
});
