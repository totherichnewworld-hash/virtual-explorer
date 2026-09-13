/**
 * Cloudflare Pages Function: 按来源放行后把 key 交给前端。
 *
 * 说明白一点：这不是真正的保密 —— key 最终还是会到浏览器里，
 * 任何人打开开发者工具都能看到。它只是挡掉最懒的那种抓取。
 * 真正管用的是另外两件事：
 *   1) 在 Google Cloud Console 给 key 加 HTTP referrer 限制 + 只允许 Map Tiles API
 *   2) 设配额上限和预算告警
 *
 * 环境变量：
 *   GOOGLE_MAPS_API_KEY  必填
 *   ALLOWED_ORIGINS      可选，逗号分隔，例如 https://citywalk.pages.dev,http://localhost:3000
 */
export function onRequestGet({ request, env }) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });

  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (allowed.length) {
    const src = request.headers.get('Origin') || request.headers.get('Referer') || '';
    if (!allowed.some(a => src.startsWith(a))) {
      return json({ error: 'origin not allowed' }, 403);
    }
  }
  if (!env.GOOGLE_MAPS_API_KEY) {
    return json({ error: 'GOOGLE_MAPS_API_KEY is not set' }, 500);
  }
  return json({ key: env.GOOGLE_MAPS_API_KEY });
}
