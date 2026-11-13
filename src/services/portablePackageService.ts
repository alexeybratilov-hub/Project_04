import { DatabaseState } from '../types/database';

export const portablePackageService = {
  /**
   * Generate a Windows .BAT launcher script
   */
  generateBatLauncher(): string {
    return `@echo off
chcp 65001 >nul
title ОТ-База (Охрана Труда) - Портативная версия для Windows
color 1F

echo ======================================================================
echo           ОТ-БАЗА: СИСТЕМА УЧЕТА И ДОКУМЕНТООБОРОТА ПО ОХРАНЕ ТРУДА
echo           Портативная версия для Windows 10 / 11 (Без установки)
echo ======================================================================
echo.
echo Текущая папка запуска: %~dp0
echo База данных и нормативные акты хранятся локально в этой папке.
echo.
echo Проверка окружения...

:: Запуск нативного сервера OT-Baza.exe, либо автономного app.html
if exist "%~dp0OT-Baza.exe" (
    start "" "%~dp0OT-Baza.exe"
) else if exist "%~dp0app.html" (
    start "" "%~dp0app.html"
) else (
    start "" "https://ais-dev-kjc2lda7y5kbmffsvubvsw-482909700707.europe-west1.run.app"
)

echo [OK] Приложение запущено в рабочем окне.
echo Для закрытия этого окна нажмите любую клавишу.
pause >nul
exit
`;
  },

  /**
   * Generate README instructions for Windows offline execution
   */
  generateReadme(): string {
    return `======================================================================
  ОТ-БАЗА: РАБОЧЕЕ МЕСТО СПЕЦИАЛИСТА ПО ОХРАНЕ ТРУДА (WINDOWS PORTABLE)
  Версия 1.1 | Автономная работа без интернета и без прав администратора
======================================================================

1. НАЗНАЧЕНИЕ:
   Ведение таблиц контингента работников, штатного расписания, результатов СОУТ,
   журналов медосмотров, выдачи СИЗ и инструктажей по охране труда с реляционной
   синхронизацией мастер-вкладок и автоматической генерацией документов Word (.docx)
   и PDF по тегам.

2. ПОРТАТИВНОСТЬ:
   - Программа не требует установки и не пишет в реестр Windows.
   - Папку с программой можно скопировать на любую USB-флешку или внешний диск.
   - Все данные базы, прикрепленные документы ГОСТ/СП и созданные приказы
     хранятся внутри папки на носителе.

3. ЗАПУСК:
   - Дважды кликните по файлу "Запустить_ОТ_База.bat".
   - Или откройте приложение в Google Chrome / MS Edge / Яндекс.Браузере и 
     нажмите иконку "Установить приложение" (PWA) в правом верхнем углу для 
     работы в виде отдельного чистого окна Windows без панелей браузера.

4. РАБОТА С LLM И ГЕНЕРАЦИЯ ДОКУМЕНТОВ:
   - В меню "LLM-Сервер" -> "Провайдер и настройки подключения" можно выбрать
     локальный сервер (Ollama, LM Studio, vLLM) либо облачный API.
   - Без подключения LLM прямая генерация документов (.docx и PDF) с
     подстановкой данных из таблиц по тегам работает полностью автономно.
   - Сформированные документы раскладываются по категориям в папке ./documents/,
     а предыдущие одноименные версии переносятся в ./documents/<Категория>/АРХИВ/<дд.мм.гггг>/.

5. РЕЗЕРВНОЕ КОПИРОВАНИЕ:
   - В меню "Файл" -> "Резервная копия всей базы..." можно в любой момент
     выгрузить полный снимок базы (.json) для архивации.
`;
  },

  /**
   * Validate downloaded payload magic bytes / structure so corrupted HTML or JSON
   * responses are never silently saved as .exe, .zip, or standalone app.html.
   */
  validateBinaryPayload(
    buffer: ArrayBuffer,
    expectedKind: 'exe' | 'zip' | 'appHtml',
    contentType?: string | null
  ): { valid: boolean; reason?: string } {
    const bytes = new Uint8Array(buffer);
    const ct = (contentType || '').toLowerCase();

    if (expectedKind === 'exe') {
      if (ct.includes('text/html') || ct.includes('application/json')) {
        return { valid: false, reason: 'Сервер вернул веб-страницу или JSON вместо исполняемого файла OT-Baza.exe.' };
      }
      if (bytes.length < 100_000 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
        return { valid: false, reason: `Файл OT-Baza.exe повреждён или не является PE-программой Windows (получено ${bytes.length} байт).` };
      }
      return { valid: true };
    }

    if (expectedKind === 'zip') {
      if (ct.includes('text/html') || ct.includes('application/json')) {
        return { valid: false, reason: 'Сервер вернул веб-страницу или JSON вместо ZIP-архива.' };
      }
      if (
        bytes.length < 100_000 ||
        bytes[0] !== 0x50 ||
        bytes[1] !== 0x4b ||
        bytes[2] !== 0x03 ||
        bytes[3] !== 0x04
      ) {
        return { valid: false, reason: `Файл OT-Baza-Windows.zip повреждён или не является ZIP-архивом (получено ${bytes.length} байт).` };
      }
      return { valid: true };
    }

    // appHtml: standalone single-file bundle must be > 500 KB and not the SPA shell
    const headText = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 4096));
    if (
      bytes.length < 500_000 ||
      headText.includes('/src/main.tsx') ||
      headText.includes('vite-plugin-pwa:register-sw')
    ) {
      return { valid: false, reason: 'Получена обычная веб-страница вместо автономного однофайлового бандла app.html.' };
    }
    return { valid: true };
  },

  triggerBlobDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  async downloadValidatedAsset(
    url: string,
    filename: string,
    expectedKind: 'exe' | 'zip' | 'appHtml',
    mimeType: string
  ): Promise<void> {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!res.ok) {
      throw new Error(`Ошибка загрузки ${filename}: HTTP ${res.status}`);
    }
    const buffer = await res.arrayBuffer();
    const check = portablePackageService.validateBinaryPayload(
      buffer,
      expectedKind,
      res.headers.get('content-type')
    );
    if (!check.valid) {
      throw new Error(check.reason || `Файл ${filename} повреждён.`);
    }
    portablePackageService.triggerBlobDownload(new Blob([buffer], { type: mimeType }), filename);
  },

  /**
   * Download a single portable file
   */
  downloadTextFile(content: string, filename: string, mimeType = 'text/plain;charset=utf-8'): void {
    const blob = new Blob([content], { type: mimeType });
    portablePackageService.triggerBlobDownload(blob, filename);
  },

  /**
   * Trigger download of the Windows Portable Starter Pack
   */
  downloadWindowsPortableStarter(state: DatabaseState): void {
    portablePackageService.downloadTextFile(
      portablePackageService.generateBatLauncher(),
      'Запустить_ОТ_База.bat',
      'application/x-bat;charset=utf-8'
    );

    setTimeout(() => {
      portablePackageService.downloadTextFile(
        portablePackageService.generateReadme(),
        'ИНСТРУКЦИЯ_WINDOWS_PORTABLE.txt',
        'text/plain;charset=utf-8'
      );
    }, 400);

    setTimeout(() => {
      portablePackageService.downloadTextFile(
        JSON.stringify(state, null, 2),
        'ot_database_portable_snapshot.json',
        'application/json;charset=utf-8'
      );
    }, 800);
  },

  /**
   * Download the standalone OT-Baza.exe executable with MZ PE validation
   */
  async downloadExe(): Promise<void> {
    await portablePackageService.downloadValidatedAsset(
      '/download/OT-Baza.exe',
      'OT-Baza.exe',
      'exe',
      'application/vnd.microsoft.portable-executable'
    );
  },

  /**
   * Download standalone offline app.html with bundle validation
   */
  async downloadStandaloneHtml(): Promise<void> {
    await portablePackageService.downloadValidatedAsset(
      '/app.html',
      'app.html',
      'appHtml',
      'text/html;charset=utf-8'
    );
  },

  /**
   * Download Windows ZIP package (OT-Baza.exe + app.html + initial data) with PK validation
   */
  async downloadZip(): Promise<void> {
    await portablePackageService.downloadValidatedAsset(
      '/download/OT-Baza-Windows.zip',
      'OT-Baza-Windows.zip',
      'zip',
      'application/zip'
    );
  }
};
