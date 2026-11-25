import { DatabaseState } from '../types/database';

export type StorageMode = 'native-fs' | 'file-handle' | 'web-preview';

export type NativeErrorKind =
  | 'connection'
  | 'usb'
  | 'conflict'
  | 'disk_write'
  | 'session_lost'
  | 'validation';

export interface NativeHealthResponse {
  ok: boolean;
  mode: 'native-fs';
  revision: number;
  restoredFromBackup?: boolean;
  corruptedWarning?: boolean;
  storage?: string;
  usbDisconnected?: boolean;
  errorKind?: NativeErrorKind;
  error?: string;
  message?: string;
}

export interface SaveDatabaseResult {
  ok: boolean;
  revision?: number;
  serverRevision?: number;
  errorCode?: string;
  errorKind?: NativeErrorKind;
  message?: string;
  usbDisconnected?: boolean;
  isConflict?: boolean;
}

export interface HeartbeatResult {
  ok: boolean;
  revision?: number;
  usbDisconnected?: boolean;
  errorKind?: NativeErrorKind;
  errorCode?: string;
  error?: string;
}

export interface SaveDatabaseOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

const SESSION_TOKEN_PREFIX = 'ot_baza_native_session_v1:';
const SESSION_EXPECTED_PREFIX = 'ot_baza_native_expected_v1:';

let inMemoryToken: string | null = null;
let currentRevision = 0;

function isLoopbackHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === '127.0.0.1' || host === 'localhost';
}

function getOriginScope(): string {
  if (typeof window === 'undefined') return 'server';
  return window.location.origin || `${window.location.protocol}//${window.location.host}`;
}

function getSessionTokenKey(): string {
  return `${SESSION_TOKEN_PREFIX}${getOriginScope()}`;
}

function getSessionExpectedKey(): string {
  return `${SESSION_EXPECTED_PREFIX}${getOriginScope()}`;
}

function safeReadSessionStorage(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem(key);
    }
  } catch {
    // Ignore restricted storage contexts
  }
  return null;
}

function safeWriteSessionStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(key, value);
    }
  } catch {
    // Ignore restricted storage contexts
  }
}

function safeRemoveSessionStorage(key: string): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore restricted storage contexts
  }
}

/**
 * Extract one-time session token from URL fragment (#token=...) injected by OT-Baza.exe,
 * strip it from the browser address bar, and preserve it in same-tab sessionStorage across F5 reloads.
 */
export function initNativeSessionFromLocation(): string | null {
  if (typeof window === 'undefined') return null;

  if (inMemoryToken) return inMemoryToken;

  const hash = window.location.hash || '';
  const match = hash.match(/token=([a-f0-9]{16,64})/i);
  if (match && match[1]) {
    inMemoryToken = match[1];
    if (isLoopbackHost()) {
      safeWriteSessionStorage(getSessionTokenKey(), inMemoryToken);
      safeWriteSessionStorage(getSessionExpectedKey(), '1');
    }
    try {
      const cleanUrl = window.location.pathname + window.location.search;
      window.history.replaceState(null, '', cleanUrl || '/');
    } catch {
      // Ignore in restricted history contexts
    }
    return inMemoryToken;
  }

  if (isLoopbackHost()) {
    const restoredToken = safeReadSessionStorage(getSessionTokenKey());
    if (restoredToken && /^[a-f0-9]{16,64}$/i.test(restoredToken)) {
      inMemoryToken = restoredToken;
      return inMemoryToken;
    }
  }

  return null;
}

export function isNativeServerMode(): boolean {
  if (!isLoopbackHost()) return false;
  const token = initNativeSessionFromLocation();
  return Boolean(token);
}

/**
 * True when the tab was previously running inside native OT-Baza.exe (same origin),
 * so an accidental reload without token MUST NOT silently degrade into browser localStorage.
 */
export function isNativeSessionLost(): boolean {
  if (!isLoopbackHost()) return false;
  if (isNativeServerMode()) return false;
  return safeReadSessionStorage(getSessionExpectedKey()) === '1';
}

export function resetNativeSessionForTests(): void {
  inMemoryToken = null;
  currentRevision = 0;
  safeRemoveSessionStorage(getSessionTokenKey());
  safeRemoveSessionStorage(getSessionExpectedKey());
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

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = 15000
): Promise<Response> {
  if (typeof AbortController === 'undefined' || timeoutMs <= 0) {
    return await fetch(input, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function classifyNativeHttpError(
  status: number,
  json: any,
  expectedRevision?: number
): {
  errorCode: string;
  errorKind: NativeErrorKind;
  message: string;
  usbDisconnected: boolean;
  isConflict: boolean;
  serverRevision?: number;
} {
  const rawCode = String(json?.error || `HTTP_${status}`);
  const serverRevision =
    typeof json?.revision === 'number' && Number.isFinite(json.revision)
      ? json.revision
      : undefined;

  if (status === 409 || rawCode === 'REVISION_CONFLICT') {
    const diskRevNote =
      serverRevision !== undefined
        ? ` (на диске ревизия №${serverRevision}${expectedRevision ? `, ожидалась №${expectedRevision}` : ''})`
        : '';
    return {
      errorCode: 'REVISION_CONFLICT',
      errorKind: 'conflict',
      message:
        `Конфликт версий файла базы данных${diskRevNote}. База на диске новее текущих изменений — загрузите актуальную версию с диска или сохраните поверх.`,
      usbDisconnected: false,
      isConflict: true,
      serverRevision
    };
  }

  if (status === 401 || rawCode === 'INVALID_TOKEN') {
    return {
      errorCode: 'INVALID_TOKEN',
      errorKind: 'session_lost',
      message:
        'Сессия с локальным сервером OT-Baza.exe недействительна или сервер был перезапущен. Скачайте копию JSON и перезапустите OT-Baza.exe.',
      usbDisconnected: false,
      isConflict: false,
      serverRevision
    };
  }

  if (status === 503 || json?.usbDisconnected || rawCode === 'USB_DISCONNECTED') {
    return {
      errorCode: rawCode === 'HTTP_503' ? 'USB_DISCONNECTED' : rawCode,
      errorKind: 'usb',
      message:
        'Носитель или папка ./data недоступны (отключён USB-накопитель или нет пути). Подключите носитель и повторите сохранение.',
      usbDisconnected: true,
      isConflict: false,
      serverRevision
    };
  }

  if (status === 507 || rawCode === 'DISK_FULL') {
    return {
      errorCode: 'DISK_FULL',
      errorKind: 'disk_write',
      message:
        'Недостаточно свободного места на диске для записи ./data/ot_database.json. Освободите место и повторите сохранение.',
      usbDisconnected: false,
      isConflict: false,
      serverRevision
    };
  }

  if (status === 423 || rawCode === 'FS_ACCESS_DENIED') {
    return {
      errorCode: 'FS_ACCESS_DENIED',
      errorKind: 'disk_write',
      message:
        'Нет доступа к записи ./data/ot_database.json (файл «только для чтения», заблокирован антивирусом или другой программой).',
      usbDisconnected: false,
      isConflict: false,
      serverRevision
    };
  }

  if (status === 400 && (rawCode === 'INVALID_JSON' || rawCode === 'INCOMPLETE_BODY')) {
    return {
      errorCode: rawCode,
      errorKind: 'validation',
      message:
        'Переданные данные не прошли проверку целостности на сервере и не были записаны поверх файла на диске.',
      usbDisconnected: false,
      isConflict: false,
      serverRevision
    };
  }

  return {
    errorCode: rawCode,
    errorKind: 'disk_write',
    message:
      json?.message && !/^Failed to write/i.test(String(json.message))
        ? String(json.message)
        : `Ошибка записи файла ./data/ot_database.json на диск (${rawCode}). Предыдущая версия файла и резервные копии не повреждены.`,
    usbDisconnected: false,
    isConflict: false,
    serverRevision
  };
}

export function classifyNativeConnectionError(err: any): {
  errorCode: string;
  errorKind: NativeErrorKind;
  message: string;
} {
  const isTimeout = err?.name === 'AbortError';
  if (isTimeout) {
    return {
      errorCode: 'REQUEST_TIMEOUT',
      errorKind: 'connection',
      message:
        'Сервер OT-Baza.exe не ответил вовремя (превышен таймаут). Несохранённые изменения удерживаются в памяти браузера.'
    };
  }
  return {
    errorCode: 'SERVER_UNREACHABLE',
    errorKind: 'connection',
    message:
      'Нет связи с локальным сервером OT-Baza.exe (сервер остановлен или соединение прервано). Несохранённые изменения удерживаются в памяти.'
  };
}

export const localApiClient = {
  isNative(): boolean {
    return isNativeServerMode();
  },

  isNativeSessionLost(): boolean {
    return isNativeSessionLost();
  },

  async checkHealth(options?: { syncRevision?: boolean; timeoutMs?: number }): Promise<NativeHealthResponse> {
    if (!isNativeServerMode()) {
      return {
        ok: false,
        mode: 'native-fs',
        revision: 0,
        errorKind: isNativeSessionLost() ? 'session_lost' : 'connection',
        message: isNativeSessionLost()
          ? 'Потерян токен сессии с сервером OT-Baza.exe'
          : 'Not running inside OT-Baza.exe'
      };
    }
    try {
      const res = await fetchWithTimeout(
        '/api/health',
        {
          method: 'GET',
          headers: buildAuthHeaders()
        },
        options?.timeoutMs ?? 5000
      );
      const json = await res.json().catch(() => ({}));
      const rev = Number(json?.revision || 0);
      if (res.ok && json?.ok) {
        if (options?.syncRevision === true || (options?.syncRevision !== false && currentRevision === 0)) {
          if (rev > 0) currentRevision = rev;
        }
        return {
          ok: true,
          mode: 'native-fs',
          revision: rev,
          restoredFromBackup: Boolean(json?.restoredFromBackup),
          corruptedWarning: Boolean(json?.corruptedWarning),
          storage: json?.storage,
          usbDisconnected: false
        };
      }
      const classified = classifyNativeHttpError(res.status, json);
      return {
        ok: false,
        mode: 'native-fs',
        revision: rev || currentRevision,
        usbDisconnected: classified.usbDisconnected,
        errorKind: classified.errorKind,
        error: classified.errorCode,
        message: classified.message
      };
    } catch (err: any) {
      const connErr = classifyNativeConnectionError(err);
      return {
        ok: false,
        mode: 'native-fs',
        revision: currentRevision,
        usbDisconnected: false,
        errorKind: connErr.errorKind,
        error: connErr.errorCode,
        message: connErr.message
      };
    }
  },

  async fetchDatabase(timeoutMs = 15000): Promise<{ data: any; revision: number }> {
    const res = await fetchWithTimeout(
      '/api/database',
      {
        method: 'GET',
        headers: buildAuthHeaders()
      },
      timeoutMs
    );
    const revHdr = Number(res.headers.get('X-OT-Revision') || '0');
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      let usb = false;
      let errorKind: NativeErrorKind = 'disk_write';
      try {
        const errJson = await res.json();
        const classified = classifyNativeHttpError(res.status, errJson);
        msg = classified.message || msg;
        usb = classified.usbDisconnected;
        errorKind = classified.errorKind;
      } catch {
        // ignore parse error
      }
      const err: any = new Error(msg);
      err.usbDisconnected = usb;
      err.errorKind = errorKind;
      err.httpStatus = res.status;
      throw err;
    }
    const data = await res.json();
    if (revHdr > 0) {
      currentRevision = revHdr;
    }
    return { data, revision: currentRevision };
  },

  async saveDatabase(
    state: DatabaseState,
    expectedRevision?: number,
    options?: SaveDatabaseOptions
  ): Promise<SaveDatabaseResult> {
    if (!isNativeServerMode()) {
      const lost = isNativeSessionLost();
      return {
        ok: false,
        errorCode: lost ? 'SESSION_LOST' : 'NOT_NATIVE',
        errorKind: lost ? 'session_lost' : 'connection',
        message: lost
          ? 'Сессия с сервером OT-Baza.exe потеряна. Сохранение в localStorage заблокировано для защиты данных.'
          : 'Native server inactive'
      };
    }

    const maxRetries = options?.maxRetries ?? 1;
    const retryDelayMs = options?.retryDelayMs ?? 250;
    const timeoutMs = options?.timeoutMs ?? 20000;
    const payloadBody = JSON.stringify(state, null, 2);
    const revToSend = expectedRevision !== undefined ? expectedRevision : currentRevision;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const headers = buildAuthHeaders({
          'Content-Type': 'application/json; charset=utf-8'
        });
        if (revToSend > 0) {
          headers['X-Expected-Revision'] = String(revToSend);
        }

        const res = await fetchWithTimeout(
          '/api/database',
          {
            method: 'PUT',
            headers,
            body: payloadBody
          },
          timeoutMs
        );

        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) {
          const classified = classifyNativeHttpError(res.status, json, revToSend || undefined);
          return {
            ok: false,
            isConflict: classified.isConflict,
            revision: classified.serverRevision ?? currentRevision,
            serverRevision: classified.serverRevision,
            errorCode: classified.errorCode,
            errorKind: classified.errorKind,
            usbDisconnected: classified.usbDisconnected,
            message: classified.message
          };
        }

        if (typeof json.revision === 'number') {
          currentRevision = json.revision;
        }
        return { ok: true, revision: currentRevision };
      } catch (err: any) {
        if (attempt < maxRetries) {
          await sleepMs(retryDelayMs * (attempt + 1));
          continue;
        }
        const connErr = classifyNativeConnectionError(err);
        return {
          ok: false,
          errorCode: connErr.errorCode,
          errorKind: connErr.errorKind,
          message: connErr.message
        };
      }
    }

    return {
      ok: false,
      errorCode: 'SERVER_UNREACHABLE',
      errorKind: 'connection',
      message: 'Нет связи с локальным сервером OT-Baza.exe'
    };
  },

  async createDiskBackup(): Promise<{ ok: boolean; fileName?: string; message?: string; usbDisconnected?: boolean }> {
    try {
      const res = await fetchWithTimeout(
        '/api/backup',
        {
          method: 'POST',
          headers: buildAuthHeaders()
        },
        15000
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const classified = classifyNativeHttpError(res.status, json);
        return {
          ok: false,
          usbDisconnected: classified.usbDisconnected,
          message: classified.message
        };
      }
      return {
        ok: true,
        fileName: json?.fileName,
        usbDisconnected: false,
        message: json?.message
      };
    } catch (err: any) {
      const connErr = classifyNativeConnectionError(err);
      return { ok: false, message: connErr.message };
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
      const res = await fetchWithTimeout(
        `/api/files/${bucket}/${encodeSubpathForUrl(safeName)}`,
        {
          method: 'PUT',
          headers: buildAuthHeaders({
            'Content-Type': 'application/octet-stream'
          }),
          body: payload as BodyInit
        },
        30000
      );
      const json = await res.json().catch(() => ({}));
      return {
        ok: Boolean(res.ok && json?.ok),
        safeName,
        usbDisconnected: Boolean(json?.usbDisconnected),
        message: json?.message
      };
    } catch (err: any) {
      const connErr = classifyNativeConnectionError(err);
      return { ok: false, safeName, message: connErr.message };
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
      const res = await fetchWithTimeout(
        `/api/files-move/documents?from=${encodeURIComponent(safeFrom)}&to=${encodeURIComponent(safeTo)}`,
        {
          method: 'POST',
          headers: buildAuthHeaders()
        },
        15000
      );
      const json = await res.json().catch(() => ({}));
      return {
        ok: Boolean(res.ok && json?.ok),
        moved: Boolean(json?.moved),
        message: json?.message
      };
    } catch (err: any) {
      const connErr = classifyNativeConnectionError(err);
      return { ok: false, message: connErr.message || 'Ошибка перемещения файла в архив' };
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
    const res = await fetchWithTimeout(
      `/api/files/${bucket}/${encodeSubpathForUrl(safeName)}`,
      {
        method: 'GET',
        headers: buildAuthHeaders()
      },
      30000
    );
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
      const res = await fetchWithTimeout(
        `/api/files/${bucket}/${encodeSubpathForUrl(safeName)}`,
        {
          method: 'DELETE',
          headers: buildAuthHeaders()
        },
        15000
      );
      return res.ok;
    } catch {
      return false;
    }
  },

  async heartbeat(timeoutMs = 5000): Promise<HeartbeatResult> {
    if (!isNativeServerMode()) {
      if (isNativeSessionLost()) {
        return {
          ok: false,
          errorKind: 'session_lost',
          errorCode: 'SESSION_LOST',
          error: 'Сессия с сервером OT-Baza.exe потеряна после обновления страницы'
        };
      }
      return { ok: true };
    }
    try {
      const res = await fetchWithTimeout(
        '/api/heartbeat',
        {
          method: 'GET',
          headers: buildAuthHeaders()
        },
        timeoutMs
      );
      const json = await res.json().catch(() => ({}));
      const rev = typeof json?.revision === 'number' ? json.revision : undefined;
      if (res.ok && json?.ok) {
        return {
          ok: true,
          revision: rev,
          usbDisconnected: false
        };
      }
      const classified = classifyNativeHttpError(res.status, json);
      return {
        ok: false,
        revision: rev,
        usbDisconnected: classified.usbDisconnected,
        errorKind: classified.errorKind,
        errorCode: classified.errorCode,
        error: classified.message
      };
    } catch (err: any) {
      const connErr = classifyNativeConnectionError(err);
      return {
        ok: false,
        errorKind: connErr.errorKind,
        errorCode: connErr.errorCode,
        error: connErr.message
      };
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
