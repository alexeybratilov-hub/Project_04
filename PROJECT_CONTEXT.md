# PROJECT_CONTEXT — Технический контекст проекта «ОТ-База»

> Этот файл фиксирует фактическое состояние кодовой базы, архитектуры, сборочного конвейера и ключевых решений для быстрого и безопасного входа следующего агента в проект в соответствии с `AGENTS.md`.

## 1. Назначение и архитектура проекта

**«ОТ-База»** — портативное десктоп- и веб-приложение для ведения баз данных по охране труда с поддержкой нескольких изолированных юридических лиц (кроме общей нормативной базы), мастер-таблицами и зависимыми столбцами, генерацией документов DOCX/PDF по тегам, а также опциональной ИИ-студией (локальные LLM и облачные API).

### Технологический стек
- **Frontend**: React 19, TypeScript, Vite 8 (`vite.config.ts`, `vite.offline.config.ts`), Tailwind CSS v4 (`@tailwindcss/vite`), `lucide-react`, `motion`.
- **Шрифты**: `Manrope` + `JetBrains Mono` подключаются локально через `@fontsource-variable/*` (без внешних CDN — приложение должно выглядеть одинаково офлайн).
- **Документы и таблицы**: собственный OOXML-парсер и генератор `ooxmlWorkbookService.ts` на базе `fflate` (импорт/экспорт `.xlsx`/`.xlsm`/`.csv` с поддержкой Win-1251, без уязвимого пакета `xlsx`), `docx` (генерация Word `.docx`), `jspdf` (генерация PDF со встроенным кириллическим шрифтом `DejaVuSans` в `src/data/cyrillicFont.ts`), `fflate` (также разбор OOXML для `.docx`-шаблонов и сборка `.zip`-пакетов в `zipExportService.ts`). `docx`, `jspdf` и шрифты PDF загружаются лениво (`await import()`) и не попадают в стартовый бандл.
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
- `DECISIONS.md` — зафиксированные архитектурные решения (портативный `OT-Baza.exe`, логика `DataGrid`, `DejaVuSans`, этапы 5–6, технический аудит, модули и обязательства).
- `ROADMAP.md` — поэтапный план работ (этапы 0–11, трек дизайна D-1–D-6, модульный этап 12).
- `TASKS.md` — трекер задач `T-01`–`T-49`, модульный трек `M-01`–`M-10` и дизайн-трек `D-1`–`D-6`.
- `HANDOFF.md` — точка передачи дел: фактическое состояние, инварианты, что проверено и что осталось, ограничения среды.
- `AGENT_HANDOFF_PROMPT.md` — готовый стартовый промпт для передачи дел следующему агенту.
- `launcher.c`, `resources.rc`, `build_native_windows.py` — исходник Win64 HTTP-сервера/лаунчера и полный скрипт сборки (`app.html` -> `OT-Baza.exe` -> `OT-Baza-Windows.zip` -> `dist/`).
- `package.json`, `tsconfig.json`, `vite.config.ts`, `vite.offline.config.ts`.

### Нативный портативный клиент (`native/`, WinForms, без web-движка)
- `native/PortablePaths.cs` — где лежат данные: настоящая проба записи рядом с EXE, резервная папка `%LOCALAPPDATA%\OT-Baza`, имя `Mutex` для одного экземпляра, отчёт `--portable-check`.
- `native/Store.cs` — база `data/ot_database.json`: чтение/запись, атомарная замена с повтором, `ot_database_prev.json` + дневные копии с ротацией, каталог пользовательских модулей.
- `native/Program.cs` — вход: `--portable-check`, `--selftest` (41 проверка), `--import-test`, замок единственного экземпляра, запуск окна.
- `native/MainForm.cs`, `native/Views.cs`, `native/Card.cs`, `native/Dialogs.cs`, `native/Glass.cs`, `native/Preview.cs` — оболочка Liquid Glass, таблицы, карточка работника, модалки, просмотр DOCX.
- `native/OrganizationForm.cs` — организации (несколько юрлиц, переключение, реквизиты); `native/Store.cs` — `CreateOrganization` / `SetActiveEntity` / `EnsureModuleTabs`.
- `native/TemplatesForm.cs` — шаблоны документов: встроенные и свои, редактор с тегами, формирование DOCX по работнику.
- `native/NormsView.cs` — экран «Нормативная база»: требования, события, сроки/периодичность, нормативные основания, поиск.
- `native/GitReadiness.cs` + `native/ReadinessView.cs` — самопроверка готовности к проверке ГИТ: 9 направлений, 100 баллов, экспорт PDF/CSV.
- `native/DocxTemplateService.cs` — подстановка тегов в готовые `.docx`-бланки (по абзацу, а не по прогону);
- `native/PdfFont.cs` + `native/PdfWriter.cs` — PDF с кириллицей: разбор TrueType, встраивание шрифта (CIDFontType2/Identity-H/ToUnicode), A4, таблицы, страницы;
- `native/XlsxReader.cs` / `native/XlsxWriter.cs` — импорт и экспорт Excel без библиотек; `native/DateText.cs` — нормализация дат к ISO; `native/CsvExport.cs` — экранирование CSV (в т.ч. защита от формул).
- `native/DocxService.cs` — генерация DOCX по шаблонам (`{Тег}`, `[ТАБЛИЦА]…[/ТАБЛИЦА]`) в `documents/<Категория>/`.
- `native/Obligations.cs`, `native/Employees.cs`, `native/modules.json` — правила обязательств, чтение карточек, каталог модулей (встроен ресурсом в EXE).

### Типы и данные (`src/types/`, `src/data/`)
- `src/types/database.ts`:
  - `DatabaseState`: `activeEntityId`, `entities: LegalEntity[]`, общая `normativeDocs: AttachedDoc[]`, зеркала активного юрлица (`tabs`, `tags`, `templates`, `generatedDocs`, `employeeObligations`, `employeeEvents`, `auditLog`, `llmConfig`, `llmLogs`, `settings`).
  - `LegalEntity` + `LegalEntityProfile` (13 реквизитов предприятия), `AuditLogEntry` / `AuditLogAction` / `AuditLogFieldChange`.
  - `Tab`, `Column` (`text | number | date | select | boolean | link | relation | deadline_control`, `width`, `relation: { masterTabId, masterColumnId }`), `Row`.
  - `DocumentTemplate` (`tabId`, `category`, `namingPattern`, `contentTemplate`, `tableRepeatField`, `isArchived`, `archivedAt`, `archivedFromTabName`).
  - `GeneratedDocRecord` (`category`, `format`, `dateFormatted`, `relativePath`, `isArchived`, `archiveDateFolder`, `sourceTabId`, `sourceTabName`).
  - `LLMConfig` (`providerId`, `providerKind`, `apiFormat: 'ollama' | 'openai' | 'anthropic' | 'gemini'`, `endpoint`, `model`, `apiKey`, `status`, `errorMessage`).
- `src/data/initialDatabase.ts`, `public/initial_db.json` — стартовая структура и пресеты.
- `src/data/builtInTemplates.ts` — 10 встроенных шаблонов (8 индивидуальных + 2 групповых протокола/листа ознакомления, динамические теги реквизитов юрлица).
- `src/data/builtInNormativeDocs.ts` — встроенные нормативные акты.
- `src/data/occupationNorms.ts` — справочник отраслевых связок `Должность → Вредные факторы (29н) → Нормы СИЗ (766н)`.
- `src/data/llmProviders.ts` — пресеты локальных серверов (Ollama, LM Studio, vLLM/LocalAI, Custom Local) и облачных API (OpenAI, Claude, Gemini, DeepSeek, OpenRouter, Groq, Custom API).
- `src/data/cyrillicFont.ts` — локальный `DejaVuSans` (Regular + Bold) в base64 для `jsPDF`.

### Сервисы (`src/services/`) и тесты (`src/services/__tests__/`)
- `localApiClient.ts` — HTTP-клиент к локальному API (`GET/PUT /api/database`, `/api/files/*`, `POST /api/files-move/documents`, `/api/heartbeat`, `/api/shutdown`).
- `storageService.ts` + `storageService.test.ts` — загрузка/сохранение БД, нормализация, клонирование/создание юрлиц, синхронизация зеркал, однократная миграция, защита JSON от prototype pollution (`parseSafeJson`), шифрованные резервные копии (`PBKDF2-SHA256` + `AES-256-GCM`) и журнал аудита (`MAX_AUDIT_LOG_ENTRIES = 1000`).
- `integrityService.ts` + `integrityService.test.ts` — аудит связей Мастер↔Подчинённая, проверка влияния удаления строк/столбцов/вкладок (`getTabDeleteImpact` с учётом шаблонов и документов), каскадная очистка висячих `relation` и тегов, генерация уникальных ID.
- `ooxmlWorkbookService.ts` — чистый TypeScript OOXML-парсер и генератор `.xlsx`/`.xlsm`/`.csv` на базе `fflate` (без зависимости `xlsx`).
- `excelService.ts` + `excelService.test.ts` — экспорт/импорт Excel и CSV (включая Win-1251), пресет импорта **1С:ЗУП** с автосозданием должностей, позиционная вставка из буфера Excel (`parseInlineClipboardPaste`), обратимый одноколоночный импорт/экспорт `deadline_control`.
- `documentGenerator.ts` + `documentGenerator.test.ts` — подстановка тегов юрлица и таблиц, экспорт `.docx` и кириллических `.pdf`, групповые документы с разметкой `[ТАБЛИЦА]...[/ТАБЛИЦА]`.
- `zipExportService.ts` — сборка `.zip`-архивов пакетов документов с санитизацией и дедупликацией путей.
- `gitReadinessService.ts` + `gitReadinessService.test.ts` — оценка готовности к проверке ГИТ по 9 категориям (100 баллов), ранжирование пробелов и экспорт отчёта в DOCX/PDF/XLSX.
- `deadlineService.ts` + `deadlineService.test.ts` — расчёт сроков, рабочие дни и предзагруженный производственный календарь РФ (`RF_PRODUCTION_CALENDAR_2026`/`2027`).
- `generatedDocsService.ts` + `generatedDocsService.test.ts` — регистрация сформированных документов, автоматическая архивация дублей в `<Категория>/АРХИВ/<дд.мм.гггг>/`.
- `ollamaService.ts` + `llmProviders.test.ts` — проверка подключения, обезличивание ПДн (152-ФЗ) с локальной ре-гидратацией ответа и генерация по 4 форматам (`ollama`, `openai`, `anthropic`, `gemini`).
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
  - `TagsModal.tsx`, `NormativeDocsModal.tsx`, `LLMStudioModal.tsx`, `BackupModal.tsx` (обычные и AES-256-GCM бэкапы), `AuditLogModal.tsx` (журнал изменений с диффом полей), `WindowsPortableModal.tsx` (инструкции по Authenticode/SmartScreen), `HelpModal.tsx`.

---

## 3. Текущий статус

Функционально реализованы задачи `T-01`–`T-49` (включая «Контроль сроков»), модульный трек `M-01`–`M-12`, дизайн-трек `D-1`–`D-5` в объёме v1–v2 и продуктовый/ИБ-пакет `P-01`–`P-06`. Актуальная проверка (2026-11-27): **196 тестов в 21 файле** (`pnpm test`), `tsc --noEmit` — 0 ошибок при `strict: true`, `vite build` проходит, `pnpm audit --prod` — 0 уязвимостей.

Стартовый (web) бандл ≈ 1.35 МБ (≈ 390 КБ gzip); шрифты PDF (`cyrillicFont`, 1.96 МБ) и `jspdf`/`docx` вынесены в отдельные ленивые чанки.

**Портативный сценарий (2026-11-27):** нативный клиент — `ОТ-База.exe` (≈258 КБ, `anycpu`) — переносится на флешке и запускается на любом ПК с Windows 10/11 без установки, прав администратора и интернета. Все данные, документы и бэкапы лежат рядом с EXE; при запрете записи — резервная папка с предупреждением. Основной функционал (сроки, нормативка, списки, шаблоны, импорт/экспорт Excel и CSV) работает без ИИ и без сети. Проверки: `--selftest` 41/41, `--portable-check` exit 0, экспорт проверен `openpyxl`.

Оставшиеся незакрытые пункты:
1. **`T-36`** — выполнен (пакетный отчёт генерации с изоляцией сбоев по строкам, `BatchGenerationReportPanel.tsx`).
2. **Windows-релиз**: `OT-Baza.exe` / `OT-Baza-Windows.zip` не собираются в этой среде (нет MinGW-w64) и намеренно **не хранятся в git**; собираются командой `python build_native_windows.py` на Windows. Живой прогон нативного сервера, DPI 125/150 % и работа с `./templates/` в Word/LibreOffice остаются за пределами автоматических проверок.
3. **UX/UI Redesign** `D-5` (финальная гармонизация таблиц) и `D-6` (матрица 18 комбинаций) не завершены.

---

## 4. Команды сборки и верификации

```bash
pnpm lint                          # tsc --noEmit (strict)
pnpm test                          # vitest run (196 тестов, 21 файл)
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
- Удалены мёртвые зависимости (`@google/genai`, `dotenv`, `express`, `motion`, `autoprefixer`, `esbuild`, `tsx`), build-пакеты перенесены в `devDependencies`; манифест переименован в `ot-baza@1.4.0`.
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

---

## 8. Модульная архитектура и обязательства (2026-11-25)

**Модель.** `ModuleDefinition` (`src/data/modules.ts`) описывает этап: `id`, `title`, `tabId`, `base`. Вкладка хранит `moduleId`; `settings.installedModules` перечисляет включённые модули. `moduleService` умеет `installModule` (создаёт отсутствующую вкладку клонированием эталонной структуры из `INITIAL_TABS`, добавляет шаблоны модуля, включает его) и `disableModule` (скрывает вкладку, данные остаются). `getVisibleTabs` — единственный источник видимых вкладок для `App`/`TabBar`.

**Совместимость.** Если в старой базе нет `installedModules`, нормализация выводит набор из фактически присутствующих вкладок — обновление ничего не прячет. Новая база (`INITIAL_DATABASE_STATE`, `public/initial_db.json`) стартует с `['staffing', 'employees']`.

**Обязательства.** `EmployeeObligation` хранится в `DatabaseState.employeeObligations` и зеркалируется в `LegalEntity` (как `generatedDocs`). Матрица `HIRE_OBLIGATION_RULES` задаёт требования: модуль, вид (`deadline`/`document`), смещение от даты приёма, периодичность и норму. `ensureHireObligations` идемпотентна (ключ `obl_<rowId>_<ruleId>`), `completeObligation` создаёт следующую периодическую задачу, `rescheduleObligationsForHireDate` пересчитывает только незакрытые сроки, `detectControlViolations` формирует контрольные точки «документ не оформлен к сроку».

**Генерация пакета.** Для документа-обязательства из карточки работника: шаблон по `templateId` → при необходимости создаётся связанная строка в таблице модуля (`buildLinkedRow`: связи на «Сотрудников» заполняются ФИО, даты — датой приёма) → `documentGenerator.resolveTemplateTagsDetailed` + `generateDocx` → регистрация в реестре (`generatedDocId`) → отметка «Выполнено» остаётся за пользователем.

**UI.** «Сотрудники» — отдельный экран модуля (`EmployeesView`) с прогрессом пакета, поиском и массовым расчётом; карточка работника (`EmployeeCardModal`) — редактирование реквизитов, чек-лист по модулям, генерация документов; «Модули этапов» (`ModulesModal`) — включение/отключение этапов; «Главная» — блок «Пакеты документов» и контрольные точки.

---

## 9. События жизненного цикла, матрица по условиям труда и файловое хранение (2026-11-25)

**События.** `EmployeeEvent` (`type`: `hire` | `transfer` | `dismissal` | `incident`, `date`, `note`) хранится в `DatabaseState.employeeEvents` и зеркалируется в юрлицо. `ensureEventObligations` создаёт требования по правилам события; id обязательства включает `eventId`, поэтому повторное событие даёт новый пакет, а повторная регистрация того же события — идемпотентна. `EMPLOYEE_EVENT_LABELS` — подписи, `getLatestEvent`/`isEmployeeDismissed` — статус работника.

**Матрица.** `ObligationRule` получил `event`, `condition` (`positionMatches`, `excludePositionMatches`, `soutClassIn`) и `periodicityBySoutClass`. `resolveEmployeeContext` определяет должность и класс условий труда по штатному расписанию; `ruleApplies` фильтрует требования; `resolvePeriodicity` выбирает периодичность (2.0 — 24 мес., 3.x — 12 мес.; обучение руководителей — 36 мес.).

**Шаблоны.** Добавлены встроенные текстовые шаблоны: приказ о приёме, приказ о переводе, приказ об увольнении, акт о несчастном случае. Для дат события используется системный тег `{Дата_события}` (резолвер `documentGenerator` + опция `eventDateIso`). Теги `{Дата_приёма}` и `{СНИЛС}` добавлены в `INITIAL_TAGS` и автоматически достраиваются при нормализации, если во вкладке «Сотрудники» есть соответствующие столбцы.

**Файлы.** В `handleRecordGeneratedDoc` при подключённой рабочей папке документ дополнительно пишется в `documents/<Категория>/<файл>` через `workspaceFolderService.writeBinaryFile`; ошибка записи показывается предупреждением, но не отменяет регистрацию документа.

**Проверки.** 196 тестов (21 файл), `tsc --noEmit` — 0 ошибок, `vite build`. Сквозные браузерные сценарии: приём → 8 требований → пакет из 4 документов; перевод +3 требования; увольнение +3 и баннер «уволен»; рабочая папка получает `data/ot_database.json`, бэкап и `documents/<Категория>/*.docx`.

---

## 10. Дизайн v2: гибридная навигация, превью вкладок и режим эффектов (2026-11-25)

- **Сайдбар** (`src/components/Sidebar.tsx`): стеклянная левая панель 236 px / 64 px (свёрнуто), разделы «Обзор» (Главная, Контроль сроков со счётчиком) и «Этапы» (включённые модули), внизу — «Модули этапов», «Рабочая папка» и переключатель эффектов. Свёрнутость хранится в `AppSettings.sidebarCollapsed`.
- **Превью вкладок** (`src/components/TabPreviewPopover.tsx`): портал с реальными данными вкладки, задержка открытия 280 мс и закрытия 180 мс (с отменой при входе курсора в поповер), закрытие по `Escape`/уходу, прижатие к границам окна.
- **Режим эффектов**: `AppSettings.visualEffects: 'glass' | 'reduced'`; атрибут `data-visual-effects` на `<html>` отключает `backdrop-filter`, тени и hover-трансформации. Системные `prefers-reduced-transparency`/`prefers-reduced-motion` действуют независимо.
- **Модалки**: панель `AppModal` переведена на полупрозрачную подложку (`bg-white/95`, `backdrop-blur-xl`), радиус 16 px, усиленный оверлей с размытием; содержимое осталось на плотной поверхности.
- Проверки: `tsc --noEmit` — 0 ошибок, 196 тестов, `vite build`; браузерные проверки — сайдбар 236→64 px, навигация, превью с реальными данными, `data-visual-effects="reduced"`, отсутствие горизонтального переполнения на 1440×950 и 1366×768, 0 ошибок консоли.

---

## 11. Продуктовые доработки, готовность к ГИТ и B2B/ИБ-усиление (2026-11-26)

- **152-ФЗ в ИИ-студии (`ollamaService.ts`, `LLMStudioModal.tsx`)**: перед отправкой промпта в облачную модель ПДн (ФИО, СНИЛС, ИНН, контакты) подменяются детерминированными токенами `[ФИО_1]` и др., а полученный ответ локально ре-гидратируется (`rehydrateAnonymizedText`) без отправки исходных ПДн во внешние API.
- **Связка `Должность → Факторы 29н → СИЗ 766н` (`src/data/occupationNorms.ts`, `obligationService.ts`, `EmployeeCardModal.tsx`)**: справочник типовых должностей с автоподстановкой факторов и норм и пересчётом требований в карточке работника.
- **Пакетный ZIP-экспорт и групповые документы (`zipExportService.ts`, `documentGenerator.ts`, `builtInTemplates.ts`)**: выгрузка выбранных/пакетных документов в один `.zip`-архив с санитизацией путей и два групповых шаблона (`tpl_group_protocol_knowledge`, `tpl_group_lna_signoff`) с поддержкой `[ТАБЛИЦА]...[/ТАБЛИЦА]` в DOCX и PDF.
- **Пресет импорта 1С:ЗУП (`excelService.ts`, `ExcelImportModal.tsx`)**: автоматическое сопоставление кадровых колонок 1С и досоздание недостающих должностей в штатном расписании.
- **Готовность к проверке ГИТ и календарь РФ 2026–2027 (`gitReadinessService.ts`, `DashboardView.tsx`, `deadlineService.ts`, `DeadlineControlView.tsx`)**: скоринг по 9 направлениям (100 баллов), ранжирование пробелов с переходами к проблемным разделам, экспорт отчёта в DOCX/PDF/XLSX и предзагрузка праздников РФ 2026–2027.
- **Отказ от `xlsx` и ИБ-защита (`ooxmlWorkbookService.ts`, `storageService.ts`, `BackupModal.tsx`, `AuditLogModal.tsx`, `WindowsPortableModal.tsx`, `HelpModal.tsx`)**: уязвимая зависимость `xlsx@0.18.5` удалена (0 уязвимостей по `pnpm audit --prod`), импорт/экспорт `.xlsx`/`.xlsm`/`.csv` переведён на `ooxmlWorkbookService.ts` поверх `fflate`, парсинг JSON защищён от `__proto__`/`constructor`/`prototype`, бэкапы поддерживают шифрование `PBKDF2-SHA256` (210 000 итераций) + `AES-256-GCM`, добавлен журнал аудита изменений (до 1000 записей с экспортом в `.xlsx`) и документация по подписи Windows EXE (`signtool.exe`).
- **Проверки**: `pnpm test` — **196/196 тестов** (21 файл), `pnpm lint` — 0 ошибок, `pnpm build` — успешно, `pnpm audit --prod` — 0 уязвимостей.
