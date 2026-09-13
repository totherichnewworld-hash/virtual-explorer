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
  {n:'里斯本 · 商业广场',      lat:38.70754, lon:-9.13647, h:340, tz:'Europe/Lisbon'},
  {n:'京都 · 祇园四条',        lat:35.00370, lon:135.77200, h:20,  tz:'Asia/Tokyo'},
  {n:'伊斯坦布尔 · 加拉塔塔',  lat:41.02560, lon:28.97410, h:200, tz:'Europe/Istanbul'},
  {n:'纽约 · 华盛顿广场',      lat:40.73080, lon:-73.99730, h:0,   tz:'America/New_York'},
  {n:'雷克雅未克 · 大教堂',    lat:64.14170, lon:-21.92660, h:180, tz:'Atlantic/Reykjavik'},
  {n:'布宜诺斯艾利斯 · 多雷戈',lat:-34.62050,lon:-58.37170, h:40,  tz:'America/Argentina/Buenos_Aires'},
  {n:'巴黎 · 蓬皮杜',          lat:48.86070, lon:2.35220,  h:250, tz:'Europe/Paris'},
  {n:'香港 · 中环',            lat:22.28190, lon:114.15830, h:80,  tz:'Asia/Hong_Kong'}
];

/* ---------- 取 key：本地 config.js 优先，线上走 /api/key ---------- */
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

/* ---------- 大地测量：沿方位角前进 ---------- */
function moveLatLon(lat, lon, bearingDeg, meters){
  const d = meters / R_EARTH, b = bearingDeg * Math.PI/180;
  const p1 = lat*Math.PI/180, l1 = lon*Math.PI/180;
  const p2 = Math.asin(Math.sin(p1)*Math.cos(d) + Math.cos(p1)*Math.sin(d)*Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(p1),
                             Math.cos(d) - Math.sin(p1)*Math.sin(p2));
  return [p2*180/Math.PI, ((l2*180/Math.PI + 540) % 360) - 180];
}

/* ============================================================
   状态
   ============================================================ */
const S = {
  lat:PRESETS[0].lat, lon:PRESETS[0].lon, heading:0, pitch:0,
  ground:PRESETS[0].h, groundKnown:false, session:0, today:0, total:0, day:''
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
      const w = $('#barWrap'); w.classList.add('hit'); setTimeout(()=>w.classList.remove('hit'), 110);
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
  const key = await getKey();
  if (!key) return;                       // 停在配置说明页
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
    tileset = await Cesium.Cesium3DTileset.fromUrl(
      'https://tile.googleapis.com/v1/3dtiles/root.json?key=' + encodeURIComponent(key),
      { showCreditsOnScreen:true, maximumScreenSpaceError:16 });
    scene.primitives.add(tileset);
  }catch(err){
    $('#setup').hidden = false;
    $('#setup .card').insertAdjacentHTML('beforeend',
      '<p class="warn">瓦片加载失败：' + (err && err.message ? err.message : err) +
      '<br>多半是 key 没启用 Map Tiles API，或 referrer 限制没放行这个域名。</p>');
    return;
  }

  buildPresets();
  bindLook();
  bindKeys();
  bindButtons();
  jumpTo(S.lat, S.lon, S.ground);
  scene.preRender.addEventListener(frame);
}

function buildPresets(){
  const sel = $('#preset');
  PRESETS.forEach((p,i)=>{
    const o = document.createElement('option');
    o.value = String(i); o.textContent = p.n; sel.appendChild(o);
  });
}

function jumpTo(lat, lon, groundGuess){
  S.lat = lat; S.lon = lon;
  S.ground = groundGuess != null ? groundGuess : S.ground;
  S.groundKnown = false; S.session = 0;
  sampleGround(true);
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
      S.ground = S.groundKnown ? S.ground + (h - S.ground) * 0.35 : h;
      S.groundKnown = true;
    }
  }catch(e){}
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
  let drag = false, px = 0, py = 0;
  cv.addEventListener('pointerdown', e=>{ drag = true; px = e.clientX; py = e.clientY;
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId) });
  cv.addEventListener('pointermove', e=>{
    if (!drag) return;
    const dx = e.clientX - px, dy = e.clientY - py;
    if (MOTION.steering) MOTION.head0 = (MOTION.head0 || 0) - dx * 0.22;
    else S.heading += dx * 0.22;
    if (MOTION.on && MOTION.beta0 != null) MOTION.beta0 += dy * 0.2;
    else S.pitch = clamp(S.pitch - dy * 0.2, -85, 85);
    px = e.clientX; py = e.clientY;
  });
  const up = ()=> drag = false;
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e=>{
    e.preventDefault();
    const f = camera.frustum;
    if (f.fov != null) f.fov = clamp(f.fov + Math.sign(e.deltaY) * 0.06, 0.5, 1.6);
  }, {passive:false});
}

function bindButtons(){
  $('#goPreset').onclick = ()=>{
    const p = PRESETS[+$('#preset').value || 0];
    jumpTo(p.lat, p.lon, p.h);
  };
  $('#goCoords').onclick = ()=>{
    const raw = $('#coords').value.trim();
    const m = raw.match(/(-?\d+\.\d+)[,\s/@]+(-?\d+\.\d+)/);
    if (!m){ $('#where').textContent = '没认出坐标。试试 38.7075,-9.1364'; return }
    jumpTo(parseFloat(m[1]), parseFloat(m[2]), null);
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

  if (keys.w || keys.arrowup) advance(1.35 * dt);
  if (keys.s || keys.arrowdown) advance(-1.1 * dt);
  if (keys.a || keys.arrowleft) S.heading -= 55 * dt;
  if (keys.d || keys.arrowright) S.heading += 55 * dt;
  S.heading = (S.heading % 360 + 360) % 360;

  sampleGround(false);
  MOTION.tick();

  camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(S.lon, S.lat, S.ground + EYE),
    orientation: {
      heading: Cesium.Math.toRadians(S.heading),
      pitch:   Cesium.Math.toRadians(S.pitch),
      roll: 0
    }
  });

  if (now - (frame._ui || 0) > 180){
    frame._ui = now;
    $('#dist').textContent = Math.round(S.session).toLocaleString('en-US');
    $('#totals').textContent = '今天 ' + Math.round(S.today).toLocaleString('en-US') +
      ' m · 累计 ' + (S.total / 1000).toFixed(1) + ' km';
    const p = PRESETS.find(p => Math.abs(p.lat - S.lat) < 0.02 && Math.abs(p.lon - S.lon) < 0.02);
    let clock = '';
    if (p){ try{
      clock = ' · 当地 ' + new Intl.DateTimeFormat('zh-CN',
        {timeZone:p.tz, hour:'2-digit', minute:'2-digit', hour12:false}).format(new Date());
    }catch(e){} }
    $('#where').innerHTML = '<b>' + S.lat.toFixed(5) + ', ' + S.lon.toFixed(5) + '</b>' +
      ' · 朝向 ' + Math.round(S.heading) + '°' +
      (S.groundKnown ? '' : ' · 正在贴地…') + clock;
  }
}

boot();
