(() => {
  'use strict';

  const C = window.CONFIG;
  const $ = (s) => document.querySelector(s);
  const MOCK = new URLSearchParams(location.search).has('mock');

  // localStorage
  const LS = {
    get(k, d) {
      try { const v = localStorage.getItem('fest.' + k); return v === null ? d : JSON.parse(v); } catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('fest.' + k, JSON.stringify(v)); } catch { /* 容量上限超過などのエラーは無視 (データはサーバー側へ送信されるため) */ }
    },
    del(k) { try { localStorage.removeItem('fest.' + k); } catch { /* noop */ } },
  };

  // #setup=<token> 付きでアクセスされた場合はトークンを保存し、URL からパラメータを除去
  const setup = location.hash.match(/^#setup=([^&]+)$/);
  if (setup) {
    LS.set('token', decodeURIComponent(setup[1]));
    history.replaceState(null, '', location.pathname + location.search);
  }

  // 既に開いているタブに #setup=…… が入力された場合に対応 (ハッシュ変更のみではページが再読込されないため)
  addEventListener('hashchange', () => { if (/^#setup=/.test(location.hash)) location.reload(); });

  const S = {
    screen: null,
    qi: 0,
    cursor: 0,
    answers: {},
    qMs: {},
    qEnter: 0,
    startedAt: null,
    inputs: new Set(),
    last: Date.now(),
    busy: false,
    lastOk: 0,
    resultAt: 0,
    resultTimer: null,
    swallowClick: false,
    token: MOCK ? 'mock' : LS.get('token', null),
    tokenState: 'unknown', // unset | ok | denied | unknown
    serverStats: LS.get('stats', null),
    lastSync: LS.get('lastSync', null),
    test: LS.get('test', false),
    mute: LS.get('mute', false),
    device: LS.get('device', 'reception-1'),
    hand: {
      enabled: LS.get('hand.enabled', C.hand.enabled),
      select: LS.get('hand.select', C.hand.select),
      preview: LS.get('hand.preview', C.hand.preview),
    },
    handState: 'off', // off | loading | ok | error
    handError: '',
  };
  LS.set('device', S.device);

  let responses = LS.get('responses', []);
  let outbox = LS.get('outbox', []);

  // 時刻処理
  // 端末のタイムゾーン設定に依存せず、常に JST (日本標準時) の ISO 文字列 (ミリ秒付き) を生成
  const jst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().replace('Z', '+09:00');
  const uuid = () =>
    crypto.randomUUID ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 3) | 8).toString(16);
      });

  // 音声効果 (Web Audio API による合成)
  const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66];
  let actx = null;
  function audio() {
    if (S.mute) return null;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch { return null; }
    return actx;
  }
  function tone(freq, at = 0, dur = 0.12, type = 'triangle', gain = 0.16) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + at;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const sfx = {
    move: (i) => tone(SCALE[i % SCALE.length], 0, 0.09, 'sine', 0.12),
    pick: (i) => { tone(SCALE[i % SCALE.length], 0, 0.16); tone(SCALE[i % SCALE.length] * 1.5, 0.02, 0.18, 'sine', 0.08); },
    back: () => tone(392, 0, 0.1, 'sine', 0.1),
    done: () => [0, 2, 4, 5].forEach((n, k) => tone(SCALE[n], k * 0.07, 0.3)),
    milestone: () => [0, 2, 4, 5, 4, 5].forEach((n, k) => tone(SCALE[n] * (k > 3 ? 2 : 1), k * 0.09, 0.4, 'square', 0.07)),
    tick: () => tone(330, 0, 0.06, 'sine', 0.06),
  };

  // 演出エフェクト (幾何学パーティクルの放出)
  const fx = $('#fx');
  const ctx = fx.getContext('2d');
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let parts = [];
  let raf = 0;
  function resizeFx() {
    fx.width = innerWidth * devicePixelRatio;
    fx.height = innerHeight * devicePixelRatio;
  }
  resizeFx();
  addEventListener('resize', resizeFx);
  // 図形に混ぜて飛ばすイラスト (5個に1個の割合で、GDG ロゴとサンドイッチを交互に)
  const IMGS = ['assets/gdg.svg', 'assets/sandwich.png'].map((src) => Object.assign(new Image(), { src }));
  function burst(x, y, n, spread = 1) {
    if (REDUCED) n = Math.min(n, 6);
    const colors = ['#4285f4', '#ea4335', '#fbbc04', '#34a853'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (4 + Math.random() * 10) * spread;
      const img = i % 5 === 4 ? IMGS[((i - 4) / 5) % IMGS.length] : null;
      parts.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 6 * spread,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * (img ? 0.12 : 0.3),
        s: img ? 56 + Math.random() * 24 : 8 + Math.random() * 14,
        k: i % 3,
        img,
        c: colors[i % colors.length],
        life: 1,
      });
    }
    if (!raf) raf = requestAnimationFrame(stepFx);
  }
  function stepFx() {
    const d = devicePixelRatio;
    ctx.clearRect(0, 0, fx.width, fx.height);
    parts = parts.filter((p) => p.life > 0);
    for (const p of parts) {
      p.vy += 0.45;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      p.life -= 0.012;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      ctx.translate(p.x * d, p.y * d);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      const s = p.s * d;
      if (p.img) {
        const w = p.img.naturalWidth;
        const h = p.img.naturalHeight;
        if (w && h) {
          const k = s / Math.max(w, h);
          ctx.drawImage(p.img, (-w * k) / 2, (-h * k) / 2, w * k, h * k);
        }
        ctx.restore();
        continue;
      }
      ctx.beginPath();
      if (p.k === 0) ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
      else if (p.k === 1) ctx.rect(-s / 2, -s / 2, s, s);
      else { ctx.moveTo(0, -s / 2); ctx.lineTo(s / 2, s / 2); ctx.lineTo(-s / 2, s / 2); ctx.closePath(); }
      ctx.fill();
      ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(stepFx) : 0;
    if (!raf) ctx.clearRect(0, 0, fx.width, fx.height);
  }

  // 集計処理
  const emptyStats = () => ({ groups: 0, people: 0, attr: {}, kids: 0 });
  function addRow(st, r) {
    if (r.status !== 'complete' || r.is_test) return;
    st.groups++;
    st.people += Number(r.party_size) || 0;
    if (r.attribute) st.attr[r.attribute] = (st.attr[r.attribute] || 0) + 1;
    if (r.with_kids === 1) st.kids++;
  }
  // サーバー集計値に未送信分を加算。一度もサーバーと同期していない場合はローカルの全件を集計
  function currentStats() {
    const base = S.serverStats;
    const st = base ? { ...base, attr: { ...base.attr } } : emptyStats();
    const ids = new Set(outbox);
    for (const r of responses) if (!base || ids.has(r.id)) addRow(st, r);
    return st;
  }

  // 通信
  async function post(payload) {
    if (MOCK) {
      await new Promise((r) => setTimeout(r, 300));
      if (payload.action === 'submit') {
        const st = S.serverStats || emptyStats();
        for (const r of payload.rows) addRow(st, r);
        return { ok: true, accepted: payload.rows.map((r) => r.id), stats: st };
      }
      return { ok: true, stats: S.serverStats || emptyStats() };
    }
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 15000);
    try {
      // text/plain で送信することで CORS プリフライトリクエストの発生を防止
      const res = await fetch(C.GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ ...payload, token: S.token }),
        signal: ac.signal,
        cache: 'no-store',
      });
      return await res.json();
    } catch (e) {
      return { ok: false, error: 'network', detail: String(e) };
    } finally {
      clearTimeout(to);
    }
  }

  function handle(r) {
    if (r && r.ok) {
      setTokenState('ok');
      if (r.stats) { S.serverStats = r.stats; LS.set('stats', r.stats); }
      S.lastSync = jst(new Date());
      LS.set('lastSync', S.lastSync);
    } else if (r && r.error === 'unauthorized') {
      setTokenState('denied');
    } else {
      setTokenState('unknown');
    }
    return r && r.ok;
  }

  let flushing = false;
  let retryAt = 0;
  let backoff = 0;
  async function flush(force) {
    if (flushing || !S.token) return;
    if (!force && (S.tokenState === 'denied' || Date.now() < retryAt)) return;
    if (!outbox.length) return;
    flushing = true;
    const ids = new Set(outbox.slice(0, 100));
    const rows = responses.filter((r) => ids.has(r.id));
    const r = await post({ action: 'submit', rows });
    if (handle(r)) {
      const ok = new Set(r.accepted || []);
      outbox = outbox.filter((id) => !ok.has(id));
      LS.set('outbox', outbox);
      backoff = 0;
      retryAt = 0;
    } else {
      backoff = Math.min(60000, backoff ? backoff * 2 : 2000);
      retryAt = Date.now() + backoff;
    }
    flushing = false;
    if (S.screen === 'question') renderCounter();
    if (outbox.length && S.tokenState === 'ok') setTimeout(() => flush(), 200);
  }

  async function checkStatus() {
    if (!S.token) { setTokenState('unset'); return; }
    handle(await post({ action: 'stats' }));
    if (S.screen === 'question') renderCounter();
    flush(true);
  }

  function setTokenState(st) {
    S.tokenState = st;
    const dot = $('#dot');
    dot.className = (st === 'ok' ? '' : st) + (S.test ? ' test' : '');
    if (st === 'unset') show('setup');
    else if (S.screen === 'setup' || !S.screen) resetSession();
    renderAdmin();
  }

  // 画面制御
  function show(name) {
    S.screen = name;
    for (const id of ['question', 'result', 'setup']) $('#s-' + id).hidden = id !== name;
  }

  const activeQs = () => C.questions.filter((q) => !q.skipIf || !q.skipIf(S.answers));

  function resetSession() {
    clearTimeout(S.resultTimer);
    S.qi = 0;
    S.answers = {};
    S.qMs = {};
    S.startedAt = null;
    S.inputs = new Set();
    S.busy = false;
    hideWarn();
    if (S.tokenState === 'unset') { show('setup'); return; }
    show('question');
    renderQuestion();
  }

  function renderQuestion() {
    const qs = activeQs();
    const q = qs[S.qi];
    const prev = q.options.findIndex((o) => o.value === S.answers[q.id]);
    S.cursor = prev >= 0 ? prev : Math.floor((q.options.length - 1) / 2);
    S.qEnter = performance.now();

    $('#dots').innerHTML = qs.map((_, i) => `<i class="${i < S.qi ? 'done' : i === S.qi ? 'now' : ''}"></i>`).join('');
    $('#hint').textContent = q.hint || '';
    $('#backbtn').classList.toggle('off', S.qi === 0);
    $('#backbtn').classList.remove('cur');
    $('#prompt').innerHTML = q.prompt;

    const box = $('#options');
    box.innerHTML = q.options.map((o, i) =>
      `<button class="opt" role="option" tabindex="-1" data-i="${i}">${o.icon || ''}<span>${o.label.split('<wbr>').map((t) => `<i>${t}</i>`).join('<wbr>')}</span></button>`).join('');
    box.classList.remove('enter');
    void box.offsetWidth;
    box.classList.add('enter');
    renderCursor();
    renderCounter();
  }

  function renderCursor() {
    document.querySelectorAll('.opt').forEach((el, i) => {
      el.classList.toggle('cur', i === S.cursor);
      el.setAttribute('aria-selected', i === S.cursor);
    });
  }

  function renderCounter() {
    const st = currentStats();
    $('#counter').innerHTML = S.qi === 0 && st.groups > 0 ? `本日<b>${st.groups.toLocaleString()}</b>組が回答済み` : '';
  }

  function move(d) {
    const n = activeQs()[S.qi].options.length;
    S.cursor = (S.cursor + d + n) % n;
    renderCursor();
    sfx.move(S.cursor);
  }

  function pick(i) {
    if (S.busy) return;
    const q = activeQs()[S.qi];
    const o = q.options[i];
    if (!o) return;
    if (!S.startedAt) S.startedAt = new Date();
    S.cursor = i;
    S.answers[q.id] = o.value;
    S.qMs[q.id] = Math.round(performance.now() - S.qEnter);
    // 条件分岐によりスキップ対象となった設問の回答データを削除
    for (const qq of C.questions) if (qq.skipIf && qq.skipIf(S.answers)) delete S.answers[qq.id];

    const el = document.querySelectorAll('.opt')[i];
    renderCursor();
    el.classList.add('chosen');
    const b = el.getBoundingClientRect();
    burst(b.left + b.width / 2, b.top + b.height / 2, 10, 0.5);
    sfx.pick(i);

    S.busy = true;
    setTimeout(() => {
      S.busy = false;
      if (S.qi + 1 < activeQs().length) { S.qi++; renderQuestion(); } else finish('complete');
    }, 220);
  }

  function back() {
    if (S.busy || S.qi === 0) return;
    S.qi--;
    sfx.back();
    renderQuestion();
  }

  function finish(status) {
    const now = new Date();
    const seq = LS.get('seq', 0) + 1;
    LS.set('seq', seq);
    const a = S.answers;
    const row = {
      id: uuid(),
      seq,
      status,
      is_test: S.test ? 1 : 0,
      party_size: a.party_size ?? '',
      attribute: a.attribute ?? '',
      with_kids: a.with_kids === undefined ? '' : a.with_kids === 'yes' ? 1 : 0,
      started_at: jst(S.startedAt || now),
      answered_at: jst(now),
      duration_ms: now - (S.startedAt || now),
      q_ms: JSON.stringify(S.qMs),
      input: S.inputs.size > 1 ? 'mixed' : [...S.inputs][0] || '',
      device: S.device,
      app_version: C.appVersion,
    };
    responses.push(row);
    outbox.push(row.id);
    LS.set('responses', responses);
    LS.set('outbox', outbox);
    saveLocal(row);
    flush(true);
    if (status === 'complete') showResult(row);
    else resetSession();
  }

  function showResult(row) {
    show('result');
    hideWarn();
    S.resultAt = Date.now();
    const st = currentStats();
    const n = st.groups;
    const milestone = !row.is_test && n > 0 && n % C.milestoneEvery === 0;

    $('#res-n').innerHTML = `<span class="pre">本日</span>${n.toLocaleString()}<small>組目</small>`;
    $('#res-sub').innerHTML = `これまでの総来場者数 <b>${st.people.toLocaleString()}</b> 人`;
    const ms = $('#res-milestone');
    ms.hidden = !milestone;
    ms.textContent = milestone ? C.milestoneText : '';

    const attrQ = C.questions.find((q) => q.id === 'attribute');
    const pct = (v) => (st.groups ? Math.round(((st.attr[v] || 0) / st.groups) * 100) : 0);
    const mine = attrQ.options.find((o) => o.value === row.attribute);
    $('#res-lead').innerHTML = mine
      ? `あなたと同じ「${mine.short}」の方は<b>${pct(mine.value)}</b>%`
      : 'ご回答ありがとうございました';
    const max = Math.max(1, ...attrQ.options.map((o) => st.attr[o.value] || 0));
    $('#res-bars').innerHTML = attrQ.options.map((o) => {
      const me = o.value === row.attribute ? ' me' : '';
      const w = ((st.attr[o.value] || 0) / max) * 100;
      return `<span class="lb${me}">${o.short}</span>`
        + `<span class="tr${me}"><i class="fl" style="width:${w}%"></i></span>`
        + `<span class="v${me}">${pct(o.value)}%</span>`;
    }).join('');

    const sec = C.resultSec + (milestone ? 6 : 0);
    const t = $('#res-timer');
    t.classList.remove('run');
    t.style.setProperty('--dur', sec + 's');
    void t.offsetWidth;
    t.classList.add('run');
    S.resultTimer = setTimeout(resetSession, sec * 1000);

    if (milestone) {
      sfx.milestone();
      for (let k = 0; k < 4; k++) setTimeout(() => burst(innerWidth * (0.2 + 0.2 * k), innerHeight * 0.5, 40, 1.2), k * 180);
    } else {
      sfx.done();
      burst(innerWidth * 0.25, innerHeight * 0.45, 36, 1);
    }
  }

  // 無操作時の自動リセット
  let warnShown = false;
  let lastWarnSec = 0;
  function showWarn(sec) {
    if (!warnShown) { $('#warn').hidden = false; warnShown = true; }
    if (sec !== lastWarnSec) {
      $('#warn-n').textContent = sec;
      $('#warn-s').textContent = sec;
      lastWarnSec = sec;
      sfx.tick();
    }
  }
  function hideWarn() {
    if (!warnShown) return;
    $('#warn').hidden = true;
    warnShown = false;
    lastWarnSec = 0;
  }
  setInterval(() => {
    const idle = (Date.now() - S.last) / 1000;
    if (S.screen !== 'question' || !$('#admin').hidden) { hideWarn(); return; }
    if (!Object.keys(S.answers).length) {
      // 未回答のままカーソル移動のみで離脱した場合は、警告を出さずに初期状態へリセット
      if (S.startedAt && idle >= C.idleWarnSec) resetSession();
      return;
    }
    const limit = C.idleWarnSec + C.idleCountdownSec;
    if (idle >= limit) { hideWarn(); finish('partial'); } else if (idle >= C.idleWarnSec) showWarn(Math.ceil(limit - idle));
  }, 200);

  // 操作入力時に呼び出し。警告表示中だった場合は true を返し、その入力は警告解除のみに消費
  function touch() {
    audio();
    S.last = Date.now();
    if (warnShown) { hideWarn(); return true; }
    // 待機中の第1問は画面表示時刻ではなく最初の操作から計測
    if (S.screen === 'question' && !S.startedAt) {
      S.startedAt = new Date();
      S.qEnter = performance.now();
    }
    return false;
  }

  // キーボード入力
  const K = C.keys;
  const actionOf = (code) => (code === K.left ? 'left' : code === K.right ? 'right' : code === K.ok ? 'ok' : code === K.back ? 'back' : null);
  const held = new Set();
  let holdTimer = null;

  // 管理パネルを開く長押し判定。押下中は画面左下にプログレスバーをアニメーション表示
  const HOLD_MS = 2000;
  function startHold() {
    clearTimeout(holdTimer);
    const bar = $('#holdbar');
    bar.style.setProperty('--hold', HOLD_MS + 'ms');
    bar.classList.remove('run');
    void bar.offsetWidth;
    bar.classList.add('run');
    holdTimer = setTimeout(openAdmin, HOLD_MS);
  }
  function cancelHold() {
    clearTimeout(holdTimer);
    $('#holdbar').classList.remove('run');
  }

  addEventListener('keydown', (e) => {
    if (!$('#admin').hidden) { if (e.code === 'Escape') closeAdmin(); return; }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') { e.preventDefault(); openAdmin(); return; }
    const act = actionOf(e.code);
    if (!act) return;
    e.preventDefault();
    if (e.repeat) return;
    held.add(act);
    // 「戻る」＋「決定」キーの2秒間長押しで管理パネルを表示
    if (held.has('ok') && held.has('back')) {
      startHold();
      return;
    }
    if (touch()) return;
    S.inputs.add('key');
    input(act);
  });
  addEventListener('keyup', (e) => {
    const act = actionOf(e.code);
    if (act) held.delete(act);
    cancelHold();
  });
  addEventListener('blur', () => { held.clear(); cancelHold(); });

  function input(act) {
    if (S.screen === 'question') {
      if (act === 'left') move(-1);
      else if (act === 'right') move(1);
      else if (act === 'ok') {
        if (performance.now() - S.lastOk < 150) return;
        S.lastOk = performance.now();
        pick(S.cursor);
      } else if (act === 'back') back();
    } else if (S.screen === 'result') {
      // 最終設問での決定キー連打による結果画面の誤スキップを防止するため、一定時間待機
      if (Date.now() - S.resultAt > 1200) resetSession();
    }
  }

  // マウス / タッチ入力
  addEventListener('pointerdown', (e) => {
    if (e.target.closest('#admin, #hot')) return;
    S.swallowClick = touch();
  }, true);

  $('#options').addEventListener('click', (e) => {
    const el = e.target.closest('.opt');
    if (!el || S.swallowClick) return;
    S.inputs.add('mouse');
    pick(Number(el.dataset.i));
  });
  $('#options').addEventListener('pointerover', (e) => {
    const el = e.target.closest('.opt');
    if (!el || e.pointerType !== 'mouse' || S.busy) return;
    const i = Number(el.dataset.i);
    if (i !== S.cursor) { S.cursor = i; renderCursor(); sfx.move(i); }
  });
  $('#backbtn').addEventListener('click', () => {
    if (S.swallowClick) return;
    S.inputs.add('mouse');
    back();
  });
  $('#s-result').addEventListener('click', () => {
    if (!S.swallowClick) input('ok');
  });

  // カメラ (手の骨格認識) 入力。hand.js から毎フレーム呼び出されるハンドラ
  const ptr = $('#handptr');
  const DW = { idx: -1, since: 0, until: 0 };
  let lastPinch = false;
  let lastHandPick = 0;
  let lastTouchX = null;

  // 選択肢は横一列配置のため、手のX座標に最も近い選択肢を選択対象と判定
  function optionAtX(x) {
    let best = -1;
    let bestD = Infinity;
    document.querySelectorAll('#options .opt').forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - x);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
  // 「戻る」ボタンは選択肢の列の外 (左上) にあるため、手の位置がボタンの周囲に入ったときだけ対象にする
  const backBtn = $('#backbtn');
  function overBack(x, y) {
    if (backBtn.classList.contains('off')) return false;
    const r = backBtn.getBoundingClientRect();
    return x > r.left - 40 && x < r.right + 40 && y > r.top - 40 && y < r.bottom + 40;
  }
  function setDwell(idx, p) {
    document.querySelectorAll('#options .opt').forEach((el, i) => el.style.setProperty('--dwell', i === idx ? p : 0));
    backBtn.style.setProperty('--dwell', idx === 'back' ? p : 0);
  }

  function onHand(h) {
    const active = h.present && S.hand.enabled && $('#admin').hidden && (S.screen === 'question' || S.screen === 'result');
    ptr.hidden = !active;
    if (!active) {
      lastPinch = false;
      lastTouchX = null;
      DW.idx = -1;
      if (S.screen === 'question') setDwell(-1, 0);
      backBtn.classList.remove('cur');
      return;
    }
    ptr.style.transform = `translate(${h.x}px, ${h.y}px)`;
    ptr.classList.toggle('pinch', h.pinch);
    const rising = h.pinch && !lastPinch;
    lastPinch = h.pinch;

    // 一定以上の手の移動またはピンチ動作のみを操作と判定 (手をかざしただけの通行人による誤開始を防止)
    if (lastTouchX === null || Math.abs(h.x - lastTouchX) > 40 || rising) {
      lastTouchX = h.x;
      if (touch()) return;
    }

    if (S.screen === 'result') {
      if (rising && S.hand.select === 'pinch') { S.inputs.add('hand'); input('ok'); }
      return;
    }
    if (S.busy) return;
    const idx = overBack(h.x, h.y) ? 'back' : optionAtX(h.x);
    if (idx === -1) return;
    backBtn.classList.toggle('cur', idx === 'back');
    if (idx !== 'back' && idx !== S.cursor) { S.cursor = idx; renderCursor(); sfx.move(idx); }
    const go = () => {
      S.inputs.add('hand');
      if (idx === 'back') back();
      else pick(idx);
    };

    const now = performance.now();
    if (S.hand.select === 'pinch') {
      if (rising && now - lastHandPick > 500) {
        lastHandPick = now;
        go();
      }
      return;
    }
    // 手を止めて決定 (dwell): 同一選択肢上に dwellMs 滞留で決定。決定後は cooldownMs 経過後に再判定を開始
    if (idx !== DW.idx) { DW.idx = idx; DW.since = Math.max(now, DW.until); }
    const p = Math.min(1, Math.max(0, (now - DW.since) / C.hand.dwellMs));
    setDwell(idx, p);
    if (p >= 1) {
      DW.until = now + C.hand.cooldownMs;
      DW.idx = -1;
      go();
    }
  }

  function renderHandUi() {
    const on = S.hand.enabled && S.handState === 'ok';
    $('#handhint').textContent = on ? C.hand.hint[S.hand.select] : '';
    $('#handlayer').hidden = !on || S.hand.preview === 'none';
    if (!on) ptr.hidden = true;
  }

  // hand.js (ES module) との連携用インターフェース
  window.FEST = {
    settings: () => S.hand,
    // 骨格・映像を描くのは来場者が操作する画面だけ (管理パネル表示中は描かない)
    active: () => $('#admin').hidden && (S.screen === 'question' || S.screen === 'result'),
    hand: onHand,
    handState(st, err) {
      S.handState = st;
      S.handError = err ? String(err.message || err) : '';
      renderHandUi();
      renderAdmin();
    },
  };

  // マウス操作端末向け: 画面左下の領域を2秒間長押しすると管理パネルを表示
  const hot = $('#hot');
  hot.addEventListener('pointerdown', startHold);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) hot.addEventListener(ev, cancelHold);

  // カーソル停止後3秒で非表示化
  let cursorTimer = null;
  addEventListener('pointermove', () => {
    document.body.classList.remove('hide-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('hide-cursor'), 3000);
  });

  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  // 管理パネル制御
  let adminTimer = null;
  function openAdmin() {
    cancelHold();
    held.clear();
    // スタッフ操作開始時の回答中データは破棄し、記録しない
    if (S.screen === 'question') resetSession();
    $('#admin').hidden = false;
    renderAdmin();
    adminTimer = setInterval(renderAdmin, 1000);
  }
  function closeAdmin() {
    $('#admin').hidden = true;
    clearInterval(adminTimer);
    S.last = Date.now();
  }
  function renderAdmin() {
    if ($('#admin').hidden) return;
    // [項目, 値, 色 (ok: 緑 / warn: 黄 / err: 赤 / 空: なし)]
    const token = { unset: ['未設定', 'err'], ok: ['正常', 'ok'], denied: ['認証エラー', 'err'], unknown: ['未確認', 'warn'] }[S.tokenState];
    const csv = L.handle ? [`${L.name}/responses.csv (${L.rows} 行)`, 'ok'] : L.error ? [L.error, 'err'] : [FSA ? '未選択' : '非対応', 'warn'];
    const cam = { off: ['OFF', ''], loading: ['準備中', 'warn'], ok: ['動作中', 'ok'], error: ['エラー', 'err'] }[S.handState];
    const info = [
      ['トークン', token[0] + (MOCK ? ' (mock)' : ''), token[1]],
      ['未送信', outbox.length + ' 件', outbox.length ? 'warn' : 'ok'],
      ['CSV保存先', csv[0], csv[1]],
      ['カメラ', cam[0] + (S.handError ? ` (${S.handError})` : ''), cam[1]],
      ['この端末の回答', responses.length + ' 件', ''],
      ['最終同期', S.lastSync ? S.lastSync.slice(11, 19) : '-', ''],
      ['端末名', S.device, ''],
      ['バージョン', C.appVersion, ''],
    ];
    $('#admin-info').innerHTML = info.map(([k, v, tone]) => `<dt>${k}</dt><dd class="${tone}">${String(v).replace(/</g, '&lt;')}</dd>`).join('');

    const sw = (a, on) => $(`.sw[data-a="${a}"]`).setAttribute('aria-checked', on);
    sw('test', S.test);
    sw('mute', !S.mute);
    sw('hand', S.hand.enabled);
    for (const [a, v] of [['handsel', S.hand.select], ['handview', S.hand.preview]]) {
      const seg = $(`.seg[data-a="${a}"]`);
      seg.classList.toggle('off', !S.hand.enabled);
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', b.dataset.v === v));
    }
  }

  const COLS = ['id', 'seq', 'status', 'is_test', 'party_size', 'attribute', 'with_kids', 'started_at', 'answered_at', 'duration_ms', 'q_ms', 'input', 'device', 'app_version'];
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const stamp = () => jst(new Date()).slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

  // ローカル CSV (File System Access API)
  // Edge のキオスクモードは InPrivate 動作で localStorage が保持されないため、指定フォルダの responses.csv に1件ずつ追記保存
  const FSA = typeof window.showDirectoryPicker === 'function';
  const CSV_BOM = String.fromCharCode(0xfeff); // Excel での文字化けを防ぐため UTF-8 の BOM を付与
  const L = { handle: null, name: '', rows: 0, error: '', queue: Promise.resolve() };
  const csvEsc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const csvLine = (r) => COLS.map((c) => csvEsc(r[c] ?? '')).join(',') + '\r\n';

  async function appendTo(handle, text) {
    const w = await handle.createWritable({ keepExistingData: true });
    try {
      await w.seek((await handle.getFile()).size);
      await w.write(text);
      await w.close();
    } catch (e) {
      await w.abort().catch(() => {});
      throw e;
    }
  }

  function renderLocalState() {
    // 保存先未選択時は左下にインジケーター (四角) を表示してスタッフに通知
    $('#ldot').hidden = !FSA || !!L.handle;
  }

  async function pickLocalDir() {
    if (!FSA) { L.error = 'ブラウザ非対応'; return; }
    try {
      const dir = await window.showDirectoryPicker({ id: 'fest-stats', mode: 'readwrite' });
      const handle = await dir.getFileHandle('responses.csv', { create: true });
      const text = await (await handle.getFile()).text();
      // ファイル内に既存の回答は重複書き込みせず、未追記の回答のみを追加
      const have = new Set(text.split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(',')[0]));
      const missing = responses.filter((r) => !have.has(r.id));
      const out = (text.trim() ? '' : CSV_BOM + COLS.join(',') + '\r\n') + missing.map(csvLine).join('');
      if (out) await appendTo(handle, out);
      L.handle = handle;
      L.name = dir.name;
      L.rows = have.size + missing.length;
      L.error = '';
    } catch (e) {
      if (e.name !== 'AbortError') L.error = String(e.message || e);
    }
    renderLocalState();
    renderAdmin();
  }

  // 回答確定時に実行。非同期キューにより順番に1件ずつ書き込み
  function saveLocal(row) {
    if (!L.handle) return;
    L.queue = L.queue.then(async () => {
      try {
        await appendTo(L.handle, csvLine(row));
        L.rows++;
        L.error = '';
      } catch (e) {
        L.error = String(e.message || e);
        L.handle = null;
      }
      renderLocalState();
      renderAdmin();
    });
  }

  $('#admin').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    // セグメント (並んだボタン) は親の data-a が操作、各ボタンの data-v が選んだ値
    const a = btn.dataset.a || btn.closest('[data-a]')?.dataset.a;
    const v = btn.dataset.v;
    if (a === 'flush') { retryAt = 0; checkStatus(); }
    else if (a === 'test') { S.test = !S.test; LS.set('test', S.test); setTokenState(S.tokenState); }
    else if (a === 'mute') { S.mute = !S.mute; LS.set('mute', S.mute); }
    else if (a === 'csv') {
      const pending = new Set(outbox);
      const lines = [[...COLS, 'synced'].join(',')].concat(responses.map((r) => [...COLS.map((c) => csvEsc(r[c] ?? '')), pending.has(r.id) ? 0 : 1].join(',')));
      download(`fest-${S.device}-${stamp()}.csv`, CSV_BOM + lines.join('\r\n'), 'text/csv');
    } else if (a === 'dir') {
      pickLocalDir();
    } else if (a === 'json') {
      download(`fest-${S.device}-${stamp()}.json`, JSON.stringify({ responses, outbox }, null, 1), 'application/json');
    } else if (a === 'device') {
      const v = prompt('端末名を入力してください', S.device);
      if (v) { S.device = v.trim(); LS.set('device', S.device); }
    } else if (a === 'token') {
      if (confirm('この端末に保存されているトークンを消去しますか？\n(※端末内の未送信データは保持されます)')) {
        LS.del('token');
        S.token = null;
        closeAdmin();
        setTokenState('unset');
      }
    } else if (a === 'hand') {
      S.hand.enabled = !S.hand.enabled;
      LS.set('hand.enabled', S.hand.enabled);
      if (!window.HAND) FEST.handState('error', 'hand.js 未読み込み');
      else if (S.hand.enabled) window.HAND.start();
      else { window.HAND.stop(); FEST.handState('off'); }
    } else if (a === 'handsel' && v) {
      S.hand.select = v;
      LS.set('hand.select', v);
      renderHandUi();
    } else if (a === 'handview' && v) {
      S.hand.preview = v;
      LS.set('hand.preview', v);
      renderHandUi();
    } else if (a === 'close') closeAdmin();
    renderAdmin();
  });

  // 初期化・自動実行
  async function wake() {
    try { if (navigator.wakeLock && document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); } catch { /* Screen Wake Lock API 非対応環境 */ }
  }
  document.addEventListener('visibilitychange', wake);
  wake();

  addEventListener('online', () => { retryAt = 0; flush(); });
  setInterval(() => flush(), 10000);
  setInterval(checkStatus, 5 * 60 * 1000);

  renderLocalState();
  renderHandUi();
  // CDN からの MediaPipe 読み込みが一定時間完了しない場合はエラーを表示
  setTimeout(() => { if (S.hand.enabled && !window.HAND && S.handState !== 'error') FEST.handState('error', 'MediaPipe の読み込みに失敗'); }, 20000);
  setTokenState(S.token ? 'unknown' : 'unset');
  checkStatus();
})();
