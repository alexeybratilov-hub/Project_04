import React, { useState, useEffect } from 'react';
import {
  HardDrive, Download, Check, Folder,
  Terminal, ShieldCheck, Laptop, Copy
} from 'lucide-react';
import { AppSettings, DatabaseState } from '../types/database';
import { portablePackageService } from '../services/portablePackageService';
import { localApiClient } from '../services/localApiClient';
import { AppModal, AppButton, AppInput, useToast } from './ui';

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
  const [available, setAvailable] = useState<{ exe: boolean; zip: boolean }>({ exe: true, zip: true });

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void Promise.all([
      portablePackageService.isAssetAvailable('/download/OT-Baza.exe'),
      portablePackageService.isAssetAvailable('/download/OT-Baza-Windows.zip')
    ]).then(([exe, zip]) => {
      if (!cancelled) setAvailable({ exe, zip });
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setDbDir(databaseState.settings.databaseDirectory);
    }
  }, [isOpen, databaseState.settings.databaseDirectory]);

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
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      size="3xl"
      icon={<HardDrive className="w-5 h-5" />}
      iconTone="emerald"
      title="Портативная версия для Windows 10/11 (Portable USB)"
      subtitle={
        isNative
          ? 'Активен нативный файловый режим OT-Baza.exe (127.0.0.1 -> ./data/ot_database.json)'
          : 'Скачайте OT-Baza.exe или архив для переноса базы на флешку и любой ПК'
      }
      footer={
        <AppButton variant="secondary" size="md" onClick={onClose}>
          Закрыть
        </AppButton>
      }
    >
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
            <AppButton
              variant="primary"
              size="md"
              disabled={downloading !== null || !available.exe}
              onClick={handleDownloadExe}
              title={available.exe ? undefined : 'Файл OT-Baza.exe отсутствует в этой поставке'}
            >
              <Download className="w-4 h-4" />
              <span>{downloading === 'exe' ? 'Проверка и загрузка...' : 'Скачать OT-Baza.exe'}</span>
            </AppButton>

            <AppButton
              variant="secondary"
              size="md"
              disabled={downloading !== null || !available.zip}
              onClick={handleDownloadZip}
              title={available.zip ? undefined : 'Файл OT-Baza-Windows.zip отсутствует в этой поставке'}
              className="!bg-slate-800 hover:!bg-slate-700 dark:!bg-slate-700 dark:hover:!bg-slate-600 !text-white !border-transparent"
            >
              <Download className="w-4 h-4" />
              <span>
                {downloading === 'zip'
                  ? 'Проверка и загрузка...'
                  : 'Скачать OT-Baza-Windows.zip (Рекомендуется)'}
              </span>
            </AppButton>
          </div>

          {(!available.exe || !available.zip) && (
            <p
              role="status"
              className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed"
            >
              Windows-сборка отсутствует в этой поставке: бинарники <code>.exe</code>/<code>.zip</code>
              собираются отдельно командой <code>python build_native_windows.py</code> на Windows с
              MinGW-w64. Веб-версия (<code>app.html</code>) и перенос базы через JSON работают без них.
            </p>
          )}
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
          <h3 className="font-semibold text-slate-800 dark:text-slate-200">
            Памятная заметка пути рабочей папки (для отображения в статусе):
          </h3>
          <div className="flex items-center gap-2">
            <AppInput
              type="text"
              mono
              value={dbDir}
              onChange={(e) => setDbDir(e.target.value)}
              placeholder="Например: E:\Охрана_Труда\OT-Baza"
              className="flex-1"
            />
            <AppButton variant="secondary" size="md" onClick={handleSaveDir} className="shrink-0">
              Сохранить заметку
            </AppButton>
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
            <AppButton
              variant="secondary"
              size="sm"
              disabled={downloading !== null}
              onClick={handleDownloadHtml}
            >
              {downloading === 'html' ? 'Загрузка...' : 'app.html'}
            </AppButton>
            <AppButton variant="secondary" size="sm" onClick={handleDownloadStarter}>
              Стартовый набор
            </AppButton>
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
              className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
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
    </AppModal>
  );
};
