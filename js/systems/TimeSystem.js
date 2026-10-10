import { DAY_START, NIGHT_START, DAY_SECONDS, NIGHT_SECONDS } from '../config.js';

// Mevsimler: her biri SEASON_DAYS gün sürer, sırayla döner
export const SEASON_DAYS = 7;
export const SEASONS = [
  { id: 'spring', name: 'İlkbahar', icon: '🌸' },
  { id: 'summer', name: 'Yaz',      icon: '☀️' },
  { id: 'autumn', name: 'Sonbahar', icon: '🍂' },
  { id: 'winter', name: 'Kış',      icon: '❄️' }
];

// Gün/gece döngüsü. Phaser EventEmitter üzerinden 'dusk', 'dawn', 'hour', 'seasonChanged' olayları yayar.
export class TimeSystem extends Phaser.Events.EventEmitter {
  constructor() {
    super();
    this.minutes = 7 * 60;
    this.day = 1;
    this.speedMul = 1; // >1: hızlı ileri sarma (dalga temizlenince / geceyi erken başlatınca)
    this.wasNight = this.isNight;
    this.weatherDim = 0; // hava durumu kararması (world özelliği yazar)
  }

  get isNight() { return this.minutes >= NIGHT_START || this.minutes < DAY_START; }

  get hour() { return Math.floor(this.minutes / 60); }

  get clock() {
    const h = String(Math.floor(this.minutes / 60)).padStart(2, '0');
    const m = String(Math.floor(this.minutes % 60)).padStart(2, '0');
    return `${h}:${m}`;
  }

  // ---- Mevsim ----
  get seasonIndex() { return Math.floor((Math.max(1, this.day) - 1) / SEASON_DAYS) % SEASONS.length; }
  get season() { return SEASONS[this.seasonIndex].id; }            // 'spring' | 'summer' | 'autumn' | 'winter'
  get seasonInfo() { return SEASONS[this.seasonIndex]; }
  get seasonDay() { return ((Math.max(1, this.day) - 1) % SEASON_DAYS) + 1; } // 1..7
  get year() { return Math.floor((Math.max(1, this.day) - 1) / (SEASON_DAYS * SEASONS.length)) + 1; }

  // Oyun dakikası / gerçek saniye: gündüz ve gece ayrı hızlarda akar
  get speed() {
    const base = this.isNight ? (24 * 60 - NIGHT_START + DAY_START) / NIGHT_SECONDS : (NIGHT_START - DAY_START) / DAY_SECONDS;
    return base * this.speedMul;
  }

  // dt saniye cinsinden; geçen oyun dakikasını döndürür
  update(dt) {
    const prevHour = this.hour;
    const delta = dt * this.speed;
    this.minutes += delta;
    if (this.minutes >= 1440) { this.minutes -= 1440; }
    if (this.hour !== prevHour) this.emit('hour', this.hour);
    const night = this.isNight;
    if (night && !this.wasNight) this.emit('dusk', this.day);
    if (!night && this.wasNight) {
      const prevSeason = this.seasonIndex;
      this.day++;
      this.emit('dawn', this.day);
      if (this.seasonIndex !== prevSeason) this.emit('seasonChanged', this.season, this.seasonIndex);
    }
    this.wasNight = night;
    return delta;
  }

  // Saf gün/gece karanlığı: 0 (aydınlık) .. 0.8 (zifiri karanlık)
  get baseDarkness() {
    const m = this.minutes, MAX = 0.8;
    const ramp = (a, b, from, to) => from + (to - from) * Math.min(1, Math.max(0, (m - a) / (b - a)));
    if (m >= 18.5 * 60 && m < 20.5 * 60) return ramp(18.5 * 60, 20.5 * 60, 0, MAX);
    if (m >= 20.5 * 60 || m < 4.5 * 60) return MAX;
    if (m >= 4.5 * 60 && m < 6.5 * 60) return ramp(4.5 * 60, 6.5 * 60, MAX, 0);
    return 0;
  }

  // Hava durumu (bulut/fırtına) kararmasını da hesaba katar
  get darkness() { return Math.max(this.baseDarkness, this.weatherDim || 0); }

  // Akşamüstü turuncu ton için 0..1
  get duskTint() {
    const m = this.minutes;
    if (m >= 17 * 60 && m < 20 * 60) return Math.sin(((m - 17 * 60) / 180) * Math.PI) * 0.35;
    return 0;
  }

  serialize() { return { minutes: this.minutes, day: this.day }; }
  load(d) {
    if (!d) return;
    if (Number.isFinite(d.minutes)) this.minutes = d.minutes;
    if (Number.isFinite(d.day)) this.day = Math.max(1, d.day);
    this.wasNight = this.isNight;
  }
}
