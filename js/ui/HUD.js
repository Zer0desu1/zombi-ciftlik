import { ITEMS, RECIPES, SHOPS, HOTBAR_SIZE, DIFFICULTIES } from '../config.js';
import { iconURL } from '../textures.js';
import { audio } from '../audio.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// Tüm oyun içi arayüz DOM üzerinde (keskin font + glassmorphism için).
// Üretim sekmeleri: çıktı eşyasının türüne göre
const CRAFT_TABS = [
  { id: 'food', icon: '🍞', label: 'Yemek' },
  { id: 'weapon', icon: '⚔️', label: 'Silah' },
  { id: 'defense', icon: '🛡️', label: 'Savunma' },
  { id: 'farm', icon: '🌱', label: 'Tarım' },
  { id: 'other', icon: '📦', label: 'Diğer' }
];
const FARM_IDS = ['fertilizer', 'feed', 'sprinkler', 'scarecrow'];
export function craftCategory(id) {
  const d = ITEMS[id];
  if (!d) return 'other';
  if (d.type === 'food' || d.heal) return 'food';
  if (['weapon', 'gun', 'throw'].includes(d.type) || id === 'ammo' || id === 'arrow') return 'weapon';
  if (d.type === 'place' || id === 'turret') return 'defense';
  if (d.type === 'seed' || d.type === 'farm' || FARM_IDS.includes(id)) return 'farm';
  return 'other';
}

export class HUD {
  constructor(scene) {
    this.scene = scene;
    this.modal = null;          // 'inventory' | 'dialog' | 'shop' | null
    this.pickedSlot = null;     // envanterde taşınan slot
    this.shopTab = 'buy';
    this.e = {
      clock: $('#hud-clock'), day: $('#hud-day'), phase: $('#hud-phase'),
      hp: $('#hud-hp'), hpTxt: $('#hud-hp-txt'), en: $('#hud-en'), enTxt: $('#hud-en-txt'),
      coins: $('#hud-coins'), wave: $('#hud-wave'), zombies: $('#hud-zombies'),
      shelter: $('#hud-shelter'), hotbar: $('#hotbar'), hint: $('#hint'), toasts: $('#toasts'),
      quests: $('#quest-tracker'), itemName: $('#item-name'),
      inv: $('#modal-inventory'), invGrid: $('#inv-grid'), craftList: $('#craft-list'), invInfo: $('#inv-info'),
      dialog: $('#modal-dialog'), shop: $('#modal-shop'), feature: $('#modal-feature'), backdrop: $('#backdrop')
    };
    this.e.backdrop.addEventListener('click', () => this.closeAll());
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeAll()));
    scene.inventory.onChange(() => this.refreshInventory());
    const press = (e) => { this.pressing = !!e.target.closest?.('.modal'); };
    const release = () => {
      if (!this.pressing) return;
      this.pressing = false;
      // click olayı pointerup'tan sonra gelir: önce o işlensin
      if (this.refreshPending) setTimeout(() => { this.refreshPending = false; this.refreshInventory(); }, 0);
    };
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', release);
    scene.events.once('shutdown', () => {
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      window.removeEventListener('blur', release);
    });
    scene.events.on('questsChanged', () => this.renderQuests());
    this.bars = ['hp', 'en', 'shelter'].map((k) => {
      const fill = this.e[k];
      return { fill, wrap: fill.parentNode, trail: fill.parentNode.querySelector('.trail'), v: -1 };
    });
    this.bannerQueue = [];
    this.bannerUntil = 0;
    // Sahne yeniden başlarken (restart) eski ipucu öğesi yeniden kullanılır
    this.tip = document.getElementById('item-tip') || document.body.appendChild(Object.assign(el('div'), { id: 'item-tip' }));
    this.tip.classList.remove('show');
    this.buildHotbar();
    this.renderQuests();
  }

  icon(key) { return iconURL(this.scene, ITEMS[key]?.icon || key); }

  isModalOpen() { return !!this.modal; }

  // ---------- Üst bar ----------
  update() {
    const s = this.scene, p = s.player, t = s.timeSys;
    this.e.clock.textContent = t.clock;
    this.e.day.textContent = `Gün ${t.day}`;
    this.e.phase.textContent = t.isNight ? '🌙' : (t.minutes >= 17 * 60 ? '🌇' : '☀️');
    document.body.classList.toggle('night', t.isNight);
    const [hp, en, sh] = this.bars;
    this.setBar(hp, (Math.max(0, p.hp) / p.maxHp) * 100, 30);
    this.e.hpTxt.textContent = Math.ceil(Math.max(0, p.hp));
    this.setBar(en, (p.energy / p.maxEnergy) * 100, 0);
    this.e.enTxt.textContent = Math.ceil(p.energy);
    if (String(p.coins) !== this.e.coins.textContent) {
      const c = this.e.coins;
      c.textContent = p.coins;
      c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
    }
    this.e.wave.textContent = s.waves.active ? `Dalga ${s.waves.wave}` : `Sonraki: ${s.waves.wave + 1}`;
    this.e.zombies.textContent = s.waves.active ? s.waves.remaining : '—';
    this.setBar(sh, (s.shelter.hp / s.shelter.maxHp) * 100, 30);
  }

  // Dolgu hemen, iz (trail) gecikmeli iner; artışta iz anında yetişir. low: bu yüzdenin altında nabız
  setBar(b, pct, low) {
    pct = Math.max(0, Math.min(100, pct || 0));
    if (Math.abs(pct - b.v) < 0.05) return;
    const drop = b.v >= 0 && pct < b.v;
    b.fill.style.width = `${pct}%`;
    if (b.trail) {
      b.trail.style.transition = drop ? '' : 'none';
      b.trail.style.width = `${pct}%`;
    }
    if (drop && b.v - pct >= 3) { b.wrap.classList.remove('hit'); void b.wrap.offsetWidth; b.wrap.classList.add('hit'); }
    b.wrap.classList.toggle('low', pct < low && pct > 0);
    b.v = pct;
  }

  // ---------- Hotbar ----------
  buildHotbar() {
    this.e.hotbar.innerHTML = '';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = el('div', 'slot');
      slot.dataset.i = i;
      slot.addEventListener('click', () => { this.scene.selectSlot(i); audio.sfx('click'); });
      slot.addEventListener('mouseenter', () => this.showTip(slot, this.scene.inventory.slots[i]?.id, this.scene.inventory.slots[i]?.count));
      slot.addEventListener('mouseleave', () => this.hideTip());
      this.e.hotbar.appendChild(slot);
    }
    this.renderHotbar();
  }

  slotHTML(s, i) {
    const key = i < HOTBAR_SIZE ? `<span class="key">${i + 1}</span>` : '';
    if (!s) return key;
    return `${key}<img src="${this.icon(s.id)}" alt="">${s.count > 1 ? `<span class="count">${s.count}</span>` : ''}`;
  }

  renderHotbar() {
    const inv = this.scene.inventory;
    [...this.e.hotbar.children].forEach((node, i) => {
      node.innerHTML = this.slotHTML(inv.slots[i], i);
      node.classList.toggle('active', i === this.scene.selected);
    });
    this.centerSelected();
    const cur = inv.slots[this.scene.selected];
    this.e.itemName.textContent = cur ? ITEMS[cur.id].name : '';
    this.e.itemName.classList.remove('show');
    void this.e.itemName.offsetWidth;
    if (cur) this.e.itemName.classList.add('show');
  }

  // Dar ekranda (kaydırılabilir hotbar) seçili slotu ortala
  centerSelected() {
    const hb = this.e.hotbar;
    if (hb.scrollWidth <= hb.clientWidth + 2) return;
    const node = hb.children[this.scene.selected];
    if (!node) return;
    const left = node.offsetLeft - (hb.clientWidth - node.offsetWidth) / 2;
    try { hb.scrollTo({ left, behavior: 'smooth' }); } catch { hb.scrollLeft = left; }
  }

  // Eşya ipucu: hedef öğenin üstünde (sığmazsa altında) yüzer; dokunmatikte CSS ile gizli
  showTip(anchor, id, count) {
    const d = id && ITEMS[id];
    if (!d) { this.hideTip(); return; }
    const stats = [];
    if (count > 1) stats.push(`×${count}`);
    if (d.heal) stats.push(`+${d.heal} ❤`);
    if (d.energy) stats.push(`+${d.energy} ⚡`);
    if (d.sell) stats.push(`${d.sell} 🪙`);
    const t = this.tip;
    t.innerHTML = `<b></b><div class="tt-desc"></div>${stats.length ? `<div class="tt-stats">${stats.map((x) => `<span>${x}</span>`).join('')}</div>` : ''}`;
    t.querySelector('b').textContent = d.name;
    t.querySelector('.tt-desc').textContent = d.desc || '';
    const r = anchor.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    const top = r.top - h - 10 >= 8 ? r.top - h - 10 : r.bottom + 10;
    t.style.left = `${left}px`;
    t.style.top = `${top}px`;
    t.classList.add('show');
  }

  hideTip() { this.tip.classList.remove('show'); }

  hint(text) {
    text = text || '';
    if (this.lastHint === text) return;
    this.lastHint = text;
    this.e.hint.textContent = text;
    this.e.hint.classList.toggle('show', !!text);
  }

  toast(msg, type = 'info') {
    const touch = document.body.classList.contains('is-touch');
    const html = touch ? touchText(msg) : String(msg);
    // Aynı mesaj hâlâ ekrandaysa yenisini yığmak yerine sayacını artır ve süresini uzat
    const same = [...this.e.toasts.children].find((n) => n.dataset.msg === html && !n.classList.contains('out'));
    if (same) {
      same.dataset.n = Number(same.dataset.n || 1) + 1;
      let badge = same.querySelector(':scope > .n');
      if (!badge) { badge = el('span', 'n'); same.appendChild(badge); }
      badge.textContent = `×${same.dataset.n}`;
      same.classList.remove('again'); void same.offsetWidth; same.classList.add('again');
      this.e.toasts.appendChild(same);
      this.armToast(same);
      return;
    }
    const t = el('div', `toast ${type}`);
    t.innerHTML = `<span>${html}</span>`;
    t.dataset.msg = html;
    this.e.toasts.appendChild(t);
    this.armToast(t);
    // Dar ekranda en fazla 3 bildirim üst üste
    while (this.e.toasts.children.length > (touch ? 3 : 5)) this.e.toasts.firstChild.remove();
  }

  armToast(t) {
    clearTimeout(t._out); clearTimeout(t._rm);
    t._out = setTimeout(() => t.classList.add('out'), 2600);
    t._rm = setTimeout(() => t.remove(), 3000);
  }

  // Aynı uyarıyı kısa sürede tekrar tekrar göstermemek için
  // Eylem uyarıları (Çok uzak, yorgunsun…) artık ekrana yazılmaz; çağıranlar zaten hata sesi çalar
  notice(msg) {
    if (!this.showNotices) return;
    const now = performance.now();
    if (this.lastNotice === msg && now - this.lastNoticeAt < 1500) return;
    this.lastNotice = msg; this.lastNoticeAt = now;
    this.toast(msg, 'warn');
  }

  // Banner'lar sıraya girer (aynı anda gelen şafak + sürü temizlendi + mevsim üst üste binmesin);
  // kuyruk uzadıkça her biri kısalır
  banner(title, sub) {
    if (this.bannerQueue.some((q) => q[0] === title) || (this.bannerCur === title && performance.now() < this.bannerUntil)) return;
    this.bannerQueue.push([title, sub || '']);
    if (!this.bannerTimer) this.nextBanner();
  }

  nextBanner() {
    const item = this.bannerQueue.shift();
    if (!item) { this.bannerTimer = null; return; }
    const ms = this.bannerQueue.length ? 2200 : 3200;
    const b = $('#banner');
    b.querySelector('h2').textContent = item[0];
    b.querySelector('p').textContent = item[1];
    b.style.setProperty('--banner-ms', `${ms}ms`);
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    this.bannerCur = item[0];
    this.bannerUntil = performance.now() + ms;
    // Kuyrukta bekleyen varsa solma bitmeden sıradakine geç
    this.bannerTimer = setTimeout(() => this.nextBanner(), this.bannerQueue.length ? ms - 300 : ms);
  }

  renderQuests() {
    const list = this.scene.quests.activeList();
    this.e.quests.innerHTML = list.length ? '<h4>Görevler</h4>' + list.map((q) =>
      `<div class="q ${q.progress >= q.amount ? 'ready' : ''}"><b>${q.title}</b><span>${q.desc}</span><i>${q.progress}/${q.amount}</i></div>`).join('') : '';
    this.e.quests.classList.toggle('show', list.length > 0);
  }

  // ---------- Modallar ----------
  open(name) {
    this.closeAll(true);
    this.modal = name;
    this.e.backdrop.classList.add('show');
    this.e[name === 'inventory' ? 'inv' : name].classList.add('show');
    document.body.classList.add('modal-open');
    this.modalName = name;
    this.scene.onModal(true);
  }

  closeAll(silent) {
    ['inv', 'dialog', 'shop', 'feature'].forEach((k) => this.e[k].classList.remove('show'));
    this.hideTip();
    if (this.onPanelClose) { const fn = this.onPanelClose; this.onPanelClose = null; fn(); }
    this.e.backdrop.classList.remove('show');
    document.body.classList.remove('modal-open');
    const was = this.modal;
    this.modal = null;
    this.pickedSlot = null;
    if (was && !silent) this.scene.onModal(false);
  }

  // Özellik modülleri için genel modal: oyunu duraklatır, Esc/arka plan ile kapanır.
  // title: başlık, body: HTMLElement veya HTML string, onClose: kapanınca çağrılır
  openPanel(title, body, onClose) {
    this.open('feature');
    const m = this.e.feature;
    m.querySelector('.feature-title').textContent = title;
    const content = m.querySelector('.feature-body');
    content.innerHTML = '';
    if (typeof body === 'string') content.innerHTML = body; else if (body) content.appendChild(body);
    this.onPanelClose = onClose || null;
    return content;
  }

  toggleInventory() {
    if (this.modal === 'inventory') { this.closeAll(); return; }
    this.open('inventory');
    this.refreshInventory();
  }

  refreshInventory() {
    // Fare/parmak basılıyken listeyi yeniden çizmek tıklamayı yutar (basılan düğüm silinir); bırakınca çiz
    if (this.pressing) { this.refreshPending = true; return; }
    this.renderHotbar();
    this.renderQuests();
    if (this.modal === 'inventory') { this.renderInvGrid(); this.renderCrafting(); }
    if (this.modal === 'shop') this.renderShop();
  }

  renderInvGrid() {
    const inv = this.scene.inventory;
    this.hideTip(); // eski düğümler siliniyor; mouseleave gelmeyecek
    this.e.invGrid.innerHTML = '';
    inv.slots.forEach((s, i) => {
      const node = el('div', `slot${i < HOTBAR_SIZE ? ' hot' : ''}${this.pickedSlot === i ? ' picked' : ''}`, this.slotHTML(s, i));
      node.addEventListener('click', () => {
        audio.sfx('click');
        if (this.pickedSlot === null) { if (s) this.pickedSlot = i; this.showInfo(s); this.renderInvGrid(); return; }
        const a = this.pickedSlot; this.pickedSlot = null;
        if (a !== i) inv.swap(a, i); else this.renderInvGrid();
      });
      node.addEventListener('mouseenter', () => { this.showInfo(s); this.showTip(node, s?.id, s?.count); });
      node.addEventListener('mouseleave', () => this.hideTip());
      this.e.invGrid.appendChild(node);
    });
    this.renderGive();
  }

  // Co-op: seçili eşyayı ya da parayı takım arkadaşına ver. Yalnızca host'ta çizilir (misafirin envanter
  // paneli host'taki kopyadan gelir, tıklamalar host'ta misafir bağlamında çalışır); tek oyunculuda gizli.
  renderGive() {
    const net = this.scene.net, inv = this.scene.inventory;
    let box = this.e.inv.querySelector('.inv-give');
    const mates = net?.isHost && net.teammates ? net.teammates() : [];
    if (!mates.length) { box?.remove(); return; }
    if (!box) { box = el('div', 'inv-give'); this.e.invInfo.after(box); }
    const i = this.pickedSlot, s = i != null ? inv.slots[i] : null;
    const coins = Math.floor(this.scene.player?.coins || 0);
    box.innerHTML = s
      ? `<div class="give-h">🎁 <b>Ver:</b> ${ITEMS[s.id]?.name || s.id} <span class="muted">×${s.count}</span></div>`
      : `<div class="give-h">🎁 <b>Ver</b> <span class="muted">· eşya vermek için önce bir eşya seç · 🪙 Para ver</span></div>`;
    for (const m of mates) {
      const row = el('div', 'give-row');
      const name = el('span', 'give-name');
      name.textContent = m.name; // misafir adı: HTML olarak yorumlanmasın
      if (Number.isFinite(m.color)) name.style.color = `#${m.color.toString(16).padStart(6, '0')}`;
      row.appendChild(name);
      const btn = (label, cls, fn, off) => {
        const b = el('button', `give-btn${cls ? ` ${cls}` : ''}`);
        b.textContent = label;
        if (off) b.disabled = true; else b.addEventListener('click', fn);
        row.appendChild(b);
      };
      const cnt = () => inv.slots[i]?.count || 0;
      if (s) {
        btn('🎁 1', '', () => net.giveItem(m.id, i, 1));
        if (s.count > 2) btn('Yarı', '', () => net.giveItem(m.id, i, Math.ceil(cnt() / 2)));
        if (s.count > 1) btn('Hepsi', '', () => net.giveItem(m.id, i, cnt()));
      }
      btn('🪙 10', 'coin', () => net.giveCoins(m.id, 10), coins < 10);
      btn('🪙 50', 'coin', () => net.giveCoins(m.id, 50), coins < 50);
      box.appendChild(row);
    }
  }

  showInfo(s) {
    if (!s) {
      const touch = document.body.classList.contains('is-touch');
      this.e.invInfo.innerHTML = `<span class="muted">${touch ? 'Bir eşyaya dokun.' : 'Bir eşyanın üzerine gel.'} Yer değiştirmek için iki slota sırayla ${touch ? 'dokun' : 'tıkla'}.</span>`;
      return;
    }
    const d = ITEMS[s.id];
    const extra = d.heal ? ` · +${d.heal} can, +${d.energy} enerji` : '';
    this.e.invInfo.innerHTML = `<b>${d.name}</b> <span class="muted">×${s.count}${extra}${d.sell ? ` · ${d.sell}🪙` : ''}</span><br><span class="muted">${d.desc || ''}</span>`;
  }

  renderCrafting() {
    const inv = this.scene.inventory;
    this.e.craftList.innerHTML = '';
    // Kategoriler: yemekler, silahlar, savunma, tarım ve diğer malzemeler ayrı sekmelerde
    const counts = {};
    RECIPES.forEach((r) => { const c = craftCategory(r.out); counts[c] = (counts[c] || 0) + 1; });
    if (!counts[this.craftTab]) this.craftTab = CRAFT_TABS.find((t) => counts[t.id])?.id || 'food';
    const tabs = el('div', 'craft-tabs');
    CRAFT_TABS.forEach((t) => {
      if (!counts[t.id]) return;
      const ready = RECIPES.some((r) => craftCategory(r.out) === t.id && inv.has(r.cost));
      const b = el('button', `craft-tab ${t.id === this.craftTab ? 'on' : ''}${ready ? ' ready' : ''}`, `${t.icon} ${t.label}`);
      b.addEventListener('click', () => { audio.sfx('click'); this.craftTab = t.id; this.renderCrafting(); });
      tabs.appendChild(b);
    });
    this.e.craftList.appendChild(tabs);
    RECIPES.filter((r) => craftCategory(r.out) === this.craftTab).forEach((r) => {
      const ok = inv.has(r.cost);
      const cost = Object.entries(r.cost).map(([id, n]) =>
        `<span class="cost ${inv.count(id) >= n ? '' : 'miss'}"><img src="${this.icon(id)}" alt="">${inv.count(id)}/${n}</span>`).join('');
      const row = el('div', `recipe ${ok ? 'ready' : 'locked'}`,
        `<img class="out" src="${this.icon(r.out)}" alt=""><div class="rinfo"><b>${ITEMS[r.out].name}${r.qty > 1 ? ` ×${r.qty}` : ''}</b><div>${cost}</div></div><button ${ok ? '' : 'disabled'}>Üret</button>`);
      const out = row.querySelector('img.out');
      out.addEventListener('mouseenter', () => this.showTip(out, r.out, r.qty));
      out.addEventListener('mouseleave', () => this.hideTip());
      row.querySelector('button').addEventListener('click', () => {
        if (inv.craft(r)) { audio.sfx('craft'); this.toast(`${ITEMS[r.out].name} üretildi`, 'ok'); } else audio.sfx('error');
      });
      this.e.craftList.appendChild(row);
    });
  }

  // ---------- NPC diyaloğu ----------
  openDialog(npc) {
    this.npc = npc;
    this.open('dialog');
    this.renderDialog(npc.talkLine());
  }

  // custom: verilirse sadece bu seçenekler gösterilir [[etiket, fn, sınıf], ...]
  renderDialog(text, custom) {
    const npc = this.npc, q = this.scene.quests, d = this.e.dialog;
    d.querySelector('.portrait').src = iconURL(this.scene, npc.texKey);
    d.querySelector('.npc-name').textContent = npc.npcName;
    d.querySelector('.npc-role').textContent = `${npc.role} · ${this.activityName(npc)}`;
    d.querySelector('.npc-text').textContent = text;
    const opts = d.querySelector('.options');
    opts.innerHTML = '';
    const btn = (label, fn, cls = '') => { const b = el('button', cls, label); b.addEventListener('click', () => { audio.sfx('click'); fn(); }); opts.appendChild(b); };
    if (custom) { custom.forEach((c) => btn(...c)); return; }

    if (npc.shop) btn('🛒 Ticaret', () => this.openShop(npc));
    const info = q.forNpc(npc.key);
    if (info?.status === 'available') {
      btn(`❗ Görev: ${info.quest.title}`, () => {
        this.renderDialog(`${info.quest.desc} Ödül: ${this.rewardText(info.quest.reward)}`, [
          ['Kabul et', () => { q.accept(info.quest.id); audio.sfx('quest'); this.toast(`Yeni görev: ${info.quest.title}`, 'ok'); this.renderDialog('Güveniyorum sana!'); }, 'primary'],
          ['Belki sonra', () => this.renderDialog(npc.talkLine()), 'ghost']
        ]);
      }, 'accent');
    } else if (info?.status === 'active') {
      if (q.canComplete(info.quest.id)) {
        btn(`✅ Teslim et: ${info.quest.title}`, () => {
          q.complete(info.quest.id); audio.sfx('quest');
          this.toast(`Görev tamamlandı! ${this.rewardText(info.quest.reward)}`, 'ok');
          this.renderDialog('Harika iş çıkardın, teşekkürler!');
        }, 'primary');
      } else {
        const prog = q.progress(info.quest);
        btn(`⏳ ${info.quest.title} (${prog}/${info.quest.amount})`, () => this.renderDialog(`Hâlâ bekliyorum: ${info.quest.desc}`));
      }
    }
    btn('💬 Sohbet', () => this.renderDialog(npc.talkLine()));
    btn('Hoşça kal', () => this.closeAll(), 'ghost');
  }

  activityName(npc) {
    const map = { tend: 'tarlada', goWater: 'sulamaya gidiyor', watering: 'suluyor', tradeStand: 'tezgâhta', stroll: 'dolaşıyor', forge: 'örste çalışıyor', fixShelter: 'sığınağı onarıyor', findRepair: 'iş arıyor', repair: 'barikat onarıyor', patrol: 'devriyede', combat: 'savaşıyor', retreat: 'geri çekiliyor', heal: 'iyileşiyor', goShelter: 'eve gidiyor', flee: 'kaçıyor', sheltered: 'sığınakta' };
    return map[npc.sm.name] || npc.sm.name;
  }

  rewardText(r) {
    const parts = [];
    if (r.coins) parts.push(`${r.coins}🪙`);
    Object.entries(r.items || {}).forEach(([id, n]) => parts.push(`${n}× ${ITEMS[id].name}`));
    return parts.join(', ');
  }

  // ---------- Dükkân ----------
  openShop(npc) {
    this.npc = npc;
    this.shopTab = 'buy';
    this.open('shop');
    const sh = this.e.shop;
    sh.querySelector('.shop-title').textContent = `${npc.npcName} · ${npc.role}`;
    sh.querySelectorAll('.tab').forEach((t) => {
      t.onclick = () => { this.shopTab = t.dataset.tab; audio.sfx('click'); this.renderShop(); };
    });
    this.renderShop();
  }

  renderShop() {
    const sh = this.e.shop, list = sh.querySelector('.shop-list'), p = this.scene.player, inv = this.scene.inventory;
    sh.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === this.shopTab));
    sh.querySelector('.shop-coins').textContent = `${p.coins} 🪙`;
    list.innerHTML = '';
    if (this.shopTab === 'buy') {
      SHOPS[this.npc.shop].forEach((o) => {
        const ok = p.coins >= o.price;
        const row = el('div', 'shop-row', `<img src="${this.icon(o.id)}" alt=""><div class="rinfo"><b>${ITEMS[o.id].name}${o.qty > 1 ? ` ×${o.qty}` : ''}</b><span class="muted">${ITEMS[o.id].desc || ''}</span></div><button ${ok ? '' : 'disabled'}>${o.price} 🪙</button>`);
        row.querySelector('button').addEventListener('click', () => {
          if (p.coins < o.price) { audio.sfx('error'); return; }
          const left = inv.add(o.id, o.qty);
          if (left === o.qty) { this.toast('Envanter dolu!', 'warn'); audio.sfx('error'); return; }
          p.addCoins(-o.price); audio.sfx('coin');
          this.renderShop();
        });
        list.appendChild(row);
      });
    } else {
      const seen = new Set();
      inv.slots.forEach((s) => {
        if (!s || seen.has(s.id) || !ITEMS[s.id].sell) return;
        seen.add(s.id);
        const d = ITEMS[s.id], n = inv.countExact(s.id);
        const row = el('div', 'shop-row', `<img src="${this.icon(s.id)}" alt=""><div class="rinfo"><b>${d.name}</b><span class="muted">Elinde: ${n} · birimi ${d.sell}🪙</span></div><button>1 sat</button><button class="primary">Hepsi (${n * d.sell}🪙)</button>`);
        const [one, all] = row.querySelectorAll('button');
        one.addEventListener('click', () => { if (inv.countExact(s.id) > 0 && inv.remove(s.id, 1)) p.addCoins(d.sell); });
        all.addEventListener('click', () => { const k = inv.countExact(s.id); if (k > 0 && inv.remove(s.id, k)) p.addCoins(k * d.sell); });
        list.appendChild(row);
      });
      if (!seen.size) list.innerHTML = '<p class="muted center">Satacak bir şeyin yok.</p>';
    }
  }

  // ---------- Menü / oyun sonu ----------
  showMenu(hasSave, onContinue, onNew, records) {
    const m = $('#menu');
    m.classList.add('show');
    const cont = $('#btn-continue');
    cont.style.display = hasSave ? '' : 'none';
    cont.onclick = () => { m.classList.remove('show'); onContinue(); };
    const r = records || {};
    const rec = (v, label) => `<div class="rec"><b>${v}</b><span>${label}</span></div>`;
    $('#menu-records').innerHTML = r.runs
      ? rec(r.bestScore, '🏆 Rekor') + rec(r.bestDay, 'En uzun gün') + rec(r.bestWave, 'En iyi dalga')
        + (r.wins ? rec(r.wins, 'Zafer') : '') + (r.bestEndless ? rec(r.bestEndless, 'Sonsuz') : '')
      : '';
    // Yeni oyun → zorluk seçimi (kartlar: tehlike çubukları + ödül çarpanı)
    const pick = $('#diff-pick');
    pick.innerHTML = '';
    Object.values(DIFFICULTIES).forEach((d, i) => {
      const pips = [0, 1, 2].map((k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('');
      const b = el('button', `d-${d.id}${d.id === 'normal' ? ' primary' : ''}`,
        `<span class="d-ic">${d.icon}</span><b>${d.name}</b><span class="d-pips" aria-hidden="true">${pips}</span><small>${d.desc}</small><span class="d-rw">Puan ×${d.reward}</span>`);
      b.addEventListener('click', () => { audio.init(); m.classList.remove('show'); onNew(d.id); });
      pick.appendChild(b);
    });
    $('#btn-new').onclick = () => {
      if (hasSave && !pick.classList.contains('show') && !confirm('Mevcut kayıt silinecek. Emin misin?')) return;
      $('#btn-new').classList.toggle('open', pick.classList.toggle('show'));
    };
  }

  showGameOver(stats, onRestart) {
    const g = $('#gameover');
    g.classList.toggle('win', !!stats.victory);
    g.querySelector('.go-title').textContent = stats.victory ? 'Kurtarıldınız!' : 'Kasaba Düştü';
    g.querySelector('.stats').textContent = stats.victory
      ? `Kurtarma ekibi ${stats.day}. günde geldi. ${stats.wave} dalga atlatıldı, ${stats.kills} zombi öldürüldü.`
      : `${stats.day}. günde, ${stats.wave}. dalgada kasaba düştü. Öldürülen zombi: ${stats.kills}`;
    const r = stats.records || {};
    const chips = g.querySelector('.go-chips');
    if (chips) chips.innerHTML = [[stats.day, '📅 Gün'], [stats.wave, '🌊 Dalga'], [stats.kills, '🧟 Öldürme']]
      .map(([v, l]) => `<div><b>${v ?? 0}</b><span>${l}</span></div>`).join('');
    g.querySelector('.go-score').innerHTML = `<div class="score">0</div>${stats.newBest ? '<div class="best">🎉 Yeni rekor!</div>' : ''}<div class="muted">${stats.newBest ? '' : `Rekor: ${r.bestScore ?? 0} · `}${DIFFICULTIES[stats.difficulty]?.name || ''}</div>`;
    countUp(g.querySelector('.go-score .score'), stats.score ?? 0);
    this.bannerQueue.length = 0;
    g.classList.add('show');
    g.querySelector('button').onclick = () => { g.classList.remove('show'); onRestart(); };
  }
}

// Oyun sonu puanı sıfırdan sayarak gelir (kart giriş animasyonunun ardından)
function countUp(node, target) {
  const t0 = performance.now() + 450, dur = 1100;
  const step = (now) => {
    const k = Math.min(1, Math.max(0, (now - t0) / dur));
    node.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
    if (k < 1 && node.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Dokunmatikte klavye ipuçlarını buton karşılıklarına çevir ("E tuşuyla" → "✋ ile")
function touchText(msg) {
  return String(msg).replace(/(^|\s)E tuşuyla/g, '$1✋ butonuyla').replace(/(^|\s)E ile/g, '$1✋ ile').replace(/\(E\)/g, '(✋)');
}
