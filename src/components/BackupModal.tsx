import React, { useState } from 'react';
import { 
  X, Database, Download, Upload, RefreshCw, 
  Check, AlertCircle, FileArchive, ShieldCheck 
} from 'lucide-react';
import { DatabaseState } from '../types/database';
import { storageService } from '../services/storageService';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  databaseState: DatabaseState;
  onRestoreDatabase: (state: DatabaseState) => void;
  onResetDatabase: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  databaseState,
  onRestoreDatabase,
  onResetDatabase
}) => {
  const [isRestoring, setIsRestoring] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExportBackup = () => {
    const filename = `OT_Base_Backup_${new Date().toISOString().split('T')[0]}.json`;
    storageService.exportDatabaseToFile(databaseState, filename);
    setStatusMessage(`Резервная копия «${filename}» успешно сохранена`);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsRestoring(true);
    setStatusMessage(null);
    try {
      const restored = await storageService.importDatabaseFromFile(file);
      onRestoreDatabase(restored);
      setStatusMessage('База данных успешно восстановлена из резервной копии!');
    } catch (err: any) {
      alert('Ошибка при восстановлении базы: ' + err.message);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleReset = () => {
    if (confirm('Вы уверены, что хотите сбросить базу данных до исходного демонстрационного состояния? Все несохраненные изменения будут перезаписаны.')) {
      onResetDatabase();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 rounded-lg">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Резервное копирование и обслуживание базы
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Полная выгрузка таблиц, связей, шаблонов и нормативных актов в один файл
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
        <div className="p-6 space-y-5 text-xs">
          {/* Status Alert */}
          {statusMessage && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Export card */}
          <div className="p-4 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                Выгрузить полную копию (.JSON / SQLite snapshot)
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Содержит все {databaseState.tabs.length} вкладок, {databaseState.tags.length} тегов и шаблоны.
              </p>
            </div>
            <button
              onClick={handleExportBackup}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-xs flex items-center gap-1.5 shrink-0 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Сохранить копию</span>
            </button>
          </div>

          {/* Import / Restore card */}
          <div className="p-4 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                Восстановить базу из файла
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Загружает ранее сохраненный снимок базы с полной проверкой целостности.
              </p>
            </div>
            <label className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 font-semibold rounded-lg flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>{isRestoring ? 'Чтение...' : 'Выбрать файл'}</span>
              <input
                type="file"
                accept=".json,.sqlite"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
          </div>

          {/* Reset card */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span className="text-slate-500 text-[11px]">
              Вернуть демонстрационную структуру по охране труда:
            </span>
            <button
              onClick={handleReset}
              className="text-red-600 dark:text-red-400 hover:underline text-xs font-medium"
            >
              Сброс к исходному состоянию
            </button>
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
