import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType } from 'docx';
import jsPDF from 'jspdf';
import { DocumentTemplate, LegalEntityProfile, Row, Tab, Tag } from '../types/database';

export interface GeneratedDocumentResult {
  fileName: string;
  docxBlob: Blob;
  pdfBlob: Blob;
  textPreview: string;
}

export const documentGenerator = {
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
    let resolved = templateContent;

    // 1. Resolve tags configured in the tag pool
    tags.forEach((tag) => {
      let value = '';
      if (tag.tabId === currentTab.id) {
        value = row[tag.columnId] !== undefined ? String(row[tag.columnId]) : '';
      } else {
        // If tag belongs to another tab, try to find a relation or lookup
        const otherTab = allTabs.find((t) => t.id === tag.tabId);
        if (otherTab) {
          // Look if current tab has a related column that matches otherTab
          const relCol = currentTab.columns.find((c) => c.relation?.masterTabId === otherTab.id);
          if (relCol && row[relCol.id]) {
            const masterRow = otherTab.rows.find((mr) => mr[relCol.relation!.masterColumnId] === row[relCol.id]);
            if (masterRow && masterRow[tag.columnId] !== undefined) {
              value = String(masterRow[tag.columnId]);
            }
          }
        }
      }

      // Replace both exact tag name and variations
      const escapedTag = tag.name.replace(/[{}]/g, '\\$&');
      const regex = new RegExp(escapedTag, 'g');
      resolved = resolved.replace(regex, value);
    });

    // 2. Also resolve directly by column names: e.g. {Должность}, {ФИО работника}
    currentTab.columns.forEach((col) => {
      const val = row[col.id] !== undefined ? String(row[col.id]) : '';
      const colTag1 = `{${col.name}}`;
      const colTag2 = `{${col.name.replace(/\s+/g, '_')}}`;
      resolved = resolved.replaceAll(colTag1, val).replaceAll(colTag2, val);
    });

    // 3. Resolve Legal Entity requisites if provided
    if (entityProfile) {
      resolved = resolved
        .replaceAll('{Организация}', entityProfile.shortName || entityProfile.fullName)
        .replaceAll('{Организация_полное}', entityProfile.fullName || entityProfile.shortName)
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

    return resolved;
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
    // Sanitize filename
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
    title: string,
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

      // Detect header style
      const isHeader = trimmed === trimmed.toUpperCase() && trimmed.length < 80 && !trimmed.includes('{');
      if (isHeader) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: trimmed,
                bold: true,
                size: 24, // 12pt
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
                size: 22, // 11pt
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
                top: 1134, // ~2cm
                right: 850, // ~1.5cm
                bottom: 1134,
                left: 1700 // ~3cm for archival binding
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
   * Generate native PDF document from text content
   */
  async generatePdf(
    title: string,
    resolvedText: string
  ): Promise<Blob> {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Simple UTF-8 text flow
    doc.setFont('helvetica', 'normal');
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

      // Check if title
      const isTitle = rawLine === rawLine.toUpperCase() && rawLine.length < 60;
      if (isTitle) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
      } else {
        doc.setFont('helvetica', 'normal');
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
   * Download a generated Blob
   */
  downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
