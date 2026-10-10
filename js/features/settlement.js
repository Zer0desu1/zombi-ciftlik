// Köye katılım: oyun boş bir köyle başlar. Kasabalılar haritanın dört bir yanında bekler;
// kimini koşulunu karşılayıp davet edersin, kimini etrafını saran zombileri temizleyerek kurtarırsın.
// Katılmamış NPC'ler scene.npcs yerine scene.outsiders listesinde durur: zombiler onları hedeflemez,
// kiler/moral/görev sistemleri onları köylü saymaz.
import { TILE, ITEMS } from '../config.js';
import { audio } from '../audio.js';
import { Survivor } from '../entities/NPC.js';

const RECRUITS = {
  merchant: {
    mode: 'invite', tile: [59, 22], need: { items: { wood: 10 } },
    ask: 'Yolda kaldım… Köyünde bir tezgâh kurmama yardım edersen gelirim. 10 odun yeter. Bu arada burada da alışveriş yapabiliriz.',
    thanks: 'Anlaştık! Tezgâhımı sığınağın yanına kuruyorum.'
  },
  farmer: {
    mode: 'invite', tile: [4, 21], need: { plots: 8 },
    ask: 'Toprağı bilmeyen birinin köyüne gelmem. Önce kendine bir tarla kur (en az 8 kare sürülmüş toprak), sonra konuşuruz.',
    thanks: 'Güzel tarla kurmuşsun! Ekinlerini ben de sularım.'
  },
  doctor: {
    mode: 'invite', tile: [54, 17], need: { coins: 40 },
    ask: 'Ben doktorum ama ilacım bitti. 40 altınla malzeme alabilirim; karşılığında köyünde yaralılara bakarım.',
    thanks: 'Teşekkürler. Sığınağın yanına küçük bir klinik kuracağım.'
  },
  blacksmith: { mode: 'rescue', tile: [55, 33], siege: 4, ask: 'Yardım et! Bu harabede mahsur kaldım, zombiler etrafımı sardı!', thanks: 'Hayatımı kurtardın! Örsümü köyüne taşıyorum.' },
  guard: { mode: 'rescue', tile: [34, 40], siege: 5, ask: 'Mermim bitti, kuşatıldım! Şunları temizlersen köyünü ben korurum.', thanks: 'Borcumu nöbet tutarak ödeyeceğim.' },
  hunter: { mode: 'rescue', tile: [8, 5], siege: 5, ask: 'Ormanda sıkıştım, yayımın ipi koptu! Bana yardım et!', thanks: 'Sağ ol dostum. Avladığım her şey köye gelecek.' }
};
// Gece gelen hayatta kalanların bekleyebileceği yerler (tile)
const STRAY_SPOTS = [[12, 30], [45, 6], [60, 36], [20, 4], [3, 14], [40, 41], [50, 40], [16, 40]];
const SIEGE_TRIGGER = 120;   // oyuncu bu kadar yaklaşınca kuşatma zombileri ortaya çıkar
const TALK_RANGE = 26;

let st = null;

const pos = ([tx, ty]) => ({ x: tx * TILE + 8, y: ty * TILE + 8 });
const isNight = (scene) => scene.waves.active || scene.timeSys.isNight;

function needText(scene, need) {
  if (!need) return '';
  const parts = [];
  if (need.items) Object.entries(need.items).forEach(([id, n]) => parts.push(`${scene.inventory.count(id)}/${n} ${ITEMS[id].name}`));
  if (need.coins) parts.push(`${need.coins}🪙`);
  if (need.plots) parts.push(`${scene.farm.plots.size}/${need.plots} tarla karesi`);
  return parts.join(', ');
}

function needMet(scene, need) {
  if (!need) return true;
  if (need.items && Object.entries(need.items).some(([id, n]) => scene.inventory.count(id) < n)) return false;
  if (need.coins && scene.player.coins < need.coins) return false;
  if (need.plots && scene.farm.plots.size < need.plots) return false;
  return true;
}

function payNeed(scene, need) {
  if (!need) return;
  if (need.items) Object.entries(need.items).forEach(([id, n]) => scene.inventory.remove(id, n));
  if (need.coins) scene.player.addCoins(-need.coins);
}

// NPC'yi köyden çıkarıp haritadaki bekleme yerine koy
function makeOutsider(scene, n, rec) {
  const i = scene.npcs.indexOf(n);
  if (i >= 0) scene.npcs.splice(i, 1);
  if (!scene.outsiders.includes(n)) scene.outsiders.push(n);
  n.outsider = rec;
  n.siege = null;
  n.home = pos(rec.tile);
  n.goal = null;
  n.wait = 0;
  if (n.hidden) { n.hidden = false; n.setVisible(true); n.body.enable = true; }
  n.setPosition(n.home.x, n.home.y);
  n.halt();
}

function join(scene, n) {
  const rec = n.outsider;
  scene.outsiders.splice(scene.outsiders.indexOf(n), 1);
  n.outsider = null;
  n.siege = null;
  n.setActivity('');
  if (n.key === 'survivor') n.arrived = scene.timeSys.day;
  scene.npcs.push(n);
  n.goal = null;
  n.wait = 0;
  n.sm.set(n.workState);
  st.joined++;
  audio.sfx('quest');
  scene.spawnParticles(n.x, n.y - 6, 0xffe08a, 12);
  scene.hud.toast(`🏡 ${n.npcName} köye katıldı! (${rec?.thanks ? n.role : 'Hayatta kalan'})`, 'ok');
  scene.events.emit('npcJoined', n);
}

// Kuşatma: oyuncu yaklaşınca NPC'nin çevresinde zombiler belirir; hepsi ölünce NPC kurtulur
function startSiege(scene, n) {
  const day = scene.timeSys.day;
  const count = (n.outsider.siege || 3) + Math.min(4, Math.floor(day / 3));
  const list = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const r = Phaser.Math.Between(34, 56);
    const kind = day >= 4 && i === 0 ? 'runner' : 'normal';
    list.push(scene.spawnZombie(n.x + Math.cos(a) * r, n.y + Math.sin(a) * r, kind));
  }
  n.siege = list;
  scene.hud.toast(`❗ ${n.npcName} zombilerle kuşatılmış! ${count} zombiyi temizle.`, 'warn');
  audio.sfx('alarm');
}

function updateOutsider(scene, n, dt) {
  const rec = n.outsider;
  // Çok oyunculu: kuşatmayı en yakın oyuncu (host ya da misafir) tetikler
  const np = scene.nearestPlayer ? scene.nearestPlayer(n.x, n.y) : null;
  const p = np ? np.p : scene.player;
  const dp = Phaser.Math.Distance.Between(p.x, p.y, n.x, n.y);
  if (rec.mode === 'rescue') {
    if (n.siege) {
      n.halt();
      n.setActivity('😱');
      if (n.siege.every((z) => !z.active || z.dead)) join(scene, n);
      return;
    }
    if (!isNight(scene) && p.alive && dp < SIEGE_TRIGGER) { startSiege(scene, n); return; }
  }
  // Gündüz bekleme yerinin çevresinde dolaşır, gece saklanır gibi yerinde durur
  if (isNight(scene)) { n.halt(); n.setActivity('🌙'); return; }
  n.setActivity(rec.mode === 'rescue' ? '❗' : needMet(scene, rec.need) ? '✅' : '💬');
  if (dp < 40) { n.halt(); if (Math.abs(p.x - n.x) > 2) n.setFlipX(p.x < n.x); return; }
  if (n.wait > 0) { n.wait -= dt; n.halt(); return; }
  if (!n.goal) n.goal = { x: n.home.x + Phaser.Math.Between(-18, 18), y: n.home.y + Phaser.Math.Between(-10, 10) };
  if (n.goTo(n.goal.x, n.goal.y)) { n.goal = null; n.wait = Phaser.Math.FloatBetween(2, 5); }
}

// ---------------- Diyalog ----------------
function outsiderText(scene, n) {
  const rec = n.outsider;
  if (rec.mode === 'rescue') {
    if (n.siege) return 'Önce şu zombileri temizle!';
    return isNight(scene) ? 'Gece buradan çıkamam… Sabah gel, beni kurtar!' : rec.ask;
  }
  return `${rec.ask}${rec.need ? ` (${needText(scene, rec.need)})` : ''}`;
}

function outsiderOptions(scene, n) {
  const hud = scene.hud, rec = n.outsider, opts = [];
  if (rec.mode === 'invite') {
    const ok = needMet(scene, rec.need);
    opts.push([`🏡 Köye davet et${rec.need ? ` (${needText(scene, rec.need)})` : ''}`, () => {
      if (!needMet(scene, rec.need)) { audio.sfx('error'); hud.renderDialog(`Henüz değil. Gereken: ${needText(scene, rec.need)}`, [['Tamam', () => hud.closeAll(), 'ghost']]); return; }
      payNeed(scene, rec.need);
      const thanks = rec.thanks || 'Teşekkürler! Hemen köye geliyorum.';
      join(scene, n);
      hud.renderDialog(thanks, [['Hoşça kal', () => hud.closeAll(), 'ghost']]);
    }, ok ? 'primary' : '']);
  }
  if (n.shop && rec.mode === 'invite') opts.push(['🛒 Ticaret', () => hud.openShop(n)]);
  opts.push(['Hoşça kal', () => hud.closeAll(), 'ghost']);
  return opts;
}

function patchDialog(scene) {
  const hud = scene.hud;
  const prev = hud.renderDialog.bind(hud);
  hud.renderDialog = (text, custom) => {
    const n = hud.npc;
    if (!n?.outsider) { prev(text, custom); return; }
    prev(custom ? text : outsiderText(scene, n), custom || outsiderOptions(scene, n));
    const role = hud.e.dialog.querySelector('.npc-role');
    if (role) role.textContent = `${n.role} · ${n.outsider.mode === 'rescue' ? 'kurtarılmayı bekliyor' : 'köye davet bekliyor'}`;
  };
}

function interaction(scene) {
  const p = scene.player;
  let best = null, bd = TALK_RANGE;
  for (const n of scene.outsiders) {
    const d = Phaser.Math.Distance.Between(p.x, p.y, n.x, n.y);
    if (d < bd) { bd = d; best = n; }
  }
  if (!best) return null;
  const n = best;
  return { dist: bd, label: `${n.npcName} ile konuş`, run: () => scene.talkTo(n) };
}

// Gece gelen hayatta kalan (town modülü) köye doğrudan girmez, haritada bir yerde bekler
function strand(scene, s, data = {}) {
  const taken = new Set(scene.outsiders.map((o) => `${o.home?.x},${o.home?.y}`));
  const free = STRAY_SPOTS.filter((t) => !taken.has(`${pos(t).x},${pos(t).y}`));
  const tile = data.tile || Phaser.Utils.Array.GetRandom(free.length ? free : STRAY_SPOTS);
  const mode = data.mode || (Math.random() < 0.5 ? 'rescue' : 'invite');
  const rec = mode === 'rescue'
    ? { mode, tile, siege: 3, ask: 'Yardım et! Zombiler beni buraya sıkıştırdı!', thanks: 'Kurtardın beni! Köyünde işe yararım.' }
    : { mode, tile, ask: 'Yorgunum, aç kaldım… Köyünde bana yer var mı?', thanks: 'Sağ ol! Köyde konuşup bana iş verebilirsin.' };
  makeOutsider(scene, s, rec);
  return rec;
}

export default {
  id: 'settlement',

  init(scene) {
    st = { joined: 0, data: null };
    scene.outsiders = [];
    scene.settlement = {
      strand: (s, data) => strand(scene, s, data), // data: { tile:[tx,ty], mode:'rescue'|'invite' } (isteğe bağlı)
      strays: () => scene.outsiders.filter((n) => n.key === 'survivor').length,
      joinedCount: () => st.joined,
      nearestOutsider: () => {
        let best = null, bd = Infinity;
        for (const n of scene.outsiders) {
          const d = Phaser.Math.Distance.Squared(scene.player.x, scene.player.y, n.x, n.y);
          if (d < bd) { bd = d; best = n; }
        }
        return best;
      }
    };
    patchDialog(scene);
    scene.addInteraction(interaction);
  },

  begin(scene, isNew) {
    const d = st.data;
    if (!isNew && !d) { st.joined = Object.keys(RECRUITS).length; return; } // eski kayıt: herkes zaten köyde
    const joined = new Set(isNew ? [] : d.joined || []);
    for (const [key, rec] of Object.entries(RECRUITS)) {
      const n = scene.npcs.find((o) => o.key === key);
      if (n && !joined.has(key)) makeOutsider(scene, n, rec);
    }
    st.joined = isNew ? 0 : d.count ?? joined.size;
    if (!isNew) {
      (d.strays || []).forEach((o) => {
        if (!o?.name) return;
        const s = new Survivor(scene, 0, 0, { name: o.name, gender: o.gender, variant: o.variant || 0, job: null, arrived: o.arrived || 1, slot: o.slot || 0 });
        strand(scene, s, { tile: o.tile, mode: o.mode });
      });
    }
  },

  update(scene, dt) {
    for (const n of scene.outsiders.slice()) updateOutsider(scene, n, dt);
  },

  save(scene) {
    return {
      count: st.joined,
      joined: Object.keys(RECRUITS).filter((k) => scene.npcs.some((n) => n.key === k)),
      strays: scene.outsiders.filter((n) => n.key === 'survivor').map((n) => ({ name: n.npcName, gender: n.gender, variant: n.variant, arrived: n.arrived, slot: n.slot, mode: n.outsider.mode, tile: n.outsider.tile }))
    };
  },

  load(scene, data) {
    st.data = data && Array.isArray(data.joined) ? data : null;
  }
};
