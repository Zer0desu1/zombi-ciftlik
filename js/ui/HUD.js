import { ITEMS, RECIPES, SHOPS, HOTBAR_SIZE, DIFFICULTIES } from '../config.js';
import { iconURL } from '../textures.js';
import { audio } from '../audio.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// Tüm oyun içi arayüz DOM üzerinde (keskin font + glassmorphism için).
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
    scene.events.on('questsChanged', () => this.renderQuests());
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
    this.e.hp.style.width = `${(Math.max(0, p.hp) / p.maxHp) * 100}%`;
    this.e.hpTxt.textContent = Math.ceil(Math.max(0, p.hp));
    this.e.en.style.width = `${(p.energy / p.maxEnergy) * 100}%`;
    this.e.enTxt.textContent = Math.ceil(p.energy);
    this.e.coins.textContent = p.coins;
    this.e.wave.textContent = s.waves.active ? `Dalga ${s.waves.wave}` : `Sonraki: ${s.waves.wave + 1}`;
    this.e.zombies.textContent = s.waves.active ? s.waves.remaining : '—';
    this.e.shelter.style.width = `${(s.shelter.hp / s.shelter.maxHp) * 100}%`;
  }

  // ---------- Hotbar ----------
  buildHotbar() {
    this.e.hotbar.innerHTML = '';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = el('div', 'slot');
      slot.dataset.i = i;
      slot.addEventListener('click', () => { this.scene.selectSlot(i); audio.sfx('click'); });
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

  hint(text) {
    text = text || '';
    if (this.lastHint === text) return;
    this.lastHint = text;
    this.e.hint.textContent = text;
    this.e.hint.classList.toggle('show', !!text);
  }

  toast(msg, type = 'info') {
    const touch = document.body.classList.contains('is-touch');
    const t = el('div', `toast ${type}`, touch ? touchText(msg) : msg);
    this.e.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
    // Dar ekranda en fazla 3 bildirim üst üste
    while (this.e.toasts.children.length > (touch ? 3 : 5)) this.e.toasts.firstChild.remove();
  }

  // Aynı uyarıyı kısa sürede tekrar tekrar göstermemek için
  notice(msg) {
    const now = performance.now();
    if (this.lastNotice === msg && now - this.lastNoticeAt < 1500) return;
    this.lastNotice = msg; this.lastNoticeAt = now;
    this.toast(msg, 'warn');
  }

  banner(title, sub) {
    const b = $('#banner');
    b.querySelector('h2').textContent = title;
    b.querySelector('p').textContent = sub || '';
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
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
    this.renderHotbar();
    this.renderQuests();
    if (this.modal === 'inventory') { this.renderInvGrid(); this.renderCrafting(); }
    if (this.modal === 'shop') this.renderShop();
  }

  renderInvGrid() {
    const inv = this.scene.inventory;
    this.e.invGrid.innerHTML = '';
    inv.slots.forEach((s, i) => {
      const node = el('div', `slot${i < HOTBAR_SIZE ? ' hot' : ''}${this.pickedSlot === i ? ' picked' : ''}`, this.slotHTML(s, i));
      node.addEventListener('click', () => {
        audio.sfx('click');
        if (this.pickedSlot === null) { if (s) this.pickedSlot = i; this.showInfo(s); this.renderInvGrid(); return; }
        const a = this.pickedSlot; this.pickedSlot = null;
        if (a !== i) inv.swap(a, i); else this.renderInvGrid();
      });
      node.addEventListener('mouseenter', () => this.showInfo(s));
      this.e.invGrid.appendChild(node);
    });
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
    RECIPES.forEach((r) => {
      const ok = inv.has(r.cost);
      const cost = Object.entries(r.cost).map(([id, n]) =>
        `<span class="cost ${inv.count(id) >= n ? '' : 'miss'}"><img src="${this.icon(id)}" alt="">${inv.count(id)}/${n}</span>`).join('');
      const row = el('div', `recipe ${ok ? '' : 'locked'}`,
        `<img class="out" src="${this.icon(r.out)}" alt=""><div class="rinfo"><b>${ITEMS[r.out].name}${r.qty > 1 ? ` ×${r.qty}` : ''}</b><div>${cost}</div></div><button ${ok ? '' : 'disabled'}>Üret</button>`);
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
        const d = ITEMS[s.id], n = inv.count(s.id);
        const row = el('div', 'shop-row', `<img src="${this.icon(s.id)}" alt=""><div class="rinfo"><b>${d.name}</b><span class="muted">Elinde: ${n} · birimi ${d.sell}🪙</span></div><button>1 sat</button><button class="primary">Hepsi (${n * d.sell}🪙)</button>`);
        const [one, all] = row.querySelectorAll('button');
        one.addEventListener('click', () => { if (inv.remove(s.id, 1)) p.addCoins(d.sell); });
        all.addEventListener('click', () => { const k = inv.count(s.id); if (inv.remove(s.id, k)) p.addCoins(k * d.sell); });
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
    $('#menu-records').innerHTML = r.runs
      ? `🏆 En iyi puan <b>${r.bestScore}</b> · En uzun <b>${r.bestDay}. gün</b> · En yüksek <b>${r.bestWave}. dalga</b>${r.wins ? ` · Zafer <b>${r.wins}</b>` : ''}`
      : '';
    // Yeni oyun → zorluk seçimi
    const pick = $('#diff-pick');
    pick.innerHTML = '';
    Object.values(DIFFICULTIES).forEach((d) => {
      const b = el('button', d.id === 'normal' ? 'primary' : '', `<span class="d-ic">${d.icon}</span><b>${d.name}</b><small>${d.desc}</small>`);
      b.addEventListener('click', () => { audio.init(); m.classList.remove('show'); onNew(d.id); });
      pick.appendChild(b);
    });
    $('#btn-new').onclick = () => {
      if (hasSave && !confirm('Mevcut kayıt silinecek. Emin misin?')) return;
      pick.classList.toggle('show');
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
    g.querySelector('.go-score').innerHTML = `<div class="score">${stats.score ?? 0}</div><div class="muted">${stats.newBest ? '🎉 Yeni rekor!' : `Rekor: ${r.bestScore ?? 0}`} · ${DIFFICULTIES[stats.difficulty]?.name || ''}</div>`;
    g.classList.add('show');
    g.querySelector('button').onclick = () => { g.classList.remove('show'); onRestart(); };
  }
}

// Dokunmatikte klavye ipuçlarını buton karşılıklarına çevir ("E tuşuyla" → "✋ ile")
function touchText(msg) {
  return String(msg).replace(/(^|\s)E tuşuyla/g, '$1✋ butonuyla').replace(/(^|\s)E ile/g, '$1✋ ile').replace(/\(E\)/g, '(✋)');
}
