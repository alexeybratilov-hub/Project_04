import { describe, it, expect } from 'vitest';
import {
  archiveExistingDocManually,
  formatDateDdMmYyyy,
  inferDocumentCategory,
  registerGeneratedDocument
} from '../generatedDocsService';
import { sanitizeRelativeSubpath } from '../localApiClient';

describe('generatedDocsService and archive rotation', () => {
  it('formats dates strictly as дд.мм.гггг', () => {
    expect(formatDateDdMmYyyy('2026-03-07T10:15:00Z')).toBe('07.03.2026');
    expect(formatDateDdMmYyyy(new Date(2026, 10, 12))).toBe('12.11.2026');
  });

  it('infers document category from template title and tab name', () => {
    expect(inferDocumentCategory('Приказ о назначении ответственных')).toBe('Приказы');
    expect(inferDocumentCategory('Инструкция по охране труда (ИОТ)')).toBe('Инструкции по ОТ');
    expect(inferDocumentCategory('Направление на медосмотр', 'Медосмотры')).toBe('Медосмотры и МО');
    expect(inferDocumentCategory('Личная карточка выдачи СИЗ')).toBe('Выдача СИЗ');
    expect(inferDocumentCategory('Акт о микротравме')).toBe('Акты и расследования');
  });

  it('automatically moves existing active file with matching name in the same category into АРХИВ/<дд.мм.гггг>/', () => {
    const first = registerGeneratedDocument([], {
      id: 'g1',
      title: 'Приказ о назначении ответственных',
      fileName: 'Приказ_Иванов.docx',
      category: 'Приказы',
      format: 'docx',
      createdAt: '2026-10-05T12:00:00.000Z',
      sizeFormatted: '14.2 КБ'
    });

    expect(first.archivedTransitions).toHaveLength(0);
    expect(first.newRecord.relativePath).toBe('Приказы/Приказ_Иванов.docx');
    expect(first.newRecord.dateFormatted).toBe('05.10.2026');

    const second = registerGeneratedDocument(first.nextDocs, {
      id: 'g2',
      title: 'Приказ о назначении ответственных',
      fileName: 'Приказ_Иванов.docx',
      category: 'Приказы',
      format: 'docx',
      createdAt: '2026-11-13T12:00:00.000Z',
      sizeFormatted: '15.0 КБ'
    });

    expect(second.archivedTransitions).toHaveLength(1);
    expect(second.archivedTransitions[0].fromPath).toBe('Приказы/Приказ_Иванов.docx');
    expect(second.archivedTransitions[0].toPath).toBe('Приказы/АРХИВ/05.10.2026/Приказ_Иванов.docx');

    const active = second.nextDocs.filter((d) => !d.isArchived);
    const archived = second.nextDocs.filter((d) => d.isArchived);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('g2');
    expect(archived).toHaveLength(1);
    expect(archived[0].archiveDateFolder).toBe('05.10.2026');
  });

  it('prevents filename overwrite inside АРХИВ/<дд.мм.гггг>/ when regenerated multiple times on the same day', () => {
    const r1 = registerGeneratedDocument([], {
      id: 'd1',
      title: 'ИОТ-01',
      fileName: 'ИОТ_Слесарь.pdf',
      category: 'Инструкции по ОТ',
      format: 'pdf',
      createdAt: '2026-11-13T09:00:00.000Z',
      sizeFormatted: '42.0 КБ'
    });

    const r2 = registerGeneratedDocument(r1.nextDocs, {
      id: 'd2',
      title: 'ИОТ-01',
      fileName: 'ИОТ_Слесарь.pdf',
      category: 'Инструкции по ОТ',
      format: 'pdf',
      createdAt: '2026-11-13T10:00:00.000Z',
      sizeFormatted: '43.0 КБ'
    });

    const r3 = registerGeneratedDocument(r2.nextDocs, {
      id: 'd3',
      title: 'ИОТ-01',
      fileName: 'ИОТ_Слесарь.pdf',
      category: 'Инструкции по ОТ',
      format: 'pdf',
      createdAt: '2026-11-13T11:00:00.000Z',
      sizeFormatted: '44.0 КБ'
    });

    const archivedPaths = r3.nextDocs
      .filter((d) => d.isArchived)
      .map((d) => d.relativePath);
    expect(archivedPaths).toContain('Инструкции по ОТ/АРХИВ/13.11.2026/ИОТ_Слесарь.pdf');
    expect(archivedPaths).toContain('Инструкции по ОТ/АРХИВ/13.11.2026/ИОТ_Слесарь_v2.pdf');
  });

  it('archives manually and sanitizes relative document subpaths against traversal', () => {
    const r1 = registerGeneratedDocument([], {
      id: 'm1',
      title: 'Направление МО',
      fileName: 'МО_Петров.pdf',
      category: 'Медосмотры и МО',
      format: 'pdf',
      createdAt: '2026-11-12T10:00:00.000Z',
      sizeFormatted: '21.0 КБ'
    });

    const manual = archiveExistingDocManually(r1.nextDocs, 'm1');
    expect(manual.transition?.toPath).toBe('Медосмотры и МО/АРХИВ/12.11.2026/МО_Петров.pdf');
    expect(manual.nextDocs[0].isArchived).toBe(true);

    expect(sanitizeRelativeSubpath('../../Приказы\\АРХИВ/13.11.2026/Файл:1.docx')).toBe(
      'Приказы/АРХИВ/13.11.2026/Файл_1.docx'
    );
  });
});
