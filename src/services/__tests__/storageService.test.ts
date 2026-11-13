import { describe, it, expect } from 'vitest';
import {
  cloneLegalEntity,
  createIsolatedEmptyEntity,
  normalizeDatabaseState
} from '../storageService';
import { INITIAL_DATABASE_STATE } from '../../data/initialDatabase';
import { LegalEntityProfile } from '../../types/database';

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
});
