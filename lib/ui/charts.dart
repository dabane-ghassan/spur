// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../core/analysis.dart';
import '../core/dates.dart';
import '../core/units.dart';
import '../data/run_store.dart';
import 'theme.dart';

// ---------------------------------------------------------------------------
// The visible window of the timeline, shared by the trend charts
// ---------------------------------------------------------------------------

class TrendWindow {
  const TrendWindow(this.t0, this.t1, this.lo, this.hi);

  /// Shown part of the timeline, in days (fractions allowed while zooming).
  final double t0, t1;

  /// The whole history.
  final double lo, hi;

  static const double minSpan = 14;

  double get span => math.max(1.0, t1 - t0);
  bool get isFull => t1 - t0 >= hi - lo - 0.5;
  bool get isMin => t1 - t0 <= minSpan + 0.5;

  static TrendWindow of(Analysis a, ChartRange range, (double, double)? view) {
    final lo = (a.seriesStart - 3).toDouble(), hi = a.seriesEnd.toDouble();
    if (view != null) return TrendWindow(view.$1, view.$2, lo, hi);
    final days = range.days;
    return TrendWindow(days == null ? lo : hi - days, hi, lo, hi);
  }

  /// A window moved into the history and kept between [minSpan] and everything.
  (double, double) clamp(double a, double b) {
    final span = math.min(math.max(b - a, minSpan), hi - lo);
    var start = a;
    if (start + span > hi) start = hi - span;
    if (start < lo) start = lo;
    return (start, start + span);
  }

  (double, double) zoom(double factor, [double? center]) {
    final c = center ?? (t0 + t1) / 2, f = (c - t0) / span, s = span * factor;
    return clamp(c - f * s, c - f * s + s);
  }

  (double, double) pan(double days) => clamp(t0 + days, t1 + days);
}

// ---------------------------------------------------------------------------
// Shared drawing helpers
// ---------------------------------------------------------------------------

class _ChartMessage extends StatelessWidget {
  const _ChartMessage(this.text, {this.height = 160});

  final String text;
  final double height;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: height,
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
  final double day;
  final double value;
}

void _text(Canvas c, String s, Offset at, TextStyle style, {TextAlign align = TextAlign.left, bool vCenter = false}) {
  final tp = TextPainter(text: TextSpan(text: s, style: style), textDirection: TextDirection.ltr)..layout();
  var dx = at.dx;
  if (align == TextAlign.right) dx -= tp.width;
  if (align == TextAlign.center) dx -= tp.width / 2;
  tp.paint(c, Offset(dx, vCenter ? at.dy - tp.height / 2 : at.dy));
}

double _niceStep(double span, List<double> steps) {
  for (final s in steps) {
    if (span / s <= 5) return s;
  }
  return steps.last;
}

/// Weeks for short spans, months for medium ones, years for long ones.
List<(int, String)> _timeTicks(double t0, double t1) {
  final span = t1 - t0;
  final ticks = <(int, String)>[];
  if (span <= 45) {
    for (var d = weekStart(t0.floor()) + 7; d <= t1; d += 7) {
      ticks.add((d, fmtDayMonth(d)));
    }
    return ticks;
  }
  if (span > 900) {
    for (var y = dayToDate(t0.floor()).year + 1;; y++) {
      final d = dayFromYmd(y, 1, 1);
      if (d > t1) break;
      ticks.add((d, '$y'));
    }
    return ticks;
  }
  final every = span > 500 ? 3 : (span > 200 ? 2 : 1);
  var m = nextMonthStart(t0.floor() - 1);
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

void _drawTimeAxis(Canvas canvas, Size size, double t0, double t1, double Function(num) x, double l, double r, double b,
    Paint gridPaint, TextStyle labelStyle) {
  for (final (day, text) in _timeTicks(t0, t1)) {
    final xx = x(day);
    if (xx < l + 14 || xx > size.width - r - 14) continue;
    canvas.drawLine(Offset(xx, size.height - b), Offset(xx, size.height - b + 4), gridPaint);
    _text(canvas, text, Offset(xx, size.height - b + 6), labelStyle, align: TextAlign.center);
  }
}

Path _pathOf(List<_Pt?> pts, double Function(num) x, double Function(double) y) {
  final path = Path();
  var pen = false;
  for (final p in pts) {
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
  }
  return path;
}

Paint _stroke(Color c, double w) => Paint()
  ..color = c
  ..style = PaintingStyle.stroke
  ..strokeWidth = w
  ..strokeCap = StrokeCap.round
  ..strokeJoin = StrokeJoin.round;

// Plot insets, shared with the gesture code so a finger maps to the right day.
const double kPlotLeft = 44, kPlotRight = 12;

// ---------------------------------------------------------------------------
// Pace / speed over time
// ---------------------------------------------------------------------------

class PaceChart extends StatelessWidget {
  const PaceChart({
    super.key,
    required this.analysis,
    required this.units,
    required this.metric,
    required this.window,
    this.goalSecPerKm,
  });

  final Analysis analysis;
  final Units units;
  final ChartMetric metric;
  final TrendWindow window;
  final double? goalSecPerKm;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isPace = metric == ChartMetric.pace;
    double conv(double secPerKm) => isPace ? units.pace(secPerKm) : units.speed(secPerKm);

    if (analysis.isEmpty) return const _ChartMessage('No runs yet. Tap Log run to add your first.', height: 230);
    final t0 = window.t0, t1 = window.t1;
    final dots = [
      for (final r in analysis.runs)
        if (r.day >= t0 && r.day <= t1) _Dot(r.day, conv(r.secPerKm), r.km >= 10),
    ];
    final smooth = analysis.smoothing.isOn;
    // About two trend points per logical pixel is plenty, whatever the zoom.
    final step = math.max(1, (window.span / 400).floor());
    final trend = <_Pt?>[
      if (smooth)
        for (var t = t0.ceil(); t <= t1; t += step)
          if (analysis.paceOn(t) case final v?) _Pt(t.toDouble(), conv(v)) else null,
    ];
    if (dots.isEmpty && trend.every((p) => p == null)) {
      return const _ChartMessage('No runs in this part of the timeline.\nZoom out or move along.', height: 230);
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
          showEnd: t1 >= analysis.today - 1,
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

class _PacePainter extends CustomPainter {
  _PacePainter({
    required this.t0,
    required this.t1,
    required this.dots,
    required this.trend,
    required this.joinGap,
    required this.showEnd,
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

  final double t0, t1;
  final List<_Dot> dots;
  final List<_Pt?> trend;

  /// When smoothing is off: join the runs directly, breaking the line across
  /// gaps longer than this many days. Null draws [trend] instead.
  final double? joinGap;
  final bool showEnd;
  final double? goal;

  /// Pace: lower is faster, so faster values are drawn at the top.
  final bool invert;
  final String Function(double) format;
  final Color accent, soft, grid, label, strong, surface;

  @override
  void paint(Canvas canvas, Size size) {
    const l = kPlotLeft, r = kPlotRight, t = 16.0, b = 24.0;
    final iw = size.width - l - r, ih = size.height - t - b;
    final labelStyle = TextStyle(fontFamily: kBodyFont, fontSize: 11, color: label, fontFeatures: tabular);

    // Scale to your typical runs: the odd walk or hike would otherwise flatten everything.
    final sorted = dots.map((d) => d.value).toList()..sort();
    double pick(double f) => sorted[math.min(sorted.length - 1, math.max(0, ((sorted.length - 1) * f).round()))];
    final core = <double>[
      if (sorted.length >= 20) ...[pick(0.02), pick(0.98)] else ...sorted,
      ...trend.whereType<_Pt>().map((p) => p.value),
      if (goal != null) goal!,
    ];
    var lo = core.reduce(math.min), hi = core.reduce(math.max);
    final step = invert
        ? _niceStep(hi - lo, const [10, 15, 20, 30, 60, 120, 300])
        : _niceStep(hi - lo, const [0.25, 0.5, 1, 2, 5, 10]);
    lo = (lo / step).floor() * step;
    hi = (hi / step).ceil() * step;
    if (hi <= lo) hi = lo + step;

    final span = math.max(1.0, t1 - t0);
    double x(num day) => l + (day - t0) / span * iw;
    double yRaw(double v) => invert ? t + (v - lo) / (hi - lo) * ih : t + (hi - v) / (hi - lo) * ih;
    double y(double v) => math.min(t + ih, math.max(t, yRaw(v)));

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

    canvas.save();
    canvas.clipRect(Rect.fromLTWH(l, 0, iw, size.height));

    // Fewer pixels per run → smaller, lighter dots, so a long history stays readable.
    final density = dots.length / iw;
    final dense = density > 0.3;
    final r0 = density > 0.6 ? 1.6 : (dense ? 2.2 : 3.2);
    final fill = Paint()..color = soft.withValues(alpha: dense ? 0.6 : 1);
    final ring = _stroke(accent.withValues(alpha: dense ? 0.6 : 1), dense ? 0.8 : 1.4);
    final outlier = _stroke(accent.withValues(alpha: 0.45), 1);
    for (final d in dots) {
      final c = Offset(x(d.day), y(d.value));
      if (y(d.value) != yRaw(d.value)) {
        canvas.drawCircle(c, 1.8, outlier); // off the scale: pinned to the edge
        continue;
      }
      final rad = d.long && !dense ? r0 + 1 : r0;
      canvas.drawCircle(c, rad, fill);
      canvas.drawCircle(c, rad, ring);
    }

    if (joinGap != null) {
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
      canvas.drawPath(joined, _stroke(accent.withValues(alpha: 0.75), dense ? 1 : 1.6));
      canvas.restore();
      return;
    }

    final path = _pathOf(trend, x, y);
    canvas.drawPath(path, _stroke(surface.withValues(alpha: 0.7), 6));
    canvas.drawPath(path, _stroke(accent, 2.6));
    final last = trend.lastWhere((p) => p != null, orElse: () => null);
    if (last != null && showEnd) {
      final e = Offset(x(last.day), y(last.value));
      canvas.drawCircle(e, 7.5, Paint()..color = surface);
      canvas.drawCircle(e, 5.5, Paint()..color = accent);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}

// ---------------------------------------------------------------------------
// Volume: distance or time per week, with its smoothed trend
// ---------------------------------------------------------------------------

class _Bar {
  const _Bar(this.a, this.b, this.value, this.current);
  final int a, b;
  final double value;
  final bool current;
}

class VolumeChart extends StatelessWidget {
  const VolumeChart({
    super.key,
    required this.analysis,
    required this.units,
    required this.window,
    required this.metric,
  });

  final Analysis analysis;
  final Units units;
  final TrendWindow window;
  final VolumeMetric metric;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    if (analysis.isEmpty) return const _ChartMessage('No runs yet.');
    final isTime = metric == VolumeMetric.time;
    double conv(double v) => isTime ? v : units.toUnit(v);
    final t0 = window.t0, t1 = window.t1;
    final daily = analysis.dailyVolume(metric);
    final today = analysis.today, cur = weekStart(today);
    return LayoutBuilder(builder: (context, c) {
      final iw = c.maxWidth - kPlotLeft - kPlotRight;
      // Weekly bars, or monthly bars (as an average per week) when weeks get too thin to see.
      final monthly = 7 * iw / window.span < 4;
      final bars = <_Bar>[];
      if (!monthly) {
        for (var w = weekStart(t0.floor()); w <= t1; w += 7) {
          var v = 0.0;
          for (var d = 0; d < 7; d++) {
            v += daily[w + d] ?? 0.0;
          }
          bars.add(_Bar(w, w + 7, conv(v), w == cur));
        }
      } else {
        for (var a = monthStart(t0.floor()); a <= t1; a = nextMonthStart(a)) {
          final b = nextMonthStart(a);
          var tot = 0.0;
          for (var t = a; t < b; t++) {
            tot += daily[t] ?? 0.0;
          }
          final days = math.max(1, math.min(b, today + 1) - a);
          bars.add(_Bar(a, b, conv(tot / days * 7), a <= today && today < b));
        }
      }
      final step = math.max(1, (window.span / 400).floor());
      final trend = <_Pt?>[
        if (analysis.smoothing.isOn)
          for (var t = t0.ceil(); t <= t1; t += step)
            if (analysis.volumeOn(t, metric) case final v?) _Pt(t.toDouble(), conv(v)) else null,
      ];
      return SizedBox(
        height: 190,
        width: double.infinity,
        child: CustomPaint(
          painter: _VolumePainter(
            t0: t0,
            t1: t1,
            bars: bars,
            trend: trend,
            monthly: monthly,
            showEnd: t1 >= today - 1,
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
    });
  }
}

class _VolumePainter extends CustomPainter {
  _VolumePainter({
    required this.t0,
    required this.t1,
    required this.bars,
    required this.trend,
    required this.monthly,
    required this.showEnd,
    required this.isTime,
    required this.unitLabel,
    required this.accent,
    required this.soft,
    required this.grid,
    required this.label,
    required this.ink,
    required this.surface,
  });

  final double t0, t1;
  final List<_Bar> bars;
  final List<_Pt?> trend;
  final bool monthly, showEnd, isTime;
  final String unitLabel;
  final Color accent, soft, grid, label, ink, surface;

  @override
  void paint(Canvas canvas, Size size) {
    const l = kPlotLeft, r = kPlotRight, t = 16.0, b = 24.0;
    final iw = size.width - l - r, ih = size.height - t - b;
    final labelStyle = TextStyle(fontFamily: kBodyFont, fontSize: 11, color: label, fontFeatures: tabular);
    final values = [...bars.map((w) => w.value), ...trend.whereType<_Pt>().map((p) => p.value)];
    final maxV = values.isEmpty ? 0.0 : values.reduce(math.max);
    final step = _niceStep(math.max(maxV, 1.0), isTime ? const [0.5, 1, 2, 3, 5, 10] : const [5, 10, 20, 25, 50, 100]);
    final hi = math.max(step, (math.max(maxV, 0.0001) / step).ceil() * step);
    final span = math.max(1.0, t1 - t0);
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
    _text(canvas, '$unitLabel / WEEK${monthly ? ' · MONTHLY AVERAGE' : ''}', Offset(l + 4, 0),
        labelStyle.copyWith(fontSize: 10, letterSpacing: 0.8));

    canvas.save();
    canvas.clipRect(Rect.fromLTWH(l, 0, iw, size.height));
    final gap = monthly ? 1.0 : math.min(3.0, iw / span * 0.6);
    for (final bar in bars) {
      final xa = x(bar.a) + gap, xb = x(bar.b) - gap;
      if (bar.value <= 0 || xb - xa < 0.6) continue;
      final rect = RRect.fromRectAndRadius(
        Rect.fromLTRB(xa, y(bar.value), xb, size.height - b),
        Radius.circular(math.min(4.0, (xb - xa) / 3)),
      );
      canvas.drawRRect(rect, Paint()..color = bar.current ? accent : soft);
      if (!bar.current && xb - xa > 4) canvas.drawRRect(rect, _stroke(accent.withValues(alpha: 0.5), 1));
    }
    final path = _pathOf(trend, x, y);
    canvas.drawPath(path, _stroke(surface.withValues(alpha: 0.9), 6));
    canvas.drawPath(path, _stroke(ink, 2.4));
    final last = trend.lastWhere((p) => p != null, orElse: () => null);
    if (last != null && showEnd) {
      final e = Offset(x(last.day), y(last.value));
      canvas.drawCircle(e, 6.5, Paint()..color = surface);
      canvas.drawCircle(e, 4.5, Paint()..color = ink);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}

// ---------------------------------------------------------------------------
// Gestures on a trend chart: drag sideways to pan, pinch or double-tap to zoom
// ---------------------------------------------------------------------------

class ZoomGestures extends StatefulWidget {
  const ZoomGestures({super.key, required this.window, required this.onView, required this.child});

  final TrendWindow window;
  final ValueChanged<(double, double)> onView;
  final Widget child;

  @override
  State<ZoomGestures> createState() => _ZoomGesturesState();
}

class _ZoomGesturesState extends State<ZoomGestures> {
  final _pointers = <int, Offset>{};
  TrendWindow? _pinchStart;
  double _pinchDist = 1, _pinchAnchor = 0;
  double _width = 1;

  double get _plotWidth => math.max(1.0, _width - kPlotLeft - kPlotRight);
  double _dayAt(TrendWindow w, double dx) => w.t0 + (dx - kPlotLeft) / _plotWidth * w.span;

  void _startPinch() {
    final p = _pointers.values.toList();
    _pinchStart = widget.window;
    _pinchDist = math.max(10.0, (p[0].dx - p[1].dx).abs());
    _pinchAnchor = _dayAt(widget.window, (p[0].dx + p[1].dx) / 2);
  }

  void _movePinch() {
    final start = _pinchStart;
    if (start == null || _pointers.length < 2) return;
    final p = _pointers.values.toList();
    final dist = math.max(10.0, (p[0].dx - p[1].dx).abs());
    final span = start.span * _pinchDist / dist;
    final center = (p[0].dx + p[1].dx) / 2;
    final t0 = _pinchAnchor - (center - kPlotLeft) / _plotWidth * span;
    widget.onView(start.clamp(t0, t0 + span));
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      _width = c.maxWidth;
      return Listener(
        onPointerDown: (e) {
          _pointers[e.pointer] = e.localPosition;
          if (_pointers.length == 2) _startPinch();
        },
        onPointerMove: (e) {
          if (!_pointers.containsKey(e.pointer)) return;
          _pointers[e.pointer] = e.localPosition;
          if (_pointers.length >= 2) _movePinch();
        },
        onPointerUp: (e) {
          _pointers.remove(e.pointer);
          if (_pointers.length < 2) _pinchStart = null;
        },
        onPointerCancel: (e) {
          _pointers.remove(e.pointer);
          if (_pointers.length < 2) _pinchStart = null;
        },
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onHorizontalDragUpdate: (d) {
            if (_pinchStart != null) return; // a pinch is in charge
            widget.onView(widget.window.pan(-d.delta.dx / _plotWidth * widget.window.span));
          },
          onDoubleTapDown: (d) => widget.onView(widget.window.zoom(0.5, _dayAt(widget.window, d.localPosition.dx))),
          onDoubleTap: () {},
          child: widget.child,
        ),
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Timeline strip: the whole history, with the visible window you can drag
// ---------------------------------------------------------------------------

class TimelineStrip extends StatefulWidget {
  const TimelineStrip({super.key, required this.analysis, required this.window, required this.onView});

  final Analysis analysis;
  final TrendWindow window;
  final ValueChanged<(double, double)> onView;

  @override
  State<TimelineStrip> createState() => _TimelineStripState();
}

enum _Grab { move, start, end }

class _TimelineStripState extends State<TimelineStrip> {
  _Grab? _grab;
  TrendWindow? _from;
  double _startX = 0, _width = 1;
  List<double>? _weeks;
  Analysis? _weeksFor;

  double get _plot => math.max(1.0, _width - kPlotLeft - kPlotRight);
  double _dayAt(double dx) {
    final w = widget.window;
    return w.lo + (dx - kPlotLeft) / _plot * (w.hi - w.lo);
  }

  double _xOf(double day) {
    final w = widget.window;
    return kPlotLeft + (day - w.lo) / math.max(1.0, w.hi - w.lo) * _plot;
  }

  List<double> _weeklyKm() {
    if (_weeksFor == widget.analysis && _weeks != null) return _weeks!;
    final daily = widget.analysis.dailyVolume(VolumeMetric.distance);
    final w = widget.window, out = <double>[];
    for (var s = weekStart(w.lo.floor()); s <= w.hi; s += 7) {
      var v = 0.0;
      for (var d = 0; d < 7; d++) {
        v += daily[s + d] ?? 0.0;
      }
      out.add(v);
    }
    _weeksFor = widget.analysis;
    return _weeks = out;
  }

  void _down(double dx) {
    final w = widget.window, xa = _xOf(w.t0), xb = _xOf(w.t1);
    if ((dx - xa).abs() < 16) {
      _grab = _Grab.start;
    } else if ((dx - xb).abs() < 16) {
      _grab = _Grab.end;
    } else {
      _grab = _Grab.move;
      if (dx < xa || dx > xb) {
        final c = _dayAt(dx);
        widget.onView(w.clamp(c - w.span / 2, c + w.span / 2));
      }
    }
    _startX = dx;
    _from = null;
  }

  void _move(double dx) {
    final from = _from ??= widget.window;
    final dd = (dx - _startX) / _plot * (from.hi - from.lo);
    switch (_grab) {
      case _Grab.move:
        widget.onView(from.clamp(from.t0 + dd, from.t1 + dd));
      case _Grab.start:
        widget.onView(from.clamp(math.min(from.t0 + dd, from.t1 - TrendWindow.minSpan), from.t1));
      case _Grab.end:
        widget.onView(from.clamp(from.t0, math.max(from.t1 + dd, from.t0 + TrendWindow.minSpan)));
      case null:
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return LayoutBuilder(builder: (context, c) {
      _width = c.maxWidth;
      return GestureDetector(
        behavior: HitTestBehavior.opaque,
        dragStartBehavior: DragStartBehavior.down,
        onHorizontalDragDown: (d) => _down(d.localPosition.dx),
        onHorizontalDragUpdate: (d) => _move(d.localPosition.dx),
        onTapUp: (d) {
          final w = widget.window, cDay = _dayAt(d.localPosition.dx);
          widget.onView(w.clamp(cDay - w.span / 2, cDay + w.span / 2));
        },
        child: SizedBox(
          height: 58,
          width: double.infinity,
          child: CustomPaint(
            painter: _StripPainter(
              window: widget.window,
              weeks: _weeklyKm(),
              firstWeek: weekStart(widget.window.lo.floor()),
              accent: scheme.primary,
              track: scheme.surfaceContainerHighest,
              shade: scheme.surface,
              label: scheme.onSurfaceVariant,
            ),
          ),
        ),
      );
    });
  }
}

class _StripPainter extends CustomPainter {
  _StripPainter({
    required this.window,
    required this.weeks,
    required this.firstWeek,
    required this.accent,
    required this.track,
    required this.shade,
    required this.label,
  });

  final TrendWindow window;
  final List<double> weeks;
  final int firstWeek;
  final Color accent, track, shade, label;

  @override
  void paint(Canvas canvas, Size size) {
    const l = kPlotLeft, r = kPlotRight, top = 4.0, bottom = 4.0;
    final iw = size.width - l - r, h = size.height - top - bottom;
    final span = math.max(1.0, window.hi - window.lo);
    double x(num day) => l + (day - window.lo) / span * iw;
    final box = RRect.fromRectAndRadius(Rect.fromLTWH(l, top, iw, h), const Radius.circular(8));
    canvas.drawRRect(box, Paint()..color = track);
    canvas.save();
    canvas.clipRRect(box);
    final mx = weeks.isEmpty ? 1.0 : math.max(1.0, weeks.reduce(math.max));
    final area = Path()..moveTo(l, top + h);
    for (var i = 0; i < weeks.length; i++) {
      area.lineTo(x(firstWeek + i * 7 + 3.5), top + h - weeks[i] / mx * (h - 14));
    }
    area
      ..lineTo(l + iw, top + h)
      ..close();
    canvas.drawPath(area, Paint()..color = accent.withValues(alpha: 0.35));
    final xa = x(window.t0), xb = x(window.t1);
    final dim = Paint()..color = shade.withValues(alpha: 0.55);
    canvas.drawRect(Rect.fromLTRB(l, top, xa, top + h), dim);
    canvas.drawRect(Rect.fromLTRB(xb, top, l + iw, top + h), dim);
    canvas.restore();
    final labelStyle = TextStyle(fontFamily: kBodyFont, fontSize: 10, color: label, fontFeatures: tabular);
    for (final (day, text) in _timeTicks(window.lo, window.hi)) {
      final xx = x(day);
      if (xx > l + 12 && xx < size.width - r - 12) _text(canvas, text, Offset(xx, top + 2), labelStyle, align: TextAlign.center);
    }
    canvas.drawRRect(
      RRect.fromRectAndRadius(Rect.fromLTRB(xa, top, math.max(xb, xa + 4), top + h), const Radius.circular(6)),
      _stroke(accent, 2),
    );
    for (final xx in [xa, xb]) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(Rect.fromCenter(center: Offset(xx, top + h / 2), width: 6, height: 20), const Radius.circular(3)),
        Paint()..color = accent,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
