import React, { useState, useEffect } from 'react';
import { 
  X, Columns, Plus, Trash2, ArrowUp, 
  ArrowDown, Lock, Check, AlertTriangle, 
  Link as LinkIcon, List, Calendar, Hash, Type, CheckSquare, Edit2
} from 'lucide-react';
import { Column, ColumnType, Tab } from '../types/database';

interface ColumnEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: Tab;
  allTabs: Tab[];
  onUpdateColumns: (tabId: string, columns: Column[]) => void;
}

export const ColumnEditorModal: React.FC<ColumnEditorModalProps> = ({
  isOpen,
  onClose,
  currentTab,
  allTabs,
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

  // Inline delete confirmation state (replaces window.confirm which can be blocked in iframes/apps)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Sync columns state when modal opens or tab changes
  useEffect(() => {
    if (currentTab && isOpen) {
      setColumns(currentTab.columns || []);
      setConfirmDeleteId(null);
      setEditingColId(null);
      setErrorMsg('');
      setSuccessMsg('');
    }
  }, [currentTab?.id, currentTab?.columns, isOpen]);

  // Potential master tabs (all tabs other than current tab)
  const masterCandidates = allTabs.filter((t) => t.id !== currentTab?.id);

  // Default relation selection when master candidates change or relation type selected
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

  if (!isOpen || !currentTab) return null;

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
      id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmedName,
      type: newColType,
      width: safeWidth,
      options: parsedOptions,
      relation: relationConfig
    };

    const updated = [...columns, newCol];
    setColumns(updated);
    onUpdateColumns(currentTab.id, updated);

    setNewColName('');
    setNewColOptions('');
    showSuccess(`Столбец «${newCol.name}» успешно добавлен!`);
  };

  const executeDeleteColumn = (colId: string) => {
    const colToDelete = columns.find((c) => c.id === colId);
    if (!colToDelete) return;

    const updated = columns.filter((c) => c.id !== colId);
    setColumns(updated);
    setConfirmDeleteId(null);
    onUpdateColumns(currentTab.id, updated);
    showSuccess(`Столбец «${colToDelete.name}» удален.`);
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
    onUpdateColumns(currentTab.id, updated);
    showSuccess(`Столбец переименован в «${trimmed}».`);
  };

  const handleWidthChange = (colId: string, rawVal: string) => {
    const num = parseInt(rawVal, 10);
    if (isNaN(num)) return;
    const clamped = Math.max(60, Math.min(800, num));
    const updated = columns.map((c) => (c.id === colId ? { ...c, width: clamped } : c));
    setColumns(updated);
    onUpdateColumns(currentTab.id, updated);
  };

  const handleMoveColumn = (index: number, direction: 'up' | 'down') => {
    const next = [...columns];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= next.length) return;
    const temp = next[index];
    next[index] = next[targetIdx];
    next[targetIdx] = temp;
    setColumns(next);
    onUpdateColumns(currentTab.id, next);
  };

  const selectedMasterTab = masterCandidates.find((t) => t.id === newColRelTabId) || masterCandidates[0];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-4xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 rounded-lg">
              <Columns className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Настройка столбцов вкладки «{currentTab.name}»
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Добавление, переименование, изменение ширины (px), порядка и удаление столбцов
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          {/* Feedback banners */}
          {successMsg && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-lg flex items-center gap-2 text-xs">
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 rounded-lg flex items-center gap-2 text-xs">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* ADD COLUMN FORM */}
          <form 
            onSubmit={handleAddColumn} 
            className="p-5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-750 shadow-xs space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-600" />
                <span>Добавить новый столбец</span>
              </h3>
              <span className="text-[11px] text-slate-400">
                Всего в таблице: {columns.length}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-5">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Название столбца <span className="text-red-500">*</span>:
                </label>
                <input
                  type="text"
                  placeholder="Например: Класс условий труда"
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>

              <div className="sm:col-span-5">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Тип данных:
                </label>
                <select
                  value={newColType}
                  onChange={(e) => setNewColType(e.target.value as ColumnType)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                >
                  <option value="text">Текст (строка, ФИО, описание)</option>
                  <option value="number">Число (количество, разряд, ставка)</option>
                  <option value="date">Дата (ГГГГ-ММ-ДД)</option>
                  <option value="select">Выпадающий список (выбор из вариантов)</option>
                  <option value="boolean">Да / Нет (флажок)</option>
                  <option value="relation">Связь со справочником (мастер-вкладка 1:N)</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Ширина (px):
                </label>
                <input
                  type="number"
                  min={60}
                  max={800}
                  step={10}
                  value={newColWidth}
                  onChange={(e) => setNewColWidth(parseInt(e.target.value, 10) || 180)}
                  className="w-full px-2.5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>
            </div>

            {newColType === 'select' && (
              <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                  Варианты выбора (через запятую):
                </label>
                <input
                  type="text"
                  placeholder="Например: Оптимальный, Допустимый, Вредный 3.1, Вредный 3.2"
                  value={newColOptions}
                  onChange={(e) => setNewColOptions(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-xs text-slate-900 dark:text-white"
                />
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
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Мастер-вкладка (источник):</label>
                      <select
                        value={newColRelTabId}
                        onChange={(e) => {
                          setNewColRelTabId(e.target.value);
                          const targetT = allTabs.find((t) => t.id === e.target.value);
                          if (targetT && targetT.columns[0]) {
                            setNewColRelColId(targetT.columns[0].id);
                          }
                        }}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md text-xs"
                      >
                        {masterCandidates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} {t.isMaster ? '(Мастер)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Столбец в мастере:</label>
                      <select
                        value={newColRelColId}
                        onChange={(e) => setNewColRelColId(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md text-xs"
                      >
                        {selectedMasterTab?.columns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.type})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="submit"
                disabled={!newColName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-400 text-white rounded-lg font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                <span>Добавить столбец в таблицу</span>
              </button>
            </div>
          </form>

          {/* Existing Columns List with Inline Rename, Width Editing, Move, and Reliable Inline Delete */}
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

                  const dependentTabs = allTabs.filter((t) =>
                    t.id !== currentTab.id &&
                    t.columns.some((c) => c.relation?.masterTabId === currentTab.id && c.relation?.masterColumnId === col.id)
                  );

                  return (
                    <div key={col.id} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-850/50">
                      <div className="p-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <span className="font-mono text-slate-400 text-[11px] w-5 text-center shrink-0">
                            {index + 1}.
                          </span>
                          {isRelation ? (
                            <span title="Связан со справочником" className="p-1 rounded bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 shrink-0">
                              <Lock className="w-3.5 h-3.5" />
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
                          ) : (
                            <span title="Текст" className="p-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
                              <Type className="w-3.5 h-3.5" />
                            </span>
                          )}

                          {isEditing ? (
                            <div className="flex items-center gap-1.5 flex-1 max-w-xs">
                              <input
                                type="text"
                                value={editingColName}
                                onChange={(e) => setEditingColName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    saveRenameCol(col.id);
                                  }
                                  if (e.key === 'Escape') setEditingColId(null);
                                }}
                                autoFocus
                                className="flex-1 px-2 py-1 bg-white dark:bg-slate-800 border border-blue-500 rounded text-xs font-medium text-slate-900 dark:text-white outline-hidden"
                              />
                              <button
                                type="button"
                                onClick={() => saveRenameCol(col.id)}
                                className="p-1 bg-blue-600 text-white rounded hover:bg-blue-700"
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
                                className="p-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded transition-colors shrink-0"
                                title="Переименовать столбец"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}

                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono shrink-0">
                            {col.type}
                          </span>

                          {isRelation && masterTab && (
                            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium truncate bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900 hidden md:inline-block">
                              → {masterTab.name} ({masterCol?.name || 'ключ'})
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {/* Width Editor */}
                          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700" title="Ширина столбца в пикселях">
                            <span className="text-[10px] text-slate-400">Ширина:</span>
                            <input
                              type="number"
                              min={60}
                              max={800}
                              step={10}
                              value={col.width || 180}
                              onChange={(e) => handleWidthChange(col.id, e.target.value)}
                              className="w-12 bg-transparent text-right font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 outline-hidden"
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

                      {/* Inline Delete Confirmation Bar (works everywhere without browser confirm dialogs) */}
                      {isDeleting && (
                        <div className="px-4 py-2.5 bg-red-50/90 dark:bg-red-950/40 border-t border-red-200 dark:border-red-900 flex flex-wrap items-center justify-between gap-2 animate-in fade-in duration-100">
                          <div className="flex items-center gap-2 text-red-800 dark:text-red-200 text-[11px]">
                            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                            <span>
                              {dependentTabs.length > 0
                                ? `ВНИМАНИЕ! Столбец используется как мастер в: ${dependentTabs.map((t) => t.name).join(', ')}. При удалении связь будет разорвана.`
                                : `Удалить столбец «${col.name}» из вкладки «${currentTab.name}»?`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded font-medium hover:bg-slate-100"
                            >
                              Отмена
                            </button>
                            <button
                              type="button"
                              onClick={() => executeDeleteColumn(col.id)}
                              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded font-semibold shadow-xs"
                            >
                              Подтвердить удаление
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3.5 bg-slate-50/60 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 text-xs shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};
