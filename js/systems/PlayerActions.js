import { TILE, ITEMS } from '../config.js';
import { audio } from '../audio.js';
import { Barricade, Turret } from '../entities/Structures.js';
import { depleteResource } from './MapBuilder.js';

export const REACH = 40;

// Fare tıklamasında seçili eşyaya göre ne yapılacağını belirler.
export function useSelected(scene, wx, wy) {
  const p = scene.player;
  if (!p.alive || p.actionCd > 0) return;
  const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
  const cx = tx * TILE + 8, cy = ty * TILE + 8;
  const inReach = Phaser.Math.Distance.Between(p.x, p.y + 4, cx, cy) <= REACH;
  const slot = scene.inventory.slots[scene.selected];
  const item = slot ? ITEMS[slot.id] : null;
  face(p, wx);

  // Olgun ekin her eşyayla hasat edilir
  if (inReach && scene.farm.isRipe(tx, ty)) { harvest(scene, tx, ty); return; }
  if (!item) { melee(scene, wx, wy, 1); return; }
  if (item.onUse) { item.onUse(scene, { wx, wy, tx, ty, cx, cy, inReach, slot }); return; }

  switch (item.type) {
    case 'tool':
      if (slot.id === 'hoe') return till(scene, tx, ty, inReach);
      if (slot.id === 'can') return water(scene, tx, ty, inReach);
      if (slot.id === 'axe' || slot.id === 'pickaxe') return gather(scene, slot.id === 'axe' ? 'tree' : 'rock', wx, wy);
      return;
    case 'seed': return plant(scene, tx, ty, item.crop, slot.id, inReach);
    case 'weapon': return melee(scene, wx, wy, item.dmg, { weapon: slot.id });
    case 'gun': return shoot(scene, wx, wy, item.dmg, slot.id);
    case 'food': return eat(scene, slot.id, item);
    case 'place': return placeStructure(scene, slot.id, cx, cy);
    default: return melee(scene, wx, wy, 1);
  }
}

function face(p, wx) { if (Math.abs(wx - p.x) > 2) p.setFlipX(wx < p.x); }

export function fail(scene, msg) {
  audio.sfx('error');
  if (msg) scene.hud.notice(msg);
}

function till(scene, tx, ty, inReach) {
  if (!inReach) return fail(scene, 'Çok uzak');
  if (!scene.farm.inZone(tx, ty)) return fail(scene, 'Sadece çitle çevrili tarlada sürebilirsin');
  if (scene.farm.get(tx, ty)) return;
  if (!scene.player.useEnergy(2)) return;
  scene.farm.till(tx, ty);
  scene.player.actionCd = 0.25;
  scene.spawnParticles(tx * TILE + 8, ty * TILE + 10, 0x6e4b2e, 6);
  audio.sfx('till');
}

function water(scene, tx, ty, inReach) {
  if (!inReach) return fail(scene, 'Çok uzak');
  const plot = scene.farm.get(tx, ty);
  if (!plot || plot.watered) return;
  if (!scene.player.useEnergy(1)) return;
  scene.farm.water(tx, ty);
  scene.player.actionCd = 0.25;
  scene.spawnParticles(tx * TILE + 8, ty * TILE + 8, 0x7ab0e6, 8);
  audio.sfx('water');
}

function plant(scene, tx, ty, crop, seedId, inReach) {
  if (!inReach) return fail(scene, 'Çok uzak');
  const plot = scene.farm.get(tx, ty);
  if (!plot) return fail(scene, 'Önce çapa ile toprağı sür');
  if (plot.crop) return;
  if (scene.farm.plant(tx, ty, crop)) {
    scene.inventory.remove(seedId, 1);
    scene.player.actionCd = 0.2;
    audio.sfx('plant');
  }
}

function harvest(scene, tx, ty) {
  const r = scene.farm.harvest(tx, ty);
  if (!r) return;
  scene.giveItem(r.item, r.qty);
  if (r.seed && r.seedQty) scene.giveItem(r.seed, r.seedQty);
  scene.spawnParticles(tx * TILE + 8, ty * TILE + 8, 0xe8c867, 10);
  scene.floatText(tx * TILE + 8, ty * TILE, `+${r.qty} ${ITEMS[r.item].name}`, '#ffe08a');
  scene.player.actionCd = 0.2;
  audio.sfx('harvest');
}

function gather(scene, kind, wx, wy) {
  const p = scene.player;
  let target = null, best = 18;
  scene.resources.getChildren().forEach((r) => {
    if (r.kind !== kind || r.depleted) return;
    const baseY = r.y + (kind === 'tree' ? 8 : 2);
    const d = Phaser.Math.Distance.Between(wx, wy, r.x, baseY);
    if (d < best && Phaser.Math.Distance.Between(p.x, p.y, r.x, baseY) < REACH) { best = d; target = r; }
  });
  if (!target) return fail(scene, kind === 'tree' ? 'Yakında ağaç yok' : 'Yakında kaya yok');
  if (!p.useEnergy(2)) return;
  p.actionCd = 0.35;
  target.hits--;
  scene.tweens.add({ targets: target, x: target.x + 1, duration: 40, yoyo: true, repeat: 1 });
  scene.spawnParticles(target.x, target.y + 6, kind === 'tree' ? 0x8a5a3a : 0xa2a6b0, 5);
  audio.sfx(kind === 'tree' ? 'chop' : 'mine');
  if (target.hits <= 0) {
    const item = kind === 'tree' ? 'wood' : 'stone';
    const qty = Phaser.Math.Between(2, 4);
    depleteResource(target);
    scene.giveItem(item, qty);
    scene.floatText(target.x, target.y - 6, `+${qty} ${ITEMS[item].name}`, '#ffffff');
  }
}

// ---------- Savaş yardımcıları (combat özelliği de kullanır) ----------
// Hasar = taban × silah seviyesi çarpanı; kritik şansı scene.combat üzerinden (yoksa %10)
export function rollDamage(scene, weapon, base) {
  const c = scene.combat;
  const mult = c ? c.damageMult(weapon) : 1;
  const crit = Math.random() < (c ? c.critChance() : 0.1);
  const dmg = Math.round(base * mult * (crit ? 2 : 1) * 10) / 10;
  return { dmg, crit };
}

// Hedefe hasar ver + juice/ilerleme için 'combatHit' olayı (crit bilgisiyle)
export function hitTarget(scene, z, dmg, crit, source, weapon) {
  if (!z || z.dead || !z.active) return;
  scene.events.emit('combatHit', { target: z, x: z.x, y: z.y, dmg, crit, weapon, melee: !source?.isShot });
  z.lastHitCrit = crit;
  z.takeDamage(dmg, source || scene.player);
}

// Yakın dövüş: range menzil, cone yarım açı (radyan)
export function melee(scene, wx, wy, dmg, opts = {}) {
  const p = scene.player;
  const { weapon = 'hand', range = 24, cone = 1.3, cd = 0.35, energy = 0.5, fx = 'slash' } = opts;
  p.actionCd = cd;
  p.energy = Math.max(0, p.energy - energy);
  const a = Phaser.Math.Angle.Between(p.x, p.y, wx, wy);
  if (fx === 'thrust') {
    const sx = p.x + Math.cos(a) * 6, sy = p.y + Math.sin(a) * 6;
    const tip = scene.add.image(sx, sy, scene.textures.exists('fx_thrust') ? 'fx_thrust' : 'slash').setRotation(a).setDepth(p.depth + 1);
    scene.tweens.add({ targets: tip, x: p.x + Math.cos(a) * (range - 6), y: p.y + Math.sin(a) * (range - 6), alpha: 0.2, duration: 150, ease: 'Quad.easeOut', onComplete: () => tip.destroy() });
  } else {
    const sx = p.x + Math.cos(a) * 10, sy = p.y + Math.sin(a) * 10;
    const slash = scene.add.image(sx, sy, 'slash').setRotation(a).setDepth(p.depth + 1).setAlpha(0.9);
    scene.tweens.add({ targets: slash, alpha: 0, scale: 1.4, duration: 160, onComplete: () => slash.destroy() });
  }
  audio.sfx('swing');
  let hits = 0;
  scene.zombies.getChildren().slice().forEach((z) => {
    if (z.dead) return;
    const d = Phaser.Math.Distance.Between(p.x, p.y, z.x, z.y);
    const diff = Math.abs(Phaser.Math.Angle.Wrap(Phaser.Math.Angle.Between(p.x, p.y, z.x, z.y) - a));
    if (d < range && diff < cone) {
      const r = rollDamage(scene, weapon, dmg);
      hitTarget(scene, z, r.dmg, r.crit, p, weapon);
      hits++;
    }
  });
  return hits;
}

function shoot(scene, wx, wy, dmg, weapon = 'pistol') {
  const p = scene.player;
  if (!scene.inventory.remove('ammo', 1)) return fail(scene, 'Mermin yok! Üret veya satın al.');
  p.actionCd = 0.3;
  const r = rollDamage(scene, weapon, dmg);
  scene.fireBullet(p.x, p.y - 2, Phaser.Math.Angle.Between(p.x, p.y - 2, wx, wy), r.dmg, 320);
  scene.cameras.main.shake(40, 0.002);
  audio.sfx('shoot');
}

function eat(scene, id, item) {
  const p = scene.player;
  if (p.hp >= p.maxHp && p.energy >= p.maxEnergy) return fail(scene, 'Tokluk hissediyorsun');
  scene.inventory.remove(id, 1);
  p.restore(item.heal || 0, item.energy || 0);
  p.actionCd = 0.4;
  scene.floatText(p.x, p.y - 12, `+${item.heal} ❤  +${item.energy} ⚡`, '#9effa0');
  audio.sfx('eat');
}

export function canPlace(scene, cx, cy) {
  const p = scene.player;
  if (Phaser.Math.Distance.Between(p.x, p.y, cx, cy) > 48) return false;
  const tx = Math.floor(cx / TILE), ty = Math.floor(cy / TILE);
  if (scene.farm.get(tx, ty)) return false;
  const bodies = scene.physics.overlapRect(cx - 7, cy - 7, 14, 14, true, true);
  return bodies.length === 0;
}

function placeStructure(scene, id, cx, cy) {
  if (!canPlace(scene, cx, cy)) return fail(scene, 'Buraya yerleştirilemez');
  scene.inventory.remove(id, 1);
  scene.addStructure(id === 'turret' ? 'turret' : 'barricade', cx, cy);
  scene.player.actionCd = 0.3;
  audio.sfx('place');
}

export function createStructure(scene, kind, x, y, hp) {
  if (kind === 'turret') {
    const t = new Turret(scene, x, y, hp);
    scene.turrets.add(t);
    return t;
  }
  const b = new Barricade(scene, x, y, hp);
  scene.barricades.add(b);
  return b;
}
