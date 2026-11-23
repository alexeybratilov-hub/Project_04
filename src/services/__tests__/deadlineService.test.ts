import { describe, it, expect } from 'vitest';
import {
  addCalendarDays,
  addCalendarMonths,
  addCalendarYears,
  applyActualDateUpdate,
  applyColumnTypeConversion,
  applyScalarColumnTypeConversion,
  buildDeadlineNotificationKey,
  calculateNextDate,
  collectDeadlineEvents,
  convertRowsFromDeadline,
  convertRowsToDeadline,
  createSnoozeMapForNotification,
  DEADLINE_PERIODICITY_PRESETS,
  DEADLINE_WARNING_PRESETS,
  detectPeriodicityPreset,
  diffCalendarDays,
  diffWorkingDays,
  evaluateDeadlineCell,
  filterDeadlineEvents,
  formatDeadlineCellDisplay,
  formatDeadlineConfigShortSummary,
  getActiveAlertDeadlineEvents,
  isNotificationSnoozed,
  isStandardWarningPreset,
  markDeadlineCompletedToday,
  normalizeDeadlineAppSettings,
  normalizeDeadlineCellValue,
  normalizeDeadlineColumnConfig,
  parseFlexibleDateToIso,
  previewConversionFromDeadline,
  previewConversionToDeadline,
  previewScalarConversion,
  updateDeadlineCellValue,
  validateDeadlinePeriodicityInput
} from '../deadlineService';
import { INITIAL_DATABASE_STATE } from '../../data/initialDatabase';
import { DatabaseState, Tab } from '../../types/database';

describe('T-45: deadlineService core calculations, status machine, and conversions', () => {
  describe('calendar parsing and Gregorian arithmetic (month-ends & leap years)', () => {
    it('parses YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY, Excel serials and rejects invalid calendar dates', () => {
      expect(parseFlexibleDateToIso('2026-03-15')).toBe('2026-03-15');
      expect(parseFlexibleDateToIso('15.03.2026')).toBe('2026-03-15');
      expect(parseFlexibleDateToIso('5/3/2026')).toBe('2026-03-05');
      expect(parseFlexibleDateToIso('2024-02-29')).toBe('2024-02-29');
      // Excel serial 46082 => 2026-03-01
      expect(parseFlexibleDateToIso(46082)).toBe('2026-03-01');

      // Invalid dates must be rejected
      expect(parseFlexibleDateToIso('31.02.2026')).toBeUndefined();
      expect(parseFlexibleDateToIso('29.02.2025')).toBeUndefined();
      expect(parseFlexibleDateToIso('2026-04-31')).toBeUndefined();
      expect(parseFlexibleDateToIso('2026-13-01')).toBeUndefined();
      expect(parseFlexibleDateToIso(60)).toBeUndefined();
      expect(parseFlexibleDateToIso('бессрочно')).toBeUndefined();
      expect(parseFlexibleDateToIso('')).toBeUndefined();
    });

    it('handles month-ends and Feb 29 correctly for days, months, and years', () => {
      expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
      expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-02-29');
      expect(addCalendarMonths('2026-03-31', 3)).toBe('2026-06-30');
      expect(addCalendarMonths('2026-11-15', 3)).toBe('2027-02-15');

      expect(addCalendarYears('2024-02-29', 1)).toBe('2025-02-28');
      expect(addCalendarYears('2024-02-29', 4)).toBe('2028-02-29');

      expect(addCalendarDays('2024-02-28', 1)).toBe('2024-02-29');
      expect(addCalendarDays('2024-02-29', 365)).toBe('2025-02-28');

      expect(
        calculateNextDate('2026-01-31', {
          periodicityValue: 30,
          periodicityUnit: 'days',
          warningValue: 7,
          warningDayType: 'calendar'
        })
      ).toBe('2026-03-02');

      expect(
        calculateNextDate('2026-01-31', {
          periodicityValue: 0,
          periodicityUnit: 'months',
          warningValue: 14,
          warningDayType: 'calendar'
        })
      ).toBeUndefined();
    });
  });

  describe('calendar vs working days and custom holidays', () => {
    it('excludes weekends and custom holidays in working day calculations while keeping nextDate independent of warningValue', () => {
      // 2026-11-16 is Monday, 2026-11-23 is next Monday
      // Calendar diff: 7 days; Working diff without holidays: Tue,Wed,Thu,Fri,Mon = 5 working days
      expect(diffCalendarDays('2026-11-16', '2026-11-23')).toBe(7);
      expect(diffWorkingDays('2026-11-16', '2026-11-23')).toBe(5);

      // Adding custom holiday on Wednesday 2026-11-18 reduces working days to 4
      const holidays = ['2026-11-18'];
      expect(diffWorkingDays('2026-11-16', '2026-11-23', holidays)).toBe(4);

      // Same date => 0
      expect(diffWorkingDays('2026-11-16', '2026-11-16', holidays)).toBe(0);

      // warningValue does NOT shift calculatedNextDate
      const evScheduled = evaluateDeadlineCell(
        { actualDate: '2025-11-23' },
        {
          periodicityValue: 12,
          periodicityUnit: 'months',
          warningValue: 4,
          warningDayType: 'working'
        },
        { todayIso: '2026-11-16' } // 5 working days left > 4 => scheduled
      );
      expect(evScheduled.calculatedNextDate).toBe('2026-11-23');
      expect(evScheduled.effectiveNextDate).toBe('2026-11-23');
      expect(evScheduled.workingDaysRemaining).toBe(5);
      expect(evScheduled.status).toBe('scheduled');

      // Adding holiday 2026-11-18 instantly shifts status from scheduled to due_soon (4 <= 4) without editing cell
      const evDueSoon = evaluateDeadlineCell(
        { actualDate: '2025-11-23' },
        {
          periodicityValue: 12,
          periodicityUnit: 'months',
          warningValue: 4,
          warningDayType: 'working'
        },
        { todayIso: '2026-11-16', holidays: ['2026-11-18'] }
      );
      expect(evDueSoon.workingDaysRemaining).toBe(4);
      expect(evDueSoon.status).toBe('due_soon');
    });

    it('marks Friday due date as OVERDUE on Saturday even when working days diff is 0', () => {
      // 2026-11-20 is Friday, 2026-11-21 is Saturday, 2026-11-23 is Monday
      const config = {
        periodicityValue: 12,
        periodicityUnit: 'months' as const,
        warningValue: 5,
        warningDayType: 'working' as const
      };
      const cell = { manualNextDate: '2026-11-20' };

      const onSaturday = evaluateDeadlineCell(cell, config, { todayIso: '2026-11-21' });
      expect(onSaturday.calendarDaysRemaining).toBe(-1);
      expect(onSaturday.workingDaysRemaining).toBe(0);
      expect(onSaturday.status).toBe('overdue');
      expect(onSaturday.statusLabel).toBe('Просрочено');

      const onMonday = evaluateDeadlineCell(cell, config, { todayIso: '2026-11-23' });
      expect(onMonday.calendarDaysRemaining).toBe(-3);
      expect(onMonday.workingDaysRemaining).toBe(-1);
      expect(onMonday.status).toBe('overdue');
    });
  });

  describe('manualNextDate priority, reset on new actualDate, and all 5 statuses & transitions', () => {
    it('gives priority to manualNextDate while keeping calculatedNextDate, and resets manualNextDate on new actualDate', () => {
      const config = {
        periodicityValue: 12,
        periodicityUnit: 'months' as const,
        warningValue: 14,
        warningDayType: 'calendar' as const
      };

      const withManual = evaluateDeadlineCell(
        { actualDate: '2025-05-10', manualNextDate: '2026-07-01', note: 'Перенос' },
        config,
        { todayIso: '2026-05-15' }
      );
      expect(withManual.calculatedNextDate).toBe('2026-05-10');
      expect(withManual.effectiveNextDate).toBe('2026-07-01');
      expect(withManual.nextDateSource).toBe('manual');
      expect(withManual.lastExecution).toBe('performed');
      expect(withManual.status).toBe('scheduled');

      // Entering new actualDate via markDeadlineCompletedToday resets stale manualNextDate
      const afterCompleteToday = markDeadlineCompletedToday(withManual.value, '2026-05-15');
      expect(afterCompleteToday.actualDate).toBe('2026-05-15');
      expect(afterCompleteToday.manualNextDate).toBeUndefined();
      expect(afterCompleteToday.note).toBe('Перенос');

      const evalAfter = evaluateDeadlineCell(afterCompleteToday, config, { todayIso: '2026-05-15' });
      expect(evalAfter.calculatedNextDate).toBe('2027-05-15');
      expect(evalAfter.effectiveNextDate).toBe('2027-05-15');
      expect(evalAfter.nextDateSource).toBe('auto');
      expect(evalAfter.status).toBe('scheduled');

      // updateDeadlineCellValue resets manualNextDate when actualDate changes, but preserves manualNextDate when only note changes
      const noteOnly = updateDeadlineCellValue(withManual.value, { note: 'Обновлено примечание' });
      expect(noteOnly.manualNextDate).toBe('2026-07-01');

      const actualChanged = updateDeadlineCellValue(withManual.value, { actualDate: '2026-06-01' });
      expect(actualChanged.actualDate).toBe('2026-06-01');
      expect(actualChanged.manualNextDate).toBeUndefined();

      // applyActualDateUpdate can set explicit new manualNextDate in the same action if requested
      const explicitManual = applyActualDateUpdate(withManual.value, '2026-06-01', {
        explicitManualNextDate: '2026-12-31'
      });
      expect(explicitManual.actualDate).toBe('2026-06-01');
      expect(explicitManual.manualNextDate).toBe('2026-12-31');
    });

    it('supports all 5 statuses and separates lastExecution from current control status', () => {
      const recurringCfg = {
        periodicityValue: 1,
        periodicityUnit: 'years' as const,
        warningValue: 14,
        warningDayType: 'calendar' as const
      };
      const oneTimeCfg = {
        periodicityValue: 0,
        periodicityUnit: 'months' as const,
        warningValue: 14,
        warningDayType: 'calendar' as const
      };

      // 1. missing_data (empty & _rawOriginal only)
      const missingEmpty = evaluateDeadlineCell({}, recurringCfg, { todayIso: '2026-05-01' });
      expect(missingEmpty.status).toBe('missing_data');
      expect(missingEmpty.lastExecution).toBe('none');

      const missingRaw = evaluateDeadlineCell(
        { _rawOriginal: 'по графику' },
        recurringCfg,
        { todayIso: '2026-05-01' }
      );
      expect(missingRaw.status).toBe('missing_data');

      // 2. completed (ONLY one-time event with actualDate and no manualNextDate)
      const oneTimeCompleted = evaluateDeadlineCell(
        { actualDate: '2026-04-01' },
        oneTimeCfg,
        { todayIso: '2026-05-01' }
      );
      expect(oneTimeCompleted.status).toBe('completed');
      expect(oneTimeCompleted.lastExecution).toBe('performed');
      expect(oneTimeCompleted.effectiveNextDate).toBeUndefined();

      // Transition: completed one-time gets a manualNextDate => becomes scheduled / due_soon / overdue
      const oneTimeReopened = updateDeadlineCellValue(oneTimeCompleted.value, {
        manualNextDate: '2026-05-10'
      });
      const evalReopened = evaluateDeadlineCell(oneTimeReopened, oneTimeCfg, {
        todayIso: '2026-05-01'
      });
      expect(evalReopened.status).toBe('due_soon'); // 9 days <= 14

      // 3. scheduled (> warningValue)
      const scheduled = evaluateDeadlineCell(
        { actualDate: '2026-01-01' },
        recurringCfg,
        { todayIso: '2026-05-01' }
      );
      expect(scheduled.status).toBe('scheduled');
      expect(scheduled.lastExecution).toBe('performed');

      // 4. due_soon (0 <= days <= warningValue)
      const dueSoon = evaluateDeadlineCell(
        { actualDate: '2025-05-10' },
        recurringCfg,
        { todayIso: '2026-05-01' }
      );
      expect(dueSoon.status).toBe('due_soon');
      expect(dueSoon.calendarDaysRemaining).toBe(9);

      // Exact due day => due_soon (0 <= 14)
      const dueToday = evaluateDeadlineCell(
        { actualDate: '2025-05-01' },
        recurringCfg,
        { todayIso: '2026-05-01' }
      );
      expect(dueToday.status).toBe('due_soon');
      expect(dueToday.calendarDaysRemaining).toBe(0);

      // 5. overdue (effectiveNextDate < today)
      const overdue = evaluateDeadlineCell(
        { actualDate: '2025-04-30' },
        recurringCfg,
        { todayIso: '2026-05-01' }
      );
      expect(overdue.status).toBe('overdue');
      expect(overdue.calendarDaysRemaining).toBe(-1);

      // Clearing dates => back to missing_data
      const cleared = updateDeadlineCellValue(overdue.value, {
        actualDate: null,
        manualNextDate: null
      });
      expect(evaluateDeadlineCell(cleared, recurringCfg, { todayIso: '2026-05-01' }).status).toBe(
        'missing_data'
      );
    });
  });

  describe('normalization, legacy value compatibility, and display formatting', () => {
    it('normalizes legacy strings, objects, and strips disallowed completed/completedAt fields without losing text', () => {
      expect(normalizeDeadlineCellValue(null)).toEqual({});
      expect(normalizeDeadlineCellValue('')).toEqual({});
      expect(normalizeDeadlineCellValue('15.03.2026')).toEqual({ actualDate: '2026-03-15' });
      expect(normalizeDeadlineCellValue('бессрочно')).toEqual({ _rawOriginal: 'бессрочно' });

      const stripped = normalizeDeadlineCellValue({
        actualDate: '2026-03-15',
        manualNextDate: 'invalid-date',
        note: '  Примечание  ',
        completed: true,
        completedAt: '2026-03-15'
      } as any);
      expect(stripped).toEqual({
        actualDate: '2026-03-15',
        note: 'Примечание',
        _rawOriginal: 'invalid-date'
      });
      expect('completed' in stripped).toBe(false);
      expect('completedAt' in stripped).toBe(false);

      expect(normalizeDeadlineColumnConfig({ periodicityValue: 0, warningDayType: 'working' })).toEqual({
        periodicityValue: 0,
        periodicityUnit: 'months',
        warningValue: 14,
        warningDayType: 'working'
      });

      const normSettings = normalizeDeadlineAppSettings(
        {
          holidays: ['10.05.2026', '2026-05-01', '2026-05-01', 'bad-date'],
          snoozedNotificationKeys: {
            expired: '2026-05-01',
            active: '2026-05-05'
          },
          notificationsEnabled: true
        },
        '2026-05-01'
      );
      expect(normSettings.holidays).toEqual(['2026-05-01', '2026-05-10']);
      expect(normSettings.snoozedNotificationKeys).toEqual({ active: '2026-05-05' });
    });

    it('formats deadline cells cleanly without [object Object]', () => {
      const cfg = {
        periodicityValue: 12,
        periodicityUnit: 'months' as const,
        warningValue: 14,
        warningDayType: 'calendar' as const
      };
      const cell = { actualDate: '2025-05-10' };

      const summary = formatDeadlineCellDisplay(cell, cfg, { todayIso: '2026-05-01', mode: 'summary' });
      expect(summary).toContain('10.05.2026');
      expect(summary).toContain('10.05.2025');
      expect(summary).not.toContain('[object Object]');

      const nextDateOnly = formatDeadlineCellDisplay(cell, cfg, {
        todayIso: '2026-05-01',
        mode: 'next_date'
      });
      expect(nextDateOnly).toBe('10.05.2026');

      const rawOnly = formatDeadlineCellDisplay({ _rawOriginal: 'по приказу' }, cfg, {
        todayIso: '2026-05-01',
        mode: 'next_date'
      });
      expect(rawOnly).toBe('по приказу');
    });
  });

  describe('notification deduplication, snooze, and multi-entity event aggregation', () => {
    it('generates distinct notification keys on status escalation or next-date change and enforces snooze until next day', () => {
      const kDueSoon = buildDeadlineNotificationKey({
        entityId: 'e1',
        tabId: 't1',
        rowId: 'r1',
        columnId: 'c1',
        effectiveNextDate: '2026-05-10',
        status: 'due_soon'
      });
      const kOverdue = buildDeadlineNotificationKey({
        entityId: 'e1',
        tabId: 't1',
        rowId: 'r1',
        columnId: 'c1',
        effectiveNextDate: '2026-05-10',
        status: 'overdue'
      });
      const kNextCycle = buildDeadlineNotificationKey({
        entityId: 'e1',
        tabId: 't1',
        rowId: 'r1',
        columnId: 'c1',
        effectiveNextDate: '2027-05-10',
        status: 'due_soon'
      });

      expect(kDueSoon).not.toBe(kOverdue);
      expect(kDueSoon).not.toBe(kNextCycle);

      const snoozeMap = createSnoozeMapForNotification({}, kDueSoon, '2026-05-05');
      expect(snoozeMap[kDueSoon]).toBe('2026-05-06');

      // Same day => snoozed; escalation to overdue => NOT snoozed; next day => NOT snoozed
      expect(isNotificationSnoozed(kDueSoon, { snoozedNotificationKeys: snoozeMap }, '2026-05-05')).toBe(
        true
      );
      expect(isNotificationSnoozed(kOverdue, { snoozedNotificationKeys: snoozeMap }, '2026-05-05')).toBe(
        false
      );
      expect(isNotificationSnoozed(kDueSoon, { snoozedNotificationKeys: snoozeMap }, '2026-05-06')).toBe(
        false
      );
    });

    it('collects and filters events across multiple legal entities and respects snooze', () => {
      const base: DatabaseState = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
      const e1 = base.entities[0];
      e1.tabs = [
        {
          id: 'tab_dl_1',
          name: 'Медосмотры',
          columns: [
            { id: 'fio', name: 'ФИО работника', type: 'text' },
            {
              id: 'dl',
              name: 'Срок МО',
              type: 'deadline_control',
              deadlineConfig: {
                periodicityValue: 12,
                periodicityUnit: 'months',
                warningValue: 14,
                warningDayType: 'calendar'
              }
            }
          ],
          rows: [
            { id: 'r1', fio: 'Иванов И.И.', dl: { actualDate: '2025-04-01' } }, // overdue on 2026-05-01
            { id: 'r2', fio: 'Петров П.П.', dl: { actualDate: '2025-05-10' } } // due_soon on 2026-05-01
          ],
          attachedDocs: []
        }
      ];
      base.tabs = e1.tabs;

      const e2 = JSON.parse(JSON.stringify(e1));
      e2.id = 'entity_2';
      e2.profile.shortName = 'ООО «Филиал»';
      e2.tabs[0].rows = [{ id: 'r3', fio: 'Сидоров С.С.', dl: { actualDate: '2026-01-01' } }]; // scheduled
      base.entities.push(e2);

      const events = collectDeadlineEvents(base, { todayIso: '2026-05-01' });
      expect(events).toHaveLength(3);
      expect(events[0].evaluation.status).toBe('overdue');
      expect(events[0].rowIdentifier).toBe('Иванов И.И.');
      expect(events[1].evaluation.status).toBe('due_soon');
      expect(events[2].evaluation.status).toBe('scheduled');

      const snoozeMap = createSnoozeMapForNotification({}, events[0].notificationKey, '2026-05-01');
      const activeAlerts = getActiveAlertDeadlineEvents(
        events,
        { snoozedNotificationKeys: snoozeMap },
        '2026-05-01'
      );
      expect(activeAlerts).toHaveLength(1);
      expect(activeAlerts[0].rowId).toBe('r2');

      expect(filterDeadlineEvents(events, { entityId: 'entity_2' })).toHaveLength(1);
      expect(filterDeadlineEvents(events, { status: 'actionable' })).toHaveLength(2);
      expect(filterDeadlineEvents(events, { search: 'Сидоров' })).toHaveLength(1);
    });
  });

  describe('pure column type conversion and preview', () => {
    it('previews and converts scalar column to deadline_control preserving unrecognized text in _rawOriginal', () => {
      const tab: Tab = {
        id: 't_conv',
        name: 'Обучение',
        columns: [
          { id: 'fio', name: 'ФИО', type: 'text' },
          { id: 'dt', name: 'Дата обучения', type: 'text' }
        ],
        rows: [
          { id: 'r1', fio: 'Иванов', dt: '15.03.2026' },
          { id: 'r2', fio: 'Петров', dt: '2026-04-01' },
          { id: 'r3', fio: 'Сидоров', dt: '' },
          { id: 'r4', fio: 'Козлов', dt: 'освобождён по приказу' }
        ],
        attachedDocs: []
      };

      const preview = previewConversionToDeadline(tab.rows, 'dt', { targetField: 'actualDate' });
      expect(preview.totalRows).toBe(4);
      expect(preview.recognizedCount).toBe(2);
      expect(preview.emptyCount).toBe(1);
      expect(preview.unrecognizedCount).toBe(1);
      expect(preview.unrecognizedSamples[0].rawValue).toBe('освобождён по приказу');

      const converted = convertRowsToDeadline(tab.rows, 'dt', { targetField: 'actualDate' });
      expect(converted.rows[0].dt).toEqual({ actualDate: '2026-03-15' });
      expect(converted.rows[1].dt).toEqual({ actualDate: '2026-04-01' });
      expect(converted.rows[2].dt).toEqual({});
      expect(converted.rows[3].dt).toEqual({ _rawOriginal: 'освобождён по приказу' });
      // Original rows untouched
      expect(tab.rows[0].dt).toBe('15.03.2026');
    });

    it('previews and reverses deadline_control back to date/text and blocks relation conversions', () => {
      const tab: Tab = {
        id: 't_rev',
        name: 'Контроль',
        columns: [
          {
            id: 'dl',
            name: 'Срок',
            type: 'deadline_control',
            deadlineConfig: {
              periodicityValue: 12,
              periodicityUnit: 'months',
              warningValue: 14,
              warningDayType: 'calendar'
            }
          },
          {
            id: 'rel',
            name: 'Должность',
            type: 'relation',
            relation: { masterTabId: 'm1', masterColumnId: 'c1' }
          }
        ],
        rows: [
          { id: 'r1', dl: { actualDate: '2025-05-10' } },
          { id: 'r2', dl: { _rawOriginal: 'не требуется' } },
          { id: 'r3', dl: {} }
        ],
        attachedDocs: []
      };

      const datePreview = previewConversionFromDeadline(tab.rows, 'dl', 'date', {
        extractMode: 'effectiveNextDate',
        config: tab.columns[0].deadlineConfig,
        todayIso: '2026-05-01'
      });
      expect(datePreview.convertedCount).toBe(1);
      expect(datePreview.emptyCount).toBe(1);
      expect(datePreview.lostDataCount).toBe(1);

      const appliedDate = applyColumnTypeConversion(tab, 'dl', 'date', {
        extractMode: 'effectiveNextDate',
        todayIso: '2026-05-01'
      });
      expect(appliedDate.tab.columns[0].type).toBe('date');
      expect(appliedDate.tab.columns[0].deadlineConfig).toBeUndefined();
      expect(appliedDate.tab.rows[0].dl).toBe('2026-05-10');
      expect(appliedDate.tab.rows[1].dl).toBe('');

      const restoredRaw = convertRowsFromDeadline(tab.rows, 'dl', 'text', {
        extractMode: 'rawOriginal',
        config: tab.columns[0].deadlineConfig,
        todayIso: '2026-05-01'
      });
      expect(restoredRaw.rows[0].dl).toBe('10.05.2026');
      expect(restoredRaw.rows[1].dl).toBe('не требуется');

      // Block relation column conversion
      expect(() => applyColumnTypeConversion(tab, 'rel', 'deadline_control')).toThrow(/relation/i);
      expect(() => applyColumnTypeConversion(tab, 'dl', 'relation')).toThrow(/relation/i);
    });
  });
});

describe('T-47: periodicity/warning presets, compatibility, validation, and scalar conversions', () => {
  it('maps the 5 standard periodicity presets and keeps 365 days / 12 months / 0 in manual mode', () => {
    expect(DEADLINE_PERIODICITY_PRESETS.map((p) => p.id)).toEqual([
      '5y',
      '3y',
      '6m',
      '3m',
      '1m'
    ]);
    expect(detectPeriodicityPreset(5, 'years')).toBe('5y');
    expect(detectPeriodicityPreset(3, 'years')).toBe('3y');
    expect(detectPeriodicityPreset(6, 'months')).toBe('6m');
    expect(detectPeriodicityPreset(3, 'months')).toBe('3m');
    expect(detectPeriodicityPreset(1, 'months')).toBe('1m');

    // Legacy 365 days must stay manual 365 days (never coerced to 1 year)
    expect(detectPeriodicityPreset(365, 'days')).toBe('manual');
    expect(detectPeriodicityPreset(12, 'months')).toBe('manual');
    expect(detectPeriodicityPreset(0, 'months')).toBe('manual');

    expect(
      formatDeadlineConfigShortSummary({
        periodicityValue: 365,
        periodicityUnit: 'days',
        warningValue: 14,
        warningDayType: 'calendar'
      })
    ).toBe('Раз в 365 дн. · предупр. за 14 кал. дн.');

    expect(
      formatDeadlineConfigShortSummary({
        periodicityValue: 6,
        periodicityUnit: 'months',
        warningValue: 180,
        warningDayType: 'working'
      })
    ).toBe('1 раз в полгода · предупр. за 180 раб. дн.');
  });

  it('validates periodicity integers (>= 0, rejects empty/negative/decimal/too large)', () => {
    expect(validateDeadlinePeriodicityInput('0')).toEqual({ ok: true, value: 0 });
    expect(validateDeadlinePeriodicityInput('365')).toEqual({ ok: true, value: 365 });
    expect(validateDeadlinePeriodicityInput('')).toMatchObject({ ok: false });
    expect(validateDeadlinePeriodicityInput('-1')).toMatchObject({ ok: false });
    expect(validateDeadlinePeriodicityInput('1.5')).toMatchObject({ ok: false });
    expect(validateDeadlinePeriodicityInput('abc')).toMatchObject({ ok: false });
    expect(validateDeadlinePeriodicityInput('99999')).toMatchObject({ ok: false });
  });

  it('supports warning presets (180/30/14/7/3), preserves non-standard values, and treats 180 as exact days without shifting nextDate', () => {
    expect(DEADLINE_WARNING_PRESETS.map((w) => w.value)).toEqual([180, 30, 14, 7, 3]);
    expect(isStandardWarningPreset(180)).toBe(true);
    expect(isStandardWarningPreset(14)).toBe(true);
    expect(isStandardWarningPreset(10)).toBe(false);

    expect(
      normalizeDeadlineColumnConfig({
        periodicityValue: 365,
        periodicityUnit: 'days',
        warningValue: 10,
        warningDayType: 'calendar'
      })
    ).toEqual({
      periodicityValue: 365,
      periodicityUnit: 'days',
      warningValue: 10,
      warningDayType: 'calendar'
    });

    // Half-year warning = strictly 180 calendar days (not 6 calendar months), and does NOT change calculatedNextDate
    const ev180 = evaluateDeadlineCell(
      { actualDate: '2025-12-01' },
      {
        periodicityValue: 5,
        periodicityUnit: 'years',
        warningValue: 180,
        warningDayType: 'calendar'
      },
      { todayIso: '2030-06-05' } // 179 days before 2030-12-01
    );
    expect(ev180.calculatedNextDate).toBe('2030-12-01');
    expect(ev180.effectiveNextDate).toBe('2030-12-01');
    expect(ev180.calendarDaysRemaining).toBe(179);
    expect(ev180.status).toBe('due_soon');
  });

  it('previews and converts scalar columns safely and blocks relation columns', () => {
    const tab: Tab = {
      id: 't_scalar',
      name: 'Журнал',
      columns: [
        { id: 'c_txt', name: 'Дата строкой', type: 'text' },
        { id: 'c_dl', name: 'Срок', type: 'deadline_control', deadlineConfig: { periodicityValue: 6, periodicityUnit: 'months', warningValue: 14, warningDayType: 'calendar' } },
        { id: 'c_rel', name: 'Должность', type: 'relation', relation: { masterTabId: 'm1', masterColumnId: 'c1' } }
      ],
      rows: [
        { id: 'r1', c_txt: '15.03.2026', c_dl: { actualDate: '2026-01-10', note: 'Ок' } },
        { id: 'r2', c_txt: 'не дата', c_dl: { _rawOriginal: 'по приказу' } },
        { id: 'r3', c_txt: '', c_dl: {} }
      ],
      attachedDocs: []
    };

    const preview = previewScalarConversion(tab.rows, 'c_txt', 'text', 'date');
    expect(preview.totalRows).toBe(3);
    expect(preview.convertedCount).toBe(1);
    expect(preview.emptyCount).toBe(1);
    expect(preview.lostDataCount).toBe(1);

    const converted = applyScalarColumnTypeConversion(tab, 'c_txt', 'date');
    expect(converted.tab.columns[0].type).toBe('date');
    expect(converted.tab.rows[0].c_txt).toBe('2026-03-15');
    expect(converted.tab.rows[1].c_txt).toBe('');
    // Original tab unaffected
    expect(tab.rows[0].c_txt).toBe('15.03.2026');

    const dlToSelect = applyColumnTypeConversion(tab, 'c_dl', 'select', { todayIso: '2026-05-01' });
    expect(dlToSelect.tab.columns[1].type).toBe('select');
    expect(dlToSelect.tab.columns[1].deadlineConfig).toBeUndefined();
    expect(dlToSelect.tab.columns[1].options?.length).toBeGreaterThan(0);

    expect(() => applyScalarColumnTypeConversion(tab, 'c_rel', 'text')).toThrow(/relation/i);
    expect(() => applyScalarColumnTypeConversion(tab, 'c_txt', 'relation')).toThrow(/relation/i);
  });
});

