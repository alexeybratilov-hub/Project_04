import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Columns3, Rows3 } from 'lucide-react';
import { Column, Row } from '../types/database';

interface TabPreviewPopoverProps {
  anchorRect: DOMRect;
  title: string;
  moduleLabel?: string;
  columns: Column[];
  rows: Row[];
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpen: () => void;
}

const WIDTH = 320;
const ESTIMATED_HEIGHT = 236;

/**
 * Превью вкладки при наведении: реальные данные таблицы, без «демо»-цифр.
 * Позиционируется порталом с прижиманием к границам окна.
 */
export const TabPreviewPopover: React.FC<TabPreviewPopoverProps> = ({
  anchorRect,
  title,
  moduleLabel,
  columns,
  rows,
  onMouseEnter,
  onMouseLeave,
  onOpen
}) => {
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;

  const left = Math.max(8, Math.min(anchorRect.left, viewportWidth - WIDTH - 8));
  const fitsBelow = anchorRect.bottom + ESTIMATED_HEIGHT + 8 <= viewportHeight;
  const top = fitsBelow
    ? anchorRect.bottom + 6
    : Math.max(8, anchorRect.top - ESTIMATED_HEIGHT - 6);

  const nameColumn = columns.find((column) => column.type === 'text') || columns[0];
  const sampleRows = rows
    .slice(0, 3)
    .map((row) =>
      nameColumn ? String(row[nameColumn.id] ?? '').trim() : ''
    )
    .filter(Boolean);

  return createPortal(
    <div
      role="dialog"
      aria-label={`Предпросмотр вкладки «${title}»`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ left, top, width: WIDTH, zIndex: 75 }}
      className="fixed lg-card p-3 text-slate-700 dark:text-slate-200 animate-in fade-in zoom-in-95 duration-100"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold text-slate-900 dark:text-slate-50">
            {title}
          </div>
          <div className="truncate text-[10.5px] text-slate-500 dark:text-slate-400">
            {moduleLabel || 'Пользовательская таблица'}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-white/70 hover:text-slate-700 dark:hover:bg-slate-800/70 dark:hover:text-slate-200"
          title="Открыть вкладку"
          aria-label="Открыть вкладку"
        >
          <ArrowUpRight className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-3 text-[10.5px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1">
          <Rows3 className="w-3.5 h-3.5" />
          <span className="tabular-nums">{rows.length}</span> записей
        </span>
        <span className="inline-flex items-center gap-1">
          <Columns3 className="w-3.5 h-3.5" />
          <span className="tabular-nums">{columns.length}</span> столбцов
        </span>
      </div>

      {sampleRows.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-slate-200/70 dark:border-slate-700/50 pt-2">
          {sampleRows.map((value, index) => (
            <li
              key={`${value}-${index}`}
              className="truncate text-[11px] text-slate-600 dark:text-slate-300"
            >
              {value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 border-t border-slate-200/70 dark:border-slate-700/50 pt-2 text-[11px] text-slate-500 dark:text-slate-400">
          В таблице пока нет записей
        </p>
      )}

      <div className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
        Нажмите, чтобы открыть · Esc — закрыть
      </div>
    </div>,
    document.body
  );
};
