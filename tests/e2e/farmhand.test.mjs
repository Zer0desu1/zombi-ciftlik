// Çiftçi (hayatta kalan) ve Ayşe: olgun ekini hasat eder, aynı kareye yeniden tohum eker — durumlar elle tetiklenir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, newGame, assertNoErrors } from './_harness.mjs';

test('çiftçi: hasat → yeniden ekim, boş kareye ekim, mevsim kontrolü', { timeout: 60000 }, async (t) => {
  const { page, errors, url } = await setup(t);
  await newGame(page, url);
  await page.waitForTimeout(300);

  const r = await page.evaluate(async () => {
    const s = game.scene.getScene('Game');
    const { Survivor } = await import('/js/entities/NPC.js');
    const { TILE } = await import('/js/config.js');
    const farm = s.farm, inv = s.inventory, d = s.shelter.door;
    s.timeSys.minutes = 10 * 60;
    s.zombies.getChildren().forEach((z) => z.destroy());
    const out = {};

    // Tarlada boş bir kare bul ve sür
    const zone = farm.area();
    let plot = null;
    for (let ty = Math.floor(zone.y / TILE); ty < Math.ceil((zone.y + zone.height) / TILE) + 4 && !plot; ty++) {
      for (let tx = Math.floor(zone.x / TILE); tx < Math.ceil((zone.x + zone.width) / TILE) + 4 && !plot; tx++) {
        if (farm.get(tx, ty)) continue;
        if (farm.till(tx, ty)) plot = farm.get(tx, ty);
      }
    }
    out.tilled = !!plot;
    if (!plot) return out;
    const ripen = (type) => { plot.crop = { type, stage: 3, growth: 0 }; plot.watered = true; farm.refresh(plot); };
    const step = (n, k = 3) => { for (let i = 0; i < k; i++) n.update(0.6); };
    const atPlot = (n) => n.setPosition(plot.tx * TILE + 8, plot.ty * TILE + 4);

    // Ayşe ve diğer çiftçiler karışmasın: oyuncunun tohumlarını sıfırla
    ['seed_wheat', 'seed_carrot', 'seed_pumpkin', 'seed_potato'].forEach((id) => { const c = inv.count(id); if (c) inv.remove(id, c); });
    // Diğer tarla işleri (sulama/başka olgun kare) bu testi etkilemesin
    farm.unwatered = () => [];
    farm.ripe = () => [];
    // Ayşe oyun başında köy dışında bekler (settlement): köye katılmış say
    let ayse = s.npcs.find((n) => n.key === 'farmer');
    if (!ayse) {
      ayse = s.outsiders.find((n) => n.key === 'farmer');
      s.outsiders.splice(s.outsiders.indexOf(ayse), 1);
      ayse.outsider = null;
      s.npcs.push(ayse);
    }
    ayse?.hide();

    const a = new Survivor(s, d.x, d.y + 60, { name: 'Ali', slot: 0, arrived: s.timeSys.day, job: 'waterer' });
    s.npcs.push(a);

    // 1) Buğday: hasattan gelen tohumu (seedBack) aynı kareye eker
    ripen('wheat');
    atPlot(a);
    a.sm.set('harvesting', null); a.plot = plot; a.target = plot;
    step(a, 4);
    // (hasat kalitesi rastgele: normal/gümüş/altın buğday hepsi sayılır — yalnız 'wheat' saymak ara sıra düşen testin kök nedeniydi)
    out.wheat = { state: a.sm.name, crop: plot.crop?.type, stage: plot.crop?.stage, carrySeed: a.carry.seed_wheat || 0, wheat: (a.carry.wheat || 0) + (a.carry.wheat_s || 0) + (a.carry.wheat_g || 0) };

    // 2) Havuç: tohum dönmez, envanterden harcar
    a.carry = {};
    inv.add('seed_carrot', 2);
    ripen('carrot');
    atPlot(a);
    a.sm.set('harvesting', null); a.plot = plot;
    step(a, 4);
    out.carrot = { crop: plot.crop?.type, inv: inv.count('seed_carrot'), carried: (a.carry.carrot || 0) + (a.carry.carrot_s || 0) + (a.carry.carrot_g || 0) };

    // 3) Tohum yoksa kare boş kalır
    a.carry = {};
    inv.remove('seed_carrot', inv.count('seed_carrot'));
    ripen('carrot');
    atPlot(a);
    a.sm.set('harvesting', null); a.plot = plot;
    step(a, 4);
    out.noSeed = { crop: plot.crop, state: a.sm.name };

    // 4) Mevsim dışı tohum ekilmez
    const realIn = farm.inSeason;
    farm.inSeason = (type) => type !== 'pumpkin';
    a.carry = { seed_pumpkin: 1 };
    atPlot(a);
    a.sm.set('tend');
    a.update(0.016);
    out.offSeason = { state: a.sm.name, crop: plot.crop };
    farm.inSeason = realIn;

    // 5) Boş kare + taşınan tohum: tend → goPlant → planting → ekili
    a.carry = { seed_pumpkin: 1 };
    farm.inSeason = () => true;
    atPlot(a);
    a.sm.set('tend');
    a.update(0.016);
    out.goPlant = a.sm.name;
    atPlot(a);
    a.update(0.016);
    out.planting = a.sm.name;
    step(a, 4);
    out.planted = { crop: plot.crop?.type, carry: a.carry.seed_pumpkin || 0 };

    // 6) Çakışma: oyuncu araya girip ektiyse vazgeç
    plot.crop = null; farm.refresh(plot);
    a.carry = { seed_wheat: 1 };
    a.sm.set('goPlant', plot);
    plot.crop = { type: 'carrot', stage: 0, growth: 0 };
    a.update(0.016);
    out.conflict = { state: a.sm.name, crop: plot.crop.type, carry: a.carry.seed_wheat };
    farm.inSeason = realIn;

    // Teslimat: artan tohum oyuncuya gider
    // Teslimat köy sandığına (storage) gider; sandık yoksa/doluysa oyuncuya
    const all = (id) => inv.count(id) + (s.storage?.count(id) || 0);
    const before = all('seed_wheat');
    a.unload();
    out.deliveredSeed = all('seed_wheat') - before;

    // 7) Ayşe de aynı mantığı kullanır
    a.hide(); a.sm.set('sheltered');
    plot.crop = null; farm.refresh(plot);
    ripen('wheat');
    ayse.emerge();
    atPlot(ayse);
    ayse.sm.set('harvesting'); ayse.plot = plot;
    step(ayse, 4);
    out.ayse = { crop: plot.crop?.type, stage: plot.crop?.stage, wheat: Object.keys(ayse.carry).some((k) => k.startsWith('wheat')), states: ['goPlant', 'planting', 'deliver', 'goHarvest'].every((k) => ayse.sm.states[k]) };
    const w = all('wheat') + all('wheat_s') + all('wheat_g');
    ayse.unload();
    out.ayseDelivered = all('wheat') + all('wheat_s') + all('wheat_g') - w;
    return out;
  });

  assert.equal(r.tilled, true, 'kare sürülmeli');
  assert.equal(r.wheat.crop, 'wheat', 'buğday yeniden ekilmeli');
  assert.equal(r.wheat.stage, 0);
  assert.equal(r.wheat.carrySeed, 0, 'hasattan dönen tohum harcanmalı');
  assert.ok(r.wheat.wheat >= 2, 'ürün taşınmalı');
  assert.equal(r.carrot.crop, 'carrot', 'envanterden havuç tohumu ekilmeli');
  assert.equal(r.carrot.inv, 1, 'envanterden 1 tohum düşmeli');
  assert.ok(r.carrot.carried >= 1);
  assert.equal(r.noSeed.crop, null, 'tohum yoksa boş kalır');
  assert.notEqual(r.offSeason.state, 'goPlant', 'mevsim dışı tohum ekilmemeli');
  assert.equal(r.offSeason.crop, null);
  assert.equal(r.goPlant, 'goPlant');
  assert.equal(r.planting, 'planting');
  assert.deepEqual(r.planted, { crop: 'pumpkin', carry: 0 });
  assert.equal(r.conflict.state, 'tend', 'kare doluysa vazgeçmeli');
  assert.equal(r.conflict.crop, 'carrot');
  assert.equal(r.conflict.carry, 1);
  assert.equal(r.deliveredSeed, 1, 'artan tohum sandığa/oyuncuya teslim edilmeli');
  assert.equal(r.ayse.crop, 'wheat', 'Ayşe yeniden ekmeli');
  assert.equal(r.ayse.stage, 0);
  assert.equal(r.ayse.wheat, true, 'Ayşe ürünü taşımalı');
  assert.equal(r.ayse.states, true);
  assert.ok(r.ayseDelivered >= 2, 'Ayşe ürünü teslim etmeli');
  assertNoErrors(assert, errors, 'farmhand');
});
