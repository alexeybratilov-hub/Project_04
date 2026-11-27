# Сборка нативного Windows-клиента «ОТ-База» (WinForms, без WebView2 и без сервера).
#
# Требуется только .NET Framework 4.x (csc.exe входит в Windows). Ни Node.js,
# ни WebView2 Runtime, ни MinGW не нужны.
#
# Использование:
#   powershell -ExecutionPolicy Bypass -File .\build_native_app.ps1
#   powershell -ExecutionPolicy Bypass -File .\build_native_app.ps1 -Output "C:\path\ОТ-База.exe"

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

$native = Join-Path $root "native"
$modules = Join-Path $native "modules.json"
$seed = Join-Path $root "public\initial_db.json"
if (-not (Test-Path $seed)) {
    throw "Не найден public/initial_db.json (стартовая база)."
}

if (Test-Path $Output) {
    Remove-Item $Output -Force
}

# Шрифт с кириллицей для PDF: берём из src/data/cyrillicFont.ts, чтобы не держать
# вторую копию 750-КБ файла в репозитории. Без встроенного шрифта PDF с русским
# текстом не отображается (стандартные шрифты PDF кириллицу не содержат).
$fontTs = Join-Path $root "src\data\cyrillicFont.ts"
if (-not (Test-Path $fontTs)) {
    throw "Не найден src/data/cyrillicFont.ts (шрифт для PDF)."
}
$fontSource = Get-Content $fontTs -Raw -Encoding UTF8
if ($fontSource -notmatch 'DEJAVU_SANS_REGULAR_B64\s*=\s*"([^"]+)"') {
    throw "В src/data/cyrillicFont.ts не найден DEJAVU_SANS_REGULAR_B64."
}
$fontTemp = Join-Path $env:TEMP ("DejaVuSans-" + [guid]::NewGuid().ToString('N') + ".ttf")
[System.IO.File]::WriteAllBytes($fontTemp, [Convert]::FromBase64String($matches[1]))

try {
    & $csc /nologo /target:winexe /platform:anycpu "/out:$Output" `
        "/resource:$modules,modules.json" `
        "/resource:$seed,initial_db.json" `
        "/resource:$fontTemp,DejaVuSans.ttf" `
        /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Core.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Xml.dll `
        (Join-Path $native "*.cs")
}
finally {
    if (Test-Path $fontTemp) { Remove-Item $fontTemp -Force }
}

if ($LASTEXITCODE -ne 0) {
    throw "Компиляция не удалась (exit $LASTEXITCODE)."
}

$item = Get-Item $Output
Write-Host ("Готово: {0} ({1:N0} КБ)" -f $item.FullName, ($item.Length / 1KB))
Write-Host "Проверка логики: $Output --selftest %TEMP%\ot-native-check"
