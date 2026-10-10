import { ITEMS, INV_SIZE, RECIPES, HOTBAR_SIZE } from '../config.js';

const UNSTACKABLE = new Set(['tool', 'weapon', 'gun']);
const MAX_STACK = 99;
// Sıralamada tür önceliği (listede olmayanlar sona)
const TYPE_ORDER = ['tool', 'weapon', 'gun', 'seed', 'crop', 'food', 'material', 'place'];

export class Inventory {
  constructor(size = INV_SIZE) {
    this.slots = new Array(size).fill(null); // { id, count }
    this.listeners = [];
  }

  onChange(fn) { this.listeners.push(fn); }
  emit() { this.listeners.forEach((fn) => fn(this)); }

  count(id) {
    return this.slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0);
  }

  has(cost) {
    return Object.entries(cost).every(([id, n]) => this.count(id) >= n);
  }

  // Eklenemeyen miktarı döndürür (envanter doluysa)
  add(id, n = 1) {
    if (!ITEMS[id]) return n;
    const stackable = !UNSTACKABLE.has(ITEMS[id].type);
    if (stackable) {
      for (const s of this.slots) {
        if (n <= 0) break;
        if (s && s.id === id && s.count < MAX_STACK) {
          const k = Math.min(n, MAX_STACK - s.count);
          s.count += k; n -= k;
        }
      }
    }
    for (let i = 0; i < this.slots.length && n > 0; i++) {
      if (!this.slots[i]) {
        const k = stackable ? Math.min(n, MAX_STACK) : 1;
        this.slots[i] = { id, count: k };
        n -= k;
      }
    }
    this.emit();
    return n;
  }

  remove(id, n = 1) {
    if (this.count(id) < n) return false;
    for (let i = this.slots.length - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const k = Math.min(n, s.count);
        s.count -= k; n -= k;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    this.emit();
    return true;
  }

  removeAt(index, n = 1) {
    const s = this.slots[index];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[index] = null;
    this.emit();
  }

  swap(a, b) {
    [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
    this.emit();
  }

  craft(recipe) {
    if (!this.has(recipe.cost)) return false;
    Object.entries(recipe.cost).forEach(([id, n]) => this.remove(id, n));
    this.add(recipe.out, recipe.qty);
    return true;
  }

  // Çanta genişletme: yalnızca büyütür (içerik asla silinmez)
  resize(size) {
    if (size <= this.slots.length) return false;
    while (this.slots.length < size) this.slots.push(null);
    this.emit();
    return true;
  }

  // Çantayı (varsayılan: hotbar dışı) türe ve ada göre sıralar, yarım yığınları birleştirir
  sort(from = HOTBAR_SIZE) {
    const part = this.slots.slice(from).filter(Boolean);
    const merged = [];
    for (const s of part) {
      const stackable = !UNSTACKABLE.has(ITEMS[s.id]?.type);
      let n = s.count;
      if (stackable) {
        for (const m of merged) {
          if (n <= 0) break;
          if (m.id === s.id && m.count < MAX_STACK) { const k = Math.min(n, MAX_STACK - m.count); m.count += k; n -= k; }
        }
      }
      while (n > 0) { const k = stackable ? Math.min(n, MAX_STACK) : 1; merged.push({ id: s.id, count: k }); n -= k; }
    }
    const rank = (id) => { const i = TYPE_ORDER.indexOf(ITEMS[id]?.type); return i < 0 ? TYPE_ORDER.length : i; };
    merged.sort((a, b) => rank(a.id) - rank(b.id) || (ITEMS[a.id]?.name || a.id).localeCompare(ITEMS[b.id]?.name || b.id, 'tr') || b.count - a.count);
    for (let i = from; i < this.slots.length; i++) this.slots[i] = merged[i - from] || null;
    this.emit();
  }

  static recipes() { return RECIPES; }

  serialize() { return this.slots.map((s) => (s ? { ...s } : null)); }

  load(data) {
    // Genişletilmiş çanta kaydı: kayıttaki boyut daha büyükse büyüt
    const size = Math.max(this.slots.length, Array.isArray(data) ? data.length : 0);
    this.slots = new Array(size).fill(null);
    (data || []).forEach((s, i) => { if (s && ITEMS[s.id] && i < this.slots.length) this.slots[i] = { id: s.id, count: s.count }; });
    this.emit();
  }
}
