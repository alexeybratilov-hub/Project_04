# PROJECT_CONTEXT — Технический контекст проекта «ОТ-База»

> Этот файл фиксирует фактическое состояние кодовой базы, архитектуры, сборочного конвейера и ключевых решений для быстрого и безопасного входа следующего агента в проект в соответствии с `AGENTS.md`.

## 1. Назначение и архитектура проекта

**«ОТ-База»** — портативное десктоп- и веб-приложение для ведения баз данных по охране труда с поддержкой нескольких изолированных юридических лиц (кроме общей нормативной базы), мастер-таблицами и зависимыми столбцами, генерацией документов DOCX/PDF по тегам, а также опциональной ИИ-студией (локальные LLM и облачные API).

### Технологический стек
- **Frontend**: React 19, TypeScript, Vite 8 (`vite.config.ts`, `vite.offline.config.ts`), Tailwind CSS v4 (`@tailwindcss/vite`), `lucide-react`, `motion`.
- **Документы и таблицы**: `xlsx` (импорт/экспорт Excel/CSV с поддержкой Win-1251), `docx` (генерация Word `.docx`), `jspdf` (генерация PDF со встроенным кириллическим шрифтом `DejaVuSans` в `src/data/cyrillicFont.ts`).
- **Нативный Windows-рантайм**: `launcher.c` + `resources.rc` -> кросс-компиляция `x86_64-w64-mingw32-gcc` в 64-битный GUI PE `public/download/OT-Baza.exe` и пакет `public/download/OT-Baza-Windows.zip`.
- **Тестирование**: Vitest 5.1 (`npm test` -> `vitest run`).

### Режимы хранения и работы
1. **`native-fs` (запуск через `OT-Baza.exe`)**:
   - `OT-Baza.exe` запускает локальный HTTP-сервер строго на `127.0.0.1:<ephemeral_port>` с одноразовым 128-битным токеном `#token=...` (очищается из URL после чтения) и открывает Edge/Chrome в `--app` режиме (или системный браузер).
   - Защита от дублей: именованный `Mutex` по FNV1a-хэшу каталога приложения + `.ot_runtime.json`.
   - Защита HTTP: проверка `Host`, `Origin`, `Sec-Fetch-Site`, постоянное по времени сравнение `X-OT-Token`, строгий whitelist директорий (`normatives`, `documents`, `templates`) и санитизация путей (`IsSafeSubpath`, запрет `..`, резервных имён Windows).
   - Единый источник правды: `./data/ot_database.json` с монотонным счётчиком ревизий (`409 Conflict` при рассинхроне), атомарной записью через `.tmp` + `FlushFileBuffers` + `MoveFileExW` и ротацией бэкапов в `./data/backups/`.
   - Однократная миграция пользовательских данных из `localStorage['ot_base_database_v1']` при первом запуске в `native-fs` с очисткой `localStorage` во избежание split-brain.
   - Обработка ошибок диска/USB (включая извлечение флешки) с отображением явного баннера ошибки сохранения в `App.tsx` и `TitleBar.tsx`.
   - Heartbeat (`/api/heartbeat`) и автоматическое завершение процесса при закрытии браузера (`/api/shutdown` + grace timeout).
2. **`web-preview` (обычный браузер / dev-сервер / PWA)**:
   - Хранение в `localStorage` с обработкой `QuotaExceededError` и явной индикацией режима в интерфейсе.

---

## 2. Карта файлов и модулей

### Корень проекта и сборка
- `AGENTS.md` — мастер-инструкция мультидисциплинарной команды (обязательный порядок аудита, совещаний, дизайн-системы, целостности данных и отчётности).
- `DECISIONS.md` — зафиксированные архитектурные решения (Вариант A для `OT-Baza.exe`, логика `DataGrid`, `DejaVuSans`, Этапы 5–6).
- `ROADMAP.md` — поэтапный план работ (Этапы 0–10).
- `TASKS.md` — трекер задач `T-01` .. `T-35` (выполнены) и отложенной `T-36`.
- `HANDOFF.md` — журнал передачи, статус проверок (в т.ч. `T-35`), ограничения среды контейнера и перечень проверок для Windows / MinGW-w64.
- `AGENT_HANDOFF_PROMPT.md` — готовый стартовый промпт для передачи дел следующему агенту.
- `launcher.c`, `resources.rc`, `build_native_windows.py` — исходник Win64 HTTP-сервера/лаунчера и полный скрипт сборки (`app.html` -> `OT-Baza.exe` -> `OT-Baza-Windows.zip` -> `dist/`).
- `package.json`, `tsconfig.json`, `vite.config.ts`, `vite.offline.config.ts`.

### Типы и данные (`src/types/`, `src/data/`)
- `src/types/database.ts`:
  - `DatabaseState`: `activeEntityId`, `entities: LegalEntity[]`, общая `normativeDocs: AttachedDoc[]`, зеркала активного юрлица (`tabs`, `tags`, `templates`, `generatedDocs`, `llmConfig`, `llmLogs`, `settings`).
  - `LegalEntity` + `LegalEntityProfile` (13 реквизитов предприятия).
  - `Tab`, `Column` (`text | number | date | select | boolean | link | relation`, `width`, `relation: { masterTabId, masterColumnId }`), `Row`.
  - `DocumentTemplate` (`tabId`, `category`, `namingPattern`, `contentTemplate`, `tableRepeatField`, `isArchived`, `archivedAt`, `archivedFromTabName`).
  - `GeneratedDocRecord` (`category`, `format`, `dateFormatted`, `relativePath`, `isArchived`, `archiveDateFolder`, `sourceTabName`).
  - `LLMConfig` (`providerId`, `providerKind`, `apiFormat: 'ollama' | 'openai' | 'anthropic' | 'gemini'`, `endpoint`, `model`, `apiKey`, `status`, `errorMessage`).
- `src/data/initialDatabase.ts`, `public/initial_db.json` — стартовая структура и пресеты.
- `src/data/builtInTemplates.ts` — встроенные шаблоны (динамические теги реквизитов юрлица вместо хардкода).
- `src/data/builtInNormativeDocs.ts` — встроенные нормативные акты.
- `src/data/llmProviders.ts` — пресеты локальных серверов (Ollama, LM Studio, vLLM/LocalAI, Custom Local) и облачных API (OpenAI, Claude, Gemini, DeepSeek, OpenRouter, Groq, Custom API).
- `src/data/cyrillicFont.ts` — локальный `DejaVuSans` (Regular + Bold) в base64 для `jsPDF`.

### Сервисы (`src/services/`) и тесты (`src/services/__tests__/`)
- `localApiClient.ts` — HTTP-клиент к локальному API (`GET/PUT /api/database`, `/api/files/*`, `POST /api/files-move/documents`, `/api/heartbeat`, `/api/shutdown`).
- `storageService.ts` + `storageService.test.ts` — загрузка/сохранение БД, нормализация, клонирование/создание юрлиц, синхронизация зеркал активного юрлица, однократная миграция `localStorage -> file`.
- `integrityService.ts` + `integrityService.test.ts` — аудит связей Мастер↔Подчинённая, проверка влияния удаления строк/столбцов/вкладок (`getTabDeleteImpact` с учётом шаблонов и документов), каскадная очистка висячих `relation` и тегов, генерация уникальных ID.
- `excelService.ts` + `excelService.test.ts` — экспорт/импорт Excel и CSV (включая Windows-1251), позиционная вставка из буфера Excel (`parseInlineClipboardPaste`: 1 столбец, частичное число столбцов `<= N`, вся таблица, сопоставление по заголовкам или позиционно, транзакционная валидация кортежей Мастер-таблицы, ошибка только при `copiedColCount > totalTabCols`).
- `documentGenerator.ts` + `documentGenerator.test.ts` — подстановка тегов юрлица и таблиц (включая многокритериальный lookup по Мастеру), экспорт `.docx` и кириллических `.pdf`.
- `generatedDocsService.ts` + `generatedDocsService.test.ts` — регистрация сформированных документов, автоматическая архивация дублей в `<Категория>/АРХИВ/<дд.мм.гггг>/` (с суффиксами `_v2`, `_v3`).
- `ollamaService.ts` + `llmProviders.test.ts` — проверка подключения и генерация по 4 форматам (`ollama`, `openai`, `anthropic`, `gemini`).
- `portablePackageService.ts` + `portablePackageService.test.ts` — экспорт портативного комплекта и HTML/DOCX вспомогательные функции.

### Интерфейс (`src/components/` и `src/components/ui/`)
- Главная оболочка: `App.tsx`, `TitleBar.tsx`, `MenuBar.tsx`, `TabBar.tsx`, `StatusBar.tsx`.
- Таблица и навигация по связям: `DataGrid.tsx` (`sticky right-0` действия, просмотр длинных ячеек, безопасный `boolean` и `'link'`), `ImportHintCard.tsx`, `MasterJumpDialog.tsx`.
- Дизайн-система (`src/components/ui/`): `AppModal.tsx`, `AppButton.tsx`, `AppInput.tsx`, `FormField.tsx`, `InlineConfirm.tsx`, `StatusBanner.tsx`, `ConfirmDialog.tsx`, `ToastProvider.tsx`, `modalStack.ts`, `zIndex.ts`. Все 15 модальных окон унифицированы на этих примитивах с поддержкой focus-trap, LIFO `Escape` и `dirty-guard`.
- Модальные окна управления структурой и данными:
  - `LegalEntityModal.tsx` — карточка юрлица (создание, редактирование 13 реквизитов, клонирование).
  - `NewTabModal.tsx`, `ColumnEditorModal.tsx`, `MasterDependenciesModal.tsx`, `RelationsSchemaModal.tsx`.
  - `ExcelImportModal.tsx` — импорт из файлов `.xlsx`/`.xls`/`.csv`.
  - `TemplatesModal.tsx` — каталог шаблонов (`Документы -> Шаблоны` по разделам и кнопка `«Шаблоны»` во вкладках для конкретной таблицы + архив).
  - `GeneratedDocsModal.tsx` — реестр сгенерированных документов по категориям + архив `АРХИВ/дд.мм.гггг`.
  - `TagsModal.tsx`, `NormativeDocsModal.tsx`, `LLMStudioModal.tsx`, `BackupModal.tsx`, `WindowsPortableModal.tsx`, `HelpModal.tsx`.

---

## 3. Текущий статус и оставшиеся доработки

Все задачи этапов 1–10 (`T-01`–`T-35`) завершены и покрыты автотестами (**53/53** в Vitest), проверкой TypeScript и браузерной верификацией (`playwright-cli`).

Оставшиеся незакрытые пункты за пределами `T-35`:
1. **`T-36` (отложено как отдельная доработка)**: детализация пакетного отчёта генерации документов в `TemplatesModal.tsx` с указанием конкретной записи (`rowIdentifier` / № строки), проблемного тега и причины ошибки.
2. **Финальная сборка Windows-бинарников**: в Linux-контейнере отсутствует MinGW-w64 (`x86_64-w64-mingw32-gcc` / `windres`), поэтому после `T-35` пересобран `public/app.html`, а `public/download/OT-Baza.exe` и `OT-Baza-Windows.zip` требуют пересборки командой `python3 build_native_windows.py` на среде с MinGW-w64 / Windows.

---

## 4. Команды сборки и верификации

```bash
npm run lint                      # tsc --noEmit (0 ошибок)
npm test                          # vitest run (53/53 тестов)
npm run build                     # vite build (dist/ + PWA)
python3 build_native_windows.py   # полная пересборка app.html, OT-Baza.exe, OT-Baza-Windows.zip и dist/ (требует MinGW-w64)
```

После любого изменения `src/*` или `launcher.c` необходимо запускать `python3 build_native_windows.py`, чтобы скачиваемые из интерфейса `OT-Baza.exe` и `OT-Baza-Windows.zip` оставались синхронизированы с кодовой базой.
