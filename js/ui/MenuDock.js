// Özellik menüsü: mobilde "Menü" sayfası (3 sütun ızgara), masaüstünde sağ kenarda ikon dock.
// scene.featureMenu oyun sırasında doldurulabilir; her açılışta / periyodik olarak dinamik okunur.
import { audio } from '../audio.js';
import { el } from './dom.js';
import { settings, saveSettings, vibrate } from './mobileSettings.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// İkon emoji ya da görsel adresi olabilir
const iconHTML = (ic) => (/^(data:|https?:|\.?\/)/.test(ic || '') ? `<img src="${esc(ic)}" alt="">` : esc(ic || '✨'));

function menuItems(scene) {
  return (scene.featureMenu || []).filter((m) => m && typeof m.open === 'function');
}

// Bir menü öğesini güvenle aç (önce açık pencereyi kapat)
function runItem(scene, item) {
  scene.hud.closeAll();
  audio.sfx('click');
  try { item.open(scene); } catch (err) { console.error('Menü öğesi açılamadı:', item.id, err); scene.hud.toast('Bu panel açılamadı', 'warn'); }
}

// ---------- Mobil Menü sayfası ----------
export function openMobileMenu(scene) {
  const hud = scene.hud;
  const core = [
    { id: 'inv', icon: '🎒', label: 'Envanter', open: (s) => s.hud.toggleInventory() },
    { id: 'quests', icon: '📜', label: 'Görevler', open: (s) => openQuests(s) },
    { id: 'save', icon: '💾', label: 'Kaydet', open: (s) => s.saveGame(true) },
    { id: 'sound', icon: audio.muted ? '🔇' : '🔊', label: audio.muted ? 'Sesi aç' : 'Sesi kapat', open: (s) => { const m = audio.toggleMute(); s.hud.toast(m ? 'Ses kapalı 🔇' : 'Ses açık 🔊', 'info'); } },
    { id: 'settings', icon: '⚙️', label: 'Kontroller', open: (s) => openSettings(s) }
  ];
  const extra = menuItems(scene);
  const body = el('div', 'mm');
  const grid = (list) => {
    const g = el('div', 'mm-grid');
    list.forEach((it) => {
      const b = el('button', 'mm-card', `<span class="ic">${iconHTML(it.icon)}</span><span class="lb">${esc(it.label)}</span>`);
      b.type = 'button';
      b.addEventListener('click', () => { vibrate(10); runItem(scene, it); });
      g.appendChild(b);
    });
    return g;
  };
  if (extra.length) { body.appendChild(el('h4', '', 'Oyun')); body.appendChild(grid(extra)); }
  body.appendChild(el('h4', '', 'Genel'));
  body.appendChild(grid(core));
  hud.openPanel('Menü', body);
}

function openQuests(scene) {
  const list = scene.quests.activeList();
  const html = list.length
    ? list.map((q) => `<div class="mm-quest ${q.progress >= q.amount ? 'ready' : ''}"><b>${esc(q.title)}</b><span>${esc(q.desc)}</span><i>${q.progress}/${q.amount}</i></div>`).join('')
    : '<p class="muted center">Aktif görevin yok. Kasabalılarla konuşarak görev al.</p>';
  scene.hud.openPanel('Görevler', `<div class="mm-quests">${html}</div>`);
}

function openSettings(scene) {
  const body = el('div', 'mm-settings', `
    <label class="mm-row"><span>Titreşim</span><input type="checkbox" data-k="vibrate"></label>
    <label class="mm-row"><span>Sol elle oyna <small class="muted">(butonlar solda, joystick sağda)</small></span><input type="checkbox" data-k="leftHanded"></label>
    <label class="mm-row col"><span>Buton opaklığı <b class="op"></b></span><input type="range" min="40" max="100" step="5" data-k="opacity"></label>
    <p class="muted mm-tip">İpucu: Eylem butonunu basılı tutarak sürüklersen elle nişan alırsın. Yakındaki bir tile'a dokunmak da seçili eşyayı oraya uygular.</p>`);
  const vib = body.querySelector('[data-k=vibrate]');
  const lh = body.querySelector('[data-k=leftHanded]');
  const op = body.querySelector('[data-k=opacity]');
  const opTxt = body.querySelector('.op');
  vib.checked = settings.vibrate;
  lh.checked = settings.leftHanded;
  op.value = Math.round(settings.opacity * 100);
  opTxt.textContent = `%${op.value}`;
  vib.addEventListener('change', () => { settings.vibrate = vib.checked; saveSettings(); vibrate(20); });
  lh.addEventListener('change', () => { settings.leftHanded = lh.checked; saveSettings(); });
  op.addEventListener('input', () => { settings.opacity = Number(op.value) / 100; opTxt.textContent = `%${op.value}`; saveSettings(); });
  scene.hud.openPanel('Kontroller', body);
}

// ---------- Masaüstü dock ----------
export class DesktopDock {
  constructor() {
    this.node = el('nav', 'feature-dock glass');
    this.node.id = 'feature-dock';
    document.getElementById('ui').insertBefore(this.node, document.getElementById('backdrop'));
    this.sig = '';
    this.scene = null;
  }

  attach(scene) { this.scene = scene; this.sig = ''; this.sync(); }

  // Dizi değiştiyse yeniden çiz (ucuz imza karşılaştırması)
  sync() {
    const s = this.scene;
    const list = s ? menuItems(s) : [];
    const sig = list.map((m) => `${m.id}|${m.icon}|${m.label}|${m.key || ''}`).join(';');
    if (sig === this.sig) return;
    this.sig = sig;
    this.node.innerHTML = '';
    list.forEach((it) => {
      const tip = it.key ? `${it.label} (${String(it.key).toUpperCase()})` : it.label;
      const b = el('button', 'dock-btn', `${iconHTML(it.icon)}<span class="tip">${esc(tip)}</span>`);
      b.type = 'button';
      b.setAttribute('aria-label', tip);
      b.addEventListener('click', () => { if (s.started && !s.gameOver) runItem(s, it); });
      this.node.appendChild(b);
    });
    this.node.classList.toggle('show', list.length > 0);
  }
}

// ---------- Bottom-sheet: aşağı kaydırarak kapatma ----------
export function installSheetSwipe(getScene) {
  document.querySelectorAll('#ui .modal').forEach((m) => {
    if (m.querySelector(':scope > .sheet-grab')) return;
    m.insertBefore(el('div', 'sheet-grab'), m.firstChild);
    let startY = null, dy = 0;
    m.addEventListener('touchstart', (e) => {
      const bc = document.body.classList;
      if (!bc.contains('is-touch') || !bc.contains('portrait') || !m.classList.contains('show')) return;
      const t = e.touches[0];
      const top = m.getBoundingClientRect().top;
      // Yalnız üst şerit (tutma çubuğu + başlık) ya da içerik en üstteyken sürükle
      if (t.clientY - top > 64 && m.scrollTop > 0) return;
      if (t.clientY - top > 64 && e.target.closest('.feature-body,.shop-list,#craft-list,.inv-wrap,.options,input')) return;
      startY = t.clientY; dy = 0;
    }, { passive: true });
    m.addEventListener('touchmove', (e) => {
      if (startY === null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      if (dy > 4) { m.style.transition = 'none'; m.style.transform = `translateY(${dy}px)`; }
    }, { passive: true });
    const end = () => {
      if (startY === null) return;
      startY = null;
      m.style.transition = '';
      m.style.transform = '';
      if (dy > 80) { const s = getScene(); if (s?.hud?.isModalOpen()) { s.hud.closeAll(); audio.sfx('click'); } }
      dy = 0;
    };
    m.addEventListener('touchend', end);
    m.addEventListener('touchcancel', end);
  });
}
