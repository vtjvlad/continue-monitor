const TOKEN_STORAGE_KEY = 'continue_monitor_token';

let token = localStorage.getItem(TOKEN_STORAGE_KEY);
let previousProcesses = new Set();
let previousSessions = new Set();
let previousStatus = null;
let isFirstFetch = true;

const apiStatusBadge = document.getElementById('apiStatusBadge');
const apiStatusText = document.getElementById('apiStatusText');
const lastUpdateTime = document.getElementById('lastUpdateTime');
const refreshBtn = document.getElementById('refreshBtn');
const tokenBtn = document.getElementById('tokenBtn');
const toggleDetailsBtn = document.getElementById('toggleDetailsBtn');
const detailedView = document.getElementById('detailedView');

const activeProcessesCount = document.getElementById('activeProcessesCount');
const activeSessionsCount = document.getElementById('activeSessionsCount');
const contextPercentValue = document.getElementById('contextPercentValue');
const contextPercentSub = document.getElementById('contextPercentSub');
const contextRing = document.getElementById('contextRing');
const agentStatusValue = document.getElementById('agentStatusValue');
const agentStatusSub = document.getElementById('agentStatusSub');
const agentElapsedValue = document.getElementById('agentElapsedValue');
const agentModelValue = document.getElementById('agentModelValue');
const agentTitle = document.getElementById('agentTitle');
const agentMeta = document.getElementById('agentMeta');
const agentLiveCard = document.getElementById('agentLiveCard');
const phaseStack = document.getElementById('phaseStack');
const phaseTrack = document.getElementById('phaseTrack');
const overlaysRow = document.getElementById('overlaysRow');
const overlaysCoverRow = document.getElementById('overlaysCoverRow');
const overlaysDetail = document.getElementById('overlaysDetail');
const stepOutcomesRow = document.getElementById('stepOutcomesRow');
const requestOutcomesRow = document.getElementById('requestOutcomesRow');
const stepOutcomesDetail = document.getElementById('stepOutcomesDetail');
const requestOutcomesDetail = document.getElementById('requestOutcomesDetail');
const thinkSnippet = document.getElementById('thinkSnippet');
const activityFeed = document.getElementById('activityFeed');
const activityCountBadge = document.getElementById('activityCountBadge');

const OVERLAY_KEYS = ['compacting', 'subagent', 'skills', 'mcp'];
const OVERLAY_LABELS = {
    compacting: 'Сжатие',
    subagent: 'Субагент',
    skills: 'Skills',
    mcp: 'MCP',
};
const OUTCOME_KEYS = ['ready', 'canceled', 'error'];
const processesList = document.getElementById('processesList');
const currentSessionsList = document.getElementById('currentSessionsList');
const historySessionsList = document.getElementById('historySessionsList');
const historyCountBadge = document.getElementById('historyCountBadge');
const notificationsContainer = document.getElementById('notificationsContainer');

function playAlertSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
    } catch {
        // ignore autoplay limits
    }
}

function ensureToken() {
    if (!token) {
        token = prompt('Введите MONITOR_TOKEN для доступа к Continue Monitor:');
        if (token) {
            localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
        } else {
            alert('Токен обязателен для работы мониторинга.');
        }
    }
    return token;
}

tokenBtn.addEventListener('click', () => {
    const newToken = prompt('Введите новый MONITOR_TOKEN:', token || '');
    if (newToken !== null) {
        token = newToken.trim();
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
        fetchStatus();
    }
});

toggleDetailsBtn.addEventListener('click', () => {
    const isCollapsed = detailedView.classList.toggle('collapsed');
    toggleDetailsBtn.textContent = isCollapsed ? 'Развернуть детали ▼' : 'Свернуть детали ▲';
});

function showNotification(message, type = 'info') {
    playAlertSound();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    notificationsContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

async function fetchStatus() {
    const currentToken = ensureToken();
    if (!currentToken) return;

    try {
        const response = await fetch('./api/status/', {
            headers: { Authorization: `Bearer ${currentToken}` },
        });

        if (response.status === 401) {
            setApiStatus(false, 'Ошибка авторизации (401)');
            localStorage.removeItem(TOKEN_STORAGE_KEY);
            token = null;
            return;
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        setApiStatus(true, 'В сети');
        updateDashboard(data);
        lastUpdateTime.textContent = new Date(data.collectedAt).toLocaleTimeString();
    } catch (error) {
        setApiStatus(false, 'Нет связи');
        console.error('Fetch status error:', error);
    }
}

function setApiStatus(isOnline, text) {
    apiStatusBadge.className = `status ${isOnline ? 'online' : 'offline'}`;
    apiStatusText.textContent = text;
    document.body.dataset.api = isOnline ? 'online' : 'offline';
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g,
        (tag) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

function shortPath(value) {
    if (!value) return '—';
    const parts = String(value).split('/').filter(Boolean);
    if (parts.length <= 3) return value;
    return `…/${parts.slice(-3).join('/')}`;
}

function toolStatusClass(status) {
    if (status === 'done') return 'ok';
    if (status === 'errored' || status === 'canceled') return 'bad';
    if (status === 'calling' || status === 'generated') return 'live';
    return '';
}

function feedStatusClass(status) {
    if (status === 'done') return 'done';
    if (status === 'errored' || status === 'canceled') return 'err';
    return '';
}

function updatePhaseTrack(phase) {
    if (!phaseTrack) return;
    const steps = phaseTrack.querySelectorAll('.phase');
    steps.forEach((step) => {
        const isActive = step.dataset.phase === phase;
        step.classList.toggle('is-active', isActive);
        step.classList.toggle('active', isActive);
        step.classList.remove('is-done');
    });
}

function syncOverlayChips(root, data, activeDetails) {
    let anyActive = false;
    OVERLAY_KEYS.forEach((key) => {
        const chip = root?.querySelector(`[data-overlay="${key}"]`);
        const state = data[key] || { active: false, detail: null };
        const active = Boolean(state.active);
        if (chip) {
            chip.classList.toggle('is-active', active);
            chip.classList.toggle('active', active);
            chip.title = state.detail || OVERLAY_LABELS[key];
        }
        if (active) {
            anyActive = true;
            if (activeDetails) {
                activeDetails.push(`${OVERLAY_LABELS[key]}: ${state.detail || 'active'}`);
            }
        }
    });
    return anyActive;
}

function updateOverlays(overlays) {
    const data = overlays || {};
    const activeDetails = [];
    const rowActive = syncOverlayChips(overlaysRow, data, activeDetails);
    const coverActive = syncOverlayChips(overlaysCoverRow, data, null);
    const anyActive = rowActive || coverActive;

    phaseStack?.classList.toggle('has-overlays', anyActive);

    if (overlaysDetail) {
        overlaysDetail.textContent = activeDetails.join(' · ');
    }
}

function setOutcomeRow(row, status, counts = null) {
    if (!row) return;
    OUTCOME_KEYS.forEach((key) => {
        const chip = row.querySelector(`[data-outcome="${key}"]`);
        if (!chip) return;
        const count = counts && Number.isFinite(counts[key]) ? counts[key] : null;
        chip.classList.toggle('is-active', key === status);
        chip.classList.toggle(key, key === status);
        if (count !== null) {
            chip.classList.toggle('has-count', count > 0);
            const countEl = chip.querySelector(`[data-count="${key}"]`) || chip.querySelector('.outcome-count');
            if (countEl) countEl.textContent = String(count);
        }
    });
}

function updateOutcomes(outcomes) {
    const data = outcomes || {};
    const step = data.step || { status: null, detail: null, counts: null };
    const request = data.request || { status: null, detail: null };
    const counts = step.counts || { ready: 0, canceled: 0, error: 0 };

    setOutcomeRow(stepOutcomesRow, step.status, counts);
    setOutcomeRow(requestOutcomesRow, request.status);

    if (stepOutcomesDetail) {
        const total = (counts.ready || 0) + (counts.canceled || 0) + (counts.error || 0);
        stepOutcomesDetail.textContent = step.detail
            ? step.detail
            : (total > 0 ? `завершено шагов: ${total}` : '');
    }

    if (requestOutcomesDetail) {
        requestOutcomesDetail.textContent = request.status && request.detail
            ? request.detail
            : '';
    }
}

function renderActivity(activity) {
    const items = Array.isArray(activity) ? activity.slice().reverse() : [];
    activityCountBadge.textContent = items.length;

    if (items.length === 0) {
        activityFeed.innerHTML = '<p class="empty-text">Нет недавних tool-вызовов</p>';
        return;
    }

    activityFeed.innerHTML = items.map((item) => `
        <div class="activity-item feed-item ${toolStatusClass(item.status)}">
            <div class="activity-main">
                <span class="activity-tool feed-name">${escapeHtml(item.name)}</span>
                <span class="activity-status feed-status ${feedStatusClass(item.status)}">${escapeHtml(item.status)}</span>
            </div>
            <div class="activity-target">${escapeHtml(shortPath(item.target) || 'без аргументов')}</div>
        </div>
    `).join('');
}

function updateActiveMetrics(active) {
    const a = active || {};
    const phase = a.agentStatus || 'idle';
    const pct = typeof a.contextPercent === 'number' ? a.contextPercent : 0;

    if (typeof a.contextPercent === 'number') {
        contextPercentValue.textContent = `${a.contextPercent}%`;
        const tokens = Number.isFinite(a.promptTokens) ? a.promptTokens.toLocaleString('ru-RU') : '—';
        const limit = Number.isFinite(a.contextLength) ? a.contextLength.toLocaleString('ru-RU') : '—';
        contextPercentSub.textContent = `${tokens} / ${limit} токенов`;
    } else {
        contextPercentValue.textContent = '—';
        contextPercentSub.textContent = a.processCount > 0 ? 'нет данных usage' : 'нет активного процесса';
    }

    contextRing.style.setProperty('--pct', String(pct));
    agentStatusValue.textContent = a.statusLabel || '—';
    agentStatusSub.textContent = a.agentDetail || '';
    agentElapsedValue.textContent = a.elapsed || '—';
    agentModelValue.textContent = a.model || '—';
    agentTitle.textContent = a.title || (a.processCount ? 'Активный Continue CLI' : 'Нет активной сессии');
    agentMeta.textContent = [
        a.workspaceDirectory ? shortPath(a.workspaceDirectory) : null,
        a.sessionId ? `session ${a.sessionId.slice(0, 8)}` : null,
        Number.isFinite(a.ageMs) ? `обновлено ${(a.ageMs / 1000).toFixed(1)}с назад` : null,
    ].filter(Boolean).join(' · ') || '—';

    thinkSnippet.textContent = a.thinkSnippet || (
        a.processCount > 0 ? 'Думает без сохранённого фрагмента…' : 'Агент пока молчит'
    );

    agentLiveCard.dataset.phase = phase;
    agentLiveCard.classList.toggle('is-live', Boolean(a.isResponding));
    updatePhaseTrack(phase === 'idle' ? 'waiting' : phase);
    updateOverlays(a.overlays);
    updateOutcomes(a.outcomes);
    renderActivity(a.activity);

    if (!isFirstFetch && previousStatus && previousStatus !== phase && phase !== 'idle') {
        showNotification(`Агент: ${a.statusLabel}`, phase === 'waiting' ? 'info' : 'success');
    }
    previousStatus = phase;
}

function updateDashboard(data) {
    const processes = data.processes?.processes || [];
    const sessions = data.sessions?.sessions || [];
    const active = data.active || null;

    activeProcessesCount.textContent = active?.processCount ?? processes.length;
    activeSessionsCount.textContent = sessions.length;
    updateActiveMetrics(active);

    const currentPIDs = new Set(processes.map((p) => p.pid));
    const currentSessionIDs = new Set(sessions.map((s) => s.id));

    if (!isFirstFetch) {
        for (const pid of currentPIDs) {
            if (!previousProcesses.has(pid)) {
                showNotification(`Запущен Continue CLI (PID: ${pid})`, 'success');
            }
        }
        for (const pid of previousProcesses) {
            if (!currentPIDs.has(pid)) {
                showNotification(`Процесс Continue CLI завершён (PID: ${pid})`, 'danger');
            }
        }
        for (const id of currentSessionIDs) {
            if (!previousSessions.has(id)) {
                const sess = sessions.find((s) => s.id === id);
                showNotification(`Новая сессия: "${sess?.title || id}"`, 'success');
            }
        }
    }

    previousProcesses = currentPIDs;
    previousSessions = currentSessionIDs;
    isFirstFetch = false;

    if (processes.length === 0) {
        processesList.innerHTML = '<p class="empty-text">Нет активных процессов</p>';
    } else {
        processesList.innerHTML = processes.map((p) => `
            <div class="item-card${p.isWorking ? ' active-working' : ''}">
                <div class="item-title">
                    PID: ${p.pid} (${escapeHtml(p.executable)})
                    ${p.isWorking ? '<span class="badge-working">работает</span>' : '<span class="badge">простой</span>'}
                </div>
                <div class="item-meta">
                    <span>⏱ ${escapeHtml(p.elapsed)}</span>
                    <span>CPU: ${escapeHtml(p.cpu || '—')}</span>
                    <span>MEM: ${escapeHtml(p.mem || '—')}</span>
                    <span>📂 ${escapeHtml(p.cwd || 'недоступна')}</span>
                </div>
            </div>
        `).join('');
    }

    const activeId = active?.sessionId;
    const ordered = [...sessions].sort((a, b) => {
        if (a.id === activeId) return -1;
        if (b.id === activeId) return 1;
        return 0;
    });

    if (ordered.length === 0) {
        currentSessionsList.innerHTML = '<p class="empty-text">Нет доступных сессий</p>';
    } else {
        currentSessionsList.innerHTML = ordered.slice(0, 5).map((s) => `
            <div class="item-card${s.id === activeId ? ' active-working' : ''}">
                <div class="item-title">${escapeHtml(s.title)}${s.id === activeId ? ' <span class="badge-working">active</span>' : ''}</div>
                <div class="item-meta">
                    <span>📅 ${s.dateCreated ? new Date(s.dateCreated).toLocaleString() : 'дата не указана'}</span>
                    <span>💬 Сообщений: ${s.messageCount ?? 'N/A'}</span>
                    <span>📂 ${escapeHtml(shortPath(s.workspaceDirectory))}</span>
                </div>
            </div>
        `).join('');
    }

    historyCountBadge.textContent = sessions.length;
    if (sessions.length === 0) {
        historySessionsList.innerHTML = '<p class="empty-text">История пуста</p>';
    } else {
        historySessionsList.innerHTML = sessions.map((s) => `
            <div class="item-card">
                <div class="item-title">${escapeHtml(s.title)}</div>
                <div class="item-meta">
                    <span>ID: ${escapeHtml(s.id)}</span>
                    <span>📅 ${s.dateCreated ? new Date(s.dateCreated).toLocaleString() : '—'}</span>
                    <span>💬 ${s.messageCount ?? 'N/A'}</span>
                    <span>📂 ${escapeHtml(s.workspaceDirectory || '—')}</span>
                </div>
            </div>
        `).join('');
    }
}

refreshBtn.addEventListener('click', fetchStatus);
ensureToken();
fetchStatus();
setInterval(fetchStatus, 3000);
