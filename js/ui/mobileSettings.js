// Dokunmatik kontrol ayarları — cihaza özel, localStorage'da tutulur (kayıt dosyasından bağımsız).
const KEY = 'zombi-ciftlik-mobil-ayar';
const DEFAULTS = { vibrate: true, leftHanded: false, opacity: 0.85 };

export const settings = { ...DEFAULTS };

try {
  const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (raw && typeof raw === 'object') {
    if (typeof raw.vibrate === 'boolean') settings.vibrate = raw.vibrate;
    if (typeof raw.leftHanded === 'boolean') settings.leftHanded = raw.leftHanded;
    if (Number.isFinite(raw.opacity)) settings.opacity = Math.min(1, Math.max(0.4, raw.opacity));
  }
} catch { /* depolama kapalı olabilir */ }

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* yoksay */ }
  applySettings();
}

// Gövde sınıfı + CSS değişkeni olarak uygula
export function applySettings() {
  const b = document.body;
  if (!b) return;
  b.classList.toggle('left-handed', settings.leftHanded);
  b.style.setProperty('--mc-alpha', String(settings.opacity));
}

export function vibrate(ms = 15) {
  if (!settings.vibrate) return;
  try { navigator.vibrate?.(ms); } catch { /* desteklenmiyor */ }
}
