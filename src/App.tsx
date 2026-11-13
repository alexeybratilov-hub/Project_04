/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Usb, AlertTriangle, RefreshCw, Download } from 'lucide-react';
import { TitleBar } from './components/TitleBar';
import { MenuBar } from './components/MenuBar';
import { TabBar } from './components/TabBar';
import { DataGrid } from './components/DataGrid';
import { StatusBar } from './components/StatusBar';
import { MasterJumpDialog } from './components/MasterJumpDialog';
import { ExcelImportModal } from './components/ExcelImportModal';
import { RelationsSchemaModal } from './components/RelationsSchemaModal';
import { TagsModal } from './components/TagsModal';
import { TemplatesModal, TemplatesModalScope } from './components/TemplatesModal';
import { NormativeDocsModal } from './components/NormativeDocsModal';
import { LLMStudioModal } from './components/LLMStudioModal';
import { WindowsPortableModal } from './components/WindowsPortableModal';
import { ColumnEditorModal } from './components/ColumnEditorModal';
import { BackupModal } from './components/BackupModal';
import { HelpModal } from './components/HelpModal';
import { NewTabModal } from './components/NewTabModal';
import { MasterDependenciesModal } from './components/MasterDependenciesModal';
import { LegalEntityModal, LegalEntityModalMode } from './components/LegalEntityModal';
import { GeneratedDocsModal } from './components/GeneratedDocsModal';
import { RecordGeneratedDocPayload } from './components/LLMStudioModal';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { useToast } from './components/ui/ToastProvider';

import { Column, DatabaseState, LegalEntity, LegalEntityProfile, Row, Tab } from './types/database';
import {
  CloneEntityMode,
  NativeBootstrapResult,
  SaveStatusState,
  cloneLegalEntity,
  createIsolatedEmptyEntity,
  normalizeDatabaseState,
  storageService
} from './services/storageService';
import { localApiClient, StorageMode } from './services/localApiClient';
import { createUniqueId, integrityService } from './services/integrityService';
import { excelService } from './services/excelService';
import { documentGenerator } from './services/documentGenerator';
import {
  archiveExistingDocManually,
  formatBytesReadable,
  registerGeneratedDocument
} from './services/generatedDocsService';

export default function App() {
  const { showToast } = useToast();

  const [storageMode, setStorageMode] = useState<StorageMode>(() => storageService.getMode());
  const [isBootstrapping, setIsBootstrapping] = useState<boolean>(() => localApiClient.isNative());
  const [dbState, setDbState] = useState<DatabaseState>(() => storageService.loadDatabase());
  const [activeTabId, setActiveTabId] = useState<string>(() => dbState.tabs[0]?.id || 'tab_positions');
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);

  // Selection & Grid action signals (used by MenuBar & Ctrl+F)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [focusSearchSignal, setFocusSearchSignal] = useState(0);
  const [deleteSelectedSignal, setDeleteSelectedSignal] = useState(0);

  // Disk persistence tracking & recovery banner state
  const [saveStatus, setSaveStatus] = useState<SaveStatusState>('saved');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [usbDisconnected, setUsbDisconnected] = useState<boolean>(false);
  const [migrationCandidate, setMigrationCandidate] =
    useState<NativeBootstrapResult['migrationCandidate'] | null>(null);

  const latestDbRef = useRef<DatabaseState>(dbState);
  latestDbRef.current = dbState;
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Modals state
  const [isExcelImportOpen, setIsExcelImportOpen] = useState(false);
  const [isRelationsSchemaOpen, setIsRelationsSchemaOpen] = useState(false);
  const [isRelationsAuditMode, setIsRelationsAuditMode] = useState(false);
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false);
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false);
  const [templatesModalScope, setTemplatesModalScope] = useState<TemplatesModalScope>('tab');
  const [isGeneratedDocsOpen, setIsGeneratedDocsOpen] = useState(false);
  const [templateSelectedRowIds, setTemplateSelectedRowIds] = useState<string[] | undefined>(undefined);
  const [isNormativeDocsOpen, setIsNormativeDocsOpen] = useState(false);
  const [isLLMStudioOpen, setIsLLMStudioOpen] = useState(false);
  const [llmInitialSubTab, setLlmInitialSubTab] = useState<'generate' | 'settings' | 'history'>('generate');
  const [llmTargetRowId, setLlmTargetRowId] = useState<string | undefined>(undefined);
  const [isWindowsPortableOpen, setIsWindowsPortableOpen] = useState(false);
  const [isColumnEditorOpen, setIsColumnEditorOpen] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isNewTabModalOpen, setIsNewTabModalOpen] = useState(false);
  const [masterDepsTabId, setMasterDepsTabId] = useState<string | null>(null);
  const [pendingDeleteTabId, setPendingDeleteTabId] = useState<string | null>(null);
  const [pendingMasterRowDelete, setPendingMasterRowDelete] = useState<{
    tabId: string;
    rowIds: string[];
    summary: string;
  } | null>(null);

  // Legal Entity Modal state (create / edit card / clone)
  const [entityModalState, setEntityModalState] = useState<{
    isOpen: boolean;
    mode: LegalEntityModalMode;
    targetEntity: LegalEntity | null;
  }>({
    isOpen: false,
    mode: 'create',
    targetEntity: null
  });

  // Master jump dialog state
  const [masterJumpInfo, setMasterJumpInfo] = useState<{
    isOpen: boolean;
    masterTab?: Tab;
    columnName: string;
    currentValue: any;
    targetMasterRowId?: string;
    targetMasterTabId?: string;
    attemptCount: number;
  }>({
    isOpen: false,
    columnName: '',
    currentValue: '',
    attemptCount: 0
  });

  // Sequential persistence engine (prevents concurrent PUT races and revision 409 on rapid edits)
  const persistState = useCallback(
    (targetState: DatabaseState, notifySuccess = false) => {
      setSaveStatus('saving');
      saveQueueRef.current = saveQueueRef.current
        .then(async () => {
          const res = await storageService.saveDatabaseAsync(targetState);
          if (res.ok) {
            setSaveStatus('saved');
            setSaveErrorMessage(null);
            setUsbDisconnected(false);
            if (notifySuccess) {
              showToast('База данных успешно сохранена.', 'success');
            }
          } else {
            const nextStatus: SaveStatusState = res.usbDisconnected
              ? 'usb_disconnected'
              : res.isConflict
                ? 'conflict'
                : 'error';
            setSaveStatus(nextStatus);
            setUsbDisconnected(Boolean(res.usbDisconnected));
            setSaveErrorMessage(res.message || 'Ошибка сохранения базы данных');
            showToast(res.message || 'Не удалось сохранить изменения', 'error');
          }
        })
        .catch((err: any) => {
          setSaveStatus('error');
          setSaveErrorMessage(err?.message || 'Непредвиденная ошибка сохранения');
        });
    },
    [showToast]
  );

  // Bootstrap disk DB + legacy migration check on mount
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const res = await storageService.bootstrapDatabase();
      if (cancelled) return;

      setStorageMode(res.mode);
      setDbState(res.state);
      latestDbRef.current = res.state;
      setActiveTabId((prev) =>
        res.state.tabs.some((t) => t.id === prev) ? prev : res.state.tabs[0]?.id || 'tab_positions'
      );

      if (res.migrationCandidate) {
        setMigrationCandidate(res.migrationCandidate);
      }
      if (res.health?.restoredFromBackup) {
        showToast(
          'Основной файл ot_database.json был повреждён — данные восстановлены из резервной копии.',
          'warning'
        );
      } else if (res.health?.corruptedWarning || res.loadError) {
        setSaveStatus(res.health?.usbDisconnected ? 'usb_disconnected' : 'error');
        setSaveErrorMessage(
          res.loadError || res.health?.message || 'Ошибка чтения базы данных с диска'
        );
        showToast(res.loadError || 'Внимание: ошибка чтения файла базы данных.', 'error');
      }

      setIsBootstrapping(false);
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  // Native heartbeat (detects USB disconnect / missing storage folder) + shutdown notification
  useEffect(() => {
    if (storageMode !== 'native-fs') return;

    const timer = window.setInterval(async () => {
      const hb = await localApiClient.heartbeat();
      if (hb.usbDisconnected) {
        setUsbDisconnected(true);
        setSaveStatus('usb_disconnected');
        setSaveErrorMessage(hb.error || 'Потерян доступ к папке ./data на носителе');
      } else if (hb.ok) {
        setUsbDisconnected(false);
      }
    }, 4000);

    const handleBeforeUnload = () => {
      localApiClient.notifyShutdown();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [storageMode]);

  const activeEntity =
    dbState.entities.find((e) => e.id === dbState.activeEntityId) || dbState.entities[0];

  // Unified database state updater + disk persistence
  const updateDbState = useCallback(
    (updater: (prev: DatabaseState) => DatabaseState) => {
      setDbState((prev) => {
        const updated = updater(prev);
        const now = new Date().toISOString();

        const entityExplicitlyChanged =
          updated.activeEntityId !== prev.activeEntityId || updated.entities !== prev.entities;

        const syncedEntities = entityExplicitlyChanged
          ? updated.entities
          : updated.entities.map((ent) =>
              ent.id === updated.activeEntityId
                ? {
                    ...ent,
                    tabs: updated.tabs,
                    tags: updated.tags,
                    templates: updated.templates,
                    generatedDocs: updated.generatedDocs,
                    llmLogs: updated.llmLogs,
                    updatedAt: now
                  }
                : ent
            );

        const finalState: DatabaseState = {
          ...updated,
          entities: syncedEntities,
          lastSaved: now
        };
        latestDbRef.current = finalState;
        persistState(finalState);
        return finalState;
      });
    },
    [persistState]
  );

  // Sync theme with document element
  useEffect(() => {
    if (dbState.settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [dbState.settings.theme]);

  const currentTab = dbState.tabs.find((t) => t.id === activeTabId) || dbState.tabs[0];

  // ===================== CRUD OPERATIONS =====================

  const handleAddRow = useCallback(() => {
    if (!currentTab) return;
    const newRowId = createUniqueId('row');
    const newRow: Row = { id: newRowId };

    currentTab.columns.forEach((col) => {
      if (col.type === 'boolean') newRow[col.id] = false;
      else if (col.type === 'number') newRow[col.id] = 0;
      else if (col.type === 'date') newRow[col.id] = new Date().toISOString().split('T')[0];
      else newRow[col.id] = '';
    });

    updateDbState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === currentTab.id ? { ...t, rows: [newRow, ...t.rows] } : t))
    }));
  }, [currentTab, updateDbState]);

  // Global Keyboard Shortcuts (Ctrl+S, Ctrl+N, Ctrl+F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        persistState(latestDbRef.current, true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleAddRow();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFocusSearchSignal((n) => n + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAddRow, persistState]);

  // Update single cell with cascade update to dependent tabs if master column
  const handleUpdateCell = (rowId: string, columnId: string, newValue: any) => {
    if (!currentTab) return;
    const oldRow = currentTab.rows.find((r) => r.id === rowId);
    const oldValue = oldRow ? oldRow[columnId] : undefined;

    updateDbState((prev) => {
      let updatedTabs = prev.tabs.map((t) => {
        if (t.id !== currentTab.id) return t;
        return {
          ...t,
          rows: t.rows.map((r) => (r.id === rowId ? { ...r, [columnId]: newValue } : r))
        };
      });

      if (oldValue !== undefined && oldValue !== newValue && String(oldValue).trim() !== '') {
        updatedTabs = updatedTabs.map((depTab) => {
          let hasRelation = false;
          const matchingCols = depTab.columns.filter(
            (c) => c.relation?.masterTabId === currentTab.id && c.relation?.masterColumnId === columnId
          );

          if (matchingCols.length === 0) return depTab;

          const updatedRows = depTab.rows.map((depRow) => {
            const rowCopy = { ...depRow };
            matchingCols.forEach((relCol) => {
              if (rowCopy[relCol.id] === oldValue) {
                rowCopy[relCol.id] = newValue;
                hasRelation = true;
              }
            });
            return rowCopy;
          });

          return hasRelation ? { ...depTab, rows: updatedRows } : depTab;
        });
      }

      return { ...prev, tabs: updatedTabs };
    });
  };

  // Update multiple cells on a single row
  const handleUpdateRowMulti = (rowId: string, patch: Record<string, any>) => {
    if (!currentTab) return;
    updateDbState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === currentTab.id
          ? { ...t, rows: t.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) }
          : t
      )
    }));
  };

  // Insert rows from inline Excel paste at clicked row offset (shifting lower rows down)
  const handleInsertBulkRows = (newRows: Row[], insertIndex?: number) => {
    if (!currentTab || newRows.length === 0) return;
    updateDbState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => {
        if (t.id !== currentTab.id) return t;
        const idx =
          insertIndex !== undefined
            ? Math.max(0, Math.min(t.rows.length, insertIndex))
            : t.rows.length;
        const nextRows = [...t.rows];
        nextRows.splice(idx, 0, ...newRows);
        return { ...t, rows: nextRows };
      })
    }));
    showToast(`Вставлено строк из Excel: ${newRows.length}`, 'success');
  };

  // Execute row deletion directly
  const executeRowDelete = (tabId: string, rowIds: string[]) => {
    const rowIdSet = new Set(rowIds);
    updateDbState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === tabId ? { ...t, rows: t.rows.filter((r) => !rowIdSet.has(r.id)) } : t
      )
    }));
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      rowIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  // Delete rows with Master reference impact check
  const handleDeleteRows = (rowIds: string[]) => {
    if (!currentTab || rowIds.length === 0) return;

    const impact = integrityService.getRowDeleteImpact(currentTab, rowIds, dbState.tabs);
    if (impact.totalAffectedRows > 0) {
      const summary = impact.affectedTabs
        .map((t) => `«${t.tabName}» (${t.affectedRowCount} строк)`)
        .join(', ');
      setPendingMasterRowDelete({ tabId: currentTab.id, rowIds, summary });
      return;
    }

    executeRowDelete(currentTab.id, rowIds);
  };

  // Open New Tab wizard modal
  const handleAddTab = () => {
    if (dbState.tabs.length >= 20) {
      showToast('Достигнут лимит вкладок (максимум 20).', 'warning');
      return;
    }
    setIsNewTabModalOpen(true);
  };

  // Create new tab from NewTabModal
  const handleCreateTabFromModal = ({
    name,
    isMaster,
    columns,
    openMasterDepsAfter
  }: {
    name: string;
    isMaster: boolean;
    columns: Column[];
    openMasterDepsAfter?: boolean;
  }) => {
    const newTabId = createUniqueId('tab');
    const newTab: Tab = {
      id: newTabId,
      name,
      isMaster,
      columns,
      rows: [],
      attachedDocs: []
    };

    updateDbState((prev) => ({
      ...prev,
      tabs: [...prev.tabs, newTab]
    }));
    setActiveTabId(newTabId);
    if (openMasterDepsAfter) {
      setMasterDepsTabId(newTabId);
    }
  };

  // Reorder tabs via drag & drop
  const handleReorderTabs = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    updateDbState((prev) => {
      const nextTabs = [...prev.tabs];
      const [moved] = nextTabs.splice(fromIndex, 1);
      if (!moved) return prev;
      nextTabs.splice(toIndex, 0, moved);
      return { ...prev, tabs: nextTabs };
    });
  };

  // Rename tab
  const handleRenameTab = (tabId: string, newName: string) => {
    updateDbState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, name: newName } : t))
    }));
  };

  // Request delete tab
  const handleDeleteTab = (tabId: string) => {
    if (dbState.tabs.length <= 1) {
      showToast('В базе должна оставаться хотя бы одна вкладка.', 'warning');
      return;
    }
    setPendingDeleteTabId(tabId);
  };

  const confirmExecuteDeleteTab = async (mode: 'archive' | 'purge') => {
    if (!pendingDeleteTabId) return;
    const tabId = pendingDeleteTabId;
    setPendingDeleteTabId(null);

    const snapshot = latestDbRef.current;
    const tabToDel = snapshot.tabs.find((t) => t.id === tabId);
    const remainingBeforeUpdate = snapshot.tabs.filter((t) => t.id !== tabId);

    // Handle generatedDocs attached to deleted tab (archive into АРХИВ/<dd.mm.yyyy>/ or delete physically)
    let nextGeneratedDocs = snapshot.generatedDocs || [];
    if (tabToDel) {
      const matchingDocs = nextGeneratedDocs.filter((d) => d.sourceTabName === tabToDel.name);
      if (mode === 'archive') {
        for (const doc of matchingDocs) {
          if (!doc.isArchived) {
            const archived = archiveExistingDocManually(nextGeneratedDocs, doc.id);
            nextGeneratedDocs = archived.nextDocs;
            if (archived.transition && localApiClient.isNative()) {
              await localApiClient.moveDocumentInBucket(
                archived.transition.fromPath,
                archived.transition.toPath
              );
            }
          }
        }
      } else {
        for (const doc of matchingDocs) {
          if (localApiClient.isNative()) {
            await localApiClient.deleteFileFromBucket('documents', doc.relativePath);
          }
        }
        nextGeneratedDocs = nextGeneratedDocs.filter((d) => d.sourceTabName !== tabToDel.name);
      }
    }

    updateDbState((prev) => {
      const filtered = prev.tabs.filter((t) => t.id !== tabId);
      const cleanedTabs = integrityService.cleanReferencesAfterTabDelete(filtered, tabId);
      const cleanedTags = integrityService.pruneOrphanedTags(prev.tags, cleanedTabs);
      const nextTemplates =
        mode === 'archive'
          ? integrityService.archiveTabTemplates(prev.templates, tabId, tabToDel?.name || 'Удалённая вкладка')
          : integrityService.deleteTabTemplates(prev.templates, tabId);

      return {
        ...prev,
        tabs: cleanedTabs,
        tags: cleanedTags,
        templates: nextTemplates,
        generatedDocs: nextGeneratedDocs
      };
    });

    if (remainingBeforeUpdate.length > 0 && activeTabId === tabId) {
      setActiveTabId(remainingBeforeUpdate[0].id);
    }
    showToast(
      mode === 'archive'
        ? 'Вкладка удалена, связанные шаблоны и документы перенесены в архив.'
        : 'Вкладка, привязанные шаблоны и связанные данные удалены.',
      'info'
    );
  };

  // Apply Master table status and push/sync column links across target tables
  const handleApplyMasterDependencies = (
    masterTabId: string,
    linksByTargetTab: Record<string, string[]>
  ) => {
    updateDbState((prev) => {
      const masterTab = prev.tabs.find((t) => t.id === masterTabId);
      if (!masterTab) return prev;

      const updatedTabs = prev.tabs.map((t) => {
        if (t.id === masterTabId) {
          return { ...t, isMaster: true };
        }

        const chosenMasterColIds = linksByTargetTab[t.id] || [];
        let updatedCols = [...t.columns];
        let updatedRows = [...t.rows];

        updatedCols = updatedCols.map((col) => {
          if (
            col.type === 'relation' &&
            col.relation?.masterTabId === masterTabId &&
            !chosenMasterColIds.includes(col.relation.masterColumnId)
          ) {
            const { relation: _removed, ...rest } = col;
            return { ...rest, type: 'text' as const };
          }
          return col;
        });

        chosenMasterColIds.forEach((mColId) => {
          const mCol = masterTab.columns.find((mc) => mc.id === mColId);
          if (!mCol) return;

          const alreadyLinked = updatedCols.some(
            (c) =>
              c.type === 'relation' &&
              c.relation?.masterTabId === masterTabId &&
              c.relation?.masterColumnId === mColId
          );
          if (alreadyLinked) return;

          const sameNameIdx = updatedCols.findIndex(
            (c) => c.name.trim().toLowerCase() === mCol.name.trim().toLowerCase()
          );

          if (sameNameIdx !== -1) {
            updatedCols[sameNameIdx] = {
              ...updatedCols[sameNameIdx],
              name: mCol.name,
              type: 'relation',
              width: updatedCols[sameNameIdx].width || mCol.width || 190,
              relation: { masterTabId, masterColumnId: mColId }
            };
          } else {
            const newColId = createUniqueId('col');
            updatedCols.push({
              id: newColId,
              name: mCol.name,
              type: 'relation',
              width: mCol.width || 190,
              relation: { masterTabId, masterColumnId: mColId }
            });
            updatedRows = updatedRows.map((r) => ({ ...r, [newColId]: '' }));
          }
        });

        return { ...t, columns: updatedCols, rows: updatedRows };
      });

      return { ...prev, tabs: updatedTabs };
    });
  };

  // Direct Add Column to Tab helper
  const handleAddColumnToTab = (tabId: string, newCol: Column) => {
    updateDbState((prev) => {
      const nextTabs = prev.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const newCols = [...t.columns, newCol];
        const updatedRows = t.rows.map((r) => ({
          ...r,
          [newCol.id]:
            r[newCol.id] !== undefined
              ? r[newCol.id]
              : newCol.type === 'boolean'
                ? false
                : newCol.type === 'number'
                  ? 0
                  : ''
        }));
        return {
          ...t,
          columns: newCols,
          rows: updatedRows
        };
      });
      return { ...prev, tabs: nextTabs };
    });
  };

  // Update a single column (name, width, etc.)
  const handleUpdateColumn = (tabId: string, columnId: string, patch: Partial<Column>) => {
    updateDbState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              columns: t.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c))
            }
          : t
      )
    }));
  };

  // ===================== RELATION NAVIGATION =====================

  const handleAttemptEditRelation = (column: Column, row: Row) => {
    if (!column.relation) return;
    const masterTab = dbState.tabs.find((t) => t.id === column.relation?.masterTabId);
    const currentValue = row[column.id];

    let targetMasterRowId: string | undefined;
    if (masterTab && currentValue) {
      const match = masterTab.rows.find(
        (r) => String(r[column.relation!.masterColumnId] ?? '').toLowerCase() === String(currentValue).toLowerCase()
      );
      if (match) targetMasterRowId = match.id;
    }

    setMasterJumpInfo((prev) => ({
      isOpen: true,
      masterTab,
      columnName: column.name,
      currentValue,
      targetMasterRowId,
      targetMasterTabId: masterTab?.id,
      attemptCount: prev.isOpen && prev.columnName === column.name ? prev.attemptCount + 1 : 1
    }));
  };

  const handleConfirmJumpToMaster = () => {
    if (masterJumpInfo.targetMasterTabId) {
      setActiveTabId(masterJumpInfo.targetMasterTabId);
      if (masterJumpInfo.targetMasterRowId) {
        setHighlightedRowId(masterJumpInfo.targetMasterRowId);
        setTimeout(() => setHighlightedRowId(null), 3500);
      }
    }
    setMasterJumpInfo((prev) => ({ ...prev, isOpen: false }));
  };

  // ===================== EXCEL IMPORT COMMITS =====================

  const handleCommitImportNewTab = (sheetName: string, columns: Column[], rows: Record<string, any>[]) => {
    const newTabId = createUniqueId('tab_imp');
    const newTab: Tab = {
      id: newTabId,
      name: sheetName.slice(0, 30),
      columns,
      rows: rows as Row[],
      attachedDocs: []
    };

    updateDbState((prev) => ({
      ...prev,
      tabs: [...prev.tabs, newTab]
    }));
    setActiveTabId(newTabId);
    showToast(`Импортирована новая вкладка «${newTab.name}» (${rows.length} строк).`, 'success');
  };

  const handleCommitImportExistingTab = (tabId: string, rows: Record<string, any>[]) => {
    updateDbState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, rows: [...t.rows, ...(rows as Row[])] } : t))
    }));
    showToast(`Добавлено строк из Excel: ${rows.length}`, 'success');
  };

  // ===================== LEGAL ENTITIES OPERATIONS =====================

  const handleSelectEntity = (entityId: string) => {
    const target = dbState.entities.find((e) => e.id === entityId);
    if (!target || target.id === dbState.activeEntityId) return;

    updateDbState((prev) => {
      const nextTarget = prev.entities.find((e) => e.id === entityId);
      if (!nextTarget) return prev;
      return {
        ...prev,
        activeEntityId: nextTarget.id,
        tabs: nextTarget.tabs,
        tags: nextTarget.tags,
        templates: nextTarget.templates,
        generatedDocs: nextTarget.generatedDocs || [],
        llmLogs: nextTarget.llmLogs || []
      };
    });

    setActiveTabId(target.tabs[0]?.id || '');
    setHighlightedRowId(null);
    setPendingDeleteTabId(null);
    setMasterDepsTabId(null);
    setSelectedRowIds(new Set());
  };

  const handleSaveLegalEntity = ({
    mode,
    entityId,
    profile,
    sourceEntityId,
    cloneMode
  }: {
    mode: LegalEntityModalMode;
    entityId?: string;
    profile: LegalEntityProfile;
    sourceEntityId?: string;
    cloneMode?: CloneEntityMode;
  }) => {
    if (mode === 'edit' && entityId) {
      updateDbState((prev) => ({
        ...prev,
        entities: prev.entities.map((ent) =>
          ent.id === entityId
            ? { ...ent, profile, updatedAt: new Date().toISOString() }
            : ent
        )
      }));
      showToast(`Реквизиты «${profile.shortName}» обновлены.`, 'success');
      return;
    }

    let newEntity: LegalEntity;
    if (mode === 'clone') {
      const source =
        dbState.entities.find((e) => e.id === sourceEntityId) || activeEntity;
      newEntity = cloneLegalEntity(source, profile, cloneMode || 'structure_only');
    } else {
      newEntity = createIsolatedEmptyEntity(profile);
    }

    updateDbState((prev) => ({
      ...prev,
      activeEntityId: newEntity.id,
      entities: [...prev.entities, newEntity],
      tabs: newEntity.tabs,
      tags: newEntity.tags,
      templates: newEntity.templates,
      generatedDocs: newEntity.generatedDocs || [],
      llmLogs: newEntity.llmLogs
    }));
    setActiveTabId(newEntity.tabs[0]?.id || '');
    setHighlightedRowId(null);
    setSelectedRowIds(new Set());
    showToast(`Организация «${profile.shortName}» добавлена.`, 'success');
  };

  const handleDeleteEntity = (entityId: string) => {
    if (dbState.entities.length <= 1) return;
    const remaining = dbState.entities.filter((e) => e.id !== entityId);
    const nextActive =
      dbState.activeEntityId === entityId
        ? remaining[0]
        : remaining.find((e) => e.id === dbState.activeEntityId) || remaining[0];

    updateDbState((prev) => ({
      ...prev,
      activeEntityId: nextActive.id,
      entities: remaining,
      tabs: nextActive.tabs,
      tags: nextActive.tags,
      templates: nextActive.templates,
      generatedDocs: nextActive.generatedDocs || [],
      llmLogs: nextActive.llmLogs
    }));

    if (dbState.activeEntityId === entityId) {
      setActiveTabId(nextActive.tabs[0]?.id || '');
      setSelectedRowIds(new Set());
    }
    showToast('Юридическое лицо удалено из базы.', 'info');
  };

  // ===================== GENERATED DOCS & ARCHIVE LIFECYCLE =====================

  const handleRecordGeneratedDoc = async (payload: RecordGeneratedDocPayload) => {
    const dataBase64 =
      !localApiClient.isNative() && payload.blob.size <= 1_500_000
        ? await documentGenerator.blobToBase64(payload.blob)
        : undefined;

    const regResult = registerGeneratedDocument(latestDbRef.current.generatedDocs || [], {
      id: createUniqueId('gdoc'),
      title: payload.title,
      fileName: payload.fileName,
      category: payload.category,
      format: payload.format,
      sourceTabName: payload.sourceTabName,
      rowIdentifier: payload.rowIdentifier,
      sizeFormatted: formatBytesReadable(payload.blob.size),
      dataBase64
    });

    if (localApiClient.isNative()) {
      for (const transition of regResult.archivedTransitions) {
        const moveRes = await localApiClient.moveDocumentInBucket(
          transition.fromPath,
          transition.toPath
        );
        if (!moveRes.ok) {
          showToast(
            moveRes.message || `Не удалось перенести старую версию в ${transition.toPath}`,
            'warning'
          );
        }
      }
    }

    await documentGenerator.saveAndDownloadBlob(
      payload.blob,
      regResult.newRecord.fileName,
      true,
      regResult.newRecord.relativePath
    );

    updateDbState((prev) => ({
      ...prev,
      generatedDocs: regResult.nextDocs
    }));

    if (regResult.archivedTransitions.length > 0) {
      const folder = regResult.archivedTransitions[0].archivedRecord.archiveDateFolder;
      showToast(
        `Предыдущая версия перенесена в «${payload.category}/АРХИВ/${folder}»`,
        'info'
      );
    }
  };

  const handleArchiveDoc = async (docId: string) => {
    const result = archiveExistingDocManually(latestDbRef.current.generatedDocs || [], docId);
    if (!result.transition) return;

    if (localApiClient.isNative()) {
      const moveRes = await localApiClient.moveDocumentInBucket(
        result.transition.fromPath,
        result.transition.toPath
      );
      if (!moveRes.ok) {
        showToast(moveRes.message || 'Не удалось перенести файл в папку АРХИВ на диске', 'error');
        return;
      }
    }

    updateDbState((prev) => ({
      ...prev,
      generatedDocs: result.nextDocs
    }));
    showToast(
      `Документ перенесён в «${result.transition.archivedRecord.category}/АРХИВ/${result.transition.archivedRecord.archiveDateFolder}»`,
      'info'
    );
  };

  const handleDeleteDoc = async (docId: string) => {
    const target = (latestDbRef.current.generatedDocs || []).find((d) => d.id === docId);
    if (target && localApiClient.isNative()) {
      await localApiClient.deleteFileFromBucket('documents', target.relativePath);
    }
    updateDbState((prev) => ({
      ...prev,
      generatedDocs: (prev.generatedDocs || []).filter((d) => d.id !== docId)
    }));
    showToast('Документ удалён из реестра', 'info');
  };

  if (isBootstrapping) {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-screen bg-slate-900 text-slate-200 gap-3 text-xs">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
        <div className="font-semibold text-sm">Загрузка базы данных ОТ-База...</div>
        <div className="text-slate-400 font-mono">./data/ot_database.json</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-100 overflow-hidden font-sans">
      {/* 1. Header with Legal Entity Switcher & Save Status */}
      <TitleBar
        settings={dbState.settings}
        onUpdateSettings={(newSettings) => updateDbState((p) => ({ ...p, settings: { ...p.settings, ...newSettings } }))}
        onOpenPortableModal={() => setIsWindowsPortableOpen(true)}
        lastSaved={dbState.lastSaved}
        saveStatus={saveStatus}
        storageMode={storageMode}
        onRetrySave={() => persistState(latestDbRef.current, true)}
        entities={dbState.entities}
        activeEntity={activeEntity}
        onSelectEntity={handleSelectEntity}
        onOpenCreateEntity={() => setEntityModalState({ isOpen: true, mode: 'create', targetEntity: null })}
        onOpenEditEntity={(ent) => setEntityModalState({ isOpen: true, mode: 'edit', targetEntity: ent })}
        onOpenCloneEntity={(ent) => setEntityModalState({ isOpen: true, mode: 'clone', targetEntity: ent })}
        onDeleteEntity={handleDeleteEntity}
      />

      {/* 2. Menu Bar */}
      <MenuBar
        onSave={() => persistState(latestDbRef.current, true)}
        onExportExcel={() => excelService.exportTabToXlsx(currentTab, dbState.tabs)}
        onFullBackup={() => setIsBackupOpen(true)}
        onRestore={() => setIsBackupOpen(true)}
        onOpenPortableModal={() => setIsWindowsPortableOpen(true)}
        onAddRow={handleAddRow}
        onDeleteSelectedRows={() => setDeleteSelectedSignal((n) => n + 1)}
        selectedRowsCount={selectedRowIds.size}
        onFocusSearch={() => setFocusSearchSignal((n) => n + 1)}
        onAddTab={handleAddTab}
        onOpenColumnEditor={() => setIsColumnEditorOpen(true)}
        onOpenRelationsSchema={() => {
          setIsRelationsAuditMode(false);
          setIsRelationsSchemaOpen(true);
        }}
        onAuditRelations={() => {
          setIsRelationsAuditMode(true);
          setIsRelationsSchemaOpen(true);
        }}
        onOpenTagsModal={() => setIsTagsModalOpen(true)}
        onOpenAllTemplates={() => {
          setTemplateSelectedRowIds(undefined);
          setTemplatesModalScope('all');
          setIsTemplatesModalOpen(true);
        }}
        onOpenGeneratedDocs={() => setIsGeneratedDocsOpen(true)}
        generatedDocsCount={dbState.generatedDocs.length}
        onOpenNormativeDocs={() => setIsNormativeDocsOpen(true)}
        onOpenLLMStudio={() => {
          setLlmTargetRowId(undefined);
          setLlmInitialSubTab('generate');
          setIsLLMStudioOpen(true);
        }}
        onOpenLLMSettings={() => {
          setLlmTargetRowId(undefined);
          setLlmInitialSubTab('settings');
          setIsLLMStudioOpen(true);
        }}
        llmConfig={dbState.llmConfig}
        onOpenHelp={() => setIsHelpOpen(true)}
      />

      {/* Persistent Recovery Banner for USB Disconnect / Write Error / Revision Conflict */}
      {(saveStatus === 'usb_disconnected' || saveStatus === 'error' || saveStatus === 'conflict') && (
        <div className="px-4 py-2 bg-red-600 text-white text-xs flex flex-wrap items-center justify-between gap-2 shrink-0 z-30">
          <div className="flex items-center gap-2 font-medium">
            {saveStatus === 'usb_disconnected' ? (
              <Usb className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>
              {saveErrorMessage || 'Ошибка записи на диск. Подключите носитель и повторите сохранение.'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => persistState(latestDbRef.current, true)}
              className="px-2.5 py-1 bg-white text-red-700 hover:bg-red-50 rounded font-semibold flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Повторить запись</span>
            </button>
            <button
              type="button"
              onClick={() => storageService.exportDatabaseToFile(latestDbRef.current)}
              className="px-2.5 py-1 bg-red-800 hover:bg-red-900 text-white rounded font-medium flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3 h-3" />
              <span>Скачать копию JSON</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. Multi-Tab Navigation Bar */}
      <TabBar
        tabs={dbState.tabs}
        activeTabId={activeTabId}
        onSelectTab={(tabId) => setActiveTabId(tabId)}
        onAddTab={handleAddTab}
        onRenameTab={handleRenameTab}
        onDeleteTab={handleDeleteTab}
        onReorderTabs={handleReorderTabs}
        onToggleMaster={(tabId) => {
          updateDbState((p) => ({
            ...p,
            tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, isMaster: !t.isMaster } : t))
          }));
        }}
        onConfigureMasterDeps={(tabId) => setMasterDepsTabId(tabId)}
        onOpenColumnEditor={() => setIsColumnEditorOpen(true)}
      />

      {/* 4. Active Data Grid View */}
      {currentTab && (
        <DataGrid
          currentTab={currentTab}
          allTabs={dbState.tabs}
          sharedNormativeCount={dbState.normativeDocs.length}
          tabTemplatesCount={
            dbState.templates.filter((tpl) => !tpl.isArchived && tpl.tabId === currentTab.id).length
          }
          selectedRowIds={selectedRowIds}
          onSelectedRowIdsChange={setSelectedRowIds}
          focusSearchSignal={focusSearchSignal}
          deleteSelectedSignal={deleteSelectedSignal}
          onAddRow={handleAddRow}
          onInsertBulkRows={handleInsertBulkRows}
          onUpdateCell={handleUpdateCell}
          onUpdateRowMulti={handleUpdateRowMulti}
          onDeleteRows={handleDeleteRows}
          onOpenExcelImport={() => setIsExcelImportOpen(true)}
          onExportExcel={() => excelService.exportTabToXlsx(currentTab, dbState.tabs)}
          onOpenColumnEditor={() => setIsColumnEditorOpen(true)}
          onOpenNormativeDocs={() => setIsNormativeDocsOpen(true)}
          onOpenTemplates={(ids) => {
            setTemplateSelectedRowIds(ids);
            setTemplatesModalScope('tab');
            setIsTemplatesModalOpen(true);
          }}
          onOpenLLMStudio={(rowId) => {
            setLlmTargetRowId(rowId);
            setLlmInitialSubTab('generate');
            setIsLLMStudioOpen(true);
          }}
          onAttemptEditRelation={handleAttemptEditRelation}
          onAddColumn={(newCol) => handleAddColumnToTab(currentTab.id, newCol)}
          onUpdateColumn={(colId, patch) => handleUpdateColumn(currentTab.id, colId, patch)}
          highlightedRowId={highlightedRowId}
        />
      )}

      {/* 5. Desktop Status Bar */}
      {currentTab && (
        <StatusBar
          currentTab={currentTab}
          entityName={activeEntity.profile.shortName || activeEntity.profile.fullName}
          storageMode={storageMode}
          usbDisconnected={usbDisconnected}
          databaseDirectory={dbState.settings.databaseDirectory}
          llmConfig={dbState.llmConfig}
          onOpenLLMStudio={() => {
            setLlmInitialSubTab('settings');
            setIsLLMStudioOpen(true);
          }}
          onOpenPortableModal={() => setIsWindowsPortableOpen(true)}
        />
      )}

      {/* ===================== MODALS ===================== */}

      <MasterJumpDialog
        isOpen={masterJumpInfo.isOpen}
        onClose={() => setMasterJumpInfo((prev) => ({ ...prev, isOpen: false }))}
        onConfirmJump={handleConfirmJumpToMaster}
        masterTab={masterJumpInfo.masterTab}
        columnName={masterJumpInfo.columnName}
        currentValue={masterJumpInfo.currentValue}
        attemptCount={masterJumpInfo.attemptCount}
      />

      <ExcelImportModal
        isOpen={isExcelImportOpen}
        onClose={() => setIsExcelImportOpen(false)}
        currentTab={currentTab}
        allTabs={dbState.tabs}
        onCommitImportNewTab={handleCommitImportNewTab}
        onCommitImportExistingTab={handleCommitImportExistingTab}
      />

      <RelationsSchemaModal
        isOpen={isRelationsSchemaOpen}
        onClose={() => setIsRelationsSchemaOpen(false)}
        tabs={dbState.tabs}
        tags={dbState.tags}
        initialAuditOpen={isRelationsAuditMode}
        onSelectTab={(tabId, rowId) => {
          setActiveTabId(tabId);
          if (rowId) {
            setHighlightedRowId(rowId);
            setTimeout(() => setHighlightedRowId(null), 3500);
          }
        }}
        onRepairReferences={() => {
          updateDbState((p) => {
            const repaired = integrityService.repairBrokenReferences(p.tabs, p.tags);
            return { ...p, tabs: repaired.tabs, tags: repaired.tags };
          });
          showToast('Разорванные связи переведены в текст, битые теги очищены.', 'success');
        }}
      />

      <TagsModal
        isOpen={isTagsModalOpen}
        onClose={() => setIsTagsModalOpen(false)}
        tags={dbState.tags}
        tabs={dbState.tabs}
        templates={dbState.templates}
        onSaveTags={(newTags) => updateDbState((p) => ({ ...p, tags: newTags }))}
      />

      <TemplatesModal
        isOpen={isTemplatesModalOpen}
        onClose={() => setIsTemplatesModalOpen(false)}
        initialScope={templatesModalScope}
        templates={dbState.templates}
        currentTab={currentTab}
        allTabs={dbState.tabs}
        tags={dbState.tags}
        entityProfile={activeEntity.profile}
        selectedRowIds={templateSelectedRowIds}
        onOpenTagsModal={() => {
          setIsTemplatesModalOpen(false);
          setIsTagsModalOpen(true);
        }}
        onSaveTemplates={(newTemplates) => updateDbState((p) => ({ ...p, templates: newTemplates }))}
        onRecordGeneratedDoc={handleRecordGeneratedDoc}
      />

      <GeneratedDocsModal
        isOpen={isGeneratedDocsOpen}
        onClose={() => setIsGeneratedDocsOpen(false)}
        generatedDocs={dbState.generatedDocs}
        entityProfile={activeEntity.profile}
        onArchiveDoc={handleArchiveDoc}
        onDeleteDoc={handleDeleteDoc}
        onOpenTemplates={() => {
          setTemplateSelectedRowIds(undefined);
          setTemplatesModalScope('all');
          setIsTemplatesModalOpen(true);
        }}
      />

      <NormativeDocsModal
        isOpen={isNormativeDocsOpen}
        onClose={() => setIsNormativeDocsOpen(false)}
        currentTab={currentTab}
        normativeDocs={dbState.normativeDocs}
        onUpdateNormativeDocs={(newDocs) =>
          updateDbState((p) => ({ ...p, normativeDocs: newDocs }))
        }
      />

      <LLMStudioModal
        isOpen={isLLMStudioOpen}
        initialSubTab={llmInitialSubTab}
        onClose={() => setIsLLMStudioOpen(false)}
        currentTab={currentTab}
        allTabs={dbState.tabs}
        tags={dbState.tags}
        entityProfile={activeEntity.profile}
        sharedNormativeDocs={dbState.normativeDocs}
        llmConfig={dbState.llmConfig}
        llmLogs={dbState.llmLogs}
        selectedRowId={llmTargetRowId}
        onSaveLLMConfig={(newConfig) => updateDbState((p) => ({ ...p, llmConfig: newConfig }))}
        onAddLLMLog={(newLog) => updateDbState((p) => ({ ...p, llmLogs: [newLog, ...p.llmLogs] }))}
        onRecordGeneratedDoc={handleRecordGeneratedDoc}
      />

      <WindowsPortableModal
        isOpen={isWindowsPortableOpen}
        onClose={() => setIsWindowsPortableOpen(false)}
        databaseState={dbState}
        onUpdateSettings={(newSettings) => updateDbState((p) => ({ ...p, settings: { ...p.settings, ...newSettings } }))}
      />

      <ColumnEditorModal
        isOpen={isColumnEditorOpen}
        onClose={() => setIsColumnEditorOpen(false)}
        currentTab={currentTab}
        allTabs={dbState.tabs}
        tags={dbState.tags}
        onUpdateColumns={(tabId, newCols) => {
          updateDbState((p) => {
            const withDefaults = p.tabs.map((t) => {
              if (t.id !== tabId) return t;
              const updatedRows = t.rows.map((r) => {
                const rowCopy = { ...r };
                newCols.forEach((col) => {
                  if (rowCopy[col.id] === undefined) {
                    rowCopy[col.id] = col.type === 'boolean' ? false : col.type === 'number' ? 0 : '';
                  }
                });
                return rowCopy;
              });
              return { ...t, columns: newCols, rows: updatedRows };
            });

            const cleanedTabs = integrityService.cleanReferencesAfterColumnsUpdate(
              withDefaults,
              tabId,
              newCols
            );
            const cleanedTags = integrityService.pruneOrphanedTags(p.tags, cleanedTabs);

            return { ...p, tabs: cleanedTabs, tags: cleanedTags };
          });
        }}
      />

      <BackupModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
        databaseState={dbState}
        onRestoreDatabase={(restored) => {
          const normalized = normalizeDatabaseState(restored);
          setDbState(normalized);
          latestDbRef.current = normalized;
          persistState(normalized, true);
          if (normalized.tabs[0]) setActiveTabId(normalized.tabs[0].id);
        }}
        onResetDatabase={async () => {
          const { state, saveResult } = await storageService.resetDatabaseAsync();
          setDbState(state);
          latestDbRef.current = state;
          if (state.tabs[0]) setActiveTabId(state.tabs[0].id);
          if (saveResult.ok) {
            showToast('База данных сброшена к исходному состоянию.', 'info');
          } else {
            showToast(saveResult.message || 'Не удалось сбросить файл базы', 'error');
          }
        }}
      />

      <HelpModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />

      <LegalEntityModal
        isOpen={entityModalState.isOpen}
        mode={entityModalState.mode}
        onClose={() => setEntityModalState((prev) => ({ ...prev, isOpen: false }))}
        entities={dbState.entities}
        targetEntity={entityModalState.targetEntity}
        onSaveEntity={handleSaveLegalEntity}
      />

      <NewTabModal
        isOpen={isNewTabModalOpen}
        onClose={() => setIsNewTabModalOpen(false)}
        existingTabs={dbState.tabs}
        onCreateTab={handleCreateTabFromModal}
      />

      <MasterDependenciesModal
        isOpen={Boolean(masterDepsTabId)}
        onClose={() => setMasterDepsTabId(null)}
        masterTab={dbState.tabs.find((t) => t.id === masterDepsTabId) || null}
        allTabs={dbState.tabs}
        onApplyDependencies={handleApplyMasterDependencies}
      />

      {/* Master Row Delete Impact Confirmation */}
      <ConfirmDialog
        isOpen={Boolean(pendingMasterRowDelete)}
        danger
        title="Удаление записей из мастер-таблицы"
        description={
          pendingMasterRowDelete
            ? `Вы удаляете записи мастер-справочника, на которые ссылаются зависимые таблицы: ${pendingMasterRowDelete.summary}. После удаления в этих ячейках потребуется выбрать актуальное значение. Продолжить?`
            : ''
        }
        confirmLabel="Удалить записи"
        cancelLabel="Отмена"
        onConfirm={() => {
          if (pendingMasterRowDelete) {
            executeRowDelete(pendingMasterRowDelete.tabId, pendingMasterRowDelete.rowIds);
          }
          setPendingMasterRowDelete(null);
        }}
        onCancel={() => setPendingMasterRowDelete(null)}
      />

      {/* Legacy localStorage -> Disk Migration Dialog */}
      <ConfirmDialog
        isOpen={Boolean(migrationCandidate)}
        title="Обнаружены данные в кэше браузера"
        description={
          migrationCandidate
            ? `На диске (./data/ot_database.json) найдено записей: ${migrationCandidate.diskRowsCount}, а в кэше браузера от предыдущей веб-версии — ${migrationCandidate.legacyRowsCount}. Перенести данные из браузера на диск (с заменой файла) или использовать файл с диска?`
            : ''
        }
        confirmLabel="Перенести из браузера на диск"
        cancelLabel="Оставить файл с диска"
        onConfirm={() => {
          if (migrationCandidate) {
            setDbState(migrationCandidate.legacyState);
            latestDbRef.current = migrationCandidate.legacyState;
            persistState(migrationCandidate.legacyState, true);
            if (migrationCandidate.legacyState.tabs[0]) {
              setActiveTabId(migrationCandidate.legacyState.tabs[0].id);
            }
          }
          storageService.clearLegacyLocalStorageMarker();
          setMigrationCandidate(null);
        }}
        onCancel={() => {
          storageService.clearLegacyLocalStorageMarker();
          setMigrationCandidate(null);
          showToast('Используется единая база на диске ./data/ot_database.json', 'info');
        }}
      />

      {/* Non-blocking Tab Delete Confirmation Modal with Relations, Templates & Archive/Delete Choice */}
      {pendingDeleteTabId && (() => {
        const tabToDel = dbState.tabs.find((t) => t.id === pendingDeleteTabId);
        if (!tabToDel) return null;
        const impact = integrityService.getTabDeleteImpact(
          pendingDeleteTabId,
          dbState.tabs,
          dbState.tags,
          dbState.templates,
          dbState.generatedDocs
        );
        return (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
            <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 text-xs">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Удаление таблицы «{tabToDel.name}»
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Записей в таблице: <span className="font-mono tabular-nums">{tabToDel.rows.length}</span>
                  </p>
                </div>
              </div>

              <div className="text-slate-600 dark:text-slate-300 leading-relaxed space-y-2 bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800">
                {impact.affectedTabs.length > 0 && (
                  <p className="text-red-700 dark:text-red-300 font-medium">
                    • Потеря связей: таблица используется как мастер для{' '}
                    <strong>{impact.affectedTabs.map((t) => `${t.tabName} (${t.affectedRowCount} зап.)`).join(', ')}</strong>.
                    Связанные столбцы станут обычным текстом.
                  </p>
                )}

                {(impact.affectedTemplatesCount ?? 0) > 0 ? (
                  <p className="text-red-700 dark:text-red-300 font-medium">
                    • Привязанные шаблоны ({impact.affectedTemplatesCount} шт.):{' '}
                    <strong>{impact.affectedTemplateNames?.join(', ')}</strong> — помимо потери связей, будут удалены или архивированы.
                  </p>
                ) : (
                  <p>
                    • Помимо возможных связей с другими вкладками, к этой таблице могут быть привязаны шаблоны и сформированные документы.
                  </p>
                )}

                {impact.affectedTagsCount > 0 && (
                  <p className="text-amber-700 dark:text-amber-300">
                    • Теги шаблонов ({impact.affectedTagsCount} шт.) этой таблицы будут очищены.
                  </p>
                )}

                {(impact.affectedDocsCount ?? 0) > 0 && (
                  <p className="text-slate-700 dark:text-slate-300">
                    • Сформированные документы по этой таблице: <strong className="font-mono tabular-nums">{impact.affectedDocsCount}</strong> шт.
                  </p>
                )}
              </div>

              <div className="p-3 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 text-amber-950 dark:text-amber-200 font-medium">
                Удалить все связанные данные или переместить в архив?
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPendingDeleteTabId(null)}
                  className="px-3.5 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => void confirmExecuteDeleteTab('purge')}
                  className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold cursor-pointer"
                >
                  Нет — удалить всё
                </button>
                <button
                  type="button"
                  onClick={() => void confirmExecuteDeleteTab('archive')}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold cursor-pointer"
                >
                  Да — переместить в архив
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
