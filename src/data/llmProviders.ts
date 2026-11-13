import { LLMApiFormat, LLMConfig, LLMProviderKind } from '../types/database';

export interface LLMProviderPreset {
  id: string;
  name: string;
  kind: LLMProviderKind;
  apiFormat: LLMApiFormat;
  defaultEndpoint: string;
  defaultModel: string;
  popularModels: string[];
  requiresApiKey: boolean;
  description: string;
  setupHint: string;
}

export const LLM_PROVIDER_PRESETS: LLMProviderPreset[] = [
  // ---- Local servers ----
  {
    id: 'ollama',
    name: 'Ollama (локальный сервер)',
    kind: 'local',
    apiFormat: 'ollama',
    defaultEndpoint: 'http://localhost:11434',
    defaultModel: 'qwen2.5:7b',
    popularModels: [
      'qwen2.5:7b',
      'qwen2.5:14b',
      'llama3.1:8b',
      'mistral:7b',
      'gemma2:9b',
      'deepseek-r1:8b'
    ],
    requiresApiKey: false,
    description: 'Автономный запуск открытых моделей на компьютере без отправки данных в интернет.',
    setupHint: 'Команда запуска на ПК: set OLLAMA_ORIGINS=* && ollama serve'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (локальный OpenAI API)',
    kind: 'local',
    apiFormat: 'openai',
    defaultEndpoint: 'http://localhost:1234/v1',
    defaultModel: 'qwen2.5-7b-instruct',
    popularModels: [
      'qwen2.5-7b-instruct',
      'meta-llama-3.1-8b-instruct',
      'mistral-7b-instruct-v0.3',
      'deepseek-r1-distill-qwen-7b'
    ],
    requiresApiKey: false,
    description: 'Настольное приложение LM Studio с локальным сервером формата OpenAI.',
    setupHint: 'В LM Studio откройте вкладку Developer -> Start Server и включите CORS.'
  },
  {
    id: 'vllm',
    name: 'vLLM / LocalAI / Jan (OpenAI API)',
    kind: 'local',
    apiFormat: 'openai',
    defaultEndpoint: 'http://localhost:8000/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    popularModels: [
      'Qwen/Qwen2.5-7B-Instruct',
      'meta-llama/Meta-Llama-3.1-8B-Instruct',
      'mistralai/Mistral-7B-Instruct-v0.3'
    ],
    requiresApiKey: false,
    description: 'Высокопроизводительный локальный инференс-сервер с OpenAI-совместимым API.',
    setupHint: 'Убедитесь, что сервер слушает порт и разрешает заголовки CORS.'
  },
  {
    id: 'custom_local',
    name: 'Другой локальный сервер (OpenAI-совместимый)',
    kind: 'local',
    apiFormat: 'openai',
    defaultEndpoint: 'http://localhost:8080/v1',
    defaultModel: 'local-model',
    popularModels: ['local-model', 'qwen2.5-7b-instruct', 'llama-3.1-8b-instruct'],
    requiresApiKey: false,
    description: 'Любой локальный или корпоративный сервер в локальной сети (llama.cpp, KoboldCpp, TabbyAPI).',
    setupHint: 'Укажите базовый URL до /v1 (например, http://192.168.1.50:8080/v1).'
  },

  // ---- Cloud / External APIs ----
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT API)',
    kind: 'api',
    apiFormat: 'openai',
    defaultEndpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    popularModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o3-mini'],
    requiresApiKey: true,
    description: 'Официальный API OpenAI (GPT-4o / GPT-4.1).',
    setupHint: 'Требуется API-ключ OpenAI (Bearer sk-...).'
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude API',
    kind: 'api',
    apiFormat: 'anthropic',
    defaultEndpoint: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-7-sonnet-20250219',
    popularModels: [
      'claude-sonnet-4-20250514',
      'claude-3-7-sonnet-20250219',
      'claude-3-5-haiku-20241022'
    ],
    requiresApiKey: true,
    description: 'API Anthropic Claude для подробных нормативных документов.',
    setupHint: 'Требуется ключ Anthropic (x-api-key: sk-ant-...).'
  },
  {
    id: 'gemini',
    name: 'Google Gemini API',
    kind: 'api',
    apiFormat: 'gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    popularModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    requiresApiKey: true,
    description: 'API моделей Google Gemini с большим контекстным окном.',
    setupHint: 'Требуется API-ключ Google AI (AIza...).'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek API',
    kind: 'api',
    apiFormat: 'openai',
    defaultEndpoint: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    popularModels: ['deepseek-chat', 'deepseek-reasoner'],
    requiresApiKey: true,
    description: 'Официальный OpenAI-совместимый API DeepSeek.',
    setupHint: 'Требуется API-ключ DeepSeek.'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter API (единый шлюз моделей)',
    kind: 'api',
    apiFormat: 'openai',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    popularModels: [
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-2.5-flash',
      'qwen/qwen-2.5-72b-instruct',
      'deepseek/deepseek-chat'
    ],
    requiresApiKey: true,
    description: 'Агрегатор OpenAI, Claude, Gemini, Qwen и DeepSeek через один ключ.',
    setupHint: 'Требуется API-ключ OpenRouter (sk-or-...).'
  },
  {
    id: 'groq',
    name: 'Groq Cloud API',
    kind: 'api',
    apiFormat: 'openai',
    defaultEndpoint: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    popularModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'qwen-qwq-32b',
      'mixtral-8x7b-32768'
    ],
    requiresApiKey: true,
    description: 'Сверхбыстрый облачный API для открытых моделей Llama и Qwen.',
    setupHint: 'Требуется API-ключ Groq (gsk_...).'
  },
  {
    id: 'custom_api',
    name: 'Другой внешний API (OpenAI-совместимый)',
    kind: 'api',
    apiFormat: 'openai',
    defaultEndpoint: 'https://api.example.com/v1',
    defaultModel: 'gpt-4o-mini',
    popularModels: ['gpt-4o-mini', 'yandexgpt', 'GigaChat'],
    requiresApiKey: true,
    description: 'Корпоративный прокси, YandexGPT/GigaChat шлюз или иной совместимый API.',
    setupHint: 'Укажите базовый URL (/v1), имя модели и Bearer-токен.'
  }
];

export function getLLMProviderPreset(providerId?: string): LLMProviderPreset {
  return (
    LLM_PROVIDER_PRESETS.find((p) => p.id === providerId) ||
    LLM_PROVIDER_PRESETS[0]
  );
}

export function normalizeLLMConfig(raw?: Partial<LLMConfig> | null): LLMConfig {
  const preset = getLLMProviderPreset(raw?.providerId);
  return {
    providerId: raw?.providerId || preset.id,
    providerKind: raw?.providerKind || preset.kind,
    apiFormat: raw?.apiFormat || preset.apiFormat,
    endpoint: raw?.endpoint || preset.defaultEndpoint,
    model: raw?.model || preset.defaultModel,
    apiKey: raw?.apiKey || '',
    timeoutMs: typeof raw?.timeoutMs === 'number' && raw.timeoutMs > 0 ? raw.timeoutMs : 45000,
    temperature: typeof raw?.temperature === 'number' ? raw.temperature : 0.3,
    status: raw?.status || 'idle',
    lastChecked: raw?.lastChecked,
    availableModels:
      Array.isArray(raw?.availableModels) && raw.availableModels.length > 0
        ? raw.availableModels
        : preset.popularModels,
    errorMessage: raw?.errorMessage
  };
}
