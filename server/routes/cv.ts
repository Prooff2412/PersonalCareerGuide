import { Router, Request, Response } from 'express';
import { getTemplates, generateCV } from '../services/cvService';

const router = Router();
router.get('/templates', (req: Request, res: Response) => {
  const templates = getTemplates();
  res.json({ templates });
});

router.post('/create', (req: Request, res: Response) => {
  const cv = generateCV();
  res.json({ cv });
});

export default router;
