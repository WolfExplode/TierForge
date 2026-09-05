export const allowedImageHost = hostname => hostname === 'slaythespire.wiki.gg' ||
  hostname === 'tiermaker.com' || hostname.endsWith('.tiermaker.com');

function json(status, value) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
}

async function imageResponse(request) {
  const source = new URL(request.url).searchParams.get('url');
  let upstream;
  try { upstream = new URL(source); }
  catch { return json(400, { error: 'invalid image URL' }); }
  if (upstream.protocol !== 'https:' || !allowedImageHost(upstream.hostname)) {
    return json(403, { error: 'image host is not allowed' });
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await fetch(upstream, {
    headers: { 'user-agent': 'TierForge image cache/1.0' },
    redirect: 'follow',
  });
  if (!response.ok) return json(response.status, { error: `upstream HTTP ${response.status}` });
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return json(415, { error: 'upstream response is not an image' });

  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('cross-origin-resource-policy', 'cross-origin');
  headers.set('cache-control', 'public, max-age=14400, s-maxage=86400');
  headers.delete('set-cookie');
  const result = new Response(response.body, { status: 200, headers });
  await cache.put(cacheKey, result.clone());
  return result;
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/image') return imageResponse(request);
    return env.ASSETS.fetch(request);
  },
};
