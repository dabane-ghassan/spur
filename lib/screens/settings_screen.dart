// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../core/analysis.dart';
import '../core/dates.dart';
import '../core/units.dart';
import '../data/csv_files.dart';
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
        const SectionTitle('Profile'),
        Card(
          clipBehavior: Clip.antiAlias,
          child: ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            leading: CircleAvatar(
              backgroundColor: scheme.primaryContainer,
              foregroundColor: scheme.onPrimaryContainer,
              child: store.name.isEmpty
                  ? const Icon(Icons.person_outline)
                  : Text(store.name.characters.first.toUpperCase(),
                      style: displayStyle(20, scheme.onPrimaryContainer)),
            ),
            title: Text(store.name.isEmpty ? 'Add your name' : store.name,
                style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text(store.heightCm == null ? 'Height not set' : fmtHeight(store.heightCm!, store.units)),
            trailing: const Icon(Icons.edit_outlined),
            onTap: () => showDialog<void>(context: context, builder: (_) => _ProfileDialog(store: store)),
          ),
        ),
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
                  'Export a CSV file now and then as a backup. It opens in any spreadsheet and in the spur web app.',
                  style: muted,
                ),
              ),
              ListTile(
                leading: const Icon(Icons.file_download_outlined),
                title: const Text('Export runs to a CSV file'),
                subtitle: Text('${store.runs.length} ${store.runs.length == 1 ? 'run' : 'runs'} · choose where to save it'),
                onTap: () => _export(context, store),
              ),
              ListTile(
                leading: const Icon(Icons.file_upload_outlined),
                title: const Text('Import runs from a CSV file'),
                subtitle: const Text('Columns: date, distance in km, time'),
                onTap: () => _import(context, store),
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

  static Future<void> _export(BuildContext context, RunStore store) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final saved = await CsvFiles.save('spur-runs-${isoDate(todayDay())}.csv', store.exportCsv());
      if (saved) messenger.showSnackBar(SnackBar(content: Text('Exported ${store.runs.length} runs')));
    } on PlatformException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message ?? 'Could not save the file.')));
    }
  }

  static Future<void> _import(BuildContext context, RunStore store) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final text = await CsvFiles.open();
      if (text == null) return;
      final r = store.importCsv(text);
      final parts = [
        '${r.added} ${r.added == 1 ? 'run' : 'runs'} imported',
        if (r.skipped > 0) '${r.skipped} ${r.skipped == 1 ? 'line' : 'lines'} skipped',
      ];
      messenger.showSnackBar(SnackBar(
        content: Text(r.added == 0 && r.skipped > 0
            ? 'No runs found. Use one run per line: date, km, time (2026-10-28,8.2,42:31).'
            : parts.join(', ')),
      ));
    } on PlatformException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message ?? 'Could not read the file.')));
    }
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

class _ProfileDialog extends StatefulWidget {
  const _ProfileDialog({required this.store});

  final RunStore store;

  @override
  State<_ProfileDialog> createState() => _ProfileDialogState();
}

class _ProfileDialogState extends State<_ProfileDialog> {
  final _name = TextEditingController();
  final _cm = TextEditingController();
  final _ft = TextEditingController();
  final _in = TextEditingController();
  String? _error;

  bool get _imperial => widget.store.units.isMiles;

  @override
  void initState() {
    super.initState();
    _name.text = widget.store.name;
    final h = widget.store.heightCm;
    if (h != null) {
      final inches = (h / 2.54).round();
      _cm.text = '${h.round()}';
      _ft.text = '${inches ~/ 12}';
      _in.text = '${inches % 12}';
    }
  }

  @override
  void dispose() {
    for (final c in [_name, _cm, _ft, _in]) {
      c.dispose();
    }
    super.dispose();
  }

  void _save() {
    double? cm;
    if (_imperial) {
      final ft = int.tryParse(_ft.text.trim()), inch = int.tryParse(_in.text.trim());
      if (ft != null || inch != null) cm = ((ft ?? 0) * 12 + (inch ?? 0)) * 2.54;
    } else if (_cm.text.trim().isNotEmpty) {
      cm = double.tryParse(_cm.text.trim().replaceAll(',', '.'));
    }
    if (cm != null && (cm < 100 || cm > 250)) {
      setState(() => _error = _imperial ? 'Enter a height between 3 ft 4 in and 8 ft 2 in.' : 'Enter a height between 100 and 250 cm.');
      return;
    }
    widget.store.setProfile(name: _name.text, heightCm: cm);
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    InputDecoration deco(String label, [String? suffix]) =>
        InputDecoration(labelText: label, suffixText: suffix, border: const OutlineInputBorder());
    final digits = [FilteringTextInputFormatter.digitsOnly];
    return AlertDialog(
      title: const Text('Profile'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Your name goes on the race bib on the overview. Both stay on this phone.'),
            const SizedBox(height: 16),
            TextField(
              controller: _name,
              autofocus: widget.store.name.isEmpty,
              textCapitalization: TextCapitalization.words,
              maxLength: 40,
              decoration: deco('Name'),
            ),
            const SizedBox(height: 8),
            if (_imperial)
              Row(children: [
                Expanded(child: TextField(controller: _ft, keyboardType: TextInputType.number, inputFormatters: digits, decoration: deco('Height', 'ft'))),
                const SizedBox(width: 10),
                Expanded(child: TextField(controller: _in, keyboardType: TextInputType.number, inputFormatters: digits, decoration: deco('', 'in'))),
              ])
            else
              TextField(
                controller: _cm,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
                decoration: deco('Height', 'cm'),
                onSubmitted: (_) => _save(),
              ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(onPressed: _save, child: const Text('Save')),
      ],
    );
  }
}
