// Reference data used to classify email addresses. These lists are curated and
// finite, not exhaustive — new disposable domains appear constantly, so a
// negative result means "not on this list", not "definitely not disposable".

const list = (s) => new Set(s.trim().split(/\s+/));

// Throwaway/temporary inbox providers. Mail sent here is rarely read and often
// hits spam traps.
export const DISPOSABLE_DOMAINS = list(`
0-mail.com 10minutemail.com 10minutemail.net 20minutemail.com 33mail.com
anonbox.net anonymbox.com armyspy.com bearsarefuzzy.com binkmail.com
bobmail.info bugmenot.com burnermail.io byom.de cool.fr.nf courriel.fr.nf
cuvox.de dayrep.com deadaddress.com despam.it discard.email discardmail.com
disposableaddress.com disposableemailaddresses.com disposeamail.com
dispostable.com dodgeit.com dodgit.com dropmail.me e4ward.com einrot.com
emailfake.com emailondeck.com emailsensei.com emailtemporanea.com
emailtemporario.com.br emailwarden.com emltmp.com ephemail.net fakeinbox.com
fakemail.net fakemailgenerator.com fastacura.com filzmail.com fleckens.hu
forgetmail.com fudgerub.com garliclife.com get2mail.fr getairmail.com
getnada.com gishpuppy.com grr.la guerrillamail.biz guerrillamail.com
guerrillamail.de guerrillamail.info guerrillamail.net guerrillamail.org
guerrillamailblock.com harakirimail.com hidemail.de hmamail.com
inboxalias.com inboxbear.com incognitomail.com jetable.fr.nf jetable.net
jetable.org jourrapide.com kasmail.com killmail.net klzlk.com koszmail.pl
lackmail.net letthemeatspam.com lifebyfood.com linshiyouxiang.net
lroid.com luxusmail.org mail-temporaire.fr mail.tm mail4trash.com
mailcatch.com maildrop.cc maildrop.gq mailexpire.com mailforspam.com
mailfreeonline.com mailinater.com mailinator.com mailinator.net
mailinator.org mailmetrash.com mailmoat.com mailnesia.com mailnull.com
mailsac.com mailtemp.info mailtothis.com mailtrash.net mailzilla.com
meltmail.com mintemail.com moakt.com mohmal.com msgsafe.io mt2015.com
mvrht.com mytemp.email mytempemail.com mytrashmail.com nada.email
nowmymail.com nurfuerspam.de objectmail.com onewaymail.com opayq.com
otherinbox.com owlpic.com pjjkp.com pokemail.net polymail.tk proxymail.eu
rcpt.at receivemail.org rhyta.com rmqkr.net rppkn.com safetymail.info
sharklasers.com shieldedmail.com shortmail.net sneakemail.com sofimail.com
sogetthis.com spam4.me spamavert.com spambob.com spambog.com spambox.us
spamcannon.com spamcorptastic.com spamcowboy.com spamday.com spamfree24.org
spamgourmet.com spamherelots.com spamhole.com spaml.com spamspot.com
spamthis.co.uk spamtrail.com superrito.com supermailer.jp tafmail.com
teleworm.us temp-mail.io temp-mail.org tempail.com tempemail.com
tempemail.net tempinbox.com tempmail.de tempmail.email tempmail.net
tempmail.plus tempmailaddress.com tempmailer.com tempomail.fr
temporarily.de temporaryemail.net temporaryforwarding.com
temporaryinbox.com thankyou2010.com thisisnotmyrealemail.com throwawaymail.com
tmail.ws tmailinator.com trash-mail.at trash-mail.com trash2009.com
trashdevil.com trashemail.de trashmail.at trashmail.com trashmail.de
trashmail.me trashmail.net trashmail.org trashymail.com tyldd.com
uggsrock.com upliftnow.com uroid.com veryrealemail.com vomoto.com
walkmail.net wegwerfmail.de wh4f.org whyspam.me willselfdestruct.com
wuzup.net wuzupmail.net yopmail.com yopmail.fr yopmail.net yourdomain.com
yuurok.com zetmail.com zoemail.com
`);

// Consumer mailbox providers. Not a problem on their own, but a B2B RFQ list
// that is mostly free addresses usually means the data is weak.
export const FREE_DOMAINS = list(`
aol.com bellsouth.net btinternet.com comcast.net cox.net earthlink.net
email.com fastmail.com fastmail.fm free.fr gmail.com gmx.com gmx.de gmx.net
googlemail.com hotmail.co.uk hotmail.com hotmail.fr hotmail.it hushmail.com
icloud.com inbox.com laposte.net libero.it live.co.uk live.com live.fr
mac.com mail.com mail.ru me.com msn.com naver.com neuf.fr optonline.net
orange.fr outlook.com outlook.de outlook.fr pm.me proton.me protonmail.ch
protonmail.com qq.com rediffmail.com rocketmail.com sbcglobal.net seznam.cz
sfr.fr shaw.ca sky.com t-online.de tiscali.it tutanota.com verizon.net
virgilio.it wanadoo.fr web.de yahoo.co.in yahoo.co.jp yahoo.co.uk yahoo.com
yahoo.de yahoo.fr yandex.com yandex.ru ymail.com zoho.com
`);

// Shared/departmental addresses. For an RFQ these are often the *right* target
// (sales@, purchasing@), so they are flagged as context rather than penalised
// as heavily as consumer tools do.
export const ROLE_PREFIXES = list(`
abuse accounting accounts admin administrator all billing board buy careers
compliance contact customerservice enquiries enquiry example feedback finance
ftp help hello helpdesk hostmaster hr info inquiries inquiry investors it
jobs legal mail mailer-daemon marketing media newsletter no-reply noc noreply
notifications office operations orders postmaster pr press privacy purchasing
quotes recruitment reception root rfq sales security service shop
subscriptions support sysadmin team tech usenet uucp webmaster welcome www
`);

// Role addresses that are appropriate targets for a quote request.
export const PROCUREMENT_ROLES = list(`
buy contact enquiries enquiry info inquiries inquiry orders purchasing quotes
rfq sales
`);

// High-traffic domains that are commonly mistyped.
export const TYPO_TARGETS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'aol.com', 'icloud.com', 'protonmail.com', 'live.com', 'msn.com', 'me.com',
  'comcast.net', 'gmx.com', 'mail.com', 'yandex.com', 'zoho.com',
];

// Providers that accept every recipient at SMTP time, so a successful RCPT TO
// proves nothing about whether the mailbox exists.
export const ACCEPT_ALL_PROVIDERS = [
  { match: /(^|\.)google\.com$|(^|\.)googlemail\.com$/, name: 'Google' },
  { match: /(^|\.)outlook\.com$|(^|\.)protection\.outlook\.com$|(^|\.)hotmail\.com$/, name: 'Microsoft' },
  { match: /(^|\.)yahoodns\.net$|(^|\.)yahoo\.com$/, name: 'Yahoo' },
  { match: /(^|\.)icloud\.com$|(^|\.)apple\.com$/, name: 'Apple' },
  { match: /(^|\.)mimecast\.com$/, name: 'Mimecast' },
  { match: /(^|\.)proofpoint\.com$|(^|\.)pphosted\.com$/, name: 'Proofpoint' },
  { match: /(^|\.)barracudanetworks\.com$/, name: 'Barracuda' },
  { match: /(^|\.)messagelabs\.com$/, name: 'Symantec' },
];

// Link shorteners hide the destination, are heavily abused, and are a strong
// spam signal in cold email.
export const URL_SHORTENERS = list(`
0rz.tw 1url.com 2big.at 3.ly adf.ly adfoc.us amzn.to bc.vc bit.do bit.ly
bitly.com buff.ly chilp.it clck.ru cli.gs cutt.ly db.tt dlvr.it doiop.com
dub.sh fb.me ff.im filoops.info fur.ly git.io go2l.ink goo.gl gg.gg hyperurl.co
is.gd j.mp kutt.it lc.chat linktr.ee lnkd.in mcaf.ee migre.me myurl.in
ow.ly ping.fm plu.sh po.st prettylinkpro.com q.gs qr.ae rb.gy rebrand.ly
rlu.ru s.id scrnch.me shorte.st shorturl.at snipurl.com soo.gd spn.sr t.co
t.ly tiny.cc tinyarrows.com tinyurl.com tr.im trib.al tweez.me twitthis.com
u.to urlz.fr v.gd vzturl.com wp.me x.co yourls.org zi.ma
`);

// Levenshtein distance, capped for speed — used for "did you mean gmail.com?".
export function editDistance(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

export function suggestDomain(domain) {
  if (!domain || TYPO_TARGETS.includes(domain)) return null;
  let best = null;
  for (const target of TYPO_TARGETS) {
    const d = editDistance(domain, target, 2);
    if (d > 0 && d <= 2 && (!best || d < best.distance)) best = { domain: target, distance: d };
  }
  return best?.domain || null;
}
