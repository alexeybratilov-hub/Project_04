import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, RotateCcw, X } from 'lucide-react';
import { Column, DeadlineCellValue } from '../types/database';
import {
  DeadlineStatus,
  evaluateDeadlineCell,
  formatIsoToDisplay,
  getTodayIso,
  markDeadlineCompletedToday,
  normalizeDeadlineCellValue,
  normalizeDeadlineColumnConfig,
  updateDeadlineCellValue
} from '../services/deadlineService';
import { AppButton, Z_INDEX } from './ui';

export interface DeadlineAnchorRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

export interface DeadlineDraftState {
  actualDate: string;
  manualNextDate: string;
  note: string;
  rawOriginal: string;
  manualWasAutoReset: boolean;
}

export function createDeadlineDraftState(rawValue: unknown): DeadlineDraftState {
  const norm = normalizeDeadlineCellValue(rawValue);
  return {
    actualDate: norm.actualDate || '',
    manualNextDate: norm.manualNextDate || '',
    note: norm.note || '',
    rawOriginal: norm._rawOriginal || '',
    manualWasAutoReset: false
  };
}

export function applyDraftActualDateChange(
  draft: DeadlineDraftState,
  nextActualDate: string
): DeadlineDraftState {
  const normalizedInput = nextActualDate.trim();
  const changed = normalizedInput !== draft.actualDate;
  const hadManual = Boolean(draft.manualNextDate);
  return {
    ...draft,
    actualDate: normalizedInput,
    manualNextDate: changed ? '' : draft.manualNextDate,
    manualWasAutoReset: (changed && hadManual) || (draft.manualWasAutoReset && !changed)
  };
}

export function applyDraftCompletedToday(
  prevRaw: unknown,
  draft: DeadlineDraftState,
  todayIso: string = getTodayIso()
): DeadlineDraftState {
  const completedVal = markDeadlineCompletedToday(prevRaw, todayIso);
  const hadManual = Boolean(draft.manualNextDate);
  return {
    ...draft,
    actualDate: completedVal.actualDate || todayIso,
    manualNextDate: '',
    manualWasAutoReset: hadManual
  };
}

export function commitDeadlineDraft(
  prevRaw: unknown,
  draft: DeadlineDraftState
): DeadlineCellValue {
  return updateDeadlineCellValue(prevRaw, {
    actualDate: draft.actualDate ? draft.actualDate : null,
    manualNextDate: draft.manualNextDate ? draft.manualNextDate : null,
    note: draft.note.trim() ? draft.note.trim() : null,
    _rawOriginal: draft.rawOriginal.trim() ? draft.rawOriginal.trim() : null
  });
}

export function formatDeadlinePeriodicitySummary(column: Column): string {
  const cfg = normalizeDeadlineColumnConfig(column.deadlineConfig);
  const warningUnitLabel = cfg.warningDayType === 'working' ? 'раб. дн.' : 'кал. дн.';
  if (cfg.periodicityValue === 0) {
    return `Разовое мероприятие · предупр. за ${cfg.warningValue} ${warningUnitLabel}`;
  }
  const unitLabel =
    cfg.periodicityUnit === 'days'
      ? 'дн.'
      : cfg.periodicityUnit === 'years'
        ? 'г./лет'
        : 'мес.';
  return `Раз в ${cfg.periodicityValue} ${unitLabel} · предупр. за ${cfg.warningValue} ${warningUnitLabel}`;
}

export function getDeadlineStatusToneClasses(status: DeadlineStatus): string {
  switch (status) {
    case 'overdue':
      return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800/80';
    case 'due_soon':
      return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/80';
    case 'scheduled':
      return 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/80';
    case 'completed':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800/80';
    case 'missing_data':
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  }
}

function formatDaysHint(daysRemaining: number | undefined, dayType: 'calendar' | 'working'): string {
  if (daysRemaining === undefined) return '';
  const unit = dayType === 'working' ? 'раб. дн.' : 'дн.';
  if (daysRemaining === 0) return 'срок сегодня';
  if (daysRemaining > 0) return `осталось ${daysRemaining} ${unit}`;
  return `просрочено на ${Math.abs(daysRemaining)} ${unit}`;
}

interface DeadlineCellPopoverProps {
  column: Column;
  initialValue: unknown;
  anchorRect: DeadlineAnchorRect | null;
  holidays?: string[];
  onSave: (nextValue: DeadlineCellValue, options?: { restoreFocus?: boolean }) => void;
  onCancel: (options?: { restoreFocus?: boolean }) => void;
}

export const DeadlineCellPopover: React.FC<DeadlineCellPopoverProps> = ({
  column,
  initialValue,
  anchorRect,
  holidays,
  onSave,
  onCancel
}) => {
  const [draft, setDraft] = useState<DeadlineDraftState>(() =>
    createDeadlineDraftState(initialValue)
  );
  const popoverRef = useRef<HTMLDivElement>(null);
  const actualInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(createDeadlineDraftState(initialValue));
  }, [initialValue, column.id]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      actualInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Close on Escape or outside click without saving
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel({ restoreFocus: true });
      }
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onCancel({ restoreFocus: false });
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handleMouseDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [onCancel]);

  const previewVal = useMemo(
    () => commitDeadlineDraft(initialValue, draft),
    [initialValue, draft]
  );

  const previewEval = useMemo(
    () =>
      evaluateDeadlineCell(previewVal, column.deadlineConfig, {
        holidays
      }),
    [previewVal, column.deadlineConfig, holidays]
  );

  const periodicitySummary = useMemo(
    () => formatDeadlinePeriodicitySummary(column),
    [column]
  );

  const positionStyle = useMemo<React.CSSProperties>(() => {
    if (typeof window === 'undefined' || !anchorRect) {
      return { top: 96, left: 96 };
    }
    const popWidth = Math.min(352, Math.max(280, window.innerWidth - 16));
    const estimatedHeight = 400;
    const margin = 8;

    let left = anchorRect.left;
    if (left + popWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - popWidth - margin);
    }
    if (left < margin) left = margin;

    let top = anchorRect.bottom + 4;
    if (top + estimatedHeight > window.innerHeight - margin) {
      const aboveTop = anchorRect.top - estimatedHeight - 4;
      top = aboveTop >= margin ? aboveTop : Math.max(margin, window.innerHeight - estimatedHeight - margin);
    }

    return { top, left, width: popWidth };
  }, [anchorRect]);

  const handleSave = () => {
    onSave(previewVal, { restoreFocus: true });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleSave();
    }
  };

  const hasAnyDraft = Boolean(
    draft.actualDate || draft.manualNextDate || draft.note.trim() || draft.rawOriginal.trim()
  );

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Редактирование срока: ${column.name}`}
      style={positionStyle}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`fixed ${Z_INDEX.popover} bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl ring-1 ring-black/10 dark:ring-white/10 text-xs text-slate-800 dark:text-slate-100 overflow-hidden`}
    >
      {/* Header */}
      <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700/80 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white truncate">
            <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="truncate" title={column.name}>
              {column.name}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {periodicitySummary}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onCancel({ restoreFocus: true })}
          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700/70 transition-colors cursor-pointer shrink-0"
          title="Закрыть без сохранения (Esc)"
          aria-label="Закрыть"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="p-3.5 space-y-3">
        {draft.rawOriginal && (
          <div className="flex items-start justify-between gap-2 px-2.5 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 text-[11px] text-amber-900 dark:text-amber-200">
            <div className="flex items-start gap-1.5 min-w-0">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="min-w-0 break-words">
                <span className="font-medium">Исходное значение:</span> «{draft.rawOriginal}»
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDraft((prev) => ({ ...prev, rawOriginal: '' }))}
              className="text-[10px] text-amber-700 dark:text-amber-300 hover:underline shrink-0 cursor-pointer"
              title="Убрать сохранённый нераспознанный текст"
            >
              Очистить
            </button>
          </div>
        )}

        {/* Actual date + Complete Today */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="deadline-actual-date-input"
              className="text-[11px] font-medium text-slate-700 dark:text-slate-300"
            >
              Фактическая дата выполнения
            </label>
            <button
              type="button"
              onClick={() =>
                setDraft((prev) => applyDraftCompletedToday(initialValue, prev))
              }
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-medium transition-colors cursor-pointer"
              title="Поставить сегодняшнюю дату и пересчитать следующий срок"
            >
              <CheckCircle2 className="w-3 h-3 shrink-0" />
              <span>Выполнено сегодня</span>
            </button>
          </div>
          <input
            id="deadline-actual-date-input"
            ref={actualInputRef}
            type="date"
            value={draft.actualDate}
            onChange={(e) =>
              setDraft((prev) => applyDraftActualDateChange(prev, e.target.value))
            }
            onKeyDown={handleInputKeyDown}
            className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-xs font-mono tabular-nums text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Manual Next Date */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="deadline-manual-next-input"
              className="text-[11px] font-medium text-slate-700 dark:text-slate-300"
            >
              Плановая следующая дата <span className="text-slate-400 font-normal">(вручную)</span>
            </label>
            {draft.manualNextDate && (
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    manualNextDate: '',
                    manualWasAutoReset: false
                  }))
                }
                className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                title="Очистить ручную дату и вернуться к автоматическому расчёту"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Сбросить на авторасчёт</span>
              </button>
            )}
          </div>
          <input
            id="deadline-manual-next-input"
            type="date"
            value={draft.manualNextDate}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                manualNextDate: e.target.value,
                manualWasAutoReset: false
              }))
            }
            onKeyDown={handleInputKeyDown}
            className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-xs font-mono tabular-nums text-slate-900 dark:text-white focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          {draft.manualWasAutoReset && !draft.manualNextDate && (
            <p className="text-[10.5px] text-blue-600 dark:text-blue-400">
              Прежняя ручная дата сброшена для пересчёта от новой фактической даты.
            </p>
          )}
        </div>

        {/* Optional Note */}
        <div className="space-y-1">
          <label
            htmlFor="deadline-note-input"
            className="text-[11px] font-medium text-slate-700 dark:text-slate-300 block"
          >
            Примечание <span className="text-slate-400 font-normal">(необязательно)</span>
          </label>
          <input
            id="deadline-note-input"
            type="text"
            placeholder="Номер протокола, удостоверения или комментарий..."
            value={draft.note}
            onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))}
            onKeyDown={handleInputKeyDown}
            className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Live Calculation Preview */}
        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">Последнее выполнение:</span>
            <span className="font-medium font-mono tabular-nums text-slate-800 dark:text-slate-200">
              {previewEval.actualDate
                ? `Выполнено ${formatIsoToDisplay(previewEval.actualDate)}`
                : 'Не проводилось'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">Следующий срок:</span>
            <span className="font-medium font-mono tabular-nums text-slate-900 dark:text-white">
              {previewEval.effectiveNextDate ? (
                <>
                  {formatIsoToDisplay(previewEval.effectiveNextDate)}{' '}
                  <span className="text-[10px] font-sans text-slate-500 dark:text-slate-400">
                    ({previewEval.nextDateSource === 'manual' ? 'вручную' : 'авто'})
                  </span>
                </>
              ) : previewEval.status === 'completed' ? (
                'Не требуется (разовое)'
              ) : (
                'Не задан'
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-slate-500 dark:text-slate-400">Текущий статус:</span>
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10.5px] font-semibold ${getDeadlineStatusToneClasses(
                  previewEval.status
                )}`}
              >
                {previewEval.statusLabel}
              </span>
              {previewEval.effectiveNextDate && (
                <span className="text-[10.5px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  ({formatDaysHint(previewEval.daysRemaining, previewEval.config.warningDayType)})
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700/80 flex items-center justify-between gap-2">
        <div>
          {hasAnyDraft && (
            <button
              type="button"
              onClick={() =>
                setDraft({
                  actualDate: '',
                  manualNextDate: '',
                  note: '',
                  rawOriginal: '',
                  manualWasAutoReset: false
                })
              }
              className="text-[11px] text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 cursor-pointer"
            >
              Очистить всё
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <AppButton
            variant="secondary"
            size="xs"
            onClick={() => onCancel({ restoreFocus: true })}
          >
            Отмена
          </AppButton>
          <AppButton variant="primary" size="xs" onClick={handleSave}>
            Сохранить
          </AppButton>
        </div>
      </div>
    </div>
  );
};
