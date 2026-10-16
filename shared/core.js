/* Shared data layer + chart helpers for all 3 design variants.
   Data source: public Google Sheet read through the gviz CSV endpoint (CORS-open).
   Sheet structure (per month):
     "<MONTH> (DASH)"  -> row1 headers, row2: label | SOF FOYDA | UMUMIY TOPILGAN | REKLAMAGA ISHLATILGAN
     "<MONTH> (INFO)"  -> SANA | TOPILDI | ISHLATILDI | FARQ, rows 1..31, last row "umumiy" (totals)
   SOF FOYDA = net profit = TOPILGAN(found) - REKLAMA(ad spend). FARQ = daily TOPILDI - ISHLATILDI.
   Add more projects/months below: each project = one spreadsheet, each month = pair of tab gids. */
(function () {
  const CONFIG = {
    projects: [
      {
        id: 'main',
        name: 'Учёт',
        sheetId: '1JmH3e4La9ino6_JvrKPveTw0eT-G2u574HaJJN-mPD8',
        currency: "so'm",
        scriptUrl: '', // Apps Script web-app URL for writing (see apps-script/Code.gs)
        token: '',     // same value as TOKEN in the script
        months: [ // newest first
          { key: '2026-10', label: 'Октябрь', gen: 'октября', short: 'OKT', dash: 934637509, info: 1669719066 },
          { key: '2026-09', label: 'Сентябрь', gen: 'сентября', short: 'SEN', dash: 1641110174, info: 661081149 },
          { key: '2026-08', label: 'Август', gen: 'августа', short: 'AVG', dash: 1290918295, info: null },
          { key: '2026-07', label: 'Июль', gen: 'июля', short: 'IYL', dash: 658518441, info: null },
        ],
      },
      // { id: 'second', name: 'Проект 2', sheetId: '...', currency: "so'm", months: [...] },
    ],
  };

  /* ---------- parsing ---------- */
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  // "1 800 000soʼm" -> 1800000 ; "-100 000soʼm" -> -100000 ; "" -> null
  function num(s) {
    if (s == null) return null;
    const t = String(s).replace(/[^\d-]/g, '');
    if (t === '' || t === '-') return null;
    return parseInt(t, 10);
  }
  async function fetchTab(sheetId, gid) {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Sheet HTTP ' + r.status);
    return parseCSV(await r.text());
  }

  async function loadMonth(project, m) {
    const out = { ...m, summary: null, days: [], total: null };
    const jobs = [fetchTab(project.sheetId, m.dash)];
    if (m.info != null) jobs.push(fetchTab(project.sheetId, m.info));
    const [dash, info] = await Promise.all(jobs);
    const r = dash[1] || [];
    out.summary = { profit: num(r[1]) || 0, found: num(r[2]) || 0, spent: num(r[3]) || 0 };
    if (info) {
      for (const row of info.slice(1)) {
        const first = String(row[0] || '').trim().toLowerCase();
        if (first === 'umumiy') { out.total = { found: num(row[1]), spent: num(row[2]), diff: num(row[3]) }; continue; }
        const d = parseInt(first, 10);
        const found = num(row[1]), spent = num(row[2]);
        if (!d || (found == null && spent == null)) continue; // skip future / empty days
        out.days.push({ d, hasFound: found != null, found: found || 0, spent: spent || 0, diff: num(row[3]) ?? (found || 0) - (spent || 0) });
      }
    }
    // derived stats
    const s = out.summary, days = out.days;
    out.roi = s.spent ? s.profit / s.spent : 0;
    out.adShare = s.found ? s.spent / s.found : 0;
    out.activeDays = days.length;
    out.avgProfit = days.length ? Math.round(days.reduce((a, x) => a + x.diff, 0) / days.length) : 0;
    out.best = days.length ? days.reduce((a, x) => (x.diff > a.diff ? x : a)) : null;
    out.worst = days.length ? days.reduce((a, x) => (x.diff < a.diff ? x : a)) : null;
    return out;
  }
  async function loadProject(p) {
    const months = await Promise.all(p.months.map((m) => loadMonth(p, m)));
    months.forEach((m, i) => {
      const prev = months[i + 1];
      m.prev = prev || null;
      m.delta = prev && prev.summary.profit ? (m.summary.profit - prev.summary.profit) / Math.abs(prev.summary.profit) : null;
    });
    return months;
  }

  /* ---------- formatting ---------- */
  const nf = new Intl.NumberFormat('ru-RU');
  const fmt = (n) => (n == null ? '—' : nf.format(n).replace(/ | /g, ' '));
  const som = (n) => fmt(n) + " so'm";
  const short = (n) => {
    if (n == null) return '—';
    const a = Math.abs(n), s = n < 0 ? '−' : '';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return s + Math.round(a / 1e3) + 'K';
    return s + a;
  };
  const pct = (x, d = 0) => (x == null ? '—' : (x * 100).toFixed(d) + '%');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- SVG charts (colors come from CSS: .c-found .c-spent .c-profit .grid .axis) ---------- */
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  // grouped bars found vs spent + profit line
  function dailyChart(days, o = {}) {
    if (!days.length) return '<div class="empty">Нет дневных данных</div>';
    const W = 860, H = o.height || 280, P = { l: 44, r: 12, t: 12, b: 26 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const lo = Math.min(0, ...days.map((d) => d.diff));
    const hi = niceMax(Math.max(...days.map((d) => Math.max(d.found, d.spent, d.diff))));
    const y = (v) => P.t + ih - ((v - lo) / (hi - lo)) * ih;
    const step = iw / days.length, bw = Math.max(3, Math.min(14, step * 0.34));
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      g += `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${P.l - 6}" y="${y(v) + 3}" text-anchor="end">${short(v)}</text>`;
    }
    let bars = '', pts = [];
    days.forEach((d, i) => {
      const cx = P.l + step * i + step / 2;
      bars += `<g class="col"><rect class="hit" x="${cx - step / 2}" y="${P.t}" width="${step}" height="${ih}"/>` +
        `<rect class="c-found bar" x="${cx - bw - 1}" y="${y(d.found)}" width="${bw}" height="${Math.max(0, y(0) - y(d.found))}" rx="2"/>` +
        `<rect class="c-spent bar" x="${cx + 1}" y="${y(d.spent)}" width="${bw}" height="${Math.max(0, y(0) - y(d.spent))}" rx="2"/>` +
        `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${d.d}</text>` +
        `<title>${d.d}-е · найдено ${fmt(d.found)} · реклама ${fmt(d.spent)} · прибыль ${fmt(d.diff)}</title></g>`;
      pts.push([cx, y(d.diff)]);
    });
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const dots = pts.map((p) => `<circle class="c-profit-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3"/>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Дневной график">${g}<line class="grid zero" x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}"/>${bars}<path class="c-profit-line" d="${line}" fill="none"/>${dots}</svg>`;
  }
  // cumulative profit area
  function cumulativeChart(days, o = {}) {
    if (!days.length) return '';
    const W = 860, H = o.height || 200, P = { l: 44, r: 12, t: 12, b: 22 };
    let acc = 0; const pts = days.map((d) => (acc += d.diff, { d: d.d, v: acc }));
    const hi = niceMax(Math.max(...pts.map((p) => p.v))), iw = W - P.l - P.r, ih = H - P.t - P.b;
    const x = (i) => P.l + (pts.length === 1 ? iw / 2 : (iw * i) / (pts.length - 1)), y = (v) => P.t + ih - (v / hi) * ih;
    let g = ''; for (let i = 0; i <= 3; i++) { const v = (hi * i) / 3; g += `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${P.l - 6}" y="${y(v) + 3}" text-anchor="end">${short(v)}</text>`; }
    const l = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
    const area = `${l} L${x(pts.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`;
    const lab = pts.filter((_, i) => i % Math.ceil(pts.length / 10) === 0 || i === pts.length - 1).map((p) => `<text class="axis" x="${x(p.d ? pts.indexOf(p) : 0)}" y="${H - 6}" text-anchor="middle">${p.d}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}<path class="c-profit-area" d="${area}"/><path class="c-profit-line" d="${l}" fill="none"/>${lab}</svg>`;
  }
  // month-over-month bars (profit), months oldest -> newest, highlight index
  function monthsChart(months, activeKey, o = {}) {
    const list = months.slice().reverse(), W = 420, H = o.height || 180, P = { l: 8, r: 8, t: 22, b: 22 };
    const hi = niceMax(Math.max(...list.map((m) => m.summary.profit))), ih = H - P.t - P.b, step = (W - P.l - P.r) / list.length, bw = Math.min(54, step * 0.6);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">` + list.map((m, i) => {
      const cx = P.l + step * i + step / 2, h = (m.summary.profit / hi) * ih, on = m.key === activeKey;
      return `<g><rect class="c-profit mbar${on ? ' on' : ''}" x="${cx - bw / 2}" y="${P.t + ih - h}" width="${bw}" height="${Math.max(2, h)}" rx="5"/>` +
        `<text class="axis val" x="${cx}" y="${P.t + ih - h - 6}" text-anchor="middle">${short(m.summary.profit)}</text>` +
        `<text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle">${m.short}</text></g>`;
    }).join('') + '</svg>';
  }
  function spark(vals, w = 120, h = 34) {
    if (vals.length < 2) return '';
    const lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1;
    const p = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 3 - ((v - lo) / r) * (h - 6)}`);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${p.join(' ')}" fill="none" class="c-profit-line"/></svg>`;
  }
  // ring: share (0..1)
  function ring(share, size = 120, stroke = 12) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, s = Math.max(0, Math.min(1, share));
    return `<svg class="ring" viewBox="0 0 ${size} ${size}"><circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/><circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c * s} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  }

  /* ---------- app runtime ---------- */
  // Dash.start(renderFn): renderFn(state, H) returns HTML for #app.
  // Click targets: [data-project="i"], [data-month="i"], [data-refresh]
  const state = { pi: 0, mi: 0, months: null, status: 'loading', error: null, updated: null };
  let renderFn = null;
  const cur = () => (state.months ? state.months[state.mi] : null);
  const WD_FULL = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
  const WD_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  function weekday(m, d) { const [y, mo] = m.key.split('-').map(Number); const i = new Date(y, mo - 1, d).getDay(); return { full: WD_FULL[i], short: WD_SHORT[i], weekend: i === 0 || i === 6 }; }
  const H = { weekday, fmt, som, short, pct, esc, dailyChart, cumulativeChart, monthsChart, spark, ring, config: CONFIG };

  function draw() { document.getElementById('app').innerHTML = renderFn({ ...state, project: CONFIG.projects[state.pi], month: cur() }, H); }
  const ck = () => 'dash:' + CONFIG.projects[state.pi].id;
  const cacheSave = (months) => { try { localStorage.setItem(ck(), JSON.stringify({ t: Date.now(), months }, (k, v) => (k === 'prev' ? undefined : v))); } catch (e) {} };
  const cacheLoad = () => { try { return JSON.parse(localStorage.getItem(ck())); } catch (e) { return null; } };
  // load({silent:true}) refreshes in the background without flashing the loader
  async function load(opts) {
    const silent = opts && opts.silent === true && state.status === 'ready';
    if (!silent) { state.status = 'loading'; state.error = null; draw(); }
    state.loading = true;
    try {
      state.months = await loadProject(CONFIG.projects[state.pi]);
      state.status = 'ready'; state.offline = false; state.updated = new Date();
      if (state.mi >= state.months.length) state.mi = 0;
      cacheSave(state.months);
    } catch (e) {
      const c = cacheLoad();
      if (c && c.months) { state.months = c.months; state.status = 'ready'; state.offline = true; state.updated = new Date(c.t); if (state.mi >= state.months.length) state.mi = 0; }
      else if (!silent) { state.status = 'error'; state.error = e.message; }
    }
    state.loading = false;
    draw();
    return state.status;
  }
  function start(fn) {
    renderFn = fn;
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-project],[data-month],[data-refresh]'); if (!t) return;
      if (t.dataset.month != null) { state.mi = +t.dataset.month; draw(); }
      else if (t.dataset.project != null) { state.pi = +t.dataset.project; state.mi = 0; load(); }
      else load();
    });
    load();
    // refresh data when the app comes back to the foreground, and every 5 minutes while open
    const stale = (s) => !state.updated || Date.now() - state.updated.getTime() > s * 1000;
    document.addEventListener('visibilitychange', () => { if (!document.hidden && stale(60) && !state.loading) load({ silent: true }); });
    window.addEventListener('online', () => { if (state.offline) load({ silent: true }); });
    setInterval(() => { if (!document.hidden && stale(300) && !state.loading) load({ silent: true }); }, 60000);
  }
  window.Dash = { start, H, redraw: draw, cur, reload: load, state };
})();
