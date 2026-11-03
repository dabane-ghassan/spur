#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# One-time setup: generates the remaining Android build files, then analyses,
# tests and builds a release APK.
#
#   tool/setup.sh io.github.yourname
#
# The argument becomes the start of the app ID (io.github.yourname.spur).
# Choose it carefully: once the app is on F-Droid the ID can never change.
set -euo pipefail

ORG="${1:?Usage: tool/setup.sh <org>, for example tool/setup.sh io.github.yourname}"
cd "$(dirname "$0")/.."

command -v flutter >/dev/null || { echo "Flutter is not installed: https://docs.flutter.dev/get-started/install"; exit 1; }

# Fills in only the files that are missing (Gradle files, MainActivity, styles).
# Existing files such as lib/, the manifest and the icons are left alone.
flutter create --org "$ORG" --project-name spur --platforms android .

flutter pub get
flutter analyze --no-fatal-infos
flutter test
flutter build apk --release

echo
echo "Done. APK: build/app/outputs/flutter-apk/app-release.apk"
echo "Install on a phone with USB debugging: flutter install --release"
