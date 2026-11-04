#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Analyses, tests and builds a release APK. All Android build files are in the
# repository; use Flutter 3.47.9, the version CI and F-Droid build with.
#
#   tool/setup.sh
set -euo pipefail

cd "$(dirname "$0")/.."

command -v flutter >/dev/null || { echo "Flutter is not installed: https://docs.flutter.dev/get-started/install"; exit 1; }

flutter pub get
flutter analyze --no-fatal-infos
flutter test
flutter build apk --release

echo
echo "Done. APK: build/app/outputs/flutter-apk/app-release.apk"
echo "Install on a phone with USB debugging: flutter install --release"
