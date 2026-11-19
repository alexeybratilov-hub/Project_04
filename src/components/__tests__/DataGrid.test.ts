import { describe, expect, it } from 'vitest';
import {
  clampColumnWidth,
  DEFAULT_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  NARROW_HEADER_BREAKPOINT,
} from '../DataGrid';

describe('DataGrid column header width invariants (T-38)', () => {
  it('uses expected sizing constants for narrow headers and clamping', () => {
    expect(MIN_COLUMN_WIDTH).toBe(88);
    expect(MAX_COLUMN_WIDTH).toBe(800);
    expect(DEFAULT_COLUMN_WIDTH).toBe(180);
    expect(NARROW_HEADER_BREAKPOINT).toBeGreaterThan(MIN_COLUMN_WIDTH);
    expect(NARROW_HEADER_BREAKPOINT).toBe(120);
  });

  it('clamps below minimum and above maximum column widths', () => {
    expect(clampColumnWidth(0)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(-40)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(60)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(88)).toBe(88);
    expect(clampColumnWidth(800)).toBe(800);
    expect(clampColumnWidth(1200)).toBe(MAX_COLUMN_WIDTH);
  });

  it('falls back to DEFAULT_COLUMN_WIDTH for undefined or non-finite values and rounds floats', () => {
    expect(clampColumnWidth(undefined)).toBe(DEFAULT_COLUMN_WIDTH);
    expect(clampColumnWidth(Number.NaN)).toBe(DEFAULT_COLUMN_WIDTH);
    expect(clampColumnWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_COLUMN_WIDTH);
    expect(clampColumnWidth(145.6)).toBe(146);
    expect(clampColumnWidth(145.2)).toBe(145);
  });
});
