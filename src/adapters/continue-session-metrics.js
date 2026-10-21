import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const DEFAULT_CONTEXT_LENGTH = 200000;
const OPEN_TOOL_STATUSES = new Set(['calling', 'generated']);
const READING_TOOLS = new Set(['Read', 'List', 'LS', 'Glob', 'Fetch']);
const ANALYZE_TOOLS = new Set(['Grep', 'Search', 'Find']);
const ALIGN_TOOLS = new Set(['AskQuestion', 'askQuestion']);
const PLAN_TOOLS = new Set(['Checklist']);
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'Delete']);
const COMMAND_TOOLS = new Set(['Bash', 'Terminal']);
const CONTINUE_BUILTINS = new Set([
  'AskQuestion', 'askQuestion', 'Edit', 'Exit', 'Fetch', 'List', 'MultiEdit', 'Read',
  'ReportFailure', 'Bash', 'Search', 'Status', 'Subagent', 'Skills', 'UploadArtifact',
  'Diff', 'Checklist', 'Write', 'Terminal', 'LS', 'Grep', 'Find', 'Glob', 'Delete',
]);

const PROPOSAL_RE = /(?:^|\n)\s*(?:[-*]|\d+[.)]|[a-dA-D][.)])\s+\S[\s\S]{0,200}(?:^|\n)\s*(?:[-*]|\d+[.)]|[a-dA-D][.)])\s+\S/m;
const PROPOSAL_KEYWORD_RE = /(?:вариант|подход|очередност|план\s+работ|предлож|соглас|подтверд|какой\s+вариант|что\s+выберешь|which\s+option|option\s*[a-d1-3]|shall\s+i|do\s+you\s+want|prefer(?:ence)?|approve|confirm)/i;
const PLANNING_RE = /(?:\bплан\b|планир|по\s+шагам|разобью|сначала\b|затем\b|потом\b|checklist|todo\b|implementation\s+plan|step\s*-?\s*\d|I'll\s+(?:first|start\s+by)|let\s+me\s+plan|- \[ \])/i;
const COMPACTING_RE = /(?:compact(?:ing|ed)?|compaction|сжат[а-я]*\s+контекст|сжима[а-я]*\s+контекст|сжать\s+истори|summar(?:y|ize|ising|izing).{0,40}(?:context|history|conversation)|контекст.{0,30}сжат)/i;

function isMcpToolName(name) {
  if (!name || typeof name !== 'string') return false;
  if (/^mcp([_-]|$)/i.test(name) || name.includes('__')) return true;
  return !CONTINUE_BUILTINS.has(name);
}

function emptyOverlay() {
  return { active: false, detail: null };
}

export function buildOverlaysFromSignals(signals, { sessionFresh = false, processCount = 0 } = {}) {
  const overlays = {
    compacting: emptyOverlay(),
    subagent: emptyOverlay(),
    skills: emptyOverlay(),
    mcp: emptyOverlay(),
  };

  if (!signals || processCount === 0) {
    return overlays;
  }

  const openTools = signals.openTools || [];
  const lastStepTools = signals.lastStepTools || [];
  const activity = signals.activity || [];
  const candidates = [
    ...openTools,
    ...(sessionFresh ? lastStepTools : []),
    ...(sessionFresh ? activity.slice(-4) : []),
  ];

  const pick = (predicate) => {
    const openHit = openTools.find(predicate);
    if (openHit) return openHit;
    if (!sessionFresh) return null;
    return lastStepTools.find(predicate) || activity.slice().reverse().find(predicate) || null;
  };

  const sub = pick((t) => t.name === 'Subagent');
  if (sub && (OPEN_TOOL_STATUSES.has(sub.status) || sessionFresh)) {
    overlays.subagent = {
      active: true,
      detail: sub.target ? `Subagent → ${sub.target}` : `Subagent (${sub.status})`,
    };
  }

  const skill = pick((t) => t.name === 'Skills');
  if (skill && (OPEN_TOOL_STATUSES.has(skill.status) || sessionFresh)) {
    overlays.skills = {
      active: true,
      detail: skill.target ? `Skills → ${skill.target}` : `Skills (${skill.status})`,
    };
  }

  const mcp = pick((t) => isMcpToolName(t.name));
  if (mcp && (OPEN_TOOL_STATUSES.has(mcp.status) || sessionFresh)) {
    overlays.mcp = {
      active: true,
      detail: mcp.target ? `${mcp.name} → ${mcp.target}` : `${mcp.name} (${mcp.status})`,
    };
  }

  const compactSource = [
    signals.lastThinkSnippet || '',
    signals.lastVisibleText || '',
  ].join('\n');
  if (sessionFresh && COMPACTING_RE.test(compactSource)) {
    overlays.compacting = {
      active: true,
      detail: 'сжатие контекста / compaction',
    };
  }

  // Если среди кандидатов нет явного сигнала — всё равно отметим mcp/subagent/skills
  // только по open; compacting уже завязан на sessionFresh.
  void candidates;

  return overlays;
}

function parseModelContextLengths(yamlText) {
  const lengths = new Map();
  let currentName = null;

  for (const rawLine of yamlText.split(/\r?\n/)) {
    const nameMatch = rawLine.match(/^\s*-\s+name:\s*(.+?)\s*$/);
    if (nameMatch) {
      currentName = nameMatch[1].replace(/^['"]|['"]$/g, '').trim();
      continue;
    }

    const lengthMatch = rawLine.match(/^\s*contextLength:\s*(\d+)\s*$/);
    if (lengthMatch && currentName) {
      lengths.set(currentName, Number(lengthMatch[1]));
    }
  }

  return lengths;
}

async function getSelectedModelContext() {
  let model = null;
  let contextLength = DEFAULT_CONTEXT_LENGTH;

  try {
    const globalRaw = await fs.readFile(config.globalContext, 'utf8');
    const globalData = JSON.parse(globalRaw);
    if (typeof globalData.cliSelectedModel === 'string' && globalData.cliSelectedModel.trim()) {
      model = globalData.cliSelectedModel.trim();
    }
  } catch {
    // fallback ниже
  }

  try {
    const yamlText = await fs.readFile(config.continueConfig, 'utf8');
    const lengths = parseModelContextLengths(yamlText);
    if (model && lengths.has(model)) {
      contextLength = lengths.get(model);
    } else if (lengths.size > 0) {
      const first = lengths.values().next().value;
      if (Number.isFinite(first) && first > 0) {
        contextLength = first;
      }
    }
  } catch {
    // fallback DEFAULT_CONTEXT_LENGTH
  }

  return { model, contextLength };
}

function stripThink(text) {
  return String(text || '')
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, ' ')
    // Continue часто пишет незакрытый <think>… без </think>
    .replace(/<think\b[^>]*>[\s\S]*$/gi, ' ')
    .replace(/<\/?think\b[^>]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractThinkSnippet(content) {
  const text = String(content || '');
  const closed = text.match(/<think\b[^>]*>([\s\S]*?)<\/think>/i);
  if (closed) return closed[1].trim().slice(0, 160);

  const open = text.match(/<think\b[^>]*>([\s\S]*)$/i);
  if (open) return open[1].trim().slice(0, 160);

  return null;
}

function toolTarget(tool) {
  const args = tool?.parsedArgs
    || (typeof tool?.toolCall?.function?.arguments === 'string'
      ? safeJson(tool.toolCall.function.arguments)
      : tool?.toolCall?.function?.arguments)
    || {};

  if (typeof args.question === 'string' && args.question.trim()) {
    return args.question.trim();
  }
  if (typeof args.checklist === 'string' && args.checklist.trim()) {
    return args.checklist.trim().slice(0, 100);
  }

  return args.filepath
    || args.path
    || args.file
    || args.command
    || args.pattern
    || args.query
    || null;
}

function detectProposal(text) {
  const visible = String(text || '').trim();
  if (visible.length < 40) {
    return { isProposal: false, snippet: null };
  }

  const hasList = PROPOSAL_RE.test(visible);
  const hasKeyword = PROPOSAL_KEYWORD_RE.test(visible);
  const asksUser = /[?？]\s*$/.test(visible)
    || /(?:\?|？)\s*\n/.test(visible)
    || /(?:выбери|confirm|approve|ok\?|согласен)/i.test(visible);

  const isProposal = (hasList && (hasKeyword || asksUser)) || (hasKeyword && asksUser);
  return {
    isProposal,
    snippet: isProposal ? visible.slice(0, 120) : null,
  };
}

function detectPlanning(thinkSnippet, visibleText) {
  const think = String(thinkSnippet || '').trim();
  const visible = String(visibleText || '').trim();
  const source = think.length >= 20 ? think : visible;
  if (source.length < 20) {
    return { isPlanning: false, snippet: null };
  }

  const hasPlanWords = PLANNING_RE.test(source);
  const hasSteps = PROPOSAL_RE.test(source) || /(?:^|\n)\s*\d+[.)]\s+\S/m.test(source);
  const asksUser = /[?？]\s*$/.test(visible)
    || /(?:выбери|какой\s+вариант|confirm|approve)/i.test(visible);

  // Планирование — внутренний план; если явно спрашивает пользователя, это согласование.
  const isPlanning = !asksUser && (hasPlanWords || (hasSteps && think.length >= 40));
  return {
    isPlanning,
    snippet: isPlanning ? source.slice(0, 120) : null,
  };
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function classifyTool(name) {
  if (ALIGN_TOOLS.has(name)) return 'align';
  if (PLAN_TOOLS.has(name)) return 'plan';
  if (EDIT_TOOLS.has(name)) return 'edit';
  if (COMMAND_TOOLS.has(name)) return 'command';
  if (READING_TOOLS.has(name)) return 'reading';
  if (ANALYZE_TOOLS.has(name)) return 'analyze';
  return 'other';
}

function summarizeTools(tools) {
  if (!tools.length) return null;
  const kinds = tools.map((t) => t.kind || classifyTool(t.name));
  const align = kinds.filter((k) => k === 'align').length;
  const plan = kinds.filter((k) => k === 'plan').length;
  const edit = kinds.filter((k) => k === 'edit').length;
  const command = kinds.filter((k) => k === 'command').length;
  const reading = kinds.filter((k) => k === 'reading').length;
  const analyze = kinds.filter((k) => k === 'analyze').length;
  if (align > 0) return 'align';
  if (plan > 0) return 'plan';
  if (edit > 0 && edit >= command) return 'edit';
  if (command > 0 && command >= reading && command >= analyze) return 'command';
  if (reading > 0 && reading >= analyze) return 'reading';
  if (analyze > 0) return 'analyze';
  return 'other';
}

function extractSignals(history) {
  let promptTokens = null;
  let lastRole = null;
  let lastUserMessage = null;
  let lastAssistantContent = '';
  let lastThinkSnippet = null;
  let lastVisibleText = '';
  const openTools = [];
  const activity = [];
  let lastStepTools = [];

  if (!Array.isArray(history)) {
    return {
      promptTokens,
      lastRole,
      lastUserMessage,
      lastThinkSnippet,
      lastVisibleText,
      openTools,
      activity,
      lastStepTools,
      lastStepKind: null,
      hasOnlyThinkContent: false,
      isProposal: false,
      proposalSnippet: null,
      isPlanning: false,
      planningSnippet: null,
      pendingConfirmation: [],
      pendingAlign: [],
      overlays: buildOverlaysFromSignals(null),
    };
  }

  for (const entry of history) {
    const message = entry?.message;
    if (!message || typeof message !== 'object') continue;

    if (typeof message.role === 'string') {
      lastRole = message.role;
    }

    const content = typeof message.content === 'string' ? message.content : '';
    const usage = message.usage;
    const tokens = usage?.prompt_tokens ?? usage?.promptTokens;
    if (Number.isFinite(tokens) && tokens >= 0) {
      promptTokens = tokens;
    }

    if (message.role === 'user') {
      const cleaned = stripThink(content);
      if (cleaned) lastUserMessage = cleaned.slice(0, 120);
    }

    const stepTools = [];
    if (Array.isArray(entry.toolCallStates)) {
      for (const tool of entry.toolCallStates) {
        const name = tool?.toolCall?.function?.name
          || tool?.toolCall?.name
          || 'tool';
        const status = typeof tool?.status === 'string' ? tool.status : 'unknown';
        const target = toolTarget(tool);
        const item = {
          name,
          status,
          kind: classifyTool(name),
          isMcp: isMcpToolName(name),
          target: typeof target === 'string' ? target.slice(0, 100) : null,
        };
        stepTools.push(item);
        activity.push(item);
        if (OPEN_TOOL_STATUSES.has(status)) {
          openTools.push(item);
        }
      }
    }

    if (message.role === 'assistant') {
      lastAssistantContent = content;
      lastThinkSnippet = extractThinkSnippet(content);
      lastVisibleText = stripThink(content);
      lastStepTools = stepTools;
    }
  }

  const hasOnlyThinkContent = Boolean(lastAssistantContent)
    && /<think\b/i.test(lastAssistantContent)
    && lastVisibleText.length < 24;

  const proposal = detectProposal(lastVisibleText);
  const planning = detectPlanning(lastThinkSnippet, lastVisibleText);
  const pendingConfirmation = openTools.filter((t) => t.status === 'generated');
  const pendingAlign = openTools.filter((t) => t.kind === 'align');

  const baseSignals = {
    promptTokens,
    lastRole,
    lastUserMessage,
    lastThinkSnippet,
    lastVisibleText,
    openTools,
    activity: activity.slice(-12),
    lastStepTools,
    lastStepKind: summarizeTools(lastStepTools),
    hasOnlyThinkContent,
    isProposal: proposal.isProposal,
    proposalSnippet: proposal.snippet,
    isPlanning: planning.isPlanning,
    planningSnippet: planning.snippet,
    pendingConfirmation,
    pendingAlign,
  };

  return {
    ...baseSignals,
    // overlays пересчитываются в agent-status с учётом sessionFresh / processCount
    overlays: buildOverlaysFromSignals(baseSignals, { sessionFresh: true, processCount: 1 }),
  };
}

export async function getSessionMetrics(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) {
    return { available: false, error: 'Missing sessionId' };
  }

  const sessionPath = path.join(config.sessionsDir, `${sessionId}.json`);

  try {
    const [raw, modelInfo, stat] = await Promise.all([
      fs.readFile(sessionPath, 'utf8'),
      getSelectedModelContext(),
      fs.stat(sessionPath),
    ]);

    const data = JSON.parse(raw);
    const signals = extractSignals(data.history);
    const contextLength = modelInfo.contextLength || DEFAULT_CONTEXT_LENGTH;
    const promptTokens = signals.promptTokens;
    const contextPercent = Number.isFinite(promptTokens)
      ? Math.min(100, Math.round((promptTokens / contextLength) * 100))
      : null;

    const rawTitle = typeof data.title === 'string' ? data.title : null;
    const cleanedTitle = stripThink(rawTitle || '');
    const titleLooksBroken = !cleanedTitle
      || /user wants me to analyze/i.test(cleanedTitle)
      || /provide a .*title/i.test(cleanedTitle)
      || cleanedTitle.startsWith('The user wants');

    return {
      available: true,
      sessionId: typeof data.sessionId === 'string' ? data.sessionId : sessionId,
      title: titleLooksBroken
        ? (signals.lastUserMessage || 'Активная сессия')
        : cleanedTitle.slice(0, 80),
      workspaceDirectory: typeof data.workspaceDirectory === 'string'
        ? data.workspaceDirectory
        : null,
      mtimeMs: stat.mtimeMs,
      ageMs: Math.max(0, Date.now() - stat.mtimeMs),
      promptTokens,
      contextLength,
      contextPercent,
      model: modelInfo.model,
      lastRole: signals.lastRole,
      lastUserMessage: signals.lastUserMessage,
      lastThinkSnippet: signals.lastThinkSnippet,
      lastVisibleText: signals.lastVisibleText,
      hasOnlyThinkContent: signals.hasOnlyThinkContent,
      openTools: signals.openTools,
      lastStepTools: signals.lastStepTools,
      lastStepKind: signals.lastStepKind,
      activity: signals.activity,
      isProposal: signals.isProposal,
      proposalSnippet: signals.proposalSnippet,
      isPlanning: signals.isPlanning,
      planningSnippet: signals.planningSnippet,
      pendingConfirmation: signals.pendingConfirmation,
      pendingAlign: signals.pendingAlign,
      overlays: signals.overlays,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      sessionId,
      error: error.message,
    };
  }
}

export async function listSessionFilesMeta() {
  try {
    const entries = await fs.readdir(config.sessionsDir);
    const metas = await Promise.all(entries
      .filter((name) => name.endsWith('.json') && name !== 'sessions.json')
      .map(async (name) => {
        const sessionId = name.slice(0, -'.json'.length);
        const fullPath = path.join(config.sessionsDir, name);
        try {
          const stat = await fs.stat(fullPath);
          return { sessionId, mtimeMs: stat.mtimeMs, path: fullPath };
        } catch {
          return null;
        }
      }));

    return metas.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}
