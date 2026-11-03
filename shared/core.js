/* Data layer. No external services: every day's numbers are entered in the app and stored
   on the device (localStorage). shared/seed.js holds a one-time snapshot of the old
   Google Sheet that is loaded the first time the app starts.

   Store shape per project:  { "YYYY-MM": { days: { "1": [found, spent], ... }, summary: null | {found, spent} } }
   - a month with daily rows gets its totals from the days
   - a month without daily rows (old data) keeps only a monthly summary
   day value: [found, spent, ts] (ts = ms of the last edit; [null, 0, ts] = cleared day). Used to merge devices.
   profit = found - spent                                                                         */
(function () {
  const CONFIG = {
    projects: [{ id: 'main', name: 'Учёт', currency: "so'm" }],
  };
  const RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const RUG = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const WD_FULL = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
  const WD_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

  /* ---------- storage ---------- */
  const mem = {};                                   // fallback when localStorage is blocked
  const SK = (p) => 'data:v1:' + p.id;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function loadStore(p) {
    if (mem[p.id]) return mem[p.id];
    let st = null;
    try { const raw = localStorage.getItem(SK(p)); if (raw) st = JSON.parse(raw); } catch (e) {}
    if (!st) { st = clone((window.SEED && window.SEED[p.id]) || {}); saveStore(p, st); }
    mem[p.id] = st;
    return st;
  }
  function saveStore(p, st) { mem[p.id] = st; try { localStorage.setItem(SK(p), JSON.stringify(st)); } catch (e) {} }
  const curProject = () => CONFIG.projects[state.pi];

  /* ---------- derive months ---------- */
  const nowKey = () => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0'); };
  function buildMonth(key, data) {
    const mo = +key.split('-')[1];
    const days = Object.keys((data && data.days) || {}).filter((d) => { const v = data.days[d]; return !(v[0] == null && !v[1]); }).map(Number).sort((a, b) => a - b).map((d) => {
      const [f, s] = data.days[d];
      return { d, hasFound: f != null, found: f || 0, spent: s || 0, diff: (f || 0) - (s || 0) };
    });
    let found, spent;
    if (days.length) { found = days.reduce((a, x) => a + x.found, 0); spent = days.reduce((a, x) => a + x.spent, 0); }
    else { const sm = (data && data.summary) || {}; found = sm.found || 0; spent = sm.spent || 0; }
    const summary = { found, spent, profit: found - spent };
    return {
      key, label: RU[mo - 1], gen: RUG[mo - 1], short: RU[mo - 1].slice(0, 3).toUpperCase(),
      info: true, summary, days, total: null,
      roi: spent ? summary.profit / spent : 0, adShare: found ? spent / found : 0,
    };
  }
  function buildMonths(p) {
    const st = loadStore(p);
    const keys = Array.from(new Set([...Object.keys(st), nowKey()])).sort().reverse();
    const months = keys.map((k) => buildMonth(k, st[k]));
    months.forEach((m, i) => {
      const prev = months[i + 1];
      m.prev = prev || null;
      m.delta = prev && prev.summary.profit ? (m.summary.profit - prev.summary.profit) / Math.abs(prev.summary.profit) : null;
    });
    return months;
  }

  /* ---------- edit data ---------- */
  function setDay(key, day, found, spent) {
    const p = curProject(), st = loadStore(p);
    if (!/^\d{4}-\d{2}$/.test(key) || !(day >= 1 && day <= 31)) throw new Error('bad day');
    if (!isFinite(found) || found < 0 || !isFinite(spent) || spent < 0) throw new Error('bad amount');
    const m = st[key] || (st[key] = { days: {}, summary: null });
    // a month that only had a monthly summary starts its own daily log from this entry
    const ts = Date.now(), v = [Math.round(found), Math.round(spent), ts];
    m.days = m.days || {}; m.days[String(day)] = v; m.summary = null;
    saveStore(p, st); emitPatch({ [key]: { days: { [String(day)]: v } } }); return load();
  }
  function clearDay(key, day) {
    const p = curProject(), st = loadStore(p);
    if (st[key] && st[key].days) {
      const v = [null, 0, Date.now()];                       // tombstone, so the deletion also reaches other devices
      st[key].days[String(day)] = v; saveStore(p, st); emitPatch({ [key]: { days: { [String(day)]: v } } });
    }
    return load();
  }
  function exportData() { const p = curProject(); return JSON.stringify({ app: 'dashboards', version: 1, exported: new Date().toISOString(), projects: { [p.id]: loadStore(p) } }, null, 1); }
  function importData(text) {
    let j; try { j = JSON.parse(text); } catch (e) { throw new Error('Это не файл с копией данных.'); }
    const p = curProject(), st = j && j.projects && j.projects[p.id];
    if (!st || typeof st !== 'object') throw new Error('В файле нет данных для этого приложения.');
    const clean = {};
    for (const k of Object.keys(st)) {
      if (!/^\d{4}-\d{2}$/.test(k)) continue;
      const m = st[k] || {}, days = {};
      for (const d of Object.keys(m.days || {})) {
        const v = m.days[d];
        if (+d >= 1 && +d <= 31 && Array.isArray(v) && (v[0] == null || isFinite(v[0])) && isFinite(v[1] || 0)) days[d] = [v[0] == null ? null : Math.round(v[0]), Math.round(v[1] || 0), isFinite(v[2]) ? v[2] : 0];
      }
      const sm = m.summary && isFinite(m.summary.found) && isFinite(m.summary.spent) ? { found: Math.round(m.summary.found), spent: Math.round(m.summary.spent) } : null;
      clean[k] = { days, summary: Object.keys(days).length ? null : sm };
    }
    if (!Object.keys(clean).length) throw new Error('В файле нет ни одного месяца.');
    saveStore(p, clean); return load();
  }

  /* ---------- sync with the cloud (see shared/sync.js) ---------- */
  let syncPush = null;
  function emitPatch(patch) { if (syncPush) { try { syncPush(patch); } catch (e) {} } }
  // Merge a remote copy into the local store, per day, newest edit wins.
  // Returns { changed, push } where push = entries that are newer locally (to upload).
  function mergeRemote(remote) {
    const p = curProject(), st = loadStore(p); let changed = false; const push = {};
    const put = (k, d, v) => { (push[k] = push[k] || { days: {} }).days[d] = v; };
    for (const k of Object.keys(remote || {})) {
      if (!/^\d{4}-\d{2}$/.test(k)) continue;
      const rm = remote[k] || {}, lm = st[k] || (st[k] = { days: {}, summary: null });
      lm.days = lm.days || {};
      for (const d of Object.keys(rm.days || {})) {
        const rv = rm.days[d]; if (!Array.isArray(rv)) continue;
        const lv = lm.days[d], rts = rv[2] || 0, lts = lv ? (lv[2] || 0) : -1;
        if (!lv || rts > lts) { lm.days[d] = rv; changed = true; if (lm.summary) lm.summary = null; }
        else if (lts > rts) put(k, d, lv);
      }
      if (!Object.keys(lm.days).length && !lm.summary && rm.summary) { lm.summary = rm.summary; changed = true; }
    }
    for (const k of Object.keys(st)) {                       // local entries the cloud does not have yet
      const rm = (remote && remote[k]) || {};
      for (const d of Object.keys(st[k].days || {})) if (!(rm.days && rm.days[d])) put(k, d, st[k].days[d]);
      if (st[k].summary && !(rm.summary) && !Object.keys(st[k].days || {}).length) (push[k] = push[k] || { days: {} }).summary = st[k].summary;
    }
    if (changed) { saveStore(p, st); load(); }
    return { changed, push: Object.keys(push).length ? push : null };
  }
  const setSyncPush = (fn) => { syncPush = fn; };
  const allLocal = () => clone(loadStore(curProject()));

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
  function weekday(m, d) { const [y, mo] = m.key.split('-').map(Number); const i = new Date(y, mo - 1, d).getDay(); return { full: WD_FULL[i], short: WD_SHORT[i], weekend: i === 0 || i === 6 }; }

  /* ---------- app runtime ---------- */
  // Dash.start(renderFn): renderFn(state, H) returns HTML for #app.
  // Click targets: [data-month="i"]
  const state = { pi: 0, mi: 0, months: null, status: 'loading', error: null, updated: null, offline: false };
  let renderFn = null;
  const cur = () => (state.months ? state.months[state.mi] : null);
  const H = { weekday, fmt, som, short, pct, esc, config: CONFIG };

  let needsDraw = false;
  function draw() { needsDraw = false; document.getElementById('app').innerHTML = renderFn({ ...state, project: curProject(), month: cur() }, H); }
  function load() {
    try {
      const keep = cur() && cur().key;
      state.months = buildMonths(curProject());
      const i = keep ? state.months.findIndex((m) => m.key === keep) : -1;
      state.mi = i >= 0 ? i : 0;
      state.status = 'ready'; state.error = null; state.updated = new Date();
    } catch (e) { state.status = 'error'; state.error = e.message; }
    if (window.Dash && window.Dash.canRedraw && !window.Dash.canRedraw()) needsDraw = true; else draw();
    return Promise.resolve(state.status);
  }
  function start(fn) {
    renderFn = fn;
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-month]'); if (!t) return;
      state.mi = +t.dataset.month; draw();
    });
    load();
    // a new day or month may have started while the app was in the background
    let day = new Date().getDate();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && new Date().getDate() !== day) { day = new Date().getDate(); state.mi = 0; load(); } });
  }
  window.Dash = { start, H, redraw: draw, cur, reload: load, state, setDay, clearDay, exportData, importData, mergeRemote, setSyncPush, allLocal };
})();
