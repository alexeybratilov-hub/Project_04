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

  it('T-44 + T-36: renders native DOCX template with relation lookup and isolates per-row batch errors without losing successful files', async () => {
    const { strFromU8, strToU8, unzipSync, zipSync } = await import('fflate');

    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>{Организация}: </w:t></w:r><w:r><w:t>{ФИ</w:t></w:r><w:r><w:t>О}</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Должность: {Должность} / СОУТ: {Класс_СОУТ}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body>
</w:document>`;

    const docxBuffer = new Uint8Array(
      zipSync({
        '[Content_Types].xml': strToU8('<Types/>'),
        'word/document.xml': strToU8(docXml)
      })
    ).buffer;

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
        { id: 'mr1', m_pos: 'Сварщик', m_dept: 'Цех 1', m_class: '3.2' }
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
      rows: [
        { id: 'r_ok_1', e_fio: 'Иванов И. И.', e_pos: 'Сварщик', e_dept: 'Цех 1' },
        { id: 'r_bad_rel', e_fio: 'Петров П. П.', e_pos: 'Сварщик', e_dept: 'Неверный цех' },
        { id: 'r_empty_fio', e_fio: '', e_pos: 'Сварщик', e_dept: 'Цех 1' },
        { id: 'r_ok_2', e_fio: 'Сидоров С. С.', e_pos: 'Сварщик', e_dept: 'Цех 1' }
      ],
      attachedDocs: []
    };

    const tags: Tag[] = [
      { id: 'tg1', name: '{ФИО}', tabId: 't_emp', columnId: 'e_fio' },
      { id: 'tg2', name: '{Должность}', tabId: 'm_staff', columnId: 'm_pos' },
      { id: 'tg3', name: '{Класс_СОУТ}', tabId: 'm_staff', columnId: 'm_class' }
    ];

    const template = {
      id: 'tpl_docx_1',
      name: 'Карточка DOCX',
      tabId: 't_emp',
      templateType: 'docx' as const,
      fileName: 'card.docx',
      namingPattern: 'Карточка_{ФИО}.docx',
      contentTemplate: 'preview'
    };

    const savedFiles: Array<{ fileName: string; blob: Blob }> = [];

    const report = await documentGenerator.executeBatchGeneration({
      template,
      format: 'docx',
      rowsToProcess: empTab.rows,
      boundTab: empTab,
      allTabs: [masterTab, empTab],
      tags,
      entityProfile: TEST_PROFILE,
      docxSourceBuffer: docxBuffer,
      onSaveDocument: async ({ fileName, blob }) => {
        savedFiles.push({ fileName, blob });
      }
    });

    expect(report.totalCount).toBe(4);
    expect(report.successCount).toBe(2);
    expect(report.errorCount).toBe(2);
    expect(savedFiles.map((f) => f.fileName)).toEqual([
      'Карточка_Иванов И. И..docx',
      'Карточка_Сидоров С. С..docx'
    ]);

    // Check first generated DOCX XML content (preserving separate runs + xml:space="preserve")
    const firstOutBuf = await savedFiles[0].blob.arrayBuffer();
    const firstDocFiles = unzipSync(new Uint8Array(firstOutBuf));
    const firstDocXml = strFromU8(firstDocFiles['word/document.xml']);
    expect(firstDocXml).toContain('<w:t xml:space="preserve">ООО «Бета-Строй»: </w:t>');
    expect(firstDocXml).toContain('<w:t>Иванов И. И.</w:t>');
    expect(firstDocXml).toContain('Должность: Сварщик / СОУТ: 3.2');
    const { docxTemplateService } = await import('../docxTemplateService');
    expect(docxTemplateService.inspectDocxTemplate(firstOutBuf).previewText).toContain(
      'ООО «Бета-Строй»: Иванов И. И.'
    );

    // Check detailed error report items
    expect(report.errors[0]).toMatchObject({
      rowNumber: 2,
      rowIdentifier: 'Петров П. П.',
      tagNames: expect.arrayContaining(['{Должность}', '{Класс_СОУТ}'])
    });
    expect(report.errors[0].reason).toContain('Штатное расписание');

    expect(report.errors[1]).toMatchObject({
      rowNumber: 3,
      tagNames: ['{ФИО}']
    });
    expect(report.errors[1].reason).toMatch(/Отсутствует значение/i);
  });

  it('T-36 + T-44: reports unknown tags, isolates unexpected save exceptions, and blocks PDF export for native DOCX templates', async () => {
    const { strToU8, zipSync } = await import('fflate');
    const docxBuffer = new Uint8Array(
      zipSync({
        'word/document.xml': strToU8(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{ФИО}</w:t></w:r></w:p></w:body></w:document>'
        )
      })
    ).buffer;

    const tab: Tab = {
      id: 't1',
      name: 'Работники',
      columns: [{ id: 'c1', name: 'ФИО', type: 'text' }],
      rows: [
        { id: 'r1', c1: 'Иванов' },
        { id: 'r2', c1: 'Петров' },
        { id: 'r3', c1: 'Сидоров' }
      ],
      attachedDocs: []
    };

    const tags: Tag[] = [{ id: 't_fio', name: '{ФИО}', tabId: 't1', columnId: 'c1' }];

    // 1. PDF must be rejected explicitly for templateType === 'docx'
    await expect(
      documentGenerator.executeBatchGeneration({
        template: {
          id: 'tpl_d',
          name: 'DOCX',
          tabId: 't1',
          templateType: 'docx',
          fileName: 'a.docx',
          namingPattern: '{ФИО}.docx',
          contentTemplate: ''
        },
        format: 'pdf',
        rowsToProcess: tab.rows,
        boundTab: tab,
        allTabs: [tab],
        tags,
        docxSourceBuffer: docxBuffer,
        onSaveDocument: async () => undefined
      })
    ).rejects.toThrow(/PDF не поддерживается/i);

    // 2. Unexpected save throw on row 2 must NOT abort row 3
    const savedNames: string[] = [];
    const ioReport = await documentGenerator.executeBatchGeneration({
      template: {
        id: 'tpl_d',
        name: 'DOCX',
        tabId: 't1',
        templateType: 'docx',
        fileName: 'a.docx',
        namingPattern: '{ФИО}.docx',
        contentTemplate: ''
      },
      format: 'docx',
      rowsToProcess: tab.rows,
      boundTab: tab,
      allTabs: [tab],
      tags,
      docxSourceBuffer: docxBuffer,
      onSaveDocument: async ({ row, fileName }) => {
        if (row.id === 'r2') throw new Error('Диск переполнен');
        savedNames.push(fileName);
      }
    });

    expect(ioReport.successCount).toBe(2);
    expect(ioReport.errorCount).toBe(1);
    expect(savedNames).toEqual(['Иванов.docx', 'Сидоров.docx']);
    expect(ioReport.errors[0]).toMatchObject({
      rowNumber: 2,
      rowIdentifier: 'Петров',
      reason: 'Диск переполнен'
    });

    // 3. Unknown tag in text template fails row cleanly with exact tag name
    const unknownTagReport = await documentGenerator.executeBatchGeneration({
      template: {
        id: 'tpl_txt',
        name: 'Текстовый',
        tabId: 't1',
        templateType: 'text',
        fileName: 't.docx',
        namingPattern: '{ФИО}.docx',
        contentTemplate: 'ФИО: {ФИО}, код: {Несуществующий_тег}'
      },
      format: 'docx',
      rowsToProcess: [tab.rows[0]],
      boundTab: tab,
      allTabs: [tab],
      tags,
      onSaveDocument: async () => undefined
    });
    expect(unknownTagReport.errorCount).toBe(1);
    expect(unknownTagReport.errors[0].tagNames).toEqual(['{Несуществующий_тег}']);
    expect(unknownTagReport.errors[0].reason).toContain('Неизвестные теги');
  });
});
