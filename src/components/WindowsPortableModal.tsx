import React, { useState } from 'react';
import { 
  X, HardDrive, Download, Check, Folder, 
  Terminal, ShieldCheck, Laptop, Copy, ExternalLink 
} from 'lucide-react';
import { AppSettings, DatabaseState } from '../types/database';
import { portablePackageService } from '../services/portablePackageService';

interface WindowsPortableModalProps {
  isOpen: boolean;
  onClose: () => void;
  databaseState: DatabaseState;
  onUpdateSettings: (settings: Partial<AppSettings>) => void;
}

export const WindowsPortableModal: React.FC<WindowsPortableModalProps> = ({
  isOpen,
  onClose,
  databaseState,
  onUpdateSettings
}) => {
  const [dbDir, setDbDir] = useState(databaseState.settings.databaseDirectory);
  const [isCopied, setIsCopied] = useState(false);

  if (!isOpen) return null;

  const handleSaveDir = () => {
    onUpdateSettings({ databaseDirectory: dbDir.trim() });
    alert('Путь к папке базы данных успешно сохранен');
  };

  const handleDownloadStarter = () => {
    portablePackageService.downloadWindowsPortableStarter(databaseState);
  };

  const copyBatScript = () => {
    navigator.clipboard.writeText(portablePackageService.generateBatLauncher());
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-3xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 rounded-lg">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Портативная версия для Windows 10/11 (Portable USB)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Запуск с флешки на любом рабочем ПК без установки в систему и без интернета
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
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          {/* Key Advantages */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Без установки</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Не требует прав администратора, не оставляет следов в реестре Windows.
              </p>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                <Folder className="w-4 h-4 text-blue-600" />
                <span>Все файлы рядом</span>
              </div>
              <p className="text-[11px] text-slate-500">
                База, прикрепленные ГОСТы и сгенерированные приказы лежат в одной папке на носителе.
              </p>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                <Laptop className="w-4 h-4 text-purple-600" />
                <span>Windows 10 / 11</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Оптимизировано под интерфейс Windows, с поддержкой горячих клавиш и PWA.
              </p>
            </div>
          </div>

          {/* PRIMARY: Download OT-Baza.exe (All-in-one executable) & ZIP archive */}
          <div className="p-5 bg-blue-50/80 dark:bg-blue-950/50 border-2 border-blue-500/80 dark:border-blue-600 rounded-xl space-y-4 shadow-sm">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-600 text-white">
                    Готовый .EXE для Windows 10/11
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Нативный x86_64 PE бинарник
                  </span>
                </div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  OT-Baza.exe — Портативное приложение «всё в одном»
                </h3>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
                  <strong>Ничего отдельно городить не нужно!</strong> При запуске на любом компьютере или флешке автоматически разворачивает в своем корневом каталоге:
                </p>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-700 dark:text-slate-300 pt-1">
                  <div className="flex items-center gap-1.5 bg-white/70 dark:bg-slate-900/70 px-2 py-1 rounded border border-blue-200 dark:border-blue-800">
                    <Folder className="w-3.5 h-3.5 text-blue-500" />
                    <span>.\data\ot_database.json</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-white/70 dark:bg-slate-900/70 px-2 py-1 rounded border border-blue-200 dark:border-blue-800">
                    <Folder className="w-3.5 h-3.5 text-blue-500" />
                    <span>.\documents\ (приказы, акты)</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-white/70 dark:bg-slate-900/70 px-2 py-1 rounded border border-blue-200 dark:border-blue-800">
                    <Folder className="w-3.5 h-3.5 text-blue-500" />
                    <span>.\normatives\ (ГОСТы, СанПиН)</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-white/70 dark:bg-slate-900/70 px-2 py-1 rounded border border-blue-200 dark:border-blue-800">
                    <Folder className="w-3.5 h-3.5 text-blue-500" />
                    <span>.\templates\ (бланки .docx)</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-blue-200 dark:border-blue-900">
              <button
                onClick={() => portablePackageService.downloadExe()}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg shadow-md flex items-center gap-2 transition-transform active:scale-95 text-xs"
              >
                <Download className="w-4 h-4" />
                <span>Скачать OT-Baza.exe (1.8 МБ)</span>
              </button>

              <button
                onClick={() => portablePackageService.downloadZip()}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-semibold rounded-lg shadow-sm flex items-center gap-2 transition-transform active:scale-95 text-xs"
                title="Скачать в ZIP-архиве (если браузер блокирует прямую загрузку .exe файлов)"
              >
                <Download className="w-4 h-4" />
                <span>Скачать в ZIP-архиве (1.1 МБ, Рекомендуется)</span>
              </button>

              <span className="text-[11px] text-slate-500">
                Запускается в автономном окне Windows без интернета.
              </span>
            </div>
          </div>

          {/* Database Directory Config */}
          <div className="p-4 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">
              Рабочая папка хранения базы на диске/USB-носителе:
            </h3>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={dbDir}
                onChange={(e) => setDbDir(e.target.value)}
                placeholder="Например: D:\OT-Base-Portable\Data или E:\Охрана_Труда"
                className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-xs text-slate-900 dark:text-slate-100"
              />
              <button
                onClick={handleSaveDir}
                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-lg font-semibold transition-colors shrink-0"
              >
                Сохранить путь
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Каталог, где <code className="font-mono">OT-Baza.exe</code> создает файл базы и сохраняет документы.
            </p>
          </div>

          {/* Download Alternative: Standalone HTML & BAT */}
          <div className="p-4 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                Дополнительно: Скачать автономный файл app.html или .BAT скрипт
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Если требуется открыть базу в отдельном браузере без запуска исполняемого файла.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => portablePackageService.downloadStandaloneHtml()}
                className="px-3.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-semibold rounded-lg text-xs transition-colors"
              >
                Скачать app.html
              </button>
              <button
                onClick={handleDownloadStarter}
                className="px-3.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-semibold rounded-lg text-xs transition-colors"
              >
                Скачать .BAT скрипт
              </button>
            </div>
          </div>

          {/* Preview Launcher Script */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-slate-500" />
                <span>Содержимое файла запуска Запустить_ОТ_База.bat:</span>
              </span>
              <button
                onClick={copyBatScript}
                className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{isCopied ? 'Скопировано!' : 'Копировать скрипт'}</span>
              </button>
            </div>
            <div className="p-4 bg-slate-900 text-slate-200 font-mono text-[11px] rounded-xl overflow-x-auto leading-relaxed border border-slate-800 select-all max-h-44">
              {portablePackageService.generateBatLauncher()}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3.5 bg-slate-50/60 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 text-xs">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 rounded-lg font-medium transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
