# Hasat & Hayatta Kal — Geliştirme Planı

Bu plan, benzer oyunların incelenmesine ve mevcut kod tabanına (Phaser 3.80, `js/features/*` modül sözleşmesi: `textures/init/begin/update/save/load`, `scene.addInteraction`, `scene.extraTargets`, `scene.lightSources`, `scene.featureMenu`, `scene.virtualMove`, `ITEMS[id].onUse`, olaylar `waveStart/waveEnd/zombieKilled/cropGrew/structureDestroyed/questsChanged`, `timeSys` `dusk/dawn/hour`) dayanır. Her alan ajanı yalnızca kendi `js/features/<alan>.js` dosyasında çalışır, `config.js` tablolarını modül yüklenirken `push`/atama ile genişletir.

Mevcut durum: 64x44 tile harita, 3 ekin (buğday/havuç/balkabağı), kılıç + tabanca, barikat + taret + sığınak, 2 zombi türü (normal/brute), 4 otonom NPC (Ayşe, Kemal, Zeynep, Demir), görevler, localStorage kaydı (`zombi-ciftlik-save-v1`). Mobil kontrol yok, ZOOM sabit 3.

---

## 1. Oyun incelemeleri

| Oyun | Bu projeye uygulanabilir dersler |
|---|---|
| **Stardew Valley** | Ekin kalitesi (normal/gümüş/altın, x1 / x1.25 / x1.5 satış), mevsime bağlı ekinler, sprinkler (3x3 / 5x5 otomatik sulama), korkuluk, çoklu hasat eden ekinler (çilek, domates, mısır). Kalp/hediye sistemi (günde 1 konuşma + haftada 2 hediye, sevilen eşya +80, sevilmeyen -20). Beceri seviyeleri (çiftçilik/savaş/toplayıcılık) ayrı XP. **Mobil sürüm**: tap-to-move/tap-to-use + isteğe bağlı sanal joystick, otomatik hedef seçimi (önündeki tile), büyük eylem butonu, kaydırılabilir hotbar; dokunulan hedef menzildeyse doğrudan uygulanır. |
| **Don't Starve** | Mevsimler ve hava durumu oynanışı değiştirir (yağmur sulama, sis/karanlık tehdidi). Gece ışık kaynağı = hayatta kalma; ışık direği/meşale mekaniği. Toplanabilir yabani ürünler (böğürtlen çalısı yeniden büyür). |
| **Project Zomboid** | Zombi gürültüye gelir; tüfek sesi daha fazla zombi çeker (pompalı tüfek dengesi için). Yaralanma/tedavi → Doktor NPC. Hayatta kalan istatistikleri ekranı ("X gün hayatta kaldın"). |
| **Kingdom Two Crowns** | Kanlı Ay (Blood Moon) özel gecesi: kırmızı ton, daha büyük dalga. Kasabaya gelen hayatta kalanların işe alınması (köylü → çiftçi/okçu). Duvar seviyeleri (ahşap → taş). Gece öncesi uyarı sesi/ikonu. Minimal UI. |
| **Thronefall** | Gündüz inşa / gece savun döngüsünü sadeleştirir: inşa noktasına yaklaşıp tek tuşla yükseltme. Dalga başlamadan önce bir sonraki dalganın kompozisyonu ve yön ikonları gösterilir. Yapı yükseltme seviyeleri net görsel değişim ile. Mobilde tek elle oynanabilir (joystick + bağlama duyarlı tek buton). |
| **7 Days to Die / Night of the Full Moon** | Her 7. gün "kan ayı" hordu; özel zombi türleri (koşucu, tükürükçü, patlayan, zırhlı); dikenli tuzaklar ve kapılar; ganimet düşürme. |
| **Graveyard Keeper** | Yetenek ağacı (farklı renk puan türleri yerine tek puan, 3 dal), ilan panosu ile günlük görevler, tarif zinciri (süt → peynir). |
| **Dome Keeper** | Gündüz kaynak topla, gece dalga — dalgaya kalan süre sayacı çok net gösterilir. Yükseltme kararları kısa ve anlamlı (hasar/menzil/atış hızı). Ekran efekti ile dalga başlangıcı. |
| **Cult of the Lamb** | Kaçış yuvarlanması (kısa i-frame), hit-stop, beyaz flaş, hasar sayıları; ekip üyelerini (takipçiler) görevlere atama. Kısa oturum ritmi. |
| **Core Keeper** | Mini harita, keşif ile açılan alanlar, balık tutma mini oyunu (bar içinde balığı tut), gölde farklı balık türleri. |
| **Sun Haven** | Hayvan bakımı: günlük besleme/sevgi → ürün kalitesi; ahır/kümes yapıları; ürünlerden tarifler (omlet, peynir). |
| **Archero** | Dikey ekran, **tek başparmak**: yalnızca joystick; oyuncu durunca otomatik en yakın düşmana ateş eder. Ders: mobilde "durunca/eylemde otomatik hedef" savaşta zorunlu. |
| **Brawl Stars** | Sol: yüzen (floating) joystick; sağ: tap = otomatik hedef saldırı, sürükle = manuel nişan. Süper yetenek ayrı buton. Ders: eylem butonu tap → oto-hedef, sürükleme → yön. |
| **Survivor.io / Vampire Survivors** | Dikey, joystick tüm ekranın alt yarısında; HUD üstte ince şerit; saldırılar otomatik. Ders: HUD minimal, ekranın ortası oyun alanına ayrılmalı. |

---

## 2. Mobil dikey UX ilkeleri

1. **Başparmak bölgeleri (390x844 referans):** Ekranın alt %35'i etkileşim alanıdır. Sol alt çeyrek = hareket, sağ alt = eylemler. Üst %15 = bilgi (okunur, dokunulmaz). Orta alan = oyun dünyası.
2. **Yüzen joystick:** Sol yarının alt bölgesinde ilk dokunulan noktada belirir (taban yarıçapı 56px, topuz 26px, ölü bölge %15, maks. çekme 56px). `scene.virtualMove = {x,y}` normalize, parmak kalkınca `{0,0}`.
3. **Eylem butonu (sağ alt, 76px çap):** Tap → `PlayerActions.useSelected(scene, wx, wy)`; hedef otomatik: alet seçiliyse oyuncunun baktığı yöndeki tile, silah seçiliyse 140px içindeki en yakın zombi, yoksa bakılan yön. Basılı tutma = sürekli kullanım (6 Hz). Sürükleme = manuel nişan (Brawl Stars).
4. **Etkileş butonu (56px, eylemin üst-solunda):** Yalnızca `scene.bestInteraction()` doluyken görünür, etiket metniyle ("Konuş: Ayşe"); tap → `scene.interact()`.
5. **Tüm dokunma hedefleri ≥44px, aralar ≥8px.** Hotbar slotları 48px, yatay kaydırılabilir; seçili slot ortaya kaydırılır.
6. **Kompakt üst bar:** Portrede 2 satır (1: gün/saat/para; 2: can/enerji barları) veya simge + sayı. Arkaplan yarı saydam, yükseklik ≤64px + `env(safe-area-inset-top)`.
7. **Bottom-sheet modallar:** Envanter, dükkan, diyalog ekranın alttan %70'ini kaplar, üstte tutma çubuğu, aşağı kaydırarak kapanır; kapatma butonu sağ üstte 44px.
8. **Safe-area:** `viewport-fit=cover`, tüm sabit öğelerde `env(safe-area-inset-*)` boşluğu.
9. **Kamera zoom:** `zoom = clamp(round(min(w,h)/130), 2, 4)`; portrede görüş genişliği en az ~13 tile olacak şekilde 2'ye indir; resize/orientationchange'te yeniden hesapla.
10. **Tarayıcı jestlerini kapat:** `touch-action: none` canvas'ta, `user-scalable=no`, `gesturestart` ve çift dokunma `preventDefault`, `overscroll-behavior: none`, uzun basmada metin seçimi/kontekst menüsü kapalı.
11. **Tap-to-use:** Dünyaya dokunuş, hedef 2 tile içindeyse doğrudan uygulanır; uzaksa (opsiyonel) oraya yürü.
12. **Algılama:** `matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window` → `body.is-touch`; masaüstü CSS ve fare/klavye davranışı aynen kalır.
13. **Menü sayfası:** `scene.featureMenu` her açılışta dinamik okunur; mobilde 3 sütun ızgara (72px kartlar), masaüstünde sağ kenarda 36px ikon dock.
14. **Geri bildirim:** Butonlarda basılı durum (scale 0.92), `navigator.vibrate(15)` vuruşta (destekleniyorsa, ayarlardan kapatılabilir).
15. **Performans:** Mobilde parçacık sayısı yarıya, `devicePixelRatio` üst sınırı 2, ekstra efektler `scene.lowFx` bayrağına bağlı.

---

## 3. Alan bazlı yol haritası

Öncelik sırası yukarıdan aşağıya. Sayısal değerler başlangıç önerisidir.

### mobile — Mobil dikey UX
1. Dokunmatik algılama + `body.is-touch` sınıfı, `#mobile-ui` katmanı; canvas'ta `touch-action:none`, pinch/çift-dokunma/gesturestart engelleme, viewport meta `viewport-fit=cover`.
2. Sol alt yüzen sanal joystick (taban 112px, topuz 52px, ölü bölge 0.15) → `scene.virtualMove`; parmak kalkınca sıfırla; çoklu dokunuş için pointerId takibi.
3. Sağ alt EYLEM butonu (76px): seçili eşyaya göre oto-hedef (alet → önündeki tile; silah → 140px içindeki en yakın zombi; yer → önündeki boş tile), `PlayerActions.useSelected(scene, wx, wy)`; basılı tutmada 160ms aralıkla tekrar.
4. Bağlama duyarlı ETKİLEŞ butonu (56px): her 150ms `scene.bestInteraction()` kontrolü, etiketi göster/gizle, tap → `scene.interact()`.
5. Kompakt portre HUD: üst bar 2 satır, hotbar 48px slotlu yatay kaydırma, seçili slotu `scrollIntoView`; safe-area insetleri.
6. Modalları bottom-sheet'e çevir (CSS medya sorgusu `(max-width:600px) and (orientation:portrait)`), aşağı kaydırarak kapatma (80px eşik).
7. Ekran boyutuna göre kamera zoom (portre 2, yatay telefon 3, masaüstü 3), `scale.on('resize')` ve `orientationchange` ile güncelle.
8. Menü butonu (sağ üst, 44px) → `scene.featureMenu` ızgara sayfası (dinamik); masaüstünde sağ kenarda ikon dock, `key` varsa tooltip'te göster.
9. Tap-to-use: dünyaya dokunuş 2 tile içindeyse `useSelected` ile uygula; joystick/buton üzerindeki dokunuşları dünyaya geçirme.
10. Ayarlar: titreşim aç/kapa, sol-elli düzen (butonları yer değiştir), buton opaklığı %40–100.

### world — Dünya, hava ve keşif
1. Mevsim sistemi: 7 günlük 4 mevsim (İlkbahar/Yaz/Sonbahar/Kış), `scene.timeSys.season` ve `seasonIndex`, `dawn`'da `seasonChanged` olayı; mevsime göre zemin tonu.
2. Hava durumu: günlük rastgele (Açık %55, Yağmur %25, Sis %12, Fırtına %8); `scene.weather` açığa çıkar, `weatherChanged` olayı.
3. Yağmur: farm tile'larını otomatik sular; tek bir `ParticleEmitter` (mobilde 60, masaüstünde 150 damla), ekran sabitli.
4. Sis: kamerayı takip eden yarı saydam katman + gece ışık yarıçapı x0.7; zombi tespit menzili düşer (oyuncu için gizlenme).
5. Fırtına: yağmur + 20–40 sn'de bir şimşek flaşı ve gök gürültüsü sesi; zombi hızı +%10.
6. Göl (haritanın sol alt köşesi, ~8x5 tile) ve olta eşyası (`fishing_rod`, Kemal 80 altın): `onUse` ile su kenarında mini oyun — hareket eden bar içinde balığı 2 sn tut; balık türleri sazan(15)/levrek(35)/altın balık(120, %5).
7. Toplanabilir yabani ürünler: mantar (orman, enerji +15), böğürtlen (yaz, can +8), günde 6–10 rastgele spawn, `addInteraction` ile "Topla".
8. Yeni dekor alanı: doğuda terk edilmiş ev kalıntısı (sandık: günde 1 rastgele malzeme), çiçek/çalı varyasyonları.
9. Hava/mevsim HUD rozeti (featureMenu yerine üst barın yanında küçük DOM ikon, `#feature-ui` içinde).

### farming — Çiftçilik derinliği
1. Yeni ekinler + dokular: domates (6 sa/aşama, çoklu hasat 2 günde bir, satış 18), mısır (8 sa, çoklu hasat, 22), çilek (5 sa, çoklu hasat, 28), patates (5 sa, 1–4 verim, 14). Tohumları `SHOPS.merchant`a ekle (20/30/40/18 altın, 5'li).
2. Mevsim uygunluğu: `CROPS[x].seasons = ['spring','summer']`; mevsim dışında ekim uyarısı ve büyüme durur (`scene.timeSys.season` yoksa her mevsim geçerli).
3. Ekin kalitesi: hasatta zar (gübresiz: altın %5, gümüş %20; gübreli: altın %15, gümüş %35); satış çarpanı 1 / 1.25 / 1.5; ayrı eşya kimliği `wheat_q1/q2` yerine `quality` meta ile ya da ayrı ID'ler (Inventory uyumu için ayrı ID önerilir).
4. Gübre (`fertilizer`, tarif: 2 odun + 1 taş → 3; ya da Kemal 10 altın): tile'a uygulanınca büyüme +%25 ve kalite şansı artar.
5. Sprinkler (`sprinkler`, tarif: 3 taş + 2 odun + 1 mermi): yerleştirilebilir, her şafakta çevresindeki 3x3 (yükseltilmiş 5x5) tile'ı sular.
6. Korkuluk (`scarecrow`, 6 odun): 4 tile yarıçapında kargaların ekin yemesini (günlük %3 şans/ekin) engeller.
7. Solma: 2 gün üst üste sulanmayan ekin "solgun" (gri ton), 3. gün ölür (kuru ot tile'ı).
8. Hasatta zıplayan eşya animasyonu ve "+2 Buğday" floatText (juice ile çakışmayı önlemek için olay `cropHarvested` emit et).
9. `Farm.serialize` uyumu: yeni alanlar (`fert`, `quality`, `dryDays`) opsiyonel; eski kayıtta yoksa varsayılan 0.

### animals — Hayvancılık
1. Pixel art dokular: tavuk (12x12, 2 kare yürüme), inek (24x16, 2 kare), yumurta, süt, peynir, omlet ikonları.
2. Kasabada hazır ağıl (çiftlik doğusunda 8x6 tile çit alanı) ve kümes/ahır yapısı; hayvanlar ağıl içinde rastgele dolaşır.
3. Yeni dükkan: "Hayvan Pazarı" Kemal'e ek sekme (`SHOPS.animals`): tavuk 120, inek 400, yem 5/adet.
4. Yem verme: yalaktaki yem (`feed` eşyası) ile günlük besleme; beslenmemiş hayvan ürün vermez.
5. Günlük üretim: tavuk 1 yumurta, inek 1 süt (şafakta, yalnızca beslendiyse); `addInteraction` ile "Topla".
6. Sevgi seviyesi 0–5 kalp: günlük okşama +1/5 kalp, besleme +0.5; 4+ kalpte büyük yumurta/kaliteli süt (x1.5 değer).
7. Gece tehdidi: hayvanlar `scene.extraTargets`a eklenir (can 30); zombi öldürürse kaybolur ve uyarı toast'u; ahır kapısı kapatılırsa korunur.
8. Tarifler (`RECIPES.push`): omlet (2 yumurta → can 30), peynir (2 süt → satış 70), kek (1 yumurta + 1 süt + 2 buğday → can 50, enerji 50).
9. Kayıt: hayvan listesi, sevgi, besleme durumu `save/load` içinde.

### combat — Oyuncu savaşı ve silahlar
1. Kaçış yuvarlanması: Shift (mobilde eylem butonunun yanında 48px küçük buton), 180ms, 60px mesafe, 250ms dokunulmazlık, 12 enerji, 600ms bekleme.
2. Kritik vuruş: %10 şans, x2 hasar, sarı hasar sayısı (juice olayına `crit: true` bilgisi).
3. Yay + ok (`bow`, `arrow`): hasar 4, delip geçme 1 hedef, şarj süresi 0.4 sn (mobilde otomatik tam şarj); tarif 5 odun + 2 taş, ok 5'li 1 odun + 1 taş.
4. Pompalı tüfek (`shotgun`): 5 saçma, ±18° yayılım, saçma başı 2 hasar, menzil 110px, 2 mermi/atış, 0.9 sn bekleme; Zeynep 260 altın.
5. Mızrak (`spear`): hasar 3, menzil 36px (kılıç 22px), dar koni; tarif 4 odun + 3 taş.
6. Tabanca şarjörü: 8 mermi, R ile 1.2 sn doldurma, boşalınca otomatik doldurma; HUD'da şarjör sayısı küçük DOM etiketi.
7. Q ile son iki silah arasında hızlı geçiş (mobilde hotbar slotuna çift dokunma).
8. Silah seviye yükseltme (Sv.1→3): Zeynep'e `addInteraction` "Silah Yükselt", maliyet 80/200 altın + 5/10 taş; her seviye +%25 hasar.
9. `Player.update` içindeki `scene.virtualMove` desteğini koru; `useSelected(scene, wx, wy)` imzası değişmez; yeni silahlar `ITEMS[id].onUse` ile.

### zombies — Zombi çeşitliliği ve dalgalar
1. Koşucu (`runner`): hız x1.8, can x0.5, kırmızı gözlü yeşil doku; 2. dalgadan itibaren %20.
2. Tükürükçü (`spitter`): 120px menzilde durur, 2 sn'de bir asit mermisi (5 hasar, yerde 2 sn yeşil gölcük); 4. dalgadan itibaren.
3. Patlayan (`bloater`): 24px'e girince 0.6 sn titreyip patlar, 40px alan 25 hasar, yapılara x2; öldürülürse de patlar.
4. Zırhlı (`armored`): ilk 6 hasarı emen zırh (gri doku, zırh kırılınca normal görünüm); 6. dalgadan itibaren.
5. Boss her 5. dalgada: "Mezar Bekçisi", can 120, 3 sn'de bir yer sarsıntısı (60px), ölünce 50–80 altın + nadir malzeme; ekranda boss can barı.
6. Ganimet: ölünce %40 para (1–4), %8 malzeme (ok/mermi/hurda), %1 nadir (`rare_core`); oyuncu 24px'e girince mıknatısla çekilir.
7. Kanlı Ay: her 7. gece (veya %10 rastgele), kırmızı kamera tonu, zombi sayısı x1.5, ganimet x2, banner uyarısı.
8. Dalga önizlemesi: dusk'tan 1 oyun saati önce "Bu gece: 12 normal, 4 koşucu, 1 patlayan — kuzey ve doğu" bildirimi; giriş yönlerinde kenar oku.
9. Uyum: `normal`/`brute` adları aynı kalır; `WaveManager.serialize` değişmez, ek durum (kanlı ay sayacı) kendi `save/load` içinde.

### defense — Savunma inşası
1. Taş duvar (`stone_wall`, 8 taş): can 300 (barikat ~100), zombileri durdurur; `ITEMS.stone_wall.onUse` ile yerleştir.
2. Dikenli tuzak (`spike_trap`, 3 odun + 2 taş): üstünden geçen zombiye 0.5 sn'de 2 hasar + %50 yavaşlatma, 40 kullanımda kırılır.
3. Kapı (`gate`, 6 odun + 2 taş): oyuncu ve NPC geçer, zombi geçemez (can 200).
4. Taret seviyeleri (Sv.1→3): yerleştirilmiş tarete `addInteraction` "Yükselt (E)"; Sv2: hasar +1, menzil +20px, maliyet 60 altın + 6 taş; Sv3: atış hızı +%40, 140 altın + 10 taş; seviye göstergesi (yıldız/renk).
5. Alev tareti (`flame_turret`, 200 altın): 50px koni, 0.2 sn'de 1 hasar + 2 sn yanma, yakıt olarak odun.
6. Işık direği (`lamp_post`, 3 odun + 1 taş): `scene.lightSources`a 90px yarıçap ekler; zombi ışıkta %15 yavaş.
7. Çekiç (`hammer`, başlangıçta Zeynep'ten 40 altın): yapıya kullanınca 1 odun/taş harcayıp +25 can onarır.
8. Kayıt: yeni yapı türlerini `features/defense.js` kendi `save/load` ile `{kind,x,y,hp,level}` olarak sakla; `PlayerActions.createStructure`a dokunma.
9. Yerleştirme önizlemesi: geçerli tile yeşil, geçersiz kırmızı hayalet sprite (mobilde eylem butonuna basmadan önce önizleme).

### town — Kasaba ve NPC ilişkileri
1. Kalp sistemi: NPC başına 0–10 kalp (her kalp 100 puan); günlük konuşma +20, hediye: sevilen +80, beğenilen +45, nötr +20, sevilmeyen -40; günde 1 hediye.
2. Sevilen/sevilmeyen eşya tabloları: Ayşe (sever: çilek, çorba; sevmez: mermi), Kemal (altın balık, peynir), Zeynep (taş, nadir çekirdek), Demir (ekmek, ok).
3. Kalp ödülleri: 3 kalp dükkan indirimi %10, 6 kalp %20 + özel tarif, 8 kalp özel eşya hediyesi.
4. İlişkiler paneli (`scene.featureMenu` "İlişkiler"), diyalog DOM'una kendi modülünden kalp satırı ekleme.
5. Yeni NPC Doktor (Selin): gündüz klinik, sargı (30 altın, can +40) ve ilk yardım kiti satar; gece sığınakta yaralı NPC'leri iyileştirir.
6. Yeni NPC Avcı (Murat): gece sığınak önünde okla savunur (hasar 3, menzil 160px), gündüz ok satar.
7. Hayatta kalanlar: her 3 dalgada %60 şansla kasabaya gelir; 100 altınla işe alınır: "Sulayıcı" (Ayşe benzeri) veya "Nöbetçi" (gece ateş eder); günlük maaş 10 altın.
8. İlan panosu: kasaba meydanında; her şafakta 3 rastgele görev (teslim/öldür/topla), ödül 30–120 altın + kalp.

### progression — İlerleme ve ekonomi
1. XP ve beceri seviyeleri: Çiftçilik (hasat 5 XP), Savaş (zombi 8, brute 20, boss 100), Toplayıcılık (odun/taş 3); seviye eşiği `100 * lv^1.5`, maks 10.
2. Seviye atlayınca 1 yetenek puanı; yetenek ağacı paneli (L + featureMenu): 3 dal x 4 düğüm (ör. "Yeşil Parmak: büyüme +%10", "Keskin Nişancı: kritik +%5", "Oduncu: +1 odun").
3. Başarımlar (J + featureMenu): 20 başarım (ilk hasat, 100 zombi, 10. dalga, 1000 altın...), toast ile; küçük altın ödülü.
4. İstatistik ekranı: öldürülen zombi, hasat, kazanılan para, hayatta kalınan gece, en uzun seri.
5. Alet yükseltmeleri: Bakır/Demir çapa 3x1 / 3x3 sürer, sulama kabı 3x1 / 3x3 sular (`ITEMS[id].onUse` sarmalayarak), maliyet 150/400 altın + taş.
6. Envanter sıralama butonu (tür → ad), çanta genişletme 24→32→40 (300/800 altın).
7. Olay izleme: `zombieKilled`, `cropGrew`, `waveEnd`; hasat/kesim için `scene.inventory.onChange` farkıyla kazanılan eşyaları izle.
8. Seviye atlama efekti: banner + ses (juice ile olay `levelUp`).

### juice — His, ses ve görsel cila
1. Hasar sayıları (beyaz normal, sarı kritik, kırmızı oyuncu), 0.6 sn yukarı süzülüp kaybolur; havuzlanmış (pool) Text nesneleri.
2. Hit-stop: yakın dövüş isabetinde 50ms (`physics.world.pause` / timeScale), boss'ta 90ms.
3. Vuruşta beyaz flaş (`setTintFill` 60ms) + 4–6 parçacık; ölümde 10 parçacık + leke.
4. Hareket ederken ayak tozu (her 180ms bir küçük toz), yuvarlanmada iz.
5. Hasatta eşyanın oyuncuya doğru zıplayarak uçması (`cropHarvested` veya inventory farkı).
6. Ortam sesleri (Web Audio sentez): gündüz kuş cıvıltısı (4–9 sn aralık), gece cırcır böceği döngüsü, yağmur hışırtısı.
7. Müzik: 3 gündüz + 2 gece parçası, gece kalan zombi sayısına göre tempo/katman artışı; dalga başında davul vuruşu.
8. Dalga başı ekran efekti: kırmızı vinyet + 250ms kamera sarsıntısı + banner.
9. Mini harita (N tuşu): `#feature-ui` içinde sağ üstte 128x88 DOM canvas (mobilde 96x66), oyuncu/zombi/NPC noktaları, 4 Hz güncelleme.
10. Ağaçların rüzgarda sallanması (tween ile ±1.5° yavaş), su parıltısı, ışık titremesi; `scene.lowFx` (FPS < 45 sürerse otomatik) ile efektleri azalt.

---

## Uygulama sırası önerisi

1. **mobile** (diğer ajanların featureMenu/etkileşimlerini göstereceği zemin) ve **juice** (olayları dinler, bağımsız).
2. **combat**, **zombies**, **defense** (gece döngüsü).
3. **farming**, **world**, **animals** (gündüz döngüsü; world mevsim/hava bilgisini önce açığa çıkarmalı).
4. **town**, **progression** (diğer sistemlerin olaylarını tüketir).

Kaynaklar: [Thronefall IGF](https://igf.com/entry/2024/thronefall), [Thronefall – Time Extension](https://www.timeextension.com/games/xbox-series-x/thronefall), [Touch Control Design – Mobile Free to Play](https://mobilefreetoplay.com/?p=58), [Mobil sanal joystick iyileştirme – Bugnet](https://bugnet.io/blog/how-to-fix-mobile-virtual-joystick-feeling-bad), [Touch controls – Abratabia](https://abratabia.com/game-controls/touch-controls.php).
