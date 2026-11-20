import { describe, expect, it } from 'vitest';
import { Column, DatabaseState } from '../../types/database';
import { INITIAL_DATABASE_STATE } from '../../data/initialDatabase';
import { normalizeDatabaseState } from '../../services/storageService';
import {
  calculateTargetIndexFromInsertSlot,
  isSystemColumnId,
  remapGridSelectionAfterColumnMove,
  reorderArray,
  reorderTabColumns
} from '../reorderUtils';

const sampleColumns: Column[] = [
  { id: 'c1', name: 'ФИО', type: 'text', width: 210 },
  { id: 'c2', name: 'Должность', type: 'text', width: 185 },
  { id: 'c3', name: 'Подразделение', type: 'text', width: 240 },
  { id: 'c4', name: 'Оклад', type: 'number', width: 130 }
];

describe('reorderUtils (T-42 + T-43)', () => {
  it('calculates target index from visual insert slot for start, middle, end, and no-op', () => {
    // 4 items: slots 0..4
    // Dragging index 2 to start (slot 0) -> toIndex 0
    expect(calculateTargetIndexFromInsertSlot(2, 0, 4)).toBe(0);
    // Dragging index 0 to middle (slot 2: between index 1 and 2) -> toIndex 1
    expect(calculateTargetIndexFromInsertSlot(0, 2, 4)).toBe(1);
    // Dragging index 0 to end (slot 4) -> toIndex 3
    expect(calculateTargetIndexFromInsertSlot(0, 4, 4)).toBe(3);
    // Dragging index 3 to middle (slot 1: between 0 and 1) -> toIndex 1
    expect(calculateTargetIndexFromInsertSlot(3, 1, 4)).toBe(1);
    // Dropping on same side of dragged item is a no-op
    expect(calculateTargetIndexFromInsertSlot(1, 1, 4)).toBeNull();
    expect(calculateTargetIndexFromInsertSlot(1, 2, 4)).toBeNull();
  });

  it('reorders columns to start, middle, and end while preserving column widths and metadata', () => {
    // Move end (c4) to start (0)
    const toStart = reorderTabColumns(sampleColumns, 3, 0);
    expect(toStart.map((c) => c.id)).toEqual(['c4', 'c1', 'c2', 'c3']);
    expect(toStart[0].width).toBe(130);

    // Move start (c1) to middle (2)
    const toMiddle = reorderTabColumns(sampleColumns, 0, 2);
    expect(toMiddle.map((c) => c.id)).toEqual(['c2', 'c3', 'c1', 'c4']);
    expect(toMiddle[2].width).toBe(210);

    // Move c2 (1) to end (3)
    const toEnd = reorderTabColumns(sampleColumns, 1, 3);
    expect(toEnd.map((c) => c.id)).toEqual(['c1', 'c3', 'c4', 'c2']);
    expect(toEnd[3].width).toBe(185);
  });

  it('blocks reordering of system columns', () => {
    expect(isSystemColumnId('__select')).toBe(true);
    expect(isSystemColumnId('__index')).toBe(true);
    expect(isSystemColumnId('__add')).toBe(true);
    expect(isSystemColumnId('__actions')).toBe(true);
    expect(isSystemColumnId('c1')).toBe(false);

    const withSystem: Column[] = [
      { id: '__select', name: '', type: 'text' },
      ...sampleColumns,
      { id: '__actions', name: 'Действ.', type: 'text' }
    ];
    expect(reorderTabColumns(withSystem, 0, 2).map((c) => c.id)).toEqual(
      withSystem.map((c) => c.id)
    );
    expect(reorderTabColumns(withSystem, 1, 5).map((c) => c.id)).toEqual(
      withSystem.map((c) => c.id)
    );
  });

  it('keeps T-41 cell and single-column selections attached after column reorder', () => {
    const singleCell = remapGridSelectionAfterColumnMove(
      { mode: 'cell', anchor: { rowIndex: 2, colIndex: 1 }, focus: { rowIndex: 2, colIndex: 1 } },
      1,
      3,
      4
    );
    expect(singleCell).toEqual({
      mode: 'cell',
      anchor: { rowIndex: 2, colIndex: 3 },
      focus: { rowIndex: 2, colIndex: 3 }
    });

    const singleCol = remapGridSelectionAfterColumnMove(
      { mode: 'column', anchorColIndex: 2, focusColIndex: 2 },
      3,
      0,
      4
    );
    expect(singleCol).toEqual({
      mode: 'column',
      anchorColIndex: 3,
      focusColIndex: 3
    });

    // Multi-column range shifts cleanly when an external column jumps across it
    const multiRange = remapGridSelectionAfterColumnMove(
      { mode: 'range', anchor: { rowIndex: 0, colIndex: 1 }, focus: { rowIndex: 2, colIndex: 2 } },
      0,
      3,
      4
    );
    expect(multiRange).toEqual({
      mode: 'range',
      anchor: { rowIndex: 0, colIndex: 0 },
      focus: { rowIndex: 2, colIndex: 1 }
    });
  });

  it('reorders tabs cleanly to start, middle, and end via reorderArray', () => {
    const tabIds = ['t1', 't2', 't3', 't4'];
    expect(reorderArray(tabIds, 3, 0)).toEqual(['t4', 't1', 't2', 't3']);
    expect(reorderArray(tabIds, 0, 2)).toEqual(['t2', 't3', 't1', 't4']);
    expect(reorderArray(tabIds, 1, 3)).toEqual(['t1', 't3', 't4', 't2']);
  });

  it('persists and restores reordered columns and tabs via normalizeDatabaseState round-trip', () => {
    const base = normalizeDatabaseState(INITIAL_DATABASE_STATE);
    const firstTab = base.tabs[0];
    const reorderedCols = reorderTabColumns(firstTab.columns, 0, firstTab.columns.length - 1);
    const reorderedTabs = reorderArray(
      base.tabs.map((t, i) => (i === 0 ? { ...t, columns: reorderedCols } : t)),
      0,
      base.tabs.length - 1
    );

    const updated: DatabaseState = {
      ...base,
      tabs: reorderedTabs,
      entities: base.entities.map((e) =>
        e.id === base.activeEntityId ? { ...e, tabs: reorderedTabs } : e
      )
    };
    const serialized = JSON.stringify(updated);
    const restored = normalizeDatabaseState(JSON.parse(serialized));
    const restoredMovedTab = restored.tabs[restored.tabs.length - 1];

    expect(restored.tabs.map((t) => t.id)).toEqual(reorderedTabs.map((t) => t.id));
    expect(restoredMovedTab.id).toBe(firstTab.id);
    expect(restoredMovedTab.columns.map((c) => c.id)).toEqual(reorderedCols.map((c) => c.id));
    expect(restoredMovedTab.columns.map((c) => c.width)).toEqual(reorderedCols.map((c) => c.width));
    // Row cell values remain bound by column ID after reorder
    const movedColId = firstTab.columns[0].id;
    expect(restoredMovedTab.rows[0][movedColId]).toBe(firstTab.rows[0][movedColId]);
  });
});
