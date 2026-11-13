import React from 'react';
import { HardDrive, Cpu, Usb, Globe, Check, AlertCircle } from 'lucide-react';
import { LLMConfig, Tab } from '../types/database';
import { StorageMode } from '../services/localApiClient';
import { getLLMProviderPreset } from '../data/llmProviders';

interface StatusBarProps {
  currentTab: Tab;
  entityName: string;
  storageMode: StorageMode;
  usbDisconnected?: boolean;
  databaseDirectory: string;
  llmConfig: LLMConfig;
  onOpenLLMStudio: () => void;
  onOpenPortableModal: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  currentTab,
  entityName,
  storageMode,
  usbDisconnected,
  databaseDirectory,
  llmConfig,
  onOpenLLMStudio,
  onOpenPortableModal
}) => {
  return (
    <footer className="h-6 bg-slate-900 text-slate-400 text-[11px] select-none flex items-center justify-between px-3 border-t border-slate-800 shrink-0 z-20">
      {/* Left: Entity & Tab stats */}
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-slate-300 font-medium truncate max-w-[160px]" title={entityName}>
          {entityName}
        </span>
        <span className="text-slate-700" aria-hidden="true">|</span>
        <span className="flex items-center gap-1 text-slate-300 truncate max-w-[200px]">
          <span className="text-slate-500">Таблица:</span>
          <span className="text-white truncate">«{currentTab.name}»</span>
        </span>
        <span className="text-slate-700" aria-hidden="true">|</span>
        <span className="font-mono tabular-nums text-slate-300 shrink-0">
          Строк: <strong className="text-white">{currentTab.rows.length}</strong>
        </span>
        <span className="text-slate-700 hidden sm:inline" aria-hidden="true">|</span>
        <span className="font-mono tabular-nums text-slate-300 hidden sm:inline shrink-0">
          Столбцов: <strong className="text-white">{currentTab.columns.length}</strong>
        </span>
      </div>

      {/* Right: Real Storage Mode + LLM Config */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onOpenLLMStudio}
          className="hidden sm:flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          title="Настроить или открыть провайдера LLM"
        >
          {llmConfig.status === 'error' ? (
            <AlertCircle className="w-3 h-3 text-red-400" />
          ) : (
            <Cpu className={`w-3 h-3 ${llmConfig.status === 'connected' ? 'text-emerald-400' : 'text-amber-400'}`} />
          )}
          <span className={`font-mono text-[10px] ${
            llmConfig.status === 'connected'
              ? 'text-emerald-300'
              : llmConfig.status === 'error'
                ? 'text-red-300'
                : 'text-slate-400'
          }`}>
            LLM: {getLLMProviderPreset(llmConfig.providerId).id} ({llmConfig.model})
          </span>
        </button>

        <span className="text-slate-700 hidden sm:inline" aria-hidden="true">|</span>

        <button
          type="button"
          onClick={onOpenPortableModal}
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
