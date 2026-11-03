// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'package:flutter/material.dart';

import '../core/dates.dart';
import '../core/units.dart';
import '../models/run.dart';
import '../ui/store_scope.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'run_editor.dart';

class RunsScreen extends StatelessWidget {
  const RunsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final u = store.units;
    final scheme = Theme.of(context).colorScheme;
    if (store.runs.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text(
            'Your diary is empty. Tap Log run to add a run.',
            textAlign: TextAlign.center,
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
        ),
      );
    }

    final sorted = List<Run>.of(store.runs)
      ..sort((a, b) => b.day != a.day ? b.day.compareTo(a.day) : b.id.compareTo(a.id));
    final groups = <int, List<Run>>{};
    for (final r in sorted) {
      groups.putIfAbsent(monthStart(r.day), () => []).add(r);
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 104),
      children: [
        for (final MapEntry(key: month, value: runs) in groups.entries) ...[
          SectionTitle(
            fmtMonthYear(month),
            trailing: '${runs.length} ${runs.length == 1 ? 'run' : 'runs'} · '
                '${u.distance(runs.fold<double>(0.0, (s, r) => s + r.km))} ${u.name}',
          ),
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (var i = 0; i < runs.length; i++) ...[
                  if (i > 0) Divider(height: 1, indent: 16, endIndent: 16, color: scheme.outlineVariant),
                  _RunTile(run: runs[i], units: u),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _RunTile extends StatelessWidget {
  const _RunTile({required this.run, required this.units});

  final Run run;
  final Units units;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final muted = TextStyle(color: scheme.onSurfaceVariant, fontSize: 13, fontFeatures: tabular);
    return InkWell(
      onTap: () => showRunEditor(context, run: run),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
        child: Row(
          children: [
            SizedBox(
              width: 48,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(weekdaysShort[weekdayIndex(run.day)].toUpperCase(),
                      style: muted.copyWith(fontSize: 11.5, letterSpacing: 0.8)),
                  Text('${dayToDate(run.day).day}', style: displayStyle(24, scheme.onSurface, weight: FontWeight.w700)),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Wrap(
                crossAxisAlignment: WrapCrossAlignment.end,
                spacing: 6,
                children: [
                  Text.rich(TextSpan(children: [
                    TextSpan(
                        text: units.distance(run.km),
                        style: displayStyle(24, scheme.onSurface, weight: FontWeight.w700)),
                    TextSpan(text: ' ${units.name}', style: muted.copyWith(fontSize: 14)),
                  ])),
                  if (run.sample)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                      decoration: BoxDecoration(
                        color: scheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text('sample', style: muted.copyWith(fontSize: 11)),
                    ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('${fmtMinSec(units.pace(run.secPerKm))} ${units.paceName}',
                    style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15, fontFeatures: tabular, color: scheme.onSurface)),
                Text('${fmtDuration(run.seconds)} · ${units.speed(run.secPerKm).toStringAsFixed(1)} ${units.speedName}',
                    style: muted),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
