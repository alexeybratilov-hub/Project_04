import { describe, expect, it } from 'vitest';
import {
  extractFileExtension,
  FileValidationRule,
  hasFilesInDataTransfer,
  validateAcceptedFile
} from '../ui/useFileDropZone';

const EXCEL_RULE: FileValidationRule = {
  allowedExtensions: ['.xlsx', '.xlsm', '.csv'],
  allowedMimeTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroenabled.12',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv',
    'text/plain',
    'application/zip'
  ],
  formatLabel: '.xlsx, .xlsm или .csv'
};

const NORMATIVE_RULE: FileValidationRule = {
  allowedExtensions: ['.docx', '.pdf', '.txt', '.doc', '.md'],
  allowedMimeTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'application/zip'
  ],
  formatLabel: '.docx, .doc, .pdf, .txt или .md'
};

const BACKUP_RULE: FileValidationRule = {
  allowedExtensions: ['.json'],
  allowedMimeTypes: ['application/json', 'text/json', 'text/plain', 'application/ld+json'],
  formatLabel: '.json'
};

describe('useFileDropZone helpers (T-39)', () => {
  it('extracts normalized lowercase extensions safely', () => {
    expect(extractFileExtension('report.XLSX')).toBe('.xlsx');
    expect(extractFileExtension('archive.backup.json ')).toBe('.json');
    expect(extractFileExtension('noext')).toBe('');
    expect(extractFileExtension('.hidden')).toBe('');
    expect(extractFileExtension('trailing.')).toBe('');
  });

  it('detects file drags vs internal TabBar text/plain drags', () => {
    expect(hasFilesInDataTransfer(null)).toBe(false);
    expect(hasFilesInDataTransfer(undefined)).toBe(false);
    expect(
      hasFilesInDataTransfer({
        types: ['text/plain'],
        files: [] as unknown as FileList
      })
    ).toBe(false);
    expect(
      hasFilesInDataTransfer({
        types: ['Files'],
        files: [] as unknown as FileList
      })
    ).toBe(true);
    expect(
      hasFilesInDataTransfer({
        types: [],
        files: [{ name: 'test.json' }] as unknown as FileList
      })
    ).toBe(true);
  });

  it('validates Excel/CSV imports and rejects unsupported extensions, spoofed MIME, or empty files', () => {
    expect(
      validateAcceptedFile(
        {
          name: 'staff.xlsx',
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: 1024
        },
        EXCEL_RULE
      )
    ).toEqual({ ok: true });

    // Windows browsers often leave .xlsm or .csv MIME empty or text/plain
    expect(
      validateAcceptedFile({ name: 'macro.xlsm', type: '', size: 2048 }, EXCEL_RULE)
    ).toEqual({ ok: true });
    expect(
      validateAcceptedFile({ name: 'list.csv', type: 'text/plain; charset=utf-8', size: 120 }, EXCEL_RULE)
    ).toEqual({ ok: true });

    const wrongExt = validateAcceptedFile(
      { name: 'image.png', type: 'image/png', size: 500 },
      EXCEL_RULE
    );
    expect(wrongExt.ok).toBe(false);
    if (!wrongExt.ok) {
      expect(wrongExt.error).toContain('Неподдерживаемый формат файла');
      expect(wrongExt.error).toContain('.xlsx, .xlsm или .csv');
    }

    const spoofedMime = validateAcceptedFile(
      { name: 'fake.xlsx', type: 'image/jpeg', size: 500 },
      EXCEL_RULE
    );
    expect(spoofedMime.ok).toBe(false);

    const emptyFile = validateAcceptedFile(
      { name: 'empty.csv', type: 'text/csv', size: 0 },
      EXCEL_RULE
    );
    expect(emptyFile.ok).toBe(false);
  });

  it('validates Normative document formats and rejects non-document files', () => {
    expect(
      validateAcceptedFile({ name: 'prikaz.pdf', type: 'application/pdf', size: 4096 }, NORMATIVE_RULE)
    ).toEqual({ ok: true });
    expect(
      validateAcceptedFile({ name: 'instrukciya.docx', type: '', size: 4096 }, NORMATIVE_RULE)
    ).toEqual({ ok: true });
    expect(
      validateAcceptedFile({ name: 'notes.md', type: 'text/markdown', size: 256 }, NORMATIVE_RULE)
    ).toEqual({ ok: true });

    const exeReject = validateAcceptedFile(
      { name: 'setup.exe', type: 'application/x-msdownload', size: 1024 },
      NORMATIVE_RULE
    );
    expect(exeReject.ok).toBe(false);
  });

  it('validates Backup JSON files and rejects spreadsheets/archives', () => {
    expect(
      validateAcceptedFile({ name: 'OT_Base_Backup.json', type: 'application/json', size: 2048 }, BACKUP_RULE)
    ).toEqual({ ok: true });
    expect(
      validateAcceptedFile({ name: 'backup.json', type: '', size: 2048 }, BACKUP_RULE)
    ).toEqual({ ok: true });

    expect(
      validateAcceptedFile({ name: 'backup.zip', type: 'application/zip', size: 2048 }, BACKUP_RULE).ok
    ).toBe(false);
    expect(
      validateAcceptedFile({ name: 'backup.json', type: 'image/png', size: 2048 }, BACKUP_RULE).ok
    ).toBe(false);
  });
});
