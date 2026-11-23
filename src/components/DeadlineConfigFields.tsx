import React from 'react';
import { Clock } from 'lucide-react';
import {
  DeadlineColumnConfig,
  DeadlinePeriodicityUnit,
  DeadlineWarningDayType
} from '../types/database';
import {
  DEADLINE_PERIODICITY_PRESETS,
  DEADLINE_WARNING_PRESETS,
  DeadlinePeriodicityPresetId,
  DEFAULT_DEADLINE_COLUMN_CONFIG,
  detectPeriodicityPreset,
  isStandardWarningPreset,
  MAX_DEADLINE_PERIODICITY_VALUE,
  normalizeDeadlineColumnConfig,
  validateDeadlinePeriodicityInput
} from '../services/deadlineService';
import { AppInput, AppSelect, FormField } from './ui';

export interface DeadlineConfigDraft {
  presetId: DeadlinePeriodicityPresetId;
  periodicityValueInput: string;
  periodicityUnit: DeadlinePeriodicityUnit;
  warningValue: number;
  warningDayType: DeadlineWarningDayType;
}

export function createDeadlineConfigDraft(
  rawConfig?: Partial<DeadlineColumnConfig> | null
): DeadlineConfigDraft {
  const cfg = normalizeDeadlineColumnConfig(rawConfig ?? DEFAULT_DEADLINE_COLUMN_CONFIG);
  const presetId = detectPeriodicityPreset(cfg.periodicityValue, cfg.periodicityUnit);
  return {
    presetId,
    periodicityValueInput: String(cfg.periodicityValue),
    periodicityUnit: cfg.periodicityUnit,
    warningValue: cfg.warningValue,
    warningDayType: cfg.warningDayType
  };
}

export function applyPeriodicityPresetToDraft(
  draft: DeadlineConfigDraft,
  nextPresetId: DeadlinePeriodicityPresetId
): DeadlineConfigDraft {
  if (nextPresetId === 'manual') {
    return {
      ...draft,
      presetId: 'manual'
    };
  }
  const preset = DEADLINE_PERIODICITY_PRESETS.find((p) => p.id === nextPresetId);
  if (!preset) {
    return draft;
  }
  return {
    ...draft,
    presetId: preset.id,
    periodicityValueInput: String(preset.value),
    periodicityUnit: preset.unit
  };
}

export function validateAndBuildDeadlineConfig(
  draft: DeadlineConfigDraft
): { ok: true; config: DeadlineColumnConfig } | { ok: false; error: string } {
  if (draft.presetId !== 'manual') {
    const preset = DEADLINE_PERIODICITY_PRESETS.find((p) => p.id === draft.presetId);
    if (preset) {
      return {
        ok: true,
        config: {
          periodicityValue: preset.value,
          periodicityUnit: preset.unit,
          warningValue: draft.warningValue,
          warningDayType: draft.warningDayType
        }
      };
    }
  }

  const check = validateDeadlinePeriodicityInput(draft.periodicityValueInput);
  if (!check.ok) {
    return { ok: false, error: check.error };
  }

  return {
    ok: true,
    config: {
      periodicityValue: check.value,
      periodicityUnit: draft.periodicityUnit,
      warningValue: draft.warningValue,
      warningDayType: draft.warningDayType
    }
  };
}

interface DeadlineConfigFieldsProps {
  draft: DeadlineConfigDraft;
  onChange: (nextDraft: DeadlineConfigDraft) => void;
  compact?: boolean;
  title?: string;
}

export const DeadlineConfigFields: React.FC<DeadlineConfigFieldsProps> = ({
  draft,
  onChange,
  compact = false,
  title = 'Параметры контроля сроков:'
}) => {
  const isManual = draft.presetId === 'manual';
  const manualValidation = isManual
    ? validateDeadlinePeriodicityInput(draft.periodicityValueInput)
    : ({ ok: true, value: Number(draft.periodicityValueInput) || 0 } as const);

  const selectedPreset = DEADLINE_PERIODICITY_PRESETS.find((p) => p.id === draft.presetId);
  const hasNonStandardWarning = !isStandardWarningPreset(draft.warningValue);

  const parsedManualValue = manualValidation.ok ? manualValidation.value : null;

  return (
    <div className="p-3.5 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg border border-amber-200/80 dark:border-amber-800/70 space-y-3">
      <div className="flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-200 text-xs">
        <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
        <span>{title}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
        <FormField
          label="Периодичность:"
          className={isManual ? 'sm:col-span-4' : 'sm:col-span-6'}
        >
          <AppSelect
            compact={compact}
            aria-label="Шаблон периодичности"
            value={draft.presetId}
            onChange={(e) =>
              onChange(
                applyPeriodicityPresetToDraft(draft, e.target.value as DeadlinePeriodicityPresetId)
              )
            }
          >
            {DEADLINE_PERIODICITY_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            <option value="manual">Вручную</option>
          </AppSelect>
        </FormField>

        {isManual && (
          <>
            <FormField
              label="Значение (0 = разовое):"
              error={!manualValidation.ok ? manualValidation.error : undefined}
              className="sm:col-span-4"
            >
              <AppInput
                type="number"
                compact={compact}
                mono
                min={0}
                max={MAX_DEADLINE_PERIODICITY_VALUE}
                step={1}
                aria-label="Числовое значение периодичности"
                value={draft.periodicityValueInput}
                error={!manualValidation.ok}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    periodicityValueInput: e.target.value
                  })
                }
              />
            </FormField>

            <FormField label="Единица:" className="sm:col-span-4">
              <AppSelect
                compact={compact}
                aria-label="Единица периодичности"
                value={draft.periodicityUnit}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    periodicityUnit: e.target.value as DeadlinePeriodicityUnit
                  })
                }
              >
                <option value="days">дней</option>
                <option value="months">месяцев</option>
                <option value="years">лет</option>
              </AppSelect>
            </FormField>
          </>
        )}

        <FormField
          label="Предупреждать заранее:"
          className={isManual ? 'sm:col-span-6' : 'sm:col-span-3'}
        >
          <AppSelect
            compact={compact}
            aria-label="Срок предупреждения"
            value={String(draft.warningValue)}
            onChange={(e) => {
              const nextVal = Number(e.target.value);
              if (Number.isFinite(nextVal) && nextVal >= 0) {
                onChange({
                  ...draft,
                  warningValue: Math.floor(nextVal)
                });
              }
            }}
          >
            {hasNonStandardWarning && (
              <option value={String(draft.warningValue)}>
                Нестандартное (за {draft.warningValue} дн.)
              </option>
            )}
            {DEADLINE_WARNING_PRESETS.map((wp) => (
              <option key={wp.value} value={String(wp.value)}>
                {wp.label}
              </option>
            ))}
          </AppSelect>
        </FormField>

        <FormField
          label="Тип дней предупреждения:"
          className={isManual ? 'sm:col-span-6' : 'sm:col-span-3'}
        >
          <AppSelect
            compact={compact}
            aria-label="Тип дней для предупреждения"
            value={draft.warningDayType}
            onChange={(e) =>
              onChange({
                ...draft,
                warningDayType: e.target.value as DeadlineWarningDayType
              })
            }
          >
            <option value="calendar">Календарные дни</option>
            <option value="working">Рабочие дни (без Сб/Вс и праздников)</option>
          </AppSelect>
        </FormField>
      </div>

      <div className="text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
        {selectedPreset ? (
          <div>
            Выбран шаблон «{selectedPreset.label}» ({selectedPreset.value}{' '}
            {selectedPreset.unit === 'years' ? 'г./лет' : 'мес.'}). Следующая дата рассчитывается автоматически от фактической даты.
          </div>
        ) : parsedManualValue === 0 ? (
          <div>
            Разовое мероприятие: после указания фактической даты статус сразу становится «Выполнено» без автосдвига срока.
          </div>
        ) : (
          <div>
            Ручной интервал: +{draft.periodicityValueInput || '?'} {draft.periodicityUnit === 'days' ? 'дн.' : draft.periodicityUnit === 'years' ? 'г./лет' : 'мес.'} от фактической даты.
          </div>
        )}
        {hasNonStandardWarning && (
          <div className="text-amber-700 dark:text-amber-300">
            Сохранено нестандартное значение предупреждения: за {draft.warningValue} дн. (остаётся без изменений, пока не выбран другой вариант).
          </div>
        )}
        <div>
          Срок предупреждения («За полгода» = ровно 180 {draft.warningDayType === 'working' ? 'рабочих' : 'календарных'} дней) задаёт только момент перехода в статус «Скоро» и не сдвигает плановую дату.
        </div>
      </div>
    </div>
  );
};
