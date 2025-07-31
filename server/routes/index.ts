import { Router } from 'express';
import healthRouter from './health';
import cvRouter from './cv';
import applicationRouter from './application';

const router = Router();
router.use('/api', healthRouter);
router.use('/api/cv', cvRouter);
router.use('/api/application', applicationRouter);

export default router;
