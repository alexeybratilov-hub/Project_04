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
});
