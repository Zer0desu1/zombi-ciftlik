// Web Audio API ile retro 8-bit efektler ve prosedürel chiptune müzik.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz

// Gündüz: neşeli majör, Gece: gergin minör (MIDI notaları, 0 = sus)
const SONGS = {
  day: {
    bpm: 112,
    lead: [72, 0, 76, 79, 77, 76, 74, 0, 72, 74, 76, 0, 79, 77, 76, 74, 72, 0, 69, 72, 74, 72, 69, 67, 69, 72, 74, 76, 74, 0, 72, 0],
    bass: [48, 48, 55, 55, 53, 53, 50, 50, 48, 48, 55, 55, 53, 53, 55, 55]
  },
  night: {
    bpm: 132,
    lead: [69, 0, 0, 72, 0, 71, 69, 0, 64, 0, 0, 65, 64, 0, 62, 0, 69, 0, 0, 72, 0, 74, 76, 0, 77, 76, 74, 72, 71, 0, 68, 0],
    bass: [45, 45, 45, 45, 41, 41, 41, 41, 43, 43, 43, 43, 40, 40, 44, 44]
  }
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.mode = null;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
  }

  // Tarayıcılar ses için kullanıcı etkileşimi ister
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 0.8; this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.22; this.musicBus.connect(this.master);
    // Gürültü tamponu (patlama/vuruş efektleri)
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  tone({ type = 'square', freq = 440, to = null, dur = 0.1, vol = 0.3, delay = 0, bus = null }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(bus || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise({ dur = 0.15, vol = 0.3, freq = 1200, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t); src.stop(t + dur);
  }

  sfx(name) {
    if (!this.ctx || this.muted) return;
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
      case 'shoot':   this.noise({ dur: 0.12, vol: 0.4, freq: 5000 }); this.tone({ type: 'square', freq: 900, to: 120, dur: 0.1, vol: 0.2 }); break;
      case 'turret':  this.tone({ type: 'square', freq: 1200, to: 300, dur: 0.06, vol: 0.12 }); break;
      case 'hurt':    this.tone({ type: 'sawtooth', freq: 300, to: 80, dur: 0.25, vol: 0.3 }); break;
      case 'die':     this.tone({ type: 'sawtooth', freq: 400, to: 40, dur: 0.6, vol: 0.3 }); break;
      case 'zdie':    this.noise({ dur: 0.25, vol: 0.3, freq: 800 }); this.tone({ type: 'sawtooth', freq: 160, to: 50, dur: 0.3, vol: 0.2 }); break;
      case 'groan':   this.tone({ type: 'sawtooth', freq: 90 + Math.random() * 30, to: 60, dur: 0.6, vol: 0.12 }); break;
      case 'coin':    this.tone({ freq: 988, dur: 0.06, vol: 0.2 }); this.tone({ freq: 1319, dur: 0.15, vol: 0.2, delay: 0.06 }); break;
      case 'craft':   [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'triangle', freq: f, dur: 0.1, vol: 0.2, delay: i * 0.05 })); break;
      case 'place':   this.tone({ type: 'square', freq: 200, to: 120, dur: 0.1, vol: 0.25 }); this.noise({ dur: 0.1, vol: 0.2, freq: 700 }); break;
      case 'eat':     [0, 0.1, 0.2].forEach((d) => this.noise({ dur: 0.06, vol: 0.25, freq: 1800, delay: d })); break;
      case 'quest':   [523, 659, 784, 659, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.12, vol: 0.2, delay: i * 0.09 })); break;
      case 'error':   this.tone({ freq: 160, dur: 0.15, vol: 0.2 }); break;
      case 'alarm':   for (let i = 0; i < 4; i++) this.tone({ type: 'sawtooth', freq: 440, to: 880, dur: 0.25, vol: 0.18, delay: i * 0.3 }); break;
      case 'dawn':    [392, 523, 659, 784].forEach((f, i) => this.tone({ type: 'triangle', freq: f, dur: 0.3, vol: 0.2, delay: i * 0.12 })); break;
      case 'save':    this.tone({ type: 'triangle', freq: 660, dur: 0.08, vol: 0.15 }); this.tone({ type: 'triangle', freq: 990, dur: 0.12, vol: 0.15, delay: 0.08 }); break;
    }
  }

  // ---- Müzik: lookahead zamanlayıcı ----
  setMusic(mode) {
    if (!this.ctx || this.mode === mode) return;
    this.mode = mode;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 50);
  }

  schedule() {
    if (!this.ctx || !this.mode) return;
    const song = SONGS[this.mode];
    const stepDur = 60 / song.bpm / 2; // 8'lik notalar
    while (this.nextTime < this.ctx.currentTime + 0.2) {
      const n = song.lead[this.step % song.lead.length];
      if (n) this.tone({ type: 'square', freq: NOTE(n), dur: stepDur * 0.9, vol: 0.18, bus: this.musicBus, delay: this.nextTime - this.ctx.currentTime });
      if (this.step % 2 === 0) {
        const b = song.bass[(this.step / 2) % song.bass.length];
        this.tone({ type: 'triangle', freq: NOTE(b), dur: stepDur * 1.8, vol: 0.35, bus: this.musicBus, delay: this.nextTime - this.ctx.currentTime });
      }
      if (this.mode === 'night' && this.step % 4 === 2) this.noiseHat(this.nextTime);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  noiseHat(time) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.15, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    src.connect(f); f.connect(g); g.connect(this.musicBus);
    src.start(time); src.stop(time + 0.06);
  }
}

export const audio = new AudioEngine();
