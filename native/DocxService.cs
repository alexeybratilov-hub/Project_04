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
    /// Генерация DOCX без внешних библиотек: минимальный OOXML-пакет собирается
    /// через System.IO.Compression. Поддерживаются абзацы, простые таблицы
    /// ([ТАБЛИЦА]…[/ТАБЛИЦА]) и теги вида {ФИО}.
    /// </summary>
    internal static class DocxService
    {
        public static string GenerateForObligation(Store store, Dictionary<string, object> obligation)
        {
            if (obligation == null) return null;
            return Generate(
                store,
                J.Str(J.Get(obligation, "employeeRowId")),
                J.Str(J.Get(obligation, "templateId")),
                J.Str(J.Get(obligation, "dueDate")));
        }

        public static string Generate(Store store, string employeeRowId, string templateId, string eventDateIso)
        {
            TemplateDef template = ResolveTemplate(store, templateId);
            if (template == null) return null;

            var employee = FindEmployee(store, employeeRowId);
            var values = BuildTagValues(store, employee, eventDateIso);

            byte[] bytes;
            if (template.IsDocx)
            {
                string source = ResolveTemplateFile(store, template);
                if (!File.Exists(source)) throw new FileNotFoundException("Файл шаблона не найден: " + source);
                bytes = DocxTemplateService.Render(source, tag =>
                {
                    string value;
                    return values.TryGetValue(tag, out value) ? value : null; // null — тег не трогаем
                });
            }
            else
            {
                bytes = BuildDocx(ApplyTags(template.Content, values));
            }

            string category = string.IsNullOrWhiteSpace(template.Category) ? "Документы" : template.Category;
            string directory = Path.Combine(store.DataRoot, "documents", SafeName(category));
            Directory.CreateDirectory(directory);

            string employeeName = Employees.Read(store, employee).Fio;
            string baseName = SafeName(template.Name + (employeeName.Length > 0 ? " - " + employeeName : string.Empty));
            string fileName = baseName + ".docx";
            string fullPath = Path.Combine(directory, fileName);
            int index = 2;
            while (File.Exists(fullPath))
            {
                fileName = baseName + " (" + index + ").docx";
                fullPath = Path.Combine(directory, fileName);
                index++;
            }
            File.WriteAllBytes(fullPath, bytes);

            Register(store, template, employee, category, fileName, bytes.Length);
            store.Save();
            return fullPath;
        }

        /// <summary>Путь к файлу .docx-шаблона: относительный путь считается от папки данных.</summary>
        public static string ResolveTemplateFile(Store store, TemplateDef template)
        {
            if (template == null || string.IsNullOrWhiteSpace(template.FilePath)) return string.Empty;
            return Path.IsPathRooted(template.FilePath)
                ? template.FilePath
                : Path.Combine(store.DataRoot, template.FilePath.Replace('/', Path.DirectorySeparatorChar));
        }

        private static TemplateDef ResolveTemplate(Store store, string templateId)
        {
            if (string.IsNullOrWhiteSpace(templateId)) return null;

            TemplateDef native = store.Catalog.Template(templateId);
            if (native != null) return native;

            foreach (object item in J.Arr(J.Get(store.Entity, "templates")))
            {
                var raw = J.Obj(item);
                if (raw == null) continue;
                string id = J.Str(J.Get(raw, "id"));
                string builtInId = J.Str(J.Get(raw, "builtInId"));
                if (id != templateId && builtInId != templateId) continue;
                string kind = J.Str(J.Get(raw, "kind"));
                string file = J.Str(J.Get(raw, "templateFile"));
                bool isDocx = string.Equals(kind, "docx", StringComparison.OrdinalIgnoreCase);
                return new TemplateDef
                {
                    Id = id,
                    Name = J.Str(J.Get(raw, "name")),
                    Category = J.Str(J.Get(raw, "category")),
                    Content = J.Str(J.Get(raw, "contentTemplate")),
                    IsDocx = isDocx,
                    FilePath = file
                };
            }
            return null;
        }

        private static Dictionary<string, object> FindEmployee(Store store, string rowId)
        {
            var employees = store.FindTabByModule("employees");
            if (employees == null) return new Dictionary<string, object>();
            foreach (object item in J.Arr(J.Get(employees, "rows")))
            {
                var row = J.Obj(item);
                if (row != null && J.Str(J.Get(row, "id")) == rowId) return row;
            }
            return new Dictionary<string, object>();
        }

        /// <summary>Значения всех поддерживаемых тегов для конкретного работника и даты события.</summary>
        public static Dictionary<string, string> BuildTagValues(Store store, Dictionary<string, object> employee, string eventDateIso)
        {
            var profile = store.Profile;
            var info = Employees.Read(store, employee);
            string eventDate = string.IsNullOrWhiteSpace(eventDateIso) ? ObligationsEngine.TodayIso() : eventDateIso;
            string hireDate = info.HireDate;
            if (string.IsNullOrWhiteSpace(hireDate)) hireDate = eventDate;

            return new Dictionary<string, string>
            {
                { "Организация", J.Str(J.Get(profile, "fullName")) },
                { "Краткое", J.Str(J.Get(profile, "shortName")) },
                { "ИНН", J.Str(J.Get(profile, "inn")) },
                { "КПП", J.Str(J.Get(profile, "kpp")) },
                { "ОГРН", J.Str(J.Get(profile, "ogrn")) },
                { "Адрес", J.Str(J.Get(profile, "legalAddress")) },
                { "Директор", J.Str(J.Get(profile, "directorFio")) },
                { "Телефон", J.Str(J.Get(profile, "phone")) },
                { "Email", J.Str(J.Get(profile, "email")) },
                { "ФИО", info.Fio },
                { "Должность", info.Position },
                { "Подразделение", info.Department },
                { "Табельный", info.TabNumber },
                { "СНИЛС", info.Snils },
                { "Дата_приёма", FormatDate(hireDate) },
                { "Дата_события", FormatDate(eventDate) },
                { "Сегодня", DateTime.Today.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture) },
                { "Номер", DateTime.Now.ToString("ddMMyy-HHmm", CultureInfo.InvariantCulture) },

                // Синонимы из шаблонов веб-версии: те же данные под привычными именами,
                // чтобы шаблоны, сделанные для web, работали и в портативном клиенте.
                { "Организация_полное", J.Str(J.Get(profile, "fullName")) },
                { "Юридический_адрес", J.Str(J.Get(profile, "legalAddress")) },
                { "Генеральный_директор", J.Str(J.Get(profile, "directorFio")) },
                { "ОКВЭД", J.Str(J.Get(profile, "okved")) },
                { "ОКПО", J.Str(J.Get(profile, "okpo")) },
                { "Телефон_организации", J.Str(J.Get(profile, "phone")) },
                { "Email_организации", J.Str(J.Get(profile, "email")) },
                { "ФИО_работника", info.Fio },
                { "Табельный_номер", info.TabNumber },
                { "Дата_проведения", FormatDate(eventDate) },
                { "Номер_записи", DateTime.Now.ToString("ddMMyy-HHmm", CultureInfo.InvariantCulture) }
            };
        }

        /// <summary>Подстановка тегов в текстовый шаблон (встроенный или свой текстовый).</summary>
        public static string ApplyTags(string template, Dictionary<string, string> values)
        {
            string result = template ?? string.Empty;
            foreach (var pair in values)
            {
                result = result.Replace("{" + pair.Key + "}", pair.Value);
            }
            return result;
        }

        private static string FormatDate(string isoDate)
        {
            if (string.IsNullOrWhiteSpace(isoDate)) return string.Empty;
            return ObligationsEngine.ParseIso(isoDate).ToString("dd.MM.yyyy", CultureInfo.InvariantCulture);
        }

        private static string SafeName(string value)
        {
            string name = string.IsNullOrWhiteSpace(value) ? "Документ" : value.Trim();
            foreach (char c in Path.GetInvalidFileNameChars())
            {
                name = name.Replace(c, ' ');
            }
            name = name.Replace('/', ' ').Replace('\\', ' ').Trim();
            while (name.Contains("  ")) name = name.Replace("  ", " ");
            if (name.Length > 110) name = name.Substring(0, 110).Trim();
            return name.Length == 0 ? "Документ" : name;
        }

        private static void Register(Store store, TemplateDef template, Dictionary<string, object> employee, string category, string fileName, int size)
        {
            string employeeName = Employees.Read(store, employee).Fio;
            var docs = J.Arr(J.Get(store.Entity, "generatedDocs"));
            docs.Add(new Dictionary<string, object>
            {
                { "id", "doc_" + DateTime.Now.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture) },
                { "title", template.Name },
                { "fileName", fileName },
                { "category", category },
                { "format", "docx" },
                { "createdAt", ObligationsEngine.NowIso() },
                { "dateFormatted", DateTime.Today.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture) },
                { "relativePath", "documents/" + SafeName(category) + "/" + fileName },
                { "isArchived", false },
                { "sourceTabName", "Сотрудники" },
                { "sourceTabId", "tab_employees" },
                { "rowIdentifier", employeeName },
                { "sizeFormatted", Math.Max(1, size / 1024) + " КБ" }
            });
            J.Put(store.Entity, "generatedDocs", docs.ToArray());
        }

        // ---------- OOXML ----------

        public static byte[] BuildDocx(string text)
        {
            string body = BuildBody(text ?? string.Empty);
            using (var memory = new MemoryStream())
            {
                using (var archive = new ZipArchive(memory, ZipArchiveMode.Create, true))
                {
                    Write(archive, "[Content_Types].xml", ContentTypes);
                    Write(archive, "_rels/.rels", RootRelations);
                    Write(archive, "word/_rels/document.xml.rels", DocumentRelations);
                    Write(archive, "word/styles.xml", Styles);
                    Write(archive, "word/document.xml",
                        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                        "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>" +
                        body +
                        "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1134\" w:right=\"850\" w:bottom=\"1134\" w:left=\"1701\"/></w:sectPr>" +
                        "</w:body></w:document>");
                }
                return memory.ToArray();
            }
        }

        private static void Write(ZipArchive archive, string path, string content)
        {
            ZipArchiveEntry entry = archive.CreateEntry(path, CompressionLevel.Optimal);
            using (Stream stream = entry.Open())
            using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
            {
                writer.Write(content);
            }
        }

        private static string BuildBody(string text)
        {
            var builder = new StringBuilder();
            string[] lines = text.Replace("\r\n", "\n").Split('\n');
            int i = 0;
            while (i < lines.Length)
            {
                string line = lines[i];
                if (line.Trim() == "[ТАБЛИЦА]")
                {
                    var rows = new List<string[]>();
                    i++;
                    while (i < lines.Length && lines[i].Trim() != "[/ТАБЛИЦА]")
                    {
                        rows.Add(lines[i].Split('|').Select(cell => cell.Trim()).ToArray());
                        i++;
                    }
                    builder.Append(BuildTable(rows));
                    i++;
                    continue;
                }
                builder.Append(BuildParagraph(line));
                i++;
            }
            return builder.ToString();
        }

        private static string BuildParagraph(string line)
        {
            if (string.IsNullOrWhiteSpace(line)) line = string.Empty;
            bool bold = line.Length > 0 && line == line.ToUpperInvariant() && line.Length < 80 && line.Any(char.IsLetter);
            return "<w:p><w:pPr><w:spacing w:after=\"120\"/></w:pPr><w:r><w:rPr>" +
                   (bold ? "<w:b/>" : string.Empty) +
                   "<w:sz w:val=\"24\"/></w:rPr><w:t xml:space=\"preserve\">" + Escape(line) + "</w:t></w:r></w:p>";
        }

        private static string BuildTable(List<string[]> rows)
        {
            if (rows.Count == 0) return string.Empty;
            int columns = rows.Max(r => r.Length);
            var builder = new StringBuilder();
            builder.Append("<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/><w:tblBorders>" +
                           "<w:top w:val=\"single\" w:sz=\"4\"/><w:left w:val=\"single\" w:sz=\"4\"/>" +
                           "<w:bottom w:val=\"single\" w:sz=\"4\"/><w:right w:val=\"single\" w:sz=\"4\"/>" +
                           "<w:insideH w:val=\"single\" w:sz=\"4\"/><w:insideV w:val=\"single\" w:sz=\"4\"/>" +
                           "</w:tblBorders></w:tblPr>");
            for (int r = 0; r < rows.Count; r++)
            {
                builder.Append("<w:tr>");
                for (int c = 0; c < columns; c++)
                {
                    string cell = c < rows[r].Length ? rows[r][c] : string.Empty;
                    builder.Append("<w:tc><w:tcPr><w:tcW w:w=\"0\" w:type=\"auto\"/></w:tcPr>");
                    builder.Append("<w:p><w:r><w:rPr>");
                    if (r == 0) builder.Append("<w:b/>");
                    builder.Append("<w:sz w:val=\"22\"/></w:rPr><w:t xml:space=\"preserve\">");
                    builder.Append(Escape(cell));
                    builder.Append("</w:t></w:r></w:p></w:tc>");
                }
                builder.Append("</w:tr>");
            }
            builder.Append("</w:tbl><w:p/>");
            return builder.ToString();
        }

        private static string Escape(string value)
        {
            return (value ?? string.Empty)
                .Replace("&", "&amp;")
                .Replace("<", "&lt;")
                .Replace(">", "&gt;")
                .Replace("\"", "&quot;");
        }

        private const string ContentTypes =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
            "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
            "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
            "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
            "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>" +
            "</Types>";

        private const string RootRelations =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
            "</Relationships>";

        private const string DocumentRelations =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
            "</Relationships>";

        private const string Styles =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
            "<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Times New Roman\" w:hAnsi=\"Times New Roman\" w:cs=\"Times New Roman\"/>" +
            "<w:sz w:val=\"24\"/><w:szCs w:val=\"24\"/></w:rPr></w:rPrDefault>" +
            "<w:pPrDefault><w:pPr><w:spacing w:after=\"120\"/></w:pPr></w:pPrDefault></w:docDefaults>" +
            "</w:styles>";
    }
}
