# 街区兑换所 · 真实地球版（自托管）

用 **Google Photorealistic 3D Tiles** 的真实影像，走在真的城市里。
和 artifact 版共用一套想法：踏步前进、转身转向，只是脚下换成了真实地球。

artifact 版（程序生成的街景，开箱即用）在仓库根目录的 `index.html`。
这一版需要你自己的 API key 和一个域名。

---

## 它能做什么

- 全球 2,500+ 座城市的真实三维影像，第一视角贴地行走
- **手机体感**：拿着手机原地踏步 → 往前走；转身 → 转向（可选"跟真实指南针"，
  你面朝北，画面也面朝北）
- 键盘：`W/S` 前后、`A/D` 转向、`R` 回正并重新校准、滚轮变焦、拖动看四周
- 预设八个起点，也可以直接粘贴 `纬度,经度` 或一条 Google Maps 链接跳过去
- 距离记在 `localStorage`：本次 / 今天 / 累计

## 只想先看看效果（不用 Cloudflare，两分钟）

```bash
GOOGLE_MAPS_API_KEY=你的key npm start
```

打开 `http://localhost:8080`。没了。

`tools/serve.mjs` 是个零依赖的本地服务器（不用 `npm install`），它同时做两件事：
发静态页面、把 `/v1/3dtiles/*` 代理到 Google 并在服务端拼上 key ——
**和 Cloudflare 上那个 Worker 是同一套逻辑**，所以本地看到的就是部署后的样子，
key 一样不进浏览器。

不带 key 启动也行，页面会停在配置说明页，不会偷偷发请求。

想在手机上试体感（传感器必须 HTTPS，localhost 在电脑上才算安全上下文）：

```bash
npx localtunnel --port 8080        # 会给你一个临时 https 地址
```

### 另一种本地方式：config.js

```bash
cd selfhost
cp config.example.js config.js     # 已在 .gitignore 里
$EDITOR config.js                  # 填 key
npx serve .
```

这种方式 key 会进浏览器（页面左上角会显示「key 在浏览器里」），
只适合自己本机看看。

## 部署到 Cloudflare Pages

```bash
# 仓库根目录
npx wrangler pages deploy selfhost --project-name citywalk
```

然后在 Pages 项目的 **Settings → Environment variables** 里加：

| 变量 | 值 |
|---|---|
| `GOOGLE_MAPS_API_KEY` | 你的 key |
| `ALLOWED_ORIGINS` | `https://citywalk.pages.dev`（逗号分隔可多个） |

`functions/api/key.js` 会按来源把 key 交给前端，线上就不需要 `config.js` 了。
Netlify / Vercel 同理，把那个函数改写成对应的 serverless 格式即可。

## 关于 key 安全（别跳过）

先把三种模式的真实差别摊开 —— 它们不是"安全/不安全"，是三个不同的高度：

| 模式 | key 在哪 | 谁能拿到 |
|---|---|---|
| **静态**（GitHub Pages） | 烤进 `earth/config.js` | 打开那个 URL 就能读。爬 JS 的机器人也能 |
| **发 key**（`/api/key`） | 运行时发给浏览器 | 不在静态文件里了，但 DevTools 的 Network 里看得见 |
| **代理**（`/v1/3dtiles/`） | **只在 Cloudflare 服务端** | 浏览器从头到尾没见过它 |

前端会**自动选最高的那个**：先探 `/v1/3dtiles/root.json`，通了就走代理模式；
不通再退回 key 模式；都没有就停在配置说明页。页面左上角会显示当前是
「key 在服务端」还是「key 在浏览器里」，不猜。

不管走哪种，下面三件事都要做：

1. **HTTP referrer 限制**：Cloud Console → 你的 key → 应用限制 → 选 HTTP referrer，
   填 `https://你的域名/*`。别人拿去用会被 Google 拒掉。
2. **API 限制**：同一页面往下，只勾 `Map Tiles API`。
3. **配额上限 + 预算告警**：`APIs & Services → Quotas` 给 Photorealistic 3D Tiles
   设每日上限；`Billing → Budgets & alerts` 设一个预算告警。这是最后一道保险。

## 花多少钱

- Photorealistic 3D Tiles 按 **root tile 请求**计费，约等于一次"会话"，
  一次请求可以撑 **至少 3 小时**的瓦片拉取
- 每月 **前 1,000 次免费**，之后约 **$6 / 1,000 次**
- 一个人自己用：一天开五次，一个月 150 次 —— **落在免费额度里**

（2026 年 9 月查到的数字，来自 Google 文档与第三方整理；上线前请在
Cloud Console 的 rate card 上再核一眼。2025 年 3 月起那个 $200 统一额度已经取消，
改成每个 SKU 各自的免费额度且不再共享。）

## 手机上用体感

传感器要求 **安全上下文**：

- `https://` ✅
- `http://localhost` ✅
- 局域网 IP `http://192.168.x.x` ❌ —— 手机上测要么部署上去，
  要么用 `cloudflared tunnel --url http://localhost:3000` 开个临时 https

iOS 还要求权限必须由一次点击触发 —— 页面上的「打开体感」按钮就是干这个的。
读不到传感器时它会明说，不会假装在工作。

## 已知的坑

- **街道高度的影像是"融化"的**。Photorealistic 3D Tiles 是航拍重建的网格，
  从空中看很惊艳，贴到地面会发现车和树糊成一团、招牌看不清。
  想要清晰的街面细节，得换 Street View 的真实全景照片（那就变成在离散全景点之间跳）。
- **没有碰撞**。你会直接穿墙而过。要挡住的话得对瓦片做射线检测，这版没做。
- **贴地靠采样**。`scene.sampleHeightMostDetailed` 需要 WebGL2；不支持时相机会停在
  预设的大致高度上，用滚轮和拖动自己找。
- **版权标识必须留着**。Google 的服务条款要求影像来源始终可见，
  所以别去动那个 `showCreditsOnScreen` 和左下角的 credit 条。
- **这份代码没有对着真实 API 跑过** —— 这个开发环境连不上 Google。
  逻辑部分（相机、行走、贴地采样、坐标解析、体感）用替身库完整跑通了，
  但第一次接上真 key 时如果有出入，把报错发我。

## 文件

```
selfhost/
├── index.html            页面与样式
├── app.js                Cesium 相机、第一视角行走、体感
├── config.example.js     本地 key（复制成 config.js）
└── functions/api/key.js  Cloudflare Pages Function：按来源发 key
```

---

## 托管在 GitHub Pages

仓库里已经带了 `.github/workflows/pages.yml` 和 `tools/build-pages.mjs`。
推上去就会自动构建并发布：

```
https://<你的用户名>.github.io/virtual-explorer/         程序生成街景版
https://<你的用户名>.github.io/virtual-explorer/earth/   真实地球版
```

### 三件必须先知道的事

**1. private 仓库要 GitHub Pro。**
GitHub Pages 对私有仓库是付费功能（Pro 及以上）。这个仓库现在是 private，
所以三选一：把仓库设成 public ／ 升级 Pro ／ 改用 Cloudflare Pages（免费，私有仓库也行）。

**2. Pages 是纯静态，跑不了 `functions/api/key.js`。**
所以 key 改成**构建时注入**：在仓库
`Settings → Secrets and variables → Actions → New repository secret`
加一个 `GOOGLE_MAPS_API_KEY`。构建时它会被写进 `earth/config.js`，
**key 不进仓库、不进 git 历史**，但会出现在发布出去的 JS 里 —— 静态托管绕不开这一点。

**3. 所以 referrer 限制在这里是强制的，不是可选的。**
Cloud Console → 你的 key → 应用限制 → HTTP referrer，填：

```
https://<你的用户名>.github.io/virtual-explorer/*
```

再配上「只勾 Map Tiles API」和配额上限。做完这三步，key 就算被人看到也用不了。

### 开起来

1. **先手动打开 Pages**：`Settings → Pages` → Source 选 **GitHub Actions**。
   这一步只能手动点 —— 创建 Pages 站点需要仓库管理员权限，
   workflow 的 `GITHUB_TOKEN` 没有这个权限，所以自动创建会报
   `Resource not accessible by integration`。点一次，以后就不用管了。
2. `Settings → Actions → General`，确认 Actions 是打开的
3. 加上面那个 Secret（不加也能构建，真实地球版会停在配置说明页）
4. 推一次代码，或在 Actions 页面手动跑一次 `Deploy to GitHub Pages`

### 本地预览发布版

```bash
node tools/build-pages.mjs        # 想带 key：GOOGLE_MAPS_API_KEY=xxx node tools/build-pages.mjs
npx serve _site
```

`_site/` 已经在 `.gitignore` 里。

### 为什么根目录那份要重新包一层

artifact 版的 `index.html` 没有 `<!doctype>`／`<html>`／`<head>` —— 发布到 Claude 时平台会包一层外壳。
静态托管没人替你包，浏览器会掉进怪异模式、布局全歪。
`tools/build-pages.mjs` 就是补这层外壳，同时给两个版本互相加了跳转链接。
**artifact 源文件本身没被改动**，两边各自干净。

---

## 部署到 Cloudflare Pages（推荐，key 能真正藏住）

```bash
# 仓库根目录
TARGET=cloudflare node tools/build-pages.mjs
npx wrangler pages deploy _site --project-name citywalk
```

`TARGET=cloudflare` 会把 `selfhost/functions/` 一起打进 `_site/`，
并且**不往前端塞任何 key**。

然后在 Pages 项目的 **Settings → Environment variables** 里加：

| 变量 | 值 | 说明 |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | 你的 key | 只有服务端读得到 |
| `ALLOWED_ORIGINS` | `https://citywalk.pages.dev` | 挡掉别人拿你的代理白嫖瓦片 |
| `UPSTREAM_REFERER` | `https://citywalk.pages.dev/` | **别漏**，见下 |

### 为什么要 `UPSTREAM_REFERER`

你给 key 加了 HTTP referrer 限制之后，浏览器发请求会自动带 Referer，没问题；
但**代理是从 Cloudflare 服务端发出去的，没有浏览器 Referer**，Google 会直接拒掉。
所以要让 Worker 手动带上一个匹配限制的 Referer —— 就是这个变量。

设了它，referrer 限制和代理就能同时生效：key 既藏在服务端，万一泄漏也用不了。

### 代理模式的代价

- **每张瓦片都会跑一次 Function**。Workers 免费额度 10 万次/天；
  一次几分钟的散步大概几百到几千张瓦片 —— 你一个人用完全够，
  公开给一群人用就要盯着点用量。
- **多一跳延迟**。瓦片要绕经 Cloudflare 边缘，比直连 Google 慢一点点。
- **我没有做缓存**。给瓦片加 CDN 缓存能省下大量 Function 调用，
  但 Google 的服务条款对缓存和存储影像有明确限制 —— 要加之前先去读条款，
  别想当然。

### 不想让 Cloudflare 碰你的仓库

`wrangler pages deploy` 是直传，不需要连 GitHub。
仓库可以继续躺在那儿保持 private，一点都不用动。

### 和 GitHub Pages 的取舍

| | GitHub Pages | Cloudflare Pages |
|---|---|---|
| 私有仓库 | 要 Pro | 免费就行 |
| serverless 函数 | ✗ | ✓（`functions/api/key.js` 直接能用） |
| key 怎么进去 | 构建时注入，**进 JS** | **代理模式下根本不进浏览器** |
| 部署 | push 就好 | `npx wrangler pages deploy` 或连 Git |

GitHub Pages 胜在零成本零门槛；Cloudflare 胜在 key 能真正藏在服务端。
但**无论哪边，referrer 限制 + 配额上限都是必做的** —— 代理只是让 key 难拿到，
配额上限才是账单的最后一道保险。
