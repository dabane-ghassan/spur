// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:spur/core/analysis.dart';
import 'package:spur/core/dates.dart';
import 'package:spur/core/units.dart';
import 'package:spur/data/run_store.dart';
import 'package:spur/models/run.dart';
import 'package:spur/ui/charts.dart';

Run run(int day, double km, int sec) => Run(id: 'r$day', day: day, km: km, seconds: sec);

void main() {
  group('dates', () {
    test('ISO round trip', () {
      final d = dayFromYmd(2026, 11, 2);
      expect(isoDate(d), '2026-11-02');
      expect(parseIsoDate('2026-11-02'), d);
      expect(parseIsoDate('2026-02-31'), isNull);
      expect(parseIsoDate('02/11/2026'), isNull);
    });

    test('weeks start on Monday', () {
      expect(isoDate(weekStart(dayFromYmd(2026, 11, 5))), '2026-11-02');
      expect(isoDate(weekStart(dayFromYmd(2026, 11, 8))), '2026-11-02');
      expect(isoDate(weekStart(dayFromYmd(2026, 11, 2))), '2026-11-02');
    });
  });

  group('units and formatting', () {
    test('durations', () {
      expect(fmtDuration(3725), '1:02:05');
      expect(fmtDuration(1565), '26:05');
      expect(fmtMinSec(299.6), '5:00');
      expect(parseDuration('42:31'), 2551);
      expect(parseDuration('1:02:05'), 3725);
      expect(parseDuration('90'), 90);
      expect(parseDuration('abc'), isNull);
    });

    test('miles', () {
      const u = Units(DistanceUnit.mi);
      expect(u.toUnit(kmPerMile), closeTo(1, 1e-9));
      expect(u.pace(300), closeTo(300 * kmPerMile, 1e-9));
      expect(u.paceToKm(u.pace(300)), closeTo(300, 1e-9));
      expect(parseDecimal('8,5'), 8.5);
    });
  });

  group('analysis', () {
    final today = dayFromYmd(2026, 11, 2);

    test('smoothed trend follows a steady pace', () {
      final runs = [for (var i = 0; i < 40; i += 2) run(today - 40 + i, 5, 1500)]; // 5:00 /km
      final a = Analysis(runs, today: today);
      expect(a.trendNow, closeTo(300, 1e-6));
    });

    test('trend ignores runs in the future of the day asked', () {
      final a = Analysis([run(today - 20, 5, 1500), run(today, 5, 1000)], today: today);
      expect(a.smoothAt(today - 10), closeTo(300, 1e-6));
    });

    test('no trend once the last run is long ago', () {
      final a = Analysis([run(today - 60, 5, 1500)], today: today);
      expect(a.trendNow, isNull);
    });

    test('sample runs improve over time and forecast a goal', () {
      final a = Analysis(makeSampleRuns(today), today: today);
      expect(a.trendNow, lessThan(a.smoothAt(today - 120)!));
      expect(a.slopePerDay, isNegative);
      final f = a.goalForecast(a.trendNow! - 10);
      expect(f.state, GoalState.onTrack);
      expect(f.reachDay, greaterThan(today));
      expect(a.goalForecast(a.trendNow! + 5).state, GoalState.reached);
    });

    test('streak counts back from last week when this week is empty', () {
      final monday = weekStart(today);
      final runs = [run(monday - 7, 5, 1500), run(monday - 14, 5, 1500), run(monday - 28, 5, 1500)];
      expect(Analysis(runs, today: today).weekStreak(), 2);
    });

    test('load check flags a jump above 10 %', () {
      final monday = weekStart(today);
      final runs = [
        run(monday - 7, 10, 3000),
        run(monday - 14, 10, 3000),
        run(monday - 21, 10, 3000),
        run(monday, 12, 3600),
      ];
      final load = Analysis(runs, today: today).loadCheck();
      expect(load.isJump, isTrue);
      expect(load.percentAbove, 20);
    });

    test("Riegel's formula", () {
      final p = Analysis([run(today, 10, 3000)], today: today).racePredictor()!;
      expect(p.secondsFor(10), closeTo(3000, 1e-6));
      expect(p.secondsFor(21.0975), greaterThan(3000 * 2.1));
    });
  });

  group('smoothing strength and volume', () {
    final today = dayFromYmd(2026, 11, 2);

    // Ten weeks of 10 km on Monday, Wednesday and Friday: a steady 30 km/week.
    List<Run> steadyWeeks({int sec = 3000}) => [
          for (var w = 10; w >= 1; w--)
            for (final d in [0, 2, 4]) run(weekStart(today) - 7 * w + d, 10, sec),
        ];

    test('off shows the latest run as it was', () {
      final runs = [run(today - 4, 5, 1500), run(today - 2, 5, 1250)];
      final a = Analysis(runs, today: today, smoothing: Smoothing.off);
      expect(a.trendNow, closeTo(250, 1e-9));
      expect(a.smoothAt(today - 3), closeTo(300, 1e-9));
    });

    test('stronger smoothing reacts more slowly to a change', () {
      // 5:30 /km for weeks, then 5:00 /km for the last 10 days.
      final runs = [
        for (var d = 60; d > 10; d -= 2) run(today - d, 5, 1650),
        for (var d = 10; d >= 0; d -= 2) run(today - d, 5, 1500),
      ];
      double now(Smoothing s) => Analysis(runs, today: today, smoothing: s).trendNow!;
      expect(now(Smoothing.off), closeTo(300, 1e-9));
      expect(now(Smoothing.soft), lessThan(now(Smoothing.medium)));
      expect(now(Smoothing.medium), lessThan(now(Smoothing.strong)));
      expect(now(Smoothing.strong), lessThan(330));
    });

    test('steady training gives a steady volume trend', () {
      final runs = steadyWeeks();
      final last = runs.last.day;
      for (final s in Smoothing.values) {
        final a = Analysis(runs, today: last, smoothing: s);
        expect(a.volumeAt(last, a.dailyVolume(VolumeMetric.distance)), closeTo(30, 2.5), reason: s.name);
      }
      final time = Analysis(runs, today: last);
      expect(time.volumeAt(last, time.dailyVolume(VolumeMetric.time)), closeTo(30 * 3000 / 10 / 3600, 0.25));
    });

    test('volume falls after a break, and is null before the first run', () {
      final runs = steadyWeeks();
      final a = Analysis(runs, today: today + 21, smoothing: Smoothing.medium);
      final daily = a.dailyVolume(VolumeMetric.distance);
      expect(a.volumeAt(today + 21, daily), lessThan(10));
      expect(a.volumeAt(runs.first.day - 1, daily), isNull);
    });
  });

  group('this week and the zoomed volume', () {
    // Thursday 5 November 2026; the week started on Monday 2 November.
    final thu = dayFromYmd(2026, 11, 5);
    final mon = weekStart(thu);

    test('the week so far starts on Monday and compares with last week up to the same day', () {
      final runs = [
        run(mon, 10, 3000), // Mon
        run(mon + 2, 21.1, 7200), // Wed
        run(mon - 7, 8, 2400), // last Mon: counted
        run(mon - 4, 12, 3600), // last Thu: counted (same weekday)
        run(mon - 2, 30, 10800), // last Sat: only in the whole week
        run(mon - 8, 50, 18000), // the Sunday before: not last week
      ];
      final w = Analysis(runs, today: thu).weekSoFar();
      expect(isoDate(w.start), '2026-11-02');
      expect(w.km, closeTo(31.1, 1e-9));
      expect(w.seconds, 10200);
      expect(w.runs, 2);
      expect(w.daysRun, 2);
      expect(w.kmByDay, [10, 0, 21.1, 0, 0, 0, 0]);
      expect(w.lastWeekKmSoFar, 20);
      expect(w.lastWeekKm, 50);
      expect(w.lastWeekSeconds, 2400 + 3600 + 10800);
    });

    test('runs logged ahead of today are left out of the week so far', () {
      final w = Analysis([run(mon, 5, 1500), run(mon + 5, 40, 14400)], today: thu).weekSoFar();
      expect(w.km, 5);
    });

    test('volume stats follow the part of the timeline on screen', () {
      final runs = [
        for (var i = 0; i < 8; i++) run(mon - 7 * i, 10.0 + i, 3600), // one run a week, bigger further back
      ];
      final a = Analysis(runs, today: thu);
      // The last four weeks: 10 + 11 + 12 + 13 km.
      final recent = a.windowVolume((mon - 21).toDouble(), (mon + 6).toDouble(), VolumeMetric.distance);
      expect(recent.runs, 4);
      expect(recent.total, 46);
      expect(recent.perWeek, closeTo(46 / 4, 1e-9));
      expect(recent.bestWeek, 13);
      expect(recent.bestWeekStart, mon - 21);
      // Zooming on older weeks gives other numbers.
      final older = a.windowVolume((mon - 49).toDouble(), (mon - 22).toDouble(), VolumeMetric.distance);
      expect(older.total, 14 + 15 + 16 + 17);
      expect(older.bestWeek, 17);
      final hours = a.windowVolume((mon - 21).toDouble(), (mon + 6).toDouble(), VolumeMetric.time);
      expect(hours.total, 4);
      expect(a.windowVolume((mon + 100).toDouble(), (mon + 110).toDouble(), VolumeMetric.time).runs, 0);
    });
  });

  test('profile names are tidied and heights checked', () async {
    SharedPreferences.setMockInitialValues({});
    final a = await RunStore.load();
    a.setProfile(name: 'A ${'very ' * 20}long name', heightCm: 40);
    expect(a.name.length, lessThanOrEqualTo(40));
    expect(a.heightCm, isNull, reason: 'a height of 40 cm is refused');
    expect(fmtHeight(178, const Units(DistanceUnit.mi)), '5 ft 10 in');
  });

  group('precomputed trends and zoom', () {
    final today = dayFromYmd(2026, 11, 2);

    test('precomputed series match the day-by-day calculations', () {
      final runs = makeSampleRuns(today);
      for (final s in Smoothing.values) {
        final a = Analysis(runs, today: today, smoothing: s);
        final daily = a.dailyVolume(VolumeMetric.distance);
        for (var t = a.seriesStart; t <= a.seriesEnd; t += 3) {
          final want = a.smoothAt(t), got = a.paceOn(t);
          if (want == null) {
            expect(got, isNull, reason: '${s.name} pace on $t');
          } else {
            expect(got, closeTo(want, 1e-6), reason: '${s.name} pace on $t');
          }
          expect(a.volumeOn(t, VolumeMetric.distance), closeTo(a.volumeAt(t, daily)!, 1e-6), reason: '${s.name} volume on $t');
        }
      }
    });

    test('the zoom window stays inside the history', () {
      final a = Analysis(makeSampleRuns(today), today: today);
      final all = TrendWindow.of(a, ChartRange.all, null);
      expect(all.isFull, isTrue);
      final (z0, z1) = all.zoom(0.25);
      expect(z1 - z0, closeTo(all.span / 4, 1e-9));
      final w = TrendWindow(z0, z1, all.lo, all.hi);
      final (p0, p1) = w.pan(-10000);
      expect(p0, all.lo, reason: 'panning stops at the first run');
      expect(p1 - p0, closeTo(w.span, 1e-9));
      final (m0, m1) = w.zoom(0.0001);
      expect(m1 - m0, closeTo(TrendWindow.minSpan, 1e-9));
      final (o0, o1) = w.zoom(100);
      expect((o0, o1), (all.lo, all.hi));
    });
  });

  group('store', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('CSV export and import round trip', () async {
      final a = await RunStore.load();
      a.addRun(day: dayFromYmd(2026, 10, 28), km: 8.2, seconds: 2551);
      a.addRun(day: dayFromYmd(2026, 10, 30), km: 5, seconds: 1565);
      final csv = a.exportCsv();

      SharedPreferences.setMockInitialValues({});
      final b = await RunStore.load();
      final r = b.importCsv(csv);
      expect(r.added, 2);
      expect(r.skipped, 0);
      expect(b.importCsv(csv).added, 0, reason: 'duplicates are skipped');
      expect(b.importCsv('not,a,run').skipped, 1);
    });

    test('settings and runs persist', () async {
      final a = await RunStore.load();
      a.unit = DistanceUnit.mi;
      a.goalSecPerKm = 300;
      a.smoothing = Smoothing.strong;
      a.setProfile(name: '  Ghassan \n', heightCm: 178);
      a.volume = VolumeMetric.time;
      a.addRun(day: dayFromYmd(2026, 10, 28), km: 8.2, seconds: 2551);
      await Future<void>.delayed(Duration.zero);
      final b = await RunStore.load();
      expect(b.unit, DistanceUnit.mi);
      expect(b.goalSecPerKm, 300);
      expect(b.smoothing, Smoothing.strong);
      expect(b.name, 'Ghassan');
      expect(b.heightCm, 178);
      expect(b.volume, VolumeMetric.time);
      expect(b.runs, hasLength(1));
    });
  });
}
