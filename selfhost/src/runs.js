// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane
//
// Validation, CSV and sample data. The CSV format is the same as the spur
// Android app's (date,distance_km,duration), so runs move freely between them.

import crypto from 'node:crypto';

const pad = (n) => String(n).padStart(2, '0');
const DAY = 86400000;

export const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
};
export const isoFromDay = (n) => {
  const d = new Date(n * DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return isoFromDay(dayNumber(s)) === s;
}

export const newRunId = () => 'r' + crypto.randomBytes(9).toString('base64url');

/** Returns { run } or { error } with a message a person can act on. */
export function checkRun(body) {
  const { date, km, sec } = body ?? {};
  if (!validDate(date)) return { error: 'Use a date in the form YYYY-MM-DD.' };
  // One day of slack, because the browser's "today" may be ahead of the server's.
  if (dayNumber(date) > dayNumber(todayIso()) + 1) return { error: "That date is in the future. Log runs once they're done." };
  const k = Number(km), s = Math.round(Number(sec));
  if (!(k > 0)) return { error: 'Enter how far you ran.' };
  if (k > 500) return { error: 'That is over 500 km. Check the distance.' };
  if (!(s > 0)) return { error: 'Enter how long the run took.' };
  const pace = s / k;
  if (pace < 150 || pace > 1500) return { error: 'That pace looks off. Check the distance and time.' };
  return { run: { date, km: Math.round(k * 1000) / 1000, sec: s } };
}

const fmtDuration = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

export function parseDuration(text) {
  const s = String(text ?? '').trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const p = s.split(':');
  if (p.length < 2 || p.length > 3 || p.some((x) => !/^\d+$/.test(x))) return NaN;
  const n = p.map(Number);
  return p.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n[0] * 60 + n[1];
}

export function toCsv(runs) {
  const lines = runs.map((r) => `${r.date},${r.km.toFixed(2)},${fmtDuration(r.sec)}`);
  return ['date,distance_km,duration', ...lines].join('\n') + '\n';
}

/** Parses CSV text into candidate runs. Bad lines are counted, not thrown. */
export function parseCsv(text) {
  const runs = [];
  let skipped = 0;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Tabs or semicolons win over commas, so "5,0" can be a decimal in those files.
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const cells = line.split(sep).map((c) => c.trim());
    if (/date/i.test(cells[0])) continue;
    const res = checkRun({
      date: cells[0],
      km: parseFloat(String(cells[1] ?? '').replace(',', '.')),
      sec: parseDuration(cells[2]),
    });
    if (res.error) skipped++;
    else runs.push(res.run);
  }
  return { runs, skipped };
}

const ALLOWED = {
  unit: ['km', 'mi'],
  metric: ['pace', 'speed'],
  palette: ['tartan', 'trail', 'lake', 'golden'],
  mode: ['system', 'light', 'dark'],
  range: ['1M', '3M', '6M', '1Y', 'All'],
  smoothing: ['off', 'soft', 'medium', 'strong'],
  volume: ['distance', 'time'],
};

/** Keeps only known settings with allowed values. */
export function cleanSettings(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, values] of Object.entries(ALLOWED)) {
    if (values.includes(input[k])) out[k] = input[k];
  }
  const g = Number(input.goal);
  if (input.goal === null) out.goal = null;
  else if (g >= 150 && g <= 1200) out.goal = g;
  // Profile: a first name for the race bib, and height in centimetres.
  if (typeof input.name === 'string') {
    out.name = input.name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  }
  const h = Number(input.heightCm);
  if (input.heightCm === null) out.heightCm = null;
  else if (h >= 100 && h <= 250) out.heightCm = Math.round(h * 10) / 10;
  return out;
}

/** Five months of example runs that slowly get faster. */
export function sampleRuns(today = todayIso()) {
  let seed = 20261102;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const t = dayNumber(today), span = 154, start = t - span;
  const out = [];
  for (let n = start; n < t; n++) {
    const w = (new Date(n * DAY).getUTCDay() + 6) % 7;
    const prog = (n - start) / span;
    let km = null;
    if (w === 1 || w === 3) { if (rnd() < 0.88) km = 5 + rnd() * 2.5 + prog * 1.5; }
    else if (w === 6) { if (rnd() < 0.9) km = 8.5 + prog * 7.5 + rnd() * 1.5; }
    else if (w === 4 && rnd() < 0.3) km = 4 + rnd() * 2;
    if (km == null) continue;
    km = Math.round(km * 100) / 100;
    const pace = 366 - prog * 50 + (km > 9 ? 20 : 0) + (rnd() - 0.5) * 28;
    out.push({ id: `sample-${isoFromDay(n)}`, date: isoFromDay(n), km, sec: Math.round(km * pace), sample: true });
  }
  return out;
}
