import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import jsPDF from 'jspdf';
import { DocumentTemplate, LegalEntityProfile, Row, Tab, Tag } from '../types/database';
import { DEJAVU_SANS_BOLD_B64, DEJAVU_SANS_REGULAR_B64 } from '../data/cyrillicFont';
import { localApiClient } from './localApiClient';

export interface GeneratedDocumentResult {
  fileName: string;
  docxBlob: Blob;
  pdfBlob: Blob;
  textPreview: string;
}

function registerCyrillicFonts(doc: jsPDF): void {
  doc.addFileToVFS('DejaVuSans.ttf', DEJAVU_SANS_REGULAR_B64);
  doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', DEJAVU_SANS_BOLD_B64);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
}

export interface TemplateResolutionIssue {
  type: 'ambiguous' | 'not_found' | 'no_relations';
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

export type MasterRowMatchResult =
  | { status: 'no_relations' }
  | { status: 'no_filled_values' }
  | { status: 'matched'; row: Row }
  | { status: 'ambiguous'; matches: Row[]; matchedColumns: string[] }
  | { status: 'not_found'; matchedColumns: string[] };

function normalizeLookupValue(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
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

export const documentGenerator = {
  /**
   * Resolve tags in a template string for a specific row and return both rendered text
   * and any ambiguity / broken-relation issues encountered during Master lookup.
   */
  resolveTemplateTagsWithReport(
    templateContent: string,
    row: Row,
    currentTab: Tab,
    allTabs: Tab[],
    tags: Tag[],
    entityProfile?: LegalEntityProfile
  ): TemplateResolutionResult {
    let resolved = templateContent;
    const issues: TemplateResolutionIssue[] = [];
    const lookupCache = new Map<string, MasterRowMatchResult>();

    // 1. Resolve tags configured in the entity tag pool (only tags actually present in templateContent)
    tags.forEach((tag) => {
      if (!resolved.includes(tag.name)) return;

      let value = '';
      if (tag.tabId === currentTab.id) {
        value = row[tag.columnId] !== undefined ? String(row[tag.columnId]) : '';
      } else {
        const otherTab = allTabs.find((t) => t.id === tag.tabId);
        if (otherTab) {
          let matchResult = lookupCache.get(otherTab.id);
          if (!matchResult) {
            matchResult = resolveMasterRowMatch(row, currentTab, otherTab);
            lookupCache.set(otherTab.id, matchResult);
          }

          if (matchResult.status === 'matched') {
            if (matchResult.row[tag.columnId] !== undefined) {
              value = String(matchResult.row[tag.columnId]);
            }
          } else if (matchResult.status === 'ambiguous') {
            issues.push({
              type: 'ambiguous',
              tagName: tag.name,
              masterTabId: otherTab.id,
              masterTabName: otherTab.name,
              matchCount: matchResult.matches.length,
              reason: `Для тега ${tag.name} найдено ${matchResult.matches.length} совпадений в таблице «${otherTab.name}» по полям (${matchResult.matchedColumns.join(', ')}). Произвольный выбор запрещён.`
            });
          } else if (matchResult.status === 'not_found') {
            issues.push({
              type: 'not_found',
              tagName: tag.name,
              masterTabId: otherTab.id,
              masterTabName: otherTab.name,
              matchCount: 0,
              reason: `Для тега ${tag.name} не найдена строка в «${otherTab.name}» с полным совпадением полей (${matchResult.matchedColumns.join(', ')}).`
            });
          } else if (matchResult.status === 'no_relations') {
            issues.push({
              type: 'no_relations',
              tagName: tag.name,
              masterTabId: otherTab.id,
              masterTabName: otherTab.name,
              matchCount: 0,
              reason: `Тег ${tag.name} ссылается на «${otherTab.name}», но текущая таблица «${currentTab.name}» не имеет с ней связующих столбцов.`
            });
          }
        }
      }

      resolved = resolved.replaceAll(tag.name, value);
    });

    // 2. Resolve directly by current tab column names: e.g. {Должность}, {ФИО работника}
    currentTab.columns.forEach((col) => {
      const val = row[col.id] !== undefined ? String(row[col.id]) : '';
      const colTag1 = `{${col.name}}`;
      const colTag2 = `{${col.name.replace(/\s+/g, '_')}}`;
      resolved = resolved.replaceAll(colTag1, val).replaceAll(colTag2, val);
    });

    // 3. Resolve Legal Entity requisites if provided
    if (entityProfile) {
      resolved = resolved
        .replaceAll('{Организация}', entityProfile.shortName || entityProfile.fullName || '')
        .replaceAll('{Организация_полное}', entityProfile.fullName || entityProfile.shortName || '')
        .replaceAll('{ИНН}', entityProfile.inn || '')
        .replaceAll('{КПП}', entityProfile.kpp || '')
        .replaceAll('{ОГРН}', entityProfile.ogrn || '')
        .replaceAll('{ОКПО}', entityProfile.okpo || '')
        .replaceAll('{ОКВЭД}', entityProfile.okved || '')
        .replaceAll('{Реквизиты_банка}', entityProfile.bankDetails || '')
        .replaceAll('{Банк_в}', entityProfile.bankIn || '')
        .replaceAll('{Юридический_адрес}', entityProfile.legalAddress || '')
        .replaceAll('{Email_организации}', entityProfile.email || '')
        .replaceAll('{Телефон_организации}', entityProfile.phone || '')
        .replaceAll('{Генеральный_директор}', entityProfile.directorFio || '');
    }

    // 4. Built-in id tag
    resolved = resolved.replaceAll('{id}', row.id || '1');

    return { text: resolved, issues };
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
    entityProfile?: LegalEntityProfile
  ): string {
    return documentGenerator.resolveTemplateTagsWithReport(
      templateContent,
      row,
      currentTab,
      allTabs,
      tags,
      entityProfile
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
    entityProfile?: LegalEntityProfile
  ): string {
    let base = pattern || 'Документ_{id}.docx';
    base = documentGenerator.resolveTemplateTags(base, row, currentTab, allTabs, tags, entityProfile);
    base = base.replace(/[/\\?%*:|"<>]/g, '_').trim();
    if (!base.toLowerCase().endsWith('.' + extension)) {
      base = base.replace(/\.(docx|pdf)$/i, '') + '.' + extension;
    }
    return base;
  },

  /**
   * Generate native DOCX document from text content
   */
  async generateDocx(
    _title: string,
    resolvedText: string
  ): Promise<Blob> {
    const lines = resolvedText.split('\n');
    const paragraphs: Paragraph[] = [];

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        paragraphs.push(new Paragraph({ text: '', spacing: { after: 120 } }));
        return;
      }

      const isHeader = trimmed === trimmed.toUpperCase() && trimmed.length < 80 && !trimmed.includes('{');
      if (isHeader) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: trimmed,
                bold: true,
                size: 24,
                font: 'Times New Roman'
              })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 120 }
          })
        );
      } else {
        paragraphs.push(
          new Paragraph({
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
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    registerCyrillicFonts(doc);
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
