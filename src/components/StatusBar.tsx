import React from 'react';
import { HardDrive, Usb, Globe, Check, FolderOpen } from 'lucide-react';
import { LLMConfig, Tab } from '../types/database';
import { StorageMode } from '../services/localApiClient';

interface StatusBarProps {
  currentTab?: Tab;
  systemTabSummary?: {
    label: string;
    totalEvents: number;
    attentionCount: number;
    metricLabel?: string;
  } | null;
  entityName?: string;
  storageMode: StorageMode;
  usbDisconnected?: boolean;
  databaseDirectory: string;
  llmConfig?: LLMConfig;
  onOpenLLMStudio?: () => void;
  onOpenPortableModal: () => void;
  onOpenWorkspaceModal?: () => void;
  workspaceFolderName?: string | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  currentTab,
  systemTabSummary,
  storageMode,
  usbDisconnected,
  databaseDirectory,
  onOpenPortableModal,
  onOpenWorkspaceModal,
  workspaceFolderName
}) => {
  return (
    <footer className="h-6 bg-slate-900/85 text-slate-400 text-[11px] select-none flex items-center justify-between gap-3 px-3 border-t border-slate-700/60 backdrop-blur-xl shrink-0 z-20">
      {/* Left: Active Tab Metrics */}
      <div className="flex items-center gap-2.5 min-w-0">
        {systemTabSummary ? (
          <>
            <span className="flex items-center gap-1 text-slate-300 truncate max-w-[260px]">
              <span className="text-slate-500">Раздел:</span>
              <span className="text-white truncate">«{systemTabSummary.label}»</span>
            </span>
            <span className="text-slate-700" aria-hidden="true">|</span>
            <span className="font-mono tabular-nums text-slate-300 shrink-0">
              {systemTabSummary.metricLabel || 'Мероприятий'}: <strong className="text-white">{systemTabSummary.totalEvents}</strong>
            </span>
            <span className="text-slate-700" aria-hidden="true">|</span>
            <span className="font-mono tabular-nums text-slate-300 shrink-0">
              Требуют внимания:{' '}
              <strong className={systemTabSummary.attentionCount > 0 ? 'text-amber-300' : 'text-emerald-300'}>
                {systemTabSummary.attentionCount}
              </strong>
            </span>
          </>
        ) : currentTab ? (
          <>
            <span className="flex items-center gap-1 text-slate-300 truncate max-w-[240px]">
              <span className="text-slate-500">Таблица:</span>
              <span className="text-white truncate">«{currentTab.name}»</span>
            </span>
            <span className="text-slate-700" aria-hidden="true">|</span>
            <span className="font-mono tabular-nums text-slate-300 shrink-0">
              Строк: <strong className="text-white">{currentTab.rows.length}</strong>
            </span>
            <span className="text-slate-700" aria-hidden="true">|</span>
            <span className="font-mono tabular-nums text-slate-300 shrink-0">
              Столбцов: <strong className="text-white">{currentTab.columns.length}</strong>
            </span>
          </>
        ) : null}
      </div>

      {/* Right: Storage Path / Portable Trigger */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={storageMode === 'native-fs' ? onOpenPortableModal : (onOpenWorkspaceModal ?? onOpenPortableModal)}
          className="flex items-center gap-1.5 hover:text-slate-200 transition-colors cursor-pointer"
          title="Расположение и параметры базы данных"
        >
          {storageMode === 'native-fs' ? (
            usbDisconnected ? (
              <>
                <Usb className="w-3 h-3 text-red-400" />
                <span className="font-mono text-[10px] text-red-300">Носитель недоступен</span>
              </>
            ) : (
              <>
                <HardDrive className="w-3 h-3 text-emerald-400" />
                <span className="font-mono text-[10px] text-emerald-300">
                  Диск: ./data/ot_database.json
                </span>
              </>
            )
          ) : storageMode === 'file-handle' ? (
            <>
              <FolderOpen className="w-3 h-3 text-emerald-400" />
              <span className="font-mono text-[10px] hidden md:inline text-emerald-300">
                Папка: {workspaceFolderName || '—'}/data/ot_database.json
              </span>
              <span className="font-mono text-[10px] md:hidden text-emerald-300">Папка на диске</span>
            </>
          ) : (
            <>
              <Globe className="w-3 h-3 text-slate-400" />
              <span className="font-mono text-[10px] hidden md:inline text-slate-300">
                Веб-режим (браузер) · {databaseDirectory}
              </span>
              <span className="font-mono text-[10px] md:hidden text-slate-300 flex items-center gap-1">
                <Check className="w-3 h-3 text-emerald-400" />
                Веб-база
              </span>
            </>
          )}
        </button>
      </div>
    </footer>
  );
};
