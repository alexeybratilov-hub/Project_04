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
#include <stdarg.h>
#include <string.h>
#include <stdint.h>
#include <ctype.h>

#define RES_APP_HTML 101
#define RES_INITIAL_DB 102
#define MAX_REQUEST_BODY (64 * 1024 * 1024)
#define MAX_HEADER_SIZE (32 * 1024)
#define OT_PATH_CAP 2048
#define OT_URL_BUF 4096
#define MAX_JSON_DEPTH 256

/* Global Server State */
static CRITICAL_SECTION g_fsLock;
static wchar_t g_dirPath[OT_PATH_CAP];
static wchar_t g_pathData[OT_PATH_CAP];
static wchar_t g_pathBackups[OT_PATH_CAP];
static wchar_t g_pathDocs[OT_PATH_CAP];
static wchar_t g_pathNorm[OT_PATH_CAP];
static wchar_t g_pathTpl[OT_PATH_CAP];
static wchar_t g_pathDb[OT_PATH_CAP];
static wchar_t g_pathDbTmp[OT_PATH_CAP];
static wchar_t g_pathDbPrev[OT_PATH_CAP];
static wchar_t g_pathRev[OT_PATH_CAP];
static wchar_t g_pathRuntime[OT_PATH_CAP];

static char g_token[64];
static uint16_t g_port = 0;
static volatile LONGLONG g_revision = 1;
static volatile LONG g_restoredFromBackup = 0;
static volatile LONG g_corruptedWarning = 0;

static SOCKET g_listenSock = INVALID_SOCKET;
static volatile LONG g_running = 1;
static volatile LONGLONG g_lastClientTick = 0;
static volatile LONG g_clientEverConnected = 0;
static volatile LONG g_shutdownPending = 0;
static volatile LONGLONG g_shutdownTick = 0;
/* Live ClientThreadProc workers: teardown must not free the critical section or
 * WinSock while any worker can still touch them. */
static volatile LONG g_activeClients = 0;

static ULONGLONG ReadTick64(volatile LONGLONG* pVal) {
    return (ULONGLONG)InterlockedCompareExchange64(pVal, 0, 0);
}

static void WriteTick64(volatile LONGLONG* pVal, ULONGLONG v) {
    InterlockedExchange64(pVal, (LONGLONG)v);
}

static uint64_t ReadRev64(void) {
    return (uint64_t)InterlockedCompareExchange64(&g_revision, 0, 0);
}

static void WriteRev64(uint64_t v) {
    InterlockedExchange64(&g_revision, (LONGLONG)v);
}

static BOOL FormatW(wchar_t* dst, size_t cap, const wchar_t* fmt, ...) {
    if (!dst || cap == 0 || !fmt) return FALSE;
    va_list ap;
    va_start(ap, fmt);
    int n = _vsnwprintf(dst, cap - 1, fmt, ap);
    va_end(ap);
    dst[cap - 1] = L'\0';
    return n >= 0 && (size_t)n < cap;
}

static BOOL ToWin32PathW(const wchar_t* path, wchar_t* outBuf, size_t outCap) {
    if (!path || !outBuf || outCap == 0) return FALSE;
    size_t len = wcslen(path);
    if (wcsncmp(path, L"\\\\?\\", 4) == 0) {
        if (len >= outCap) return FALSE;
        memcpy(outBuf, path, (len + 1) * sizeof(wchar_t));
        return TRUE;
    }
    if (len >= 220) {
        if (path[0] == L'\\' && path[1] == L'\\') {
            size_t needed = 8 + (len - 2);
            if (needed >= outCap) return FALSE;
            wcscpy(outBuf, L"\\\\?\\UNC\\");
            wcscat(outBuf, path + 2);
            return TRUE;
        }
        if (len >= 2 && path[1] == L':') {
            size_t needed = 4 + len;
            if (needed >= outCap) return FALSE;
            wcscpy(outBuf, L"\\\\?\\");
            wcscat(outBuf, path);
            return TRUE;
        }
    }
    if (len >= outCap) return FALSE;
    memcpy(outBuf, path, (len + 1) * sizeof(wchar_t));
    return TRUE;
}

static DWORD OtGetFileAttributesW(const wchar_t* path) {
    wchar_t extPath[OT_PATH_CAP + 16];
    if (!ToWin32PathW(path, extPath, OT_PATH_CAP + 16)) return INVALID_FILE_ATTRIBUTES;
    return GetFileAttributesW(extPath);
}

static BOOL OtCreateDirectoryW(const wchar_t* path) {
    wchar_t extPath[OT_PATH_CAP + 16];
    if (!ToWin32PathW(path, extPath, OT_PATH_CAP + 16)) return FALSE;
    return CreateDirectoryW(extPath, NULL);
}

static BOOL OtCopyFileW(const wchar_t* src, const wchar_t* dst, BOOL failIfExists) {
    wchar_t wSrc[OT_PATH_CAP + 16], wDst[OT_PATH_CAP + 16];
    if (!ToWin32PathW(src, wSrc, OT_PATH_CAP + 16)) return FALSE;
    if (!ToWin32PathW(dst, wDst, OT_PATH_CAP + 16)) return FALSE;
    return CopyFileW(wSrc, wDst, failIfExists);
}

static BOOL OtMoveFileExW(const wchar_t* src, const wchar_t* dst, DWORD flags) {
    wchar_t wSrc[OT_PATH_CAP + 16], wDst[OT_PATH_CAP + 16];
    if (!ToWin32PathW(src, wSrc, OT_PATH_CAP + 16)) return FALSE;
    if (!ToWin32PathW(dst, wDst, OT_PATH_CAP + 16)) return FALSE;
    return MoveFileExW(wSrc, wDst, flags);
}

static BOOL OtDeleteFileW(const wchar_t* path) {
    wchar_t extPath[OT_PATH_CAP + 16];
    if (!ToWin32PathW(path, extPath, OT_PATH_CAP + 16)) return FALSE;
    return DeleteFileW(extPath);
}

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

static BOOL StageTempFileW(const wchar_t* tmpPath, const void* data, DWORD size, DWORD* outErr) {
    wchar_t wTmp[OT_PATH_CAP + 16];
    if (!ToWin32PathW(tmpPath, wTmp, OT_PATH_CAP + 16)) {
        if (outErr) *outErr = ERROR_FILENAME_EXCED_RANGE;
        return FALSE;
    }

    HANDLE hFile = CreateFileW(
        wTmp,
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
            DeleteFileW(wTmp);
            return FALSE;
        }
        totalWritten += chunk;
    }

    if (!FlushFileBuffers(hFile)) {
        if (outErr) *outErr = GetLastError();
        CloseHandle(hFile);
        DeleteFileW(wTmp);
        return FALSE;
    }
    CloseHandle(hFile);

    if (outErr) *outErr = 0;
    return TRUE;
}

static BOOL WriteBytesAtomicW(const wchar_t* destPath, const wchar_t* tmpPath, const void* data, DWORD size, DWORD* outErr) {
    wchar_t wDest[OT_PATH_CAP + 16], wTmp[OT_PATH_CAP + 16];
    if (!ToWin32PathW(destPath, wDest, OT_PATH_CAP + 16) ||
        !ToWin32PathW(tmpPath, wTmp, OT_PATH_CAP + 16)) {
        if (outErr) *outErr = ERROR_FILENAME_EXCED_RANGE;
        return FALSE;
    }

    if (!StageTempFileW(tmpPath, data, size, outErr)) {
        return FALSE;
    }

    if (!MoveFileExW(wTmp, wDest, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        if (outErr) *outErr = GetLastError();
        DeleteFileW(wTmp);
        return FALSE;
    }

    if (outErr) *outErr = 0;
    return TRUE;
}

static BOOL ReadFileToBufferW(const wchar_t* path, char** outBuf, DWORD* outSize, DWORD* outErr) {
    wchar_t wPath[OT_PATH_CAP + 16];
    if (!ToWin32PathW(path, wPath, OT_PATH_CAP + 16)) {
        if (outErr) *outErr = ERROR_FILENAME_EXCED_RANGE;
        return FALSE;
    }

    HANDLE hFile = CreateFileW(
        wPath,
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

/* ---------------- Strict RFC 8259 JSON Parser ---------------- */

typedef struct {
    const char* p;
    const char* end;
    int depth;
    BOOL foundTopLevelDbKey;
} JsonParserCtx;

static void JsonSkipWs(JsonParserCtx* ctx) {
    while (ctx->p < ctx->end) {
        char c = *ctx->p;
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n') {
            ctx->p++;
        } else {
            break;
        }
    }
}

static BOOL JsonParseStringToken(
    JsonParserCtx* ctx,
    const char** outRawStart,
    size_t* outRawLen,
    BOOL* outHasEscape
) {
    if (ctx->p >= ctx->end || *ctx->p != '"') return FALSE;
    ctx->p++;
    const char* start = ctx->p;
    BOOL hasEsc = FALSE;

    while (ctx->p < ctx->end) {
        unsigned char c = (unsigned char)*ctx->p;
        if (c == '"') {
            if (outRawStart) *outRawStart = start;
            if (outRawLen) *outRawLen = (size_t)(ctx->p - start);
            if (outHasEscape) *outHasEscape = hasEsc;
            ctx->p++;
            return TRUE;
        }
        if (c < 0x20) {
            return FALSE; /* unescaped control char forbidden by RFC 8259 */
        }
        if (c == '\\') {
            hasEsc = TRUE;
            ctx->p++;
            if (ctx->p >= ctx->end) return FALSE;
            char esc = *ctx->p++;
            switch (esc) {
                case '"': case '\\': case '/': case 'b':
                case 'f': case 'n': case 'r': case 't':
                    break;
                case 'u':
                    if ((size_t)(ctx->end - ctx->p) < 4) return FALSE;
                    for (int i = 0; i < 4; i++) {
                        if (!isxdigit((unsigned char)ctx->p[i])) return FALSE;
                    }
                    ctx->p += 4;
                    break;
                default:
                    return FALSE;
            }
        } else {
            ctx->p++;
        }
    }
    return FALSE;
}

static BOOL JsonParseNumberToken(JsonParserCtx* ctx) {
    if (ctx->p < ctx->end && *ctx->p == '-') ctx->p++;
    if (ctx->p >= ctx->end) return FALSE;
    if (*ctx->p == '0') {
        ctx->p++;
    } else if (*ctx->p >= '1' && *ctx->p <= '9') {
        ctx->p++;
        while (ctx->p < ctx->end && *ctx->p >= '0' && *ctx->p <= '9') ctx->p++;
    } else {
        return FALSE;
    }

    if (ctx->p < ctx->end && *ctx->p == '.') {
        ctx->p++;
        if (ctx->p >= ctx->end || *ctx->p < '0' || *ctx->p > '9') return FALSE;
        while (ctx->p < ctx->end && *ctx->p >= '0' && *ctx->p <= '9') ctx->p++;
    }

    if (ctx->p < ctx->end && (*ctx->p == 'e' || *ctx->p == 'E')) {
        ctx->p++;
        if (ctx->p < ctx->end && (*ctx->p == '+' || *ctx->p == '-')) ctx->p++;
        if (ctx->p >= ctx->end || *ctx->p < '0' || *ctx->p > '9') return FALSE;
        while (ctx->p < ctx->end && *ctx->p >= '0' && *ctx->p <= '9') ctx->p++;
    }
    return TRUE;
}

static BOOL JsonParseValue(JsonParserCtx* ctx) {
    JsonSkipWs(ctx);
    if (ctx->p >= ctx->end) return FALSE;

    char c = *ctx->p;
    if (c == '{') {
        if (ctx->depth >= MAX_JSON_DEPTH) return FALSE;
        ctx->depth++;
        ctx->p++;
        JsonSkipWs(ctx);
        if (ctx->p < ctx->end && *ctx->p == '}') {
            ctx->p++;
            ctx->depth--;
            return TRUE;
        }
        while (1) {
            JsonSkipWs(ctx);
            const char* keyStart = NULL;
            size_t keyLen = 0;
            BOOL keyHasEsc = FALSE;
            if (!JsonParseStringToken(ctx, &keyStart, &keyLen, &keyHasEsc)) {
                return FALSE;
            }
            if (ctx->depth == 1 && !keyHasEsc) {
                if ((keyLen == 8 && memcmp(keyStart, "entities", 8) == 0) ||
                    (keyLen == 4 && memcmp(keyStart, "tabs", 4) == 0)) {
                    ctx->foundTopLevelDbKey = TRUE;
                }
            }
            JsonSkipWs(ctx);
            if (ctx->p >= ctx->end || *ctx->p != ':') return FALSE;
            ctx->p++;
            if (!JsonParseValue(ctx)) return FALSE;
            JsonSkipWs(ctx);
            if (ctx->p >= ctx->end) return FALSE;
            if (*ctx->p == ',') {
                ctx->p++;
                continue;
            }
            if (*ctx->p == '}') {
                ctx->p++;
                ctx->depth--;
                return TRUE;
            }
            return FALSE;
        }
    }

    if (c == '[') {
        if (ctx->depth >= MAX_JSON_DEPTH) return FALSE;
        ctx->depth++;
        ctx->p++;
        JsonSkipWs(ctx);
        if (ctx->p < ctx->end && *ctx->p == ']') {
            ctx->p++;
            ctx->depth--;
            return TRUE;
        }
        while (1) {
            if (!JsonParseValue(ctx)) return FALSE;
            JsonSkipWs(ctx);
            if (ctx->p >= ctx->end) return FALSE;
            if (*ctx->p == ',') {
                ctx->p++;
                continue;
            }
            if (*ctx->p == ']') {
                ctx->p++;
                ctx->depth--;
                return TRUE;
            }
            return FALSE;
        }
    }

    if (c == '"') {
        return JsonParseStringToken(ctx, NULL, NULL, NULL);
    }
    if (c == 't') {
        if ((size_t)(ctx->end - ctx->p) >= 4 && memcmp(ctx->p, "true", 4) == 0) {
            ctx->p += 4;
            return TRUE;
        }
        return FALSE;
    }
    if (c == 'f') {
        if ((size_t)(ctx->end - ctx->p) >= 5 && memcmp(ctx->p, "false", 5) == 0) {
            ctx->p += 5;
            return TRUE;
        }
        return FALSE;
    }
    if (c == 'n') {
        if ((size_t)(ctx->end - ctx->p) >= 4 && memcmp(ctx->p, "null", 4) == 0) {
            ctx->p += 4;
            return TRUE;
        }
        return FALSE;
    }
    if (c == '-' || (c >= '0' && c <= '9')) {
        return JsonParseNumberToken(ctx);
    }
    return FALSE;
}

static BOOL IsValidDatabaseJson(const char* buf, DWORD size) {
    if (!buf || size < 12) return FALSE;
    DWORD start = 0;
    /* Skip UTF-8 BOM if present */
    if (size >= 3 && (unsigned char)buf[0] == 0xEF && (unsigned char)buf[1] == 0xBB && (unsigned char)buf[2] == 0xBF) {
        start = 3;
    }

    JsonParserCtx ctx;
    ctx.p = buf + start;
    ctx.end = buf + size;
    ctx.depth = 0;
    ctx.foundTopLevelDbKey = FALSE;

    JsonSkipWs(&ctx);
    if (ctx.p >= ctx.end || *ctx.p != '{') return FALSE;
    if (!JsonParseValue(&ctx)) return FALSE;
    JsonSkipWs(&ctx);
    if (ctx.p != ctx.end) return FALSE;
    return ctx.foundTopLevelDbKey;
}

static BOOL ExtractRuntimePortAndToken(
    const char* buf,
    DWORD size,
    unsigned int* outPort,
    char* outToken,
    size_t outTokenCap
) {
    if (!buf || size == 0 || !outPort || !outToken || outTokenCap == 0) return FALSE;
    *outPort = 0;
    outToken[0] = '\0';

    JsonParserCtx ctx;
    ctx.p = buf;
    ctx.end = buf + size;
    ctx.depth = 0;
    ctx.foundTopLevelDbKey = FALSE;

    JsonSkipWs(&ctx);
    if (ctx.p >= ctx.end || *ctx.p != '{') return FALSE;
    ctx.p++;
    ctx.depth = 1;
    JsonSkipWs(&ctx);
    if (ctx.p < ctx.end && *ctx.p == '}') return FALSE;

    while (ctx.p < ctx.end) {
        JsonSkipWs(&ctx);
        const char* kStart = NULL;
        size_t kLen = 0;
        BOOL kEsc = FALSE;
        if (!JsonParseStringToken(&ctx, &kStart, &kLen, &kEsc)) return FALSE;

        JsonSkipWs(&ctx);
        if (ctx.p >= ctx.end || *ctx.p != ':') return FALSE;
        ctx.p++;
        JsonSkipWs(&ctx);

        if (!kEsc && kLen == 4 && memcmp(kStart, "port", 4) == 0) {
            const char* numStart = ctx.p;
            if (!JsonParseNumberToken(&ctx)) return FALSE;
            size_t numLen = (size_t)(ctx.p - numStart);
            if (numLen > 0 && numLen < 16) {
                char numBuf[16];
                memcpy(numBuf, numStart, numLen);
                numBuf[numLen] = '\0';
                unsigned long parsedPort = strtoul(numBuf, NULL, 10);
                if (parsedPort > 0 && parsedPort < 65536) {
                    *outPort = (unsigned int)parsedPort;
                }
            }
        } else if (!kEsc && kLen == 5 && memcmp(kStart, "token", 5) == 0) {
            const char* tStart = NULL;
            size_t tLen = 0;
            BOOL tEsc = FALSE;
            if (!JsonParseStringToken(&ctx, &tStart, &tLen, &tEsc)) return FALSE;
            if (!tEsc && tLen > 0 && tLen < outTokenCap) {
                memcpy(outToken, tStart, tLen);
                outToken[tLen] = '\0';
            }
        } else {
            if (!JsonParseValue(&ctx)) return FALSE;
        }

        JsonSkipWs(&ctx);
        if (ctx.p >= ctx.end) return FALSE;
        if (*ctx.p == ',') {
            ctx.p++;
            continue;
        }
        if (*ctx.p == '}') {
            ctx.p++;
            break;
        }
        return FALSE;
    }

    JsonSkipWs(&ctx);
    if (ctx.p != ctx.end) return FALSE;
    return (*outPort > 0 && *outPort < 65536 && outToken[0] != '\0');
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
        if (v > 0) WriteRev64(v);
        free(buf);
    }
}

static void PersistRevision(void) {
    char buf[32];
    int len = snprintf(buf, sizeof(buf), "%llu", (unsigned long long)ReadRev64());
    if (len > 0) {
        wchar_t tmpRev[OT_PATH_CAP];
        if (FormatW(tmpRev, OT_PATH_CAP, L"%s.tmp", g_pathRev)) {
            WriteBytesAtomicW(g_pathRev, tmpRev, buf, (DWORD)len, NULL);
        }
    }
}

static void CommitStagedPrevBackup(const wchar_t* prevStagingPath, BOOL hasPrevSnapshot) {
    OtCreateDirectoryW(g_pathBackups);

    /* Keep rolling ring of 4 historical backups + immediate prev, rotated ONLY after main DB commit succeeded */
    wchar_t bOld[OT_PATH_CAP], bNew[OT_PATH_CAP];
    for (int i = 3; i >= 1; i--) {
        if (!FormatW(bOld, OT_PATH_CAP, L"%s\\ot_database_bak_%d.json", g_pathBackups, i) ||
            !FormatW(bNew, OT_PATH_CAP, L"%s\\ot_database_bak_%d.json", g_pathBackups, i + 1)) {
            continue;
        }
        if (OtGetFileAttributesW(bOld) != INVALID_FILE_ATTRIBUTES) {
            OtMoveFileExW(bOld, bNew, MOVEFILE_REPLACE_EXISTING);
        }
    }
    if (OtGetFileAttributesW(g_pathDbPrev) != INVALID_FILE_ATTRIBUTES) {
        if (FormatW(bNew, OT_PATH_CAP, L"%s\\ot_database_bak_1.json", g_pathBackups)) {
            OtCopyFileW(g_pathDbPrev, bNew, FALSE);
        }
    }
    if (hasPrevSnapshot && prevStagingPath && OtGetFileAttributesW(prevStagingPath) != INVALID_FILE_ATTRIBUTES) {
        if (!OtMoveFileExW(prevStagingPath, g_pathDbPrev, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
            OtCopyFileW(prevStagingPath, g_pathDbPrev, FALSE);
            OtDeleteFileW(prevStagingPath);
        }
    }
}

static BOOL EnsureDatabaseBootstrapped(void) {
    OtCreateDirectoryW(g_pathData);
    OtCreateDirectoryW(g_pathBackups);
    OtCreateDirectoryW(g_pathDocs);
    OtCreateDirectoryW(g_pathNorm);
    OtCreateDirectoryW(g_pathTpl);

    LoadOrInitRevision();

    DWORD attr = OtGetFileAttributesW(g_pathDb);
    if (attr == INVALID_FILE_ATTRIBUTES) {
        /* Try prev backup first in case previous move died mid-flight (normally atomic) */
        if (OtGetFileAttributesW(g_pathDbPrev) != INVALID_FILE_ATTRIBUTES) {
            if (OtCopyFileW(g_pathDbPrev, g_pathDb, FALSE)) {
                InterlockedExchange(&g_restoredFromBackup, 1);
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
            InterlockedExchange(&g_corruptedWarning, 1);
            wchar_t corruptPath[OT_PATH_CAP];
            if (FormatW(corruptPath, OT_PATH_CAP, L"%s\\ot_database_corrupted_%llu.json", g_pathBackups, (unsigned long long)GetTickCount64())) {
                OtCopyFileW(g_pathDb, corruptPath, FALSE);
            }

            /* Attempt recovery from latest backup */
            if (OtGetFileAttributesW(g_pathDbPrev) != INVALID_FILE_ATTRIBUTES) {
                char* bakBuf = NULL;
                DWORD bakSz = 0;
                if (ReadFileToBufferW(g_pathDbPrev, &bakBuf, &bakSz, NULL)) {
                    BOOL bakOk = IsValidDatabaseJson(bakBuf, bakSz);
                    free(bakBuf);
                    if (bakOk && OtCopyFileW(g_pathDbPrev, g_pathDb, FALSE)) {
                        InterlockedExchange(&g_restoredFromBackup, 1);
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
    if (len == 0 || len > 768) return FALSE;

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
    if (wlen <= 1 || (wlen - 1) > 235) return FALSE;

    /* Disallow trailing dot or space in Windows filenames */
    wchar_t last = outWideName[wlen - 2];
    if (last == L' ' || last == L'.') return FALSE;
    return TRUE;
}

static BOOL IsSafeSubpath(const char* utf8RelPath, wchar_t* outWideRelPath, size_t outWideCap) {
    if (!utf8RelPath || !utf8RelPath[0] || outWideCap < 4) return FALSE;
    char copy[2048];
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

    return segCount > 0 && segCount <= 12;
}

static void EnsureParentDirectoriesW(const wchar_t* fullFilePath) {
    wchar_t dirBuf[OT_PATH_CAP];
    size_t len = wcslen(fullFilePath);
    if (len == 0 || len >= OT_PATH_CAP) return;
    memcpy(dirBuf, fullFilePath, (len + 1) * sizeof(wchar_t));

    int uncSlashesToSkip = (dirBuf[0] == L'\\' && dirBuf[1] == L'\\') ? 4 : 0;
    int seenSlashes = 0;

    for (wchar_t* p = dirBuf; *p; p++) {
        if (*p == L'\\') {
            seenSlashes++;
            if (uncSlashesToSkip > 0 && seenSlashes <= uncSlashesToSkip) continue;
            if (p == dirBuf) continue;
            /* Skip drive root like C:\ */
            if (p == dirBuf + 2 && dirBuf[1] == L':') continue;
            *p = L'\0';
            OtCreateDirectoryW(dirBuf);
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
            char encBuf[OT_URL_BUF];
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
    int hlen = snprintf(
        hdr,
        sizeof(hdr),
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
    if (hlen > 0 && (size_t)hlen < sizeof(hdr)) {
        SendAll(s, hdr, (DWORD)hlen);
    }
    if (body && bodyLen > 0) {
        SendAll(s, (const char*)body, bodyLen);
    }
}

static void CloseClientSocket(SOCKET s) {
    if (s == INVALID_SOCKET) return;
    shutdown(s, SD_SEND);
    DWORD shortTimeout = 50;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&shortTimeout, sizeof(shortTimeout));
    char discard[1024];
    for (int i = 0; i < 4; i++) {
        int r = recv(s, discard, sizeof(discard), 0);
        if (r <= 0) break;
    }
    closesocket(s);
}

static void JsonAppendRaw(char* dst, size_t dstCap, size_t* ioPos, const char* raw) {
    if (!dst || !ioPos || !raw) return;
    while (*raw && *ioPos + 1 < dstCap) {
        dst[(*ioPos)++] = *raw++;
    }
    dst[*ioPos] = '\0';
}

static void JsonAppendEscaped(char* dst, size_t dstCap, size_t* ioPos, const char* src) {
    if (!dst || !ioPos) return;
    if (!src) src = "";
    static const char hexDigits[] = "0123456789abcdef";
    for (const unsigned char* p = (const unsigned char*)src; *p; p++) {
        unsigned char c = *p;
        const char* esc = NULL;
        char uEsc[7];
        switch (c) {
            case '"': esc = "\\\""; break;
            case '\\': esc = "\\\\"; break;
            case '\b': esc = "\\b"; break;
            case '\f': esc = "\\f"; break;
            case '\n': esc = "\\n"; break;
            case '\r': esc = "\\r"; break;
            case '\t': esc = "\\t"; break;
            default:
                if (c < 0x20) {
                    uEsc[0] = '\\';
                    uEsc[1] = 'u';
                    uEsc[2] = '0';
                    uEsc[3] = '0';
                    uEsc[4] = hexDigits[(c >> 4) & 0x0F];
                    uEsc[5] = hexDigits[c & 0x0F];
                    uEsc[6] = '\0';
                    esc = uEsc;
                }
                break;
        }
        if (esc) {
            size_t elen = strlen(esc);
            if (*ioPos + elen >= dstCap) break;
            memcpy(dst + *ioPos, esc, elen);
            *ioPos += elen;
        } else {
            if (*ioPos + 1 >= dstCap) break;
            dst[(*ioPos)++] = (char)c;
        }
    }
    dst[*ioPos] = '\0';
}

static void SendJsonError(SOCKET s, int status, const char* statusText, const char* code, const char* message, BOOL usbDisconnected) {
    char json[1024];
    size_t pos = 0;
    json[0] = '\0';
    JsonAppendRaw(json, sizeof(json), &pos, "{\"ok\":false,\"error\":\"");
    JsonAppendEscaped(json, sizeof(json), &pos, code);
    JsonAppendRaw(json, sizeof(json), &pos, "\",\"message\":\"");
    JsonAppendEscaped(json, sizeof(json), &pos, message);
    JsonAppendRaw(json, sizeof(json), &pos, "\",\"usbDisconnected\":");
    JsonAppendRaw(json, sizeof(json), &pos, usbDisconnected ? "true" : "false");
    JsonAppendRaw(json, sizeof(json), &pos, "}");
    SendHttpResponse(s, status, statusText, "application/json; charset=utf-8", NULL, json, (DWORD)pos);
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

static DWORD WINAPI ClientThreadMain(SOCKET s) {

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
        CloseClientSocket(s);
        return 0;
    }

    size_t hdrLen = (size_t)(headerEnd - reqBuf) + 4;
    *headerEnd = '\0'; /* terminate headers for parsing */

    /* Parse Request Line: METHOD /path?query HTTP/1.x */
    char method[16] = {0};
    char rawTarget[OT_URL_BUF] = {0};
    if (sscanf(reqBuf, "%15s %4095s", method, rawTarget) != 2) {
        SendJsonError(s, 400, "Bad Request", "BAD_REQUEST", "Invalid HTTP request line", FALSE);
        free(reqBuf);
        CloseClientSocket(s);
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
        CloseClientSocket(s);
        return 0;
    }

    /* Split path and query */
    char path[OT_URL_BUF] = {0};
    char query[OT_URL_BUF] = {0};
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
            CloseClientSocket(s);
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
            CloseClientSocket(s);
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
            CloseClientSocket(s);
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
            WriteTick64(&g_lastClientTick, GetTickCount64());
            SendHttpResponse(s, 200, "OK", "text/html; charset=utf-8", NULL, htmlData, htmlSize);
        }
        if (bodyBuf) free(bodyBuf);
        CloseClientSocket(s);
        return 0;
    }

    /* 1b. Serve standalone OT-Baza.exe from current binary if requested locally */
    if (StrCaseEq(method, "GET") && strcmp(path, "/download/OT-Baza.exe") == 0) {
        wchar_t selfExe[OT_PATH_CAP];
        DWORD selfLen = GetModuleFileNameW(NULL, selfExe, OT_PATH_CAP);
        char* exeBuf = NULL;
        DWORD exeSize = 0;
        DWORD rErr = 0;
        if (selfLen == 0 || selfLen >= OT_PATH_CAP || !ReadFileToBufferW(selfExe, &exeBuf, &exeSize, &rErr)) {
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
        CloseClientSocket(s);
        return 0;
    }

    /* 2. All API routes require CSRF Origin/Sec-Fetch-Site checks & Session Token */
    if (strncmp(path, "/api/", 5) == 0) {
        if (!IsAllowedOrigin(originHdr)) {
            SendJsonError(s, 403, "Forbidden", "INVALID_ORIGIN", "Origin header rejected", FALSE);
            if (bodyBuf) free(bodyBuf);
            CloseClientSocket(s);
            return 0;
        }
        if (fetchSiteHdr[0] && StrCaseEq(fetchSiteHdr, "cross-site")) {
            SendJsonError(s, 403, "Forbidden", "CROSS_SITE_BLOCKED", "Cross-site API call rejected", FALSE);
            if (bodyBuf) free(bodyBuf);
            CloseClientSocket(s);
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
            CloseClientSocket(s);
            return 0;
        }

        /* Heartbeat / Health ping updates activity */
        if (strcmp(path, "/api/shutdown") != 0) {
            InterlockedExchange(&g_shutdownPending, 0);
            InterlockedExchange(&g_clientEverConnected, 1);
            WriteTick64(&g_lastClientTick, GetTickCount64());
        }

        /* Route: GET /api/health or GET /api/heartbeat (strictly lock-free so slow file I/O never blocks heartbeat) */
        if (StrCaseEq(method, "GET") && (strcmp(path, "/api/health") == 0 || strcmp(path, "/api/heartbeat") == 0)) {
            DWORD attr = OtGetFileAttributesW(g_pathData);
            DWORD lastErr = (attr == INVALID_FILE_ATTRIBUTES) ? GetLastError() : 0;
            uint64_t rev = ReadRev64();
            BOOL restored = (InterlockedCompareExchange(&g_restoredFromBackup, 0, 0) != 0);
            BOOL corrupted = (InterlockedCompareExchange(&g_corruptedWarning, 0, 0) != 0);

            if (attr == INVALID_FILE_ATTRIBUTES) {
                int st = 503;
                const char* code = "USB_DISCONNECTED";
                BOOL usb = TRUE;
                MapWin32Error(lastErr, &st, &code, &usb);
                SendJsonError(s, st, "Service Unavailable", code, "Data directory inaccessible (drive disconnected?)", TRUE);
            } else {
                char json[512];
                int len = snprintf(
                    json,
                    sizeof(json),
                    "{\"ok\":true,\"mode\":\"native-fs\",\"revision\":%llu,\"restoredFromBackup\":%s,\"corruptedWarning\":%s,\"storage\":\"./data/ot_database.json\"}",
                    (unsigned long long)rev,
                    restored ? "true" : "false",
                    corrupted ? "true" : "false"
                );
                SendHttpResponse(s, 200, "OK", "application/json; charset=utf-8", NULL, json, (DWORD)len);
            }
            if (bodyBuf) free(bodyBuf);
            CloseClientSocket(s);
            return 0;
        }

        /* Route: POST /api/shutdown */
        if (StrCaseEq(method, "POST") && strcmp(path, "/api/shutdown") == 0) {
            WriteTick64(&g_shutdownTick, GetTickCount64());
            InterlockedExchange(&g_shutdownPending, 1);
            const char* resp = "{\"ok\":true,\"status\":\"shutting_down\"}";
            SendHttpResponse(s, 200, "OK", "application/json; charset=utf-8", NULL, resp, (DWORD)strlen(resp));
            if (bodyBuf) free(bodyBuf);
            CloseClientSocket(s);
            return 0;
        }

        /* Route: GET /api/database */
        if (StrCaseEq(method, "GET") && strcmp(path, "/api/database") == 0) {
            EnterCriticalSection(&g_fsLock);
            char* dbBuf = NULL;
            DWORD dbSize = 0;
            DWORD fsErr = 0;
            BOOL readOk = ReadFileToBufferW(g_pathDb, &dbBuf, &dbSize, &fsErr);
            uint64_t rev = ReadRev64();
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
            CloseClientSocket(s);
            return 0;
        }

        /* Route: PUT /api/database */
        if (StrCaseEq(method, "PUT") && strcmp(path, "/api/database") == 0) {
            if (!bodyBuf || !IsValidDatabaseJson(bodyBuf, contentLen)) {
                SendJsonError(s, 400, "Bad Request", "INVALID_JSON", "Database payload failed integrity validation", FALSE);
                if (bodyBuf) free(bodyBuf);
                CloseClientSocket(s);
                return 0;
            }

            uint64_t expRev = expRevHdr[0] ? _strtoui64(expRevHdr, NULL, 10) : 0;

            EnterCriticalSection(&g_fsLock);
            uint64_t curRev = ReadRev64();
            if (expRev > 0 && expRev != curRev) {
                LeaveCriticalSection(&g_fsLock);
                char json[256];
                int len = snprintf(
                    json,
                    sizeof(json),
                    "{\"ok\":false,\"error\":\"REVISION_CONFLICT\",\"revision\":%llu,\"expectedRevision\":%llu,\"usbDisconnected\":false,\"message\":\"Database file on disk has newer revision\"}",
                    (unsigned long long)curRev,
                    (unsigned long long)expRev
                );
                SendHttpResponse(s, 409, "Conflict", "application/json; charset=utf-8", NULL, json, (DWORD)len);
                free(bodyBuf);
                CloseClientSocket(s);
                return 0;
            }

            OtCreateDirectoryW(g_pathData);
            OtCreateDirectoryW(g_pathBackups);

            DWORD writeErr = 0;
            /* Step 1: Stage and flush new DB to temporary file first without touching backups */
            BOOL ok = StageTempFileW(g_pathDbTmp, bodyBuf, contentLen, &writeErr);
            wchar_t prevStaging[OT_PATH_CAP];
            prevStaging[0] = L'\0';
            BOOL hasPrevDb = FALSE;
            if (ok) {
                hasPrevDb = (OtGetFileAttributesW(g_pathDb) != INVALID_FILE_ATTRIBUTES);
                if (hasPrevDb) {
                    if (!FormatW(prevStaging, OT_PATH_CAP, L"%s.staging", g_pathDbPrev) ||
                        !OtCopyFileW(g_pathDb, prevStaging, FALSE)) {
                        writeErr = GetLastError();
                        ok = FALSE;
                        OtDeleteFileW(g_pathDbTmp);
                    }
                }
            }

            /* Step 2: Atomically commit staged DB over g_pathDb */
            if (ok) {
                if (!OtMoveFileExW(g_pathDbTmp, g_pathDb, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
                    writeErr = GetLastError();
                    ok = FALSE;
                    OtDeleteFileW(g_pathDbTmp);
                    if (hasPrevDb) {
                        OtDeleteFileW(prevStaging);
                    }
                }
            }

            /* Step 3: Rotate historical backups strictly AFTER g_pathDb replacement succeeded */
            uint64_t newRev = curRev;
            if (ok) {
                CommitStagedPrevBackup(prevStaging, hasPrevDb);
                newRev = curRev + 1;
                WriteRev64(newRev);
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
            CloseClientSocket(s);
            return 0;
        }

        /* Route: POST /api/backup */
        if (StrCaseEq(method, "POST") && strcmp(path, "/api/backup") == 0) {
            SYSTEMTIME stNow;
            GetLocalTime(&stNow);
            wchar_t bakName[128], bakFull[OT_PATH_CAP];
            FormatW(
                bakName,
                128,
                L"ot_backup_%04d%02d%02d_%02d%02d%02d.json",
                stNow.wYear, stNow.wMonth, stNow.wDay,
                stNow.wHour, stNow.wMinute, stNow.wSecond
            );
            FormatW(bakFull, OT_PATH_CAP, L"%s\\%s", g_pathBackups, bakName);

            EnterCriticalSection(&g_fsLock);
            OtCreateDirectoryW(g_pathBackups);
            BOOL copied = OtCopyFileW(g_pathDb, bakFull, FALSE);
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
                char json[512];
                size_t pos = 0;
                json[0] = '\0';
                JsonAppendRaw(json, sizeof(json), &pos, "{\"ok\":true,\"fileName\":\"");
                JsonAppendEscaped(json, sizeof(json), &pos, utfName);
                JsonAppendRaw(json, sizeof(json), &pos, "\"}");
                SendHttpResponse(s, 200, "OK", "application/json; charset=utf-8", NULL, json, (DWORD)pos);
            }
            if (bodyBuf) free(bodyBuf);
            CloseClientSocket(s);
            return 0;
        }

        /* Route: POST /api/files-move/documents?from=...&to=... */
        if (StrCaseEq(method, "POST") && strcmp(path, "/api/files-move/documents") == 0) {
            char fromUtf8[2048] = {0};
            char toUtf8[2048] = {0};
            wchar_t wFromRel[1024] = {0};
            wchar_t wToRel[1024] = {0};

            if (!ExtractQueryParam(query, "from", fromUtf8, sizeof(fromUtf8)) ||
                !ExtractQueryParam(query, "to", toUtf8, sizeof(toUtf8)) ||
                !IsSafeSubpath(fromUtf8, wFromRel, 1024) ||
                !IsSafeSubpath(toUtf8, wToRel, 1024)) {
                SendJsonError(s, 400, "Bad Request", "INVALID_MOVE_PATH", "Unsafe or missing source/target path", FALSE);
                if (bodyBuf) free(bodyBuf);
                CloseClientSocket(s);
                return 0;
            }

            wchar_t srcFull[OT_PATH_CAP], dstFull[OT_PATH_CAP];
            if (!FormatW(srcFull, OT_PATH_CAP, L"%s\\%s", g_pathDocs, wFromRel) ||
                !FormatW(dstFull, OT_PATH_CAP, L"%s\\%s", g_pathDocs, wToRel)) {
                SendJsonError(s, 414, "URI Too Long", "PATH_TOO_LONG", "Document path exceeds buffer limit", FALSE);
                if (bodyBuf) free(bodyBuf);
                CloseClientSocket(s);
                return 0;
            }

            EnterCriticalSection(&g_fsLock);
            BOOL srcExists = (OtGetFileAttributesW(srcFull) != INVALID_FILE_ATTRIBUTES);
            BOOL movedOk = TRUE;
            DWORD mErr = 0;
            if (srcExists) {
                OtCreateDirectoryW(g_pathDocs);
                EnsureParentDirectoriesW(dstFull);
                movedOk = OtMoveFileExW(srcFull, dstFull, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
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
            CloseClientSocket(s);
            return 0;
        }

        /* Route: /api/files/<bucket>/<safeNameOrSubpath> */
        if (strncmp(path, "/api/files/", 11) == 0) {
            const char* rest = path + 11;
            const char* slash = strchr(rest, '/');
            if (!slash || slash == rest || slash[1] == '\0') {
                SendJsonError(s, 400, "Bad Request", "INVALID_FILE_PATH", "Expected /api/files/<bucket>/<filename>", FALSE);
                if (bodyBuf) free(bodyBuf);
                CloseClientSocket(s);
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
                CloseClientSocket(s);
                return 0;
            }

            char decodedName[2048] = {0};
            wchar_t safeWName[1024] = {0};
            BOOL allowSubpath = (strcmp(bucket, "documents") == 0);
            BOOL nameOk = UrlDecodeUtf8(slash + 1, decodedName, sizeof(decodedName)) &&
                (allowSubpath
                    ? IsSafeSubpath(decodedName, safeWName, 1024)
                    : IsSafeSingleFilename(decodedName, safeWName, 1024));
            if (!nameOk) {
                SendJsonError(s, 400, "Bad Request", "UNSAFE_FILENAME", "Filename rejected by path traversal filter", FALSE);
                if (bodyBuf) free(bodyBuf);
                CloseClientSocket(s);
                return 0;
            }

            wchar_t fullFile[OT_PATH_CAP], tmpFile[OT_PATH_CAP];
            if (!FormatW(fullFile, OT_PATH_CAP, L"%s\\%s", bucketDir, safeWName) ||
                !FormatW(tmpFile, OT_PATH_CAP, L"%s\\%s.tmp", bucketDir, safeWName)) {
                SendJsonError(s, 414, "URI Too Long", "PATH_TOO_LONG", "Target file path exceeds buffer limit", FALSE);
                if (bodyBuf) free(bodyBuf);
                CloseClientSocket(s);
                return 0;
            }

            if (StrCaseEq(method, "PUT") || StrCaseEq(method, "POST")) {
                if (!bodyBuf || contentLen == 0) {
                    SendJsonError(s, 400, "Bad Request", "EMPTY_FILE", "File body cannot be empty", FALSE);
                    if (bodyBuf) free(bodyBuf);
                    CloseClientSocket(s);
                    return 0;
                }
                EnterCriticalSection(&g_fsLock);
                OtCreateDirectoryW(bucketDir);
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
                CloseClientSocket(s);
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
                CloseClientSocket(s);
                return 0;
            }

            if (StrCaseEq(method, "DELETE")) {
                EnterCriticalSection(&g_fsLock);
                BOOL deleted = OtDeleteFileW(fullFile);
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
                CloseClientSocket(s);
                return 0;
            }
        }

        SendJsonError(s, 404, "Not Found", "UNKNOWN_API", "API route not found", FALSE);
        if (bodyBuf) free(bodyBuf);
        CloseClientSocket(s);
        return 0;
    }

    SendJsonError(s, 404, "Not Found", "NOT_FOUND", "Resource not exposed by local server", FALSE);
    if (bodyBuf) free(bodyBuf);
    CloseClientSocket(s);
    return 0;
}

static DWORD WINAPI ClientThreadProc(LPVOID param) {
    SOCKET s = (SOCKET)(ULONG_PTR)param;
    DWORD rc = ClientThreadMain(s);
    InterlockedDecrement(&g_activeClients);
    return rc;
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
        /* Count the worker before the thread exists: an increment inside the thread
         * would let teardown observe zero while a not-yet-scheduled worker is alive. */
        InterlockedIncrement(&g_activeClients);
        HANDLE hThread = CreateThread(NULL, 0, ClientThreadProc, (LPVOID)(ULONG_PTR)client, 0, NULL);
        if (hThread) {
            CloseHandle(hThread);
        } else {
            InterlockedDecrement(&g_activeClients);
            closesocket(client);
        }
    }
    return 0;
}

/* Resolve a browser executable strictly by absolute path.
 * Launching a bare "msedge.exe" with the application folder as the working directory
 * lets anyone able to write next to OT-Baza.exe (USB stick / shared folder) plant a
 * malicious msedge.exe that would then run with the user's privileges. */
static BOOL TryKnownBrowserPath(const wchar_t* envName, const wchar_t* suffix, wchar_t* outPath, size_t outCap) {
    wchar_t base[OT_PATH_CAP] = {0};
    DWORD n = GetEnvironmentVariableW(envName, base, OT_PATH_CAP);
    if (n == 0 || n >= (DWORD)OT_PATH_CAP) return FALSE;
    if (!FormatW(outPath, outCap, L"%s%s", base, suffix)) return FALSE;
    DWORD attrs = GetFileAttributesW(outPath);
    return attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

static BOOL FindInstalledBrowserExecutable(wchar_t* outPath, size_t outCap) {
    /* Single table: two parallel arrays could silently drift out of sync. */
    static const struct {
        const wchar_t* env;
        const wchar_t* suffix;
    } candidates[] = {
        { L"ProgramFiles(x86)", L"\\Microsoft\\Edge\\Application\\msedge.exe" },
        { L"ProgramFiles",      L"\\Microsoft\\Edge\\Application\\msedge.exe" },
        { L"LOCALAPPDATA",      L"\\Microsoft\\Edge\\Application\\msedge.exe" },
        { L"ProgramFiles",      L"\\Google\\Chrome\\Application\\chrome.exe" },
        { L"ProgramFiles(x86)", L"\\Google\\Chrome\\Application\\chrome.exe" },
        { L"LOCALAPPDATA",      L"\\Google\\Chrome\\Application\\chrome.exe" }
    };
    const size_t count = sizeof(candidates) / sizeof(candidates[0]);
    for (size_t i = 0; i < count; i++) {
        if (TryKnownBrowserPath(candidates[i].env, candidates[i].suffix, outPath, outCap)) return TRUE;
    }
    return FALSE;
}

static void LaunchBrowserWindow(uint16_t port, const char* token) {
    wchar_t wToken[64] = {0};
    MultiByteToWideChar(CP_UTF8, 0, token, -1, wToken, 64);

    wchar_t appUrl[256];
    FormatW(appUrl, 256, L"http://127.0.0.1:%u/#token=%s", (unsigned)port, wToken);

    wchar_t appArgs[320];
    FormatW(appArgs, 320, L"--app=%s", appUrl);

    HINSTANCE hRun = (HINSTANCE)0;
    wchar_t browserPath[OT_PATH_CAP] = {0};
    if (FindInstalledBrowserExecutable(browserPath, OT_PATH_CAP)) {
        /* lpDirectory = NULL: the browser must not inherit the application folder as its
         * working directory (that would re-open a DLL-planting vector via CWD search). */
        hRun = ShellExecuteW(NULL, L"open", browserPath, appArgs, NULL, SW_SHOWNORMAL);
    }
    if ((INT_PTR)hRun <= 32) {
        /* Fall back to the default browser handler using the URL itself. */
        ShellExecuteW(NULL, L"open", appUrl, NULL, NULL, SW_SHOWNORMAL);
    }
}

static BOOL TryForwardToRunningInstance(void) {
    char* rtBuf = NULL;
    DWORD rtSz = 0;
    if (!ReadFileToBufferW(g_pathRuntime, &rtBuf, &rtSz, NULL)) return FALSE;

    unsigned int existingPort = 0;
    char existingToken[64] = {0};
    BOOL parsed = ExtractRuntimePortAndToken(rtBuf, rtSz, &existingPort, existingToken, sizeof(existingToken));
    free(rtBuf);

    if (parsed) {
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

    DWORD modLen = GetModuleFileNameW(NULL, g_dirPath, OT_PATH_CAP);
    if (modLen == 0 || modLen >= OT_PATH_CAP) {
        return 1;
    }
    wchar_t* lastSlash = wcsrchr(g_dirPath, L'\\');
    if (lastSlash) {
        *lastSlash = L'\0';
    } else {
        wcscpy(g_dirPath, L".");
    }
    SetCurrentDirectoryW(g_dirPath);

    if (!FormatW(g_pathData, OT_PATH_CAP, L"%s\\data", g_dirPath) ||
        !FormatW(g_pathBackups, OT_PATH_CAP, L"%s\\data\\backups", g_dirPath) ||
        !FormatW(g_pathDocs, OT_PATH_CAP, L"%s\\documents", g_dirPath) ||
        !FormatW(g_pathNorm, OT_PATH_CAP, L"%s\\normatives", g_dirPath) ||
        !FormatW(g_pathTpl, OT_PATH_CAP, L"%s\\templates", g_dirPath) ||
        !FormatW(g_pathDb, OT_PATH_CAP, L"%s\\data\\ot_database.json", g_dirPath) ||
        !FormatW(g_pathDbTmp, OT_PATH_CAP, L"%s\\data\\ot_database.json.tmp", g_dirPath) ||
        !FormatW(g_pathDbPrev, OT_PATH_CAP, L"%s\\data\\backups\\ot_database_prev.json", g_dirPath) ||
        !FormatW(g_pathRev, OT_PATH_CAP, L"%s\\data\\.ot_database.rev", g_dirPath) ||
        !FormatW(g_pathRuntime, OT_PATH_CAP, L"%s\\data\\.ot_runtime.json", g_dirPath)) {
        return 1;
    }

    /* Single-instance lock per folder */
    uint64_t dirHash = fnv1a_lower_w(g_dirPath);
    wchar_t mutexName[128];
    FormatW(mutexName, 128, L"Local\\OTBaza_%08lX%08lX", (unsigned long)(dirHash >> 32), (unsigned long)(dirHash & 0xFFFFFFFFULL));
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

    /* Prevent another local socket from binding the same port with SO_REUSEADDR and
     * hijacking loopback traffic (which would also expose the session token). */
    int exclusiveAddr = 1;
    if (setsockopt(g_listenSock, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (const char*)&exclusiveAddr, sizeof(exclusiveAddr)) == SOCKET_ERROR) {
        closesocket(g_listenSock);
        WSACleanup();
        DeleteCriticalSection(&g_fsLock);
        if (hMutex) CloseHandle(hMutex);
        return 8;
    }

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
    size_t rtPos = 0;
    rtJson[0] = '\0';
    char rtPrefix[96];
    snprintf(rtPrefix, sizeof(rtPrefix), "{\"port\":%u,\"pid\":%lu,\"token\":\"", (unsigned)g_port, (unsigned long)GetCurrentProcessId());
    JsonAppendRaw(rtJson, sizeof(rtJson), &rtPos, rtPrefix);
    JsonAppendEscaped(rtJson, sizeof(rtJson), &rtPos, g_token);
    JsonAppendRaw(rtJson, sizeof(rtJson), &rtPos, "\"}");
    if (rtPos > 0) {
        wchar_t rtTmp[OT_PATH_CAP];
        if (FormatW(rtTmp, OT_PATH_CAP, L"%s.tmp", g_pathRuntime)) {
            WriteBytesAtomicW(g_pathRuntime, rtTmp, rtJson, (DWORD)rtPos, NULL);
        }
    }

    WriteTick64(&g_lastClientTick, GetTickCount64());
    HANDLE hAccept = CreateThread(NULL, 0, AcceptLoopProc, NULL, 0, NULL);

    /* Open Edge / Chrome App Window pointing to embedded loopback HTTP server */
    LaunchBrowserWindow(g_port, g_token);

    /* Watchdog loop for graceful server shutdown when UI closes */
    const ULONGLONG bootTick = GetTickCount64();
    ULONGLONG prevLoopTick = bootTick;
    while (1) {
        Sleep(500);
        ULONGLONG now = GetTickCount64();

        /* Detect OS sleep / hibernation suspension so waking laptop does not immediately kill server */
        if (now > prevLoopTick && (now - prevLoopTick) >= 10000ULL) {
            WriteTick64(&g_lastClientTick, now);
        }
        prevLoopTick = now;

        ULONGLONG shutTick = ReadTick64(&g_shutdownTick);

        if (InterlockedCompareExchange(&g_shutdownPending, 1, 1) == 1) {
            /* 2.5-second grace allows F5 reloads before shutting down */
            if (now >= shutTick && (now - shutTick) >= 2500ULL) {
                break;
            }
        }

        ULONGLONG lastTick = ReadTick64(&g_lastClientTick);
        if (InterlockedCompareExchange(&g_clientEverConnected, 1, 1) == 1) {
            /* 10-minute tolerance avoids premature shutdown from Edge/Chrome background tab throttling */
            if (now >= lastTick && (now - lastTick) >= 600000ULL) {
                break;
            }
        } else {
            if (now >= bootTick && (now - bootTick) >= 120000ULL) {
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

    OtDeleteFileW(g_pathRuntime);

    /* Wait for in-flight workers before tearing down shared primitives: a worker may
     * still be inside EnterCriticalSection()/send() and would hit freed state. */
    BOOL clientsDrained = FALSE;
    for (int i = 0; i < 100; i++) {
        if (InterlockedCompareExchange(&g_activeClients, 0, 0) == 0) {
            clientsDrained = TRUE;
            break;
        }
        Sleep(50);
    }

    SecureZeroMemory(g_token, sizeof(g_token));

    if (clientsDrained) {
        WSACleanup();
        DeleteCriticalSection(&g_fsLock);
    }
    if (hMutex) {
        ReleaseMutex(hMutex);
        CloseHandle(hMutex);
    }

    return 0;
}
