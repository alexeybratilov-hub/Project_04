import * as XLSX from 'xlsx';
import { Column, ColumnType, Tab } from '../types/database';

export interface ParsedExcelSheet {
  headers: string[];
  rawRows: Record<string, any>[];
  suggestedColumns: Column[];
}

export interface ValidationDiscrepancy {
  rowNumber: number;
  columnName: string;
  value: any;
  masterTabName: string;
  expectedValuesSnippet: string;
  reason?: string;
}

export const excelService = {
  /**
   * Parse uploaded Excel or CSV file
   */
  async parseFile(file: File): Promise<Record<string, ParsedExcelSheet>> {
    const arrayBuffer = await file.arrayBuffer();
    let workbook: XLSX.WorkBook;
    if (file.name.toLowerCase().endsWith('.csv')) {
      const bytes = new Uint8Array(arrayBuffer);
      let decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      // If replacement char detected, fallback to Windows-1251 common in Russian Excel CSV exports
      if (decoded.includes('\uFFFD')) {
        try {
          decoded = new TextDecoder('windows-1251').decode(bytes);
        } catch {
          // ignore if unavailable
        }
      }
      workbook = XLSX.read(decoded, { type: 'string', cellDates: true });
    } else {
      workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    }
    const result: Record<string, ParsedExcelSheet> = {};

    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      // Convert to JSON with headers in 1st row
      const jsonData: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 });
      if (!jsonData || jsonData.length === 0) return;

      const headerRow = (jsonData[0] || []).map((h: any) => String(h || '').trim());
      const cleanHeaders = headerRow.filter((h: string) => h.length > 0);
      if (cleanHeaders.length === 0) return;

      const rawRows: Record<string, any>[] = [];
      for (let i = 1; i < jsonData.length; i++) {
        const rowArr = jsonData[i];
        if (!rowArr || rowArr.length === 0) continue;
        const rowObj: Record<string, any> = {};
        let hasAnyValue = false;
        cleanHeaders.forEach((colName: string, idx: number) => {
          let val = rowArr[idx];
          if (val instanceof Date) {
            val = val.toISOString().split('T')[0];
          }
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            hasAnyValue = true;
          }
          rowObj[colName] = val ?? '';
        });
        if (hasAnyValue) {
          rawRows.push(rowObj);
        }
      }

      // Infer column types (guarding against whitespace strings!)
      const suggestedColumns: Column[] = cleanHeaders.map((header: string, index: number) => {
        const id = `col_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 5)}`;
        const sampleValues = rawRows
          .slice(0, 30)
          .map((r) => r[header])
          .filter((v) => v !== undefined && v !== null && String(v).trim() !== '');
        let type: ColumnType = 'text';

        if (sampleValues.length > 0) {
          const isAllNumbers = sampleValues.every((v) => {
            const s = String(v).trim().replace(',', '.');
            return s.length > 0 && !isNaN(Number(s));
          });
          const isAllDates = sampleValues.every((v) => {
            const s = String(v).trim();
            return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{2}\.\d{2}\.\d{4}$/.test(s);
          });
          const isAllBooleans = sampleValues.every((v) => {
            const s = String(v).trim().toLowerCase();
            return ['да', 'нет', 'true', 'false', '1', '0'].includes(s);
          });

          if (isAllNumbers) type = 'number';
          else if (isAllDates) type = 'date';
          else if (isAllBooleans) type = 'boolean';
        }

        return {
          id,
          name: header,
          type,
          width: 180
        };
      });

      result[sheetName] = {
        headers: cleanHeaders,
        rawRows,
        suggestedColumns
      };
    });

    return result;
  },

  /**
   * Parse clipboard / raw array text (TSV from Excel, or semicolon/CSV)
   * Automatically detects if the first row matches column names in targetTab.
   */
  parseBulkTextForTab(
    rawText: string,
    targetTab: Tab
  ): {
    rawRows: Record<string, any>[];
    columnMapping: Record<string, string>;
    hasHeaderRow: boolean;
  } {
    const lines = rawText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      return { rawRows: [], columnMapping: {}, hasHeaderRow: false };
    }

    // Detect delimiter (prefer tab, fallback to semicolon)
    const firstLine = lines[0];
    const delimiter = firstLine.includes('\t') ? '\t' : ';';
    const matrix = lines.map((l) => l.split(delimiter).map((cell) => cell.trim()));

    const firstRowCells = matrix[0];
    const tabColNamesLower = targetTab.columns.map((c) => c.name.trim().toLowerCase());
    const matchedHeaderCount = firstRowCells.filter((cell) =>
      tabColNamesLower.includes(cell.toLowerCase())
    ).length;

    const hasHeaderRow = matchedHeaderCount >= 1 && matrix.length > 1;
    const headers = hasHeaderRow
      ? firstRowCells
      : targetTab.columns.map((c) => c.name);

    const dataStartIdx = hasHeaderRow ? 1 : 0;
    const rawRows: Record<string, any>[] = [];

    for (let i = dataStartIdx; i < matrix.length; i++) {
      const cells = matrix[i];
      if (!cells.some((c) => c.length > 0)) continue;
      const obj: Record<string, any> = {};
      headers.forEach((h, idx) => {
        obj[h] = cells[idx] ?? '';
      });
      rawRows.push(obj);
    }

    const columnMapping: Record<string, string> = {};
    if (hasHeaderRow) {
      targetTab.columns.forEach((col) => {
        const matched = headers.find((h) => h.toLowerCase() === col.name.trim().toLowerCase());
        if (matched) columnMapping[col.id] = matched;
      });
    } else {
      targetTab.columns.forEach((col, idx) => {
        if (idx < firstRowCells.length) {
          columnMapping[col.id] = headers[idx];
        }
      });
    }

    return { rawRows, columnMapping, hasHeaderRow };
  },

  /**
   * Validate linked column constraints before committing bulk import/paste.
   * Checks BOTH:
   * 1) Each individual linked column value exists in the Master table.
   * 2) Combined tuple integrity: when multiple columns link to the SAME Master table
   *    (e.g. Должность + Подразделение -> Штатное расписание), each row's combination
   *    must match an actual row in that Master table.
   */
  validateLinkedColumns(
    rows: Record<string, any>[],
    columnMapping: Record<string, string>, // targetColumnId -> rowKey (header or colName)
    targetTab: Tab,
    allTabs: Tab[]
  ): ValidationDiscrepancy[] {
    const discrepancies: ValidationDiscrepancy[] = [];

    // 1. Single-column membership validation
    const linkedColsByMaster = new Map<string, Column[]>();

    targetTab.columns.forEach((col) => {
      if (col.type === 'relation' && col.relation) {
        const fileHeader = columnMapping[col.id];
        if (!fileHeader) return; // not mapped

        const masterTab = allTabs.find((t) => t.id === col.relation?.masterTabId);
        if (!masterTab) return;

        const existingList = linkedColsByMaster.get(masterTab.id) || [];
        existingList.push(col);
        linkedColsByMaster.set(masterTab.id, existingList);

        const masterValues = new Set(
          masterTab.rows.map((r) => String(r[col.relation!.masterColumnId] ?? '').trim().toLowerCase())
        );

        const sampleMaster = masterTab.rows
          .slice(0, 5)
          .map((r) => String(r[col.relation!.masterColumnId] ?? ''))
          .filter(Boolean)
          .join(', ');

        rows.forEach((row, rowIndex) => {
          const rawVal = row[fileHeader];
          if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') return;
          const strVal = String(rawVal).trim().toLowerCase();
          if (!masterValues.has(strVal)) {
            discrepancies.push({
              rowNumber: rowIndex + 1,
              columnName: col.name,
              value: rawVal,
              masterTabName: masterTab.name,
              expectedValuesSnippet: sampleMaster,
              reason: `Значение «${String(rawVal)}» отсутствует в мастер-таблице «${masterTab.name}»`
            });
          }
        });
      }
    });

    // 2. Multi-column tuple consistency against the same Master table
    linkedColsByMaster.forEach((cols, masterTabId) => {
      if (cols.length < 2) return;
      const masterTab = allTabs.find((t) => t.id === masterTabId);
      if (!masterTab) return;

      rows.forEach((row, rowIndex) => {
        const activePairs = cols
          .map((col) => {
            const header = columnMapping[col.id];
            const val = header ? String(row[header] ?? '').trim() : '';
            return { col, val };
          })
          .filter((item) => item.val !== '');

        if (activePairs.length < 2) return;

        // Check if at least one row in masterTab satisfies ALL linked column values simultaneously
        const hasCombinedMatch = masterTab.rows.some((masterRow) =>
          activePairs.every(
            ({ col, val }) =>
              String(masterRow[col.relation!.masterColumnId] ?? '').trim().toLowerCase() === val.toLowerCase()
          )
        );

        if (!hasCombinedMatch) {
          // Avoid duplicating if one of the individual columns already failed at this row
          const alreadyFlaggedRow = discrepancies.some(
            (d) => d.rowNumber === rowIndex + 1 && d.masterTabName === masterTab.name
          );
          if (!alreadyFlaggedRow) {
            const comboDesc = activePairs.map((p) => `${p.col.name}: «${p.val}»`).join(' + ');
            discrepancies.push({
              rowNumber: rowIndex + 1,
              columnName: activePairs.map((p) => p.col.name).join(' + '),
              value: comboDesc,
              masterTabName: masterTab.name,
              expectedValuesSnippet: '',
              reason: `Комбинация (${comboDesc}) не найдена в одной строке мастер-таблицы «${masterTab.name}»`
            });
          }
        }
      });
    });

    return discrepancies;
  },

  /**
   * Export tab to XLSX
   */
  exportTabToXlsx(tab: Tab, _allTabs: Tab[], fileName?: string): void {
    const finalFileName = fileName || `${tab.name.replace(/[/\\?%*:|"<>]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;

    const exportData = tab.rows.map((row) => {
      const obj: Record<string, any> = {};
      tab.columns.forEach((col) => {
        let val = row[col.id];
        if (col.type === 'boolean') {
          val = val ? 'Да' : 'Нет';
        }
        obj[col.name] = val ?? '';
      });
      return obj;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, tab.name.slice(0, 31));

    XLSX.writeFile(workbook, finalFileName);
  },

  /**
   * Direct inline paste from Excel (Ctrl+V into a clicked field/cell):
   * - Requires at least one column with a non-empty name in targetTab.
   * - Single column copy (1 x N) -> fills clicked targetColumnId (or matched header column).
   * - Multi-column copy (K x N, K > 1) -> requires K === targetTab.columns.length (full array).
   * - Enforces full referential integrity against Master tables via validateLinkedColumns.
   */
  parseInlineClipboardPaste(
    rawText: string,
    targetTab: Tab,
    allTabs: Tab[],
    targetColumnId?: string
  ): {
    ok: boolean;
    error?: string;
    discrepancies: ValidationDiscrepancy[];
    rows: Record<string, any>[];
    mode?: 'single_column' | 'partial_array' | 'full_array';
    targetColumnNames: string[];
  } {
    const namedCols = targetTab.columns.filter((c) => c.name.trim().length > 0);
    if (namedCols.length === 0) {
      return {
        ok: false,
        error: 'Для вставки данных из Excel сначала создайте во вкладке хотя бы один столбец с наименованием.',
        discrepancies: [],
        rows: [],
        targetColumnNames: []
      };
    }

    const rawLines = rawText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n');

    // Trim leading/trailing empty lines only (preserve blank interior rows? trim trailing Excel newline)
    while (rawLines.length > 0 && rawLines[rawLines.length - 1].trim() === '') {
      rawLines.pop();
    }
    const lines = rawLines.filter((l) => l.trim().length > 0);

    if (lines.length === 0) {
      return {
        ok: false,
        error: 'В буфере обмена нет непустых данных для вставки.',
        discrepancies: [],
        rows: [],
        targetColumnNames: []
      };
    }

    const hasTabs = lines.some((l) => l.includes('\t'));
    let matrix: string[][];
    if (hasTabs) {
      matrix = lines.map((l) => l.split('\t').map((c) => c.trim()));
    } else {
      const semiCounts = lines.map((l) => l.split(';').length);
      const isConsistentSemicolonCsv =
        semiCounts[0] > 1 && semiCounts.every((cnt) => cnt === semiCounts[0]);
      matrix = isConsistentSemicolonCsv
        ? lines.map((l) => l.split(';').map((c) => c.trim()))
        : lines.map((l) => [l.trim()]);
    }

    const copiedColCount = Math.max(...matrix.map((r) => r.length));
    const totalTabCols = targetTab.columns.length;

    // Reject ONLY when copied columns exceed existing columns in the tab
    if (copiedColCount > totalTabCols) {
      return {
        ok: false,
        error: `Превышено количество столбцов: скопировано ${copiedColCount}, а во вкладке «${targetTab.name}» создано ${totalTabCols}. Удалите лишние столбцы из копируемого диапазона или добавьте столбцы в таблицу.`,
        discrepancies: [],
        rows: [],
        targetColumnNames: []
      };
    }

    const rawRows: Record<string, any>[] = [];
    const columnMapping: Record<string, string> = {};
    let mode: 'single_column' | 'partial_array' | 'full_array' = 'single_column';
    let targetColumnNames: string[] = [];

    if (copiedColCount === 1) {
      mode = 'single_column';
      const clickedCol =
        targetTab.columns.find((c) => c.id === targetColumnId) || namedCols[0];

      const firstCellLower = matrix[0][0].trim().toLowerCase();
      const matchedColByHeader =
        matrix.length > 1
          ? targetTab.columns.find((c) => c.name.trim().toLowerCase() === firstCellLower)
          : undefined;

      // Strip header row if first cell matches clicked column name (or no target column clicked and header matched)
      const shouldStripHeader =
        Boolean(matchedColByHeader) &&
        (!targetColumnId || matchedColByHeader!.id === clickedCol.id);

      const destCol = shouldStripHeader && matchedColByHeader ? matchedColByHeader : clickedCol;
      const dataStartIdx = shouldStripHeader ? 1 : 0;

      const keyName = destCol.name;
      columnMapping[destCol.id] = keyName;
      targetColumnNames = [destCol.name];

      for (let i = dataStartIdx; i < matrix.length; i++) {
        const val = matrix[i][0] ?? '';
        rawRows.push({ [keyName]: val });
      }
    } else {
      mode = copiedColCount === totalTabCols ? 'full_array' : 'partial_array';

      const clickedIdx = targetColumnId
        ? Math.max(
            0,
            targetTab.columns.findIndex((c) => c.id === targetColumnId)
          )
        : 0;
      const effectiveStartIdx = Math.min(clickedIdx, Math.max(0, totalTabCols - copiedColCount));

      const firstRowCells = matrix[0];
      const tabColNamesLower = targetTab.columns.map((c) => c.name.trim().toLowerCase());
      const matchedHeaderCount = firstRowCells.filter((cell) =>
        tabColNamesLower.includes(cell.trim().toLowerCase())
      ).length;

      const hasHeaderRow = matchedHeaderCount >= 1 && matrix.length > 1;
      const dataStartIdx = hasHeaderRow ? 1 : 0;

      const sourceKeys: string[] = Array.from({ length: copiedColCount }, (_, idx) => {
        if (hasHeaderRow && firstRowCells[idx]?.trim()) {
          return `__src_${idx}_${firstRowCells[idx].trim()}`;
        }
        return `__src_${idx}`;
      });

      if (hasHeaderRow) {
        const mappedColIds = new Set<string>();
        const unmappedSourceIndices: number[] = [];

        for (let sIdx = 0; sIdx < copiedColCount; sIdx++) {
          const headerLower = (firstRowCells[sIdx] || '').trim().toLowerCase();
          const matchedCol = targetTab.columns.find(
            (c) => !mappedColIds.has(c.id) && c.name.trim().toLowerCase() === headerLower
          );
          if (matchedCol) {
            mappedColIds.add(matchedCol.id);
            columnMapping[matchedCol.id] = sourceKeys[sIdx];
            targetColumnNames.push(matchedCol.name);
          } else {
            unmappedSourceIndices.push(sIdx);
          }
        }

        // Fallback positionally from effectiveStartIdx for any unmatched header columns
        let fallbackCursor = effectiveStartIdx;
        unmappedSourceIndices.forEach((sIdx) => {
          while (
            fallbackCursor < totalTabCols &&
            mappedColIds.has(targetTab.columns[fallbackCursor].id)
          ) {
            fallbackCursor += 1;
          }
          if (fallbackCursor >= totalTabCols) {
            fallbackCursor = targetTab.columns.findIndex((c) => !mappedColIds.has(c.id));
          }
          if (fallbackCursor >= 0 && fallbackCursor < totalTabCols) {
            const targetCol = targetTab.columns[fallbackCursor];
            mappedColIds.add(targetCol.id);
            columnMapping[targetCol.id] = sourceKeys[sIdx];
            targetColumnNames.push(targetCol.name);
          }
        });
      } else {
        for (let sIdx = 0; sIdx < copiedColCount; sIdx++) {
          const targetCol = targetTab.columns[effectiveStartIdx + sIdx];
          if (targetCol) {
            columnMapping[targetCol.id] = sourceKeys[sIdx];
            targetColumnNames.push(targetCol.name);
          }
        }
      }

      for (let i = dataStartIdx; i < matrix.length; i++) {
        const cells = matrix[i];
        if (!cells.some((c) => c.length > 0)) continue;
        const obj: Record<string, any> = {};
        sourceKeys.forEach((key, idx) => {
          obj[key] = cells[idx] ?? '';
        });
        rawRows.push(obj);
      }
    }

    if (rawRows.length === 0) {
      return {
        ok: false,
        error: 'После заголовка нет строк с данными для вставки.',
        discrepancies: [],
        rows: [],
        targetColumnNames
      };
    }

    const discrepancies = excelService.validateLinkedColumns(
      rawRows,
      columnMapping,
      targetTab,
      allTabs
    );

    if (discrepancies.length > 0) {
      return {
        ok: false,
        error: `Вставка отклонена (${discrepancies.length} несовпадений): данные в связанных столбцах должны совпадать с мастер-таблицей.`,
        discrepancies,
        rows: [],
        mode,
        targetColumnNames
      };
    }

    const convertedRows: Record<string, any>[] = rawRows.map((fileRow, idx) => {
      const r: Record<string, any> = {
        id: `row_paste_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`
      };

      targetTab.columns.forEach((col) => {
        const mappedKey = columnMapping[col.id];
        if (!mappedKey) {
          r[col.id] = col.type === 'boolean' ? false : col.type === 'number' ? 0 : '';
          return;
        }
        let val: any = fileRow[mappedKey] ?? '';
        if (col.type === 'boolean') {
          const s = String(val).trim().toLowerCase();
          val = ['да', 'true', '1', '+'].includes(s);
        } else if (col.type === 'number') {
          const num = Number(String(val).replace(',', '.').replace(/\s+/g, ''));
          val = String(val).trim() !== '' && !isNaN(num) ? num : 0;
        } else if (col.type === 'date') {
          const s = String(val).trim();
          const ruDateMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
          if (ruDateMatch) {
            val = `${ruDateMatch[3]}-${ruDateMatch[2]}-${ruDateMatch[1]}`;
          }
        }
        r[col.id] = val ?? '';
      });

      return r;
    });

    return {
      ok: true,
      discrepancies: [],
      rows: convertedRows,
      mode,
      targetColumnNames
    };
  }
};
