import { DatabaseState } from '../types/database';

export type StorageMode = 'native-fs' | 'web-preview';

export interface NativeHealthResponse {
  ok: boolean;
  mode: 'native-fs';
  revision: number;
  restoredFromBackup?: boolean;
  corruptedWarning?: boolean;
  storage?: string;
  usbDisconnected?: boolean;
  error?: string;
  message?: string;
}

export interface SaveDatabaseResult {
  ok: boolean;
  revision?: number;
  errorCode?: string;
  message?: string;
  usbDisconnected?: boolean;
  isConflict?: boolean;
}

let inMemoryToken: string | null = null;
let currentRevision = 0;

/**
 * Extract one-time session token from URL fragment (#token=...) injected by OT-Baza.exe
 * and strip it immediately from browser history bar.
 */
export function initNativeSessionFromLocation(): string | null {
  if (typeof window === 'undefined') return null;

  if (inMemoryToken) return inMemoryToken;

  const hash = window.location.hash || '';
  const match = hash.match(/token=([a-f0-9]{16,64})/i);
  if (match && match[1]) {
    inMemoryToken = match[1];
    try {
      const cleanUrl = window.location.pathname + window.location.search;
      window.history.replaceState(null, '', cleanUrl || '/');
    } catch {
      // Ignore in restricted history contexts
    }
    return inMemoryToken;
  }

  return null;
}

export function isNativeServerMode(): boolean {
  if (typeof window === 'undefined') return false;
  const token = initNativeSessionFromLocation();
  if (!token) return false;
  const host = window.location.hostname;
  return host === '127.0.0.1' || host === 'localhost';
}

export function getCurrentRevision(): number {
  return currentRevision;
}

export function setCurrentRevision(rev: number): void {
  if (Number.isFinite(rev) && rev >= 0) {
    currentRevision = rev;
  }
}

export function sanitizeSafeFilename(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\.\.+/g, '.')
    .trim();
  const safe = cleaned || `file_${Date.now()}`;
  return safe.slice(0, 180);
}

export function sanitizeRelativeSubpath(relPath: string): string {
  const segments = String(relPath || '')
    .split(/[/\\]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '.' && s !== '..')
    .map((s) => sanitizeSafeFilename(s));
  return segments.length > 0 ? segments.join('/') : `file_${Date.now()}`;
}

function encodeSubpathForUrl(subpath: string): string {
  return subpath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  if (inMemoryToken) {
    headers['X-OT-Token'] = inMemoryToken;
  }
  return headers;
}

export const localApiClient = {
  isNative(): boolean {
    return isNativeServerMode();
  },

  async checkHealth(): Promise<NativeHealthResponse> {
    if (!isNativeServerMode()) {
      return { ok: false, mode: 'native-fs', revision: 0, message: 'Not running inside OT-Baza.exe' };
    }
    try {
      const res = await fetch('/api/health', {
        method: 'GET',
        headers: buildAuthHeaders()
      });
      const json = await res.json();
      if (json && typeof json.revision === 'number') {
        currentRevision = json.revision;
      }
      return {
        ok: Boolean(res.ok && json?.ok),
        mode: 'native-fs',
        revision: Number(json?.revision || 0),
        restoredFromBackup: Boolean(json?.restoredFromBackup),
        corruptedWarning: Boolean(json?.corruptedWarning),
        storage: json?.storage,
        usbDisconnected: Boolean(json?.usbDisconnected),
        error: json?.error,
        message: json?.message
      };
    } catch (err: any) {
      return {
        ok: false,
        mode: 'native-fs',
        revision: currentRevision,
        usbDisconnected: false,
        error: 'SERVER_UNREACHABLE',
        message: err?.message || 'Локальный сервер OT-Baza.exe не отвечает'
      };
    }
  },

  async fetchDatabase(): Promise<{ data: any; revision: number }> {
    const res = await fetch('/api/database', {
      method: 'GET',
      headers: buildAuthHeaders()
    });
    const revHdr = Number(res.headers.get('X-OT-Revision') || '0');
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      let usb = false;
      try {
        const errJson = await res.json();
        msg = errJson?.message || msg;
        usb = Boolean(errJson?.usbDisconnected);
      } catch {
        // ignore parse error
      }
      const err: any = new Error(msg);
      err.usbDisconnected = usb;
      throw err;
    }
    const data = await res.json();
    if (revHdr > 0) {
      currentRevision = revHdr;
    }
    return { data, revision: currentRevision };
  },

  async saveDatabase(state: DatabaseState, expectedRevision?: number): Promise<SaveDatabaseResult> {
    if (!isNativeServerMode()) {
      return { ok: false, errorCode: 'NOT_NATIVE', message: 'Native server inactive' };
    }
    try {
      const headers = buildAuthHeaders({
        'Content-Type': 'application/json; charset=utf-8'
      });
      const revToSend = expectedRevision !== undefined ? expectedRevision : currentRevision;
      if (revToSend > 0) {
        headers['X-Expected-Revision'] = String(revToSend);
      }

      const res = await fetch('/api/database', {
        method: 'PUT',
        headers,
        body: JSON.stringify(state, null, 2)
      });

      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        return {
          ok: false,
          isConflict: true,
          revision: Number(json?.revision || currentRevision),
          errorCode: 'REVISION_CONFLICT',
          message: 'База на диске была изменена другим процессом. Обновите данные с диска или перезапишите.'
        };
      }

      if (!res.ok || !json?.ok) {
        return {
          ok: false,
          errorCode: json?.error || `HTTP_${res.status}`,
          usbDisconnected: Boolean(json?.usbDisconnected),
          message: json?.message || 'Не удалось сохранить базу в ./data/ot_database.json'
        };
      }

      if (typeof json.revision === 'number') {
        currentRevision = json.revision;
      }
      return { ok: true, revision: currentRevision };
    } catch (err: any) {
      return {
        ok: false,
        errorCode: 'NETWORK_ERROR',
        message: err?.message || 'Потеряна связь с локальным сервером OT-Baza.exe'
      };
    }
  },

  async createDiskBackup(): Promise<{ ok: boolean; fileName?: string; message?: string; usbDisconnected?: boolean }> {
    try {
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: buildAuthHeaders()
      });
      const json = await res.json().catch(() => ({}));
      return {
        ok: Boolean(res.ok && json?.ok),
        fileName: json?.fileName,
        usbDisconnected: Boolean(json?.usbDisconnected),
        message: json?.message
      };
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Ошибка создания резервной копии на диске' };
    }
  },

  async saveFileToBucket(
    bucket: 'normatives' | 'documents' | 'templates',
    fileName: string,
    payload: Blob | ArrayBuffer | Uint8Array | string
  ): Promise<{ ok: boolean; safeName: string; message?: string; usbDisconnected?: boolean }> {
    const safeName =
      bucket === 'documents' && (fileName.includes('/') || fileName.includes('\\'))
        ? sanitizeRelativeSubpath(fileName)
        : sanitizeSafeFilename(fileName);
    if (!isNativeServerMode()) {
      return { ok: false, safeName, message: 'Native FS unavailable' };
    }
    try {
      const res = await fetch(`/api/files/${bucket}/${encodeSubpathForUrl(safeName)}`, {
        method: 'PUT',
        headers: buildAuthHeaders({
          'Content-Type': 'application/octet-stream'
        }),
        body: payload as BodyInit
      });
      const json = await res.json().catch(() => ({}));
      return {
        ok: Boolean(res.ok && json?.ok),
        safeName,
        usbDisconnected: Boolean(json?.usbDisconnected),
        message: json?.message
      };
    } catch (err: any) {
      return { ok: false, safeName, message: err?.message || 'Ошибка записи файла' };
    }
  },

  async moveDocumentInBucket(
    fromRelativePath: string,
    toRelativePath: string
  ): Promise<{ ok: boolean; moved?: boolean; message?: string }> {
    if (!isNativeServerMode()) return { ok: true, moved: false };
    const safeFrom = sanitizeRelativeSubpath(fromRelativePath);
    const safeTo = sanitizeRelativeSubpath(toRelativePath);
    try {
      const res = await fetch(
        `/api/files-move/documents?from=${encodeURIComponent(safeFrom)}&to=${encodeURIComponent(safeTo)}`,
        {
          method: 'POST',
          headers: buildAuthHeaders()
        }
      );
      const json = await res.json().catch(() => ({}));
      return {
        ok: Boolean(res.ok && json?.ok),
        moved: Boolean(json?.moved),
        message: json?.message
      };
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Ошибка перемещения файла в архив' };
    }
  },

  async downloadFileFromBucket(
    bucket: 'normatives' | 'documents' | 'templates',
    fileName: string
  ): Promise<Blob> {
    const safeName =
      bucket === 'documents' && (fileName.includes('/') || fileName.includes('\\'))
        ? sanitizeRelativeSubpath(fileName)
        : sanitizeSafeFilename(fileName);
    const res = await fetch(`/api/files/${bucket}/${encodeSubpathForUrl(safeName)}`, {
      method: 'GET',
      headers: buildAuthHeaders()
    });
    if (!res.ok) {
      throw new Error(`Не удалось прочитать файл ${safeName} с диска (HTTP ${res.status})`);
    }
    return await res.blob();
  },

  async deleteFileFromBucket(
    bucket: 'normatives' | 'documents' | 'templates',
    fileName: string
  ): Promise<boolean> {
    if (!isNativeServerMode()) return true;
    const safeName =
      bucket === 'documents' && (fileName.includes('/') || fileName.includes('\\'))
        ? sanitizeRelativeSubpath(fileName)
        : sanitizeSafeFilename(fileName);
    try {
      const res = await fetch(`/api/files/${bucket}/${encodeSubpathForUrl(safeName)}`, {
        method: 'DELETE',
        headers: buildAuthHeaders()
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async heartbeat(): Promise<{ ok: boolean; usbDisconnected?: boolean; error?: string }> {
    if (!isNativeServerMode()) return { ok: true };
    try {
      const res = await fetch('/api/heartbeat', {
        method: 'GET',
        headers: buildAuthHeaders()
      });
      const json = await res.json().catch(() => ({}));
      return {
        ok: Boolean(res.ok && json?.ok),
        usbDisconnected: Boolean(json?.usbDisconnected),
        error: json?.message
      };
    } catch {
      return { ok: false, error: 'Нет связи с сервером OT-Baza.exe' };
    }
  },

  notifyShutdown(): void {
    if (!isNativeServerMode() || !inMemoryToken) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(`/api/shutdown?token=${encodeURIComponent(inMemoryToken)}`, '');
      }
    } catch {
      // Ignore during unload
    }
  }
};
