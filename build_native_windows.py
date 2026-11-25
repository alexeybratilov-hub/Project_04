#!/usr/bin/env python3
"""Сборка релизных артефактов «ОТ-База».

Шаги:
  1. offline-бандл dist-offline/ (IIFE, один файл);
  2. упаковка public/app.html (100% file://-совместимый одностраничный вариант);
  3. сборка веб-версии dist/;
  4. (опционально) компиляция OT-Baza.exe и упаковка ZIP — требует MinGW-w64.

Использование:
    python build_native_windows.py                # всё, включая .exe (нужен MinGW-w64)
    python build_native_windows.py --skip-native  # только веб-артефакты, без .exe/.zip

Требования: Node.js (или переменная окружения NODE_BIN с путём к node.exe),
установленные зависимости (pnpm install / npm install), а для .exe — MinGW-w64.
"""
import argparse
import base64
import hashlib
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
NODE = os.environ.get("NODE_BIN", "node")
VITE_JS = os.path.join(ROOT, "node_modules", "vite", "bin", "vite.js")


def fail(message: str) -> "NoReturn":  # noqa: F821 - typing pragmatism
    print(f"ОШИБКА: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_node() -> None:
    if os.path.isabs(NODE):
        if not os.path.exists(NODE):
            fail(f"Node.js не найден по пути NODE_BIN={NODE}")
    elif shutil.which(NODE) is None:
        fail("Node.js не найден в PATH. Установите Node.js 20+ или задайте NODE_BIN.")
    if not os.path.exists(VITE_JS):
        fail("Не найдены зависимости: node_modules/vite отсутствует. Выполните pnpm install.")


def require_tool(name: str) -> None:
    if shutil.which(name) is None:
        fail(
            f"Не найдена утилита '{name}'. Для сборки .exe установите MinGW-w64 "
            f"(x86_64-w64-mingw32-gcc / windres) или запустите с --skip-native."
        )


def run(cmd: list, env: dict = None) -> None:
    printable = " ".join(cmd)
    print(f"$ {printable}")
    subprocess.run(cmd, check=True, cwd=ROOT, env=env)


def sha256_of(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_offline_bundle() -> None:
    print("=== Шаг 1: offline-бандл dist-offline/ (IIFE, один файл) ===")
    env = os.environ.copy()
    env["NODE_ENV"] = "production"
    run([NODE, VITE_JS, "build", "--mode", "production", "--config", "vite.offline.config.ts"], env=env)


def assert_single_file(path: str) -> None:
    if not os.path.exists(path):
        fail(f"Не найден ожидаемый артефакт сборки: {os.path.relpath(path, ROOT)}")


def build_app_html() -> None:
    print("=== Шаг 2: упаковка public/app.html (file://-совместимый вариант) ===")
    css_path = os.path.join(ROOT, "dist-offline", "bundle.css")
    js_path = os.path.join(ROOT, "dist-offline", "bundle.js")
    assert_single_file(js_path)

    css_content = ""
    if os.path.exists(css_path):
        with open(css_path, "r", encoding="utf-8") as cf:
            css_content = cf.read()

    with open(js_path, "rb") as jf:
        js_b64 = base64.b64encode(jf.read()).decode("ascii")

    svg_favicon = (
        "data:image/svg+xml,"
        "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E"
        "%3Crect width='64' height='64' rx='14' fill='%232563eb'/%3E"
        "%3Ctext x='50%25' y='54%25' text-anchor='middle' dominant-baseline='middle' "
        "font-family='sans-serif' font-weight='bold' font-size='28' fill='white'%3E%D0%9E%D0%A2%3C/text%3E"
        "%3C/svg%3E"
    )

    html = f"""<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ОТ-База — База данных по охране труда</title>
    <link rel="icon" type="image/svg+xml" href="{svg_favicon}" />
    <meta name="theme-color" content="#1e293b" />
    <style>
{css_content}
    </style>
  </head>
  <body class="bg-slate-100 text-slate-800 antialiased selection:bg-blue-600 selection:text-white font-sans overflow-hidden">
    <div id="root"></div>
    <script src="data:text/javascript;charset=utf-8;base64,{js_b64}"></script>
  </body>
</html>
"""

    public_dir = os.path.join(ROOT, "public")
    os.makedirs(public_dir, exist_ok=True)
    target = os.path.join(public_dir, "app.html")
    with open(target, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"app.html: {len(html)} байт, sha256={sha256_of(target)[:16]}…")


def build_web_dist() -> None:
    print("=== Шаг 3: веб-сборка dist/ ===")
    run([NODE, VITE_JS, "build"])
    index_path = os.path.join(ROOT, "dist", "index.html")
    assert_single_file(index_path)
    print(f"dist/index.html готов, sha256={sha256_of(index_path)[:16]}…")


def build_windows_exe() -> str:
    print("=== Шаг 4: компиляция OT-Baza.exe ===")
    require_tool("x86_64-w64-mingw32-windres")
    require_tool("x86_64-w64-mingw32-gcc")
    os.makedirs(os.path.join(ROOT, "public", "download"), exist_ok=True)

    run([
        "x86_64-w64-mingw32-windres",
        "resources.rc",
        "-O", "coff",
        "-o", "resources.o",
    ])

    exe_target = os.path.join(ROOT, "public", "download", "OT-Baza.exe")
    run([
        "x86_64-w64-mingw32-gcc",
        "-Wall", "-Wextra", "-Werror",
        "-O2", "-s", "-mwindows",
        "launcher.c",
        "resources.o",
        "-o", exe_target,
        "-lws2_32", "-lbcrypt", "-lshell32", "-lshlwapi",
    ])
    print(f"OT-Baza.exe: {os.path.getsize(exe_target)} байт, sha256={sha256_of(exe_target)}")
    return exe_target


def package_zip(exe_path: str) -> str:
    print("=== Шаг 5: упаковка OT-Baza-Windows.zip ===")
    zip_target = os.path.join(ROOT, "public", "download", "OT-Baza-Windows.zip")
    app_html = os.path.join(ROOT, "public", "app.html")
    initial_db = os.path.join(ROOT, "public", "initial_db.json")
    assert_single_file(app_html)
    assert_single_file(initial_db)

    with zipfile.ZipFile(zip_target, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(exe_path, "OT-Baza.exe")
        zf.write(app_html, "app.html")
        # Демо-база НЕ кладётся в data/: OT-Baza.exe сам разворачивает встроенную
        # начальную базу при первом запуске и никогда не затирает существующую.
        zf.writestr("data/.keep", "")

        readme_content = """======================================================================
  ОТ-БАЗА: СИСТЕМА УЧЕТА И ДОКУМЕНТООБОРОТА ПО ОХРАНЕ ТРУДА (PORTABLE)
  Версия 1.3 | Windows 10 / 11 64-bit | Встроенный локальный HTTP-сервер
======================================================================

1. БЫСТРЫЙ ЗАПУСК:
   - Дважды кликните по файлу OT-Baza.exe (или Запустить_ОТ_База.bat).
   - Программа запускает защищенный локальный сервер на 127.0.0.1 и
     открывает отдельное окно без зависимости от Node.js и интернета.

2. СТРУКТУРА ПАПОК:
   При первом запуске программа автоматически создает рядом с собой:
   - .\\data\\ot_database.json   -> Единая локальная база данных на диске
   - .\\data\\backups\\          -> Автоматические резервные копии перед записью
   - .\\documents\\             -> Сгенерированные приказы, акты и журналы
   - .\\normatives\\            -> Прикрепленные нормативно-правовые акты
   - .\\templates\\             -> Пользовательские шаблоны документов Word (.docx)

3. ПОРТАТИВНОСТЬ И БЕЗОПАСНОСТЬ:
   - Все изменения сохраняются в .\\data\\ot_database.json атомарно.
   - Установка не требуется, записей в реестр не делается.
   - Существующая база никогда не перезаписывается при распаковке архива.
   - Для безопасного извлечения USB-накопителя закройте окно программы.

4. АЛЬТЕРНАТИВА БЕЗ EXE:
   - app.html открывается в браузере (Chrome/Edge) двойным щелчком и
     хранит данные в localStorage браузера.
"""
        zf.writestr("ИНСТРУКЦИЯ.txt", readme_content)

        bat_content = """@echo off
chcp 65001 >nul
title OT-Baza Portable
start "" "%~dp0OT-Baza.exe"
exit
"""
        zf.writestr("Запустить_ОТ_База.bat", bat_content)

    print(f"ZIP: {os.path.getsize(zip_target)} байт, sha256={sha256_of(zip_target)}")
    return zip_target


def main() -> None:
    parser = argparse.ArgumentParser(description="Сборка артефактов ОТ-База")
    parser.add_argument(
        "--skip-native",
        action="store_true",
        help="не собирать OT-Baza.exe/ZIP (нужен MinGW-w64)",
    )
    args = parser.parse_args()

    require_node()
    build_offline_bundle()
    build_app_html()
    build_web_dist()

    if args.skip_native:
        print("Готово: веб-артефакты собраны, .exe пропущен (--skip-native).")
        return

    exe_path = build_windows_exe()
    package_zip(exe_path)
    print("Готово: полный релиз собран.")


if __name__ == "__main__":
    main()
