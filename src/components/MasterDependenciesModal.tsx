import React, { useState, useEffect } from 'react';
import { Key, Check, Table, ShieldCheck } from 'lucide-react';
import { Tab } from '../types/database';
import { AppModal, AppButton, StatusBanner } from './ui';

interface MasterDependenciesModalProps {
  isOpen: boolean;
  onClose: () => void;
  masterTab: Tab | null;
  allTabs: Tab[];
  onApplyDependencies: (
    masterTabId: string,
    linksByTargetTab: Record<string, string[]> // targetTabId -> array of masterColumnIds to link
  ) => void;
}

export const MasterDependenciesModal: React.FC<MasterDependenciesModalProps> = ({
  isOpen,
  onClose,
  masterTab,
  allTabs,
  onApplyDependencies
}) => {
  // targetTabId -> selected masterColumnIds
  const [selectedLinks, setSelectedLinks] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!isOpen || !masterTab) return;

    const initial: Record<string, string[]> = {};
    allTabs.forEach((t) => {
      if (t.id === masterTab.id) return;

      const linkedColIds: string[] = [];
      masterTab.columns.forEach((mCol) => {
        const hasRelation = t.columns.some(
          (c) =>
            c.type === 'relation' &&
            c.relation?.masterTabId === masterTab.id &&
            c.relation?.masterColumnId === mCol.id
        );
        const hasSameName = t.columns.some(
          (c) => c.name.trim().toLowerCase() === mCol.name.trim().toLowerCase()
        );
        if (hasRelation || hasSameName) {
          linkedColIds.push(mCol.id);
        }
      });

      initial[t.id] = linkedColIds;
    });

    setSelectedLinks(initial);
  }, [isOpen, masterTab, allTabs]);

  if (!masterTab) return null;

  const otherTabs = allTabs.filter((t) => t.id !== masterTab.id);

  const toggleColumnLink = (targetTabId: string, masterColId: string) => {
    setSelectedLinks((prev) => {
      const current = prev[targetTabId] || [];
      const exists = current.includes(masterColId);
      return {
        ...prev,
        [targetTabId]: exists
          ? current.filter((id) => id !== masterColId)
          : [...current, masterColId]
      };
    });
  };

  const handleSave = () => {
    onApplyDependencies(masterTab.id, selectedLinks);
    onClose();
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      size="4xl"
      icon={<Key className="w-5 h-5" />}
      iconTone="amber"
      headerClassName="!bg-amber-50/60 dark:!bg-amber-950/30"
      title={`Настройка зависимостей мастер-таблицы «${masterTab.name}»`}
      subtitle="Выберите столбцы мастера, которые должны передаваться в другие таблицы в виде зависимых выпадающих списков"
      footer={
        <>
          <AppButton variant="ghost" size="md" onClick={onClose}>
            Отмена
          </AppButton>
          <AppButton variant="primary" size="md" onClick={handleSave}>
            <Check className="w-4 h-4" />
            <span>Сохранить статус мастера и связи</span>
          </AppButton>
        </>
      }
    >
      <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
        <StatusBanner
          variant="info"
          icon={<ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />}
          title="Как работают зависимости мастер-таблицы:"
        >
          <p className="text-[11px]">
            Отмеченные столбцы будут отображаться в зависимых таблицах <strong>с такими же названиями</strong> и раскрывающимися списками, связанными со строками «{masterTab.name}». При массовой вставке или импорте из Excel данные вставятся только при полном совпадении с мастером.
          </p>
        </StatusBanner>

        {otherTabs.length === 0 ? (
          <div className="p-8 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            В базе пока нет других вкладок для связывания. Создайте новую вкладку, и она автоматически предложит подключиться к этому мастеру.
          </div>
        ) : (
          <div className="space-y-3">
            {otherTabs.map((targetTab) => {
              const chosenIds = selectedLinks[targetTab.id] || [];
              const activeCount = chosenIds.length;

              return (
                <div
                  key={targetTab.id}
                  className={`p-4 rounded-xl border transition-colors ${
                    activeCount > 0
                      ? 'bg-white dark:bg-slate-900 border-blue-300 dark:border-blue-700/80 shadow-xs'
                      : 'bg-slate-50/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <Table className="w-4 h-4 text-slate-500" />
                      <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                        {targetTab.name}
                      </span>
                      {targetTab.isMaster && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[10px] font-medium">
                          Мастер
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                        activeCount > 0
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                          : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {activeCount > 0 ? `Связано столбцов: ${activeCount}` : 'Независима от этого мастера'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {masterTab.columns.map((mCol) => {
                      const isChecked = chosenIds.includes(mCol.id);
                      const existingCol = targetTab.columns.find(
                        (c) =>
                          (c.type === 'relation' &&
                            c.relation?.masterTabId === masterTab.id &&
                            c.relation?.masterColumnId === mCol.id) ||
                          c.name.trim().toLowerCase() === mCol.name.trim().toLowerCase()
                      );

                      return (
                        <label
                          key={mCol.id}
                          className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-all select-none ${
                            isChecked
                              ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-400 dark:border-blue-600'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleColumnLink(targetTab.id, mCol.id)}
                            className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                              {mCol.name}
                            </div>
                            <div className="text-[10px] mt-0.5">
                              {existingCol ? (
                                existingCol.type === 'relation' &&
                                existingCol.relation?.masterTabId === masterTab.id ? (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                    Уже связан
                                  </span>
                                ) : (
                                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                                    Совпадает по имени → свяжется
                                  </span>
                                )
                              ) : (
                                <span className="text-slate-400">+ Добавится столбец</span>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppModal>
  );
};
