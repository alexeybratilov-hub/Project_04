export type ColumnType = 'text' | 'number' | 'date' | 'select' | 'boolean' | 'link' | 'relation';

export interface ColumnRelation {
  masterTabId: string;
  masterColumnId: string;
}

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  required?: boolean;
  options?: string[]; // for 'select'
  relation?: ColumnRelation;
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
  relatedTabName?: string; // optional hint for which module/tab topic this normative pertains to
}

export interface Tab {
  id: string;
  name: string;
  description?: string;
  isMaster?: boolean;
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

export interface DocumentTemplate {
  id: string;
  name: string;
  tabId: string;
  fileName: string;
  namingPattern: string; // e.g. "{ФИО}_инструктаж_2026.docx"
  contentTemplate: string;
  tableRepeatField?: string;
  isBuiltIn?: boolean;
}

export interface LLMConfig {
  endpoint: string; // default http://localhost:11434
  model: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  databaseDirectory: string;
  portableMode: boolean;
  theme: 'light' | 'dark';
  autoSave: boolean;
  lastBackupDate?: string;
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
  llmConfig: LLMConfig;
  llmLogs: LLMGenerationLog[];
  settings: AppSettings;
}
