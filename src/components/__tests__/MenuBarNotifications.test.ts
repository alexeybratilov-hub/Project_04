import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { INITIAL_DATABASE_STATE } from '../../data/initialDatabase';
import {
  applyDeadlineSnoozeInState,
  collectDeadlineEvents,
  selectTopPopoverNotifications,
  summarizeDeadlineEvents
} from '../../services/deadlineService';
import { DatabaseState } from '../../types/database';
import {
  applyDatabaseTransition as applyTransition,
  storageService
} from '../../services/storageService';
import { MenuBar } from '../MenuBar';

function buildMenuBarTestDb(): DatabaseState {
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
  e1.id = 'ent_alpha';
  e1.profile.shortName = 'ООО «Очень длинное название головной организации»';
  e1.tabs = [
    {
      id: 'tab_med',
      name: 'Журнал периодических медицинских осмотров',
      columns: [
        { id: 'emp_fio', name: 'ФИО', type: 'text' },
        {
          id: 'dl_med',
          name: 'Периодический медицинский осмотр',
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
          id: 'r_over_1',
          emp_fio: 'Константинопольский Александр Владимирович',
          dl_med: { actualDate: '2025-04-01' }
        },
        {
          id: 'r_soon_1',
          emp_fio: 'Петров Пётр Петрович',
          dl_med: { actualDate: '2025-05-12', manualNextDate: '2026-05-14' }
        }
      ],
      attachedDocs: []
    }
  ];
  base.activeEntityId = e1.id;
  base.tabs = e1.tabs;
  return base;
}

describe('T-49: MenuBar deadline indicator, popover states, and confirmed snooze error handling', () => {
  it('16a. renders calm indicator & empty state when 0 alerts exist', () => {
    const cleanDb: DatabaseState = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
    const events = collectDeadlineEvents(cleanDb, { todayIso: '2026-05-10' });
    const summary = summarizeDeadlineEvents(events);
    const popover = selectTopPopoverNotifications(events, cleanDb.settings.deadlineSettings, {
      todayIso: '2026-05-10'
    });

    const html = renderToStaticMarkup(
      React.createElement(MenuBar, {
        onSave: () => undefined,
        onExportExcel: () => undefined,
        onFullBackup: () => undefined,
        onRestore: () => undefined,
        onOpenPortableModal: () => undefined,
        onAddRow: () => undefined,
        onDeleteSelectedRows: () => undefined,
        onFocusSearch: () => undefined,
        onAddTab: () => undefined,
        onOpenColumnEditor: () => undefined,
        onOpenRelationsSchema: () => undefined,
        onAuditRelations: () => undefined,
        onOpenTagsModal: () => undefined,
        onOpenAllTemplates: () => undefined,
        onOpenGeneratedDocs: () => undefined,
        onOpenNormativeDocs: () => undefined,
        onOpenLLMStudio: () => undefined,
        onOpenLLMSettings: () => undefined,
        llmConfig: cleanDb.llmConfig,
        onOpenHelp: () => undefined,
        deadlineSummary: summary,
        popoverNotifications: popover,
        initialDeadlinePopoverOpen: true
      })
    );

    expect(html).toContain('data-testid="deadline-indicator-btn"');
    expect(html).toContain('data-deadline-tone="calm"');
    expect(html).toContain('data-testid="deadline-indicator-count"');
    expect(html).toContain('>0<');
    expect(html).toContain('Ближайшие и просроченные события');
    expect(html).toContain('Просроченных и ближайших мероприятий нет');
  });

  it('16b. renders due_soon amber tone and overdue red tone with long names, manual badge, and dark-mode classes', () => {
    const db = buildMenuBarTestDb();
    // Only due_soon
    db.tabs[0].rows = [db.tabs[0].rows[1]];
    db.entities[0].tabs = db.tabs;
    const dueSoonEvents = collectDeadlineEvents(db, { todayIso: '2026-05-10' });
    const dueSoonHtml = renderToStaticMarkup(
      React.createElement(MenuBar, {
        onSave: () => undefined,
        onExportExcel: () => undefined,
        onFullBackup: () => undefined,
        onRestore: () => undefined,
        onOpenPortableModal: () => undefined,
        onAddRow: () => undefined,
        onDeleteSelectedRows: () => undefined,
        onFocusSearch: () => undefined,
        onAddTab: () => undefined,
        onOpenColumnEditor: () => undefined,
        onOpenRelationsSchema: () => undefined,
        onAuditRelations: () => undefined,
        onOpenTagsModal: () => undefined,
        onOpenAllTemplates: () => undefined,
        onOpenGeneratedDocs: () => undefined,
        onOpenNormativeDocs: () => undefined,
        onOpenLLMStudio: () => undefined,
        onOpenLLMSettings: () => undefined,
        llmConfig: db.llmConfig,
        onOpenHelp: () => undefined,
        deadlineSummary: summarizeDeadlineEvents(dueSoonEvents),
        popoverNotifications: selectTopPopoverNotifications(
          dueSoonEvents,
          db.settings.deadlineSettings,
          { todayIso: '2026-05-10' }
        ),
        initialDeadlinePopoverOpen: true
      })
    );

    expect(dueSoonHtml).toContain('data-deadline-tone="due_soon"');
    expect(dueSoonHtml).toContain('bg-amber-600');
    expect(dueSoonHtml).toContain('ручн.');

    // Both overdue + due_soon with long names
    const fullDb = buildMenuBarTestDb();
    const fullEvents = collectDeadlineEvents(fullDb, { todayIso: '2026-05-10' });
    const fullHtml = renderToStaticMarkup(
      React.createElement(MenuBar, {
        onSave: () => undefined,
        onExportExcel: () => undefined,
        onFullBackup: () => undefined,
        onRestore: () => undefined,
        onOpenPortableModal: () => undefined,
        onAddRow: () => undefined,
        onDeleteSelectedRows: () => undefined,
        onFocusSearch: () => undefined,
        onAddTab: () => undefined,
        onOpenColumnEditor: () => undefined,
        onOpenRelationsSchema: () => undefined,
        onAuditRelations: () => undefined,
        onOpenTagsModal: () => undefined,
        onOpenAllTemplates: () => undefined,
        onOpenGeneratedDocs: () => undefined,
        onOpenNormativeDocs: () => undefined,
        onOpenLLMStudio: () => undefined,
        onOpenLLMSettings: () => undefined,
        llmConfig: fullDb.llmConfig,
        onOpenHelp: () => undefined,
        deadlineSummary: summarizeDeadlineEvents(fullEvents),
        popoverNotifications: selectTopPopoverNotifications(
          fullEvents,
          fullDb.settings.deadlineSettings,
          { todayIso: '2026-05-10' }
        ),
        deadlineNotificationsEnabled: false,
        onJumpToDeadlineEvent: () => undefined,
        onSnoozeDeadlineNotification: async () => ({ ok: true }),
        onToggleDeadlineNotifications: async () => ({ ok: true }),
        onOpenDeadlineControlTab: () => undefined,
        initialDeadlinePopoverOpen: true
      })
    );

    expect(fullHtml).toContain('data-deadline-tone="overdue"');
    expect(fullHtml).toContain('bg-red-600');
    expect(fullHtml).toContain('dark:bg-slate-900');
    expect(fullHtml).toContain('Константинопольский Александр Владимирович');
    expect(fullHtml).toContain('ООО «Очень длинное название головной организации»');
    expect(fullHtml).toContain('Перейти к записи');
    expect(fullHtml).toContain('Скрыть на сегодня');
    expect(fullHtml).toContain('Открыть вкладку «Контроль сроков»');
    expect(fullHtml).toContain('Без тостов');
  });

  it('16c. keeps real counter and shows snoozed summary + calm state when all alerts are snoozed, and shows overflow note when >10 active', () => {
    const db = buildMenuBarTestDb();
    // Create 12 overdue rows
    db.tabs[0].rows = Array.from({ length: 12 }, (_, idx) => ({
      id: `r_many_${idx + 1}`,
      emp_fio: `Сотрудник ${idx + 1}`,
      dl_med: { actualDate: `2025-04-${String(idx + 1).padStart(2, '0')}` }
    }));
    db.entities[0].tabs = db.tabs;

    const events = collectDeadlineEvents(db, { todayIso: '2026-05-10' });
    const summary = summarizeDeadlineEvents(events);
    const popoverMany = selectTopPopoverNotifications(events, db.settings.deadlineSettings, {
      todayIso: '2026-05-10'
    });
    expect(popoverMany.items).toHaveLength(10);
    expect(popoverMany.totalActiveCount).toBe(12);

    const manyHtml = renderToStaticMarkup(
      React.createElement(MenuBar, {
        onSave: () => undefined,
        onExportExcel: () => undefined,
        onFullBackup: () => undefined,
        onRestore: () => undefined,
        onOpenPortableModal: () => undefined,
        onAddRow: () => undefined,
        onDeleteSelectedRows: () => undefined,
        onFocusSearch: () => undefined,
        onAddTab: () => undefined,
        onOpenColumnEditor: () => undefined,
        onOpenRelationsSchema: () => undefined,
        onAuditRelations: () => undefined,
        onOpenTagsModal: () => undefined,
        onOpenAllTemplates: () => undefined,
        onOpenGeneratedDocs: () => undefined,
        onOpenNormativeDocs: () => undefined,
        onOpenLLMStudio: () => undefined,
        onOpenLLMSettings: () => undefined,
        llmConfig: db.llmConfig,
        onOpenHelp: () => undefined,
        deadlineSummary: summary,
        popoverNotifications: popoverMany,
        initialDeadlinePopoverOpen: true
      })
    );
    expect(manyHtml).toContain('Показаны 10 самых срочных из 12 активных уведомлений.');

    // Now snooze all 12 events -> indicator count STILL 12, popover shows snoozed calm state
    let snoozedDb = db;
    for (const ev of events) {
      snoozedDb = applyDeadlineSnoozeInState(snoozedDb, ev.notificationKey, '2026-05-10');
    }
    const snoozedPopover = selectTopPopoverNotifications(
      events,
      snoozedDb.settings.deadlineSettings,
      { todayIso: '2026-05-10' }
    );
    const snoozedHtml = renderToStaticMarkup(
      React.createElement(MenuBar, {
        onSave: () => undefined,
        onExportExcel: () => undefined,
        onFullBackup: () => undefined,
        onRestore: () => undefined,
        onOpenPortableModal: () => undefined,
        onAddRow: () => undefined,
        onDeleteSelectedRows: () => undefined,
        onFocusSearch: () => undefined,
        onAddTab: () => undefined,
        onOpenColumnEditor: () => undefined,
        onOpenRelationsSchema: () => undefined,
        onAuditRelations: () => undefined,
        onOpenTagsModal: () => undefined,
        onOpenAllTemplates: () => undefined,
        onOpenGeneratedDocs: () => undefined,
        onOpenNormativeDocs: () => undefined,
        onOpenLLMStudio: () => undefined,
        onOpenLLMSettings: () => undefined,
        llmConfig: db.llmConfig,
        onOpenHelp: () => undefined,
        deadlineSummary: summary,
        popoverNotifications: snoozedPopover,
        initialDeadlinePopoverOpen: true
      })
    );
    expect(snoozedHtml).toContain('>12<');
    expect(snoozedHtml).toContain('Скрыто на сегодня:');
    expect(snoozedHtml).toContain('Активных напоминаний на сегодня нет');
  });

  it('13. does not commit snooze state on persistence failure and succeeds on retry', async () => {
    const initialDb = buildMenuBarTestDb();
    const events = collectDeadlineEvents(initialDb, { todayIso: '2026-05-10' });
    const targetKey = events[0].notificationKey;

    let committedState = initialDb;
    const saveSpy = vi
      .spyOn(storageService, 'saveDatabaseAsync')
      .mockResolvedValueOnce({
        ok: false,
        errorKind: 'disk_write',
        message: 'Диск защищён от записи'
      })
      .mockResolvedValueOnce({
        ok: true
      });

    try {
      const attemptSnooze = async () => {
        const nextState = applyTransition(
          committedState,
          (prev) => applyDeadlineSnoozeInState(prev, targetKey, '2026-05-10'),
          { touchTimestamp: true }
        );
        const res = await storageService.saveDatabaseAsync(nextState);
        if (!res.ok) {
          return { ok: false as const, error: res.message };
        }
        committedState = nextState;
        return { ok: true as const };
      };

      // First attempt fails -> committedState must NOT contain snooze key
      const firstRes = await attemptSnooze();
      expect(firstRes.ok).toBe(false);
      expect(firstRes.error).toBe('Диск защищён от записи');
      expect(committedState.settings.deadlineSettings?.snoozedNotificationKeys).toEqual({});

      // Retry succeeds -> committedState records snooze and keeps holidays intact
      const retryRes = await attemptSnooze();
      expect(retryRes.ok).toBe(true);
      expect(committedState.settings.deadlineSettings?.snoozedNotificationKeys).toEqual({
        [targetKey]: '2026-05-11'
      });
      expect(committedState.settings.deadlineSettings?.holidays).toEqual(['2026-05-01']);
    } finally {
      saveSpy.mockRestore();
    }
  });
});
