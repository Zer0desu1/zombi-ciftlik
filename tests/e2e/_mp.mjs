// Çok oyunculu e2e ortak altyapı: iki sayfa (host + misafir) aynı tarayıcıda, yerel taşıyıcı (?net=local).
// q: ek URL parametreleri (ör. '&lag=120&jitter=40&loss=5' yapay ağ koşulları).
import { chromium } from 'playwright-core';
import { startServer, CHROME_PATH, collectErrors, waitForScene } from './_harness.mjs';

// İki sayfa aynı anda oynar: arka plandaki sekmenin rAF/zamanlayıcı kısıtlaması kapalı olmalı
export const launchMP = () => chromium.launch({
  executablePath: CHROME_PATH,
  args: ['--use-angle=swiftshader', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows']
});

export const G = () => game.scene.getScene('Game');

// Host oda kurar, misafir katılır. { srv, browser, host, guest, code, hostErr, guestErr }
export async function setupMP(t, { q = '', hostName = 'Ali', guestName = 'Veli', viewport = { width: 760, height: 480 }, browser: br = null } = {}) {
  const srv = await startServer();
  const browser = br || await launchMP();
  t.after(async () => { if (!br) await browser.close().catch(() => {}); await srv.close(); });
  const ctx = await browser.newContext({ viewport });
  const host = await ctx.newPage();
  const guest = await ctx.newPage();
  const hostErr = collectErrors(host), guestErr = collectErrors(guest);
  await host.goto(`${srv.url}?net=local${q}`);
  await host.evaluate(() => localStorage.clear());
  await host.reload();
  await waitForScene(host);
  await host.waitForSelector('#menu.show', { timeout: 15000 });
  await host.click('#btn-mp');
  await host.fill('#mp-name', hostName);
  await host.click('#mp-pick button[data-diff="normal"]');
  await host.waitForFunction(() => game.scene.getScene('Game').started && game.scene.getScene('Game').net?.code, null, { timeout: 10000 });
  const code = await host.evaluate(() => game.scene.getScene('Game').net.code);
  await joinGuest(guest, srv.url, code, guestName, q);
  await host.waitForFunction(() => game.scene.getScene('Game').netPlayers?.length >= 1, null, { timeout: 5000 });
  return { srv, browser, ctx, host, guest, code, hostErr, guestErr };
}

export async function joinGuest(page, url, code, name, q = '') {
  await page.goto(`${url}?net=local${q}&oda=${code}`);
  await waitForScene(page);
  await page.waitForSelector('#mp-pick.show', { timeout: 15000 });
  await page.fill('#mp-name', name);
  await page.click('#mp-join');
  await page.waitForFunction(() => game.scene.getScene('Game').net?.started && game.scene.getScene('Game').started, null, { timeout: 15000 });
}

// Misafiri host otoritesiyle ışınla ve misafirin konumu almasını bekle
export async function teleportGuest(host, guest, x, y, idx = 0) {
  await host.evaluate(([x, y, i]) => { const n = game.scene.getScene('Game').net; n.teleport([...n.guests.values()][i], x, y); }, [x, y, idx]);
  await guest.waitForFunction(([x, y]) => Math.abs(game.scene.getScene('Game').player.x - x) < 2 && Math.abs(game.scene.getScene('Game').player.y - y) < 2, [x, y], { timeout: 5000 });
}

// Misafir adına PlayerActions.useSelected (seçili eşya), slot id ile
export async function guestUse(guest, itemId, wx, wy) {
  return guest.evaluate(async ([id, x, y]) => {
    const s = game.scene.getScene('Game');
    if (id != null) {
      const i = id === '' ? s.inventory.slots.findIndex((v, k) => k < 8 && !v) : s.inventory.slots.findIndex((v) => v?.id === id);
      if (i < 0) return false;
      s.selectSlot(i);
    }
    s.player.actionCd = 0;
    const { useSelected } = await import('/js/systems/PlayerActions.js');
    useSelected(s, x, y);
    return true;
  }, [itemId, wx, wy]);
}

// Senkron özetlerini karşılaştır: farklı alanları döndür (boşsa eşit)
export function diffSummary(a, b) {
  const out = [];
  for (const k of Object.keys(a)) {
    if (k === 'tex') {
      const keys = new Set([...Object.keys(a.tex), ...Object.keys(b.tex)]);
      for (const t of keys) if ((a.tex[t] || 0) !== (b.tex[t] || 0)) out.push(`tex.${t}: ${a.tex[t] || 0} ≠ ${b.tex[t] || 0}`);
    } else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`${k}: ${String(JSON.stringify(a[k])).slice(0, 80)} ≠ ${String(JSON.stringify(b[k])).slice(0, 80)}`);
  }
  return out;
}

// İki taraf da sakinleşene kadar (en fazla ms) özetleri karşılaştır; son farkları döndür
export async function waitSynced(host, guest, ms = 4000, ignore = []) {
  const t0 = Date.now();
  let d = [];
  while (Date.now() - t0 < ms) {
    const [a, b] = await Promise.all([host.evaluate(() => game.scene.getScene('Game').net.syncSummary()), guest.evaluate(() => game.scene.getScene('Game').net.syncSummary())]);
    for (const k of ignore) { delete a[k]; delete b[k]; }
    d = diffSummary(a, b);
    if (!d.length) return { diff: d, host: a, guest: b, ms: Date.now() - t0 };
    await new Promise((r) => setTimeout(r, 150));
  }
  return { diff: d, ms: Date.now() - t0 };
}
