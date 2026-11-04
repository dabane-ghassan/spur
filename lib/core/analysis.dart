// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'dart:math' as math;

import '../models/run.dart';
import 'dates.dart';

/// Everything spur derives from the run log. Pure Dart, no Flutter, so it is
/// easy to unit-test.
/// How strongly the trends even out day-to-day ups and downs. The value is
/// the width of the one-sided Gaussian kernel in days; [off] shows the raw
/// numbers.
enum Smoothing {
  off(0, 'Off'),
  soft(5, 'Soft'),
  medium(10, 'Medium'),
  strong(20, 'Strong');

  const Smoothing(this.sigma, this.label);

  final double sigma;
  final String label;

  bool get isOn => sigma > 0;
}

/// Volume is measured as distance (km) or running time (hours).
enum VolumeMetric { distance, time }

class Analysis {
  Analysis(Iterable<Run> runs, {required this.today, this.smoothing = Smoothing.medium})
      : runs = List<Run>.of(runs)..sort((a, b) => a.day.compareTo(b.day));

  final List<Run> runs;
  final int today;
  final Smoothing smoothing;

  double get sigma => smoothing.sigma;

  /// No pace trend after this many days without a run.
  double get gapLimit => math.max(21, 2.5 * sigma);

  bool get isEmpty => runs.isEmpty;

  /// Smoothed pace (seconds per km) on [day], using only runs on or before
  /// that day, so the trend never looks into the future. With smoothing off
  /// it is the most recent run's pace. Returns null when the most recent run
  /// is too far back to say anything.
  double? smoothAt(int day) {
    double sw = 0, sv = 0;
    int? nearest;
    double? latest;
    for (final r in runs) {
      if (r.day > day) break;
      final d = day - r.day;
      nearest = d;
      latest = r.secPerKm;
      if (!smoothing.isOn || d > 4 * sigma) continue;
      final w = math.exp(-d * d / (2 * sigma * sigma));
      sw += w;
      sv += w * r.secPerKm;
    }
    if (nearest == null || nearest > gapLimit) return null;
    if (!smoothing.isOn) return latest;
    return sw < 1e-6 ? null : sv / sw;
  }

  int? get lastDay => runs.isEmpty ? null : runs.last.day;

  /// The day the headline trend refers to: today. After a long break there
  /// is no trend until you run again.
  int? get trendDay => lastDay == null ? null : today;

  double? get trendNow => trendDay == null ? null : smoothAt(trendDay!);

  double? get trendMonthAgo => trendDay == null ? null : smoothAt(trendDay! - 30);

  static double? _slope(List<double> xs, List<double> ys) {
    final mx = xs.reduce((a, b) => a + b) / xs.length;
    final my = ys.reduce((a, b) => a + b) / ys.length;
    double nu = 0, de = 0;
    for (var i = 0; i < xs.length; i++) {
      nu += (xs[i] - mx) * (ys[i] - my);
      de += (xs[i] - mx) * (xs[i] - mx);
    }
    return de == 0 ? null : nu / de;
  }

  /// Least-squares slope over the last six weeks, in seconds per km per day:
  /// of the trend, or of the runs themselves when smoothing is off. Negative
  /// means getting faster.
  double? get slopePerDay {
    final end = trendDay;
    if (end == null) return null;
    final xs = <double>[], ys = <double>[];
    if (smoothing.isOn) {
      for (var t = end - 41; t <= end; t++) {
        final v = smoothAt(t);
        if (v != null) {
          xs.add(t.toDouble());
          ys.add(v);
        }
      }
      return xs.length < 14 ? null : _slope(xs, ys);
    }
    for (final r in runs) {
      if (r.day > end - 42 && r.day <= end) {
        xs.add(r.day.toDouble());
        ys.add(r.secPerKm);
      }
    }
    return xs.length < 4 ? null : _slope(xs, ys);
  }

  // ---- precomputed trend lines (for drawing and zooming) -------------------

  /// First and last day covered by [paceSeries] and [volumeSeries].
  int get seriesStart => runs.isEmpty ? today : runs.first.day;
  int get seriesEnd => runs.isEmpty ? today : math.max(today, runs.last.day);

  /// The pace trend for every day from [seriesStart] to [seriesEnd], worked out
  /// once so charts can pan and zoom without recomputing. Same values as
  /// [smoothAt].
  late final List<double?> paceSeries = _buildPace();

  final Map<VolumeMetric, List<double>> _volumeCache = {};

  /// The volume trend (per week, km or hours) for every day of the history.
  List<double> volumeSeries(VolumeMetric metric) => _volumeCache[metric] ??= _buildVolume(metric);

  double? paceOn(int day) {
    final i = day - seriesStart;
    return i >= 0 && i < paceSeries.length ? paceSeries[i] : null;
  }

  double? volumeOn(int day, VolumeMetric metric) {
    final s = volumeSeries(metric), i = day - seriesStart;
    return i >= 0 && i < s.length ? s[i] : null;
  }

  List<double> get _weights {
    final reach = (4 * sigma).ceil();
    return [for (var d = 0; d <= reach; d++) smoothing.isOn ? math.exp(-d * d / (2 * sigma * sigma)) : 1.0];
  }

  List<double?> _buildPace() {
    if (runs.isEmpty) return const [];
    final n = seriesEnd - seriesStart + 1;
    final sum = List<double>.filled(n, 0.0), count = List<int>.filled(n, 0);
    final last = List<double?>.filled(n, null);
    for (final r in runs) {
      final i = r.day - seriesStart;
      sum[i] += r.secPerKm;
      count[i]++;
      last[i] = r.secPerKm;
    }
    final w = _weights, out = List<double?>.filled(n, null);
    var nearest = -1 << 30;
    double? latest;
    for (var i = 0; i < n; i++) {
      if (count[i] > 0) {
        nearest = i;
        latest = last[i];
      }
      if (i - nearest > gapLimit) continue;
      if (!smoothing.isOn) {
        out[i] = latest;
        continue;
      }
      double sw = 0, sv = 0;
      for (var d = 0; d < w.length && d <= i; d++) {
        if (count[i - d] == 0) continue;
        sw += w[d] * count[i - d];
        sv += w[d] * sum[i - d];
      }
      out[i] = sw > 1e-6 ? sv / sw : null;
    }
    return out;
  }

  List<double> _buildVolume(VolumeMetric metric) {
    if (runs.isEmpty) return const [];
    final n = seriesEnd - seriesStart + 1;
    final daily = List<double>.filled(n, 0.0);
    for (final r in runs) {
      daily[r.day - seriesStart] += metric == VolumeMetric.time ? r.seconds / 3600 : r.km;
    }
    final last7 = List<double>.filled(n, 0.0);
    for (var i = 0; i < n; i++) {
      last7[i] = daily[i] + (i > 0 ? last7[i - 1] : 0.0) - (i >= 7 ? daily[i - 7] : 0.0);
    }
    if (!smoothing.isOn) return last7;
    final w = _weights, out = List<double>.filled(n, 0.0);
    for (var i = 0; i < n; i++) {
      double sw = 0, sv = 0;
      for (var d = 0; d < w.length && d <= i; d++) {
        sw += w[d];
        sv += w[d] * last7[i - d];
      }
      out[i] = sv / sw;
    }
    return out;
  }

  // ---- volume ----------------------------------------------------------------

  /// Volume per calendar day: kilometres, or hours for [VolumeMetric.time].
  Map<int, double> dailyVolume(VolumeMetric metric) {
    final m = <int, double>{};
    for (final r in runs) {
      final v = metric == VolumeMetric.time ? r.seconds / 3600 : r.km;
      m[r.day] = (m[r.day] ?? 0) + v;
    }
    return m;
  }

  static double _last7(int day, Map<int, double> daily) {
    var sum = 0.0;
    for (var d = 0; d < 7; d++) {
      sum += daily[day - d] ?? 0.0;
    }
    return sum;
  }

  /// Volume per week on [day]: the rolling 7-day total, smoothed over past
  /// days with the chosen strength (as it is when smoothing is off). Null
  /// before the first run.
  double? volumeAt(int day, Map<int, double> daily) {
    if (runs.isEmpty || day < runs.first.day) return null;
    if (!smoothing.isOn) return _last7(day, daily);
    double sw = 0, sv = 0;
    final reach = math.min((4 * sigma).ceil(), day - runs.first.day);
    for (var d = 0; d <= reach; d++) {
      final w = math.exp(-d * d / (2 * sigma * sigma));
      sw += w;
      sv += w * _last7(day - d, daily);
    }
    return sv / sw;
  }

  /// Volume per calendar week (keyed by Monday) in kilometres or hours.
  Map<int, double> weeklyVolume(VolumeMetric metric) {
    final m = <int, double>{};
    for (final r in runs) {
      final w = weekStart(r.day);
      final v = metric == VolumeMetric.time ? r.seconds / 3600 : r.km;
      m[w] = (m[w] ?? 0) + v;
    }
    return m;
  }

  /// Forecast for when the trend reaches [goalSecPerKm].
  GoalForecast goalForecast(double goalSecPerKm) {
    final now = trendNow, day = trendDay;
    if (now == null || day == null) return const GoalForecast.noData();
    if (now <= goalSecPerKm) return GoalForecast.reached(goalSecPerKm - now);
    final slope = slopePerDay;
    if (slope == null || slope > -0.02) return GoalForecast.notImproving(now - goalSecPerKm);
    final days = ((goalSecPerKm - now) / slope).ceil();
    return GoalForecast.onTrack(now - goalSecPerKm, day + days);
  }

  /// Kilometres per week, keyed by the Monday of each week.
  Map<int, double> weeklyKm() {
    final m = <int, double>{};
    for (final r in runs) {
      final w = weekStart(r.day);
      m[w] = (m[w] ?? 0) + r.km;
    }
    return m;
  }

  /// Consecutive weeks with at least one run. The current week only breaks
  /// the streak once it is over.
  int weekStreak() {
    final weeks = weeklyKm();
    var w = weekStart(today);
    if (!weeks.containsKey(w)) w -= 7;
    var count = 0;
    while (weeks.containsKey(w)) {
      count++;
      w -= 7;
    }
    return count;
  }

  /// Compares this week's distance with the average of the three before it.
  LoadCheck loadCheck() {
    final weeks = weeklyKm();
    final cur = weekStart(today);
    final thisWeek = weeks[cur] ?? 0.0;
    final prev = [1, 2, 3].map((i) => weeks[cur - 7 * i] ?? 0.0).toList();
    final avg = prev.reduce((a, b) => a + b) / 3;
    return LoadCheck(thisWeekKm: thisWeek, averageKm: avg);
  }

  double get totalKm => runs.fold<double>(0.0, (s, r) => s + r.km);
  int get totalSeconds => runs.fold<int>(0, (s, r) => s + r.seconds);
  double get longestKm => runs.fold<double>(0.0, (m, r) => math.max(m, r.km));

  /// Fastest average pace on a run of at least 3 km.
  double? get fastestSecPerKm {
    double? best;
    for (final r in runs) {
      if (r.km < 3) continue;
      if (best == null || r.secPerKm < best) best = r.secPerKm;
    }
    return best;
  }

  /// Average weekly distance over the last [weeks] complete weeks.
  double weeklyAverageKm({int weeks = 8}) {
    final m = weeklyKm();
    final cur = weekStart(today);
    var sum = 0.0;
    for (var i = 1; i <= weeks; i++) {
      sum += m[cur - 7 * i] ?? 0.0;
    }
    return sum / weeks;
  }

  /// Race-time estimates from the strongest run of 3 km+ in the last 90 days
  /// before the most recent run (Riegel's formula, exponent 1.06).
  RacePredictor? racePredictor() {
    final end = lastDay;
    if (end == null) return null;
    Run? best;
    double bestTenK = double.infinity;
    for (final r in runs) {
      if (r.day < end - 90 || r.km < 3) continue;
      final t10 = r.seconds * math.pow(10 / r.km, 1.06);
      if (t10 < bestTenK) {
        bestTenK = t10.toDouble();
        best = r;
      }
    }
    return best == null ? null : RacePredictor(best);
  }

  List<Milestone> milestones() {
    final longest = longestKm, total = totalKm, streak = weekStreak();
    bool fasterThan(double secPerKm) => runs.any((r) => r.km >= 5 && r.secPerKm < secPerKm);
    return [
      Milestone('1', 'First steps', 'Log your first run', runs.isNotEmpty),
      Milestone('5', '5K club', 'A run of 5 km or more', longest >= 5),
      Milestone('10', 'Double digits', 'A run of 10 km or more', longest >= 10),
      Milestone('21', 'Half way', 'A half-marathon distance', longest >= 21.0975),
      Milestone('42', 'The full story', 'A marathon distance', longest >= 42.195),
      Milestone('100', 'Century', '100 km in total', total >= 100),
      Milestone('500', 'Long road', '500 km in total', total >= 500),
      Milestone('4w', 'Habit', '4-week running streak', streak >= 4),
      Milestone('12w', 'Season', '12-week running streak', streak >= 12),
      Milestone('6:00', 'Sub six', '5 km+ under 6:00 /km', fasterThan(360)),
      Milestone('5:00', 'Sub five', '5 km+ under 5:00 /km', fasterThan(300)),
      Milestone('4:00', 'Sub four', '5 km+ under 4:00 /km', fasterThan(240)),
    ];
  }
}

enum GoalState { noData, reached, notImproving, onTrack }

class GoalForecast {
  const GoalForecast.noData()
      : state = GoalState.noData,
        gapSecPerKm = 0,
        reachDay = null;
  const GoalForecast.reached(this.gapSecPerKm)
      : state = GoalState.reached,
        reachDay = null;
  const GoalForecast.notImproving(this.gapSecPerKm)
      : state = GoalState.notImproving,
        reachDay = null;
  const GoalForecast.onTrack(this.gapSecPerKm, int this.reachDay) : state = GoalState.onTrack;

  final GoalState state;

  /// Distance from the goal in seconds per km (always positive).
  final double gapSecPerKm;
  final int? reachDay;
}

class LoadCheck {
  const LoadCheck({required this.thisWeekKm, required this.averageKm});

  final double thisWeekKm;
  final double averageKm;

  bool get hasHistory => averageKm > 0;

  /// More than 10 % above the recent average: a common injury risk.
  bool get isJump => hasHistory && thisWeekKm > averageKm * 1.1;

  int get percentAbove => hasHistory ? ((thisWeekKm / averageKm - 1) * 100).round() : 0;
}

class RacePredictor {
  const RacePredictor(this.base);

  final Run base;

  /// Predicted time in seconds for [km].
  double secondsFor(double km) => base.seconds * math.pow(km / base.km, 1.06).toDouble();
}

class Milestone {
  const Milestone(this.mark, this.title, this.detail, this.reached);

  final String mark, title, detail;
  final bool reached;
}

/// Example runs so a new user can see what the charts do. Deterministic, so
/// the same samples appear every time.
List<Run> makeSampleRuns(int today) {
  var seed = 20261102;
  double rnd() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  const span = 154;
  final start = today - span;
  final out = <Run>[];
  for (var n = start; n < today; n++) {
    final w = weekdayIndex(n);
    final prog = (n - start) / span;
    double? km;
    if (w == 1 || w == 3) {
      if (rnd() < .88) km = 5 + rnd() * 2.5 + prog * 1.5;
    } else if (w == 6) {
      if (rnd() < .9) km = 8.5 + prog * 7.5 + rnd() * 1.5;
    } else if (w == 4 && rnd() < .3) {
      km = 4 + rnd() * 2;
    }
    if (km == null) continue;
    km = (km * 100).round() / 100;
    final pace = 366 - prog * 50 + (km > 9 ? 20 : 0) + (rnd() - .5) * 28;
    out.add(Run(id: 'sample-$n', day: n, km: km, seconds: (km * pace).round(), sample: true));
  }
  return out;
}
