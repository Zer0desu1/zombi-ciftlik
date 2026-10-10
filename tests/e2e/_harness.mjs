// E2E ortak altyapı: statik http sunucusu (node:http), Chrome başlatma, oyuna giriş yardımcıları.
// Chrome yolu CHROME_PATH ile, port E2E_PORT ile değiştirilebilir (doluysa rastgele boş porta düşer).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg'
};

export const CHROME_PATH = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const DESKTOP = { viewport: { width: 1366, height: 768 } };
export const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

export function startServer(port = Number(process.env.E2E_PORT || 8097)) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.resolve(ROOT, '.' + rel);
      if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    const listen = (p) => server.listen(p, '127.0.0.1');
    server.once('listening', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) }));
    server.on('error', (e) => { if (e.code === 'EADDRINUSE' && port !== 0) { port = 0; listen(0); } else reject(e); });
    listen(port);
  });
}

export function launchBrowser() {
  return chromium.launch({
    executablePath: CHROME_PATH,
    args: ['--use-angle=swiftshader', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
  });
}

// Sayfa hatalarını toplar. Phaser CDN'i dışındaki 404'ler ve ses kilidi uyarıları gürültü sayılmaz.
export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|404|AudioContext/i.test(t)) return;
    errors.push('console.error: ' + t);
  });
  page.on('dialog', (d) => d.accept());
  return errors;
}

export async function waitForScene(page) {
  await page.waitForFunction(() => window.game?.scene?.getScene?.('Game')?.hud, null, { timeout: 30000 });
}

// Menüden yeni oyun (Normal zorluk) başlatır; kayıt/rekor temizlenmiş olarak
export async function newGame(page, baseUrl) {
  await page.goto(baseUrl + '?e2e=' + Date.now());
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitForScene(page);
  await page.waitForSelector('#menu.show', { timeout: 15000 });
  await page.click('#btn-new');
  await page.click('#diff-pick button.primary');
  await page.waitForFunction(() => game.scene.getScene('Game').started === true, null, { timeout: 10000 });
}

export async function setup(t, context = DESKTOP) {
  const srv = await startServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext(context);
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  t.after(async () => { await browser.close().catch(() => {}); await srv.close(); });
  return { srv, browser, page, errors, url: srv.url };
}

export function assertNoErrors(assert, errors, label = '') {
  assert.deepEqual([...new Set(errors)], [], `${label} sayfa hataları`);
}
