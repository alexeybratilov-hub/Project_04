import React, { useState, useEffect } from 'react';
import {
  X, BookOpen, Upload, Trash2, Eye,
  File, Globe2
} from 'lucide-react';
import { AttachedDoc, Tab } from '../types/database';

interface NormativeDocsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: Tab;
  normativeDocs: AttachedDoc[];
  onUpdateNormativeDocs: (docs: AttachedDoc[]) => void;
}

export const NormativeDocsModal: React.FC<NormativeDocsModalProps> = ({
  isOpen,
  onClose,
  currentTab,
  normativeDocs,
  onUpdateNormativeDocs
}) => {
  const [selectedDoc, setSelectedDoc] = useState<AttachedDoc | null>(normativeDocs[0] || null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'tab'>('all');

  useEffect(() => {
    if (isOpen) {
      setConfirmDeleteId(null);
      if (!selectedDoc || !normativeDocs.some((d) => d.id === selectedDoc.id)) {
        setSelectedDoc(normativeDocs[0] || null);
      }
    }
  }, [isOpen, normativeDocs, selectedDoc]);

  if (!isOpen) return null;

  const displayedDocs =
    filterMode === 'tab'
      ? normativeDocs.filter(
          (d) =>
            !d.relatedTabName ||
            d.relatedTabName.toLowerCase() === currentTab.name.trim().toLowerCase()
        )
      : normativeDocs;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      const content = event.target?.result;
      const isText = typeof content === 'string';

      const newDoc: AttachedDoc = {
        id: `norm_${Date.now()}`,
        fileName: file.name,
        fileType: file.name.split('.').pop()?.toLowerCase() || 'docx',
        uploadDate: new Date().toISOString().split('T')[0],
        sizeFormatted: `${Math.max(1, Math.round(file.size / 1024))} КБ`,
        relatedTabName: currentTab.name,
        contentSnippet: isText
          ? (content as string).slice(0, 4000)
          : `[Документ ${file.name}, размер: ${Math.max(1, Math.round(file.size / 1024))} КБ. Прикреплен в общую нормативную базу для всех организаций.]`
      };

      const updated = [newDoc, ...normativeDocs];
      onUpdateNormativeDocs(updated);
      setSelectedDoc(newDoc);
    };

    if (file.type.includes('text') || file.name.endsWith('.txt')) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
    e.target.value = '';
  };

  const handleDeleteDoc = (docId: string) => {
    const updated = normativeDocs.filter((d) => d.id !== docId);
    onUpdateNormativeDocs(updated);
    setConfirmDeleteId(null);
    if (selectedDoc?.id === docId) {
      setSelectedDoc(updated[0] || null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-5xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400 rounded-lg">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Общая база нормативных документов (ГОСТ, СП, Приказы)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Globe2 className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                <span>Единая библиотека нормативов — доступна во всех юридических лицах без дублирования</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body: Split View */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Left: Shared Normative Library & Upload (5 cols) */}
          <div className="md:col-span-5 p-5 overflow-y-auto space-y-4 text-xs">
            {/* Upload Area */}
            <div>
              <label className="flex flex-col items-center justify-center w-full h-22 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-purple-500 rounded-xl cursor-pointer bg-slate-50 dark:bg-slate-850 hover:bg-purple-50/30 transition-all">
                <div className="flex flex-col items-center justify-center">
                  <Upload className="w-5 h-5 text-purple-600 mb-1" />
                  <span className="font-semibold text-slate-700 dark:text-slate-300 text-xs">
                    Добавить акт в общую базу (.docx, .pdf, .txt)
                  </span>
                  <span className="text-[10px] text-slate-400 mt-0.5">
                    Станет доступен для всех организаций в приложении
                  </span>
                </div>
                <input
                  type="file"
                  accept=".docx,.pdf,.txt,.doc"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Filter */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setFilterMode('all')}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    filterMode === 'all'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Все акты ({normativeDocs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('tab')}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    filterMode === 'tab'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  По теме «{currentTab.name}»
                </button>
              </div>
            </div>

            {/* List */}
            <div className="space-y-2">
              {displayedDocs.length === 0 ? (
                <p className="p-4 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                  Нормативные документы не найдены. Загрузите новый файл выше.
                </p>
              ) : (
                displayedDocs.map((doc) => {
                  const isSelected = selectedDoc?.id === doc.id;
                  const isConfirming = confirmDeleteId === doc.id;
                  return (
                    <div
                      key={doc.id}
                      onClick={() => setSelectedDoc(doc)}
                      className={`p-3 rounded-lg border transition-all cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-purple-50/80 dark:bg-purple-950/40 border-purple-300 dark:border-purple-700 shadow-xs'
                          : 'bg-white dark:bg-slate-850 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <File className="w-4 h-4 text-purple-600 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 dark:text-slate-200 break-words leading-snug">
                              {doc.fileName}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {doc.sizeFormatted} · добавлено {doc.uploadDate}
                              {doc.relatedTabName ? ` · раздел: ${doc.relatedTabName}` : ''}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(isConfirming ? null : doc.id);
                          }}
                          className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors shrink-0"
                          title="Удалить из общей нормативки"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {isConfirming && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 rounded flex items-center justify-between gap-2 text-[11px]"
                        >
                          <span className="text-red-800 dark:text-red-200">Удалить для всех юрлиц?</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                            >
                              Нет
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteDoc(doc.id)}
                              className="px-2 py-0.5 bg-red-600 text-white rounded font-semibold"
                            >
                              Удалить
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900 rounded-lg text-purple-900 dark:text-purple-300 text-[11px] leading-relaxed">
              <span className="font-semibold">Единая база знаний:</span> У всех юридических лиц отдельные таблицы сотрудников, должностей, СИЗ и медосмотров, но общий справочник нормативно-правовых актов.
            </div>
          </div>

          {/* Right: Document Viewer / Snippet (7 cols) */}
          <div className="md:col-span-7 flex flex-col bg-slate-50/50 dark:bg-slate-950/40 p-5 overflow-hidden">
            {selectedDoc ? (
              <>
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Eye className="w-4 h-4 text-purple-600 shrink-0" />
                    <span className="font-semibold text-xs text-slate-800 dark:text-slate-200 truncate">
                      {selectedDoc.fileName}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 shrink-0">
                    Формат: {selectedDoc.fileType.toUpperCase()}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-inner font-mono text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap select-text">
                  {selectedDoc.contentSnippet || 'Содержимое документа готово к использованию.'}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
                Выберите документ из списка слева для просмотра
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3.5 bg-slate-50/60 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 text-xs">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 rounded-lg font-medium transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
