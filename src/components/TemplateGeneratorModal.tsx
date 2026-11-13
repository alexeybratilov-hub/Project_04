import React, { useState } from 'react';
import { 
  X, FileText, Download, Check, Upload, 
  BookOpen, Eye, Layers, FileDown, RefreshCw 
} from 'lucide-react';
import { DocumentTemplate, LegalEntityProfile, Row, Tab, Tag } from '../types/database';
import { documentGenerator } from '../services/documentGenerator';

interface TemplateGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: DocumentTemplate[];
  currentTab: Tab;
  allTabs: Tab[];
  tags: Tag[];
  entityProfile?: LegalEntityProfile;
  selectedRowIds?: string[];
  onOpenTagsModal: () => void;
  onSaveTemplates: (templates: DocumentTemplate[]) => void;
}

export const TemplateGeneratorModal: React.FC<TemplateGeneratorModalProps> = ({
  isOpen,
  onClose,
  templates,
  currentTab,
  allTabs,
  tags,
  entityProfile,
  selectedRowIds,
  onOpenTagsModal,
  onSaveTemplates
}) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    templates.find((t) => t.tabId === currentTab.id)?.id || templates[0]?.id || ''
  );
  const [targetRowId, setTargetRowId] = useState<string>(
    selectedRowIds && selectedRowIds.length > 0 ? selectedRowIds[0] : currentTab.rows[0]?.id || ''
  );
  const [isBatchMode, setIsBatchMode] = useState<boolean>(selectedRowIds ? selectedRowIds.length > 1 : false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [customUploadName, setCustomUploadName] = useState('');
  const [customUploadContent, setCustomUploadContent] = useState('');
  const [customUploadNaming, setCustomUploadNaming] = useState('{ФИО}_документ_2026.docx');
  const [showUploadForm, setShowUploadForm] = useState(false);

  if (!isOpen) return null;

  const currentTemplate = templates.find((t) => t.id === selectedTemplateId) || templates[0];
  const targetRow = currentTab.rows.find((r) => r.id === targetRowId) || currentTab.rows[0];

  // Preview generated text for currently selected row
  const previewText = currentTemplate && targetRow
    ? documentGenerator.resolveTemplateTags(
        currentTemplate.contentTemplate,
        targetRow,
        currentTab,
        allTabs,
        tags,
        entityProfile
      )
    : 'Выберите строку и шаблон для предпросмотра';

  const previewFileNameDocx = currentTemplate && targetRow
    ? documentGenerator.resolveFileName(currentTemplate.namingPattern, targetRow, currentTab, allTabs, tags, 'docx', entityProfile)
    : 'document.docx';

  const previewFileNamePdf = currentTemplate && targetRow
    ? documentGenerator.resolveFileName(currentTemplate.namingPattern, targetRow, currentTab, allTabs, tags, 'pdf', entityProfile)
    : 'document.pdf';

  // Single file generate DOCX
  const handleGenerateDocx = async () => {
    if (!currentTemplate || !targetRow) return;
    setIsGenerating(true);
    try {
      const blob = await documentGenerator.generateDocx(currentTemplate.name, previewText);
      documentGenerator.downloadBlob(blob, previewFileNameDocx);
    } catch (e) {
      console.error(e);
      alert('Ошибка при генерации файла DOCX');
    } finally {
      setIsGenerating(false);
    }
  };

  // Single file generate PDF
  const handleGeneratePdf = async () => {
    if (!currentTemplate || !targetRow) return;
    setIsGenerating(true);
    try {
      const blob = await documentGenerator.generatePdf(currentTemplate.name, previewText);
      documentGenerator.downloadBlob(blob, previewFileNamePdf);
    } catch (e) {
      console.error(e);
      alert('Ошибка при генерации файла PDF');
    } finally {
      setIsGenerating(false);
    }
  };

  // Batch generation (for selected rows or all rows in tab)
  const handleBatchGenerate = async (format: 'docx' | 'pdf') => {
    if (!currentTemplate) return;
    const rowsToProcess = selectedRowIds && selectedRowIds.length > 0
      ? currentTab.rows.filter((r) => selectedRowIds.includes(r.id))
      : currentTab.rows;

    if (rowsToProcess.length === 0) {
      alert('В текущей таблице нет строк для генерации');
      return;
    }

    setIsGenerating(true);
    try {
      for (const row of rowsToProcess) {
        const resolvedText = documentGenerator.resolveTemplateTags(
          currentTemplate.contentTemplate,
          row,
          currentTab,
          allTabs,
          tags,
          entityProfile
        );
        const fileName = documentGenerator.resolveFileName(
          currentTemplate.namingPattern,
          row,
          currentTab,
          allTabs,
          tags,
          format,
          entityProfile
        );

        if (format === 'docx') {
          const blob = await documentGenerator.generateDocx(currentTemplate.name, resolvedText);
          documentGenerator.downloadBlob(blob, fileName);
        } else {
          const blob = await documentGenerator.generatePdf(currentTemplate.name, resolvedText);
          documentGenerator.downloadBlob(blob, fileName);
        }
        // Small delay so browser doesn't block parallel downloads
        await new Promise((res) => setTimeout(res, 250));
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка при пакетной генерации');
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle uploading custom template
  const handleUploadNewTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUploadName.trim() || !customUploadContent.trim()) return;

    const newTpl: DocumentTemplate = {
      id: `tpl_custom_${Date.now()}`,
      name: customUploadName.trim(),
      tabId: currentTab.id,
      fileName: `${customUploadName.trim()}.docx`,
      namingPattern: customUploadNaming.trim() || '{ФИО}_документ.docx',
      contentTemplate: customUploadContent.trim()
    };

    const updated = [...templates, newTpl];
    onSaveTemplates(updated);
    setSelectedTemplateId(newTpl.id);
    setShowUploadForm(false);
    setCustomUploadName('');
    setCustomUploadContent('');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-5xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 rounded-lg">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Генератор документов по тегам (DOCX и PDF)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Заполнение шаблонов приказов, протоколов, направлений на медосмотр и карточек СИЗ
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body: Split Left Config, Right Live Preview */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Left: Configuration & Template Selector (5 cols) */}
          <div className="md:col-span-5 p-5 overflow-y-auto space-y-5 text-xs">
            {/* Template Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-800 dark:text-slate-200">
                  Выберите шаблон документа:
                </label>
                <button
                  onClick={() => setShowUploadForm(!showUploadForm)}
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium text-[11px]"
                >
                  {showUploadForm ? 'Отмена' : '+ Загрузить свой'}
                </button>
              </div>

              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-slate-100"
              >
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Custom Template Upload Form */}
            {showUploadForm && (
              <form onSubmit={handleUploadNewTemplate} className="p-3.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3 animate-in fade-in-50 duration-100">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Новый шаблон документа
                  </span>
                  {/* Button to open Tags as required by ТЗ 2.5 */}
                  <button
                    type="button"
                    onClick={onOpenTagsModal}
                    className="flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                  >
                    <BookOpen className="w-3 h-3" />
                    <span>Открыть вкладку Теги</span>
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Название шаблона:</label>
                  <input
                    type="text"
                    placeholder="Например: Акт проверки рабочих мест"
                    value={customUploadName}
                    onChange={(e) => setCustomUploadName(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Шаблон имени файла:</label>
                  <input
                    type="text"
                    value={customUploadNaming}
                    onChange={(e) => setCustomUploadNaming(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Текст с тегами &#123;тег&#125;:</label>
                  <textarea
                    rows={5}
                    placeholder="Вставьте текст шаблона с плейсхолдерами {ФИО}, {Должность}..."
                    value={customUploadContent}
                    onChange={(e) => setCustomUploadContent(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded font-mono text-[11px]"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
                >
                  Сохранить шаблон
                </button>
              </form>
            )}

            {/* Target Row Selection */}
            <div className="space-y-2">
              <label className="font-semibold text-slate-800 dark:text-slate-200 block">
                Строка для подстановки данных:
              </label>
              <select
                value={targetRowId}
                onChange={(e) => setTargetRowId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
              >
                {currentTab.rows.map((row, idx) => {
                  const label = row.emp_fio || row.pos_title || row.fac_name || row.med_worker || row.siz_item || `Строка #${idx + 1}`;
                  return (
                    <option key={row.id} value={row.id}>
                      #{idx + 1}: {label}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Tags button shortcut */}
            <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/50 rounded-xl flex items-center justify-between">
              <div>
                <p className="font-semibold text-indigo-950 dark:text-indigo-200 text-xs">
                  Справочник тегов &#123;Имя_тега&#125;
                </p>
                <p className="text-[11px] text-indigo-800/80 dark:text-indigo-400">
                  Всего зарегистрировано {tags.length} тегов
                </p>
              </div>
              <button
                onClick={onOpenTagsModal}
                className="px-2.5 py-1 bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700 rounded-lg font-medium hover:bg-indigo-50 transition-colors"
              >
                Открыть теги
              </button>
            </div>

            {/* Batch mode toggle */}
            <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Пакетная генерация
                </span>
                <input
                  type="checkbox"
                  checked={isBatchMode}
                  onChange={(e) => setIsBatchMode(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                {isBatchMode
                  ? selectedRowIds && selectedRowIds.length > 0
                    ? `Будет сгенерировано ${selectedRowIds.length} файлов по выбранным строкам`
                    : `Будет сгенерировано ${currentTab.rows.length} файлов по всей таблице`
                  : 'Генерация для одной выбранной строки'}
              </p>
            </div>
          </div>

          {/* Right: Live Preview & Download (7 cols) */}
          <div className="md:col-span-7 flex flex-col bg-slate-50/50 dark:bg-slate-950/40 p-5 overflow-hidden">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-slate-400" />
                <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                  Предпросмотр документа:
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-xs">
                {previewFileNameDocx}
              </span>
            </div>

            {/* Document sheet simulator */}
            <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-inner font-serif text-slate-800 dark:text-slate-200 text-xs leading-relaxed whitespace-pre-wrap select-text">
              {previewText}
            </div>

            {/* Download Buttons Bar */}
            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <span className="text-[11px] text-slate-400">
                Форматы: <strong className="text-slate-700 dark:text-slate-300">Word (.docx)</strong> и <strong className="text-slate-700 dark:text-slate-300">PDF</strong>
              </span>

              <div className="flex items-center gap-2">
                {isBatchMode ? (
                  <>
                    <button
                      onClick={() => handleBatchGenerate('docx')}
                      disabled={isGenerating}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg font-semibold text-xs shadow-xs transition-colors flex items-center gap-1.5"
                    >
                      {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                      <span>Скачать пакет DOCX</span>
                    </button>
                    <button
                      onClick={() => handleBatchGenerate('pdf')}
                      disabled={isGenerating}
                      className="px-3.5 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white rounded-lg font-semibold text-xs shadow-xs transition-colors flex items-center gap-1.5"
                    >
                      {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                      <span>Скачать пакет PDF</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleGenerateDocx}
                      disabled={isGenerating}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg font-semibold text-xs shadow-xs transition-colors flex items-center gap-1.5"
                    >
                      {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      <span>Скачать .DOCX</span>
                    </button>
                    <button
                      onClick={handleGeneratePdf}
                      disabled={isGenerating}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white rounded-lg font-semibold text-xs shadow-xs transition-colors flex items-center gap-1.5"
                    >
                      {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      <span>Скачать .PDF</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
