import { DatabaseState, LegalEntity, Row, Tab } from '../types/database';
import {
  collectDeadlineEvents,
  filterDeadlineEvents,
  formatIsoToDisplay,
  summarizeDeadlineEvents
} from './deadlineService';
import { integrityService } from './integrityService';
import { isEmployeeDismissed, summarizeObligations } from './obligationService';
import { documentGenerator } from './documentGenerator';
import { excelService } from './excelService';

export type GitReadinessStatus = 'ok' | 'warning' | 'critical';

/**
 * Ограничение методики: отчёт формируется по данным базы и не заменяет
 * заключение инспектора. Текст выводится в интерфейсе и во всех выгрузках,
 * чтобы оценка не воспринималась как гарантия.
 */
export const GIT_READINESS_DISCLAIMER =
  'Самопроверка по данным базы. Это не заключение Государственной инспекции труда и не гарантия отсутствия замечаний: состав и веса критериев заданы приложением, спорные ситуации проверяйте по актуальным НПА и документам.';

export type GitReadinessActionTarget =
  | { kind: 'entity' }
  | { kind: 'relations' }
  | { kind: 'deadlines' }
  | { kind: 'employees' }
  | { kind: 'normatives' }
  | { kind: 'tab'; tabId: string };

export interface GitReadinessCheck {
  id: string;
  category: string;
  title: string;
  status: GitReadinessStatus;
  score: number;
  maxScore: number;
  summary: string;
  details: string;
  legalBasis: string;
  actionLabel?: string;
  actionTarget?: GitReadinessActionTarget;
}

export interface GitReadinessGap {
  id: string;
  severity: 'critical' | 'warning';
  category: string;
  title: string;
  description: string;
  legalBasis: string;
  actionLabel?: string;
  actionTarget?: GitReadinessActionTarget;
}

export interface GitReadinessReport {
  evaluatedAtIso: string;
  entityId: string;
  entityName: string;
  entityInn: string;
  scorePercent: number;
  totalPoints: number;
  maxPoints: number;
  level: 'high' | 'medium' | 'low';
  levelLabel: string;
  criticalCount: number;
  warningCount: number;
  passedCount: number;
  checks: GitReadinessCheck[];
  gaps: GitReadinessGap[];
}

function getLocalTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function findTabByModuleOrHint(tabs: Tab[], moduleId: string, nameRegex: RegExp, fallbackId?: string): Tab | undefined {
  return (
    tabs.find((t) => t.moduleId === moduleId) ||
    (fallbackId ? tabs.find((t) => t.id === fallbackId) : undefined) ||
    tabs.find((t) => nameRegex.test(t.name))
  );
}

function resolveFieldByHints(row: Row, tab: Tab, exactIds: string[], colRegex: RegExp): string {
  for (const id of exactIds) {
    if (row[id] !== undefined && row[id] !== null && String(row[id]).trim() !== '') {
      return String(row[id]).trim();
    }
  }
  const matchedCol = tab.columns.find((c) => colRegex.test(c.name));
  if (matchedCol && row[matchedCol.id] !== undefined && row[matchedCol.id] !== null) {
    return String(row[matchedCol.id]).trim();
  }
  return '';
}

function formatDateStampForFile(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : getLocalTodayIso();
}

export function evaluateGitReadiness(
  state: DatabaseState,
  todayIso: string = getLocalTodayIso()
): GitReadinessReport {
  const activeEntity: LegalEntity | undefined =
    state.entities.find((e) => e.id === state.activeEntityId) || state.entities[0];

  const isMirrorSynced = !activeEntity || activeEntity.id === state.activeEntityId;
  const entityTabs = isMirrorSynced && state.tabs.length > 0 ? state.tabs : activeEntity?.tabs || [];
  const entityTags = isMirrorSynced ? state.tags || [] : activeEntity?.tags || [];
  const entityDocs = isMirrorSynced ? state.generatedDocs || [] : activeEntity?.generatedDocs || [];
  const entityObligations = isMirrorSynced
    ? state.employeeObligations || []
    : activeEntity?.employeeObligations || [];
  const entityEvents = isMirrorSynced
    ? state.employeeEvents || []
    : activeEntity?.employeeEvents || [];

  const profile = activeEntity?.profile;
  const entityName =
    profile?.shortName?.trim() || profile?.fullName?.trim() || 'Организация не указана';
  const entityInn = profile?.inn?.trim() || '';

  const checks: GitReadinessCheck[] = [];
  const gaps: GitReadinessGap[] = [];

  const allEvents = collectDeadlineEvents(state, { todayIso });
  const entityDeadlineEvents = activeEntity
    ? filterDeadlineEvents(allEvents, { entityId: activeEntity.id })
    : allEvents;
  const entityDeadlineSummary = summarizeDeadlineEvents(entityDeadlineEvents);

  // 1. Entity profile & requisites (10 pts)
  {
    const maxScore = 10;
    const missingFields: string[] = [];
    if (!profile?.fullName?.trim() && !profile?.shortName?.trim()) missingFields.push('Наименование');
    if (!profile?.inn?.trim()) missingFields.push('ИНН');
    if (!profile?.ogrn?.trim()) missingFields.push('ОГРН');
    if (!profile?.legalAddress?.trim()) missingFields.push('Юридический адрес');
    if (!profile?.directorFio?.trim()) missingFields.push('ФИО руководителя');

    let status: GitReadinessStatus = 'ok';
    let score = maxScore;
    let summary = 'Все основные реквизиты организации заполнены';
    if (missingFields.length >= 4) {
      status = 'critical';
      score = 0;
      summary = `Не заполнены ключевые реквизиты (${missingFields.join(', ')})`;
    } else if (missingFields.length > 0) {
      status = 'warning';
      score = Math.max(3, maxScore - missingFields.length * 2);
      summary = `Не хватает реквизитов: ${missingFields.join(', ')}`;
    }

    checks.push({
      id: 'entity_profile',
      category: 'Реквизиты юрлица',
      title: 'Реквизиты организации и руководитель',
      status,
      score,
      maxScore,
      summary,
      details:
        missingFields.length === 0
          ? `${entityName}${entityInn ? `, ИНН ${entityInn}` : ''}`
          : `Для приказов и протоколов требуются: ${missingFields.join(', ')}.`,
      legalBasis: 'ст. 214 ТК РФ, ГОСТ Р 7.0.97-2016',
      actionLabel: 'Карточка организации',
      actionTarget: { kind: 'entity' }
    });

    if (status !== 'ok') {
      gaps.push({
        id: 'gap_entity_profile',
        severity: status === 'critical' ? 'critical' : 'warning',
        category: 'Реквизиты юрлица',
        title: 'Неполные реквизиты организации',
        description: summary,
        legalBasis: 'ст. 214 ТК РФ, ГОСТ Р 7.0.97-2016',
        actionLabel: 'Заполнить реквизиты',
        actionTarget: { kind: 'entity' }
      });
    }
  }

  // 2. Staffing, СОУТ, 29н & 766н norms (15 pts)
  {
    const maxScore = 15;
    const staffingTab = findTabByModuleOrHint(entityTabs, 'staffing', /штат|должност/i, 'tab_positions');
    if (!staffingTab || staffingTab.rows.length === 0) {
      checks.push({
        id: 'staffing_sout',
        category: 'СОУТ и нормы',
        title: 'Штатное расписание, СОУТ, факторы 29н и нормы СИЗ 766н',
        status: 'critical',
        score: 0,
        maxScore,
        summary: staffingTab ? 'Штатное расписание не заполнено (0 должностей)' : 'Вкладка «Штатное расписание» отсутствует',
        details: 'Без должностей и класса СОУТ невозможно корректно рассчитать медосмотры и нормы СИЗ.',
        legalBasis: 'ФЗ № 426-ФЗ (СОУТ), Приказ № 29н, Приказ № 766н',
        actionLabel: staffingTab ? 'Открыть штатное расписание' : undefined,
        actionTarget: staffingTab ? { kind: 'tab', tabId: staffingTab.id } : undefined
      });
      gaps.push({
        id: 'gap_staffing_empty',
        severity: 'critical',
        category: 'СОУТ и нормы',
        title: 'Не заполнено штатное расписание и результаты СОУТ',
        description: 'Добавьте должности, укажите класс условий труда (СОУТ), вредные факторы по 29н и нормы СИЗ по 766н.',
        legalBasis: 'ФЗ № 426-ФЗ, Приказ № 29н, Приказ № 766н',
        actionLabel: staffingTab ? 'Открыть таблицу' : undefined,
        actionTarget: staffingTab ? { kind: 'tab', tabId: staffingTab.id } : undefined
      });
    } else {
      let missingSout = 0;
      let missingFactors = 0;
      let missingPpe = 0;
      staffingTab.rows.forEach((r) => {
        const sout = resolveFieldByHints(r, staffingTab, ['pos_sout_class'], /соут|класс\s*услов/i);
        const factors = resolveFieldByHints(r, staffingTab, ['pos_factors'], /фактор|29н/i);
        const ppe = resolveFieldByHints(r, staffingTab, ['pos_ppe_norm'], /сиз|766н|норм/i);
        if (!sout) missingSout += 1;
        if (/3\.\d|4\b|вредн|опасн/i.test(sout) && !factors) missingFactors += 1;
        if (!ppe) missingPpe += 1;
      });
      const totalRows = staffingTab.rows.length;
      const issueSum = missingSout + missingFactors + missingPpe;
      let status: GitReadinessStatus = 'ok';
      let score = maxScore;
      const parts: string[] = [];
      if (missingSout > 0) parts.push(`без класса СОУТ: ${missingSout}`);
      if (missingFactors > 0) parts.push(`вредный класс без факторов 29н: ${missingFactors}`);
      if (missingPpe > 0) parts.push(`без норм СИЗ 766н: ${missingPpe}`);

      if (missingSout > totalRows / 2 || missingFactors > 0) {
        status = 'critical';
        score = Math.max(4, maxScore - Math.min(11, issueSum * 2));
      } else if (issueSum > 0) {
        status = 'warning';
        score = Math.max(8, maxScore - Math.min(6, issueSum));
      }

      const summary =
        parts.length === 0
          ? `Должностей: ${totalRows}, классы СОУТ и нормы заполнены`
          : `Должностей: ${totalRows} (${parts.join('; ')})`;

      checks.push({
        id: 'staffing_sout',
        category: 'СОУТ и нормы',
        title: 'Штатное расписание, СОУТ, факторы 29н и нормы СИЗ 766н',
        status,
        score,
        maxScore,
        summary,
        details:
          parts.length === 0
            ? 'Для всех должностей заданы класс условий труда и привязаны требования.'
            : `Заполните недостающие поля в штатном расписании: ${parts.join(', ')}.`,
        legalBasis: 'ФЗ № 426-ФЗ (СОУТ), Приказ № 29н, Приказ № 766н',
        actionLabel: 'Открыть штатное расписание',
        actionTarget: { kind: 'tab', tabId: staffingTab.id }
      });

      if (status !== 'ok') {
        gaps.push({
          id: 'gap_staffing_incomplete',
          severity: status === 'critical' ? 'critical' : 'warning',
          category: 'СОУТ и нормы',
          title: 'Пробелы в СОУТ или нормах СИЗ/29н по должностям',
          description: summary,
          legalBasis: 'ФЗ № 426-ФЗ, Приказ № 29н, Приказ № 766н',
          actionLabel: 'Дозаполнить должности',
          actionTarget: { kind: 'tab', tabId: staffingTab.id }
        });
      }
    }
  }

  // 3. Employees registry & obligation packages (15 pts)
  {
    const maxScore = 15;
    const empTab = findTabByModuleOrHint(entityTabs, 'employees', /сотрудник|работник/i, 'tab_employees');
    const activeEmployees = empTab
      ? empTab.rows.filter((r) => !isEmployeeDismissed(entityEvents, r.id))
      : [];

    if (!empTab || activeEmployees.length === 0) {
      checks.push({
        id: 'employees_obligations',
        category: 'Персонал и обязательства',
        title: 'Список работников и индивидуальные пакеты ОТ',
        status: 'critical',
        score: 0,
        maxScore,
        summary: empTab ? 'Нет активных работников в штате' : 'Вкладка «Сотрудники» не найдена',
        details: 'Добавьте работников вручную или импортируйте выгрузку 1С:ЗУП.',
        legalBasis: 'ст. 214, 219, 220 ТК РФ',
        actionLabel: 'Открыть сотрудников',
        actionTarget: { kind: 'employees' }
      });
      gaps.push({
        id: 'gap_employees_empty',
        severity: 'critical',
        category: 'Персонал и обязательства',
        title: 'Отсутствуют активные сотрудники в реестре',
        description: 'Реестр работников пуст — контроль индивидуальных обязательств и допусков не ведётся.',
        legalBasis: 'ст. 214, 219, 220 ТК РФ',
        actionLabel: 'Перейти к сотрудникам',
        actionTarget: { kind: 'employees' }
      });
    } else {
      let withoutHireDate = 0;
      let withoutPackage = 0;
      let overdueObligCount = 0;

      activeEmployees.forEach((r) => {
        const hireDate = resolveFieldByHints(r, empTab, ['emp_hire_date'], /при[её]м/i);
        if (!hireDate) withoutHireDate += 1;
        const own = entityObligations.filter((o) => o.employeeRowId === r.id);
        if (own.length === 0) {
          withoutPackage += 1;
        } else {
          overdueObligCount += summarizeObligations(own, todayIso).overdue;
        }
      });

      let status: GitReadinessStatus = 'ok';
      let score = maxScore;
      const notes: string[] = [];
      if (overdueObligCount > 0) notes.push(`просрочено обязательств: ${overdueObligCount}`);
      if (withoutPackage > 0) notes.push(`без пакета ОТ: ${withoutPackage}`);
      if (withoutHireDate > 0) notes.push(`без даты приёма: ${withoutHireDate}`);

      if (overdueObligCount > 0 || withoutPackage > activeEmployees.length / 2) {
        status = 'critical';
        score = Math.max(3, maxScore - Math.min(12, overdueObligCount * 2 + withoutPackage));
      } else if (notes.length > 0) {
        status = 'warning';
        score = Math.max(8, maxScore - Math.min(6, withoutPackage + withoutHireDate));
      }

      const summary =
        notes.length === 0
          ? `Активных работников: ${activeEmployees.length}, пакеты рассчитаны без просрочек`
          : `Работников: ${activeEmployees.length} (${notes.join('; ')})`;

      checks.push({
        id: 'employees_obligations',
        category: 'Персонал и обязательства',
        title: 'Список работников и индивидуальные пакеты ОТ',
        status,
        score,
        maxScore,
        summary,
        details:
          notes.length === 0
            ? 'У каждого работника указана дата приёма и контролируются обязательные процедуры.'
            : `Требуется внимание по персоналу: ${notes.join(', ')}.`,
        legalBasis: 'ст. 214, 219, 220 ТК РФ, Постановление № 2464',
        actionLabel: 'Карточки сотрудников',
        actionTarget: { kind: 'employees' }
      });

      if (status !== 'ok') {
        gaps.push({
          id: 'gap_employees_obligations',
          severity: status === 'critical' ? 'critical' : 'warning',
          category: 'Персонал и обязательства',
          title: overdueObligCount > 0 ? 'Есть просроченные обязательства по работникам' : 'Неполные данные или пакеты работников',
          description: summary,
          legalBasis: 'ст. 214, 219, 220 ТК РФ, Постановление № 2464',
          actionLabel: 'Открыть сотрудников',
          actionTarget: { kind: 'employees' }
        });
      }
    }
  }

  // Helper for deadline-driven module tabs (briefings, medical, ppe)
  const evaluateModuleTab = (params: {
    id: string;
    category: string;
    title: string;
    moduleId: string;
    fallbackId: string;
    nameRegex: RegExp;
    maxScore: number;
    legalBasis: string;
    emptyMsg: string;
  }) => {
    const tab = findTabByModuleOrHint(entityTabs, params.moduleId, params.nameRegex, params.fallbackId);
    if (!tab || tab.rows.length === 0) {
      checks.push({
        id: params.id,
        category: params.category,
        title: params.title,
        status: 'critical',
        score: 0,
        maxScore: params.maxScore,
        summary: tab ? `${params.emptyMsg} (0 записей)` : `Раздел «${params.category}» отсутствует`,
        details: 'При проверке ГИТ инспектор запрашивает журнал и подтверждённые записи за текущий период.',
        legalBasis: params.legalBasis,
        actionLabel: tab ? `Открыть «${tab.name}»` : undefined,
        actionTarget: tab ? { kind: 'tab', tabId: tab.id } : undefined
      });
      gaps.push({
        id: `gap_${params.id}`,
        severity: 'critical',
        category: params.category,
        title: params.emptyMsg,
        description: `В разделе «${tab?.name || params.category}» отсутствуют записи.`,
        legalBasis: params.legalBasis,
        actionLabel: tab ? `Перейти в «${tab.name}»` : undefined,
        actionTarget: tab ? { kind: 'tab', tabId: tab.id } : undefined
      });
      return;
    }

    const tabEvents = entityDeadlineEvents.filter((ev) => ev.tabId === tab.id);
    const tabSummary = summarizeDeadlineEvents(tabEvents);

    let extraMedicalCritical = 0;
    if (params.moduleId === 'medical') {
      tab.rows.forEach((r) => {
        const resText = resolveFieldByHints(r, tab, ['med_result'], /заключен|итог|годн/i);
        if (/не\s*годен|противопоказ/i.test(resText)) extraMedicalCritical += 1;
      });
    }

    let status: GitReadinessStatus = 'ok';
    let score = params.maxScore;
    const issueParts: string[] = [];
    if (tabSummary.overdue > 0) issueParts.push(`просрочено: ${tabSummary.overdue}`);
    if (extraMedicalCritical > 0) issueParts.push(`выявлены противопоказания: ${extraMedicalCritical}`);
    if (tabSummary.dueSoon > 0) issueParts.push(`скоро истекает: ${tabSummary.dueSoon}`);
    if (tabSummary.missingData > 0) issueParts.push(`нет даты: ${tabSummary.missingData}`);

    if (tabSummary.overdue > 0 || extraMedicalCritical > 0) {
      status = 'critical';
      score = Math.max(2, Math.round(params.maxScore * 0.25));
    } else if (tabSummary.dueSoon > 0 || tabSummary.missingData > 0) {
      status = 'warning';
      score = Math.max(Math.round(params.maxScore * 0.6), params.maxScore - 3);
    }

    const summary =
      issueParts.length === 0
        ? `Записей: ${tab.rows.length}, просрочек не выявлено`
        : `Записей: ${tab.rows.length} (${issueParts.join('; ')})`;

    checks.push({
      id: params.id,
      category: params.category,
      title: params.title,
      status,
      score,
      maxScore: params.maxScore,
      summary,
      details:
        issueParts.length === 0
          ? `Все сроки по разделу «${tab.name}» актуальны.`
          : `Обнаружены отклонения в разделе «${tab.name}»: ${issueParts.join(', ')}.`,
      legalBasis: params.legalBasis,
      actionLabel: `Открыть «${tab.name}»`,
      actionTarget: { kind: 'tab', tabId: tab.id }
    });

    if (status !== 'ok') {
      gaps.push({
        id: `gap_${params.id}`,
        severity: status === 'critical' ? 'critical' : 'warning',
        category: params.category,
        title: `Отклонения в разделе «${tab.name}»`,
        description: summary,
        legalBasis: params.legalBasis,
        actionLabel: `Открыть «${tab.name}»`,
        actionTarget: { kind: 'tab', tabId: tab.id }
      });
    }
  };

  // 4. Briefings & training (15 pts)
  evaluateModuleTab({
    id: 'briefings_training',
    category: 'Инструктажи и обучение',
    title: 'Инструктажи и обучение по охране труда',
    moduleId: 'briefings',
    fallbackId: 'tab_instructions',
    nameRegex: /инструктаж|обучен/i,
    maxScore: 15,
    legalBasis: 'Постановление Правительства РФ № 2464 от 24.12.2021',
    emptyMsg: 'Журнал инструктажей по ОТ не ведётся'
  });

  // 5. Medical exams (10 pts)
  evaluateModuleTab({
    id: 'medical_exams',
    category: 'Медосмотры (29н)',
    title: 'Предварительные и периодические медосмотры',
    moduleId: 'medical',
    fallbackId: 'tab_med',
    nameRegex: /медосмотр|медицинск/i,
    maxScore: 10,
    legalBasis: 'Приказ Минздрава РФ № 29н от 28.01.2021',
    emptyMsg: 'Реестр медосмотров пуст'
  });

  // 6. PPE issuance (10 pts)
  evaluateModuleTab({
    id: 'ppe_issuance',
    category: 'Выдача СИЗ (766н)',
    title: 'Личные карточки и сроки носки СИЗ',
    moduleId: 'ppe',
    fallbackId: 'tab_siz',
    nameRegex: /сиз|спецодежд/i,
    maxScore: 10,
    legalBasis: 'Приказ Минтруда РФ № 766н от 29.10.2021',
    emptyMsg: 'Журнал выдачи СИЗ не заполнен'
  });

  // 7. Consolidated Deadline Control across entity (10 pts)
  {
    const maxScore = 10;
    let status: GitReadinessStatus = 'ok';
    let score = maxScore;
    let summary = `Контролируемых событий: ${entityDeadlineSummary.total}, просрочек нет`;

    if (entityDeadlineSummary.total === 0) {
      status = 'warning';
      score = 4;
      summary = 'Столбцы «Контроль сроков» не настроены или не заполнены';
    } else if (entityDeadlineSummary.overdue > 0) {
      status = 'critical';
      score = entityDeadlineSummary.overdue >= 3 ? 0 : 3;
      summary = `Просрочено сроков: ${entityDeadlineSummary.overdue} из ${entityDeadlineSummary.total}`;
    } else if (entityDeadlineSummary.dueSoon > 0 || entityDeadlineSummary.missingData > 0) {
      status = 'warning';
      score = 7;
      summary = `Скоро истекает: ${entityDeadlineSummary.dueSoon}, не заполнено дат: ${entityDeadlineSummary.missingData}`;
    }

    checks.push({
      id: 'deadline_control',
      category: 'Контроль сроков',
      title: 'Сводный календарь сроков ОТ и нерабочие дни',
      status,
      score,
      maxScore,
      summary,
      details:
        status === 'ok'
          ? 'Все контрольные даты в актуальном статусе.'
          : 'Откройте «Контроль сроков», чтобы устранить просроченные или незаполненные даты.',
      legalBasis: 'ст. 214, 219, 220 ТК РФ',
      actionLabel: 'Открыть контроль сроков',
      actionTarget: { kind: 'deadlines' }
    });

    if (status !== 'ok') {
      gaps.push({
        id: 'gap_deadline_control',
        severity: status === 'critical' ? 'critical' : 'warning',
        category: 'Контроль сроков',
        title:
          entityDeadlineSummary.overdue > 0
            ? `Обнаружены просроченные мероприятия (${entityDeadlineSummary.overdue})`
            : 'Не все контрольные даты заполнены или настроены',
        description: summary,
        legalBasis: 'ст. 214, 219, 220 ТК РФ',
        actionLabel: 'Открыть контроль сроков',
        actionTarget: { kind: 'deadlines' }
      });
    }
  }

  // 8. Referential Integrity (10 pts)
  {
    const maxScore = 10;
    const audit = integrityService.auditIntegrity(entityTabs, entityTags);
    const totalIssues = audit.totalIssues;
    let status: GitReadinessStatus = 'ok';
    let score = maxScore;
    let summary = 'Ошибок связей и несогласованных значений не обнаружено';

    if (totalIssues > 0) {
      status = 'critical';
      score = totalIssues >= 5 ? 0 : Math.max(2, maxScore - totalIssues * 2);
      summary = `Нарушений целостности: ${totalIssues} (битых связей: ${audit.brokenRelations.length}, несовпадений: ${audit.orphanedCells.length}, тегов: ${audit.brokenTags.length})`;
    }

    checks.push({
      id: 'referential_integrity',
      category: 'Целостность данных',
      title: 'Ссылочная целостность таблиц и шаблонных тегов',
      status,
      score,
      maxScore,
      summary,
      details:
        totalIssues === 0
          ? 'Все связи «Должность → Работники → Медосмотры/СИЗ» и теги согласованы.'
          : 'Исправьте разорванные ссылки, чтобы документы и отчёты формировались без ошибок.',
      legalBasis: 'Внутренний контроль качества СУОТ',
      actionLabel: 'Проверить связи',
      actionTarget: { kind: 'relations' }
    });

    if (status !== 'ok') {
      gaps.push({
        id: 'gap_referential_integrity',
        severity: 'critical',
        category: 'Целостность данных',
        title: 'Нарушена ссылочная целостность базы',
        description: summary,
        legalBasis: 'Внутренний контроль качества СУОТ',
        actionLabel: 'Аудит связей',
        actionTarget: { kind: 'relations' }
      });
    }
  }

  // 9. Normative docs & active generated LNA/orders (5 pts)
  {
    const maxScore = 5;
    const normCount = (state.normativeDocs || []).length;
    const activeDocsCount = entityDocs.filter((d) => !d.isArchived).length;
    let status: GitReadinessStatus = 'ok';
    let score = maxScore;
    let summary = `Нормативных актов: ${normCount}, действующих документов в реестре: ${activeDocsCount}`;

    if (normCount === 0 && activeDocsCount === 0) {
      status = 'critical';
      score = 0;
      summary = 'Отсутствуют прикреплённые НПА и сформированные документы (приказы, журналы)';
    } else if (normCount === 0 || activeDocsCount === 0) {
      status = 'warning';
      score = 3;
      summary =
        activeDocsCount === 0
          ? `НПА в базе: ${normCount}, но в реестре нет сформированных приказов/протоколов`
          : `Сформировано документов: ${activeDocsCount}, но не прикреплены нормативные акты`;
    }

    checks.push({
      id: 'normatives_lna',
      category: 'ЛНА и приказы',
      title: 'Нормативная база и реестр сформированных приказов/протоколов',
      status,
      score,
      maxScore,
      summary,
      details: 'При проверке инспектор ГИТ запрашивает приказы, инструкции, листы ознакомления и актуальные НПА.',
      legalBasis: 'ст. 214, 217 ТК РФ',
      actionLabel: 'Нормативные акты',
      actionTarget: { kind: 'normatives' }
    });

    if (status !== 'ok') {
      gaps.push({
        id: 'gap_normatives_lna',
        severity: status === 'critical' ? 'critical' : 'warning',
        category: 'ЛНА и приказы',
        title: activeDocsCount === 0 ? 'Нет сформированных приказов и протоколов по ОТ' : 'Пустая база нормативных документов',
        description: summary,
        legalBasis: 'ст. 214, 217 ТК РФ',
        actionLabel: 'Открыть НПА',
        actionTarget: { kind: 'normatives' }
      });
    }
  }

  const maxPoints = checks.reduce((sum, c) => sum + c.maxScore, 0);
  const totalPoints = checks.reduce((sum, c) => sum + c.score, 0);
  const scorePercent = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;

  const level: GitReadinessReport['level'] =
    scorePercent >= 80 ? 'high' : scorePercent >= 55 ? 'medium' : 'low';
  const levelLabel =
    level === 'high'
      ? 'Высокая готовность к проверке ГИТ'
      : level === 'medium'
        ? 'Средняя готовность: требуются доработки'
        : 'Низкая готовность: высокий риск предписания ГИТ';

  const criticalCount = checks.filter((c) => c.status === 'critical').length;
  const warningCount = checks.filter((c) => c.status === 'warning').length;
  const passedCount = checks.filter((c) => c.status === 'ok').length;

  gaps.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return a.category.localeCompare(b.category, 'ru');
  });

  return {
    evaluatedAtIso: todayIso,
    entityId: activeEntity?.id || '',
    entityName,
    entityInn,
    scorePercent,
    totalPoints,
    maxPoints,
    level,
    levelLabel,
    criticalCount,
    warningCount,
    passedCount,
    checks,
    gaps
  };
}

function statusRuLabel(status: GitReadinessStatus): string {
  if (status === 'ok') return 'Соответствует';
  if (status === 'warning') return 'Замечание';
  return 'Критично';
}

export function formatGitReadinessGroupMarkup(report: GitReadinessReport): string {
  const dateRu = formatIsoToDisplay(report.evaluatedAtIso);
  const lines: string[] = [
    'ОТЧЁТ О ГОТОВНОСТИ К ПРОВЕРКЕ ГИТ',
    `${report.entityName}${report.entityInn ? ` (ИНН ${report.entityInn})` : ''}`,
    `Дата оценки: ${dateRu}`,
    `Индекс готовности: ${report.scorePercent}% (${report.totalPoints} из ${report.maxPoints} баллов) — ${report.levelLabel}`,
    `Сводка проверок: без замечаний — ${report.passedCount}, требуют внимания — ${report.warningCount}, критических — ${report.criticalCount}.`,
    '',
    'РЕЗУЛЬТАТЫ ПРОВЕРКИ ПО КАТЕГОРИЯМ',
    '[ТАБЛИЦА]',
    'Категория | Статус | Балл | Вывод | Основание',
    ...report.checks.map((c) =>
      [
        c.category,
        statusRuLabel(c.status),
        `${c.score}/${c.maxScore}`,
        c.summary.replace(/\|/g, '/'),
        c.legalBasis.replace(/\|/g, '/')
      ].join(' | ')
    ),
    '[/ТАБЛИЦА]',
    ''
  ];

  if (report.gaps.length > 0) {
    lines.push('ПРИОРИТЕТНЫЙ ПЛАН УСТРАНЕНИЯ ПРОБЕЛОВ');
    lines.push('[ТАБЛИЦА]');
    lines.push('Приоритет | Раздел | Замечание | Описание | Нормативное основание');
    report.gaps.forEach((g) => {
      lines.push(
        [
          g.severity === 'critical' ? 'Критично' : 'Внимание',
          g.category,
          g.title.replace(/\|/g, '/'),
          g.description.replace(/\|/g, '/'),
          g.legalBasis.replace(/\|/g, '/')
        ].join(' | ')
      );
    });
    lines.push('[/ТАБЛИЦА]');
  } else {
    lines.push('КРИТИЧЕСКИХ И ПРЕДУПРЕДИТЕЛЬНЫХ ЗАМЕЧАНИЙ НЕ ВЫЯВЛЕНО.');
  }

  lines.push('', 'ОГРАНИЧЕНИЕ МЕТОДИКИ', GIT_READINESS_DISCLAIMER);

  return lines.join('\n');
}

export function formatGitReadinessReportText(report: GitReadinessReport): string {
  const dateRu = formatIsoToDisplay(report.evaluatedAtIso);
  const out: string[] = [
    `ОТЧЁТ О ГОТОВНОСТИ К ПРОВЕРКЕ ГИТ`,
    `Организация: ${report.entityName}${report.entityInn ? ` (ИНН ${report.entityInn})` : ''}`,
    `Дата оценки: ${dateRu}`,
    `Индекс готовности: ${report.scorePercent}% (${report.totalPoints}/${report.maxPoints}) — ${report.levelLabel}`,
    `Пройдено: ${report.passedCount} | Предупреждений: ${report.warningCount} | Критических: ${report.criticalCount}`,
    '',
    'Разделы проверки:',
    ...report.checks.map(
      (c, i) =>
        `${i + 1}. [${statusRuLabel(c.status)}] ${c.title} (${c.score}/${c.maxScore}) — ${c.summary}`
    )
  ];

  if (report.gaps.length > 0) {
    out.push('', 'Выявленные пробелы:');
    report.gaps.forEach((g, i) => {
      out.push(
        `${i + 1}. [${g.severity === 'critical' ? 'КРИТИЧНО' : 'ВНИМАНИЕ'}] ${g.title}: ${g.description} (${g.legalBasis})`
      );
    });
  }

  out.push('', GIT_READINESS_DISCLAIMER);

  return out.join('\n');
}

export async function exportGitReadinessDocx(
  report: GitReadinessReport,
  options?: { download?: boolean }
): Promise<Blob> {
  const markup = formatGitReadinessGroupMarkup(report);
  const blob = await documentGenerator.generateGroupDocx(
    `Готовность_ГИТ_${report.entityName}`,
    markup
  );
  if (options?.download !== false) {
    const safeName = `Готовность_к_проверке_ГИТ_${formatDateStampForFile(report.evaluatedAtIso)}.docx`;
    await documentGenerator.saveAndDownloadBlob(blob, safeName, true);
  }
  return blob;
}

export async function exportGitReadinessPdf(
  report: GitReadinessReport,
  options?: { download?: boolean }
): Promise<Blob> {
  const markup = formatGitReadinessGroupMarkup(report);
  const blob = await documentGenerator.generateGroupPdf(
    `Готовность_ГИТ_${report.entityName}`,
    markup
  );
  if (options?.download !== false) {
    const safeName = `Готовность_к_проверке_ГИТ_${formatDateStampForFile(report.evaluatedAtIso)}.pdf`;
    await documentGenerator.saveAndDownloadBlob(blob, safeName, true);
  }
  return blob;
}

export function buildGitReadinessWorkbookSheets(
  report: GitReadinessReport
): Array<{ name: string; rows: Record<string, unknown>[] }> {
  const summaryRows = report.checks.map((c, idx) => ({
    '№': idx + 1,
    'Категория': c.category,
    'Критерий проверки': c.title,
    'Статус': statusRuLabel(c.status),
    'Балл': c.score,
    'Максимум': c.maxScore,
    'Результат': c.summary,
    'Пояснение': c.details,
    'Правовое основание': c.legalBasis
  }));

  const gapRows =
    report.gaps.length > 0
      ? report.gaps.map((g, idx) => ({
          '№': idx + 1,
          'Уровень': g.severity === 'critical' ? 'Критично' : 'Внимание',
          'Категория': g.category,
          'Проблема': g.title,
          'Описание': g.description,
          'Основание': g.legalBasis
        }))
      : [
          {
            '№': 1,
            'Уровень': 'ОК',
            'Категория': 'Общий итог',
            'Проблема': 'Пробелов не выявлено',
            'Описание': `Индекс готовности ${report.scorePercent}%`,
            'Основание': '—'
          }
        ];

  const methodRows = [
    {
      'Показатель': 'Индекс готовности',
      'Значение': `${report.scorePercent}% (${report.totalPoints} из ${report.maxPoints} баллов)`
    },
    { 'Показатель': 'Уровень', 'Значение': report.levelLabel },
    { 'Показатель': 'Дата оценки', 'Значение': formatIsoToDisplay(report.evaluatedAtIso) },
    { 'Показатель': 'Пройдено / предупреждений / критично', 'Значение': `${report.passedCount} / ${report.warningCount} / ${report.criticalCount}` },
    { 'Показатель': 'Как считается', 'Значение': 'Сумма баллов по критериям, каждый критерий имеет вес и нормативное основание; баллы и веса заданы в приложении.' },
    { 'Показатель': 'Ограничение методики', 'Значение': GIT_READINESS_DISCLAIMER }
  ];

  return [
    { name: 'Сводка ГИТ', rows: summaryRows },
    { name: 'Выявленные пробелы', rows: gapRows },
    { name: 'Методика', rows: methodRows }
  ];
}

export function exportGitReadinessXlsx(report: GitReadinessReport): void {
  const sheets = buildGitReadinessWorkbookSheets(report);
  const safeName = `Готовность_к_проверке_ГИТ_${formatDateStampForFile(report.evaluatedAtIso)}.xlsx`;
  excelService.exportWorkbookToXlsx(sheets, safeName);
}
