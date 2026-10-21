# Промпт для проверки фаз Continue Monitor

Вставь текст из блока **«Промпт»** в сессию Continue CLI (`cn`) в репозитории  
`/home/ubuntu/server/continue-monitor`.

Параллельно держи открытым дашборд: `http://127.0.0.1:8788`  
(Bearer-токен — `MONITOR_TOKEN` из `.env`).

Цель: наглядно увидеть, как монитор отражает фазы, оверлеи и исходы шага/запроса.

---

## Как смотреть

1. `sudo systemctl status continue-monitor` — сервис должен быть `active`.
2. Открой дашборд и убедись, что API «В сети».
3. В другом терминале: `cd /home/ubuntu/server/continue-monitor && cn`
4. Вставь промпт целиком.
5. На шаге с вопросом **не отвечай сразу** 5–10 с → должна гореть фаза `aligning`.
6. Если TUI просит approve на Write/Bash — **подожди 5–10 с** на экране approve → `awaiting_confirmation`.
7. После финального ответа подожди ~20 с без действий → `waiting`, у блока **Запрос** может загореться `Ready`.

Poll UI ≈ 3 с — шаги намеренно растянуты паузами.

---

## Чеклист на дашборде

| Когда | Фаза / блок | Ожидание |
|--------|-------------|----------|
| Сразу после Enter | основная фаза | `thinking` → часто `planning` |
| Read файлов | основная фаза | `reading` (+ лента tools) |
| Grep/Search | основная фаза | `analyzing` |
| AskQuestion, ждёшь ответа | основная фаза | `aligning` |
| Approve в TUI | основная фаза | `awaiting_confirmation` |
| Write файла | основная фаза | `editing` |
| `ls` / `wc` / `echo` | основная фаза | `running_commands` |
| Финальный текст без tools | основная фаза | `responding` |
| Сессия «остыла» >~20 с | основная фаза | `waiting` |
| Завершённые tools | блок **Шаг** (у ленты) | счётчики `Ready` / `Canceled` / `Error` растут |
| Ход завершён | блок **Запрос** (под фазами) | обычно `Ready` (или `Error`/`Canceled`) |
| Этот прогон | оверлеи поверх фаз | обычно пусто (без Subagent/Skills/MCP) |

Кольцо контекста должно чуть подрасти после Read/Grep.

---

## Промпт

```text
Ты участвуешь в проверке веб-монитора Continue (continue-monitor). Цель — НАГЛЯДНО пройти фазы агента по очереди. Работай МЕДЛЕННО: после каждого шага сделай короткую паузу (sleep 4–6 в shell, где уместно) и короткий комментарий в ответе, чтобы UI успел обновиться (~3 с poll).

Репозиторий: /home/ubuntu/server/continue-monitor
Ничего не коммить, не пушь, не трогай .env. Временные файлы только в /tmp/cm-phase-test/ (создай каталог).

Строгий порядок (не пропускай, не объединяй в один tool-call batch без пауз):

1) PLANNING
   Сначала явно напиши план работ списком «сначала / затем / потом» (или Checklist, если доступен). Не читай файлы в этом же шаге.

2) READING
   Прочитай ровно эти файлы по одному (отдельными вызовами Read):
   - SESSION-HANDOFF.md
   - src/services/agent-status.js
   Между чтениями: Bash `sleep 5`.

3) ANALYZING
   Сделай Grep/Search по репо: agentStatus и overlays (pattern: agentStatus|overlays|sessionFresh|outcomes).
   Затем Bash `sleep 5` и коротко скажи, что нашёл (1–2 предложения).

4) ALIGNING (важно для монитора)
   Обязательно вызови AskQuestion (или явно предложи 2 варианта и жди ответа):
   Вопрос: «Какой временный файл создать?»
   Варианты: A) phase-a.txt  B) phase-b.txt
   После вопроса ОСТАНОВИСЬ и жди мой ответ. Ничего больше не делай, пока я не отвечу.

5) EDITING (после моего ответа)
   Создай каталог /tmp/cm-phase-test/ и запиши выбранный файл через Write
   с содержимым: "continue-monitor phase test" и текущей датой.
   Если TUI просит approve — дождись моего подтверждения, не обходи его.

6) RUNNING_COMMANDS
   Bash по очереди (с sleep 4 между ними):
   - ls -la /tmp/cm-phase-test/
   - wc -c /tmp/cm-phase-test/*
   - echo "phase-test-done"

7) RESPONDING
   Финальный ответ пользователю БЕЗ новых tools:
   таблица «шаг → что сделал» и одна строка:
   «монитор: thinking→planning→reading→analyzing→aligning→(awaiting_confirmation?)→editing→running_commands→responding;
   блок Шаг: счётчики Ready/Canceled/Error; блок Запрос: Ready после остывания».

Ограничения:
- Не вызывай Subagent / Skills / MCP в этом прогоне (overlays — отдельный промпт ниже).
- Не делай compaction и не проси сжать контекст.
- Не правь исходники монитора — только /tmp/cm-phase-test/.
```

---

## Дополнительно: промпт для overlays

Отдельный короткий чат (после основного прогона или вместо него):

```text
Только проверка overlays монитора, без лишней работы.
1) Вызови Skills (если есть) — подожди 5 с.
2) Вызови Subagent с крошечной задачей: «ответь одним словом: pong» — подожди 5 с.
3) Если есть MCP-tool — один безопасный read-only вызов, иначе пропусти.
4) Коротко отчитайся. Исходники не меняй.
```

Ожидание: поверх трека фаз всплывают чипы `Skills` / `Субагент` / `MCP`.  
`Сжатие` (compacting) этим почти не поймать — сигнал эвристический по тексту.

---

## Быстрая проверка API (опционально)

```bash
cd /home/ubuntu/server/continue-monitor && node -e "
import { collectStatus } from './src/services/monitor.js';
const a = (await collectStatus()).active;
console.log(JSON.stringify({
  phase: a.agentStatus,
  overlays: a.overlays,
  outcomes: a.outcomes,
}, null, 2));
"
```
