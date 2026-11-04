// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane
//
// Renders the real app screens to PNG files for the F-Droid and Accrescent
// listings, with the app's fonts and five months of sample runs:
//
//   flutter test --update-goldens tool/screenshots
//
// The images land in tool/screenshots/out/. CI copies them to
// fastlane/metadata/android/en-US/images/phoneScreenshots/.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show debugDisableShadows;
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:spur/data/run_store.dart';
import 'package:spur/main.dart';

Future<ByteData> _bytes(String path) async => ByteData.sublistView(await File(path).readAsBytes());

Future<void> _font(String family, List<String> files) async {
  final loader = FontLoader(family);
  for (final f in files) {
    loader.addFont(_bytes(f));
  }
  await loader.load();
}

/// The Flutter SDK folder, for the Material icon font.
String _flutterRoot() {
  final env = Platform.environment['FLUTTER_ROOT'];
  if (env != null && env.isNotEmpty) return env;
  final exe = Platform.resolvedExecutable;
  final i = exe.indexOf('${Platform.pathSeparator}bin${Platform.pathSeparator}cache');
  if (i < 0) throw StateError('Set FLUTTER_ROOT to the Flutter SDK folder.');
  return exe.substring(0, i);
}

/// A store with sample runs saved as ordinary runs, so no "sample runs" banner shows.
Future<RunStore> _store({ThemeMode mode = ThemeMode.light}) async {
  SharedPreferences.setMockInitialValues({});
  final samples = await RunStore.load();
  samples.loadSamples();
  final csv = samples.exportCsv();
  SharedPreferences.setMockInitialValues({});
  final store = await RunStore.load();
  store.importCsv(csv);
  store.setProfile(name: 'Sam');
  store.goalSecPerKm = 305;
  store.themeMode = mode;
  return store;
}

void main() {
  setUpAll(() async {
    await _font('Barlow', ['assets/fonts/Barlow-Regular.ttf', 'assets/fonts/Barlow-SemiBold.ttf']);
    await _font('BarlowCondensed', [
      'assets/fonts/BarlowCondensed-Bold.ttf',
      'assets/fonts/BarlowCondensed-ExtraBold.ttf',
      'assets/fonts/BarlowCondensed-ExtraBoldItalic.ttf',
    ]);
    await _font('MaterialIcons', ['${_flutterRoot()}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf']);
  });

  Future<void> phone(WidgetTester tester, RunStore store) async {
    // A 1080 x 2400 phone at 3x: 360 x 800 logical pixels.
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    // flutter_test draws shadows as solid black outlines unless told otherwise.
    // It must be set back before the test ends, which shot() does.
    debugDisableShadows = false;
    await tester.pumpWidget(SpurApp(store: store));
    await tester.pumpAndSettle();
  }

  Future<void> shot(String name) async {
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('out/$name.png'));
    debugDisableShadows = true;
  }

  testWidgets('1 overview', (tester) async {
    await phone(tester, await _store());
    await shot('1');
  });

  testWidgets('2 trends', (tester) async {
    await phone(tester, await _store());
    await tester.drag(find.byType(ListView).first, const Offset(0, -560));
    await tester.pumpAndSettle();
    await shot('2');
  });

  testWidgets('3 log a run', (tester) async {
    await phone(tester, await _store());
    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Distance'), '10');
    await tester.enterText(find.widgetWithText(TextField, 'Minutes').first, '52');
    await tester.pumpAndSettle();
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await shot('3');
  });

  testWidgets('4 stats', (tester) async {
    await phone(tester, await _store());
    await tester.tap(find.text('Stats'));
    await tester.pumpAndSettle();
    await shot('4');
  });

  testWidgets('5 runs', (tester) async {
    await phone(tester, await _store());
    await tester.tap(find.text('Runs'));
    await tester.pumpAndSettle();
    await shot('5');
  });

  testWidgets('6 dark', (tester) async {
    await phone(tester, await _store(mode: ThemeMode.dark));
    await shot('6');
  });
}
