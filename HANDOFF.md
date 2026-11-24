# HANDOFF — Журнал передачи и верификации ОТ-База

Дата актуализации: 2026-11-23  
Репозиторий / рабочая папка: `/app/applet` (в контейнере отсутствует `.git`)

## 1. Документация для начала работы следующего агента (читать в таком порядке)
> **Для экономии контекста и токенов** при переходе к этапам **D-2 — D-6** не перечитывайте весь репозиторий заново — достаточно:
1. `HANDOFF.md` (этот файл — актуальная точка входа, ограничения и точный объём следующего этапа).
2. `DESIGN_SYSTEM.md` и `UX_CONCEPT.md` (утверждённая дизайн-система Liquid Glass, архитектура Dashboard и гибридной навигации).
3. `UI_ACCEPTANCE.md` (критерии приёмки и матрица проверок 18 комбинаций разрешений/DPI/тем).
4. `AGENTS.md` и `AGENT_HANDOFF_PROMPT.md` (правила команды и запреты на ломку бизнес-логики; `MASTER_PROMPT.md` / `AGENT_GUIDE.md` в репозитории отсутствуют — их роль выполняют эти два файла).
5. `PROJECT_CONTEXT.md`, `DECISIONS.md`, `ROADMAP.md`, `TASKS.md` — открывать точечно при изменении смежных модулей (`T-01`–`T-49`, `D-1`–`D-6`).

---

## 2. Текущее состояние проекта
- **Завершённые этапы**:
  - **P0/P1 (Этапы 1–4)**: нативный `OT-Baza.exe` со встроенным loopback HTTP-сервером `127.0.0.1`, атомарной записью `./data/ot_database.json`, ротацией бэкапов, безопасностью `Host`/`Origin`/`X-OT-Token`, миграцией из `localStorage`, сервисом ссылочной целостности `integrityService.ts`, поддержкой нескольких юрлиц, PDF на кириллице (`DejaVuSans`).
  - **Этап 5**: мульти-провайдер LLM, индикатор статуса LLM в `MenuBar`, `«Генерация документов»`, реестр `«Сгенерированные документы»` с версионным архивом `<Категория>/АРХИВ/<дд.мм.гггг>/` на диске и в БД.
  - **Этап 6**: каталог шаблонов `TemplatesModal.tsx`, архивирование/удаление вкладки, прямая позиционная вставка `Ctrl+V` из Excel.
  - **Этапы 7–10 (`T-25`–`T-35`)**: полные кортежи связей и защита каскадов, безопасный импорт/восстановление БД + предсбросовый бэкап, FIFO-очередь записи, усиленный `launcher.c` (64-битные тики, RFC 8259 JSON-парсер, JSON-экранирование, `ToWin32PathW`), единая дизайн-система `src/components/ui/*` во всех 15 модалках, адаптация рабочего пространства под `1366×768` / `1920×1080` и масштабирование `125%/150%`, эргономика `DataGrid`, `dirty-guard` форм, журнал `LLMStudioModal` с `fullOutput`, авто-маппинг/дубли `ExcelImportModal`, клавиатурная доступность `MenuBar`/`TabBar` и восстановление архивных документов в `GeneratedDocsModal`.

- **Актуальные артефакты сборки**:
  - `public/app.html` — пересобран из финального кода (`5 498 099` байт).
  - `dist/` и `dist-offline/` — пересобраны из финального кода.
  - `public/initial_db.json` — актуализирован с категориями встроенных шаблонов и тегом `{Подразделение}`.
  - `public/download/OT-Baza.exe` (`5 657 088` байт) и `public/download/OT-Baza-Windows.zip` (`4 447 573` байт) — **не пересобраны в текущем контейнере**, т.к. отсутствуют `x86_64-w64-mingw32-gcc`, `x86_64-w64-mingw32-windres` и `wine` (бинарники в `public/download/` содержат состояние до финальных правок `T-28`–`T-35` и требуют запуска `python3 build_native_windows.py` на машине с MinGW-w64 / Windows).

---

## 3. Итоги финальной верификации (`T-35`, `2026-11-19`)
- **Автотесты (`npx vitest run`)**: **53/53** тестов пройдено (7 файлов, включая новые тесты `T-35` предсбросового бэкапа в `storageService.test.ts`).
- **TypeScript (`npm run lint` / `tsc --noEmit`)**: 0 ошибок.
- **Сборка (`npm run build` + `vite.offline.config.ts`)**: успешно (`dist/`, `dist-offline/`, `public/app.html`).
- **Проверка `launcher.c` на хостовом `gcc -std=c11 -Wall -Wextra -Werror`**: чистая C-логика `T-28` (`IsValidDatabaseJson` на реальном `public/initial_db.json` и невалидных/BOM/глубоких JSON, `ExtractRuntimePortAndToken`, `JsonAppendEscaped`, `UrlDecodeUtf8`, `ToWin32PathW` с `\\?\` и `\\?\UNC\`) скомпилирована и пройдена без предупреждений и ошибок (`LAUNCHER_C_HARNESS_OK`).
- **Браузерная E2E и визуальная проверка (`playwright-cli` + Chromium против `http://127.0.0.1:3000`, 0 `console.error` и 0 `pageerror`)**:
  - Разрешения `1920×1080`, `1366×768`, `1536×864` (1920@125%), `1280×720` (1920@150%), `1093×614` (1366@125%): отсутствие горизонтального переполнения страницы, видимость панелей/кнопок, корректная фиксация `sticky right-0` колонки действий при горизонтальной прокрутке, корректное размещение модалок (`TemplatesModal`) в области просмотра;
  - Клавиатурная навигация `MenuBar` (`role="menubar"`, `ArrowRight`, `ArrowDown`, `Escape` с возвратом фокуса) и `TabBar` (`ArrowRight`, `Home`, `End`, `Shift+F10` контекстное меню, `Escape` с возвратом фокуса на вкладку);
  - Стек модальных окон и порядок `Escape` + `dirty-guard` (`LegalEntityModal`, `NewTabModal`, `ColumnEditorModal`, `TemplatesModal`);
  - Восстановление документа из `АРХИВ` в актуальные (`GeneratedDocsModal`: `1 -> архив -> 1 актуальный`);
  - `DataGrid`: переключение плотности с сохранением после перезагрузки, просмотр длинной ячейки целиком, безопасный переключатель `boolean` (`role="switch"`), безопасный `'link'` с блокировкой `javascript:`;
  - `ExcelImportModal`: загрузка многолистового `.xlsx`, переключение листов, обнаружение дубликатов.

---

## 4. Журнал этапов и текущее состояние (`T-25`–`T-44`, планирование «Контроля сроков»)
- **T-25..T-35**: реализованы и приняты пользователем (детали в `TASKS.md` и `ROADMAP.md`).
- **T-36..T-44 (приняты пользователем)**:
  - `T-37`: надёжность сохранения БД, heartbeat и восстановление соединения (`launcher.c`, `localApiClient.ts`, `storageService.ts`).
  - `T-38`–`T-43`: перенос/изоляция заголовков, Drag-and-Drop файлов в модалках, безопасное inline-переименование столбцов, Excel-like выделение и TSV-копирование, Drag-and-Drop переупорядочивание столбцов и вкладок.
  - **`T-44` + `T-36` (приняты в рамках последнего релиза перед «Контролем сроков»)**: поддержка готовых `.docx`-шаблонов (`docxTemplateService.ts`, каталог тегов, хранение в `./templates/` / `dataBase64`) и подробный отчёт пакетной генерации (`BatchGenerationReportPanel.tsx`) с изоляцией сбоев по строкам.
- **Текущая фаза — «Контроль сроков» (`T-45`–`T-48` приняты; `T-49` выполнен, ожидает приёмки)**:
  - **`T-45`, `T-46`, `T-47`, `T-48` (приняты)**: ядро расчётов/статусов/конверсии (`deadlineService.ts`, `storageService.ts`), интеграция в `DataGrid`, `DeadlineCellPopover`, `dataGridSelection`, `NewTabModal`, `excelService`, `ExcelImportModal`, `documentGenerator`, `docxTemplateService`, настройки столбцов и безопасная смена типа в `ColumnEditorModal` (`DeadlineConfigFields`), системная вкладка `SYSTEM_DEADLINE_TAB_ID` и экран `DeadlineControlView`.
  - **`T-49` (выполнен, ожидает приёмки; завершение реализации «Контроля сроков»)**:
    - **Индикатор и выпадающая панель уведомлений в `MenuBar` (`src/components/MenuBar.tsx`)**:
      - Слева от индикатора LLM-статуса добавлена компактная кнопка `«Сроки»` с живым общим счётчиком активных предупреждений (`overdue + due_soon`) без вычета временно скрытых: красный тон при `overdue > 0`, янтарный при `overdue === 0 && due_soon > 0`, спокойный нейтральный при `0`. На узких окнах (`< 1024px` / масштаб `150%`) текстовый ярлык автоматически скрывается, сохраняя пиктограмму и счётчик без наложения на LLM-индикатор.
      - Popover `«Ближайшие и просроченные события»` (без повторного вызова `collectDeadlineEvents` внутри `MenuBar`, с закрытием по `Escape` и клику вне области) отображает сводку (`Просрочено`, `Скоро`, `Скрыто на сегодня`), переключатель toast-напоминаний (`notificationsEnabled`), до 10 наиболее срочных активных карточек (сортировка: `overdue` -> `due_soon`, по дате, по организации/таблице), кнопки `«Скрыть на сегодня»` и `«Перейти к записи»`, а также footer-кнопку `«Открыть вкладку „Контроль сроков“»`.
    - **Агрегированные toast-уведомления, сессионная дедупликация и `snooze` (`src/services/deadlineService.ts`, `src/components/ui/ToastProvider.tsx`, `src/App.tsx`)**:
      - В `ToastProvider` добавлена опциональная кнопка действия (`action?: { label, onClick }`). На старте (после завершения `isBootstrapping` без ошибки загрузки) и при появлении новых активных событий в сессии показывается 1 агрегированное уведомление (с подсчётом `просрочено: X`, `скоро: Y`) и кнопкой перехода в системную вкладку «Контроль сроков».
      - Сессионная дедупликация ведётся строго в runtime через `shownToastKeysRef: Set<string>` (в БД не сохраняется; сбрасывается только при полной замене/сбросе БД). Повторное уведомление срабатывает при эскалации `due_soon -> overdue` (даже если старый `due_soon` ключ был скрыт через `snooze`), при изменении `effectiveNextDate` и в новой сессии приложения для не-snoozed событий.
      - Действие `«Скрыть на сегодня»` записывает `hideUntil = addCalendarDays(today, 1)` в `settings.deadlineSettings.snoozedNotificationKeys[notificationKey]` через сериализованную очередь сохранения БД (`persistState(..., { deferUnsavedFlag: true })`): при ошибке записи состояние откатывается и ошибка отображается внутри popover без ложного скрытия. При `notificationsEnabled === false` подавляется только toast, а индикатор, popover и системная вкладка работают в полном объёме.
    - **Проверки `T-49` (`2026-11-23`)**:
      - `npx vitest run`: **17/17 файлов, 145/145 тестов пройдено** (добавлены unit-тесты T-49 в `src/services/__tests__/deadlineService.test.ts` и SSR/контракт-тесты в `src/components/__tests__/MenuBarNotifications.test.ts`).
      - `npm run lint` (`tsc --noEmit`): 0 ошибок.
      - `npm run build` (`vite build`): успешно.
      - Живая браузерная проверка (Playwright Chromium против `http://127.0.0.1:3000`, 0 `console.error` / 0 `pageerror`): проверены все 15 сценариев (стартовый агрегированный toast, отсутствие дублей при переключении вкладок/юрлиц и редактировании посторонних ячеек, top-10 и порядок сортировки в popover, `Escape`/вне-клик, кросс-юрлицовый переход к записи, открытие системной вкладки, сохранение `snooze` в БД с неизменным счётчиком индикатора и системной вкладкой, повторная загрузка в тот же день, эскалация `due_soon -> overdue` поверх скрытого `due_soon`, смена плановой даты с новым `notificationKey`, реактивация на следующий день `today >= hideUntil`, отключение `notificationsEnabled`), а также все **12 комбинаций** `1920×1080` / `1366×768` × `100% / 125% / 150%` × `light / dark` (0 горизонтального переполнения, отсутствие наложений и обрезания toast/popover/`DeadlineControlView`). Не проверены в текущей сессии: нативный Windows-рантайм `OT-Baza.exe` и пересборка `.exe`/`.zip` (нет MinGW-w64 / Windows).
  - **Следующий шаг**: приёмка `T-49` пользователем и последующая финальная сборка/проверка Windows-релиза по разделу 5.

---

## 5. Обязательный перечень финального тестирования Windows-релиза и внешние ограничения
1. Кросс-компиляция `OT-Baza.exe` и перепаковка `OT-Baza-Windows.zip` через `python3 build_native_windows.py` (нужны `x86_64-w64-mingw32-gcc` и `x86_64-w64-mingw32-windres`).
2. Живой прогон нативного Windows-сервера `OT-Baza.exe` под Windows 10/11 (проверка сохранения таблиц, heartbeat при сне/пробуждении и физическом масштабе DPI ОС `125%`/`150%` — пункты `T-37`, `T-40`).
3. **Нативная запись, чтение и удаление DOCX в `./templates/` через `OT-Baza.exe`** *(перенесено по итогам приёмки `T-44`)*.
4. **Проверка сформированных DOCX в Microsoft Word / LibreOffice на Windows** *(перенесено по итогам приёмки `T-44`)*.
5. Контрольные точки Git: в текущей рабочей папке `/app/applet` каталог `.git` отсутствует, поэтому коммит внутри контейнера не создавался.

---

## 6. Трек UX/UI Redesign — итоги этапа `D-1` и переход к `D-2`

### Статус этапа `D-1` («Исследование и концепция»): **Выполнено, ожидает утверждения пользователем**
- **Что изучено (без правки рабочего кода):** `PROJECT_CONTEXT.md`, `DECISIONS.md`, `ROADMAP.md`, `TASKS.md`, `HANDOFF.md`, `AGENTS.md`, `AGENT_HANDOFF_PROMPT.md`, а также целевые файлы интерфейса (`src/index.css`, `src/types/database.ts`, `src/data/initialDatabase.ts`, `src/components/TitleBar.tsx`, `MenuBar.tsx`, `TabBar.tsx`, `StatusBar.tsx`, `DeadlineControlView.tsx`, `DataGrid.tsx`, `src/components/ui/*`, `src/App.tsx`).
- **Созданные/обновлённые документы и макеты:**
  - `DESIGN_SYSTEM.md` — трёхслойная модель **Liquid Glass** (`Canvas` -> `Liquid Glass Chrome` -> `Crisp Data Surface`), палитры и токены Light/Dark, типографика `Manrope` + `JetBrains Mono tabular-nums`, режим `visualEffects: 'glass' | 'reduced'`, шкала `zIndex.tabPreview: z-[75]`, правила доступности и полной офлайн-автономности.
  - `UX_CONCEPT.md` — аудит CRM/ERP-восприятия, гибридная навигация (единая стеклянная шапка `44px` + сворачиваемый левый сайдбар `236px`/`60px`), архитектура главного экрана **Dashboard** (`SYSTEM_DASHBOARD_TAB_ID`, единый источник данных `deadlineService.ts`), матрица и эргономика **TabPreviewPopover** (`280ms` открытие, `180ms` закрытие + pointer-bridge, `Escape`/scroll/drag, viewport clamping).
  - `UI_ACCEPTANCE.md` — контрольный чек-лист приёмки этапов `D-1`–`D-6` и обязательная матрица 18 комбинаций (`1920×1080`, `1600×900`, `1366×768` × `100%/125%/150%` × `light/dark`).
  - `docs/d1_liquid_glass_prototype.html` — самодостаточный статический интерактивный HTML-прототип (вне `src/` и `public/`) с переключением Light/Dark, Glass/Reduced, Dashboard/DataGrid и живым ховер-превью вкладок + сгенерированные концепт-рендеры.
  - Актуализированы `ROADMAP.md`, `TASKS.md`, `PROJECT_CONTEXT.md`, `AGENTS.md`, `AGENT_HANDOFF_PROMPT.md`, `HANDOFF.md`.
- **Рабочий код приложения (`src/*`, `launcher.c`, `package.json`, `index.html`, `public/*`) на этапе `D-1` не изменялся.**

### Неизменные ограничения для этапов `D-2` — `D-6`
1. 100% обратная совместимость `DatabaseState`, `LegalEntity`, `Tab` (до 20 вкладок), связей `relation`, каскадов `integrityService.ts`.
2. Бизнес-логика `deadlineService.ts` (`T-45`–`T-49`), сессионная дедупликация toast (`shownToastKeysRef`), `snoozedNotificationKeys` и системная вкладка `SYSTEM_DEADLINE_TAB_ID` не меняются.
3. Сохраняются `native-fs` (`launcher.c` / `./data/ot_database.json`), `web-preview`, Excel импорт/экспорт/`Ctrl+V`, DOCX/PDF (в т.ч. готовые `.docx`-шаблоны `T-44`), LLM-студия и запрет внешних CDN/платных сервисов.
4. Ячейки `DataGrid` и `DeadlineControlView` остаются на непрозрачной высококонтрастной плоскостью Layer 2 без `backdrop-filter` внутри строк/ячеек.

### Следующий шаг после одобрения пользователем — **Этап `D-2` («Дизайн-система»)**
- **Точный объём `D-2`:**
  1. Добавить в `src/index.css` CSS custom properties Liquid Glass для тем Light/Dark (`--lg-canvas-bg`, `--lg-glass-*`, `--lg-data-*`, `--lg-specular-border`, `--lg-hairline-border`, `--lg-inner-highlight`, семантические токены и `[data-visual-effects="reduced"]` + `@media prefers-reduced-transparency/motion`).
  2. Добавить опциональное поле `visualEffects?: 'glass' | 'reduced'` в `AppSettings` (`src/types/database.ts` и нормализация в `src/services/storageService.ts`) с применением `data-visual-effects` на корневом элементе (без ломки старых БД).
  3. Обновить базовые примитивы `src/components/ui/` (`AppButton.tsx`, `AppModal.tsx`, `AppInput.tsx`, `FormField.tsx`, `StatusBanner.tsx`, `InlineConfirm.tsx`, `ConfirmDialog.tsx`, `ToastProvider.tsx`, `zIndex.ts` с `tabPreview`) без поломки их текущих prop-контрактов.
  4. Провести проверку `D-2`: `npx vitest run`, `npm run lint`, `npm run build`, проверка контраста Light/Dark (`>= 4.5:1`), `reduced`-режима и существующих модалок.
- **Минимальный список файлов для чтения при старте `D-2`:** `HANDOFF.md`, `DESIGN_SYSTEM.md`, `UI_ACCEPTANCE.md` (разделы 1 и D-2), `src/index.css`, `src/types/database.ts`, `src/services/storageService.ts`, `src/components/ui/*`.

