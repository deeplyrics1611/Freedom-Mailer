import { Router } from 'express';
import { requireAuth, requireFeature } from '../auth.js';
import { parseLeads } from '../leads.js';
import { sampleVars, renderTemplate } from '../placeholders.js';

const router = Router();
router.use(requireAuth, requireFeature('compose'));

router.post('/parse', (req, res) => {
  const { text = '' } = req.body || {};
  const parsed = parseLeads(text);
  res.json({
    leads: parsed.leads,
    invalid: parsed.invalid,
    total: parsed.total,
  });
});

router.post('/preview', (req, res) => {
  const { subject = '', html = '', text = '', lead = null } = req.body || {};
  const vars = sampleVars(lead || {});
  res.json({
    vars,
    subject: renderTemplate(subject, vars),
    html: renderTemplate(html, vars),
    text: renderTemplate(text, vars),
  });
});

export default router;
