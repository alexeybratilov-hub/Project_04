import React, { useState, useEffect } from 'react';
import { X, Database, Download, Upload, Check, AlertCircle, HardDrive } from 'lucide-react';
import { DatabaseState } from '../types/database';
import { storageService } from '../services/storageService';
import { localApiClient } from '../services/localApiClient';
import { ConfirmDialog } from './ui/ConfirmDialog';

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
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [isConfirmResetOpen, setIsConfirmResetOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStatusMessage(null);
      setIsConfirmResetOpen(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isConfirmResetOpen) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isConfirmResetOpen, onClose]);

  if (!isOpen) return null;

  const isNative = localApiClient.isNative();

  const handleExportBackup = () => {
    const filename = `OT_Base_Backup_${new Date().toISOString().split('T')[0]}.json`;
    storageService.exportDatabaseToFile(databaseState, filename);
    setStatusMessage({ text: `Резервная копия «${filename}» успешно выгружена` });
  };

  const handleDiskSnapshot = async () => {
    const res = await localApiClient.createDiskBackup();
    if (res.ok) {
      setStatusMessage({ text: `Снимок базы сохранен на диск: ./data/backups/${res.fileName}` });
    } else {
      setStatusMessage({ text: res.message || 'Не удалось создать снимок на диске', isError: true });
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsRestoring(true);
    setStatusMessage(null);
    try {
      const restored = await storageService.importDatabaseFromFile(file);
      onRestoreDatabase(restored);
      setStatusMessage({ text: 'База данных успешно восстановлена из резервной копии!' });
    } catch (err: any) {
      setStatusMessage({ text: err?.message || 'Ошибка при восстановлении базы', isError: true });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 rounded-lg">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Резервное копирование и обслуживание базы
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Снимок всех юридических лиц, таблиц, связей, шаблонов и тегов
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
              aria-label="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-4 text-xs">
            {statusMessage && (
              <div
                className={`p-3 border rounded-lg flex items-center gap-2 ${
                  statusMessage.isError
                    ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                }`}
              >
                {statusMessage.isError ? (
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                ) : (
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
                <span>{statusMessage.text}</span>
              </div>
            )}

            {isNative && (
              <div className="p-4 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                    Быстрый снимок на диск (./data/backups/)
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Создает timestamp-копию файла ot_database.json прямо в папке программы.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDiskSnapshot}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>Снимок в папку</span>
                </button>
              </div>
            )}

            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                  Выгрузить полную копию (.JSON)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                  Организаций: {databaseState.entities.length} · Вкладок: {databaseState.tabs.length}
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportBackup}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center gap-1.5 shrink-0 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Сохранить файл</span>
              </button>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                  Восстановить базу из файла
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Загружает снимок базы с проверкой структуры и перезаписывает хранилище.
                </p>
              </div>
              <label className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 font-semibold rounded-lg flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>{isRestoring ? 'Чтение...' : 'Выбрать файл'}</span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="text-slate-500 text-[11px]">
                Вернуть демонстрационную базу по умолчанию:
              </span>
              <button
                type="button"
                onClick={() => setIsConfirmResetOpen(true)}
                className="text-red-600 dark:text-red-400 hover:underline text-xs font-medium"
              >
                Сброс к исходному состоянию
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end px-6 py-3.5 bg-slate-50/70 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 text-xs">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 rounded-lg font-medium transition-colors"
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={isConfirmResetOpen}
        danger
        title="Сброс базы данных"
        description="Вы уверены, что хотите сбросить базу данных к исходному демонстрационному состоянию? Текущие записи и таблицы будут заменены."
        confirmLabel="Сбросить базу"
        onConfirm={() => {
          setIsConfirmResetOpen(false);
          onResetDatabase();
          onClose();
        }}
        onCancel={() => setIsConfirmResetOpen(false)}
      />
    </>
  );
};
