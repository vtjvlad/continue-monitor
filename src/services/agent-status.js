import {
  getSessionMetrics,
  listSessionFilesMeta,
  buildOverlaysFromSignals,
  buildOutcomesFromSignals,
} from '../adapters/continue-session-metrics.js';

function emptyOverlays() {
  return buildOverlaysFromSignals(null, { processCount: 0 });
}

function emptyOutcomes() {
  return buildOutcomesFromSignals(null);
}

const STATUS_LABELS = {
  idle: 'Нет активного агента',
  waiting: 'Ожидает ввода',
  thinking: 'Размышляет',
  planning: 'Планирует',
  reading: 'Читает файлы',
  analyzing: 'Анализирует',
  aligning: 'Согласование',
  awaiting_confirmation: 'Ждёт подтверждения',
  editing: 'Редактирует файлы',
  running_commands: 'Вводит команды',
  responding: 'Отвечает',
};

const PHASES = [
  'waiting',
  'thinking',
  'planning',
  'reading',
  'analyzing',
  'aligning',
  'awaiting_confirmation',
  'editing',
  'running_commands',
  'responding',
];

function statusFromTool(tool) {
  const detail = tool?.target ? `${tool.name} → ${tool.target}` : (tool?.name || null);

  // Continue: status "generated" = tool создан и ждёт approve в TUI
  if (tool?.status === 'generated' && tool?.kind !== 'align') {
    return {
      agentStatus: 'awaiting_confirmation',
      statusLabel: STATUS_LABELS.awaiting_confirmation,
      agentDetail: detail,
      isResponding: false,
    };
  }

  if (tool?.kind === 'align') {
    return {
      agentStatus: 'aligning',
      statusLabel: STATUS_LABELS.aligning,
      agentDetail: detail,
      isResponding: false,
    };
  }

  if (tool?.kind === 'plan') {
    return {
      agentStatus: 'planning',
      statusLabel: STATUS_LABELS.planning,
      agentDetail: detail,
      isResponding: true,
    };
  }

  if (tool?.kind === 'edit') {
    return {
      agentStatus: 'editing',
      statusLabel: STATUS_LABELS.editing,
      agentDetail: detail,
      isResponding: true,
    };
  }

  if (tool?.kind === 'reading') {
    return {
      agentStatus: 'reading',
      statusLabel: STATUS_LABELS.reading,
      agentDetail: detail,
      isResponding: true,
    };
  }
  if (tool?.kind === 'analyze') {
    return {
      agentStatus: 'analyzing',
      statusLabel: STATUS_LABELS.analyzing,
      agentDetail: detail,
      isResponding: true,
    };
  }
  return {
    agentStatus: 'running_commands',
    statusLabel: STATUS_LABELS.running_commands,
    agentDetail: detail,
    isResponding: true,
  };
}

function normalizePath(value) {
  if (typeof value !== 'string' || !value) return null;
  return value.replace(/\/+$/, '') || '/';
}

function pickProcess(processes) {
  if (!Array.isArray(processes) || processes.length === 0) return null;

  const working = processes.filter((p) => p.isWorking);
  const pool = working.length > 0 ? working : processes;

  return pool.slice().sort((a, b) => {
    const cpuA = Number.parseFloat(String(a.cpu).replace('%', '')) || 0;
    const cpuB = Number.parseFloat(String(b.cpu).replace('%', '')) || 0;
    return cpuB - cpuA;
  })[0];
}

async function resolveSession(process, sessions) {
  const cwd = normalizePath(process?.cwd);
  const metas = await listSessionFilesMeta();

  // Самый свежий session-файл в том же cwd — главный источник правды.
  if (cwd) {
    for (const meta of metas.slice(0, 12)) {
      const metrics = await getSessionMetrics(meta.sessionId);
      if (metrics.available && normalizePath(metrics.workspaceDirectory) === cwd) {
        return metrics;
      }
    }

    const indexed = (sessions || []).filter(
      (s) => normalizePath(s.workspaceDirectory) === cwd && s.id
    );
    if (indexed.length > 0) {
      return getSessionMetrics(indexed[0].id);
    }
  }

  if (metas.length === 0) {
    return { available: false, error: 'No session files' };
  }

  return getSessionMetrics(metas[0].sessionId);
}

function deriveStatus({ processCount, process, metrics }) {
  if (processCount === 0) {
    return {
      agentStatus: 'idle',
      statusLabel: STATUS_LABELS.idle,
      agentDetail: null,
      isResponding: false,
    };
  }

  const openTools = metrics?.openTools || [];
  const pendingConfirmation = metrics?.pendingConfirmation || [];
  const pendingAlign = metrics?.pendingAlign || [];

  // Сначала явные блокировки UI: вопрос пользователю / approve tool
  if (pendingAlign.length > 0) {
    return statusFromTool(pendingAlign[pendingAlign.length - 1]);
  }
  if (pendingConfirmation.length > 0) {
    return statusFromTool(pendingConfirmation[pendingConfirmation.length - 1]);
  }
  if (openTools.length > 0) {
    return statusFromTool(openTools[openTools.length - 1]);
  }

  const isWorking = Boolean(process?.isWorking);
  const ageMs = Number.isFinite(metrics?.ageMs) ? metrics.ageMs : Infinity;
  // Continue пишет session JSON на tool/turn. TUI может держать CPU >1% даже в простое,
  // поэтому «активность» не берём из одного только isWorking.
  const sessionFresh = ageMs < 20000;
  const awaitingFirstToken = metrics?.lastRole === 'user' && isWorking;
  const likelyGenerating = isWorking
    && ageMs < 90000
    && metrics?.lastRole === 'assistant'
    && Boolean(metrics?.hasOnlyThinkContent);
  const active = sessionFresh || awaitingFirstToken || likelyGenerating;

  // Агент предложил варианты и ждёт выбора — даже если session уже «остыл»
  if (!active && metrics?.lastRole === 'assistant' && metrics?.isProposal) {
    return {
      agentStatus: 'aligning',
      statusLabel: STATUS_LABELS.aligning,
      agentDetail: metrics.proposalSnippet || metrics.lastVisibleText?.slice(0, 80) || null,
      isResponding: false,
    };
  }

  if (!active) {
    return {
      agentStatus: 'waiting',
      statusLabel: STATUS_LABELS.waiting,
      agentDetail: metrics?.lastUserMessage
        ? `последний запрос: ${metrics.lastUserMessage.slice(0, 60)}`
        : null,
      isResponding: false,
    };
  }

  if (metrics?.lastRole === 'user') {
    return {
      agentStatus: 'thinking',
      statusLabel: STATUS_LABELS.thinking,
      agentDetail: 'старт ответа на сообщение',
      isResponding: true,
    };
  }

  const lastTools = metrics?.lastStepTools || [];
  const lastKind = metrics?.lastStepKind;
  const visible = metrics?.lastVisibleText || '';
  const onlyThink = Boolean(metrics?.hasOnlyThinkContent);
  const recent = metrics?.activity || [];
  const recentReading = recent.filter((t) => t.kind === 'reading').length;
  const recentAnalyze = recent.filter((t) => t.kind === 'analyze').length;
  const recentCommand = recent.filter((t) => t.kind === 'command').length;
  const recentEdit = recent.filter((t) => t.kind === 'edit').length;
  const recentPlan = recent.filter((t) => t.kind === 'plan').length;
  const recentAlign = recent.filter((t) => t.kind === 'align').length;

  // Активное чтение / редактирование / план в последнем шаге
  if (['reading', 'edit', 'plan'].includes(lastKind) && lastTools.length > 0 && (sessionFresh || onlyThink)) {
    return statusFromTool(lastTools[lastTools.length - 1]);
  }

  // Внутренний план в think до/без tools
  if (onlyThink && metrics?.isPlanning && lastTools.length === 0) {
    return {
      agentStatus: 'planning',
      statusLabel: STATUS_LABELS.planning,
      agentDetail: metrics.planningSnippet || metrics.lastThinkSnippet?.slice(0, 80) || null,
      isResponding: true,
    };
  }

  if (onlyThink && (lastTools.length > 0 || recent.length > 0)) {
    const kind = lastKind
      || (recentAlign > 0 ? 'align' : null)
      || (recentPlan > 0 ? 'plan' : null)
      || (recentEdit > recentCommand ? 'edit' : null)
      || (recentCommand > recentReading && recentCommand > recentAnalyze ? 'command' : null)
      || (recentReading > 0 ? 'reading' : null)
      || (recentAnalyze > 0 ? 'analyze' : null);

    if (kind === 'align') {
      const tool = lastTools[lastTools.length - 1] || recent.filter((t) => t.kind === 'align').at(-1);
      return statusFromTool(tool || { kind: 'align', name: 'AskQuestion', status: 'calling' });
    }

    if (kind === 'plan') {
      const tool = lastTools[lastTools.length - 1] || recent.filter((t) => t.kind === 'plan').at(-1);
      return statusFromTool(tool || { kind: 'plan', name: 'Checklist' });
    }

    if (kind === 'edit') {
      const tool = lastTools[lastTools.length - 1] || recent.filter((t) => t.kind === 'edit').at(-1);
      return statusFromTool(tool || { kind: 'edit', name: 'Edit' });
    }

    if (kind === 'reading') {
      const tool = recent.filter((t) => t.kind === 'reading').at(-1);
      return {
        agentStatus: 'analyzing',
        statusLabel: STATUS_LABELS.analyzing,
        agentDetail: tool?.target
          ? `после ${tool.name}: ${tool.target}`
          : (metrics?.lastThinkSnippet?.slice(0, 80) || null),
        isResponding: true,
      };
    }

    if (kind === 'analyze') {
      const tool = lastTools[lastTools.length - 1] || recent.filter((t) => t.kind === 'analyze').at(-1);
      return statusFromTool(tool || { kind: 'analyze', name: 'Search' });
    }

    if (kind === 'command') {
      const tool = lastTools[lastTools.length - 1] || recent.filter((t) => t.kind === 'command').at(-1);
      return statusFromTool(tool || { kind: 'command', name: 'Bash' });
    }
  }

  if (visible.length >= 40 && !onlyThink) {
    if (metrics?.isProposal && !isWorking) {
      return {
        agentStatus: 'aligning',
        statusLabel: STATUS_LABELS.aligning,
        agentDetail: metrics.proposalSnippet || visible.slice(0, 80),
        isResponding: false,
      };
    }

    if (metrics?.isPlanning && isWorking) {
      return {
        agentStatus: 'planning',
        statusLabel: STATUS_LABELS.planning,
        agentDetail: metrics.planningSnippet || visible.slice(0, 80),
        isResponding: true,
      };
    }

    return {
      agentStatus: 'responding',
      statusLabel: STATUS_LABELS.responding,
      agentDetail: visible.slice(0, 80),
      isResponding: true,
    };
  }

  if (metrics?.lastThinkSnippet) {
    if (metrics.isPlanning) {
      return {
        agentStatus: 'planning',
        statusLabel: STATUS_LABELS.planning,
        agentDetail: metrics.planningSnippet || metrics.lastThinkSnippet.slice(0, 80),
        isResponding: true,
      };
    }

    return {
      agentStatus: 'thinking',
      statusLabel: STATUS_LABELS.thinking,
      agentDetail: metrics.lastThinkSnippet.slice(0, 80),
      isResponding: true,
    };
  }

  return {
    agentStatus: isWorking ? 'thinking' : 'waiting',
    statusLabel: isWorking ? STATUS_LABELS.thinking : STATUS_LABELS.waiting,
    agentDetail: null,
    isResponding: isWorking,
  };
}

function emptyActive(processCount = 0) {
  return {
    sessionId: null,
    title: null,
    workspaceDirectory: null,
    contextPercent: null,
    promptTokens: null,
    contextLength: null,
    model: null,
    agentStatus: processCount === 0 ? 'idle' : 'waiting',
    agentDetail: null,
    statusLabel: processCount === 0 ? STATUS_LABELS.idle : STATUS_LABELS.waiting,
    elapsed: null,
    processCount,
    isResponding: false,
    phase: processCount === 0 ? 'idle' : 'waiting',
    phases: PHASES,
    thinkSnippet: null,
    lastUserMessage: null,
    activity: [],
    ageMs: null,
    overlays: emptyOverlays(),
    outcomes: emptyOutcomes(),
  };
}

function resolveOutcomes({ status, metrics, sessionFresh }) {
  if (!metrics?.available) return emptyOutcomes();

  const turnComplete = status.agentStatus === 'waiting'
    || status.agentStatus === 'idle'
    || (
      !sessionFresh
      && status.agentStatus !== 'thinking'
      && !(metrics.openTools || []).length
      && metrics.lastRole === 'assistant'
    );

  return buildOutcomesFromSignals(metrics, { turnComplete });
}

export async function buildActiveSnapshot({ sessions, processes }) {
  const processList = processes?.processes || [];
  const processCount = processList.length;
  const process = pickProcess(processList);

  if (processCount === 0) {
    return emptyActive(0);
  }

  const metrics = await resolveSession(process, sessions?.sessions || []);
  const status = deriveStatus({ processCount, process, metrics });
  const sessionFresh = Number.isFinite(metrics?.ageMs) ? metrics.ageMs < 20000 : false;
  const overlays = metrics?.available
    ? buildOverlaysFromSignals(metrics, { sessionFresh, processCount })
    : emptyOverlays();
  const outcomes = resolveOutcomes({ status, metrics, sessionFresh });

  if (!metrics?.available) {
    return {
      ...emptyActive(processCount),
      ...status,
      elapsed: process?.elapsed || null,
      workspaceDirectory: process?.cwd || null,
      overlays,
      outcomes,
    };
  }

  return {
    sessionId: metrics.sessionId,
    title: metrics.title,
    workspaceDirectory: metrics.workspaceDirectory,
    contextPercent: metrics.contextPercent,
    promptTokens: metrics.promptTokens,
    contextLength: metrics.contextLength,
    model: metrics.model,
    agentStatus: status.agentStatus,
    agentDetail: status.agentDetail,
    statusLabel: status.statusLabel,
    elapsed: process?.elapsed || null,
    processCount,
    isResponding: status.isResponding,
    phase: status.agentStatus,
    phases: PHASES,
    thinkSnippet: metrics.lastThinkSnippet,
    lastUserMessage: metrics.lastUserMessage,
    activity: metrics.activity || [],
    ageMs: metrics.ageMs,
    overlays,
    outcomes,
  };
}
