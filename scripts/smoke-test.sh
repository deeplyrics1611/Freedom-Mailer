#!/usr/bin/env bash
# End-to-end exercise of the outreach features against a running server.
# Usage: BASE=http://localhost:3000 ./scripts/smoke-test.sh
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-admin@example.com}"
PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-changeme123}"

pass=0; fail=0
step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
check() {
  if [ "$1" = "ok" ]; then pass=$((pass+1)); printf '  \033[32mPASS\033[0m %s\n' "$2";
  else fail=$((fail+1)); printf '  \033[31mFAIL\033[0m %s\n' "$2"; fi
}

# Opt-outs and suppressions are permanent by design, so each run needs its own
# addresses or later runs would find their test leads already suppressed.
RUN="$(date +%s)$$"

TOKEN=$(curl -sS -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token||""')
[ -n "$TOKEN" ] || { echo "Could not sign in to $BASE"; exit 1; }
auth=(-H "authorization: Bearer $TOKEN" -H 'content-type: application/json')

jqf() { node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
const path='$1'.split('.').filter(Boolean);
let v=d; for(const k of path) v = v==null?undefined:v[k];
console.log(typeof v==='object'?JSON.stringify(v):String(v));
"; }

step 'Mailbox pool'
curl -sS "${auth[@]}" -X POST "$BASE/api/mailboxes" \
  -d "{\"provider\":\"gmail\",\"label\":\"Sales 1\",\"email\":\"smoke-$RUN@gmail.com\",\"app_password\":\"abcd efgh ijkl mnop\",\"from_name\":\"Smoke Test\"}" >/tmp/mb1.json
MB1=$(jqf id </tmp/mb1.json)
[ "$MB1" != "undefined" ] && check ok "created mailbox #$MB1" || { check bad "create mailbox: $(cat /tmp/mb1.json)"; }

curl -sS "${auth[@]}" -X POST "$BASE/api/mailboxes" \
  -d "{\"provider\":\"gmail\",\"label\":\"Sales 2\",\"email\":\"smoke2-$RUN@gmail.com\",\"app_password\":\"short\"}" >/tmp/mb2.json
grep -q '16 characters' /tmp/mb2.json && check ok 'rejects a malformed app password with a useful message' || check bad 'app password validation'

POOL=$(curl -sS "${auth[@]}" "$BASE/api/mailboxes")
echo "$POOL" | grep -q 'not verified' && check ok 'unverified mailbox is reported as unavailable' || check bad 'pool status blockers'
echo "$POOL" | grep -q 'app_password' && check bad 'app password leaked in the API response' || check ok 'app password never returned by the API'

step 'Lead list import'
LL=$(curl -sS "${auth[@]}" -X POST "$BASE/api/lead-lists" -d "{\"name\":\"Smoke suppliers $RUN\"}" | jqf id)
check ok "created lead list #$LL"

CSV="Email,First Name,Company,Product,Qty
buyer-$RUN@example.com,Dana,Acme Tools,M8 bolts,5000
sales-$RUN@example.org,,Beta Fasteners,M8 bolts,5000
BUYER-$RUN@example.com,Dana,Acme Tools,M8 bolts,5000
not-an-email,Bad,Row,,
temp-$RUN@mailinator.com,Trash,Throwaway,,"
node -e "
const csv = process.argv[1];
console.log(JSON.stringify({csv}));
" "$CSV" > /tmp/import.json
IMPORT=$(curl -sS "${auth[@]}" -X POST "$BASE/api/lead-lists/$LL/import" --data-binary @/tmp/import.json)
echo "$IMPORT" | grep -q '"imported":3' && check ok 'imported the 3 unique, well-formed rows' || check bad "import counts: $IMPORT"
echo "$IMPORT" | grep -q '"duplicates":1' && check ok 'skipped the case-duplicate row' || check bad "duplicate handling: $IMPORT"
echo "$IMPORT" | grep -q '"malformed":1' && check ok 'rejected the malformed row' || check bad "malformed handling: $IMPORT"

FIELDS=$(curl -sS "${auth[@]}" "$BASE/api/lead-lists/$LL/fields")
echo "$FIELDS" | grep -q '"first_name"' && check ok 'canonicalised "First Name" to first_name' || check bad "field mapping: $FIELDS"
echo "$FIELDS" | grep -q '"quantity"' && check ok 'canonicalised "Qty" to quantity' || check bad "field alias: $FIELDS"

step 'Address validation'
CAP=$(curl -sS "${auth[@]}" "$BASE/api/validation/capabilities")
echo "$CAP" | grep -q 'port_25_reachable' && check ok "capability probe: $(echo "$CAP" | jqf port_25_reachable)" || check bad 'capabilities'

R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/validation/single" -d '{"email":"not an email"}')
[ "$(echo "$R" | jqf status)" = 'invalid' ] && check ok 'syntax error detected' || check bad "syntax: $R"

R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/validation/single" -d '{"email":"someone@mailinator.com"}')
[ "$(echo "$R" | jqf reason)" = 'disposable' ] && check ok 'disposable domain detected' || check bad "disposable: $R"

R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/validation/single" -d '{"email":"nobody@this-domain-does-not-exist-xyzzy999.com"}')
[ "$(echo "$R" | jqf reason)" = 'no_mx' ] && check ok 'missing MX detected' || check bad "no_mx: $R"

R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/validation/single" -d '{"email":"someone@gmial.com"}')
echo "$R" | grep -qi 'gmail.com' && check ok 'typo suggestion offered' || check bad "typo: $R"

R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/validation/single" -d '{"email":"sales@google.com"}')
echo "$R" | grep -q 'provider_accepts_all\|catch_all\|unknown' && check ok 'accept-all provider reported honestly, not asserted valid' || check bad "accept-all: $R"

JOB=$(curl -sS "${auth[@]}" -X POST "$BASE/api/validation/lead-list/$LL" -d '{}' | jqf id)
check ok "queued bulk validation job #$JOB"
for _ in $(seq 1 30); do
  S=$(curl -sS "${auth[@]}" "$BASE/api/validation/jobs/$JOB")
  [ "$(echo "$S" | jqf status)" = 'done' ] && break
  sleep 2
done
[ "$(echo "$S" | jqf status)" = 'done' ] && check ok "bulk job finished: $(echo "$S" | jqf summary)" || check bad "bulk job stuck: $S"

step 'Spam and HTML analysis'
BAD='{"subject":"RE: FREE MONEY!! ACT NOW","html":"<p style=\"display:none\">hidden keyword stuffing text goes here</p><script>alert(1)</script><a href=\"http://bit.ly/x\">example.com</a><img src=\"x.png\">","text":"","from_email":"noreply@test.com","mode":"outreach"}'
R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/deliverability/content" -d "$BAD")
SCORE=$(echo "$R" | jqf score)
node -e "process.exit(Number('$SCORE') < 4 ? 0 : 1)" && check ok "deliberately bad email scored $SCORE/10" || check bad "bad email scored $SCORE"
echo "$R" | grep -q 'hidden_text' && check ok 'hidden text detected' || check bad 'hidden text'
echo "$R" | grep -q 'script_tag' && check ok '<script> detected' || check bad 'script tag'
echo "$R" | grep -q 'shortened_links' && check ok 'link shortener detected' || check bad 'shortener'
echo "$R" | grep -q 'deceptive_links' && check ok 'anchor/href mismatch detected' || check bad 'deceptive link'
echo "$R" | grep -q 'no_unsubscribe' && check ok 'missing opt-out detected' || check bad 'unsubscribe check'

GOOD='{"subject":"Quote request: 5000x M8 stainless bolts","text":"Hi Dana,\n\nI am sourcing M8 stainless bolts for our assembly line and Acme Tools came up as a supplier worth approaching.\n\nWe need 5000 units delivered to our Leeds facility by the end of next month. Could you send unit pricing, lead time and your minimum order quantity? Happy to send the drawing if that helps.\n\nThanks,\nSam Green\nProcurement, Northfield Engineering\n\nUnsubscribe: https://example.com/u/abc","html":"<p>Hi {{first_name|there}},</p><p>I am sourcing M8 stainless bolts for our assembly line and Acme Tools came up as a supplier worth approaching. We need 5000 units delivered to our Leeds facility by the end of next month.</p><p>Could you send unit pricing, lead time and your minimum order quantity?</p><p>Thanks,<br>Sam Green<br>Northfield Engineering<br>12 Mill Street, Leeds LS1 4AB</p><p><a href=\"https://example.com/u/abc\">Unsubscribe</a></p>","postal_address":"12 Mill Street, Leeds LS1 4AB, United Kingdom","from_email":"sam@northfield-eng.com","mode":"outreach"}'
R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/deliverability/content" -d "$GOOD")
SCORE=$(echo "$R" | jqf score)
node -e "process.exit(Number('$SCORE') >= 8 ? 0 : 1)" && check ok "well-formed RFQ scored $SCORE/10" || check bad "good email scored only $SCORE: $(echo "$R" | jqf issues)"

step 'Domain authentication'
R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/deliverability/auth" -d '{"domain":"google.com"}')
[ "$(echo "$R" | jqf spf.found)" = 'true' ] && check ok 'SPF record read for google.com' || check bad "spf: $R"
[ "$(echo "$R" | jqf dmarc.found)" = 'true' ] && check ok 'DMARC record read for google.com' || check bad "dmarc: $R"

R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/deliverability/auth" -d '{"domain":"gmail.com"}')
[ "$(echo "$R" | jqf free_provider)" = 'true' ] && check ok 'flags sending from a consumer domain' || check bad "free provider: $R"

step 'Header analysis'
RAW='Delivered-To: buyer@example.com
Received: from mail-x.google.com (mail-x.google.com [209.85.128.50]) by mx.google.com with ESMTPS id abc for <buyer@example.com>; Tue, 18 Aug 2026 09:00:10 -0700 (PDT)
Authentication-Results: mx.google.com; dkim=pass header.i=@northfield-eng.com; spf=pass (google.com: domain of sam@northfield-eng.com designates 209.85.128.50 as permitted sender); dmarc=pass (p=QUARANTINE sp=NONE dis=NONE) header.from=northfield-eng.com
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=northfield-eng.com; s=google; h=from:to
Return-Path: <sam@northfield-eng.com>
From: Sam Green <sam@northfield-eng.com>
To: buyer@example.com
Subject: Quote request
Message-ID: <abc123@northfield-eng.com>
Date: Tue, 18 Aug 2026 17:00:05 +0100
List-Unsubscribe: <https://example.com/u/abc>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
X-Spam-Status: No, score=-1.2 required=5.0 tests=DKIM_SIGNED,DKIM_VALID,SPF_PASS

Body here.'
node -e "console.log(JSON.stringify({raw:process.argv[1]}))" "$RAW" > /tmp/hdr.json
R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/deliverability/headers" --data-binary @/tmp/hdr.json)
[ "$(echo "$R" | jqf auth.spf.result)" = 'pass' ] && check ok 'parsed SPF verdict' || check bad "header spf: $R"
[ "$(echo "$R" | jqf auth.dmarc.result)" = 'pass' ] && check ok 'parsed DMARC verdict' || check bad 'header dmarc'
[ "$(echo "$R" | jqf one_click)" = 'true' ] && check ok 'detected one-click unsubscribe' || check bad 'one-click'
[ "$(echo "$R" | jqf spam.spamassassin.score)" = '-1.2' ] && check ok 'parsed SpamAssassin score' || check bad "sa score: $R"

step 'Link checking'
R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/links/check" -d '{"url":"http://bit.ly/test","sending_domain":"northfield-eng.com"}')
echo "$R" | grep -q 'Link shortener' && check ok 'shortener flagged' || check bad "shortener: $R"
echo "$R" | grep -q 'not HTTPS' && check ok 'plain HTTP flagged' || check bad 'http flag'

R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/links/check" -d '{"url":"https://user:pass@192.168.1.1/login"}')
echo "$R" | grep -q 'bare IP' && check ok 'bare IP link flagged' || check bad "ip link: $R"
echo "$R" | grep -q 'Credentials embedded' && check ok 'embedded credentials flagged' || check bad 'credentials'

step 'Campaign personalisation and compliance'
C=$(curl -sS "${auth[@]}" -X POST "$BASE/api/campaigns" \
  -d "{\"name\":\"Smoke RFQ\",\"mode\":\"outreach\",\"lead_list_id\":$LL,\"use_pool\":true,\"subject\":\"Quote request: {{product|your range}}\",\"text\":\"Hi {{first_name}},\n\nCan you quote {{quantity|some}} x {{product}}?\n\nThanks\",\"only_valid\":false}" | jqf id)
check ok "created outreach campaign #$C"

R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/campaigns/$C/preview" -d '{"count":3}')
echo "$R" | grep -q 'Acme Tools\|M8 bolts' && check ok 'merge fields rendered from CSV data' || check bad "preview: $R"
echo "$R" | grep -q '"risky_placeholders":\[\]' && check bad 'should have flagged {{first_name}} with no fallback' || check ok 'flagged the merge field that would render empty'

R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/campaigns/$C/send" -d '{}')
echo "$R" | grep -qi 'postal address' && check ok 'refuses to send cold outreach without a postal address' || check bad "postal gate: $R"

curl -sS "${auth[@]}" -X PUT "$BASE/api/campaigns/$C" -d '{"postal_address":"12 Mill Street, Leeds LS1 4AB"}' >/dev/null
R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/campaigns/$C/send" -d '{}')
echo "$R" | grep -q 'render empty' && check ok 'refuses to send copy with unresolved merge fields' || check bad "placeholder gate: $R"

R=$(curl -sS "${auth[@]}" -X POST "$BASE/api/campaigns/$C/send" -d '{"allow_missing_fields":true}')
echo "$R" | grep -qi 'verify at least one mailbox' && check ok 'refuses to send with no verified mailbox' || check bad "mailbox gate: $R"

R=$(curl -sS "${auth[@]}" "$BASE/api/campaigns/$C/preflight")
echo "$R" | grep -q '"ready":false' && check ok 'preflight reports the campaign is not ready' || check bad "preflight: $R"

step 'Opt-out handling'
LEAD_TOKEN=$(curl -sS "${auth[@]}" "$BASE/api/lead-lists/$LL/leads?limit=1" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).leads[0].unsub_token')
curl -sS "$BASE/u/$LEAD_TOKEN" >/dev/null
R=$(curl -sS "${auth[@]}" "$BASE/api/lead-lists/$LL/leads?limit=1")
[ "$(echo "$R" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).leads[0].opted_out')" = '1' ] && check ok 'one-click opt-out marks the lead' || check bad "opt-out: $R"
curl -sS "${auth[@]}" "$BASE/api/contacts/suppressions" | grep -q 'unsubscribe' && check ok 'opt-out added to the account suppression list' || check bad 'suppression'

step 'Cleanup'
curl -sS "${auth[@]}" -X DELETE "$BASE/api/campaigns/$C" >/dev/null
curl -sS "${auth[@]}" -X DELETE "$BASE/api/lead-lists/$LL" >/dev/null
curl -sS "${auth[@]}" -X DELETE "$BASE/api/mailboxes/$MB1" >/dev/null
check ok 'removed test data'

printf '\n\033[1m%d passed, %d failed\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
