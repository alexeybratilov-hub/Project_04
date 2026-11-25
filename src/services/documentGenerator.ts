import { Column, DocumentTemplate, LegalEntityProfile, Row, Tab, Tag } from '../types/database';
import { formatDeadlineCellDisplay, resolveSafeRowIdentifier } from './deadlineService';
import { localApiClient } from './localApiClient';
import { BUILT_IN_ENTITY_AND_SYSTEM_TAGS } from './integrityService';
import {
  docxTemplateService,
  DocxRenderDiagnostic,
  DocxTagResolveOutcome
} from './docxTemplateService';

export interface GeneratedDocumentResult {
  fileName: string;
  docxBlob: Blob;
  pdfBlob: Blob;
  textPreview: string;
}

interface FontRegistrar {
  addFileToVFS(fileName: string, data: string): void;
  addFont(fileName: string, fontFamily: string, fontStyle: string): void;
}

function registerCyrillicFonts(
  doc: FontRegistrar,
  regularB64: string,
  boldB64: string
): void {
  doc.addFileToVFS('DejaVuSans.ttf', regularB64);
  doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', boldB64);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
}

export interface TemplateResolutionIssue {
  type: 'ambiguous' | 'not_found' | 'no_relations' | 'broken_tag';
  tagName: string;
  masterTabId: string;
  masterTabName: string;
  matchCount: number;
  reason: string;
}

export interface TemplateResolutionResult {
  text: string;
  issues: TemplateResolutionIssue[];
}

export interface DetailedTemplateResolutionResult extends TemplateResolutionResult {
  unknownTags: string[];
  emptyRowTags: string[];
  emptyProfileTags: string[];
}

export interface BatchGenerationItemResult {
  status: 'success' | 'error';
  rowId: string;
  rowNumber: number;
  rowIdentifier: string;
  fileName?: string;
  tagNames: string[];
  reason?: string;
  warnings: string[];
}

export interface BatchGenerationReport {
  templateId: string;
  templateName: string;
  templateType: 'text' | 'docx';
  format: 'docx' | 'pdf';
  createdAt: string;
  totalCount: number;
  successCount: number;
  errorCount: number;
  items: BatchGenerationItemResult[];
  errors: BatchGenerationItemResult[];
  successes: BatchGenerationItemResult[];
}

export type MasterRowMatchResult =
  | { status: 'no_relations' }
  | { status: 'no_filled_values' }
  | { status: 'matched'; row: Row }
  | { status: 'ambiguous'; matches: Row[]; matchedColumns: string[] }
  | { status: 'not_found'; matchedColumns: string[] };

const PLACEHOLDER_REGEX = /\{([^{}\r\n]+)\}/g;

function normalizeLookupValue(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function getRowDisplayIdentifier(row: Row, tabRef: Tab, fallbackRowNumber?: number): string {
  return resolveSafeRowIdentifier(row, tabRef, fallbackRowNumber);
}

function formatRowCellForTemplate(
  rawVal: unknown,
  col?: Column,
  options?: { holidays?: string[]; todayIso?: string }
): string {
  if (rawVal === undefined || rawVal === null) return '';
  if (col?.type === 'deadline_control') {
    return formatDeadlineCellDisplay(rawVal, col.deadlineConfig, {
      mode: 'next_date',
      holidays: options?.holidays,
      todayIso: options?.todayIso
    });
  }
  if (typeof rawVal === 'object') return '';
  return String(rawVal);
}

/**
 * Find an UNAMBIGUOUS matching row in `otherTab` for the given source `row` in `currentTab`
 * using the FULL set of filled relation columns linking `currentTab` -> `otherTab`.
 * Never falls back to single-column partial matching and never picks an arbitrary row on duplicates.
 */
export function resolveMasterRowMatch(
  row: Row,
  currentTab: Tab,
  otherTab: Tab
): MasterRowMatchResult {
  const relCols = currentTab.columns.filter(
    (c) => c.type === 'relation' && c.relation?.masterTabId === otherTab.id
  );
  if (relCols.length === 0) {
    return { status: 'no_relations' };
  }

  const filledRelCols = relCols.filter((c) => normalizeLookupValue(row[c.id]) !== '');
  if (filledRelCols.length === 0) {
    return { status: 'no_filled_values' };
  }

  const matches = otherTab.rows.filter((mr) =>
    filledRelCols.every(
      (rc) =>
        normalizeLookupValue(mr[rc.relation!.masterColumnId]) ===
        normalizeLookupValue(row[rc.id])
    )
  );

  if (matches.length === 1) {
    return { status: 'matched', row: matches[0] };
  }

  const matchedColumns = filledRelCols.map((c) => c.name);
  if (matches.length > 1) {
    return { status: 'ambiguous', matches, matchedColumns };
  }

  return { status: 'not_found', matchedColumns };
}

function getEntityProfileTagValue(tagName: string, entityProfile?: LegalEntityProfile): string | null {
  switch (tagName) {
    case '{Организация}':
      return entityProfile?.shortName || entityProfile?.fullName || '';
    case '{Организация_полное}':
      return entityProfile?.fullName || entityProfile?.shortName || '';
    case '{ИНН}':
      return entityProfile?.inn || '';
    case '{КПП}':
      return entityProfile?.kpp || '';
    case '{ОГРН}':
      return entityProfile?.ogrn || '';
    case '{ОКПО}':
      return entityProfile?.okpo || '';
    case '{ОКВЭД}':
      return entityProfile?.okved || '';
    case '{Реквизиты_банка}':
      return entityProfile?.bankDetails || '';
    case '{Банк_в}':
      return entityProfile?.bankIn || '';
    case '{Юридический_адрес}':
      return entityProfile?.legalAddress || '';
    case '{Email_организации}':
      return entityProfile?.email || '';
    case '{Телефон_организации}':
      return entityProfile?.phone || '';
    case '{Генеральный_директор}':
      return entityProfile?.directorFio || '';
    default:
      return null;
  }
}

export interface RowTagContextResolver {
  resolveTag: (tagName: string) => DocxTagResolveOutcome & { isProfileEmpty?: boolean };
  getDiagnostics: () => {
    issues: TemplateResolutionIssue[];
    unknownTags: string[];
    emptyRowTags: string[];
    emptyProfileTags: string[];
  };
}

/**
 * Unified tag resolver shared between plain-text templates and native OOXML DOCX templates.
 */
export function createRowTagResolver(
  row: Row,
  currentTab: Tab,
  allTabs: Tab[],
  tags: Tag[],
  entityProfile?: LegalEntityProfile,
  options?: { holidays?: string[]; todayIso?: string }
): RowTagContextResolver {
  const lookupCache = new Map<string, MasterRowMatchResult>();
  const issues: TemplateResolutionIssue[] = [];
  const issueKeys = new Set<string>();
  const unknownTags = new Set<string>();
  const emptyRowTags = new Set<string>();
  const emptyProfileTags = new Set<string>();

  const tagMap = new Map<string, Tag>();
  tags.forEach((t) => {
    if (!tagMap.has(t.name)) tagMap.set(t.name, t);
  });

  const colTagMap = new Map<string, Column>();
  currentTab.columns.forEach((col) => {
    colTagMap.set(`{${col.name}}`, col);
    colTagMap.set(`{${col.name.replace(/\s+/g, '_')}}`, col);
  });

  const pushIssueOnce = (issue: TemplateResolutionIssue) => {
    const key = `${issue.type}::${issue.tagName}`;
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    issues.push(issue);
  };

  const resolveTag = (
    tagName: string
  ): DocxTagResolveOutcome & { isProfileEmpty?: boolean } => {
    // 1. User-bound Tag pool
    const boundTag = tagMap.get(tagName);
    if (boundTag) {
      let value = '';
      if (boundTag.tabId === currentTab.id) {
        const targetCol = currentTab.columns.find((c) => c.id === boundTag.columnId);
        if (!targetCol) {
          pushIssueOnce({
            type: 'broken_tag',
            tagName: boundTag.name,
            masterTabId: currentTab.id,
            masterTabName: currentTab.name,
            matchCount: 0,
            reason: `Тег ${boundTag.name} ссылается на удалённый столбец таблицы «${currentTab.name}».`
          });
          return { known: true, value: '' };
        }
        value = formatRowCellForTemplate(row[boundTag.columnId], targetCol, options);
        if (value.trim() === '') {
          emptyRowTags.add(tagName);
          return { known: true, value: '', isEmptyRowValue: true };
        }
        return { known: true, value };
      }

      const otherTab = allTabs.find((t) => t.id === boundTag.tabId);
      if (!otherTab) {
        pushIssueOnce({
          type: 'broken_tag',
          tagName: boundTag.name,
          masterTabId: boundTag.tabId,
          masterTabName: boundTag.tabId,
          matchCount: 0,
          reason: `Тег ${boundTag.name} ссылается на удалённую таблицу (${boundTag.tabId}).`
        });
        return { known: true, value: '' };
      }

      const otherCol = otherTab.columns.find((c) => c.id === boundTag.columnId);
      if (!otherCol) {
        pushIssueOnce({
          type: 'broken_tag',
          tagName: boundTag.name,
          masterTabId: otherTab.id,
          masterTabName: otherTab.name,
          matchCount: 0,
          reason: `Тег ${boundTag.name} ссылается на удалённый столбец таблицы «${otherTab.name}».`
        });
        return { known: true, value: '' };
      }

      let matchResult = lookupCache.get(otherTab.id);
      if (!matchResult) {
        matchResult = resolveMasterRowMatch(row, currentTab, otherTab);
        lookupCache.set(otherTab.id, matchResult);
      }

      if (matchResult.status === 'matched') {
        value = formatRowCellForTemplate(matchResult.row[boundTag.columnId], otherCol, options);
        if (value.trim() === '') {
          emptyRowTags.add(tagName);
          return { known: true, value: '', isEmptyRowValue: true };
        }
        return { known: true, value };
      }

      if (matchResult.status === 'no_filled_values') {
        emptyRowTags.add(tagName);
        return { known: true, value: '', isEmptyRowValue: true };
      }

      if (matchResult.status === 'ambiguous') {
        pushIssueOnce({
          type: 'ambiguous',
          tagName: boundTag.name,
          masterTabId: otherTab.id,
          masterTabName: otherTab.name,
          matchCount: matchResult.matches.length,
          reason: `Для тега ${boundTag.name} найдено ${matchResult.matches.length} совпадений в таблице «${otherTab.name}» по полям (${matchResult.matchedColumns.join(', ')}). Произвольный выбор запрещён.`
        });
      } else if (matchResult.status === 'not_found') {
        pushIssueOnce({
          type: 'not_found',
          tagName: boundTag.name,
          masterTabId: otherTab.id,
          masterTabName: otherTab.name,
          matchCount: 0,
          reason: `Для тега ${boundTag.name} не найдена строка в «${otherTab.name}» с полным совпадением полей (${matchResult.matchedColumns.join(', ')}).`
        });
      } else if (matchResult.status === 'no_relations') {
        pushIssueOnce({
          type: 'no_relations',
          tagName: boundTag.name,
          masterTabId: otherTab.id,
          masterTabName: otherTab.name,
          matchCount: 0,
          reason: `Тег ${boundTag.name} ссылается на «${otherTab.name}», но текущая таблица «${currentTab.name}» не имеет с ней связующих столбцов.`
        });
      }

      return { known: true, value: '' };
    }

    // 2. Direct current tab column name tags: {Должность}, {ФИО_работника}
    const directCol = colTagMap.get(tagName);
    if (directCol) {
      const val = formatRowCellForTemplate(row[directCol.id], directCol, options);
      if (val.trim() === '') {
        emptyRowTags.add(tagName);
        return { known: true, value: '', isEmptyRowValue: true };
      }
      return { known: true, value: val };
    }

    // 3. Built-in entity profile requisites
    if (BUILT_IN_ENTITY_AND_SYSTEM_TAGS.has(tagName)) {
      if (tagName === '{id}') {
        return { known: true, value: row.id || '1' };
      }
      const profileVal = getEntityProfileTagValue(tagName, entityProfile) ?? '';
      if (profileVal.trim() === '') {
        emptyProfileTags.add(tagName);
        return { known: true, value: '', isProfileEmpty: true };
      }
      return { known: true, value: profileVal };
    }

    // 4. Unknown placeholder
    unknownTags.add(tagName);
    return { known: false, value: tagName };
  };

  return {
    resolveTag,
    getDiagnostics: () => ({
      issues,
      unknownTags: Array.from(unknownTags),
      emptyRowTags: Array.from(emptyRowTags),
      emptyProfileTags: Array.from(emptyProfileTags)
    })
  };
}

export const documentGenerator = {
  /**
   * Resolve tags in a template string with full diagnostics:
   * relation errors, broken tags, unknown tags, and empty cell/profile tags.
   */
  resolveTemplateTagsDetailed(
    templateContent: string,
    row: Row,
    currentTab: Tab,
    allTabs: Tab[],
    tags: Tag[],
    entityProfile?: LegalEntityProfile,
    options?: { holidays?: string[]; todayIso?: string }
  ): DetailedTemplateResolutionResult {
    const resolver = createRowTagResolver(row, currentTab, allTabs, tags, entityProfile, options);
    const resolved = templateContent.replace(PLACEHOLDER_REGEX, (fullMatch, inner) => {
      if (!String(inner).trim()) return fullMatch;
      const outcome = resolver.resolveTag(fullMatch);
      return outcome.known ? outcome.value : fullMatch;
    });
    const diag = resolver.getDiagnostics();
    return {
      text: resolved,
      issues: diag.issues,
      unknownTags: diag.unknownTags,
      emptyRowTags: diag.emptyRowTags,
      emptyProfileTags: diag.emptyProfileTags
    };
  },

  /**
   * Resolve tags in a template string for a specific row and return rendered text + relation issues.
   */
  resolveTemplateTagsWithReport(
    templateContent: string,
    row: Row,
    currentTab: Tab,
    allTabs: Tab[],
    tags: Tag[],
    entityProfile?: LegalEntityProfile,
    options?: { holidays?: string[]; todayIso?: string }
  ): TemplateResolutionResult {
    const detailed = documentGenerator.resolveTemplateTagsDetailed(
      templateContent,
      row,
      currentTab,
      allTabs,
      tags,
      entityProfile,
      options
    );
    return { text: detailed.text, issues: detailed.issues };
  },

  /**
   * Resolve tags in a template string for a specific row (and optional active LegalEntityProfile)
   */
  resolveTemplateTags(
    templateContent: string,
    row: Row,
    currentTab: Tab,
    allTabs: Tab[],
    tags: Tag[],
    entityProfile?: LegalEntityProfile,
    options?: { holidays?: string[]; todayIso?: string }
  ): string {
    return documentGenerator.resolveTemplateTagsWithReport(
      templateContent,
      row,
      currentTab,
      allTabs,
      tags,
      entityProfile,
      options
    ).text;
  },

  /**
   * Resolve filename using naming pattern
   */
  resolveFileName(
    pattern: string,
    row: Row,
    currentTab: Tab,
    allTabs: Tab[],
    tags: Tag[],
    extension: 'docx' | 'pdf',
    entityProfile?: LegalEntityProfile,
    options?: { holidays?: string[]; todayIso?: string }
  ): string {
    let base = pattern || 'Документ_{id}.docx';
    base = documentGenerator.resolveTemplateTags(
      base,
      row,
      currentTab,
      allTabs,
      tags,
      entityProfile,
      options
    );
    base = base.replace(/[/\\?%*:|"<>]/g, '_').trim();
    if (!base.toLowerCase().endsWith('.' + extension)) {
      base = base.replace(/\.(docx|pdf)$/i, '') + '.' + extension;
    }
    return base;
  },

  /**
   * Render a native .docx template buffer for a single row, preserving formatting and collecting diagnostics.
   */
  renderDocxFromBuffer(
    template: DocumentTemplate,
    docxBuffer: ArrayBuffer,
    row: Row,
    currentTab: Tab,
    allTabs: Tab[],
    tags: Tag[],
    entityProfile?: LegalEntityProfile,
    options?: { holidays?: string[]; todayIso?: string }
  ): {
    blob: Blob;
    previewText: string;
    fileName: string;
    issues: TemplateResolutionIssue[];
    unknownTags: string[];
    emptyRowTags: string[];
    emptyProfileTags: string[];
    docxDiagnostics: DocxRenderDiagnostic;
  } {
    const resolver = createRowTagResolver(row, currentTab, allTabs, tags, entityProfile, options);
    const docxRes = docxTemplateService.renderDocxTemplate(docxBuffer, (tagName) =>
      resolver.resolveTag(tagName)
    );

    // Also resolve namingPattern through the SAME resolver so namingPattern issues are captured cleanly
    const rawFileName = (template.namingPattern || 'Документ_{id}.docx').replace(
      PLACEHOLDER_REGEX,
      (fullMatch, inner) => {
        if (!String(inner).trim()) return fullMatch;
        const outcome = resolver.resolveTag(fullMatch);
        return outcome.known ? outcome.value : fullMatch;
      }
    );
    let safeFileName = rawFileName.replace(/[/\\?%*:|"<>]/g, '_').trim();
    if (!safeFileName.toLowerCase().endsWith('.docx')) {
      safeFileName = safeFileName.replace(/\.(docx|pdf)$/i, '') + '.docx';
    }

    const diag = resolver.getDiagnostics();
    return {
      blob: docxRes.blob,
      previewText: docxRes.previewText,
      fileName: safeFileName,
      issues: diag.issues,
      unknownTags: diag.unknownTags,
      emptyRowTags: diag.emptyRowTags,
      emptyProfileTags: diag.emptyProfileTags,
      docxDiagnostics: docxRes.diagnostics
    };
  },

  /**
   * Fault-isolated batch generator for both plain-text and native DOCX templates (T-36 + T-44).
   * Failure on any row never aborts the batch or loses successfully generated rows.
   */
  async executeBatchGeneration(options: {
    template: DocumentTemplate;
    format: 'docx' | 'pdf';
    rowsToProcess: Row[];
    boundTab: Tab;
    allTabs: Tab[];
    tags: Tag[];
    entityProfile?: LegalEntityProfile;
    docxSourceBuffer?: ArrayBuffer | null;
    failOnEmptyRowTags?: boolean;
    holidays?: string[];
    todayIso?: string;
    onSaveDocument: (payload: {
      row: Row;
      fileName: string;
      blob: Blob;
    }) => Promise<void> | void;
    delayBetweenRowsMs?: number;
  }): Promise<BatchGenerationReport> {
    const {
      template,
      format,
      rowsToProcess,
      boundTab,
      allTabs,
      tags,
      entityProfile,
      docxSourceBuffer,
      failOnEmptyRowTags = true,
      holidays,
      todayIso,
      onSaveDocument,
      delayBetweenRowsMs = 0
    } = options;

    const templateType: 'text' | 'docx' =
      template.templateType === 'docx' ? 'docx' : 'text';

    if (templateType === 'docx' && format === 'pdf') {
      throw new Error(
        'Формат PDF не поддерживается для готовых DOCX-шаблонов без локального Microsoft Word / LibreOffice. Используйте генерацию .DOCX.'
      );
    }

    if (templateType === 'docx' && (!docxSourceBuffer || docxSourceBuffer.byteLength === 0)) {
      throw new Error(
        `Не найден исходный DOCX-файл шаблона «${template.name}». Загрузите .docx повторно.`
      );
    }

    const rowIndexMap = new Map<string, number>();
    boundTab.rows.forEach((r, idx) => rowIndexMap.set(r.id, idx + 1));

    const items: BatchGenerationItemResult[] = [];

    for (let i = 0; i < rowsToProcess.length; i++) {
      const row = rowsToProcess[i];
      const rowNumber = rowIndexMap.get(row.id) ?? i + 1;
      const rowIdentifier = getRowDisplayIdentifier(row, boundTab, rowNumber);

      try {
        if (templateType === 'docx') {
          const res = documentGenerator.renderDocxFromBuffer(
            template,
            docxSourceBuffer!,
            row,
            boundTab,
            allTabs,
            tags,
            entityProfile,
            { holidays, todayIso }
          );

          const blockingReasons: string[] = [];
          const problematicTags = new Set<string>();

          if (res.issues.length > 0) {
            res.issues.forEach((iss) => {
              problematicTags.add(iss.tagName);
              blockingReasons.push(iss.reason);
            });
          }
          if (res.unknownTags.length > 0) {
            res.unknownTags.forEach((t) => problematicTags.add(t));
            blockingReasons.push(
              `Неизвестные теги в шаблоне (${res.unknownTags.join(', ')}): не привязаны к столбцу и не являются реквизитами организации.`
            );
          }
          if (failOnEmptyRowTags && res.emptyRowTags.length > 0) {
            res.emptyRowTags.forEach((t) => problematicTags.add(t));
            blockingReasons.push(
              `Отсутствует значение в записи для тега(ов): ${res.emptyRowTags.join(', ')}.`
            );
          }

          if (blockingReasons.length > 0) {
            items.push({
              status: 'error',
              rowId: row.id,
              rowNumber,
              rowIdentifier,
              tagNames: Array.from(problematicTags),
              reason: blockingReasons.join(' '),
              warnings: res.docxDiagnostics.unsupportedWarnings
            });
            continue;
          }

          await onSaveDocument({ row, fileName: res.fileName, blob: res.blob });
          items.push({
            status: 'success',
            rowId: row.id,
            rowNumber,
            rowIdentifier,
            fileName: res.fileName,
            tagNames: [],
            warnings: [
              ...res.docxDiagnostics.unsupportedWarnings,
              ...(res.emptyProfileTags.length > 0
                ? [`Пустые реквизиты организации: ${res.emptyProfileTags.join(', ')}`]
                : [])
            ]
          });
        } else {
          const resolver = createRowTagResolver(row, boundTab, allTabs, tags, entityProfile, {
            holidays,
            todayIso
          });
          const resolvedBody = template.contentTemplate.replace(
            PLACEHOLDER_REGEX,
            (fullMatch, inner) => {
              if (!String(inner).trim()) return fullMatch;
              const outcome = resolver.resolveTag(fullMatch);
              return outcome.known ? outcome.value : fullMatch;
            }
          );
          const rawFileName = (template.namingPattern || 'Документ_{id}.docx').replace(
            PLACEHOLDER_REGEX,
            (fullMatch, inner) => {
              if (!String(inner).trim()) return fullMatch;
              const outcome = resolver.resolveTag(fullMatch);
              return outcome.known ? outcome.value : fullMatch;
            }
          );
          let safeFileName = rawFileName.replace(/[/\\?%*:|"<>]/g, '_').trim();
          if (!safeFileName.toLowerCase().endsWith('.' + format)) {
            safeFileName = safeFileName.replace(/\.(docx|pdf)$/i, '') + '.' + format;
          }

          const diag = resolver.getDiagnostics();
          const blockingReasons: string[] = [];
          const problematicTags = new Set<string>();

          if (diag.issues.length > 0) {
            diag.issues.forEach((iss) => {
              problematicTags.add(iss.tagName);
              blockingReasons.push(iss.reason);
            });
          }
          if (diag.unknownTags.length > 0) {
            diag.unknownTags.forEach((t) => problematicTags.add(t));
            blockingReasons.push(
              `Неизвестные теги в шаблоне (${diag.unknownTags.join(', ')}): не привязаны к столбцу и не являются реквизитами организации.`
            );
          }
          if (failOnEmptyRowTags && diag.emptyRowTags.length > 0) {
            diag.emptyRowTags.forEach((t) => problematicTags.add(t));
            blockingReasons.push(
              `Отсутствует значение в записи для тега(ов): ${diag.emptyRowTags.join(', ')}.`
            );
          }

          if (blockingReasons.length > 0) {
            items.push({
              status: 'error',
              rowId: row.id,
              rowNumber,
              rowIdentifier,
              tagNames: Array.from(problematicTags),
              reason: blockingReasons.join(' '),
              warnings: []
            });
            continue;
          }

          const blob =
            format === 'docx'
              ? await documentGenerator.generateDocx(template.name, resolvedBody)
              : await documentGenerator.generatePdf(template.name, resolvedBody);

          await onSaveDocument({ row, fileName: safeFileName, blob });
          items.push({
            status: 'success',
            rowId: row.id,
            rowNumber,
            rowIdentifier,
            fileName: safeFileName,
            tagNames: [],
            warnings:
              diag.emptyProfileTags.length > 0
                ? [`Пустые реквизиты организации: ${diag.emptyProfileTags.join(', ')}`]
                : []
          });
        }
      } catch (err: any) {
        items.push({
          status: 'error',
          rowId: row.id,
          rowNumber,
          rowIdentifier,
          tagNames: [],
          reason: err?.message || 'Ошибка формирования или сохранения документа',
          warnings: []
        });
      }

      if (delayBetweenRowsMs > 0 && i < rowsToProcess.length - 1) {
        await new Promise((res) => setTimeout(res, delayBetweenRowsMs));
      }
    }

    const errors = items.filter((it) => it.status === 'error');
    const successes = items.filter((it) => it.status === 'success');

    return {
      templateId: template.id,
      templateName: template.name,
      templateType,
      format,
      createdAt: new Date().toISOString(),
      totalCount: rowsToProcess.length,
      successCount: successes.length,
      errorCount: errors.length,
      items,
      errors,
      successes
    };
  },

  /**
   * Generate native DOCX document from text content
   */
  async generateDocx(
    _title: string,
    resolvedText: string
  ): Promise<Blob> {
    // `docx` is ~300 kB and is needed only when a Word file is actually exported,
    // so it is loaded on demand instead of inflating the initial bundle.
    const {
      Document,
      Packer,
      Paragraph: DocxParagraph,
      TextRun,
      AlignmentType: DocxAlignment
    } = await import('docx');
    type DocxParagraphInstance = InstanceType<typeof DocxParagraph>;

    const lines = resolvedText.split('\n');
    const paragraphs: DocxParagraphInstance[] = [];

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        paragraphs.push(new DocxParagraph({ text: '', spacing: { after: 120 } }));
        return;
      }

      const isHeader = trimmed === trimmed.toUpperCase() && trimmed.length < 80 && !trimmed.includes('{');
      if (isHeader) {
        paragraphs.push(
          new DocxParagraph({
            children: [
              new TextRun({
                text: trimmed,
                bold: true,
                size: 24,
                font: 'Times New Roman'
              })
            ],
            alignment: DocxAlignment.CENTER,
            spacing: { before: 200, after: 120 }
          })
        );
      } else {
        paragraphs.push(
          new DocxParagraph({
            children: [
              new TextRun({
                text: line,
                size: 22,
                font: 'Times New Roman'
              })
            ],
            spacing: { after: 80 }
          })
        );
      }
    });

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1134,
                right: 850,
                bottom: 1134,
                left: 1700
              }
            }
          },
          children: paragraphs
        }
      ]
    });

    return await Packer.toBlob(doc);
  },

  /**
   * Generate native PDF document with embedded Cyrillic font (DejaVuSans)
   */
  async generatePdf(
    _title: string,
    resolvedText: string
  ): Promise<Blob> {
    // jsPDF + the embedded DejaVu fonts (~2.1 MB of base64) are only needed for PDF
    // export, so they stay out of the initial bundle and load on first PDF generation.
    const [jspdfModule, fonts] = await Promise.all([
      import('jspdf'),
      import('../data/cyrillicFont')
    ]);
    const JsPDF = jspdfModule.jsPDF ?? jspdfModule.default;

    const doc = new JsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    registerCyrillicFonts(doc, fonts.DEJAVU_SANS_REGULAR_B64, fonts.DEJAVU_SANS_BOLD_B64);
    doc.setFont('DejaVuSans', 'normal');
    doc.setFontSize(10);

    const marginX = 20;
    const marginY = 20;
    const pageWidth = 210;
    const maxLineWidth = pageWidth - marginX * 2;
    const pageHeight = 297;
    let cursorY = marginY;

    const lines = resolvedText.split('\n');

    for (const rawLine of lines) {
      if (cursorY > pageHeight - 20) {
        doc.addPage();
        cursorY = marginY;
      }

      if (!rawLine.trim()) {
        cursorY += 4;
        continue;
      }

      const isTitle = rawLine.trim() === rawLine.trim().toUpperCase() && rawLine.trim().length < 70;
      if (isTitle) {
        doc.setFont('DejaVuSans', 'bold');
        doc.setFontSize(10.5);
      } else {
        doc.setFont('DejaVuSans', 'normal');
        doc.setFontSize(9.5);
      }

      const wrapped = doc.splitTextToSize(rawLine, maxLineWidth);
      wrapped.forEach((wLine: string) => {
        if (cursorY > pageHeight - 20) {
          doc.addPage();
          cursorY = marginY;
        }
        doc.text(wLine, marginX, cursorY);
        cursorY += 5;
      });
    }

    return doc.output('blob');
  },

  /**
   * Convert Blob to base64 data URI payload (capped safely for browser fallback)
   */
  async blobToBase64(blob: Blob): Promise<string> {
    if (typeof FileReader !== 'undefined') {
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = typeof reader.result === 'string' ? reader.result : '';
          const commaIdx = res.indexOf(',');
          resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
        };
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      });
    }
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  },

  /**
   * Download a generated Blob and optionally mirror to ./documents/<relativePath> in native EXE mode
   */
  async saveAndDownloadBlob(
    blob: Blob,
    filename: string,
    saveToDisk = true,
    diskRelativePath?: string
  ): Promise<{ savedToDisk: boolean }> {
    let savedToDisk = false;
    if (saveToDisk && localApiClient.isNative()) {
      const targetPath = diskRelativePath || filename;
      const res = await localApiClient.saveFileToBucket('documents', targetPath, blob);
      savedToDisk = res.ok;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { savedToDisk };
  },

  downloadBlob(blob: Blob, filename: string): void {
    void documentGenerator.saveAndDownloadBlob(blob, filename, true);
  }
};
