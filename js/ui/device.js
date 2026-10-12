// Cihaz algılama + tarayıcı jestlerini kapatma (oyun başlamadan önce çalışır).
// isTouch canlı bağlamadır (export let): ayar ya da hibrit cihazda girdi türü değişince güncellenir.
import { settings, onSettingsChange } from './mobileSettings.js';

const mq = (q) => { try { return window.matchMedia(q).matches; } catch { return false; } };

// Cihazda dokunmatik ekran var mı (telefon, tablet ya da dokunmatik dizüstü)
export const touchCapable = (() => {
  try { return navigator.maxTouchPoints > 0 || 'ontouchstart' in window || mq('(any-pointer: coarse)'); } catch { return false; }
})();

// Otomatik: birincil işaretçi parmaksa (telefon/tablet, yatay ya da dikey) ya da mobil tarayıcıysa açık.
// Fareli dokunmatik dizüstünde kapalı başlar; ekrana dokunulunca açılır, fareyle tıklanınca kapanır.
function primaryTouch() {
  if (!touchCapable) return false;
  if (mq('(pointer: coarse)')) return true;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini/i.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true; // masaüstü UA'lı iPadOS
  return !mq('(any-pointer: fine)'); // fare/kalem yoksa dokunmatik
}

let lastInput = null; // hibrit cihazda son girdi türü: 'touch' | 'mouse'

function compute() {
  if (settings.touchMode === 'on') return true;
  if (settings.touchMode === 'off') return false;
  if (primaryTouch()) return true;
  return lastInput === 'touch';
}

export let isTouch = compute();

export const isPortrait = () => window.innerHeight >= window.innerWidth;

// Telefon (kısa kenarı < 600px dokunmatik ekran) yalnız yatay oynanır; dikey tutulunca "çevir" ekranı çıkar
const isPhone = () => { try { return Math.min(screen.width, screen.height) < 600; } catch { return false; } };
// ?portrait=1 (ve e2e testleri) dikey düzeni açık bırakır
const allowPortrait = (() => { try { return /[?&](portrait|e2e)=/.test(location.search); } catch { return false; } })();
export const needsRotate = () => !allowPortrait && isTouch && isPhone() && isPortrait();
const rotateFns = new Set();
export function onRotateChange(fn) { rotateFns.add(fn); return () => rotateFns.delete(fn); }
let rotateShown = false;

// ---------------- Tam ekran ----------------
// iPhone Safari öğe tam ekranını desteklemez: orada tuş gizli kalır (ana ekrana ekleyince zaten tam ekran)
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
export const fullscreenSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const lockLandscape = () => { if (isTouch && isPhone()) screen.orientation?.lock?.('landscape').catch(() => {}); };

export function toggleFullscreen() {
  const de = document.documentElement;
  if (fsEl()) {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    return;
  }
  const req = de.requestFullscreen || de.webkitRequestFullscreen;
  if (!req) return;
  Promise.resolve(req.call(de, { navigationUI: 'hide' })).then(lockLandscape).catch(() => {});
}

function installFullscreenButton() {
  if (!fullscreenSupported() || document.getElementById('btn-fs')) return;
  const b = document.createElement('button');
  b.id = 'btn-fs';
  b.type = 'button';
  const sync = () => {
    const on = !!fsEl();
    b.textContent = on ? '🗗' : '⛶';
    b.title = b.ariaLabel = on ? 'Tam ekrandan çık' : 'Tam ekran';
  };
  b.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();
  document.body.appendChild(b);
}

// Android'de ilk dokunuşta tam ekran + yatay kilit dener (iOS desteklemez; orada çevir ekranı yeter)
function tryLockLandscape() {
  if (!isTouch || !isPhone()) return;
  if (fsEl()) { lockLandscape(); return; }
  toggleFullscreen();
}

// Dokunmatik ekranda kamera yakınlığı: portrede daha geniş görüş; alçak yatay ekranda 2
export function pickZoom(base = 3) {
  const w = window.innerWidth, h = window.innerHeight;
  if (isTouch) return isPortrait() ? 2 : Math.max(2, Math.min(3, Math.floor(Math.min(w, h) / 170)));
  return Math.min(w, h) < 520 ? 2 : base;
}

// Gövde sınıflarını (is-touch, portrait/landscape) güncel tut
function syncBody() {
  const b = document.body;
  if (!b) return;
  b.classList.toggle('is-touch', isTouch);
  b.classList.toggle('touch-capable', touchCapable);
  b.classList.toggle('portrait', isPortrait());
  b.classList.toggle('landscape', !isPortrait());
  const rot = needsRotate();
  b.classList.toggle('rotate-needed', rot);
  if (rot !== rotateShown) {
    rotateShown = rot;
    rotateFns.forEach((fn) => { try { fn(rot); } catch (e) { console.warn('yön dinleyicisi', e); } });
  }
}

const changeFns = new Set();
// Dokunmatik mod açılıp kapanınca çağrılır: fn(isTouch)
export function onTouchChange(fn) { changeFns.add(fn); return () => changeFns.delete(fn); }

export function refreshTouch() {
  const next = compute();
  if (next === isTouch) { syncBody(); return; }
  isTouch = next;
  syncBody();
  changeFns.forEach((fn) => { try { fn(isTouch); } catch (e) { console.warn('dokunmatik mod dinleyicisi', e); } });
}

let installed = false;
export function installDevice() {
  if (installed) return;
  installed = true;
  syncBody();
  window.addEventListener('resize', syncBody);
  window.addEventListener('orientationchange', () => setTimeout(syncBody, 120));
  onSettingsChange(refreshTouch);
  document.addEventListener('touchend', tryLockLandscape, { once: true, capture: true });
  if (document.body) installFullscreenButton();
  else document.addEventListener('DOMContentLoaded', installFullscreenButton, { once: true });
  // Emülasyon / tablet klavye-kılıf değişimi: birincil işaretçi değişirse yeniden değerlendir
  try { window.matchMedia('(pointer: coarse)').addEventListener?.('change', refreshTouch); } catch { /* eski tarayıcı */ }
  if (touchCapable) {
    // Hibrit cihaz: son kullanılan girdi türüne göre otomatik geçiş (yalnız birincil işaretçi fare ise)
    window.addEventListener('pointerdown', (e) => {
      if (settings.touchMode !== 'auto' || primaryTouch()) return;
      const kind = e.pointerType === 'touch' ? 'touch' : e.pointerType === 'mouse' ? 'mouse' : null;
      if (!kind || kind === lastInput) return;
      lastInput = kind;
      refreshTouch();
    }, true);
  }
  // Pinch / çift dokunma yakınlaştırmasını, iOS jestlerini ve uzun basma menüsünü engelle (yalnız dokunmatik düzende)
  const touchOn = () => document.body?.classList.contains('is-touch');
  const stop = (e) => { if (touchOn()) e.preventDefault(); };
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  document.addEventListener('contextmenu', stop);
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 && touchOn()) e.preventDefault(); }, { passive: false });
  // Çift dokunma yakınlaştırması CSS touch-action: manipulation ile kapatılır (tıklamaları bozmadan)
}
