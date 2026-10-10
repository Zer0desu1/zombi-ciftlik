// 'mobile' özellik modülü — dokunmatik/dikey ekran deneyimi + masaüstü özellik dock'u.
// Sözleşme için registry.js'e bak.
import { ZOOM, TILE, ITEMS } from '../config.js';
import { isTouch, pickZoom, installDevice } from '../ui/device.js';
import { applySettings } from '../ui/mobileSettings.js';
import { TouchControls, autoTarget, installTapFilter } from '../ui/TouchControls.js';
import { openMobileMenu, DesktopDock, installSheetSwipe } from '../ui/MenuDock.js';

// DOM bir kez kurulur; sahne yeniden başlarsa yeni sahneye bağlanır
let ctrl = null, dock = null, current = null, globalsDone = false;

function applyZoom(scene) {
  const cam = scene?.cameras?.main;
  if (!cam || !scene.sys?.isActive()) return;
  const z = pickZoom(ZOOM);
  scene.baseZoom = z;
  if (cam.zoom !== z) {
    cam.setZoom(z);
    scene.setupDarkness?.(); // karanlık katmanı yeni görüş boyutuna göre
  }
}

function setupGlobals() {
  if (globalsDone) return;
  globalsDone = true;
  installDevice();
  applySettings();
  dock = new DesktopDock();
  if (isTouch) {
    ctrl = new TouchControls();
    ctrl.onMenu = (s) => openMobileMenu(s);
    installTapFilter(() => current);
  }
  installSheetSwipe(() => current);
  window.addEventListener('orientationchange', () => setTimeout(() => { if (current) applyZoom(current); }, 250));
}

export default {
  id: 'mobile',

  init(scene) {
    setupGlobals();
    current = scene;
    scene.isTouch = isTouch;
    scene.lowFx = isTouch; // diğer modüller efekt yoğunluğunu buna göre azaltabilir
    document.body.classList.remove('playing');
    ctrl?.attach(scene);
    dock.attach(scene);
    applyZoom(scene);
    const onResize = () => applyZoom(scene);
    scene.scale.on('resize', onResize);
    scene.events.once('shutdown', () => {
      scene.scale.off('resize', onResize);
      ctrl?.releaseAll();
      if (current === scene) current = null;
    });
    this.tick = 0;
    this.slow = 0;
    this.target = null;
  },

  begin(scene) {
    document.body.classList.add('playing');
    applyZoom(scene);
    dock.attach(scene);
    if (isTouch) {
      scene.time.delayedCall(2400, () => scene.hud?.toast('Sol altta sürükleyerek yürü, sağdaki büyük butonla eşyanı kullan.', 'info'));
    }
  },

  update(scene, dt) {
    this.slow += dt;
    if (this.slow >= 1) {
      this.slow = 0;
      dock.sync();
      if (ctrl) {
        let ready = false;
        try { ready = scene.quests.activeList().some((q) => q.progress >= q.amount); } catch { /* yoksay */ }
        ctrl.setMenuDot(ready);
      }
    }
    if (!ctrl) return;
    // Otomatik hedefi 100ms'de bir hesapla, imleç/önizlemeyi her kare ona sabitle
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.1;
      this.target = scene.player.alive ? autoTarget(scene, ctrl.aim) : null;
      ctrl.refresh(this.target);
    }
    showTarget(scene, this.target);
  }
};

// GameScene.updateMarker fare imlecine göre çizer; dokunmatikte eylem hedefini göster
function showTarget(scene, t) {
  const m = scene.marker, g = scene.ghost;
  if (!m || !g) return;
  const slot = scene.inventory.slots[scene.selected];
  const type = slot ? ITEMS[slot.id]?.type : null;
  if (!t || (t.kind !== 'tile' && t.kind !== 'none')) { m.setVisible(false); g.setVisible(false); return; }
  const cx = Math.floor(t.x / TILE) * TILE + 8, cy = Math.floor(t.y / TILE) * TILE + 8;
  const ok = t.kind === 'tile';
  if (!slot && !ok) { m.setVisible(false); g.setVisible(false); return; }
  if (type === 'place' && t.label !== 'Hasat') {
    m.setVisible(false);
    g.setVisible(true).setTexture(slot.id).setPosition(cx, cy).setTint(ok ? 0x88ff88 : 0xff6666);
    return;
  }
  g.setVisible(false);
  m.setVisible(true).setPosition(cx, cy).setTint(ok ? 0xffffff : 0xff6666);
}
