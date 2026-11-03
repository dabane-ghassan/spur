// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'package:flutter/material.dart';

import '../core/dates.dart';
import '../core/units.dart';
import '../ui/store_scope.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

class StatsScreen extends StatelessWidget {
  const StatsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final a = store.analysis();
    final u = store.units;
    final scheme = Theme.of(context).colorScheme;
    final streak = a.weekStreak();
    final fastest = a.fastestSecPerKm;

    final tiles = <(String, String, String)>[
      (u.distance(a.totalKm), u.name, 'Total distance'),
      ('${a.runs.length}', '', 'Runs logged'),
      (u.toUnit(a.weeklyAverageKm()).toStringAsFixed(1), u.name, 'Weekly average, last 8 weeks'),
      (u.distance(a.longestKm), u.name, 'Longest run'),
      (fastest == null ? '–' : fmtMinSec(u.pace(fastest)), u.paceName, 'Fastest pace (3 km+)'),
      ('$streak', streak == 1 ? 'week' : 'weeks', 'Current weekly streak'),
      ('${(a.totalSeconds / 3600).round()}', 'h', 'Time on your feet'),
      (a.runs.isEmpty ? '–' : u.distance(a.totalKm / a.runs.length), u.name, 'Average run'),
    ];

    final predictor = a.racePredictor();
    const races = [('5K', 5.0), ('10K', 10.0), ('Half marathon', 21.0975), ('Marathon', 42.195)];
    final milestones = a.milestones();
    final reached = milestones.where((m) => m.reached).length;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 104),
      children: [
        const SectionTitle('Totals'),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.75,
          children: [for (final (v, unit, label) in tiles) _Tile(value: v, unit: unit, label: label)],
        ),
        const SectionTitle('Race predictions'),
        Card(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: predictor == null
                ? Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text('Log a run of 3 km or more to get race-time estimates.',
                        style: TextStyle(color: scheme.onSurfaceVariant)),
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final (name, km) in races) ...[
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.baseline,
                            textBaseline: TextBaseline.alphabetic,
                            children: [
                              Expanded(child: Text(name, style: const TextStyle(fontSize: 15))),
                              Text(fmtDuration(predictor.secondsFor(km)),
                                  style: displayStyle(22, scheme.onSurface, weight: FontWeight.w700)),
                              SizedBox(
                                width: 88,
                                child: Text(
                                  '${fmtMinSec(u.pace(predictor.secondsFor(km) / km))} ${u.paceName}',
                                  textAlign: TextAlign.right,
                                  style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13, fontFeatures: tabular),
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (name != 'Marathon') Divider(height: 1, color: scheme.outlineVariant),
                      ],
                      const SizedBox(height: 10),
                      Text(
                        "Estimated with Riegel's formula from your strongest recent effort: "
                        '${u.distance(predictor.base.km)} ${u.name} in ${fmtDuration(predictor.base.seconds)} '
                        'on ${fmtDayMonth(predictor.base.day)}. Long-distance estimates assume you have '
                        'trained for the distance.',
                        style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13, height: 1.4),
                      ),
                    ],
                  ),
          ),
        ),
        SectionTitle('Milestones', trailing: '$reached of ${milestones.length}'),
        LayoutBuilder(
          builder: (context, c) {
            final w = (c.maxWidth - 8) / 2;
            return Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final m in milestones)
                  SizedBox(
                    width: w,
                    child: _Badge(mark: m.mark, title: m.title, detail: m.detail, reached: m.reached),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.value, required this.unit, required this.label});

  final String value, unit, label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(value, style: displayStyle(32, scheme.onSurface, weight: FontWeight.w700)),
                if (unit.isNotEmpty) ...[
                  const SizedBox(width: 4),
                  Text(unit, style: displayStyle(16, scheme.onSurfaceVariant, weight: FontWeight.w700)),
                ],
              ],
            ),
          ),
          const SizedBox(height: 2),
          Text(label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant, height: 1.2)),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.mark, required this.title, required this.detail, required this.reached});

  final String mark, title, detail;
  final bool reached;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final bg = reached ? scheme.primaryContainer : scheme.surfaceContainer;
    final fg = reached ? scheme.onPrimaryContainer : scheme.onSurfaceVariant;
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: reached ? scheme.primary : scheme.outlineVariant,
            ),
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Padding(
                padding: const EdgeInsets.all(4),
                child: Text(mark,
                    style: displayStyle(14, reached ? scheme.onPrimary : scheme.onSurfaceVariant)),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontWeight: FontWeight.w600, color: fg, fontSize: 13.5)),
                Text(detail, style: TextStyle(color: fg, fontSize: 12.5, height: 1.25)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
