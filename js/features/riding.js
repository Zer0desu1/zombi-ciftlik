// 'riding' özellik modülü — binekler: evcil yırtıcıya (kurt/kaplan/ayı) binme + Kemal'den alınan at.
//   • Evcil hayvanın E panelinde 🐎 Bin; binerken hayvan kendi başına saldırmaz, oyuncu silahını kullanabilir.
//   • At savaşmaz ve zombiler ona saldırmaz (hedef listesinde yok); inince bulunduğu yerde bekler ya da sahibini takip eder.
//   • Binerken: hız çarpanı (player.mountMul), yuvarlanma yok, binici yürüme animasyonu oynamaz (player.mounted).
//   • İnme: E (yakında başka etkileşim yoksa "İn"), binici/binek bayılınca otomatik.
//   • Binek fizik gövdesi binerken kapalı; her kare binicinin altına yerleştirilir (binek binicinin bacaklarını örter).
//   • Çok oyunculu: host otoriter. Misafirin binek çarpanı ve binek nesnesinin ayna kimliği netPlayerState ile gider;
//     misafir kendi bineğinin vekilini yerel karakterinin altına çizer (ayna gecikmesi binici ile bineği ayırmasın).
//     Host'un hareket denetimi (NetHost.validMove) player.mountMul'u hesaba katar.
// Kayıt: atlar (sahip, ad, konum, mod). Binme durumu kaydedilmez: yüklemede herkes inmiş başlar.
import { ITEMS, SHOPS } from '../config.js';
import { addCanvas, makeCanvas, R, outline } from '../textures.js';
import { audio } from '../audio.js';
import { Actor } from '../entities/Actor.js';

// Binek hız çarpanları (oyuncu hızına)
export const RIDE_MUL = { wolf: 1.6, tiger: 1.7, bear: 1.35, horse: 1.8 };
const HORSE = { fw: 24, fh: 16, speed: 80, price: 300, names: ['Rüzgâr', 'Yıldız', 'Kır', 'Doru', 'Şimşek', 'Karayel', 'Bulut'] };
const MAX_HORSES = 2;     // oyuncu başına
const RANGE = 30;         // E ile binme mesafesi
const DISMOUNT_DIST = -1; // "İn" her zaman önce: binerken E yalnızca indirir (konuşmak/toplamak için önce in)

Object.assign(ITEMS, {
  horse: { name: 'At', type: 'material', icon: 'i_horse', desc: 'Kullan → atın yanına gelir. Yanında E: Bin / Bekle / Takip. Savaşmaz; binince çok hızlı gidersin.', onUse: (s) => useHorseItem(s) }
});
SHOPS.merchant.push({ id: 'horse', qty: 1, price: HORSE.price });

// ---------- Doku ----------
function drawHorse(ctx, f) {
  const B = '#8a5a32', L = '#a8743f', D = '#5e3b20', M = '#2a1f1a', K = '#1a1410', H = '#3a2a1e';
  // Bacaklar: 0 duruş, 1–2 yürüyüş (çaprazlar dönüşümlü)
  const a = f === 1 ? 1 : 0, b = f === 2 ? 1 : 0;
  [[5, a], [8, b], [15, b], [18, a]].forEach(([x, up]) => { R(ctx, x, 11, 2, 4 - up, D); R(ctx, x, 15 - up, 2, 1, H); });
  R(ctx, 1, 5, 2, 6, M); R(ctx, 0, 9, 2, 2, M);                                // kuyruk
  R(ctx, 3, 5, 16, 6, B); R(ctx, 4, 5, 14, 1, L); R(ctx, 4, 10, 14, 1, D);      // gövde
  R(ctx, 16, 2, 4, 6, B); R(ctx, 15, 1, 2, 6, M);                               // boyun + yele
  R(ctx, 18, 1, 5, 4, B); R(ctx, 19, 1, 3, 1, L); R(ctx, 21, 3, 2, 2, D);       // baş + burun
  R(ctx, 20, 2, 1, 1, K); R(ctx, 18, 0, 1, 1, M);                               // göz + kulak
}

function makeTextures(scene) {
  const key = 'mt_horse';
  const tex = addCanvas(scene, key, HORSE.fw * 3, HORSE.fh, (ctx) => {
    for (let f = 0; f < 3; f++) {
      const { c, ctx: fc } = makeCanvas(HORSE.fw, HORSE.fh);
      drawHorse(fc, f);
      outline(fc, 0, 0, HORSE.fw, HORSE.fh, '#241c1a');
      ctx.drawImage(c, f * HORSE.fw, 0);
    }
  });
  for (let f = 0; f < 3; f++) tex.add(f, 0, f * HORSE.fw, 0, HORSE.fw, HORSE.fh);
  if (!scene.anims.exists(key + '_walk')) scene.anims.create({ key: key + '_walk', frames: [1, 0, 2, 0].map((frame) => ({ key, frame })), frameRate: 9, repeat: -1 });
  addCanvas(scene, 'i_horse', 16, 16, (ctx) => {
    R(ctx, 2, 6, 9, 5, '#8a5a32'); R(ctx, 3, 6, 7, 1, '#a8743f');
    R(ctx, 9, 3, 3, 5, '#8a5a32'); R(ctx, 8, 2, 2, 5, '#2a1f1a'); R(ctx, 11, 2, 4, 3, '#8a5a32'); R(ctx, 13, 3, 2, 2, '#5e3b20');
    R(ctx, 1, 6, 1, 5, '#2a1f1a');
    [3, 5, 8, 10].forEach((x) => R(ctx, x, 11, 1, 3, '#5e3b20'));
    outline(ctx, 0, 0, 16, 16, '#3a2e2a');
  });
}

// ---------- Yardımcılar ----------
const RS = (scene) => scene.riding;
const dist = (a, b) => Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
// Sahiplik anahtarı: host → null, misafir → adı (predators ile aynı kural)
function keyOf(scene, p) {
  if (!p || !p.netRemote) return null;
  return scene.net?.guestOf?.(p)?.name || null;
}
function ownerPlayer(scene, key) {
  if (!key) return scene.netHostPlayer || scene.player;
  const gs = scene.net?.guests;
  if (gs) for (const g of gs.values()) if (g.name === key && g.player) return g.player;
  return null;
}
const asOwner = (scene, owner, fn) => (owner?.netRemote && scene.net?.asPlayer ? scene.net.asPlayer(owner, fn) : fn());
const mountName = (m) => (m.isHorse ? m.horseName : m.petName);
const mountIcon = (m) => (m.isHorse ? '🐎' : m.k?.icon || '🐾');
const mountH = (m) => (m.isHorse ? HORSE.fh : m.k?.fh || 12);
const walkKey = (m) => (m.isHorse ? 'mt_horse_walk' : `pd_${m.kind}_walk`);
function allPlayers(scene) { return scene.allPlayers ? scene.allPlayers(true) : [scene.player]; }

// ---------- At ----------
class Horse extends Actor {
  constructor(scene, x, y) {
    super(scene, x, y, 'mt_horse', 1);
    this.isHorse = true;
    this.kind = 'horse';
    this.showHpBar = false;
    this.mode = 'stay';      // stay | follow
    this.radius = 8;
    this.label = null;
    this.idleT = Phaser.Math.FloatBetween(1, 4);
    this.body.setSize(HORSE.fw - 8, 6).setOffset(4, HORSE.fh - 7);
    this.setCollideWorldBounds(true);
  }

  preUpdate(t, d) {
    super.preUpdate(t, d);
    const feet = this.y + HORSE.fh / 2 - 1;
    this.shadow.setPosition(this.x, feet).setDepth(feet - 1).setScale(HORSE.fw / 12, 1).setAlpha(this.alpha);
    if (!this.rider) this.setDepth(feet);
    if (this.label?.active) this.label.setPosition(this.x, this.y - HORSE.fh / 2 - 3).setVisible(this.visible && !this.rider);
  }

  setName(n) {
    this.horseName = n;
    if (!this.label) {
      this.label = this.scene.add.text(this.x, this.y - 10, '', { fontFamily: 'Outfit, sans-serif', fontSize: '7px', color: '#ffe08a', stroke: '#000', strokeThickness: 2, resolution: 4 })
        .setOrigin(0.5, 1).setDepth(15000);
      this.label.netFollow = this;
    }
    this.label.setText(`${n}${this.mode === 'stay' ? ' ⏸' : ''}`);
  }

  destroy(fromScene) {
    this.label?.destroy();
    this.label = null;
    super.destroy(fromScene);
  }
}

function horseName(scene) {
  const used = new Set(RS(scene).horses.map((h) => h.horseName));
  const free = HORSE.names.filter((n) => !used.has(n));
  return free.length ? Phaser.Utils.Array.GetRandom(free) : `At ${RS(scene).horses.length + 1}`;
}

function addHorse(scene, x, y, ownerKey, opts = {}) {
  const st = RS(scene);
  const h = new Horse(scene, x, y);
  h.ownerKey = ownerKey || null;
  h.mode = opts.mode === 'follow' ? 'follow' : 'stay';
  h.stayAt = { x, y };
  h.setName(opts.name || horseName(scene));
  h.setFlipX(!!opts.flip);
  st.group.add(h);
  st.horses.push(h);
  return h;
}

// Satın alınan at eşyası: sahibinin yanına gelir
function useHorseItem(scene) {
  const p = scene.player, key = keyOf(scene, p);
  if (RS(scene).horses.filter((h) => h.ownerKey === key).length >= MAX_HORSES) {
    scene.hud.toast(`En fazla ${MAX_HORSES} atın olabilir.`, 'warn'); audio.sfx('error'); return;
  }
  if (!scene.inventory.remove('horse', 1)) return;
  const side = p.flipX ? 1 : -1;
  const h = addHorse(scene, p.x + side * 22, p.y + 2, key, { flip: side > 0 });
  scene.hud.refreshInventory?.();
  scene.player.actionCd = 0.4;
  scene.spawnParticles(h.x, h.y - 4, 0xffe08a, 10);
  audio.sfx('quest');
  scene.hud.toast(`🐎 ${h.horseName} artık senin! Yanına gidip E: Bin.`, 'ok');
}

function tickHorse(scene, h, dt) {
  if (h.rider) return;
  const owner = ownerPlayer(scene, h.ownerKey);
  if (h.mode === 'follow' && owner && owner.alive !== false) {
    const d = dist(owner, h);
    if (d > 420) { h.setPosition(owner.x - 18, owner.y + 4); h.halt(); return; }
    const gx = owner.x + (owner.flipX ? 20 : -20), gy = owner.y + 4;
    const dg = Phaser.Math.Distance.Between(h.x, h.y, gx, gy);
    if (dg > 12) { h.moveToward(gx, gy, d > 90 ? HORSE.speed * 1.4 : HORSE.speed); h.anims.timeScale = d > 90 ? 1.5 : 1; }
    else h.halt();
    return;
  }
  // Bekle: yerinde otlar, ara sıra birkaç adım
  const sp = h.stayAt || (h.stayAt = { x: h.x, y: h.y });
  if (Phaser.Math.Distance.Between(h.x, h.y, sp.x, sp.y) > 24) { h.moveToward(sp.x, sp.y, HORSE.speed * 0.4); return; }
  h.idleT -= dt;
  if (h.idleT <= 0) {
    h.idleT = Phaser.Math.FloatBetween(2, 6);
    if (Math.random() < 0.5) { h.moveToward(sp.x + Phaser.Math.Between(-16, 16), sp.y + Phaser.Math.Between(-8, 8), 14); h.anims.timeScale = 0.6; }
    else h.halt();
  } else if (h.body.velocity.lengthSq() > 0 && h.idleT < 1) h.halt();
}

// ---------- Binme / inme ----------
function canRide(m) {
  if (!m || !m.active || m.rider || m.dead) return false;
  return m.isHorse || (m.tame && !m.downed);
}

function mount(scene, p, m) {
  if (!p || p.alive === false || p.mount || !canRide(m)) return false;
  p.mount = m;
  p.mounted = true;
  p.mountMul = RIDE_MUL[m.kind] || 1.5;
  m.rider = p;
  m.halt();
  m.target = null;
  m.body.enable = false;
  m.setFlipX(p.flipX);
  placeMount(p, m);
  m.label?.setVisible(false);
  scene.spawnParticles(m.x, m.y, 0xe8c867, 6);
  audio.sfx('click');
  return true;
}

function dismount(scene, p, quiet = false) {
  const m = p?.mount;
  if (!p) return false;
  p.mount = null;
  p.mounted = false;
  p.mountMul = 1;
  if (!m) return false;
  m.rider = null;
  if (m.active) {
    m.body.enable = true;
    m.setVelocity(0, 0);
    m.setPosition(p.x + (p.flipX ? 12 : -12), p.y + 4);
    m.stayAt = { x: m.x, y: m.y };
    m.anims.stop(); m.setFrame(0);
    if (m.isHorse) m.setName(m.horseName);
    else m.petLabel?.();
  }
  if (!quiet) audio.sfx('click');
  return true;
}

// Binek binicinin altında: binicinin bacaklarını örter (binek derinliği biniciden biraz önde)
function placeMount(p, m) {
  m.setPosition(p.x, p.y - 1 + mountH(m) / 2);
  m.setDepth(p.depth + 0.5);
  m.shadow?.setPosition(m.x, m.y + mountH(m) / 2 - 1).setDepth(m.depth - 2);
}

function tickRider(scene, p) {
  const m = p.mount;
  if (!m) return;
  if (!m.active || p.alive === false || m.downed || m.dead) { dismount(scene, p, true); return; }
  placeMount(p, m);
  const v = p.body?.velocity, moving = !!v && (Math.abs(v.x) > 1 || Math.abs(v.y) > 1);
  if (Math.abs(v?.x || 0) > 1) m.setFlipX(v.x < 0); else m.setFlipX(p.flipX);
  if (moving) { m.anims.play(walkKey(m), true); m.anims.timeScale = 1.5; }
  else if (m.anims.isPlaying) { m.anims.stop(); m.setFrame(0); }
}

// Panel: bin + (evcil hayvan) bekle/takip
function openMountPanel(scene, m) {
  const hud = scene.hud;
  const body = document.createElement('div');
  body.className = 'rd-panel';
  const p = document.createElement('p');
  const mul = RIDE_MUL[m.kind] || 1;
  p.textContent = m.isHorse ? `${m.horseName} savaşmaz ama çok hızlıdır (hız ×${mul}).` : `${m.petName} üstündeyken kendi başına saldırmaz (hız ×${mul}).`;
  const row = document.createElement('div');
  row.className = 'rd-btns';
  const btn = (text, cls, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    if (cls) b.className = cls;
    b.textContent = text;
    b.addEventListener('click', () => { fn(); });
    row.appendChild(b);
  };
  btn('🐎 Bin', 'primary', () => { hud.closeAll(); mount(scene, scene.player, m); });
  if (m.isHorse) {
    const stay = m.mode !== 'stay';
    btn(stay ? '⏸ Bekle' : '▶ Takip et', '', () => {
      m.mode = stay ? 'stay' : 'follow';
      m.stayAt = { x: m.x, y: m.y };
      m.halt();
      m.setName(m.horseName);
      audio.sfx('click');
      hud.closeAll();
    });
  } else {
    const stay = m.state !== 'stay';
    btn(stay ? '⏸ Bekle' : '▶ Takip et', '', () => { hud.closeAll(); scene.predators?.setStay?.(m, stay); });
  }
  body.append(p, row);
  hud.openPanel(`${mountIcon(m)} ${mountName(m)}`, body);
}

// ---------- Modül ----------
export default {
  id: 'riding',

  textures(scene) { makeTextures(scene); },

  init(scene) {
    const st = scene.riding = {
      horses: [], group: scene.add.group(), pending: null, RIDE_MUL,
      mount: (p, m) => mount(scene, p, m), dismount: (p) => dismount(scene, p),
      addHorse: (x, y, ownerKey, o) => addHorse(scene, x, y, ownerKey, o), openPanel: (m) => openMountPanel(scene, m), canRide
    };
    const solids = [scene.obstacles, scene.resources, scene.shelter].filter(Boolean);
    scene.physics.add.collider(st.group, solids);

    // E: atına bin / panel; binerken: İn
    scene.addInteraction((s) => {
      const p = s.player;
      if (!p || p.alive === false) return null;
      if (p.mount) return { dist: DISMOUNT_DIST, label: `🐎 İn: ${mountName(p.mount)}`, run: () => dismount(s, s.player) };
      const key = keyOf(s, p);
      let best = null, bd = RANGE;
      for (const h of RS(s).horses) {
        if (h.rider || h.ownerKey !== key) continue;
        const d = dist(p, h);
        if (d < bd) { bd = d; best = h; }
      }
      if (!best) return null;
      const h = best;
      return { dist: bd, label: `🐎 ${h.horseName}`, run: () => openMountPanel(s, h) };
    });

    scene.minimapDots = scene.minimapDots || [];
    scene.minimapDots.push((s) => (s.net?.isGuest ? [] : RS(s).horses.map((h) => ({ x: h.x, y: h.y, color: '#e8c867', r: 2 }))));

    scene.events.once('shutdown', () => { st.horses = []; });
  },

  begin(scene) {
    const st = RS(scene);
    allPlayers(scene).forEach((p) => { p.mount = null; p.mounted = false; p.mountMul = 1; });
    st.horses.forEach((h) => h.destroy());
    st.horses = [];
    const pend = st.pending; st.pending = null;
    (pend?.horses || []).forEach((r) => addHorse(scene, r.x, r.y, r.owner, r));
  },

  update(scene, dt) {
    const st = RS(scene);
    if (!st) return;
    for (let i = st.horses.length - 1; i >= 0; i--) {
      const h = st.horses[i];
      if (!h.active) { st.horses.splice(i, 1); continue; }
      tickHorse(scene, h, dt);
    }
    for (const p of allPlayers(scene)) if (p?.mount) tickRider(scene, p);
  },

  save(scene) {
    return { horses: RS(scene).horses.map((h) => ({ name: h.horseName, x: Math.round(h.x), y: Math.round(h.y), mode: h.mode, owner: h.ownerKey || null })) };
  },

  load(scene, d) {
    const list = Array.isArray(d?.horses) ? d.horses : [];
    RS(scene).pending = {
      horses: list.filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.y))
        .map((r) => ({ name: String(r.name || 'At').slice(0, 24), x: r.x, y: r.y, mode: r.mode === 'follow' ? 'follow' : 'stay', owner: typeof r.owner === 'string' ? r.owner : null }))
    };
  },

  // Çok oyunculu: misafirin kendi binek durumu (hız çarpanı + bineğin ayna kimliği)
  netPlayerState(scene) {
    const p = scene.player, m = p?.mount;
    return m ? [p.mountMul, m.__nid || 0, mountH(m)] : 0;
  },
  netApplyPlayer(scene, v) {
    const p = scene.player;
    if (!p) return;
    const on = Array.isArray(v);
    p.mounted = on;
    p.mountMul = on ? Number(v[0]) || 1 : 1;
    p.netMount = on ? { nid: String(v[1]), h: Number(v[2]) || 12 } : null;
  },
  // Misafir: kendi bineğinin vekilini yerel karakterin altına çiz (ayna gecikmesi binici ile bineği ayırmasın)
  guestUpdate(scene) {
    const p = scene.player, nm = p?.netMount;
    if (!nm || nm.nid === '0') return;
    const m = scene.net?.mirror?.objs?.get(nm.nid);
    if (!m || !m.active) return;
    m.setPosition(p.x, p.y - 1 + nm.h / 2);
    m.setDepth(p.depth + 0.5);
    m.dz = null;
    const v = p.body?.velocity;
    if (Math.abs(v?.x || 0) > 1) m.setFlipX(v.x < 0);
  }
};
