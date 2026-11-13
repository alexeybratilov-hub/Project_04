import React, { useState, useEffect, useMemo } from 'react';
import {
  X, FileText, Download, BookOpen, Eye, FileDown, RefreshCw,
  Plus, FolderOpen, FolderArchive, Edit2, Trash2, ArchiveRestore, Table2, Check
} from 'lucide-react';
import { DocumentTemplate, LegalEntityProfile, Tab, Tag } from '../types/database';
import { documentGenerator } from '../services/documentGenerator';
import { DOCUMENT_CATEGORIES, inferDocumentCategory } from '../services/generatedDocsService';
import { RecordGeneratedDocPayload } from './LLMStudioModal';
import { createUniqueId } from '../services/integrityService';
import { useToast } from './ui/ToastProvider';

export type TemplatesModalScope = 'tab' | 'all' | 'archive';

interface TemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialScope?: TemplatesModalScope;
  templates: DocumentTemplate[];
  currentTab: Tab;
  allTabs: Tab[];
  tags: Tag[];
  entityProfile?: LegalEntityProfile;
  selectedRowIds?: string[];
  onOpenTagsModal: () => void;
  onSaveTemplates: (templates: DocumentTemplate[]) => void;
  onRecordGeneratedDoc?: (payload: RecordGeneratedDocPayload) => Promise<void> | void;
}

export const TemplatesModal: React.FC<TemplatesModalProps> = ({
  isOpen,
  onClose,
  initialScope = 'tab',
  templates,
  currentTab,
  allTabs,
  tags,
  entityProfile,
  selectedRowIds,
  onOpenTagsModal,
  onSaveTemplates,
  onRecordGeneratedDoc
}) => {
  const { showToast } = useToast();
  const [scope, setScope] = useState<TemplatesModalScope>(initialScope);
  const [selectedSection, setSelectedSection] = useState<string>('ALL');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [targetRowId, setTargetRowId] = useState<string>('');
  const [isBatchMode, setIsBatchMode] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Create / Edit template form state
  const [editorMode, setEditorMode] = useState<'none' | 'create' | 'edit'>('none');
  const [draftName, setDraftName] = useState('');
  const [draftTabId, setDraftTabId] = useState(currentTab.id);
  const [draftCategory, setDraftCategory] = useState<string>(DOCUMENT_CATEGORIES[0]);
  const [draftNaming, setDraftNaming] = useState('{ФИО}_документ_2026.docx');
  const [draftContent, setDraftContent] = useState('');

  // Reset scope and active template when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setScope(initialScope);
    setSelectedSection('ALL');
    setEditorMode('none');
    setConfirmDeleteId(null);

    const activeTemplates = templates.filter((t) => !t.isArchived);
    const preferred =
      initialScope === 'tab'
        ? activeTemplates.find((t) => t.tabId === currentTab.id)
        : initialScope === 'archive'
          ? templates.find((t) => t.isArchived)
          : activeTemplates.find((t) => t.tabId === currentTab.id) || activeTemplates[0];

    setSelectedTemplateId(preferred?.id || '');
    setIsBatchMode(Boolean(selectedRowIds && selectedRowIds.length > 1));
  }, [isOpen, initialScope, currentTab.id]);

  // Esc closes modal
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editorMode !== 'none') setEditorMode('none');
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, editorMode]);

  const getTemplateCategory = (tpl: DocumentTemplate): string => {
    if (tpl.category && tpl.category.trim()) return tpl.category;
    const boundTab = allTabs.find((t) => t.id === tpl.tabId);
    return inferDocumentCategory(tpl.name, boundTab?.name || tpl.archivedFromTabName);
  };

  const tabActiveTemplates = useMemo(
    () => templates.filter((t) => !t.isArchived && t.tabId === currentTab.id),
    [templates, currentTab.id]
  );

  const allActiveTemplates = useMemo(
    () => templates.filter((t) => !t.isArchived),
    [templates]
  );

  const archivedTemplates = useMemo(
    () => templates.filter((t) => Boolean(t.isArchived)),
    [templates]
  );

  const sectionsSummary = useMemo(() => {
    const known = new Set<string>([...DOCUMENT_CATEGORIES]);
    allActiveTemplates.forEach((tpl) => known.add(getTemplateCategory(tpl)));
    return Array.from(known).map((sectionName) => {
      const items = allActiveTemplates.filter((t) => getTemplateCategory(t) === sectionName);
      return { name: sectionName, items };
    });
  }, [allActiveTemplates, allTabs]);

  const visibleTemplates = useMemo(() => {
    if (scope === 'tab') return tabActiveTemplates;
    if (scope === 'archive') return archivedTemplates;
    if (selectedSection === 'ALL') return allActiveTemplates;
    return allActiveTemplates.filter((t) => getTemplateCategory(t) === selectedSection);
  }, [scope, selectedSection, tabActiveTemplates, allActiveTemplates, archivedTemplates, allTabs]);

  const currentTemplate =
    visibleTemplates.find((t) => t.id === selectedTemplateId) ||
    templates.find((t) => t.id === selectedTemplateId && visibleTemplates.some((v) => v.id === t.id)) ||
    visibleTemplates[0];

  // Bound table for the currently selected template
  const boundTab: Tab =
    (currentTemplate ? allTabs.find((t) => t.id === currentTemplate.tabId) : undefined) ||
    currentTab;

  // Sync targetRowId cleanly whenever boundTab or selectedRowIds changes
  useEffect(() => {
    if (!isOpen) return;
    if (
      boundTab.id === currentTab.id &&
      selectedRowIds &&
      selectedRowIds.length > 0 &&
      boundTab.rows.some((r) => r.id === selectedRowIds[0])
    ) {
      setTargetRowId(selectedRowIds[0]);
      return;
    }
    if (!boundTab.rows.some((r) => r.id === targetRowId)) {
      setTargetRowId(boundTab.rows[0]?.id || '');
    }
  }, [isOpen, boundTab.id, boundTab.rows, currentTab.id, selectedRowIds, targetRowId]);

  if (!isOpen) return null;

  const targetRow = boundTab.rows.find((r) => r.id === targetRowId) || boundTab.rows[0];
  const currentCategory = currentTemplate
    ? getTemplateCategory(currentTemplate)
    : inferDocumentCategory('', boundTab.name);

  const previewText =
    currentTemplate && targetRow
      ? documentGenerator.resolveTemplateTags(
          currentTemplate.contentTemplate,
          targetRow,
          boundTab,
          allTabs,
          tags,
          entityProfile
        )
      : currentTemplate
        ? currentTemplate.contentTemplate
        : scope === 'tab'
          ? `К таблице «${currentTab.name}» пока не привязано ни одного шаблона. Нажмите «+ Новый шаблон», чтобы создать шаблон для этой таблицы.`
          : 'Выберите шаблон из списка слева для просмотра, редактирования или формирования документа.';

  const previewFileNameDocx =
    currentTemplate && targetRow
      ? documentGenerator.resolveFileName(
          currentTemplate.namingPattern,
          targetRow,
          boundTab,
          allTabs,
          tags,
          'docx',
          entityProfile
        )
      : currentTemplate?.fileName || 'document.docx';

  const previewFileNamePdf =
    currentTemplate && targetRow
      ? documentGenerator.resolveFileName(
          currentTemplate.namingPattern,
          targetRow,
          boundTab,
          allTabs,
          tags,
          'pdf',
          entityProfile
        )
      : (currentTemplate?.fileName || 'document').replace(/\.docx$/i, '') + '.pdf';

  const getRowLabel = (r: any, tabRef: Tab) => {
    const firstColVal = tabRef.columns[0] ? r[tabRef.columns[0].id] : '';
    const secondColVal = tabRef.columns[1] ? r[tabRef.columns[1].id] : '';
    return String(
      r.emp_fio || r.pos_title || r.fac_name || r.med_worker || r.siz_item || secondColVal || firstColVal || r.id || ''
    );
  };

  const openCreateForm = () => {
    setEditorMode('create');
    setDraftName('');
    setDraftTabId(currentTab.id);
    setDraftCategory(inferDocumentCategory('', currentTab.name));
    setDraftNaming('{ФИО}_документ_2026.docx');
    setDraftContent('');
  };

  const openEditForm = (tpl: DocumentTemplate) => {
    setEditorMode('edit');
    setSelectedTemplateId(tpl.id);
    setDraftName(tpl.name);
    setDraftTabId(tpl.tabId || currentTab.id);
    setDraftCategory(getTemplateCategory(tpl));
    setDraftNaming(tpl.namingPattern);
    setDraftContent(tpl.contentTemplate);
  };

  const handleSaveEditor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftName.trim() || !draftContent.trim()) return;

    if (editorMode === 'create') {
      const targetTabObj = allTabs.find((t) => t.id === draftTabId) || currentTab;
      const newTpl: DocumentTemplate = {
        id: createUniqueId('tpl'),
        name: draftName.trim(),
        tabId: targetTabObj.id,
        category: draftCategory || inferDocumentCategory(draftName, targetTabObj.name),
        fileName: `${draftName.trim()}.docx`,
        namingPattern: draftNaming.trim() || '{ФИО}_документ.docx',
        contentTemplate: draftContent.trim()
      };
      onSaveTemplates([...templates, newTpl]);
      setSelectedTemplateId(newTpl.id);
      if (scope === 'archive') setScope(newTpl.tabId === currentTab.id ? 'tab' : 'all');
      setEditorMode('none');
      showToast(`Шаблон «${newTpl.name}» добавлен для таблицы «${targetTabObj.name}»`, 'success');
    } else if (editorMode === 'edit' && currentTemplate) {
      const targetTabObj = allTabs.find((t) => t.id === draftTabId) || currentTab;
      const updated = templates.map((t) =>
        t.id === currentTemplate.id
          ? {
              ...t,
              name: draftName.trim(),
              tabId: targetTabObj.id,
              category: draftCategory || inferDocumentCategory(draftName, targetTabObj.name),
              namingPattern: draftNaming.trim() || t.namingPattern,
              contentTemplate: draftContent.trim(),
              isArchived: false,
              archivedAt: undefined,
              archivedFromTabName: undefined
            }
          : t
      );
      onSaveTemplates(updated);
      setEditorMode('none');
      showToast(`Шаблон «${draftName.trim()}» сохранён`, 'success');
    }
  };

  const handleRestoreArchived = (tpl: DocumentTemplate) => {
    const targetTabId = currentTab.id;
    const updated = templates.map((t) =>
      t.id === tpl.id
        ? {
            ...t,
            tabId: targetTabId,
            isArchived: false,
            archivedAt: undefined,
            archivedFromTabName: undefined
          }
        : t
    );
    onSaveTemplates(updated);
    setScope('tab');
    setSelectedTemplateId(tpl.id);
    showToast(`Шаблон «${tpl.name}» восстановлен и привязан к вкладке «${currentTab.name}»`, 'success');
  };

  const handleDeleteTemplate = (tplId: string) => {
    const next = templates.filter((t) => t.id !== tplId);
    onSaveTemplates(next);
    setConfirmDeleteId(null);
    if (selectedTemplateId === tplId) {
      const fallback = next.find((t) => !t.isArchived && t.tabId === currentTab.id) || next[0];
      setSelectedTemplateId(fallback?.id || '');
    }
    showToast('Шаблон удалён', 'info');
  };

  const handleGenerateSingle = async (format: 'docx' | 'pdf') => {
    if (!currentTemplate || !targetRow) return;
    setIsGenerating(true);
    try {
      const fileName = format === 'docx' ? previewFileNameDocx : previewFileNamePdf;
      const blob =
        format === 'docx'
          ? await documentGenerator.generateDocx(currentTemplate.name, previewText)
          : await documentGenerator.generatePdf(currentTemplate.name, previewText);

      if (onRecordGeneratedDoc) {
        await onRecordGeneratedDoc({
          title: currentTemplate.name,
          fileName,
          category: currentCategory,
          format,
          blob,
          sourceTabName: boundTab.name,
          rowIdentifier: getRowLabel(targetRow, boundTab)
        });
        showToast(`Файл «${fileName}» сохранён в раздел «${currentCategory}»`, 'success');
      } else {
        const { savedToDisk } = await documentGenerator.saveAndDownloadBlob(blob, fileName, true);
        showToast(
          savedToDisk ? `Файл «${fileName}» сохранён и открыт` : `Файл «${fileName}» сформирован`,
          'success'
        );
      }
    } catch (e: any) {
      showToast(`Ошибка формирования ${format.toUpperCase()}: ${e?.message || 'неизвестная ошибка'}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleBatchGenerate = async (format: 'docx' | 'pdf') => {
    if (!currentTemplate) return;
    const rowsToProcess =
      boundTab.id === currentTab.id && selectedRowIds && selectedRowIds.length > 0
        ? boundTab.rows.filter((r) => selectedRowIds.includes(r.id))
        : boundTab.rows;

    if (rowsToProcess.length === 0) {
      showToast(`В таблице «${boundTab.name}» пока нет строк для пакетного формирования`, 'warning');
      return;
    }

    setIsGenerating(true);
    try {
      for (const row of rowsToProcess) {
        const resolvedText = documentGenerator.resolveTemplateTags(
          currentTemplate.contentTemplate,
          row,
          boundTab,
          allTabs,
          tags,
          entityProfile
        );
        const fileName = documentGenerator.resolveFileName(
          currentTemplate.namingPattern,
          row,
          boundTab,
          allTabs,
          tags,
          format,
          entityProfile
        );

        const blob =
          format === 'docx'
            ? await documentGenerator.generateDocx(currentTemplate.name, resolvedText)
            : await documentGenerator.generatePdf(currentTemplate.name, resolvedText);

        if (onRecordGeneratedDoc) {
          await onRecordGeneratedDoc({
            title: currentTemplate.name,
            fileName,
            category: currentCategory,
            format,
            blob,
            sourceTabName: boundTab.name,
            rowIdentifier: getRowLabel(row, boundTab)
          });
        } else {
          await documentGenerator.saveAndDownloadBlob(blob, fileName, true);
        }
        await new Promise((res) => setTimeout(res, 200));
      }
      showToast(
        `Сформировано документов: ${rowsToProcess.length} (${format.toUpperCase()}) в раздел «${currentCategory}»`,
        'success'
      );
    } catch (e: any) {
      showToast(`Ошибка пакетного формирования: ${e?.message || 'неизвестная ошибка'}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const availableTagsForDraftTab = tags.filter((t) => t.tabId === draftTabId);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-6xl h-[90vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 rounded-lg shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                Шаблоны документов
                {entityProfile?.shortName ? ` · ${entityProfile.shortName}` : ''}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                У каждой таблицы свой набор шаблонов · прямая подстановка тегов работает автономно (DOCX и PDF)
              </p>
            </div>
          </div>

          {/* View Scope Switcher */}
          <div className="flex items-center gap-1.5 bg-slate-200/70 dark:bg-slate-800 p-1 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => {
                setScope('tab');
                setEditorMode('none');
              }}
              className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                scope === 'tab'
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Вкладка «{currentTab.name}» <span className="font-mono tabular-nums opacity-75">({tabActiveTemplates.length})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setScope('all');
                setEditorMode('none');
              }}
              className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                scope === 'all'
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Все по разделам <span className="font-mono tabular-nums opacity-75">({allActiveTemplates.length})</span>
            </button>
            {archivedTemplates.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setScope('archive');
                  setEditorMode('none');
                }}
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                  scope === 'archive'
                    ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <FolderArchive className="w-3.5 h-3.5" />
                <span>Архив <span className="font-mono tabular-nums">({archivedTemplates.length})</span></span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={openCreateForm}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Новый шаблон</span>
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

        {/* Main Body */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Left Pane: Sections (when in 'all') OR Tab/Archive Template List */}
          <div className="md:col-span-5 flex flex-col overflow-hidden bg-slate-50/40 dark:bg-slate-950/30">
            {/* Section selector tabs when viewing all templates */}
            {scope === 'all' && (
              <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5 shrink-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Разделы шаблонов
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedSection('ALL')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
                      selectedSection === 'ALL'
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    Все разделы ({allActiveTemplates.length})
                  </button>
                  {sectionsSummary.map((sec) => (
                    <button
                      key={sec.name}
                      type="button"
                      onClick={() => setSelectedSection(sec.name)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
                        selectedSection === sec.name
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {sec.name} ({sec.items.length})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Template List (grouped by section when 'all' + 'ALL', or flat list for specific tab/section/archive) */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
              {visibleTemplates.length === 0 ? (
                <div className="p-6 text-center text-slate-400 space-y-3 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900">
                  <FolderOpen className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
                  <div className="space-y-1">
                    <p className="font-medium text-slate-600 dark:text-slate-300">
                      {scope === 'tab'
                        ? `Во вкладке «${currentTab.name}» пока нет шаблонов`
                        : scope === 'archive'
                          ? 'Архив шаблонов пуст'
                          : 'В этом разделе пока нет шаблонов'}
                    </p>
                    <p className="text-[11px]">
                      У каждой таблицы свой набор шаблонов для приказов, протоколов и карточек.
                    </p>
                  </div>
                  {scope !== 'archive' && (
                    <button
                      type="button"
                      onClick={openCreateForm}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Создать шаблон для «{currentTab.name}»</span>
                    </button>
                  )}
                </div>
              ) : scope === 'all' && selectedSection === 'ALL' ? (
                sectionsSummary
                  .filter((sec) => sec.items.length > 0)
                  .map((sec) => (
                    <div key={sec.name} className="space-y-1.5">
                      <div className="px-2 pt-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
                          {sec.name}
                        </span>
                        <span className="font-mono tabular-nums">{sec.items.length}</span>
                      </div>
                      <div className="space-y-1">
                        {sec.items.map((tpl) => {
                          const tTab = allTabs.find((t) => t.id === tpl.tabId);
                          const isSelected = currentTemplate?.id === tpl.id && editorMode === 'none';
                          return (
                            <div
                              key={tpl.id}
                              onClick={() => {
                                setEditorMode('none');
                                setSelectedTemplateId(tpl.id);
                              }}
                              className={`p-2.5 rounded-lg border cursor-pointer transition-colors ${
                                isSelected
                                  ? 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-300 dark:border-blue-700'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                                  {tpl.name}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openEditForm(tpl);
                                    }}
                                    className="p-1 text-slate-400 hover:text-blue-600 rounded"
                                    title="Редактировать шаблон"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmDeleteId(tpl.id);
                                    }}
                                    className="p-1 text-slate-400 hover:text-red-600 rounded"
                                    title="Удалить шаблон"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                                <span className="flex items-center gap-1 truncate">
                                  <Table2 className="w-3 h-3 shrink-0" />
                                  Таблица: <strong className="text-slate-700 dark:text-slate-300">{tTab?.name || 'Не привязана'}</strong>
                                </span>
                                <span className="font-mono truncate max-w-[140px] opacity-75">
                                  {tpl.namingPattern}
                                </span>
                              </div>
                              {confirmDeleteId === tpl.id && (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-2 pt-2 border-t border-red-200 dark:border-red-900 flex items-center justify-between text-[11px]"
                                >
                                  <span className="text-red-700 dark:text-red-300 font-medium">Удалить шаблон?</span>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteTemplate(tpl.id)}
                                      className="px-2 py-0.5 bg-red-600 text-white rounded font-semibold"
                                    >
                                      Удалить
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteId(null)}
                                      className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded"
                                    >
                                      Отмена
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
              ) : (
                <div className="space-y-1.5">
                  {visibleTemplates.map((tpl) => {
                    const tTab = allTabs.find((t) => t.id === tpl.tabId);
                    const isSelected = currentTemplate?.id === tpl.id && editorMode === 'none';
                    return (
                      <div
                        key={tpl.id}
                        onClick={() => {
                          setEditorMode('none');
                          setSelectedTemplateId(tpl.id);
                        }}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-300 dark:border-blue-700'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                            {tpl.name}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {tpl.isArchived ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRestoreArchived(tpl);
                                }}
                                className="flex items-center gap-1 px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-medium"
                                title={`Восстановить во вкладку «${currentTab.name}»`}
                              >
                                <ArchiveRestore className="w-3 h-3" />
                                <span>Восстановить</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditForm(tpl);
                                }}
                                className="p-1 text-slate-400 hover:text-blue-600 rounded"
                                title="Редактировать"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(tpl.id);
                              }}
                              className="p-1 text-slate-400 hover:text-red-600 rounded"
                              title="Удалить"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                          <span>
                            {tpl.isArchived
                              ? `Архив из «${tpl.archivedFromTabName || 'удалённой таблицы'}»`
                              : `Раздел: ${getTemplateCategory(tpl)}`}
                          </span>
                          <span className="font-mono truncate max-w-[160px] opacity-75">
                            {tTab ? tTab.name : tpl.namingPattern}
                          </span>
                        </div>

                        {confirmDeleteId === tpl.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="mt-2 pt-2 border-t border-red-200 dark:border-red-900 flex items-center justify-between text-[11px]"
                          >
                            <span className="text-red-700 dark:text-red-300 font-medium">Удалить шаблон?</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleDeleteTemplate(tpl.id)}
                                className="px-2 py-0.5 bg-red-600 text-white rounded font-semibold"
                              >
                                Удалить
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded"
                              >
                                Отмена
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bottom shortcut to Tags Dictionary */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between text-xs shrink-0">
              <div className="text-slate-600 dark:text-slate-300">
                Справочник тегов <span className="font-mono text-slate-400">({tags.length})</span>
              </div>
              <button
                type="button"
                onClick={onOpenTagsModal}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-md font-medium cursor-pointer"
              >
                <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                <span>Открыть теги</span>
              </button>
            </div>
          </div>

          {/* Right Pane: Create/Edit Form OR Live Template Preview & Document Export */}
          <div className="md:col-span-7 flex flex-col bg-slate-50/50 dark:bg-slate-950/40 overflow-hidden">
            {editorMode !== 'none' ? (
              <form onSubmit={handleSaveEditor} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {editorMode === 'create' ? 'Создание нового шаблона' : 'Редактирование шаблона'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setEditorMode('none')}
                    className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-medium cursor-pointer"
                  >
                    Отмена
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Название шаблона *
                    </label>
                    <input
                      type="text"
                      required
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder="Например: Приказ о проведении обучения"
                      className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Раздел документов
                    </label>
                    <select
                      value={draftCategory}
                      onChange={(e) => setDraftCategory(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
                    >
                      {DOCUMENT_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Привязанная таблица
                    </label>
                    <select
                      value={draftTabId}
                      onChange={(e) => setDraftTabId(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
                    >
                      {allTabs.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Шаблон имени файла
                    </label>
                    <input
                      type="text"
                      value={draftNaming}
                      onChange={(e) => setDraftNaming(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono"
                    />
                  </div>
                </div>

                {availableTagsForDraftTab.length > 0 && (
                  <div>
                    <div className="text-[11px] text-slate-500 mb-1">
                      Быстрая вставка тега этой таблицы:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {availableTagsForDraftTab.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setDraftContent((c) => `${c}${c && !c.endsWith(' ') && !c.endsWith('\n') ? ' ' : ''}${t.name}`)}
                          className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-slate-200 dark:border-slate-700 rounded font-mono text-[11px] cursor-pointer"
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex-1">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Текст шаблона с тегами &#123;...&#125; *
                  </label>
                  <textarea
                    required
                    rows={12}
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    placeholder="Введите текст приказа, инструкции или направления с тегами {Организация}, {ФИО}, {Должность}..."
                    className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-xs leading-relaxed"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setEditorMode('none')}
                    className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg font-medium"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>Сохранить шаблон</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex-1 flex flex-col p-5 overflow-hidden space-y-3 text-xs">
                {/* Preview Controls */}
                {currentTemplate && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shrink-0">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Строка таблицы «{boundTab.name}»:
                      </label>
                      {boundTab.rows.length > 0 ? (
                        <select
                          value={targetRowId}
                          onChange={(e) => setTargetRowId(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                        >
                          {boundTab.rows.map((row, idx) => (
                            <option key={row.id} value={row.id}>
                              #{idx + 1}: {getRowLabel(row, boundTab)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="px-2.5 py-1.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-[11px] text-amber-800 dark:text-amber-300">
                          В таблице «{boundTab.name}» пока нет строк
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col justify-between">
                      <label className="flex items-center justify-between gap-2 text-[11px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                        <span>Пакетное формирование по строкам</span>
                        <input
                          type="checkbox"
                          checked={isBatchMode}
                          onChange={(e) => setIsBatchMode(e.target.checked)}
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                        />
                      </label>
                      <div className="text-[11px] text-slate-500 truncate">
                        {isBatchMode
                          ? boundTab.id === currentTab.id && selectedRowIds && selectedRowIds.length > 0
                            ? `Выбрано строк: ${selectedRowIds.length}`
                            : `Все строки таблицы: ${boundTab.rows.length}`
                          : `Раздел сохранения: ${currentCategory}`}
                      </div>
                    </div>
                  </div>
                )}

                {/* Preview Header */}
                <div className="flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-slate-400" />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {currentTemplate ? currentTemplate.name : 'Предпросмотр шаблона'}
                    </span>
                  </div>
                  {currentTemplate && (
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-xs">
                      {previewFileNameDocx}
                    </span>
                  )}
                </div>

                {/* Preview Body */}
                <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 font-serif text-slate-800 dark:text-slate-200 text-xs leading-relaxed whitespace-pre-wrap select-text">
                  {previewText}
                </div>

                {/* Export Actions */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
                  <span className="text-[11px] text-slate-400">
                    Форматы: <strong className="text-slate-700 dark:text-slate-300">Word (.docx)</strong> и{' '}
                    <strong className="text-slate-700 dark:text-slate-300">PDF (Кириллица)</strong>
                  </span>

                  {currentTemplate && !currentTemplate.isArchived && (
                    <div className="flex items-center gap-2">
                      {isBatchMode ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleBatchGenerate('docx')}
                            disabled={isGenerating || boundTab.rows.length === 0}
                            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                          >
                            {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                            <span>Пакет .DOCX</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBatchGenerate('pdf')}
                            disabled={isGenerating || boundTab.rows.length === 0}
                            className="px-3.5 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white rounded-lg font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                          >
                            {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                            <span>Пакет .PDF</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleGenerateSingle('docx')}
                            disabled={isGenerating || !targetRow}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                          >
                            {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            <span>Сформировать .DOCX</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleGenerateSingle('pdf')}
                            disabled={isGenerating || !targetRow}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white rounded-lg font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                          >
                            {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            <span>Сформировать .PDF</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
