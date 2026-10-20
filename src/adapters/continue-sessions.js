import fs from 'node:fs/promises';
import { config } from '../config.js';

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;

  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeTitle(value) {
  if (typeof value !== 'string') return 'Без названия';

  const title = value.trim();

  if (!title || /<\/?think\b/i.test(title)) {
    return 'Untitled Session';
  }

  return title.slice(0, 160);
}

export async function getSessions() {
  try {
    const content = await fs.readFile(config.sessionsIndex, 'utf8');
    const data = JSON.parse(content);

    if (!Array.isArray(data)) {
      throw new Error('Unexpected sessions index format');
    }

    const sessions = data.map((item) => ({
      id: typeof item.sessionId === 'string' ? item.sessionId : null,
      title: normalizeTitle(item.title),
      dateCreated: normalizeDate(item.dateCreated),
      workspaceDirectory: typeof item.workspaceDirectory === 'string'
        ? item.workspaceDirectory
        : null,
      messageCount: Number.isFinite(item.messageCount)
        ? item.messageCount
        : null,
    })).filter((item) => item.id);

    return {
      available: true,
      count: sessions.length,
      sessions,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      count: 0,
      sessions: [],
      error: error.message,
    };
  }
}
