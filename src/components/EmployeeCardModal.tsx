import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  FileArchive,
  FileText,
  Loader2,
  RotateCcw,
  Save,
  UserRound
} from 'lucide-react';
import { EmployeeEvent, EmployeeEventType, EmployeeObligation, Row, Tab } from '../types/database';
import { AppModal, AppButton, StatusBanner } from './ui';
import { EMPLOYEE_EVENT_LABELS, MODULE_BY_ID } from '../data/modules';
import {
  getEmployeeDisplayName,
  getEmployeeEvents,
  getEmployeeHireDate,
  isEmployeeDismissed,
  resolveEmployeeContext,
  summarizeObligations
} from '../services/obligationService';
import { formatIsoToDisplay } from '../services/deadlineService';

interface EmployeeCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeRow: Row | null;
  employeesTab: Tab;
  allTabs?: Tab[];
  obligations: EmployeeObligation[];
  todayIso: string;
  isWorking: boolean;
  onEnsurePackage: (employeeRowId: string) => void;
  onGenerateDocument: (obligationId: string) => Promise<void> | void;
  onGeneratePackage: (employeeRowId: string) => Promise<void> | void;
  onDownloadPackageZip?: (employeeRowId: string) => Promise<void> | void;
  onCompleteObligation: (obligationId: string) => void;
  onReopenObligation: (obligationId: string) => void;
  onUpdateEmployee: (employeeRowId: string, patch: Record<string, any>) => void;
  employeeEvents: EmployeeEvent[];
  onRegisterEvent: (
    employeeRowId: string,
    type: EmployeeEventType,
    dateIso: string,
    note?: string
  ) => void;
}

type Tone = 'overdue' | 'soon' | 'pending' | 'done';

function toneFor(item: EmployeeObligation, todayIso: string): Tone {
  if (item.status === 'done') return 'done';
  if (!item.dueDate) return 'pending';
  if (item.dueDate < todayIso) return 'overdue';
  const soonLimit = new Date(`${todayIso}T00:00:00Z`);
  soonLimit.setUTCDate(soonLimit.getUTCDate() + 14);
  const soonIso = soonLimit.toISOString().slice(0, 10);
  return item.dueDate <= soonIso ? 'soon' : 'pending';
}

const TONE_CLASSES: Record<Tone, string> = {
  overdue: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  soon: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  pending: 'bg-slate-200/80 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
};

const TONE_LABEL: Record<Tone, string> = {
  overdue: 'просрочено',
  soon: 'скоро',
  pending: 'ожидает',
  done: 'выполнено'
};

const FIELD_IDS = {
  fio: 'emp_fio',
  tabNum: 'emp_tab_num',
  hireDate: 'emp_hire_date',
  snils: 'emp_snils'
};

export const EmployeeCardModal: React.FC<EmployeeCardModalProps> = ({
  isOpen,
  onClose,
  employeeRow,
  employeesTab,
  allTabs,
  obligations,
  todayIso,
  isWorking,
  onEnsurePackage,
  onGenerateDocument,
  onGeneratePackage,
  onDownloadPackageZip,
  onCompleteObligation,
  onReopenObligation,
  onUpdateEmployee,
  employeeEvents,
  onRegisterEvent
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({
    fio: '',
    tabNum: '',
    position: '',
    dept: '',
    hireDate: '',
    snils: ''
  });
  const [eventType, setEventType] = useState<EmployeeEventType>('transfer');
  const [eventDate, setEventDate] = useState<string>(todayIso);
  const [eventNote, setEventNote] = useState('');

  const positionsTab = useMemo(
    () =>
      allTabs?.find((t) => t.moduleId === 'staffing' || t.id === 'tab_positions') ||
      allTabs?.find(
        (t) =>
          t.isMaster &&
          t.columns.some((c) => c.id === 'pos_title' || /должность/i.test(c.name))
      ),
    [allTabs]
  );

  const posColId = useMemo(
    () =>
      employeesTab.columns.find(
        (c) =>
          c.id === 'emp_pos' ||
          c.id === 'emp_position' ||
          c.relation?.masterColumnId === 'pos_title' ||
          /должность/i.test(c.name)
      )?.id || 'emp_pos',
    [employeesTab.columns]
  );

  const deptColId = useMemo(
    () =>
      employeesTab.columns.find(
        (c) =>
          c.id === 'emp_dept' ||
          c.relation?.masterColumnId === 'pos_dept' ||
          /подразделение/i.test(c.name)
      )?.id || 'emp_dept',
    [employeesTab.columns]
  );

  const positionOptions = useMemo(() => {
    if (!positionsTab) return [];
    const titleColId =
      positionsTab.columns.find((c) => c.id === 'pos_title' || /должность/i.test(c.name))?.id ||
      'pos_title';
    const deptMasterColId =
      positionsTab.columns.find((c) => c.id === 'pos_dept' || /подразделение/i.test(c.name))?.id ||
      'pos_dept';
    const seen = new Set<string>();
    const list: Array<{ title: string; dept: string }> = [];
    positionsTab.rows.forEach((row) => {
      const title = String(row[titleColId] ?? '').trim();
      if (!title || seen.has(title)) return;
      seen.add(title);
      list.push({
        title,
        dept: String(row[deptMasterColId] ?? '').trim()
      });
    });
    return list;
  }, [positionsTab]);

  useEffect(() => {
    if (!employeeRow) return;
    setDraft({
      fio: String(employeeRow[FIELD_IDS.fio] ?? ''),
      tabNum: String(employeeRow[FIELD_IDS.tabNum] ?? ''),
      position: String(employeeRow[posColId] ?? employeeRow.emp_position ?? ''),
      dept: String(employeeRow[deptColId] ?? ''),
      hireDate: String(employeeRow[FIELD_IDS.hireDate] ?? ''),
      snils: String(employeeRow[FIELD_IDS.snils] ?? '')
    });
  }, [employeeRow, posColId, deptColId]);

  const summary = useMemo(() => summarizeObligations(obligations, todayIso), [obligations, todayIso]);

  const grouped = useMemo(() => {
    const map = new Map<string, EmployeeObligation[]>();
    obligations.forEach((item) => {
      const list = map.get(item.moduleId) || [];
      list.push(item);
      map.set(item.moduleId, list);
    });
    return Array.from(map.entries()).map(([moduleId, items]) => ({
      moduleId,
      title: MODULE_BY_ID[moduleId]?.title || moduleId,
      items: [...items].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
    }));
  }, [obligations]);

  if (!employeeRow) {
    return null;
  }

  const name = getEmployeeDisplayName(employeeRow, employeesTab);
  const hireDate = getEmployeeHireDate(employeeRow);
  const events = getEmployeeEvents(employeeEvents, employeeRow.id);
  const dismissed = isEmployeeDismissed(employeeEvents, employeeRow.id);
  const resolvedContext = useMemo(
    () =>
      resolveEmployeeContext(allTabs && allTabs.length > 0 ? allTabs : [employeesTab], {
        ...employeeRow,
        [posColId]: draft.position
      }),
    [allTabs, employeesTab, employeeRow, posColId, draft.position]
  );
  const currentPositionValue = String(employeeRow[posColId] ?? employeeRow.emp_position ?? '');
  const currentDeptValue = String(employeeRow[deptColId] ?? '');
  const dirty =
    String(employeeRow[FIELD_IDS.fio] ?? '') !== draft.fio ||
    String(employeeRow[FIELD_IDS.tabNum] ?? '') !== draft.tabNum ||
    currentPositionValue !== draft.position ||
    currentDeptValue !== draft.dept ||
    String(employeeRow[FIELD_IDS.hireDate] ?? '') !== draft.hireDate ||
    String(employeeRow[FIELD_IDS.snils] ?? '') !== draft.snils;

  const handleSelectPosition = (nextTitle: string) => {
    const matched = positionOptions.find((opt) => opt.title === nextTitle);
    setDraft((prev) => ({
      ...prev,
      position: nextTitle,
      dept: matched?.dept ? matched.dept : prev.dept
    }));
  };

  const saveEmployee = () => {
    onUpdateEmployee(employeeRow.id, {
      [FIELD_IDS.fio]: draft.fio.trim(),
      [FIELD_IDS.tabNum]: draft.tabNum.trim(),
      [posColId]: draft.position.trim(),
      [deptColId]: draft.dept.trim(),
      [FIELD_IDS.hireDate]: draft.hireDate,
      [FIELD_IDS.snils]: draft.snils.trim()
    });
  };

  const runDoc = async (obligationId: string) => {
    setBusyId(obligationId);
    try {
      await onGenerateDocument(obligationId);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      icon={<UserRound className="w-5 h-5" />}
      iconTone="blue"
      title={name}
      subtitle={
        hireDate
          ? `Дата приёма: ${formatIsoToDisplay(hireDate)} · пакет: ${summary.done}/${summary.total}`
          : 'Укажите дату приёма, чтобы рассчитать сроки'
      }
      footer={
        <>
          <AppButton variant="secondary" size="sm" onClick={onClose}>
            Закрыть
          </AppButton>
          {onDownloadPackageZip && (
            <AppButton
              variant="secondary"
              size="sm"
              disabled={isWorking || summary.total === 0}
              onClick={() => void onDownloadPackageZip(employeeRow.id)}
              title="Сформировать все документы пакета и скачать единым ZIP-архивом"
            >
              <FileArchive className="w-4 h-4 text-indigo-600" />
              Скачать пакет .ZIP
            </AppButton>
          )}
          <AppButton
            variant="primary"
            size="sm"
            disabled={isWorking || summary.total === 0}
            onClick={() => void onGeneratePackage(employeeRow.id)}
          >
            {isWorking ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Сформировать пакет
          </AppButton>
        </>
      }
    >
      <div className="space-y-4">
        {/* Данные работника */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[10.5px] font-medium text-slate-600 dark:text-slate-300 mb-0.5">
                ФИО
              </span>
              <input
                type="text"
                value={draft.fio}
                onChange={(event) => setDraft((prev) => ({ ...prev, fio: event.target.value }))}
                className="h-8 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs"
              />
            </label>
            <label className="block">
              <span className="block text-[10.5px] font-medium text-slate-600 dark:text-slate-300 mb-0.5">
                Табельный №
              </span>
              <input
                type="text"
                value={draft.tabNum}
                onChange={(event) => setDraft((prev) => ({ ...prev, tabNum: event.target.value }))}
                className="h-8 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs"
              />
            </label>
            <label className="block">
              <span className="block text-[10.5px] font-medium text-slate-600 dark:text-slate-300 mb-0.5">
                Должность (профессия)
              </span>
              {positionOptions.length > 0 ? (
                <select
                  value={draft.position}
                  onChange={(event) => handleSelectPosition(event.target.value)}
                  className="h-8 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs"
                >
                  <option value="">— Выберите из штатного расписания —</option>
                  {draft.position &&
                    !positionOptions.some((opt) => opt.title === draft.position) && (
                      <option value={draft.position}>{draft.position}</option>
                    )}
                  {positionOptions.map((opt) => (
                    <option key={opt.title} value={opt.title}>
                      {opt.title}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={draft.position}
                  onChange={(event) => setDraft((prev) => ({ ...prev, position: event.target.value }))}
                  placeholder="Должность по штатному расписанию"
                  className="h-8 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs"
                />
              )}
            </label>
            <label className="block">
              <span className="block text-[10.5px] font-medium text-slate-600 dark:text-slate-300 mb-0.5">
                Подразделение
              </span>
              <input
                type="text"
                value={draft.dept}
                onChange={(event) => setDraft((prev) => ({ ...prev, dept: event.target.value }))}
                placeholder="Структурное подразделение"
                className="h-8 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs"
              />
            </label>
            <label className="block">
              <span className="block text-[10.5px] font-medium text-slate-600 dark:text-slate-300 mb-0.5">
                Дата приёма
              </span>
              <input
                type="date"
                value={draft.hireDate}
                onChange={(event) => setDraft((prev) => ({ ...prev, hireDate: event.target.value }))}
                className="h-8 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-mono"
              />
            </label>
            <label className="block">
              <span className="block text-[10.5px] font-medium text-slate-600 dark:text-slate-300 mb-0.5">
                СНИЛС
              </span>
              <input
                type="text"
                value={draft.snils}
                onChange={(event) => setDraft((prev) => ({ ...prev, snils: event.target.value }))}
                className="h-8 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-mono"
              />
            </label>
          </div>
          {(resolvedContext.soutClass || resolvedContext.harmfulFactor || resolvedContext.ppeNormSummary) && (
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/70 px-3 py-2 text-[11px] space-y-1 text-slate-600 dark:text-slate-300">
              <div className="font-semibold text-slate-800 dark:text-slate-200 flex flex-wrap items-center gap-2">
                <span>Условия труда по должности (29н / 766н)</span>
                {resolvedContext.soutClass && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200 font-mono text-[10px]">
                    СОУТ {resolvedContext.soutClass}
                  </span>
                )}
              </div>
              {resolvedContext.harmfulFactor && (
                <div>
                  <span className="text-slate-500">Фактор 29н{resolvedContext.factorCode29n ? ` (${resolvedContext.factorCode29n})` : ''}:</span>{' '}
                  <span className="font-medium text-slate-800 dark:text-slate-100">{resolvedContext.harmfulFactor}</span>
                </div>
              )}
              {resolvedContext.ppeNormSummary && (
                <div>
                  <span className="text-slate-500">Норма СИЗ (766н):</span>{' '}
                  <span>{resolvedContext.ppeNormSummary}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <AppButton variant="secondary" size="sm" disabled={!dirty} onClick={saveEmployee}>
              <Save className="w-3.5 h-3.5" />
              Сохранить данные
            </AppButton>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Просрочено', value: summary.overdue, tone: 'text-rose-600 dark:text-rose-400' },
            { label: 'Скоро', value: summary.dueSoon, tone: 'text-amber-600 dark:text-amber-400' },
            { label: 'Выполнено', value: summary.done, tone: 'text-emerald-600 dark:text-emerald-400' }
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2"
            >
              <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {item.label}
              </div>
              <div className={`text-xl font-semibold tabular-nums ${item.tone}`}>{item.value}</div>
            </div>
          ))}
        </div>

        {dismissed && (
          <StatusBanner variant="warning" role="status" compact>
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Работник уволен. Новые требования по нему не создаются.
            </span>
          </StatusBanner>
        )}

        {/* События жизненного цикла */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              События
            </h3>
            <span className="text-[10.5px] text-slate-500 dark:text-slate-400">
              {events.length ? `записей: ${events.length}` : 'нет событий'}
            </span>
          </div>

          {events.length > 0 && (
            <ul className="space-y-1">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center justify-between gap-2 text-[11.5px] text-slate-700 dark:text-slate-200"
                >
                  <span className="font-medium">{EMPLOYEE_EVENT_LABELS[event.type]}</span>
                  <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {formatIsoToDisplay(event.date)}
                    {event.note ? ` · ${event.note}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-end gap-2 pt-1">
            <label className="block">
              <span className="block text-[10px] font-medium text-slate-600 dark:text-slate-300 mb-0.5">
                Событие
              </span>
              <select
                value={eventType}
                onChange={(event) => setEventType(event.target.value as EmployeeEventType)}
                className="h-8 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs"
              >
                <option value="transfer">Перевод</option>
                <option value="dismissal">Увольнение</option>
                <option value="incident">Несчастный случай</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-[10px] font-medium text-slate-600 dark:text-slate-300 mb-0.5">
                Дата
              </span>
              <input
                type="date"
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
                className="h-8 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-mono"
              />
            </label>
            <label className="block flex-1 min-w-[140px]">
              <span className="block text-[10px] font-medium text-slate-600 dark:text-slate-300 mb-0.5">
                Примечание
              </span>
              <input
                type="text"
                value={eventNote}
                onChange={(event) => setEventNote(event.target.value)}
                placeholder="Например: перевод в цех №2"
                className="h-8 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs"
              />
            </label>
            <AppButton
              variant="secondary"
              size="sm"
              disabled={!eventDate}
              onClick={() => {
                onRegisterEvent(employeeRow.id, eventType, eventDate, eventNote.trim() || undefined);
                setEventNote('');
              }}
            >
              Зарегистрировать
            </AppButton>
          </div>
        </section>

        {!hireDate && (
          <StatusBanner variant="warning" role="status" compact>
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Заполните «Дату приёма» и сохраните — пакет документов рассчитается автоматически.
            </span>
          </StatusBanner>
        )}

        {summary.total === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-6 text-center">
            <CalendarClock className="mx-auto w-6 h-6 text-slate-400 mb-2" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Пакет ещё не рассчитан
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 mb-3">
              Приложение создаст обязательства по включённым модулям: инструктажи, медосмотр, СИЗ.
            </p>
            <AppButton
              variant="primary"
              size="sm"
              disabled={!hireDate}
              onClick={() => onEnsurePackage(employeeRow.id)}
            >
              Рассчитать пакет
            </AppButton>
          </div>
        ) : (
          grouped.map((group) => (
            <section key={group.moduleId} className="space-y-1.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {group.title}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((item) => {
                  const tone = toneFor(item, todayIso);
                  return (
                    <li
                      key={item.id}
                      className="flex items-start gap-3 rounded-xl bg-white/60 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[12.5px] font-medium text-slate-800 dark:text-slate-100">
                            {item.title}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE_CLASSES[tone]}`}
                          >
                            {TONE_LABEL[tone]}
                          </span>
                          {item.generatedDocId && (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                              документ сформирован
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[10.5px] text-slate-500 dark:text-slate-400">
                          {item.dueDate ? `Срок: ${formatIsoToDisplay(item.dueDate)}` : 'Без срока'}
                          {item.periodicityMonths ? ` · каждые ${item.periodicityMonths} мес.` : ''}
                          {item.legalBasis ? ` · ${item.legalBasis}` : ''}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        {item.kind === 'document' && item.status !== 'done' && (
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => void runDoc(item.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300/80 dark:border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-60"
                          >
                            {busyId === item.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <FileText className="w-3.5 h-3.5" />
                            )}
                            Документ
                          </button>
                        )}
                        {item.status === 'done' ? (
                          <button
                            type="button"
                            onClick={() => onReopenObligation(item.id)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Вернуть
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onCompleteObligation(item.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                          >
                            {tone === 'done' ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            Выполнено
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </AppModal>
  );
};
