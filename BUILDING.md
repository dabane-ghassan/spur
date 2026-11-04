# Building and releasing spur

## Repository layout

| Folder | What it is |
|---|---|
| `lib/`, `test/`, `android/` | The Android app (Flutter / Dart) |
| `selfhost/` | The self-hosted web app (Node.js, SQLite, Docker Compose) |
| `site/` | The product page, published to GitHub Pages |
| `fastlane/` | Store texts, screenshots and changelogs, read by F-Droid |
| `fdroid/` | The F-Droid build recipe, ready to submit |
| `tool/screenshots/` | Renders the store screenshots from the real app screens |

## Build the APK locally

Install [Flutter](https://docs.flutter.dev/get-started/install) **3.47.9** (the version CI and F-Droid
build with) and the Android SDK, then:

```sh
tool/setup.sh            # analyses, tests and builds a release APK
flutter run              # run on a connected phone or emulator
flutter test
```

All Android build files are in the repository, and `pubspec.lock` pins every package, so a
build from source matches the published one. When you move to a newer Flutter, change the
version in `.github/workflows/android.yml` and in the F-Droid recipe together.

### Store screenshots

```sh
flutter test --update-goldens tool/screenshots
cp tool/screenshots/out/*.png fastlane/metadata/android/en-US/images/phoneScreenshots/
```

The app ID is `io.github.dabaneghassan.spur`. It must match the package of
`android/app/src/main/kotlin/io/github/dabaneghassan/spur/MainActivity.kt`.

## Continuous builds

`.github/workflows/android.yml` builds on every push to `main` and publishes the APK to the
[Latest test build](https://github.com/dabane-ghassan/spur/releases/tag/latest-build) pre-release.
If a build fails, the full log is pushed to the `ci-log` branch.

### Signing

Add two repository secrets (Settings → Secrets and variables → Actions) so every build is signed with
the same key and updates install over earlier versions:

```sh
keytool -genkeypair -keystore spur-release.jks -alias spur -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Ghassan Dabane"
base64 -w0 spur-release.jks > spur-release.b64
```

- `SPUR_KEYSTORE_BASE64`: the contents of `spur-release.b64`
- `SPUR_KEYSTORE_PASSWORD`: the keystore password

Keep `spur-release.jks` backed up and private. Never commit it. Without the secrets, builds use a
throwaway key. F-Droid signs its own builds and needs no key.

## Releasing

1. Bump `version:` in `pubspec.yaml` (for example `1.0.1+2`) and `kAppVersion` in `lib/config.dart`.
2. Add `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`.
3. Commit and push to `main`.

When the build finds a version with no release yet, it tags the commit `v1.0.1` and publishes the
release with the changelog and `spur-v1.0.1.apk` attached. Pushing a `v*` tag yourself works too.

## F-Droid

`fdroid/io.github.dabaneghassan.spur.yml` is the build recipe; it passes `fdroid lint`. To submit:

1. Fork [fdroiddata](https://gitlab.com/fdroid/fdroiddata) on GitLab and create a branch named
   `io.github.dabaneghassan.spur`.
2. Copy the recipe to `metadata/io.github.dabaneghassan.spur.yml`.
3. Commit it as `New App: io.github.dabaneghassan.spur` and push. The fork's CI lints and test-builds it.
4. Open a merge request to fdroiddata from that branch.

Texts, icon, screenshots and changelogs come from `fastlane/`. After that, F-Droid picks up each
new version by itself: bump `pubspec.yaml`, push, and the `v*` tag the release workflow creates is
enough. F-Droid signs its own builds, so its APK and the GitHub one can't update each other.

## Product page

`site/` is plain HTML with no build step. `.github/workflows/pages.yml` publishes it to
<https://dabane-ghassan.github.io/spur/> whenever it changes.
