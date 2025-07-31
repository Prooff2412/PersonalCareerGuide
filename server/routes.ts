import { Router, Request, Response } from 'express';

const router = Router();

/**
 * Health check endpoint.
 * Returnerer status 'ok', så du kan teste at serveren kører.
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// TODO: Registrér flere ruter her, fx:
// router.use('/career', careerRoutes);

export default router;
