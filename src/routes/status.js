import { Router } from 'express';
import { collectStatus } from '../services/monitor.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await collectStatus());
  } catch (error) {
    next(error);
  }
});

