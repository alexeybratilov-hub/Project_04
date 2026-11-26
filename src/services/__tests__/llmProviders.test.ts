import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  LLM_PROVIDER_PRESETS,
  getLLMProviderPreset,
  normalizeLLMConfig
} from '../../data/llmProviders';
import { ollamaService, rehydratePiiInText } from '../ollamaService';

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

  it('checks Anthropic and Gemini formats using x-goog-api-key header (never query string) and surfaces network errors cleanly', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/embedding-001' }]
      })
    } as any);
    globalThis.fetch = fetchMock;

    const gemRes = await ollamaService.checkConnection({
      providerId: 'gemini',
      providerKind: 'api',
      apiFormat: 'gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'AIza-test'
    });
    expect(gemRes.ok).toBe(true);
    expect(gemRes.models).toEqual(['gemini-2.5-flash']);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).not.toContain('key=');
    expect(calledInit?.headers?.['x-goog-api-key']).toBe('AIza-test');

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

  it('anonymizes PII (152-FZ) by default for cloud API providers and keeps full data for local servers', () => {
    const tab = {
      id: 'tab_emp',
      name: 'Список работников',
      columns: [
        { id: 'emp_fio', name: 'ФИО работника', type: 'text' as const },
        { id: 'emp_pos', name: 'Должность', type: 'text' as const },
        { id: 'emp_snils', name: 'СНИЛС', type: 'text' as const }
      ],
      rows: [],
      attachedDocs: []
    };
    const row = {
      id: 'r1',
      emp_fio: 'Иванов Сергей Петрович',
      emp_pos: 'Электрогазосварщик 5 разряда',
      emp_snils: '142-876-231 09'
    };
    const entityProfile = {
      fullName: 'ООО «Катания»',
      shortName: 'ООО «Катания»',
      inn: '7701234567',
      kpp: '770101001',
      ogrn: '1157746123456',
      okpo: '',
      okved: '',
      bankDetails: '',
      bankIn: '',
      legalAddress: 'г. Москва, ул. Земляной Вал, д. 9',
      email: 'info@kataniya-ot.ru',
      phone: '+7 (495) 123-45-67',
      directorFio: 'Александров Игорь Владимирович'
    };

    const cloudPrompt = ollamaService.buildPrompt({
      tab,
      row,
      templateTitle: 'ИОТ',
      templateRequirements: 'Инструкция',
      attachedDocs: [],
      tags: [],
      allTabs: [tab],
      entityProfile,
      llmConfig: normalizeLLMConfig({
        ...getLLMProviderPreset('openai'),
        providerId: 'openai',
        apiKey: 'sk-test'
      })
    });
    expect(cloudPrompt).not.toContain('Иванов Сергей Петрович');
    expect(cloudPrompt).not.toContain('142-876-231 09');
    expect(cloudPrompt).not.toContain('7701234567');
    expect(cloudPrompt).toContain('[ФИО скрыто (ПДн)]');
    expect(cloudPrompt).toContain('[СНИЛС скрыт]');
    expect(cloudPrompt).toContain('Электрогазосварщик 5 разряда');

    const localPrompt = ollamaService.buildPrompt({
      tab,
      row,
      templateTitle: 'ИОТ',
      templateRequirements: 'Инструкция',
      attachedDocs: [],
      tags: [],
      allTabs: [tab],
      entityProfile,
      llmConfig: normalizeLLMConfig({
        providerId: 'ollama',
        providerKind: 'local',
        apiFormat: 'ollama'
      })
    });
    expect(localPrompt).toContain('Иванов Сергей Петрович');
    expect(localPrompt).toContain('7701234567');
  });

  it('rehydrates masked PII placeholders locally after cloud LLM response without leaking PII in prompt', async () => {
    const tab = {
      id: 'tab_employees',
      moduleId: 'employees',
      name: 'Список работников',
      columns: [
        { id: 'emp_tab_num', name: 'Табельный №', type: 'text' as const },
        { id: 'emp_fio', name: 'ФИО работника', type: 'text' as const },
        { id: 'emp_pos', name: 'Должность', type: 'text' as const },
        { id: 'emp_snils', name: 'СНИЛС', type: 'text' as const }
      ],
      rows: [],
      attachedDocs: []
    };
    const row = {
      id: 'emp_1',
      emp_tab_num: '0101',
      emp_fio: 'Иванов Сергей Петрович',
      emp_pos: 'Электрогазосварщик 5 разряда',
      emp_snils: '142-876-231 09'
    };
    const entityProfile = {
      fullName: 'ООО «Катания»',
      shortName: 'ООО «Катания»',
      inn: '7701234567',
      kpp: '770101001',
      ogrn: '1157746123456',
      okpo: '',
      okved: '',
      bankDetails: '',
      bankIn: '',
      legalAddress: 'г. Москва, ул. Земляной Вал, д. 9',
      email: 'info@kataniya-ot.ru',
      phone: '+7 (495) 123-45-67',
      directorFio: 'Александров Игорь Владимирович'
    };

    const maskedOutput =
      'Работодатель: [Организация скрыта] ([Скрыты]), адрес: [Адрес скрыт].\n' +
      'Руководитель: [Руководитель скрыт].\n' +
      'Работник: [ФИО скрыто (ПДн)], таб. № [Таб.№ скрыт], СНИЛС [СНИЛС скрыт], телефон [Телефон скрыт], email [Email скрыт].';

    const direct = rehydratePiiInText(maskedOutput, { tab, row, entityProfile });
    expect(direct.restoredCount).toBe(9);
    expect(direct.text).toContain('ООО «Катания»');
    expect(direct.text).toContain('7701234567 / 770101001 / 1157746123456');
    expect(direct.text).toContain('Александров Игорь Владимирович');
    expect(direct.text).toContain('Иванов Сергей Петрович');
    expect(direct.text).toContain('0101');
    expect(direct.text).toContain('142-876-231 09');
    expect(direct.text).not.toContain('[ФИО скрыто (ПДн)]');

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: maskedOutput } }] })
    } as any);
    globalThis.fetch = fetchMock;

    const generated = await ollamaService.generateDocument({
      tab,
      row,
      templateTitle: 'Приказ по ОТ',
      templateRequirements: '',
      attachedDocs: [],
      tags: [],
      allTabs: [tab],
      entityProfile,
      llmConfig: normalizeLLMConfig({
        ...getLLMProviderPreset('openai'),
        providerId: 'openai',
        apiKey: 'sk-test'
      }),
      anonymizePii: true
    });

    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body || '{}'));
    const sentPrompt = String(sentBody.messages?.[0]?.content || '');
    expect(sentPrompt).not.toContain('Иванов Сергей Петрович');
    expect(sentPrompt).not.toContain('142-876-231 09');
    expect(sentPrompt).not.toContain('7701234567');

    expect(generated.isSimulated).toBe(false);
    expect(generated.piiRehydratedCount).toBe(9);
    expect(generated.rawMaskedText).toBe(maskedOutput);
    expect(generated.text).toContain('Иванов Сергей Петрович');
    expect(generated.text).toContain('142-876-231 09');
  });
});
