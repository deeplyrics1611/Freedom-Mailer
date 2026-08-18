# Setup & hosting guide

This covers four things, in order:

1. [Run it locally](#1-run-it-locally) (fastest way to try it)
2. [Create Gmail App Passwords](#2-create-gmail-app-passwords-for-a-sender-identity)
3. [Run it with Docker](#3-run-it-with-docker) (recommended for hosting)
4. [Host it on a VPS](#4-host-it-on-a-vps-with-a-real-domain--https) with a real domain + HTTPS

> **Before you host this anywhere public:** review the [Compliance notes](README.md#compliance-notes) and the [sender-rotation scope note](README.md#on-sender-rotation) in the README. This app enforces double opt-in, suppression, and one-click unsubscribe by default — don't disable those to send unsolicited bulk mail; that's how sending domains and IPs get blacklisted (and how ToS violations happen).

---

## 1. Run it locally

Requires Node.js **20+**.

```bash
git clone <your-fork-url> freedom-mailer
cd freedom-mailer
npm install
cp .env.example .env
```

Edit `.env` and set at minimum:

```bash
JWT_SECRET=<a long random string>          # e.g. `openssl rand -hex 32`
BOOTSTRAP_ADMIN_EMAIL=you@example.com
BOOTSTRAP_ADMIN_PASSWORD=<a strong password>
APP_BASE_URL=http://localhost:3000         # used to build confirm/unsubscribe links
```

Start it:

```bash
npm start
```

Open <http://localhost:3000>, sign in with the bootstrap admin credentials, and change the password under **Account**. The database is a single SQLite file at `data/freedom-mailer.sqlite` — back that file up before upgrades.

---

## 2. Create Gmail App Passwords for a sender identity

You can add as many Gmail (or any SMTP) sender identities as you want under **Sender identities** — each is verified and used independently; see the [scope note](README.md#on-sender-rotation) on why sends aren't auto-rotated across them.

For each Gmail account you plan to send from:

1. Go to <https://myaccount.google.com/security> and turn on **2-Step Verification** (App Passwords require it).
2. Go to <https://myaccount.google.com/apppasswords>.
3. Enter a name (e.g. "Freedom Mailer") and click **Create**.
4. Copy the 16-character app password shown (spaces don't matter).
5. In the panel, go to **Sender identities → Use Gmail preset**, fill in:
   - **From email / Username**: the full `you@gmail.com` address
   - **Password**: the app password from step 4
6. Click **Add identity**, then click **Verify** — it must show "verified" before you can select it on a campaign.

Repeat for each additional mailbox you own. Gmail's own per-account sending limits still apply (roughly 500/day for consumer accounts, 2,000/day for Google Workspace) — this app will not exceed a given identity's own account limits or bypass Gmail's abuse detection.

---

## 3. Run it with Docker

A `Dockerfile` and `docker-compose.yml` are included.

```bash
cp .env.example .env   # edit JWT_SECRET, BOOTSTRAP_ADMIN_*, APP_BASE_URL as above
docker compose up -d --build
```

This builds the image, starts the container, and persists the SQLite database in a named Docker volume (`freedom-mailer-data`) so it survives rebuilds/restarts. Check logs with:

```bash
docker compose logs -f
```

Stop it with `docker compose down` (the volume — and your data — is kept; use `docker compose down -v` only if you intentionally want to wipe it).

To update after pulling new code: `docker compose up -d --build`.

### Without docker-compose

```bash
docker build -t freedom-mailer .
docker run -d --name freedom-mailer \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -v freedom-mailer-data:/app/data \
  freedom-mailer
```

---

## 4. Host it on a VPS with a real domain + HTTPS

This is the most reliable path since the app needs outbound SMTP (port 587) and a persistent local SQLite file — both are awkward or blocked on many serverless/PaaS free tiers. Any small VPS works (DigitalOcean, Hetzner, Linode, a plain Ubuntu EC2 instance, etc.) — 1 vCPU / 1GB RAM is plenty to start.

### 4.1 Point DNS at the server

Create an **A record** for your domain/subdomain (e.g. `mailer.yourcompany.com`) pointing at the VPS's public IP. Wait for it to propagate (`dig mailer.yourcompany.com`).

### 4.2 Install Docker on the VPS

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out/in after this
```

### 4.3 Deploy the app

```bash
git clone <your-fork-url> /opt/freedom-mailer
cd /opt/freedom-mailer
cp .env.example .env
nano .env   # set JWT_SECRET, BOOTSTRAP_ADMIN_*, and APP_BASE_URL=https://mailer.yourcompany.com
docker compose up -d --build
```

At this point the app is listening on `127.0.0.1:3000` (or `0.0.0.0:3000` if your firewall isn't configured yet — lock that down, see 4.5).

### 4.4 Put a reverse proxy with automatic HTTPS in front of it

The simplest option is [Caddy](https://caddyserver.com/), which gets you free auto-renewing Let's Encrypt TLS with a 5-line config.

```bash
sudo apt-get update && sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

Edit `/etc/caddy/Caddyfile`:

```
mailer.yourcompany.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl restart caddy
```

Caddy automatically obtains and renews a TLS certificate for your domain. Your app is now live at `https://mailer.yourcompany.com`.

(If you'd rather use Nginx + Certbot, that works too — the config is just a standard `proxy_pass http://127.0.0.1:3000;` reverse proxy block, with `certbot --nginx` to provision the certificate.)

### 4.5 Lock down the firewall

Only expose SSH, HTTP, and HTTPS — never the app's raw port 3000 — to the public internet:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 4.6 Keep it running / update it

Docker's `--restart unless-stopped` (already set in `docker-compose.yml`) brings the container back up after a reboot or crash. To deploy new code:

```bash
cd /opt/freedom-mailer
git pull
docker compose up -d --build
```

### 4.7 Back up the database

The whole app's state lives in one SQLite file inside the `freedom-mailer-data` Docker volume. Back it up regularly:

```bash
docker run --rm -v freedom-mailer-data:/data -v "$PWD":/backup debian:bookworm-slim \
  tar czf /backup/freedom-mailer-backup-$(date +%F).tar.gz -C /data .
```

Copy the resulting `.tar.gz` off the server (S3, another machine, etc.) on a schedule (e.g. a daily cron job).

### 4.8 Running without Docker (systemd instead)

If you'd rather not use Docker, install Node.js 20+ on the VPS directly and run the app as a systemd service:

```ini
# /etc/systemd/system/freedom-mailer.service
[Unit]
Description=Freedom Mailer
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/freedom-mailer
ExecStart=/usr/bin/node src/server.js
EnvironmentFile=/opt/freedom-mailer/.env
Restart=on-failure
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
cd /opt/freedom-mailer && npm ci --omit=dev
sudo systemctl daemon-reload
sudo systemctl enable --now freedom-mailer
```

Then put Caddy/Nginx in front of `localhost:3000` exactly as in step 4.4.

---

## Environment variable reference

See `.env.example` for the full list with comments. The ones you must change before going live:

| Variable | Why it matters |
|---|---|
| `JWT_SECRET` | Signs panel session tokens — a weak/default value lets anyone forge a login. |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | Only used to create the first admin account; change the password immediately after first login. |
| `APP_BASE_URL` | Must be the real public HTTPS URL — it's baked into confirm/unsubscribe links sent in email. |
| `GLOBAL_RATE_PER_MINUTE` | Caps how fast the queue worker sends; keep this conservative to protect sender reputation. |
| `REQUIRE_DOUBLE_OPT_IN` | Keep `true` unless you have another compliant consent mechanism upstream. |

## Post-deploy checklist

- [ ] Changed `JWT_SECRET` from the default.
- [ ] Changed the bootstrap admin password after first login.
- [ ] `APP_BASE_URL` matches your real HTTPS domain.
- [ ] At least one sender identity added and **verified**.
- [ ] SPF, DKIM, DMARC configured on your sending domain (check under **Deliverability check** in the panel).
- [ ] Firewall only exposes 22/80/443; app port (3000) is not publicly reachable.
- [ ] A backup job for the SQLite volume/file is scheduled.
