import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { INITIAL_DATABASE_STATE } from '../../data/initialDatabase';
import { collectDeadlineEvents, SYSTEM_DEADLINE_TAB_ID } from '../../services/deadlineService';
import { DatabaseState, Tab } from '../../types/database';
import {
  DeadlineControlView,
  DEFAULT_DEADLINE_VIEW_FILTER,
  formatDeadlineRemainingHint,
  hasActiveDeadlineFilters,
  reconcileDeadlineViewFilter
} from '../DeadlineControlView';
import { StatusBar } from '../StatusBar';
import { TabBar } from '../TabBar';

function buildUiTestDatabase(): DatabaseState {
  const base: DatabaseState = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
  base.settings = {
    ...base.settings,
    deadlineSettings: {
      holidays: ['2026-05-01', '2026-05-09']
    }
  };

  const e1 = base.entities[0];
  e1.id = 'ent_1';
  e1.profile.shortName = 'ООО «Север»';
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
      rows: [
        {
          id: 'row_over',
          emp_fio: 'Иванов И.И.',
          dl_mo: { actualDate: '2025-04-01', note: 'Срочно направить' }
        },
        {
          id: 'row_soon',
          emp_fio: 'Петров П.П.',
          dl_mo: { actualDate: '2025-05-10' }
        },
        {
          id: 'row_miss',
          emp_fio: 'Кузнецов К.К.',
          dl_mo: {}
        }
      ],
      attachedDocs: []
    },
    {
      id: 'tab_intro',
      name: 'Инструктажи',
      columns: [
        { id: 'emp_fio', name: 'ФИО работника', type: 'text' },
        {
          id: 'dl_intro',
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
          id: 'row_done',
          emp_fio: 'Новиков Н.Н.',
          dl_intro: { actualDate: '2026-03-10' }
        }
      ],
      attachedDocs: []
    }
  ];
  base.activeEntityId = e1.id;
  base.tabs = e1.tabs;

  const e2 = JSON.parse(JSON.stringify(e1));
  e2.id = 'ent_2';
  e2.profile.shortName = 'АО «Юг-Пром»';
  e2.tabs = [
    {
      id: 'tab_attest',
      name: 'Аттестация',
      columns: [
        { id: 'emp_fio', name: 'ФИО работника', type: 'text' },
        {
          id: 'dl_att',
          name: 'Проверка знаний ОТ',
          type: 'deadline_control',
          deadlineConfig: {
            periodicityValue: 3,
            periodicityUnit: 'years',
            warningValue: 30,
            warningDayType: 'working'
          }
        }
      ],
      rows: [
        {
          id: 'row_sched',
          emp_fio: 'Соколова Е.А.',
          dl_att: {
            actualDate: '2025-01-10',
            manualNextDate: '2027-08-20',
            note: 'Перенос по протоколу №4'
          }
        }
      ],
      attachedDocs: []
    }
  ];
  base.entities.push(e2);
  return base;
}

describe('T-48: DeadlineControlView, TabBar system tab, and StatusBar', () => {
  it('reconciles invalid filter options safely and detects active filters', () => {
    const db = buildUiTestDatabase();
    const events = collectDeadlineEvents(db, { todayIso: '2026-05-01' });

    expect(hasActiveDeadlineFilters(DEFAULT_DEADLINE_VIEW_FILTER)).toBe(false);
    expect(
      hasActiveDeadlineFilters({ ...DEFAULT_DEADLINE_VIEW_FILTER, status: 'overdue' })
    ).toBe(true);

    // Invalid entityId / tabId / rowIdentifier fall back to 'all', while status & search stay intact
    const reconciled = reconcileDeadlineViewFilter(
      {
        entityId: 'deleted_entity',
        tabId: 'tab_attest',
        rowIdentifier: 'Несуществующий',
        status: 'due_soon',
        search: 'Петров'
      },
      events
    );
    expect(reconciled).toEqual({
      entityId: 'all',
      tabId: 'tab_attest',
      rowIdentifier: 'all',
      status: 'due_soon',
      search: 'Петров'
    });

    // Valid entity + incompatible tab from another entity resets incompatible tab
    const mismatchedTab = reconcileDeadlineViewFilter(
      {
        entityId: 'ent_1',
        tabId: 'tab_attest',
        rowIdentifier: 'all',
        status: 'all',
        search: ''
      },
      events
    );
    expect(mismatchedTab.entityId).toBe('ent_1');
    expect(mismatchedTab.tabId).toBe('all');

    const overdueEv = events.find((e) => e.evaluation.status === 'overdue')!;
    expect(formatDeadlineRemainingHint(overdueEv)).toContain('Просрочено на');
    const completedEv = events.find((e) => e.evaluation.status === 'completed')!;
    expect(formatDeadlineRemainingHint(completedEv)).toBe('Разовое выполнено');
  });

  it('renders all 5 statuses, entities, tables, manual marker, notes, and actions without mutating dbState', () => {
    const db = buildUiTestDatabase();
    const snapshotBefore = JSON.stringify(db);

    const html = renderToStaticMarkup(
      React.createElement(DeadlineControlView, {
        dbState: db,
        todayIso: '2026-05-01',
        onJumpToEvent: () => undefined,
        onMarkCompletedToday: () => undefined,
        onUpdateHolidays: () => undefined
      })
    );

    expect(html).toContain('Контроль сроков по всем организациям');
    expect(html).toContain('ООО «Север»');
    expect(html).toContain('АО «Юг-Пром»');
    expect(html).toContain('Медосмотры');
    expect(html).toContain('Инструктажи');
    expect(html).toContain('Аттестация');
    expect(html).toContain('Иванов И.И.');
    expect(html).toContain('Соколова Е.А.');
    expect(html).toContain('Просрочено');
    expect(html).toContain('Скоро');
    expect(html).toContain('Запланировано');
    expect(html).toContain('Выполнено');
    expect(html).toContain('Данные отсутствуют');
    expect(html).toContain('ручн.');
    expect(html).toContain('Перенос по протоколу №4');
    expect(html).toContain('Срочно направить');
    expect(html).toContain('Праздничные дни');
    expect(html).toContain('Перейти');
    expect(html).toContain('Показано: <strong class="text-slate-800 dark:text-slate-200">5</strong> из 5');
    expect(html).not.toContain('[object Object]');

    // Read-only guarantee: rendering system view does not mutate dbState
    expect(JSON.stringify(db)).toBe(snapshotBefore);
  });

  it('renders filtered results with reset button and clean empty-filter state', () => {
    const db = buildUiTestDatabase();

    const filteredHtml = renderToStaticMarkup(
      React.createElement(DeadlineControlView, {
        dbState: db,
        todayIso: '2026-05-01',
        initialFilter: {
          entityId: 'ent_2',
          status: 'scheduled',
          search: 'Соколова'
        },
        onJumpToEvent: () => undefined,
        onMarkCompletedToday: () => undefined,
        onUpdateHolidays: () => undefined
      })
    );

    expect(filteredHtml).toContain('Соколова Е.А.');
    expect(filteredHtml).not.toContain('Иванов И.И.');
    expect(filteredHtml).toContain('Сбросить фильтры');
    expect(filteredHtml).toContain('Показано: <strong class="text-slate-800 dark:text-slate-200">1</strong> из 5');

    const emptyFilterHtml = renderToStaticMarkup(
      React.createElement(DeadlineControlView, {
        dbState: db,
        todayIso: '2026-05-01',
        initialFilter: {
          search: 'Несуществующий_Запрос_XYZ'
        },
        onJumpToEvent: () => undefined,
        onMarkCompletedToday: () => undefined,
        onUpdateHolidays: () => undefined
      })
    );

    expect(emptyFilterHtml).toContain('По заданным фильтрам мероприятий не найдено');
    expect(emptyFilterHtml).toContain('Сбросить фильтры');
  });

  it('renders dedicated empty states when no deadline_control columns exist or columns have 0 rows', () => {
    const noColsDb: DatabaseState = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
    const noColsHtml = renderToStaticMarkup(
      React.createElement(DeadlineControlView, {
        dbState: noColsDb,
        todayIso: '2026-05-01',
        onJumpToEvent: () => undefined,
        onMarkCompletedToday: () => undefined,
        onUpdateHolidays: () => undefined
      })
    );
    expect(noColsHtml).toContain('Нет столбцов контроля сроков');

    const emptyRowsDb: DatabaseState = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
    emptyRowsDb.entities[0].tabs = [
      {
        id: 't_empty',
        name: 'Медосмотры',
        columns: [
          { id: 'fio', name: 'ФИО', type: 'text' },
          { id: 'dl', name: 'Срок', type: 'deadline_control' }
        ],
        rows: [],
        attachedDocs: []
      }
    ];
    emptyRowsDb.tabs = emptyRowsDb.entities[0].tabs;

    const emptyRowsHtml = renderToStaticMarkup(
      React.createElement(DeadlineControlView, {
        dbState: emptyRowsDb,
        todayIso: '2026-05-01',
        onJumpToEvent: () => undefined,
        onMarkCompletedToday: () => undefined,
        onUpdateHolidays: () => undefined
      })
    );
    expect(emptyRowsHtml).toContain('Контролируемых записей пока нет');
  });

  it('renders pinned non-draggable/non-deletable system tab in TabBar independently of 20-tab limit and StatusBar summary', () => {
    const userTabs: Tab[] = Array.from({ length: 20 }, (_, i) => ({
      id: `tab_${i + 1}`,
      name: `Таблица ${i + 1}`,
      columns: [{ id: 'c1', name: 'Поле', type: 'text' }],
      rows: [],
      attachedDocs: []
    }));

    const tabBarHtml = renderToStaticMarkup(
      React.createElement(TabBar, {
        tabs: userTabs,
        activeTabId: SYSTEM_DEADLINE_TAB_ID,
        onSelectTab: () => undefined,
        onAddTab: () => undefined,
        onRenameTab: () => undefined,
        onDeleteTab: () => undefined,
        deadlineOverdueCount: 2,
        deadlineDueSoonCount: 1
      })
    );

    expect(tabBarHtml).toContain(`data-tab-id="${SYSTEM_DEADLINE_TAB_ID}"`);
    expect(tabBarHtml).toContain('data-system-tab="true"');
    expect(tabBarHtml).toContain('draggable="false"');
    expect(tabBarHtml).toContain('Контроль сроков');
    // Attention badge shows 2 + 1 = 3
    expect(tabBarHtml).toContain('>3<');
    // User tabs still preserve exact 20-tab limit independently of the system tab
    expect(tabBarHtml).toContain('Лимит 20');
    expect(tabBarHtml).toContain('data-user-tab-id="tab_20"');
    // System tab does not render user-tab context menu button
    expect(tabBarHtml).not.toContain('Опции вкладки Контроль сроков');

    const statusBarHtml = renderToStaticMarkup(
      React.createElement(StatusBar, {
        systemTabSummary: {
          label: 'Контроль сроков',
          totalEvents: 5,
          attentionCount: 2
        },
        storageMode: 'web-preview',
        databaseDirectory: './data',
        onOpenPortableModal: () => undefined
      })
    );
    expect(statusBarHtml).toContain('«Контроль сроков»');
    expect(statusBarHtml).toContain('Мероприятий:');
    expect(statusBarHtml).toContain('>5<');
    expect(statusBarHtml).toContain('Требуют внимания:');
    expect(statusBarHtml).toContain('>2<');
  });
});
