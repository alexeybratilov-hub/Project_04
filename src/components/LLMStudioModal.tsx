import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Cpu, Play, Download, RefreshCw, FileText, Sparkles,
  AlertCircle, CheckCircle2, Eye, EyeOff, Info, Copy, Check
} from 'lucide-react';
import { AttachedDoc, LegalEntityProfile, LLMConfig, LLMGenerationLog, Tab, Tag } from '../types/database';
import { ollamaService } from '../services/ollamaService';
import { documentGenerator } from '../services/documentGenerator';
import { createUniqueId } from '../services/integrityService';
import { getLLMProviderPreset, LLM_PROVIDER_PRESETS, normalizeLLMConfig } from '../data/llmProviders';
import { inferDocumentCategory } from '../services/generatedDocsService';
import {
  AppButton,
  AppInput,
  AppModal,
  AppSelect,
  AppTextarea,
  StatusBanner,
  useToast
} from './ui';

const DOC_TYPE_PRESETS = [
  'Инструкция по охране труда (ИОТ)',
  'Приказ о назначении ответственных лиц по ОТ',
  'Положение о системе управления охраной труда (СУОТ)',
  'Протокол проверки знаний требований охраны труда',
  'Акт расследования обстоятельств микротравмы',
  'Программа первичного инструктажа на рабочем месте'
] as const;

export interface RecordGeneratedDocPayload {
  title: string;
  fileName: string;
  category: string;
  format: 'docx' | 'pdf';
  blob: Blob;
  sourceTabName?: string;
  rowIdentifier?: string;
}

interface LLMStudioModalProps {
  isOpen: boolean;
  initialSubTab?: 'generate' | 'settings' | 'history';
  onClose: () => void;
  currentTab: Tab;
  allTabs: Tab[];
  tags: Tag[];
  entityProfile?: LegalEntityProfile;
  sharedNormativeDocs?: AttachedDoc[];
  llmConfig: LLMConfig;
  llmLogs: LLMGenerationLog[];
  selectedRowId?: string;
  onSaveLLMConfig: (config: LLMConfig) => void;
  onAddLLMLog: (log: LLMGenerationLog) => void;
  onRecordGeneratedDoc?: (payload: RecordGeneratedDocPayload) => Promise<void> | void;
}

export const LLMStudioModal: React.FC<LLMStudioModalProps> = ({
  isOpen,
  initialSubTab = 'generate',
  onClose,
  currentTab,
  allTabs,
  tags,
  entityProfile,
  sharedNormativeDocs,
  llmConfig,
  llmLogs,
  selectedRowId,
  onSaveLLMConfig,
  onAddLLMLog,
  onRecordGeneratedDoc
}) => {
  const { showToast } = useToast();
  const normalizedPropConfig = normalizeLLMConfig(llmConfig);

  const [activeTab, setActiveTab] = useState<'generate' | 'settings' | 'history'>(initialSubTab);
  const [targetRowId, setTargetRowId] = useState<string>(
    selectedRowId || currentTab.rows[0]?.id || ''
  );
  const [docType, setDocType] = useState<string>(DOC_TYPE_PRESETS[0]);
  const [customDocType, setCustomDocType] = useState<string>('');
  const [customInstructions, setCustomInstructions] = useState<string>(
    'Разработать подробную инструкцию по охране труда с учетом вредных производственных факторов по результатам СОУТ и норм Приказа Минтруда №772н.'
  );
  const [includeNormativeDocs, setIncludeNormativeDocs] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatedText, setGeneratedText] = useState<string>('');
  const [resultModelUsed, setResultModelUsed] = useState<string>('');
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [localConfig, setLocalConfig] = useState<LLMConfig>(normalizedPropConfig);
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [selectedLog, setSelectedLog] = useState<LLMGenerationLog | null>(null);
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);
  const [connectionFeedback, setConnectionFeedback] = useState<{
    type: 'idle' | 'testing' | 'success' | 'error';
    message: string;
  }>({ type: 'idle', message: '' });

  const prevIsOpenRef = useRef<boolean>(false);

  // Only reset activeTab & draft localConfig when the modal transitions from closed -> open.
  // Never kick the user out of 'settings' when llmConfig updates during connection test or save!
  useEffect(() => {
    const justOpened = isOpen && !prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    if (justOpened) {
      const norm = normalizeLLMConfig(llmConfig);
      setActiveTab(initialSubTab);
      setLocalConfig(norm);
      setSelectedLog(null);
      setCopiedLogId(null);
      setTargetRowId(selectedRowId || currentTab.rows[0]?.id || '');
      if (norm.status === 'error' && norm.errorMessage) {
        setConnectionFeedback({ type: 'error', message: norm.errorMessage });
      } else if (norm.status === 'connected') {
        setConnectionFeedback({
          type: 'success',
          message: `Подключено (${norm.lastChecked || 'активно'}) · модель ${norm.model}`
        });
      } else {
        setConnectionFeedback({ type: 'idle', message: '' });
      }
    }
  }, [isOpen, initialSubTab, llmConfig, selectedRowId, currentTab.rows]);

  // Update targetRowId when user switches active tab/row externally while keeping activeTab untouched
  useEffect(() => {
    if (!isOpen) return;
    if (selectedRowId) {
      setTargetRowId(selectedRowId);
    } else if (!currentTab.rows.some((r) => r.id === targetRowId)) {
      setTargetRowId(currentTab.rows[0]?.id || '');
    }
  }, [isOpen, selectedRowId, currentTab.id, currentTab.rows, targetRowId]);

  const currentPreset = getLLMProviderPreset(localConfig.providerId);
  const localPresets = LLM_PROVIDER_PRESETS.filter((p) => p.kind === 'local');
  const apiPresets = LLM_PROVIDER_PRESETS.filter((p) => p.kind === 'api');

  const modelChoices = Array.from(
    new Set([
      ...(currentPreset.popularModels || []),
      ...(localConfig.availableModels || []),
      ...(localConfig.model ? [localConfig.model] : [])
    ])
  ).filter(Boolean);

  const targetRow = currentTab.rows.find((r) => r.id === targetRowId) || currentTab.rows[0];
  const docsPool =
    sharedNormativeDocs && sharedNormativeDocs.length > 0
      ? sharedNormativeDocs
      : currentTab.attachedDocs;

  const handleSelectProvider = (providerId: string) => {
    const preset = getLLMProviderPreset(providerId);
    const updated: LLMConfig = {
      ...localConfig,
      providerId: preset.id,
      providerKind: preset.kind,
      apiFormat: preset.apiFormat,
      endpoint: preset.defaultEndpoint,
      model: preset.defaultModel,
      availableModels: preset.popularModels,
      status: 'idle',
      errorMessage: undefined
    };
    setLocalConfig(updated);
    setConnectionFeedback({ type: 'idle', message: '' });
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionFeedback({
      type: 'testing',
      message: `Проверка связи с ${currentPreset.name} (${localConfig.endpoint})...`
    });
    try {
      const result = await ollamaService.checkConnection(localConfig);
      if (result.ok) {
        const nextModel =
          localConfig.model.trim() || result.models[0] || currentPreset.defaultModel;
        const updatedConfig: LLMConfig = {
          ...localConfig,
          model: nextModel,
          status: 'connected',
          lastChecked: new Date().toLocaleTimeString('ru-RU'),
          availableModels: result.models,
          errorMessage: undefined
        };
        setLocalConfig(updatedConfig);
        onSaveLLMConfig(updatedConfig);
        setConnectionFeedback({
          type: 'success',
          message: `Тест подключения пройден! Доступно моделей: ${result.models.length} (${result.models.slice(0, 6).join(', ')}${result.models.length > 6 ? '...' : ''})`
        });
      } else {
        const errText = result.error || 'Не удалось установить соединение с сервером LLM.';
        const updatedConfig: LLMConfig = {
          ...localConfig,
          status: 'error',
          lastChecked: new Date().toLocaleTimeString('ru-RU'),
          errorMessage: errText
        };
        setLocalConfig(updatedConfig);
        onSaveLLMConfig(updatedConfig);
        setConnectionFeedback({
          type: 'error',
          message: errText
        });
      }
    } catch (e: any) {
      const errText = e?.message || 'Непредвиденная ошибка проверки подключения';
      const updatedConfig: LLMConfig = {
        ...localConfig,
        status: 'error',
        errorMessage: errText
      };
      setLocalConfig(updatedConfig);
      onSaveLLMConfig(updatedConfig);
      setConnectionFeedback({
        type: 'error',
        message: errText
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const isSettingsDirty = useMemo(
    () => JSON.stringify(localConfig) !== JSON.stringify(normalizedPropConfig),
    [localConfig, normalizedPropConfig]
  );

  const effectiveDocType = docType === '__custom__' ? customDocType.trim() : docType;

  const handleCancelSettings = () => {
    const norm = normalizeLLMConfig(llmConfig);
    setLocalConfig(norm);
    if (norm.status === 'error' && norm.errorMessage) {
      setConnectionFeedback({ type: 'error', message: norm.errorMessage });
    } else if (norm.status === 'connected') {
      setConnectionFeedback({
        type: 'success',
        message: `Подключено (${norm.lastChecked || 'активно'}) · модель ${norm.model}`
      });
    } else {
      setConnectionFeedback({ type: 'idle', message: '' });
    }
    showToast('Несохранённые изменения настроек LLM отменены', 'info');
  };

  const handleSaveSettingsOnly = () => {
    onSaveLLMConfig(localConfig);
    showToast(`Настройки провайдера «${currentPreset.name}» сохранены`, 'success');
  };

  const handleRunGeneration = async () => {
    if (!effectiveDocType) {
      showToast('Укажите название своего типа документа', 'warning');
      return;
    }
    if (!targetRow) {
      showToast('Выберите строку таблицы для генерации', 'warning');
      return;
    }

    setIsGenerating(true);
    try {
      const result = await ollamaService.generateDocument({
        tab: currentTab,
        row: targetRow,
        templateTitle: effectiveDocType,
        templateRequirements: customInstructions,
        attachedDocs: includeNormativeDocs ? docsPool : [],
        tags,
        allTabs,
        entityProfile,
        customInstructions,
        llmConfig: localConfig
      });

      setGeneratedText(result.text);
      setResultModelUsed(result.modelUsed);

      const newLog: LLMGenerationLog = {
        id: createUniqueId('log'),
        timestamp: new Date().toLocaleString('ru-RU'),
        templateName: effectiveDocType,
        tabName: currentTab.name,
        rowIdentifier: String(targetRow.emp_fio || targetRow.pos_title || targetRow.id),
        modelUsed: result.modelUsed,
        promptSummary: customInstructions.slice(0, 100),
        outputSnippet: result.text.slice(0, 150) + (result.text.length > 150 ? '...' : ''),
        fullOutput: result.text
      };
      onAddLLMLog(newLog);
      showToast(
        result.isSimulated
          ? 'LLM недоступна — сформирован документ по встроенному шаблону ОТ-База'
          : `Документ успешно сгенерирован (${currentPreset.name})`,
        result.isSimulated ? 'warning' : 'success'
      );
    } catch (err: any) {
      showToast('Ошибка при генерации документа: ' + err.message, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const buildDocFileName = (ext: 'docx' | 'pdf') => {
    const cleanTitle = (effectiveDocType || 'Документ_ОТ').replace(/[/\\?%*:|"<>]/g, '_').trim();
    const rowLabel = targetRow
      ? String(targetRow.emp_fio || targetRow.pos_title || targetRow.fac_name || '').trim()
      : '';
    const cleanRow = rowLabel ? `_${rowLabel.replace(/[/\\?%*:|"<>]/g, '_')}` : '';
    return `${cleanTitle}${cleanRow}.${ext}`;
  };

  const handleDownloadDocx = async () => {
    if (!generatedText) return;
    const title = effectiveDocType || 'Документ_ОТ';
    const filename = buildDocFileName('docx');
    const blob = await documentGenerator.generateDocx(title, generatedText);
    const category = inferDocumentCategory(title, currentTab.name);
    if (onRecordGeneratedDoc) {
      await onRecordGeneratedDoc({
        title,
        fileName: filename,
        category,
        format: 'docx',
        blob,
        sourceTabName: currentTab.name,
        rowIdentifier: targetRow
          ? String(targetRow.emp_fio || targetRow.pos_title || targetRow.id)
          : undefined
      });
    } else {
      await documentGenerator.saveAndDownloadBlob(blob, filename, true);
    }
    showToast(`DOCX «${filename}» сохранен в категорию «${category}»`, 'success');
  };

  const handleDownloadPdf = async () => {
    if (!generatedText) return;
    const title = effectiveDocType || 'Документ_ОТ';
    const filename = buildDocFileName('pdf');
    const blob = await documentGenerator.generatePdf(title, generatedText);
    const category = inferDocumentCategory(title, currentTab.name);
    if (onRecordGeneratedDoc) {
      await onRecordGeneratedDoc({
        title,
        fileName: filename,
        category,
        format: 'pdf',
        blob,
        sourceTabName: currentTab.name,
        rowIdentifier: targetRow
          ? String(targetRow.emp_fio || targetRow.pos_title || targetRow.id)
          : undefined
      });
    } else {
      await documentGenerator.saveAndDownloadBlob(blob, filename, true);
    }
    showToast(`PDF «${filename}» сохранен в категорию «${category}»`, 'success');
  };

  const getLogFullText = (log: LLMGenerationLog): string =>
    log.fullOutput && log.fullOutput.trim() ? log.fullOutput : log.outputSnippet || '';

  const handleCopyLog = (log: LLMGenerationLog) => {
    const text = getLogFullText(log);
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedLogId(log.id);
    setTimeout(() => setCopiedLogId((prev) => (prev === log.id ? null : prev)), 1500);
    showToast('Полный текст генерации скопирован в буфер обмена', 'success');
  };

  const handleExportLogTxt = async (log: LLMGenerationLog) => {
    const text = getLogFullText(log);
    const safeTitle = `${log.templateName}_${log.rowIdentifier}`
      .replace(/[/\\?%*:|"<>]/g, '_')
      .trim() || 'llm_document';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    await documentGenerator.saveAndDownloadBlob(blob, `${safeTitle}.txt`, false);
    showToast(`Файл «${safeTitle}.txt» экспортирован`, 'success');
  };

  const handleExportLogDocx = async (log: LLMGenerationLog) => {
    const text = getLogFullText(log);
    const safeTitle = `${log.templateName}_${log.rowIdentifier}`
      .replace(/[/\\?%*:|"<>]/g, '_')
      .trim() || 'llm_document';
    const blob = await documentGenerator.generateDocx(log.templateName, text);
    await documentGenerator.saveAndDownloadBlob(blob, `${safeTitle}.docx`, true);
    showToast(`DOCX «${safeTitle}.docx» сформирован из журнала`, 'success');
  };

  const handleLoadLogToStudio = (log: LLMGenerationLog) => {
    const text = getLogFullText(log);
    if ((DOC_TYPE_PRESETS as readonly string[]).includes(log.templateName)) {
      setDocType(log.templateName);
    } else {
      setDocType('__custom__');
      setCustomDocType(log.templateName);
    }
    setGeneratedText(text);
    setResultModelUsed(log.modelUsed);
    setSelectedLog(null);
    setActiveTab('generate');
    showToast('Документ из журнала загружен в редактор студии', 'info');
  };

  return (
    <>
      <AppModal
        isOpen={isOpen}
        onClose={onClose}
        closeOnEscape={!selectedLog}
        size="6xl"
        heightClass="max-h-[94vh]"
      icon={<Cpu className="w-5 h-5" />}
      iconTone="indigo"
      title={
        <div className="flex items-center gap-2 flex-wrap">
          <span>LLM-студия и настройки ИИ</span>
          <span className="text-xs font-mono font-normal text-indigo-600 dark:text-indigo-400">
            · {currentPreset.name} ({localConfig.model})
          </span>
        </div>
      }
      subtitle={
        <>
          {entityProfile?.shortName ? `${entityProfile.shortName} · ` : ''}
          {localConfig.providerKind === 'local'
            ? 'Локальный сервер ИИ без передачи данных в облако'
            : 'Подключение через внешний API провайдера'}
        </>
      }
      headerRight={
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('generate')}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'generate'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Студия
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'settings'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <span>Подключение</span>
            {localConfig.status === 'error' && (
              <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            )}
            {localConfig.status === 'connected' && (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'history'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Журнал ({llmLogs.length})
          </button>
        </div>
      }
    >

        {/* Content Body */}
        {activeTab === 'generate' && (
          <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
            <div className="md:col-span-5 p-5 overflow-y-auto space-y-4 text-xs">
              {localConfig.status !== 'connected' && (
                <StatusBanner
                  variant={localConfig.status === 'error' ? 'error' : 'warning'}
                  compact
                  title={localConfig.status === 'error' ? 'Ошибка подключения к LLM' : 'LLM-сервер не подключён'}
                  action={
                    <AppButton
                      variant="secondary"
                      size="xs"
                      onClick={() => setActiveTab('settings')}
                    >
                      Настроить
                    </AppButton>
                  }
                >
                  {localConfig.status === 'error' && localConfig.errorMessage
                    ? localConfig.errorMessage
                    : 'Прямая генерация документов по тегам и шаблонам работает независимо от LLM.'}
                </StatusBanner>
              )}

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Тип формируемого документа:
                </label>
                <AppSelect
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  className="font-medium"
                >
                  {DOC_TYPE_PRESETS.map((presetTitle) => (
                    <option key={presetTitle} value={presetTitle}>
                      {presetTitle}
                    </option>
                  ))}
                  <option value="__custom__">Свой тип документа (указать вручную...)</option>
                </AppSelect>
                {docType === '__custom__' && (
                  <AppInput
                    type="text"
                    compact
                    value={customDocType}
                    onChange={(e) => setCustomDocType(e.target.value)}
                    placeholder="Например: Наряд-допуск на работы на высоте"
                    autoFocus
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Строка базы ({currentTab.name}):
                </label>
                <AppSelect
                  value={targetRowId}
                  onChange={(e) => setTargetRowId(e.target.value)}
                >
                  {currentTab.rows.map((row, idx) => {
                    const label =
                      row.emp_fio ||
                      row.pos_title ||
                      row.fac_name ||
                      row.med_worker ||
                      (currentTab.columns[0] ? row[currentTab.columns[0].id] : '') ||
                      `Строка #${idx + 1}`;
                    return (
                      <option key={row.id} value={row.id}>
                        #{idx + 1}: {String(label)}
                      </option>
                    );
                  })}
                </AppSelect>
              </div>

              <div className="p-3 bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200/80 dark:border-purple-900/60 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-purple-950 dark:text-purple-200">
                    Учесть общие нормативные акты ({docsPool.length})
                  </span>
                  <input
                    type="checkbox"
                    checked={includeNormativeDocs}
                    onChange={(e) => setIncludeNormativeDocs(e.target.checked)}
                    className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500"
                  />
                </div>
                <p className="text-[11px] text-purple-800/80 dark:text-purple-400">
                  Выдержки из загруженных ГОСТ, Приказов Минтруда 772н и 766н передаются в промпт модели.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Дополнительные требования к содержанию:
                </label>
                <AppTextarea
                  rows={4}
                  mono
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                />
              </div>

              <AppButton
                variant="primary"
                size="md"
                loading={isGenerating}
                disabled={!targetRow}
                onClick={handleRunGeneration}
                icon={
                  isGenerating ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )
                }
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 rounded-xl"
              >
                {isGenerating ? 'Идет генерация документа...' : 'Сгенерировать документ'}
              </AppButton>
            </div>

            <div className="md:col-span-7 flex flex-col bg-slate-50/50 dark:bg-slate-950/40 p-5 overflow-hidden">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                    Результат генерации (доступен для редактирования):
                  </span>
                </div>
                {resultModelUsed && (
                  <span className="text-[11px] font-mono text-slate-500">
                    {resultModelUsed}
                  </span>
                )}
              </div>

              <textarea
                value={generatedText}
                onChange={(e) => setGeneratedText(e.target.value)}
                placeholder="Здесь появится готовый документ. Вы сможете отредактировать любые пункты перед сохранением в Word или PDF."
                className="flex-1 w-full p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-serif text-slate-800 dark:text-slate-200 text-xs leading-relaxed resize-none focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              />

              <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
                <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                  {generatedText ? `Символов: ${generatedText.length}` : 'Готов к генерации'}
                </span>

                <div className="flex items-center gap-2">
                  <AppButton
                    variant="primary"
                    size="md"
                    disabled={!generatedText}
                    onClick={handleDownloadDocx}
                    icon={<Download className="w-3.5 h-3.5" />}
                  >
                    Сохранить DOCX
                  </AppButton>
                  <AppButton
                    variant="danger"
                    size="md"
                    disabled={!generatedText}
                    onClick={handleDownloadPdf}
                    icon={<Download className="w-3.5 h-3.5" />}
                  >
                    Сохранить PDF
                  </AppButton>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-5 text-xs">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Настройки подключения провайдера LLM
                </h3>
                <p className="text-slate-500 dark:text-slate-400">
                  Выберите локальный сервер на ПК (Ollama, LM Studio, vLLM) или внешний облачный API с готовыми пресетами моделей.
                </p>
              </div>

              <div className="space-y-4 p-5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800">
                {/* Provider Dropdown */}
                <div>
                  <label
                    htmlFor="llm-provider-select"
                    className="block font-semibold text-slate-800 dark:text-slate-200 mb-1.5"
                  >
                    Провайдер LLM:
                  </label>
                  <AppSelect
                    id="llm-provider-select"
                    value={localConfig.providerId}
                    onChange={(e) => handleSelectProvider(e.target.value)}
                    className="font-medium"
                  >
                    <optgroup label="Локальные серверы (автономно на ПК)">
                      {localPresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Облачные и внешние API">
                      {apiPresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  </AppSelect>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {currentPreset.description}
                  </p>
                </div>

                {/* Endpoint URL */}
                <div>
                  <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                    Адрес API (Endpoint URL):
                  </label>
                  <AppInput
                    type="text"
                    mono
                    value={localConfig.endpoint}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        endpoint: e.target.value,
                        status: 'idle'
                      })
                    }
                    placeholder={currentPreset.defaultEndpoint}
                  />
                </div>

                {/* API Key (shown for API providers or optional custom token) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-800 dark:text-slate-200">
                      {currentPreset.requiresApiKey
                        ? 'API-ключ / Токен авторизации (обязательно для выбранного API):'
                        : 'Токен авторизации (опционально, для локальных серверов без ключа — пусто):'}
                    </label>
                  </div>
                  <div className="relative flex items-center">
                    <AppInput
                      type={showApiKey ? 'text' : 'password'}
                      mono
                      value={localConfig.apiKey || ''}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          apiKey: e.target.value,
                          status: 'idle'
                        })
                      }
                      placeholder={
                        currentPreset.requiresApiKey
                          ? 'Вставьте ключ провайдера (хранится локально в конфигурации базы)'
                          : 'Не требуется для стандартного локального запуска'
                      }
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="absolute right-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                      title={showApiKey ? 'Скрыть ключ' : 'Показать ключ'}
                    >
                      {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Model Preset Selector + Editable Model Name */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                      Пресет популярной модели:
                    </label>
                    <AppSelect
                      mono
                      value={modelChoices.includes(localConfig.model) ? localConfig.model : '__custom__'}
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') {
                          setLocalConfig({ ...localConfig, model: e.target.value });
                        }
                      }}
                    >
                      {modelChoices.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                      <option value="__custom__">Своя модель (ввести вручную →)</option>
                    </AppSelect>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                      Идентификатор модели:
                    </label>
                    <AppInput
                      type="text"
                      mono
                      value={localConfig.model}
                      onChange={(e) => setLocalConfig({ ...localConfig, model: e.target.value })}
                      placeholder={currentPreset.defaultModel}
                    />
                  </div>
                </div>

                {/* Temperature & Timeout */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                      Температура (точность): <span className="font-mono">{localConfig.temperature}</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={localConfig.temperature}
                      onChange={(e) =>
                        setLocalConfig({ ...localConfig, temperature: Number(e.target.value) })
                      }
                      className="w-full accent-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                      Тайм-аут запроса (мс):
                    </label>
                    <AppInput
                      type="number"
                      compact
                      mono
                      min={5000}
                      max={180000}
                      step={5000}
                      value={localConfig.timeoutMs}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          timeoutMs: Math.max(5000, Number(e.target.value) || 45000)
                        })
                      }
                    />
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <AppButton
                    variant="primary"
                    size="md"
                    loading={isTestingConnection}
                    onClick={handleTestConnection}
                    icon={
                      isTestingConnection ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )
                    }
                    className="bg-indigo-600 hover:bg-indigo-700"
                  >
                    Проверить подключение
                  </AppButton>

                  <AppButton
                    variant="secondary"
                    size="md"
                    disabled={!isSettingsDirty}
                    onClick={handleSaveSettingsOnly}
                  >
                    Сохранить настройки
                  </AppButton>

                  <AppButton
                    variant="ghost"
                    size="md"
                    disabled={!isSettingsDirty}
                    onClick={handleCancelSettings}
                  >
                    Отмена
                  </AppButton>
                </div>

                {/* Connection Test Result Box — unmistakable RED highlight on error */}
                {connectionFeedback.type === 'error' && (
                  <StatusBanner
                    variant="error"
                    role="alert"
                    className="border-2 !border-red-500 dark:!border-red-600"
                    title={
                      <span className="font-bold text-red-700 dark:text-red-300">
                        Тест подключения не пройден — ошибка связи с LLM
                      </span>
                    }
                  >
                    <div className="font-mono text-[11px] break-words text-red-800 dark:text-red-200">
                      {connectionFeedback.message}
                    </div>
                  </StatusBanner>
                )}

                {connectionFeedback.type === 'success' && (
                  <StatusBanner
                    variant="success"
                    title="Соединение активно"
                  >
                    <div className="font-mono text-[11px] break-words">
                      {connectionFeedback.message}
                    </div>
                  </StatusBanner>
                )}

                {connectionFeedback.type === 'testing' && (
                  <StatusBanner
                    variant="info"
                    icon={<RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600 shrink-0 mt-0.5" />}
                  >
                    <span className="font-mono text-[11px]">{connectionFeedback.message}</span>
                  </StatusBanner>
                )}
              </div>

              {/* Provider Setup Hint & Offline Tag Generation Clarification */}
              <div className="p-4 bg-slate-100 dark:bg-slate-800/60 rounded-xl space-y-2 border border-slate-200 dark:border-slate-700">
                <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-blue-600" />
                  <span>Памятка по провайдеру «{currentPreset.name}»</span>
                </div>
                <p className="text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                  {currentPreset.setupHint}
                </p>
                <p className="text-slate-600 dark:text-slate-400 text-[11px] pt-1 border-t border-slate-200 dark:border-slate-700">
                  Обратите внимание: если LLM не подключена, вы по-прежнему можете формировать все приказы, инструкции и протоколы в Word (.docx) и PDF через кнопку <strong>«Шаблоны»</strong> — данные из таблиц подставляются по тегам напрямую.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Журнал генераций ИИ ({llmLogs.length})
              </h3>
              {llmLogs.length > 0 && (
                <span className="text-[11px] text-slate-500">
                  Нажмите на запись или кнопку просмотра, чтобы открыть, скопировать или экспортировать полный текст
                </span>
              )}
            </div>

            {llmLogs.length === 0 ? (
              <p className="text-center text-slate-400 py-12">Журнал генераций для этой организации пуст</p>
            ) : (
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full border-collapse">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-left">
                    <tr>
                      <th className="px-3.5 py-2.5 border-r border-slate-200 dark:border-slate-700">Дата и время</th>
                      <th className="px-3.5 py-2.5 border-r border-slate-200 dark:border-slate-700">Шаблон/Тип</th>
                      <th className="px-3.5 py-2.5 border-r border-slate-200 dark:border-slate-700">Объект / Сотрудник</th>
                      <th className="px-3.5 py-2.5 border-r border-slate-200 dark:border-slate-700">Провайдер / Модель</th>
                      <th className="px-3.5 py-2.5 border-r border-slate-200 dark:border-slate-700">Фрагмент документа</th>
                      <th className="px-3.5 py-2.5 text-center w-28">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {llmLogs.map((log) => (
                      <tr
                        key={log.id}
                        onClick={() => setSelectedLog(log)}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                      >
                        <td className="px-3.5 py-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-slate-500 tabular-nums">
                          {log.timestamp}
                        </td>
                        <td className="px-3.5 py-2.5 border-r border-slate-200/60 dark:border-slate-800 font-medium text-slate-900 dark:text-slate-100">
                          {log.templateName}
                        </td>
                        <td className="px-3.5 py-2.5 border-r border-slate-200/60 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                          {log.rowIdentifier}
                        </td>
                        <td className="px-3.5 py-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-indigo-600 dark:text-indigo-400">
                          {log.modelUsed}
                        </td>
                        <td className="px-3.5 py-2.5 border-r border-slate-200/60 dark:border-slate-800 text-slate-500 font-mono text-[11px] truncate max-w-xs">
                          {log.outputSnippet}
                        </td>
                        <td
                          className="px-2 py-2 text-center whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setSelectedLog(log)}
                              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 rounded cursor-pointer"
                              title="Просмотреть полный текст"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyLog(log)}
                              className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 rounded cursor-pointer"
                              title="Копировать полный текст"
                            >
                              {copiedLogId === log.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExportLogTxt(log)}
                              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded cursor-pointer"
                              title="Экспорт полного текста в .TXT"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </AppModal>

      {/* Full Output Log Viewer Modal */}
      <AppModal
        isOpen={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        layer="nested"
        size="4xl"
        heightClass="max-h-[88vh]"
        icon={<FileText className="w-5 h-5" />}
        iconTone="indigo"
        title={selectedLog ? selectedLog.templateName : 'Запись журнала LLM'}
        subtitle={
          selectedLog
            ? `${selectedLog.timestamp} · ${selectedLog.tabName}: ${selectedLog.rowIdentifier} · ${selectedLog.modelUsed}`
            : ''
        }
        footer={
          selectedLog && (
            <div className="w-full flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                Символов: {getLogFullText(selectedLog).length}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <AppButton
                  variant="secondary"
                  size="sm"
                  onClick={() => handleCopyLog(selectedLog)}
                  icon={
                    copiedLogId === selectedLog.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )
                  }
                >
                  Копировать текст
                </AppButton>
                <AppButton
                  variant="secondary"
                  size="sm"
                  onClick={() => handleExportLogTxt(selectedLog)}
                  icon={<Download className="w-3.5 h-3.5" />}
                >
                  Экспорт .TXT
                </AppButton>
                <AppButton
                  variant="secondary"
                  size="sm"
                  onClick={() => handleExportLogDocx(selectedLog)}
                  icon={<Download className="w-3.5 h-3.5" />}
                >
                  Скачать .DOCX
                </AppButton>
                <AppButton
                  variant="primary"
                  size="sm"
                  onClick={() => handleLoadLogToStudio(selectedLog)}
                  icon={<Sparkles className="w-3.5 h-3.5" />}
                >
                  Открыть в редакторе
                </AppButton>
              </div>
            </div>
          )
        }
      >
        {selectedLog && (
          <div className="flex-1 overflow-y-auto p-6 space-y-3 text-xs">
            {selectedLog.promptSummary && (
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-lg text-[11px] text-slate-600 dark:text-slate-300">
                <span className="font-semibold">Требования запроса:</span> {selectedLog.promptSummary}
              </div>
            )}
            <pre className="w-full p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-serif text-slate-800 dark:text-slate-200 text-xs leading-relaxed whitespace-pre-wrap select-text">
              {getLogFullText(selectedLog)}
            </pre>
          </div>
        )}
      </AppModal>
    </>
  );
};
