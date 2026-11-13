import React, { useEffect } from 'react';
import { X, HelpCircle, ShieldCheck, Keyboard, HardDrive, Cpu } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 rounded-lg">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                О системе «ОТ-База» (Охрана Труда)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Руководство пользователя десктопного портативного приложения
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
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
          {/* Section 1 */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>1. Назначение программы</span>
            </h3>
            <p>
              «ОТ-База» предназначена для специалистов по охране труда предприятий и организаций. Система позволяет вести структурированный учет контингента работников, штатного расписания, вредных факторов по результатам СОУТ, графиков медицинских осмотров (Приказ 29н), выдачи средств индивидуальной защиты (Приказ 766н) и журналов инструктажей.
            </p>
          </div>

          {/* Section 2 */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-blue-600" />
              <span>2. Портативное исполнение (Portable)</span>
            </h3>
            <p>
              Автономный исполняемый файл <code className="font-mono text-blue-600">OT-Baza.exe</code> работает на Windows 10/11 без установки и без интернета (может запускаться напрямую с USB-накопителя). Все данные записываются атомарно в <code className="font-mono text-blue-600">./data/ot_database.json</code>, а прикреплённые нормативы и документы сохраняются в подпапках рядом с программой.
            </p>
          </div>

          {/* Section 3 */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-purple-600" />
              <span>3. Горячие клавиши</span>
            </h3>
            <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
              <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex justify-between">
                <span>Ctrl + S</span>
                <span className="text-slate-500 font-sans">Сохранить базу</span>
              </div>
              <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex justify-between">
                <span>Ctrl + N</span>
                <span className="text-slate-500 font-sans">Добавить запись</span>
              </div>
              <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex justify-between">
                <span>Ctrl + F</span>
                <span className="text-slate-500 font-sans">Поиск по таблице</span>
              </div>
              <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex justify-between">
                <span>Двойной клик</span>
                <span className="text-slate-500 font-sans">Правка ячейки</span>
              </div>
            </div>
          </div>

          {/* Section 4 */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-600" />
              <span>4. LLM-провайдеры и генерация документов</span>
            </h3>
            <p>
              В меню «LLM-Сервер» можно выбрать локальный сервер (Ollama, LM Studio, vLLM) или облачный API (OpenAI, Claude, Gemini, DeepSeek, OpenRouter, Groq). Если LLM не подключена, система продолжает полноценно работать в штатном режиме таблиц и прямой генерации документов Word (.docx) и PDF по тегам.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3.5 bg-slate-50/60 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 text-xs">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
};
