import { config } from './config.js';
import { generateLetter, LETTER_KINDS } from './letters.js';
import { htmlToText } from './placeholders.js';

const SYSTEM = `You are a writing assistant inside a permission-based email platform.
You help the user write transactional and opted-in campaign mail for THEIR own organization.

Rules:
- Write as the user's company. Never impersonate DocuSign, Adobe, Microsoft, Google, Zoom, banks, tax agencies, or any other third-party brand.
- Never ask the recipient to confirm a password, wire money, or install software.
- Keep merge fields like {{name}}, {{first_name}}, {{email}}, {{company}} intact when present.
- Return valid email HTML that uses inline CSS and a simple single-column layout (max-width 600px).
- Also provide a matching plain-text version and a subject line.
- Match the requested language (en or ja).
- Output STRICT JSON with keys: subject, html, text, notes.`;

export function aiEnabled() {
  return Boolean(config.openai.apiKey);
}

async function chat(messages) {
  const url = `${config.openai.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.openai.model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `AI provider error (${res.status})`);
  }
  const raw = data.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('AI returned invalid JSON');
  }
}

function localHelp({ action, prompt, subject, html, text, language }) {
  const notes = [];
  if (!aiEnabled()) {
    notes.push(
      'No AI API key is configured. Local help can generate letters and tidy subjects; set OPENAI_API_KEY for full rewrite/translate.'
    );
  }

  if (action === 'placeholders') {
    notes.push(
      'Recipient fields: {{name}} {{first_name}} {{last_name}} {{email}} {{phone}} {{company}} {{title}} {{custom1}} {{custom2}}. Fallback: {{first_name|there}}.'
    );
    return { subject, html, text, notes };
  }

  if (action === 'subject' && html) {
    const plain = htmlToText(html).replace(/\s+/g, ' ').slice(0, 90);
    return {
      subject: subject || plain,
      html,
      text: text || htmlToText(html),
      notes: [...notes, 'Suggested a subject from the letter body.'],
    };
  }

  if (action === 'text') {
    return {
      subject,
      html,
      text: htmlToText(html || ''),
      notes: [...notes, 'Plain text generated from HTML.'],
    };
  }

  return {
    subject,
    html,
    text: text || htmlToText(html || ''),
    notes: [...notes, prompt ? `Prompt noted locally (no model): ${prompt.slice(0, 120)}` : ''],
  };
}

export async function runAi({
  action = 'compose',
  prompt = '',
  subject = '',
  html = '',
  text = '',
  language = 'en',
  kind = '',
  fields = {},
}) {
  if (kind && LETTER_KINDS.some((k) => k.id === kind) && action === 'compose' && !html) {
    const letter = generateLetter(kind, fields, language);
    if (!aiEnabled()) {
      return { ...letter, notes: ['Generated from the built-in letter. Add OPENAI_API_KEY to rewrite in your voice.'] };
    }
    // Seed the model with the generated letter so it can polish, not invent a brand clone.
    html = letter.html;
    subject = letter.subject;
    text = letter.text;
  }

  if (!aiEnabled()) return localHelp({ action, prompt, subject, html, text, language });

  const user = {
    action,
    language,
    prompt,
    subject,
    html,
    text,
    kind,
    fields,
  };

  const result = await chat([
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Action: ${action}. Language: ${language}.\nUser prompt: ${prompt || '(none)'}\nJSON payload:\n${JSON.stringify(user)}`,
    },
  ]);

  return {
    subject: result.subject || subject,
    html: result.html || html,
    text: result.text || text || htmlToText(result.html || html || ''),
    notes: result.notes || '',
  };
}
