import { describe, it, expect } from 'vitest';
import {
  addCalendarDays,
  addCalendarMonths,
  addCalendarYears,
  applyActualDateUpdate,
  applyDeadlineCompletedTodayInState,
  applyDeadlineNotificationsEnabledInState,
  applyDeadlineSnoozeInState,
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
  evaluateSessionToastNotifications,
  filterDeadlineEvents,
  formatDeadlineCellDisplay,
  formatDeadlineConfigShortSummary,
  formatDeadlinePeriodicityOnly,
  getActiveAlertDeadlineEvents,
  getDeadlineFilterOptions,
  hasAnyDeadlineControlColumn,
  isNotificationSnoozed,
  isStandardWarningPreset,
  markDeadlineCompletedToday,
  MAX_POPOVER_DEADLINE_NOTIFICATIONS,
  mergePresetHolidays,
  normalizeDeadlineAppSettings,
  normalizeDeadlineCellValue,
  normalizeDeadlineColumnConfig,
  normalizeSnoozedNotificationKeys,
  parseFlexibleDateToIso,
  previewConversionFromDeadline,
  previewConversionToDeadline,
  previewScalarConversion,
  resolveDeadlineEventTarget,
  RF_PRODUCTION_CALENDAR_2026,
  RF_PRODUCTION_CALENDAR_2027,
  selectTopPopoverNotifications,
  summarizeDeadlineEvents,
  SYSTEM_DEADLINE_TAB_ID,
  updateDeadlineCellValue,
  validateDeadlinePeriodicityInput
} from '../deadlineService';
import { normalizeDatabaseState } from '../storageService';
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

  it('tracks exact field losses (actualDate, manualNextDate, note, _rawOriginal) across all reverse conversion modes and respects custom selectOptions', () => {
    const config = {
      periodicityValue: 6,
      periodicityUnit: 'months' as const,
      warningValue: 14,
      warningDayType: 'calendar' as const
    };
    const rows = [
      {
        id: 'r_all',
        dl: {
          actualDate: '2026-01-10',
          manualNextDate: '2026-11-15',
          note: 'Особое условие',
          _rawOriginal: '123'
        }
      },
      { id: 'r_actual', dl: { actualDate: '2026-02-01' } },
      { id: 'r_manual', dl: { manualNextDate: '2026-12-01' } },
      { id: 'r_note', dl: { note: 'Только заметка' } },
      { id: 'r_raw', dl: { _rawOriginal: 'да' } },
      { id: 'r_empty', dl: {} }
    ];

    // 1) date / effectiveNextDate:
    // r_all -> manualNextDate kept (actualDate, note, _rawOriginal lost)
    // r_actual -> calculatedNextDate kept (actualDate lost!)
    // r_manual -> manualNextDate kept (lossless)
    // r_note -> full loss (note lost)
    // r_raw -> full loss (_rawOriginal lost)
    const pDateEff = previewConversionFromDeadline(rows, 'dl', 'date', {
      extractMode: 'effectiveNextDate',
      config,
      todayIso: '2026-05-01'
    });
    expect(pDateEff.convertedCount).toBe(3);
    expect(pDateEff.emptyCount).toBe(1);
    expect(pDateEff.lostDataCount).toBe(2);
    expect(pDateEff.partialLossCount).toBe(2);
    expect(pDateEff.lostFieldsSummary).toEqual({
      actualDate: 2,
      manualNextDate: 0,
      note: 2,
      _rawOriginal: 2
    });

    // 2) date / actualDate:
    // r_all -> actualDate kept (manualNextDate, note, _rawOriginal lost)
    // r_actual -> actualDate kept (lossless)
    // r_manual, r_note, r_raw -> full loss
    const pDateActual = previewConversionFromDeadline(rows, 'dl', 'date', {
      extractMode: 'actualDate',
      config,
      todayIso: '2026-05-01'
    });
    expect(pDateActual.convertedCount).toBe(2);
    expect(pDateActual.lostDataCount).toBe(3);
    expect(pDateActual.partialLossCount).toBe(1);
    expect(pDateActual.lostFieldsSummary).toEqual({
      actualDate: 0,
      manualNextDate: 2,
      note: 2,
      _rawOriginal: 2
    });

    // 3) text / summary:
    // r_all -> План + Факт kept (note, _rawOriginal lost)
    // r_actual, r_manual -> lossless
    // r_note -> summary is '' -> full loss! (note lost)
    // r_raw -> _rawOriginal kept (lossless)
    const pTextSummary = previewConversionFromDeadline(rows, 'dl', 'text', {
      extractMode: 'summary',
      config,
      todayIso: '2026-05-01'
    });
    expect(pTextSummary.convertedCount).toBe(4);
    expect(pTextSummary.lostDataCount).toBe(1);
    expect(pTextSummary.partialLossCount).toBe(1);
    expect(pTextSummary.lostFieldsSummary).toEqual({
      actualDate: 0,
      manualNextDate: 0,
      note: 2,
      _rawOriginal: 1
    });

    // 4) text / rawOriginal:
    // r_all -> '123' kept (actualDate, manualNextDate, note lost)
    // r_actual -> fallback calculated next date (actualDate lost)
    // r_manual -> fallback manualNextDate (lossless)
    // r_note -> fallback note (lossless)
    // r_raw -> 'да' kept (lossless)
    const pTextRaw = previewConversionFromDeadline(rows, 'dl', 'text', {
      extractMode: 'rawOriginal',
      config,
      todayIso: '2026-05-01'
    });
    expect(pTextRaw.convertedCount).toBe(5);
    expect(pTextRaw.lostDataCount).toBe(0);
    expect(pTextRaw.partialLossCount).toBe(2);
    expect(pTextRaw.lostFieldsSummary).toEqual({
      actualDate: 2,
      manualNextDate: 1,
      note: 1,
      _rawOriginal: 0
    });

    // 5) number:
    // r_all -> _rawOriginal '123' -> 123 (actualDate, manualNextDate, note lost -> partialLoss!)
    // r_actual, r_manual, r_note, r_raw ('да') -> full loss
    const pNumber = previewConversionFromDeadline(rows, 'dl', 'number', {
      config,
      todayIso: '2026-05-01'
    });
    expect(pNumber.convertedCount).toBe(1);
    expect(pNumber.lostDataCount).toBe(4);
    expect(pNumber.partialLossCount).toBe(1);
    expect(pNumber.lostFieldsSummary).toEqual({
      actualDate: 2,
      manualNextDate: 2,
      note: 2,
      _rawOriginal: 1
    });

    // 6) boolean:
    // r_raw ('да') -> true (lossless); r_all ('123') & others -> full loss
    const pBool = previewConversionFromDeadline(rows, 'dl', 'boolean', {
      config,
      todayIso: '2026-05-01'
    });
    expect(pBool.convertedCount).toBe(1);
    expect(pBool.lostDataCount).toBe(4);
    expect(pBool.partialLossCount).toBe(0);
    expect(pBool.lostFieldsSummary).toEqual({
      actualDate: 2,
      manualNextDate: 2,
      note: 2,
      _rawOriginal: 1
    });

    // 7) select & 8) link:
    // r_all -> '123' (partialLoss: actualDate, manualNextDate, note lost)
    // r_raw -> 'да' (lossless)
    // r_actual, r_manual, r_note -> full loss
    for (const targetType of ['select', 'link'] as const) {
      const pTarget = previewConversionFromDeadline(rows, 'dl', targetType, {
        config,
        todayIso: '2026-05-01'
      });
      expect(pTarget.convertedCount).toBe(2);
      expect(pTarget.lostDataCount).toBe(3);
      expect(pTarget.partialLossCount).toBe(1);
      expect(pTarget.lostFieldsSummary).toEqual({
        actualDate: 2,
        manualNextDate: 2,
        note: 2,
        _rawOriginal: 0
      });
    }

    // selectOptions: explicit user options vs automatic collection
    const tab: Tab = {
      id: 't_sel',
      name: 'МО',
      columns: [{ id: 'dl', name: 'Срок', type: 'deadline_control', deadlineConfig: config }],
      rows,
      attachedDocs: []
    };
    const withCustomSelect = applyColumnTypeConversion(tab, 'dl', 'select', {
      selectOptions: ['Годен', 'Отстранён']
    });
    expect(withCustomSelect.tab.columns[0].options).toEqual(['Годен', 'Отстранён']);

    const withAutoSelect = applyColumnTypeConversion(tab, 'dl', 'select');
    expect(withAutoSelect.tab.columns[0].options).toEqual(['123', 'да']);

    const scalarTab: Tab = {
      id: 't_scalar_sel',
      name: 'Текст',
      columns: [{ id: 'txt', name: 'Поле', type: 'text' }],
      rows: [{ id: 'r1', txt: 'Alpha' }, { id: 'r2', txt: 'Beta' }],
      attachedDocs: []
    };
    const scalarCustomSelect = applyScalarColumnTypeConversion(scalarTab, 'txt', 'select', {
      selectOptions: ['Вариант А', 'Вариант Б']
    });
    expect(scalarCustomSelect.tab.columns[0].options).toEqual(['Вариант А', 'Вариант Б']);

    const scalarAutoSelect = applyScalarColumnTypeConversion(scalarTab, 'txt', 'select');
    expect(scalarAutoSelect.tab.columns[0].options).toEqual(['Alpha', 'Beta']);
  });
});

describe('T-48: System Deadline Control aggregation, filtering, target resolution & immutability', () => {
  function buildMultiEntityDeadlineDb(): DatabaseState {
    const base: DatabaseState = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
    base.settings = {
      ...base.settings,
      deadlineSettings: {
        holidays: ['2026-05-01'],
        notificationsEnabled: true
      }
    };

    const e1 = base.entities[0];
    e1.id = 'ent_alpha';
    e1.profile.shortName = 'ООО «Альфа»';
    e1.tabs = [
      {
        id: 'tab_med',
        name: 'Медосмотры',
        columns: [
          { id: 'emp_fio', name: 'ФИО работника', type: 'text' },
          {
            id: 'col_med',
            name: 'Периодический МО',
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
          {
            id: 'r_overdue',
            emp_fio: 'Иванов Иван',
            col_med: { actualDate: '2025-04-01', note: 'Пропустил запись' }
          },
          {
            id: 'r_due_soon',
            emp_fio: 'Петров Пётр',
            col_med: { actualDate: '2025-05-10', note: 'Записан в клинику' }
          },
          {
            id: 'r_missing',
            emp_fio: 'Смирнов Сергей',
            col_med: {}
          }
        ],
        attachedDocs: []
      },
      {
        id: 'tab_train',
        name: 'Обучение ОТ',
        columns: [
          { id: 'emp_fio', name: 'ФИО работника', type: 'text' },
          {
            id: 'col_once',
            name: 'Вводный инструктаж',
            type: 'deadline_control',
            deadlineConfig: {
              periodicityValue: 0,
              periodicityUnit: 'months',
              warningValue: 14,
              warningDayType: 'calendar'
            }
          }
        ],
        rows: [
          {
            id: 'r_completed',
            emp_fio: 'Иванов Иван',
            col_once: { actualDate: '2026-02-15', note: 'Журнал №1' }
          }
        ],
        attachedDocs: []
      }
    ];
    base.activeEntityId = e1.id;
    base.tabs = e1.tabs;

    const e2 = JSON.parse(JSON.stringify(e1));
    e2.id = 'ent_beta';
    e2.profile.shortName = 'ООО «Бета»';
    e2.tabs = [
      {
        id: 'tab_med', // intentionally matches e1's cloned tab id!
        name: 'Медосмотры',
        columns: [
          { id: 'emp_fio', name: 'ФИО работника', type: 'text' },
          {
            id: 'col_med',
            name: 'Периодический МО',
            type: 'deadline_control',
            deadlineConfig: {
              periodicityValue: 3,
              periodicityUnit: 'years',
              warningValue: 30,
              warningDayType: 'calendar'
            }
          }
        ],
        rows: [
          {
            id: 'r_scheduled',
            emp_fio: 'Сидорова Анна',
            col_med: {
              actualDate: '2025-01-10',
              manualNextDate: '2027-09-01',
              note: 'Перенесено по приказу'
            }
          }
        ],
        attachedDocs: []
      }
    ];
    base.entities.push(e2);
    return base;
  }

  it('uses stable system tab ID and aggregates events across multiple entities/tables without duplication', () => {
    expect(SYSTEM_DEADLINE_TAB_ID).toBe('__system_deadline_control__');
    const db = buildMultiEntityDeadlineDb();
    expect(hasAnyDeadlineControlColumn(db)).toBe(true);

    const events = collectDeadlineEvents(db, { todayIso: '2026-05-01' });
    expect(events).toHaveLength(5);

    // Unique eventIds even on repeated collection calls
    const eventIds = events.map((e) => e.eventId);
    expect(new Set(eventIds).size).toBe(5);
    const eventsAgain = collectDeadlineEvents(db, { todayIso: '2026-05-01' });
    expect(eventsAgain.map((e) => e.eventId)).toEqual(eventIds);

    // Verify all 5 statuses & exact source attribution
    const statuses = events.map((e) => e.evaluation.status);
    expect(statuses).toEqual(['overdue', 'due_soon', 'scheduled', 'missing_data', 'completed']);

    const betaScheduled = events.find((e) => e.rowId === 'r_scheduled')!;
    expect(betaScheduled.entityId).toBe('ent_beta');
    expect(betaScheduled.entityName).toBe('ООО «Бета»');
    expect(betaScheduled.tabId).toBe('tab_med');
    expect(betaScheduled.tabName).toBe('Медосмотры');
    expect(betaScheduled.rowIdentifier).toBe('Сидорова Анна');
    expect(betaScheduled.columnName).toBe('Периодический МО');
    expect(betaScheduled.evaluation.actualDate).toBe('2025-01-10');
    expect(betaScheduled.evaluation.effectiveNextDate).toBe('2027-09-01');
    expect(betaScheduled.evaluation.nextDateSource).toBe('manual');
    expect(betaScheduled.evaluation.value.note).toBe('Перенесено по приказу');
    expect(formatDeadlinePeriodicityOnly(betaScheduled.evaluation.config)).toBe('1 раз в 3 года');

    const summary = summarizeDeadlineEvents(events);
    expect(summary).toEqual({
      total: 5,
      overdue: 1,
      dueSoon: 1,
      scheduled: 1,
      completed: 1,
      missingData: 1,
      actionable: 2,
      closedOrMissing: 2
    });
  });

  it('supports joint filtering (entity + tab + rowIdentifier + status + search) and clean reset', () => {
    const db = buildMultiEntityDeadlineDb();
    const events = collectDeadlineEvents(db, { todayIso: '2026-05-01' });

    const optionsAll = getDeadlineFilterOptions(events);
    expect(optionsAll.entities.map((e) => e.id)).toEqual(['ent_alpha', 'ent_beta']);
    expect(optionsAll.tabs.map((t) => t.id)).toContain('tab_med');
    expect(optionsAll.tabs.map((t) => t.id)).toContain('tab_train');

    // Entity-scoped options isolate tabs & rowIdentifiers for that entity
    const optionsBeta = getDeadlineFilterOptions(events, { entityId: 'ent_beta' });
    expect(optionsBeta.tabs.map((t) => t.id)).toEqual(['tab_med']);
    expect(optionsBeta.rowIdentifiers).toEqual(['Сидорова Анна']);

    // Joint filter combining entityId + tabId + rowIdentifier + status + search
    const narrowed = filterDeadlineEvents(events, {
      entityId: 'ent_alpha',
      tabId: 'tab_med',
      rowIdentifier: 'Иванов Иван',
      status: 'overdue',
      search: 'Пропустил'
    });
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0].rowId).toBe('r_overdue');

    // Mismatched combination yields 0
    const emptyFiltered = filterDeadlineEvents(events, {
      entityId: 'ent_beta',
      tabId: 'tab_train'
    });
    expect(emptyFiltered).toHaveLength(0);

    // Resetting all filters returns all 5 events
    const resetFiltered = filterDeadlineEvents(events, {
      entityId: 'all',
      tabId: 'all',
      rowIdentifier: 'all',
      status: 'all',
      search: ''
    });
    expect(resetFiltered).toHaveLength(5);
  });

  it('resolves target by exact IDs across entities/tabs and fails safely when row, tab, column, or entity is deleted', () => {
    const db = buildMultiEntityDeadlineDb();
    const events = collectDeadlineEvents(db, { todayIso: '2026-05-01' });

    // Cross-entity target resolution finds exact row on inactive entity
    const betaEvent = events.find((e) => e.entityId === 'ent_beta')!;
    const okRes = resolveDeadlineEventTarget(db, betaEvent);
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.entity.id).toBe('ent_beta');
      expect(okRes.tab.id).toBe('tab_med');
      expect(okRes.row.id).toBe('r_scheduled');
      expect(okRes.rowIdentifier).toBe('Сидорова Анна');
    }

    // Deleted row must NOT fall back to another row by index
    const dbDeletedRow: DatabaseState = JSON.parse(JSON.stringify(db));
    dbDeletedRow.tabs[0].rows = dbDeletedRow.tabs[0].rows.filter((r) => r.id !== 'r_overdue');
    const alphaOverdue = events.find((e) => e.rowId === 'r_overdue')!;
    const rowMissing = resolveDeadlineEventTarget(dbDeletedRow, alphaOverdue);
    expect(rowMissing.ok).toBe(false);
    if (!rowMissing.ok) {
      expect(rowMissing.reason).toBe('row_missing');
    }

    // Deleted tab
    const dbDeletedTab: DatabaseState = JSON.parse(JSON.stringify(db));
    dbDeletedTab.tabs = dbDeletedTab.tabs.filter((t) => t.id !== 'tab_train');
    const completedEv = events.find((e) => e.tabId === 'tab_train')!;
    const tabMissing = resolveDeadlineEventTarget(dbDeletedTab, completedEv);
    expect(tabMissing.ok).toBe(false);
    if (!tabMissing.ok) {
      expect(tabMissing.reason).toBe('tab_missing');
    }

    // Deleted/converted column
    const dbDeletedCol: DatabaseState = JSON.parse(JSON.stringify(db));
    dbDeletedCol.tabs[0].columns = dbDeletedCol.tabs[0].columns.filter((c) => c.id !== 'col_med');
    const colMissing = resolveDeadlineEventTarget(dbDeletedCol, alphaOverdue);
    expect(colMissing.ok).toBe(false);
    if (!colMissing.ok) {
      expect(colMissing.reason).toBe('column_missing');
    }
  });

  it('reflects live updates when marking completed today on active or inactive entity and leaves db intact during read-only operations', () => {
    const db = buildMultiEntityDeadlineDb();
    const snapshotBefore = JSON.stringify(db);

    // Read-only operations: collect, summarize, filterOptions, filter, resolve
    const events = collectDeadlineEvents(db, { todayIso: '2026-05-01' });
    summarizeDeadlineEvents(events);
    getDeadlineFilterOptions(events, { entityId: 'ent_alpha' });
    filterDeadlineEvents(events, { status: 'overdue', search: 'Иванов' });
    resolveDeadlineEventTarget(db, events[0]);

    // Database must be byte-for-byte identical after read-only operations
    expect(JSON.stringify(db)).toBe(snapshotBefore);

    // Mark overdue event on active entity as completed today (2026-05-01)
    const overdueEv = events.find((e) => e.rowId === 'r_overdue')!;
    const resActive = applyDeadlineCompletedTodayInState(db, overdueEv, '2026-05-01');
    expect(resActive.updated).toBe(true);
    const updatedActiveEvents = collectDeadlineEvents(resActive.state, { todayIso: '2026-05-01' });
    const refreshedOverdue = updatedActiveEvents.find((e) => e.rowId === 'r_overdue')!;
    expect(refreshedOverdue.evaluation.actualDate).toBe('2026-05-01');
    expect(refreshedOverdue.evaluation.effectiveNextDate).toBe('2027-05-01');
    expect(refreshedOverdue.evaluation.status).toBe('scheduled');

    // Mark event on INACTIVE entity (ent_beta) as completed today -> clears stale manualNextDate
    const betaEv = events.find((e) => e.entityId === 'ent_beta')!;
    const resInactive = applyDeadlineCompletedTodayInState(resActive.state, betaEv, '2026-05-01');
    expect(resInactive.updated).toBe(true);
    const updatedAll = collectDeadlineEvents(resInactive.state, { todayIso: '2026-05-01' });
    const refreshedBeta = updatedAll.find((e) => e.entityId === 'ent_beta')!;
    expect(refreshedBeta.evaluation.actualDate).toBe('2026-05-01');
    expect(refreshedBeta.evaluation.manualNextDate).toBeUndefined();
    expect(refreshedBeta.evaluation.effectiveNextDate).toBe('2029-05-01');
    expect(refreshedBeta.evaluation.status).toBe('scheduled');
  });

  it('handles databases without any deadline_control columns cleanly', () => {
    const cleanDb: DatabaseState = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
    expect(hasAnyDeadlineControlColumn(cleanDb)).toBe(false);
    expect(collectDeadlineEvents(cleanDb, { todayIso: '2026-05-01' })).toEqual([]);
  });
});

describe('T-49: Notification keys, top-10 popover selection, session deduplication & snooze lifecycle', () => {
  function buildAlertRichDb(countOverdue = 7, countDueSoon = 6): DatabaseState {
    const base: DatabaseState = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
    base.settings = {
      ...base.settings,
      deadlineSettings: {
        holidays: ['2026-05-01'],
        notificationsEnabled: true,
        snoozedNotificationKeys: {}
      }
    };

    const e1 = base.entities[0];
    e1.id = 'ent_1';
    e1.profile.shortName = 'ООО «Север»';
    const rows1: any[] = [];
    for (let i = 0; i < countOverdue; i++) {
      // Today = 2026-05-10 => 2025-04-01..2025-04-07 gives nextDate 2026-04-01..2026-04-07 (overdue -39..-33)
      const day = String(1 + i).padStart(2, '0');
      rows1.push({
        id: `row_over_${i + 1}`,
        emp_fio: `Просроченный ${i + 1}`,
        dl_mo: { actualDate: `2025-04-${day}` }
      });
    }
    // Non-alert statuses that MUST NOT trigger notifications
    rows1.push({
      id: 'row_sched_only',
      emp_fio: 'Плановый Сотрудник',
      dl_mo: { actualDate: '2025-12-15' }
    });
    rows1.push({
      id: 'row_missing_only',
      emp_fio: 'Пустой Сотрудник',
      dl_mo: {}
    });

    e1.tabs = [
      {
        id: 'tab_mo',
        name: 'Медосмотры',
        columns: [
          { id: 'emp_fio', name: 'ФИО работника', type: 'text' },
          {
            id: 'dl_mo',
            name: 'Периодический МО',
            type: 'deadline_control',
            deadlineConfig: {
              periodicityValue: 12,
              periodicityUnit: 'months',
              warningValue: 14,
              warningDayType: 'calendar'
            }
          }
        ],
        rows: rows1,
        attachedDocs: []
      },
      {
        id: 'tab_once',
        name: 'Вводный инструктаж',
        columns: [
          { id: 'emp_fio', name: 'ФИО работника', type: 'text' },
          {
            id: 'dl_once',
            name: 'Инструктаж',
            type: 'deadline_control',
            deadlineConfig: {
              periodicityValue: 0,
              periodicityUnit: 'months',
              warningValue: 14,
              warningDayType: 'calendar'
            }
          }
        ],
        rows: [{ id: 'row_done_only', emp_fio: 'Закрытый Сотрудник', dl_once: { actualDate: '2026-03-01' } }],
        attachedDocs: []
      }
    ];
    base.activeEntityId = e1.id;
    base.tabs = e1.tabs;

    const e2 = JSON.parse(JSON.stringify(e1));
    e2.id = 'ent_2';
    e2.profile.shortName = 'АО «Юг»';
    const rows2: any[] = [];
    for (let i = 0; i < countDueSoon; i++) {
      // Today = 2026-05-10 => 2025-05-11..2025-05-16 gives nextDate 2026-05-11..2026-05-16 (due_soon +1..+6)
      const day = String(11 + i).padStart(2, '0');
      rows2.push({
        id: `row_soon_${i + 1}`,
        emp_fio: `Ближайший ${i + 1}`,
        dl_att: { actualDate: `2025-05-${day}` }
      });
    }
    e2.tabs = [
      {
        id: 'tab_att',
        name: 'Аттестация',
        columns: [
          { id: 'emp_fio', name: 'ФИО работника', type: 'text' },
          {
            id: 'dl_att',
            name: 'Проверка знаний',
            type: 'deadline_control',
            deadlineConfig: {
              periodicityValue: 12,
              periodicityUnit: 'months',
              warningValue: 14,
              warningDayType: 'calendar'
            }
          }
        ],
        rows: rows2,
        attachedDocs: []
      }
    ];
    base.entities.push(e2);
    return base;
  }

  it('1-2. builds distinct notificationKeys and emits alerts strictly for overdue & due_soon', () => {
    const k1 = buildDeadlineNotificationKey({
      entityId: 'ent_1',
      tabId: 'tab_mo',
      rowId: 'r1',
      columnId: 'dl_mo',
      effectiveNextDate: '2026-05-15',
      status: 'due_soon'
    });
    const k2 = buildDeadlineNotificationKey({
      entityId: 'ent_1',
      tabId: 'tab_mo',
      rowId: 'r1',
      columnId: 'dl_mo',
      effectiveNextDate: '2026-05-15',
      status: 'overdue'
    });
    const k3 = buildDeadlineNotificationKey({
      entityId: 'ent_2',
      tabId: 'tab_mo',
      rowId: 'r1',
      columnId: 'dl_mo',
      effectiveNextDate: '2026-05-15',
      status: 'due_soon'
    });
    expect(k1).toBe('ent_1::tab_mo::r1::dl_mo::2026-05-15::due_soon');
    expect(k2).not.toBe(k1);
    expect(k3).not.toBe(k1);

    const db = buildAlertRichDb(1, 1);
    const events = collectDeadlineEvents(db, { todayIso: '2026-05-10' });
    // Total events = 1 overdue + 1 due_soon + 1 scheduled + 1 missing_data + 1 completed = 5
    expect(events).toHaveLength(5);

    const active = getActiveAlertDeadlineEvents(events, db.settings.deadlineSettings, '2026-05-10');
    expect(active.map((e) => e.evaluation.status)).toEqual(['overdue', 'due_soon']);
  });

  it('3. sorts by urgency and caps popover notifications at 10 while reporting total counts', () => {
    const db = buildAlertRichDb(7, 6); // 13 actionable alerts
    const events = collectDeadlineEvents(db, { todayIso: '2026-05-10' });

    const popover = selectTopPopoverNotifications(events, db.settings.deadlineSettings, {
      todayIso: '2026-05-10'
    });
    expect(MAX_POPOVER_DEADLINE_NOTIFICATIONS).toBe(10);
    expect(popover.items).toHaveLength(10);
    expect(popover.totalActiveCount).toBe(13);
    expect(popover.overdueAlertCount).toBe(7);
    expect(popover.dueSoonAlertCount).toBe(6);
    expect(popover.snoozedAlertCount).toBe(0);

    // First 7 must be overdue (oldest overdue first), next 3 must be nearest due_soon
    expect(popover.items.slice(0, 7).every((i) => i.evaluation.status === 'overdue')).toBe(true);
    expect(popover.items[0].rowId).toBe('row_over_1');
    expect(popover.items[6].rowId).toBe('row_over_7');
    expect(popover.items.slice(7).every((i) => i.evaluation.status === 'due_soon')).toBe(true);
    expect(popover.items[7].rowId).toBe('row_soon_1');
    expect(popover.items[9].rowId).toBe('row_soon_3');
  });

  it('4-5. deduplicates within a session across repeated checks, entity switches, and unrelated cell edits', () => {
    const db = buildAlertRichDb(2, 1);
    const shownKeys = new Set<string>();
    const events1 = collectDeadlineEvents(db, { todayIso: '2026-05-10' });

    const firstEval = evaluateSessionToastNotifications({
      events: events1,
      shownKeys,
      deadlineSettings: db.settings.deadlineSettings,
      todayIso: '2026-05-10'
    });
    expect(firstEval.shouldShowToast).toBe(true);
    expect(firstEval.newKeys).toHaveLength(3);
    expect(firstEval.overdueCount).toBe(2);
    expect(firstEval.dueSoonCount).toBe(1);
    expect(firstEval.variant).toBe('error');
    firstEval.newKeys.forEach((k) => shownKeys.add(k));

    // Re-evaluating with same keys -> NO toast
    const secondEval = evaluateSessionToastNotifications({
      events: events1,
      shownKeys,
      deadlineSettings: db.settings.deadlineSettings,
      todayIso: '2026-05-10'
    });
    expect(secondEval.shouldShowToast).toBe(false);

    // Switching active entity + editing an unrelated text cell -> still NO toast
    const switchedDb: DatabaseState = JSON.parse(JSON.stringify(db));
    switchedDb.activeEntityId = 'ent_2';
    switchedDb.tabs = switchedDb.entities[1].tabs;
    switchedDb.tabs[0].rows[0].emp_fio = 'Ближайший 1 (испр.)';
    const eventsAfterSwitch = collectDeadlineEvents(switchedDb, { todayIso: '2026-05-10' });

    const thirdEval = evaluateSessionToastNotifications({
      events: eventsAfterSwitch,
      shownKeys,
      deadlineSettings: switchedDb.settings.deadlineSettings,
      todayIso: '2026-05-10'
    });
    expect(thirdEval.shouldShowToast).toBe(false);
  });

  it('6-8. re-notifies on due_soon -> overdue escalation (even if snoozed), effectiveNextDate change, and fresh session', () => {
    const db = buildAlertRichDb(0, 1);
    // Single due_soon row: actualDate 2025-05-11 -> nextDate 2026-05-11
    const eventsDay1 = collectDeadlineEvents(db, { todayIso: '2026-05-10' });
    const dueSoonKey = eventsDay1[0].notificationKey;
    expect(dueSoonKey).toContain('2026-05-11::due_soon');

    // Snooze the due_soon key on 2026-05-10 (hideUntil = 2026-05-11)
    const snoozedDb = applyDeadlineSnoozeInState(db, dueSoonKey, '2026-05-10');
    expect(snoozedDb.settings.deadlineSettings?.snoozedNotificationKeys?.[dueSoonKey]).toBe('2026-05-11');

    // Suppose on 2026-05-12 it escalated to overdue (or even if hideUntil were later, escalation changes key!)
    const escalatedSnoozedDb: DatabaseState = JSON.parse(JSON.stringify(snoozedDb));
    escalatedSnoozedDb.settings.deadlineSettings!.snoozedNotificationKeys![dueSoonKey] = '2026-05-20';
    const eventsEscalated = collectDeadlineEvents(escalatedSnoozedDb, { todayIso: '2026-05-12' });
    const escalatedKey = eventsEscalated[0].notificationKey;
    expect(escalatedKey).toContain('2026-05-11::overdue');

    const shownKeys = new Set<string>([dueSoonKey]);
    const escalationEval = evaluateSessionToastNotifications({
      events: eventsEscalated,
      shownKeys,
      deadlineSettings: escalatedSnoozedDb.settings.deadlineSettings,
      todayIso: '2026-05-12'
    });
    expect(escalationEval.shouldShowToast).toBe(true);
    expect(escalationEval.newKeys).toEqual([escalatedKey]);

    // Changing effectiveNextDate (manual override to 2026-05-05 -> overdue) creates new key & re-notifies
    shownKeys.add(escalatedKey);
    const changedDateDb: DatabaseState = JSON.parse(JSON.stringify(escalatedSnoozedDb));
    changedDateDb.entities[1].tabs[0].rows[0].dl_att = {
      actualDate: '2025-05-11',
      manualNextDate: '2026-05-05'
    };
    const eventsChangedDate = collectDeadlineEvents(changedDateDb, { todayIso: '2026-05-12' });
    const dateChangedEval = evaluateSessionToastNotifications({
      events: eventsChangedDate,
      shownKeys,
      deadlineSettings: changedDateDb.settings.deadlineSettings,
      todayIso: '2026-05-12'
    });
    expect(dateChangedEval.shouldShowToast).toBe(true);
    expect(dateChangedEval.newKeys[0]).toContain('2026-05-05::overdue');

    // Fresh app session (empty Set) without active snooze notifies again
    const freshSessionEval = evaluateSessionToastNotifications({
      events: collectDeadlineEvents(db, { todayIso: '2026-05-10' }),
      shownKeys: new Set<string>(),
      deadlineSettings: db.settings.deadlineSettings,
      todayIso: '2026-05-10'
    });
    expect(freshSessionEval.shouldShowToast).toBe(true);
  });

  it('9-12, 14-15. snoozes only targeted key until today+1, preserves source rows/holidays/other entities, and reactivates next day', () => {
    const db = buildAlertRichDb(1, 1);
    const snapshotRowsBefore = JSON.stringify(db.entities.map((e) => e.tabs));
    const events = collectDeadlineEvents(db, { todayIso: '2026-05-10' });
    const overdueEv = events.find((e) => e.evaluation.status === 'overdue')!;
    const dueSoonEv = events.find((e) => e.evaluation.status === 'due_soon')!;

    const snoozedDb = applyDeadlineSnoozeInState(db, overdueEv.notificationKey, '2026-05-10');

    // 9. hideUntil = 2026-05-11; holidays & notificationsEnabled preserved
    expect(snoozedDb.settings.deadlineSettings?.holidays).toEqual(['2026-05-01']);
    expect(snoozedDb.settings.deadlineSettings?.notificationsEnabled).toBe(true);
    expect(snoozedDb.settings.deadlineSettings?.snoozedNotificationKeys).toEqual({
      [overdueEv.notificationKey]: '2026-05-11'
    });

    // 14-15. Source rows/cells are untouched and no session shownKeys are written to DB
    expect(JSON.stringify(snoozedDb.entities.map((e) => e.tabs))).toBe(snapshotRowsBefore);
    expect((snoozedDb.settings.deadlineSettings as Record<string, unknown>).shownToastKeys).toBeUndefined();

    // 10 & 12. Same day (2026-05-10): overdueEv is hidden from active toast & popover, while dueSoonEv (ent_2) remains active; total summary still counts both!
    expect(
      isNotificationSnoozed(overdueEv.notificationKey, snoozedDb.settings.deadlineSettings, '2026-05-10')
    ).toBe(true);
    expect(
      isNotificationSnoozed(dueSoonEv.notificationKey, snoozedDb.settings.deadlineSettings, '2026-05-10')
    ).toBe(false);

    const sameDayPopover = selectTopPopoverNotifications(
      events,
      snoozedDb.settings.deadlineSettings,
      { todayIso: '2026-05-10' }
    );
    expect(sameDayPopover.items.map((i) => i.notificationKey)).toEqual([dueSoonEv.notificationKey]);
    expect(sameDayPopover.snoozedAlertCount).toBe(1);
    expect(sameDayPopover.overdueAlertCount).toBe(1);

    const sameDayToast = evaluateSessionToastNotifications({
      events,
      shownKeys: new Set<string>(),
      deadlineSettings: snoozedDb.settings.deadlineSettings,
      todayIso: '2026-05-10'
    });
    expect(sameDayToast.shouldShowToast).toBe(true);
    expect(sameDayToast.newKeys).toEqual([dueSoonEv.notificationKey]);

    // 11. Next calendar day (2026-05-11 >= hideUntil): snoozed event reactivates & normalizeDatabaseState prunes expired snooze keys
    const eventsNextDay = collectDeadlineEvents(snoozedDb, { todayIso: '2026-05-11' });
    expect(
      isNotificationSnoozed(overdueEv.notificationKey, snoozedDb.settings.deadlineSettings, '2026-05-11')
    ).toBe(false);
    const nextDayToast = evaluateSessionToastNotifications({
      events: eventsNextDay,
      shownKeys: new Set<string>(),
      deadlineSettings: snoozedDb.settings.deadlineSettings,
      todayIso: '2026-05-11'
    });
    expect(nextDayToast.shouldShowToast).toBe(true);
    expect(nextDayToast.newKeys).toContain(overdueEv.notificationKey);

    expect(
      normalizeSnoozedNotificationKeys(
        snoozedDb.settings.deadlineSettings?.snoozedNotificationKeys,
        '2026-05-11'
      )
    ).toEqual({});

    // Verify normalizeDatabaseState cleans expired keys automatically using controlled test today override
    const prevGlobalToday = (globalThis as { __OT_BAZA_TEST_TODAY_ISO__?: string })
      .__OT_BAZA_TEST_TODAY_ISO__;
    try {
      (globalThis as { __OT_BAZA_TEST_TODAY_ISO__?: string }).__OT_BAZA_TEST_TODAY_ISO__ =
        '2026-05-11';
      const normalizedNextDay = normalizeDatabaseState(snoozedDb);
      expect(normalizedNextDay.settings.deadlineSettings?.snoozedNotificationKeys).toEqual({});
    } finally {
      if (prevGlobalToday === undefined) {
        delete (globalThis as { __OT_BAZA_TEST_TODAY_ISO__?: string }).__OT_BAZA_TEST_TODAY_ISO__;
      } else {
        (globalThis as { __OT_BAZA_TEST_TODAY_ISO__?: string }).__OT_BAZA_TEST_TODAY_ISO__ =
          prevGlobalToday;
      }
    }

    // Also verify createSnoozeMapForNotification keeps non-expired keys
    const twoSnoozed = createSnoozeMapForNotification(
      { other_key: '2026-05-12', expired_key: '2026-05-10' },
      'new_key',
      '2026-05-10'
    );
    expect(twoSnoozed).toEqual({
      other_key: '2026-05-12',
      new_key: '2026-05-11'
    });
  });

  it('17. suppresses toasts when notificationsEnabled is false while keeping popover and counts intact', () => {
    const db = buildAlertRichDb(2, 1);
    const disabledDb = applyDeadlineNotificationsEnabledInState(db, false, '2026-05-10');
    expect(disabledDb.settings.deadlineSettings?.notificationsEnabled).toBe(false);

    const events = collectDeadlineEvents(disabledDb, { todayIso: '2026-05-10' });
    const toastEval = evaluateSessionToastNotifications({
      events,
      shownKeys: new Set<string>(),
      deadlineSettings: disabledDb.settings.deadlineSettings,
      todayIso: '2026-05-10'
    });
    expect(toastEval.shouldShowToast).toBe(false);

    const popover = selectTopPopoverNotifications(events, disabledDb.settings.deadlineSettings, {
      todayIso: '2026-05-10'
    });
    expect(popover.items).toHaveLength(3);
    expect(popover.overdueAlertCount).toBe(2);
    expect(popover.dueSoonAlertCount).toBe(1);
  });

  it('18. provides RF production calendars for 2026 and 2027 and merges without duplicates', () => {
    expect(RF_PRODUCTION_CALENDAR_2026).toContain('2026-01-01');
    expect(RF_PRODUCTION_CALENDAR_2026).toContain('2026-05-11');
    expect(RF_PRODUCTION_CALENDAR_2026).toContain('2026-12-31');
    expect(RF_PRODUCTION_CALENDAR_2027).toContain('2027-01-01');
    expect(RF_PRODUCTION_CALENDAR_2027).toContain('2027-05-10');
    expect(RF_PRODUCTION_CALENDAR_2027).toContain('2027-11-04');

    const with2026 = mergePresetHolidays(['2026-05-01', '2026-12-25'], 2026);
    expect(with2026).toContain('2026-12-25');
    // No duplicate 2026-05-01
    expect(with2026.filter((d) => d === '2026-05-01')).toHaveLength(1);

    const withBoth = mergePresetHolidays(with2026, 2027);
    expect(withBoth.length).toBe(
      new Set(['2026-12-25', ...RF_PRODUCTION_CALENDAR_2026, ...RF_PRODUCTION_CALENDAR_2027]).size
    );

    // Working day diff across May 2026 holidays skips 2026-05-09 (Sat), 2026-05-10 (Sun), 2026-05-11 (Mon transfer)
    // Fri 2026-05-08 -> Tue 2026-05-12 = 1 working day (Tue) instead of 2
    expect(diffWorkingDays('2026-05-08', '2026-05-12', withBoth)).toBe(1);
  });
});



