import { Router, Request, Response } from 'express';
const router = Router();
router.post('/create', (req: Request, res: Response) => {
  res.json({ message: 'Application generation is not implemented yet.' });
});
export default router;
