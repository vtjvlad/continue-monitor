import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

function isContinueCli(args) {
  // Проверяем путь к реальному CLI, а не произвольное слово в промпте.
  return /(?:^|\s)\/home\/[^/\s]+\/\.nvm\/versions\/node\/[^/\s]+\/lib\/node_modules\/@continuedev\/cli\/dist\/cn\.js(?:\s|$)/.test(args);
}

export async function getProcesses() {
  let stdout;

  try {
    ({ stdout } = await execFileAsync(
      '/usr/bin/ps',
      ['-eo', 'pid=,ppid=,user=,stat=,etime=,args='],
      { timeout: 3000, maxBuffer: 2 * 1024 * 1024 }
    ));
  } catch (error) {
    return { available: false, processes: [], error: error.message };
  }

  const processes = [];

  for (const line of stdout.split(/\r?\n/)) {
    const match = line.trim().match(
      /^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/
    );
    if (!match) continue;

    const [, pidText, ppidText, user, state, elapsed, args] = match;
    if (!isContinueCli(args)) continue;

    const pid = Number(pidText);
    let cwd = null;

    try {
      cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      // Процесс мог завершиться между проверками.
    }

    processes.push({
      pid,
      ppid: Number(ppidText),
      user,
      state,
      elapsed,
      cwd,
      executable: path.basename(args.split(/\s+/)[0]),
    });
  }

  return { available: true, processes, error: null };
}
