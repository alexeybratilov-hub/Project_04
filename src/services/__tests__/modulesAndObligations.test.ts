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
  ensureEventObligations,
  ensureHireObligations,
  resolveEmployeeContext,
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

    // employees: приказ; briefings: вводный, первичный, проверка знаний, повторный;
    // medical: направление, периодический; ppe: карточка
    expect(obligations).toHaveLength(8);
    expect(new Set(obligations.map((item) => item.moduleId))).toEqual(
      new Set(['employees', 'briefings', 'medical', 'ppe'])
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

describe('События жизненного цикла', () => {
  const makeEvent = (type: any, date: string, id = 'evt_1') => ({
    id,
    employeeRowId: 'row_test_1',
    type,
    date,
    createdAt: '2026-02-01T00:00:00.000Z'
  });

  it('перевод создаёт приказ, внеплановый инструктаж и проверку знаний', () => {
    const obligations = ensureEventObligations([], {
      employeeRowId: 'row_test_1',
      event: makeEvent('transfer', '2026-05-10')
    });
    expect(obligations).toHaveLength(3);
    const ids = obligations.map((item) => item.requirementId).sort();
    expect(ids).toEqual(['transfer_briefing', 'transfer_knowledge', 'transfer_order']);
    const order = obligations.find((item) => item.requirementId === 'transfer_order');
    expect(order?.dueDate).toBe('2026-05-10');
    expect(order?.eventId).toBe('evt_1');
    expect(order?.eventType).toBe('transfer');
  });

  it('увольнение создаёт приказ, возврат СИЗ и закрытие карточки', () => {
    const obligations = ensureEventObligations([], {
      employeeRowId: 'row_test_1',
      event: makeEvent('dismissal', '2026-06-01', 'evt_2')
    });
    expect(obligations.map((item) => item.requirementId).sort()).toEqual([
      'dismissal_order',
      'personal_card_close',
      'ppe_return'
    ]);
  });

  it('несчастный случай даёт акт, расследование и внеплановый инструктаж', () => {
    const obligations = ensureEventObligations([], {
      employeeRowId: 'row_test_1',
      event: makeEvent('incident', '2026-07-01', 'evt_3')
    });
    expect(obligations.map((item) => item.requirementId).sort()).toEqual([
      'incident_act',
      'incident_briefing',
      'incident_investigation'
    ]);
    const act = obligations.find((item) => item.requirementId === 'incident_act');
    expect(act?.dueDate).toBe('2026-07-02');
  });

  it('повторное событие того же типа не дублирует требования в рамках события, но создаёт новый пакет', () => {
    const first = ensureEventObligations([], {
      employeeRowId: 'row_test_1',
      event: makeEvent('transfer', '2026-05-10', 'evt_1')
    });
    const sameAgain = ensureEventObligations(first, {
      employeeRowId: 'row_test_1',
      event: makeEvent('transfer', '2026-05-10', 'evt_1')
    });
    expect(sameAgain).toHaveLength(first.length);

    const second = ensureEventObligations(sameAgain, {
      employeeRowId: 'row_test_1',
      event: makeEvent('transfer', '2026-09-01', 'evt_4')
    });
    expect(second.length).toBe(first.length * 2);
  });
});

describe('Матрица требований: должность и класс условий труда', () => {
  it('обучение руководителей добавляется только для руководящих должностей', () => {
    const worker = ensureHireObligations([], {
      employeeRowId: 'row_worker',
      hireDateIso: '2026-02-01',
      context: { positionTitle: 'Слесарь-ремонтник', soutClass: '3.1' }
    });
    expect(worker.some((item) => item.requirementId === 'manager_training')).toBe(false);

    const manager = ensureHireObligations([], {
      employeeRowId: 'row_manager',
      hireDateIso: '2026-02-01',
      context: { positionTitle: 'Начальник участка', soutClass: '2.0' }
    });
    const training = manager.find((item) => item.requirementId === 'manager_training');
    expect(training).toBeTruthy();
    expect(training?.periodicityMonths).toBe(36);
  });

  it('периодичность медосмотра зависит от класса условий труда', () => {
    const office = ensureHireObligations([], {
      employeeRowId: 'row_office',
      hireDateIso: '2026-02-01',
      context: { positionTitle: 'Менеджер', soutClass: '2.0' }
    });
    const hazardous = ensureHireObligations([], {
      employeeRowId: 'row_hazard',
      hireDateIso: '2026-02-01',
      context: { positionTitle: 'Сварщик', soutClass: '3.2' }
    });

    expect(office.find((item) => item.requirementId === 'med_referral')?.periodicityMonths).toBe(24);
    expect(
      hazardous.find((item) => item.requirementId === 'med_referral')?.periodicityMonths
    ).toBe(12);
  });

  it('класс условий труда берётся из штатного расписания по должности работника', () => {
    const state = baseState();
    const row = { ...employeeRow(), emp_position: 'Электрогазосварщик 5 разряда' };
    const context = resolveEmployeeContext(state.tabs, row);
    expect(context.positionTitle).toBe('Электрогазосварщик 5 разряда');
    expect(context.soutClass).toBe('3.2');
  });
});
