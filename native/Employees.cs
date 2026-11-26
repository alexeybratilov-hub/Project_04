using System;
using System.Collections.Generic;
using System.Linq;

namespace OtBaza
{
    internal sealed class EmployeeInfo
    {
        public string Fio = string.Empty;
        public string Position = string.Empty;
        public string Department = string.Empty;
        public string HireDate = string.Empty;
        public string Snils = string.Empty;
        public string TabNumber = string.Empty;
        public string Status = string.Empty;
    }

    /// <summary>
    /// Чтение полей работника без привязки к конкретным id колонок: в разных
    /// базах встречаются emp_position/emp_pos, emp_dept/emp_department и т.п.
    /// Ищем по точному id, затем по названию колонки.
    /// </summary>
    internal static class Employees
    {
        public static EmployeeInfo Read(Store store, Dictionary<string, object> row)
        {
            var info = new EmployeeInfo();
            if (row == null) return info;

            var tab = store.FindTabByModule("employees") ?? store.FindTab("tab_employees");
            if (tab == null) return info;

            var columns = J.Arr(J.Get(tab, "columns")).Select(J.Obj).Where(c => c != null).ToList();

            Func<string[], string[], string> read = delegate(string[] exactIds, string[] nameParts)
            {
                foreach (string id in exactIds)
                {
                    if (row.ContainsKey(id) && J.Str(J.Get(row, id)).Trim().Length > 0)
                    {
                        return J.Str(J.Get(row, id)).Trim();
                    }
                }
                foreach (var column in columns)
                {
                    string name = J.Str(J.Get(column, "name")).ToLowerInvariant();
                    foreach (string part in nameParts)
                    {
                        if (!name.Contains(part)) continue;
                        string id = J.Str(J.Get(column, "id"));
                        string value = J.Str(J.Get(row, id)).Trim();
                        if (value.Length > 0) return value;
                    }
                }
                return string.Empty;
            };

            info.Fio = read(new[] { "emp_fio", "emp_name", "fio" }, new[] { "фио", "работник", "сотрудник" });
            info.Position = read(new[] { "emp_pos", "emp_position", "position" }, new[] { "должност", "професси" });
            info.Department = read(new[] { "emp_dept", "emp_department", "department" }, new[] { "подраздел", "отдел", "цех" });
            info.HireDate = read(new[] { "emp_hire_date", "hire_date", "emp_date" }, new[] { "дата приём", "дата приема", "принят" });
            info.Snils = read(new[] { "emp_snils", "snils" }, new[] { "снилс" });
            info.TabNumber = read(new[] { "emp_tab_num", "tab_num" }, new[] { "табельн" });
            info.Status = read(new[] { "emp_status", "emp_briefing_status", "status" }, new[] { "статус" });
            return info;
        }
    }
}
