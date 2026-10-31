// 当日はこのファイルの設定値を調整するだけで運用できるようにする
// 属性コードの値は gas/Code.gs の ATTRS 定義と一致させること

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${inner}</svg>`;

const PERSON =
  '<circle cx="12" cy="7" r="3.5"/><path d="M5 21c0-4.5 3-7.5 7-7.5s7 3 7 7.5"/>';

// 人数アイコン生成: 人型ピクトグラムを n 個配置 (plus=true の場合は末尾に「+」を付加)
const persons = (n, plus) => {
  const w = 14 * n + (plus ? 14 : 0);
  let s = "";
  for (let i = 0; i < n; i++)
    s += `<g transform="translate(${i * 14 - 1} 0) scale(.62)">${PERSON}</g>`;
  if (plus)
    s += `<path transform="translate(${n * 14 - 2} 0)" d="M4 8h7M7.5 4.5v7" stroke-width="1.6"/>`;
  return `<svg viewBox="0 0 ${w} 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${s}</svg>`;
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
  milestoneEvery: 50, // 指定した組数ごとにキリ番 (記念) 演出を表示
  milestoneText: "受付でお菓子をお受け取りください！",

  // カメラ (手の骨格認識) での操作。映像はブラウザ内で処理し、送信も保存もしない
  // 管理パネルからも切り替えられる (Edge を閉じるとここの値に戻る)
  hand: {
    enabled: true, // 起動時にカメラ操作を使うか
    select: "pinch", // 決定の操作: "pinch" (つまむ) | "dwell" (手を止める)
    preview: "skeleton", // 画面の表示: "skeleton" (骨格だけ) | "mirror" (鏡のような映像) | "none" (表示なし)
    dwellMs: 1500, // dwell: この時間同じ選択肢で止めると決定
    cooldownMs: 800, // dwell: 決定後、次の判定を始めるまでの時間
    pinchOn: 0.35, // pinch: 親指と人差し指の距離 / 手の大きさ がこれ未満でつまんだと判定
    pinchOff: 0.5, // pinch: これを超えたら離したと判定 (ぶれで連続判定しないよう差をつける)
    xRange: [0.2, 0.8], // カメラ映像の横方向のこの範囲を画面の左端〜右端に対応させる
    yRange: [0.2, 0.8],
    smooth: 0.35, // 手の位置のなめらかさ (小さいほどなめらかだが遅れる)
    hint: {
      pinch: "手をかざして左右に動かし、親指と人差し指でつまむと決定",
      dwell: "手をかざして左右に動かし、選びたいところで止めると決定",
    },
  },

  questions: [
    {
      id: "party_size",
      prompt: "何名様でお越しですか？",
      hint: "1グループにつき1回、代表者の方がご回答ください",
      options: [
        { value: 1, label: "1人", icon: persons(1) },
        { value: 2, label: "2人", icon: persons(2) },
        { value: 3, label: "3人", icon: persons(3) },
        { value: 4, label: "4人", icon: persons(4) },
        { value: 5, label: "5人以上", icon: persons(4, true) },
      ],
    },
    {
      id: "attribute",
      prompt: "当てはまる区分をお選びください",
      hint: "複数当てはまる場合は、より左側の項目をお選びください",
      options: [
        {
          value: "student",
          label: "在学生",
          short: "在学生",
          icon: svg(
            '<path d="M4 5h7a1 1 0 0 1 1 1v13a2 2 0 0 0-2-2H4z M20 5h-7a1 1 0 0 0-1 1v13a2 2 0 0 1 2-2h6z"/>',
          ),
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
          label: "他大学生",
          short: "他大学生",
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
      hint: "",
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
