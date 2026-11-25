import React from 'react';
import {
  Activity,
  Blocks,
  Briefcase,
  Check,
  ClipboardCheck,
  HeartPulse,
  Plus,
  ShieldCheck,
  Users
} from 'lucide-react';
import { AppModal, AppButton } from './ui';
import { MODULE_DEFINITIONS, ModuleDefinition } from '../data/modules';

interface ModulesModalProps {
  isOpen: boolean;
  onClose: () => void;
  installed: string[];
  rowCounts: Record<string, number>;
  onToggle: (moduleId: string, nextEnabled: boolean) => void;
}

const ICONS: Record<ModuleDefinition['icon'], React.ReactNode> = {
  staffing: <Briefcase className="w-4 h-4" />,
  employees: <Users className="w-4 h-4" />,
  briefings: <ClipboardCheck className="w-4 h-4" />,
  medical: <HeartPulse className="w-4 h-4" />,
  ppe: <ShieldCheck className="w-4 h-4" />,
  sout: <Activity className="w-4 h-4" />,
  incidents: <Blocks className="w-4 h-4" />
};

export const ModulesModal: React.FC<ModulesModalProps> = ({
  isOpen,
  onClose,
  installed,
  rowCounts,
  onToggle
}) => {
  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      icon={<Blocks className="w-5 h-5" />}
      iconTone="blue"
      title="Модули этапов"
      subtitle="Каждый модуль — отдельный этап или точка контроля со своей вкладкой, шаблонами и сроками"
      footer={
        <AppButton variant="secondary" size="sm" onClick={onClose}>
          Готово
        </AppButton>
      }
    >
      <div className="space-y-2">
        {MODULE_DEFINITIONS.map((module) => {
          const enabled = installed.includes(module.id);
          const rows = rowCounts[module.id] ?? 0;
          return (
            <div
              key={module.id}
              className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
                enabled
                  ? 'border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20'
                  : 'border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40'
              }`}
            >
              <div
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  enabled
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                {ICONS[module.icon]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                    {module.title}
                  </span>
                  <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    вкладка: {module.tabName}
                  </span>
                  {rows > 0 && (
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-900/70 dark:text-slate-300">
                      записей: {rows}
                    </span>
                  )}
                  {enabled && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                      <Check className="w-3 h-3" />
                      включён
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                  {module.description}
                </p>
                {!enabled && rows > 0 && (
                  <p className="mt-1 text-[10.5px] text-amber-700 dark:text-amber-300">
                    Данные модуля остаются в базе — при включении вкладка появится снова.
                  </p>
                )}
              </div>
              <AppButton
                variant={enabled ? 'secondary' : 'primary'}
                size="sm"
                className="shrink-0"
                onClick={() => onToggle(module.id, !enabled)}
              >
                {enabled ? 'Отключить' : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    Включить
                  </>
                )}
              </AppButton>
            </div>
          );
        })}
      </div>
    </AppModal>
  );
};
