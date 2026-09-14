/* ============================================================
   街区兑换所 · 真实地球版
   Google Photorealistic 3D Tiles + 第一视角 + 手机体感
   ============================================================ */
'use strict';

const EYE = 1.7;          // 眼睛离地高度（米）
const STEP_M = 0.72;      // 兜底步幅
const R_EARTH = 6378137;

const $ = s => document.querySelector(s);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

/* 起点：各城市的大致市中心。到了之后用键盘或体感自己走开。 */
const PRESETS = [
  // h 只是落地前的粗略海拔，贴地采样一到就会纠正
  {n:'里斯本 · 商业广场',      lat:38.70754, lon:-9.13647, h:8,  tz:'Europe/Lisbon'},
  {n:'京都 · 祇园四条',        lat:35.00370, lon:135.77200, h:45, tz:'Asia/Tokyo'},
  {n:'伊斯坦布尔 · 加拉塔塔',  lat:41.02560, lon:28.97410, h:40, tz:'Europe/Istanbul'},
  {n:'纽约 · 华盛顿广场',      lat:40.73080, lon:-73.99730, h:10, tz:'America/New_York'},
  {n:'雷克雅未克 · 大教堂',    lat:64.14170, lon:-21.92660, h:40, tz:'Atlantic/Reykjavik'},
  {n:'布宜诺斯艾利斯 · 多雷戈',lat:-34.62050,lon:-58.37170, h:12, tz:'America/Argentina/Buenos_Aires'},
  {n:'巴黎 · 蓬皮杜',          lat:48.86070, lon:2.35220,  h:35, tz:'Europe/Paris'},
  {n:'香港 · 中环',            lat:22.28190, lon:114.15830, h:12, tz:'Asia/Hong_Kong'}
];

/* ---------- 瓦片从哪来 ----------
   1. 代理模式：同源的 /v1/3dtiles/，key 留在服务端，浏览器根本拿不到
   2. key 模式：本地 config.js 或 /api/key，key 会进浏览器
   3. 都没有：停在配置说明页，一个请求都不发                        */
const PROXY_ROOT = '/v1/3dtiles/root.json';

async function resolveTileSource(){
  try{
    const r = await fetch(PROXY_ROOT, { headers:{ accept:'application/json' } });
    if (r.ok && /json/.test(r.headers.get('content-type') || '')){
      return { url: PROXY_ROOT, mode: 'proxy' };
    }
  }catch(e){}
  const key = await getKey();
  if (!key) return null;
  return {
    url: 'https://tile.googleapis.com/v1/3dtiles/root.json?key=' + encodeURIComponent(key),
    mode: 'key'
  };
}

async function getKey(){
  const cfg = window.CITYWALK_CONFIG;
  if (cfg && cfg.googleMapsApiKey && !/^YOUR_/.test(cfg.googleMapsApiKey)) return cfg.googleMapsApiKey;
  if (location.protocol === 'file:') return null;   // 本地直接开文件时别去 fetch
  try{
    const r = await fetch('/api/key', {headers:{'accept':'application/json'}});
    if (r.ok){ const j = await r.json(); if (j && j.key) return j.key }
  }catch(e){}
  return null;
}

/* ---------- 瓦片失败时，把 Google 的原话挖出来 ---------- */
const REASONS = {
  SERVICE_DISABLED:            ['这个项目还没启用 Map Tiles API', '控制台顶部搜 "Map Tiles API" → 点 启用'],
  BILLING_DISABLED:            ['项目没绑定结算账号', 'Map Tiles API 强制要求绑定结算账号（要信用卡）。左侧 结算 → 关联结算账号'],
  API_KEY_SERVICE_BLOCKED:     ['这把 key 不允许调 Map Tiles API', '凭据 → 点 key → API 限制 → 勾上 Map Tiles API'],
  API_KEY_HTTP_REFERRER_BLOCKED:['key 上的「HTTP 来源」限制挡住了这个网址',
                                 '凭据 → 点 key → 应用限制：把 ' + location.origin + location.pathname.replace(/earth\/$/, '') + '* 加进去，或直接改成「无」'],
  API_KEY_INVALID:             ['key 不对', '可能复制少了几位。最快的办法是删掉重建一把，创建时弹窗里直接复制'],
  RATE_LIMIT_EXCEEDED:         ['当天配额用完了', '这是配额上限在保护你。等太平洋时间零点自动恢复，或把每日配额调高一点'],
  PERMISSION_DENIED:           ['被拒绝了', '看下面 Google 的原话']
};

async function showTileError(src, err){
  let reason = '', message = '', status = '';
  try{
    const r = await fetch(src.url, { headers:{ accept:'application/json' } });
    status = r.status;
    const j = await r.json().catch(()=>null);
    if (j && j.error){
      message = j.error.message || '';
      const d = (j.error.details || []).find(x => x.reason);
      reason = (d && d.reason) || j.error.status || '';
    }
  }catch(e){}
  const hit = REASONS[reason];
  const card = document.querySelector('#setup .card');
  card.innerHTML =
    '<p class="eyebrow">瓦片没能加载</p>' +
    '<h2>' + (hit ? hit[0] : ('Google 拒绝了请求' + (status ? '（' + status + '）' : ''))) + '</h2>' +
    (hit ? '<p style="font-size:14px;line-height:1.9">' + hit[1] + '</p>' : '') +
    (reason ? '<p class="warn"><b>reason:</b> <code>' + reason + '</code></p>' : '') +
    (message ? '<p class="warn"><b>Google 原话：</b>' + message.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) + '</p>' : '') +
    (!reason && !message ? '<p class="warn">' + (err && err.message ? err.message : String(err)) + '</p>' : '') +
    '<p class="warn">改完 Google 那边的设置后，<b>直接刷新这一页</b>就行 —— 不用重新部署。' +
    '（来源限制的改动 Google 那边有几分钟延迟。）</p>';
  document.getElementById('setup').hidden = false;
}

/* ---------- 大地测量：沿方位角前进 ---------- */
function moveLatLon(lat, lon, bearingDeg, meters){
  const d = meters / R_EARTH, b = bearingDeg * Math.PI/180;
  const p1 = lat*Math.PI/180, l1 = lon*Math.PI/180;
  const p2 = Math.asin(Math.sin(p1)*Math.cos(d) + Math.cos(p1)*Math.sin(d)*Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(p1),
                             Math.cos(d) - Math.sin(p1)*Math.sin(p2));
  return [p2*180/Math.PI, ((l2*180/Math.PI + 540) % 360) - 180];
}

function distBetween(la1, lo1, la2, lo2){
  const R = R_EARTH, p1 = la1*Math.PI/180, p2 = la2*Math.PI/180;
  const dp = (la2-la1)*Math.PI/180, dl = (lo2-lo1)*Math.PI/180;
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.min(1, Math.sqrt(a)));
}

/* ============================================================
   状态
   ============================================================ */
const S = {
  lat:PRESETS[0].lat, lon:PRESETS[0].lon, heading:0, pitch:0,
  ground:PRESETS[0].h, groundKnown:false, session:0, today:0, total:0, day:'',
  alt:0, pitchOff:0            // 空降时的额外高度与俯角，落地后归零
};
try{
  const raw = localStorage.getItem('citywalk-earth');
  if (raw){ const o = JSON.parse(raw); Object.assign(S, o, {session:0}) }
}catch(e){}
const dayKey = () => new Date().toISOString().slice(0,10);
if (S.day !== dayKey()){ S.day = dayKey(); S.today = 0 }
let saveT = null;
function save(){
  clearTimeout(saveT);
  saveT = setTimeout(()=>{
    try{ localStorage.setItem('citywalk-earth', JSON.stringify({
      lat:S.lat, lon:S.lon, heading:S.heading,
      today:S.today, total:S.total, day:S.day })) }catch(e){}
  }, 700);
}

function advance(meters){
  const [la, lo] = moveLatLon(S.lat, S.lon, S.heading, meters);
  S.lat = la; S.lon = lo;
  S.session += meters; S.today += meters; S.total += meters;
  save();
}

/* ============================================================
   体感：踏步 → 前进，转身 → 转向
   ============================================================ */
const MOTION = {
  on:false, steering:false, absolute:false, gotMotion:false, gotOrient:false,
  smooth:9.8, base:9.8, armed:false, lastStep:0, hist:[], peak:0, t0:0,
  thresh:1.15, head0:null, headNow:0, beta0:null, stride:STEP_M, wake:null, probe:null,

  supported(){ return typeof window.DeviceMotionEvent !== 'undefined' },

  async toggle(){
    if (this.on) return this.stop();
    const btn = $('#motionBtn');
    btn.disabled = true; btn.textContent = '请求权限…';
    let ok = true;
    try{
      if (window.DeviceMotionEvent && DeviceMotionEvent.requestPermission)
        ok = (await DeviceMotionEvent.requestPermission()) === 'granted';
      if (ok && window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission)
        try{ await DeviceOrientationEvent.requestPermission() }catch(e){}
    }catch(e){ ok = false }
    btn.disabled = false;
    if (!ok){ btn.textContent = '打开体感'; this.say('没拿到传感器权限。'); return }
    this.start();
  },

  start(){
    this.on = true; this.gotMotion = this.gotOrient = false;
    this.hist = []; this.head0 = null; this.beta0 = null;
    this.smooth = this.base = 9.8; this.t0 = performance.now();
    this._m = e => this.onMotion(e); this._o = e => this.onOrient(e);
    addEventListener('devicemotion', this._m);
    addEventListener('deviceorientationabsolute', this._o);
    addEventListener('deviceorientation', this._o);
    $('#motionBtn').textContent = '关掉体感';
    $('#motionBtn').setAttribute('aria-pressed','true');
    this.say('等传感器…');
    if (window.matchMedia('(max-width: 700px)').matches){
      setTimeout(()=>{                       // 手机上收起面板，别挡着街
        $('#hud').classList.add('collapsed');
        $('#hudToggle').setAttribute('aria-expanded','false');
      }, 1200);
    }
    if (navigator.wakeLock && navigator.wakeLock.request)
      navigator.wakeLock.request('screen').then(w => this.wake = w).catch(()=>{});
    clearTimeout(this.probe);
    this.probe = setTimeout(()=>{
      if (!this.gotMotion){ this.stop(); this.say('读不到运动传感器。手机上用 HTTPS 打开这一页再试。') }
      else if (!this.gotOrient) this.say('有步频，没有方向传感器：转向用 A / D 或拖动。');
    }, 2600);
  },

  stop(){
    this.on = this.steering = false;
    removeEventListener('devicemotion', this._m);
    removeEventListener('deviceorientationabsolute', this._o);
    removeEventListener('deviceorientation', this._o);
    clearTimeout(this.probe);
    if (this.wake && this.wake.release){ this.wake.release().catch(()=>{}); this.wake = null }
    $('#motionBtn').textContent = '打开体感';
    $('#motionBtn').setAttribute('aria-pressed','false');
    $('#bar').style.width = '0%';
    this.say('体感没开');
  },

  say(t){ $('#motionRead').innerHTML = t },

  cadence(){
    const now = performance.now();
    while (this.hist.length && now - this.hist[0] > 6000) this.hist.shift();
    return Math.round(this.hist.length / 6 * 60);
  },
  strideFor(){ return clamp(0.42 + (this.cadence() - 55) * 0.0042, 0.42, 0.95) },

  onMotion(e){
    this.gotMotion = true;
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x == null) return;
    const mag = Math.hypot(a.x, a.y, a.z);
    this.smooth += (mag - this.smooth) * 0.3;
    this.base   += (this.smooth - this.base) * 0.016;
    const d = this.smooth - this.base, now = performance.now();
    this.peak = Math.max(this.peak * 0.9, Math.abs(d));
    if (now - this.t0 < 900) return;          // 开机先让基线稳住
    if (Math.abs(d) > 9){ this.armed = false; return }   // 甩手机不算走路
    if (!this.armed && d > this.thresh && now - this.lastStep > 255){
      const gap = now - this.lastStep;
      this.armed = true; this.lastStep = now;
      this.hist.push(now); if (this.hist.length > 40) this.hist.shift();
      this.stride = gap < 2400 ? this.strideFor() : STEP_M;
      advance(this.stride);
      const w = $('#barWrap'), h = $('#hud');
      w.classList.add('hit'); h.classList.add('hit');
      setTimeout(()=>{ w.classList.remove('hit'); h.classList.remove('hit') }, 110);
    } else if (this.armed && d < this.thresh * 0.45) this.armed = false;
  },

  onOrient(e){
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.alpha != null) h = (360 - e.alpha) % 360;   // 都转成顺时针罗盘角
    if (h == null) return;
    this.gotOrient = this.steering = true;
    this.headNow = h;
    if (this.head0 == null) this.head0 = h;
    if (this.absolute){
      S.heading = h;                                        // 你朝哪，画面朝哪
    } else {
      let d = ((h - this.head0 + 540) % 360) - 180;
      if (Math.abs(d) < 2.5) d = 0;
      S.heading = (this.base0 || 0) + d;
    }
    if (e.beta != null){
      if (this.beta0 == null) this.beta0 = e.beta;
      let b = this.beta0 - e.beta;
      if (Math.abs(b) < 3) b = 0;
      S.pitch = clamp(b, -55, 60);
    }
  },

  calibrate(){
    this.head0 = this.headNow; this.beta0 = null;
    this.base0 = S.heading; S.pitch = 0;
    this.say('就以现在这个姿势当正前方');
  },

  tick(){
    if (!this.on) return;
    $('#bar').style.width = clamp(this.peak / 2.6 * 100, 0, 100) + '%';
    const now = performance.now();
    if (now - (this._said || 0) < 400) return;
    this._said = now;
    const moving = now - this.lastStep < 1800;
    this.say((moving
        ? '步频 <b>' + this.cadence() + '</b> 步/分 · 步幅 <b>' + this.stride.toFixed(2) + '</b> m'
        : '站着没动 · 踏起来就走') +
      (this.steering ? ' · 朝向 <b>' + Math.round(S.heading) + '°</b>' : ' · 无方向传感器'));
  }
};

/* ============================================================
   Cesium
   ============================================================ */
let viewer, scene, camera, tileset, lastSample = 0;

async function boot(){
  const src = await resolveTileSource();
  if (!src) return;                       // 停在配置说明页
  $('#setup').hidden = true;
  $('#navPanel').hidden = $('#hud').hidden = $('#cross').hidden = false;
  $('#walkBtn').hidden = false;

  viewer = new Cesium.Viewer('globe', {
    globe:false, baseLayerPicker:false, geocoder:false, homeButton:false,
    sceneModePicker:false, navigationHelpButton:false, animation:false,
    timeline:false, fullscreenButton:false, infoBox:false, selectionIndicator:false,
    requestRenderMode:false
  });
  scene = viewer.scene; camera = scene.camera;
  scene.screenSpaceCameraController.enableInputs = false;   // 自己接管相机
  scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;

  try{
    tileset = await Cesium.Cesium3DTileset.fromUrl(src.url,
      { showCreditsOnScreen:true, maximumScreenSpaceError:16 });
    // 贴地视角看得远，远处不需要那么精细 —— 这个开关是专门给这种情况的
    try{ tileset.dynamicScreenSpaceError = true }catch(e){}
    // 缓存放大到 1 GB：走回头路、来回切城市时就不用重下
    try{ tileset.cacheBytes = 1024 * 1024 * 1024 }catch(e){}
    scene.primitives.add(tileset);
    $('#mode').textContent = src.mode === 'proxy' ? 'key 在服务端' : 'key 在浏览器 · 配额已封顶';
    $('#mode').style.color = src.mode === 'proxy' ? 'var(--moss)' : 'var(--ink-3)';
  }catch(err){
    await showTileError(src, err);
    return;
  }

  buildPresets();
  bindPanels();
  bindLook();
  bindKeys();
  bindButtons();
  jumpTo(S.lat, S.lon, S.ground);
  scene.preRender.addEventListener(frame);
}

/* 手机上默认把两块面板收起来，别挡着街景 */
function bindPanels(){
  const narrow = window.matchMedia('(max-width: 700px)').matches;
  [['#navPanel','#navToggle'],['#hud','#hudToggle']].forEach(([ps,ts])=>{
    const panel = $(ps), btn = $(ts);
    const set = v => {
      panel.classList.toggle('collapsed', !v);
      btn.setAttribute('aria-expanded', String(v));
    };
    btn.addEventListener('click', ()=> set(panel.classList.contains('collapsed')));
    set(!narrow);
  });
}

function buildPresets(){
  const sel = $('#preset');
  PRESETS.forEach((p,i)=>{
    const o = document.createElement('option');
    o.value = String(i); o.textContent = p.n; sel.appendChild(o);
  });
}

function jumpTo(lat, lon, groundGuess, name){
  S.place = name || null;
  S.lat = lat; S.lon = lon;
  S.ground = groundGuess != null ? groundGuess : S.ground;
  S.groundKnown = false; S.session = 0;
  descend();                       // 先停在高处，等粗瓦片铺开，再落下来
  sampleGround(true);
}

/* 从高空落到街面：粗瓦片几块就能铺满视野，先看到轮廓，
   下降过程里细节一层层补上 —— 等待时间变成了降落过程本身。 */
function descend(){
  S.alt = 260; S.pitchOff = -34;
  if (tileset) tileset.maximumScreenSpaceError = 32;   // 下降途中放粗，换速度
  glide = {
    t0: performance.now(), dur: 2400, kind: 'descend',
    fromLat: S.lat, fromLon: S.lon, fromG: null,   // 高度让 sampleGround 说了算
    toLat: S.lat, toLon: S.lon, toG: null,
    fromAlt: 260, toAlt: 0, fromPitch: -34, toPitch: 0
  };
}

/* 把相机贴到瓦片表面：采样它脚下的高度 */
async function sampleGround(force){
  if (!scene.sampleHeightSupported) return;
  const now = performance.now();
  if (!force && now - lastSample < 400) return;
  lastSample = now;
  const carto = Cesium.Cartographic.fromDegrees(S.lon, S.lat);
  try{
    const out = await scene.sampleHeightMostDetailed([carto]);
    const h = out && out[0] && out[0].height;
    if (typeof h === 'number' && isFinite(h)){
      // 换了城市（落差很大）就直接对齐；走路中的小起伏才平滑跟随
      S.ground = (!S.groundKnown || Math.abs(h - S.ground) > 25)
        ? h
        : S.ground + (h - S.ground) * 0.35;
      S.groundKnown = true;
    }
  }catch(e){}
}

/* ---------- 地名搜索 ----------
   用 OpenStreetMap 的 Nominatim：免费、不需要 key、不动 Google 的配额。
   它是志愿者在维护的服务，所以只在你按回车/点按钮时查一次，
   并且两次之间至少隔 1.2 秒 —— 别把人家刷爆了。                      */
let lastQuery = 0;

async function searchPlace(q){
  const box = $('#results');
  const wait = 1200 - (Date.now() - lastQuery);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastQuery = Date.now();
  box.hidden = false;
  box.innerHTML = '<li><span class="searching" style="display:block;padding:8px 10px">找着呢…</span></li>';
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6' +
    '&accept-language=' + encodeURIComponent(navigator.language || 'zh') +
    '&q=' + encodeURIComponent(q);
  let list = [];
  try{
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (r.ok) list = await r.json();
  }catch(e){}
  if (!list.length){
    box.innerHTML = '<li><span class="searching" style="display:block;padding:8px 10px">' +
      '没找到。换个说法，或者直接粘坐标（38.7075,-9.1364）</span></li>';
    return;
  }
  box.innerHTML = '';
  list.forEach(item => {
    const parts = (item.display_name || '').split(',');
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = item.name || parts[0] || '(无名)';
    const ad = document.createElement('span'); ad.className = 'ad';
    ad.textContent = parts.slice(1).join(',').trim() || (item.type || '');
    btn.append(nm, ad);
    btn.onclick = ()=>{
      box.hidden = true; $('#coords').value = '';
      jumpTo(parseFloat(item.lat), parseFloat(item.lon), null, item.name || parts[0]);
    };
    li.appendChild(btn); box.appendChild(li);
  });
}

/* ---------- 点地面走过去（像 Street View，但不限于拍摄点） ---------- */
let glide = null;

function clickMove(e){
  if (glide) return;
  const rect = scene.canvas.getBoundingClientRect();
  const pos = new Cesium.Cartesian2(e.clientX - rect.left, e.clientY - rect.top);
  let cart = null;
  try{
    if (scene.pickPositionSupported) cart = scene.pickPosition(pos);
    if (!cart && camera.pickEllipsoid) cart = camera.pickEllipsoid(pos, Cesium.Ellipsoid.WGS84);
  }catch(err){}
  if (!cart) return;                                   // 点到天上了
  const c = Cesium.Cartographic.fromCartesian(cart);
  if (!c) return;
  const lat = Cesium.Math.toDegrees(c.latitude), lon = Cesium.Math.toDegrees(c.longitude);
  const d = distBetween(S.lat, S.lon, lat, lon);
  if (d < 0.5 || d > 4000) return;                     // 太近没意义，太远多半是误触
  ripple(e.clientX, e.clientY);
  glide = {
    fromAlt: null,
    t0: performance.now(), dur: Math.min(900, 280 + d * 8),
    fromLat: S.lat, fromLon: S.lon, fromG: S.ground,
    toLat: lat, toLon: lon, toG: isFinite(c.height) ? c.height : S.ground
  };
  toast('移动 ' + Math.round(d) + ' m');
}

function ripple(x, y){
  const el = document.createElement('i');
  el.className = 'ripple'; el.style.left = x + 'px'; el.style.top = y + 'px';
  document.body.appendChild(el);
  setTimeout(()=> el.remove(), 600);
}
let toastEl = null, toastT = null;
function toast(text){
  if (!toastEl){ toastEl = document.createElement('div'); toastEl.className = 'toast'; }
  toastEl.textContent = text;
  document.body.appendChild(toastEl);
  clearTimeout(toastT);
  toastT = setTimeout(()=> toastEl.remove(), 1700);
}

const keys = Object.create(null);
function bindKeys(){
  addEventListener('keydown', e=>{
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'r'){ S.pitch = 0; MOTION.calibrate() }
  });
  addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
}

function bindLook(){
  const cv = scene.canvas;
  let drag = false, px = 0, py = 0, ox = 0, oy = 0, t0 = 0, moved = false;
  cv.addEventListener('pointerdown', e=>{
    drag = true; px = ox = e.clientX; py = oy = e.clientY;
    t0 = performance.now(); moved = false;
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e=>{
    if (!drag) return;
    if (Math.abs(e.clientX - ox) > 6 || Math.abs(e.clientY - oy) > 6) moved = true;
    const dx = e.clientX - px, dy = e.clientY - py;
    if (MOTION.steering) MOTION.head0 = (MOTION.head0 || 0) - dx * 0.22;
    else S.heading += dx * 0.22;
    if (MOTION.on && MOTION.beta0 != null) MOTION.beta0 += dy * 0.2;
    else S.pitch = clamp(S.pitch - dy * 0.2, -85, 85);
    px = e.clientX; py = e.clientY;
  });
  const up = e=>{
    if (drag && !moved && performance.now() - t0 < 600 && e && e.clientX != null) clickMove(e);
    drag = false;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', ()=> drag = false);
  cv.addEventListener('wheel', e=>{
    e.preventDefault();
    const f = camera.frustum;
    if (f.fov != null) f.fov = clamp(f.fov + Math.sign(e.deltaY) * 0.06, 0.5, 1.6);
  }, {passive:false});
}

function bindButtons(){
  $('#goPreset').onclick = ()=>{
    const p = PRESETS[+$('#preset').value || 0];
    $('#results').hidden = true;
    jumpTo(p.lat, p.lon, p.h, p.n.split(' · ')[0]);
  };
  $('#goCoords').onclick = ()=>{
    const raw = $('#coords').value.trim();
    if (!raw) return;
    const m = raw.match(/(-?\d+\.\d+)[,\s/@]+(-?\d+\.\d+)/);
    if (m){                                   // 坐标或地图链接
      $('#results').hidden = true; $('#coords').value = '';
      jumpTo(parseFloat(m[1]), parseFloat(m[2]), null, null);
    } else {
      searchPlace(raw);                       // 当成地名
    }
  };
  $('#coords').addEventListener('keydown', e=>{ if (e.key === 'Enter') $('#goCoords').click() });
  $('#motionBtn').onclick = ()=> MOTION.toggle();
  $('#calBtn').onclick = ()=> MOTION.calibrate();
  $('#absBtn').onclick = e=>{
    MOTION.absolute = !MOTION.absolute;
    e.currentTarget.setAttribute('aria-pressed', String(MOTION.absolute));
  };
  $('#sens').oninput = e=> MOTION.thresh = parseFloat(e.target.value);
  if (!MOTION.supported()){ $('#motionBtn').disabled = true; MOTION.say('这台设备没有运动传感器') }
  const wb = $('#walkBtn');
  const dn = e=>{ e.preventDefault(); keys.w = true };
  const up = e=>{ e.preventDefault(); keys.w = false };
  wb.addEventListener('pointerdown', dn);
  ['pointerup','pointercancel','pointerleave'].forEach(t=> wb.addEventListener(t, up));
}

let lastT = performance.now();
function frame(){
  const now = performance.now();
  const dt = Math.min(0.08, (now - lastT) / 1000); lastT = now;

  if (glide){
    const k = Math.min(1, (now - glide.t0) / glide.dur);
    const e = k < 0.5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3) / 2;
    S.lat = glide.fromLat + (glide.toLat - glide.fromLat) * e;
    S.lon = glide.fromLon + (glide.toLon - glide.fromLon) * e;
    if (glide.fromG != null) S.ground = glide.fromG + (glide.toG - glide.fromG) * e;
    if (glide.fromAlt != null){
      S.alt      = glide.fromAlt   + (glide.toAlt   - glide.fromAlt)   * e;
      S.pitchOff = glide.fromPitch + (glide.toPitch - glide.fromPitch) * e;
    }
    if (k >= 1){
      const wasDescent = glide.kind === 'descend';
      glide = null; S.alt = 0; S.pitchOff = 0;
      S.groundKnown = true; sampleGround(true); save();
      if (wasDescent && tileset) tileset.maximumScreenSpaceError = 16;  // 站定了，再要细节
    }
  }
  if (!glide && (keys.w || keys.arrowup)) advance(1.35 * dt);
  if (!glide && (keys.s || keys.arrowdown)) advance(-1.1 * dt);
  if (keys.a || keys.arrowleft) S.heading -= 55 * dt;
  if (keys.d || keys.arrowright) S.heading += 55 * dt;
  S.heading = (S.heading % 360 + 360) % 360;

  if (!glide) sampleGround(false);
  MOTION.tick();

  camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(S.lon, S.lat, S.ground + EYE + S.alt),
    orientation: {
      heading: Cesium.Math.toRadians(S.heading),
      pitch:   Cesium.Math.toRadians(clamp(S.pitch + S.pitchOff, -89, 89)),
      roll: 0
    }
  });

  if (now - (frame._ui || 0) > 180){
    frame._ui = now;
    const d = Math.round(S.session).toLocaleString('en-US');
    $('#dist').textContent = d;
    $('#hudLabel').textContent = d + ' m' + (MOTION.on ? ' · 体感' : '');
    $('#totals').textContent = '今天 ' + Math.round(S.today).toLocaleString('en-US') +
      ' m · 累计 ' + (S.total / 1000).toFixed(1) + ' km';
    const p = PRESETS.find(p => Math.abs(p.lat - S.lat) < 0.02 && Math.abs(p.lon - S.lon) < 0.02);
    if (p && !S.place) S.place = null;
    let clock = '';
    if (p){ try{
      clock = ' · 当地 ' + new Intl.DateTimeFormat('zh-CN',
        {timeZone:p.tz, hour:'2-digit', minute:'2-digit', hour12:false}).format(new Date());
    }catch(e){} }
    let pending = 0;
    try{ pending = tileset.statistics.numberOfPendingRequests | 0 }catch(e){}
    $('#navLabel').textContent = pending > 0
      ? '载入 ' + pending + ' 块…'
      : (S.place || (p ? p.n.split(' · ')[0] : '去哪儿'));
    $('#where').innerHTML = (S.place ? '<b>' + S.place + '</b><br>' : '') +
      '<b>' + S.lat.toFixed(5) + ', ' + S.lon.toFixed(5) + '</b>' +
      ' · 朝向 ' + Math.round(S.heading) + '°' +
      (S.groundKnown ? '' : ' · 正在贴地…') +
      (pending > 0 ? ' · 载入 ' + pending + ' 块' : '') + clock;
  }
}

boot();
