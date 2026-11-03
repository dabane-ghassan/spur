// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/analysis.dart';
import '../core/dates.dart';
import '../core/units.dart';
import '../data/run_store.dart';
import 'theme.dart';

// ---------------------------------------------------------------------------
// Pace / speed over time
// ---------------------------------------------------------------------------

class PaceChart extends StatelessWidget {
  const PaceChart({
    super.key,
    required this.analysis,
    required this.units,
    required this.metric,
    required this.range,
    this.goalSecPerKm,
  });

  final Analysis analysis;
  final Units units;
  final ChartMetric metric;
  final ChartRange range;
  final double? goalSecPerKm;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isPace = metric == ChartMetric.pace;
    double conv(double secPerKm) => isPace ? units.pace(secPerKm) : units.speed(secPerKm);

    if (analysis.isEmpty) {
      return const _ChartMessage('No runs yet. Tap Log run to add your first.');
    }
    final (t0, t1) = _rangeDays(analysis, range);

    final dots = [
      for (final r in analysis.runs)
        if (r.day >= t0 && r.day <= t1) _Dot(r.day, conv(r.secPerKm), r.km >= 10),
    ];
    final smooth = analysis.smoothing.isOn;
    final trend = <_Pt?>[
      if (smooth)
        for (var t = t0; t <= t1; t++)
          if (analysis.smoothAt(t) case final v?) _Pt(t, conv(v)) else null,
    ];
    if (dots.isEmpty && trend.every((p) => p == null)) {
      return const _ChartMessage('No runs in this range. Try a longer one.');
    }

    return SizedBox(
      height: 230,
      width: double.infinity,
      child: CustomPaint(
        painter: _PacePainter(
          t0: t0,
          t1: t1,
          dots: dots,
          trend: trend,
          joinGap: smooth ? null : analysis.gapLimit,
          goal: goalSecPerKm == null ? null : conv(goalSecPerKm!),
          invert: isPace,
          format: isPace ? fmtMinSec : (v) => v.toStringAsFixed(1),
          accent: scheme.primary,
          soft: scheme.primaryContainer,
          grid: scheme.outlineVariant,
          label: scheme.onSurfaceVariant,
          strong: scheme.onSurface,
          surface: scheme.surfaceContainerLow,
        ),
      ),
    );
  }
}

class _ChartMessage extends StatelessWidget {
  const _ChartMessage(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 160,
        child: Center(
          child: Text(
            text,
            textAlign: TextAlign.center,
            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
        ),
      );
}

class _Dot {
  const _Dot(this.day, this.value, this.long);
  final int day;
  final double value;
  final bool long;
}

class _Pt {
  const _Pt(this.day, this.value);
  final int day;
  final double value;
}

void _text(Canvas c, String s, Offset at, TextStyle style, {TextAlign align = TextAlign.left, bool vCenter = false}) {
  final tp = TextPainter(text: TextSpan(text: s, style: style), textDirection: TextDirection.ltr)..layout();
  var dx = at.dx;
  if (align == TextAlign.right) dx -= tp.width;
  if (align == TextAlign.center) dx -= tp.width / 2;
  tp.paint(c, Offset(dx, vCenter ? at.dy - tp.height / 2 : at.dy));
}

/// Time axis: weeks for short ranges, months otherwise.
List<(int, String)> _timeTicks(int t0, int t1) {
  final span = t1 - t0;
  final ticks = <(int, String)>[];
  if (span <= 45) {
    for (var d = weekStart(t0) + 7; d <= t1; d += 7) {
      ticks.add((d, fmtDayMonth(d)));
    }
    return ticks;
  }
  final every = span > 500 ? 3 : (span > 200 ? 2 : 1);
  var m = monthStart(t0);
  if (m < t0) m = nextMonthStart(t0);
  var i = 0;
  while (m <= t1) {
    if (i % every == 0) {
      final d = dayToDate(m);
      final name = monthsShort[d.month - 1];
      ticks.add((m, span > 300 ? "$name '${(d.year % 100).toString().padLeft(2, '0')}" : name));
    }
    m = nextMonthStart(m);
    i++;
  }
  return ticks;
}

void _drawTimeAxis(Canvas canvas, Size size, int t0, int t1, double Function(num) x, double l, double r, double b,
    Paint gridPaint, TextStyle labelStyle) {
  for (final (day, text) in _timeTicks(t0, t1)) {
    final xx = x(day);
    if (xx < l + 14 || xx > size.width - r - 14) continue;
    canvas.drawLine(Offset(xx, size.height - b), Offset(xx, size.height - b + 4), gridPaint);
    _text(canvas, text, Offset(xx, size.height - b + 6), labelStyle, align: TextAlign.center);
  }
}

/// Same range for every trend chart: [t0, t1] in days.
(int, int) _rangeDays(Analysis analysis, ChartRange range) {
  final t1 = math.max(analysis.today, analysis.lastDay!);
  return (range.days != null ? t1 - range.days! : analysis.runs.first.day - 3, t1);
}

double _niceStep(double span, List<double> steps) {
  for (final s in steps) {
    if (span / s <= 5) return s;
  }
  return steps.last;
}

class _PacePainter extends CustomPainter {
  _PacePainter({
    required this.t0,
    required this.t1,
    required this.dots,
    required this.trend,
    required this.joinGap,
    required this.goal,
    required this.invert,
    required this.format,
    required this.accent,
    required this.soft,
    required this.grid,
    required this.label,
    required this.strong,
    required this.surface,
  });

  final int t0, t1;
  final List<_Dot> dots;
  final List<_Pt?> trend;

  /// When smoothing is off: join the runs directly, breaking the line across
  /// gaps longer than this many days. Null draws [trend] instead.
  final double? joinGap;
  final double? goal;

  /// Pace: lower is faster, so faster values are drawn at the top.
  final bool invert;
  final String Function(double) format;
  final Color accent, soft, grid, label, strong, surface;

  @override
  void paint(Canvas canvas, Size size) {
    const l = 44.0, r = 12.0, t = 16.0, b = 24.0;
    final iw = size.width - l - r, ih = size.height - t - b;
    final labelStyle = TextStyle(fontFamily: kBodyFont, fontSize: 11, color: label, fontFeatures: tabular);

    final values = [
      ...dots.map((d) => d.value),
      ...trend.whereType<_Pt>().map((p) => p.value),
      if (goal != null) goal!,
    ];
    var lo = values.reduce(math.min), hi = values.reduce(math.max);
    final step = invert
        ? _niceStep(hi - lo, const [10, 15, 20, 30, 60, 120, 300])
        : _niceStep(hi - lo, const [0.25, 0.5, 1, 2, 5, 10]);
    lo = (lo / step).floor() * step;
    hi = (hi / step).ceil() * step;
    if (hi <= lo) hi = lo + step;

    final span = math.max(1, t1 - t0);
    double x(num day) => l + (day - t0) / span * iw;
    double y(double v) => invert ? t + (v - lo) / (hi - lo) * ih : t + (hi - v) / (hi - lo) * ih;

    // Horizontal grid + value labels.
    final gridPaint = Paint()
      ..color = grid
      ..strokeWidth = 1;
    for (var v = lo; v <= hi + 1e-9; v += step) {
      final yy = y(v);
      canvas.drawLine(Offset(l, yy), Offset(size.width - r, yy), gridPaint);
      _text(canvas, format(v), Offset(l - 6, yy), labelStyle, align: TextAlign.right, vCenter: true);
    }

    _drawTimeAxis(canvas, size, t0, t1, x, l, r, b, gridPaint, labelStyle);

    _text(canvas, 'FASTER ↑', Offset(l + 4, 0), labelStyle.copyWith(fontSize: 10, letterSpacing: 0.8));

    // Goal line (dashed).
    if (goal != null) {
      final gy = y(goal!);
      final dash = Paint()
        ..color = label
        ..strokeWidth = 1.5;
      for (var xx = l; xx < size.width - r; xx += 11) {
        canvas.drawLine(Offset(xx, gy), Offset(math.min(xx + 6, size.width - r), gy), dash);
      }
      _text(canvas, 'goal ${format(goal!)}', Offset(size.width - r, gy - 16),
          labelStyle.copyWith(color: strong, fontWeight: FontWeight.w600),
          align: TextAlign.right);
    }

    // Individual runs.
    final fill = Paint()..color = soft;
    final ring = Paint()
      ..color = accent
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4;
    for (final d in dots) {
      final c = Offset(x(d.day), y(d.value));
      final rad = d.long ? 4.2 : 3.2;
      canvas.drawCircle(c, rad, fill);
      canvas.drawCircle(c, rad, ring);
    }

    if (joinGap != null) {
      // Smoothing off: join the runs as they are, breaking across long gaps.
      final joined = Path();
      _Dot? prev;
      for (final d in dots) {
        final o = Offset(x(d.day), y(d.value));
        if (prev != null && d.day - prev.day <= joinGap!) {
          joined.lineTo(o.dx, o.dy);
        } else {
          joined.moveTo(o.dx, o.dy);
        }
        prev = d;
      }
      canvas.drawPath(
        joined,
        Paint()
          ..color = accent.withValues(alpha: 0.75)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.6
          ..strokeJoin = StrokeJoin.round,
      );
      return;
    }

    // Smoothed trend, broken where there's no data.
    final path = Path();
    var pen = false;
    _Pt? last;
    for (final p in trend) {
      if (p == null) {
        pen = false;
        continue;
      }
      final o = Offset(x(p.day), y(p.value));
      if (pen) {
        path.lineTo(o.dx, o.dy);
      } else {
        path.moveTo(o.dx, o.dy);
      }
      pen = true;
      last = p;
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = accent.withValues(alpha: 0.18)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 6
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
    canvas.drawPath(
      path,
      Paint()
        ..color = accent
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.6
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
    if (last != null) {
      final e = Offset(x(last.day), y(last.value));
      canvas.drawCircle(e, 7.5, Paint()..color = surface);
      canvas.drawCircle(e, 5.5, Paint()..color = accent);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}

// ---------------------------------------------------------------------------
// Volume: distance or time per week, with its smoothed trend
// ---------------------------------------------------------------------------

class VolumeChart extends StatelessWidget {
  const VolumeChart({
    super.key,
    required this.analysis,
    required this.units,
    required this.range,
    required this.metric,
  });

  final Analysis analysis;
  final Units units;
  final ChartRange range;
  final VolumeMetric metric;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    if (analysis.isEmpty) return const _ChartMessage('No runs yet.');
    final isTime = metric == VolumeMetric.time;
    double conv(double v) => isTime ? v : units.toUnit(v);
    final (t0, t1) = _rangeDays(analysis, range);
    final daily = analysis.dailyVolume(metric);
    final weeks = <(int, double)>[];
    for (var w = weekStart(t0); w <= t1; w += 7) {
      var v = 0.0;
      for (var d = 0; d < 7; d++) {
        v += daily[w + d] ?? 0.0;
      }
      weeks.add((w, conv(v)));
    }
    final trend = <_Pt?>[
      if (analysis.smoothing.isOn)
        for (var t = t0; t <= t1; t++)
          if (analysis.volumeAt(t, daily) case final v?) _Pt(t, conv(v)) else null,
    ];
    return SizedBox(
      height: 190,
      width: double.infinity,
      child: CustomPaint(
        painter: _VolumePainter(
          t0: t0,
          t1: t1,
          weeks: weeks,
          trend: trend,
          current: weekStart(analysis.today),
          isTime: isTime,
          unitLabel: isTime ? 'H' : units.name.toUpperCase(),
          accent: scheme.primary,
          soft: scheme.primaryContainer,
          grid: scheme.outlineVariant,
          label: scheme.onSurfaceVariant,
          ink: scheme.onSurface,
          surface: scheme.surfaceContainerLow,
        ),
      ),
    );
  }
}

class _VolumePainter extends CustomPainter {
  _VolumePainter({
    required this.t0,
    required this.t1,
    required this.weeks,
    required this.trend,
    required this.current,
    required this.isTime,
    required this.unitLabel,
    required this.accent,
    required this.soft,
    required this.grid,
    required this.label,
    required this.ink,
    required this.surface,
  });

  final int t0, t1, current;
  final List<(int, double)> weeks;
  final List<_Pt?> trend;
  final bool isTime;
  final String unitLabel;
  final Color accent, soft, grid, label, ink, surface;

  @override
  void paint(Canvas canvas, Size size) {
    const l = 40.0, r = 12.0, t = 16.0, b = 24.0;
    final iw = size.width - l - r, ih = size.height - t - b;
    final labelStyle = TextStyle(fontFamily: kBodyFont, fontSize: 11, color: label, fontFeatures: tabular);
    final values = [...weeks.map((w) => w.$2), ...trend.whereType<_Pt>().map((p) => p.value)];
    final maxV = values.isEmpty ? 0.0 : values.reduce(math.max);
    final step = _niceStep(math.max(maxV, 1), isTime ? const [0.5, 1, 2, 3, 5, 10] : const [5, 10, 20, 25, 50, 100]);
    final hi = math.max(step, (math.max(maxV, 0.0001) / step).ceil() * step);
    final span = math.max(1, t1 - t0);
    double x(num day) => l + (day - t0) / span * iw;
    double y(double v) => t + (hi - v) / hi * ih;

    final gridPaint = Paint()
      ..color = grid
      ..strokeWidth = 1;
    for (var v = 0.0; v <= hi + 1e-9; v += step) {
      final yy = y(v);
      canvas.drawLine(Offset(l, yy), Offset(size.width - r, yy), gridPaint);
      _text(canvas, v % 1 == 0 ? v.toStringAsFixed(0) : v.toStringAsFixed(1), Offset(l - 6, yy), labelStyle,
          align: TextAlign.right, vCenter: true);
    }
    _drawTimeAxis(canvas, size, t0, t1, x, l, r, b, gridPaint, labelStyle);
    _text(canvas, '$unitLabel / WEEK', Offset(l + 4, 0), labelStyle.copyWith(fontSize: 10, letterSpacing: 0.8));

    // Calendar weeks, Monday to Sunday. The current week is still filling up.
    final dayW = iw / span;
    for (final (w, v) in weeks) {
      final xa = math.max(l, x(w) + dayW * 0.6), xb = math.min(size.width - r, x(w + 7) - dayW * 0.6);
      if (v <= 0 || xb - xa < 1) continue;
      final rect = RRect.fromRectAndRadius(
        Rect.fromLTRB(xa, y(v), xb, size.height - b),
        Radius.circular(math.min(4, (xb - xa) / 3)),
      );
      final isCur = w == current;
      canvas.drawRRect(rect, Paint()..color = isCur ? accent : soft);
      if (!isCur) {
        canvas.drawRRect(
          rect,
          Paint()
            ..color = accent.withValues(alpha: 0.5)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1,
        );
      }
    }

    // Volume trend line.
    final path = Path();
    var pen = false;
    _Pt? last;
    for (final p in trend) {
      if (p == null) {
        pen = false;
        continue;
      }
      final o = Offset(x(p.day), y(p.value));
      if (pen) {
        path.lineTo(o.dx, o.dy);
      } else {
        path.moveTo(o.dx, o.dy);
      }
      pen = true;
      last = p;
    }
    if (last == null) return;
    canvas.drawPath(
      path,
      Paint()
        ..color = surface.withValues(alpha: 0.9)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 6
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
    canvas.drawPath(
      path,
      Paint()
        ..color = ink
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.4
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
    final e = Offset(x(last.day), y(last.value));
    canvas.drawCircle(e, 6.5, Paint()..color = surface);
    canvas.drawCircle(e, 4.5, Paint()..color = ink);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
