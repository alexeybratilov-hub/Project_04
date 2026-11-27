using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Windows.Forms;

namespace OtBaza
{
    internal static class Program
    {
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        private static void Main(string[] args)
        {
            // Проверка раскладки: отдельный одноразовый запуск, реальные данные не трогает.
            if (args.Length > 0 && args[0] == "--layout-check")
            {
                Environment.ExitCode = LayoutCheck.Run(args);
                return;
            }

            if (args.Length > 0 && args[0] == "--portable-check")
            {
                Environment.ExitCode = PortableCheck.Run();
                return;
            }

            if (args.Length > 0 && args[0] == "--selftest")
            {
                Environment.ExitCode = SelfTest.Run(args.Length > 1 ? args[1] : null);
                return;
            }

            if (args.Length > 1 && args[0] == "--import-test")
            {
                Environment.ExitCode = ImportTest.Run(args[1]);
                return;
            }

            // Один экземпляр на папку с данными: два окна перезаписывают одну базу
            // последним сохранением. Разные папки (две флешки) работают независимо.
            PortableInfo portable = PortablePaths.Resolve();
            bool singleInstance;
            using (var mutex = new System.Threading.Mutex(true, PortablePaths.InstanceMutexName(portable.DataRoot), out singleInstance))
            {
                if (!singleInstance)
                {
                    MessageBox.Show(
                        "ОТ-База уже запущена из этой папки.\n\nВторое окно может затереть изменения первого.\n" +
                        "Закройте работающую копию или запустите программу из другой папки.",
                        "ОТ-База",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information);
                    return;
                }

                RunApplication(args, portable);
            }
        }

        private static void RunApplication(string[] args, PortableInfo portable)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.ThreadException += delegate(object sender, System.Threading.ThreadExceptionEventArgs e)
            {
                MessageBox.Show(e.Exception.Message, "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };

            try
            {
                Catalog catalog = Catalog.Load();
                // Расположение данных уже определено до замка: используем его же,
                // чтобы замок и рабочая папка не могли разойтись.
                Store store = Store.OpenAt(catalog, portable.DataRoot);
                store.Portable = portable;
                string startTab = null;
                string demo = null;
                for (int i = 0; i < args.Length - 1; i++)
                {
                    if (args[i] == "--tab") startTab = args[i + 1];
                    if (args[i] == "--demo") demo = args[i + 1];
                }

                if (!portable.IsPortable)
                {
                    MessageBox.Show(
                        "Рядом с программой нельзя записывать данные:\n" + portable.ExeDirectory +
                        "\n\n" + portable.FallbackReason +
                        "\n\nБаза будет храниться в:\n" + portable.DataRoot +
                        "\n\nДля переноса на другом компьютере скопируйте папку целиком (EXE + data + documents).",
                        "ОТ-База — режим без записи рядом с программой",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning);
                }

                Application.Run(new MainForm(store, startTab, demo));
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Не удалось запустить приложение.\n\n" + ex.Message,
                    "ОТ-База",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }
    }

    /// <summary>Проверка чтения XLSX: --import-test файл.xlsx.</summary>
    internal static class ImportTest
    {
        public static int Run(string path)
        {
            var log = new StringBuilder();
            int code = 0;
            try
            {
                var rows = XlsxReader.Read(path);
                log.AppendLine("rows=" + rows.Count);
                for (int i = 0; i < Math.Min(rows.Count, 5); i++)
                {
                    log.AppendLine("row" + i + ": " + string.Join(" | ", rows[i]));
                }
                code = rows.Count > 0 ? 0 : 1;
            }
            catch (Exception ex)
            {
                log.AppendLine("error: " + ex.Message);
                code = 1;
            }
            try { File.WriteAllText(Path.Combine(Path.GetTempPath(), "ot-xlsx-import.log"), log.ToString(), Encoding.UTF8); } catch { }
            return code;
        }
    }

    /// <summary>Проверка хранилища и движка обязательств без интерфейса: --selftest [каталог].</summary>
    internal static class SelfTest
    {
        /// <summary>Каталог проверки: отчёт пишется рядом с ним, чтобы его можно было прочитать.</summary>
        private static string selftestRoot;

        private static void WriteZipText(ZipArchive archive, string name, string text)
        {
            ZipArchiveEntry entry = archive.CreateEntry(name, CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
            {
                writer.Write(text);
            }
        }

        public static int Run(string targetDirectory)
        {
            var log = new StringBuilder();
            int failures = 0;

            Action<bool, string> check = delegate(bool condition, string message)
            {
                log.AppendLine((condition ? "OK   " : "FAIL ") + message);
                if (!condition) failures++;
            };

            try
            {
                string root = string.IsNullOrWhiteSpace(targetDirectory)
                    ? Path.Combine(Path.GetTempPath(), "ot-baza-native-selftest-" + DateTime.Now.ToString("HHmmss"))
                    : targetDirectory;
                selftestRoot = root;
                if (Directory.Exists(root)) Directory.Delete(root, true);
                Directory.CreateDirectory(root);

                Catalog catalog = Catalog.Load();
                check(catalog.Modules.Count == 7, "каталог модулей: 7 записей");
                check(catalog.Rules.Count >= 18, "правил обязательств: " + catalog.Rules.Count);

                Store store = Store.OpenAt(catalog, root);
                check(store.Tabs.Count >= 2, "вкладки базы на месте: " + store.Tabs.Count);
                check(store.InstalledModules.Count == 2, "установлено два базовых модуля");

                var employees = store.FindTabByModule("employees");
                var row = new Dictionary<string, object>
                {
                    { "id", "row_test_1" },
                    { "emp_fio", "Тестов Иван Иванович" },
                    { "emp_position", "Начальник цеха" },
                    { "emp_hire_date", ObligationsEngine.TodayIso() },
                    { "emp_status", "Работает" }
                };
                var rows = J.Arr(J.Get(employees, "rows"));
                rows.Add(row);
                J.Put(employees, "rows", rows.ToArray());

                ObligationsEngine.RegisterEvent(store, row, "hire", ObligationsEngine.TodayIso());
                check(store.Obligations.Count == 9, "приём: 9 требований (включая обучение руководителя), фактически " + store.Obligations.Count);

                var hireOrder = store.Obligations.Select(J.Obj)
                    .First(o => J.Str(J.Get(o, "requirementId")) == "hire_order");
                string docPath = DocxService.GenerateForObligation(store, hireOrder);
                check(docPath != null && File.Exists(docPath), "документ Word сформирован");
                if (docPath != null)
                {
                    check(docPath.Contains(Path.Combine("documents", "Приказы")), "документ сохранён в documents/<категория>");
                    using (var zip = System.IO.Compression.ZipFile.OpenRead(docPath))
                    {
                        var documentEntry = zip.GetEntry("word/document.xml");
                        check(documentEntry != null, "DOCX содержит word/document.xml");
                        if (documentEntry != null)
                        {
                            using (var reader = new StreamReader(documentEntry.Open()))
                            {
                                string xml = reader.ReadToEnd();
                                check(xml.Contains("Тестов Иван Иванович"), "в документ подставлено ФИО");
                                check(xml.Contains("Начальник цеха"), "в документ подставлена должность");
                                check(xml.Contains("ООО «Катания»") || xml.Contains("Катания"), "в документе есть организация");
                            }
                        }
                    }
                    check(J.Arr(J.Get(store.Entity, "generatedDocs")).Count >= 1, "запись добавлена в реестр документов");
                }

                var periodic = store.Obligations
                    .Select(J.Obj)
                    .First(o => J.Str(J.Get(o, "requirementId")) == "periodic_briefing");
                string nextDue = ObligationsEngine.AddMonths(J.Str(J.Get(periodic, "dueDate")), 6);
                ObligationsEngine.Complete(store, periodic);
                check(J.Str(J.Get(periodic, "status")) == "done", "повторный инструктаж закрыт");
                check(
                    store.Obligations.Select(J.Obj).Any(o => J.Str(J.Get(o, "id")) == J.Str(J.Get(periodic, "id")) + "_next_" + nextDue),
                    "для периодического требования создана следующая задача");

                ModuleDef medical = catalog.Module("medical");
                store.InstallModule(medical);
                check(store.FindTabByModule("medical") != null, "модуль «Медосмотры» установлен: вкладка создана копированием");
                check(store.InstalledModules.Contains("medical"), "модуль отмечен установленным");
                check(J.Arr(J.Get(store.FindTabByModule("medical"), "columns")).Count >= 5, "у вкладки модуля свои колонки");

                string customId = store.CreateCustomModule("Пожарная безопасность", "Инструктаж, Дата, Ответственный");
                check(catalog.Module(customId) != null, "пользовательский модуль добавлен в каталог");
                check(catalog.Modules.Count == 8, "каталог после создания модуля: " + catalog.Modules.Count);
                check(J.Arr(J.Get(store.FindTabByModule(customId), "columns")).Count == 3, "у нового модуля свои колонки");

                store.Save();
                string dbPath = Path.Combine(root, "data", "ot_database.json");
                check(File.Exists(dbPath), "база записана в data/ot_database.json");
                check(File.Exists(Path.Combine(root, "data", "native_modules.json")), "каталог пользовательских модулей сохранён");

                Store reloaded = Store.OpenAt(Catalog.Load(), root);
                check(reloaded.Obligations.Count == store.Obligations.Count, "после перезапуска обязательства на месте");
                check(reloaded.FindTabByModule("medical") != null, "после перезапуска вкладка модуля на месте");
                check(reloaded.Tabs.Count == store.Tabs.Count, "после перезапуска число вкладок совпадает");

                check(File.Exists(Path.Combine(root, "data", "backups", "ot_database_prev.json")), "создана резервная копия предыдущей базы");

                // Экспорт CSV: экранирование структуры файла и нейтрализация формул.
                check(CsvExport.Escape("Иванов;Пётр") == "\"Иванов;Пётр\"", "CSV: разделитель экранирован");
                check(CsvExport.Escape("ООО \"Ромашка\"") == "\"ООО \"\"Ромашка\"\"\"", "CSV: кавычки удвоены");
                check(CsvExport.Escape("=HYPERLINK(\"http://x\")") == "\"'=HYPERLINK(\"\"http://x\"\")\"", "CSV: формула нейтрализована");
                check(CsvExport.Escape("-42,5") == "-42,5", "CSV: отрицательное число не испорчено");
                check(CsvExport.Escape("@SUM(A1)") == "'@SUM(A1)", "CSV: значение с @ нейтрализовано");

                // Портативность: данные рядом с EXE и замок запуска на папку.
                PortableInfo portable = PortablePaths.Resolve();
                check(
                    portable.IsPortable && string.Equals(portable.DataRoot, portable.ExeDirectory, StringComparison.OrdinalIgnoreCase),
                    "портативность: данные пишутся рядом с EXE (" + portable.DataRoot + ")");
                check(
                    PortablePaths.InstanceMutexName(portable.DataRoot) ==
                    PortablePaths.InstanceMutexName(portable.DataRoot + Path.DirectorySeparatorChar),
                    "замок запуска: один путь — одно имя");
                check(
                    PortablePaths.InstanceMutexName(portable.DataRoot) !=
                    PortablePaths.InstanceMutexName(portable.DataRoot + "_2"),
                    "замок запуска: разные папки — разные имена");

                // Excel: выгрузка и обратное чтение тем же приложением.
                string xlsxPath = Path.Combine(root, "probe-export.xlsx");
                var matrix = new List<string[]>();
                matrix.Add(new[] { "ФИО", "Дата приёма", "Стаж" });
                matrix.Add(new[] { "Иванов; Иван", "2026-11-27", "7" });
                matrix.Add(new[] { "007", "2026-02-01", "-42,5" });
                XlsxWriter.Write(
                    xlsxPath,
                    "Сотрудники: тест/1",
                    matrix,
                    new List<int> { 160, 120, 80 },
                    new List<bool> { false, true, false });
                var readBack = XlsxReader.Read(xlsxPath);
                check(readBack.Count == 3 && readBack[0][0] == "ФИО" && readBack[0][1] == "Дата приёма",
                    "Excel: файл читается обратно, шапка на месте");
                check(readBack[1][1] == "27.11.2026",
                    "Excel: дата выгружена настоящей датой: " + readBack[1][1]);
                check(DateText.Normalize(readBack[1][1]) == "2026-11-27",
                    "Excel: дата из Excel приводится к ISO при импорте");
                check(readBack[2][0] == "007", "Excel: ведущие нули не потеряны");
                check(readBack[2][2] == "-42,5", "Excel: «42,5» остаётся текстом");
                check(readBack[1][2] == "7", "Excel: целое число выгружено числом");

                // Свои шаблоны документов: текст с тегами + синонимы веб-шаблонов.
                var templates = J.Arr(J.Get(store.Entity, "templates"));
                templates.Add(new Dictionary<string, object>
                {
                    { "id", "tpl_user_test" },
                    { "name", "Тестовый документ" },
                    { "category", "Проверка" },
                    { "contentTemplate", "Сотрудник: {ФИО}\nОрганизация: {Организация_полное}\nДолжность: {Должность}\nДиректор: {Генеральный_директор}" }
                });
                J.Put(store.Entity, "templates", templates.Cast<object>().ToArray());
                string userTemplateDoc = DocxService.Generate(store, "row_test_1", "tpl_user_test", ObligationsEngine.TodayIso());
                check(userTemplateDoc != null && File.Exists(userTemplateDoc), "шаблоны: документ по своему шаблону сформирован");
                if (userTemplateDoc != null)
                {
                    using (var zip = System.IO.Compression.ZipFile.OpenRead(userTemplateDoc))
                    {
                        var entry = zip.GetEntry("word/document.xml");
                        string xml = entry == null ? string.Empty : new StreamReader(entry.Open()).ReadToEnd();
                        check(xml.Contains("Тестов Иван Иванович"), "шаблоны: тег {ФИО} подставлен");
                        check(xml.Contains("Катания"), "шаблоны: синоним {Организация_полное} подставлен");
                    }
                }

                // Готовый .docx-шаблон: теги, разорванные Word на прогоны, всё равно подставляются.
                string docxTemplatePath = Path.Combine(store.TemplatesDirectory, "split.docx");
                string docxXml =
                    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                    "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>" +
                    "<w:p><w:r><w:t>Работник: {ФИ</w:t></w:r><w:r><w:t>О}, должность: {Долж</w:t></w:r><w:r><w:t>ность}</w:t></w:r></w:p>" +
                    "<w:p><w:r><w:t>Организация: {Организация_полное}</w:t></w:r></w:p>" +
                    "<w:p><w:r><w:t>Проверка &amp; экранирования &lt;тег&gt;</w:t></w:r></w:p>" +
                    "<w:p><w:r><w:t>Неизвестный {Такой_тег} остаётся как есть</w:t></w:r></w:p>" +
                    "</w:body></w:document>";
                using (var stream = new FileStream(docxTemplatePath, FileMode.Create, FileAccess.Write))
                using (var archive = new ZipArchive(stream, ZipArchiveMode.Create))
                {
                    WriteZipText(archive, "[Content_Types].xml",
                        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
                        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
                        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
                        "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
                        "</Types>");
                    WriteZipText(archive, "_rels/.rels",
                        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
                        "</Relationships>");
                    WriteZipText(archive, "word/document.xml", docxXml);
                }

                var docxTags = DocxTemplateService.ListTags(docxTemplatePath);
                check(docxTags.Contains("ФИО") && docxTags.Contains("Должность"),
                    "docx-шаблон: теги найдены (" + string.Join(", ", docxTags.ToArray()) + ")");

                var docxTemplates = J.Arr(J.Get(store.Entity, "templates"));
                docxTemplates.Add(new Dictionary<string, object>
                {
                    { "id", "tpl_docx_test" },
                    { "name", "Бланк из Word" },
                    { "category", "Проверка" },
                    { "kind", "docx" },
                    { "templateFile", "templates/split.docx" },
                    { "contentTemplate", string.Empty }
                });
                J.Put(store.Entity, "templates", docxTemplates.Cast<object>().ToArray());

                string docxOut = DocxService.Generate(store, "row_test_1", "tpl_docx_test", ObligationsEngine.TodayIso());
                check(docxOut != null && File.Exists(docxOut), "docx-шаблон: документ сформирован из бланка Word");
                if (docxOut != null)
                {
                    using (var zip = System.IO.Compression.ZipFile.OpenRead(docxOut))
                    {
                        var entry = zip.GetEntry("word/document.xml");
                        string xml = entry == null ? string.Empty : new StreamReader(entry.Open()).ReadToEnd();
                        check(xml.Contains("Тестов Иван Иванович"), "docx-шаблон: тег, разорванный на 3 прогона, подставлен");
                        check(xml.Contains("Начальник цеха"), "docx-шаблон: должность подставлена");
                        check(xml.Contains("Общество с ограниченной ответственностью «Катания»"),
                            "docx-шаблон: синоним {Организация_полное} подставлен");
                        check(xml.Contains("Проверка &amp; экранирования &lt;тег&gt;"),
                            "docx-шаблон: XML-экранирование сохранено");
                        check(xml.Contains("{Такой_тег}"), "docx-шаблон: неизвестный тег не тронут");
                        check(!xml.Contains("{ФИ"), "docx-шаблон: обрывков тега не осталось");
                    }
                }

                // PDF с кириллицей: встроенный шрифт, карта символов и валидный xref.
                PdfFont probeFont = PdfFont.LoadFromResource("DejaVuSans.ttf");
                check(probeFont.GlyphId('А') > 0 && probeFont.GlyphId('я') > 0 && probeFont.GlyphId('Ё') > 0,
                    "PDF: в шрифте есть кириллица (А, я, Ё)");
                string pdfPath = Path.Combine(root, "probe.pdf");
                string longText = string.Join(" ", Enumerable.Repeat(
                    "Длинный абзац для проверки переноса строк, разбиения на страницы и кириллицы.", 60).ToArray());
                PdfService.Save(
                    pdfPath,
                    "ПРИКАЗ О ПРИЁМЕ НА РАБОТУ",
                    "Работник: Тестов Иван Иванович\nДолжность: Начальник цеха\nДата: 27.11.2026\n\n" +
                    "[ТАБЛИЦА]\nСИЗ|Норма|Дата выдачи\nКаска защитная|1 шт|27.11.2026\n[/ТАБЛИЦА]\n\n" + longText);
                byte[] pdfBytes = File.ReadAllBytes(pdfPath);
                string pdfText = System.Text.Encoding.ASCII.GetString(pdfBytes);
                check(pdfBytes.Length > 20000, "PDF: файл создан (" + pdfBytes.Length + " байт)");
                check(pdfText.StartsWith("%PDF-1.4"), "PDF: корректный заголовок %PDF-1.4");
                check(pdfText.Contains("/FontFile2") && pdfText.Contains("/ToUnicode") &&
                      pdfText.Contains("/Identity-H") && pdfText.Contains("/BaseFont /DejaVuSans"),
                    "PDF: шрифт, кодировка Identity-H и ToUnicode встроены");
                check(pdfText.Contains("%%EOF"), "PDF: файл завершён %%EOF");

                int startxrefAt = pdfText.LastIndexOf("startxref", StringComparison.Ordinal);
                int xrefOffset = -1;
                if (startxrefAt >= 0)
                {
                    string tail = pdfText.Substring(startxrefAt + 9).Trim();
                    int lineEnd = tail.IndexOf('\n');
                    if (lineEnd < 0) lineEnd = tail.Length;
                    int.TryParse(tail.Substring(0, lineEnd).Trim(), out xrefOffset);
                }
                check(xrefOffset > 0 && xrefOffset < pdfBytes.Length &&
                      pdfText.Substring(xrefOffset, 4) == "xref",
                    "PDF: таблица xref найдена по указанному смещению");
                int pages = pdfText.Contains("/Count 2") ? 2 : pdfText.Contains("/Count 3") ? 3 : 1;
                check(pages >= 2, "PDF: длинный текст разбит на страницы (" + pages + ")");

                // Готовность к проверке ГИТ: 9 направлений, 100 баллов, экспорт PDF и CSV.
                ReadinessReport readiness = GitReadiness.Evaluate(store);
                check(readiness.Items.Count == 9, "готовность ГИТ: 9 направлений");
                check(readiness.MaxTotal == 100, "готовность ГИТ: максимум 100 баллов");
                check(readiness.Total >= 0 && readiness.Total <= 100 && readiness.Percent >= 0 && readiness.Percent <= 100,
                    "готовность ГИТ: баллы в диапазоне (" + readiness.Total + "/" + readiness.MaxTotal + ", " + readiness.Percent + "%)");
                check(readiness.Items.All(item => item.Score >= 0 && item.Score <= item.MaxScore),
                    "готовность ГИТ: ни один балл не выходит за максимум");
                check(readiness.Items.Any(item => item.Title.Contains("Штатное расписание")),
                    "готовность ГИТ: есть направление по штатному расписанию и СОУТ");
                check(readiness.Items.Any(item => item.Title.Contains("Ссылочная целостность")),
                    "готовность ГИТ: есть проверка ссылочной целостности");

                string readinessText = GitReadiness.ToText(readiness);
                check(readinessText.Contains("Индекс готовности") && readinessText.Contains("Самопроверка"),
                    "готовность ГИТ: в отчёте есть индекс и дисклеймер");
                string readinessCsv = GitReadiness.ToCsv(readiness);
                check(readinessCsv.Split('\n').Length >= 11, "готовность ГИТ: CSV содержит шапку, 9 направлений и итог");
                string readinessPdf = Path.Combine(root, "readiness.pdf");
                PdfService.Save(readinessPdf, "Готовность к проверке ГИТ", readinessText);
                check(File.Exists(readinessPdf) && new FileInfo(readinessPdf).Length > 20000,
                    "готовность ГИТ: PDF-отчёт сформирован (" + new FileInfo(readinessPdf).Length + " байт)");

                // Нормативная база: у каждого требования есть основание и событие.
                check(catalog.Rules.Count == 18, "нормативная база: 18 требований");
                check(catalog.Rules.All(rule => !string.IsNullOrWhiteSpace(rule.LegalBasis)),
                    "нормативная база: у каждого требования указано основание");
                check(catalog.Rules.Select(rule => rule.Event).Distinct().Count() >= 4,
                    "нормативная база: покрыты все события жизненного цикла");

                // Организации: раздельные списки, переключение и возврат.
                string firstEntityId = store.ActiveEntityId;
                int firstEntityRows = store.Tabs.Sum(tab => J.Arr(J.Get(J.Obj(tab), "rows")).Count);
                var second = store.CreateOrganization("ООО «Вторая»", "Общество с ограниченной ответственностью «Вторая»");
                check(store.Entities.Count == 2, "организации: создана вторая");
                store.SetActiveEntity(J.Str(J.Get(second, "id")));
                check(J.Str(J.Get(store.Profile, "shortName")) == "ООО «Вторая»", "организации: переключение на вторую");
                check(store.FindTabByModule("employees") != null, "организации: у новой есть вкладка «Сотрудники»");
                check(store.Tabs.Sum(tab => J.Arr(J.Get(J.Obj(tab), "rows")).Count) == 0,
                    "организации: списки новой пустые (данные не скопированы)");
                store.SetActiveEntity(firstEntityId);
                check(J.Str(J.Get(store.Profile, "shortName")) == "ООО «Катания»", "организации: возврат к первой");
                check(store.Tabs.Sum(tab => J.Arr(J.Get(J.Obj(tab), "rows")).Count) == firstEntityRows,
                    "организации: данные первой не изменились");

                // Бэкапы: предыдущая версия базы и дневная копия.
                string backupDir = Path.Combine(root, "data", "backups");
                check(Directory.GetFiles(backupDir, "ot_database_20*.json").Length == 1,
                    "бэкап: создана дневная копия базы");
            }
            catch (Exception ex)
            {
                log.AppendLine("FAIL исключение: " + ex);
                failures++;
            }

            log.AppendLine(failures == 0 ? "ИТОГ: все проверки пройдены" : "ИТОГ: ошибок " + failures);
            string logPath = string.IsNullOrEmpty(selftestRoot)
                ? Path.Combine(Path.GetTempPath(), "ot-baza-native-selftest.log")
                : Path.Combine(selftestRoot, "selftest.log");
            try { File.WriteAllText(logPath, log.ToString(), Encoding.UTF8); } catch { }
            return failures == 0 ? 0 : 1;
        }
    }
}
