#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <bcrypt.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <ctype.h>

#define RES_APP_HTML 101
#define RES_INITIAL_DB 102
#define MAX_REQUEST_BODY (64 * 1024 * 1024)
#define MAX_HEADER_SIZE (32 * 1024)

/* Global Server State */
static CRITICAL_SECTION g_fsLock;
static wchar_t g_dirPath[MAX_PATH * 2];
static wchar_t g_pathData[MAX_PATH * 2];
static wchar_t g_pathBackups[MAX_PATH * 2];
static wchar_t g_pathDocs[MAX_PATH * 2];
static wchar_t g_pathNorm[MAX_PATH * 2];
static wchar_t g_pathTpl[MAX_PATH * 2];
static wchar_t g_pathDb[MAX_PATH * 2];
static wchar_t g_pathDbTmp[MAX_PATH * 2];
static wchar_t g_pathDbPrev[MAX_PATH * 2];
static wchar_t g_pathRev[MAX_PATH * 2];
static wchar_t g_pathRuntime[MAX_PATH * 2];

static char g_token[64];
static uint16_t g_port = 0;
static uint64_t g_revision = 1;
static BOOL g_restoredFromBackup = FALSE;
static BOOL g_corruptedWarning = FALSE;

static SOCKET g_listenSock = INVALID_SOCKET;
static volatile LONG g_running = 1;
static volatile ULONGLONG g_lastClientTick = 0;
static volatile LONG g_clientEverConnected = 0;
static volatile LONG g_shutdownPending = 0;
static volatile ULONGLONG g_shutdownTick = 0;

/* ---------------- Helpers ---------------- */

static uint64_t fnv1a_lower_w(const wchar_t* s) {
    uint64_t h = 14695981039346656037ULL;
    while (*s) {
        wchar_t c = *s++;
        if (c >= L'A' && c <= L'Z') c = (wchar_t)(c + 32);
        h ^= (uint64_t)(uint16_t)c;
        h *= 1099511628211ULL;
    }
    return h;
}

static BOOL ConstTimeEquals(const char* a, const char* b) {
    if (!a || !b) return FALSE;
    size_t la = strlen(a);
    size_t lb = strlen(b);
    if (la != lb) return FALSE;
    unsigned char diff = 0;
    for (size_t i = 0; i < la; i++) {
        diff |= (unsigned char)(a[i] ^ b[i]);
    }
    return diff == 0;
}

static int StrCaseEq(const char* a, const char* b) {
    if (!a || !b) return 0;
    while (*a && *b) {
        if (tolower((unsigned char)*a) != tolower((unsigned char)*b)) return 0;
        a++;
        b++;
    }
    return *a == '\0' && *b == '\0';
}

static void GenerateSessionToken(char outHex[33]) {
    unsigned char raw[16];
    memset(raw, 0, sizeof(raw));
    NTSTATUS st = BCryptGenRandom(NULL, raw, sizeof(raw), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    if (st != 0) {
        LARGE_INTEGER pc;
        QueryPerformanceCounter(&pc);
        uint64_t s1 = (uint64_t)pc.QuadPart ^ ((uint64_t)GetCurrentProcessId() << 32);
        uint64_t s2 = (uint64_t)GetTickCount64() * 6364136223846793005ULL + 1442695040888963407ULL;
        memcpy(raw, &s1, 8);
        memcpy(raw + 8, &s2, 8);
    }
    static const char hex[] = "0123456789abcdef";
    for (int i = 0; i < 16; i++) {
        outHex[i * 2] = hex[(raw[i] >> 4) & 0x0F];
        outHex[i * 2 + 1] = hex[raw[i] & 0x0F];
    }
    outHex[32] = '\0';
}

static BOOL GetEmbeddedResource(int resId, const void** ppData, DWORD* pSize) {
    HRSRC hRes = FindResourceW(NULL, MAKEINTRESOURCEW(resId), RT_RCDATA);
    if (!hRes) return FALSE;
    HGLOBAL hData = LoadResource(NULL, hRes);
    if (!hData) return FALSE;
    DWORD size = SizeofResource(NULL, hRes);
    if (size == 0) return FALSE;
    const void* pData = LockResource(hData);
    if (!pData) return FALSE;
    *ppData = pData;
    *pSize = size;
    return TRUE;
}

static BOOL WriteBytesAtomicW(const wchar_t* destPath, const wchar_t* tmpPath, const void* data, DWORD size, DWORD* outErr) {
    HANDLE hFile = CreateFileW(
        tmpPath,
        GENERIC_WRITE,
        0,
        NULL,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        NULL
    );
    if (hFile == INVALID_HANDLE_VALUE) {
        if (outErr) *outErr = GetLastError();
        return FALSE;
    }

    DWORD totalWritten = 0;
    const BYTE* ptr = (const BYTE*)data;
    while (totalWritten < size) {
        DWORD chunk = 0;
        DWORD toWrite = size - totalWritten;
        if (toWrite > 1048576) toWrite = 1048576;
        if (!WriteFile(hFile, ptr + totalWritten, toWrite, &chunk, NULL) || chunk == 0) {
            if (outErr) *outErr = GetLastError();
            CloseHandle(hFile);
            DeleteFileW(tmpPath);
            return FALSE;
        }
        totalWritten += chunk;
    }

    if (!FlushFileBuffers(hFile)) {
        if (outErr) *outErr = GetLastError();
        CloseHandle(hFile);
        DeleteFileW(tmpPath);
        return FALSE;
    }
    CloseHandle(hFile);

    if (!MoveFileExW(tmpPath, destPath, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        if (outErr) *outErr = GetLastError();
        DeleteFileW(tmpPath);
        return FALSE;
    }

    if (outErr) *outErr = 0;
    return TRUE;
}

static BOOL ReadFileToBufferW(const wchar_t* path, char** outBuf, DWORD* outSize, DWORD* outErr) {
    HANDLE hFile = CreateFileW(
        path,
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        NULL,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        NULL
    );
    if (hFile == INVALID_HANDLE_VALUE) {
        if (outErr) *outErr = GetLastError();
        return FALSE;
    }

    LARGE_INTEGER liSize;
    if (!GetFileSizeEx(hFile, &liSize) || liSize.QuadPart < 0 || liSize.QuadPart > (LONGLONG)MAX_REQUEST_BODY) {
        if (outErr) *outErr = GetLastError();
        CloseHandle(hFile);
        return FALSE;
    }

    DWORD size = (DWORD)liSize.QuadPart;
    char* buf = (char*)malloc((size_t)size + 1);
    if (!buf) {
        if (outErr) *outErr = ERROR_OUTOFMEMORY;
        CloseHandle(hFile);
        return FALSE;
    }

    DWORD totalRead = 0;
    while (totalRead < size) {
        DWORD chunk = 0;
        if (!ReadFile(hFile, buf + totalRead, size - totalRead, &chunk, NULL)) {
            if (outErr) *outErr = GetLastError();
            free(buf);
            CloseHandle(hFile);
            return FALSE;
        }
        if (chunk == 0) break;
        totalRead += chunk;
    }
    buf[totalRead] = '\0';
    CloseHandle(hFile);

    *outBuf = buf;
    *outSize = totalRead;
    if (outErr) *outErr = 0;
    return TRUE;
}

static BOOL IsValidDatabaseJson(const char* buf, DWORD size) {
    if (!buf || size < 12) return FALSE;
    DWORD start = 0;
    /* Skip UTF-8 BOM if present */
    if (size >= 3 && (unsigned char)buf[0] == 0xEF && (unsigned char)buf[1] == 0xBB && (unsigned char)buf[2] == 0xBF) {
        start = 3;
    }
    while (start < size && isspace((unsigned char)buf[start])) start++;
    if (start >= size || buf[start] != '{') return FALSE;

    DWORD end = size;
    while (end > start && isspace((unsigned char)buf[end - 1])) end--;
    if (end <= start || buf[end - 1] != '}') return FALSE;

    /* Must contain top-level entities or tabs key */
    if (strstr(buf, "\"entities\"") == NULL && strstr(buf, "\"tabs\"") == NULL) {
        return FALSE;
    }
    return TRUE;
}

static void MapWin32Error(DWORD err, int* outHttpStatus, const char** outCode, BOOL* outUsbDisconnected) {
    *outUsbDisconnected = FALSE;
    switch (err) {
        case ERROR_NOT_READY:
        case ERROR_DEV_NOT_EXIST:
        case ERROR_BAD_UNIT:
        case ERROR_GEN_FAILURE:
        case ERROR_SECTOR_NOT_FOUND:
        case ERROR_PATH_NOT_FOUND:
        case ERROR_BAD_NETPATH:
            *outHttpStatus = 503;
            *outCode = "USB_DISCONNECTED";
            *outUsbDisconnected = TRUE;
            break;
        case ERROR_DISK_FULL:
        case ERROR_HANDLE_DISK_FULL:
            *outHttpStatus = 507;
            *outCode = "DISK_FULL";
            break;
        case ERROR_WRITE_PROTECT:
        case ERROR_ACCESS_DENIED:
        case ERROR_SHARING_VIOLATION:
            *outHttpStatus = 423;
            *outCode = "FS_ACCESS_DENIED";
            break;
        case ERROR_FILE_NOT_FOUND:
            *outHttpStatus = 404;
            *outCode = "FILE_NOT_FOUND";
            break;
        default:
            *outHttpStatus = 500;
            *outCode = "FS_IO_ERROR";
            break;
    }
}

static void LoadOrInitRevision(void) {
    char* buf = NULL;
    DWORD sz = 0;
    if (ReadFileToBufferW(g_pathRev, &buf, &sz, NULL)) {
        uint64_t v = _strtoui64(buf, NULL, 10);
        if (v > 0) g_revision = v;
        free(buf);
    }
}

static void PersistRevision(void) {
    char buf[32];
    int len = sprintf(buf, "%llu", (unsigned long long)g_revision);
    if (len > 0) {
        wchar_t tmpRev[MAX_PATH * 2];
        wsprintfW(tmpRev, L"%s.tmp", g_pathRev);
        WriteBytesAtomicW(g_pathRev, tmpRev, buf, (DWORD)len, NULL);
    }
}

static void RotateDbBackups(void) {
    if (GetFileAttributesW(g_pathDb) == INVALID_FILE_ATTRIBUTES) return;

    /* Keep rolling ring of 4 historical backups + immediate prev */
    wchar_t bOld[MAX_PATH * 2], bNew[MAX_PATH * 2];
    for (int i = 3; i >= 1; i--) {
        wsprintfW(bOld, L"%s\\ot_database_bak_%d.json", g_pathBackups, i);
        wsprintfW(bNew, L"%s\\ot_database_bak_%d.json", g_pathBackups, i + 1);
        if (GetFileAttributesW(bOld) != INVALID_FILE_ATTRIBUTES) {
            MoveFileExW(bOld, bNew, MOVEFILE_REPLACE_EXISTING);
        }
    }
    if (GetFileAttributesW(g_pathDbPrev) != INVALID_FILE_ATTRIBUTES) {
        wsprintfW(bNew, L"%s\\ot_database_bak_1.json", g_pathBackups);
        CopyFileW(g_pathDbPrev, bNew, FALSE);
    }
    CopyFileW(g_pathDb, g_pathDbPrev, FALSE);
}

static BOOL EnsureDatabaseBootstrapped(void) {
    CreateDirectoryW(g_pathData, NULL);
    CreateDirectoryW(g_pathBackups, NULL);
    CreateDirectoryW(g_pathDocs, NULL);
    CreateDirectoryW(g_pathNorm, NULL);
    CreateDirectoryW(g_pathTpl, NULL);

    LoadOrInitRevision();

    DWORD attr = GetFileAttributesW(g_pathDb);
    if (attr == INVALID_FILE_ATTRIBUTES) {
        /* Try prev backup first in case previous move died mid-flight (normally atomic) */
        if (GetFileAttributesW(g_pathDbPrev) != INVALID_FILE_ATTRIBUTES) {
            if (CopyFileW(g_pathDbPrev, g_pathDb, FALSE)) {
                g_restoredFromBackup = TRUE;
                return TRUE;
            }
        }
        const void* initData = NULL;
        DWORD initSize = 0;
        if (!GetEmbeddedResource(RES_INITIAL_DB, &initData, &initSize)) {
            return FALSE;
        }
        DWORD err = 0;
        return WriteBytesAtomicW(g_pathDb, g_pathDbTmp, initData, initSize, &err);
    }

    /* Validate existing ot_database.json */
    char* buf = NULL;
    DWORD sz = 0;
    DWORD err = 0;
    if (ReadFileToBufferW(g_pathDb, &buf, &sz, &err)) {
        BOOL ok = IsValidDatabaseJson(buf, sz);
        free(buf);
        if (!ok) {
            g_corruptedWarning = TRUE;
            wchar_t corruptPath[MAX_PATH * 2];
            wsprintfW(corruptPath, L"%s\\ot_database_corrupted_%lu.json", g_pathBackups, (unsigned long)GetTickCount());
            CopyFileW(g_pathDb, corruptPath, FALSE);

            /* Attempt recovery from latest backup */
            if (GetFileAttributesW(g_pathDbPrev) != INVALID_FILE_ATTRIBUTES) {
                char* bakBuf = NULL;
                DWORD bakSz = 0;
                if (ReadFileToBufferW(g_pathDbPrev, &bakBuf, &bakSz, NULL)) {
                    BOOL bakOk = IsValidDatabaseJson(bakBuf, bakSz);
                    free(bakBuf);
                    if (bakOk && CopyFileW(g_pathDbPrev, g_pathDb, FALSE)) {
                        g_restoredFromBackup = TRUE;
                        return TRUE;
                    }
                }
            }
        }
    }
    return TRUE;
}

/* ---------------- HTTP Parsing & Security ---------------- */

static const char* FindHeaderValue(const char* headers, const char* name) {
    size_t nameLen = strlen(name);
    const char* line = headers;
    while (line && *line) {
        const char* next = strstr(line, "\r\n");
        if (_strnicmp(line, name, nameLen) == 0 && line[nameLen] == ':') {
            const char* val = line + nameLen + 1;
            while (*val == ' ' || *val == '\t') val++;
            return val;
        }
        if (!next) break;
        line = next + 2;
    }
    return NULL;
}

static void CopyHeaderValue(const char* headers, const char* name, char* outBuf, size_t outCap) {
    outBuf[0] = '\0';
    const char* val = FindHeaderValue(headers, name);
    if (!val) return;
    const char* end = strstr(val, "\r\n");
    size_t len = end ? (size_t)(end - val) : strlen(val);
    while (len > 0 && (val[len - 1] == ' ' || val[len - 1] == '\t')) len--;
    if (len >= outCap) len = outCap - 1;
    memcpy(outBuf, val, len);
    outBuf[len] = '\0';
}

static BOOL IsAllowedHost(const char* hostHeader) {
    if (!hostHeader || !hostHeader[0]) return FALSE;
    char expected1[64], expected2[64];
    sprintf(expected1, "127.0.0.1:%u", (unsigned)g_port);
    sprintf(expected2, "localhost:%u", (unsigned)g_port);
    return StrCaseEq(hostHeader, expected1) || StrCaseEq(hostHeader, expected2);
}

static BOOL IsAllowedOrigin(const char* originHeader) {
    if (!originHeader || !originHeader[0]) return TRUE; /* same-origin GETs may omit Origin */
    char expected1[64], expected2[64];
    sprintf(expected1, "http://127.0.0.1:%u", (unsigned)g_port);
    sprintf(expected2, "http://localhost:%u", (unsigned)g_port);
    return StrCaseEq(originHeader, expected1) || StrCaseEq(originHeader, expected2);
}

static BOOL UrlDecodeUtf8(const char* src, char* dst, size_t dstCap) {
    size_t di = 0;
    for (size_t si = 0; src[si] != '\0'; si++) {
        if (di + 1 >= dstCap) return FALSE;
        if (src[si] == '%') {
            if (!isxdigit((unsigned char)src[si + 1]) || !isxdigit((unsigned char)src[si + 2])) return FALSE;
            char hex[3] = { src[si + 1], src[si + 2], '\0' };
            unsigned int val = (unsigned int)strtoul(hex, NULL, 16);
            if (val == 0) return FALSE;
            dst[di++] = (char)val;
            si += 2;
        } else if (src[si] == '+') {
            dst[di++] = ' ';
        } else {
            dst[di++] = src[si];
        }
    }
    dst[di] = '\0';
    return TRUE;
}

static BOOL IsSafeSingleFilename(const char* utf8Name, wchar_t* outWideName, size_t outWideCap) {
    if (!utf8Name || !utf8Name[0]) return FALSE;
    size_t len = strlen(utf8Name);
    if (len > 220) return FALSE;

    if (strcmp(utf8Name, ".") == 0 || strcmp(utf8Name, "..") == 0) return FALSE;
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)utf8Name[i];
        if (c < 32 || c == '/' || c == '\\' || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|') {
            return FALSE;
        }
    }
    if (strstr(utf8Name, "..") != NULL) return FALSE;

    /* Reject Windows reserved device names */
    const char* dot = strchr(utf8Name, '.');
    size_t baseLen = dot ? (size_t)(dot - utf8Name) : len;
    if (baseLen >= 3 && baseLen <= 4) {
        char base[8];
        memcpy(base, utf8Name, baseLen);
        base[baseLen] = '\0';
        const char* reserved[] = {"CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"};
        for (size_t r = 0; r < sizeof(reserved) / sizeof(reserved[0]); r++) {
            if (StrCaseEq(base, reserved[r])) return FALSE;
        }
    }

    int wlen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8Name, -1, outWideName, (int)outWideCap);
    if (wlen <= 1) return FALSE;

    /* Disallow trailing dot or space in Windows filenames */
    wchar_t last = outWideName[wlen - 2];
    if (last == L' ' || last == L'.') return FALSE;
    return TRUE;
}

static BOOL IsSafeSubpath(const char* utf8RelPath, wchar_t* outWideRelPath, size_t outWideCap) {
    if (!utf8RelPath || !utf8RelPath[0] || outWideCap < 4) return FALSE;
    char copy[1024];
    size_t len = strlen(utf8RelPath);
    if (len == 0 || len >= sizeof(copy)) return FALSE;
    memcpy(copy, utf8RelPath, len + 1);

    if (copy[0] == '/' || copy[len - 1] == '/') return FALSE;

    outWideRelPath[0] = L'\0';
    size_t outUsed = 0;
    int segCount = 0;

    char* cursor = copy;
    while (cursor && *cursor) {
        char* nextSlash = strchr(cursor, '/');
        if (nextSlash) *nextSlash = '\0';

        wchar_t wSeg[256] = {0};
        if (!IsSafeSingleFilename(cursor, wSeg, 256)) {
            return FALSE;
        }
        size_t wSegLen = wcslen(wSeg);
        size_t needed = wSegLen + (segCount > 0 ? 1 : 0);
        if (outUsed + needed + 1 >= outWideCap) return FALSE;

        if (segCount > 0) {
            outWideRelPath[outUsed++] = L'\\';
        }
        wcscpy(outWideRelPath + outUsed, wSeg);
        outUsed += wSegLen;
        segCount++;

        if (!nextSlash) break;
        cursor = nextSlash + 1;
        if (*cursor == '\0') return FALSE;
    }

    return segCount > 0 && segCount <= 8;
}

static void EnsureParentDirectoriesW(const wchar_t* fullFilePath) {
    wchar_t dirBuf[MAX_PATH * 2];
    size_t len = wcslen(fullFilePath);
    if (len == 0 || len >= MAX_PATH * 2) return;
    memcpy(dirBuf, fullFilePath, (len + 1) * sizeof(wchar_t));

    for (wchar_t* p = dirBuf; *p; p++) {
        if (*p == L'\\' && p > dirBuf) {
            /* Skip drive root like C:\ */
            if (p == dirBuf + 2 && dirBuf[1] == L':') continue;
            *p = L'\0';
            CreateDirectoryW(dirBuf, NULL);
            *p = L'\\';
        }
    }
}

static BOOL ExtractQueryParam(const char* query, const char* key, char* outVal, size_t outCap) {
    if (!query || !key || !outVal || outCap == 0) return FALSE;
    outVal[0] = '\0';
    size_t keyLen = strlen(key);
    const char* p = query;
    while (p && *p) {
        const char* amp = strchr(p, '&');
        size_t segLen = amp ? (size_t)(amp - p) : strlen(p);
        if (segLen > keyLen + 1 && strncmp(p, key, keyLen) == 0 && p[keyLen] == '=') {
            const char* enc = p + keyLen + 1;
            size_t encLen = segLen - (keyLen + 1);
            char encBuf[1024];
            if (encLen >= sizeof(encBuf)) return FALSE;
            memcpy(encBuf, enc, encLen);
            encBuf[encLen] = '\0';
            return UrlDecodeUtf8(encBuf, outVal, outCap);
        }
        if (!amp) break;
        p = amp + 1;
    }
    return FALSE;
}

static void SendAll(SOCKET s, const char* data, DWORD len) {
    DWORD sent = 0;
    while (sent < len) {
        int n = send(s, data + sent, (int)((len - sent) > 65536 ? 65536 : (len - sent)), 0);
        if (n <= 0) break;
        sent += (DWORD)n;
    }
}

static void SendHttpResponse(
    SOCKET s,
    int status,
    const char* statusText,
    const char* contentType,
    const char* extraHeaders,
    const void* body,
    DWORD bodyLen
) {
    char hdr[1024];
    int hlen = sprintf(
        hdr,
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %lu\r\n"
        "Cache-Control: no-store, no-cache, must-revalidate\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "%s"
        "Connection: close\r\n\r\n",
        status,
        statusText,
        contentType,
        (unsigned long)bodyLen,
        extraHeaders ? extraHeaders : ""
    );
    if (hlen > 0) {
        SendAll(s, hdr, (DWORD)hlen);
    }
    if (body && bodyLen > 0) {
        SendAll(s, (const char*)body, bodyLen);
    }
}

static void SendJsonError(SOCKET s, int status, const char* statusText, const char* code, const char* message, BOOL usbDisconnected) {
    char json[512];
    int len = sprintf(
        json,
        "{\"ok\":false,\"error\":\"%s\",\"message\":\"%s\",\"usbDisconnected\":%s}",
        code,
        message,
        usbDisconnected ? "true" : "false"
    );
    SendHttpResponse(s, status, statusText, "application/json; charset=utf-8", NULL, json, (DWORD)len);
}

static const char* GuessMimeType(const char* utf8Name) {
    const char* dot = strrchr(utf8Name, '.');
    if (!dot) return "application/octet-stream";
    if (StrCaseEq(dot, ".pdf")) return "application/pdf";
    if (StrCaseEq(dot, ".txt")) return "text/plain; charset=utf-8";
    if (StrCaseEq(dot, ".json")) return "application/json; charset=utf-8";
    if (StrCaseEq(dot, ".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (StrCaseEq(dot, ".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return "application/octet-stream";
}

/* ---------------- Connection Worker ---------------- */

static DWORD WINAPI ClientThreadProc(LPVOID param) {
    SOCKET s = (SOCKET)(ULONG_PTR)param;

    DWORD timeoutMs = 15000;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeoutMs, sizeof(timeoutMs));
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char*)&timeoutMs, sizeof(timeoutMs));

    char* reqBuf = (char*)malloc(MAX_HEADER_SIZE + 1);
    if (!reqBuf) {
        closesocket(s);
        return 0;
    }

    DWORD totalRecv = 0;
    char* headerEnd = NULL;
    while (totalRecv < MAX_HEADER_SIZE) {
        int n = recv(s, reqBuf + totalRecv, (int)(MAX_HEADER_SIZE - totalRecv), 0);
        if (n <= 0) break;
        totalRecv += (DWORD)n;
        reqBuf[totalRecv] = '\0';
        headerEnd = strstr(reqBuf, "\r\n\r\n");
        if (headerEnd) break;
    }

    if (!headerEnd) {
        free(reqBuf);
        closesocket(s);
        return 0;
    }

    size_t hdrLen = (size_t)(headerEnd - reqBuf) + 4;
    *headerEnd = '\0'; /* terminate headers for parsing */

    /* Parse Request Line: METHOD /path?query HTTP/1.x */
    char method[16] = {0};
    char rawTarget[2048] = {0};
    if (sscanf(reqBuf, "%15s %2047s", method, rawTarget) != 2) {
        SendJsonError(s, 400, "Bad Request", "BAD_REQUEST", "Invalid HTTP request line", FALSE);
        free(reqBuf);
        closesocket(s);
        return 0;
    }

    const char* hdrStart = strstr(reqBuf, "\r\n");
    const char* headers = hdrStart ? (hdrStart + 2) : "";

    char hostHdr[128], originHdr[128], fetchSiteHdr[64], tokenHdr[128], contentLenHdr[32], expRevHdr[32];
    CopyHeaderValue(headers, "Host", hostHdr, sizeof(hostHdr));
    CopyHeaderValue(headers, "Origin", originHdr, sizeof(originHdr));
    CopyHeaderValue(headers, "Sec-Fetch-Site", fetchSiteHdr, sizeof(fetchSiteHdr));
    CopyHeaderValue(headers, "X-OT-Token", tokenHdr, sizeof(tokenHdr));
    CopyHeaderValue(headers, "Content-Length", contentLenHdr, sizeof(contentLenHdr));
    CopyHeaderValue(headers, "X-Expected-Revision", expRevHdr, sizeof(expRevHdr));

    /* Mandatory DNS Rebinding Check */
    if (!IsAllowedHost(hostHdr)) {
        SendJsonError(s, 403, "Forbidden", "INVALID_HOST", "Host header rejected", FALSE);
        free(reqBuf);
        closesocket(s);
        return 0;
    }

    /* Split path and query */
    char path[2048] = {0};
    char query[2048] = {0};
    const char* qmark = strchr(rawTarget, '?');
    if (qmark) {
        size_t plen = (size_t)(qmark - rawTarget);
        if (plen >= sizeof(path)) plen = sizeof(path) - 1;
        memcpy(path, rawTarget, plen);
        path[plen] = '\0';
        snprintf(query, sizeof(query), "%s", qmark + 1);
    } else {
        snprintf(path, sizeof(path), "%s", rawTarget);
    }

    /* Read body if Content-Length > 0 */
    DWORD contentLen = 0;
    if (contentLenHdr[0]) {
        unsigned long long cll = _strtoui64(contentLenHdr, NULL, 10);
        if (cll > MAX_REQUEST_BODY) {
            SendJsonError(s, 413, "Payload Too Large", "PAYLOAD_TOO_LARGE", "Request body exceeds limit", FALSE);
            free(reqBuf);
            closesocket(s);
            return 0;
        }
        contentLen = (DWORD)cll;
    }

    char* bodyBuf = NULL;
    if (contentLen > 0) {
        bodyBuf = (char*)malloc((size_t)contentLen + 1);
        if (!bodyBuf) {
            SendJsonError(s, 500, "Internal Server Error", "OOM", "Memory allocation failed", FALSE);
            free(reqBuf);
            closesocket(s);
            return 0;
        }
        DWORD alreadyBody = totalRecv - (DWORD)hdrLen;
        if (alreadyBody > contentLen) alreadyBody = contentLen;
        if (alreadyBody > 0) {
            memcpy(bodyBuf, reqBuf + hdrLen, alreadyBody);
        }
        DWORD recvdBody = alreadyBody;
        while (recvdBody < contentLen) {
            int n = recv(s, bodyBuf + recvdBody, (int)(contentLen - recvdBody), 0);
            if (n <= 0) break;
            recvdBody += (DWORD)n;
        }
        if (recvdBody < contentLen) {
            SendJsonError(s, 400, "Bad Request", "INCOMPLETE_BODY", "Request body truncated", FALSE);
            free(bodyBuf);
            free(reqBuf);
            closesocket(s);
            return 0;
        }
        bodyBuf[contentLen] = '\0';
    }
    free(reqBuf);
    reqBuf = NULL;

    /* 1. Root HTML entry point (serves only embedded app.html resource, cancels pending close) */
    if (StrCaseEq(method, "GET") && (strcmp(path, "/") == 0 || strcmp(path, "/index.html") == 0)) {
        const void* htmlData = NULL;
        DWORD htmlSize = 0;
        if (!GetEmbeddedResource(RES_APP_HTML, &htmlData, &htmlSize)) {
            SendJsonError(s, 500, "Internal Server Error", "MISSING_APP_RESOURCE", "Embedded app.html resource missing", FALSE);
        } else {
            InterlockedExchange(&g_shutdownPending, 0);
            InterlockedExchange(&g_clientEverConnected, 1);
            g_lastClientTick = GetTickCount64();
            SendHttpResponse(s, 200, "OK", "text/html; charset=utf-8", NULL, htmlData, htmlSize);
        }
        if (bodyBuf) free(bodyBuf);
        closesocket(s);
        return 0;
    }

    /* 1b. Serve standalone OT-Baza.exe from current binary if requested locally */
    if (StrCaseEq(method, "GET") && strcmp(path, "/download/OT-Baza.exe") == 0) {
        wchar_t selfExe[MAX_PATH * 2];
        DWORD selfLen = GetModuleFileNameW(NULL, selfExe, MAX_PATH * 2);
        char* exeBuf = NULL;
        DWORD exeSize = 0;
        DWORD rErr = 0;
        if (selfLen == 0 || !ReadFileToBufferW(selfExe, &exeBuf, &exeSize, &rErr)) {
            SendJsonError(s, 500, "FS Error", "EXE_READ_FAILED", "Unable to read OT-Baza.exe binary", FALSE);
        } else {
            SendHttpResponse(
                s,
                200,
                "OK",
                "application/octet-stream",
                "Content-Disposition: attachment; filename=\"OT-Baza.exe\"\r\n",
                exeBuf,
                exeSize
            );
            free(exeBuf);
        }
        if (bodyBuf) free(bodyBuf);
        closesocket(s);
        return 0;
    }

    /* 2. All API routes require CSRF Origin/Sec-Fetch-Site checks & Session Token */
    if (strncmp(path, "/api/", 5) == 0) {
        if (!IsAllowedOrigin(originHdr)) {
            SendJsonError(s, 403, "Forbidden", "INVALID_ORIGIN", "Origin header rejected", FALSE);
            if (bodyBuf) free(bodyBuf);
            closesocket(s);
            return 0;
        }
        if (fetchSiteHdr[0] && StrCaseEq(fetchSiteHdr, "cross-site")) {
            SendJsonError(s, 403, "Forbidden", "CROSS_SITE_BLOCKED", "Cross-site API call rejected", FALSE);
            if (bodyBuf) free(bodyBuf);
            closesocket(s);
            return 0;
        }

        /* Allow query ?token=... strictly for /api/shutdown (navigator.sendBeacon) */
        BOOL tokenOk = ConstTimeEquals(tokenHdr, g_token);
        if (!tokenOk && strcmp(path, "/api/shutdown") == 0 && strncmp(query, "token=", 6) == 0) {
            char qToken[128] = {0};
            snprintf(qToken, sizeof(qToken), "%s", query + 6);
            char* amp = strchr(qToken, '&');
            if (amp) *amp = '\0';
            tokenOk = ConstTimeEquals(qToken, g_token);
        }
        if (!tokenOk) {
            SendJsonError(s, 401, "Unauthorized", "INVALID_TOKEN", "Missing or invalid X-OT-Token", FALSE);
            if (bodyBuf) free(bodyBuf);
            closesocket(s);
            return 0;
        }

        /* Heartbeat / Health ping updates activity */
        if (strcmp(path, "/api/shutdown") != 0) {
            InterlockedExchange(&g_shutdownPending, 0);
            InterlockedExchange(&g_clientEverConnected, 1);
            g_lastClientTick = GetTickCount64();
        }

        /* Route: GET /api/health or GET /api/heartbeat */
        if (StrCaseEq(method, "GET") && (strcmp(path, "/api/health") == 0 || strcmp(path, "/api/heartbeat") == 0)) {
            EnterCriticalSection(&g_fsLock);
            DWORD attr = GetFileAttributesW(g_pathData);
            DWORD lastErr = (attr == INVALID_FILE_ATTRIBUTES) ? GetLastError() : 0;
            uint64_t rev = g_revision;
            BOOL restored = g_restoredFromBackup;
            BOOL corrupted = g_corruptedWarning;
            LeaveCriticalSection(&g_fsLock);

            if (attr == INVALID_FILE_ATTRIBUTES) {
                int st = 503;
                const char* code = "USB_DISCONNECTED";
                BOOL usb = TRUE;
                MapWin32Error(lastErr, &st, &code, &usb);
                SendJsonError(s, st, "Service Unavailable", code, "Data directory inaccessible (drive disconnected?)", TRUE);
            } else {
                char json[512];
                int len = sprintf(
                    json,
                    "{\"ok\":true,\"mode\":\"native-fs\",\"revision\":%llu,\"restoredFromBackup\":%s,\"corruptedWarning\":%s,\"storage\":\"./data/ot_database.json\"}",
                    (unsigned long long)rev,
                    restored ? "true" : "false",
                    corrupted ? "true" : "false"
                );
                SendHttpResponse(s, 200, "OK", "application/json; charset=utf-8", NULL, json, (DWORD)len);
            }
            if (bodyBuf) free(bodyBuf);
            closesocket(s);
            return 0;
        }

        /* Route: POST /api/shutdown */
        if (StrCaseEq(method, "POST") && strcmp(path, "/api/shutdown") == 0) {
            g_shutdownTick = GetTickCount64();
            InterlockedExchange(&g_shutdownPending, 1);
            const char* resp = "{\"ok\":true,\"status\":\"shutting_down\"}";
            SendHttpResponse(s, 200, "OK", "application/json; charset=utf-8", NULL, resp, (DWORD)strlen(resp));
            if (bodyBuf) free(bodyBuf);
            closesocket(s);
            return 0;
        }

        /* Route: GET /api/database */
        if (StrCaseEq(method, "GET") && strcmp(path, "/api/database") == 0) {
            EnterCriticalSection(&g_fsLock);
            char* dbBuf = NULL;
            DWORD dbSize = 0;
            DWORD fsErr = 0;
            BOOL readOk = ReadFileToBufferW(g_pathDb, &dbBuf, &dbSize, &fsErr);
            uint64_t rev = g_revision;
            LeaveCriticalSection(&g_fsLock);

            if (!readOk) {
                int st = 500;
                const char* code = "FS_IO_ERROR";
                BOOL usb = FALSE;
                MapWin32Error(fsErr, &st, &code, &usb);
                SendJsonError(s, st, "FS Error", code, "Unable to read ot_database.json", usb);
            } else if (!IsValidDatabaseJson(dbBuf, dbSize)) {
                free(dbBuf);
                SendJsonError(s, 500, "Corrupted Database", "CORRUPTED_JSON", "ot_database.json has invalid structure", FALSE);
            } else {
                char extra[128];
                sprintf(extra, "X-OT-Revision: %llu\r\n", (unsigned long long)rev);
                SendHttpResponse(s, 200, "OK", "application/json; charset=utf-8", extra, dbBuf, dbSize);
                free(dbBuf);
            }
            if (bodyBuf) free(bodyBuf);
            closesocket(s);
            return 0;
        }

        /* Route: PUT /api/database */
        if (StrCaseEq(method, "PUT") && strcmp(path, "/api/database") == 0) {
            if (!bodyBuf || !IsValidDatabaseJson(bodyBuf, contentLen)) {
                SendJsonError(s, 400, "Bad Request", "INVALID_JSON", "Database payload failed integrity validation", FALSE);
                if (bodyBuf) free(bodyBuf);
                closesocket(s);
                return 0;
            }

            uint64_t expRev = expRevHdr[0] ? _strtoui64(expRevHdr, NULL, 10) : 0;

            EnterCriticalSection(&g_fsLock);
            if (expRev > 0 && expRev != g_revision) {
                uint64_t curRev = g_revision;
                LeaveCriticalSection(&g_fsLock);
                char json[192];
                int len = sprintf(json, "{\"ok\":false,\"error\":\"REVISION_CONFLICT\",\"revision\":%llu,\"usbDisconnected\":false}", (unsigned long long)curRev);
                SendHttpResponse(s, 409, "Conflict", "application/json; charset=utf-8", NULL, json, (DWORD)len);
                free(bodyBuf);
                closesocket(s);
                return 0;
            }

            /* Backup existing before overwriting */
            RotateDbBackups();

            DWORD writeErr = 0;
            BOOL ok = WriteBytesAtomicW(g_pathDb, g_pathDbTmp, bodyBuf, contentLen, &writeErr);
            uint64_t newRev = g_revision;
            if (ok) {
                g_revision++;
                newRev = g_revision;
                PersistRevision();
            }
            LeaveCriticalSection(&g_fsLock);

            if (!ok) {
                int st = 500;
                const char* code = "FS_WRITE_ERROR";
                BOOL usb = FALSE;
                MapWin32Error(writeErr, &st, &code, &usb);
                SendJsonError(s, st, "FS Error", code, "Failed to write ot_database.json atomically", usb);
            } else {
                char extra[128];
                sprintf(extra, "X-OT-Revision: %llu\r\n", (unsigned long long)newRev);
                char json[128];
                int len = sprintf(json, "{\"ok\":true,\"revision\":%llu}", (unsigned long long)newRev);
                SendHttpResponse(s, 200, "OK", "application/json; charset=utf-8", extra, json, (DWORD)len);
            }
            free(bodyBuf);
            closesocket(s);
            return 0;
        }

        /* Route: POST /api/backup */
        if (StrCaseEq(method, "POST") && strcmp(path, "/api/backup") == 0) {
            SYSTEMTIME stNow;
            GetLocalTime(&stNow);
            wchar_t bakName[128], bakFull[MAX_PATH * 2];
            wsprintfW(
                bakName,
                L"ot_backup_%04d%02d%02d_%02d%02d%02d.json",
                stNow.wYear, stNow.wMonth, stNow.wDay,
                stNow.wHour, stNow.wMinute, stNow.wSecond
            );
            wsprintfW(bakFull, L"%s\\%s", g_pathBackups, bakName);

            EnterCriticalSection(&g_fsLock);
            BOOL copied = CopyFileW(g_pathDb, bakFull, FALSE);
            DWORD fsErr = copied ? 0 : GetLastError();
            LeaveCriticalSection(&g_fsLock);

            if (!copied) {
                int st = 500;
                const char* code = "BACKUP_FAILED";
                BOOL usb = FALSE;
                MapWin32Error(fsErr, &st, &code, &usb);
                SendJsonError(s, st, "Backup Failed", code, "Failed to create backup snapshot", usb);
            } else {
                char utfName[256] = {0};
                WideCharToMultiByte(CP_UTF8, 0, bakName, -1, utfName, sizeof(utfName) - 1, NULL, NULL);
                char json[384];
                int len = sprintf(json, "{\"ok\":true,\"fileName\":\"%s\"}", utfName);
                SendHttpResponse(s, 200, "OK", "application/json; charset=utf-8", NULL, json, (DWORD)len);
            }
            if (bodyBuf) free(bodyBuf);
            closesocket(s);
            return 0;
        }

        /* Route: POST /api/files-move/documents?from=...&to=... */
        if (StrCaseEq(method, "POST") && strcmp(path, "/api/files-move/documents") == 0) {
            char fromUtf8[1024] = {0};
            char toUtf8[1024] = {0};
            wchar_t wFromRel[MAX_PATH] = {0};
            wchar_t wToRel[MAX_PATH] = {0};

            if (!ExtractQueryParam(query, "from", fromUtf8, sizeof(fromUtf8)) ||
                !ExtractQueryParam(query, "to", toUtf8, sizeof(toUtf8)) ||
                !IsSafeSubpath(fromUtf8, wFromRel, MAX_PATH) ||
                !IsSafeSubpath(toUtf8, wToRel, MAX_PATH)) {
                SendJsonError(s, 400, "Bad Request", "INVALID_MOVE_PATH", "Unsafe or missing source/target path", FALSE);
                if (bodyBuf) free(bodyBuf);
                closesocket(s);
                return 0;
            }

            wchar_t srcFull[MAX_PATH * 2], dstFull[MAX_PATH * 2];
            wsprintfW(srcFull, L"%s\\%s", g_pathDocs, wFromRel);
            wsprintfW(dstFull, L"%s\\%s", g_pathDocs, wToRel);

            EnterCriticalSection(&g_fsLock);
            BOOL srcExists = (GetFileAttributesW(srcFull) != INVALID_FILE_ATTRIBUTES);
            BOOL movedOk = TRUE;
            DWORD mErr = 0;
            if (srcExists) {
                CreateDirectoryW(g_pathDocs, NULL);
                EnsureParentDirectoriesW(dstFull);
                movedOk = MoveFileExW(srcFull, dstFull, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
                if (!movedOk) mErr = GetLastError();
            }
            LeaveCriticalSection(&g_fsLock);

            if (!movedOk) {
                int st = 500;
                const char* code = "FS_MOVE_ERROR";
                BOOL usb = FALSE;
                MapWin32Error(mErr, &st, &code, &usb);
                SendJsonError(s, st, "FS Error", code, "Failed to move file to archive folder", usb);
            } else {
                const char* resp = srcExists ? "{\"ok\":true,\"moved\":true}" : "{\"ok\":true,\"moved\":false}";
                SendHttpResponse(s, 200, "OK", "application/json; charset=utf-8", NULL, resp, (DWORD)strlen(resp));
            }
            if (bodyBuf) free(bodyBuf);
            closesocket(s);
            return 0;
        }

        /* Route: /api/files/<bucket>/<safeNameOrSubpath> */
        if (strncmp(path, "/api/files/", 11) == 0) {
            const char* rest = path + 11;
            const char* slash = strchr(rest, '/');
            if (!slash || slash == rest || slash[1] == '\0') {
                SendJsonError(s, 400, "Bad Request", "INVALID_FILE_PATH", "Expected /api/files/<bucket>/<filename>", FALSE);
                if (bodyBuf) free(bodyBuf);
                closesocket(s);
                return 0;
            }

            char bucket[32] = {0};
            size_t bLen = (size_t)(slash - rest);
            if (bLen >= sizeof(bucket)) bLen = sizeof(bucket) - 1;
            memcpy(bucket, rest, bLen);
            bucket[bLen] = '\0';

            const wchar_t* bucketDir = NULL;
            if (strcmp(bucket, "normatives") == 0) bucketDir = g_pathNorm;
            else if (strcmp(bucket, "documents") == 0) bucketDir = g_pathDocs;
            else if (strcmp(bucket, "templates") == 0) bucketDir = g_pathTpl;

            if (!bucketDir) {
                SendJsonError(s, 403, "Forbidden", "INVALID_BUCKET", "Allowed buckets: normatives, documents, templates", FALSE);
                if (bodyBuf) free(bodyBuf);
                closesocket(s);
                return 0;
            }

            char decodedName[1024] = {0};
            wchar_t safeWName[MAX_PATH] = {0};
            BOOL allowSubpath = (strcmp(bucket, "documents") == 0);
            BOOL nameOk = UrlDecodeUtf8(slash + 1, decodedName, sizeof(decodedName)) &&
                (allowSubpath
                    ? IsSafeSubpath(decodedName, safeWName, MAX_PATH)
                    : IsSafeSingleFilename(decodedName, safeWName, MAX_PATH));
            if (!nameOk) {
                SendJsonError(s, 400, "Bad Request", "UNSAFE_FILENAME", "Filename rejected by path traversal filter", FALSE);
                if (bodyBuf) free(bodyBuf);
                closesocket(s);
                return 0;
            }

            wchar_t fullFile[MAX_PATH * 2], tmpFile[MAX_PATH * 2];
            wsprintfW(fullFile, L"%s\\%s", bucketDir, safeWName);
            wsprintfW(tmpFile, L"%s\\%s.tmp", bucketDir, safeWName);

            if (StrCaseEq(method, "PUT") || StrCaseEq(method, "POST")) {
                if (!bodyBuf || contentLen == 0) {
                    SendJsonError(s, 400, "Bad Request", "EMPTY_FILE", "File body cannot be empty", FALSE);
                    if (bodyBuf) free(bodyBuf);
                    closesocket(s);
                    return 0;
                }
                EnterCriticalSection(&g_fsLock);
                CreateDirectoryW(bucketDir, NULL);
                EnsureParentDirectoriesW(fullFile);
                DWORD wErr = 0;
                BOOL ok = WriteBytesAtomicW(fullFile, tmpFile, bodyBuf, contentLen, &wErr);
                LeaveCriticalSection(&g_fsLock);

                if (!ok) {
                    int st = 500;
                    const char* code = "FS_WRITE_ERROR";
                    BOOL usb = FALSE;
                    MapWin32Error(wErr, &st, &code, &usb);
                    SendJsonError(s, st, "FS Error", code, "Failed to write file", usb);
                } else {
                    const char* okJson = "{\"ok\":true}";
                    SendHttpResponse(s, 200, "OK", "application/json; charset=utf-8", NULL, okJson, (DWORD)strlen(okJson));
                }
                free(bodyBuf);
                closesocket(s);
                return 0;
            }

            if (StrCaseEq(method, "GET")) {
                EnterCriticalSection(&g_fsLock);
                char* fBuf = NULL;
                DWORD fSz = 0;
                DWORD rErr = 0;
                BOOL ok = ReadFileToBufferW(fullFile, &fBuf, &fSz, &rErr);
                LeaveCriticalSection(&g_fsLock);

                if (!ok) {
                    int st = 404;
                    const char* code = "FILE_NOT_FOUND";
                    BOOL usb = FALSE;
                    MapWin32Error(rErr, &st, &code, &usb);
                    SendJsonError(s, st, st == 404 ? "Not Found" : "FS Error", code, "Failed to read requested file", usb);
                } else {
                    const char* mime = GuessMimeType(decodedName);
                    SendHttpResponse(s, 200, "OK", mime, NULL, fBuf, fSz);
                    free(fBuf);
                }
                if (bodyBuf) free(bodyBuf);
                closesocket(s);
                return 0;
            }

            if (StrCaseEq(method, "DELETE")) {
                EnterCriticalSection(&g_fsLock);
                BOOL deleted = DeleteFileW(fullFile);
                DWORD dErr = deleted ? 0 : GetLastError();
                LeaveCriticalSection(&g_fsLock);

                if (!deleted && dErr != ERROR_FILE_NOT_FOUND) {
                    int st = 500;
                    const char* code = "FS_DELETE_ERROR";
                    BOOL usb = FALSE;
                    MapWin32Error(dErr, &st, &code, &usb);
                    SendJsonError(s, st, "FS Error", code, "Failed to delete file", usb);
                } else {
                    const char* okJson = "{\"ok\":true}";
                    SendHttpResponse(s, 200, "OK", "application/json; charset=utf-8", NULL, okJson, (DWORD)strlen(okJson));
                }
                if (bodyBuf) free(bodyBuf);
                closesocket(s);
                return 0;
            }
        }

        SendJsonError(s, 404, "Not Found", "UNKNOWN_API", "API route not found", FALSE);
        if (bodyBuf) free(bodyBuf);
        closesocket(s);
        return 0;
    }

    SendJsonError(s, 404, "Not Found", "NOT_FOUND", "Resource not exposed by local server", FALSE);
    if (bodyBuf) free(bodyBuf);
    closesocket(s);
    return 0;
}

static DWORD WINAPI AcceptLoopProc(LPVOID param) {
    (void)param;
    while (InterlockedCompareExchange(&g_running, 1, 1) == 1) {
        SOCKET client = accept(g_listenSock, NULL, NULL);
        if (client == INVALID_SOCKET) {
            if (InterlockedCompareExchange(&g_running, 1, 1) == 0) break;
            Sleep(50);
            continue;
        }
        HANDLE hThread = CreateThread(NULL, 0, ClientThreadProc, (LPVOID)(ULONG_PTR)client, 0, NULL);
        if (hThread) {
            CloseHandle(hThread);
        } else {
            closesocket(client);
        }
    }
    return 0;
}

static void LaunchBrowserWindow(uint16_t port, const char* token) {
    wchar_t wToken[64] = {0};
    MultiByteToWideChar(CP_UTF8, 0, token, -1, wToken, 64);

    wchar_t appUrl[256];
    wsprintfW(appUrl, L"http://127.0.0.1:%u/#token=%s", (unsigned)port, wToken);

    wchar_t appArgs[320];
    wsprintfW(appArgs, L"--app=%s", appUrl);

    HINSTANCE hRun = ShellExecuteW(NULL, L"open", L"msedge.exe", appArgs, g_dirPath, SW_SHOWNORMAL);
    if ((INT_PTR)hRun <= 32) {
        hRun = ShellExecuteW(NULL, L"open", L"chrome.exe", appArgs, g_dirPath, SW_SHOWNORMAL);
    }
    if ((INT_PTR)hRun <= 32) {
        ShellExecuteW(NULL, L"open", appUrl, NULL, g_dirPath, SW_SHOWNORMAL);
    }
}

static BOOL TryForwardToRunningInstance(void) {
    char* rtBuf = NULL;
    DWORD rtSz = 0;
    if (!ReadFileToBufferW(g_pathRuntime, &rtBuf, &rtSz, NULL)) return FALSE;

    unsigned int existingPort = 0;
    char existingToken[64] = {0};

    const char* pPort = strstr(rtBuf, "\"port\":");
    if (pPort) {
        existingPort = (unsigned int)strtoul(pPort + 7, NULL, 10);
    }
    const char* pTok = strstr(rtBuf, "\"token\":\"");
    if (pTok) {
        pTok += 9;
        const char* pEnd = strchr(pTok, '"');
        if (pEnd && (size_t)(pEnd - pTok) < sizeof(existingToken)) {
            memcpy(existingToken, pTok, (size_t)(pEnd - pTok));
            existingToken[pEnd - pTok] = '\0';
        }
    }
    free(rtBuf);

    if (existingPort > 0 && existingPort < 65536 && existingToken[0] != '\0') {
        LaunchBrowserWindow((uint16_t)existingPort, existingToken);
        return TRUE;
    }
    return FALSE;
}

/* ---------------- WinMain Entry ---------------- */

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    (void)hInstance;
    (void)hPrevInstance;
    (void)lpCmdLine;
    (void)nCmdShow;

    if (GetModuleFileNameW(NULL, g_dirPath, MAX_PATH * 2) == 0) {
        return 1;
    }
    wchar_t* lastSlash = wcsrchr(g_dirPath, L'\\');
    if (lastSlash) {
        *lastSlash = L'\0';
    } else {
        wcscpy(g_dirPath, L".");
    }
    SetCurrentDirectoryW(g_dirPath);

    wsprintfW(g_pathData, L"%s\\data", g_dirPath);
    wsprintfW(g_pathBackups, L"%s\\data\\backups", g_dirPath);
    wsprintfW(g_pathDocs, L"%s\\documents", g_dirPath);
    wsprintfW(g_pathNorm, L"%s\\normatives", g_dirPath);
    wsprintfW(g_pathTpl, L"%s\\templates", g_dirPath);
    wsprintfW(g_pathDb, L"%s\\data\\ot_database.json", g_dirPath);
    wsprintfW(g_pathDbTmp, L"%s\\data\\ot_database.json.tmp", g_dirPath);
    wsprintfW(g_pathDbPrev, L"%s\\data\\backups\\ot_database_prev.json", g_dirPath);
    wsprintfW(g_pathRev, L"%s\\data\\.ot_database.rev", g_dirPath);
    wsprintfW(g_pathRuntime, L"%s\\data\\.ot_runtime.json", g_dirPath);

    /* Single-instance lock per folder */
    uint64_t dirHash = fnv1a_lower_w(g_dirPath);
    wchar_t mutexName[128];
    wsprintfW(mutexName, L"Local\\OTBaza_%08lX%08lX", (unsigned long)(dirHash >> 32), (unsigned long)(dirHash & 0xFFFFFFFFULL));
    HANDLE hMutex = CreateMutexW(NULL, TRUE, mutexName);
    if (hMutex != NULL && GetLastError() == ERROR_ALREADY_EXISTS) {
        if (!TryForwardToRunningInstance()) {
            MessageBoxW(
                NULL,
                L"Экземпляр ОТ-База уже запущен для этой папки.\nИспользуйте открытое окно приложения.",
                L"ОТ-База",
                MB_OK | MB_ICONINFORMATION
            );
        }
        CloseHandle(hMutex);
        return 0;
    }

    InitializeCriticalSection(&g_fsLock);

    if (!EnsureDatabaseBootstrapped()) {
        MessageBoxW(
            NULL,
            L"Не удалось подготовить файл базы данных .\\data\\ot_database.json.\nПроверьте права на запись и свободное место.",
            L"ОТ-База — Ошибка инициализации",
            MB_OK | MB_ICONERROR
        );
        DeleteCriticalSection(&g_fsLock);
        if (hMutex) CloseHandle(hMutex);
        return 2;
    }

    GenerateSessionToken(g_token);

    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        MessageBoxW(NULL, L"Ошибка инициализации локальной сети WinSock2.", L"ОТ-База", MB_OK | MB_ICONERROR);
        DeleteCriticalSection(&g_fsLock);
        if (hMutex) CloseHandle(hMutex);
        return 3;
    }

    g_listenSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (g_listenSock == INVALID_SOCKET) {
        WSACleanup();
        DeleteCriticalSection(&g_fsLock);
        if (hMutex) CloseHandle(hMutex);
        return 4;
    }

    struct sockaddr_in bindAddr;
    memset(&bindAddr, 0, sizeof(bindAddr));
    bindAddr.sin_family = AF_INET;
    bindAddr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); /* strictly 127.0.0.1 */
    bindAddr.sin_port = 0; /* ephemeral port */

    if (bind(g_listenSock, (struct sockaddr*)&bindAddr, sizeof(bindAddr)) == SOCKET_ERROR) {
        closesocket(g_listenSock);
        WSACleanup();
        DeleteCriticalSection(&g_fsLock);
        if (hMutex) CloseHandle(hMutex);
        return 5;
    }

    struct sockaddr_in boundAddr;
    int addrLen = (int)sizeof(boundAddr);
    if (getsockname(g_listenSock, (struct sockaddr*)&boundAddr, &addrLen) == SOCKET_ERROR) {
        closesocket(g_listenSock);
        WSACleanup();
        DeleteCriticalSection(&g_fsLock);
        if (hMutex) CloseHandle(hMutex);
        return 6;
    }
    g_port = ntohs(boundAddr.sin_port);

    if (listen(g_listenSock, SOMAXCONN) == SOCKET_ERROR) {
        closesocket(g_listenSock);
        WSACleanup();
        DeleteCriticalSection(&g_fsLock);
        if (hMutex) CloseHandle(hMutex);
        return 7;
    }

    /* Persist runtime coordinates strictly inside protected data dir */
    char rtJson[256];
    int rtLen = sprintf(rtJson, "{\"port\":%u,\"pid\":%lu,\"token\":\"%s\"}", (unsigned)g_port, (unsigned long)GetCurrentProcessId(), g_token);
    if (rtLen > 0) {
        wchar_t rtTmp[MAX_PATH * 2];
        wsprintfW(rtTmp, L"%s.tmp", g_pathRuntime);
        WriteBytesAtomicW(g_pathRuntime, rtTmp, rtJson, (DWORD)rtLen, NULL);
    }

    g_lastClientTick = GetTickCount64();
    HANDLE hAccept = CreateThread(NULL, 0, AcceptLoopProc, NULL, 0, NULL);

    /* Open Edge / Chrome App Window pointing to embedded loopback HTTP server */
    LaunchBrowserWindow(g_port, g_token);

    /* Watchdog loop for graceful server shutdown when UI closes */
    const ULONGLONG bootTick = GetTickCount64();
    while (1) {
        Sleep(500);
        ULONGLONG now = GetTickCount64();

        if (InterlockedCompareExchange(&g_shutdownPending, 1, 1) == 1) {
            /* 2-second grace allows F5 reloads before shutting down */
            if (now - g_shutdownTick >= 2000) {
                break;
            }
        }

        if (InterlockedCompareExchange(&g_clientEverConnected, 1, 1) == 1) {
            if (now - g_lastClientTick >= 60000) {
                /* No heartbeat for 60s (e.g. browser killed externally) */
                break;
            }
        } else {
            if (now - bootTick >= 120000) {
                /* Browser never connected within 120s */
                break;
            }
        }
    }

    /* Graceful teardown */
    InterlockedExchange(&g_running, 0);
    if (g_listenSock != INVALID_SOCKET) {
        closesocket(g_listenSock);
        g_listenSock = INVALID_SOCKET;
    }
    if (hAccept) {
        WaitForSingleObject(hAccept, 2000);
        CloseHandle(hAccept);
    }

    DeleteFileW(g_pathRuntime);
    WSACleanup();
    DeleteCriticalSection(&g_fsLock);
    if (hMutex) {
        ReleaseMutex(hMutex);
        CloseHandle(hMutex);
    }

    return 0;
}
