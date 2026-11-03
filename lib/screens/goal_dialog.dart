// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../data/run_store.dart';
import '../ui/store_scope.dart';

Future<void> showGoalDialog(BuildContext context) {
  final store = StoreScope.read(context);
  return showDialog<void>(context: context, builder: (_) => _GoalDialog(store: store));
}

class _GoalDialog extends StatefulWidget {
  const _GoalDialog({required this.store});

  final RunStore store;

  @override
  State<_GoalDialog> createState() => _GoalDialogState();
}

class _GoalDialogState extends State<_GoalDialog> {
  final _min = TextEditingController();
  final _sec = TextEditingController();
  String? _error;

  @override
  void initState() {
    super.initState();
    final g = widget.store.goalSecPerKm;
    if (g != null) {
      final perUnit = widget.store.units.pace(g).round();
      _min.text = '${perUnit ~/ 60}';
      _sec.text = (perUnit % 60).toString().padLeft(2, '0');
    }
  }

  @override
  void dispose() {
    _min.dispose();
    _sec.dispose();
    super.dispose();
  }

  void _save() {
    final m = int.tryParse(_min.text.trim()) ?? 0;
    final s = int.tryParse(_sec.text.trim()) ?? 0;
    if (s > 59) {
      setState(() => _error = 'Seconds must be between 0 and 59.');
      return;
    }
    final secPerKm = widget.store.units.paceToKm((m * 60 + s).toDouble());
    if (secPerKm < 150 || secPerKm > 1200) {
      setState(() => _error = 'Enter a pace between 2:30 and 20:00 per km.');
      return;
    }
    widget.store.goalSecPerKm = secPerKm;
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final u = widget.store.units;
    InputDecoration deco(String label, String suffix) =>
        InputDecoration(labelText: label, suffixText: suffix, border: const OutlineInputBorder());
    return AlertDialog(
      title: const Text('Pace goal'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('The pace you want your smoothed trend to reach, for example your target race pace.'),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _min,
                  autofocus: true,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: deco('Minutes', 'min'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _sec,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: deco('Seconds', 's${u.paceName}'),
                  onSubmitted: (_) => _save(),
                ),
              ),
            ],
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
        ],
      ),
      actions: [
        if (widget.store.goalSecPerKm != null)
          TextButton(
            onPressed: () {
              widget.store.goalSecPerKm = null;
              Navigator.pop(context);
            },
            child: const Text('Remove goal'),
          ),
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(onPressed: _save, child: const Text('Save goal')),
      ],
    );
  }
}
