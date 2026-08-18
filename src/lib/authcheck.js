import {
  getSpf, getDmarc, findDkim, resolveMx, resolveTxt, resolveA, reverseDns,
  checkIpBlocklists, registrableDomain, COMMON_DKIM_SELECTORS,
} from './dnsx.js';
import { FREE_DOMAINS } from './address-data.js';

// Everything a receiving server checks about your domain before it looks at the
// message itself. Since 2024 Gmail and Yahoo require SPF, DKIM and DMARC from
// anyone sending bulk mail, so these are pass/fail gates rather than tips.

export async function checkSendingDomain(input, opts = {}) {
  const domain = String(input || '').trim().toLowerCase().replace(/^@/, '').replace(/\/.*$/, '');
  if (!domain || !domain.includes('.')) {
    return { ok: false, error: 'Provide a sending domain, e.g. yourcompany.com' };
  }

  const selectors = [...new Set([...(opts.selectors || []), ...COMMON_DKIM_SELECTORS])];

  const [spf, dmarc, dkim, mx, mtaSts, tlsRpt, bimi] = await Promise.all([
    getSpf(domain),
    getDmarc(domain),
    findDkim(domain, selectors),
    resolveMx(domain),
    resolveTxt(`_mta-sts.${domain}`),
    resolveTxt(`_smtp._tls.${domain}`),
    resolveTxt(`default._bimi.${domain}`),
  ]);

  const findings = [];
  const add = (severity, weight, title, detail, fix) =>
    findings.push({ severity, weight, title, detail, fix });

  const isFreeProvider = FREE_DOMAINS.has(domain);
  if (isFreeProvider) {
    add('critical', 25, 'You are sending from a consumer mailbox domain',
      `${domain} is a shared consumer provider. Its SPF, DKIM and DMARC belong to the provider, not to you, so you build no domain reputation of your own — and providers apply much tighter limits to cold outreach from consumer accounts. Gmail's own bulk-sender rules effectively rule this out for campaign volume.`,
      'Register a domain, connect it to Google Workspace (or your provider), and send from you@yourcompany.com. Keep the app-password workflow — only the domain changes.');
  }

  // ---- SPF -----------------------------------------------------------------
  if (!spf.found) {
    add('critical', 25, 'No SPF record',
      'Receivers cannot tell which servers may send for this domain. Gmail and Yahoo reject or spam-folder bulk mail without SPF.',
      `Publish a TXT record on ${domain}: "v=spf1 include:_spf.google.com ~all" for Google Workspace.`);
  } else {
    const detail = `Record: ${spf.record}`;
    if (spf.issues.length) add('warning', 8, 'SPF record has problems', `${detail}\n${spf.issues.join(' ')}`,
      'Fix the issues above; SPF fails closed when the lookup limit is exceeded.');
    else add('pass', 0, 'SPF published', detail);
    if (spf.all === '-') add('info', 0, 'SPF uses a hard fail (-all)', 'Strictest option. Make sure every legitimate sender is included first.');
  }

  // ---- DKIM ----------------------------------------------------------------
  if (!dkim.length) {
    add('critical', 25, 'No DKIM key found',
      `None of the ${selectors.length} selectors probed returned a key. DKIM is what survives forwarding, and it is mandatory for bulk senders at Gmail and Yahoo. Note that a key can exist under a selector not on this list — check a real DKIM-Signature header for the actual selector.`,
      'Turn on DKIM signing in your mail provider (Google Workspace: Apps > Google Workspace > Gmail > Authenticate email) and publish the key it gives you.');
  } else {
    const revoked = dkim.filter((d) => d.revoked);
    const weak = dkim.filter((d) => d.weakKey && !d.revoked);
    add(weak.length ? 'warning' : 'pass', weak.length ? 6 : 0,
      `DKIM key found (${dkim.map((d) => d.selector).join(', ')})`,
      [
        `Selectors with a published key: ${dkim.map((d) => d.selector).join(', ')}.`,
        revoked.length ? `Revoked (empty p=): ${revoked.map((d) => d.selector).join(', ')}.` : '',
        weak.length ? `Short key — likely 1024-bit: ${weak.map((d) => d.selector).join(', ')}. Move to 2048-bit.` : '',
      ].filter(Boolean).join(' '),
      weak.length ? 'Rotate to a 2048-bit key.' : undefined);
  }

  // ---- DMARC ---------------------------------------------------------------
  if (!dmarc.found) {
    add('critical', 20, 'No DMARC record',
      'DMARC tells receivers what to do when SPF and DKIM fail, and Gmail/Yahoo require at least p=none from bulk senders.',
      `Publish a TXT record at _dmarc.${domain}: "v=DMARC1; p=none; rua=mailto:dmarc@${domain}" and tighten to quarantine once reports look clean.`);
  } else if (dmarc.issues.length) {
    add('warning', 6, `DMARC published (p=${dmarc.policy || '?'})`, `${dmarc.record}\n${dmarc.issues.join(' ')}`,
      'Address the notes above.');
  } else {
    add('pass', 0, `DMARC published (p=${dmarc.policy})`, dmarc.record);
  }

  // ---- Receiving side ------------------------------------------------------
  if (!mx.length) {
    add('warning', 8, 'No MX record',
      'The domain cannot receive mail. Bounce handling and replies will fail, and a domain that sends but cannot receive is a spam pattern.',
      'Publish MX records even if you only forward to another mailbox.');
  } else {
    add('pass', 0, `MX configured (${mx.length} host${mx.length > 1 ? 's' : ''})`, mx.map((m) => `${m.priority} ${m.host}`).join(', '));
  }

  // ---- Optional hardening --------------------------------------------------
  const hasMtaSts = mtaSts.some((r) => /v=STSv1/i.test(r));
  add(hasMtaSts ? 'pass' : 'info', 0, hasMtaSts ? 'MTA-STS published' : 'No MTA-STS policy',
    hasMtaSts ? mtaSts.find((r) => /v=STSv1/i.test(r)) : 'Optional. Enforces TLS for inbound mail and is a small trust signal.',
    hasMtaSts ? undefined : `Publish _mta-sts.${domain} TXT plus a policy file at https://mta-sts.${domain}/.well-known/mta-sts.txt`);

  const hasTlsRpt = tlsRpt.some((r) => /v=TLSRPTv1/i.test(r));
  add(hasTlsRpt ? 'pass' : 'info', 0, hasTlsRpt ? 'TLS-RPT published' : 'No TLS-RPT record',
    hasTlsRpt ? tlsRpt.find((r) => /v=TLSRPTv1/i.test(r)) : 'Optional reporting for TLS failures.');

  const hasBimi = bimi.some((r) => /v=BIMI1/i.test(r));
  if (hasBimi) add('pass', 0, 'BIMI published', bimi.find((r) => /v=BIMI1/i.test(r)));

  // ---- Sending IP ----------------------------------------------------------
  let ipReport = null;
  if (opts.ip) {
    const [ptr, lists] = await Promise.all([reverseDns(opts.ip), checkIpBlocklists(opts.ip)]);
    const forward = ptr.length ? await resolveA(ptr[0]) : [];
    const listed = lists.filter((l) => l.listed);
    ipReport = { ip: opts.ip, ptr, forwardConfirmed: forward.includes(opts.ip), blocklists: lists };

    if (!ptr.length) {
      add('critical', 15, 'Sending IP has no reverse DNS',
        `${opts.ip} has no PTR record. Many receivers reject mail from IPs without one outright.`,
        'Ask your host to set a PTR that matches your mail hostname.');
    } else if (!ipReport.forwardConfirmed) {
      add('warning', 6, 'Reverse DNS is not forward-confirmed',
        `${opts.ip} -> ${ptr[0]}, but that name does not resolve back to the same IP.`,
        'Make the PTR and A records agree.');
    } else {
      add('pass', 0, 'Reverse DNS is forward-confirmed', `${opts.ip} <-> ${ptr[0]}`);
    }

    if (listed.length) {
      add('critical', 20, `Sending IP is blocklisted (${listed.map((l) => l.name).join(', ')})`,
        listed.map((l) => `${l.name}: ${l.codes.join(', ')}`).join('; '),
        'Request delisting on each provider before sending anything else.');
    } else if (lists.every((l) => l.unavailable)) {
      add('info', 0, 'IP blocklist lookups unavailable',
        'The blocklist zones refused queries from this resolver, so this is not a clean result.');
    } else {
      add('pass', 0, 'Sending IP is not blocklisted', lists.filter((l) => !l.unavailable).map((l) => l.name).join(', '));
    }
  } else {
    add('info', 0, 'No sending IP checked',
      'When you send through Gmail, Google owns the sending IPs and their reputation, so there is nothing for you to fix there. Supply an IP only if you run your own relay.');
  }

  const penalty = findings.reduce((s, f) => s + f.weight, 0);
  const score = Math.max(0, 100 - penalty);
  const ready = spf.found && dkim.length > 0 && dmarc.found && !isFreeProvider;

  return {
    ok: true,
    domain,
    score,
    ready_for_bulk: ready,
    summary: ready
      ? 'SPF, DKIM and DMARC are all in place — this domain meets the Gmail/Yahoo bulk-sender requirements.'
      : 'This domain does not yet meet the Gmail/Yahoo bulk-sender requirements. Fix the critical items below first.',
    spf,
    dkim,
    dmarc,
    mx,
    mta_sts: hasMtaSts,
    tls_rpt: hasTlsRpt,
    bimi: hasBimi,
    ip: ipReport,
    free_provider: isFreeProvider,
    findings: findings.sort((a, b) => b.weight - a.weight),
  };
}

export { registrableDomain };
