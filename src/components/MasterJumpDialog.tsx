import React from 'react';
import { AlertCircle, ArrowRight, Link2 } from 'lucide-react';
import { Tab } from '../types/database';
import { AppModal, AppButton, StatusBanner } from './ui';

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
  const isReinforced = attemptCount >= 2;

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      icon={<Link2 className="w-4 h-4" />}
      iconTone={isReinforced ? 'amber' : 'blue'}
      title={isReinforced ? 'Блокировка редактирования связанного поля' : 'Связанные данные'}
      subtitle={`Столбец: «${columnName}»`}
      footer={
        <>
          <AppButton variant="ghost" size="sm" onClick={onClose}>
            Нет, остаться
          </AppButton>
          <AppButton variant="primary" size="sm" onClick={onConfirmJump}>
            <span>Да, перейти в «{masterTab?.name || 'Основную'}»</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </AppButton>
        </>
      }
    >
      <div className="p-5 space-y-4 text-sm overflow-y-auto">
        {isReinforced && (
          <StatusBanner
            variant="warning"
            compact
            icon={<AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />}
            title="Усиленное предупреждение системы контроля целостности"
          >
            Повторная попытка изменения данных. Столбец «{columnName}» является вторичным отражением мастер-таблицы. Прямое редактирование в этой вкладке заблокировано во избежание рассинхронизации базы данных по охране труда.
          </StatusBanner>
        )}

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
    </AppModal>
  );
};
