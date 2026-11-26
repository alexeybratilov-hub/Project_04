/**
 * Рабочая папка на диске для веб-версии (без нативного сервера).
 *
 * Использует File System Access API (Chrome/Edge 86+, только secure context:
 * https или http://localhost): пользователь один раз выбирает папку, браузер
 * сохраняет handle в IndexedDB, после чего приложение читает и пишет
 * `data/ot_database.json` напрямую — как это делал OT-Baza.exe.
 *
 * Ограничения платформы (осознанные, задокументированы в README):
 *  - папку выбирает только пользователь, через системный диалог;
 *  - после перезагрузки браузер может потребовать подтвердить доступ
 *    (requestPermission требует user gesture — кнопка «Разрешить доступ»);
 *  - запись не атомарна: перед перезаписью БД сохраняется в
 *    `data/backups/ot_database_prev.json`.
 */

export interface FsFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }>;
}

export interface FsDirectoryHandle {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  values?(): AsyncIterableIterator<FsFileHandle | FsDirectoryHandle>;
}

export type WorkspaceStatus = 'unsupported' | 'disconnected' | 'needs-permission' | 'connected';

export interface WorkspaceState {
  status: WorkspaceStatus;
  folderName: string | null;
}

export const WORKSPACE_DB_DIR = 'data';
export const WORKSPACE_DB_FILE = 'ot_database.json';
export const WORKSPACE_BACKUP_DIR = 'backups';
export const WORKSPACE_BACKUP_FILE = 'ot_database_prev.json';

const IDB_NAME = 'ot_baza_workspace';
const IDB_STORE = 'handles';
const IDB_KEY = 'workdir';

let connectedHandle: FsDirectoryHandle | null = null;

/**
 * Десктопный режим (WebView2): файлы читаются и пишутся через нативный мост C#,
 * папка фиксирована рядом с программой. Диалоги браузера в этом режиме не нужны
 * и не поддерживаются.
 */
export interface DesktopBridge {
  GetRoot(): Promise<string>;
  OpenRoot(): Promise<void>;
  ReadDatabase(): Promise<string | null>;
  WriteDatabase(json: string): Promise<void>;
  WriteBinary(relativePath: string, base64: string): Promise<void>;
  ReadBinary(relativePath: string): Promise<string | null>;
  List(relativePath: string): Promise<string>;
  Delete(relativePath: string): Promise<boolean>;
}

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const host = (
    window as unknown as {
      chrome?: { webview?: { hostObjects?: { otDesktop?: DesktopBridge } } };
    }
  ).chrome?.webview?.hostObjects?.otDesktop;
  return host ?? null;
}

export function isDesktop(): boolean {
  return getDesktopBridge() !== null;
}

/** Открыть папку с данными в проводнике (только десктопная версия). */
export async function openDataFolder(): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (!bridge) return false;
  try {
    await bridge.OpenRoot();
    return true;
  } catch {
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

function getPicker(): ((options?: {
  mode?: 'read' | 'readwrite';
  id?: string;
  startIn?: string;
}) => Promise<FsDirectoryHandle>) | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
      id?: string;
      startIn?: string;
    }) => Promise<FsDirectoryHandle>;
  }).showDirectoryPicker;
  return typeof candidate === 'function' ? candidate.bind(window) : null;
}

export function isSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (getDesktopBridge()) return true;
  if (!getPicker()) return false;
  return window.isSecureContext !== false;
}

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

async function idbGet(key: string): Promise<unknown> {
  const db = await openIdb();
  if (!db) return null;
  const value = await new Promise<unknown>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  return value;
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

async function queryPermission(handle: FsDirectoryHandle): Promise<PermissionState> {
  if (!handle.queryPermission) return 'granted';
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

async function requestPermission(handle: FsDirectoryHandle): Promise<PermissionState> {
  if (!handle.requestPermission) return 'granted';
  try {
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

async function readHandle(): Promise<FsDirectoryHandle | null> {
  if (connectedHandle) return connectedHandle;
  const stored = await idbGet(IDB_KEY);
  if (stored && (stored as FsDirectoryHandle)?.kind === 'directory') {
    connectedHandle = stored as FsDirectoryHandle;
    return connectedHandle;
  }
  return null;
}

/** Текущий статус без запроса разрешений (не открывает диалогов). */
export async function getStatus(): Promise<WorkspaceState> {
  const bridge = getDesktopBridge();
  if (bridge) {
    return { status: 'connected', folderName: 'рядом с программой' };
  }
  if (!isSupported()) {
    return { status: 'unsupported', folderName: null };
  }
  const handle = await readHandle();
  if (!handle) {
    return { status: 'disconnected', folderName: null };
  }
  const permission = await queryPermission(handle);
  if (permission === 'granted') {
    return { status: 'connected', folderName: handle.name };
  }
  return { status: 'needs-permission', folderName: handle.name };
}

export function isConnected(): boolean {
  if (getDesktopBridge()) return true;
  return connectedHandle !== null;
}

/** true, если папка уже подключена и доступ подтверждён в этой сессии. */
export async function ensureConnected(): Promise<FsDirectoryHandle | null> {
  if (getDesktopBridge()) return null;
  const state = await getStatus();
  if (state.status !== 'connected') return null;
  return readHandle();
}

/**
 * Диалог выбора рабочей папки. Должен вызываться из обработчика пользовательского
 * действия (клик), иначе браузер отклонит запрос.
 */
export async function connect(): Promise<
  { ok: true; folderName: string } | { ok: false; error: string }
> {
  const bridge = getDesktopBridge();
  if (bridge) {
    return { ok: true, folderName: 'рядом с программой' };
  }
  const picker = getPicker();
  if (!picker) {
    return {
      ok: false,
      error:
        'Браузер не поддерживает доступ к папкам (File System Access API). Используйте Chrome или Edge, либо приложение OT-Baza.exe.'
    };
  }
  try {
    const handle = await picker({ id: 'ot-baza-workdir', mode: 'readwrite', startIn: 'documents' });
    const permission = await queryPermission(handle);
    const granted = permission === 'granted' ? permission : await requestPermission(handle);
    if (granted !== 'granted') {
      return { ok: false, error: 'Доступ к выбранной папке не разрешён.' };
    }
    connectedHandle = handle;
    await idbPut(IDB_KEY, handle);
    return { ok: true, folderName: handle.name };
  } catch (err) {
    const message = String((err as { message?: string })?.message || err);
    if (/abort/i.test(message)) {
      return { ok: false, error: 'Выбор папки отменён.' };
    }
    return { ok: false, error: message };
  }
}

/** Подтвердить доступ к ранее выбранной папке (нужен user gesture). */
export async function requestAccess(): Promise<{ ok: boolean; error?: string }> {
  if (getDesktopBridge()) return { ok: true };
  const handle = await readHandle();
  if (!handle) return { ok: false, error: 'Рабочая папка не выбрана.' };
  const granted = await requestPermission(handle);
  if (granted !== 'granted') {
    return { ok: false, error: 'Браузер не предоставил доступ к папке.' };
  }
  connectedHandle = handle;
  return { ok: true };
}

export async function disconnect(): Promise<void> {
  if (getDesktopBridge()) return;
  connectedHandle = null;
  await idbDelete(IDB_KEY);
}

async function getSubdirectory(
  root: FsDirectoryHandle,
  segments: string[],
  create: boolean
): Promise<FsDirectoryHandle> {
  let dir = root;
  for (const segment of segments) {
    dir = await dir.getDirectoryHandle(segment, { create });
  }
  return dir;
}

export async function readDatabaseText(): Promise<string | null> {
  const bridge = getDesktopBridge();
  if (bridge) {
    try {
      return await bridge.ReadDatabase();
    } catch {
      return null;
    }
  }
  const root = await ensureConnected();
  if (!root) return null;
  try {
    const dataDir = await getSubdirectory(root, [WORKSPACE_DB_DIR], false);
    const fileHandle = await dataDir.getFileHandle(WORKSPACE_DB_FILE);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

/**
 * Запись базы в `data/ot_database.json`.
 * Перед перезаписью текущее содержимое копируется в `data/backups/ot_database_prev.json`,
 * чтобы сбой посреди записи не оставил пользователя без данных.
 */
export async function writeDatabaseText(
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const bridge = getDesktopBridge();
  if (bridge) {
    try {
      await bridge.WriteDatabase(text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err as { message?: string })?.message || err) };
    }
  }
  const root = await ensureConnected();
  if (!root) return { ok: false, error: 'Рабочая папка не подключена' };
  try {
    const dataDir = await getSubdirectory(root, [WORKSPACE_DB_DIR], true);
    const backupsDir = await getSubdirectory(root, [WORKSPACE_DB_DIR, WORKSPACE_BACKUP_DIR], true);

    try {
      const existing = await dataDir.getFileHandle(WORKSPACE_DB_FILE);
      const existingFile = await existing.getFile();
      const previousText = await existingFile.text();
      if (previousText.trim().length > 0) {
        const backupHandle = await backupsDir.getFileHandle(WORKSPACE_BACKUP_FILE, { create: true });
        const writable = await backupHandle.createWritable();
        await writable.write(previousText);
        await writable.close();
      }
    } catch {
      // Первый запуск или файл ещё не создан — бэкап не нужен
    }

    const fileHandle = await dataDir.getFileHandle(WORKSPACE_DB_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err as { message?: string })?.message || err) };
  }
}

export async function writeBinaryFile(
  segments: string[],
  data: Blob
): Promise<{ ok: true } | { ok: false; error: string }> {
  const bridge = getDesktopBridge();
  if (bridge) {
    try {
      const buffer = await data.arrayBuffer();
      await bridge.WriteBinary(segments.join('/'), bytesToBase64(new Uint8Array(buffer)));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err as { message?: string })?.message || err) };
    }
  }
  const root = await ensureConnected();
  if (!root) return { ok: false, error: 'Рабочая папка не подключена' };
  try {
    const fileName = segments[segments.length - 1];
    const dir = await getSubdirectory(root, segments.slice(0, -1), true);
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err as { message?: string })?.message || err) };
  }
}

export async function readBinaryFile(segments: string[]): Promise<Blob | null> {
  const bridge = getDesktopBridge();
  if (bridge) {
    try {
      const base64 = await bridge.ReadBinary(segments.join('/'));
      if (!base64) return null;
      return new Blob([base64ToBytes(base64)]);
    } catch {
      return null;
    }
  }
  const root = await ensureConnected();
  if (!root) return null;
  try {
    const fileName = segments[segments.length - 1];
    const dir = await getSubdirectory(root, segments.slice(0, -1), false);
    const fileHandle = await dir.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

export async function deleteWorkspaceFile(segments: string[]): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (bridge) {
    try {
      return await bridge.Delete(segments.join('/'));
    } catch {
      return false;
    }
  }
  const root = await ensureConnected();
  if (!root) return false;
  try {
    const fileName = segments[segments.length - 1];
    const dir = await getSubdirectory(root, segments.slice(0, -1), false);
    await dir.removeEntry(fileName);
    return true;
  } catch {
    return false;
  }
}

export async function listWorkspaceFiles(segments: string[]): Promise<string[]> {
  const bridge = getDesktopBridge();
  if (bridge) {
    try {
      const json = await bridge.List(segments.join('/'));
      const names = JSON.parse(json) as string[];
      return names.sort((a, b) => a.localeCompare(b, 'ru'));
    } catch {
      return [];
    }
  }
  const root = await ensureConnected();
  if (!root) return [];
  try {
    const dir = await getSubdirectory(root, segments, false);
    if (!dir.values) return [];
    const names: string[] = [];
    for await (const entry of dir.values()) {
      names.push(entry.name);
    }
    return names.sort((a, b) => a.localeCompare(b, 'ru'));
  } catch {
    return [];
  }
}

/** Только для тестов: подменить handle без IndexedDB. */
export function __setConnectedHandleForTests(handle: FsDirectoryHandle | null): void {
  connectedHandle = handle;
}

export const workspaceFolderService = {
  isSupported,
  isDesktop,
  openDataFolder,
  getStatus,
  isConnected,
  ensureConnected,
  connect,
  requestAccess,
  disconnect,
  readDatabaseText,
  writeDatabaseText,
  writeBinaryFile,
  readBinaryFile,
  deleteWorkspaceFile,
  listWorkspaceFiles
};
