import React, { useState, useRef, useEffect } from 'react';
import {
  FileText, Download, Upload, Plus, Trash2,
  Search, Link as LinkIcon, Database,
  Settings, HelpCircle, HardDrive, Cpu,
  FileSpreadsheet, ShieldAlert, BookOpen, Layers,
  FolderOpen, AlertCircle, CheckCircle2, AlertTriangle,
  Bell, BellOff, ArrowUpRight, EyeOff, Clock, X
} from 'lucide-react';
import { LLMConfig } from '../types/database';
import { getLLMProviderPreset } from '../data/llmProviders';
import { portablePackageService } from '../services/portablePackageService';
import {
  DeadlineEventItem,
  DeadlineEventsSummary,
  formatIsoToDisplay,
  PopoverDeadlineNotificationsResult
} from '../services/deadlineService';
import { getDeadlineStatusToneClasses } from './DeadlineCellPopover';
import { formatDeadlineRemainingHint } from './DeadlineControlView';
import { Z_INDEX } from './ui/zIndex';
import { useToast } from './ui/ToastProvider';

interface MenuBarProps {
  onSave: () => void;
  onExportExcel: () => void;
  onFullBackup: () => void;
  onRestore: () => void;
  onOpenPortableModal: () => void;
  onOpenWorkspaceModal?: () => void;
  onOpenModules?: () => void;
  workspaceFolderName?: string | null;
  onAddRow: () => void;
  onDeleteSelectedRows: () => void;
  selectedRowsCount?: number;
  onFocusSearch: () => void;
  onAddTab: () => void;
  onOpenColumnEditor: () => void;
  onOpenRelationsSchema: () => void;
  onAuditRelations: () => void;
  onOpenTagsModal: () => void;
  onOpenAllTemplates: () => void;
  onOpenGeneratedDocs: () => void;
  generatedDocsCount?: number;
  onOpenNormativeDocs: () => void;
  onOpenLLMStudio: () => void;
  onOpenLLMSettings: () => void;
  llmConfig: LLMConfig;
  onOpenHelp: () => void;
  deadlineSummary?: DeadlineEventsSummary;
  popoverNotifications?: PopoverDeadlineNotificationsResult;
  deadlineNotificationsEnabled?: boolean;
  onJumpToDeadlineEvent?: (event: DeadlineEventItem) => void;
  onSnoozeDeadlineNotification?: (
    notificationKey: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onToggleDeadlineNotifications?: (
    enabled: boolean
  ) => Promise<{ ok: boolean; error?: string }>;
  onOpenDeadlineControlTab?: () => void;
  initialDeadlinePopoverOpen?: boolean;
}

type MenuKey = 'file' | 'edit' | 'tabs' | 'relations' | 'docs' | 'llm' | 'help';
const MENU_KEYS: readonly MenuKey[] = ['file', 'edit', 'tabs', 'relations', 'docs', 'llm', 'help'];

const EMPTY_DEADLINE_SUMMARY: DeadlineEventsSummary = {
  total: 0,
  overdue: 0,
  dueSoon: 0,
  scheduled: 0,
  completed: 0,
  missingData: 0,
  actionable: 0,
  closedOrMissing: 0
};

const EMPTY_POPOVER_NOTIFICATIONS: PopoverDeadlineNotificationsResult = {
  items: [],
  totalActiveCount: 0,
  snoozedAlertCount: 0,
  overdueAlertCount: 0,
  dueSoonAlertCount: 0
};

export const MenuBar: React.FC<MenuBarProps> = ({
  onSave,
  onExportExcel,
  onFullBackup,
  onRestore,
  onOpenPortableModal,
  onOpenWorkspaceModal,
  onOpenModules,
  workspaceFolderName,
  onAddRow,
  onDeleteSelectedRows,
  selectedRowsCount = 0,
  onFocusSearch,
  onAddTab,
  onOpenColumnEditor,
  onOpenRelationsSchema,
  onAuditRelations,
  onOpenTagsModal,
  onOpenAllTemplates,
  onOpenGeneratedDocs,
  generatedDocsCount = 0,
  onOpenNormativeDocs,
  onOpenLLMStudio,
  onOpenLLMSettings,
  llmConfig,
  onOpenHelp,
  deadlineSummary = EMPTY_DEADLINE_SUMMARY,
  popoverNotifications = EMPTY_POPOVER_NOTIFICATIONS,
  deadlineNotificationsEnabled = true,
  onJumpToDeadlineEvent,
  onSnoozeDeadlineNotification,
  onToggleDeadlineNotifications,
  onOpenDeadlineControlTab,
  initialDeadlinePopoverOpen = false
}) => {
  const { showToast } = useToast();
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const [windowsAssets, setWindowsAssets] = useState<{ exe: boolean; zip: boolean }>({
    exe: true,
    zip: true
  });

  // The Windows binaries are built separately (MinGW-w64) and may be absent in a
  // web-only distribution — hide the actions instead of showing dead menu items.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      portablePackageService.isAssetAvailable('/download/OT-Baza.exe'),
      portablePackageService.isAssetAvailable('/download/OT-Baza-Windows.zip')
    ]).then(([exe, zip]) => {
      if (!cancelled) setWindowsAssets({ exe, zip });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [isDeadlinePopoverOpen, setIsDeadlinePopoverOpen] = useState<boolean>(
    initialDeadlinePopoverOpen
  );
  const [pendingSnoozeKey, setPendingSnoozeKey] = useState<string | null>(null);
  const [isTogglingNotifications, setIsTogglingNotifications] = useState<boolean>(false);
  const [popoverActionError, setPopoverActionError] = useState<string | null>(null);
  const [rovingIndex, setRovingIndex] = useState<number>(0);
  const barRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Partial<Record<MenuKey, HTMLButtonElement | null>>>({});
  const deadlineTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const pendingItemFocusRef = useRef<'first' | 'last' | null>(null);
  const activeMenuRef = useRef<MenuKey | null>(activeMenu);
  activeMenuRef.current = activeMenu;
  const isDeadlinePopoverOpenRef = useRef<boolean>(isDeadlinePopoverOpen);
  isDeadlinePopoverOpenRef.current = isDeadlinePopoverOpen;
  const llmPreset = getLLMProviderPreset(llmConfig?.providerId);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
        setIsDeadlinePopoverOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDeadlinePopoverOpenRef.current) {
        e.preventDefault();
        setIsDeadlinePopoverOpen(false);
        if (barRef.current?.contains(document.activeElement)) {
          deadlineTriggerRef.current?.focus();
        }
        return;
      }
      if (e.key === 'Escape' && activeMenuRef.current) {
        const current = activeMenuRef.current;
        setActiveMenu(null);
        if (barRef.current?.contains(document.activeElement)) {
          triggerRefs.current[current]?.focus();
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, []);

  useEffect(() => {
    if (!activeMenu || !pendingItemFocusRef.current) return;
    const target = pendingItemFocusRef.current;
    pendingItemFocusRef.current = null;
    const rafId = requestAnimationFrame(() => {
      const items = dropdownRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)'
      );
      if (!items || items.length === 0) return;
      if (target === 'last') {
        items[items.length - 1].focus();
      } else {
        items[0].focus();
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeMenu]);

  useEffect(() => {
    if (activeMenu) {
      setIsDeadlinePopoverOpen(false);
    }
  }, [activeMenu]);

  const closeMenu = (restoreFocus = false) => {
    const current = activeMenuRef.current;
    setActiveMenu(null);
    if (restoreFocus && current) {
      triggerRefs.current[current]?.focus();
    }
  };

  const closeDeadlinePopover = (restoreFocus = false) => {
    setIsDeadlinePopoverOpen(false);
    setPopoverActionError(null);
    if (restoreFocus) {
      deadlineTriggerRef.current?.focus();
    }
  };

  const handleSnoozeClick = async (notificationKey: string) => {
    if (!onSnoozeDeadlineNotification || pendingSnoozeKey) return;
    setPopoverActionError(null);
    setPendingSnoozeKey(notificationKey);
    try {
      const res = await onSnoozeDeadlineNotification(notificationKey);
      if (!res.ok) {
        setPopoverActionError(
          res.error || 'Не удалось скрыть уведомление. Проверьте сохранение и повторите попытку.'
        );
      }
    } finally {
      setPendingSnoozeKey(null);
    }
  };

  const handleToggleNotificationsClick = async () => {
    if (!onToggleDeadlineNotifications || isTogglingNotifications) return;
    setPopoverActionError(null);
    setIsTogglingNotifications(true);
    try {
      const res = await onToggleDeadlineNotifications(!deadlineNotificationsEnabled);
      if (!res.ok) {
        setPopoverActionError(
          res.error || 'Не удалось сохранить настройку уведомлений. Повторите попытку.'
        );
      }
    } finally {
      setIsTogglingNotifications(false);
    }
  };

  const focusTopTrigger = (index: number, openDropdown: boolean, focusItem?: 'first' | 'last') => {
    const normalized = (index + MENU_KEYS.length) % MENU_KEYS.length;
    const key = MENU_KEYS[normalized];
    setRovingIndex(normalized);
    if (openDropdown) {
      pendingItemFocusRef.current = focusItem ?? null;
      setActiveMenu(key);
      if (!focusItem) {
        triggerRefs.current[key]?.focus();
      }
    } else {
      triggerRefs.current[key]?.focus();
    }
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, key: MenuKey, idx: number) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusTopTrigger(idx + 1, activeMenu !== null);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusTopTrigger(idx - 1, activeMenu !== null);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusTopTrigger(0, activeMenu !== null);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusTopTrigger(MENU_KEYS.length - 1, activeMenu !== null);
    } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pendingItemFocusRef.current = 'first';
      setRovingIndex(idx);
      setActiveMenu(key);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      pendingItemFocusRef.current = 'last';
      setRovingIndex(idx);
      setActiveMenu(key);
    }
  };

  const handleDropdownKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, idx: number) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
      return;
    }
    if (e.key === 'Tab') {
      setActiveMenu(null);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusTopTrigger(idx + 1, true, 'first');
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusTopTrigger(idx - 1, true, 'first');
      return;
    }

    const items = Array.from(
      dropdownRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || []
    );
    if (items.length === 0) return;

    const currentIdx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = currentIdx === -1 ? 0 : (currentIdx + 1) % items.length;
      items[next].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = currentIdx <= 0 ? items.length - 1 : currentIdx - 1;
      items[prev].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    }
  };

  const topTriggerClass = (key: MenuKey) =>
    `px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors cursor-pointer whitespace-nowrap ${
      activeMenu === key ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white' : ''
    }`;

  return (
    <div
      ref={barRef}
      className="h-7 bg-white/55 dark:bg-slate-900/55 text-slate-700 dark:text-slate-300 text-xs border-b border-white/60 dark:border-slate-700/60 backdrop-blur-xl flex items-center px-2 select-none relative shrink-0 z-40"
    >
      <div role="menubar" aria-label="Главное меню" className="flex items-center">
        {/* Файл */}
        <div className="relative shrink-0">
          <button
            ref={(el) => { triggerRefs.current.file = el; }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={activeMenu === 'file'}
            aria-controls="menubar-menu-file"
            tabIndex={rovingIndex === 0 ? 0 : -1}
            onClick={() => {
              setRovingIndex(0);
              setActiveMenu(activeMenu === 'file' ? null : 'file');
            }}
            onKeyDown={(e) => handleTriggerKeyDown(e, 'file', 0)}
            className={topTriggerClass('file')}
          >
            Файл
          </button>
          {activeMenu === 'file' && (
            <div
              id="menubar-menu-file"
              ref={dropdownRef}
              role="menu"
              aria-label="Файл"
              onKeyDown={(e) => handleDropdownKeyDown(e, 0)}
              className="absolute top-full left-0 mt-0.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50 animate-in fade-in-50 duration-100"
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onSave(); closeMenu(); }}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 focus:text-blue-600 dark:focus:text-blue-400 focus:outline-hidden"
              >
                <span className="flex items-center gap-2">
                  <Database className="w-3.5 h-3.5" />
                  <span>Сохранить базу</span>
                </span>
                <kbd className="text-[10px] text-slate-400 font-mono">Ctrl+S</kbd>
              </button>

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onExportExcel(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 focus:text-blue-600 dark:focus:text-blue-400 focus:outline-hidden"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Экспорт вкладки в Excel (.xlsx)</span>
              </button>

              <div role="separator" className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onFullBackup(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 focus:text-blue-600 dark:focus:text-blue-400 focus:outline-hidden"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Резервная копия всей базы...</span>
              </button>

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onRestore(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 focus:text-blue-600 dark:focus:text-blue-400 focus:outline-hidden"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Восстановить из копии...</span>
              </button>

              <div role="separator" className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onOpenWorkspaceModal?.(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium focus:outline-hidden"
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-600" />
                <span>
                  {workspaceFolderName
                    ? `Рабочая папка: ${workspaceFolderName}`
                    : 'Рабочая папка на диске…'}
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={!windowsAssets.exe}
                title={windowsAssets.exe ? undefined : 'Windows-сборка отсутствует в этой поставке'}
                onClick={() => {
                  closeMenu();
                  portablePackageService
                    .downloadExe()
                    .then(() => showToast('OT-Baza.exe проверен и сохранён', 'success'))
                    .catch((err: any) => showToast(err?.message || 'Ошибка скачивания OT-Baza.exe', 'error'));
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-semibold focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Скачать OT-Baza.exe (.exe файл)</span>
              </button>

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={!windowsAssets.zip}
                title={windowsAssets.zip ? undefined : 'Windows-сборка отсутствует в этой поставке'}
                onClick={() => {
                  closeMenu();
                  portablePackageService
                    .downloadZip()
                    .then(() => showToast('OT-Baza-Windows.zip проверен и сохранён', 'success'))
                    .catch((err: any) => showToast(err?.message || 'Ошибка скачивания OT-Baza-Windows.zip', 'error'));
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600" />
                <span>Скачать OT-Baza-Windows.zip (Архив)</span>
              </button>

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onOpenPortableModal(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 focus:bg-emerald-50 dark:focus:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-medium focus:outline-hidden"
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>Параметры папки и Portable...</span>
              </button>
            </div>
          )}
        </div>

        {/* Правка */}
        <div className="relative shrink-0">
          <button
            ref={(el) => { triggerRefs.current.edit = el; }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={activeMenu === 'edit'}
            aria-controls="menubar-menu-edit"
            tabIndex={rovingIndex === 1 ? 0 : -1}
            onClick={() => {
              setRovingIndex(1);
              setActiveMenu(activeMenu === 'edit' ? null : 'edit');
            }}
            onKeyDown={(e) => handleTriggerKeyDown(e, 'edit', 1)}
            className={topTriggerClass('edit')}
          >
            Правка
          </button>
          {activeMenu === 'edit' && (
            <div
              id="menubar-menu-edit"
              ref={dropdownRef}
              role="menu"
              aria-label="Правка"
              onKeyDown={(e) => handleDropdownKeyDown(e, 1)}
              className="absolute top-full left-0 mt-0.5 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50"
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onAddRow(); closeMenu(); }}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 focus:outline-hidden"
              >
                <span className="flex items-center gap-2">
                  <Plus className="w-3.5 h-3.5" />
                  <span>Добавить строку</span>
                </span>
                <kbd className="text-[10px] text-slate-400 font-mono">Ctrl+N</kbd>
              </button>

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={selectedRowsCount === 0}
                onClick={() => { onDeleteSelectedRows(); closeMenu(); }}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 focus:bg-red-50 dark:focus:bg-red-950/40 text-red-600 dark:text-red-400 disabled:opacity-40 disabled:pointer-events-none focus:outline-hidden"
              >
                <span className="flex items-center gap-2">
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Удалить выбранные строки</span>
                </span>
                {selectedRowsCount > 0 && (
                  <span className="text-[10px] font-mono tabular-nums font-semibold">
                    ({selectedRowsCount})
                  </span>
                )}
              </button>

              <div role="separator" className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onFocusSearch(); closeMenu(); }}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 focus:outline-hidden"
              >
                <span className="flex items-center gap-2">
                  <Search className="w-3.5 h-3.5" />
                  <span>Поиск по таблице</span>
                </span>
                <kbd className="text-[10px] text-slate-400 font-mono">Ctrl+F</kbd>
              </button>
            </div>
          )}
        </div>

        {/* Вкладки */}
        <div className="relative shrink-0">
          <button
            ref={(el) => { triggerRefs.current.tabs = el; }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={activeMenu === 'tabs'}
            aria-controls="menubar-menu-tabs"
            tabIndex={rovingIndex === 2 ? 0 : -1}
            onClick={() => {
              setRovingIndex(2);
              setActiveMenu(activeMenu === 'tabs' ? null : 'tabs');
            }}
            onKeyDown={(e) => handleTriggerKeyDown(e, 'tabs', 2)}
            className={topTriggerClass('tabs')}
          >
            Вкладки
          </button>
          {activeMenu === 'tabs' && (
            <div
              id="menubar-menu-tabs"
              ref={dropdownRef}
              role="menu"
              aria-label="Вкладки"
              onKeyDown={(e) => handleDropdownKeyDown(e, 2)}
              className="absolute top-full left-0 mt-0.5 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50"
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onAddTab(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 focus:outline-hidden"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Создать новую вкладку (до 20)</span>
              </button>

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onOpenModules?.(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 focus:outline-hidden"
              >
                <Layers className="w-3.5 h-3.5 text-indigo-600" />
                <span>Модули этапов…</span>
              </button>

              <div role="separator" className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onOpenColumnEditor(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 focus:outline-hidden"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Настройка столбцов вкладки...</span>
              </button>
            </div>
          )}
        </div>

        {/* Связи */}
        <div className="relative shrink-0">
          <button
            ref={(el) => { triggerRefs.current.relations = el; }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={activeMenu === 'relations'}
            aria-controls="menubar-menu-relations"
            tabIndex={rovingIndex === 3 ? 0 : -1}
            onClick={() => {
              setRovingIndex(3);
              setActiveMenu(activeMenu === 'relations' ? null : 'relations');
            }}
            onKeyDown={(e) => handleTriggerKeyDown(e, 'relations', 3)}
            className={topTriggerClass('relations')}
          >
            Связи
          </button>
          {activeMenu === 'relations' && (
            <div
              id="menubar-menu-relations"
              ref={dropdownRef}
              role="menu"
              aria-label="Связи"
              onKeyDown={(e) => handleDropdownKeyDown(e, 3)}
              className="absolute top-full left-0 mt-0.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50"
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onOpenRelationsSchema(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium focus:outline-hidden"
              >
                <LinkIcon className="w-3.5 h-3.5 text-blue-600" />
                <span>Схема связей (Мастер → Зависимые)</span>
              </button>

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onAuditRelations(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 focus:outline-hidden"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                <span>Проверить целостность связей</span>
              </button>
            </div>
          )}
        </div>

        {/* Документы */}
        <div className="relative shrink-0">
          <button
            ref={(el) => { triggerRefs.current.docs = el; }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={activeMenu === 'docs'}
            aria-controls="menubar-menu-docs"
            tabIndex={rovingIndex === 4 ? 0 : -1}
            onClick={() => {
              setRovingIndex(4);
              setActiveMenu(activeMenu === 'docs' ? null : 'docs');
            }}
            onKeyDown={(e) => handleTriggerKeyDown(e, 'docs', 4)}
            className={topTriggerClass('docs')}
          >
            Документы
          </button>
          {activeMenu === 'docs' && (
            <div
              id="menubar-menu-docs"
              ref={dropdownRef}
              role="menu"
              aria-label="Документы"
              onKeyDown={(e) => handleDropdownKeyDown(e, 4)}
              className="absolute top-full left-0 mt-0.5 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50"
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onOpenAllTemplates(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium focus:outline-hidden"
              >
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                <span>Шаблоны</span>
              </button>

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onOpenGeneratedDocs(); closeMenu(); }}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium focus:outline-hidden"
              >
                <span className="flex items-center gap-2">
                  <FolderOpen className="w-3.5 h-3.5 text-amber-600" />
                  <span>Сгенерированные документы</span>
                </span>
                {generatedDocsCount > 0 && (
                  <span className="text-[11px] font-mono tabular-nums text-slate-400">
                    {generatedDocsCount}
                  </span>
                )}
              </button>

              <div role="separator" className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onOpenTagsModal(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 focus:outline-hidden"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Справочник тегов &#123;Имя_тега&#125;</span>
              </button>

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onOpenNormativeDocs(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 focus:outline-hidden"
              >
                <BookOpen className="w-3.5 h-3.5 text-purple-600" />
                <span>Нормативные документы (ГОСТ / Приказы)</span>
              </button>
            </div>
          )}
        </div>

        {/* LLM-Сервер */}
        <div className="relative shrink-0">
          <button
            ref={(el) => { triggerRefs.current.llm = el; }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={activeMenu === 'llm'}
            aria-controls="menubar-menu-llm"
            tabIndex={rovingIndex === 5 ? 0 : -1}
            onClick={() => {
              setRovingIndex(5);
              setActiveMenu(activeMenu === 'llm' ? null : 'llm');
            }}
            onKeyDown={(e) => handleTriggerKeyDown(e, 'llm', 5)}
            className={topTriggerClass('llm')}
          >
            LLM-Сервер
          </button>
          {activeMenu === 'llm' && (
            <div
              id="menubar-menu-llm"
              ref={dropdownRef}
              role="menu"
              aria-label="LLM-Сервер"
              onKeyDown={(e) => handleDropdownKeyDown(e, 5)}
              className="absolute top-full left-0 mt-0.5 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50"
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onOpenLLMStudio(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 font-medium focus:outline-hidden"
              >
                <Cpu className="w-3.5 h-3.5 text-indigo-600" />
                <span>Студия генерации документов (LLM)</span>
              </button>

              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onOpenLLMSettings(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 focus:outline-hidden"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Провайдер и настройки подключения...</span>
              </button>
            </div>
          )}
        </div>

        {/* Справка */}
        <div className="relative shrink-0">
          <button
            ref={(el) => { triggerRefs.current.help = el; }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={activeMenu === 'help'}
            aria-controls="menubar-menu-help"
            tabIndex={rovingIndex === 6 ? 0 : -1}
            onClick={() => {
              setRovingIndex(6);
              setActiveMenu(activeMenu === 'help' ? null : 'help');
            }}
            onKeyDown={(e) => handleTriggerKeyDown(e, 'help', 6)}
            className={topTriggerClass('help')}
          >
            Справка
          </button>
          {activeMenu === 'help' && (
            <div
              id="menubar-menu-help"
              ref={dropdownRef}
              role="menu"
              aria-label="Справка"
              onKeyDown={(e) => handleDropdownKeyDown(e, 6)}
              className="absolute top-full left-0 mt-0.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1 text-xs z-50"
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { onOpenHelp(); closeMenu(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-300 focus:outline-hidden"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>О системе «ОТ-База»</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Topbar Visible Deadline & LLM Status Indicators */}
      <div className="ml-auto flex items-center gap-1.5 min-w-0 pl-2">
        {(() => {
          const overdueCount = deadlineSummary.overdue;
          const dueSoonCount = deadlineSummary.dueSoon;
          const actionableCount = deadlineSummary.actionable;
          const tone: 'overdue' | 'due_soon' | 'calm' =
            overdueCount > 0 ? 'overdue' : dueSoonCount > 0 ? 'due_soon' : 'calm';

          const triggerToneClass =
            tone === 'overdue'
              ? 'text-red-700 dark:text-red-300 bg-red-50/90 dark:bg-red-950/50 border-red-200 dark:border-red-800/80 hover:bg-red-100 dark:hover:bg-red-950/80'
              : tone === 'due_soon'
                ? 'text-amber-800 dark:text-amber-300 bg-amber-50/90 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/80 hover:bg-amber-100 dark:hover:bg-amber-950/80'
                : 'text-slate-600 dark:text-slate-300 bg-transparent border-transparent hover:bg-slate-200/80 dark:hover:bg-slate-700/80';

          const badgeToneClass =
            tone === 'overdue'
              ? 'bg-red-600 text-white'
              : tone === 'due_soon'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200';

          return (
            <button
              ref={deadlineTriggerRef}
              type="button"
              data-testid="deadline-indicator-btn"
              data-deadline-tone={tone}
              aria-haspopup="dialog"
              aria-expanded={isDeadlinePopoverOpen}
              aria-controls="menubar-deadline-popover"
              onClick={() => {
                setActiveMenu(null);
                setPopoverActionError(null);
                setIsDeadlinePopoverOpen((prev) => !prev);
              }}
              title={
                actionableCount > 0
                  ? `Контроль сроков: просрочено ${overdueCount}, скоро ${dueSoonCount}. Нажмите для просмотра.`
                  : 'Контроль сроков: просроченных и ближайших мероприятий нет.'
              }
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 ${triggerToneClass}`}
            >
              <Bell className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden lg:inline text-[11px] font-medium">Сроки</span>
              <span
                data-testid="deadline-indicator-count"
                className={`px-1.5 py-0 rounded-full text-[10px] font-mono tabular-nums font-bold leading-4 ${badgeToneClass}`}
              >
                {actionableCount}
              </span>
            </button>
          );
        })()}

        <button
          type="button"
          onClick={onOpenLLMSettings}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors cursor-pointer whitespace-nowrap truncate max-w-[180px] sm:max-w-[220px] lg:max-w-[250px] xl:max-w-[420px] ${
            llmConfig.status === 'connected'
              ? 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/40'
              : llmConfig.status === 'error'
                ? 'text-red-700 dark:text-red-300 hover:bg-red-100/70 dark:hover:bg-red-950/50 font-medium'
                : 'text-amber-800 dark:text-amber-300 hover:bg-amber-100/70 dark:hover:bg-amber-950/40 font-medium'
          }`}
          title={
            llmConfig.status === 'connected'
              ? `LLM подключена (${llmPreset.name}: ${llmConfig.model}). Нажмите для изменения настроек.`
              : 'LLM не подключена. Нажмите для настройки провайдера. Генерация документов по тегам работает автономно.'
          }
        >
          {llmConfig.status === 'connected' ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="truncate text-[11px]">
                LLM подключена · <span className="font-mono">{llmPreset.id}: {llmConfig.model}</span>
              </span>
            </>
          ) : llmConfig.status === 'error' ? (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
              <span className="truncate text-[11px]">
                LLM: ошибка подключения <span className="hidden xl:inline text-slate-500 dark:text-slate-400 font-normal">· генерация по тегам работает</span>
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="truncate text-[11px]">
                LLM не подключена <span className="hidden xl:inline text-slate-500 dark:text-slate-400 font-normal">· генерация по тегам работает</span>
              </span>
            </>
          )}
        </button>
      </div>

      {/* Deadline Notifications Popover */}
      {isDeadlinePopoverOpen && (
        <div
          id="menubar-deadline-popover"
          data-testid="deadline-notifications-popover"
          role="dialog"
          aria-label="Ближайшие и просроченные события"
          className={`absolute top-full right-2 mt-1 w-[min(440px,calc(100vw-16px))] max-h-[min(560px,calc(100vh-4.5rem))] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden ${Z_INDEX.popover} text-xs select-text`}
        >
          {/* Popover Header */}
          <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/60 flex items-start justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                Ближайшие и просроченные события
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>
                  Просрочено:{' '}
                  <strong className="font-mono tabular-nums text-red-700 dark:text-red-300">
                    {deadlineSummary.overdue}
                  </strong>
                </span>
                <span>·</span>
                <span>
                  Скоро:{' '}
                  <strong className="font-mono tabular-nums text-amber-700 dark:text-amber-300">
                    {deadlineSummary.dueSoon}
                  </strong>
                </span>
                {popoverNotifications.snoozedAlertCount > 0 && (
                  <>
                    <span>·</span>
                    <span data-testid="popover-snoozed-summary">
                      Скрыто на сегодня:{' '}
                      <strong className="font-mono tabular-nums text-slate-700 dark:text-slate-200">
                        {popoverNotifications.snoozedAlertCount}
                      </strong>
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {onToggleDeadlineNotifications && (
                <button
                  type="button"
                  data-testid="popover-toggle-notifications-btn"
                  aria-pressed={deadlineNotificationsEnabled}
                  disabled={isTogglingNotifications}
                  onClick={() => void handleToggleNotificationsClick()}
                  title={
                    deadlineNotificationsEnabled
                      ? 'Всплывающие напоминания при запуске включены. Нажмите, чтобы отключить.'
                      : 'Всплывающие напоминания при запуске отключены. Нажмите, чтобы включить.'
                  }
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                    deadlineNotificationsEnabled
                      ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                      : 'bg-slate-200/80 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {deadlineNotificationsEnabled ? (
                    <>
                      <Bell className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                      <span>Увед. вкл</span>
                    </>
                  ) : (
                    <>
                      <BellOff className="w-3 h-3" />
                      <span>Без тостов</span>
                    </>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => closeDeadlinePopover(true)}
                aria-label="Закрыть панель уведомлений"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {popoverActionError && (
            <div
              role="alert"
              data-testid="popover-action-error"
              className="px-3.5 py-2 bg-red-50 dark:bg-red-950/60 border-b border-red-200 dark:border-red-800 text-[11px] text-red-700 dark:text-red-200 flex items-start gap-2 shrink-0"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="break-words">{popoverActionError}</span>
            </div>
          )}

          {/* Popover Body */}
          <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-slate-100 dark:divide-slate-800">
            {popoverNotifications.items.length === 0 ? (
              <div
                data-testid="deadline-popover-empty"
                className="px-4 py-6 text-center space-y-1.5"
              >
                <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto">
                  <Clock className="w-4 h-4" />
                </div>
                {popoverNotifications.snoozedAlertCount > 0 ? (
                  <>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      Активных напоминаний на сегодня нет
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Скрытых на сегодня событий: {popoverNotifications.snoozedAlertCount}. Все записи
                      и актуальные статусы по-прежнему отображаются во вкладке «Контроль сроков».
                    </p>
                  </>
                ) : (
                  <>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      Просроченных и ближайших мероприятий нет
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Все контролируемые сроки находятся в норме или плановые даты ещё не заданы.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <>
                {popoverNotifications.items.map((ev) => {
                  const toneClasses = getDeadlineStatusToneClasses(ev.evaluation.status);
                  const nextDisp = formatIsoToDisplay(ev.evaluation.effectiveNextDate);
                  const remainingHint = formatDeadlineRemainingHint(ev);
                  const isSnoozing = pendingSnoozeKey === ev.notificationKey;

                  return (
                    <div
                      key={ev.notificationKey}
                      data-testid="deadline-popover-item"
                      data-notification-key={ev.notificationKey}
                      data-event-id={ev.eventId}
                      data-status={ev.evaluation.status}
                      className="px-3.5 py-2.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 break-words min-w-0 leading-snug">
                          {ev.columnName}
                        </div>
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10.5px] font-semibold leading-none whitespace-nowrap shrink-0 ${toneClasses}`}
                        >
                          {ev.evaluation.statusLabel}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-600 dark:text-slate-300 break-words leading-snug">
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {ev.rowIdentifier}
                        </span>
                        <span className="text-slate-400 mx-1">·</span>
                        <span>{ev.entityName}</span>
                        <span className="text-slate-400 mx-1">·</span>
                        <span>{ev.tabName}</span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="text-slate-500 dark:text-slate-400">План:</span>
                          <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                            {nextDisp || '—'}
                          </span>
                          {ev.evaluation.nextDateSource === 'manual' && (
                            <span className="px-1 py-0 rounded bg-amber-100/80 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[9.5px] font-medium">
                              ручн.
                            </span>
                          )}
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-600 dark:text-slate-300">{remainingHint}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
                        {onSnoozeDeadlineNotification && (
                          <button
                            type="button"
                            data-testid="popover-snooze-btn"
                            disabled={Boolean(pendingSnoozeKey)}
                            onClick={() => void handleSnoozeClick(ev.notificationKey)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <EyeOff className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                            <span>{isSnoozing ? 'Сохранение...' : 'Скрыть на сегодня'}</span>
                          </button>
                        )}
                        {onJumpToDeadlineEvent && (
                          <button
                            type="button"
                            data-testid="popover-jump-btn"
                            onClick={() => {
                              closeDeadlinePopover(false);
                              onJumpToDeadlineEvent(ev);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-950/70 text-blue-700 dark:text-blue-300 text-[11px] font-semibold transition-colors cursor-pointer"
                          >
                            <ArrowUpRight className="w-3 h-3" />
                            <span>Перейти к записи</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {popoverNotifications.totalActiveCount > popoverNotifications.items.length && (
                  <div
                    data-testid="popover-overflow-note"
                    className="px-3.5 py-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-800/30 text-center"
                  >
                    Показаны {popoverNotifications.items.length} самых срочных из{' '}
                    {popoverNotifications.totalActiveCount} активных уведомлений.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Popover Footer */}
          {onOpenDeadlineControlTab && (
            <div className="px-3.5 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/60 shrink-0">
              <button
                type="button"
                data-testid="popover-open-deadline-tab-btn"
                onClick={() => {
                  closeDeadlinePopover(false);
                  onOpenDeadlineControlTab();
                }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Открыть вкладку «Контроль сроков»</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
