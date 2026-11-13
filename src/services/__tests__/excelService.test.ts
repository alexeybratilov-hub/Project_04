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
});
