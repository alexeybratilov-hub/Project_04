import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  Plus, Key, MoreVertical, Edit2, Trash2, 
  Columns, Maximize2, Minimize2, Link2, GripVertical
} from 'lucide-react';
import { Tab, TabBarMode } from '../types/database';
import { Z_INDEX } from './ui';
import { calculateTargetIndexFromInsertSlot } from '../utils/reorderUtils';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  tabBarMode?: TabBarMode;
  onChangeTabBarMode?: (mode: TabBarMode) => void;
  onSelectTab: (tabId: string) => void;
  onAddTab: () => void;
  onRenameTab: (tabId: string, newName: string) => void;
  onDeleteTab: (tabId: string) => void;
  onReorderTabs?: (fromIndex: number, toIndex: number) => void;
  onToggleMaster?: (tabId: string) => void;
  onConfigureMasterDeps?: (tabId: string) => void;
  onOpenColumnEditor?: () => void;
}

interface ContextMenuState {
  tab: Tab;
  x: number;
  y: number;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  tabBarMode = 'single',
  onChangeTabBarMode,
  onSelectTab,
  onAddTab,
  onRenameTab,
  onDeleteTab,
  onReorderTabs,
  onToggleMaster,
  onConfigureMasterDeps,
  onOpenColumnEditor
}) => {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Drag & Drop reordering state (ref-backed for immediate sync across rapid dragover/child events)
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [tabInsertSlot, setTabInsertSlot] = useState<number | null>(null);
  const draggedTabIdRef = useRef<string | null>(null);
  const tabInsertSlotRef = useRef<number | null>(null);

  // Fallback state if controlled mode callback is not passed
  const [internalMode, setInternalMode] = useState<TabBarMode>(tabBarMode);
  const effectiveMode = onChangeTabBarMode ? tabBarMode : internalMode;
  const isSingleRow = effectiveMode === 'single';

  const setMode = (next: TabBarMode) => {
    if (onChangeTabBarMode) {
      onChangeTabBarMode(next);
    } else {
      setInternalMode(next);
    }
  };

  const [tabBarHeight, setTabBarHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('ot_tabbar_height');
      return saved ? parseInt(saved, 10) : 84;
    } catch {
      return 84;
    }
  });

  const [isCustomMultiHeight, setIsCustomMultiHeight] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem('ot_tabbar_height', String(tabBarHeight));
    } catch {
      // Ignore storage access errors in restricted file:// policies
    }
  }, [tabBarHeight]);

  // Keep active tab scrolled into view in 1-row mode
  useEffect(() => {
    if (!isSingleRow || !tabsScrollRef.current) return;
    const activeEl = tabsScrollRef.current.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeTabId, isSingleRow]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && contextMenu) {
        e.preventDefault();
        const tabId = contextMenu.tab.id;
        setContextMenu(null);
        requestAnimationFrame(() => {
          tabsScrollRef.current?.querySelector<HTMLElement>(`[data-tab-id="${tabId}"]`)?.focus();
        });
      }
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('keydown', handleEsc);
      const rafId = requestAnimationFrame(() => {
        menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
      });
      return () => {
        cancelAnimationFrame(rafId);
        document.removeEventListener('mousedown', handleClickOutside);
        window.removeEventListener('keydown', handleEsc);
      };
    }
    return undefined;
  }, [contextMenu]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newHeight = Math.max(40, Math.min(260, e.clientY - rect.top));
      setTabBarHeight(newHeight);
      setIsCustomMultiHeight(true);
      setMode('auto');
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const startRename = (tab: Tab) => {
    setEditingTabId(tab.id);
    setEditingName(tab.name);
    setContextMenu(null);
  };

  const handleFinishRename = (tabId: string) => {
    if (editingName.trim()) {
      onRenameTab(tabId, editingName.trim());
    }
    setEditingTabId(null);
  };

  const openMenuForElement = (anchorEl: HTMLElement, tab: Tab) => {
    const btnRect = anchorEl.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 240, Math.max(8, btnRect.left));
    const y = Math.min(window.innerHeight - 230, btnRect.bottom + 4);
    setContextMenu({ tab, x, y });
  };

  const handleOpenMenu = (e: React.MouseEvent, tab: Tab) => {
    e.stopPropagation();
    openMenuForElement(e.currentTarget as HTMLElement, tab);
  };

  const focusTabAt = (index: number) => {
    if (tabs.length === 0) return;
    const normalized = (index + tabs.length) % tabs.length;
    const targetTab = tabs[normalized];
    if (!targetTab) return;
    onSelectTab(targetTab.id);
    requestAnimationFrame(() => {
      tabsScrollRef.current?.querySelector<HTMLElement>(`[data-tab-id="${targetTab.id}"]`)?.focus();
    });
  };

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, tab: Tab, idx: number) => {
    if (editingTabId === tab.id) return;

    if (e.key === 'ArrowRight' || (!isSingleRow && e.key === 'ArrowDown')) {
      e.preventDefault();
      focusTabAt(idx + 1);
    } else if (e.key === 'ArrowLeft' || (!isSingleRow && e.key === 'ArrowUp')) {
      e.preventDefault();
      focusTabAt(idx - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusTabAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusTabAt(tabs.length - 1);
    } else if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      onSelectTab(tab.id);
    } else if (e.key === 'F2') {
      e.preventDefault();
      startRename(tab);
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      openMenuForElement(e.currentTarget, tab);
    }
  };

  const handleContextMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      setContextMenu(null);
      return;
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || []
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

  const clearTabDragState = useCallback(() => {
    draggedTabIdRef.current = null;
    tabInsertSlotRef.current = null;
    setDraggedTabId(null);
    setTabInsertSlot(null);
  }, []);

  useEffect(() => {
    window.addEventListener('dragend', clearTabDragState);
    window.addEventListener('blur', clearTabDragState);
    return () => {
      window.removeEventListener('dragend', clearTabDragState);
      window.removeEventListener('blur', clearTabDragState);
    };
  }, [clearTabDragState]);

  useEffect(() => {
    if (editingTabId) {
      clearTabDragState();
    }
  }, [editingTabId, clearTabDragState]);

  const isTabDragEvent = (e: React.DragEvent): boolean => {
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes('Files')) return false;
    return Boolean(
      draggedTabIdRef.current ||
        types.includes('application/x-otbaza-tab')
    );
  };

  const computeTabInsertSlot = (clientX: number, clientY: number): number | null => {
    const stripEl = tabsScrollRef.current;
    if (!stripEl || tabs.length === 0) return null;
    const tabEls = Array.from(stripEl.querySelectorAll<HTMLElement>('[data-tab-id]'));
    if (tabEls.length === 0) return null;

    const rects = tabEls.map((el, index) => ({
      index,
      rect: el.getBoundingClientRect()
    }));

    if (isSingleRow) {
      for (const item of rects) {
        const midX = item.rect.left + item.rect.width / 2;
        if (clientX < midX) return item.index;
      }
      return rects.length;
    }

    // Multi-row wrapped mode: identify vertical row band matching pointer Y
    const sameRow = rects.filter(
      ({ rect }) => clientY >= rect.top - 8 && clientY <= rect.bottom + 8
    );

    if (sameRow.length > 0) {
      for (const item of sameRow) {
        const midX = item.rect.left + item.rect.width / 2;
        if (clientX < midX) return item.index;
      }
      const lastInRow = sameRow[sameRow.length - 1];
      return lastInRow.index + 1;
    }

    if (clientY < rects[0].rect.top) return 0;
    return rects.length;
  };

  // Drag handlers for tab reordering
  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    const targetEl = e.target as HTMLElement | null;
    if (editingTabId === tabId || targetEl?.closest('button, input')) {
      e.preventDefault();
      return;
    }
    draggedTabIdRef.current = tabId;
    tabInsertSlotRef.current = null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-otbaza-tab', tabId);
    e.dataTransfer.setData('text/plain', tabId);
    // Defer visual dimming until browser captures drag image
    requestAnimationFrame(() => {
      if (draggedTabIdRef.current === tabId) {
        setDraggedTabId(tabId);
      }
    });
  };

  const handleTabListDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isTabDragEvent(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const nextSlot = computeTabInsertSlot(e.clientX, e.clientY);
    if (nextSlot !== tabInsertSlotRef.current) {
      tabInsertSlotRef.current = nextSlot;
      setTabInsertSlot(nextSlot);
    }
  };

  const handleTabListDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Do NOT clear drag state when pointer moves across child spans, icons, or gaps inside tablist
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    tabInsertSlotRef.current = null;
    setTabInsertSlot(null);
  };

  const handleTabListDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isTabDragEvent(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const sourceId =
      draggedTabIdRef.current ||
      e.dataTransfer.getData('application/x-otbaza-tab') ||
      e.dataTransfer.getData('text/plain');

    const slot =
      computeTabInsertSlot(e.clientX, e.clientY) ?? tabInsertSlotRef.current;

    if (sourceId && slot !== null && onReorderTabs) {
      const fromIdx = tabs.findIndex((t) => t.id === sourceId);
      const toIdx = calculateTargetIndexFromInsertSlot(fromIdx, slot, tabs.length);
      if (fromIdx !== -1 && toIdx !== null) {
        onReorderTabs(fromIdx, toIdx);
      }
    }
    clearTabDragState();
  };

  const handleDragEnd = () => {
    clearTabDragState();
  };

  return (
    <div
      ref={containerRef}
      className="relative z-30 bg-slate-200/90 dark:bg-slate-900 border-b border-slate-300 dark:border-slate-800 select-none flex flex-col shrink-0 transition-[height] duration-75"
      style={
        isSingleRow
          ? { height: 'auto' }
          : {
              height: isCustomMultiHeight ? `${tabBarHeight}px` : 'auto',
              maxHeight: isCustomMultiHeight ? undefined : '240px'
            }
      }
    >
      {/* Tabs Row + Pinned Controls */}
      <div className={`flex ${isSingleRow ? 'items-center' : 'items-start'} min-w-0 flex-1 overflow-hidden`}>
        {/* Tabs Strip: single horizontal row by default, or wrapped multi-row when expanded */}
        <div
          ref={tabsScrollRef}
          role="tablist"
          aria-label="Вкладки таблиц"
          onDragOver={handleTabListDragOver}
          onDragLeave={handleTabListDragLeave}
          onDrop={handleTabListDrop}
          className={`flex-1 min-w-0 px-2 py-1 flex items-center gap-1.5 ${
            isSingleRow
              ? 'flex-nowrap overflow-x-auto no-scrollbar'
              : 'flex-wrap overflow-x-hidden overflow-y-auto content-start max-h-full'
          }`}
        >
          {tabs.map((tab, index) => {
            const isActive = tab.id === activeTabId;
            const hasActiveMatch = tabs.some((t) => t.id === activeTabId);
            const isRovingFocusTarget = editingTabId === tab.id ? false : isActive || (!hasActiveMatch && index === 0);
            const isMaster = tab.isMaster;
            const activeDragId = draggedTabId || draggedTabIdRef.current;
            const draggedIdx = activeDragId ? tabs.findIndex((t) => t.id === activeDragId) : -1;
            const effectiveTarget =
              tabInsertSlot !== null && draggedIdx !== -1
                ? calculateTargetIndexFromInsertSlot(draggedIdx, tabInsertSlot, tabs.length)
                : null;
            const showInsertBefore = effectiveTarget !== null && tabInsertSlot === index;
            const showInsertAfterLast =
              effectiveTarget !== null && index === tabs.length - 1 && tabInsertSlot === tabs.length;
            const isDragging = draggedTabId === tab.id;

            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                tabIndex={isRovingFocusTarget ? 0 : -1}
                data-tab-id={tab.id}
                draggable={editingTabId !== tab.id}
                onDragStart={(e) => handleDragStart(e, tab.id)}
                onDragEnd={handleDragEnd}
                onKeyDown={(e) => handleTabKeyDown(e, tab, index)}
                className={`group relative flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer border shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  isActive
                    ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 border-blue-400/70 dark:border-blue-600/80 shadow-xs font-semibold ring-1 ring-blue-500/20'
                    : 'bg-white/60 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 border-slate-300/80 dark:border-slate-700/80 hover:border-slate-400'
                } ${isDragging ? 'opacity-45 border-dashed border-blue-400 dark:border-blue-500' : ''}`}
                onClick={() => onSelectTab(tab.id)}
                title="Перетащите мышкой для изменения порядка вкладок (стрелки ←/→ — переключение, F2 — переименовать)"
              >
                {showInsertBefore && (
                  <span
                    data-testid="tab-drop-indicator"
                    aria-hidden="true"
                    className="pointer-events-none absolute -left-[5px] top-0 bottom-0 w-[3px] rounded-full bg-blue-600 dark:bg-blue-400 shadow-[0_0_0_2px_rgba(37,99,235,0.22)] z-20"
                  />
                )}
                {showInsertAfterLast && (
                  <span
                    data-testid="tab-drop-indicator"
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-[5px] top-0 bottom-0 w-[3px] rounded-full bg-blue-600 dark:bg-blue-400 shadow-[0_0_0_2px_rgba(37,99,235,0.22)] z-20"
                  />
                )}
                <GripVertical className="w-3 h-3 text-slate-400 dark:text-slate-500 opacity-45 group-hover:opacity-100 -ml-1 shrink-0 cursor-grab" aria-hidden="true" />

              {isMaster && (
                <span title="Мастер-таблица (источник данных для связей)" className="text-amber-500 shrink-0">
                  <Key className="w-3.5 h-3.5" />
                </span>
              )}

              {editingTabId === tab.id ? (
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => handleFinishRename(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishRename(tab.id);
                    if (e.key === 'Escape') setEditingTabId(null);
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  className="px-1.5 py-0.5 text-xs bg-white dark:bg-slate-700 border border-blue-500 rounded text-slate-900 dark:text-white outline-hidden max-w-[140px]"
                />
              ) : (
                <span 
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(tab);
                  }}
                  className="truncate max-w-[180px] whitespace-nowrap text-xs select-none"
                  title={`${tab.name} (двойной клик — переименовать, перетаскивание — переместить)`}
                >
                  {tab.name}
                </span>
              )}

              {/* Rows count badge */}
              <span className={`text-[10px] tabular-nums px-1.5 py-0.2 rounded-full font-mono ${
                isActive 
                  ? 'bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 font-semibold' 
                  : 'bg-slate-200/80 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              }`}>
                {tab.rows.length}
              </span>

              {/* Tab options trigger button */}
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Опции вкладки ${tab.name}`}
                aria-haspopup="menu"
                aria-expanded={contextMenu?.tab.id === tab.id}
                onClick={(e) => handleOpenMenu(e, tab)}
                className={`p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-700 transition-colors ${
                  contextMenu?.tab.id === tab.id ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white opacity-100' : 'opacity-60 group-hover:opacity-100'
                }`}
                title="Опции вкладки (Shift+F10)"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}

          {/* Add tab button inside strip when in multi-row mode */}
          {!isSingleRow && (
            tabs.length < 20 ? (
              <button
                type="button"
                onClick={onAddTab}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500 bg-white/40 dark:bg-slate-800/40 hover:bg-white dark:hover:bg-slate-800 transition-colors text-xs font-medium shrink-0 cursor-pointer"
                title="Создать новую вкладку (максимум 20)"
              >
                <Plus className="w-3.5 h-3.5 text-blue-600" />
                <span>Новая вкладка</span>
              </button>
            ) : (
              <span className="text-[11px] text-amber-600 dark:text-amber-400 px-2 font-medium shrink-0">
                Лимит 20 вкладок
              </span>
            )
          )}
        </div>

        {/* Pinned Right Controls (always reachable on 1366x768 & 125%/150% DPI) */}
        <div className="flex items-center gap-1 px-2 py-1 border-l border-slate-300 dark:border-slate-700/80 shrink-0 bg-slate-200/70 dark:bg-slate-900">
          {isSingleRow && (
            tabs.length < 20 ? (
              <button
                type="button"
                onClick={onAddTab}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-slate-300 dark:border-slate-700 text-slate-700 hover:text-blue-600 dark:text-slate-300 dark:hover:text-blue-400 hover:border-blue-400 bg-white/60 dark:bg-slate-800/60 hover:bg-white dark:hover:bg-slate-800 transition-colors text-[11px] font-medium whitespace-nowrap cursor-pointer"
                title="Создать новую вкладку (максимум 20)"
              >
                <Plus className="w-3.5 h-3.5 text-blue-600" />
                <span>Новая</span>
              </button>
            ) : (
              <span className="text-[11px] text-amber-600 dark:text-amber-400 px-1.5 font-medium whitespace-nowrap">
                Лимит 20
              </span>
            )
          )}

          <button
            type="button"
            onClick={() => {
              if (isSingleRow) {
                setIsCustomMultiHeight(false);
                setMode('auto');
              } else {
                setIsCustomMultiHeight(false);
                setMode('single');
              }
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
              !isSingleRow
                ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-300/60 dark:hover:bg-slate-800'
            }`}
            title={
              isSingleRow
                ? 'Развернуть панель вкладок в несколько рядов (настройка сохраняется)'
                : 'Свернуть панель вкладок в 1 компактную строку (настройка сохраняется)'
            }
          >
            {isSingleRow ? (
              <>
                <Maximize2 className="w-3 h-3" />
                <span>Все ряды</span>
              </>
            ) : (
              <>
                <Minimize2 className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                <span>1 ряд</span>
              </>
            )}
          </button>

          {!isSingleRow && (
            <button
              type="button"
              onClick={() => {
                setTabBarHeight(84);
                setIsCustomMultiHeight((v) => !v);
              }}
              className={`px-1.5 py-1 rounded-md text-[10px] font-mono whitespace-nowrap cursor-pointer ${
                isCustomMultiHeight
                  ? 'bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-white font-bold'
                  : 'text-slate-500 hover:bg-slate-300/60 dark:hover:bg-slate-800'
              }`}
              title="Ограничить высоту до 2 рядов"
            >
              2 ряда
            </button>
          )}
        </div>
      </div>

      {/* Resize Drag-Handle (only in expanded multi-row mode) */}
      {!isSingleRow && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizing(true);
          }}
          className="w-full h-1.5 cursor-row-resize bg-slate-300/40 dark:bg-slate-800/80 hover:bg-blue-500 dark:hover:bg-blue-600 transition-colors flex items-center justify-center group relative z-10"
          title="Потяните вниз или вверх для ручной регулировки высоты поля вкладок"
        >
          <div className="w-10 h-0.5 rounded-full bg-slate-400 dark:bg-slate-600 group-hover:bg-white" />
        </div>
      )}

      {/* PORTAL: Tab Options Context Menu */}
      {contextMenu && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Действия для вкладки ${contextMenu.tab.name}`}
          onKeyDown={handleContextMenuKeyDown}
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className={`fixed ${Z_INDEX.popover} w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl py-1.5 text-xs text-slate-700 dark:text-slate-200 animate-in fade-in-50 zoom-in-95 duration-100 select-none ring-1 ring-black/5`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 mb-1 truncate">
            Вкладка: {contextMenu.tab.name}
          </div>

          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => startRename(contextMenu.tab)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 focus:text-blue-600 dark:focus:text-blue-400 focus:outline-hidden transition-colors text-left"
          >
            <Edit2 className="w-3.5 h-3.5 text-blue-500" />
            <span>Переименовать вкладку</span>
          </button>

          {onOpenColumnEditor && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                onSelectTab(contextMenu.tab.id);
                setContextMenu(null);
                onOpenColumnEditor();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 focus:bg-blue-50 dark:focus:bg-blue-950/40 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 focus:text-blue-600 dark:focus:text-blue-400 focus:outline-hidden transition-colors text-left"
            >
              <Columns className="w-3.5 h-3.5 text-slate-500" />
              <span>Настройка столбцов...</span>
            </button>
          )}

          {onConfigureMasterDeps && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                const tid = contextMenu.tab.id;
                setContextMenu(null);
                onConfigureMasterDeps(tid);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-amber-50 dark:hover:bg-amber-950/40 focus:bg-amber-50 dark:focus:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-medium focus:outline-hidden transition-colors text-left"
            >
              <Link2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>
                {contextMenu.tab.isMaster
                  ? 'Настроить зависимости мастера...'
                  : 'Назначить мастером и настроить связи...'}
              </span>
            </button>
          )}

          {contextMenu.tab.isMaster && onToggleMaster && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                onToggleMaster(contextMenu.tab.id);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 text-slate-600 dark:text-slate-400 focus:outline-hidden transition-colors text-left"
            >
              <Key className="w-3.5 h-3.5 text-slate-400" />
              <span>Снять статус мастер-таблицы</span>
            </button>
          )}

          <div role="separator" className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              const tabId = contextMenu.tab.id;
              setContextMenu(null);
              onDeleteTab(tabId);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 focus:bg-red-50 dark:focus:bg-red-950/40 focus:outline-hidden transition-colors text-left"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Удалить вкладку</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  );
};
