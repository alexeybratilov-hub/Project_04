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
    /// PDF без сторонних библиотек: страницы A4, абзацы, таблицы, кириллица.
    /// Шрифт DejaVuSans встраивается как CIDFontType2 с кодировкой Identity-H и
    /// картой ToUnicode — иначе кириллица в PDF не отображается и не копируется.
    /// </summary>
    internal sealed class PdfWriter
    {
        private const float PageWidth = 595.28f;
        private const float PageHeight = 841.89f;
        private const float MarginLeft = 56f;
        private const float MarginRight = 56f;
        private const float MarginTop = 52f;
        private const float MarginBottom = 56f;

        private readonly PdfFont _font;
        private readonly List<StringBuilder> _pages = new List<StringBuilder>();
        private readonly HashSet<int> _usedGlyphs = new HashSet<int>();
        private StringBuilder _content;
        private float _y;

        public PdfWriter(PdfFont font)
        {
            _font = font;
            NewPage();
        }

        public static PdfWriter CreateDefault()
        {
            return new PdfWriter(PdfFont.LoadFromResource("DejaVuSans.ttf"));
        }

        private float ContentWidth
        {
            get { return PageWidth - MarginLeft - MarginRight; }
        }

        private void NewPage()
        {
            _content = new StringBuilder();
            _pages.Add(_content);
            _y = PageHeight - MarginTop;
        }

        private void EnsureSpace(float height)
        {
            if (_y - height >= MarginBottom) return;
            NewPage();
        }

        /// <summary>Добавляет документ: заголовок и текст с поддержкой [ТАБЛИЦА]…[/ТАБЛИЦА].</summary>
        public void AddDocument(string title, string text)
        {
            if (!string.IsNullOrWhiteSpace(title))
            {
                EnsureSpace(28);
                WriteLine(title.Trim(), 14f, true, false);
                _y -= 14f * 1.45f + 6f; // высота строки заголовка + отступ
            }

            string[] lines = (text ?? string.Empty).Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
            var tableRows = new List<string[]>();
            bool inTable = false;

            foreach (string raw in lines)
            {
                string line = raw.TrimEnd();
                string marker = line.Trim();

                if (marker.Equals("[ТАБЛИЦА]", StringComparison.OrdinalIgnoreCase))
                {
                    inTable = true;
                    tableRows = new List<string[]>();
                    continue;
                }
                if (marker.Equals("[/ТАБЛИЦА]", StringComparison.OrdinalIgnoreCase))
                {
                    if (inTable) DrawTable(tableRows);
                    inTable = false;
                    continue;
                }
                if (inTable)
                {
                    tableRows.Add(marker.Trim().Trim('|').Split('|').Select(cell => cell.Trim()).ToArray());
                    continue;
                }
                if (marker.Length == 0)
                {
                    _y -= 6;
                    continue;
                }

                bool heading = LooksLikeHeading(marker);
                WriteWrapped(marker, heading ? 11.5f : 10.5f, heading);
            }

            if (inTable && tableRows.Count > 0) DrawTable(tableRows);
        }

        private static bool LooksLikeHeading(string line)
        {
            if (line.Length < 3 || line.Length > 90) return false;
            bool hasLetter = false;
            foreach (char c in line)
            {
                if (!char.IsLetter(c)) continue;
                hasLetter = true;
                if (char.IsLower(c)) return false;
            }
            return hasLetter;
        }

        private void WriteWrapped(string text, float size, bool bold)
        {
            float lineHeight = size * 1.45f;
            var words = text.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (words.Length == 0) return;

            var line = new StringBuilder();
            foreach (string word in words)
            {
                string candidate = line.Length == 0 ? word : line + " " + word;
                if (_font.TextWidth(candidate, size) <= ContentWidth || line.Length == 0)
                {
                    if (_font.TextWidth(candidate, size) > ContentWidth)
                    {
                        // Слово шире строки — режем по символам.
                        if (line.Length > 0)
                        {
                            EnsureSpace(lineHeight);
                            WriteLine(line.ToString(), size, bold, false);
                            _y -= lineHeight;
                            line.Length = 0;
                        }
                        BreakLongWord(word, size, bold, lineHeight);
                        continue;
                    }
                    line.Length = 0;
                    line.Append(candidate);
                }
                else
                {
                    EnsureSpace(lineHeight);
                    WriteLine(line.ToString(), size, bold, false);
                    _y -= lineHeight;
                    line.Length = 0;
                    line.Append(word);
                }
            }

            if (line.Length > 0)
            {
                EnsureSpace(lineHeight);
                WriteLine(line.ToString(), size, bold, false);
                _y -= lineHeight;
            }
        }

        private void BreakLongWord(string word, float size, bool bold, float lineHeight)
        {
            var chunk = new StringBuilder();
            foreach (char c in word)
            {
                if (_font.TextWidth(chunk + c.ToString(), size) > ContentWidth && chunk.Length > 0)
                {
                    EnsureSpace(lineHeight);
                    WriteLine(chunk.ToString(), size, bold, false);
                    _y -= lineHeight;
                    chunk.Length = 0;
                }
                chunk.Append(c);
            }
            if (chunk.Length == 0) return;
            EnsureSpace(lineHeight);
            WriteLine(chunk.ToString(), size, bold, false);
            _y -= lineHeight;
        }

        private void WriteLine(string text, float size, bool bold, bool centered)
        {
            float x = MarginLeft;
            if (centered)
            {
                float width = _font.TextWidth(text, size);
                x = MarginLeft + Math.Max(0, (ContentWidth - width) / 2f);
            }
            _content.Append("BT\n");
            if (bold)
            {
                _content.Append("2 Tr 0.35 w\n");
            }
            _content.AppendFormat(CultureInfo.InvariantCulture, "/F1 {0:0.##} Tf\n", size);
            _content.AppendFormat(CultureInfo.InvariantCulture, "1 0 0 1 {0:0.##} {1:0.##} Tm\n", x, _y);
            _content.Append("<").Append(EncodeGlyphs(text)).Append("> Tj\n");
            if (bold) _content.Append("0 Tr\n");
            _content.Append("ET\n");
        }

        private void DrawTable(List<string[]> rows)
        {
            if (rows == null || rows.Count == 0) return;

            int columns = rows.Max(row => row.Length);
            if (columns == 0) return;

            var weights = new float[columns];
            foreach (string[] row in rows)
            {
                for (int c = 0; c < row.Length; c++)
                {
                    weights[c] = Math.Max(weights[c], Math.Max(6, row[c].Length));
                }
            }
            float total = weights.Sum();
            var widths = new float[columns];
            for (int c = 0; c < columns; c++) widths[c] = ContentWidth * weights[c] / total;

            const float rowHeight = 16f;
            foreach (string[] row in rows)
            {
                EnsureSpace(rowHeight + 4);

                float x = MarginLeft;
                _content.AppendFormat(CultureInfo.InvariantCulture, "0.7 w {0:0.##} {1:0.##} m {2:0.##} {1:0.##} l S\n",
                    MarginLeft, _y - 12f, MarginLeft + ContentWidth);

                for (int c = 0; c < columns; c++)
                {
                    string cell = c < row.Length ? row[c] : string.Empty;
                    cell = FitText(cell, widths[c] - 6f, 9f);
                    float textY = _y - 11f;
                    _content.Append("BT\n/F1 9 Tf\n");
                    _content.AppendFormat(CultureInfo.InvariantCulture, "1 0 0 1 {0:0.##} {1:0.##} Tm\n", x + 3f, textY);
                    _content.Append("<").Append(EncodeGlyphs(cell)).Append("> Tj\nET\n");
                    x += widths[c];
                }
                _y -= rowHeight;
            }

            _content.AppendFormat(CultureInfo.InvariantCulture, "0.7 w {0:0.##} {1:0.##} m {2:0.##} {1:0.##} l S\n",
                MarginLeft, _y, MarginLeft + ContentWidth);
            _y -= 10;
        }

        private string FitText(string text, float width, float size)
        {
            string value = text ?? string.Empty;
            if (_font.TextWidth(value, size) <= width) return value;
            string ellipsis = "…";
            var builder = new StringBuilder();
            foreach (char c in value)
            {
                if (_font.TextWidth(builder + c.ToString() + ellipsis, size) > width) break;
                builder.Append(c);
            }
            return builder.Length == 0 ? string.Empty : builder + ellipsis;
        }

        private string EncodeGlyphs(string text)
        {
            var builder = new StringBuilder((text ?? string.Empty).Length * 4);
            foreach (char c in text ?? string.Empty)
            {
                int glyph = _font.GlyphId(c);
                if (glyph == 0 && c != ' ')
                {
                    glyph = _font.GlyphId('?');
                }
                _usedGlyphs.Add(glyph);
                builder.Append(glyph.ToString("X4"));
            }
            return builder.ToString();
        }

        /// <summary>Собирает готовый PDF-файл.</summary>
        public byte[] Build()
        {
            var objects = new List<byte[]>();

            var chunks = new List<string>();
            int pageCount = _pages.Count;
            int firstPageObject = 8;
            var kids = new StringBuilder();
            for (int i = 0; i < pageCount; i++)
            {
                if (i > 0) kids.Append(" ");
                kids.Append(firstPageObject + i * 2).Append(" 0 R");
            }

            // 1 — каталог, 2 — дерево страниц, 3 — Type0, 4 — CIDFont, 5 — дескриптор,
            // 6 — файл шрифта, 7 — ToUnicode.
            objects.Add(Ascii("<< /Type /Catalog /Pages 2 0 R >>"));
            objects.Add(Ascii("<< /Type /Pages /Kids [" + kids + "] /Count " + pageCount + " >>"));
            objects.Add(Ascii(
                "<< /Type /Font /Subtype /Type0 /BaseFont /" + _font.BaseName +
                " /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 7 0 R >>"));
            objects.Add(Ascii(
                "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /" + _font.BaseName +
                " /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>" +
                " /FontDescriptor 5 0 R /CIDToGIDMap /Identity /W [" + BuildWidths() + "] /DW 600 >>"));
            objects.Add(Ascii(
                "<< /Type /FontDescriptor /FontName /" + _font.BaseName +
                " /Flags 32 /FontBBox [" + _font.XMin + " " + _font.YMin + " " + _font.XMax + " " + _font.YMax + "]" +
                " /ItalicAngle 0 /Ascent " + _font.Ascender + " /Descent " + _font.Descender +
                " /CapHeight " + _font.CapHeight + " /StemV 80 /FontFile2 6 0 R >>"));
            objects.Add(StreamObject(_font.FontBytes, true, "/Length1 " + _font.FontBytes.Length));
            objects.Add(StreamObject(Ascii(ToUnicodeCMap()), true, null));

            for (int i = 0; i < pageCount; i++)
            {
                int pageObject = firstPageObject + i * 2;
                int contentObject = pageObject + 1;
                objects.Add(Ascii(
                    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + F(PageWidth) + " " + F(PageHeight) + "]" +
                    " /Resources << /Font << /F1 3 0 R >> /ProcSet [/PDF /Text] >> /Contents " + contentObject + " 0 R >>"));
                objects.Add(StreamObject(Utf8(_pages[i].ToString()), true, null));
            }

            using (var output = new MemoryStream())
            {
                WriteAscii(output, "%PDF-1.4\n");
                output.Write(new byte[] { 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A }, 0, 6);

                var offsets = new List<long>();
                for (int i = 0; i < objects.Count; i++)
                {
                    offsets.Add(output.Position);
                    WriteAscii(output, (i + 1).ToString(CultureInfo.InvariantCulture) + " 0 obj\n");
                    output.Write(objects[i], 0, objects[i].Length);
                    WriteAscii(output, "\nendobj\n");
                }

                long xrefOffset = output.Position;
                WriteAscii(output, "xref\n0 " + (objects.Count + 1) + "\n");
                WriteAscii(output, "0000000000 65535 f \n");
                foreach (long offset in offsets)
                {
                    WriteAscii(output, offset.ToString("0000000000", CultureInfo.InvariantCulture) + " 00000 n \n");
                }
                WriteAscii(output, "trailer\n<< /Size " + (objects.Count + 1) + " /Root 1 0 R >>\n");
                WriteAscii(output, "startxref\n" + xrefOffset.ToString(CultureInfo.InvariantCulture) + "\n%%EOF\n");

                return output.ToArray();
            }
        }

        private string BuildWidths()
        {
            var parts = new List<string>();
            foreach (int glyph in _usedGlyphs.OrderBy(g => g))
            {
                parts.Add(glyph + " [" + _font.Width(glyph) + "]");
            }
            return string.Join(" ", parts.ToArray());
        }

        private string ToUnicodeCMap()
        {
            var sorted = _usedGlyphs.OrderBy(g => g).ToList();
            var reverse = new Dictionary<int, char>();
            for (int code = 32; code < 0xFFFF; code++)
            {
                char c = (char)code;
                int glyph = _font.GlyphId(c);
                if (glyph == 0 || reverse.ContainsKey(glyph)) continue;
                reverse[glyph] = c;
            }

            var builder = new StringBuilder();
            builder.AppendLine("/CIDInit /ProcSet findresource begin");
            builder.AppendLine("12 dict begin");
            builder.AppendLine("begincmap");
            builder.AppendLine("/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def");
            builder.AppendLine("/CMapName /Adobe-Identity-UCS def");
            builder.AppendLine("/CMapType 2 def");
            builder.AppendLine("1 begincodespacerange");
            builder.AppendLine("<0000> <FFFF>");
            builder.AppendLine("endcodespacerange");

            for (int start = 0; start < sorted.Count; start += 100)
            {
                var chunk = sorted.Skip(start).Take(100).ToList();
                builder.AppendLine(chunk.Count + " beginbfchar");
                foreach (int glyph in chunk)
                {
                    char c;
                    string unicode = reverse.TryGetValue(glyph, out c)
                        ? ((int)c).ToString("X4")
                        : ((int)' ').ToString("X4");
                    builder.AppendLine("<" + glyph.ToString("X4") + "> <" + unicode + ">");
                }
                builder.AppendLine("endbfchar");
            }

            builder.AppendLine("endcmap");
            builder.AppendLine("CMapName currentdict /CMap defineresource pop");
            builder.AppendLine("end");
            builder.AppendLine("end");
            return builder.ToString();
        }

        private static byte[] StreamObject(byte[] data, bool compress, string extraKeys)
        {
            byte[] payload = compress ? DeflateWithZlibHeader(data) : data;
            var header = new StringBuilder();
            header.Append("<< /Length ").Append(payload.Length);
            if (compress) header.Append(" /Filter /FlateDecode");
            if (!string.IsNullOrEmpty(extraKeys)) header.Append(" ").Append(extraKeys);
            header.Append(" >>\nstream\n");

            using (var output = new MemoryStream())
            {
                byte[] head = Utf8(header.ToString());
                output.Write(head, 0, head.Length);
                output.Write(payload, 0, payload.Length);
                byte[] tail = Utf8("\nendstream");
                output.Write(tail, 0, tail.Length);
                return output.ToArray();
            }
        }

        private static byte[] DeflateWithZlibHeader(byte[] data)
        {
            using (var output = new MemoryStream())
            {
                output.WriteByte(0x78);
                output.WriteByte(0x9C);
                using (var deflate = new DeflateStream(output, CompressionMode.Compress, true))
                {
                    deflate.Write(data, 0, data.Length);
                }
                uint a = 1;
                uint b = 0;
                foreach (byte value in data)
                {
                    a = (a + value) % 65521;
                    b = (b + a) % 65521;
                }
                uint adler = (b << 16) | a;
                output.WriteByte((byte)(adler >> 24));
                output.WriteByte((byte)(adler >> 16));
                output.WriteByte((byte)(adler >> 8));
                output.WriteByte((byte)adler);
                return output.ToArray();
            }
        }

        private static string F(float value)
        {
            return value.ToString("0.##", CultureInfo.InvariantCulture);
        }

        private static byte[] Ascii(string text)
        {
            return Encoding.ASCII.GetBytes(text);
        }

        private static byte[] Utf8(string text)
        {
            return new UTF8Encoding(false).GetBytes(text);
        }

        private static void WriteAscii(Stream stream, string text)
        {
            byte[] bytes = Ascii(text);
            stream.Write(bytes, 0, bytes.Length);
        }
    }

    /// <summary>Публичная точка: сохранить текст документа в PDF рядом с DOCX.</summary>
    internal static class PdfService
    {
        public static string Save(string outputPath, string title, string text)
        {
            PdfWriter writer = PdfWriter.CreateDefault();
            writer.AddDocument(title, text);
            byte[] bytes = writer.Build();
            string directory = Path.GetDirectoryName(outputPath);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            File.WriteAllBytes(outputPath, bytes);
            return outputPath;
        }
    }
}
