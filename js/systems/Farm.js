import { TILE, FARM_ZONE, CROPS, CROP_STAGES } from '../config.js';

export const T = { GRASS: 0, GRASS2: 1, GRASS3: 2, PATH: 3, SOIL: 4, WET: 5, FARM: 6, STONE: 7 };

// Tarla tile'larını, ekinleri ve büyüme mantığını yönetir.
export class Farm {
  constructor(scene, layer) {
    this.scene = scene;
    this.layer = layer;
    this.plots = new Map(); // "tx,ty" → { tx, ty, watered, crop: { type, stage, growth } | null, sprite }
  }

  key(tx, ty) { return `${tx},${ty}`; }
  get(tx, ty) { return this.plots.get(this.key(tx, ty)); }

  inZone(tx, ty) {
    const z = FARM_ZONE;
    return tx >= z.x && ty >= z.y && tx < z.x + z.w && ty < z.y + z.h;
  }

  till(tx, ty) {
    if (!this.inZone(tx, ty) || this.get(tx, ty)) return false;
    const plot = { tx, ty, watered: false, crop: null, sprite: null };
    this.plots.set(this.key(tx, ty), plot);
    this.refresh(plot);
    return true;
  }

  plant(tx, ty, type) {
    const p = this.get(tx, ty);
    if (!p || p.crop || !CROPS[type]) return false;
    p.crop = { type, stage: 0, growth: 0 };
    this.refresh(p);
    return true;
  }

  water(tx, ty) {
    const p = this.get(tx, ty);
    if (!p || p.watered) return false;
    p.watered = true;
    this.refresh(p);
    return true;
  }

  isRipe(tx, ty) {
    const p = this.get(tx, ty);
    return !!(p && p.crop && p.crop.stage >= CROP_STAGES - 1);
  }

  harvest(tx, ty) {
    const p = this.get(tx, ty);
    if (!this.isRipe(tx, ty)) return null;
    const def = CROPS[p.crop.type];
    const qty = Phaser.Math.Between(def.yield[0], def.yield[1]);
    const result = { item: def.item, qty, seed: def.seedBack ? `seed_${p.crop.type}` : null, seedQty: def.seedBack };
    p.crop = null;
    this.refresh(p);
    return result;
  }

  // Sulanmış ekinleri büyüt (oyun dakikası)
  advance(minutes) {
    for (const p of this.plots.values()) {
      if (!p.crop || !p.watered || p.crop.stage >= CROP_STAGES - 1) continue;
      p.crop.growth += minutes;
      const need = CROPS[p.crop.type].hoursPerStage * 60;
      let grew = false;
      while (p.crop.growth >= need && p.crop.stage < CROP_STAGES - 1) {
        p.crop.growth -= need;
        p.crop.stage++;
        grew = true;
      }
      if (grew) {
        this.refresh(p);
        this.scene.events.emit('cropGrew', p);
      }
    }
  }

  // Şafakta toprak kurur; boş ve sulanmamış toprak bazen çimlenir
  onDawn() {
    for (const p of [...this.plots.values()]) {
      if (!p.crop && !p.watered && Math.random() < 0.15) {
        this.plots.delete(this.key(p.tx, p.ty));
        this.layer.putTileAt(T.FARM, p.tx, p.ty);
        continue;
      }
      p.watered = false;
      this.refresh(p);
    }
  }

  // Çiftçi NPC için: sulanmamış ekinler
  unwatered() {
    return [...this.plots.values()].filter((p) => p.crop && !p.watered);
  }

  ripe() {
    return [...this.plots.values()].filter((p) => p.crop && p.crop.stage >= CROP_STAGES - 1);
  }

  refresh(p) {
    this.layer.putTileAt(p.watered ? T.WET : T.SOIL, p.tx, p.ty);
    if (p.crop) {
      const key = `crop_${p.crop.type}_${p.crop.stage}`;
      const x = p.tx * TILE + TILE / 2, y = p.ty * TILE + TILE;
      if (!p.sprite) p.sprite = this.scene.add.image(x, y, key).setOrigin(0.5, 1);
      p.sprite.setTexture(key).setDepth(y - 4);
    } else if (p.sprite) {
      p.sprite.destroy();
      p.sprite = null;
    }
  }

  serialize() {
    return [...this.plots.values()].map((p) => ({ tx: p.tx, ty: p.ty, watered: p.watered, crop: p.crop ? { ...p.crop } : null }));
  }

  load(list) {
    for (const p of this.plots.values()) p.sprite?.destroy();
    this.plots.clear();
    (list || []).forEach((d) => {
      const p = { tx: d.tx, ty: d.ty, watered: d.watered, crop: d.crop, sprite: null };
      this.plots.set(this.key(p.tx, p.ty), p);
      this.refresh(p);
    });
  }
}
