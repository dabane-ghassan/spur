// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:spur/data/run_store.dart';
import 'package:spur/main.dart';

void main() {
  testWidgets('first launch shows the welcome screen, samples fill the overview', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final store = await RunStore.load();
    await tester.pumpWidget(SpurApp(store: store));

    expect(find.text('Your running diary'), findsOneWidget);
    await tester.tap(find.text('Explore with sample runs'));
    await tester.pumpAndSettle();

    expect(find.text('Clear samples'), findsOneWidget);
    expect(find.text('TREND PACE'), findsOneWidget);
    expect(find.text('THIS WEEK'), findsOneWidget);

    await tester.tap(find.text('Stats'));
    await tester.pumpAndSettle();
    expect(find.text('TOTALS'), findsOneWidget);
  });

  testWidgets('tabs slide and keep their place', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final store = await RunStore.load();
    store.loadSamples();
    await tester.pumpWidget(SpurApp(store: store));
    await tester.pumpAndSettle();

    await tester.drag(find.byType(ListView).first, const Offset(0, -300));
    await tester.pumpAndSettle();
    final before = tester.state<ScrollableState>(find.byType(Scrollable).first).position.pixels;
    expect(before, greaterThan(0));

    await tester.tap(find.text('Runs'));
    await tester.pump(const Duration(milliseconds: 100)); // mid-slide: both pages on screen
    expect(find.text('TREND PACE'), findsOneWidget, reason: 'the overview is still sliding out');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Overview'));
    await tester.pumpAndSettle();

    final after = tester.state<ScrollableState>(find.byType(Scrollable).first).position.pixels;
    expect(after, before, reason: 'the overview kept its scroll position');
  });

  testWidgets('logging a run from the sheet', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final store = await RunStore.load();
    await tester.pumpWidget(SpurApp(store: store));

    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Distance'), '8.2');
    await tester.enterText(find.widgetWithText(TextField, 'Minutes'), '42');
    await tester.enterText(find.widgetWithText(TextField, 'Seconds'), '31');
    await tester.ensureVisible(find.text('Save run'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save run'));
    await tester.pumpAndSettle();

    expect(store.runs, hasLength(1));
    expect(store.runs.single.seconds, 2551);
  });
}
