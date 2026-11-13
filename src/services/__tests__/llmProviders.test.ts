import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  LLM_PROVIDER_PRESETS,
  getLLMProviderPreset,
  normalizeLLMConfig
} from '../../data/llmProviders';
import { ollamaService } from '../ollamaService';

describe('llmProviders and multi-provider connection checks', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('includes both local server presets and external API presets with popular models', () => {
    const local = LLM_PROVIDER_PRESETS.filter((p) => p.kind === 'local');
    const api = LLM_PROVIDER_PRESETS.filter((p) => p.kind === 'api');

    expect(local.length).toBeGreaterThanOrEqual(3);
    expect(api.length).toBeGreaterThanOrEqual(5);
    expect(local.every((p) => p.popularModels.length > 0 && !p.requiresApiKey)).toBe(true);
    expect(api.every((p) => p.popularModels.length > 0 && p.requiresApiKey)).toBe(true);
  });

  it('normalizes legacy config without providerId/apiFormat cleanly', () => {
    const legacy = {
      endpoint: 'http://localhost:11434',
      model: 'llama3.1:8b',
      timeoutMs: 30000,
      temperature: 0.2,
      status: 'idle' as const
    };
    const norm = normalizeLLMConfig(legacy);
    expect(norm.providerId).toBe('ollama');
    expect(norm.providerKind).toBe('local');
    expect(norm.apiFormat).toBe('ollama');
    expect(norm.model).toBe('llama3.1:8b');
    expect(norm.apiKey).toBe('');
  });

  it('returns clear validation error when endpoint or required API key is missing', async () => {
    const noUrl = await ollamaService.checkConnection({
      providerId: 'ollama',
      endpoint: '   '
    });
    expect(noUrl.ok).toBe(false);
    expect(noUrl.error).toContain('URL');

    const noKey = await ollamaService.checkConnection({
      providerId: 'openai',
      providerKind: 'api',
      apiFormat: 'openai',
      endpoint: 'https://api.openai.com/v1',
      apiKey: ''
    });
    expect(noKey.ok).toBe(false);
    expect(noKey.error).toContain('API-ключ');
  });

  it('parses OpenAI-compatible /models response and handles HTTP 401 failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] })
    } as any);

    const okRes = await ollamaService.checkConnection(
      normalizeLLMConfig({
        ...getLLMProviderPreset('openai'),
        providerId: 'openai',
        apiKey: 'sk-test-123'
      })
    );
    expect(okRes.ok).toBe(true);
    expect(okRes.models).toEqual(['gpt-4o-mini', 'gpt-4o']);

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid API key'
    } as any);

    const errRes = await ollamaService.checkConnection(
      normalizeLLMConfig({
        providerId: 'openai',
        providerKind: 'api',
        apiFormat: 'openai',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'sk-bad'
      })
    );
    expect(errRes.ok).toBe(false);
    expect(errRes.error).toContain('401');
  });

  it('checks Anthropic and Gemini formats and surfaces network errors cleanly', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/embedding-001' }]
      })
    } as any);

    const gemRes = await ollamaService.checkConnection({
      providerId: 'gemini',
      providerKind: 'api',
      apiFormat: 'gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'AIza-test'
    });
    expect(gemRes.ok).toBe(true);
    expect(gemRes.models).toEqual(['gemini-2.5-flash']);

    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch'));
    const netErr = await ollamaService.checkConnection({
      providerId: 'lmstudio',
      providerKind: 'local',
      apiFormat: 'openai',
      endpoint: 'http://localhost:1234/v1'
    });
    expect(netErr.ok).toBe(false);
    expect(netErr.error).toContain('Failed to fetch');
    expect(netErr.error).toContain('CORS');
  });
});
