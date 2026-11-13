import React, { useState, useEffect } from 'react';
import {
  X, Plus, Key, Link2, Check, Table,
  Trash2
} from 'lucide-react';
import { Column, ColumnType, Tab } from '../types/database';
import { createUniqueId } from '../services/integrityService';

interface NewTabModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingTabs: Tab[];
  onCreateTab: (params: {
    name: string;
    isMaster: boolean;
    columns: Column[];
    openMasterDepsAfter?: boolean;
  }) => void;
}

interface ExtraColDraft {
  id: string;
  name: string;
  type: ColumnType;
}

export const NewTabModal: React.FC<NewTabModalProps> = ({
  isOpen,
  onClose,
  existingTabs,
  onCreateTab
}) => {
  const masterTabs = existingTabs.filter((t) => t.isMaster);

  const [tabName, setTabName] = useState('');
  const [isMaster, setIsMaster] = useState(false);
  const [hasDependencies, setHasDependencies] = useState<boolean>(masterTabs.length > 0);
  // Selected master links: array of { masterTabId, masterColumnId }
  const [selectedMasterLinks, setSelectedMasterLinks] = useState<Array<{ masterTabId: string; masterColumnId: string }>>([]);
  const [extraCols, setExtraCols] = useState<ExtraColDraft[]>([
    { id: 'ex_1', name: 'ФИО / Наименование', type: 'text' },
    { id: 'ex_2', name: 'Дата', type: 'date' },
  ]);
  const [newExtraName, setNewExtraName] = useState('');
  const [newExtraType, setNewExtraType] = useState<ColumnType>('text');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTabName(`Новая таблица ${existingTabs.length + 1}`);
      setIsMaster(false);
      setHasDependencies(masterTabs.length > 0);
      setSelectedMasterLinks([]);
      setExtraCols([
        { id: `ex_${Date.now()}_1`, name: 'Примечание', type: 'text' },
        { id: `ex_${Date.now()}_2`, name: 'Дата', type: 'date' }
      ]);
      setNewExtraName('');
      setNewExtraType('text');
      setErrorMsg('');
    }
  }, [isOpen, existingTabs.length, masterTabs.length]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isLinkSelected = (masterTabId: string, masterColumnId: string) =>
    selectedMasterLinks.some((l) => l.masterTabId === masterTabId && l.masterColumnId === masterColumnId);

  const toggleMasterLink = (masterTabId: string, masterColumnId: string) => {
    setSelectedMasterLinks((prev) => {
      const exists = prev.some((l) => l.masterTabId === masterTabId && l.masterColumnId === masterColumnId);
      if (exists) {
        return prev.filter((l) => !(l.masterTabId === masterTabId && l.masterColumnId === masterColumnId));
      }
      return [...prev, { masterTabId, masterColumnId }];
    });
  };

  const handleAddExtraCol = () => {
    const trimmed = newExtraName.trim();
    if (!trimmed) return;
    setExtraCols((prev) => [...prev, { id: `ex_${Date.now()}`, name: trimmed, type: newExtraType }]);
    setNewExtraName('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = tabName.trim();
    if (!trimmedName) {
      setErrorMsg('Введите название новой таблицы');
      return;
    }

    const columns: Column[] = [];
    const seenNames = new Set<string>();

    // 1. Add selected master-linked columns FIRST with exact same names & widths
    if (hasDependencies) {
      selectedMasterLinks.forEach((link, idx) => {
        const mTab = masterTabs.find((t) => t.id === link.masterTabId);
        const mCol = mTab?.columns.find((c) => c.id === link.masterColumnId);
        if (mTab && mCol) {
          const lower = mCol.name.trim().toLowerCase();
          if (!seenNames.has(lower)) {
            seenNames.add(lower);
            columns.push({
              id: createUniqueId('col_rel'),
              name: mCol.name,
              type: 'relation',
              width: mCol.width || 190,
              relation: {
                masterTabId: mTab.id,
                masterColumnId: mCol.id
              }
            });
          }
        }
      });
    }

    // 2. Add custom columns (skipping duplicates if already pulled from master)
    extraCols.forEach((ec) => {
      const lower = ec.name.trim().toLowerCase();
      if (!seenNames.has(lower) && ec.name.trim()) {
        seenNames.add(lower);
        columns.push({
          id: createUniqueId('col'),
          name: ec.name.trim(),
          type: ec.type,
          width: 180
        });
      }
    });

    if (columns.length === 0) {
      columns.push({
        id: createUniqueId('col'),
        name: 'Наименование',
        type: 'text',
        width: 200
      });
    }

    onCreateTab({
      name: trimmedName,
      isMaster,
      columns,
      openMasterDepsAfter: isMaster
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-3xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 rounded-lg">
              <Table className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Создание новой вкладки (таблицы)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Настройте название, статус мастер-таблицы и зависимости от справочников
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg">
              {errorMsg}
            </div>
          )}

          {/* Tab Name & Master Toggle */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Название таблицы <span className="text-red-500">*</span>:
              </label>
              <input
                type="text"
                value={tabName}
                onChange={(e) => setTabName(e.target.value)}
                placeholder="Например: Журнал выдачи СИЗ"
                autoFocus
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              />
            </div>

            <div className="flex items-end">
              <label className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                isMaster
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200'
                  : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
              }`}>
                <input
                  type="checkbox"
                  checked={isMaster}
                  onChange={(e) => setIsMaster(e.target.checked)}
                  className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                <Key className="w-4 h-4 text-amber-500 shrink-0" />
                <div>
                  <div className="font-semibold">Сделать мастер-таблицей</div>
                  <div className="text-[10px] text-slate-500">Сможет отдавать столбцы другим таблицам</div>
                </div>
              </label>
            </div>
          </div>

          {/* Dependencies Question if Master Tabs Exist */}
          {masterTabs.length > 0 && (
            <div className="p-4 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/70 rounded-xl space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-blue-900 dark:text-blue-200">
                  <Link2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>Есть ли зависимости от существующих мастер-таблиц?</span>
                </div>

                <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 p-0.5 rounded-lg border border-blue-200 dark:border-blue-800">
                  <button
                    type="button"
                    onClick={() => setHasDependencies(true)}
                    className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      hasDependencies
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    Да, настроить связи
                  </button>
                  <button
                    type="button"
                    onClick={() => setHasDependencies(false)}
                    className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      !hasDependencies
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    Нет, независимая
                  </button>
                </div>
              </div>

              {hasDependencies && (
                <div className="space-y-2.5 pt-1">
                  <p className="text-[11px] text-blue-800/80 dark:text-blue-300">
                    Отметьте столбцы из мастер-таблиц — они будут добавлены в новую таблицу с <strong>такими же названиями</strong> и зависимыми выпадающими списками в ячейках:
                  </p>

                  <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
                    {masterTabs.map((mTab) => (
                      <div
                        key={mTab.id}
                        className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-blue-200/80 dark:border-slate-700 space-y-2"
                      >
                        <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                          <Key className="w-3.5 h-3.5 text-amber-500" />
                          <span>Мастер: «{mTab.name}»</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {mTab.columns.map((mCol) => {
                            const checked = isLinkSelected(mTab.id, mCol.id);
                            return (
                              <label
                                key={mCol.id}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] cursor-pointer transition-all select-none ${
                                  checked
                                    ? 'bg-blue-600 text-white border-blue-600 font-medium shadow-xs'
                                    : 'bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleMasterLink(mTab.id, mCol.id)}
                                  className="hidden"
                                />
                                <Link2 className={`w-3 h-3 ${checked ? 'text-white' : 'text-slate-400'}`} />
                                <span>{mCol.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Extra Own Columns */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">
              Дополнительные столбцы таблицы:
            </h3>

            <div className="flex flex-wrap gap-2">
              {extraCols.map((col) => (
                <div
                  key={col.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
                >
                  <span className="font-medium text-slate-800 dark:text-slate-200">{col.name}</span>
                  <span className="text-[10px] text-slate-400 font-mono">({col.type})</span>
                  <button
                    type="button"
                    onClick={() => setExtraCols((prev) => prev.filter((c) => c.id !== col.id))}
                    className="text-slate-400 hover:text-red-500 ml-1"
                    title="Убрать столбец"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newExtraName}
                onChange={(e) => setNewExtraName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddExtraCol();
                  }
                }}
                placeholder="Название своего столбца..."
                className="flex-1 px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md text-xs"
              />
              <select
                value={newExtraType}
                onChange={(e) => setNewExtraType(e.target.value as ColumnType)}
                className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md text-xs"
              >
                <option value="text">Текст</option>
                <option value="number">Число</option>
                <option value="date">Дата</option>
                <option value="boolean">Да / Нет</option>
              </select>
              <button
                type="button"
                onClick={handleAddExtraCol}
                disabled={!newExtraName.trim()}
                className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-40 text-slate-800 dark:text-white rounded-md font-medium flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Добавить</span>
              </button>
            </div>
          </div>

          {/* Footer inside form */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 rounded-lg font-medium"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center gap-2 shadow-xs transition-colors"
            >
              <Check className="w-4 h-4" />
              <span>Создать таблицу</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
