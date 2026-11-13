import React, { useState } from 'react';
import { 
  X, Cpu, Play, CheckCircle2, AlertCircle, 
  Settings, Download, RefreshCw, FileText, 
  History, Sliders, Check, ShieldCheck, Sparkles 
} from 'lucide-react';
import { AttachedDoc, LLMConfig, LLMGenerationLog, Row, Tab, Tag } from '../types/database';
import { ollamaService } from '../services/ollamaService';
import { documentGenerator } from '../services/documentGenerator';

interface LLMStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: Tab;
  allTabs: Tab[];
  tags: Tag[];
  sharedNormativeDocs?: AttachedDoc[];
  llmConfig: LLMConfig;
  llmLogs: LLMGenerationLog[];
  selectedRowId?: string;
  onSaveLLMConfig: (config: LLMConfig) => void;
  onAddLLMLog: (log: LLMGenerationLog) => void;
}

export const LLMStudioModal: React.FC<LLMStudioModalProps> = ({
  isOpen,
  onClose,
  currentTab,
  allTabs,
  tags,
  sharedNormativeDocs,
  llmConfig,
  llmLogs,
  selectedRowId,
  onSaveLLMConfig,
  onAddLLMLog
}) => {
  const [activeTab, setActiveTab] = useState<'generate' | 'settings' | 'history'>('generate');
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
  const [localConfig, setLocalConfig] = useState<LLMConfig>(llmConfig);
  const [connectionStatusText, setConnectionStatusText] = useState<string | null>(null);

  if (!isOpen) return null;

  const targetRow = currentTab.rows.find((r) => r.id === targetRowId) || currentTab.rows[0];

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionStatusText('Проверка связи с http://localhost:11434...');
    try {
      const result = await ollamaService.checkConnection(localConfig.endpoint);
      if (result.ok) {
        const updatedConfig: LLMConfig = {
          ...localConfig,
          status: 'connected',
          lastChecked: new Date().toLocaleTimeString(),
          availableModels: result.models,
          errorMessage: undefined
        };
        setLocalConfig(updatedConfig);
        onSaveLLMConfig(updatedConfig);
        setConnectionStatusText(`Успешно! Обнаружено моделей: ${result.models.length} (${result.models.join(', ')})`);
      } else {
        const updatedConfig: LLMConfig = {
          ...localConfig,
          status: 'error',
          errorMessage: result.error
        };
        setLocalConfig(updatedConfig);
        onSaveLLMConfig(updatedConfig);
        setConnectionStatusText(result.error || 'Ошибка подключения');
      }
    } catch (e: any) {
      setConnectionStatusText(e.message || 'Ошибка');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleRunGeneration = async () => {
    if (!targetRow) {
      alert('Выберите строку таблицы для генерации');
      return;
    }

    setIsGenerating(true);
    try {
      const docsToPass = includeNormativeDocs
        ? (sharedNormativeDocs && sharedNormativeDocs.length > 0 ? sharedNormativeDocs : currentTab.attachedDocs)
        : [];
      const result = await ollamaService.generateDocument({
        tab: currentTab,
        row: targetRow,
        templateTitle: docType,
        templateRequirements: customInstructions,
        attachedDocs: docsToPass,
        tags,
        allTabs,
        customInstructions,
        llmConfig: localConfig
      });

      setGeneratedText(result.text);
      setResultModelUsed(result.modelUsed);

      // Record in generation log (ТЗ 2.7)
      const newLog: LLMGenerationLog = {
        id: `log_${Date.now()}`,
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
    } catch (err: any) {
      alert('Ошибка при генерации документа: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadDocx = async () => {
    if (!generatedText) return;
    const filename = `${docType.replace(/[/\\?%*:|"<>]/g, '_')}_${new Date().toISOString().split('T')[0]}.docx`;
    const blob = await documentGenerator.generateDocx(docType, generatedText);
    documentGenerator.downloadBlob(blob, filename);
  };

  const handleDownloadPdf = async () => {
    if (!generatedText) return;
    const filename = `${docType.replace(/[/\\?%*:|"<>]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    const blob = await documentGenerator.generatePdf(docType, generatedText);
    documentGenerator.downloadBlob(blob, filename);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-6xl max-h-[94vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400 rounded-lg">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Генерация документов через локальную нейросеть (Ollama)
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-semibold border border-indigo-200 dark:border-indigo-800">
                  {localConfig.model}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                100% локальное исполнение на ПК без интернета и без передачи персональных данных в облако
              </p>
            </div>
          </div>

          {/* Navigation Sub-Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs font-medium">
            <button
              onClick={() => setActiveTab('generate')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                activeTab === 'generate' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Студия генерации
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                activeTab === 'settings' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Подключение (Ollama)
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                activeTab === 'history' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Журнал генераций ({llmLogs.length})
            </button>
            <button
              onClick={onClose}
              className="p-1.5 ml-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        {activeTab === 'generate' && (
          <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
            {/* Left Prompt Setup (5 cols) */}
            <div className="md:col-span-5 p-5 overflow-y-auto space-y-4 text-xs">
              {/* Document Type */}
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Тип формируемого документа:
                </label>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-lg font-medium text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="Инструкция по охране труда (ИОТ)">Инструкция по охране труда (ИОТ)</option>
                  <option value="Приказ о назначении ответственных лиц по ОТ">Приказ о назначении ответственных по ОТ</option>
                  <option value="Положение о системе управления охраной труда (СУОТ)">Положение о СУОТ</option>
                  <option value="Протокол проверки знаний требований охраны труда">Протокол проверки знаний ОТ</option>
                  <option value="Акт расследования обстоятельств микротравмы">Акт расследования микротравмы</option>
                  <option value="Программа первичного инструктажа на рабочем месте">Программа первичного инструктажа</option>
                </select>
              </div>

              {/* Target Row Selector */}
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Строка базы (исходные реквизиты работника/профессии):
                </label>
                <select
                  value={targetRowId}
                  onChange={(e) => setTargetRowId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                >
                  {currentTab.rows.map((row, idx) => {
                    const label = row.emp_fio || row.pos_title || row.fac_name || row.med_worker || `Строка #${idx + 1}`;
                    return (
                      <option key={row.id} value={row.id}>
                        #{idx + 1}: {label}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Normative Documents Toggle */}
              <div className="p-3 bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200/80 dark:border-purple-900/60 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-purple-950 dark:text-purple-200">
                    Учесть нормативные акты вкладки ({currentTab.attachedDocs.length})
                  </span>
                  <input
                    type="checkbox"
                    checked={includeNormativeDocs}
                    onChange={(e) => setIncludeNormativeDocs(e.target.checked)}
                    className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500"
                  />
                </div>
                <p className="text-[11px] text-purple-800/80 dark:text-purple-400">
                  Тексты ГОСТ 12.0.004, Приказа Минтруда 772н и 766н будут переданы в контекстное окно для юридической выверки формулировок.
                </p>
              </div>

              {/* Custom Instructions */}
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-800 dark:text-slate-200 block">
                  Дополнительные требования к содержанию:
                </label>
                <textarea
                  rows={4}
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono"
                  placeholder="Укажите специфические условия работы, оборудование, требования..."
                />
              </div>

              {/* Run Generation Button */}
              <button
                onClick={handleRunGeneration}
                disabled={isGenerating}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white rounded-xl font-semibold shadow-xs flex items-center justify-center gap-2 transition-all"
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

            {/* Right Result Preview & Editable Editor (7 cols) */}
            <div className="md:col-span-7 flex flex-col bg-slate-50/50 dark:bg-slate-950/40 p-5 overflow-hidden">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                    Результат генерации (доступен для правок до сохранения):
                  </span>
                </div>
                {resultModelUsed && (
                  <span className="text-[11px] font-mono text-slate-500">
                    Модель: {resultModelUsed}
                  </span>
                )}
              </div>

              {/* Rich Editable Result Area */}
              <textarea
                value={generatedText}
                onChange={(e) => setGeneratedText(e.target.value)}
                placeholder="Здесь появится готовый документ. Вы сможете отредактировать любые пункты прямо в этом окне перед сохранением в Word или PDF."
                className="flex-1 w-full p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-inner font-serif text-slate-800 dark:text-slate-200 text-xs leading-relaxed resize-none focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              />

              {/* Actions Footer */}
              <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
                <span className="text-[11px] text-slate-500">
                  {generatedText ? `Символов: ${generatedText.length}` : 'Готов к генерации'}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDownloadDocx}
                    disabled={!generatedText}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-lg font-semibold text-xs shadow-xs transition-colors flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Сохранить в DOCX</span>
                  </button>
                  <button
                    onClick={handleDownloadPdf}
                    disabled={!generatedText}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-lg font-semibold text-xs shadow-xs transition-colors flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Сохранить в PDF</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Connection Settings */}
        {activeTab === 'settings' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto space-y-6 text-xs">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Настройки подключения к локальной нейросети (Ollama)
              </h3>
              <p className="text-slate-500">
                Приложение обращается напрямую к Ollama API на вашем компьютере.
              </p>
            </div>

            <div className="space-y-4 p-5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800">
              <div>
                <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                  Адрес API Ollama (по умолчанию http://localhost:11434):
                </label>
                <input
                  type="text"
                  value={localConfig.endpoint}
                  onChange={(e) => setLocalConfig({ ...localConfig, endpoint: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 dark:text-slate-200 mb-1">
                  Имя модели:
                </label>
                <input
                  type="text"
                  value={localConfig.model}
                  onChange={(e) => setLocalConfig({ ...localConfig, model: e.target.value })}
                  placeholder="qwen2.5:7b, llama3.1:8b, mistral..."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono text-xs"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleTestConnection}
                  disabled={isTestingConnection}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold flex items-center gap-2 transition-colors"
                >
                  {isTestingConnection ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  <span>Проверить подключение</span>
                </button>

                <button
                  onClick={() => {
                    onSaveLLMConfig(localConfig);
                    alert('Настройки сохранены');
                  }}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg font-medium transition-colors"
                >
                  Сохранить
                </button>
              </div>

              {connectionStatusText && (
                <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-mono text-[11px] text-slate-700 dark:text-slate-300">
                  {connectionStatusText}
                </div>
              )}
            </div>

            {/* Instruction how to run Ollama */}
            <div className="p-4 bg-slate-100 dark:bg-slate-800/60 rounded-xl space-y-2 border border-slate-200 dark:border-slate-700">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Как запустить Ollama на Windows:
              </span>
              <ol className="list-decimal list-inside space-y-1 text-slate-600 dark:text-slate-400">
                <li>Скачайте и установите бесплатную программу с официального сайта <code className="font-mono text-indigo-600">ollama.com</code></li>
                <li>Откройте командную строку Windows (cmd) и запустите модель:
                  <div className="my-1.5 p-2 bg-slate-900 text-emerald-400 font-mono rounded text-[11px] select-all">
                    ollama run qwen2.5:7b
                  </div>
                </li>
                <li>Для разрешения запросов из веб-интерфейса установите переменную:
                  <div className="my-1.5 p-2 bg-slate-900 text-emerald-400 font-mono rounded text-[11px] select-all">
                    set OLLAMA_ORIGINS=* && ollama serve
                  </div>
                </li>
              </ol>
            </div>
          </div>
        )}

        {/* Tab 3: History / Audit Log */}
        {activeTab === 'history' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Журнал генераций документов ({llmLogs.length})
            </h3>

            {llmLogs.length === 0 ? (
              <p className="text-center text-slate-400 py-12">Журнал генераций пуст</p>
            ) : (
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full border-collapse">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-left">
                    <tr>
                      <th className="px-4 py-2.5 border-r border-slate-200 dark:border-slate-700">Дата и время</th>
                      <th className="px-4 py-2.5 border-r border-slate-200 dark:border-slate-700">Шаблон/Тип</th>
                      <th className="px-4 py-2.5 border-r border-slate-200 dark:border-slate-700">Объект / Сотрудник</th>
                      <th className="px-4 py-2.5 border-r border-slate-200 dark:border-slate-700">Модель</th>
                      <th className="px-4 py-2.5">Фрагмент документа</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {llmLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-850">
                        <td className="px-4 py-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-slate-500">
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
