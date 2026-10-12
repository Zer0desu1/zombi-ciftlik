# Co-op için yerleşik TURN (Cloudflare)

Farklı ağlardaki (ev ↔ mobil veri, okul/iş ağları) oyuncuların doğrudan bağlantısı NAT yüzünden kurulamazsa
trafik TURN sunucusu üzerinden aktarılır. Oyun, kimliği bu Worker'dan alır; oyuncu hiçbir ayar yapmaz.

Maliyet: Cloudflare TURN'de aylık ilk 1000 GB ücretsiz, sonrası GB başına ~0,05 $. Bir co-op oturumu saatte
yalnızca birkaç MB harcar ve trafiğin çoğu zaten doğrudan bağlantıdan gider.

## Kurulum (bir kez, ~10 dk)

1. Cloudflare panelinde **Realtime → TURN Server → Create** ile bir TURN anahtarı oluştur.
   **Turn Token ID** ve **API Token** değerlerini not al.
2. `server/wrangler.toml` içinde `TURN_KEY_ID` alanına Token ID'yi yaz; `ALLOWED_ORIGINS` oyunun adresi olsun.
3. Bu klasörde:
   ```bash
   npx wrangler login
   npx wrangler secret put TURN_KEY_API_TOKEN   # API Token'ı yapıştır
   npx wrangler deploy
   ```
   Çıktıdaki adresi (`https://zombi-ciftlik-turn.<hesap>.workers.dev`) kopyala.
4. `js/net/netConfig.js` içinde `turnEndpoint` alanına bu adresi yaz ve yayınla.

## Kontrol

- Tarayıcıda Worker adresini aç: `iceServers` içeren bir JSON dönmeli (izinli kaynak dışından 403 normal).
- Oyunda oda kur → 📶 Bağlantı → "ICE sunucuları" listesinde `turn.cloudflare.com` görünmeli.
- Yalnızca TURN ile bağlanmayı zorlamak için davet linkinin sonuna `&relay=1` ekle; bağlanıyorsa TURN çalışıyor.
- Worker'ı yayınlamadan denemek için: `?turnApi=https://…` parametresi.

## Alternatif: Metered.ca

Sunucu kurmadan: Metered panelindeki "credentials" API adresini (`https://<uygulama>.metered.live/api/v1/turn/credentials?apiKey=…`)
doğrudan `turnEndpoint`'e yazabilirsin. Anahtar tarayıcıda görünür; Metered panelinden alan adı kısıtlaması aç.
