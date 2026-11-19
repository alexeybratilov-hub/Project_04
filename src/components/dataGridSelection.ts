import { Column, Row } from '../types/database';

export interface CellCoord {
  rowIndex: number;
  colIndex: number;
}

export type GridSelection =
  | {
      mode: 'cell' | 'range';
      anchor: CellCoord;
      focus: CellCoord;
    }
  | {
      mode: 'column';
      anchorColIndex: number;
      focusColIndex: number;
    };

export interface SelectionBounds {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
  rowCount: number;
  colCount: number;
  cellCount: number;
  anchorRow: number;
  anchorCol: number;
}

export function getSelectionBounds(
  selection: GridSelection | null,
  totalRows: number,
  totalCols: number
): SelectionBounds | null {
  if (!selection || totalCols <= 0) return null;

  if (selection.mode === 'column') {
    if (totalRows <= 0) return null;
    const c1 = Math.max(0, Math.min(totalCols - 1, selection.anchorColIndex));
    const c2 = Math.max(0, Math.min(totalCols - 1, selection.focusColIndex));
    const minCol = Math.min(c1, c2);
    const maxCol = Math.max(c1, c2);
    const colCount = maxCol - minCol + 1;
    return {
      minRow: 0,
      maxRow: totalRows - 1,
      minCol,
      maxCol,
      rowCount: totalRows,
      colCount,
      cellCount: totalRows * colCount,
      anchorRow: 0,
      anchorCol: c1
    };
  }

  if (totalRows <= 0) return null;
  const r1 = Math.max(0, Math.min(totalRows - 1, selection.anchor.rowIndex));
  const r2 = Math.max(0, Math.min(totalRows - 1, selection.focus.rowIndex));
  const c1 = Math.max(0, Math.min(totalCols - 1, selection.anchor.colIndex));
  const c2 = Math.max(0, Math.min(totalCols - 1, selection.focus.colIndex));

  const minRow = Math.min(r1, r2);
  const maxRow = Math.max(r1, r2);
  const minCol = Math.min(c1, c2);
  const maxCol = Math.max(c1, c2);
  const rowCount = maxRow - minRow + 1;
  const colCount = maxCol - minCol + 1;

  return {
    minRow,
    maxRow,
    minCol,
    maxCol,
    rowCount,
    colCount,
    cellCount: rowCount * colCount,
    anchorRow: r1,
    anchorCol: c1
  };
}

export function isColumnSelected(
  selection: GridSelection | null,
  colIndex: number,
  totalCols: number
): boolean {
  if (!selection || selection.mode !== 'column' || totalCols <= 0) return false;
  const minCol = Math.max(0, Math.min(selection.anchorColIndex, selection.focusColIndex));
  const maxCol = Math.min(totalCols - 1, Math.max(selection.anchorColIndex, selection.focusColIndex));
  return colIndex >= minCol && colIndex <= maxCol;
}

export function isCellInSelection(
  bounds: SelectionBounds | null,
  rowIndex: number,
  colIndex: number
): boolean {
  if (!bounds) return false;
  return (
    rowIndex >= bounds.minRow &&
    rowIndex <= bounds.maxRow &&
    colIndex >= bounds.minCol &&
    colIndex <= bounds.maxCol
  );
}

export function getCellPerimeterFlags(
  bounds: SelectionBounds | null,
  rowIndex: number,
  colIndex: number
): {
  selected: boolean;
  isAnchor: boolean;
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
} {
  if (!isCellInSelection(bounds, rowIndex, colIndex) || !bounds) {
    return {
      selected: false,
      isAnchor: false,
      top: false,
      bottom: false,
      left: false,
      right: false
    };
  }
  return {
    selected: true,
    isAnchor: rowIndex === bounds.anchorRow && colIndex === bounds.anchorCol,
    top: rowIndex === bounds.minRow,
    bottom: rowIndex === bounds.maxRow,
    left: colIndex === bounds.minCol,
    right: colIndex === bounds.maxCol
  };
}

export function formatCellValueForTsv(value: unknown, column: Column): string {
  if (column.type === 'boolean') {
    return value ? 'Да' : 'Нет';
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

export function escapeTsvCell(raw: string): string {
  if (/[\t\n\r"]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function buildTsvFromSelection(
  selection: GridSelection | null,
  rows: Row[],
  columns: Column[]
): { tsv: string; rowCount: number; colCount: number; cellCount: number } | null {
  const bounds = getSelectionBounds(selection, rows.length, columns.length);
  if (!bounds) return null;

  const lines: string[] = [];
  for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
    const row = rows[r];
    if (!row) continue;
    const cells: string[] = [];
    for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
      const col = columns[c];
      if (!col) continue;
      cells.push(escapeTsvCell(formatCellValueForTsv(row[col.id], col)));
    }
    lines.push(cells.join('\t'));
  }

  return {
    tsv: lines.join('\n'),
    rowCount: bounds.rowCount,
    colCount: bounds.colCount,
    cellCount: bounds.cellCount
  };
}

export function isCopyShortcutEvent(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
  key: string;
  code?: string;
}): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const k = (e.key || '').toLowerCase();
  return k === 'c' || k === 'с' || e.code === 'KeyC';
}
