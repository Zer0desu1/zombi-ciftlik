// Ağ yardımcıları: zaman tamponlu enterpolasyon (Interp), host saati tahmini (NetClock), oda kodu biçimi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interp, NetClock } from '../../js/net/mirror.js';
import { normalizeCode, parseTurn, encodeTurn, decodeTurn } from '../../js/net/transport.js';

test('Interp: iki örnek arasında doğrusal, sonda bekler, sıra dışı örneği atar, büyük sıçramayı enterpole etmez', () => {
  const ip = new Interp();
  ip.push(0, 0, 0);
  ip.push(100, 10, 0);
  assert.deepEqual(ip.sample(50).slice(1), [5, 0]);
  assert.deepEqual(ip.sample(300).slice(1), [10, 0]); // ileri tahmin yok
  assert.deepEqual(ip.sample(-50).slice(1), [0, 0]);
  ip.push(80, 99, 99); // eski paket
  assert.equal(ip.buf.length, 2);
  ip.push(200, 500, 0); // ışınlanma
  assert.deepEqual(ip.sample(150).slice(1), [10, 0]);
  ip.trim(250);
  assert.ok(ip.buf.length <= 2);
});

test('NetClock: en az gecikmeli paketten host saati, titreşimle artan oynatma gecikmesi', () => {
  const c = new NetClock(50);
  const real = performance.now;
  let now = 1000;
  performance.now = () => now;
  try {
    // host saati yerelden 5000 ms ileride; tek yön gecikme 20..80 ms
    for (let i = 0; i < 60; i++) {
      now += 50;
      const lat = 20 + ((i * 37) % 61);
      c.observe(now + 5000 - lat);
    }
    assert.ok(Math.abs(c.off - (5000 - 20)) <= 2, `ofset ${c.off}`);
    assert.ok(c.target >= 50 + 55 && c.target <= 200, `hedef gecikme ${c.target}`);
    for (let i = 0; i < 100; i++) c.renderTime(0.05);
    const rt = c.renderTime(0.05);
    assert.ok(now + 5000 - rt > 100, 'oynatma zamanı host saatinin gerisinde');
  } finally { performance.now = real; }
});

test('NetClock: düşük kare hızlı host (seyrek paket) → gecikme gönderim aralığını karşılar (tampon boşalmaz)', () => {
  const c = new NetClock(50);
  const real = performance.now;
  let now = 1000;
  performance.now = () => now;
  try {
    // host ~9 FPS: 110 ms'de bir paket, titreşim yok
    for (let i = 0; i < 80; i++) { now += 110; c.observe(now + 3000 - 10); }
    assert.ok(c.target >= 110 + 20, `hedef gecikme aralıktan büyük olmalı: ${c.target}`);
    // normal hızda (50 ms) hedef yine küçülür
    for (let i = 0; i < 120; i++) { now += 50; c.observe(now + 3000 - 10); }
    assert.ok(c.target < 110, `aralık düşünce hedef küçülmeli: ${c.target}`);
  } finally { performance.now = real; }
});

test('oda kodu normalleştirme', () => {
  assert.equal(normalizeCode('zc-abcde'), 'ZC-ABCDE');
  assert.equal(normalizeCode('abcde'), 'ZC-ABCDE');
  assert.equal(normalizeCode('ab'), null);
});

test('TURN ayarı: ana makine adı genişletilir, JSON kabul edilir, davet kodlaması geri çözülür', () => {
  const a = parseTurn('standard.relay.metered.ca', 'u1', 'p1');
  assert.deepEqual(a.servers[0].urls, ['turn:standard.relay.metered.ca:80', 'turn:standard.relay.metered.ca:80?transport=tcp', 'turn:standard.relay.metered.ca:443', 'turns:standard.relay.metered.ca:443?transport=tcp']);
  const j = parseTurn('[{"urls":"stun:stun.relay.metered.ca:80"},{"urls":"turn:x.example:80","username":"u","credential":"ç"}]');
  assert.equal(j.servers.length, 1);
  assert.deepEqual(decodeTurn(encodeTurn(j)), j);
  assert.throws(() => parseTurn('turn:x.example:3478', '', ''));
  assert.throws(() => parseTurn('stun:x.example:3478', 'u', 'p'), /turn/);
  assert.equal(parseTurn('', 'u', 'p'), null);
});
