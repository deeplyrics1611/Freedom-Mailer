// Official SMTP presets. These talk to the provider you actually have an
// account with — not open relays, not SOCKS proxies.

export const SENDER_KINDS = [
  {
    id: 'smtp',
    label: 'SMTP',
    blurb: 'Any mail server you own (custom domain, transactional SMTP, VPS).',
  },
  {
    id: 'ovh',
    label: 'OVH',
    blurb: 'OVH / OVHcloud mailbox (smtp.mail.ovh.net).',
  },
  {
    id: 'webmail',
    label: 'Webmail',
    blurb: 'Gmail, Outlook, Yahoo, iCloud, Zoho — sign in with the mailbox SMTP.',
  },
  {
    id: 'japan',
    label: 'Japan mail',
    blurb: 'Yahoo! Mail Japan, Sakura, Xserver, Lolipop, GMO, and other JP hosts.',
  },
  {
    id: 'smtp_sms',
    label: 'SMTP → SMS',
    blurb: 'Email-to-SMS carrier gateway. Recipients need a phone number.',
  },
  {
    id: 'office365',
    label: 'Office 365',
    blurb: 'Your Microsoft 365 tenant via Graph sendMail or smtp.office365.com SMTP AUTH.',
  },
  {
    id: 'mailgun',
    label: 'Mailgun',
    blurb: 'Your Mailgun domain via smtp.mailgun.org or the HTTP messages API.',
  },
  {
    id: 'sendgrid',
    label: 'SendGrid',
    blurb: 'Your SendGrid account via smtp.sendgrid.net or the v3 mail/send API.',
  },
  {
    id: 'postfix',
    label: 'Postfix',
    blurb: 'Your own Postfix / mail-relay host. Auth is optional if the server allowlists this IP.',
  },
  {
    id: 'aws',
    label: 'AWS SES',
    blurb: 'Amazon SES in your AWS account — SMTP credentials or SigV4 HTTP API.',
  },
  {
    id: 'gcp',
    label: 'Google Cloud (us-east4)',
    blurb: 'Google Workspace SMTP relay from Google Cloud us-east4 (smtp-relay.gmail.com), or Gmail SMTP with an app password.',
  },
];

export const SMTP_PRESETS = [
  {
    id: 'custom',
    kind: 'smtp',
    label: 'Custom SMTP',
    host: '',
    port: 587,
    secure: false,
    hint: 'Use the host your DNS / provider documents. Port 587 (STARTTLS) or 465 (TLS).',
  },
  {
    id: 'ovh',
    kind: 'ovh',
    label: 'OVH Mail',
    host: 'smtp.mail.ovh.net',
    port: 587,
    secure: false,
    hint: 'Username is the full OVH email address. App may need SMTP enabled in the OVH webmail.',
  },
  {
    id: 'ovh-ssl',
    kind: 'ovh',
    label: 'OVH Mail (SSL 465)',
    host: 'ssl0.ovh.net',
    port: 465,
    secure: true,
    hint: 'Alternate OVH endpoint using implicit TLS on 465.',
  },
  {
    id: 'gmail',
    kind: 'webmail',
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    hint: 'Use an App Password (Google Account → Security). Regular account passwords are blocked.',
  },
  {
    id: 'outlook',
    kind: 'webmail',
    label: 'Outlook / Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    hint: 'Username is the full Microsoft address. SMTP AUTH must be enabled for the mailbox.',
  },
  {
    id: 'yahoo',
    kind: 'webmail',
    label: 'Yahoo Mail',
    host: 'smtp.mail.yahoo.com',
    port: 587,
    secure: false,
    hint: 'Generate an app password in Yahoo Account Security.',
  },
  {
    id: 'icloud',
    kind: 'webmail',
    label: 'iCloud Mail',
    host: 'smtp.mail.me.com',
    port: 587,
    secure: false,
    hint: 'Requires an app-specific password from appleid.apple.com.',
  },
  {
    id: 'zoho',
    kind: 'webmail',
    label: 'Zoho Mail',
    host: 'smtp.zoho.com',
    port: 587,
    secure: false,
    hint: 'Username is the full Zoho address.',
  },
  {
    id: 'yahoo-jp',
    kind: 'japan',
    label: 'Yahoo! Mail Japan',
    host: 'smtp.mail.yahoo.co.jp',
    port: 465,
    secure: true,
    hint: 'Use the Yahoo Japan mailbox and an app password. Send via Yahoo’s official SMTP, not a proxy.',
  },
  {
    id: 'gmail-jp',
    kind: 'japan',
    label: 'Gmail (JP account)',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    hint: 'Same as Gmail: App Password required. Works for googlemail.com / gmail.com JP accounts.',
  },
  {
    id: 'outlook-jp',
    kind: 'japan',
    label: 'Outlook Japan',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    hint: 'Microsoft 365 / Outlook.jp mailboxes via official SMTP AUTH.',
  },
  {
    id: 'sakura',
    kind: 'japan',
    label: 'Sakura Internet',
    host: 'initial.sakura.ne.jp',
    port: 587,
    secure: false,
    hint: 'Replace host with your Sakura initial domain if different. Username is the full mail address.',
  },
  {
    id: 'xserver',
    kind: 'japan',
    label: 'Xserver',
    host: 'sv000.xserver.jp',
    port: 587,
    secure: false,
    hint: 'Replace sv000 with your server ID from the Xserver panel (e.g. sv1234.xserver.jp).',
  },
  {
    id: 'lolipop',
    kind: 'japan',
    label: 'Lolipop',
    host: 'smtp.lolipop.jp',
    port: 587,
    secure: false,
    hint: 'Username is the full Lolipop mail address.',
  },
  {
    id: 'gmo',
    kind: 'japan',
    label: 'GMO / ConoHa',
    host: 'mail.lolipop.jp',
    port: 587,
    secure: false,
    hint: 'Check the GMO panel for the exact SMTP host assigned to your contract.',
  },
  {
    id: 'biglobe',
    kind: 'japan',
    label: 'Biglobe',
    host: 'mail.biglobe.ne.jp',
    port: 587,
    secure: false,
    hint: 'Biglobe mail SMTP. Username is usually the full address.',
  },
  {
    id: 'ocn',
    kind: 'japan',
    label: 'OCN Mail',
    host: 'smtp.ocn.ne.jp',
    port: 587,
    secure: false,
    hint: 'OCN mailbox SMTP. Authenticate with the OCN mail account.',
  },
  {
    id: 'office365-smtp',
    kind: 'office365',
    label: 'Microsoft 365 SMTP AUTH',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    hint: 'Prefer the Office 365 admin page for tenant Graph apps. SMTP AUTH must be enabled on the mailbox.',
  },
  {
    id: 'smtp-sms',
    kind: 'smtp_sms',
    label: 'SMTP-to-SMS gateway',
    host: '',
    port: 587,
    secure: false,
    hint: 'Sends a short text as email to number@carrier-gateway. Set the gateway domain on the sender (e.g. txt.att.net).',
  },
  {
    id: 'mailgun-smtp',
    kind: 'mailgun',
    auth_mode: 'smtp',
    label: 'Mailgun SMTP',
    host: 'smtp.mailgun.org',
    port: 587,
    secure: false,
    hint: 'Username is usually postmaster@YOUR_DOMAIN. Password is the SMTP password from the Mailgun domain settings. EU accounts use smtp.eu.mailgun.org.',
  },
  {
    id: 'mailgun-api',
    kind: 'mailgun',
    auth_mode: 'api',
    label: 'Mailgun HTTP API',
    host: 'api.mailgun.net',
    port: 443,
    secure: true,
    hint: 'Username = sending domain (mg.yourdomain.com). Password = Private API key (key-…). From address must be on that domain.',
  },
  {
    id: 'sendgrid-smtp',
    kind: 'sendgrid',
    auth_mode: 'smtp',
    label: 'SendGrid SMTP',
    host: 'smtp.sendgrid.net',
    port: 587,
    secure: false,
    username: 'apikey',
    hint: 'Username must be the literal word apikey. Password is a SendGrid API key with Mail Send permission.',
  },
  {
    id: 'sendgrid-api',
    kind: 'sendgrid',
    auth_mode: 'api',
    label: 'SendGrid HTTP API',
    host: 'api.sendgrid.com',
    port: 443,
    secure: true,
    username: 'apikey',
    hint: 'Password is a SendGrid API key. From email must be a verified SendGrid sender identity.',
  },
  {
    id: 'postfix',
    kind: 'postfix',
    auth_mode: 'smtp',
    label: 'Postfix / local relay',
    host: '',
    port: 25,
    secure: false,
    hint: 'Point at your Postfix host. Leave username and password blank if the server allowlists this machine (mynetworks). Prefer 587 + STARTTLS when auth is enabled.',
  },
  {
    id: 'postfix-submission',
    kind: 'postfix',
    auth_mode: 'smtp',
    label: 'Postfix submission (587)',
    host: '',
    port: 587,
    secure: false,
    hint: 'Submission port with STARTTLS. Use mailbox credentials if smtpd_sasl_auth is on.',
  },
  {
    id: 'aws-ses-smtp',
    kind: 'aws',
    auth_mode: 'smtp',
    label: 'Amazon SES SMTP',
    host: 'email-smtp.us-east-1.amazonaws.com',
    port: 587,
    secure: false,
    hint: 'Create SMTP credentials in the SES console (not your IAM password). Pick the region that matches the verified identity.',
  },
  {
    id: 'aws-ses-api',
    kind: 'aws',
    auth_mode: 'api',
    label: 'Amazon SES HTTP API',
    host: 'email.us-east-1.amazonaws.com',
    port: 443,
    secure: true,
    hint: 'IAM access key + secret with ses:SendEmail. Username = Access key ID. From address must be a verified SES identity in that region.',
  },
  {
    id: 'gcp-relay',
    kind: 'gcp',
    auth_mode: 'smtp',
    label: 'Google Cloud (us-east4)',
    host: 'smtp-relay.gmail.com',
    port: 587,
    secure: false,
    region: 'us-east4',
    hint: 'Workspace SMTP relay. From address must be in your Google Workspace domain. Auth is optional if this machine’s IP is allowlisted in Apps → Gmail → SMTP relay (typical on GCE us-east4). Otherwise use the Google account + app password.',
  },
  {
    id: 'gcp-relay-ssl',
    kind: 'gcp',
    auth_mode: 'smtp',
    label: 'Google Cloud relay (465)',
    host: 'smtp-relay.gmail.com',
    port: 465,
    secure: true,
    region: 'us-east4',
    hint: 'Same SMTP relay over implicit TLS. Use when 587 is blocked. IP allowlist or Google username + app password.',
  },
  {
    id: 'gcp-gmail',
    kind: 'gcp',
    auth_mode: 'smtp',
    label: 'Gmail SMTP (app password)',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    region: 'us-east4',
    hint: 'smtp.gmail.com. Username is the full Gmail / Workspace address. Password must be a Google App Password, not the account password.',
  },
];

export const SMS_GATEWAYS = [
  { id: 'att', label: 'AT&T', domain: 'txt.att.net' },
  { id: 'tmobile', label: 'T-Mobile', domain: 'tmomail.net' },
  { id: 'verizon', label: 'Verizon', domain: 'vtext.com' },
  { id: 'sprint', label: 'Sprint / Boost', domain: 'messaging.sprintpcs.com' },
  { id: 'uscellular', label: 'U.S. Cellular', domain: 'email.uscc.net' },
  { id: 'googlefi', label: 'Google Fi', domain: 'msg.fi.google.com' },
  { id: 'custom', label: 'Custom domain / pattern', domain: '' },
];

export const MAILGUN_REGIONS = [
  { id: 'us', label: 'US — smtp.mailgun.org / api.mailgun.net', smtpHost: 'smtp.mailgun.org', apiHost: 'api.mailgun.net' },
  { id: 'eu', label: 'EU — smtp.eu.mailgun.org / api.eu.mailgun.net', smtpHost: 'smtp.eu.mailgun.org', apiHost: 'api.eu.mailgun.net' },
];

export const GCP_REGIONS = [
  { id: 'us-east4', label: 'us-east4 (N. Virginia)' },
  { id: 'us-east1', label: 'us-east1 (South Carolina)' },
  { id: 'us-central1', label: 'us-central1 (Iowa)' },
  { id: 'us-west1', label: 'us-west1 (Oregon)' },
  { id: 'europe-west1', label: 'europe-west1 (Belgium)' },
  { id: 'europe-west2', label: 'europe-west2 (London)' },
  { id: 'asia-northeast1', label: 'asia-northeast1 (Tokyo)' },
  { id: 'asia-southeast1', label: 'asia-southeast1 (Singapore)' },
];

export const AWS_SES_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-north-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-south-1',
  'sa-east-1',
  'me-south-1',
  'af-south-1',
];

export function awsSesSmtpHost(region) {
  return `email-smtp.${region || 'us-east-1'}.amazonaws.com`;
}

export function awsSesApiHost(region) {
  return `email.${region || 'us-east-1'}.amazonaws.com`;
}

export function presetById(id) {
  return SMTP_PRESETS.find((p) => p.id === id) || null;
}

export function applyProviderDefaults({ kind, auth_mode = '', region = '', host = '', port, username = '' }) {
  const mode = auth_mode || (kind === 'mailgun' || kind === 'sendgrid' || kind === 'aws' ? 'smtp' : '');
  let hostVal = host;
  let portVal = port;
  let userVal = username;
  let regionVal = region;
  let secureVal;

  if (kind === 'mailgun') {
    regionVal = regionVal === 'eu' ? 'eu' : 'us';
    const r = MAILGUN_REGIONS.find((x) => x.id === regionVal);
    if (mode === 'api') {
      hostVal = hostVal && hostVal.startsWith('api') ? hostVal : r.apiHost;
      portVal = 443;
      secureVal = true;
    } else {
      hostVal = hostVal && hostVal.startsWith('smtp') ? hostVal : r.smtpHost;
      portVal = portVal || 587;
      secureVal = Number(portVal) === 465;
    }
  }

  if (kind === 'sendgrid') {
    if (mode === 'api') {
      hostVal = 'api.sendgrid.com';
      portVal = 443;
      secureVal = true;
    } else {
      hostVal = hostVal || 'smtp.sendgrid.net';
      portVal = portVal || 587;
      secureVal = Number(portVal) === 465;
    }
    userVal = userVal || 'apikey';
  }

  if (kind === 'aws') {
    regionVal = regionVal || 'us-east-1';
    if (mode === 'api') {
      hostVal = awsSesApiHost(regionVal);
      portVal = 443;
      secureVal = true;
    } else {
      hostVal = awsSesSmtpHost(regionVal);
      portVal = portVal || 587;
      secureVal = Number(portVal) === 465;
    }
  }

  if (kind === 'gcp') {
    regionVal = regionVal || 'us-east4';
    hostVal = hostVal || 'smtp-relay.gmail.com';
    portVal = portVal || 587;
    if (secureVal === undefined) secureVal = Number(portVal) === 465;
  }

  if (kind === 'postfix') {
    portVal = portVal || 25;
    if (secureVal === undefined) secureVal = Number(portVal) === 465;
  }

  return {
    host: hostVal,
    port: portVal,
    username: userVal,
    region: regionVal,
    auth_mode: mode,
    secure: secureVal,
  };
}
