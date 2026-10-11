import { TILE, MAP_W, MAP_H, FARM_ZONE, CROPS, CROP_STAGES, ITEMS } from '../config.js';
import { Actor } from '../entities/Actor.js';

export const T = { GRASS: 0, GRASS2: 1, GRASS3: 2, PATH: 3, SOIL: 4, WET: 5, FARM: 6, STONE: 7 };

// Mevsim kimlikleri (world özelliği timeSys.season / seasonIndex açığa çıkarırsa kullanılır)
export const SEASON_IDS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_NAMES = { spring: 'İlkbahar', summer: 'Yaz', autumn: 'Sonbahar', winter: 'Kış' };

// Kalite: 0 normal, 1 gümüş, 2 altın → ayrı eşya kimlikleri (wheat, wheat_s, wheat_g)
export const QUALITY_SUFFIX = ['', '_s', '_g'];
export const FERT_GROWTH = 1.35;     // gübreli büyüme çarpanı
const WITHER_DAYS = 2;               // bu kadar gün sulanmayan ekin solar
const DEATH_DAYS = 3;                // bu kadar günde ölür

// Tarla tile'larını, ekinleri ve büyüme mantığını yönetir.
export class Farm {
  constructor(scene, layer) {
    this.scene = scene;
    this.layer = layer;
    // "tx,ty" → { tx, ty, watered, fert, dryDays, crop: { type, stage, growth, harvests?, dead? } | null, sprite, fx }
    this.plots = new Map();
    this.blocked = new Set(); // fıskiye/korkuluk gibi nesnelerin kapladığı tile'lar (sürülemez)
    this.reserved = [];       // başka yapılara ayrılmış alanlar (ör. ağıl) {x,y,w,h} tile
  }

  key(tx, ty) { return `${tx},${ty}`; }
  get(tx, ty) { return this.plots.get(this.key(tx, ty)); }

  // Hazır tarla yok: çimenli, engelsiz her kare sürülebilir (yol, meydan, göl, bina ve ayrılmış alanlar hariç)
  inZone(tx, ty) {
    // Kenardaki 2 karelik orman şeridi (MapBuilder.FOREST_TILES) sürülemez
    if (tx < 2 || ty < 2 || tx >= MAP_W - 2 || ty >= MAP_H - 2) return false;
    if (this.get(tx, ty)) return true;
    const t = this.layer.getTileAt(tx, ty);
    if (!t || !(t.index <= T.GRASS3 || t.index === T.FARM)) return false;
    if (this.reserved.some((r) => tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h)) return false;
    const s = this.scene, x = tx * TILE, y = ty * TILE;
    const tr = new Phaser.Geom.Rectangle(x, y, TILE, TILE);
    if ((s.lakeRects || [s.lakeRect]).some((r) => r && Phaser.Geom.Rectangle.Overlaps(r, tr))) return false;
    // Ağaç, kaya, bina, yapı gibi gövdeler; canlılar ve mermiler engel sayılmaz
    return !s.physics.overlapRect(x + 2, y + 2, TILE - 4, TILE - 4, true, true)
      .some((b) => b.gameObject && !(b.gameObject instanceof Actor) && !s.bullets?.contains(b.gameObject));
  }

  // Komşu karelerden birinde tarla var mı (tarlayı büyütme önerileri için)
  nearPlot(tx, ty) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && this.get(tx + dx, ty + dy)) return true;
    return false;
  }

  // Tarlanın kapladığı alan (NPC'ler burada dolaşır). Tarla yoksa önerilen açık çayır.
  area() {
    if (!this.plots.size) return new Phaser.Geom.Rectangle(FARM_ZONE.x * TILE, FARM_ZONE.y * TILE, FARM_ZONE.w * TILE, FARM_ZONE.h * TILE);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.plots.values()) { x0 = Math.min(x0, p.tx); y0 = Math.min(y0, p.ty); x1 = Math.max(x1, p.tx); y1 = Math.max(y1, p.ty); }
    return new Phaser.Geom.Rectangle(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
  }

  center() {
    const r = this.area();
    return { x: r.centerX, y: r.centerY };
  }

  // Şu anki mevsim kimliği ('spring'...) ya da mevsim sistemi yoksa null
  season() {
    const t = this.scene.timeSys;
    let s = t?.season;
    if (s && typeof s === 'object') s = s.id || s.key || s.name;
    if (s == null && typeof t?.seasonIndex === 'number') s = SEASON_IDS[((t.seasonIndex % 4) + 4) % 4];
    if (typeof s === 'number') s = SEASON_IDS[((s % 4) + 4) % 4];
    if (typeof s !== 'string') return null;
    const l = s.toLowerCase();
    if (SEASON_IDS.includes(l)) return l;
    if (l === 'fall') return 'autumn';
    if (l.includes('lkbahar')) return 'spring';
    if (l.includes('sonbahar')) return 'autumn';
    if (l.startsWith('yaz')) return 'summer';
    if (l.startsWith('k')) return 'winter';
    return null;
  }

  inSeason(type, season = this.season()) {
    const def = CROPS[type];
    return !season || !def?.seasons || def.seasons.includes(season);
  }

  till(tx, ty) {
    if (!this.inZone(tx, ty) || this.get(tx, ty) || this.blocked.has(this.key(tx, ty))) return false;
    const plot = { tx, ty, watered: false, fert: 0, dryDays: 0, crop: null, sprite: null, fx: null };
    this.plots.set(this.key(tx, ty), plot);
    this.scene.clearDecorAt?.(tx, ty);
    this.refresh(plot);
    return true;
  }

  plant(tx, ty, type) {
    const p = this.get(tx, ty);
    if (!p || p.crop || !CROPS[type]) return false;
    if (!this.inSeason(type)) {
      const names = (CROPS[type].seasons || []).map((s) => SEASON_NAMES[s]).join(', ');
      this.scene.hud?.notice(`Mevsimi değil! (${names})`);
      return false;
    }
    p.crop = { type, stage: 0, growth: 0 };
    p.dryDays = 0;
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

  fertilize(tx, ty) {
    const p = this.get(tx, ty);
    if (!p || p.fert || p.crop?.dead) return false;
    p.fert = 1;
    this.refresh(p);
    return true;
  }

  // Olgun ya da kurumuş (temizlenebilir) ekin
  isRipe(tx, ty) {
    const p = this.get(tx, ty);
    return !!(p && p.crop && (p.crop.dead || p.crop.stage >= CROP_STAGES - 1));
  }

  isWithered(p) { return !!(p.crop && !p.crop.dead && !p.watered && p.dryDays >= WITHER_DAYS); }

  rollQuality(fert) {
    const r = Math.random();
    const gold = fert ? 0.15 : 0.05, silver = fert ? 0.35 : 0.2;
    if (r < gold) return 2;
    if (r < gold + silver) return 1;
    return 0;
  }

  harvest(tx, ty) {
    const p = this.get(tx, ty);
    if (!this.isRipe(tx, ty)) return null;
    // Kurumuş ekin: sadece temizlenir
    if (p.crop.dead) { this.clearDead(p); return null; }
    const def = CROPS[p.crop.type];
    const qty = Phaser.Math.Between(def.yield[0], def.yield[1]);
    const quality = this.rollQuality(p.fert);
    const qid = def.item + QUALITY_SUFFIX[quality];
    const item = ITEMS[qid] ? qid : def.item;
    const result = { item, qty, quality: ITEMS[qid] ? quality : 0, seed: def.seedBack ? `seed_${p.crop.type}` : null, seedQty: def.seedBack };
    const type = p.crop.type;
    if (def.regrow) {
      // Çoklu hasat: bir önceki aşamaya döner, tekrar büyür
      p.crop.stage = Math.max(1, CROP_STAGES - 2);
      p.crop.growth = 0;
      p.crop.harvests = (p.crop.harvests || 0) + 1;
    } else {
      p.crop = null;
      p.fert = 0;
    }
    this.refresh(p);
    this.scene.events.emit('cropHarvested', { tx, ty, x: tx * TILE + 8, y: ty * TILE + 8, type, item, qty, quality: result.quality });
    return result;
  }

  clearDead(p) {
    if (!p?.crop?.dead) return false;
    p.crop = null;
    p.fert = 0;
    p.dryDays = 0;
    this.refresh(p);
    this.scene.spawnParticles?.(p.tx * TILE + 8, p.ty * TILE + 10, 0x9a8a5a, 6);
    return true;
  }

  // Sulanmış ekinleri büyüt (oyun dakikası)
  advance(minutes) {
    const season = this.season();
    for (const p of this.plots.values()) {
      const c = p.crop;
      if (!c || c.dead || !p.watered || c.stage >= CROP_STAGES - 1) continue;
      if (!this.inSeason(c.type, season)) continue; // mevsim dışı: büyüme durur
      c.growth += minutes * (p.fert ? FERT_GROWTH : 1);
      const def = CROPS[c.type];
      // Çoklu hasatta yeniden büyüme kendi süresini kullanabilir
      const hours = c.harvests && def.regrowHours ? def.regrowHours : def.hoursPerStage;
      const need = hours * 60;
      let grew = false;
      while (c.growth >= need && c.stage < CROP_STAGES - 1) {
        c.growth -= need;
        c.stage++;
        grew = true;
      }
      if (grew) {
        this.refresh(p);
        this.scene.events.emit('cropGrew', p);
      }
    }
  }

  // Şafakta: kuraklık sayacı, solma/ölüm, toprak kurur; boş ve sulanmamış toprak bazen çimlenir
  onDawn() {
    let died = 0;
    for (const p of [...this.plots.values()]) {
      if (!p.crop && !p.watered && !p.fert && Math.random() < 0.15) {
        this.removePlot(p);
        continue;
      }
      const c = p.crop;
      if (c && !c.dead) {
        const ripe = c.stage >= CROP_STAGES - 1;
        if (p.watered || ripe) p.dryDays = 0;
        else {
          p.dryDays = (p.dryDays || 0) + 1;
          if (p.dryDays >= DEATH_DAYS) { c.dead = true; died++; }
        }
      }
      p.watered = false;
      this.refresh(p);
    }
    if (died) this.scene.events.emit('cropsDied', died);
    return died;
  }

  removePlot(p) {
    p.sprite?.destroy();
    p.fx?.destroy();
    this.plots.delete(this.key(p.tx, p.ty));
    this.layer.putTileAt(T.GRASS, p.tx, p.ty);
  }

  // Çiftçi NPC için: sulanmamış (canlı) ekinler
  unwatered() {
    return [...this.plots.values()].filter((p) => p.crop && !p.crop.dead && !p.watered);
  }

  ripe() {
    return [...this.plots.values()].filter((p) => p.crop && !p.crop.dead && p.crop.stage >= CROP_STAGES - 1);
  }

  refresh(p) {
    this.layer.putTileAt(p.watered ? T.WET : T.SOIL, p.tx, p.ty);
    const x = p.tx * TILE + TILE / 2, y = p.ty * TILE + TILE;
    // Gübre izi (toprağın üstünde küçük noktalar)
    if (p.fert && !p.fx && this.scene.textures.exists('fert_dots')) {
      p.fx = this.scene.add.image(x, y - 8, 'fert_dots').setDepth(1);
    } else if (!p.fert && p.fx) { p.fx.destroy(); p.fx = null; }
    if (p.crop) {
      const key = p.crop.dead ? 'crop_dead' : `crop_${p.crop.type}_${p.crop.stage}`;
      const tex = this.scene.textures.exists(key) ? key : `crop_wheat_${Math.min(p.crop.stage || 0, CROP_STAGES - 1)}`;
      if (!p.sprite) p.sprite = this.scene.add.image(x, y, tex).setOrigin(0.5, 1);
      p.sprite.setTexture(tex).setDepth(y - 4);
      if (this.isWithered(p)) p.sprite.setTint(0xa09a78);
      else p.sprite.clearTint();
    } else if (p.sprite) {
      p.sprite.destroy();
      p.sprite = null;
    }
  }

  serialize() {
    return [...this.plots.values()].map((p) => ({
      tx: p.tx, ty: p.ty, watered: p.watered, fert: p.fert || 0, dryDays: p.dryDays || 0,
      crop: p.crop ? { ...p.crop } : null
    }));
  }

  load(list) {
    for (const p of this.plots.values()) { p.sprite?.destroy(); p.fx?.destroy(); }
    this.plots.clear();
    (list || []).forEach((d) => {
      if (!d || typeof d.tx !== 'number') return;
      // Eski kayıtlar: fert/dryDays yok → 0; bilinmeyen ekin türü → yok say
      let crop = d.crop && CROPS[d.crop.type] ? { ...d.crop } : null;
      if (crop) {
        crop.stage = Math.min(Math.max(0, crop.stage | 0), CROP_STAGES - 1);
        crop.growth = crop.growth || 0;
      }
      const p = { tx: d.tx, ty: d.ty, watered: !!d.watered, fert: d.fert || 0, dryDays: d.dryDays || 0, crop, sprite: null, fx: null };
      this.plots.set(this.key(p.tx, p.ty), p);
      this.scene.clearDecorAt?.(p.tx, p.ty);
      this.refresh(p);
    });
  }
}
