import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Plus, Key, MoreVertical, Edit2, Trash2, 
  Columns, Maximize2, Minimize2, Link2, GripVertical
} from 'lucide-react';
import { Tab, TabBarMode } from '../types/database';
import { Z_INDEX } from './ui';

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

  // Drag & Drop reordering state
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

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
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  const handleOpenMenu = (e: React.MouseEvent, tab: Tab) => {
    e.stopPropagation();
    const btnRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(window.innerWidth - 240, Math.max(8, btnRect.left));
    const y = Math.min(window.innerHeight - 230, btnRect.bottom + 4);
    setContextMenu({ tab, x, y });
  };

  // Drag handlers for tab reordering
  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    if (editingTabId === tabId) {
      e.preventDefault();
      return;
    }
    setDraggedTabId(tabId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
  };

  const handleDragOver = (e: React.DragEvent, targetTabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedTabId && draggedTabId !== targetTabId) {
      setDragOverTabId(targetTabId);
    }
  };

  const handleDrop = (e: React.DragEvent, targetTabId: string) => {
    e.preventDefault();
    const sourceId = draggedTabId || e.dataTransfer.getData('text/plain');
    if (sourceId && sourceId !== targetTabId && onReorderTabs) {
      const fromIdx = tabs.findIndex((t) => t.id === sourceId);
      const toIdx = tabs.findIndex((t) => t.id === targetTabId);
      if (fromIdx !== -1 && toIdx !== -1) {
        onReorderTabs(fromIdx, toIdx);
      }
    }
    setDraggedTabId(null);
    setDragOverTabId(null);
  };

  const handleDragEnd = () => {
    setDraggedTabId(null);
    setDragOverTabId(null);
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
          className={`flex-1 min-w-0 px-2 py-1 flex items-center gap-1.5 ${
            isSingleRow
              ? 'flex-nowrap overflow-x-auto no-scrollbar'
              : 'flex-wrap overflow-x-hidden overflow-y-auto content-start max-h-full'
          }`}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const isMaster = tab.isMaster;
            const isDragging = draggedTabId === tab.id;
            const isDropTarget = dragOverTabId === tab.id;

            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                draggable={editingTabId !== tab.id}
                onDragStart={(e) => handleDragStart(e, tab.id)}
                onDragOver={(e) => handleDragOver(e, tab.id)}
                onDragLeave={() => {
                  if (dragOverTabId === tab.id) setDragOverTabId(null);
                }}
                onDrop={(e) => handleDrop(e, tab.id)}
                onDragEnd={handleDragEnd}
                className={`group relative flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer border shrink-0 ${
                  isActive
                    ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 border-blue-400/70 dark:border-blue-600/80 shadow-xs font-semibold ring-1 ring-blue-500/20'
                    : 'bg-white/60 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 border-slate-300/80 dark:border-slate-700/80 hover:border-slate-400'
                } ${isDragging ? 'opacity-40 scale-95' : ''} ${
                  isDropTarget ? 'ring-2 ring-blue-600 border-blue-600 bg-blue-50 dark:bg-blue-950/60' : ''
                }`}
                onClick={() => onSelectTab(tab.id)}
                title="Перетащите мышкой для изменения порядка вкладок"
              >
                <GripVertical className="w-3 h-3 text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 -ml-1 shrink-0 cursor-grab" />

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
                onClick={(e) => handleOpenMenu(e, tab)}
                className={`p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-700 transition-colors ${
                  contextMenu?.tab.id === tab.id ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white opacity-100' : 'opacity-60 group-hover:opacity-100'
                }`}
                title="Опции вкладки"
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
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className={`fixed ${Z_INDEX.popover} w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl py-1.5 text-xs text-slate-700 dark:text-slate-200 animate-in fade-in-50 zoom-in-95 duration-100 select-none ring-1 ring-black/5`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 mb-1 truncate">
            Вкладка: {contextMenu.tab.name}
          </div>

          <button
            type="button"
            onClick={() => startRename(contextMenu.tab)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left"
          >
            <Edit2 className="w-3.5 h-3.5 text-blue-500" />
            <span>Переименовать вкладку</span>
          </button>

          {onOpenColumnEditor && (
            <button
              type="button"
              onClick={() => {
                onSelectTab(contextMenu.tab.id);
                setContextMenu(null);
                onOpenColumnEditor();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left"
            >
              <Columns className="w-3.5 h-3.5 text-slate-500" />
              <span>Настройка столбцов...</span>
            </button>
          )}

          {onConfigureMasterDeps && (
            <button
              type="button"
              onClick={() => {
                const tid = contextMenu.tab.id;
                setContextMenu(null);
                onConfigureMasterDeps(tid);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-medium transition-colors text-left"
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
              onClick={() => {
                onToggleMaster(contextMenu.tab.id);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors text-left"
            >
              <Key className="w-3.5 h-3.5 text-slate-400" />
              <span>Снять статус мастер-таблицы</span>
            </button>
          )}

          <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

          <button
            type="button"
            onClick={() => {
              const tabId = contextMenu.tab.id;
              setContextMenu(null);
              onDeleteTab(tabId);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors text-left"
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
