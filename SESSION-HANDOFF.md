# Handoff: Continue Monitor — контекст сессии

Передай этот файл в новую сессию как стартовый контекст.

## Цель проекта

Веб-монитор Continue CLI (`cn`) на Ubuntu: живой дашборд статуса агента, контекста и процессов. Не контроллер запуска/остановки заданий — сейчас это **read-only мониторинг**.

## Что сделано в этой ветке работы

1. **Контекст %** — из последнего `history[].message.usage.prompt_tokens` / `contextLength` модели (`config.yaml` + `cliSelectedModel`), не из кумулятивного `usage.promptTokens`.
2. **Фазы агента (эвристики)** — по `ps` + session JSON (`toolCallStates`, `<think>`, текст ответа). Continue готовые фазы на диск не пишет.
3. **Параллельные overlays** — `compacting`, `subagent`, `skills`, `mcp` — не шаги трека, горят независимо рядом с основной фазой.
4. **UI** — live-карточка: трек фаз, кольцо контекста, think-сниппет, лента tools, блок «Параллельно».
5. **Фикс простоя** — TUI держит CPU ~3–4%; активные фазы завязаны на свежесть session-файла (`ageMs < 20s`), а не только на `isWorking` (порог CPU теперь > 5%).

## Основной трек фаз (`active.agentStatus`)

`waiting` → `thinking` → `planning` → `reading` → `analyzing` → `aligning` → `awaiting_confirmation` → `editing` → `running_commands` → `responding`

(+ служебный `idle`, если нет процесса `cn`)

| Код | Смысл | Главный сигнал |
|-----|--------|----------------|
| waiting | ждёт ввод | процесс есть, session «остыл» |
| thinking | думает | think / старт ответа |
| planning | план | `Checklist` или план в think |
| reading | читает файлы | `Read`/`List`/`Glob`/`Fetch` |
| analyzing | анализирует | `Search`/`Grep` или think после Read |
| aligning | согласование | `AskQuestion` или варианты+вопрос |
| awaiting_confirmation | approve в TUI | tool status `generated` |
| editing | правка файлов | `Write`/`Edit`/`MultiEdit`/`Delete` |
| running_commands | shell | `Bash`/`Terminal` |
| responding | ответ пользователю | видимый текст без режима вопроса |

## Overlays (параллельно)

| Ключ | Сигнал |
|------|--------|
| compacting | свежая сессия + текст compaction/сжатия контекста |
| subagent | tool `Subagent` |
| skills | tool `Skills` |
| mcp | tool не из Continue builtins / `mcp…` / `__` |

API: `GET /api/status/` → `active.overlays.{compacting|subagent|skills|mcp}.{active,detail}`

## Ключевые пути

- Repo: `/home/ubuntu/server/continue-monitor`
- Сервис: `continue-monitor.service` → `http://127.0.0.1:8788`
- Данные Continue: `~/.continue/sessions/<uuid>.json`, `sessions.json`, `config.yaml`, `index/globalContext.json`
- Auth: Bearer `MONITOR_TOKEN` из `.env`

## Важные файлы

- `src/services/monitor.js` — сборка ответа
- `src/services/agent-status.js` — фазы + overlays
- `src/adapters/continue-session-metrics.js` — парсинг session / usage / tools
- `src/adapters/continue-processes.js` — `ps` по `cn`
- `src/adapters/continue-sessions.js` — индекс сессий
- `public/{index.html,app.js,styles.css}` — дашборд (poll ~3 с)

## Ограничения / не делать вслепую

- Нет персистентных таймеров «сколько секунд в фазе X» (отложено в исходном ТЗ).
- `isCompacting` из TUI на диск почти не пишется — compacting эвристический.
- Точный token-count как в Continue CLI не повторяли.
- `main-func.md` мог быть удалён/не в корне — логика уже в коде.

## Что логично дальше

- Таймеры dwell-time по фазам
- Уточнение compacting (если появится сигнал на диске / `cn serve`)
- Связка process↔session надёжнее при нескольких `cn`
- Коммит текущих изменений (сейчас много uncommitted work)

## Быстрая проверка

```bash
sudo systemctl status continue-monitor
cd /home/ubuntu/server/continue-monitor && node -e "import { collectStatus } from './src/services/monitor.js'; console.log(JSON.stringify((await collectStatus()).active,null,2))"
```
