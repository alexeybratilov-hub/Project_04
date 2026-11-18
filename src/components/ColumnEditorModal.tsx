import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Columns, Plus, Trash2, ArrowUp,
  ArrowDown, Link2, Check, AlertTriangle,
  Link as LinkIcon, List, Calendar, Hash, Type, CheckSquare, Edit2, ExternalLink
} from 'lucide-react';
import { Column, ColumnType, Tab, Tag } from '../types/database';
import { createUniqueId, integrityService } from '../services/integrityService';
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

interface ColumnEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: Tab;
  allTabs: Tab[];
  tags?: Tag[];
  onUpdateColumns: (tabId: string, columns: Column[]) => void;
}

export const ColumnEditorModal: React.FC<ColumnEditorModalProps> = ({
  isOpen,
  onClose,
  currentTab,
  allTabs,
  tags = [],
  onUpdateColumns
}) => {
  const [columns, setColumns] = useState<Column[]>(currentTab?.columns || []);
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState<ColumnType>('text');
  const [newColWidth, setNewColWidth] = useState<number>(180);
  const [newColOptions, setNewColOptions] = useState('');
  const [newColRelTabId, setNewColRelTabId] = useState('');
  const [newColRelColId, setNewColRelColId] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Inline rename state
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editingColName, setEditingColName] = useState('');

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
      setConfirmDeleteId(null);
      setPendingDiscardConfirm(false);
      setEditingColId(null);
      setEditingColName('');
      setNewColName('');
      setNewColOptions('');
      setErrorMsg('');
      setSuccessMsg('');
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
  const isDirty = columnsChanged || Boolean(editingColId) || Boolean(newColName.trim());

  const requestClose = useCallback(() => {
    if (isDirty) {
      setPendingDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  if (!currentTab) return null;

  const showSuccess = (msg: string) => {
    setErrorMsg('');
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3000);
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
      const targetColId = newColRelColId || (selectedTab?.columns[0] ? selectedTab.columns[0].id : '');

      if (!targetTabId || !targetColId) {
        setErrorMsg('Для столбца со связью необходимо выбрать мастер-вкладку и целевой столбец.');
        return;
      }
      relationConfig = { masterTabId: targetTabId, masterColumnId: targetColId };
    }

    const safeWidth = Math.max(70, Math.min(800, Number(newColWidth) || 180));

    const newCol: Column = {
      id: createUniqueId('col'),
      name: trimmedName,
      type: newColType,
      width: safeWidth,
      options: parsedOptions,
      relation: relationConfig
    };

    const updated = [...columns, newCol];
    setColumns(updated);

    setNewColName('');
    setNewColOptions('');
    showSuccess(`Столбец «${newCol.name}» добавлен в черновик.`);
  };

  const executeDeleteColumn = (colId: string) => {
    const colToDelete = columns.find((c) => c.id === colId);
    if (!colToDelete) return;

    const updated = columns.filter((c) => c.id !== colId);
    setColumns(updated);
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

  const handleSaveAndClose = () => {
    setErrorMsg('');
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

    if (!hasStructuralChanges && newColName.trim()) {
      setErrorMsg(
        `Нажмите «Добавить столбец в таблицу», чтобы включить новое поле «${newColName.trim()}» перед сохранением.`
      );
      return;
    }

    if (hasStructuralChanges) {
      onUpdateColumns(currentTab.id, nextColumns);
    }
    onClose();
  };

  const selectedMasterTab = masterCandidates.find((t) => t.id === newColRelTabId) || masterCandidates[0];

  return (
    <>
      <AppModal
        isOpen={isOpen}
        onClose={requestClose}
        closeOnEscape={!editingColId}
        size="4xl"
        icon={<Columns className="w-5 h-5" />}
        iconTone="blue"
        title={`Настройка столбцов вкладки «${currentTab.name}»`}
        subtitle="Добавление, переименование, изменение ширины (px), порядка и удаление столбцов"
        footer={
          <div className="w-full flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {isDirty ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  Есть несохранённые изменения черновика
                </span>
              ) : (
                <span>Изменения применяются к таблице после нажатия «Сохранить изменения»</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <AppButton variant="secondary" size="md" onClick={requestClose}>
                Отмена
              </AppButton>
              <AppButton
                variant="primary"
                size="md"
                onClick={handleSaveAndClose}
                disabled={!isDirty}
              >
                Сохранить изменения
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
                  placeholder="Например: Класс условий труда"
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                />
              </FormField>

              <FormField label="Тип данных:" className="sm:col-span-5">
                <AppSelect
                  value={newColType}
                  onChange={(e) => setNewColType(e.target.value as ColumnType)}
                >
                  <option value="text">Текст (строка, ФИО, описание)</option>
                  <option value="number">Число (количество, разряд, ставка)</option>
                  <option value="date">Дата (ГГГГ-ММ-ДД)</option>
                  <option value="select">Выпадающий список (выбор из вариантов)</option>
                  <option value="boolean">Да / Нет (флажок)</option>
                  <option value="link">Ссылка (URL / веб-адрес)</option>
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
                            {c.name} ({c.type})
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
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                Текущие столбцы таблицы ({columns.length}):
              </h3>
              <span className="text-[11px] text-slate-400">
                Нажмите на карандаш для переименования или введите ширину в пикселях
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
                  const masterTab = isRelation ? allTabs.find((t) => t.id === col.relation?.masterTabId) : null;
                  const masterCol = masterTab?.columns.find((c) => c.id === col.relation?.masterColumnId);
                  const isDeleting = confirmDeleteId === col.id;
                  const isEditing = editingColId === col.id;

                  const impact = isDeleting
                    ? integrityService.getColumnDeleteImpact(currentTab.id, col.id, allTabs, tags)
                    : null;

                  return (
                    <div key={col.id} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <div className="p-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <span className="font-mono text-slate-400 text-[11px] w-5 text-center shrink-0 tabular-nums">
                            {index + 1}.
                          </span>
                          {isRelation ? (
                            <span title="Связан со справочником" className="p-1 rounded bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 shrink-0">
                              <Link2 className="w-3.5 h-3.5" />
                            </span>
                          ) : col.type === 'select' ? (
                            <span title="Выпадающий список" className="p-1 rounded bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 shrink-0">
                              <List className="w-3.5 h-3.5" />
                            </span>
                          ) : col.type === 'date' ? (
                            <span title="Дата" className="p-1 rounded bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 shrink-0">
                              <Calendar className="w-3.5 h-3.5" />
                            </span>
                          ) : col.type === 'number' ? (
                            <span title="Число" className="p-1 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 shrink-0">
                              <Hash className="w-3.5 h-3.5" />
                            </span>
                          ) : col.type === 'boolean' ? (
                            <span title="Флаг Да/Нет" className="p-1 rounded bg-cyan-100 dark:bg-cyan-950 text-cyan-600 dark:text-cyan-400 shrink-0">
                              <CheckSquare className="w-3.5 h-3.5" />
                            </span>
                          ) : col.type === 'link' ? (
                            <span title="Ссылка (URL)" className="p-1 rounded bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400 shrink-0">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </span>
                          ) : (
                            <span title="Текст" className="p-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
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

                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono shrink-0">
                            {col.type}
                          </span>

                          {isRelation && masterTab && (
                            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium truncate bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900 hidden md:inline-block">
                              → {masterTab.name} ({masterCol?.name || 'ключ'})
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700" title="Ширина столбца в пикселях">
                            <span className="text-[10px] text-slate-400">Ширина:</span>
                            <input
                              type="number"
                              min={60}
                              max={800}
                              step={10}
                              value={col.width || 180}
                              onChange={(e) => handleWidthChange(col.id, e.target.value)}
                              className="w-12 bg-transparent text-right font-mono tabular-nums text-[11px] font-semibold text-slate-700 dark:text-slate-200 outline-hidden"
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
                              className={`p-1 rounded transition-colors ml-1 cursor-pointer ${
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
                                    {impact.affectedTabs.map((t) => `${t.tabName} (${t.affectedRowCount} зап.)`).join(', ')}.
                                  </div>
                                )}
                                {impact.affectedTagsCount > 0 && (
                                  <div>
                                    Будут автоматически удалены привязанные теги шаблонов ({impact.affectedTagsCount} шт.).
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

      <ConfirmDialog
        isOpen={pendingDiscardConfirm}
        danger
        title="Отменить несохранённые изменения?"
        description="В настройках столбцов есть несохранённые изменения. Закрыть окно без сохранения?"
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
