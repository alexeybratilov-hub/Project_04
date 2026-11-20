import {
  AttachedDoc,
  DatabaseState,
  LegalEntity,
  LegalEntityProfile,
  Tab
} from '../types/database';
import {
  DEFAULT_LEGAL_ENTITY_PROFILE,
  INITIAL_DATABASE_STATE,
  INITIAL_SHARED_NORMATIVE_DOCS
} from '../data/initialDatabase';
import { BUILT_IN_TEMPLATES } from '../data/builtInTemplates';
import { normalizeLLMConfig } from '../data/llmProviders';
import {
  getCurrentRevision,
  localApiClient,
  NativeErrorKind,
  NativeHealthResponse,
  SaveDatabaseOptions,
  SaveDatabaseResult,
  StorageMode
} from './localApiClient';
import { integrityService } from './integrityService';
import {
  normalizeDeadlineAppSettings,
  normalizeDeadlineCellValue,
  normalizeDeadlineColumnConfig
} from './deadlineService';

export const STORAGE_KEY = 'ot_base_database_v1';
const LEGACY_MIGRATION_DONE_KEY = 'ot_base_migrated_to_native_v1';
export const PRE_RESTORE_BACKUP_KEY = 'ot_base_pre_restore_backup_v1';
export const CURRENT_APP_DB_VERSION = '1.3.0';

export type CloneEntityMode = 'structure_only' | 'structure_and_masters' | 'full_copy';

export type SaveStatusState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error'
  | 'usb_disconnected'
  | 'conflict';

export interface NativeBootstrapResult {
  mode: StorageMode;
  state: DatabaseState;
  health?: NativeHealthResponse;
  migrationCandidate?: {
    legacyState: DatabaseState;
    legacyRowsCount: number;
    diskRowsCount: number;
  };
  loadError?: string;
  loadErrorKind?: NativeErrorKind;
  sessionLost?: boolean;
}

export interface RecoveryEvaluation {
  action: 'none' | 'clear_error' | 'retry_unsaved' | 'conflict' | 'server_error';
  serverRevision?: number;
  errorKind?: NativeErrorKind;
  usbDisconnected?: boolean;
  message?: string;
}

/**
 * Pure decision helper for native server heartbeat / reconnect handling:
 * prevents overwriting newer disk DB during auto-recovery and distinguishes error categories.
 */
export function evaluateRecoveryState(params: {
  heartbeatOk: boolean;
  heartbeatRevision?: number;
  localRevision: number;
  hasUnsavedChanges: boolean;
  initialLoadFailed: boolean;
  currentSaveStatus: SaveStatusState;
  usbDisconnected?: boolean;
  errorKind?: NativeErrorKind;
  errorMessage?: string;
}): RecoveryEvaluation {
  if (!params.heartbeatOk) {
    const kind: NativeErrorKind =
      params.usbDisconnected || params.errorKind === 'usb'
        ? 'usb'
        : params.errorKind === 'session_lost'
          ? 'session_lost'
          : 'connection';
    return {
      action: 'server_error',
      errorKind: kind,
      usbDisconnected: Boolean(params.usbDisconnected || kind === 'usb'),
      message:
        params.errorMessage ||
        (kind === 'usb'
          ? 'Носитель или папка ./data недоступны (отключён USB-накопитель).'
          : 'Нет связи с локальным сервером OT-Baza.exe.')
    };
  }

  const serverRev = params.heartbeatRevision;
  if (
    typeof serverRev === 'number' &&
    serverRev > 0 &&
    params.localRevision > 0 &&
    serverRev !== params.localRevision
  ) {
    return {
      action: 'conflict',
      serverRevision: serverRev,
      errorKind: 'conflict',
      message: `База на диске была изменена (ревизия на диске №${serverRev}, в окне №${params.localRevision}). Выберите загрузку с диска или перезапись.`
    };
  }

  if (params.hasUnsavedChanges && !params.initialLoadFailed) {
    return {
      action: 'retry_unsaved',
      serverRevision: serverRev
    };
  }

  if (
    params.currentSaveStatus === 'error' ||
    params.currentSaveStatus === 'usb_disconnected' ||
    params.currentSaveStatus === 'conflict'
  ) {
    return {
      action: 'clear_error',
      serverRevision: serverRev
    };
  }

  return { action: 'none', serverRevision: serverRev };
}

export interface DatabaseSummary {
  version: string;
  lastSaved: string;
  entitiesCount: number;
  entityNames: string[];
  tabsCount: number;
  rowsCount: number;
  tagsCount: number;
  templatesCount: number;
  generatedDocsCount: number;
}

export interface DatabaseImportPreview {
  fileName?: string;
  sourceFormat: 'multi-entity' | 'legacy-v1';
  sourceVersion: string;
  incomingSummary: DatabaseSummary;
  normalizedState: DatabaseState;
  integritySummary: {
    brokenRelationsCount: number;
    orphanedCellsCount: number;
    brokenTagsCount: number;
  };
  warnings: string[];
}

export interface SafeRestoreResult {
  ok: boolean;
  state: DatabaseState;
  rolledBack: boolean;
  backupFileName?: string;
  error?: string;
}

export interface DatabaseTransitionOptions {
  touchTimestamp?: boolean;
}

export interface ExportDatabaseOptions {
  includeLlmApiKey?: boolean;
}

/**
 * Returns a safe copy of DatabaseState for file export/snapshots,
 * stripping sensitive credentials (LLM API key) by default.
 */
export function sanitizeDatabaseForExport(
  state: DatabaseState,
  options?: ExportDatabaseOptions
): DatabaseState {
  if (options?.includeLlmApiKey) {
    return state;
  }
  return {
    ...state,
    llmConfig: state.llmConfig
      ? {
          ...state.llmConfig,
          apiKey: ''
        }
      : normalizeLLMConfig()
  };
}

/**
 * Pure state transition for DatabaseState:
 * syncs active entity fields into `entities` and updates timestamps
 * only when `touchTimestamp !== false` (e.g. skipped on entity switch).
 */
export function applyDatabaseTransition(
  prev: DatabaseState,
  updater: (current: DatabaseState) => DatabaseState,
  options?: DatabaseTransitionOptions
): DatabaseState {
  const updated = updater(prev);
  if (updated === prev) {
    return prev;
  }

  const touchTimestamp = options?.touchTimestamp !== false;
  const now = touchTimestamp ? new Date().toISOString() : undefined;

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
              ...(now ? { updatedAt: now } : {})
            }
          : ent
      );

  return {
    ...updated,
    entities: syncedEntities,
    lastSaved: now ?? updated.lastSaved
  };
}

let persistenceChain: Promise<unknown> = Promise.resolve();

function enqueuePersistenceTask<T>(task: () => Promise<T>): Promise<T> {
  const run = persistenceChain.then(task, task);
  persistenceChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function countTotalRows(state: DatabaseState): number {
  return (state.entities || []).reduce(
    (sum, ent) => sum + (ent.tabs || []).reduce((tSum, tab) => tSum + (tab.rows?.length || 0), 0),
    0
  );
}

export function summarizeDatabaseState(state: DatabaseState): DatabaseSummary {
  const entities = Array.isArray(state.entities) ? state.entities : [];
  let tabsCount = 0;
  let rowsCount = 0;
  let tagsCount = 0;
  let templatesCount = 0;
  let generatedDocsCount = 0;
  const entityNames: string[] = [];

  entities.forEach((ent) => {
    const shortName = ent.profile?.shortName || ent.profile?.fullName || ent.id;
    if (shortName) entityNames.push(shortName);
    const entTabs = Array.isArray(ent.tabs) ? ent.tabs : [];
    tabsCount += entTabs.length;
    rowsCount += entTabs.reduce((acc, t) => acc + (Array.isArray(t.rows) ? t.rows.length : 0), 0);
    tagsCount += Array.isArray(ent.tags) ? ent.tags.length : 0;
    templatesCount += Array.isArray(ent.templates) ? ent.templates.length : 0;
    generatedDocsCount += Array.isArray(ent.generatedDocs) ? ent.generatedDocs.length : 0;
  });

  if (entities.length === 0) {
    const fallbackTabs = Array.isArray(state.tabs) ? state.tabs : [];
    tabsCount = fallbackTabs.length;
    rowsCount = fallbackTabs.reduce((acc, t) => acc + (Array.isArray(t.rows) ? t.rows.length : 0), 0);
    tagsCount = Array.isArray(state.tags) ? state.tags.length : 0;
    templatesCount = Array.isArray(state.templates) ? state.templates.length : 0;
    generatedDocsCount = Array.isArray(state.generatedDocs) ? state.generatedDocs.length : 0;
  }

  return {
    version: state.version || CURRENT_APP_DB_VERSION,
    lastSaved: state.lastSaved || '',
    entitiesCount: entities.length || 1,
    entityNames,
    tabsCount,
    rowsCount,
    tagsCount,
    templatesCount,
    generatedDocsCount
  };
}

function validateTabStructure(tab: any, contextLabel: string): void {
  if (!tab || typeof tab !== 'object' || Array.isArray(tab)) {
    throw new Error(`${contextLabel}: вкладка имеет некорректный формат`);
  }
  if (typeof tab.id !== 'string' || !tab.id.trim()) {
    throw new Error(`${contextLabel}: отсутствует корректный идентификатор вкладки`);
  }
  if (typeof tab.name !== 'string' || !tab.name.trim()) {
    throw new Error(`${contextLabel}: отсутствует название вкладки (${tab.id})`);
  }
  if (!Array.isArray(tab.columns)) {
    throw new Error(`${contextLabel}: во вкладке «${tab.name}» отсутствует массив столбцов`);
  }
  tab.columns.forEach((col: any, idx: number) => {
    if (!col || typeof col !== 'object' || typeof col.id !== 'string' || typeof col.name !== 'string') {
      throw new Error(`${contextLabel}: столбец №${idx + 1} во вкладке «${tab.name}» повреждён`);
    }
  });
  if (!Array.isArray(tab.rows)) {
    throw new Error(`${contextLabel}: во вкладке «${tab.name}» отсутствует массив строк`);
  }
}

export function inspectDatabaseBackupText(
  jsonText: string,
  fileName?: string
): DatabaseImportPreview {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Файл не является корректным JSON. Проверьте целостность резервной копии.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Корневая структура файла должна быть JSON-объектом базы данных.');
  }

  const warnings: string[] = [];

  // 1. Version compatibility check
  const sourceVersion =
    parsed.version === undefined || parsed.version === null ? '1.0.0' : String(parsed.version).trim();
  if (parsed.version !== undefined && parsed.version !== null) {
    if (typeof parsed.version !== 'string' || !/^\d+(\.\d+)*$/.test(sourceVersion)) {
      throw new Error(`Некорректный формат версии резервной копии: «${String(parsed.version)}».`);
    }
    const [majorStr, minorStr] = sourceVersion.split('.');
    const major = Number(majorStr);
    const minor = Number(minorStr || 0);
    if (major > 1) {
      throw new Error(
        `Версия файла (${sourceVersion}) несовместима с текущей версией программы (${CURRENT_APP_DB_VERSION}).`
      );
    }
    if (major === 1 && minor > 3) {
      warnings.push(
        `Файл создан в более новой минорной версии (${sourceVersion} > ${CURRENT_APP_DB_VERSION}). Проверьте сводку данных перед восстановлением.`
      );
    }
  } else {
    warnings.push('В файле не указана версия — будет выполнена совместимая миграция из формата v1.0.');
  }

  // 2. Structural validation (entities vs legacy tabs)
  const hasEntities = Array.isArray(parsed.entities) && parsed.entities.length > 0;
  const hasLegacyTabs = Array.isArray(parsed.tabs) && parsed.tabs.length > 0;

  if (!hasEntities && !hasLegacyTabs) {
    throw new Error('Файл не содержит корректных таблиц (tabs) или карточек организаций (entities).');
  }

  if (hasEntities) {
    parsed.entities.forEach((ent: any, eIdx: number) => {
      if (!ent || typeof ent !== 'object' || Array.isArray(ent)) {
        throw new Error(`Карточка организации №${eIdx + 1} повреждена.`);
      }
      if (!Array.isArray(ent.tabs) || ent.tabs.length === 0) {
        throw new Error(`В организации №${eIdx + 1} отсутствуют таблицы.`);
      }
      const entName = ent.profile?.shortName || ent.profile?.fullName || `Организация №${eIdx + 1}`;
      ent.tabs.forEach((t: any) => validateTabStructure(t, entName));
    });
  } else {
    parsed.tabs.forEach((t: any) => validateTabStructure(t, 'База v1'));
  }

  // 3. Normalize in memory without touching storage
  const normalizedState = normalizeDatabaseState(parsed);
  const incomingSummary = summarizeDatabaseState(normalizedState);

  // 4. Referential integrity audit across all entities in imported database
  let brokenRelationsCount = 0;
  let orphanedCellsCount = 0;
  let brokenTagsCount = 0;

  normalizedState.entities.forEach((ent) => {
    const audit = integrityService.auditIntegrity(ent.tabs || [], ent.tags || []);
    brokenRelationsCount += audit.brokenRelations.length;
    orphanedCellsCount += audit.orphanedCells.length;
    brokenTagsCount += audit.brokenTags.length;
  });

  if (brokenRelationsCount > 0 || orphanedCellsCount > 0 || brokenTagsCount > 0) {
    warnings.push(
      `Аудит импортируемого файла выявил замечания целостности: битых связей — ${brokenRelationsCount}, несовпадающих значений связей — ${orphanedCellsCount}, битых тегов — ${brokenTagsCount}.`
    );
  }

  return {
    fileName,
    sourceFormat: hasEntities ? 'multi-entity' : 'legacy-v1',
    sourceVersion,
    incomingSummary,
    normalizedState,
    integritySummary: {
      brokenRelationsCount,
      orphanedCellsCount,
      brokenTagsCount
    },
    warnings
  };
}

function uidSuffix(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeTabsDeadlineColumns(tabs: Tab[]): Tab[] {
  let anyTabChanged = false;
  const nextTabs = tabs.map((tab) => {
    const deadlineCols = (tab.columns || []).filter((c) => c.type === 'deadline_control');
    if (deadlineCols.length === 0) {
      return tab;
    }
    anyTabChanged = true;
    const nextColumns = tab.columns.map((c) =>
      c.type === 'deadline_control'
        ? { ...c, deadlineConfig: normalizeDeadlineColumnConfig(c.deadlineConfig) }
        : c
    );
    const nextRows = (tab.rows || []).map((row) => {
      let rowChanged = false;
      const copy: Record<string, any> = { ...row };
      for (const col of deadlineCols) {
        const rawCell = row[col.id];
        if (rawCell === undefined || rawCell === null || rawCell === '') {
          continue;
        }
        const normalizedCell = normalizeDeadlineCellValue(rawCell);
        if (JSON.stringify(normalizedCell) !== JSON.stringify(rawCell)) {
          copy[col.id] = normalizedCell;
          rowChanged = true;
        }
      }
      return rowChanged ? (copy as Tab['rows'][number]) : row;
    });
    return {
      ...tab,
      columns: nextColumns,
      rows: nextRows
    };
  });
  return anyTabChanged ? nextTabs : tabs;
}

export function normalizeDatabaseState(raw: any): DatabaseState {
  if (!raw || typeof raw !== 'object') {
    return INITIAL_DATABASE_STATE;
  }

  let sharedNormatives: AttachedDoc[] = Array.isArray(raw.normativeDocs)
    ? [...raw.normativeDocs]
    : [];

  const seenDocIds = new Set(sharedNormatives.map((d) => d.id));

  const collectTabDocs = (tabs: Tab[]) => {
    tabs.forEach((tab) => {
      if (Array.isArray(tab.attachedDocs)) {
        tab.attachedDocs.forEach((doc) => {
          if (!seenDocIds.has(doc.id)) {
            seenDocIds.add(doc.id);
            sharedNormatives.push({
              ...doc,
              relatedTabName: doc.relatedTabName || tab.name
            });
          }
        });
      }
    });
  };

  let entities: LegalEntity[] = Array.isArray(raw.entities) ? raw.entities : [];

  if (entities.length === 0) {
    const legacyTabs: Tab[] = normalizeTabsDeadlineColumns(
      Array.isArray(raw.tabs) && raw.tabs.length > 0
        ? raw.tabs
        : INITIAL_DATABASE_STATE.tabs
    );
    collectTabDocs(legacyTabs);

    if (sharedNormatives.length === 0) {
      sharedNormatives = [...INITIAL_SHARED_NORMATIVE_DOCS];
    }

    const now = new Date().toISOString();
    entities = [
      {
        id: 'entity_kataniya',
        profile: { ...DEFAULT_LEGAL_ENTITY_PROFILE },
        tabs: legacyTabs,
        tags: Array.isArray(raw.tags) ? raw.tags : INITIAL_DATABASE_STATE.tags,
        templates: Array.isArray(raw.templates) ? raw.templates : BUILT_IN_TEMPLATES,
        llmLogs: Array.isArray(raw.llmLogs) ? raw.llmLogs : INITIAL_DATABASE_STATE.llmLogs,
        generatedDocs: Array.isArray(raw.generatedDocs) ? raw.generatedDocs : [],
        createdAt: now,
        updatedAt: now
      }
    ];
  } else {
    entities = entities.map((ent) => {
      const normalizedTabs = Array.isArray(ent.tabs)
        ? normalizeTabsDeadlineColumns(ent.tabs)
        : ent.tabs;
      if (Array.isArray(normalizedTabs)) {
        collectTabDocs(normalizedTabs);
      }
      return {
        ...ent,
        tabs: normalizedTabs,
        generatedDocs: Array.isArray(ent.generatedDocs) ? ent.generatedDocs : []
      };
    });
    if (sharedNormatives.length === 0) {
      sharedNormatives = [...INITIAL_SHARED_NORMATIVE_DOCS];
    }
  }

  const activeEntity =
    entities.find((e) => e.id === raw.activeEntityId) || entities[0];

  const allowedPageSizes = new Set([50, 100, 250, 500]);
  const rawPageSize = Number(raw.settings?.pageSize);

  return {
    version: raw.version || '1.3.0',
    lastSaved: raw.lastSaved || new Date().toISOString(),
    activeEntityId: activeEntity.id,
    entities,
    normativeDocs: sharedNormatives,
    tabs: activeEntity.tabs,
    tags: activeEntity.tags,
    templates: activeEntity.templates,
    generatedDocs: activeEntity.generatedDocs || [],
    llmConfig: normalizeLLMConfig(raw.llmConfig || INITIAL_DATABASE_STATE.llmConfig),
    llmLogs: activeEntity.llmLogs || [],
    settings: {
      ...INITIAL_DATABASE_STATE.settings,
      ...(raw.settings || {}),
      tabBarMode: raw.settings?.tabBarMode === 'auto' ? 'auto' : 'single',
      rowDensity: raw.settings?.rowDensity === 'normal' ? 'normal' : 'compact',
      pageSize: allowedPageSizes.has(rawPageSize) ? rawPageSize : 100,
      deadlineSettings: normalizeDeadlineAppSettings(raw.settings?.deadlineSettings)
    }
  };
}

export function createIsolatedEmptyEntity(profile: LegalEntityProfile): LegalEntity {
  const now = new Date().toISOString();
  const suffix = uidSuffix();
  const starterTabId = `tab_${suffix}_staff`;
  return {
    id: `entity_${suffix}`,
    profile: { ...profile },
    tabs: [
      {
        id: starterTabId,
        name: 'Штатное расписание',
        description: `Мастер-таблица должностей для ${profile.shortName || profile.fullName}`,
        isMaster: true,
        columns: [
          { id: 'pos_title', name: 'Должность (профессия)', type: 'text', required: true, width: 220 },
          { id: 'pos_dept', name: 'Подразделение', type: 'text', width: 190 },
          {
            id: 'pos_sout_class',
            name: 'Класс условий труда',
            type: 'select',
            options: ['2.0 (допустимый)', '3.1 (вредный 1 ст.)', '3.2 (вредный 2 ст.)', '3.3 (вредный 3 ст.)'],
            width: 170
          }
        ],
        rows: [],
        attachedDocs: []
      },
      {
        id: `tab_${suffix}_emp`,
        name: 'Список работников',
        description: 'Персональный состав работников с привязкой к штатному расписанию',
        columns: [
          { id: 'emp_tab_num', name: 'Табельный №', type: 'text', required: true, width: 110 },
          { id: 'emp_fio', name: 'ФИО работника', type: 'text', required: true, width: 220 },
          {
            id: 'emp_pos',
            name: 'Должность (профессия)',
            type: 'relation',
            relation: { masterTabId: starterTabId, masterColumnId: 'pos_title' },
            width: 210
          },
          {
            id: 'emp_dept',
            name: 'Подразделение',
            type: 'relation',
            relation: { masterTabId: starterTabId, masterColumnId: 'pos_dept' },
            width: 190
          },
          { id: 'emp_hire_date', name: 'Дата приема', type: 'date', width: 120 }
        ],
        rows: [],
        attachedDocs: []
      }
    ],
    tags: [],
    templates: JSON.parse(JSON.stringify(BUILT_IN_TEMPLATES)),
    llmLogs: [],
    generatedDocs: [],
    createdAt: now,
    updatedAt: now
  };
}

export function cloneLegalEntity(
  source: LegalEntity,
  newProfile: LegalEntityProfile,
  mode: CloneEntityMode
): LegalEntity {
  const now = new Date().toISOString();

  const clonedTabs: Tab[] = source.tabs.map((tab) => {
    let nextRows = [];
    if (mode === 'full_copy') {
      nextRows = JSON.parse(JSON.stringify(tab.rows));
    } else if (mode === 'structure_and_masters' && tab.isMaster) {
      nextRows = JSON.parse(JSON.stringify(tab.rows));
    }
    return {
      ...tab,
      columns: JSON.parse(JSON.stringify(tab.columns)),
      rows: nextRows,
      attachedDocs: []
    };
  });

  return {
    id: `entity_${uidSuffix()}`,
    profile: { ...newProfile },
    tabs: clonedTabs,
    tags: JSON.parse(JSON.stringify(source.tags || [])),
    templates: JSON.parse(JSON.stringify(source.templates || BUILT_IN_TEMPLATES)),
    llmLogs: [],
    generatedDocs: [],
    createdAt: now,
    updatedAt: now
  };
}

export const storageService = {
  getMode(): StorageMode {
    return localApiClient.isNative() || localApiClient.isNativeSessionLost()
      ? 'native-fs'
      : 'web-preview';
  },

  loadDatabase(): DatabaseState {
    // In native mode, disk database loads asynchronously via bootstrapDatabase(),
    // so only use localStorage initial seed for immediate web-preview fallback.
    if (localApiClient.isNative() || localApiClient.isNativeSessionLost()) {
      return INITIAL_DATABASE_STATE;
    }
    try {
      const serialized = localStorage.getItem(STORAGE_KEY);
      if (serialized) {
        const parsed = JSON.parse(serialized);
        return normalizeDatabaseState(parsed);
      }
    } catch (e) {
      console.warn('Failed to parse saved database from localStorage, falling back to initial', e);
    }
    return INITIAL_DATABASE_STATE;
  },

  async bootstrapDatabase(): Promise<NativeBootstrapResult> {
    if (localApiClient.isNativeSessionLost()) {
      return {
        mode: 'native-fs',
        state: INITIAL_DATABASE_STATE,
        sessionLost: true,
        loadErrorKind: 'session_lost',
        loadError:
          'Потерян токен сессии с сервером OT-Baza.exe после обновления страницы. Автопереключение в кэш браузера (localStorage) заблокировано для защиты дисковой базы — перезапустите OT-Baza.exe.'
      };
    }

    if (!localApiClient.isNative()) {
      return {
        mode: 'web-preview',
        state: storageService.loadDatabase()
      };
    }

    const health = await localApiClient.checkHealth({ syncRevision: false });
    try {
      const { data } = await localApiClient.fetchDatabase();
      const diskState = normalizeDatabaseState(data);

      // Check for legacy localStorage data left from earlier versions
      let migrationCandidate: NativeBootstrapResult['migrationCandidate'];
      try {
        const alreadyMigrated = localStorage.getItem(LEGACY_MIGRATION_DONE_KEY);
        const legacyRaw = localStorage.getItem(STORAGE_KEY);
        if (!alreadyMigrated && legacyRaw) {
          const parsedLegacy = normalizeDatabaseState(JSON.parse(legacyRaw));
          const diskSerialized = JSON.stringify(diskState.entities);
          const legacySerialized = JSON.stringify(parsedLegacy.entities);
          if (diskSerialized !== legacySerialized) {
            const diskRows = countTotalRows(diskState);
            const legacyRows = countTotalRows(parsedLegacy);
            const initialRows = countTotalRows(INITIAL_DATABASE_STATE);
            // Auto-migrate silently ONLY if disk DB is completely untouched demo seed and localStorage has edits
            if (
              diskRows === initialRows &&
              JSON.stringify(diskState.entities) === JSON.stringify(INITIAL_DATABASE_STATE.entities)
            ) {
              const saveRes = await localApiClient.saveDatabase(parsedLegacy);
              if (saveRes.ok) {
                localStorage.removeItem(STORAGE_KEY);
                localStorage.setItem(LEGACY_MIGRATION_DONE_KEY, new Date().toISOString());
                return {
                  mode: 'native-fs',
                  state: parsedLegacy,
                  health
                };
              }
            } else {
              migrationCandidate = {
                legacyState: parsedLegacy,
                legacyRowsCount: legacyRows,
                diskRowsCount: diskRows
              };
            }
          } else {
            // Identical data: clean up legacy localStorage copy to enforce single source of truth
            localStorage.removeItem(STORAGE_KEY);
            localStorage.setItem(LEGACY_MIGRATION_DONE_KEY, new Date().toISOString());
          }
        }
      } catch {
        // Ignore broken legacy storage
      }

      return {
        mode: 'native-fs',
        state: diskState,
        health,
        migrationCandidate
      };
    } catch (err: any) {
      return {
        mode: 'native-fs',
        state: INITIAL_DATABASE_STATE,
        health,
        loadErrorKind: err?.errorKind || (err?.usbDisconnected ? 'usb' : 'connection'),
        loadError: err?.message || 'Не удалось прочитать ./data/ot_database.json'
      };
    }
  },

  clearLegacyLocalStorageMarker(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(LEGACY_MIGRATION_DONE_KEY, new Date().toISOString());
    } catch {
      // ignore
    }
  },

  async saveDatabaseAsync(
    state: DatabaseState,
    options?: { expectedRevision?: number; saveOptions?: SaveDatabaseOptions }
  ): Promise<SaveDatabaseResult> {
    return enqueuePersistenceTask(async () => {
      const toSave: DatabaseState = {
        ...state,
        lastSaved: state.lastSaved || new Date().toISOString()
      };

      if (localApiClient.isNativeSessionLost()) {
        return {
          ok: false,
          errorCode: 'SESSION_LOST',
          errorKind: 'session_lost',
          message:
            'Сессия с сервером OT-Baza.exe потеряна. Сохранение в кэш браузера (localStorage) заблокировано для защиты дисковой базы.'
        };
      }

      if (localApiClient.isNative()) {
        return await localApiClient.saveDatabase(
          toSave,
          options?.expectedRevision ?? (getCurrentRevision() > 0 ? getCurrentRevision() : undefined),
          options?.saveOptions
        );
      }

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        return { ok: true };
      } catch (e: any) {
        const isQuota =
          e?.name === 'QuotaExceededError' ||
          e?.code === 22 ||
          String(e?.message || '').toLowerCase().includes('quota');
        return {
          ok: false,
          errorCode: isQuota ? 'QUOTA_EXCEEDED' : 'LOCALSTORAGE_ERROR',
          errorKind: 'disk_write',
          message: isQuota
            ? 'Превышен лимит памяти браузера (QuotaExceeded). Запустите ОТ-База.exe или удалите крупные вложения.'
            : (e?.message || 'Ошибка сохранения в локальное хранилище браузера')
        };
      }
    });
  },

  saveDatabase(state: DatabaseState): SaveDatabaseResult {
    if (localApiClient.isNative()) {
      // Trigger async atomic write through serialized persistence queue
      void storageService.saveDatabaseAsync({
        ...state,
        lastSaved: state.lastSaved || new Date().toISOString()
      });
      return { ok: true };
    }
    try {
      const toSave: DatabaseState = {
        ...state,
        lastSaved: state.lastSaved || new Date().toISOString()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      return { ok: true };
    } catch (e: any) {
      console.error('Failed to save database to localStorage', e);
      return {
        ok: false,
        errorCode: 'LOCALSTORAGE_ERROR',
        message: e?.message || 'Ошибка сохранения'
      };
    }
  },

  async resetDatabaseAsync(
    currentState?: DatabaseState
  ): Promise<{ state: DatabaseState; saveResult: SaveDatabaseResult; backupFileName?: string }> {
    return enqueuePersistenceTask(async () => {
      const fresh: DatabaseState = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
      fresh.lastSaved = new Date().toISOString();
      const preservedState: DatabaseState = currentState
        ? JSON.parse(JSON.stringify(currentState))
        : fresh;

      if (localApiClient.isNative()) {
        const backupRes = await localApiClient.createDiskBackup();
        if (!backupRes.ok) {
          return {
            state: preservedState,
            saveResult: {
              ok: false,
              errorCode: 'DISK_BACKUP_ERROR',
              message:
                backupRes.message ||
                'Не удалось создать резервную копию текущей базы перед сбросом. Сброс отменён.'
            }
          };
        }
        const saveResult = await localApiClient.saveDatabase(fresh);
        return {
          state: saveResult.ok ? fresh : preservedState,
          saveResult,
          backupFileName: backupRes.fileName
        };
      }

      try {
        const existingRaw = localStorage.getItem(STORAGE_KEY);
        if (existingRaw) {
          localStorage.setItem(PRE_RESTORE_BACKUP_KEY, existingRaw);
        } else if (currentState) {
          localStorage.setItem(PRE_RESTORE_BACKUP_KEY, JSON.stringify(currentState));
        }
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Best-effort pre-reset snapshot in localStorage
      }
      return { state: fresh, saveResult: { ok: true } };
    });
  },

  resetDatabase(): DatabaseState {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error(e);
    }
    return INITIAL_DATABASE_STATE;
  },

  exportDatabaseToFile(
    state: DatabaseState,
    filename = 'ot_database_backup.json',
    options?: ExportDatabaseOptions
  ): void {
    const safeState = sanitizeDatabaseForExport(state, options);
    const blob = new Blob([JSON.stringify(safeState, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', url);
    downloadAnchor.setAttribute('download', filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  async inspectDatabaseBackupFile(file: File): Promise<DatabaseImportPreview> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = String(event.target?.result ?? '');
          const preview = inspectDatabaseBackupText(content, file.name);
          resolve(preview);
        } catch (err: any) {
          reject(new Error(err?.message || 'Ошибка проверки файла резервной копии'));
        }
      };
      reader.onerror = () => reject(new Error('Не удалось прочитать выбранный файл'));
      reader.readAsText(file);
    });
  },

  async restoreDatabaseSafely(
    currentState: DatabaseState,
    nextState: DatabaseState
  ): Promise<SafeRestoreResult> {
    // Wait for any in-flight persistence write so the pre-restore backup reflects latest disk state
    await persistenceChain;

    const rollbackSnapshot: DatabaseState = JSON.parse(JSON.stringify(currentState));
    const normalizedNext = normalizeDatabaseState(nextState);
    const toSave: DatabaseState = {
      ...normalizedNext,
      lastSaved: new Date().toISOString()
    };

    let backupFileName: string | undefined;

    if (localApiClient.isNative()) {
      const backupRes = await localApiClient.createDiskBackup();
      if (!backupRes.ok) {
        return {
          ok: false,
          state: rollbackSnapshot,
          rolledBack: true,
          error:
            backupRes.message ||
            'Не удалось создать резервную копию текущей базы перед восстановлением. Операция отменена.'
        };
      }
      backupFileName = backupRes.fileName;
    } else {
      try {
        localStorage.setItem(PRE_RESTORE_BACKUP_KEY, JSON.stringify(rollbackSnapshot));
      } catch {
        // Pre-restore backup key in localStorage is best-effort; rollbackSnapshot stays intact in memory
      }
    }

    const saveRes = await storageService.saveDatabaseAsync(toSave);
    if (!saveRes.ok) {
      if (!localApiClient.isNative()) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(rollbackSnapshot));
        } catch {
          // ignore if original storage was untouched by QuotaExceededError
        }
      }
      return {
        ok: false,
        state: rollbackSnapshot,
        rolledBack: true,
        backupFileName,
        error: saveRes.message || 'Не удалось сохранить восстановленную базу. Выполнен откат.'
      };
    }

    return {
      ok: true,
      state: toSave,
      rolledBack: false,
      backupFileName
    };
  },

  async importDatabaseFromFile(file: File): Promise<DatabaseState> {
    const preview = await storageService.inspectDatabaseBackupFile(file);
    const saveRes = await storageService.saveDatabaseAsync(preview.normalizedState);
    if (!saveRes.ok) {
      throw new Error(saveRes.message || 'Не удалось записать восстановленную базу');
    }
    return preview.normalizedState;
  }
};
