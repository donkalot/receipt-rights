// Relay for "Move to another device". Holds an encrypted blob for 24 hours; it never has the key.
const TTL_SECONDS = 24 * 60 * 60;
const MAX_BYTES = 20 * 1024 * 1024;
const ID = /^\/t\/([A-Za-z0-9_-]{22})$/;

function allowedOrigin(origin) {
  if (origin === 'https://donkalot.github.io') return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '')) return origin;
  return null;
}

function newId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request.headers.get('Origin'));
    const cors = origin ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    } : { Vary: 'Origin' };
    const reply = (body, status, extra = {}) => new Response(body, { status, headers: { ...cors, ...extra } });
    const json = (obj, status = 200) => reply(JSON.stringify(obj), status, { 'Content-Type': 'application/json' });

    if (!origin) return json({ error: 'origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return reply(null, 204);

    const { pathname } = new URL(request.url);

    if (pathname === '/t' && request.method === 'POST') {
      if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) return json({ error: 'too large' }, 413);
      const body = await request.arrayBuffer();
      if (!body.byteLength) return json({ error: 'empty' }, 400);
      if (body.byteLength > MAX_BYTES) return json({ error: 'too large' }, 413);
      const id = newId();
      await env.BLOBS.put(id, body, { expirationTtl: TTL_SECONDS });
      return json({ id, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000).toISOString() }, 201);
    }

    const m = pathname.match(ID);
    if (m && request.method === 'GET') {
      const blob = await env.BLOBS.get(m[1], 'arrayBuffer');
      if (!blob) return json({ error: 'not found' }, 404);
      return reply(blob, 200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
    }
    if (m && request.method === 'DELETE') {
      await env.BLOBS.delete(m[1]);
      return reply(null, 204);
    }
    return json({ error: 'not found' }, 404);
  },
};
