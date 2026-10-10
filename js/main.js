import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { installDevice, isTouch } from './ui/device.js';

installDevice(); // body.is-touch + jest engelleme (CSS ilk karede doğru düzeni alsın)

const config = {
  type: Phaser.AUTO,           // WebGL, yoksa Canvas
  parent: 'game',
  backgroundColor: '#1a2a1a',
  pixelArt: true,              // keskin pikseller (nearest-neighbor, antialias kapalı)
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
  input: { mouse: { preventDefaultWheel: true }, activePointers: isTouch ? 3 : 1 },
  fps: { target: 60, smoothStep: true },
  scene: [BootScene, GameScene]
};

window.game = new Phaser.Game(config);
