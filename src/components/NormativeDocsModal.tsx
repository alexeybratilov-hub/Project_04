import React, { useState, useEffect } from 'react';
import {
  X, BookOpen, Upload, Trash2, Eye,
  File, Globe2, Download, CheckCircle2, AlertTriangle
} from 'lucide-react';
import { AttachedDoc, Tab } from '../types/database';
import { localApiClient, sanitizeSafeFilename } from '../services/localApiClient';
import { useToast } from './ui/ToastProvider';

interface NormativeDocsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: Tab;
  normativeDocs: AttachedDoc[];
  onUpdateNormativeDocs: (docs: AttachedDoc[]) => void;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, mime = 'application/octet-stream'): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export const NormativeDocsModal: React.FC<NormativeDocsModalProps> = ({
  isOpen,
  onClose,
  currentTab,
  normativeDocs,
  onUpdateNormativeDocs
}) => {
  const { showToast } = useToast();
  const [selectedDoc, setSelectedDoc] = useState<AttachedDoc | null>(normativeDocs[0] || null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'tab'>('all');
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfirmDeleteId(null);
      if (!selectedDoc || !normativeDocs.some((d) => d.id === selectedDoc.id)) {
        setSelectedDoc(normativeDocs[0] || null);
      }
    }
  }, [isOpen, normativeDocs, selectedDoc]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isNative = localApiClient.isNative();

  const displayedDocs =
    filterMode === 'tab'
      ? normativeDocs.filter(
          (d) =>
            !d.relatedTabName ||
            d.relatedTabName.toLowerCase() === currentTab.name.trim().toLowerCase()
        )
      : normativeDocs;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
      const isText = file.type.includes('text') || ext === 'txt' || ext === 'md';
      const arrayBuffer = await file.arrayBuffer();

      let snippet = '';
      if (isText) {
        snippet = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(arrayBuffer)).slice(0, 6000);
      } else {
        snippet = `[Файл «${file.name}» (${Math.max(1, Math.round(file.size / 1024))} КБ). Сохранен для скачивания и использования в работе.]`;
      }

      const id = `norm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      let storageFileName: string | undefined;
      let dataBase64: string | undefined;

      if (isNative) {
        const candidateName = sanitizeSafeFilename(`${id.slice(-6)}_${file.name}`);
        const writeRes = await localApiClient.saveFileToBucket('normatives', candidateName, arrayBuffer);
        if (!writeRes.ok) {
          showToast(
            writeRes.message || 'Не удалось записать нормативный акт в папку ./normatives/',
            'error'
          );
          return;
        }
        storageFileName = writeRes.safeName;
      } else {
        // Web preview fallback: store up to 1.5 MB inline safely so localStorage isn't blown out
        if (file.size <= 1_500_000) {
          dataBase64 = arrayBufferToBase64(arrayBuffer);
        } else {
          showToast(
            'В веб-предпросмотре файлы >1.5 МБ не кэшируются в браузере. Используйте OT-Baza.exe для хранения крупных файлов в ./normatives/.',
            'warning'
          );
        }
      }

      const newDoc: AttachedDoc = {
        id,
        fileName: file.name,
        fileType: ext,
        uploadDate: new Date().toISOString().split('T')[0],
        sizeFormatted: `${Math.max(1, Math.round(file.size / 1024))} КБ`,
        relatedTabName: currentTab.name,
        contentSnippet: snippet,
        storageFileName,
        dataBase64
      };

      const updated = [newDoc, ...normativeDocs];
      onUpdateNormativeDocs(updated);
      setSelectedDoc(newDoc);
      showToast(
        isNative
          ? `Файл «${file.name}» сохранен в ./normatives/`
          : `Документ «${file.name}» добавлен в библиотеку`,
        'success'
      );
    } catch (err: any) {
      showToast(`Ошибка при загрузке файла: ${err?.message || 'неизвестная ошибка'}`, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownloadDoc = async (doc: AttachedDoc) => {
    try {
      let blob: Blob | null = null;
      if (isNative && doc.storageFileName) {
        blob = await localApiClient.downloadFileFromBucket('normatives', doc.storageFileName);
      } else if (doc.dataBase64) {
        blob = base64ToBlob(doc.dataBase64);
      } else if (doc.contentSnippet) {
        blob = new Blob([doc.contentSnippet], { type: 'text/plain;charset=utf-8' });
      }

      if (!blob) {
        showToast('Бинарное содержимое файла недоступно', 'warning');
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      showToast(err?.message || 'Не удалось скачать файл', 'error');
    }
  };

  const handleDeleteDoc = async (doc: AttachedDoc) => {
    if (isNative && doc.storageFileName) {
      await localApiClient.deleteFileFromBucket('normatives', doc.storageFileName);
    }
    const updated = normativeDocs.filter((d) => d.id !== doc.id);
    onUpdateNormativeDocs(updated);
    setConfirmDeleteId(null);
    if (selectedDoc?.id === doc.id) {
      setSelectedDoc(updated[0] || null);
    }
    showToast(`Норматив «${doc.fileName}» удален`, 'info');
  };

  const hasBinaryStored = (doc: AttachedDoc) =>
    Boolean((isNative && doc.storageFileName) || doc.dataBase64 || doc.contentSnippet);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-5xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 shrink-0">
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
                <span>
                  Единая библиотека нормативов для всех юридических лиц
                  {isNative ? ' · Файлы сохраняются в ./normatives/' : ''}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Left: Library */}
          <div className="md:col-span-5 p-5 overflow-y-auto space-y-4 text-xs">
            <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-purple-500 rounded-xl cursor-pointer bg-slate-50 dark:bg-slate-800/40 hover:bg-purple-50/30 dark:hover:bg-purple-950/20 transition-all px-4 text-center">
              <Upload className="w-5 h-5 text-purple-600 mb-1" />
              <span className="font-semibold text-slate-700 dark:text-slate-200 text-xs">
                {isUploading ? 'Сохранение файла...' : 'Добавить акт в общую базу (.docx, .pdf, .txt)'}
              </span>
              <span className="text-[11px] text-slate-400 mt-0.5">
                {isNative
                  ? 'Содержимое файла физически сохраняется в папку ./normatives/'
                  : 'Встроенная библиотека для всех организаций'}
              </span>
              <input
                type="file"
                accept=".docx,.pdf,.txt,.doc,.md"
                onChange={handleFileUpload}
                disabled={isUploading}
                className="hidden"
              />
            </label>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit">
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

            <div className="space-y-2">
              {displayedDocs.length === 0 ? (
                <p className="p-4 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                  Нормативные документы не найдены.
                </p>
              ) : (
                displayedDocs.map((doc) => {
                  const isSelected = selectedDoc?.id === doc.id;
                  const isConfirming = confirmDeleteId === doc.id;
                  return (
                    <div
                      key={doc.id}
                      onClick={() => setSelectedDoc(doc)}
                      className={`p-3 rounded-lg border transition-colors cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-purple-50/80 dark:bg-purple-950/40 border-purple-300 dark:border-purple-700'
                          : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <File className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 dark:text-slate-100 break-words leading-snug">
                              {doc.fileName}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5 font-mono tabular-nums">
                              {doc.sizeFormatted} · {doc.uploadDate}
                              {doc.relatedTabName ? ` · ${doc.relatedTabName}` : ''}
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
                              onClick={() => handleDeleteDoc(doc)}
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
          </div>

          {/* Right: Document Viewer & Download */}
          <div className="md:col-span-7 flex flex-col bg-slate-50/50 dark:bg-slate-950/40 p-5 overflow-hidden">
            {selectedDoc ? (
              <>
                <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Eye className="w-4 h-4 text-purple-600 shrink-0" />
                    <span className="font-semibold text-xs text-slate-800 dark:text-slate-100 truncate">
                      {selectedDoc.fileName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {selectedDoc.storageFileName || selectedDoc.dataBase64 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Файл сохранен</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Текстовая выдержка</span>
                      </span>
                    )}
                    {hasBinaryStored(selectedDoc) && (
                      <button
                        type="button"
                        onClick={() => handleDownloadDoc(selectedDoc)}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Скачать файл</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap select-text">
                  {selectedDoc.contentSnippet || 'Содержимое документа готово к скачиванию.'}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
                Выберите документ из списка слева для просмотра или скачивания
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3.5 bg-slate-50/70 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 text-xs shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 rounded-lg font-medium transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
