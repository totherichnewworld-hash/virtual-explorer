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

## 五分钟跑起来

```bash
# 1. 拿 key
#    Google Cloud Console → 新建项目 → 启用 "Map Tiles API" → 创建 API key

# 2. 本地填 key
cd selfhost
cp config.example.js config.js        # config.js 已在 .gitignore 里
$EDITOR config.js                     # 填上你的 key

# 3. 起一个本地服务（localhost 是安全上下文，传感器能用）
npx serve .                           # 或 python3 -m http.server 3000
```

打开 `http://localhost:3000`。没填 key 的话，页面会停在配置说明上，不会偷偷发请求。

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

`functions/api/key.js` **不是真正的保密** —— key 最终一定会到浏览器里，
打开开发者工具就能看到。真正管用的是这三件事：

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

1. `Settings → Actions → General`，确认 Actions 是打开的
2. 加上面那个 Secret（不加也能构建，真实地球版会停在配置说明页）
3. 推一次代码，或在 Actions 页面手动跑一次 `Deploy to GitHub Pages`
4. workflow 里带了 `enablement: true`，会自己把 Pages 打开；
   若失败就去 `Settings → Pages` 把 Source 选成 `GitHub Actions`

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

### 和 Cloudflare Pages 的取舍

| | GitHub Pages | Cloudflare Pages |
|---|---|---|
| 私有仓库 | 要 Pro | 免费就行 |
| serverless 函数 | ✗ | ✓（`functions/api/key.js` 直接能用） |
| key 怎么进去 | 构建时注入，进 JS | 运行时按来源发放 |
| 部署 | push 就好 | `npx wrangler pages deploy` 或连 Git |

说到底两边的 key 都会到浏览器里 —— **真正拦住盗用的永远是 referrer 限制 + 配额上限**，
不是托管平台。GitHub Pages 完全够用。
