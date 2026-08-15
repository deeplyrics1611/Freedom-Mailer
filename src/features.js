export const CLIENT_FEATURES = [
  { id: 'compose', label: 'Compose' },
  { id: 'senders', label: 'Senders / ESP' },
  { id: 'office365', label: 'Office 365' },
  { id: 'campaigns', label: 'Campaigns & lists' },
  { id: 'links', label: 'Tracking links' },
  { id: 'deliverability', label: 'Deliverability' },
  { id: 'ai', label: 'AI help' },
  { id: 'apikeys', label: 'API keys' },
];

const allOn = Object.fromEntries(CLIENT_FEATURES.map((f) => [f.id, true]));
const allOff = Object.fromEntries(CLIENT_FEATURES.map((f) => [f.id, false]));

export const FEATURE_PRESETS = [
  { id: 'full', label: 'All tools', features: { ...allOn } },
  {
    id: 'mailer',
    label: 'Mailer only',
    features: { ...allOff, compose: true, senders: true, office365: true, deliverability: true, ai: true },
  },
  {
    id: 'campaigns',
    label: 'Campaigns',
    features: { ...allOff, compose: true, senders: true, campaigns: true, links: true, deliverability: true, ai: true },
  },
  { id: 'lockdown', label: 'Lockdown', features: { ...allOff } },
];

export function applyPreset(id) {
  const preset = FEATURE_PRESETS.find((p) => p.id === id);
  return preset ? parseFeatures(preset.features) : null;
}

export function parseFeatures(raw) {
  let extra = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) extra = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      extra = JSON.parse(raw);
    } catch {
      extra = {};
    }
  }
  const out = {};
  for (const { id } of CLIENT_FEATURES) out[id] = extra[id] !== false;
  return out;
}

export function serializeFeatures(features) {
  const parsed = parseFeatures(features);
  return JSON.stringify(parsed);
}

export function hasFeature(user, name) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return parseFeatures(user.features)[name] !== false;
}
