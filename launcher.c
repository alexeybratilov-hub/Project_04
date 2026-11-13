#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <stdio.h>

// Helper to extract embedded resource to a file
BOOL ExtractResourceToFile(int resId, const wchar_t* destPath) {
    HRSRC hRes = FindResourceW(NULL, MAKEINTRESOURCEW(resId), RT_RCDATA);
    if (!hRes) return FALSE;

    HGLOBAL hData = LoadResource(NULL, hRes);
    if (!hData) return FALSE;

    DWORD size = SizeofResource(NULL, hRes);
    if (size == 0) return FALSE;

    const void* pData = LockResource(hData);
    if (!pData) return FALSE;

    HANDLE hFile = CreateFileW(
        destPath,
        GENERIC_WRITE,
        0,
        NULL,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        NULL
    );

    if (hFile == INVALID_HANDLE_VALUE) return FALSE;

    DWORD totalWritten = 0;
    const BYTE* bytePtr = (const BYTE*)pData;
    while (totalWritten < size) {
        DWORD chunk = 0;
        if (!WriteFile(hFile, bytePtr + totalWritten, size - totalWritten, &chunk, NULL) || chunk == 0) {
            CloseHandle(hFile);
            return FALSE;
        }
        totalWritten += chunk;
    }

    CloseHandle(hFile);
    return (totalWritten == size);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    (void)hInstance;
    (void)hPrevInstance;
    (void)lpCmdLine;
    (void)nCmdShow;

    // 1. Get current executable full path
    wchar_t exePath[MAX_PATH * 2] = {0};
    if (GetModuleFileNameW(NULL, exePath, MAX_PATH * 2) == 0) {
        return 1;
    }

    // 2. Extract root directory path
    wchar_t dirPath[MAX_PATH * 2] = {0};
    wcscpy(dirPath, exePath);
    wchar_t* lastSlash = wcsrchr(dirPath, L'\\');
    if (lastSlash) {
        *lastSlash = L'\0';
    } else {
        wcscpy(dirPath, L".");
    }

    // Set current directory to the executable root folder
    SetCurrentDirectoryW(dirPath);

    // 3. Create root subfolders: data, documents, normatives, templates
    wchar_t pathData[MAX_PATH * 2];
    wchar_t pathDocs[MAX_PATH * 2];
    wchar_t pathNorm[MAX_PATH * 2];
    wchar_t pathTpl[MAX_PATH * 2];

    wsprintfW(pathData, L"%s\\data", dirPath);
    wsprintfW(pathDocs, L"%s\\documents", dirPath);
    wsprintfW(pathNorm, L"%s\\normatives", dirPath);
    wsprintfW(pathTpl, L"%s\\templates", dirPath);

    CreateDirectoryW(pathData, NULL);
    CreateDirectoryW(pathDocs, NULL);
    CreateDirectoryW(pathNorm, NULL);
    CreateDirectoryW(pathTpl, NULL);

    // 4. Extract data\ot_database.json if not present (never overwrite user data)
    wchar_t pathDb[MAX_PATH * 2];
    wsprintfW(pathDb, L"%s\\data\\ot_database.json", dirPath);
    if (GetFileAttributesW(pathDb) == INVALID_FILE_ATTRIBUTES) {
        ExtractResourceToFile(102, pathDb);
    }

    // 5. Extract self-contained offline app.html
    wchar_t pathHtml[MAX_PATH * 2];
    wsprintfW(pathHtml, L"%s\\app.html", dirPath);
    if (!ExtractResourceToFile(101, pathHtml)) {
        if (GetFileAttributesW(pathHtml) == INVALID_FILE_ATTRIBUTES) {
            MessageBoxW(
                NULL,
                L"Не удалось распаковать файлы приложения app.html.\nУбедитесь, что папка доступна для записи.",
                L"ОТ-База — Ошибка запуска",
                MB_OK | MB_ICONERROR
            );
            return 2;
        }
    }

    // 6. Convert Windows path to a proper RFC file:/// URI (handles spaces and Cyrillic)
    wchar_t fileUrl[MAX_PATH * 4] = {0};
    DWORD urlLen = (DWORD)(sizeof(fileUrl) / sizeof(wchar_t));
    if (UrlCreateFromPathW(pathHtml, fileUrl, &urlLen, 0) != S_OK) {
        // Manual fallback replacing backslashes
        wcscpy(fileUrl, L"file:///");
        size_t baseLen = wcslen(fileUrl);
        for (size_t i = 0; pathHtml[i] != L'\0' && (baseLen + i + 1) < (MAX_PATH * 4); i++) {
            fileUrl[baseLen + i] = (pathHtml[i] == L'\\') ? L'/' : pathHtml[i];
            fileUrl[baseLen + i + 1] = L'\0';
        }
    }

    // 7. Launch in dedicated Edge App window, fallback to Chrome App, then default browser
    wchar_t appArgs[MAX_PATH * 4 + 32];
    wsprintfW(appArgs, L"--app=\"%s\"", fileUrl);

    HINSTANCE hRun = ShellExecuteW(
        NULL,
        L"open",
        L"msedge.exe",
        appArgs,
        dirPath,
        SW_SHOWNORMAL
    );

    if ((INT_PTR)hRun <= 32) {
        hRun = ShellExecuteW(
            NULL,
            L"open",
            L"chrome.exe",
            appArgs,
            dirPath,
            SW_SHOWNORMAL
        );
    }

    if ((INT_PTR)hRun <= 32) {
        ShellExecuteW(
            NULL,
            L"open",
            pathHtml,
            NULL,
            dirPath,
            SW_SHOWNORMAL
        );
    }

    return 0;
}
