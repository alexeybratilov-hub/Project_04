import React, { useState, useEffect } from 'react';
import { X, Building2, Copy, Check, AlertTriangle, Plus } from 'lucide-react';
import { LegalEntity, LegalEntityProfile } from '../types/database';
import { CloneEntityMode } from '../services/storageService';

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
  const [profile, setProfile] = useState<LegalEntityProfile>(EMPTY_PROFILE);
  const [sourceEntityId, setSourceEntityId] = useState<string>('');
  const [cloneEnabled, setCloneEnabled] = useState<boolean>(false);
  const [cloneMode, setCloneMode] = useState<CloneEntityMode>('structure_only');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');

    if (mode === 'edit' && targetEntity) {
      setProfile({ ...targetEntity.profile });
      setCloneEnabled(false);
      setSourceEntityId('');
    } else if (mode === 'clone' && targetEntity) {
      setProfile({
        ...EMPTY_PROFILE,
        fullName: `${targetEntity.profile.fullName} (копия)`,
        shortName: `${targetEntity.profile.shortName} (копия)`,
        okved: targetEntity.profile.okved || '',
        bankIn: targetEntity.profile.bankIn || ''
      });
      setSourceEntityId(targetEntity.id);
      setCloneEnabled(true);
      setCloneMode('structure_only');
    } else {
      setProfile({ ...EMPTY_PROFILE });
      setCloneEnabled(false);
      setSourceEntityId(entities[0]?.id || '');
      setCloneMode('structure_only');
    }
  }, [isOpen, mode, targetEntity, entities]);

  if (!isOpen) return null;

  const updateField = (key: keyof LegalEntityProfile, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
    setErrorMsg('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile.shortName.trim() && !profile.fullName.trim()) {
      setErrorMsg('Укажите сокращенное или полное наименование юридического лица.');
      return;
    }

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
      email: profile.email.trim(),
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
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-3xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 rounded-lg">
              {cloneEnabled ? <Copy className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {modalTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {modalSubtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Clone selector for new or cloned entity */}
          {mode !== 'edit' && entities.length > 0 && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 space-y-3">
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
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Источник для клонирования:
                    </label>
                    <select
                      value={sourceEntityId}
                      onChange={(e) => setSourceEntityId(e.target.value)}
                      className="w-full px-2.5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white"
                    >
                      {entities.map((ent) => (
                        <option key={ent.id} value={ent.id}>
                          {ent.profile.shortName} (вкладок: {ent.tabs.length})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Режим переноса данных:
                    </label>
                    <select
                      value={cloneMode}
                      onChange={(e) => setCloneMode(e.target.value as CloneEntityMode)}
                      className="w-full px-2.5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white"
                    >
                      <option value="structure_only">Только структура вкладок, столбцы и связи (чистые таблицы)</option>
                      <option value="structure_and_masters">Структура + записи мастер-справочников (СОУТ/должности)</option>
                      <option value="full_copy">Полная копия всех таблиц и строк</option>
                    </select>
                  </div>
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
              <div className="sm:col-span-7">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Полное наименование юридического лица на русском языке
                </label>
                <input
                  type="text"
                  value={profile.fullName}
                  onChange={(e) => updateField('fullName', e.target.value)}
                  placeholder="Общество с ограниченной ответственностью «Катания»"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>

              <div className="sm:col-span-5">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Сокращенное наименование юридического лица <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={profile.shortName}
                  onChange={(e) => updateField('shortName', e.target.value)}
                  placeholder="ООО «Катания»"
                  autoFocus
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Коды регистрации */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-1.5">
              Регистрационные и статистические коды
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  ИНН
                </label>
                <input
                  type="text"
                  value={profile.inn}
                  onChange={(e) => updateField('inn', e.target.value)}
                  placeholder="7701234567"
                  className="w-full px-2.5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono tabular-nums text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  КПП
                </label>
                <input
                  type="text"
                  value={profile.kpp}
                  onChange={(e) => updateField('kpp', e.target.value)}
                  placeholder="770101001"
                  className="w-full px-2.5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono tabular-nums text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  ОГРН
                </label>
                <input
                  type="text"
                  value={profile.ogrn}
                  onChange={(e) => updateField('ogrn', e.target.value)}
                  placeholder="1157746123456"
                  className="w-full px-2.5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono tabular-nums text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  ОКПО
                </label>
                <input
                  type="text"
                  value={profile.okpo}
                  onChange={(e) => updateField('okpo', e.target.value)}
                  placeholder="40123456"
                  className="w-full px-2.5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono tabular-nums text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  ОКВЭД
                </label>
                <input
                  type="text"
                  value={profile.okved}
                  onChange={(e) => updateField('okved', e.target.value)}
                  placeholder="46.90"
                  className="w-full px-2.5 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono tabular-nums text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Банковские реквизиты */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-1.5">
              Банковские реквизиты
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-7">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Реквизиты банка:
                </label>
                <input
                  type="text"
                  value={profile.bankDetails}
                  onChange={(e) => updateField('bankDetails', e.target.value)}
                  placeholder="р/с 40702810400000012345, к/с 30101810400000000225, БИК 044525225"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>

              <div className="sm:col-span-5">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Банк в
                </label>
                <input
                  type="text"
                  value={profile.bankIn}
                  onChange={(e) => updateField('bankIn', e.target.value)}
                  placeholder="ПАО Сбербанк, г. Москва"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>
            </div>
          </div>

          {/* Section 4: Адрес, контакты и руководитель */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-1.5">
              Адрес, контакты и руководство
            </h3>

            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Юридический адрес:
              </label>
              <input
                type="text"
                value={profile.legalAddress}
                onChange={(e) => updateField('legalAddress', e.target.value)}
                placeholder="105064, г. Москва, ул. Земляной Вал, д. 9, оф. 412"
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-4">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  E-mail:
                </label>
                <input
                  type="email"
                  value={profile.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="info@company.ru"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  телефон
                </label>
                <input
                  type="text"
                  value={profile.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  placeholder="+7 (495) 000-00-00"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>

              <div className="sm:col-span-5">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Генеральный директор (директор, ИП) ФИО
                </label>
                <input
                  type="text"
                  value={profile.directorFio}
                  onChange={(e) => updateField('directorFio', e.target.value)}
                  placeholder="Иванов Иван Иванович"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                />
              </div>
            </div>
          </div>

          {/* Footer inside form */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg font-medium"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center gap-2 shadow-xs transition-colors"
            >
              {mode === 'edit' ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Сохранить карточку</span>
                </>
              ) : cloneEnabled ? (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Клонировать и переключиться</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Создать юрлицо</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
