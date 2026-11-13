import React, { useState, useEffect } from 'react';
import {
  X, HardDrive, Download, Check, Folder,
  Terminal, ShieldCheck, Laptop, Copy
} from 'lucide-react';
import { AppSettings, DatabaseState } from '../types/database';
import { portablePackageService } from '../services/portablePackageService';
import { localApiClient } from '../services/localApiClient';
import { useToast } from './ui/ToastProvider';

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
  const { showToast } = useToast();
  const [dbDir, setDbDir] = useState(databaseState.settings.databaseDirectory);
  const [isCopied, setIsCopied] = useState(false);
  const [downloading, setDownloading] = useState<'exe' | 'zip' | 'html' | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDbDir(databaseState.settings.databaseDirectory);
    }
  }, [isOpen, databaseState.settings.databaseDirectory]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isNative = localApiClient.isNative();

  const handleSaveDir = () => {
    onUpdateSettings({ databaseDirectory: dbDir.trim() });
    showToast('Метка рабочей папки успешно сохранена', 'success');
  };

  const handleDownloadStarter = () => {
    portablePackageService.downloadWindowsPortableStarter(databaseState);
    showToast('Загрузка стартового набора для Windows начата', 'info');
  };

  const handleDownloadExe = async () => {
    setDownloading('exe');
    try {
      await portablePackageService.downloadExe();
      showToast('Файл OT-Baza.exe проверен (PE Win64) и сохранён', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Не удалось скачать OT-Baza.exe', 'error');
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadZip = async () => {
    setDownloading('zip');
    try {
      await portablePackageService.downloadZip();
      showToast('Архив OT-Baza-Windows.zip проверен (ZIP) и сохранён', 'success');
    } catch (err: any) {
      showToast(
        err?.message ||
          (isNative
            ? 'ZIP-архив доступен для скачивания из веб-версии. Скопируйте текущую папку программы целиком.'
            : 'Не удалось скачать OT-Baza-Windows.zip'),
        'error'
      );
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadHtml = async () => {
    setDownloading('html');
    try {
      await portablePackageService.downloadStandaloneHtml();
      showToast('Автономный файл app.html проверен и сохранён', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Не удалось скачать app.html', 'error');
    } finally {
      setDownloading(null);
    }
  };

  const copyBatScript = () => {
    navigator.clipboard?.writeText(portablePackageService.generateBatLauncher());
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 rounded-lg">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Портативная версия для Windows 10/11 (Portable USB)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isNative
                  ? 'Активен нативный файловый режим OT-Baza.exe (127.0.0.1 -> ./data/ot_database.json)'
                  : 'Скачайте OT-Baza.exe или архив для переноса базы на флешку и любой ПК'}
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

        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Без установки и Node.js</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Встроенный локальный HTTP-сервер внутри .exe, без прав администратора и записей в реестр.
              </p>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                <Folder className="w-4 h-4 text-blue-600" />
                <span>Единая база на диске</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Атомарная запись в .\data\ot_database.json, бэкапы в .\data\backups\, акты в .\normatives\.
              </p>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                <Laptop className="w-4 h-4 text-purple-600" />
                <span>Защита от дублей</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Блокировка одновременной записи (Mutex) на каталог, проверка токена и защита USB.
              </p>
            </div>
          </div>

          {/* Primary Download Block */}
          <div className="p-5 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl space-y-4">
            <div className="space-y-1.5">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                OT-Baza.exe — Автономное приложение Windows 64-bit
              </h3>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                При запуске в любой папке или с USB-флешки автоматически разворачивает структуру каталогов и сохраняет изменения напрямую на носитель:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono text-slate-700 dark:text-slate-300 pt-1">
                <div className="flex items-center gap-1.5 bg-white/80 dark:bg-slate-900/70 px-2.5 py-1.5 rounded border border-blue-200 dark:border-blue-800">
                  <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span>.\data\ot_database.json (основная БД)</span>
                </div>
                <div className="flex items-center gap-1.5 bg-white/80 dark:bg-slate-900/70 px-2.5 py-1.5 rounded border border-blue-200 dark:border-blue-800">
                  <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span>.\data\backups\ (авто-бэкапы JSON)</span>
                </div>
                <div className="flex items-center gap-1.5 bg-white/80 dark:bg-slate-900/70 px-2.5 py-1.5 rounded border border-blue-200 dark:border-blue-800">
                  <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span>.\normatives\ (ГОСТ, СанПиН, файлы)</span>
                </div>
                <div className="flex items-center gap-1.5 bg-white/80 dark:bg-slate-900/70 px-2.5 py-1.5 rounded border border-blue-200 dark:border-blue-800">
                  <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span>.\documents\ (приказы DOCX/PDF)</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-blue-200 dark:border-blue-900">
              <button
                type="button"
                disabled={downloading !== null}
                onClick={handleDownloadExe}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg flex items-center gap-2 transition-colors text-xs cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{downloading === 'exe' ? 'Проверка и загрузка...' : 'Скачать OT-Baza.exe'}</span>
              </button>

              <button
                type="button"
                disabled={downloading !== null}
                onClick={handleDownloadZip}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-semibold rounded-lg flex items-center gap-2 transition-colors text-xs cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>
                  {downloading === 'zip'
                    ? 'Проверка и загрузка...'
                    : 'Скачать OT-Baza-Windows.zip (Рекомендуется)'}
                </span>
              </button>
            </div>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">
              Памятная заметка пути рабочей папки (для отображения в статусе):
            </h3>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={dbDir}
                onChange={(e) => setDbDir(e.target.value)}
                placeholder="Например: E:\Охрана_Труда\OT-Baza"
                className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-xs text-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={handleSaveDir}
                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-lg font-semibold transition-colors shrink-0"
              >
                Сохранить заметку
              </button>
            </div>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                Дополнительные файлы (резервный HTML / .BAT / снимок БД)
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Для ручного переноса или открытия автономного интерфейса в браузере.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={downloading !== null}
                onClick={handleDownloadHtml}
                className="px-3.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 disabled:opacity-60 text-slate-800 dark:text-slate-200 font-semibold rounded-lg text-xs transition-colors cursor-pointer"
              >
                {downloading === 'html' ? 'Загрузка...' : 'app.html'}
              </button>
              <button
                type="button"
                onClick={handleDownloadStarter}
                className="px-3.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 font-semibold rounded-lg text-xs transition-colors"
              >
                Стартовый набор
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-slate-500" />
                <span>Запустить_ОТ_База.bat:</span>
              </span>
              <button
                type="button"
                onClick={copyBatScript}
                className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{isCopied ? 'Скопировано!' : 'Копировать скрипт'}</span>
              </button>
            </div>
            <div className="p-4 bg-slate-900 text-slate-200 font-mono text-[11px] rounded-xl overflow-x-auto leading-relaxed border border-slate-800 select-all max-h-40">
              {portablePackageService.generateBatLauncher()}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end px-6 py-3.5 bg-slate-50/70 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 text-xs shrink-0">
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
  );
};
