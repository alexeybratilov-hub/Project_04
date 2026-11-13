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
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
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
          if (val !== undefined && val !== null && val !== '') {
            hasAnyValue = true;
          }
          rowObj[colName] = val ?? '';
        });
        if (hasAnyValue) {
          rawRows.push(rowObj);
        }
      }

      // Infer column types
      const suggestedColumns: Column[] = cleanHeaders.map((header: string, index: number) => {
        const id = `col_${Date.now()}_${index}`;
        const sampleValues = rawRows.slice(0, 30).map((r) => r[header]).filter((v) => v !== '' && v !== undefined);
        let type: ColumnType = 'text';

        if (sampleValues.length > 0) {
          const isAllNumbers = sampleValues.every((v) => !isNaN(Number(v)));
          const isAllDates = sampleValues.every((v) => {
            const s = String(v);
            return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{2}\.\d{2}\.\d{4}$/.test(s);
          });
          const isAllBooleans = sampleValues.every((v) => {
            const s = String(v).toLowerCase();
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
  }
};
