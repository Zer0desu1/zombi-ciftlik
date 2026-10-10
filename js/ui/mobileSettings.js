// Dokunmatik kontrol ayarları — cihaza özel, localStorage'da tutulur (kayıt dosyasından bağımsız).
const KEY = 'zombi-ciftlik-mobil-ayar';
// touchMode: 'auto' | 'on' | 'off'  — dokunmatik kontrolleri göster
// moveMode:  'joy' | 'dpad4' | 'dpad8' — hareket kontrolü
// joyMode:   'float' | 'fixed' — joystick tabanı parmağa taşınır mı
const DEFAULTS = { vibrate: true, leftHanded: false, opacity: 0.85, touchMode: 'auto', moveMode: 'joy', joyMode: 'float' };
const CHOICES = { touchMode: ['auto', 'on', 'off'], moveMode: ['joy', 'dpad4', 'dpad8'], joyMode: ['float', 'fixed'] };

export const settings = { ...DEFAULTS };

try {
  const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (raw && typeof raw === 'object') {
    if (typeof raw.vibrate === 'boolean') settings.vibrate = raw.vibrate;
    if (typeof raw.leftHanded === 'boolean') settings.leftHanded = raw.leftHanded;
    if (Number.isFinite(raw.opacity)) settings.opacity = Math.min(1, Math.max(0.4, raw.opacity));
    for (const [k, list] of Object.entries(CHOICES)) if (list.includes(raw[k])) settings[k] = raw[k];
  }
} catch { /* depolama kapalı olabilir */ }

// Ayar değişince haber verilecekler (device.js dokunmatik modunu, TouchControls hareket türünü yeniler)
const listeners = new Set();
export function onSettingsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* yoksay */ }
  applySettings();
  listeners.forEach((fn) => { try { fn(settings); } catch (e) { console.warn('mobil ayar dinleyicisi', e); } });
}

// Gövde sınıfı + CSS değişkeni olarak uygula
export function applySettings() {
  const b = document.body;
  if (!b) return;
  b.classList.toggle('left-handed', settings.leftHanded);
  b.classList.toggle('mv-dpad', settings.moveMode !== 'joy');
  b.classList.toggle('mv-dpad8', settings.moveMode === 'dpad8');
  b.classList.toggle('joy-fixed', settings.joyMode === 'fixed');
  b.style.setProperty('--mc-alpha', String(settings.opacity));
}

export function vibrate(ms = 15) {
  if (!settings.vibrate) return;
  try { navigator.vibrate?.(ms); } catch { /* desteklenmiyor */ }
}
