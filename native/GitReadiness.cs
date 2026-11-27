using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace OtBaza
{
    /// <summary>Одно направление проверки готовности к ГИТ.</summary>
    internal sealed class ReadinessItem
    {
        public string Title;
        public int Score;
        public int MaxScore;
        public string Status;   // ok | warn | critical
        public string Summary;
        public string Advice;
    }

    internal sealed class ReadinessReport
    {
        public string Organization = string.Empty;
        public string Date = string.Empty;
        public List<ReadinessItem> Items = new List<ReadinessItem>();
        public int Total;
        public int MaxTotal;
        public int Percent;
        public string Level = "low";
        public string LevelLabel = "низкий";
        public int PassedCount;
        public int WarningCount;
        public int CriticalCount;

        public string Verdict
        {
            get
            {
                return string.Format(
                    CultureInfo.InvariantCulture,
                    "Индекс готовности: {0}% ({1} из {2} баллов) — {3}",
                    Percent, Total, MaxTotal, LevelLabel);
            }
        }
    }

    /// <summary>
    /// Самопроверка готовности к проверке ГИТ: 9 направлений, 100 баллов.
    /// Считается по фактическим данным базы, без интернета и без ИИ.
    /// Это ориентир, а не заключение государственного инспектора.
    /// </summary>
    internal static class GitReadiness
    {
        public const string Disclaimer =
            "Самопроверка по данным базы. Не заменяет проверку государственного инспектора труда " +
            "и не является юридическим заключением: баллы показывают, какие документы и записи стоит добрать.";

        public static ReadinessReport Evaluate(Store store)
        {
            var report = new ReadinessReport();
            report.Organization = J.Str(J.Get(store.Profile, "shortName"));
            if (report.Organization.Length == 0) report.Organization = J.Str(J.Get(store.Profile, "fullName"));
            report.Date = DateTime.Today.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture);

            report.Items.Add(CheckRequisites(store));
            report.Items.Add(CheckStaffing(store));
            report.Items.Add(CheckEmployees(store));
            report.Items.Add(CheckModuleObligations(store, "briefings", "Инструктажи и обучение по охране труда", 15));
            report.Items.Add(CheckModuleObligations(store, "medical", "Предварительные и периодические медосмотры", 10));
            report.Items.Add(CheckModuleObligations(store, "ppe", "Личные карточки и сроки носки СИЗ", 10));
            report.Items.Add(CheckDeadlines(store));
            report.Items.Add(CheckIntegrity(store));
            report.Items.Add(CheckDocuments(store));

            report.Total = report.Items.Sum(item => item.Score);
            report.MaxTotal = report.Items.Sum(item => item.MaxScore);
            report.Percent = report.MaxTotal > 0 ? (int)Math.Round(report.Total * 100.0 / report.MaxTotal) : 0;
            report.Level = report.Percent >= 80 ? "high" : report.Percent >= 55 ? "medium" : "low";
            report.LevelLabel = report.Level == "high" ? "высокий" : report.Level == "medium" ? "средний" : "низкий";
            report.PassedCount = report.Items.Count(item => item.Status == "ok");
            report.WarningCount = report.Items.Count(item => item.Status == "warn");
            report.CriticalCount = report.Items.Count(item => item.Status == "critical");
            return report;
        }

        private static string StatusFor(int score, int max)
        {
            if (score >= max) return "ok";
            return score >= max * 0.6 ? "warn" : "critical";
        }

        private static ReadinessItem Make(string title, int score, int max, string summary, string advice)
        {
            int safeScore = Math.Max(0, Math.Min(max, score));
            return new ReadinessItem
            {
                Title = title,
                Score = safeScore,
                MaxScore = max,
                Status = StatusFor(safeScore, max),
                Summary = summary,
                Advice = advice
            };
        }

        private static ReadinessItem CheckRequisites(Store store)
        {
            const int max = 10;
            var profile = store.Profile;
            var required = new[]
            {
                "fullName", "shortName", "inn", "kpp", "ogrn", "legalAddress", "directorFio", "phone", "email"
            };
            var missing = required.Where(field => J.Str(J.Get(profile, field)).Trim().Length == 0).ToList();
            int score = missing.Count == 0 ? max : Math.Max(3, max - missing.Count * 2);
            string summary = missing.Count == 0
                ? "Реквизиты, адрес и руководитель заполнены"
                : "Пустых полей: " + missing.Count;
            string advice = missing.Count == 0
                ? "—"
                : "Заполните: " + string.Join(", ", missing.Select(FieldLabel).ToArray());
            return Make("Реквизиты организации и руководитель", score, max, summary, advice);
        }

        private static string FieldLabel(string field)
        {
            switch (field)
            {
                case "fullName": return "полное наименование";
                case "shortName": return "краткое наименование";
                case "inn": return "ИНН";
                case "kpp": return "КПП";
                case "ogrn": return "ОГРН";
                case "legalAddress": return "юридический адрес";
                case "directorFio": return "руководитель";
                case "phone": return "телефон";
                case "email": return "e-mail";
                default: return field;
            }
        }

        private static ReadinessItem CheckStaffing(Store store)
        {
            const int max = 15;
            var staffing = store.FindTabByModule("staffing");
            int positions = staffing == null ? 0 : J.Arr(J.Get(staffing, "rows")).Count;
            if (positions == 0)
            {
                return Make("Штатное расписание, СОУТ, факторы 29н и нормы СИЗ 766н", 4, max,
                    "Штатное расписание не заполнено", "Добавьте должности: без них не считаются медосмотры и СИЗ");
            }

            var sout = store.FindTabByModule("sout");
            int soutRows = sout == null ? 0 : J.Arr(J.Get(sout, "rows")).Count;

            int emptyCells = 0;
            int checkedCells = 0;
            foreach (object item in J.Arr(J.Get(staffing, "rows")))
            {
                var row = J.Obj(item);
                if (row == null) continue;
                foreach (object columnItem in J.Arr(J.Get(staffing, "columns")))
                {
                    var column = J.Obj(columnItem);
                    if (column == null) continue;
                    string name = J.Str(J.Get(column, "name"));
                    if (!LooksLikeSoutField(name)) continue;
                    checkedCells++;
                    if (J.Str(J.Get(row, J.Str(J.Get(column, "id")))).Trim().Length == 0) emptyCells++;
                }
            }

            int score;
            string summary;
            string advice;
            if (soutRows == 0 && checkedCells == 0)
            {
                score = 8;
                summary = "Должностей: " + positions + ", результатов СОУТ нет";
                advice = "Заполните класс условий труда и вредные факторы по результатам СОУТ";
            }
            else if (emptyCells > 0)
            {
                score = Math.Max(4, max - Math.Min(11, emptyCells * 2));
                summary = "Должностей: " + positions + ", пустых полей СОУТ/норм: " + emptyCells;
                advice = "Заполните класс условий труда, факторы 29н и нормы выдачи СИЗ по должностям";
            }
            else
            {
                score = max;
                summary = "Должностей: " + positions + ", СОУТ и нормы заполнены";
                advice = "—";
            }
            return Make("Штатное расписание, СОУТ, факторы 29н и нормы СИЗ 766н", score, max, summary, advice);
        }

        private static bool LooksLikeSoutField(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return false;
            string lower = name.ToLowerInvariant();
            return lower.Contains("класс") || lower.Contains("соут") || lower.Contains("фактор") || lower.Contains("норма");
        }

        private static ReadinessItem CheckEmployees(Store store)
        {
            const int max = 15;
            var employees = store.FindTabByModule("employees");
            var rows = employees == null
                ? new List<Dictionary<string, object>>()
                : J.Arr(J.Get(employees, "rows")).Select(J.Obj).Where(row => row != null).ToList();
            var active = rows.Where(row => !Employees.Read(store, row).Status.ToLowerInvariant().Contains("уволен")).ToList();

            if (active.Count == 0)
            {
                return Make("Список работников и индивидуальные пакеты ОТ", 3, max,
                    "В реестре нет активных работников", "Добавьте работников — по ним формируются требования и документы");
            }

            var obligations = store.Obligations.Select(J.Obj).Where(item => item != null).ToList();
            int overdue = obligations.Count(item => !ObligationsEngine.IsDone(item) && ObligationsEngine.DaysLeft(item) < 0);

            var documents = J.Arr(J.Get(store.Entity, "generatedDocs")).Select(J.Obj).Where(item => item != null).ToList();
            var withPackage = new HashSet<string>(
                documents.Select(item => J.Str(J.Get(item, "rowIdentifier"))).Where(value => value.Length > 0));

            int withoutPackage = active.Count(row =>
            {
                string fio = Employees.Read(store, row).Fio;
                return fio.Length == 0 || !withPackage.Contains(fio);
            });

            int score = Math.Max(3, max - Math.Min(12, overdue * 2 + withoutPackage));
            string summary = "Активных работников: " + active.Count + ", без пакета документов: " + withoutPackage +
                             (overdue > 0 ? ", просрочено требований: " + overdue : string.Empty);
            string advice = score >= max
                ? "—"
                : "Сформируйте пакеты документов по работникам и закройте просроченные требования";
            return Make("Список работников и индивидуальные пакеты ОТ", score, max, summary, advice);
        }

        private static ReadinessItem CheckModuleObligations(Store store, string moduleId, string title, int max)
        {
            var obligations = store.Obligations
                .Select(J.Obj)
                .Where(item => item != null && J.Str(J.Get(item, "moduleId")) == moduleId)
                .ToList();

            if (obligations.Count == 0)
            {
                return Make(title, 2, max,
                    "Требований нет: события приёма/перевода не зарегистрированы",
                    "Отметьте события по работникам (приём, перевод) — требования появятся автоматически");
            }

            int done = obligations.Count(ObligationsEngine.IsDone);
            int overdue = obligations.Count(item => !ObligationsEngine.IsDone(item) && ObligationsEngine.DaysLeft(item) < 0);
            int score = Math.Max(2, (int)Math.Round(max * (double)done / obligations.Count) - Math.Min(5, overdue));
            string summary = "Выполнено: " + done + " из " + obligations.Count +
                             (overdue > 0 ? ", просрочено: " + overdue : string.Empty);
            string advice = score >= max
                ? "—"
                : "Закройте просроченные требования и запланируйте предстоящие";
            return Make(title, score, max, summary, advice);
        }

        private static ReadinessItem CheckDeadlines(Store store)
        {
            const int max = 10;
            var obligations = store.Obligations.Select(J.Obj).Where(item => item != null && !ObligationsEngine.IsDone(item)).ToList();
            if (obligations.Count == 0)
            {
                return Make("Сводный календарь сроков ОТ и нерабочие дни", 4, max,
                    "Контролируемых сроков нет", "Заполните события и даты — календарь сроков заработает");
            }

            int overdue = obligations.Count(item => ObligationsEngine.DaysLeft(item) < 0);
            int score = overdue == 0 ? max : overdue <= 2 ? 7 : Math.Max(1, max - overdue * 2);
            string summary = "Активных требований: " + obligations.Count + ", просрочено: " + overdue;
            string advice = overdue == 0 ? "—" : "Устраните просроченные сроки — это первое, что смотрит инспектор";
            return Make("Сводный календарь сроков ОТ и нерабочие дни", score, max, summary, advice);
        }

        private static ReadinessItem CheckIntegrity(Store store)
        {
            const int max = 10;
            var issues = new List<string>();

            var employees = store.FindTabByModule("employees");
            var employeeIds = new HashSet<string>(
                employees == null
                    ? new List<string>()
                    : J.Arr(J.Get(employees, "rows")).Select(J.Obj).Where(row => row != null)
                        .Select(row => J.Str(J.Get(row, "id"))));

            int orphanObligations = store.Obligations
                .Select(J.Obj)
                .Count(item => item != null && !employeeIds.Contains(J.Str(J.Get(item, "employeeRowId"))));
            if (orphanObligations > 0) issues.Add("требований без работника: " + orphanObligations);

            int missingDocs = 0;
            foreach (object item in J.Arr(J.Get(store.Entity, "generatedDocs")))
            {
                var doc = J.Obj(item);
                if (doc == null) continue;
                string relative = J.Str(J.Get(doc, "relativePath"));
                if (relative.Length == 0) continue;
                string path = Path.Combine(store.DataRoot, relative.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(path)) missingDocs++;
            }
            if (missingDocs > 0) issues.Add("документов нет на диске: " + missingDocs);

            int missingTemplates = 0;
            foreach (object item in J.Arr(J.Get(store.Entity, "templates")))
            {
                var template = J.Obj(item);
                if (template == null) continue;
                if (!string.Equals(J.Str(J.Get(template, "kind")), "docx", StringComparison.OrdinalIgnoreCase)) continue;
                string file = J.Str(J.Get(template, "templateFile"));
                if (file.Length == 0) continue;
                string path = Path.Combine(store.DataRoot, file.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(path)) missingTemplates++;
            }
            if (missingTemplates > 0) issues.Add("бланков Word нет на диске: " + missingTemplates);

            int score = Math.Max(0, max - issues.Count * 2);
            if (issues.Count == 0)
            {
                return Make("Ссылочная целостность таблиц и шаблонных тегов", max, max,
                    "Связи, документы и бланки на месте", "—");
            }
            return Make("Ссылочная целостность таблиц и шаблонных тегов", score, max,
                "Нарушений: " + issues.Count + " (" + string.Join("; ", issues.ToArray()) + ")",
                "Исправьте нарушения: пересоздайте документы и восстановите бланки");
        }

        private static ReadinessItem CheckDocuments(Store store)
        {
            const int max = 5;
            var documents = J.Arr(J.Get(store.Entity, "generatedDocs")).Select(J.Obj).Where(item => item != null).ToList();
            int orders = documents.Count(item =>
            {
                string category = J.Str(J.Get(item, "category")).ToLowerInvariant();
                return category.Contains("приказ") || category.Contains("протокол");
            });

            int rules = store.Catalog.Rules.Count;
            int score = orders >= 3 ? max : orders > 0 ? 3 : 0;
            string summary = "Приказов и протоколов: " + orders + ", правил в нормативной базе: " + rules;
            string advice = score >= max
                ? "—"
                : "Сформируйте приказы и протоколы из карточки работника или из шаблонов";
            return Make("Нормативная база и реестр сформированных приказов/протоколов", score, max, summary, advice);
        }

        /// <summary>Текст отчёта для PDF и предпросмотра.</summary>
        public static string ToText(ReadinessReport report)
        {
            var text = new StringBuilder();
            text.AppendLine("Организация: " + report.Organization);
            text.AppendLine("Дата проверки: " + report.Date);
            text.AppendLine();
            text.AppendLine(report.Verdict);
            text.AppendLine("Направлений: " + report.Items.Count + "; без замечаний: " + report.PassedCount +
                            ", предупреждений: " + report.WarningCount + ", критично: " + report.CriticalCount);
            text.AppendLine();
            text.AppendLine("[ТАБЛИЦА]");
            text.AppendLine("Направление|Балл|Статус|Что улучшить");
            foreach (var item in report.Items)
            {
                text.AppendLine(item.Title + "|" + item.Score + " из " + item.MaxScore + "|" +
                                StatusLabel(item.Status) + "|" + (item.Advice == "—" ? item.Summary : item.Advice));
            }
            text.AppendLine("[/ТАБЛИЦА]");
            text.AppendLine();

            var gaps = report.Items.Where(item => item.Status != "ok").ToList();
            if (gaps.Count == 0)
            {
                text.AppendLine("Замечаний нет: по всем направлениям данные заполнены.");
            }
            else
            {
                text.AppendLine("ЧТО ДОБРАТЬ");
                int index = 1;
                foreach (var item in gaps)
                {
                    text.AppendLine(index + ". " + item.Title + " — " + item.Summary);
                    if (item.Advice != "—") text.AppendLine("   " + item.Advice);
                    index++;
                }
            }
            text.AppendLine();
            text.AppendLine(Disclaimer);
            return text.ToString();
        }

        public static string StatusLabel(string status)
        {
            switch (status)
            {
                case "ok": return "в порядке";
                case "warn": return "внимание";
                default: return "критично";
            }
        }

        /// <summary>CSV для Excel: точка с запятой, без формул-инъекций.</summary>
        public static string ToCsv(ReadinessReport report)
        {
            var builder = new StringBuilder();
            builder.AppendLine(string.Join(";", new[]
            {
                CsvExport.Escape("Направление"),
                CsvExport.Escape("Балл"),
                CsvExport.Escape("Максимум"),
                CsvExport.Escape("Статус"),
                CsvExport.Escape("Комментарий"),
                CsvExport.Escape("Что улучшить")
            }));
            foreach (var item in report.Items)
            {
                builder.AppendLine(string.Join(";", new[]
                {
                    CsvExport.Escape(item.Title),
                    CsvExport.Escape(item.Score.ToString(CultureInfo.InvariantCulture)),
                    CsvExport.Escape(item.MaxScore.ToString(CultureInfo.InvariantCulture)),
                    CsvExport.Escape(StatusLabel(item.Status)),
                    CsvExport.Escape(item.Summary),
                    CsvExport.Escape(item.Advice)
                }));
            }
            builder.AppendLine(string.Join(";", new[]
            {
                CsvExport.Escape("Итого"),
                CsvExport.Escape(report.Total.ToString(CultureInfo.InvariantCulture)),
                CsvExport.Escape(report.MaxTotal.ToString(CultureInfo.InvariantCulture)),
                CsvExport.Escape(report.Percent + "%"),
                CsvExport.Escape(report.Verdict),
                CsvExport.Escape(Disclaimer)
            }));
            return builder.ToString();
        }
    }
}
