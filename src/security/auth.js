import { config } from '../config.js';

export function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer (.+)$/i);

  if (!match || match[1].length !== config.token.length) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let difference = 0;
  for (let i = 0; i < config.token.length; i++) {
    difference |= match[1].charCodeAt(i) ^ config.token.charCodeAt(i);
  }

  if (difference !== 0) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
