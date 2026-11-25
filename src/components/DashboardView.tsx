import React, { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Blocks,
  Building2,
  CalendarClock,
  Clock3,
  Database,
  FileSpreadsheet,
  FileText,
  HardDrive,
  FolderOpen,
  LayoutGrid,
  ShieldCheck,
  Sparkles,
  Users
} from 'lucide-react';
import { DatabaseState, EmployeeObligation, LegalEntity, Row, Tab } from '../types/database';
import {
  DeadlineEventItem,
  DeadlineEventsSummary,
  formatIsoToDisplay,
  type DeadlineStatus
} from '../services/deadlineService';
import type { StorageMode } from '../services/localApiClient';
import { getEmployeeDisplayName, summarizeObligations } from '../services/obligationService';

interface DashboardViewProps {
  state: DatabaseState;
  activeEntity: LegalEntity;
  deadlineEvents: DeadlineEventItem[];
  deadlineSummary: DeadlineEventsSummary;
  storageMode: StorageMode;
  workspaceFolderName?: string | null;
  todayIso: string;
  employeeObligations: EmployeeObligation[];
  employeesTab: Tab | null;
  onSelectTab: (tabId: string) => void;
  onSelectEntity: (entityId: string) => void;
  onOpenDeadlineControl: () => void;
  onOpenTemplates: () => void;
  onOpenGeneratedDocs: () => void;
  onOpenBackup: () => void;
  onOpenWorkspaceModal: () => void;
  onOpenEmployees: () => void;
  onOpenModules: () => void;
  onOpenEmployeeCard: (rowId: string) => void;
}

const STATUS_TONE: Record<DeadlineStatus, { chip: string; dot: string; label: string }> = {
  overdue: {
    chip: 'bg-rose-100/80 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
    dot: 'bg-rose-500',
    label: 'Просрочено'
  },
  due_soon: {
    chip: 'bg-amber-100/80 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
    dot: 'bg-amber-500',
    label: 'Скоро'
  },
  scheduled: {
    chip: 'bg-sky-100/80 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
    dot: 'bg-sky-500',
    label: 'Запланировано'
  },
  completed: {
    chip: 'bg-emerald-100/80 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    label: 'Выполнено'
  },
  missing_data: {
    chip: 'bg-slate-200/80 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-400',
    label: 'Нет данных'
  }
};

function formatSavedTime(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function countRows(tabs: { rows: unknown[] }[]): number {
  return tabs.reduce((sum, tab) => sum + (Array.isArray(tab.rows) ? tab.rows.length : 0), 0);
}

function remainingLabel(event: DeadlineEventItem): string {
  const days = event.evaluation.daysRemaining;
  if (typeof days !== 'number') return 'без срока';
  if (days < 0) return `просрочено на ${Math.abs(days)} дн.`;
  if (days === 0) return 'срок сегодня';
  return `через ${days} дн.`;
}

const CardTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }> = ({
  icon,
  children,
  action
}) => (
  <div className="flex items-center justify-between gap-2 mb-3">
    <h3 className="flex items-center gap-2 text-[13px] font-semibold text-slate-700 dark:text-slate-200">
      <span className="text-slate-400 dark:text-slate-500">{icon}</span>
      {children}
    </h3>
    {action}
  </div>
);

export const DashboardView: React.FC<DashboardViewProps> = ({
  state,
  activeEntity,
  deadlineEvents,
  deadlineSummary,
  storageMode,
  workspaceFolderName,
  todayIso,
  employeeObligations,
  employeesTab,
  onSelectTab,
  onSelectEntity,
  onOpenDeadlineControl,
  onOpenTemplates,
  onOpenGeneratedDocs,
  onOpenBackup,
  onOpenWorkspaceModal,
  onOpenEmployees,
  onOpenModules,
  onOpenEmployeeCard
}) => {
  const totalRows = useMemo(() => countRows(state.tabs), [state.tabs]);

  const packageIssues = useMemo(() => {
    if (!employeesTab) return [];
    return employeesTab.rows
      .map((row: Row) => {
        const own = employeeObligations.filter((item) => item.employeeRowId === row.id);
        const summary = summarizeObligations(own, todayIso);
        return {
          row,
          name: getEmployeeDisplayName(row, employeesTab),
          total: summary.total,
          done: summary.done,
          overdue: summary.overdue,
          dueSoon: summary.dueSoon,
          nextDue: summary.nearestDueDate
        };
      })
      .filter((item) => item.total === 0 || item.overdue > 0)
      .sort((a, b) => b.overdue - a.overdue || (a.nextDue || '').localeCompare(b.nextDue || ''))
      .slice(0, 6);
  }, [employeesTab, employeeObligations, todayIso]);

  const packageStats = useMemo(() => {
    if (!employeesTab) return { total: 0, withoutPackage: 0, overdue: 0 };
    let withoutPackage = 0;
    let overdue = 0;
    employeesTab.rows.forEach((row) => {
      const own = employeeObligations.filter((item) => item.employeeRowId === row.id);
      if (own.length === 0) withoutPackage += 1;
      if (summarizeObligations(own, todayIso).overdue > 0) overdue += 1;
    });
    return { total: employeesTab.rows.length, withoutPackage, overdue };
  }, [employeesTab, employeeObligations, todayIso]);

  const entities = useMemo(
    () =>
      state.entities.map((entity) => ({
        entity,
        rows: countRows(entity.tabs),
        tabs: entity.tabs.length
      })),
    [state.entities]
  );

  const priorityEvents = useMemo(
    () =>
      deadlineEvents
        .filter((event) => event.evaluation.status === 'overdue' || event.evaluation.status === 'due_soon')
        .sort((a, b) => {
          const aDays = a.evaluation.daysRemaining ?? Number.MAX_SAFE_INTEGER;
          const bDays = b.evaluation.daysRemaining ?? Number.MAX_SAFE_INTEGER;
          if (aDays !== bDays) return aDays - bDays;
          return a.rowIdentifier.localeCompare(b.rowIdentifier, 'ru');
        })
        .slice(0, 6),
    [deadlineEvents]
  );

  const recentDocs = useMemo(
    () =>
      [...(state.generatedDocs || [])]
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, 5),
    [state.generatedDocs]
  );

  const storageChip =
    storageMode === 'native-fs'
      ? { icon: <HardDrive className="w-3.5 h-3.5" />, label: 'Запись на диск (OT-Baza.exe)', tone: 'text-emerald-700 dark:text-emerald-300' }
      : storageMode === 'file-handle'
        ? {
            icon: <FolderOpen className="w-3.5 h-3.5" />,
            label: `Папка: ${workspaceFolderName || '—'}`,
            tone: 'text-emerald-700 dark:text-emerald-300'
          }
        : {
            icon: <Database className="w-3.5 h-3.5" />,
            label: 'Хранение в браузере',
            tone: 'text-slate-600 dark:text-slate-300'
          };

  const kpis = [
    {
      label: 'Просрочено',
      value: deadlineSummary.overdue,
      icon: <AlertTriangle className="w-4 h-4" />,
      tone:
        deadlineSummary.overdue > 0
          ? 'text-rose-600 dark:text-rose-400'
          : 'text-slate-500 dark:text-slate-400',
      hint: 'Требует внимания'
    },
    {
      label: 'Скоро',
      value: deadlineSummary.dueSoon,
      icon: <Clock3 className="w-4 h-4" />,
      tone:
        deadlineSummary.dueSoon > 0
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-slate-500 dark:text-slate-400',
      hint: 'В пределах предупреждения'
    },
    {
      label: 'Записей',
      value: totalRows,
      icon: <LayoutGrid className="w-4 h-4" />,
      tone: 'text-slate-800 dark:text-slate-100',
      hint: `${state.tabs.length} таблиц`
    },
    {
      label: 'Документов',
      value: (state.generatedDocs || []).length,
      icon: <FileText className="w-4 h-4" />,
      tone: 'text-slate-800 dark:text-slate-100',
      hint: 'В реестре'
    }
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1560px] px-4 lg:px-6 py-5">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              <Sparkles className="w-3.5 h-3.5" />
              Главная
            </div>
            <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
              {activeEntity.profile.shortName || activeEntity.profile.fullName || 'Организация'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {activeEntity.profile.fullName}
              {activeEntity.profile.inn ? ` · ИНН ${activeEntity.profile.inn}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full bg-white/70 dark:bg-slate-900/60 border border-white/70 dark:border-slate-700/60 px-3 py-1.5 text-[11px] font-medium backdrop-blur ${storageChip.tone}`}
            >
              {storageChip.icon}
              {storageChip.label}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 dark:bg-slate-900/60 border border-white/70 dark:border-slate-700/60 px-3 py-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 backdrop-blur">
              <ShieldCheck className="w-3.5 h-3.5" />
              Сохранено: {formatSavedTime(state.lastSaved)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* Hero */}
          <section className="col-span-12 xl:col-span-5">
            <div className="lg-card p-5 h-full flex flex-col justify-between">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gradient-to-br from-blue-400/30 to-indigo-500/10 blur-2xl"
              />
              <div className="relative">
                <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <Building2 className="w-3.5 h-3.5" />
                  Рабочее пространство
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-4xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                    {totalRows}
                  </span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">записей в базе</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  {[
                    { label: 'таблиц', value: state.tabs.length },
                    { label: 'организаций', value: state.entities.length },
                    { label: 'шаблонов', value: state.templates.length }
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-2xl bg-white/60 dark:bg-slate-900/50 border border-white/70 dark:border-slate-700/50 py-2"
                    >
                      <div className="text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                        {item.value}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {item.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="relative mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onOpenDeadlineControl}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-3 py-2 text-xs font-semibold hover:opacity-90 transition-opacity"
                >
                  <CalendarClock className="w-4 h-4" />
                  Контроль сроков
                </button>
                <button
                  type="button"
                  onClick={onOpenWorkspaceModal}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white/70 dark:bg-slate-900/60 border border-white/80 dark:border-slate-700/60 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 transition-colors"
                >
                  <FolderOpen className="w-4 h-4" />
                  Рабочая папка
                </button>
              </div>
            </div>
          </section>

          {/* KPI */}
          <section className="col-span-12 xl:col-span-7 grid grid-cols-2 gap-4">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="lg-card p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                  <span className="text-[11px] font-medium uppercase tracking-wide">{kpi.label}</span>
                  {kpi.icon}
                </div>
                <div className={`mt-2 text-3xl font-semibold tabular-nums ${kpi.tone}`}>{kpi.value}</div>
                <div className="text-[10.5px] text-slate-500 dark:text-slate-400">{kpi.hint}</div>
              </div>
            ))}
          </section>

          {/* Deadline feed */}
          <section className="col-span-12 xl:col-span-7">
            <div className="lg-card p-5 h-full">
              <CardTitle
                icon={<Activity className="w-4 h-4" />}
                action={
                  <button
                    type="button"
                    onClick={onOpenDeadlineControl}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Все события
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                }
              >
                Ближайшие и просроченные
              </CardTitle>

              {priorityEvents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300/70 dark:border-slate-700/70 px-4 py-6 text-center">
                  <ShieldCheck className="mx-auto w-6 h-6 text-emerald-500 mb-2" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Срочных событий нет
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Все сроки под контролем либо столбцы «Контроль сроков» ещё не настроены.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {priorityEvents.map((event) => {
                    const tone = STATUS_TONE[event.evaluation.status];
                    return (
                      <li
                        key={event.eventId}
                        className="group flex items-center gap-3 rounded-2xl bg-white/55 dark:bg-slate-900/45 border border-white/70 dark:border-slate-700/50 px-3 py-2.5"
                      >
                        <span className={`h-2 w-2 rounded-full ${tone.dot} shrink-0`} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">
                              {event.rowIdentifier}
                            </span>
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone.chip}`}
                            >
                              {tone.label}
                            </span>
                          </div>
                          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {event.columnName} · {event.tabName}
                            {event.evaluation.effectiveNextDate
                              ? ` · ${formatIsoToDisplay(event.evaluation.effectiveNextDate)}`
                              : ''}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                            {remainingLabel(event)}
                          </div>
                          <button
                            type="button"
                            onClick={onOpenDeadlineControl}
                            className="text-[10.5px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Перейти
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Entities */}
          <section className="col-span-12 xl:col-span-5">
            <div className="lg-card p-5 h-full">
              <CardTitle icon={<Building2 className="w-4 h-4" />}>Организации</CardTitle>
              <ul className="space-y-1.5">
                {entities.map(({ entity, rows, tabs }) => {
                  const isActive = entity.id === state.activeEntityId;
                  return (
                    <li key={entity.id}>
                      <button
                        type="button"
                        onClick={() => onSelectEntity(entity.id)}
                        className={`w-full flex items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left transition-colors ${
                          isActive
                            ? 'bg-slate-900/90 text-white dark:bg-white/90 dark:text-slate-900'
                            : 'bg-white/55 dark:bg-slate-900/45 border border-white/70 dark:border-slate-700/50 hover:bg-white/80 dark:hover:bg-slate-800/70'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-semibold">
                            {entity.profile.shortName || entity.profile.fullName}
                          </span>
                          <span
                            className={`block truncate text-[10.5px] ${
                              isActive ? 'text-white/70 dark:text-slate-900/70' : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {tabs} таблиц · {rows} записей
                          </span>
                        </span>
                        {isActive && <span className="text-[10px] font-semibold uppercase tracking-wide">активна</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {/* Quick actions */}
          <section className="col-span-12 md:col-span-6 xl:col-span-4">
            <div className="lg-card p-5 h-full">
              <CardTitle icon={<Sparkles className="w-4 h-4" />}>Быстрые действия</CardTitle>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Шаблоны', icon: <FileText className="w-4 h-4" />, onClick: onOpenTemplates },
                  { label: 'Документы', icon: <FileSpreadsheet className="w-4 h-4" />, onClick: onOpenGeneratedDocs },
                  { label: 'Сотрудники', icon: <Users className="w-4 h-4" />, onClick: onOpenEmployees },
                  { label: 'Модули', icon: <Blocks className="w-4 h-4" />, onClick: onOpenModules },
                  { label: 'Резервная копия', icon: <Database className="w-4 h-4" />, onClick: onOpenBackup },
                  { label: 'Сроки', icon: <CalendarClock className="w-4 h-4" />, onClick: onOpenDeadlineControl }
                ].map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={action.onClick}
                    className="flex flex-col items-start gap-2 rounded-2xl bg-white/55 dark:bg-slate-900/45 border border-white/70 dark:border-slate-700/50 px-3 py-3 text-[11.5px] font-medium text-slate-700 dark:text-slate-200 hover:bg-white/85 dark:hover:bg-slate-800/70 transition-colors"
                  >
                    <span className="text-slate-400 dark:text-slate-500">{action.icon}</span>
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Recent docs */}
          <section className="col-span-12 md:col-span-6 xl:col-span-8">
            <div className="lg-card p-5 h-full">
              <CardTitle
                icon={<FileText className="w-4 h-4" />}
                action={
                  <button
                    type="button"
                    onClick={onOpenGeneratedDocs}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Реестр
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                }
              >
                Недавние документы
              </CardTitle>

              {recentDocs.length === 0 ? (
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  Пока нет сгенерированных документов. Создайте первый из раздела «Шаблоны».
                </p>
              ) : (
                <ul className="divide-y divide-slate-200/70 dark:divide-slate-700/50">
                  {recentDocs.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium text-slate-800 dark:text-slate-100">
                          {doc.title || doc.fileName}
                        </div>
                        <div className="truncate text-[10.5px] text-slate-500 dark:text-slate-400">
                          {doc.category} · {doc.dateFormatted}
                          {doc.sourceTabName ? ` · ${doc.sourceTabName}` : ''}
                        </div>
                      </div>
                      <span className="shrink-0 text-[10.5px] font-mono text-slate-500 dark:text-slate-400">
                        {doc.sizeFormatted}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Пакеты документов по сотрудникам */}
          <section className="col-span-12">
            <div className="lg-card p-5">
              <CardTitle
                icon={<Users className="w-4 h-4" />}
                action={
                  <button
                    type="button"
                    onClick={onOpenEmployees}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Все сотрудники
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                }
              >
                Пакеты документов
              </CardTitle>

              <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full bg-white/70 dark:bg-slate-900/60 border border-white/70 dark:border-slate-700/50 px-2.5 py-1 text-slate-600 dark:text-slate-300">
                  сотрудников: <strong className="tabular-nums">{packageStats.total}</strong>
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 border ${
                    packageStats.withoutPackage > 0
                      ? 'bg-amber-100/80 text-amber-800 border-amber-200/70 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900/50'
                      : 'bg-white/70 text-slate-600 border-white/70 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700/50'
                  }`}
                >
                  без пакета: <strong className="tabular-nums">{packageStats.withoutPackage}</strong>
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 border ${
                    packageStats.overdue > 0
                      ? 'bg-rose-100/80 text-rose-700 border-rose-200/70 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900/50'
                      : 'bg-white/70 text-slate-600 border-white/70 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700/50'
                  }`}
                >
                  с просрочкой: <strong className="tabular-nums">{packageStats.overdue}</strong>
                </span>
              </div>

              {!employeesTab ? (
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  Модуль «Сотрудники» отключён. Включите его в разделе «Модули», чтобы вести пакеты
                  документов.
                </p>
              ) : packageIssues.length === 0 ? (
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  Все пакеты укомплектованы, просрочек нет.
                </p>
              ) : (
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {packageIssues.map((item) => (
                    <li key={item.row.id}>
                      <button
                        type="button"
                        onClick={() => onOpenEmployeeCard(item.row.id)}
                        className="w-full flex items-center justify-between gap-3 rounded-2xl bg-white/55 dark:bg-slate-900/45 border border-white/70 dark:border-slate-700/50 px-3 py-2 text-left hover:bg-white/85 dark:hover:bg-slate-800/70 transition-colors"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                            {item.name}
                          </span>
                          <span className="block truncate text-[10.5px] text-slate-500 dark:text-slate-400">
                            {item.total === 0
                              ? 'пакет не рассчитан'
                              : `выполнено ${item.done} из ${item.total}` +
                                (item.nextDue ? ` · ближайший ${formatIsoToDisplay(item.nextDue)}` : '')}
                          </span>
                        </span>
                        {item.overdue > 0 ? (
                          <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                            просрочено {item.overdue}
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                            нет пакета
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Tabs overview */}
          <section className="col-span-12">
            <div className="lg-card p-5">
              <CardTitle icon={<LayoutGrid className="w-4 h-4" />}>Таблицы организации</CardTitle>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                {state.tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onSelectTab(tab.id)}
                    className="flex flex-col items-start gap-1 rounded-2xl bg-white/55 dark:bg-slate-900/45 border border-white/70 dark:border-slate-700/50 px-3 py-2.5 text-left hover:bg-white/85 dark:hover:bg-slate-800/70 transition-colors"
                  >
                    <span className="truncate w-full text-[11.5px] font-semibold text-slate-800 dark:text-slate-100">
                      {tab.name}
                    </span>
                    <span className="text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {tab.rows.length} записей · {tab.columns.length} столбцов
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
