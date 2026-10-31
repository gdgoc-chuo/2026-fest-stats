// 当日はこのファイルの設定値を調整するだけで運用できるようにする
// 属性コードの値は gas/Code.gs の ATTRS 定義と一致させること

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${inner}</svg>`;

const PERSON =
  '<circle cx="12" cy="7" r="3.5"/><path d="M5 21c0-4.5 3-7.5 7-7.5s7 3 7 7.5"/>';

// 中央大学ブランドマークの「C」部分 (公式サイトのヘッダーロゴから文字を除いて抽出)。縦横比は変えない
const CHUO_C =
  '<svg viewBox="0 20.3 46.8 36" fill="currentColor" aria-hidden="true"><path d="M38.2,39.3c-1.9,1.9-4.2,3.4-6.7,4.3c-2.5,1-5.2,1.5-7.8,1.4c-5.1,0.1-10.1-1.8-13.9-5.2c-0.4-0.3-0.7-0.7-1-1l-0.5-0.5l0.5-0.5c0.3-0.4,0.6-0.7,1-1.1c3.8-3.4,8.8-5.3,13.9-5.2c2.7-0.1,5.3,0.4,7.8,1.4c2.5,1,4.8,2.5,6.7,4.3h8.5c-4.2-7.4-13-12.5-23.1-12.5C13.2,24.8,4,30.4,0,38.3c4,7.9,13.2,13.5,23.7,13.5c10.1,0,18.8-5.1,23.1-12.5H38.2z"/></svg>';

// 人数アイコン生成: 人型ピクトグラムを n 個配置 (plus=true の場合は末尾に「+」を付加)
// 4個以上は横に長くなりすぎるため2段に分けて並べる
const persons = (n, plus) => {
  const rows = n >= 4 ? 2 : 1;
  const cols = Math.ceil((n + (plus ? 1 : 0)) / rows);
  const at = (k) => `translate(${(k % cols) * 14} ${Math.floor(k / cols) * 15})`;
  let s = "";
  for (let i = 0; i < n; i++)
    s += `<g transform="${at(i)} translate(-1 0) scale(.62)">${PERSON}</g>`;
  if (plus)
    s += `<path transform="${at(n)} translate(-2 0)" d="M4 8h7M7.5 4.5v7" stroke-width="1.6"/>`;
  return `<svg class="rows${rows}" viewBox="0 0 ${14 * cols} ${15 * rows - 1}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${s}</svg>`;
};

window.CONFIG = {
  // GAS ウェブアプリの URL (デプロイ後に設定)
  GAS_URL:
    "https://script.google.com/macros/s/AKfycbxL4fiT5wXCz-fned7VieQJmHHGWwqG6sP9zwKkEuSdidbeFPpKd-CPdfh4DWsWqXQ/exec",

  appVersion: "2026-fest-1",

  // キー割り当て (KeyboardEvent.code)。使用するカスタムキーボードに合わせて変更
  keys: {
    left: "ArrowLeft",
    right: "ArrowRight",
    ok: "Enter",
    back: "Backspace",
  },

  idleWarnSec: 20, // 回答途中で無操作状態がこの秒数続いた場合に警告を表示
  idleCountdownSec: 10, // 警告表示から初期画面へリセットされるまでの秒数
  resultSec: 8, // 結果画面を表示する秒数

  // カメラ (手の骨格認識) 操作の設定。映像処理はブラウザ内で完結し、外部送信や保存は行わない
  // 管理パネルからも動的に変更可能 (ブラウザ再起動時は本ファイルの設定値に戻る)
  hand: {
    enabled: true, // 起動時にカメラ操作を有効化するか
    select: "pinch", // 決定方式: "pinch" (指をつまむ) | "dwell" (手を止める)
    preview: "skeleton", // 画面表示: "skeleton" (骨格のみ) | "mirror" (鏡像プレビュー) | "none" (非表示)
    dwellMs: 1500, // dwell: 決定に必要な滞留時間 (ミリ秒)
    cooldownMs: 800, // dwell: 決定後の次回判定開始までの待機時間 (ミリ秒)
    pinchOn: 0.35, // pinch: 親指と人差し指の距離比率がこの値を下回るとピンチ開始と判定
    pinchOff: 0.5, // pinch: この値を超えるとピンチ解除と判定 (チャタリング防止用のヒステリシス)
    xRange: [0.2, 0.8], // カメラ映像の横方向有効範囲 (画面の左端〜右端に対応)。縦の範囲は、横と同じ縮尺になるよう自動で決まる
    yCenter: 0.5, // 画面の縦中央に対応させるカメラ映像の縦位置 (0: 上端 〜 1: 下端)
    smooth: 0.35, // 手の位置のスムージング係数 (値が小さいほど滑らかだが追従遅延が増加)
    mirrorOpacity: 0.25, // mirror: 画面全体に重ねる映像の不透明度 (値が小さいほど薄く、下の画面が見えやすい)
    hint: {
      pinch: "手を左右にかざして選択し、親指と人差し指をつまんで決定",
      dwell: "手を左右にかざして選択し、項目の上で手を止めると決定",
    },
  },

  questions: [
    {
      id: "party_size",
      prompt: "何名様でお越しですか？",
      options: [
        { value: 1, label: "1人", icon: persons(1) },
        { value: 2, label: "2人", icon: persons(2) },
        { value: 3, label: "3人", icon: persons(3) },
        { value: 4, label: "4人", icon: persons(4) },
        { value: 5, label: "5人以上", icon: persons(5, true) },
      ],
    },
    {
      id: "attribute",
      prompt: "当てはまる区分をお選びください",
      options: [
        {
          value: "student",
          label: "在学生",
          short: "在学生",
          icon: CHUO_C,
        },
        {
          value: "applicant",
          label: "受験生・<wbr>高校生以下",
          short: "受験生・高校生以下",
          icon: svg('<path d="M4 20l1-4L16 5l3 3L8 19z M14 7l3 3"/>'),
        },
        {
          value: "alumni",
          label: "卒業生",
          short: "卒業生",
          icon: svg(
            '<path d="M2 9l10-5 10 5-10 5z M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/>',
          ),
        },
        {
          value: "other_univ",
          label: "他大生",
          short: "他大生",
          icon: svg(
            '<rect x="3" y="3" width="12" height="12"/><rect x="9" y="9" width="12" height="12"/>',
          ),
        },
        {
          value: "family_friend",
          label: "在学生の<wbr>家族・友人",
          short: "在学生の家族・友人",
          icon: svg(
            '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c0-3.5 2.7-6 6-6s6 2.5 6 6 M10 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/>',
          ),
        },
        {
          value: "general",
          label: "その他<wbr>一般",
          short: "その他一般",
          icon: svg(
            '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
          ),
        },
      ],
    },
    {
      id: "with_kids",
      prompt: "小学生以下の<wbr>お子さまと<wbr>ご一緒ですか？",
      skipIf: (a) => a.party_size === 1,
      options: [
        {
          value: "yes",
          label: "はい",
          icon: svg(
            '<circle cx="9" cy="7" r="3.5"/><path d="M2 21c0-4.5 3-7.5 7-7.5s7 3 7 7.5"/><circle cx="19" cy="13" r="2"/><path d="M16 21c0-2.4 1.3-4 3-4s3 1.6 3 4"/>',
          ),
        },
        { value: "no", label: "いいえ", icon: svg(PERSON) },
      ],
    },
  ],
};
