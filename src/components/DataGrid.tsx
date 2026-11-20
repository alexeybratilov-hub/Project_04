import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Plus, Search, FileSpreadsheet, Download,
  Trash2, Link2, ExternalLink, ArrowUpDown, ArrowUp,
  ArrowDown, Check, BookOpen, FileText, Cpu,
  Columns, CheckSquare, Square, X, Edit2,
  AlertCircle, ChevronDown, ChevronLeft, ChevronRight, Rows3,
  Maximize2, Copy, GripVertical
} from 'lucide-react';
import { Column, ColumnType, DocumentTemplate, GridRowDensity, Row, Tab, Tag } from '../types/database';
import { ImportHintCard } from './ImportHintCard';
import { AppButton, AppModal, ConfirmDialog, StatusBanner, Z_INDEX } from './ui';
import { excelService, ValidationDiscrepancy } from '../services/excelService';
import {
  ColumnRenameImpact,
  createUniqueId,
  integrityService
} from '../services/integrityService';
import {
  buildTsvFromSelection,
  getCellPerimeterFlags,
  getSelectionBounds,
  GridSelection,
  isColumnSelected,
  isCopyShortcutEvent
} from './dataGridSelection';
import {
  calculateTargetIndexFromInsertSlot,
  isSystemColumnId,
  remapGridSelectionAfterColumnMove
} from '../utils/reorderUtils';

export const MIN_COLUMN_WIDTH = 88;
export const MAX_COLUMN_WIDTH = 800;
export const DEFAULT_COLUMN_WIDTH = 180;
export const NARROW_HEADER_BREAKPOINT = 120;

export function clampColumnWidth(width?: number): number {
  const raw =
    typeof width === 'number' && Number.isFinite(width) ? width : DEFAULT_COLUMN_WIDTH;
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(raw)));
}

function isLongCellValue(val: unknown): boolean {
  if (val === undefined || val === null) return false;
  const s = String(val);
  return s.length > 100 || s.includes('\n');
}

function formatSafeHref(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:')
  ) {
    return null;
  }
  if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) {
    return s;
  }
  if (/^[^\s]+\.[a-zа-яё0-9]{2,}(\/[^\s]*)?$/i.test(s) && !s.includes('\\')) {
    return `https://${s}`;
  }
  return null;
}

interface DataGridProps {
  currentTab: Tab;
  allTabs: Tab[];
  sharedNormativeCount?: number;
  tabTemplatesCount?: number;
  selectedRowIds?: Set<string>;
  onSelectedRowIdsChange?: (ids: Set<string>) => void;
  focusSearchSignal?: number;
  deleteSelectedSignal?: number;
  rowDensity?: GridRowDensity;
  onChangeRowDensity?: (density: GridRowDensity) => void;
  pageSize?: number;
  onChangePageSize?: (size: number) => void;
  onAddRow: () => void;
  onInsertBulkRows?: (rows: Row[], insertIndex?: number) => void;
  onUpdateCell: (rowId: string, columnId: string, value: any) => void;
  onUpdateRowMulti?: (rowId: string, patch: Record<string, any>) => void;
  onDeleteRows: (rowIds: string[]) => void;
  onOpenExcelImport: () => void;
  onExportExcel: () => void;
  onOpenColumnEditor: () => void;
  onOpenNormativeDocs: () => void;
  onOpenTemplates: (selectedRowIds?: string[]) => void;
  onOpenLLMStudio: (selectedRowId?: string) => void;
  onAttemptEditRelation: (column: Column, row: Row) => void;
  onAddColumn?: (column: Column) => void;
  onUpdateColumn?: (columnId: string, patch: Partial<Column>) => void;
  onReorderColumns?: (fromIndex: number, toIndex: number) => void;
  tags?: Tag[];
  templates?: DocumentTemplate[];
  highlightedRowId?: string | null;
}

interface InlinePasteAnchor {
  rowId: string | null;
  colId: string;
  insertIndex: number;
  label: string;
}

interface CascadeConflictState {
  rowId: string;
  targetColName: string;
  newValue: string;
  clearedFieldsSummary: string;
  patch: Record<string, any>;
}

interface ViewingCellState {
  rowId: string;
  colId: string;
  colName: string;
  colType: ColumnType;
  rowIndex: number;
  value: string;
}

export const DataGrid: React.FC<DataGridProps> = ({
  currentTab,
  allTabs,
  sharedNormativeCount,
  tabTemplatesCount = 0,
  selectedRowIds: controlledSelectedIds,
  onSelectedRowIdsChange,
  focusSearchSignal,
  deleteSelectedSignal,
  rowDensity: controlledRowDensity,
  onChangeRowDensity,
  pageSize: controlledPageSize,
  onChangePageSize,
  onAddRow,
  onInsertBulkRows,
  onUpdateCell,
  onUpdateRowMulti,
  onDeleteRows,
  onOpenExcelImport,
  onExportExcel,
  onOpenColumnEditor,
  onOpenNormativeDocs,
  onOpenTemplates,
  onOpenLLMStudio,
  onAttemptEditRelation,
  onAddColumn,
  onUpdateColumn,
  onReorderColumns,
  tags = [],
  templates = [],
  highlightedRowId
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set());
  const selectedRowIds = controlledSelectedIds ?? internalSelectedIds;

  const updateSelectedRowIds = (next: Set<string>) => {
    if (onSelectedRowIdsChange) {
      onSelectedRowIdsChange(next);
    } else {
      setInternalSelectedIds(next);
    }
  };

  const [sortColId, setSortColId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Inline editing state with Esc draft rollback
  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [draftValue, setDraftValue] = useState<any>('');
  const escapeCancelRef = useRef(false);

  // Full long-cell viewer modal
  const [viewingCell, setViewingCell] = useState<ViewingCellState | null>(null);
  const [copiedFullCell, setCopiedFullCell] = useState(false);

  // View density & Pagination (controlled via AppSettings with internal fallback)
  const [internalRowDensity, setInternalRowDensity] = useState<GridRowDensity>('compact');
  const rowDensity = controlledRowDensity ?? internalRowDensity;
  const updateRowDensity = (next: GridRowDensity) => {
    if (onChangeRowDensity) {
      onChangeRowDensity(next);
    } else {
      setInternalRowDensity(next);
    }
  };

  const [internalPageSize, setInternalPageSize] = useState<number>(100);
  const pageSize = controlledPageSize ?? internalPageSize;
  const updatePageSize = (next: number) => {
    if (onChangePageSize) {
      onChangePageSize(next);
    } else {
      setInternalPageSize(next);
    }
  };

  const [currentPage, setCurrentPage] = useState<number>(1);

  // Search ref for Ctrl+F focus
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Quick Add Column popup
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickColName, setQuickColName] = useState('');
  const [quickColType, setQuickColType] = useState<ColumnType>('text');
  const [quickColError, setQuickColError] = useState('');

  // Inline Column Header Rename
  const [renamingColId, setRenamingColId] = useState<string | null>(null);
  const [renamingColVal, setRenamingColVal] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [pendingRenameConfirm, setPendingRenameConfirm] = useState<{
    columnId: string;
    oldName: string;
    newName: string;
    impact: ColumnRenameImpact;
  } | null>(null);
  const suppressRenameBlurRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Column Width Resize Drag state (ref-backed to avoid listener churn and stale closures)
  const [resizingColId, setResizingColId] = useState<string | null>(null);
  const [previewWidths, setPreviewWidths] = useState<Record<string, number>>({});
  const resizeStartRef = useRef<{ startX: number; startWidth: number }>({ startX: 0, startWidth: 180 });
  const latestResizeWidthRef = useRef<number | null>(null);
  const onUpdateColumnRef = useRef(onUpdateColumn);
  onUpdateColumnRef.current = onUpdateColumn;

  // T-42: Column Drag-and-Drop Reorder state (mouse-backed on dedicated header grip)
  const [draggingColId, setDraggingColId] = useState<string | null>(null);
  const [colInsertSlot, setColInsertSlot] = useState<number | null>(null);
  const [isDraggingColumnArm, setIsDraggingColumnArm] = useState(false);
  const dragColMetaRef = useRef<{
    colId: string;
    fromIndex: number;
    startX: number;
    hasActivated: boolean;
  } | null>(null);
  const colInsertSlotRef = useRef<number | null>(null);
  const suppressNextSortClickRef = useRef(false);
  const columnsRef = useRef(currentTab.columns);
  columnsRef.current = currentTab.columns;
  const onReorderColumnsRef = useRef(onReorderColumns);
  onReorderColumnsRef.current = onReorderColumns;

  // Non-blocking row delete & cascade conflict confirmations
  const [confirmDeleteBulk, setConfirmDeleteBulk] = useState(false);
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(null);
  const [cascadeConflict, setCascadeConflict] = useState<CascadeConflictState | null>(null);

  // Direct Inline Excel Paste anchor & error alert state
  const [activeCellAnchor, setActiveCellAnchor] = useState<InlinePasteAnchor | null>(null);
  const [inlinePasteAlert, setInlinePasteAlert] = useState<{
    error: string;
    discrepancies: ValidationDiscrepancy[];
  } | null>(null);

  // T-41: Excel-like cell / range / column selection & clipboard state
  const [gridSelection, setGridSelection] = useState<GridSelection | null>(null);
  const [copiedFeedback, setCopiedFeedback] = useState<{
    cellCount: number;
    rowCount: number;
    colCount: number;
  } | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingSelectionRef = useRef(false);
  const lastCopyEventTsRef = useRef(0);
  const copyFeedbackTimerRef = useRef<number | null>(null);

  // Reset transient UI state when switching tabs
  useEffect(() => {
    updateSelectedRowIds(new Set());
    setConfirmDeleteBulk(false);
    setConfirmDeleteRowId(null);
    setRenamingColId(null);
    setRenamingColVal('');
    setRenameError(null);
    setPendingRenameConfirm(null);
    suppressRenameBlurRef.current = false;
    setEditingCell(null);
    setViewingCell(null);
    setCopiedFullCell(false);
    setIsQuickAddOpen(false);
    setCascadeConflict(null);
    setActiveCellAnchor(null);
    setInlinePasteAlert(null);
    setGridSelection(null);
    setCopiedFeedback(null);
    isDraggingSelectionRef.current = false;
    dragColMetaRef.current = null;
    colInsertSlotRef.current = null;
    suppressNextSortClickRef.current = false;
    setIsDraggingColumnArm(false);
    setDraggingColId(null);
    setColInsertSlot(null);
    setCurrentPage(1);
    setSortColId(null);
    setSearchQuery('');
  }, [currentTab.id]);

  // Reset to page 1 when search filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Clear cell range/column selection when filtering or sorting changes row positions
  useEffect(() => {
    setGridSelection(null);
    setCopiedFeedback(null);
  }, [searchQuery, sortColId, sortDir]);

  // End mouse range-selection drag reliably on window mouseup/blur
  useEffect(() => {
    const endSelectionDrag = () => {
      if (isDraggingSelectionRef.current) {
        isDraggingSelectionRef.current = false;
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mouseup', endSelectionDrag);
    window.addEventListener('blur', endSelectionDrag);
    return () => {
      window.removeEventListener('mouseup', endSelectionDrag);
      window.removeEventListener('blur', endSelectionDrag);
      document.body.style.userSelect = '';
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  // External Ctrl+F focus trigger
  useEffect(() => {
    if (focusSearchSignal && focusSearchSignal > 0) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [focusSearchSignal]);

  // External MenuBar "Delete selected rows" trigger
  useEffect(() => {
    if (deleteSelectedSignal && deleteSelectedSignal > 0 && selectedRowIds.size > 0) {
      setConfirmDeleteBulk(true);
    }
  }, [deleteSelectedSignal, selectedRowIds.size]);

  const executeInlineExcelPaste = (
    rawText: string,
    overrideAnchor?: InlinePasteAnchor | null
  ) => {
    const anchor = overrideAnchor ?? activeCellAnchor;
    const targetColId = anchor?.colId || currentTab.columns[0]?.id;
    const insertIndex =
      anchor !== null && anchor !== undefined
        ? Math.max(0, Math.min(currentTab.rows.length, anchor.insertIndex))
        : currentTab.rows.length;

    const result = excelService.parseInlineClipboardPaste(
      rawText,
      currentTab,
      allTabs,
      targetColId
    );

    if (!result.ok) {
      setInlinePasteAlert({
        error: result.error || 'Не удалось вставить данные из Excel.',
        discrepancies: result.discrepancies
      });
      return;
    }

    setInlinePasteAlert(null);
    if (onInsertBulkRows && result.rows.length > 0) {
      onInsertBulkRows(result.rows as Row[], insertIndex);
    }
  };

  const pasteHandlerRef = useRef(executeInlineExcelPaste);
  pasteHandlerRef.current = executeInlineExcelPaste;
  const activeAnchorRef = useRef(activeCellAnchor);
  activeAnchorRef.current = activeCellAnchor;

  // Global paste listener (Ctrl+V when anchored on grid or outside form inputs)
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }
      const text = e.clipboardData?.getData('text/plain') || '';
      if (!text.trim()) return;
      if (text.includes('\t') || text.includes('\n') || activeAnchorRef.current) {
        e.preventDefault();
        pasteHandlerRef.current(text);
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, []);

  // Esc closes QuickAdd / inline paste alert
  useEffect(() => {
    if (!isQuickAddOpen && !inlinePasteAlert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsQuickAddOpen(false);
        setInlinePasteAlert(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isQuickAddOpen, inlinePasteAlert]);

  // Mousemove / Mouseup handlers for Column Width Drag Resizing
  useEffect(() => {
    if (!resizingColId) return;

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const finishResize = () => {
      const finalWidth = latestResizeWidthRef.current;
      if (
        finalWidth !== null &&
        finalWidth !== resizeStartRef.current.startWidth &&
        onUpdateColumnRef.current
      ) {
        onUpdateColumnRef.current(resizingColId, { width: finalWidth });
      }
      latestResizeWidthRef.current = null;
      setResizingColId(null);
      setPreviewWidths({});
    };

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartRef.current.startX;
      const nextWidth = clampColumnWidth(resizeStartRef.current.startWidth + delta);
      latestResizeWidthRef.current = nextWidth;
      setPreviewWidths({ [resizingColId]: nextWidth });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', finishResize);
    window.addEventListener('blur', finishResize);
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', finishResize);
      window.removeEventListener('blur', finishResize);
    };
  }, [resizingColId]);

  const startResizeColumn = (e: React.MouseEvent, column: Column) => {
    e.preventDefault();
    e.stopPropagation();
    const curWidth = clampColumnWidth(column.width);
    resizeStartRef.current = { startX: e.clientX, startWidth: curWidth };
    latestResizeWidthRef.current = curWidth;
    setResizingColId(column.id);
    setPreviewWidths({ [column.id]: curWidth });
  };

  // T-42: Mousemove / Mouseup handlers for Column Drag-and-Drop Reordering
  useEffect(() => {
    if (!isDraggingColumnArm) return;

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const computeColInsertSlot = (clientX: number): number | null => {
      const container = gridContainerRef.current;
      if (!container) return null;
      const ths = Array.from(container.querySelectorAll<HTMLElement>('thead th[data-col-id]'));
      if (ths.length === 0) return null;
      for (let i = 0; i < ths.length; i++) {
        const rect = ths[i].getBoundingClientRect();
        if (clientX < rect.left + rect.width / 2) {
          return i;
        }
      }
      return ths.length;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const meta = dragColMetaRef.current;
      if (!meta) return;

      if (!meta.hasActivated) {
        if (Math.abs(e.clientX - meta.startX) < 4) return;
        meta.hasActivated = true;
        document.body.style.cursor = 'grabbing';
        setDraggingColId(meta.colId);
      }

      const nextSlot = computeColInsertSlot(e.clientX);
      if (nextSlot !== colInsertSlotRef.current) {
        colInsertSlotRef.current = nextSlot;
        setColInsertSlot(nextSlot);
      }
    };

    const finishColDrag = () => {
      const meta = dragColMetaRef.current;
      const slot = colInsertSlotRef.current;
      const totalCols = columnsRef.current.length;

      if (meta?.hasActivated) {
        suppressNextSortClickRef.current = true;
        window.setTimeout(() => {
          suppressNextSortClickRef.current = false;
        }, 0);

        if (slot !== null) {
          const targetIdx = calculateTargetIndexFromInsertSlot(
            meta.fromIndex,
            slot,
            totalCols
          );
          const targetCol = targetIdx !== null ? columnsRef.current[targetIdx] : undefined;
          if (
            targetIdx !== null &&
            targetCol &&
            !isSystemColumnId(meta.colId) &&
            !isSystemColumnId(targetCol.id)
          ) {
            onReorderColumnsRef.current?.(meta.fromIndex, targetIdx);
            setGridSelection((prev) =>
              remapGridSelectionAfterColumnMove(prev, meta.fromIndex, targetIdx, totalCols)
            );
          }
        }
      }

      dragColMetaRef.current = null;
      colInsertSlotRef.current = null;
      setIsDraggingColumnArm(false);
      setDraggingColId(null);
      setColInsertSlot(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', finishColDrag);
    window.addEventListener('blur', finishColDrag);
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', finishColDrag);
      window.removeEventListener('blur', finishColDrag);
    };
  }, [isDraggingColumnArm]);

  const startDragReorderColumn = (e: React.MouseEvent, column: Column, colIndex: number) => {
    if (e.button !== 0) return;
    if (isSystemColumnId(column.id) || renamingColId === column.id) return;
    if (currentTab.columns.length <= 1) return;
    e.preventDefault();
    e.stopPropagation();
    dragColMetaRef.current = {
      colId: column.id,
      fromIndex: colIndex,
      startX: e.clientX,
      hasActivated: false
    };
    colInsertSlotRef.current = null;
    setIsDraggingColumnArm(true);
  };

  const handleQuickAddColumn = () => {
    const trimmed = quickColName.trim();
    if (!trimmed) return;
    if (currentTab.columns.some((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      setQuickColError(`Столбец «${trimmed}» уже существует в этой таблице.`);
      return;
    }

    if (onAddColumn) {
      const newCol: Column = {
        id: createUniqueId('col'),
        name: trimmed,
        type: quickColType,
        width: 180,
        options: quickColType === 'select' ? ['Вариант 1', 'Вариант 2'] : undefined
      };
      onAddColumn(newCol);
    } else {
      onOpenColumnEditor();
    }
    setQuickColName('');
    setQuickColError('');
    setIsQuickAddOpen(false);
  };

  const startRenameHeader = (col: Column, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    suppressRenameBlurRef.current = false;
    setRenameError(null);
    setPendingRenameConfirm(null);
    setRenamingColId(col.id);
    setRenamingColVal(col.name);
  };

  const cancelRenameHeader = () => {
    suppressRenameBlurRef.current = true;
    setRenamingColId(null);
    setRenamingColVal('');
    setRenameError(null);
  };

  const attemptCommitRenameHeader = (col: Column, options?: { fromBlur?: boolean }) => {
    const validation = integrityService.validateColumnRename(
      currentTab.columns,
      col.id,
      renamingColVal
    );

    if (!validation.ok) {
      setRenameError(validation.message);
      if (options?.fromBlur) {
        setRenamingColId(null);
        setRenamingColVal('');
      } else {
        requestAnimationFrame(() => renameInputRef.current?.focus());
      }
      return;
    }

    if (validation.unchanged) {
      cancelRenameHeader();
      return;
    }

    const impact = integrityService.getColumnRenameImpact(
      currentTab.id,
      col.id,
      allTabs,
      tags,
      templates
    );

    if (impact.hasDependencies) {
      suppressRenameBlurRef.current = true;
      setRenameError(null);
      setPendingRenameConfirm({
        columnId: col.id,
        oldName: col.name,
        newName: validation.trimmed,
        impact
      });
      return;
    }

    suppressRenameBlurRef.current = true;
    if (onUpdateColumn) {
      onUpdateColumn(col.id, { name: validation.trimmed });
    }
    setRenamingColId(null);
    setRenamingColVal('');
    setRenameError(null);
  };

  const handleRenameBlur = (col: Column) => {
    if (suppressRenameBlurRef.current || pendingRenameConfirm) {
      suppressRenameBlurRef.current = false;
      return;
    }
    attemptCommitRenameHeader(col, { fromBlur: true });
  };

  // Precompute Master tab lookup maps for fast relation dropdowns & orphan detection
  const masterLookup = useMemo(() => {
    const map = new Map<
      string,
      {
        tab: Tab;
        uniqueByCol: Map<string, string[]>;
        valueSetByCol: Map<string, Set<string>>;
      }
    >();

    allTabs.forEach((tab) => {
      const uniqueByCol = new Map<string, string[]>();
      const valueSetByCol = new Map<string, Set<string>>();

      tab.columns.forEach((col) => {
        const vals: string[] = [];
        const seen = new Set<string>();
        const lowerSet = new Set<string>();

        tab.rows.forEach((r) => {
          const s = String(r[col.id] ?? '').trim();
          if (!s) return;
          lowerSet.add(s.toLowerCase());
          if (!seen.has(s)) {
            seen.add(s);
            vals.push(s);
          }
        });

        uniqueByCol.set(col.id, vals);
        valueSetByCol.set(col.id, lowerSet);
      });

      map.set(tab.id, { tab, uniqueByCol, valueSetByCol });
    });

    return map;
  }, [allTabs]);

  // Sibling relation columns sharing the same master table inside currentTab
  const siblingRelationColsByMaster = useMemo(() => {
    const byMaster = new Map<string, Column[]>();
    currentTab.columns.forEach((col) => {
      if (col.type === 'relation' && col.relation?.masterTabId) {
        const list = byMaster.get(col.relation.masterTabId) || [];
        list.push(col);
        byMaster.set(col.relation.masterTabId, list);
      }
    });
    return byMaster;
  }, [currentTab.columns]);

  // Filter and sort rows
  const filteredRows = useMemo(() => {
    let rows = currentTab.rows;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      rows = rows.filter((row) =>
        currentTab.columns.some((col) => {
          const val = row[col.id];
          return val !== undefined && val !== null && String(val).toLowerCase().includes(q);
        })
      );
    }

    if (sortColId) {
      rows = [...rows].sort((a, b) => {
        const valA = a[sortColId];
        const valB = b[sortColId];
        if (valA === valB) return 0;
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;

        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDir === 'asc' ? valA - valB : valB - valA;
        }
        const strA = String(valA).toLowerCase();
        const strB = String(valB).toLowerCase();
        if (strA < strB) return sortDir === 'asc' ? -1 : 1;
        return sortDir === 'asc' ? 1 : -1;
      });
    }

    return rows;
  }, [currentTab.rows, currentTab.columns, searchQuery, sortColId, sortDir]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageStartIdx = (safePage - 1) * pageSize;
  const visibleRows = useMemo(
    () => filteredRows.slice(pageStartIdx, pageStartIdx + pageSize),
    [filteredRows, pageStartIdx, pageSize]
  );

  // Auto-jump to page containing highlightedRowId & scroll into view
  useEffect(() => {
    if (!highlightedRowId) return;
    const idx = filteredRows.findIndex((r) => r.id === highlightedRowId);
    if (idx !== -1) {
      const targetPage = Math.floor(idx / pageSize) + 1;
      if (targetPage !== currentPage) {
        setCurrentPage(targetPage);
      }
      setTimeout(() => {
        const el = document.getElementById(`grid-row-${highlightedRowId}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
    }
  }, [highlightedRowId, filteredRows, pageSize]);

  const handleSort = (columnId: string) => {
    if (renamingColId === columnId) return;
    if (sortColId === columnId) {
      if (sortDir === 'asc') setSortDir('desc');
      else {
        setSortColId(null);
        setSortDir('asc');
      }
    } else {
      setSortColId(columnId);
      setSortDir('asc');
    }
  };

  const handleToggleSelectAll = () => {
    if (selectedRowIds.size === filteredRows.length && filteredRows.length > 0) {
      updateSelectedRowIds(new Set());
    } else {
      updateSelectedRowIds(new Set(filteredRows.map((r) => r.id)));
    }
  };

  const handleToggleRow = (rowId: string) => {
    const next = new Set(selectedRowIds);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    updateSelectedRowIds(next);
  };

  const focusGridContainer = () => {
    requestAnimationFrame(() => {
      gridContainerRef.current?.focus({ preventScroll: true });
    });
  };

  // Start inline edit with clean Esc rollback snapshot
  const beginInlineEdit = (row: Row, column: Column) => {
    escapeCancelRef.current = false;
    setEditingCell({ rowId: row.id, colId: column.id });
    setDraftValue(row[column.id] ?? '');
  };

  const commitInlineEdit = (
    rowId: string,
    col: Column,
    rawVal?: any,
    options?: { restoreFocus?: boolean }
  ) => {
    if (escapeCancelRef.current) {
      escapeCancelRef.current = false;
      setEditingCell(null);
      if (options?.restoreFocus) focusGridContainer();
      return;
    }
    const nextVal = rawVal !== undefined ? rawVal : draftValue;
    if (col.type === 'number') {
      const parsed = nextVal === '' ? '' : Number(nextVal);
      onUpdateCell(rowId, col.id, isNaN(parsed as number) ? '' : parsed);
    } else {
      onUpdateCell(rowId, col.id, nextVal);
    }
    setEditingCell(null);
    if (options?.restoreFocus) focusGridContainer();
  };

  const cancelInlineEdit = (options?: { restoreFocus?: boolean }) => {
    escapeCancelRef.current = true;
    setEditingCell(null);
    if (options?.restoreFocus) focusGridContainer();
  };

  const selectionBounds = useMemo(
    () => getSelectionBounds(gridSelection, filteredRows.length, currentTab.columns.length),
    [gridSelection, filteredRows.length, currentTab.columns.length]
  );

  const showCopyFeedback = (cellCount: number, rowCount: number, colCount: number) => {
    setCopiedFeedback({ cellCount, rowCount, colCount });
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopiedFeedback(null);
      copyFeedbackTimerRef.current = null;
    }, 2600);
  };

  const writeTsvWithFallback = (tsv: string): Promise<boolean> => {
    const execFallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = tsv;
        ta.setAttribute('readonly', 'true');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard
        .writeText(tsv)
        .then(() => true)
        .catch(() => execFallback());
    }
    return Promise.resolve(execFallback());
  };

  const copySelectionToClipboard = async () => {
    const built = buildTsvFromSelection(gridSelection, filteredRows, currentTab.columns);
    if (!built) return false;
    const ok = await writeTsvWithFallback(built.tsv);
    if (ok) {
      showCopyFeedback(built.cellCount, built.rowCount, built.colCount);
    }
    focusGridContainer();
    return ok;
  };

  const activateCellEditByCoord = (rowIndex: number, colIndex: number) => {
    const row = filteredRows[rowIndex];
    const col = currentTab.columns[colIndex];
    if (!row || !col) return;
    setAnchorForRowCell(row.id, col);
    if (col.type === 'boolean') {
      onUpdateCell(row.id, col.id, !Boolean(row[col.id]));
    } else if (col.type === 'relation') {
      setEditingCell({ rowId: row.id, colId: col.id });
    } else {
      beginInlineEdit(row, col);
    }
  };

  const handleCellMouseDown = (
    e: React.MouseEvent,
    rowIndex: number,
    row: Row,
    column: Column,
    colIndex: number
  ) => {
    if (e.button !== 0) return;
    if (editingCell?.rowId === row.id && editingCell?.colId === column.id) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('a, [data-cell-action="true"]')) return;

    setAnchorForRowCell(row.id, column);
    setCopiedFeedback(null);

    if (e.shiftKey && gridSelection) {
      e.preventDefault();
      const anchor =
        gridSelection.mode === 'column'
          ? { rowIndex: 0, colIndex: gridSelection.anchorColIndex }
          : gridSelection.anchor;
      setGridSelection({
        mode: anchor.rowIndex === rowIndex && anchor.colIndex === colIndex ? 'cell' : 'range',
        anchor,
        focus: { rowIndex, colIndex }
      });
    } else {
      isDraggingSelectionRef.current = true;
      document.body.style.userSelect = 'none';
      setGridSelection({
        mode: 'cell',
        anchor: { rowIndex, colIndex },
        focus: { rowIndex, colIndex }
      });
    }

    gridContainerRef.current?.focus({ preventScroll: true });
  };

  const handleCellMouseEnter = (rowIndex: number, colIndex: number) => {
    if (!isDraggingSelectionRef.current) return;
    setGridSelection((prev) => {
      if (!prev || prev.mode === 'column') return prev;
      if (prev.focus.rowIndex === rowIndex && prev.focus.colIndex === colIndex) return prev;
      return {
        mode:
          prev.anchor.rowIndex === rowIndex && prev.anchor.colIndex === colIndex
            ? 'cell'
            : 'range',
        anchor: prev.anchor,
        focus: { rowIndex, colIndex }
      };
    });
  };

  const handleCellDoubleClick = (e: React.MouseEvent, row: Row, column: Column) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('a, [data-cell-action="true"]')) return;
    setAnchorForRowCell(row.id, column);
    if (column.type === 'boolean') {
      onUpdateCell(row.id, column.id, !Boolean(row[column.id]));
    } else if (column.type === 'relation') {
      setEditingCell({ rowId: row.id, colId: column.id });
    } else {
      beginInlineEdit(row, column);
    }
  };

  const handleSelectColumn = (colIndex: number, shiftKey: boolean) => {
    const col = currentTab.columns[colIndex];
    if (!col) return;
    setCopiedFeedback(null);
    setGridSelection((prev) => {
      if (shiftKey && prev && prev.mode === 'column') {
        return {
          mode: 'column',
          anchorColIndex: prev.anchorColIndex,
          focusColIndex: colIndex
        };
      }
      return {
        mode: 'column',
        anchorColIndex: colIndex,
        focusColIndex: colIndex
      };
    });
    if (filteredRows[0]) {
      setAnchorForRowCell(filteredRows[0].id, col);
    }
    focusGridContainer();
  };

  // Global copy / Ctrl+C listener (runs cleanly when grid selection is active and no editor/modal is open)
  const copyBridgeRef = useRef<{
    gridSelection: GridSelection | null;
    filteredRows: Row[];
    columns: Column[];
    editingCell: { rowId: string; colId: string } | null;
    renamingColId: string | null;
    viewingCell: ViewingCellState | null;
    showCopyFeedback: (cellCount: number, rowCount: number, colCount: number) => void;
    writeTsvWithFallback: (tsv: string) => Promise<boolean>;
  }>({
    gridSelection,
    filteredRows,
    columns: currentTab.columns,
    editingCell,
    renamingColId,
    viewingCell,
    showCopyFeedback,
    writeTsvWithFallback
  });
  copyBridgeRef.current = {
    gridSelection,
    filteredRows,
    columns: currentTab.columns,
    editingCell,
    renamingColId,
    viewingCell,
    showCopyFeedback,
    writeTsvWithFallback
  };

  useEffect(() => {
    const canCopyFromGrid = (target: EventTarget | null) => {
      const state = copyBridgeRef.current;
      if (!state.gridSelection || state.editingCell || state.renamingColId || state.viewingCell) {
        return false;
      }
      if (document.querySelector('[role="dialog"]')) return false;
      const el = target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) {
        return false;
      }
      const nativeSel = window.getSelection()?.toString();
      if (nativeSel && nativeSel.length > 0) return false;
      return true;
    };

    const handleNativeCopy = (e: ClipboardEvent) => {
      if (!canCopyFromGrid(e.target)) return;
      const state = copyBridgeRef.current;
      const built = buildTsvFromSelection(state.gridSelection, state.filteredRows, state.columns);
      if (!built) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', built.tsv);
      lastCopyEventTsRef.current = performance.now();
      state.showCopyFeedback(built.cellCount, built.rowCount, built.colCount);
    };

    const handleWindowCopyKey = (e: KeyboardEvent) => {
      if (!isCopyShortcutEvent(e)) return;
      if (!canCopyFromGrid(e.target)) return;
      const state = copyBridgeRef.current;
      const built = buildTsvFromSelection(state.gridSelection, state.filteredRows, state.columns);
      if (!built) return;
      const triggerTs = performance.now();
      window.setTimeout(() => {
        if (lastCopyEventTsRef.current >= triggerTs - 5) return;
        state.writeTsvWithFallback(built.tsv).then((ok) => {
          if (ok) {
            state.showCopyFeedback(built.cellCount, built.rowCount, built.colCount);
          }
        });
      }, 0);
    };

    window.addEventListener('copy', handleNativeCopy);
    window.addEventListener('keydown', handleWindowCopyKey);
    return () => {
      window.removeEventListener('copy', handleNativeCopy);
      window.removeEventListener('keydown', handleWindowCopyKey);
    };
  }, []);

  const handleGridContainerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (editingCell || renamingColId || viewingCell) return;
    if (document.querySelector('[role="dialog"]')) return;

    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
      return;
    }

    if (e.key === 'Escape' && gridSelection) {
      e.preventDefault();
      setGridSelection(null);
      setCopiedFeedback(null);
      return;
    }

    if (!gridSelection || filteredRows.length === 0 || currentTab.columns.length === 0) return;

    if (e.key === 'F2') {
      e.preventDefault();
      const targetCoord =
        gridSelection.mode === 'column'
          ? { rowIndex: Math.min(pageStartIdx, filteredRows.length - 1), colIndex: gridSelection.anchorColIndex }
          : gridSelection.anchor;
      activateCellEditByCoord(targetCoord.rowIndex, targetCoord.colIndex);
      return;
    }

    if (e.key === 'Enter') {
      if (tag === 'button' || tag === 'a') return;
      e.preventDefault();
      const targetCoord =
        gridSelection.mode === 'column'
          ? { rowIndex: Math.min(pageStartIdx, filteredRows.length - 1), colIndex: gridSelection.anchorColIndex }
          : gridSelection.anchor;
      activateCellEditByCoord(targetCoord.rowIndex, targetCoord.colIndex);
      return;
    }

    if (e.key === ' ' && gridSelection.mode === 'cell') {
      if (tag === 'button' || tag === 'a') return;
      const col = currentTab.columns[gridSelection.anchor.colIndex];
      const row = filteredRows[gridSelection.anchor.rowIndex];
      if (col?.type === 'boolean' && row) {
        e.preventDefault();
        onUpdateCell(row.id, col.id, !Boolean(row[col.id]));
      }
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      if (tag === 'button' || tag === 'a') return;
      e.preventDefault();
      const maxRow = filteredRows.length - 1;
      const maxCol = currentTab.columns.length - 1;
      const baseAnchor =
        gridSelection.mode === 'column'
          ? { rowIndex: 0, colIndex: gridSelection.anchorColIndex }
          : gridSelection.anchor;
      const baseFocus =
        gridSelection.mode === 'column'
          ? { rowIndex: 0, colIndex: gridSelection.focusColIndex }
          : gridSelection.focus;

      const cur = e.shiftKey ? baseFocus : baseAnchor;
      let nextRow = cur.rowIndex;
      let nextCol = cur.colIndex;
      if (e.key === 'ArrowUp') nextRow = Math.max(0, cur.rowIndex - 1);
      if (e.key === 'ArrowDown') nextRow = Math.min(maxRow, cur.rowIndex + 1);
      if (e.key === 'ArrowLeft') nextCol = Math.max(0, cur.colIndex - 1);
      if (e.key === 'ArrowRight') nextCol = Math.min(maxCol, cur.colIndex + 1);

      const targetPage = Math.floor(nextRow / pageSize) + 1;
      if (targetPage !== safePage) {
        setCurrentPage(targetPage);
      }

      if (e.shiftKey) {
        setGridSelection({
          mode:
            baseAnchor.rowIndex === nextRow && baseAnchor.colIndex === nextCol ? 'cell' : 'range',
          anchor: baseAnchor,
          focus: { rowIndex: nextRow, colIndex: nextCol }
        });
      } else {
        setGridSelection({
          mode: 'cell',
          anchor: { rowIndex: nextRow, colIndex: nextCol },
          focus: { rowIndex: nextRow, colIndex: nextCol }
        });
        const nextRowObj = filteredRows[nextRow];
        const nextColObj = currentTab.columns[nextCol];
        if (nextRowObj && nextColObj) {
          setAnchorForRowCell(nextRowObj.id, nextColObj);
        }
      }
    }
  };

  // Fast memoized lookup for Master values (with cascading filter across sibling relation columns)
  const getRelationOptions = (column: Column, row?: Row): string[] => {
    if (column.type !== 'relation' || !column.relation) return [];
    const entry = masterLookup.get(column.relation.masterTabId);
    if (!entry) return [];

    const masterColId = column.relation.masterColumnId;
    const allSiblings = (siblingRelationColsByMaster.get(column.relation.masterTabId) || []).filter(
      (c) => c.id !== column.id
    );

    if (!row || allSiblings.length === 0) {
      return entry.uniqueByCol.get(masterColId) || [];
    }

    const filledSiblings = allSiblings.filter(
      (sib) =>
        row[sib.id] !== undefined &&
        row[sib.id] !== null &&
        String(row[sib.id]).trim() !== ''
    );

    if (filledSiblings.length === 0) {
      return entry.uniqueByCol.get(masterColId) || [];
    }

    const narrowedRows = entry.tab.rows.filter((mRow) =>
      filledSiblings.every(
        (sib) =>
          String(mRow[sib.relation!.masterColumnId] ?? '').trim().toLowerCase() ===
          String(row[sib.id] ?? '').trim().toLowerCase()
      )
    );

    if (narrowedRows.length === 0) {
      return entry.uniqueByCol.get(masterColId) || [];
    }

    const vals: string[] = [];
    const seen = new Set<string>();
    narrowedRows.forEach((r) => {
      const s = String(r[masterColId] ?? '').trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        vals.push(s);
      }
    });
    return vals;
  };

  // Check if a relation value exists in Master lookup
  const isRelationValueValid = (column: Column, value: any): boolean => {
    if (column.type !== 'relation' || !column.relation) return true;
    const str = String(value ?? '').trim();
    if (!str) return true;
    const entry = masterLookup.get(column.relation.masterTabId);
    if (!entry) return false;
    const set = entry.valueSetByCol.get(column.relation.masterColumnId);
    if (!set) return false;
    return set.has(str.toLowerCase());
  };

  // Linked cell change with safe cascade conflict confirmation instead of silent wipe
  const handleRelationCellChange = (row: Row, column: Column, newValue: string) => {
    setEditingCell(null);

    if (!column.relation) {
      onUpdateCell(row.id, column.id, newValue);
      return;
    }

    const entry = masterLookup.get(column.relation.masterTabId);
    const siblingCols = (siblingRelationColsByMaster.get(column.relation.masterTabId) || []).filter(
      (c) => c.id !== column.id
    );

    if (!entry || siblingCols.length === 0 || !onUpdateRowMulti) {
      onUpdateCell(row.id, column.id, newValue);
      return;
    }

    const patch: Record<string, any> = { [column.id]: newValue };
    const clearedSiblings: Array<{ colName: string; oldVal: string }> = [];
    const trimmedNew = newValue.trim().toLowerCase();

    if (trimmedNew !== '') {
      const matchingMasterRows = entry.tab.rows.filter(
        (mRow) => String(mRow[column.relation!.masterColumnId] ?? '').trim().toLowerCase() === trimmedNew
      );

      siblingCols.forEach((sib) => {
        const curSibVal = String(row[sib.id] ?? '').trim();
        const validSibValues = Array.from(
          new Set(
            matchingMasterRows
              .map((mr) => String(mr[sib.relation!.masterColumnId] ?? '').trim())
              .filter(Boolean)
          )
        );

        if (curSibVal === '') {
          if (validSibValues.length === 1) {
            patch[sib.id] = validSibValues[0];
          }
        } else {
          const isStillValid = validSibValues.some(
            (v) => v.toLowerCase() === curSibVal.toLowerCase()
          );
          if (!isStillValid) {
            patch[sib.id] = '';
            clearedSiblings.push({ colName: sib.name, oldVal: curSibVal });
          }
        }
      });
    }

    if (clearedSiblings.length > 0) {
      setCascadeConflict({
        rowId: row.id,
        targetColName: column.name,
        newValue: newValue || '(Пусто)',
        clearedFieldsSummary: clearedSiblings.map((s) => `«${s.colName}» («${s.oldVal}»)`).join(', '),
        patch
      });
      return;
    }

    onUpdateRowMulti(row.id, patch);
  };

  const setAnchorForRowCell = (rowId: string, col: Column) => {
    const realIdx = currentTab.rows.findIndex((r) => r.id === rowId);
    const insertIdx = realIdx >= 0 ? realIdx + 1 : currentTab.rows.length;
    setActiveCellAnchor({
      rowId,
      colId: col.id,
      insertIndex: insertIdx,
      label:
        realIdx >= 0
          ? `Вставка Ctrl+V в столбец «${col.name}» ниже строки #${realIdx + 1} (сдвинет нижние строки вниз)`
          : `Вставка Ctrl+V в столбец «${col.name}»`
    });
  };

  const handleCellTextareaPaste = (
    e: React.ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>,
    row: Row,
    col: Column
  ) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text.includes('\n') && !text.includes('\t')) {
      return; // single cell text -> let native paste edit this cell normally
    }
    e.preventDefault();
    e.stopPropagation();
    escapeCancelRef.current = true;
    setEditingCell(null);
    const realIdx = currentTab.rows.findIndex((r) => r.id === row.id);
    const anchor: InlinePasteAnchor = {
      rowId: row.id,
      colId: col.id,
      insertIndex: realIdx >= 0 ? realIdx + 1 : currentTab.rows.length,
      label: `Вставка ниже строки #${realIdx + 1}`
    };
    executeInlineExcelPaste(text, anchor);
  };

  const cellPadClass = rowDensity === 'compact' ? 'py-1' : 'py-2';

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Collapsible import format guide */}
      <ImportHintCard currentTab={currentTab} />

      {/* Grid Toolbar */}
      <div className="min-h-10 px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0 bg-white dark:bg-slate-900 text-xs">
        {/* Left: Search */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[180px] max-w-sm">
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={`Поиск в «${currentTab.name}»... (Ctrl+F)`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2.5 py-1 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 transition-colors"
            />
          </div>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0 cursor-pointer"
            >
              Сброс
            </button>
          )}
        </div>

        {/* Right: Actions + Density (labels always visible, wraps cleanly on narrow/scaled viewports) */}
        <div className="flex flex-wrap items-center gap-1.5 max-w-full">
          <button
            type="button"
            onClick={onAddRow}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-xs shadow-xs transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>Добавить запись</span>
          </button>

          <button
            type="button"
            onClick={onOpenExcelImport}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            title="Загрузка данных из Excel (.xlsx / .csv)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Импорт Excel</span>
          </button>

          <button
            type="button"
            onClick={onExportExcel}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            title="Выгрузить текущую вкладку в файл Excel (.xlsx)"
          >
            <Download className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span>Экспорт</span>
          </button>

          <button
            type="button"
            onClick={onOpenColumnEditor}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            title="Управление структурой столбцов, шириной, названиями и связями"
          >
            <Columns className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>Столбцы</span>
          </button>

          <button
            type="button"
            onClick={() => updateRowDensity(rowDensity === 'compact' ? 'normal' : 'compact')}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            title={rowDensity === 'compact' ? 'Плотность строк: Компактно (нажмите для обычной)' : 'Плотность строк: Обычная (нажмите для компактной)'}
          >
            <Rows3 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>{rowDensity === 'compact' ? 'Компактно' : 'Обычный'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenNormativeDocs}
            className="relative flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            title="Прикрепленные нормативные документы (ГОСТ / Приказы Минтруда)"
          >
            <BookOpen className="w-3.5 h-3.5 text-purple-600 shrink-0" />
            <span>Нормативы</span>
            {(sharedNormativeCount ?? currentTab.attachedDocs.length) > 0 && (
              <span className="text-[11px] text-purple-700 dark:text-purple-300 font-mono tabular-nums font-semibold">
                · {sharedNormativeCount ?? currentTab.attachedDocs.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onOpenTemplates(selectedRowIds.size > 0 ? Array.from(selectedRowIds) : undefined)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            title="Шаблоны, привязанные к этой таблице (DOCX и PDF)"
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span>Шаблоны</span>
            {tabTemplatesCount > 0 && (
              <span className="text-[11px] font-mono tabular-nums font-semibold opacity-80">
                · {tabTemplatesCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Inline Paste Error Banner */}
      {inlinePasteAlert && (
        <div className="px-4 py-2.5 bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-800 text-xs text-red-900 dark:text-red-200 shrink-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              <span>{inlinePasteAlert.error}</span>
            </div>
            <button
              type="button"
              onClick={() => setInlinePasteAlert(null)}
              className="p-0.5 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 rounded cursor-pointer"
              title="Закрыть предупреждение"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {inlinePasteAlert.discrepancies.length > 0 && (
            <div className="pl-6 space-y-0.5 max-h-28 overflow-y-auto text-[11px] font-mono">
              {inlinePasteAlert.discrepancies.slice(0, 8).map((d, idx) => (
                <div key={idx}>
                  Строка {d.rowNumber}: {d.reason || `несовпадение в «${d.columnName}» (${String(d.value)})`}
                </div>
              ))}
              {inlinePasteAlert.discrepancies.length > 8 && (
                <div className="italic">...и ещё {inlinePasteAlert.discrepancies.length - 8} расхождений.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Inline Column Rename Validation Error Banner */}
      {renameError && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-950/60 border-b border-red-200 dark:border-red-900">
          <StatusBanner variant="error" role="alert" compact>
            <div className="flex items-center justify-between gap-3">
              <span>{renameError}</span>
              <button
                type="button"
                onClick={() => setRenameError(null)}
                className="p-0.5 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 rounded cursor-pointer shrink-0"
                title="Закрыть предупреждение"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </StatusBanner>
        </div>
      )}

      {/* Selected Rows Action Banner */}
      {selectedRowIds.size > 0 && (
        <div className="px-4 py-2 bg-blue-50 dark:bg-blue-950/40 border-b border-blue-100 dark:border-blue-900/40 flex flex-wrap items-center justify-between gap-2 text-xs animate-in fade-in-50 duration-100">
          <span className="text-blue-900 dark:text-blue-200 font-medium">
            Выбрано строк: <strong className="font-mono tabular-nums">{selectedRowIds.size}</strong> из {currentTab.rows.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenTemplates(Array.from(selectedRowIds))}
              className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
            >
              <FileText className="w-3 h-3" />
              <span>Шаблоны ({selectedRowIds.size})</span>
            </button>

            {confirmDeleteBulk ? (
              <div className="flex items-center gap-1.5 bg-red-100 dark:bg-red-950 px-2 py-1 rounded border border-red-300 dark:border-red-800">
                <span className="text-red-800 dark:text-red-200 font-medium">Удалить {selectedRowIds.size} строк?</span>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteRows(Array.from(selectedRowIds));
                    updateSelectedRowIds(new Set());
                    setConfirmDeleteBulk(false);
                  }}
                  className="px-2 py-0.5 bg-red-600 text-white rounded font-semibold hover:bg-red-700"
                >
                  Да
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteBulk(false)}
                  className="px-2 py-0.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded"
                >
                  Нет
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDeleteBulk(true)}
                className="flex items-center gap-1 px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-950 dark:text-red-300 rounded font-medium transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                <span>Удалить выбранные</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                updateSelectedRowIds(new Set());
                setConfirmDeleteBulk(false);
              }}
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 ml-1"
            >
              Снять выбор
            </button>
          </div>
        </div>
      )}

      {/* Cell / Range / Column Selection Status Bar */}
      {(selectionBounds || copiedFeedback) && (
        <div
          data-testid="grid-selection-bar"
          className="px-4 py-1.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] shrink-0"
        >
          <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300">
            {selectionBounds && (
              <>
                <span className="font-medium text-blue-700 dark:text-blue-300">
                  {gridSelection?.mode === 'column'
                    ? selectionBounds.colCount === 1
                      ? `Выделен столбец «${currentTab.columns[selectionBounds.minCol]?.name}» (${selectionBounds.rowCount} яч.)`
                      : `Выделены столбцы: ${selectionBounds.colCount} (${selectionBounds.cellCount} яч.)`
                    : selectionBounds.cellCount === 1
                      ? `Выделена ячейка: «${currentTab.columns[selectionBounds.minCol]?.name}», строка #${selectionBounds.minRow + 1}`
                      : `Выделен диапазон: ${selectionBounds.rowCount} × ${selectionBounds.colCount} (${selectionBounds.cellCount} яч.)`}
                </span>
                <span className="text-slate-400 hidden sm:inline">
                  · Двойной клик / F2 / Enter — редактировать · Ctrl+C — копировать (TSV)
                </span>
              </>
            )}
            {copiedFeedback && (
              <span
                role="status"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-medium border border-emerald-200 dark:border-emerald-800"
              >
                <Check className="w-3 h-3" />
                Скопировано в буфер (TSV): {copiedFeedback.cellCount} яч.
              </span>
            )}
          </div>
          {selectionBounds && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  copySelectionToClipboard();
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-blue-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium cursor-pointer transition-colors"
                title="Скопировать выделение в буфер обмена в формате TSV для Excel (Ctrl+C)"
              >
                <Copy className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                <span>Копировать TSV</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setGridSelection(null);
                  setCopiedFeedback(null);
                }}
                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                Сбросить
              </button>
            </div>
          )}
        </div>
      )}

      {/* Table Canvas */}
      <div
        ref={gridContainerRef}
        tabIndex={0}
        onKeyDown={handleGridContainerKeyDown}
        className="flex-1 overflow-auto bg-white dark:bg-slate-900 focus:outline-hidden"
      >
        {(() => {
          const totalColsWidth =
            34 +
            38 +
            currentTab.columns.reduce(
              (sum, c) => sum + clampColumnWidth(previewWidths[c.id] ?? c.width),
              0
            ) +
            34 +
            82;
          return (
            <table
              style={{ width: totalColsWidth }}
              className="table-fixed border-collapse text-left text-xs border-r border-slate-200/80 dark:border-slate-800"
            >
              <colgroup>
                <col style={{ width: 34 }} />
                <col style={{ width: 38 }} />
                {currentTab.columns.map((column) => {
                  const colWidth = clampColumnWidth(previewWidths[column.id] ?? column.width);
                  return <col key={column.id} style={{ width: colWidth }} />;
                })}
                <col style={{ width: 34 }} />
                <col style={{ width: 82 }} />
              </colgroup>

              {/* Table Header */}
              <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold z-20 border-b border-slate-300/80 dark:border-slate-700 select-none">
                <tr>
                  {/* Sticky Select All Checkbox */}
                  <th className="sticky left-0 z-30 bg-slate-100 dark:bg-slate-800 w-[34px] px-1.5 py-1.5 text-center border-r border-slate-200 dark:border-slate-700/80 align-middle">
                    <button
                      type="button"
                      onClick={handleToggleSelectAll}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 inline-flex items-center justify-center"
                      title="Выбрать все отфильтрованные строки"
                    >
                      {selectedRowIds.size === filteredRows.length && filteredRows.length > 0 ? (
                        <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </th>

                  {/* Sticky Row Number */}
                  <th className="sticky left-[34px] z-30 bg-slate-100 dark:bg-slate-800 w-[38px] px-1 py-1.5 text-center text-slate-400 font-mono tabular-nums text-[11px] border-r border-slate-200 dark:border-slate-700/80 align-middle">
                    #
                  </th>

                  {/* Dynamic Columns */}
                  {currentTab.columns.map((column, colIndex) => {
                    const isSorted = sortColId === column.id;
                    const isRelation = column.type === 'relation';
                    const colWidth = clampColumnWidth(previewWidths[column.id] ?? column.width);
                    const isNarrowHeader = colWidth < NARROW_HEADER_BREAKPOINT;
                    const isRenaming = renamingColId === column.id;
                    const isDraggingCol = draggingColId === column.id;
                    const draggedColIdx = draggingColId
                      ? currentTab.columns.findIndex((c) => c.id === draggingColId)
                      : -1;
                    const effectiveColTarget =
                      colInsertSlot !== null && draggedColIdx !== -1
                        ? calculateTargetIndexFromInsertSlot(
                            draggedColIdx,
                            colInsertSlot,
                            currentTab.columns.length
                          )
                        : null;
                    const showInsertBefore =
                      effectiveColTarget !== null && colInsertSlot === colIndex;
                    const showInsertAfterLast =
                      effectiveColTarget !== null &&
                      colIndex === currentTab.columns.length - 1 &&
                      colInsertSlot === currentTab.columns.length;
                    const colSelected = isColumnSelected(
                      gridSelection,
                      colIndex,
                      currentTab.columns.length
                    );

                    return (
                      <th
                        key={column.id}
                        data-col-id={column.id}
                        data-col-selected={colSelected ? 'true' : undefined}
                        style={{ width: colWidth, maxWidth: colWidth }}
                        className={`group/th relative overflow-hidden pt-3 pb-1.5 px-1.5 border-r border-slate-200 dark:border-slate-700/80 cursor-pointer transition-colors align-top ${
                          isDraggingCol
                            ? 'opacity-60 bg-blue-50/80 dark:bg-blue-950/50'
                            : colSelected
                              ? 'bg-blue-100/90 dark:bg-blue-900/50 text-blue-900 dark:text-blue-100 shadow-[inset_0_-2px_0_0_#2563eb]'
                              : 'hover:bg-slate-200/70 dark:hover:bg-slate-700/70'
                        }`}
                        onClick={() => {
                          if (!isRenaming && !suppressNextSortClickRef.current) {
                            handleSort(column.id);
                          }
                        }}
                        title={column.name}
                      >
                        {showInsertBefore && (
                          <span
                            data-testid="col-drop-indicator"
                            aria-hidden="true"
                            className="pointer-events-none absolute left-0 top-0 bottom-0 w-[3px] bg-blue-600 dark:bg-blue-400 shadow-[0_0_6px_rgba(37,99,235,0.45)] z-30"
                          />
                        )}
                        {showInsertAfterLast && (
                          <span
                            data-testid="col-drop-indicator"
                            aria-hidden="true"
                            className="pointer-events-none absolute right-0 top-0 bottom-0 w-[3px] bg-blue-600 dark:bg-blue-400 shadow-[0_0_6px_rgba(37,99,235,0.45)] z-30"
                          />
                        )}

                        {/* Dedicated Excel-style whole-column selector bar (does not trigger sort or rename) */}
                        <button
                          type="button"
                          data-testid={`select-column-${column.id}`}
                          aria-label={`Выделить столбец ${column.name}`}
                          title={`Выделить весь столбец «${column.name}» (Shift+клик — диапазон столбцов)`}
                          onMouseDown={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectColumn(colIndex, e.shiftKey);
                          }}
                          className={`absolute top-0 left-0 right-1.5 h-2.5 flex items-center justify-center transition-colors cursor-pointer z-10 focus:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-600 ${
                            colSelected
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-200/60 dark:bg-slate-700/50 hover:bg-blue-500/80 text-slate-400 hover:text-white'
                          }`}
                        >
                          <span className="w-5 h-0.5 rounded-full bg-current opacity-80" />
                        </button>

                        <div
                          className={`flex items-start justify-between ${
                            isNarrowHeader ? 'gap-0.5 pr-1' : 'gap-1 pr-1.5'
                          } w-full min-w-0 max-w-full overflow-hidden`}
                        >
                          <div
                            className={`flex items-start ${
                              isNarrowHeader ? 'gap-0.5' : 'gap-1'
                            } min-w-0 flex-1 overflow-hidden`}
                          >
                            {!isRenaming &&
                              !isSystemColumnId(column.id) &&
                              currentTab.columns.length > 1 && (
                                <button
                                  type="button"
                                  data-testid={`drag-column-${column.id}`}
                                  aria-label={`Переместить столбец ${column.name}`}
                                  title={`Перетащите за ручку, чтобы изменить порядок столбца «${column.name}»`}
                                  onMouseDown={(e) => startDragReorderColumn(e, column, colIndex)}
                                  onClick={(e) => e.stopPropagation()}
                                  onDoubleClick={(e) => e.stopPropagation()}
                                  className={`shrink-0 mt-0.5 p-0.5 -ml-0.5 rounded cursor-grab active:cursor-grabbing transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-600 ${
                                    isDraggingCol
                                      ? 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50'
                                      : 'text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-200/80 dark:hover:bg-slate-700/80 opacity-65 group-hover/th:opacity-100'
                                  }`}
                                >
                                  <GripVertical className="w-3 h-3" />
                                </button>
                              )}
                            {isRelation && (
                              <span
                                title="Связанный столбец с мастер-таблицей"
                                className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5"
                              >
                                <Link2 className="w-3 h-3" />
                              </span>
                            )}
                            {isRenaming ? (
                              <input
                                ref={renameInputRef}
                                type="text"
                                aria-label="Новое название столбца"
                                aria-invalid={Boolean(renameError)}
                                value={renamingColVal}
                                onChange={(e) => {
                                  setRenamingColVal(e.target.value);
                                  if (renameError) setRenameError(null);
                                }}
                                onBlur={() => handleRenameBlur(column)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    attemptCommitRenameHeader(column);
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    cancelRenameHeader();
                                  }
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                                className={`w-full min-w-0 px-1.5 py-0.5 bg-white dark:bg-slate-900 border rounded text-xs font-semibold text-slate-900 dark:text-white outline-hidden ${
                                  renameError
                                    ? 'border-red-500 ring-1 ring-red-500/40'
                                    : 'border-blue-500'
                                }`}
                              />
                            ) : (
                              <div
                                onDoubleClick={(e) => startRenameHeader(column, e)}
                                className="min-w-0 flex-1 overflow-hidden"
                                title={`${column.name} (двойной клик для переименования)`}
                              >
                                <span className="line-clamp-3 whitespace-normal break-words [overflow-wrap:anywhere] leading-[1.25] text-[11.5px]">
                                  {column.name}
                                </span>
                              </div>
                            )}
                          </div>

                          {!isRenaming && (
                            <div
                              className={`shrink-0 text-slate-400 mt-0.5 ${
                                isNarrowHeader
                                  ? 'flex flex-col items-center gap-0.5 w-3.5'
                                  : 'flex items-center gap-0.5'
                              }`}
                            >
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => startRenameHeader(column, e)}
                                className="opacity-0 group-hover/th:opacity-100 group-focus-within/th:opacity-100 focus-visible:opacity-100 p-0.5 hover:text-blue-600 rounded transition-opacity cursor-pointer"
                                title="Переименовать столбец"
                                aria-label={`Переименовать столбец ${column.name}`}
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <span
                                className="inline-flex items-center justify-center shrink-0"
                                aria-hidden="true"
                              >
                                {isSorted ? (
                                  sortDir === 'asc' ? (
                                    <ArrowUp className="w-3 h-3 text-blue-600" />
                                  ) : (
                                    <ArrowDown className="w-3 h-3 text-blue-600" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3 h-3 opacity-0 group-hover/th:opacity-60" />
                                )}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Drag handle */}
                        <div
                          onMouseDown={(e) => startResizeColumn(e, column)}
                          onClick={(e) => e.stopPropagation()}
                          className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500 active:bg-blue-600 transition-colors z-10 ${
                            resizingColId === column.id ? 'bg-blue-600' : ''
                          }`}
                          title={`Ширина: ${colWidth} px (потяните мышкой для изменения)`}
                        />
                      </th>
                    );
                  })}

                  {/* Quick Add Column Header */}
                  <th className="w-[34px] px-1 py-1.5 text-center border-r border-slate-200 dark:border-slate-700/80 bg-slate-100/60 dark:bg-slate-800/60 relative align-middle">
                    <button
                      type="button"
                      onClick={() => {
                        setQuickColError('');
                        setIsQuickAddOpen(!isQuickAddOpen);
                      }}
                      className="p-1 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors inline-flex items-center justify-center cursor-pointer"
                      title="Быстро добавить новый столбец в таблицу"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>

                    {isQuickAddOpen && (
                      <div
                        className={`fixed sm:absolute top-28 sm:top-full right-4 sm:right-0 mt-1 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-3 text-left font-normal ${Z_INDEX.popover} animate-in fade-in zoom-in-95 duration-100 ring-1 ring-black/10`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between mb-2 pb-1 border-b border-slate-100 dark:border-slate-800">
                          <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                            Новый столбец
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsQuickAddOpen(false)}
                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {quickColError && (
                          <div className="mb-2 p-1.5 bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 rounded text-[11px]">
                            {quickColError}
                          </div>
                        )}

                        <div className="space-y-2 text-xs">
                          <div>
                            <label className="block text-[10px] text-slate-500 mb-0.5">Название:</label>
                            <input
                              type="text"
                              placeholder="Например: Стаж работы"
                              value={quickColName}
                              onChange={(e) => {
                                setQuickColName(e.target.value);
                                setQuickColError('');
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleQuickAddColumn();
                                if (e.key === 'Escape') setIsQuickAddOpen(false);
                              }}
                              autoFocus
                              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-xs text-slate-900 dark:text-white outline-hidden focus:ring-1 focus:ring-blue-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] text-slate-500 mb-0.5">Тип данных:</label>
                            <select
                              value={quickColType}
                              onChange={(e) => setQuickColType(e.target.value as ColumnType)}
                              className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-xs text-slate-900 dark:text-white"
                            >
                              <option value="text">Текст</option>
                              <option value="number">Число</option>
                              <option value="date">Дата</option>
                              <option value="select">Выпадающий список</option>
                              <option value="boolean">Да / Нет (флаг)</option>
                              <option value="link">Ссылка (URL)</option>
                              <option value="relation">Связь со справочником</option>
                            </select>
                          </div>

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={handleQuickAddColumn}
                              disabled={!quickColName.trim()}
                              className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded font-medium text-xs transition-colors cursor-pointer"
                            >
                              Создать
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setIsQuickAddOpen(false);
                                onOpenColumnEditor();
                              }}
                              className="px-2 py-1.5 text-[10px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer"
                              title="Открыть расширенный редактор структуры"
                            >
                              Все опции...
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </th>

                  {/* Sticky Row Action Header */}
                  <th className="sticky right-0 z-30 bg-slate-100 dark:bg-slate-800 w-[82px] px-1.5 py-1.5 text-center text-slate-400 border-l border-slate-200 dark:border-slate-700/80 shadow-[-4px_0_8px_-4px_rgba(15,23,42,0.12)] align-middle">Действ.</th>
                </tr>
              </thead>

              {/* Table Body */}
              <tbody className="divide-y divide-slate-200/75 dark:divide-slate-800/80 bg-white dark:bg-slate-900">
                {visibleRows.length === 0 ? (
                  <>
                    {!searchQuery && currentTab.columns.some((c) => c.name.trim().length > 0) && (
                      <tr className="bg-blue-50/40 dark:bg-blue-950/15">
                        <td className="sticky left-0 z-10 bg-blue-50 dark:bg-slate-900 w-[34px] px-1.5 py-2 text-center border-r border-slate-200/60 dark:border-slate-800/80"></td>
                        <td className="sticky left-[34px] z-10 bg-blue-50 dark:bg-slate-900 w-[38px] px-1 py-2 text-center font-mono text-[11px] text-blue-600 dark:text-blue-400 border-r border-slate-200/60 dark:border-slate-800/80">
                          +
                        </td>
                        {currentTab.columns.map((column) => {
                          const isAnchored =
                            activeCellAnchor?.rowId === null &&
                            activeCellAnchor?.colId === column.id &&
                            activeCellAnchor?.insertIndex === 0;
                          return (
                            <td
                              key={column.id}
                              onClick={() =>
                                setActiveCellAnchor({
                                  rowId: null,
                                  colId: column.id,
                                  insertIndex: 0,
                                  label: `Вставка Ctrl+V в столбец «${column.name}» (в начало таблицы)`
                                })
                              }
                              className={`px-2 py-2 border-r border-slate-200/60 dark:border-slate-800/80 cursor-pointer transition-colors text-[11px] ${
                                isAnchored
                                  ? 'bg-blue-100/70 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200 ring-1 ring-inset ring-blue-500 font-medium'
                                  : 'text-slate-400 hover:bg-blue-50/70 dark:hover:bg-slate-800/60'
                              }`}
                              title={`Кликните и нажмите Ctrl+V, чтобы вставить столбец «${column.name}» или всю таблицу из Excel`}
                            >
                              {isAnchored ? 'Нажмите Ctrl+V...' : 'Клик + Ctrl+V'}
                            </td>
                          );
                        })}
                        <td className="w-[34px] border-r border-slate-200/60 dark:border-slate-800/80"></td>
                        <td className="sticky right-0 z-10 bg-blue-50 dark:bg-slate-900 w-[82px] border-l border-slate-200/60 dark:border-slate-800/80"></td>
                      </tr>
                    )}
                    <tr>
                      <td
                        colSpan={currentTab.columns.length + 4}
                        className="py-12 text-center text-slate-400 dark:text-slate-500"
                      >
                        <div className="max-w-md mx-auto space-y-3">
                          <FileSpreadsheet className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 stroke-[1.5]" />
                          <div>
                            <p className="font-semibold text-slate-700 dark:text-slate-300">
                              {searchQuery
                                ? 'Записей по вашему запросу не найдено'
                                : currentTab.columns.some((c) => c.name.trim().length > 0)
                                  ? 'Таблица пока пуста'
                                  : 'Создайте хотя бы один столбец с наименованием'}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              {searchQuery
                                ? 'Попробуйте изменить поисковую фразу'
                                : currentTab.columns.some((c) => c.name.trim().length > 0)
                                  ? 'Кликните на ячейку нужного столбца выше и нажмите Ctrl+V для вставки столбца или всей таблицы из Excel'
                                  : 'Чтобы вставлять данные из Excel (Ctrl+V), сначала добавьте столбец с названием'}
                            </p>
                          </div>
                          {!searchQuery && (
                            <div className="flex items-center justify-center gap-2 pt-2">
                              {currentTab.columns.some((c) => c.name.trim().length > 0) ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={onAddRow}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer"
                                  >
                                    + Добавить строку
                                  </button>
                                  <button
                                    type="button"
                                    onClick={onOpenExcelImport}
                                    className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                                  >
                                    Импорт из Excel
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={onOpenColumnEditor}
                                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer"
                                >
                                  + Создать столбец
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  </>
                ) : (
                  visibleRows.map((row, localIdx) => {
                    const rowIndex = pageStartIdx + localIdx;
                    const isSelected = selectedRowIds.has(row.id);
                    const isHighlighted = highlightedRowId === row.id;

                    const stickyBgClass = isHighlighted
                      ? 'bg-amber-100 dark:bg-amber-900'
                      : isSelected
                        ? 'bg-blue-50 dark:bg-blue-950'
                        : rowIndex % 2 === 0
                          ? 'bg-white dark:bg-slate-900'
                          : 'bg-slate-50 dark:bg-slate-800';

                    return (
                      <tr
                        id={`grid-row-${row.id}`}
                        key={row.id}
                        className={`group transition-colors ${
                          isHighlighted
                            ? 'bg-amber-100/90 dark:bg-amber-900/40'
                            : isSelected
                              ? 'bg-blue-50/75 dark:bg-blue-950/35'
                              : 'odd:bg-white dark:odd:bg-slate-900 even:bg-slate-50/55 dark:even:bg-slate-800/25 hover:bg-blue-50/35 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        {/* Sticky Checkbox */}
                        <td className={`sticky left-0 z-10 ${stickyBgClass} w-[34px] px-1.5 ${cellPadClass} text-center border-r border-slate-200/60 dark:border-slate-800/80 align-top`}>
                          <button
                            type="button"
                            onClick={() => handleToggleRow(row.id)}
                            className="text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 inline-flex items-center justify-center mt-0.5"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                            ) : (
                              <Square className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </td>

                        {/* Sticky Row Index */}
                        <td className={`sticky left-[34px] z-10 ${stickyBgClass} w-[38px] px-1 ${cellPadClass} text-center font-mono tabular-nums text-[11px] text-slate-400 border-r border-slate-200/60 dark:border-slate-800/80 align-top`}>
                          {rowIndex + 1}
                        </td>

                        {/* Dynamic Cells */}
                        {currentTab.columns.map((column, colIndex) => {
                          const value = row[column.id];
                          const isRelation = column.type === 'relation';
                          const isEditing = editingCell?.rowId === row.id && editingCell?.colId === column.id;
                          const colWidth = clampColumnWidth(previewWidths[column.id] ?? column.width);
                          const relationValid = isRelation ? isRelationValueValid(column, value) : true;
                          const relationOpts = isRelation && isEditing ? getRelationOptions(column, row) : [];

                          const cellFlags = getCellPerimeterFlags(selectionBounds, rowIndex, colIndex);
                          const isAnchoredCell =
                            !selectionBounds &&
                            activeCellAnchor?.rowId === row.id &&
                            activeCellAnchor?.colId === column.id;

                          const edgeShadows: string[] = [];
                          if (cellFlags.selected && !isEditing) {
                            if (cellFlags.top) edgeShadows.push('inset 0 2px 0 0 #2563eb');
                            if (cellFlags.bottom) edgeShadows.push('inset 0 -2px 0 0 #2563eb');
                            if (cellFlags.left) edgeShadows.push('inset 2px 0 0 0 #2563eb');
                            if (cellFlags.right) edgeShadows.push('inset -2px 0 0 0 #2563eb');
                          }

                          const cellSelectionBg =
                            cellFlags.selected && !isEditing
                              ? cellFlags.isAnchor && (selectionBounds?.cellCount ?? 0) > 1
                                ? 'bg-blue-50/75 dark:bg-blue-950/35'
                                : 'bg-blue-100/75 dark:bg-blue-900/45'
                              : isRelation
                                ? !relationValid
                                  ? 'bg-amber-50/70 dark:bg-amber-950/30'
                                  : 'bg-slate-50/40 dark:bg-slate-800/20'
                                : '';

                          return (
                            <td
                              key={column.id}
                              data-row-index={rowIndex}
                              data-col-index={colIndex}
                              data-col-id={column.id}
                              data-cell-selected={cellFlags.selected ? 'true' : undefined}
                              data-cell-active={cellFlags.isAnchor ? 'true' : undefined}
                              style={{
                                width: colWidth,
                                maxWidth: colWidth,
                                boxShadow: edgeShadows.length > 0 ? edgeShadows.join(', ') : undefined
                              }}
                              onMouseDown={(e) => handleCellMouseDown(e, rowIndex, row, column, colIndex)}
                              onMouseEnter={() => handleCellMouseEnter(rowIndex, colIndex)}
                              onDoubleClick={(e) => handleCellDoubleClick(e, row, column)}
                              className={`overflow-hidden px-2 ${cellPadClass} border-r border-slate-200/60 dark:border-slate-800/80 text-slate-800 dark:text-slate-200 align-top select-none ${
                                isAnchoredCell && !isEditing ? 'ring-1 ring-inset ring-blue-500/70' : ''
                              } ${cellSelectionBg}`}
                            >
                              {isRelation ? (
                                isEditing ? (
                                  <select
                                    autoFocus
                                    value={value ?? ''}
                                    onChange={(e) => {
                                      handleRelationCellChange(row, column, e.target.value);
                                      focusGridContainer();
                                    }}
                                    onBlur={() => setEditingCell(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setEditingCell(null);
                                        focusGridContainer();
                                      }
                                    }}
                                    className="w-full px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-blue-500 rounded text-[12px] text-slate-900 dark:text-white focus:outline-hidden"
                                  >
                                    <option value="">(Выберите из мастера)</option>
                                    {relationOpts.map((opt) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                    {value && !relationOpts.includes(String(value)) && (
                                      <option value={value}>
                                        {value} (не найдено в мастере)
                                      </option>
                                    )}
                                  </select>
                                ) : (
                                  <div className="flex items-start gap-1 w-full min-h-[20px]">
                                    <div
                                      className="flex-1 min-w-0 text-left py-0.5 pr-1 flex items-start justify-between gap-1 rounded cursor-cell"
                                      title={
                                        !relationValid
                                          ? `Значение «${String(value)}» не найдено в мастере. Двойной клик / F2 / Enter — выбрать актуальное.`
                                          : 'Клик — выделить ячейку; двойной клик / F2 / Enter — выбрать значение из мастера'
                                      }
                                    >
                                      <span
                                        className={`line-clamp-4 whitespace-normal break-words [overflow-wrap:anywhere] leading-[1.35] text-[12px] ${
                                          !relationValid
                                            ? 'font-medium text-amber-700 dark:text-amber-300'
                                            : value
                                              ? 'font-medium text-slate-800 dark:text-slate-200'
                                              : 'text-slate-400 italic'
                                        }`}
                                      >
                                        {value ? String(value) : '(выбрать)'}
                                      </span>
                                      <ChevronDown className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                                    </div>

                                    {isLongCellValue(value) && (
                                      <button
                                        type="button"
                                        data-cell-action="true"
                                        title="Открыть содержимое ячейки целиком"
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onDoubleClick={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setAnchorForRowCell(row.id, column);
                                          setCopiedFullCell(false);
                                          setViewingCell({
                                            rowId: row.id,
                                            colId: column.id,
                                            colName: column.name,
                                            colType: column.type,
                                            rowIndex,
                                            value: String(value ?? '')
                                          });
                                        }}
                                        className="p-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded transition-colors shrink-0 mt-0.5 cursor-pointer opacity-70 hover:opacity-100"
                                      >
                                        <Maximize2 className="w-3 h-3" />
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      data-cell-action="true"
                                      title="Перейти к записи в мастер-таблице"
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onDoubleClick={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onAttemptEditRelation(column, row);
                                      }}
                                      className="p-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded transition-colors shrink-0 mt-0.5 cursor-pointer opacity-70 hover:opacity-100"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </button>
                                  </div>
                                )
                              ) : isEditing ? (
                                column.type === 'select' ? (
                                  <select
                                    autoFocus
                                    value={value ?? ''}
                                    onChange={(e) => {
                                      onUpdateCell(row.id, column.id, e.target.value);
                                      setEditingCell(null);
                                      focusGridContainer();
                                    }}
                                    onBlur={() => setEditingCell(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setEditingCell(null);
                                        focusGridContainer();
                                      }
                                    }}
                                    className="w-full px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-blue-500 rounded text-xs focus:outline-hidden"
                                  >
                                    <option value="">(Пусто)</option>
                                    {(column.options || []).map((opt) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                ) : column.type === 'date' ? (
                                  <input
                                    type="date"
                                    autoFocus
                                    value={draftValue ?? ''}
                                    onChange={(e) => setDraftValue(e.target.value)}
                                    onPaste={(e) => handleCellTextareaPaste(e, row, column)}
                                    onBlur={() => commitInlineEdit(row.id, column)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        commitInlineEdit(row.id, column, undefined, { restoreFocus: true });
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        cancelInlineEdit({ restoreFocus: true });
                                      }
                                    }}
                                    className="w-full px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-blue-500 rounded text-xs font-mono tabular-nums focus:outline-hidden"
                                  />
                                ) : column.type === 'number' ? (
                                  <input
                                    type="number"
                                    autoFocus
                                    value={draftValue ?? ''}
                                    onChange={(e) => setDraftValue(e.target.value)}
                                    onPaste={(e) => handleCellTextareaPaste(e, row, column)}
                                    onBlur={() => commitInlineEdit(row.id, column)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        commitInlineEdit(row.id, column, undefined, { restoreFocus: true });
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        cancelInlineEdit({ restoreFocus: true });
                                      }
                                    }}
                                    className="w-full px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-blue-500 rounded text-xs font-mono tabular-nums focus:outline-hidden"
                                  />
                                ) : column.type === 'link' ? (
                                  <input
                                    type="text"
                                    autoFocus
                                    placeholder="https://..."
                                    value={draftValue ?? ''}
                                    onChange={(e) => setDraftValue(e.target.value)}
                                    onPaste={(e) => handleCellTextareaPaste(e, row, column)}
                                    onBlur={() => commitInlineEdit(row.id, column)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        commitInlineEdit(row.id, column, undefined, { restoreFocus: true });
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        cancelInlineEdit({ restoreFocus: true });
                                      }
                                    }}
                                    className="w-full px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-blue-500 rounded text-[12px] text-blue-700 dark:text-blue-300 focus:outline-hidden"
                                  />
                                ) : (
                                  <textarea
                                    autoFocus
                                    rows={Math.min(6, Math.max(2, String(draftValue ?? '').split('\n').length))}
                                    value={draftValue ?? ''}
                                    onChange={(e) => setDraftValue(e.target.value)}
                                    onPaste={(e) => handleCellTextareaPaste(e, row, column)}
                                    onBlur={() => commitInlineEdit(row.id, column)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        commitInlineEdit(row.id, column, undefined, { restoreFocus: true });
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        cancelInlineEdit({ restoreFocus: true });
                                      }
                                    }}
                                    className="w-full px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-blue-500 rounded text-[12px] leading-[1.35] resize-y focus:outline-hidden"
                                  />
                                )
                              ) : column.type === 'boolean' ? (
                                /* SAFE BOOLEAN CELL: single click selects cell only; double click / F2 / Enter / Space toggles value */
                                <div
                                  className="min-h-[20px] py-0.5 flex items-center cursor-cell"
                                  title="Клик — выделить ячейку; двойной клик / F2 / Enter / Пробел — переключить «Да / Нет»"
                                >
                                  <div
                                    role="switch"
                                    aria-checked={Boolean(value)}
                                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-semibold transition-colors ${
                                      value
                                        ? 'bg-emerald-100/80 border-emerald-300/80 text-emerald-800 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300'
                                        : 'bg-slate-100 border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
                                    }`}
                                  >
                                    {value ? (
                                      <CheckSquare className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    ) : (
                                      <Square className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    )}
                                    <span>{value ? 'Да' : 'Нет'}</span>
                                  </div>
                                </div>
                              ) : column.type === 'link' ? (
                                /* LINK CELL: single click selects cell; clicking URL opens it; double click / F2 / Enter / pencil edits */
                                (() => {
                                  const safeHref = formatSafeHref(value);
                                  const strVal = value !== undefined && value !== null ? String(value).trim() : '';
                                  if (!strVal) {
                                    return (
                                      <div
                                        className="min-h-[20px] py-0.5 cursor-cell text-[12px] text-slate-400"
                                        title="Клик — выделить ячейку; двойной клик / F2 / Enter — ввести ссылку (URL)"
                                      >
                                        —
                                      </div>
                                    );
                                  }
                                  return (
                                    <div
                                      className="group/cell flex items-start justify-between gap-1 min-h-[20px] py-0.5 text-[12px] leading-[1.35] cursor-cell"
                                      title="Клик — выделить ячейку; клик по URL открывает адрес; двойной клик / F2 / Enter или карандаш — редактировать"
                                    >
                                      {safeHref ? (
                                        <a
                                          href={safeHref}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onMouseDown={(e) => e.stopPropagation()}
                                          onDoubleClick={(e) => e.stopPropagation()}
                                          onClick={(e) => e.stopPropagation()}
                                          className="inline-flex items-start gap-1 text-blue-600 dark:text-blue-400 hover:underline break-all min-w-0"
                                          title={`Открыть ссылку: ${safeHref}`}
                                        >
                                          <span className="line-clamp-3 break-all">{strVal}</span>
                                          <ExternalLink className="w-3 h-3 shrink-0 mt-0.5" />
                                        </a>
                                      ) : (
                                        <span className="line-clamp-3 whitespace-normal break-words [overflow-wrap:anywhere] text-slate-700 dark:text-slate-300">
                                          {strVal}
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        data-cell-action="true"
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onDoubleClick={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setAnchorForRowCell(row.id, column);
                                          setGridSelection({
                                            mode: 'cell',
                                            anchor: { rowIndex, colIndex },
                                            focus: { rowIndex, colIndex }
                                          });
                                          beginInlineEdit(row, column);
                                        }}
                                        className="opacity-0 group-hover/cell:opacity-100 focus:opacity-100 p-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded shrink-0 cursor-pointer transition-opacity"
                                        title="Редактировать ссылку"
                                        aria-label="Редактировать ссылку"
                                      >
                                        <Edit2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  );
                                })()
                              ) : (
                                /* DISPLAY VALUE (text, number, date, select) */
                                <div
                                  className="group/cell relative min-h-[20px] py-0.5 cursor-cell whitespace-normal break-words [overflow-wrap:anywhere] leading-[1.35] text-[12px] flex items-start justify-between gap-1"
                                  title={
                                    value
                                      ? `${String(value)} (клик — выделить, двойной клик / F2 / Enter — изменить, Ctrl+C — копировать)`
                                      : 'Клик — выделить, двойной клик / F2 / Enter — редактировать, Ctrl+V — вставить из Excel'
                                  }
                                >
                                  {column.type === 'number' ? (
                                    <span className="font-mono tabular-nums">
                                      {value !== undefined && value !== null && value !== ''
                                        ? Number(value).toLocaleString('ru-RU')
                                        : '—'}
                                    </span>
                                  ) : column.type === 'date' ? (
                                    <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                      {value || '—'}
                                    </span>
                                  ) : (
                                    <>
                                      <span className="line-clamp-4 whitespace-normal break-words [overflow-wrap:anywhere] flex-1 min-w-0">
                                        {value !== undefined && value !== null && value !== '' ? String(value) : '—'}
                                      </span>
                                      {isLongCellValue(value) && (
                                        <button
                                          type="button"
                                          data-cell-action="true"
                                          onMouseDown={(e) => e.stopPropagation()}
                                          onDoubleClick={(e) => e.stopPropagation()}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setAnchorForRowCell(row.id, column);
                                            setCopiedFullCell(false);
                                            setViewingCell({
                                              rowId: row.id,
                                              colId: column.id,
                                              colName: column.name,
                                              colType: column.type,
                                              rowIndex,
                                              value: String(value ?? '')
                                            });
                                          }}
                                          className="opacity-60 group-hover/cell:opacity-100 focus:opacity-100 p-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 bg-white/80 dark:bg-slate-800/80 rounded shrink-0 cursor-pointer transition-opacity"
                                          title="Просмотреть содержимое ячейки целиком"
                                        >
                                          <Maximize2 className="w-3 h-3" />
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}

                          {/* Quick Add Column spacer */}
                          <td className="w-[34px] border-r border-slate-200/60 dark:border-slate-800/80"></td>

                          {/* Sticky Right Row Actions */}
                          <td className={`sticky right-0 z-10 ${stickyBgClass} w-[82px] px-1 ${cellPadClass} text-center border-l border-slate-200/70 dark:border-slate-800/80 shadow-[-4px_0_8px_-4px_rgba(15,23,42,0.08)] align-top`}>
                            {confirmDeleteRowId === row.id ? (
                              <div className="flex items-center justify-center gap-1 pt-0.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDeleteRows([row.id]);
                                    setConfirmDeleteRowId(null);
                                  }}
                                  className="px-1.5 py-0.5 bg-red-600 text-white rounded text-[10px] font-semibold hover:bg-red-700 cursor-pointer"
                                >
                                  Удал.
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteRowId(null)}
                                  className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-[10px] cursor-pointer"
                                >
                                  Нет
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-0.5 opacity-75 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pt-0.5">
                                <button
                                  type="button"
                                  onClick={() => onOpenTemplates([row.id])}
                                  className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded transition-colors cursor-pointer"
                                  title="Шаблоны для этой строки (DOCX / PDF)"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onOpenLLMStudio(row.id)}
                                  className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded transition-colors cursor-pointer"
                                  title="Сгенерировать документ через LLM-студию"
                                >
                                  <Cpu className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteRowId(row.id)}
                                  className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors cursor-pointer"
                                  title="Удалить запись"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}

                  {/* Bottom Click-to-Paste Excel Target Row (when table has rows & named columns) */}
                  {visibleRows.length > 0 && currentTab.columns.some((c) => c.name.trim().length > 0) && (
                    <tr className="bg-slate-50/60 dark:bg-slate-800/30 border-t border-dashed border-slate-200 dark:border-slate-800">
                      <td className="sticky left-0 z-10 bg-slate-50 dark:bg-slate-800 w-[34px] px-1.5 py-1.5 border-r border-slate-200/60 dark:border-slate-800/80"></td>
                      <td className="sticky left-[34px] z-10 bg-slate-50 dark:bg-slate-800 w-[38px] px-1 py-1.5 text-center font-mono text-[10px] text-slate-400 border-r border-slate-200/60 dark:border-slate-800/80">
                        +
                      </td>
                      {currentTab.columns.map((column) => {
                        const isAnchored =
                          activeCellAnchor?.rowId === null &&
                          activeCellAnchor?.colId === column.id &&
                          activeCellAnchor?.insertIndex === currentTab.rows.length;
                        return (
                          <td
                            key={column.id}
                            onClick={() =>
                              setActiveCellAnchor({
                                rowId: null,
                                colId: column.id,
                                insertIndex: currentTab.rows.length,
                                label: `Вставка Ctrl+V в столбец «${column.name}» в конец таблицы`
                              })
                            }
                            className={`px-2 py-1.5 border-r border-slate-200/60 dark:border-slate-800/80 text-[11px] cursor-pointer transition-colors ${
                              isAnchored
                                ? 'bg-blue-100/70 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 ring-1 ring-inset ring-blue-500 font-medium'
                                : 'text-slate-400 hover:bg-blue-50/50 dark:hover:bg-slate-800/50'
                            }`}
                            title={`Кликните и нажмите Ctrl+V, чтобы вставить из Excel в конец таблицы (${column.name})`}
                          >
                            {isAnchored ? 'Нажмите Ctrl+V...' : '+ Ctrl+V в конец'}
                          </td>
                        );
                      })}
                      <td className="w-[34px] border-r border-slate-200/60 dark:border-slate-800/80"></td>
                      <td className="sticky right-0 z-10 bg-slate-50 dark:bg-slate-800 w-[82px] border-l border-slate-200/60 dark:border-slate-800/80"></td>
                    </tr>
                  )}
                </tbody>
            </table>
          );
        })()}
      </div>

      {/* Pagination Bar (activates cleanly when dataset grows beyond 50 rows) */}
      {filteredRows.length > 50 && (
        <div className="h-9 px-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300 shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono tabular-nums">
              Показаны {pageStartIdx + 1}–{Math.min(pageStartIdx + pageSize, filteredRows.length)} из{' '}
              <strong>{filteredRows.length.toLocaleString('ru-RU')}</strong>
            </span>
            <label className="hidden sm:flex items-center gap-1.5 text-slate-500">
              <span>На странице:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  updatePageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-1.5 py-0.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded text-[11px] font-mono"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
                <option value={500}>500</option>
              </select>
            </label>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Предыдущая страница"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono tabular-nums px-2">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="p-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Следующая страница"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* CASCADE CONFLICT CONFIRMATION DIALOG (prevents silent sibling cell reset) */}
      <ConfirmDialog
        isOpen={Boolean(cascadeConflict)}
        danger
        title="Несовместимость связанных полей"
        description={
          cascadeConflict
            ? `Выбрано «${cascadeConflict.newValue}» в столбце «${cascadeConflict.targetColName}». По мастер-таблице это значение не сочетается с заполненным полем: ${cascadeConflict.clearedFieldsSummary}. Очистить несовместимое значение и применить выбор?`
            : ''
        }
        confirmLabel="Очистить и применить"
        cancelLabel="Отмена"
        onConfirm={() => {
          if (cascadeConflict && onUpdateRowMulti) {
            onUpdateRowMulti(cascadeConflict.rowId, cascadeConflict.patch);
          }
          setCascadeConflict(null);
        }}
        onCancel={() => setCascadeConflict(null)}
      />

      {/* COLUMN RENAME DEPENDENCY WARNING DIALOG */}
      <ConfirmDialog
        isOpen={Boolean(pendingRenameConfirm)}
        title={
          pendingRenameConfirm
            ? `Переименовать столбец «${pendingRenameConfirm.oldName}» в «${pendingRenameConfirm.newName}»?`
            : ''
        }
        description={
          pendingRenameConfirm ? (
            <div className="space-y-2 text-xs leading-relaxed">
              <p>
                С этим столбцом связаны элементы конфигурации. Автоматическое переименование связанных тегов и шаблонов не выполняется — проверьте последствия:
              </p>
              {pendingRenameConfirm.impact.affectedTemplatesByColumnTag.length > 0 && (
                <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200">
                  <strong>Авто-теги в шаблонах ({pendingRenameConfirm.impact.directTagCandidates.join(', ')}):</strong>{' '}
                  используются в{' '}
                  {pendingRenameConfirm.impact.affectedTemplatesByColumnTag
                    .map((t) => `«${t.name}»`)
                    .join(', ')}
                  . После переименования столбца эти плейсхолдеры не будут подставляться автоматически, пока вы не обновите шаблон или не привяжете тег вручную.
                </div>
              )}
              {pendingRenameConfirm.impact.boundTags.length > 0 && (
                <div className="p-2 rounded bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <strong>Привязанные теги ({pendingRenameConfirm.impact.boundTags.map((t) => t.name).join(', ')}):</strong>{' '}
                  сохранят привязку по внутреннему ID столбца и продолжат работать со старым именем тега.
                  {pendingRenameConfirm.impact.affectedTemplatesByBoundTag.length > 0 && (
                    <span>
                      {' '}
                      Используются в шаблонах:{' '}
                      {pendingRenameConfirm.impact.affectedTemplatesByBoundTag
                        .map((t) => `«${t.name}»`)
                        .join(', ')}
                      .
                    </span>
                  )}
                </div>
              )}
              {pendingRenameConfirm.impact.dependentRelationColumns.length > 0 && (
                <div className="p-2 rounded bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <strong>Связанные столбцы других таблиц:</strong>{' '}
                  {pendingRenameConfirm.impact.dependentRelationColumns
                    .map((r) => `«${r.tabName}» → «${r.columnName}»`)
                    .join(', ')}
                  . Связь сохранится по ID, но отображаемое название в источнике изменится.
                </div>
              )}
            </div>
          ) : (
            ''
          )
        }
        confirmLabel="Переименовать столбец"
        cancelLabel="Отмена"
        onConfirm={() => {
          if (pendingRenameConfirm && onUpdateColumn) {
            onUpdateColumn(pendingRenameConfirm.columnId, {
              name: pendingRenameConfirm.newName
            });
          }
          setPendingRenameConfirm(null);
          setRenamingColId(null);
          setRenamingColVal('');
          setRenameError(null);
        }}
        onCancel={() => {
          setPendingRenameConfirm(null);
          setRenamingColId(null);
          setRenamingColVal('');
          setRenameError(null);
        }}
      />

      {/* FULL CELL CONTENT VIEWER MODAL */}
      <AppModal
        isOpen={Boolean(viewingCell)}
        onClose={() => setViewingCell(null)}
        size="xl"
        icon={<Maximize2 className="w-5 h-5" />}
        iconTone="blue"
        title={viewingCell ? `Содержимое ячейки: «${viewingCell.colName}»` : ''}
        subtitle={
          viewingCell ? (
            <>
              Таблица «{currentTab.name}» · Строка №<span className="font-mono tabular-nums">{viewingCell.rowIndex + 1}</span> ·{' '}
              <span className="font-mono tabular-nums">{viewingCell.value.length}</span> симв.
            </>
          ) : undefined
        }
        footer={
          <div className="w-full flex flex-wrap items-center justify-between gap-2">
            <AppButton
              variant="secondary"
              size="sm"
              icon={copiedFullCell ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              onClick={() => {
                if (!viewingCell) return;
                navigator.clipboard?.writeText(viewingCell.value).then(() => {
                  setCopiedFullCell(true);
                  setTimeout(() => setCopiedFullCell(false), 2000);
                }).catch(() => undefined);
              }}
            >
              {copiedFullCell ? 'Скопировано' : 'Скопировать текст'}
            </AppButton>

            <div className="flex items-center gap-2">
              {viewingCell && viewingCell.colType !== 'relation' && (
                <AppButton
                  variant="secondary"
                  size="sm"
                  icon={<Edit2 className="w-3.5 h-3.5" />}
                  onClick={() => {
                    const targetRow = currentTab.rows.find((r) => r.id === viewingCell.rowId);
                    const targetCol = currentTab.columns.find((c) => c.id === viewingCell.colId);
                    setViewingCell(null);
                    if (targetRow && targetCol) {
                      beginInlineEdit(targetRow, targetCol);
                    }
                  }}
                >
                  Редактировать
                </AppButton>
              )}
              <AppButton variant="primary" size="sm" onClick={() => setViewingCell(null)}>
                Закрыть
              </AppButton>
            </div>
          </div>
        }
      >
        <div className="p-5 overflow-y-auto max-h-[60vh]">
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs leading-relaxed text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words select-text font-sans">
            {viewingCell?.value}
          </div>
        </div>
      </AppModal>
    </div>
  );
};
