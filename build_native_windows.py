import os
import re
import subprocess
import zipfile

def build():
    print("=== Step 1: Standard Vite Build (dist/) ===")
    subprocess.run(["npm", "run", "build"], check=True)

    print("=== Step 2: Offline Single-File IIFE Vite Build (dist-offline/) ===")
    subprocess.run(["npx", "vite", "build", "--config", "vite.offline.config.ts"], check=True)

    print("=== Step 3: Packaging 100% file://-compatible offline app.html ===")
    css_content = ""
    css_path = os.path.join("dist-offline", "bundle.css")
    if os.path.exists(css_path):
        with open(css_path, "r", encoding="utf-8") as cf:
            css_content = cf.read()

    js_content = ""
    js_path = os.path.join("dist-offline", "bundle.js")
    if not os.path.exists(js_path):
        raise RuntimeError("dist-offline/bundle.js not found!")
    with open(js_path, "r", encoding="utf-8") as jf:
        js_content = jf.read()

    # Prevent literal </script> inside bundled libraries from prematurely closing the <script> tag
    js_content = re.sub(r'</script', r'<\/script', js_content, flags=re.IGNORECASE)

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
    <script>
{js_content}
    </script>
  </body>
</html>
"""

    os.makedirs("public", exist_ok=True)
    with open("public/app.html", "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Generated standalone file:// app.html: {len(html)} bytes")

    print("=== Step 4: Compile Windows Resource Object with Windres ===")
    os.makedirs("public/download", exist_ok=True)
    subprocess.run(["x86_64-w64-mingw32-windres", "resources.rc", "-O", "coff", "-o", "resources.o"], check=True)

    print("=== Step 5: Compile Native Windows 64-bit PE Executable with MinGW-w64 GCC ===")
    exe_target = "public/download/OT-Baza.exe"
    subprocess.run([
        "x86_64-w64-mingw32-gcc",
        "-O2",
        "-s",
        "-mwindows",
        "launcher.c",
        "resources.o",
        "-o", exe_target,
        "-lshell32",
        "-lshlwapi"
    ], check=True)
    exe_size = os.path.getsize(exe_target)
    print(f"Built native Windows executable: {exe_target} ({exe_size} bytes)")

    print("=== Step 6: Package OT-Baza-Windows.zip ===")
    zip_target = "public/download/OT-Baza-Windows.zip"
    with zipfile.ZipFile(zip_target, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(exe_target, "OT-Baza.exe")
        zf.write("public/app.html", "app.html")
        zf.write("public/initial_db.json", "data/ot_database.json")
        
        readme_content = """======================================================================
  ОТ-БАЗА: СИСТЕМА УЧЕТА И ДОКУМЕНТООБОРОТА ПО ОХРАНЕ ТРУДА (PORTABLE)
  Версия 1.2 | Windows 10 / 11 64-bit | Автономная работа без интернета
======================================================================

1. БЫСТРЫЙ ЗАПУСК:
   - Просто дважды кликните по файлу OT-Baza.exe.
   - Программа автоматически развернет рабочие папки и откроется
     в отдельном окне Windows.

2. СТРУКТУРА ПАПОК:
   При первом запуске программа автоматически создает в своей папке:
   - .\\data\\ot_database.json   -> Локальная база данных (все таблицы и связи)
   - .\\documents\\             -> Сгенерированные приказы, акты и журналы
   - .\\normatives\\            -> Прикрепленные нормативно-правовые акты (ГОСТ, СанПиН)
   - .\\templates\\             -> Пользовательские шаблоны документов Word (.docx)
   - .\\app.html                -> Автономный интерфейс (открывается без интернета)

3. ПОРТАТИВНОСТЬ:
   - Вся программа и данные хранятся исключительно в этой папке.
   - Вы можете переносить ее на любую флешку или внешний диск.
   - Никаких записей в реестр и установка в систему не требуются.

4. РЕЗЕРВНОЕ КОПИРОВАНИЕ:
   - В меню "Файл" -> "Резервная копия всей базы" можно сохранить копию базы
     в один файл и при переносе на другой ПК восстановить из него.
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

    # Sync into dist/download and dist/app.html
    if os.path.exists("dist"):
        os.makedirs("dist/download", exist_ok=True)
        with open(exe_target, "rb") as sf, open("dist/download/OT-Baza.exe", "wb") as df:
            df.write(sf.read())
        with open(zip_target, "rb") as sf, open("dist/download/OT-Baza-Windows.zip", "wb") as df:
            df.write(sf.read())
        with open("public/app.html", "rb") as sf, open("dist/app.html", "wb") as df:
            df.write(sf.read())
        print("Synced to dist/")

if __name__ == "__main__":
    build()
