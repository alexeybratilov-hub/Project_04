import React, { useState, useRef, useEffect } from 'react';
import {
  FileText, Download, Upload, Plus, Trash2,
  Search, Link as LinkIcon, Database,
  Settings, HelpCircle, HardDrive, Cpu,
  FileSpreadsheet, ShieldAlert, BookOpen, Layers,
  FolderOpen, AlertCircle, CheckCircle2, AlertTriangle
} from 'lucide-react';
import { LLMConfig } from '../types/database';
import { getLLMProviderPreset } from '../data/llmProviders';
import { portablePackageService } from '../services/portablePackageService';
import { useToast } from './ui/ToastProvider';

interface MenuBarProps {
  onSave: () => void;
  onExportExcel: () => void;
  onFullBackup: () => void;
  onRestore: () => void;
  onOpenPortableModal: () => void;
  onAddRow: () => void;
  onDeleteSelectedRows: () => void;
  selectedRowsCount?: number;
  onFocusSearch: () => void;
  onAddTab: () => void;
  onOpenColumnEditor: () => void;
  onOpenRelationsSchema: () => void;
  onAuditRelations: () => void;
  onOpenTagsModal: () => void;
  onOpenAllTemplates: () => void;
  onOpenGeneratedDocs: () => void;
  generatedDocsCount?: number;
  onOpenNormativeDocs: () => void;
  onOpenLLMStudio: () => void;
  onOpenLLMSettings: () => void;
  llmConfig: LLMConfig;
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
  selectedRowsCount = 0,
  onFocusSearch,
  onAddTab,
  onOpenColumnEditor,
  onOpenRelationsSchema,
  onAuditRelations,
  onOpenTagsModal,
  onOpenAllTemplates,
  onOpenGeneratedDocs,
  generatedDocsCount = 0,
  onOpenNormativeDocs,
  onOpenLLMStudio,
  onOpenLLMSettings,
  llmConfig,
  onOpenHelp
}) => {
  const { showToast } = useToast();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const llmPreset = getLLMProviderPreset(llmConfig?.providerId);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveMenu(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEsc);
    };
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
          type="button"
          onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'file' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          Файл
        </button>
        {activeMenu === 'file' && (
          <div className="absolute top-full left-0 mt-0.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50 animate-in fade-in-50 duration-100">
            <button
              type="button"
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
              type="button"
              onClick={() => { onExportExcel(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Экспорт вкладки в Excel (.xlsx)</span>
            </button>

            <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

            <button
              type="button"
              onClick={() => { onFullBackup(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Резервная копия всей базы...</span>
            </button>

            <button
              type="button"
              onClick={() => { onRestore(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Восстановить из копии...</span>
            </button>

            <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

            <button
              type="button"
              onClick={() => {
                closeMenu();
                portablePackageService
                  .downloadExe()
                  .then(() => showToast('OT-Baza.exe проверен и сохранён', 'success'))
                  .catch((err: any) => showToast(err?.message || 'Ошибка скачивания OT-Baza.exe', 'error'));
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Скачать OT-Baza.exe (.exe файл)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                closeMenu();
                portablePackageService
                  .downloadZip()
                  .then(() => showToast('OT-Baza-Windows.zip проверен и сохранён', 'success'))
                  .catch((err: any) => showToast(err?.message || 'Ошибка скачивания OT-Baza-Windows.zip', 'error'));
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Скачать OT-Baza-Windows.zip (Архив)</span>
            </button>

            <button
              type="button"
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
          type="button"
          onClick={() => setActiveMenu(activeMenu === 'edit' ? null : 'edit')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'edit' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          Правка
        </button>
        {activeMenu === 'edit' && (
          <div className="absolute top-full left-0 mt-0.5 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50">
            <button
              type="button"
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
              type="button"
              disabled={selectedRowsCount === 0}
              onClick={() => { onDeleteSelectedRows(); closeMenu(); }}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 disabled:opacity-40 disabled:pointer-events-none"
            >
              <span className="flex items-center gap-2">
                <Trash2 className="w-3.5 h-3.5" />
                <span>Удалить выбранные строки</span>
              </span>
              {selectedRowsCount > 0 && (
                <span className="text-[10px] font-mono tabular-nums font-semibold">
                  ({selectedRowsCount})
                </span>
              )}
            </button>

            <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

            <button
              type="button"
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
          type="button"
          onClick={() => setActiveMenu(activeMenu === 'tabs' ? null : 'tabs')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'tabs' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          Вкладки
        </button>
        {activeMenu === 'tabs' && (
          <div className="absolute top-full left-0 mt-0.5 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50">
            <button
              type="button"
              onClick={() => { onAddTab(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Создать новую вкладку (до 20)</span>
            </button>

            <button
              type="button"
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
          type="button"
          onClick={() => setActiveMenu(activeMenu === 'relations' ? null : 'relations')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'relations' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          Связи
        </button>
        {activeMenu === 'relations' && (
          <div className="absolute top-full left-0 mt-0.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50">
            <button
              type="button"
              onClick={() => { onOpenRelationsSchema(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium"
            >
              <LinkIcon className="w-3.5 h-3.5 text-blue-600" />
              <span>Схема связей (Мастер → Зависимые)</span>
            </button>

            <button
              type="button"
              onClick={() => { onAuditRelations(); closeMenu(); }}
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
          type="button"
          onClick={() => setActiveMenu(activeMenu === 'docs' ? null : 'docs')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'docs' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          Документы
        </button>
        {activeMenu === 'docs' && (
          <div className="absolute top-full left-0 mt-0.5 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50">
            <button
              type="button"
              onClick={() => { onOpenAllTemplates(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium"
            >
              <FileText className="w-3.5 h-3.5 text-blue-600" />
              <span>Шаблоны</span>
            </button>

            <button
              type="button"
              onClick={() => { onOpenGeneratedDocs(); closeMenu(); }}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium"
            >
              <span className="flex items-center gap-2">
                <FolderOpen className="w-3.5 h-3.5 text-amber-600" />
                <span>Сгенерированные документы</span>
              </span>
              {generatedDocsCount > 0 && (
                <span className="text-[11px] font-mono tabular-nums text-slate-400">
                  {generatedDocsCount}
                </span>
              )}
            </button>

            <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

            <button
              type="button"
              onClick={() => { onOpenTagsModal(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Справочник тегов &#123;Имя_тега&#125;</span>
            </button>

            <button
              type="button"
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
          type="button"
          onClick={() => setActiveMenu(activeMenu === 'llm' ? null : 'llm')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'llm' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          LLM-Сервер
        </button>
        {activeMenu === 'llm' && (
          <div className="absolute top-full left-0 mt-0.5 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50">
            <button
              type="button"
              onClick={() => { onOpenLLMStudio(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium"
            >
              <Cpu className="w-3.5 h-3.5 text-indigo-600" />
              <span>Студия генерации документов (LLM)</span>
            </button>

            <button
              type="button"
              onClick={() => { onOpenLLMSettings(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Провайдер и настройки подключения...</span>
            </button>
          </div>
        )}
      </div>

      {/* Справка */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setActiveMenu(activeMenu === 'help' ? null : 'help')}
          className={`px-2.5 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${activeMenu === 'help' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''}`}
        >
          Справка
        </button>
        {activeMenu === 'help' && (
          <div className="absolute top-full left-0 mt-0.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50">
            <button
              type="button"
              onClick={() => { onOpenHelp(); closeMenu(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-300"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>О системе «ОТ-База»</span>
            </button>
          </div>
        )}
      </div>

      {/* Topbar Visible LLM Connection Indicator */}
      <div className="ml-auto flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onOpenLLMSettings}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors cursor-pointer whitespace-nowrap truncate max-w-[440px] ${
            llmConfig.status === 'connected'
              ? 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/40'
              : llmConfig.status === 'error'
                ? 'text-red-700 dark:text-red-300 hover:bg-red-100/70 dark:hover:bg-red-950/50 font-medium'
                : 'text-amber-800 dark:text-amber-300 hover:bg-amber-100/70 dark:hover:bg-amber-950/40 font-medium'
          }`}
          title={
            llmConfig.status === 'connected'
              ? `LLM подключена (${llmPreset.name}: ${llmConfig.model}). Нажмите для изменения настроек.`
              : 'LLM не подключена. Нажмите для настройки провайдера. Генерация документов по тегам работает автономно.'
          }
        >
          {llmConfig.status === 'connected' ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="truncate text-[11px]">
                LLM подключена · <span className="font-mono">{llmPreset.id}: {llmConfig.model}</span>
              </span>
            </>
          ) : llmConfig.status === 'error' ? (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
              <span className="truncate text-[11px]">
                LLM: ошибка подключения <span className="hidden lg:inline text-slate-500 dark:text-slate-400 font-normal">· генерация по тегам работает</span>
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="truncate text-[11px]">
                LLM не подключена <span className="hidden lg:inline text-slate-500 dark:text-slate-400 font-normal">· генерация по тегам работает</span>
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
