import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  X,
  XCircle
} from 'lucide-react';
import { BatchGenerationReport } from '../services/documentGenerator';
import { AppButton } from './ui';

interface BatchGenerationReportPanelProps {
  report: BatchGenerationReport;
  onClose: () => void;
}

export const BatchGenerationReportPanel: React.FC<BatchGenerationReportPanelProps> = ({
  report,
  onClose
}) => {
  const [showSuccessList, setShowSuccessList] = useState(report.errorCount === 0);

  return (
    <div
      data-testid="batch-report-panel"
      className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-sm shrink-0 max-h-[55%]"
    >
      {/* Header */}
      <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {report.errorCount > 0 ? (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          )}
          <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
            Отчёт пакетной генерации: «{report.templateName}» ({report.format.toUpperCase()})
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="close-batch-report"
          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded cursor-pointer"
          title="Закрыть отчёт"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* KPI Summary Strip */}
      <div className="px-4 py-2.5 grid grid-cols-3 gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 shrink-0 text-xs">
        <div className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] text-slate-500">Обработано записей</div>
          <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100" data-testid="batch-total-count">
            {report.totalCount}
          </div>
        </div>
        <div className="px-3 py-1.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
          <div className="text-[11px] text-emerald-700 dark:text-emerald-300">Успешно создано</div>
          <div className="text-sm font-semibold font-mono tabular-nums text-emerald-800 dark:text-emerald-200" data-testid="batch-success-count">
            {report.successCount}
          </div>
        </div>
        <div
          className={`px-3 py-1.5 rounded-lg border ${
            report.errorCount > 0
              ? 'bg-red-50/80 dark:bg-red-950/30 border-red-200 dark:border-red-800'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
          }`}
        >
          <div
            className={`text-[11px] ${
              report.errorCount > 0
                ? 'text-red-700 dark:text-red-300'
                : 'text-slate-500'
            }`}
          >
            Ошибок генерации
          </div>
          <div
            className={`text-sm font-semibold font-mono tabular-nums ${
              report.errorCount > 0
                ? 'text-red-800 dark:text-red-200'
                : 'text-slate-700 dark:text-slate-300'
            }`}
            data-testid="batch-error-count"
          >
            {report.errorCount}
          </div>
        </div>
      </div>

      {/* Scrollable Details */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        {report.errors.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-300 text-[11px] uppercase tracking-wider">
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Записи с ошибками ({report.errors.length})</span>
            </div>
            <div className="border border-red-200 dark:border-red-900/70 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-red-50/90 dark:bg-red-950/50 text-red-900 dark:text-red-200 border-b border-red-200 dark:border-red-900/70">
                  <tr>
                    <th className="py-1.5 px-2.5 font-semibold w-16 whitespace-nowrap">№ строки</th>
                    <th className="py-1.5 px-2.5 font-semibold w-44">Запись</th>
                    <th className="py-1.5 px-2.5 font-semibold w-40">Проблемный тег</th>
                    <th className="py-1.5 px-2.5 font-semibold">Причина ошибки</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-100 dark:divide-red-900/40 bg-white dark:bg-slate-900">
                  {report.errors.map((err) => (
                    <tr key={`${err.rowId}-${err.rowNumber}`} data-testid="batch-error-item" className="align-top">
                      <td className="py-2 px-2.5 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        #{err.rowNumber}
                      </td>
                      <td className="py-2 px-2.5 font-medium text-slate-900 dark:text-slate-100 break-words">
                        {err.rowIdentifier}
                      </td>
                      <td className="py-2 px-2.5">
                        {err.tagNames.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {err.tagNames.map((t) => (
                              <code
                                key={t}
                                className="px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 font-mono text-[10px] text-red-800 dark:text-red-200 break-all"
                              >
                                {t}
                              </code>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2.5 text-slate-700 dark:text-slate-300 leading-snug break-words">
                        {err.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {report.successes.length > 0 && (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setShowSuccessList((v) => !v)}
              className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-200 font-semibold text-[11px] cursor-pointer hover:bg-emerald-100/70 dark:hover:bg-emerald-950/50 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <FileCheck2 className="w-3.5 h-3.5 shrink-0" />
                <span>Успешно сформированные документы ({report.successes.length})</span>
              </span>
              {showSuccessList ? (
                <ChevronUp className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              )}
            </button>

            {showSuccessList && (
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800 max-h-40 overflow-y-auto">
                {report.successes.map((ok) => (
                  <div
                    key={`${ok.rowId}-${ok.rowNumber}`}
                    data-testid="batch-success-item"
                    className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-slate-400 shrink-0">#{ok.rowNumber}</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                        {ok.rowIdentifier}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300 truncate max-w-[220px]">
                      {ok.fileName}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 flex items-center justify-between gap-2 shrink-0 text-[11px] text-slate-500">
        <span>
          {report.errorCount > 0
            ? 'Успешные документы сохранены; исправьте проблемные строки или теги и повторите для них.'
            : 'Все выбранные документы сформированы без ошибок.'}
        </span>
        <AppButton variant="secondary" size="sm" onClick={onClose}>
          Скрыть отчёт
        </AppButton>
      </div>
    </div>
  );
};
