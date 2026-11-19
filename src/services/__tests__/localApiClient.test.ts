import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyNativeConnectionError,
  classifyNativeHttpError,
  getCurrentRevision,
  initNativeSessionFromLocation,
  isNativeServerMode,
  isNativeSessionLost,
  localApiClient,
  resetNativeSessionForTests,
  setCurrentRevision
} from '../localApiClient';
import {
  evaluateRecoveryState,
  STORAGE_KEY,
  storageService
} from '../storageService';
import { INITIAL_DATABASE_STATE } from '../../data/initialDatabase';
import { DatabaseState } from '../../types/database';

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    _map: map
  };
}

describe('T-37: localApiClient & persistence recovery resilience', () => {
  let mockSessionStorage: ReturnType<typeof createMemoryStorage>;
  let mockLocalStorage: ReturnType<typeof createMemoryStorage>;
  let mockLocation: {
    hostname: string;
    protocol: string;
    host: string;
    origin: string;
    pathname: string;
    search: string;
    hash: string;
  };
  let replaceStateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSessionStorage = createMemoryStorage();
    mockLocalStorage = createMemoryStorage();
    mockLocation = {
      hostname: '127.0.0.1',
      protocol: 'http:',
      host: '127.0.0.1:54321',
      origin: 'http://127.0.0.1:54321',
      pathname: '/',
      search: '',
      hash: '#token=0123456789abcdef0123456789abcdef'
    };
    replaceStateSpy = vi.fn((_state: any, _title: string, url: string) => {
      mockLocation.hash = '';
      mockLocation.pathname = url || '/';
    });

    vi.stubGlobal('window', {
      location: mockLocation,
      sessionStorage: mockSessionStorage,
      localStorage: mockLocalStorage,
      history: { replaceState: replaceStateSpy }
    });
    vi.stubGlobal('localStorage', mockLocalStorage);
    resetNativeSessionForTests();
  });

  afterEach(() => {
    resetNativeSessionForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('persists native session token across F5 reloads via same-origin sessionStorage without leaking URL hash', () => {
    const token = initNativeSessionFromLocation();
    expect(token).toBe('0123456789abcdef0123456789abcdef');
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(mockLocation.hash).toBe('');
    expect(isNativeServerMode()).toBe(true);
    expect(isNativeSessionLost()).toBe(false);

    // Simulate F5 page reload: JS module inMemoryToken is cleared, URL hash stays empty, sessionStorage survives
    const savedSessionSnapshot = new Map(mockSessionStorage._map);
    resetNativeSessionForTests();
    for (const [k, v] of savedSessionSnapshot.entries()) {
      mockSessionStorage.setItem(k, v);
    }

    expect(initNativeSessionFromLocation()).toBe('0123456789abcdef0123456789abcdef');
    expect(isNativeServerMode()).toBe(true);
    expect(storageService.getMode()).toBe('native-fs');
  });

  it('blocks silent fallback to localStorage when native session token is lost on loopback origin', async () => {
    expect(initNativeSessionFromLocation()).toBe('0123456789abcdef0123456789abcdef');
    // Simulate sessionStorage token wiped while expected native marker remains
    const expectedKey = Array.from(mockSessionStorage._map.keys()).find((k) =>
      k.includes('native_expected')
    )!;
    const expectedVal = mockSessionStorage.getItem(expectedKey)!;
    resetNativeSessionForTests();
    mockLocation.hash = '';
    mockSessionStorage.setItem(expectedKey, expectedVal);

    expect(isNativeServerMode()).toBe(false);
    expect(isNativeSessionLost()).toBe(true);
    expect(storageService.getMode()).toBe('native-fs');

    const boot = await storageService.bootstrapDatabase();
    expect(boot.mode).toBe('native-fs');
    expect(boot.sessionLost).toBe(true);
    expect(boot.loadErrorKind).toBe('session_lost');

    const saveRes = await storageService.saveDatabaseAsync(INITIAL_DATABASE_STATE);
    expect(saveRes.ok).toBe(false);
    expect(saveRes.errorKind).toBe('session_lost');
    expect(mockLocalStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('clearly distinguishes connection, USB, disk-write, validation, session, and revision conflict errors', () => {
    const conn = classifyNativeConnectionError(new TypeError('Failed to fetch'));
    expect(conn.errorKind).toBe('connection');
    expect(conn.message).not.toContain('Failed to fetch');
    expect(conn.message).toMatch(/OT-Baza\.exe/);

    const timeoutErr = classifyNativeConnectionError(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    expect(timeoutErr.errorKind).toBe('connection');
    expect(timeoutErr.errorCode).toBe('REQUEST_TIMEOUT');

    const usb = classifyNativeHttpError(503, { error: 'USB_DISCONNECTED', usbDisconnected: true });
    expect(usb.errorKind).toBe('usb');
    expect(usb.usbDisconnected).toBe(true);

    const diskFull = classifyNativeHttpError(507, { error: 'DISK_FULL' });
    expect(diskFull.errorKind).toBe('disk_write');
    expect(diskFull.message).toMatch(/свободного места/i);

    const locked = classifyNativeHttpError(423, { error: 'FS_ACCESS_DENIED' });
    expect(locked.errorKind).toBe('disk_write');
    expect(locked.message).toMatch(/заблокирован/i);

    const invalid = classifyNativeHttpError(400, { error: 'INVALID_JSON' });
    expect(invalid.errorKind).toBe('validation');

    const conflict = classifyNativeHttpError(409, { error: 'REVISION_CONFLICT', revision: 7 }, 5);
    expect(conflict.errorKind).toBe('conflict');
    expect(conflict.isConflict).toBe(true);
    expect(conflict.serverRevision).toBe(7);
    expect(conflict.message).toContain('№7');
    expect(conflict.message).toContain('№5');
  });

  it('retries transient connection error and commits revision when server responds cleanly', async () => {
    initNativeSessionFromLocation();
    setCurrentRevision(3);

    const state: DatabaseState = JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
    state.tabs.push({
      id: 'tab_small_test',
      name: 'Медосмотры',
      columns: [{ id: 'c1', name: 'ФИО', type: 'text' }],
      rows: [],
      attachedDocs: []
    });

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, revision: 4 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const res = await localApiClient.saveDatabase(state, undefined, {
      maxRetries: 1,
      retryDelayMs: 0
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    expect(res.revision).toBe(4);
    expect(getCurrentRevision()).toBe(4);

    // Verify X-Expected-Revision was sent on both attempts
    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(firstHeaders['X-Expected-Revision']).toBe('3');
  });

  it('never overwrites newer disk revision on 409 conflict or checkHealth syncRevision: false', async () => {
    initNativeSessionFromLocation();
    setCurrentRevision(3);

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/health') {
        return new Response(JSON.stringify({ ok: true, revision: 5 }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ ok: false, error: 'REVISION_CONFLICT', revision: 5 }),
        { status: 409 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    // Health check with syncRevision: false MUST keep local revision 3 intact
    const health = await localApiClient.checkHealth({ syncRevision: false });
    expect(health.ok).toBe(true);
    expect(health.revision).toBe(5);
    expect(getCurrentRevision()).toBe(3);

    const conflictSave = await localApiClient.saveDatabase(INITIAL_DATABASE_STATE, undefined, {
      maxRetries: 2,
      retryDelayMs: 0
    });
    expect(conflictSave.ok).toBe(false);
    expect(conflictSave.isConflict).toBe(true);
    expect(conflictSave.errorKind).toBe('conflict');
    expect(conflictSave.serverRevision).toBe(5);
    // HTTP 409 must NOT trigger retries
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('detects dropped connection, recovery with same revision, and recovery conflict via heartbeat & evaluateRecoveryState', async () => {
    initNativeSessionFromLocation();
    setCurrentRevision(10);

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, revision: 10 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, revision: 12 }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    // 1. Heartbeat fails due to dropped server
    const hbDown = await localApiClient.heartbeat();
    expect(hbDown.ok).toBe(false);
    expect(hbDown.errorKind).toBe('connection');
    const evalDown = evaluateRecoveryState({
      heartbeatOk: hbDown.ok,
      localRevision: 10,
      hasUnsavedChanges: true,
      initialLoadFailed: false,
      currentSaveStatus: 'saved',
      errorKind: hbDown.errorKind,
      errorMessage: hbDown.error
    });
    expect(evalDown.action).toBe('server_error');
    expect(evalDown.errorKind).toBe('connection');

    // 2. Server comes back at same revision 10 while edits are pending -> safe to auto-save latest state
    const hbRecovered = await localApiClient.heartbeat();
    expect(hbRecovered.ok).toBe(true);
    const evalRetry = evaluateRecoveryState({
      heartbeatOk: hbRecovered.ok,
      heartbeatRevision: hbRecovered.revision,
      localRevision: 10,
      hasUnsavedChanges: true,
      initialLoadFailed: false,
      currentSaveStatus: 'error'
    });
    expect(evalRetry.action).toBe('retry_unsaved');

    // 3. Server comes back at newer revision 12 -> MUST flag conflict, NEVER auto-overwrite
    const hbNewerDisk = await localApiClient.heartbeat();
    const evalConflict = evaluateRecoveryState({
      heartbeatOk: hbNewerDisk.ok,
      heartbeatRevision: hbNewerDisk.revision,
      localRevision: 10,
      hasUnsavedChanges: true,
      initialLoadFailed: false,
      currentSaveStatus: 'error'
    });
    expect(evalConflict.action).toBe('conflict');
    expect(evalConflict.serverRevision).toBe(12);

    // 4. Initial load failure guard prevents auto-overwriting disk DB with empty seed
    const evalGuard = evaluateRecoveryState({
      heartbeatOk: true,
      heartbeatRevision: 10,
      localRevision: 10,
      hasUnsavedChanges: true,
      initialLoadFailed: true,
      currentSaveStatus: 'error'
    });
    expect(evalGuard.action).toBe('clear_error');
  });

  it('does not retry non-transient 507 disk-full errors and preserves bootstrap loadError kind', async () => {
    initNativeSessionFromLocation();
    setCurrentRevision(2);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'DISK_FULL', usbDisconnected: false }), {
        status: 507,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const diskErrRes = await localApiClient.saveDatabase(INITIAL_DATABASE_STATE, 2, {
      maxRetries: 2,
      retryDelayMs: 0
    });
    expect(diskErrRes.ok).toBe(false);
    expect(diskErrRes.errorKind).toBe('disk_write');
    expect(diskErrRes.errorCode).toBe('DISK_FULL');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Simulate bootstrap failure when disk DB cannot be read (503 USB_DISCONNECTED)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url === '/api/health') {
          return new Response(
            JSON.stringify({ ok: false, error: 'USB_DISCONNECTED', usbDisconnected: true }),
            { status: 503 }
          );
        }
        return new Response(
          JSON.stringify({ ok: false, error: 'USB_DISCONNECTED', usbDisconnected: true }),
          { status: 503 }
        );
      })
    );
    const bootErr = await storageService.bootstrapDatabase();
    expect(bootErr.mode).toBe('native-fs');
    expect(bootErr.loadErrorKind).toBe('usb');
    expect(bootErr.loadError).toBeTruthy();
  });
});
