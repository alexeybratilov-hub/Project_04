# Сборка десктопного приложения «ОТ-База» на WebView2 (без браузера и localhost).
#
# Требуется: Windows + .NET Framework 4.x + Microsoft Edge WebView2 Runtime
# (есть в Windows 10/11 вместе с Edge). MinGW не нужен.
#
# Скрипт сам скачивает WebView2 SDK (NuGet), собирает public/app.html при необходимости
# и компилирует один EXE, внутри которого лежит приложение, SDK и нативный загрузчик.
#
# Использование:
#   powershell -ExecutionPolicy Bypass -File .\build_desktop_exe.ps1
#   powershell -ExecutionPolicy Bypass -File .\build_desktop_exe.ps1 -Output "C:\path\ОТ-База.exe"

param(
    [string]$Output = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Output) {
    $Output = Join-Path (Split-Path -Parent $root) "ОТ-База.exe"
}

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) {
    throw "Не найден csc.exe (.NET Framework 4.x)."
}

# --- WebView2 SDK ---
$sdkRoot = Join-Path $env:TEMP "ot-baza-wv2-sdk"
$core = Join-Path $sdkRoot "lib\net462\Microsoft.Web.WebView2.Core.dll"
$winForms = Join-Path $sdkRoot "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
$loader = Join-Path $sdkRoot "runtimes\win-x64\native\WebView2Loader.dll"

if (-not (Test-Path $core)) {
    Write-Host "Скачиваю WebView2 SDK..."
    New-Item -ItemType Directory -Path $sdkRoot -Force | Out-Null
    $nupkg = Join-Path $env:TEMP "ot-baza-wv2.nupkg"
    Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2" -OutFile $nupkg -UseBasicParsing
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($nupkg, $sdkRoot)
}

if (-not (Test-Path $loader)) {
    throw "В SDK не найден WebView2Loader.dll (win-x64)."
}

# --- Приложение ---
$appHtml = Join-Path $root "public\app.html"
if (-not (Test-Path $appHtml)) {
    Write-Host "public/app.html не найден — собираю артефакты..."
    python (Join-Path $root "build_native_windows.py") --skip-native
}
if (-not (Test-Path $appHtml)) {
    throw "Не удалось получить public/app.html."
}

if (Test-Path $Output) {
    Remove-Item $Output -Force
}

& $csc /nologo /target:winexe /platform:x64 "/out:$Output" `
    "/resource:$appHtml,app.html" `
    "/resource:$core,Microsoft.Web.WebView2.Core.dll" `
    "/resource:$winForms,Microsoft.Web.WebView2.WinForms.dll" `
    "/resource:$loader,WebView2Loader.dll" `
    "/r:$core" "/r:$winForms" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    (Join-Path $root "launcher_desktop.cs")
if ($LASTEXITCODE -ne 0) {
    throw "Компиляция не удалась (exit $LASTEXITCODE)."
}

$item = Get-Item $Output
Write-Host ("Готово: {0} ({1:N1} МБ)" -f $item.FullName, ($item.Length / 1MB))
