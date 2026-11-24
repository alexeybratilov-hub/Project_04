import {
  Column,
  ColumnType,
  DatabaseState,
  DeadlineAppSettings,
  DeadlineCellValue,
  DeadlineColumnConfig,
  DeadlinePeriodicityUnit,
  DeadlineWarningDayType,
  LegalEntity,
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
  rowIdentifier?: string;
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

export type DeadlineLostFieldKey = 'actualDate' | 'manualNextDate' | 'note' | '_rawOriginal';

export interface FromDeadlineConversionPreview {
  totalRows: number;
  convertedCount: number;
  emptyCount: number;
  lostDataCount: number;
  partialLossCount: number;
  lostFieldsSummary: Record<DeadlineLostFieldKey, number>;
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
 * Supports an optional controlled test date override on globalThis when `now` is omitted.
 */
export function getTodayIso(now?: Date): string {
  if (!now) {
    const testOverride = (globalThis as { __OT_BAZA_TEST_TODAY_ISO__?: unknown })
      .__OT_BAZA_TEST_TODAY_ISO__;
    if (typeof testOverride === 'string') {
      const parsed = parseIsoDateParts(testOverride);
      if (parsed) {
        return formatIsoDateParts(parsed.year, parsed.month, parsed.day);
      }
    }
  }
  const effectiveNow = now ?? new Date();
  return formatIsoDateParts(
    effectiveNow.getFullYear(),
    effectiveNow.getMonth() + 1,
    effectiveNow.getDate()
  );
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

/**
 * Lossless single-column Excel serialization for `deadline_control` cells.
 * Preserves actualDate, effectiveNextDate (distinguishing manual vs auto), note, and _rawOriginal:
 * - Empty -> ''
 * - Periodic with auto plan -> "План: ДД.ММ.ГГГГ (<Статус>) | Факт: ДД.ММ.ГГГГ"
 * - With manualNextDate -> "План: ДД.ММ.ГГГГ (<Статус>, ручн.) [| Факт: ДД.ММ.ГГГГ]"
 * - One-time completed -> "Выполнено: ДД.ММ.ГГГГ"
 * - Optional suffixes: " | Исх.: <_rawOriginal>" (when dates/note also present) and " | Прим.: <note>" (always last)
 */
export function formatDeadlineCellForExcel(
  rawValue: unknown,
  rawConfig?: Partial<DeadlineColumnConfig> | null,
  options?: DeadlineEvaluateOptions
): string {
  const ev = evaluateDeadlineCell(rawValue, rawConfig, options);
  if (!hasAnyDeadlineCellContent(ev.value)) {
    return '';
  }

  const nextDisp = formatIsoToDisplay(ev.effectiveNextDate);
  const actualDisp = formatIsoToDisplay(ev.actualDate);
  const parts: string[] = [];

  if (ev.status === 'completed' && actualDisp) {
    parts.push(`Выполнено: ${actualDisp}`);
  } else {
    if (nextDisp) {
      const manualTag = ev.nextDateSource === 'manual' ? ', ручн.' : '';
      parts.push(`План: ${nextDisp} (${ev.statusLabel}${manualTag})`);
    }
    if (actualDisp) {
      parts.push(`Факт: ${actualDisp}`);
    }
  }

  const hasDateParts = parts.length > 0;
  if (ev.value._rawOriginal) {
    if (!hasDateParts && !ev.value.note) {
      return ev.value._rawOriginal;
    }
    parts.push(`Исх.: ${ev.value._rawOriginal}`);
  }

  if (ev.value.note) {
    parts.push(`Прим.: ${ev.value.note}`);
  }

  return parts.join(' | ');
}

const KNOWN_STATUS_MARKERS = [
  'просрочено',
  'скоро',
  'запланировано',
  'выполнено',
  'данные отсутствуют'
];

/**
 * Parses Excel/clipboard cell input for a `deadline_control` column back into DeadlineCellValue
 * without losing `actualDate`, `manualNextDate`, `note`, or `_rawOriginal`.
 */
export function parseDeadlineCellFromExcel(raw: unknown): DeadlineCellValue {
  if (raw === null || raw === undefined) return {};

  if (isDeadlineCellObject(raw)) {
    return normalizeDeadlineCellValue(raw);
  }

  if (raw instanceof Date || typeof raw === 'number') {
    const parsed = parseFlexibleDateToIso(raw);
    return parsed ? { actualDate: parsed } : { _rawOriginal: String(raw) };
  }

  if (typeof raw !== 'string') {
    return { _rawOriginal: String(raw) };
  }

  const trimmed = raw.trim();
  if (!trimmed) return {};

  // Check if input uses structured markers exported by OT-Baza (План:/Факт:/Выполнено:/Исх.:/Прим.:)
  const hasStructuredMarker =
    /(?:^|\|\s*)(План(?:\s*\([^)]*\))?|Факт|Выполнено|Исх\.?|Прим\.?)\s*:/i.test(trimmed);

  if (hasStructuredMarker) {
    let working = trimmed;
    let note: string | undefined;
    let rawOriginal: string | undefined;

    // Extract trailing "Прим.:" first so pipes inside note text are preserved intact
    const noteMatch = /(?:^|\|\s*)Прим\.?\s*:\s*([\s\S]*)$/i.exec(working);
    if (noteMatch) {
      const noteText = noteMatch[1].trim();
      if (noteText) note = noteText;
      working = working.slice(0, noteMatch.index).trim();
    }

    // Extract "Исх.:" if present
    const origMatch = /(?:^|\|\s*)Исх\.?\s*:\s*([\s\S]*?)(?=(?:\|\s*(?:План(?:\s*\([^)]*\))?|Факт|Выполнено)\s*:|$))/i.exec(
      working
    );
    if (origMatch) {
      const origText = origMatch[1].trim();
      if (origText) rawOriginal = origText;
      working = (
        working.slice(0, origMatch.index) +
        working.slice(origMatch.index + origMatch[0].length)
      )
        .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
        .trim();
    }

    let actualDate: string | undefined;
    let planDate: string | undefined;
    let planExplicitManual = false;
    let planHasAutoOrStatusTag = false;

    const segments = working
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const seg of segments) {
      const segMatch = /^(План(?:\s*\([^)]*\))?|Факт|Выполнено)\s*:\s*(.+)$/i.exec(seg);
      if (!segMatch) {
        if (!rawOriginal) rawOriginal = seg;
        continue;
      }
      const label = segMatch[1].toLowerCase();
      const body = segMatch[2].trim();
      const dateTokenMatch = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./]\d{1,2}[./]\d{4})(?:\s*(.*))?$/.exec(
        body
      );
      const parsedDate = dateTokenMatch
        ? parseFlexibleDateToIso(dateTokenMatch[1])
        : parseFlexibleDateToIso(body);
      const trailingMeta = `${label} ${dateTokenMatch?.[2] || ''}`.toLowerCase();

      if (!parsedDate) {
        if (!rawOriginal) rawOriginal = seg;
        continue;
      }

      if (label.startsWith('факт') || label.startsWith('выполнено')) {
        actualDate = parsedDate;
      } else if (label.startsWith('план')) {
        planDate = parsedDate;
        if (trailingMeta.includes('ручн')) {
          planExplicitManual = true;
        } else if (
          trailingMeta.includes('авто') ||
          KNOWN_STATUS_MARKERS.some((statusWord) => trailingMeta.includes(statusWord))
        ) {
          planHasAutoOrStatusTag = true;
        }
      }
    }

    let manualNextDate: string | undefined;
    if (planDate) {
      // Set manualNextDate when explicitly marked manual, when user wrote bare "План: DATE",
      // or when no actualDate is present (an auto-calculated plan cannot exist without actualDate).
      if (planExplicitManual || !planHasAutoOrStatusTag || !actualDate) {
        manualNextDate = planDate;
      }
    }

    const out: DeadlineCellValue = {};
    if (actualDate) out.actualDate = actualDate;
    if (manualNextDate) out.manualNextDate = manualNextDate;
    if (note) out.note = note;
    if (rawOriginal) out._rawOriginal = rawOriginal;

    if (hasAnyDeadlineCellContent(out)) {
      return out;
    }
    return { _rawOriginal: trimmed };
  }

  const plainIso = parseFlexibleDateToIso(trimmed);
  if (plainIso) {
    return { actualDate: plainIso };
  }

  return { _rawOriginal: trimmed };
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

export function resolveSafeRowIdentifier(
  row: Row,
  tab?: Tab,
  fallbackRowNumber?: number
): string {
  const nonDeadlineCols = (tab?.columns || []).filter((c) => c.type !== 'deadline_control');
  const semanticCol = nonDeadlineCols.find((c) =>
    /^(фио|ф\.и\.о|работник|сотрудник|пострадавш|должност|наименован)/i.test(c.name.trim())
  );

  const candidates = [
    row.emp_fio,
    row.pos_title,
    row.fac_name,
    row.med_worker,
    row.siz_item,
    row.inst_worker,
    row.inc_victim,
    semanticCol ? row[semanticCol.id] : undefined,
    nonDeadlineCols[0] ? row[nonDeadlineCols[0].id] : undefined,
    nonDeadlineCols[1] ? row[nonDeadlineCols[1].id] : undefined
  ];

  for (const val of candidates) {
    if (val === null || val === undefined) continue;
    if (typeof val === 'object') continue;
    const trimmed = String(val).trim();
    if (trimmed) return trimmed;
  }

  return fallbackRowNumber ? `Строка #${fallbackRowNumber} (${row.id})` : String(row.id || 'Без ID');
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
        const rowIdentifier = resolveSafeRowIdentifier(row, tab, rowIdx + 1);
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
    if (
      filter.rowIdentifier &&
      filter.rowIdentifier !== 'all' &&
      ev.rowIdentifier !== filter.rowIdentifier
    ) {
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

function getFilledDeadlineFields(norm: DeadlineCellValue): DeadlineLostFieldKey[] {
  const fields: DeadlineLostFieldKey[] = [];
  if (norm.actualDate) fields.push('actualDate');
  if (norm.manualNextDate) fields.push('manualNextDate');
  if (norm.note) fields.push('note');
  if (norm._rawOriginal) fields.push('_rawOriginal');
  return fields;
}

function getLostDeadlineFields(
  filledFields: ReadonlyArray<DeadlineLostFieldKey>,
  preservedFields: ReadonlyArray<DeadlineLostFieldKey>
): DeadlineLostFieldKey[] {
  return filledFields.filter((f) => !preservedFields.includes(f));
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
  lostFields: DeadlineLostFieldKey[];
} {
  const norm = normalizeDeadlineCellValue(raw);
  const filledFields = getFilledDeadlineFields(norm);
  const hasContent = filledFields.length > 0;
  if (!hasContent) {
    return {
      value: targetType === 'boolean' ? false : '',
      hasContent: false,
      lostFields: []
    };
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
            : 'Отсутствует плановая дата (возможно, сохранён только текст, примечание или факт для разового срока)',
        lostFields: filledFields
      };
    }
    const preserved: DeadlineLostFieldKey[] =
      extractMode === 'actualDate'
        ? ['actualDate']
        : ev.nextDateSource === 'manual'
          ? ['manualNextDate']
          : [];
    const lostFields = getLostDeadlineFields(filledFields, preserved);
    return {
      value: picked,
      hasContent: true,
      partialLoss: lostFields.length > 0,
      lostFields
    };
  }

  if (targetType === 'text') {
    if (extractMode === 'rawOriginal') {
      if (norm._rawOriginal) {
        const lostFields = getLostDeadlineFields(filledFields, ['_rawOriginal']);
        return {
          value: norm._rawOriginal,
          hasContent: true,
          partialLoss: lostFields.length > 0,
          lostFields
        };
      }
      const fallbackIso = ev.effectiveNextDate || ev.actualDate;
      if (fallbackIso) {
        const preserved: DeadlineLostFieldKey[] =
          norm.manualNextDate && fallbackIso === norm.manualNextDate
            ? ['manualNextDate']
            : norm.actualDate && fallbackIso === norm.actualDate
              ? ['actualDate']
              : [];
        const lostFields = getLostDeadlineFields(filledFields, preserved);
        return {
          value: formatIsoToDisplay(fallbackIso),
          hasContent: true,
          partialLoss: lostFields.length > 0,
          lostFields
        };
      }
      if (norm.note) {
        const lostFields = getLostDeadlineFields(filledFields, ['note']);
        return {
          value: norm.note,
          hasContent: true,
          partialLoss: lostFields.length > 0,
          lostFields
        };
      }
      return {
        value: '',
        hasContent: true,
        lostReason: 'Отсутствует исходный текст',
        lostFields: filledFields
      };
    }

    if (extractMode === 'actualDate') {
      const val = formatIsoToDisplay(ev.actualDate);
      if (!val) {
        return {
          value: '',
          hasContent: true,
          lostReason: 'Отсутствует фактическая дата',
          lostFields: filledFields
        };
      }
      const lostFields = getLostDeadlineFields(filledFields, ['actualDate']);
      return {
        value: val,
        hasContent: true,
        partialLoss: lostFields.length > 0,
        lostFields
      };
    }

    if (extractMode === 'effectiveNextDate') {
      const val = formatIsoToDisplay(ev.effectiveNextDate);
      if (!val) {
        return {
          value: '',
          hasContent: true,
          lostReason: 'Отсутствует плановая дата',
          lostFields: filledFields
        };
      }
      const preserved: DeadlineLostFieldKey[] =
        ev.nextDateSource === 'manual' ? ['manualNextDate'] : [];
      const lostFields = getLostDeadlineFields(filledFields, preserved);
      return {
        value: val,
        hasContent: true,
        partialLoss: lostFields.length > 0,
        lostFields
      };
    }

    // 'summary'
    const summaryText = formatDeadlineCellDisplay(norm, config, { ...options, mode: 'summary' });
    if (!summaryText) {
      return {
        value: '',
        hasContent: true,
        lostReason: 'Примечание не входит в краткую сводку (План / Статус / Факт)',
        lostFields: filledFields
      };
    }
    const preserved: DeadlineLostFieldKey[] = [];
    if (ev.status === 'completed' && formatIsoToDisplay(ev.actualDate)) {
      preserved.push('actualDate');
    } else if (ev.effectiveNextDate || ev.actualDate) {
      if (ev.nextDateSource === 'manual' && norm.manualNextDate) {
        preserved.push('manualNextDate');
      }
      if (norm.actualDate) {
        preserved.push('actualDate');
      }
    } else if (norm._rawOriginal) {
      preserved.push('_rawOriginal');
    }
    const lostFields = getLostDeadlineFields(filledFields, preserved);
    return {
      value: summaryText,
      hasContent: true,
      partialLoss: lostFields.length > 0,
      lostFields
    };
  }

  if (targetType === 'number') {
    const candidate = norm._rawOriginal?.trim();
    if (candidate && /^-?\d+(?:[.,]\d+)?$/.test(candidate)) {
      const lostFields = getLostDeadlineFields(filledFields, ['_rawOriginal']);
      return {
        value: Number(candidate.replace(',', '.')),
        hasContent: true,
        partialLoss: lostFields.length > 0,
        lostFields
      };
    }
    return {
      value: '',
      hasContent: true,
      lostReason: 'Значение контроля сроков не является числом',
      lostFields: filledFields
    };
  }

  if (targetType === 'boolean') {
    const rawLower = (norm._rawOriginal || '').trim().toLowerCase();
    if (['да', 'true', '1', 'yes'].includes(rawLower)) {
      const lostFields = getLostDeadlineFields(filledFields, ['_rawOriginal']);
      return {
        value: true,
        hasContent: true,
        partialLoss: lostFields.length > 0,
        lostFields
      };
    }
    if (['нет', 'false', '0', 'no'].includes(rawLower)) {
      const lostFields = getLostDeadlineFields(filledFields, ['_rawOriginal']);
      return {
        value: false,
        hasContent: true,
        partialLoss: lostFields.length > 0,
        lostFields
      };
    }
    return {
      value: false,
      hasContent: true,
      lostReason: 'Даты и статусы нельзя однозначно свести к «Да / Нет»',
      lostFields: filledFields
    };
  }

  if (targetType === 'select' || targetType === 'link') {
    if (norm._rawOriginal) {
      const lostFields = getLostDeadlineFields(filledFields, ['_rawOriginal']);
      return {
        value: norm._rawOriginal,
        hasContent: true,
        partialLoss: lostFields.length > 0,
        lostFields
      };
    }
    return {
      value: '',
      hasContent: true,
      lostReason: `Сложные данные контроля сроков несовместимы с типом «${targetType}»`,
      lostFields: filledFields
    };
  }

  return {
    value: '',
    hasContent: true,
    lostReason: `Несовместимый целевой тип «${targetType}»`,
    lostFields: filledFields
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
  const lostFieldsSummary: Record<DeadlineLostFieldKey, number> = {
    actualDate: 0,
    manualNextDate: 0,
    note: 0,
    _rawOriginal: 0
  };
  const samplesOfLostData: Array<{ rowId: string; summary: string; reason: string }> = [];

  for (const row of rows) {
    const res = extractValueFromDeadlineCell(row[columnId], targetType, extractMode, config, options);
    if (!res.hasContent) {
      emptyCount += 1;
      continue;
    }
    for (const field of res.lostFields) {
      lostFieldsSummary[field] += 1;
    }
    if (res.lostReason) {
      lostDataCount += 1;
      if (samplesOfLostData.length < 10) {
        const norm = normalizeDeadlineCellValue(row[columnId]);
        const summaryDisplay =
          formatDeadlineCellDisplay(row[columnId], config, { ...options, mode: 'summary' }) ||
          (norm.note ? `Прим.: ${norm.note}` : '');
        samplesOfLostData.push({
          rowId: row.id,
          summary: summaryDisplay,
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
    lostFieldsSummary,
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
    selectOptions?: string[];
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
      const { deadlineConfig: _dropDeadline, options: _dropOpts, ...rest } = c;
      if (nextType === 'select') {
        const explicitOpts = Array.from(
          new Set((options?.selectOptions || []).map((s) => s.trim()).filter(Boolean))
        );
        const collectedOpts = Array.from(
          new Set(
            nextRows
              .map((r) => String(r[columnId] ?? '').trim())
              .filter(Boolean)
          )
        );
        const finalOpts =
          explicitOpts.length > 0
            ? explicitOpts
            : collectedOpts.length > 0
              ? collectedOpts
              : ['Значение 1', 'Значение 2'];
        return {
          ...rest,
          type: 'select',
          options: finalOpts
        };
      }
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

// ==================== T-47: Presets, Validation, & Safe Scalar Conversion ====================

export type DeadlinePeriodicityPresetId = '5y' | '3y' | '6m' | '3m' | '1m' | 'manual';

export interface DeadlinePeriodicityPreset {
  id: Exclude<DeadlinePeriodicityPresetId, 'manual'>;
  label: string;
  value: number;
  unit: DeadlinePeriodicityUnit;
}

export const DEADLINE_PERIODICITY_PRESETS: readonly DeadlinePeriodicityPreset[] = [
  { id: '5y', label: '1 раз в 5 лет', value: 5, unit: 'years' },
  { id: '3y', label: '1 раз в 3 года', value: 3, unit: 'years' },
  { id: '6m', label: '1 раз в полгода', value: 6, unit: 'months' },
  { id: '3m', label: '1 раз в квартал', value: 3, unit: 'months' },
  { id: '1m', label: 'Ежемесячно', value: 1, unit: 'months' }
] as const;

export interface DeadlineWarningPreset {
  value: number;
  label: string;
}

export const DEADLINE_WARNING_PRESETS: readonly DeadlineWarningPreset[] = [
  { value: 180, label: 'За полгода (180 дней)' },
  { value: 30, label: 'За 30 дней' },
  { value: 14, label: 'За 14 дней' },
  { value: 7, label: 'За 7 дней' },
  { value: 3, label: 'За 3 дня' }
] as const;

export const MAX_DEADLINE_PERIODICITY_VALUE = 36500;

export function detectPeriodicityPreset(
  periodicityValue: number,
  periodicityUnit: DeadlinePeriodicityUnit
): DeadlinePeriodicityPresetId {
  const match = DEADLINE_PERIODICITY_PRESETS.find(
    (p) => p.value === periodicityValue && p.unit === periodicityUnit
  );
  return match ? match.id : 'manual';
}

export function isStandardWarningPreset(warningValue: number): boolean {
  return DEADLINE_WARNING_PRESETS.some((p) => p.value === warningValue);
}

export function validateDeadlinePeriodicityInput(
  rawInput: string | number
): { ok: true; value: number } | { ok: false; error: string } {
  const str = String(rawInput ?? '').trim();
  if (!str) {
    return {
      ok: false,
      error: 'Укажите числовое значение периодичности (0 — разовое мероприятие).'
    };
  }
  if (!/^\d+$/.test(str)) {
    return {
      ok: false,
      error: 'Периодичность должна быть целым неотрицательным числом.'
    };
  }
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num < 0) {
    return {
      ok: false,
      error: 'Периодичность не может быть отрицательной.'
    };
  }
  if (num > MAX_DEADLINE_PERIODICITY_VALUE) {
    return {
      ok: false,
      error: `Максимально допустимое значение периодичности — ${MAX_DEADLINE_PERIODICITY_VALUE}.`
    };
  }
  return { ok: true, value: num };
}

export function formatDeadlineConfigShortSummary(
  rawConfig?: Partial<DeadlineColumnConfig> | null
): string {
  const cfg = normalizeDeadlineColumnConfig(rawConfig);
  const presetId = detectPeriodicityPreset(cfg.periodicityValue, cfg.periodicityUnit);
  const preset = DEADLINE_PERIODICITY_PRESETS.find((p) => p.id === presetId);

  let periodicityLabel: string;
  if (preset) {
    periodicityLabel = preset.label;
  } else if (cfg.periodicityValue === 0) {
    periodicityLabel = 'Разовое (0)';
  } else {
    const unitText =
      cfg.periodicityUnit === 'days'
        ? 'дн.'
        : cfg.periodicityUnit === 'years'
          ? 'г./лет'
          : 'мес.';
    periodicityLabel = `Раз в ${cfg.periodicityValue} ${unitText}`;
  }

  const warningUnit = cfg.warningDayType === 'working' ? 'раб. дн.' : 'кал. дн.';
  return `${periodicityLabel} · предупр. за ${cfg.warningValue} ${warningUnit}`;
}

export interface ScalarConversionPreview {
  totalRows: number;
  convertedCount: number;
  emptyCount: number;
  lostDataCount: number;
  samplesOfLostData: Array<{ rowId: string; rawValue: string; reason: string }>;
  sourceType: ColumnType;
  targetType: ColumnType;
}

function convertScalarCellValue(
  raw: unknown,
  sourceType: ColumnType,
  targetType: ColumnType
): {
  value: any;
  isEmpty: boolean;
  lostReason?: string;
} {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return {
      value: targetType === 'boolean' ? false : '',
      isEmpty: true
    };
  }

  if (targetType === 'text' || targetType === 'select' || targetType === 'link') {
    if (typeof raw === 'boolean') {
      return { value: raw ? 'Да' : 'Нет', isEmpty: false };
    }
    if (sourceType === 'date') {
      const iso = parseFlexibleDateToIso(raw);
      return { value: iso || String(raw).trim(), isEmpty: false };
    }
    return { value: String(raw).trim(), isEmpty: false };
  }

  if (targetType === 'date') {
    const parsed = parseFlexibleDateToIso(raw);
    if (parsed) {
      return { value: parsed, isEmpty: false };
    }
    return {
      value: '',
      isEmpty: false,
      lostReason: 'Значение не распознано как календарная дата (ожидается ГГГГ-ММ-ДД или ДД.ММ.ГГГГ)'
    };
  }

  if (targetType === 'number') {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return { value: raw, isEmpty: false };
    }
    if (typeof raw === 'boolean') {
      return { value: raw ? 1 : 0, isEmpty: false };
    }
    const normalized = String(raw).trim().replace(/\s+/g, '').replace(',', '.');
    if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
      return { value: Number(normalized), isEmpty: false };
    }
    return {
      value: '',
      isEmpty: false,
      lostReason: 'Значение не является числом'
    };
  }

  if (targetType === 'boolean') {
    if (typeof raw === 'boolean') {
      return { value: raw, isEmpty: false };
    }
    const lower = String(raw).trim().toLowerCase();
    if (['да', 'true', '1', 'yes', '+'].includes(lower)) {
      return { value: true, isEmpty: false };
    }
    if (['нет', 'false', '0', 'no', '-'].includes(lower)) {
      return { value: false, isEmpty: false };
    }
    return {
      value: false,
      isEmpty: false,
      lostReason: 'Текст нельзя однозначно преобразовать в «Да / Нет»'
    };
  }

  return { value: String(raw).trim(), isEmpty: false };
}

export function previewScalarConversion(
  rows: Row[],
  columnId: string,
  sourceType: ColumnType,
  targetType: ColumnType
): ScalarConversionPreview {
  let convertedCount = 0;
  let emptyCount = 0;
  let lostDataCount = 0;
  const samplesOfLostData: Array<{ rowId: string; rawValue: string; reason: string }> = [];

  for (const row of rows) {
    const res = convertScalarCellValue(row[columnId], sourceType, targetType);
    if (res.isEmpty) {
      emptyCount += 1;
    } else if (res.lostReason) {
      lostDataCount += 1;
      if (samplesOfLostData.length < 10) {
        samplesOfLostData.push({
          rowId: row.id,
          rawValue: String(row[columnId] ?? '').trim(),
          reason: res.lostReason
        });
      }
    } else {
      convertedCount += 1;
    }
  }

  return {
    totalRows: rows.length,
    convertedCount,
    emptyCount,
    lostDataCount,
    samplesOfLostData,
    sourceType,
    targetType
  };
}

export function applyScalarColumnTypeConversion(
  tab: Tab,
  columnId: string,
  targetType: ColumnType,
  options?: { selectOptions?: string[] }
): {
  tab: Tab;
  preview: ScalarConversionPreview;
} {
  const col = tab.columns.find((c) => c.id === columnId);
  if (!col) {
    throw new Error(`Столбец ${columnId} не найден во вкладке «${tab.name}».`);
  }
  if (col.type === 'relation' || targetType === 'relation') {
    throw new Error(
      'Смена типа столбца со связью (relation) заблокирована. Сначала открепите связь в структуре таблицы.'
    );
  }
  if (col.type === 'deadline_control' || targetType === 'deadline_control') {
    throw new Error('Для конвертации контроля сроков используйте applyColumnTypeConversion.');
  }

  const preview = previewScalarConversion(tab.rows, columnId, col.type, targetType);
  const nextRows = tab.rows.map((row) => ({
    ...row,
    [columnId]: convertScalarCellValue(row[columnId], col.type, targetType).value
  }));

  const nextColumns: Column[] = tab.columns.map((c) => {
    if (c.id !== columnId) return c;
    const { options: _dropOpts, deadlineConfig: _dropDeadline, ...rest } = c;
    if (targetType === 'select') {
      const explicit = (options?.selectOptions || []).map((s) => s.trim()).filter(Boolean);
      const collected = Array.from(
        new Set(nextRows.map((r) => String(r[columnId] ?? '').trim()).filter(Boolean))
      );
      const finalOpts = explicit.length > 0 ? explicit : collected;
      return {
        ...rest,
        type: 'select',
        options: finalOpts.length > 0 ? finalOpts : ['Значение 1', 'Значение 2']
      };
    }
    return {
      ...rest,
      type: targetType
    };
  });

  return {
    tab: { ...tab, columns: nextColumns, rows: nextRows },
    preview
  };
}

// ==================== T-48: System Tab Aggregation, Filters & Navigation ====================

export interface DeadlineEventsSummary {
  total: number;
  overdue: number;
  dueSoon: number;
  scheduled: number;
  completed: number;
  missingData: number;
  actionable: number;
  closedOrMissing: number;
}

export function summarizeDeadlineEvents(events: DeadlineEventItem[]): DeadlineEventsSummary {
  let overdue = 0;
  let dueSoon = 0;
  let scheduled = 0;
  let completed = 0;
  let missingData = 0;

  for (const ev of events) {
    switch (ev.evaluation.status) {
      case 'overdue':
        overdue += 1;
        break;
      case 'due_soon':
        dueSoon += 1;
        break;
      case 'scheduled':
        scheduled += 1;
        break;
      case 'completed':
        completed += 1;
        break;
      case 'missing_data':
        missingData += 1;
        break;
    }
  }

  return {
    total: events.length,
    overdue,
    dueSoon,
    scheduled,
    completed,
    missingData,
    actionable: overdue + dueSoon,
    closedOrMissing: completed + missingData
  };
}

export interface DeadlineFilterOptions {
  entities: Array<{ id: string; name: string }>;
  tabs: Array<{ id: string; name: string }>;
  rowIdentifiers: string[];
}

export function getDeadlineFilterOptions(
  events: DeadlineEventItem[],
  filter?: Pick<DeadlineEventFilter, 'entityId' | 'tabId'>
): DeadlineFilterOptions {
  const entitiesMap = new Map<string, string>();
  const tabsMap = new Map<string, string>();
  const rowIdentifiersSet = new Set<string>();

  for (const ev of events) {
    if (!entitiesMap.has(ev.entityId)) {
      entitiesMap.set(ev.entityId, ev.entityName);
    }

    const matchesEntity =
      !filter?.entityId || filter.entityId === 'all' || ev.entityId === filter.entityId;
    if (matchesEntity && !tabsMap.has(ev.tabId)) {
      tabsMap.set(ev.tabId, ev.tabName);
    }

    const matchesTab = !filter?.tabId || filter.tabId === 'all' || ev.tabId === filter.tabId;
    if (matchesEntity && matchesTab && ev.rowIdentifier) {
      rowIdentifiersSet.add(ev.rowIdentifier);
    }
  }

  const entities = Array.from(entitiesMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const tabs = Array.from(tabsMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const rowIdentifiers = Array.from(rowIdentifiersSet).sort((a, b) => a.localeCompare(b, 'ru'));

  return { entities, tabs, rowIdentifiers };
}

export function hasAnyDeadlineControlColumn(dbState: DatabaseState): boolean {
  const entities = Array.isArray(dbState.entities) ? dbState.entities : [];
  for (const entity of entities) {
    const entityTabs =
      entity.id === dbState.activeEntityId && Array.isArray(dbState.tabs)
        ? dbState.tabs
        : Array.isArray(entity.tabs)
          ? entity.tabs
          : [];
    for (const tab of entityTabs) {
      if ((tab.columns || []).some((c) => c.type === 'deadline_control')) {
        return true;
      }
    }
  }
  return false;
}

export function formatDeadlinePeriodicityOnly(
  rawConfig?: Partial<DeadlineColumnConfig> | null
): string {
  const cfg = normalizeDeadlineColumnConfig(rawConfig);
  const presetId = detectPeriodicityPreset(cfg.periodicityValue, cfg.periodicityUnit);
  const preset = DEADLINE_PERIODICITY_PRESETS.find((p) => p.id === presetId);
  if (preset) return preset.label;
  if (cfg.periodicityValue === 0) return 'Разовое';
  const unitText =
    cfg.periodicityUnit === 'days'
      ? 'дн.'
      : cfg.periodicityUnit === 'years'
        ? 'г./лет'
        : 'мес.';
  return `Раз в ${cfg.periodicityValue} ${unitText}`;
}

export type DeadlineEventTargetResolution =
  | {
      ok: true;
      entity: LegalEntity;
      tab: Tab;
      row: Row;
      rowIndex: number;
      rowIdentifier: string;
      column?: Column;
    }
  | {
      ok: false;
      reason: 'entity_missing' | 'tab_missing' | 'row_missing' | 'column_missing';
      message: string;
    };

export function resolveDeadlineEventTarget(
  dbState: DatabaseState,
  target: {
    entityId: string;
    tabId: string;
    rowId: string;
    columnId?: string;
    tabName?: string;
    rowIdentifier?: string;
    columnName?: string;
  }
): DeadlineEventTargetResolution {
  const entity = (dbState.entities || []).find((e) => e.id === target.entityId);
  if (!entity) {
    return {
      ok: false,
      reason: 'entity_missing',
      message: 'Исходная организация больше не найдена в базе данных.'
    };
  }

  const entityTabs =
    entity.id === dbState.activeEntityId && Array.isArray(dbState.tabs)
      ? dbState.tabs
      : Array.isArray(entity.tabs)
        ? entity.tabs
        : [];

  const tab = entityTabs.find((t) => t.id === target.tabId);
  if (!tab) {
    return {
      ok: false,
      reason: 'tab_missing',
      message: `Исходная таблица «${target.tabName || target.tabId}» больше не существует.`
    };
  }

  const rowIndex = (tab.rows || []).findIndex((r) => r.id === target.rowId);
  if (rowIndex === -1) {
    return {
      ok: false,
      reason: 'row_missing',
      message: `Исходная запись «${target.rowIdentifier || target.rowId}» не найдена (возможно, строка была удалена).`
    };
  }

  const row = tab.rows[rowIndex];
  let column: Column | undefined;
  if (target.columnId) {
    column = (tab.columns || []).find(
      (c) => c.id === target.columnId && c.type === 'deadline_control'
    );
    if (!column) {
      return {
        ok: false,
        reason: 'column_missing',
        message: `Контролируемый столбец «${target.columnName || target.columnId}» был удалён или изменил тип.`
      };
    }
  }

  return {
    ok: true,
    entity,
    tab,
    row,
    rowIndex,
    rowIdentifier: resolveSafeRowIdentifier(row, tab, rowIndex + 1),
    column
  };
}

export function applyDeadlineCompletedTodayInState(
  state: DatabaseState,
  target: {
    entityId: string;
    tabId: string;
    rowId: string;
    columnId: string;
  },
  todayIso: string = getTodayIso()
): { state: DatabaseState; updated: boolean } {
  const validToday = parseFlexibleDateToIso(todayIso) || getTodayIso();
  const resolution = resolveDeadlineEventTarget(state, target);
  if (!resolution.ok) {
    return { state, updated: false };
  }

  const updateTabs = (tabs: Tab[]): Tab[] =>
    tabs.map((tab) => {
      if (tab.id !== target.tabId) return tab;
      return {
        ...tab,
        rows: tab.rows.map((row) => {
          if (row.id !== target.rowId) return row;
          return {
            ...row,
            [target.columnId]: markDeadlineCompletedToday(row[target.columnId], validToday)
          };
        })
      };
    });

  if (target.entityId === state.activeEntityId) {
    const nextTabs = updateTabs(state.tabs);
    return {
      state: {
        ...state,
        tabs: nextTabs
      },
      updated: true
    };
  }

  const nextEntities = (state.entities || []).map((ent) =>
    ent.id === target.entityId
      ? {
          ...ent,
          tabs: updateTabs(ent.tabs || []),
          updatedAt: new Date().toISOString()
        }
      : ent
  );

  return {
    state: {
      ...state,
      entities: nextEntities
    },
    updated: true
  };
}

// ==================== T-49: Notification Popover, Session Deduplication & Snooze ====================

export const MAX_POPOVER_DEADLINE_NOTIFICATIONS = 10;

export interface PopoverDeadlineNotificationsResult {
  items: DeadlineEventItem[];
  totalActiveCount: number;
  snoozedAlertCount: number;
  overdueAlertCount: number;
  dueSoonAlertCount: number;
}

function compareUrgentDeadlineEvents(a: DeadlineEventItem, b: DeadlineEventItem): number {
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

  return a.rowIdentifier.localeCompare(b.rowIdentifier, 'ru');
}

/**
 * Selects up to `limit` (default 10) most urgent active (`overdue` / `due_soon`, non-snoozed)
 * notifications while also reporting total active and snoozed alert counts.
 */
export function selectTopPopoverNotifications(
  events: DeadlineEventItem[],
  deadlineSettings?: DeadlineAppSettings | null,
  options?: { todayIso?: string; limit?: number }
): PopoverDeadlineNotificationsResult {
  const validToday =
    (options?.todayIso ? parseFlexibleDateToIso(options.todayIso) : undefined) || getTodayIso();
  const limit = Math.max(1, options?.limit ?? MAX_POPOVER_DEADLINE_NOTIFICATIONS);

  const allAlerts = events.filter(
    (ev) => ev.evaluation.status === 'overdue' || ev.evaluation.status === 'due_soon'
  );
  const activeAlerts = getActiveAlertDeadlineEvents(allAlerts, deadlineSettings, validToday).sort(
    compareUrgentDeadlineEvents
  );

  let overdueAlertCount = 0;
  let dueSoonAlertCount = 0;
  for (const ev of allAlerts) {
    if (ev.evaluation.status === 'overdue') overdueAlertCount += 1;
    else if (ev.evaluation.status === 'due_soon') dueSoonAlertCount += 1;
  }

  return {
    items: activeAlerts.slice(0, limit),
    totalActiveCount: activeAlerts.length,
    snoozedAlertCount: Math.max(0, allAlerts.length - activeAlerts.length),
    overdueAlertCount,
    dueSoonAlertCount
  };
}

export interface SessionToastEvaluation {
  shouldShowToast: boolean;
  newKeys: string[];
  unseenEvents: DeadlineEventItem[];
  overdueCount: number;
  dueSoonCount: number;
  variant: 'error' | 'warning';
  message: string;
}

/**
 * Evaluates which active (`overdue` / `due_soon`, non-snoozed) events have not yet
 * been shown in the current session (`shownKeys`). Produces at most one aggregated toast payload.
 */
export function evaluateSessionToastNotifications(params: {
  events: DeadlineEventItem[];
  shownKeys: ReadonlySet<string>;
  deadlineSettings?: DeadlineAppSettings | null;
  todayIso?: string;
}): SessionToastEvaluation {
  const { events, shownKeys, deadlineSettings, todayIso } = params;

  if (deadlineSettings?.notificationsEnabled === false) {
    return {
      shouldShowToast: false,
      newKeys: [],
      unseenEvents: [],
      overdueCount: 0,
      dueSoonCount: 0,
      variant: 'warning',
      message: ''
    };
  }

  const validToday = (todayIso ? parseFlexibleDateToIso(todayIso) : undefined) || getTodayIso();
  const activeAlerts = getActiveAlertDeadlineEvents(events, deadlineSettings, validToday).sort(
    compareUrgentDeadlineEvents
  );
  const unseenEvents = activeAlerts.filter((ev) => !shownKeys.has(ev.notificationKey));

  if (unseenEvents.length === 0) {
    return {
      shouldShowToast: false,
      newKeys: [],
      unseenEvents: [],
      overdueCount: 0,
      dueSoonCount: 0,
      variant: 'warning',
      message: ''
    };
  }

  const overdueCount = unseenEvents.filter((ev) => ev.evaluation.status === 'overdue').length;
  const dueSoonCount = unseenEvents.filter((ev) => ev.evaluation.status === 'due_soon').length;
  const variant: 'error' | 'warning' = overdueCount > 0 ? 'error' : 'warning';

  let message: string;
  if (unseenEvents.length === 1) {
    const single = unseenEvents[0];
    const prefix = single.evaluation.status === 'overdue' ? 'Просрочен срок' : 'Приближается срок';
    message = `${prefix}: «${single.columnName}» (${single.rowIdentifier}, ${single.entityName}).`;
  } else {
    const summaryParts: string[] = [];
    if (overdueCount > 0) summaryParts.push(`просрочено: ${overdueCount}`);
    if (dueSoonCount > 0) summaryParts.push(`скоро: ${dueSoonCount}`);
    message = `Контроль сроков — ${summaryParts.join(', ')} (всего ${unseenEvents.length}).`;
  }

  return {
    shouldShowToast: true,
    newKeys: unseenEvents.map((ev) => ev.notificationKey),
    unseenEvents,
    overdueCount,
    dueSoonCount,
    variant,
    message
  };
}

/**
 * Pure transition that snoozes a single notificationKey until the next calendar day
 * (`today + 1`), preserving holidays, notificationsEnabled, and other active snoozes.
 */
export function applyDeadlineSnoozeInState(
  state: DatabaseState,
  notificationKey: string,
  todayIso: string = getTodayIso()
): DatabaseState {
  const cleanKey = String(notificationKey || '').trim();
  if (!cleanKey) return state;

  const validToday = parseFlexibleDateToIso(todayIso) || getTodayIso();
  const prevDeadlineSettings = state.settings?.deadlineSettings;
  const nextSnoozedMap = createSnoozeMapForNotification(
    prevDeadlineSettings?.snoozedNotificationKeys,
    cleanKey,
    validToday
  );

  return {
    ...state,
    settings: {
      ...state.settings,
      deadlineSettings: {
        holidays: normalizeHolidaysList(prevDeadlineSettings?.holidays),
        snoozedNotificationKeys: nextSnoozedMap,
        notificationsEnabled: prevDeadlineSettings?.notificationsEnabled === false ? false : true
      }
    }
  };
}

/**
 * Pure transition that updates `settings.deadlineSettings.notificationsEnabled`,
 * preserving holidays and snoozedNotificationKeys.
 */
export function applyDeadlineNotificationsEnabledInState(
  state: DatabaseState,
  enabled: boolean,
  todayIso: string = getTodayIso()
): DatabaseState {
  const validToday = parseFlexibleDateToIso(todayIso) || getTodayIso();
  const prevDeadlineSettings = state.settings?.deadlineSettings;

  return {
    ...state,
    settings: {
      ...state.settings,
      deadlineSettings: {
        holidays: normalizeHolidaysList(prevDeadlineSettings?.holidays),
        snoozedNotificationKeys: normalizeSnoozedNotificationKeys(
          prevDeadlineSettings?.snoozedNotificationKeys,
          validToday
        ),
        notificationsEnabled: enabled
      }
    }
  };
}


