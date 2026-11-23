import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Column } from '../../types/database';
import {
  clampColumnWidth,
  compareGridCellValues,
  createQuickAddColumn,
  DEFAULT_COLUMN_WIDTH,
  getCellSearchableText,
  getDeadlineCellDisplayModel,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  NARROW_HEADER_BREAKPOINT,
} from '../DataGrid';
import {
  applyDraftActualDateChange,
  applyDraftCompletedToday,
  commitDeadlineDraft,
  createDeadlineDraftState,
  DeadlineCellPopover
} from '../DeadlineCellPopover';
import { DEFAULT_DEADLINE_COLUMN_CONFIG } from '../../services/deadlineService';

describe('DataGrid column header width invariants (T-38)', () => {
  it('uses expected sizing constants for narrow headers and clamping', () => {
    expect(MIN_COLUMN_WIDTH).toBe(88);
    expect(MAX_COLUMN_WIDTH).toBe(800);
    expect(DEFAULT_COLUMN_WIDTH).toBe(180);
    expect(NARROW_HEADER_BREAKPOINT).toBeGreaterThan(MIN_COLUMN_WIDTH);
    expect(NARROW_HEADER_BREAKPOINT).toBe(120);
  });

  it('clamps below minimum and above maximum column widths', () => {
    expect(clampColumnWidth(0)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(-40)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(60)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(88)).toBe(88);
    expect(clampColumnWidth(800)).toBe(800);
    expect(clampColumnWidth(1200)).toBe(MAX_COLUMN_WIDTH);
  });

  it('falls back to DEFAULT_COLUMN_WIDTH for undefined or non-finite values and rounds floats', () => {
    expect(clampColumnWidth(undefined)).toBe(DEFAULT_COLUMN_WIDTH);
    expect(clampColumnWidth(Number.NaN)).toBe(DEFAULT_COLUMN_WIDTH);
    expect(clampColumnWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_COLUMN_WIDTH);
    expect(clampColumnWidth(145.6)).toBe(146);
    expect(clampColumnWidth(145.2)).toBe(145);
  });
});

describe('DataGrid & DeadlineCellPopover integration (T-46)', () => {
  const periodicCol: Column = {
    id: 'c_med',
    name: 'Медосмотр',
    type: 'deadline_control',
    width: 210,
    deadlineConfig: {
      periodicityValue: 12,
      periodicityUnit: 'months',
      warningValue: 14,
      warningDayType: 'calendar'
    }
  };

  it('creates quick-add deadline_control column with default deadlineConfig', () => {
    const col = createQuickAddColumn('Обучение ОТ', 'deadline_control', 'col_test');
    expect(col.type).toBe('deadline_control');
    expect(col.deadlineConfig).toEqual(DEFAULT_DEADLINE_COLUMN_CONFIG);
  });

  it('formats display model across auto, manual, one-time completed, empty, and _rawOriginal states', () => {
    const autoModel = getDeadlineCellDisplayModel(
      { actualDate: '2025-05-01' },
      periodicCol,
      { todayIso: '2026-04-10' }
    );
    expect(autoModel.primaryText).toBe('01.05.2026');
    expect(autoModel.secondaryText).toBe('Факт: 01.05.2025');
    expect(autoModel.badgeLabel).toBe('Запланировано');
    expect(autoModel.isManual).toBe(false);

    const manualModel = getDeadlineCellDisplayModel(
      { actualDate: '2025-05-01', manualNextDate: '2026-04-20' },
      periodicCol,
      { todayIso: '2026-04-10' }
    );
    expect(manualModel.primaryText).toBe('20.04.2026');
    expect(manualModel.badgeLabel).toBe('Скоро');
    expect(manualModel.isManual).toBe(true);

    const emptyModel = getDeadlineCellDisplayModel({}, periodicCol, { todayIso: '2026-04-10' });
    expect(emptyModel.primaryText).toBe('Не задан');
    expect(emptyModel.badgeLabel).toBe('Данные отсутствуют');
    expect(emptyModel.isEmpty).toBe(true);

    const rawModel = getDeadlineCellDisplayModel(
      { _rawOriginal: 'май 2026 ориентир' },
      periodicCol,
      { todayIso: '2026-04-10' }
    );
    expect(rawModel.primaryText).toBe('май 2026 ориентир');
    expect(rawModel.hasRawOriginal).toBe(true);
    expect(rawModel.secondaryText).toBe('Требует уточнения');
  });

  it('supports search by formatted dates, status, and note and sorts by effectiveNextDate with empty at bottom', () => {
    const searchStr = getCellSearchableText(
      { actualDate: '2025-05-01', manualNextDate: '2026-04-12', note: 'Приказ №12' },
      periodicCol,
      { todayIso: '2026-04-10' }
    );
    expect(searchStr).toContain('12.04.2026');
    expect(searchStr).toContain('01.05.2025');
    expect(searchStr).toContain('скоро');
    expect(searchStr).toContain('приказ №12');
    expect(searchStr).not.toContain('[object object]');

    const rows = [
      {},
      { actualDate: '2025-06-01' }, // next 2026-06-01
      { actualDate: '2025-02-01' }  // next 2026-02-01
    ];
    const asc = [...rows].sort((a, b) => compareGridCellValues(a, b, periodicCol, 'asc'));
    expect(asc.map((r: any) => r.actualDate || null)).toEqual([
      '2025-02-01',
      '2025-06-01',
      null
    ]);
    const desc = [...rows].sort((a, b) => compareGridCellValues(a, b, periodicCol, 'desc'));
    expect(desc.map((r: any) => r.actualDate || null)).toEqual([
      '2025-06-01',
      '2025-02-01',
      null
    ]);
  });

  it('popover draft resets stale manualNextDate on actualDate change / complete-today, and allows setting manualNextDate explicitly', () => {
    const initial = { actualDate: '2025-01-15', manualNextDate: '2026-03-01', note: 'Справка' };
    const draft0 = createDeadlineDraftState(initial);
    expect(draft0.actualDate).toBe('2025-01-15');
    expect(draft0.manualNextDate).toBe('2026-03-01');

    // 1. Changing actualDate automatically clears stale manualNextDate
    const draft1 = applyDraftActualDateChange(draft0, '2026-04-05');
    expect(draft1.actualDate).toBe('2026-04-05');
    expect(draft1.manualNextDate).toBe('');
    expect(draft1.manualWasAutoReset).toBe(true);
    expect(commitDeadlineDraft(initial, draft1)).toEqual({
      actualDate: '2026-04-05',
      note: 'Справка'
    });

    // 2. Complete today sets todayIso and clears manualNextDate
    const draftToday = applyDraftCompletedToday(initial, draft0, '2026-04-10');
    expect(draftToday.actualDate).toBe('2026-04-10');
    expect(draftToday.manualNextDate).toBe('');
    expect(commitDeadlineDraft(initial, draftToday)).toEqual({
      actualDate: '2026-04-10',
      note: 'Справка'
    });

    // 3. Explicit manualNextDate override set in same edit session is saved cleanly
    const draftManual = { ...draft1, manualNextDate: '2026-10-15' };
    expect(commitDeadlineDraft(initial, draftManual)).toEqual({
      actualDate: '2026-04-05',
      manualNextDate: '2026-10-15',
      note: 'Справка'
    });
  });

  it('renders DeadlineCellPopover markup cleanly with Russian labels and zero [object Object]', () => {
    const html = renderToStaticMarkup(
      React.createElement(DeadlineCellPopover, {
        column: periodicCol,
        initialValue: { actualDate: '2025-05-01', manualNextDate: '2026-04-20', note: 'Медцентр' },
        anchorRect: { top: 100, left: 100, bottom: 130, right: 310, width: 210, height: 30 },
        onSave: () => undefined,
        onCancel: () => undefined
      })
    );
    expect(html).toContain('Медосмотр');
    expect(html).toContain('Выполнено сегодня');
    expect(html).toContain('Фактическая дата выполнения');
    expect(html).toContain('Плановая следующая дата');
    expect(html).toContain('Сбросить на авторасчёт');
    expect(html).toContain('2025-05-01');
    expect(html).toContain('2026-04-20');
    expect(html).not.toContain('[object Object]');
  });
});
