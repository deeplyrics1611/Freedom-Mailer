import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { db } from '../db.js';
import { checkSpam } from '../spamcheck.js';
import { checkLinks } from '../linkcheck.js';
import { validateEmail, validateMany, parseEmailList } from '../validate.js';
import { PLACEHOLDERS, renderTemplate, sampleVars, contactVars } from '../placeholders.js';
import { RFQ_TEMPLATES } from '../rfqTemplates.js';

const router = Router();
router.use(requireAuth);

router.get('/placeholders', (_req, res) => res.json(PLACEHOLDERS));
router.get('/rfq-templates', (_req, res) => res.json(RFQ_TEMPLATES));

router.post('/preview', (req, res) => {
  const { subject = '', html = '', text = '', extra_vars = {}, contact_id } = req.body || {};
  let vars = sampleVars();
  if (contact_id) {
    const c = db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(
      parseInt(contact_id, 10),
      req.user.id
    );
    if (c) vars = { ...sampleVars(), ...contactVars(c) };
  }
  vars = {
    ...vars,
    ...extra_vars,
    sender_company: extra_vars.sender_company || req.user.company_name || vars.sender_company,
    physical_address: extra_vars.physical_address || req.user.physical_address || vars.physical_address,
    sender_title: extra_vars.sender_title || req.user.sender_title || vars.sender_title,
  };
  res.json({
    subject: renderTemplate(subject, vars),
    html: renderTemplate(html, vars),
    text: renderTemplate(text, vars),
    vars,
  });
});

router.post('/spam-check', (req, res) => {
  const { subject, html, text, from_name, from_email } = req.body || {};
  res.json(checkSpam({ subject, html, text, fromName: from_name, fromEmail: from_email }));
});

router.post('/link-check', async (req, res) => {
  const { html = '', text = '', follow = true } = req.body || {};
  try {
    res.json(await checkLinks({ html, text, follow: follow !== false }));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.post('/validate', async (req, res) => {
  const { email, emails, text, smtp_probe = false } = req.body || {};
  const list = emails || (email ? [email] : parseEmailList(text || ''));
  if (!list.length) return res.status(400).json({ error: 'Provide email, emails[], or text with addresses' });
  if (list.length > 500) return res.status(400).json({ error: 'Max 500 addresses per batch' });
  try {
    const results = await validateMany(list, { smtpProbe: !!smtp_probe });
    const insert = db.prepare(
      `INSERT INTO validations (user_id, email, score, result, reasons, flags_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        insert.run(
          req.user.id,
          r.email,
          r.score,
          r.result,
          JSON.stringify(r.reasons || []),
          JSON.stringify(r.flags || {})
        );
        db.prepare(
          `UPDATE contacts SET validation_status = ?, validation_score = ?, validation_reason = ?,
            validated_at = datetime('now')
           WHERE user_id = ? AND email = ?`
        ).run(r.result, r.score, r.reason || '', req.user.id, r.email);
      }
    });
    tx(results);

    const summary = {
      total: results.length,
      deliverable: results.filter((r) => r.result === 'deliverable').length,
      risky: results.filter((r) => r.result === 'risky').length,
      undeliverable: results.filter((r) => r.result === 'undeliverable').length,
    };
    res.json({ summary, results });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.post('/validate-one', async (req, res) => {
  const { email, smtp_probe = false } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  try {
    res.json(await validateEmail(email, { smtpProbe: !!smtp_probe }));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

export default router;
