// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane
// spur web app. Runs and settings live on your spur server; this file only
// draws them and sends your changes back.
'use strict';

/* Fill these in to show the matching buttons in Settings. */
const LINKS = {
  donate: '', // e.g. 'https://buymeacoffee.com/yourname'
  source: '', // e.g. 'https://codeberg.org/yourname/spur'
};

const MI = 1.609344, DAY = 864e5;
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- dates (whole days, UTC) ---------- */
const pad = (n) => String(n).padStart(2, '0');
const dn = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const today = () => dn(localToday());
const fd = (n, o) => new Date(n * DAY).toLocaleDateString(undefined, Object.assign({ timeZone: 'UTC' }, o));
const dow = (n) => (new Date(n * DAY).getUTCDay() + 6) % 7;
const weekStart = (n) => n - dow(n);

/* ---------- state ---------- */
const DEFAULTS = { unit: 'km', metric: 'pace', palette: 'tartan', mode: 'system', goal: null, range: '3M', smoothing: 'medium', volume: 'distance' };
const state = { user: null, runs: [], settings: { ...DEFAULTS }, version: '', auth: null, signupMode: false, sort: { key: 'date', dir: -1 }, year: 'all' };

/* ---------- server ---------- */
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-Spur': '1' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    $('#offline').hidden = false;
    throw new Error("Can't reach your spur server. Check your connection and try again.");
  }
  $('#offline').hidden = true;
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && state.user && !path.startsWith('/api/login')) {
    state.user = null;
    showAuth();
  }
  if (!res.ok) throw new Error(data.error || `The server answered with an error (${res.status}).`);
  return data;
}

function cacheSettings() {
  try { localStorage.setItem('spur.settings', JSON.stringify(state.settings)); } catch {}
}
function cachedSettings() {
  try { return JSON.parse(localStorage.getItem('spur.settings') || '{}'); } catch { return {}; }
}

function saveSettings(patch) {
  Object.assign(state.settings, patch);
  cacheSettings();
  render();
  api('PUT', '/api/settings', patch).catch((e) => toast(e.message));
}

/* ---------- units + formatting ---------- */
const U = () => state.settings.unit;
const toUnit = (km) => (U() === 'mi' ? km / MI : km);
const fromUnit = (v) => (U() === 'mi' ? v * MI : v);
const uName = () => (U() === 'mi' ? 'mi' : 'km');
const sName = () => (U() === 'mi' ? 'mph' : 'km/h');
const paceU = (pk) => (U() === 'mi' ? pk * MI : pk);
const speedU = (pk) => toUnit(3600 / pk);
const fmtMS = (sec) => { sec = Math.round(sec); return Math.floor(sec / 60) + ':' + pad(sec % 60); };
const fmtDur = (sec) => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`; };
const fmtDist = (km) => { const v = toUnit(km); return v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2); };
const isPace = () => state.settings.metric === 'pace';
const metricVal = (pk) => (isPace() ? paceU(pk) : speedU(pk));
const metricFmt = (v) => (isPace() ? fmtMS(v) : v.toFixed(1));
const metricUnit = () => (isPace() ? '/' + uName() : sName());

/* ---------- analysis ---------- */
// Smoothing: a one-sided Gaussian kernel over past days. The strength is the
// kernel width in days; "off" shows the raw numbers.
const SMOOTHING = { off: 0, soft: 5, medium: 10, strong: 20 };
const SMOOTHING_NAME = { off: 'Off', soft: 'Soft', medium: 'Medium', strong: 'Strong' };
const sigma = () => SMOOTHING[state.settings.smoothing] ?? 10;
const smoothingOn = () => sigma() > 0;
const gapLimit = (sig) => Math.max(21, 2.5 * sig); // no trend after this many days without a run
const points = () => state.runs.map((r) => ({ t: dn(r.date), v: r.sec / r.km, r })).sort((a, b) => a.t - b.t);
function smoothAt(t, pts, sig = sigma()) {
  // Only runs on or before day t count, so the trend never looks ahead.
  let sw = 0, sv = 0, near = 1e9, latest = null;
  for (const p of pts) {
    if (p.t > t) break;
    const d = t - p.t;
    near = d; latest = p.v;
    if (sig === 0 || d > 4 * sig) continue;
    const w = Math.exp((-d * d) / (2 * sig * sig));
    sw += w; sv += w * p.v;
  }
  if (near > gapLimit(sig)) return null;
  if (sig === 0) return latest; // off: the most recent run as it was
  return sw > 1e-6 ? sv / sw : null;
}
function linSlope(xs, ys) {
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let nu = 0, de = 0;
  xs.forEach((x, i) => { nu += (x - mx) * (ys[i] - my); de += (x - mx) ** 2; });
  return de ? nu / de : null;
}
function analysis() {
  const pts = points();
  if (!pts.length) return { pts };
  const last = pts[pts.length - 1].t, tNow = today(); // after a long break there is no trend until you run again
  const now = smoothAt(tNow, pts), then = smoothAt(tNow - 30, pts);
  // Six-week slope, for the goal forecast: of the trend, or of the runs themselves when smoothing is off.
  let slope = null;
  if (smoothingOn()) {
    const xs = [], ys = [];
    for (let t = tNow - 41; t <= tNow; t++) { const v = smoothAt(t, pts); if (v != null) { xs.push(t); ys.push(v); } }
    if (xs.length >= 14) slope = linSlope(xs, ys);
  } else {
    const recent = pts.filter((p) => p.t > tNow - 42);
    if (recent.length >= 4) slope = linSlope(recent.map((p) => p.t), recent.map((p) => p.v));
  }
  return { pts, last, tNow, now, then, slope };
}

/* volume: distance (km) or time (hours) per week */
const volIsTime = () => state.settings.volume === 'time';
const volUnit = () => (volIsTime() ? 'h' : uName());
const volOfRun = (r) => (volIsTime() ? r.sec / 3600 : toUnit(r.km));
const fmtVol = (v) => (volIsTime() ? v.toFixed(1) : v >= 100 ? v.toFixed(0) : v.toFixed(1));
function dailyVolume() {
  const m = new Map();
  for (const r of state.runs) { const d = dn(r.date); m.set(d, (m.get(d) || 0) + volOfRun(r)); }
  const first = state.runs.length ? Math.min(...m.keys()) : null;
  return { m, first };
}
/** Total for the 7 days ending on day t (the raw weekly volume, free of the day-of-week rhythm). */
function last7(t, m) { let sum = 0; for (let d = 0; d < 7; d++) sum += m.get(t - d) || 0; return sum; }
/** Volume per week on day t: the rolling 7-day total, smoothed over past days with the chosen strength (off: as it is). */
function volumeAt(t, daily, sig = sigma()) {
  const { m, first } = daily;
  if (first == null || t < first) return null;
  if (sig === 0) return last7(t, m);
  let sw = 0, sv = 0;
  const reach = Math.min(Math.ceil(4 * sig), t - first);
  for (let d = 0; d <= reach; d++) { const w = Math.exp((-d * d) / (2 * sig * sig)); sw += w; sv += w * last7(t - d, m); }
  return sv / sw;
}
function weekly() { const m = new Map(); for (const r of state.runs) { const w = weekStart(dn(r.date)); m.set(w, (m.get(w) || 0) + r.km); } return m; }
function streak(wk) { let w = weekStart(today()); if (!wk.has(w)) w -= 7; let c = 0; while (wk.has(w)) { c++; w -= 7; } return c; }
function riegel() {
  const pts = points();
  if (!pts.length) return null;
  const end = pts[pts.length - 1].t, pool = pts.filter((p) => p.t >= end - 90 && p.r.km >= 3);
  if (!pool.length) return null;
  let best = null, bestT = Infinity;
  for (const p of pool) { const t10 = p.r.sec * Math.pow(10 / p.r.km, 1.06); if (t10 < bestT) { bestT = t10; best = p.r; } }
  return { base: best, at: (D) => best.sec * Math.pow(D / best.km, 1.06) };
}

/* ---------- theme ---------- */
const PALETTES = [['tartan', 'Tartan', 'hsl(12 70% 48%)'], ['trail', 'Trail', 'hsl(152 42% 40%)'], ['lake', 'Lake', 'hsl(208 62% 46%)'], ['golden', 'Golden hour', 'hsl(36 88% 50%)']];
function applyTheme() {
  const r = document.documentElement, s = state.settings;
  if (s.palette === 'tartan') r.removeAttribute('data-palette'); else r.setAttribute('data-palette', s.palette);
  if (s.mode === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', s.mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(r).getPropertyValue('--accent').trim() || '#C4492F';
}
const logo = (sz) => `<svg width="${sz}" height="${sz}" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="14" fill="var(--accent)"/><ellipse cx="17" cy="31" rx="4.5" ry="7.5" transform="rotate(-18 17 31)" fill="var(--on-accent)"/><ellipse cx="31" cy="17" rx="4.5" ry="7.5" transform="rotate(-18 31 17)" fill="var(--on-accent)"/><circle cx="13" cy="21" r="1.6" fill="var(--on-accent)" opacity=".6"/><circle cx="35" cy="27" r="1.6" fill="var(--on-accent)" opacity=".6"/></svg>`;

/* ---------- charts ---------- */
function niceStep(span, steps) { for (const s of steps) if (span / s <= 5) return s; return steps[steps.length - 1]; }
function chartRange(a) {
  const rd = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365 }[state.settings.range];
  const t1 = Math.max(today(), a.last);
  return { t0: rd ? t1 - rd : a.pts[0].t - 3, t1 };
}
function timeTicks(t0, t1) {
  const span = t1 - t0, ticks = [];
  if (span <= 45) { for (let t = weekStart(t0) + 7; t <= t1; t += 7) ticks.push([t, fd(t, { day: 'numeric', month: 'short' })]); return ticks; }
  const d0 = new Date(t0 * DAY); let yy = d0.getUTCFullYear(), mm = d0.getUTCMonth() + 1, i = 0;
  const every = span > 500 ? 3 : span > 200 ? 2 : 1;
  for (;;) { if (mm > 11) { mm = 0; yy++; } const t = Math.round(Date.UTC(yy, mm, 1) / DAY); if (t > t1) break; if (i++ % every === 0) ticks.push([t, fd(t, span > 300 ? { month: 'short', year: '2-digit' } : { month: 'short' })]); mm++; }
  return ticks;
}
function paceChart() {
  const el = $('#paceChart'), a = analysis(), s = state.settings, pace = isPace();
  $('#chartTitle').textContent = pace ? 'Pace over time' : 'Speed over time';
  if (!a.pts.length) { el.innerHTML = '<div class="empty">No runs yet. Tap <b>Log run</b> to add your first.</div>'; return; }
  const W = Math.max(280, el.clientWidth || 320), H = W >= 640 ? Math.round(Math.min(380, Math.max(260, W * 0.4))) : Math.round(Math.min(260, Math.max(200, W * 0.52)));
  const P = { l: 42, r: 14, t: 16, b: 26 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
  const { t0, t1 } = chartRange(a);
  const inR = a.pts.filter((p) => p.t >= t0 && p.t <= t1);
  const sm = [];
  for (let t = t0; t <= t1; t++) { const v = smoothAt(t, a.pts); sm.push(v == null ? null : { t, v: metricVal(v) }); }
  const vals = inR.map((p) => metricVal(p.v)).concat(sm.filter(Boolean).map((p) => p.v));
  const goalV = s.goal ? metricVal(s.goal) : null;
  if (goalV != null) vals.push(goalV);
  if (!inR.length && !sm.some(Boolean)) { el.innerHTML = '<div class="empty">No runs in this range. Try a longer one.</div>'; $('#goalLegend').hidden = true; return; }
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const step = pace ? niceStep(hi - lo, [10, 15, 20, 30, 60, 120, 300]) : niceStep(hi - lo, [0.25, 0.5, 1, 2, 5, 10]);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (hi <= lo) hi = lo + step;
  const x = (t) => P.l + ((t - t0) / Math.max(1, t1 - t0)) * iw;
  const y = (v) => (pace ? P.t + ((v - lo) / (hi - lo)) * ih : P.t + ((hi - v) / (hi - lo)) * ih);
  let g = '';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    const yy = y(v).toFixed(1);
    g += `<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}" stroke-dasharray="${v === lo || v >= hi - 1e-9 ? '' : '2 4'}"/><text x="${P.l - 6}" y="${+yy + 4}" text-anchor="end">${metricFmt(v)}</text>`;
  }
  for (const [t, l] of timeTicks(t0, t1)) {
    const xx = x(t);
    if (xx < P.l + 12 || xx > W - P.r - 12) continue;
    g += `<line class="axis" x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${H - P.b}" y2="${H - P.b + 4}"/><text x="${xx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`;
  }
  g += `<text x="${P.l + 4}" y="${P.t - 4}" style="font-size:10.5px;letter-spacing:.06em">▲ FASTER</text>`;
  if (goalV != null) {
    const gy = y(goalV).toFixed(1);
    g += `<line x1="${P.l}" x2="${W - P.r}" y1="${gy}" y2="${gy}" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="6 5"/><text x="${W - P.r}" y="${+gy - 5}" text-anchor="end" style="fill:var(--fg);font-weight:600">goal ${metricFmt(goalV)}</text>`;
  }
  for (const p of inR) {
    const v = metricVal(p.v);
    g += `<circle cx="${x(p.t).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${p.r.km >= 10 ? 4 : 3}" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.4"><title>${esc(fd(p.t, { weekday: 'short', day: 'numeric', month: 'short' }))}: ${fmtDist(p.r.km)} ${uName()} · ${metricFmt(v)} ${metricUnit()}</title></circle>`;
  }
  let d = '', prev = null;
  if (smoothingOn()) {
    for (const p of sm) { if (!p) { prev = null; continue; } d += (prev ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1); prev = p; }
    if (d) g += `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".18"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    const end = [...sm].reverse().find(Boolean);
    if (end) g += `<circle cx="${x(end.t).toFixed(1)}" cy="${y(end.v).toFixed(1)}" r="6" fill="var(--accent)" stroke="var(--surface)" stroke-width="2.5"/>`;
  } else {
    // Smoothing off: join the runs as they are, breaking the line across long gaps.
    for (const p of inR) { d += (prev && p.t - prev.t <= gapLimit(0) ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(metricVal(p.v)).toFixed(1); prev = p; }
    if (d) g += `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round" opacity=".75"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${pace ? 'Pace' : 'Speed'} per run${smoothingOn() ? ' with smoothed trend' : ''}">${g}</svg>`;
  $('#goalLegend').hidden = goalV == null;
  $('#trendLegend').textContent = smoothingOn() ? `Trend · ${SMOOTHING_NAME[state.settings.smoothing].toLowerCase()} smoothing` : 'Runs joined, no smoothing';
}
function volumeChart(a) {
  const el = $('#volChart'), daily = dailyVolume(), cur = weekStart(today());
  const { t0, t1 } = chartRange(a);
  const W = Math.max(280, el.clientWidth || 320), H = W >= 640 ? Math.round(Math.min(300, Math.max(220, W * 0.32))) : 190;
  const P = { l: 42, r: 14, t: 16, b: 26 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
  // Calendar weeks (Monday to Sunday) that overlap the range.
  const weeks = [];
  for (let w = weekStart(t0); w <= t1; w += 7) { let v = 0; for (let d = 0; d < 7; d++) v += daily.m.get(w + d) || 0; weeks.push([w, v]); }
  const trend = [];
  if (smoothingOn()) for (let t = t0; t <= t1; t++) { const v = volumeAt(t, daily); trend.push(v == null ? null : { t, v }); }
  const vals = weeks.map((w) => w[1]).concat(trend.filter(Boolean).map((p) => p.v));
  const step = niceStep(Math.max(...vals, 1), volIsTime() ? [0.5, 1, 2, 3, 5, 10] : [5, 10, 20, 25, 50, 100]);
  const hi = Math.max(step, Math.ceil(Math.max(...vals, 0.0001) / step) * step);
  const x = (t) => P.l + ((t - t0) / Math.max(1, t1 - t0)) * iw;
  const y = (v) => P.t + ((hi - v) / hi) * ih;
  let g = '';
  for (let v = 0; v <= hi + 1e-9; v += step) {
    const yy = y(v).toFixed(1);
    g += `<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}" stroke-dasharray="${v === 0 ? '' : '2 4'}"/><text x="${P.l - 6}" y="${+yy + 4}" text-anchor="end">${v % 1 ? v.toFixed(1) : v}</text>`;
  }
  for (const [t, l] of timeTicks(t0, t1)) {
    const xx = x(t);
    if (xx < P.l + 12 || xx > W - P.r - 12) continue;
    g += `<line class="axis" x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${H - P.b}" y2="${H - P.b + 4}"/><text x="${xx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`;
  }
  g += `<text x="${P.l + 4}" y="${P.t - 4}" style="font-size:10.5px;letter-spacing:.06em">${volUnit().toUpperCase()} / WEEK</text>`;
  const dayW = iw / Math.max(1, t1 - t0);
  for (const [w, v] of weeks) {
    const xa = Math.max(P.l, x(w) + dayW * 0.6), xb = Math.min(W - P.r, x(w + 7) - dayW * 0.6);
    if (v <= 0 || xb - xa < 1) continue;
    const isCur = w === cur, top = y(v);
    g += `<rect x="${xa.toFixed(1)}" y="${top.toFixed(1)}" width="${(xb - xa).toFixed(1)}" height="${(H - P.b - top).toFixed(1)}" rx="${Math.min(4, (xb - xa) / 3).toFixed(1)}" fill="${isCur ? 'var(--accent)' : 'var(--accent-soft)'}" stroke="${isCur ? 'none' : 'var(--accent)'}" stroke-opacity=".55" stroke-width="1"><title>Week of ${esc(fd(w, { day: 'numeric', month: 'short' }))}${isCur ? ' (so far)' : ''}: ${fmtVol(v)} ${volUnit()}</title></rect>`;
  }
  if (trend.length) {
    let d = '', prev = null;
    for (const p of trend) { if (!p) { prev = null; continue; } d += (prev ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1); prev = p; }
    if (d) g += `<path d="${d}" fill="none" stroke="var(--surface)" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/><path d="${d}" fill="none" stroke="var(--fg)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    const end = [...trend].reverse().find(Boolean);
    if (end) g += `<circle cx="${x(end.t).toFixed(1)}" cy="${y(end.v).toFixed(1)}" r="5" fill="var(--fg)" stroke="var(--surface)" stroke-width="2.5"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${volIsTime() ? 'Running time' : 'Distance'} per week${smoothingOn() ? ' with smoothed volume trend' : ''}">${g}</svg>`;
  $('#volTrendLegend').hidden = !smoothingOn();
  $('#volBarsLegend').textContent = `${volIsTime() ? 'Time' : 'Distance'} each week`;

  // Headline: smoothed volume now vs four weeks ago (or the plain last 7 days when smoothing is off).
  const vNow = volumeAt(today(), daily), vThen = volumeAt(today() - 28, daily);
  $('#volLabel').textContent = smoothingOn() ? 'Volume trend' : 'Last 7 days';
  $('#volBig').innerHTML = vNow == null ? '–' : `${fmtVol(vNow)}<small>${volUnit()}/week</small>`;
  const vc = $('#volChange');
  if (vNow == null || vThen == null) { vc.textContent = 'Needs about a month of runs to compare'; }
  else if (vThen <= 0) { vc.textContent = vNow > 0 ? 'Up from nothing 4 weeks ago' : 'No running in the last weeks'; }
  else {
    const pct = Math.round((vNow / vThen - 1) * 100);
    vc.textContent = Math.abs(pct) < 5 ? 'About the same as 4 weeks ago' : `${pct > 0 ? '▲ +' : '▼ '}${pct}% vs 4 weeks ago`;
  }

  // Load check: this calendar week against the three before it.
  const wkKm = weekly(), thisW = wkKm.get(cur) || 0, avg = [1, 2, 3].reduce((acc, i) => acc + (wkKm.get(cur - 7 * i) || 0), 0) / 3;
  const chip = $('#loadChip'), txt = $('#loadText');
  if (avg <= 0) { chip.className = 'chip flat'; chip.textContent = 'Building base'; txt.textContent = 'Once you have three weeks logged, spur compares each week with your recent average.'; }
  else if (thisW > avg * 1.1) {
    const pct = Math.round((thisW / avg - 1) * 100);
    chip.className = 'chip warn'; chip.textContent = `+${pct}% vs 3-wk avg`;
    txt.textContent = `This week is ${pct}% above your recent average of ${toUnit(avg).toFixed(1)} ${uName()}. Big jumps in weekly distance are a common cause of running injuries, so build up gradually.`;
  } else {
    chip.className = 'chip good'; chip.textContent = 'Load steady';
    txt.textContent = `${toUnit(thisW).toFixed(1)} ${uName()} so far this week, against a 3-week average of ${toUnit(avg).toFixed(1)} ${uName()}.`;
  }
}

/* ---------- views ---------- */
function renderOverview() {
  const empty = !state.runs.length;
  $('#welcome').hidden = !empty;
  $('#overviewBody').hidden = empty;
  if (empty) return;
  const a = analysis(), s = state.settings;
  $('#sampleBanner').hidden = !state.runs.some((r) => r.sample);
  $('#bibDate').textContent = fd(today(), { day: 'numeric', month: 'short', year: 'numeric' });
  $('#bibLabel').textContent = (smoothingOn() ? 'Trend ' : 'Latest ') + (isPace() ? 'pace' : 'speed');
  const big = $('#bibBig'), chip = $('#bibChip');
  if (a.now == null) { big.textContent = '–'; chip.className = 'chip flat'; chip.textContent = 'No runs in the last few weeks'; }
  else {
    big.innerHTML = `${metricFmt(metricVal(a.now))}<small>${metricUnit()}</small>`;
    if (a.then == null) { chip.className = 'chip flat'; chip.textContent = 'The trend needs about a month of runs'; }
    else {
      const faster = paceU(a.then) - paceU(a.now);
      if (Math.abs(faster) < 3) { chip.className = 'chip flat'; chip.textContent = 'About the same as 30 days ago'; }
      else if (faster > 0) { chip.className = 'chip good'; chip.textContent = `▲ ${fmtMS(faster)} /${uName()} faster than 30 days ago`; }
      else { chip.className = 'chip warn'; chip.textContent = `▼ ${fmtMS(-faster)} /${uName()} slower than 30 days ago`; }
    }
  }
  $$('#rangeSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === s.range));
  $$('#smoothSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === s.smoothing));
  $$('#volSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === s.volume));
  paceChart();
  const gt = $('#goalText');
  $('#editGoal').textContent = s.goal ? 'Change' : 'Set goal';
  const goalTxt = s.goal ? `<b class="num">${fmtMS(paceU(s.goal))} /${uName()}</b>` : '';
  if (!s.goal) gt.textContent = 'Set a target pace and spur will estimate when your trend reaches it.';
  else if (a.now == null) gt.innerHTML = `Goal ${goalTxt}. Log a few runs to get a forecast.`;
  else if (a.now <= s.goal) gt.innerHTML = `Goal ${goalTxt} reached. Your trend is ${fmtMS(paceU(s.goal - a.now))} under it. Time for a new one?`;
  else {
    const gap = fmtMS(paceU(a.now - s.goal));
    if (a.slope != null && a.slope < -0.02) {
      const days = Math.ceil((s.goal - a.now) / a.slope), when = a.tNow + days;
      gt.innerHTML = `Goal ${goalTxt}, ${gap} to go. At your 6-week trend you would get there around <b>${esc(fd(when, { day: 'numeric', month: 'long', year: 'numeric' }))}</b>${days > 365 ? ' (a long way out, so treat it loosely)' : ''}.`;
    } else gt.innerHTML = `Goal ${goalTxt}, ${gap} to go. Your trend is not getting faster right now, so there is no forecast yet.`;
  }
  renderGoalMeter(a);
  volumeChart(a);
  renderKpis();
  const recent = sortRuns(state.runs, { key: 'date', dir: -1 }).slice(0, isWide() ? 8 : 5);
  $('#recent').innerHTML = isWide() ? runsTable(recent, { sortable: false, group: false }) : `<div class="list">${recent.map(rowButton).join('')}</div>`;
}
function renderGoalMeter(a) {
  const el = $('#goalMeter'), goal = state.settings.goal;
  if (!goal || a.now == null) { el.hidden = true; return; }
  // Progress from the trend 12 weeks back (or the earliest trend there is) towards the goal.
  let start = null, startDay = null;
  for (let t = a.tNow - 84; t < a.tNow; t++) { const v = smoothAt(t, a.pts); if (v != null) { start = v; startDay = t; break; } }
  const span = start != null ? start - goal : 0;
  const pct = a.now <= goal ? 100 : span > 0 ? Math.max(0, Math.min(100, Math.round(((start - a.now) / span) * 100))) : 0;
  const weeks = startDay != null ? Math.round((a.tNow - startDay) / 7) : 0;
  el.hidden = false;
  el.innerHTML = `<div class="gm-nums num"><span><small>${smoothingOn() ? 'Trend now' : 'Latest'}</small><b>${fmtMS(paceU(a.now))}</b></span><span class="gm-arrow" aria-hidden="true">→</span><span><small>Goal</small><b>${fmtMS(paceU(goal))}</b></span><span class="gm-unit">/${uName()}</span></div>`
    + `<div class="gm-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Progress towards your goal"><i style="width:${pct}%"></i></div>`
    + `<div class="gm-foot num"><span>${start != null && weeks >= 2 ? `${weeks} weeks ago: ${fmtMS(paceU(start))} /${uName()}` : 'Progress since your trend began'}</span><span>${pct}% of the way</span></div>`;
}
function renderKpis() {
  const wk = weekly(), cur = weekStart(today()), t = today();
  const sumKm = (rs) => rs.reduce((a, r) => a + r.km, 0);
  const thisW = wk.get(cur) || 0, lastW = wk.get(cur - 7) || 0;
  const weekRuns = state.runs.filter((r) => dn(r.date) >= cur).length;
  const last28 = sumKm(state.runs.filter((r) => dn(r.date) > t - 28));
  const prev28 = sumKm(state.runs.filter((r) => { const d = dn(r.date); return d <= t - 28 && d > t - 56; }));
  const month = state.runs.filter((r) => r.date.startsWith(localToday().slice(0, 7)));
  const st = streak(wk);
  const d28 = prev28 > 0 ? Math.round((last28 / prev28 - 1) * 100) : null;
  const k = [
    ['This week', toUnit(thisW).toFixed(1), uName(), `${weekRuns} ${weekRuns === 1 ? 'run' : 'runs'} · last week ${toUnit(lastW).toFixed(1)} ${uName()}`],
    ['Last 4 weeks', toUnit(last28).toFixed(1), uName(), d28 == null ? 'Nothing earlier to compare with' : `${d28 >= 0 ? '+' : ''}${d28}% on the 4 weeks before`],
    ['This month', month.length, month.length === 1 ? 'run' : 'runs', `${fmtDist(sumKm(month))} ${uName()} so far`],
    ['Weekly streak', st, st === 1 ? 'week' : 'weeks', st ? 'Weeks in a row with a run' : 'Run this week to start one'],
  ];
  $('#kpis').innerHTML = k.map(([label, v, u, d]) => `<div class="kpi"><span class="k">${label}</span><span class="v num">${esc(v)}<small>${esc(u)}</small></span><span class="d num">${esc(d)}</span></div>`).join('');
}

/* ---------- run lists and tables ---------- */
const isWide = () => window.matchMedia('(min-width: 960px)').matches;
function sortRuns(runs, sort = state.sort) {
  const val = {
    date: (r) => r.date + '|' + r.id,
    km: (r) => r.km,
    sec: (r) => r.sec,
    pace: (r) => r.sec / r.km,
    speed: (r) => r.km / r.sec,
  }[sort.key];
  return [...runs].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
}
function rowButton(r) {
  const n = dn(r.date);
  return `<button class="row" type="button" data-id="${esc(r.id)}"><span class="d">${esc(fd(n, { weekday: 'short' }))}<b class="num">${new Date(n * DAY).getUTCDate()}</b></span><span class="km num">${fmtDist(r.km)}<small>${uName()}</small>${r.sample ? '<span class="tag">sample</span>' : ''}</span><span class="meta num"><b>${fmtMS(paceU(r.sec / r.km))} /${uName()}</b>${fmtDur(r.sec)} · ${speedU(r.sec / r.km).toFixed(1)} ${sName()}</span></button>`;
}
function runsTable(runs, { sortable, group }) {
  const cols = [['date', 'Date', ''], ['km', 'Distance', 'r'], ['sec', 'Time', 'r'], ['pace', 'Pace', 'r'], ['speed', 'Speed', 'r']];
  const head = cols.map(([key, label, cls]) => {
    if (!sortable) return `<th class="${cls}">${label}</th>`;
    const active = state.sort.key === key;
    const arrow = active ? (state.sort.dir < 0 ? '↓' : '↑') : '';
    return `<th class="${cls}"${active ? ` aria-sort="${state.sort.dir < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button" data-sort="${key}">${label}<span aria-hidden="true">${arrow}</span></button></th>`;
  }).join('');
  const thisYear = localToday().slice(0, 4);
  const row = (r) => {
    const n = dn(r.date), pk = r.sec / r.km;
    const date = fd(n, { weekday: 'short', day: 'numeric', month: 'short', ...(group || r.date.startsWith(thisYear) ? {} : { year: 'numeric' }) });
    return `<tr data-id="${esc(r.id)}" tabindex="0"><td>${esc(date)}${r.sample ? '<span class="tag">sample</span>' : ''}</td><td class="r dist">${fmtDist(r.km)} <small class="muted">${uName()}</small></td><td class="r">${fmtDur(r.sec)}</td><td class="r pace">${fmtMS(paceU(pk))} /${uName()}</td><td class="r muted">${speedU(pk).toFixed(1)} ${sName()}</td><td class="chev" aria-hidden="true">›</td></tr>`;
  };
  let body = '';
  if (group) {
    let month = null;
    const totals = new Map();
    for (const r of runs) { const k = r.date.slice(0, 7); const t = totals.get(k) || { n: 0, km: 0 }; t.n++; t.km += r.km; totals.set(k, t); }
    for (const r of runs) {
      const k = r.date.slice(0, 7);
      if (k !== month) {
        month = k;
        const t = totals.get(k);
        body += `<tr class="grp"><td colspan="6">${esc(fd(dn(k + '-01'), { month: 'long', year: 'numeric' }))}<span class="num">${t.n} ${t.n === 1 ? 'run' : 'runs'} · ${fmtDist(t.km)} ${uName()}</span></td></tr>`;
      }
      body += row(r);
    }
  } else body = runs.map(row).join('');
  return `<div class="tbl-wrap"><table class="runs-table num"><thead><tr>${head}<th class="chev"><span class="visually-hidden">Edit</span></th></tr></thead><tbody>${body}</tbody></table></div>`;
}
function renderSideWeek() {
  const cur = weekStart(today()), days = new Set(state.runs.map((r) => dn(r.date)));
  const km = state.runs.filter((r) => dn(r.date) >= cur).reduce((a, r) => a + r.km, 0);
  const marks = [0, 1, 2, 3, 4, 5, 6].map((i) => `<i class="${days.has(cur + i) ? 'on' : ''}${cur + i === today() ? ' today' : ''}" title="${esc(fd(cur + i, { weekday: 'long' }))}${days.has(cur + i) ? ': ran' : ''}"></i>`).join('');
  $('#sideWeek').innerHTML = `<span class="k">This week</span><span class="v num">${toUnit(km).toFixed(1)}<small>${uName()}</small></span><span class="bar7">${marks}</span>`;
}
function renderStats() {
  const runs = state.runs, wk = weekly(), tot = runs.reduce((a, r) => a + r.km, 0), longest = runs.reduce((m, r) => Math.max(m, r.km), 0);
  const fastest = runs.filter((r) => r.km >= 3).reduce((m, r) => Math.min(m, r.sec / r.km), Infinity);
  const cur = weekStart(today());
  let last8 = 0;
  for (let i = 1; i <= 8; i++) last8 += wk.get(cur - 7 * i) || 0;
  const totalSec = runs.reduce((a, r) => a + r.sec, 0), st = streak(wk);
  const tiles = [
    [fmtDist(tot), uName(), 'Total distance'], [runs.length, '', 'Runs logged'],
    [toUnit(last8 / 8).toFixed(1), uName(), 'Weekly average, last 8 weeks'], [fmtDist(longest), uName(), 'Longest run'],
    [isFinite(fastest) ? fmtMS(paceU(fastest)) : '–', '/' + uName(), 'Fastest pace (3 km+)'], [st, st === 1 ? 'week' : 'weeks', 'Current weekly streak'],
    [Math.round(totalSec / 3600), 'h', 'Time on your feet'], [runs.length ? fmtDist(tot / runs.length) : '–', uName(), 'Average run'],
  ];
  $('#tiles').innerHTML = tiles.map(([v, u, k]) => `<div class="tile"><div class="v num">${esc(v)}<small>${esc(u)}</small></div><div class="k">${esc(k)}</div></div>`).join('');
  const R = riegel(), tb = $('#predTable'), note = $('#predNote');
  if (!R) { tb.innerHTML = ''; note.textContent = 'Log a run of 3 km or more to get race-time estimates.'; }
  else {
    const races = [['5K', 5], ['10K', 10], ['Half marathon', 21.0975], ['Marathon', 42.195]];
    tb.innerHTML = '<tr><th>Race</th><th class="r">Time</th><th class="r">Pace</th></tr>' + races.map(([n, D]) => { const t = R.at(D); return `<tr><td>${n}</td><td class="r t">${fmtDur(t)}</td><td class="r muted">${fmtMS(paceU(t / D))} /${uName()}</td></tr>`; }).join('');
    note.textContent = `Estimated with Riegel's formula from your strongest recent effort: ${fmtDist(R.base.km)} ${uName()} in ${fmtDur(R.base.sec)} on ${fd(dn(R.base.date), { day: 'numeric', month: 'short' })}. Long-distance estimates assume you have trained for the distance.`;
  }
  const fastOn = (x) => runs.some((r) => r.km >= 5 && r.sec / r.km < x);
  const B = [
    ['1', 'First steps', 'Log your first run', runs.length > 0], ['5', '5K club', 'A run of 5 km or more', longest >= 5],
    ['10', 'Double digits', 'A run of 10 km or more', longest >= 10], ['21', 'Half way', 'A half-marathon distance', longest >= 21.0975],
    ['42', 'The full story', 'A marathon distance', longest >= 42.195], ['100', 'Century', '100 km in total', tot >= 100],
    ['500', 'Long road', '500 km in total', tot >= 500], ['4w', 'Habit', '4-week running streak', st >= 4],
    ['12w', 'Season', '12-week running streak', st >= 12], ['6:00', 'Sub six', '5 km+ under 6:00 /km', fastOn(360)],
    ['5:00', 'Sub five', '5 km+ under 5:00 /km', fastOn(300)], ['4:00', 'Sub four', '5 km+ under 4:00 /km', fastOn(240)],
  ];
  $('#badgeCount').textContent = `· ${B.filter((b) => b[3]).length} of ${B.length}`;
  $('#badges').innerHTML = B.map(([m, t, d, on]) => `<div class="badge${on ? ' on' : ''}"><span class="medal num">${m}</span><span><b>${t}</b>${d}</span></div>`).join('');
}
function renderRuns() {
  const el = $('#runList');
  const years = [...new Set(state.runs.map((r) => r.date.slice(0, 4)))].sort().reverse();
  if (state.year !== 'all' && !years.includes(state.year)) state.year = 'all';
  $('#yearSel').innerHTML = ['<option value="all">All years</option>', ...years.map((y) => `<option value="${y}">${y}</option>`)].join('');
  $('#yearSel').value = state.year;
  const runs = state.runs.filter((r) => state.year === 'all' || r.date.startsWith(state.year));
  const km = runs.reduce((a, r) => a + r.km, 0), sec = runs.reduce((a, r) => a + r.sec, 0);
  $('#runsSummary').textContent = runs.length ? `${runs.length} ${runs.length === 1 ? 'run' : 'runs'} · ${fmtDist(km)} ${uName()} · ${Math.round(sec / 3600)} h on your feet` : '';
  if (!runs.length) { el.innerHTML = '<div class="list"><div class="empty">Your diary is empty. Use <b>Log run</b> to add a run.</div></div>'; return; }
  if (isWide()) { el.innerHTML = runsTable(sortRuns(runs), { sortable: true, group: state.sort.key === 'date' }); return; }
  const groups = new Map();
  for (const r of sortRuns(runs, { key: 'date', dir: -1 })) { const k = r.date.slice(0, 7); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  let h = '';
  for (const [k, rs] of groups) {
    const sum = rs.reduce((a, r) => a + r.km, 0);
    h += `<div class="month"><h2>${esc(fd(dn(k + '-01'), { month: 'long', year: 'numeric' }))}</h2><span class="muted small num">${rs.length} ${rs.length === 1 ? 'run' : 'runs'} · ${fmtDist(sum)} ${uName()}</span></div><div class="list">${rs.map(rowButton).join('')}</div>`;
  }
  el.innerHTML = h;
}
function renderSettings() {
  const s = state.settings;
  [['#unitSeg', s.unit], ['#metricSeg', s.metric], ['#modeSeg', s.mode], ['#smoothSetSeg', s.smoothing]].forEach(([sel, v]) => $$(sel + ' button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v)));
  $('#swatches').innerHTML = PALETTES.map(([k, n, c]) => `<button class="sw" type="button" data-v="${k}" aria-pressed="${s.palette === k}"><i style="background:${c}"></i>${n}</button>`).join('');
  const hasSamples = state.runs.some((r) => r.sample);
  $('#samplesLabel').textContent = hasSamples ? 'Sample runs are in your diary' : 'Five months of example runs';
  $('#samplesBtn').textContent = hasSamples ? 'Clear samples' : 'Load samples';
  $('#whoName').textContent = state.user?.username || '';
  $('#avatar').textContent = (state.user?.username || '?').slice(0, 1);
  $('#versionText').textContent = state.version ? ` Version ${state.version}` : '';
  $('#supportGroup').hidden = !LINKS.donate;
  if (LINKS.donate) $('#donateLink').href = LINKS.donate;
  $('#sourceLink').hidden = !LINKS.source;
  if (LINKS.source) $('#sourceLink').href = LINKS.source;
}
function render() {
  applyTheme();
  $$('.uLbl').forEach((e) => (e.textContent = uName()));
  $$('.pLbl').forEach((e) => (e.textContent = 's/' + uName()));
  $$('.sLbl').forEach((e) => (e.textContent = sName()));
  const v = currentTab();
  const name = state.user?.username || '';
  $('#pageTitle').textContent = { overview: 'Overview', stats: 'Stats', runs: 'Runs', settings: 'Settings' }[v];
  $('#pageSub').textContent = {
    overview: fd(today(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    stats: 'All-time totals, race predictions and milestones',
    runs: `${state.runs.length} ${state.runs.length === 1 ? 'run' : 'runs'} in your diary`,
    settings: `Signed in as ${name}`,
  }[v];
  $('#barSub').textContent = { overview: 'running diary', stats: 'stats', runs: `${state.runs.length} runs`, settings: 'settings' }[v];
  $('#sideName').textContent = name;
  $('#sideAvatar').textContent = name.slice(0, 1) || '?';
  renderSideWeek();
  if (v === 'overview') renderOverview();
  else if (v === 'stats') renderStats();
  else if (v === 'runs') renderRuns();
  else renderSettings();
}

/* ---------- routing ---------- */
const TABS = ['overview', 'stats', 'runs', 'settings'];
const currentTab = () => { const h = location.hash.slice(1); return TABS.includes(h) ? h : 'overview'; };
function showTab() {
  if (!state.user) return;
  const v = currentTab();
  TABS.forEach((t) => ($(`#v-${t}`).hidden = t !== v));
  $$('a[data-tab]').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === v ? 'page' : 'false'));
  $('#fab').hidden = v === 'settings';
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', showTab);

/* ---------- toast ---------- */
let tt;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 2600); }

/* ---------- sign in ---------- */
function showAuth() {
  $('#app').hidden = $('#tabs').hidden = $('#fab').hidden = true;
  $('#auth').hidden = false;
  const st = state.auth || {};
  const signup = st.needsSetup || state.signupMode;
  $('#authTitle').textContent = st.needsSetup ? 'Create your account' : signup ? 'Create an account' : 'Sign in to your running diary';
  $('#authSubmit').textContent = signup ? 'Create account' : 'Sign in';
  $('#authPass').autocomplete = signup ? 'new-password' : 'current-password';
  $('#authNote').textContent = st.needsSetup
    ? 'This is the first account on this server. Choose a password of at least 10 characters.'
    : signup ? 'Use a password of at least 10 characters.' : 'Your runs are stored on this server only.';
  $('#authSwitchWrap').hidden = !!st.needsSetup || !st.allowSignup;
  $('#authSwitch').textContent = state.signupMode ? 'I already have an account' : 'Create an account';
  $('#authErr').textContent = '';
  setTimeout(() => $('#authUser').focus(), 50);
}
async function enterApp(me) {
  state.user = me.user;
  Object.assign(state.settings, DEFAULTS, me.settings || {});
  cacheSettings();
  const { runs } = await api('GET', '/api/runs');
  state.runs = runs;
  $('#auth').hidden = true;
  $('#app').hidden = $('#tabs').hidden = false;
  showTab();
}
$('#authSwitch').addEventListener('click', () => { state.signupMode = !state.signupMode; showAuth(); });
$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const signup = state.auth?.needsSetup || state.signupMode;
  const btn = $('#authSubmit');
  btn.disabled = true;
  try {
    const me = await api('POST', signup ? '/api/signup' : '/api/login', { username: $('#authUser').value.trim(), password: $('#authPass').value });
    $('#authPass').value = '';
    state.auth = { ...(state.auth || {}), needsSetup: false };
    await enterApp(me);
  } catch (err) {
    $('#authErr').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
$('#signOut').addEventListener('click', async () => {
  try { await api('POST', '/api/logout'); } catch {}
  state.user = null; state.runs = []; state.signupMode = false;
  showAuth();
});
$('#pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#pwMsg');
  try {
    await api('POST', '/api/password', { current: $('#pwCurrent').value, next: $('#pwNext').value });
    $('#pwCurrent').value = $('#pwNext').value = '';
    msg.textContent = '';
    toast('Password changed. Other devices are signed out.');
  } catch (err) { msg.textContent = err.message; }
});

/* ---------- run sheet ---------- */
let editing = null, entry = 'time';
const num = (id) => { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) ? v : 0; };
function setEntry(m) {
  entry = m;
  $$('#modeEntry button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === m));
  $('#inTime').hidden = m !== 'time'; $('#inPace').hidden = m !== 'pace'; $('#inSpeed').hidden = m !== 'speed';
  updatePreview();
}
function readForm() {
  const km = fromUnit(num('#fDist'));
  let sec = 0;
  if (entry === 'time') sec = num('#fH') * 3600 + num('#fM') * 60 + num('#fS');
  else if (entry === 'pace') sec = (num('#fPM') * 60 + num('#fPS')) * toUnit(km);
  else { const sp = num('#fSp'); sec = sp > 0 ? (toUnit(km) / sp) * 3600 : 0; }
  return { date: $('#fDate').value, km: Math.round(km * 1000) / 1000, sec: Math.round(sec) };
}
function updatePreview() {
  const f = readForm(), p = $('#preview');
  if (f.km > 0 && f.sec > 0) { const pk = f.sec / f.km; p.innerHTML = `<span><b>${fmtDur(f.sec)}</b> time</span><span><b>${fmtMS(paceU(pk))}</b> /${uName()}</span><span><b>${speedU(pk).toFixed(1)}</b> ${sName()}</span>`; }
  else p.innerHTML = '<span class="muted">Enter the distance and one of time, pace or speed. spur works out the other two.</span>';
}
function openSheet(r) {
  editing = r || null;
  $('#formErr').textContent = '';
  $('#sheetTitle').textContent = r ? 'Edit run' : 'Log a run';
  $('#del').hidden = !r; $('#delAsk').hidden = true;
  $('#fDate').value = r ? r.date : localToday();
  $('#fDate').max = localToday();
  $('#fDist').value = r ? +toUnit(r.km).toFixed(2) : '';
  ['#fH', '#fM', '#fS', '#fPM', '#fPS', '#fSp'].forEach((i) => ($(i).value = ''));
  if (r) { $('#fH').value = Math.floor(r.sec / 3600) || ''; $('#fM').value = Math.floor((r.sec % 3600) / 60); $('#fS').value = r.sec % 60; }
  setEntry('time');
  $('#scrim').hidden = false;
  $('#fDist').focus();
}
const closeSheet = () => { $('#scrim').hidden = true; editing = null; };
$('#fab').addEventListener('click', () => openSheet());
$('#welcomeLog').addEventListener('click', () => openSheet());
$('#cancel').addEventListener('click', closeSheet);
$('#scrim').addEventListener('click', (e) => { if (e.target.id === 'scrim') closeSheet(); });
$$('#modeEntry button').forEach((b) => b.addEventListener('click', () => setEntry(b.dataset.v)));
$('#sheet').addEventListener('input', updatePreview);
$('#sheet').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = readForm(), err = $('#formErr');
  if (!f.date) return (err.textContent = 'Pick the date of the run.');
  if (dn(f.date) > today()) return (err.textContent = "That date is in the future. Log runs once they're done.");
  if (!(f.km > 0)) return (err.textContent = 'Enter how far you ran.');
  if (!(f.sec > 0)) return (err.textContent = entry === 'time' ? 'Enter how long the run took.' : entry === 'pace' ? 'Enter your average pace.' : 'Enter your average speed.');
  const btn = $('#saveRun');
  btn.disabled = true;
  try {
    if (editing) {
      const { run } = await api('PUT', `/api/runs/${encodeURIComponent(editing.id)}`, f);
      state.runs = state.runs.map((x) => (x.id === editing.id ? run : x));
      toast('Run updated');
    } else {
      const { run } = await api('POST', '/api/runs', f);
      state.runs.push(run);
      toast('Run saved');
    }
    closeSheet();
    showTab();
  } catch (e2) { err.textContent = e2.message; }
  finally { btn.disabled = false; }
});
$('#del').addEventListener('click', () => { $('#del').hidden = true; $('#delAsk').hidden = false; });
$('#delYes').addEventListener('click', async () => {
  if (!editing) return;
  try {
    await api('DELETE', `/api/runs/${encodeURIComponent(editing.id)}`);
    state.runs = state.runs.filter((r) => r.id !== editing.id);
    closeSheet(); showTab(); toast('Run deleted');
  } catch (e) { $('#formErr').textContent = e.message; }
});
function openRunFrom(el) { const r = state.runs.find((x) => String(x.id) === el.dataset.id); if (r) openSheet(r); }
['#runList', '#recent'].forEach((sel) => {
  $(sel).addEventListener('click', (e) => {
    const sortBtn = e.target.closest('button[data-sort]');
    if (sortBtn) {
      const key = sortBtn.dataset.sort;
      state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: key === 'date' || key === 'km' || key === 'sec' ? -1 : 1 };
      return renderRuns();
    }
    const el = e.target.closest('[data-id]');
    if (el) openRunFrom(el);
  });
  $(sel).addEventListener('keydown', (e) => {
    const el = e.target.closest('tr[data-id]');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openRunFrom(el); }
  });
});
$('#yearSel').addEventListener('change', (e) => { state.year = e.target.value; renderRuns(); });
$('#headLog').addEventListener('click', () => openSheet());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#scrim').hidden) closeSheet(); if (!$('#goalScrim').hidden) $('#goalScrim').hidden = true; } });

/* ---------- goal sheet ---------- */
$('#editGoal').addEventListener('click', () => {
  const g = state.settings.goal;
  $('#gM').value = g ? Math.floor(paceU(g) / 60) : ''; $('#gS').value = g ? pad(Math.round(paceU(g)) % 60) : '';
  $('#goalErr').textContent = ''; $('#goalScrim').hidden = false; $('#gM').focus();
});
$('#goalCancel').addEventListener('click', () => ($('#goalScrim').hidden = true));
$('#goalScrim').addEventListener('click', (e) => { if (e.target.id === 'goalScrim') $('#goalScrim').hidden = true; });
$('#goalClear').addEventListener('click', () => { saveSettings({ goal: null }); $('#goalScrim').hidden = true; toast('Goal removed'); });
$('#goalSheet').addEventListener('submit', (e) => {
  e.preventDefault();
  const pu = num('#gM') * 60 + num('#gS'), pk = U() === 'mi' ? pu / MI : pu;
  if (pk < 150 || pk > 1200) return ($('#goalErr').textContent = 'Enter a pace between 2:30 and 20:00 per km.');
  saveSettings({ goal: Math.round(pk * 10) / 10 }); $('#goalScrim').hidden = true; toast('Goal saved');
});

/* ---------- settings ---------- */
$('#rangeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) saveSettings({ range: b.dataset.v }); });
const segBind = (sel, key) => $(sel).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) saveSettings({ [key]: b.dataset.v }); });
segBind('#unitSeg', 'unit'); segBind('#metricSeg', 'metric'); segBind('#modeSeg', 'mode');
segBind('#smoothSeg', 'smoothing'); segBind('#smoothSetSeg', 'smoothing'); segBind('#volSeg', 'volume');
$('#swatches').addEventListener('click', (e) => { const b = e.target.closest('.sw'); if (b) saveSettings({ palette: b.dataset.v }); });

async function loadSamples() {
  try { const { runs } = await api('POST', '/api/samples', { today: localToday() }); state.runs = runs; showTab(); toast('Sample runs loaded'); }
  catch (e) { toast(e.message); }
}
async function clearSamples() {
  try { await api('DELETE', '/api/samples'); state.runs = state.runs.filter((r) => !r.sample); showTab(); toast('Sample runs cleared'); }
  catch (e) { toast(e.message); }
}
$('#welcomeSamples').addEventListener('click', loadSamples);
$('#clearSamples').addEventListener('click', clearSamples);
$('#samplesBtn').addEventListener('click', () => (state.runs.some((r) => r.sample) ? clearSamples() : loadSamples()));

async function importCsv(csv) {
  const msg = $('#importMsg');
  if (!csv.trim()) return (msg.textContent = 'Paste some lines or choose a file first.');
  try {
    const r = await api('POST', '/api/import', { csv });
    state.runs = (await api('GET', '/api/runs')).runs;
    const parts = [`${r.added} imported`];
    if (r.duplicates) parts.push(`${r.duplicates} already in your diary`);
    if (r.skipped) parts.push(`${r.skipped} skipped (use date,km,h:mm:ss)`);
    msg.textContent = parts.join(', ') + '.';
    if (r.added) { $('#importBox').value = ''; toast('Import done'); }
    render();
  } catch (e) { msg.textContent = e.message; }
}
$('#doImport').addEventListener('click', () => importCsv($('#importBox').value));
$('#importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) { $('#importMsg').textContent = 'That file is larger than 1.5 MB. Split it into smaller files.'; return; }
  const reader = new FileReader();
  reader.onload = () => importCsv(String(reader.result));
  reader.readAsText(file);
  e.target.value = '';
});
$('#wipe').addEventListener('click', () => { $('#wipeRow').hidden = true; $('#wipeConfirm').hidden = false; });
$('#wipeNo').addEventListener('click', () => { $('#wipeRow').hidden = false; $('#wipeConfirm').hidden = true; });
$('#wipeYes').addEventListener('click', async () => {
  try { await api('DELETE', '/api/runs'); state.runs = []; toast('All runs deleted'); }
  catch (e) { toast(e.message); }
  $('#wipeRow').hidden = false; $('#wipeConfirm').hidden = true; render();
});

let rz;
let wasWide = isWide();
window.addEventListener('resize', () => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    if (!state.user) return;
    if (isWide() !== wasWide) { wasWide = isWide(); render(); }
    else if (currentTab() === 'overview' && state.runs.length) { paceChart(); volumeChart(analysis()); }
  }, 120);
});

/* ---------- start ---------- */
async function boot() {
  $$('.logo').forEach((el) => (el.innerHTML = logo(Number(el.dataset.size) || 34)));
  Object.assign(state.settings, cachedSettings());
  applyTheme();
  try {
    const st = await api('GET', '/api/status');
    state.auth = st;
    state.version = st.version;
    if (st.user) await enterApp(await api('GET', '/api/me'));
    else showAuth();
  } catch (e) {
    showAuth();
    $('#authErr').textContent = e.message;
  }
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
boot();
