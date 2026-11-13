import React, { useState } from 'react';
import { ChevronDown, ChevronUp, FileSpreadsheet, Info, ShieldCheck, Check } from 'lucide-react';
import { Tab } from '../types/database';

interface ImportHintCardProps {
  currentTab: Tab;
}

export const ImportHintCard: React.FC<ImportHintCardProps> = ({ currentTab }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const columnNames = currentTab.columns.map((c) => c.name).join(' | ');

  return (
    <div className="bg-slate-50 dark:bg-slate-850/70 border-b border-slate-200 dark:border-slate-800 text-xs transition-all duration-200">
      <div className="max-w-full px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 min-w-0">
          <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
          <span className="font-semibold text-slate-800 dark:text-slate-200 shrink-0">Требования к файлу импорта (.xlsx / .csv):</span>
          <span className="truncate text-slate-500 dark:text-slate-400 hidden sm:inline">
            1-я строка — заголовки • Даты: ДД.ММ.ГГГГ или ГГГГ-ММ-ДД • Кодировка CSV: UTF-8 • Связанные столбцы сверяются с мастером
          </span>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium text-[11px] shrink-0 px-2 py-0.5 rounded hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
        >
          <span>{isExpanded ? 'Свернуть памятку' : 'Развернуть памятку'}</span>
          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {isExpanded && (
        <div className="px-4 pb-3 pt-1 border-t border-slate-200/60 dark:border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-slate-600 dark:text-slate-400 animate-in slide-in-from-top-1 duration-150">
          <div className="space-y-1 p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
            <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Check className="w-3 h-3 text-emerald-600" />
              <span>Формат колонок вкладки «{currentTab.name}»</span>
            </div>
            <p className="text-slate-500 text-[10px] leading-relaxed">
              Рекомендуемые названия столбцов в файле Excel для точного автосопоставления:
            </p>
            <div className="p-1.5 bg-slate-50 dark:bg-slate-850 rounded font-mono text-[10px] text-slate-700 dark:text-slate-300 select-all overflow-x-auto whitespace-nowrap">
              {columnNames}
            </div>
          </div>

          <div className="space-y-1 p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
            <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Info className="w-3 h-3 text-blue-600" />
              <span>Типы данных и разделители</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-slate-500 dark:text-slate-400">
              <li><strong className="text-slate-700 dark:text-slate-300">Даты:</strong> 2026-05-14 или 14.05.2026</li>
              <li><strong className="text-slate-700 dark:text-slate-300">Логические:</strong> «Да» / «Нет» или 1 / 0</li>
              <li><strong className="text-slate-700 dark:text-slate-300">Числа:</strong> точка или запятая, без пробелов</li>
              <li><strong className="text-slate-700 dark:text-slate-300">CSV файл:</strong> строго в кодировке UTF-8</li>
            </ul>
          </div>

          <div className="space-y-1 p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
            <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <ShieldCheck className="w-3 h-3 text-amber-600" />
              <span>Транзакционность и контроль связей</span>
            </div>
            <p className="text-slate-500 leading-relaxed">
              Импорт полностью транзакционный: при расхождении в связанных столбцах импорт будет остановлен, и система покажет детальный список несовпавших значений с номерами строк.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
