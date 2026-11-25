import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock3, FileText, Search, UserPlus, Users } from 'lucide-react';
import { EmployeeEvent, EmployeeObligation, Row, Tab } from '../types/database';
import {
  getEmployeeDisplayName,
  getEmployeeHireDate,
  getLatestEvent,
  isEmployeeDismissed,
  summarizeObligations
} from '../services/obligationService';
import { formatIsoToDisplay } from '../services/deadlineService';

interface EmployeesViewProps {
  employeesTab: Tab;
  obligations: EmployeeObligation[];
  todayIso: string;
  onOpenCard: (rowId: string) => void;
  onAddEmployee: () => void;
  onGeneratePackage: (rowId: string) => void;
  onEnsureAllPackages: () => void;
  employeeEvents: EmployeeEvent[];
}

interface EmployeeRowInfo {
  row: Row;
  name: string;
  position: string;
  department: string;
  hireDate?: string;
  total: number;
  done: number;
  overdue: number;
  dueSoon: number;
  nextDue?: string;
  dismissed: boolean;
  dismissalDate?: string;
}

function columnValue(row: Row, tab: Tab, candidates: string[], namePattern?: RegExp): string {
  for (const key of candidates) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  if (namePattern) {
    const column = tab.columns.find((col) => namePattern.test(col.name));
    if (column) {
      const value = row[column.id];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value).trim();
      }
    }
  }
  return '';
}

export const EmployeesView: React.FC<EmployeesViewProps> = ({
  employeesTab,
  obligations,
  todayIso,
  onOpenCard,
  onAddEmployee,
  onGeneratePackage,
  onEnsureAllPackages,
  employeeEvents
}) => {
  const [query, setQuery] = useState('');

  const rows = useMemo<EmployeeRowInfo[]>(() => {
    return employeesTab.rows.map((row) => {
      const own = obligations.filter((item) => item.employeeRowId === row.id);
      const summary = summarizeObligations(own, todayIso);
      return {
        row,
        name: getEmployeeDisplayName(row, employeesTab),
        position: columnValue(row, employeesTab, ['emp_position', 'emp_post'], /должност/i),
        department: columnValue(row, employeesTab, ['emp_dept', 'emp_department'], /подразделен/i),
        hireDate: getEmployeeHireDate(row),
        total: summary.total,
        done: summary.done,
        overdue: summary.overdue,
        dueSoon: summary.dueSoon,
        nextDue: summary.nearestDueDate,
        dismissed: isEmployeeDismissed(employeeEvents, row.id),
        dismissalDate: getLatestEvent(employeeEvents, row.id, 'dismissal')?.date
      };
    });
  }, [employeesTab, obligations, todayIso, employeeEvents]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.position.toLowerCase().includes(needle) ||
        item.department.toLowerCase().includes(needle)
    );
  }, [rows, query]);

  const totals = useMemo(() => {
    const active = rows.filter((item) => !item.dismissed);
    const withPackage = active.filter((item) => item.total > 0).length;
    const overdue = active.filter((item) => item.overdue > 0).length;
    const complete = active.filter((item) => item.total > 0 && item.done === item.total).length;
    return { total: rows.length, active: active.length, withPackage, overdue, complete };
  }, [rows]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1560px] px-4 lg:px-6 py-5 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              <Users className="w-3.5 h-3.5" />
              Модуль «Сотрудники»
            </div>
            <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
              Работники и их пакеты документов
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Всего: {totals.total} · работают: {totals.active} · с пакетом: {totals.withPackage} · есть
              просрочки: {totals.overdue} · полностью закрыто: {totals.complete}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по ФИО, должности…"
                className="h-9 w-64 rounded-xl border border-white/70 dark:border-slate-700/60 bg-white/70 dark:bg-slate-900/60 pl-8 pr-3 text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                aria-label="Поиск по сотрудникам"
              />
            </label>
            <button
              type="button"
              onClick={onEnsureAllPackages}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/70 bg-white/70 px-3 text-xs font-medium text-slate-700 hover:bg-white dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ClipboardCheck className="w-4 h-4" />
              Рассчитать пакеты
            </button>
            <button
              type="button"
              onClick={onAddEmployee}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white hover:opacity-90 dark:bg-white dark:text-slate-900"
            >
              <UserPlus className="w-4 h-4" />
              Добавить сотрудника
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="lg-card p-8 text-center">
            <Users className="mx-auto w-7 h-7 text-slate-400 mb-2" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {rows.length === 0 ? 'Сотрудников пока нет' : 'Ничего не найдено'}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {rows.length === 0
                ? 'Добавьте первого работника — пакет документов и сроки рассчитаются автоматически.'
                : 'Измените запрос или добавьте нового сотрудника.'}
            </p>
          </div>
        ) : (
          <div className="lg-card overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th scope="col" className="px-4 py-2.5 font-medium">Сотрудник</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Должность / подразделение</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Дата приёма</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Пакет документов</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Ближайший срок</th>
                  <th scope="col" className="px-4 py-2.5 font-medium text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-700/50">
                {filtered.map((item) => {
                  const progress = item.total > 0 ? Math.round((item.done / item.total) * 100) : 0;
                  return (
                    <tr key={item.row.id} className="hover:bg-white/60 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => onOpenCard(item.row.id)}
                          className={`font-semibold text-left hover:text-blue-600 dark:hover:text-blue-400 ${
                            item.dismissed
                              ? 'text-slate-400 dark:text-slate-500 line-through'
                              : 'text-slate-800 dark:text-slate-100'
                          }`}
                        >
                          {item.name}
                        </button>
                        {item.dismissed && (
                          <span className="ml-2 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            уволен
                            {item.dismissalDate ? ` ${formatIsoToDisplay(item.dismissalDate)}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {item.position || '—'}
                        {item.department ? ` · ${item.department}` : ''}
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {item.hireDate ? formatIsoToDisplay(item.hireDate) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {item.total === 0 ? (
                          <span className="text-[11px] text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            не рассчитан
                          </span>
                        ) : (
                          <div className="flex items-center gap-2 min-w-[150px]">
                            <div className="h-1.5 w-24 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  item.overdue > 0
                                    ? 'bg-rose-500'
                                    : progress === 100
                                      ? 'bg-emerald-500'
                                      : 'bg-blue-500'
                                }`}
                                style={{ width: `${Math.max(4, progress)}%` }}
                              />
                            </div>
                            <span className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300">
                              {item.done}/{item.total}
                            </span>
                            {item.overdue > 0 && (
                              <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                                просрочено {item.overdue}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {item.nextDue ? (
                          <span className="inline-flex items-center gap-1 font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300">
                            {item.overdue > 0 ? (
                              <Clock3 className="w-3.5 h-3.5 text-rose-500" />
                            ) : item.dueSoon > 0 ? (
                              <Clock3 className="w-3.5 h-3.5 text-amber-500" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            )}
                            {formatIsoToDisplay(item.nextDue)}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onGeneratePackage(item.row.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300/80 dark:border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            Пакет
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenCard(item.row.id)}
                            className="rounded-lg px-2 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                          >
                            Карточка
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
