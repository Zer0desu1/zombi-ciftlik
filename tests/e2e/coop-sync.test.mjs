// Co-op senkron ölçümleri (iki sayfa: host + misafir, yerel taşıyıcı).
//  1) Bir dizi eylemden sonra iki taraftaki dünya özeti (görünür vekil doku histogramı, tarla, kaynaklar, gün/saat,
//     dalga, sığınak) aynı; aynı ağ id'li nesnelerde enterpolasyon konum hatası; bant genişliği.
//  2) Yapay gecikme + titreşim + paket kaybı altında (lag=120, jitter=40, loss=5): eşleşme + misafir hareketi
//     düzeltmesiz (host konum düzeltmesi yok) ve vekil hareketi akıcı.
// Ölçümler konsola yazılır (rapor için): node --test tests/e2e/coop-sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoErrors } from './_harness.mjs';
import { setupMP, teleportGuest, guestUse, waitSynced } from './_mp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostG = (host, fn, arg) => host.evaluate(fn, arg);

// Hareket eden birkaç zombi (gündüz: sığınağa/oyunculara yürür; hasar 0 ki test sırasında kimse ölmesin)
async function spawnWalkers(host, n = 5) {
  return host.evaluate((n) => {
    const s = game.scene.getScene('Game'), d = s.shelter.door;
    const ids = [];
    for (let i = 0; i < n; i++) {
      const z = s.spawnZombie(d.x - 160 + i * 18, d.y + 120 + (i % 2) * 20, 'normal');
      z.damage = 0; z.maxHp = z.hp = 999;
      ids.push(z);
    }
    s.__walkers = ids;
    return n;
  }, n);
}

// Enterpolasyon hatası: misafirdeki vekil konumu (oynatma zamanı rt) ↔ host'un rt anındaki gerçek konumu
async function measurePositions(host, guest, ms = 2500) {
  await host.evaluate(() => { game.scene.getScene('Game').net.hist = []; });
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    samples.push(await guest.evaluate(() => game.scene.getScene('Game').net.debugPositions()));
    await sleep(90);
  }
  const { hist, zids } = await host.evaluate(() => {
    const s = game.scene.getScene('Game'), n = s.net;
    const h = n.hist; n.hist = null;
    const zids = s.zombies.getChildren().filter((z) => z.__nid).map((z) => String(z.__nid));
    zids.push('h');
    return { hist: h, zids };
  });
  const at = (id, t) => {
    let a = null, b = null;
    for (const e of hist) { if (e[0] <= t) a = e; else { b = e; break; } }
    if (!a || !b) return null;
    const pa = a[1][id], pb = b[1][id];
    if (!pa || !pb) return null;
    const k = (t - a[0]) / (b[0] - a[0]);
    return [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k];
  };
  const errs = [], lagErr = [], delays = [];
  for (const s of samples) {
    if (s.rt == null) continue;
    delays.push(s.hostNow - s.rt);
    for (const id of zids) {
      const g = s.objs[id];
      if (!g) continue;
      const h = at(id, s.rt), now = at(id, s.hostNow - 5);
      if (h) errs.push(Math.hypot(g[0] - h[0], g[1] - h[1]));
      if (now) lagErr.push(Math.hypot(g[0] - now[0], g[1] - now[1]));
    }
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN);
  return { n: errs.length, mean: mean(errs), p95: pct(errs, 0.95), max: Math.max(...errs), lagMean: mean(lagErr), delay: mean(delays) };
}

// Akıcılık: misafirde hareket eden bir vekilin kare başı adımları (duraklama / sıçrama oranı)
async function measureSmoothness(guest, ms = 2000) {
  return guest.evaluate((ms) => new Promise((resolve) => {
    const s = game.scene.getScene('Game');
    // En çok hareket eden zombi vekili (duran/saldıran zombi akıcılık ölçümünü bozmasın)
    const span = (m) => { const b = m.ip.buf; return b.length > 1 ? Math.hypot(b[b.length - 1][1] - b[0][1], b[b.length - 1][2] - b[0][2]) : 0; };
    const it = [...s.net.mirror.objs.entries()].filter(([, m]) => m.visible && m.texture?.key?.startsWith('zombie') && span(m) > 0.5).sort((a, b) => span(b[1]) - span(a[1]))[0];
    if (!it) { resolve(null); return; }
    const m = it[1], steps = [];
    let last = [m.x, m.y];
    const t0 = performance.now();
    const loop = () => {
      const d = Math.hypot(m.x - last[0], m.y - last[1]);
      last = [m.x, m.y];
      steps.push(d);
      if (performance.now() - t0 < ms) requestAnimationFrame(loop);
      else {
        const moving = steps.filter((x) => x > 0.01);
        const med = moving.length ? [...moving].sort((a, b) => a - b)[Math.floor(moving.length / 2)] : 0;
        resolve({ frames: steps.length, stallPct: Math.round((1 - moving.length / steps.length) * 100), jumps: moving.filter((x) => x > med * 4 + 1).length, med: Math.round(med * 100) / 100 });
      }
    };
    requestAnimationFrame(loop);
  }), ms);
}

async function bandwidth(host, fn) {
  const a = await host.evaluate(() => { const g = [...game.scene.getScene('Game').net.guests.values()][0]; return { out: g.conn.stats.out, fast: g.conn.stats.fastOut, t: performance.now() }; });
  await fn();
  const b = await host.evaluate(() => { const g = [...game.scene.getScene('Game').net.guests.values()][0]; return { out: g.conn.stats.out, fast: g.conn.stats.fastOut, t: performance.now() }; });
  const sec = (b.t - a.t) / 1000;
  return { kbps: Math.round(((b.out - a.out) / sec / 1024) * 10) / 10, fastPct: Math.round(((b.fast - a.fast) / Math.max(1, b.out - a.out)) * 100), sec: Math.round(sec * 10) / 10 };
}

// Ortak eylem dizisi: misafir ve host ayrı ayrı tarla sürer/eker, yapı kurar, zombi öldürür, ağaç keser, NPC davet eder
async function actionSequence(host, guest) {
  // Misafir tarlası
  await teleportGuest(host, guest, 200, 232);
  await guestUse(guest, 'hoe', 200, 248);
  await sleep(500);
  await guestUse(guest, 'seed_wheat', 200, 248);
  // Host tarlası (host'un kendi oyuncusu)
  await host.evaluate(async () => {
    const s = game.scene.getScene('Game');
    s.player.setPosition(264, 232);
    const { useSelected } = await import('/js/systems/PlayerActions.js');
    s.selectSlot(s.inventory.slots.findIndex((x) => x?.id === 'hoe'));
    s.player.actionCd = 0; useSelected(s, 264, 248);
    s.selectSlot(s.inventory.slots.findIndex((x) => x?.id === 'seed_carrot'));
    s.player.actionCd = 0; useSelected(s, 264, 248);
  });
  // Yapılar: host misafire 2 barikat verir, misafir bir tane kurar; host da bir tane kurar
  await host.evaluate(() => { const g = [...game.scene.getScene('Game').net.guests.values()][0]; g.inv.add('barricade', 2); });
  await guest.waitForFunction(() => game.scene.getScene('Game').inventory.count('barricade') === 2, null, { timeout: 5000 });
  await guestUse(guest, 'barricade', 216, 216);
  await host.evaluate(async () => {
    const s = game.scene.getScene('Game');
    s.inventory.add('barricade', 1);
    s.selectSlot(s.inventory.slots.findIndex((x) => x?.id === 'barricade'));
    const { useSelected } = await import('/js/systems/PlayerActions.js');
    s.player.actionCd = 0; useSelected(s, 280, 216);
  });
  // Zombi öldür (misafir yumruğu son vuruşu yapar)
  const zpos = await host.evaluate(() => {
    const s = game.scene.getScene('Game'), p = s.netPlayers[0];
    const z = s.spawnZombie(p.x + 12, p.y, 'normal');
    z.hp = 1; z.speed = 0; z.damage = 0;
    return [z.x, z.y];
  });
  await sleep(500);
  assert.ok(await guestUse(guest, 'sword', zpos[0], zpos[1]), 'misafir kılıçla vurur');
  await host.waitForFunction(() => game.scene.getScene('Game').zombies.getChildren().every((z) => z.hp > 1 || z.dead || !z.active), null, { timeout: 4000 });
  // Ağaç kes (misafir): en yakın ağacın yanına ışınla, tükenene kadar vur
  const tree = await host.evaluate(() => {
    const s = game.scene.getScene('Game'), d = s.shelter.door;
    let best = null, bd = Infinity;
    s.resources.getChildren().forEach((r, i) => {
      if (r.kind !== 'tree' || r.depleted) return;
      const dd = Phaser.Math.Distance.Between(r.x, r.y, d.x - 120, d.y);
      if (dd < bd) { bd = dd; best = { i, x: r.x, y: r.y, hits: r.hits }; }
    });
    return best;
  });
  await teleportGuest(host, guest, tree.x, tree.y + 22);
  for (let k = 0; k < 12; k++) {
    if (await host.evaluate((i) => game.scene.getScene('Game').resources.getChildren()[i].depleted, tree.i)) break;
    await guestUse(guest, 'axe', tree.x, tree.y);
    await sleep(450);
  }
  // NPC davet (misafir altınıyla): Selin'in yanına git, E, "Köye davet et"
  const npc = await host.evaluate(() => {
    const s = game.scene.getScene('Game');
    const n = s.outsiders.find((o) => o.outsider?.need?.coins);
    return n ? { x: n.x, y: n.y, name: n.npcName } : null;
  });
  let invited = false;
  if (npc) {
    await teleportGuest(host, guest, npc.x, npc.y + 14);
    await guest.evaluate(() => game.scene.getScene('Game').interact());
    await guest.waitForFunction(() => document.querySelector('#modal-dialog.show .options button'), null, { timeout: 5000 });
    await guest.evaluate(() => [...document.querySelectorAll('#modal-dialog .options button')].find((b) => b.textContent.includes('davet'))?.click());
    invited = await host.waitForFunction((name) => !game.scene.getScene('Game').outsiders.some((o) => o.npcName === name), npc.name, { timeout: 5000 }).then(() => true, () => false);
    await guest.evaluate(() => game.scene.getScene('Game').hud.closeAll());
  }
  return { tree, invited };
}

test('co-op senkron: eylem dizisi sonrası dünya özetleri aynı, konum hatası ve bant genişliği', { timeout: 120000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t);
  await spawnWalkers(host, 6);
  await sleep(800);
  const pos = await measurePositions(host, guest, 2500);
  console.log(`[ölçüm] konum hatası (enterpolasyon, aynı ağ id): ort ${pos.mean.toFixed(2)} px · p95 ${pos.p95.toFixed(2)} px · maks ${pos.max.toFixed(2)} px (n=${pos.n}) · oynatma gecikmesi ${pos.delay.toFixed(0)} ms · host'un "şu an"ına göre fark ort ${pos.lagMean.toFixed(1)} px`);
  assert.ok(pos.n > 20, 'yeterli örnek');
  assert.ok(pos.mean < 2.5 && pos.p95 < 6, `enterpolasyon hatası yüksek: ${JSON.stringify(pos)}`);
  const smooth = await measureSmoothness(guest);
  console.log(`[ölçüm] akıcılık (yerel ağ): ${JSON.stringify(smooth)}`);

  let res;
  const bw = await bandwidth(host, async () => { res = await actionSequence(host, guest); });
  console.log(`[ölçüm] bant genişliği (host→misafir, eylem dizisi sırasında): ${bw.kbps} KB/sn (${bw.fastPct}% hızlı kanal, ${bw.sec} sn)`);
  assert.ok(bw.kbps < 50, `bant genişliği yüksek: ${bw.kbps} KB/sn`);
  assert.ok(res.invited, 'misafir NPC davet edebilmeli');
  const sync = await waitSynced(host, guest, 5000, ['min']);
  console.log(`[ölçüm] özet eşleşmesi: ${sync.diff.length ? sync.diff.join(' | ') : `aynı (${sync.ms} ms içinde)`}`);
  assert.deepEqual(sync.diff, [], 'dünya özetleri eşleşmeli');
  assert.ok(sync.host.plots >= 2, 'iki tarla karesi');
  assert.ok(sync.host.res.split(',').includes(String(res.tree.i)), 'kesilen ağaç iki tarafta tükenmiş');
  assert.ok((sync.host.tex.barricade || 0) + (sync.host.tex.barricade_v || 0) >= 2, 'iki barikat');
  // Saat: en fazla 1 oyun dakikası fark
  const [hm, gm] = await Promise.all([host.evaluate(() => game.scene.getScene('Game').timeSys.minutes), guest.evaluate(() => game.scene.getScene('Game').timeSys.minutes)]);
  assert.ok(Math.abs(hm - gm) <= 2, `saat farkı ${hm} / ${gm}`);
  // Can/durum: misafirin canı/altını host'takiyle aynı (gündüz can yavaşça dolduğu için ±1)
  // (ganimet mıknatısı altını birkaç yüz ms sonra verebilir: kısa süre eşleşmeyi bekle)
  let hp, gp;
  for (let i = 0; i < 20; i++) {
    [hp, gp] = await Promise.all([
      host.evaluate(() => { const p = game.scene.getScene('Game').netPlayers[0]; return [p.hp, p.coins]; }),
      guest.evaluate(() => { const p = game.scene.getScene('Game').player; return [p.hp, p.coins]; })
    ]);
    if (gp[1] === hp[1] && Math.abs(gp[0] - hp[0]) <= 1.5) break;
    await sleep(150);
  }
  assert.ok(Math.abs(gp[0] - hp[0]) <= 1.5, `misafirin canı ${gp[0]} / host ${hp[0]}`);
  assert.equal(gp[1], hp[1], 'misafirin altını');
  const corr = await host.evaluate(() => [...game.scene.getScene('Game').net.guests.values()][0].corrections || 0);
  assert.equal(corr, 0, 'dürüst harekette host konum düzeltmesi olmamalı');
  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});

test('co-op senkron: gecikme + titreşim + kayıp altında (lag=120, jitter=40, loss=5)', { timeout: 120000 }, async (t) => {
  const { host, guest, hostErr, guestErr } = await setupMP(t, { q: '&lag=120&jitter=40&loss=5' });
  await spawnWalkers(host, 6);
  await sleep(1500);
  const pos = await measurePositions(host, guest, 3000);
  console.log(`[ölçüm/gecikme] konum hatası: ort ${pos.mean.toFixed(2)} px · p95 ${pos.p95.toFixed(2)} px · maks ${pos.max.toFixed(2)} px (n=${pos.n}) · oynatma gecikmesi ${pos.delay.toFixed(0)} ms · host "şu an" farkı ort ${pos.lagMean.toFixed(1)} px`);
  assert.ok(pos.n > 20, 'yeterli örnek');
  assert.ok(pos.mean < 3.5 && pos.p95 < 10, `gecikmede enterpolasyon hatası yüksek: ${JSON.stringify(pos)}`);
  const smooth = await measureSmoothness(guest);
  console.log(`[ölçüm/gecikme] akıcılık: ${JSON.stringify(smooth)}`);
  if (smooth) assert.ok(smooth.jumps <= 3, `vekil hareketinde sıçrama: ${JSON.stringify(smooth)}`);

  // Misafir klavyeyle yürür: yerel hareket anında, host'ta düzeltme yok, konumlar yakınsar
  await teleportGuest(host, guest, 200, 232);
  await guest.keyboard.down('d');
  await sleep(900);
  await guest.keyboard.up('d');
  await guest.keyboard.down('s');
  await sleep(500);
  await guest.keyboard.up('s');
  const gpos = await guest.evaluate(() => { const p = game.scene.getScene('Game').player; return [p.x, p.y]; });
  await host.waitForFunction(([x, y]) => { const p = game.scene.getScene('Game').netPlayers[0]; return Math.hypot(p.x - x, p.y - y) < 2; }, gpos, { timeout: 5000 });

  const res = await actionSequence(host, guest);
  assert.ok(res.invited, 'gecikmede de davet çalışmalı');
  const sync = await waitSynced(host, guest, 8000, ['min']);
  console.log(`[ölçüm/gecikme] özet eşleşmesi: ${sync.diff.length ? sync.diff.join(' | ') : `aynı (${sync.ms} ms içinde)`}`);
  assert.deepEqual(sync.diff, [], 'gecikmede de dünya özetleri eşleşmeli');
  const st = await host.evaluate(() => { const g = [...game.scene.getScene('Game').net.guests.values()][0]; return { corr: g.corrections || 0, dropped: g.conn.stats.dropped }; });
  console.log(`[ölçüm/gecikme] host konum düzeltmesi: ${st.corr} · düşen hızlı paket (host→misafir): ${st.dropped}`);
  assert.equal(st.corr, 0, 'gecikmede dürüst harekete düzeltme olmamalı');
  assertNoErrors(assert, hostErr, 'host');
  assertNoErrors(assert, guestErr, 'misafir');
});
