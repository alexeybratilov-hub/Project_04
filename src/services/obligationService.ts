import {
  EmployeeEvent,
  EmployeeEventType,
  EmployeeObligation,
  ObligationStatus,
  Row,
  Tab
} from '../types/database';
import { EmployeeContext, OBLIGATION_RULES, ObligationRule, getRulesForEvent } from '../data/modules';
import {
  formatOccupationPpeSummary,
  parsePpeSummaryItem,
  resolveOccupationNormByTitle
} from '../data/occupationNorms';
import { getTodayIso, parseFlexibleDateToIso } from './deadlineService';

export type { EmployeeContext };

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

export function normalizeSoutClass(raw: unknown): string | undefined {
  const value = String(raw ?? '').trim();
  const match = /^(\d\.\d)/.exec(value);
  return match ? match[1] : undefined;
}

function findPositionsTab(tabs: Tab[]): Tab | undefined {
  return (
    tabs.find((tab) => tab.moduleId === 'staffing' || tab.id === 'tab_positions') ||
    tabs.find(
      (tab) =>
        tab.isMaster &&
        tab.columns.some((col) => col.id === 'pos_title' || /должность/i.test(col.name))
    )
  );
}

export function getEmployeePositionTitle(row: Row, employeesTab?: Tab, positionsTab?: Tab): string {
  if (!row) return '';
  const directCandidates = ['emp_pos', 'emp_position', 'pos_title'];
  for (const key of directCandidates) {
    const val = String(row[key] ?? '').trim();
    if (val) return val;
  }
  if (employeesTab) {
    const relCol = employeesTab.columns.find(
      (col) =>
        (col.type === 'relation' &&
          (col.relation?.masterColumnId === 'pos_title' ||
            (positionsTab && col.relation?.masterTabId === positionsTab.id))) ||
        /должность/i.test(col.name)
    );
    if (relCol) {
      const val = String(row[relCol.id] ?? '').trim();
      if (val) return val;
    }
  }
  return '';
}

export function getEmployeeDepartment(row: Row, employeesTab?: Tab, allTabs?: Tab[]): string {
  if (!row) return '';
  const directCandidates = ['emp_dept', 'pos_dept'];
  for (const key of directCandidates) {
    const val = String(row[key] ?? '').trim();
    if (val) return val;
  }
  if (employeesTab) {
    const deptCol = employeesTab.columns.find(
      (col) =>
        col.relation?.masterColumnId === 'pos_dept' || /подразделение/i.test(col.name)
    );
    if (deptCol) {
      const val = String(row[deptCol.id] ?? '').trim();
      if (val) return val;
    }
  }
  if (allTabs) {
    const positionsTab = findPositionsTab(allTabs);
    const posTitle = getEmployeePositionTitle(row, employeesTab, positionsTab);
    if (positionsTab && posTitle) {
      const posTitleCol =
        positionsTab.columns.find((col) => col.id === 'pos_title' || /должность/i.test(col.name))?.id ||
        'pos_title';
      const posDeptCol =
        positionsTab.columns.find((col) => col.id === 'pos_dept' || /подразделение/i.test(col.name))?.id ||
        'pos_dept';
      const posRow = positionsTab.rows.find(
        (candidate) => String(candidate[posTitleCol] ?? '').trim().toLowerCase() === posTitle.toLowerCase()
      );
      if (posRow) {
        return String(posRow[posDeptCol] ?? '').trim();
      }
    }
  }
  return '';
}

function findFactorsTab(tabs: Tab[]): Tab | undefined {
  return (
    tabs.find((tab) => tab.moduleId === 'sout' || tab.id === 'tab_factors') ||
    tabs.find((tab) => tab.columns.some((col) => col.id === 'fac_name' || col.id === 'fac_code'))
  );
}

/** Должность, класс условий труда, вредные факторы (29н) и нормы СИЗ (766н) работника. */
export function resolveEmployeeContext(tabs: Tab[], employeeRow: Row): EmployeeContext {
  const employeesTab = tabs.find((tab) => tab.moduleId === 'employees' || tab.id === 'tab_employees');
  const positionsTab = findPositionsTab(tabs);
  const factorsTab = findFactorsTab(tabs);
  const positionTitle = getEmployeePositionTitle(employeeRow, employeesTab, positionsTab);
  if (!positionTitle) return {};

  const catalogPreset = resolveOccupationNormByTitle(positionTitle);

  if (!positionsTab) {
    return {
      positionTitle,
      soutClass: normalizeSoutClass(catalogPreset?.soutClass),
      harmfulFactor: catalogPreset?.factorName || undefined,
      factorCode29n: catalogPreset?.factorCode29n || undefined,
      defaultPpe: catalogPreset?.ppeItems[0],
      ppeNormSummary: catalogPreset ? formatOccupationPpeSummary(catalogPreset.ppeItems) : undefined
    };
  }

  const posTitleColId =
    positionsTab.columns.find((col) => col.id === 'pos_title' || /должность/i.test(col.name))?.id ||
    'pos_title';
  const soutColId =
    positionsTab.columns.find((col) => col.id === 'pos_sout_class' || /класс.*условий/i.test(col.name))?.id ||
    'pos_sout_class';
  const factorsColId =
    positionsTab.columns.find(
      (col) => col.id === 'pos_factors' || /фактор/i.test(col.name)
    )?.id || 'pos_factors';
  const ppeColId =
    positionsTab.columns.find(
      (col) => col.id === 'pos_ppe_norm' || /норма\s*сиз/i.test(col.name)
    )?.id || 'pos_ppe_norm';

  const positionRow = positionsTab.rows.find(
    (row) =>
      String(row[posTitleColId] ?? '').trim().toLowerCase() === positionTitle.toLowerCase()
  );
  if (!positionRow) {
    return {
      positionTitle,
      soutClass: normalizeSoutClass(catalogPreset?.soutClass),
      harmfulFactor: catalogPreset?.factorName || undefined,
      factorCode29n: catalogPreset?.factorCode29n || undefined,
      defaultPpe: catalogPreset?.ppeItems[0],
      ppeNormSummary: catalogPreset ? formatOccupationPpeSummary(catalogPreset.ppeItems) : undefined
    };
  }

  const rawFactor = String(positionRow[factorsColId] ?? '').trim();
  const harmfulFactor = rawFactor || catalogPreset?.factorName || undefined;

  let factorCode29n = catalogPreset?.factorCode29n || undefined;
  if (harmfulFactor && factorsTab) {
    const facNameCol =
      factorsTab.columns.find((c) => c.id === 'fac_name' || /фактор/i.test(c.name))?.id || 'fac_name';
    const facCodeCol =
      factorsTab.columns.find((c) => c.id === 'fac_code' || /код/i.test(c.name))?.id || 'fac_code';
    const matchedFactor = factorsTab.rows.find(
      (fRow) => String(fRow[facNameCol] ?? '').trim().toLowerCase() === harmfulFactor.toLowerCase()
    );
    if (matchedFactor && matchedFactor[facCodeCol]) {
      factorCode29n = String(matchedFactor[facCodeCol]).trim();
    }
  }

  const rawPpeSummary = String(positionRow[ppeColId] ?? '').trim();
  const ppeNormSummary =
    rawPpeSummary ||
    (catalogPreset ? formatOccupationPpeSummary(catalogPreset.ppeItems) : undefined);
  const parsedPpe = rawPpeSummary ? parsePpeSummaryItem(rawPpeSummary) : undefined;
  const defaultPpe = parsedPpe || catalogPreset?.ppeItems[0];

  return {
    positionTitle,
    soutClass: normalizeSoutClass(positionRow[soutColId]),
    harmfulFactor,
    factorCode29n,
    ppeNormSummary,
    defaultPpe
  };
}

export function ruleApplies(rule: ObligationRule, context: EmployeeContext): boolean {
  const condition = rule.condition;
  if (!condition) return true;
  const position = (context.positionTitle || '').toLowerCase();

  if (condition.excludePositionMatches?.length && position) {
    if (condition.excludePositionMatches.some((fragment) => position.includes(fragment.toLowerCase()))) {
      return false;
    }
  }
  if (condition.positionMatches?.length) {
    const matched = condition.positionMatches.some((fragment) =>
      position.includes(fragment.toLowerCase())
    );
    if (!matched) return false;
  }
  if (condition.soutClassIn?.length) {
    if (!context.soutClass) return false;
    if (!condition.soutClassIn.includes(context.soutClass)) return false;
  }
  return true;
}

/** Периодичность требования с учётом класса условий труда. */
export function resolvePeriodicity(
  rule: ObligationRule,
  context: EmployeeContext
): number | undefined {
  if (rule.periodicityBySoutClass && context.soutClass) {
    const byClass = rule.periodicityBySoutClass[context.soutClass];
    if (typeof byClass === 'number') return byClass;
  }
  return rule.periodicityMonths;
}

export function buildObligationId(employeeRowId: string, ruleId: string, dueDate?: string): string {
  return `obl_${employeeRowId}_${ruleId}${dueDate ? `_${dueDate}` : ''}`;
}

function buildEventObligationId(
  employeeRowId: string,
  ruleId: string,
  event: EmployeeEvent | undefined
): string {
  // Приём — единственное событие, для которого сохраняем «короткий» id
  // (совместимость с уже созданными обязательствами).
  if (!event || event.type === 'hire') return `obl_${employeeRowId}_${ruleId}`;
  return `obl_${employeeRowId}_${ruleId}_${event.id}`;
}

function ruleToObligation(params: {
  rule: ObligationRule;
  employeeRowId: string;
  eventDateIso: string;
  event?: EmployeeEvent;
  context: EmployeeContext;
  createdAt: string;
}): EmployeeObligation {
  const { rule, employeeRowId, eventDateIso, event, context, createdAt } = params;
  const dueDate = addDaysIso(eventDateIso, rule.offsetDays);
  return {
    id: buildEventObligationId(employeeRowId, rule.id, event),
    employeeRowId,
    eventId: event?.id,
    eventType: event?.type,
    moduleId: rule.moduleId,
    requirementId: rule.id,
    title: rule.title,
    kind: rule.kind,
    templateId: rule.templateId,
    dueDate,
    periodicityMonths: resolvePeriodicity(rule, context),
    status: 'pending',
    legalBasis: rule.legalBasis,
    createdAt
  };
}

/**
 * Пакет обязательств при приёме на работу.
 * Матрица требований — ядро приложения: она не зависит от того, какие модули-этапы
 * включены. Условия (должность, класс условий труда) учитываются через `context`.
 * Идемпотентно: существующие обязательства (по id) сохраняются как есть.
 */
export function ensureHireObligations(
  existing: EmployeeObligation[],
  params: {
    employeeRowId: string;
    hireDateIso: string;
    context?: EmployeeContext;
    event?: EmployeeEvent;
    createdAt?: string;
  }
): EmployeeObligation[] {
  const hireDate = parseFlexibleDateToIso(params.hireDateIso);
  if (!hireDate) return existing;

  const createdAt = params.createdAt || new Date().toISOString();
  const context = params.context || {};
  const known = new Set(existing.map((item) => item.id));
  const added: EmployeeObligation[] = [];

  getRulesForEvent('hire').forEach((rule) => {
    if (!ruleApplies(rule, context)) return;
    const obligation = ruleToObligation({
      rule,
      employeeRowId: params.employeeRowId,
      eventDateIso: hireDate,
      event: params.event,
      context,
      createdAt
    });
    if (known.has(obligation.id)) return;
    added.push(obligation);
  });

  if (added.length === 0) return existing;
  return [...existing, ...added];
}

/**
 * Обязательства по событию (перевод, увольнение, несчастный случай).
 * Идемпотентно по паре «событие + требование».
 */
export function ensureEventObligations(
  existing: EmployeeObligation[],
  params: {
    employeeRowId: string;
    event: EmployeeEvent;
    context?: EmployeeContext;
    createdAt?: string;
  }
): EmployeeObligation[] {
  const eventDate = parseFlexibleDateToIso(params.event.date);
  if (!eventDate) return existing;

  const createdAt = params.createdAt || new Date().toISOString();
  const context = params.context || {};
  const known = new Set(existing.map((item) => item.id));
  const added: EmployeeObligation[] = [];

  getRulesForEvent(params.event.type).forEach((rule) => {
    if (!ruleApplies(rule, context)) return;
    const obligation = ruleToObligation({
      rule,
      employeeRowId: params.employeeRowId,
      eventDateIso: eventDate,
      event: params.event,
      context,
      createdAt
    });
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
    if (item.eventType && item.eventType !== 'hire') return item;
    const rule = OBLIGATION_RULES.find((candidate) => candidate.id === item.requirementId);
    if (!rule) return item;
    return { ...item, dueDate: addDaysIso(hireDate, rule.offsetDays) };
  });
}

/**
 * Синхронизирует обязательства работника при изменении должности, класса СОУТ или даты приёма:
 * добавляет новые применимые правила, убирает невыполненные условные задачи без документов,
 * обновляет периодичность и сдвигает сроки незакрытых задач приёма.
 */
export function syncEmployeeObligationsForProfileChange(
  existing: EmployeeObligation[],
  params: {
    employeeRowId: string;
    hireDateIso?: string;
    context?: EmployeeContext;
  }
): EmployeeObligation[] {
  const context = params.context || {};
  let next = existing.filter((item) => {
    if (item.employeeRowId !== params.employeeRowId) return true;
    if (item.status !== 'pending' || item.generatedDocId) return true;
    const rule = OBLIGATION_RULES.find((candidate) => candidate.id === item.requirementId);
    if (!rule?.condition) return true;
    return ruleApplies(rule, context);
  });

  next = next.map((item) => {
    if (item.employeeRowId !== params.employeeRowId || item.status !== 'pending') return item;
    const rule = OBLIGATION_RULES.find((candidate) => candidate.id === item.requirementId);
    if (!rule) return item;
    const nextPeriodicity = resolvePeriodicity(rule, context);
    return nextPeriodicity !== item.periodicityMonths
      ? { ...item, periodicityMonths: nextPeriodicity }
      : item;
  });

  if (params.hireDateIso) {
    next = ensureHireObligations(next, {
      employeeRowId: params.employeeRowId,
      hireDateIso: params.hireDateIso,
      context
    });
    next = rescheduleObligationsForHireDate(next, params.employeeRowId, params.hireDateIso);
  }

  return next;
}

export function removeObligationsForEmployees(
  existing: EmployeeObligation[] | undefined,
  employeeRowIds: Iterable<string>
): EmployeeObligation[] {
  if (!Array.isArray(existing)) return [];
  const idSet = new Set(employeeRowIds);
  if (idSet.size === 0) return existing;
  return existing.filter((item) => !idSet.has(item.employeeRowId));
}

export function removeEventsForEmployees(
  events: EmployeeEvent[] | undefined,
  employeeRowIds: Iterable<string>
): EmployeeEvent[] {
  if (!Array.isArray(events)) return [];
  const idSet = new Set(employeeRowIds);
  if (idSet.size === 0) return events;
  return events.filter((event) => !idSet.has(event.employeeRowId));
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
  const nextId = `${target.id}_next_${nextDueDate}`;
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

/** Последнее событие указанного типа (например, увольнение). */
export function getLatestEvent(
  events: EmployeeEvent[] | undefined,
  employeeRowId: string,
  type: EmployeeEventType
): EmployeeEvent | undefined {
  if (!Array.isArray(events)) return undefined;
  return events
    .filter((event) => event.employeeRowId === employeeRowId && event.type === type)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function isEmployeeDismissed(
  events: EmployeeEvent[] | undefined,
  employeeRowId: string
): boolean {
  return Boolean(getLatestEvent(events, employeeRowId, 'dismissal'));
}

export function getEmployeeEvents(
  events: EmployeeEvent[] | undefined,
  employeeRowId: string
): EmployeeEvent[] {
  if (!Array.isArray(events)) return [];
  return events
    .filter((event) => event.employeeRowId === employeeRowId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Создаёт строку в таблице модуля (медосмотр, СИЗ, инструктаж), привязанную к работнику:
 * связи на «Сотрудники» заполняются ФИО/данными работника, связи на «Штатное расписание» —
 * должностью и подразделением работника, даты — датой события.
 */
export function buildLinkedRow(
  moduleTab: Tab,
  employeesTab: Tab,
  employeeRow: Row,
  dateIso?: string,
  allTabs?: Tab[]
): Row {
  const row: Row = {
    id: `row_auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  };
  const positionsTab = allTabs ? findPositionsTab(allTabs) : undefined;
  const positionTitle = getEmployeePositionTitle(employeeRow, employeesTab, positionsTab);
  const department = getEmployeeDepartment(employeeRow, employeesTab, allTabs);
  const context = allTabs
    ? resolveEmployeeContext(allTabs, employeeRow)
    : resolveEmployeeContext([employeesTab], employeeRow);

  const medPeriodMonths = context.soutClass?.startsWith('3.') ? 12 : 24;
  const ppeWearMonths = context.defaultPpe?.wearMonths ?? 12;

  moduleTab.columns.forEach((column) => {
    if (column.relation?.masterTabId === employeesTab.id) {
      const masterColumn = employeesTab.columns.find(
        (candidate) => candidate.id === column.relation?.masterColumnId
      );
      row[column.id] = masterColumn ? employeeRow[masterColumn.id] ?? '' : '';
      return;
    }
    if (column.relation) {
      const masterColId = column.relation.masterColumnId;
      const isPosRel =
        masterColId === 'pos_title' ||
        column.id.endsWith('_pos') ||
        /должность/i.test(column.name);
      if (isPosRel) {
        row[column.id] = positionTitle;
        return;
      }
      const isDeptRel =
        masterColId === 'pos_dept' ||
        column.id.endsWith('_dept') ||
        /подразделение/i.test(column.name);
      if (isDeptRel) {
        row[column.id] = department;
        return;
      }
      const isFactorRel =
        masterColId === 'fac_name' ||
        column.id === 'med_factor' ||
        /вредн.*фактор/i.test(column.name);
      if (isFactorRel) {
        row[column.id] = context.harmfulFactor || '';
        return;
      }
    }
    if (column.id === 'siz_item' && context.defaultPpe?.name) {
      row[column.id] = context.defaultPpe.name;
      return;
    }
    if (column.id === 'siz_unit' && context.defaultPpe?.unit) {
      row[column.id] = context.defaultPpe.unit;
      return;
    }
    if (column.id === 'siz_norm' && context.defaultPpe?.annualNorm !== undefined) {
      row[column.id] = context.defaultPpe.annualNorm;
      return;
    }
    if (column.id === 'siz_wear_months' && context.defaultPpe?.wearMonths !== undefined) {
      row[column.id] = ppeWearMonths;
      return;
    }
    if (column.type === 'date') {
      if (dateIso && column.id === 'med_next_date') {
        row[column.id] = addMonthsIso(dateIso, medPeriodMonths);
      } else if (dateIso && column.id === 'siz_next_date') {
        row[column.id] = addMonthsIso(dateIso, ppeWearMonths);
      } else {
        row[column.id] = dateIso || '';
      }
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

export const obligationService = {
  addDaysIso,
  addMonthsIso,
  normalizeSoutClass,
  getEmployeePositionTitle,
  getEmployeeDepartment,
  resolveEmployeeContext,
  ruleApplies,
  resolvePeriodicity,
  buildObligationId,
  buildLinkedRow,
  ensureHireObligations,
  ensureEventObligations,
  rescheduleObligationsForHireDate,
  syncEmployeeObligationsForProfileChange,
  removeObligationsForEmployees,
  removeEventsForEmployees,
  completeObligation,
  reopenObligation,
  summarizeObligations,
  getEmployeeObligations,
  getEmployeeDisplayName,
  getEmployeeHireDate,
  getLatestEvent,
  getEmployeeEvents,
  isEmployeeDismissed,
  detectControlViolations
};
