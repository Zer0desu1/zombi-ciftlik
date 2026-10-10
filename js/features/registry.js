// Özellik (feature) modülü sözleşmesi — her alan alt sistemi bağımsız bir modül olarak takılır.
//
// export default {
//   id: 'benzersiz-id',
//   textures(scene) {},              // BootScene: kendi dokularını/animasyonlarını üret (textures.js yardımcılarıyla)
//   init(scene) {},                  // GameScene.create sonunda (HUD hazır), olay dinleyicileri kur
//   begin(scene, isNewGame) {},      // Yeni oyun/devam başladığında (yeni oyunda başlangıç eşyası vb.)
//   update(scene, dt) {},            // Her kare (modal açıkken ÇAĞRILMAZ)
//   save(scene) { return {...} },    // JSON'a çevrilebilir durum
//   load(scene, data) {},            // save() çıktısı (yoksa undefined)
//
//   // Çok oyunculu (co-op) sözleşmesi — hepsi isteğe bağlı (bkz. net/NetHost.js, net/NetGuest.js):
//   netState(scene) {}               // host: ortak HUD durumu (JSON, değişince ~4 Hz yayınlanır)
//   netApply(scene, state) {}        // misafir: netState'i göster (rozet, kart, hava görseli…)
//   netPlayerState(scene) {}         // host, misafir bağlamında: oyuncuya özel HUD (şarjör, seviye rozeti…)
//   netApplyPlayer(scene, state) {}  // misafir: kendi HUD'u
//   playerState: { get, set, fresh, save, load, apply?, tick? } // oyuncu başına kalıcı durum; bağlam takasında
//                                    // misafirinkiyle değiştirilir, host kaydında misafirin adına saklanır
//   guestInit(scene) {} / guestUpdate(scene, dt) {} // misafirde yalnızca görsel/yerel kısım (simülasyon host'ta)
//   netCloneHud(scene, e) {}         // host: misafirin panel kopyasındaki sabit düğmelere dinleyici bağla
// }
// Alan hasarı / temas / yakınlık tetikleyicileri yalnızca scene.player'a değil scene.allPlayers()'a bakmalı;
// misafire ait sonuç (ödül, envanter) için scene.net?.asPlayer(p, fn). Kozmetik kısa ömürlü nesneler için
// obj.netFx = true (aynalanmaz; misafir kendisi üretir), konumlu sarsıntı için scene.shakeAt(x, y, r, ms, şiddet).
//
// Ortak genişletme noktaları (GameScene üzerinde):
//   scene.addInteraction(fn)  → fn(scene) {dist, label, run()} | null döndürür; E tuşu / mobil eylem butonu en yakını çalıştırır
//   scene.extraTargets        → zombilerin hedefleyebileceği ek nesneler dizisi ({x,y,active,radius,takeDamage(n,src)})
//   scene.lightSources        → gece ışıkları: fn(scene) → [{x,y,r}, ...]
//   scene.featureMenu         → [{id, icon, label, key?, open(scene)}] panel açan özellikler (mobil menü + masaüstü dock gösterir)
//   scene.hud.openPanel(title, body, onClose) → genel modal (oyun duraklar); scene.hud.toast/notice/banner/floatText
//   scene.virtualMove         → {x,y} analog hareket vektörü (dokunmatik joystick yazar, Player okur)
//   ITEMS/RECIPES/SHOPS/QUESTS (config.js) → modül yüklenirken push/assign ile genişletilebilir
//   ITEMS[id].onUse(scene, ctx) → seçili eşya tıklanınca özel davranış (ctx: wx,wy,tx,ty,cx,cy,inReach,slot)
//   Olaylar: scene.events (waveStart, waveEnd, zombieKilled, playerDied, structureDestroyed, cropGrew, questsChanged)
//            scene.timeSys (dusk, dawn, hour)
export const features = [];
export function registerFeatures(list) { list.forEach((f) => { if (f && f.id) features.push(f); }); }
