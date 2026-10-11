// Co-op kaynak/kalıcı nesne eşitlemesi (?net=local): "ağaç ve taşlar host'ta kazılmış ama arkadaşımda kazılmamış
// gözüküyordu" hatasının yeniden üretimi ve kendini onaran durum özetinin (NetHost.sendDigest) testi.
// Farklar (rs kaynak listesi, tarla, aynalanan nesne oluşturma) yalnızca değişince bir kez gider; bir anlık görüntü
// misafirde uygulanamazsa (benzetim: conn.dropSnap / ?relDrop) misafir kalıcı olarak geride kalırdı.
//  1) Tüm anlık görüntüler kaybolurken host ağaç keser + kaya kırar, NPC oduncu ağaç keser, tarla sürülür, barikat
//     kurulur → misafir gerçekten geride (hata yeniden üretildi) → özet açılınca birkaç sn içinde her şey eşleşir.
//  2) Misafir sekmesi arka planda + kayıp sürerken yeni kesimler, ardından bağlantı kopup yeniden kurulur → eşleşir.
//  3) Arka planda %50 kayıp + gecikme/titreşim altında birkaç kesim → özetle eşleşir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupMP, waitSynced } from './_mp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = (list) => [...new Set(list)];

// Host oyuncusu sığınağa en yakın (atlananlar hariç) ağacı/kayayı oyuncu eylemiyle (PlayerActions) tüketir
function hostGather(host, kind) {
  return host.evaluate(async (kind) => {
    const s = game.scene.getScene('Game'), d = s.shelter.door, list = s.resources.getChildren();
    let best = -1, bd = Infinity;
    list.forEach((r, i) => {
      if (r.kind !== kind || r.depleted) return;
      const dd = Phaser.Math.Distance.Between(r.x, r.y, d.x, d.y);
      if (dd < bd) { bd = dd; best = i; }
    });
    const r = list[best];
    s.player.setPosition(r.x, r.y + (kind === 'tree' ? 8 : 2) + 8);
    s.player.energy = s.player.maxEnergy;
    r.hits = 1;
    s.selectSlot(s.inventory.slots.findIndex((x) => x?.id === (kind === 'tree' ? 'axe' : 'pickaxe')));
    s.player.actionCd = 0;
    const { useSelected } = await import('/js/systems/PlayerActions.js');
    useSelected(s, r.x, r.y);
    return { i: best, depleted: r.depleted };
  }, kind);
}

// NPC oduncu (Survivor, meslek: lumberjack) bir ağaç keser — iş durum makinesi elle adımlanır (uzun simülasyon yok)
function npcChop(host, name) {
  return host.evaluate(async (name) => {
    const s = game.scene.getScene('Game'), d = s.shelter.door;
    const { Survivor } = await import('/js/entities/NPC.js');
    let a = s.npcs.find((n) => n.npcName === name);
    if (!a) { a = new Survivor(s, d.x, d.y + 60, { name, variant: 0, slot: 3, arrived: s.timeSys.day }); s.npcs.push(a); }
    a.setJob('lumberjack');
    a.carry = {}; // dolu çanta → teslimat durumuna geçmesin
    a.civilianChecks = () => false; // yakındaki zombi / yatma saati işi bölmesin (ağ eşitlemesi test ediliyor)
    const tree = a.findResource('tree');
    a.sm.set('goRes', tree);
    a.setPosition(tree.x + a.side, tree.y + 8);
    a.update(0.016);
    for (let i = 0; i < 12 && !tree.depleted; i++) a.update(1.4);
    return { i: s.resources.getChildren().indexOf(tree), depleted: tree.depleted };
  }, name);
}

const setDrop = (host, p) => host.evaluate((p) => { for (const g of game.scene.getScene('Game').net.guests.values()) g.conn.dropSnap = p; }, p);
const setDigest = (host, sec) => host.evaluate((sec) => { const n = game.scene.getScene('Game').net; n.digestDt = sec; n.digestT = sec > 100 ? sec : Math.min(n.digestT, sec); }, sec);
const resOf = (page) => page.evaluate(() => game.scene.getScene('Game').net.syncSummary().res);

test('co-op kaynaklar: kaybolan farklar özetle onarılır (oyuncu + NPC kesimi, tarla, yapı), arka plan ve yeniden bağlanma', { timeout: 120000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t, { q: '&lag=40&jitter=20&loss=5' });
  await setDigest(host, 999); // önce özetsiz: hatayı yeniden üret

  // ---- 1) Tüm anlık görüntüler kaybolurken host'ta kalıcı değişiklikler ----
  await setDrop(host, 1);
  const t1 = await hostGather(host, 'tree');
  const r1 = await hostGather(host, 'rock');
  const n1 = await npcChop(host, 'Kerem');
  assert.ok(t1.depleted && r1.depleted && n1.depleted, `host'ta tükenmeli: ${JSON.stringify([t1, r1, n1])}`);
  await host.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const { useSelected } = await import('/js/systems/PlayerActions.js');
    s.player.setPosition(264, 232);
    s.selectSlot(s.inventory.slots.findIndex((x) => x?.id === 'hoe'));
    s.player.actionCd = 0; useSelected(s, 264, 248);
    s.selectSlot(s.inventory.slots.findIndex((x) => x?.id === 'seed_carrot'));
    s.player.actionCd = 0; useSelected(s, 264, 248);
    s.inventory.add('barricade', 1);
    s.selectSlot(s.inventory.slots.findIndex((x) => x?.id === 'barricade'));
    s.player.actionCd = 0; useSelected(s, 280, 216);
  });
  await sleep(700);
  await setDrop(host, 0);
  await sleep(900); // sonraki farklar akar; ama kaynak/tarla/barikat oluşturma bir daha gönderilmez
  const [hr, gr] = await Promise.all([resOf(host), resOf(guest)]);
  for (const i of [t1.i, r1.i, n1.i]) assert.ok(hr.split(',').includes(String(i)), `host'ta ${i} tükenmiş`);
  assert.notEqual(gr, hr, 'özet olmadan misafir geride kalmalı (hata yeniden üretimi)');
  const stale = await waitSynced(host, guest, 600, ['min']);
  assert.ok(stale.diff.length > 0, 'özet olmadan farklar kalıcı');
  console.log(`[ölçüm] özetsiz kalıcı fark: ${stale.diff.join(' | ')}`);

  // Özet açılır (testte 1 sn; oyunda 5 sn) → misafir kendini onarır
  await setDigest(host, 1);
  const healed = await waitSynced(host, guest, 8000, ['min']);
  assert.deepEqual(healed.diff, [], 'özetle onarılmalı');
  const h1 = await guest.evaluate(() => ({ ...game.scene.getScene('Game').net.heals }));
  console.log(`[ölçüm] onarım ${healed.ms} ms · ${JSON.stringify(h1)}`);
  assert.ok(h1.res >= 3, `en az 3 kaynak düzeltilmeli: ${h1.res}`);
  assert.ok(h1.m >= 1 && h1.f >= 1, 'nesne ve tarla yeniden eşitlenmeli');
  assert.ok(healed.host.res.split(',').includes(String(n1.i)), 'NPC oduncunun kestiği ağaç misafirde de kesik');

  // Normal akışta yanlış uyuşmazlık yok: birkaç özet boyunca yeni istek gitmez
  const req0 = h1.req;
  await sleep(2600);
  const h1b = await guest.evaluate(() => ({ ...game.scene.getScene('Game').net.heals }));
  assert.ok(h1b.digests >= h1.digests + 2, 'özetler gelmeye devam etmeli');
  assert.equal(h1b.req, req0, `eşitken yeniden eşitleme istenmemeli (son uyuşmazlık: ${await guest.evaluate(() => game.scene.getScene('Game').net.lastMismatch)})`);

  // ---- 2) Misafir arka planda, kayıp sürerken kesimler; sonra bağlantı kopar ve yeniden kurulur ----
  await guest.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await setDigest(host, 999);
  await setDrop(host, 1);
  const t2 = await hostGather(host, 'tree');
  const n2 = await npcChop(host, 'Kerem');
  assert.ok(t2.depleted && n2.depleted);
  await sleep(500);
  await guest.evaluate(() => game.scene.getScene('Game').net.conn.close('dc-closed'));
  await guest.waitForFunction(() => { const n = game.scene.getScene('Game').net; return n.welcomed && n.conn.open && n.reconnects >= 1; }, null, { timeout: 15000 });
  await guest.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const back = await waitSynced(host, guest, 6000, ['min']);
  assert.deepEqual(back.diff, [], 'yeniden bağlanınca eşleşmeli');
  assert.ok(back.guest.res.split(',').includes(String(t2.i)) && back.guest.res.split(',').includes(String(n2.i)));

  // ---- 3) Arka planda %50 kayıp: birkaç kesim + şafakta yeniden büyüme → özetle eşleşir ----
  await setDigest(host, 1);
  await guest.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await setDrop(host, 0.5);
  for (let k = 0; k < 3; k++) { await hostGather(host, k === 1 ? 'rock' : 'tree'); await sleep(200); }
  // Yeniden büyüme (GameScene.onDawn'daki gibi): yarısı geri gelir
  await host.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const { regrowResource } = await import('/js/systems/MapBuilder.js');
    s.resources.getChildren().filter((r) => r.depleted).forEach((r, k) => { if (k % 2 === 0) regrowResource(r); });
  });
  await sleep(400);
  await setDrop(host, 0);
  await guest.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const last = await waitSynced(host, guest, 8000, ['min']);
  assert.deepEqual(last.diff, [], 'kayıp + arka plan sonrası eşleşmeli');

  // Bant genişliği: özet mesajı küçük
  const dgSize = await host.evaluate(() => {
    const n = game.scene.getScene('Game').net, g = [...n.guests.values()][0];
    const base = { t: 'dg', ...n.resBits(), m: n.mirror.digest(), f: n.farmDigest(), s: 123456789, i: 123456789 };
    return { len: JSON.stringify(base).length, rn: n.scene.resources.getChildren().length, g: !!g };
  });
  console.log(`[ölçüm] özet mesajı ${dgSize.len} krk (${dgSize.rn} kaynak)`);
  assert.ok(dgSize.len < 260, `özet küçük olmalı: ${dgSize.len}`);
  assert.deepEqual(errs(hostErr), []);
  assert.deepEqual(errs(guestErr), []);
});
