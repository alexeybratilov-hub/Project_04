using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace OtBaza
{
    /// <summary>
    /// Движок обязательств: событие жизненного цикла работника порождает набор
    /// требований по данным каталога модулей. Правила — данные, не код.
    /// </summary>
    internal static class ObligationsEngine
    {
        public static string TodayIso()
        {
            return DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        public static string NowIso()
        {
            return DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);
        }

        public static string AddDays(string isoDate, int days)
        {
            DateTime date = ParseIso(isoDate);
            return date.AddDays(days).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        public static string AddMonths(string isoDate, int months)
        {
            DateTime date = ParseIso(isoDate);
            return date.AddMonths(months).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        public static DateTime ParseIso(string isoDate)
        {
            DateTime parsed;
            if (!string.IsNullOrWhiteSpace(isoDate) &&
                DateTime.TryParseExact(isoDate.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out parsed))
            {
                return parsed;
            }
            return DateTime.Today;
        }

        public static string ResolveSoutClass(Store store, string position)
        {
            if (string.IsNullOrWhiteSpace(position)) return string.Empty;
            var staffing = store.FindTabByModule("staffing");
            if (staffing == null) return string.Empty;
            var rows = J.Arr(J.Get(staffing, "rows"));
            foreach (object item in rows)
            {
                var row = J.Obj(item);
                if (row == null) continue;
                if (string.Equals(J.Str(J.Get(row, "pos_title")).Trim(), position.Trim(), StringComparison.OrdinalIgnoreCase))
                {
                    return J.Str(J.Get(row, "pos_sout_class")).Trim();
                }
            }
            return string.Empty;
        }

        public static void RegisterEvent(Store store, Dictionary<string, object> employeeRow, string eventType, string eventDateIso)
        {
            string rowId = J.Str(J.Get(employeeRow, "id"));
            if (rowId.Length == 0 || employeeRow == null) return;

            string eventId = "evt_" + rowId + "_" + eventType + "_" + DateTime.Now.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture);
            var events = store.Events;
            events.Add(new Dictionary<string, object>
            {
                { "id", eventId },
                { "employeeRowId", rowId },
                { "type", eventType },
                { "date", eventDateIso },
                { "createdAt", NowIso() }
            });
            J.Put(store.Entity, "employeeEvents", events.ToArray());

            string position = J.Str(J.Get(employeeRow, "emp_position"));
            string soutClass = ResolveSoutClass(store, position);

            foreach (ObligationRule rule in store.Catalog.Rules.Where(r => r.Event == eventType))
            {
                if (rule.PositionMatches.Count > 0)
                {
                    string lower = position.ToLowerInvariant();
                    bool matches = rule.PositionMatches.Any(part => lower.Contains(part.ToLowerInvariant()));
                    if (!matches) continue;
                }

                int? periodicity = rule.PeriodicityMonths;
                int byClass;
                if (soutClass.Length > 0 && rule.PeriodicityBySoutClass.TryGetValue(soutClass, out byClass))
                {
                    periodicity = byClass;
                }

                AddObligation(store, employeeRow, eventId, eventType, rule, AddDays(eventDateIso, rule.OffsetDays), periodicity);
            }

            store.Save();
        }

        private static void AddObligation(
            Store store,
            Dictionary<string, object> employeeRow,
            string eventId,
            string eventType,
            ObligationRule rule,
            string dueDate,
            int? periodicityMonths)
        {
            string rowId = J.Str(J.Get(employeeRow, "id"));
            string id = "obl_" + rowId + "_" + rule.Id + "_" + eventId;
            var obligations = store.Obligations;
            if (obligations.Any(item => J.Str(J.Get(J.Obj(item), "id")) == id)) return;

            var obligation = new Dictionary<string, object>
            {
                { "id", id },
                { "employeeRowId", rowId },
                { "eventId", eventId },
                { "eventType", eventType },
                { "moduleId", rule.ModuleId },
                { "requirementId", rule.Id },
                { "title", rule.Title },
                { "kind", rule.Kind },
                { "dueDate", dueDate },
                { "status", "pending" },
                { "legalBasis", rule.LegalBasis },
                { "createdAt", NowIso() }
            };
            if (!string.IsNullOrEmpty(rule.TemplateId)) obligation["templateId"] = rule.TemplateId;
            if (periodicityMonths.HasValue && periodicityMonths.Value > 0) obligation["periodicityMonths"] = periodicityMonths.Value;

            obligations.Add(obligation);
            J.Put(store.Entity, "employeeObligations", obligations.ToArray());
        }

        /// <summary>Закрывает требование; для периодического сразу создаёт следующую задачу.</summary>
        public static void Complete(Store store, Dictionary<string, object> obligation)
        {
            if (obligation == null) return;
            J.Put(obligation, "status", "done");
            J.Put(obligation, "completedAt", TodayIso());

            int periodicity = J.Int(J.Get(obligation, "periodicityMonths"), 0);
            if (periodicity > 0)
            {
                string dueDate = J.Str(J.Get(obligation, "dueDate"));
                string nextDue = AddMonths(dueDate, periodicity);
                var next = new Dictionary<string, object>(obligation);
                next["id"] = J.Str(J.Get(obligation, "id")) + "_next_" + nextDue;
                next["dueDate"] = nextDue;
                next["status"] = "pending";
                next.Remove("completedAt");
                next["createdAt"] = NowIso();

                var obligations = store.Obligations;
                if (!obligations.Any(item => J.Str(J.Get(J.Obj(item), "id")) == J.Str(J.Get(next, "id"))))
                {
                    obligations.Add(next);
                }
                J.Put(store.Entity, "employeeObligations", obligations.ToArray());
            }

            store.Save();
        }

        public static bool IsDone(Dictionary<string, object> obligation)
        {
            return J.Str(J.Get(obligation, "status")) == "done";
        }

        public static int DaysLeft(Dictionary<string, object> obligation)
        {
            string due = J.Str(J.Get(obligation, "dueDate"));
            if (string.IsNullOrWhiteSpace(due)) return int.MaxValue;
            return (ParseIso(due) - DateTime.Today).Days;
        }

        public static string DueLabel(Dictionary<string, object> obligation)
        {
            string due = J.Str(J.Get(obligation, "dueDate"));
            if (string.IsNullOrWhiteSpace(due)) return "—";
            return ParseIso(due).ToString("dd.MM.yyyy", CultureInfo.InvariantCulture);
        }

        public static string EmployeeName(Store store, string rowId)
        {
            var employees = store.FindTabByModule("employees");
            if (employees == null) return rowId;
            foreach (object item in J.Arr(J.Get(employees, "rows")))
            {
                var row = J.Obj(item);
                if (row != null && J.Str(J.Get(row, "id")) == rowId) return J.Str(J.Get(row, "emp_fio"));
            }
            return rowId;
        }

        public static string StatusLabel(Dictionary<string, object> obligation)
        {
            if (IsDone(obligation)) return "Выполнено";
            int days = DaysLeft(obligation);
            if (days < 0) return "Просрочено на " + (-days) + " дн.";
            if (days == 0) return "Сегодня";
            if (days <= 7) return "Через " + days + " дн.";
            return "В работе";
        }
    }
}
