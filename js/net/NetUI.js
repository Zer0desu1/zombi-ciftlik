// Çok oyunculu arayüz: ana menüdeki "Çok Oyunculu" bölümü (oda kur / odaya katıl, oyuncu adı)
// ve oyun içindeki oda paneli (kod, davet linki, oyuncu listesi + ping).
import { DIFFICULTIES } from '../config.js';
import { audio } from '../audio.js';
import { injectCSS, el } from '../ui/dom.js';
import { normalizeCode } from './transport.js';

const NAME_KEY = 'zombi-ciftlik-net-name';

const CSS = `
.menu-card .menu-btns { flex-wrap:wrap; }
.mp-pick { display:none; text-align:left; margin:-6px 0 18px; padding:14px; border-radius:16px; background:rgba(0,0,0,.25); border:1px solid rgba(255,255,255,.08); }
.mp-pick.show { display:grid; gap:12px; }
.mp-pick h4 { font-size:12px; letter-spacing:2px; text-transform:uppercase; color:var(--muted); margin:0 0 6px; }
.mp-pick input { width:100%; min-height:42px; padding:8px 12px; border-radius:10px; border:1px solid var(--stroke); background:rgba(255,255,255,.07); color:var(--text); font:inherit; font-size:15px; }
.mp-pick input:focus { outline:2px solid var(--accent); outline-offset:1px; }
.mp-pick .mp-btns { display:flex; flex-wrap:wrap; gap:8px; }
.mp-pick .mp-btns button { flex:1 1 30%; min-height:42px; }
.mp-pick .mp-join { display:flex; gap:8px; }
.mp-pick .mp-join input { flex:1; text-transform:uppercase; letter-spacing:2px; }
.mp-pick .mp-join button { min-height:42px; }
.mp-status { min-height:18px; font-size:13px; color:var(--muted); margin:0; }
.mp-status.err { color:var(--red); }
#btn-mp.open { border-color:var(--accent); color:var(--accent); }
#net-panel { position:absolute; top:172px; right:66px; width:200px; padding:10px 12px; font-size:12px; pointer-events:auto; display:none; }
#net-panel.show { display:block; }
body:not(.playing) #net-panel { display:none; }
#net-panel .np-code { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
#net-panel .np-code b { font-family:var(--pixel, monospace); font-size:13px; letter-spacing:1px; color:var(--accent); flex:1; }
#net-panel .np-code button { padding:3px 8px; font-size:11px; min-height:0; }
#net-panel .np-st { color:var(--muted); margin-bottom:4px; }
#net-panel .np-st.err { color:var(--red); }
#net-panel ul { list-style:none; margin:0; padding:0; display:grid; gap:3px; }
#net-panel li { display:flex; align-items:center; gap:6px; }
#net-panel li i { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
#net-panel li span { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#net-panel li em { font-style:normal; color:var(--muted); font-variant-numeric:tabular-nums; }
#net-panel.min ul, #net-panel.min .np-st { display:none; }
body.is-touch #net-panel { top:calc(env(safe-area-inset-top, 0px) + 196px); right:8px; width:150px; padding:7px 9px; font-size:11px; }
@media (max-width: 600px) { #net-panel { top:calc(env(safe-area-inset-top, 0px) + 196px); right:8px; width:150px; padding:7px 9px; font-size:11px; } }
`;

export function playerName() {
  try { return (localStorage.getItem(NAME_KEY) || '').slice(0, 14); } catch { return ''; }
}
function saveName(n) { try { localStorage.setItem(NAME_KEY, n); } catch { /* yok say */ } }

export function inviteLink(code) {
  return `${location.origin}${location.pathname}?oda=${encodeURIComponent(code)}`;
}

function copyText(text) {
  try { navigator.clipboard.writeText(text); return true; } catch { /* aşağıda dene */ }
  try { window.prompt('Kopyala:', text); } catch { /* yok say */ }
  return false;
}

// Ana menüye çok oyunculu bölümünü bağlar.
// cb.onHost(loadSave, diffId, name), cb.onJoin(code, name, setStatus)
export function installNetMenu(scene, hasSave, cb) {
  injectCSS('net', CSS);
  const btn = document.getElementById('btn-mp');
  let box = document.getElementById('mp-pick');
  if (!btn || !box) return;
  box.innerHTML = '';
  const nameIn = el('input');
  nameIn.id = 'mp-name'; nameIn.maxLength = 14; nameIn.placeholder = 'Oyuncu adın'; nameIn.value = playerName();
  const name = () => {
    const n = nameIn.value.trim().replace(/\s+/g, ' ').slice(0, 14) || `Çiftçi${Math.floor(Math.random() * 90 + 10)}`;
    nameIn.value = n; saveName(n);
    return n;
  };
  const sec = (title) => { const s = el('div', 'mp-sec', `<h4>${title}</h4>`); box.appendChild(s); return s; };
  sec('Adın').appendChild(nameIn);

  const host = sec('Oda kur (sen sunucu olursun)');
  const hb = el('div', 'mp-btns');
  Object.values(DIFFICULTIES).forEach((d) => {
    const b = el('button', d.id === 'normal' ? 'primary' : '', `${d.icon} Yeni · ${d.name}`);
    b.dataset.diff = d.id;
    b.addEventListener('click', () => { audio.init(); cb.onHost(false, d.id, name()); });
    hb.appendChild(b);
  });
  if (hasSave) {
    const b = el('button', 'mp-cont', '💾 Kayıttan devam');
    b.addEventListener('click', () => { audio.init(); cb.onHost(true, null, name()); });
    hb.appendChild(b);
  }
  host.appendChild(hb);

  const join = sec('Odaya katıl');
  const row = el('div', 'mp-join');
  const codeIn = el('input');
  codeIn.id = 'mp-code'; codeIn.placeholder = 'ZC-ABCDE'; codeIn.maxLength = 8; codeIn.autocomplete = 'off';
  const jb = el('button', 'primary', 'Katıl');
  jb.id = 'mp-join';
  row.append(codeIn, jb);
  join.appendChild(row);
  const status = el('p', 'mp-status');
  box.appendChild(status);
  const setStatus = (t, err) => { status.textContent = t || ''; status.classList.toggle('err', !!err); jb.disabled = !!t && !err; };
  const doJoin = () => {
    const code = normalizeCode(codeIn.value);
    if (!code) { setStatus('Kod geçersiz (ör. ZC-ABCDE)', true); return; }
    codeIn.value = code;
    audio.init();
    cb.onJoin(code, name(), setStatus);
  };
  jb.addEventListener('click', doJoin);
  codeIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') doJoin(); });
  nameIn.addEventListener('keydown', (e) => e.stopPropagation());

  btn.onclick = () => { btn.classList.toggle('open', box.classList.toggle('show')); };
  // Davet linki: ?oda=KOD → katılma bölümü doğrudan açık
  let invite = null;
  try { invite = normalizeCode(new URLSearchParams(location.search).get('oda')); } catch { /* yok say */ }
  if (invite) {
    codeIn.value = invite;
    box.classList.add('show'); btn.classList.add('open');
    setStatus('Davet edildin! Adını yazıp Katıl\'a bas.');
    jb.disabled = false;
    setTimeout(() => (nameIn.value ? jb : nameIn).focus(), 50);
  }
}

// Oyun içi oda paneli
export class RoomPanel {
  constructor() {
    injectCSS('net', CSS);
    document.getElementById('net-panel')?.remove();
    this.root = el('div', 'glass show');
    this.root.id = 'net-panel';
    this.root.innerHTML = '<div class="np-code"><b>Oda…</b><button class="np-copy" title="Davet linkini kopyala">🔗 Link</button><button class="np-min" title="Küçült">–</button></div><div class="np-st"></div><ul></ul>';
    (document.getElementById('feature-ui') || document.getElementById('ui')).appendChild(this.root);
    this.codeEl = this.root.querySelector('b');
    this.st = this.root.querySelector('.np-st');
    this.list = this.root.querySelector('ul');
    const copy = this.root.querySelector('.np-copy');
    copy.style.display = 'none';
    copy.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.code) return;
      copyText(inviteLink(this.code));
      this.onToast?.('Davet linki kopyalandı 🔗');
    });
    this.root.querySelector('.np-min').addEventListener('click', (e) => { e.stopPropagation(); this.root.classList.toggle('min'); });
    this.copyBtn = copy;
  }

  setCode(code, canInvite) {
    this.code = code;
    this.codeEl.textContent = code;
    this.copyBtn.style.display = canInvite ? '' : 'none';
  }

  setStatus(text, err) {
    this.st.textContent = text || '';
    this.st.classList.toggle('err', !!err);
  }

  // list: [{ name, color, ping, host, me }]
  setRoster(list) {
    const key = JSON.stringify(list);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.list.innerHTML = '';
    for (const p of list) {
      const li = el('li', '', '<i></i><span></span><em></em>');
      li.querySelector('i').style.background = `#${(p.color || 0xffffff).toString(16).padStart(6, '0')}`;
      li.querySelector('span').textContent = `${p.host ? '👑 ' : ''}${p.name}${p.me ? ' (sen)' : ''}`;
      li.querySelector('em').textContent = p.host ? 'host' : `${Math.round(p.ping || 0)} ms`;
      this.list.appendChild(li);
    }
  }

  destroy() { this.root.remove(); }
}

// Uzak panel HTML'indeki ikon dataURL'lerini kısa anahtara çevir / geri aç
export function packIcons(html, entries) {
  if (!html.includes('data:image')) return html;
  const rev = new Map(entries.map(([k, v]) => [v, k]));
  return html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, (u) => (rev.has(u) ? `zcicon:${rev.get(u)}` : u));
}

export function unpackIcons(html, toURL) {
  return html.replace(/zcicon:([\w.-]+)/g, (_, k) => { try { return toURL(k); } catch { return ''; } });
}

// Modal kökünden bir öğeye çocuk indeksi yolu (misafir tıklamasını host'taki aynı öğeye eşlemek için)
export function pathOf(root, node) {
  const p = [];
  while (node && node !== root) {
    const parent = node.parentElement;
    if (!parent) return null;
    p.unshift([...parent.children].indexOf(node));
    node = parent;
  }
  return node === root ? p : null;
}

export function byPath(root, p) {
  let n = root;
  for (const i of p || []) { n = n?.children?.[i]; if (!n) return null; }
  return n;
}
