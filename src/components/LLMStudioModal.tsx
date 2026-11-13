import React, { useState, useEffect, useRef } from 'react';
import {
  X, Cpu, Play, Download, RefreshCw, FileText, Sparkles,
  AlertCircle, CheckCircle2, Eye, EyeOff, Info
} from 'lucide-react';
import { AttachedDoc, LegalEntityProfile, LLMConfig, LLMGenerationLog, Tab, Tag } from '../types/database';
import { ollamaService } from '../services/ollamaService';
import { documentGenerator } from '../services/documentGenerator';
import { createUniqueId } from '../services/integrityService';
import { getLLMProviderPreset, LLM_PROVIDER_PRESETS, normalizeLLMConfig } from '../data/llmProviders';
import { inferDocumentCategory } from '../services/generatedDocsService';
import { useToast } from './ui/ToastProvider';

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
  const [docType, setDocType] = useState<string>('Инструкция по охране труда (ИОТ)');
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

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

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

  const handleSaveSettingsOnly = () => {
    onSaveLLMConfig(localConfig);
    showToast(`Настройки провайдера «${currentPreset.name}» сохранены`, 'success');
  };

  const handleRunGeneration = async () => {
    if (!targetRow) {
      showToast('Выберите строку таблицы для генерации', 'warning');
      return;
    }

    setIsGenerating(true);
    try {
      const result = await ollamaService.generateDocument({
        tab: currentTab,
        row: targetRow,
        templateTitle: docType,
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
        templateName: docType,
        tabName: currentTab.name,
        rowIdentifier: String(targetRow.emp_fio || targetRow.pos_title || targetRow.id),
        modelUsed: result.modelUsed,
        promptSummary: customInstructions.slice(0, 100),
        outputSnippet: result.text.slice(0, 150) + '...',
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
    const cleanTitle = docType.replace(/[/\\?%*:|"<>]/g, '_').trim();
    const rowLabel = targetRow
      ? String(targetRow.emp_fio || targetRow.pos_title || targetRow.fac_name || '').trim()
      : '';
    const cleanRow = rowLabel ? `_${rowLabel.replace(/[/\\?%*:|"<>]/g, '_')}` : '';
    return `${cleanTitle}${cleanRow}.${ext}`;
  };

  const handleDownloadDocx = async () => {
    if (!generatedText) return;
    const filename = buildDocFileName('docx');
    const blob = await documentGenerator.generateDocx(docType, generatedText);
    const category = inferDocumentCategory(docType, currentTab.name);
    if (onRecordGeneratedDoc) {
      await onRecordGeneratedDoc({
        title: docType,
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
    const filename = buildDocFileName('pdf');
    const blob = await documentGenerator.generatePdf(docType, generatedText);
    const category = inferDocumentCategory(docType, currentTab.name);
    if (onRecordGeneratedDoc) {
      await onRecordGeneratedDoc({
        title: docType,
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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-6xl max-h-[94vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 shrink-0 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400 rounded-lg shrink-0">
              <Cpu className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  LLM-студия и настройки ИИ
                </h2>
                <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
                  · {currentPreset.name} ({localConfig.model})
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {entityProfile?.shortName ? `${entityProfile.shortName} · ` : ''}
                {localConfig.providerKind === 'local'
                  ? 'Локальный сервер ИИ без передачи данных в облако'
                  : 'Подключение через внешний API провайдера'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs font-medium shrink-0">
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
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 ml-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
              aria-label="Закрыть"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        {activeTab === 'generate' && (
          <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
            <div className="md:col-span-5 p-5 overflow-y-auto space-y-4 text-xs">
              {localConfig.status !== 'connected' && (
                <div
                  className={`p-3 rounded-xl border flex items-start justify-between gap-2 ${
                    localConfig.status === 'error'
                      ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200'
                      : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                  }`}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="font-semibold">
                        {localConfig.status === 'error' ? 'Ошибка подключения к LLM' : 'LLM-сервер не подключён'}
                      </div>
                      <p className="text-[11px] opacity-90">
                        {localConfig.status === 'error' && localConfig.errorMessage
                          ? localConfig.errorMessage
                          : 'Прямая генерация документов по тегам и шаблонам работает независимо от LLM.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('settings')}
                    className="px-2 py-1 bg-white dark:bg-slate-900 border border-current/20 rounded text-[11px] font-semibold shrink-0 cursor-pointer"
                  >
                    Настроить
                  </button>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Тип формируемого документа:
                </label>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-medium text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="Инструкция по охране труда (ИОТ)">Инструкция по охране труда (ИОТ)</option>
                  <option value="Приказ о назначении ответственных лиц по ОТ">Приказ о назначении ответственных по ОТ</option>
                  <option value="Положение о системе управления охраной труда (СУОТ)">Положение о СУОТ</option>
                  <option value="Протокол проверки знаний требований охраны труда">Протокол проверки знаний ОТ</option>
                  <option value="Акт расследования обстоятельств микротравмы">Акт расследования микротравмы</option>
                  <option value="Программа первичного инструктажа на рабочем месте">Программа первичного инструктажа</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Строка базы ({currentTab.name}):
                </label>
                <select
                  value={targetRowId}
                  onChange={(e) => setTargetRowId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100"
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
                </select>
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
                <textarea
                  rows={4}
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>

              <button
                type="button"
                onClick={handleRunGeneration}
                disabled={isGenerating || !targetRow}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Идет генерация документа...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Сгенерировать документ</span>
                  </>
                )}
              </button>
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
                  <button
                    type="button"
                    onClick={handleDownloadDocx}
                    disabled={!generatedText}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-lg font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Сохранить DOCX</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    disabled={!generatedText}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-lg font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Сохранить PDF</span>
                  </button>
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
                  <select
                    id="llm-provider-select"
                    value={localConfig.providerId}
                    onChange={(e) => handleSelectProvider(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-slate-100"
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
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {currentPreset.description}
                  </p>
                </div>

                {/* Endpoint URL */}
                <div>
                  <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                    Адрес API (Endpoint URL):
                  </label>
                  <input
                    type="text"
                    value={localConfig.endpoint}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        endpoint: e.target.value,
                        status: 'idle'
                      })
                    }
                    placeholder={currentPreset.defaultEndpoint}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-xs"
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
                    <input
                      type={showApiKey ? 'text' : 'password'}
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
                      className="w-full pl-3 pr-9 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-xs"
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
                    <select
                      value={modelChoices.includes(localConfig.model) ? localConfig.model : '__custom__'}
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') {
                          setLocalConfig({ ...localConfig, model: e.target.value });
                        }
                      }}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-xs"
                    >
                      {modelChoices.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                      <option value="__custom__">Своя модель (ввести вручную →)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                      Идентификатор модели:
                    </label>
                    <input
                      type="text"
                      value={localConfig.model}
                      onChange={(e) => setLocalConfig({ ...localConfig, model: e.target.value })}
                      placeholder={currentPreset.defaultModel}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-xs"
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
                    <input
                      type="number"
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
                      className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-xs"
                    />
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={isTestingConnection}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    {isTestingConnection ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    <span>Проверить подключение</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveSettingsOnly}
                    className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-lg font-medium transition-colors cursor-pointer"
                  >
                    Сохранить настройки
                  </button>
                </div>

                {/* Connection Test Result Box — unmistakable RED highlight on error */}
                {connectionFeedback.type === 'error' && (
                  <div
                    role="alert"
                    className="p-3.5 bg-red-50 dark:bg-red-950/60 border-2 border-red-500 dark:border-red-600 rounded-xl flex items-start gap-2.5 text-red-900 dark:text-red-100"
                  >
                    <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    <div className="space-y-1 min-w-0">
                      <div className="font-bold text-xs text-red-700 dark:text-red-300">
                        Тест подключения не пройден — ошибка связи с LLM
                      </div>
                      <div className="font-mono text-[11px] break-words text-red-800 dark:text-red-200">
                        {connectionFeedback.message}
                      </div>
                    </div>
                  </div>
                )}

                {connectionFeedback.type === 'success' && (
                  <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-400 dark:border-emerald-700 rounded-xl flex items-start gap-2.5 text-emerald-900 dark:text-emerald-100">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-semibold text-xs text-emerald-800 dark:text-emerald-300">
                        Соединение активно
                      </div>
                      <div className="font-mono text-[11px] break-words">
                        {connectionFeedback.message}
                      </div>
                    </div>
                  </div>
                )}

                {connectionFeedback.type === 'testing' && (
                  <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600 shrink-0" />
                    <span>{connectionFeedback.message}</span>
                  </div>
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
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Журнал генераций ИИ ({llmLogs.length})
            </h3>

            {llmLogs.length === 0 ? (
              <p className="text-center text-slate-400 py-12">Журнал генераций для этой организации пуст</p>
            ) : (
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full border-collapse">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-left">
                    <tr>
                      <th className="px-4 py-2.5 border-r border-slate-200 dark:border-slate-700">Дата и время</th>
                      <th className="px-4 py-2.5 border-r border-slate-200 dark:border-slate-700">Шаблон/Тип</th>
                      <th className="px-4 py-2.5 border-r border-slate-200 dark:border-slate-700">Объект / Сотрудник</th>
                      <th className="px-4 py-2.5 border-r border-slate-200 dark:border-slate-700">Провайдер / Модель</th>
                      <th className="px-4 py-2.5">Фрагмент документа</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {llmLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-slate-500 tabular-nums">
                          {log.timestamp}
                        </td>
                        <td className="px-4 py-2.5 border-r border-slate-200/60 dark:border-slate-800 font-medium text-slate-900 dark:text-slate-100">
                          {log.templateName}
                        </td>
                        <td className="px-4 py-2.5 border-r border-slate-200/60 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                          {log.rowIdentifier}
                        </td>
                        <td className="px-4 py-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-indigo-600 dark:text-indigo-400">
                          {log.modelUsed}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 font-mono text-[11px] truncate max-w-xs">
                          {log.outputSnippet}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
