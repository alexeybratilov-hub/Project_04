import React from 'react';
import { HardDrive, Shield, Check, Cpu, WifiOff } from 'lucide-react';
import { LLMConfig, Tab } from '../types/database';

interface StatusBarProps {
  currentTab: Tab;
  totalTabsCount: number;
  databaseDirectory: string;
  llmConfig: LLMConfig;
  onOpenLLMStudio: () => void;
  onOpenPortableModal: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  currentTab,
  totalTabsCount,
  databaseDirectory,
  llmConfig,
  onOpenLLMStudio,
  onOpenPortableModal
}) => {
  return (
    <footer className="h-6 bg-slate-900 text-slate-400 text-[11px] select-none flex items-center justify-between px-3 border-t border-slate-800 shrink-0 z-20">
      {/* Left: Tab stats & Offline Indicator */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-slate-300 font-medium">
          <span>Вкладка:</span>
          <span className="text-white">«{currentTab.name}»</span>
        </span>
        <span className="text-slate-600">|</span>
        <span className="font-mono tabular-nums text-slate-300">
          Строк: <strong className="text-white">{currentTab.rows.length}</strong>
        </span>
        <span className="text-slate-600">|</span>
        <span className="font-mono tabular-nums text-slate-300">
          Столбцов: <strong className="text-white">{currentTab.columns.length}</strong>
        </span>
        <span className="text-slate-600 hidden md:inline">|</span>
        <div className="hidden md:flex items-center gap-1 text-emerald-400">
          <Check className="w-3 h-3" />
          <span>Офлайн-база активна</span>
        </div>
      </div>

      {/* Right: LLM Server status + Portable badge */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenLLMStudio}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors"
          title="Нажмите для проверки связи с локальной нейросетью"
        >
          <Cpu className="w-3 h-3 text-indigo-400" />
          <span className="font-mono text-[10px]">Ollama ({llmConfig.model})</span>
        </button>

        <span className="text-slate-600">|</span>

        <button
          onClick={onOpenPortableModal}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors"
          title="Расположение базы данных на носителе"
        >
          <HardDrive className="w-3 h-3 text-emerald-400" />
          <span className="font-mono text-[10px] hidden sm:inline">{databaseDirectory}</span>
        </button>
      </div>
    </footer>
  );
};
