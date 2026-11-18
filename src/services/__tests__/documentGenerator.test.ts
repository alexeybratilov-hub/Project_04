import { describe, it, expect } from 'vitest';
import { documentGenerator, resolveMasterRowMatch } from '../documentGenerator';
import { INITIAL_DATABASE_STATE } from '../../data/initialDatabase';
import { LegalEntityProfile, Row, Tab, Tag } from '../../types/database';

const TEST_PROFILE: LegalEntityProfile = {
  fullName: 'Общество с ограниченной ответственностью «Бета-Строй»',
  shortName: 'ООО «Бета-Строй»',
  inn: '7801234567',
  kpp: '780101001',
  ogrn: '1157800000123',
  okpo: '99887766',
  okved: '41.20',
  bankDetails: 'р/с 40702810900000000099',
  bankIn: 'Банк ВТБ',
  legalAddress: '190000, г. Санкт-Петербург, Невский пр., д. 1',
  email: 'ot@betastroy.ru',
  phone: '+7 (812) 000-00-01',
  directorFio: 'Кузнецов П. О.'
};

describe('documentGenerator', () => {
  it('resolves entity requisites and performs multi-column Master row lookup', () => {
    const masterTab: Tab = {
      id: 'm_staff',
      name: 'Штатное расписание',
      isMaster: true,
      columns: [
        { id: 'm_pos', name: 'Должность', type: 'text' },
        { id: 'm_dept', name: 'Подразделение', type: 'text' },
        { id: 'm_class', name: 'Класс СОУТ', type: 'text' }
      ],
      rows: [
        { id: 'mr1', m_pos: 'Инженер', m_dept: 'Офис', m_class: '2.0' },
        { id: 'mr2', m_pos: 'Инженер', m_dept: 'Цех 1', m_class: '3.1' }
      ],
      attachedDocs: []
    };

    const empTab: Tab = {
      id: 't_emp',
      name: 'Работники',
      columns: [
        { id: 'e_fio', name: 'ФИО', type: 'text' },
        {
          id: 'e_pos',
          name: 'Должность',
          type: 'relation',
          relation: { masterTabId: 'm_staff', masterColumnId: 'm_pos' }
        },
        {
          id: 'e_dept',
          name: 'Подразделение',
          type: 'relation',
          relation: { masterTabId: 'm_staff', masterColumnId: 'm_dept' }
        }
      ],
      rows: [],
      attachedDocs: []
    };

    const row: Row = {
      id: 'row_1',
      e_fio: 'Алексеев Д. Н.',
      e_pos: 'Инженер',
      e_dept: 'Цех 1'
    };

    const tags: Tag[] = [
      { id: 'tg1', name: '{ФИО}', tabId: 't_emp', columnId: 'e_fio' },
      { id: 'tg2', name: '{Класс_СОУТ}', tabId: 'm_staff', columnId: 'm_class' }
    ];

    const out = documentGenerator.resolveTemplateTags(
      '{Организация} (ИНН {ИНН}), дир. {Генеральный_директор}: {ФИО}, класс {Класс_СОУТ}',
      row,
      empTab,
      [masterTab, empTab],
      tags,
      TEST_PROFILE
    );

    expect(out).toBe(
      'ООО «Бета-Строй» (ИНН 7801234567), дир. Кузнецов П. О.: Алексеев Д. Н., класс 3.1'
    );
  });

  it('generates a valid PDF with embedded Cyrillic DejaVuSans font', async () => {
    const blob = await documentGenerator.generatePdf(
      'ПРИКАЗ № 1',
      'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «БЕТА-СТРОЙ»\nПровести вводный инструктаж по охране труда для работника Иванов Иван Иванович.'
    );

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(10_000); // Font bytes + PDF structure
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const header = new TextDecoder('ascii').decode(bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('resolves built-in templates with zero hardcoded Promtehservis defaults', () => {
    const entity = INITIAL_DATABASE_STATE.entities[0];
    const empTab = entity.tabs.find((t) => t.id === 'tab_employees')!;
    const row = empTab.rows[0];
    const template = entity.templates[0];
    const rendered = documentGenerator.resolveTemplateTags(
      template.contentTemplate,
      row,
      empTab,
      entity.tabs,
      entity.tags,
      TEST_PROFILE
    );
    expect(rendered).toContain('ООО «Бета-Строй»');
    expect(rendered).not.toContain('Промтехсервис');
  });

  it('T-25: never falls back to single-column match and reports not_found when full tuple disagrees', () => {
    const masterTab: Tab = {
      id: 'm_staff',
      name: 'Штатное расписание',
      isMaster: true,
      columns: [
        { id: 'm_pos', name: 'Должность', type: 'text' },
        { id: 'm_dept', name: 'Подразделение', type: 'text' },
        { id: 'm_class', name: 'Класс СОУТ', type: 'text' }
      ],
      rows: [
        { id: 'mr1', m_pos: 'Инженер', m_dept: 'Офис', m_class: '2.0' },
        { id: 'mr2', m_pos: 'Инженер', m_dept: 'Цех 1', m_class: '3.1' }
      ],
      attachedDocs: []
    };

    const empTab: Tab = {
      id: 't_emp',
      name: 'Работники',
      columns: [
        { id: 'e_fio', name: 'ФИО', type: 'text' },
        {
          id: 'e_pos',
          name: 'Должность',
          type: 'relation',
          relation: { masterTabId: 'm_staff', masterColumnId: 'm_pos' }
        },
        {
          id: 'e_dept',
          name: 'Подразделение',
          type: 'relation',
          relation: { masterTabId: 'm_staff', masterColumnId: 'm_dept' }
        }
      ],
      rows: [],
      attachedDocs: []
    };

    const tags: Tag[] = [
      { id: 'tg1', name: '{ФИО}', tabId: 't_emp', columnId: 'e_fio' },
      { id: 'tg2', name: '{Класс_СОУТ}', tabId: 'm_staff', columnId: 'm_class' }
    ];

    const mismatchRow: Row = {
      id: 'row_bad',
      e_fio: 'Алексеев Д. Н.',
      e_pos: 'Инженер',
      e_dept: 'Несуществующий цех'
    };

    const match = resolveMasterRowMatch(mismatchRow, empTab, masterTab);
    expect(match.status).toBe('not_found');

    const report = documentGenerator.resolveTemplateTagsWithReport(
      '{ФИО}: [{Класс_СОУТ}]',
      mismatchRow,
      empTab,
      [masterTab, empTab],
      tags,
      TEST_PROFILE
    );
    expect(report.text).toBe('Алексеев Д. Н.: []');
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].type).toBe('not_found');
  });

  it('T-25: refuses arbitrary Master selection on ambiguous matches (>1) and reports ambiguity', () => {
    const masterTab: Tab = {
      id: 'm_staff',
      name: 'Штатное расписание',
      isMaster: true,
      columns: [
        { id: 'm_pos', name: 'Должность', type: 'text' },
        { id: 'm_dept', name: 'Подразделение', type: 'text' },
        { id: 'm_class', name: 'Класс СОУТ', type: 'text' }
      ],
      rows: [
        { id: 'mr1', m_pos: 'Инженер', m_dept: 'Офис', m_class: '2.0' },
        { id: 'mr2', m_pos: 'Инженер', m_dept: 'Цех 1', m_class: '3.1' }
      ],
      attachedDocs: []
    };

    const medTab: Tab = {
      id: 't_med',
      name: 'Медосмотры',
      columns: [
        { id: 'med_fio', name: 'ФИО', type: 'text' },
        {
          id: 'med_pos',
          name: 'Должность',
          type: 'relation',
          relation: { masterTabId: 'm_staff', masterColumnId: 'm_pos' }
        }
      ],
      rows: [],
      attachedDocs: []
    };

    const tags: Tag[] = [
      { id: 'tg1', name: '{ФИО}', tabId: 't_med', columnId: 'med_fio' },
      { id: 'tg2', name: '{Класс_СОУТ}', tabId: 'm_staff', columnId: 'm_class' }
    ];

    const medRow: Row = { id: 'med1', med_fio: 'Петров', med_pos: '  инженер ' };
    const match = resolveMasterRowMatch(medRow, medTab, masterTab);
    expect(match.status).toBe('ambiguous');
    if (match.status === 'ambiguous') {
      expect(match.matches).toHaveLength(2);
    }

    const report = documentGenerator.resolveTemplateTagsWithReport(
      '{ФИО}: [{Класс_СОУТ}]',
      medRow,
      medTab,
      [masterTab, medTab],
      tags,
      TEST_PROFILE
    );
    expect(report.text).toBe('Петров: []');
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].type).toBe('ambiguous');
    expect(report.issues[0].matchCount).toBe(2);
  });

  it('T-25: renders tpl_med_referral with {Подразделение} instead of {Организация} and resolves all built-in templates cleanly', () => {
    const entity = INITIAL_DATABASE_STATE.entities[0];
    const medTpl = entity.templates.find((t) => t.id === 'tpl_med_referral')!;
    expect(medTpl.contentTemplate).toContain('- Структурное подразделение: {Подразделение}');

    const medTab = entity.tabs.find((t) => t.id === 'tab_med')!;
    const medReport = documentGenerator.resolveTemplateTagsWithReport(
      medTpl.contentTemplate,
      medTab.rows[0],
      medTab,
      entity.tabs,
      entity.tags,
      TEST_PROFILE
    );

    expect(medReport.issues).toHaveLength(0);
    expect(medReport.text).toContain('- Структурное подразделение: Производственный цех №1');
    expect(medReport.text).not.toContain('- Структурное подразделение: ООО «Бета-Строй»');

    // Verify all built-in templates render on row 0 of their bound tabs without relation issues
    entity.templates.forEach((tpl) => {
      const boundTab = entity.tabs.find((t) => t.id === tpl.tabId)!;
      expect(boundTab).toBeDefined();
      const res = documentGenerator.resolveTemplateTagsWithReport(
        tpl.contentTemplate,
        boundTab.rows[0],
        boundTab,
        entity.tabs,
        entity.tags,
        TEST_PROFILE
      );
      expect(res.issues).toEqual([]);
      expect(res.text).not.toMatch(/\{[А-Яа-яЁёA-Za-z0-9_]+\}/);
    });
  });
});
