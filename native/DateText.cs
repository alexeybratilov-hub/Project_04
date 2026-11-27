using System;
using System.Globalization;
using System.Text.RegularExpressions;

namespace OtBaza
{
    /// <summary>
    /// Даты в базе хранятся строкой ISO (yyyy-MM-dd): на этом формате держатся
    /// контроль сроков, сортировка и обмен с веб-версией. Excel же отдаёт и
    /// принимает даты в русском виде (дд.мм.гггг), поэтому при импорте такие
    /// значения приводятся к ISO — иначе сроки по импортированным работникам
    /// просто не считались бы.
    /// </summary>
    internal static class DateText
    {
        private static readonly Regex Dotted = new Regex(@"^(\d{1,2})[./](\d{1,2})[./](\d{4})$", RegexOptions.CultureInvariant);
        private static readonly Regex Iso = new Regex(@"^(\d{4})-(\d{2})-(\d{2})$", RegexOptions.CultureInvariant);

        /// <summary>Похоже ли поле на дату (по типу колонки или по названию).</summary>
        public static bool IsDateColumn(string id, string name, string type)
        {
            if (string.Equals((type ?? string.Empty).Trim(), "date", StringComparison.OrdinalIgnoreCase)) return true;
            string probe = ((id ?? string.Empty) + " " + (name ?? string.Empty)).ToLowerInvariant();
            return Regex.IsMatch(
                probe,
                "дата|date|срок|начал|оконч|выдач|провед|при[её]м|увольн|перевод|рожд",
                RegexOptions.CultureInvariant);
        }

        /// <summary>дд.мм.гггг / дд/мм/гггг → yyyy-MM-dd. ISO и всё остальное возвращаются как есть.</summary>
        public static string Normalize(string value)
        {
            string text = (value ?? string.Empty).Trim();
            if (text.Length == 0) return text;

            Match iso = Iso.Match(text);
            if (iso.Success) return text;

            Match dotted = Dotted.Match(text);
            if (!dotted.Success) return text;

            int day = int.Parse(dotted.Groups[1].Value, CultureInfo.InvariantCulture);
            int month = int.Parse(dotted.Groups[2].Value, CultureInfo.InvariantCulture);
            int year = int.Parse(dotted.Groups[3].Value, CultureInfo.InvariantCulture);
            if (year < 1900 || year > 2999) return text;
            if (month < 1 || month > 12) return text;
            if (day < 1 || day > DateTime.DaysInMonth(year, month)) return text;

            return year.ToString("0000", CultureInfo.InvariantCulture) + "-" +
                   month.ToString("00", CultureInfo.InvariantCulture) + "-" +
                   day.ToString("00", CultureInfo.InvariantCulture);
        }

        /// <summary>Дата ISO из значения Excel (serial-число тоже принимается).</summary>
        public static bool TryParseIso(string value, out DateTime date)
        {
            date = DateTime.MinValue;
            string text = (value ?? string.Empty).Trim();
            if (text.Length == 0) return false;

            if (DateTime.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out date))
            {
                return true;
            }

            string normalized = Normalize(text);
            if (normalized != text &&
                DateTime.TryParseExact(normalized, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out date))
            {
                return true;
            }
            return false;
        }
    }
}
