# Hasat & Hayatta Kal

Phaser 3 (WebGL) ile yazılmış pixel art çiftçilik ve zombi savunma oyunu. Gündüz ekip biçiyor, gece kasabayı zombi dalgalarına karşı savunuyorsun.

Grafikler çalışma anında canvas ile üretiliyor, sesler de Web Audio API ile sentezleniyor. Bu yüzden projede hiçbir asset dosyası yok.

## Çalıştırma

ES modülleri `file://` üzerinden yüklenmediği için oyunu küçük bir yerel sunucuyla açman gerekiyor:

```bash
# Seçenek 1 (Node.js)
npm start                      # http://localhost:8080 adresini açar

# Seçenek 2 (Python)
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

## Oynanış

- **Gündüz (06:00–20:00):** Çapayla tarla alanını sür, tohum ek, sula. Ekinler yalnızca sulanmışken büyür ve toprak her şafakta kurur. Olgunlaşan ekine tıklayarak hasat edersin. Odun ve taş topla, ürünlerini sat.
- **Gece (20:00–06:00):** Zombiler dalgalar halinde harita kenarlarından gelir. Her dalga bir öncekinden büyük olur ve 3. dalgadan sonra iri "brute" zombiler de katılır. Kılıç, tabanca, barikat ve taretlerle savun. **Sığınak düşerse oyun biter.** Şafakta kalan zombiler güneşte yanar ve dalga ödülünü alırsın.
- **Üretim:** Barikat, taret, mermi, tabanca, ekmek, balkabağı çorbası ve tohum.

## Hedef ve tempo

- **Süreler:** Gündüz ~2 dk, gece ~80 sn. Sürüyü erken temizlersen şafağa hızla geçilir ve temizleme ödülü alırsın. Hazırsan sığınak kapısında **"Geceyi erken başlat"** ile dalgayı erkenden çağırabilirsin (+%30 ödül).
- **Sürüler:** Zombiler tek tek değil, kenarlardan toplu sürüler halinde gelir. Ekranda hangi yönden kaç zombi geldiği uyarı olarak çıkar.
- **Hedef rehberi:** Ekranın üstünde sıradaki adım (çapala → ek → sula → odun → barikat → ilk gece → hasat → satış → taret) ve ödülü görünür.
- **Ana hedef:** Sığınağın yanındaki **Radyo Kulesi**'ni 4 aşamada kur. Her aşama kalıcı bir avantaj verir (ışık, kule tüfeği, sığınak canı). Son aşamadan 3 gün sonra **Son Gece** gelir; onu atlatırsan kurtarılırsın ve oyunu kazanırsın.
- **Zorluk ve rekorlar:** Yeni oyunda Kolay/Normal/Zor seçilir. Her oyun sonunda puan hesaplanır, en iyi skorlar ana menüde görünür.

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
