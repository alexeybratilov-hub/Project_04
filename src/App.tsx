/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { TitleBar } from './components/TitleBar';
import { MenuBar } from './components/MenuBar';
import { TabBar } from './components/TabBar';
import { DataGrid } from './components/DataGrid';
import { StatusBar } from './components/StatusBar';
import { MasterJumpDialog } from './components/MasterJumpDialog';
import { ExcelImportModal } from './components/ExcelImportModal';
import { RelationsSchemaModal } from './components/RelationsSchemaModal';
import { TagsModal } from './components/TagsModal';
import { TemplateGeneratorModal } from './components/TemplateGeneratorModal';
import { NormativeDocsModal } from './components/NormativeDocsModal';
import { LLMStudioModal } from './components/LLMStudioModal';
import { WindowsPortableModal } from './components/WindowsPortableModal';
import { ColumnEditorModal } from './components/ColumnEditorModal';
import { BackupModal } from './components/BackupModal';
import { HelpModal } from './components/HelpModal';
import { NewTabModal } from './components/NewTabModal';
import { MasterDependenciesModal } from './components/MasterDependenciesModal';
import { LegalEntityModal, LegalEntityModalMode } from './components/LegalEntityModal';

import { Column, DatabaseState, LegalEntity, LegalEntityProfile, Row, Tab } from './types/database';
import {
  CloneEntityMode,
  cloneLegalEntity,
  createIsolatedEmptyEntity,
  normalizeDatabaseState,
  storageService
} from './services/storageService';
import { excelService } from './services/excelService';

export default function App() {
  const [dbState, setDbState] = useState<DatabaseState>(() => storageService.loadDatabase());
  const [activeTabId, setActiveTabId] = useState<string>(() => dbState.tabs[0]?.id || 'tab_positions');
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);

  // Modals state
  const [isExcelImportOpen, setIsExcelImportOpen] = useState(false);
  const [isRelationsSchemaOpen, setIsRelationsSchemaOpen] = useState(false);
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false);
  const [isTemplateGeneratorOpen, setIsTemplateGeneratorOpen] = useState(false);
  const [templateSelectedRowIds, setTemplateSelectedRowIds] = useState<string[] | undefined>(undefined);
  const [isNormativeDocsOpen, setIsNormativeDocsOpen] = useState(false);
  const [isLLMStudioOpen, setIsLLMStudioOpen] = useState(false);
  const [llmTargetRowId, setLlmTargetRowId] = useState<string | undefined>(undefined);
  const [isWindowsPortableOpen, setIsWindowsPortableOpen] = useState(false);
  const [isColumnEditorOpen, setIsColumnEditorOpen] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isNewTabModalOpen, setIsNewTabModalOpen] = useState(false);
  const [masterDepsTabId, setMasterDepsTabId] = useState<string | null>(null);
  const [pendingDeleteTabId, setPendingDeleteTabId] = useState<string | null>(null);

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

  const activeEntity =
    dbState.entities.find((e) => e.id === dbState.activeEntityId) || dbState.entities[0];

  // Save database helper: keeps active entity inside entities[] synced with top-level tabs/tags/templates/llmLogs
  const updateDbState = useCallback((updater: (prev: DatabaseState) => DatabaseState) => {
    setDbState((prev) => {
      const updated = updater(prev);
      const now = new Date().toISOString();

      // If updater directly changed activeEntityId or entities array explicitly (entity CRUD/switch), trust it;
      // otherwise synchronize top-level tabs/tags/templates/llmLogs back into the active entity record.
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
      storageService.saveDatabase(finalState);
      return finalState;
    });
  }, []);

  // Sync theme with document element on mount
  useEffect(() => {
    if (dbState.settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [dbState.settings.theme]);

  // Global Keyboard Shortcuts (Ctrl+S, Ctrl+N, Ctrl+F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        storageService.saveDatabase(dbState);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleAddRow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dbState, activeTabId]);

  const currentTab = dbState.tabs.find((t) => t.id === activeTabId) || dbState.tabs[0];

  // ===================== CRUD OPERATIONS =====================

  // Add new row to current tab
  const handleAddRow = () => {
    if (!currentTab) return;
    const newRowId = `row_${Date.now()}`;
    const newRow: Row = { id: newRowId };

    // Fill defaults
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
  };

  // Update single cell with cascade update to dependent tabs if master column (ТЗ 2.3)
  const handleUpdateCell = (rowId: string, columnId: string, newValue: any) => {
    if (!currentTab) return;
    const oldRow = currentTab.rows.find((r) => r.id === rowId);
    const oldValue = oldRow ? oldRow[columnId] : undefined;

    updateDbState((prev) => {
      // 1. Update the cell in current tab
      let updatedTabs = prev.tabs.map((t) => {
        if (t.id !== currentTab.id) return t;
        return {
          ...t,
          rows: t.rows.map((r) => (r.id === rowId ? { ...r, [columnId]: newValue } : r))
        };
      });

      // 2. Cascade synchronization: if current tab & column is a MASTER for other tabs
      if (oldValue !== undefined && oldValue !== newValue && String(oldValue).trim() !== '') {
        updatedTabs = updatedTabs.map((depTab) => {
          let hasRelation = false;
          const matchingCols = depTab.columns.filter(
            (c) => c.relation?.masterTabId === currentTab.id && c.relation?.masterColumnId === columnId
          );

          if (matchingCols.length === 0) return depTab;

          // Cascade replace old values with new value
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

  // Update multiple cells on a single row (for cascading dependent dropdowns)
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

  // Add bulk rows from clipboard paste
  const handleAddBulkRows = (newRows: Row[]) => {
    if (!currentTab || newRows.length === 0) return;
    updateDbState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === currentTab.id ? { ...t, rows: [...newRows, ...t.rows] } : t
      )
    }));
  };

  // Delete rows
  const handleDeleteRows = (rowIds: string[]) => {
    if (!currentTab) return;
    const rowIdSet = new Set(rowIds);
    updateDbState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === currentTab.id ? { ...t, rows: t.rows.filter((r) => !rowIdSet.has(r.id)) } : t
      )
    }));
  };

  // Open New Tab wizard modal
  const handleAddTab = () => {
    if (dbState.tabs.length >= 20) {
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
    const newTabId = `tab_${Date.now()}`;
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

  // Request delete tab (uses in-app confirmation modal instead of window.confirm)
  const handleDeleteTab = (tabId: string) => {
    if (dbState.tabs.length <= 1) return;
    setPendingDeleteTabId(tabId);
  };

  const confirmExecuteDeleteTab = () => {
    if (!pendingDeleteTabId) return;
    const tabId = pendingDeleteTabId;
    setPendingDeleteTabId(null);

    updateDbState((prev) => {
      const nextTabs = prev.tabs.filter((t) => t.id !== tabId);
      return { ...prev, tabs: nextTabs };
    });
    const remaining = dbState.tabs.filter((t) => t.id !== tabId);
    if (remaining.length > 0 && activeTabId === tabId) {
      setActiveTabId(remaining[0].id);
    }
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

        // 1. Revert any existing relations pointing to this master if unchecked
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

        // 2. Link matching columns or add missing ones with identical name & type 'relation'
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
            const newColId = `col_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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
          [newCol.id]: r[newCol.id] !== undefined ? r[newCol.id] : (newCol.type === 'boolean' ? false : newCol.type === 'number' ? 0 : '')
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

  // ===================== RELATION PROTECTION =====================

  const handleAttemptEditRelation = (column: Column, row: Row) => {
    if (!column.relation) return;
    const masterTab = dbState.tabs.find((t) => t.id === column.relation?.masterTabId);
    const currentValue = row[column.id];

    // Find target row in master
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
    const newTabId = `tab_import_${Date.now()}`;
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
  };

  const handleCommitImportExistingTab = (tabId: string, rows: Record<string, any>[]) => {
    updateDbState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, rows: [...t.rows, ...(rows as Row[])] } : t))
    }));
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
        llmLogs: nextTarget.llmLogs || []
      };
    });

    setActiveTabId(target.tabs[0]?.id || '');
    setHighlightedRowId(null);
    setPendingDeleteTabId(null);
    setMasterDepsTabId(null);
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
      llmLogs: newEntity.llmLogs
    }));
    setActiveTabId(newEntity.tabs[0]?.id || '');
    setHighlightedRowId(null);
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
      llmLogs: nextActive.llmLogs
    }));

    if (dbState.activeEntityId === entityId) {
      setActiveTabId(nextActive.tabs[0]?.id || '');
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-100 overflow-hidden font-sans">
      {/* 1. Windows Native Titlebar with Legal Entity Switcher & Controls */}
      <TitleBar
        settings={dbState.settings}
        onUpdateSettings={(newSettings) => updateDbState((p) => ({ ...p, settings: { ...p.settings, ...newSettings } }))}
        onOpenPortableModal={() => setIsWindowsPortableOpen(true)}
        lastSaved={dbState.lastSaved}
        entities={dbState.entities}
        activeEntity={activeEntity}
        onSelectEntity={handleSelectEntity}
        onOpenCreateEntity={() => setEntityModalState({ isOpen: true, mode: 'create', targetEntity: null })}
        onOpenEditEntity={(ent) => setEntityModalState({ isOpen: true, mode: 'edit', targetEntity: ent })}
        onOpenCloneEntity={(ent) => setEntityModalState({ isOpen: true, mode: 'clone', targetEntity: ent })}
        onDeleteEntity={handleDeleteEntity}
      />

      {/* 2. Windows Native Menubar */}
      <MenuBar
        onSave={() => storageService.saveDatabase(dbState)}
        onExportExcel={() => excelService.exportTabToXlsx(currentTab, dbState.tabs)}
        onFullBackup={() => setIsBackupOpen(true)}
        onRestore={() => setIsBackupOpen(true)}
        onOpenPortableModal={() => setIsWindowsPortableOpen(true)}
        onAddRow={handleAddRow}
        onDeleteSelectedRows={() => {}}
        onFocusSearch={() => {}}
        onAddTab={handleAddTab}
        onOpenColumnEditor={() => setIsColumnEditorOpen(true)}
        onOpenRelationsSchema={() => setIsRelationsSchemaOpen(true)}
        onOpenTagsModal={() => setIsTagsModalOpen(true)}
        onOpenTemplateGenerator={() => {
          setTemplateSelectedRowIds(undefined);
          setIsTemplateGeneratorOpen(true);
        }}
        onOpenNormativeDocs={() => setIsNormativeDocsOpen(true)}
        onOpenLLMStudio={() => {
          setLlmTargetRowId(undefined);
          setIsLLMStudioOpen(true);
        }}
        onOpenHelp={() => setIsHelpOpen(true)}
      />

      {/* 3. Multi-Tab Navigation Bar with drag-reorder, adjustable height, wrapping, and non-clipping popups */}
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
          onAddRow={handleAddRow}
          onAddBulkRows={handleAddBulkRows}
          onUpdateCell={handleUpdateCell}
          onUpdateRowMulti={handleUpdateRowMulti}
          onDeleteRows={handleDeleteRows}
          onOpenExcelImport={() => setIsExcelImportOpen(true)}
          onExportExcel={() => excelService.exportTabToXlsx(currentTab, dbState.tabs)}
          onOpenColumnEditor={() => setIsColumnEditorOpen(true)}
          onOpenNormativeDocs={() => setIsNormativeDocsOpen(true)}
          onOpenTemplateGenerator={(selectedRowIds) => {
            setTemplateSelectedRowIds(selectedRowIds);
            setIsTemplateGeneratorOpen(true);
          }}
          onOpenLLMStudio={(rowId) => {
            setLlmTargetRowId(rowId);
            setIsLLMStudioOpen(true);
          }}
          onAttemptEditRelation={handleAttemptEditRelation}
          onAddColumn={(newCol) => handleAddColumnToTab(currentTab.id, newCol)}
          onUpdateColumn={(colId, patch) => handleUpdateColumn(currentTab.id, colId, patch)}
          highlightedRowId={highlightedRowId}
        />
      )}

      {/* 5. Windows Desktop Status Bar */}
      {currentTab && (
        <StatusBar
          currentTab={currentTab}
          totalTabsCount={dbState.tabs.length}
          databaseDirectory={dbState.settings.databaseDirectory}
          llmConfig={dbState.llmConfig}
          onOpenLLMStudio={() => setIsLLMStudioOpen(true)}
          onOpenPortableModal={() => setIsWindowsPortableOpen(true)}
        />
      )}

      {/* ===================== MODALS ===================== */}

      {/* Linked Column Edit Prevention Dialog (ТЗ 2.3) */}
      <MasterJumpDialog
        isOpen={masterJumpInfo.isOpen}
        onClose={() => setMasterJumpInfo((prev) => ({ ...prev, isOpen: false }))}
        onConfirmJump={handleConfirmJumpToMaster}
        masterTab={masterJumpInfo.masterTab}
        columnName={masterJumpInfo.columnName}
        currentValue={masterJumpInfo.currentValue}
        attemptCount={masterJumpInfo.attemptCount}
      />

      {/* Excel Import Dialog (ТЗ 2.2) */}
      <ExcelImportModal
        isOpen={isExcelImportOpen}
        onClose={() => setIsExcelImportOpen(false)}
        currentTab={currentTab}
        allTabs={dbState.tabs}
        onCommitImportNewTab={handleCommitImportNewTab}
        onCommitImportExistingTab={handleCommitImportExistingTab}
      />

      {/* Relational Schema Diagram (ТЗ 2.3) */}
      <RelationsSchemaModal
        isOpen={isRelationsSchemaOpen}
        onClose={() => setIsRelationsSchemaOpen(false)}
        tabs={dbState.tabs}
        onSelectTab={(tabId) => setActiveTabId(tabId)}
      />

      {/* Tag Pool Directory (ТЗ 2.4) */}
      <TagsModal
        isOpen={isTagsModalOpen}
        onClose={() => setIsTagsModalOpen(false)}
        tags={dbState.tags}
        tabs={dbState.tabs}
        templates={dbState.templates}
        onSaveTags={(newTags) => updateDbState((p) => ({ ...p, tags: newTags }))}
      />

      {/* Document Template Engine (.docx & PDF) (ТЗ 2.5) */}
      <TemplateGeneratorModal
        isOpen={isTemplateGeneratorOpen}
        onClose={() => setIsTemplateGeneratorOpen(false)}
        templates={dbState.templates}
        currentTab={currentTab}
        allTabs={dbState.tabs}
        tags={dbState.tags}
        entityProfile={activeEntity.profile}
        selectedRowIds={templateSelectedRowIds}
        onOpenTagsModal={() => {
          setIsTemplateGeneratorOpen(false);
          setIsTagsModalOpen(true);
        }}
        onSaveTemplates={(newTemplates) => updateDbState((p) => ({ ...p, templates: newTemplates }))}
      />

      {/* Shared Normative Documents Library across all Legal Entities */}
      <NormativeDocsModal
        isOpen={isNormativeDocsOpen}
        onClose={() => setIsNormativeDocsOpen(false)}
        currentTab={currentTab}
        normativeDocs={dbState.normativeDocs}
        onUpdateNormativeDocs={(newDocs) =>
          updateDbState((p) => ({ ...p, normativeDocs: newDocs }))
        }
      />

      {/* LLM Generation Studio (Ollama) (ТЗ 2.7) */}
      <LLMStudioModal
        isOpen={isLLMStudioOpen}
        onClose={() => setIsLLMStudioOpen(false)}
        currentTab={currentTab}
        allTabs={dbState.tabs}
        tags={dbState.tags}
        sharedNormativeDocs={dbState.normativeDocs}
        llmConfig={dbState.llmConfig}
        llmLogs={dbState.llmLogs}
        selectedRowId={llmTargetRowId}
        onSaveLLMConfig={(newConfig) => updateDbState((p) => ({ ...p, llmConfig: newConfig }))}
        onAddLLMLog={(newLog) => updateDbState((p) => ({ ...p, llmLogs: [newLog, ...p.llmLogs] }))}
      />

      {/* Windows Portable USB Setup and .BAT Downloader (ТЗ 1.1) */}
      <WindowsPortableModal
        isOpen={isWindowsPortableOpen}
        onClose={() => setIsWindowsPortableOpen(false)}
        databaseState={dbState}
        onUpdateSettings={(newSettings) => updateDbState((p) => ({ ...p, settings: { ...p.settings, ...newSettings } }))}
      />

      {/* Column Structure Editor (ТЗ 2.1) */}
      <ColumnEditorModal
        isOpen={isColumnEditorOpen}
        onClose={() => setIsColumnEditorOpen(false)}
        currentTab={currentTab}
        allTabs={dbState.tabs}
        onUpdateColumns={(tabId, newCols) => {
          updateDbState((p) => {
            const nextTabs = p.tabs.map((t) => {
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
            return { ...p, tabs: nextTabs };
          });
        }}
      />

      {/* Backup & Restore Modal (ТЗ 2.8) */}
      <BackupModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
        databaseState={dbState}
        onRestoreDatabase={(restored) => {
          const normalized = normalizeDatabaseState(restored);
          setDbState(normalized);
          if (normalized.tabs[0]) setActiveTabId(normalized.tabs[0].id);
        }}
        onResetDatabase={() => {
          const reset = storageService.resetDatabase();
          setDbState(reset);
          if (reset.tabs[0]) setActiveTabId(reset.tabs[0].id);
        }}
      />

      {/* Help & Documentation Modal */}
      <HelpModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />

      {/* Legal Entity Card / Create / Clone Modal */}
      <LegalEntityModal
        isOpen={entityModalState.isOpen}
        mode={entityModalState.mode}
        onClose={() => setEntityModalState((prev) => ({ ...prev, isOpen: false }))}
        entities={dbState.entities}
        targetEntity={entityModalState.targetEntity}
        onSaveEntity={handleSaveLegalEntity}
      />

      {/* New Tab Creation Modal (asks about Master dependencies) */}
      <NewTabModal
        isOpen={isNewTabModalOpen}
        onClose={() => setIsNewTabModalOpen(false)}
        existingTabs={dbState.tabs}
        onCreateTab={handleCreateTabFromModal}
      />

      {/* Master Dependencies Configurator Modal */}
      <MasterDependenciesModal
        isOpen={Boolean(masterDepsTabId)}
        onClose={() => setMasterDepsTabId(null)}
        masterTab={dbState.tabs.find((t) => t.id === masterDepsTabId) || null}
        allTabs={dbState.tabs}
        onApplyDependencies={handleApplyMasterDependencies}
      />

      {/* Non-blocking Tab Delete Confirmation Modal */}
      {pendingDeleteTabId && (() => {
        const tabToDel = dbState.tabs.find((t) => t.id === pendingDeleteTabId);
        if (!tabToDel) return null;
        const depTabs = dbState.tabs.filter((t) =>
          t.id !== pendingDeleteTabId && t.columns.some((c) => c.relation?.masterTabId === pendingDeleteTabId)
        );
        return (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 text-xs">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Удаление вкладки «{tabToDel.name}»
              </h3>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                {depTabs.length > 0
                  ? `ВНИМАНИЕ! Вкладка является мастер-источником для: ${depTabs.map((t) => t.name).join(', ')}. При удалении связанные столбцы потеряют источник данных!`
                  : `Вы действительно хотите удалить вкладку «${tabToDel.name}» и все её записи (${tabToDel.rows.length})?`}
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingDeleteTabId(null)}
                  className="px-3.5 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={confirmExecuteDeleteTab}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold"
                >
                  Удалить вкладку
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
