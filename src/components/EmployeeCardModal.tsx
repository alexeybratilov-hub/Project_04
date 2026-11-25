import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  RotateCcw,
  Save,
  UserRound
} from 'lucide-react';
import { EmployeeObligation, Row, Tab } from '../types/database';
import { AppModal, AppButton, StatusBanner } from './ui';
import { MODULE_BY_ID } from '../data/modules';
import {
  getEmployeeDisplayName,
  getEmployeeHireDate,
  summarizeObligations
} from '../services/obligationService';
import { formatIsoToDisplay } from '../services/deadlineService';

interface EmployeeCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeRow: Row | null;
  employeesTab: Tab;
  obligations: EmployeeObligation[];
  todayIso: string;
  isWorking: boolean;
  onEnsurePackage: (employeeRowId: string) => void;
  onGenerateDocument: (obligationId: string) => Promise<void> | void;
  onGeneratePackage: (employeeRowId: string) => Promise<void> | void;
  onCompleteObligation: (obligationId: string) => void;
  onReopenObligation: (obligationId: string) => void;
  onUpdateEmployee: (employeeRowId: string, patch: Record<string, any>) => void;
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
  obligations,
  todayIso,
  isWorking,
  onEnsurePackage,
  onGenerateDocument,
  onGeneratePackage,
  onCompleteObligation,
  onReopenObligation,
  onUpdateEmployee
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({ fio: '', tabNum: '', hireDate: '', snils: '' });

  useEffect(() => {
    if (!employeeRow) return;
    setDraft({
      fio: String(employeeRow[FIELD_IDS.fio] ?? ''),
      tabNum: String(employeeRow[FIELD_IDS.tabNum] ?? ''),
      hireDate: String(employeeRow[FIELD_IDS.hireDate] ?? ''),
      snils: String(employeeRow[FIELD_IDS.snils] ?? '')
    });
  }, [employeeRow]);

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
  const dirty =
    String(employeeRow[FIELD_IDS.fio] ?? '') !== draft.fio ||
    String(employeeRow[FIELD_IDS.tabNum] ?? '') !== draft.tabNum ||
    String(employeeRow[FIELD_IDS.hireDate] ?? '') !== draft.hireDate ||
    String(employeeRow[FIELD_IDS.snils] ?? '') !== draft.snils;

  const saveEmployee = () => {
    onUpdateEmployee(employeeRow.id, {
      [FIELD_IDS.fio]: draft.fio.trim(),
      [FIELD_IDS.tabNum]: draft.tabNum.trim(),
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
