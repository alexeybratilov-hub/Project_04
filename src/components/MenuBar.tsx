import React, { useState, useRef, useEffect } from 'react';
import { 
  FileText, Download, Upload, Plus, Trash2, 
  Search, Link as LinkIcon, Database, 
  Settings, HelpCircle, HardDrive, Cpu, 
  FileSpreadsheet, ShieldAlert, BookOpen, Layers
} from 'lucide-react';

interface MenuBarProps {
  onSave: () => void;
  onExportExcel: () => void;
  onFullBackup: () => void;
  onRestore: () => void;
  onOpenPortableModal: () => void;
  onAddRow: () => void;
  onDeleteSelectedRows: () => void;
  onFocusSearch: () => void;
  onAddTab: () => void;
  onOpenColumnEditor: () => void;
  onOpenRelationsSchema: () => void;
  onOpenTagsModal: () => void;
  onOpenTemplateGenerator: () => void;
  onOpenNormativeDocs: () => void;
  onOpenLLMStudio: () => void;
  onOpenHelp: () => void;
}

export const MenuBar: React.FC<MenuBarProps> = ({
  onSave,
  onExportExcel,
  onFullBackup,
  onRestore,
  onOpenPortableModal,
  onAddRow,
  onDeleteSelectedRows,
  onFocusSearch,
  onAddTab,
  onOpenColumnEditor,
  onOpenRelationsSchema,
  onOpenTagsModal,
  onOpenTemplateGenerator,
  onOpenNormativeDocs,
  onOpenLLMStudio,
  onOpenHelp
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const closeMenu = () => setActiveMenu(null);

  return (
    <div 
      ref={barRef}
      className="h-7 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs border-b border-slate-200 dark:border-slate-700/80 flex items-center px-2 select-none relative shrink-0 z-40"
    >
      {/* Файл */}
      <div className="relative">
        <button
          onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'file' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          Файл
        </button>
        {activeMenu === 'file' && (
          <div className="absolute top-full left-0 mt-0.5 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50 animate-in fade-in-50 duration-100">
            <button
              onClick={() => { onSave(); closeMenu(); }}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
            >
              <span className="flex items-center gap-2">
                <Database className="w-3.5 h-3.5" />
                <span>Сохранить базу</span>
              </span>
              <kbd className="text-[10px] text-slate-400 font-mono">Ctrl+S</kbd>
            </button>

            <button
              onClick={() => { onExportExcel(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Экспорт вкладки в Excel (.xlsx)</span>
            </button>

            <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

            <button
              onClick={() => { onFullBackup(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Резервная копия всей базы...</span>
            </button>

            <button
              onClick={() => { onRestore(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Восстановить из копии...</span>
            </button>

            <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

            <button
              onClick={() => {
                const a = document.createElement('a');
                a.href = '/download/OT-Baza.exe';
                a.download = 'OT-Baza.exe';
                document.body.appendChild(a);
                a.click();
                a.remove();
                closeMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Скачать OT-Baza.exe (.exe файл)</span>
            </button>

            <button
              onClick={() => {
                const a = document.createElement('a');
                a.href = '/download/OT-Baza-Windows.zip';
                a.download = 'OT-Baza-Windows.zip';
                document.body.appendChild(a);
                a.click();
                a.remove();
                closeMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Скачать OT-Baza-Windows.zip (Архив)</span>
            </button>

            <button
              onClick={() => { onOpenPortableModal(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-medium"
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>Параметры папки и Portable...</span>
            </button>
          </div>
        )}
      </div>

      {/* Правка */}
      <div className="relative">
        <button
          onClick={() => setActiveMenu(activeMenu === 'edit' ? null : 'edit')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'edit' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          Правка
        </button>
        {activeMenu === 'edit' && (
          <div className="absolute top-full left-0 mt-0.5 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50">
            <button
              onClick={() => { onAddRow(); closeMenu(); }}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300"
            >
              <span className="flex items-center gap-2">
                <Plus className="w-3.5 h-3.5" />
                <span>Добавить строку</span>
              </span>
              <kbd className="text-[10px] text-slate-400 font-mono">Ctrl+N</kbd>
            </button>

            <button
              onClick={() => { onDeleteSelectedRows(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Удалить выбранные строки</span>
            </button>

            <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

            <button
              onClick={() => { onFocusSearch(); closeMenu(); }}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300"
            >
              <span className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5" />
                <span>Поиск по таблице</span>
              </span>
              <kbd className="text-[10px] text-slate-400 font-mono">Ctrl+F</kbd>
            </button>
          </div>
        )}
      </div>

      {/* Вкладки */}
      <div className="relative">
        <button
          onClick={() => setActiveMenu(activeMenu === 'tabs' ? null : 'tabs')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'tabs' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          Вкладки
        </button>
        {activeMenu === 'tabs' && (
          <div className="absolute top-full left-0 mt-0.5 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50">
            <button
              onClick={() => { onAddTab(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Создать новую вкладку (до 20)</span>
            </button>

            <button
              onClick={() => { onOpenColumnEditor(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Настройка столбцов вкладки...</span>
            </button>
          </div>
        )}
      </div>

      {/* Связи */}
      <div className="relative">
        <button
          onClick={() => setActiveMenu(activeMenu === 'relations' ? null : 'relations')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'relations' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          Связи
        </button>
        {activeMenu === 'relations' && (
          <div className="absolute top-full left-0 mt-0.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50">
            <button
              onClick={() => { onOpenRelationsSchema(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium"
            >
              <LinkIcon className="w-3.5 h-3.5 text-blue-600" />
              <span>Схема связей (Мастер → Зависимые)</span>
            </button>

            <button
              onClick={() => { onOpenRelationsSchema(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
              <span>Проверить целостность связей</span>
            </button>
          </div>
        )}
      </div>

      {/* Документы */}
      <div className="relative">
        <button
          onClick={() => setActiveMenu(activeMenu === 'docs' ? null : 'docs')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'docs' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          Документы
        </button>
        {activeMenu === 'docs' && (
          <div className="absolute top-full left-0 mt-0.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50">
            <button
              onClick={() => { onOpenTemplateGenerator(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium"
            >
              <FileText className="w-3.5 h-3.5 text-blue-600" />
              <span>Генерация документов (.docx / PDF)</span>
            </button>

            <button
              onClick={() => { onOpenTagsModal(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Справочник тегов &#123;Имя_тега&#125;</span>
            </button>

            <button
              onClick={() => { onOpenNormativeDocs(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300"
            >
              <BookOpen className="w-3.5 h-3.5 text-purple-600" />
              <span>Нормативные документы (ГОСТ / Приказы)</span>
            </button>
          </div>
        )}
      </div>

      {/* LLM-Сервер */}
      <div className="relative">
        <button
          onClick={() => setActiveMenu(activeMenu === 'llm' ? null : 'llm')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'llm' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          LLM-Сервер
        </button>
        {activeMenu === 'llm' && (
          <div className="absolute top-full left-0 mt-0.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50">
            <button
              onClick={() => { onOpenLLMStudio(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium"
            >
              <Cpu className="w-3.5 h-3.5 text-indigo-600" />
              <span>Студия генерации документов (Ollama)</span>
            </button>

            <button
              onClick={() => { onOpenLLMStudio(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Настройки подключения (localhost:11434)</span>
            </button>
          </div>
        )}
      </div>

      {/* Справка */}
      <div className="relative">
        <button
          onClick={() => setActiveMenu(activeMenu === 'help' ? null : 'help')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'help' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          Справка
        </button>
        {activeMenu === 'help' && (
          <div className="absolute top-full left-0 mt-0.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50">
            <button
              onClick={() => { onOpenHelp(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>О системе «ОТ-База»</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
