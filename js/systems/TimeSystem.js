import { DAY_START, NIGHT_START, GAME_MIN_PER_SEC } from '../config.js';

// Gün/gece döngüsü. Phaser EventEmitter üzerinden 'dusk', 'dawn', 'hour' olayları yayar.
export class TimeSystem extends Phaser.Events.EventEmitter {
  constructor() {
    super();
    this.minutes = 7 * 60;
    this.day = 1;
    this.speed = GAME_MIN_PER_SEC;
    this.wasNight = this.isNight;
  }

  get isNight() { return this.minutes >= NIGHT_START || this.minutes < DAY_START; }

  get hour() { return Math.floor(this.minutes / 60); }

  get clock() {
    const h = String(Math.floor(this.minutes / 60)).padStart(2, '0');
    const m = String(Math.floor(this.minutes % 60)).padStart(2, '0');
    return `${h}:${m}`;
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
    if (!night && this.wasNight) { this.day++; this.emit('dawn', this.day); }
    this.wasNight = night;
    return delta;
  }

  // 0 (aydınlık) .. 0.8 (zifiri karanlık)
  get darkness() {
    const m = this.minutes, MAX = 0.8;
    const ramp = (a, b, from, to) => from + (to - from) * Math.min(1, Math.max(0, (m - a) / (b - a)));
    if (m >= 18.5 * 60 && m < 20.5 * 60) return ramp(18.5 * 60, 20.5 * 60, 0, MAX);
    if (m >= 20.5 * 60 || m < 4.5 * 60) return MAX;
    if (m >= 4.5 * 60 && m < 6.5 * 60) return ramp(4.5 * 60, 6.5 * 60, MAX, 0);
    return 0;
  }

  // Akşamüstü turuncu ton için 0..1
  get duskTint() {
    const m = this.minutes;
    if (m >= 17 * 60 && m < 20 * 60) return Math.sin(((m - 17 * 60) / 180) * Math.PI) * 0.35;
    return 0;
  }

  serialize() { return { minutes: this.minutes, day: this.day }; }
  load(d) {
    if (!d) return;
    this.minutes = d.minutes; this.day = d.day;
    this.wasNight = this.isNight;
  }
}
