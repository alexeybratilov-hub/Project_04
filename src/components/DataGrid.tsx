import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Plus, Search, FileSpreadsheet, Download,
  Trash2, Link2, ExternalLink, ArrowUpDown, ArrowUp,
  ArrowDown, Check, BookOpen, FileText, Cpu,
  Columns, CheckSquare, Square, X, Edit2,
  AlertCircle, ChevronDown, ChevronLeft, ChevronRight, Rows3
} from 'lucide-react';
import { Column, ColumnType, Row, Tab } from '../types/database';
import { ImportHintCard } from './ImportHintCard';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { excelService, ValidationDiscrepancy } from '../services/excelService';
import { createUniqueId } from '../services/integrityService';

interface DataGridProps {
  currentTab: Tab;
  allTabs: Tab[];
  sharedNormativeCount?: number;
  tabTemplatesCount?: number;
  selectedRowIds?: Set<string>;
  onSelectedRowIdsChange?: (ids: Set<string>) => void;
  focusSearchSignal?: number;
  deleteSelectedSignal?: number;
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

export const DataGrid: React.FC<DataGridProps> = ({
  currentTab,
  allTabs,
  sharedNormativeCount,
  tabTemplatesCount = 0,
  selectedRowIds: controlledSelectedIds,
  onSelectedRowIdsChange,
  focusSearchSignal,
  deleteSelectedSignal,
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

  // View density & Pagination for 5000+ rows
  const [rowDensity, setRowDensity] = useState<'compact' | 'normal'>('compact');
  const [pageSize, setPageSize] = useState<number>(100);
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

  // Column Width Resize Drag state
  const [resizingColId, setResizingColId] = useState<string | null>(null);
  const [previewWidths, setPreviewWidths] = useState<Record<string, number>>({});
  const resizeStartRef = useRef<{ startX: number; startWidth: number }>({ startX: 0, startWidth: 180 });

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

  // Reset transient UI state when switching tabs
  useEffect(() => {
    updateSelectedRowIds(new Set());
    setConfirmDeleteBulk(false);
    setConfirmDeleteRowId(null);
    setRenamingColId(null);
    setEditingCell(null);
    setIsQuickAddOpen(false);
    setCascadeConflict(null);
    setActiveCellAnchor(null);
    setInlinePasteAlert(null);
    setCurrentPage(1);
    setSortColId(null);
    setSearchQuery('');
  }, [currentTab.id]);

  // Reset to page 1 when search filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

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

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartRef.current.startX;
      const nextWidth = Math.max(70, Math.min(800, resizeStartRef.current.startWidth + delta));
      setPreviewWidths((prev) => ({ ...prev, [resizingColId]: nextWidth }));
    };

    const handleMouseUp = () => {
      const finalWidth = previewWidths[resizingColId];
      if (finalWidth !== undefined && onUpdateColumn) {
        onUpdateColumn(resizingColId, { width: finalWidth });
      }
      setResizingColId(null);
      setPreviewWidths({});
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColId, previewWidths, onUpdateColumn]);

  const startResizeColumn = (e: React.MouseEvent, column: Column) => {
    e.preventDefault();
    e.stopPropagation();
    const curWidth = column.width || 180;
    resizeStartRef.current = { startX: e.clientX, startWidth: curWidth };
    setResizingColId(column.id);
    setPreviewWidths({ [column.id]: curWidth });
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
    e.stopPropagation();
    setRenamingColId(col.id);
    setRenamingColVal(col.name);
  };

  const finishRenameHeader = (colId: string) => {
    const trimmed = renamingColVal.trim();
    if (trimmed && onUpdateColumn) {
      onUpdateColumn(colId, { name: trimmed });
    }
    setRenamingColId(null);
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

  // Start inline edit with clean Esc rollback snapshot
  const beginInlineEdit = (row: Row, column: Column) => {
    escapeCancelRef.current = false;
    setEditingCell({ rowId: row.id, colId: column.id });
    setDraftValue(row[column.id] ?? '');
  };

  const commitInlineEdit = (rowId: string, col: Column, rawVal?: any) => {
    if (escapeCancelRef.current) {
      escapeCancelRef.current = false;
      setEditingCell(null);
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
  };

  const cancelInlineEdit = () => {
    escapeCancelRef.current = true;
    setEditingCell(null);
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
      <div className="h-11 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0 bg-white dark:bg-slate-900 text-xs overflow-x-auto no-scrollbar">
        {/* Left: Search */}
        <div className="flex items-center gap-2 flex-1 min-w-[160px] max-w-sm">
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={`Поиск в «${currentTab.name}»... (Ctrl+F)`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 transition-colors"
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

        {/* Right: Actions + Density */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onAddRow}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-xs shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Добавить запись</span>
          </button>

          <button
            type="button"
            onClick={onOpenExcelImport}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            title="Загрузка данных из Excel (.xlsx / .csv)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span className="hidden sm:inline">Импорт Excel</span>
          </button>

          <button
            type="button"
            onClick={onExportExcel}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            title="Выгрузить текущую вкладку в файл Excel (.xlsx)"
          >
            <Download className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden sm:inline">Экспорт</span>
          </button>

          <button
            type="button"
            onClick={onOpenColumnEditor}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            title="Управление структурой столбцов, шириной, названиями и связями"
          >
            <Columns className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden md:inline">Столбцы</span>
          </button>

          <button
            type="button"
            onClick={() => setRowDensity((d) => (d === 'compact' ? 'normal' : 'compact'))}
            className="flex items-center gap-1 px-2 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-xs transition-colors cursor-pointer"
            title={rowDensity === 'compact' ? 'Плотность: Компактно (нажмите для обычной)' : 'Плотность: Обычная (нажмите для компактной)'}
          >
            <Rows3 className="w-3.5 h-3.5 text-slate-500" />
          </button>

          <button
            type="button"
            onClick={onOpenNormativeDocs}
            className="relative flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            title="Прикрепленные нормативные документы (ГОСТ / Приказы Минтруда)"
          >
            <BookOpen className="w-3.5 h-3.5 text-purple-600" />
            <span className="hidden xl:inline">Нормативы</span>
            {(sharedNormativeCount ?? currentTab.attachedDocs.length) > 0 && (
              <span className="ml-0.5 text-[11px] text-purple-700 dark:text-purple-300 font-mono tabular-nums font-semibold">
                · {sharedNormativeCount ?? currentTab.attachedDocs.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onOpenTemplates(selectedRowIds.size > 0 ? Array.from(selectedRowIds) : undefined)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            title="Шаблоны, привязанные к этой таблице (DOCX и PDF)"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Шаблоны</span>
            {tabTemplatesCount > 0 && (
              <span className="ml-0.5 text-[11px] font-mono tabular-nums font-semibold opacity-80">
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

      {/* Table Canvas */}
      <div className="flex-1 overflow-auto bg-white dark:bg-slate-900">
        {(() => {
          const totalColsWidth =
            34 +
            38 +
            currentTab.columns.reduce(
              (sum, c) => sum + (previewWidths[c.id] ?? c.width ?? 180),
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
                  const colWidth = previewWidths[column.id] ?? column.width ?? 180;
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
                  {currentTab.columns.map((column) => {
                    const isSorted = sortColId === column.id;
                    const isRelation = column.type === 'relation';
                    const colWidth = previewWidths[column.id] ?? column.width ?? 180;
                    const isRenaming = renamingColId === column.id;

                    return (
                      <th
                        key={column.id}
                        style={{ width: colWidth }}
                        className="group/th relative px-2 py-1.5 border-r border-slate-200 dark:border-slate-700/80 cursor-pointer hover:bg-slate-200/70 dark:hover:bg-slate-700/70 transition-colors align-top"
                        onClick={() => handleSort(column.id)}
                      >
                        <div className="flex items-start justify-between gap-1 pr-1.5">
                          <div className="flex items-start gap-1 min-w-0 flex-1">
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
                                type="text"
                                value={renamingColVal}
                                onChange={(e) => setRenamingColVal(e.target.value)}
                                onBlur={() => finishRenameHeader(column.id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') finishRenameHeader(column.id);
                                  if (e.key === 'Escape') setRenamingColId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                                className="w-full px-1.5 py-0.5 bg-white dark:bg-slate-900 border border-blue-500 rounded text-xs font-semibold text-slate-900 dark:text-white outline-hidden"
                              />
                            ) : (
                              <span
                                onDoubleClick={(e) => startRenameHeader(column, e)}
                                className="whitespace-normal break-words [overflow-wrap:anywhere] leading-tight text-[11.5px]"
                                title={`${column.name} (двойной клик для переименования)`}
                              >
                                {column.name}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-0.5 shrink-0 text-slate-400 mt-0.5">
                            {!isRenaming && (
                              <button
                                type="button"
                                onClick={(e) => startRenameHeader(column, e)}
                                className="opacity-0 group-hover/th:opacity-100 p-0.5 hover:text-blue-600 rounded transition-opacity"
                                title="Переименовать столбец"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            )}
                            {isSorted ? (
                              sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />
                            ) : (
                              <ArrowUpDown className="w-3 h-3 opacity-0 group-hover/th:opacity-60" />
                            )}
                          </div>
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
                        className="fixed sm:absolute top-28 sm:top-full right-4 sm:right-0 mt-1 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-3 text-left font-normal z-[999] animate-in fade-in zoom-in-95 duration-100 ring-1 ring-black/10"
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

                  {/* Row Action Header */}
                  <th className="w-[82px] px-1.5 py-1.5 text-center text-slate-400 align-middle">Действ.</th>
                </tr>
              </thead>

              {/* Table Body */}
              <tbody className="divide-y divide-slate-200/75 dark:divide-slate-800/80 bg-white dark:bg-slate-900">
                {visibleRows.length === 0 ? (
                  <>
                    {!searchQuery && currentTab.columns.some((c) => c.name.trim().length > 0) && (
                      <tr className="bg-blue-50/35 dark:bg-blue-950/15">
                        <td className="sticky left-0 z-10 bg-blue-50/35 dark:bg-slate-900 w-[34px] px-1.5 py-2 text-center border-r border-slate-200/60 dark:border-slate-800/80"></td>
                        <td className="sticky left-[34px] z-10 bg-blue-50/35 dark:bg-slate-900 w-[38px] px-1 py-2 text-center font-mono text-[11px] text-blue-600 dark:text-blue-400 border-r border-slate-200/60 dark:border-slate-800/80">
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
                        <td className="w-[82px]"></td>
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
                        {currentTab.columns.map((column) => {
                          const value = row[column.id];
                          const isRelation = column.type === 'relation';
                          const isEditing = editingCell?.rowId === row.id && editingCell?.colId === column.id;
                          const colWidth = previewWidths[column.id] ?? column.width ?? 180;
                          const relationValid = isRelation ? isRelationValueValid(column, value) : true;
                          const relationOpts = isRelation && isEditing ? getRelationOptions(column, row) : [];

                          const isAnchoredCell =
                            activeCellAnchor?.rowId === row.id &&
                            activeCellAnchor?.colId === column.id;

                          return (
                            <td
                              key={column.id}
                              style={{ width: colWidth }}
                              onClick={() => setAnchorForRowCell(row.id, column)}
                              className={`px-2 ${cellPadClass} border-r border-slate-200/60 dark:border-slate-800/80 text-slate-800 dark:text-slate-200 align-top ${
                                isAnchoredCell && !isEditing ? 'ring-1 ring-inset ring-blue-500/70' : ''
                              } ${
                                isRelation
                                  ? !relationValid
                                    ? 'bg-amber-50/70 dark:bg-amber-950/30'
                                    : 'bg-slate-50/40 dark:bg-slate-800/20'
                                  : ''
                              }`}
                            >
                              {isRelation ? (
                                isEditing ? (
                                  <select
                                    autoFocus
                                    value={value ?? ''}
                                    onChange={(e) => handleRelationCellChange(row, column, e.target.value)}
                                    onBlur={() => setEditingCell(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setEditingCell(null);
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
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setAnchorForRowCell(row.id, column);
                                        setEditingCell({ rowId: row.id, colId: column.id });
                                      }}
                                      className="flex-1 min-w-0 text-left py-0.5 pr-1 flex items-start justify-between gap-1 rounded hover:bg-blue-50/70 dark:hover:bg-slate-800/70 focus:outline-hidden focus:ring-1 focus:ring-blue-500 transition-colors cursor-pointer"
                                      title={
                                        !relationValid
                                          ? `Значение «${String(value)}» не найдено в мастере. Нажмите для выбора актуального.`
                                          : 'Нажмите для выбора значения или Ctrl+V для вставки из Excel'
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
                                    </button>

                                    <button
                                      type="button"
                                      title="Перейти к записи в мастер-таблице"
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
                                    }}
                                    onBlur={() => setEditingCell(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') setEditingCell(null);
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
                                      if (e.key === 'Enter') commitInlineEdit(row.id, column);
                                      if (e.key === 'Escape') cancelInlineEdit();
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
                                      if (e.key === 'Enter') commitInlineEdit(row.id, column);
                                      if (e.key === 'Escape') cancelInlineEdit();
                                    }}
                                    className="w-full px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-blue-500 rounded text-xs font-mono tabular-nums focus:outline-hidden"
                                  />
                                ) : column.type === 'boolean' ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onUpdateCell(row.id, column.id, !value);
                                      setEditingCell(null);
                                    }}
                                    className="px-2 py-0.5 rounded bg-blue-600 text-white text-xs"
                                  >
                                    {value ? 'Да' : 'Нет'}
                                  </button>
                                ) : (
                                  <textarea
                                    autoFocus
                                    rows={2}
                                    value={draftValue ?? ''}
                                    onChange={(e) => setDraftValue(e.target.value)}
                                    onPaste={(e) => handleCellTextareaPaste(e, row, column)}
                                    onBlur={() => commitInlineEdit(row.id, column)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        commitInlineEdit(row.id, column);
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        cancelInlineEdit();
                                      }
                                    }}
                                    className="w-full px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-blue-500 rounded text-[12px] leading-[1.35] resize-y focus:outline-hidden"
                                  />
                                )
                              ) : (
                                /* DISPLAY VALUE */
                                <div
                                  onClick={() => {
                                    setAnchorForRowCell(row.id, column);
                                    if (column.type === 'boolean') {
                                      onUpdateCell(row.id, column.id, !value);
                                    } else {
                                      beginInlineEdit(row, column);
                                    }
                                  }}
                                  className="min-h-[20px] py-0.5 cursor-text whitespace-normal break-words [overflow-wrap:anywhere] leading-[1.35] text-[12px]"
                                  title={
                                    column.type === 'boolean'
                                      ? 'Клик для переключения'
                                      : value
                                        ? `${String(value)} (клик — редактировать, Ctrl+V — вставить строки из Excel ниже)`
                                        : 'Клик — редактировать или Ctrl+V для вставки из Excel'
                                  }
                                >
                                  {column.type === 'boolean' ? (
                                    <span
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold cursor-pointer ${
                                        value
                                          ? 'bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                      }`}
                                    >
                                      {value ? <Check className="w-3 h-3" /> : null}
                                      {value ? 'Да' : 'Нет'}
                                    </span>
                                  ) : column.type === 'number' ? (
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
                                    <span className="line-clamp-4 whitespace-normal break-words [overflow-wrap:anywhere]">
                                      {value !== undefined && value !== null && value !== '' ? String(value) : '—'}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}

                        {/* Quick Add Column spacer */}
                        <td className="w-[34px] border-r border-slate-200/60 dark:border-slate-800/80"></td>

                        {/* Quick Row Actions */}
                        <td className={`w-[82px] px-1 ${cellPadClass} text-center align-top`}>
                          {confirmDeleteRowId === row.id ? (
                            <div className="flex items-center justify-center gap-1 pt-0.5">
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteRows([row.id]);
                                  setConfirmDeleteRowId(null);
                                }}
                                className="px-1.5 py-0.5 bg-red-600 text-white rounded text-[10px] font-semibold hover:bg-red-700"
                              >
                                Удал.
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteRowId(null)}
                                className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-[10px]"
                              >
                                Нет
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
                              <button
                                type="button"
                                onClick={() => onOpenTemplates([row.id])}
                                className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded transition-colors"
                                title="Шаблоны для этой строки (DOCX / PDF)"
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenLLMStudio(row.id)}
                                className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded transition-colors"
                                title="Сгенерировать документ через LLM-студию"
                              >
                                <Cpu className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteRowId(row.id)}
                                className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"
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
                    <td className="sticky left-0 z-10 bg-slate-50 dark:bg-slate-800/60 w-[34px] px-1.5 py-1.5 border-r border-slate-200/60 dark:border-slate-800/80"></td>
                    <td className="sticky left-[34px] z-10 bg-slate-50 dark:bg-slate-800/60 w-[38px] px-1 py-1.5 text-center font-mono text-[10px] text-slate-400 border-r border-slate-200/60 dark:border-slate-800/80">
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
                    <td className="w-[82px]"></td>
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
                  setPageSize(Number(e.target.value));
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
    </div>
  );
};
