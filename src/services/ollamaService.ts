import { AttachedDoc, LLMConfig, Row, Tab, Tag } from '../types/database';

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
  customInstructions?: string;
  llmConfig: LLMConfig;
}

export const ollamaService = {
  /**
   * Test connection to Ollama server and fetch available models
   */
  async checkConnection(endpoint: string, timeoutMs = 8000): Promise<{ ok: boolean; models: string[]; error?: string }> {
    const cleanEndpoint = endpoint.replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // First attempt direct endpoint
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
          error: `Сервер вернул статус HTTP ${response.status}: ${response.statusText}`
        };
      }

      const data = await response.json();
      const models = (data.models || []).map((m: any) => m.name || m.model || '');
      return {
        ok: true,
        models: models.length > 0 ? models : ['qwen2.5:7b', 'llama3.1:8b', 'mistral:7b']
      };
    } catch (err: any) {
      clearTimeout(timeout);

      // If failed due to CORS or host unreachable
      let msg = err.name === 'AbortError' 
        ? 'Превышен тайм-аут ожидания ответа сервера' 
        : (err.message || 'Не удалось подключиться к localhost');
        
      return {
        ok: false,
        models: [],
        error: `${msg}. Убедитесь, что Ollama запущена (команда: ollama serve) и разрешен CORS (OLLAMA_ORIGINS=*).`
      };
    }
  },

  /**
   * Build the structured prompt for occupational safety document generation
   */
  buildPrompt(params: DocumentGenerationParams): string {
    const { tab, row, templateTitle, templateRequirements, attachedDocs, tags } = params;

    // Collect row field details
    const fieldLines = tab.columns.map((col) => {
      const val = row[col.id] !== undefined ? row[col.id] : '—';
      return `• ${col.name}: ${val}`;
    }).join('\n');

    // Collect normative acts snippets
    const normLines = attachedDocs
      .filter((d) => d.contentSnippet)
      .map((d) => `[Нормативный документ: ${d.fileName}]\n${d.contentSnippet}`)
      .join('\n\n');

    return `Ты — главный специалист и юридический консультант по охране труда в РФ.
Твоя задача — составить официальный, юридически выверенный локальный нормативный документ: "${templateTitle}".

ИДЕНТИФИКАЦИОННЫЕ ДАННЫЕ ИЗ БАЗЫ:
Таблица: ${tab.name}
${fieldLines}

ПРИКРЕПЛЕННАЯ НОРМАТИВНАЯ БАЗА (СП, ГОСТ, Приказы Минтруда):
${normLines || 'Использовать общие стандарты ТК РФ, Приказ Минтруда №772н, Приказ Минздрава №29н.'}

ТРЕБОВАНИЯ К ДОКУМЕНТУ И ШАБЛОН:
${templateRequirements}

ДОПОЛНИТЕЛЬНЫЕ УКАЗАНИЯ ПОЛЬЗОВАТЕЛЯ:
${params.customInstructions || 'Сформировать полный текст документа с реквизитами организации, вводной частью, пунктами приказа/инструкции, ссылками на законы и местом для подписей.'}

ПРАВИЛА ОФОРМЛЕНИЯ:
1. Пиши строгим деловым канцелярским языком в соответствии с ГОСТ Р 7.0.97-2016.
2. Не используй вымышленные статьи законов, опирайся на действующее законодательство РФ по охране труда.
3. Полностью заполни реквизиты, ФИО и должности на основе переданных данных.
4. Выведи готовый текст документа от заголовка до подписей. Без вступительных фраз вроде "Вот ваш документ".`;
  },

  /**
   * Generate document via Ollama or realistic offline deterministic template engine fallback
   */
  async generateDocument(params: DocumentGenerationParams): Promise<{ text: string; isSimulated: boolean; modelUsed: string }> {
    const prompt = ollamaService.buildPrompt(params);
    const { llmConfig } = params;
    const cleanEndpoint = llmConfig.endpoint.replace(/\/+$/, '');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), llmConfig.timeoutMs || 45000);

      const response = await fetch(`${cleanEndpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: llmConfig.model || 'qwen2.5:7b',
          prompt: prompt,
          stream: false,
          options: {
            temperature: llmConfig.temperature ?? 0.3
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        if (data.response) {
          return {
            text: data.response.trim(),
            isSimulated: false,
            modelUsed: llmConfig.model
          };
        }
      }
    } catch (e) {
      console.warn('Ollama direct call failed, switching to expert deterministic fallback generator', e);
    }

    // High-quality expert domain fallback generation (Offline mode when Ollama isn't currently running on port 11434)
    const simulated = ollamaService.generateDomainDocumentFallback(params);
    return {
      text: simulated,
      isSimulated: true,
      modelUsed: `${llmConfig.model} (Офлайн-генератор ОТ-База)`
    };
  },

  /**
   * Realistic offline domain template generator for Occupational Safety
   */
  generateDomainDocumentFallback(params: DocumentGenerationParams): string {
    const { tab, row, templateTitle } = params;
    const fio = row.emp_fio || row.med_worker || row.siz_worker || row.inst_worker || 'Иванов Сергей Петрович';
    const pos = row.emp_pos || row.med_pos || row.pos_title || row.siz_pos || 'Электрогазосварщик 5 разряда';
    const dept = row.emp_dept || row.pos_dept || 'Производственный цех №1';
    const dateStr = new Date().toLocaleDateString('ru-RU');

    return `ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «ПРОМТЕХСЕРВИС»

УТВЕРЖДАЮ:
Генеральный директор ООО «Промтехсервис»
________________ / И. В. Соколов /
«${dateStr}»

${templateTitle.toUpperCase()}
ДЛЯ ДОЛЖНОСТИ: ${pos.toUpperCase()}
(Подразделение: ${dept})

1. ОБЩИЕ ТРЕБОВАНИЯ ОХРАНЫ ТРУДА
1.1. К самостоятельной работе по профессии «${pos}» допускаются лица не моложе 18 лет, прошедшие обязательный предварительный (периодический) медицинский осмотр в соответствии с Приказом Минздрава России № 29н, не имеющие медицинских противопоказаний, прошедшие вводный и первичный инструктажи на рабочем месте, обучение по охране труда и стажировку.
1.2. Работник обязан соблюдать Правила внутреннего трудового распорядка, установленные режимы труда и отдыха.
1.3. В процессе выполнения работ на работника могут воздействовать следующие производственные факторы:
- Повышенная запыленность и загазованность рабочей зоны;
- Повышенный уровень шума и вибрации;
- Опасность поражения электрическим током;
- Физические перегрузки при перемещении грузов.
1.4. Работник обязан использовать выданные сертифицированные средства индивидуальной защиты (СИЗ) в соответствии с Едиными типовыми нормами (Приказ Минтруда РФ № 766н).

2. ТРЕБОВАНИЯ ОХРАНЫ ТРУДА ПЕРЕД НАЧАЛОМ РАБОТЫ
2.1. Надеть спецодежду, спецобувь и застегнуть на все пуговицы, подготовить средства защиты глаз и дыхания.
2.2. Осмотреть рабочее место, убрать посторонние предметы, освободить проходы.
2.3. Проверить исправность рабочего оборудования, заземления, вентиляции и ограждений.
2.4. Обо всех обнаруженных неисправностях немедленно сообщить непосредственному руководителю (${dept}).

3. ТРЕБОВАНИЯ ОХРАНЫ ТРУДА ВО ВРЕМЯ РАБОТЫ
3.1. Выполнять только ту работу, которая поручена непосредственным руководителем и по которой пройден инструктаж.
3.2. Пользоваться только исправным инструментом и приспособлениями, соблюдать технологическую последовательность операций.
3.3. Не допускать присутствия посторонних лиц в зоне производства опасных работ.

4. ТРЕБОВАНИЯ ОХРАНЫ ТРУДА В АВАРИЙНЫХ СИТУАЦИЯХ
4.1. При возникновении неисправности оборудования, угрозе аварии немедленно прекратить работу, отключить питание и оповестить окружающих.
4.2. При несчастном случае оказать первую помощь пострадавшему (${fio}), вызвать скорую медицинскую помощь по тел. 112 и сохранить обстановку на месте происшествия.

5. ТРЕБОВАНИЯ ОХРАНЫ ТРУДА ПО ОКОНЧАНИИ РАБОТЫ
5.1. Отключить от электросети технологическое оборудование и инструмент.
5.2. Привести в порядок рабочее место, убрать инструмент в отведенные места хранения.
5.3. Снять спецодежду, убрать в шкаф, вымыть лицо и руки с мылом, при необходимости принять душ.
5.4. Сообщить руководителю смены обо всех замеченных недостатках в обеспечении безопасности труда.

Разработал:
Специалист по охране труда: ________________ / А. С. Кузнецов /

Согласовано:
Руководитель подразделения: ________________ / ________________ /

С инструкцией ознакомлен, экземпляр на руки получил:
${pos}: ________________ (${fio})
Дата: «____» ____________ 2026 г.`;
  }
};
