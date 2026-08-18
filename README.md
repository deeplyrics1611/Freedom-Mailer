# Freedom Mailer

An **email outreach and deliverability platform** you run yourself. Send quote
requests and campaigns through a pool of mailboxes you own (Gmail, Google
Workspace or any SMTP host, authenticated with app passwords), validate lead
lists before you send, and check the things that decide whether a message
reaches the inbox: content, HTML, sending-domain authentication, and links.

It also keeps the original permission-based side: double opt-in lists,
suppression enforcement, and a transactional API.

## What this does and does not do

Two features people usually expect from a tool like this are deliberately
scoped, so it is worth being clear up front.

**Mailbox rotation is quota management, not evasion.** Gmail cuts a free
account off at roughly 500 recipients a day and a Workspace account at roughly
2,000; going over locks the account out of sending for about a day. The pool
spreads a campaign across the mailboxes you have added, keeps each one inside
its own daily and hourly cap, ramps new mailboxes up gradually, and paces
sends. Every message goes out under the real identity of the account that sent
it, fully authenticated. There is no proxy rotation, no IP rotation, no header
spoofing, and no content randomisation — those exist to defeat filters, they
are what spam operations do, and they do not survive contact with a modern
receiver anyway.

**The checks predict problems; they do not promise placement.** Nothing can
tell you in advance what Gmail will do with a specific message, because the
largest inputs are your domain's reputation and how recipients engage. What
this gives you is every problem that is knowable ahead of time — an unresolved
merge field, a missing DKIM key, a blocklisted link, a dead mailbox — plus a
way to record where real seed messages actually landed.

## Features

### Sending

- **Mailbox pool** — add as many app-password mailboxes as you own. Each one
  has its own daily cap, hourly cap and minimum gap between sends. Sends go to
  the least-utilised available mailbox, so a mixed pool of free and Workspace
  accounts drains evenly. App passwords are encrypted at rest (AES-256-GCM).
- **Warm-up** — new mailboxes start at a low daily volume and ramp up, because
  an account that suddenly sends hundreds of messages looks compromised.
- **Automatic back-off** — a mailbox that gets rate-limited cools down for two
  hours and its messages move to another mailbox; one that fails
  authentication is deactivated so it cannot silently fail the whole campaign.
- **Paced delivery** — campaigns are scheduled with a randomised gap between
  sends rather than fired as a burst.

### Audience

- **Lead lists** with CSV import. Every column becomes a merge field; common
  header spellings ("First Name", "firstname", "FIRST_NAME") are normalised to
  the same field. Duplicates, malformed rows and previously opted-out addresses
  are skipped on import.
- **Address validation** — syntax, domain, MX, disposable-provider, role-account
  and typo checks, plus an SMTP mailbox-existence probe and catch-all detection.
  Runs on a single address or as a background bulk job with CSV export.
- **Opt-in lists** with double opt-in, kept separate from cold-outreach leads.
- **Suppression list** enforced at send time across everything.

### Copy

- **Merge fields with fallbacks** — `{{first_name|there}}` renders the fallback
  when the field is empty, `{{name:first}}` takes the first word, and
  `{{company_from_domain}}` derives a company name from the address. A campaign
  will not send if a field would render empty and has no fallback, unless you
  explicitly override it.
- **Per-recipient preview** of the exact message, footer included.
- **RFQ starter templates** for direct quote requests, capability enquiries,
  multi-line bills of materials and a single follow-up.

### Deliverability

- **Spam and HTML check** — content heuristics (trigger phrases, shouting,
  urgency, link density, hidden text, image-to-text ratio) and client
  compatibility problems (scripts, iframes, forms, external stylesheets,
  unsupported CSS, Gmail's 102 KB clipping threshold), scored out of 10 with an
  explanation and a fix for each finding.
- **Domain authentication** — SPF (including the RFC 7208 ten-lookup limit),
  DKIM selector discovery, DMARC policy, MX, MTA-STS, TLS-RPT, BIMI, plus
  reverse DNS and blocklist checks for a sending IP if you run your own relay.
- **Delivered-header analysis** — paste the source of a message you received and
  get the receiver's own verdict: authentication results, SPF/DKIM alignment,
  the SpamAssassin score or Microsoft SCL it was assigned, the delivery path,
  and where it was delayed.
- **Inbox placement seed tests** — send a tagged copy to seed mailboxes you own
  and record where each one landed.
- **Link check** — redirect tracing, cloaking detection (meta-refresh and
  JavaScript forwards), URI blocklists, domain age via RDAP, shortener and bare-IP
  detection, anchor-text mismatch, and optional Google Safe Browsing.

## Quick start

```bash
npm install
cp .env.example .env      # then edit JWT_SECRET and CREDENTIAL_KEY
npm start
```

Open <http://localhost:3000> and sign in with the bootstrap admin from your
`.env` (`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`). Change the
password immediately under **Account**.

Data is stored in a local SQLite file at `data/freedom-mailer.sqlite`.

## Setting up a Gmail app password

1. Turn on 2-Step Verification for the account. Google does not offer app
   passwords without it.
2. Go to <https://myaccount.google.com/apppasswords> and create one for "Mail".
3. Copy the 16-character password. Spaces are display only; paste it either way.
4. In **Sending pool → Add a mailbox**, choose Gmail or Google Workspace, enter
   the address and the app password, and save. The panel signs in over SMTP
   straight away and tells you plainly if the credentials are wrong.

Using the account's normal password instead of an app password is the most
common failure, and Google's error message for it is misleading; the panel
translates that and the other common SMTP errors into what actually needs
fixing.

A note worth reading before you build on this: sending cold outreach from a
free `@gmail.com` address means SPF, DKIM and DMARC all belong to Google, so
you accumulate no domain reputation of your own, and Google applies tighter
limits to consumer accounts. Registering a domain and connecting it to Google
Workspace changes nothing about this workflow — same app passwords, same pool —
but it is the difference between having a sender reputation and not.

## Sending a quote-request campaign

1. **Sending pool** — add and verify at least one mailbox.
2. **Leads** — create a list and import your CSV. Check the "Merge fields
   available" panel to see which fields have full coverage.
3. **Lead validation** — validate the list, then remove the invalid addresses.
   Bounces are what destroy a sending reputation and are entirely preventable.
4. **Inbox placement → Domain authentication** — confirm the domain you send
   from has SPF, DKIM and DMARC. Gmail and Yahoo have required all three from
   bulk senders since 2024.
5. **Campaigns** — write the copy (or start from a template), set the postal
   address, and **Preview**. Read the rendered messages; that is where an
   awkward merge field becomes obvious.
6. **Inbox placement → Spam & HTML check** and **Link check** — run the exact
   copy you are about to send.
7. **Send.** The queue paces delivery across the pool and reports how far
   today's capacity goes.

## How accurate is address validation?

Honestly: it depends entirely on the receiving domain, and any tool quoting you
a single accuracy figure is glossing over that.

Where a domain answers honestly at SMTP, a `valid` result means the server
confirmed the recipient and a `invalid` result means it rejected it. Those are
reliable. But Google, Microsoft, Yahoo and most enterprise filters accept every
recipient during the SMTP conversation and only decide afterwards. On those
domains no external tool can confirm a mailbox exists, so results come back as
`catch_all` or `unknown` rather than being asserted as valid. The statuses are:

| Status | Meaning |
|---|---|
| `valid` | The receiving server confirmed this mailbox. |
| `invalid` | Bad syntax, no MX, disposable provider, or the server rejected the recipient. Do not send. |
| `risky` | Deliverable but likely to generate complaints — an abuse or automation address. |
| `catch_all` | The domain accepts everything, so the mailbox may or may not exist. |
| `unknown` | No usable answer. Not a verdict either way. |

Two things affect how much you get out of it:

- **Outbound port 25.** Mailbox probes need it, and most cloud providers block
  it. **Lead validation → capabilities** tells you whether this host can do it.
  When it cannot, DNS-level checks still run and everything needing SMTP is
  reported as `unknown` rather than guessed.
- **Your probe identity.** Set `VERIFY_HELO_NAME` and `VERIFY_MAIL_FROM` to a
  domain you control with matching forward and reverse DNS. Servers are far
  more willing to answer a host that can identify itself.

## Configuration

All settings live in `.env` (see `.env.example`).

| Variable | Purpose |
|---|---|
| `APP_BASE_URL` | Public URL used to build confirm/unsubscribe links |
| `JWT_SECRET` | Signing secret for panel sessions — set a long random value |
| `CREDENTIAL_KEY` | Encrypts stored app passwords. Changing it makes existing ones unreadable |
| `GLOBAL_RATE_PER_MINUTE` | Worker send-rate cap across everything |
| `REQUIRE_DOUBLE_OPT_IN` | When true, opt-in campaigns only reach `confirmed` subscribers |
| `VERIFY_SMTP_PROBE` | Set false to run DNS-level validation only |
| `VERIFY_HELO_NAME`, `VERIFY_MAIL_FROM` | Identity used for SMTP probes |
| `VERIFY_CONCURRENCY` | Addresses checked in parallel during bulk jobs |
| `SAFE_BROWSING_API_KEY` | Optional, enables the Safe Browsing lookup in link checks |
| `SMTP_*` | Optional system/fallback SMTP identity |
| `TWILIO_*` | Optional SMS gateway credentials |

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

## Legal and compliance

Cold B2B outreach — including a genuine request for a quote — is lawful in most
places, but it comes with conditions, and this app enforces the ones it can.

**Enforced automatically, and not switchable off:**

- Every outreach message carries a working one-click opt-out (RFC 8058
  `List-Unsubscribe` plus a visible link).
- An outreach campaign will not send without a physical postal address, which
  CAN-SPAM requires in every commercial email.
- Opting out suppresses the address across your whole account immediately, and
  cancels anything already queued for that person.
- Suppressed addresses are filtered at import, at queue time, and again at send.

**Your responsibility:**

- **US (CAN-SPAM):** no deceptive headers or subject lines, identify yourself,
  honour opt-outs within 10 business days.
- **EU/UK (GDPR, PECR):** B2B outreach generally relies on legitimate interest.
  You need to have done the balancing test, keep a record of where the data came
  from, and be able to answer a subject access request. Some member states are
  stricter — check the rules where your recipients are.
- **Canada (CASL):** substantially stricter than CAN-SPAM, and largely requires
  consent. Do not assume a US-legal campaign is legal in Canada.
- Do not buy lists. Beyond the legal exposure, purchased lists are full of spam
  traps, and hitting those is the fastest way to get a domain blocklisted.

## Architecture

```
src/
  server.js        Express app, bootstrap admin, route wiring, worker start
  config.js        Env-driven config
  db.js            SQLite schema + migrations (better-sqlite3)
  auth.js          Passwords, JWT, API-key auth middleware
  compliance.js    Opt-in tokens, suppression, unsubscribe/outreach footers
  pool.js          Mailbox pool: quotas, warm-up, rotation, back-off
  mailer.js        Nodemailer transports, pooled mailbox sending, SMTP error help
  queue.js         Send worker + bulk validation worker
  sms.js           Twilio-compatible SMS sender
  lib/
    secrets.js      AES-256-GCM encryption for stored app passwords
    dnsx.js         DNS lookups with DoH fallback, SPF/DKIM/DMARC, blocklists
    smtp-probe.js   Minimal SMTP client for recipient probing (stops before DATA)
    verify-email.js Address validation engine + domain cache
    address-data.js Disposable/free/role/shortener lists, typo suggestions
    spamcheck.js    Content and HTML analysis
    authcheck.js    Sending-domain authentication report
    headercheck.js  Delivered-message header parsing
    linkcheck.js    Redirect tracing, blocklists, domain age
    personalize.js  Merge fields with fallbacks and filters
    csv.js          CSV parse/serialise, header canonicalisation
    starters.js     RFQ template copy
  routes/          auth, users, apikeys, senders, mailboxes, lists, leads,
                   contacts, templates, campaigns, validation, deliverability,
                   links, messaging (API), public (confirm/unsubscribe)
public/            Panel: vanilla ES-module SPA (js/core.js + js/views/*)
scripts/
  smoke-test.sh    End-to-end exercise of every feature against a running server
```

## Tests

With the server running:

```bash
./scripts/smoke-test.sh
```

Covers the pool, CSV import, validation, spam/HTML analysis, domain
authentication, header parsing, link checks, personalisation, the compliance
gates and opt-out handling. The script is safe to re-run.

## License

MIT
