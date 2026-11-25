import { EmployeeEventType, ObligationKind } from '../types/database';

/**
 * Модуль = независимый этап/точка контроля. Модуль владеет вкладкой, своими
 * шаблонами документов и правилами обязательств по работнику.
 * Ставится/снимается целиком; данные при снятии не удаляются, а скрываются.
 */
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

/** Контекст работника, влияющий на состав требований. */
export interface EmployeeContext {
  positionTitle?: string;
  soutClass?: string;
}

/** Условия применимости требования к работнику. */
export interface ObligationCondition {
  /** Подстроки должности (без регистра), при которых требование действует. */
  positionMatches?: string[];
  /** Подстроки должности, при которых требование НЕ действует (приоритет выше). */
  excludePositionMatches?: string[];
  /** Классы условий труда по СОУТ, при которых требование действует. */
  soutClassIn?: string[];
}

export interface ObligationRule {
  /** Стабильный ключ требования — используется для идемпотентности. */
  id: string;
  moduleId: string;
  /** Событие, которое порождает требование. */
  event: EmployeeEventType;
  title: string;
  kind: ObligationKind;
  templateId?: string;
  /** Смещение срока от даты события (дни, календарные). */
  offsetDays: number;
  /** Периодичность в месяцах: после «Выполнено» создаётся следующая задача. */
  periodicityMonths?: number;
  /** Периодичность, зависящая от класса условий труда (переопределяет periodicityMonths). */
  periodicityBySoutClass?: Record<string, number>;
  condition?: ObligationCondition;
  legalBasis?: string;
  /** Контрольная точка: проверка полноты, а не календарный срок. */
  controlPoint?: boolean;
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
      'Вводный, первичный, повторный и внеплановый инструктажи, проверка знаний требований охраны труда. Сроки считаются от даты события и периодичности.',
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
    description: 'Регистрация микротравм и несчастных случаев, обстоятельства, расследование и принятые меры.',
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

export const EMPLOYEE_EVENT_LABELS: Record<EmployeeEventType, string> = {
  hire: 'Приём на работу',
  transfer: 'Перевод',
  dismissal: 'Увольнение',
  incident: 'Несчастный случай'
};

/**
 * Матрица обязательств: событие → требования со сроками, периодичностью и НПА.
 * Условия позволяют учитывать должность и класс условий труда.
 */
export const OBLIGATION_RULES: ObligationRule[] = [
  // ---------- Приём на работу ----------
  {
    id: 'hire_order',
    moduleId: 'employees',
    event: 'hire',
    title: 'Приказ о приёме на работу',
    kind: 'document',
    templateId: 'tpl_hire_order',
    offsetDays: 0,
    legalBasis: 'ТК РФ, ст. 68'
  },
  {
    id: 'briefing_intro',
    moduleId: 'briefings',
    event: 'hire',
    title: 'Вводный инструктаж по охране труда',
    kind: 'deadline',
    offsetDays: 0,
    legalBasis: `${POST_2464}, п. 10`
  },
  {
    id: 'briefing_initial',
    moduleId: 'briefings',
    event: 'hire',
    title: 'Первичный инструктаж на рабочем месте',
    kind: 'deadline',
    offsetDays: 30,
    legalBasis: `${POST_2464}, п. 13`
  },
  {
    id: 'knowledge_test',
    moduleId: 'briefings',
    event: 'hire',
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
    event: 'hire',
    title: 'Направление на предварительный медосмотр',
    kind: 'document',
    templateId: 'tpl_med_referral',
    offsetDays: 0,
    periodicityMonths: 12,
    periodicityBySoutClass: { '2.0': 24, '3.1': 12, '3.2': 12, '3.3': 12, '3.4': 12 },
    legalBasis: `${ORDER_29N}`
  },
  {
    id: 'ppe_card',
    moduleId: 'ppe',
    event: 'hire',
    title: 'Карточка учёта выдачи СИЗ',
    kind: 'document',
    templateId: 'tpl_siz_card',
    offsetDays: 0,
    legalBasis: 'Приказ Минтруда РФ № 766н'
  },
  {
    id: 'periodic_briefing',
    moduleId: 'briefings',
    event: 'hire',
    title: 'Повторный инструктаж по охране труда',
    kind: 'deadline',
    offsetDays: 180,
    periodicityMonths: 6,
    legalBasis: `${POST_2464}, п. 16`
  },
  {
    id: 'periodic_med',
    moduleId: 'medical',
    event: 'hire',
    title: 'Периодический медосмотр',
    kind: 'deadline',
    offsetDays: 365,
    periodicityMonths: 12,
    periodicityBySoutClass: { '2.0': 24, '3.1': 12, '3.2': 12, '3.3': 12, '3.4': 12 },
    legalBasis: `${ORDER_29N}`
  },
  {
    id: 'manager_training',
    moduleId: 'briefings',
    event: 'hire',
    title: 'Обучение по охране труда руководителей и специалистов',
    kind: 'deadline',
    offsetDays: 60,
    periodicityMonths: 36,
    condition: {
      positionMatches: ['руководител', 'начальник', 'директор', 'заместител', 'мастер', 'заведующ']
    },
    legalBasis: `${POST_2464}, п. 46`
  },

  // ---------- Перевод ----------
  {
    id: 'transfer_order',
    moduleId: 'employees',
    event: 'transfer',
    title: 'Приказ о переводе на другую работу',
    kind: 'document',
    templateId: 'tpl_transfer_order',
    offsetDays: 0,
    legalBasis: 'ТК РФ, ст. 72.1'
  },
  {
    id: 'transfer_briefing',
    moduleId: 'briefings',
    event: 'transfer',
    title: 'Внеплановый инструктаж при переводе',
    kind: 'deadline',
    offsetDays: 0,
    legalBasis: `${POST_2464}, п. 18`
  },
  {
    id: 'transfer_knowledge',
    moduleId: 'briefings',
    event: 'transfer',
    title: 'Проверка знаний после перевода',
    kind: 'deadline',
    offsetDays: 30,
    legalBasis: `${POST_2464}, п. 32`
  },

  // ---------- Увольнение ----------
  {
    id: 'dismissal_order',
    moduleId: 'employees',
    event: 'dismissal',
    title: 'Приказ о прекращении трудового договора',
    kind: 'document',
    templateId: 'tpl_dismissal_order',
    offsetDays: 0,
    legalBasis: 'ТК РФ, ст. 84.1'
  },
  {
    id: 'ppe_return',
    moduleId: 'ppe',
    event: 'dismissal',
    title: 'Возврат СИЗ при увольнении',
    kind: 'deadline',
    offsetDays: 0,
    legalBasis: 'Приказ Минтруда РФ № 766н'
  },
  {
    id: 'personal_card_close',
    moduleId: 'employees',
    event: 'dismissal',
    title: 'Закрытие личной карточки работника',
    kind: 'deadline',
    offsetDays: 0,
    legalBasis: 'ТК РФ, ст. 84.1'
  },

  // ---------- Несчастный случай ----------
  {
    id: 'incident_act',
    moduleId: 'incidents',
    event: 'incident',
    title: 'Акт о несчастном случае на производстве',
    kind: 'document',
    templateId: 'tpl_incident_act',
    offsetDays: 1,
    legalBasis: 'ТК РФ, ст. 230'
  },
  {
    id: 'incident_investigation',
    moduleId: 'incidents',
    event: 'incident',
    title: 'Расследование обстоятельств и причин',
    kind: 'deadline',
    offsetDays: 3,
    legalBasis: 'ТК РФ, ст. 229.1'
  },
  {
    id: 'incident_briefing',
    moduleId: 'briefings',
    event: 'incident',
    title: 'Внеплановый инструктаж после несчастного случая',
    kind: 'deadline',
    offsetDays: 7,
    legalBasis: `${POST_2464}, п. 18`
  }
];

export function getRulesForEvent(event: EmployeeEventType): ObligationRule[] {
  return OBLIGATION_RULES.filter((rule) => rule.event === event && !rule.controlPoint);
}

export function getObligationRule(ruleId: string): ObligationRule | undefined {
  return OBLIGATION_RULES.find((rule) => rule.id === ruleId);
}
