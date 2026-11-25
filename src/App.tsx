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
import { DeadlineControlView } from './components/DeadlineControlView';
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
import {
  AppButton,
  AppModal,
  ConfirmDialog,
  hasFilesInDataTransfer,
  StatusBanner,
  useToast
} from './components/ui';

import { Column, DatabaseState, LegalEntity, LegalEntityProfile, Row, Tab } from './types/database';
import {
  CloneEntityMode,
  DatabaseTransitionOptions,
  evaluateRecoveryState,
  NativeBootstrapResult,
  SaveStatusState,
  applyDatabaseTransition,
  cloneLegalEntity,
  createIsolatedEmptyEntity,
  executeColumnsUpdateTransaction,
  storageService
} from './services/storageService';
import {
  getCurrentRevision,
  localApiClient,
  NativeErrorKind,
  SaveDatabaseResult,
  StorageMode
} from './services/localApiClient';
import { createUniqueId, integrityService } from './services/integrityService';
import {
  applyDeadlineCompletedTodayInState,
  applyDeadlineNotificationsEnabledInState,
  applyDeadlineSnoozeInState,
  collectDeadlineEvents,
  DeadlineEventItem,
  evaluateSessionToastNotifications,
  getTodayIso,
  normalizeHolidaysList,
  resolveDeadlineEventTarget,
  selectTopPopoverNotifications,
  summarizeDeadlineEvents,
  SYSTEM_DEADLINE_TAB_ID
} from './services/deadlineService';
import { excelService } from './services/excelService';
import { documentGenerator } from './services/documentGenerator';
import {
  archiveExistingDocManually,
  formatBytesReadable,
  isGeneratedDocFromTab,
  registerGeneratedDocument,
  restoreArchivedDocument
} from './services/generatedDocsService';
import { reorderArray, reorderTabColumns } from './utils/reorderUtils';

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
  const [focusDeadlineSearchSignal, setFocusDeadlineSearchSignal] = useState(0);
  const [deleteSelectedSignal, setDeleteSelectedSignal] = useState(0);

  // Disk persistence tracking & recovery banner state
  const [saveStatus, setSaveStatus] = useState<SaveStatusState>('saved');
  const saveStatusRef = useRef<SaveStatusState>('saved');
  saveStatusRef.current = saveStatus;
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [saveErrorKind, setSaveErrorKind] = useState<NativeErrorKind | null>(null);
  const saveErrorKindRef = useRef<NativeErrorKind | null>(null);
  saveErrorKindRef.current = saveErrorKind;
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const hasUnsavedChangesRef = useRef<boolean>(false);
  const [conflictServerRevision, setConflictServerRevision] = useState<number | null>(null);
  const [pendingForceOverwriteConfirm, setPendingForceOverwriteConfirm] = useState<boolean>(false);
  const [initialLoadFailed, setInitialLoadFailed] = useState<boolean>(false);
  const initialLoadFailedRef = useRef<boolean>(false);
  const [usbDisconnected, setUsbDisconnected] = useState<boolean>(false);
  const [migrationCandidate, setMigrationCandidate] =
    useState<NativeBootstrapResult['migrationCandidate'] | null>(null);

  const latestDbRef = useRef<DatabaseState>(dbState);
  latestDbRef.current = dbState;
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const deadlineSettingsQueueRef = useRef<Promise<void>>(Promise.resolve());
  const docRecordQueueRef = useRef<Promise<void>>(Promise.resolve());
  const highlightTimerRef = useRef<number | null>(null);
  const heartbeatBusyRef = useRef<boolean>(false);
  const lastErrorToastRef = useRef<{ message: string; at: number } | null>(null);
  const shownToastKeysRef = useRef<Set<string>>(new Set());
  const [todayIso, setTodayIso] = useState<string>(() => getTodayIso());

  useEffect(() => {
    const syncTestToday = () => {
      setTodayIso(getTodayIso());
    };
    window.addEventListener('ot-baza-test-date-change', syncTestToday);
    return () => {
      window.removeEventListener('ot-baza-test-date-change', syncTestToday);
    };
  }, []);

  const clearRowHighlight = useCallback(() => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    setHighlightedRowId(null);
  }, []);

  const highlightRowTemporarily = useCallback((rowId: string) => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    setHighlightedRowId(rowId);
    highlightTimerRef.current = window.setTimeout(() => {
      highlightTimerRef.current = null;
      setHighlightedRowId(null);
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, []);

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

  const showThrottledErrorToast = useCallback(
    (msg: string) => {
      const now = Date.now();
      const prev = lastErrorToastRef.current;
      if (prev && prev.message === msg && now - prev.at < 8000) {
        return;
      }
      lastErrorToastRef.current = { message: msg, at: now };
      showToast(msg, 'error');
    },
    [showToast]
  );

  // Sequential persistence engine (prevents concurrent PUT races and revision 409 on rapid edits)
  const persistState = useCallback(
    (
      targetState: DatabaseState,
      notifySuccess = false,
      options?: { expectedRevision?: number; isAutoRecovery?: boolean; deferUnsavedFlag?: boolean }
    ): Promise<SaveDatabaseResult> => {
      if (!options?.deferUnsavedFlag) {
        hasUnsavedChangesRef.current = true;
        setHasUnsavedChanges(true);
      }
      setSaveStatus('saving');
      const runPersist = async (): Promise<SaveDatabaseResult> => {
        if (initialLoadFailedRef.current && options?.expectedRevision === undefined) {
          const guardMsg =
            'Начальная загрузка базы с диска не завершилась успешно. Перезагрузите базу с диска или скачайте JSON-копию перед записью.';
          setSaveStatus('error');
          setSaveErrorKind(saveErrorKindRef.current || 'connection');
          setSaveErrorMessage(guardMsg);
          showThrottledErrorToast(guardMsg);
          return {
            ok: false,
            errorKind: 'connection',
            errorCode: 'INITIAL_LOAD_FAILED',
            message: guardMsg
          };
        }

        const res = await storageService.saveDatabaseAsync(
          targetState,
          options?.expectedRevision !== undefined
            ? { expectedRevision: options.expectedRevision }
            : undefined
        );
        if (res.ok) {
          setSaveStatus('saved');
          setSaveErrorMessage(null);
          setSaveErrorKind(null);
          setUsbDisconnected(false);
          setConflictServerRevision(null);
          initialLoadFailedRef.current = false;
          setInitialLoadFailed(false);
          if (latestDbRef.current === targetState || options?.deferUnsavedFlag) {
            hasUnsavedChangesRef.current = false;
            setHasUnsavedChanges(false);
          }
          if (options?.isAutoRecovery) {
            showToast('Связь с сервером восстановлена, несохранённые изменения записаны на диск.', 'success');
          } else if (notifySuccess) {
            showToast('База данных успешно сохранена.', 'success');
          }
        } else {
          const isUsb = Boolean(res.usbDisconnected || res.errorKind === 'usb');
          const isConflict = Boolean(res.isConflict || res.errorKind === 'conflict');
          const nextStatus: SaveStatusState = isUsb
            ? 'usb_disconnected'
            : isConflict
              ? 'conflict'
              : 'error';
          setSaveStatus(nextStatus);
          setSaveErrorKind(
            res.errorKind ||
              (isUsb ? 'usb' : isConflict ? 'conflict' : 'disk_write')
          );
          setUsbDisconnected(isUsb);
          setConflictServerRevision(
            isConflict ? (res.serverRevision ?? res.revision ?? null) : null
          );
          const msg = res.message || 'Ошибка сохранения базы данных';
          setSaveErrorMessage(msg);
          showThrottledErrorToast(msg);
        }
        return res;
      };

      const nextTask = saveQueueRef.current
        .then(runPersist, runPersist)
        .catch((err: any): SaveDatabaseResult => {
          const errMsg = err?.message || 'Непредвиденная ошибка сохранения';
          setSaveStatus('error');
          setSaveErrorKind('connection');
          setSaveErrorMessage(errMsg);
          return {
            ok: false,
            errorKind: 'connection',
            message: errMsg
          };
        });
      saveQueueRef.current = nextTask.then(() => undefined);
      return nextTask;
    },
    [showThrottledErrorToast, showToast]
  );

  // Explicit reload from disk (used after load error or when resolving revision conflict in favor of disk)
  const handleReloadFromDisk = useCallback(async () => {
    setSaveStatus('saving');
    const res = await storageService.bootstrapDatabase();
    setStorageMode(res.mode);
    if (res.loadError || res.sessionLost) {
      initialLoadFailedRef.current = true;
      setInitialLoadFailed(true);
      const isUsb = Boolean(res.health?.usbDisconnected || res.loadErrorKind === 'usb');
      setSaveStatus(isUsb ? 'usb_disconnected' : 'error');
      setUsbDisconnected(isUsb);
      setSaveErrorKind(res.loadErrorKind || (isUsb ? 'usb' : 'connection'));
      setSaveErrorMessage(res.loadError || 'Не удалось загрузить базу данных с диска');
      showToast(res.loadError || 'Не удалось загрузить базу данных с диска', 'error');
      return;
    }

    shownToastKeysRef.current.clear();
    setDbState(res.state);
    latestDbRef.current = res.state;
    setActiveTabId((prev) =>
      prev === SYSTEM_DEADLINE_TAB_ID || res.state.tabs.some((t) => t.id === prev)
        ? prev
        : res.state.tabs[0]?.id || 'tab_positions'
    );
    setSelectedRowIds(new Set());
    clearRowHighlight();
    hasUnsavedChangesRef.current = false;
    setHasUnsavedChanges(false);
    initialLoadFailedRef.current = false;
    setInitialLoadFailed(false);
    setConflictServerRevision(null);
    setSaveErrorKind(null);
    setSaveErrorMessage(null);
    setUsbDisconnected(false);
    setSaveStatus('saved');
    showToast('Актуальная база данных загружена с диска.', 'success');
  }, [clearRowHighlight, showToast]);

  // Smart retry: verifies disk health/revision before saving latest in-memory state
  const handleRetrySave = useCallback(async () => {
    if (storageMode !== 'native-fs') {
      await persistState(latestDbRef.current, true);
      return;
    }

    if (localApiClient.isNativeSessionLost()) {
      setSaveStatus('error');
      setSaveErrorKind('session_lost');
      setSaveErrorMessage(
        'Сессия с сервером OT-Baza.exe потеряна после перезагрузки. Скачайте копию JSON и перезапустите OT-Baza.exe.'
      );
      showToast('Сессия с сервером потеряна. Перезапустите OT-Baza.exe.', 'error');
      return;
    }

    if (initialLoadFailedRef.current) {
      await handleReloadFromDisk();
      return;
    }

    const health = await localApiClient.checkHealth({ syncRevision: false });
    if (!health.ok) {
      const isUsb = Boolean(health.usbDisconnected || health.errorKind === 'usb');
      setSaveStatus(isUsb ? 'usb_disconnected' : 'error');
      setUsbDisconnected(isUsb);
      setSaveErrorKind(health.errorKind || 'connection');
      setSaveErrorMessage(health.message || 'Нет связи с локальным сервером OT-Baza.exe');
      showToast(health.message || 'Сервер OT-Baza.exe всё ещё недоступен.', 'error');
      return;
    }

    const localRev = getCurrentRevision();
    if (localRev > 0 && health.revision > 0 && health.revision !== localRev) {
      setSaveStatus('conflict');
      setSaveErrorKind('conflict');
      setConflictServerRevision(health.revision);
      const conflictMsg = `Обнаружен конфликт версий: на диске ревизия №${health.revision}, а в окне №${localRev}. Загрузите базу с диска или подтвердите перезапись.`;
      setSaveErrorMessage(conflictMsg);
      showToast(conflictMsg, 'warning');
      return;
    }

    await persistState(latestDbRef.current, true);
  }, [handleReloadFromDisk, persistState, showToast, storageMode]);

  // Bootstrap disk DB + legacy migration check on mount
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const res = await storageService.bootstrapDatabase();
      if (cancelled) return;

      setStorageMode(res.mode);
      if (!res.loadError && !res.sessionLost) {
        setDbState(res.state);
        latestDbRef.current = res.state;
        setActiveTabId((prev) =>
          prev === SYSTEM_DEADLINE_TAB_ID || res.state.tabs.some((t) => t.id === prev)
            ? prev
            : res.state.tabs[0]?.id || 'tab_positions'
        );
        initialLoadFailedRef.current = false;
        setInitialLoadFailed(false);
      }

      if (res.migrationCandidate) {
        setMigrationCandidate(res.migrationCandidate);
      }
      if (res.health?.restoredFromBackup) {
        showToast(
          'Основной файл ot_database.json был повреждён — данные восстановлены из резервной копии.',
          'warning'
        );
      } else if (res.health?.corruptedWarning || res.loadError || res.sessionLost) {
        initialLoadFailedRef.current = Boolean(res.loadError || res.sessionLost);
        setInitialLoadFailed(Boolean(res.loadError || res.sessionLost));
        const isUsb = Boolean(res.health?.usbDisconnected || res.loadErrorKind === 'usb');
        setSaveStatus(isUsb ? 'usb_disconnected' : 'error');
        setUsbDisconnected(isUsb);
        setSaveErrorKind(res.loadErrorKind || (res.sessionLost ? 'session_lost' : 'disk_write'));
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

  // Native heartbeat (detects server drop, USB disconnect, revision drift, and auto-recovers pending edits) + shutdown/unsaved guard
  useEffect(() => {
    if (storageMode !== 'native-fs') return;

    const runHeartbeatCheck = async () => {
      if (heartbeatBusyRef.current) return;
      heartbeatBusyRef.current = true;
      try {
        const hb = await localApiClient.heartbeat();
        const evalRes = evaluateRecoveryState({
          heartbeatOk: hb.ok,
          heartbeatRevision: hb.revision,
          localRevision: getCurrentRevision(),
          hasUnsavedChanges: hasUnsavedChangesRef.current,
          initialLoadFailed: initialLoadFailedRef.current,
          currentSaveStatus: saveStatusRef.current,
          usbDisconnected: hb.usbDisconnected,
          errorKind: hb.errorKind,
          errorMessage: hb.error
        });

        if (evalRes.action === 'server_error') {
          const isUsb = Boolean(evalRes.usbDisconnected);
          setUsbDisconnected(isUsb);
          setSaveStatus(isUsb ? 'usb_disconnected' : 'error');
          setSaveErrorKind(evalRes.errorKind || 'connection');
          setSaveErrorMessage(evalRes.message || 'Потеряна связь с сервером OT-Baza.exe');
        } else if (evalRes.action === 'conflict') {
          setUsbDisconnected(false);
          setSaveStatus('conflict');
          setSaveErrorKind('conflict');
          setConflictServerRevision(evalRes.serverRevision ?? null);
          setSaveErrorMessage(
            evalRes.message || 'Конфликт версий: файл на диске был обновлён.'
          );
        } else if (evalRes.action === 'retry_unsaved') {
          setUsbDisconnected(false);
          await persistState(latestDbRef.current, false, { isAutoRecovery: true });
        } else if (evalRes.action === 'clear_error') {
          setUsbDisconnected(false);
          setSaveStatus('saved');
          setSaveErrorKind(null);
          setSaveErrorMessage(null);
          setConflictServerRevision(null);
        } else if (hb.ok) {
          setUsbDisconnected(false);
        }
      } finally {
        heartbeatBusyRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      void runHeartbeatCheck();
    }, 4000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void runHeartbeatCheck();
      }
    };
    const handleOnline = () => {
      void runHeartbeatCheck();
    };
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChangesRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const handlePageHide = () => {
      localApiClient.notifyShutdown();
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [persistState, storageMode]);

  const activeEntity =
    dbState.entities.find((e) => e.id === dbState.activeEntityId) || dbState.entities[0];

  // Unified database state updater + optional disk persistence (pure state transition, no side effects inside React updater)
  const updateDbState = useCallback(
    (
      updater: (prev: DatabaseState) => DatabaseState,
      options?: DatabaseTransitionOptions & { persist?: boolean }
    ) => {
      const nextState = applyDatabaseTransition(latestDbRef.current, updater, {
        touchTimestamp: options?.touchTimestamp
      });
      if (nextState === latestDbRef.current) {
        return;
      }
      latestDbRef.current = nextState;
      setDbState(nextState);
      if (options?.persist !== false) {
        void persistState(nextState);
      }
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

  const isSystemDeadlineTab = activeTabId === SYSTEM_DEADLINE_TAB_ID;
  const currentTab = dbState.tabs.find((t) => t.id === activeTabId) || dbState.tabs[0];

  const deadlineEvents = React.useMemo(
    () => collectDeadlineEvents(dbState, { todayIso }),
    [dbState, todayIso]
  );
  const deadlineSummary = React.useMemo(
    () => summarizeDeadlineEvents(deadlineEvents),
    [deadlineEvents]
  );
  const popoverNotifications = React.useMemo(
    () =>
      selectTopPopoverNotifications(deadlineEvents, dbState.settings?.deadlineSettings, {
        todayIso
      }),
    [deadlineEvents, dbState.settings?.deadlineSettings, todayIso]
  );

  // Session-deduplicated deadline notifications (one aggregated toast for newly unseen overdue/due_soon keys)
  useEffect(() => {
    if (isBootstrapping || initialLoadFailed) return;

    const evalRes = evaluateSessionToastNotifications({
      events: deadlineEvents,
      shownKeys: shownToastKeysRef.current,
      deadlineSettings: dbState.settings?.deadlineSettings,
      todayIso
    });
    if (!evalRes.shouldShowToast) return;

    evalRes.newKeys.forEach((key) => shownToastKeysRef.current.add(key));
    showToast(evalRes.message, evalRes.variant, {
      action: {
        label: 'Открыть «Контроль сроков»',
        onClick: () => setActiveTabId(SYSTEM_DEADLINE_TAB_ID)
      },
      durationMs: 7000
    });
  }, [
    isBootstrapping,
    initialLoadFailed,
    deadlineEvents,
    dbState.settings?.deadlineSettings,
    todayIso,
    showToast
  ]);

  // ===================== CRUD OPERATIONS =====================

  const handleAddRow = useCallback(() => {
    if (isSystemDeadlineTab || !currentTab) return;
    const newRowId = createUniqueId('row');
    const newRow: Row = { id: newRowId };

    currentTab.columns.forEach((col) => {
      if (col.type === 'boolean') newRow[col.id] = false;
      else if (col.type === 'number') newRow[col.id] = 0;
      else if (col.type === 'date') newRow[col.id] = new Date().toISOString().split('T')[0];
      else if (col.type === 'deadline_control') newRow[col.id] = {};
      else newRow[col.id] = '';
    });

    updateDbState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === currentTab.id ? { ...t, rows: [newRow, ...t.rows] } : t))
    }));
  }, [currentTab, isSystemDeadlineTab, updateDbState]);

  // Global Keyboard Shortcuts (Ctrl+S, Ctrl+N, Ctrl+F) — layout independent (e.code)
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select';
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // Never hijack shortcuts while a modal dialog is open
      if (document.querySelector('[role="dialog"]')) return;

      const key = e.key.toLowerCase();
      const isS = e.code === 'KeyS' || key === 's' || key === 'ы';
      const isN = e.code === 'KeyN' || key === 'n' || key === 'т';
      const isF = e.code === 'KeyF' || key === 'f' || key === 'а';

      if (isS) {
        e.preventDefault();
        void handleRetrySave();
        return;
      }
      // Ctrl+N / Ctrl+F must not fire while typing in a field
      if (isTypingTarget(e.target)) return;
      if (isN) {
        e.preventDefault();
        handleAddRow();
      } else if (isF) {
        e.preventDefault();
        if (activeTabId === SYSTEM_DEADLINE_TAB_ID) {
          setFocusDeadlineSearchSignal((n) => n + 1);
        } else {
          setFocusSearchSignal((n) => n + 1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, handleAddRow, handleRetrySave]);

  // Global guard: prevent browser from opening/navigating to files dropped outside modal dropzones
  useEffect(() => {
    const handleWindowDrag = (e: DragEvent) => {
      if (!hasFilesInDataTransfer(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'none';
      }
    };
    const handleWindowDrop = (e: DragEvent) => {
      if (!hasFilesInDataTransfer(e.dataTransfer)) return;
      e.preventDefault();
    };

    window.addEventListener('dragenter', handleWindowDrag);
    window.addEventListener('dragover', handleWindowDrag);
    window.addEventListener('drop', handleWindowDrop);
    return () => {
      window.removeEventListener('dragenter', handleWindowDrag);
      window.removeEventListener('dragover', handleWindowDrag);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, []);

  // Update single or multiple cells on a row with strict full-tuple Master cascade
  const applyRowUpdateWithCascade = (rowId: string, patch: Record<string, any>) => {
    if (!currentTab) return;

    const previewCascade = integrityService.applyMasterRowCascade(
      latestDbRef.current.tabs,
      currentTab.id,
      rowId,
      patch
    );

    updateDbState((prev) => ({
      ...prev,
      tabs: integrityService.applyMasterRowCascade(prev.tabs, currentTab.id, rowId, patch).tabs
    }));

    if (previewCascade.ambiguousItems.length > 0) {
      const first = previewCascade.ambiguousItems[0];
      const updatedNote =
        previewCascade.updatedRowsCount > 0
          ? ` Однозначно обновлено строк: ${previewCascade.updatedRowsCount}.`
          : '';
      showToast(
        `Каскад не выполнен для ${previewCascade.ambiguousItems.length} строк (напр. «${first.tabName}», стр. №${first.rowNumber}): найдено ${first.matchCount} совпадений в «${currentTab.name}».${updatedNote}`,
        'warning'
      );
    } else if (previewCascade.skippedIncompatibleCount > 0) {
      const updatedNote =
        previewCascade.updatedRowsCount > 0
          ? ` Однозначно обновлено строк: ${previewCascade.updatedRowsCount}.`
          : '';
      showToast(
        `Пропущено зависимых строк с несовпадением полного набора связей: ${previewCascade.skippedIncompatibleCount}.${updatedNote}`,
        'warning'
      );
    } else if (previewCascade.updatedRowsCount > 0) {
      showToast(
        `Каскадно обновлено зависимых строк: ${previewCascade.updatedRowsCount}`,
        'info'
      );
    }
  };

  const handleUpdateCell = (rowId: string, columnId: string, newValue: any) => {
    applyRowUpdateWithCascade(rowId, { [columnId]: newValue });
  };

  // Update multiple cells on a single row
  const handleUpdateRowMulti = (rowId: string, patch: Record<string, any>) => {
    applyRowUpdateWithCascade(rowId, patch);
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
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.tabs.length ||
        toIndex >= prev.tabs.length
      ) {
        return prev;
      }
      return { ...prev, tabs: reorderArray(prev.tabs, fromIndex, toIndex) };
    });
  };

  // Reorder columns inside a tab via drag & drop
  const handleReorderColumns = (tabId: string, fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    updateDbState((prev) => {
      const targetTab = prev.tabs.find((t) => t.id === tabId);
      if (!targetTab) return prev;
      const nextColumns = reorderTabColumns(targetTab.columns, fromIndex, toIndex);
      const changed =
        nextColumns.length === targetTab.columns.length &&
        nextColumns.some((col, idx) => col !== targetTab.columns[idx]);
      if (!changed) return prev;
      return {
        ...prev,
        tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, columns: nextColumns } : t))
      };
    });
  };

  // Rename tab
  const handleRenameTab = (tabId: string, newName: string) => {
    updateDbState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, name: newName } : t))
    }));
  };

  // Request delete tab (system tab cannot be deleted)
  const handleDeleteTab = (tabId: string) => {
    if (tabId === SYSTEM_DEADLINE_TAB_ID) return;
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
      const matchingDocs = nextGeneratedDocs.filter((d) => isGeneratedDocFromTab(d, tabToDel));
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
        const doomedTemplates = (snapshot.templates || []).filter(
          (tpl) => tpl.tabId === tabId && tpl.storageFileName
        );
        const remainingTemplates = (snapshot.templates || []).filter((tpl) => tpl.tabId !== tabId);
        for (const tpl of doomedTemplates) {
          if (
            localApiClient.isNative() &&
            tpl.storageFileName &&
            !remainingTemplates.some((rt) => rt.storageFileName === tpl.storageFileName)
          ) {
            await localApiClient.deleteFileFromBucket('templates', tpl.storageFileName);
          }
        }
        nextGeneratedDocs = nextGeneratedDocs.filter((d) => !isGeneratedDocFromTab(d, tabToDel));
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

      // Recompute the document registry from the freshest state (never from the
      // snapshot taken before the awaited file moves) so concurrent changes survive.
      let nextDocs = prev.generatedDocs || [];
      if (tabToDel) {
        if (mode === 'archive') {
          const idsToArchive = nextDocs
            .filter((d) => !d.isArchived && isGeneratedDocFromTab(d, tabToDel))
            .map((d) => d.id);
          for (const docId of idsToArchive) {
            nextDocs = archiveExistingDocManually(nextDocs, docId).nextDocs;
          }
        } else {
          nextDocs = nextDocs.filter((d) => !isGeneratedDocFromTab(d, tabToDel));
        }
      }

      return {
        ...prev,
        tabs: cleanedTabs,
        tags: cleanedTags,
        templates: nextTemplates,
        generatedDocs: nextDocs
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
                  : newCol.type === 'deadline_control'
                    ? {}
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
        highlightRowTemporarily(masterJumpInfo.targetMasterRowId);
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
    const target = latestDbRef.current.entities.find((e) => e.id === entityId);
    if (!target || target.id === latestDbRef.current.activeEntityId) return;

    updateDbState(
      (prev) => {
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
      },
      { persist: false, touchTimestamp: false }
    );

    if (activeTabId !== SYSTEM_DEADLINE_TAB_ID) {
      setActiveTabId(target.tabs[0]?.id || '');
    }
    clearRowHighlight();
    setPendingDeleteTabId(null);
    setMasterDepsTabId(null);
    setSelectedRowIds(new Set());
  };

  // ===================== DEADLINE CONTROL SYSTEM TAB HANDLERS =====================

  const handleJumpToDeadlineEvent = (event: DeadlineEventItem) => {
    const resolution = resolveDeadlineEventTarget(latestDbRef.current, event);
    if (!resolution.ok) {
      showToast(resolution.message, 'warning');
      return;
    }

    if (resolution.entity.id !== latestDbRef.current.activeEntityId) {
      const targetEntityId = resolution.entity.id;
      updateDbState(
        (prev) => {
          const nextTarget = prev.entities.find((e) => e.id === targetEntityId);
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
        },
        { persist: false, touchTimestamp: false }
      );
      setPendingDeleteTabId(null);
      setMasterDepsTabId(null);
    }

    setActiveTabId(resolution.tab.id);
    setSelectedRowIds(new Set());
    highlightRowTemporarily(resolution.row.id);
  };

  const handleMarkDeadlineEventCompletedToday = (event: DeadlineEventItem) => {
    const resolution = resolveDeadlineEventTarget(latestDbRef.current, event);
    if (!resolution.ok) {
      showToast(resolution.message, 'warning');
      return;
    }

    updateDbState((prev) => applyDeadlineCompletedTodayInState(prev, event, todayIso).state);
    showToast(
      `Мероприятие «${event.columnName}» (${resolution.rowIdentifier}) отмечено выполненным сегодня.`,
      'success'
    );
  };

  const handleUpdateDeadlineHolidays = (nextHolidays: string[]) => {
    const normalized = normalizeHolidaysList(nextHolidays);
    updateDbState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        deadlineSettings: {
          ...prev.settings.deadlineSettings,
          holidays: normalized
        }
      }
    }));
  };

  const handleSnoozeDeadlineNotification = useCallback(
    (notificationKey: string): Promise<{ ok: boolean; error?: string }> => {
      const run = async (): Promise<{ ok: boolean; error?: string }> => {
        const snapshotBefore = latestDbRef.current;
        const nextState = applyDatabaseTransition(
          snapshotBefore,
          (prev) => applyDeadlineSnoozeInState(prev, notificationKey, todayIso),
          { touchTimestamp: true }
        );
        if (nextState === snapshotBefore) {
          return { ok: true };
        }
        const res = await persistState(nextState, false, { deferUnsavedFlag: true });
        if (!res.ok) {
          return {
            ok: false,
            error:
              res.message ||
              'Не удалось сохранить отложенное уведомление. Проверьте сохранение и повторите попытку.'
          };
        }
        latestDbRef.current = nextState;
        setDbState(nextState);
        hasUnsavedChangesRef.current = false;
        setHasUnsavedChanges(false);
        showToast('Напоминание скрыто на сегодня.', 'info');
        return { ok: true };
      };

      const task = deadlineSettingsQueueRef.current.then(run, run);
      deadlineSettingsQueueRef.current = task.then(
        () => undefined,
        () => undefined
      );
      return task;
    },
    [persistState, showToast, todayIso]
  );

  const handleToggleDeadlineNotifications = useCallback(
    (enabled: boolean): Promise<{ ok: boolean; error?: string }> => {
      const run = async (): Promise<{ ok: boolean; error?: string }> => {
        const snapshotBefore = latestDbRef.current;
        const nextState = applyDatabaseTransition(
          snapshotBefore,
          (prev) => applyDeadlineNotificationsEnabledInState(prev, enabled, todayIso),
          { touchTimestamp: true }
        );
        const res = await persistState(nextState, false, { deferUnsavedFlag: true });
        if (!res.ok) {
          return {
            ok: false,
            error:
              res.message ||
              'Не удалось сохранить настройку уведомлений. Повторите попытку.'
          };
        }
        latestDbRef.current = nextState;
        setDbState(nextState);
        hasUnsavedChangesRef.current = false;
        setHasUnsavedChanges(false);
        showToast(
          enabled
            ? 'Всплывающие напоминания о сроках включены.'
            : 'Всплывающие напоминания отключены (панель и вкладка «Контроль сроков» остаются активны).',
          'info'
        );
        return { ok: true };
      };

      const task = deadlineSettingsQueueRef.current.then(run, run);
      deadlineSettingsQueueRef.current = task.then(
        () => undefined,
        () => undefined
      );
      return task;
    },
    [persistState, showToast, todayIso]
  );

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
    clearRowHighlight();
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

  const handleRecordGeneratedDoc = (payload: RecordGeneratedDocPayload): Promise<void> => {
    const run = docRecordQueueRef.current.then(async () => {
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
        sourceTabId: payload.sourceTabId,
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

      updateDbState((prev) => {
        // Merge by id instead of replacing the whole registry: the snapshot used to
        // compute regResult is stale after the awaited file operations.
        const prevDocs = prev.generatedDocs || [];
        const transitionedIds = new Set(regResult.archivedTransitions.map((t) => t.archivedRecord.id));
        const merged = new Map(prevDocs.map((doc) => [doc.id, doc] as const));
        regResult.nextDocs.forEach((doc) => {
          if (
            doc.id === regResult.newRecord.id ||
            transitionedIds.has(doc.id) ||
            merged.has(doc.id)
          ) {
            merged.set(doc.id, doc);
          }
        });
        const rest = Array.from(merged.values()).filter((doc) => doc.id !== regResult.newRecord.id);
        return { ...prev, generatedDocs: [regResult.newRecord, ...rest] };
      });
      await saveQueueRef.current;

      if (regResult.archivedTransitions.length > 0) {
        const folder = regResult.archivedTransitions[0].archivedRecord.archiveDateFolder;
        showToast(
          `Предыдущая версия перенесена в «${payload.category}/АРХИВ/${folder}»`,
          'info'
        );
      }
    });

    docRecordQueueRef.current = run.catch(() => undefined);
    return run;
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

  const handleRestoreDoc = async (docId: string) => {
    const result = restoreArchivedDocument(latestDbRef.current.generatedDocs || [], docId);
    if (!result.restoreTransition) return;

    if (localApiClient.isNative()) {
      const movedDisplaced: Array<{ fromPath: string; toPath: string }> = [];
      for (const transition of result.displacedArchiveTransitions) {
        const moveRes = await localApiClient.moveDocumentInBucket(
          transition.fromPath,
          transition.toPath
        );
        if (!moveRes.ok) {
          showToast(
            moveRes.message || 'Не удалось перенести текущую версию в АРХИВ перед восстановлением',
            'error'
          );
          return;
        }
        movedDisplaced.push({ fromPath: transition.fromPath, toPath: transition.toPath });
      }

      const restoreMoveRes = await localApiClient.moveDocumentInBucket(
        result.restoreTransition.fromPath,
        result.restoreTransition.toPath
      );
      if (!restoreMoveRes.ok) {
        for (const moved of movedDisplaced) {
          await localApiClient.moveDocumentInBucket(moved.toPath, moved.fromPath);
        }
        showToast(
          restoreMoveRes.message || 'Не удалось восстановить файл из папки АРХИВ на диске',
          'error'
        );
        return;
      }
    }

    updateDbState((prev) => ({
      ...prev,
      generatedDocs: result.nextDocs
    }));

    const restored = result.restoreTransition.restoredRecord;
    if (result.displacedArchiveTransitions.length > 0) {
      showToast(
        `Документ «${restored.fileName}» восстановлен в «${restored.category}» (предыдущая актуальная версия перенесена в АРХИВ)`,
        'success'
      );
    } else {
      showToast(
        `Документ «${restored.fileName}» восстановлен в «${restored.category}»`,
        'success'
      );
    }
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
        saveErrorKind={saveErrorKind}
        hasUnsavedChanges={hasUnsavedChanges}
        storageMode={storageMode}
        onRetrySave={() => void handleRetrySave()}
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
        onSave={() => void handleRetrySave()}
        onExportExcel={() => {
          if (isSystemDeadlineTab) {
            showToast('Для экспорта таблицы в Excel откройте нужную пользовательскую вкладку.', 'info');
            return;
          }
          excelService.exportTabToXlsx(currentTab, dbState.tabs, undefined, {
            holidays: dbState.settings.deadlineSettings?.holidays
          });
        }}
        onFullBackup={() => setIsBackupOpen(true)}
        onRestore={() => setIsBackupOpen(true)}
        onOpenPortableModal={() => setIsWindowsPortableOpen(true)}
        onAddRow={() => {
          if (isSystemDeadlineTab) {
            showToast('Для добавления строки откройте пользовательскую вкладку таблицы.', 'info');
            return;
          }
          handleAddRow();
        }}
        onDeleteSelectedRows={() => {
          if (isSystemDeadlineTab) return;
          setDeleteSelectedSignal((n) => n + 1);
        }}
        selectedRowsCount={isSystemDeadlineTab ? 0 : selectedRowIds.size}
        onFocusSearch={() => {
          if (isSystemDeadlineTab) {
            setFocusDeadlineSearchSignal((n) => n + 1);
          } else {
            setFocusSearchSignal((n) => n + 1);
          }
        }}
        onAddTab={handleAddTab}
        onOpenColumnEditor={() => {
          if (isSystemDeadlineTab) {
            showToast('Для настройки столбцов откройте пользовательскую вкладку таблицы.', 'info');
            return;
          }
          setIsColumnEditorOpen(true);
        }}
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
        deadlineSummary={deadlineSummary}
        popoverNotifications={popoverNotifications}
        deadlineNotificationsEnabled={
          dbState.settings.deadlineSettings?.notificationsEnabled !== false
        }
        onJumpToDeadlineEvent={handleJumpToDeadlineEvent}
        onSnoozeDeadlineNotification={handleSnoozeDeadlineNotification}
        onToggleDeadlineNotifications={handleToggleDeadlineNotifications}
        onOpenDeadlineControlTab={() => setActiveTabId(SYSTEM_DEADLINE_TAB_ID)}
      />

      {/* Persistent Recovery Banner for Connection Loss / USB Disconnect / Write Error / Revision Conflict */}
      {(saveStatus === 'usb_disconnected' || saveStatus === 'error' || saveStatus === 'conflict') && (
        <div
          role="alert"
          className={`px-4 py-2 text-white text-xs flex flex-wrap items-center justify-between gap-2 shrink-0 z-30 ${
            saveStatus === 'conflict'
              ? 'bg-amber-700'
              : 'bg-red-600'
          }`}
        >
          <div className="flex items-center gap-2 font-medium min-w-0">
            {saveStatus === 'usb_disconnected' ? (
              <Usb className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate sm:whitespace-normal">
              <strong className="mr-1.5">
                {saveStatus === 'conflict'
                  ? 'Конфликт ревизий:'
                  : saveStatus === 'usb_disconnected'
                    ? 'Носитель отключён:'
                    : saveErrorKind === 'connection'
                      ? 'Потеряна связь с сервером:'
                      : saveErrorKind === 'session_lost'
                        ? 'Сессия потеряна:'
                        : saveErrorKind === 'validation'
                          ? 'Ошибка проверки данных:'
                          : 'Ошибка записи на диск:'}
              </strong>
              {saveErrorMessage || 'Ошибка записи на диск. Подключите носитель и повторите сохранение.'}
              {hasUnsavedChanges && ' (В окне есть несохранённые изменения — их можно выгрузить в JSON.)'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {(saveStatus === 'conflict' || initialLoadFailed) && storageMode === 'native-fs' && (
              <button
                type="button"
                onClick={() => void handleReloadFromDisk()}
                className="px-2.5 py-1 bg-white text-slate-900 hover:bg-slate-100 rounded font-semibold flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Загрузить с диска</span>
              </button>
            )}
            {saveStatus === 'conflict' && conflictServerRevision !== null && (
              <button
                type="button"
                onClick={() => setPendingForceOverwriteConfirm(true)}
                className="px-2.5 py-1 bg-amber-950/70 hover:bg-amber-950 text-white rounded font-semibold flex items-center gap-1 cursor-pointer"
              >
                <span>Перезаписать диск моими данными</span>
              </button>
            )}
            {saveStatus !== 'conflict' && saveErrorKind !== 'session_lost' && (
              <button
                type="button"
                onClick={() => void handleRetrySave()}
                className="px-2.5 py-1 bg-white text-red-700 hover:bg-red-50 rounded font-semibold flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Повторить запись</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => storageService.exportDatabaseToFile(latestDbRef.current)}
              className="px-2.5 py-1 bg-black/25 hover:bg-black/40 text-white rounded font-medium flex items-center gap-1 cursor-pointer"
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
        tabBarMode={dbState.settings.tabBarMode || 'single'}
        onChangeTabBarMode={(mode) =>
          updateDbState((p) => ({
            ...p,
            settings: { ...p.settings, tabBarMode: mode }
          }))
        }
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
        deadlineOverdueCount={deadlineSummary.overdue}
        deadlineDueSoonCount={deadlineSummary.dueSoon}
      />

      {/* 4. Active Workspace: System Tab «Контроль сроков» OR User DataGrid */}
      {isSystemDeadlineTab ? (
        <DeadlineControlView
          dbState={dbState}
          todayIso={todayIso}
          focusSearchSignal={focusDeadlineSearchSignal}
          onJumpToEvent={handleJumpToDeadlineEvent}
          onMarkCompletedToday={handleMarkDeadlineEventCompletedToday}
          onUpdateHolidays={handleUpdateDeadlineHolidays}
        />
      ) : (
        currentTab && (
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
            rowDensity={dbState.settings.rowDensity || 'compact'}
            onChangeRowDensity={(rowDensity) =>
              updateDbState((p) => ({
                ...p,
                settings: { ...p.settings, rowDensity }
              }))
            }
            pageSize={dbState.settings.pageSize || 100}
            onChangePageSize={(pageSize) =>
              updateDbState((p) => ({
                ...p,
                settings: { ...p.settings, pageSize }
              }))
            }
            onAddRow={handleAddRow}
            onInsertBulkRows={handleInsertBulkRows}
            onUpdateCell={handleUpdateCell}
            onUpdateRowMulti={handleUpdateRowMulti}
            onDeleteRows={handleDeleteRows}
            onOpenExcelImport={() => setIsExcelImportOpen(true)}
            onExportExcel={() =>
              excelService.exportTabToXlsx(currentTab, dbState.tabs, undefined, {
                holidays: dbState.settings.deadlineSettings?.holidays
              })
            }
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
            onReorderColumns={(fromIndex, toIndex) =>
              handleReorderColumns(currentTab.id, fromIndex, toIndex)
            }
            tags={dbState.tags}
            templates={dbState.templates}
            highlightedRowId={highlightedRowId}
            holidays={dbState.settings.deadlineSettings?.holidays}
          />
        )
      )}

      {/* 5. Desktop Status Bar */}
      {(isSystemDeadlineTab || currentTab) && (
        <StatusBar
          currentTab={currentTab}
          systemTabSummary={
            isSystemDeadlineTab
              ? {
                  label: 'Контроль сроков',
                  totalEvents: deadlineSummary.total,
                  attentionCount: deadlineSummary.actionable
                }
              : null
          }
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
            highlightRowTemporarily(rowId);
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
        onRestoreDoc={handleRestoreDoc}
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
        holidays={dbState.settings.deadlineSettings?.holidays}
        onUpdateColumns={async (tabId, newCols, updatedRows, options) => {
          const snapshotBeforeUpdate = latestDbRef.current;
          const nextState = applyDatabaseTransition(snapshotBeforeUpdate, (p) => {
            const withDefaults = p.tabs.map((t) => {
              if (t.id !== tabId) return t;
              const baseRows = updatedRows ?? t.rows;
              const normalizedRows = baseRows.map((r) => {
                const rowCopy = { ...r };
                newCols.forEach((col) => {
                  if (rowCopy[col.id] === undefined) {
                    rowCopy[col.id] =
                      col.type === 'boolean'
                        ? false
                        : col.type === 'number'
                          ? 0
                          : col.type === 'deadline_control'
                            ? {}
                            : '';
                  }
                });
                return rowCopy;
              });
              return { ...t, columns: newCols, rows: normalizedRows };
            });

            const cleanedTabs = integrityService.cleanReferencesAfterColumnsUpdate(
              withDefaults,
              tabId,
              newCols
            );
            const cleanedTags = integrityService.pruneOrphanedTags(p.tags, cleanedTabs);

            return { ...p, tabs: cleanedTabs, tags: cleanedTags };
          });

          const txRes = await executeColumnsUpdateTransaction({
            currentState: snapshotBeforeUpdate,
            nextState,
            hasNonEmptyRowConversions: options?.hasNonEmptyRowConversions,
            createBackup: (state) => storageService.createPreConversionBackup(state),
            persistNextState: (target) => persistState(target, false, { deferUnsavedFlag: true })
          });

          if (!txRes.ok) {
            const errMsg =
              txRes.error ||
              'Не удалось сохранить изменения столбцов. Исходная база данных не изменена.';
            showThrottledErrorToast(errMsg);
            return { ok: false, error: errMsg };
          }

          if (txRes.committedState && txRes.committedState !== snapshotBeforeUpdate) {
            latestDbRef.current = txRes.committedState;
            setDbState(txRes.committedState);
            hasUnsavedChangesRef.current = false;
            setHasUnsavedChanges(false);
          }

          if (options?.hasTypeConversions) {
            const backupNote = txRes.backupFileName
              ? ` (резервная копия: ${txRes.backupFileName})`
              : '';
            showToast(`Структура и тип столбцов обновлены${backupNote}`, 'success');
          }

          return { ok: true, backupFileName: txRes.backupFileName };
        }}
      />

      <BackupModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
        databaseState={dbState}
        onRestoreDatabase={async (nextState) => {
          // Flush pending queued saves first: otherwise a task queued before the restore
          // can land after it and silently revert the restored database.
          await saveQueueRef.current;
          const res = await storageService.restoreDatabaseSafely(latestDbRef.current, nextState);
          if (res.ok) {
            shownToastKeysRef.current.clear();
            setDbState(res.state);
            latestDbRef.current = res.state;
            setActiveTabId(res.state.tabs[0]?.id || '');
            setSelectedRowIds(new Set());
            clearRowHighlight();
            hasUnsavedChangesRef.current = false;
            setHasUnsavedChanges(false);
            initialLoadFailedRef.current = false;
            setInitialLoadFailed(false);
            setConflictServerRevision(null);
            setSaveErrorKind(null);
            setUsbDisconnected(false);
            setSaveStatus('saved');
            setSaveErrorMessage(null);
            const backupNote = res.backupFileName ? ` (бэкап: ${res.backupFileName})` : '';
            showToast(`База данных восстановлена${backupNote}`, 'success');
          } else {
            showToast(
              res.error || 'Не удалось восстановить базу данных. Исходная база сохранена.',
              'error'
            );
          }
          return res;
        }}
        onResetDatabase={async () => {
          // Same reasoning as restore: a queued save must not overwrite the reset database.
          await saveQueueRef.current;
          const { state, saveResult, backupFileName } = await storageService.resetDatabaseAsync(
            latestDbRef.current
          );
          if (saveResult.ok) {
            shownToastKeysRef.current.clear();
            setDbState(state);
            latestDbRef.current = state;
            if (state.tabs[0]) setActiveTabId(state.tabs[0].id);
            setSelectedRowIds(new Set());
            clearRowHighlight();
            hasUnsavedChangesRef.current = false;
            setHasUnsavedChanges(false);
            initialLoadFailedRef.current = false;
            setInitialLoadFailed(false);
            setConflictServerRevision(null);
            setSaveErrorKind(null);
            setUsbDisconnected(false);
            setSaveStatus('saved');
            setSaveErrorMessage(null);
            const backupNote = backupFileName ? ` (бэкап: ${backupFileName})` : '';
            showToast(`База данных сброшена к исходному состоянию${backupNote}.`, 'info');
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

      {/* Force Overwrite Confirmation on Revision Conflict */}
      <ConfirmDialog
        isOpen={pendingForceOverwriteConfirm}
        danger
        title="Перезаписать файл базы на диске?"
        description={
          conflictServerRevision !== null
            ? `Файл ./data/ot_database.json на диске имеет более новую ревизию №${conflictServerRevision} (в текущем окне ревизия №${getCurrentRevision()}). Если продолжить, изменения из этого окна перезапишут дисковую версию, а предыдущая версия будет сохранена в ./data/backups.`
            : 'Файл на диске изменился. Перезаписать его текущими данными из этого окна?'
        }
        confirmLabel="Перезаписать диск"
        cancelLabel="Отмена"
        onConfirm={() => {
          const rev = conflictServerRevision ?? getCurrentRevision();
          setPendingForceOverwriteConfirm(false);
          void persistState(latestDbRef.current, true, {
            expectedRevision: rev > 0 ? rev : undefined
          });
        }}
        onCancel={() => setPendingForceOverwriteConfirm(false)}
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
            const legacyState = migrationCandidate.legacyState;
            setDbState(legacyState);
            latestDbRef.current = legacyState;
            if (legacyState.tabs[0]) {
              setActiveTabId(legacyState.tabs[0].id);
            }
            setMigrationCandidate(null);
            void persistState(legacyState, true).then((res) => {
              if (res.ok) {
                // Drop the browser copy only after the disk write is confirmed.
                storageService.clearLegacyLocalStorageMarker();
                showToast('Данные перенесены из браузера на диск', 'success');
                return;
              }
              showToast(
                'Не удалось записать перенесённые данные на диск. Копия в кэше браузера сохранена — устраните ошибку и повторите перенос.',
                'error'
              );
            });
            return;
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
          <AppModal
            isOpen={Boolean(tabToDel)}
            onClose={() => setPendingDeleteTabId(null)}
            size="lg"
            layer="nested"
            icon={<AlertTriangle className="w-5 h-5" />}
            iconTone="red"
            title={`Удаление таблицы «${tabToDel.name}»`}
            subtitle={
              <>
                Записей в таблице: <span className="font-mono tabular-nums">{tabToDel.rows.length}</span>
              </>
            }
            footer={
              <>
                <AppButton variant="secondary" size="sm" onClick={() => setPendingDeleteTabId(null)}>
                  Отмена
                </AppButton>
                <AppButton
                  variant="danger"
                  size="sm"
                  onClick={() => void confirmExecuteDeleteTab('purge')}
                >
                  Нет — удалить всё
                </AppButton>
                <AppButton
                  variant="primary"
                  size="sm"
                  onClick={() => void confirmExecuteDeleteTab('archive')}
                >
                  Да — переместить в архив
                </AppButton>
              </>
            }
          >
            <div className="p-5 space-y-4 text-xs">
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

              <StatusBanner variant="warning" compact>
                Удалить все связанные данные или переместить в архив?
              </StatusBanner>
            </div>
          </AppModal>
        );
      })()}
    </div>
  );
}
