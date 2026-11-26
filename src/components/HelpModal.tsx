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
            Автономный исполняемый файл <code className="font-mono text-blue-600">OT-Baza.exe</code> работает на Windows 10/11 без установки и без интернета (может запускаться напрямую с USB-накопителя). Все данные записываются атомарно в <code className="font-mono text-blue-600">./data/ot_database.json</code>, а нормативные акты и сгенерированные документы сохраняются в подпапках <code className="font-mono text-blue-600">./normatives/</code> и <code className="font-mono text-blue-600">./documents/</code> рядом с программой.
          </p>
        </div>

        {/* Section 3 */}
        <div className="space-y-2">
          <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-purple-600" />
            <span>3. Горячие клавиши и управление таблицей</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px]">
            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex justify-between gap-2">
              <span className="shrink-0">Ctrl + S</span>
              <span className="text-slate-500 font-sans text-right">Сохранить базу</span>
            </div>
            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex justify-between gap-2">
              <span className="shrink-0">Ctrl + N</span>
              <span className="text-slate-500 font-sans text-right">Добавить запись</span>
            </div>
            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex justify-between gap-2">
              <span className="shrink-0">Ctrl + F</span>
              <span className="text-slate-500 font-sans text-right">Поиск по таблице</span>
            </div>
            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex justify-between gap-2">
              <span className="shrink-0">Ctrl + V</span>
              <span className="text-slate-500 font-sans text-right">Вставка строк из Excel</span>
            </div>
            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex justify-between gap-2">
              <span className="shrink-0">Клик по ячейке</span>
              <span className="text-slate-500 font-sans text-right">Правка / выбор значения</span>
            </div>
            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex justify-between gap-2">
              <span className="shrink-0">Двойной клик по имени</span>
              <span className="text-slate-500 font-sans text-right">Переименовать вкладку / столбец</span>
            </div>
            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex justify-between gap-2">
              <span className="shrink-0">Enter / Shift+Enter</span>
              <span className="text-slate-500 font-sans text-right">Сохранить ячейку / перенос</span>
            </div>
            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex justify-between gap-2">
              <span className="shrink-0">Esc</span>
              <span className="text-slate-500 font-sans text-right">Отмена правки / закрыть окно</span>
            </div>
          </div>
        </div>

        {/* Section 4 */}
        <div className="space-y-2">
          <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-600" />
            <span>4. Шаблоны, документы и LLM-провайдеры</span>
          </h3>
          <p>
            Формирование приказов, инструкций и направлений в Word (<code className="font-mono">.docx</code>) и PDF по тегам работает автономно через кнопку «Шаблоны» во вкладках и «Документы → Шаблоны», а готовые файлы каталогизируются в «Сгенерированные документы» с автоархивацией повторных версий в <code className="font-mono">АРХИВ/дд.мм.гггг</code>. Дополнительно в меню «LLM-Сервер» можно подключить локальный сервер (Ollama, LM Studio, vLLM) или облачный API (OpenAI, Claude, Gemini, DeepSeek, OpenRouter, Groq).
          </p>
        </div>

        {/* Section 5 */}
        <div className="space-y-2">
          <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600" />
            <span>5. Защита ПДн (152-ФЗ), аудит и подпись Windows</span>
          </h3>
          <p>
            Изменения ячеек, импорт и операции с обязательствами фиксируются в «Файл → Журнал изменений (Аудит)» с экспортом в Excel. Резервные копии можно защищать паролем (шифрование <code className="font-mono">AES-256-GCM</code> + <code className="font-mono">PBKDF2-SHA256</code>), а при работе с облачной LLM персональные данные (ФИО, СНИЛС) обезличиваются локально до отправки. Инструкция по цифровой подписи <code className="font-mono">OT-Baza.exe</code> (<code className="font-mono">signtool.exe</code>) находится в «Файл → Параметры папки и Portable...».
          </p>
        </div>
      </div>
    </AppModal>
  );
};
