import React, { useState, useEffect } from 'react';
import {
  X, Upload, FileSpreadsheet, AlertCircle,
  Check, ArrowRight, Table as TableIcon, RefreshCw
} from 'lucide-react';
import { Column, Tab } from '../types/database';
import { excelService, ParsedExcelSheet, ValidationDiscrepancy } from '../services/excelService';
import { createUniqueId } from '../services/integrityService';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: Tab;
  allTabs: Tab[];
  onCommitImportNewTab: (sheetName: string, columns: Column[], rows: Record<string, any>[]) => void;
  onCommitImportExistingTab: (tabId: string, rows: Record<string, any>[]) => void;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  currentTab,
  allTabs,
  onCommitImportNewTab,
  onCommitImportExistingTab
}) => {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedSheets, setParsedSheets] = useState<Record<string, ParsedExcelSheet> | null>(null);
  const [activeSheetName, setActiveSheetName] = useState<string>('');
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({}); // tabColumnId -> fileHeader
  const [discrepancies, setDiscrepancies] = useState<ValidationDiscrepancy[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedFile(null);
      setParsedSheets(null);
      setActiveSheetName('');
      setColumnMapping({});
      setDiscrepancies([]);
      setErrorMsg(null);
    }
  }, [isOpen, currentTab?.id]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setIsParsing(true);
    setErrorMsg(null);
    setDiscrepancies([]);

    try {
      const sheets = await excelService.parseFile(file);
      const sheetNames = Object.keys(sheets);
      if (sheetNames.length === 0) {
        throw new Error('В файле не обнаружено таблиц или строк с данными.');
      }
      setParsedSheets(sheets);
      const firstSheet = sheetNames[0];
      setActiveSheetName(firstSheet);

      // Auto-map columns if existing mode
      const initialMap: Record<string, string> = {};
      const fileHeaders = sheets[firstSheet].headers;

      currentTab.columns.forEach((col) => {
        // Find exact or normalized match
        const colNorm = col.name.trim().toLowerCase();
        const matched = fileHeaders.find(
          (h) => h.trim().toLowerCase() === colNorm || h.toLowerCase().includes(colNorm) || colNorm.includes(h.toLowerCase())
        );
        if (matched) {
          initialMap[col.id] = matched;
        }
      });
      setColumnMapping(initialMap);
    } catch (err: any) {
      setErrorMsg(err.message || 'Ошибка парсинга файла Excel');
    } finally {
      setIsParsing(false);
    }
  };

  const currentSheetData = parsedSheets && activeSheetName ? parsedSheets[activeSheetName] : null;

  const handleCommit = () => {
    if (!currentSheetData) return;
    setErrorMsg(null);
    setDiscrepancies([]);

    if (mode === 'new') {
      // Create new tab as-is
      const newColumns = currentSheetData.suggestedColumns;
      const rowsWithIds = currentSheetData.rawRows.map((r) => {
        const rowObj: Record<string, any> = { id: createUniqueId('row_imp') };
        newColumns.forEach((c) => {
          rowObj[c.id] = r[c.name] ?? '';
        });
        return rowObj;
      });
      onCommitImportNewTab(activeSheetName || 'Импорт Excel', newColumns, rowsWithIds);
      onClose();
    } else {
      // Validate linked columns in existing tab
      const errors = excelService.validateLinkedColumns(
        currentSheetData.rawRows,
        columnMapping,
        currentTab,
        allTabs
      );

      if (errors.length > 0) {
        setDiscrepancies(errors);
        setErrorMsg(`Обнаружены расхождения в связанных столбцах (${errors.length}). Транзакционный импорт отменен во избежание нарушения ссылочной целостности.`);
        return;
      }

      // Map rows to target tab column IDs
      const mappedRows = currentSheetData.rawRows.map((fileRow) => {
        const rowObj: Record<string, any> = { id: createUniqueId('row_imp') };
        currentTab.columns.forEach((col) => {
          const fileHeader = columnMapping[col.id];
          rowObj[col.id] = fileHeader ? fileRow[fileHeader] : '';
        });
        return rowObj;
      });

      onCommitImportExistingTab(currentTab.id, mappedRows);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 rounded-lg">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Импорт данных из Excel / CSV
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Поддержка файлов .xlsx, .xlsm, .csv с автоматической валидацией связей
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Mode Selector */}
          <div className="grid grid-cols-2 gap-3 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-medium">
            <button
              onClick={() => setMode('existing')}
              className={`py-2 px-3 rounded-md transition-all text-center flex items-center justify-center gap-2 ${
                mode === 'existing'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5 text-blue-600" />
              <span>В существующую вкладку «{currentTab.name}»</span>
            </button>
            <button
              onClick={() => setMode('new')}
              className={`py-2 px-3 rounded-md transition-all text-center flex items-center justify-center gap-2 ${
                mode === 'new'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Создать новую вкладку «как есть»</span>
            </button>
          </div>

          {/* File Picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Выберите файл таблицы:
            </label>
            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-xl cursor-pointer bg-slate-50 dark:bg-slate-800/50 hover:bg-blue-50/30 transition-all">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-7 h-7 text-slate-400 mb-2" />
                  <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                    {selectedFile ? selectedFile.name : 'Нажмите для выбора файла или перетащите его сюда'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">XLSX, XLSM или CSV (UTF-8)</p>
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xlsm,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Errors or Discrepancies */}
          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg text-red-900 dark:text-red-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
              <div>
                <p className="font-semibold">{errorMsg}</p>
                {discrepancies.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-36 overflow-y-auto">
                    <p className="text-[11px] text-red-700 dark:text-red-300 font-semibold">Список расхождений:</p>
                    {discrepancies.slice(0, 10).map((d, idx) => (
                      <p key={idx} className="text-[10px] font-mono">
                        Строка {d.rowNumber}: {d.reason || `в поле «${d.columnName}» указано «${String(d.value)}», которого нет в мастере «${d.masterTabName}»`}.
                      </p>
                    ))}
                    {discrepancies.length > 10 && (
                      <p className="text-[10px] italic">...и ещё {discrepancies.length - 10} несовпадений.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Parsing Spinner */}
          {isParsing && (
            <div className="p-6 text-center text-xs text-slate-500">
              <RefreshCw className="w-5 h-5 mx-auto animate-spin text-blue-600 mb-2" />
              <span>Чтение структуры файла...</span>
            </div>
          )}

          {/* Parsed Sheet Details */}
          {currentSheetData && (
            <div className="space-y-4">
              {/* Sheet tabs if multiple */}
              {parsedSheets && Object.keys(parsedSheets).length > 1 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500 font-medium">Лист файла:</span>
                  <div className="flex items-center gap-1">
                    {Object.keys(parsedSheets).map((sName) => (
                      <button
                        key={sName}
                        onClick={() => setActiveSheetName(sName)}
                        className={`px-2.5 py-1 rounded text-xs transition-colors ${
                          activeSheetName === sName
                            ? 'bg-blue-600 text-white font-medium'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        {sName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Column Mapping (in Existing Tab Mode) */}
              {mode === 'existing' && (
                <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-800/40 space-y-3">
                  <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Сопоставление столбцов вкладки со столбцами из файла:
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    {currentTab.columns.map((col) => {
                      const isRelation = col.type === 'relation';
                      return (
                        <div key={col.id} className="flex items-center justify-between gap-2 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
                          <div className="truncate flex-1">
                            <span className="font-medium text-slate-800 dark:text-slate-200">{col.name}</span>
                            {isRelation && (
                              <span className="ml-1.5 text-[10px] text-blue-600 dark:text-blue-400 font-mono">
                                (связан)
                              </span>
                            )}
                          </div>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <select
                            value={columnMapping[col.id] || ''}
                            onChange={(e) => setColumnMapping({ ...columnMapping, [col.id]: e.target.value })}
                            className="w-44 px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs truncate"
                          >
                            <option value="">(Не импортировать)</option>
                            {currentSheetData.headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Data Preview Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Предпросмотр данных (первые 5 строк из {currentSheetData.rawRows.length}):
                  </span>
                </div>
                <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto max-h-48 text-[11px]">
                  <table className="w-full border-collapse">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold sticky top-0">
                      <tr>
                        {currentSheetData.headers.map((h) => (
                          <th key={h} className="px-3 py-2 border-r border-slate-200 dark:border-slate-700 text-left whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
                      {currentSheetData.rawRows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          {currentSheetData.headers.map((h) => (
                            <td key={h} className="px-3 py-1.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-800 dark:text-slate-200">
                              {String(row[h] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50/60 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 shrink-0 text-xs">
          <div className="text-slate-500">
            {currentSheetData && (
              <span>Строк к импорту: <strong className="font-mono text-slate-800 dark:text-slate-200">{currentSheetData.rawRows.length}</strong></span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 rounded-lg transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleCommit}
              disabled={!currentSheetData || currentSheetData.rawRows.length === 0}
              className="px-5 py-2 font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 rounded-lg shadow-xs transition-colors flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>Выполнить импорт</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
