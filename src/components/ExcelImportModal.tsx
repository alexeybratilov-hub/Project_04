import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Upload, FileSpreadsheet, Check, ArrowRight, Table as TableIcon, RefreshCw, Sparkles
} from 'lucide-react';
import { Column, Row, Tab } from '../types/database';
import { excelService, ParsedExcelSheet, ValidationDiscrepancy } from '../services/excelService';
import { createUniqueId } from '../services/integrityService';
import {
  AppButton,
  AppModal,
  AppSelect,
  FileValidationRule,
  StatusBanner,
  useFileDropZone
} from './ui';

const EXCEL_FILE_RULE: FileValidationRule = {
  allowedExtensions: ['.xlsx', '.xlsm', '.csv'],
  allowedMimeTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroenabled.12',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv',
    'text/plain',
    'application/zip'
  ],
  formatLabel: '.xlsx, .xlsm или .csv'
};

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: Tab;
  allTabs: Tab[];
  onCommitImportNewTab: (sheetName: string, columns: Column[], rows: Record<string, any>[]) => void;
  onCommitImportExistingTab: (tabId: string, rows: Record<string, any>[]) => void;
  onCommitOneCZupImport?: (payload: { createdPositions: Row[]; employeeRows: Row[] }) => void;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  currentTab,
  allTabs,
  onCommitImportNewTab,
  onCommitImportExistingTab,
  onCommitOneCZupImport
}) => {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedSheets, setParsedSheets] = useState<Record<string, ParsedExcelSheet> | null>(null);
  const [activeSheetName, setActiveSheetName] = useState<string>('');
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({}); // tabColumnId -> fileHeader
  const [skipDuplicates, setSkipDuplicates] = useState<boolean>(true);
  const [discrepancies, setDiscrepancies] = useState<ValidationDiscrepancy[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [useOneCZupPreset, setUseOneCZupPreset] = useState<boolean>(false);
  const [autoCreatePositions, setAutoCreatePositions] = useState<boolean>(true);

  const isEmployeesTarget = currentTab.moduleId === 'employees' || currentTab.id === 'tab_employees';

  useEffect(() => {
    if (isOpen) {
      setSelectedFile(null);
      setParsedSheets(null);
      setActiveSheetName('');
      setColumnMapping({});
      setSkipDuplicates(true);
      setDiscrepancies([]);
      setErrorMsg(null);
      setUseOneCZupPreset(false);
      setAutoCreatePositions(true);
    }
  }, [isOpen, currentTab?.id]);

  const handleSelectSheet = useCallback(
    (sheetName: string, sheetsMap: Record<string, ParsedExcelSheet> | null = parsedSheets) => {
      setActiveSheetName(sheetName);
      setDiscrepancies([]);
      setErrorMsg(null);
      const sheet = sheetsMap?.[sheetName];
      if (sheet) {
        const detectedZup = isEmployeesTarget && excelService.detectIsOneCZupHeaders(sheet.headers);
        setUseOneCZupPreset(detectedZup);
        setColumnMapping(
          detectedZup
            ? excelService.autoMapOneCZupColumns(currentTab.columns, sheet.headers)
            : excelService.autoMapColumns(currentTab.columns, sheet.headers)
        );
      } else {
        setColumnMapping({});
        setUseOneCZupPreset(false);
      }
    },
    [currentTab.columns, isEmployeesTarget, parsedSheets]
  );

  const processExcelFile = useCallback(
    async (file: File) => {
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
        handleSelectSheet(firstSheet, sheets);
      } catch (err: any) {
        setParsedSheets(null);
        setActiveSheetName('');
        setColumnMapping({});
        setErrorMsg(err.message || 'Ошибка парсинга файла Excel');
      } finally {
        setIsParsing(false);
      }
    },
    [handleSelectSheet]
  );

  const handleRejectFile = useCallback((message: string) => {
    setSelectedFile(null);
    setParsedSheets(null);
    setActiveSheetName('');
    setColumnMapping({});
    setDiscrepancies([]);
    setErrorMsg(message);
  }, []);

  const { isDragOver, dropZoneProps, handleInputChange } = useFileDropZone({
    rule: EXCEL_FILE_RULE,
    disabled: isParsing || !isOpen,
    onFileAccepted: processExcelFile,
    onReject: handleRejectFile
  });

  const currentSheetData = parsedSheets && activeSheetName ? parsedSheets[activeSheetName] : null;

  const duplicateAnalysis = useMemo(() => {
    if (!currentSheetData) {
      return {
        duplicateAgainstExistingIndices: [] as number[],
        duplicateWithinFileIndices: [] as number[],
        uniqueIndices: [] as number[],
        duplicateColumnMappings: [] as Array<{ fileHeader: string; columnNames: string[] }>
      };
    }
    return excelService.analyzeImportDuplicates(
      currentSheetData.rawRows,
      columnMapping,
      currentTab,
      mode,
      currentSheetData.headers
    );
  }, [currentSheetData, columnMapping, currentTab, mode]);

  const duplicateHeaderSet = useMemo(
    () => new Set(duplicateAnalysis.duplicateColumnMappings.map((d) => d.fileHeader)),
    [duplicateAnalysis.duplicateColumnMappings]
  );

  const totalDuplicatesCount =
    duplicateAnalysis.duplicateAgainstExistingIndices.length +
    duplicateAnalysis.duplicateWithinFileIndices.length;

  const effectiveImportCount = currentSheetData
    ? skipDuplicates
      ? duplicateAnalysis.uniqueIndices.length
      : currentSheetData.rawRows.length
    : 0;

  const zupPreviewPlan = useMemo(() => {
    if (!currentSheetData || mode !== 'existing' || !useOneCZupPreset || !isEmployeesTarget) return null;
    const rowsToImport = skipDuplicates
      ? duplicateAnalysis.uniqueIndices.map((idx) => currentSheetData.rawRows[idx])
      : currentSheetData.rawRows;
    return excelService.prepareOneCZupImport({
      rawRows: rowsToImport,
      columnMapping,
      employeesTab: currentTab,
      allTabs,
      autoCreatePositions
    });
  }, [
    currentSheetData,
    mode,
    useOneCZupPreset,
    isEmployeesTarget,
    skipDuplicates,
    duplicateAnalysis.uniqueIndices,
    columnMapping,
    currentTab,
    allTabs,
    autoCreatePositions
  ]);

  const handleCommit = () => {
    if (!currentSheetData) return;
    setErrorMsg(null);
    setDiscrepancies([]);

    const rowsToImport = skipDuplicates
      ? duplicateAnalysis.uniqueIndices.map((idx) => currentSheetData.rawRows[idx])
      : currentSheetData.rawRows;

    if (rowsToImport.length === 0) {
      setErrorMsg('Все строки файла являются дубликатами. Снимите отметку пропуска дублей или выберите другой лист/файл.');
      return;
    }

    if (mode === 'new') {
      // Create new tab as-is
      const newColumns = currentSheetData.suggestedColumns;
      const rowsWithIds = rowsToImport.map((r) => {
        const rowObj: Record<string, any> = { id: createUniqueId('row_imp') };
        newColumns.forEach((c) => {
          rowObj[c.id] = r[c.name] ?? '';
        });
        return rowObj;
      });
      onCommitImportNewTab(activeSheetName || 'Импорт Excel', newColumns, rowsWithIds);
      onClose();
    } else if (useOneCZupPreset && isEmployeesTarget) {
      const zupRes = excelService.prepareOneCZupImport({
        rawRows: rowsToImport,
        columnMapping,
        employeesTab: currentTab,
        allTabs,
        autoCreatePositions
      });

      if (!zupRes.ok) {
        setDiscrepancies(zupRes.discrepancies);
        setErrorMsg(
          zupRes.error ||
            'Обнаружены расхождения при импорте из 1С:ЗУП. Проверьте данные или включите автосоздание должностей.'
        );
        return;
      }

      if (onCommitOneCZupImport) {
        onCommitOneCZupImport({
          createdPositions: zupRes.createdPositions,
          employeeRows: zupRes.employeeRows
        });
      } else {
        onCommitImportExistingTab(currentTab.id, zupRes.employeeRows);
      }
      onClose();
    } else {
      // Validate linked columns in existing tab
      const errors = excelService.validateLinkedColumns(
        rowsToImport,
        columnMapping,
        currentTab,
        allTabs
      );

      if (errors.length > 0) {
        setDiscrepancies(errors);
        setErrorMsg(`Обнаружены расхождения в связанных столбцах (${errors.length}). Транзакционный импорт отменен во избежание нарушения ссылочной целостности.`);
        return;
      }

      // Map rows to target tab column IDs with strict type conversion.
      // Unparsable values must be reported, never silently replaced with 0/false/''
      const conversionIssues: ValidationDiscrepancy[] = [];
      const mappedRows = rowsToImport.map((fileRow, rowIdx) => {
        const rowObj: Record<string, any> = { id: createUniqueId('row_imp') };
        currentTab.columns.forEach((col) => {
          const fileHeader = columnMapping[col.id];
          const rawVal = fileHeader ? fileRow[fileHeader] : undefined;
          const converted = excelService.convertCellToColumnType(col, rawVal);
          if (!converted.ok) {
            conversionIssues.push({
              rowNumber: rowIdx + 1,
              columnName: col.name,
              value: rawVal ?? '',
              masterTabName: '',
              expectedValuesSnippet: '',
              reason: converted.reason
            });
            rowObj[col.id] = '';
            return;
          }
          rowObj[col.id] = converted.value;
        });
        return rowObj;
      });

      if (conversionIssues.length > 0) {
        setDiscrepancies(conversionIssues);
        setErrorMsg(
          `Обнаружены значения, не соответствующие типам столбцов (${conversionIssues.length}). Импорт отменён: исправьте данные в файле или измените типы столбцов во вкладке.`
        );
        return;
      }

      onCommitImportExistingTab(currentTab.id, mappedRows);
      onClose();
    }
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      size="4xl"
      heightClass="max-h-[90vh]"
      icon={<FileSpreadsheet className="w-5 h-5" />}
      iconTone="emerald"
      title="Импорт данных из Excel / CSV"
      subtitle="Поддержка файлов .xlsx, .xlsm, .csv (UTF-8 / Windows-1251) с автоматической валидацией связей"
      footer={
        <div className="w-full flex items-center justify-between gap-3">
          <div className="text-slate-500">
            {currentSheetData && (
              <span>
                Строк к импорту:{' '}
                <strong className="font-mono text-slate-800 dark:text-slate-200">
                  {effectiveImportCount}
                </strong>
                {totalDuplicatesCount > 0 && skipDuplicates && (
                  <span className="ml-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                    (из {currentSheetData.rawRows.length}, пропущено дублей: {totalDuplicatesCount})
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <AppButton variant="ghost" onClick={onClose}>
              Отмена
            </AppButton>
            <AppButton
              variant="primary"
              size="md"
              onClick={handleCommit}
              disabled={!currentSheetData || effectiveImportCount === 0}
              icon={<Check className="w-4 h-4" />}
            >
              Выполнить импорт
            </AppButton>
          </div>
        </div>
      }
    >
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Mode Selector */}
        <div className="grid grid-cols-2 gap-3 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-medium">
          <button
            type="button"
            onClick={() => setMode('existing')}
            className={`py-2 px-3 rounded-md transition-all text-center flex items-center justify-center gap-2 cursor-pointer ${
              mode === 'existing'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5 text-blue-600" />
            <span>В существующую вкладку «{currentTab.name}»</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('new')}
            className={`py-2 px-3 rounded-md transition-all text-center flex items-center justify-center gap-2 cursor-pointer ${
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
            <label
              data-testid="excel-dropzone"
              data-drag-over={isDragOver ? 'true' : 'false'}
              {...dropZoneProps}
              className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-xl transition-all px-4 text-center ${
                isParsing
                  ? 'border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-800/30 cursor-wait opacity-75'
                  : isDragOver
                    ? 'border-blue-500 bg-blue-50/85 dark:bg-blue-950/45 ring-2 ring-blue-500/30 cursor-copy'
                    : 'border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 cursor-pointer bg-slate-50 dark:bg-slate-800/50 hover:bg-blue-50/30'
              }`}
            >
              <div className="flex flex-col items-center justify-center pt-5 pb-6 pointer-events-none">
                <Upload
                  className={`w-7 h-7 mb-2 transition-transform ${
                    isDragOver ? 'text-blue-600 dark:text-blue-400 scale-110' : 'text-slate-400'
                  }`}
                />
                <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                  {isDragOver
                    ? 'Отпустите файл таблицы для загрузки'
                    : selectedFile
                      ? selectedFile.name
                      : 'Нажмите для выбора файла или перетащите его сюда'}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  XLSX, XLSM или CSV (UTF-8 и Windows-1251)
                </p>
              </div>
              <input
                type="file"
                accept=".xlsx,.xlsm,.csv"
                onChange={handleInputChange}
                disabled={isParsing}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Errors or Discrepancies */}
        {errorMsg && (
          <StatusBanner variant="error" role="alert" compact title={errorMsg}>
            {discrepancies.length > 0 && (
              <div className="mt-2 space-y-1 max-h-36 overflow-y-auto">
                <p className="text-[11px] font-semibold">Список расхождений:</p>
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
          </StatusBanner>
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
                    <AppButton
                      key={sName}
                      variant={activeSheetName === sName ? 'primary' : 'secondary'}
                      size="xs"
                      onClick={() => handleSelectSheet(sName)}
                    >
                      {sName}
                    </AppButton>
                  ))}
                </div>
              </div>
            )}

            {/* Duplicate column mappings warning */}
            {duplicateAnalysis.duplicateColumnMappings.length > 0 && (
              <StatusBanner
                variant="warning"
                compact
                title="Дублирующее сопоставление столбцов файла"
              >
                <div className="space-y-0.5 text-[11px]">
                  {duplicateAnalysis.duplicateColumnMappings.map((d) => (
                    <div key={d.fileHeader}>
                      Столбец файла «<strong>{d.fileHeader}</strong>» назначен сразу нескольким полям таблицы:{' '}
                      {d.columnNames.join(', ')}.
                    </div>
                  ))}
                </div>
              </StatusBanner>
            )}

            {/* Duplicate rows warning & skip toggle */}
            {totalDuplicatesCount > 0 && (
              <StatusBanner
                variant="warning"
                compact
                title={`Обнаружены дублирующие строки (${totalDuplicatesCount})`}
              >
                <div className="space-y-2 text-[11px]">
                  <p>
                    {duplicateAnalysis.duplicateAgainstExistingIndices.length > 0 && (
                      <span>
                        Совпадают с уже имеющимися строками таблицы:{' '}
                        <strong>{duplicateAnalysis.duplicateAgainstExistingIndices.length}</strong>
                        {'. '}
                      </span>
                    )}
                    {duplicateAnalysis.duplicateWithinFileIndices.length > 0 && (
                      <span>
                        Повторяются внутри импортируемого файла:{' '}
                        <strong>{duplicateAnalysis.duplicateWithinFileIndices.length}</strong>.
                      </span>
                    )}
                  </p>
                  <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-amber-900 dark:text-amber-200 select-none">
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={(e) => setSkipDuplicates(e.target.checked)}
                      className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                    />
                    <span>Пропускать дублирующие строки при импорте (добавить только {duplicateAnalysis.uniqueIndices.length})</span>
                  </label>
                </div>
              </StatusBanner>
            )}

            {/* 1C:ZUP Personnel Import Preset */}
            {mode === 'existing' && isEmployeesTarget && (
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/70 dark:bg-indigo-950/30 p-3.5 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-indigo-900 dark:text-indigo-200">
                    <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>Пресет «1С:ЗУП» (Кадры и приём на работу)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AppButton
                      variant={useOneCZupPreset ? 'primary' : 'secondary'}
                      size="xs"
                      onClick={() => {
                        const next = !useOneCZupPreset;
                        setUseOneCZupPreset(next);
                        if (next && currentSheetData) {
                          setColumnMapping(
                            excelService.autoMapOneCZupColumns(
                              currentTab.columns,
                              currentSheetData.headers
                            )
                          );
                        }
                      }}
                    >
                      {useOneCZupPreset ? 'Пресет 1С:ЗУП активен' : 'Применить маппинг 1С:ЗУП'}
                    </AppButton>
                  </div>
                </div>
                {useOneCZupPreset && (
                  <div className="space-y-1.5 text-[11px] text-indigo-900/90 dark:text-indigo-200/90">
                    <label className="inline-flex items-center gap-2 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={autoCreatePositions}
                        onChange={(e) => setAutoCreatePositions(e.target.checked)}
                        className="rounded text-indigo-600"
                      />
                      <span>
                        Автоматически создать отсутствующие должности в «Штатном расписании»
                        (с предзаполнением СОУТ, факторов 29н и норм СИЗ 766н)
                      </span>
                    </label>
                    {zupPreviewPlan && zupPreviewPlan.missingPositionPairs.length > 0 && (
                      <div className="text-[11px] text-indigo-700 dark:text-indigo-300">
                        {autoCreatePositions
                          ? `Будет добавлено новых должностей в справочник: ${zupPreviewPlan.createdPositions.length} (${zupPreviewPlan.missingPositionPairs
                              .slice(0, 3)
                              .map((p) => p.title)
                              .join(', ')}${zupPreviewPlan.missingPositionPairs.length > 3 ? '…' : ''})`
                          : `Обнаружено должностей, отсутствующих в штатном расписании: ${zupPreviewPlan.missingPositionPairs.length}`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Column Mapping (in Existing Tab Mode) */}
            {mode === 'existing' && (
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-800/40 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Сопоставление столбцов вкладки со столбцами из файла:
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      setColumnMapping(
                        useOneCZupPreset && isEmployeesTarget
                          ? excelService.autoMapOneCZupColumns(currentTab.columns, currentSheetData.headers)
                          : excelService.autoMapColumns(currentTab.columns, currentSheetData.headers)
                      )
                    }
                    className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    Автосопоставить заново
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {currentTab.columns.map((col) => {
                    const isRelation = col.type === 'relation';
                    const mappedHeader = columnMapping[col.id] || '';
                    const isDupMapping = Boolean(mappedHeader && duplicateHeaderSet.has(mappedHeader));
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
                        <AppSelect
                          compact
                          error={isDupMapping}
                          value={mappedHeader}
                          onChange={(e) => setColumnMapping({ ...columnMapping, [col.id]: e.target.value })}
                          className="!w-44 truncate"
                        >
                          <option value="">(Не импортировать)</option>
                          {currentSheetData.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </AppSelect>
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
    </AppModal>
  );
};
