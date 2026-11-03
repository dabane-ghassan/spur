// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'dart:math' as math;

import 'package:flutter/material.dart';

/// The spur mark: two footprints climbing diagonally on a rounded tile.
class SpurLogo extends StatelessWidget {
  const SpurLogo({super.key, this.size = 32});

  final double size;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return CustomPaint(
      size: Size.square(size),
      painter: _LogoPainter(scheme.primary, scheme.onPrimary),
    );
  }
}

class _LogoPainter extends CustomPainter {
  _LogoPainter(this.tile, this.mark);

  final Color tile, mark;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 48;
    canvas.drawRRect(
      RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(14 * s)),
      Paint()..color = tile,
    );
    final p = Paint()..color = mark;
    void foot(double cx, double cy) {
      canvas.save();
      canvas.translate(cx * s, cy * s);
      canvas.rotate(-18 * math.pi / 180);
      canvas.drawOval(Rect.fromCenter(center: Offset.zero, width: 9 * s, height: 15 * s), p);
      canvas.restore();
    }

    foot(17, 31);
    foot(31, 17);
    final dot = Paint()..color = mark.withValues(alpha: 0.6);
    canvas.drawCircle(Offset(13 * s, 21 * s), 1.6 * s, dot);
    canvas.drawCircle(Offset(35 * s, 27 * s), 1.6 * s, dot);
  }

  @override
  bool shouldRepaint(_LogoPainter old) => old.tile != tile || old.mark != mark;
}
