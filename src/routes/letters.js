import { Router } from 'express';
import { requireAuth, requireFeature } from '../auth.js';
import { generateLetter, generateVariations, letterCatalog, LETTER_VARIANTS, SAMPLE_FIELDS } from '../letters.js';
import { PLACEHOLDERS } from '../placeholders.js';

const router = Router();
router.use(requireAuth, requireFeature('compose'));

router.get('/', (req, res) => {
  res.json({ letters: letterCatalog(), placeholders: PLACEHOLDERS, variants: LETTER_VARIANTS });
});

router.post('/generate', (req, res) => {
  const { kind, fields = {}, locale = 'en', variant = 1 } = req.body || {};
  if (!kind) return res.status(400).json({ error: 'kind is required' });
  try {
    res.json(generateLetter(kind, fields, locale, { variant }));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

router.post('/variations', (req, res) => {
  const { kind, fields = {}, locale = 'en' } = req.body || {};
  if (!kind) return res.status(400).json({ error: 'kind is required' });
  try {
    res.json({ variations: generateVariations(kind, { ...SAMPLE_FIELDS, ...fields }, locale) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

export default router;
