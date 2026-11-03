// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../core/analysis.dart';
import '../core/units.dart';
import '../data/run_store.dart';
import '../ui/spur_logo.dart';
import '../ui/store_scope.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = StoreScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final muted = TextStyle(color: scheme.onSurfaceVariant, fontSize: 13.5, height: 1.4);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      children: [
        const SectionTitle('Display'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _Labeled(
                  'Distance unit',
                  SegmentedButton<DistanceUnit>(
                    segments: const [
                      ButtonSegment(value: DistanceUnit.km, label: Text('Kilometres')),
                      ButtonSegment(value: DistanceUnit.mi, label: Text('Miles')),
                    ],
                    selected: {store.unit},
                    showSelectedIcon: false,
                    onSelectionChanged: (s) => store.unit = s.first,
                  ),
                ),
                _Labeled(
                  'Chart shows',
                  SegmentedButton<ChartMetric>(
                    segments: const [
                      ButtonSegment(value: ChartMetric.pace, label: Text('Pace')),
                      ButtonSegment(value: ChartMetric.speed, label: Text('Speed')),
                    ],
                    selected: {store.metric},
                    showSelectedIcon: false,
                    onSelectionChanged: (s) => store.metric = s.first,
                  ),
                ),
                _Labeled(
                  'Smoothing',
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SegmentedButton<Smoothing>(
                        segments: [for (final v in Smoothing.values) ButtonSegment(value: v, label: Text(v.label))],
                        selected: {store.smoothing},
                        showSelectedIcon: false,
                        onSelectionChanged: (v) => store.smoothing = v.first,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'How much the pace and volume trends even out day-to-day ups and downs. '
                        'Off shows your runs and weekly totals as they are.',
                        style: muted.copyWith(fontSize: 12.5),
                      ),
                    ],
                  ),
                ),
                _Labeled(
                  'Appearance',
                  SegmentedButton<ThemeMode>(
                    segments: const [
                      ButtonSegment(value: ThemeMode.system, label: Text('System')),
                      ButtonSegment(value: ThemeMode.light, label: Text('Light')),
                      ButtonSegment(value: ThemeMode.dark, label: Text('Dark')),
                    ],
                    selected: {store.themeMode},
                    showSelectedIcon: false,
                    onSelectionChanged: (s) => store.themeMode = s.first,
                  ),
                ),
                _Labeled(
                  'Theme',
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final p in palettes)
                        _Swatch(
                          palette: p,
                          selected: store.palette == p.id,
                          onTap: () => store.palette = p.id,
                        ),
                    ],
                  ),
                  last: true,
                ),
              ],
            ),
          ),
        ),
        const SectionTitle('Your data'),
        Card(
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
                child: Text(
                  'Runs are stored only on this phone. Nothing is uploaded or tracked. '
                  'Copy a CSV now and then as a backup.',
                  style: muted,
                ),
              ),
              ListTile(
                leading: const Icon(Icons.copy_outlined),
                title: const Text('Copy runs as CSV'),
                onTap: () async {
                  final messenger = ScaffoldMessenger.of(context);
                  await Clipboard.setData(ClipboardData(text: store.exportCsv()));
                  messenger.showSnackBar(SnackBar(content: Text('Copied ${store.runs.length} runs as CSV')));
                },
              ),
              ListTile(
                leading: const Icon(Icons.content_paste_outlined),
                title: const Text('Import runs from CSV'),
                subtitle: const Text('date, distance in km, time'),
                onTap: () => showDialog<void>(context: context, builder: (_) => _ImportDialog(store: store)),
              ),
              if (store.hasSamples)
                ListTile(
                  leading: const Icon(Icons.layers_clear_outlined),
                  title: const Text('Clear sample runs'),
                  onTap: store.clearSamples,
                )
              else
                ListTile(
                  leading: const Icon(Icons.auto_awesome_outlined),
                  title: const Text('Load sample runs'),
                  subtitle: const Text('Five months of example data to explore the charts'),
                  onTap: store.loadSamples,
                ),
              ListTile(
                leading: Icon(Icons.delete_outline, color: scheme.error),
                title: Text('Delete all runs', style: TextStyle(color: scheme.error)),
                onTap: () => _confirmDeleteAll(context, store),
              ),
            ],
          ),
        ),
        if (kDonateUrl.isNotEmpty) ...[
          const SectionTitle('Support'),
          Card(
            clipBehavior: Clip.antiAlias,
            child: ListTile(
              leading: const Icon(Icons.local_cafe_outlined),
              title: const Text('Buy me a coffee'),
              subtitle: const Text('spur is free, with no ads and no tracking. A coffee helps keep it going.'),
              trailing: const Icon(Icons.open_in_new, size: 18),
              onTap: () => _open(context, kDonateUrl),
            ),
          ),
        ],
        const SectionTitle('About'),
        Card(
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Row(
                  children: [
                    const SpurLogo(size: 48),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('spur', style: displayStyle(28, scheme.onSurface, italic: true)),
                          Text('Version $kAppVersion · German for “track”', style: muted),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                child: Text(
                  'A private running diary that turns noisy day-to-day paces into a smoothed trend, '
                  'so you can see whether you are getting faster. spur is free software, licensed '
                  'under the GNU GPL version 3 or later.',
                  style: muted,
                ),
              ),
              if (kSourceUrl.isNotEmpty)
                ListTile(
                  leading: const Icon(Icons.code),
                  title: const Text('Source code'),
                  trailing: const Icon(Icons.open_in_new, size: 18),
                  onTap: () => _open(context, kSourceUrl),
                ),
              ListTile(
                leading: const Icon(Icons.description_outlined),
                title: const Text('Licences'),
                onTap: () => showLicensePage(
                  context: context,
                  applicationName: 'spur',
                  applicationVersion: kAppVersion,
                  applicationIcon: const Padding(padding: EdgeInsets.all(12), child: SpurLogo(size: 48)),
                  applicationLegalese: 'Copyright © 2026 Ghassan Dabane\nGNU General Public License v3.0 or later',
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  static Future<void> _open(BuildContext context, String url) async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!ok) messenger.showSnackBar(SnackBar(content: Text('Could not open $url')));
  }

  static Future<void> _confirmDeleteAll(BuildContext context, RunStore store) async {
    final messenger = ScaffoldMessenger.of(context);
    final yes = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete all runs?'),
        content: Text('This removes all ${store.runs.length} runs from this phone. It cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
              foregroundColor: Theme.of(ctx).colorScheme.onError,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete all'),
          ),
        ],
      ),
    );
    if (yes == true) {
      store.deleteAll();
      messenger.showSnackBar(const SnackBar(content: Text('All runs deleted')));
    }
  }
}

class _Labeled extends StatelessWidget {
  const _Labeled(this.label, this.child, {this.last = false});

  final String label;
  final Widget child;
  final bool last;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(bottom: last ? 0 : 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label.toUpperCase(), style: labelStyle(context)),
            const SizedBox(height: 8),
            child,
          ],
        ),
      );
}

class _Swatch extends StatelessWidget {
  const _Swatch({required this.palette, required this.selected, required this.onTap});

  final Palette palette;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      selected: selected,
      label: '${palette.name} theme',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          width: 78,
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: selected ? scheme.onSurface : Colors.transparent, width: 2),
          ),
          child: Column(
            children: [
              CircleAvatar(radius: 14, backgroundColor: palette.seed),
              const SizedBox(height: 5),
              Text(palette.name,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ImportDialog extends StatefulWidget {
  const _ImportDialog({required this.store});

  final RunStore store;

  @override
  State<_ImportDialog> createState() => _ImportDialogState();
}

class _ImportDialogState extends State<_ImportDialog> {
  final _text = TextEditingController();
  String? _message;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _import() {
    if (_text.text.trim().isEmpty) {
      setState(() => _message = 'Paste some lines first.');
      return;
    }
    final r = widget.store.importCsv(_text.text);
    if (r.added > 0 && r.skipped == 0) {
      final messenger = ScaffoldMessenger.of(context);
      Navigator.pop(context);
      messenger.showSnackBar(
        SnackBar(content: Text('Imported ${r.added} ${r.added == 1 ? 'run' : 'runs'}')),
      );
      return;
    }
    setState(() => _message = '${r.added} imported, ${r.skipped} '
        '${r.skipped == 1 ? 'line' : 'lines'} skipped. Use date,km,h:mm:ss, for example 2026-10-28,8.2,42:31.');
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Import runs'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Paste one run per line: date, distance in km, time. Runs you already have are skipped.'),
          const SizedBox(height: 12),
          TextField(
            controller: _text,
            minLines: 4,
            maxLines: 8,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: '2026-10-28,8.2,42:31\n2026-10-30,5.0,26:05',
            ),
          ),
          if (_message != null) ...[
            const SizedBox(height: 10),
            Text(_message!, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          ],
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
        FilledButton(onPressed: _import, child: const Text('Import')),
      ],
    );
  }
}
