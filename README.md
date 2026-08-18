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
- **Sender identities (SMTP / Gmail app passwords)** — add as many mailbox credentials as you like (e.g. several Gmail accounts with their own [App Passwords](https://myaccount.google.com/apppasswords)); each must pass a live `verify()` before it can send, and you pick one per campaign.
- **Transactional API** — `POST /api/v1/email` and `/api/v1/sms`, authenticated with per-user API keys.
- **Lists with double opt-in** — subscribers are `pending` until they click a confirmation link; only `confirmed` recipients receive campaigns.
- **One-click unsubscribe** — every campaign email carries an unsubscribe footer and RFC 8058 `List-Unsubscribe` header; unsubscribes auto-add to suppression.
- **Suppression list** — unsubscribes, complaints and hard bounces are skipped on every send.
- **Templates & campaigns** — `{{name}}`/`{{email}}` merge fields, draft → queue → send.
- **Background queue** — rate-limited worker with retries and delivery logging.
- **Deliverability / spam-content checker** — scores subject + HTML against classic content-filter heuristics (spam-trigger phrases, ALL-CAPS/`!!!` subjects, hidden text, mismatched link text, text/HTML ratio) and checks the sending domain's SPF, DMARC, and Spamhaus DBL blocklist status.
- **Cold-mail link checker** — flags URL shorteners, non-HTTPS links, unresolvable domains, long redirect chains, and DNSBL-blacklisted destinations before you put a link in front of a cold prospect.
- **Lead / list validator** — debounce/ZeroBounce-style hygiene check: syntax, MX/mail-server records, disposable-domain detection, role-based address detection, and common-domain typo suggestions (e.g. `gmial.com` → `gmail.com`), plus an opt-in best-effort live SMTP mailbox probe.
- **SMS channel** — optional, via a Twilio-compatible gateway with consent expected upstream.

### On sender rotation

This platform deliberately does **not** auto-rotate across multiple sender identities (App Passwords/mailboxes) to push more volume than a single account's own sending limits allow. Using many mailboxes specifically to bypass a provider's per-account caps or spam controls violates Gmail's/Google Workspace's terms and is the same mechanism spam and phishing operations rely on. You can still add unlimited sender identities and choose which verified one to use per campaign — each just sends within its own limits, verified and logged independently.

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

## Deliverability, link, and lead-hygiene tools

Three panel sections help you keep sending reputation healthy, independent of any single campaign:

- **Deliverability check** (`POST /api/tools/deliverability`) — paste a subject/HTML/text and (optionally) your sending domain. Returns a 0-100 content score with itemized issues, plus SPF/DMARC/DBL status for the domain. This is a heuristic estimate of spam-filter risk, **not** a real inbox-placement test — for an actual seed-list test across Gmail/Outlook/Yahoo, run the same message through a dedicated service (e.g. Mail-Tester, GlockApps) in addition to this check.
- **Link checker** (`POST /api/tools/links`) — paste HTML/text or a list of URLs; each is checked for shortener usage, HTTPS, DNS resolution, redirect-chain length, and Spamhaus DBL status. Outbound requests are restricted to public hosts (private/internal/metadata addresses are blocked) to keep the checker itself safe to run.
- **Lead validator** (`POST /api/tools/validate-emails`) — paste or upload a list of addresses to get syntax, MX, disposable-domain, role-based, and typo checks, with an optional best-effort live SMTP probe. Outbound port 25 is blocked on many networks (including most cloud/CI egress), so the live probe degrades gracefully to the MX-based verdict when it can't complete — treat it as a bonus signal, not a guarantee, the same way any third-party verifier (Debounce, ZeroBounce, etc.) has to.

All three are rate-limited (20 requests/minute/IP) since they make outbound DNS/HTTP calls on your behalf.

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
  netutils.js      HTML/link parsing, SSRF-safe fetch guard, DNSBL lookups, concurrency pool
  deliverability.js  Content spam-heuristic scoring + SPF/DMARC/DBL domain checks
  linkcheck.js     Cold-mail link safety checks (shorteners, redirects, DBL)
  validator.js     Debounce-style email/lead validation (syntax, MX, disposable, typo, SMTP probe)
  routes/          auth, users, apikeys, senders, lists, contacts, templates,
                   campaigns, messaging (API), public (confirm/unsubscribe), tools (deliverability/links/validate)
public/            Static admin panel (vanilla SPA)
```

## License

MIT
