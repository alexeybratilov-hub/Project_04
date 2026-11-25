import { describe, it, expect } from 'vitest';
import { INITIAL_DATABASE_STATE } from '../../data/initialDatabase';
import { DEFAULT_INSTALLED_MODULES, MODULE_DEFINITIONS } from '../../data/modules';
import {
  disableModule,
  getInstalledModules,
  getVisibleTabs,
  installModule
} from '../moduleService';
import {
  buildLinkedRow,
  completeObligation,
  detectControlViolations,
  ensureHireObligations,
  rescheduleObligationsForHireDate,
  summarizeObligations
} from '../obligationService';
import { DatabaseState, Row, Tab } from '../../types/database';

function baseState(): DatabaseState {
  return JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE)) as DatabaseState;
}

const employeesTab = (state: DatabaseState): Tab =>
  state.tabs.find((tab) => tab.moduleId === 'employees') as Tab;

const employeeRow = (overrides?: Partial<Row>): Row => ({
  id: 'row_test_1',
  emp_fio: 'Иванов Иван Иванович',
  emp_tab_num: '0001',
  emp_hire_date: '2026-02-01',
  ...overrides
});

describe('Модульная архитектура этапов', () => {
  it('новая база стартует с двумя базовыми модулями', () => {
    expect(DEFAULT_INSTALLED_MODULES).toEqual(['staffing', 'employees']);
    const state = baseState();
    expect(getInstalledModules(state)).toEqual(['staffing', 'employees']);
    const visible = getVisibleTabs(state).map((tab) => tab.moduleId);
    expect(visible).toEqual(['staffing', 'employees']);
  });

  it('включение модуля добавляет вкладку, шаблоны и видимость', () => {
    const state = baseState();
    const withoutMedical = {
      ...state,
      tabs: state.tabs.filter((tab) => tab.moduleId !== 'medical'),
      templates: state.templates.filter((tpl) => tpl.tabId !== 'tab_med')
    };

    const installed = installModule(withoutMedical, 'medical');
    expect(getInstalledModules(installed)).toContain('medical');
    const medTab = installed.tabs.find((tab) => tab.moduleId === 'medical');
    expect(medTab).toBeTruthy();
    expect(medTab!.columns.length).toBeGreaterThan(0);
    expect(installed.templates.some((tpl) => tpl.tabId === 'tab_med')).toBe(true);
    expect(getVisibleTabs(installed).some((tab) => tab.moduleId === 'medical')).toBe(true);
  });

  it('отключение модуля скрывает вкладку, но сохраняет данные', () => {
    const state = baseState();
    const employees = employeesTab(state);
    const withRow = {
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === employees.id ? { ...tab, rows: [employeeRow()] } : tab
      )
    };

    const disabled = disableModule(withRow, 'employees');
    expect(getInstalledModules(disabled)).not.toContain('employees');
    expect(getVisibleTabs(disabled).some((tab) => tab.moduleId === 'employees')).toBe(false);
    const stored = disabled.tabs.find((tab) => tab.moduleId === 'employees');
    expect(stored?.rows).toHaveLength(1);
  });

  it('все объявленные модули имеют корректный tabId и описание', () => {
    MODULE_DEFINITIONS.forEach((module) => {
      expect(module.tabId.startsWith('tab_')).toBe(true);
      expect(module.description.length).toBeGreaterThan(20);
    });
  });
});

describe('Движок обязательств', () => {
  it('при приёме создаёт полный пакет по матрице требований (независимо от модулей)', () => {
    const obligations = ensureHireObligations([], {
      employeeRowId: 'row_test_1',
      hireDateIso: '2026-02-01',
      createdAt: '2026-02-01T00:00:00.000Z'
    });

    // briefings: вводный, первичный, проверка знаний, повторный; medical: направление, периодический; ppe: карточка
    expect(obligations).toHaveLength(7);
    expect(new Set(obligations.map((item) => item.moduleId))).toEqual(
      new Set(['briefings', 'medical', 'ppe'])
    );
    const intro = obligations.find((item) => item.requirementId === 'briefing_intro');
    expect(intro?.dueDate).toBe('2026-02-01');
    const initial = obligations.find((item) => item.requirementId === 'briefing_initial');
    expect(initial?.dueDate).toBe('2026-03-03');
    const med = obligations.find((item) => item.requirementId === 'med_referral');
    expect(med?.templateId).toBe('tpl_med_referral');
    expect(med?.periodicityMonths).toBe(12);
  });

  it('повторный расчёт идемпотентен', () => {
    const params = {
      employeeRowId: 'row_test_1',
      hireDateIso: '2026-02-01',
    };
    const first = ensureHireObligations([], params);
    const second = ensureHireObligations(first, params);
    expect(second).toHaveLength(first.length);
    expect(second).toEqual(first);
  });

  it('выполнение периодического требования создаёт следующее', () => {
    const obligations = ensureHireObligations([], {
      employeeRowId: 'row_test_1',
      hireDateIso: '2026-02-01',
    });
    const referral = obligations.find((item) => item.requirementId === 'med_referral');
    expect(referral).toBeTruthy();

    const completed = completeObligation(obligations, referral!.id, '2026-02-10');
    const done = completed.find((item) => item.id === referral!.id);
    expect(done?.status).toBe('done');
    expect(done?.completedAt).toBe('2026-02-10');

    const next = completed.find(
      (item) => item.requirementId === 'med_referral' && item.id !== referral!.id
    );
    expect(next?.status).toBe('pending');
    expect(next?.dueDate).toBe('2027-02-10');
  });

  it('изменение даты приёма сдвигает незакрытые сроки и не трогает выполненные', () => {
    let obligations = ensureHireObligations([], {
      employeeRowId: 'row_test_1',
      hireDateIso: '2026-02-01',
    });
    const initial = obligations.find((item) => item.requirementId === 'briefing_initial')!;
    obligations = completeObligation(obligations, initial.id, '2026-02-05');

    const rescheduled = rescheduleObligationsForHireDate(obligations, 'row_test_1', '2026-04-01');
    const intro = rescheduled.find((item) => item.requirementId === 'briefing_intro')!;
    expect(intro.dueDate).toBe('2026-04-01');
    const done = rescheduled.find((item) => item.id === initial.id)!;
    expect(done.dueDate).toBe(initial.dueDate);
  });

  it('сводка считает просрочки и ближайшие сроки', () => {
    const obligations = ensureHireObligations([], {
      employeeRowId: 'row_test_1',
      hireDateIso: '2026-01-01',
    });
    const summary = summarizeObligations(obligations, '2026-02-20');
    expect(summary.total).toBe(obligations.length);
    expect(summary.overdue).toBeGreaterThan(0);
    expect(summary.nearestDueDate).toBe('2026-01-01');
  });

  it('контрольная точка срабатывает, когда документ не оформлен к сроку', () => {
    const obligations = ensureHireObligations([], {
      employeeRowId: 'row_test_1',
      hireDateIso: '2026-01-01',
    });
    const violations = detectControlViolations(
      obligations,
      [{ row: employeeRow(), tab: undefined }],
      '2026-02-20'
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].employeeRowId).toBe('row_test_1');
    expect(violations.every((item) => item.reason.includes('срок'))).toBe(true);
  });

  it('строка модуля создаётся со связью на работника и датой приёма', () => {
    const state = baseState();
    const employees = employeesTab(state);
    const medTab = state.tabs.find((tab) => tab.moduleId === 'medical') as Tab;
    const row = employeeRow();

    const linked = buildLinkedRow(medTab, employees, row, '2026-02-01');
    const employeeLinkColumns = medTab.columns.filter(
      (col) => col.relation?.masterTabId === employees.id
    );
    expect(employeeLinkColumns.length).toBeGreaterThan(0);
    employeeLinkColumns.forEach((col) => {
      expect(linked[col.id]).toBe('Иванов Иван Иванович');
    });
    const dateColumn = medTab.columns.find((col) => col.type === 'date');
    if (dateColumn) {
      expect(linked[dateColumn.id]).toBe('2026-02-01');
    }
  });
});
