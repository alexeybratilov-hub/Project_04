import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  __setConnectedHandleForTests,
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readBinaryFile,
  readDatabaseText,
  writeBinaryFile,
  writeDatabaseText,
  type FsDirectoryHandle,
  type FsFileHandle
} from '../workspaceFolderService';

class FakeDir implements FsDirectoryHandle {
  readonly kind = 'directory' as const;
  files = new Map<string, string | Blob>();
  dirs = new Map<string, FakeDir>();

  constructor(public name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsDirectoryHandle> {
    const existing = this.dirs.get(name);
    if (existing) return existing;
    if (!options?.create) throw new Error(`ENOENT: directory ${name}`);
    const created = new FakeDir(name);
    this.dirs.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle> {
    if (!this.files.has(name)) {
      if (!options?.create) throw new Error(`ENOENT: file ${name}`);
      this.files.set(name, '');
    }
    return new FakeFile(name, this);
  }

  async removeEntry(name: string): Promise<void> {
    if (this.files.delete(name)) return;
    if (this.dirs.delete(name)) return;
    throw new Error(`ENOENT: entry ${name}`);
  }

  async *values(): AsyncIterableIterator<FsFileHandle | FsDirectoryHandle> {
    for (const name of this.files.keys()) yield new FakeFile(name, this) as unknown as FsFileHandle;
    for (const dir of this.dirs.values()) yield dir;
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted';
  }

  getData(path: string[]): FakeDir {
    let dir: FakeDir = this;
    for (const segment of path) {
      const next = dir.dirs.get(segment);
      if (!next) throw new Error(`ENOENT: ${path.join('/')}`);
      dir = next;
    }
    return dir;
  }
}

class FakeFile implements FsFileHandle {
  readonly kind = 'file' as const;
  constructor(public name: string, private dir: FakeDir) {}

  async getFile(): Promise<File> {
    const content = this.dir.files.get(this.name) ?? '';
    return new File([content], this.name, { type: 'application/json' });
  }

  async createWritable() {
    const dir = this.dir;
    const name = this.name;
    return {
      async write(data: BlobPart) {
        dir.files.set(name, typeof data === 'string' ? data : (data as Blob));
      },
      async close() {
        /* no-op */
      }
    };
  }
}

describe('workspaceFolderService (File System Access API без нативного сервера)', () => {
  let root: FakeDir;

  beforeEach(() => {
    root = new FakeDir('OT-Workdir');
    (globalThis as unknown as { window: unknown }).window = {
      isSecureContext: true,
      showDirectoryPicker: async () => root
    };
    __setConnectedHandleForTests(root);
  });

  afterEach(() => {
    __setConnectedHandleForTests(null);
    delete (globalThis as { window?: unknown }).window;
  });

  it('пишет базу в data/ot_database.json и создаёт резервную копию предыдущей версии', async () => {
    const first = await writeDatabaseText('{"version":"1"}');
    expect(first.ok).toBe(true);
    expect(root.getData(['data']).files.get('ot_database.json')).toBe('{"version":"1"}');

    const second = await writeDatabaseText('{"version":"2"}');
    expect(second.ok).toBe(true);
    expect(root.getData(['data', 'backups']).files.get('ot_database_prev.json')).toBe('{"version":"1"}');
    expect(root.getData(['data']).files.get('ot_database.json')).toBe('{"version":"2"}');
  });

  it('читает базу из папки и возвращает null, если файла ещё нет', async () => {
    expect(await readDatabaseText()).toBeNull();

    await writeDatabaseText('{"rows":3}');
    expect(await readDatabaseText()).toBe('{"rows":3}');
  });

  it('пишет и читает бинарные файлы во вложенных каталогах', async () => {
    const blob = new Blob(['PDF-CONTENT'], { type: 'application/pdf' });
    const res = await writeBinaryFile(['documents', 'Приказы', 'prikaz.pdf'], blob);
    expect(res.ok).toBe(true);

    const read = await readBinaryFile(['documents', 'Приказы', 'prikaz.pdf']);
    expect(read).not.toBeNull();
    expect(await read!.text()).toBe('PDF-CONTENT');
  });

  it('удаляет файл и перечисляет содержимое каталога', async () => {
    await writeBinaryFile(['normatives', 'a.pdf'], new Blob(['a']));
    await writeBinaryFile(['normatives', 'b.pdf'], new Blob(['b']));

    expect(await listWorkspaceFiles(['normatives'])).toEqual(['a.pdf', 'b.pdf']);
    expect(await deleteWorkspaceFile(['normatives', 'a.pdf'])).toBe(true);
    expect(await listWorkspaceFiles(['normatives'])).toEqual(['b.pdf']);
  });

  it('возвращает ошибку вместо исключения, если папка отключена', async () => {
    __setConnectedHandleForTests(null);
    const res = await writeDatabaseText('{}');
    expect(res.ok).toBe(false);
  });
});
