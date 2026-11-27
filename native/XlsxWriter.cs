using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;

namespace OtBaza
{
    /// <summary>
    /// Выгрузка таблицы в XLSX без сторонних библиотек: минимальный OOXML-пакет
    /// (inline-строки, даты настоящими датами Excel, числовое распознавание с
    /// защитой от потери ведущих нулей) собирается через System.IO.Compression.
    ///
    /// Формат намеренно совместим с собственным XlsxReader: выгруженный файл
    /// можно сразу импортировать обратно на другом компьютере.
    /// </summary>
    internal static class XlsxWriter
    {
        public static void Write(string path, string sheetName, IList<string[]> rows, IList<int> columnWidths = null, IList<bool> dateColumns = null)
        {
            byte[] bytes = Build(sheetName, rows, columnWidths, dateColumns);
            File.WriteAllBytes(path, bytes);
        }

        public static byte[] Build(string sheetName, IList<string[]> rows, IList<int> columnWidths = null, IList<bool> dateColumns = null)
        {
            string safeSheet = SafeSheetName(sheetName);
            int columns = 0;
            foreach (string[] row in rows)
            {
                if (row != null && row.Length > columns) columns = row.Length;
            }

            var sheet = new StringBuilder();
            sheet.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
            sheet.Append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");
            sheet.Append("<dimension ref=\"A1:");
            sheet.Append(ColumnName(Math.Max(0, columns - 1)));
            sheet.Append(Math.Max(1, rows.Count));
            sheet.Append("\"/>");
            sheet.Append("<sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>");

            if (columnWidths != null && columnWidths.Count > 0)
            {
                sheet.Append("<cols>");
                for (int i = 0; i < columnWidths.Count; i++)
                {
                    double width = Math.Max(8, Math.Min(60, columnWidths[i] / 8.0));
                    sheet.Append("<col min=\"" + (i + 1) + "\" max=\"" + (i + 1) + "\" width=\"" +
                                 width.ToString("0.##", CultureInfo.InvariantCulture) + "\" customWidth=\"1\"/>");
                }
                sheet.Append("</cols>");
            }

            sheet.Append("<sheetData>");
            for (int r = 0; r < rows.Count; r++)
            {
                string[] row = rows[r] ?? new string[0];
                int rowNumber = r + 1;
                sheet.Append("<row r=\"" + rowNumber + "\"");
                if (r == 0) sheet.Append(" s=\"2\"");
                sheet.Append(">");
                for (int c = 0; c < row.Length; c++)
                {
                    bool dateColumn = dateColumns != null && c < dateColumns.Count && dateColumns[c];
                    AppendCell(sheet, r, c, rowNumber, row[c], dateColumn);
                }
                sheet.Append("</row>");
            }
            sheet.Append("</sheetData>");
            sheet.Append("</worksheet>");

            var files = new Dictionary<string, byte[]>();
            files["[Content_Types].xml"] = Utf8(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
                "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
                "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
                "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
                "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
                "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>" +
                "</Types>");

            files["_rels/.rels"] = Utf8(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
                "</Relationships>");

            files["xl/workbook.xml"] = Utf8(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
                "<sheets><sheet name=\"" + Escape(safeSheet) + "\" sheetId=\"1\" r:id=\"rId1\"/></sheets>" +
                "</workbook>");

            files["xl/_rels/workbook.xml.rels"] = Utf8(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>" +
                "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
                "</Relationships>");

            // cellXfs: 0 — обычная ячейка, 1 — дата (numFmtId 14), 2 — шапка (жирный),
            // 3 — текст (numFmtId 49): Excel не ругается «число сохранено как текст».
            files["xl/styles.xml"] = Utf8(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
                "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font>" +
                "<font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>" +
                "<fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills>" +
                "<borders count=\"1\"><border/></borders>" +
                "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>" +
                "<cellXfs count=\"4\">" +
                "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>" +
                "<xf numFmtId=\"14\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>" +
                "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>" +
                "<xf numFmtId=\"49\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>" +
                "</cellXfs>" +
                "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>" +
                "</styleSheet>");

            files["xl/worksheets/sheet1.xml"] = Utf8(sheet.ToString());

            using (var memory = new MemoryStream())
            {
                using (var archive = new ZipArchive(memory, ZipArchiveMode.Create, true))
                {
                    foreach (KeyValuePair<string, byte[]> file in files)
                    {
                        ZipArchiveEntry entry = archive.CreateEntry(file.Key, CompressionLevel.Optimal);
                        using (Stream stream = entry.Open())
                        {
                            stream.Write(file.Value, 0, file.Value.Length);
                        }
                    }
                }
                return memory.ToArray();
            }
        }

        private static void AppendCell(StringBuilder sheet, int rowIndex, int columnIndex, int rowNumber, string value, bool dateColumn)
        {
            string text = value ?? string.Empty;
            string reference = ColumnName(columnIndex) + rowNumber;

            if (rowIndex == 0)
            {
                sheet.Append("<c r=\"" + reference + "\" s=\"2\" t=\"inlineStr\"><is><t xml:space=\"preserve\">" +
                             Escape(text) + "</t></is></c>");
                return;
            }

            DateTime date;
            if (dateColumn && DateText.TryParseIso(text, out date))
            {
                double serial = (date.Date - new DateTime(1899, 12, 30)).TotalDays;
                sheet.Append("<c r=\"" + reference + "\" s=\"1\"><v>" +
                             serial.ToString("0", CultureInfo.InvariantCulture) + "</v></c>");
                return;
            }

            double number;
            if (IsSafeNumber(text, out number))
            {
                sheet.Append("<c r=\"" + reference + "\"><v>" +
                             number.ToString("R", CultureInfo.InvariantCulture) + "</v></c>");
                return;
            }

            if (text.Length == 0)
            {
                sheet.Append("<c r=\"" + reference + "\"/>");
                return;
            }

            sheet.Append("<c r=\"" + reference + "\" s=\"3\" t=\"inlineStr\"><is><t xml:space=\"preserve\">" +
                         Escape(text) + "</t></is></c>");
        }

        /// <summary>
        /// Числом записываем только безопасное: без ведущих нулей (иначе «007»
        /// превратится в 7), не длиннее 15 цифр (точность double), с точкой как
        /// разделителем. Русская запись «42,5» остаётся текстом — иначе выгрузка
        /// молча меняла бы значение.
        /// </summary>
        private static bool IsSafeNumber(string value, out double number)
        {
            number = 0;
            if (string.IsNullOrEmpty(value)) return false;
            if (value.Length > 24) return false;
            if (value.IndexOf(',') >= 0) return false;

            string normalized = value;
            if (normalized.IndexOf('.') != normalized.LastIndexOf('.')) return false;

            int start = normalized.Length > 0 && (normalized[0] == '-' || normalized[0] == '+') ? 1 : 0;
            if (start >= normalized.Length) return false;

            int digits = 0;
            bool dotSeen = false;
            for (int i = start; i < normalized.Length; i++)
            {
                char c = normalized[i];
                if (c == '.')
                {
                    if (dotSeen) return false;
                    dotSeen = true;
                    continue;
                }
                if (c < '0' || c > '9') return false;
                digits++;
            }
            if (digits == 0 || digits > 15) return false;

            string integerPart = normalized.IndexOf('.') < 0
                ? normalized.Substring(start)
                : normalized.Substring(start, normalized.IndexOf('.') - start);
            if (integerPart.Length > 1 && integerPart[0] == '0') return false;

            return double.TryParse(normalized, NumberStyles.Float, CultureInfo.InvariantCulture, out number);
        }

        private static string ColumnName(int index)
        {
            var name = new StringBuilder();
            int current = index;
            do
            {
                name.Insert(0, (char)('A' + current % 26));
                current = current / 26 - 1;
            }
            while (current >= 0);
            return name.ToString();
        }

        private static string SafeSheetName(string name)
        {
            string safe = string.IsNullOrWhiteSpace(name) ? "Лист1" : name.Trim();
            foreach (char bad in new[] { '[', ']', ':', '*', '?', '/', '\\' })
            {
                safe = safe.Replace(bad, '_');
            }
            if (safe.Length > 31) safe = safe.Substring(0, 31);
            safe = safe.Trim('\'', ' ');
            if (safe.Length == 0) safe = "Лист1";
            return safe;
        }

        private static string Escape(string value)
        {
            return (value ?? string.Empty)
                .Replace("&", "&amp;")
                .Replace("<", "&lt;")
                .Replace(">", "&gt;")
                .Replace("\"", "&quot;")
                .Replace("'", "&apos;");
        }

        private static byte[] Utf8(string text)
        {
            return new UTF8Encoding(false).GetBytes(text);
        }
    }
}
