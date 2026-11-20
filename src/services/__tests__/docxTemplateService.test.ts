import { describe, it, expect } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { docxTemplateService } from '../docxTemplateService';
import { INITIAL_DATABASE_STATE } from '../../data/initialDatabase';

function makeDocxArchive(entries: Record<string, string | Uint8Array>): ArrayBuffer {
  const raw: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
    ),
    'word/styles.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="CustomBold"><w:name w:val="CustomBold"/></w:style></w:styles>'
    )
  };
  for (const [k, v] of Object.entries(entries)) {
    raw[k] = typeof v === 'string' ? strToU8(v) : v;
  }
  const zipped = zipSync(raw);
  return new Uint8Array(zipped).buffer;
}

describe('docxTemplateService (T-44)', () => {
  it('replaces standard tags, Word split XML runs, tables, headers, footers, and preserves rPr + styles + media', () => {
    const fakePngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
  <w:body>
    <w:p>
      <w:r><w:rPr><w:b/><w:color w:val="1F4E79"/></w:rPr><w:t>{Орга</w:t></w:r>
      <w:proofErr w:type="spellStart"/>
      <w:r><w:rPr><w:i/></w:rPr><w:t>низация}</w:t></w:r>
      <w:r><w:t xml:space="preserve"> — работник: {ФИО}</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>{Долж</w:t></w:r><w:r><w:t>ность}</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>{Неизвестный_тег}</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p>
      <w:r>
        <mc:AlternateContent>
          <w:txbxContent>
            <w:p><w:r><w:t>Блок: {Подразделение}</w:t></w:r></w:p>
          </w:txbxContent>
        </mc:AlternateContent>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

    const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>Колонтитул верхний: </w:t></w:r><w:r><w:t>{Организация}</w:t></w:r></w:p>
</w:hdr>`;

    const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>Исп. </w:t></w:r><w:r><w:t>{ФИ</w:t></w:r><w:r><w:t>О}</w:t></w:r></w:p>
</w:ftr>`;

    const srcBuffer = makeDocxArchive({
      'word/document.xml': documentXml,
      'word/header1.xml': headerXml,
      'word/footer1.xml': footerXml,
      'word/media/logo.png': fakePngBytes
    });

    const inspected = docxTemplateService.inspectDocxTemplate(srcBuffer);
    expect(inspected.detectedTags).toEqual(
      expect.arrayContaining([
        '{Организация}',
        '{ФИО}',
        '{Должность}',
        '{Неизвестный_тег}',
        '{Подразделение}'
      ])
    );
    expect(inspected.unsupportedWarnings).toEqual([]);

    const values: Record<string, string> = {
      '{Организация}': 'ООО "Рога & Копыта" <Тест>',
      '{ФИО}': 'Иванов Сергей Петрович',
      '{Должность}': 'Электрогазосварщик',
      '{Подразделение}': 'Цех №1'
    };

    const rendered = docxTemplateService.renderDocxTemplate(srcBuffer, (tagName) => {
      if (tagName in values) {
        return { known: true, value: values[tagName] };
      }
      return { known: false, value: tagName };
    });

    expect(rendered.diagnostics.unknownTags).toEqual(['{Неизвестный_тег}']);
    expect(rendered.diagnostics.emptyTags).toEqual([]);

    // Re-read resulting DOCX ZIP and inspect XML + binary preservation
    return rendered.blob.arrayBuffer().then((outBuf) => {
      const outFiles = unzipSync(new Uint8Array(outBuf));
      const outDocXml = strFromU8(outFiles['word/document.xml']);
      const outHdrXml = strFromU8(outFiles['word/header1.xml']);
      const outFtrXml = strFromU8(outFiles['word/footer1.xml']);

      // XML entities must be safely escaped (&, <, >)
      expect(outDocXml).toContain('ООО "Рога &amp; Копыта" &lt;Тест&gt;');
      // First run formatting (<w:rPr><w:b/><w:color w:val="1F4E79"/></w:rPr>) preserved
      expect(outDocXml).toContain(
        '<w:r><w:rPr><w:b/><w:color w:val="1F4E79"/></w:rPr><w:t>ООО "Рога &amp; Копыта" &lt;Тест&gt;</w:t></w:r>'
      );
      // Table split run replaced cleanly
      expect(outDocXml).toContain('<w:t>Электрогазосварщик</w:t>');
      // Nested textbox replaced cleanly
      expect(outDocXml).toContain('Блок: Цех №1');
      // Unknown tag untouched without breaking XML
      expect(outDocXml).toContain('<w:t>{Неизвестный_тег}</w:t>');
      // Header & footer replaced across split runs
      expect(outHdrXml).toContain('Колонтитул верхний: ');
      expect(outHdrXml).toContain('ООО "Рога &amp; Копыта" &lt;Тест&gt;');
      expect(outFtrXml).toContain('Иванов Сергей Петрович');
      // Non-document parts preserved byte-for-byte
      expect(strFromU8(outFiles['word/styles.xml'])).toContain('CustomBold');
      expect(Array.from(outFiles['word/media/logo.png'])).toEqual(Array.from(fakePngBytes));
    });
  });

  it('handles missing/empty values safely with xml:space="preserve" and multiline breaks without corrupting XML', async () => {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>СНИЛС: [{СНИЛС}] / Примечание: {Примечание}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const srcBuffer = makeDocxArchive({ 'word/document.xml': documentXml });
    const rendered = docxTemplateService.renderDocxTemplate(srcBuffer, (tagName) => {
      if (tagName === '{СНИЛС}') {
        return { known: true, value: '', isEmptyRowValue: true };
      }
      if (tagName === '{Примечание}') {
        return { known: true, value: 'Строка 1\nСтрока 2' };
      }
      return { known: false, value: tagName };
    });

    expect(rendered.diagnostics.emptyTags).toEqual(['{СНИЛС}']);
    const outFiles = unzipSync(new Uint8Array(await rendered.blob.arrayBuffer()));
    const outDocXml = strFromU8(outFiles['word/document.xml']);
    expect(outDocXml).toContain('СНИЛС: [] / Примечание: Строка 1</w:t><w:br/><w:t xml:space="preserve">Строка 2');
  });

  it('rejects empty, corrupted, legacy .doc OLE, encrypted OOXML, and archives missing word/document.xml', () => {
    expect(() => docxTemplateService.inspectDocxTemplate(new ArrayBuffer(0))).toThrow(/пустой/i);

    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6]).buffer;
    expect(() => docxTemplateService.inspectDocxTemplate(garbage)).toThrow(/ZIP|DOCX/i);

    const oleHeader = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]).buffer;
    expect(() => docxTemplateService.inspectDocxTemplate(oleHeader)).toThrow(/\.doc|зашифрован/i);

    const encryptedZip = new Uint8Array(
      zipSync({
        EncryptionInfo: strToU8('enc'),
        EncryptedPackage: strToU8('pkg')
      })
    ).buffer;
    expect(() => docxTemplateService.inspectDocxTemplate(encryptedZip)).toThrow(/паролем|зашифрован/i);

    const noDocumentXml = new Uint8Array(
      zipSync({ '[Content_Types].xml': strToU8('<Types/>') })
    ).buffer;
    expect(() => docxTemplateService.inspectDocxTemplate(noDocumentXml)).toThrow(/word\/document\.xml/i);
  });

  it('reports non-fatal structural warnings for Track Changes, VBA macros, MERGEFIELD, and unclosed braces', () => {
    const docWithWarnings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:ins w:id="1"><w:r><w:t>{ФИО}</w:t></w:r></w:ins></w:p>
    <w:p><w:r><w:instrText>MERGEFIELD Name</w:instrText></w:r><w:r><w:t>{Сломанный</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const srcBuffer = makeDocxArchive({
      'word/document.xml': docWithWarnings,
      'word/vbaProject.bin': new Uint8Array([1, 2, 3])
    });

    const inspected = docxTemplateService.inspectDocxTemplate(srcBuffer);
    expect(inspected.unsupportedWarnings.some((w) => /VBA/i.test(w))).toBe(true);
    expect(inspected.unsupportedWarnings.some((w) => /Track Changes/i.test(w))).toBe(true);
    expect(inspected.unsupportedWarnings.some((w) => /MERGEFIELD/i.test(w))).toBe(true);
    expect(inspected.unsupportedWarnings.some((w) => /незакрытая скобка/i.test(w))).toBe(true);
  });

  it('builds categorized Tag Catalog with table fields, user tags, entity requisites, and examples', () => {
    const entity = INITIAL_DATABASE_STATE.entities[0];
    const empTab = entity.tabs.find((t) => t.id === 'tab_employees')!;
    const catalog = docxTemplateService.buildTagCatalog(
      empTab,
      entity.tabs,
      entity.tags,
      entity.profile,
      empTab.rows[0]
    );

    expect(catalog.map((s) => s.id)).toEqual(['current_tab', 'user_tags', 'entity_system']);
    expect(catalog[0].items.some((i) => i.tag === '{ФИО работника}' && i.exampleValue.includes('Иванов'))).toBe(true);
    expect(catalog[1].items.some((i) => i.tag === '{ФИО}')).toBe(true);
    expect(catalog[2].items.some((i) => i.tag === '{Организация}' && i.exampleValue.includes('Катания'))).toBe(true);
  });
});
