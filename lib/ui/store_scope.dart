// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'package:flutter/widgets.dart';

import '../data/run_store.dart';

/// Makes the [RunStore] available below it and rebuilds dependents when it
/// changes.
class StoreScope extends InheritedNotifier<RunStore> {
  const StoreScope({super.key, required RunStore store, required super.child})
      : super(notifier: store);

  static RunStore of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<StoreScope>()!.notifier!;

  /// Read without subscribing to changes (for callbacks).
  static RunStore read(BuildContext context) =>
      context.getInheritedWidgetOfExactType<StoreScope>()!.notifier!;
}
