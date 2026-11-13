import base64
import os
import subprocess
import zipfile

def build():
    print("=== Step 1: Offline Single-File IIFE Vite Build (dist-offline/) ===")
    prod_env = os.environ.copy()
    prod_env["NODE_ENV"] = "production"
    subprocess.run(["npx", "vite", "build", "--mode", "production", "--config", "vite.offline.config.ts"], check=True, env=prod_env)

    print("=== Step 2: Packaging 100% file://-compatible offline app.html ===")
    css_content = ""
    css_path = os.path.join("dist-offline", "bundle.css")
    if os.path.exists(css_path):
        with open(css_path, "r", encoding="utf-8") as cf:
            css_content = cf.read()

    js_path = os.path.join("dist-offline", "bundle.js")
    if not os.path.exists(js_path):
        raise RuntimeError("dist-offline/bundle.js not found!")
    with open(js_path, "rb") as jf:
        js_bytes = jf.read()

    # Encode JS as base64 data URI so HTML5 <script> parser never trips on <!-- or </script> strings inside bundled libs
    js_b64 = base64.b64encode(js_bytes).decode("ascii")

    # Inline SVG favicon data URI
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

    os.makedirs("public", exist_ok=True)
    with open("public/app.html", "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Generated standalone file:// app.html: {len(html)} bytes")

    print("=== Step 3: Compile Windows Resource Object with Windres ===")
    os.makedirs("public/download", exist_ok=True)
    subprocess.run(["x86_64-w64-mingw32-windres", "resources.rc", "-O", "coff", "-o", "resources.o"], check=True)

    print("=== Step 4: Compile Native Windows 64-bit PE Executable with MinGW-w64 GCC ===")
    exe_target = "public/download/OT-Baza.exe"
    subprocess.run([
        "x86_64-w64-mingw32-gcc",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-O2",
        "-s",
        "-mwindows",
        "launcher.c",
        "resources.o",
        "-o", exe_target,
        "-lws2_32",
        "-lbcrypt",
        "-lshell32",
        "-lshlwapi"
    ], check=True)
    exe_size = os.path.getsize(exe_target)
    print(f"Built native Windows executable: {exe_target} ({exe_size} bytes)")

    print("=== Step 5: Package OT-Baza-Windows.zip ===")
    zip_target = "public/download/OT-Baza-Windows.zip"
    with zipfile.ZipFile(zip_target, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(exe_target, "OT-Baza.exe")
        zf.write("public/app.html", "app.html")
        zf.write("public/initial_db.json", "data/ot_database.json")
        
        readme_content = """======================================================================
  ОТ-БАЗА: СИСТЕМА УЧЕТА И ДОКУМЕНТООБОРОТА ПО ОХРАНЕ ТРУДА (PORTABLE)
  Версия 1.3 | Windows 10 / 11 64-bit | Встроенный локальный HTTP-сервер
======================================================================

1. БЫСТРЫЙ ЗАПУСК:
   - Просто дважды кликните по файлу OT-Baza.exe.
   - Программа запускает защищенный локальный сервер на 127.0.0.1,
     автоматически разворачивает рабочие папки и открывается
     в отдельном окне Windows без зависимости от Node.js и интернета.

2. СТРУКТУРА ПАПОК:
   При первом запуске программа автоматически создает в своей папке:
   - .\\data\\ot_database.json   -> Единая локальная база данных на диске
   - .\\data\\backups\\          -> Автоматические резервные копии перед записью
   - .\\documents\\             -> Сгенерированные приказы, акты и журналы
   - .\\normatives\\            -> Прикрепленные нормативно-правовые акты (ГОСТ, СанПиН)
   - .\\templates\\             -> Пользовательские шаблоны документов Word (.docx)

3. ПОРТАТИВНОСТЬ И БЕЗОПАСНОСТЬ:
   - Все изменения сохраняются напрямую в .\\data\\ot_database.json
     атомарно и доступны сразу на другом ПК при переносе флешки.
   - Никаких записей в реестр и установка в систему не требуются.
   - Для безопасного извлечения USB-накопителя закройте окно программы.
"""
        zf.writestr("ИНСТРУКЦИЯ.txt", readme_content)

        bat_content = """@echo off
chcp 65001 >nul
title OT-Baza Portable
start "" "%~dp0OT-Baza.exe"
exit
"""
        zf.writestr("Запустить_ОТ_База.bat", bat_content)

    zip_size = os.path.getsize(zip_target)
    print(f"Created portable ZIP package: {zip_target} ({zip_size} bytes)")

    print("=== Step 6: Standard Vite Build (dist/) ===")
    subprocess.run(["npm", "run", "build"], check=True)

if __name__ == "__main__":
    build()
