import React, { useState, useEffect, useId, useRef, useCallback, useMemo } from 'react';
import { Building2, Copy, Check, Plus, AlertTriangle } from 'lucide-react';
import { LegalEntity, LegalEntityProfile } from '../types/database';
import { CloneEntityMode } from '../services/storageService';
import {
  AppButton,
  AppInput,
  AppModal,
  AppSelect,
  ConfirmDialog,
  FormField,
  StatusBanner
} from './ui';

export type LegalEntityModalMode = 'create' | 'edit' | 'clone';

interface LegalEntityModalProps {
  isOpen: boolean;
  mode: LegalEntityModalMode;
  onClose: () => void;
  entities: LegalEntity[];
  targetEntity?: LegalEntity | null;
  onSaveEntity: (params: {
    mode: LegalEntityModalMode;
    entityId?: string;
    profile: LegalEntityProfile;
    sourceEntityId?: string;
    cloneMode?: CloneEntityMode;
  }) => void;
}

interface EntityDraftSnapshot {
  profile: LegalEntityProfile;
  sourceEntityId: string;
  cloneEnabled: boolean;
  cloneMode: CloneEntityMode;
}

type LegalEntityFieldErrorKey = 'shortName' | 'email';

const EMPTY_PROFILE: LegalEntityProfile = {
  fullName: '',
  shortName: '',
  inn: '',
  kpp: '',
  ogrn: '',
  okpo: '',
  okved: '',
  bankDetails: '',
  bankIn: '',
  legalAddress: '',
  email: '',
  phone: '',
  directorFio: ''
};

export const LegalEntityModal: React.FC<LegalEntityModalProps> = ({
  isOpen,
  mode,
  onClose,
  entities,
  targetEntity,
  onSaveEntity
}) => {
  const formId = useId();
  const [profile, setProfile] = useState<LegalEntityProfile>(EMPTY_PROFILE);
  const [sourceEntityId, setSourceEntityId] = useState<string>('');
  const [cloneEnabled, setCloneEnabled] = useState<boolean>(false);
  const [cloneMode, setCloneMode] = useState<CloneEntityMode>('structure_only');
  const [initialSnapshot, setInitialSnapshot] = useState<EntityDraftSnapshot | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LegalEntityFieldErrorKey, string>>>({});
  const [pendingDiscardConfirm, setPendingDiscardConfirm] = useState(false);

  const prevOpenRef = useRef(false);
  const prevTargetKeyRef = useRef<string>('');
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    const targetKey = `${mode}:${targetEntity?.id || ''}`;
    const justOpened = isOpen && !prevOpenRef.current;
    const targetChanged = isOpen && targetKey !== prevTargetKeyRef.current;
    prevOpenRef.current = isOpen;
    prevTargetKeyRef.current = targetKey;

    if (!isOpen) {
      isSubmittingRef.current = false;
      return;
    }
    if (!justOpened && !targetChanged) return;

    setErrorMsg('');
    setFieldErrors({});
    setPendingDiscardConfirm(false);
    isSubmittingRef.current = false;

    let nextSnapshot: EntityDraftSnapshot;
    if (mode === 'edit' && targetEntity) {
      nextSnapshot = {
        profile: { ...targetEntity.profile },
        sourceEntityId: '',
        cloneEnabled: false,
        cloneMode: 'structure_only'
      };
    } else if (mode === 'clone' && targetEntity) {
      nextSnapshot = {
        profile: {
          ...EMPTY_PROFILE,
          fullName: `${targetEntity.profile.fullName} (копия)`,
          shortName: `${targetEntity.profile.shortName} (копия)`,
          okved: targetEntity.profile.okved || '',
          bankIn: targetEntity.profile.bankIn || ''
        },
        sourceEntityId: targetEntity.id,
        cloneEnabled: true,
        cloneMode: 'structure_only'
      };
    } else {
      nextSnapshot = {
        profile: { ...EMPTY_PROFILE },
        sourceEntityId: entities[0]?.id || '',
        cloneEnabled: false,
        cloneMode: 'structure_only'
      };
    }

    setProfile(nextSnapshot.profile);
    setSourceEntityId(nextSnapshot.sourceEntityId);
    setCloneEnabled(nextSnapshot.cloneEnabled);
    setCloneMode(nextSnapshot.cloneMode);
    setInitialSnapshot(nextSnapshot);
  }, [isOpen, mode, targetEntity, entities]);

  const isDirty = useMemo(() => {
    if (!isOpen || !initialSnapshot) return false;
    return (
      JSON.stringify({ profile, sourceEntityId, cloneEnabled, cloneMode }) !==
      JSON.stringify(initialSnapshot)
    );
  }, [isOpen, initialSnapshot, profile, sourceEntityId, cloneEnabled, cloneMode]);

  const requestClose = useCallback(() => {
    if (isDirty) {
      setPendingDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const updateField = (key: keyof LegalEntityProfile, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
    setErrorMsg('');
    if (key === 'shortName' || key === 'fullName') {
      setFieldErrors((prev) => ({ ...prev, shortName: undefined }));
    } else if (key === 'email') {
      setFieldErrors((prev) => ({ ...prev, email: undefined }));
    }
  };

  // Non-blocking format hints for registration codes (do not forbid valid non-standard cases)
  const innHint = useMemo(() => {
    const val = profile.inn.trim();
    if (!val) return undefined;
    if (!/^\d+$/.test(val) || (val.length !== 10 && val.length !== 12)) {
      return 'Обычно 10 цифр (юрлицо) или 12 (ИП)';
    }
    return undefined;
  }, [profile.inn]);

  const kppHint = useMemo(() => {
    const val = profile.kpp.trim();
    if (!val) return undefined;
    if (!/^\d{9}$/.test(val)) {
      return 'Обычно 9 цифр';
    }
    return undefined;
  }, [profile.kpp]);

  const ogrnHint = useMemo(() => {
    const val = profile.ogrn.trim();
    if (!val) return undefined;
    if (!/^\d+$/.test(val) || (val.length !== 13 && val.length !== 15)) {
      return 'Обычно 13 или 15 цифр';
    }
    return undefined;
  }, [profile.ogrn]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;

    const nextFieldErrors: Partial<Record<LegalEntityFieldErrorKey, string>> = {};
    if (!profile.shortName.trim() && !profile.fullName.trim()) {
      nextFieldErrors.shortName = 'Укажите сокращённое или полное наименование организации.';
    }
    const trimmedEmail = profile.email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      nextFieldErrors.email = 'Проверьте формат e-mail (например, info@company.ru).';
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setErrorMsg(
        nextFieldErrors.shortName ||
          nextFieldErrors.email ||
          'Исправьте ошибки заполнения полей формы.'
      );
      return;
    }

    isSubmittingRef.current = true;
    const normalizedProfile: LegalEntityProfile = {
      ...profile,
      shortName: profile.shortName.trim() || profile.fullName.trim(),
      fullName: profile.fullName.trim() || profile.shortName.trim(),
      inn: profile.inn.trim(),
      kpp: profile.kpp.trim(),
      ogrn: profile.ogrn.trim(),
      okpo: profile.okpo.trim(),
      okved: profile.okved.trim(),
      bankDetails: profile.bankDetails.trim(),
      bankIn: profile.bankIn.trim(),
      legalAddress: profile.legalAddress.trim(),
      email: trimmedEmail,
      phone: profile.phone.trim(),
      directorFio: profile.directorFio.trim()
    };

    const effectiveMode: LegalEntityModalMode =
      mode === 'edit' ? 'edit' : cloneEnabled && sourceEntityId ? 'clone' : 'create';

    onSaveEntity({
      mode: effectiveMode,
      entityId: mode === 'edit' ? targetEntity?.id : undefined,
      profile: normalizedProfile,
      sourceEntityId: effectiveMode === 'clone' ? sourceEntityId : undefined,
      cloneMode: effectiveMode === 'clone' ? cloneMode : undefined
    });
    onClose();
  };

  const modalTitle =
    mode === 'edit'
      ? `Карточка предприятия — ${targetEntity?.profile.shortName || ''}`
      : mode === 'clone' || cloneEnabled
        ? 'Клонирование юридического лица'
        : 'Новое юридическое лицо';

  const modalSubtitle =
    mode === 'edit'
      ? 'Реквизиты организации для учета и автоматической подстановки в документы'
      : 'Отдельная изолированная база таблиц и сотрудников; нормативная база остается общей';

  return (
    <>
      <AppModal
        isOpen={isOpen}
        onClose={requestClose}
        size="3xl"
        layer="nested"
        icon={cloneEnabled ? <Copy className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
        iconTone="blue"
        title={modalTitle}
        subtitle={modalSubtitle}
        footer={
          <div className="w-full flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {isDirty ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  Есть несохранённые изменения черновика
                </span>
              ) : (
                <span>
                  {mode === 'edit'
                    ? 'Внесите изменения в реквизиты и нажмите «Сохранить карточку»'
                    : 'Заполните обязательные реквизиты организации'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <AppButton variant="secondary" size="md" onClick={requestClose}>
                Отмена
              </AppButton>
              <AppButton
                type="submit"
                form={formId}
                variant="primary"
                size="md"
                disabled={mode === 'edit' && !isDirty}
                icon={
                  mode === 'edit' ? (
                    <Check className="w-4 h-4" />
                  ) : cloneEnabled ? (
                    <Copy className="w-4 h-4" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )
                }
              >
                {mode === 'edit'
                  ? 'Сохранить карточку'
                  : cloneEnabled
                    ? 'Клонировать и переключиться'
                    : 'Создать юрлицо'}
              </AppButton>
            </div>
          </div>
        }
      >
        <form
          id={formId}
          noValidate
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto p-6 space-y-5 text-xs"
        >
          {errorMsg && (
            <StatusBanner variant="error" compact>
              {errorMsg}
            </StatusBanner>
          )}

          {/* Clone selector for new or cloned entity */}
          {mode !== 'edit' && entities.length > 0 && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Copy className="w-3.5 h-3.5 text-blue-600" />
                    <span>Клонировать структуру вкладок и зависимостей от существующего юрлица</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Позволяет перенести все вкладки, столбцы, мастер-зависимости, теги и шаблоны в новое юрлицо без повторной настройки
                  </p>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={cloneEnabled}
                    onChange={(e) => {
                      setCloneEnabled(e.target.checked);
                      if (e.target.checked && !sourceEntityId && entities[0]) {
                        setSourceEntityId(entities[0].id);
                      }
                    }}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                </label>
              </div>

              {cloneEnabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <FormField label="Источник для клонирования:">
                    <AppSelect
                      value={sourceEntityId}
                      onChange={(e) => setSourceEntityId(e.target.value)}
                      compact
                    >
                      {entities.map((ent) => (
                        <option key={ent.id} value={ent.id}>
                          {ent.profile.shortName} (вкладок: {ent.tabs.length})
                        </option>
                      ))}
                    </AppSelect>
                  </FormField>

                  <FormField label="Режим переноса данных:">
                    <AppSelect
                      value={cloneMode}
                      onChange={(e) => setCloneMode(e.target.value as CloneEntityMode)}
                      compact
                    >
                      <option value="structure_only">Только структура вкладок, столбцы и связи (чистые таблицы)</option>
                      <option value="structure_and_masters">Структура + записи мастер-справочников (СОУТ/должности)</option>
                      <option value="full_copy">Полная копия всех таблиц и строк</option>
                    </AppSelect>
                  </FormField>
                </div>
              )}
            </div>
          )}

          {/* Section 1: Наименования */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-1.5">
              Основные наименования
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <FormField
                label="Полное наименование юридического лица на русском языке"
                className="sm:col-span-7"
              >
                <AppInput
                  type="text"
                  value={profile.fullName}
                  onChange={(e) => updateField('fullName', e.target.value)}
                  placeholder="Общество с ограниченной ответственностью «Катания»"
                />
              </FormField>

              <FormField
                label="Сокращенное наименование юридического лица"
                required
                error={fieldErrors.shortName}
                className="sm:col-span-5"
              >
                <AppInput
                  type="text"
                  error={Boolean(fieldErrors.shortName)}
                  value={profile.shortName}
                  onChange={(e) => updateField('shortName', e.target.value)}
                  placeholder="ООО «Катания»"
                  autoFocus
                  className="font-medium"
                />
              </FormField>
            </div>
          </div>

          {/* Section 2: Коды регистрации */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-1.5">
              Регистрационные и статистические коды
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <FormField label="ИНН" hint={innHint}>
                <AppInput
                  type="text"
                  mono
                  compact
                  value={profile.inn}
                  onChange={(e) => updateField('inn', e.target.value)}
                  placeholder="7701234567"
                />
              </FormField>

              <FormField label="КПП" hint={kppHint}>
                <AppInput
                  type="text"
                  mono
                  compact
                  value={profile.kpp}
                  onChange={(e) => updateField('kpp', e.target.value)}
                  placeholder="770101001"
                />
              </FormField>

              <FormField label="ОГРН" hint={ogrnHint}>
                <AppInput
                  type="text"
                  mono
                  compact
                  value={profile.ogrn}
                  onChange={(e) => updateField('ogrn', e.target.value)}
                  placeholder="1157746123456"
                />
              </FormField>

              <FormField label="ОКПО">
                <AppInput
                  type="text"
                  mono
                  compact
                  value={profile.okpo}
                  onChange={(e) => updateField('okpo', e.target.value)}
                  placeholder="40123456"
                />
              </FormField>

              <FormField label="ОКВЭД">
                <AppInput
                  type="text"
                  mono
                  compact
                  value={profile.okved}
                  onChange={(e) => updateField('okved', e.target.value)}
                  placeholder="46.90"
                />
              </FormField>
            </div>
          </div>

          {/* Section 3: Банковские реквизиты */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-1.5">
              Банковские реквизиты
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <FormField label="Реквизиты банка:" className="sm:col-span-7">
                <AppInput
                  type="text"
                  mono
                  value={profile.bankDetails}
                  onChange={(e) => updateField('bankDetails', e.target.value)}
                  placeholder="р/с 40702810400000012345, к/с 30101810400000000225, БИК 044525225"
                />
              </FormField>

              <FormField label="Банк в" className="sm:col-span-5">
                <AppInput
                  type="text"
                  value={profile.bankIn}
                  onChange={(e) => updateField('bankIn', e.target.value)}
                  placeholder="ПАО Сбербанк, г. Москва"
                />
              </FormField>
            </div>
          </div>

          {/* Section 4: Адрес, контакты и руководитель */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-1.5">
              Адрес, контакты и руководство
            </h3>

            <FormField label="Юридический адрес:">
              <AppInput
                type="text"
                value={profile.legalAddress}
                onChange={(e) => updateField('legalAddress', e.target.value)}
                placeholder="105064, г. Москва, ул. Земляной Вал, д. 9, оф. 412"
              />
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <FormField label="E-mail:" error={fieldErrors.email} className="sm:col-span-4">
                <AppInput
                  type="email"
                  error={Boolean(fieldErrors.email)}
                  value={profile.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="info@company.ru"
                />
              </FormField>

              <FormField label="Телефон:" className="sm:col-span-3">
                <AppInput
                  type="text"
                  mono
                  value={profile.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  placeholder="+7 (495) 000-00-00"
                />
              </FormField>

              <FormField label="Генеральный директор (директор, ИП) ФИО" className="sm:col-span-5">
                <AppInput
                  type="text"
                  value={profile.directorFio}
                  onChange={(e) => updateField('directorFio', e.target.value)}
                  placeholder="Иванов Иван Иванович"
                />
              </FormField>
            </div>
          </div>
        </form>
      </AppModal>

      <ConfirmDialog
        isOpen={pendingDiscardConfirm}
        danger
        title="Отменить несохранённые изменения?"
        description="В карточке юридического лица есть несохранённые изменения. Закрыть окно без сохранения?"
        confirmLabel="Закрыть без сохранения"
        cancelLabel="Вернуться"
        onConfirm={() => {
          setPendingDiscardConfirm(false);
          onClose();
        }}
        onCancel={() => setPendingDiscardConfirm(false)}
      />
    </>
  );
};
