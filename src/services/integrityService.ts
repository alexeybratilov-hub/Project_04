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

export const integrityService = {
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
  }
};
