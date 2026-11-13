import { GeneratedDocRecord } from '../types/database';
import { sanitizeSafeFilename } from './localApiClient';

export const DOCUMENT_CATEGORIES = [
  'Инструкции по ОТ',
  'Приказы',
  'Медосмотры и МО',
  'Выдача СИЗ',
  'Инструктажи и протоколы',
  'Акты и расследования',
  'Прочие документы'
] as const;

export function formatDateDdMmYyyy(input: Date | string = new Date()): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  const target = Number.isNaN(d.getTime()) ? new Date() : d;
  const day = String(target.getDate()).padStart(2, '0');
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const year = target.getFullYear();
  return `${day}.${month}.${year}`;
}

export function formatBytesReadable(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 КБ';
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(2)} МБ`;
}

export function inferDocumentCategory(docTitleOrTemplate: string, sourceTabName?: string): string {
  const haystack = `${docTitleOrTemplate || ''} ${sourceTabName || ''}`.toLowerCase();
  if (haystack.includes('приказ')) return 'Приказы';
  if (haystack.includes('инструкц') || haystack.includes('иот')) return 'Инструкции по ОТ';
  if (haystack.includes('медосмотр') || haystack.includes('направлен') || haystack.includes(' мо')) {
    return 'Медосмотры и МО';
  }
  if (haystack.includes('сиз') || haystack.includes('защит')) return 'Выдача СИЗ';
  if (haystack.includes('акт') || haystack.includes('микротравм') || haystack.includes('несчаст')) {
    return 'Акты и расследования';
  }
  if (haystack.includes('инструктаж') || haystack.includes('протокол') || haystack.includes('суот')) {
    return 'Инструктажи и протоколы';
  }
  return 'Прочие документы';
}

export function buildActiveRelativePath(category: string, fileName: string): string {
  const safeCategory = sanitizeSafeFilename(category || 'Прочие документы');
  const safeFile = sanitizeSafeFilename(fileName);
  return `${safeCategory}/${safeFile}`;
}

export function buildArchiveRelativePath(
  category: string,
  dateFolder: string,
  fileName: string
): string {
  const safeCategory = sanitizeSafeFilename(category || 'Прочие документы');
  const safeDate = sanitizeSafeFilename(dateFolder);
  const safeFile = sanitizeSafeFilename(fileName);
  return `${safeCategory}/АРХИВ/${safeDate}/${safeFile}`;
}

/**
 * Ensures uniqueness when archiving multiple documents with the exact same name on the exact same day.
 */
function makeUniqueArchiveFileName(
  desiredFileName: string,
  category: string,
  dateFolder: string,
  occupiedPaths: Set<string>
): string {
  const baseCandidate = buildArchiveRelativePath(category, dateFolder, desiredFileName);
  if (!occupiedPaths.has(baseCandidate.toLowerCase())) {
    return desiredFileName;
  }

  const dotIdx = desiredFileName.lastIndexOf('.');
  const stem = dotIdx > 0 ? desiredFileName.slice(0, dotIdx) : desiredFileName;
  const ext = dotIdx > 0 ? desiredFileName.slice(dotIdx) : '';

  let counter = 2;
  while (counter < 1000) {
    const candidateName = `${stem}_v${counter}${ext}`;
    const candidatePath = buildArchiveRelativePath(category, dateFolder, candidateName);
    if (!occupiedPaths.has(candidatePath.toLowerCase())) {
      return candidateName;
    }
    counter += 1;
  }
  return `${stem}_${Date.now()}${ext}`;
}

export interface ArchiveTransition {
  fromPath: string;
  toPath: string;
  archivedRecord: GeneratedDocRecord;
}

export interface RegisterGeneratedDocInput {
  id: string;
  title: string;
  fileName: string;
  category: string;
  format: 'docx' | 'pdf';
  createdAt?: string;
  sourceTabName?: string;
  rowIdentifier?: string;
  sizeFormatted: string;
  dataBase64?: string;
}

/**
 * Registers a newly generated document into its category and automatically moves
 * any existing active (non-archived) document(s) with the same fileName inside that
 * category into "<Category>/АРХИВ/<dd.mm.yyyy>/" using each old document's generation date.
 */
export function registerGeneratedDocument(
  existingDocs: GeneratedDocRecord[],
  input: RegisterGeneratedDocInput
): {
  newRecord: GeneratedDocRecord;
  nextDocs: GeneratedDocRecord[];
  archivedTransitions: ArchiveTransition[];
} {
  const nowIso = input.createdAt || new Date().toISOString();
  const safeCategory = sanitizeSafeFilename(input.category || 'Прочие документы');
  const safeFileName = sanitizeSafeFilename(input.fileName);
  const newDateFormatted = formatDateDdMmYyyy(nowIso);
  const newActivePath = buildActiveRelativePath(safeCategory, safeFileName);

  const occupiedPaths = new Set<string>(
    existingDocs.map((d) => d.relativePath.toLowerCase())
  );

  const archivedTransitions: ArchiveTransition[] = [];

  const updatedExisting = existingDocs.map((doc) => {
    const isSameCategory =
      doc.category.trim().toLowerCase() === safeCategory.trim().toLowerCase();
    const isSameName =
      doc.fileName.trim().toLowerCase() === safeFileName.trim().toLowerCase();

    if (!doc.isArchived && isSameCategory && isSameName) {
      const archiveFolder = doc.dateFormatted || formatDateDdMmYyyy(doc.createdAt);
      const uniqueArchiveFileName = makeUniqueArchiveFileName(
        doc.fileName,
        safeCategory,
        archiveFolder,
        occupiedPaths
      );
      const targetArchivePath = buildArchiveRelativePath(
        safeCategory,
        archiveFolder,
        uniqueArchiveFileName
      );

      occupiedPaths.delete(doc.relativePath.toLowerCase());
      occupiedPaths.add(targetArchivePath.toLowerCase());

      const archivedRecord: GeneratedDocRecord = {
        ...doc,
        isArchived: true,
        archivedAt: nowIso,
        archiveDateFolder: archiveFolder,
        fileName: uniqueArchiveFileName,
        relativePath: targetArchivePath
      };

      archivedTransitions.push({
        fromPath: doc.relativePath,
        toPath: targetArchivePath,
        archivedRecord
      });

      return archivedRecord;
    }

    return doc;
  });

  const newRecord: GeneratedDocRecord = {
    id: input.id,
    title: input.title,
    fileName: safeFileName,
    category: safeCategory,
    format: input.format,
    createdAt: nowIso,
    dateFormatted: newDateFormatted,
    relativePath: newActivePath,
    isArchived: false,
    sourceTabName: input.sourceTabName,
    rowIdentifier: input.rowIdentifier,
    sizeFormatted: input.sizeFormatted,
    dataBase64: input.dataBase64
  };

  return {
    newRecord,
    nextDocs: [newRecord, ...updatedExisting],
    archivedTransitions
  };
}

export function archiveExistingDocManually(
  existingDocs: GeneratedDocRecord[],
  docId: string
): {
  nextDocs: GeneratedDocRecord[];
  transition?: ArchiveTransition;
} {
  const occupiedPaths = new Set<string>(
    existingDocs.map((d) => d.relativePath.toLowerCase())
  );
  let transition: ArchiveTransition | undefined;

  const nextDocs = existingDocs.map((doc) => {
    if (doc.id !== docId || doc.isArchived) return doc;
    const archiveFolder = doc.dateFormatted || formatDateDdMmYyyy(doc.createdAt);
    const uniqueArchiveFileName = makeUniqueArchiveFileName(
      doc.fileName,
      doc.category,
      archiveFolder,
      occupiedPaths
    );
    const targetArchivePath = buildArchiveRelativePath(
      doc.category,
      archiveFolder,
      uniqueArchiveFileName
    );
    occupiedPaths.add(targetArchivePath.toLowerCase());

    const archivedRecord: GeneratedDocRecord = {
      ...doc,
      isArchived: true,
      archivedAt: new Date().toISOString(),
      archiveDateFolder: archiveFolder,
      fileName: uniqueArchiveFileName,
      relativePath: targetArchivePath
    };
    transition = {
      fromPath: doc.relativePath,
      toPath: targetArchivePath,
      archivedRecord
    };
    return archivedRecord;
  });

  return { nextDocs, transition };
}
