// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

const double kmPerMile = 1.609344;

enum DistanceUnit { km, mi }

enum ChartMetric { pace, speed }

/// Converts between the stored units (kilometres, seconds per km) and the
/// unit the runner chose to see.
class Units {
  const Units(this.unit);

  final DistanceUnit unit;

  bool get isMiles => unit == DistanceUnit.mi;
  String get name => isMiles ? 'mi' : 'km';
  String get speedName => isMiles ? 'mph' : 'km/h';
  String get paceName => '/$name';

  double toUnit(double km) => isMiles ? km / kmPerMile : km;
  double fromUnit(double value) => isMiles ? value * kmPerMile : value;

  /// Seconds per km → seconds per chosen unit.
  double pace(double secPerKm) => isMiles ? secPerKm * kmPerMile : secPerKm;

  /// Seconds per chosen unit → seconds per km.
  double paceToKm(double secPerUnit) => isMiles ? secPerUnit / kmPerMile : secPerUnit;

  /// Seconds per km → chosen unit per hour.
  double speed(double secPerKm) => toUnit(3600 / secPerKm);

  String distance(double km) {
    final v = toUnit(km);
    if (v >= 100) return v.toStringAsFixed(0);
    return v.toStringAsFixed(v >= 10 ? 1 : 2);
  }
}

String _two(int n) => n.toString().padLeft(2, '0');

/// 312.4 → "5:12"
String fmtMinSec(double seconds) {
  final s = seconds.round();
  return '${s ~/ 60}:${_two(s % 60)}';
}

/// 3725 → "1:02:05", 1565 → "26:05"
String fmtDuration(num seconds) {
  final s = seconds.round();
  final h = s ~/ 3600, m = (s % 3600) ~/ 60, r = s % 60;
  return h > 0 ? '$h:${_two(m)}:${_two(r)}' : '$m:${_two(r)}';
}

/// Accepts "h:mm:ss", "mm:ss" or plain seconds.
int? parseDuration(String input) {
  final s = input.trim();
  if (s.isEmpty) return null;
  if (RegExp(r'^\d+(\.\d+)?$').hasMatch(s)) return double.parse(s).round();
  final parts = s.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  final nums = parts.map(int.tryParse).toList();
  if (nums.any((n) => n == null || n < 0)) return null;
  if (parts.length == 3) return nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
  return nums[0]! * 60 + nums[1]!;
}

/// Parses a decimal typed with either "." or "," as separator.
double? parseDecimal(String input) {
  final s = input.trim().replaceAll(',', '.');
  if (s.isEmpty) return null;
  return double.tryParse(s);
}
