// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'package:flutter/material.dart';

import 'theme.dart';

enum Tone { good, warn, neutral }

/// Rounded status label. Green and amber are kept separate from the theme
/// colour so they mean the same thing in every palette.
class StatusPill extends StatelessWidget {
  const StatusPill(this.text, {super.key, this.tone = Tone.neutral, this.icon});

  final String text;
  final Tone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final Color fg = switch (tone) {
      Tone.good => dark ? const Color(0xFF7FD3A0) : const Color(0xFF1E6B43),
      Tone.warn => dark ? const Color(0xFFFFB86B) : const Color(0xFF9A4A00),
      Tone.neutral => scheme.onSurfaceVariant,
    };
    final Color bg = tone == Tone.neutral ? scheme.surfaceContainerHighest : fg.withValues(alpha: dark ? 0.16 : 0.12);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 16, color: fg), const SizedBox(width: 4)],
          Flexible(
            child: Text(
              text,
              style: TextStyle(color: fg, fontWeight: FontWeight.w600, fontSize: 13, fontFeatures: tabular),
            ),
          ),
        ],
      ),
    );
  }
}

/// The overview headline, styled like a paper race bib with pin holes.
class BibCard extends StatelessWidget {
  const BibCard({
    super.key,
    required this.label,
    required this.value,
    required this.unit,
    required this.date,
    required this.status,
  });

  final String label, value, unit, date;
  final Widget status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    Widget pin() => Container(
          width: 11,
          height: 11,
          decoration: BoxDecoration(
            color: scheme.surface,
            shape: BoxShape.circle,
            border: Border.all(color: scheme.outlineVariant),
          ),
        );
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Stack(
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                color: scheme.primary,
                padding: const EdgeInsets.symmetric(horizontal: 34, vertical: 7),
                child: Row(
                  children: [
                    Text('SPUR', style: displayStyle(14, scheme.onPrimary, weight: FontWeight.w700).copyWith(letterSpacing: 2)),
                    const Spacer(),
                    Text(date.toUpperCase(),
                        style: displayStyle(14, scheme.onPrimary, weight: FontWeight.w700).copyWith(letterSpacing: 1.5)),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(34, 12, 34, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label.toUpperCase(), style: labelStyle(context)),
                    const SizedBox(height: 4),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          Text(value, style: displayStyle(100, scheme.onSurface)),
                          const SizedBox(width: 6),
                          Text(unit, style: displayStyle(26, scheme.onSurfaceVariant, weight: FontWeight.w700)),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    status,
                  ],
                ),
              ),
            ],
          ),
          Positioned(top: 42, left: 12, child: pin()),
          Positioned(top: 42, right: 12, child: pin()),
          Positioned(bottom: 12, left: 12, child: pin()),
          Positioned(bottom: 12, right: 12, child: pin()),
        ],
      ),
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});

  final String text;
  final String? trailing;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 14, 4, 8),
        child: Row(
          children: [
            Text(text.toUpperCase(), style: labelStyle(context).copyWith(fontSize: 13.5, letterSpacing: 1.3)),
            if (trailing != null) ...[
              const Spacer(),
              Text(trailing!, style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.onSurfaceVariant)),
            ],
          ],
        ),
      );
}
