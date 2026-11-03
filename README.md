# spur

**A private running diary.** Log each run with its distance and time, pace or speed. spur smooths out the day-to-day noise and shows whether you are actually getting faster.

*spur* is German for *track*: a diary of the tracks you leave.

- **Pace trend** – every run is a dot; a smoothed line shows your real form over 1 month to all time.
- **Volume trend** – weekly distance or running time, with its own smoothed trend and change on 4 weeks ago.
- **Adjustable smoothing** – off, soft, medium or strong, for both trends.
- **Pace goal** – set a target pace and spur estimates when your trend will reach it.
- **Weekly distance** – with a gentle warning when a week jumps more than 10 % above your recent average, a common cause of running injuries.
- **Race predictions** – 5K, 10K, half and full marathon estimates from your best recent effort (Riegel's formula).
- **Milestones** – first 10K, 100 km total, 12-week streaks and more.
- **Kilometres or miles**, pace or speed, light and dark mode, four themes.
- **CSV export and import** through the clipboard.

## Privacy

spur requests **no permissions** and has **no internet access**. No account, no ads, no analytics, no trackers. Your runs are stored only on your phone.

## Building

You need [Flutter](https://docs.flutter.dev/get-started/install) (3.32 or newer) and the Android SDK.

```sh
tool/setup.sh io.github.yourname   # one time: generates Gradle files, tests, builds the APK
```

After that, the usual commands work:

```sh
flutter run                 # run on a connected phone or emulator
flutter test                # unit and widget tests
flutter build apk --release
```

Commit the generated `android/` files after the first setup, so F-Droid can build from the repository.

### Before the first release

1. In `lib/config.dart`, fill in `kDonateUrl` (your Buy Me a Coffee page) and `kSourceUrl`. Empty values hide those buttons.
2. Pick the app ID for good when you run `tool/setup.sh` (for example `io.github.yourname`, giving `io.github.yourname.spur`). It cannot change once published.
3. Tag the release in git as `v1.0.0`, matching `version: 1.0.0+1` in `pubspec.yaml`.

### Signing your own builds

F-Droid builds and signs the app itself, so you don't need a key for F-Droid. For APKs you publish yourself (or for Accrescent), create a release key once and keep it safe and private:

```sh
keytool -genkey -v -keystore ~/spur-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias spur
```

Then follow Flutter's guide to reference it from `android/key.properties`: <https://docs.flutter.dev/deployment/android#sign-the-app>. `key.properties` and keystores are git-ignored.

## Self-hosted web app

Prefer the browser, or want your runs on your own server? `selfhost/` holds the full spur web app, ready for Docker Compose, with accounts, HTTPS via Caddy, and install-to-home-screen on phones. See [selfhost/README.md](selfhost/README.md).

## Product page

`site/` is a static product page (no build step, no external requests). Publish it with Codeberg Pages or GitHub Pages, and fill in the coffee and source links at the bottom of `site/index.html`.

## Distribution

- **F-Droid** – see `fdroid/` for a draft build recipe to submit to the `fdroiddata` repository. Store texts and graphics live in `fastlane/metadata/android/`, where F-Droid picks them up automatically.
- **Accrescent** – currently accepts new apps by invitation only.

## Support

spur is free and always will be. If it helps your running, you can buy me a coffee (link in the app's Settings).

## Licence

Copyright © 2026 Ghassan Dabane

spur is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE).

The Barlow and Barlow Condensed fonts are © 2017 The Barlow Project Authors, licensed under the SIL Open Font License 1.1 (`assets/fonts/OFL.txt`).
