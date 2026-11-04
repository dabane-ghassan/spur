// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/analysis.dart';
import '../core/dates.dart';
import '../core/units.dart';
import '../models/run.dart';

enum ChartRange { m1, m3, m6, y1, all }

extension ChartRangeInfo on ChartRange {
  String get label => const {
        ChartRange.m1: '1M',
        ChartRange.m3: '3M',
        ChartRange.m6: '6M',
        ChartRange.y1: '1Y',
        ChartRange.all: 'All',
      }[this]!;

  /// Number of days shown, or null for everything.
  int? get days => const {
        ChartRange.m1: 30,
        ChartRange.m3: 91,
        ChartRange.m6: 182,
        ChartRange.y1: 365,
        ChartRange.all: null,
      }[this];
}

/// Holds the run log and settings and saves both on the device. Nothing ever
/// leaves the phone: there is no network code in spur.
class RunStore extends ChangeNotifier {
  RunStore._(this._prefs);

  static const _key = 'spur.v1';

  final SharedPreferences _prefs;

  List<Run> _runs = [];
  DistanceUnit _unit = DistanceUnit.km;
  ChartMetric _metric = ChartMetric.pace;
  ChartRange _range = ChartRange.m3;
  String _palette = 'tartan';
  ThemeMode _themeMode = ThemeMode.system;
  double? _goalSecPerKm;
  Smoothing _smoothing = Smoothing.medium;
  VolumeMetric _volume = VolumeMetric.distance;
  String _name = '';
  double? _heightCm;

  static Future<RunStore> load() async {
    final prefs = await SharedPreferences.getInstance();
    final store = RunStore._(prefs);
    store._read();
    return store;
  }

  // ---- getters -------------------------------------------------------------

  List<Run> get runs => List.unmodifiable(_runs);
  bool get hasSamples => _runs.any((r) => r.sample);
  DistanceUnit get unit => _unit;
  Units get units => Units(_unit);
  ChartMetric get metric => _metric;
  ChartRange get range => _range;
  String get palette => _palette;
  ThemeMode get themeMode => _themeMode;
  double? get goalSecPerKm => _goalSecPerKm;
  Smoothing get smoothing => _smoothing;
  VolumeMetric get volume => _volume;

  /// Profile: the runner's first name (shown on the race bib) and height.
  String get name => _name;
  double? get heightCm => _heightCm;

  Analysis analysis() => Analysis(_runs, today: todayDay(), smoothing: _smoothing);

  // ---- runs ----------------------------------------------------------------

  String _newId() => 'r${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';

  void addRun({required int day, required double km, required int seconds}) {
    _runs.add(Run(id: _newId(), day: day, km: km, seconds: seconds));
    _changed();
  }

  void updateRun(Run run) {
    final i = _runs.indexWhere((r) => r.id == run.id);
    if (i < 0) return;
    _runs[i] = run.copyWith(sample: false);
    _changed();
  }

  void deleteRun(String id) {
    _runs.removeWhere((r) => r.id == id);
    _changed();
  }

  void loadSamples() {
    _runs.removeWhere((r) => r.sample);
    _runs.addAll(makeSampleRuns(todayDay()));
    _changed();
  }

  void clearSamples() {
    _runs.removeWhere((r) => r.sample);
    _changed();
  }

  void deleteAll() {
    _runs.clear();
    _changed();
  }

  // ---- settings ------------------------------------------------------------

  set unit(DistanceUnit v) => _set(() => _unit = v);
  set metric(ChartMetric v) => _set(() => _metric = v);
  set range(ChartRange v) {
    view.value = null;
    _set(() => _range = v);
  }

  /// The zoomed part of the timeline shown by the trend charts, as (first day,
  /// last day). Null shows the chosen [range]. Not saved: zoom is for exploring.
  final ValueNotifier<(double, double)?> view = ValueNotifier(null);
  set palette(String v) => _set(() => _palette = v);
  set themeMode(ThemeMode v) => _set(() => _themeMode = v);
  set goalSecPerKm(double? v) => _set(() => _goalSecPerKm = v);
  set smoothing(Smoothing v) => _set(() => _smoothing = v);
  set volume(VolumeMetric v) => _set(() => _volume = v);

  void setProfile({required String name, double? heightCm}) => _set(() {
        _name = cleanName(name);
        _heightCm = heightCm != null && heightCm >= 100 && heightCm <= 250 ? heightCm : null;
      });

  /// Trims a name to something that fits on a race bib.
  static String cleanName(String raw) {
    final s = raw.replaceAll(RegExp(r'[\u0000-\u001f\u007f]'), '').trim().replaceAll(RegExp(r'\s+'), ' ');
    return s.length > 40 ? s.substring(0, 40).trimRight() : s;
  }

  void _set(void Function() apply) {
    apply();
    _changed();
  }

  // ---- CSV -----------------------------------------------------------------

  String exportCsv() {
    final sorted = List<Run>.of(_runs)..sort((a, b) => a.day.compareTo(b.day));
    final lines = sorted.map((r) => '${isoDate(r.day)},${r.km.toStringAsFixed(2)},${fmtDuration(r.seconds)}');
    return ['date,distance_km,duration', ...lines].join('\n');
  }

  /// Imports lines of `date,km,duration`. Duplicates are skipped.
  ImportResult importCsv(String text) {
    final seen = _runs.map((r) => '${r.day}|${r.km.toStringAsFixed(2)}|${r.seconds}').toSet();
    var added = 0, skipped = 0, n = 0;
    for (final raw in const LineSplitter().convert(text)) {
      final line = raw.trim();
      if (line.isEmpty) continue;
      // Tabs or semicolons win over commas, so "5,0" can be a decimal in those files.
      final sep = line.contains('\t') ? '\t' : (line.contains(';') ? ';' : ',');
      final cells = line.split(sep);
      if (cells.first.toLowerCase().contains('date')) continue;
      final day = cells.isNotEmpty ? parseIsoDate(cells[0]) : null;
      final km = cells.length > 1 ? parseDecimal(cells[1]) : null;
      final sec = cells.length > 2 ? parseDuration(cells[2]) : null;
      if (day == null || km == null || sec == null) {
        skipped++;
        continue;
      }
      final run = Run(id: '${_newId()}${n++}', day: day, km: km, seconds: sec);
      if (!run.isValid || day > todayDay()) {
        skipped++;
        continue;
      }
      final key = '$day|${km.toStringAsFixed(2)}|$sec';
      if (!seen.add(key)) continue;
      _runs.add(run);
      added++;
    }
    if (added > 0) _changed();
    return ImportResult(added, skipped);
  }

  // ---- persistence ---------------------------------------------------------

  void _changed() {
    notifyListeners();
    _write();
  }

  void _read() {
    final raw = _prefs.getString(_key);
    if (raw == null) return;
    try {
      final j = jsonDecode(raw) as Map<String, dynamic>;
      _runs = (j['runs'] as List? ?? const []).map(Run.fromJson).whereType<Run>().toList();
      final s = (j['settings'] as Map?) ?? const {};
      _unit = s['unit'] == 'mi' ? DistanceUnit.mi : DistanceUnit.km;
      _metric = s['metric'] == 'speed' ? ChartMetric.speed : ChartMetric.pace;
      _range = ChartRange.values.firstWhere((r) => r.name == s['range'], orElse: () => ChartRange.m3);
      _palette = s['palette'] is String ? s['palette'] as String : 'tartan';
      _themeMode = ThemeMode.values.firstWhere((m) => m.name == s['themeMode'], orElse: () => ThemeMode.system);
      _goalSecPerKm = (s['goal'] as num?)?.toDouble();
      _smoothing = Smoothing.values.firstWhere((v) => v.name == s['smoothing'], orElse: () => Smoothing.medium);
      _volume = s['volume'] == 'time' ? VolumeMetric.time : VolumeMetric.distance;
      final profile = (j['profile'] as Map?) ?? const {};
      _name = profile['name'] is String ? cleanName(profile['name'] as String) : '';
      final h = (profile['heightCm'] as num?)?.toDouble();
      _heightCm = h != null && h >= 100 && h <= 250 ? h : null;
    } catch (_) {
      // A corrupt store should never crash the app; start fresh instead.
      _runs = [];
    }
  }

  Future<void> _write() => _prefs.setString(
        _key,
        jsonEncode({
          'version': 1,
          'runs': _runs.map((r) => r.toJson()).toList(),
          'profile': {
            if (_name.isNotEmpty) 'name': _name,
            if (_heightCm != null) 'heightCm': _heightCm,
          },
          'settings': {
            'unit': _unit.name,
            'metric': _metric.name,
            'range': _range.name,
            'palette': _palette,
            'themeMode': _themeMode.name,
            if (_goalSecPerKm != null) 'goal': _goalSecPerKm,
            'smoothing': _smoothing.name,
            'volume': _volume.name,
          },
        }),
      );
}

class ImportResult {
  const ImportResult(this.added, this.skipped);

  final int added, skipped;
}
