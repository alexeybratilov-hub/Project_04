import { describe, it, expect } from 'vitest';
import { INITIAL_DATABASE_STATE } from '../../data/initialDatabase';
import {
  buildGitReadinessWorkbookSheets,
  evaluateGitReadiness,
  exportGitReadinessDocx,
  exportGitReadinessPdf,
  formatGitReadinessGroupMarkup,
  formatGitReadinessReportText
} from '../gitReadinessService';
import { buildXlsxArrayBuffer, parseXlsxWorkbook } from '../ooxmlWorkbookService';
import { DatabaseState } from '../../types/database';

function cloneDb(): DatabaseState {
  return JSON.parse(JSON.stringify(INITIAL_DATABASE_STATE));
}

describe('gitReadinessService (ГИТ inspection readiness evaluation & export)', () => {
  it('evaluates 9 checks cleanly and computes deterministic readiness score for initial database', () => {
    const db = cloneDb();
    const report = evaluateGitReadiness(db, '2026-03-01');

    expect(report.checks).toHaveLength(9);
    expect(report.maxPoints).toBe(100);
    expect(report.scorePercent).toBeGreaterThanOrEqual(0);
    expect(report.scorePercent).toBeLessThanOrEqual(100);
    expect(report.totalPoints).toBeLessThanOrEqual(report.maxPoints);
    expect(report.entityName).toBe(db.entities[0].profile.shortName);
    expect(report.passedCount + report.warningCount + report.criticalCount).toBe(9);
  });

  it('penalizes missing requisites, empty staffing/employees, broken integrity, and orders critical gaps first', () => {
    const db = cloneDb();
    const ent = db.entities[0];
    ent.profile = {
      ...ent.profile,
      inn: '',
      ogrn: '',
      legalAddress: '',
      directorFio: ''
    };
    // Empty staffing and add a broken tag
    db.tabs = db.tabs.map((t) =>
      t.id === 'tab_positions' || t.moduleId === 'staffing' ? { ...t, rows: [] } : t
    );
    db.tags = [
      ...db.tags,
      { id: 'tag_broken_git', name: '{Битый_Тег}', tabId: 'non_existent_tab', columnId: 'x' }
    ];
    ent.tabs = db.tabs;
    ent.tags = db.tags;

    const report = evaluateGitReadiness(db, '2026-03-01');

    const profileCheck = report.checks.find((c) => c.id === 'entity_profile');
    expect(profileCheck?.status).toBe('critical');
    expect(profileCheck?.score).toBe(0);

    const staffingCheck = report.checks.find((c) => c.id === 'staffing_sout');
    expect(staffingCheck?.status).toBe('critical');
    expect(staffingCheck?.score).toBe(0);

    const integrityCheck = report.checks.find((c) => c.id === 'referential_integrity');
    expect(integrityCheck?.status).toBe('critical');
    expect(integrityCheck?.score).toBeLessThan(10);

    // Critical gaps must be sorted before warnings
    const firstWarningIdx = report.gaps.findIndex((g) => g.severity === 'warning');
    if (firstWarningIdx !== -1) {
      const hasCriticalAfterWarning = report.gaps
        .slice(firstWarningIdx)
        .some((g) => g.severity === 'critical');
      expect(hasCriticalAfterWarning).toBe(false);
    }
  });

  it('produces high readiness score when all 9 ОТ contours are filled without overdues', () => {
    const db = cloneDb();
    const ent = db.entities[0];
    // Add an active generated document so normatives_lna gets 5/5
    db.generatedDocs = [
      {
        id: 'doc_git_1',
        title: 'Приказ о назначении ответственных по ОТ',
        fileName: 'prikaz_ot.docx',
        category: 'Приказы',
        format: 'docx',
        createdAt: '2026-02-01T10:00:00.000Z',
        dateFormatted: '01.02.2026',
        relativePath: 'Приказы/prikaz_ot.docx',
        isArchived: false,
        sizeFormatted: '24 КБ'
      }
    ];
    ent.generatedDocs = db.generatedDocs;

    // Ensure every staffing row has class, factors (if 3.x), and PPE norm without breaking tab_factors relations
    const validFactorName = String(
      db.tabs.find((t) => t.id === 'tab_factors')?.rows[0]?.fac_name || ''
    );
    db.tabs = db.tabs.map((t) => {
      if (t.id === 'tab_positions') {
        return {
          ...t,
          rows: t.rows.map((r) => {
            const sout = String(r.pos_sout_class || '2.0 (допустимый)');
            const needsFactor = /3\.\d|4\b|вредн|опасн/i.test(sout);
            return {
              ...r,
              pos_sout_class: sout,
              pos_factors: needsFactor ? String(r.pos_factors || validFactorName) : String(r.pos_factors || ''),
              pos_ppe_norm: r.pos_ppe_norm || 'Костюм, ботинки, перчатки (766н)'
            };
          })
        };
      }
      if (t.id === 'tab_employees') {
        return {
          ...t,
          rows: t.rows.map((r) => ({
            ...r,
            emp_hire_date: r.emp_hire_date || '2026-01-15'
          }))
        };
      }
      // Push any deadline cells safely into the future so there are no overdues on 2026-02-15
      const dlCols = t.columns.filter((c) => c.type === 'deadline_control');
      if (dlCols.length > 0) {
        return {
          ...t,
          rows: t.rows.map((r) => {
            const copy = { ...r };
            dlCols.forEach((c) => {
              copy[c.id] = { actualDate: '2026-02-10' };
            });
            return copy;
          })
        };
      }
      return t;
    });

    const empTab = db.tabs.find((t) => t.id === 'tab_employees')!;
    db.employeeObligations = empTab.rows.map((r, i) => ({
      id: `obl_${i}`,
      employeeRowId: r.id,
      moduleId: 'briefings',
      requirementId: 'intro',
      title: 'Вводный инструктаж',
      kind: 'document' as const,
      dueDate: '2026-03-01',
      status: 'done' as const,
      createdAt: '2026-01-15T00:00:00.000Z'
    }));

    ent.tabs = db.tabs;
    ent.employeeObligations = db.employeeObligations;

    const report = evaluateGitReadiness(db, '2026-02-15');
    expect(report.level).toBe('high');
    expect(report.scorePercent).toBeGreaterThanOrEqual(85);
    expect(report.criticalCount).toBe(0);
  });

  it('formats plain text and [ТАБЛИЦА] markup and builds valid XLSX, DOCX, and PDF exports', async () => {
    const db = cloneDb();
    const report = evaluateGitReadiness(db, '2026-03-01');

    const plainText = formatGitReadinessReportText(report);
    expect(plainText).toContain('ОТЧЁТ О ГОТОВНОСТИ К ПРОВЕРКЕ ГИТ');
    expect(plainText).toContain(report.entityName);

    const groupMarkup = formatGitReadinessGroupMarkup(report);
    expect(groupMarkup).toContain('[ТАБЛИЦА]');
    expect(groupMarkup).toContain('[/ТАБЛИЦА]');

    const sheets = buildGitReadinessWorkbookSheets(report);
    expect(sheets).toHaveLength(3);
    expect(sheets[0].name).toBe('Сводка ГИТ');
    expect(sheets[0].rows).toHaveLength(9);

    const xlsxBuf = buildXlsxArrayBuffer(sheets);
    const parsedSheets = parseXlsxWorkbook(xlsxBuf);
    expect(parsedSheets.map((s) => s.name)).toEqual(['Сводка ГИТ', 'Выявленные пробелы', 'Методика']);

    const docxBlob = await exportGitReadinessDocx(report, { download: false });
    expect(docxBlob.size).toBeGreaterThan(1000);

    const pdfBlob = await exportGitReadinessPdf(report, { download: false });
    expect(pdfBlob.size).toBeGreaterThan(1000);
  });
});
