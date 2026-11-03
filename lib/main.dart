// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane
//
// spur is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software
// Foundation, either version 3 of the License, or (at your option) any later
// version. spur is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
// or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
// more details. You should have received a copy of the GNU General Public
// License along with spur. If not, see <https://www.gnu.org/licenses/>.

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'data/run_store.dart';
import 'screens/overview_screen.dart';
import 'screens/run_editor.dart';
import 'screens/runs_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/stats_screen.dart';
import 'ui/spur_logo.dart';
import 'ui/store_scope.dart';
import 'ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  LicenseRegistry.addLicense(() async* {
    final ofl = await rootBundle.loadString('assets/fonts/OFL.txt');
    yield LicenseEntryWithLineBreaks(const ['Barlow', 'Barlow Condensed'], ofl);
  });
  final store = await RunStore.load();
  runApp(SpurApp(store: store));
}

class SpurApp extends StatelessWidget {
  const SpurApp({super.key, required this.store});

  final RunStore store;

  @override
  Widget build(BuildContext context) {
    return StoreScope(
      store: store,
      child: ListenableBuilder(
        listenable: store,
        builder: (context, _) => MaterialApp(
          title: 'spur',
          debugShowCheckedModeBanner: false,
          theme: buildTheme(store.palette, Brightness.light),
          darkTheme: buildTheme(store.palette, Brightness.dark),
          themeMode: store.themeMode,
          home: const HomeShell(),
        ),
      ),
    );
  }
}

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;

  static const _titles = ['running diary', 'stats', 'runs', 'settings'];

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final pages = [
      OverviewScreen(onLogRun: () => showRunEditor(context)),
      const StatsScreen(),
      const RunsScreen(),
      const SettingsScreen(),
    ];
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: Row(
          children: [
            const SpurLogo(size: 30),
            const SizedBox(width: 10),
            Text('spur', style: displayStyle(30, scheme.onSurface, italic: true)),
            const Spacer(),
            Text(
              _titles[_tab].toUpperCase(),
              style: TextStyle(fontSize: 12, letterSpacing: 1.2, color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
      body: IndexedStack(index: _tab, children: pages),
      floatingActionButton: _tab == 3
          ? null
          : FloatingActionButton.extended(
              onPressed: () => showRunEditor(context),
              icon: const Icon(Icons.add),
              label: const Text('Log run'),
            ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.show_chart), label: 'Overview'),
          NavigationDestination(
            icon: Icon(Icons.emoji_events_outlined),
            selectedIcon: Icon(Icons.emoji_events),
            label: 'Stats',
          ),
          NavigationDestination(icon: Icon(Icons.format_list_bulleted), label: 'Runs'),
          NavigationDestination(icon: Icon(Icons.tune), label: 'Settings'),
        ],
      ),
    );
  }
}
