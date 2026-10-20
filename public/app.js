const TOKEN_STORAGE_KEY = 'continue_monitor_token';

let token = localStorage.getItem(TOKEN_STORAGE_KEY);
let previousProcesses = new Set();
let previousSessions = new Set();
let isFirstFetch = true;

// DOM Elements
const apiStatusBadge = document.getElementById('apiStatusBadge');
const apiStatusText = document.getElementById('apiStatusText');
const lastUpdateTime = document.getElementById('lastUpdateTime');
const refreshBtn = document.getElementById('refreshBtn');
const tokenBtn = document.getElementById('tokenBtn');
const toggleDetailsBtn = document.getElementById('toggleDetailsBtn');
const detailedView = document.getElementById('detailedView');

const activeProcessesCount = document.getElementById('activeProcessesCount');
const activeSessionsCount = document.getElementById('activeSessionsCount');
const processesList = document.getElementById('processesList');
const currentSessionsList = document.getElementById('currentSessionsList');
const historySessionsList = document.getElementById('historySessionsList');
const historyCountBadge = document.getElementById('historyCountBadge');
const notificationsContainer = document.getElementById('notificationsContainer');

// Управление токеном
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

// Развертывание деталей дашборда
toggleDetailsBtn.addEventListener('click', () => {
    const isCollapsed = detailedView.classList.toggle('collapsed');
    toggleDetailsBtn.textContent = isCollapsed ? 'Развернуть детали ▼' : 'Свернуть детали ▲';
});

// Уведомления (тосты)
function showNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    notificationsContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// Запрос статуса
async function fetchStatus() {
    const currentToken = ensureToken();
    if (!currentToken) return;

    try {
        const response = await fetch('./api/status/', {
            headers: {
                'Authorization': `Bearer ${currentToken}`
            }
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
    apiStatusBadge.className = `api-status-badge ${isOnline ? 'online' : 'offline'}`;
    apiStatusText.textContent = text;
}

// Обновление интерфейса дашборда и диффинг изменений
function updateDashboard(data) {
    const processes = data.processes?.processes || [];
    const sessions = data.sessions?.sessions || [];

    // Обновляем метрики
    activeProcessesCount.textContent = processes.length;
    activeSessionsCount.textContent = sessions.length;

    // Сеты текущих PID и Session ID для проверки появления/завершения
    const currentPIDs = new Set(processes.map(p => p.pid));
    const currentSessionIDs = new Set(sessions.map(s => s.id));

    if (!isFirstFetch) {
        // Проверка процессов
        for (const pid of currentPIDs) {
            if (!previousProcesses.has(pid)) {
                showNotification(`🚀 Запущен новый процесс Continue CLI (PID: ${pid})`, 'success');
            }
        }
        for (const pid of previousProcesses) {
            if (!currentPIDs.has(pid)) {
                showNotification(`🛑 Процесс Continue CLI завершен (PID: ${pid})`, 'danger');
            }
        }

        // Проверка сессий
        for (const id of currentSessionIDs) {
            if (!previousSessions.has(id)) {
                const sess = sessions.find(s => s.id === id);
                showNotification(`✨ Появилась новая сессия: "${sess?.title || id}"`, 'success');
            }
        }
        for (const id of previousSessions) {
            if (!currentSessionIDs.has(id)) {
                showNotification(`📁 Сессия завершена / удалена (ID: ${id.slice(0, 8)}...)`, 'danger');
            }
        }
    }

    previousProcesses = currentPIDs;
    previousSessions = currentSessionIDs;
    isFirstFetch = false;

    // Рендер процессов
    if (processes.length === 0) {
        processesList.innerHTML = '<p class="empty-text">Нет активных процессов</p>';
    } else {
        processesList.innerHTML = processes.map(p => `
            <div class="item-card">
                <div class="item-title">PID: ${p.pid} (${p.executable})</div>
                <div class="item-meta">
                    <span>⏱ Работает: ${p.elapsed}</span>
                    <span>👤 Пользователь: ${p.user}</span>
                    <span>📂 Директория: ${p.cwd || 'недоступна'}</span>
                </div>
            </div>
        `).join('');
    }

    // Рендер текущих сессий (в деталях)
    if (sessions.length === 0) {
        currentSessionsList.innerHTML = '<p class="empty-text">Нет доступных сессий</p>';
    } else {
        currentSessionsList.innerHTML = sessions.slice(0, 5).map(s => `
            <div class="item-card">
                <div class="item-title">${escapeHtml(s.title)}</div>
                <div class="item-meta">
                    <span>📅 ${s.dateCreated ? new Date(s.dateCreated).toLocaleString() : 'дата не указана'}</span>
                    <span>💬 Сообщений: ${s.messageCount ?? 'N/A'}</span>
                </div>
            </div>
        `).join('');
    }

    // Рендер истории сессий (в отдельном разворачивающемся блоке)
    historyCountBadge.textContent = sessions.length;
    if (sessions.length === 0) {
        historySessionsList.innerHTML = '<p class="empty-text">История пуста</p>';
    } else {
        historySessionsList.innerHTML = sessions.map(s => `
            <div class="item-card">
                <div class="item-title">${escapeHtml(s.title)}</div>
                <div class="item-meta">
                    <span>ID: ${s.id}</span>
                    <span>📅 ${s.dateCreated ? new Date(s.dateCreated).toLocaleString() : '—'}</span>
                    <span>💬 Сообщений: ${s.messageCount ?? 'N/A'}</span>
                    <span>📂 ${s.workspaceDirectory || '—'}</span>
                </div>
            </div>
        `).join('');
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// События
refreshBtn.addEventListener('click', fetchStatus);

// Инициализация при загрузке
ensureToken();
fetchStatus();

// Автообновление каждые 6 секунд
setInterval(fetchStatus, 6000);
