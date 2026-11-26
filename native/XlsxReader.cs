using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Xml;

namespace OtBaza
{
    /// <summary>
    /// Чтение XLSX без сторонних библиотек: sharedStrings, sheet1, стили дат.
    /// Возвращает матрицу строк — дальше пользователь сопоставляет колонки.
    /// </summary>
    internal static class XlsxReader
    {
        public static List<string[]> Read(string path)
        {
            using (var stream = File.OpenRead(path))
            {
                return Read(stream);
            }
        }

        public static List<string[]> Read(Stream stream)
        {
            var rows = new List<string[]>();
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Read, true))
            {
                var shared = ReadSharedStrings(archive);
                var dateStyles = ReadDateStyles(archive);
                string sheetPath = FindFirstSheet(archive);
                if (sheetPath == null) throw new InvalidDataException("В файле нет листа Excel.");

                ZipArchiveEntry sheet = archive.GetEntry(sheetPath);
                if (sheet == null) throw new InvalidDataException("Лист Excel не найден.");

                var current = new Dictionary<int, string>();
                int rowIndex = 0;
                using (var reader = XmlReader.Create(sheet.Open()))
                {
                    while (reader.Read())
                    {
                        if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "row")
                        {
                            if (current.Count > 0)
                            {
                                rows.Add(ToRow(current));
                                current = new Dictionary<int, string>();
                            }
                            rowIndex++;
                        }
                        else if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "c")
                        {
                            string reference = reader.GetAttribute("r") ?? string.Empty;
                            string type = reader.GetAttribute("t") ?? string.Empty;
                            string style = reader.GetAttribute("s") ?? string.Empty;
                            int column = ColumnFromReference(reference);
                            string value = ReadCellValue(reader, type, style, shared, dateStyles);
                            if (column >= 0) current[column] = value;
                        }
                    }
                }
                if (current.Count > 0) rows.Add(ToRow(current));
            }

            return rows;
        }

        private static string[] ToRow(Dictionary<int, string> cells)
        {
            if (cells.Count == 0) return new string[0];
            int max = cells.Keys.Max();
            var row = new string[max + 1];
            for (int i = 0; i <= max; i++)
            {
                string value;
                row[i] = cells.TryGetValue(i, out value) ? value : string.Empty;
            }
            return row;
        }

        private static string ReadCellValue(
            XmlReader cellReader,
            string type,
            string style,
            List<string> shared,
            HashSet<int> dateStyles)
        {
            string text = string.Empty;
            using (var subtree = cellReader.ReadSubtree())
            {
                while (subtree.Read())
                {
                    if (subtree.NodeType == XmlNodeType.Element && subtree.LocalName == "t")
                    {
                        text += subtree.ReadElementContentAsString();
                    }
                    else if (subtree.NodeType == XmlNodeType.Element && subtree.LocalName == "v")
                    {
                        string raw = subtree.ReadElementContentAsString();
                        if (type == "s")
                        {
                            int index;
                            if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out index) &&
                                index >= 0 && index < shared.Count)
                            {
                                return shared[index];
                            }
                            return string.Empty;
                        }
                        return FormatNumber(raw, style, dateStyles);
                    }
                }
            }
            return text;
        }

        private static string FormatNumber(string raw, string style, HashSet<int> dateStyles)
        {
            double number;
            if (!double.TryParse(raw, NumberStyles.Any, CultureInfo.InvariantCulture, out number)) return raw;

            int styleIndex;
            if (int.TryParse(style, NumberStyles.Integer, CultureInfo.InvariantCulture, out styleIndex) &&
                dateStyles.Contains(styleIndex))
            {
                try
                {
                    DateTime date = DateTime.FromOADate(number);
                    return date.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture);
                }
                catch
                {
                    return raw;
                }
            }

            if (Math.Abs(number - Math.Round(number)) < 0.0000001)
            {
                return ((long)Math.Round(number)).ToString(CultureInfo.InvariantCulture);
            }
            return number.ToString("0.##########", CultureInfo.InvariantCulture);
        }

        private static List<string> ReadSharedStrings(ZipArchive archive)
        {
            var result = new List<string>();
            ZipArchiveEntry entry = archive.GetEntry("xl/sharedStrings.xml");
            if (entry == null) return result;

            using (var reader = XmlReader.Create(entry.Open()))
            {
                bool collecting = false;
                var builder = new StringBuilder();
                while (reader.Read())
                {
                    if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "si")
                    {
                        collecting = true;
                        builder.Clear();
                    }
                    else if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "t" && collecting)
                    {
                        builder.Append(reader.ReadElementContentAsString());
                    }
                    else if (reader.NodeType == XmlNodeType.EndElement && reader.LocalName == "si")
                    {
                        collecting = false;
                        result.Add(builder.ToString());
                    }
                }
            }
            return result;
        }

        /// <summary>Индексы стилей, которые Excel считает датами (встроенные и пользовательские форматы).</summary>
        private static HashSet<int> ReadDateStyles(ZipArchive archive)
        {
            var dateStyles = new HashSet<int>();
            ZipArchiveEntry stylesEntry = archive.GetEntry("xl/styles.xml");
            if (stylesEntry == null) return dateStyles;

            var customDateFormats = new HashSet<int>();
            var cellXfsFormats = new List<int>();
            bool insideCellXfs = false;
            using (var reader = XmlReader.Create(stylesEntry.Open()))
            {
                while (reader.Read())
                {
                    if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "cellXfs")
                    {
                        insideCellXfs = true;
                        continue;
                    }
                    if (reader.NodeType == XmlNodeType.EndElement && reader.LocalName == "cellXfs")
                    {
                        insideCellXfs = false;
                        continue;
                    }
                    if (reader.NodeType != XmlNodeType.Element) continue;
                    if (reader.LocalName == "numFmt")
                    {
                        int id;
                        string code = reader.GetAttribute("formatCode") ?? string.Empty;
                        if (int.TryParse(reader.GetAttribute("numFmtId") ?? string.Empty, out id) &&
                            LooksLikeDateFormat(code))
                        {
                            customDateFormats.Add(id);
                        }
                    }
                    else if (reader.LocalName == "xf" && insideCellXfs)
                    {
                        int id;
                        if (int.TryParse(reader.GetAttribute("numFmtId") ?? string.Empty, out id))
                        {
                            cellXfsFormats.Add(id);
                        }
                    }
                }
            }

            for (int i = 0; i < cellXfsFormats.Count; i++)
            {
                int formatId = cellXfsFormats[i];
                if (IsBuiltInDateFormat(formatId) || customDateFormats.Contains(formatId))
                {
                    dateStyles.Add(i);
                }
            }
            return dateStyles;
        }

        private static bool IsBuiltInDateFormat(int id)
        {
            return (id >= 14 && id <= 22) || (id >= 45 && id <= 47);
        }

        private static bool LooksLikeDateFormat(string code)
        {
            if (string.IsNullOrWhiteSpace(code)) return false;
            string cleaned = code.ToLowerInvariant();
            if (cleaned.Contains("yy") || cleaned.Contains("dd") || cleaned.Contains("дд")) return true;
            return cleaned.Contains("d.m") || cleaned.Contains("m/d");
        }

        private static string FindFirstSheet(ZipArchive archive)
        {
            ZipArchiveEntry direct = archive.GetEntry("xl/worksheets/sheet1.xml");
            if (direct != null) return "xl/worksheets/sheet1.xml";
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                if (entry.FullName.StartsWith("xl/worksheets/", StringComparison.OrdinalIgnoreCase) &&
                    entry.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase))
                {
                    return entry.FullName;
                }
            }
            return null;
        }

        private static int ColumnFromReference(string reference)
        {
            if (string.IsNullOrEmpty(reference)) return -1;
            int column = 0;
            foreach (char c in reference)
            {
                if (c >= 'A' && c <= 'Z') column = column * 26 + (c - 'A' + 1);
                else if (c >= 'a' && c <= 'z') column = column * 26 + (c - 'a' + 1);
                else break;
            }
            return column - 1;
        }
    }
}
