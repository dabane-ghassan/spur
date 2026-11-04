// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane
// spur web app. Runs and settings live on your spur server; this file only
// draws them and sends your changes back.
'use strict';

/* Fill these in to show the matching buttons in Settings. */
const LINKS = {
  donate: 'https://buymeacoffee.com/ghassandabane',
  source: 'https://github.com/dabane-ghassan/spur',
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
const fmtCache = new Map(); // building a date formatter is slow, so keep one per style
const fd = (n, o) => {
  const key = JSON.stringify(o || {});
  let f = fmtCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat(undefined, Object.assign({ timeZone: 'UTC' }, o)); fmtCache.set(key, f); }
  return f.format(new Date(n * DAY));
};
const dow = (n) => (new Date(n * DAY).getUTCDay() + 6) % 7;
const weekStart = (n) => n - dow(n);

/* ---------- state ---------- */
const DEFAULTS = { unit: 'km', metric: 'pace', palette: 'tartan', mode: 'system', goal: null, range: '3M', smoothing: 'medium', volume: 'distance' };
const state = { user: null, runs: [], settings: { ...DEFAULTS }, version: '', auth: null, signupMode: false, sort: { key: 'date', dir: -1 }, year: 'all', view: null, accounts: [], maxAccounts: 6, adding: false, admin: null };

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
/* ---------- precomputed trend lines ---------- */
// The trend for every day of the history, worked out once per change of data or
// settings, so zooming and panning only have to draw.
let seriesCache = null;
function series() {
  const s = state.settings;
  let sumSec = 0, sumKm = 0;
  for (const r of state.runs) { sumSec += r.sec; sumKm += r.km; }
  const key = [state.runs.length, sumSec, sumKm.toFixed(3), s.smoothing, s.volume, U(), today()].join('|');
  if (seriesCache && seriesCache.key === key) return seriesCache;
  const pts = points();
  if (!pts.length) return (seriesCache = { key, empty: true });
  const D0 = pts[0].t, D1 = Math.max(today(), pts[pts.length - 1].t), n = D1 - D0 + 1;
  const sig = sigma(), gap = gapLimit(sig), reach = Math.ceil(4 * sig);
  const sumP = new Float64Array(n), cnt = new Float64Array(n), lastP = new Array(n).fill(null), daily = new Float64Array(n), dailyKm = new Float64Array(n);
  for (const p of pts) { const i = p.t - D0; sumP[i] += p.v; cnt[i]++; lastP[i] = p.v; daily[i] += volOfRun(p.r); dailyKm[i] += p.r.km; }
  const w = []; for (let d = 0; d <= reach; d++) w.push(sig ? Math.exp((-d * d) / (2 * sig * sig)) : 1);
  const pace = new Array(n).fill(null), vol = new Float64Array(n), last7 = new Float64Array(n);
  let nearest = -1e9, latest = null;
  for (let i = 0; i < n; i++) {
    if (cnt[i]) { nearest = i; latest = lastP[i]; }
    last7[i] = daily[i] + (i > 0 ? last7[i - 1] : 0) - (i >= 7 ? daily[i - 7] : 0);
    if (i - nearest <= gap) {
      if (!sig) pace[i] = latest;
      else {
        let sw = 0, sv = 0;
        for (let d = 0; d <= reach && d <= i; d++) if (cnt[i - d]) { sw += w[d] * cnt[i - d]; sv += w[d] * sumP[i - d]; }
        pace[i] = sw > 1e-6 ? sv / sw : null;
      }
    }
    if (!sig) vol[i] = last7[i];
    else { let sw = 0, sv = 0; for (let d = 0; d <= reach && d <= i; d++) { sw += w[d]; sv += w[d] * last7[i - d]; } vol[i] = sv / sw; }
  }
  return (seriesCache = { key, D0, D1, pace, vol, daily, dailyKm, pts });
}

/* ---------- the visible window, shared by both trend charts ---------- */
const MIN_SPAN = 14;
function bounds() { const ser = series(); return { lo: ser.D0 - 3, hi: ser.D1 }; }
function viewWindow() {
  const { lo, hi } = bounds();
  if (state.view) return { t0: state.view.t0, t1: state.view.t1, lo, hi };
  const rd = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365 }[state.settings.range];
  return { t0: rd ? hi - rd : lo, t1: hi, lo, hi };
}
function chartRange() { const v = viewWindow(); return { t0: v.t0, t1: v.t1 }; }
function setView(t0, t1) {
  const { lo, hi } = bounds();
  let span = Math.min(Math.max(t1 - t0, MIN_SPAN), hi - lo);
  if (t0 < lo) t0 = lo;
  if (t0 + span > hi) t0 = hi - span;
  if (t0 < lo) t0 = lo;
  state.view = { t0, t1: t0 + span };
  drawTrends();
}
function zoomBy(factor, centerDay) {
  const v = viewWindow(), c = centerDay ?? (v.t0 + v.t1) / 2, span = (v.t1 - v.t0) * factor;
  const f = (c - v.t0) / (v.t1 - v.t0);
  setView(c - f * span, c - f * span + span);
}
let drawPending = false;
function drawTrends() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    if (!state.user || currentTab() !== 'overview' || !state.runs.length) return;
    paceChart(); volumeChart(); navChart(); zoomStatus();
  });
}
function zoomStatus() {
  const v = viewWindow(), full = v.t1 - v.t0 >= v.hi - v.lo - 0.5;
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  $('#zoomLabel').textContent = `${fd(Math.round(v.t0), opts)} – ${fd(Math.round(v.t1), opts)}`;
  $('#zoomIn').disabled = v.t1 - v.t0 <= MIN_SPAN + 0.5;
  $('#zoomOut').disabled = full;
  $('#zoomReset').hidden = !state.view;
  $$('#rangeSeg button').forEach((b) => b.setAttribute('aria-pressed', !state.view && b.dataset.v === state.settings.range));
}

/* ---------- time axis ---------- */
function niceStep(span, steps) { for (const s of steps) if (span / s <= 5) return s; return steps[steps.length - 1]; }
function timeTicks(t0, t1) {
  const span = t1 - t0, ticks = [];
  if (span <= 45) { for (let t = weekStart(Math.floor(t0)) + 7; t <= t1; t += 7) ticks.push([t, fd(t, { day: 'numeric', month: 'short' })]); return ticks; }
  const d0 = new Date(Math.floor(t0) * DAY);
  if (span > 900) {
    for (let yy = d0.getUTCFullYear() + 1; ; yy++) { const t = Math.round(Date.UTC(yy, 0, 1) / DAY); if (t > t1) break; ticks.push([t, String(yy)]); }
    return ticks;
  }
  let yy = d0.getUTCFullYear(), mm = d0.getUTCMonth() + 1, i = 0;
  const every = span > 500 ? 3 : span > 200 ? 2 : 1;
  for (;;) { if (mm > 11) { mm = 0; yy++; } const t = Math.round(Date.UTC(yy, mm, 1) / DAY); if (t > t1) break; if (i++ % every === 0) ticks.push([t, fd(t, span > 300 ? { month: 'short', year: '2-digit' } : { month: 'short' })]); mm++; }
  return ticks;
}
function drawAxis(g, t0, t1, x, P, W, H) {
  for (const [t, l] of timeTicks(t0, t1)) {
    const xx = x(t);
    if (xx < P.l + 12 || xx > W - P.r - 12) continue;
    g.push(`<line class="axis" x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${H - P.b}" y2="${H - P.b + 4}"/><text x="${xx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`);
  }
}
function pathFrom(list, x, y) {
  let d = '', prev = false;
  for (const p of list) { if (!p) { prev = false; continue; } d += (prev ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1); prev = true; }
  return d;
}

/* ---------- pace chart ---------- */
function paceChart() {
  const el = $('#paceChart'), ser = series(), s = state.settings, pace = isPace();
  $('#chartTitle').textContent = pace ? 'Pace over time' : 'Speed over time';
  if (ser.empty) { el.innerHTML = '<div class="empty">No runs yet. Tap <b>Log run</b> to add your first.</div>'; return; }
  const W = Math.max(280, el.clientWidth || 320), H = W >= 640 ? Math.round(Math.min(360, Math.max(260, W * 0.4))) : Math.round(Math.min(260, Math.max(200, W * 0.52)));
  const P = { l: 42, r: 14, t: 16, b: 26 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
  const { t0, t1 } = chartRange(), span = Math.max(1, t1 - t0);
  const inR = ser.pts.filter((p) => p.t >= t0 && p.t <= t1);
  const stepD = Math.max(1, Math.floor(span / iw)); // about one trend point per pixel
  const sm = [];
  if (smoothingOn()) for (let t = Math.ceil(t0); t <= t1; t += stepD) { const i = t - ser.D0, v = i >= 0 && i < ser.pace.length ? ser.pace[i] : null; sm.push(v == null ? null : { t, v: metricVal(v) }); }
  const vals = inR.map((p) => metricVal(p.v)).concat(sm.filter(Boolean).map((p) => p.v));
  const goalV = s.goal ? metricVal(s.goal) : null;
  if (goalV != null && vals.length) vals.push(goalV);
  el._geom = { W, l: P.l, iw };
  if (!vals.length) { el.innerHTML = '<div class="empty">No runs in this part of the timeline. Zoom out or move along.</div>'; $('#goalLegend').hidden = true; return; }
  // Scale to your typical runs: the odd walk or hike would otherwise flatten everything.
  const dotVals = inR.map((p) => metricVal(p.v)).sort((a, b) => a - b);
  const pick = (f) => dotVals[Math.min(dotVals.length - 1, Math.max(0, Math.round(f * (dotVals.length - 1))))];
  const core = (dotVals.length >= 20 ? [pick(0.02), pick(0.98)] : dotVals).concat(sm.filter(Boolean).map((p) => p.v), goalV != null ? [goalV] : []);
  let lo = Math.min(...core), hi = Math.max(...core);
  const step = pace ? niceStep(hi - lo, [10, 15, 20, 30, 60, 120, 300]) : niceStep(hi - lo, [0.25, 0.5, 1, 2, 5, 10]);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (hi <= lo) hi = lo + step;
  const x = (t) => P.l + ((t - t0) / span) * iw;
  const yRaw = (v) => (pace ? P.t + ((v - lo) / (hi - lo)) * ih : P.t + ((hi - v) / (hi - lo)) * ih);
  const y = (v) => Math.min(P.t + ih, Math.max(P.t, yRaw(v)));
  const g = [`<defs><clipPath id="pcClip"><rect x="${P.l}" y="0" width="${iw}" height="${H}"/></clipPath></defs>`];
  for (let v = lo; v <= hi + 1e-9; v += step) {
    const yy = y(v).toFixed(1);
    g.push(`<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}" stroke-dasharray="${v === lo || v >= hi - 1e-9 ? '' : '2 4'}"/><text x="${P.l - 6}" y="${+yy + 4}" text-anchor="end">${metricFmt(v)}</text>`);
  }
  drawAxis(g, t0, t1, x, P, W, H);
  g.push(`<text x="${P.l + 4}" y="${P.t - 4}" style="font-size:10.5px;letter-spacing:.06em">▲ FASTER</text>`);
  if (goalV != null) {
    const gy = y(goalV).toFixed(1);
    g.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${gy}" y2="${gy}" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="6 5"/><text x="${W - P.r}" y="${+gy - 5}" text-anchor="end" style="fill:var(--fg);font-weight:600">goal ${metricFmt(goalV)}</text>`);
  }
  // Fewer pixels per run → smaller, lighter dots, so a long history stays readable.
  const density = inR.length / iw;
  const r0 = density > 0.6 ? 1.6 : density > 0.3 ? 2.2 : 3, dense = density > 0.3;
  g.push('<g clip-path="url(#pcClip)">');
  for (const p of inR) {
    const v = metricVal(p.v), rr = p.r.km >= 10 && !dense ? r0 + 1 : r0, off = y(v) !== yRaw(v);
    g.push(`<circle cx="${x(p.t).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${off ? 1.8 : rr}" fill="${off ? 'none' : 'var(--accent-soft)'}" stroke="var(--accent)" stroke-width="${dense ? 0.8 : 1.4}" opacity="${off ? 0.45 : dense ? 0.55 : 1}"><title>${esc(fd(p.t, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}: ${fmtDist(p.r.km)} ${uName()} · ${metricFmt(v)} ${metricUnit()}</title></circle>`);
  }
  if (smoothingOn()) {
    const d = pathFrom(sm, x, y);
    if (d) g.push(`<path d="${d}" fill="none" stroke="var(--surface)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`);
    const end = [...sm].reverse().find(Boolean);
    if (end && t1 >= today() - 1) g.push(`<circle cx="${x(end.t).toFixed(1)}" cy="${y(end.v).toFixed(1)}" r="6" fill="var(--accent)" stroke="var(--surface)" stroke-width="2.5"/>`);
  } else {
    let d = '', prev = null;
    for (const p of inR) { d += (prev && p.t - prev.t <= gapLimit(0) ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(metricVal(p.v)).toFixed(1); prev = p; }
    if (d) g.push(`<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="${dense ? 1 : 1.6}" stroke-linejoin="round" opacity=".75"/>`);
  }
  g.push('</g>');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${pace ? 'Pace' : 'Speed'} per run${smoothingOn() ? ' with smoothed trend' : ''}">${g.join('')}</svg>`;
  // What's in the window: handy for comparing one period with another.
  const km = inR.reduce((a, p) => a + p.r.km, 0), sec = inR.reduce((a, p) => a + p.r.sec, 0);
  const fastest = inR.filter((p) => p.r.km >= 3).reduce((b, p) => (!b || p.v < b.v ? p : b), null);
  $('#paceInView').innerHTML = inR.length
    ? `<span><b>${inR.length}</b> ${inR.length === 1 ? 'run' : 'runs'}</span><span><b>${fmtDist(km)}</b> ${uName()}</span><span><b>${metricFmt(metricVal(sec / km))}</b> ${metricUnit()} average</span>${fastest ? `<span><b>${metricFmt(metricVal(fastest.v))}</b> fastest (3 km+)</span>` : ''}`
    : '<span>No runs in this part of the timeline</span>';
  $('#goalLegend').hidden = goalV == null;
  $('#trendLegend').textContent = smoothingOn() ? `Trend · ${SMOOTHING_NAME[state.settings.smoothing].toLowerCase()} smoothing` : 'Runs joined, no smoothing';
}

/* ---------- volume chart ---------- */
function volumeChart() {
  const el = $('#volChart'), ser = series(), cur = weekStart(today());
  if (ser.empty) return;
  const { t0, t1 } = chartRange(), span = Math.max(1, t1 - t0);
  const W = Math.max(280, el.clientWidth || 320), H = W >= 640 ? Math.round(Math.min(300, Math.max(220, W * 0.32))) : 190;
  const P = { l: 42, r: 14, t: 16, b: 26 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
  const dayAt = (t) => { const i = t - ser.D0; return i >= 0 && i < ser.daily.length ? ser.daily[i] : 0; };
  // Weekly bars, or monthly bars (as an average per week) when weeks get too thin to see.
  const monthly = (7 * iw) / span < 4;
  const bars = [];
  if (!monthly) {
    for (let w = weekStart(Math.floor(t0)); w <= t1; w += 7) { let v = 0; for (let d = 0; d < 7; d++) v += dayAt(w + d); bars.push({ a: w, b: w + 7, v, cur: w === cur, tip: `Week of ${fd(w, { day: 'numeric', month: 'short', year: 'numeric' })}${w === cur ? ' (so far)' : ''}: ${fmtVol(v)} ${volUnit()}` }); }
  } else {
    let d0 = new Date(Math.floor(t0) * DAY), yy = d0.getUTCFullYear(), mm = d0.getUTCMonth();
    for (;;) {
      const a = Math.round(Date.UTC(yy, mm, 1) / DAY), b = Math.round(Date.UTC(yy, mm + 1, 1) / DAY);
      if (a > t1) break;
      let tot = 0; for (let t = a; t < b; t++) tot += dayAt(t);
      const days = Math.max(1, Math.min(b, today() + 1) - a);
      bars.push({ a, b, v: (tot / days) * 7, cur: a <= today() && today() < b, tip: `${fd(a, { month: 'long', year: 'numeric' })}: ${fmtVol(tot)} ${volUnit()} (${fmtVol((tot / days) * 7)} ${volUnit()}/week)` });
      mm++; if (mm > 11) { mm = 0; yy++; }
    }
  }
  const stepD = Math.max(1, Math.floor(span / iw)), trend = [];
  if (smoothingOn()) for (let t = Math.ceil(t0); t <= t1; t += stepD) { const i = t - ser.D0; trend.push(i >= 0 && i < ser.vol.length ? { t, v: ser.vol[i] } : null); }
  const vals = bars.map((b) => b.v).concat(trend.filter(Boolean).map((p) => p.v));
  const step = niceStep(Math.max(...vals, 1), volIsTime() ? [0.5, 1, 2, 3, 5, 10] : [5, 10, 20, 25, 50, 100]);
  const hi = Math.max(step, Math.ceil(Math.max(...vals, 0.0001) / step) * step);
  const x = (t) => P.l + ((t - t0) / span) * iw;
  const y = (v) => P.t + ((hi - v) / hi) * ih;
  el._geom = { W, l: P.l, iw };
  const g = [`<defs><clipPath id="vcClip"><rect x="${P.l}" y="0" width="${iw}" height="${H}"/></clipPath></defs>`];
  for (let v = 0; v <= hi + 1e-9; v += step) {
    const yy = y(v).toFixed(1);
    g.push(`<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}" stroke-dasharray="${v === 0 ? '' : '2 4'}"/><text x="${P.l - 6}" y="${+yy + 4}" text-anchor="end">${v % 1 ? v.toFixed(1) : v}</text>`);
  }
  drawAxis(g, t0, t1, x, P, W, H);
  g.push(`<text x="${P.l + 4}" y="${P.t - 4}" style="font-size:10.5px;letter-spacing:.06em">${volUnit().toUpperCase()} / WEEK${monthly ? ' · MONTHLY AVERAGE' : ''}</text>`);
  g.push('<g clip-path="url(#vcClip)">');
  const gapPx = monthly ? 1 : Math.min(3, (iw / span) * 0.6);
  for (const bar of bars) {
    const xa = x(bar.a) + gapPx, xb = x(bar.b) - gapPx;
    if (bar.v <= 0 || xb - xa < 0.6) continue;
    const top = y(bar.v);
    g.push(`<rect x="${xa.toFixed(1)}" y="${top.toFixed(1)}" width="${(xb - xa).toFixed(1)}" height="${(H - P.b - top).toFixed(1)}" rx="${Math.min(4, (xb - xa) / 3).toFixed(1)}" fill="${bar.cur ? 'var(--accent)' : 'var(--accent-soft)'}" stroke="${bar.cur ? 'none' : 'var(--accent)'}" stroke-opacity=".55" stroke-width="${xb - xa > 4 ? 1 : 0}"><title>${esc(bar.tip)}</title></rect>`);
  }
  if (trend.length) {
    const d = pathFrom(trend, x, y);
    if (d) g.push(`<path d="${d}" fill="none" stroke="var(--surface)" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/><path d="${d}" fill="none" stroke="var(--fg)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`);
    const end = [...trend].reverse().find(Boolean);
    if (end && t1 >= today() - 1) g.push(`<circle cx="${x(end.t).toFixed(1)}" cy="${y(end.v).toFixed(1)}" r="5" fill="var(--fg)" stroke="var(--surface)" stroke-width="2.5"/>`);
  }
  g.push('</g>');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${volIsTime() ? 'Running time' : 'Distance'} per ${monthly ? 'month' : 'week'}${smoothingOn() ? ' with smoothed volume trend' : ''}">${g.join('')}</svg>`;
  $('#volTrendLegend').hidden = !smoothingOn();
  $('#volBarsLegend').textContent = monthly ? `Average per week, by month` : `${volIsTime() ? 'Time' : 'Distance'} each week`;
  renderVolumeHeadline();
}
function renderVolumeHeadline() {
  const daily = dailyVolume(), cur = weekStart(today());
  const vNow = volumeAt(today(), daily), vThen = volumeAt(today() - 28, daily);
  $('#volLabel').textContent = smoothingOn() ? 'Volume trend' : 'Last 7 days';
  $('#volBig').innerHTML = vNow == null ? '–' : `${fmtVol(vNow)}<small>${volUnit()}/week</small>`;
  const vc = $('#volChange');
  if (vNow == null || vThen == null) vc.textContent = 'Needs about a month of runs to compare';
  else if (vThen <= 0) vc.textContent = vNow > 0 ? 'Up from nothing 4 weeks ago' : 'No running in the last weeks';
  else { const pct = Math.round((vNow / vThen - 1) * 100); vc.textContent = Math.abs(pct) < 5 ? 'About the same as 4 weeks ago' : `${pct > 0 ? '▲ +' : '▼ '}${pct}% vs 4 weeks ago`; }
  const wkKm = weekly(), thisW = wkKm.get(cur) || 0, avg = [1, 2, 3].reduce((acc, i) => acc + (wkKm.get(cur - 7 * i) || 0), 0) / 3;
  const chip = $('#loadChip'), txt = $('#loadText');
  if (avg <= 0) { chip.className = 'chip flat'; chip.textContent = 'Building base'; txt.textContent = 'Once you have three weeks logged, spur compares each week with your recent average.'; }
  else if (thisW > avg * 1.1) {
    const pct = Math.round((thisW / avg - 1) * 100);
    chip.className = 'chip warn'; chip.textContent = `+${pct}% vs 3-wk avg`;
    txt.textContent = `This week is ${pct}% above your recent average of ${toUnit(avg).toFixed(1)} ${uName()}. Big jumps in weekly distance are a common cause of running injuries, so build up gradually.`;
  } else { chip.className = 'chip good'; chip.textContent = 'Load steady'; txt.textContent = `${toUnit(thisW).toFixed(1)} ${uName()} so far this week, against a 3-week average of ${toUnit(avg).toFixed(1)} ${uName()}.`; }
}

/* ---------- timeline navigator ---------- */
function navChart() {
  const el = $('#navChart'), ser = series();
  if (ser.empty) return;
  const { lo, hi } = bounds(), v = viewWindow();
  const W = Math.max(280, el.clientWidth || 320), H = 54, P = { l: 42, r: 14 }, iw = W - P.l - P.r;
  const x = (t) => P.l + ((t - lo) / Math.max(1, hi - lo)) * iw;
  // Background: weekly distance over the whole history.
  const wk = []; let mx = 1;
  for (let w = weekStart(Math.floor(lo)); w <= hi; w += 7) { let s = 0; for (let d = 0; d < 7; d++) { const i = w + d - ser.D0; if (i >= 0 && i < ser.dailyKm.length) s += ser.dailyKm[i]; } wk.push([w, s]); mx = Math.max(mx, s); }
  let area = `M${P.l} ${H - 6}`;
  for (const [w, s] of wk) area += `L${x(w + 3.5).toFixed(1)} ${(H - 6 - (s / mx) * (H - 14)).toFixed(1)}`;
  area += `L${(W - P.r).toFixed(1)} ${H - 6}Z`;
  const xa = x(v.t0), xb = x(v.t1);
  const g = [`<rect x="${P.l}" y="2" width="${iw}" height="${H - 6}" rx="8" fill="var(--surface-2)"/>`, `<path d="${area}" fill="var(--accent)" opacity=".35"/>`];
  for (const [t, l] of timeTicks(lo, hi)) { const xx = x(t); if (xx > P.l + 10 && xx < W - P.r - 10) g.push(`<text x="${xx.toFixed(1)}" y="13" text-anchor="middle" style="font-size:10px">${esc(l)}</text>`); }
  g.push(`<path d="M${P.l} 2H${xa.toFixed(1)}V${H - 4}H${P.l}Z M${xb.toFixed(1)} 2H${W - P.r}V${H - 4}H${xb.toFixed(1)}Z" fill="var(--bg)" opacity=".55"/>`);
  g.push(`<rect class="nav-win" x="${xa.toFixed(1)}" y="2" width="${Math.max(4, xb - xa).toFixed(1)}" height="${H - 6}" rx="6" fill="none" stroke="var(--accent)" stroke-width="2"/>`);
  for (const xx of [xa, xb]) g.push(`<rect x="${(xx - 3).toFixed(1)}" y="${H / 2 - 11}" width="6" height="18" rx="3" fill="var(--accent)"/>`);
  el._geom = { W, l: P.l, iw, lo, hi };
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="slider" aria-label="Visible part of your running history" aria-valuetext="${esc($('#zoomLabel').textContent)}" tabindex="0">${g.join('')}</svg>`;
}

/* ---------- gestures: drag to pan, pinch / Ctrl+wheel / double-click to zoom ---------- */
function plotOf(el) {
  const g = el._geom, rect = el.getBoundingClientRect(), k = rect.width / (g?.W || rect.width);
  return { left: rect.left + (g?.l || 0) * k, width: Math.max(1, (g?.iw || rect.width) * k) };
}
function bindChartGestures(el) {
  const ptrs = new Map();
  let start = null;
  const snap = () => { const v = viewWindow(); start = { t0: v.t0, t1: v.t1, pts: new Map(ptrs) }; };
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ptrs.set(e.pointerId, e.clientX); snap();
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.classList.add('grabbing');
  });
  el.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId) || !start) return;
    ptrs.set(e.pointerId, e.clientX);
    const p = plotOf(el), span = start.t1 - start.t0, ids = [...start.pts.keys()];
    if (ptrs.size === 1 || ids.length < 2) {
      const dx = e.clientX - start.pts.get(e.pointerId);
      const shift = (-dx / p.width) * span;
      setView(start.t0 + shift, start.t1 + shift);
    } else {
      const [a, b] = ids, a0 = start.pts.get(a), b0 = start.pts.get(b), a1 = ptrs.get(a), b1 = ptrs.get(b);
      const d0 = Math.max(10, Math.abs(b0 - a0)), d1 = Math.max(10, Math.abs(b1 - a1));
      const newSpan = (span * d0) / d1, c0 = (a0 + b0) / 2, c1 = (a1 + b1) / 2;
      const anchor = start.t0 + ((c0 - p.left) / p.width) * span;
      const nt0 = anchor - ((c1 - p.left) / p.width) * newSpan;
      setView(nt0, nt0 + newSpan);
    }
  });
  const end = (e) => { ptrs.delete(e.pointerId); if (ptrs.size) snap(); else { start = null; el.classList.remove('grabbing'); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => {
    const p = plotOf(el), v = viewWindow(), span = v.t1 - v.t0;
    if (e.ctrlKey || e.metaKey) { // trackpad pinch arrives as Ctrl + wheel
      e.preventDefault();
      zoomBy(Math.exp(e.deltaY * 0.01), v.t0 + ((e.clientX - p.left) / p.width) * span);
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      e.preventDefault();
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      setView(v.t0 + (dx / p.width) * span, v.t1 + (dx / p.width) * span);
    }
  }, { passive: false });
  el.addEventListener('dblclick', (e) => { const p = plotOf(el), v = viewWindow(); zoomBy(0.5, v.t0 + ((e.clientX - p.left) / p.width) * (v.t1 - v.t0)); });
}
function bindNavigator(el) {
  let mode = null, startX = 0, w0 = null;
  const dayAt = (clientX) => { const g = el._geom, p = plotOf(el); return g.lo + ((clientX - p.left) / p.width) * (g.hi - g.lo); };
  el.addEventListener('pointerdown', (e) => {
    if (!el._geom) return;
    const v = viewWindow(), p = plotOf(el), pxPerDay = p.width / (el._geom.hi - el._geom.lo);
    const xa = p.left + (v.t0 - el._geom.lo) * pxPerDay, xb = p.left + (v.t1 - el._geom.lo) * pxPerDay;
    if (Math.abs(e.clientX - xa) < 10) mode = 'a';
    else if (Math.abs(e.clientX - xb) < 10) mode = 'b';
    else if (e.clientX > xa && e.clientX < xb) mode = 'move';
    else { const span = v.t1 - v.t0, c = dayAt(e.clientX); setView(c - span / 2, c + span / 2); mode = 'move'; }
    startX = e.clientX; w0 = viewWindow();
    try { el.setPointerCapture(e.pointerId); } catch {}
  });
  el.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const g = el._geom, p = plotOf(el), dd = ((e.clientX - startX) / p.width) * (g.hi - g.lo);
    if (mode === 'move') setView(w0.t0 + dd, w0.t1 + dd);
    else if (mode === 'a') setView(Math.min(w0.t0 + dd, w0.t1 - MIN_SPAN), w0.t1);
    else setView(w0.t0, Math.max(w0.t1 + dd, w0.t0 + MIN_SPAN));
  });
  const stop = () => { mode = null; };
  el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop);
  el.addEventListener('keydown', (e) => {
    const v = viewWindow(), span = v.t1 - v.t0;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setView(v.t0 - span / 4, v.t1 - span / 4); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setView(v.t0 + span / 4, v.t1 + span / 4); }
    if (e.key === '+' || e.key === '=') zoomBy(0.5);
    if (e.key === '-') zoomBy(2);
  });
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
  $('#bibName').textContent = s.name || 'spur';
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
  volumeChart();
  navChart();
  zoomStatus();
  renderKpis();
  renderCalendar();
  renderRecords();
  renderOvPredictions();
  const recent = sortRuns(state.runs, { key: 'date', dir: -1 }).slice(0, isWide() ? 6 : 5); // six rows sit level with the six records
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
  const year = state.runs.filter((r) => r.date.startsWith(localToday().slice(0, 4)));
  const first = state.runs.reduce((m, r) => (r.date < m ? r.date : m), state.runs[0].date);
  const st = streak(wk);
  const d28 = prev28 > 0 ? Math.round((last28 / prev28 - 1) * 100) : null;
  const k = [
    ['This week', toUnit(thisW).toFixed(1), uName(), `${weekRuns} ${weekRuns === 1 ? 'run' : 'runs'} · last week ${toUnit(lastW).toFixed(1)} ${uName()}`],
    ['Last 4 weeks', toUnit(last28).toFixed(1), uName(), d28 == null ? 'Nothing earlier to compare with' : `${d28 >= 0 ? '+' : ''}${d28}% on the 4 weeks before`],
    ['This month', month.length, month.length === 1 ? 'run' : 'runs', `${fmtDist(sumKm(month))} ${uName()} so far`],
    ['This year', fmtDist(sumKm(year)), uName(), `${year.length} ${year.length === 1 ? 'run' : 'runs'} in ${localToday().slice(0, 4)}`],
    ['All time', fmtDist(sumKm(state.runs)), uName(), `${state.runs.length} runs since ${fd(dn(first), { month: 'short', year: 'numeric' })}`],
    ['Weekly streak', st, st === 1 ? 'week' : 'weeks', st ? 'Weeks in a row with a run' : 'Run this week to start one'],
  ];
  $('#kpis').innerHTML = k.map(([label, v, u, d]) => `<div class="kpi"><span class="k">${label}</span><span class="v num">${esc(v)}<small>${esc(u)}</small></span><span class="d num">${esc(d)}</span></div>`).join('');
}

/* ---------- activity calendar ---------- */
function renderCalendar() {
  const el = $('#calendar'), W = Math.max(280, el.clientWidth || 320);
  const weeks = W < 560 ? 26 : 53, end = today(), startW = weekStart(end) - 7 * (weeks - 1);
  const byDay = new Map();
  for (const r of state.runs) { const d = dn(r.date); if (d >= startW && d <= end) { const e = byDay.get(d) || { km: 0, n: 0, id: r.id }; e.km += r.km; e.n++; byDay.set(d, e); } }
  // Four shades, split at the quartiles of your own running days.
  const kms = [...byDay.values()].map((e) => e.km).sort((a, b) => a - b);
  const q = (f) => kms[Math.min(kms.length - 1, Math.floor(f * kms.length))] || 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const level = (km) => (km <= 0 ? 0 : km <= cuts[0] ? 1 : km <= cuts[1] ? 2 : km <= cuts[2] ? 3 : 4);
  const left = 30, top = 16, gap = 3, cell = Math.max(6, Math.min(16, (W - left - gap * weeks) / weeks)), step = cell + gap;
  const H = top + 7 * step;
  const g = [];
  ['Mon', 'Wed', 'Fri'].forEach((d, i) => g.push(`<text x="0" y="${top + (i * 2) * step + cell - 1}" style="font-size:10px">${d}</text>`));
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const ws = startW + 7 * w, m = dayToMonth(ws + 6);
    if (m !== lastMonth && w < weeks - 1) { g.push(`<text x="${left + w * step}" y="10" style="font-size:10px">${esc(fd(ws + 6, { month: 'short' }))}</text>`); lastMonth = m; }
    for (let d = 0; d < 7; d++) {
      const day = ws + d; if (day > end) continue;
      const e = byDay.get(day), lv = e ? level(e.km) : 0;
      const tip = `${fd(day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}: ${e ? `${fmtDist(e.km)} ${uName()}${e.n > 1 ? ` (${e.n} runs)` : ''}` : 'rest day'}`;
      g.push(`<rect class="c l${lv}" x="${left + w * step}" y="${top + d * step}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" rx="${Math.min(3, cell / 4).toFixed(1)}"${e ? ` data-id="${esc(e.id)}"` : ''}><title>${esc(tip)}</title></rect>`);
    }
  }
  el.innerHTML = `<svg viewBox="0 0 ${left + weeks * step} ${H}" role="img" aria-label="Running days over the last ${weeks === 53 ? '12 months' : '6 months'}">${g.join('')}</svg>`;
  const total = [...byDay.values()].reduce((a, e) => a + e.km, 0), runs = [...byDay.values()].reduce((a, e) => a + e.n, 0);
  $('#calSummary').textContent = `${fmtDist(total)} ${uName()} · ${runs} runs · ${byDay.size} running days`;
  el.closest('.card').querySelector('h3').textContent = weeks === 53 ? 'Last 12 months' : 'Last 6 months';
}
const dayToMonth = (d) => { const x = new Date(d * DAY); return x.getUTCFullYear() * 12 + x.getUTCMonth(); };

/* ---------- personal records + predictions ---------- */
function renderRecords() {
  const runs = state.runs;
  const best = (list, f, better) => list.reduce((b, r) => (b == null || better(f(r), f(b)) ? r : b), null);
  const longest = best(runs, (r) => r.km, (a, b) => a > b);
  const longTime = best(runs, (r) => r.sec, (a, b) => a > b);
  const fast5 = best(runs.filter((r) => r.km >= 5), (r) => r.sec / r.km, (a, b) => a < b);
  const fast10 = best(runs.filter((r) => r.km >= 10), (r) => r.sec / r.km, (a, b) => a < b);
  const wk = weekly(); let bw = null; for (const [w, km] of wk) if (!bw || km > bw[1]) bw = [w, km];
  const mo = new Map(); for (const r of runs) { const k = r.date.slice(0, 7); mo.set(k, (mo.get(k) || 0) + r.km); }
  let bm = null; for (const [k, km] of mo) if (!bm || km > bm[1]) bm = [k, km];
  const when = (r) => fd(dn(r.date), { day: 'numeric', month: 'short', year: 'numeric' });
  const rows = [
    longest && ['Longest run', `${fmtDist(longest.km)} ${uName()}`, when(longest), longest.id],
    longTime && ['Longest time', fmtDur(longTime.sec), when(longTime), longTime.id],
    fast5 && ['Fastest 5 km+', `${fmtMS(paceU(fast5.sec / fast5.km))} /${uName()}`, `${fmtDist(fast5.km)} ${uName()} · ${when(fast5)}`, fast5.id],
    fast10 && ['Fastest 10 km+', `${fmtMS(paceU(fast10.sec / fast10.km))} /${uName()}`, `${fmtDist(fast10.km)} ${uName()} · ${when(fast10)}`, fast10.id],
    bw && ['Biggest week', `${fmtDist(bw[1])} ${uName()}`, `week of ${fd(bw[0], { day: 'numeric', month: 'short', year: 'numeric' })}`, null],
    bm && ['Biggest month', `${fmtDist(bm[1])} ${uName()}`, fd(dn(bm[0] + '-01'), { month: 'long', year: 'numeric' }), null],
  ].filter(Boolean);
  $('#records').innerHTML = rows.map(([k, v, d, id]) => `<div class="rec"${id ? ` data-id="${esc(id)}" role="button" tabindex="0"` : ''}><span class="rk">${k}</span><span class="rv num">${esc(v)}</span><span class="rd num">${esc(d)}</span></div>`).join('');
}
function renderOvPredictions() {
  const R = riegel(), el = $('#ovPred'), note = $('#ovPredNote');
  if (!R) { note.textContent = ''; el.innerHTML = '<p class="muted small" style="margin:0;grid-column:1/-1">Log a run of 3 km or more to get race-time estimates.</p>'; return; }
  note.textContent = `· from ${fmtDist(R.base.km)} ${uName()} in ${fmtDur(R.base.sec)} on ${fd(dn(R.base.date), { day: 'numeric', month: 'short' })}`;
  el.innerHTML = [['5K', 5], ['10K', 10], ['Half marathon', 21.0975], ['Marathon', 42.195]].map(([n, D]) => {
    const t = R.at(D);
    return `<div class="race"><span class="race-name">${n}</span><span class="race-time num">${fmtDur(t)}</span><span class="race-pace num">${fmtMS(paceU(t / D))} /${uName()}</span><i class="race-bar" aria-hidden="true"><b style="--w:${((D / 42.195) * 100).toFixed(1)}%"></b></i></div>`;
  }).join('');
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
  const cur = weekStart(today()), t = today(), perDay = new Map();
  for (const r of state.runs) { const d = dn(r.date); if (d >= cur - 7) perDay.set(d, (perDay.get(d) || 0) + r.km); }
  let km = 0, last = 0, ran = 0, top = 0;
  for (let i = 0; i < 7; i++) {
    const v = perDay.get(cur + i) || 0;
    km += v; last += perDay.get(cur - 7 + i) || 0; if (v > 0) ran++; top = Math.max(top, v);
  }
  const bars = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = cur + i, v = perDay.get(d) || 0;
    const cls = [v > 0 ? 'on' : '', d === t ? 'today' : '', d > t ? 'later' : ''].filter(Boolean).join(' ');
    const tip = `${fd(d, { weekday: 'long' })}${v > 0 ? `: ${fmtDist(v)} ${uName()}` : ''}`;
    const h = v > 0 && top > 0 ? Math.max(14, Math.round((v / top) * 100)) : 0;
    return `<span class="${cls}" title="${esc(tip)}"><i style="height:${h}%"></i><em>${esc(fd(d, { weekday: 'narrow' }))}</em></span>`;
  }).join('');
  $('#sideWeek').innerHTML = `<div class="sw-head"><span class="k">This week</span><span class="sw-days">${ran} of 7 days</span></div>`
    + `<span class="v num">${toUnit(km).toFixed(1)}<small>${uName()}</small></span><div class="sw-bars">${bars}</div>`
    + `<span class="sw-cmp">Last week ${fmtDist(last)} ${uName()}</span>`;
}
const displayName = (a) => (a?.name || '').trim() || a?.username || '';
const avatarHtml = (a, cls = '') => `<span class="avatar ${cls}" aria-hidden="true">${esc(displayName(a).slice(0, 1) || '?')}</span>`;
const ICON_CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_PLUS = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const ICON_GEAR = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const ICON_OUT = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function meAccount() {
  return { username: state.user?.username || '', name: state.settings.name || '' };
}
function renderSideUser() {
  state.accounts = state.accounts.map((a) => (a.active ? { ...a, name: state.settings.name || '' } : a));
  const me = meAccount(), n = state.accounts.length;
  $('#sideName').textContent = displayName(me);
  $('#sideSub').textContent = me.name ? `@${me.username}` : 'Add your name in Settings';
  $('#sideUser').title = n > 1 ? `${n} accounts signed in. Switch, add an account or sign out` : 'Add an account or sign out';
  $('#sideAvatar').textContent = displayName(me).slice(0, 1) || '?';
  $('#sideCount').textContent = state.runs.length ? state.runs.length.toLocaleString() : '';
  if (!$('#acctMenu').hidden) renderAcctMenu();
}

/* ---------- accounts: several signed in at once ---------- */
async function loadAccounts() {
  try {
    const r = await api('GET', '/api/accounts');
    state.accounts = r.accounts;
    state.maxAccounts = r.maxAccounts;
  } catch { state.accounts = [{ ...meAccount(), active: true }]; }
  renderSideUser(); // also brings the active account's name up to date
  if (currentTab() === 'settings') renderAccountCard();
}
function renderAcctMenu() {
  const rows = state.accounts.map((a) => `<button type="button" role="menuitemradio" aria-checked="${a.active}" data-switch="${esc(a.username)}" class="acct-row">${avatarHtml(a, a.active ? '' : 'other')}<span class="side-who"><b>${esc(displayName(a))}</b><span>@${esc(a.username)}</span></span>${a.active ? ICON_CHECK : ''}</button>`).join('');
  const many = state.accounts.length > 1, full = state.accounts.length >= state.maxAccounts;
  $('#acctMenu').innerHTML = `<div class="menu-k">Signed in on this browser</div>${rows}<hr>`
    + (full ? '' : `<button type="button" role="menuitem" data-act="add">${ICON_PLUS}Add another account</button>`)
    + `<a role="menuitem" href="#settings" data-act="settings">${ICON_GEAR}Profile and settings</a><hr>`
    + `<button type="button" role="menuitem" data-act="out">${ICON_OUT}Sign out of ${esc(displayName(meAccount()))}</button>`
    + (many ? `<button type="button" role="menuitem" data-act="all">${ICON_OUT}Sign out of all accounts</button>` : '');
}
function openAcctMenu(open) {
  const m = $('#acctMenu');
  if (open === !m.hidden) return;
  if (open) renderAcctMenu();
  m.hidden = !open;
  $('#sideUser').setAttribute('aria-expanded', open);
  if (open) m.querySelector('[aria-checked="true"],[role="menuitem"]')?.focus();
}
$('#sideUser').addEventListener('click', () => openAcctMenu($('#acctMenu').hidden));
$('#acctMenu').addEventListener('click', (e) => {
  const el = e.target.closest('[data-switch],[data-act]');
  if (!el) return;
  openAcctMenu(false);
  if (el.dataset.switch) switchAccount(el.dataset.switch);
  else if (el.dataset.act === 'add') startAddAccount();
  else if (el.dataset.act === 'out') signOut();
  else if (el.dataset.act === 'all') signOut({ all: true });
});
$('#acctMenu').addEventListener('keydown', (e) => {
  const items = [...$('#acctMenu').querySelectorAll('button,a')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  } else if (e.key === 'Escape' || e.key === 'Tab') {
    if (e.key === 'Escape') e.preventDefault();
    openAcctMenu(false);
    $('#sideUser').focus();
  }
});
document.addEventListener('click', (e) => { if (!$('#acctMenu').hidden && !e.target.closest('.side-foot')) openAcctMenu(false); });

async function switchAccount(username) {
  if (username.toLowerCase() === state.user?.username.toLowerCase()) return;
  try {
    const me = await api('POST', '/api/accounts/switch', { username });
    await enterApp(me);
    toast(`Switched to ${displayName({ username: me.user.username, name: me.settings?.name })}`);
  } catch (e) { toast(e.message); loadAccounts(); }
}
function startAddAccount() {
  state.adding = true;
  state.signupMode = false;
  $('#authUser').value = $('#authPass').value = '';
  showAuth();
}
async function signOut({ all = false } = {}) {
  const was = displayName(meAccount());
  let r = {};
  try { r = await api('POST', '/api/logout', { all }); } catch {}
  if (r.user) {
    await enterApp(r);
    toast(`Signed out of ${was}`);
  } else {
    state.user = null; state.runs = []; state.accounts = []; state.signupMode = false; state.adding = false;
    showAuth();
  }
}

/* ---------- settings: account card and people on this server ---------- */
function renderAccountCard() {
  const me = meAccount();
  $('#whoName').textContent = displayName(me);
  $('#whoSub').textContent = `@${me.username}${state.user?.isAdmin ? ' · Admin of this server' : ''}`;
  $('#avatar').textContent = displayName(me).slice(0, 1) || '?';
  $('#signOut').textContent = state.accounts.length > 1 ? `Sign out of ${displayName(me)}` : 'Sign out';
  $('#delName').textContent = `@${me.username}`;
  const others = state.accounts.filter((a) => !a.active);
  const full = state.accounts.length >= state.maxAccounts;
  $('#acctList').innerHTML = (others.length ? '<span class="lbl">Also signed in on this browser</span>' : '')
    + others.map((a) => `<div class="acct-line">${avatarHtml(a, 'other')}<span class="side-who"><b>${esc(displayName(a))}</b><span>@${esc(a.username)}</span></span><button class="btn" type="button" data-switch="${esc(a.username)}">Switch</button></div>`).join('')
    + (full ? '' : `<button class="btn ghost add-acct" type="button" data-act="add">${ICON_PLUS}Add another account</button>`);
}
$('#acctList').addEventListener('click', (e) => {
  const el = e.target.closest('[data-switch],[data-act]');
  if (el?.dataset.switch) switchAccount(el.dataset.switch);
  else if (el?.dataset.act === 'add') startAddAccount();
});

async function loadAdmin() {
  if (!state.user?.isAdmin) { $('#membersGroup').hidden = true; return; }
  try { state.admin = await api('GET', '/api/admin'); renderMembers(); }
  catch (e) { $('#membersGroup').hidden = true; if (state.user?.isAdmin) toast(e.message); }
}
function renderMembers() {
  const ad = state.admin;
  $('#membersGroup').hidden = !ad || !state.user?.isAdmin;
  if (!ad) return;
  $$('#signupSeg button').forEach((b) => b.setAttribute('aria-pressed', (b.dataset.v === 'on') === ad.allowSignup));
  $('#signupNote').textContent = ad.allowSignup
    ? 'People can create their own account from the sign-in page.'
    : 'When off, only an admin can add people.';
  const meName = state.user.username.toLowerCase();
  $('#members').innerHTML = ad.users.map((u) => {
    const mine = u.username.toLowerCase() === meName;
    const meta = `@${esc(u.username)} · ${u.runs.toLocaleString()} ${u.runs === 1 ? 'run' : 'runs'}${u.lastRun ? ` · last ${esc(fd(dn(u.lastRun), { day: 'numeric', month: 'short', year: 'numeric' }))}` : ''}`;
    const tags = (u.isAdmin ? '<span class="tag">Admin</span>' : '') + (mine ? '<span class="tag you">You</span>' : '');
    const head = `${avatarHtml(u, mine ? '' : 'other')}<span class="side-who"><b>${esc(displayName(u))}</b><span>${meta}</span></span><span class="tags">${tags}</span>`;
    if (mine) return `<div class="mem mine">${head}</div>`;
    const who = esc(u.username);
    return `<details class="mem"><summary>${head}<svg class="chev" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
      <div class="mem-body">
        <form class="mem-pw" data-u="${who}" novalidate><span class="lbl">New password for @${who}</span><div class="pw-gen"><input class="input" autocomplete="off" spellcheck="false" placeholder="10+ characters" aria-label="New password for ${who}"><button class="btn ghost" type="button" data-gen>Generate</button></div><div class="setrow"><span class="muted small">They're signed out everywhere and use this to sign back in.</span><button class="btn primary" type="submit">Set password</button></div></form>
        <div class="setrow"><span>${u.isAdmin ? 'Admin: can manage people' : 'Not an admin'}</span><button class="btn" type="button" data-admin="${who}" data-v="${!u.isAdmin}">${u.isAdmin ? 'Remove admin' : 'Make admin'}</button></div>
        <div class="setrow"><span>Remove @${who} and all their runs</span><button class="btn danger" type="button" data-del="${who}">Remove</button></div>
      </div></details>`;
  }).join('');
}
const PW_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
function readablePassword() {
  const b = crypto.getRandomValues(new Uint8Array(15));
  const c = [...b].map((x) => PW_CHARS[x % PW_CHARS.length]).join('');
  return `${c.slice(0, 5)}-${c.slice(5, 10)}-${c.slice(10)}`;
}
async function adminCall(method, path, body, done) {
  try { state.admin = await api(method, path, body); renderMembers(); if (done) toast(done); return true; }
  catch (e) { toast(e.message); return false; }
}
$('#signupSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) adminCall('PUT', '/api/admin/signup', { allow: b.dataset.v === 'on' }, b.dataset.v === 'on' ? 'Anyone can now create an account' : 'Only admins can add people now');
});
$('#addGen').addEventListener('click', () => { $('#addPass').value = readablePassword(); });
$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#addUser').value.trim(), password = $('#addPass').value;
  try {
    state.admin = await api('POST', '/api/admin/users', { username, password, admin: $('#addAdmin').checked });
    renderMembers();
    $('#addMsg').textContent = '';
    $('#addUser').value = $('#addPass').value = ''; $('#addAdmin').checked = false;
    toast(`Added @${username}. Give them their password.`);
  } catch (err) { $('#addMsg').textContent = err.message; }
});
$('#members').addEventListener('click', (e) => {
  const gen = e.target.closest('[data-gen]');
  if (gen) { gen.previousElementSibling.value = readablePassword(); return; }
  const adm = e.target.closest('[data-admin]');
  if (adm) { adminCall('PUT', `/api/admin/users/${encodeURIComponent(adm.dataset.admin)}`, { admin: adm.dataset.v === 'true' }, adm.dataset.v === 'true' ? `@${adm.dataset.admin} is now an admin` : `@${adm.dataset.admin} is no longer an admin`); return; }
  const del = e.target.closest('[data-del]');
  if (del) {
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Remove for good?'; return; }
    adminCall('DELETE', `/api/admin/users/${encodeURIComponent(del.dataset.del)}`, undefined, `Removed @${del.dataset.del}`);
  }
});
$('#members').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.closest('.mem-pw'), input = f.querySelector('input');
  if (await adminCall('PUT', `/api/admin/users/${encodeURIComponent(f.dataset.u)}`, { password: input.value }, `New password set for @${f.dataset.u}`)) input.value = '';
});
$('#delAcc').addEventListener('click', () => { $('#delRow').hidden = true; $('#delForm').hidden = false; $('#delPass').focus(); });
$('#delNo').addEventListener('click', () => { $('#delRow').hidden = false; $('#delForm').hidden = true; $('#delPass').value = ''; $('#delMsg').textContent = ''; });
$('#delForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const was = displayName(meAccount());
  try {
    const r = await api('DELETE', '/api/account', { password: $('#delPass').value });
    $('#delPass').value = ''; $('#delNo').click();
    if (r.user) { await enterApp(r); toast(`Deleted ${was}`); }
    else { state.user = null; state.runs = []; state.accounts = []; state.auth = await api('GET', '/api/status').catch(() => state.auth); showAuth(); }
  } catch (err) { $('#delMsg').textContent = err.message; }
});

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
function fmtHeight(cm) {
  if (U() !== 'mi') return `${Math.round(cm)} cm`;
  const inch = Math.round(cm / 2.54);
  return `${Math.floor(inch / 12)} ft ${inch % 12} in`;
}
function renderProfile() {
  const s = state.settings, imperial = U() === 'mi';
  if (document.activeElement?.closest('#profileForm')) return; // don't overwrite what's being typed
  $('#pfName').value = s.name || '';
  $('#pfMetric').hidden = imperial; $('#pfImperial').hidden = !imperial;
  const h = s.heightCm;
  $('#pfCm').value = h ? Math.round(h) : '';
  const inch = h ? Math.round(h / 2.54) : null;
  $('#pfFt').value = inch != null ? Math.floor(inch / 12) : '';
  $('#pfIn').value = inch != null ? inch % 12 : '';
}
function renderSettings() {
  const s = state.settings;
  renderProfile();
  [['#unitSeg', s.unit], ['#metricSeg', s.metric], ['#modeSeg', s.mode], ['#smoothSetSeg', s.smoothing]].forEach(([sel, v]) => $$(sel + ' button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v)));
  $('#swatches').innerHTML = PALETTES.map(([k, n, c]) => `<button class="sw" type="button" data-v="${k}" aria-pressed="${s.palette === k}"><i style="background:${c}"></i>${n}</button>`).join('');
  const hasSamples = state.runs.some((r) => r.sample);
  $('#samplesLabel').textContent = hasSamples ? 'Sample runs are in your diary' : 'Five months of example runs';
  $('#samplesBtn').textContent = hasSamples ? 'Clear samples' : 'Load samples';
  renderAccountCard();
  if (state.user?.isAdmin) { if (state.admin) renderMembers(); else loadAdmin(); }
  else $('#membersGroup').hidden = true;
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
  renderSideUser();
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
  openAcctMenu(false);
  const st = state.auth || {};
  const signup = st.needsSetup || state.signupMode;
  const adding = state.adding && !!state.user;
  $('#authTitle').textContent = st.needsSetup ? 'Create your account' : adding ? (signup ? 'Create another account' : 'Add another account') : signup ? 'Create an account' : 'Sign in to your running diary';
  $('#authSubmit').textContent = signup ? 'Create account' : 'Sign in';
  $('#authPass').autocomplete = signup ? 'new-password' : 'current-password';
  $('#authNote').textContent = st.needsSetup
    ? 'This is the first account on this server. Choose a password of at least 10 characters.'
    : adding ? "You'll stay signed in to your other accounts, and can switch between them from the account menu or Settings."
    : signup ? 'Use a password of at least 10 characters.' : 'Your runs are stored on this server only.';
  $('#authSwitchWrap').hidden = !!st.needsSetup || !st.allowSignup;
  $('#authSwitch').textContent = state.signupMode ? 'I already have an account' : 'Create an account';
  $('#authBackWrap').hidden = !adding;
  if (adding) $('#authBack').textContent = `Back to ${displayName(meAccount())}`;
  $('#authErr').textContent = '';
  setTimeout(() => $('#authUser').focus(), 50);
}
async function enterApp(me) {
  const switched = state.user && state.user.username !== me.user.username;
  state.user = me.user;
  state.adding = false;
  if (switched) { state.view = null; state.year = 'all'; seriesCache = null; }
  state.admin = null;
  // Replace, not merge: one account's name, height or goal must never show up in another's.
  for (const k of Object.keys(state.settings)) delete state.settings[k];
  Object.assign(state.settings, DEFAULTS, me.settings || {});
  cacheSettings();
  const [{ runs }] = await Promise.all([api('GET', '/api/runs'), loadAccounts()]);
  state.runs = runs;
  $('#auth').hidden = true;
  $('#app').hidden = $('#tabs').hidden = false;
  showTab();
}
$('#authSwitch').addEventListener('click', () => { state.signupMode = !state.signupMode; showAuth(); });
$('#authBack').addEventListener('click', () => {
  state.adding = false; state.signupMode = false;
  $('#auth').hidden = true;
  $('#app').hidden = $('#tabs').hidden = false;
  showTab();
});
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
$('#signOut').addEventListener('click', () => signOut());
$('#profileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const msg = $('#pfMsg');
  let cm = null;
  if (U() === 'mi') {
    const ft = $('#pfFt').value.trim(), inch = $('#pfIn').value.trim();
    if (ft || inch) cm = ((Number(ft) || 0) * 12 + (Number(inch) || 0)) * 2.54;
  } else if ($('#pfCm').value.trim()) cm = Number($('#pfCm').value.replace(',', '.'));
  if (cm != null && !(cm >= 100 && cm <= 250)) {
    msg.textContent = U() === 'mi' ? 'Enter a height between 3 ft 4 in and 8 ft 2 in.' : 'Enter a height between 100 and 250 cm.';
    return;
  }
  msg.textContent = '';
  const name = $('#pfName').value.replace(/\s+/g, ' ').trim().slice(0, 40);
  document.activeElement?.blur();
  saveSettings({ name, heightCm: cm == null ? null : Math.round(cm * 10) / 10 });
  toast(cm == null ? 'Profile saved' : `Profile saved · ${fmtHeight(cm)}`);
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
$('#rangeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.view = null; saveSettings({ range: b.dataset.v }); } });
$('#zoomIn').addEventListener('click', () => zoomBy(0.5));
$('#zoomOut').addEventListener('click', () => zoomBy(2));
$('#zoomReset').addEventListener('click', () => { state.view = null; drawTrends(); });
bindChartGestures($('#paceChart')); bindChartGestures($('#volChart')); bindNavigator($('#navChart'));
['#records', '#calendar'].forEach((sel) => {
  $(sel).addEventListener('click', (e) => { const el = e.target.closest('[data-id]'); if (el) openRunFrom(el); });
  $(sel).addEventListener('keydown', (e) => { const el = e.target.closest('[data-id]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openRunFrom(el); } });
});
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
  if (!csv.trim()) return (msg.textContent = 'That file is empty.');
  try {
    const r = await api('POST', '/api/import', { csv });
    state.runs = (await api('GET', '/api/runs')).runs;
    const parts = [`${r.added} imported`];
    if (r.duplicates) parts.push(`${r.duplicates} already in your diary`);
    if (r.skipped) parts.push(`${r.skipped} ${r.skipped === 1 ? 'line' : 'lines'} skipped (use date,km,h:mm:ss)`);
    msg.textContent = parts.join(', ') + '.';
    if (r.added) toast(`Imported ${r.added} ${r.added === 1 ? 'run' : 'runs'}`);
    render();
  } catch (e) { msg.textContent = e.message; }
}
$('#importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) { $('#importMsg').textContent = 'That file is larger than 1.5 MB. Split it into smaller files.'; return; }
  const reader = new FileReader();
  reader.onload = () => importCsv(String(reader.result).replace(/^\uFEFF/, ''));
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
    else if (currentTab() === 'overview' && state.runs.length) { drawTrends(); renderCalendar(); }
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
