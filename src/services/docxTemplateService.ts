import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { LegalEntityProfile, Row, Tab, Tag } from '../types/database';

export interface DocxInspectResult {
  detectedTags: string[];
  previewText: string;
  partsScanned: string[];
  unsupportedWarnings: string[];
}

export interface DocxRenderDiagnostic {
  unknownTags: string[];
  emptyTags: string[];
  unsupportedWarnings: string[];
}

export interface DocxTagResolveOutcome {
  known: boolean;
  value: string;
  isEmptyRowValue?: boolean;
}

export interface TagCatalogItem {
  tag: string;
  label: string;
  description: string;
  exampleValue: string;
  sourceInfo: string;
}

export interface TagCatalogSection {
  id: 'current_tab' | 'user_tags' | 'entity_system';
  title: string;
  description: string;
  items: TagCatalogItem[];
}

const PLACEHOLDER_REGEX = /\{([^{}\r\n]+)\}/g;

const ENTITY_SYSTEM_TAG_META: Array<{
  tag: string;
  label: string;
  description: string;
  getExample: (profile?: LegalEntityProfile, row?: Row) => string;
}> = [
  {
    tag: '{Организация}',
    label: 'Краткое название организации',
    description: 'Сокращённое наименование активного юридического лица',
    getExample: (p) => p?.shortName || p?.fullName || 'ООО «Катания»'
  },
  {
    tag: '{Организация_полное}',
    label: 'Полное название организации',
    description: 'Полное наименование активного юридического лица',
    getExample: (p) => p?.fullName || p?.shortName || 'Общество с ограниченной ответственностью «Катания»'
  },
  {
    tag: '{ИНН}',
    label: 'ИНН организации',
    description: 'Идентификационный номер налогоплательщика',
    getExample: (p) => p?.inn || '7701234567'
  },
  {
    tag: '{КПП}',
    label: 'КПП организации',
    description: 'Код причины постановки на учёт',
    getExample: (p) => p?.kpp || '770101001'
  },
  {
    tag: '{ОГРН}',
    label: 'ОГРН организации',
    description: 'Основной государственный регистрационный номер',
    getExample: (p) => p?.ogrn || '1157746123456'
  },
  {
    tag: '{ОКПО}',
    label: 'ОКПО',
    description: 'Общероссийский классификатор предприятий и организаций',
    getExample: (p) => p?.okpo || '40123456'
  },
  {
    tag: '{ОКВЭД}',
    label: 'ОКВЭД',
    description: 'Основной код вида экономической деятельности',
    getExample: (p) => p?.okved || '46.90'
  },
  {
    tag: '{Реквизиты_банка}',
    label: 'Банковские реквизиты',
    description: 'Расчётный и корреспондентский счета, БИК',
    getExample: (p) => p?.bankDetails || 'р/с 40702810..., БИК ...'
  },
  {
    tag: '{Банк_в}',
    label: 'Наименование банка',
    description: 'Банк обслуживания организации',
    getExample: (p) => p?.bankIn || 'ПАО Сбербанк, г. Москва'
  },
  {
    tag: '{Юридический_адрес}',
    label: 'Юридический адрес',
    description: 'Официальный адрес регистрации юрлица',
    getExample: (p) => p?.legalAddress || 'г. Москва, ул. Земляной Вал, д. 9'
  },
  {
    tag: '{Email_организации}',
    label: 'E-mail организации',
    description: 'Официальная электронная почта',
    getExample: (p) => p?.email || 'info@company.ru'
  },
  {
    tag: '{Телефон_организации}',
    label: 'Телефон организации',
    description: 'Контактный номер телефона',
    getExample: (p) => p?.phone || '+7 (495) 123-45-67'
  },
  {
    tag: '{Генеральный_директор}',
    label: 'Руководитель (ФИО)',
    description: 'ФИО генерального директора / руководителя юрлица',
    getExample: (p) => p?.directorFio || 'Александров Игорь Владимирович'
  },
  {
    tag: '{id}',
    label: 'ID записи строки',
    description: 'Системный уникальный идентификатор текущей строки таблицы',
    getExample: (_p, row) => row?.id || 'emp_1'
  }
];

export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function stripInvalidXmlControlChars(text: string): string {
  // XML 1.0 forbids U+0000..U+0008, U+000B..U+000C, U+000E..U+001F
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0xd800 && code <= 0xdbff) ||
      (code >= 0xdc00 && code <= 0xdfff)
    ) {
      out += text[i];
    }
  }
  return out;
}

export function encodeXmlEntities(text: string): string {
  const safe = stripInvalidXmlControlChars(text);
  return safe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface TextSegment {
  openTagStart: number;
  openTagEnd: number;
  closeTagStart: number;
  closeTagEnd: number;
  openTagRaw: string;
  decodedText: string;
  startOffset: number;
  endOffset: number;
}

interface RangeInterval {
  start: number;
  end: number;
}

function findTagIntervals(xml: string, tagName: string): RangeInterval[] {
  const intervals: RangeInterval[] = [];
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}>`;
  let cursor = 0;

  while (cursor < xml.length) {
    const openIdx = xml.indexOf(openToken, cursor);
    if (openIdx === -1) break;

    const afterName = xml[openIdx + openToken.length];
    if (afterName !== '>' && afterName !== '/' && !/\s/.test(afterName || '')) {
      cursor = openIdx + openToken.length;
      continue;
    }

    const openEnd = xml.indexOf('>', openIdx);
    if (openEnd === -1) break;

    if (xml[openEnd - 1] === '/') {
      // Self-closing tag: skip it cleanly
      cursor = openEnd + 1;
      continue;
    }

    // Track nesting depth for nested tags with the same tagName
    let depth = 1;
    let scan = openEnd + 1;
    let blockEnd = -1;

    while (scan < xml.length && depth > 0) {
      const nextOpen = xml.indexOf(openToken, scan);
      const nextClose = xml.indexOf(closeToken, scan);

      if (nextClose === -1) {
        break;
      }

      if (nextOpen !== -1 && nextOpen < nextClose) {
        const ch = xml[nextOpen + openToken.length];
        if (ch === '>' || ch === '/' || /\s/.test(ch || '')) {
          const innerOpenEnd = xml.indexOf('>', nextOpen);
          if (innerOpenEnd === -1) break;
          if (xml[innerOpenEnd - 1] !== '/') {
            depth += 1;
          }
          scan = innerOpenEnd + 1;
        } else {
          scan = nextOpen + openToken.length;
        }
      } else {
        depth -= 1;
        if (depth === 0) {
          blockEnd = nextClose + closeToken.length;
        }
        scan = nextClose + closeToken.length;
      }
    }

    if (blockEnd !== -1) {
      intervals.push({ start: openIdx, end: blockEnd });
      cursor = blockEnd;
    } else {
      cursor = openEnd + 1;
    }
  }

  return intervals;
}

function isInsideAnyInterval(pos: number, intervals: RangeInterval[]): boolean {
  for (const iv of intervals) {
    if (pos >= iv.start && pos < iv.end) return true;
  }
  return false;
}

function collectDirectWtSegments(pXml: string): TextSegment[] {
  const skipped = [
    ...findTagIntervals(pXml, 'w:txbxContent'),
    ...findTagIntervals(pXml, 'w:del'),
    ...findTagIntervals(pXml, 'w:instrText')
  ];

  const segments: TextSegment[] = [];
  let cursor = 0;
  let logicalOffset = 0;

  while (cursor < pXml.length) {
    const wtStart = pXml.indexOf('<w:t', cursor);
    if (wtStart === -1) break;

    const afterName = pXml[wtStart + 4];
    if (afterName !== '>' && afterName !== '/' && !/\s/.test(afterName || '')) {
      cursor = wtStart + 4;
      continue;
    }

    if (isInsideAnyInterval(wtStart, skipped)) {
      cursor = wtStart + 4;
      continue;
    }

    const openEnd = pXml.indexOf('>', wtStart);
    if (openEnd === -1) break;

    if (pXml[openEnd - 1] === '/') {
      cursor = openEnd + 1;
      continue;
    }

    const closeStart = pXml.indexOf('</w:t>', openEnd + 1);
    if (closeStart === -1) break;

    const rawInner = pXml.slice(openEnd + 1, closeStart);
    const decodedText = decodeXmlEntities(rawInner);
    const startOffset = logicalOffset;
    const endOffset = startOffset + decodedText.length;

    segments.push({
      openTagStart: wtStart,
      openTagEnd: openEnd + 1,
      closeTagStart: closeStart,
      closeTagEnd: closeStart + 6,
      openTagRaw: pXml.slice(wtStart, openEnd + 1),
      decodedText,
      startOffset,
      endOffset
    });

    logicalOffset = endOffset;
    cursor = closeStart + 6;
  }

  return segments;
}

function formatWtInnerXml(decodedText: string): string {
  const normalized = decodedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.includes('\n')) {
    return encodeXmlEntities(normalized);
  }
  const lines = normalized.split('\n');
  return lines
    .map((line) => encodeXmlEntities(line))
    .join('</w:t><w:br/><w:t xml:space="preserve">');
}

function ensurePreserveSpaceAttr(openTagRaw: string, newDecodedText: string): string {
  if (!newDecodedText) return openTagRaw;
  const needsPreserve =
    /^\s|\s$/.test(newDecodedText) || /\s{2,}/.test(newDecodedText);
  if (!needsPreserve) return openTagRaw;
  if (/xml:space\s*=/.test(openTagRaw)) return openTagRaw;
  return openTagRaw.replace(/^<w:t/, '<w:t xml:space="preserve"');
}

interface PlaceholderMatch {
  rawTag: string;
  start: number;
  end: number;
  replacement: string;
}

function detectUnclosedBraceWarning(paragraphText: string): boolean {
  let depth = 0;
  for (let i = 0; i < paragraphText.length; i++) {
    if (paragraphText[i] === '{') depth += 1;
    else if (paragraphText[i] === '}') depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

function transformParagraphXml(
  pXml: string,
  resolveTag: (tagName: string) => DocxTagResolveOutcome,
  collected: {
    detectedTags: Set<string>;
    unknownTags: Set<string>;
    emptyTags: Set<string>;
    hasUnclosedBrace: boolean;
  }
): string {
  // Step 1: Recursively process any nested <w:txbxContent> blocks inside this paragraph first
  let workingXml = pXml;
  const txbxIntervals = findTagIntervals(workingXml, 'w:txbxContent');
  if (txbxIntervals.length > 0) {
    let rebuilt = '';
    let pos = 0;
    for (const iv of txbxIntervals) {
      rebuilt += workingXml.slice(pos, iv.start);
      const innerBlock = workingXml.slice(iv.start, iv.end);
      rebuilt += transformParagraphsInXml(innerBlock, resolveTag, collected);
      pos = iv.end;
    }
    rebuilt += workingXml.slice(pos);
    workingXml = rebuilt;
  }

  // Step 2: Collect direct <w:t> runs belonging strictly to this paragraph
  const segments = collectDirectWtSegments(workingXml);
  if (segments.length === 0) return workingXml;

  const fullText = segments.map((s) => s.decodedText).join('');
  if (detectUnclosedBraceWarning(fullText)) {
    collected.hasUnclosedBrace = true;
  }

  const replacements: PlaceholderMatch[] = [];
  PLACEHOLDER_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_REGEX.exec(fullText)) !== null) {
    const rawTag = m[0];
    const innerName = m[1].trim();
    if (!innerName) continue;

    collected.detectedTags.add(rawTag);
    const outcome = resolveTag(rawTag);
    if (!outcome.known) {
      collected.unknownTags.add(rawTag);
      // Leave unknown tags untouched in XML so we never corrupt or erase user content
      continue;
    }

    if (outcome.isEmptyRowValue) {
      collected.emptyTags.add(rawTag);
    }

    replacements.push({
      rawTag,
      start: m.index,
      end: m.index + rawTag.length,
      replacement: outcome.value
    });
  }

  if (replacements.length === 0) {
    return workingXml;
  }

  // Step 3: Map character replacements cleanly onto each <w:t> segment without changing run structure
  let outXml = '';
  let xmlPos = 0;

  for (const seg of segments) {
    outXml += workingXml.slice(xmlPos, seg.openTagStart);

    // Find replacements overlapping [seg.startOffset, seg.endOffset)
    const overlapping = replacements.filter(
      (rep) => rep.end > seg.startOffset && rep.start < seg.endOffset
    );

    if (overlapping.length === 0) {
      outXml += workingXml.slice(seg.openTagStart, seg.closeTagEnd);
    } else {
      let nextDecoded = '';
      let segCursor = seg.startOffset;

      for (const rep of overlapping) {
        // Keep text in this segment before the replacement begins
        if (rep.start > segCursor) {
          nextDecoded += fullText.slice(segCursor, Math.min(rep.start, seg.endOffset));
        }

        // Only the FIRST segment containing rep.start emits the full replacement value
        if (rep.start >= seg.startOffset && rep.start < seg.endOffset) {
          nextDecoded += rep.replacement;
        }

        segCursor = Math.min(seg.endOffset, rep.end);
      }

      if (segCursor < seg.endOffset) {
        nextDecoded += fullText.slice(segCursor, seg.endOffset);
      }

      const nextOpenTag = ensurePreserveSpaceAttr(seg.openTagRaw, nextDecoded);
      outXml += `${nextOpenTag}${formatWtInnerXml(nextDecoded)}</w:t>`;
    }

    xmlPos = seg.closeTagEnd;
  }

  outXml += workingXml.slice(xmlPos);
  return outXml;
}

export function transformParagraphsInXml(
  xml: string,
  resolveTag: (tagName: string) => DocxTagResolveOutcome,
  collected: {
    detectedTags: Set<string>;
    unknownTags: Set<string>;
    emptyTags: Set<string>;
    hasUnclosedBrace: boolean;
  }
): string {
  const pIntervals = findTagIntervals(xml, 'w:p');
  if (pIntervals.length === 0) return xml;

  let rebuilt = '';
  let cursor = 0;
  for (const iv of pIntervals) {
    rebuilt += xml.slice(cursor, iv.start);
    const pXml = xml.slice(iv.start, iv.end);
    rebuilt += transformParagraphXml(pXml, resolveTag, collected);
    cursor = iv.end;
  }
  rebuilt += xml.slice(cursor);
  return rebuilt;
}

function getTargetXmlEntryNames(files: Record<string, Uint8Array>): string[] {
  const names = Object.keys(files);
  const targets: string[] = [];

  if (files['word/document.xml']) targets.push('word/document.xml');

  const headers = names
    .filter((n) => /^word\/header\d*\.xml$/i.test(n))
    .sort();
  const footers = names
    .filter((n) => /^word\/footer\d*\.xml$/i.test(n))
    .sort();

  targets.push(...headers, ...footers);

  if (files['word/footnotes.xml']) targets.push('word/footnotes.xml');
  if (files['word/endnotes.xml']) targets.push('word/endnotes.xml');

  return targets;
}

function detectArchiveWarnings(
  files: Record<string, Uint8Array>,
  xmlEntries: string[],
  hasUnclosedBrace: boolean
): string[] {
  const warnings: string[] = [];

  if (files['word/vbaProject.bin']) {
    warnings.push(
      'Документ содержит макросы VBA (vbaProject.bin) — макросы не выполняются при генерации.'
    );
  }

  let hasTrackChanges = false;
  let hasFieldPlaceholders = false;
  let hasAltChunk = false;
  let hasMathBraces = false;

  for (const name of xmlEntries) {
    const xml = strFromU8(files[name]);
    if (/<w:ins[\s>]/.test(xml) || /<w:del[\s>]/.test(xml)) {
      hasTrackChanges = true;
    }
    if (/<w:altChunk[\s/>]/.test(xml)) {
      hasAltChunk = true;
    }
    if (/<w:instrText[\s>]/.test(xml)) {
      const instrMatches = xml.match(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g) || [];
      if (instrMatches.some((frag) => /MERGEFIELD|\{[^}]+\}/i.test(frag))) {
        hasFieldPlaceholders = true;
      }
    }
    if (/<w:fldSimple[\s>]/.test(xml) && /\{[^}]+\}/.test(xml)) {
      hasFieldPlaceholders = true;
    }
    if (/<m:oMath[\s>]/.test(xml)) {
      const mathBlocks = xml.match(/<m:oMath\b[\s\S]*?<\/m:oMath>/g) || [];
      if (mathBlocks.some((b) => b.includes('{'))) {
        hasMathBraces = true;
      }
    }
  }

  if (hasTrackChanges) {
    warnings.push(
      'Обнаружены неотклонённые правки (Track Changes) — примите изменения в Word для надёжной подстановки.'
    );
  }
  if (hasFieldPlaceholders) {
    warnings.push(
      'Обнаружены сложные поля Word (MERGEFIELD/формулы) — используйте обычный текст с тегами {Имя_тега}.'
    );
  }
  if (hasAltChunk) {
    warnings.push(
      'Обнаружены встроенные внешние фрагменты (altChunk) — теги внутри них не обрабатываются.'
    );
  }
  if (hasMathBraces) {
    warnings.push(
      'Фигурные скобки внутри формул Word (OMML) не обрабатываются как теги.'
    );
  }
  if (hasUnclosedBrace) {
    warnings.push(
      'В тексте документа найдена незакрытая скобка «{» — проверьте корректность написания тегов.'
    );
  }

  return warnings;
}

function readAndValidateDocxZip(buffer: ArrayBuffer): {
  files: Record<string, Uint8Array>;
  xmlEntries: string[];
} {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('Файл пустой (0 байт). Выберите корректный шаблон .docx.');
  }

  const bytes = new Uint8Array(buffer);
  // Check OLE Compound Binary (.doc or encrypted OOXML wrapper)
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    throw new Error(
      'Файл является устаревшим форматом .doc или зашифрован паролем. Пересохраните его в Microsoft Word / LibreOffice как обычный .docx без пароля.'
    );
  }

  // Check ZIP local file signature ('PK')
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(
      'Файл не является корректным DOCX-архивом (повреждён или имеет неподдерживаемый формат).'
    );
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error(
      'Не удалось распаковать DOCX-архив: файл повреждён или использует неподдерживаемое сжатие.'
    );
  }

  if (files['EncryptionInfo'] || files['EncryptedPackage']) {
    throw new Error(
      'DOCX-файл защищён паролем (зашифрован). Снимите защиту в Word и загрузите шаблон повторно.'
    );
  }

  if (!files['word/document.xml']) {
    throw new Error(
      'Некорректный DOCX-файл: отсутствует основной документ word/document.xml.'
    );
  }

  const xmlEntries = getTargetXmlEntryNames(files);
  return { files, xmlEntries };
}

function extractReadableTextFromPart(xml: string): string {
  const pIntervals = findTagIntervals(xml, 'w:p');
  const lines: string[] = [];

  for (const iv of pIntervals) {
    const pXml = xml.slice(iv.start, iv.end);
    const segments = collectDirectWtSegments(pXml);
    const line = segments.map((s) => s.decodedText).join('');
    if (line.trim()) {
      lines.push(line);
    }
  }

  return lines.join('\n');
}

export const docxTemplateService = {
  /**
   * Validate an uploaded .docx file, scan all paragraphs/tables/headers/footers
   * (including Word split XML runs), and extract placeholders + readable preview text.
   */
  inspectDocxTemplate(buffer: ArrayBuffer): DocxInspectResult {
    const { files, xmlEntries } = readAndValidateDocxZip(buffer);

    const collected = {
      detectedTags: new Set<string>(),
      unknownTags: new Set<string>(),
      emptyTags: new Set<string>(),
      hasUnclosedBrace: false
    };

    const previewSections: string[] = [];

    for (const partName of xmlEntries) {
      const xml = strFromU8(files[partName]);
      // Scan paragraphs cleanly across split runs without modifying archive
      transformParagraphsInXml(
        xml,
        () => ({ known: false, value: '' }),
        collected
      );

      const partText = extractReadableTextFromPart(xml);
      if (partText) {
        if (/header\d*\.xml$/i.test(partName)) {
          previewSections.push(`[Верхний колонтитул]\n${partText}`);
        } else if (/footer\d*\.xml$/i.test(partName)) {
          previewSections.push(`[Нижний колонтитул]\n${partText}`);
        } else if (partName === 'word/footnotes.xml') {
          previewSections.push(`[Сноски]\n${partText}`);
        } else if (partName === 'word/endnotes.xml') {
          previewSections.push(`[Концевые сноски]\n${partText}`);
        } else {
          previewSections.push(partText);
        }
      }
    }

    const unsupportedWarnings = detectArchiveWarnings(
      files,
      xmlEntries,
      collected.hasUnclosedBrace
    );

    return {
      detectedTags: Array.from(collected.detectedTags),
      previewText:
        previewSections.join('\n\n') ||
        '[DOCX-шаблон не содержит текстовых абзацев в word/document.xml]',
      partsScanned: xmlEntries,
      unsupportedWarnings
    };
  },

  /**
   * Render a ready .docx Blob from a source .docx ArrayBuffer, resolving split XML runs
   * in-place across document.xml, tables, headers, footers, footnotes, and endnotes
   * while preserving styles, themes, run formatting (<w:rPr>), and media assets intact.
   */
  renderDocxTemplate(
    buffer: ArrayBuffer,
    resolveTag: (tagName: string) => DocxTagResolveOutcome
  ): {
    blob: Blob;
    previewText: string;
    diagnostics: DocxRenderDiagnostic;
  } {
    const { files, xmlEntries } = readAndValidateDocxZip(buffer);

    const collected = {
      detectedTags: new Set<string>(),
      unknownTags: new Set<string>(),
      emptyTags: new Set<string>(),
      hasUnclosedBrace: false
    };

    const nextFiles: Record<string, Uint8Array> = { ...files };
    const previewSections: string[] = [];

    for (const partName of xmlEntries) {
      const originalXml = strFromU8(files[partName]);
      const transformedXml = transformParagraphsInXml(originalXml, resolveTag, collected);
      nextFiles[partName] = strToU8(transformedXml);

      const partText = extractReadableTextFromPart(transformedXml);
      if (partText) {
        if (/header\d*\.xml$/i.test(partName)) {
          previewSections.push(`[Верхний колонтитул]\n${partText}`);
        } else if (/footer\d*\.xml$/i.test(partName)) {
          previewSections.push(`[Нижний колонтитул]\n${partText}`);
        } else {
          previewSections.push(partText);
        }
      }
    }

    const unsupportedWarnings = detectArchiveWarnings(
      files,
      xmlEntries,
      collected.hasUnclosedBrace
    );

    const packedBytes = zipSync(nextFiles, { level: 6 });
    const arrayBufferCopy = new Uint8Array(packedBytes).buffer;
    const blob = new Blob([arrayBufferCopy], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });

    return {
      blob,
      previewText: previewSections.join('\n\n'),
      diagnostics: {
        unknownTags: Array.from(collected.unknownTags),
        emptyTags: Array.from(collected.emptyTags),
        unsupportedWarnings
      }
    };
  },

  /**
   * Build categorized Tag Catalog with explanations, live examples, and 1-click copy tags.
   */
  buildTagCatalog(
    targetTab: Tab,
    allTabs: Tab[],
    tags: Tag[],
    entityProfile?: LegalEntityProfile,
    sampleRow?: Row
  ): TagCatalogSection[] {
    const tabColumnsItems: TagCatalogItem[] = targetTab.columns.map((col) => {
      const rawVal = sampleRow ? sampleRow[col.id] : targetTab.rows[0]?.[col.id];
      const exampleValue =
        rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== ''
          ? String(rawVal)
          : '— (пусто в выбранной строке)';
      return {
        tag: `{${col.name}}`,
        label: col.name,
        description:
          col.type === 'relation'
            ? 'Поле текущей таблицы (связь со справочником)'
            : 'Поле текущей таблицы',
        exampleValue,
        sourceInfo: `Таблица «${targetTab.name}»`
      };
    });

    const tabMap = new Map(allTabs.map((t) => [t.id, t]));
    const sortedUserTags = [...tags].sort((a, b) => {
      const aLocal = a.tabId === targetTab.id ? 0 : 1;
      const bLocal = b.tabId === targetTab.id ? 0 : 1;
      if (aLocal !== bLocal) return aLocal - bLocal;
      return a.name.localeCompare(b.name, 'ru');
    });

    const userTagItems: TagCatalogItem[] = sortedUserTags.map((t) => {
      const srcTab = tabMap.get(t.tabId);
      const srcCol = srcTab?.columns.find((c) => c.id === t.columnId);
      const firstVal =
        t.tabId === targetTab.id && sampleRow
          ? sampleRow[t.columnId]
          : srcTab?.rows[0]?.[t.columnId];
      const exampleValue =
        firstVal !== undefined && firstVal !== null && String(firstVal).trim() !== ''
          ? String(firstVal)
          : '—';
      return {
        tag: t.name,
        label: srcCol?.name || t.name,
        description: t.description || 'Пользовательский привязанный тег',
        exampleValue,
        sourceInfo: srcTab
          ? `${srcTab.name} → ${srcCol?.name || 'удалённый столбец'}`
          : 'Источник удалён'
      };
    });

    const entitySystemItems: TagCatalogItem[] = ENTITY_SYSTEM_TAG_META.map((meta) => ({
      tag: meta.tag,
      label: meta.label,
      description: meta.description,
      exampleValue: meta.getExample(entityProfile, sampleRow || targetTab.rows[0]),
      sourceInfo: meta.tag === '{id}' ? 'Системный идентификатор' : 'Карточка организации'
    }));

    return [
      {
        id: 'current_tab',
        title: `Поля таблицы «${targetTab.name}»`,
        description: 'Подставляются напрямую по названию столбца текущей таблицы.',
        items: tabColumnsItems
      },
      {
        id: 'user_tags',
        title: 'Привязанные теги и справочники',
        description:
          'Универсальные теги из пула. Данные из связанных мастер-таблиц подтягиваются по полному набору связей.',
        items: userTagItems
      },
      {
        id: 'entity_system',
        title: 'Реквизиты организации и системные теги',
        description: 'Заполняются автоматически из карточки активного юридического лица.',
        items: entitySystemItems
      }
    ];
  }
};

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
