// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import '../core/dates.dart';

/// One logged run. Distance is always stored in kilometres and duration in
/// whole seconds; units are only converted for display.
class Run {
  const Run({
    required this.id,
    required this.day,
    required this.km,
    required this.seconds,
    this.sample = false,
  });

  final String id;

  /// Calendar day, see [dayFromYmd].
  final int day;
  final double km;
  final int seconds;

  /// True for the example runs a new user can load to explore the app.
  final bool sample;

  double get secPerKm => seconds / km;

  bool get isValid =>
      km > 0 && km <= 500 && seconds > 0 && secPerKm >= 150 && secPerKm <= 1500;

  Run copyWith({int? day, double? km, int? seconds, bool? sample}) => Run(
        id: id,
        day: day ?? this.day,
        km: km ?? this.km,
        seconds: seconds ?? this.seconds,
        sample: sample ?? this.sample,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'date': isoDate(day),
        'km': km,
        'sec': seconds,
        if (sample) 'sample': true,
      };

  static Run? fromJson(Object? json) {
    if (json is! Map) return null;
    final day = parseIsoDate('${json['date']}');
    final km = (json['km'] as num?)?.toDouble();
    final sec = (json['sec'] as num?)?.round();
    final id = json['id'];
    if (day == null || km == null || sec == null || id is! String) return null;
    final run = Run(id: id, day: day, km: km, seconds: sec, sample: json['sample'] == true);
    return run.isValid ? run : null;
  }
}
