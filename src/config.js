import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}

export const config = Object.freeze({
  host: process.env.MONITOR_HOST || '127.0.0.1',
  port: Number(process.env.MONITOR_PORT || 8788),
  token: process.env.MONITOR_TOKEN || '',
  sessionsDir: path.join(os.homedir(), '.continue', 'sessions'),
  sessionsIndex: path.join(os.homedir(), '.continue', 'sessions', 'sessions.json'),
});

if (!config.token || config.token.length < 32) {
  throw new Error('MONITOR_TOKEN is missing or too short');
}

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error('Invalid MONITOR_PORT');
}

if (!['127.0.0.1', '::1'].includes(config.host)) {
  throw new Error('Continue Monitor must listen on loopback only');
}
