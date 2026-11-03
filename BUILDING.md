# Building and releasing spur

## Repository layout

| Folder | What it is |
|---|---|
| `lib/`, `test/`, `android/` | The Android app (Flutter / Dart) |
| `selfhost/` | The self-hosted web app (Node.js, SQLite, Docker Compose) |
| `site/` | The product page, published to GitHub Pages |
| `fastlane/` | Store texts, screenshots and changelogs, read by F-Droid |
| `fdroid/` | Draft F-Droid build recipe |

## Build the APK locally

Install [Flutter](https://docs.flutter.dev/get-started/install) (3.32 or newer) and the Android SDK, then:

```sh
tool/setup.sh            # generates the missing Android files, analyses, tests and builds
flutter run              # run on a connected phone or emulator
flutter test
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
3. Commit, then tag and push: `git tag v1.0.1 && git push origin v1.0.1`.

The workflow creates the release with the changelog and `spur-v1.0.1.apk` attached.

## F-Droid

Submit `fdroid/io.github.dabaneghassan.spur.yml` as `metadata/io.github.dabaneghassan.spur.yml`
in a merge request to [fdroiddata](https://gitlab.com/fdroid/fdroiddata), with the Flutter version
you build with. Texts and screenshots come from `fastlane/`.

## Product page

`site/` is plain HTML with no build step. `.github/workflows/pages.yml` publishes it to
<https://dabane-ghassan.github.io/spur/> whenever it changes.
