import { describe, expect, it } from 'vitest';
import { Column, Row } from '../../types/database';
import {
  buildTsvFromSelection,
  escapeTsvCell,
  formatCellValueForTsv,
  getCellPerimeterFlags,
  getSelectionBounds,
  GridSelection,
  isCellInSelection,
  isColumnSelected,
  isCopyShortcutEvent
} from '../dataGridSelection';

const sampleColumns: Column[] = [
  { id: 'c_fio', name: 'ФИО', type: 'text' },
  { id: 'c_salary', name: 'Оклад', type: 'number' },
  { id: 'c_med', name: 'Медосмотр пройден', type: 'boolean' },
  { id: 'c_url', name: 'Протокол', type: 'link' }
];

const sampleRows: Row[] = [
  { id: 'r1', c_fio: 'Иванов Иван', c_salary: 82000, c_med: true, c_url: 'https://example.com/1' },
  { id: 'r2', c_fio: 'Петров Пётр', c_salary: 65000, c_med: false, c_url: '' },
  { id: 'r3', c_fio: 'Сидорова\nАнна', c_salary: 0, c_med: true, c_url: 'https://example.com/3' }
];

describe('dataGridSelection (T-41)', () => {
  it('computes bounds for a single cell selection', () => {
    const sel: GridSelection = {
      mode: 'cell',
      anchor: { rowIndex: 1, colIndex: 2 },
      focus: { rowIndex: 1, colIndex: 2 }
    };
    const bounds = getSelectionBounds(sel, sampleRows.length, sampleColumns.length);
    expect(bounds).toEqual({
      minRow: 1,
      maxRow: 1,
      minCol: 2,
      maxCol: 2,
      rowCount: 1,
      colCount: 1,
      cellCount: 1,
      anchorRow: 1,
      anchorCol: 2
    });
    expect(isCellInSelection(bounds, 1, 2)).toBe(true);
    expect(isCellInSelection(bounds, 0, 2)).toBe(false);
    expect(getCellPerimeterFlags(bounds, 1, 2)).toEqual({
      selected: true,
      isAnchor: true,
      top: true,
      bottom: true,
      left: true,
      right: true
    });
  });

  it('normalizes reversed drag range bounds and perimeter edge flags', () => {
    const sel: GridSelection = {
      mode: 'range',
      anchor: { rowIndex: 2, colIndex: 3 },
      focus: { rowIndex: 0, colIndex: 1 }
    };
    const bounds = getSelectionBounds(sel, sampleRows.length, sampleColumns.length);
    expect(bounds).toEqual({
      minRow: 0,
      maxRow: 2,
      minCol: 1,
      maxCol: 3,
      rowCount: 3,
      colCount: 3,
      cellCount: 9,
      anchorRow: 2,
      anchorCol: 3
    });
    // Interior cell has no outer border edges
    expect(getCellPerimeterFlags(bounds, 1, 2)).toEqual({
      selected: true,
      isAnchor: false,
      top: false,
      bottom: false,
      left: false,
      right: false
    });
    // Top-left corner of range
    expect(getCellPerimeterFlags(bounds, 0, 1)).toEqual({
      selected: true,
      isAnchor: false,
      top: true,
      bottom: false,
      left: true,
      right: false
    });
  });

  it('computes bounds and column highlight flags for whole-column and multi-column selection', () => {
    const singleCol: GridSelection = {
      mode: 'column',
      anchorColIndex: 1,
      focusColIndex: 1
    };
    expect(isColumnSelected(singleCol, 1, sampleColumns.length)).toBe(true);
    expect(isColumnSelected(singleCol, 0, sampleColumns.length)).toBe(false);

    const bounds = getSelectionBounds(singleCol, sampleRows.length, sampleColumns.length);
    expect(bounds).toEqual({
      minRow: 0,
      maxRow: 2,
      minCol: 1,
      maxCol: 1,
      rowCount: 3,
      colCount: 1,
      cellCount: 3,
      anchorRow: 0,
      anchorCol: 1
    });

    const multiCol: GridSelection = {
      mode: 'column',
      anchorColIndex: 2,
      focusColIndex: 0
    };
    expect(isColumnSelected(multiCol, 0, sampleColumns.length)).toBe(true);
    expect(isColumnSelected(multiCol, 1, sampleColumns.length)).toBe(true);
    expect(isColumnSelected(multiCol, 2, sampleColumns.length)).toBe(true);
    expect(isColumnSelected(multiCol, 3, sampleColumns.length)).toBe(false);
  });

  it('serializes single cell, rectangular range, and whole column to Excel-compatible TSV', () => {
    // Single cell
    const singleTsv = buildTsvFromSelection(
      { mode: 'cell', anchor: { rowIndex: 0, colIndex: 0 }, focus: { rowIndex: 0, colIndex: 0 } },
      sampleRows,
      sampleColumns
    );
    expect(singleTsv).toEqual({
      tsv: 'Иванов Иван',
      rowCount: 1,
      colCount: 1,
      cellCount: 1
    });

    // Range across text, raw number (no locale spaces), boolean ('Да'/'Нет')
    const rangeTsv = buildTsvFromSelection(
      { mode: 'range', anchor: { rowIndex: 0, colIndex: 0 }, focus: { rowIndex: 1, colIndex: 2 } },
      sampleRows,
      sampleColumns
    );
    expect(rangeTsv).toEqual({
      tsv: 'Иванов Иван\t82000\tДа\nПетров Пётр\t65000\tНет',
      rowCount: 2,
      colCount: 3,
      cellCount: 6
    });

    // Whole column including multi-line cell value (escaped in quotes for Excel)
    const colTsv = buildTsvFromSelection(
      { mode: 'column', anchorColIndex: 0, focusColIndex: 0 },
      sampleRows,
      sampleColumns
    );
    expect(colTsv).toEqual({
      tsv: 'Иванов Иван\nПетров Пётр\n"Сидорова\nАнна"',
      rowCount: 3,
      colCount: 1,
      cellCount: 3
    });
  });

  it('formats and escapes special TSV characters safely', () => {
    expect(formatCellValueForTsv(true, sampleColumns[2])).toBe('Да');
    expect(formatCellValueForTsv(false, sampleColumns[2])).toBe('Нет');
    expect(formatCellValueForTsv(0, sampleColumns[1])).toBe('0');
    expect(formatCellValueForTsv(undefined, sampleColumns[0])).toBe('');
    expect(escapeTsvCell('Простой текст')).toBe('Простой текст');
    expect(escapeTsvCell('Слово "в кавычках"')).toBe('"Слово ""в кавычках"""');
    expect(escapeTsvCell('А\tБ')).toBe('"А\tБ"');
  });

  it('recognizes Ctrl+C / Cmd+C in both English and Russian keyboard layouts', () => {
    expect(isCopyShortcutEvent({ ctrlKey: true, metaKey: false, key: 'c', code: 'KeyC' })).toBe(true);
    expect(isCopyShortcutEvent({ ctrlKey: true, metaKey: false, key: 'с', code: 'KeyC' })).toBe(true);
    expect(isCopyShortcutEvent({ ctrlKey: false, metaKey: true, key: 'c', code: 'KeyC' })).toBe(true);
    expect(isCopyShortcutEvent({ ctrlKey: true, metaKey: false, altKey: true, key: 'c', code: 'KeyC' })).toBe(false);
    expect(isCopyShortcutEvent({ ctrlKey: false, metaKey: false, key: 'c', code: 'KeyC' })).toBe(false);
  });
});
