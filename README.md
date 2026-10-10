# Hasat & Hayatta Kal

Phaser 3 (WebGL) ile yazılmış pixel art çiftçilik ve zombi savunma oyunu. Gündüz ekip biçiyor, gece kasabayı zombi dalgalarına karşı savunuyorsun.

Grafikler çalışma anında canvas ile üretiliyor, sesler de Web Audio API ile sentezleniyor. Bu yüzden projede hiçbir asset dosyası yok.

## Çalıştırma

ES modülleri `file://` üzerinden yüklenmediği için oyunu küçük bir yerel sunucuyla açman gerekiyor:

```bash
# Seçenek 1 (Node.js)
npm start                      # önbelleksiz sunucu: http://localhost:8080

# Seçenek 2 (Python) — önbellek kapalı değil; güncellemeden sonra Ctrl+Shift+R yap
python -m http.server 8080     # sonra tarayıcıda http://localhost:8080
```

Kurulacak bir bağımlılık yok. Phaser 3.80.1 CDN'den (cdnjs), fontlar Google Fonts'tan geliyor.

## Kontroller

| Tuş | Eylem |
|---|---|
| WASD / Oklar | Hareket |
| Sol tık / Boşluk | Seçili eşyayı kullan (çapala, ek, sula, kes, saldır, ateş et, ye, yerleştir) |
| 1–8 / Fare tekerleği | Hotbar slotu seç |
| E | Yakındaki NPC ile konuş (diyalog, görev, ticaret) |
| I / Tab | Envanter ve üretim |
| K | Kaydet (sadece gündüz) |
| M | Sesi aç/kapat |
| Shift | Kaçış yuvarlanması |
| Q / R | Son iki silah arasında geçiş / tabancayı doldur |
| L / J | Yetenek ağacı / Başarımlar |
| N | Mini harita |
| Esc | Pencereyi kapat |

## Çok oyunculu (co-op, 2–4 oyuncu)

- Ana menü → **Çok Oyunculu** → adını yaz → **Oda kur** (yeni oyun ya da kayıttan devam) ya da kodu girip **Katıl**.
- Oda kodu (`ZC-ABCDE`) ve 🔗 davet linki (`…?oda=KOD`) oyun içinde sağ üstteki oda panelinde; panelde oyuncular ve ping'leri görünür.
- Sunucu yok: tarayıcılar WebRTC ile (PeerJS, ücretsiz genel sinyal sunucusu) doğrudan bağlanır. PeerJS yalnızca çok oyunculu açılınca yüklenir.
- Oda kuran (host) tüm simülasyonu çalıştırır ve kaydeder; misafirlerin envanteri host kaydında oyuncu adına göre saklanır (aynı adla dönünce geri gelir). Envanter, altın, can ve enerji kişiseldir; köy, tarla ve yapılar ortaktır.
- Host'un sekmesi açık ve görünür kalmalı (arka plandaki sekmede tarayıcı oyunu yavaşlatır).
- Test/geliştirme: `?net=local` aynı tarayıcıdaki iki sekmeyi internet olmadan (BroadcastChannel) bağlar.
  Yapay ağ koşulları: `&lag=120&jitter=40&loss=5` (ms tek yön gecikme, ms titreşim, % kayıp; PeerJS'te de çalışır).
- **Kişisel / ortak:** Yetenek ağacı, XP, başarımlar, alet/çanta yükseltmeleri, silah seviyeleri ve yemek güçlendirmeleri **oyuncu başınadır** (misafirinki host kaydında adına göre saklanır). Kiler, görev ve ilan panosu köy ortağıdır; "teslim et" görevlerinde eşya teslim edenin envanterinden alınır, takipçide herkes kendi envanterine göre ilerlemeyi görür.
- **Oyun sonu:** Host "yeniden başla" deyince oda kapanmaz, kod aynı kalır; misafirler otomatik yeniden katılır (oyun sonu ekranında "Odaya yeniden katıl" da var).
- **Senkron:** Dünya durumu güvenilir/sıralı kanaldan ~12 Hz fark olarak (oluşturma/silme, tarla, envanter, olaylar), konumlar ayrı güvenilmez kanaldan ~20 Hz gider; misafir konumları host saatine göre ~100–150 ms tamponla enterpole eder (ölçülen hata < 1 px). Misafir hareketi kendi ekranında anlıktır; host hız/ışınlanma ve duvar içinden geçme denetimi yapar, gerekirse konumu düzeltir. Parçacık/yüzen yazı/iz gibi kozmetikler aynalanmaz, misafirde olaydan yerel üretilir.
- Host sekmesi arka plana geçse de (odak dışı/gizli) oyun bir Worker zamanlayıcısıyla akmaya devam eder.
- **Bağlantı sağlamlığı:** Büyük mesajlar (ilk dünya görüntüsü ~20–110 KB, panel HTML'i) ~4000 karakterlik parçalara bölünür
  (PeerJS `json` kanalı 16300 bayttan büyük tek mesajı reddeder); güvenilir kanalda `bufferedAmount` akış kontrolü, hızlı kanalda
  tampon doluysa konum paketi atılır. Ping her iki tarafta Worker zamanlayıcısıyla gider; sekme arka plana geçince karşı tarafa
  bildirilir ve zaman aşımı 12 sn → 45 sn olur. Misafir koparsa sınırsız, geri çekilen (≤10 sn) yeniden bağlanır; host karakterini
  (envanter + konum) 60 sn tutar, aynı oturum dönerse karakter devralınır. Host sayfası yenilenirse son oda kodu (localStorage)
  geri alınır, misafirler kendiliğinden döner. ICE `disconnected` 10 sn tolere edilir; `failed` → temiz yeniden bağlanma.
  Sinyal sunucusu kopması oyunu etkilemez (geri çekilerek `peer.reconnect()`).
- **Teşhis:** Oda panelinde **📶 Bağlantı**: ICE durumu, seçilen aday çifti (host / srflx / relay), ping, son mesajdan beri geçen
  süre, yeniden bağlanma sayısı, son kopma nedeni, sinyal sunucusu durumu. **📋 Günlüğü kopyala** son 20 bağlantı olayını
  (localStorage `zombi-ciftlik-net-log`) ortam bilgisiyle panoya kopyalar.
- **TURN (farklı ağlar / mobil veri):** Varsayılan ICE: Google + Cloudflare STUN ve PeerJS'in genel TURN'ü (garanti değil).
  Kendi TURN'ünü 📶 Bağlantı → TURN alanlarından (ya da ana menü → Çok Oyunculu → Gelişmiş) gir: adres alanına ana makine
  (`standard.relay.metered.ca`), `turn:` URL listesi ya da sağlayıcının verdiği iceServers JSON'u yapıştırılabilir. Ayarlıysa davet
  linkine kodlanmış olarak eklenir (`&turn=…`) ve misafire ilk bağlantıda da iletilir. URL ile: `?turnUrl=turn:…&turnUser=…&turnPass=…`.
  `?relay=1` yalnızca TURN üzerinden bağlanmaya zorlar (teşhis).
- Test parametreleri: `&maxMsg=16300` (tek iletim boyutu sınırı benzetimi), `&chunk=500` (parça boyutu).

## Oynanış

- **Boş köy:** Oyun hazır tarla, ağıl ya da kasabalı olmadan başlar. Tarlanı çimenli herhangi bir yerde (yol, meydan ve bina dışı) çapayla kendin açarsın. Ağılı sığınağın kuzeybatısındaki kazıklı alanda 20 odun + 10 taş + 40🪙 ile kurarsın.
- **Kasabalılar:** Haritada bekliyorlar. 💬 olanları koşullarını karşılayıp köye davet edersin (Kemal: 10 odun, Ayşe: 8 karelik tarla, Selin: 40🪙). ❗ olanlar (Zeynep, Demir, Murat) zombilerle kuşatılmıştır; gündüz yaklaşınca kuşatma başlar, zombileri temizlersen köye katılırlar. Gece gelen yeni hayatta kalanlar da önce haritada bekler. Mini haritada sarı nokta davet, kırmızı nokta kurtarma demek.
- **Gündüz (06:00–20:00):** Çapayla toprağı sür, tohum ek, sula. Ekinler yalnızca sulanmışken büyür ve toprak her şafakta kurur. Olgunlaşan ekine tıklayarak hasat edersin. Odun ve taş topla, ürünlerini sat.
- **Gece (20:00–06:00):** Zombiler dalgalar halinde harita kenarlarından gelir. Her dalga bir öncekinden biraz büyük olur. Yeni türler kademeli gelir: koşucu 2., iri zombi 4., patlayan 5., tükürükçü 6., zırhlı 8. geceden itibaren. Kılıç, tabanca, barikat ve taretlerle savun. **Sığınak düşerse oyun biter.** Şafakta kalan zombiler güneşte yanar ve dalga ödülünü alırsın.
- **Üretim:** Barikat, taret, mermi, tabanca, ekmek, balkabağı çorbası ve tohum.

## Hedef ve tempo

- **Süreler:** Gündüz ~2 dk, gece ~80 sn. Sürüyü erken temizlersen şafağa hızla geçilir ve temizleme ödülü alırsın. Hazırsan sığınak kapısında **"Geceyi erken başlat"** ile dalgayı erkenden çağırabilirsin (+%30 ödül).
- **Sürüler:** Zombiler tek tek değil, kenarlardan toplu sürüler halinde gelir. Ekranda hangi yönden kaç zombi geldiği uyarı olarak çıkar.
- **Hedef rehberi:** Ekranın üstünde sıradaki adım (çapala → ek → sula → odun → barikat → ilk gece → hasat → satış → taret) ve ödülü görünür.
- **Ana hedef:** Sığınağın yanındaki **Radyo Kulesi**'ni 4 aşamada kur. Her aşama kalıcı bir avantaj verir (ışık, kule tüfeği, sığınak canı). Son aşamadan 3 gün sonra **Son Gece** gelir; onu atlatırsan kurtarılırsın ve oyunu kazanırsın.
- **Zorluk ve rekorlar:** Yeni oyunda Kolay/Normal/Zor seçilir. Her oyun sonunda puan hesaplanır, en iyi skorlar ana menüde görünür.

## Çiftlik = hayatta kalma

- **Güç yemekleri:** Pişmiş yemekler bir sonraki şafağa kadar güçlendirme verir (en fazla 2 aynı anda). Ekmek +20 can, Balkabağı Çorbası +%30 hasar, Mısır Ekmeği %25 az hasar, Domates Salatası hız + kritik, Fırın Patates gece can yenileme, Havuç Suyu geniş gece görüşü, Savaşçı Güveci +%40 hasar +30 can.
- **Kiler ve moral:** Sığınak kapısının sağındaki sandığa yiyecek bağışla. Kasaba her şafakta NPC başına 2 erzak tüketir. Gece başında kiler doluysa moral **Tok** (savunucular +%30 hasar) ya da **Ziyafet** (+%60 hasar, şafakta sığınak onarımı); boşsa **Aç** (savunucular zayıflar).
- **Tarladan silah ve savunma:** Balkabağı Bombası (1 balkabağı + 2 mermi → 2 bomba, alan hasarı), buğdaydan barikat (5 buğday).
- **Tarla tehlikede:** Gece tarlaya giren zombiler ekinleri çiğner ve büyümeyi bir aşama geri atar.

## Telefonda (dikey) oynanış

- Sol altta sürüklenebilir joystick, sağ altta büyük **eylem** butonu. Eylem butonu seçili eşyayı otomatik hedefe uygular; basılı tutunca tekrarlar, sürükleyince elle nişan alırsın.
- ✋ butonu yakındaki etkileşimi gösterir, 🎒 envanteri açar, ☰ ise tüm panelleri içeren menü sayfasını açar.
- Paneller alttan açılır, aşağı kaydırınca kapanır. Kontroller sayfasında titreşim, solak düzen ve buton saydamlığı ayarlanabilir.

## Eklenen sistemler (bkz. PLAN.md)

- **Dünya:** 4 mevsim (7'şer gün), yağmur/kar/sis/fırtına (yağmur ekinleri sular), göl ve balık tutma mini oyunu, mantar ve böğürtlen toplama, terk edilmiş evdeki sandık.
- **Çiftçilik:** domates, mısır, çilek, patates; mevsime uygun ekim; gübre, fıskiye, korkuluk; normal/gümüş/altın kalite; sulanmayan ekinin solması.
- **Hayvancılık:** tavuk ve inek, kümes ve ahır, yem, yumurta/süt/peynir, sevgi seviyesi, gece zombilerden koruma.
- **Savaş:** kaçış yuvarlanması, yay (şarjlı), pompalı tüfek, mızrak, silah seviyeleri, kritik vuruş, şarjör.
- **Zombiler:** koşucu, tükürükçü, patlayan, zırhlı ve her 5. dalgada boss; Kanlı Ay gecesi; ganimet; dalga önizlemesi.
- **Savunma:** taş duvar, dikenli tuzak, kapı, 3 seviyeli taret, alev tareti, ışık direği, çekiçle onarım.
- **Kasaba:** kalp/arkadaşlık sistemi ve hediyeler, Doktor ve Avcı NPC'leri, ilan panosu görevleri, kasabaya katılan hayatta kalanlar.
- **İlerleme:** 3 beceri dalı, yetenek ağacı, başarımlar, istatistikler, alet yükseltmeleri, çanta genişletme ve sıralama.
- **Yaban hayatı ve olaylar:** gündüz kasabadan uzak çayırlarda geyik sürüleri (yaklaşınca ya da zombi görünce kaçar, gece ormana çekilir); avlanınca çiğ geyik eti + deri (kızarmış geyik eti, deriden ok). Bazı öğlenler paraşütle yardım kolisi düşer (mini haritada sarı, akşama kadar açılmazsa kaybolur), bazı şafaklarda geyik sürüsü göç eder.
- **Keşif bölgeleri:** orman geçitlerinin ardında kilitli üç bölge: Terk Edilmiş Maden (kuzey, Paslı Anahtar), Eski Hastane (batı, Hastane Kartı: Selin), Askeri Üs (doğu, kırık köprüyü 30 odun + 20 taş + 8 hurda ile onar). İçeride gündüz de yanmayan güçlü zombiler (Kazmacı, Hasta Koşucu, Zırhlı Asker), bölgeye özel sandıklar ve bölge temizlenince açılan kasa var; temizlenen bölge 3 gün boş kalır. Bölgede kaydedersen yüklemede geçidin köy tarafında uyanırsın.
- **Cila:** hasar sayıları, vuruş duraksaması, parçacıklar, ortam sesleri, yeni müzik parçaları, mini harita, düşük donanımda otomatik efekt azaltma.

## Otonom NPC'ler (durum makineleri)

| NPC | Gündüz | Gece |
|---|---|---|
| **Ayşe** (Çiftçi) | `tend → goWater → watering`: sulanmamış ekinleri (seninkiler dahil) sular, tarlada dolaşır | `goShelter → sheltered` |
| **Kemal** (Tüccar) | `tradeStand ↔ stroll`: tezgâhta ticaret yapar | Sığınağa kaçar |
| **Zeynep** (Demirci) | `forge`, hasarlı sığınağı onarır (`fixShelter`) | `findRepair → repair`: etrafta zombi yoksa barikatları onarır, tehlike varsa saklanır |
| **Demir** (Muhafız) | `patrol`: sığınak çevresinde devriye | `combat`: mesafesini koruyarak ateş eder, canı azalınca `retreat → heal` |

Sivil NPC'ler yakınlarında zombi görünce `flee` durumuna geçip kaçar. Her NPC'nin başındaki ikon o anki durumunu gösterir. Diyalog penceresinde de ne yaptıkları yazar.

## Proje yapısı

```
index.html            HUD/menü DOM iskeleti + script importları
css/style.css         Glassmorphism arayüz
js/
  main.js             Phaser yapılandırması (pixelArt: true, Arcade fizik, RESIZE)
  config.js           Eşyalar, ekinler, tarifler, dükkânlar, görevler, sabitler
  textures.js         Prosedürel pixel art doku üretici
  audio.js            Web Audio 8-bit efektler + gündüz/gece chiptune müzik
  scenes/             BootScene (doku/animasyon), GameScene (ana döngü, ışıklandırma)
  entities/           Actor, Player, Zombie, NPC (4 alt sınıf), Structures (barikat, taret, sığınak)
  systems/            StateMachine, Inventory, Farm, TimeSystem, WaveManager,
                      QuestSystem, SaveSystem (localStorage), MapBuilder, PlayerActions
  ui/HUD.js           Üst bar, hotbar, envanter/üretim, diyalog, dükkân, menüler
```

Oyun localStorage'a (`zombi-ciftlik-save-v1`) şu durumlarda otomatik kaydediliyor: her şafakta, gündüz her 60 saniyede bir ve K tuşuna basınca.

## Testler
```
npm install          # playwright-core (yalnızca e2e için)
npm test             # birim testleri (node --test)
npm run test:e2e     # tarayıcı testleri (Chrome gerekir; CHROME_PATH ile değiştirilebilir, Phaser CDN'den yüklendiği için internet gerekir)
npm run test:all
```

Co-op testleri: `tests/e2e/multiplayer`, `coop-sync` (özet eşleşmesi, konum hatası, bant genişliği, gecikme altında),
`coop-dash`, `coop-features` (alan hasarı, HUD/hava, tüm paneller, oyuncu başına ilerleme, balık, yeniden katılma) ve
isteğe bağlı `coop-peerjs` (gerçek PeerJS + yeniden bağlanma; internet yoksa atlanır), `coop-resilience` (arka plan sekmesi,
zorla kopma → dönüş, host yenileme → aynı kod, kayıp/gecikme, parçalı büyük görüntü).
