import { AttachedDoc, LegalEntityProfile, LLMConfig, Row, Tab, Tag } from '../types/database';
import { getLLMProviderPreset, normalizeLLMConfig } from '../data/llmProviders';

export interface OllamaModelInfo {
  name: string;
  modified_at?: string;
  size?: number;
}

export interface DocumentGenerationParams {
  tab: Tab;
  row: Row;
  templateTitle: string;
  templateRequirements: string;
  attachedDocs: AttachedDoc[];
  tags: Tag[];
  allTabs: Tab[];
  entityProfile?: LegalEntityProfile;
  customInstructions?: string;
  llmConfig: LLMConfig;
  anonymizePii?: boolean;
}

export interface LLMConnectionResult {
  ok: boolean;
  models: string[];
  error?: string;
}

function normalizeEndpoint(endpoint: string): string {
  return String(endpoint || '').trim().replace(/\/+$/, '');
}

const PII_COLUMN_ID_FRAGMENTS = [
  'fio',
  'worker',
  'victim',
  'instructor',
  'snils',
  'inn',
  'passport',
  'phone',
  'email',
  'address',
  'tab_num',
  'birth'
];

/**
 * Что именно скрывается перед отправкой в облачную LLM и чего эта защита НЕ делает.
 * Текст показывается в ИИ-студии и в README, чтобы не создавать ложного чувства
 * полной анонимности.
 */
export const PII_MASKING_NOTES =
  'Скрываются: ФИО и контакты в колонках, распознанных как персональные данные (ФИО, сотрудник, СНИЛС, таб. №, телефон, e-mail, адрес, ИНН), а также СНИЛС, e-mail, телефон и ИНН внутри текста. НЕ скрываются: имена, вписанные в свободный текст или в колонки с нестандартными названиями, и данные самой организации. Если это критично — используйте локальную модель (Ollama): данные не покидают компьютер.';

function maskFreeTextPii(input: string): string {
  return input
    .replace(/\b\d{3}-\d{3}-\d{3}[-\s]\d{2}\b/g, '[СНИЛС скрыт]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[Email скрыт]')
    .replace(/(?:\+7|8)[\s()-]*(?:\d[\s()-]*){10}\b/g, '[Телефон скрыт]')
    .replace(/\bИНН\s*:?\s*\d{10,12}\b/gi, 'ИНН [скрыт]');
}

function isPiiColumn(colId: string, colName: string): boolean {
  const lowerId = colId.toLowerCase();
  if (PII_COLUMN_ID_FRAGMENTS.some((frag) => lowerId.includes(frag))) return true;
  return /фио|снилс|паспорт|телефон|почт|e-?mail|адрес|инн|табельный|дата\s*рождения|сотрудник|работник|пострадавш|физлицо|пациент/i.test(
    colName
  );
}

export function maskPiiColumnValue(colId: string, colName: string, rawVal: unknown): string {
  if (rawVal === undefined || rawVal === null || rawVal === '') return '—';
  const str = String(rawVal);
  if (isPiiColumn(colId, colName)) {
    if (/снилс|snils/i.test(colId + ' ' + colName)) return '[СНИЛС скрыт]';
    if (/таб|tab_num/i.test(colId + ' ' + colName)) return '[Таб.№ скрыт]';
    if (/телефон|phone/i.test(colId + ' ' + colName)) return '[Телефон скрыт]';
    if (/email|почт/i.test(colId + ' ' + colName)) return '[Email скрыт]';
    if (/адрес|address/i.test(colId + ' ' + colName)) return '[Адрес скрыт]';
    return '[ФИО скрыто (ПДн)]';
  }
  return maskFreeTextPii(str);
}

const maskColumnValue = maskPiiColumnValue;

export function shouldAnonymizePii(params: Pick<DocumentGenerationParams, 'llmConfig' | 'anonymizePii'>): boolean {
  if (typeof params.anonymizePii === 'boolean') return params.anonymizePii;
  return normalizeLLMConfig(params.llmConfig).providerKind === 'api';
}

export interface PiiRehydrationResult {
  text: string;
  restoredCount: number;
  replacedTokens: string[];
}

export interface RowPiiContext {
  fio?: string;
  snils?: string;
  tabNum?: string;
  phone?: string;
  email?: string;
  address?: string;
  inn?: string;
}

export function extractRowPiiContext(
  tab: Tab,
  row: Row,
  entityProfile?: LegalEntityProfile,
  allTabs?: Tab[]
): RowPiiContext {
  const ctx: RowPiiContext = {};

  const inspectRow = (sourceTab: Tab, sourceRow: Row) => {
    for (const col of sourceTab.columns) {
      const val = String(sourceRow[col.id] ?? '').trim();
      if (!val) continue;
      const key = `${col.id} ${col.name}`.toLowerCase();
      if (!ctx.snils && /снилс|snils/i.test(key)) ctx.snils = val;
      else if (!ctx.tabNum && /таб|tab_num/i.test(key)) ctx.tabNum = val;
      else if (!ctx.phone && /телефон|phone/i.test(key)) ctx.phone = val;
      else if (!ctx.email && /email|e-mail|почт/i.test(key)) ctx.email = val;
      else if (!ctx.address && /адрес|address/i.test(key)) ctx.address = val;
      else if (!ctx.inn && /\bинн\b|inn/i.test(key)) ctx.inn = val;
      else if (
        !ctx.fio &&
        /фио|fio|worker|victim|instructor|сотрудник|работник|пострадавш/i.test(key)
      ) {
        ctx.fio = val;
      }
    }
  };

  inspectRow(tab, row);

  // If the target row is from a secondary module (e.g. medical/PPE), enrich missing PII from Employees master row locally.
  if (allTabs && ctx.fio) {
    const empTab = allTabs.find((t) => t.moduleId === 'employees' || t.id === 'tab_employees');
    if (empTab && empTab.id !== tab.id) {
      const fioColId =
        empTab.columns.find((c) => c.id === 'emp_fio' || /фио/i.test(c.name))?.id || 'emp_fio';
      const empMatch = empTab.rows.find(
        (r) => String(r[fioColId] ?? '').trim().toLowerCase() === ctx.fio!.toLowerCase()
      );
      if (empMatch) {
        inspectRow(empTab, empMatch);
      }
    }
  }

  if (!ctx.phone && entityProfile?.phone) ctx.phone = entityProfile.phone;
  if (!ctx.email && entityProfile?.email) ctx.email = entityProfile.email;
  if (!ctx.address && entityProfile?.legalAddress) ctx.address = entityProfile.legalAddress;
  if (!ctx.inn && entityProfile?.inn) ctx.inn = entityProfile.inn;

  return ctx;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rehydratePiiInText(
  text: string,
  params: {
    tab: Tab;
    row: Row;
    entityProfile?: LegalEntityProfile;
    allTabs?: Tab[];
  }
): PiiRehydrationResult {
  if (!text) {
    return { text, restoredCount: 0, replacedTokens: [] };
  }

  const ctx = extractRowPiiContext(params.tab, params.row, params.entityProfile, params.allTabs);
  const profile = params.entityProfile;

  const fullOrg = profile?.fullName?.trim() || profile?.shortName?.trim() || '';
  const shortOrg = profile?.shortName?.trim() || profile?.fullName?.trim() || '';
  const orgRequisites =
    profile && (profile.inn || profile.kpp || profile.ogrn)
      ? `${profile.inn || '—'} / ${profile.kpp || '—'} / ${profile.ogrn || '—'}`
      : '';
  const director = profile?.directorFio?.trim() || '';

  const replacements: Array<[string, string]> = [];
  if (ctx.fio) {
    replacements.push(['[ФИО скрыто (ПДн)]', ctx.fio]);
    replacements.push(['[ФИО скрыто]', ctx.fio]);
  }
  if (ctx.snils) replacements.push(['[СНИЛС скрыт]', ctx.snils]);
  if (ctx.tabNum) replacements.push(['[Таб.№ скрыт]', ctx.tabNum]);
  if (ctx.phone) replacements.push(['[Телефон скрыт]', ctx.phone]);
  if (ctx.email) replacements.push(['[Email скрыт]', ctx.email]);
  if (ctx.address) replacements.push(['[Адрес скрыт]', ctx.address]);
  if (fullOrg) replacements.push(['[Организация скрыта]', fullOrg]);
  if (shortOrg) replacements.push(['[Организация]', shortOrg]);
  if (ctx.inn) {
    replacements.push(['ИНН [скрыт]', `ИНН ${ctx.inn}`]);
    replacements.push(['[ИНН скрыт]', ctx.inn]);
  }
  if (orgRequisites) replacements.push(['[Скрыты]', orgRequisites]);
  if (director) replacements.push(['[Руководитель скрыт]', director]);

  let result = text;
  let restoredCount = 0;
  const replacedTokens: string[] = [];

  for (const [token, value] of replacements) {
    const regex = new RegExp(escapeRegExp(token), 'g');
    const matches = result.match(regex);
    if (matches && matches.length > 0) {
      result = result.replace(regex, value);
      restoredCount += matches.length;
      replacedTokens.push(token);
    }
  }

  return { text: result, restoredCount, replacedTokens };
}

export const ollamaService = {
  /**
   * Test connection to selected LLM provider (local Ollama/LM Studio/vLLM or Cloud API)
   */
  async checkConnection(
    configOrEndpoint: Partial<LLMConfig> | string,
    timeoutMs = 8000
  ): Promise<LLMConnectionResult> {
    const config =
      typeof configOrEndpoint === 'string'
        ? normalizeLLMConfig({ endpoint: configOrEndpoint })
        : normalizeLLMConfig(configOrEndpoint);

    const preset = getLLMProviderPreset(config.providerId);
    const cleanEndpoint = normalizeEndpoint(config.endpoint);

    if (!cleanEndpoint) {
      return {
        ok: false,
        models: [],
        error: 'Не указан URL-адрес API провайдера.'
      };
    }

    if (preset.requiresApiKey && !String(config.apiKey || '').trim()) {
      return {
        ok: false,
        models: [],
        error: `Для провайдера «${preset.name}» требуется указать API-ключ.`
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (config.apiFormat === 'ollama') {
        const response = await fetch(`${cleanEndpoint}/api/tags`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
          return {
            ok: false,
            models: [],
            error: `Сервер вернул ошибку HTTP ${response.status}: ${response.statusText || 'ошибка запроса'}`
          };
        }

        const data = await response.json();
        const models = (data.models || [])
          .map((m: any) => m.name || m.model || '')
          .filter(Boolean);
        return {
          ok: true,
          models: models.length > 0 ? models : preset.popularModels
        };
      }

      if (config.apiFormat === 'gemini') {
        const rawApiKey = String(config.apiKey || '').trim();
        const response = await fetch(`${cleanEndpoint}/models`, {
          method: 'GET',
          headers: {
            'x-goog-api-key': rawApiKey
          },
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          return {
            ok: false,
            models: [],
            error: `Gemini API вернул HTTP ${response.status}: ${errBody.slice(0, 180) || response.statusText}`
          };
        }

        const data = await response.json().catch(() => ({}));
        const models = Array.isArray(data.models)
          ? data.models
              .map((m: any) => String(m.name || '').replace(/^models\//, ''))
              .filter((id: string) => id.includes('gemini'))
          : [];
        return {
          ok: true,
          models: models.length > 0 ? models : preset.popularModels
        };
      }

      if (config.apiFormat === 'anthropic') {
        const response = await fetch(`${cleanEndpoint}/models`, {
          method: 'GET',
          headers: {
            'x-api-key': String(config.apiKey || '').trim(),
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          return {
            ok: false,
            models: [],
            error: `Anthropic API вернул HTTP ${response.status}: ${errBody.slice(0, 180) || response.statusText}`
          };
        }

        const data = await response.json().catch(() => ({}));
        const models = Array.isArray(data.data)
          ? data.data.map((m: any) => m.id).filter(Boolean)
          : [];
        return {
          ok: true,
          models: models.length > 0 ? models : preset.popularModels
        };
      }

      // OpenAI-compatible (LM Studio, vLLM, LocalAI, OpenAI, DeepSeek, OpenRouter, Groq, Custom)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (String(config.apiKey || '').trim()) {
        headers['Authorization'] = `Bearer ${String(config.apiKey).trim()}`;
      }

      const response = await fetch(`${cleanEndpoint}/models`, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        return {
          ok: false,
          models: [],
          error: `Сервер (${preset.name}) вернул HTTP ${response.status}: ${errBody.slice(0, 180) || response.statusText}`
        };
      }

      const data = await response.json().catch(() => ({}));
      const models = Array.isArray(data.data)
        ? data.data.map((m: any) => m.id || m.name).filter(Boolean)
        : [];
      return {
        ok: true,
        models: models.length > 0 ? models : preset.popularModels
      };
    } catch (err: any) {
      clearTimeout(timeout);

      const baseMsg =
        err?.name === 'AbortError'
          ? 'Превышен тайм-аут ожидания ответа от сервера LLM'
          : err?.message || 'Не удалось установить соединение с указанным сервером';

      const hint =
        config.providerKind === 'local'
          ? ` Проверьте, что локальный сервер (${preset.name}) запущен на ${cleanEndpoint} и разрешает CORS.`
          : ' Проверьте URL-адрес, API-ключ, доступ в интернет и политику CORS.';

      return {
        ok: false,
        models: [],
        error: `${baseMsg}.${hint}`
      };
    }
  },

  /**
   * Build the structured prompt for occupational safety document generation
   */
  buildPrompt(params: DocumentGenerationParams): string {
    const { tab, row, templateTitle, templateRequirements, attachedDocs, entityProfile } = params;
    const anonymize = shouldAnonymizePii(params);

    const fieldLines = tab.columns
      .map((col) => {
        const val = anonymize
          ? maskColumnValue(col.id, col.name, row[col.id])
          : row[col.id] !== undefined
            ? row[col.id]
            : '—';
        return `• ${col.name}: ${val}`;
      })
      .join('\n');

    const normLines = attachedDocs
      .filter((d) => d.contentSnippet)
      .map((d) => `[Нормативный документ: ${d.fileName}]\n${d.contentSnippet}`)
      .join('\n\n');

    const orgHeader = entityProfile
      ? anonymize
        ? `РЕКВИЗИТЫ ОРГАНИЗАЦИИ-РАБОТОДАТЕЛЯ (обезличены по 152-ФЗ):
• Полное наименование: [Организация скрыта]
• Краткое наименование: [Организация]
• ИНН / КПП / ОГРН: [Скрыты]
• Юридический адрес: [Адрес скрыт]
• Руководитель: [Руководитель скрыт]\n\n`
        : `РЕКВИЗИТЫ ОРГАНИЗАЦИИ-РАБОТОДАТЕЛЯ:
• Полное наименование: ${entityProfile.fullName || entityProfile.shortName}
• Краткое наименование: ${entityProfile.shortName || entityProfile.fullName}
• ИНН / КПП / ОГРН: ${entityProfile.inn || '—'} / ${entityProfile.kpp || '—'} / ${entityProfile.ogrn || '—'}
• Юридический адрес: ${entityProfile.legalAddress || '—'}
• Руководитель: ${entityProfile.directorFio || '—'}\n\n`
      : '';

    const instructionsText = anonymize
      ? maskFreeTextPii(params.customInstructions || '')
      : params.customInstructions || '';

    const requirementsText = anonymize
      ? maskFreeTextPii(templateRequirements || '')
      : templateRequirements || '';

    return `Ты — главный специалист и юридический консультант по охране труда в РФ.
Твоя задача — составить официальный, юридически выренный локальный нормативный документ: "${templateTitle}".

${orgHeader}ИДЕНТИФИКАЦИОННЫЕ ДАННЫЕ ИЗ БАЗЫ:
Таблица: ${tab.name}
${fieldLines}

ПРИКРЕПЛЕННАЯ НОРМАТИВНАЯ БАЗА (СП, ГОСТ, Приказы Минтруда):
${normLines || 'Использовать общие стандарты ТК РФ, Приказ Минтруда №772н, Приказ Минздрава №29н.'}

ТРЕБОВАНИЯ К ДОКУМЕНТУ И ШАБЛОН:
${requirementsText}

ДОПОЛНИТЕЛЬНЫЕ УКАЗАНИЯ ПОЛЬЗОВАТЕЛЯ:
${instructionsText || 'Сформировать полный текст документа с реквизитами организации, вводной частью, пунктами приказа/инструкции, ссылками на законы и местом для подписей.'}

ПРАВИЛА ОФОРМЛЕНИЯ:
1. Пиши строгим деловым канцелярским языком в соответствии с ГОСТ Р 7.0.97-2016.
2. Не используй вымышленные статьи законов, опирайся на действующее законодательство РФ по охране труда.
3. ${anonymize ? 'Сохраняй маркеры вида [ФИО скрыто (ПДн)] или оставь поля ФИО/реквизитов как ________________ для последующей подстановки.' : 'Полностью заполни реквизиты, ФИО и должности на основе переданных данных.'}
4. Выведи готовый текст документа от заголовка до подписей. Без вступительных фраз вроде "Вот ваш документ".`;
  },

  /**
   * Generate document via configured LLM provider or deterministic offline fallback generator
   */
  async generateDocument(
    params: DocumentGenerationParams
  ): Promise<{
    text: string;
    rawMaskedText?: string;
    piiRehydratedCount?: number;
    isSimulated: boolean;
    modelUsed: string;
    errorMessage?: string;
  }> {
    const anonymize = shouldAnonymizePii(params);
    const prompt = ollamaService.buildPrompt(params);
    const config = normalizeLLMConfig(params.llmConfig);
    const cleanEndpoint = normalizeEndpoint(config.endpoint);
    const preset = getLLMProviderPreset(config.providerId);

    const finalizeResponse = (rawText: string, modelUsed: string) => {
      const trimmed = String(rawText || '').trim();
      if (!anonymize) {
        return {
          text: trimmed,
          piiRehydratedCount: 0,
          isSimulated: false,
          modelUsed
        };
      }
      const restored = rehydratePiiInText(trimmed, {
        tab: params.tab,
        row: params.row,
        entityProfile: params.entityProfile,
        allTabs: params.allTabs
      });
      return {
        text: restored.text,
        rawMaskedText: trimmed,
        piiRehydratedCount: restored.restoredCount,
        isSimulated: false,
        modelUsed
      };
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 45000);

    try {
      if (config.apiFormat === 'ollama') {
        const response = await fetch(`${cleanEndpoint}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: config.model || preset.defaultModel,
            prompt,
            stream: false,
            options: { temperature: config.temperature ?? 0.3 }
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (response.ok) {
          const data = await response.json();
          if (data.response) {
            return finalizeResponse(String(data.response), `${preset.name}: ${config.model}`);
          }
        }
      } else if (config.apiFormat === 'gemini') {
        const rawApiKey = String(config.apiKey || '').trim();
        if (rawApiKey) {
          const response = await fetch(
            `${cleanEndpoint}/models/${encodeURIComponent(config.model || preset.defaultModel)}:generateContent`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': rawApiKey
              },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: config.temperature ?? 0.3 }
              }),
              signal: controller.signal
            }
          );
          clearTimeout(timeout);
          if (response.ok) {
            const data = await response.json();
            const text = data?.candidates?.[0]?.content?.parts
              ?.map((p: any) => p.text || '')
              .join('')
              .trim();
            if (text) {
              return finalizeResponse(text, `${preset.name}: ${config.model}`);
            }
          }
        } else {
          clearTimeout(timeout);
        }
      } else if (config.apiFormat === 'anthropic') {
        if (String(config.apiKey || '').trim()) {
          const response = await fetch(`${cleanEndpoint}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': String(config.apiKey || '').trim(),
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
              model: config.model || preset.defaultModel,
              max_tokens: 4096,
              temperature: config.temperature ?? 0.3,
              messages: [{ role: 'user', content: prompt }]
            }),
            signal: controller.signal
          });
          clearTimeout(timeout);
          if (response.ok) {
            const data = await response.json();
            const text = Array.isArray(data?.content)
              ? data.content.map((c: any) => c.text || '').join('').trim()
              : '';
            if (text) {
              return finalizeResponse(text, `${preset.name}: ${config.model}`);
            }
          }
        } else {
          clearTimeout(timeout);
        }
      } else {
        // OpenAI-compatible chat/completions
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (String(config.apiKey || '').trim()) {
          headers['Authorization'] = `Bearer ${String(config.apiKey).trim()}`;
        }
        const canAttempt = !preset.requiresApiKey || Boolean(headers['Authorization']);
        if (canAttempt) {
          const response = await fetch(`${cleanEndpoint}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: config.model || preset.defaultModel,
              temperature: config.temperature ?? 0.3,
              messages: [{ role: 'user', content: prompt }]
            }),
            signal: controller.signal
          });
          clearTimeout(timeout);
          if (response.ok) {
            const data = await response.json();
            const text = data?.choices?.[0]?.message?.content?.trim();
            if (text) {
              return finalizeResponse(text, `${preset.name}: ${config.model}`);
            }
          }
        } else {
          clearTimeout(timeout);
        }
      }
    } catch (e: any) {
      clearTimeout(timeout);
      console.warn('LLM call failed, switching to built-in deterministic generator', e);
    }

    const simulated = ollamaService.generateDomainDocumentFallback(params);
    return {
      text: simulated,
      piiRehydratedCount: 0,
      isSimulated: true,
      modelUsed: 'Встроенный теговый генератор ОТ-База (без LLM)'
    };
  },

  /**
   * Realistic offline domain template generator using active LegalEntityProfile
   */
  generateDomainDocumentFallback(params: DocumentGenerationParams): string {
    const { row, templateTitle, entityProfile } = params;
    const fullOrg = entityProfile?.fullName || entityProfile?.shortName || 'ОРГАНИЗАЦИЯ';
    const shortOrg = entityProfile?.shortName || fullOrg;
    const director = entityProfile?.directorFio || 'Руководитель организации';
    const requisitesLine = entityProfile
      ? `ИНН ${entityProfile.inn || '—'}, ОГРН ${entityProfile.ogrn || '—'}${entityProfile.legalAddress ? `, ${entityProfile.legalAddress}` : ''}`
      : '';

    const fio = row.emp_fio || row.med_worker || row.siz_worker || row.inst_worker || 'Ответственный работник';
    const pos = row.emp_pos || row.med_pos || row.pos_title || row.siz_pos || 'Работник по штатному расписанию';
    const dept = row.emp_dept || row.pos_dept || 'Подразделение';
    const dateStr = new Date().toLocaleDateString('ru-RU');

    return `${fullOrg.toUpperCase()}
${requisitesLine ? requisitesLine + '\n' : ''}
УТВЕРЖДАЮ:
Руководитель ${shortOrg}
________________ / ${director} /
«${dateStr}»

${templateTitle.toUpperCase()}
ДЛЯ ДОЛЖНОСТИ: ${String(pos).toUpperCase()}
(Подразделение: ${dept})

1. ОБЩИЕ ТРЕБОВАНИЯ ОХРАНЫ ТРУДА
1.1. К самостоятельной работе по профессии «${pos}» в ${shortOrg} допускаются лица не моложе 18 лет, прошедшие обязательный предварительный (периодический) медицинский осмотр в соответствии с Приказом Минздрава России № 29н, не имеющие медицинских противопоказаний, прошедшие вводный и первичный инструктажи на рабочем месте, обучение по охране труда и стажировку.
1.2. Работник обязан соблюдать Правила внутреннего трудового распорядка, установленные режимы труда и отдыха.
1.3. В процессе выполнения работ на работника могут воздействовать опасные и вредные производственные факторы, выявленные в ходе СОУТ и оценки профессиональных рисков.
1.4. Работник обязан использовать выданные сертифицированные средства индивидуальной защиты (СИЗ) в соответствии с Едиными типовыми нормами (Приказ Минтруда РФ № 766н).

2. ТРЕБОВАНИЯ ОХРАНЫ ТРУДА ПЕРЕД НАЧАЛОМ РАБОТЫ
2.1. Надеть спецодежду, спецобувь и застегнуть на все пуговицы, подготовить средства защиты.
2.2. Осмотреть рабочее место, убрать посторонние предметы, освободить проходы.
2.3. Проверить исправность рабочего оборудования, заземления, вентиляции и ограждений.
2.4. Обо всех обнаруженных неисправностях немедленно сообщить непосредственному руководителю (${dept}).

3. ТРЕБОВАНИЯ ОХРАНЫ ТРУДА ВО ВРЕМЯ РАБОТЫ
3.1. Выполнять только ту работу, которая поручена непосредственным руководителем и по которой пройден инструктаж.
3.2. Пользоваться только исправным инструментом и приспособлениями, соблюдать технологическую последовательность операций.
3.3. Не допускать присутствия посторонних лиц в зоне производства опасных работ.

4. ТРЕБОВАНИЯ ОХРАНЫ ТРУДА В АВАРИЙНЫХ СИТУАЦИЯХ
4.1. При возникновении неисправности оборудования или угрозе аварии немедленно прекратить работу, отключить питание и оповестить окружающих.
4.2. При несчастном случае оказать первую помощь пострадавшему (${fio}), вызвать скорую медицинскую помощь по тел. 112 и сохранить обстановку на месте происшествия.

5. ТРЕБОВАНИЯ ОХРАНЫ ТРУДА ПО ОКОНЧАНИИ РАБОТЫ
5.1. Отключить от электросети технологическое оборудование и инструмент.
5.2. Привести в порядок рабочее место, убрать инструмент в отведенные места хранения.
5.3. Снять спецодежду, убрать в шкаф, вымыть лицо и руки с мылом.
5.4. Сообщить руководителю подразделения обо всех замеченных недостатках в обеспечении безопасности труда.

Составлено в: ${shortOrg}
Ознакомлен(а), экземпляр на руки получил(а):
${pos}: ________________ (${fio})
Дата: «____» ____________ 2026 г.`;
  }
};
