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

:: Определение браузера по умолчанию или Edge
set BROWSER_CMD=start "" "%~dp0index.html"

if exist "%~dp0app.html" (
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

4. РАБОТА С ЛОКАЛЬНОЙ НЕЙРОСЕТЬЮ (OLLAMA):
   - Установите бесплатную Ollama с официального сайта: https://ollama.com
   - Запустите нужную модель в командной строке:
     ollama run qwen2.5:7b
   - В меню приложения выберите "LLM-Сервер" -> "Проверить подключение".
   - Генерация документов (инструкции, приказы, положения) будет производиться
     на вашем ПК с нулевой утечкой персональных данных.

5. РЕЗЕРВНОЕ КОПИРОВАНИЕ:
   - В меню "Файл" -> "Резервное копирование" можно в любой момент выгрузить
     полный снимок базы в один файл (.json/.sqlite) для архивации.
`;
  },

  /**
   * Download a single portable file
   */
  downloadTextFile(content: string, filename: string, mimeType = 'text/plain;charset=utf-8'): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  /**
   * Trigger download of the Windows Portable Starter Pack
   */
  downloadWindowsPortableStarter(state: DatabaseState): void {
    // Download BAT
    portablePackageService.downloadTextFile(
      portablePackageService.generateBatLauncher(),
      'Запустить_ОТ_База.bat',
      'application/x-bat;charset=utf-8'
    );

    // Download Readme
    setTimeout(() => {
      portablePackageService.downloadTextFile(
        portablePackageService.generateReadme(),
        'ИНСТРУКЦИЯ_WINDOWS_PORTABLE.txt',
        'text/plain;charset=utf-8'
      );
    }, 400);

    // Download Snapshot
    setTimeout(() => {
      portablePackageService.downloadTextFile(
        JSON.stringify(state, null, 2),
        'ot_database_portable_snapshot.json',
        'application/json;charset=utf-8'
      );
    }, 800);
  },

  /**
   * Download the standalone OT-Baza.exe executable
   */
  downloadExe(): void {
    const a = document.createElement('a');
    a.href = '/download/OT-Baza.exe';
    a.download = 'OT-Baza.exe';
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  /**
   * Download standalone offline app.html
   */
  downloadStandaloneHtml(): void {
    const a = document.createElement('a');
    a.href = '/app.html';
    a.download = 'app.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  /**
   * Download Windows ZIP package (OT-Baza.exe + app.html + initial data)
   */
  downloadZip(): void {
    const a = document.createElement('a');
    a.href = '/download/OT-Baza-Windows.zip';
    a.download = 'OT-Baza-Windows.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
};
