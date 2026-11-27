using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;

namespace OtBaza
{
    /// <summary>
    /// Разбор TrueType-шрифта для встраивания в PDF: нужны только метрики и карта
    /// символов (glyf/loca не трогаем — шрифт встраивается целиком как FontFile2).
    /// Без этого PDF с кириллицей не сделать: стандартные 14 шрифтов PDF её не содержат.
    /// </summary>
    internal sealed class PdfFont
    {
        public string BaseName = "DejaVuSans";
        public int UnitsPerEm = 2048;
        public int NumGlyphs;
        public int Ascender;
        public int Descender;
        public int CapHeight = 700;
        public int XMin, YMin, XMax, YMax;

        private readonly int[] _advanceWidths = new int[65536];
        private byte[] _fontBytes;

        private int[] _segEnd = new int[0];
        private int[] _segStart = new int[0];
        private int[] _segDelta = new int[0];
        private int[] _segRangeOffset = new int[0];
        private int[] _idRangeOffsetAddress = new int[0];
        private int _hmtxOffset;
        private int _numberOfHMetrics;

        public byte[] FontBytes
        {
            get { return _fontBytes; }
        }

        /// <summary>Загружает шрифт из ресурсов сборки (встраивается при сборке).</summary>
        public static PdfFont LoadFromResource(string resourceName)
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream stream = assembly.GetManifestResourceStream(resourceName))
            {
                if (stream == null) throw new InvalidOperationException("Ресурс шрифта не найден: " + resourceName);
                using (var memory = new MemoryStream())
                {
                    stream.CopyTo(memory);
                    return Parse(memory.ToArray());
                }
            }
        }

        public static PdfFont Parse(byte[] font)
        {
            if (font == null || font.Length < 12) throw new InvalidDataException("Пустой файл шрифта.");
            var fontFile = new PdfFont();
            fontFile._fontBytes = font;

            int tables = ReadUInt16(font, 4);
            var tableDir = new Dictionary<string, int>(StringComparer.Ordinal);
            for (int i = 0; i < tables; i++)
            {
                int record = 12 + i * 16;
                if (record + 16 > font.Length) break;
                string tag = System.Text.Encoding.ASCII.GetString(font, record, 4);
                int offset = (int)ReadUInt32(font, record + 8);
                tableDir[tag] = offset;
            }

            int head;
            if (tableDir.TryGetValue("head", out head))
            {
                fontFile.UnitsPerEm = ReadUInt16(font, head + 18);
                fontFile.XMin = ReadInt16(font, head + 36);
                fontFile.YMin = ReadInt16(font, head + 38);
                fontFile.XMax = ReadInt16(font, head + 40);
                fontFile.YMax = ReadInt16(font, head + 42);
            }
            if (fontFile.UnitsPerEm <= 0) fontFile.UnitsPerEm = 2048;

            int hhea;
            if (tableDir.TryGetValue("hhea", out hhea))
            {
                fontFile.Ascender = ReadInt16(font, hhea + 4);
                fontFile.Descender = ReadInt16(font, hhea + 6);
                fontFile._numberOfHMetrics = ReadUInt16(font, hhea + 34);
            }

            int maxp;
            if (tableDir.TryGetValue("maxp", out maxp))
            {
                fontFile.NumGlyphs = ReadUInt16(font, maxp + 4);
            }

            int hmtxOffset;
            if (tableDir.TryGetValue("hmtx", out hmtxOffset) && fontFile._numberOfHMetrics > 0)
            {
                fontFile._hmtxOffset = hmtxOffset;
                for (int gid = 0; gid < fontFile._numberOfHMetrics && gid < 65536; gid++)
                {
                    fontFile._advanceWidths[gid] = ReadUInt16(font, hmtxOffset + gid * 4);
                }
                int last = fontFile._advanceWidths[Math.Max(0, fontFile._numberOfHMetrics - 1)];
                for (int gid = fontFile._numberOfHMetrics; gid < 65536; gid++) fontFile._advanceWidths[gid] = last;
            }

            int cmap;
            if (tableDir.TryGetValue("cmap", out cmap))
            {
                fontFile.ParseCmap(font, cmap);
            }

            int os2;
            if (tableDir.TryGetValue("OS/2", out os2) && os2 + 90 < font.Length)
            {
                int version = ReadUInt16(font, os2);
                if (version >= 2) fontFile.CapHeight = ReadInt16(font, os2 + 88);
                if (fontFile.CapHeight <= 0) fontFile.CapHeight = (int)(fontFile.UnitsPerEm * 0.7);
            }
            if (fontFile.Ascender == 0) fontFile.Ascender = (int)(fontFile.UnitsPerEm * 0.8);
            if (fontFile.Descender == 0) fontFile.Descender = -(int)(fontFile.UnitsPerEm * 0.2);

            return fontFile;
        }

        private void ParseCmap(byte[] font, int cmapOffset)
        {
            int count = ReadUInt16(font, cmapOffset + 2);
            int bestSubtable = -1;
            int bestScore = -1;
            for (int i = 0; i < count; i++)
            {
                int record = cmapOffset + 4 + i * 8;
                int platform = ReadUInt16(font, record);
                int encoding = ReadUInt16(font, record + 2);
                int subtable = cmapOffset + (int)ReadUInt32(font, record + 4);
                int format = ReadUInt16(font, subtable);
                if (format != 4) continue;
                // Предпочитаем Windows Unicode BMP (3,1), затем Unicode (0,x).
                int score = platform == 3 && encoding == 1 ? 3 : platform == 0 ? 2 : 1;
                if (score > bestScore)
                {
                    bestScore = score;
                    bestSubtable = subtable;
                }
            }
            if (bestSubtable < 0) return;

            int segCountX2 = ReadUInt16(font, bestSubtable + 6);
            int segCount = segCountX2 / 2;
            int endCodes = bestSubtable + 14;
            int startCodes = endCodes + segCountX2 + 2;
            int idDeltas = startCodes + segCountX2;
            int idRangeOffsets = idDeltas + segCountX2;

            _segEnd = new int[segCount];
            _segStart = new int[segCount];
            _segDelta = new int[segCount];
            _segRangeOffset = new int[segCount];
            _idRangeOffsetAddress = new int[segCount];
            for (int i = 0; i < segCount; i++)
            {
                _segEnd[i] = ReadUInt16(font, endCodes + i * 2);
                _segStart[i] = ReadUInt16(font, startCodes + i * 2);
                _segDelta[i] = ReadInt16(font, idDeltas + i * 2);
                _segRangeOffset[i] = ReadUInt16(font, idRangeOffsets + i * 2);
                _idRangeOffsetAddress[i] = idRangeOffsets + i * 2;
            }
        }

        /// <summary>Код символа → номер глифа (0, если символа в шрифте нет).</summary>
        public int GlyphId(char code)
        {
            int c = code;
            for (int i = 0; i < _segEnd.Length; i++)
            {
                if (_segEnd[i] < c) continue;
                if (_segStart[i] > c) return 0;
                if (_segRangeOffset[i] == 0)
                {
                    return (c + _segDelta[i]) & 0xFFFF;
                }
                int address = _idRangeOffsetAddress[i] + _segRangeOffset[i] + (c - _segStart[i]) * 2;
                if (address + 1 >= _fontBytes.Length) return 0;
                int glyph = ReadUInt16(_fontBytes, address);
                if (glyph == 0) return 0;
                return (glyph + _segDelta[i]) & 0xFFFF;
            }
            return 0;
        }

        /// <summary>Ширина глифа в тысячных долях em (как требует PDF).</summary>
        public int Width(int glyphId)
        {
            if (glyphId < 0 || glyphId >= _advanceWidths.Length) return 500;
            int units = _advanceWidths[glyphId];
            if (units <= 0) return 500;
            return (int)Math.Round(units * 1000.0 / UnitsPerEm);
        }

        public float TextWidth(string text, float size)
        {
            float width = 0;
            foreach (char c in text ?? string.Empty)
            {
                width += Width(GlyphId(c)) * size / 1000f;
            }
            return width;
        }

        private static ushort ReadUInt16(byte[] data, int offset)
        {
            return (ushort)((data[offset] << 8) | data[offset + 1]);
        }

        private static short ReadInt16(byte[] data, int offset)
        {
            return (short)ReadUInt16(data, offset);
        }

        private static uint ReadUInt32(byte[] data, int offset)
        {
            return ((uint)data[offset] << 24) | ((uint)data[offset + 1] << 16) | ((uint)data[offset + 2] << 8) | data[offset + 3];
        }
    }
}
