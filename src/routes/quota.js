import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { buildQuotaReport } from '../quota.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    res.json(await buildQuotaReport(req.user));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

export default router;
