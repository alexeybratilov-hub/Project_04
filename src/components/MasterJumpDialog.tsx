import React from 'react';
import { AlertCircle, ArrowRight, Lock, X } from 'lucide-react';
import { Tab } from '../types/database';

interface MasterJumpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmJump: () => void;
  masterTab: Tab | undefined;
  columnName: string;
  currentValue: any;
  attemptCount: number;
}

export const MasterJumpDialog: React.FC<MasterJumpDialogProps> = ({
  isOpen,
  onClose,
  onConfirmJump,
  masterTab,
  columnName,
  currentValue,
  attemptCount
}) => {
  if (!isOpen) return null;

  const isReinforced = attemptCount >= 2;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-lg ${isReinforced ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400'}`}>
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {isReinforced ? 'Блокировка редактирования связанного поля' : 'Связанные данные'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Столбец: «{columnName}»</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-sm">
          {isReinforced ? (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg text-amber-900 dark:text-amber-300 text-xs leading-relaxed space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Усиленное предупреждение системы контроля целостности</span>
              </div>
              <p>
                Повторная попытка изменения данных. Столбец «{columnName}» является вторичным отражением мастер-таблицы. Прямое редактирование в этой вкладке заблокировано во избежание рассинхронизации базы данных по охране труда.
              </p>
            </div>
          ) : null}

          <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
            Эти данные вносятся и контролируются в основной вкладке{' '}
            <strong className="text-blue-600 dark:text-blue-400">«{masterTab?.name || 'Основная вкладка'}»</strong>.
          </p>

          {currentValue ? (
            <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200/80 dark:border-slate-800 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Текущее выбранное значение: </span>
              <span className="font-medium text-slate-900 dark:text-slate-100">{String(currentValue)}</span>
            </div>
          ) : null}

          <p className="text-slate-600 dark:text-slate-400 text-xs">
            Перейти в основную вкладку <span className="font-semibold text-slate-800 dark:text-slate-200">«{masterTab?.name}»</span> для внесения правок или добавления новых элементов справочника?
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-5 py-3.5 bg-slate-50/60 dark:bg-slate-850 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            Нет, остаться
          </button>
          <button
            onClick={onConfirmJump}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors"
          >
            <span>Да, перейти в «{masterTab?.name || 'Основную'}»</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
