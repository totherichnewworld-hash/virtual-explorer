#!/usr/bin/env node
/**
 * 生成 _site/ —— 给 GitHub Pages（或任何静态托管）用。
 *
 *   _site/index.html    程序生成街景版（artifact 那份，补上 <!doctype> 外壳）
 *   _site/earth/        真实地球版
 *   _site/earth/config.js   构建时从环境变量 GOOGLE_MAPS_API_KEY 生成（没有就不生成）
 *
 * 两个目标：
 *   node tools/build-pages.mjs                    → GitHub Pages（纯静态，key 烤进 JS）
 *   TARGET=cloudflare node tools/build-pages.mjs  → Cloudflare Pages（带 functions/，
 *                                                    key 留在服务端，不进 JS）
 *
 * 本地跑：node tools/build-pages.mjs && npx serve _site
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out  = path.join(root, '_site');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'earth'), { recursive: true });

/* ---- 1. artifact 版：它原本没有 <!doctype>/<html>/<head>，
        因为发布时平台会包一层。静态托管得自己补，否则浏览器进怪异模式。 ---- */
const inner = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const shell = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="把室内活动换算成真实城市路线上的步行距离">
<style>
  :root{color-scheme:light dark}
  body{margin:0;font:14px/1.5 system-ui,-apple-system,sans-serif;background:#E6E7E0}
  img{max-width:100%}
  [hidden]{display:none!important}
</style>
${inner}
<a href="earth/" style="position:fixed;right:14px;bottom:14px;z-index:95;
  font:11.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.05em;text-decoration:none;
  padding:9px 14px;border-radius:99px;background:#16243F;color:#E6E7E0;
  box-shadow:0 8px 22px -12px #000">真实地球版 →</a>
</html>
`;
fs.writeFileSync(path.join(out, 'index.html'), shell);

/* ---- 2. 真实地球版 ---- */
for (const f of ['index.html', 'app.js', 'config.example.js']) {
  fs.copyFileSync(path.join(root, 'selfhost', f), path.join(out, 'earth', f));
}
// 回根目录的链接
const earth = fs.readFileSync(path.join(out, 'earth', 'index.html'), 'utf8')
  .replace('</body>', `<a href="../" style="position:fixed;left:14px;bottom:14px;z-index:12;
  font:11.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.05em;text-decoration:none;
  padding:9px 14px;border-radius:99px;background:#121D2Cdd;color:#DCE3DC;
  border:1px solid #26384D">← 程序生成版</a></body>`);
fs.writeFileSync(path.join(out, 'earth', 'index.html'), earth);

/* ---- 3. Cloudflare：把 functions/ 带上，key 就不用进前端了 ---- */
const target = (process.env.TARGET || 'github').toLowerCase();
if (target === 'cloudflare') {
  fs.cpSync(path.join(root, 'selfhost', 'functions'), path.join(out, 'functions'),
            { recursive: true });
  fs.writeFileSync(path.join(out, 'earth', 'config.js'),
    '/* Cloudflare 模式：key 由 functions/ 在服务端处理，不进前端 */\n' +
    'window.CITYWALK_CONFIG={googleMapsApiKey:""};\n');
  console.log('· Cloudflare 模式：已带上 functions/，前端不含 key');
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  console.log('构建完成 → _site/');
  process.exit(0);
}

/* ---- 4. GitHub Pages：纯静态，key 只能烤进 JS ---- */
const key = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
if (key) {
  fs.writeFileSync(path.join(out, 'earth', 'config.js'),
    `/* 构建时生成，勿手改 */\nwindow.CITYWALK_CONFIG={googleMapsApiKey:${JSON.stringify(key)}};\n`);
  console.log('· 已把 API key 注入 earth/config.js（长度 ' + key.length +
    '）—— 静态托管绕不开，记得给 key 加 referrer 限制');
} else {
  // 写个空壳，免得页面去 404 一个不存在的 config.js
  fs.writeFileSync(path.join(out, 'earth', 'config.js'),
    '/* 构建时没有 GOOGLE_MAPS_API_KEY */\nwindow.CITYWALK_CONFIG={googleMapsApiKey:""};\n');
  console.log('· 没有 GOOGLE_MAPS_API_KEY，真实地球版会停在配置说明页');
}

fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('构建完成 → _site/');
