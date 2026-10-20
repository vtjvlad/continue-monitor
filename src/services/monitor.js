import { getSessions } from '../adapters/continue-sessions.js';
import { getProcesses } from '../adapters/continue-processes.js';

export async function collectStatus() {
  const [sessionData, processData] = await Promise.all([
    getSessions(),
    getProcesses(),
  ]);

  return {
    collectedAt: new Date().toISOString(),
    sessions: sessionData,
    processes: processData,
  };
}
