# ОТ-База

Автономное приложение для специалиста по охране труда: таблицы со связями «мастер → зависимые», импорт/экспорт Excel, генерация документов Word/PDF по тегам, реестр нормативных актов, контроль сроков и локальная ИИ-студия (Ollama / OpenAI-совместимые API).

Работает в двух режимах:

| Режим | Как запускается | Где хранятся данные |
|---|---|---|
| **file-handle** (рекомендуется для веба) | `dist/` или `pnpm dev` в Chrome/Edge, затем «Файл → Рабочая папка на диске…» | `data/ot_database.json` в выбранной папке + бэкапы в `data/backups/` (File System Access API) |
| **native-fs** | `OT-Baza.exe` (Windows 10/11 x64) — поднимает локальный HTTP-сервер на `127.0.0.1` и открывает отдельное окно браузера | `./data/ot_database.json` рядом с программой, атомарная запись + бэкапы в `./data/backups/` |
| **web / preview** | `pnpm dev` или собранный `dist/` в любом браузере | `localStorage` браузера (одна копия на домен) |

`file-handle` — это веб-версия без нативного сервера: браузер получает доступ к одной выбранной папке и пишет файл базы сам. Работает в Chrome и Edge на `https://` или `http://localhost` (нужен secure context); в Firefox/Safari остаётся только хранение в браузере. Первый запуск требует системного диалога выбора папки, после перезагрузки браузер может попросить подтвердить доступ — это его политика безопасности.

Первый режим даёт файловое хранение на диске/флешке, второй — работу без установки и без `.exe`.

## Быстрый старт (веб-версия)

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Production-сборка и локальный предпросмотр:

```bash
pnpm build
pnpm preview      # http://localhost:4173
```

Собранный `dist/` — статический сайт: его можно разложить на любой хостинг (Nginx, GitHub Pages, внутренний сервер). Все данные при этом живут в `localStorage` браузера пользователя, серверная часть не нужна.

## Проверки

```bash
pnpm lint         # tsc --noEmit (strict)
pnpm test         # vitest run
pnpm build        # vite build
pnpm check        # lint + test + build
```

## Сборка артефактов для Windows

```bash
# только веб-артефакты: dist-offline/ + public/app.html + dist/
python build_native_windows.py --skip-native

# полный релиз: дополнительно OT-Baza.exe и OT-Baza-Windows.zip
python build_native_windows.py
```

Полная сборка требует Node.js в `PATH` (или переменной `NODE_BIN`) и MinGW-w64 (`x86_64-w64-mingw32-gcc`, `x86_64-w64-mingw32-windres`). Бинарники `OT-Baza.exe` / `OT-Baza-Windows.zip` **не хранятся в git** (`public/download/` в `.gitignore`) — они собираются локально и публикуются как релизные артефакты. Если их нет, интерфейс честно отключает кнопки скачивания.

`public/app.html` — одностраничный офлайн-вариант (весь код, стили и шрифты внутри одного файла). Открывается двойным щелчком из `file://`.

## Структура

```
src/
  App.tsx                 — оболочка: состояние БД, вкладки, сохранение, модалки
  components/             — UI (DataGrid, модалки, MenuBar/TabBar/StatusBar, ui/*)
  services/               — storageService, integrityService, excelService,
                            documentGenerator, deadlineService, localApiClient…
  data/                   — встроенные шаблоны, нормативные акты, шрифт для PDF
  types/database.ts       — модель данных (DatabaseState, LegalEntity, Tab, Column…)
launcher.c                — нативный Windows-лаунчер и локальный HTTP-сервер
build_native_windows.py   — сборка offline-бандла, app.html, .exe и ZIP
docs/                     — исследовательские артефакты (прототипы)
```

## Документация

- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — архитектура, карта модулей, модель данных, команды.
- [`DECISIONS.md`](DECISIONS.md) — зафиксированные архитектурные решения и их причины.
- [`HANDOFF.md`](HANDOFF.md) — статус работ, что проверено, ограничения среды.
- [`ROADMAP.md`](ROADMAP.md) / [`TASKS.md`](TASKS.md) — план этапов и трекер задач.
- [`AGENTS.md`](AGENTS.md) — правила работы команды над проектом.
- [`UX_CONCEPT.md`](UX_CONCEPT.md), [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md), [`UI_ACCEPTANCE.md`](UI_ACCEPTANCE.md) — концепция редизайна и критерии приёмки (этапы D-2…D-6 ещё не реализованы).

## Ограничения

- `file-handle` работает только в Chromium-браузерах (Chrome/Edge) и только на `https://` или `localhost`. Запись не атомарна: перед перезаписью текущая база копируется в `data/backups/ot_database_prev.json`.
- Нативный `.exe` проверяется только на Windows 10/11 x64; сборка и запуск требуют MinGW-w64.
- В режиме `web-preview` крупные вложения (>1.5 МБ) не кэшируются в `localStorage` — для файлов на диске используйте `file-handle` или `OT-Baza.exe`.
- Импорт данных из Excel не приводит значения «насильно»: нечисло в числовом столбце или текст в дате отклоняется с отчётом о расхождениях.

## Лицензия

Проект приватный (`UNLICENSED`). Сторонние компоненты и их лицензии — в [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
