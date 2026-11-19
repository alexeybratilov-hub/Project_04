import React, { useState, useEffect, useMemo } from 'react';
import {
  Database, Download, Upload, HardDrive, ShieldCheck, ArrowRight
} from 'lucide-react';
import { DatabaseState } from '../types/database';
import {
  DatabaseImportPreview,
  SafeRestoreResult,
  storageService,
  summarizeDatabaseState
} from '../services/storageService';
import { localApiClient } from '../services/localApiClient';
import { AppButton, AppModal, ConfirmDialog, StatusBanner } from './ui';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  databaseState: DatabaseState;
  onRestoreDatabase: (state: DatabaseState) => Promise<SafeRestoreResult>;
  onResetDatabase: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  databaseState,
  onRestoreDatabase,
  onResetDatabase
}) => {
  const [isInspecting, setIsInspecting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [includeLlmApiKey, setIncludeLlmApiKey] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [pendingImport, setPendingImport] = useState<DatabaseImportPreview | null>(null);
  const [isConfirmResetOpen, setIsConfirmResetOpen] = useState(false);

  const hasConfiguredApiKey = Boolean(databaseState.llmConfig?.apiKey?.trim());

  const currentSummary = useMemo(
    () => summarizeDatabaseState(databaseState),
    [databaseState]
  );

  useEffect(() => {
    if (isOpen) {
      setStatusMessage(null);
      setPendingImport(null);
      setIsInspecting(false);
      setIsRestoring(false);
      setIsConfirmResetOpen(false);
      setIncludeLlmApiKey(false);
    }
  }, [isOpen]);

  // Preserve backing out of pendingImport on Escape before closing the modal
  useEffect(() => {
    if (!isOpen || !pendingImport) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isConfirmResetOpen && !isRestoring) {
        e.preventDefault();
        setPendingImport(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isConfirmResetOpen, isRestoring, pendingImport]);

  const isNative = localApiClient.isNative();

  const handleExportBackup = () => {
    const filename = `OT_Base_Backup_${new Date().toISOString().split('T')[0]}.json`;
    storageService.exportDatabaseToFile(databaseState, filename, { includeLlmApiKey });
    const keyNote =
      hasConfiguredApiKey && !includeLlmApiKey
        ? ' (API-ключ LLM исключён по умолчанию)'
        : '';
    setStatusMessage({ text: `Резервная копия «${filename}» успешно выгружена${keyNote}` });
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

    setIsInspecting(true);
    setStatusMessage(null);
    setPendingImport(null);
    try {
      const preview = await storageService.inspectDatabaseBackupFile(file);
      setPendingImport(preview);
    } catch (err: any) {
      setStatusMessage({
        text: err?.message || 'Файл не прошёл проверку структуры или версии',
        isError: true
      });
    } finally {
      setIsInspecting(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingImport) return;
    setIsRestoring(true);
    setStatusMessage(null);
    try {
      const result = await onRestoreDatabase(pendingImport.normalizedState);
      if (result.ok) {
        const backupNote = result.backupFileName
          ? ` Резервная копия текущей базы: ./data/backups/${result.backupFileName}.`
          : ' Резервная копия текущей базы сохранена перед заменой.';
        setPendingImport(null);
        setStatusMessage({
          text: `База данных успешно восстановлена!${backupNote}`
        });
      } else {
        setStatusMessage({
          text: `${result.error || 'Не удалось восстановить базу'}${result.rolledBack ? ' Исходная база сохранена (выполнен откат).' : ''}`,
          isError: true
        });
      }
    } catch (err: any) {
      setStatusMessage({
        text: err?.message || 'Ошибка при восстановлении базы. Исходная база не изменена.',
        isError: true
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const integrityTotal = pendingImport
    ? pendingImport.integritySummary.brokenRelationsCount +
      pendingImport.integritySummary.orphanedCellsCount +
      pendingImport.integritySummary.brokenTagsCount
    : 0;

  return (
    <>
      <AppModal
        isOpen={isOpen}
        onClose={() => {
          if (!isRestoring) onClose();
        }}
        closeDisabled={isRestoring}
        closeOnEscape={!pendingImport && !isRestoring}
        size="2xl"
        heightClass="max-h-[90vh]"
        icon={<Database className="w-5 h-5" />}
        iconTone="blue"
        title="Резервное копирование и обслуживание базы"
        subtitle="Снимок всех юридических лиц, таблиц, связей, шаблонов и тегов"
        footer={
          <AppButton variant="secondary" onClick={onClose} disabled={isRestoring}>
            Закрыть
          </AppButton>
        }
      >
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {statusMessage && (
            <StatusBanner variant={statusMessage.isError ? 'error' : 'success'} compact>
              {statusMessage.text}
            </StatusBanner>
          )}

          {pendingImport ? (
            <div className="space-y-4">
              <StatusBanner
                variant="warning"
                title={
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">Проверка импорта: подтвердите замену текущей базы</span>
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white/80 dark:bg-slate-900 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-300">
                      v{pendingImport.sourceVersion}
                    </span>
                  </div>
                }
              >
                <p className="text-[11px]">
                  Файл: <strong className="font-mono">{pendingImport.fileName || 'резервная копия'}</strong>{' '}
                  ({pendingImport.sourceFormat === 'multi-entity' ? 'мульти-организация' : 'совместимый формат v1.0'}).
                  Перед заменой автоматически будет создана резервная копия текущей базы; при сбое записи выполнится откат.
                </p>
              </StatusBanner>

              {/* Comparative Summary */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="grid grid-cols-11 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold px-3.5 py-2 text-[11px]">
                  <div className="col-span-3">Параметр</div>
                  <div className="col-span-3 text-right">Текущая база</div>
                  <div className="col-span-1 text-center" />
                  <div className="col-span-4 text-right">Импортируемый файл</div>
                </div>
                <div className="divide-y divide-slate-200/80 dark:divide-slate-800 bg-white dark:bg-slate-900 text-xs">
                  {[
                    ['Организаций', currentSummary.entitiesCount, pendingImport.incomingSummary.entitiesCount],
                    ['Таблиц (вкладок)', currentSummary.tabsCount, pendingImport.incomingSummary.tabsCount],
                    ['Записей (строк)', currentSummary.rowsCount, pendingImport.incomingSummary.rowsCount],
                    ['Шаблонов', currentSummary.templatesCount, pendingImport.incomingSummary.templatesCount],
                    ['Документов в реестре', currentSummary.generatedDocsCount, pendingImport.incomingSummary.generatedDocsCount]
                  ].map(([label, curVal, nextVal]) => (
                    <div key={String(label)} className="grid grid-cols-11 items-center px-3.5 py-2">
                      <div className="col-span-3 text-slate-600 dark:text-slate-300">{label}</div>
                      <div className="col-span-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {curVal}
                      </div>
                      <div className="col-span-1 flex justify-center text-slate-400">
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                      <div className="col-span-4 text-right font-mono tabular-nums font-semibold text-blue-700 dark:text-blue-400">
                        {nextVal}
                      </div>
                    </div>
                  ))}
                  <div className="px-3.5 py-2 text-[11px] text-slate-500 dark:text-slate-400 space-y-1 bg-slate-50/70 dark:bg-slate-800/30">
                    <div>
                      <span className="font-medium text-slate-700 dark:text-slate-300">Текущие организации:</span>{' '}
                      {currentSummary.entityNames.join(', ') || '—'}
                    </div>
                    <div>
                      <span className="font-medium text-slate-700 dark:text-slate-300">В файле:</span>{' '}
                      {pendingImport.incomingSummary.entityNames.join(', ') || '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Integrity Audit Result */}
              {integrityTotal === 0 && pendingImport.warnings.length === 0 ? (
                <StatusBanner
                  variant="success"
                  compact
                  icon={<ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />}
                >
                  Проверка формата, версии и ссылочной целостности пройдена без замечаний.
                </StatusBanner>
              ) : (
                <StatusBanner
                  variant="warning"
                  compact
                  title={`Замечания предварительной проверки (${pendingImport.warnings.length}):`}
                >
                  <div className="space-y-1">
                    {pendingImport.warnings.map((w, idx) => (
                      <div key={idx} className="leading-snug">
                        • {w}
                      </div>
                    ))}
                  </div>
                </StatusBanner>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <AppButton
                  variant="secondary"
                  size="sm"
                  onClick={handleExportBackup}
                  disabled={isRestoring}
                  icon={<Download className="w-3.5 h-3.5" />}
                >
                  Скачать текущую копию (.json)
                </AppButton>

                <div className="flex items-center gap-2">
                  <AppButton
                    variant="secondary"
                    size="md"
                    onClick={() => setPendingImport(null)}
                    disabled={isRestoring}
                  >
                    Отмена
                  </AppButton>
                  <AppButton
                    variant="primary"
                    size="md"
                    onClick={() => void handleConfirmRestore()}
                    disabled={isRestoring}
                    icon={<Upload className="w-3.5 h-3.5" />}
                  >
                    {isRestoring ? 'Создание бэкапа и запись...' : 'Создать бэкап и восстановить'}
                  </AppButton>
                </div>
              </div>
            </div>
          ) : (
            <>
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
                  <AppButton
                    variant="success"
                    size="md"
                    onClick={handleDiskSnapshot}
                    icon={<HardDrive className="w-3.5 h-3.5" />}
                    className="shrink-0"
                  >
                    Снимок в папку
                  </AppButton>
                </div>
              )}

              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                      Выгрузить полную копию (.JSON)
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                      Организаций: {currentSummary.entitiesCount} · Вкладок: {currentSummary.tabsCount} · Строк: {currentSummary.rowsCount}
                    </p>
                  </div>
                  <AppButton
                    variant="primary"
                    size="md"
                    onClick={handleExportBackup}
                    icon={<Download className="w-3.5 h-3.5" />}
                    className="shrink-0"
                  >
                    Сохранить файл
                  </AppButton>
                </div>
                {hasConfiguredApiKey ? (
                  <label className="flex items-center gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-700/70 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeLlmApiKey}
                      onChange={(e) => setIncludeLlmApiKey(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                    />
                    <span>
                      Включить API-ключ LLM в экспортируемый файл (по умолчанию исключён для безопасности)
                    </span>
                  </label>
                ) : (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-1 border-t border-slate-200/70 dark:border-slate-800">
                    Секреты (API-ключ LLM) не включаются в экспортируемый JSON-файл по умолчанию.
                  </p>
                )}
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                    Восстановить базу из файла
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Проверяет формат, версию и целостность, показывает сводку и создаёт бэкап перед заменой.
                  </p>
                </div>
                <label className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700 font-semibold rounded-lg flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isInspecting ? 'Проверка...' : 'Выбрать файл'}</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    disabled={isInspecting}
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
                  className="text-red-600 dark:text-red-400 hover:underline text-xs font-medium cursor-pointer"
                >
                  Сброс к исходному состоянию
                </button>
              </div>
            </>
          )}
        </div>
      </AppModal>

      <ConfirmDialog
        isOpen={isConfirmResetOpen}
        danger
        title="Сброс базы данных"
        description="Вы уверены, что хотите сбросить базу данных к исходному демонстрационному состоянию? Перед сбросом будет автоматически создана резервная копия текущей базы, а активные таблицы заменятся демо-данными."
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
