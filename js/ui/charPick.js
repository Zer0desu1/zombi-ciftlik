// Ana menüde karakter seçimi: cinsiyet (Erkek/Kadın) + ad. Tercih cihazda saklanır (localStorage);
// yeni oyunda oyuncuya uygulanır, kayda ise town modülü yazar. Çok oyunculuda misafir de bu tercihi kullanır.
import { injectCSS, el } from './dom.js';
import { iconURL } from '../textures.js';

const GENDER_KEY = 'zombi-ciftlik-gender';
const NAME_KEY = 'zombi-ciftlik-net-name'; // çok oyunculu ad ile ortak (NetUI)

export function prefGender() {
  try { return localStorage.getItem(GENDER_KEY) === 'f' ? 'f' : 'm'; } catch { return 'm'; }
}
export function setPrefGender(g) { try { localStorage.setItem(GENDER_KEY, g === 'f' ? 'f' : 'm'); } catch { /* depolama kapalı */ } }
export function prefName() {
  try { return (localStorage.getItem(NAME_KEY) || '').trim().slice(0, 14); } catch { return ''; }
}
function setPrefName(n) { try { localStorage.setItem(NAME_KEY, n); } catch { /* depolama kapalı */ } }

const CSS = `
.char-pick { display:flex; align-items:center; justify-content:center; gap:8px; flex-wrap:wrap; margin:0 0 14px; }
.char-pick .cp-lbl { font-size:12px; color:var(--muted); letter-spacing:1px; text-transform:uppercase; }
.char-pick .cp-g { display:flex; gap:6px; }
.char-pick .cp-g button { min-height:38px; padding:6px 14px; font-size:14px; display:flex; align-items:center; gap:6px; opacity:.7; }
.char-pick .cp-g button img { width:32px; height:32px; image-rendering:pixelated; }
.char-pick .cp-g button.on { opacity:1; outline:2px solid var(--accent, #ffd166); }
.char-pick input { width:130px; min-height:38px; padding:6px 10px; }
`;

// onChange(gender): menüde değiştirildiğinde (oyun başlamadan) çağrılır
export function installCharPick(scene, onChange) {
  const card = document.querySelector('#menu .menu-card');
  if (!card) return;
  injectCSS('charpick', CSS);
  let box = document.getElementById('char-pick');
  if (!box) {
    box = el('div', 'char-pick');
    box.id = 'char-pick';
    card.querySelector('.menu-btns')?.before(box);
  }
  const portrait = (key) => {
    try { return scene.textures.exists(key) ? iconURL(scene, key) : ''; } catch { return ''; }
  };
  box.innerHTML = `<span class="cp-lbl">Karakter</span>
    <div class="cp-g">
      <button type="button" data-g="m" id="cp-m"><img alt="" src="${portrait('player')}">👨 Erkek</button>
      <button type="button" data-g="f" id="cp-f"><img alt="" src="${portrait('player_f')}">👩 Kadın</button>
    </div>
    <input id="cp-name" maxlength="14" placeholder="Adın" autocomplete="off">`;
  const sync = () => box.querySelectorAll('[data-g]').forEach((b) => b.classList.toggle('on', b.dataset.g === prefGender()));
  box.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => {
    setPrefGender(b.dataset.g);
    sync();
    onChange?.(b.dataset.g);
  }));
  const name = box.querySelector('#cp-name');
  name.value = prefName();
  name.addEventListener('input', () => {
    const n = name.value.trim().slice(0, 14);
    setPrefName(n);
    const mp = document.getElementById('mp-name');
    if (mp && mp.value !== n) mp.value = n;
  });
  sync();
}
