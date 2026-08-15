import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { generateLetter, letterCatalog } from '../letters.js';
import { PLACEHOLDERS } from '../placeholders.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json({ letters: letterCatalog(), placeholders: PLACEHOLDERS });
});

router.post('/generate', (req, res) => {
  const { kind, fields = {}, locale = 'en' } = req.body || {};
  if (!kind) return res.status(400).json({ error: 'kind is required' });
  try {
    res.json(generateLetter(kind, fields, locale));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

export default router;
