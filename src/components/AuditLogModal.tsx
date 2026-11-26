import React, { useMemo, useState } from 'react';
import { History, Search, FileSpreadsheet, Trash2, X } from 'lucide-react';
import { AuditLogAction, AuditLogEntry } from '../types/database';
import { excelService } from '../services/excelService';
import { AppButton, AppInput, AppModal, AppSelect, InlineConfirm, StatusBanner, useToast } from './ui';

interface AuditLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityName: string;
  entries: AuditLogEntry[];
  /** Очистка журнала; вызывается только после подтверждения в модалке. */
  onClear?: () => void;
}

const ACTION_META: Record<AuditLogAction, { label: string; badgeClass: string }> = {
  create: {
    label: 'Создание',
    badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
  },
  update: {
    label: 'Изменение',
    badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
  },
  delete: {
    label: 'Удаление',
    badgeClass: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
  },
  import: {
    label: 'Импорт',
    badgeClass: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
  },
  obligation: {
    label: 'Обязательства',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
  },
  structure: {
    label: 'Структура',
    badgeClass: 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300'
  },
  restore: {
    label: 'Восстановление',
    badgeClass: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
};

function formatAuditTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export const AuditLogModal: React.FC<AuditLogModalProps> = ({
  isOpen,
  onClose,
  entityName,
  entries,
  onClear
}) => {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<AuditLogAction | 'all'>('all');
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (actionFilter !== 'all' && entry.action !== actionFilter) return false;
      if (!q) return true;
      const fieldsText = (entry.changes || [])
        .map((c) => `${c.field} ${c.oldValue} ${c.newValue}`)
        .join(' ');
      const haystack = `${entry.summary} ${entry.tabName || ''} ${entry.rowIdentifier || ''} ${fieldsText}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, actionFilter, search]);

  const handleExportXlsx = () => {
    if (filtered.length === 0) {
      showToast('Нет записей журнала для экспорта', 'info');
      return;
    }
    const rows = filtered.map((e, idx) => ({
      '№': idx + 1,
      'Дата и время': formatAuditTimestamp(e.timestamp),
      'Тип операции': ACTION_META[e.action]?.label || e.action,
      'Раздел / вкладка': e.tabName || '—',
      'Запись': e.rowIdentifier || '—',
      'Описание': e.summary,
      'Изменённые поля': (e.changes || [])
        .map((c) => `${c.field}: ${c.oldValue} → ${c.newValue}`)
        .join('; ') || '—'
    }));
    const stamp = new Date().toISOString().split('T')[0];
    excelService.exportWorkbookToXlsx(
      [{ name: 'Журнал изменений', rows }],
      `Журнал_аудита_ОТ_База_${stamp}.xlsx`
    );
    showToast(`Экспортировано записей аудита: ${rows.length}`, 'success');
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      size="4xl"
      heightClass="max-h-[90vh]"
      icon={<History className="w-5 h-5" />}
      iconTone="blue"
      title="Журнал изменений и аудита (по полю и записи)"
      subtitle={`Организация: ${entityName} · записей в журнале: ${entries.length} (хранится до 1000 последних)`}
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <AppButton
              variant="secondary"
              size="sm"
              onClick={handleExportXlsx}
              disabled={filtered.length === 0}
              icon={<FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />}
            >
              Экспорт в Excel (.xlsx)
            </AppButton>
            {onClear && entries.length > 0 && (
              <AppButton
                variant="secondary"
                size="sm"
                onClick={() => setIsConfirmingClear(true)}
                icon={<Trash2 className="w-3.5 h-3.5" />}
              >
                Очистить журнал
              </AppButton>
            )}
          </div>
          <AppButton variant="primary" size="sm" onClick={onClose}>
            Закрыть
          </AppButton>
        </div>
      }
    >
      <div className="flex-1 min-h-0 flex flex-col p-5 gap-3 text-xs">
        <StatusBanner variant="info" compact>
          Журнал автоматически фиксирует создание, изменение ячеек (было → стало), удаление, импорт 1С/Excel,
          выполнение обязательств и восстановление резервных копий.
        </StatusBanner>

        {isConfirmingClear && onClear && (
          <InlineConfirm
            message="Очистить журнал изменений этой организации?"
            details="Записи удаляются безвозвратно и не восстанавливаются из резервных копий базы. Сами данные таблиц не затрагиваются."
            confirmLabel="Очистить журнал"
            cancelLabel="Отмена"
            onConfirm={() => {
              onClear();
              setIsConfirmingClear(false);
            }}
            onCancel={() => setIsConfirmingClear(false)}
          />
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <AppInput
              compact
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по ФИО, вкладке, полю или значению..."
              className="pl-8 pr-7"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Очистить поиск"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="w-48">
            <AppSelect
              compact
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value as AuditLogAction | 'all')}
              aria-label="Фильтр по типу операции"
            >
              <option value="all">Все операции ({entries.length})</option>
              {(Object.keys(ACTION_META) as AuditLogAction[]).map((k) => (
                <option key={k} value={k}>
                  {ACTION_META[k].label}
                </option>
              ))}
            </AppSelect>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 min-h-0 overflow-auto border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400">
              {entries.length === 0
                ? 'События ещё не зафиксированы. Измените ячейку, добавьте запись или выполните импорт.'
                : 'По текущему фильтру событий не найдено.'}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-2 w-36 whitespace-nowrap">Дата / время</th>
                  <th className="px-3 py-2 w-28 whitespace-nowrap">Операция</th>
                  <th className="px-3 py-2 w-44">Раздел / запись</th>
                  <th className="px-3 py-2">Подробности изменений</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filtered.map((entry) => {
                  const meta = ACTION_META[entry.action] || ACTION_META.update;
                  return (
                    <tr key={entry.id} className="align-top hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
                        {formatAuditTimestamp(entry.timestamp)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${meta.badgeClass}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[190px]" title={entry.tabName}>
                          {entry.tabName || 'База данных'}
                        </div>
                        {entry.rowIdentifier && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[190px]" title={entry.rowIdentifier}>
                            {entry.rowIdentifier}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 space-y-1">
                        <div className="text-slate-800 dark:text-slate-100 font-medium">
                          {entry.summary}
                        </div>
                        {entry.changes && entry.changes.length > 0 && (
                          <div className="space-y-0.5 pt-0.5">
                            {entry.changes.map((chg, idx) => (
                              <div key={idx} className="text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap items-baseline gap-1">
                                <span className="font-semibold text-slate-700 dark:text-slate-200">{chg.field}:</span>
                                <span className="line-through text-slate-400 dark:text-slate-500">{chg.oldValue}</span>
                                <span className="text-slate-400">→</span>
                                <span className="text-emerald-700 dark:text-emerald-300 font-medium">{chg.newValue}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppModal>
  );
};
