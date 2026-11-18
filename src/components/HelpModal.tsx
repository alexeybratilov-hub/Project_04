import React from 'react';
import { HelpCircle, ShieldCheck, Keyboard, HardDrive, Cpu } from 'lucide-react';
import { AppModal, AppButton } from './ui';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      heightClass="max-h-[90vh]"
      icon={<HelpCircle className="w-5 h-5" />}
      iconTone="blue"
      title="О системе «ОТ-База» (Охрана Труда)"
      subtitle="Руководство пользователя десктопного портативного приложения"
      footer={
        <AppButton variant="primary" size="md" onClick={onClose}>
          Понятно
        </AppButton>
      }
    >
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
    </AppModal>
  );
};
