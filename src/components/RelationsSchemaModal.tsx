import React, { useMemo, useEffect, useState } from 'react';
import {
  Link2, Key, ArrowRight, Table, ShieldCheck,
  AlertTriangle, CheckCircle2, Wrench
} from 'lucide-react';
import { Tab, Tag } from '../types/database';
import { integrityService } from '../services/integrityService';
import { AppModal, AppButton, StatusBanner } from './ui';

interface RelationsSchemaModalProps {
  isOpen: boolean;
  onClose: () => void;
  tabs: Tab[];
  tags?: Tag[];
  initialAuditOpen?: boolean;
  onSelectTab: (tabId: string, highlightRowId?: string) => void;
  onRepairReferences?: () => void;
}

export const RelationsSchemaModal: React.FC<RelationsSchemaModalProps> = ({
  isOpen,
  onClose,
  tabs,
  tags = [],
  initialAuditOpen = false,
  onSelectTab,
  onRepairReferences
}) => {
  const [activeView, setActiveView] = useState<'schema' | 'audit'>(
    initialAuditOpen ? 'audit' : 'schema'
  );

  useEffect(() => {
    if (isOpen) {
      setActiveView(initialAuditOpen ? 'audit' : 'schema');
    }
  }, [isOpen, initialAuditOpen]);

  const auditReport = useMemo(
    () => integrityService.auditIntegrity(tabs, tags),
    [tabs, tags]
  );

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

  const canAutoRepair =
    auditReport.brokenRelations.length > 0 || auditReport.brokenTags.length > 0;

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      size="4xl"
      heightClass="max-h-[90vh]"
      icon={<Link2 className="w-5 h-5" />}
      iconTone="blue"
      title="Связи базы данных и проверка целостности"
      subtitle="Карта зависимостей «Мастер → Зависимые» и диагностика ссылочных расхождений"
      footer={
        <AppButton variant="secondary" size="md" onClick={onClose}>
          Закрыть
        </AppButton>
      }
    >
      {/* View Switcher */}
      <div className="px-6 pt-3 pb-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 flex items-center gap-2 text-xs shrink-0">
        <button
          type="button"
          onClick={() => setActiveView('schema')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
            activeView === 'schema'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800'
          }`}
        >
          Схема связей ({relations.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveView('audit')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
            activeView === 'audit'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800'
          }`}
        >
          {auditReport.totalIssues > 0 ? (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          )}
          <span>Аудит целостности</span>
          {auditReport.totalIssues > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500 text-white text-[10px] font-mono tabular-nums font-bold">
              {auditReport.totalIssues}
            </span>
          )}
        </button>
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
        {activeView === 'schema' ? (
          <>
            <StatusBanner
              variant="info"
              icon={<ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />}
              title="Правила ссылочной целостности «ОТ-База»:"
            >
              <ul className="list-disc list-inside space-y-1 mt-1">
                <li><strong>Каскадное обновление:</strong> переименование должности или фактора в мастер-вкладке синхронно обновляет связанные строки зависимых таблиц.</li>
                <li><strong>Защищённый выбор в ячейках:</strong> связанные поля заполняются только из списка мастер-таблицы без ручного ввода опечаток.</li>
                <li><strong>Проверка импорта и вставки Ctrl+V из Excel:</strong> расхождения отклоняются с точным указанием строк.</li>
              </ul>
            </StatusBanner>

            <div>
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">
                Активные связи между таблицами ({relations.length})
              </h3>

              {relations.length === 0 ? (
                <div className="p-8 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  Связанные столбцы пока не настроены. Создайте столбец типа «Связь со справочником» в настройках столбцов.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {relations.map((rel, index) => (
                    <div
                      key={index}
                      className="p-4 bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectTab(rel.masterTab.id);
                            onClose();
                          }}
                          className="flex-1 text-left p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 rounded-lg hover:border-amber-400 transition-colors cursor-pointer"
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

                        <button
                          type="button"
                          onClick={() => {
                            onSelectTab(rel.dependentTab.id);
                            onClose();
                          }}
                          className="flex-1 text-left p-2.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/60 rounded-lg hover:border-blue-400 transition-colors cursor-pointer"
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
                        <span>Записей в мастере: <strong className="font-mono tabular-nums text-slate-700 dark:text-slate-300">{rel.masterTab.rows.length}</strong></span>
                        <span>Вхождений в таблице: <strong className="font-mono tabular-nums text-slate-700 dark:text-slate-300">{rel.dependentTab.rows.length}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-5">
            {auditReport.totalIssues === 0 ? (
              <StatusBanner
                variant="success"
                icon={<CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />}
                title={<span className="text-sm">Целостность базы данных подтверждена</span>}
              >
                Все связи столбцов с мастер-таблицами действительны, все значения в зависимых ячейках совпадают со справочниками, битых тегов не найдено.
              </StatusBanner>
            ) : (
              <StatusBanner
                variant="warning"
                icon={<AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
                title={<span className="text-sm">Обнаружено расхождений: {auditReport.totalIssues}</span>}
                action={
                  canAutoRepair &&
                  onRepairReferences && (
                    <AppButton
                      variant="primary"
                      size="sm"
                      onClick={onRepairReferences}
                      className="!bg-amber-600 hover:!bg-amber-700"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      <span>Исправить битые связи и теги</span>
                    </AppButton>
                  )
                }
              >
                <span className="text-[11px]">
                  Сломанных связей: {auditReport.brokenRelations.length} · Несуществующих значений в ячейках: {auditReport.orphanedCells.length} · Битых тегов: {auditReport.brokenTags.length}
                </span>
              </StatusBanner>
            )}

            {auditReport.brokenRelations.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-800 dark:text-slate-200">
                  1. Сломанные определения связей ({auditReport.brokenRelations.length})
                </h4>
                <div className="border border-red-200 dark:border-red-900 rounded-xl divide-y divide-red-100 dark:divide-red-900/60 bg-white dark:bg-slate-900">
                  {auditReport.brokenRelations.map((item, idx) => (
                    <div key={idx} className="p-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {item.tabName} → столбец «{item.columnName}»
                        </div>
                        <div className="text-[11px] text-red-600 dark:text-red-400">{item.reason}</div>
                      </div>
                      <AppButton
                        variant="secondary"
                        size="xs"
                        onClick={() => {
                          onSelectTab(item.tabId);
                          onClose();
                        }}
                      >
                        Открыть вкладку
                      </AppButton>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {auditReport.orphanedCells.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-800 dark:text-slate-200">
                  2. Значения в ячейках, отсутствующие в мастер-таблице ({auditReport.orphanedCells.length})
                </h4>
                <p className="text-[11px] text-slate-500">
                  Такие значения остаются в ячейке для безопасности, пока вы не выберете актуальное значение из списка или не вернёте запись в мастер-таблицу.
                </p>
                <div className="border border-amber-200 dark:border-amber-900 rounded-xl divide-y divide-amber-100 dark:divide-amber-900/50 bg-white dark:bg-slate-900 max-h-60 overflow-y-auto">
                  {auditReport.orphanedCells.map((cell, idx) => (
                    <div key={idx} className="p-2.5 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {cell.tabName}, строка #{cell.rowNumber}, поле «{cell.columnName}»
                        </div>
                        <div className="text-[11px] text-amber-700 dark:text-amber-400">
                          Значение «{cell.value}» не найдено в мастере «{cell.masterTabName}»
                        </div>
                      </div>
                      <AppButton
                        variant="secondary"
                        size="xs"
                        onClick={() => {
                          onSelectTab(cell.tabId, cell.rowId);
                          onClose();
                        }}
                      >
                        Перейти к строке
                      </AppButton>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {auditReport.brokenTags.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-800 dark:text-slate-200">
                  3. Битые теги шаблонов ({auditReport.brokenTags.length})
                </h4>
                <div className="border border-red-200 dark:border-red-900 rounded-xl divide-y divide-red-100 dark:divide-red-900/60 bg-white dark:bg-slate-900">
                  {auditReport.brokenTags.map((tag) => (
                    <div key={tag.tagId} className="p-2.5 flex items-center justify-between gap-3">
                      <div>
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {tag.tagName}
                        </span>
                        <span className="text-[11px] text-red-600 dark:text-red-400 ml-2">
                          {tag.reason}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppModal>
  );
};
