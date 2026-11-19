import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface FileValidationRule {
  /** Lowercase extensions with leading dot, e.g. ['.xlsx', '.xlsm', '.csv'] */
  allowedExtensions: string[];
  /** Optional list of allowed non-empty MIME types (in addition to '' / 'application/octet-stream') */
  allowedMimeTypes?: string[];
  /** Human-readable format list for error messages */
  formatLabel?: string;
}

export type FileValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export function extractFileExtension(fileName: string): string {
  const trimmed = String(fileName || '').trim().toLowerCase();
  const dotIdx = trimmed.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === trimmed.length - 1) return '';
  return trimmed.slice(dotIdx);
}

export function hasFilesInDataTransfer(
  dataTransfer: Pick<DataTransfer, 'types' | 'files'> | null | undefined
): boolean {
  if (!dataTransfer) return false;
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    return true;
  }
  if (dataTransfer.types) {
    try {
      return Array.from(dataTransfer.types).includes('Files');
    } catch {
      return false;
    }
  }
  return false;
}

export function validateAcceptedFile(
  file: Pick<File, 'name' | 'type' | 'size'>,
  rule: FileValidationRule
): FileValidationResult {
  const normalizedExts = rule.allowedExtensions.map((ext) => {
    const clean = ext.trim().toLowerCase();
    return clean.startsWith('.') ? clean : `.${clean}`;
  });
  const formatLabel = rule.formatLabel || normalizedExts.join(', ');
  const ext = extractFileExtension(file.name);

  if (!ext || !normalizedExts.includes(ext)) {
    return {
      ok: false,
      error: `Неподдерживаемый формат файла «${file.name}». Допускаются: ${formatLabel}.`
    };
  }

  const rawMime = String(file.type || '')
    .trim()
    .toLowerCase()
    .split(';')[0]
    .trim();

  if (
    rawMime &&
    rawMime !== 'application/octet-stream' &&
    rule.allowedMimeTypes &&
    rule.allowedMimeTypes.length > 0
  ) {
    const normalizedMimes = rule.allowedMimeTypes.map((m) => m.trim().toLowerCase());
    if (!normalizedMimes.includes(rawMime)) {
      return {
        ok: false,
        error: `Неподдерживаемый тип файла «${file.name}» (${rawMime}). Допускаются: ${formatLabel}.`
      };
    }
  }

  if (typeof file.size === 'number' && file.size <= 0) {
    return {
      ok: false,
      error: `Файл «${file.name}» пустой (0 байт). Выберите непустой файл формата ${formatLabel}.`
    };
  }

  return { ok: true };
}

export interface UseFileDropZoneOptions {
  rule: FileValidationRule;
  disabled?: boolean;
  onFileAccepted: (file: File) => void | Promise<void>;
  onReject: (errorMessage: string) => void;
}

export function useFileDropZone({
  rule,
  disabled = false,
  onFileAccepted,
  onReject
}: UseFileDropZoneOptions) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragOver(false);
  }, []);

  useEffect(() => {
    if (disabled) {
      resetDragState();
    }
  }, [disabled, resetDragState]);

  useEffect(() => {
    if (!isDragOver) return;
    const handleWindowReset = () => resetDragState();
    window.addEventListener('dragend', handleWindowReset);
    window.addEventListener('drop', handleWindowReset);
    window.addEventListener('blur', handleWindowReset);
    return () => {
      window.removeEventListener('dragend', handleWindowReset);
      window.removeEventListener('drop', handleWindowReset);
      window.removeEventListener('blur', handleWindowReset);
    };
  }, [isDragOver, resetDragState]);

  const processCandidateFile = useCallback(
    (file: File | null | undefined) => {
      if (!file || disabled) return;
      const validation = validateAcceptedFile(file, rule);
      if (!validation.ok) {
        onReject(validation.error);
        return;
      }
      void onFileAccepted(file);
    },
    [disabled, onFileAccepted, onReject, rule]
  );

  const onDragEnter = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!hasFilesInDataTransfer(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragDepthRef.current += 1;
      setIsDragOver(true);
    },
    [disabled]
  );

  const onDragOver = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!hasFilesInDataTransfer(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }
      if (!disabled) {
        if (dragDepthRef.current === 0) {
          dragDepthRef.current = 1;
        }
        if (!isDragOver) {
          setIsDragOver(true);
        }
      }
    },
    [disabled, isDragOver]
  );

  const onDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (!hasFilesInDataTransfer(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      const hasFiles = hasFilesInDataTransfer(e.dataTransfer);
      if (!hasFiles) return;
      e.preventDefault();
      e.stopPropagation();
      resetDragState();
      if (disabled) return;

      const file = e.dataTransfer?.files?.[0];
      if (!file) {
        onReject('Не удалось получить файл при перетаскивании.');
        return;
      }
      processCandidateFile(file);
    },
    [disabled, onReject, processCandidateFile, resetDragState]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      processCandidateFile(file);
    },
    [processCandidateFile]
  );

  return {
    isDragOver,
    resetDragState,
    dropZoneProps: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop
    },
    handleInputChange
  };
}
