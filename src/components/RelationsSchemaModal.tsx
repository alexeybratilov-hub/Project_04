import React from 'react';
import { X, Link2, Key, ArrowRight, Table, Layers, ShieldCheck } from 'lucide-react';
import { Tab } from '../types/database';

interface RelationsSchemaModalProps {
  isOpen: boolean;
  onClose: () => void;
  tabs: Tab[];
  onSelectTab: (tabId: string) => void;
}

export const RelationsSchemaModal: React.FC<RelationsSchemaModalProps> = ({
  isOpen,
  onClose,
  tabs,
  onSelectTab
}) => {
  if (!isOpen) return null;

  // Compute relations
  const relations: Array<{
    masterTab: Tab;
    masterColName: string;
    dependentTab: Tab;
    dependentColName: string;
  }> = [];

  tabs.forEach((depTab) => {
    depTab.columns.forEach((col) => {
      if (col.type === 'relation' && col.relation) {
        const masterTab = tabs.find((t) => t.id === col.relation?.masterTabId);
        if (masterTab) {
          const masterCol = masterTab.columns.find((c) => c.id === col.relation?.masterColumnId);
          relations.push({
            masterTab,
            masterColName: masterCol?.name || col.relation.masterColumnId,
            dependentTab: depTab,
            dependentColName: col.name
          });
        }
      }
    });
  });

  const masterTabs = tabs.filter((t) => t.isMaster || relations.some((r) => r.masterTab.id === t.id));
  const dependentTabs = tabs.filter((t) => relations.some((r) => r.dependentTab.id === t.id));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 rounded-lg">
              <Link2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Схема связей базы данных (Мастер → Зависимые)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Автоматическая реляционная синхронизация справочников и контроль целостности
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
          {/* Summary Banner */}
          <div className="p-4 bg-blue-50/60 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/60 rounded-xl text-xs space-y-2">
            <div className="flex items-center gap-2 font-semibold text-blue-900 dark:text-blue-200">
              <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Правила ссылочной целостности системы «ОТ-База»:</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-blue-800/80 dark:text-blue-300">
              <li><strong>Каскадное обновление:</strong> переименование должности или фактора в мастер-вкладке мгновенно обновляет все строки зависимых таблиц.</li>
              <li><strong>Защита от случайных правок:</strong> зависимые ячейки закрыты от прямого ручного ввода с перенаправлением в мастер-таблицу.</li>
              <li><strong>Проверка при импорте Excel:</strong> значения новых строк проверяются на соответствие утвержденным спискам мастера.</li>
            </ul>
          </div>

          {/* Relations Visual Cards */}
          <div>
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">
              Активные связи между таблицами ({relations.length})
            </h3>

            {relations.length === 0 ? (
              <div className="p-8 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                Связанные столбцы пока не настроены. Создайте столбец типа «Связь с вкладкой» в настройках столбцов.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {relations.map((rel, index) => (
                  <div
                    key={index}
                    className="p-4 bg-white dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3"
                  >
                    {/* Link flow */}
                    <div className="flex items-center justify-between text-xs">
                      {/* Master box */}
                      <button
                        onClick={() => {
                          onSelectTab(rel.masterTab.id);
                          onClose();
                        }}
                        className="flex-1 text-left p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 rounded-lg hover:border-amber-400 transition-colors"
                      >
                        <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-semibold text-[11px]">
                          <Key className="w-3 h-3" />
                          <span>Мастер</span>
                        </div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate mt-0.5">
                          {rel.masterTab.name}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5 truncate">
                          поле: «{rel.masterColName}»
                        </div>
                      </button>

                      <div className="px-2 flex flex-col items-center justify-center text-slate-400">
                        <ArrowRight className="w-4 h-4 text-blue-500" />
                        <span className="text-[9px] font-mono text-blue-600 dark:text-blue-400 font-medium">1:N</span>
                      </div>

                      {/* Dependent box */}
                      <button
                        onClick={() => {
                          onSelectTab(rel.dependentTab.id);
                          onClose();
                        }}
                        className="flex-1 text-left p-2.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/60 rounded-lg hover:border-blue-400 transition-colors"
                      >
                        <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-400 font-semibold text-[11px]">
                          <Table className="w-3 h-3" />
                          <span>Зависимая</span>
                        </div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate mt-0.5">
                          {rel.dependentTab.name}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5 truncate">
                          поле: «{rel.dependentColName}»
                        </div>
                      </button>
                    </div>

                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>Записей в мастере: <strong className="font-mono text-slate-700 dark:text-slate-300">{rel.masterTab.rows.length}</strong></span>
                      <span>Вхождений в таблице: <strong className="font-mono text-slate-700 dark:text-slate-300">{rel.dependentTab.rows.length}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3.5 bg-slate-50/60 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 text-xs">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 rounded-lg font-medium transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
