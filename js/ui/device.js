// Cihaz algılama + tarayıcı jestlerini kapatma (oyun başlamadan önce çalışır).
export const isTouch = (() => {
  try {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  } catch { return 'ontouchstart' in window; }
})();

export const isPortrait = () => window.innerHeight >= window.innerWidth;

// Dokunmatik ekranda kamera yakınlığı: portrede daha geniş görüş
export function pickZoom(base = 3) {
  const w = window.innerWidth, h = window.innerHeight;
  if (isTouch) return isPortrait() ? 2 : Math.max(2, Math.min(3, Math.round(Math.min(w, h) / 130)));
  return Math.min(w, h) < 520 ? 2 : base;
}

// Gövde sınıflarını (is-touch, portrait/landscape) güncel tut
function syncBody() {
  const b = document.body;
  if (!b) return;
  b.classList.toggle('is-touch', isTouch);
  b.classList.toggle('portrait', isPortrait());
  b.classList.toggle('landscape', !isPortrait());
}

let installed = false;
export function installDevice() {
  if (installed) return;
  installed = true;
  syncBody();
  window.addEventListener('resize', syncBody);
  window.addEventListener('orientationchange', () => setTimeout(syncBody, 120));
  if (!isTouch) return;
  // Pinch / çift dokunma yakınlaştırmasını, iOS jestlerini ve uzun basma menüsünü engelle
  const stop = (e) => e.preventDefault();
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  document.addEventListener('contextmenu', stop);
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  // Çift dokunma yakınlaştırması CSS touch-action: manipulation ile kapatılır (tıklamaları bozmadan)
}
