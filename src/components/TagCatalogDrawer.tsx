import React, { useMemo, useState } from 'react';
import { BookOpen, Check, Copy, Plus, Search, X } from 'lucide-react';
import { LegalEntityProfile, Row, Tab, Tag } from '../types/database';
import { docxTemplateService } from '../services/docxTemplateService';
import { AppInput, useToast } from './ui';

interface TagCatalogDrawerProps {
  targetTab: Tab;
  allTabs: Tab[];
  tags: Tag[];
  entityProfile?: LegalEntityProfile;
  sampleRow?: Row;
  canInsertIntoText?: boolean;
  onInsertTag?: (tagName: string) => void;
  onClose: () => void;
}

async function copyTextSafe(value: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

export const TagCatalogDrawer: React.FC<TagCatalogDrawerProps> = ({
  targetTab,
  allTabs,
  tags,
  entityProfile,
  sampleRow,
  canInsertIntoText = false,
  onInsertTag,
  onClose
}) => {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  const sections = useMemo(
    () => docxTemplateService.buildTagCatalog(targetTab, allTabs, tags, entityProfile, sampleRow),
    [targetTab, allTabs, tags, entityProfile, sampleRow]
  );

  const filteredSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;
    return sections
      .map((sec) => ({
        ...sec,
        items: sec.items.filter(
          (item) =>
            item.tag.toLowerCase().includes(q) ||
            item.label.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            item.sourceInfo.toLowerCase().includes(q) ||
            item.exampleValue.toLowerCase().includes(q)
        )
      }))
      .filter((sec) => sec.items.length > 0);
  }, [sections, search]);

  const handleCopy = async (tagValue: string) => {
    const ok = await copyTextSafe(tagValue);
    setCopiedTag(tagValue);
    setTimeout(() => {
      setCopiedTag((prev) => (prev === tagValue ? null : prev));
    }, 1500);
    if (ok) {
      showToast(`Тег ${tagValue} скопирован в буфер обмена`, 'info');
    } else {
      showToast(`Скопируйте тег вручную: ${tagValue}`, 'warning');
    }
  };

  return (
    <div
      data-testid="tag-catalog-panel"
      className="flex flex-col h-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-indigo-600 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
              Каталог доступных тегов для Word (.docx) и текстовых шаблонов
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              Скопируйте тег в 1 клик и вставьте в документ Word в виде <code className="font-mono">&#123;Имя_тега&#125;</code>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="close-tag-catalog"
          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded cursor-pointer"
          title="Закрыть каталог тегов"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <AppInput
            type="text"
            compact
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск тега, поля, описания или примера значения..."
            className="pl-8"
          />
        </div>
      </div>

      {/* Categorized Sections */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
        {filteredSections.length === 0 ? (
          <div className="p-6 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
            По запросу «{search}» теги не найдены.
          </div>
        ) : (
          filteredSections.map((sec) => (
            <div key={sec.id} className="space-y-1.5">
              <div className="px-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                  {sec.title}{' '}
                  <span className="font-mono text-[11px] text-slate-400">({sec.items.length})</span>
                </div>
                <div className="text-[11px] text-slate-500">{sec.description}</div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
                {sec.items.map((item) => {
                  const isCopied = copiedTag === item.tag;
                  return (
                    <div
                      key={`${sec.id}-${item.tag}`}
                      data-testid="tag-catalog-item"
                      className="p-2.5 flex items-start justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 font-mono text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 break-all">
                            {item.tag}
                          </code>
                          <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                            {item.label}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {item.description} · <span className="text-slate-400">{item.sourceInfo}</span>
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                          Пример: <span className="font-medium text-slate-800 dark:text-slate-200">{item.exampleValue}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {canInsertIntoText && onInsertTag && (
                          <button
                            type="button"
                            onClick={() => onInsertTag(item.tag)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-[11px] font-medium cursor-pointer"
                            title="Вставить в текст шаблона"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Вставить</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleCopy(item.tag)}
                          data-testid={`copy-tag-${item.tag}`}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium transition-colors cursor-pointer ${
                            isCopied
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                              : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                          }`}
                          title="Скопировать тег в буфер обмена"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3 h-3" />
                              <span>Скопировано</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Копировать</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
