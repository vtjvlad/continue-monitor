const $ = (id) => document.getElementById(id);

let token = sessionStorage.getItem('continueMonitorToken') || '';
let timer = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;',
  })[char]);
}

function showLogin(message = '') {
  $('login').hidden = false;
  $('dashboard').hidden = true;
  $('login-error').textContent = message;
}

function showDashboard() {
  $('login').hidden = true;
  $('dashboard').hidden = false;
}

function dateText(value) {
  if (value === null || value === undefined || value === '') {
    return 'Неизвестно';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Неизвестно'
    : date.toLocaleString();
}

function renderSessions(data) {
  $('session-count').textContent = data.available ? data.count : 'Ошибка';

  if (!data.available) {
    $('sessions').innerHTML =
      `<p class="error">Не удалось прочитать индекс сессий: ${escapeHtml(data.error)}</p>`;
    return;
  }

  if (!data.sessions.length) {
    $('sessions').innerHTML = '<p class="muted">Сессий нет.</p>';
    return;
  }

  $('sessions').innerHTML = data.sessions.map((session) => `
    <article class="item">
      <h3>${escapeHtml(session.title || 'Без названия')}</h3>
      <p class="muted">ID: <code>${escapeHtml(session.id)}</code></p>
      <p>Рабочая папка: <code>${escapeHtml(session.workspaceDirectory || 'Неизвестно')}</code></p>
      <p>Создана: ${escapeHtml(dateText(session.dateCreated))}</p>
      <p>Сообщений: ${session.messageCount ?? 'Неизвестно'}</p>
      <span class="badge">Сохранённая сессия</span>
    </article>
  `).join('');
}

function renderProcesses(data) {
  $('process-count').textContent = data.available ? data.processes.length : 'Ошибка';

  if (!data.available) {
    $('processes').innerHTML =
      `<p class="error">Ошибка проверки процессов: ${escapeHtml(data.error)}</p>`;
    return;
  }

  if (!data.processes.length) {
    $('processes').innerHTML =
      '<p class="muted">Процессы Continue CLI не обнаружены.</p>';
    return;
  }

  $('processes').innerHTML = data.processes.map((process) => `
    <article class="item">
      <h3>PID ${process.pid}</h3>
      <p>Пользователь: ${escapeHtml(process.user)}</p>
      <p>Состояние ОС: <code>${escapeHtml(process.state)}</code></p>
      <p>Время работы: ${escapeHtml(process.elapsed)}</p>
      <p>Рабочая папка: <code>${escapeHtml(process.cwd || 'Недоступна')}</code></p>
    </article>
  `).join('');
}

async function refresh() {
  if (!token) return;

  try {
    const response = await fetch('./api/status/', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (response.status === 401) {
      token = '';
      sessionStorage.removeItem('continueMonitorToken');
      clearInterval(timer);
      showLogin('Токен недействителен или истёк.');
      return;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    showDashboard();
    renderSessions(data.sessions);
    renderProcesses(data.processes);

    const healthy = data.sessions.available && data.processes.available;
    $('monitor-state').textContent = healthy ? 'Доступен' : 'Частично';
    $('updated').textContent = `Обновлено: ${dateText(data.collectedAt)}`;
  } catch (error) {
    $('monitor-state').textContent = 'Ошибка';
    $('updated').textContent = `Ошибка обновления: ${error.message}`;
  }
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  token = $('token').value.trim();

  try {
    const response = await fetch('./api/health', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (!response.ok) {
      showLogin('Не удалось войти. Проверь токен.');
      return;
    }

    sessionStorage.setItem('continueMonitorToken', token);
    $('token').value = '';
    showDashboard();
    await refresh();
    clearInterval(timer);
    timer = setInterval(refresh, 5000);
  } catch {
    showLogin('Сервер недоступен.');
  }
});

$('refresh').addEventListener('click', refresh);

$('logout').addEventListener('click', () => {
  clearInterval(timer);
  token = '';
  sessionStorage.removeItem('continueMonitorToken');
  showLogin();
});

if (token) {
  showDashboard();
  refresh();
  timer = setInterval(refresh, 5000);
} else {
  showLogin();
}
