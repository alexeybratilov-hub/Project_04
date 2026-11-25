import { EmployeeObligation, ObligationStatus, Row, Tab } from '../types/database';
import { HIRE_OBLIGATION_RULES, ObligationRule } from '../data/modules';
import { getTodayIso, parseFlexibleDateToIso } from './deadlineService';

export interface ObligationSummary {
  total: number;
  done: number;
  pending: number;
  overdue: number;
  dueSoon: number;
  nearestDueDate?: string;
}

export interface ControlViolation {
  employeeRowId: string;
  employeeName: string;
  obligationId: string;
  title: string;
  reason: string;
  dueDate?: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function addDaysIso(iso: string, days: number): string {
  const parsed = parseFlexibleDateToIso(iso);
  if (!parsed) return iso;
  const [year, month, day] = parsed.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function addMonthsIso(iso: string, months: number): string {
  const parsed = parseFlexibleDateToIso(iso);
  if (!parsed) return iso;
  const [year, month, day] = parsed.split('-').map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  return `${targetYear}-${pad2(normalizedMonth + 1)}-${pad2(safeDay)}`;
}

export function buildObligationId(employeeRowId: string, ruleId: string, dueDate?: string): string {
  return `obl_${employeeRowId}_${ruleId}${dueDate ? `_${dueDate}` : ''}`;
}

function ruleToObligation(
  rule: ObligationRule,
  employeeRowId: string,
  hireDateIso: string,
  createdAt: string
): EmployeeObligation {
  const dueDate = addDaysIso(hireDateIso, rule.offsetDays);
  return {
    id: buildObligationId(employeeRowId, rule.id),
    employeeRowId,
    moduleId: rule.moduleId,
    requirementId: rule.id,
    title: rule.title,
    kind: rule.kind,
    templateId: rule.templateId,
    dueDate,
    periodicityMonths: rule.periodicityMonths,
    status: 'pending',
    legalBasis: rule.legalBasis,
    createdAt
  };
}

/**
 * Пакет обязательств при приёме на работу.
 * Матрица требований — ядро приложения: она не зависит от того, какие модули-этапы
 * включены. Модули дают таблицы учёта и шаблоны, но требования действуют всегда.
 * Идемпотентно: существующие обязательства (по id) сохраняются как есть.
 */
export function ensureHireObligations(
  existing: EmployeeObligation[],
  params: {
    employeeRowId: string;
    hireDateIso: string;
    createdAt?: string;
  }
): EmployeeObligation[] {
  const hireDate = parseFlexibleDateToIso(params.hireDateIso);
  if (!hireDate) return existing;

  const createdAt = params.createdAt || new Date().toISOString();
  const known = new Set(existing.map((item) => item.id));
  const added: EmployeeObligation[] = [];

  HIRE_OBLIGATION_RULES.forEach((rule) => {
    if (rule.controlPoint) return;
    const obligation = ruleToObligation(rule, params.employeeRowId, hireDate, createdAt);
    if (known.has(obligation.id)) return;
    added.push(obligation);
  });

  if (added.length === 0) return existing;
  return [...existing, ...added];
}

/** Пересчитывает сроки незакрытых обязательств при изменении даты приёма. */
export function rescheduleObligationsForHireDate(
  existing: EmployeeObligation[],
  employeeRowId: string,
  hireDateIso: string
): EmployeeObligation[] {
  const hireDate = parseFlexibleDateToIso(hireDateIso);
  if (!hireDate) return existing;
  return existing.map((item) => {
    if (item.employeeRowId !== employeeRowId || item.status === 'done') return item;
    const rule = HIRE_OBLIGATION_RULES.find((candidate) => candidate.id === item.requirementId);
    if (!rule) return item;
    return { ...item, dueDate: addDaysIso(hireDate, rule.offsetDays) };
  });
}

/**
 * Отметка «Выполнено». Для периодических требований сразу создаётся следующая
 * задача со сроком «дата выполнения + периодичность».
 */
export function completeObligation(
  existing: EmployeeObligation[],
  obligationId: string,
  completedAtIso?: string
): EmployeeObligation[] {
  const completedAt = parseFlexibleDateToIso(completedAtIso || getTodayIso()) || getTodayIso();
  const target = existing.find((item) => item.id === obligationId);
  if (!target) return existing;

  const updated = existing.map((item) =>
    item.id === obligationId
      ? { ...item, status: 'done' as ObligationStatus, completedAt }
      : item
  );

  if (!target.periodicityMonths || target.periodicityMonths <= 0) {
    return updated;
  }

  const nextDueDate = addMonthsIso(completedAt, target.periodicityMonths);
  const nextId = buildObligationId(target.employeeRowId, target.requirementId, nextDueDate);
  if (updated.some((item) => item.id === nextId)) return updated;

  return [
    ...updated,
    {
      ...target,
      id: nextId,
      dueDate: nextDueDate,
      status: 'pending',
      completedAt: undefined,
      generatedDocId: undefined,
      createdAt: completedAt
    }
  ];
}

export function reopenObligation(
  existing: EmployeeObligation[],
  obligationId: string
): EmployeeObligation[] {
  return existing.map((item) =>
    item.id === obligationId
      ? { ...item, status: 'pending' as ObligationStatus, completedAt: undefined }
      : item
  );
}

export function summarizeObligations(
  obligations: EmployeeObligation[],
  todayIso: string = getTodayIso()
): ObligationSummary {
  const summary: ObligationSummary = {
    total: obligations.length,
    done: 0,
    pending: 0,
    overdue: 0,
    dueSoon: 0
  };

  obligations.forEach((item) => {
    if (item.status === 'done') {
      summary.done += 1;
      return;
    }
    if (item.status === 'skipped') return;
    summary.pending += 1;
    if (!item.dueDate) return;
    if (item.dueDate < todayIso) {
      summary.overdue += 1;
    } else if (addDaysIso(todayIso, 14) >= item.dueDate) {
      summary.dueSoon += 1;
    }
    if (!summary.nearestDueDate || item.dueDate < summary.nearestDueDate) {
      summary.nearestDueDate = item.dueDate;
    }
  });

  return summary;
}

export function getEmployeeObligations(
  all: EmployeeObligation[] | undefined,
  employeeRowId: string
): EmployeeObligation[] {
  if (!Array.isArray(all)) return [];
  return all.filter((item) => item.employeeRowId === employeeRowId);
}

export function getEmployeeDisplayName(row: Row, tab?: Tab): string {
  if (!row) return 'Сотрудник';
  const preferred = ['emp_fio', 'emp_name', 'fio'];
  for (const key of preferred) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const column = tab?.columns.find((col) => col.type === 'text' && String(row[col.id] ?? '').trim());
  if (column) return String(row[column.id]).trim();
  return 'Сотрудник';
}

export function getEmployeeHireDate(row: Row): string | undefined {
  const candidates = ['emp_hire_date', 'emp_hire', 'hire_date'];
  for (const key of candidates) {
    const parsed = parseFlexibleDateToIso(row[key]);
    if (parsed) return parsed;
  }
  return undefined;
}

/**
 * Контрольные точки: «принят, но обязательный документ не оформлен».
 * В отличие от сроков это проверка полноты пакета.
 */
export function detectControlViolations(
  obligations: EmployeeObligation[] | undefined,
  employees: Array<{ row: Row; tab?: Tab }>,
  todayIso: string = getTodayIso()
): ControlViolation[] {
  if (!Array.isArray(obligations)) return [];
  const violations: ControlViolation[] = [];

  employees.forEach(({ row, tab }) => {
    const employeeName = getEmployeeDisplayName(row, tab);
    obligations
      .filter(
        (item) =>
          item.employeeRowId === row.id &&
          item.kind === 'document' &&
          item.status === 'pending' &&
          Boolean(item.dueDate) &&
          item.dueDate! <= todayIso
      )
      .forEach((item) => {
        violations.push({
          employeeRowId: row.id,
          employeeName,
          obligationId: item.id,
          title: item.title,
          reason: 'Документ не оформлен, а срок уже наступил',
          dueDate: item.dueDate
        });
      });
  });

  return violations;
}

/**
 * Создаёт строку в таблице модуля (медосмотр, СИЗ, инструктаж), привязанную к работнику:
 * связи на мастер-таблицу «Сотрудники» заполняются ФИО, даты — датой приёма.
 */
export function buildLinkedRow(
  moduleTab: Tab,
  employeesTab: Tab,
  employeeRow: Row,
  dateIso?: string
): Row {
  const row: Row = {
    id: `row_auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  };
  moduleTab.columns.forEach((column) => {
    if (column.relation?.masterTabId === employeesTab.id) {
      const masterColumn = employeesTab.columns.find(
        (candidate) => candidate.id === column.relation?.masterColumnId
      );
      row[column.id] = masterColumn ? employeeRow[masterColumn.id] ?? '' : '';
      return;
    }
    if (column.type === 'date') {
      row[column.id] = dateIso || '';
      return;
    }
    if (column.type === 'boolean') {
      row[column.id] = false;
      return;
    }
    if (column.type === 'deadline_control') {
      row[column.id] = {};
      return;
    }
    row[column.id] = '';
  });
  return row;
}

export const obligationService = {
  addDaysIso,
  addMonthsIso,
  buildObligationId,
  buildLinkedRow,
  ensureHireObligations,
  rescheduleObligationsForHireDate,
  completeObligation,
  reopenObligation,
  summarizeObligations,
  getEmployeeObligations,
  getEmployeeDisplayName,
  getEmployeeHireDate,
  detectControlViolations
};
