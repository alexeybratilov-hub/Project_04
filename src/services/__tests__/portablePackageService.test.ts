import { describe, it, expect, vi, afterEach } from 'vitest';
import { portablePackageService } from '../portablePackageService';
import { INITIAL_DATABASE_STATE } from '../../data/initialDatabase';
import { DatabaseState } from '../../types/database';

describe('portablePackageService binary payload validation', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('accepts valid PE32+ (.exe) binary with MZ header and sufficient size', () => {
    const buf = new Uint8Array(150_000);
    buf[0] = 0x4d; // M
    buf[1] = 0x5a; // Z
    const res = portablePackageService.validateBinaryPayload(
      buf.buffer,
      'exe',
      'application/octet-stream'
    );
    expect(res.valid).toBe(true);
  });

  it('rejects HTML SPA fallback disguised as OT-Baza.exe', () => {
    const html = '<!doctype html><html><body>SPA fallback</body></html>';
    const buf = new TextEncoder().encode(html);
    const res = portablePackageService.validateBinaryPayload(
      buf.buffer,
      'exe',
      'text/html; charset=utf-8'
    );
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('веб-страницу');
  });

  it('accepts valid ZIP archive with PK\\x03\\x04 header and rejects corrupted payload', () => {
    const validZip = new Uint8Array(150_000);
    validZip[0] = 0x50;
    validZip[1] = 0x4b;
    validZip[2] = 0x03;
    validZip[3] = 0x04;
    expect(
      portablePackageService.validateBinaryPayload(validZip.buffer, 'zip', 'application/zip').valid
    ).toBe(true);

    const badZip = new TextEncoder().encode('{"ok":false,"error":"NOT_FOUND"}');
    expect(
      portablePackageService.validateBinaryPayload(badZip.buffer, 'zip', 'application/json').valid
    ).toBe(false);
  });

  it('rejects small Vite SPA shell when validating standalone app.html', () => {
    const spaShell = '<!doctype html><html><script type="module" src="/src/main.tsx"></script></html>';
    const buf = new TextEncoder().encode(spaShell);
    const res = portablePackageService.validateBinaryPayload(buf.buffer, 'appHtml', 'text/html');
    expect(res.valid).toBe(false);
  });

  it('T-28: strips LLM API key from portable snapshot by default', () => {
    const stateWithKey: DatabaseState = {
      ...JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE)),
      llmConfig: {
        ...INITIAL_DATABASE_STATE.llmConfig,
        providerId: 'gemini',
        apiKey: 'AIza-secret-portable-test'
      }
    };

    const sanitized = portablePackageService.preparePortableDatabaseSnapshot(stateWithKey);
    expect(sanitized.llmConfig.apiKey).toBe('');
    expect(sanitized.llmConfig.providerId).toBe('gemini');
    expect(stateWithKey.llmConfig.apiKey).toBe('AIza-secret-portable-test');
  });

  it('does not leak developer preview URLs in BAT launcher and keeps README version synced', () => {
    const bat = portablePackageService.generateBatLauncher();
    expect(bat).not.toContain('ais-dev');
    expect(bat).not.toContain('.run.app');
    expect(bat).toContain('OT-Baza.exe');
    expect(bat).toContain('app.html');
    expect(portablePackageService.generateReadme()).toContain('Версия 1.3');
  });

  it('isStandaloneHtmlAvailable rejects SPA fallback and accepts real single-file bundle', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html', 'content-length': '2048' })
    } as any);
    expect(await portablePackageService.isStandaloneHtmlAvailable('/app.html')).toBe(false);

    const bigHtml = `<!doctype html><html><body>${'x'.repeat(550_000)}</body></html>`;
    const bigBuf = new TextEncoder().encode(bigHtml).buffer;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html', 'content-length': String(bigBuf.byteLength) })
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        arrayBuffer: async () => bigBuf
      } as any);
    expect(await portablePackageService.isStandaloneHtmlAvailable('/app.html')).toBe(true);
  });
});
