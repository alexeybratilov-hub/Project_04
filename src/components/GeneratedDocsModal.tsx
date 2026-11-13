import React, { useState, useMemo, useEffect } from 'react';
import {
  X, FolderOpen, FolderArchive, FileText, Download, Trash2,
  Search, ChevronDown, ChevronRight, Archive
} from 'lucide-react';
import { GeneratedDocRecord, LegalEntityProfile } from '../types/database';
import { DOCUMENT_CATEGORIES } from '../services/generatedDocsService';
import { localApiClient } from '../services/localApiClient';
import { portablePackageService } from '../services/portablePackageService';
import { useToast } from './ui/ToastProvider';

interface GeneratedDocsModalProps {
  isOpen: boolean;
  onClose: () => void;
  generatedDocs: GeneratedDocRecord[];
  entityProfile?: LegalEntityProfile;
  onArchiveDoc: (docId: string) => Promise<void> | void;
  onDeleteDoc: (docId: string) => Promise<void> | void;
  onOpenTemplates: () => void;
}

function parseDdMmYyyyScore(dateStr: string): number {
  const parts = String(dateStr || '').split('.');
  if (parts.length !== 3) return 0;
  const [dd, mm, yyyy] = parts.map((p) => Number(p) || 0);
  return yyyy * 10000 + mm * 100 + dd;
}

export const GeneratedDocsModal: React.FC<GeneratedDocsModalProps> = ({
  isOpen,
  onClose,
  generatedDocs,
  entityProfile,
  onArchiveDoc,
  onDeleteDoc,
  onOpenTemplates
}) => {
  const { showToast } = useToast();
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [formatFilter, setFormatFilter] = useState<'all' | 'docx' | 'pdf'>('all');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setConfirmDeleteId(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const categoriesList = useMemo(() => {
    const known = new Set<string>([...DOCUMENT_CATEGORIES]);
    generatedDocs.forEach((d) => {
      if (d.category) known.add(d.category);
    });
    return Array.from(known).map((cat) => {
      const catDocs = generatedDocs.filter((d) => d.category === cat);
      const activeCount = catDocs.filter((d) => !d.isArchived).length;
      const archiveCount = catDocs.filter((d) => d.isArchived).length;
      return { name: cat, activeCount, archiveCount, total: catDocs.length };
    });
  }, [generatedDocs]);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return generatedDocs.filter((doc) => {
      if (selectedCategory !== 'ALL' && doc.category !== selectedCategory) return false;
      if (formatFilter !== 'all' && doc.format !== formatFilter) return false;
      if (q) {
        const hay = `${doc.title} ${doc.fileName} ${doc.category} ${doc.dateFormatted} ${doc.rowIdentifier || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [generatedDocs, selectedCategory, formatFilter, searchQuery]);

  const activeDocs = useMemo(
    () => filteredDocs.filter((d) => !d.isArchived),
    [filteredDocs]
  );

  // Group archived docs by Category -> Date Folder (дд.мм.гггг)
  const archiveGroups = useMemo(() => {
    const archived = filteredDocs.filter((d) => d.isArchived);
    const byDateFolder = new Map<string, { category: string; dateFolder: string; docs: GeneratedDocRecord[] }>();

    archived.forEach((doc) => {
      const dateFolder = doc.archiveDateFolder || doc.dateFormatted;
      const key = `${doc.category}::${dateFolder}`;
      const existing = byDateFolder.get(key);
      if (existing) {
        existing.docs.push(doc);
      } else {
        byDateFolder.set(key, {
          category: doc.category,
          dateFolder,
          docs: [doc]
        });
      }
    });

    return Array.from(byDateFolder.values()).sort(
      (a, b) =>
        parseDdMmYyyyScore(b.dateFolder) - parseDdMmYyyyScore(a.dateFolder) ||
        a.category.localeCompare(b.category, 'ru')
    );
  }, [filteredDocs]);

  if (!isOpen) return null;

  const handleDownload = async (doc: GeneratedDocRecord) => {
    try {
      if (localApiClient.isNative()) {
        const blob = await localApiClient.downloadFileFromBucket('documents', doc.relativePath);
        portablePackageService.triggerBlobDownload(blob, doc.fileName);
        showToast(`Файл «${doc.fileName}» открыт из ./documents/${doc.relativePath}`, 'success');
        return;
      }

      if (doc.dataBase64) {
        const bin = atob(doc.dataBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
          bytes[i] = bin.charCodeAt(i);
        }
        const mime =
          doc.format === 'docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/pdf';
        portablePackageService.triggerBlobDownload(new Blob([bytes], { type: mime }), doc.fileName);
        showToast(`Файл «${doc.fileName}» скачан`, 'success');
        return;
      }

      showToast('Содержимое файла доступно только в папке ./documents/ на ПК (OT-Baza.exe)', 'warning');
    } catch (e: any) {
      showToast(e?.message || 'Не удалось скачать документ', 'error');
    }
  };

  const toggleFolder = (key: string) => {
    setCollapsedFolders((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const totalActive = generatedDocs.filter((d) => !d.isArchived).length;
  const totalArchived = generatedDocs.filter((d) => d.isArchived).length;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-6xl h-[88vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 shrink-0 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 rounded-lg shrink-0">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                Сгенерированные документы
                {entityProfile?.shortName ? ` · ${entityProfile.shortName}` : ''}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Структурированы по категориям · повторное имя файла автоматически переносит старую версию в АРХИВ/дд.мм.гггг
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenTemplates();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Шаблоны</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
              aria-label="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body: Two-Pane Layout */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Left Pane: Category Tree */}
          <aside className="md:col-span-4 lg:col-span-3 p-3 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/30 space-y-1 text-xs">
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Категории
            </div>

            <button
              type="button"
              onClick={() => setSelectedCategory('ALL')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                selectedCategory === 'ALL'
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800'
              }`}
            >
              <span className="truncate">Все категории</span>
              <span className="font-mono tabular-nums text-[11px] opacity-85 shrink-0 ml-2">
                {totalActive} / арх. {totalArchived}
              </span>
            </button>

            <div className="h-px bg-slate-200 dark:bg-slate-800 my-1.5" />

            {categoriesList.map((cat) => {
              const isSelected = selectedCategory === cat.name;
              return (
                <button
                  key={cat.name}
                  type="button"
                  onClick={() => setSelectedCategory(cat.name)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold border border-blue-200 dark:border-blue-800'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <FolderOpen className="w-3.5 h-3.5 shrink-0 opacity-75" />
                    <span className="truncate">{cat.name}</span>
                  </span>
                  <span className="font-mono tabular-nums text-[11px] text-slate-400 shrink-0 ml-2">
                    {cat.activeCount}
                    {cat.archiveCount > 0 ? `+${cat.archiveCount}` : ''}
                  </span>
                </button>
              );
            })}
          </aside>

          {/* Right Pane: Filters + Active Table + АРХИВ Folders */}
          <div className="md:col-span-8 lg:col-span-9 flex flex-col overflow-hidden">
            {/* Search & Filter Toolbar */}
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 shrink-0 text-xs">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск по названию, файлу, дате (дд.мм.гггг) или сотруднику..."
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                />
              </div>

              <div className="flex items-center gap-1.5">
                {(['all', 'docx', 'pdf'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setFormatFilter(fmt)}
                    className={`px-2.5 py-1 rounded border text-[11px] font-mono uppercase cursor-pointer transition-colors ${
                      formatFilter === fmt
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100 font-semibold'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {fmt === 'all' ? 'Все' : fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Documents Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs">
              {/* Active Documents Section */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-600" />
                    <span>
                      Актуальные документы{' '}
                      {selectedCategory !== 'ALL' ? `— «${selectedCategory}»` : ''}
                    </span>
                    <span className="font-mono tabular-nums text-slate-400">
                      ({activeDocs.length})
                    </span>
                  </h3>
                </div>

                {activeDocs.length === 0 ? (
                  <div className="p-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-center text-slate-400 space-y-2">
                    <p>
                      {generatedDocs.length === 0
                        ? 'В этой организации пока нет сохранённых сгенерированных документов.'
                        : 'По выбранному фильтру актуальных документов не найдено.'}
                    </p>
                    <p className="text-[11px]">
                      Сформируйте приказ, инструкцию или направление в формате Word (.docx) или PDF — документ автоматически появится здесь.
                    </p>
                  </div>
                ) : (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full border-collapse">
                      <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold text-left border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="px-3.5 py-2">Наименование документа / Файл</th>
                          <th className="px-3 py-2">Категория</th>
                          <th className="px-3 py-2">Дата</th>
                          <th className="px-3 py-2">Формат · Размер</th>
                          <th className="px-3 py-2 text-right">Действия</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                        {activeDocs.map((doc) => (
                          <tr
                            key={doc.id}
                            className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                          >
                            <td className="px-3.5 py-2.5 max-w-xs">
                              <div className="font-medium text-slate-900 dark:text-slate-100 truncate" title={doc.title}>
                                {doc.title}
                              </div>
                              <div className="font-mono text-[11px] text-slate-500 truncate" title={doc.relativePath}>
                                {doc.fileName}
                                {doc.rowIdentifier ? ` · ${doc.rowIdentifier}` : ''}
                              </div>
                            </td>
                            <td className="px-3.5 py-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                              {doc.category}
                            </td>
                            <td className="px-3.5 py-2.5 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                              {doc.dateFormatted}
                            </td>
                            <td className="px-3.5 py-2.5 font-mono tabular-nums text-[11px] text-slate-500 whitespace-nowrap uppercase">
                              {doc.format} · {doc.sizeFormatted}
                            </td>
                            <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                              {confirmDeleteId === doc.id ? (
                                <span className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void onDeleteDoc(doc.id);
                                      setConfirmDeleteId(null);
                                    }}
                                    className="px-2 py-1 bg-red-600 text-white rounded text-[11px] font-semibold cursor-pointer"
                                  >
                                    Удалить
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="px-2 py-1 bg-slate-200 dark:bg-slate-700 rounded text-[11px] cursor-pointer"
                                  >
                                    Отмена
                                  </button>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleDownload(doc)}
                                    className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded transition-colors cursor-pointer"
                                    title="Скачать документ"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void onArchiveDoc(doc.id)}
                                    className="p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50 rounded transition-colors cursor-pointer"
                                    title="Перенести в папку АРХИВ"
                                  >
                                    <Archive className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(doc.id)}
                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 rounded transition-colors cursor-pointer"
                                    title="Удалить"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Archive Section grouped by АРХИВ/<дд.мм.гггг> */}
              <section className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <FolderArchive className="w-4 h-4 text-amber-600" />
                    <span>Папка «АРХИВ» (предыдущие версии по датам дд.мм.гггг)</span>
                    <span className="font-mono tabular-nums text-slate-400">
                      ({archiveGroups.reduce((sum, g) => sum + g.docs.length, 0)})
                    </span>
                  </h3>
                </div>

                {archiveGroups.length === 0 ? (
                  <p className="text-[11px] text-slate-400 py-3">
                    В папке «АРХИВ» пока нет документов. Старые версии переносятся сюда автоматически при повторной генерации документа с тем же именем.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {archiveGroups.map((group) => {
                      const folderKey = `${group.category}::${group.dateFolder}`;
                      const isCollapsed = Boolean(collapsedFolders[folderKey]);

                      return (
                        <div
                          key={folderKey}
                          className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50/40 dark:bg-slate-800/20"
                        >
                          <button
                            type="button"
                            onClick={() => toggleFolder(folderKey)}
                            className="w-full px-3.5 py-2 flex items-center justify-between bg-slate-100/80 dark:bg-slate-800/70 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
                              {isCollapsed ? (
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                              )}
                              <FolderArchive className="w-3.5 h-3.5 text-amber-600" />
                              <span className="font-mono text-[11px]">
                                {group.category} / АРХИВ / {group.dateFolder}
                              </span>
                            </span>
                            <span className="font-mono tabular-nums text-[11px] text-slate-500">
                              Файлов: {group.docs.length}
                            </span>
                          </button>

                          {!isCollapsed && (
                            <div className="divide-y divide-slate-200/70 dark:divide-slate-800 bg-white dark:bg-slate-900">
                              {group.docs.map((doc) => (
                                <div
                                  key={doc.id}
                                  className="px-4 py-2 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                                >
                                  <div className="min-w-0">
                                    <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                                      {doc.title}
                                    </div>
                                    <div className="font-mono text-[11px] text-slate-500 truncate">
                                      {doc.fileName} · создан {doc.dateFormatted} · {doc.format.toUpperCase()} · {doc.sizeFormatted}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handleDownload(doc)}
                                      className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded transition-colors cursor-pointer"
                                      title="Скачать архивную версию"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void onDeleteDoc(doc.id)}
                                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 rounded transition-colors cursor-pointer"
                                      title="Удалить из архива"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
