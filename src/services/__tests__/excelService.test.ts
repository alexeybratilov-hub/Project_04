import { describe, it, expect } from 'vitest';
import { excelService } from '../excelService';
import { Tab } from '../../types/database';

const masterTab: Tab = {
  id: 'tab_staff',
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

const empTab: Tab = {
  id: 'tab_emp',
  name: 'Работники',
  columns: [
    { id: 'c_fio', name: 'ФИО', type: 'text' },
    {
      id: 'c_pos',
      name: 'Должность',
      type: 'relation',
      relation: { masterTabId: 'tab_staff', masterColumnId: 'c_pos' }
    },
    {
      id: 'c_dept',
      name: 'Подразделение',
      type: 'relation',
      relation: { masterTabId: 'tab_staff', masterColumnId: 'c_dept' }
    }
  ],
  rows: [],
  attachedDocs: []
};

describe('excelService', () => {
  it('parses bulk TSV with header row detection and maps columns cleanly', () => {
    const tsv = 'ФИО\tДолжность\tПодразделение\nИванов И.И.\tСварщик\tЦех 1';
    const parsed = excelService.parseBulkTextForTab(tsv, empTab);
    expect(parsed.hasHeaderRow).toBe(true);
    expect(parsed.rawRows).toHaveLength(1);
    expect(parsed.columnMapping['c_fio']).toBe('ФИО');
    expect(parsed.rawRows[0]['Должность']).toBe('Сварщик');
  });

  it('rejects missing Master values AND invalid multi-column tuple combinations', () => {
    const rows = [
      { ФИО: 'А', Должность: 'Сварщик', Подразделение: 'Цех 1' }, // valid tuple
      { ФИО: 'Б', Должность: 'Сварщик', Подразделение: 'Цех 2' }, // invalid tuple!
      { ФИО: 'В', Должность: 'Токарь', Подразделение: 'Цех 1' }    // missing value!
    ];
    const mapping = { c_fio: 'ФИО', c_pos: 'Должность', c_dept: 'Подразделение' };
    const errors = excelService.validateLinkedColumns(rows, mapping, empTab, [masterTab, empTab]);

    expect(errors.length).toBe(2);
    expect(errors.some((e) => e.rowNumber === 2)).toBe(true);
    expect(errors.some((e) => e.rowNumber === 3)).toBe(true);
  });

  it('does not misclassify whitespace-only CSV values as numbers when importing new sheet', async () => {
    const csvContent = 'Колонка А;Колонка Б\n   ;10\n   ;20\n';
    const file = new File([csvContent], 'sample.csv', { type: 'text/csv' });
    const sheets = await excelService.parseFile(file);
    const firstSheet = Object.values(sheets)[0];
    expect(firstSheet).toBeDefined();
    expect(firstSheet.rawRows).toHaveLength(2);
    expect(firstSheet.suggestedColumns.find((c) => c.name === 'Колонка А')?.type).toBe('text');
  });

  it('requires at least one named column before allowing inline Excel paste', () => {
    const emptyColTab: Tab = { id: 't_empty', name: 'Пустая', columns: [], rows: [], attachedDocs: [] };
    const res = excelService.parseInlineClipboardPaste('Иванов\nПетров', emptyColTab, [emptyColTab]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('столбец с наименованием');

    const unnamedColTab: Tab = {
      id: 't_unnamed',
      name: 'Без имени',
      columns: [{ id: 'c1', name: '   ', type: 'text' }],
      rows: [],
      attachedDocs: []
    };
    const res2 = excelService.parseInlineClipboardPaste('Иванов\nПетров', unnamedColTab, [unnamedColTab]);
    expect(res2.ok).toBe(false);
  });

  it('pastes a single copied Excel column into the clicked column', () => {
    const res = excelService.parseInlineClipboardPaste(
      'Иванов И.И.\nПетров П.П.\n',
      empTab,
      [masterTab, empTab],
      'c_fio'
    );
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('single_column');
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]['c_fio']).toBe('Иванов И.И.');
    expect(res.rows[1]['c_fio']).toBe('Петров П.П.');
    expect(res.rows[0]['c_pos']).toBe('');
  });

  it('allows partial multi-column paste into matching columns and rejects ONLY when copied columns exceed table columns', () => {
    // 2 columns starting from clicked column c_pos (positions 2 and 3) -> accepted!
    const partialByClickRes = excelService.parseInlineClipboardPaste(
      'Сварщик\tЦех 1\nСлесарь\tЦех 2',
      empTab,
      [masterTab, empTab],
      'c_pos'
    );
    expect(partialByClickRes.ok).toBe(true);
    expect(partialByClickRes.mode).toBe('partial_array');
    expect(partialByClickRes.rows).toHaveLength(2);
    expect(partialByClickRes.rows[0]['c_fio']).toBe('');
    expect(partialByClickRes.rows[0]['c_pos']).toBe('Сварщик');
    expect(partialByClickRes.rows[0]['c_dept']).toBe('Цех 1');

    // 2 columns with headers mapped by name even when non-adjacent or clicked elsewhere -> accepted!
    const partialWithHeaders = excelService.parseInlineClipboardPaste(
      'ФИО\tПодразделение\nПетров П.П.\tЦех 2',
      empTab,
      [masterTab, empTab],
      'c_fio'
    );
    expect(partialWithHeaders.ok).toBe(true);
    expect(partialWithHeaders.rows[0]['c_fio']).toBe('Петров П.П.');
    expect(partialWithHeaders.rows[0]['c_dept']).toBe('Цех 2');
    expect(partialWithHeaders.rows[0]['c_pos']).toBe('');

    // 4 columns into a 3-column tab (exceeds table columns!) -> rejected!
    const exceedRes = excelService.parseInlineClipboardPaste(
      'А\tБ\tВ\tЛишнее\nСидоров\tСварщик\tЦех 1\tExtra',
      empTab,
      [masterTab, empTab],
      'c_fio'
    );
    expect(exceedRes.ok).toBe(false);
    expect(exceedRes.error).toContain('Превышено количество столбцов');

    // Exact 3 columns matching all 3 tab columns + valid Master tuples -> accepted
    const validRes = excelService.parseInlineClipboardPaste(
      'Сидоров С.С.\tСварщик\tЦех 1\nКузнецов К.К.\tСлесарь\tЦех 2',
      empTab,
      [masterTab, empTab],
      'c_fio'
    );
    expect(validRes.ok).toBe(true);
    expect(validRes.mode).toBe('full_array');
    expect(validRes.rows).toHaveLength(2);
    expect(validRes.rows[0]['c_fio']).toBe('Сидоров С.С.');
    expect(validRes.rows[0]['c_pos']).toBe('Сварщик');
    expect(validRes.rows[0]['c_dept']).toBe('Цех 1');

    // Exact 3 columns with mismatched Master tuple -> rejected
    const invalidTupleRes = excelService.parseInlineClipboardPaste(
      'Сидоров С.С.\tСварщик\tЦех 2',
      empTab,
      [masterTab, empTab],
      'c_fio'
    );
    expect(invalidTupleRes.ok).toBe(false);
    expect(invalidTupleRes.discrepancies.length).toBeGreaterThan(0);
  });

  it('T-33: prioritizes exact normalized matches over substring matches and avoids duplicate header auto-mapping', () => {
    const tabCols = [
      { id: 'c_date', name: 'Дата', type: 'date' as const },
      { id: 'c_med', name: 'Дата медосмотра', type: 'date' as const },
      { id: 'c_fio', name: 'ФИО', type: 'text' as const },
      { id: 'c_note', name: 'Примечание', type: 'text' as const }
    ];
    const fileHeaders = ['Дата медосмотра', 'Дата', 'ФИО сотрудника', 'Примечание_1'];

    const mapping = excelService.autoMapColumns(tabCols, fileHeaders);
    expect(mapping['c_date']).toBe('Дата');
    expect(mapping['c_med']).toBe('Дата медосмотра');
    expect(mapping['c_fio']).toBe('ФИО сотрудника');
    expect(mapping['c_note']).toBe('Примечание_1');
    expect(new Set(Object.values(mapping)).size).toBe(4);
  });

  it('T-33: detects duplicate column mappings, duplicates against existing rows, and duplicates within Excel file', () => {
    const tabWithRows: Tab = {
      ...empTab,
      rows: [{ id: 'r1', c_fio: 'Иванов И.И.', c_pos: 'Сварщик', c_dept: 'Цех 1' }]
    };

    const rawRows = [
      { ФИО: 'иванов   и.и.', Должность: 'Сварщик', Подразделение: 'Цех 1' }, // dup of existing
      { ФИО: 'Петров П.П.', Должность: 'Слесарь', Подразделение: 'Цех 2' },   // unique
      { ФИО: 'Петров П.П.', Должность: 'Слесарь', Подразделение: 'Цех 2' }    // dup within file
    ];

    const dupAnalysis = excelService.analyzeImportDuplicates(
      rawRows,
      { c_fio: 'ФИО', c_pos: 'ФИО', c_dept: 'Подразделение' },
      tabWithRows,
      'existing',
      ['ФИО', 'Должность', 'Подразделение']
    );
    expect(dupAnalysis.duplicateColumnMappings).toHaveLength(1);
    expect(dupAnalysis.duplicateColumnMappings[0].fileHeader).toBe('ФИО');

    const rowDupAnalysis = excelService.analyzeImportDuplicates(
      rawRows,
      { c_fio: 'ФИО', c_pos: 'Должность', c_dept: 'Подразделение' },
      tabWithRows,
      'existing',
      ['ФИО', 'Должность', 'Подразделение']
    );
    expect(rowDupAnalysis.duplicateAgainstExistingIndices).toEqual([0]);
    expect(rowDupAnalysis.duplicateWithinFileIndices).toEqual([2]);
    expect(rowDupAnalysis.uniqueIndices).toEqual([1]);
  });

  it('T-46: exports and re-imports deadline_control via real .xlsx without losing actualDate, manualNextDate, note, or _rawOriginal', async () => {
    const { buildXlsxArrayBuffer } = await import('../ooxmlWorkbookService');

    const deadlineTab: Tab = {
      id: 'tab_dl',
      name: 'Контроль МО',
      columns: [
        { id: 'c_fio', name: 'ФИО', type: 'text' },
        {
          id: 'c_med',
          name: 'Медосмотр',
          type: 'deadline_control',
          deadlineConfig: {
            periodicityValue: 12,
            periodicityUnit: 'months',
            warningValue: 14,
            warningDayType: 'calendar'
          }
        },
        {
          id: 'c_once',
          name: 'Вводный инструктаж',
          type: 'deadline_control',
          deadlineConfig: {
            periodicityValue: 0,
            periodicityUnit: 'months',
            warningValue: 0,
            warningDayType: 'calendar'
          }
        }
      ],
      rows: [
        {
          id: 'r1',
          c_fio: 'Иванов',
          c_med: { actualDate: '2025-05-01' },
          c_once: { actualDate: '2025-01-15' }
        },
        {
          id: 'r2',
          c_fio: 'Петров',
          c_med: { actualDate: '2025-05-01', manualNextDate: '2026-04-20', note: 'Спецграфик | цех 2' },
          c_once: {}
        },
        {
          id: 'r3',
          c_fio: 'Сидоров',
          c_med: { manualNextDate: '2026-08-01' },
          c_once: { _rawOriginal: 'май 2025 (уточнить)' }
        }
      ],
      attachedDocs: []
    };

    const exportedRows = excelService.buildExportRowsForTab(deadlineTab, {
      todayIso: '2026-04-10'
    });
    expect(exportedRows[0]['Медосмотр']).toBe('План: 01.05.2026 (Запланировано) | Факт: 01.05.2025');
    expect(exportedRows[0]['Вводный инструктаж']).toBe('Выполнено: 15.01.2025');
    expect(exportedRows[1]['Медосмотр']).toBe(
      'План: 20.04.2026 (Скоро, ручн.) | Факт: 01.05.2025 | Прим.: Спецграфик | цех 2'
    );
    expect(exportedRows[1]['Вводный инструктаж']).toBe('');
    expect(exportedRows[2]['Медосмотр']).toBe('План: 01.08.2026 (Запланировано, ручн.)');
    expect(exportedRows[2]['Вводный инструктаж']).toBe('май 2025 (уточнить)');
    expect(JSON.stringify(exportedRows)).not.toContain('[object Object]');

    // Write real XLSX binary and re-parse with parseFile
    const xlsxBytes = buildXlsxArrayBuffer([{ name: 'Контроль МО', rows: exportedRows }]);
    const file = new File([xlsxBytes], 'roundtrip.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const parsedSheets = await excelService.parseFile(file);
    const sheet = parsedSheets['Контроль МО'];
    expect(sheet).toBeDefined();
    expect(sheet.rawRows).toHaveLength(3);

    const medCol = deadlineTab.columns[1];
    const onceCol = deadlineTab.columns[2];

    // Reconstruct DeadlineCellValue using normalizeImportedCellValue
    expect(excelService.normalizeImportedCellValue(medCol, sheet.rawRows[0]['Медосмотр'])).toEqual({
      actualDate: '2025-05-01'
    });
    expect(excelService.normalizeImportedCellValue(onceCol, sheet.rawRows[0]['Вводный инструктаж'])).toEqual({
      actualDate: '2025-01-15'
    });
    expect(excelService.normalizeImportedCellValue(medCol, sheet.rawRows[1]['Медосмотр'])).toEqual({
      actualDate: '2025-05-01',
      manualNextDate: '2026-04-20',
      note: 'Спецграфик | цех 2'
    });
    expect(excelService.normalizeImportedCellValue(onceCol, sheet.rawRows[1]['Вводный инструктаж'])).toEqual({});
    expect(excelService.normalizeImportedCellValue(medCol, sheet.rawRows[2]['Медосмотр'])).toEqual({
      manualNextDate: '2026-08-01'
    });
    expect(excelService.normalizeImportedCellValue(onceCol, sheet.rawRows[2]['Вводный инструктаж'])).toEqual({
      _rawOriginal: 'май 2025 (уточнить)'
    });

    // Duplicate detection must match existing DeadlineCellValue objects against exported strings
    const dupRes = excelService.analyzeImportDuplicates(
      sheet.rawRows,
      { c_fio: 'ФИО', c_med: 'Медосмотр', c_once: 'Вводный инструктаж' },
      deadlineTab,
      'existing',
      sheet.headers
    );
    expect(dupRes.duplicateAgainstExistingIndices).toEqual([0, 1, 2]);
    expect(dupRes.uniqueIndices).toEqual([]);
  });

  it('T-46: parses plain dates and structured clipboard paste for deadline_control columns', () => {
    const tabWithDeadline: Tab = {
      id: 't_dl_paste',
      name: 'Инструктажи',
      columns: [
        { id: 'c_fio', name: 'ФИО', type: 'text' },
        {
          id: 'c_dl',
          name: 'Срок проверки',
          type: 'deadline_control',
          deadlineConfig: {
            periodicityValue: 6,
            periodicityUnit: 'months',
            warningValue: 14,
            warningDayType: 'calendar'
          }
        }
      ],
      rows: [],
      attachedDocs: []
    };

    const pasteRes = excelService.parseInlineClipboardPaste(
      'ФИО\tСрок проверки\nИванов\t15.04.2025\nПетров\tПлан: 20.11.2026 (Запланировано, ручн.) | Факт: 01.05.2025\nСидоров\tвесна 2026',
      tabWithDeadline,
      [tabWithDeadline]
    );
    expect(pasteRes.ok).toBe(true);
    expect(pasteRes.rows).toHaveLength(3);
    expect(pasteRes.rows[0].c_dl).toEqual({ actualDate: '2025-04-15' });
    expect(pasteRes.rows[1].c_dl).toEqual({
      actualDate: '2025-05-01',
      manualNextDate: '2026-11-20'
    });
    expect(pasteRes.rows[2].c_dl).toEqual({ _rawOriginal: 'весна 2026' });
  });
});

describe('Регрессии аудита: целостность импорта и вставки', () => {
  it('не сдвигает календарный день при импорте Date-ячейки (локальная полночь)', async () => {
    const { buildXlsxArrayBuffer } = await import('../ooxmlWorkbookService');
    const buf = buildXlsxArrayBuffer([
      { name: 'Лист1', matrix: [['Дата приёма'], [new Date(2026, 1, 1)]] }
    ]);

    const parsed = await excelService.parseFile(new File([buf], 'dates.xlsx'));
    expect(parsed['Лист1'].rawRows).toHaveLength(1);
    expect(parsed['Лист1'].rawRows[0]['Дата приёма']).toBe('2026-02-01');
  });

  it('не сдвигает колонки при пустом заголовке и разводит дубли заголовков', async () => {
    const { buildXlsxArrayBuffer } = await import('../ooxmlWorkbookService');
    const buf = buildXlsxArrayBuffer([
      {
        name: 'Лист1',
        matrix: [
          ['ФИО', '', 'Должность', 'ФИО'],
          ['Иванов И.И.', 'служебное', 'Слесарь', 'Петров П.П.']
        ]
      }
    ]);

    const parsed = await excelService.parseFile(new File([buf], 'headers.xlsx'));
    const sheet = parsed['Лист1'];
    expect(sheet.headers).toEqual(['ФИО', 'Должность', 'ФИО (2)']);
    expect(sheet.rawRows[0]['ФИО']).toBe('Иванов И.И.');
    expect(sheet.rawRows[0]['Должность']).toBe('Слесарь');
    expect(sheet.rawRows[0]['ФИО (2)']).toBe('Петров П.П.');
  });

  it('строго проверяет типы столбцов вместо подстановки 0/false', () => {
    const boolCol = { id: 'c_bool', name: 'Проверка', type: 'boolean' as const };
    const numCol = { id: 'c_num', name: 'Количество', type: 'number' as const };
    const dateCol = { id: 'c_date', name: 'Дата', type: 'date' as const };

    expect(excelService.convertCellToColumnType(boolCol, 'нет')).toEqual({ ok: true, value: false });
    expect(excelService.convertCellToColumnType(boolCol, 'да')).toEqual({ ok: true, value: true });
    expect(excelService.convertCellToColumnType(boolCol, 'не требуется').ok).toBe(false);

    expect(excelService.convertCellToColumnType(numCol, '1 234,5')).toEqual({ ok: true, value: 1234.5 });
    expect(excelService.convertCellToColumnType(numCol, 'двенадцать').ok).toBe(false);

    expect(excelService.convertCellToColumnType(dateCol, '01.02.2026')).toEqual({ ok: true, value: '2026-02-01' });
    expect(excelService.convertCellToColumnType(dateCol, '32.13.2026').ok).toBe(false);

    expect(excelService.convertCellToColumnType(numCol, '')).toEqual({ ok: true, value: '' });
  });

  it('отклоняет вставку из Excel с нечисловым значением в числовой столбец', () => {
    const numTab: Tab = {
      id: 'tab_numbers',
      name: 'Числа',
      columns: [{ id: 'c_num', name: 'Количество', type: 'number' }],
      rows: [],
      attachedDocs: []
    };

    const res = excelService.parseInlineClipboardPaste('Количество\n12\nдвенадцать', numTab, [numTab]);

    expect(res.ok).toBe(false);
    expect(res.discrepancies).toHaveLength(1);
    expect(res.discrepancies[0].reason).toContain('не является числом');
    expect(res.discrepancies[0].rowNumber).toBe(2);
  });

  it('Item 4 + Item 6: блокирует __proto__ в заголовках XLSX и корректно выполняет импорт по пресету 1С:ЗУП с автосозданием должностей', async () => {
    const { buildXlsxArrayBuffer } = await import('../ooxmlWorkbookService');
    const { INITIAL_DATABASE_STATE } = await import('../../data/initialDatabase');

    const zupBuf = buildXlsxArrayBuffer([
      {
        name: 'Прием_1С',
        matrix: [
          ['Сотрудник', 'Таб. №', 'Должность (профессия)', 'Отдел', 'Дата приема на работу', '__proto__'],
          ['Ковалёв А. Б.', '0199', 'Электрогазосварщик', 'Монтажный участок', '10.03.2026', 'x']
        ]
      }
    ]);
    const parsed = await excelService.parseFile(new File([zupBuf], 'zup.xlsx'));
    const sheet = parsed['Прием_1С'];
    expect(sheet.headers).not.toContain('__proto__');
    expect(excelService.detectIsOneCZupHeaders(sheet.headers)).toBe(true);

    const entity = INITIAL_DATABASE_STATE.entities[0];
    const employeesTab = entity.tabs.find((t) => t.id === 'tab_employees')!;
    const mapping = excelService.autoMapOneCZupColumns(employeesTab.columns, sheet.headers);
    expect(mapping.emp_fio).toBe('Сотрудник');
    expect(mapping.emp_tab_num).toBe('Таб. №');
    expect(mapping.emp_pos).toBe('Должность (профессия)');
    expect(mapping.emp_dept).toBe('Отдел');
    expect(mapping.emp_hire_date).toBe('Дата приема на работу');

    const prepared = excelService.prepareOneCZupImport({
      rawRows: sheet.rawRows,
      columnMapping: mapping,
      employeesTab,
      allTabs: entity.tabs,
      autoCreatePositions: true
    });
    expect(prepared.ok).toBe(true);
    expect(prepared.createdPositions).toHaveLength(1);
    expect(prepared.createdPositions[0].pos_title).toBe('Электрогазосварщик');
    expect(prepared.createdPositions[0].pos_dept).toBe('Монтажный участок');
    expect(prepared.createdPositions[0].pos_sout_class).toBe('3.2 (вредный 2 ст.)');
    expect(prepared.createdPositions[0].pos_factors).toContain('сварочный аэрозоль');
    expect(prepared.createdPositions[0].pos_ppe_norm).toContain('Костюм сварщика');
    expect(prepared.employeeRows).toHaveLength(1);
    expect(prepared.employeeRows[0].emp_fio).toBe('Ковалёв А. Б.');
    expect(prepared.employeeRows[0].emp_pos).toBe('Электрогазосварщик');
    expect(prepared.employeeRows[0].emp_hire_date).toBe('2026-03-10');
  });
});
