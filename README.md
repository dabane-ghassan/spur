<p align="center">
  <img src="fastlane/metadata/android/en-US/images/featureGraphic.png" alt="spur – a private running diary" width="720">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: GPL v3 or later" src="https://img.shields.io/badge/license-GPL--3.0--or--later-c4492f"></a>
  <a href="https://github.com/dabane-ghassan/spur/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/dabane-ghassan/spur?sort=semver&color=c4492f&label=release"></a>
  <a href="https://github.com/dabane-ghassan/spur/actions/workflows/android.yml"><img alt="Android build" src="https://github.com/dabane-ghassan/spur/actions/workflows/android.yml/badge.svg"></a>
  <a href="https://buymeacoffee.com/ghassandabane"><img alt="Buy me a coffee" src="https://img.shields.io/badge/buy_me_a-coffee-ffdd00?logo=buymeacoffee&logoColor=black"></a>
</p>

# A simple running diary that respects your privacy.

Log the distance and time after each run. spur smooths out the good days and the bad days and shows whether you are really getting faster.

*spur* is German for *track*: a diary of the tracks you leave.

## Installation

<p>
  <a href="https://github.com/dabane-ghassan/spur/releases/latest"><img alt="Download the APK" src="https://img.shields.io/badge/Download-APK-c4492f?style=for-the-badge&logo=android&logoColor=white"></a>
  <img alt="F-Droid: coming soon" src="https://img.shields.io/badge/F--Droid-coming_soon-lightgrey?style=for-the-badge&logo=fdroid&logoColor=white">
  <a href="selfhost/README.md"><img alt="Self-host with Docker" src="https://img.shields.io/badge/Self--host-Docker-2c77b8?style=for-the-badge&logo=docker&logoColor=white"></a>
</p>

Android 7.0 or newer. Prefer the browser? Run the [self-hosted web app](selfhost/README.md) on your own server. More on the [website](https://dabane-ghassan.github.io/spur/).

## Why spur?

- **Truly free**: no ads, no account, no trackers
- **Pace and volume trends** with smoothing you choose: off, soft, medium or strong
- **Pace goal** with a forecast date, and a warning when your weekly distance jumps too fast
- **Race predictions** from 5K to the marathon, and milestones along the way
- **Your data, your files**: export and import plain CSV files, shared with the web app
- **Privacy**: no permissions, no internet access; your runs never leave your phone
- **Copylefted libre software** under the GNU GPL v3 or later

## Screenshots

<p align="center">
  <img src="fastlane/metadata/android/en-US/images/phoneScreenshots/1.png" width="19%" alt="Overview with the trend pace on a race bib">
  <img src="fastlane/metadata/android/en-US/images/phoneScreenshots/2.png" width="19%" alt="Pace and volume trend charts">
  <img src="fastlane/metadata/android/en-US/images/phoneScreenshots/3.png" width="19%" alt="Logging a run by pace">
  <img src="fastlane/metadata/android/en-US/images/phoneScreenshots/4.png" width="19%" alt="Stats and race predictions">
  <img src="fastlane/metadata/android/en-US/images/phoneScreenshots/5.png" width="19%" alt="All runs, month by month">
</p>

## Self-hosting

```sh
git clone https://github.com/dabane-ghassan/spur
cd spur/selfhost
docker compose up -d        # then open http://your-server:4219
```

Accounts, HTTPS with Caddy, backups and the full API are described in [selfhost/README.md](selfhost/README.md).

## Building

The APK is built by [GitHub Actions](.github/workflows/android.yml) on every push. To build it yourself, or to sign and release it, see [BUILDING.md](BUILDING.md).

## FAQ

**Will spur stay free?** Yes, with every feature, always.

**Does it track my runs with GPS?** No, on purpose. You type in the distance and time from your watch or a map, so there is no location data to leak.

**Could you add feature X?** Open an [issue](https://github.com/dabane-ghassan/spur/issues) or a pull request.

## Support

If spur helps your running, you can [buy me a coffee](https://buymeacoffee.com/ghassandabane) ☕

## License

spur is licensed under the [GNU GPL v3 or later](LICENSE). The Barlow fonts are under the SIL Open Font License 1.1.
