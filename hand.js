// カメラによる手の骨格認識。画面上の手の座標とピンチ状態を app.js へ伝達
// 映像処理はブラウザ内 (MediaPipe Hand Landmarker) で完結し、外部送信や保存は行わない
import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const C = window.CONFIG.hand;
const FEST = window.FEST;
const layer = document.querySelector('#handlayer');
const armcover = document.querySelector('#armcover');
const g = layer.getContext('2d');
function fitLayer() {
  layer.width = innerWidth * devicePixelRatio;
  layer.height = innerHeight * devicePixelRatio;
}
fitLayer();
addEventListener('resize', fitLayer);

let landmarker = null;
let video = null;
let stream = null;
let running = false;
let lastFrame = -1;
let lastProgress = 0;
let retryTimer = null;
let pinched = false;
let sx = null;
let sy = null;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, max) => Math.min(max, Math.max(0, v));

// カメラ座標 (0〜1) から画面座標へ。映像は左右反転して来場者の視点と一致させる
// リング・骨格・映像のすべてをこの対応で描き、指先とリングの位置をそろえる
// 縦も横と同じ縮尺にして、映像や手の形が横に引き伸ばされないようにする (縦の範囲は xRange と画面・映像の縦横比から決まる)
const pxPerX = () => innerWidth / (C.xRange[1] - C.xRange[0]);
const camAspect = () => (video && video.videoWidth ? video.videoWidth / video.videoHeight : 4 / 3);
const toScreenX = (x) => (1 - x - C.xRange[0]) * pxPerX();
const toScreenY = (y) => ((y - C.yCenter) * pxPerX()) / camAspect() + innerHeight / 2;

async function createLandmarker() {
  const files = await FilesetResolver.forVisionTasks(WASM);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });
  try {
    return await HandLandmarker.createFromOptions(files, opts('GPU'));
  } catch {
    return await HandLandmarker.createFromOptions(files, opts('CPU'));
  }
}

async function start() {
  if (running) return;
  running = true;
  clearTimeout(retryTimer);
  FEST.handState('loading');
  try {
    if (!landmarker) landmarker = await createLandmarker();
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    video = video || Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    video.srcObject = stream;
    await video.play();
    if (!running) return;
    lastProgress = performance.now();
    FEST.handState('ok');
    requestAnimationFrame(loop);
  } catch (e) {
    stop();
    FEST.handState('error', e);
    retryLater();
  }
}

// カメラ接続不可時は、有効設定である限り5秒間隔で再接続を試行
function retryLater() {
  if (FEST.settings().enabled) retryTimer = setTimeout(start, 5000);
}

// 映像フレームが3秒以上更新されない場合 (カメラ切断等) は再接続を実行
// track の ended イベントは環境によって映像受信中にも誤発火するため使用しない
setInterval(() => {
  if (running && lastProgress && performance.now() - lastProgress > 3000) {
    stop();
    FEST.handState('error', 'カメラ映像が停止');
    retryLater();
  }
}, 1000);

function stop() {
  clearTimeout(retryTimer);
  running = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) video.srcObject = null;
  pinched = false;
  sx = sy = null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, layer.width, layer.height);
  FEST.hand({ present: false });
}

function loop() {
  if (!running) return;
  if (video.readyState >= 2 && video.currentTime !== lastFrame) {
    lastFrame = video.currentTime;
    lastProgress = performance.now();
    const lm = landmarker.detectForVideo(video, performance.now()).landmarks?.[0];
    track(lm);
    draw(lm);
  }
  requestAnimationFrame(loop);
}

function track(lm) {
  if (!lm) {
    pinched = false;
    sx = sy = null;
    FEST.hand({ present: false });
    return;
  }
  // つまむ操作では、つまむ点 (親指と人差し指の先の中間) を座標にし、つまんだ場所がそのまま選ばれるようにする
  // 手を止める操作では、指先より揺れにくい手のひらの中心を座標にする
  const pts = FEST.settings().select === 'pinch' ? [4, 8].map((i) => lm[i]) : [0, 5, 9, 13, 17].map((i) => lm[i]);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const x = clamp(toScreenX(cx), innerWidth);
  const y = clamp(toScreenY(cy), innerHeight);
  sx = sx === null ? x : sx + (x - sx) * C.smooth;
  sy = sy === null ? y : sy + (y - sy) * C.smooth;

  const ratio = dist(lm[4], lm[8]) / Math.max(1e-6, dist(lm[0], lm[9]));
  if (!pinched && ratio < C.pinchOn) pinched = true;
  else if (pinched && ratio > C.pinchOff) pinched = false;

  FEST.hand({ present: true, x: sx, y: sy, pinch: pinched });
}

function draw(lm) {
  g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  g.clearRect(0, 0, innerWidth, innerHeight);
  const mode = FEST.settings().preview;
  if (mode === 'none' || layer.hidden || !FEST.active()) return;

  if (mode === 'mirror') {
    // 映像もリングと同じ対応で画面全体に引き伸ばし、画面が見えるよう薄く重ねる
    // 合図待ちの間は、白い覆いのすぐ下に映像をそのままの濃さで置き、覆い越しに自分の姿が見えるようにする
    const waiting = !armcover.hidden;
    const left = toScreenX(1);
    const top = toScreenY(0);
    const w = toScreenX(0) - left;
    const h = toScreenY(1) - top;
    g.save();
    g.globalAlpha = waiting ? 1 : C.mirrorOpacity;
    g.translate(left + w, top);
    g.scale(-1, 1);
    g.drawImage(video, 0, 0, w, h);
    g.restore();
    // 映像の上に選択肢の輪郭を描き、映像越しでも選択肢の位置が分かるようにする
    if (!waiting) for (const el of document.querySelectorAll('#options .opt, #backbtn:not(.off), #res-back')) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const cur = el.classList.contains('cur');
      g.lineWidth = cur ? 8 : 4;
      g.strokeStyle = cur ? '#1a73e8' : '#202124';
      g.strokeRect(r.left + g.lineWidth / 2, r.top + g.lineWidth / 2, r.width - g.lineWidth, r.height - g.lineWidth);
    }
  }

  if (!lm) return;
  const P = (p) => [toScreenX(p.x), toScreenY(p.y)];
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(32, 33, 36, .55)';
  g.beginPath();
  for (const { start: a, end: b } of HandLandmarker.HAND_CONNECTIONS) {
    const [ax, ay] = P(lm[a]);
    const [bx, by] = P(lm[b]);
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
  }
  g.stroke();
  // 指先マーカー描画: 親指は黄、人差し指は赤
  for (const [i, color] of [[4, '#fbbc04'], [8, '#ea4335']]) {
    g.fillStyle = color;
    const [x, y] = P(lm[i]);
    g.beginPath();
    g.arc(x, y, pinched ? 18 : 12, 0, Math.PI * 2);
    g.fill();
  }
}

window.HAND = { start, stop };
if (FEST.settings().enabled) start();
