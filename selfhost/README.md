# spur, self-hosted

The full spur running diary as a web app you run on your own server, NAS or Raspberry Pi. Open it in any browser, or install it on your phone's home screen like an app.

- **No third-party packages.** The server uses only what ships with Node.js (HTTP, crypto and its built-in SQLite). Nothing to `npm install`, nothing to keep patched beyond the Node image.
- **Private by design.** Runs live in one SQLite file on your server. No analytics, no external requests, no CDN: fonts and icons are served locally.
- **Accounts.** The first visitor creates the first account. Optionally let family or friends create their own; each account only ever sees its own runs.
- **Same CSV format as the Android app**, so you can move runs between them.

## Quick start

You need Docker with the Compose plugin.

```sh
cd selfhost
cp .env.example .env          # optional, every setting has a default
docker compose up -d
```

Open `http://<your-server>:4219` and create your account. That's it.

Update later with:

```sh
git pull
docker compose up -d --build
```

## HTTPS and installing on your phone

Phones only offer **Install app / Add to home screen** for sites served over HTTPS. The easiest way is the included Caddy setup, which gets a free certificate automatically:

1. Point a domain or subdomain (for example `run.example.org`) at your server, and open ports 80 and 443.
2. Set `SPUR_DOMAIN=run.example.org` in `.env`.
3. Start both containers:
   ```sh
   docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
   ```

Already run a reverse proxy (Nginx Proxy Manager, Traefik, Nginx)? Point it at port 4219 and set `SPUR_TRUST_PROXY=true`.

## Settings

All optional, in `.env`:

| Setting | Default | What it does |
|---|---|---|
| `SPUR_PORT` | `4219` | Port on the host |
| `SPUR_ALLOW_SIGNUP` | `false` | Let people other than the first user create accounts |
| `SPUR_TRUST_PROXY` | `false` | Trust `X-Forwarded-*` headers. Only behind a reverse proxy |
| `SPUR_COOKIE_SECURE` | `auto` | Secure cookies: `auto`, `true` or `false` |
| `SPUR_SESSION_DAYS` | `90` | How long a sign-in lasts |
| `TZ` | `UTC` | Server time zone |
| `SPUR_DOMAIN` | | Your domain, for the Caddy setup |

## Admin commands

```sh
docker compose exec spur node src/cli.js list-users
docker compose exec spur node src/cli.js reset-password <username>   # prints a new password
docker compose exec spur node src/cli.js backup                      # writes /data/spur-backup-<time>.db
```

## Backups

Everything is in the `spur-data` volume. To copy a consistent backup to the host:

```sh
docker compose exec spur node src/cli.js backup /data/spur-backup.db
docker compose cp spur:/data/spur-backup.db ./spur-backup.db
```

To restore, stop spur, copy the file back as `/data/spur.db`, and start it again. Each person can also download their own runs as CSV from Settings.

## Running without Docker

Node.js 22.13 or newer:

```sh
cd selfhost
npm start                 # http://localhost:4219, data in ./data
npm test                  # API tests
```

## Security notes

- Passwords are hashed with scrypt. Sessions are random tokens in HttpOnly, SameSite cookies; only a hash of each token is stored.
- Sign-in and sign-up are rate-limited per address (10 tries per 15 minutes).
- Every change needs a custom request header and a same-site origin, which blocks cross-site request forgery.
- A strict Content Security Policy allows scripts, styles and fonts from your server only.
- The container runs as a non-root user with a read-only filesystem, no Linux capabilities, and writes only to `/data`.

## API

JSON over HTTPS, cookie-authenticated. Changes need the header `X-Spur: 1`.

| Method & path | Purpose |
|---|---|
| `GET /api/status` | Server version, whether setup or sign-up is open, current user |
| `POST /api/signup`, `/api/login`, `/api/logout` | Accounts and sessions |
| `GET /api/me`, `PUT /api/settings` | Current user and display settings |
| `POST /api/password`, `DELETE /api/account` | Change password, delete account |
| `GET /api/runs`, `POST /api/runs` | List and add runs (`{date, km, sec}`) |
| `PUT /api/runs/:id`, `DELETE /api/runs/:id` | Edit or delete a run |
| `DELETE /api/runs` | Delete all of your runs |
| `POST /api/import` (`{csv}`), `GET /api/export.csv` | CSV import and export |
| `POST /api/samples`, `DELETE /api/samples` | Load or clear example runs |
| `GET /healthz` | Health check |

## Licence

GPL-3.0-or-later, like the rest of spur. Fonts: Barlow and Barlow Condensed, SIL Open Font License 1.1.
