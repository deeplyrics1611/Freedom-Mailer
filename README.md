# QuoteMail — Gmail RFQ sender

Web app for sending **request-for-quote** campaigns through **Gmail SMTP app passwords**. Add as many Google accounts as you own, rotate them under per-account daily caps, personalize with placeholders, and run inbox / spam / link / MX checks before you send.

This is for mailboxes **you control**. Gmail’s consumer terms are not a bulk ESP: keep daily caps conservative (default 80/account), authenticate honestly, and only contact people you have a lawful basis to email (B2B RFQ, existing relationship, or the anti-spam law that applies to you). Every campaign still gets an unsubscribe footer, `List-Unsubscribe`, and a physical address.

## What you get

- **Gmail pool** — paste a 16-character app password per account, verify SMTP, pause/resume rotation, set a daily cap.
- **Rotation** — least-recently-used among verified Gmail identities that still have remaining capacity. No proxies or IP farms.
- **RFQ campaigns** — starter templates, `{{first_name}}` / `{{company}}` / `{{rfq_item}}` merge fields, live preview.
- **Inbox placement** — content estimator (Primary vs Promotions vs Spam) plus an optional IMAP probe to INBOX vs Spam on a Gmail you own.
- **HTML / spam check** — SpamAssassin-style flags (ALL CAPS, shorteners, image-only, hidden text, JS, …).
- **Link check** — flags shorteners, IP hosts, risky TLDs, redirect chains, dead links — the usual cold-mail landmines.
- **Lead validation** — Debounce-style scoring: syntax, typos, disposable domains, role accounts, **MX**. Optional SMTP `RCPT TO` probe if outbound port 25 is open. Corporate MX with no risk flags scores **99**.
- **CSV import** — `email,first_name,last_name,company,title,phone`. Undeliverable leads are skipped at send time.
- **SMS** — Twilio (`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`) plus Vonage, MessageBird, Plivo, Telnyx, Infobip, ClickSend, Sinch, Twilio-compatible APIs, or a custom HTTPS webhook. Panel + `POST /api/v1/sms`.
- **Email SMTP** — AWS SES (US + Tokyo/Osaka), SendGrid, Mailchimp/Mandrill, Mailgun, Postmark, SparkPost, Brevo, Mailjet, Microsoft 365, plus Japan hosts (Sakura, Lolipop, Xserver, Value Domain, MuuMuu, Heteml, ConoHa). **Extract SMTP** fills host/port/user from a mailbox, domain, or pasted panel dump (`smtp://` URI or 送信サーバー lines). Optional **SOCKS5 per identity** so you can tunnel through a Japanese VPS you operate, then send via Japan-region SMTP. One proxy per identity — not a rotating proxy list. Gmail app passwords stay in **Gmail pool**.

## Quick start

```bash
npm install
cp .env.example .env      # set JWT_SECRET and bootstrap admin
npm start
```

Open <http://localhost:3000> and sign in with `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`.

1. **Account** — company name + physical mailing address.
2. **Gmail pool** — add app passwords, click verify.
3. **Contacts / Lists** — import CSV.
4. **Lead validation** — paste the list, drop undeliverable rows.
5. **Deliverability** — paste the RFQ HTML, run spam + link + inbox checks.
6. **Email SMTP** — add SES / SendGrid / Mailchimp / Japan SMTP. For Japan send-out, set SOCKS5 on a VPS you own, verify, then pick that identity on an RFQ campaign (single sender, not Gmail rotate).
7. **RFQ campaigns** — load a template, personalize, rotate pool or send from one SMTP identity.

## Gmail app passwords

1. Enable 2-Step Verification on the Google account.
2. [Create an app password](https://myaccount.google.com/apppasswords).
3. Paste it into **Gmail pool**. Username is the full address (`you@gmail.com` or your Workspace domain). SMTP is `smtp.gmail.com:587` (STARTTLS).

App passwords are encrypted at rest (AES-256-GCM using `JWT_SECRET`).

## Placeholders

`{{first_name}}` `{{last_name}}` `{{name}}` `{{email}}` `{{company}}` `{{title}}` `{{phone}}`  
`{{sender_name}}` `{{sender_email}}` `{{sender_company}}` `{{sender_title}}`  
`{{rfq_item}}` `{{rfq_qty}}` `{{rfq_needed_by}}` `{{physical_address}}` `{{today}}`

## Configuration

See `.env.example`. Notable:

| Variable | Purpose |
|---|---|
| `APP_BASE_URL` | Public URL for unsubscribe/confirm links |
| `JWT_SECRET` | Session + secret-encryption key |
| `GLOBAL_RATE_PER_MINUTE` | Worker send-rate cap |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Default Twilio SMS (or add providers in the SMS panel) |

## Tests

```bash
npm test
```

## Architecture

```
src/
  server.js         Express + worker
  db.js             SQLite schema
  mailer.js         Nodemailer / Gmail + ESP SMTP (optional SOCKS5)
  smtpCatalog.js    AWS / SendGrid / Mailchimp / Japan SMTP presets
  rotate.js         Gmail pool picker + daily caps
  secrets.js        App-password encryption
  placeholders.js   Merge fields
  spamcheck.js      HTML / filter heuristics
  linkcheck.js      Cold-mail URL review
  inbox.js          Placement estimate + IMAP probe
  validate.js       MX / disposable / role scoring
  sms.js            Multi-provider SMS (Twilio, Vonage, …)
  quota.js          Live Twilio/gateway balance + email caps
  routes/quota.js   Quotas panel API
  queue.js          Rate-limited sender
  routes/gmail.js   Pool CRUD
  routes/tools.js   Preview, spam, links, validate
public/             Admin panel
```
