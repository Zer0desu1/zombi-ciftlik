// Cloudflare Worker: oyuna kısa ömürlü Cloudflare TURN kimliği verir (gizli API anahtarı tarayıcıya hiç gitmez).
// Kurulum: server/README-TURN.md
// Ortam: TURN_KEY_ID (değişken), TURN_KEY_API_TOKEN (gizli), ALLOWED_ORIGINS (virgüllü; boşsa herkes)
const TTL = 6 * 3600; // saniye; oyun süresi dolmadan kendisi yeniler

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ok = !allowed.length || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': ok && origin ? origin : allowed[0] || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin'
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'GET') return new Response('Yalnızca GET', { status: 405, headers: cors });
    if (!ok) return new Response('Bu kaynaktan izin yok', { status: 403, headers: cors });

    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL })
    });
    if (!r.ok) return new Response(`TURN kimliği alınamadı (${r.status})`, { status: 502, headers: cors });
    const { iceServers } = await r.json();
    return new Response(JSON.stringify({ iceServers, ttl: TTL }), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
};
