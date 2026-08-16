import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { analyzeContent, scrubContent } from '../spamcheck.js';

const router = Router();
router.use(requireAuth);

router.post('/', (req, res) => {
  const report = analyzeContent(req.body || {});
  res.json(report);
});

router.post('/scrub', (req, res) => {
  const out = scrubContent(req.body || {});
  res.json(out);
});

export default router;
