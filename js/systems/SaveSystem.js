import { SAVE_KEY } from '../config.js';

// localStorage tabanlı kayıt. Özel modda/engelli depolamada sessizce başarısız olur.
export const SaveSystem = {
  save(data) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), ...data }));
      return true;
    } catch (e) {
      console.warn('Kayıt başarısız:', e);
      return false;
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('Kayıt okunamadı:', e);
      return null;
    }
  },

  exists() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
  },

  clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* yok say */ }
  }
};
