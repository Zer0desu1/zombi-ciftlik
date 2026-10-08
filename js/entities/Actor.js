// Hareket eden tüm karakterlerin ortak tabanı: gölge, can barı, derinlik sıralama, vurulma efekti.
export class Actor extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, key, maxHp = 10) {
    super(scene, x, y, key, 0);
    this.texKey = key;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setSize(8, 6).setOffset(4, 10);
    this.shadow = scene.add.image(x, y + 7, 'shadow');
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.radius = 6;
    this.showHpBar = true;
    this.hpBg = scene.add.rectangle(0, 0, 12, 2, 0x000000, 0.6).setOrigin(0, 0.5).setVisible(false);
    this.hpFg = scene.add.rectangle(0, 0, 12, 2, 0x6ee06e).setOrigin(0, 0.5).setVisible(false);
  }

  preUpdate(t, d) {
    super.preUpdate(t, d);
    const feet = this.y + 7 * this.scaleY;
    this.shadow.setPosition(this.x, feet).setDepth(feet - 1).setVisible(this.visible).setScale(this.scaleX, 1);
    this.setDepth(feet);
    const showBar = this.showHpBar && this.visible && this.hp < this.maxHp && this.hp > 0;
    this.hpBg.setVisible(showBar);
    this.hpFg.setVisible(showBar);
    if (showBar) {
      const top = this.y - 10 * this.scaleY;
      this.hpBg.setPosition(this.x - 6, top).setDepth(10000);
      const r = this.hp / this.maxHp;
      this.hpFg.setPosition(this.x - 6, top).setDepth(10001).setSize(12 * r, 2)
        .setFillStyle(r > 0.5 ? 0x6ee06e : r > 0.25 ? 0xf2c94c : 0xeb5757);
    }
  }

  walk(moving) {
    if (moving) this.anims.play(`${this.texKey}_walk`, true);
    else { this.anims.stop(); this.setFrame(0); }
  }

  moveToward(x, y, speed) {
    const a = Phaser.Math.Angle.Between(this.x, this.y, x, y);
    this.setVelocity(Math.cos(a) * speed, Math.sin(a) * speed);
    if (Math.abs(x - this.x) > 1) this.setFlipX(x < this.x);
    this.walk(true);
    return Phaser.Math.Distance.Between(this.x, this.y, x, y);
  }

  halt() {
    this.setVelocity(0, 0);
    this.walk(false);
  }

  flash(color = 0xffffff) {
    this.setTintFill(color);
    this.scene.time.delayedCall(80, () => { if (this.active) this.clearTint(); });
  }

  knockback(fromX, fromY, force = 120) {
    const a = Phaser.Math.Angle.Between(fromX, fromY, this.x, this.y);
    this.body.velocity.x += Math.cos(a) * force;
    this.body.velocity.y += Math.sin(a) * force;
  }

  destroy(fromScene) {
    this.shadow?.destroy();
    this.hpBg?.destroy();
    this.hpFg?.destroy();
    super.destroy(fromScene);
  }
}
