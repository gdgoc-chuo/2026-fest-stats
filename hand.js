// カメラによる手の骨格認識。画面上の手の座標とピンチ状態を app.js へ伝達
// 映像処理はブラウザ内 (MediaPipe Hand Landmarker) で完結し、外部送信や保存は行わない
import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const C = window.CONFIG.hand;
const FEST = window.FEST;
const view = document.querySelector('#handview');
const g = view.getContext('2d');
const W = 320;
const H = 240;
view.width = W;
view.height = H;

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
const clamp01 = (v) => Math.min(1, Math.max(0, v));

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
  g.clearRect(0, 0, W, H);
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
  // 座標は手のひらの中心で算出 (ピンチ時の指先のブレによる隣接選択肢への誤移動を防止)
  const palm = [0, 5, 9, 13, 17].map((i) => lm[i]);
  const cx = palm.reduce((s, p) => s + p.x, 0) / palm.length;
  const cy = palm.reduce((s, p) => s + p.y, 0) / palm.length;
  // カメラ映像を左右反転し、来場者の視点と一致させる
  const x = clamp01((1 - cx - C.xRange[0]) / (C.xRange[1] - C.xRange[0])) * innerWidth;
  const y = clamp01((cy - C.yRange[0]) / (C.yRange[1] - C.yRange[0])) * innerHeight;
  sx = sx === null ? x : sx + (x - sx) * C.smooth;
  sy = sy === null ? y : sy + (y - sy) * C.smooth;

  const ratio = dist(lm[4], lm[8]) / Math.max(1e-6, dist(lm[0], lm[9]));
  if (!pinched && ratio < C.pinchOn) pinched = true;
  else if (pinched && ratio > C.pinchOff) pinched = false;

  FEST.hand({ present: true, x: sx, y: sy, pinch: pinched });
}

function draw(lm) {
  const mode = FEST.settings().preview;
  if (mode === 'none' || view.hidden) return;
  g.clearRect(0, 0, W, H);
  if (mode === 'mirror') {
    g.save();
    g.translate(W, 0);
    g.scale(-1, 1);
    g.drawImage(video, 0, 0, W, H);
    g.restore();
  } else {
    g.fillStyle = '#f1f3f4';
    g.fillRect(0, 0, W, H);
  }
  if (!lm) return;
  const P = (p) => [(1 - p.x) * W, p.y * H];
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.strokeStyle = mode === 'mirror' ? '#fff' : '#202124';
  g.beginPath();
  for (const { start: a, end: b } of HandLandmarker.HAND_CONNECTIONS) {
    const [ax, ay] = P(lm[a]);
    const [bx, by] = P(lm[b]);
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
  }
  g.stroke();
  // 指先マーカー描画: 親指は青、人差し指は赤
  for (const [i, color] of [[4, '#4285f4'], [8, '#ea4335']]) {
    g.fillStyle = color;
    const [x, y] = P(lm[i]);
    g.beginPath();
    g.arc(x, y, pinched ? 10 : 6, 0, Math.PI * 2);
    g.fill();
  }
}

window.HAND = { start, stop };
if (FEST.settings().enabled) start();
