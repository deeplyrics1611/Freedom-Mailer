# Freedom Mailer

A **compliant multi-channel messaging platform** — send email (via SMTP and a
transactional API) and SMS, managed through an admin + user panel. Built for
**permission-based** sending: double opt-in lists, one-click unsubscribe,
suppression enforcement, per-user quotas, and sending only from identities you
own.

> This project intentionally does **not** include proxy rotation, SMTP/IP
> rotation, or number-rotation features. Those exist to evade spam filters and
> abuse controls, which is how spam and phishing operations work. Legitimate
> deliverability comes from sender reputation (SPF/DKIM/DMARC, warmed IPs,
> opt-in lists) — which is what this platform is built around.

## Features

- **Admin & user panel** — role-based (admin/user), per-user daily quotas, account management.
- **Sender identities (SMTP)** — add credentials for a mailbox/domain you own; each must pass a live `verify()` before it can send.
- **Transactional API** — `POST /api/v1/email` and `/api/v1/sms`, authenticated with per-user API keys.
- **Lists with double opt-in** — subscribers are `pending` until they click a confirmation link; only `confirmed` recipients receive campaigns.
- **One-click unsubscribe** — every campaign email carries an unsubscribe footer and RFC 8058 `List-Unsubscribe` header; unsubscribes auto-add to suppression.
- **Suppression list** — unsubscribes, complaints and hard bounces are skipped on every send.
- **Templates & campaigns** — `{{name}}`/`{{email}}` merge fields, draft → queue → send.
- **Background queue** — rate-limited worker with retries and delivery logging.
- **SMS channel** — optional, via a Twilio-compatible gateway with consent expected upstream.

## Quick start

```bash
npm install
cp .env.example .env      # then edit secrets & (optionally) SMTP/SMS creds
npm start
```

Open <http://localhost:3000> and sign in with the bootstrap admin from your
`.env` (`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`). Change the
password immediately under **Account**.

Data is stored in a local SQLite file at `data/freedom-mailer.sqlite`.

## Configuration

All settings live in `.env` (see `.env.example`). Key ones:

| Variable | Purpose |
|---|---|
| `APP_BASE_URL` | Public URL used to build confirm/unsubscribe links |
| `JWT_SECRET` | Signing secret for panel sessions — set a long random value |
| `GLOBAL_RATE_PER_MINUTE` | Worker send-rate cap |
| `REQUIRE_DOUBLE_OPT_IN` | When true, campaigns only reach `confirmed` subscribers |
| `SMTP_*` | Optional system/fallback SMTP identity |
| `TWILIO_*` | Optional SMS gateway credentials |

## Sending flow (email)

1. Add and **verify** a sender identity (or configure system SMTP).
2. Create a **list** and add subscribers → they get a **confirm link**.
3. Once confirmed, create a **campaign** targeting that list and hit **Send**.
4. The worker enqueues one message per confirmed, non-suppressed subscriber,
   injects the unsubscribe footer/header, and delivers at the configured rate.

## Transactional API

```bash
curl -X POST http://localhost:3000/api/v1/email \
  -H "X-API-Key: fm_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"to":"user@example.com","subject":"Your receipt","html":"<p>Thanks!</p>"}'
```

Transactional sends bypass list opt-in (they are one-to-one, recipient-initiated
mail like receipts and password resets) but still respect the **suppression
list** and **daily quota**. Delivery status: `GET /api/v1/messages/:id`.

## Compliance notes

This tool is for sending mail people asked to receive. To stay lawful
(CAN-SPAM, GDPR/PECR, CASL) and deliverable:

- Only import contacts you have consent to email; keep proof of opt-in.
- Authenticate your domain with **SPF, DKIM, and DMARC**.
- Honour unsubscribes promptly (this app does so automatically).
- Don't send to purchased/scraped lists.

## Architecture

```
src/
  server.js        Express app, bootstrap admin, route wiring, worker start
  config.js        Env-driven config
  db.js            SQLite schema (better-sqlite3)
  auth.js          Passwords, JWT, API-key auth middleware
  compliance.js    Opt-in tokens, suppression, unsubscribe footer/header, merge fields
  mailer.js        Nodemailer transports + SMTP verify
  sms.js           Twilio-compatible SMS sender
  queue.js         Background worker (rate limit, retries, bounce auto-suppress)
  routes/          auth, users, apikeys, senders, lists, contacts, templates,
                   campaigns, messaging (API), public (confirm/unsubscribe)
public/            Static admin panel (vanilla SPA)
```

## License

MIT
