import React, { useState } from 'react';
import { X, Tag as TagIcon, Plus, Trash2, Copy, Check, AlertTriangle, Search, Info } from 'lucide-react';
import { DocumentTemplate, Tab, Tag } from '../types/database';

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
  const [localTags, setLocalTags] = useState<Tag[]>(tags);
  const [copiedTagId, setCopiedTagId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagTabId, setNewTagTabId] = useState(tabs[0]?.id || '');
  const [newTagColId, setNewTagColId] = useState(tabs[0]?.columns[0]?.id || '');
  const [newTagDesc, setNewTagDesc] = useState('');

  if (!isOpen) return null;

  // Find orphaned tags in templates
  const templateTags = new Set<string>();
  templates.forEach((tpl) => {
    const matches = tpl.contentTemplate.match(/\{[A-Za-zА-Яа-я0-9_]+\}/g) || [];
    matches.forEach((m) => templateTags.add(m));
  });

  const boundTagNames = new Set(localTags.map((t) => t.name));
  const orphanedTags: string[] = [];
  templateTags.forEach((tName) => {
    if (!boundTagNames.has(tName) && tName !== '{id}') {
      orphanedTags.push(tName);
    }
  });

  const handleCopy = (tagName: string, tagId: string) => {
    navigator.clipboard.writeText(tagName);
    setCopiedTagId(tagId);
    setTimeout(() => setCopiedTagId(null), 1500);
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;

    let formattedName = newTagName.trim();
    if (!formattedName.startsWith('{')) formattedName = '{' + formattedName;
    if (!formattedName.endsWith('}')) formattedName = formattedName + '}';

    const newTag: Tag = {
      id: `tag_${Date.now()}`,
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
  };

  const handleDeleteTag = (id: string) => {
    const updated = localTags.filter((t) => t.id !== id);
    setLocalTags(updated);
    onSaveTags(updated);
  };

  const filteredTags = localTags.filter((t) => 
    t.name.toLowerCase().includes(search.toLowerCase()) || 
    (t.description && t.description.toLowerCase().includes(search.toLowerCase()))
  );

  const selectedTabForAdd = tabs.find((t) => t.id === newTagTabId) || tabs[0];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400 rounded-lg">
              <TagIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Общий пул тегов шаблонизатора
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Привязка плейсхолдеров &#123;Имя_тега&#125; к колонкам базы для генерации приказов и инструкций
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
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
                <span>Обнаружены «осиротевшие» теги в шаблонах Word ({orphanedTags.length}):</span>
              </div>
              <p className="text-amber-700 dark:text-amber-400 leading-relaxed">
                Эти теги используются в текстах шаблонов документов, но еще не привязаны ни к одному столбцу базы:
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {orphanedTags.map((tName) => (
                  <button
                    key={tName}
                    onClick={() => setNewTagName(tName)}
                    className="px-2 py-0.5 bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 rounded font-mono text-[11px] hover:bg-amber-100 transition-colors"
                    title="Нажмите, чтобы создать привязку для этого тега"
                  >
                    + {tName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Add New Tag Form */}
          <form onSubmit={handleAddTag} className="p-4 bg-slate-50/70 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Создать новую привязку тега:
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Имя тега (формат &#123;Имя&#125;):</label>
                <input
                  type="text"
                  placeholder="{Новый_тег}"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Вкладка-источник:</label>
                <select
                  value={newTagTabId}
                  onChange={(e) => {
                    setNewTagTabId(e.target.value);
                    const selected = tabs.find((t) => t.id === e.target.value);
                    if (selected && selected.columns[0]) {
                      setNewTagColId(selected.columns[0].id);
                    }
                  }}
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
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
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                >
                  {selectedTabForAdd?.columns.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Описание (необязательно):</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Назначение тега"
                    value={newTagDesc}
                    onChange={(e) => setNewTagDesc(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shrink-0 shadow-xs transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </form>

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
                  className="w-full pl-8 pr-3 py-1 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
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

                    return (
                      <tr key={tag.id} className="hover:bg-slate-50 dark:hover:bg-slate-850/60 transition-colors">
                        <td className="px-4 py-2 border-r border-slate-200/60 dark:border-slate-800 font-mono font-medium text-blue-600 dark:text-blue-400 select-all">
                          {tag.name}
                        </td>
                        <td className="px-4 py-2 border-r border-slate-200/60 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                          {tab?.name || '—'}
                        </td>
                        <td className="px-4 py-2 border-r border-slate-200/60 dark:border-slate-800 font-medium text-slate-800 dark:text-slate-200">
                          {col?.name || '—'}
                        </td>
                        <td className="px-4 py-2 border-r border-slate-200/60 dark:border-slate-800 text-slate-500 text-[11px]">
                          {tag.description || '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleCopy(tag.name, tag.id)}
                              className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors"
                              title="Скопировать тег в буфер обмена"
                            >
                              {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                            <button
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
        <div className="flex items-center justify-between px-6 py-3.5 bg-slate-50/60 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 text-xs">
          <span className="text-slate-500">
            Используйте эти теги в файлах Word: просто вставьте их в текст, например <code className="font-mono text-blue-600">&#123;ФИО&#125;</code>
          </span>
          <button
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
