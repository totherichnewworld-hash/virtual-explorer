/**
 * 瓦片代理 —— key 永远不进浏览器。
 *
 * 浏览器请求 /v1/3dtiles/xxx，这里在服务端把 key 拼上再转发给 Google。
 * 之所以挂在 /v1/3dtiles/ 这个路径上：Google 返回的 tileset JSON 里，
 * 子瓦片写的是 /v1/3dtiles/... 这样的绝对路径，挂在同样的位置才能原样接住，
 * 不用去改写 JSON。
 *
 * 环境变量：
 *   GOOGLE_MAPS_API_KEY  必填
 *   ALLOWED_ORIGINS      可选，逗号分隔；填了就只放行这些来源的 Referer
 *   UPSTREAM_REFERER     可选；key 若加了 HTTP referrer 限制，这里要带上对应的值
 *
 * 代价：每张瓦片都会跑一次 Function。Workers 免费额度 10 万次/天，
 * 一次几分钟的散步大概几百到几千张，个人用够，公开给一群人用就未必。
 */
const UPSTREAM = 'https://tile.googleapis.com/v1/3dtiles/';

export async function onRequestGet({ request, env, params }) {
  const key = env.GOOGLE_MAPS_API_KEY;
  if (!key) return new Response('GOOGLE_MAPS_API_KEY is not set', { status: 500 });

  // 来源校验（Referer 可以伪造，只是第一道门；真正的保险是配额上限）
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length) {
    const src = request.headers.get('Referer') || request.headers.get('Origin') || '';
    if (!allowed.some(a => src.startsWith(a))) return new Response('forbidden', { status: 403 });
  }

  const seg = Array.isArray(params.path) ? params.path.join('/') : (params.path || 'root.json');
  if (seg.includes('..')) return new Response('bad path', { status: 400 });

  const inUrl = new URL(request.url);
  const target = new URL(UPSTREAM + seg);
  for (const [k, v] of inUrl.searchParams) if (k !== 'key') target.searchParams.set(k, v);
  target.searchParams.set('key', key);

  const headers = { 'accept': request.headers.get('accept') || '*/*' };
  if (env.UPSTREAM_REFERER) headers['Referer'] = env.UPSTREAM_REFERER;

  const upstream = await fetch(target.toString(), { headers });

  // 原样透传，只把可能泄露的东西摘掉
  const out = new Headers(upstream.headers);
  out.delete('set-cookie');
  out.delete('x-goog-api-key');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
