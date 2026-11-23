import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  applyPeriodicityPresetToDraft,
  createDeadlineConfigDraft,
  DeadlineConfigFields,
  validateAndBuildDeadlineConfig
} from '../DeadlineConfigFields';
import { ColumnEditorModal } from '../ColumnEditorModal';
import { Tab } from '../../types/database';

describe('T-47: DeadlineConfigFields and ColumnEditorModal', () => {
  it('detects presets vs manual mode and preserves legacy 365 days and non-standard warningValue', () => {
    const legacy365 = createDeadlineConfigDraft({
      periodicityValue: 365,
      periodicityUnit: 'days',
      warningValue: 14,
      warningDayType: 'calendar'
    });
    expect(legacy365.presetId).toBe('manual');
    expect(legacy365.periodicityValueInput).toBe('365');
    expect(legacy365.periodicityUnit).toBe('days');
    expect(legacy365.warningValue).toBe(14);
    expect(validateAndBuildDeadlineConfig(legacy365)).toEqual({
      ok: true,
      config: {
        periodicityValue: 365,
        periodicityUnit: 'days',
        warningValue: 14,
        warningDayType: 'calendar'
      }
    });

    // Non-standard warningValue (e.g. 10 days) is preserved verbatim without silent replacement
    const nonStandardWarn = createDeadlineConfigDraft({
      periodicityValue: 6,
      periodicityUnit: 'months',
      warningValue: 10,
      warningDayType: 'working'
    });
    expect(nonStandardWarn.presetId).toBe('6m');
    expect(nonStandardWarn.warningValue).toBe(10);
    expect(validateAndBuildDeadlineConfig(nonStandardWarn)).toEqual({
      ok: true,
      config: {
        periodicityValue: 6,
        periodicityUnit: 'months',
        warningValue: 10,
        warningDayType: 'working'
      }
    });

    const markupNonStandard = renderToStaticMarkup(
      React.createElement(DeadlineConfigFields, {
        draft: nonStandardWarn,
        onChange: vi.fn()
      })
    );
    expect(markupNonStandard).toContain('Нестандартное (за 10 дн.)');
    // Preset selected -> manual inputs must NOT be rendered
    expect(markupNonStandard).not.toContain('Числовое значение периодичности');
  });

  it('toggles manual inputs visibility and rejects invalid manual periodicity values', () => {
    const preset3y = applyPeriodicityPresetToDraft(createDeadlineConfigDraft(), '3y');
    expect(preset3y.presetId).toBe('3y');
    expect(validateAndBuildDeadlineConfig(preset3y)).toEqual({
      ok: true,
      config: {
        periodicityValue: 3,
        periodicityUnit: 'years',
        warningValue: 14,
        warningDayType: 'calendar'
      }
    });

    const presetHtml = renderToStaticMarkup(
      React.createElement(DeadlineConfigFields, {
        draft: preset3y,
        onChange: vi.fn()
      })
    );
    expect(presetHtml).toContain('1 раз в 3 года');
    expect(presetHtml).not.toContain('Числовое значение периодичности');

    const manualDraft = applyPeriodicityPresetToDraft(preset3y, 'manual');
    const manualHtml = renderToStaticMarkup(
      React.createElement(DeadlineConfigFields, {
        draft: manualDraft,
        onChange: vi.fn()
      })
    );
    expect(manualHtml).toContain('Числовое значение периодичности');
    expect(manualHtml).toContain('Единица периодичности');

    const invalidNegative = validateAndBuildDeadlineConfig({
      ...manualDraft,
      periodicityValueInput: '-5'
    });
    expect(invalidNegative.ok).toBe(false);

    const invalidFloat = validateAndBuildDeadlineConfig({
      ...manualDraft,
      periodicityValueInput: '1.5'
    });
    expect(invalidFloat.ok).toBe(false);

    const validZero = validateAndBuildDeadlineConfig({
      ...manualDraft,
      periodicityValueInput: '0'
    });
    expect(validZero).toEqual({
      ok: true,
      config: {
        periodicityValue: 0,
        periodicityUnit: 'years',
        warningValue: 14,
        warningDayType: 'calendar'
      }
    });
  });

  it('renders ColumnEditorModal with deadline_control option, settings button, and relation type lock', () => {
    const tab: Tab = {
      id: 'tab_med',
      name: 'Медосмотры',
      columns: [
        { id: 'c_fio', name: 'ФИО', type: 'text', width: 200 },
        {
          id: 'c_pos',
          name: 'Должность',
          type: 'relation',
          relation: { masterTabId: 'tab_staff', masterColumnId: 'pos' },
          width: 180
        },
        {
          id: 'c_dl',
          name: 'Периодичность МО',
          type: 'deadline_control',
          deadlineConfig: {
            periodicityValue: 6,
            periodicityUnit: 'months',
            warningValue: 180,
            warningDayType: 'working'
          },
          width: 210
        }
      ],
      rows: [{ id: 'r1', c_fio: 'Иванов', c_pos: 'Инженер', c_dl: { actualDate: '2026-01-10' } }],
      attachedDocs: []
    };

    const html = renderToStaticMarkup(
      React.createElement(ColumnEditorModal, {
        isOpen: true,
        onClose: vi.fn(),
        currentTab: tab,
        allTabs: [tab],
        tags: [],
        holidays: [],
        onUpdateColumns: vi.fn()
      })
    );

    expect(html).toContain('value="deadline_control"');
    expect(html).toContain('1 раз в полгода · предупр. за 180 раб. дн.');
    expect(html).toContain('Настроить');
    expect(html).toContain('Изменить тип');
    expect(html).toContain('Смена типа столбца со связью (relation) заблокирована');
  });
});
