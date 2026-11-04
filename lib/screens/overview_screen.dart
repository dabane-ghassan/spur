// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/analysis.dart';
import '../core/dates.dart';
import '../core/units.dart';
import '../data/run_store.dart';
import '../ui/charts.dart';
import '../ui/spur_logo.dart';
import '../ui/store_scope.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'goal_dialog.dart';

class OverviewScreen extends StatelessWidget {
  const OverviewScreen({super.key, required this.onLogRun});

  final VoidCallback onLogRun;

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final a = store.analysis();
    if (a.isEmpty) return _Welcome(onLogRun: onLogRun, onSamples: store.loadSamples);

    final u = store.units;
    final isPace = store.metric == ChartMetric.pace;
    String metric(double secPerKm) =>
        isPace ? fmtMinSec(u.pace(secPerKm)) : u.speed(secPerKm).toStringAsFixed(1);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 104),
      children: [
        if (store.hasSamples) ...[
          _SampleBanner(onClear: store.clearSamples),
          const SizedBox(height: 12),
        ],
        BibCard(
          label: '${store.smoothing.isOn ? 'Trend' : 'Latest'} ${isPace ? 'pace' : 'speed'}',
          value: a.trendNow == null ? '–' : metric(a.trendNow!),
          unit: isPace ? u.paceName : u.speedName,
          date: fmtLongDate(a.today),
          name: store.name,
          status: _trendPill(a, u),
        ),
        const SectionTitle('Trends'),
        ValueListenableBuilder<(double, double)?>(
          valueListenable: store.view,
          builder: (context, view, _) {
            final w = TrendWindow.of(a, store.range, view);
            void setView((double, double) v) => store.view.value = v;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _TrendControls(window: w, onView: setView),
                const SizedBox(height: 12),
                _paceCard(context, a, w, setView),
                const SizedBox(height: 12),
                _VolumeCard(analysis: a, units: u, window: w, metric: store.volume, onView: setView),
                const SizedBox(height: 12),
                _TimelineCard(analysis: a, window: w, onView: setView),
              ],
            );
          },
        ),
        const SizedBox(height: 12),
        _GoalCard(analysis: a, units: u, goal: store.goalSecPerKm),
      ],
    );
  }

  Widget _paceCard(BuildContext context, Analysis a, TrendWindow w, ValueChanged<(double, double)> setView) {
    final store = StoreScope.read(context);
    final u = store.units;
    final scheme = Theme.of(context).colorScheme;
    final isPace = store.metric == ChartMetric.pace;
    return Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(isPace ? 'Pace over time' : 'Speed over time',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                _InView(analysis: a, units: u, window: w, isPace: isPace),
                const SizedBox(height: 10),
                ZoomGestures(
                  window: w,
                  onView: setView,
                  child: PaceChart(
                    analysis: a,
                    units: u,
                    metric: store.metric,
                    window: w,
                    goalSecPerKm: store.goalSecPerKm,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 16,
                  runSpacing: 4,
                  children: [
                    _LegendItem(
                      swatch: Container(
                        width: 9,
                        height: 9,
                        decoration: BoxDecoration(
                          color: scheme.primaryContainer,
                          shape: BoxShape.circle,
                          border: Border.all(color: scheme.primary, width: 1.5),
                        ),
                      ),
                      text: 'Each run',
                    ),
                    _LegendItem(
                      swatch: Container(width: 16, height: store.smoothing.isOn ? 3 : 1.5, color: scheme.primary),
                      text: store.smoothing.isOn
                          ? 'Trend · ${store.smoothing.label.toLowerCase()} smoothing'
                          : 'Runs joined, no smoothing',
                    ),
                    if (store.goalSecPerKm != null)
                      _LegendItem(
                        swatch: Container(width: 16, height: 2, color: scheme.onSurfaceVariant),
                        text: 'Goal',
                      ),
                  ],
                ),
              ],
            ),
          ),
        );
  }

  Widget _trendPill(Analysis a, Units u) {
    final now = a.trendNow, then = a.trendMonthAgo;
    if (now == null) return const StatusPill('No runs in the last few weeks');
    if (then == null) return const StatusPill('The trend needs about a month of runs');
    final faster = u.pace(then) - u.pace(now);
    if (faster.abs() < 3) return const StatusPill('About the same as 30 days ago');
    if (faster > 0) {
      return StatusPill('${fmtMinSec(faster)} ${u.paceName} faster than 30 days ago',
          tone: Tone.good, icon: Icons.arrow_upward);
    }
    return StatusPill('${fmtMinSec(-faster)} ${u.paceName} slower than 30 days ago',
        tone: Tone.warn, icon: Icons.arrow_downward);
  }
}

class _LegendItem extends StatelessWidget {
  const _LegendItem({required this.swatch, required this.text});

  final Widget swatch;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          swatch,
          const SizedBox(width: 6),
          Text(text, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
        ],
      );
}

class _SampleBanner extends StatelessWidget {
  const _SampleBanner({required this.onClear});

  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
      decoration: BoxDecoration(color: scheme.secondaryContainer, borderRadius: BorderRadius.circular(16)),
      child: Row(
        children: [
          Expanded(
            child: Text(
              'These are sample runs. Clear them when you are ready to start your own diary.',
              style: TextStyle(color: scheme.onSecondaryContainer, fontSize: 13.5),
            ),
          ),
          TextButton(onPressed: onClear, child: const Text('Clear samples')),
        ],
      ),
    );
  }
}

class _GoalCard extends StatelessWidget {
  const _GoalCard({required this.analysis, required this.units, required this.goal});

  final Analysis analysis;
  final Units units;
  final double? goal;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final muted = TextStyle(color: scheme.onSurfaceVariant, height: 1.4);
    final bold = TextStyle(color: scheme.onSurface, fontWeight: FontWeight.w600, fontFeatures: tabular);
    final g = goal;
    final List<InlineSpan> spans;
    if (g == null) {
      spans = [const TextSpan(text: 'Set a target pace and spur will estimate when your trend reaches it.')];
    } else {
      final goalText = '${fmtMinSec(units.pace(g))} ${units.paceName}';
      final f = analysis.goalForecast(g);
      final gap = fmtMinSec(units.pace(f.gapSecPerKm));
      spans = switch (f.state) {
        GoalState.noData => [
            const TextSpan(text: 'Goal '),
            TextSpan(text: goalText, style: bold),
            const TextSpan(text: '. Log a few runs to get a forecast.'),
          ],
        GoalState.reached => [
            const TextSpan(text: 'Goal '),
            TextSpan(text: goalText, style: bold),
            TextSpan(text: ' reached. Your trend is $gap under it. Time for a new one?'),
          ],
        GoalState.notImproving => [
            const TextSpan(text: 'Goal '),
            TextSpan(text: goalText, style: bold),
            TextSpan(text: ', $gap to go. Your trend is not getting faster right now, so there is no forecast yet.'),
          ],
        GoalState.onTrack => [
            const TextSpan(text: 'Goal '),
            TextSpan(text: goalText, style: bold),
            TextSpan(text: ', $gap to go. At your 6-week trend you would get there around '),
            TextSpan(text: fmtLongDate(f.reachDay!), style: bold),
            TextSpan(
                text: f.reachDay! - analysis.today > 365 ? ' (a long way out, so treat it loosely).' : '.'),
          ],
      };
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Text('Pace goal', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                const Spacer(),
                TextButton(
                  onPressed: () => showGoalDialog(context),
                  child: Text(g == null ? 'Set goal' : 'Change'),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Text.rich(TextSpan(style: muted, children: spans)),
            ),
          ],
        ),
      ),
    );
  }
}

/// Time range and smoothing strength, shared by the pace and volume charts.
/// Time range, zoom and smoothing strength, shared by the pace and volume charts.
class _TrendControls extends StatelessWidget {
  const _TrendControls({required this.window, required this.onView});

  final TrendWindow window;
  final ValueChanged<(double, double)> onView;

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final zoomed = store.view.value != null;
    return Wrap(
      spacing: 6,
      runSpacing: 10,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        for (final r in ChartRange.values)
          ChoiceChip(
            label: Text(r.label),
            selected: !zoomed && store.range == r,
            showCheckmark: false,
            visualDensity: VisualDensity.compact,
            onSelected: (_) => store.range = r,
          ),
        // The zoom buttons move as one, so they never split across two lines.
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton.filledTonal(
              tooltip: 'Zoom out',
              visualDensity: VisualDensity.compact,
              onPressed: window.isFull ? null : () => onView(window.zoom(2)),
              icon: const Icon(Icons.zoom_out),
            ),
            IconButton.filledTonal(
              tooltip: 'Zoom in',
              visualDensity: VisualDensity.compact,
              onPressed: window.isMin ? null : () => onView(window.zoom(0.5)),
              icon: const Icon(Icons.zoom_in),
            ),
            if (zoomed) TextButton(onPressed: () => store.view.value = null, child: const Text('Reset')),
          ],
        ),
        const SizedBox(width: double.infinity),
        SegmentedButton<Smoothing>(
          segments: [for (final s in Smoothing.values) ButtonSegment(value: s, label: Text(s.label))],
          selected: {store.smoothing},
          showSelectedIcon: false,
          style: const ButtonStyle(visualDensity: VisualDensity.compact),
          onSelectionChanged: (v) => store.smoothing = v.first,
        ),
      ],
    );
  }
}

/// Runs, distance, average and fastest pace inside the visible window.
class _InView extends StatelessWidget {
  const _InView({required this.analysis, required this.units, required this.window, required this.isPace});

  final Analysis analysis;
  final Units units;
  final TrendWindow window;
  final bool isPace;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final runs = [for (final r in analysis.runs) if (r.day >= window.t0 && r.day <= window.t1) r];
    String fmt(double secPerKm) => isPace ? fmtMinSec(units.pace(secPerKm)) : units.speed(secPerKm).toStringAsFixed(1);
    final unit = isPace ? units.paceName : units.speedName;
    final km = runs.fold<double>(0.0, (s, r) => s + r.km), sec = runs.fold<int>(0, (s, r) => s + r.seconds);
    final long = runs.where((r) => r.km >= 3);
    final fastest = long.isEmpty ? null : long.map((r) => r.secPerKm).reduce(math.min);
    Widget item(String v, String label) => Text.rich(TextSpan(children: [
          TextSpan(text: v, style: displayStyle(18, scheme.onSurface, weight: FontWeight.w700)),
          TextSpan(text: ' $label', style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant)),
        ]));
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: scheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(12)),
      child: runs.isEmpty
          ? Text('No runs in this part of the timeline', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13))
          : Wrap(spacing: 14, runSpacing: 2, children: [
              item('${runs.length}', runs.length == 1 ? 'run' : 'runs'),
              item(units.distance(km), units.name),
              item(fmt(sec / km), '$unit avg'),
              if (fastest != null) item(fmt(fastest), 'fastest'),
            ]),
    );
  }
}

/// The whole history with the visible window, plus the dates shown.
class _TimelineCard extends StatelessWidget {
  const _TimelineCard({required this.analysis, required this.window, required this.onView});

  final Analysis analysis;
  final TrendWindow window;
  final ValueChanged<(double, double)> onView;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(4, 12, 4, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                children: [
                  Text('TIMELINE', style: labelStyle(context)),
                  const Spacer(),
                  Text(
                    '${fmtLongDate(window.t0.round())} – ${fmtLongDate(window.t1.round())}',
                    style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, fontFeatures: tabular, color: scheme.onSurface),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 6),
            TimelineStrip(analysis: analysis, window: window, onView: onView),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
              child: Text(
                'Drag a chart sideways to move through time. Pinch or double-tap to zoom, or drag the window here.',
                style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VolumeCard extends StatelessWidget {
  const _VolumeCard({
    required this.analysis,
    required this.units,
    required this.window,
    required this.metric,
    required this.onView,
  });

  final Analysis analysis;
  final Units units;
  final TrendWindow window;
  final VolumeMetric metric;
  final ValueChanged<(double, double)> onView;

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.read(context);
    final scheme = Theme.of(context).colorScheme;
    final isTime = metric == VolumeMetric.time;
    final unit = isTime ? 'h' : units.name;
    double conv(double v) => isTime ? v : units.toUnit(v);
    String fmt(double v) => v >= 100 && !isTime ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

    // Headline: volume now against four weeks ago.
    final daily = analysis.dailyVolume(metric);
    final now = analysis.volumeAt(analysis.today, daily);
    final then = analysis.volumeAt(analysis.today - 28, daily);
    final String change;
    IconData? changeIcon;
    if (now == null || then == null) {
      change = 'Needs about a month of runs to compare';
    } else if (then <= 0) {
      change = now > 0 ? 'Up from nothing 4 weeks ago' : 'No running in the last weeks';
    } else {
      final pct = ((now / then - 1) * 100).round();
      change = pct.abs() < 5 ? 'About the same as 4 weeks ago' : '${pct > 0 ? '+' : ''}$pct% vs 4 weeks ago';
      if (pct.abs() >= 5) changeIcon = pct > 0 ? Icons.arrow_upward : Icons.arrow_downward;
    }

    // Load check: this calendar week against the three before it (always in distance).
    final load = analysis.loadCheck();
    final avg = units.toUnit(load.averageKm).toStringAsFixed(1);
    final cur = units.toUnit(load.thisWeekKm).toStringAsFixed(1);
    final StatusPill loadPill;
    final String loadText;
    if (!load.hasHistory) {
      loadPill = const StatusPill('Building base');
      loadText = 'Once you have three weeks logged, spur compares each week with your recent average.';
    } else if (load.isJump) {
      loadPill = StatusPill('+${load.percentAbove}% vs 3-week avg', tone: Tone.warn);
      loadText = 'This week is ${load.percentAbove}% above your recent average of $avg ${units.name}. '
          'Big jumps in weekly distance are a common cause of running injuries, so build up gradually.';
    } else {
      loadPill = const StatusPill('Load steady', tone: Tone.good);
      loadText = '$cur ${units.name} so far this week, against a 3-week average of $avg ${units.name}.';
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Expanded(child: Text('Volume', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600))),
                SegmentedButton<VolumeMetric>(
                  segments: const [
                    ButtonSegment(value: VolumeMetric.distance, label: Text('Distance')),
                    ButtonSegment(value: VolumeMetric.time, label: Text('Time')),
                  ],
                  selected: {metric},
                  showSelectedIcon: false,
                  style: const ButtonStyle(visualDensity: VisualDensity.compact),
                  onSelectionChanged: (v) => store.volume = v.first,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text((analysis.smoothing.isOn ? 'Volume trend' : 'Last 7 days').toUpperCase(), style: labelStyle(context)),
            const SizedBox(height: 2),
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(now == null ? '–' : fmt(conv(now)), style: displayStyle(40, scheme.onSurface)),
                const SizedBox(width: 5),
                Text('$unit/week', style: displayStyle(17, scheme.onSurfaceVariant, weight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, children: [StatusPill(change, icon: changeIcon), loadPill]),
            const SizedBox(height: 12),
            ZoomGestures(
              window: window,
              onView: onView,
              child: VolumeChart(analysis: analysis, units: units, window: window, metric: metric),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 16,
              runSpacing: 4,
              children: [
                _LegendItem(
                  swatch: Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      color: scheme.primaryContainer,
                      borderRadius: BorderRadius.circular(3),
                      border: Border.all(color: scheme.primary),
                    ),
                  ),
                  text: isTime ? 'Time each week' : 'Distance each week',
                ),
                if (analysis.smoothing.isOn)
                  _LegendItem(swatch: Container(width: 16, height: 3, color: scheme.onSurface), text: 'Volume trend'),
              ],
            ),
            const SizedBox(height: 8),
            Text(loadText, style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13.5, height: 1.4)),
          ],
        ),
      ),
    );
  }
}

class _Welcome extends StatelessWidget {
  const _Welcome({required this.onLogRun, required this.onSamples});

  final VoidCallback onLogRun, onSamples;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 48, 24, 104),
      children: [
        const Center(child: SpurLogo(size: 84)),
        const SizedBox(height: 20),
        Text('Your running diary',
            textAlign: TextAlign.center, style: displayStyle(36, scheme.onSurface, italic: true)),
        const SizedBox(height: 10),
        Text(
          'Log each run with its distance and time, pace or speed. spur smooths out the '
          'day-to-day noise and shows whether you are getting faster.',
          textAlign: TextAlign.center,
          style: TextStyle(color: scheme.onSurfaceVariant, height: 1.45),
        ),
        const SizedBox(height: 28),
        FilledButton.icon(onPressed: onLogRun, icon: const Icon(Icons.add), label: const Text('Log your first run')),
        const SizedBox(height: 10),
        OutlinedButton(onPressed: onSamples, child: const Text('Explore with sample runs')),
        const SizedBox(height: 24),
        Text(
          'Your runs stay on this phone. No account, no ads, no trackers.',
          textAlign: TextAlign.center,
          style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
        ),
      ],
    );
  }
}
