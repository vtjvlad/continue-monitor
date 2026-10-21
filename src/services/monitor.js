import { getSessions } from '../adapters/continue-sessions.js';
import { getProcesses } from '../adapters/continue-processes.js';
import { buildActiveSnapshot } from './agent-status.js';

export async function collectStatus() {
  const [sessionData, processData] = await Promise.all([
    getSessions(),
    getProcesses(),
  ]);

  const active = await buildActiveSnapshot({
    sessions: sessionData,
    processes: processData,
  });

  return {
    collectedAt: new Date().toISOString(),
    sessions: sessionData,
    processes: processData,
    active,
  };
}
