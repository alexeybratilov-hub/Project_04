export type ColumnType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'boolean'
  | 'link'
  | 'relation'
  | 'deadline_control';

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: 'Текст',
  number: 'Число',
  date: 'Дата',
  select: 'Список',
  boolean: 'Да / Нет',
  link: 'Ссылка',
  relation: 'Связь',
  deadline_control: 'Контроль сроков'
};

export function getColumnTypeLabel(type: ColumnType | string): string {
  return COLUMN_TYPE_LABELS[type as ColumnType] || String(type);
}

export interface ColumnRelation {
  masterTabId: string;
  masterColumnId: string;
}

export type DeadlinePeriodicityUnit = 'days' | 'months' | 'years';
export type DeadlineWarningDayType = 'calendar' | 'working';

export interface DeadlineColumnConfig {
  periodicityValue: number; // >= 0 (0 = разовый срок без автосдвига)
  periodicityUnit: DeadlinePeriodicityUnit;
  warningValue: number; // >= 0 (порог статуса «скоро»)
  warningDayType: DeadlineWarningDayType;
}

export interface DeadlineCellValue {
  actualDate?: string; // ISO YYYY-MM-DD — фактическая дата последнего выполнения
  manualNextDate?: string; // ISO YYYY-MM-DD — явное ручное переопределение следующей плановой даты
  note?: string; // краткий комментарий (опционально)
  _rawOriginal?: string; // исходное строковое значение (при конверсии нераспознанного текста)
}

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  required?: boolean;
  options?: string[]; // for 'select'
  relation?: ColumnRelation;
  deadlineConfig?: DeadlineColumnConfig; // for 'deadline_control'
  width?: number; // pixel width for column resizer
}

export type Row = Record<string, any> & {
  id: string;
  _createdAt?: string;
  _updatedAt?: string;
};

export interface AttachedDoc {
  id: string;
  fileName: string;
  fileType: string;
  uploadDate: string;
  sizeFormatted: string;
  contentSnippet?: string;
  dataBase64?: string;
  storageFileName?: string; // safe filename inside ./normatives/ when running under OT-Baza.exe
  relatedTabName?: string; // optional hint for which module/tab topic this normative pertains to
}

export interface Tab {
  id: string;
  name: string;
  description?: string;
  isMaster?: boolean;
  /** Модуль, которому принадлежит вкладка (этап/точка контроля). */
  moduleId?: string;
  columns: Column[];
  rows: Row[];
  attachedDocs: AttachedDoc[];
}

export interface Tag {
  id: string;
  name: string; // e.g. "{ФИО}", "{Должность}"
  tabId: string;
  columnId: string;
  description?: string;
}

export type DocumentTemplateType = 'text' | 'docx';

export interface DocumentTemplate {
  id: string;
  name: string;
  tabId: string;
  category?: string;
  fileName: string;
  namingPattern: string; // e.g. "{ФИО}_инструктаж_2026.docx"
  contentTemplate: string;
  tableRepeatField?: string;
  isBuiltIn?: boolean;
  isArchived?: boolean;
  archivedAt?: string;
  archivedFromTabName?: string;
  // T-44: Native DOCX template fields (optional for 100% backward compatibility)
  templateType?: DocumentTemplateType;
  sourceFileName?: string;
  storageFileName?: string;
  dataBase64?: string;
  fileSizeFormatted?: string;
  uploadedAt?: string;
  detectedTags?: string[];
  unsupportedWarnings?: string[];
}

export type LLMProviderKind = 'local' | 'api';
export type LLMApiFormat = 'ollama' | 'openai' | 'anthropic' | 'gemini';

export interface LLMConfig {
  providerId: string;
  providerKind: LLMProviderKind;
  apiFormat: LLMApiFormat;
  endpoint: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  temperature: number;
  status: 'idle' | 'testing' | 'connected' | 'error';
  lastChecked?: string;
  availableModels?: string[];
  errorMessage?: string;
}

export interface LLMGenerationLog {
  id: string;
  timestamp: string;
  templateName: string;
  tabName: string;
  rowIdentifier: string;
  modelUsed: string;
  promptSummary: string;
  outputSnippet: string;
  fullOutput: string;
}

export interface GeneratedDocRecord {
  id: string;
  title: string;
  fileName: string;
  category: string;
  format: 'docx' | 'pdf';
  createdAt: string;
  dateFormatted: string;
  relativePath: string;
  isArchived: boolean;
  archivedAt?: string;
  archiveDateFolder?: string;
  sourceTabName?: string;
  /** Stable tab id the document was generated from (sourceTabName is renamed freely). */
  sourceTabId?: string;
  rowIdentifier?: string;
  sizeFormatted: string;
  dataBase64?: string;
}

export interface LegalEntityProfile {
  fullName: string;     // Полное наименование юридического лица на русском языке
  shortName: string;    // Сокращенное наименование юридического лица
  inn: string;          // ИНН
  kpp: string;          // КПП
  ogrn: string;         // ОГРН
  okpo: string;         // ОКПО
  okved: string;        // ОКВЭД
  bankDetails: string;  // Реквизиты банка
  bankIn: string;       // Банк в
  legalAddress: string; // Юридический адрес
  email: string;        // E-mail
  phone: string;        // телефон
  directorFio: string;  // Генеральный директор (директор, ИП) ФИО
}

export interface LegalEntity {
  id: string;
  profile: LegalEntityProfile;
  tabs: Tab[];
  tags: Tag[];
  templates: DocumentTemplate[];
  llmLogs: LLMGenerationLog[];
  generatedDocs: GeneratedDocRecord[];
  employeeObligations?: EmployeeObligation[];
  employeeEvents?: EmployeeEvent[];
  createdAt: string;
  updatedAt: string;
}

export type TabBarMode = 'single' | 'auto';
export type GridRowDensity = 'compact' | 'normal';

export interface DeadlineAppSettings {
  holidays?: string[]; // пользовательский список нерабочих/праздничных дат YYYY-MM-DD (отсортированный, без дублей)
  snoozedNotificationKeys?: Record<string, string>; // notificationKey -> hideUntil (YYYY-MM-DD; скрыто пока today < hideUntil)
  notificationsEnabled?: boolean; // default true
}

/** Обязательство по работнику: документ, срок или контрольная точка. */
export type ObligationStatus = 'pending' | 'done' | 'skipped';
export type ObligationKind = 'document' | 'deadline' | 'control';

/** Событие жизненного цикла работника: приём, перевод, увольнение, несчастный случай. */
export type EmployeeEventType = 'hire' | 'transfer' | 'dismissal' | 'incident';

export interface EmployeeEvent {
  id: string;
  employeeRowId: string;
  type: EmployeeEventType;
  /** Дата события (ISO YYYY-MM-DD). */
  date: string;
  note?: string;
  createdAt: string;
}

export interface EmployeeObligation {
  id: string;
  /** Строка работника во вкладке «Сотрудники» (Row.id). */
  employeeRowId: string;
  /** Событие, из которого возникло обязательство (приём, перевод, увольнение…). */
  eventId?: string;
  eventType?: EmployeeEventType;
  moduleId: string;
  /** Стабильный ключ требования внутри модуля. */
  requirementId: string;
  title: string;
  kind: ObligationKind;
  /** Шаблон, которым формируется документ (для kind === 'document'). */
  templateId?: string;
  /** Плановый срок (ISO YYYY-MM-DD). */
  dueDate?: string;
  /** Периодичность в месяцах: после выполнения создаётся следующая задача. */
  periodicityMonths?: number;
  status: ObligationStatus;
  completedAt?: string;
  generatedDocId?: string;
  /** Строка в таблице модуля, по которой сформирован документ (медосмотр, СИЗ, инструктаж). */
  linkedRowId?: string;
  legalBasis?: string;
  note?: string;
  createdAt: string;
}

export interface AppSettings {
  databaseDirectory: string;
  portableMode: boolean;
  theme: 'light' | 'dark';
  autoSave: boolean;
  tabBarMode?: TabBarMode;
  rowDensity?: GridRowDensity;
  pageSize?: number;
  lastBackupDate?: string;
  deadlineSettings?: DeadlineAppSettings;
  /** Установленные модули (этапы). Отсутствие поля = базовый набор. */
  installedModules?: string[];
}

export interface DatabaseState {
  version: string;
  lastSaved: string;
  activeEntityId: string;
  entities: LegalEntity[];
  normativeDocs: AttachedDoc[]; // Shared normative documents across all legal entities
  // Active entity convenience mirrors (kept synced for backward compatibility & exports)
  tabs: Tab[];
  tags: Tag[];
  templates: DocumentTemplate[];
  generatedDocs: GeneratedDocRecord[];
  employeeObligations?: EmployeeObligation[];
  employeeEvents?: EmployeeEvent[];
  llmConfig: LLMConfig;
  llmLogs: LLMGenerationLog[];
  settings: AppSettings;
}
