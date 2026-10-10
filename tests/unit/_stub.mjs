// Oyun modüllerini Node'da içe aktarabilmek için asgari tarayıcı/Phaser taklidi.
// Testler bunu oyun modüllerinden ÖNCE import etmeli (ESM importları sırayla değerlendirilir).
import { EventEmitter as NodeEmitter } from 'node:events';

// Her özellik erişiminde yeni bir "hiçlik" döndüren, kalıtılabilir/çağrılabilir vekil.
// Modül seviyesindeki `class X extends Phaser.Physics.Arcade.Sprite` gibi ifadeler bununla çalışır.
function deep() {
  const target = function () {};
  return new Proxy(target, {
    get(t, k) {
      if (k === 'prototype') return t.prototype;
      if (k === Symbol.toPrimitive) return () => 0;
      if (!(k in t)) t[k] = deep();
      return t[k];
    },
    apply: () => deep(),
    construct: (_t, _a, newTarget) => Reflect.construct(function () {}, [], newTarget)
  });
}

class Emitter extends NodeEmitter {
  off(name, fn) { if (fn) this.removeListener(name, fn); else this.removeAllListeners(name); return this; }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const PhaserStub = deep();
Object.assign(PhaserStub, {
  Events: { EventEmitter: Emitter },
  Math: {
    Clamp: clamp,
    Between: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
    FloatBetween: (a, b) => a + Math.random() * (b - a),
    Linear: (a, b, t) => a + (b - a) * t,
    DegToRad: (d) => (d * Math.PI) / 180,
    Angle: { Between: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1) },
    Distance: { Between: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1) },
    RND: { pick: (a) => a[Math.floor(Math.random() * a.length)] }
  },
  Utils: { Array: { Shuffle: (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; } } }
});
globalThis.Phaser = PhaserStub;

// Sahte canvas: çizim çağrılarını yutar
export function fakeCanvas() {
  const base = {
    getImageData: (_x, _y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: (s) => ({ width: String(s).length * 6 })
  };
  const ctx = new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => ((t[k] = v), true) });
  return { width: 0, height: 0, style: {}, getContext: () => ctx, toDataURL: () => 'data:,' };
}

class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const el = () => new Proxy({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {} },
  { get: (t, k) => (k in t ? t[k] : () => null) });

if (!globalThis.window) globalThis.window = globalThis;
if (!globalThis.localStorage) globalThis.localStorage = new MemoryStorage();
if (!globalThis.document) {
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : el()),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {},
    body: el(),
    documentElement: el()
  };
}
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.addEventListener ??= () => {};
globalThis.innerWidth ??= 1366;
globalThis.innerHeight ??= 768;

// Doku anahtarlarını kaydeden sahte sahne (textures/anims API'si)
export function fakeScene() {
  const keys = new Set();
  const anims = new Set();
  const frameTex = () => ({ add() {}, getSourceImage: () => fakeCanvas(), refresh() {} });
  const scene = {
    textureKeys: keys,
    animKeys: anims,
    textures: {
      exists: (k) => keys.has(k),
      remove: (k) => keys.delete(k),
      get: () => frameTex(),
      addCanvas: (k) => { keys.add(k); return frameTex(); },
      createCanvas: (k) => { keys.add(k); return { ...frameTex(), context: fakeCanvas().getContext(), canvas: fakeCanvas() }; },
      addSpriteSheet: (k) => { keys.add(k); return frameTex(); },
      addImage: (k) => { keys.add(k); return frameTex(); }
    },
    anims: {
      exists: (k) => anims.has(k),
      create: (cfg) => { anims.add(cfg.key); return {}; },
      generateFrameNumbers: () => []
    },
    make: { graphics: () => graphics(keys) },
    add: { graphics: () => graphics(keys) }
  };
  return scene;
}

function graphics(keys) {
  const g = new Proxy({}, {
    get: (t, k) => {
      if (k === 'generateTexture') return (key) => { keys.add(key); return g; };
      if (k in t) return t[k];
      return () => g;
    }
  });
  return g;
}
