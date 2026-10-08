import { TILE, MAP_W, MAP_H, ZOOM, HOTBAR_SIZE, ITEMS, START_INVENTORY, PLAYER_STATS } from '../config.js';
import { audio } from '../audio.js';
import { Player } from '../entities/Player.js';
import { Zombie } from '../entities/Zombie.js';
import { createNPCs } from '../entities/NPC.js';
import { Inventory } from '../systems/Inventory.js';
import { TimeSystem } from '../systems/TimeSystem.js';
import { Farm } from '../systems/Farm.js';
import { WaveManager } from '../systems/WaveManager.js';
import { QuestSystem } from '../systems/QuestSystem.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { buildWorld, regrowResource } from '../systems/MapBuilder.js';
import { useSelected, canPlace, createStructure } from '../systems/PlayerActions.js';
import { HUD } from '../ui/HUD.js';
import { features } from '../features/index.js';

export class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.autostart = data?.autostart || null;
    this.started = false;
    this.gameOver = false;
    this.selected = 0;
    this.kills = 0;
    this.hudTimer = 0;
    this.saveTimer = 0;
  }

  create() {
    // --- Dünya ---
    const world = buildWorld(this);
    Object.assign(this, { layer: world.layer, obstacles: world.obstacles, resources: world.resources, shelter: world.shelter, staticLights: world.lights, spots: world.spots });
    const W = MAP_W * TILE, H = MAP_H * TILE;
    this.physics.world.setBounds(0, 0, W, H);

    // --- Gruplar ---
    this.zombies = this.add.group();
    this.bullets = this.add.group();
    this.barricades = this.add.group();
    this.turrets = this.add.group();

    // --- Sistemler ---
    this.inventory = new Inventory();
    this.timeSys = new TimeSystem();
    this.farm = new Farm(this, this.layer);
    this.waves = new WaveManager(this);
    this.quests = new QuestSystem(this);

    // --- Özellik genişletme noktaları (bkz. features/registry.js) ---
    this.extraTargets = [];
    this.lightSources = [];
    this.interactions = [];
    this.virtualMove = { x: 0, y: 0 };
    this.featureMenu = []; // [{ id, icon, label, key?, open(scene) }] — masaüstü dock + mobil menü bunları gösterir
    this.addInteraction((s) => {
      const n = s.nearestNPC();
      if (!n) return null;
      return { dist: Phaser.Math.Distance.Between(s.player.x, s.player.y, n.x, n.y), label: `${n.npcName} ile konuş`, run: () => s.talkTo(n) };
    });

    // --- Karakterler ---
    this.player = new Player(this, this.spots.player.x, this.spots.player.y);
    this.npcs = createNPCs(this, this.spots);

    // --- Çarpışmalar ---
    const solids = [this.obstacles, this.resources, this.shelter];
    this.physics.add.collider(this.player, solids);
    this.physics.add.collider(this.player, [this.barricades, this.turrets]);
    this.physics.add.collider(this.zombies, solids);
    this.physics.add.collider(this.zombies, this.zombies);
    this.physics.add.collider(this.zombies, [this.barricades, this.turrets], (z, s) => { z.blockedBy = s; });
    this.physics.add.overlap(this.bullets, this.zombies, (b, z) => {
      if (!b.active || z.dead) return;
      z.takeDamage(b.dmg, b);
      b.destroy();
    });

    // --- Kamera ---
    const cam = this.cameras.main;
    cam.setBounds(0, 0, W, H).setZoom(ZOOM).setRoundPixels(true);
    cam.startFollow(this.player, true, 0.12, 0.12);
    cam.setBackgroundColor('#2d4a2b');

    // --- Gece karanlığı (RenderTexture + ışık silme) ---
    this.lightStamp = this.make.image({ key: 'light', add: false });
    this.setupDarkness();
    this.scale.on('resize', this.setupDarkness, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.setupDarkness, this));

    // --- İmleç / yerleştirme önizlemesi ---
    this.marker = this.add.image(0, 0, 'cursor').setDepth(9000).setVisible(false);
    this.ghost = this.add.image(0, 0, 'barricade').setDepth(9001).setAlpha(0.55).setVisible(false);

    this.setupInput();
    this.hud = new HUD(this);
    this.wireEvents();
    features.forEach((f) => f.init?.(this));
    this.hud.update();

    if (this.autostart) this.begin(this.autostart === 'continue');
    else this.hud.showMenu(SaveSystem.exists(), () => this.begin(true), () => this.begin(false));
  }

  // ---------------- Başlatma / kayıt ----------------
  begin(loadSave) {
    audio.init();
    const data = loadSave ? SaveSystem.load() : null;
    if (data) this.applySave(data);
    else {
      SaveSystem.clear();
      START_INVENTORY.forEach(([id, n]) => this.inventory.add(id, n));
      this.hud.toast('Hoş geldin! Gündüz tarlanı işle, gece kasabayı savun.', 'info');
      this.time.delayedCall(1800, () => this.hud.toast('Ayşe, Kemal, Zeynep ve Demir ile E tuşuyla konuş.', 'info'));
    }
    features.forEach((f) => f.begin?.(this, !data));
    this.started = true;
    audio.setMusic(this.timeSys.isNight ? 'night' : 'day');
    if (this.timeSys.isNight) this.waves.start();
    this.hud.renderHotbar();
    this.hud.renderQuests();
  }

  saveGame(manual) {
    if (!this.started || this.gameOver) return;
    if (this.waves.active) { if (manual) this.hud.toast('Dalga sırasında kayıt yapılamaz!', 'warn'); return; }
    const p = this.player;
    const ok = SaveSystem.save({
      player: { x: p.x, y: p.y, hp: p.hp, energy: p.energy, coins: p.coins },
      inventory: this.inventory.serialize(),
      selected: this.selected,
      time: this.timeSys.serialize(),
      waves: this.waves.serialize(),
      farm: this.farm.serialize(),
      quests: this.quests.serialize(),
      structures: [...this.barricades.getChildren(), ...this.turrets.getChildren()].map((s) => ({ kind: s.kind, x: s.x, y: s.y, hp: s.hp })),
      shelterHp: this.shelter.hp,
      kills: this.kills,
      features: Object.fromEntries(features.filter((f) => f.save).map((f) => [f.id, f.save(this)]))
    });
    if (manual) { this.hud.toast(ok ? 'Oyun kaydedildi 💾' : 'Kayıt başarısız (depolama kapalı olabilir)', ok ? 'ok' : 'warn'); audio.sfx('save'); }
  }

  applySave(d) {
    const p = this.player;
    if (d.player) {
      p.setPosition(d.player.x, d.player.y);
      p.hp = Math.max(1, d.player.hp); p.energy = d.player.energy; p.coins = d.player.coins ?? PLAYER_STATS.startCoins;
    }
    this.inventory.load(d.inventory);
    this.selected = d.selected || 0;
    this.timeSys.load(d.time);
    this.waves.load(d.waves);
    this.farm.load(d.farm);
    this.quests.load(d.quests);
    (d.structures || []).forEach((s) => createStructure(this, s.kind, s.x, s.y, s.hp));
    if (d.shelterHp) this.shelter.hp = d.shelterHp;
    this.kills = d.kills || 0;
    features.forEach((f) => f.load?.(this, d.features?.[f.id]));
    this.hud.toast(`Kayıt yüklendi · Gün ${this.timeSys.day}`, 'ok');
  }

  // ---------------- Girdi ----------------
  setupInput() {
    const kb = this.input.keyboard;
    this.keys = kb.addKeys({
      up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D'
    });
    kb.addCapture('TAB,SPACE');
    kb.on('keydown', (ev) => {
      if (!this.started || this.gameOver) return;
      const k = ev.key.toLowerCase();
      if (k === 'escape') { this.hud.closeAll(); return; }
      if (k === 'i' || k === 'tab') { this.hud.toggleInventory(); audio.sfx('click'); return; }
      if (k === 'm') { const muted = audio.toggleMute(); this.hud.toast(muted ? 'Ses kapalı 🔇' : 'Ses açık 🔊', 'info'); return; }
      if (this.hud.isModalOpen()) return;
      if (k >= '1' && k <= String(HOTBAR_SIZE)) this.selectSlot(Number(k) - 1);
      if (k === 'e') this.interact();
      if (k === 'k') this.saveGame(true);
      if (k === ' ') { const ptr = this.input.activePointer.positionToCamera(this.cameras.main); useSelected(this, ptr.x, ptr.y); }
    });
    this.input.on('wheel', (_p, _o, _dx, dy) => {
      if (!this.started || this.hud.isModalOpen()) return;
      this.selectSlot((this.selected + (dy > 0 ? 1 : -1) + HOTBAR_SIZE) % HOTBAR_SIZE);
    });
    this.input.on('pointerdown', (ptr) => {
      audio.init();
      if (!this.started || this.gameOver || this.hud.isModalOpen() || !ptr.leftButtonDown()) return;
      const wp = ptr.positionToCamera(this.cameras.main);
      useSelected(this, wp.x, wp.y);
    });
    this.input.mouse?.disableContextMenu();
  }

  selectSlot(i) {
    this.selected = i;
    this.hud.renderHotbar();
  }

  nearestNPC(range = 24) {
    let best = null, bestD = range;
    for (const n of this.npcs) {
      if (n.hidden) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, n.x, n.y);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  addInteraction(fn) { this.interactions.push(fn); }

  // Tüm sağlayıcılar arasından en yakın etkileşim
  bestInteraction() {
    let best = null;
    for (const fn of this.interactions) {
      const r = fn(this);
      if (r && (!best || r.dist < best.dist)) best = r;
    }
    return best;
  }

  interact() {
    if (!this.player.alive) return;
    this.bestInteraction()?.run();
  }

  talkTo(n) {
    n.halt();
    n.setFlipX(this.player.x < n.x);
    audio.sfx('click');
    this.hud.openDialog(n);
  }

  onModal(open) {
    if (open) { this.physics.pause(); this.player.halt(); }
    else this.physics.resume();
  }

  // ---------------- Olaylar ----------------
  wireEvents() {
    // Sahne yeniden başlatıldığında özel olay dinleyicileri birikmesin
    const custom = ['waveStart', 'waveEnd', 'zombieKilled', 'structureDestroyed', 'playerDied', 'shelterFallen', 'questsChanged', 'cropGrew'];
    this.events.once('shutdown', () => custom.forEach((e) => this.events.off(e)));
    this.timeSys.on('dusk', () => this.waves.start());
    this.timeSys.on('dawn', (day) => this.onDawn(day));
    this.timeSys.on('hour', (h) => {
      if (h === 18) this.hud.toast('Hava kararıyor… Gece için hazırlan!', 'warn');
    });
    this.events.on('waveStart', (w) => {
      audio.sfx('alarm');
      audio.setMusic('night');
      this.hud.banner(`Dalga ${w}`, `${this.waves.toSpawn} zombi geliyor! Sığınağı koru.`);
    });
    this.events.on('waveEnd', (w) => {
      const reward = 15 * w;
      this.player.addCoins(reward);
      this.quests.onWaveSurvived(w);
      audio.sfx('dawn');
      audio.setMusic('day');
      this.hud.banner('Şafak söktü', `${w}. dalgayı atlattın · +${reward} 🪙`);
    });
    this.events.on('zombieKilled', (z) => {
      this.kills++;
      this.quests.onKill();
      if (Phaser.Math.Distance.Between(z.x, z.y, this.player.x, this.player.y) < 260) {
        this.player.addCoins(z.reward);
        this.floatText(z.x, z.y - 8, `+${z.reward}🪙`, '#ffd166');
      }
    });
    this.events.on('structureDestroyed', (s) => this.hud.toast(`${s.kind === 'turret' ? 'Taret' : 'Barikat'} yıkıldı!`, 'warn'));
    this.events.on('playerDied', () => {
      const lost = Math.floor(this.player.coins * 0.2);
      this.player.addCoins(-lost);
      this.hud.toast(`Bayıldın! ${lost} 🪙 kaybettin. Sığınakta uyanacaksın…`, 'warn');
      this.time.delayedCall(3000, () => {
        if (this.gameOver) return;
        this.player.respawn(this.shelter.door.x, this.shelter.door.y + 8);
      });
    });
    this.events.on('shelterFallen', () => this.onGameOver());
  }

  onDawn(day) {
    this.waves.end();
    this.farm.onDawn();
    this.resources.getChildren().forEach((r) => { if (r.depleted && Math.random() < 0.5) regrowResource(r); });
    const p = this.player;
    p.energy = Math.max(p.energy, p.maxEnergy * 0.8);
    this.shelter.repair(this.shelter.maxHp * 0.1);
    this.hud.toast(`${day}. gün başladı. Ekinlerini sulamayı unutma!`, 'info');
    this.time.delayedCall(500, () => this.saveGame(false));
  }

  onGameOver() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.physics.pause();
    audio.setMusic(null);
    audio.sfx('die');
    SaveSystem.clear();
    this.hud.closeAll();
    this.hud.showGameOver({ day: this.timeSys.day, wave: this.waves.wave, kills: this.kills }, () => this.scene.restart({ autostart: 'new' }));
  }

  // ---------------- Yardımcılar (diğer modüller kullanır) ----------------
  zombieTargets() {
    const list = [this.shelter, ...this.turrets.getChildren()];
    if (this.player.alive) list.push(this.player);
    for (const n of this.npcs) if (!n.hidden) list.push(n);
    for (const t of this.extraTargets) if (t && t.active !== false) list.push(t);
    return list;
  }

  spawnZombie(x, y, kind) {
    const z = new Zombie(this, Phaser.Math.Clamp(x, 8, MAP_W * TILE - 8), Phaser.Math.Clamp(y, 8, MAP_H * TILE - 8), kind, this.waves.wave);
    this.zombies.add(z);
    z.setAlpha(0);
    this.tweens.add({ targets: z, alpha: 1, duration: 400 });
    return z;
  }

  fireBullet(x, y, angle, dmg, speed) {
    const b = this.physics.add.image(x, y, 'bullet').setDepth(y + 20);
    b.body.setSize(4, 4);
    b.dmg = dmg;
    b.setRotation(angle);
    b.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    this.bullets.add(b);
    this.time.delayedCall(700, () => { if (b.active) b.destroy(); });
  }

  addStructure(kind, x, y) { return createStructure(this, kind, x, y); }

  giveItem(id, n) {
    const left = this.inventory.add(id, n);
    if (left > 0) this.hud.toast(`Envanter dolu! ${left}× ${ITEMS[id].name} kayboldu`, 'warn');
  }

  spawnParticles(x, y, color, n = 6) {
    for (let i = 0; i < n; i++) {
      const r = this.add.rectangle(x, y, 2, 2, color).setDepth(9500);
      this.tweens.add({
        targets: r, x: x + Phaser.Math.Between(-10, 10), y: y + Phaser.Math.Between(-12, 4), alpha: 0,
        duration: Phaser.Math.Between(250, 500), ease: 'Quad.easeOut', onComplete: () => r.destroy()
      });
    }
  }

  floatText(x, y, text, color = '#fff') {
    const t = this.add.text(x, y, text, { fontFamily: 'Outfit, sans-serif', fontSize: '7px', color, stroke: '#000', strokeThickness: 2, resolution: 4 })
      .setOrigin(0.5).setDepth(15000);
    this.tweens.add({ targets: t, y: y - 14, alpha: 0, duration: 1100, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  // ---------------- Gece ışıklandırması ----------------
  setupDarkness() {
    const cam = this.cameras.main;
    const w = Math.ceil(cam.width / cam.zoom) + 8, h = Math.ceil(cam.height / cam.zoom) + 8;
    this.dark?.destroy();
    this.dark = this.add.renderTexture(0, 0, w, h).setOrigin(0, 0).setDepth(20000);
  }

  drawDarkness() {
    const a = this.timeSys.darkness, tint = this.timeSys.duskTint;
    if (a <= 0.02 && tint <= 0.02) { this.dark.setVisible(false); return; }
    const v = this.cameras.main.worldView;
    const ox = Math.floor(v.x) - 4, oy = Math.floor(v.y) - 4;
    this.dark.setVisible(true).setPosition(ox, oy);
    this.dark.clear();
    if (a < 0.12) { this.dark.fill(0xff7b39, tint * 0.4); return; }
    this.dark.fill(0x070b22, a);
    const light = (x, y, r) => {
      if (x + r < ox || y + r < oy || x - r > ox + this.dark.width || y - r > oy + this.dark.height) return;
      this.lightStamp.setScale((r * 2) / 128);
      this.dark.erase(this.lightStamp, x - ox, y - oy);
    };
    const flicker = 1 + Math.sin(this.time.now / 120) * 0.03;
    light(this.player.x, this.player.y, 85 * flicker);
    this.staticLights.forEach((l) => light(l.x, l.y, l.r * flicker));
    this.turrets.getChildren().forEach((t) => light(t.x, t.y, 34));
    this.npcs.forEach((n) => { if (!n.hidden && n.key === 'guard') light(n.x, n.y, 45); });
    this.bullets.getChildren().forEach((b) => light(b.x, b.y, 14));
    this.lightSources.forEach((fn) => (fn(this) || []).forEach((l) => light(l.x, l.y, l.r)));
  }

  // ---------------- Ana döngü ----------------
  update(_t, delta) {
    if (!this.started || this.gameOver) { this.drawDarkness(); return; }
    const dt = Math.min(delta, 50) / 1000;
    this.updateMarker();
    if (this.hud.isModalOpen()) { this.drawDarkness(); return; }

    const gameMin = this.timeSys.update(dt);
    this.farm.advance(gameMin);
    this.player.update(dt, this.keys, false);
    this.npcs.forEach((n) => n.update(dt));
    this.zombies.getChildren().slice().forEach((z) => z.update(dt));
    this.turrets.getChildren().forEach((t) => t.update(dt));
    this.waves.update(dt);
    features.forEach((f) => f.update?.(this, dt));

    // Etkileşim ipucu
    const act = this.bestInteraction();
    if (act) this.hud.hint(`E · ${act.label}`);
    else if (this.hoverRipe) this.hud.hint('Tıkla · Hasat et');
    else this.hud.hint('');

    this.drawDarkness();

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.1; this.hud.update(); }
    this.saveTimer += dt;
    if (this.saveTimer > 60) { this.saveTimer = 0; this.saveGame(false); }
  }

  updateMarker() {
    const ptr = this.input.activePointer;
    const wp = ptr.positionToCamera(this.cameras.main);
    const tx = Math.floor(wp.x / TILE), ty = Math.floor(wp.y / TILE);
    const cx = tx * TILE + 8, cy = ty * TILE + 8;
    const slot = this.inventory.slots[this.selected];
    const type = slot ? ITEMS[slot.id].type : null;
    const inReach = Phaser.Math.Distance.Between(this.player.x, this.player.y + 4, cx, cy) <= 40;
    this.hoverRipe = inReach && this.farm.isRipe(tx, ty);
    const showMarker = !this.hud.isModalOpen() && (type === 'tool' || type === 'seed' || this.hoverRipe);
    this.marker.setVisible(showMarker).setPosition(cx, cy).setTint(inReach ? 0xffffff : 0xff6666);
    if (type === 'place' && !this.hud.isModalOpen()) {
      const ok = canPlace(this, cx, cy);
      this.ghost.setVisible(true).setTexture(slot.id).setPosition(cx, cy).setTint(ok ? 0x88ff88 : 0xff6666);
    } else this.ghost.setVisible(false);
  }
}
