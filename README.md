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
| Esc | Pencereyi kapat |

## Oynanış

- **Gündüz (06:00–20:00):** Çapayla tarla alanını sür, tohum ek, sula. Ekinler yalnızca sulanmışken büyür ve toprak her şafakta kurur. Olgunlaşan ekine tıklayarak hasat edersin. Odun ve taş topla, ürünlerini sat.
- **Gece (20:00–06:00):** Zombiler dalgalar halinde harita kenarlarından gelir. Her dalga bir öncekinden büyük olur ve 3. dalgadan sonra iri "brute" zombiler de katılır. Kılıç, tabanca, barikat ve taretlerle savun. **Sığınak düşerse oyun biter.** Şafakta kalan zombiler güneşte yanar ve dalga ödülünü alırsın.
- **Üretim:** Barikat, taret, mermi, tabanca, ekmek, balkabağı çorbası ve tohum.

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
