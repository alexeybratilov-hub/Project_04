using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace OtBaza
{
    /// <summary>
    /// Готовые .docx-шаблоны: специалист приносит свой бланк из Word, ставит в нём
    /// теги ({ФИО}, {Должность} …), приложение подставляет значения прямо в XML
    /// документа. Word часто разрывает «{ФИО}» на несколько прогонов (<w:t>{ФИ</w:t>…),
    /// поэтому подстановка идёт по тексту абзаца, а не по отдельным прогонам.
    /// </summary>
    internal static class DocxTemplateService
    {
        private static readonly Regex ParagraphRegex = new Regex(@"<w:p\b[^>]*>.*?</w:p>", RegexOptions.Singleline);
        private static readonly Regex TextRunRegex = new Regex(@"<w:t(\s[^>]*)?>(.*?)</w:t>", RegexOptions.Singleline);
        private static readonly Regex TagRegex = new Regex(@"\{[^{}\r\n]{1,64}\}", RegexOptions.Singleline);

        /// <summary>Подстановка тегов во всех текстовых частях пакета (документ, колонтитулы).</summary>
        public static byte[] Render(string templatePath, Func<string, string> resolve)
        {
            if (!File.Exists(templatePath)) throw new FileNotFoundException("Шаблон не найден", templatePath);

            using (var source = new FileStream(templatePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var input = new ZipArchive(source, ZipArchiveMode.Read))
            using (var memory = new MemoryStream())
            {
                using (var output = new ZipArchive(memory, ZipArchiveMode.Create, true))
                {
                    foreach (ZipArchiveEntry entry in input.Entries)
                    {
                        string name = entry.FullName;
                        bool isTextPart = name == "word/document.xml"
                                          || Regex.IsMatch(name, @"^word/(header|footer)\d*\.xml$", RegexOptions.IgnoreCase)
                                          || name == "word/footnotes.xml"
                                          || name == "word/endnotes.xml";

                        if (!isTextPart)
                        {
                            // Картинки, шрифты, темы — копируем байтами: чтение как текста их испортит.
                            ZipArchiveEntry raw = output.CreateEntry(name, CompressionLevel.Optimal);
                            using (Stream from = entry.Open())
                            using (Stream to = raw.Open())
                            {
                                from.CopyTo(to);
                            }
                            continue;
                        }

                        string content;
                        using (Stream stream = entry.Open())
                        using (var reader = new StreamReader(stream, Encoding.UTF8, true))
                        {
                            content = reader.ReadToEnd();
                        }
                        content = ReplaceInXml(content, resolve);
                        ZipArchiveEntry text = output.CreateEntry(name, CompressionLevel.Optimal);
                        using (Stream stream = text.Open())
                        using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
                        {
                            writer.Write(content);
                        }
                    }
                }
                return memory.ToArray();
            }
        }

        /// <summary>Сколько тегов встретилось в шаблоне — для подсказки пользователю.</summary>
        public static List<string> ListTags(string templatePath)
        {
            var tags = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                using (var source = new FileStream(templatePath, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var input = new ZipArchive(source, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in input.Entries)
                    {
                        if (entry.FullName != "word/document.xml") continue;
                        string xml;
                        using (Stream stream = entry.Open())
                        using (var reader = new StreamReader(stream, Encoding.UTF8, true))
                        {
                            xml = reader.ReadToEnd();
                        }
                        // Собираем текст по абзацам: Word может разорвать {ФИО} на прогоны.
                        foreach (Match paragraph in ParagraphRegex.Matches(xml))
                        {
                            var text = new StringBuilder();
                            foreach (Match run in TextRunRegex.Matches(paragraph.Value))
                            {
                                text.Append(DecodeXml(run.Groups[2].Value));
                            }
                            foreach (Match tag in TagRegex.Matches(text.ToString()))
                            {
                                tags.Add(tag.Value.Trim('{', '}'));
                            }
                        }
                    }
                }
            }
            catch
            {
                // Нечитаемый шаблон — вернём то, что успели собрать.
            }
            return tags.ToList();
        }

        public static string ReplaceInXml(string xml, Func<string, string> resolve)
        {
            if (string.IsNullOrEmpty(xml)) return xml;
            return ParagraphRegex.Replace(xml, match => ReplaceInParagraph(match.Value, resolve));
        }

        private static string ReplaceInParagraph(string paragraphXml, Func<string, string> resolve)
        {
            MatchCollection runs = TextRunRegex.Matches(paragraphXml);
            if (runs.Count == 0) return paragraphXml;

            var texts = new List<string>(runs.Count);
            foreach (Match run in runs)
            {
                texts.Add(DecodeXml(run.Groups[2].Value));
            }

            string full = string.Concat(texts);
            MatchCollection tags = TagRegex.Matches(full);
            if (tags.Count == 0) return paragraphXml;

            // Карта: какой прогон «владеет» каждым символом абзаца.
            var owner = new List<int>(full.Length);
            for (int index = 0; index < texts.Count; index++)
            {
                for (int i = 0; i < texts[index].Length; i++) owner.Add(index);
            }

            var edits = new List<Edit>(tags.Count);
            foreach (Match tag in tags)
            {
                string name = tag.Value.Substring(1, tag.Value.Length - 2);
                string value = resolve == null ? null : resolve(name);
                if (value == null) continue; // неизвестный тег оставляем как есть
                edits.Add(new Edit { Start = tag.Index, End = tag.Index + tag.Length, Value = value });
            }
            if (edits.Count == 0) return paragraphXml;

            var finalText = new StringBuilder(full.Length);
            var finalOwner = new List<int>(full.Length);
            int cursor = 0;
            foreach (Edit edit in edits)
            {
                for (int i = cursor; i < edit.Start; i++)
                {
                    finalText.Append(full[i]);
                    finalOwner.Add(owner[i]);
                }
                int holder = edit.Start < owner.Count ? owner[edit.Start] : Math.Max(0, texts.Count - 1);
                foreach (char c in edit.Value)
                {
                    finalText.Append(c);
                    finalOwner.Add(holder);
                }
                cursor = edit.End;
            }
            for (int i = cursor; i < full.Length; i++)
            {
                finalText.Append(full[i]);
                finalOwner.Add(owner[i]);
            }

            var perRun = new StringBuilder[texts.Count];
            for (int i = 0; i < perRun.Length; i++) perRun[i] = new StringBuilder();
            for (int i = 0; i < finalText.Length; i++)
            {
                int runIndex = finalOwner[i];
                if (runIndex < 0 || runIndex >= perRun.Length) runIndex = perRun.Length - 1;
                perRun[runIndex].Append(finalText[i]);
            }

            // Пересобираем абзац, подменяя только внутренний текст тегов <w:t>.
            int runCursor = 0;
            return TextRunRegex.Replace(paragraphXml, match =>
            {
                string open = match.Value.Substring(0, match.Value.IndexOf('>') + 1);
                string content = perRun[runCursor].ToString();
                runCursor++;
                return open + EncodeXml(content) + "</w:t>";
            });
        }

        private static string DecodeXml(string value)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;
            return value
                .Replace("&lt;", "<")
                .Replace("&gt;", ">")
                .Replace("&quot;", "\"")
                .Replace("&apos;", "'")
                .Replace("&amp;", "&");
        }

        private static string EncodeXml(string value)
        {
            return (value ?? string.Empty)
                .Replace("&", "&amp;")
                .Replace("<", "&lt;")
                .Replace(">", "&gt;");
        }

        private sealed class Edit
        {
            public int Start;
            public int End;
            public string Value;
        }
    }
}
