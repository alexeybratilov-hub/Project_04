import { ObligationKind } from '../types/database';

/**
 * Модуль = независимый этап/точка контроля. Модуль владеет одним или несколькими
 * табами, своими шаблонами документов и правилами обязательств по работнику.
 * Ставится/снимается целиком; данные при снятии не удаляются, а скрываются.
 */
export interface ObligationRule {
  /** Стабильный ключ требования — используется для идемпотентности. */
  id: string;
  moduleId: string;
  title: string;
  kind: ObligationKind;
  templateId?: string;
  /** Смещение срока от даты приёма (дни, календарные). */
  offsetDays: number;
  /** Периодичность в месяцах: после «Выполнено» создаётся следующая задача. */
  periodicityMonths?: number;
  legalBasis?: string;
  /** Контрольная точка: проверка полноты, а не календарный срок. */
  controlPoint?: boolean;
}

export interface ModuleDefinition {
  id: string;
  title: string;
  description: string;
  icon: 'staffing' | 'employees' | 'sout' | 'medical' | 'ppe' | 'briefings' | 'incidents';
  tabId: string;
  tabName: string;
  /** Базовые модули включены в новой базе по умолчанию. */
  base?: boolean;
}

const POST_2464 = 'Постановление Правительства РФ № 2464';
const ORDER_29N = 'Приказ Минздрава РФ № 29н';

export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    id: 'staffing',
    title: 'Штатное расписание',
    description:
      'Должности, подразделения, оклады и класс условий труда. На этот модуль ссылаются все остальные: требования зависят от должности и вредности.',
    icon: 'staffing',
    tabId: 'tab_positions',
    tabName: 'Штатное расписание',
    base: true
  },
  {
    id: 'employees',
    title: 'Сотрудники',
    description:
      'Мастер-реестр работников: ФИО, табельный номер, должность, подразделение, дата приёма. Источник обязательств для всех этапов.',
    icon: 'employees',
    tabId: 'tab_employees',
    tabName: 'Список работников',
    base: true
  },
  {
    id: 'briefings',
    title: 'Инструктажи и проверка знаний',
    description:
      'Вводный, первичный и повторный инструктажи, проверка знаний требований охраны труда. Сроки считаются от даты приёма и периодичности.',
    icon: 'briefings',
    tabId: 'tab_instructions',
    tabName: 'Инструктажи по ОТ'
  },
  {
    id: 'medical',
    title: 'Медосмотры',
    description:
      'Направления на медосмотр, даты прохождения, заключения и периодичность осмотров по вредным факторам.',
    icon: 'medical',
    tabId: 'tab_med',
    tabName: 'Медосмотры и МО'
  },
  {
    id: 'ppe',
    title: 'Выдача СИЗ',
    description: 'Карточки выдачи средств индивидуальной защиты, нормы, срок носки и даты следующей выдачи.',
    icon: 'ppe',
    tabId: 'tab_siz',
    tabName: 'Выдача СИЗ'
  },
  {
    id: 'sout',
    title: 'СОУТ и вредные факторы',
    description: 'Вредные и опасные производственные факторы, класс условий труда, нормативная база по Приказу 29н.',
    icon: 'sout',
    tabId: 'tab_factors',
    tabName: 'Вредные факторы (СОУТ)'
  },
  {
    id: 'incidents',
    title: 'Несчастные случаи',
    description: 'Регистрация микротравм и несчастных случаев, обстоятельства и принятые меры.',
    icon: 'incidents',
    tabId: 'tab_incidents',
    tabName: 'Несчастные случаи и микротравмы'
  }
];

export const MODULE_BY_ID: Record<string, ModuleDefinition> = MODULE_DEFINITIONS.reduce(
  (acc, module) => {
    acc[module.id] = module;
    return acc;
  },
  {} as Record<string, ModuleDefinition>
);

export const DEFAULT_INSTALLED_MODULES = MODULE_DEFINITIONS.filter((m) => m.base).map((m) => m.id);

/**
 * Правила обязательств при приёме на работу.
 * Сроки — типовые требования; их можно переопределить в карточке работника.
 */
export const HIRE_OBLIGATION_RULES: ObligationRule[] = [
  {
    id: 'briefing_intro',
    moduleId: 'briefings',
    title: 'Вводный инструктаж по охране труда',
    kind: 'deadline',
    offsetDays: 0,
    legalBasis: `${POST_2464}, п. 10`
  },
  {
    id: 'briefing_initial',
    moduleId: 'briefings',
    title: 'Первичный инструктаж на рабочем месте',
    kind: 'deadline',
    offsetDays: 30,
    legalBasis: `${POST_2464}, п. 13`
  },
  {
    id: 'knowledge_test',
    moduleId: 'briefings',
    title: 'Проверка знаний требований охраны труда',
    kind: 'document',
    templateId: 'tpl_protocol_knowledge',
    offsetDays: 30,
    periodicityMonths: 12,
    legalBasis: `${POST_2464}, п. 32`
  },
  {
    id: 'med_referral',
    moduleId: 'medical',
    title: 'Направление на предварительный медосмотр',
    kind: 'document',
    templateId: 'tpl_med_referral',
    offsetDays: 0,
    periodicityMonths: 12,
    legalBasis: `${ORDER_29N}`
  },
  {
    id: 'ppe_card',
    moduleId: 'ppe',
    title: 'Карточка учёта выдачи СИЗ',
    kind: 'document',
    templateId: 'tpl_siz_card',
    offsetDays: 0,
    legalBasis: 'Приказ Минтруда РФ № 766н'
  },
  {
    id: 'periodic_briefing',
    moduleId: 'briefings',
    title: 'Повторный инструктаж по охране труда',
    kind: 'deadline',
    offsetDays: 180,
    periodicityMonths: 6,
    legalBasis: `${POST_2464}, п. 16`
  },
  {
    id: 'periodic_med',
    moduleId: 'medical',
    title: 'Периодический медосмотр',
    kind: 'deadline',
    offsetDays: 365,
    periodicityMonths: 12,
    legalBasis: `${ORDER_29N}`
  }
];

export const ALL_OBLIGATION_RULES: ObligationRule[] = [...HIRE_OBLIGATION_RULES];

export function getObligationRule(ruleId: string): ObligationRule | undefined {
  return ALL_OBLIGATION_RULES.find((rule) => rule.id === ruleId);
}
