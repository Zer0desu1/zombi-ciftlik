// Görüntü listesi aynası: host sahnedeki dinamik nesneleri (zombi, NPC, hayvan, geyik, slime, yapı,
// mermi, etiket, can barı…) türden bağımsız olarak kaydeder; misafir aynı görünümü vekil nesnelerle çizer.
//
// İki akış:
//  - Güvenilir (sıralı) durum farkı ~12 Hz: oluşturma/silme, doku, kare, yazı, renk, görünürlük… Konum yalnızca
//    yeni/yeniden görünen nesnelerde ve hareketi duran nesnelerin "anahtar karesinde" (≈1 sn) gider.
//  - Hızlı (güvenilmez, en son kazanır) konum akışı ~20 Hz: son 0.6 sn içinde hareket eden nesnelerin konumu
//    (yarım piksel tamsayı). Misafir bunları host zaman damgasıyla tamponlayıp sabit bir gecikmeyle
//    enterpole eder (anlık görüntü enterpolasyonu): titreme/paket gecikmesi akıcılığı bozmaz.
// Takipçiler (gölge, can barı, isim etiketi) kendi konumunu göndermez: ebeveyne göre ofsetle çizilir.

const KIND = { Image: 'i', Sprite: 'i', Text: 't', Rectangle: 'r', Arc: 'c' };
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const MOVE_HOLD = 0.6;   // sn: duran nesnenin konumu bu süre daha hızlı akışta tekrarlanır (kayba karşı)
const KEYFRAME = 1;      // sn: hareketsiz nesnelerin konumu güvenilir akışta doğrulanır
const TELEPORT = 48;     // px: bundan büyük sıçrama enterpole edilmez

// ---------------- Durum özeti (kendini onaran eşitleme) ----------------
// Farklar (oluşturma/silme/doku/görünürlük, tarla, kaynak) yalnızca DEĞİŞİNCE bir kez gönderilir. Bir fark
// misafirde uygulanamazsa (işleyici istisnası, yarı açık / kopan bağlantıda kaybolan mesaj…) host bunu bilemez ve
// aynı alan tekrar değişene kadar misafir yanlış durumda kalır (ör. host'ta kesilmiş ağaç misafirde ayakta).
// Host birkaç saniyede bir küçük bir özet (kaynak bit kümesi + aynalanan nesne / tarla / özellik / envanter
// özetleri) yollar; misafir kendi durumundan aynı özeti hesaplar, uymayan bölümün tamamını ister.

// FNV-1a 32 bit (iki tarafta aynı)
export function hashStr(s) {
  let h = 0x811c9dc5;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// Sıradan bağımsız küme özeti: [toplam(hash) mod 2^32, adet]
export function setHash(strings) {
  let sum = 0, n = 0;
  for (const s of strings) { sum = (sum + hashStr(s)) >>> 0; n++; }
  return [sum, n];
}

// Aynalanan nesnenin özet imzası: varlık + görünürlük + görünüm (doku / yazı / çubuk genişliği).
// Konum ve sık değişen ayrıntılar (alfa, ölçek) dahil değil: konum zaten periyodik doğrulanıyor.
export function mirrorSig(id, r) {
  if (!r.v) return `${id}|${r.k}|0`;
  return `${id}|${r.k}|1|${r.t ?? ''}|${r.s ?? ''}|${r.w ?? ''}`;
}

// Envanter özeti (misafir yalnızca id + adet tutar)
export function invSig(inv) {
  return (inv?.slots || []).map((x) => (x ? `${x.id}:${x.count}` : '')).join(',').replace(/,+$/, ''); // sondaki boş slotlar sayılmaz
}

// Boole listesi ↔ base64 bit kümesi (355 kaynak ≈ 60 karakter)
export function packBits(list) {
  const bytes = new Uint8Array(Math.ceil(list.length / 8));
  list.forEach((b, i) => { if (b) bytes[i >> 3] |= 1 << (i & 7); });
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}
export function unpackBits(str, n) {
  const out = new Array(n).fill(false);
  let s = '';
  try { s = atob(String(str || '')); } catch { return out; }
  for (let i = 0; i < n; i++) out[i] = !!((s.charCodeAt(i >> 3) || 0) & (1 << (i & 7)));
  return out;
}

function styleKey(o) {
  const s = o.style;
  return [s.fontFamily, s.fontSize, s.fontStyle, s.color, s.stroke, s.strokeThickness, s.resolution || 1, s.align, s.backgroundColor || ''].join('|');
}

// Nesnenin ağ kaydı (görünmezse yalnızca {k, v:0}); konum (x,y) ayrı ele alınır
function describe(o, k, solid) {
  if (!o.visible || o.alpha < 0.01) return { k, v: 0 };
  const rec = { k, v: 1, x: r1(o.x), y: r1(o.y), a: r2(o.alpha), r: r2(o.rotation || 0), sx: r2(o.scaleX), sy: r2(o.scaleY) };
  // Derinlik: ayak hizasına bağlıysa (y'ye göre) göreli gönder → hareket ederken her karede değişmez
  const dz = o.depth - o.y;
  if (Math.abs(dz) <= 40) rec.dz = r1(dz); else rec.d = r1(o.depth);
  const par = o.netFollow;
  if (par && par.__nid && par.active && !par.netSkip) {
    rec.pa = par.__nid;
    rec.fo = `${Math.round((o.x - par.x) * 2) / 2},${Math.round((o.y - par.y) * 2) / 2}`;
  }
  if (k === 'i' || k === 't') {
    rec.ti = o.isTinted ? o.tintTopLeft : -1;
    rec.tf = o.tintFill ? 1 : 0;
    rec.ox = r2(o.originX); rec.oy = r2(o.originY);
    rec.fx = o.flipX ? 1 : 0;
  }
  if (k === 'i') {
    rec.t = o.texture?.key || '__DEFAULT';
    const anim = o.anims?.isPlaying ? o.anims.currentAnim?.key : '';
    rec.an = anim || '';
    rec.f = anim ? '' : String(o.frame?.name ?? '');
    rec.fy = o.flipY ? 1 : 0;
    // Oyuncuyu durduran statik gövde (misafir kendi hareketinde çarpışsın; host aynı kuralla doğrular)
    const b = o.netSolid?.body || o.body;
    rec.sb = solid && b && solid(o) ? `${Math.round(b.width)},${Math.round(b.height)},${r1(b.x - o.x)},${r1(b.y - o.y)}` : '';
  } else if (k === 't') {
    rec.s = o.text;
    rec.st = styleKey(o);
  } else if (k === 'r') {
    rec.w = r1(o.width); rec.h = r1(o.height); rec.fc = o.fillColor; rec.fa = r2(o.fillAlpha);
    rec.ox = r2(o.originX); rec.oy = r2(o.originY);
  } else if (k === 'c') {
    rec.rad = r1(o.radius); rec.fc = o.fillColor; rec.fa = r2(o.fillAlpha);
  }
  return rec;
}

export class MirrorWriter {
  // skip(o) → true ise nesne aynalanmaz
  constructor(scene, skip, solid = null) {
    this.scene = scene;
    this.skip = skip;
    this.solid = solid;
    this.prev = new Map();   // id → güvenilir akışla bilinen son kayıt (x,y = misafirin bildiği son kesin konum)
    this.pos = new Map();    // id → { x, y, at } host'taki son konum ve son hareket zamanı
    this.nextId = 1;
    this.keyT = 0;
  }

  // Güvenilir fark: { o: {id: alanlar}, x: [silinen id] }
  diff(now = performance.now() / 1000) {
    const o = {}, seen = new Set();
    let any = false;
    const key = now - this.keyT >= KEYFRAME;
    if (key) this.keyT = now;
    for (const obj of this.scene.children.list) {
      const k = KIND[obj.type];
      if (!k || this.skip(obj)) continue;
      const id = obj.__nid || (obj.__nid = this.nextId++);
      seen.add(id);
      const rec = describe(obj, k, this.solid);
      const prev = this.prev.get(id);
      let ps = this.pos.get(id);
      if (!ps) { ps = { x: rec.x, y: rec.y, at: -1e9 }; this.pos.set(id, ps); }
      if (!prev) { o[id] = rec; any = true; this.prev.set(id, rec); continue; }
      let d = null;
      for (const f in rec) {
        if (f === 'x' || f === 'y') continue;
        if (rec[f] !== prev[f]) (d ||= {})[f] = rec[f];
      }
      if (rec.v) {
        // Yeniden görünen nesne: kesin konum; hareketi duran nesne: anahtar karede konum doğrulama
        const reappear = d && 'v' in d;
        const still = !rec.pa && now - ps.at > MOVE_HOLD;
        if (reappear || (key && still && (rec.x !== prev.x || rec.y !== prev.y))) { (d ||= {}).x = rec.x; d.y = rec.y; }
        else { rec.x = prev.x; rec.y = prev.y; } // misafirin bildiği güvenilir konum değişmedi
      }
      if (d) { o[id] = d; any = true; }
      this.prev.set(id, rec);
    }
    const x = [];
    for (const id of this.prev.keys()) if (!seen.has(id)) { x.push(id); this.prev.delete(id); this.pos.delete(id); }
    return { o: any ? o : null, x: x.length ? x : null };
  }

  // Hızlı akış: son MOVE_HOLD sn içinde hareket eden (takipçi olmayan, görünür) nesnelerin konumu
  // [id, x*2, y*2, ...] (yarım piksel tamsayı)
  positions(now = performance.now() / 1000) {
    const out = [];
    for (const obj of this.scene.children.list) {
      const id = obj.__nid;
      if (!id) continue;
      const ps = this.pos.get(id), prev = this.prev.get(id);
      if (!ps || !prev || !prev.v || prev.pa) continue;
      const x = obj.x, y = obj.y;
      if (Math.abs(x - ps.x) > 0.05 || Math.abs(y - ps.y) > 0.05) { ps.x = x; ps.y = y; ps.at = now; }
      if (now - ps.at <= MOVE_HOLD) out.push(id, Math.round(x * 2), Math.round(y * 2));
    }
    return out;
  }

  // Misafirin bilmesi gereken (gönderilmiş) durumun özeti: [toplam, adet]
  digest() {
    const sigs = [];
    for (const [id, rec] of this.prev) sigs.push(mirrorSig(id, rec));
    return setHash(sigs);
  }

  // Yeni katılan misafir için son durumun tamamı
  full() {
    const o = {};
    for (const [id, rec] of this.prev) {
      const obj = this.pos.get(id);
      o[id] = obj && rec.v ? { ...rec, x: r1(obj.x), y: r1(obj.y) } : rec;
    }
    return o;
  }
}

// ---------------- Zaman tamponlu enterpolasyon ----------------
// Örnekler [t(host ms), x, y]; sample(rt) → rt anındaki konum (ileriye tahmin yok: son örnekte bekler)
export class Interp {
  constructor() { this.buf = []; }
  push(t, x, y) {
    const b = this.buf;
    if (b.length && t <= b[b.length - 1][0]) return; // eski/sıra dışı örnek
    b.push([t, x, y]);
    if (b.length > 12) b.shift();
  }
  reset(t, x, y) { this.buf = [[t, x, y]]; }
  get last() { return this.buf[this.buf.length - 1]; }
  sample(rt) {
    const b = this.buf;
    if (!b.length) return null;
    if (rt <= b[0][0]) return b[0];
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i][0] <= rt) {
        const a = b[i], n = b[i + 1];
        if (!n) return a;
        if (Math.abs(n[1] - a[1]) + Math.abs(n[2] - a[2]) > TELEPORT) return a;
        const k = (rt - a[0]) / (n[0] - a[0]);
        return [rt, a[1] + (n[1] - a[1]) * k, a[2] + (n[2] - a[2]) * k];
      }
    }
    return b[0];
  }
  // Eski örnekleri at (rt'den önceki son örnek kalsın)
  trim(rt) {
    const b = this.buf;
    while (b.length > 2 && b[1][0] <= rt) b.shift();
  }
}

// Host saatini tahmin eden ve oynatma gecikmesini ayarlayan saat (misafir tarafı)
export class NetClock {
  constructor(base = 50) {
    this.base = base;        // hızlı akış aralığı (ms)
    this.samples = [];       // [yerel ms, host ms - yerel ms]
    this.off = null;
    this.delay = base + 40;
    this.target = this.delay;
  }
  // Her hızlı pakette: ht = host gönderim zamanı
  observe(ht) {
    const now = performance.now(), o = ht - now, s = this.samples;
    // Gerçek gönderim aralığı: host'un kare hızı düşükse (büyük harita, zayıf cihaz) paketler 50 ms'den seyrek
    // gelir; gecikme bu aralığı karşılamazsa tampon boşalır ve vekiller son örnekte bekleyip sıçrar.
    if (this.lastHt != null) {
      const gap = ht - this.lastHt;
      if (gap > 0 && gap < 1000) this.gap = this.gap == null ? gap : this.gap + (gap - this.gap) * 0.1;
    }
    this.lastHt = ht;
    s.push([now, o]);
    while (s.length && now - s[0][0] > 3000) s.shift();
    let max = -Infinity;
    for (const x of s) if (x[1] > max) max = x[1];
    // En az gecikmeli paket = host saati (+ en düşük tek yön gecikme)
    this.off = this.off == null ? max : Math.max(max, this.off - 0.5); // yavaş kayma, ani düşüş yok
    if (this.off > max + 50) this.off = max; // pencere dışına çıkan aşırı değer
    // Titreşim payı: ofsetlerin %90 yayılımı
    const sorted = s.map((x) => x[1]).sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? max;
    const base = Math.max(this.base, (this.gap || 0) * 1.25);
    this.target = Math.min(450, Math.max(70, base + (max - p10) + 25));
  }
  // Oynatma zamanı (host saatinde)
  renderTime(dt) {
    if (this.off == null) return null;
    this.delay += (this.target - this.delay) * Math.min(1, dt * 2);
    return performance.now() + this.off - this.delay;
  }
  hostNow() { return this.off == null ? null : performance.now() + this.off; }
}

// ---------------- Misafir tarafı ----------------

function parseStyle(st) {
  const [fontFamily, fontSize, fontStyle, color, stroke, strokeThickness, resolution, align, backgroundColor] = String(st).split('|');
  const s = { fontFamily, fontSize, fontStyle, color, stroke, strokeThickness: Number(strokeThickness) || 0, align };
  if (backgroundColor) s.backgroundColor = backgroundColor;
  return { style: s, resolution: Number(resolution) || 1 };
}

export class MirrorReader {
  // groups: { zombies, barricades, turrets, solids } → vekiller doku türüne göre bu gruplara da eklenir
  constructor(scene, groups) {
    this.scene = scene;
    this.groups = groups;
    this.objs = new Map();
    this.onEvent = null; // (tür, vekil) → ses/efekt türetmek için (NetGuest kurar)
  }

  clear() {
    for (const m of this.objs.values()) { m.solidZone?.destroy(); m.destroy(); }
    this.objs.clear();
  }

  create(k, rec) {
    const s = this.scene;
    let m;
    if (k === 't') m = s.add.text(rec.x || 0, rec.y || 0, '', {});
    else if (k === 'r') m = s.add.rectangle(rec.x || 0, rec.y || 0, 1, 1, 0xffffff);
    else if (k === 'c') m = s.add.circle(rec.x || 0, rec.y || 0, 1, 0xffffff);
    else m = s.add.sprite(rec.x || 0, rec.y || 0, '__DEFAULT');
    m.nk = k;
    m.netProxy = true;
    m.ip = new Interp();
    m.fastAt = -1e9;
    return m;
  }

  // Doku türüne göre yerel gruplar (mini harita, dokunmatik nişan, çarpışma)
  classify(m) {
    const g = this.groups, key = m.texture?.key || '';
    const role = key.startsWith('zombie') ? 'z' : key.startsWith('barricade') ? 'b' : key.startsWith('turret') ? 't' : '';
    if (role !== m.role) {
      if (m.role === 'z') g.zombies.remove(m); else if (m.role === 'b') g.barricades.remove(m); else if (m.role === 't') g.turrets.remove(m);
      if (role === 'z') g.zombies.add(m); else if (role === 'b') g.barricades.add(m); else if (role === 't') g.turrets.add(m);
      m.role = role;
    }
    // Host'un bildirdiği katı gövde (sb = "g,y,dx,dy"): ayrı görünmez statik bölge
    const sb = m.visible ? m.sb : '';
    if (sb !== m.sbOn) {
      m.sbOn = sb;
      m.solidZone?.destroy();
      m.solidZone = null;
      if (sb) {
        const [w, h, dx, dy] = sb.split(',').map(Number);
        const z = this.scene.add.zone(m.x + dx + w / 2, m.y + dy + h / 2, w, h);
        z.netLocal = true;
        g.solids.add(z);
        m.solidZone = z;
      }
    }
  }

  // Güvenilir fark. rt = şu anki oynatma zamanı (konum sıfırlamalarında tampon başlangıcı)
  apply(o, x, rt = 0, quiet = false) {
    // Not: silinen id'ler JSON dizisinde sayı, vekil haritasının anahtarları (for…in) metin → String() şart.
    // (Eskiden burada eşleşmediği için silinen nesnelerin vekilleri misafirde "takılı" kalıyordu.)
    if (x) for (const raw of x) {
      const id = String(raw), m = this.objs.get(id);
      if (!m) continue;
      this.objs.delete(id);
      try { if (!quiet) this.onEvent?.('gone', m); m.solidZone?.destroy(); m.destroy(); } catch (e) { console.warn('Vekil silinemedi', id, e); }
    }
    if (!o) return;
    for (const id in o) {
      // Tek bir kaydın istisnası diğerlerini düşürmesin; uygulanamayan kaydın özeti (m.dg) güncellenmez →
      // bir sonraki özet karşılaştırmasında uyuşmazlık çıkar ve tam yeniden eşitleme istenir.
      try { this.applyRec(id, o[id], rt); } catch (e) {
        this.errors = (this.errors || 0) + 1;
        if (this.errors <= 3) console.warn('Vekil güncellenemedi', id, e);
      }
    }
  }

  // Özet imzası için bilinen son alanlar (yalnızca kayıt tamamen uygulandıktan sonra)
  track(id, m, rec) {
    const dg = m.dg || (m.dg = { k: rec.k || m.nk });
    if ('v' in rec) dg.v = rec.v;
    if ('t' in rec) dg.t = rec.t;
    if ('s' in rec) dg.s = rec.s;
    if ('w' in rec) dg.w = rec.w;
  }

  // Host'un MirrorWriter.digest() ile aynı özet
  digest() {
    const sigs = [];
    for (const [id, m] of this.objs) sigs.push(m.dg ? mirrorSig(id, m.dg) : `${id}|?`);
    return setHash(sigs);
  }

  // Tam yeniden eşitleme: host'un bildiği tüm nesneler (MirrorWriter.full). Listede olmayan vekiller silinir,
  // var olanların tüm alanları yeniden yazılır, eksikler oluşturulur.
  applyFull(o, rt = 0) {
    const del = [];
    for (const id of this.objs.keys()) if (!(id in o)) del.push(id);
    // Var olan vekilin özetini sıfırla: tam kayıt uygulanamazsa uyuşmazlık sürsün
    for (const id in o) { const m = this.objs.get(id); if (m) m.dg = null; }
    this.apply(o, del.length ? del : null, rt, true);
    return del.length;
  }

  applyRec(id, rec, rt) {
    const s = this.scene;
    {
      let m = this.objs.get(id);
      const isNew = !m;
      if (isNew) {
        if (!rec.k) { this.orphans = (this.orphans || 0) + 1; return; } // fark geldi ama nesne yok: oluşturma kaybolmuş (özet onarır)
        m = this.create(rec.k, rec);
        this.objs.set(id, m);
      }
      if ('v' in rec) m.setVisible(!!rec.v);
      if (m.nk === 'i') {
        if ('t' in rec) {
          const key = s.textures.exists(rec.t) ? rec.t : '__DEFAULT';
          const tex = s.textures.get(key);
          m.setTexture(key, rec.f && tex.has(rec.f) ? rec.f : undefined);
        }
        if ('an' in rec) {
          if (rec.an && s.anims.exists(rec.an)) m.play(rec.an, true);
          else if (m.anims?.isPlaying) m.anims.stop();
        }
        if (rec.f && !m.anims?.isPlaying && m.texture.has(rec.f) && String(m.frame.name) !== rec.f) m.setFrame(rec.f);
        if ('fy' in rec) m.setFlipY(!!rec.fy);
        if ('sb' in rec) m.sb = rec.sb;
      } else if (m.nk === 't') {
        if ('st' in rec) { const p = parseStyle(rec.st); m.setStyle(p.style); m.setResolution(p.resolution); }
        if ('s' in rec) m.setText(rec.s);
      } else if (m.nk === 'r') {
        if ('w' in rec || 'h' in rec) m.setSize(rec.w ?? m.width, rec.h ?? m.height);
        if ('fc' in rec || 'fa' in rec) m.setFillStyle(rec.fc ?? m.fillColor, rec.fa ?? m.fillAlpha);
      } else if (m.nk === 'c') {
        if ('rad' in rec) m.setRadius(rec.rad);
        if ('fc' in rec || 'fa' in rec) m.setFillStyle(rec.fc ?? m.fillColor, rec.fa ?? m.fillAlpha);
      }
      if ('ti' in rec || 'tf' in rec) {
        const ti = rec.ti ?? m.netTint ?? -1, tf = rec.tf ?? m.netTf ?? 0;
        if (tf && !m.netTf && !isNew) this.onEvent?.('flash', m);
        m.netTint = ti; m.netTf = tf;
        if (ti < 0) m.clearTint?.(); else if (tf) m.setTintFill?.(ti); else m.setTint?.(ti);
      }
      if ('fx' in rec) m.setFlipX?.(!!rec.fx);
      if ('ox' in rec || 'oy' in rec) m.setOrigin(rec.ox ?? m.originX, rec.oy ?? m.originY);
      if ('d' in rec) { m.dz = null; m.setDepth(rec.d); }
      if ('dz' in rec) m.dz = rec.dz;
      if ('pa' in rec) m.pa = rec.pa;
      if ('fo' in rec) { const [a, b] = String(rec.fo).split(','); m.fo = [+a || 0, +b || 0]; }
      if (rec.v === 0) { m.pa = null; m.fo = null; }
      if ('a' in rec) m.setAlpha(rec.a);
      if ('r' in rec) m.setRotation(rec.r);
      if ('sx' in rec || 'sy' in rec) m.setScale(rec.sx ?? m.scaleX, rec.sy ?? m.scaleY);
      if ('x' in rec || 'y' in rec) {
        const nx = rec.x ?? m.x, ny = rec.y ?? m.y;
        // Hızlı akış bu nesneyi yakın zamanda taşımıyorsa kesin konum: doğrudan yerleştir
        if (isNew || 'v' in rec || performance.now() - m.fastAt > 400) { m.setPosition(nx, ny); m.ip.reset(rt, nx, ny); }
      }
      if (m.dz != null) m.setDepth(m.y + m.dz);
      if (m.nk === 'i') this.classify(m);
      this.track(id, m, rec);
    }
  }

  // Hızlı akış: [id, x*2, y*2, ...] host zamanı ht'de
  applyFast(list, ht) {
    const now = performance.now();
    for (let i = 0; i + 2 < list.length; i += 3) {
      const m = this.objs.get(String(list[i]));
      if (!m) continue;
      const x = list[i + 1] / 2, y = list[i + 2] / 2;
      // Uzun süre duran nesne yeniden hareket ediyor: tampona mevcut konumu başlangıç olarak koy
      if (now - m.fastAt > 400) m.ip.reset(ht - 50, m.x, m.y);
      m.ip.push(ht, x, y);
      m.fastAt = now;
    }
  }

  // Kare başına: rt (host saatinde oynatma zamanı) anındaki konumlar
  update(rt) {
    const followers = [];
    for (const m of this.objs.values()) {
      if (m.pa) { followers.push(m); continue; }
      if (rt != null && m.ip.buf.length > 1) {
        const p = m.ip.sample(rt);
        if (p && (p[1] !== m.x || p[2] !== m.y)) m.setPosition(p[1], p[2]);
        m.ip.trim(rt);
      }
      if (m.dz != null) m.setDepth(m.y + m.dz);
    }
    for (const m of followers) {
      const p = this.objs.get(String(m.pa));
      if (p && m.fo) m.setPosition(p.x + m.fo[0], p.y + m.fo[1]);
      if (m.dz != null) m.setDepth(m.y + m.dz);
    }
  }
}
