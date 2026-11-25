import React, { useState } from 'react';
import { FolderOpen, HardDrive, ShieldCheck, AlertTriangle, Globe, Check } from 'lucide-react';
import { AppModal, AppButton, StatusBanner } from './ui';
import type { WorkspaceStatus } from '../services/workspaceFolderService';

interface WorkspaceFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: WorkspaceStatus;
  folderName: string | null;
  onConnect: () => Promise<boolean>;
  onRequestAccess: () => Promise<boolean>;
  onDisconnect: () => Promise<void>;
}

/**
 * Подключение рабочей папки на диске для веб-версии (File System Access API).
 * Заменяет нативный сервер: приложение само пишет ./data/ot_database.json.
 */
export const WorkspaceFolderModal: React.FC<WorkspaceFolderModalProps> = ({
  isOpen,
  onClose,
  status,
  folderName,
  onConnect,
  onRequestAccess,
  onDisconnect
}) => {
  const [busy, setBusy] = useState<'connect' | 'access' | 'disconnect' | null>(null);

  const run = async (kind: 'connect' | 'access' | 'disconnect', action: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const isConnected = status === 'connected';
  const isUnsupported = status === 'unsupported';

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      icon={<FolderOpen className="w-5 h-5" />}
      iconTone="amber"
      title="Рабочая папка на диске"
      subtitle="Веб-версия может хранить базу прямо в файле — без установки OT-Baza.exe"
      footer={
        <>
          {isConnected && (
            <AppButton
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => void run('disconnect', onDisconnect)}
            >
              {busy === 'disconnect' ? 'Отключение…' : 'Отключить папку'}
            </AppButton>
          )}
          <AppButton variant="secondary" size="sm" onClick={onClose}>
            Закрыть
          </AppButton>
        </>
      }
    >
      <div className="space-y-4">
        {isUnsupported ? (
          <StatusBanner variant="warning" role="status">
            Этот браузер не даёт веб-странице доступ к папкам. Откройте приложение в Chrome или Edge
            (по `https://` или `http://localhost`), либо используйте OT-Baza.exe.
          </StatusBanner>
        ) : (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div
                className={
                  isConnected
                    ? 'w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 flex items-center justify-center shrink-0'
                    : 'w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 flex items-center justify-center shrink-0'
                }
              >
                {isConnected ? <Check className="w-4 h-4" /> : <HardDrive className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {isConnected && folderName
                    ? `Подключена папка «${folderName}»`
                    : status === 'needs-permission'
                      ? `Папка «${folderName}» ждёт подтверждения`
                      : 'Папка не подключена'}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {isConnected ? (
                    <>
                      База сохраняется в{' '}
                      <code className="font-mono">{folderName}/data/ot_database.json</code>, предыдущая
                      версия — в <code className="font-mono">data/backups/</code>.
                    </>
                  ) : status === 'needs-permission' ? (
                    'Браузер сбрасывает разрешение после перезагрузки — подтвердите доступ.'
                  ) : (
                    'Выберите папку: приложение будет читать и писать файл базы напрямую.'
                  )}
                </div>
              </div>
            </div>

            {status === 'needs-permission' ? (
              <div className="flex flex-wrap gap-2">
                <AppButton
                  variant="primary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run('access', onRequestAccess)}
                >
                  <ShieldCheck className="w-4 h-4" />
                  {busy === 'access' ? 'Запрос доступа…' : 'Разрешить доступ'}
                </AppButton>
                <AppButton
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run('connect', onConnect)}
                >
                  Выбрать другую папку…
                </AppButton>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <AppButton
                  variant="primary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run('connect', onConnect)}
                >
                  <FolderOpen className="w-4 h-4" />
                  {busy === 'connect'
                    ? 'Ожидание выбора…'
                    : isConnected
                      ? 'Выбрать другую папку…'
                      : 'Выбрать рабочую папку…'}
                </AppButton>
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-4 space-y-2">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <Globe className="w-4 h-4 text-slate-400" />
            Что важно знать
          </div>
          <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5 list-disc pl-4">
            <li>
              Работает в Chrome и Edge на <code className="font-mono">https://</code> или{' '}
              <code className="font-mono">localhost</code>. В Firefox и Safari недоступно —
              там остаётся хранение в браузере.
            </li>
            <li>
              Папку выбирает только пользователь, через системный диалог. Приложение не получает
              доступ к остальным файлам.
            </li>
            <li>
              После перезагрузки страницы браузер может попросить подтвердить доступ — это его
              политика безопасности, а не ошибка.
            </li>
            <li>
              Отключение папки не удаляет файлы: данные остаются на диске, а приложение
              переключается на хранение в браузере.
            </li>
          </ul>
        </div>

        {status === 'needs-permission' && (
          <StatusBanner variant="info" role="status" compact>
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Пока доступ не подтверждён, изменения сохраняются только в память браузера.
            </span>
          </StatusBanner>
        )}
      </div>
    </AppModal>
  );
};
