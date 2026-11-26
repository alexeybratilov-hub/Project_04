import { strToU8, zipSync } from 'fflate';

export interface ZipEntryInput {
  name: string;
  data: Uint8Array | Blob | ArrayBuffer | string;
}

/**
 * Sanitizes an archive entry path while preserving folder structure (`/`),
 * stripping path traversal segments (`..`) and Windows-forbidden filename characters.
 */
export function sanitizeArchiveEntryPath(rawPath: string): string {
  const segments = String(rawPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg !== '' && seg !== '.' && seg !== '..')
    .map((seg) => seg.replace(/[:*?"<>|\x00-\x1f]/g, '_').replace(/\.+$/, '').trim())
    .filter(Boolean);

  return segments.length > 0 ? segments.join('/') : 'document.bin';
}

export function ensureUniqueArchivePath(candidatePath: string, usedPaths: Set<string>): string {
  const normalized = sanitizeArchiveEntryPath(candidatePath);
  if (!usedPaths.has(normalized)) {
    usedPaths.add(normalized);
    return normalized;
  }

  const slashIdx = normalized.lastIndexOf('/');
  const dir = slashIdx >= 0 ? normalized.slice(0, slashIdx + 1) : '';
  const file = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;
  const dotIdx = file.lastIndexOf('.');
  const stem = dotIdx > 0 ? file.slice(0, dotIdx) : file;
  const ext = dotIdx > 0 ? file.slice(dotIdx) : '';

  let counter = 2;
  let next = `${dir}${stem} (${counter})${ext}`;
  while (usedPaths.has(next)) {
    counter += 1;
    next = `${dir}${stem} (${counter})${ext}`;
  }
  usedPaths.add(next);
  return next;
}

async function toUint8Array(data: ZipEntryInput['data']): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === 'string') return strToU8(data);
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Packages multiple files into a single ZIP archive Blob using fflate.
 */
export async function packageFilesAsZip(entries: ZipEntryInput[]): Promise<Blob> {
  if (entries.length === 0) {
    throw new Error('Нет файлов для упаковки в ZIP-архив.');
  }

  const usedPaths = new Set<string>();
  const archiveMap: Record<string, Uint8Array> = {};

  for (const entry of entries) {
    const safePath = ensureUniqueArchivePath(entry.name, usedPaths);
    archiveMap[safePath] = await toUint8Array(entry.data);
  }

  const zipped = zipSync(archiveMap, { level: 6 });
  return new Blob([new Uint8Array(zipped)], { type: 'application/zip' });
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}
