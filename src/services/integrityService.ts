import { Column, DocumentTemplate, GeneratedDocRecord, Row, Tab, Tag } from '../types/database';

export const BUILT_IN_ENTITY_AND_SYSTEM_TAGS = new Set<string>([
  '{id}',
  '{Организация}',
  '{Организация_полное}',
  '{ИНН}',
  '{КПП}',
  '{ОГРН}',
  '{ОКПО}',
  '{ОКВЭД}',
  '{Реквизиты_банка}',
  '{Банк_в}',
  '{Юридический_адрес}',
  '{Email_организации}',
  '{Телефон_организации}',
  '{Генеральный_директор}'
]);

export function createUniqueId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export interface BrokenRelationIssue {
  tabId: string;
  tabName: string;
  columnId: string;
  columnName: string;
  reason: string;
}

export interface OrphanedCellIssue {
  tabId: string;
  tabName: string;
  rowId: string;
  rowNumber: number;
  columnId: string;
  columnName: string;
  value: string;
  masterTabName: string;
}

export interface BrokenTagIssue {
  tagId: string;
  tagName: string;
  reason: string;
}

export interface IntegrityAuditReport {
  brokenRelations: BrokenRelationIssue[];
  orphanedCells: OrphanedCellIssue[];
  brokenTags: BrokenTagIssue[];
  totalIssues: number;
}

export interface DeleteImpactSummary {
  affectedTabs: { tabId: string; tabName: string; columnNames: string[]; affectedRowCount: number }[];
  affectedTagsCount: number;
  affectedTemplatesCount?: number;
  affectedTemplateNames?: string[];
  affectedDocsCount?: number;
  totalAffectedRows: number;
}

export interface AmbiguousCascadeItem {
  tabId: string;
  tabName: string;
  rowId: string;
  rowNumber: number;
  columnNames: string[];
  matchCount: number;
  reason: string;
}

export interface MasterCascadeResult {
  tabs: Tab[];
  updatedRowsCount: number;
  ambiguousItems: AmbiguousCascadeItem[];
  skippedIncompatibleCount: number;
}

export type ColumnRenameValidationResult =
  | { ok: true; trimmed: string; unchanged: boolean }
  | { ok: false; reason: 'empty' | 'duplicate'; message: string };

export interface ColumnRenameImpact {
  hasDependencies: boolean;
  directTagCandidates: string[];
  boundTags: Array<{ id: string; name: string }>;
  affectedTemplatesByColumnTag: Array<{
    id: string;
    name: string;
    matchedPlaceholders: string[];
    isArchived?: boolean;
  }>;
  affectedTemplatesByBoundTag: Array<{
    id: string;
    name: string;
    tagNames: string[];
    isArchived?: boolean;
  }>;
  dependentRelationColumns: Array<{
    tabId: string;
    tabName: string;
    columnId: string;
    columnName: string;
  }>;
}

export function normalizeRelationValue(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export const integrityService = {
  /**
   * Apply a Master row edit and cascade changes to dependent tabs ONLY when all filled relation columns
   * on a dependent row uniquely identify the edited Master row (`candidateMasterRows.length === 1 && === oldMasterRow.id`).
   * Ambiguous (`> 1`) or incompatible (`0`) dependent rows are preserved untouched and reported explicitly.
   */
  applyMasterRowCascade(
    tabs: Tab[],
    masterTabId: string,
    rowId: string,
    patch: Record<string, any>
  ): MasterCascadeResult {
    const masterTab = tabs.find((t) => t.id === masterTabId);
    const oldMasterRow = masterTab?.rows.find((r) => r.id === rowId);
    if (!masterTab || !oldMasterRow) {
      return { tabs, updatedRowsCount: 0, ambiguousItems: [], skippedIncompatibleCount: 0 };
    }

    const newMasterRow: Row = { ...oldMasterRow, ...patch };
    const changedMasterCols = Object.keys(patch).filter((colId) => {
      const prevNorm = normalizeRelationValue(oldMasterRow[colId]);
      if (!prevNorm) return false;
      return String(oldMasterRow[colId] ?? '') !== String(newMasterRow[colId] ?? '');
    });

    let updatedRowsCount = 0;
    const ambiguousItems: AmbiguousCascadeItem[] = [];
    let skippedIncompatibleCount = 0;

    const updatedTabs = tabs.map((tab) => {
      if (tab.id === masterTabId) {
        return {
          ...tab,
          rows: tab.rows.map((r) => (r.id === rowId ? newMasterRow : r))
        };
      }

      if (changedMasterCols.length === 0) {
        return tab;
      }

      const allMasterRelCols = tab.columns.filter(
        (c) => c.type === 'relation' && c.relation?.masterTabId === masterTabId
      );
      if (allMasterRelCols.length === 0) return tab;

      const changedRelCols = allMasterRelCols.filter((c) =>
        changedMasterCols.includes(c.relation!.masterColumnId)
      );
      if (changedRelCols.length === 0) return tab;

      let tabChanged = false;
      const nextRows = tab.rows.map((depRow, idx) => {
        const matchedChangedCols = changedRelCols.filter(
          (rc) =>
            normalizeRelationValue(depRow[rc.id]) ===
            normalizeRelationValue(oldMasterRow[rc.relation!.masterColumnId])
        );
        if (matchedChangedCols.length === 0) {
          return depRow;
        }

        const filledRelCols = allMasterRelCols.filter(
          (c) => normalizeRelationValue(depRow[c.id]) !== ''
        );
        if (filledRelCols.length === 0) {
          return depRow;
        }

        const candidateMasterRows = masterTab.rows.filter((mr) =>
          filledRelCols.every(
            (rc) =>
              normalizeRelationValue(mr[rc.relation!.masterColumnId]) ===
              normalizeRelationValue(depRow[rc.id])
          )
        );

        if (candidateMasterRows.length === 1) {
          if (candidateMasterRows[0].id !== oldMasterRow.id) {
            // Unambiguously points to a different master row — leave untouched
            return depRow;
          }

          const rowCopy = { ...depRow };
          matchedChangedCols.forEach((rc) => {
            rowCopy[rc.id] = newMasterRow[rc.relation!.masterColumnId];
          });
          tabChanged = true;
          updatedRowsCount += 1;
          return rowCopy;
        }

        if (candidateMasterRows.length > 1) {
          ambiguousItems.push({
            tabId: tab.id,
            tabName: tab.name,
            rowId: depRow.id,
            rowNumber: idx + 1,
            columnNames: matchedChangedCols.map((c) => c.name),
            matchCount: candidateMasterRows.length,
            reason: `Строка №${idx + 1} во вкладке «${tab.name}» не обновлена автоматически: найдено ${candidateMasterRows.length} совпадающих записей в «${masterTab.name}» по связям (${filledRelCols.map((c) => c.name).join(', ')}).`
          });
          return depRow;
        }

        skippedIncompatibleCount += 1;
        return depRow;
      });

      return tabChanged ? { ...tab, rows: nextRows } : tab;
    });

    return {
      tabs: updatedTabs,
      updatedRowsCount,
      ambiguousItems,
      skippedIncompatibleCount
    };
  },

  /**
   * Perform full referential integrity audit across tabs, relation cells, tags, and templates
   */
  auditIntegrity(tabs: Tab[], tags: Tag[]): IntegrityAuditReport {
    const brokenRelations: BrokenRelationIssue[] = [];
    const orphanedCells: OrphanedCellIssue[] = [];
    const brokenTags: BrokenTagIssue[] = [];

    const tabMap = new Map(tabs.map((t) => [t.id, t]));

    tabs.forEach((tab) => {
      // Track valid relation columns and build Master lookup sets
      const validRelationCols: { col: Column; masterTab: Tab; valueSet: Set<string> }[] = [];

      tab.columns.forEach((col) => {
        if (col.type !== 'relation') return;
        if (!col.relation || !col.relation.masterTabId || !col.relation.masterColumnId) {
          brokenRelations.push({
            tabId: tab.id,
            tabName: tab.name,
            columnId: col.id,
            columnName: col.name,
            reason: 'У столбца со связью не указан мастер-источник'
          });
          return;
        }
        const masterTab = tabMap.get(col.relation.masterTabId);
        if (!masterTab) {
          brokenRelations.push({
            tabId: tab.id,
            tabName: tab.name,
            columnId: col.id,
            columnName: col.name,
            reason: `Удалена связанная мастер-таблица (${col.relation.masterTabId})`
          });
          return;
        }
        const masterCol = masterTab.columns.find((mc) => mc.id === col.relation!.masterColumnId);
        if (!masterCol) {
          brokenRelations.push({
            tabId: tab.id,
            tabName: tab.name,
            columnId: col.id,
            columnName: col.name,
            reason: `В мастер-таблице «${masterTab.name}» удален связанный столбец`
          });
          return;
        }

        const valueSet = new Set(
          masterTab.rows
            .map((r) => String(r[masterCol.id] ?? '').trim().toLowerCase())
            .filter(Boolean)
        );
        validRelationCols.push({ col, masterTab, valueSet });
      });

      // Verify every cell value in valid relation columns still exists in Master
      tab.rows.forEach((row, idx) => {
        validRelationCols.forEach(({ col, masterTab, valueSet }) => {
          const raw = row[col.id];
          if (raw === undefined || raw === null) return;
          const strVal = String(raw).trim();
          if (!strVal) return;

          if (!valueSet.has(strVal.toLowerCase())) {
            orphanedCells.push({
              tabId: tab.id,
              tabName: tab.name,
              rowId: row.id,
              rowNumber: idx + 1,
              columnId: col.id,
              columnName: col.name,
              value: strVal,
              masterTabName: masterTab.name
            });
          }
        });
      });
    });

    tags.forEach((tag) => {
      const t = tabMap.get(tag.tabId);
      if (!t) {
        brokenTags.push({
          tagId: tag.id,
          tagName: tag.name,
          reason: `Вкладка-источник (${tag.tabId}) удалена`
        });
        return;
      }
      if (!t.columns.some((c) => c.id === tag.columnId)) {
        brokenTags.push({
          tagId: tag.id,
          tagName: tag.name,
          reason: `Во вкладке «${t.name}» удален столбец (${tag.columnId})`
        });
      }
    });

    const totalIssues = brokenRelations.length + orphanedCells.length + brokenTags.length;
    return {
      brokenRelations,
      orphanedCells,
      brokenTags,
      totalIssues
    };
  },

  /**
   * Compute dependent references impacted when deleting rows from a Master tab
   */
  getRowDeleteImpact(masterTab: Tab, rowIdsToDelete: string[], allTabs: Tab[]): DeleteImpactSummary {
    const idSet = new Set(rowIdsToDelete);
    const deletingRows = masterTab.rows.filter((r) => idSet.has(r.id));
    if (deletingRows.length === 0) {
      return { affectedTabs: [], affectedTagsCount: 0, totalAffectedRows: 0 };
    }

    const affectedTabs: DeleteImpactSummary['affectedTabs'] = [];
    let totalAffectedRows = 0;

    allTabs.forEach((tab) => {
      if (tab.id === masterTab.id) return;
      const relCols = tab.columns.filter(
        (c) => c.type === 'relation' && c.relation?.masterTabId === masterTab.id
      );
      if (relCols.length === 0) return;

      const deletedValuesByMasterCol = new Map<string, Set<string>>();
      relCols.forEach((rc) => {
        const mColId = rc.relation!.masterColumnId;
        if (!deletedValuesByMasterCol.has(mColId)) {
          deletedValuesByMasterCol.set(
            mColId,
            new Set(
              deletingRows
                .map((r) => String(r[mColId] ?? '').trim().toLowerCase())
                .filter(Boolean)
            )
          );
        }
      });

      const affectedRowIds = new Set<string>();
      tab.rows.forEach((childRow) => {
        for (const rc of relCols) {
          const val = String(childRow[rc.id] ?? '').trim().toLowerCase();
          if (val && deletedValuesByMasterCol.get(rc.relation!.masterColumnId)?.has(val)) {
            affectedRowIds.add(childRow.id);
          }
        }
      });

      if (affectedRowIds.size > 0) {
        totalAffectedRows += affectedRowIds.size;
        affectedTabs.push({
          tabId: tab.id,
          tabName: tab.name,
          columnNames: relCols.map((c) => c.name),
          affectedRowCount: affectedRowIds.size
        });
      }
    });

    return {
      affectedTabs,
      affectedTagsCount: 0,
      totalAffectedRows
    };
  },

  /**
   * Compute impact when deleting a column
   */
  getColumnDeleteImpact(tabId: string, columnId: string, allTabs: Tab[], tags: Tag[]): DeleteImpactSummary {
    const affectedTabs: DeleteImpactSummary['affectedTabs'] = [];
    let totalAffectedRows = 0;

    allTabs.forEach((t) => {
      if (t.id === tabId) return;
      const depCols = t.columns.filter(
        (c) => c.type === 'relation' && c.relation?.masterTabId === tabId && c.relation?.masterColumnId === columnId
      );
      if (depCols.length > 0) {
        const nonEmptyRows = t.rows.filter((r) =>
          depCols.some((dc) => String(r[dc.id] ?? '').trim() !== '')
        ).length;
        totalAffectedRows += nonEmptyRows;
        affectedTabs.push({
          tabId: t.id,
          tabName: t.name,
          columnNames: depCols.map((dc) => dc.name),
          affectedRowCount: nonEmptyRows
        });
      }
    });

    const affectedTagsCount = tags.filter(
      (tag) => tag.tabId === tabId && tag.columnId === columnId
    ).length;

    return { affectedTabs, affectedTagsCount, totalAffectedRows };
  },

  /**
   * Compute impact when deleting an entire tab (master relations, bound tags, templates, generated docs)
   */
  getTabDeleteImpact(
    tabId: string,
    allTabs: Tab[],
    tags: Tag[],
    templates: DocumentTemplate[] = [],
    generatedDocs: GeneratedDocRecord[] = []
  ): DeleteImpactSummary {
    const affectedTabs: DeleteImpactSummary['affectedTabs'] = [];
    let totalAffectedRows = 0;

    allTabs.forEach((t) => {
      if (t.id === tabId) return;
      const depCols = t.columns.filter(
        (c) => c.type === 'relation' && c.relation?.masterTabId === tabId
      );
      if (depCols.length > 0) {
        const nonEmptyRows = t.rows.filter((r) =>
          depCols.some((dc) => String(r[dc.id] ?? '').trim() !== '')
        ).length;
        totalAffectedRows += nonEmptyRows;
        affectedTabs.push({
          tabId: t.id,
          tabName: t.name,
          columnNames: depCols.map((dc) => dc.name),
          affectedRowCount: nonEmptyRows
        });
      }
    });

    const targetTab = allTabs.find((t) => t.id === tabId);
    const affectedTagsCount = tags.filter((tag) => tag.tabId === tabId).length;
    const boundTemplates = templates.filter((tpl) => tpl.tabId === tabId && !tpl.isArchived);
    const affectedDocsCount = targetTab
      ? generatedDocs.filter((d) => d.sourceTabName === targetTab.name).length
      : 0;

    return {
      affectedTabs,
      affectedTagsCount,
      affectedTemplatesCount: boundTemplates.length,
      affectedTemplateNames: boundTemplates.map((tpl) => tpl.name),
      affectedDocsCount,
      totalAffectedRows
    };
  },

  /**
   * Archive templates bound to a deleted tab so users can inspect/restore them later
   */
  archiveTabTemplates(
    templates: DocumentTemplate[],
    tabId: string,
    tabName: string
  ): DocumentTemplate[] {
    const nowIso = new Date().toISOString();
    return templates.map((tpl) =>
      tpl.tabId === tabId && !tpl.isArchived
        ? {
            ...tpl,
            tabId: '',
            isArchived: true,
            archivedAt: nowIso,
            archivedFromTabName: tabName
          }
        : tpl
    );
  },

  /**
   * Permanently remove templates bound to a deleted tab
   */
  deleteTabTemplates(templates: DocumentTemplate[], tabId: string): DocumentTemplate[] {
    return templates.filter((tpl) => tpl.tabId !== tabId);
  },

  /**
   * Remove broken relation references pointing to a deleted tab, converting linked columns cleanly to text
   */
  cleanReferencesAfterTabDelete(remainingTabs: Tab[], deletedTabId: string): Tab[] {
    return remainingTabs.map((tab) => ({
      ...tab,
      columns: tab.columns.map((col) => {
        if (col.type === 'relation' && col.relation?.masterTabId === deletedTabId) {
          const { relation: _drop, ...rest } = col;
          return { ...rest, type: 'text' as const };
        }
        return col;
      })
    }));
  },

  /**
   * Remove broken relation references pointing to deleted column(s) inside targetTabId
   */
  cleanReferencesAfterColumnsUpdate(allTabs: Tab[], updatedTabId: string, updatedColumns: Column[]): Tab[] {
    const validColIds = new Set(updatedColumns.map((c) => c.id));
    return allTabs.map((tab) => {
      if (tab.id === updatedTabId) {
        return {
          ...tab,
          columns: updatedColumns
        };
      }
      return {
        ...tab,
        columns: tab.columns.map((col) => {
          if (
            col.type === 'relation' &&
            col.relation?.masterTabId === updatedTabId &&
            !validColIds.has(col.relation.masterColumnId)
          ) {
            const { relation: _drop, ...rest } = col;
            return { ...rest, type: 'text' as const };
          }
          return col;
        })
      };
    });
  },

  /**
   * Strip tags whose source tab or column no longer exists
   */
  pruneOrphanedTags(tags: Tag[], tabs: Tab[]): Tag[] {
    const tabMap = new Map(tabs.map((t) => [t.id, t]));
    return tags.filter((tag) => {
      const t = tabMap.get(tag.tabId);
      if (!t) return false;
      return t.columns.some((c) => c.id === tag.columnId);
    });
  },

  /**
   * Repair all broken relations & broken tags cleanly without losing row cell text
   */
  repairBrokenReferences(tabs: Tab[], tags: Tag[]): { tabs: Tab[]; tags: Tag[] } {
    const tabMap = new Map(tabs.map((t) => [t.id, t]));
    const cleanedTabs = tabs.map((tab) => ({
      ...tab,
      columns: tab.columns.map((col) => {
        if (col.type !== 'relation') return col;
        const mTab = col.relation?.masterTabId ? tabMap.get(col.relation.masterTabId) : undefined;
        const mCol = mTab?.columns.find((c) => c.id === col.relation?.masterColumnId);
        if (!mTab || !mCol) {
          const { relation: _drop, ...rest } = col;
          return { ...rest, type: 'text' as const };
        }
        return col;
      })
    }));
    const cleanedTags = integrityService.pruneOrphanedTags(tags, cleanedTabs);
    return { tabs: cleanedTabs, tags: cleanedTags };
  },

  /**
   * Check whether a template placeholder tag is unresolved (not in user tags and not a built-in entity/system tag)
   */
  getOrphanedTemplateTags(templates: DocumentTemplate[], boundTags: Tag[]): string[] {
    const templateTags = new Set<string>();
    templates.forEach((tpl) => {
      const matches = tpl.contentTemplate.match(/\{[A-Za-zА-Яа-яЁё0-9_]+\}/g) || [];
      matches.forEach((m) => templateTags.add(m));
    });

    const boundNames = new Set(boundTags.map((t) => t.name));
    const orphaned: string[] = [];
    templateTags.forEach((tName) => {
      if (!boundNames.has(tName) && !BUILT_IN_ENTITY_AND_SYSTEM_TAGS.has(tName)) {
        orphaned.push(tName);
      }
    });
    return orphaned;
  },

  /**
   * Check which document templates (active or archived) reference a given tag name
   */
  getTagDeleteImpact(
    tagName: string,
    templates: DocumentTemplate[]
  ): {
    isUsed: boolean;
    usedInTemplates: { id: string; name: string; isArchived?: boolean }[];
  } {
    const clean = String(tagName || '').trim();
    if (!clean) {
      return { isUsed: false, usedInTemplates: [] };
    }
    const usedInTemplates = templates
      .filter(
        (tpl) =>
          (tpl.contentTemplate && tpl.contentTemplate.includes(clean)) ||
          (tpl.namingPattern && tpl.namingPattern.includes(clean))
      )
      .map((tpl) => ({
        id: tpl.id,
        name: tpl.name,
        isArchived: tpl.isArchived
      }));

    return {
      isUsed: usedInTemplates.length > 0,
      usedInTemplates
    };
  },

  /**
   * Validate inline or modal column rename (blocks empty and case-insensitive duplicate names)
   */
  validateColumnRename(
    columns: Column[],
    columnId: string,
    candidateName: string
  ): ColumnRenameValidationResult {
    const trimmed = String(candidateName ?? '').trim();
    if (!trimmed) {
      return {
        ok: false,
        reason: 'empty',
        message: 'Название столбца не может быть пустым.'
      };
    }

    const currentCol = columns.find((c) => c.id === columnId);
    if (currentCol && currentCol.name === trimmed) {
      return { ok: true, trimmed, unchanged: true };
    }

    const duplicateCol = columns.find(
      (c) => c.id !== columnId && c.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicateCol) {
      return {
        ok: false,
        reason: 'duplicate',
        message: `Столбец с названием «${duplicateCol.name}» уже существует в этой таблице.`
      };
    }

    return { ok: true, trimmed, unchanged: false };
  },

  /**
   * Inspect template tags, bound Tag items, and master-relation references tied to a column before renaming
   */
  getColumnRenameImpact(
    tabId: string,
    columnId: string,
    allTabs: Tab[],
    tags: Tag[] = [],
    templates: DocumentTemplate[] = []
  ): ColumnRenameImpact {
    const sourceTab = allTabs.find((t) => t.id === tabId);
    const sourceCol = sourceTab?.columns.find((c) => c.id === columnId);

    if (!sourceTab || !sourceCol) {
      return {
        hasDependencies: false,
        directTagCandidates: [],
        boundTags: [],
        affectedTemplatesByColumnTag: [],
        affectedTemplatesByBoundTag: [],
        dependentRelationColumns: []
      };
    }

    const cleanName = sourceCol.name.trim();
    const directTagCandidates = cleanName
      ? Array.from(new Set([`{${cleanName}}`, `{${cleanName.replace(/\s+/g, '_')}}`]))
      : [];

    const boundTags = tags
      .filter((tag) => tag.tabId === tabId && tag.columnId === columnId)
      .map((tag) => ({ id: tag.id, name: tag.name }));
    const boundTagNames = new Set(boundTags.map((t) => t.name));

    const affectedTemplatesByColumnTag: ColumnRenameImpact['affectedTemplatesByColumnTag'] = [];
    const affectedTemplatesByBoundTag: ColumnRenameImpact['affectedTemplatesByBoundTag'] = [];

    templates
      .filter((tpl) => !tpl.isArchived)
      .forEach((tpl) => {
        const haystacks = [tpl.contentTemplate || '', tpl.namingPattern || ''];

        if (tpl.tabId === tabId && directTagCandidates.length > 0) {
          const matchedPlaceholders = directTagCandidates.filter(
            (candidate) =>
              !boundTagNames.has(candidate) && haystacks.some((h) => h.includes(candidate))
          );
          if (matchedPlaceholders.length > 0) {
            affectedTemplatesByColumnTag.push({
              id: tpl.id,
              name: tpl.name,
              matchedPlaceholders,
              isArchived: tpl.isArchived
            });
          }
        }

        if (boundTags.length > 0) {
          const matchedBound = boundTags
            .map((t) => t.name)
            .filter((tagName) => haystacks.some((h) => h.includes(tagName)));
          if (matchedBound.length > 0) {
            affectedTemplatesByBoundTag.push({
              id: tpl.id,
              name: tpl.name,
              tagNames: Array.from(new Set(matchedBound)),
              isArchived: tpl.isArchived
            });
          }
        }
      });

    const dependentRelationColumns: ColumnRenameImpact['dependentRelationColumns'] = [];
    allTabs.forEach((tab) => {
      if (tab.id === tabId) return;
      tab.columns.forEach((col) => {
        if (
          col.type === 'relation' &&
          col.relation?.masterTabId === tabId &&
          col.relation?.masterColumnId === columnId
        ) {
          dependentRelationColumns.push({
            tabId: tab.id,
            tabName: tab.name,
            columnId: col.id,
            columnName: col.name
          });
        }
      });
    });

    const hasDependencies =
      boundTags.length > 0 ||
      affectedTemplatesByColumnTag.length > 0 ||
      dependentRelationColumns.length > 0;

    return {
      hasDependencies,
      directTagCandidates,
      boundTags,
      affectedTemplatesByColumnTag,
      affectedTemplatesByBoundTag,
      dependentRelationColumns
    };
  }
};
