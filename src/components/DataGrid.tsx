import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Plus, Search, FileSpreadsheet, Download, 
  Trash2, Lock, ArrowUpDown, ArrowUp, 
  ArrowDown, Check, BookOpen, FileText, Cpu, 
  Columns, CheckSquare, Square, X, Edit2, ClipboardPaste, AlertCircle, ChevronDown
} from 'lucide-react';
import { Column, ColumnType, Row, Tab } from '../types/database';
import { ImportHintCard } from './ImportHintCard';
import { excelService, ValidationDiscrepancy } from '../services/excelService';

interface DataGridProps {
  currentTab: Tab;
  allTabs: Tab[];
  sharedNormativeCount?: number;
  onAddRow: () => void;
  onAddBulkRows?: (rows: Row[]) => void;
  onUpdateCell: (rowId: string, columnId: string, value: any) => void;
  onUpdateRowMulti?: (rowId: string, patch: Record<string, any>) => void;
  onDeleteRows: (rowIds: string[]) => void;
  onOpenExcelImport: () => void;
  onExportExcel: () => void;
  onOpenColumnEditor: () => void;
  onOpenNormativeDocs: () => void;
  onOpenTemplateGenerator: (selectedRowIds?: string[]) => void;
  onOpenLLMStudio: (selectedRowId?: string) => void;
  onAttemptEditRelation: (column: Column, row: Row) => void;
  onAddColumn?: (column: Column) => void;
  onUpdateColumn?: (columnId: string, patch: Partial<Column>) => void;
  highlightedRowId?: string | null;
}

export const DataGrid: React.FC<DataGridProps> = ({
  currentTab,
  allTabs,
  sharedNormativeCount,
  onAddRow,
  onAddBulkRows,
  onUpdateCell,
  onUpdateRowMulti,
  onDeleteRows,
  onOpenExcelImport,
  onExportExcel,
  onOpenColumnEditor,
  onOpenNormativeDocs,
  onOpenTemplateGenerator,
  onOpenLLMStudio,
  onAttemptEditRelation,
  onAddColumn,
  onUpdateColumn,
  highlightedRowId
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [sortColId, setSortColId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);

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

  // Non-blocking row delete confirmations
  const [confirmDeleteBulk, setConfirmDeleteBulk] = useState(false);
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(null);

  // Bulk Array Paste Modal ("Вставить массивом")
  const [isBulkPasteOpen, setIsBulkPasteOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkDiscrepancies, setBulkDiscrepancies] = useState<ValidationDiscrepancy[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Reset transient UI state when switching tabs
  useEffect(() => {
    setSelectedRowIds(new Set());
    setConfirmDeleteBulk(false);
    setConfirmDeleteRowId(null);
    setRenamingColId(null);
    setEditingCell(null);
    setIsQuickAddOpen(false);
  }, [currentTab.id]);

  // Global paste listener (Ctrl+V when not typing inside input/textarea/select)
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }
      const text = e.clipboardData?.getData('text/plain') || '';
      if (text.includes('\t') || text.includes('\n')) {
        e.preventDefault();
        setBulkText(text);
        setBulkDiscrepancies([]);
        setBulkError(null);
        setIsBulkPasteOpen(true);
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, []);

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
        id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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

  // Filter and sort rows
  const filteredRows = useMemo(() => {
    let rows = currentTab.rows;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      rows = rows.filter((row) => {
        return currentTab.columns.some((col) => {
          const val = row[col.id];
          return val !== undefined && val !== null && String(val).toLowerCase().includes(q);
        });
      });
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
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(filteredRows.map((r) => r.id)));
    }
  };

  const handleToggleRow = (rowId: string) => {
    const next = new Set(selectedRowIds);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    setSelectedRowIds(next);
  };

  /**
   * Dependent cascading options from Master table:
   * If the current tab has multiple columns linked to the same Master table
   * (e.g. "Должность (профессия)" AND "Подразделение" -> "Штатное расписание"),
   * filtering by other already-filled sibling linked fields shows strictly matching options!
   */
  const getRelationOptions = (column: Column, row?: Row): string[] => {
    if (column.type !== 'relation' || !column.relation) return [];
    const masterTab = allTabs.find((t) => t.id === column.relation?.masterTabId);
    if (!masterTab) return [];
    const masterColId = column.relation.masterColumnId;

    let candidateRows = masterTab.rows;

    if (row) {
      const siblingRelations = currentTab.columns.filter(
        (c) =>
          c.id !== column.id &&
          c.type === 'relation' &&
          c.relation?.masterTabId === column.relation!.masterTabId &&
          row[c.id] !== undefined &&
          row[c.id] !== null &&
          String(row[c.id]).trim() !== ''
      );

      if (siblingRelations.length > 0) {
        const narrowed = candidateRows.filter((mRow) =>
          siblingRelations.every(
            (sib) =>
              String(mRow[sib.relation!.masterColumnId] ?? '').trim().toLowerCase() ===
              String(row[sib.id] ?? '').trim().toLowerCase()
          )
        );
        if (narrowed.length > 0) {
          candidateRows = narrowed;
        }
      }
    }

    const values = candidateRows
      .map((r) => String(r[masterColId] ?? '').trim())
      .filter((v) => v.length > 0);
    return Array.from(new Set(values));
  };

  /**
   * When a linked cell changes, keep sibling linked fields (from same master) consistent:
   * - If an empty sibling has a single unique matching value in the master, auto-fill it!
   * - If a filled sibling is incompatible with the new value, clear it so user picks a valid match.
   */
  const handleRelationCellChange = (row: Row, column: Column, newValue: string) => {
    if (!column.relation) {
      onUpdateCell(row.id, column.id, newValue);
      return;
    }

    const masterTab = allTabs.find((t) => t.id === column.relation!.masterTabId);
    const siblingCols = currentTab.columns.filter(
      (c) => c.id !== column.id && c.type === 'relation' && c.relation?.masterTabId === column.relation!.masterTabId
    );

    if (!masterTab || siblingCols.length === 0 || !onUpdateRowMulti) {
      onUpdateCell(row.id, column.id, newValue);
      return;
    }

    const patch: Record<string, any> = { [column.id]: newValue };
    const trimmedNew = newValue.trim().toLowerCase();

    if (trimmedNew !== '') {
      const matchingMasterRows = masterTab.rows.filter(
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
          }
        }
      });
    }

    onUpdateRowMulti(row.id, patch);
  };

  // Bulk Paste preview & execution
  const parsedBulk = useMemo(() => {
    if (!bulkText.trim()) return null;
    return excelService.parseBulkTextForTab(bulkText, currentTab);
  }, [bulkText, currentTab]);

  const handleCommitBulkPaste = () => {
    if (!parsedBulk || parsedBulk.rawRows.length === 0) return;

    const errors = excelService.validateLinkedColumns(
      parsedBulk.rawRows,
      parsedBulk.columnMapping,
      currentTab,
      allTabs
    );

    if (errors.length > 0) {
      setBulkDiscrepancies(errors);
      setBulkError(
        `Вставка массивом отклонена (${errors.length} несовпадений): данные вставляются только при 100% совпадении с мастер-таблицами.`
      );
      return;
    }

    const newRows: Row[] = parsedBulk.rawRows.map((fileRow, idx) => {
      const r: Row = { id: `row_paste_${Date.now()}_${idx}` };
      currentTab.columns.forEach((col) => {
        const key = parsedBulk.columnMapping[col.id];
        let val: any = key ? fileRow[key] : '';
        if (col.type === 'boolean') {
          const s = String(val).trim().toLowerCase();
          val = ['да', 'true', '1', '+'].includes(s);
        } else if (col.type === 'number') {
          const num = Number(String(val).replace(',', '.').replace(/\s+/g, ''));
          val = val !== '' && !isNaN(num) ? num : 0;
        }
        r[col.id] = val ?? '';
      });
      return r;
    });

    if (onAddBulkRows) {
      onAddBulkRows(newRows);
    }
    setBulkText('');
    setBulkDiscrepancies([]);
    setBulkError(null);
    setIsBulkPasteOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Permanent collapsable import format guide */}
      <ImportHintCard currentTab={currentTab} />

      {/* Grid Toolbar */}
      <div className="h-11 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0 bg-white dark:bg-slate-900 text-xs overflow-x-auto no-scrollbar">
        {/* Left: Search */}
        <div className="flex items-center gap-2 flex-1 min-w-[160px] max-w-sm">
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={`Поиск в «${currentTab.name}»...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 transition-colors"
            />
          </div>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
            >
              Сброс
            </button>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onAddRow}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-xs shadow-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Добавить запись</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setBulkDiscrepancies([]);
              setBulkError(null);
              setIsBulkPasteOpen(true);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors"
            title="Вставить строки массивом из Excel или буфера обмена (Ctrl+V) со строгой проверкой связей"
          >
            <ClipboardPaste className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden lg:inline">Вставить массивом</span>
          </button>

          <button
            type="button"
            onClick={onOpenExcelImport}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors"
            title="Загрузка данных из Excel (.xlsx / .csv)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span className="hidden sm:inline">Импорт Excel</span>
          </button>

          <button
            type="button"
            onClick={onExportExcel}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors"
            title="Выгрузить текущую вкладку в файл Excel (.xlsx)"
          >
            <Download className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden sm:inline">Экспорт</span>
          </button>

          <button
            type="button"
            onClick={onOpenColumnEditor}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors"
            title="Управление структурой столбцов, шириной, названиями и связями"
          >
            <Columns className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden md:inline">Столбцы</span>
          </button>

          <button
            type="button"
            onClick={onOpenNormativeDocs}
            className="relative flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors"
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
            onClick={() => onOpenTemplateGenerator(selectedRowIds.size > 0 ? Array.from(selectedRowIds) : undefined)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60 rounded-lg text-xs font-medium transition-colors"
            title="Генерация приказов, инструкций и направлений в DOCX и PDF"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Печать документов</span>
          </button>
        </div>
      </div>

      {/* Selected Rows Action Banner */}
      {selectedRowIds.size > 0 && (
        <div className="px-4 py-2 bg-blue-50 dark:bg-blue-950/40 border-b border-blue-100 dark:border-blue-900/40 flex flex-wrap items-center justify-between gap-2 text-xs animate-in fade-in-50 duration-100">
          <span className="text-blue-900 dark:text-blue-200 font-medium">
            Выбрано строк: <strong className="font-mono">{selectedRowIds.size}</strong> из {currentTab.rows.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenTemplateGenerator(Array.from(selectedRowIds))}
              className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
            >
              <FileText className="w-3 h-3" />
              <span>Пакетная генерация ({selectedRowIds.size})</span>
            </button>

            {confirmDeleteBulk ? (
              <div className="flex items-center gap-1.5 bg-red-100 dark:bg-red-950 px-2 py-1 rounded border border-red-300 dark:border-red-800">
                <span className="text-red-800 dark:text-red-200 font-medium">Удалить {selectedRowIds.size} строк?</span>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteRows(Array.from(selectedRowIds));
                    setSelectedRowIds(new Set());
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
                setSelectedRowIds(new Set());
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
          <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold z-10 border-b border-slate-300/80 dark:border-slate-700 select-none">
            <tr>
              {/* Select All Checkbox */}
              <th className="w-[34px] px-1.5 py-1.5 text-center border-r border-slate-200 dark:border-slate-700/80 align-middle">
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 inline-flex items-center justify-center"
                >
                  {selectedRowIds.size === filteredRows.length && filteredRows.length > 0 ? (
                    <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                </button>
              </th>

              {/* Row Number */}
              <th className="w-[38px] px-1 py-1.5 text-center text-slate-400 font-mono tabular-nums text-[11px] border-r border-slate-200 dark:border-slate-700/80 align-middle">
                #
              </th>

              {/* Dynamic Columns with inline Rename & Drag Width Resizer */}
              {currentTab.columns.map((column) => {
                const isSorted = sortColId === column.id;
                const isRelation = column.type === 'relation';
                const colWidth = previewWidths[column.id] ?? column.width ?? 180;
                const isRenaming = renamingColId === column.id;

                return (
                  <th
                    key={column.id}
                    style={{ width: colWidth }}
                    className="group/th relative px-2 py-1.5 border-r border-slate-200 dark:border-slate-700/80 cursor-pointer hover:bg-slate-200/70 dark:hover:bg-slate-750 transition-colors align-top"
                    onClick={() => handleSort(column.id)}
                  >
                    <div className="flex items-start justify-between gap-1 pr-1.5">
                      <div className="flex items-start gap-1 min-w-0 flex-1">
                        {isRelation && (
                          <span title="Связанный столбец с мастер-таблицей" className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
                            <Lock className="w-3 h-3" />
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

                    {/* Drag handle to resize column width */}
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

              {/* Quick Add Column Button in Header */}
              <th className="w-[34px] px-1 py-1.5 text-center border-r border-slate-200 dark:border-slate-700/80 bg-slate-100/60 dark:bg-slate-800/60 relative align-middle">
                <button
                  type="button"
                  onClick={() => {
                    setQuickColError('');
                    setIsQuickAddOpen(!isQuickAddOpen);
                  }}
                  className="p-1 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-200 dark:hover:bg-slate-750 rounded transition-colors inline-flex items-center justify-center cursor-pointer"
                  title="Быстро добавить новый столбец в таблицу"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>

                {isQuickAddOpen && (
                  <div 
                    className="fixed sm:absolute top-28 sm:top-full right-4 sm:right-0 mt-1 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 rounded-xl shadow-2xl p-3 text-left font-normal z-[999] animate-in fade-in zoom-in-95 duration-100 ring-1 ring-black/10"
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

          {/* Table Body — compact cell spacing, word wrapping inside columns, calm alternating rows */}
          <tbody className="divide-y divide-slate-200/75 dark:divide-slate-800/80 bg-white dark:bg-slate-900">
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={currentTab.columns.length + 4}
                  className="py-14 text-center text-slate-400 dark:text-slate-500"
                >
                  <div className="max-w-sm mx-auto space-y-3">
                    <FileSpreadsheet className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 stroke-[1.5]" />
                    <div>
                      <p className="font-semibold text-slate-700 dark:text-slate-300">
                        {searchQuery ? 'Записей по вашему запросу не найдено' : 'Вкладка пуста'}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {searchQuery ? 'Попробуйте изменить поисковую фразу' : 'Добавьте первую строку вручную, вставьте массивом или импортируйте из Excel'}
                      </p>
                    </div>
                    {!searchQuery && (
                      <div className="flex items-center justify-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={onAddRow}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors"
                        >
                          + Добавить строку
                        </button>
                        <button
                          type="button"
                          onClick={onOpenExcelImport}
                          className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium transition-colors"
                        >
                          Импорт из Excel
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filteredRows.map((row, index) => {
                const isSelected = selectedRowIds.has(row.id);
                const isHighlighted = highlightedRowId === row.id;

                return (
                  <tr
                    key={row.id}
                    className={`group transition-colors ${
                      isHighlighted
                        ? 'bg-amber-100/90 dark:bg-amber-900/40'
                        : isSelected
                          ? 'bg-blue-50/75 dark:bg-blue-950/35'
                          : 'odd:bg-white dark:odd:bg-slate-900 even:bg-slate-50/55 dark:even:bg-slate-800/25 hover:bg-blue-50/35 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="w-[34px] px-1.5 py-1.5 text-center border-r border-slate-200/60 dark:border-slate-800/80 align-top">
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

                    {/* Row Index */}
                    <td className="w-[38px] px-1 py-1.5 text-center font-mono tabular-nums text-[11px] text-slate-400 border-r border-slate-200/60 dark:border-slate-800/80 align-top">
                      {index + 1}
                    </td>

                    {/* Dynamic Cells — strict word wrapping + compact calm padding */}
                    {currentTab.columns.map((column) => {
                      const value = row[column.id];
                      const isRelation = column.type === 'relation';
                      const isEditing = editingCell?.rowId === row.id && editingCell?.colId === column.id;
                      const colWidth = previewWidths[column.id] ?? column.width ?? 180;
                      const relationOpts = isRelation ? getRelationOptions(column, row) : [];

                      return (
                        <td
                          key={column.id}
                          style={{ width: colWidth }}
                          className={`px-2 py-1 border-r border-slate-200/60 dark:border-slate-800/80 text-slate-800 dark:text-slate-200 align-top ${
                            isRelation ? 'bg-slate-50/40 dark:bg-slate-850/30' : ''
                          }`}
                          onDoubleClick={() => {
                            if (isRelation) {
                              onAttemptEditRelation(column, row);
                            } else {
                              setEditingCell({ rowId: row.id, colId: column.id });
                            }
                          }}
                        >
                          {/* RELATION COLUMN RENDERING: Wrapped readable display + transparent overlay dropdown */}
                          {isRelation ? (
                            <div className="relative flex items-start gap-1 w-full min-h-[20px]">
                              <button
                                type="button"
                                title="Защищено связью с мастер-таблицей (клик для перехода к мастеру)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAttemptEditRelation(column, row);
                                }}
                                className="relative z-10 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 p-0.5 rounded transition-colors cursor-pointer shrink-0 mt-0.5"
                              >
                                <Lock className="w-3 h-3" />
                              </button>

                              <div className="relative flex-1 min-w-0 pr-3.5 py-0.5">
                                <span
                                  className={`block whitespace-normal break-words [overflow-wrap:anywhere] leading-[1.35] text-[12px] ${
                                    value ? 'font-medium text-slate-800 dark:text-slate-200' : 'text-slate-400 italic'
                                  }`}
                                >
                                  {value ? String(value) : '(выбрать)'}
                                </span>
                                <ChevronDown className="w-3 h-3 text-slate-400 absolute right-0 top-1 pointer-events-none" />
                                <select
                                  value={value ?? ''}
                                  onChange={(e) => handleRelationCellChange(row, column, e.target.value)}
                                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                  title={value ? String(value) : 'Выберите значение из мастер-таблицы'}
                                >
                                  <option value="" className="dark:bg-slate-900">(Выберите из мастера)</option>
                                  {relationOpts.map((opt) => (
                                    <option key={opt} value={opt} className="dark:bg-slate-900">
                                      {opt}
                                    </option>
                                  ))}
                                  {value && !relationOpts.includes(String(value)) && (
                                    <option value={value} className="text-amber-600 dark:bg-slate-900">
                                      {value} (не найдено в мастере)
                                    </option>
                                  )}
                                </select>
                              </div>
                            </div>
                          ) : isEditing ? (
                            /* INLINE EDITING INPUT */
                            column.type === 'select' ? (
                              <select
                                autoFocus
                                value={value ?? ''}
                                onChange={(e) => {
                                  onUpdateCell(row.id, column.id, e.target.value);
                                  setEditingCell(null);
                                }}
                                onBlur={() => setEditingCell(null)}
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
                                value={value ?? ''}
                                onChange={(e) => onUpdateCell(row.id, column.id, e.target.value)}
                                onBlur={() => setEditingCell(null)}
                                onKeyDown={(e) => e.key === 'Enter' && setEditingCell(null)}
                                className="w-full px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-blue-500 rounded text-xs font-mono tabular-nums focus:outline-hidden"
                              />
                            ) : column.type === 'number' ? (
                              <input
                                type="number"
                                autoFocus
                                value={value ?? ''}
                                onChange={(e) => onUpdateCell(row.id, column.id, e.target.value === '' ? '' : Number(e.target.value))}
                                onBlur={() => setEditingCell(null)}
                                onKeyDown={(e) => e.key === 'Enter' && setEditingCell(null)}
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
                                value={value ?? ''}
                                onChange={(e) => onUpdateCell(row.id, column.id, e.target.value)}
                                onBlur={() => setEditingCell(null)}
                                onKeyDown={(e) => {
                                  if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
                                    e.preventDefault();
                                    setEditingCell(null);
                                  }
                                }}
                                className="w-full px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-blue-500 rounded text-[12px] leading-[1.35] resize-y focus:outline-hidden"
                              />
                            )
                          ) : (
                            /* DISPLAY VALUE — clean wrapped text, compact padding, zero ellipsis clipping */
                            <div
                              onClick={() => {
                                if (column.type === 'boolean') {
                                  onUpdateCell(row.id, column.id, !value);
                                } else {
                                  setEditingCell({ rowId: row.id, colId: column.id });
                                }
                              }}
                              className="min-h-[20px] py-0.5 cursor-text whitespace-normal break-words [overflow-wrap:anywhere] leading-[1.35] text-[12px]"
                              title={column.type === 'boolean' ? 'Клик для переключения' : 'Клик для редактирования'}
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
                                  {value !== undefined && value !== null && value !== '' ? Number(value).toLocaleString('ru-RU') : '—'}
                                </span>
                              ) : column.type === 'date' ? (
                                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                  {value || '—'}
                                </span>
                              ) : (
                                <span className="whitespace-normal break-words [overflow-wrap:anywhere]">
                                  {value !== undefined && value !== null && value !== '' ? String(value) : '—'}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}

                    {/* Empty cell matching Quick Add Column header */}
                    <td className="w-[34px] border-r border-slate-200/60 dark:border-slate-800/80"></td>

                    {/* Quick Row Actions */}
                    <td className="w-[82px] px-1 py-1 text-center align-top">
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
                            onClick={() => onOpenTemplateGenerator([row.id])}
                            className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded transition-colors"
                            title="Создать приказ/направление по этой строке"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenLLMStudio(row.id)}
                            className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded transition-colors"
                            title="Сгенерировать нормативный документ через Ollama"
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
          </tbody>
        </table>
          );
        })()}
      </div>

      {/* BULK ARRAY PASTE MODAL ("Вставить массивом" со строгой проверкой связей) */}
      {isBulkPasteOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-3xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 rounded-lg">
                  <ClipboardPaste className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Массовая вставка данных во вкладку «{currentTab.name}»
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Скопируйте строки в Excel (Ctrl+C) и вставьте ниже. Связанные столбцы должны полностью совпадать с мастер-таблицей.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkPasteOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Порядок столбцов в этой таблице:
                  </label>
                  <span className="text-[11px] text-slate-400">Можно вставлять с первой строкой заголовков или без нее</span>
                </div>
                <div className="p-2 bg-slate-100 dark:bg-slate-850 rounded-lg font-mono text-[11px] text-slate-600 dark:text-slate-300 overflow-x-auto whitespace-nowrap">
                  {currentTab.columns.map((c) => c.name).join('  |  ')}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Вставьте табличные данные (разделитель — табуляция из Excel или точка с запятой):
                </label>
                <textarea
                  rows={7}
                  value={bulkText}
                  onChange={(e) => {
                    setBulkText(e.target.value);
                    setBulkDiscrepancies([]);
                    setBulkError(null);
                  }}
                  placeholder={`Пример (разделитель Tab из Excel):\n0109\tПетров Иван Сергеевич\tЭлектрогазосварщик 5 разряда\tПроизводственный цех №1\t2026-03-01`}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-mono text-xs text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 outline-hidden"
                  autoFocus
                />
              </div>

              {bulkError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg text-red-900 dark:text-red-200 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>{bulkError}</span>
                  </div>
                  {bulkDiscrepancies.length > 0 && (
                    <div className="pl-6 space-y-1 max-h-32 overflow-y-auto text-[11px] font-mono">
                      {bulkDiscrepancies.slice(0, 12).map((d, i) => (
                        <div key={i}>
                          Строка {d.rowNumber}: {d.reason || `несовпадение в «${d.columnName}» (${String(d.value)})`}
                        </div>
                      ))}
                      {bulkDiscrepancies.length > 12 && (
                        <div className="italic">...и ещё {bulkDiscrepancies.length - 12} ошибок.</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {parsedBulk && parsedBulk.rawRows.length > 0 && (
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  Распознано строк для вставки: <strong className="font-mono text-slate-900 dark:text-white">{parsedBulk.rawRows.length}</strong>
                  {parsedBulk.hasHeaderRow ? ' (автоматически определена строка заголовков)' : ' (сопоставлено по порядку столбцов)'}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50/60 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 text-xs shrink-0">
              <button
                type="button"
                onClick={() => setIsBulkPasteOpen(false)}
                className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 rounded-lg font-medium"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleCommitBulkPaste}
                disabled={!parsedBulk || parsedBulk.rawRows.length === 0}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg font-semibold flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>Проверить и вставить строки</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
