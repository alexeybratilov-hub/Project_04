import type { GridSelection } from '../components/dataGridSelection';
import type { Column } from '../types/database';

export const SYSTEM_COLUMN_IDS = new Set([
  '__select',
  '__index',
  '__add',
  '__actions'
]);

export function isSystemColumnId(columnId: string): boolean {
  return SYSTEM_COLUMN_IDS.has(columnId);
}

/**
 * Given an item at `fromIndex` and a visual insertion slot `insertSlot` in `[0..length]`,
 * returns the destination index after removing the item from `fromIndex`,
 * or `null` if dropping at that slot produces no order change.
 */
export function calculateTargetIndexFromInsertSlot(
  fromIndex: number,
  insertSlot: number,
  length: number
): number | null {
  if (length <= 1 || fromIndex < 0 || fromIndex >= length) return null;
  const clampedSlot = Math.max(0, Math.min(length, insertSlot));
  if (clampedSlot === fromIndex || clampedSlot === fromIndex + 1) {
    return null;
  }
  return clampedSlot > fromIndex ? clampedSlot - 1 : clampedSlot;
}

export function reorderArray<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number
): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return [...items];
  next.splice(toIndex, 0, moved);
  return next;
}

export function reorderTabColumns(
  columns: readonly Column[],
  fromIndex: number,
  toIndex: number
): Column[] {
  const fromCol = columns[fromIndex];
  const toCol = columns[toIndex];
  if (!fromCol || !toCol) return [...columns];
  if (isSystemColumnId(fromCol.id) || isSystemColumnId(toCol.id)) {
    return [...columns];
  }
  return reorderArray(columns, fromIndex, toIndex);
}

export function remapColumnIndexAfterMove(
  colIndex: number,
  fromIndex: number,
  toIndex: number
): number {
  if (fromIndex === toIndex) return colIndex;
  if (colIndex === fromIndex) return toIndex;
  if (fromIndex < toIndex) {
    if (colIndex > fromIndex && colIndex <= toIndex) return colIndex - 1;
    return colIndex;
  }
  if (colIndex >= toIndex && colIndex < fromIndex) return colIndex + 1;
  return colIndex;
}

/**
 * Keep T-41 grid selection aligned with columns after reordering.
 * Single-cell, single-column vertical range, and single-column selection follow the moved column;
 * multi-column contiguous spans are shifted when unaffected or cleared if split.
 */
export function remapGridSelectionAfterColumnMove(
  selection: GridSelection | null,
  fromIndex: number,
  toIndex: number,
  totalCols: number
): GridSelection | null {
  if (!selection || fromIndex === toIndex || totalCols <= 0) return selection;

  if (selection.mode === 'column') {
    const minC = Math.min(selection.anchorColIndex, selection.focusColIndex);
    const maxC = Math.max(selection.anchorColIndex, selection.focusColIndex);
    if (minC === maxC) {
      const mapped = remapColumnIndexAfterMove(minC, fromIndex, toIndex);
      return { mode: 'column', anchorColIndex: mapped, focusColIndex: mapped };
    }
    if (
      (fromIndex < minC && toIndex < minC) ||
      (fromIndex > maxC && toIndex > maxC)
    ) {
      return selection;
    }
    if (fromIndex < minC && toIndex > maxC) {
      return {
        mode: 'column',
        anchorColIndex: selection.anchorColIndex - 1,
        focusColIndex: selection.focusColIndex - 1
      };
    }
    if (fromIndex > maxC && toIndex <= minC) {
      return {
        mode: 'column',
        anchorColIndex: selection.anchorColIndex + 1,
        focusColIndex: selection.focusColIndex + 1
      };
    }
    return null;
  }

  const minC = Math.min(selection.anchor.colIndex, selection.focus.colIndex);
  const maxC = Math.max(selection.anchor.colIndex, selection.focus.colIndex);
  if (minC === maxC) {
    const mapped = remapColumnIndexAfterMove(minC, fromIndex, toIndex);
    return {
      mode: selection.mode,
      anchor: { ...selection.anchor, colIndex: mapped },
      focus: { ...selection.focus, colIndex: mapped }
    };
  }

  if (
    (fromIndex < minC && toIndex < minC) ||
    (fromIndex > maxC && toIndex > maxC)
  ) {
    return selection;
  }
  if (fromIndex < minC && toIndex > maxC) {
    return {
      mode: selection.mode,
      anchor: { ...selection.anchor, colIndex: selection.anchor.colIndex - 1 },
      focus: { ...selection.focus, colIndex: selection.focus.colIndex - 1 }
    };
  }
  if (fromIndex > maxC && toIndex <= minC) {
    return {
      mode: selection.mode,
      anchor: { ...selection.anchor, colIndex: selection.anchor.colIndex + 1 },
      focus: { ...selection.focus, colIndex: selection.focus.colIndex + 1 }
    };
  }
  return null;
}
