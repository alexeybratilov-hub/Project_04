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
            if (args.Length > 0 && args[0] == "--selftest")
            {
                Environment.ExitCode = SelfTest.Run(args.Length > 1 ? args[1] : null);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.ThreadException += delegate(object sender, System.Threading.ThreadExceptionEventArgs e)
            {
                MessageBox.Show(e.Exception.Message, "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };

            try
            {
                Catalog catalog = Catalog.Load();
                Store store = Store.Open(catalog);
                string startTab = null;
                string demo = null;
                for (int i = 0; i < args.Length - 1; i++)
                {
                    if (args[i] == "--tab") startTab = args[i + 1];
                    if (args[i] == "--demo") demo = args[i + 1];
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

    /// <summary>Проверка хранилища и движка обязательств без интерфейса: --selftest [каталог].</summary>
    internal static class SelfTest
    {
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
            }
            catch (Exception ex)
            {
                log.AppendLine("FAIL исключение: " + ex);
                failures++;
            }

            log.AppendLine(failures == 0 ? "ИТОГ: все проверки пройдены" : "ИТОГ: ошибок " + failures);
            string logPath = Path.Combine(Path.GetTempPath(), "ot-baza-native-selftest.log");
            try { File.WriteAllText(logPath, log.ToString(), Encoding.UTF8); } catch { }
            return failures == 0 ? 0 : 1;
        }
    }
}
