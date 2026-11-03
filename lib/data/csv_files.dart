// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'dart:convert';

import 'package:flutter/services.dart';

/// Talks to the system "Save as" and "Open" screens (see MainActivity.kt).
/// No storage permission is needed: the person picks the file.
class CsvFiles {
  static const _channel = MethodChannel('spur/files');

  /// Asks where to save [csv]. Returns false if the person cancelled.
  static Future<bool> save(String fileName, String csv) async {
    final done = await _channel.invokeMethod<bool>('save', {
      'name': fileName,
      'bytes': Uint8List.fromList(utf8.encode(csv)),
    });
    return done ?? false;
  }

  /// Lets the person pick a CSV file and returns its text, or null if they
  /// cancelled.
  static Future<String?> open() async {
    final bytes = await _channel.invokeMethod<Uint8List>('open');
    if (bytes == null) return null;
    final text = utf8.decode(bytes, allowMalformed: true);
    return text.startsWith('﻿') ? text.substring(1) : text; // drop a spreadsheet's byte-order mark
  }
}
