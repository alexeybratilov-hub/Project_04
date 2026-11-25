import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  CalendarOff,
  CheckCircle2,
  Clock,
  Filter,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X
} from 'lucide-react';
import { DatabaseState } from '../types/database';
import {
  collectDeadlineEvents,
  DEADLINE_STATUS_LABELS,
  DeadlineEventFilter,
  DeadlineEventItem,
  DeadlineStatus,
  filterDeadlineEvents,
  formatDeadlinePeriodicityOnly,
  formatIsoToDisplay,
  getDeadlineFilterOptions,
  hasAnyDeadlineControlColumn,
  normalizeHolidaysList,
  parseFlexibleDateToIso,
  summarizeDeadlineEvents
} from '../services/deadlineService';
import { getDeadlineStatusToneClasses } from './DeadlineCellPopover';
import { AppButton, AppInput, AppModal, AppSelect, AppTextarea, StatusBanner } from './ui';

export interface DeadlineViewFilterState {
  entityId: string;
  tabId: string;
  rowIdentifier: string;
  status: DeadlineStatus | 'all' | 'actionable' | 'closed_or_missing';
  search: string;
}

export const DEFAULT_DEADLINE_VIEW_FILTER: DeadlineViewFilterState = {
  entityId: 'all',
  tabId: 'all',
  rowIdentifier: 'all',
  status: 'all',
  search: ''
};

export function hasActiveDeadlineFilters(filter: DeadlineViewFilterState): boolean {
  return (
    filter.entityId !== 'all' ||
    filter.tabId !== 'all' ||
    filter.rowIdentifier !== 'all' ||
    filter.status !== 'all' ||
    filter.search.trim() !== ''
  );
}

export function reconcileDeadlineViewFilter(
  filter: DeadlineViewFilterState,
  allEvents: DeadlineEventItem[]
): DeadlineViewFilterState {
  const optionsAll = getDeadlineFilterOptions(allEvents);
  const entityValid =
    filter.entityId === 'all' || optionsAll.entities.some((e) => e.id === filter.entityId);
  const nextEntityId = entityValid ? filter.entityId : 'all';

  const optionsForEntity = getDeadlineFilterOptions(allEvents, { entityId: nextEntityId });
  const tabValid =
    filter.tabId === 'all' || optionsForEntity.tabs.some((t) => t.id === filter.tabId);
  const nextTabId = tabValid ? filter.tabId : 'all';

  const optionsForEntityAndTab = getDeadlineFilterOptions(allEvents, {
    entityId: nextEntityId,
    tabId: nextTabId
  });
  const rowValid =
    filter.rowIdentifier === 'all' ||
    optionsForEntityAndTab.rowIdentifiers.includes(filter.rowIdentifier);
  const nextRowIdentifier = rowValid ? filter.rowIdentifier : 'all';

  if (
    nextEntityId === filter.entityId &&
    nextTabId === filter.tabId &&
    nextRowIdentifier === filter.rowIdentifier
  ) {
    return filter;
  }

  return {
    ...filter,
    entityId: nextEntityId,
    tabId: nextTabId,
    rowIdentifier: nextRowIdentifier
  };
}

export function formatDeadlineRemainingHint(event: DeadlineEventItem): string {
  const { evaluation } = event;
  if (evaluation.status === 'completed') {
    return 'Разовое выполнено';
  }
  if (evaluation.status === 'missing_data' || evaluation.daysRemaining === undefined) {
    return 'Укажите дату';
  }
  const unit = evaluation.config.warningDayType === 'working' ? 'раб. дн.' : 'кал. дн.';
  if (evaluation.daysRemaining === 0) {
    return 'Срок сегодня';
  }
  if (evaluation.daysRemaining > 0) {
    return `Осталось ${evaluation.daysRemaining} ${unit}`;
  }
  return `Просрочено на ${Math.abs(evaluation.daysRemaining)} ${unit}`;
}

interface DeadlineControlViewProps {
  dbState: DatabaseState;
  todayIso?: string;
  focusSearchSignal?: number;
  initialFilter?: Partial<DeadlineViewFilterState>;
  onJumpToEvent: (event: DeadlineEventItem) => void;
  onMarkCompletedToday: (event: DeadlineEventItem) => void;
  onUpdateHolidays: (nextHolidays: string[]) => void;
}

export const DeadlineControlView: React.FC<DeadlineControlViewProps> = ({
  dbState,
  todayIso,
  focusSearchSignal = 0,
  initialFilter,
  onJumpToEvent,
  onMarkCompletedToday,
  onUpdateHolidays
}) => {
  const [filter, setFilter] = useState<DeadlineViewFilterState>(() => ({
    ...DEFAULT_DEADLINE_VIEW_FILTER,
    ...(initialFilter || {})
  }));
  const [isHolidaysModalOpen, setIsHolidaysModalOpen] = useState(false);
  const [singleHolidayInput, setSingleHolidayInput] = useState('');
  const [bulkHolidaysInput, setBulkHolidaysInput] = useState('');
  const [holidayYearFilter, setHolidayYearFilter] = useState<string>('all');
  const [holidayInputError, setHolidayInputError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSearchSignal > 0) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [focusSearchSignal]);

  const holidays = useMemo(
    () => normalizeHolidaysList(dbState.settings?.deadlineSettings?.holidays),
    [dbState.settings?.deadlineSettings?.holidays]
  );

  const hasDeadlineColumns = useMemo(() => hasAnyDeadlineControlColumn(dbState), [dbState]);

  const allEvents = useMemo(
    () => collectDeadlineEvents(dbState, todayIso ? { todayIso } : undefined),
    [dbState, todayIso]
  );

  const effectiveFilter = useMemo(
    () => reconcileDeadlineViewFilter(filter, allEvents),
    [filter, allEvents]
  );

  const summary = useMemo(() => summarizeDeadlineEvents(allEvents), [allEvents]);

  const filterOptions = useMemo(
    () =>
      getDeadlineFilterOptions(allEvents, {
        entityId: effectiveFilter.entityId,
        tabId: effectiveFilter.tabId
      }),
    [allEvents, effectiveFilter.entityId, effectiveFilter.tabId]
  );

  const filteredEvents = useMemo(() => {
    const queryFilter: DeadlineEventFilter = {
      entityId: effectiveFilter.entityId,
      tabId: effectiveFilter.tabId,
      rowIdentifier: effectiveFilter.rowIdentifier,
      status: effectiveFilter.status,
      search: effectiveFilter.search
    };
    return filterDeadlineEvents(allEvents, queryFilter);
  }, [allEvents, effectiveFilter]);

  const filtersActive = hasActiveDeadlineFilters(effectiveFilter);

  const handleResetFilters = () => {
    setFilter(DEFAULT_DEADLINE_VIEW_FILTER);
  };

  const handleEntityFilterChange = (nextEntityId: string) => {
    setFilter((prev) =>
      reconcileDeadlineViewFilter(
        {
          ...prev,
          entityId: nextEntityId
        },
        allEvents
      )
    );
  };

  const handleTabFilterChange = (nextTabId: string) => {
    setFilter((prev) =>
      reconcileDeadlineViewFilter(
        {
          ...prev,
          tabId: nextTabId
        },
        allEvents
      )
    );
  };

  const handleStatusChipClick = (nextStatus: DeadlineViewFilterState['status']) => {
    setFilter((prev) => ({
      ...prev,
      status: prev.status === nextStatus && nextStatus !== 'all' ? 'all' : nextStatus
    }));
  };

  // Holidays modal helpers
  const holidayYears = useMemo(() => {
    const years = new Set<string>();
    holidays.forEach((h) => years.add(h.slice(0, 4)));
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [holidays]);

  const visibleHolidays = useMemo(() => {
    if (holidayYearFilter === 'all') return holidays;
    return holidays.filter((h) => h.startsWith(`${holidayYearFilter}-`));
  }, [holidays, holidayYearFilter]);

  const handleAddSingleHoliday = () => {
    const parsed = parseFlexibleDateToIso(singleHolidayInput);
    if (!parsed) {
      setHolidayInputError('Укажите корректную дату.');
      return;
    }
    setHolidayInputError(null);
    onUpdateHolidays(normalizeHolidaysList([...holidays, parsed]));
    setSingleHolidayInput('');
  };

  const handleAddBulkHolidays = () => {
    const tokens = bulkHolidaysInput
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) {
      setHolidayInputError('Введите одну или несколько дат (ДД.ММ.ГГГГ или ГГГГ-ММ-ДД).');
      return;
    }
    const parsedDates: string[] = [];
    const invalidTokens: string[] = [];
    for (const token of tokens) {
      const iso = parseFlexibleDateToIso(token);
      if (iso) parsedDates.push(iso);
      else invalidTokens.push(token);
    }
    if (parsedDates.length === 0) {
      setHolidayInputError(`Не удалось распознать даты: ${invalidTokens.slice(0, 4).join(', ')}`);
      return;
    }
    onUpdateHolidays(normalizeHolidaysList([...holidays, ...parsedDates]));
    if (invalidTokens.length > 0) {
      setHolidayInputError(
        `Добавлено дат: ${parsedDates.length}. Не распознаны: ${invalidTokens.slice(0, 4).join(', ')}`
      );
      setBulkHolidaysInput(invalidTokens.join('\n'));
    } else {
      setHolidayInputError(null);
      setBulkHolidaysInput('');
    }
  };

  const handleRemoveHoliday = (iso: string) => {
    onUpdateHolidays(holidays.filter((h) => h !== iso));
  };

  const statusChips: Array<{
    key: DeadlineViewFilterState['status'];
    label: string;
    count: number;
    toneClass: string;
    activeClass: string;
  }> = [
    {
      key: 'all',
      label: 'Все',
      count: summary.total,
      toneClass:
        'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:border-slate-400',
      activeClass:
        'bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-white'
    },
    {
      key: 'overdue',
      label: 'Просрочено',
      count: summary.overdue,
      toneClass:
        'bg-red-50/80 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/80 hover:border-red-300',
      activeClass: 'bg-red-600 text-white border-red-700'
    },
    {
      key: 'due_soon',
      label: 'Скоро',
      count: summary.dueSoon,
      toneClass:
        'bg-amber-50/80 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/80 hover:border-amber-300',
      activeClass: 'bg-amber-600 text-white border-amber-700'
    },
    {
      key: 'scheduled',
      label: 'Запланировано',
      count: summary.scheduled,
      toneClass:
        'bg-sky-50/80 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800/80 hover:border-sky-300',
      activeClass: 'bg-sky-600 text-white border-sky-700'
    },
    {
      key: 'completed',
      label: 'Выполнено',
      count: summary.completed,
      toneClass:
        'bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/80 hover:border-emerald-300',
      activeClass: 'bg-emerald-600 text-white border-emerald-700'
    },
    {
      key: 'missing_data',
      label: 'Данные отсутствуют',
      count: summary.missingData,
      toneClass:
        'bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300',
      activeClass: 'bg-slate-600 text-white border-slate-700'
    }
  ];

  return (
    <section
      aria-label="Контроль сроков"
      data-testid="deadline-control-view"
      className="flex-1 flex flex-col bg-white dark:bg-slate-900 overflow-hidden min-h-0"
    >
      {/* Top Summary & Filters Panel */}
      <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-col gap-2 shrink-0">
        {/* Row 1: Title, Status Summary Chips, Holidays Config */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <div className="flex items-center gap-1.5 mr-2">
              <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <h1 className="text-xs font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                Контроль сроков по всем организациям
              </h1>
            </div>

            {statusChips.map((chip) => {
              const isSelected = effectiveFilter.status === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={isSelected}
                  data-status-filter={chip.key}
                  onClick={() => handleStatusChipClick(chip.key)}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    isSelected ? chip.activeClass : chip.toneClass
                  }`}
                >
                  <span>{chip.label}</span>
                  <span
                    className={`font-mono tabular-nums text-[10px] px-1 rounded ${
                      isSelected
                        ? 'bg-white/20 text-inherit font-bold'
                        : 'bg-black/5 dark:bg-white/10 font-semibold'
                    }`}
                  >
                    {chip.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <AppButton
              variant="secondary"
              size="xs"
              icon={<CalendarOff className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />}
              onClick={() => {
                setHolidayInputError(null);
                setIsHolidaysModalOpen(true);
              }}
              title="Настроить список пользовательских нерабочих и праздничных дней для расчёта рабочих дней"
            >
              <span>Праздничные дни</span>
              <span className="font-mono tabular-nums text-[10px] px-1 py-0.5 rounded bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                {holidays.length}
              </span>
            </AppButton>
          </div>
        </div>

        {/* Row 2: Joint Filters (Entity, Tab, Row/Employee, Status, Search, Reset) */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
            <Filter className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Фильтры:</span>
          </div>

          <div className="min-w-[165px] max-w-[230px] flex-1 sm:flex-none">
            <AppSelect
              compact
              aria-label="Организация"
              value={effectiveFilter.entityId}
              onChange={(e) => handleEntityFilterChange(e.target.value)}
            >
              <option value="all">Все организации ({filterOptions.entities.length})</option>
              {filterOptions.entities.map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {ent.name}
                </option>
              ))}
            </AppSelect>
          </div>

          <div className="min-w-[155px] max-w-[220px] flex-1 sm:flex-none">
            <AppSelect
              compact
              aria-label="Исходная таблица"
              value={effectiveFilter.tabId}
              onChange={(e) => handleTabFilterChange(e.target.value)}
            >
              <option value="all">Все таблицы ({filterOptions.tabs.length})</option>
              {filterOptions.tabs.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.name}
                </option>
              ))}
            </AppSelect>
          </div>

          <div className="min-w-[165px] max-w-[230px] flex-1 sm:flex-none">
            <AppSelect
              compact
              aria-label="Сотрудник или объект"
              value={effectiveFilter.rowIdentifier}
              onChange={(e) =>
                setFilter((prev) => ({ ...prev, rowIdentifier: e.target.value }))
              }
            >
              <option value="all">Все сотрудники / записи ({filterOptions.rowIdentifiers.length})</option>
              {filterOptions.rowIdentifiers.map((identifier) => (
                <option key={identifier} value={identifier}>
                  {identifier}
                </option>
              ))}
            </AppSelect>
          </div>

          <div className="min-w-[145px] max-w-[195px] flex-1 sm:flex-none">
            <AppSelect
              compact
              aria-label="Статус срока"
              value={effectiveFilter.status}
              onChange={(e) =>
                setFilter((prev) => ({
                  ...prev,
                  status: e.target.value as DeadlineViewFilterState['status']
                }))
              }
            >
              <option value="all">Все статусы</option>
              <option value="actionable">Требуют внимания (Просрочено + Скоро)</option>
              <option value="overdue">{DEADLINE_STATUS_LABELS.overdue}</option>
              <option value="due_soon">{DEADLINE_STATUS_LABELS.due_soon}</option>
              <option value="scheduled">{DEADLINE_STATUS_LABELS.scheduled}</option>
              <option value="completed">{DEADLINE_STATUS_LABELS.completed}</option>
              <option value="missing_data">{DEADLINE_STATUS_LABELS.missing_data}</option>
              <option value="closed_or_missing">Выполнено и нет данных</option>
            </AppSelect>
          </div>

          <div className="relative flex-1 min-w-[180px] max-w-[300px]">
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <AppInput
              ref={searchInputRef}
              compact
              type="text"
              aria-label="Поиск мероприятий"
              value={effectiveFilter.search}
              onChange={(e) => setFilter((prev) => ({ ...prev, search: e.target.value }))}
              placeholder="Поиск: ФИО, мероприятие, дата, примеч..."
              className="pl-8 pr-7"
            />
            {effectiveFilter.search && (
              <button
                type="button"
                aria-label="Очистить строку поиска"
                onClick={() => setFilter((prev) => ({ ...prev, search: '' }))}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {filtersActive && (
            <AppButton
              variant="ghost"
              size="xs"
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={handleResetFilters}
            >
              Сбросить фильтры
            </AppButton>
          )}

          <div className="ml-auto text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums whitespace-nowrap">
            Показано: <strong className="text-slate-800 dark:text-slate-200">{filteredEvents.length}</strong> из{' '}
            {allEvents.length}
          </div>
        </div>
      </div>

      {/* Main Content / Empty States / Table */}
      <div className="flex-1 overflow-auto min-h-0">
        {!hasDeadlineColumns ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className="max-w-md w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-6 text-center space-y-2.5">
              <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
                <Calendar className="w-5 h-5" />
              </div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Нет столбцов контроля сроков
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Ни в одной из пользовательских таблиц пока нет столбца с типом{' '}
                <strong className="text-slate-800 dark:text-slate-200">«Контроль сроков»</strong>.
                Добавьте такой столбец в нужной таблице через кнопку «+» или «Настройка столбцов»,
                и все контролируемые мероприятия автоматически появятся здесь.
              </p>
            </div>
          </div>
        ) : allEvents.length === 0 ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className="max-w-md w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-6 text-center space-y-2.5">
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto">
                <Clock className="w-5 h-5" />
              </div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Контролируемых записей пока нет
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Столбцы «Контроль сроков» уже настроены, но в соответствующих таблицах пока нет
                строк. Добавьте записи в пользовательские таблицы, чтобы отслеживать их сроки.
              </p>
            </div>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className="max-w-md w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-6 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto">
                <Filter className="w-5 h-5" />
              </div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                По заданным фильтрам мероприятий не найдено
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Попробуйте изменить условия фильтрации или сбросить все фильтры.
              </p>
              <div className="pt-1">
                <AppButton
                  variant="secondary"
                  size="sm"
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                  onClick={handleResetFilters}
                >
                  Сбросить фильтры
                </AppButton>
              </div>
            </div>
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-xs min-w-[980px]">
            <thead className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800/95 border-b border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-600 dark:text-slate-300 shadow-[0_1px_0_0_rgba(15,23,42,0.06)]">
              <tr>
                <th className="px-3 py-2 whitespace-nowrap border-r border-slate-200/70 dark:border-slate-700/70 w-[140px]">
                  Организация
                </th>
                <th className="px-3 py-2 whitespace-nowrap border-r border-slate-200/70 dark:border-slate-700/70 w-[145px]">
                  Таблица
                </th>
                <th className="px-3 py-2 whitespace-nowrap border-r border-slate-200/70 dark:border-slate-700/70 min-w-[165px]">
                  Сотрудник / запись
                </th>
                <th className="px-3 py-2 whitespace-nowrap border-r border-slate-200/70 dark:border-slate-700/70 min-w-[155px]">
                  Мероприятие
                </th>
                <th className="px-3 py-2 whitespace-nowrap border-r border-slate-200/70 dark:border-slate-700/70 w-[108px]">
                  Факт. дата
                </th>
                <th className="px-3 py-2 whitespace-nowrap border-r border-slate-200/70 dark:border-slate-700/70 w-[132px]">
                  План. дата
                </th>
                <th className="px-3 py-2 whitespace-nowrap border-r border-slate-200/70 dark:border-slate-700/70 w-[145px]">
                  Периодичность
                </th>
                <th className="px-3 py-2 whitespace-nowrap border-r border-slate-200/70 dark:border-slate-700/70 w-[165px]">
                  Статус
                </th>
                <th className="px-3 py-2 whitespace-nowrap border-r border-slate-200/70 dark:border-slate-700/70 min-w-[140px] max-w-[220px]">
                  Примечание
                </th>
                <th className="sticky right-0 z-30 bg-slate-100 dark:bg-slate-800 px-3 py-2 whitespace-nowrap text-right border-l border-slate-200 dark:border-slate-700 w-[188px]">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
              {filteredEvents.map((ev, idx) => {
                const { evaluation } = ev;
                const actualDisp = formatIsoToDisplay(evaluation.actualDate);
                const nextDisp = formatIsoToDisplay(evaluation.effectiveNextDate);
                const periodicityLabel = formatDeadlinePeriodicityOnly(evaluation.config);
                const remainingHint = formatDeadlineRemainingHint(ev);
                const toneClasses = getDeadlineStatusToneClasses(evaluation.status);
                const hasNote = Boolean(evaluation.value.note);
                const hasRawOriginal = Boolean(evaluation.value._rawOriginal);
                const rowSurfaceClass =
                  idx % 2 === 0
                    ? 'bg-white dark:bg-slate-900'
                    : 'bg-slate-50/55 dark:bg-slate-800/25';
                const stickyActionBg =
                  idx % 2 === 0
                    ? 'bg-white dark:bg-slate-900 group-hover:bg-blue-50/45 dark:group-hover:bg-slate-800'
                    : 'bg-slate-50 dark:bg-slate-900 group-hover:bg-blue-50/45 dark:group-hover:bg-slate-800';

                return (
                  <tr
                    key={ev.eventId}
                    data-event-id={ev.eventId}
                    data-row-id={ev.rowId}
                    onClick={() => onJumpToEvent(ev)}
                    className={`group transition-colors cursor-pointer hover:bg-blue-50/45 dark:hover:bg-slate-800/60 ${rowSurfaceClass}`}
                    title={`Нажмите, чтобы перейти к строке «${ev.rowIdentifier}» в таблице «${ev.tabName}»`}
                  >
                    <td className="px-3 py-2 border-r border-slate-200/60 dark:border-slate-800/80 align-top">
                      <span className="block truncate max-w-[150px] font-medium text-slate-800 dark:text-slate-200" title={ev.entityName}>
                        {ev.entityName}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-r border-slate-200/60 dark:border-slate-800/80 align-top">
                      <span className="block truncate max-w-[155px] text-slate-700 dark:text-slate-300" title={ev.tabName}>
                        {ev.tabName}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-r border-slate-200/60 dark:border-slate-800/80 align-top">
                      <span className="block break-words text-slate-900 dark:text-slate-100 font-medium leading-snug">
                        {ev.rowIdentifier}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-r border-slate-200/60 dark:border-slate-800/80 align-top">
                      <span className="block break-words text-slate-800 dark:text-slate-200 leading-snug">
                        {ev.columnName}
                      </span>
                      {hasRawOriginal && !actualDisp && !nextDisp && (
                        <span
                          className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-amber-700 dark:text-amber-300"
                          title={`Исходное нераспознанное значение: ${evaluation.value._rawOriginal}`}
                        >
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span className="truncate max-w-[160px]">{evaluation.value._rawOriginal}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-200/60 dark:border-slate-800/80 align-top whitespace-nowrap">
                      {actualDisp ? (
                        <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          {actualDisp}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-200/60 dark:border-slate-800/80 align-top whitespace-nowrap">
                      {nextDisp ? (
                        <div className="flex items-center gap-1">
                          <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                            {nextDisp}
                          </span>
                          {evaluation.nextDateSource === 'manual' && (
                            <span
                              className="px-1 py-0 rounded bg-amber-100/80 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[9.5px] font-medium"
                              title="Следующая плановая дата задана вручную"
                            >
                              ручн.
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-200/60 dark:border-slate-800/80 align-top">
                      <div className="text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {periodicityLabel}
                      </div>
                      <div className="text-[10.5px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        предупр. за {evaluation.config.warningValue}{' '}
                        {evaluation.config.warningDayType === 'working' ? 'раб. дн.' : 'кал. дн.'}
                      </div>
                    </td>
                    <td className="px-3 py-2 border-r border-slate-200/60 dark:border-slate-800/80 align-top">
                      <div className="flex flex-col items-start gap-0.5">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10.5px] font-semibold leading-none whitespace-nowrap ${toneClasses}`}
                        >
                          {evaluation.statusLabel}
                        </span>
                        <span className="text-[10.5px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {remainingHint}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 border-r border-slate-200/60 dark:border-slate-800/80 align-top max-w-[220px]">
                      {hasNote ? (
                        <span
                          className="block truncate text-slate-700 dark:text-slate-300"
                          title={evaluation.value.note}
                        >
                          {evaluation.value.note}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td
                      className={`sticky right-0 z-10 px-2.5 py-1.5 border-l border-slate-200/80 dark:border-slate-800 align-top text-right whitespace-nowrap ${stickyActionBg}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center justify-end gap-1">
                        <AppButton
                          variant="ghost"
                          size="xs"
                          icon={<ArrowUpRight className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
                          onClick={() => onJumpToEvent(ev)}
                          title={`Перейти к строке «${ev.rowIdentifier}» в таблице «${ev.tabName}»`}
                        >
                          <span>Перейти</span>
                        </AppButton>
                        <AppButton
                          variant="secondary"
                          size="xs"
                          icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                          onClick={() => onMarkCompletedToday(ev)}
                          title="Зафиксировать фактическое выполнение сегодняшней датой"
                        >
                          <span>Выполнено</span>
                        </AppButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Holidays Editor Modal (part of T-48 per DEADLINE_CONTROL_PLAN.md) */}
      <AppModal
        isOpen={isHolidaysModalOpen}
        onClose={() => setIsHolidaysModalOpen(false)}
        size="md"
        icon={<CalendarOff className="w-5 h-5" />}
        iconTone="amber"
        title="Нерабочие и праздничные дни"
        subtitle="Учитываются при подсчёте рабочих дней для предупреждения о сроках (Сб и Вс исключаются автоматически)"
        footer={
          <AppButton variant="primary" size="sm" onClick={() => setIsHolidaysModalOpen(false)}>
            Готово
          </AppButton>
        }
      >
        <div className="p-4 space-y-4 text-xs">
          <StatusBanner variant="info" compact>
            Список хранится в базе данных приложения. Добавление или удаление праздничных дат сразу
            пересчитывает количество рабочих дней и статус «Скоро».
          </StatusBanner>

          {/* Add single date */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
              Добавить дату
            </label>
            <div className="flex items-center gap-2">
              <AppInput
                compact
                mono
                type="date"
                aria-label="Дата нерабочего дня"
                value={singleHolidayInput}
                onChange={(e) => {
                  setSingleHolidayInput(e.target.value);
                  setHolidayInputError(null);
                }}
              />
              <AppButton
                variant="primary"
                size="sm"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={handleAddSingleHoliday}
              >
                Добавить
              </AppButton>
            </div>
          </div>

          {/* Bulk paste dates */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
              Добавить списком (ДД.ММ.ГГГГ или ГГГГ-ММ-ДД через пробел, запятую или с новой строки)
            </label>
            <div className="flex flex-col gap-2">
              <AppTextarea
                rows={2}
                mono
                aria-label="Список нерабочих дат"
                value={bulkHolidaysInput}
                onChange={(e) => {
                  setBulkHolidaysInput(e.target.value);
                  setHolidayInputError(null);
                }}
                placeholder="01.05.2026, 09.05.2026, 12.06.2026"
              />
              <div className="flex items-center justify-between gap-2">
                {holidayInputError ? (
                  <span className="text-[11px] text-red-600 dark:text-red-400">
                    {holidayInputError}
                  </span>
                ) : (
                  <span />
                )}
                <AppButton variant="secondary" size="xs" onClick={handleAddBulkHolidays}>
                  Добавить список
                </AppButton>
              </div>
            </div>
          </div>

          {/* Existing holidays list + Year filter */}
          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Добавленные даты ({visibleHolidays.length})
              </span>
              <div className="w-32">
                <AppSelect
                  compact
                  aria-label="Фильтр праздничных дней по году"
                  value={holidayYearFilter}
                  onChange={(e) => setHolidayYearFilter(e.target.value)}
                >
                  <option value="all">Все годы</option>
                  {holidayYears.map((y) => (
                    <option key={y} value={y}>
                      {y} год
                    </option>
                  ))}
                </AppSelect>
              </div>
            </div>

            {visibleHolidays.length === 0 ? (
              <div className="p-3 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-center text-slate-500 dark:text-slate-400">
                Нерабочие даты не добавлены. Учитываются только суббота и воскресенье.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
                {visibleHolidays.map((iso) => (
                  <div
                    key={iso}
                    className="flex items-center justify-between px-3 py-1.5 bg-white dark:bg-slate-900"
                  >
                    <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {formatIsoToDisplay(iso)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveHoliday(iso)}
                      aria-label={`Удалить дату ${formatIsoToDisplay(iso)}`}
                      className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </AppModal>
    </section>
  );
};
