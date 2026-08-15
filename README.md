# Freedom Mailer

A **permission-based bulk email (and SMS) platform**. Compose a letter, paste
recipients, merge placeholders, and send through SMTP identities you own —
including OVH, webmail hosts, Japanese mailbox SMTP, and email-to-SMS gateways.

> This project does **not** send through SOCKS5, open relays, or rotating IPs.
> Those exist to hide where mail comes from. Deliverability comes from a
> mailbox you control, plus SPF/DKIM/DMARC and people who asked to hear from you.

## What you can do

- **Compose** — paste leads (no file import), generate an HTML letter, preview merges, queue a send.
- **Sender presets**
  - **SMTP** — any host you own
  - **OVH** — `smtp.mail.ovh.net` / `ssl0.ovh.net`
  - **Webmail** — Gmail, Outlook/Microsoft 365, Yahoo, iCloud, Zoho (official SMTP + app passwords)
  - **Japan mail** — Yahoo! Mail Japan, Sakura, Xserver, Lolipop, GMO, Biglobe, OCN
  - **SMTP → SMS** — short text emailed to `number@carrier-gateway`
- **Placeholders** — `{{name}}` `{{first_name}}` `{{email}}` `{{phone}}` `{{company}}` `{{title}}` `{{custom1}}` plus `{{first_name|there}}` fallbacks.
- **HTML letters** — signature request, document review, invoice, shared file, video meeting, calendar invite, receipt. Branded with **your** company name and **your** URLs.
- **AI help** — rewrite / translate / suggest subject. Uses `OPENAI_API_KEY` when set; otherwise local letter generation still works.
- **Lists & campaigns** — double opt-in, one-click unsubscribe, suppression list, daily quotas.
- **Transactional API** — `POST /api/v1/email` and `/api/v1/sms`.

Paste format (copy/paste only — there is no CSV upload):

```
email, name, phone, company
alex@example.com, Alex Rivera, +1 555 0100, Northwind
Jane Doe <jane@example.com>
```

## Quick start

```bash
npm install
cp .env.example .env      # then edit secrets
npm test
npm start
```

Open <http://localhost:3000> and sign in with `BOOTSTRAP_ADMIN_EMAIL` /
`BOOTSTRAP_ADMIN_PASSWORD`. Change the password under **Account**.

Data lives in `data/freedom-mailer.sqlite`.

## Configuration

| Variable | Purpose |
|---|---|
| `APP_BASE_URL` | Public URL for confirm/unsubscribe links |
| `JWT_SECRET` | Session signing secret |
| `GLOBAL_RATE_PER_MINUTE` | Worker send-rate cap |
| `REQUIRE_DOUBLE_OPT_IN` | Campaigns to saved lists only reach `confirmed` subscribers |
| `SMTP_*` | Optional system/fallback SMTP |
| `TWILIO_*` | Optional Twilio-compatible SMS |
| `OPENAI_API_KEY` | Optional AI rewrite (OpenAI-compatible) |
| `OPENAI_BASE_URL` / `OPENAI_MODEL` | Override the AI endpoint |

## Sending flow

1. Add a **sender** (pick a preset, enter your mailbox credentials) and **Verify**.
2. Open **Compose**, paste recipients, generate or write a letter.
3. Confirm the people opted in, then **Queue send**.
4. The worker delivers at `GLOBAL_RATE_PER_MINUTE`, injects an unsubscribe footer, and logs each attempt.

Letters are for **your** organization. Do not impersonate DocuSign, Adobe,
Microsoft, Google, Zoom, banks, or anyone else — the generator will not produce
those brands, and using this tool that way is abuse.

## Architecture

```
src/
  server.js         Express app + worker
  letters.js        HTML letter generator
  placeholders.js   {{merge}} fields
  leads.js          paste parser + SMTP-to-SMS addressing
  presets.js        SMTP / OVH / webmail / Japan / SMS gateways
  ai.js             optional Chat Completions helper
  mailer.js         Nodemailer transports
  queue.js          rate-limited delivery
  routes/           panel + API
public/             vanilla SPA
```

## License

MIT
