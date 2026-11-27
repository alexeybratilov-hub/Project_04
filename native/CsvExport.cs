using System;
using System.Globalization;

namespace OtBaza
{
    /// <summary>
    /// Экранирование ячеек CSV при экспорте таблиц.
    ///
    /// Две задачи:
    /// 1. Разделитель «;», кавычки и переводы строк не должны ломать строки файла.
    /// 2. Значение, начинающееся с «=», «+», «@» (а также с «-» в нечисловом
    ///    значении), Excel/LibreOffice воспринимают как формулу. Импортированные
    ///    извне данные (1С, чужие .xlsx) могут содержать такую строку намеренно,
    ///    поэтому она нейтрализуется ведущим апострофом — ячейка остаётся текстом.
    /// </summary>
    internal static class CsvExport
    {
        public static string Escape(string value)
        {
            if (value == null) return string.Empty;

            string text = value;
            if (NeedsFormulaGuard(text))
            {
                text = "'" + text;
            }

            if (text.IndexOfAny(new[] { ';', '"', '\n', '\r' }) < 0) return text;
            return "\"" + text.Replace("\"", "\"\"") + "\"";
        }

        private static bool NeedsFormulaGuard(string text)
        {
            if (text.Length == 0) return false;
            char first = text[0];
            if (first == '=' || first == '+' || first == '@' || first == '\t' || first == '\r') return true;
            // «-» защищаем только тогда, когда это не отрицательное число:
            // испортить «-12,5» апострофом хуже, чем пропустить формулу.
            if (first != '-') return false;
            return !IsPlainNumber(text);
        }

        private static bool IsPlainNumber(string text)
        {
            double parsed;
            return double.TryParse(
                text,
                NumberStyles.Float | NumberStyles.AllowThousands,
                CultureInfo.InvariantCulture,
                out parsed)
                || double.TryParse(text, NumberStyles.Float | NumberStyles.AllowThousands, CultureInfo.GetCultureInfo("ru-RU"), out parsed);
        }
    }
}
