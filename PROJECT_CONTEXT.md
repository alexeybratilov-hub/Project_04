# PROJECT_CONTEXT — Технический контекст проекта «ОТ-База»

> Этот файл фиксирует фактическое состояние кодовой базы, архитектуры, сборочного конвейера и ключевых решений для быстрого и безопасного входа следующего агента в проект в соответствии с `AGENTS.md`.

## 1. Назначение и архитектура проекта

**«ОТ-База»** — портативное десктоп- и веб-приложение для ведения баз данных по охране труда с поддержкой нескольких изолированных юридических лиц (кроме общей нормативной базы), мастер-таблицами и зависимыми столбцами, генерацией документов DOCX/PDF по тегам, а также опциональной ИИ-студией (локальные LLM и облачные API).

### Технологический стек
- **Frontend**: React 19, TypeScript, Vite 8 (`vite.config.ts`, `vite.offline.config.ts`), Tailwind CSS v4 (`@tailwindcss/vite`), `lucide-react`, `motion`.
- **Шрифты**: `Manrope` + `JetBrains Mono` подключаются локально через `@fontsource-variable/*` (без внешних CDN — приложение должно выглядеть одинаково офлайн).
- **Документы и таблицы**: `xlsx` (импорт/экспорт Excel/CSV с поддержкой Win-1251), `docx` (генерация Word `.docx`), `jspdf` (генерация PDF со встроенным кириллическим шрифтом `DejaVuSans` в `src/data/cyrillicFont.ts`), `fflate` (разбор OOXML для готовых `.docx`-шаблонов). `docx`, `jspdf` и шрифты PDF загружаются лениво (`await import()`) и не попадают в стартовый бандл.
- **Нативный Windows-рантайм**: `launcher.c` + `resources.rc` -> кросс-компиляция `x86_64-w64-mingw32-gcc` в 64-битный GUI PE `public/download/OT-Baza.exe` и пакет `public/download/OT-Baza-Windows.zip`.
- **Тестирование**: Vitest 5.1 (`pnpm test` -> `vitest run`), TypeScript strict (`pnpm lint` -> `tsc --noEmit`).

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
- Дизайн-система (`src/components/ui/`): `AppModal.tsx`, `AppButton.tsx`, `AppInput.tsx`, `FormField.tsx`, `InlineConfirm.tsx`, `StatusBanner.tsx`, `ConfirmDialog.tsx`, `ToastProvider.tsx`, `ErrorBoundary.tsx`, `modalStack.ts`, `zIndex.ts`. Все 14 модальных окон (плюс `MasterJumpDialog` и `TagCatalogDrawer` как оверлеи) унифицированы на этих примитивах с поддержкой focus-trap, LIFO `Escape` и `dirty-guard`; `FormField` сам связывает label с контролом (`useId` + `aria-describedby`).
- Модальные окна управления структурой и данными:
  - `LegalEntityModal.tsx` — карточка юрлица (создание, редактирование 13 реквизитов, клонирование).
  - `NewTabModal.tsx`, `ColumnEditorModal.tsx`, `MasterDependenciesModal.tsx`, `RelationsSchemaModal.tsx`.
  - `ExcelImportModal.tsx` — импорт из файлов `.xlsx`/`.xls`/`.csv`.
  - `TemplatesModal.tsx` — каталог шаблонов (`Документы -> Шаблоны` по разделам и кнопка `«Шаблоны»` во вкладках для конкретной таблицы + архив).
  - `GeneratedDocsModal.tsx` — реестр сгенерированных документов по категориям + архив `АРХИВ/дд.мм.гггг`.
  - `TagsModal.tsx`, `NormativeDocsModal.tsx`, `LLMStudioModal.tsx`, `BackupModal.tsx`, `WindowsPortableModal.tsx`, `HelpModal.tsx`.

---

## 3. Текущий статус

Функционально реализованы все задачи `T-01`–`T-49` (включая «Контроль сроков» и уведомления) и трек документации `D-1`. Актуальная проверка: **145 тестов в 17 файлах** (`pnpm test`), `tsc --noEmit` — 0 ошибок при `strict: true`, `vite build` проходит.

Стартовый (web) бандл ≈ 1.35 МБ (≈ 390 КБ gzip); шрифты PDF (`cyrillicFont`, 1.96 МБ) и `jspdf`/`docx` вынесены в отдельные ленивые чанки.

Оставшиеся незакрытые пункты:
1. **`T-36`** — выполнен (пакетный отчёт генерации с изоляцией сбоев по строкам, `BatchGenerationReportPanel.tsx`).
2. **Windows-релиз**: `OT-Baza.exe` / `OT-Baza-Windows.zip` не собираются в этой среде (нет MinGW-w64) и намеренно **не хранятся в git**; собираются командой `python build_native_windows.py` на Windows. Живой прогон нативного сервера, DPI 125/150 % и работа с `./templates/` в Word/LibreOffice остаются за пределами автоматических проверок.
3. **UX/UI Redesign** `D-2`–`D-6` не начат (см. раздел 5).

---

## 4. Команды сборки и верификации

```bash
pnpm lint                          # tsc --noEmit (strict)
pnpm test                          # vitest run (145 тестов, 17 файлов)
pnpm build                         # vite build (dist/ + PWA)
pnpm check                         # lint + test + build

python build_native_windows.py --skip-native   # dist-offline/ + public/app.html + dist/
python build_native_windows.py                 # + OT-Baza.exe и ZIP (нужен MinGW-w64)
```

`public/app.html` (офлайн-однофайловик) и `dist/` — генерируемые артефакты, в git не хранятся. После любого изменения `src/*` или `launcher.c` их нужно пересобрать, чтобы скачиваемые файлы соответствовали коду.

---

## 5. Направление UX/UI Redesign (этапы `D-1` — `D-6`)

В рамках этапа **D-1** спроектирован переход интерфейса «ОТ-База» к стилю **Apple Liquid Glass** («Полупрозрачная оболочка — кристально чёткие данные») с главным экраном **Dashboard**, гибридной навигацией (единая верхняя панель `44px` + сворачиваемый левый сайдбар `236px` / `60px`) и интерактивными виджетами предпросмотра вкладок при наведении при сохранении всех моделей данных и бизнес-логики (`T-01`–`T-49`).

Полная спецификация вынесена в отдельные документы:
- `DESIGN_SYSTEM.md` — трёхслойная модель (`Canvas / Glass Chrome / Crisp Data`), токены Light/Dark, типографика, режим `reduced`, `z-index` и доступность.
- `UX_CONCEPT.md` — аудит текущего UX, информационная архитектура Dashboard, правила гибридной навигации и матрица виджетов предпросмотра вкладок.
- `UI_ACCEPTANCE.md` — критерии приёмки для этапов `D-1`–`D-6` и матрица проверки разрешений/DPI/тем.
- `docs/d1_liquid_glass_prototype.html` — статический интерактивный визуальный прототип концепции (вне `src/` и `public/`).


---

## 6. Технический аудит 2026-11-25: что исправлено

Аудит проведён по 5 направлениям (архитектура и данные, фронтенд, нативный C-слой, UX/доступность, документация/гигиена репозитория).

**Сохранность данных**
- Импорт Excel: даты больше не сдвигаются на −1 день (`toISOString()` заменён на локальные компоненты даты); пустой заголовок в строке шапки больше не сдвигает колонки, дубли заголовков разводятся суффиксом `(2)`.
- Импорт/вставка не подменяют невалидные значения: нечисло в числовом столбце и текст в дате отклоняются с отчётом о расхождениях (`convertCellToColumnType`), вместо прежней подстановки `0`/`false`/сырого текста.
- Миграция `localStorage → диск` очищает браузерную копию только после подтверждённой записи.
- `restoreDatabaseSafely` / `resetDatabaseAsync` дожидаются очереди сохранений (`saveQueueRef`), чтобы отложенная запись не откатила восстановление.
- Реестр сгенерированных документов обновляется мержем по `id` от актуального состояния, а не перезаписью снимка, взятого до `await`.
- Документы привязаны к вкладке по `sourceTabId` (с fallback на имя для старых записей) — переименование вкладки больше не «осиротляет» документы.

**Нативный слой (`launcher.c`)**
- Браузер запускается только по абсолютному пути из известных каталогов Edge/Chrome (устранён planting `msedge.exe` рядом с программой) и без наследования рабочего каталога приложения (`lpDirectory = NULL`).
- Teardown дожидается завершения клиентских потоков (счётчик `g_activeClients`, инкремент в accept-потоке) — больше нет `DeleteCriticalSection`/`WSACleanup` под живым потоком.
- Добавлен `SO_EXCLUSIVEADDRUSE` до `bind` (с блокировкой старта при ошибке) и `SecureZeroMemory` для токена при выходе.

**UI/UX и доступность**
- `Ctrl+V` больше не вставляет строки в таблицу за открытой модалкой.
- `Ctrl+S` / `Ctrl+N` / `Ctrl+F` работают в русской раскладке (`e.code`) и не срабатывают при открытой модалке или в полях ввода.
- Добавлен `ErrorBoundary` с кнопкой «Скачать копию данных (JSON)».
- `FormField` связывает подпись и контрол (`htmlFor`/`id`, `aria-invalid`, `aria-describedby`, `role="alert"`).
- Исправлен невалидный Tailwind-класс `py-0.2`.

**Сборка, зависимости, репозиторий**
- Добавлена отсутствовавшая зависимость `fflate` (без неё чистый клон не проходил `tsc`).
- Включён `strict` + `noUnusedLocals`/`noUnusedParameters` в `tsconfig.json`; удалён неиспользуемый алиас `@/*`.
- Удалены мёртвые зависимости (`@google/genai`, `dotenv`, `express`, `motion`, `autoprefixer`, `esbuild`, `tsx`), build-пакеты перенесены в `devDependencies`; манифест переименован в `ot-baza@1.3.0`.
- Шрифты переведены на локальные `@fontsource-variable/*` — внешний Google Fonts CDN удалён.
- Из git убраны генерируемые артефакты (≈25 МБ): `dist-offline/`, `public/app.html`, `public/download/*.exe|.zip`, `resources.o`, `test_*.exe`, `test_launcher.js`, `bun.lock`, `metadata.json`, копии AI Studio-инструкций и неиспользуемые концепт-рендеры.
- `build_native_windows.py` переписан: проверка Node/MinGW, режим `--skip-native`, сборка `dist/` до упаковки, SHA-256 артефактов, ZIP больше не кладёт демо-БД в `data/`.
- Кнопки скачивания `.exe`/`.zip` проверяют наличие файла и отключаются, если Windows-сборки нет в поставке.

---

## 7. Дизайн v1: Liquid Glass + Bento (2026-11-25)

Реализован первый срез визуальной системы, объединяющий «жидкое стекло» и bento-сетку.

**Токены и утилиты (`src/index.css`)**
- Трёхслойная модель сохранена: `Canvas` (градиентный фон с цветными блобами) → `Glass Chrome` (`.lg-chrome`) → `Crisp Data` (`.lg-data-surface`).
- Палитра Light/Dark через CSS-переменные (`--lg-surface`, `--lg-border`, `--lg-inner-highlight`, `--lg-shadow-*`, `--lg-blur`), радиусы `--lg-radius-card` (22px) и `--lg-radius-chrome` (16px).
- Утилиты `.lg-card`, `.lg-card-interactive`, `.lg-data-surface`; при `prefers-reduced-transparency` стекло заменяется плотной подложкой, при `prefers-reduced-motion` отключаются трансформации.

**Оболочка**
- `TitleBar`, `MenuBar`, `TabBar`, `StatusBar` переведены на полупрозрачные поверхности с `backdrop-blur`; корневой контейнер приложения прозрачный, чтобы работал canvas.
- Таблицы (`DataGrid`) и `DeadlineControlView` остаются на непрозрачной подложке — читаемость данных не sacrificed.

**Главная (bento) — `DashboardView.tsx` + `SYSTEM_DASHBOARD_TAB_ID`**
- Новая закреплённая системная вкладка «Главная», открывается при старте; вторая системная вкладка («Контроль сроков») сохранена.
- `TabBar` переведён на список системных вкладок (`SYSTEM_TAB_IDS`), клавиатурная навигация учитывает обе.
- Карточки: герой-карточка рабочего пространства, 4 KPI, лента ближайших/просроченных событий (реальные данные `deadlineService.collectDeadlineEvents`), организации с переключением, быстрые действия (шаблоны, документы, бэкап, сроки), недавние документы, обзор таблиц с переходом.
- Все показатели берутся из `DatabaseState` и `deadlineService` — дублирующей логики и фейковых цифр нет.

**Не входит в v1 (следующие шаги)**: гибридная навигация с сайдбаром и превью вкладок (D-4), полная гармонизация 14 модалок и таблиц (D-5), матрица 18 комбинаций и `visualEffects: 'glass' | 'reduced'` в настройках (D-2/D-6).
