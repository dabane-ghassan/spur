// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'package:flutter/material.dart';

/// Shows one of [children] and slides between them when [index] changes:
/// the new page comes in from the side it sits on in the navigation bar.
/// Every page stays alive, so scroll positions and zoom are kept.
class SlidingTabs extends StatefulWidget {
  const SlidingTabs({super.key, required this.index, required this.children});

  final int index;
  final List<Widget> children;

  @override
  State<SlidingTabs> createState() => _SlidingTabsState();
}

class _SlidingTabsState extends State<SlidingTabs> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 320),
    value: 1,
  );
  late int _current = widget.index;
  int? _previous;

  @override
  void didUpdateWidget(SlidingTabs old) {
    super.didUpdateWidget(old);
    if (widget.index == _current) return;
    _previous = _current;
    _current = widget.index;
    if (MediaQuery.of(context).disableAnimations) {
      _controller.value = 1;
    } else {
      _controller.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final t = Curves.easeOutCubic.transform(_controller.value);
          final sliding = _previous != null && _controller.value < 1;
          final dir = (_previous ?? _current) < _current ? 1.0 : -1.0;
          return Stack(
            fit: StackFit.expand,
            children: [
              for (var i = 0; i < widget.children.length; i++)
                KeyedSubtree(
                  key: ValueKey(i),
                  child: _layer(i, t, sliding, dir),
                ),
            ],
          );
        },
      ),
    );
  }

  /// The same widgets wrap every page in every state, so Flutter keeps each
  /// page's state (scroll position, zoom) instead of rebuilding it.
  Widget _layer(int i, double t, bool sliding, double dir) {
    final isCurrent = i == _current, isLeaving = sliding && i == _previous;
    final shown = isCurrent || isLeaving;
    final dx = !sliding ? 0.0 : (isCurrent ? dir * (1 - t) : (isLeaving ? -dir * t : 0.0));
    return Offstage(
      offstage: !shown,
      child: TickerMode(
        enabled: shown,
        child: IgnorePointer(
          ignoring: isLeaving,
          child: FractionalTranslation(translation: Offset(dx, 0), child: widget.children[i]),
        ),
      ),
    );
  }
}
