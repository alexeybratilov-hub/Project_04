import {
  Column,
  ColumnType,
  DatabaseState,
  DeadlineAppSettings,
  DeadlineCellValue,
  DeadlineColumnConfig,
  DeadlinePeriodicityUnit,
  DeadlineWarningDayType,
  Row,
  Tab
} from '../types/database';

export const SYSTEM_DEADLINE_TAB_ID = '__system_deadline_control__';

export const DEFAULT_DEADLINE_COLUMN_CONFIG: DeadlineColumnConfig = {
  periodicityValue: 12,
  periodicityUnit: 'months',
  warningValue: 14,
  warningDayType: 'calendar'
};

export type DeadlineStatus =
  | 'completed'
  | 'missing_data'
  | 'overdue'
  | 'due_soon'
  | 'scheduled';

export const DEADLINE_STATUS_LABELS: Record<DeadlineStatus, string> = {
  completed: 'Выполнено',
  missing_data: 'Данные отсутствуют',
  overdue: 'Просрочено',
  due_soon: 'Скоро',
  scheduled: 'Запланировано'
};

export type DeadlineLastExecutionStatus = 'performed' | 'none';
export type DeadlineNextDateSource = 'manual' | 'auto' | 'none';

export interface DeadlineEvaluation {
  value: DeadlineCellValue;
  config: DeadlineColumnConfig;
  lastExecution: DeadlineLastExecutionStatus;
  actualDate?: string;
  calculatedNextDate?: string;
  manualNextDate?: string;
  effectiveNextDate?: string;
  nextDateSource: DeadlineNextDateSource;
  status: DeadlineStatus;
  statusLabel: string;
  calendarDaysRemaining?: number;
  workingDaysRemaining?: number;
  daysRemaining?: number;
  isOneTime: boolean;
}

export interface DeadlineEvaluateOptions {
  todayIso?: string;
  holidays?: string[];
  holidaysSet?: Set<string>;
}

export interface DeadlineEventItem {
  eventId: string;
  notificationKey: string;
  entityId: string;
  entityName: string;
  tabId: string;
  tabName: string;
  rowId: string;
  rowIdentifier: string;
  columnId: string;
  columnName: string;
  evaluation: DeadlineEvaluation;
}

export interface DeadlineEventFilter {
  entityId?: string;
  tabId?: string;
  status?: DeadlineStatus | 'all' | 'actionable' | 'closed_or_missing';
  search?: string;
}

export type DeadlineConversionTargetField = 'actualDate' | 'manualNextDate';
export type DeadlineReverseExtractMode =
  | 'effectiveNextDate'
  | 'actualDate'
  | 'summary'
  | 'rawOriginal';

export interface ToDeadlineConversionPreview {
  totalRows: number;
  recognizedCount: number;
  emptyCount: number;
  unrecognizedCount: number;
  unrecognizedSamples: Array<{ rowId: string; rawValue: string }>;
  targetField: DeadlineConversionTargetField;
  canConvert: boolean;
}

export interface FromDeadlineConversionPreview {
  totalRows: number;
  convertedCount: number;
  emptyCount: number;
  lostDataCount: number;
  partialLossCount: number;
  samplesOfLostData: Array<{ rowId: string; summary: string; reason: string }>;
  targetType: ColumnType;
  extractMode: DeadlineReverseExtractMode;
}

export type DeadlineDisplayMode = 'summary' | 'next_date' | 'actual_date' | 'tsv' | 'status';

const MS_PER_DAY = 86_400_000;
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  const maxDay = daysInMonth(year, month);
  return day >= 1 && day <= maxDay;
}

export function formatIsoDateParts(year: number, month: number, day: number): string {
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

export function parseIsoDateParts(
  iso: string
): { year: number; month: number; day: number } | null {
  if (typeof iso !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) return null;
  return { year, month, day };
}

/**
 * Parse YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY, Date, or Excel serial number into ISO YYYY-MM-DD.
 * Rejects invalid calendar dates such as 31.02.2026 or 29.02.2025.
 */
export function parseFlexibleDateToIso(input: unknown): string | undefined {
  if (input === null || input === undefined) return undefined;

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return undefined;
    const year = input.getFullYear();
    const month = input.getMonth() + 1;
    const day = input.getDate();
    return isValidCalendarDate(year, month, day) ? formatIsoDateParts(year, month, day) : undefined;
  }

  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 1 || input > 2_958_465) return undefined;
    const serial = Math.floor(input);
    // Excel 1900 date system phantom leap day (serial 60 = 1900-02-29)
    if (serial === 60) return undefined;
    const adjustedSerial = serial < 60 ? serial + 1 : serial;
    const d = new Date(EXCEL_EPOCH_UTC_MS + adjustedSerial * MS_PER_DAY);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    return isValidCalendarDate(year, month, day) ? formatIsoDateParts(year, month, day) : undefined;
  }

  if (typeof input !== 'string') return undefined;
  const raw = input.trim();
  if (!raw) return undefined;

  // YYYY-MM-DD (or YYYY-M-D, or ISO datetime YYYY-MM-DDTHH:mm...)
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T\d{2}:\d{2}.*)?$/.exec(raw);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return isValidCalendarDate(year, month, day) ? formatIsoDateParts(year, month, day) : undefined;
  }

  // DD.MM.YYYY or DD/MM/YYYY
  const ruMatch = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(raw);
  if (ruMatch) {
    const day = Number(ruMatch[1]);
    const month = Number(ruMatch[2]);
    const year = Number(ruMatch[3]);
    return isValidCalendarDate(year, month, day) ? formatIsoDateParts(year, month, day) : undefined;
  }

  return undefined;
}

export function formatIsoToDisplay(iso?: string): string {
  if (!iso) return '';
  const parts = parseIsoDateParts(iso);
  if (!parts) return '';
  return `${pad2(parts.day)}.${pad2(parts.month)}.${pad4(parts.year)}`;
}

/**
 * Returns today's local calendar date as YYYY-MM-DD without UTC day-shift bugs.
 */
export function getTodayIso(now: Date = new Date()): string {
  return formatIsoDateParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addCalendarDays(iso: string, days: number): string {
  const parts = parseIsoDateParts(iso);
  if (!parts) {
    throw new Error(`Invalid ISO date for addCalendarDays: ${iso}`);
  }
  const intDays = Math.trunc(days);
  const utcMs = Date.UTC(parts.year, parts.month - 1, parts.day) + intDays * MS_PER_DAY;
  const d = new Date(utcMs);
  return formatIsoDateParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addCalendarMonths(iso: string, months: number): string {
  const parts = parseIsoDateParts(iso);
  if (!parts) {
    throw new Error(`Invalid ISO date for addCalendarMonths: ${iso}`);
  }
  const intMonths = Math.trunc(months);
  const totalMonths = parts.year * 12 + (parts.month - 1) + intMonths;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (((totalMonths % 12) + 12) % 12) + 1;
  const targetDay = Math.min(parts.day, daysInMonth(targetYear, targetMonth));
  return formatIsoDateParts(targetYear, targetMonth, targetDay);
}

export function addCalendarYears(iso: string, years: number): string {
  const parts = parseIsoDateParts(iso);
  if (!parts) {
    throw new Error(`Invalid ISO date for addCalendarYears: ${iso}`);
  }
  const targetYear = parts.year + Math.trunc(years);
  const targetDay = Math.min(parts.day, daysInMonth(targetYear, parts.month));
  return formatIsoDateParts(targetYear, parts.month, targetDay);
}

/**
 * Exact signed calendar day difference: toIso - fromIso.
 * Positive => days remaining; 0 => same day; negative => days overdue.
 */
export function diffCalendarDays(fromIso: string, toIso: string): number {
  const from = parseIsoDateParts(fromIso);
  const to = parseIsoDateParts(toIso);
  if (!from || !to) {
    throw new Error(`Invalid ISO date(s) for diffCalendarDays: ${fromIso}, ${toIso}`);
  }
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

export function getDayOfWeek(iso: string): number {
  const parts = parseIsoDateParts(iso);
  if (!parts) {
    throw new Error(`Invalid ISO date for getDayOfWeek: ${iso}`);
  }
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function isWorkingDay(iso: string, holidaysSet?: Set<string>): boolean {
  const dow = getDayOfWeek(iso);
  if (dow === 0 || dow === 6) return false;
  if (holidaysSet && holidaysSet.has(iso)) return false;
  return true;
}

/**
 * Signed working days difference between fromIso (today) and toIso (effectiveNextDate):
 * - If toIso === fromIso => 0
 * - If toIso > fromIso => count of working days in (fromIso, toIso]
 * - If toIso < fromIso => -count of working days in (toIso, fromIso]
 */
export function diffWorkingDays(
  fromIso: string,
  toIso: string,
  holidays?: Iterable<string> | Set<string>
): number {
  if (!parseIsoDateParts(fromIso) || !parseIsoDateParts(toIso)) {
    throw new Error(`Invalid ISO date(s) for diffWorkingDays: ${fromIso}, ${toIso}`);
  }
  if (toIso === fromIso) return 0;

  const holidaysSet =
    holidays instanceof Set ? holidays : new Set<string>(holidays ? Array.from(holidays) : []);

  if (toIso > fromIso) {
    let count = 0;
    let cursor = addCalendarDays(fromIso, 1);
    while (cursor <= toIso) {
      if (isWorkingDay(cursor, holidaysSet)) {
        count += 1;
      }
      cursor = addCalendarDays(cursor, 1);
    }
    return count;
  }

  let count = 0;
  let cursor = addCalendarDays(toIso, 1);
  while (cursor <= fromIso) {
    if (isWorkingDay(cursor, holidaysSet)) {
      count += 1;
    }
    cursor = addCalendarDays(cursor, 1);
  }
  return count === 0 ? 0 : -count;
}

export function normalizeDeadlineColumnConfig(
  raw?: Partial<DeadlineColumnConfig> | null
): DeadlineColumnConfig {
  const validUnits: Set<DeadlinePeriodicityUnit> = new Set(['days', 'months', 'years']);
  const validDayTypes: Set<DeadlineWarningDayType> = new Set(['calendar', 'working']);

  const periodicityUnit: DeadlinePeriodicityUnit =
    raw?.periodicityUnit && validUnits.has(raw.periodicityUnit)
      ? raw.periodicityUnit
      : DEFAULT_DEADLINE_COLUMN_CONFIG.periodicityUnit;

  const rawPeriodicityVal = Number(raw?.periodicityValue);
  const periodicityValue =
    raw?.periodicityValue !== undefined &&
    raw?.periodicityValue !== null &&
    Number.isFinite(rawPeriodicityVal) &&
    rawPeriodicityVal >= 0
      ? Math.floor(rawPeriodicityVal)
      : DEFAULT_DEADLINE_COLUMN_CONFIG.periodicityValue;

  const warningDayType: DeadlineWarningDayType =
    raw?.warningDayType && validDayTypes.has(raw.warningDayType)
      ? raw.warningDayType
      : DEFAULT_DEADLINE_COLUMN_CONFIG.warningDayType;

  const rawWarningVal = Number(raw?.warningValue);
  const warningValue =
    raw?.warningValue !== undefined &&
    raw?.warningValue !== null &&
    Number.isFinite(rawWarningVal) &&
    rawWarningVal >= 0
      ? Math.floor(rawWarningVal)
      : DEFAULT_DEADLINE_COLUMN_CONFIG.warningValue;

  return {
    periodicityValue,
    periodicityUnit,
    warningValue,
    warningDayType
  };
}

export function normalizeHolidaysList(raw?: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<string>();
  for (const item of raw) {
    const iso = parseFlexibleDateToIso(item);
    if (iso) {
      unique.add(iso);
    }
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

export function normalizeSnoozedNotificationKeys(
  raw?: unknown,
  todayIso: string = getTodayIso()
): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) continue;
    const hideUntil = parseFlexibleDateToIso(val);
    if (hideUntil && todayIso < hideUntil) {
      out[cleanKey] = hideUntil;
    }
  }
  return out;
}

export function normalizeDeadlineAppSettings(
  raw?: Partial<DeadlineAppSettings> | null,
  todayIso: string = getTodayIso()
): DeadlineAppSettings {
  return {
    holidays: normalizeHolidaysList(raw?.holidays),
    snoozedNotificationKeys: normalizeSnoozedNotificationKeys(raw?.snoozedNotificationKeys, todayIso),
    notificationsEnabled: raw?.notificationsEnabled === false ? false : true
  };
}

export function isDeadlineCellObject(raw: unknown): raw is DeadlineCellValue {
  return Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof Date);
}

/**
 * Safely normalizes any raw cell value into minimal DeadlineCellValue
 * without `completed`/`completedAt` and without losing unparsed text.
 */
export function normalizeDeadlineCellValue(raw: unknown): DeadlineCellValue {
  if (raw === null || raw === undefined) return {};

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    const parsed = parseFlexibleDateToIso(trimmed);
    return parsed ? { actualDate: parsed } : { _rawOriginal: trimmed };
  }

  if (typeof raw === 'number') {
    const parsed = parseFlexibleDateToIso(raw);
    return parsed ? { actualDate: parsed } : { _rawOriginal: String(raw) };
  }

  if (raw instanceof Date) {
    const parsed = parseFlexibleDateToIso(raw);
    return parsed ? { actualDate: parsed } : {};
  }

  if (isDeadlineCellObject(raw)) {
    const obj = raw as Record<string, unknown>;
    const out: DeadlineCellValue = {};

    const actualParsed = parseFlexibleDateToIso(obj.actualDate);
    const manualParsed = parseFlexibleDateToIso(obj.manualNextDate);

    if (actualParsed) {
      out.actualDate = actualParsed;
    }
    if (manualParsed) {
      out.manualNextDate = manualParsed;
    }

    if (typeof obj.note === 'string' && obj.note.trim()) {
      out.note = obj.note.trim();
    }

    if (typeof obj._rawOriginal === 'string' && obj._rawOriginal.trim()) {
      out._rawOriginal = obj._rawOriginal.trim();
    } else if (!actualParsed && typeof obj.actualDate === 'string' && obj.actualDate.trim()) {
      out._rawOriginal = obj.actualDate.trim();
    } else if (!manualParsed && typeof obj.manualNextDate === 'string' && obj.manualNextDate.trim()) {
      out._rawOriginal = obj.manualNextDate.trim();
    }

    return out;
  }

  return { _rawOriginal: String(raw) };
}

export function hasAnyDeadlineCellContent(val: DeadlineCellValue): boolean {
  return Boolean(val.actualDate || val.manualNextDate || val.note || val._rawOriginal);
}

export function calculateNextDate(
  actualDate: string,
  rawConfig?: Partial<DeadlineColumnConfig> | null
): string | undefined {
  const iso = parseFlexibleDateToIso(actualDate);
  if (!iso) return undefined;
  const config = normalizeDeadlineColumnConfig(rawConfig);
  if (config.periodicityValue <= 0) return undefined;

  switch (config.periodicityUnit) {
    case 'days':
      return addCalendarDays(iso, config.periodicityValue);
    case 'months':
      return addCalendarMonths(iso, config.periodicityValue);
    case 'years':
      return addCalendarYears(iso, config.periodicityValue);
  }
}

export function evaluateDeadlineCell(
  rawValue: unknown,
  rawConfig?: Partial<DeadlineColumnConfig> | null,
  options?: DeadlineEvaluateOptions
): DeadlineEvaluation {
  const todayIso =
    (options?.todayIso ? parseFlexibleDateToIso(options.todayIso) : undefined) || getTodayIso();
  const holidaysSet =
    options?.holidaysSet ??
    new Set<string>(options?.holidays ? normalizeHolidaysList(options.holidays) : []);

  const config = normalizeDeadlineColumnConfig(rawConfig);
  const value = normalizeDeadlineCellValue(rawValue);
  const actualDate = value.actualDate;
  const manualNextDate = value.manualNextDate;
  const lastExecution: DeadlineLastExecutionStatus = actualDate ? 'performed' : 'none';
  const isOneTime = config.periodicityValue === 0;

  const calculatedNextDate = actualDate ? calculateNextDate(actualDate, config) : undefined;
  const effectiveNextDate = manualNextDate ?? calculatedNextDate;
  const nextDateSource: DeadlineNextDateSource = manualNextDate
    ? 'manual'
    : calculatedNextDate
      ? 'auto'
      : 'none';

  if (!effectiveNextDate) {
    const status: DeadlineStatus = isOneTime && actualDate ? 'completed' : 'missing_data';
    return {
      value,
      config,
      lastExecution,
      actualDate,
      calculatedNextDate,
      manualNextDate,
      effectiveNextDate: undefined,
      nextDateSource: 'none',
      status,
      statusLabel: DEADLINE_STATUS_LABELS[status],
      isOneTime
    };
  }

  const calendarDaysRemaining = diffCalendarDays(todayIso, effectiveNextDate);
  const workingDaysRemaining = diffWorkingDays(todayIso, effectiveNextDate, holidaysSet);
  const daysRemaining =
    config.warningDayType === 'working' ? workingDaysRemaining : calendarDaysRemaining;

  // Overdue check MUST always compare calendar dates (e.g. due Friday, today Saturday => overdue)
  let status: DeadlineStatus;
  if (effectiveNextDate < todayIso) {
    status = 'overdue';
  } else if (daysRemaining <= config.warningValue) {
    status = 'due_soon';
  } else {
    status = 'scheduled';
  }

  return {
    value,
    config,
    lastExecution,
    actualDate,
    calculatedNextDate,
    manualNextDate,
    effectiveNextDate,
    nextDateSource,
    status,
    statusLabel: DEADLINE_STATUS_LABELS[status],
    calendarDaysRemaining,
    workingDaysRemaining,
    daysRemaining,
    isOneTime
  };
}

/**
 * Sets a new actualDate and ALWAYS resets stale manualNextDate
 * unless an explicit new manualNextDate is supplied in the same action.
 */
export function applyActualDateUpdate(
  prevRaw: unknown,
  newActualDate: string | undefined | null,
  options?: { explicitManualNextDate?: string | null; note?: string | null }
): DeadlineCellValue {
  const prev = normalizeDeadlineCellValue(prevRaw);
  const nextActual =
    newActualDate === null || newActualDate === undefined || newActualDate === ''
      ? undefined
      : parseFlexibleDateToIso(newActualDate);

  const nextManual =
    options?.explicitManualNextDate === null ||
    options?.explicitManualNextDate === undefined ||
    options?.explicitManualNextDate === ''
      ? undefined
      : parseFlexibleDateToIso(options.explicitManualNextDate);

  const nextNote =
    options?.note === undefined
      ? prev.note
      : options.note === null || options.note.trim() === ''
        ? undefined
        : options.note.trim();

  const out: DeadlineCellValue = {};
  if (nextActual) out.actualDate = nextActual;
  if (nextManual) out.manualNextDate = nextManual;
  if (nextNote) out.note = nextNote;
  if (prev._rawOriginal) out._rawOriginal = prev._rawOriginal;
  return out;
}

export function markDeadlineCompletedToday(
  prevRaw: unknown,
  todayIso: string = getTodayIso()
): DeadlineCellValue {
  const validToday = parseFlexibleDateToIso(todayIso) || getTodayIso();
  return applyActualDateUpdate(prevRaw, validToday);
}

/**
 * Flexible cell update helper (e.g. for popover edits).
 * If actualDate is changed to a new date and manualNextDate isn't explicitly passed in the patch,
 * old manualNextDate is automatically reset so the next cycle recalculates cleanly.
 */
export function updateDeadlineCellValue(
  prevRaw: unknown,
  patch: {
    actualDate?: string | null;
    manualNextDate?: string | null;
    note?: string | null;
    _rawOriginal?: string | null;
  }
): DeadlineCellValue {
  const prev = normalizeDeadlineCellValue(prevRaw);

  let nextActual = prev.actualDate;
  if (patch.actualDate !== undefined) {
    nextActual =
      patch.actualDate === null || patch.actualDate === ''
        ? undefined
        : parseFlexibleDateToIso(patch.actualDate);
  }

  const actualDateChanged = patch.actualDate !== undefined && nextActual !== prev.actualDate;

  let nextManual = prev.manualNextDate;
  if (patch.manualNextDate !== undefined) {
    nextManual =
      patch.manualNextDate === null || patch.manualNextDate === ''
        ? undefined
        : parseFlexibleDateToIso(patch.manualNextDate);
  } else if (actualDateChanged && nextActual !== undefined) {
    nextManual = undefined;
  }

  let nextNote = prev.note;
  if (patch.note !== undefined) {
    nextNote =
      patch.note === null || patch.note.trim() === '' ? undefined : patch.note.trim();
  }

  let nextRawOriginal = prev._rawOriginal;
  if (patch._rawOriginal !== undefined) {
    nextRawOriginal =
      patch._rawOriginal === null || patch._rawOriginal.trim() === ''
        ? undefined
        : patch._rawOriginal.trim();
  }

  const out: DeadlineCellValue = {};
  if (nextActual) out.actualDate = nextActual;
  if (nextManual) out.manualNextDate = nextManual;
  if (nextNote) out.note = nextNote;
  if (nextRawOriginal) out._rawOriginal = nextRawOriginal;
  return out;
}

/**
 * Unified display formatter for TSV, Excel export, and DOCX/PDF tags
 * preventing [object Object] anywhere a deadline_control cell is serialized.
 */
export function formatDeadlineCellDisplay(
  rawValue: unknown,
  rawConfig?: Partial<DeadlineColumnConfig> | null,
  options?: DeadlineEvaluateOptions & { mode?: DeadlineDisplayMode }
): string {
  const mode: DeadlineDisplayMode = options?.mode ?? 'summary';
  const ev = evaluateDeadlineCell(rawValue, rawConfig, options);

  if (mode === 'status') {
    return ev.statusLabel;
  }

  if (mode === 'actual_date') {
    return formatIsoToDisplay(ev.actualDate);
  }

  if (mode === 'next_date') {
    if (ev.effectiveNextDate) return formatIsoToDisplay(ev.effectiveNextDate);
    if (ev.status === 'completed' && ev.actualDate) return formatIsoToDisplay(ev.actualDate);
    return ev.value._rawOriginal || '';
  }

  const nextDisp = formatIsoToDisplay(ev.effectiveNextDate);
  const actualDisp = formatIsoToDisplay(ev.actualDate);

  if (mode === 'tsv' || mode === 'summary') {
    if (ev.status === 'completed' && actualDisp) {
      return `Выполнено: ${actualDisp}`;
    }
    const parts: string[] = [];
    if (nextDisp) {
      const manualTag = ev.nextDateSource === 'manual' ? ', ручн.' : '';
      parts.push(`План: ${nextDisp} (${ev.statusLabel}${manualTag})`);
    }
    if (actualDisp) {
      parts.push(`Факт: ${actualDisp}`);
    }
    if (parts.length > 0) {
      return parts.join(' | ');
    }
    if (ev.value._rawOriginal) {
      return ev.value._rawOriginal;
    }
    return '';
  }

  return '';
}

export function buildDeadlineNotificationKey(params: {
  entityId: string;
  tabId: string;
  rowId: string;
  columnId: string;
  effectiveNextDate?: string;
  status: DeadlineStatus;
}): string {
  return `${params.entityId}::${params.tabId}::${params.rowId}::${params.columnId}::${params.effectiveNextDate || ''}::${params.status}`;
}

export function isNotificationSnoozed(
  notificationKey: string,
  deadlineSettings?: DeadlineAppSettings | null,
  todayIso: string = getTodayIso()
): boolean {
  const hideUntilRaw = deadlineSettings?.snoozedNotificationKeys?.[notificationKey];
  if (!hideUntilRaw) return false;
  const hideUntil = parseFlexibleDateToIso(hideUntilRaw);
  if (!hideUntil) return false;
  return todayIso < hideUntil;
}

export function createSnoozeMapForNotification(
  currentMap: Record<string, string> | undefined,
  notificationKey: string,
  todayIso: string = getTodayIso()
): Record<string, string> {
  const validToday = parseFlexibleDateToIso(todayIso) || getTodayIso();
  const nextMap = normalizeSnoozedNotificationKeys(currentMap, validToday);
  nextMap[notificationKey] = addCalendarDays(validToday, 1);
  return nextMap;
}

function getSafeRowIdentifier(row: Row, tab: Tab, fallbackRowNumber: number): string {
  const semanticCol = tab.columns.find(
    (c) =>
      c.type !== 'deadline_control' &&
      /^(фио|ф\.и\.о|работник|сотрудник|пострадавш|должност|наименован)/i.test(c.name.trim())
  );
  const firstTextCol = tab.columns.find((c) => c.type !== 'deadline_control');

  const candidates = [
    row.emp_fio,
    row.pos_title,
    row.fac_name,
    row.med_worker,
    row.siz_item,
    row.inst_worker,
    row.inc_victim,
    semanticCol ? row[semanticCol.id] : undefined,
    firstTextCol ? row[firstTextCol.id] : undefined
  ];

  for (const val of candidates) {
    if (val === null || val === undefined) continue;
    if (typeof val === 'object') continue;
    const trimmed = String(val).trim();
    if (trimmed) return trimmed;
  }

  return `Строка #${fallbackRowNumber} (${row.id})`;
}

const STATUS_SORT_WEIGHT: Record<DeadlineStatus, number> = {
  overdue: 0,
  due_soon: 1,
  scheduled: 2,
  missing_data: 3,
  completed: 4
};

export function collectDeadlineEvents(
  dbState: DatabaseState,
  options?: { todayIso?: string }
): DeadlineEventItem[] {
  const todayIso =
    (options?.todayIso ? parseFlexibleDateToIso(options.todayIso) : undefined) || getTodayIso();
  const holidays = normalizeHolidaysList(dbState.settings?.deadlineSettings?.holidays);
  const holidaysSet = new Set<string>(holidays);

  const events: DeadlineEventItem[] = [];
  const entities = Array.isArray(dbState.entities) ? dbState.entities : [];

  for (const entity of entities) {
    const entityName = entity.profile?.shortName || entity.profile?.fullName || entity.id;
    // Active entity mirrors in dbState.tabs may contain the newest in-memory edits before sync
    const entityTabs =
      entity.id === dbState.activeEntityId && Array.isArray(dbState.tabs)
        ? dbState.tabs
        : Array.isArray(entity.tabs)
          ? entity.tabs
          : [];

    for (const tab of entityTabs) {
      const deadlineCols = (tab.columns || []).filter((c) => c.type === 'deadline_control');
      if (deadlineCols.length === 0) continue;

      const rows = Array.isArray(tab.rows) ? tab.rows : [];
      rows.forEach((row, rowIdx) => {
        const rowIdentifier = getSafeRowIdentifier(row, tab, rowIdx + 1);
        for (const col of deadlineCols) {
          const evaluation = evaluateDeadlineCell(row[col.id], col.deadlineConfig, {
            todayIso,
            holidaysSet
          });
          const notificationKey = buildDeadlineNotificationKey({
            entityId: entity.id,
            tabId: tab.id,
            rowId: row.id,
            columnId: col.id,
            effectiveNextDate: evaluation.effectiveNextDate,
            status: evaluation.status
          });
          events.push({
            eventId: `${entity.id}::${tab.id}::${row.id}::${col.id}`,
            notificationKey,
            entityId: entity.id,
            entityName,
            tabId: tab.id,
            tabName: tab.name,
            rowId: row.id,
            rowIdentifier,
            columnId: col.id,
            columnName: col.name,
            evaluation
          });
        }
      });
    }
  }

  events.sort((a, b) => {
    const wa = STATUS_SORT_WEIGHT[a.evaluation.status];
    const wb = STATUS_SORT_WEIGHT[b.evaluation.status];
    if (wa !== wb) return wa - wb;

    const da = a.evaluation.daysRemaining ?? a.evaluation.calendarDaysRemaining;
    const db = b.evaluation.daysRemaining ?? b.evaluation.calendarDaysRemaining;
    if (da !== undefined && db !== undefined && da !== db) {
      return da - db;
    }

    const calA = a.evaluation.calendarDaysRemaining;
    const calB = b.evaluation.calendarDaysRemaining;
    if (calA !== undefined && calB !== undefined && calA !== calB) {
      return calA - calB;
    }

    if (a.evaluation.actualDate && b.evaluation.actualDate && a.evaluation.actualDate !== b.evaluation.actualDate) {
      return b.evaluation.actualDate.localeCompare(a.evaluation.actualDate);
    }

    return a.rowIdentifier.localeCompare(b.rowIdentifier, 'ru');
  });

  return events;
}

export function getActiveAlertDeadlineEvents(
  events: DeadlineEventItem[],
  deadlineSettings?: DeadlineAppSettings | null,
  todayIso: string = getTodayIso()
): DeadlineEventItem[] {
  const validToday = parseFlexibleDateToIso(todayIso) || getTodayIso();
  return events.filter((ev) => {
    if (ev.evaluation.status !== 'overdue' && ev.evaluation.status !== 'due_soon') {
      return false;
    }
    return !isNotificationSnoozed(ev.notificationKey, deadlineSettings, validToday);
  });
}

export function filterDeadlineEvents(
  events: DeadlineEventItem[],
  filter: DeadlineEventFilter
): DeadlineEventItem[] {
  const search = String(filter.search || '').trim().toLowerCase();

  return events.filter((ev) => {
    if (filter.entityId && filter.entityId !== 'all' && ev.entityId !== filter.entityId) {
      return false;
    }
    if (filter.tabId && filter.tabId !== 'all' && ev.tabId !== filter.tabId) {
      return false;
    }
    if (filter.status && filter.status !== 'all') {
      if (filter.status === 'actionable') {
        if (ev.evaluation.status !== 'overdue' && ev.evaluation.status !== 'due_soon') return false;
      } else if (filter.status === 'closed_or_missing') {
        if (ev.evaluation.status !== 'completed' && ev.evaluation.status !== 'missing_data') {
          return false;
        }
      } else if (ev.evaluation.status !== filter.status) {
        return false;
      }
    }
    if (search) {
      const hay = [
        ev.entityName,
        ev.tabName,
        ev.rowIdentifier,
        ev.columnName,
        ev.evaluation.statusLabel,
        formatIsoToDisplay(ev.evaluation.actualDate),
        formatIsoToDisplay(ev.evaluation.effectiveNextDate),
        ev.evaluation.value.note || ''
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function isEmptyScalarCell(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'string') return raw.trim() === '';
  return false;
}

export function previewConversionToDeadline(
  rows: Row[],
  columnId: string,
  options?: { targetField?: DeadlineConversionTargetField }
): ToDeadlineConversionPreview {
  const targetField: DeadlineConversionTargetField = options?.targetField ?? 'actualDate';
  let recognizedCount = 0;
  let emptyCount = 0;
  let unrecognizedCount = 0;
  const unrecognizedSamples: Array<{ rowId: string; rawValue: string }> = [];

  for (const row of rows) {
    const raw = row[columnId];
    if (isDeadlineCellObject(raw)) {
      const norm = normalizeDeadlineCellValue(raw);
      if (!hasAnyDeadlineCellContent(norm)) {
        emptyCount += 1;
      } else if (norm.actualDate || norm.manualNextDate) {
        recognizedCount += 1;
      } else {
        unrecognizedCount += 1;
        if (unrecognizedSamples.length < 10) {
          unrecognizedSamples.push({
            rowId: row.id,
            rawValue: norm._rawOriginal || norm.note || ''
          });
        }
      }
      continue;
    }

    if (isEmptyScalarCell(raw)) {
      emptyCount += 1;
      continue;
    }

    const parsed = parseFlexibleDateToIso(raw);
    if (parsed) {
      recognizedCount += 1;
    } else {
      unrecognizedCount += 1;
      if (unrecognizedSamples.length < 10) {
        unrecognizedSamples.push({
          rowId: row.id,
          rawValue: String(raw).trim()
        });
      }
    }
  }

  return {
    totalRows: rows.length,
    recognizedCount,
    emptyCount,
    unrecognizedCount,
    unrecognizedSamples,
    targetField,
    canConvert: true
  };
}

export function convertRowsToDeadline(
  rows: Row[],
  columnId: string,
  options?: { targetField?: DeadlineConversionTargetField }
): { rows: Row[]; preview: ToDeadlineConversionPreview } {
  const targetField: DeadlineConversionTargetField = options?.targetField ?? 'actualDate';
  const preview = previewConversionToDeadline(rows, columnId, { targetField });

  const nextRows = rows.map((row) => {
    const raw = row[columnId];
    if (isDeadlineCellObject(raw)) {
      return {
        ...row,
        [columnId]: normalizeDeadlineCellValue(raw)
      };
    }

    if (isEmptyScalarCell(raw)) {
      return {
        ...row,
        [columnId]: {}
      };
    }

    const parsed = parseFlexibleDateToIso(raw);
    if (parsed) {
      const nextVal: DeadlineCellValue =
        targetField === 'manualNextDate' ? { manualNextDate: parsed } : { actualDate: parsed };
      return {
        ...row,
        [columnId]: nextVal
      };
    }

    return {
      ...row,
      [columnId]: { _rawOriginal: String(raw).trim() } satisfies DeadlineCellValue
    };
  });

  return { rows: nextRows, preview };
}

function extractValueFromDeadlineCell(
  raw: unknown,
  targetType: ColumnType,
  extractMode: DeadlineReverseExtractMode,
  config: DeadlineColumnConfig,
  options?: DeadlineEvaluateOptions
): {
  value: any;
  hasContent: boolean;
  lostReason?: string;
  partialLoss?: boolean;
} {
  const norm = normalizeDeadlineCellValue(raw);
  const hasContent = hasAnyDeadlineCellContent(norm);
  if (!hasContent) {
    return { value: targetType === 'boolean' ? false : '', hasContent: false };
  }

  const ev = evaluateDeadlineCell(norm, config, options);

  if (targetType === 'date') {
    const picked =
      extractMode === 'actualDate' ? ev.actualDate : ev.effectiveNextDate;
    if (!picked) {
      return {
        value: '',
        hasContent: true,
        lostReason:
          extractMode === 'actualDate'
            ? 'Отсутствует фактическая дата'
            : 'Отсутствует плановая дата (возможно, сохранён только текст или факт для разового срока)'
      };
    }
    const hasExtraFields = Boolean(
      norm.note ||
        norm._rawOriginal ||
        (extractMode === 'actualDate' ? norm.manualNextDate : norm.actualDate && norm.manualNextDate)
    );
    return {
      value: picked,
      hasContent: true,
      partialLoss: hasExtraFields
    };
  }

  if (targetType === 'text') {
    if (extractMode === 'rawOriginal') {
      if (norm._rawOriginal) {
        return {
          value: norm._rawOriginal,
          hasContent: true,
          partialLoss: Boolean(norm.actualDate || norm.manualNextDate || norm.note)
        };
      }
      const fallbackIso = ev.effectiveNextDate || ev.actualDate;
      if (fallbackIso) {
        return { value: formatIsoToDisplay(fallbackIso), hasContent: true };
      }
      return {
        value: norm.note || '',
        hasContent: true,
        lostReason: !norm.note ? 'Отсутствует исходный текст' : undefined
      };
    }

    if (extractMode === 'actualDate') {
      const val = formatIsoToDisplay(ev.actualDate);
      if (!val) {
        return {
          value: '',
          hasContent: true,
          lostReason: 'Отсутствует фактическая дата'
        };
      }
      return {
        value: val,
        hasContent: true,
        partialLoss: Boolean(norm.manualNextDate || norm.note || norm._rawOriginal)
      };
    }

    if (extractMode === 'effectiveNextDate') {
      const val = formatIsoToDisplay(ev.effectiveNextDate);
      if (!val) {
        return {
          value: '',
          hasContent: true,
          lostReason: 'Отсутствует плановая дата'
        };
      }
      return {
        value: val,
        hasContent: true,
        partialLoss: Boolean(norm.actualDate || norm.note || norm._rawOriginal)
      };
    }

    // 'summary'
    const summaryText = formatDeadlineCellDisplay(norm, config, { ...options, mode: 'summary' });
    return {
      value: summaryText,
      hasContent: true,
      partialLoss: Boolean(norm.note)
    };
  }

  if (targetType === 'number') {
    const candidate = norm._rawOriginal?.trim();
    if (candidate && /^-?\d+(?:[.,]\d+)?$/.test(candidate)) {
      return { value: Number(candidate.replace(',', '.')), hasContent: true };
    }
    return {
      value: '',
      hasContent: true,
      lostReason: 'Значение контроля сроков не является числом'
    };
  }

  if (targetType === 'boolean') {
    const rawLower = (norm._rawOriginal || '').trim().toLowerCase();
    if (['да', 'true', '1', 'yes'].includes(rawLower)) {
      return { value: true, hasContent: true };
    }
    if (['нет', 'false', '0', 'no'].includes(rawLower)) {
      return { value: false, hasContent: true };
    }
    return {
      value: false,
      hasContent: true,
      lostReason: 'Даты и статусы нельзя однозначно свести к «Да / Нет»'
    };
  }

  if (targetType === 'select' || targetType === 'link') {
    if (norm._rawOriginal) {
      return { value: norm._rawOriginal, hasContent: true };
    }
    return {
      value: '',
      hasContent: true,
      lostReason: `Сложные данные контроля сроков несовместимы с типом «${targetType}»`
    };
  }

  return {
    value: '',
    hasContent: true,
    lostReason: `Несовместимый целевой тип «${targetType}»`
  };
}

export function previewConversionFromDeadline(
  rows: Row[],
  columnId: string,
  targetType: ColumnType,
  options?: DeadlineEvaluateOptions & {
    extractMode?: DeadlineReverseExtractMode;
    config?: Partial<DeadlineColumnConfig> | null;
  }
): FromDeadlineConversionPreview {
  const defaultExtract: DeadlineReverseExtractMode =
    targetType === 'date' ? 'effectiveNextDate' : 'summary';
  const extractMode = options?.extractMode ?? defaultExtract;
  const config = normalizeDeadlineColumnConfig(options?.config);

  let convertedCount = 0;
  let emptyCount = 0;
  let lostDataCount = 0;
  let partialLossCount = 0;
  const samplesOfLostData: Array<{ rowId: string; summary: string; reason: string }> = [];

  for (const row of rows) {
    const res = extractValueFromDeadlineCell(row[columnId], targetType, extractMode, config, options);
    if (!res.hasContent) {
      emptyCount += 1;
      continue;
    }
    if (res.lostReason) {
      lostDataCount += 1;
      if (samplesOfLostData.length < 10) {
        samplesOfLostData.push({
          rowId: row.id,
          summary: formatDeadlineCellDisplay(row[columnId], config, { ...options, mode: 'summary' }),
          reason: res.lostReason
        });
      }
    } else {
      convertedCount += 1;
      if (res.partialLoss) {
        partialLossCount += 1;
      }
    }
  }

  return {
    totalRows: rows.length,
    convertedCount,
    emptyCount,
    lostDataCount,
    partialLossCount,
    samplesOfLostData,
    targetType,
    extractMode
  };
}

export function convertRowsFromDeadline(
  rows: Row[],
  columnId: string,
  targetType: ColumnType,
  options?: DeadlineEvaluateOptions & {
    extractMode?: DeadlineReverseExtractMode;
    config?: Partial<DeadlineColumnConfig> | null;
  }
): { rows: Row[]; preview: FromDeadlineConversionPreview } {
  const defaultExtract: DeadlineReverseExtractMode =
    targetType === 'date' ? 'effectiveNextDate' : 'summary';
  const extractMode = options?.extractMode ?? defaultExtract;
  const config = normalizeDeadlineColumnConfig(options?.config);
  const preview = previewConversionFromDeadline(rows, columnId, targetType, {
    ...options,
    extractMode,
    config
  });

  const nextRows = rows.map((row) => {
    const res = extractValueFromDeadlineCell(row[columnId], targetType, extractMode, config, options);
    return {
      ...row,
      [columnId]: res.value
    };
  });

  return { rows: nextRows, preview };
}

/**
 * Pure, atomic column type conversion on a cloned Tab.
 * Blocks conversions involving `relation` columns to preserve referential integrity.
 */
export function applyColumnTypeConversion(
  tab: Tab,
  columnId: string,
  nextType: ColumnType,
  options?: DeadlineEvaluateOptions & {
    targetField?: DeadlineConversionTargetField;
    extractMode?: DeadlineReverseExtractMode;
    deadlineConfig?: Partial<DeadlineColumnConfig> | null;
  }
): {
  tab: Tab;
  preview: ToDeadlineConversionPreview | FromDeadlineConversionPreview;
} {
  const col = tab.columns.find((c) => c.id === columnId);
  if (!col) {
    throw new Error(`Столбец ${columnId} не найден во вкладке «${tab.name}».`);
  }
  if (col.type === 'relation' || nextType === 'relation') {
    throw new Error(
      'Смена типа столбца со связью (relation) заблокирована. Сначала открепите связь в структуре таблицы.'
    );
  }

  if (nextType === 'deadline_control') {
    const nextConfig = normalizeDeadlineColumnConfig(options?.deadlineConfig ?? col.deadlineConfig);
    const { rows: nextRows, preview } = convertRowsToDeadline(tab.rows, columnId, {
      targetField: options?.targetField
    });
    const nextColumns: Column[] = tab.columns.map((c) => {
      if (c.id !== columnId) return c;
      const { options: _dropOpts, ...rest } = c;
      return {
        ...rest,
        type: 'deadline_control',
        deadlineConfig: nextConfig
      };
    });
    return {
      tab: { ...tab, columns: nextColumns, rows: nextRows },
      preview
    };
  }

  if (col.type === 'deadline_control') {
    const config = normalizeDeadlineColumnConfig(col.deadlineConfig);
    const { rows: nextRows, preview } = convertRowsFromDeadline(tab.rows, columnId, nextType, {
      ...options,
      config
    });
    const nextColumns: Column[] = tab.columns.map((c) => {
      if (c.id !== columnId) return c;
      const { deadlineConfig: _dropDeadline, ...rest } = c;
      return {
        ...rest,
        type: nextType
      };
    });
    return {
      tab: { ...tab, columns: nextColumns, rows: nextRows },
      preview
    };
  }

  throw new Error(
    `Конвертация между ${col.type} и ${nextType} не поддерживается сервисом контроля сроков.`
  );
}
