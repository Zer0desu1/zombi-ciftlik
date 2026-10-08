import { generateTextures } from '../textures.js';
import { features } from '../features/index.js';

// Dokuları ve animasyonları üretip oyun sahnesine geçer.
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  create() {
    generateTextures(this);
    features.forEach((f) => f.textures?.(this));
    ['player', 'npc_farmer', 'npc_merchant', 'npc_guard', 'npc_blacksmith', 'zombie', 'zombie_brute'].forEach((key) => {
      this.anims.create({ key: `${key}_walk`, frames: [{ key, frame: 0 }, { key, frame: 1 }], frameRate: key.startsWith('zombie') ? 4 : 7, repeat: -1 });
    });
    // Font yüklenmesini bekle ki Phaser metinleri doğru fontla çizilsin
    const go = () => this.scene.start('Game');
    if (document.fonts?.ready) document.fonts.ready.then(go); else go();
  }
}
