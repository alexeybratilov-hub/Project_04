import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Tag as TagIcon, Plus, Trash2, Copy, Check, AlertTriangle, Search } from 'lucide-react';
import { DocumentTemplate, Tab, Tag } from '../types/database';
import { createUniqueId, integrityService } from '../services/integrityService';
import {
  AppButton,
  AppInput,
  AppModal,
  AppSelect,
  ConfirmDialog,
  FormField,
  StatusBanner,
  useToast
} from './ui';

interface TagsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tags: Tag[];
  tabs: Tab[];
  templates: DocumentTemplate[];
  onSaveTags: (tags: Tag[]) => void;
}

export const TagsModal: React.FC<TagsModalProps> = ({
  isOpen,
  onClose,
  tags,
  tabs,
  templates,
  onSaveTags
}) => {
  const { showToast } = useToast();
  const [localTags, setLocalTags] = useState<Tag[]>(tags);
  const [copiedTagId, setCopiedTagId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagTabId, setNewTagTabId] = useState(tabs[0]?.id || '');
  const [newTagColId, setNewTagColId] = useState(tabs[0]?.columns[0]?.id || '');
  const [newTagDesc, setNewTagDesc] = useState('');
  const [pendingDeleteTag, setPendingDeleteTag] = useState<{
    tag: Tag;
    tabName: string;
    colName: string;
    usedInTemplates: { id: string; name: string; isArchived?: boolean }[];
  } | null>(null);
  const [pendingDiscardConfirm, setPendingDiscardConfirm] = useState(false);

  const prevOpenRef = useRef(false);

  // Initialize local draft strictly when modal opens; keep tab/col selectors valid when tabs change
  useEffect(() => {
    const justOpened = isOpen && !prevOpenRef.current;
    prevOpenRef.current = isOpen;

    if (justOpened) {
      setLocalTags(JSON.parse(JSON.stringify(tags)));
      setPendingDeleteTag(null);
      setPendingDiscardConfirm(false);
      setNewTagName('');
      setNewTagDesc('');
      setSearch('');
    }

    if (isOpen) {
      const fallbackTab = tabs[0];
      const validTab = tabs.find((t) => t.id === newTagTabId) || fallbackTab;
      if (validTab) {
        setNewTagTabId(validTab.id);
        const validCol = validTab.columns.find((c) => c.id === newTagColId) || validTab.columns[0];
        setNewTagColId(validCol?.id || '');
      } else {
        setNewTagTabId('');
        setNewTagColId('');
      }
    }
  }, [isOpen, tags, tabs, newTagTabId, newTagColId]);

  const tagsChanged = JSON.stringify(localTags) !== JSON.stringify(tags);
  const isDirty = tagsChanged || Boolean(newTagName.trim()) || Boolean(newTagDesc.trim());

  const requestClose = useCallback(() => {
    if (isDirty) {
      setPendingDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  // Exclude built-in LegalEntity requisite tags & {id} from false orphan alerts
  const orphanedTags = integrityService.getOrphanedTemplateTags(templates, localTags);

  const handleCopy = (tagName: string, tagId: string) => {
    navigator.clipboard?.writeText(tagName);
    setCopiedTagId(tagId);
    setTimeout(() => setCopiedTagId(null), 1500);
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim() || !newTagTabId || !newTagColId) return;

    let formattedName = newTagName.trim();
    if (!formattedName.startsWith('{')) formattedName = '{' + formattedName;
    if (!formattedName.endsWith('}')) formattedName = formattedName + '}';

    const newTag: Tag = {
      id: createUniqueId('tag'),
      name: formattedName,
      tabId: newTagTabId,
      columnId: newTagColId,
      description: newTagDesc.trim() || undefined
    };

    const updated = [...localTags, newTag];
    setLocalTags(updated);
    setNewTagName('');
    setNewTagDesc('');
    showToast(`Тег ${formattedName} добавлен в черновик`, 'info');
  };

  const requestDeleteTag = (tag: Tag, tabName: string, colName: string) => {
    const impact = integrityService.getTagDeleteImpact(tag.name, templates);
    setPendingDeleteTag({
      tag,
      tabName,
      colName,
      usedInTemplates: impact.usedInTemplates
    });
  };

  const confirmDeleteTag = () => {
    if (!pendingDeleteTag) return;
    const { tag } = pendingDeleteTag;
    const updated = localTags.filter((t) => t.id !== tag.id);
    setLocalTags(updated);
    setPendingDeleteTag(null);
    showToast(`Тег ${tag.name} удалён из черновика (нажмите «Сохранить изменения»)`, 'info');
  };

  const handleSaveAndClose = () => {
    if (!tagsChanged && newTagName.trim()) {
      showToast(
        `Нажмите кнопку «+», чтобы добавить тег «${newTagName.trim()}» в список перед сохранением.`,
        'warning'
      );
      return;
    }
    if (tagsChanged) {
      onSaveTags(localTags);
      showToast('Пул тегов сохранён', 'success');
    }
    onClose();
  };

  const filteredTags = localTags.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(search.toLowerCase()))
  );

  const selectedTabForAdd = tabs.find((t) => t.id === newTagTabId) || tabs[0];

  return (
    <>
      <AppModal
        isOpen={isOpen}
        onClose={requestClose}
        size="4xl"
        heightClass="max-h-[90vh]"
        icon={<TagIcon className="w-5 h-5" />}
        iconTone="indigo"
        title="Пул тегов шаблонизатора"
        subtitle="Привязка плейсхолдеров {Имя_тега} к колонкам активного юрлица"
        footer={
          <div className="w-full flex flex-wrap items-center justify-between gap-3">
            <div>
              {isDirty ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 font-medium text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  Есть несохранённые изменения черновика
                </span>
              ) : (
                <span className="text-slate-500">
                  Используйте теги прямо в шаблонах Word и PDF, например{' '}
                  <code className="font-mono text-blue-600">&#123;ФИО&#125;</code>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <AppButton variant="secondary" size="md" onClick={requestClose}>
                Отмена
              </AppButton>
              <AppButton
                variant="primary"
                size="md"
                onClick={handleSaveAndClose}
                disabled={!isDirty}
              >
                Сохранить изменения
              </AppButton>
            </div>
          </div>
        }
      >
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Orphaned Tags Warning */}
          {orphanedTags.length > 0 && (
            <StatusBanner
              variant="warning"
              compact
              title={`Непривязанные теги в шаблонах (${orphanedTags.length}):`}
            >
              <p className="leading-relaxed">
                Эти плейсхолдеры встречаются в шаблонах документов, но пока не привязаны к столбцу (системные теги организации распознаются автоматически):
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1.5">
                {orphanedTags.map((tName) => (
                  <button
                    key={tName}
                    type="button"
                    onClick={() => setNewTagName(tName)}
                    className="px-2 py-0.5 bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 rounded font-mono text-[11px] hover:bg-amber-100 transition-colors cursor-pointer"
                  >
                    + {tName}
                  </button>
                ))}
              </div>
            </StatusBanner>
          )}

          {/* Add New Tag Form */}
          <form
            onSubmit={handleAddTag}
            className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3"
          >
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Создать новую привязку тега:
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
              <FormField label="Имя тега ({Имя}):">
                <AppInput
                  type="text"
                  compact
                  mono
                  placeholder="{Новый_тег}"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                />
              </FormField>

              <FormField label="Вкладка-источник:">
                <AppSelect
                  compact
                  value={newTagTabId}
                  onChange={(e) => {
                    setNewTagTabId(e.target.value);
                    const selected = tabs.find((t) => t.id === e.target.value);
                    setNewTagColId(selected?.columns[0]?.id || '');
                  }}
                >
                  {tabs.map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {tab.name}
                    </option>
                  ))}
                </AppSelect>
              </FormField>

              <FormField label="Поле (столбец):">
                <AppSelect
                  compact
                  value={newTagColId}
                  onChange={(e) => setNewTagColId(e.target.value)}
                >
                  {(selectedTabForAdd?.columns || []).map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name}
                    </option>
                  ))}
                </AppSelect>
              </FormField>

              <FormField label="Описание:">
                <div className="flex items-center gap-1.5">
                  <AppInput
                    type="text"
                    compact
                    placeholder="Назначение тега"
                    value={newTagDesc}
                    onChange={(e) => setNewTagDesc(e.target.value)}
                  />
                  <AppButton
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!newTagName.trim() || !newTagColId}
                    icon={<Plus className="w-4 h-4" />}
                    className="shrink-0 !px-2.5"
                    title="Добавить тег"
                  />
                </div>
              </FormField>
            </div>
          </form>

          {/* System Entity Tags Cheat Sheet */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl text-[11px] text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-800 dark:text-slate-200">Автоматические теги реквизитов юрлица: </span>
            <span className="font-mono text-slate-700 dark:text-slate-300">
              &#123;Организация&#125;, &#123;Организация_полное&#125;, &#123;ИНН&#125;, &#123;КПП&#125;, &#123;ОГРН&#125;, &#123;ОКПО&#125;, &#123;ОКВЭД&#125;, &#123;Юридический_адрес&#125;, &#123;Генеральный_директор&#125;
            </span>
          </div>

          {/* Tags Table */}
          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Зарегистрированные теги ({filteredTags.length}):
              </h3>
              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <AppInput
                  type="text"
                  compact
                  placeholder="Фильтр по тегам..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="!pl-8 !py-1 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden text-xs">
              <table className="w-full border-collapse">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-left">
                  <tr>
                    <th className="px-4 py-2.5 border-r border-slate-200 dark:border-slate-700">Имя тега</th>
                    <th className="px-4 py-2.5 border-r border-slate-200 dark:border-slate-700">Вкладка</th>
                    <th className="px-4 py-2.5 border-r border-slate-200 dark:border-slate-700">Столбец базы</th>
                    <th className="px-4 py-2.5 border-r border-slate-200 dark:border-slate-700">Описание</th>
                    <th className="w-24 px-3 py-2.5 text-center">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {filteredTags.map((tag) => {
                    const tab = tabs.find((t) => t.id === tag.tabId);
                    const col = tab?.columns.find((c) => c.id === tag.columnId);
                    const isCopied = copiedTagId === tag.id;
                    const isBroken = !tab || !col;

                    return (
                      <tr key={tag.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-4 py-2 border-r border-slate-200/60 dark:border-slate-800 font-mono font-medium text-blue-600 dark:text-blue-400 select-all">
                          {tag.name}
                        </td>
                        <td className="px-4 py-2 border-r border-slate-200/60 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                          {tab?.name || <span className="text-red-500">Вкладка удалена</span>}
                        </td>
                        <td className="px-4 py-2 border-r border-slate-200/60 dark:border-slate-800 font-medium text-slate-800 dark:text-slate-200">
                          {col?.name || <span className="text-red-500">{isBroken ? 'Столбец не найден' : '—'}</span>}
                        </td>
                        <td className="px-4 py-2 border-r border-slate-200/60 dark:border-slate-800 text-slate-500 text-[11px]">
                          {tag.description || '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopy(tag.name, tag.id)}
                              className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors cursor-pointer"
                              title="Скопировать тег"
                            >
                              {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                requestDeleteTag(
                                  tag,
                                  tab?.name || 'удалённая вкладка',
                                  col?.name || 'удалённый столбец'
                                )
                              }
                              className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                              title="Удалить тег"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </AppModal>

      <ConfirmDialog
        isOpen={Boolean(pendingDeleteTag)}
        danger
        title={
          pendingDeleteTag && pendingDeleteTag.usedInTemplates.length > 0
            ? 'Удаление используемого тега'
            : 'Удаление привязки тега'
        }
        description={
          pendingDeleteTag
            ? pendingDeleteTag.usedInTemplates.length > 0
              ? `Внимание: тег ${pendingDeleteTag.tag.name} используется в шаблонах документов (${pendingDeleteTag.usedInTemplates.length} шт.):\n• ${pendingDeleteTag.usedInTemplates
                  .map((t) => `${t.name}${t.isArchived ? ' (в архиве)' : ''}`)
                  .join('\n• ')}\n\nПосле удаления тега он перестанет подставляться в этих документах и будет отмечен как непривязанный. Всё равно удалить?`
              : `Удалить привязку тега ${pendingDeleteTag.tag.name} (вкладка «${pendingDeleteTag.tabName}», столбец «${pendingDeleteTag.colName}»)?`
            : ''
        }
        confirmLabel={
          pendingDeleteTag && pendingDeleteTag.usedInTemplates.length > 0
            ? 'Удалить тег'
            : 'Удалить'
        }
        cancelLabel="Отмена"
        onConfirm={confirmDeleteTag}
        onCancel={() => setPendingDeleteTag(null)}
      />

      <ConfirmDialog
        isOpen={pendingDiscardConfirm}
        danger
        title="Отменить несохранённые изменения?"
        description="В списке тегов есть несохранённые изменения. Закрыть окно без сохранения?"
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
