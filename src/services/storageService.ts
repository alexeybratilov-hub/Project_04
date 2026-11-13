import { AttachedDoc, DatabaseState, LegalEntity, LegalEntityProfile, Tab } from '../types/database';
import {
  DEFAULT_LEGAL_ENTITY_PROFILE,
  INITIAL_DATABASE_STATE,
  INITIAL_SHARED_NORMATIVE_DOCS
} from '../data/initialDatabase';
import { BUILT_IN_TEMPLATES } from '../data/builtInTemplates';

const STORAGE_KEY = 'ot_base_database_v1';

export type CloneEntityMode = 'structure_only' | 'structure_and_masters' | 'full_copy';

export function normalizeDatabaseState(raw: any): DatabaseState {
  if (!raw || typeof raw !== 'object') {
    return INITIAL_DATABASE_STATE;
  }

  // Merge/collect shared normative docs
  let sharedNormatives: AttachedDoc[] = Array.isArray(raw.normativeDocs)
    ? [...raw.normativeDocs]
    : [];

  const seenDocIds = new Set(sharedNormatives.map((d) => d.id));

  // If migrating legacy single-entity DB, pull tab.attachedDocs into shared normativeDocs
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
    // Legacy state migration -> wrap existing tabs/tags/templates/logs into first LegalEntity
    const legacyTabs: Tab[] = Array.isArray(raw.tabs) && raw.tabs.length > 0
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
        createdAt: now,
        updatedAt: now
      }
    ];
  } else {
    entities.forEach((ent) => {
      if (Array.isArray(ent.tabs)) {
        collectTabDocs(ent.tabs);
      }
    });
    if (sharedNormatives.length === 0) {
      sharedNormatives = [...INITIAL_SHARED_NORMATIVE_DOCS];
    }
  }

  const activeEntity =
    entities.find((e) => e.id === raw.activeEntityId) || entities[0];

  return {
    version: raw.version || '1.2.0',
    lastSaved: raw.lastSaved || new Date().toISOString(),
    activeEntityId: activeEntity.id,
    entities,
    normativeDocs: sharedNormatives,
    tabs: activeEntity.tabs,
    tags: activeEntity.tags,
    templates: activeEntity.templates,
    llmConfig: raw.llmConfig || INITIAL_DATABASE_STATE.llmConfig,
    llmLogs: activeEntity.llmLogs || [],
    settings: raw.settings || INITIAL_DATABASE_STATE.settings
  };
}

export function createIsolatedEmptyEntity(profile: LegalEntityProfile): LegalEntity {
  const now = new Date().toISOString();
  const starterTabId = `tab_${Date.now()}_staff`;
  return {
    id: `entity_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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
          { id: 'pos_sout_class', name: 'Класс условий труда', type: 'select', options: ['2.0 (допустимый)', '3.1 (вредный 1 ст.)', '3.2 (вредный 2 ст.)', '3.3 (вредный 3 ст.)'], width: 170 }
        ],
        rows: [],
        attachedDocs: []
      },
      {
        id: `tab_${Date.now()}_emp`,
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

  // Deep clone tabs, preserving all tab IDs, column IDs, and master-detail relations internally
  // so every dependency and tag keeps working immediately while remaining completely isolated inside the new LegalEntity.
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
    id: `entity_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    profile: { ...newProfile },
    tabs: clonedTabs,
    tags: JSON.parse(JSON.stringify(source.tags || [])),
    templates: JSON.parse(JSON.stringify(source.templates || BUILT_IN_TEMPLATES)),
    llmLogs: [],
    createdAt: now,
    updatedAt: now
  };
}

export const storageService = {
  loadDatabase(): DatabaseState {
    try {
      const serialized = localStorage.getItem(STORAGE_KEY);
      if (serialized) {
        const parsed = JSON.parse(serialized);
        return normalizeDatabaseState(parsed);
      }
    } catch (e) {
      console.warn('Failed to parse saved database from localStorage, resetting to initial', e);
    }
    return INITIAL_DATABASE_STATE;
  },

  saveDatabase(state: DatabaseState): void {
    try {
      const toSave: DatabaseState = {
        ...state,
        lastSaved: new Date().toISOString()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.error('Failed to save database to localStorage', e);
    }
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
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  },

  async importDatabaseFromFile(file: File): Promise<DatabaseState> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          const parsed = JSON.parse(content);
          const hasLegacyTabs = Array.isArray(parsed?.tabs);
          const hasEntities = Array.isArray(parsed?.entities) && parsed.entities.length > 0;
          if (!hasLegacyTabs && !hasEntities) {
            throw new Error('Файл не содержит корректных таблиц или карточек организаций');
          }
          const normalized = normalizeDatabaseState(parsed);
          storageService.saveDatabase(normalized);
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
