// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'dart:ui' as ui;

import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

class Palette {
  const Palette(this.id, this.name, this.seed);

  final String id, name;
  final Color seed;
}

/// Themes named after where people run.
const palettes = [
  Palette('tartan', 'Tartan', Color(0xFFC4492F)),
  Palette('trail', 'Trail', Color(0xFF3A8A62)),
  Palette('lake', 'Lake', Color(0xFF2C77B8)),
  Palette('golden', 'Golden hour', Color(0xFFE09A1A)),
];

Palette paletteById(String id) =>
    palettes.firstWhere((p) => p.id == id, orElse: () => palettes.first);

const kBodyFont = 'Barlow';
const kDisplayFont = 'BarlowCondensed';

ThemeData buildTheme(String paletteId, Brightness brightness) {
  final scheme = ColorScheme.fromSeed(
    seedColor: paletteById(paletteId).seed,
    brightness: brightness,
  );
  final base = ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    fontFamily: kBodyFont,
  );
  return base.copyWith(
    scaffoldBackgroundColor: scheme.surface,
    // Pushed pages slide in from the side, like the tabs.
    pageTransitionsTheme: const PageTransitionsTheme(builders: {
      TargetPlatform.android: CupertinoPageTransitionsBuilder(),
      TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
    }),
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      centerTitle: false,
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: scheme.surfaceContainerLow,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
    chipTheme: base.chipTheme.copyWith(
      labelStyle: const TextStyle(fontFamily: kBodyFont, fontWeight: FontWeight.w600),
    ),
  );
}

/// Big condensed numbers, like a race-timing board.
TextStyle displayStyle(double size, Color color, {bool italic = false, FontWeight weight = FontWeight.w800}) =>
    TextStyle(
      fontFamily: kDisplayFont,
      fontWeight: weight,
      fontStyle: italic ? FontStyle.italic : FontStyle.normal,
      fontSize: size,
      height: 1.0,
      color: color,
      fontFeatures: const [ui.FontFeature.tabularFigures()],
    );

const tabular = [ui.FontFeature.tabularFigures()];

/// Small uppercase section label.
TextStyle labelStyle(BuildContext context) => TextStyle(
      fontSize: 12.5,
      fontWeight: FontWeight.w600,
      letterSpacing: 1.0,
      color: Theme.of(context).colorScheme.onSurfaceVariant,
    );
