// スプレッドシートに紐づいた Apps Script (拡張機能 → Apps Script) に貼る。
// 初回は setup() を実行してシート作成とトークン発行を行う。

const SHEET = 'responses';
const SUMMARY = '集計';
const TZ = 'Asia/Tokyo';
const COLS = ['received_at', 'id', 'seq', 'status', 'is_test', 'party_size', 'attribute', 'with_kids',
  'started_at', 'answered_at', 'duration_ms', 'q_ms', 'input', 'device', 'app_version'];
// 自動で日付に変換されると ms が落ちるので文字列で持つ列
const TEXT_COLS = ['received_at', 'id', 'started_at', 'answered_at', 'q_ms', 'device', 'app_version', 'attribute', 'status'];
// config.js の attribute の選択肢と揃える
const ATTRS = [
  ['student', '在学生'],
  ['applicant', '受験生・高校生以下'],
  ['alumni', '卒業生'],
  ['other_univ', '他大学生'],
  ['family_friend', '在学生の家族・友人'],
  ['general', 'その他一般'],
];

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (_) {
    return json_({ ok: false, error: 'bad_request' });
  }
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || typeof body.token !== 'string' || body.token !== token) {
    return json_({ ok: false, error: 'unauthorized' });
  }

  const sh = sheet_();
  if (body.action === 'submit') {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    let accepted;
    try {
      accepted = append_(sh, Array.isArray(body.rows) ? body.rows.slice(0, 200) : []);
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true, accepted, stats: stats_(sh) });
  }
  if (body.action === 'stats') return json_({ ok: true, stats: stats_(sh) });
  return json_({ ok: false, error: 'bad_action' });
}

// 既にある id は追記せず、受理済みとして返す (端末側はそれを見て outbox から消す)
function append_(sh, rows) {
  const last = sh.getLastRow();
  const idCol = COLS.indexOf('id') + 1;
  const known = new Set(last > 1 ? sh.getRange(2, idCol, last - 1, 1).getValues().map((r) => String(r[0])) : []);
  const now = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
  const accepted = [];
  const values = [];
  for (const r of rows) {
    if (!r || typeof r.id !== 'string' || !r.id) continue;
    accepted.push(r.id);
    if (known.has(r.id)) continue;
    known.add(r.id);
    values.push(COLS.map((c) => (c === 'received_at' ? now : clean_(r[c]))));
  }
  if (!values.length) return accepted;
  // 行が足りなければ足す (書式は直前の行から引き継がれる)
  if (last + values.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), values.length + 500);
  sh.getRange(last + 1, 1, values.length, COLS.length).setValues(values);
  return accepted;
}

function clean_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v).slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function stats_(sh) {
  const st = { groups: 0, people: 0, attr: {}, kids: 0 };
  const last = sh.getLastRow();
  if (last < 2) return st;
  const ix = (c) => COLS.indexOf(c);
  const data = sh.getRange(2, 1, last - 1, COLS.length).getValues();
  for (const r of data) {
    if (r[ix('status')] !== 'complete' || Number(r[ix('is_test')]) === 1) continue;
    st.groups++;
    st.people += Number(r[ix('party_size')]) || 0;
    const a = String(r[ix('attribute')]);
    if (a) st.attr[a] = (st.attr[a] || 0) + 1;
    if (Number(r[ix('with_kids')]) === 1 && r[ix('with_kids')] !== '') st.kids++;
  }
  return st;
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    for (const c of TEXT_COLS) sh.getRange(1, COLS.indexOf(c) + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  }
  return sh;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- 初回だけ手動で実行 ----------

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  sheet_();
  setupSummary_();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) {
    props.setProperty('TOKEN', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  }
  Logger.log('TOKEN: ' + props.getProperty('TOKEN'));
}

// トークンを作り直す (漏れたとき用)。端末側も再登録が必要
function rotateToken() {
  PropertiesService.getScriptProperties().deleteProperty('TOKEN');
  setup();
}

function setupSummary_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SUMMARY) || ss.insertSheet(SUMMARY);
  sh.clear();
  const L = (c) => `${SHEET}!${String.fromCharCode(65 + COLS.indexOf(c))}:${String.fromCharCode(65 + COLS.indexOf(c))}`;
  const base = `${L('status')},"complete",${L('is_test')},0`;
  const rows = [];
  const push = (...r) => rows.push(r.concat(['', '', '', '']).slice(0, 4));

  push('テストを除く完了回答', '', '', '');
  push('組数', `=COUNTIFS(${base})`);
  push('人数 (5人以上は5で計上)', `=SUMIFS(${L('party_size')},${base})`);
  push('途中離脱 (partial)', `=COUNTIFS(${L('status')},"partial",${L('is_test')},0)`);
  push('');
  push('属性', '組数', '人数', '組の割合');
  const attrStart = rows.length + 1;
  for (const [code, label] of ATTRS) {
    const r = rows.length + 1;
    push(label, `=COUNTIFS(${base},${L('attribute')},"${code}")`,
      `=SUMIFS(${L('party_size')},${base},${L('attribute')},"${code}")`, `=IFERROR(B${r}/$B$2,0)`);
  }
  push('');
  push('人数', '組数', '', '組の割合');
  for (let n = 1; n <= 5; n++) {
    const r = rows.length + 1;
    push(n === 5 ? '5人以上' : `${n}人`, `=COUNTIFS(${base},${L('party_size')},${n})`, '', `=IFERROR(B${r}/$B$2,0)`);
  }
  push('');
  push('子どもづれ (2人以上の組)', '組数', '', '割合');
  const kr = rows.length + 1;
  push('はい', `=COUNTIFS(${base},${L('with_kids')},1)`, '', `=IFERROR(B${kr}/(B${kr}+B${kr + 1}),0)`);
  push('いいえ', `=COUNTIFS(${base},${L('with_kids')},0)`, '', `=IFERROR(B${kr + 1}/(B${kr}+B${kr + 1}),0)`);
  push('');
  push('時間帯 (回答時刻)', '組数', '人数', '');
  for (let h = 8; h <= 20; h++) {
    const hh = ('0' + h).slice(-2);
    push(`${hh}:00-`, `=COUNTIFS(${base},${L('answered_at')},"*T${hh}:*")`,
      `=SUMIFS(${L('party_size')},${base},${L('answered_at')},"*T${hh}:*")`, '');
  }

  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  sh.getRange('D:D').setNumberFormat('0.0%');
  sh.getRange(attrStart - 1, 1, 1, 4).setFontWeight('bold');
  sh.getRange(1, 1).setFontWeight('bold');
  sh.setColumnWidth(1, 220);
}
