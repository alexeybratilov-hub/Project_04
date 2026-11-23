import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Columns,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Link2,
  Check,
  AlertTriangle,
  Link as LinkIcon,
  List,
  Calendar,
  Hash,
  Type,
  CheckSquare,
  Edit2,
  ExternalLink,
  Clock,
  SlidersHorizontal,
  RefreshCw,
  ArrowRight,
  Lock
} from 'lucide-react';
import {
  Column,
  ColumnType,
  DeadlineColumnConfig,
  getColumnTypeLabel,
  Row,
  Tab,
  Tag
} from '../types/database';
import { createUniqueId, integrityService } from '../services/integrityService';
import {
  applyColumnTypeConversion,
  applyScalarColumnTypeConversion,
  DeadlineConversionTargetField,
  DeadlineLostFieldKey,
  DeadlineReverseExtractMode,
  DEFAULT_DEADLINE_COLUMN_CONFIG,
  formatDeadlineConfigShortSummary,
  FromDeadlineConversionPreview,
  previewConversionFromDeadline,
  previewConversionToDeadline,
  previewScalarConversion,
  resolveSafeRowIdentifier,
  ScalarConversionPreview,
  ToDeadlineConversionPreview
} from '../services/deadlineService';
import {
  createDeadlineConfigDraft,
  DeadlineConfigDraft,
  DeadlineConfigFields,
  validateAndBuildDeadlineConfig
} from './DeadlineConfigFields';
import {
  AppButton,
  AppInput,
  AppModal,
  AppSelect,
  ConfirmDialog,
  FormField,
  InlineConfirm,
  StatusBanner
} from './ui';

export interface ColumnEditorSaveResult {
  ok: boolean;
  error?: string;
  backupFileName?: string;
}

interface ColumnEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: Tab;
  allTabs: Tab[];
  tags?: Tag[];
  holidays?: string[];
  onUpdateColumns: (
    tabId: string,
    columns: Column[],
    updatedRows?: Row[],
    options?: {
      hasTypeConversions?: boolean;
      hasNonEmptyRowConversions?: boolean;
    }
  ) => void | ColumnEditorSaveResult | Promise<void | ColumnEditorSaveResult>;
}

const CONVERTIBLE_COLUMN_TYPES: Array<{ value: Exclude<ColumnType, 'relation'>; label: string }> = [
  { value: 'text', label: 'Текст (строка, ФИО, описание)' },
  { value: 'number', label: 'Число (количество, разряд, ставка)' },
  { value: 'date', label: 'Дата (ГГГГ-ММ-ДД)' },
  { value: 'select', label: 'Выпадающий список (выбор из вариантов)' },
  { value: 'boolean', label: 'Да / Нет (флажок)' },
  { value: 'link', label: 'Ссылка (URL / веб-адрес)' },
  { value: 'deadline_control', label: 'Контроль сроков (периодичность и статусы)' }
];

export const DEADLINE_LOST_FIELD_LABELS: Record<DeadlineLostFieldKey, string> = {
  actualDate: 'Фактическая дата (actualDate)',
  manualNextDate: 'Ручная плановая дата (manualNextDate)',
  note: 'Примечание (note)',
  _rawOriginal: 'Исходный текст (_rawOriginal)'
};

export const FromDeadlinePreviewPanel: React.FC<{
  preview: FromDeadlineConversionPreview;
  rowIdentifierById: Map<string, string>;
}> = ({ preview, rowIdentifierById }) => {
  const lostFieldEntries = (
    Object.keys(DEADLINE_LOST_FIELD_LABELS) as DeadlineLostFieldKey[]
  )
    .map((key) => ({
      key,
      label: DEADLINE_LOST_FIELD_LABELS[key],
      count: preview.lostFieldsSummary?.[key] ?? 0
    }))
    .filter((item) => item.count > 0);

  return (
    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-3">
      <div className="font-semibold text-slate-800 dark:text-slate-100">
        Предварительный просмотр обратного преобразования
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <div className="text-[10px] text-slate-500">Всего строк</div>
          <div className="text-sm font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100">
            {preview.totalRows}
          </div>
        </div>
        <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
          <div className="text-[10px] text-emerald-700 dark:text-emerald-300">Перенесётся</div>
          <div className="text-sm font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
            {preview.convertedCount}
          </div>
        </div>
        <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <div className="text-[10px] text-slate-500">Пустых ячеек</div>
          <div className="text-sm font-bold font-mono tabular-nums text-slate-600 dark:text-slate-300">
            {preview.emptyCount}
          </div>
        </div>
        <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800">
          <div className="text-[10px] text-red-700 dark:text-red-300">Без значения / потеря</div>
          <div className="text-sm font-bold font-mono tabular-nums text-red-700 dark:text-red-300">
            {preview.lostDataCount}
          </div>
        </div>
      </div>

      {lostFieldEntries.length > 0 && (
        <StatusBanner
          variant="warning"
          compact
          title={
            preview.partialLossCount > 0
              ? `Будут потеряны поля контроля сроков (частичный перенос в ${preview.partialLossCount} стр.):`
              : 'Будут потеряны следующие поля контроля сроков:'
          }
        >
          <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
            {lostFieldEntries.map((item) => (
              <li key={item.key}>
                <span className="font-medium">{item.label}</span> — в {item.count} стр.
              </li>
            ))}
          </ul>
        </StatusBanner>
      )}

      {preview.lostDataCount > 0 ? (
        <StatusBanner
          variant="warning"
          compact
          title={`Внимание: ${preview.lostDataCount} непустых строк останутся пустыми`}
        >
          <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
            {preview.samplesOfLostData.map((sample) => (
              <li key={sample.rowId}>
                <span className="font-medium">
                  {rowIdentifierById.get(sample.rowId) || sample.rowId}
                </span>{' '}
                ({sample.summary || 'пусто'}): {sample.reason}
              </li>
            ))}
          </ul>
        </StatusBanner>
      ) : lostFieldEntries.length === 0 ? (
        <StatusBanner variant="success" compact>
          Все непустые записи и заполненные поля будут перенесены без потерь.
        </StatusBanner>
      ) : null}
    </div>
  );
};

function isCellNonEmptyForBackup(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') return val.trim() !== '';
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    return Boolean(obj.actualDate || obj.manualNextDate || obj.note || obj._rawOriginal);
  }
  return true;
}

export const ColumnEditorModal: React.FC<ColumnEditorModalProps> = ({
  isOpen,
  onClose,
  currentTab,
  allTabs,
  tags = [],
  holidays = [],
  onUpdateColumns
}) => {
  const [columns, setColumns] = useState<Column[]>(currentTab?.columns || []);
  const [draftRows, setDraftRows] = useState<Row[]>(currentTab?.rows || []);
  const [hasRowDraftChanges, setHasRowDraftChanges] = useState(false);
  const [convertedColIds, setConvertedColIds] = useState<string[]>([]);
  const [hasNonEmptyConversion, setHasNonEmptyConversion] = useState(false);

  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState<ColumnType>('text');
  const [newColWidth, setNewColWidth] = useState<number>(180);
  const [newColOptions, setNewColOptions] = useState('');
  const [newColRelTabId, setNewColRelTabId] = useState('');
  const [newColRelColId, setNewColRelColId] = useState('');
  const [newColDeadlineDraft, setNewColDeadlineDraft] = useState<DeadlineConfigDraft>(() =>
    createDeadlineConfigDraft(DEFAULT_DEADLINE_COLUMN_CONFIG)
  );

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Inline rename state
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editingColName, setEditingColName] = useState('');

  // Inline deadline_control config editor state
  const [editingDeadlineColId, setEditingDeadlineColId] = useState<string | null>(null);
  const [editingDeadlineDraft, setEditingDeadlineDraft] = useState<DeadlineConfigDraft | null>(null);
  const [editingDeadlineBackupConfig, setEditingDeadlineBackupConfig] =
    useState<DeadlineColumnConfig | null>(null);

  // Nested column type conversion modal state
  const [convertingColId, setConvertingColId] = useState<string | null>(null);
  const [convertTargetType, setConvertTargetType] =
    useState<Exclude<ColumnType, 'relation'>>('deadline_control');
  const [convertTargetField, setConvertTargetField] =
    useState<DeadlineConversionTargetField>('actualDate');
  const [convertExtractMode, setConvertExtractMode] =
    useState<DeadlineReverseExtractMode>('effectiveNextDate');
  const [convertDeadlineDraft, setConvertDeadlineDraft] = useState<DeadlineConfigDraft>(() =>
    createDeadlineConfigDraft(DEFAULT_DEADLINE_COLUMN_CONFIG)
  );
  const [convertSelectOptions, setConvertSelectOptions] = useState('');
  const [convertErrorMsg, setConvertErrorMsg] = useState('');

  // Inline delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingDiscardConfirm, setPendingDiscardConfirm] = useState(false);

  const prevOpenRef = useRef(false);
  const prevTabIdRef = useRef<string | undefined>(undefined);

  // Initialize local draft strictly when modal opens or active tab switches
  useEffect(() => {
    const justOpened = isOpen && !prevOpenRef.current;
    const tabChanged = isOpen && currentTab?.id !== prevTabIdRef.current;
    prevOpenRef.current = isOpen;
    prevTabIdRef.current = currentTab?.id;

    if ((justOpened || tabChanged) && currentTab) {
      setColumns(JSON.parse(JSON.stringify(currentTab.columns || [])));
      setDraftRows(JSON.parse(JSON.stringify(currentTab.rows || [])));
      setHasRowDraftChanges(false);
      setConvertedColIds([]);
      setHasNonEmptyConversion(false);
      setConfirmDeleteId(null);
      setPendingDiscardConfirm(false);
      setEditingColId(null);
      setEditingColName('');
      setEditingDeadlineColId(null);
      setEditingDeadlineDraft(null);
      setEditingDeadlineBackupConfig(null);
      setConvertingColId(null);
      setConvertErrorMsg('');
      setNewColName('');
      setNewColType('text');
      setNewColWidth(180);
      setNewColOptions('');
      setNewColDeadlineDraft(createDeadlineConfigDraft(DEFAULT_DEADLINE_COLUMN_CONFIG));
      setErrorMsg('');
      setSuccessMsg('');
      setIsSaving(false);
    }
  }, [currentTab, isOpen]);

  const masterCandidates = allTabs.filter((t) => t.id !== currentTab?.id);

  useEffect(() => {
    if (newColType === 'relation' && masterCandidates.length > 0) {
      if (!newColRelTabId || !masterCandidates.some((t) => t.id === newColRelTabId)) {
        const firstTab = masterCandidates[0];
        setNewColRelTabId(firstTab.id);
        if (firstTab.columns && firstTab.columns[0]) {
          setNewColRelColId(firstTab.columns[0].id);
        }
      }
    }
  }, [newColType, masterCandidates, newColRelTabId]);

  const columnsChanged =
    Boolean(currentTab) && JSON.stringify(columns) !== JSON.stringify(currentTab.columns || []);

  const hasInvalidOpenDeadlineDraft = Boolean(
    editingDeadlineColId &&
      editingDeadlineDraft &&
      !validateAndBuildDeadlineConfig(editingDeadlineDraft).ok
  );

  const isDirty =
    columnsChanged ||
    hasRowDraftChanges ||
    hasInvalidOpenDeadlineDraft ||
    Boolean(editingColId) ||
    Boolean(newColName.trim());

  const requestClose = useCallback(() => {
    if (isSaving) return;
    if (isDirty) {
      setPendingDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [isDirty, isSaving, onClose]);

  const convertingCol = useMemo(
    () => (convertingColId ? columns.find((c) => c.id === convertingColId) || null : null),
    [columns, convertingColId]
  );

  const rowIdentifierById = useMemo(() => {
    const map = new Map<string, string>();
    draftRows.forEach((row, idx) => {
      map.set(row.id, resolveSafeRowIdentifier(row, currentTab, idx + 1));
    });
    return map;
  }, [currentTab, draftRows]);

  const convertingMasterDependents = useMemo(() => {
    if (!convertingCol || !currentTab) return [];
    const list: Array<{ tabName: string; columnName: string }> = [];
    allTabs.forEach((t) => {
      if (t.id === currentTab.id) return;
      t.columns.forEach((c) => {
        if (
          c.type === 'relation' &&
          c.relation?.masterTabId === currentTab.id &&
          c.relation?.masterColumnId === convertingCol.id
        ) {
          list.push({ tabName: t.name, columnName: c.name });
        }
      });
    });
    return list;
  }, [allTabs, convertingCol, currentTab]);

  const conversionPreview = useMemo<{
    kind: 'to_deadline' | 'from_deadline' | 'scalar';
    toDeadline?: ToDeadlineConversionPreview;
    fromDeadline?: FromDeadlineConversionPreview;
    scalar?: ScalarConversionPreview;
  } | null>(() => {
    if (!convertingCol) return null;
    if (convertTargetType === 'deadline_control') {
      return {
        kind: 'to_deadline',
        toDeadline: previewConversionToDeadline(draftRows, convertingCol.id, {
          targetField: convertTargetField
        })
      };
    }
    if (convertingCol.type === 'deadline_control') {
      return {
        kind: 'from_deadline',
        fromDeadline: previewConversionFromDeadline(
          draftRows,
          convertingCol.id,
          convertTargetType,
          {
            extractMode: convertExtractMode,
            config: convertingCol.deadlineConfig,
            holidays
          }
        )
      };
    }
    return {
      kind: 'scalar',
      scalar: previewScalarConversion(
        draftRows,
        convertingCol.id,
        convertingCol.type,
        convertTargetType
      )
    };
  }, [
    convertExtractMode,
    convertTargetField,
    convertTargetType,
    convertingCol,
    draftRows,
    holidays
  ]);

  if (!currentTab) return null;

  const showSuccess = (msg: string) => {
    setErrorMsg('');
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3500);
  };

  const handleNewColTypeChange = (nextType: ColumnType) => {
    setNewColType(nextType);
    if (nextType === 'deadline_control' && newColWidth === 180) {
      setNewColWidth(210);
    } else if (nextType !== 'deadline_control' && newColWidth === 210) {
      setNewColWidth(180);
    }
  };

  const handleAddColumn = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const trimmedName = newColName.trim();
    if (!trimmedName) {
      setErrorMsg('Пожалуйста, введите название столбца.');
      return;
    }

    if (columns.some((c) => c.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
      setErrorMsg(`Столбец с названием «${trimmedName}» уже существует в этой таблице.`);
      return;
    }

    let parsedOptions: string[] | undefined = undefined;
    if (newColType === 'select') {
      parsedOptions = newColOptions
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parsedOptions.length === 0) {
        parsedOptions = ['Значение 1', 'Значение 2'];
      }
    }

    let relationConfig = undefined;
    if (newColType === 'relation') {
      const targetTabId = newColRelTabId || (masterCandidates[0] ? masterCandidates[0].id : '');
      const selectedTab = allTabs.find((t) => t.id === targetTabId);
      const targetColId =
        newColRelColId || (selectedTab?.columns[0] ? selectedTab.columns[0].id : '');

      if (!targetTabId || !targetColId) {
        setErrorMsg('Для столбца со связью необходимо выбрать мастер-вкладку и целевой столбец.');
        return;
      }
      relationConfig = { masterTabId: targetTabId, masterColumnId: targetColId };
    }

    let deadlineConfig: DeadlineColumnConfig | undefined = undefined;
    if (newColType === 'deadline_control') {
      const validation = validateAndBuildDeadlineConfig(newColDeadlineDraft);
      if (!validation.ok) {
        setErrorMsg(validation.error);
        return;
      }
      deadlineConfig = validation.config;
    }

    const safeWidth = Math.max(70, Math.min(800, Number(newColWidth) || 180));

    const newCol: Column = {
      id: createUniqueId('col'),
      name: trimmedName,
      type: newColType,
      width: safeWidth,
      options: parsedOptions,
      relation: relationConfig,
      deadlineConfig
    };

    const updated = [...columns, newCol];
    setColumns(updated);

    setNewColName('');
    setNewColOptions('');
    if (newColType === 'deadline_control') {
      setNewColDeadlineDraft(createDeadlineConfigDraft(DEFAULT_DEADLINE_COLUMN_CONFIG));
    }
    showSuccess(`Столбец «${newCol.name}» добавлен в черновик.`);
  };

  const executeDeleteColumn = (colId: string) => {
    const colToDelete = columns.find((c) => c.id === colId);
    if (!colToDelete) return;

    const updated = columns.filter((c) => c.id !== colId);
    setColumns(updated);
    if (editingDeadlineColId === colId) {
      setEditingDeadlineColId(null);
      setEditingDeadlineDraft(null);
      setEditingDeadlineBackupConfig(null);
    }
    setConfirmDeleteId(null);
    showSuccess(`Столбец «${colToDelete.name}» удалён из черновика.`);
  };

  const startRenameCol = (col: Column) => {
    setEditingColId(col.id);
    setEditingColName(col.name);
    setConfirmDeleteId(null);
  };

  const saveRenameCol = (colId: string) => {
    const trimmed = editingColName.trim();
    if (!trimmed) {
      setEditingColId(null);
      return;
    }
    const duplicate = columns.some(
      (c) => c.id !== colId && c.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      setErrorMsg(`Столбец с названием «${trimmed}» уже есть в таблице.`);
      return;
    }
    const updated = columns.map((c) => (c.id === colId ? { ...c, name: trimmed } : c));
    setColumns(updated);
    setEditingColId(null);
    showSuccess(`Столбец переименован в «${trimmed}» в черновике.`);
  };

  const handleWidthChange = (colId: string, rawVal: string) => {
    const num = parseInt(rawVal, 10);
    if (isNaN(num)) return;
    const clamped = Math.max(60, Math.min(800, num));
    const updated = columns.map((c) => (c.id === colId ? { ...c, width: clamped } : c));
    setColumns(updated);
  };

  const handleMoveColumn = (index: number, direction: 'up' | 'down') => {
    const next = [...columns];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= next.length) return;
    const temp = next[index];
    next[index] = next[targetIdx];
    next[targetIdx] = temp;
    setColumns(next);
  };

  const toggleDeadlineSettingsEditor = (col: Column) => {
    setErrorMsg('');
    if (editingDeadlineColId === col.id) {
      if (editingDeadlineDraft) {
        const res = validateAndBuildDeadlineConfig(editingDeadlineDraft);
        if (!res.ok) {
          setErrorMsg(res.error);
          return;
        }
      }
      setEditingDeadlineColId(null);
      setEditingDeadlineDraft(null);
      setEditingDeadlineBackupConfig(null);
      return;
    }

    if (editingDeadlineColId && editingDeadlineDraft) {
      const prevCheck = validateAndBuildDeadlineConfig(editingDeadlineDraft);
      if (!prevCheck.ok) {
        setErrorMsg(prevCheck.error);
        return;
      }
    }

    setConfirmDeleteId(null);
    setEditingDeadlineColId(col.id);
    setEditingDeadlineBackupConfig(
      col.deadlineConfig ? { ...col.deadlineConfig } : { ...DEFAULT_DEADLINE_COLUMN_CONFIG }
    );
    setEditingDeadlineDraft(
      createDeadlineConfigDraft(col.deadlineConfig ?? DEFAULT_DEADLINE_COLUMN_CONFIG)
    );
  };

  const handleDeadlineDraftChange = (colId: string, nextDraft: DeadlineConfigDraft) => {
    setEditingDeadlineDraft(nextDraft);
    const res = validateAndBuildDeadlineConfig(nextDraft);
    if (res.ok) {
      setErrorMsg('');
      setColumns((prev) =>
        prev.map((c) => (c.id === colId ? { ...c, deadlineConfig: res.config } : c))
      );
    }
  };

  const cancelDeadlineSettingsEdit = (colId: string) => {
    if (editingDeadlineBackupConfig) {
      setColumns((prev) =>
        prev.map((c) =>
          c.id === colId ? { ...c, deadlineConfig: { ...editingDeadlineBackupConfig } } : c
        )
      );
    }
    setErrorMsg('');
    setEditingDeadlineColId(null);
    setEditingDeadlineDraft(null);
    setEditingDeadlineBackupConfig(null);
  };

  const openTypeConversionModal = (col: Column) => {
    if (col.type === 'relation') return;
    if (editingDeadlineColId && editingDeadlineDraft) {
      const check = validateAndBuildDeadlineConfig(editingDeadlineDraft);
      if (!check.ok) {
        setErrorMsg(check.error);
        return;
      }
    }
    setErrorMsg('');
    setConvertErrorMsg('');
    setConfirmDeleteId(null);

    const defaultTarget: Exclude<ColumnType, 'relation'> =
      col.type === 'deadline_control' ? 'date' : 'deadline_control';
    setConvertTargetType(defaultTarget);
    setConvertTargetField('actualDate');
    setConvertExtractMode(defaultTarget === 'date' ? 'effectiveNextDate' : 'summary');
    setConvertDeadlineDraft(
      createDeadlineConfigDraft(col.deadlineConfig ?? DEFAULT_DEADLINE_COLUMN_CONFIG)
    );

    const existingUniqueVals = Array.from(
      new Set(
        draftRows
          .map((r) => {
            const v = r[col.id];
            if (v === null || v === undefined || typeof v === 'object') return '';
            return String(v).trim();
          })
          .filter(Boolean)
      )
    ).slice(0, 20);
    setConvertSelectOptions(existingUniqueVals.join(', '));
    setConvertingColId(col.id);
  };

  const handleConvertTargetTypeChange = (nextTarget: Exclude<ColumnType, 'relation'>) => {
    setConvertTargetType(nextTarget);
    setConvertErrorMsg('');
    if (nextTarget === 'date') {
      setConvertExtractMode('effectiveNextDate');
    } else if (nextTarget === 'text') {
      setConvertExtractMode('summary');
    }
  };

  const handleApplyTypeConversion = () => {
    if (!convertingCol) return;
    setConvertErrorMsg('');

    let nextDeadlineCfg: DeadlineColumnConfig | undefined;
    if (convertTargetType === 'deadline_control') {
      const cfgRes = validateAndBuildDeadlineConfig(convertDeadlineDraft);
      if (!cfgRes.ok) {
        setConvertErrorMsg(cfgRes.error);
        return;
      }
      nextDeadlineCfg = cfgRes.config;
    }

    try {
      const workingTab: Tab = {
        ...currentTab,
        columns,
        rows: draftRows
      };

      const hadNonEmptyBefore = draftRows.some((r) => isCellNonEmptyForBackup(r[convertingCol.id]));

      const selectOpts =
        convertTargetType === 'select'
          ? convertSelectOptions
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;

      let nextTab: Tab;
      if (convertTargetType === 'deadline_control' || convertingCol.type === 'deadline_control') {
        const res = applyColumnTypeConversion(workingTab, convertingCol.id, convertTargetType, {
          targetField: convertTargetField,
          extractMode: convertExtractMode,
          deadlineConfig: nextDeadlineCfg,
          holidays,
          selectOptions: selectOpts
        });
        nextTab = res.tab;
      } else {
        const res = applyScalarColumnTypeConversion(
          workingTab,
          convertingCol.id,
          convertTargetType,
          { selectOptions: selectOpts }
        );
        nextTab = res.tab;
      }

      const hasNonEmptyAfter = nextTab.rows.some((r) =>
        isCellNonEmptyForBackup(r[convertingCol.id])
      );

      setColumns(nextTab.columns);
      setDraftRows(nextTab.rows);
      setHasRowDraftChanges(true);
      setConvertedColIds((prev) =>
        prev.includes(convertingCol.id) ? prev : [...prev, convertingCol.id]
      );
      if (hadNonEmptyBefore || hasNonEmptyAfter) {
        setHasNonEmptyConversion(true);
      }
      if (editingDeadlineColId === convertingCol.id) {
        setEditingDeadlineColId(null);
        setEditingDeadlineDraft(null);
        setEditingDeadlineBackupConfig(null);
      }

      setConvertingColId(null);
      showSuccess(
        `Тип столбца «${convertingCol.name}» изменён на «${getColumnTypeLabel(convertTargetType)}» в черновике. Нажмите «Сохранить изменения» для применения.`
      );
    } catch (err: any) {
      setConvertErrorMsg(err?.message || 'Не удалось выполнить преобразование столбца.');
    }
  };

  const handleSaveAndClose = async () => {
    setErrorMsg('');

    if (editingDeadlineColId && editingDeadlineDraft) {
      const deadlineCheck = validateAndBuildDeadlineConfig(editingDeadlineDraft);
      if (!deadlineCheck.ok) {
        setErrorMsg(deadlineCheck.error);
        return;
      }
    }

    let nextColumns = columns;

    if (editingColId) {
      const trimmed = editingColName.trim();
      if (trimmed) {
        const duplicate = nextColumns.some(
          (c) => c.id !== editingColId && c.name.trim().toLowerCase() === trimmed.toLowerCase()
        );
        if (duplicate) {
          setErrorMsg(`Столбец с названием «${trimmed}» уже есть в таблице.`);
          return;
        }
        nextColumns = nextColumns.map((c) =>
          c.id === editingColId ? { ...c, name: trimmed } : c
        );
      }
      setEditingColId(null);
    }

    const hasStructuralChanges =
      JSON.stringify(nextColumns) !== JSON.stringify(currentTab.columns || []);

    if (!hasStructuralChanges && !hasRowDraftChanges && newColName.trim()) {
      setErrorMsg(
        `Нажмите «Добавить столбец в таблицу», чтобы включить новое поле «${newColName.trim()}» перед сохранением.`
      );
      return;
    }

    if (hasStructuralChanges || hasRowDraftChanges) {
      setIsSaving(true);
      try {
        const res = await onUpdateColumns(
          currentTab.id,
          nextColumns,
          hasRowDraftChanges ? draftRows : undefined,
          {
            hasTypeConversions: convertedColIds.length > 0,
            hasNonEmptyRowConversions: hasNonEmptyConversion
          }
        );
        if (res && typeof res === 'object' && 'ok' in res && !res.ok) {
          setErrorMsg(
            res.error || 'Не удалось сохранить изменения столбцов. Исходная база данных не изменена.'
          );
          return;
        }
      } finally {
        setIsSaving(false);
      }
    }
    onClose();
  };

  const selectedMasterTab =
    masterCandidates.find((t) => t.id === newColRelTabId) || masterCandidates[0];

  const availableTargetTypes = CONVERTIBLE_COLUMN_TYPES.filter(
    (opt) => opt.value !== convertingCol?.type
  );

  return (
    <>
      <AppModal
        isOpen={isOpen}
        onClose={requestClose}
        closeDisabled={isSaving}
        closeOnEscape={!editingColId && !convertingColId && !isSaving}
        size="4xl"
        icon={<Columns className="w-5 h-5" />}
        iconTone="blue"
        title={`Настройка столбцов вкладки «${currentTab.name}»`}
        subtitle="Добавление, переименование, параметры сроков, смена типа, ширина (px) и порядок"
        footer={
          <div className="w-full flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {isDirty ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  Есть несохранённые изменения черновика
                  {hasNonEmptyConversion ? ' (перед записью будет создана резервная копия)' : ''}
                </span>
              ) : (
                <span>Изменения применяются к таблице после нажатия «Сохранить изменения»</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <AppButton variant="secondary" size="md" onClick={requestClose} disabled={isSaving}>
                Отмена
              </AppButton>
              <AppButton
                variant="primary"
                size="md"
                onClick={handleSaveAndClose}
                disabled={!isDirty || isSaving}
              >
                {isSaving ? 'Сохранение...' : 'Сохранить изменения'}
              </AppButton>
            </div>
          </div>
        }
      >
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          {successMsg && (
            <StatusBanner variant="success" compact>
              {successMsg}
            </StatusBanner>
          )}

          {errorMsg && (
            <StatusBanner variant="error" compact>
              {errorMsg}
            </StatusBanner>
          )}

          {/* ADD COLUMN FORM */}
          <form
            onSubmit={handleAddColumn}
            className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-600" />
                <span>Добавить новый столбец</span>
              </h3>
              <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                Всего в таблице: {columns.length}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <FormField label="Название столбца:" required className="sm:col-span-5">
                <AppInput
                  type="text"
                  placeholder="Например: Медосмотр или Инструктаж"
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                />
              </FormField>

              <FormField label="Тип данных:" className="sm:col-span-5">
                <AppSelect
                  value={newColType}
                  onChange={(e) => handleNewColTypeChange(e.target.value as ColumnType)}
                >
                  <option value="text">Текст (строка, ФИО, описание)</option>
                  <option value="number">Число (количество, разряд, ставка)</option>
                  <option value="date">Дата (ГГГГ-ММ-ДД)</option>
                  <option value="select">Выпадающий список (выбор из вариантов)</option>
                  <option value="boolean">Да / Нет (флажок)</option>
                  <option value="link">Ссылка (URL / веб-адрес)</option>
                  <option value="deadline_control">Контроль сроков (периодичность и статусы)</option>
                  <option value="relation">Связь со справочником (мастер-вкладка 1:N)</option>
                </AppSelect>
              </FormField>

              <FormField label="Ширина (px):" className="sm:col-span-2">
                <AppInput
                  type="number"
                  mono
                  min={60}
                  max={800}
                  step={10}
                  value={newColWidth}
                  onChange={(e) => setNewColWidth(parseInt(e.target.value, 10) || 180)}
                />
              </FormField>
            </div>

            {newColType === 'select' && (
              <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
                <FormField label="Варианты выбора (через запятую):">
                  <AppInput
                    type="text"
                    compact
                    placeholder="Например: Оптимальный, Допустимый, Вредный 3.1, Вредный 3.2"
                    value={newColOptions}
                    onChange={(e) => setNewColOptions(e.target.value)}
                  />
                </FormField>
              </div>
            )}

            {newColType === 'deadline_control' && (
              <DeadlineConfigFields
                compact
                draft={newColDeadlineDraft}
                onChange={setNewColDeadlineDraft}
                title="Параметры нового столбца «Контроль сроков»:"
              />
            )}

            {newColType === 'relation' && (
              <div className="p-3 bg-blue-50/60 dark:bg-blue-950/40 rounded-lg border border-blue-200 dark:border-blue-800 space-y-2">
                <div className="flex items-center gap-1.5 font-medium text-blue-900 dark:text-blue-300 text-xs">
                  <LinkIcon className="w-3.5 h-3.5 text-blue-600" />
                  <span>Настройка связи с мастер-таблицей:</span>
                </div>

                {masterCandidates.length === 0 ? (
                  <p className="text-[11px] text-amber-600">
                    Нет других доступных вкладок для связи. Сначала создайте мастер-вкладку.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <FormField label="Мастер-вкладка (источник):">
                      <AppSelect
                        compact
                        value={newColRelTabId}
                        onChange={(e) => {
                          setNewColRelTabId(e.target.value);
                          const targetT = allTabs.find((t) => t.id === e.target.value);
                          if (targetT && targetT.columns[0]) {
                            setNewColRelColId(targetT.columns[0].id);
                          }
                        }}
                      >
                        {masterCandidates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} {t.isMaster ? '(Мастер)' : ''}
                          </option>
                        ))}
                      </AppSelect>
                    </FormField>

                    <FormField label="Столбец в мастере:">
                      <AppSelect
                        compact
                        value={newColRelColId}
                        onChange={(e) => setNewColRelColId(e.target.value)}
                      >
                        {selectedMasterTab?.columns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({getColumnTypeLabel(c.type)})
                          </option>
                        ))}
                      </AppSelect>
                    </FormField>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <AppButton
                type="submit"
                variant="primary"
                size="md"
                disabled={!newColName.trim()}
                icon={<Plus className="w-4 h-4" />}
              >
                Добавить столбец в таблицу
              </AppButton>
            </div>
          </form>

          {/* Existing Columns List */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                Текущие столбцы таблицы ({columns.length}):
              </h3>
              <span className="text-[11px] text-slate-400">
                Нажмите «Настроить» у контроля сроков или «Изменить тип» для безопасной конвертации
              </span>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              {columns.length === 0 ? (
                <div className="p-6 text-center text-slate-400">
                  В этой таблице пока нет столбцов. Добавьте первый столбец выше.
                </div>
              ) : (
                columns.map((col, index) => {
                  const isRelation = col.type === 'relation';
                  const isDeadline = col.type === 'deadline_control';
                  const masterTab = isRelation
                    ? allTabs.find((t) => t.id === col.relation?.masterTabId)
                    : null;
                  const masterCol = masterTab?.columns.find(
                    (c) => c.id === col.relation?.masterColumnId
                  );
                  const isDeleting = confirmDeleteId === col.id;
                  const isEditing = editingColId === col.id;
                  const isEditingDeadline = editingDeadlineColId === col.id;

                  const impact = isDeleting
                    ? integrityService.getColumnDeleteImpact(currentTab.id, col.id, allTabs, tags)
                    : null;

                  return (
                    <div
                      key={col.id}
                      className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      <div className="p-3 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="font-mono text-slate-400 text-[11px] w-5 text-center shrink-0 tabular-nums">
                            {index + 1}.
                          </span>
                          {isRelation ? (
                            <span
                              title="Связан со справочником"
                              className="p-1 rounded bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 shrink-0"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                            </span>
                          ) : isDeadline ? (
                            <span
                              title="Контроль сроков"
                              className="p-1 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 shrink-0"
                            >
                              <Clock className="w-3.5 h-3.5" />
                            </span>
                          ) : col.type === 'select' ? (
                            <span
                              title="Выпадающий список"
                              className="p-1 rounded bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 shrink-0"
                            >
                              <List className="w-3.5 h-3.5" />
                            </span>
                          ) : col.type === 'date' ? (
                            <span
                              title="Дата"
                              className="p-1 rounded bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 shrink-0"
                            >
                              <Calendar className="w-3.5 h-3.5" />
                            </span>
                          ) : col.type === 'number' ? (
                            <span
                              title="Число"
                              className="p-1 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 shrink-0"
                            >
                              <Hash className="w-3.5 h-3.5" />
                            </span>
                          ) : col.type === 'boolean' ? (
                            <span
                              title="Флаг Да/Нет"
                              className="p-1 rounded bg-cyan-100 dark:bg-cyan-950 text-cyan-600 dark:text-cyan-400 shrink-0"
                            >
                              <CheckSquare className="w-3.5 h-3.5" />
                            </span>
                          ) : col.type === 'link' ? (
                            <span
                              title="Ссылка (URL)"
                              className="p-1 rounded bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400 shrink-0"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </span>
                          ) : (
                            <span
                              title="Текст"
                              className="p-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0"
                            >
                              <Type className="w-3.5 h-3.5" />
                            </span>
                          )}

                          {isEditing ? (
                            <div className="flex items-center gap-1.5 flex-1 max-w-xs">
                              <AppInput
                                type="text"
                                compact
                                value={editingColName}
                                onChange={(e) => setEditingColName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    saveRenameCol(col.id);
                                  }
                                  if (e.key === 'Escape') {
                                    e.stopPropagation();
                                    setEditingColId(null);
                                  }
                                }}
                                autoFocus
                                className="flex-1 font-medium"
                              />
                              <button
                                type="button"
                                onClick={() => saveRenameCol(col.id)}
                                className="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 cursor-pointer"
                                title="Сохранить название"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                onDoubleClick={() => startRenameCol(col)}
                                className="font-semibold text-slate-800 dark:text-slate-200 truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                                title="Двойной клик для переименования"
                              >
                                {col.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => startRenameCol(col)}
                                className="p-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded transition-colors shrink-0 cursor-pointer"
                                title="Переименовать столбец"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}

                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-medium shrink-0 ${
                              isDeadline
                                ? 'bg-amber-100/80 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {getColumnTypeLabel(col.type)}
                          </span>

                          {isDeadline && (
                            <span
                              className="text-[10px] text-slate-500 dark:text-slate-400 truncate hidden md:inline-block"
                              title={formatDeadlineConfigShortSummary(col.deadlineConfig)}
                            >
                              {formatDeadlineConfigShortSummary(col.deadlineConfig)}
                            </span>
                          )}

                          {isRelation && masterTab && (
                            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium truncate bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900 hidden md:inline-block">
                              → {masterTab.name} ({masterCol?.name || 'ключ'})
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                          {isDeadline && (
                            <AppButton
                              type="button"
                              variant={isEditingDeadline ? 'primary' : 'secondary'}
                              size="sm"
                              onClick={() => toggleDeadlineSettingsEditor(col)}
                              icon={<SlidersHorizontal className="w-3 h-3" />}
                              title="Настроить периодичность и предупреждения"
                            >
                              Настроить
                            </AppButton>
                          )}

                          <AppButton
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={isRelation}
                            onClick={() => openTypeConversionModal(col)}
                            icon={
                              isRelation ? (
                                <Lock className="w-3 h-3" />
                              ) : (
                                <RefreshCw className="w-3 h-3" />
                              )
                            }
                            title={
                              isRelation
                                ? 'Смена типа столбца со связью (relation) заблокирована. Сначала открепите связь.'
                                : 'Безопасно изменить тип данных столбца с предпросмотром'
                            }
                          >
                            Изменить тип
                          </AppButton>

                          <div
                            className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700"
                            title="Ширина столбца в пикселях"
                          >
                            <span className="text-[10px] text-slate-400">Ширина:</span>
                            <input
                              type="number"
                              min={60}
                              max={800}
                              step={10}
                              value={col.width || 180}
                              onChange={(e) => handleWidthChange(col.id, e.target.value)}
                              className="w-11 bg-transparent text-right font-mono tabular-nums text-[11px] font-semibold text-slate-700 dark:text-slate-200 outline-hidden"
                            />
                            <span className="text-[10px] text-slate-400">px</span>
                          </div>

                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleMoveColumn(index, 'up')}
                              disabled={index === 0}
                              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20 rounded transition-colors cursor-pointer"
                              title="Поднять выше (влево в таблице)"
                            >
                              <ArrowUp className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveColumn(index, 'down')}
                              disabled={index === columns.length - 1}
                              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20 rounded transition-colors cursor-pointer"
                              title="Опустить ниже (вправо в таблице)"
                            >
                              <ArrowDown className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(isDeleting ? null : col.id)}
                              className={`p-1 rounded transition-colors ml-0.5 cursor-pointer ${
                                isDeleting
                                  ? 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400'
                                  : 'text-slate-400 hover:text-red-600'
                              }`}
                              title="Удалить столбец"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Inline Deadline Settings Editor */}
                      {isDeadline && isEditingDeadline && editingDeadlineDraft && (
                        <div className="px-4 pb-3.5 pt-1 bg-amber-50/30 dark:bg-amber-950/10 border-t border-amber-200/60 dark:border-amber-900/50 space-y-2.5">
                          <DeadlineConfigFields
                            compact
                            draft={editingDeadlineDraft}
                            onChange={(nextDraft) => handleDeadlineDraftChange(col.id, nextDraft)}
                            title={`Настройки контроля сроков для «${col.name}»:`}
                          />
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                            <span>
                              Изменение периодичности и порога предупреждения не удаляет и не искажает уже внесённые фактические и ручные даты в строках.
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              <AppButton
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => cancelDeadlineSettingsEdit(col.id)}
                              >
                                Отменить правку
                              </AppButton>
                              <AppButton
                                type="button"
                                variant="primary"
                                size="sm"
                                onClick={() => toggleDeadlineSettingsEditor(col)}
                              >
                                Готово
                              </AppButton>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Inline Delete Confirmation Bar with Integrity Impact Warning */}
                      {isDeleting && impact && (
                        <InlineConfirm
                          className="rounded-none border-x-0 border-b-0"
                          message={
                            impact.affectedTabs.length > 0 || impact.affectedTagsCount > 0
                              ? 'Внимание: удаление столбца затронет зависимости!'
                              : `Удалить столбец «${col.name}» из вкладки «${currentTab.name}»?`
                          }
                          details={
                            impact.affectedTabs.length > 0 || impact.affectedTagsCount > 0 ? (
                              <div className="space-y-0.5">
                                {impact.affectedTabs.length > 0 && (
                                  <div>
                                    Связанные столбцы будут откреплены (преобразованы в текст с сохранением значений) в:{' '}
                                    {impact.affectedTabs
                                      .map((t) => `${t.tabName} (${t.affectedRowCount} зап.)`)
                                      .join(', ')}
                                    .
                                  </div>
                                )}
                                {impact.affectedTagsCount > 0 && (
                                  <div>
                                    Будут автоматически удалены привязанные теги шаблонов (
                                    {impact.affectedTagsCount} шт.).
                                  </div>
                                )}
                              </div>
                            ) : undefined
                          }
                          confirmLabel="Подтвердить удаление"
                          cancelLabel="Отмена"
                          onCancel={() => setConfirmDeleteId(null)}
                          onConfirm={() => executeDeleteColumn(col.id)}
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </AppModal>

      {/* Nested Safe Column Type Conversion Modal */}
      <AppModal
        isOpen={Boolean(convertingCol)}
        onClose={() => setConvertingColId(null)}
        layer="nested"
        size="2xl"
        icon={<RefreshCw className="w-5 h-5" />}
        iconTone="amber"
        title={
          convertingCol
            ? `Изменение типа столбца «${convertingCol.name}»`
            : 'Изменение типа столбца'
        }
        subtitle="Предварительный просмотр преобразования данных без скрытой потери значений"
        footer={
          <div className="w-full flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Изменение применится к черновику; запись на диск — по кнопке «Сохранить изменения»
            </span>
            <div className="flex items-center gap-2">
              <AppButton
                variant="secondary"
                size="md"
                onClick={() => setConvertingColId(null)}
              >
                Отмена
              </AppButton>
              <AppButton
                variant="primary"
                size="md"
                onClick={handleApplyTypeConversion}
                icon={<Check className="w-4 h-4" />}
              >
                Применить к черновику
              </AppButton>
            </div>
          </div>
        }
      >
        {convertingCol && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
            {convertErrorMsg && (
              <StatusBanner variant="error" compact>
                {convertErrorMsg}
              </StatusBanner>
            )}

            {convertingMasterDependents.length > 0 && (
              <StatusBanner variant="warning" compact title="Столбец используется в связях">
                <div>
                  Этот столбец является источником связи для других таблиц:{' '}
                  {convertingMasterDependents
                    .map((d) => `${d.tabName} (${d.columnName})`)
                    .join(', ')}
                  . После смены типа на несовместимый формат проверьте аудит связей.
                </div>
              </StatusBanner>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <div className="sm:col-span-5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Текущий тип
                </div>
                <div className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-semibold text-slate-800 dark:text-slate-200">
                  {getColumnTypeLabel(convertingCol.type)}
                </div>
              </div>

              <div className="sm:col-span-1 flex items-center justify-center pb-2 text-slate-400">
                <ArrowRight className="w-4 h-4" />
              </div>

              <FormField label="Новый тип данных:" className="sm:col-span-6">
                <AppSelect
                  value={convertTargetType}
                  onChange={(e) =>
                    handleConvertTargetTypeChange(
                      e.target.value as Exclude<ColumnType, 'relation'>
                    )
                  }
                >
                  {availableTargetTypes.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </AppSelect>
              </FormField>
            </div>

            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Преобразование в столбец со связью («Связь») или из него выполняется только через настройку связей во избежание нарушения ссылочной целостности.
            </div>

            {/* Target: deadline_control */}
            {convertTargetType === 'deadline_control' && (
              <div className="space-y-3">
                <FormField label="Как интерпретировать существующие даты в ячейках:">
                  <AppSelect
                    value={convertTargetField}
                    onChange={(e) =>
                      setConvertTargetField(e.target.value as DeadlineConversionTargetField)
                    }
                  >
                    <option value="actualDate">
                      Использовать как фактическую дату последнего выполнения (рекомендуется — рассчитает следующий срок)
                    </option>
                    <option value="manualNextDate">
                      Использовать как плановую следующую дату (устанавливается вручную)
                    </option>
                  </AppSelect>
                </FormField>

                <DeadlineConfigFields
                  compact
                  draft={convertDeadlineDraft}
                  onChange={setConvertDeadlineDraft}
                  title="Параметры контроля сроков после преобразования:"
                />
              </div>
            )}

            {/* Source: deadline_control -> date / text */}
            {convertingCol.type === 'deadline_control' && convertTargetType === 'date' && (
              <FormField label="Какую дату перенести в столбец типа «Дата»:">
                <AppSelect
                  value={convertExtractMode}
                  onChange={(e) =>
                    setConvertExtractMode(e.target.value as DeadlineReverseExtractMode)
                  }
                >
                  <option value="effectiveNextDate">
                    Плановая следующая дата (ручная или рассчитанная)
                  </option>
                  <option value="actualDate">Фактическая дата последнего выполнения</option>
                </AppSelect>
              </FormField>
            )}

            {convertingCol.type === 'deadline_control' && convertTargetType === 'text' && (
              <FormField label="Формат текста при обратном преобразовании:">
                <AppSelect
                  value={convertExtractMode}
                  onChange={(e) =>
                    setConvertExtractMode(e.target.value as DeadlineReverseExtractMode)
                  }
                >
                  <option value="summary">Сводка (План / Статус / Факт)</option>
                  <option value="effectiveNextDate">Только плановая дата (ДД.ММ.ГГГГ)</option>
                  <option value="actualDate">Только фактическая дата (ДД.ММ.ГГГГ)</option>
                  <option value="rawOriginal">
                    Восстановить исходное текстовое значение (_rawOriginal)
                  </option>
                </AppSelect>
              </FormField>
            )}

            {convertTargetType === 'select' && (
              <FormField label="Варианты выпадающего списка (через запятую):">
                <AppInput
                  type="text"
                  compact
                  value={convertSelectOptions}
                  onChange={(e) => setConvertSelectOptions(e.target.value)}
                  placeholder="Автоматически соберутся из непустых значений, если оставить пустым"
                />
              </FormField>
            )}

            {/* Mandatory Preview Summary */}
            {conversionPreview?.kind === 'to_deadline' && conversionPreview.toDeadline && (
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-3">
                <div className="font-semibold text-slate-800 dark:text-slate-100">
                  Предварительный просмотр преобразования в «Контроль сроков»
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <div className="text-[10px] text-slate-500">Всего строк</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100">
                      {conversionPreview.toDeadline.totalRows}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-300">
                      Распознано дат
                    </div>
                    <div className="text-sm font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                      {conversionPreview.toDeadline.recognizedCount}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <div className="text-[10px] text-slate-500">Пустых ячеек</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {conversionPreview.toDeadline.emptyCount}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
                    <div className="text-[10px] text-amber-800 dark:text-amber-300">
                      Нераспознанных
                    </div>
                    <div className="text-sm font-bold font-mono tabular-nums text-amber-800 dark:text-amber-300">
                      {conversionPreview.toDeadline.unrecognizedCount}
                    </div>
                  </div>
                </div>

                {conversionPreview.toDeadline.unrecognizedCount > 0 ? (
                  <StatusBanner
                    variant="warning"
                    compact
                    title="Нераспознанные значения будут сохранены без удаления"
                  >
                    <div className="space-y-1.5">
                      <div>
                        Для {conversionPreview.toDeadline.unrecognizedCount} строк дата не
                        распознана. Исходный текст сохранится в ячейке (<code>_rawOriginal</code>)
                        со значком предупреждения и останется доступным для просмотра и обратного
                        преобразования.
                      </div>
                      <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                        {conversionPreview.toDeadline.unrecognizedSamples.map((sample) => (
                          <li key={sample.rowId}>
                            <span className="font-medium">
                              {rowIdentifierById.get(sample.rowId) || sample.rowId}:
                            </span>{' '}
                            «{sample.rawValue}»
                          </li>
                        ))}
                      </ul>
                    </div>
                  </StatusBanner>
                ) : (
                  <StatusBanner variant="success" compact>
                    Все непустые значения успешно распознаны как даты — потерь данных не ожидается.
                  </StatusBanner>
                )}
              </div>
            )}

            {conversionPreview?.kind === 'from_deadline' && conversionPreview.fromDeadline && (
              <FromDeadlinePreviewPanel
                preview={conversionPreview.fromDeadline}
                rowIdentifierById={rowIdentifierById}
              />
            )}

            {conversionPreview?.kind === 'scalar' && conversionPreview.scalar && (
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-3">
                <div className="font-semibold text-slate-800 dark:text-slate-100">
                  Предварительный просмотр смены типа данных
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <div className="text-[10px] text-slate-500">Всего строк</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100">
                      {conversionPreview.scalar.totalRows}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-300">
                      Преобразуется
                    </div>
                    <div className="text-sm font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                      {conversionPreview.scalar.convertedCount}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <div className="text-[10px] text-slate-500">Пустых ячеек</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {conversionPreview.scalar.emptyCount}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800">
                    <div className="text-[10px] text-red-700 dark:text-red-300">
                      Несовместимых
                    </div>
                    <div className="text-sm font-bold font-mono tabular-nums text-red-700 dark:text-red-300">
                      {conversionPreview.scalar.lostDataCount}
                    </div>
                  </div>
                </div>

                {conversionPreview.scalar.lostDataCount > 0 ? (
                  <StatusBanner
                    variant="warning"
                    compact
                    title={`Несовместимых значений: ${conversionPreview.scalar.lostDataCount}`}
                  >
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                      {conversionPreview.scalar.samplesOfLostData.map((sample) => (
                        <li key={sample.rowId}>
                          <span className="font-medium">
                            {rowIdentifierById.get(sample.rowId) || sample.rowId}
                          </span>{' '}
                          («{sample.rawValue}»): {sample.reason}
                        </li>
                      ))}
                    </ul>
                  </StatusBanner>
                ) : (
                  <StatusBanner variant="success" compact>
                    Все непустые значения совместимы с выбранным типом данных.
                  </StatusBanner>
                )}
              </div>
            )}
          </div>
        )}
      </AppModal>

      <ConfirmDialog
        isOpen={pendingDiscardConfirm}
        danger
        title="Отменить несохранённые изменения?"
        description="В настройках столбцов (включая параметры сроков или смену типа) есть несохранённые изменения. Закрыть окно без сохранения?"
        confirmLabel="Закрыть без сохранения"
        cancelLabel="Вернуться"
        onConfirm={() => {
          setPendingDiscardConfirm(false);
          onClose();
        }}
        onCancel={() => setPendingDiscardConfirm(false)}
      />
    </>
  );
};
