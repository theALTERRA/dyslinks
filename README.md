<p align="center">
  <img src="./static/images/logo.svg" alt="Dyslinks" width="80" height="80" />
</p>

<h1 align="center">Dyslinks</h1>

<p align="center">
  A clean, self-hosted URL shortener with refined light &amp; dark themes, self-hosted Inter typography, custom domains, analytics, and production security hardening.
</p>

<p align="center">
  <a href="https://github.com/theALTERRA/dyslinks/actions/workflows/docker-publish.yaml">
    <img src="https://github.com/theALTERRA/dyslinks/actions/workflows/docker-publish.yaml/badge.svg" alt="Docker Build & Publish" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/github/license/theALTERRA/dyslinks.svg" alt="MIT License" />
  </a>
</p>

---

## Features

- **Modern UI & Dark Mode** — Crisp neutral light/dark themes with self-hosted Inter typography, sticky frosted topbar, automatic system preference detection, header toggle, zero-FOUC loading, and live-themed analytics charts.
- **Link Management** — Custom slugs, password-protected links, link expiration, descriptions, QR codes, and private visit analytics (views, referrers, browsers, OS, country map).
- **Custom Domains & Multi-User Admin** — Bind custom domains, manage users/links/domains in the admin panel, or authenticate via OIDC and REST API keys.
- **Security Hardened** — Strict URL validation (blocks `javascript:`/`data:` XSS and private/metadata IPs), Helmet CSP headers, CSRF Origin verification, default rate limiting, strong production `JWT_SECRET` enforcement, and non-root Docker images.
- **Flexible Storage** — Works out of the box with SQLite, or scale with PostgreSQL / MariaDB and Redis.

---

## Quick Start (Docker Compose)

Pre-built multi-arch images (`linux/amd64`, `linux/arm64`) are published to GitHub Container Registry at `ghcr.io/thealterra/dyslinks:latest`.

### 1. Download `docker-compose.yml` & create `.env`

```bash
curl -O https://raw.githubusercontent.com/theALTERRA/dyslinks/main/docker-compose.yml
cat <<EOF > .env
SITE_NAME=Dyslinks
DEFAULT_DOMAIN=links.yourdomain.com
JWT_SECRET=$(openssl rand -hex 32)
EOF
```

> Want to customize mail, OIDC, or other options? Copy [`.example.env`](./.example.env) to `.env`. For PostgreSQL or MariaDB, also add `DB_PASSWORD=...` to `.env`.

### 2. Start Dyslinks

```bash
docker compose up -d
```

Other stacks (clone the repo or download the matching compose file):

| Stack | Command |
| --- | --- |
| **SQLite** *(default, simplest)* | `docker compose up -d` |
| **SQLite + Redis** | `docker compose -f docker-compose.sqlite-redis.yml up -d` |
| **PostgreSQL + Redis** *(recommended)* | `docker compose -f docker-compose.postgres.yml up -d` |
| **MariaDB + Redis** | `docker compose -f docker-compose.mariadb.yml up -d` |

Database migrations run automatically on startup. Set `HOST_PORT=8080` in `.env` if port `3000` is already in use.

### 3. Serve over HTTPS & create admin

Put `localhost:3000` behind a reverse proxy with HTTPS (Caddy, Nginx, Traefik, or Cloudflare Tunnel)—production auth cookies require HTTPS. Example `Caddyfile`:

```caddy
links.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
```

Open `https://links.yourdomain.com` in your browser and you'll be guided to `/create-admin` to create your admin account.

### Updating

```bash
docker compose pull && docker compose up -d
```

---

## Running Locally (Node.js)

Requires Node.js 22+ (Node 26 LTS recommended).

```bash
npm install
cp .example.env .env
npm run migrate
npm run dev       # development (or: npm start for production)
```

---

## Configuration

All settings are configured via environment variables (or `.env`). Any variable also supports Docker secrets via `<VAR>_FILE=/path/to/secret`. See [`.example.env`](./.example.env) for the full list.

| Variable | Description | Default |
| --- | --- | --- |
| `JWT_SECRET` | **Required in production.** Random string (min 32 chars) used to sign tokens. | — |
| `PORT` | Port the server listens on | `3000` |
| `SITE_NAME` | Site name displayed in the UI and emails | `Dyslinks` |
| `DEFAULT_DOMAIN` | Public domain where the app is hosted | `localhost:3000` |
| `TRUST_PROXY` | Read client IPs from `X-Forwarded-For`: `true` trusts proxies on loopback/private networks only, `false` disables, or set a hop count / comma-separated proxy IPs | `true` |
| `ENABLE_RATE_LIMIT` | Enable API and auth rate limiting | `true` |
| `DISALLOW_ANONYMOUS_LINKS` | Require login to shorten links | `true` |
| `DISALLOW_REGISTRATION` | Disable public signups (uses email verification when `MAIL_ENABLED=true`) | `true` |
| `DISALLOW_LOGIN_FORM` | Hide email/password login (use with `OIDC_ENABLED=true`) | `false` |
| `DISALLOW_CUSTOM_DOMAINS` | Disable adding/using personal custom domains for non-admin users | `false` |
| `LINK_LENGTH` | Length of randomly generated short slugs | `6` |
| `DB_CLIENT` | `better-sqlite3`, `pg`, or `mysql2` | `better-sqlite3` |
| `DB_FILENAME` | SQLite database file path | `db/data` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` / `DB_SSL` | PostgreSQL / MySQL connection settings | `localhost` / `5432` / `dyslinks` / `postgres` |
| `REDIS_ENABLED` / `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB` | Redis cache & rate-limit store | `false` / `127.0.0.1` / `6379` |
| `MAIL_ENABLED` / `MAIL_HOST` / `MAIL_PORT` / `MAIL_SECURE` / `MAIL_USER` / `MAIL_PASSWORD` / `MAIL_FROM` | SMTP settings for verification, password resets, and abuse reports | `false` |
| `OIDC_ENABLED` / `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_SCOPE` / `OIDC_EMAIL_CLAIM` / `OIDC_BUTTON_TEXT` | OpenID Connect SSO login | `false` |
| `SERVER_IP_ADDRESS` / `SERVER_CNAME_ADDRESS` / `CUSTOM_DOMAIN_USE_HTTPS` | Custom domain instructions & HTTPS toggle | `""` / `""` / `false` |
| `REPORT_EMAIL` / `CONTACT_EMAIL` | Abuse report recipient and support email shown in footer | `""` |

---

## Customization

Override CSS, images, or Handlebars views by placing files inside the mounted `/custom` volume:

```text
custom/
├── css/       # Extra .css files (or styles.css to override default styles)
├── images/    # Custom logo.svg, favicons, etc.
└── views/     # Custom .hbs templates matching server/views/
```

---

## License

MIT License — see [LICENSE](./LICENSE). Originally forked from [Kutt](https://github.com/thedevs-network/kutt).
