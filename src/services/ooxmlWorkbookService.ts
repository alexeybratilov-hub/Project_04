import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export interface ParsedWorkbookSheetMatrix {
  name: string;
  rows: unknown[][];
}

export interface SheetExportSpec {
  name: string;
  rows: Record<string, unknown>[];
}

const MAX_XML_BYTES = 32 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isSafeObjectKey(key: string): boolean {
  return !FORBIDDEN_KEYS.has(key);
}

function decodeXmlEntities(str: string): string {
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_m, entity: string) => {
    switch (entity) {
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'amp':
        return '&';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        if (entity.startsWith('#x') || entity.startsWith('#X')) {
          const code = parseInt(entity.slice(2), 16);
          return Number.isFinite(code) ? String.fromCodePoint(code) : '';
        }
        if (entity.startsWith('#')) {
          const code = parseInt(entity.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : '';
        }
        return '';
    }
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = Object.create(null);
  const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(attrString)) !== null) {
    const key = m[1];
    if (!isSafeObjectKey(key)) continue;
    attrs[key] = decodeXmlEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

/**
 * Converts column letters (e.g. "A", "Z", "AA") to 0-based index.
 */
export function columnLettersToIndex(letters: string): number {
  let idx = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    const code = upper.charCodeAt(i);
    if (code < 65 || code > 90) return -1;
    idx = idx * 26 + (code - 64);
  }
  return idx - 1;
}

/**
 * Converts 0-based column index to Excel column letters ("A", "B", ..., "AA").
 */
export function indexToColumnLetters(index: number): string {
  let n = index + 1;
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result || 'A';
}

function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
  if (!m) return null;
  const col = columnLettersToIndex(m[1]);
  const row = parseInt(m[2], 10) - 1;
  if (col < 0 || row < 0) return null;
  return { row, col };
}

/**
 * Converts an Excel serial date number (1900 date system) to ISO YYYY-MM-DD.
 */
export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2958465) return null;
  // Excel treats 1900 as leap year (serial 60 = 1900-02-29), so adjust serial > 59
  const adjustedDays = serial >= 60 ? Math.floor(serial) - 1 : Math.floor(serial);
  const utcMs = Date.UTC(1899, 11, 31) + adjustedDays * 86_400_000;
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function dateToExcelSerial(date: Date): number {
  const utcDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const epoch = Date.UTC(1899, 11, 31);
  const days = Math.round((utcDay - epoch) / 86_400_000);
  return days >= 60 ? days + 1 : days;
}

function isBuiltInExcelDateFmtId(numFmtId: number): boolean {
  return (
    (numFmtId >= 14 && numFmtId <= 22) ||
    (numFmtId >= 27 && numFmtId <= 36) ||
    (numFmtId >= 45 && numFmtId <= 47) ||
    (numFmtId >= 50 && numFmtId <= 58)
  );
}

function isDateFormatCode(formatCode: string): boolean {
  const stripped = formatCode.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').toLowerCase();
  return /[dy]/.test(stripped) && !/general/.test(stripped);
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRegex = /<(?:[a-z0-9_]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_]+:)?si>/gi;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRegex.exec(xml)) !== null) {
    const inner = siMatch[1];
    const tRegex = /<(?:[a-z0-9_]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_]+:)?t>/gi;
    let combined = '';
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(inner)) !== null) {
      combined += decodeXmlEntities(tMatch[1]);
    }
    strings.push(combined);
  }
  return strings;
}

function parseDateStyleIndices(stylesXml: string): Set<number> {
  const dateStyleIndices = new Set<number>();
  const customDateFmtIds = new Set<number>();

  const numFmtRegex = /<(?:[a-z0-9_]+:)?numFmt\b([^>]*)\/?>/gi;
  let nfMatch: RegExpExecArray | null;
  while ((nfMatch = numFmtRegex.exec(stylesXml)) !== null) {
    const attrs = parseAttributes(nfMatch[1]);
    const id = Number(attrs.numFmtId);
    const code = attrs.formatCode || '';
    if (Number.isFinite(id) && isDateFormatCode(code)) {
      customDateFmtIds.add(id);
    }
  }

  const cellXfsMatch = /<(?:[a-z0-9_]+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_]+:)?cellXfs>/i.exec(
    stylesXml
  );
  if (cellXfsMatch) {
    const xfRegex = /<(?:[a-z0-9_]+:)?xf\b([^>]*)(?:\/>|>[\s\S]*?<\/(?:[a-z0-9_]+:)?xf>)/gi;
    let xfMatch: RegExpExecArray | null;
    let styleIndex = 0;
    while ((xfMatch = xfRegex.exec(cellXfsMatch[1])) !== null) {
      const attrs = parseAttributes(xfMatch[1]);
      const numFmtId = Number(attrs.numFmtId);
      if (
        Number.isFinite(numFmtId) &&
        (isBuiltInExcelDateFmtId(numFmtId) || customDateFmtIds.has(numFmtId))
      ) {
        dateStyleIndices.add(styleIndex);
      }
      styleIndex += 1;
    }
  }
  return dateStyleIndices;
}

function extractTagText(xmlFragment: string, tagLocalName: string): string {
  const re = new RegExp(
    `<(?:[a-z0-9_]+:)?${tagLocalName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_]+:)?${tagLocalName}>`,
    'i'
  );
  const m = re.exec(xmlFragment);
  return m ? decodeXmlEntities(m[1]) : '';
}

function parseWorksheetRows(
  sheetXml: string,
  sharedStrings: string[],
  dateStyleIndices: Set<number>
): unknown[][] {
  const rowsMap = new Map<number, unknown[]>();
  let maxRowIdx = -1;

  const rowRegex = /<(?:[a-z0-9_]+:)?row\b([^>]*)>([\s\S]*?)<\/(?:[a-z0-9_]+:)?row>/gi;
  let rowMatch: RegExpExecArray | null;
  let sequentialRowIdx = 0;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowAttrs = parseAttributes(rowMatch[1]);
    const explicitRowIdx = rowAttrs.r ? parseInt(rowAttrs.r, 10) - 1 : sequentialRowIdx;
    const rowIdx = Number.isFinite(explicitRowIdx) && explicitRowIdx >= 0 ? explicitRowIdx : sequentialRowIdx;
    sequentialRowIdx = rowIdx + 1;

    const rowBody = rowMatch[2];
    let sequentialColIdx = 0;

    const cellRegex = /<(?:[a-z0-9_]+:)?c\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:[a-z0-9_]+:)?c>)/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowBody)) !== null) {
      const cellAttrs = parseAttributes(cellMatch[1]);
      const cellBody = cellMatch[2] || '';
      const parsedRef = cellAttrs.r ? parseCellRef(cellAttrs.r) : null;
      const colIdx = parsedRef ? parsedRef.col : sequentialColIdx;
      const targetRowIdx = parsedRef ? parsedRef.row : rowIdx;
      sequentialColIdx = colIdx + 1;

      const cellType = cellAttrs.t || '';
      let value: unknown = '';

      if (cellType === 'inlineStr') {
        const tRegex = /<(?:[a-z0-9_]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_]+:)?t>/gi;
        let combined = '';
        let tm: RegExpExecArray | null;
        while ((tm = tRegex.exec(cellBody)) !== null) {
          combined += decodeXmlEntities(tm[1]);
        }
        value = combined;
      } else if (cellType === 's') {
        const rawIdx = extractTagText(cellBody, 'v').trim();
        const ssIdx = parseInt(rawIdx, 10);
        value = Number.isFinite(ssIdx) && ssIdx >= 0 && ssIdx < sharedStrings.length
          ? sharedStrings[ssIdx]
          : '';
      } else if (cellType === 'b') {
        const rawBool = extractTagText(cellBody, 'v').trim();
        value = rawBool === '1' || rawBool.toLowerCase() === 'true';
      } else if (cellType === 'str' || cellType === 'e') {
        value = extractTagText(cellBody, 'v');
      } else if (cellType === 'd') {
        const rawDate = extractTagText(cellBody, 'v').trim();
        value = rawDate.slice(0, 10);
      } else {
        const rawNum = extractTagText(cellBody, 'v').trim();
        if (rawNum !== '') {
          const num = Number(rawNum);
          const styleIdx = cellAttrs.s ? parseInt(cellAttrs.s, 10) : -1;
          if (Number.isFinite(num) && dateStyleIndices.has(styleIdx)) {
            value = excelSerialToIsoDate(num) ?? rawNum;
          } else {
            value = Number.isFinite(num) ? num : rawNum;
          }
        }
      }

      const targetArr = rowsMap.get(targetRowIdx) || [];
      while (targetArr.length <= colIdx) {
        targetArr.push('');
      }
      targetArr[colIdx] = value;
      rowsMap.set(targetRowIdx, targetArr);
      if (targetRowIdx > maxRowIdx) maxRowIdx = targetRowIdx;
    }
  }

  const matrix: unknown[][] = [];
  for (let r = 0; r <= maxRowIdx; r++) {
    matrix.push(rowsMap.get(r) || []);
  }
  return matrix;
}

function resolveSheetTargets(files: Record<string, Uint8Array>): Array<{ name: string; path: string }> {
  const fileKeyMap = new Map<string, string>();
  Object.keys(files).forEach((k) => fileKeyMap.set(k.replace(/^\/+/, '').toLowerCase(), k));

  const readText = (path: string): string | null => {
    const exactKey = fileKeyMap.get(path.replace(/^\/+/, '').toLowerCase());
    if (!exactKey) return null;
    const bytes = files[exactKey];
    if (bytes.byteLength > MAX_XML_BYTES) {
      throw new Error(`Файл внутри архива слишком велик (${path}).`);
    }
    return strFromU8(bytes);
  };

  const workbookXml = readText('xl/workbook.xml');
  const relsXml = readText('xl/_rels/workbook.xml.rels');

  const relTargets = new Map<string, string>();
  if (relsXml) {
    const relRegex = /<(?:[a-z0-9_]+:)?Relationship\b([^>]*)\/?>/gi;
    let m: RegExpExecArray | null;
    while ((m = relRegex.exec(relsXml)) !== null) {
      const attrs = parseAttributes(m[1]);
      if (attrs.Id && attrs.Target) {
        let target = attrs.Target.replace(/\\/g, '/').replace(/^\/+/, '');
        if (!target.startsWith('xl/')) {
          target = `xl/${target.replace(/^\.\//, '')}`;
        }
        relTargets.set(attrs.Id, target);
      }
    }
  }

  const sheets: Array<{ name: string; path: string }> = [];
  if (workbookXml) {
    const sheetRegex = /<(?:[a-z0-9_]+:)?sheet\b([^>]*)\/?>/gi;
    let m: RegExpExecArray | null;
    let idx = 1;
    while ((m = sheetRegex.exec(workbookXml)) !== null) {
      const attrs = parseAttributes(m[1]);
      const name = attrs.name || `Лист${idx}`;
      const rId = attrs['r:id'] || attrs.id || '';
      const mappedPath = (rId && relTargets.get(rId)) || `xl/worksheets/sheet${idx}.xml`;
      if (fileKeyMap.has(mappedPath.toLowerCase())) {
        sheets.push({ name, path: fileKeyMap.get(mappedPath.toLowerCase())! });
      }
      idx += 1;
    }
  }

  if (sheets.length === 0) {
    Object.keys(files)
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
      .sort()
      .forEach((path, i) => {
        sheets.push({ name: `Лист${i + 1}`, path });
      });
  }

  return sheets;
}

/**
 * Parses an OOXML `.xlsx` / `.xlsm` ArrayBuffer cleanly using `fflate`.
 */
export function parseXlsxWorkbook(arrayBuffer: ArrayBuffer): ParsedWorkbookSheetMatrix[] {
  const bytes = new Uint8Array(arrayBuffer);
  const files = unzipSync(bytes);
  const fileKeyMap = new Map<string, string>();
  Object.keys(files).forEach((k) => fileKeyMap.set(k.replace(/^\/+/, '').toLowerCase(), k));

  const readPart = (p: string): string => {
    const k = fileKeyMap.get(p.toLowerCase());
    if (!k) return '';
    if (files[k].byteLength > MAX_XML_BYTES) return '';
    return strFromU8(files[k]);
  };

  const sharedStringsXml = readPart('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];
  const stylesXml = readPart('xl/styles.xml');
  const dateStyles = stylesXml ? parseDateStyleIndices(stylesXml) : new Set<number>();

  const sheetSpecs = resolveSheetTargets(files);
  return sheetSpecs.map((spec) => {
    const sheetBytes = files[spec.path];
    if (!sheetBytes || sheetBytes.byteLength > MAX_XML_BYTES) {
      return { name: spec.name, rows: [] };
    }
    const xml = strFromU8(sheetBytes);
    return {
      name: spec.name,
      rows: parseWorksheetRows(xml, sharedStrings, dateStyles)
    };
  });
}

function detectCsvDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 5).filter((l) => l.trim().length > 0);
  const sample = firstLines[0] || '';
  const candidates = ['\t', ';', ','];
  let best = ';';
  let bestCount = -1;
  candidates.forEach((delim) => {
    const count = sample.split(delim).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = delim;
    }
  });
  return bestCount > 0 ? best : ',';
}

export function parseCsvToMatrix(rawText: string): string[][] {
  const cleanText = rawText.replace(/^\uFEFF/, '');
  if (!cleanText.trim()) return [];

  const delimiter = detectCsvDelimiter(cleanText);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleanText[i + 1] === '"') {
          currentCell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentCell);
      currentCell = '';
    } else if (ch === '\r') {
      if (cleanText[i + 1] === '\n') i += 1;
      currentRow.push(currentCell);
      if (currentRow.some((c) => c.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else if (ch === '\n') {
      currentRow.push(currentCell);
      if (currentRow.some((c) => c.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  currentRow.push(currentCell);
  if (currentRow.some((c) => c.trim().length > 0)) {
    rows.push(currentRow);
  }
  return rows;
}

/**
 * Generates a valid OOXML `.xlsx` workbook buffer from one or more sheet definitions.
 * Safe against prototype pollution and compatible with Excel, LibreOffice Calc, and 1C.
 */
export function buildXlsxArrayBuffer(
  sheets: Array<{ name: string; matrix?: unknown[][]; rows?: Record<string, unknown>[] }>
): ArrayBuffer {
  const safeSheets = (sheets.length > 0 ? sheets : [{ name: 'Лист1', matrix: [[]] }]).map(
    (s, idx) => {
      const cleanName =
        String(s.name || `Лист${idx + 1}`)
          .replace(/[\\/?*[\]:]/g, '_')
          .trim()
          .slice(0, 31) || `Лист${idx + 1}`;
      let matrix: unknown[][] = [];
      if (s.matrix) {
        matrix = s.matrix;
      } else if (s.rows && s.rows.length > 0) {
        const headers = Object.keys(s.rows[0]).filter(isSafeObjectKey);
        matrix = [
          headers,
          ...s.rows.map((r) => headers.map((h) => r[h] ?? ''))
        ];
      }
      return { name: cleanName, matrix };
    }
  );

  const sharedStrings: string[] = [];
  const sharedStringIndex = new Map<string, number>();

  const internString = (val: string): number => {
    const existing = sharedStringIndex.get(val);
    if (existing !== undefined) return existing;
    const idx = sharedStrings.length;
    sharedStrings.push(val);
    sharedStringIndex.set(val, idx);
    return idx;
  };

  const archive: Record<string, Uint8Array> = {};

  const sheetXmlParts = safeSheets.map((sheet) => {
    const maxCols = sheet.matrix.reduce((max, r) => Math.max(max, r.length), 1);
    const colWidths = Array.from({ length: maxCols }, (_, cIdx) => {
      let maxLen = 10;
      for (let r = 0; r < Math.min(sheet.matrix.length, 200); r++) {
        const v = sheet.matrix[r]?.[cIdx];
        const len = v instanceof Date ? 12 : String(v ?? '').length;
        if (len + 2 > maxLen) maxLen = Math.min(48, len + 2);
      }
      return `<col min="${cIdx + 1}" max="${cIdx + 1}" width="${maxLen}" customWidth="1"/>`;
    }).join('');

    const rowXmls = sheet.matrix.map((rowArr, rIdx) => {
      const cellsXml = rowArr
        .map((val, cIdx) => {
          if (val === undefined || val === null || val === '') return '';
          const ref = `${indexToColumnLetters(cIdx)}${rIdx + 1}`;
          if (val instanceof Date && !Number.isNaN(val.getTime())) {
            const serial = dateToExcelSerial(val);
            return `<c r="${ref}" s="1"><v>${serial}</v></c>`;
          }
          if (typeof val === 'boolean') {
            return `<c r="${ref}" t="b"><v>${val ? '1' : '0'}</v></c>`;
          }
          if (typeof val === 'number' && Number.isFinite(val)) {
            return `<c r="${ref}"><v>${val}</v></c>`;
          }
          const ssIdx = internString(String(val));
          return `<c r="${ref}" t="s"><v>${ssIdx}</v></c>`;
        })
        .filter(Boolean)
        .join('');
      return `<row r="${rIdx + 1}">${cellsXml}</row>`;
    });

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${colWidths}</cols>
  <sheetData>${rowXmls.join('')}</sheetData>
</worksheet>`;
  });

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
${sharedStrings.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('')}
</sst>`;

  // style 0: General, style 1: Date dd.mm.yyyy (numFmtId 14)
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${safeSheets
      .map(
        (s, idx) =>
          `<sheet name="${escapeXml(s.name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`
      )
      .join('\n    ')}
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${safeSheets
    .map(
      (_s, idx) =>
        `<Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`
    )
    .join('\n  ')}
  <Relationship Id="rId${safeSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId${safeSheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${safeSheets
    .map(
      (_s, idx) =>
        `<Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('\n  ')}
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  archive['[Content_Types].xml'] = strToU8(contentTypesXml);
  archive['_rels/.rels'] = strToU8(rootRelsXml);
  archive['xl/workbook.xml'] = strToU8(workbookXml);
  archive['xl/_rels/workbook.xml.rels'] = strToU8(workbookRelsXml);
  archive['xl/styles.xml'] = strToU8(stylesXml);
  archive['xl/sharedStrings.xml'] = strToU8(sharedStringsXml);
  sheetXmlParts.forEach((xml, idx) => {
    archive[`xl/worksheets/sheet${idx + 1}.xml`] = strToU8(xml);
  });

  const zipped = zipSync(archive, { level: 6 });
  const copy = new Uint8Array(zipped.byteLength);
  copy.set(zipped);
  return copy.buffer;
}
