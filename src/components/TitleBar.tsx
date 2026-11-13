import React, { useState, useEffect, useRef } from 'react';
import {
  HardDrive, Sun, Moon, Check, AlertTriangle,
  Building2, ChevronDown, Plus, Copy, Edit2, Trash2,
  RefreshCw, Usb
} from 'lucide-react';
import { AppSettings, LegalEntity } from '../types/database';
import { SaveStatusState } from '../services/storageService';
import { StorageMode } from '../services/localApiClient';

interface TitleBarProps {
  settings: AppSettings;
  onUpdateSettings: (settings: Partial<AppSettings>) => void;
  onOpenPortableModal: () => void;
  lastSaved: string;
  saveStatus?: SaveStatusState;
  storageMode?: StorageMode;
  onRetrySave?: () => void;
  entities: LegalEntity[];
  activeEntity: LegalEntity;
  onSelectEntity: (entityId: string) => void;
  onOpenCreateEntity: () => void;
  onOpenEditEntity: (entity: LegalEntity) => void;
  onOpenCloneEntity: (entity: LegalEntity) => void;
  onDeleteEntity: (entityId: string) => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  settings,
  onUpdateSettings,
  onOpenPortableModal,
  lastSaved,
  saveStatus = 'saved',
  storageMode = 'web-preview',
  onRetrySave,
  entities,
  activeEntity,
  onSelectEntity,
  onOpenCreateEntity,
  onOpenEditEntity,
  onOpenCloneEntity,
  onDeleteEntity
}) => {
  const [isEntityMenuOpen, setIsEntityMenuOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const entityMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (entityMenuRef.current && !entityMenuRef.current.contains(e.target as Node)) {
        setIsEntityMenuOpen(false);
        setConfirmDeleteId(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsEntityMenuOpen(false);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const toggleTheme = () => {
    const nextTheme = settings.theme === 'dark' ? 'light' : 'dark';
    onUpdateSettings({ theme: nextTheme });
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const formattedTime = (() => {
    try {
      return new Date(lastSaved).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  })();

  return (
    <header className="h-10 bg-slate-900 text-slate-200 select-none flex items-center justify-between gap-4 px-3 border-b border-slate-800 text-xs shrink-0 z-50 relative">
      {/* Left Zone: Brand + Legal Entity Switcher */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-5 h-5 rounded bg-blue-600 flex items-center justify-center text-white font-bold text-[10px]">
            ОТ
          </div>
          <span className="font-semibold text-slate-100 tracking-tight whitespace-nowrap">
            ОТ-База
          </span>
        </div>

        <span className="text-slate-700 hidden sm:inline" aria-hidden="true">|</span>

        <div className="relative" ref={entityMenuRef}>
          <button
            type="button"
            onClick={() => {
              setIsEntityMenuOpen((v) => !v);
              setConfirmDeleteId(null);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/80 text-slate-100 transition-colors max-w-[260px] sm:max-w-[340px] cursor-pointer"
            title="Переключить организацию или открыть карточку юрлица"
          >
            <Building2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="font-semibold truncate whitespace-nowrap text-xs">
              {activeEntity.profile.shortName || activeEntity.profile.fullName}
            </span>
            {activeEntity.profile.inn && (
              <span className="hidden md:inline text-[10px] font-mono tabular-nums text-slate-400 shrink-0">
                · ИНН {activeEntity.profile.inn}
              </span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-150 ${isEntityMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {isEntityMenuOpen && (
            <div className="fixed sm:absolute top-10 sm:top-full left-2 sm:left-0 mt-1 w-[360px] max-w-[calc(100vw-16px)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-[120] overflow-hidden text-slate-800 dark:text-slate-100 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                    Организации ({entities.length})
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Отдельные базы данных · общая нормативка
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsEntityMenuOpen(false);
                    onOpenCreateEntity();
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-[11px] shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  title="Добавить новое юридическое лицо"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Добавить</span>
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {entities.map((ent) => {
                  const isActive = ent.id === activeEntity.id;
                  const totalRows = ent.tabs.reduce((acc, t) => acc + t.rows.length, 0);
                  const isConfirmingDel = confirmDeleteId === ent.id;

                  return (
                    <div
                      key={ent.id}
                      className={`px-3 py-2.5 transition-colors ${
                        isActive
                          ? 'bg-blue-50/70 dark:bg-blue-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectEntity(ent.id);
                            setIsEntityMenuOpen(false);
                          }}
                          className="flex-1 min-w-0 text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5">
                            {isActive ? (
                              <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                            ) : (
                              <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            )}
                            <span className={`font-semibold truncate text-xs ${isActive ? 'text-blue-700 dark:text-blue-300' : 'text-slate-900 dark:text-slate-100'}`}>
                              {ent.profile.shortName || ent.profile.fullName}
                            </span>
                          </div>
                          <div className="pl-5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 font-mono tabular-nums">
                            <span>{ent.profile.inn ? `ИНН ${ent.profile.inn}` : 'ИНН не указан'}</span>
                            <span>·</span>
                            <span>{ent.tabs.length} табл. / {totalRows} зап.</span>
                          </div>
                        </button>

                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsEntityMenuOpen(false);
                              onOpenEditEntity(ent);
                            }}
                            className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                            title="Карточка предприятия (реквизиты)"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsEntityMenuOpen(false);
                              onOpenCloneEntity(ent);
                            }}
                            className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                            title="Клонировать структуру вкладок и связей в новое юрлицо"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          {entities.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(isConfirmingDel ? null : ent.id);
                              }}
                              className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                              title="Удалить юрлицо"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {isConfirmingDel && (
                        <div className="mt-2 p-2 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 rounded-lg flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-red-800 dark:text-red-200 font-medium">
                            Удалить базу «{ent.profile.shortName}»?
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-600 dark:text-slate-300"
                            >
                              Нет
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteEntity(ent.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded font-semibold"
                            >
                              Удалить
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setIsEntityMenuOpen(false);
                    onOpenEditEntity(activeEntity);
                  }}
                  className="text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 font-medium flex items-center gap-1 cursor-pointer"
                >
                  <Edit2 className="w-3 h-3" />
                  <span>Реквизиты текущего</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEntityMenuOpen(false);
                    onOpenCloneEntity(activeEntity);
                  }}
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>Клонировать текущее</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center Zone: Honest Save Status */}
      <div className="hidden md:flex items-center gap-2 text-[11px] shrink-0">
        {saveStatus === 'saving' ? (
          <span className="flex items-center gap-1.5 text-blue-300 whitespace-nowrap">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>Сохранение...</span>
          </span>
        ) : saveStatus === 'usb_disconnected' ? (
          <div className="flex items-center gap-2 text-red-300 whitespace-nowrap">
            <Usb className="w-3.5 h-3.5 text-red-400" />
            <span className="font-medium">Носитель отключён</span>
            {onRetrySave && (
              <button
                type="button"
                onClick={onRetrySave}
                className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded text-[10px] font-semibold cursor-pointer"
              >
                Повторить
              </button>
            )}
          </div>
        ) : saveStatus === 'error' || saveStatus === 'conflict' ? (
          <div className="flex items-center gap-2 text-amber-300 whitespace-nowrap">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-medium">
              {saveStatus === 'conflict' ? 'Конфликт версии файла' : 'Ошибка сохранения'}
            </span>
            {onRetrySave && (
              <button
                type="button"
                onClick={onRetrySave}
                className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-[10px] font-semibold cursor-pointer"
              >
                Повторить
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-slate-400">
            <span className="flex items-center gap-1 text-slate-300 whitespace-nowrap">
              <Check className="w-3 h-3 text-emerald-400" />
              <span>
                {storageMode === 'native-fs' ? 'Записано на диск' : 'Сохранено в браузере'}
              </span>
            </span>
            {formattedTime && (
              <>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                  {formattedTime}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Right Zone: Clean Portable Modal Trigger & Theme Switcher */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onOpenPortableModal}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors whitespace-nowrap cursor-pointer"
          title="Портативная версия для Windows (OT-Baza.exe и папка базы данных)"
        >
          <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden sm:inline">Портативная сборка</span>
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors cursor-pointer"
          title={settings.theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
        >
          {settings.theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
      </div>
    </header>
  );
};
