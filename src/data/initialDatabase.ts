import { AttachedDoc, DatabaseState, LegalEntity, LegalEntityProfile, Tab, Tag } from '../types/database';
import { BUILT_IN_TEMPLATES } from './builtInTemplates';
import { BUILT_IN_NORMATIVE_DOCS } from './builtInNormativeDocs';

export const INITIAL_TABS: Tab[] = [
  {
    id: 'tab_positions',
    name: 'Штатное расписание',
    description: 'Мастер-таблица должностей и базовых условий труда по СОУТ',
    isMaster: true,
    columns: [
      { id: 'pos_title', name: 'Должность (профессия)', type: 'text', required: true, width: 220 },
      { id: 'pos_dept', name: 'Подразделение', type: 'select', options: ['Производственный цех №1', 'Механический участок', 'Складской комплекс', 'Энергослужба', 'Отдел логистики', 'Администрация'], width: 200 },
      { id: 'pos_salary', name: 'Тариф/Оклад (руб)', type: 'number', width: 140 },
      { id: 'pos_code', name: 'Код ОКПДТР', type: 'text', width: 130 },
      { id: 'pos_sout_class', name: 'Класс условий труда', type: 'select', options: ['2.0 (допустимый)', '3.1 (вредный 1 ст.)', '3.2 (вредный 2 ст.)', '3.3 (вредный 3 ст.)'], width: 170 },
      { id: 'pos_vacation_extra', name: 'Доп. отпуск (дней)', type: 'number', width: 140 }
    ],
    rows: [
      { id: 'pos_1', pos_title: 'Электрогазосварщик 5 разряда', pos_dept: 'Производственный цех №1', pos_salary: 82000, pos_code: '19756', pos_sout_class: '3.2 (вредный 2 ст.)', pos_vacation_extra: 7 },
      { id: 'pos_2', pos_title: 'Слесарь-ремонтник 4 разряда', pos_dept: 'Механический участок', pos_salary: 68000, pos_code: '18559', pos_sout_class: '3.1 (вредный 1 ст.)', pos_vacation_extra: 0 },
      { id: 'pos_3', pos_title: 'Водитель вилочного погрузчика', pos_dept: 'Складской комплекс', pos_salary: 65000, pos_code: '11453', pos_sout_class: '3.1 (вредный 1 ст.)', pos_vacation_extra: 0 },
      { id: 'pos_4', pos_title: 'Оператор станков с ЧПУ', pos_dept: 'Механический участок', pos_salary: 76000, pos_code: '16045', pos_sout_class: '2.0 (допустимый)', pos_vacation_extra: 0 },
      { id: 'pos_5', pos_title: 'Маляр по металлу', pos_dept: 'Производственный цех №1', pos_salary: 72000, pos_code: '13450', pos_sout_class: '3.2 (вредный 2 ст.)', pos_vacation_extra: 7 },
      { id: 'pos_6', pos_title: 'Электромонтер по ремонту', pos_dept: 'Энергослужба', pos_salary: 70000, pos_code: '19861', pos_sout_class: '3.1 (вредный 1 ст.)', pos_vacation_extra: 0 },
      { id: 'pos_7', pos_title: 'Кладовщик склада готовой продукции', pos_dept: 'Складской комплекс', pos_salary: 52000, pos_code: '23114', pos_sout_class: '2.0 (допустимый)', pos_vacation_extra: 0 },
      { id: 'pos_8', pos_title: 'Начальник производственного цеха', pos_dept: 'Производственный цех №1', pos_salary: 110000, pos_code: '24040', pos_sout_class: '2.0 (допустимый)', pos_vacation_extra: 0 }
    ],
    attachedDocs: BUILT_IN_NORMATIVE_DOCS['tab_positions'] || []
  },
  {
    id: 'tab_employees',
    name: 'Список работников',
    description: 'Персональный состав с привязкой к штатному расписанию',
    columns: [
      { id: 'emp_tab_num', name: 'Табельный №', type: 'text', required: true, width: 110 },
      { id: 'emp_fio', name: 'ФИО работника', type: 'text', required: true, width: 230 },
      { 
        id: 'emp_pos', 
        name: 'Должность (профессия)', 
        type: 'relation', 
        relation: { masterTabId: 'tab_positions', masterColumnId: 'pos_title' },
        width: 220 
      },
      { 
        id: 'emp_dept', 
        name: 'Подразделение', 
        type: 'relation', 
        relation: { masterTabId: 'tab_positions', masterColumnId: 'pos_dept' },
        width: 190 
      },
      { id: 'emp_hire_date', name: 'Дата приема', type: 'date', width: 130 },
      { id: 'emp_snils', name: 'СНИЛС', type: 'text', width: 140 },
      { id: 'emp_briefing_status', name: 'Статус инструктажа', type: 'select', options: ['Пройден в срок', 'Требуется повторный', 'Назначен'], width: 170 }
    ],
    rows: [
      { id: 'emp_1', emp_tab_num: '0101', emp_fio: 'Иванов Сергей Петрович', emp_pos: 'Электрогазосварщик 5 разряда', emp_dept: 'Производственный цех №1', emp_hire_date: '2023-04-12', emp_snils: '142-876-231 09', emp_briefing_status: 'Пройден в срок' },
      { id: 'emp_2', emp_tab_num: '0102', emp_fio: 'Смирнов Алексей Викторович', emp_pos: 'Слесарь-ремонтник 4 разряда', emp_dept: 'Механический участок', emp_hire_date: '2022-11-03', emp_snils: '155-234-981 44', emp_briefing_status: 'Пройден в срок' },
      { id: 'emp_3', emp_tab_num: '0103', emp_fio: 'Кузнецов Дмитрий Анатольевич', emp_pos: 'Водитель вилочного погрузчика', emp_dept: 'Складской комплекс', emp_hire_date: '2024-01-18', emp_snils: '128-442-190 77', emp_briefing_status: 'Требуется повторный' },
      { id: 'emp_4', emp_tab_num: '0104', emp_fio: 'Васильев Роман Олегович', emp_pos: 'Оператор станков с ЧПУ', emp_dept: 'Механический участок', emp_hire_date: '2023-08-15', emp_snils: '178-901-234 11', emp_briefing_status: 'Пройден в срок' },
      { id: 'emp_5', emp_tab_num: '0105', emp_fio: 'Попова Елена Сергеевна', emp_pos: 'Маляр по металлу', emp_dept: 'Производственный цех №1', emp_hire_date: '2024-05-20', emp_snils: '119-334-556 92', emp_briefing_status: 'Пройден в срок' },
      { id: 'emp_6', emp_tab_num: '0106', emp_fio: 'Федоров Михаил Николаевич', emp_pos: 'Электромонтер по ремонту', emp_dept: 'Энергослужба', emp_hire_date: '2021-06-01', emp_snils: '133-789-456 28', emp_briefing_status: 'Пройден в срок' },
      { id: 'emp_7', emp_tab_num: '0107', emp_fio: 'Соколова Ольга Дмитриевна', emp_pos: 'Кладовщик склада готовой продукции', emp_dept: 'Складской комплекс', emp_hire_date: '2023-02-14', emp_snils: '162-456-789 65', emp_briefing_status: 'Пройден в срок' },
      { id: 'emp_8', emp_tab_num: '0108', emp_fio: 'Григорьев Артем Павлович', emp_pos: 'Начальник производственного цеха', emp_dept: 'Производственный цех №1', emp_hire_date: '2020-09-10', emp_snils: '141-223-998 01', emp_briefing_status: 'Пройден в срок' }
    ],
    attachedDocs: BUILT_IN_NORMATIVE_DOCS['tab_employees'] || []
  },
  {
    id: 'tab_factors',
    name: 'Вредные факторы (СОУТ)',
    description: 'Классификатор производственных факторов по приказу 29н и картам СОУТ',
    isMaster: true,
    columns: [
      { id: 'fac_code', name: 'Код по Приказу 29н', type: 'text', required: true, width: 150 },
      { id: 'fac_name', name: 'Наименование вредного фактора', type: 'text', required: true, width: 280 },
      { id: 'fac_hazard_class', name: 'Класс вредности', type: 'select', options: ['2.0 (допустимый)', '3.1', '3.2', '3.3', '3.4'], width: 140 },
      { id: 'fac_med_period', name: 'Периодичность МО', type: 'select', options: ['1 раз в год', '1 раз в 2 года', 'При приеме и раз в год'], width: 170 },
      { id: 'fac_norm_basis', name: 'Нормативная база', type: 'text', width: 210 }
    ],
    rows: [
      { id: 'fac_1', fac_code: '1.1.4', fac_name: 'Аэрозоли фиброгенного действия (сварочный аэрозоль)', fac_hazard_class: '3.2', fac_med_period: '1 раз в год', fac_norm_basis: 'Приказ Минздрава РФ № 29н, п. 1.1.4' },
      { id: 'fac_2', fac_code: '4.4', fac_name: 'Шум производственный (свыше 80 дБА)', fac_hazard_class: '3.1', fac_med_period: '1 раз в год', fac_norm_basis: 'Приказ Минздрава РФ № 29н, п. 4.4' },
      { id: 'fac_3', fac_code: '5.1', fac_name: 'Тяжесть трудового процесса (подъем и перемещение тяжестей)', fac_hazard_class: '3.1', fac_med_period: '1 раз в год', fac_norm_basis: 'Приказ Минздрава РФ № 29н, п. 5.1' },
      { id: 'fac_4', fac_code: '1.2.32', fac_name: 'Органические растворители и ЛКМ', fac_hazard_class: '3.2', fac_med_period: '1 раз в год', fac_norm_basis: 'Приказ Минздрава РФ № 29н, п. 1.2.32' },
      { id: 'fac_5', fac_code: '4.3', fac_name: 'Локальная вибрация ручного инструмента', fac_hazard_class: '3.1', fac_med_period: '1 раз в год', fac_norm_basis: 'Приказ Минздрава РФ № 29н, п. 4.3' }
    ],
    attachedDocs: BUILT_IN_NORMATIVE_DOCS['tab_factors'] || []
  },
  {
    id: 'tab_med',
    name: 'Медосмотры и МО',
    description: 'Учет периодических и предварительных медосмотров с контролем сроков',
    columns: [
      { 
        id: 'med_worker', 
        name: 'ФИО работника', 
        type: 'relation', 
        relation: { masterTabId: 'tab_employees', masterColumnId: 'emp_fio' },
        required: true,
        width: 230 
      },
      { 
        id: 'med_pos', 
        name: 'Должность (профессия)', 
        type: 'relation', 
        relation: { masterTabId: 'tab_positions', masterColumnId: 'pos_title' },
        width: 210 
      },
      { 
        id: 'med_factor', 
        name: 'Вредный производственный фактор', 
        type: 'relation', 
        relation: { masterTabId: 'tab_factors', masterColumnId: 'fac_name' },
        width: 250 
      },
      { id: 'med_last_date', name: 'Дата последнего МО', type: 'date', width: 140 },
      { id: 'med_next_date', name: 'Дата очередного МО', type: 'date', width: 140 },
      { id: 'med_conclusion', name: 'Заключение профпатолога', type: 'select', options: ['Годен без ограничений', 'Годен с ограничениями', 'Нуждается в дообследовании', 'Не годен к работе'], width: 190 },
      { id: 'med_status', name: 'Допуск к работе', type: 'boolean', width: 130 }
    ],
    rows: [
      { id: 'med_1', med_worker: 'Иванов Сергей Петрович', med_pos: 'Электрогазосварщик 5 разряда', med_factor: 'Аэрозоли фиброгенного действия (сварочный аэрозоль)', med_last_date: '2025-05-14', med_next_date: '2026-05-14', med_conclusion: 'Годен без ограничений', med_status: true },
      { id: 'med_2', med_worker: 'Смирнов Алексей Викторович', med_pos: 'Слесарь-ремонтник 4 разряда', med_factor: 'Шум производственный (свыше 80 дБА)', med_last_date: '2025-06-20', med_next_date: '2026-06-20', med_conclusion: 'Годен без ограничений', med_status: true },
      { id: 'med_3', med_worker: 'Кузнецов Дмитрий Анатольевич', med_pos: 'Водитель вилочного погрузчика', med_factor: 'Тяжесть трудового процесса (подъем и перемещение тяжестей)', med_last_date: '2025-01-22', med_next_date: '2026-01-22', med_conclusion: 'Годен с ограничениями', med_status: true },
      { id: 'med_4', med_worker: 'Попова Елена Сергеевна', med_pos: 'Маляр по металлу', med_factor: 'Органические растворители и ЛКМ', med_last_date: '2025-07-08', med_next_date: '2026-07-08', med_conclusion: 'Годен без ограничений', med_status: true },
      { id: 'med_5', med_worker: 'Федоров Михаил Николаевич', med_pos: 'Электромонтер по ремонту', med_factor: 'Шум производственный (свыше 80 дБА)', med_last_date: '2025-08-11', med_next_date: '2026-08-11', med_conclusion: 'Годен без ограничений', med_status: true }
    ],
    attachedDocs: BUILT_IN_NORMATIVE_DOCS['tab_med'] || []
  },
  {
    id: 'tab_siz',
    name: 'Выдача СИЗ',
    description: 'Журнал выдачи средств индивидуальной защиты и нормы носки',
    columns: [
      { 
        id: 'siz_worker', 
        name: 'ФИО работника', 
        type: 'relation', 
        relation: { masterTabId: 'tab_employees', masterColumnId: 'emp_fio' },
        required: true,
        width: 220 
      },
      { 
        id: 'siz_pos', 
        name: 'Должность (профессия)', 
        type: 'relation', 
        relation: { masterTabId: 'tab_positions', masterColumnId: 'pos_title' },
        width: 210 
      },
      { id: 'siz_item', name: 'Наименование СИЗ', type: 'text', required: true, width: 230 },
      { id: 'siz_unit', name: 'Ед. изм.', type: 'select', options: ['пара', 'шт.', 'комплект', 'упак.'], width: 110 },
      { id: 'siz_norm', name: 'Норма выдачи (год)', type: 'number', width: 140 },
      { id: 'siz_issue_date', name: 'Дата выдачи', type: 'date', width: 130 },
      { id: 'siz_wear_months', name: 'Срок носки (мес)', type: 'number', width: 140 },
      { id: 'siz_next_date', name: 'Дата следующей выдачи', type: 'date', width: 150 }
    ],
    rows: [
      { id: 'siz_1', siz_worker: 'Иванов Сергей Петрович', siz_pos: 'Электрогазосварщик 5 разряда', siz_item: 'Костюм сварщика огнестойкий', siz_unit: 'комплект', siz_norm: 1, siz_issue_date: '2025-05-15', siz_wear_months: 12, siz_next_date: '2026-05-15' },
      { id: 'siz_2', siz_worker: 'Иванов Сергей Петрович', siz_pos: 'Электрогазосварщик 5 разряда', siz_item: 'Щиток защитный сварочный с автозатемнением', siz_unit: 'шт.', siz_norm: 1, siz_issue_date: '2025-05-15', siz_wear_months: 24, siz_next_date: '2027-05-15' },
      { id: 'siz_3', siz_worker: 'Смирнов Алексей Викторович', siz_pos: 'Слесарь-ремонтник 4 разряда', siz_item: 'Ботинки защитные с композитным подноском', siz_unit: 'пара', siz_norm: 1, siz_issue_date: '2025-06-25', siz_wear_months: 12, siz_next_date: '2026-06-25' },
      { id: 'siz_4', siz_worker: 'Попова Елена Сергеевна', siz_pos: 'Маляр по металлу', siz_item: 'Полумаска изолирующая с противогазовыми фильтрами', siz_unit: 'комплект', siz_norm: 2, siz_issue_date: '2025-07-10', siz_wear_months: 6, siz_next_date: '2026-01-10' }
    ],
    attachedDocs: BUILT_IN_NORMATIVE_DOCS['tab_siz'] || []
  },
  {
    id: 'tab_instructions',
    name: 'Инструктажи по ОТ',
    description: 'Журнал регистрации инструктажей на рабочем месте (вводный, первичный, повторный)',
    columns: [
      { 
        id: 'inst_worker', 
        name: 'ФИО инструктируемого', 
        type: 'relation', 
        relation: { masterTabId: 'tab_employees', masterColumnId: 'emp_fio' },
        required: true,
        width: 220 
      },
      { 
        id: 'inst_pos', 
        name: 'Должность (профессия)', 
        type: 'relation', 
        relation: { masterTabId: 'tab_positions', masterColumnId: 'pos_title' },
        width: 210 
      },
      { id: 'inst_type', name: 'Вид инструктажа', type: 'select', options: ['Вводный', 'Первичный на рабочем месте', 'Повторный', 'Внеплановый', 'Целевой'], width: 210 },
      { id: 'inst_date', name: 'Дата проведения', type: 'date', width: 130 },
      { id: 'inst_instructor', name: 'ФИО инструктора', type: 'text', width: 210 },
      { id: 'inst_doc_number', name: '№ записи в журнале', type: 'text', width: 150 }
    ],
    rows: [
      { id: 'inst_1', inst_worker: 'Иванов Сергей Петрович', inst_pos: 'Электрогазосварщик 5 разряда', inst_type: 'Повторный', inst_date: '2025-11-20', inst_instructor: 'Григорьев А. П. (Нач. цеха)', inst_doc_number: 'Ж-2025/114' },
      { id: 'inst_2', inst_worker: 'Смирнов Алексей Викторович', inst_pos: 'Слесарь-ремонтник 4 разряда', inst_type: 'Повторный', inst_date: '2025-11-20', inst_instructor: 'Григорьев А. П. (Нач. цеха)', inst_doc_number: 'Ж-2025/115' },
      { id: 'inst_3', inst_worker: 'Попова Елена Сергеевна', inst_pos: 'Маляр по металлу', inst_type: 'Первичный на рабочем месте', inst_date: '2024-05-20', inst_instructor: 'Григорьев А. П. (Нач. цеха)', inst_doc_number: 'Ж-2024/048' }
    ],
    attachedDocs: []
  },
  {
    id: 'tab_incidents',
    name: 'Несчастные случаи и микротравмы',
    description: 'Журнал учета инцидентов, микроповреждений и расследований по ТК РФ',
    columns: [
      { id: 'inc_num', name: '№ акта / записи', type: 'text', required: true, width: 140 },
      { id: 'inc_date', name: 'Дата происшествия', type: 'date', width: 140 },
      { 
        id: 'inc_victim', 
        name: 'ФИО пострадавшего', 
        type: 'relation', 
        relation: { masterTabId: 'tab_employees', masterColumnId: 'emp_fio' },
        width: 220 
      },
      { 
        id: 'inc_pos', 
        name: 'Должность (профессия)', 
        type: 'relation', 
        relation: { masterTabId: 'tab_positions', masterColumnId: 'pos_title' },
        width: 210 
      },
      { id: 'inc_location', name: 'Место происшествия', type: 'text', width: 190 },
      { id: 'inc_circumstances', name: 'Обстоятельства и характер травмы', type: 'text', width: 260 },
      { id: 'inc_status', name: 'Статус расследования', type: 'select', options: ['Микротравма зафиксирована', 'Расследование завершено (Акт Н-1)', 'На контроле ГИТ'], width: 200 }
    ],
    rows: [
      { id: 'inc_1', inc_num: 'МТ-2025/08', inc_date: '2025-10-14', inc_victim: 'Смирнов Алексей Викторович', inc_pos: 'Слесарь-ремонтник 4 разряда', inc_location: 'Механический участок, верстак №3', inc_circumstances: 'Ссадина тыльной стороны левой кисти при замене резца. Оказана первая помощь.', inc_status: 'Микротравма зафиксирована' }
    ],
    attachedDocs: []
  }
];

export const INITIAL_TAGS: Tag[] = [
  { id: 'tag_1', name: '{ФИО}', tabId: 'tab_employees', columnId: 'emp_fio', description: 'Полные фамилия, имя и отчество работника' },
  { id: 'tag_2', name: '{Табельный_номер}', tabId: 'tab_employees', columnId: 'emp_tab_num', description: 'Табельный учетный номер' },
  { id: 'tag_3', name: '{Должность}', tabId: 'tab_positions', columnId: 'pos_title', description: 'Наименование профессии или должности' },
  { id: 'tag_4', name: '{Подразделение}', tabId: 'tab_positions', columnId: 'pos_dept', description: 'Структурное подразделение (цех, склад, отдел)' },
  { id: 'tag_5', name: '{Оклад}', tabId: 'tab_positions', columnId: 'pos_salary', description: 'Тарифная ставка или оклад' },
  { id: 'tag_6', name: '{Класс_СОУТ}', tabId: 'tab_positions', columnId: 'pos_sout_class', description: 'Класс условий труда по спецоценке' },
  { id: 'tag_7', name: '{Вредный_фактор}', tabId: 'tab_factors', columnId: 'fac_name', description: 'Наименование вредного или опасного фактора' },
  { id: 'tag_8', name: '{Код_фактора}', tabId: 'tab_factors', columnId: 'fac_code', description: 'Код по Приказу Минздрава 29н' },
  { id: 'tag_9', name: '{Дата_последнего_МО}', tabId: 'tab_med', columnId: 'med_last_date', description: 'Дата прохождения последнего медосмотра' },
  { id: 'tag_10', name: '{Дата_очередного_МО}', tabId: 'tab_med', columnId: 'med_next_date', description: 'Дата следующего обязательного медосмотра' },
  { id: 'tag_11', name: '{Заключение_профпатолога}', tabId: 'tab_med', columnId: 'med_conclusion', description: 'Медицинское заключение о пригодности' },
  { id: 'tag_12', name: '{Наименование_СИЗ}', tabId: 'tab_siz', columnId: 'siz_item', description: 'Наименование средства индивидуальной защиты' },
  { id: 'tag_13', name: '{Норма_выдачи}', tabId: 'tab_siz', columnId: 'siz_norm', description: 'Годовая норма выдачи СИЗ' },
  { id: 'tag_14', name: '{Ед_измерения}', tabId: 'tab_siz', columnId: 'siz_unit', description: 'Единица измерения СИЗ' },
  { id: 'tag_15', name: '{Дата_выдачи}', tabId: 'tab_siz', columnId: 'siz_issue_date', description: 'Дата фактической выдачи СИЗ' },
  { id: 'tag_16', name: '{Срок_носки}', tabId: 'tab_siz', columnId: 'siz_wear_months', description: 'Срок носки в месяцах' },
  { id: 'tag_17', name: '{Дата_следующей_выдачи}', tabId: 'tab_siz', columnId: 'siz_next_date', description: 'Плановая дата замены СИЗ' },
  { id: 'tag_18', name: '{Вид_инструктажа}', tabId: 'tab_instructions', columnId: 'inst_type', description: 'Вид инструктажа по безопасности' },
  { id: 'tag_19', name: '{Дата_проведения}', tabId: 'tab_instructions', columnId: 'inst_date', description: 'Дата проведения инструктажа' },
  { id: 'tag_20', name: '{ФИО_инструктора}', tabId: 'tab_instructions', columnId: 'inst_instructor', description: 'ФИО ответственного инструктора' },
  { id: 'tag_21', name: '{Номер_записи}', tabId: 'tab_instructions', columnId: 'inst_doc_number', description: 'Номер записи в журнале' },
  { id: 'tag_22', name: '{ФИО_работника}', tabId: 'tab_employees', columnId: 'emp_fio', description: 'Синоним тега ФИО' },
  { id: 'tag_23', name: '{ФИО_инструктируемого}', tabId: 'tab_employees', columnId: 'emp_fio', description: 'Синоним тега ФИО для инструктажей' }
];

export const DEFAULT_LEGAL_ENTITY_PROFILE: LegalEntityProfile = {
  fullName: 'Общество с ограниченной ответственностью «Катания»',
  shortName: 'ООО «Катания»',
  inn: '7701234567',
  kpp: '770101001',
  ogrn: '1157746123456',
  okpo: '40123456',
  okved: '46.90',
  bankDetails: 'р/с 40702810400000012345, к/с 30101810400000000225, БИК 044525225',
  bankIn: 'ПАО Сбербанк, г. Москва',
  legalAddress: '105064, г. Москва, ул. Земляной Вал, д. 9, оф. 412',
  email: 'info@kataniya-ot.ru',
  phone: '+7 (495) 123-45-67',
  directorFio: 'Александров Игорь Владимирович'
};

const TAB_NAMES_BY_ID: Record<string, string> = {
  tab_positions: 'Штатное расписание',
  tab_employees: 'Список работников',
  tab_factors: 'Вредные факторы (СОУТ)',
  tab_med: 'Медосмотры и МО',
  tab_siz: 'Выдача СИЗ',
};

export const INITIAL_SHARED_NORMATIVE_DOCS: AttachedDoc[] = Object.entries(BUILT_IN_NORMATIVE_DOCS).flatMap(
  ([tabId, docs]) =>
    docs.map((doc) => ({
      ...doc,
      relatedTabName: TAB_NAMES_BY_ID[tabId] || undefined
    }))
);

const INITIAL_LLM_LOGS = [
  {
    id: 'log_init',
    timestamp: '2026-03-01 10:15',
    templateName: 'Инструкция по ОТ для электрогазосварщика',
    tabName: 'Штатное расписание',
    rowIdentifier: 'Электрогазосварщик 5 разряда',
    modelUsed: 'qwen2.5:7b',
    promptSummary: 'Генерация ИОТ с учетом Приказа 772н и вредных факторов (сварочный аэрозоль)',
    outputSnippet: 'ИНСТРУКЦИЯ ПО ОХРАНЕ ТРУДА ДЛЯ ЭЛЕКТРОГАЗОСВАРЩИКА... 1. Общие требования...',
    fullOutput: 'ИНСТРУКЦИЯ ПО ОХРАНЕ ТРУДА ДЛЯ ЭЛЕКТРОГАЗОСВАРЩИКА...'
  }
];

export const INITIAL_ENTITY: LegalEntity = {
  id: 'entity_kataniya',
  profile: DEFAULT_LEGAL_ENTITY_PROFILE,
  tabs: INITIAL_TABS,
  tags: INITIAL_TAGS,
  templates: BUILT_IN_TEMPLATES,
  llmLogs: INITIAL_LLM_LOGS,
  generatedDocs: [],
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:00:00.000Z'
};

export const INITIAL_DATABASE_STATE: DatabaseState = {
  version: '1.3.0',
  lastSaved: new Date().toISOString(),
  activeEntityId: INITIAL_ENTITY.id,
  entities: [INITIAL_ENTITY],
  normativeDocs: INITIAL_SHARED_NORMATIVE_DOCS,
  tabs: INITIAL_TABS,
  tags: INITIAL_TAGS,
  templates: BUILT_IN_TEMPLATES,
  generatedDocs: [],
  llmConfig: {
    providerId: 'ollama',
    providerKind: 'local',
    apiFormat: 'ollama',
    endpoint: 'http://localhost:11434',
    model: 'qwen2.5:7b',
    apiKey: '',
    timeoutMs: 45000,
    temperature: 0.3,
    status: 'idle',
    availableModels: ['qwen2.5:7b', 'qwen2.5:14b', 'llama3.1:8b', 'mistral:7b', 'gemma2:9b', 'deepseek-r1:8b']
  },
  llmLogs: INITIAL_LLM_LOGS,
  settings: {
    databaseDirectory: 'D:\\OT-Base-Portable\\Data',
    portableMode: true,
    theme: 'light',
    autoSave: true,
    lastBackupDate: '2026-03-01'
  }
};
