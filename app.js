(() => {
  'use strict';

  const C = window.CONFIG;
  const $ = (s) => document.querySelector(s);
  const MOCK = new URLSearchParams(location.search).has('mock');

  // ---------- localStorage ----------
  const LS = {
    get(k, d) {
      try { const v = localStorage.getItem('fest.' + k); return v === null ? d : JSON.parse(v); } catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('fest.' + k, JSON.stringify(v)); } catch { /* 容量超過などは無視 (サーバーには送られる) */ }
    },
    del(k) { try { localStorage.removeItem('fest.' + k); } catch { /* noop */ } },
  };

  // #setup=<token> で開かれたら保存して URL から消す
  const setup = location.hash.match(/^#setup=([^&]+)$/);
  if (setup) {
    LS.set('token', decodeURIComponent(setup[1]));
    history.replaceState(null, '', location.pathname + location.search);
  }

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
  };
  LS.set('device', S.device);

  let responses = LS.get('responses', []);
  let outbox = LS.get('outbox', []);

  // ---------- 時刻 ----------
  // 端末のタイムゾーンに関係なく JST の ISO 文字列 (ms 付き)
  const jst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().replace('Z', '+09:00');
  const uuid = () =>
    crypto.randomUUID ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 3) | 8).toString(16);
      });

  // ---------- 音 (WebAudio で合成) ----------
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

  // ---------- エフェクト (幾何学図形を弾けさせる) ----------
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
  function burst(x, y, n, spread = 1) {
    if (REDUCED) n = Math.min(n, 6);
    const colors = ['#ff4a1c', '#ff4a1c', '#111', '#c4c4c4'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (4 + Math.random() * 10) * spread;
      parts.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 6 * spread,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        s: 8 + Math.random() * 14,
        k: i % 3,
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

  // ---------- 集計 ----------
  const emptyStats = () => ({ groups: 0, people: 0, attr: {}, kids: 0 });
  function addRow(st, r) {
    if (r.status !== 'complete' || r.is_test) return;
    st.groups++;
    st.people += Number(r.party_size) || 0;
    if (r.attribute) st.attr[r.attribute] = (st.attr[r.attribute] || 0) + 1;
    if (r.with_kids === 1) st.kids++;
  }
  // サーバー集計 + 未送信分。サーバーに一度も届いていなければローカルの全件
  function currentStats() {
    const base = S.serverStats;
    const st = base ? { ...base, attr: { ...base.attr } } : emptyStats();
    const ids = new Set(outbox);
    for (const r of responses) if (!base || ids.has(r.id)) addRow(st, r);
    return st;
  }

  // ---------- 通信 ----------
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
      // text/plain で送るとプリフライトが発生しない
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

  // ---------- 画面 ----------
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
    $('#prompt').innerHTML = q.prompt;

    const box = $('#options');
    box.innerHTML = q.options.map((o, i) =>
      `<button class="opt" role="option" tabindex="-1" data-i="${i}">${o.icon || ''}<span>${o.label}</span></button>`).join('');
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
    $('#counter').innerHTML = S.qi === 0 && st.groups > 0 ? `本日<b>${st.groups.toLocaleString()}</b>組が回答` : '';
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
    // スキップされることになった設問の回答は消す
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
    $('#res-sub').innerHTML = `これまでの来場 <b>${st.people.toLocaleString()}</b> 人`;
    const ms = $('#res-milestone');
    ms.hidden = !milestone;
    ms.textContent = milestone ? C.milestoneText : '';

    const attrQ = C.questions.find((q) => q.id === 'attribute');
    const pct = (v) => (st.groups ? Math.round(((st.attr[v] || 0) / st.groups) * 100) : 0);
    const mine = attrQ.options.find((o) => o.value === row.attribute);
    $('#res-lead').innerHTML = mine
      ? `あなたと同じ「${mine.short}」は<b>${pct(mine.value)}</b>%`
      : 'ありがとうございました';
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

  // ---------- 無操作リセット ----------
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
      // カーソルを動かしただけで立ち去った場合は黙って初期状態に戻す
      if (S.startedAt && idle >= C.idleWarnSec) resetSession();
      return;
    }
    const limit = C.idleWarnSec + C.idleCountdownSec;
    if (idle >= limit) { hideWarn(); finish('partial'); } else if (idle >= C.idleWarnSec) showWarn(Math.ceil(limit - idle));
  }, 200);

  // 入力があったら呼ぶ。警告中だった場合は true (その入力は警告解除だけに使う)
  function touch() {
    audio();
    S.last = Date.now();
    if (warnShown) { hideWarn(); return true; }
    // 待機中の設問1は表示時刻ではなく最初の操作から計測する
    if (S.screen === 'question' && !S.startedAt) {
      S.startedAt = new Date();
      S.qEnter = performance.now();
    }
    return false;
  }

  // ---------- 入力: キー ----------
  const K = C.keys;
  const actionOf = (code) => (code === K.left ? 'left' : code === K.right ? 'right' : code === K.ok ? 'ok' : code === K.back ? 'back' : null);
  const held = new Set();
  let holdTimer = null;

  addEventListener('keydown', (e) => {
    if (!$('#admin').hidden) { if (e.code === 'Escape') closeAdmin(); return; }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') { e.preventDefault(); openAdmin(); return; }
    const act = actionOf(e.code);
    if (!act) return;
    e.preventDefault();
    if (e.repeat) return;
    held.add(act);
    // 戻る + 決定 を3秒長押しで管理パネル
    if (held.has('ok') && held.has('back')) {
      clearTimeout(holdTimer);
      holdTimer = setTimeout(openAdmin, 3000);
      return;
    }
    if (touch()) return;
    S.inputs.add('key');
    input(act);
  });
  addEventListener('keyup', (e) => {
    const act = actionOf(e.code);
    if (act) held.delete(act);
    clearTimeout(holdTimer);
  });
  addEventListener('blur', () => { held.clear(); clearTimeout(holdTimer); });

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
      // 最後の決定キーの連打で結果を読み飛ばさないよう少し待つ
      if (Date.now() - S.resultAt > 1200) resetSession();
    }
  }

  // ---------- 入力: マウス ----------
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
  $('#s-result').addEventListener('click', () => {
    if (!S.swallowClick) input('ok');
  });

  // マウスのみのスタッフ向け: 左下隅を3秒長押しで管理パネル
  const hot = $('#hot');
  hot.addEventListener('pointerdown', () => { clearTimeout(holdTimer); holdTimer = setTimeout(openAdmin, 3000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) hot.addEventListener(ev, () => clearTimeout(holdTimer));

  // カーソルを止めて3秒で隠す
  let cursorTimer = null;
  addEventListener('pointermove', () => {
    document.body.classList.remove('hide-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('hide-cursor'), 3000);
  });

  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  // ---------- 管理パネル ----------
  let adminTimer = null;
  function openAdmin() {
    clearTimeout(holdTimer);
    held.clear();
    // 途中の回答はスタッフ操作なので記録せず捨てる
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
    const label = { unset: '未設定', ok: 'OK', denied: '拒否', unknown: '未確認' }[S.tokenState];
    const info = [
      ['トークン', label + (MOCK ? ' (mock)' : '')],
      ['未送信', outbox.length + ' 件'],
      ['ローカル', responses.length + ' 件'],
      ['最終同期', S.lastSync || '-'],
      ['端末名', S.device],
      ['版', C.appVersion],
    ];
    $('#admin-info').innerHTML = info.map(([k, v]) => `<dt>${k}</dt><dd>${String(v).replace(/</g, '&lt;')}</dd>`).join('');
    $('[data-a="test"]').textContent = 'テストモード: ' + (S.test ? 'ON' : 'OFF');
    $('[data-a="mute"]').textContent = '音: ' + (S.mute ? 'OFF' : 'ON');
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

  $('#admin').addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'flush') { retryAt = 0; checkStatus(); }
    else if (a === 'test') { S.test = !S.test; LS.set('test', S.test); setTokenState(S.tokenState); }
    else if (a === 'mute') { S.mute = !S.mute; LS.set('mute', S.mute); }
    else if (a === 'csv') {
      const pending = new Set(outbox);
      const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
      const lines = [[...COLS, 'synced'].join(',')].concat(responses.map((r) => [...COLS.map((c) => esc(r[c] ?? '')), pending.has(r.id) ? 0 : 1].join(',')));
      download(`fest-${S.device}-${stamp()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
    } else if (a === 'json') {
      download(`fest-${S.device}-${stamp()}.json`, JSON.stringify({ responses, outbox }, null, 1), 'application/json');
    } else if (a === 'device') {
      const v = prompt('端末名', S.device);
      if (v) { S.device = v.trim(); LS.set('device', S.device); }
    } else if (a === 'token') {
      if (confirm('この端末のトークンを消去しますか？ (未送信データは残ります)')) {
        LS.del('token');
        S.token = null;
        closeAdmin();
        setTokenState('unset');
      }
    } else if (a === 'close') closeAdmin();
    renderAdmin();
  });

  // ---------- 起動 ----------
  async function wake() {
    try { if (navigator.wakeLock && document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); } catch { /* 非対応 */ }
  }
  document.addEventListener('visibilitychange', wake);
  wake();

  addEventListener('online', () => { retryAt = 0; flush(); });
  setInterval(() => flush(), 10000);
  setInterval(checkStatus, 5 * 60 * 1000);

  setTokenState(S.token ? 'unknown' : 'unset');
  checkStatus();
})();
