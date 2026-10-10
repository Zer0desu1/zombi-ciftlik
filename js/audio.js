// Web Audio API ile retro 8-bit efektler, prosedürel chiptune müzik ve ortam sesleri.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz

// Parçalar (MIDI notaları, 0 = sus). Gündüz: neşeli majör; gece: gergin minör.
// lead: 32 adım (8'lik), bass: 16 adım (4'lük)
const SONGS = {
  day: [
    { name: 'Sabah Güneşi', bpm: 112, leadType: 'square', leadVol: 0.18,
      lead: [72, 0, 76, 79, 77, 76, 74, 0, 72, 74, 76, 0, 79, 77, 76, 74, 72, 0, 69, 72, 74, 72, 69, 67, 69, 72, 74, 76, 74, 0, 72, 0],
      bass: [48, 48, 55, 55, 53, 53, 50, 50, 48, 48, 55, 55, 53, 53, 55, 55] },
    { name: 'Tarla Türküsü', bpm: 104, leadType: 'triangle', leadVol: 0.3,
      lead: [67, 0, 71, 74, 72, 71, 69, 0, 67, 69, 71, 0, 74, 0, 72, 0, 71, 0, 67, 69, 71, 72, 74, 0, 76, 74, 72, 71, 69, 0, 67, 0],
      bass: [43, 43, 50, 50, 48, 48, 50, 50, 43, 43, 47, 47, 48, 48, 50, 50] },
    { name: 'Öğle Esintisi', bpm: 96, leadType: 'square', leadVol: 0.13, arp: true,
      lead: [65, 69, 72, 0, 70, 69, 67, 0, 65, 67, 69, 72, 74, 0, 72, 0, 70, 72, 74, 0, 72, 70, 69, 67, 65, 0, 67, 69, 65, 0, 0, 0],
      bass: [41, 41, 48, 48, 46, 46, 48, 48, 41, 41, 45, 45, 46, 46, 48, 48] }
  ],
  night: [
    { name: 'Karanlık Çöker', bpm: 132, leadType: 'square', leadVol: 0.18, hats: true,
      lead: [69, 0, 0, 72, 0, 71, 69, 0, 64, 0, 0, 65, 64, 0, 62, 0, 69, 0, 0, 72, 0, 74, 76, 0, 77, 76, 74, 72, 71, 0, 68, 0],
      bass: [45, 45, 45, 45, 41, 41, 41, 41, 43, 43, 43, 43, 40, 40, 44, 44] },
    { name: 'Sis', bpm: 120, leadType: 'sawtooth', leadVol: 0.09, hats: true,
      lead: [62, 0, 65, 0, 69, 0, 68, 69, 70, 0, 69, 0, 65, 0, 62, 0, 62, 0, 65, 0, 69, 0, 72, 70, 69, 0, 65, 0, 64, 0, 61, 0],
      bass: [38, 38, 38, 38, 46, 46, 46, 46, 43, 43, 43, 43, 45, 45, 45, 45] }
  ]
};
const LOOPS_PER_SONG = 4; // bu kadar tekrar sonra aynı moddaki bir sonraki parçaya geç

// Kısa sürede tekrar çalınırsa kırpılan (spam) efektler
const THROTTLE = { hit: 35, zdie: 50, turret: 40, groan: 400, coin: 40, pop: 30, step: 60 };
// Doğal his için hafif perde rastgeleliği alan efektler
const VARY = new Set(['hit', 'swing', 'chop', 'mine', 'zdie', 'groan', 'pop', 'shoot', 'turret', 'step', 'hurt']);

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.mode = null;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.songIdx = { day: 0, night: 0 };
    this.song = null;
    this.intensity = 0;      // 0..1 (gece zombi yoğunluğu → katman/tempo)
    this.vol = { music: 1, sfx: 1, amb: 1 };
    this.amb = { day: false, night: false, rain: 0 };
    this.nextBird = 0; this.nextCricket = 0; this.nextOwl = 0;
    this.last = {};
    this.pitch = 1;
  }

  // Tarayıcılar ses için kullanıcı etkileşimi ister
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch { this.ctx = null; return; }
    const c = this.ctx;
    // Ana çıkış: kompresör ile ani tepe noktalarını yumuşat (çok zombi = çok efekt)
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
    this.comp.connect(c.destination);
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.comp);
    this.sfxBus = c.createGain(); this.sfxBus.connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.connect(this.master);
    this.ambBus = c.createGain(); this.ambBus.connect(this.master);
    this.applyVolumes();
    // Gürültü tamponu (patlama/vuruş efektleri)
    const len = c.sampleRate * 0.5;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Yağmur için daha uzun, pembe-ish gürültü (döngü fark edilmesin)
    const rlen = c.sampleRate * 2.5;
    this.rainBuf = c.createBuffer(1, rlen, c.sampleRate);
    const rd = this.rainBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < rlen; i++) { last = last * 0.6 + (Math.random() * 2 - 1) * 0.4; rd[i] = last * 1.6; }
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 50);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // Ses seviyeleri (0..1 çarpanlar)
  setVolumes(v) {
    Object.assign(this.vol, v || {});
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(0.8 * this.vol.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(0.22 * this.vol.music, t, 0.05);
    this.ambBus.gain.setTargetAtTime(0.55 * this.vol.amb, t, 0.05);
  }

  tone({ type = 'square', freq = 440, to = null, dur = 0.1, vol = 0.3, delay = 0, bus = null, attack = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + Math.max(0, delay);
    const p = bus ? 1 : this.pitch;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq * p, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to * p), t + dur);
    if (attack > 0) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); }
    else g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(bus || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise({ dur = 0.15, vol = 0.3, freq = 1200, delay = 0, type = 'lowpass', bus = null, attack = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + Math.max(0, delay);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = dur > 0.45;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    if (attack > 0) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); }
    else g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus || this.sfxBus);
    src.start(t); src.stop(t + dur + 0.02);
  }

  sfx(name) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    const th = THROTTLE[name];
    if (th && now - (this.last[name] || 0) < th) return;
    this.last[name] = now;
    this.pitch = VARY.has(name) ? 0.93 + Math.random() * 0.14 : 1;
    switch (name) {
      case 'click':   this.tone({ freq: 880, dur: 0.05, vol: 0.15 }); break;
      case 'till':    this.noise({ dur: 0.12, vol: 0.35, freq: 600 }); this.tone({ type: 'triangle', freq: 180, to: 90, dur: 0.1, vol: 0.3 }); break;
      case 'plant':   this.tone({ type: 'triangle', freq: 520, to: 780, dur: 0.12, vol: 0.25 }); break;
      case 'water':   this.noise({ dur: 0.3, vol: 0.2, freq: 2500 }); this.tone({ type: 'sine', freq: 900, to: 500, dur: 0.2, vol: 0.12 }); break;
      case 'harvest': [660, 880, 1320].forEach((f, i) => this.tone({ freq: f, dur: 0.08, vol: 0.2, delay: i * 0.06 })); break;
      case 'chop':    this.noise({ dur: 0.08, vol: 0.4, freq: 900 }); this.tone({ type: 'square', freq: 140, to: 70, dur: 0.08, vol: 0.25 }); break;
      case 'mine':    this.tone({ type: 'square', freq: 1400, to: 900, dur: 0.06, vol: 0.2 }); this.noise({ dur: 0.06, vol: 0.3, freq: 3000 }); break;
      case 'swing':   this.noise({ dur: 0.1, vol: 0.2, freq: 4000 }); break;
      case 'hit':     this.tone({ type: 'square', freq: 220, to: 60, dur: 0.12, vol: 0.3 }); this.noise({ dur: 0.08, vol: 0.3, freq: 1500 }); break;
      case 'crit':    this.tone({ type: 'square', freq: 1600, to: 2400, dur: 0.07, vol: 0.18 }); this.tone({ type: 'square', freq: 180, to: 50, dur: 0.16, vol: 0.32 }); this.noise({ dur: 0.12, vol: 0.35, freq: 2500 }); break;
      case 'shoot':   this.noise({ dur: 0.12, vol: 0.4, freq: 5000 }); this.tone({ type: 'square', freq: 900, to: 120, dur: 0.1, vol: 0.2 }); break;
      case 'shotgun': this.noise({ dur: 0.25, vol: 0.55, freq: 2200 }); this.tone({ type: 'square', freq: 300, to: 50, dur: 0.18, vol: 0.3 }); break;
      case 'bow':     this.tone({ type: 'triangle', freq: 300, to: 900, dur: 0.08, vol: 0.2 }); this.noise({ dur: 0.1, vol: 0.15, freq: 5000, type: 'highpass' }); break;
      case 'reload':  this.tone({ type: 'square', freq: 1200, dur: 0.03, vol: 0.12 }); this.tone({ type: 'square', freq: 800, dur: 0.04, vol: 0.12, delay: 0.12 }); break;
      case 'turret':  this.tone({ type: 'square', freq: 1200, to: 300, dur: 0.06, vol: 0.12 }); break;
      case 'hurt':    this.tone({ type: 'sawtooth', freq: 300, to: 80, dur: 0.25, vol: 0.3 }); break;
      case 'die':     this.tone({ type: 'sawtooth', freq: 400, to: 40, dur: 0.6, vol: 0.3 }); break;
      case 'zdie':    this.noise({ dur: 0.25, vol: 0.3, freq: 800 }); this.tone({ type: 'sawtooth', freq: 160, to: 50, dur: 0.3, vol: 0.2 }); break;
      case 'groan':   this.tone({ type: 'sawtooth', freq: 90 + Math.random() * 30, to: 60, dur: 0.6, vol: 0.12 }); break;
      case 'explode': this.noise({ dur: 0.6, vol: 0.6, freq: 700 }); this.tone({ type: 'sine', freq: 120, to: 30, dur: 0.5, vol: 0.5 }); break;
      case 'coin':    this.tone({ freq: 988, dur: 0.06, vol: 0.2 }); this.tone({ freq: 1319, dur: 0.15, vol: 0.2, delay: 0.06 }); break;
      case 'pop':     this.tone({ type: 'sine', freq: 600, to: 1300, dur: 0.07, vol: 0.22 }); break;
      case 'craft':   [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'triangle', freq: f, dur: 0.1, vol: 0.2, delay: i * 0.05 })); break;
      case 'place':   this.tone({ type: 'square', freq: 200, to: 120, dur: 0.1, vol: 0.25 }); this.noise({ dur: 0.1, vol: 0.2, freq: 700 }); break;
      case 'break':   this.noise({ dur: 0.3, vol: 0.4, freq: 1200 }); this.tone({ type: 'square', freq: 160, to: 40, dur: 0.25, vol: 0.25 }); break;
      case 'eat':     [0, 0.1, 0.2].forEach((d) => this.noise({ dur: 0.06, vol: 0.25, freq: 1800, delay: d })); break;
      case 'quest':   [523, 659, 784, 659, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.12, vol: 0.2, delay: i * 0.09 })); break;
      case 'levelup': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone({ type: 'square', freq: f, dur: 0.14, vol: 0.16, delay: i * 0.07 })); this.tone({ type: 'triangle', freq: 1047, dur: 0.5, vol: 0.2, delay: 0.35 }); break;
      case 'achievement': [784, 988, 1175, 1568].forEach((f, i) => this.tone({ type: 'triangle', freq: f, dur: 0.18, vol: 0.2, delay: i * 0.08 })); break;
      case 'error':   this.tone({ freq: 160, dur: 0.15, vol: 0.2 }); break;
      case 'alarm':   for (let i = 0; i < 4; i++) this.tone({ type: 'sawtooth', freq: 440, to: 880, dur: 0.25, vol: 0.18, delay: i * 0.3 }); break;
      case 'drum':    // dalga başı savaş davulu
        [0, 0.22, 0.44, 0.78].forEach((d, i) => {
          this.tone({ type: 'sine', freq: i === 3 ? 90 : 120, to: 38, dur: 0.35, vol: 0.55, delay: d });
          this.noise({ dur: 0.1, vol: 0.25, freq: 400, delay: d });
        });
        break;
      case 'heartbeat': this.tone({ type: 'sine', freq: 70, to: 40, dur: 0.12, vol: 0.4 }); this.tone({ type: 'sine', freq: 62, to: 38, dur: 0.14, vol: 0.32, delay: 0.18 }); break;
      case 'thunder': this.noise({ dur: 1.6, vol: 0.5, freq: 300, attack: 0.05 }); this.noise({ dur: 0.25, vol: 0.35, freq: 1800 }); break;
      case 'splash':  this.noise({ dur: 0.25, vol: 0.25, freq: 3000, type: 'bandpass' }); this.tone({ type: 'sine', freq: 500, to: 200, dur: 0.15, vol: 0.12 }); break;
      case 'whoosh':  this.noise({ dur: 0.2, vol: 0.22, freq: 1800, type: 'bandpass', attack: 0.05 }); break;
      case 'roll':    this.noise({ dur: 0.18, vol: 0.2, freq: 900, attack: 0.03 }); break;
      case 'step':    this.noise({ dur: 0.04, vol: 0.06, freq: 700 }); break;
      case 'dawn':    [392, 523, 659, 784].forEach((f, i) => this.tone({ type: 'triangle', freq: f, dur: 0.3, vol: 0.2, delay: i * 0.12 })); break;
      case 'save':    this.tone({ type: 'triangle', freq: 660, dur: 0.08, vol: 0.15 }); this.tone({ type: 'triangle', freq: 990, dur: 0.12, vol: 0.15, delay: 0.08 }); break;
    }
    this.pitch = 1;
  }

  // ---- Müzik: lookahead zamanlayıcı ----
  setMusic(mode) {
    if (!this.ctx || this.mode === mode) return;
    this.mode = mode;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    const list = SONGS[mode];
    if (list) {
      // Her girişte bir sonraki parçaya geç (çeşitlilik)
      this.song = list[this.songIdx[mode] % list.length];
      this.songIdx[mode]++;
    } else this.song = null;
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 50);
  }

  // 0..1: gece katman/tempo artışı
  setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v || 0)); }

  get songName() { return this.song?.name || ''; }

  schedule() {
    if (!this.ctx) return;
    this.scheduleAmbient();
    const song = this.song;
    if (!this.mode || !song) return;
    const night = this.mode === 'night';
    if (!this.curInt) this.curInt = 0;
    this.curInt += (this.intensity - this.curInt) * 0.05; // yumuşak geçiş
    const I = night ? this.curInt : 0;
    const stepDur = 60 / (song.bpm * (1 + 0.18 * I)) / 2; // 8'lik notalar
    const L = song.lead.length;
    // Geride kaldıysak (sekme arka plandaydı) atla
    if (this.nextTime < this.ctx.currentTime - 0.3) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + 0.2) {
      const dl = this.nextTime - this.ctx.currentTime;
      const s = this.step;
      const n = song.lead[s % L];
      if (n) this.tone({ type: song.leadType, freq: NOTE(n), dur: stepDur * 0.9, vol: song.leadVol, bus: this.musicBus, delay: dl });
      if (s % 2 === 0) {
        const b = song.bass[(s / 2) % song.bass.length];
        this.tone({ type: 'triangle', freq: NOTE(b), dur: stepDur * 1.8, vol: 0.35, bus: this.musicBus, delay: dl });
        if (I > 0.7) this.tone({ type: 'square', freq: NOTE(b + 12), dur: stepDur * 0.5, vol: 0.05, bus: this.musicBus, delay: dl });
      }
      // Gündüz arpej katmanı
      if (song.arp && s % 2 === 1) {
        const b = song.bass[((s - 1) / 2) % song.bass.length];
        const ar = [12, 16, 19, 24][(s >> 1) % 4];
        this.tone({ type: 'triangle', freq: NOTE(b + ar), dur: stepDur * 0.6, vol: 0.08, bus: this.musicBus, delay: dl });
      }
      if (song.hats && s % 4 === 2) this.noiseHat(this.nextTime, 0.15);
      if (night) {
        if (I > 0.2 && s % 4 === 0) this.kick(this.nextTime);
        if (I > 0.45 && s % 8 === 4) this.snare(this.nextTime);
        if (I > 0.65 && s % 2 === 1) this.noiseHat(this.nextTime, 0.07);
      }
      this.nextTime += stepDur;
      this.step++;
      // Parça değişimi
      if (this.step >= L * LOOPS_PER_SONG) {
        this.step = 0;
        const list = SONGS[this.mode];
        if (list && list.length > 1) { this.song = list[this.songIdx[this.mode] % list.length]; this.songIdx[this.mode]++; return; }
      }
    }
  }

  noiseHat(time, vol = 0.15) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    src.connect(f); f.connect(g); g.connect(this.musicBus);
    src.start(time); src.stop(time + 0.06);
  }

  kick(time) {
    const dl = time - this.ctx.currentTime;
    this.tone({ type: 'sine', freq: 140, to: 42, dur: 0.14, vol: 0.55, bus: this.musicBus, delay: dl });
  }

  snare(time) {
    const dl = time - this.ctx.currentTime;
    this.noise({ dur: 0.12, vol: 0.28, freq: 1800, type: 'highpass', bus: this.musicBus, delay: dl });
    this.tone({ type: 'triangle', freq: 210, to: 120, dur: 0.08, vol: 0.2, bus: this.musicBus, delay: dl });
  }

  // ---- Ortam sesleri ----
  // { day, night, rain: 0..1 } — null tümünü kapatır
  setAmbient(a) {
    if (!a) a = { day: false, night: false, rain: 0 };
    Object.assign(this.amb, a);
    if (!this.ctx) return;
    this.updateRain();
  }

  updateRain() {
    const target = this.amb.rain || 0;
    const t = this.ctx.currentTime;
    if (target > 0 && !this.rainSrc) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.rainBuf; src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.5;
      const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
      const g = this.ctx.createGain(); g.gain.value = 0.0001;
      src.connect(hp); hp.connect(f); f.connect(g); g.connect(this.ambBus);
      src.start();
      this.rainSrc = src; this.rainGain = g;
    }
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(Math.max(0.0001, target * 0.5), t, 0.8);
    if (target <= 0 && this.rainSrc) {
      const src = this.rainSrc;
      this.rainSrc = null; this.rainGain = null;
      setTimeout(() => { try { src.stop(); } catch { /* zaten durmuş */ } }, 3000);
    }
  }

  scheduleAmbient() {
    if (this.muted || document.hidden) return;
    const t = this.ctx.currentTime;
    const a = this.amb;
    // Gündüz kuşları (yağmurda daha seyrek)
    if (a.day) {
      if (!this.nextBird) this.nextBird = t + 2 + Math.random() * 3;
      if (t >= this.nextBird) {
        this.bird();
        this.nextBird = t + (4 + Math.random() * 5) * (a.rain > 0 ? 2.5 : 1);
      }
    } else this.nextBird = 0;
    // Gece cırcır böcekleri + nadiren baykuş
    if (a.night) {
      if (!this.nextCricket) this.nextCricket = t + 0.5;
      if (t >= this.nextCricket) {
        this.cricket(this.nextCricket);
        this.nextCricket += 0.9 + Math.random() * 0.6;
        if (this.nextCricket < t) this.nextCricket = t + 0.5;
      }
      if (!this.nextOwl) this.nextOwl = t + 20 + Math.random() * 25;
      if (t >= this.nextOwl) { this.owl(); this.nextOwl = t + 25 + Math.random() * 35; }
    } else { this.nextCricket = 0; this.nextOwl = 0; }
  }

  bird() {
    const base = 2200 + Math.random() * 1600;
    const notes = 2 + ((Math.random() * 4) | 0);
    for (let i = 0; i < notes; i++) {
      const f = base * (0.85 + Math.random() * 0.35);
      this.tone({ type: 'sine', freq: f, to: f * (Math.random() < 0.5 ? 1.35 : 0.75), dur: 0.07 + Math.random() * 0.05, vol: 0.05, delay: i * (0.09 + Math.random() * 0.05), bus: this.ambBus, attack: 0.01 });
    }
  }

  cricket(time) {
    const dl = Math.max(0, time - this.ctx.currentTime);
    const f = 4300 + Math.random() * 500;
    const pulses = 3 + ((Math.random() * 2) | 0);
    for (let i = 0; i < pulses; i++) this.tone({ type: 'sine', freq: f, dur: 0.03, vol: 0.022, delay: dl + i * 0.05, bus: this.ambBus, attack: 0.005 });
  }

  owl() {
    this.tone({ type: 'sine', freq: 420, to: 380, dur: 0.35, vol: 0.06, bus: this.ambBus, attack: 0.08 });
    this.tone({ type: 'sine', freq: 400, to: 340, dur: 0.5, vol: 0.05, delay: 0.5, bus: this.ambBus, attack: 0.1 });
  }
}

export const audio = new AudioEngine();
