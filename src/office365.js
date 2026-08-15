// Microsoft 365 / Office 365 tenant sending: Graph sendMail (app) or SMTP AUTH.

export const OFFICE_SEND_MODES = [
  {
    id: 'graph',
    label: 'Microsoft Graph (recommended)',
    blurb: 'App registration with Mail.Send. Sends as a mailbox in your tenant. No SMTP AUTH required.',
  },
  {
    id: 'smtp_auth',
    label: 'SMTP AUTH (smtp.office365.com)',
    blurb: 'Authenticated SMTP for a licensed mailbox. Must be enabled on the tenant and the mailbox.',
  },
];

export const GRAPH_PERMISSIONS = [
  { id: 'Mail.Send', required: true, why: 'Send as a user in your tenant via Graph.' },
  { id: 'User.Read.All', required: false, why: 'List licensed mailboxes to pick a From address.' },
  { id: 'Organization.Read.All', required: false, why: 'Show the tenant display name after verify.' },
];

export const OFFICE_SETUP = {
  entra: [
    'In Entra admin center open App registrations → New registration (single tenant).',
    'Copy Application (client) ID and Directory (tenant) ID into this panel.',
    'Certificates & secrets → New client secret. Paste the secret here once — it is not shown again in Azure.',
    'API permissions → Microsoft Graph → Application permissions → Mail.Send. Optionally User.Read.All and Organization.Read.All.',
    'Click Grant admin consent for your tenant.',
    'Exchange: the From mailbox must exist and be licensed. Graph sends as that UPN, not as a shared random address.',
  ],
  smtp: [
    'SMTP AUTH is off by default on many tenants. Enable it only for mailboxes that must use SMTP.',
    'Exchange admin center → Recipients → Mailboxes → mailbox → Manage email apps → Authenticated SMTP = On.',
    'Or PowerShell: Set-CASMailbox -Identity user@domain.com -SmtpClientAuthenticationDisabled $false',
    'Tenant-wide (only if you intend every mailbox to use SMTP): Set-TransportConfig -SmtpClientAuthenticationDisabled $false',
    'Username is the mailbox UPN. Password is the mailbox password or an app password if you require MFA.',
    'Host smtp.office365.com, port 587, STARTTLS. SPF/DKIM/DMARC should already be on the sending domain.',
  ],
  consentUrl: (tenantId, clientId) =>
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/adminconsent?client_id=${encodeURIComponent(clientId)}`,
};

export const OFFICE_SMTP = {
  host: 'smtp.office365.com',
  port: 587,
  secure: false,
};

export function tokenUrl(tenantIdOrDomain) {
  const id = String(tenantIdOrDomain || '').trim();
  if (!id) throw new Error('Tenant ID or domain is required');
  return `https://login.microsoftonline.com/${encodeURIComponent(id)}/oauth2/v2.0/token`;
}

export function graphUrl(path) {
  const p = String(path || '').replace(/^\//, '');
  return `https://graph.microsoft.com/v1.0/${p}`;
}

export function buildGraphMessage({ from, to, subject, html, text, headers }) {
  const message = {
    subject: subject || '',
    body: {
      contentType: html ? 'HTML' : 'Text',
      content: html || text || '',
    },
    toRecipients: [{ emailAddress: { address: String(to) } }],
  };
  if (from) {
    message.from = { emailAddress: { address: from, name: undefined } };
  }
  const extra = [];
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      if (!value) continue;
      extra.push({ name, value: String(value) });
    }
  }
  if (extra.length) message.internetMessageHeaders = extra;
  return { message, saveToSentItems: true };
}

export async function getAppToken(tenant) {
  const id = tenant.tenant_id || tenant.tenant_domain;
  if (!tenant.client_id || !tenant.client_secret) {
    throw new Error('Client ID and client secret are required');
  }
  const res = await fetch(tokenUrl(id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: tenant.client_id,
      client_secret: tenant.client_secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Token request failed (${res.status})`);
  }
  if (!data.access_token) throw new Error('Token response had no access_token');
  return {
    access_token: data.access_token,
    expires_in: data.expires_in || 3600,
  };
}

export async function graphFetch(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(graphUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data.error?.message || data.error_description || text.slice(0, 300) || `Graph error (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export async function sendViaGraph(tenant, { from, to, subject, html, text, headers, token }) {
  const access = token || (await getAppToken(tenant)).access_token;
  const mailbox = from || tenant.default_mailbox;
  if (!mailbox) throw new Error('From mailbox UPN is required for Graph send');
  const payload = buildGraphMessage({ from: mailbox, to, subject, html, text, headers });
  await graphFetch(access, `users/${encodeURIComponent(mailbox)}/sendMail`, {
    method: 'POST',
    body: payload,
  });
  return `graph:${mailbox}`;
}

export async function fetchOrganization(token) {
  const data = await graphFetch(token, 'organization?$select=id,displayName,verifiedDomains');
  const org = data.value?.[0] || {};
  const domains = (org.verifiedDomains || []).map((d) => d.name).filter(Boolean);
  return { id: org.id || '', displayName: org.displayName || '', domains };
}

export async function listGraphMailboxes(token) {
  const data = await graphFetch(
    token,
    'users?$select=id,displayName,mail,userPrincipalName,accountEnabled&$top=50'
  );
  return (data.value || [])
    .map((u) => ({
      id: u.id,
      displayName: u.displayName || '',
      email: u.mail || u.userPrincipalName || '',
      upn: u.userPrincipalName || '',
      enabled: u.accountEnabled !== false,
    }))
    .filter((u) => u.email.includes('@'));
}

export function diagnoseOfficeError(message) {
  const m = String(message || '');
  if (/AADSTS700016|Application with identifier/i.test(m)) {
    return 'Client ID is not from this tenant. Check the app registration.';
  }
  if (/AADSTS7000215|Invalid client secret/i.test(m)) {
    return 'Client secret is wrong or expired. Create a new secret in Entra.';
  }
  if (/AADSTS70011|invalid_scope/i.test(m)) {
    return 'Scope must be https://graph.microsoft.com/.default for app-only send.';
  }
  if (/Authorization_RequestDenied|Insufficient privileges|ErrorAccessDenied/i.test(m)) {
    return 'Grant admin consent for Mail.Send (application) on the app.';
  }
  if (/MailboxNotEnabledForRESTAPI|ResourceNotFound|ErrorInvalidUser/i.test(m)) {
    return 'From address is not a licensed mailbox in this tenant.';
  }
  if (/SmtpClientAuthenticationDisabled|5\.7\.57|5\.7\.3/i.test(m)) {
    return 'SMTP AUTH is disabled for this mailbox or tenant. Turn it on in Exchange, or use Graph instead.';
  }
  if (/AADSTS50034|does not exist/i.test(m)) {
    return 'Tenant ID / domain was not found. Use the Directory (tenant) ID GUID.';
  }
  return '';
}

export function officeSetupNotes() {
  return {
    modes: OFFICE_SEND_MODES,
    permissions: GRAPH_PERMISSIONS,
    entra: OFFICE_SETUP.entra,
    smtp: OFFICE_SETUP.smtp,
    smtp_host: OFFICE_SMTP,
  };
}
