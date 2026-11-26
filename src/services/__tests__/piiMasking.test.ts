import { describe, expect, it } from 'vitest';
import { maskPiiColumnValue, PII_MASKING_NOTES, shouldAnonymizePii } from '../ollamaService';
import type { LLMConfig } from '../../types/database';

const apiConfig = {
  providerKind: 'api',
  providerId: 'openai',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: ''
} as unknown as LLMConfig;

const localConfig = {
  providerKind: 'local',
  providerId: 'ollama',
  endpoint: 'http://127.0.0.1:11434',
  model: 'qwen2.5',
  apiKey: ''
} as unknown as LLMConfig;

describe('PII masking before cloud LLM', () => {
  it('masks values of a column recognised as personal data', () => {
    expect(maskPiiColumnValue('emp_fio', 'ФИО', 'Иванов Сергей Петрович')).toBe('[ФИО скрыто (ПДн)]');
    expect(maskPiiColumnValue('col_12', 'Сотрудник', 'Петров Алексей')).toBe('[ФИО скрыто (ПДн)]');
    expect(maskPiiColumnValue('col_13', 'СНИЛС', '123-456-789 00')).toBe('[СНИЛС скрыт]');
    expect(maskPiiColumnValue('col_14', 'Телефон', '+7 (999) 123-45-67')).toBe('[Телефон скрыт]');
  });

  it('masks sensitive values inside free text even in a neutral column', () => {
    const masked = maskPiiColumnValue(
      'col_20',
      'Примечание',
      'Позвонить 8 (999) 111-22-33, почта ivanov@example.ru, СНИЛС 111-222-333 44'
    );
    expect(masked).toContain('[Телефон скрыт]');
    expect(masked).toContain('[Email скрыт]');
    expect(masked).toContain('[СНИЛС скрыт]');
    expect(masked).not.toContain('111-222-333');
  });

  it('keeps neutral legal text as is', () => {
    const text = 'Приказ Минтруда России № 766н, ст. 214 ТК РФ';
    expect(maskPiiColumnValue('col_21', 'Основание', text)).toBe(text);
  });

  it('turns anonymisation on by default for cloud providers and off for local', () => {
    expect(shouldAnonymizePii({ llmConfig: apiConfig })).toBe(true);
    expect(shouldAnonymizePii({ llmConfig: localConfig })).toBe(false);
    expect(shouldAnonymizePii({ llmConfig: apiConfig, anonymizePii: false })).toBe(false);
  });

  it('documents the limits of masking', () => {
    expect(PII_MASKING_NOTES).toContain('НЕ скрываются');
    expect(PII_MASKING_NOTES).toContain('Ollama');
  });
});
