import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { requireAuth } from './security/auth.js';
import statusRouter from './routes/status.js';

const app = express();
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../public');

app.disable('x-powered-by');
app.get('/api/health', requireAuth, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    service: 'continue-monitor',
    time: new Date().toISOString(),
  });
});

app.use('/api/status', requireAuth, statusRouter);
app.use(express.static(publicDir, {
  index: 'index.html',
  dotfiles: 'deny',
  etag: true,
  maxAge: 0,
}));

app.use((error, _req, res, _next) => {
  console.error('[continue-monitor]', error.message);
  res.status(500).json({ error: 'Internal monitor error' });
});

app.listen(config.port, config.host, () => {
  console.log(`Continue Monitor listening on http://${config.host}:${config.port}`);
});
