// Yayın (prod) ağ ayarları. Boş bırakılırsa oyun eskisi gibi STUN + PeerJS genel TURN ile çalışır.
export const NET_CONFIG = {
  // Kısa ömürlü TURN kimliği veren uç nokta (bkz. server/turn-worker.js — Cloudflare Worker).
  // Metered.ca'nın "credentials" API adresi de doğrudan yazılabilir (…/api/v1/turn/credentials?apiKey=…).
  // Test için URL'den geçersiz kılınabilir: ?turnApi=https://…
  turnEndpoint: '',

  // Kendi PeerServer'ın (sinyal sunucusu). null → PeerJS'in ücretsiz genel sunucusu (0.peerjs.com).
  // Örnek: { host: 'sinyal.alanadin.com', port: 443, path: '/', secure: true }
  peerServer: null
};
