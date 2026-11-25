<p align="center">
  <img src="./static/images/logo.svg" alt="Dyslinks" width="80" height="80" />
</p>

<h1 align="center">Dyslinks</h1>

<p align="center">
  A clean, self-hosted URL shortener with light &amp; dark themes, custom &amp; shared domains, visit analytics, OIDC SSO, and production security hardening.
</p>

<p align="center">
  <a href="https://github.com/theALTERRA/dyslinks/actions/workflows/docker-publish.yaml">
    <img src="https://github.com/theALTERRA/dyslinks/actions/workflows/docker-publish.yaml/badge.svg" alt="Docker Build &amp; Publish" />
  </a>
  <a href="https://github.com/theALTERRA/dyslinks/releases/latest">
    <img src="https://img.shields.io/github/v/release/theALTERRA/dyslinks" alt="Latest Release" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/github/license/theALTERRA/dyslinks.svg" alt="MIT License" />
  </a>
</p>

---

## Features

- **Modern UI & Dark Mode** — Neutral light/dark themes, self-hosted Inter typography, zero-FOUC theme loading, and live-themed analytics charts.
- **Link Management & Analytics** — Custom slugs, password-protected links, link expiration, descriptions, QR codes, and private visit stats (views, referrers, browsers, OS, country map).
- **Custom & Shared Domains** — Personal custom domains, admin-shared domains, per-user default domain selection, and an optional lock (`DISALLOW_CUSTOM_DOMAINS`) restricting custom domains to admins.
- **Auth & API** — Multi-user admin panel, OpenID Connect (OIDC) SSO with PKCE, and REST API keys (`/api/v2`).
- **Production Hardened** — Strict URL scheme allowlist & private-IP/DNS blocking, strict `script-src 'self'` CSP, CSRF Origin checks, `POST` logout, rate limiting, SHA-256 hashed header-only API keys, JWT revocation (`token_version`), SQLite WAL mode, graceful shutdown, and non-root Docker images.
- **Flexible Storage** — Runs out of the box with SQLite, or scales with PostgreSQL / MariaDB and Redis (caching, rate limiting, and BullMQ visit queue).

---

## Quick Start (Docker Compose)

Multi-arch images (`linux/amd64`, `linux/arm64`) are published to `ghcr.io/thealterra/dyslinks:latest` (and semver tags such as `:1.4.3`).

### 1. Download `docker-compose.yml` & create `.env`

```bash
curl -O https://raw.githubusercontent.com/theALTERRA/dyslinks/main/docker-compose.yml
cat <<EOF > .env
SITE_NAME=Dyslinks
DEFAULT_DOMAIN=links.yourdomain.com
JWT_SECRET=$(openssl rand -hex 32)
EOF
```

> Copy [`.example.env`](./.example.env) to `.env` for all options. Redis stacks require `REDIS_PASSWORD=...`, and PostgreSQL/MariaDB stacks also require `DB_PASSWORD=...` (MariaDB optionally supports a separate `DB_ROOT_PASSWORD`).

### 2. Start Dyslinks

```bash
docker compose up -d
```

Available stacks:

| Stack | Command |
| --- | --- |
| **SQLite** *(default, simplest)* | `docker compose up -d` |
| **SQLite + Redis** | `docker compose -f docker-compose.sqlite-redis.yml up -d` |
| **PostgreSQL + Redis** *(recommended)* | `docker compose -f docker-compose.postgres.yml up -d` |
| **MariaDB + Redis** | `docker compose -f docker-compose.mariadb.yml up -d` |

Database migrations run automatically on startup. Set `HOST_PORT=8080` in `.env` if port `3000` is in use.

### 3. Put behind HTTPS & create admin

Production auth cookies require HTTPS. Proxy `127.0.0.1:3000` with Caddy, Nginx, Traefik, or Cloudflare Tunnel:

```caddy
links.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
```

<details>
<summary>Nginx example</summary>

```nginx
server {
    listen 443 ssl http2;
    server_name links.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

</details>

Open `https://links.yourdomain.com` and you will be guided to `/create-admin` to create the first admin account.

### Updating

Back up your database volume, then pull and restart (migrations run automatically):

```bash
docker compose pull && docker compose up -d
```

---

## Configuration

Configured via environment variables or `.env`. Any variable also supports Docker secrets via `<VAR>_FILE=/path/to/secret`. See [`.example.env`](./.example.env) for the full template.

### Core & Security

| Variable | Description | Default |
| --- | --- | --- |
| `JWT_SECRET` | **Required in production.** Strong random string (min 32 chars). | — |
| `DEFAULT_DOMAIN` | Public domain where Dyslinks is hosted (no protocol) | `localhost:3000` |
| `SITE_NAME` | Site name shown in the UI and emails | `Dyslinks` |
| `PORT` | HTTP port the server listens on | `3000` |
| `TRUST_PROXY` | Reverse proxy trust: `true` (loopback/private networks), `false`, hop count, or IPs/CIDRs | `true` |
| `ENABLE_RATE_LIMIT` | Enable rate limiting on auth, API, and protected-link routes | `true` |
| `DISALLOW_ANONYMOUS_LINKS` | Require login to shorten links | `true` |
| `DISALLOW_REGISTRATION` | Disable public signups | `true` |
| `DISALLOW_LOGIN_FORM` | Hide email/password login (use with `OIDC_ENABLED=true`) | `false` |
| `DISALLOW_CUSTOM_DOMAINS` | Restrict adding/using personal custom domains to admins | `false` |
| `ADMIN_BOOTSTRAP_SECRET` | Optional secret required on `/create-admin` to claim the initial admin account | `""` |
| `TRUST_CF_HEADERS` | Trust Cloudflare `CF-IPCountry` header for visit analytics | `false` |

<details>
<summary><strong>Database &amp; Redis</strong></summary>

| Variable | Description | Default |
| --- | --- | --- |
| `DB_CLIENT` | `better-sqlite3`, `pg`, or `mysql2` | `better-sqlite3` |
| `DB_FILENAME` | SQLite database file path | `db/data` |
| `DB_HOST` / `DB_PORT` | PostgreSQL / MySQL host and port | `localhost` / `5432` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Database name and credentials | `dyslinks` / `postgres` / `""` |
| `DB_SSL` | Enable SSL for database connections | `false` |
| `DB_POOL_MIN` / `DB_POOL_MAX` | Connection pool bounds | `0` / `10` |
| `REDIS_ENABLED` | Enable Redis caching, rate-limit store, and BullMQ visit queue | `false` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | Redis server address and DB index (`0`–`15`) | `127.0.0.1` / `6379` / `0` |
| `REDIS_PASSWORD` | Redis password (optional) | `""` |

</details>

<details>
<summary><strong>OIDC / SSO</strong></summary>

Register this Redirect URI with your identity provider:

```text
https://<DEFAULT_DOMAIN>/login/oidc
```

| Variable | Description | Default |
| --- | --- | --- |
| `OIDC_ENABLED` | Enable OpenID Connect login | `false` |
| `OIDC_ISSUER` | Issuer discovery URL (e.g., `https://auth.example.com`) | `""` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | OAuth client credentials | `""` |
| `OIDC_SCOPE` | Requested scopes | `openid profile email` |
| `OIDC_EMAIL_CLAIM` | Claim used to match/create user email | `email` |
| `OIDC_PROMPT` | Optional OIDC `prompt` parameter (e.g., `login`, `select_account`) | `""` |
| `OIDC_BUTTON_TEXT` | Login button label | `Log in with OIDC` |
| `OIDC_ALLOW_REGISTRATION` | Auto-provision new OIDC users even when `DISALLOW_REGISTRATION=true` | `false` |
| `OIDC_ALLOW_UNVERIFIED_EMAIL` | Allow OIDC login when the IdP does not emit `email_verified: true` (not recommended) | `false` |

</details>

<details>
<summary><strong>Email (SMTP) &amp; Abuse Reports</strong></summary>

| Variable | Description | Default |
| --- | --- | --- |
| `MAIL_ENABLED` | Enable email verification, password resets, and abuse reports | `false` |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_SECURE` | SMTP server, port, and TLS (`true` for port `465`) | `""` / `587` / `false` |
| `MAIL_USER` / `MAIL_PASSWORD` | SMTP credentials | `""` |
| `MAIL_FROM` | Sender address (falls back to `MAIL_USER`) | `""` |
| `REPORT_EMAIL` | Recipient address for submitted abuse reports | `""` |
| `CONTACT_EMAIL` | Support email shown in the footer | `""` |

</details>

<details>
<summary><strong>Links &amp; Custom Domains</strong></summary>

| Variable | Description | Default |
| --- | --- | --- |
| `LINK_LENGTH` | Length of randomly generated short slugs | `6` |
| `LINK_CUSTOM_ALPHABET` | Characters used for generated slugs | `abcdefghk...23456789` |
| `ALLOWED_CUSTOM_PROTOCOLS` | Comma-separated allowlist of non-HTTP(S) redirect schemes | `mailto:,tel:` |
| `CUSTOM_DOMAIN_USE_HTTPS` | Generate `https://` short links for custom domains | `false` |
| `SERVER_IP_ADDRESS` / `SERVER_CNAME_ADDRESS` | DNS instructions displayed on the Settings page (display only) | `""` |

</details>

---

## REST API & Health Check

Generate an API key under **Settings → API** (shown once at creation and stored SHA-256 hashed) and pass it in the `X-API-KEY` header (query-string keys are not accepted):

```bash
curl -X POST https://links.yourdomain.com/api/v2/links \
  -H "X-API-KEY: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"target": "https://example.com", "customurl": "hello"}'
```

Generate the full static OpenAPI reference (`docs/api/static/index.html`) with `npm run docs:build`.

**Health check:** `GET /api/health` verifies database connectivity and returns `200 OK` (or `503` if the database is unreachable). Append `?strict=true` to also return `503` when `REDIS_ENABLED=true` and Redis is unreachable.

---

## Customization

Override assets, styles, or templates by placing files in the mounted `/dyslinks/custom` volume:

```text
custom/
├── css/       # Extra .css files loaded automatically (styles.css overrides defaults)
├── images/    # Custom logo.svg (used as browser favicon & app icon)
└── views/     # Custom .hbs pages or partials/ matching server/views/
```

> The in-page header/login brand mark is an inline SVG in `partials/header.hbs` and `partials/auth/brand.hbs`; override those partials under `custom/views/partials/` to replace it.

---

## Local Development

Requires **Node.js 22.12+** (Node 26 LTS recommended).

```bash
npm ci --ignore-scripts
cp .example.env .env
npm run migrate
npm run dev       # development with auto-reload (or: npm start for production)
npm test          # run test suite
```

---

## License

MIT License — see [LICENSE](./LICENSE). Originally forked from [Kutt](https://github.com/thedevs-network/kutt).
