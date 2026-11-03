// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/dates.dart';
import '../core/units.dart';
import '../data/run_store.dart';
import '../models/run.dart';
import '../ui/store_scope.dart';
import '../ui/theme.dart';

/// Opens the bottom sheet to log a new run, or to edit [run].
Future<void> showRunEditor(BuildContext context, {Run? run}) async {
  final store = StoreScope.read(context);
  final messenger = ScaffoldMessenger.of(context);
  final result = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (_) => RunEditor(store: store, run: run),
  );
  if (result != null) {
    messenger.showSnackBar(SnackBar(content: Text(result)));
  }
}

enum _Entry { time, pace, speed }

class RunEditor extends StatefulWidget {
  const RunEditor({super.key, required this.store, this.run});

  final RunStore store;
  final Run? run;

  @override
  State<RunEditor> createState() => _RunEditorState();
}

class _RunEditorState extends State<RunEditor> {
  late int _day;
  _Entry _entry = _Entry.time;
  String? _error;
  bool _confirmDelete = false;

  final _dist = TextEditingController();
  final _h = TextEditingController();
  final _m = TextEditingController();
  final _s = TextEditingController();
  final _pm = TextEditingController();
  final _ps = TextEditingController();
  final _sp = TextEditingController();

  List<TextEditingController> get _all => [_dist, _h, _m, _s, _pm, _ps, _sp];

  Units get _u => widget.store.units;

  @override
  void initState() {
    super.initState();
    final r = widget.run;
    _day = r?.day ?? todayDay();
    if (r != null) {
      _dist.text = _trim(_u.toUnit(r.km).toStringAsFixed(2));
      if (r.seconds >= 3600) _h.text = '${r.seconds ~/ 3600}';
      _m.text = '${(r.seconds % 3600) ~/ 60}';
      _s.text = (r.seconds % 60).toString().padLeft(2, '0');
    }
    for (final c in _all) {
      c.addListener(_refresh);
    }
  }

  void _refresh() => setState(() {});

  @override
  void dispose() {
    for (final c in _all) {
      c.dispose();
    }
    super.dispose();
  }

  static String _trim(String s) => s.contains('.') ? s.replaceFirst(RegExp(r'\.?0+$'), '') : s;

  int _int(TextEditingController c) => int.tryParse(c.text.trim()) ?? 0;

  double get _km => _u.fromUnit(parseDecimal(_dist.text) ?? 0);

  int get _seconds {
    final km = _km;
    switch (_entry) {
      case _Entry.time:
        return _int(_h) * 3600 + _int(_m) * 60 + _int(_s);
      case _Entry.pace:
        return ((_int(_pm) * 60 + _int(_ps)) * _u.toUnit(km)).round();
      case _Entry.speed:
        final sp = parseDecimal(_sp.text) ?? 0;
        return sp > 0 ? (_u.toUnit(km) / sp * 3600).round() : 0;
    }
  }

  Future<void> _pickDate() async {
    final today = todayDay();
    final d = dayToDate(_day.clamp(dayFromYmd(2000, 1, 1), today));
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime(d.year, d.month, d.day),
      firstDate: DateTime(2000),
      lastDate: DateTime.now(),
    );
    if (picked != null && mounted) setState(() => _day = dayFromDateTime(picked));
  }

  void _save() {
    final km = _km, sec = _seconds;
    String? err;
    if (_day > todayDay()) {
      err = "That date is in the future. Log runs once they're done.";
    } else if (km <= 0) {
      err = 'Enter how far you ran.';
    } else if (km > 500) {
      err = 'That is over ${_u.toUnit(500).round()} ${_u.name}. Check the distance.';
    } else if (sec <= 0) {
      err = switch (_entry) {
        _Entry.time => 'Enter how long the run took.',
        _Entry.pace => 'Enter your average pace.',
        _Entry.speed => 'Enter your average speed.',
      };
    } else if (sec / km < 150 || sec / km > 1500) {
      err = 'A pace of ${fmtMinSec(_u.pace(sec / km))} ${_u.paceName} looks off. Check the numbers.';
    }
    if (err != null) {
      setState(() => _error = err);
      return;
    }
    final r = widget.run;
    if (r == null) {
      widget.store.addRun(day: _day, km: km, seconds: sec);
      Navigator.pop(context, 'Run saved');
    } else {
      widget.store.updateRun(r.copyWith(day: _day, km: km, seconds: sec));
      Navigator.pop(context, 'Run updated');
    }
  }

  void _delete() {
    widget.store.deleteRun(widget.run!.id);
    Navigator.pop(context, 'Run deleted');
  }

  Widget _num(TextEditingController c, String label, String suffix, {bool decimal = false}) => TextField(
        controller: c,
        keyboardType: decimal ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.number,
        inputFormatters: decimal
            ? [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))]
            : [FilteringTextInputFormatter.digitsOnly],
        style: displayStyle(24, Theme.of(context).colorScheme.onSurface, weight: FontWeight.w700),
        decoration: InputDecoration(labelText: label, suffixText: suffix, border: const OutlineInputBorder()),
      );

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final u = _u;
    final km = _km, sec = _seconds;
    final hasPreview = km > 0 && sec > 0;

    final Widget inputs = switch (_entry) {
      _Entry.time => Row(children: [
          Expanded(child: _num(_h, 'Hours', 'h')),
          const SizedBox(width: 8),
          Expanded(child: _num(_m, 'Minutes', 'm')),
          const SizedBox(width: 8),
          Expanded(child: _num(_s, 'Seconds', 's')),
        ]),
      _Entry.pace => Row(children: [
          Expanded(child: _num(_pm, 'Minutes', 'min')),
          const SizedBox(width: 8),
          Expanded(child: _num(_ps, 'Seconds', 's${u.paceName}')),
        ]),
      _Entry.speed => _num(_sp, 'Average speed', u.speedName, decimal: true),
    };

    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.run == null ? 'Log a run' : 'Edit run', style: displayStyle(30, scheme.onSurface, italic: true)),
            const SizedBox(height: 16),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: InkWell(
                    onTap: _pickDate,
                    borderRadius: BorderRadius.circular(4),
                    child: InputDecorator(
                      decoration: const InputDecoration(
                        labelText: 'Date',
                        border: OutlineInputBorder(),
                        suffixIcon: Icon(Icons.calendar_today_outlined, size: 20),
                      ),
                      child: Text(_day == todayDay() ? 'Today' : fmtWeekdayDate(_day),
                          style: const TextStyle(fontSize: 16)),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(child: _num(_dist, 'Distance', u.name, decimal: true)),
              ],
            ),
            const SizedBox(height: 16),
            SegmentedButton<_Entry>(
              segments: const [
                ButtonSegment(value: _Entry.time, label: Text('Time')),
                ButtonSegment(value: _Entry.pace, label: Text('Pace')),
                ButtonSegment(value: _Entry.speed, label: Text('Speed')),
              ],
              selected: {_entry},
              showSelectedIcon: false,
              onSelectionChanged: (s) => setState(() {
                _entry = s.first;
                _error = null;
              }),
            ),
            const SizedBox(height: 16),
            inputs,
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(12),
              ),
              child: hasPreview
                  ? Wrap(
                      spacing: 18,
                      runSpacing: 4,
                      children: [
                        _PreviewItem(fmtDuration(sec), 'time'),
                        _PreviewItem(fmtMinSec(u.pace(sec / km)), u.paceName),
                        _PreviewItem(u.speed(sec / km).toStringAsFixed(1), u.speedName),
                      ],
                    )
                  : Text(
                      'Enter the distance and one of time, pace or speed. spur works out the other two.',
                      style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13.5),
                    ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(_error!, style: TextStyle(color: scheme.error)),
            ],
            const SizedBox(height: 16),
            if (_confirmDelete)
              Row(
                children: [
                  const Expanded(child: Text('Delete this run?')),
                  TextButton(onPressed: () => setState(() => _confirmDelete = false), child: const Text('Keep')),
                  const SizedBox(width: 6),
                  FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: scheme.error, foregroundColor: scheme.onError),
                    onPressed: _delete,
                    child: const Text('Delete'),
                  ),
                ],
              )
            else
              Row(
                children: [
                  if (widget.run != null)
                    TextButton(
                      style: TextButton.styleFrom(foregroundColor: scheme.error),
                      onPressed: () => setState(() => _confirmDelete = true),
                      child: const Text('Delete'),
                    ),
                  const Spacer(),
                  TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
                  const SizedBox(width: 6),
                  FilledButton(onPressed: _save, child: const Text('Save run')),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _PreviewItem extends StatelessWidget {
  const _PreviewItem(this.value, this.unit);

  final String value, unit;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        Text(value, style: displayStyle(20, scheme.onSurface, weight: FontWeight.w700)),
        const SizedBox(width: 4),
        Text(unit, style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
      ],
    );
  }
}
