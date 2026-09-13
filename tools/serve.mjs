#!/usr/bin/env node
/**
 * 本地跑真实地球版 —— 零依赖，不用装任何东西，不用 Cloudflare。
 *
 *   GOOGLE_MAPS_API_KEY=你的key node tools/serve.mjs
 *   打开 http://localhost:8080
 *
 * 它做两件事：
 *   1. 把 selfhost/ 当静态站点发出去
 *   2. 代理 /v1/3dtiles/* 到 Google，在服务端拼上 key
 *      —— 和 Cloudflare 上那个 Worker 是同一套逻辑，所以本地看到的
 *      就是部署后的样子，key 同样不进浏览器。
 *
 * 参数：--port 8080  --root selfhost
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root0 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d };

const PORT = Number(arg('port', process.env.PORT || 8080));
const ROOT = path.resolve(root0, arg('root', 'selfhost'));
const KEY  = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
const UPSTREAM = 'https://tile.googleapis.com/v1/3dtiles/';

const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg',
  '.ico':'image/x-icon', '.woff2':'font/woff2'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // --- 瓦片代理：key 留在这个进程里 ---
  if (url.pathname.startsWith('/v1/3dtiles/')) {
    if (!KEY) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('没有 GOOGLE_MAPS_API_KEY。这样启动：\n\n  GOOGLE_MAPS_API_KEY=你的key node tools/serve.mjs\n');
    }
    const seg = url.pathname.slice('/v1/3dtiles/'.length);
    if (seg.includes('..')) { res.writeHead(400); return res.end('bad path') }
    const target = new URL(UPSTREAM + seg);
    for (const [k, v] of url.searchParams) if (k !== 'key') target.searchParams.set(k, v);
    target.searchParams.set('key', KEY);
    try {
      const up = await fetch(target.toString(), { headers: { accept: req.headers.accept || '*/*' } });
      const headers = {};
      for (const h of ['content-type', 'content-length', 'cache-control']) {
        const v = up.headers.get(h); if (v) headers[h] = v;
      }
      res.writeHead(up.status, headers);
      if (!up.body) return res.end();
      const buf = Buffer.from(await up.arrayBuffer());
      if (up.status >= 400) console.error('· 上游 ' + up.status + ' ← ' + seg + '\n  ' + buf.toString('utf8').slice(0, 300));
      return res.end(buf);
    } catch (e) {
      console.error('· 转发失败:', e.message);
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('连不上 Google：' + e.message);
    }
  }

  // --- 静态文件 ---
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden') }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('找不到 ' + p);
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  真实地球版跑起来了 → http://localhost:' + PORT);
  console.log('  服务目录: ' + path.relative(root0, ROOT) + '/');
  console.log(KEY
    ? '  API key: 已读到（长度 ' + KEY.length + '），瓦片走本机代理，不进浏览器'
    : '  API key: 没有 —— 页面会停在配置说明页。这样启动：\n             GOOGLE_MAPS_API_KEY=你的key node tools/serve.mjs');
  console.log('');
  console.log('  想在手机上试体感，另开一个终端：npx localtunnel --port ' + PORT);
  console.log('  Ctrl+C 停止');
  console.log('');
});
