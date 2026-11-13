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
  localApiClient,
  NativeHealthResponse,
  SaveDatabaseResult,
  StorageMode
} from './localApiClient';

export const STORAGE_KEY = 'ot_base_database_v1';
const LEGACY_MIGRATION_DONE_KEY = 'ot_base_migrated_to_native_v1';

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
}

function countTotalRows(state: DatabaseState): number {
  return (state.entities || []).reduce(
    (sum, ent) => sum + (ent.tabs || []).reduce((tSum, tab) => tSum + (tab.rows?.length || 0), 0),
    0
  );
}

function uidSuffix(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
    const legacyTabs: Tab[] =
      Array.isArray(raw.tabs) && raw.tabs.length > 0
        ? raw.tabs
        : INITIAL_DATABASE_STATE.tabs;
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
      if (Array.isArray(ent.tabs)) {
        collectTabDocs(ent.tabs);
      }
      return {
        ...ent,
        generatedDocs: Array.isArray(ent.generatedDocs) ? ent.generatedDocs : []
      };
    });
    if (sharedNormatives.length === 0) {
      sharedNormatives = [...INITIAL_SHARED_NORMATIVE_DOCS];
    }
  }

  const activeEntity =
    entities.find((e) => e.id === raw.activeEntityId) || entities[0];

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
    settings: raw.settings || INITIAL_DATABASE_STATE.settings
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
    return localApiClient.isNative() ? 'native-fs' : 'web-preview';
  },

  loadDatabase(): DatabaseState {
    // In native mode, disk database loads asynchronously via bootstrapDatabase(),
    // so only use localStorage initial seed for immediate web-preview fallback.
    if (localApiClient.isNative()) {
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
    if (!localApiClient.isNative()) {
      return {
        mode: 'web-preview',
        state: storageService.loadDatabase()
      };
    }

    const health = await localApiClient.checkHealth();
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

  async saveDatabaseAsync(state: DatabaseState): Promise<SaveDatabaseResult> {
    const toSave: DatabaseState = {
      ...state,
      lastSaved: new Date().toISOString()
    };

    if (localApiClient.isNative()) {
      return await localApiClient.saveDatabase(toSave);
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
        message: isQuota
          ? 'Превышен лимит памяти браузера (QuotaExceeded). Запустите ОТ-База.exe или удалите крупные вложения.'
          : (e?.message || 'Ошибка сохранения в локальное хранилище браузера')
      };
    }
  },

  saveDatabase(state: DatabaseState): SaveDatabaseResult {
    if (localApiClient.isNative()) {
      // Trigger async atomic write on disk; synchronous return tracks initiation
      void localApiClient.saveDatabase({
        ...state,
        lastSaved: new Date().toISOString()
      });
      return { ok: true };
    }
    try {
      const toSave: DatabaseState = {
        ...state,
        lastSaved: new Date().toISOString()
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

  async resetDatabaseAsync(): Promise<{ state: DatabaseState; saveResult: SaveDatabaseResult }> {
    const fresh: DatabaseState = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
    fresh.lastSaved = new Date().toISOString();
    if (localApiClient.isNative()) {
      const saveResult = await localApiClient.saveDatabase(fresh);
      return { state: fresh, saveResult };
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return { state: fresh, saveResult: { ok: true } };
  },

  resetDatabase(): DatabaseState {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error(e);
    }
    return INITIAL_DATABASE_STATE;
  },

  exportDatabaseToFile(state: DatabaseState, filename = 'ot_database_backup.json'): void {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', url);
    downloadAnchor.setAttribute('download', filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  async importDatabaseFromFile(file: File): Promise<DatabaseState> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const content = event.target?.result as string;
          const parsed = JSON.parse(content);
          const hasLegacyTabs = Array.isArray(parsed?.tabs);
          const hasEntities = Array.isArray(parsed?.entities) && parsed.entities.length > 0;
          if (!hasLegacyTabs && !hasEntities) {
            throw new Error('Файл не содержит корректных таблиц или карточек организаций');
          }
          const normalized = normalizeDatabaseState(parsed);
          const saveRes = await storageService.saveDatabaseAsync(normalized);
          if (!saveRes.ok) {
            throw new Error(saveRes.message || 'Не удалось записать восстановленную базу');
          }
          resolve(normalized);
        } catch (err: any) {
          reject(new Error('Ошибка чтения файла резервной копии: ' + err.message));
        }
      };
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.readAsText(file);
    });
  }
};
