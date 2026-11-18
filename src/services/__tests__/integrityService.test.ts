import { describe, it, expect } from 'vitest';
import { integrityService } from '../integrityService';
import { DocumentTemplate, Tab, Tag } from '../../types/database';

function makeSampleTabs(): { tabs: Tab[]; tags: Tag[] } {
  const masterTab: Tab = {
    id: 'tab_master',
    name: 'Штатное расписание',
    isMaster: true,
    columns: [
      { id: 'c_pos', name: 'Должность', type: 'text' },
      { id: 'c_dept', name: 'Подразделение', type: 'text' }
    ],
    rows: [
      { id: 'm1', c_pos: 'Сварщик', c_dept: 'Цех 1' },
      { id: 'm2', c_pos: 'Слесарь', c_dept: 'Цех 2' }
    ],
    attachedDocs: []
  };

  const childTab: Tab = {
    id: 'tab_emp',
    name: 'Работники',
    columns: [
      { id: 'e_fio', name: 'ФИО', type: 'text' },
      {
        id: 'e_pos',
        name: 'Должность',
        type: 'relation',
        relation: { masterTabId: 'tab_master', masterColumnId: 'c_pos' }
      }
    ],
    rows: [
      { id: 'r1', e_fio: 'Иванов', e_pos: 'Сварщик' },
      { id: 'r2', e_fio: 'Петров', e_pos: 'Несуществующая должность' }
    ],
    attachedDocs: []
  };

  const tags: Tag[] = [
    { id: 't1', name: '{ФИО}', tabId: 'tab_emp', columnId: 'e_fio' },
    { id: 't2', name: '{Должность}', tabId: 'tab_master', columnId: 'c_pos' }
  ];

  return { tabs: [masterTab, childTab], tags };
}

describe('integrityService', () => {
  it('audits broken relations, orphaned cell values, and broken tags accurately', () => {
    const { tabs, tags } = makeSampleTabs();
    const report = integrityService.auditIntegrity(tabs, tags);
    expect(report.brokenRelations).toHaveLength(0);
    expect(report.brokenTags).toHaveLength(0);
    expect(report.orphanedCells).toHaveLength(1);
    expect(report.orphanedCells[0].value).toBe('Несуществующая должность');
    expect(report.orphanedCells[0].rowNumber).toBe(2);
  });

  it('detects row delete impact on dependent tabs before Master row deletion', () => {
    const { tabs } = makeSampleTabs();
    const impact = integrityService.getRowDeleteImpact(tabs[0], ['m1'], tabs);
    expect(impact.totalAffectedRows).toBe(1);
    expect(impact.affectedTabs[0].tabName).toBe('Работники');
  });

  it('cleans dependent relations & tags safely after deleting a Master tab', () => {
    const { tabs, tags } = makeSampleTabs();
    const impact = integrityService.getTabDeleteImpact('tab_master', tabs, tags);
    expect(impact.affectedTabs).toHaveLength(1);
    expect(impact.affectedTagsCount).toBe(1);

    const remaining = tabs.filter((t) => t.id !== 'tab_master');
    const cleanedTabs = integrityService.cleanReferencesAfterTabDelete(remaining, 'tab_master');
    expect(cleanedTabs[0].columns[1].type).toBe('text');
    expect(cleanedTabs[0].columns[1].relation).toBeUndefined();
    expect(cleanedTabs[0].rows[0].e_pos).toBe('Сварщик'); // cell value preserved!

    const cleanedTags = integrityService.pruneOrphanedTags(tags, cleanedTabs);
    expect(cleanedTags).toHaveLength(1);
    expect(cleanedTags[0].id).toBe('t1');
  });

  it('cleans broken relations & tags when a Master column is removed', () => {
    const { tabs, tags } = makeSampleTabs();
    const updatedMasterCols = tabs[0].columns.filter((c) => c.id !== 'c_pos');
    const cleanedTabs = integrityService.cleanReferencesAfterColumnsUpdate(
      tabs,
      'tab_master',
      updatedMasterCols
    );
    const childPosCol = cleanedTabs[1].columns.find((c) => c.id === 'e_pos');
    expect(childPosCol?.type).toBe('text');
    expect(childPosCol?.relation).toBeUndefined();

    const cleanedTags = integrityService.pruneOrphanedTags(tags, cleanedTabs);
    expect(cleanedTags).toHaveLength(1);
  });

  it('recognizes built-in entity requisites tags as valid in getOrphanedTemplateTags', () => {
    const { tags } = makeSampleTabs();
    const templates: DocumentTemplate[] = [
      {
        id: 'tpl_1',
        name: 'Приказ',
        tabId: 'tab_emp',
        fileName: 'Приказ.docx',
        namingPattern: 'Приказ_{id}.docx',
        contentTemplate: '{Организация} ИНН {ИНН} работник {ФИО} и {Неизвестный_Тег}'
      }
    ];
    const orphaned = integrityService.getOrphanedTemplateTags(templates, tags);
    expect(orphaned).toEqual(['{Неизвестный_Тег}']);
  });

  it('tracks bound templates on tab delete and supports archive vs purge', () => {
    const { tabs, tags } = makeSampleTabs();
    const templates: DocumentTemplate[] = [
      {
        id: 'tpl_emp',
        name: 'Приказ по работнику',
        tabId: 'tab_emp',
        fileName: 'Order.docx',
        namingPattern: 'Order_{ФИО}.docx',
        contentTemplate: '{ФИО}'
      },
      {
        id: 'tpl_staff',
        name: 'Штатная карточка',
        tabId: 'tab_master',
        fileName: 'Staff.docx',
        namingPattern: 'Staff_{id}.docx',
        contentTemplate: '{Должность}'
      }
    ];

    const impact = integrityService.getTabDeleteImpact('tab_emp', tabs, tags, templates);
    expect(impact.affectedTemplatesCount).toBe(1);
    expect(impact.affectedTemplateNames).toEqual(['Приказ по работнику']);

    const archived = integrityService.archiveTabTemplates(templates, 'tab_emp', 'Работники');
    const archivedTpl = archived.find((t) => t.id === 'tpl_emp');
    expect(archivedTpl?.isArchived).toBe(true);
    expect(archivedTpl?.archivedFromTabName).toBe('Работники');
    expect(archived.find((t) => t.id === 'tpl_staff')?.isArchived).toBeUndefined();

    const purged = integrityService.deleteTabTemplates(templates, 'tab_emp');
    expect(purged).toHaveLength(1);
    expect(purged[0].id).toBe('tpl_staff');
  });

  it('T-25: cascades Master edits only across full identifying tuple and does not touch other Master rows sharing only the edited field', () => {
    const masterTab: Tab = {
      id: 'tab_positions',
      name: 'Штатное расписание',
      isMaster: true,
      columns: [
        { id: 'pos_title', name: 'Должность', type: 'text' },
        { id: 'pos_dept', name: 'Подразделение', type: 'text' }
      ],
      rows: [
        { id: 'm1', pos_title: 'Сварщик', pos_dept: 'Цех 1' },
        { id: 'm2', pos_title: 'Маляр', pos_dept: 'Цех 1' }
      ],
      attachedDocs: []
    };

    const empTab: Tab = {
      id: 'tab_employees',
      name: 'Работники',
      columns: [
        { id: 'emp_fio', name: 'ФИО', type: 'text' },
        {
          id: 'emp_pos',
          name: 'Должность',
          type: 'relation',
          relation: { masterTabId: 'tab_positions', masterColumnId: 'pos_title' }
        },
        {
          id: 'emp_dept',
          name: 'Подразделение',
          type: 'relation',
          relation: { masterTabId: 'tab_positions', masterColumnId: 'pos_dept' }
        }
      ],
      rows: [
        { id: 'e1', emp_fio: 'Иванов', emp_pos: 'Сварщик', emp_dept: 'Цех 1' },
        { id: 'e2', emp_fio: 'Петров', emp_pos: 'Маляр', emp_dept: 'Цех 1' }
      ],
      attachedDocs: []
    };

    // Rename dept on m1 (Сварщик) from 'Цех 1' to 'Цех 2'
    const res = integrityService.applyMasterRowCascade([masterTab, empTab], 'tab_positions', 'm1', {
      pos_dept: 'Цех 2'
    });

    expect(res.updatedRowsCount).toBe(1);
    expect(res.ambiguousItems).toHaveLength(0);
    expect(res.skippedIncompatibleCount).toBe(0);

    const nextEmpTab = res.tabs.find((t) => t.id === 'tab_employees')!;
    expect(nextEmpTab.rows.find((r) => r.id === 'e1')?.emp_dept).toBe('Цех 2');
    expect(nextEmpTab.rows.find((r) => r.id === 'e2')?.emp_dept).toBe('Цех 1');
  });

  it('T-25: refuses auto-cascade on ambiguous Master matches (>1) and preserves partial/duplicate dependent rows while updating unambiguous ones', () => {
    const masterTab: Tab = {
      id: 'tab_positions',
      name: 'Штатное расписание',
      isMaster: true,
      columns: [
        { id: 'pos_title', name: 'Должность', type: 'text' },
        { id: 'pos_dept', name: 'Подразделение', type: 'text' }
      ],
      rows: [
        { id: 'm1', pos_title: 'Инженер', pos_dept: 'Цех 1' },
        { id: 'm2', pos_title: 'Инженер', pos_dept: 'Офис' }
      ],
      attachedDocs: []
    };

    const empTab: Tab = {
      id: 'tab_employees',
      name: 'Работники',
      columns: [
        { id: 'emp_fio', name: 'ФИО', type: 'text' },
        {
          id: 'emp_pos',
          name: 'Должность',
          type: 'relation',
          relation: { masterTabId: 'tab_positions', masterColumnId: 'pos_title' }
        },
        {
          id: 'emp_dept',
          name: 'Подразделение',
          type: 'relation',
          relation: { masterTabId: 'tab_positions', masterColumnId: 'pos_dept' }
        }
      ],
      rows: [
        { id: 'e1', emp_fio: 'Иванов', emp_pos: 'Инженер', emp_dept: 'Цех 1' },
        { id: 'e2', emp_fio: 'Сидоров', emp_pos: 'Инженер', emp_dept: 'Офис' }
      ],
      attachedDocs: []
    };

    // Table with only 1-column link (like tab_med) cannot distinguish m1 vs m2
    const medTab: Tab = {
      id: 'tab_med',
      name: 'Медосмотры',
      columns: [
        { id: 'med_worker', name: 'ФИО', type: 'text' },
        {
          id: 'med_pos',
          name: 'Должность',
          type: 'relation',
          relation: { masterTabId: 'tab_positions', masterColumnId: 'pos_title' }
        }
      ],
      rows: [{ id: 'med1', med_worker: 'Иванов', med_pos: 'Инженер' }],
      attachedDocs: []
    };

    const res = integrityService.applyMasterRowCascade(
      [masterTab, empTab, medTab],
      'tab_positions',
      'm1',
      { pos_title: 'Ведущий инженер' }
    );

    expect(res.updatedRowsCount).toBe(1);
    expect(res.ambiguousItems).toHaveLength(1);
    expect(res.ambiguousItems[0].tabId).toBe('tab_med');
    expect(res.ambiguousItems[0].matchCount).toBe(2);

    const nextEmpTab = res.tabs.find((t) => t.id === 'tab_employees')!;
    expect(nextEmpTab.rows.find((r) => r.id === 'e1')?.emp_pos).toBe('Ведущий инженер');
    expect(nextEmpTab.rows.find((r) => r.id === 'e2')?.emp_pos).toBe('Инженер');

    const nextMedTab = res.tabs.find((t) => t.id === 'tab_med')!;
    expect(nextMedTab.rows[0].med_pos).toBe('Инженер');
  });

  it('T-25: skips incompatible dependent rows (0 full-tuple matches) and cascades unambiguous case/whitespace matches', () => {
    const masterTab: Tab = {
      id: 'tab_positions',
      name: 'Штатное расписание',
      isMaster: true,
      columns: [
        { id: 'pos_title', name: 'Должность', type: 'text' },
        { id: 'pos_dept', name: 'Подразделение', type: 'text' }
      ],
      rows: [{ id: 'm1', pos_title: 'Сварщик', pos_dept: 'Цех 1' }],
      attachedDocs: []
    };

    const empTab: Tab = {
      id: 'tab_employees',
      name: 'Работники',
      columns: [
        { id: 'emp_fio', name: 'ФИО', type: 'text' },
        {
          id: 'emp_pos',
          name: 'Должность',
          type: 'relation',
          relation: { masterTabId: 'tab_positions', masterColumnId: 'pos_title' }
        },
        {
          id: 'emp_dept',
          name: 'Подразделение',
          type: 'relation',
          relation: { masterTabId: 'tab_positions', masterColumnId: 'pos_dept' }
        }
      ],
      rows: [
        // Matches uniquely despite case/extra spaces
        { id: 'e_norm', emp_fio: 'Иванов', emp_pos: '  сварщик  ', emp_dept: ' цех   1 ' },
        // Contradictory: dept matches m1 ('Цех 1'), but pos does not exist in master
        { id: 'e_bad', emp_fio: 'Петров', emp_pos: 'Несуществующая', emp_dept: 'Цех 1' }
      ],
      attachedDocs: []
    };

    const res = integrityService.applyMasterRowCascade([masterTab, empTab], 'tab_positions', 'm1', {
      pos_dept: 'Цех 2'
    });

    expect(res.updatedRowsCount).toBe(1);
    expect(res.skippedIncompatibleCount).toBe(1);
    expect(res.ambiguousItems).toHaveLength(0);

    const nextEmpTab = res.tabs.find((t) => t.id === 'tab_employees')!;
    expect(nextEmpTab.rows.find((r) => r.id === 'e_norm')?.emp_dept).toBe('Цех 2');
    expect(nextEmpTab.rows.find((r) => r.id === 'e_bad')?.emp_dept).toBe('Цех 1');
  });

  it('T-26: detects templates referencing a tag before deletion via getTagDeleteImpact', () => {
    const templates: DocumentTemplate[] = [
      {
        id: 'tpl_1',
        name: 'Приказ по ОТ',
        tabId: 'tab_emp',
        fileName: 'order.docx',
        namingPattern: 'Приказ_{ФИО}.docx',
        contentTemplate: 'Направить {ФИО} на обучение'
      },
      {
        id: 'tpl_2',
        name: 'Архивный шаблон',
        tabId: '',
        isArchived: true,
        fileName: 'old.docx',
        namingPattern: 'Старый_{id}.docx',
        contentTemplate: 'СНИЛС: {СНИЛС}'
      }
    ];

    const usedInBody = integrityService.getTagDeleteImpact('{ФИО}', templates);
    expect(usedInBody.isUsed).toBe(true);
    expect(usedInBody.usedInTemplates).toHaveLength(1);
    expect(usedInBody.usedInTemplates[0].name).toBe('Приказ по ОТ');

    const usedArchived = integrityService.getTagDeleteImpact('{СНИЛС}', templates);
    expect(usedArchived.isUsed).toBe(true);
    expect(usedArchived.usedInTemplates[0].isArchived).toBe(true);

    const unused = integrityService.getTagDeleteImpact('{Табельный_номер}', templates);
    expect(unused.isUsed).toBe(false);
    expect(unused.usedInTemplates).toEqual([]);
  });
});
