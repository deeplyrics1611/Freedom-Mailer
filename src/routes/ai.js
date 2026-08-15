import { Router } from 'express';
import { requireAuth, requireFeature } from '../auth.js';
import { aiEnabled, runAi } from '../ai.js';

const router = Router();
router.use(requireAuth, requireFeature('ai'));

router.get('/status', (req, res) => {
  res.json({ enabled: aiEnabled() });
});

router.post('/help', async (req, res) => {
  const {
    action = 'compose',
    prompt = '',
    subject = '',
    html = '',
    text = '',
    language = 'en',
    kind = '',
    fields = {},
  } = req.body || {};
  try {
    const result = await runAi({ action, prompt, subject, html, text, language, kind, fields });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

export default router;
