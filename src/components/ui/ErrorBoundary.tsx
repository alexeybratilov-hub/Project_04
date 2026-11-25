import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Download, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
  notice: string | null;
}

const STORAGE_KEYS = ['ot_base_database_v1', 'ot_base_pre_restore_backup_v1'];

function downloadString(content: string, fileName: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Last-resort guard: a render error must never leave the user with a blank screen
 * and no way to retrieve the data that is still sitting in the browser cache.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null, notice: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info });
    console.error('[OT-Baza] Unhandled render error', error, info);
  }

  private handleDownloadBackup = (): void => {
    for (const key of STORAGE_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (raw && raw.trim().length > 2) {
          downloadString(raw, `${key}_${new Date().toISOString().slice(0, 10)}.json`);
          this.setState({ notice: null });
          return;
        }
      } catch {
        // localStorage may be unavailable (private mode / quota) — fall through
      }
    }
    this.setState({
      notice:
        'Резервная копия в браузере не найдена. Проверьте файл ./data/ot_database.json рядом с программой.'
    });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error, info, notice } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 p-6">
        <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-lg p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Приложение остановлено из-за внутренней ошибки
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Данные на диске не изменены. Скачайте резервную копию, затем перезагрузите страницу
                или перезапустите OT-Baza.exe.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.handleDownloadBackup}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
            >
              <Download className="w-4 h-4" />
              Скачать копию данных (JSON)
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium"
            >
              <RotateCcw className="w-4 h-4" />
              Перезагрузить
            </button>
          </div>

          {notice && (
            <div
              role="status"
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            >
              {notice}
            </div>
          )}

          <details className="text-xs">
            <summary className="cursor-pointer text-slate-600 dark:text-slate-300">
              Технические детали ошибки
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 font-mono text-[11px] text-slate-700 dark:text-slate-300">
              {error.message}
              {info?.componentStack ? `\n${info.componentStack}` : ''}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
