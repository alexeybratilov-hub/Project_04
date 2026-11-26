import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  FileText,
  Download,
  BookOpen,
  Eye,
  FileDown,
  RefreshCw,
  Plus,
  FolderOpen,
  FolderArchive,
  Edit2,
  Trash2,
  ArchiveRestore,
  Table2,
  Check,
  AlertTriangle,
  Upload,
  FileCheck2,
  Tag as TagIcon,
  Info,
  FileArchive,
  Users
} from 'lucide-react';
import {
  DocumentTemplate,
  DocumentTemplateType,
  LegalEntityProfile,
  Tab,
  Tag
} from '../types/database';
import {
  BatchGenerationReport,
  documentGenerator,
  isGroupTemplate
} from '../services/documentGenerator';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  docxTemplateService
} from '../services/docxTemplateService';
import {
  DOCUMENT_CATEGORIES,
  formatBytesReadable,
  formatDateDdMmYyyy,
  inferDocumentCategory
} from '../services/generatedDocsService';
import { localApiClient, sanitizeSafeFilename } from '../services/localApiClient';
import { portablePackageService } from '../services/portablePackageService';
import { packageFilesAsZip } from '../services/zipExportService';
import { RecordGeneratedDocPayload } from './LLMStudioModal';
import { createUniqueId } from '../services/integrityService';
import { BatchGenerationReportPanel } from './BatchGenerationReportPanel';
import { TagCatalogDrawer } from './TagCatalogDrawer';
import {
  AppButton,
  AppInput,
  AppModal,
  AppSelect,
  AppTextarea,
  ConfirmDialog,
  FileValidationRule,
  FormField,
  InlineConfirm,
  StatusBanner,
  useFileDropZone,
  useToast
} from './ui';

export type TemplatesModalScope = 'tab' | 'all' | 'archive';

const DOCX_TEMPLATE_RULE: FileValidationRule = {
  allowedExtensions: ['.docx'],
  allowedMimeTypes: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/x-zip-compressed'
  ],
  formatLabel: '.docx'
};

interface DraftDocxData {
  buffer?: ArrayBuffer;
  hasNewUpload: boolean;
  sourceFileName: string;
  storageFileName?: string;
  dataBase64?: string;
  fileSizeFormatted: string;
  uploadedAt: string;
  detectedTags: string[];
  previewText: string;
  unsupportedWarnings: string[];
}

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
  onRecordGeneratedDoc?: (payload: RecordGeneratedDocPayload) => Promise<string> | void;
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
  const [failOnEmptyRowTags, setFailOnEmptyRowTags] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showTagCatalog, setShowTagCatalog] = useState<boolean>(false);
  const [batchReport, setBatchReport] = useState<BatchGenerationReport | null>(null);

  // Loaded binary buffer for currently previewed DOCX template
  const [activeDocxState, setActiveDocxState] = useState<{
    templateId: string;
    buffer: ArrayBuffer | null;
    loading: boolean;
    error: string | null;
  }>({ templateId: '', buffer: null, loading: false, error: null });

  // Create / Edit template form state
  const [editorMode, setEditorMode] = useState<'none' | 'create' | 'edit'>('none');
  const [draftType, setDraftType] = useState<DocumentTemplateType>('text');
  const [draftName, setDraftName] = useState('');
  const [draftTabId, setDraftTabId] = useState(currentTab.id);
  const [draftCategory, setDraftCategory] = useState<string>(DOCUMENT_CATEGORIES[0]);
  const [draftNaming, setDraftNaming] = useState('{ФИО}_документ_2026.docx');
  const [draftContent, setDraftContent] = useState('');
  const [draftDocx, setDraftDocx] = useState<DraftDocxData | null>(null);
  const [docxDropError, setDocxDropError] = useState<string | null>(null);

  const [editorInitialDraft, setEditorInitialDraft] = useState<{
    templateType: DocumentTemplateType;
    name: string;
    tabId: string;
    category: string;
    naming: string;
    content: string;
    sourceFileName: string;
  } | null>(null);
  const [editorErrors, setEditorErrors] = useState<{
    name?: string;
    content?: string;
    docx?: string;
    summary?: string;
  }>({});
  const [pendingDiscardAction, setPendingDiscardAction] = useState<{
    action: () => void;
    isClosingModal: boolean;
  } | null>(null);

  const prevOpenRef = useRef(false);
  const isSavingEditorRef = useRef(false);
  const docxFileInputRef = useRef<HTMLInputElement | null>(null);
  // In-memory cache of binary .docx templates for web-preview / current session
  const sessionDocxBuffersRef = useRef<Map<string, ArrayBuffer>>(new Map());

  const isNative = localApiClient.isNative();

  // Reset scope and active template strictly when modal opens
  useEffect(() => {
    const justOpened = isOpen && !prevOpenRef.current;
    prevOpenRef.current = isOpen;

    if (!isOpen) {
      isSavingEditorRef.current = false;
      return;
    }
    if (!justOpened) return;

    setScope(initialScope);
    setSelectedSection('ALL');
    setEditorMode('none');
    setDraftType('text');
    setDraftDocx(null);
    setDocxDropError(null);
    setEditorInitialDraft(null);
    setEditorErrors({});
    setPendingDiscardAction(null);
    setConfirmDeleteId(null);
    setShowTagCatalog(false);
    setBatchReport(null);
    isSavingEditorRef.current = false;

    const activeTemplates = templates.filter((t) => !t.isArchived);
    const preferred =
      initialScope === 'tab'
        ? activeTemplates.find((t) => t.tabId === currentTab.id)
        : initialScope === 'archive'
          ? templates.find((t) => t.isArchived)
          : activeTemplates.find((t) => t.tabId === currentTab.id) || activeTemplates[0];

    setSelectedTemplateId(preferred?.id || '');
    setIsBatchMode(Boolean(selectedRowIds && selectedRowIds.length > 1));
  }, [isOpen, initialScope, currentTab.id, templates, selectedRowIds]);

  const isEditorDirty = useMemo(() => {
    if (!isOpen || editorMode === 'none' || !editorInitialDraft) return false;
    return (
      draftType !== editorInitialDraft.templateType ||
      draftName !== editorInitialDraft.name ||
      draftTabId !== editorInitialDraft.tabId ||
      draftCategory !== editorInitialDraft.category ||
      draftNaming !== editorInitialDraft.naming ||
      draftContent !== editorInitialDraft.content ||
      Boolean(draftDocx?.hasNewUpload) ||
      (draftDocx?.sourceFileName || '') !== editorInitialDraft.sourceFileName
    );
  }, [
    isOpen,
    editorMode,
    editorInitialDraft,
    draftType,
    draftName,
    draftTabId,
    draftCategory,
    draftNaming,
    draftContent,
    draftDocx
  ]);

  const requestGuardedAction = useCallback(
    (action: () => void, isClosingModal = false) => {
      if (isEditorDirty) {
        setPendingDiscardAction({ action, isClosingModal });
      } else {
        action();
      }
    },
    [isEditorDirty]
  );

  // Esc exits template sub-editor (with dirty-guard) without closing the modal
  useEffect(() => {
    if (!isOpen || editorMode === 'none' || pendingDiscardAction) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        requestGuardedAction(() => {
          setEditorMode('none');
          setEditorInitialDraft(null);
          setEditorErrors({});
          setDraftDocx(null);
          setDocxDropError(null);
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, editorMode, pendingDiscardAction, requestGuardedAction]);

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

  const isCurrentDocx = currentTemplate?.templateType === 'docx';

  // Resolve source ArrayBuffer for any DOCX template
  const resolveDocxSourceBuffer = useCallback(
    async (tpl: DocumentTemplate): Promise<ArrayBuffer> => {
      const cached = sessionDocxBuffersRef.current.get(tpl.id);
      if (cached && cached.byteLength > 0) {
        return cached;
      }
      if (isNative && tpl.storageFileName) {
        const downloadedBlob = await localApiClient.downloadFileFromBucket(
          'templates',
          tpl.storageFileName
        );
        if (downloadedBlob && downloadedBlob.size > 0) {
          const downloadedBuf = await downloadedBlob.arrayBuffer();
          sessionDocxBuffersRef.current.set(tpl.id, downloadedBuf);
          return downloadedBuf;
        }
      }
      if (tpl.dataBase64) {
        const buf = base64ToArrayBuffer(tpl.dataBase64);
        if (buf.byteLength > 0) {
          sessionDocxBuffersRef.current.set(tpl.id, buf);
          return buf;
        }
      }
      throw new Error(
        `Не найден исходный файл шаблона «${tpl.sourceFileName || tpl.fileName}». Откройте редактирование и загрузите .docx повторно.`
      );
    },
    [isNative]
  );

  // Preload active DOCX template binary when selected in preview
  useEffect(() => {
    if (!isOpen || !currentTemplate || currentTemplate.templateType !== 'docx') {
      setActiveDocxState({ templateId: '', buffer: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setActiveDocxState({
      templateId: currentTemplate.id,
      buffer: sessionDocxBuffersRef.current.get(currentTemplate.id) || null,
      loading: !sessionDocxBuffersRef.current.has(currentTemplate.id),
      error: null
    });

    resolveDocxSourceBuffer(currentTemplate)
      .then((buffer) => {
        if (!cancelled) {
          setActiveDocxState({
            templateId: currentTemplate.id,
            buffer,
            loading: false,
            error: null
          });
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setActiveDocxState({
            templateId: currentTemplate.id,
            buffer: null,
            loading: false,
            error: err?.message || 'Ошибка чтения DOCX-шаблона'
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, currentTemplate?.id, currentTemplate?.templateType, currentTemplate?.storageFileName, currentTemplate?.dataBase64, resolveDocxSourceBuffer]);

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

  const targetRow = boundTab.rows.find((r) => r.id === targetRowId) || boundTab.rows[0];
  const isCurrentGroup = isGroupTemplate(currentTemplate) && currentTemplate?.templateType !== 'docx';
  const batchTargetRows = useMemo(() => {
    if (boundTab.id === currentTab.id && selectedRowIds && selectedRowIds.length > 0) {
      const selected = boundTab.rows.filter((r) => selectedRowIds.includes(r.id));
      if (selected.length > 0) return selected;
    }
    return boundTab.rows;
  }, [boundTab.id, boundTab.rows, currentTab.id, selectedRowIds]);

  const currentCategory = currentTemplate
    ? getTemplateCategory(currentTemplate)
    : inferDocumentCategory('', boundTab.name);

  const previewResolution = useMemo(() => {
    if (!isOpen || !currentTemplate || !targetRow) return null;
    const bodyRes = isCurrentGroup
      ? documentGenerator.resolveGroupTemplateDetailed(
          currentTemplate.contentTemplate || '',
          batchTargetRows,
          boundTab,
          allTabs,
          tags,
          entityProfile
        )
      : documentGenerator.resolveTemplateTagsDetailed(
          currentTemplate.contentTemplate || '',
          targetRow,
          boundTab,
          allTabs,
          tags,
          entityProfile
        );
    const namingRes = documentGenerator.resolveTemplateTagsDetailed(
      currentTemplate.namingPattern || '',
      targetRow,
      boundTab,
      allTabs,
      tags,
      entityProfile
    );
    return {
      text: bodyRes.text,
      markup: 'markup' in bodyRes ? bodyRes.markup : bodyRes.text,
      issues: [
        ...bodyRes.issues,
        ...namingRes.issues.filter(
          (ni) => !bodyRes.issues.some((bi) => bi.type === ni.type && bi.tagName === ni.tagName)
        )
      ],
      unknownTags: Array.from(new Set([...bodyRes.unknownTags, ...namingRes.unknownTags])),
      emptyRowTags: Array.from(new Set([...bodyRes.emptyRowTags, ...namingRes.emptyRowTags])),
      emptyProfileTags: Array.from(
        new Set([...bodyRes.emptyProfileTags, ...namingRes.emptyProfileTags])
      )
    };
  }, [isOpen, currentTemplate, targetRow, isCurrentGroup, batchTargetRows, boundTab, allTabs, tags, entityProfile]);

  const previewIssues = previewResolution?.issues ?? [];
  const previewUnknownTags = previewResolution?.unknownTags ?? [];
  const previewEmptyRowTags = previewResolution?.emptyRowTags ?? [];

  const previewText = previewResolution
    ? previewResolution.text
    : currentTemplate
      ? currentTemplate.contentTemplate
      : scope === 'tab'
        ? `К таблице «${currentTab.name}» пока не привязано ни одного шаблона. Нажмите «+ Новый шаблон» или «Загрузить .DOCX», чтобы создать шаблон для этой таблицы.`
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
      r.emp_fio ||
        r.pos_title ||
        r.fac_name ||
        r.med_worker ||
        r.siz_item ||
        r.inst_worker ||
        r.inc_victim ||
        secondColVal ||
        firstColVal ||
        r.id ||
        ''
    );
  };

  const handleProcessDocxFile = useCallback(
    async (file: File) => {
      setDocxDropError(null);
      setEditorErrors((prev) => ({ ...prev, docx: undefined, summary: undefined }));
      try {
        const buffer = await file.arrayBuffer();
        const inspected = docxTemplateService.inspectDocxTemplate(buffer);

        const nextDraftDocx: DraftDocxData = {
          buffer,
          hasNewUpload: true,
          sourceFileName: file.name,
          fileSizeFormatted: formatBytesReadable(file.size),
          uploadedAt: new Date().toISOString().split('T')[0],
          detectedTags: inspected.detectedTags,
          previewText: inspected.previewText,
          unsupportedWarnings: inspected.unsupportedWarnings
        };

        setDraftDocx(nextDraftDocx);
        setDraftContent(inspected.previewText);

        const stem = file.name.replace(/\.docx$/i, '').trim();
        if (!draftName.trim() && stem) {
          setDraftName(stem);
        }
        if (
          stem &&
          (!draftNaming.trim() || draftNaming.trim() === '{ФИО}_документ_2026.docx')
        ) {
          setDraftNaming(`${stem}_{ФИО}.docx`);
        }

        if (inspected.unsupportedWarnings.length > 0) {
          showToast(
            `DOCX «${file.name}» загружен с предупреждением: ${inspected.unsupportedWarnings[0]}`,
            'warning'
          );
        } else {
          showToast(
            `DOCX-шаблон «${file.name}» проверен (найдено тегов: ${inspected.detectedTags.length})`,
            'success'
          );
        }
      } catch (err: any) {
        const msg =
          err?.message || `Не удалось прочитать DOCX-файл «${file.name}».`;
        setDocxDropError(msg);
        setEditorErrors((prev) => ({ ...prev, docx: msg, summary: msg }));
        showToast(msg, 'error');
      }
    },
    [draftName, draftNaming, showToast]
  );

  const handleRejectDocxFile = useCallback(
    (msg: string) => {
      setDocxDropError(msg);
      setEditorErrors((prev) => ({ ...prev, docx: msg, summary: msg }));
      showToast(msg, 'error');
    },
    [showToast]
  );

  const {
    isDragOver: isDocxDragOver,
    dropZoneProps: docxDropZoneProps,
    handleInputChange: handleDocxInputChange
  } = useFileDropZone({
    rule: DOCX_TEMPLATE_RULE,
    disabled: editorMode === 'none' || draftType !== 'docx',
    onFileAccepted: handleProcessDocxFile,
    onReject: handleRejectDocxFile
  });

  const openCreateForm = (initialType: DocumentTemplateType = 'text') => {
    requestGuardedAction(() => {
      const initial = {
        templateType: initialType,
        name: '',
        tabId: currentTab.id,
        category: inferDocumentCategory('', currentTab.name),
        naming: '{ФИО}_документ_2026.docx',
        content: '',
        sourceFileName: ''
      };
      setShowTagCatalog(false);
      setEditorMode('create');
      setDraftType(initialType);
      setDraftName(initial.name);
      setDraftTabId(initial.tabId);
      setDraftCategory(initial.category);
      setDraftNaming(initial.naming);
      setDraftContent(initial.content);
      setDraftDocx(null);
      setDocxDropError(null);
      setEditorInitialDraft(initial);
      setEditorErrors({});
      isSavingEditorRef.current = false;
    });
  };

  const openEditForm = (tpl: DocumentTemplate) => {
    requestGuardedAction(() => {
      const tplType: DocumentTemplateType =
        tpl.templateType === 'docx' ? 'docx' : 'text';
      const initial = {
        templateType: tplType,
        name: tpl.name,
        tabId: tpl.tabId || currentTab.id,
        category: getTemplateCategory(tpl),
        naming: tpl.namingPattern,
        content: tpl.contentTemplate,
        sourceFileName: tpl.sourceFileName || tpl.fileName || ''
      };
      setShowTagCatalog(false);
      setEditorMode('edit');
      setSelectedTemplateId(tpl.id);
      setDraftType(tplType);
      setDraftName(initial.name);
      setDraftTabId(initial.tabId);
      setDraftCategory(initial.category);
      setDraftNaming(initial.naming);
      setDraftContent(initial.content);
      setDocxDropError(null);
      setDraftDocx(
        tplType === 'docx'
          ? {
              buffer: sessionDocxBuffersRef.current.get(tpl.id),
              hasNewUpload: false,
              sourceFileName: tpl.sourceFileName || tpl.fileName,
              storageFileName: tpl.storageFileName,
              dataBase64: tpl.dataBase64,
              fileSizeFormatted: tpl.fileSizeFormatted || '—',
              uploadedAt: tpl.uploadedAt || '',
              detectedTags: tpl.detectedTags || [],
              previewText: tpl.contentTemplate || '',
              unsupportedWarnings: tpl.unsupportedWarnings || []
            }
          : null
      );
      setEditorInitialDraft(initial);
      setEditorErrors({});
      isSavingEditorRef.current = false;
    });
  };

  const cleanupUnusedTemplateFile = async (
    storageFileName: string | undefined,
    remainingTemplates: DocumentTemplate[]
  ) => {
    if (!storageFileName || !isNative) return;
    const stillUsed = remainingTemplates.some(
      (t) => t.storageFileName === storageFileName
    );
    if (!stillUsed) {
      await localApiClient.deleteFileFromBucket('templates', storageFileName);
    }
  };

  const handleSaveEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingEditorRef.current) return;

    const nextErrors: {
      name?: string;
      content?: string;
      docx?: string;
      summary?: string;
    } = {};

    if (!draftName.trim()) {
      nextErrors.name = 'Укажите название шаблона.';
    }

    if (draftType === 'docx') {
      if (!draftDocx || !draftDocx.sourceFileName) {
        nextErrors.docx = 'Загрузите файл шаблона .docx (перетащите или выберите с диска).';
      }
    } else if (!draftContent.trim()) {
      nextErrors.content =
        'Введите текст шаблона (можно использовать теги в фигурных скобках).';
    }

    if (nextErrors.name || nextErrors.content || nextErrors.docx) {
      nextErrors.summary = nextErrors.name || nextErrors.docx || nextErrors.content;
      setEditorErrors(nextErrors);
      return;
    }

    isSavingEditorRef.current = true;
    try {
      const targetTabObj = allTabs.find((t) => t.id === draftTabId) || currentTab;
      const targetId =
        editorMode === 'edit' && currentTemplate
          ? currentTemplate.id
          : createUniqueId('tpl');

      let storageFileName = draftDocx?.storageFileName;
      let dataBase64 = draftDocx?.dataBase64;
      const oldStorageToCleanup =
        editorMode === 'edit' &&
        currentTemplate?.storageFileName &&
        (draftType !== 'docx' || draftDocx?.hasNewUpload)
          ? currentTemplate.storageFileName
          : undefined;

      if (draftType === 'docx' && draftDocx?.hasNewUpload && draftDocx.buffer) {
        sessionDocxBuffersRef.current.set(targetId, draftDocx.buffer);

        if (isNative) {
          const candidateName = sanitizeSafeFilename(
            `${targetId.slice(-6)}_${draftDocx.sourceFileName}`
          );
          const writeRes = await localApiClient.saveFileToBucket(
            'templates',
            candidateName,
            draftDocx.buffer
          );
          if (!writeRes.ok) {
            const msg =
              writeRes.message ||
              'Не удалось сохранить .docx шаблон в каталог ./templates/.';
            setEditorErrors({ docx: msg, summary: msg });
            showToast(msg, 'error');
            return;
          }
          storageFileName = writeRes.safeName;
          dataBase64 = undefined;
        } else {
          storageFileName = undefined;
          if (draftDocx.buffer.byteLength <= 1_500_000) {
            dataBase64 = arrayBufferToBase64(draftDocx.buffer);
          } else {
            dataBase64 = undefined;
            showToast(
              'В веб-предпросмотре файлы >1.5 МБ хранятся только в текущей сессии браузера. В OT-Baza.exe файл сохраняется в ./templates/.',
              'warning'
            );
          }
        }
      }

      if (editorMode === 'create') {
        const newTpl: DocumentTemplate = {
          id: targetId,
          name: draftName.trim(),
          tabId: targetTabObj.id,
          category: draftCategory || inferDocumentCategory(draftName, targetTabObj.name),
          fileName:
            draftType === 'docx' && draftDocx
              ? draftDocx.sourceFileName
              : `${draftName.trim()}.docx`,
          namingPattern: draftNaming.trim() || '{ФИО}_документ.docx',
          contentTemplate:
            draftType === 'docx' && draftDocx
              ? draftDocx.previewText
              : draftContent.trim(),
          ...(draftType === 'docx' && draftDocx
            ? {
                templateType: 'docx' as const,
                sourceFileName: draftDocx.sourceFileName,
                storageFileName,
                dataBase64,
                fileSizeFormatted: draftDocx.fileSizeFormatted,
                uploadedAt: draftDocx.uploadedAt,
                detectedTags: draftDocx.detectedTags,
                unsupportedWarnings: draftDocx.unsupportedWarnings
              }
            : { templateType: 'text' as const })
        };

        onSaveTemplates([...templates, newTpl]);
        setSelectedTemplateId(newTpl.id);
        if (scope === 'archive') {
          setScope(newTpl.tabId === currentTab.id ? 'tab' : 'all');
        }
        setEditorMode('none');
        setEditorInitialDraft(null);
        setEditorErrors({});
        setDraftDocx(null);
        showToast(
          `Шаблон «${newTpl.name}» добавлен для таблицы «${targetTabObj.name}»`,
          'success'
        );
      } else if (editorMode === 'edit' && currentTemplate) {
        const updated = templates.map((t) => {
          if (t.id !== currentTemplate.id) return t;
          if (draftType === 'docx' && draftDocx) {
            return {
              ...t,
              templateType: 'docx' as const,
              name: draftName.trim(),
              tabId: targetTabObj.id,
              category: draftCategory || inferDocumentCategory(draftName, targetTabObj.name),
              fileName: draftDocx.sourceFileName,
              namingPattern: draftNaming.trim() || t.namingPattern,
              contentTemplate: draftDocx.previewText,
              sourceFileName: draftDocx.sourceFileName,
              storageFileName,
              dataBase64,
              fileSizeFormatted: draftDocx.fileSizeFormatted,
              uploadedAt: draftDocx.uploadedAt,
              detectedTags: draftDocx.detectedTags,
              unsupportedWarnings: draftDocx.unsupportedWarnings,
              isArchived: false,
              archivedAt: undefined,
              archivedFromTabName: undefined
            };
          }
          // Switching or keeping as text template clears binary metadata cleanly
          return {
            id: t.id,
            name: draftName.trim(),
            tabId: targetTabObj.id,
            category: draftCategory || inferDocumentCategory(draftName, targetTabObj.name),
            fileName: t.fileName || `${draftName.trim()}.docx`,
            namingPattern: draftNaming.trim() || t.namingPattern,
            contentTemplate: draftContent.trim(),
            tableRepeatField: t.tableRepeatField,
            isBuiltIn: t.isBuiltIn,
            templateType: 'text' as const
          };
        });

        onSaveTemplates(updated);
        if (oldStorageToCleanup) {
          void cleanupUnusedTemplateFile(oldStorageToCleanup, updated);
        }
        setEditorMode('none');
        setEditorInitialDraft(null);
        setEditorErrors({});
        setDraftDocx(null);
        showToast(`Шаблон «${draftName.trim()}» сохранён`, 'success');
      }
    } finally {
      isSavingEditorRef.current = false;
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
    showToast(
      `Шаблон «${tpl.name}» восстановлен и привязан к вкладке «${currentTab.name}»`,
      'success'
    );
  };

  const handleDeleteTemplate = (tplId: string) => {
    const target = templates.find((t) => t.id === tplId);
    const next = templates.filter((t) => t.id !== tplId);
    sessionDocxBuffersRef.current.delete(tplId);
    if (target?.storageFileName) {
      void cleanupUnusedTemplateFile(target.storageFileName, next);
    }
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

    if (currentTemplate.templateType === 'docx' && format === 'pdf') {
      showToast(
        'PDF не поддерживается для готовых DOCX-шаблонов без Word/LibreOffice. Используйте «Сформировать .DOCX».',
        'warning'
      );
      return;
    }

    setIsGenerating(true);
    try {
      let fileName = format === 'docx' ? previewFileNameDocx : previewFileNamePdf;
      let blob: Blob;
      let extraWarnings: string[] = [];

      if (currentTemplate.templateType === 'docx') {
        const buffer = await resolveDocxSourceBuffer(currentTemplate);
        const rendered = documentGenerator.renderDocxFromBuffer(
          currentTemplate,
          buffer,
          targetRow,
          boundTab,
          allTabs,
          tags,
          entityProfile
        );
        blob = rendered.blob;
        fileName = rendered.fileName;
        if (rendered.unknownTags.length > 0) {
          extraWarnings.push(`Неизвестные теги оставлены без изменений: ${rendered.unknownTags.join(', ')}`);
        }
        if (rendered.emptyRowTags.length > 0) {
          extraWarnings.push(`Пустые значения в строке: ${rendered.emptyRowTags.join(', ')}`);
        }
      } else {
        blob =
          format === 'docx'
            ? await documentGenerator.generateDocx(currentTemplate.name, previewText)
            : await documentGenerator.generatePdf(currentTemplate.name, previewText);
      }

      if (onRecordGeneratedDoc) {
        await onRecordGeneratedDoc({
          title: currentTemplate.name,
          fileName,
          category: currentCategory,
          format,
          blob,
          sourceTabName: boundTab.name,
          sourceTabId: boundTab.id,
          rowIdentifier: getRowLabel(targetRow, boundTab)
        });
        if (previewIssues.length > 0 || extraWarnings.length > 0) {
          const warnMsg = previewIssues[0]?.reason || extraWarnings[0];
          showToast(
            `Файл «${fileName}» сохранён в «${currentCategory}», с предупреждением: ${warnMsg}`,
            'warning'
          );
        } else {
          showToast(`Файл «${fileName}» сохранён в раздел «${currentCategory}»`, 'success');
        }
      } else {
        const { savedToDisk } = await documentGenerator.saveAndDownloadBlob(blob, fileName, true);
        if (previewIssues.length > 0 || extraWarnings.length > 0) {
          const warnMsg = previewIssues[0]?.reason || extraWarnings[0];
          showToast(
            `Файл «${fileName}» сформирован с предупреждением: ${warnMsg}`,
            'warning'
          );
        } else {
          showToast(
            savedToDisk ? `Файл «${fileName}» сохранён и открыт` : `Файл «${fileName}» сформирован`,
            'success'
          );
        }
      }
    } catch (e: any) {
      showToast(
        `Ошибка формирования ${format.toUpperCase()}: ${e?.message || 'неизвестная ошибка'}`,
        'error'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleBatchGenerate = async (format: 'docx' | 'pdf', options?: { asZip?: boolean }) => {
    if (!currentTemplate) return;
    const asZip = Boolean(options?.asZip);

    if (currentTemplate.templateType === 'docx' && format === 'pdf') {
      showToast(
        'Пакетный экспорт в PDF не поддерживается для готовых .DOCX шаблонов без Word/LibreOffice.',
        'warning'
      );
      return;
    }

    const rowsToProcess = batchTargetRows;

    if (rowsToProcess.length === 0) {
      showToast(
        `В таблице «${boundTab.name}» пока нет строк для пакетного формирования`,
        'warning'
      );
      return;
    }

    setIsGenerating(true);
    setBatchReport(null);
    const zipEntries: Array<{ name: string; data: Blob }> = [];
    try {
      const docxSourceBuffer =
        currentTemplate.templateType === 'docx'
          ? await resolveDocxSourceBuffer(currentTemplate)
          : null;

      const report = await documentGenerator.executeBatchGeneration({
        template: currentTemplate,
        format,
        rowsToProcess,
        boundTab,
        allTabs,
        tags,
        entityProfile,
        docxSourceBuffer,
        failOnEmptyRowTags,
        delayBetweenRowsMs: asZip ? 0 : 120,
        onSaveDocument: async ({ row, fileName, blob }) => {
          if (asZip) {
            zipEntries.push({ name: fileName, data: blob });
          }
          if (onRecordGeneratedDoc) {
            await onRecordGeneratedDoc({
              title: currentTemplate.name,
              fileName,
              category: currentCategory,
              format,
              blob,
              sourceTabName: boundTab.name,
              sourceTabId: boundTab.id,
              rowIdentifier: getRowLabel(row, boundTab),
              skipBrowserDownload: asZip
            });
          } else if (!asZip) {
            await documentGenerator.saveAndDownloadBlob(blob, fileName, true);
          }
        }
      });

      setBatchReport(report);

      if (asZip && zipEntries.length > 0) {
        const zipBlob = await packageFilesAsZip(zipEntries);
        const dateStamp = formatDateDdMmYyyy(new Date());
        const safeTpl = currentTemplate.name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
        const zipName = `Пакет_${safeTpl}_${dateStamp}.zip`;
        portablePackageService.triggerBlobDownload(zipBlob, zipName);
        showToast(
          report.errorCount > 0
            ? `Скачан ZIP «${zipName}» (${zipEntries.length} файл., ошибок ${report.errorCount})`
            : `Скачан ZIP-архив «${zipName}» (${zipEntries.length} файл.)`,
          report.errorCount > 0 ? 'warning' : 'success'
        );
      } else if (report.errorCount > 0) {
        showToast(
          `Пакетная генерация завершена: создано ${report.successCount}, ошибок ${report.errorCount}. Подробности в отчёте.`,
          report.successCount > 0 ? 'warning' : 'error'
        );
      } else {
        showToast(
          `Сформировано документов: ${report.successCount} (${format.toUpperCase()}) в раздел «${currentCategory}»`,
          'success'
        );
      }
    } catch (e: any) {
      showToast(
        `Ошибка пакетного формирования: ${e?.message || 'неизвестная ошибка'}`,
        'error'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateGroupDocument = async (format: 'docx' | 'pdf') => {
    if (!currentTemplate || batchTargetRows.length === 0) {
      showToast(`В таблице «${boundTab.name}» пока нет строк для сводного документа.`, 'warning');
      return;
    }

    setIsGenerating(true);
    try {
      const groupRes = documentGenerator.resolveGroupTemplateDetailed(
        currentTemplate.contentTemplate || '',
        batchTargetRows,
        boundTab,
        allTabs,
        tags,
        entityProfile
      );
      const fileName = documentGenerator.resolveFileName(
        currentTemplate.namingPattern,
        batchTargetRows[0],
        boundTab,
        allTabs,
        tags,
        format,
        entityProfile
      );
      const blob =
        format === 'docx'
          ? await documentGenerator.generateGroupDocx(currentTemplate.name, groupRes.markup)
          : await documentGenerator.generateGroupPdf(currentTemplate.name, groupRes.markup);

      if (onRecordGeneratedDoc) {
        await onRecordGeneratedDoc({
          title: `${currentTemplate.name} (${batchTargetRows.length} чел.)`,
          fileName,
          category: currentCategory,
          format,
          blob,
          sourceTabName: boundTab.name,
          sourceTabId: boundTab.id,
          rowIdentifier: `Группа: ${batchTargetRows.length} чел.`
        });
      } else {
        await documentGenerator.saveAndDownloadBlob(blob, fileName, true);
      }

      if (groupRes.issues.length > 0) {
        showToast(
          `Сводный документ «${fileName}» создан с предупреждением: ${groupRes.issues[0].reason}`,
          'warning'
        );
      } else {
        showToast(
          `Сводный документ «${fileName}» (${batchTargetRows.length} стр.) сформирован`,
          'success'
        );
      }
    } catch (e: any) {
      showToast(
        `Ошибка формирования сводного ${format.toUpperCase()}: ${e?.message || 'неизвестная ошибка'}`,
        'error'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const draftTabObj = allTabs.find((t) => t.id === draftTabId) || boundTab;
  const availableTagsForDraftTab = tags.filter((t) => t.tabId === draftTabId);

  return (
    <>
      <AppModal
        isOpen={isOpen}
        onClose={() => requestGuardedAction(onClose, true)}
        closeOnEscape={editorMode === 'none' && !pendingDiscardAction}
        size="6xl"
        heightClass="h-[90vh]"
        icon={<FileText className="w-5 h-5" />}
        iconTone="blue"
        title={
          <>
            Шаблоны документов
            {entityProfile?.shortName ? ` · ${entityProfile.shortName}` : ''}
          </>
        }
        subtitle="Текстовые шаблоны (DOCX + PDF) и готовые Word-шаблоны (.docx) с сохранением оформления"
        headerRight={
          <div className="flex flex-wrap items-center gap-2">
            {/* View Scope Switcher */}
            <div className="flex items-center gap-1 bg-slate-200/70 dark:bg-slate-800 p-1 rounded-lg text-xs">
              <button
                type="button"
                onClick={() =>
                  requestGuardedAction(() => {
                    setScope('tab');
                    setEditorMode('none');
                    setEditorInitialDraft(null);
                    setEditorErrors({});
                    setDraftDocx(null);
                  })
                }
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  scope === 'tab'
                    ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Вкладка «{currentTab.name}»{' '}
                <span className="font-mono tabular-nums opacity-75">
                  ({tabActiveTemplates.length})
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  requestGuardedAction(() => {
                    setScope('all');
                    setEditorMode('none');
                    setEditorInitialDraft(null);
                    setEditorErrors({});
                    setDraftDocx(null);
                  })
                }
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  scope === 'all'
                    ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Все по разделам{' '}
                <span className="font-mono tabular-nums opacity-75">
                  ({allActiveTemplates.length})
                </span>
              </button>
              {archivedTemplates.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    requestGuardedAction(() => {
                      setScope('archive');
                      setEditorMode('none');
                      setEditorInitialDraft(null);
                      setEditorErrors({});
                      setDraftDocx(null);
                    })
                  }
                  className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                    scope === 'archive'
                      ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <FolderArchive className="w-3.5 h-3.5" />
                  <span>
                    Архив <span className="font-mono tabular-nums">({archivedTemplates.length})</span>
                  </span>
                </button>
              )}
            </div>

            <AppButton
              variant={showTagCatalog ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setShowTagCatalog((v) => !v)}
              data-testid="toggle-tag-catalog"
              icon={<TagIcon className="w-3.5 h-3.5" />}
            >
              Каталог тегов
            </AppButton>

            <AppButton
              variant="secondary"
              size="sm"
              onClick={() => openCreateForm('docx')}
              data-testid="upload-docx-template-btn"
              icon={<Upload className="w-3.5 h-3.5" />}
            >
              Загрузить .DOCX
            </AppButton>

            <AppButton
              variant="primary"
              size="sm"
              onClick={() => openCreateForm('text')}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              Новый шаблон
            </AppButton>
          </div>
        }
      >
        {/* Main Body */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Left Pane: Sections OR Tab/Archive Template List */}
          <div className="md:col-span-5 flex flex-col overflow-hidden bg-slate-50/40 dark:bg-slate-950/30">
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

            {/* Template List */}
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
                      Создайте текстовый шаблон или загрузите готовый файл .docx с тегами.
                    </p>
                  </div>
                  {scope !== 'archive' && (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <AppButton
                        variant="secondary"
                        size="sm"
                        onClick={() => openCreateForm('docx')}
                        icon={<Upload className="w-3.5 h-3.5" />}
                      >
                        Загрузить .DOCX
                      </AppButton>
                      <AppButton
                        variant="primary"
                        size="sm"
                        onClick={() => openCreateForm('text')}
                        icon={<Plus className="w-3.5 h-3.5" />}
                      >
                        Создать текстовый
                      </AppButton>
                    </div>
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
                              data-testid={`template-item-${tpl.id}`}
                              onClick={() =>
                                requestGuardedAction(() => {
                                  setShowTagCatalog(false);
                                  setEditorMode('none');
                                  setEditorInitialDraft(null);
                                  setEditorErrors({});
                                  setDraftDocx(null);
                                  setSelectedTemplateId(tpl.id);
                                })
                              }
                              className={`p-2.5 rounded-lg border cursor-pointer transition-colors ${
                                isSelected
                                  ? 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-300 dark:border-blue-700'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="font-semibold text-slate-900 dark:text-slate-100 leading-snug truncate">
                                    {tpl.name}
                                  </span>
                                  {tpl.templateType === 'docx' && (
                                    <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-[10px] font-mono font-semibold text-indigo-700 dark:text-indigo-300 shrink-0">
                                      DOCX
                                    </span>
                                  )}
                                  {isGroupTemplate(tpl) && (
                                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 text-[10px] font-mono font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">
                                      ГРУППА
                                    </span>
                                  )}
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
                                  Таблица:{' '}
                                  <strong className="text-slate-700 dark:text-slate-300">
                                    {tTab?.name || 'Не привязана'}
                                  </strong>
                                </span>
                                <span className="font-mono truncate max-w-[140px] opacity-75">
                                  {tpl.namingPattern}
                                </span>
                              </div>
                              {confirmDeleteId === tpl.id && (
                                <InlineConfirm
                                  compact
                                  className="mt-2"
                                  message="Удалить шаблон?"
                                  confirmLabel="Удалить"
                                  onConfirm={() => handleDeleteTemplate(tpl.id)}
                                  onCancel={() => setConfirmDeleteId(null)}
                                />
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
                        data-testid={`template-item-${tpl.id}`}
                        onClick={() =>
                          requestGuardedAction(() => {
                            setShowTagCatalog(false);
                            setEditorMode('none');
                            setEditorInitialDraft(null);
                            setEditorErrors({});
                            setDraftDocx(null);
                            setSelectedTemplateId(tpl.id);
                          })
                        }
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-50/90 dark:bg-blue-950/50 border-blue-300 dark:border-blue-700'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-slate-900 dark:text-slate-100 leading-snug truncate">
                              {tpl.name}
                            </span>
                            {tpl.templateType === 'docx' && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-[10px] font-mono font-semibold text-indigo-700 dark:text-indigo-300 shrink-0">
                                DOCX
                              </span>
                            )}
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
                          <span className="truncate">
                            {tpl.isArchived
                              ? `Архив из «${tpl.archivedFromTabName || 'удалённой таблицы'}»`
                              : tpl.templateType === 'docx'
                                ? `Файл: ${tpl.sourceFileName || tpl.fileName}`
                                : `Раздел: ${getTemplateCategory(tpl)}`}
                          </span>
                          <span className="font-mono truncate max-w-[160px] opacity-75">
                            {tTab ? tTab.name : tpl.namingPattern}
                          </span>
                        </div>

                        {confirmDeleteId === tpl.id && (
                          <InlineConfirm
                            compact
                            className="mt-2"
                            message="Удалить шаблон?"
                            confirmLabel="Удалить"
                            onConfirm={() => handleDeleteTemplate(tpl.id)}
                            onCancel={() => setConfirmDeleteId(null)}
                          />
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
                Пул пользовательских тегов <span className="font-mono text-slate-400">({tags.length})</span>
              </div>
              <button
                type="button"
                onClick={onOpenTagsModal}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-md font-medium cursor-pointer"
              >
                <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                <span>Настроить теги</span>
              </button>
            </div>
          </div>

          {/* Right Pane: Tag Catalog OR Create/Edit Form OR Preview/Export/Batch Report */}
          <div className="md:col-span-7 flex flex-col bg-slate-50/50 dark:bg-slate-950/40 overflow-hidden min-h-0">
            {showTagCatalog ? (
              <div className="flex-1 p-4 overflow-hidden min-h-0">
                <TagCatalogDrawer
                  targetTab={editorMode !== 'none' ? draftTabObj : boundTab}
                  allTabs={allTabs}
                  tags={tags}
                  entityProfile={entityProfile}
                  sampleRow={targetRow}
                  canInsertIntoText={editorMode !== 'none' && draftType === 'text'}
                  onInsertTag={(tagName) => {
                    setDraftContent(
                      (c) =>
                        `${c}${c && !c.endsWith(' ') && !c.endsWith('\n') ? ' ' : ''}${tagName}`
                    );
                    setShowTagCatalog(false);
                  }}
                  onClose={() => setShowTagCatalog(false)}
                />
              </div>
            ) : editorMode !== 'none' ? (
              <form
                noValidate
                onSubmit={(e) => void handleSaveEditor(e)}
                className="flex-1 overflow-y-auto p-5 space-y-4 text-xs"
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {editorMode === 'create'
                        ? draftType === 'docx'
                          ? 'Загрузка готового DOCX-шаблона'
                          : 'Создание текстового шаблона'
                        : 'Редактирование шаблона'}
                    </h3>
                    {isEditorDirty && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 font-medium text-[11px] shrink-0">
                        <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                        Черновик изменён
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      requestGuardedAction(() => {
                        setEditorMode('none');
                        setEditorInitialDraft(null);
                        setEditorErrors({});
                        setDraftDocx(null);
                        setDocxDropError(null);
                      })
                    }
                    className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-medium cursor-pointer shrink-0"
                  >
                    Отмена
                  </button>
                </div>

                {/* Template Format Mode Switcher */}
                <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftType('text');
                      setEditorErrors({});
                    }}
                    className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      draftType === 'text'
                        ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    Текстовый шаблон (DOCX + PDF)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftType('docx');
                      setEditorErrors({});
                    }}
                    className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      draftType === 'docx'
                        ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    Готовый Word-шаблон (.DOCX)
                  </button>
                </div>

                {editorErrors.summary && (
                  <StatusBanner variant="error" compact>
                    {editorErrors.summary}
                  </StatusBanner>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField label="Название шаблона" required error={editorErrors.name}>
                    <AppInput
                      type="text"
                      compact
                      error={Boolean(editorErrors.name)}
                      value={draftName}
                      onChange={(e) => {
                        setDraftName(e.target.value);
                        if (editorErrors.name || editorErrors.summary) {
                          setEditorErrors((prev) => ({
                            ...prev,
                            name: undefined,
                            summary: prev.docx || prev.content
                          }));
                        }
                      }}
                      placeholder="Например: Приказ о проведении обучения"
                    />
                  </FormField>

                  <FormField label="Раздел документов">
                    <AppSelect
                      compact
                      value={draftCategory}
                      onChange={(e) => setDraftCategory(e.target.value)}
                    >
                      {DOCUMENT_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </AppSelect>
                  </FormField>

                  <FormField label="Привязанная таблица">
                    <AppSelect
                      compact
                      value={draftTabId}
                      onChange={(e) => setDraftTabId(e.target.value)}
                    >
                      {allTabs.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </AppSelect>
                  </FormField>

                  <FormField label="Шаблон имени файла">
                    <AppInput
                      type="text"
                      compact
                      mono
                      value={draftNaming}
                      onChange={(e) => setDraftNaming(e.target.value)}
                    />
                  </FormField>
                </div>

                {draftType === 'docx' ? (
                  <div className="space-y-3">
                    <input
                      ref={docxFileInputRef}
                      type="file"
                      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={handleDocxInputChange}
                      data-testid="docx-template-file-input"
                      className="hidden"
                    />

                    <div
                      {...docxDropZoneProps}
                      data-testid="docx-template-dropzone"
                      onClick={() => docxFileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors cursor-pointer ${
                        isDocxDragOver
                          ? 'border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/40'
                          : editorErrors.docx || docxDropError
                            ? 'border-red-300 bg-red-50/40 dark:border-red-800 dark:bg-red-950/20'
                            : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-indigo-400'
                      }`}
                    >
                      <Upload
                        className={`w-7 h-7 mx-auto mb-2 ${
                          isDocxDragOver ? 'text-indigo-600' : 'text-slate-400'
                        }`}
                      />
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {isDocxDragOver
                          ? 'Отпустите .DOCX файл для загрузки шаблона'
                          : draftDocx?.sourceFileName
                            ? `Загружен файл: ${draftDocx.sourceFileName} (${draftDocx.fileSizeFormatted})`
                            : 'Перетащите готовый файл .DOCX сюда или нажмите для выбора'}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Сохраняются стили Word, таблицы, колонтитулы, шрифты и форматирование.
                        Используйте теги вида <code className="font-mono">&#123;ФИО&#125;</code>.
                      </p>
                      {isNative && (
                        <p className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                          Файл сохраняется в портативный каталог <code className="font-mono">./templates/</code>.
                        </p>
                      )}
                    </div>

                    {draftDocx && (
                      <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-semibold">
                            <FileCheck2 className="w-4 h-4 shrink-0" />
                            <span>
                              {draftDocx.sourceFileName} ({draftDocx.fileSizeFormatted})
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-500">
                            Найдено тегов: <strong>{draftDocx.detectedTags.length}</strong>
                          </span>
                        </div>

                        {draftDocx.detectedTags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {draftDocx.detectedTags.map((t) => (
                              <code
                                key={t}
                                className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 font-mono text-[11px] text-indigo-700 dark:text-indigo-300"
                              >
                                {t}
                              </code>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300">
                            В документе не найдены теги в фигурных скобках &#123;...&#125;. Откройте «Каталог тегов» для копирования.
                          </div>
                        )}

                        {draftDocx.unsupportedWarnings.length > 0 && (
                          <StatusBanner variant="warning" compact>
                            {draftDocx.unsupportedWarnings.map((w, idx) => (
                              <div key={idx}>{w}</div>
                            ))}
                          </StatusBanner>
                        )}

                        <div>
                          <div className="text-[11px] font-medium text-slate-500 mb-1">
                            Извлечённый текст для предпросмотра:
                          </div>
                          <div className="max-h-36 overflow-y-auto p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-serif text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                            {draftDocx.previewText}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {availableTagsForDraftTab.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                          <span>Быстрая вставка тега этой таблицы:</span>
                          <button
                            type="button"
                            onClick={() => setShowTagCatalog(true)}
                            className="text-indigo-600 hover:underline font-medium cursor-pointer"
                          >
                            Открыть весь каталог тегов →
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {availableTagsForDraftTab.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => {
                                setDraftContent(
                                  (c) =>
                                    `${c}${c && !c.endsWith(' ') && !c.endsWith('\n') ? ' ' : ''}${t.name}`
                                );
                                if (editorErrors.content || editorErrors.summary) {
                                  setEditorErrors((prev) => ({
                                    ...prev,
                                    content: undefined,
                                    summary: prev.name
                                  }));
                                }
                              }}
                              className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-slate-200 dark:border-slate-700 rounded font-mono text-[11px] cursor-pointer"
                            >
                              {t.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <FormField
                      label="Текст шаблона с тегами {...}"
                      required
                      error={editorErrors.content}
                      className="flex-1"
                    >
                      <AppTextarea
                        mono
                        rows={11}
                        error={Boolean(editorErrors.content)}
                        value={draftContent}
                        onChange={(e) => {
                          setDraftContent(e.target.value);
                          if (editorErrors.content || editorErrors.summary) {
                            setEditorErrors((prev) => ({
                              ...prev,
                              content: undefined,
                              summary: prev.name
                            }));
                          }
                        }}
                        placeholder="Введите текст приказа, инструкции или направления с тегами {Организация}, {ФИО}, {Должность}..."
                        className="p-3 leading-relaxed"
                      />
                    </FormField>
                  </>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <AppButton
                    variant="secondary"
                    size="md"
                    onClick={() =>
                      requestGuardedAction(() => {
                        setEditorMode('none');
                        setEditorInitialDraft(null);
                        setEditorErrors({});
                        setDraftDocx(null);
                        setDocxDropError(null);
                      })
                    }
                  >
                    Отмена
                  </AppButton>
                  <AppButton
                    type="submit"
                    variant="primary"
                    size="md"
                    disabled={editorMode === 'edit' && !isEditorDirty}
                    icon={<Check className="w-4 h-4" />}
                  >
                    Сохранить шаблон
                  </AppButton>
                </div>
              </form>
            ) : (
              <div className="flex-1 flex flex-col p-5 overflow-hidden space-y-3 text-xs min-h-0">
                {/* Preview Controls */}
                {currentTemplate && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shrink-0">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">
                        Строка таблицы «{boundTab.name}»:
                      </label>
                      {boundTab.rows.length > 0 ? (
                        <AppSelect
                          compact
                          value={targetRowId}
                          onChange={(e) => setTargetRowId(e.target.value)}
                        >
                          {boundTab.rows.map((row, idx) => (
                            <option key={row.id} value={row.id}>
                              #{idx + 1}: {getRowLabel(row, boundTab)}
                            </option>
                          ))}
                        </AppSelect>
                      ) : (
                        <div className="px-2.5 py-1.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-[11px] text-amber-800 dark:text-amber-300">
                          В таблице «{boundTab.name}» пока нет строк
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col justify-between gap-1">
                      <label className="flex items-center justify-between gap-2 text-[11px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                        <span>Пакетное формирование по строкам</span>
                        <input
                          type="checkbox"
                          checked={isBatchMode}
                          data-testid="batch-mode-toggle"
                          onChange={(e) => setIsBatchMode(e.target.checked)}
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                        />
                      </label>
                      {isBatchMode ? (
                        <label className="flex items-center justify-between gap-2 text-[11px] text-slate-500 cursor-pointer">
                          <span>Пустое значение тега = ошибка строки</span>
                          <input
                            type="checkbox"
                            checked={failOnEmptyRowTags}
                            onChange={(e) => setFailOnEmptyRowTags(e.target.checked)}
                            className="w-3.5 h-3.5 rounded text-blue-600"
                          />
                        </label>
                      ) : (
                        <div className="text-[11px] text-slate-500 truncate">
                          Раздел сохранения: {currentCategory}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Preview Header & DOCX Metadata Strip */}
                <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Eye className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {currentTemplate ? currentTemplate.name : 'Предпросмотр шаблона'}
                    </span>
                    {isCurrentDocx && (
                      <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-[10px] font-mono font-semibold text-indigo-700 dark:text-indigo-300 shrink-0">
                        DOCX-шаблон
                      </span>
                    )}
                    {isCurrentGroup && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 text-[10px] font-mono font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">
                        Сводный ({batchTargetRows.length} стр.)
                      </span>
                    )}
                  </div>
                  {currentTemplate && (
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-xs">
                      {previewFileNameDocx}
                    </span>
                  )}
                </div>

                {/* Native DOCX File Info & Warnings */}
                {currentTemplate && isCurrentDocx && (
                  <div className="px-3 py-2 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60 flex flex-wrap items-center justify-between gap-2 text-[11px] shrink-0">
                    <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-200 min-w-0">
                      <FileCheck2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span className="truncate">
                        Исходный файл: <strong>{currentTemplate.sourceFileName || currentTemplate.fileName}</strong>
                        {currentTemplate.fileSizeFormatted ? ` (${currentTemplate.fileSizeFormatted})` : ''}
                        {currentTemplate.storageFileName
                          ? ` · ./templates/${currentTemplate.storageFileName}`
                          : ''}
                      </span>
                    </div>
                    {activeDocxState.loading ? (
                      <span className="text-indigo-600">Загрузка .docx...</span>
                    ) : activeDocxState.error ? (
                      <span className="text-red-600 font-medium">{activeDocxState.error}</span>
                    ) : (
                      <span className="text-indigo-700 dark:text-indigo-300 font-mono">
                        Тегов: {currentTemplate.detectedTags?.length ?? 0}
                      </span>
                    )}
                  </div>
                )}

                {/* Relation / Unknown Tag / Empty Tag / Structural Warnings */}
                {previewIssues.length > 0 && (
                  <StatusBanner
                    variant="warning"
                    role="alert"
                    compact
                    className="shrink-0"
                    title={`Предупреждение о связях (${previewIssues.length}): автоматический выбор неоднозначной или отсутствующей записи отключён`}
                  >
                    {previewIssues.map((issue, idx) => (
                      <div key={`${issue.type}-${issue.tagName}-${idx}`} className="leading-snug">
                        {issue.reason}
                      </div>
                    ))}
                  </StatusBanner>
                )}

                {previewUnknownTags.length > 0 && (
                  <StatusBanner
                    variant="error"
                    compact
                    className="shrink-0"
                    title={`Неизвестные теги (${previewUnknownTags.length}) — не найдены в таблице, пуле тегов и реквизитах:`}
                  >
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {previewUnknownTags.map((ut) => (
                        <code
                          key={ut}
                          className="px-1.5 py-0.5 rounded bg-white/80 dark:bg-slate-900 border border-red-300 dark:border-red-700 font-mono text-[11px]"
                        >
                          {ut}
                        </code>
                      ))}
                    </div>
                  </StatusBanner>
                )}

                {previewEmptyRowTags.length > 0 && (
                  <StatusBanner variant="warning" compact className="shrink-0">
                    Пустые значения в выбранной строке для тегов:{' '}
                    <span className="font-mono">{previewEmptyRowTags.join(', ')}</span>
                  </StatusBanner>
                )}

                {isCurrentDocx &&
                  currentTemplate?.unsupportedWarnings &&
                  currentTemplate.unsupportedWarnings.length > 0 && (
                    <StatusBanner variant="warning" compact className="shrink-0">
                      {currentTemplate.unsupportedWarnings.map((w, idx) => (
                        <div key={idx}>{w}</div>
                      ))}
                    </StatusBanner>
                  )}

                {/* Persistent Batch Report Panel (T-36) */}
                {batchReport && (
                  <BatchGenerationReportPanel
                    report={batchReport}
                    onClose={() => setBatchReport(null)}
                  />
                )}

                {/* Preview Body */}
                <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 font-serif text-slate-800 dark:text-slate-200 text-xs leading-relaxed whitespace-pre-wrap select-text min-h-0">
                  {previewText}
                </div>

                {/* Export Actions */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    {isCurrentDocx ? (
                      <>
                        <Info className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>
                          Для готовых <strong className="text-slate-700 dark:text-slate-300">.DOCX</strong>{' '}
                          шаблонов формируется Word (.docx); PDF требует локального Word/LibreOffice.
                        </span>
                      </>
                    ) : (
                      <span>
                        Форматы: <strong className="text-slate-700 dark:text-slate-300">Word (.docx)</strong> и{' '}
                        <strong className="text-slate-700 dark:text-slate-300">PDF (Кириллица)</strong>
                      </span>
                    )}
                  </div>

                  {currentTemplate && !currentTemplate.isArchived && (
                    <div className="flex flex-wrap items-center gap-2">
                      {isCurrentGroup ? (
                        <>
                          <AppButton
                            variant="primary"
                            size="md"
                            loading={isGenerating}
                            disabled={batchTargetRows.length === 0}
                            onClick={() => void handleGenerateGroupDocument('docx')}
                            data-testid="group-generate-docx-btn"
                            icon={
                              isGenerating ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Users className="w-3.5 h-3.5" />
                              )
                            }
                          >
                            Сводный .DOCX ({batchTargetRows.length})
                          </AppButton>
                          <AppButton
                            variant="danger"
                            size="md"
                            loading={isGenerating}
                            disabled={batchTargetRows.length === 0}
                            onClick={() => void handleGenerateGroupDocument('pdf')}
                            data-testid="group-generate-pdf-btn"
                            icon={
                              isGenerating ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <FileDown className="w-3.5 h-3.5" />
                              )
                            }
                          >
                            Сводный .PDF ({batchTargetRows.length})
                          </AppButton>
                        </>
                      ) : isBatchMode ? (
                        <>
                          <AppButton
                            variant="secondary"
                            size="md"
                            loading={isGenerating}
                            disabled={
                              boundTab.rows.length === 0 ||
                              (isCurrentDocx && Boolean(activeDocxState.error))
                            }
                            onClick={() => void handleBatchGenerate('docx', { asZip: true })}
                            data-testid="batch-generate-zip-btn"
                            title="Сформировать по всем выбранным строкам и скачать единым ZIP-архивом"
                            icon={
                              isGenerating ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <FileArchive className="w-3.5 h-3.5 text-indigo-600" />
                              )
                            }
                          >
                            Пакет .ZIP (.DOCX)
                          </AppButton>
                          <AppButton
                            variant="primary"
                            size="md"
                            loading={isGenerating}
                            disabled={
                              boundTab.rows.length === 0 ||
                              (isCurrentDocx && Boolean(activeDocxState.error))
                            }
                            onClick={() => void handleBatchGenerate('docx')}
                            data-testid="batch-generate-docx-btn"
                            icon={
                              isGenerating ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <FileDown className="w-3.5 h-3.5" />
                              )
                            }
                          >
                            Пакет .DOCX
                          </AppButton>
                          <AppButton
                            variant="danger"
                            size="md"
                            loading={isGenerating}
                            disabled={boundTab.rows.length === 0 || isCurrentDocx}
                            title={
                              isCurrentDocx
                                ? 'Пакетная генерация PDF для готовых .DOCX шаблонов недоступна в браузере (требуется Word/LibreOffice)'
                                : undefined
                            }
                            onClick={() => void handleBatchGenerate('pdf')}
                            data-testid="batch-generate-pdf-btn"
                            icon={
                              isGenerating ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <FileDown className="w-3.5 h-3.5" />
                              )
                            }
                          >
                            Пакет .PDF
                          </AppButton>
                        </>
                      ) : (
                        <>
                          <AppButton
                            variant="primary"
                            size="md"
                            loading={isGenerating}
                            disabled={
                              !targetRow || (isCurrentDocx && Boolean(activeDocxState.error))
                            }
                            onClick={() => void handleGenerateSingle('docx')}
                            data-testid="single-generate-docx-btn"
                            icon={
                              isGenerating ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )
                            }
                          >
                            Сформировать .DOCX
                          </AppButton>
                          <AppButton
                            variant="danger"
                            size="md"
                            loading={isGenerating}
                            disabled={!targetRow || isCurrentDocx}
                            title={
                              isCurrentDocx
                                ? 'Экспорт в PDF для готовых .DOCX шаблонов недоступен в браузере (требуется Word/LibreOffice)'
                                : undefined
                            }
                            onClick={() => void handleGenerateSingle('pdf')}
                            data-testid="single-generate-pdf-btn"
                            icon={
                              isGenerating ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )
                            }
                          >
                            Сформировать .PDF
                          </AppButton>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </AppModal>

      <ConfirmDialog
        isOpen={Boolean(pendingDiscardAction)}
        danger
        title="Отменить несохранённые изменения шаблона?"
        description={
          pendingDiscardAction?.isClosingModal
            ? 'В редакторе шаблона есть несохранённые изменения. Закрыть окно без сохранения?'
            : 'В редакторе шаблона есть несохранённые изменения. Продолжить без сохранения?'
        }
        confirmLabel="Не сохранять"
        cancelLabel="Вернуться к правке"
        onConfirm={() => {
          const pending = pendingDiscardAction;
          setPendingDiscardAction(null);
          if (pending) {
            setEditorMode('none');
            setEditorInitialDraft(null);
            setEditorErrors({});
            setDraftDocx(null);
            setDocxDropError(null);
            pending.action();
          }
        }}
        onCancel={() => setPendingDiscardAction(null)}
      />
    </>
  );
};
