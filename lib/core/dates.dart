// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

/// Calendar days are stored as whole numbers of days since 1970-01-01 (UTC).
/// This keeps runs free of time zones and makes day arithmetic trivial.
library;

const int _msPerDay = 86400000;

int dayFromYmd(int y, int m, int d) =>
    DateTime.utc(y, m, d).millisecondsSinceEpoch ~/ _msPerDay;

int dayFromDateTime(DateTime t) => dayFromYmd(t.year, t.month, t.day);

int todayDay() => dayFromDateTime(DateTime.now());

DateTime dayToDate(int day) =>
    DateTime.fromMillisecondsSinceEpoch(day * _msPerDay, isUtc: true);

/// Monday = 0 … Sunday = 6.
int weekdayIndex(int day) => dayToDate(day).weekday - 1;

/// The Monday of the week that contains [day].
int weekStart(int day) => day - weekdayIndex(day);

String _two(int n) => n.toString().padLeft(2, '0');

String isoDate(int day) {
  final d = dayToDate(day);
  return '${d.year}-${_two(d.month)}-${_two(d.day)}';
}

/// Parses `YYYY-MM-DD`. Returns null for anything else, including impossible
/// dates such as 2026-02-31.
int? parseIsoDate(String s) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(s.trim());
  if (m == null) return null;
  final y = int.parse(m.group(1)!);
  final mo = int.parse(m.group(2)!);
  final d = int.parse(m.group(3)!);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  final day = dayFromYmd(y, mo, d);
  return isoDate(day) == s.trim() ? day : null;
}

const monthsShort = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const monthsLong = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const weekdaysShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

String fmtDayMonth(int day) {
  final d = dayToDate(day);
  return '${d.day} ${monthsShort[d.month - 1]}';
}

String fmtLongDate(int day) {
  final d = dayToDate(day);
  return '${d.day} ${monthsLong[d.month - 1]} ${d.year}';
}

String fmtMonthYear(int day) {
  final d = dayToDate(day);
  return '${monthsLong[d.month - 1]} ${d.year}';
}

String fmtWeekdayDate(int day) =>
    '${weekdaysShort[weekdayIndex(day)]} ${fmtDayMonth(day)}';

/// First day of the month containing [day].
int monthStart(int day) {
  final d = dayToDate(day);
  return dayFromYmd(d.year, d.month, 1);
}

/// First day of the month after the one containing [day].
int nextMonthStart(int day) {
  final d = dayToDate(day);
  return d.month == 12 ? dayFromYmd(d.year + 1, 1, 1) : dayFromYmd(d.year, d.month + 1, 1);
}
