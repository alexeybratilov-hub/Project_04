import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyDatabaseTransition,
  cloneLegalEntity,
  createIsolatedEmptyEntity,
  inspectDatabaseBackupText,
  normalizeDatabaseState,
  PRE_RESTORE_BACKUP_KEY,
  sanitizeDatabaseForExport,
  STORAGE_KEY,
  storageService,
  summarizeDatabaseState
} from '../storageService';
import { localApiClient } from '../localApiClient';
import { INITIAL_DATABASE_STATE } from '../../data/initialDatabase';
import { DatabaseState, LegalEntityProfile } from '../../types/database';

const SAMPLE_PROFILE: LegalEntityProfile = {
  fullName: 'Общество с ограниченной ответственностью «Тест-Пром»',
  shortName: 'ООО «Тест-Пром»',
  inn: '7701999888',
  kpp: '770101001',
  ogrn: '1157746000111',
  okpo: '12345678',
  okved: '71.12',
  bankDetails: 'р/с 40702810000000000001',
  bankIn: 'ПАО Сбербанк',
  legalAddress: '101000, г. Москва, ул. Покровка, д. 1',
  email: 'info@testprom.ru',
  phone: '+7 (495) 111-22-33',
  directorFio: 'Смирнов А. В.'
};

describe('storageService', () => {
  it('migrates legacy v1 tabs state into multi-entity format without data loss and collects attachedDocs', () => {
    const legacyRaw = {
      version: '1.0.0',
      tabs: [
        {
          id: 'tab_custom',
          name: 'Тестовая вкладка',
          columns: [{ id: 'c1', name: 'ФИО', type: 'text' }],
          rows: [{ id: 'r1', c1: 'Петров И.И.' }],
          attachedDocs: [
            {
              id: 'doc_legacy_1',
              title: 'ГОСТ 12.0.004-2015',
              docType: 'gost',
              fileName: 'gost.pdf',
              fileSize: '120 КБ',
              uploadedAt: '2026-01-01T00:00:00Z'
            }
          ]
        }
      ],
      tags: [{ id: 't1', name: '{ФИО}', tabId: 'tab_custom', columnId: 'c1' }]
    };

    const normalized = normalizeDatabaseState(legacyRaw);
    expect(normalized.entities.length).toBe(1);
    expect(normalized.tabs.length).toBe(1);
    expect(normalized.tabs[0].rows[0].c1).toBe('Петров И.И.');
    expect(normalized.normativeDocs.some((d) => d.id === 'doc_legacy_1')).toBe(true);
    expect(normalized.tags).toHaveLength(1);
  });

  it('creates an isolated new legal entity with empty rows and separate IDs', () => {
    const ent = createIsolatedEmptyEntity(SAMPLE_PROFILE);
    expect(ent.profile.shortName).toBe('ООО «Тест-Пром»');
    expect(ent.tabs.length).toBeGreaterThanOrEqual(2);
    expect(ent.tabs.every((t) => t.rows.length === 0)).toBe(true);
    const staffTab = ent.tabs.find((t) => t.isMaster);
    expect(staffTab).toBeDefined();
    const empTab = ent.tabs.find((t) => !t.isMaster);
    expect(empTab?.columns.some((c) => c.type === 'relation' && c.relation?.masterTabId === staffTab?.id)).toBe(true);
  });

  it('clones an entity cleanly across structure_only, structure_and_masters, and full_copy modes without mutating source', () => {
    const source = INITIAL_DATABASE_STATE.entities[0];
    const clonedStruct = cloneLegalEntity(source, SAMPLE_PROFILE, 'structure_only');
    expect(clonedStruct.id).not.toBe(source.id);
    expect(clonedStruct.tabs.length).toBe(source.tabs.length);
    expect(clonedStruct.tabs.every((t) => t.rows.length === 0)).toBe(true);

    const clonedMasters = cloneLegalEntity(source, SAMPLE_PROFILE, 'structure_and_masters');
    const masterTabsInClone = clonedMasters.tabs.filter((t) => t.isMaster);
    const nonMasterTabsInClone = clonedMasters.tabs.filter((t) => !t.isMaster);
    expect(masterTabsInClone.some((t) => t.rows.length > 0)).toBe(true);
    expect(nonMasterTabsInClone.every((t) => t.rows.length === 0)).toBe(true);

    const clonedFull = cloneLegalEntity(source, SAMPLE_PROFILE, 'full_copy');
    expect(clonedFull.tabs[0].rows.length).toBe(source.tabs[0].rows.length);
    // Mutation isolation check
    clonedFull.tabs[0].rows[0].col_title = 'ИЗМЕНЕНО';
    expect(source.tabs[0].rows[0].col_title).not.toBe('ИЗМЕНЕНО');
  });

  describe('T-26: multi-step database backup inspection and safe restore with rollback', () => {
    const store = new Map<string, string>();
    const mockLocalStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear()
    };

    beforeEach(() => {
      store.clear();
      vi.stubGlobal('localStorage', mockLocalStorage);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('rejects malformed JSON, incompatible major version, and broken tab structure', () => {
      expect(() => inspectDatabaseBackupText('{bad json')).toThrow(/корректным JSON/i);
      expect(() => inspectDatabaseBackupText('[]')).toThrow(/JSON-объектом/i);
      expect(() =>
        inspectDatabaseBackupText(
          JSON.stringify({ version: '2.0.0', entities: INITIAL_DATABASE_STATE.entities })
        )
      ).toThrow(/несовместима/i);
      expect(() =>
        inspectDatabaseBackupText(
          JSON.stringify({ version: '1.3.0', entities: [{ id: 'e1', tabs: [{ id: 't1', name: 'T', columns: 'broken', rows: [] }] }] })
        )
      ).toThrow(/массив столбцов/i);
    });

    it('summarizes valid backup and flags integrity issues without touching storage', () => {
      const brokenBackup = {
        version: '1.3.0',
        entities: [
          {
            ...INITIAL_DATABASE_STATE.entities[0],
            tabs: [
              {
                id: 't_child',
                name: 'Работники',
                columns: [
                  { id: 'fio', name: 'ФИО', type: 'text' },
                  {
                    id: 'pos',
                    name: 'Должность',
                    type: 'relation',
                    relation: { masterTabId: 'missing_master', masterColumnId: 'c1' }
                  }
                ],
                rows: [{ id: 'r1', fio: 'Иванов', pos: 'Сварщик' }],
                attachedDocs: []
              }
            ],
            tags: []
          }
        ]
      };

      const preview = inspectDatabaseBackupText(JSON.stringify(brokenBackup), 'backup.json');
      expect(preview.sourceFormat).toBe('multi-entity');
      expect(preview.incomingSummary.rowsCount).toBe(1);
      expect(preview.integritySummary.brokenRelationsCount).toBe(1);
      expect(preview.warnings.length).toBeGreaterThan(0);
      expect(store.size).toBe(0);
    });

    it('creates pre-restore backup and rolls back cleanly when save fails', async () => {
      const currentState: DatabaseState = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
      const nextState: DatabaseState = {
        ...createIsolatedEmptyEntity(SAMPLE_PROFILE),
        version: '1.3.0',
        lastSaved: new Date().toISOString(),
        activeEntityId: 'entity_new',
        entities: [createIsolatedEmptyEntity(SAMPLE_PROFILE)],
        normativeDocs: [],
        tabs: [],
        tags: [],
        templates: [],
        generatedDocs: [],
        llmConfig: currentState.llmConfig,
        llmLogs: [],
        settings: currentState.settings
      } as DatabaseState;
      nextState.entities[0].id = 'entity_new';
      nextState.tabs = nextState.entities[0].tabs;

      store.set(STORAGE_KEY, JSON.stringify(currentState));

      const saveSpy = vi.spyOn(storageService, 'saveDatabaseAsync').mockResolvedValueOnce({
        ok: false,
        errorCode: 'QUOTA_EXCEEDED',
        message: 'Искусственный сбой записи'
      });

      const failedRes = await storageService.restoreDatabaseSafely(currentState, nextState);
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(failedRes.ok).toBe(false);
      expect(failedRes.rolledBack).toBe(true);
      expect(summarizeDatabaseState(failedRes.state).rowsCount).toBe(
        summarizeDatabaseState(currentState).rowsCount
      );
      // Pre-restore backup was saved and main STORAGE_KEY rolled back to currentState
      expect(store.has(PRE_RESTORE_BACKUP_KEY)).toBe(true);
      const storedAfterRollback = JSON.parse(store.get(STORAGE_KEY)!);
      expect(summarizeDatabaseState(storedAfterRollback).rowsCount).toBe(
        summarizeDatabaseState(currentState).rowsCount
      );

      // Native-mode failure on pre-restore disk backup aborts before saveDatabase
      vi.spyOn(localApiClient, 'isNative').mockReturnValue(true);
      const diskBackupSpy = vi
        .spyOn(localApiClient, 'createDiskBackup')
        .mockResolvedValueOnce({ ok: false, message: 'Нет места на USB' });
      const nativeSaveSpy = vi.spyOn(localApiClient, 'saveDatabase');

      const abortedNative = await storageService.restoreDatabaseSafely(currentState, nextState);
      expect(diskBackupSpy).toHaveBeenCalledTimes(1);
      expect(nativeSaveSpy).not.toHaveBeenCalled();
      expect(abortedNative.ok).toBe(false);
      expect(abortedNative.rolledBack).toBe(true);
      expect(abortedNative.error).toContain('Нет места на USB');

      // Native-mode successful restore creates disk backup first and returns its name
      diskBackupSpy.mockResolvedValueOnce({ ok: true, fileName: 'ot_backup_pre.json' });
      vi.spyOn(storageService, 'saveDatabaseAsync').mockResolvedValueOnce({ ok: true, revision: 12 });
      const okNative = await storageService.restoreDatabaseSafely(currentState, nextState);
      expect(okNative.ok).toBe(true);
      expect(okNative.rolledBack).toBe(false);
      expect(okNative.backupFileName).toBe('ot_backup_pre.json');
      expect(summarizeDatabaseState(okNative.state).entityNames).toContain('ООО «Тест-Пром»');
    });
  });

  describe('T-27: pure state transitions, entity-switch no-churn, and FIFO save serialization', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('applyDatabaseTransition preserves timestamps on entity switch (touchTimestamp: false) and syncs active entity on edits', () => {
      const ent1 = createIsolatedEmptyEntity(SAMPLE_PROFILE);
      ent1.id = 'ent_1';
      ent1.updatedAt = '2026-01-01T00:00:00.000Z';
      const ent2 = createIsolatedEmptyEntity({ ...SAMPLE_PROFILE, shortName: 'ООО «Вторая»' });
      ent2.id = 'ent_2';
      ent2.updatedAt = '2026-01-02T00:00:00.000Z';

      const base: DatabaseState = {
        ...JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE)),
        lastSaved: '2026-01-03T10:00:00.000Z',
        activeEntityId: ent1.id,
        entities: [ent1, ent2],
        tabs: ent1.tabs,
        tags: ent1.tags,
        templates: ent1.templates,
        generatedDocs: ent1.generatedDocs,
        llmLogs: ent1.llmLogs
      };

      // No-op returns exact reference
      expect(applyDatabaseTransition(base, (prev) => prev)).toBe(base);

      // Entity switch with touchTimestamp: false keeps timestamps untouched
      const switched = applyDatabaseTransition(
        base,
        (prev) => ({
          ...prev,
          activeEntityId: ent2.id,
          tabs: ent2.tabs,
          tags: ent2.tags,
          templates: ent2.templates,
          generatedDocs: ent2.generatedDocs || [],
          llmLogs: ent2.llmLogs || []
        }),
        { touchTimestamp: false }
      );

      expect(switched.activeEntityId).toBe('ent_2');
      expect(switched.lastSaved).toBe('2026-01-03T10:00:00.000Z');
      expect(switched.entities[0].updatedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(switched.entities[1].updatedAt).toBe('2026-01-02T00:00:00.000Z');

      // Real data edit syncs active entity and bumps timestamps
      const edited = applyDatabaseTransition(switched, (prev) => ({
        ...prev,
        tags: [{ id: 't_new', name: '{Тег}', tabId: ent2.tabs[0].id, columnId: ent2.tabs[0].columns[0].id }]
      }));

      expect(edited.lastSaved).not.toBe('2026-01-03T10:00:00.000Z');
      expect(edited.entities[1].tags).toHaveLength(1);
      expect(edited.entities[1].updatedAt).toBe(edited.lastSaved);
      expect(edited.entities[0].tags).toHaveLength(0);
    });

    it('serializes concurrent saveDatabaseAsync calls in strict FIFO order without overlapping writes', async () => {
      vi.spyOn(localApiClient, 'isNative').mockReturnValue(true);

      const events: string[] = [];
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      vi.spyOn(localApiClient, 'saveDatabase').mockImplementation(async (state) => {
        const tagCount = state.tags.length;
        events.push(`start:${tagCount}`);
        if (tagCount === 1) {
          await firstGate;
        }
        events.push(`end:${tagCount}`);
        return { ok: true, revision: tagCount };
      });

      const state1: DatabaseState = {
        ...JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE)),
        tags: [{ id: 't1', name: '{Один}', tabId: 't', columnId: 'c' }]
      };
      const state2: DatabaseState = {
        ...JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE)),
        tags: [
          { id: 't1', name: '{Один}', tabId: 't', columnId: 'c' },
          { id: 't2', name: '{Два}', tabId: 't', columnId: 'c' }
        ]
      };

      const p1 = storageService.saveDatabaseAsync(state1);
      const p2 = storageService.saveDatabaseAsync(state2);

      // Wait a microtask tick to ensure p1 started and p2 is queued (not overlapped!)
      await Promise.resolve();
      await Promise.resolve();
      expect(events).toEqual(['start:1']);

      releaseFirst();
      const [res1, res2] = await Promise.all([p1, p2]);

      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);
      expect(events).toEqual(['start:1', 'end:1', 'start:2', 'end:2']);
    });
  });

  describe('T-28: export secret sanitization', () => {
    it('strips LLM API key from database export by default without mutating live state, and preserves when explicitly opted in', () => {
      const stateWithSecret: DatabaseState = {
        ...JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE)),
        llmConfig: {
          ...INITIAL_DATABASE_STATE.llmConfig,
          providerId: 'openai',
          model: 'gpt-4o-mini',
          apiKey: 'sk-live-secret-987654'
        }
      };

      const defaultExport = sanitizeDatabaseForExport(stateWithSecret);
      expect(defaultExport.llmConfig.apiKey).toBe('');
      expect(defaultExport.llmConfig.providerId).toBe('openai');
      expect(defaultExport.llmConfig.model).toBe('gpt-4o-mini');
      // Live state must remain intact
      expect(stateWithSecret.llmConfig.apiKey).toBe('sk-live-secret-987654');

      const explicitExport = sanitizeDatabaseForExport(stateWithSecret, { includeLlmApiKey: true });
      expect(explicitExport.llmConfig.apiKey).toBe('sk-live-secret-987654');
    });
  });

  describe('T-30: AppSettings tabBarMode normalization', () => {
    it('defaults missing tabBarMode to single-row and preserves explicit auto mode', () => {
      const legacy = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
      delete legacy.settings.tabBarMode;

      const normalizedDefault = normalizeDatabaseState(legacy);
      expect(normalizedDefault.settings.tabBarMode).toBe('single');

      const withAuto = {
        ...legacy,
        settings: { ...legacy.settings, tabBarMode: 'auto' as const }
      };
      const normalizedAuto = normalizeDatabaseState(withAuto);
      expect(normalizedAuto.settings.tabBarMode).toBe('auto');
    });
  });

  describe('T-31: AppSettings rowDensity and pageSize normalization', () => {
    it('defaults missing or invalid rowDensity/pageSize and preserves valid values', () => {
      const legacy = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
      delete legacy.settings.rowDensity;
      delete legacy.settings.pageSize;

      const normalizedDefault = normalizeDatabaseState(legacy);
      expect(normalizedDefault.settings.rowDensity).toBe('compact');
      expect(normalizedDefault.settings.pageSize).toBe(100);

      for (const pageSize of [50, 100, 250, 500]) {
        const normalizedValid = normalizeDatabaseState({
          ...legacy,
          settings: { ...legacy.settings, rowDensity: 'normal', pageSize }
        });
        expect(normalizedValid.settings.rowDensity).toBe('normal');
        expect(normalizedValid.settings.pageSize).toBe(pageSize);
      }

      const normalizedInvalid = normalizeDatabaseState({
        ...legacy,
        settings: { ...legacy.settings, rowDensity: 'huge', pageSize: 999 }
      });
      expect(normalizedInvalid.settings.rowDensity).toBe('compact');
      expect(normalizedInvalid.settings.pageSize).toBe(100);
    });
  });

  describe('T-35: pre-reset backup safety in web and native modes', () => {
    const store = new Map<string, string>();
    const mockLocalStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear()
    };

    beforeEach(() => {
      store.clear();
      vi.stubGlobal('localStorage', mockLocalStorage);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('snapshots existing browser database into PRE_RESTORE_BACKUP_KEY before resetting', async () => {
      vi.spyOn(localApiClient, 'isNative').mockReturnValue(false);
      const customState: DatabaseState = {
        ...JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE)),
        tags: [{ id: 'custom_tag', name: '{МойТег}', tabId: 't1', columnId: 'c1' }]
      };
      store.set(STORAGE_KEY, JSON.stringify(customState));

      const res = await storageService.resetDatabaseAsync(customState);
      expect(res.saveResult.ok).toBe(true);
      expect(store.has(STORAGE_KEY)).toBe(false);
      expect(store.has(PRE_RESTORE_BACKUP_KEY)).toBe(true);
      const savedSnapshot = JSON.parse(store.get(PRE_RESTORE_BACKUP_KEY)!);
      expect(savedSnapshot.tags).toHaveLength(1);
      expect(savedSnapshot.tags[0].id).toBe('custom_tag');
    });

    it('creates native disk backup before reset and aborts reset without saving if backup fails', async () => {
      vi.spyOn(localApiClient, 'isNative').mockReturnValue(true);
      const customState: DatabaseState = {
        ...JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE)),
        tags: [{ id: 'native_tag', name: '{НативТег}', tabId: 't1', columnId: 'c1' }]
      };

      const backupSpy = vi
        .spyOn(localApiClient, 'createDiskBackup')
        .mockResolvedValueOnce({ ok: false, message: 'Диск защищён от записи' });
      const saveSpy = vi.spyOn(localApiClient, 'saveDatabase');

      const aborted = await storageService.resetDatabaseAsync(customState);
      expect(backupSpy).toHaveBeenCalledTimes(1);
      expect(saveSpy).not.toHaveBeenCalled();
      expect(aborted.saveResult.ok).toBe(false);
      expect(aborted.saveResult.message).toContain('Диск защищён от записи');
      expect(aborted.state.tags[0].id).toBe('native_tag');

      backupSpy.mockResolvedValueOnce({ ok: true, fileName: 'ot_backup_pre_reset.json' });
      saveSpy.mockResolvedValueOnce({ ok: true, revision: 99 });

      const succeeded = await storageService.resetDatabaseAsync(customState);
      expect(succeeded.saveResult.ok).toBe(true);
      expect(succeeded.backupFileName).toBe('ot_backup_pre_reset.json');
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
  });
});
