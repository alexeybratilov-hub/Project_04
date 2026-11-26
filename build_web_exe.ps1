# Сборка одиночного EXE-лаунчера «ОТ-База» (без MinGW).
#
# Требуется: Windows + .NET Framework 4.x (csc.exe) и собранный public/app.html.
# Приложение встраивается в EXE; лаунчер поднимает локальный сервер на 127.0.0.1:47821
# и открывает его в браузере. Порт фиксирован, чтобы localStorage не терялся между запусками.
#
# Использование:
#   powershell -ExecutionPolicy Bypass -File .\build_web_exe.ps1
#   powershell -ExecutionPolicy Bypass -File .\build_web_exe.ps1 -Output "C:\path\ОТ-База.exe"

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
    throw "Не найден csc.exe (.NET Framework 4.x). Установите .NET Framework 4.x."
}

$appHtml = Join-Path $root "public\app.html"
if (-not (Test-Path $appHtml)) {
    Write-Host "public/app.html не найден — собираю артефакты..."
    python (Join-Path $root "build_native_windows.py") --skip-native
}
if (-not (Test-Path $appHtml)) {
    throw "Не удалось получить public/app.html."
}

$launcher = Join-Path $root "launcher_web.cs"
& $csc /nologo /target:winexe /platform:anycpu "/out:$Output" "/resource:$appHtml,app.html" $launcher /r:System.Windows.Forms.dll /r:System.Drawing.dll
if ($LASTEXITCODE -ne 0) {
    throw "Компиляция не удалась (exit $LASTEXITCODE)."
}

$item = Get-Item $Output
Write-Host ("Готово: {0} ({1:N1} МБ)" -f $item.FullName, ($item.Length / 1MB))
