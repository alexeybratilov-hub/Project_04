import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Plus, Key, MoreVertical, Edit2, Trash2, 
  Columns, Maximize2, Minimize2, Link2, GripVertical
} from 'lucide-react';
import { Tab } from '../types/database';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
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

  // Height modes: 'auto' (all rows visible), or numeric height in px
  const [isAutoHeight, setIsAutoHeight] = useState<boolean>(() => {
    const saved = localStorage.getItem('ot_tabbar_auto');
    return saved !== null ? saved === 'true' : true;
  });

  const [tabBarHeight, setTabBarHeight] = useState<number>(() => {
    const saved = localStorage.getItem('ot_tabbar_height');
    return saved ? parseInt(saved, 10) : 84;
  });

  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('ot_tabbar_auto', String(isAutoHeight));
  }, [isAutoHeight]);

  useEffect(() => {
    localStorage.setItem('ot_tabbar_height', String(tabBarHeight));
  }, [tabBarHeight]);

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
      const newHeight = Math.max(38, Math.min(320, e.clientY - rect.top));
      setTabBarHeight(newHeight);
      setIsAutoHeight(false);
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
      style={{
        height: isAutoHeight ? 'auto' : `${tabBarHeight}px`,
        maxHeight: isAutoHeight ? '300px' : undefined
      }}
    >
      {/* Tabs and Controls Container: Wrapped, NO horizontal scroll, draggable tabs */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto p-1.5 flex flex-wrap items-center gap-1.5 content-start">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isMaster = tab.isMaster;
          const isDragging = draggedTabId === tab.id;
          const isDropTarget = dragOverTabId === tab.id;

          return (
            <div
              key={tab.id}
              draggable={editingTabId !== tab.id}
              onDragStart={(e) => handleDragStart(e, tab.id)}
              onDragOver={(e) => handleDragOver(e, tab.id)}
              onDragLeave={() => {
                if (dragOverTabId === tab.id) setDragOverTabId(null);
              }}
              onDrop={(e) => handleDrop(e, tab.id)}
              onDragEnd={handleDragEnd}
              className={`group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer border ${
                isActive
                  ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 border-blue-400/70 dark:border-blue-600/80 shadow-xs font-semibold ring-1 ring-blue-500/20'
                  : 'bg-white/60 dark:bg-slate-850/70 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 border-slate-300/80 dark:border-slate-700/80 hover:border-slate-400'
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

        {/* Add tab button */}
        {tabs.length < 20 ? (
          <button
            type="button"
            onClick={onAddTab}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500 bg-white/40 dark:bg-slate-850/40 hover:bg-white dark:hover:bg-slate-800 transition-colors text-xs font-medium"
            title="Создать новую вкладку (максимум 20)"
          >
            <Plus className="w-3.5 h-3.5 text-blue-600" />
            <span>Новая вкладка</span>
          </button>
        ) : (
          <span className="text-[11px] text-amber-600 dark:text-amber-400 px-2 font-medium">
            Лимит 20 вкладок
          </span>
        )}

        {/* Height Adjuster Controls */}
        <div className="ml-auto flex items-center gap-1 pl-2 border-l border-slate-300 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setIsAutoHeight(!isAutoHeight)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
              isAutoHeight
                ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-300/60 dark:hover:bg-slate-800'
            }`}
            title={isAutoHeight ? 'Включен автоподбор: видны все ряды вкладок сразу' : 'Компактная высота с прокруткой'}
          >
            {isAutoHeight ? (
              <>
                <Minimize2 className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                <span className="hidden sm:inline">Все ряды</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3 h-3" />
                <span className="hidden sm:inline">Развернуть ряды</span>
              </>
            )}
          </button>

          {!isAutoHeight && (
            <div className="flex items-center gap-0.5 text-[10px] text-slate-500 font-mono">
              <button
                type="button"
                onClick={() => setTabBarHeight(42)}
                className={`px-1.5 py-0.5 rounded ${tabBarHeight <= 48 ? 'bg-slate-300 dark:bg-slate-700 font-bold' : 'hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                title="Высота 1 ряд"
              >
                1 ряд
              </button>
              <button
                type="button"
                onClick={() => setTabBarHeight(84)}
                className={`px-1.5 py-0.5 rounded ${tabBarHeight > 48 && tabBarHeight <= 100 ? 'bg-slate-300 dark:bg-slate-700 font-bold' : 'hover:bg-slate-200 dark:hover:bg-slate-800'}`}
                title="Высота 2 ряда"
              >
                2 ряда
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Resize Drag-Handle */}
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

      {/* PORTAL: Tab Options Context Menu */}
      {contextMenu && createPortal(
        <div
          ref={menuRef}
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-[9999] w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl py-1.5 text-xs text-slate-700 dark:text-slate-200 animate-in fade-in-50 zoom-in-95 duration-100 select-none ring-1 ring-black/5"
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
