/** First-class SMTP / ESP presets. Credentials must be for accounts you own. */
export const SMTP_CATALOG = [
  {
    id: 'ses-us-east-1',
    group: 'esp',
    label: 'Amazon SES (N. Virginia)',
    host: 'email-smtp.us-east-1.amazonaws.com',
    port: 587, secure: false, kind: 'ses', region: 'us-east-1',
    usernameHint: 'SMTP username from SES',
    passwordHint: 'SMTP password from SES',
  },
  {
    id: 'ses-ap-northeast-1',
    group: 'japan',
    label: 'Amazon SES Japan (Tokyo)',
    host: 'email-smtp.ap-northeast-1.amazonaws.com',
    port: 587, secure: false, kind: 'ses', region: 'ap-northeast-1',
    usernameHint: 'SES SMTP username',
    passwordHint: 'SES SMTP password',
  },
  {
    id: 'ses-ap-northeast-3',
    group: 'japan',
    label: 'Amazon SES Japan (Osaka)',
    host: 'email-smtp.ap-northeast-3.amazonaws.com',
    port: 587, secure: false, kind: 'ses', region: 'ap-northeast-3',
    usernameHint: 'SES SMTP username',
    passwordHint: 'SES SMTP password',
  },
  {
    id: 'sendgrid',
    group: 'esp',
    label: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: 587, secure: false, kind: 'sendgrid',
    usernameHint: 'apikey',
    passwordHint: 'SendGrid API key',
    defaultUsername: 'apikey',
  },
  {
    id: 'mailchimp',
    group: 'esp',
    label: 'Mailchimp Transactional (Mandrill)',
    host: 'smtp.mandrillapp.com',
    port: 587, secure: false, kind: 'mandrill',
    usernameHint: 'Mandrill account email',
    passwordHint: 'Mandrill API key',
  },
  {
    id: 'mailgun',
    group: 'esp',
    label: 'Mailgun',
    host: 'smtp.mailgun.org',
    port: 587, secure: false, kind: 'mailgun',
    usernameHint: 'postmaster@yourdomain',
    passwordHint: 'Mailgun SMTP password',
  },
  {
    id: 'postmark',
    group: 'esp',
    label: 'Postmark',
    host: 'smtp.postmarkapp.com',
    port: 587, secure: false, kind: 'postmark',
    usernameHint: 'Server API token',
    passwordHint: 'Same server API token',
  },
  {
    id: 'sparkpost',
    group: 'esp',
    label: 'SparkPost',
    host: 'smtp.sparkpostmail.com',
    port: 587, secure: false, kind: 'sparkpost',
    usernameHint: 'SMTP_Injection',
    passwordHint: 'SparkPost API key',
    defaultUsername: 'SMTP_Injection',
  },
  {
    id: 'brevo',
    group: 'esp',
    label: 'Brevo (Sendinblue)',
    host: 'smtp-relay.brevo.com',
    port: 587, secure: false, kind: 'brevo',
    usernameHint: 'Brevo login email',
    passwordHint: 'SMTP key',
  },
  {
    id: 'mailjet',
    group: 'esp',
    label: 'Mailjet',
    host: 'in-v3.mailjet.com',
    port: 587, secure: false, kind: 'mailjet',
    usernameHint: 'API key',
    passwordHint: 'Secret key',
  },
  {
    id: 'office365',
    group: 'esp',
    label: 'Microsoft 365 / Outlook',
    host: 'smtp.office365.com',
    port: 587, secure: false, kind: 'smtp',
    usernameHint: 'full mailbox address',
    passwordHint: 'mailbox or app password',
  },
  {
    id: 'sakura',
    group: 'japan',
    label: 'Sakura Internet (sakura.ne.jp)',
    host: 'smtp.sakura.ne.jp',
    port: 587, secure: false, kind: 'japan',
    usernameHint: 'mailbox@yourdomain',
    passwordHint: 'mailbox password',
  },
  {
    id: 'lolipop',
    group: 'japan',
    label: 'Lolipop',
    host: 'smtp.lolipop.jp',
    port: 587, secure: false, kind: 'japan',
    usernameHint: 'Lolipop mail account',
    passwordHint: 'mailbox password',
  },
  {
    id: 'xserver',
    group: 'japan',
    label: 'Xserver',
    host: 'sv123.xserver.jp',
    port: 587, secure: false, kind: 'japan',
    usernameHint: 'Replace host with your svXXX.xserver.jp',
    passwordHint: 'mailbox password',
  },
  {
    id: 'value-domain',
    group: 'japan',
    label: 'Value Domain',
    host: 'smtp.valuedomain.com',
    port: 587, secure: false, kind: 'japan',
    usernameHint: 'mail account',
    passwordHint: 'mailbox password',
  },
  {
    id: 'muumuu',
    group: 'japan',
    label: 'GMO MuuMuu Mail',
    host: 'smtp.muumuu-mail.com',
    port: 587, secure: false, kind: 'japan',
    usernameHint: 'full mailbox address',
    passwordHint: 'mailbox password',
  },
  {
    id: 'heteml',
    group: 'japan',
    label: 'Heteml',
    host: 'mail.heteml.jp',
    port: 587, secure: false, kind: 'japan',
    usernameHint: 'mailbox@yourdomain',
    passwordHint: 'mailbox password',
  },
  {
    id: 'conoha',
    group: 'japan',
    label: 'ConoHa (set host from control panel)',
    host: '',
    port: 587, secure: false, kind: 'japan',
    usernameHint: 'mailbox@yourdomain',
    passwordHint: 'mailbox password',
  },
  {
    id: 'gmail-smtp',
    group: 'esp',
    label: 'Gmail SMTP (use Gmail pool instead)',
    host: 'smtp.gmail.com',
    port: 587, secure: false, kind: 'gmail',
    usernameHint: 'you@gmail.com',
    passwordHint: 'App password',
  },
  {
    id: 'custom',
    group: 'custom',
    label: 'Custom SMTP',
    host: '',
    port: 587, secure: false, kind: 'smtp',
    usernameHint: 'SMTP username',
    passwordHint: 'SMTP password',
  },
];

export function smtpById(id) {
  return SMTP_CATALOG.find((p) => p.id === id) || null;
}

export function smtpGroups() {
  const groups = [
    { id: 'esp', label: 'AWS / SendGrid / Mailchimp / others' },
    { id: 'japan', label: 'Japan SMTP' },
    { id: 'custom', label: 'Custom' },
  ];
  return groups.map((g) => ({ ...g, providers: SMTP_CATALOG.filter((p) => p.group === g.id) }));
}

/** Build a socks5:// URL for Nodemailer. Empty if no host. */
export function socks5Url({ host, port = 1080, user = '', pass = '' } = {}) {
  const h = String(host || '').trim();
  if (!h) return '';
  if (/[\s/]/.test(h) || h.includes('@')) throw new Error('Invalid SOCKS5 host');
  const p = parseInt(port, 10) || 1080;
  if (p < 1 || p > 65535) throw new Error('Invalid SOCKS5 port');
  const u = String(user || '');
  const pw = String(pass || '');
  const auth = u ? `${encodeURIComponent(u)}:${encodeURIComponent(pw)}@` : '';
  return `socks5://${auth}${h}:${p}`;
}
