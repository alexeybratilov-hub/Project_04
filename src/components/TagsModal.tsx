import React, { useState, useEffect } from 'react';
import { X, Tag as TagIcon, Plus, Trash2, Copy, Check, AlertTriangle, Search } from 'lucide-react';
import { DocumentTemplate, Tab, Tag } from '../types/database';
import { createUniqueId, integrityService } from '../services/integrityService';
import { useToast } from './ui/ToastProvider';

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

  // Synchronize whenever modal opens or active LegalEntity's tags/tabs change
  useEffect(() => {
    if (isOpen) {
      setLocalTags(tags);
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
  }, [isOpen, tags, tabs]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

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
    onSaveTags(updated);
    setNewTagName('');
    setNewTagDesc('');
    showToast(`Тег ${formattedName} привязан к столбцу`, 'success');
  };

  const handleDeleteTag = (id: string) => {
    const updated = localTags.filter((t) => t.id !== id);
    setLocalTags(updated);
    onSaveTags(updated);
  };

  const filteredTags = localTags.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(search.toLowerCase()))
  );

  const selectedTabForAdd = tabs.find((t) => t.id === newTagTabId) || tabs[0];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400 rounded-lg">
              <TagIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Пул тегов шаблонизатора
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Привязка плейсхолдеров &#123;Имя_тега&#125; к колонкам активного юрлица
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Orphaned Tags Warning */}
          {orphanedTags.length > 0 && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl text-xs space-y-2">
              <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Непривязанные теги в шаблонах ({orphanedTags.length}):</span>
              </div>
              <p className="text-amber-700 dark:text-amber-400 leading-relaxed">
                Эти плейсхолдеры встречаются в шаблонах документов, но пока не привязаны к столбцу (системные теги организации распознаются автоматически):
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {orphanedTags.map((tName) => (
                  <button
                    key={tName}
                    type="button"
                    onClick={() => setNewTagName(tName)}
                    className="px-2 py-0.5 bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 rounded font-mono text-[11px] hover:bg-amber-100 transition-colors"
                  >
                    + {tName}
                  </button>
                ))}
              </div>
            </div>
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
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Имя тега (&#123;Имя&#125;):</label>
                <input
                  type="text"
                  placeholder="{Новый_тег}"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Вкладка-источник:</label>
                <select
                  value={newTagTabId}
                  onChange={(e) => {
                    setNewTagTabId(e.target.value);
                    const selected = tabs.find((t) => t.id === e.target.value);
                    setNewTagColId(selected?.columns[0]?.id || '');
                  }}
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100"
                >
                  {tabs.map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {tab.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Поле (столбец):</label>
                <select
                  value={newTagColId}
                  onChange={(e) => setNewTagColId(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100"
                >
                  {(selectedTabForAdd?.columns || []).map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Описание:</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Назначение тега"
                    value={newTagDesc}
                    onChange={(e) => setNewTagDesc(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={!newTagName.trim() || !newTagColId}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg font-medium shrink-0 transition-colors"
                    title="Добавить тег"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
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
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Фильтр по тегам..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100"
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
                              className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors"
                              title="Скопировать тег"
                            >
                              {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTag(tag.id)}
                              className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
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

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-slate-50/70 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 text-xs shrink-0">
          <span className="text-slate-500">
            Используйте теги прямо в шаблонах Word и PDF, например <code className="font-mono text-blue-600">&#123;ФИО&#125;</code>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};
