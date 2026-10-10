// Çok oyunculu arayüz: ana menüdeki "Çok Oyunculu" bölümü (oda kur / odaya katıl, oyuncu adı)
// ve oyun içindeki oda paneli (kod, davet linki, oyuncu listesi + ping).
import { DIFFICULTIES } from '../config.js';
import { audio } from '../audio.js';
import { injectCSS, el } from '../ui/dom.js';
import { normalizeCode, getTurn, setTurn, parseTurn, encodeTurn, turnLabel } from './transport.js';
import { netLogText, clearNetLog } from './diag.js';

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
#net-panel .np-diag-btn { display:block; width:100%; margin-top:6px; padding:3px 6px; font-size:11px; min-height:0; }
#net-panel .np-diag { display:none; margin-top:6px; padding-top:6px; border-top:1px solid rgba(255,255,255,.12); max-height:52vh; overflow:auto; }
#net-panel.diag { width:260px; }
#net-panel.diag .np-diag { display:block; }
#net-panel.min .np-diag, #net-panel.min .np-diag-btn { display:none; }
#net-panel .np-lines { font-size:11px; line-height:1.45; color:var(--muted); word-break:break-word; margin:0 0 6px; }
#net-panel .np-lines b { color:var(--text); font-weight:600; }
#net-panel .np-adv { font-size:11px; color:#ffd166; margin:0 0 6px; }
#net-panel .np-adv:empty { display:none; }
#net-panel .np-diag button { padding:3px 8px; font-size:11px; min-height:0; margin:2px 4px 2px 0; }
.turn-form { display:grid; gap:4px; margin-top:6px; }
.turn-form h5 { margin:4px 0 0; font-size:11px; color:var(--text); }
.turn-form p { margin:0; font-size:10.5px; color:var(--muted); }
.turn-form input { width:100%; min-height:26px; padding:3px 6px; border-radius:6px; border:1px solid var(--stroke); background:rgba(255,255,255,.07); color:var(--text); font:inherit; font-size:11px; box-sizing:border-box; }
.turn-form .tf-st { min-height:14px; }
.turn-form .tf-st.err { color:var(--red); }
.mp-pick details summary { cursor:pointer; font-size:12px; color:var(--muted); }
.mp-pick .turn-form input { font-size:13px; min-height:34px; }
.mp-pick .turn-form button { min-height:32px; margin-right:6px; }
#net-reconnect { position:absolute; left:50%; top:38%; transform:translate(-50%,-50%); z-index:60; min-width:260px; max-width:min(92vw,420px); padding:16px 18px; text-align:center; pointer-events:auto; display:none; }
#net-reconnect.show { display:block; }
#net-reconnect h3 { margin:0 0 6px; font-size:16px; }
#net-reconnect p { margin:0 0 10px; font-size:12.5px; color:var(--muted); }
#net-reconnect .nr-tip { color:#ffd166; }
#net-reconnect .nr-tip:empty, #net-reconnect .nr-why:empty, #net-reconnect .nr-step:empty { display:none; }
body.is-touch #net-panel.diag, #net-panel.diag { max-width:calc(100vw - 16px); }
body.is-touch #net-panel { top:calc(env(safe-area-inset-top, 0px) + 196px); right:8px; width:150px; padding:7px 9px; font-size:11px; }
@media (max-width: 600px) { #net-panel { top:calc(env(safe-area-inset-top, 0px) + 196px); right:8px; width:150px; padding:7px 9px; font-size:11px; } }
`;

export function playerName() {
  try { return (localStorage.getItem(NAME_KEY) || '').slice(0, 14); } catch { return ''; }
}
function saveName(n) { try { localStorage.setItem(NAME_KEY, n); } catch { /* yok say */ } }

// Davet linki: TURN ayarlıysa misafir de aynı TURN ile bağlansın diye kodlanmış hâli eklenir.
// ?net=local (test) korunur.
export function inviteLink(code) {
  let extra = '';
  try { if (new URLSearchParams(location.search).get('net') === 'local') extra += '&net=local'; } catch { /* yok say */ }
  const t = encodeTurn(getTurn());
  if (t) extra += `&turn=${t}`;
  return `${location.origin}${location.pathname}?oda=${encodeURIComponent(code)}${extra}`;
}

export function copyText(text) {
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) return;
    } catch { /* aşağıda dene */ }
    try { window.prompt('Kopyala:', text); } catch { /* yok say */ }
  };
  try {
    if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).catch(fallback); return true; }
  } catch { /* aşağıda */ }
  fallback();
  return false;
}

// TURN ayar formu (oda paneli ve ana menü): adres (ana makine / turn: URL'leri / iceServers JSON), kullanıcı, şifre
export function turnForm(onChange) {
  const box = el('div', 'turn-form');
  box.innerHTML = '<h5>TURN sunucusu (farklı ağlar için)</h5>'
    + '<p>Farklı evlerden ya da mobil veriden bağlanıyorsanız doğrudan bağlantı NAT yüzünden kurulamayabilir/kopabilir. Ücretsiz bir TURN (ör. Metered.ca) bilgilerini gir; davet linkine otomatik eklenir.</p>'
    + '<input class="tf-url" placeholder="standard.relay.metered.ca · turn:… · ya da iceServers JSON" autocomplete="off">'
    + '<input class="tf-user" placeholder="Kullanıcı adı (username)" autocomplete="off">'
    + '<input class="tf-pass" placeholder="Şifre (credential)" type="password" autocomplete="off">'
    + '<div><button class="tf-save">💾 Kaydet</button><button class="tf-clear">Temizle</button></div><p class="tf-st"></p>';
  const [u, n, pw] = ['.tf-url', '.tf-user', '.tf-pass'].map((q) => box.querySelector(q));
  const st = box.querySelector('.tf-st');
  const show = (t, err) => { st.textContent = t; st.classList.toggle('err', !!err); };
  const cur = getTurn();
  if (cur) {
    const s0 = cur.servers[0];
    u.value = cur.servers.length > 1 ? JSON.stringify(cur.servers) : [].concat(s0.urls).join(', ');
    n.value = s0.username || ''; pw.value = s0.credential || '';
    show(`Etkin: ${turnLabel(cur)}`);
  }
  [u, n, pw].forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
  box.querySelector('.tf-save').addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    try {
      const cfg = parseTurn(u.value, n.value.trim(), pw.value.trim());
      if (!cfg) { show('Adres boş', true); return; }
      setTurn(cfg);
      show(`Kaydedildi: ${turnLabel(cfg)}. Yeni bağlantılarda kullanılır; davet linkini yeniden kopyala.`);
      onChange?.(cfg);
    } catch (err) { show(err.message || String(err), true); }
  });
  box.querySelector('.tf-clear').addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    setTurn(null); u.value = n.value = pw.value = '';
    show('TURN kaldırıldı (yalnızca STUN + PeerJS genel TURN).');
    onChange?.(null);
  });
  return box;
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
  const adv = el('details', 'mp-turn');
  adv.innerHTML = `<summary>${getTurn() ? `⚙️ TURN etkin: ${turnLabel()}` : '⚙️ Gelişmiş: TURN sunucusu (farklı ağlardan bağlanamıyorsanız)'}</summary>`;
  adv.appendChild(turnForm());
  box.appendChild(adv);
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
    // Bağlantı teşhisi (açılır)
    const db = el('button', 'np-diag-btn', '📶 Bağlantı ▸');
    const diag = el('div', 'np-diag', '<div class="np-lines"></div><p class="np-adv"></p><div><button class="np-log">📋 Günlüğü kopyala</button><button class="np-clr">Günlüğü sil</button></div>');
    this.root.append(db, diag);
    this.diagBtn = db;
    this.linesEl = diag.querySelector('.np-lines');
    this.advEl = diag.querySelector('.np-adv');
    diag.appendChild(turnForm(() => { this.onTurn?.(); this.refreshDiag(); }));
    db.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = this.root.classList.toggle('diag');
      db.textContent = on ? '📶 Bağlantı ▾' : '📶 Bağlantı ▸';
      if (on) this.refreshDiag();
    });
    diag.querySelector('.np-log').addEventListener('click', (e) => {
      e.stopPropagation();
      copyText(netLogText(this.lastState));
      this.onToast?.('Bağlantı günlüğü kopyalandı 📋');
    });
    diag.querySelector('.np-clr').addEventListener('click', (e) => { e.stopPropagation(); clearNetLog(); this.refreshDiag(); });
    diag.addEventListener('keydown', (e) => e.stopPropagation());
    this.diagTimer = setInterval(() => { if (this.root.classList.contains('diag')) this.refreshDiag(); }, 1000);
  }

  // provider: async () => ({ lines: [[etiket, değer], …], advice })
  setDiagProvider(fn) { this.diagFn = fn; }

  async refreshDiag() {
    if (!this.diagFn || this.busy) return null;
    this.busy = true;
    try {
      const d = await this.diagFn();
      this.lastState = Object.fromEntries(d.lines || []);
      this.linesEl.innerHTML = '';
      for (const [k, v] of d.lines || []) {
        const row = document.createElement('div');
        const b = document.createElement('b'); b.textContent = k + ': ';
        row.append(b, document.createTextNode(String(v)));
        this.linesEl.appendChild(row);
      }
      this.advEl.textContent = d.advice || '';
      return d;
    } catch (e) { console.warn('Teşhis', e); return null; } finally { this.busy = false; }
  }

  // Yeniden bağlanma göstergesi (ekran ortası): n = deneme sayısı, reason = Türkçe neden
  showReconnect(n, reason, tip, onCancel, step) {
    let o = document.getElementById('net-reconnect');
    if (!o) {
      o = el('div', 'glass', '<h3></h3><p class="nr-why"></p><p class="nr-step"></p><p class="nr-tip"></p><button class="nr-cancel">Vazgeç</button>');
      o.id = 'net-reconnect';
      (document.getElementById('feature-ui') || document.getElementById('ui')).appendChild(o);
    }
    o.querySelector('h3').textContent = `Yeniden bağlanılıyor… (${n})`;
    o.querySelector('.nr-why').textContent = reason ? `Neden: ${reason}` : '';
    o.querySelector('.nr-step').textContent = step || '';
    o.querySelector('.nr-tip').textContent = tip || '';
    o.querySelector('.nr-cancel').onclick = (e) => { e.stopPropagation(); onCancel?.(); };
    o.classList.add('show');
  }

  hideReconnect() { document.getElementById('net-reconnect')?.classList.remove('show'); }

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

  destroy() { clearInterval(this.diagTimer); this.hideReconnect(); this.root.remove(); }
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
