import React from 'react';
import {
  Activity,
  Blocks,
  Briefcase,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FolderOpen,
  HeartPulse,
  LayoutGrid,
  ShieldCheck,
  Sparkles,
  Users
} from 'lucide-react';
import { ModuleDefinition } from '../data/modules';
import { Tab } from '../types/database';
import { SYSTEM_DEADLINE_TAB_ID } from '../services/deadlineService';
import { SYSTEM_DASHBOARD_TAB_ID } from '../services/systemTabs';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeTabId: string;
  tabs: Tab[];
  installedModules: string[];
  deadlineAttention: number;
  visualEffects: 'glass' | 'reduced';
  onToggleVisualEffects: () => void;
  onSelectTab: (tabId: string) => void;
  onOpenModules: () => void;
  onOpenWorkspace: () => void;
}

const MODULE_ICONS: Record<ModuleDefinition['icon'], React.ReactNode> = {
  staffing: <Briefcase className="w-[18px] h-[18px]" />,
  employees: <Users className="w-[18px] h-[18px]" />,
  briefings: <ClipboardCheck className="w-[18px] h-[18px]" />,
  medical: <HeartPulse className="w-[18px] h-[18px]" />,
  ppe: <ShieldCheck className="w-[18px] h-[18px]" />,
  sout: <Activity className="w-[18px] h-[18px]" />,
  incidents: <Blocks className="w-[18px] h-[18px]" />
};

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onToggleCollapsed,
  activeTabId,
  tabs,
  installedModules,
  deadlineAttention,
  visualEffects,
  onToggleVisualEffects,
  onSelectTab,
  onOpenModules,
  onOpenWorkspace
}) => {
  const moduleTabs = installedModules
    .map((moduleId) => {
      const icon = MODULE_ICONS[moduleId as ModuleDefinition['icon']];
      return icon ? { moduleId, icon } : null;
    })
    .filter(Boolean) as Array<{ moduleId: string; icon: React.ReactNode }>;

  const installedTabIds = new Set(tabs.map((tab) => tab.id));
  const items = [
    {
      id: SYSTEM_DASHBOARD_TAB_ID,
      label: 'Главная',
      icon: <LayoutGrid className="w-[18px] h-[18px]" />,
      badge: 0,
      available: true
    },
    {
      id: SYSTEM_DEADLINE_TAB_ID,
      label: 'Контроль сроков',
      icon: <CalendarClock className="w-[18px] h-[18px]" />,
      badge: deadlineAttention,
      available: true
    }
  ];

  const moduleEntries = [
    { id: 'staffing', label: 'Штатное расписание', icon: MODULE_ICONS.staffing, tabId: 'tab_positions' },
    { id: 'employees', label: 'Сотрудники', icon: MODULE_ICONS.employees, tabId: 'tab_employees' },
    { id: 'briefings', label: 'Инструктажи', icon: MODULE_ICONS.briefings, tabId: 'tab_instructions' },
    { id: 'medical', label: 'Медосмотры', icon: MODULE_ICONS.medical, tabId: 'tab_med' },
    { id: 'ppe', label: 'СИЗ', icon: MODULE_ICONS.ppe, tabId: 'tab_siz' },
    { id: 'sout', label: 'СОУТ', icon: MODULE_ICONS.sout, tabId: 'tab_factors' },
    { id: 'incidents', label: 'Несчастные случаи', icon: MODULE_ICONS.incidents, tabId: 'tab_incidents' }
  ].filter(
    (entry) =>
      installedModules.includes(entry.id) &&
      installedTabIds.has(entry.tabId) &&
      moduleTabs.some((module) => module.moduleId === entry.id)
  );

  const renderItem = (
    key: string,
    label: string,
    icon: React.ReactNode,
    isActive: boolean,
    onClick: () => void,
    badge?: number
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-current={isActive ? 'page' : undefined}
      className={`group relative w-full flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[12px] transition-colors ${
        collapsed ? 'justify-center px-0' : ''
      } ${
        isActive
          ? 'bg-slate-900/90 text-white shadow-xs dark:bg-white/90 dark:text-slate-900'
          : 'text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800/70'
      }`}
    >
      <span className={isActive ? '' : 'text-slate-400 dark:text-slate-500'}>{icon}</span>
      {!collapsed && <span className="truncate font-medium">{label}</span>}
      {!collapsed && Boolean(badge) && (
        <span
          className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
            isActive
              ? 'bg-white/20 text-white dark:bg-slate-900/15 dark:text-slate-900'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
          }`}
        >
          {badge}
        </span>
      )}
      {collapsed && Boolean(badge) && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" />
      )}
    </button>
  );

  return (
    <aside
      className={`lg-chrome relative z-20 flex flex-col gap-0.5 border-r border-white/60 dark:border-slate-700/60 py-2.5 min-h-0 overflow-y-auto no-scrollbar ${
        collapsed ? 'w-[64px] px-1.5' : 'w-[236px] px-2.5'
      } transition-[width] duration-150 shrink-0`}
      aria-label="Навигация по разделам"
    >
      <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-1 pb-1`}>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              ОТ-База
            </div>
            <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">рабочее пространство</div>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-white/70 dark:text-slate-400 dark:hover:bg-slate-800/70"
          title={collapsed ? 'Развернуть навигацию' : 'Свернуть навигацию'}
          aria-label={collapsed ? 'Развернуть навигацию' : 'Свернуть навигацию'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          Обзор
        </div>
      )}
      {items.map((item) =>
        renderItem(
          item.id,
          item.label,
          item.icon,
          activeTabId === item.id,
          () => onSelectTab(item.id),
          item.badge
        )
      )}

      {!collapsed && (
        <div className="px-1 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          Этапы
        </div>
      )}
      {moduleEntries.map((entry) =>
        renderItem(
          entry.id,
          entry.label,
          entry.icon,
          activeTabId === entry.tabId,
          () => onSelectTab(entry.tabId)
        )
      )}

      <div className="mt-auto space-y-1 pt-2">
        <div className={`${collapsed ? '' : 'px-1'} mb-1 h-px bg-slate-200/70 dark:bg-slate-700/60`} />
        {renderItem(
          'modules',
          'Модули этапов',
          <Blocks className="w-[18px] h-[18px]" />,
          false,
          onOpenModules
        )}
        {renderItem(
          'workspace',
          'Рабочая папка',
          <FolderOpen className="w-[18px] h-[18px]" />,
          false,
          onOpenWorkspace
        )}
        <button
          type="button"
          onClick={onToggleVisualEffects}
          title={
            visualEffects === 'glass'
              ? 'Облегчённые эффекты (без размытия)'
              : 'Включить стеклянные эффекты'
          }
          className={`w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[12px] text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800/70 ${
            collapsed ? 'justify-center px-0' : ''
          }`}
        >
          <Sparkles
            className={`w-[18px] h-[18px] ${
              visualEffects === 'glass' ? 'text-blue-500' : 'text-slate-400'
            }`}
          />
          {!collapsed && (
            <span className="truncate font-medium">
              {visualEffects === 'glass' ? 'Стекло включено' : 'Облегчённый режим'}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
};
