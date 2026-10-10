// Oyunlar arası rekorlar (en iyi gün/dalga/puan, zaferler). Kayıttan bağımsız tutulur.
const KEY = 'zombi-ciftlik-records-v1';

export function loadRecords() {
  try { return { bestDay: 0, bestWave: 0, bestScore: 0, wins: 0, runs: 0, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
  catch { return { bestDay: 0, bestWave: 0, bestScore: 0, wins: 0, runs: 0 }; }
}

// Puan: hayatta kalınan dalgalar ağır basar; zorluk çarpanı ve zafer bonusu eklenir
export function scoreOf({ wave = 0, day = 0, kills = 0, coins = 0, victory = false, difficulty = 'normal' }) {
  const mul = { easy: 0.7, normal: 1, hard: 1.5 }[difficulty] || 1;
  return Math.round((wave * 120 + day * 40 + kills * 5 + coins * 0.2 + (victory ? 2500 : 0)) * mul);
}

// Sonucu işler; { records, newBest } döndürür
export function recordRun(stats) {
  const r = loadRecords();
  const score = scoreOf(stats);
  const newBest = score > r.bestScore;
  r.runs++;
  r.bestDay = Math.max(r.bestDay, stats.day || 0);
  r.bestWave = Math.max(r.bestWave, stats.wave || 0);
  r.bestScore = Math.max(r.bestScore, score);
  if (stats.victory) r.wins++;
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* depolama kapalı */ }
  return { records: r, score, newBest };
}
