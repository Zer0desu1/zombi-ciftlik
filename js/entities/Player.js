import { Actor } from './Actor.js';
import { PLAYER_STATS } from '../config.js';
import { audio } from '../audio.js';

// Kaçış yuvarlanması ayarları
export const DODGE = { time: 0.18, dist: 60, invuln: 0.25, energy: 12, cooldown: 0.6 };

export class Player extends Actor {
  constructor(scene, x, y) {
    super(scene, x, y, 'player', PLAYER_STATS.maxHp);
    this.showHpBar = false; // can HUD'da gösterilir
    this.maxEnergy = PLAYER_STATS.maxEnergy;
    this.energy = this.maxEnergy;
    this.coins = PLAYER_STATS.startCoins;
    this.alive = true;
    this.invuln = 0;
    this.actionCd = 0;
    this.facing = new Phaser.Math.Vector2(1, 0);
    this.moveInput = new Phaser.Math.Vector2(0, 0); // son karedeki hareket girdisi (yuvarlanma yönü için)
    this.speedMul = 1;   // yay gerilirken vb. yavaşlama (combat ayarlar)
    this.rollT = 0;      // yuvarlanma kalan süresi
    this.rollCd = 0;     // yuvarlanma bekleme süresi
    this.rollDir = new Phaser.Math.Vector2(1, 0);
    this.gender = 'm';
    this.setCollideWorldBounds(true);
  }

  get rolling() { return this.rollT > 0; }

  // Karakter cinsiyeti: 'm' (varsayılan, 'player' dokusu) | 'f' ('player_f' dokusu; aynı kare/animasyon düzeni)
  setGender(g) {
    this.gender = g === 'f' ? 'f' : 'm';
    const key = this.gender === 'f' && this.scene.textures.exists('player_f') ? 'player_f' : 'player';
    if (this.texKey !== key) {
      const playing = this.anims?.isPlaying;
      this.texKey = key;
      this.anims?.stop();
      this.setTexture(key, 0);
      if (playing) this.walk(true);
    }
    return this;
  }

  update(dt, keys, blocked) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.actionCd = Math.max(0, this.actionCd - dt);
    this.rollCd = Math.max(0, this.rollCd - dt);
    if (!this.alive) return;
    // Erken basılan yuvarlanma kısa süre tamponda bekler, bekleme bitince kendiliğinden çıkar
    if (this.dodgeBuf > 0) {
      this.dodgeBuf -= dt;
      if (this.rollT <= 0 && this.rollCd <= 0 && !blocked) { this.dodgeBuf = 0; this.dodge(); }
    }
    if (blocked) { this.rollT = 0; this.halt(); return; }
    let vx = 0, vy = 0;
    if (keys.left.isDown || keys.a.isDown) vx -= 1;
    if (keys.right.isDown || keys.d.isDown) vx += 1;
    if (keys.up.isDown || keys.w.isDown) vy -= 1;
    if (keys.down.isDown || keys.s.isDown) vy += 1;
    // Klavye yoksa dokunmatik joystick (analog, 0..1 büyüklük)
    let mag = 1;
    const vm = this.scene.virtualMove;
    // Telefonda kamera daha uzak (zoom 2): aynı hız ekranda yavaş görünür, joystick biraz daha hızlı yürütür
    if (!vx && !vy && vm && (vm.x || vm.y)) { vx = vm.x; vy = vm.y; mag = Math.max(0.35, Math.min(1, Math.hypot(vx, vy))) * PLAYER_STATS.touchSpeedMul; }
    this.moveInput.set(vx, vy);

    // Yuvarlanırken girdi yok sayılır, sabit hızla kayılır
    if (this.rollT > 0) {
      this.rollT = Math.max(0, this.rollT - dt);
      const sp = DODGE.dist / DODGE.time;
      this.setVelocity(this.rollDir.x * sp, this.rollDir.y * sp);
      if (this.rollT <= 0) { this.setAngle(0); this.setVelocity(0, 0); }
      return;
    }

    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      const v = new Phaser.Math.Vector2(vx, vy).normalize();
      this.facing.copy(v);
      v.scale(mag);
      // buffSpeed: yemek güçlendirmesi (harvest modülü)
      // mountMul: binek hızı (riding modülü)
      const speed = PLAYER_STATS.speed * (this.energy <= 0 ? 0.6 : 1) * (this.speedMul ?? 1) * (1 + (this.buffSpeed || 0)) * (this.mountMul || 1);
      this.setVelocity(v.x * speed, v.y * speed);
      if (vx !== 0) this.setFlipX(vx < 0);
    } else {
      this.setVelocity(0, 0);
    }
    this.walk(moving && !this.mounted); // binekteyken binici yürümez
  }

  // Kaçış yuvarlanması: hareket yönüne (yoksa bakılan yöne) kısa atılma + dokunulmazlık
  dodge() {
    if (!this.alive || this.mounted) return false;
    if (this.rollT > 0 || this.rollCd > 0) {
      if (this.rollCd < 0.25) this.dodgeBuf = 0.25;
      return false;
    }
    if (!this.useEnergy(DODGE.energy)) return false;
    const d = this.moveInput.lengthSq() > 0 ? this.moveInput.clone().normalize() : this.facing.clone().normalize();
    if (d.lengthSq() === 0) d.set(this.flipX ? -1 : 1, 0);
    this.rollDir.copy(d);
    this.facing.copy(d);
    if (Math.abs(d.x) > 0.1) this.setFlipX(d.x < 0);
    this.rollT = DODGE.time;
    this.rollCd = DODGE.cooldown + DODGE.time;
    this.invuln = Math.max(this.invuln, DODGE.invuln);
    this.anims.stop(); this.setFrame(1);
    // Takla görseli
    const dir = d.x < 0 ? -1 : 1;
    this.scene.tweens.add({
      targets: this, angle: 360 * dir, duration: DODGE.time * 1000, ease: 'Sine.easeOut',
      onComplete: () => { if (this.alive) this.setAngle(0); }
    });
    // Hayalet izi: yuvarlanmanın gerçekleştiği ve dokunulmazlığın sürdüğü belli olsun
    this.scene.time.addEvent({
      delay: 45, repeat: 3, callback: () => {
        if (!this.active) return;
        const g = this.scene.add.image(this.x, this.y, this.texture.key, this.frame.name)
          .setFlipX(this.flipX).setAngle(this.angle).setDepth(this.depth - 1).setTint(0x9ecbff).setAlpha(0.45);
        g.netSkip = true; // kısa ömürlü kozmetik iz: çok oyunculuda aynalanmaz (yetim/takılı vekil kalmasın)
        this.scene.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
      }
    });
    audio.noise({ dur: 0.12, vol: 0.18, freq: 1200 });
    this.scene.events.emit('playerDodge', { x: this.x, y: this.y, dx: d.x, dy: d.y });
    return true;
  }

  useEnergy(n) {
    if (this.energy < n) {
      this.scene.hud.notice('Çok yorgunsun! Bir şeyler ye.');
      audio.sfx('error');
      return false;
    }
    this.energy = Math.max(0, this.energy - n);
    return true;
  }

  restore(hp = 0, energy = 0) {
    this.hp = Math.min(this.maxHp, this.hp + hp);
    this.energy = Math.min(this.maxEnergy, this.energy + energy);
  }

  addCoins(n) {
    this.coins += n;
    if (n > 0) audio.sfx('coin');
  }

  takeDamage(n, source) {
    if (!this.alive || this.invuln > 0) return;
    const dmg = n * (this.dmgTakenMul ?? 1); // yemek güçlendirmesiyle azalabilir
    this.hp -= dmg;
    this.invuln = 0.5;
    this.flash(0xff4444);
    if (source) this.knockback(source.x, source.y, 140);
    // Çok oyunculu: host'taki misafir karakteri → efektler misafirin ekranında
    if (this.netRemote) { this.netRemote.hurt(dmg, source); if (this.hp <= 0) this.die(); return; }
    // Yönlü kenar kızarması için (combat dinler)
    this.scene.events.emit('playerHurt', { dmg, x: source?.x ?? this.x, y: source?.y ?? this.y });
    this.scene.cameras.main.shake(100, 0.004);
    audio.sfx('hurt');
    if (this.hp <= 0) this.die();
  }

  die() {
    this.hp = 0;
    this.alive = false;
    this.rollT = 0;
    this.scene.tweens.killTweensOf(this);
    this.halt();
    this.setVelocity(0, 0);
    this.setAngle(90);
    if (this.netRemote) { this.scene.events.emit('remotePlayerDied', this); return; }
    audio.sfx('die');
    this.scene.events.emit('playerDied');
  }

  respawn(x, y) {
    this.setPosition(x, y);
    this.setAngle(0);
    this.alive = true;
    this.hp = this.maxHp;
    this.energy = Math.max(this.energy, this.maxEnergy * 0.5);
    this.invuln = 2;
    this.rollT = 0;
  }
}
