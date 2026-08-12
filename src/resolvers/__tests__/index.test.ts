import { createTestHarness } from '@forge/testing-framework';
import { kvs } from '@forge/kvs';
import { handler, validateRows } from '../index';
import type { TableRow, TableMetadata, SaveTableDataResponse, TableData } from '../../types';
import { getDefaultMetadata } from '../../types';

const harness = createTestHarness({
  manifest: './manifest.yml',
  handlers: { resolver: handler },
});

beforeEach(() => {
  harness.reset();
});

const defaultMetadata = getDefaultMetadata();

// ── Helper to build a valid row ──
function makeRow(overrides: Partial<TableRow> = {}): TableRow {
  return {
    id: 'row-1',
    columnName: 'test_column',
    dataType: 'Number',
    length: '',
    nullable: false,
    sortPartitionKey: null,
    copyToRedshift: false,
    sampleValue: 'test value',
    pii: false,
    ...overrides,
  };
}

// ── getTableData resolver ──
describe('getTableData', () => {
  it('returns null when no data exists (cold start)', async () => {
    const result = await harness.invoke<TableData | null>('getTableData', {
      payload: { macroId: 'macro-new' },
    });
    expect(result.data).toBeNull();
  });

  it('falls back to page-scoped data saved by an older release', async () => {
    await kvs.set('table:page-123:redshift-data-dictionary', {
      rows: [makeRow({ id: 'legacy-row', columnName: 'legacy_column' })],
      updatedAt: '2025-01-01T00:00:00.000Z',
    });

    const result = await harness.invoke<TableData>('getTableData', {
      payload: {
        storageKey: 'page-123:redshift-data-dictionary:macro-1',
        legacyStorageKey: 'page-123:redshift-data-dictionary',
      },
    });

    expect(result.data.rows[0].columnName).toBe('legacy_column');
    expect(result.data.metadata).toEqual(getDefaultMetadata());
  });
});

// ── saveTableData resolver ──
describe('saveTableData', () => {
  it('saves valid rows and getTableData retrieves them', async () => {
    const rows: TableRow[] = [
      makeRow({ id: 'r1', columnName: 'name', dataType: 'String', length: '10', sampleValue: 'John' }),
    ];

    const saveResult = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { macroId: 'macro-1', metadata: defaultMetadata, rows },
    });
    expect(saveResult.data.success).toBe(true);
    expect(saveResult.data.errors).toBeUndefined();

    const getResult = await harness.invoke<TableData>('getTableData', {
      payload: { macroId: 'macro-1' },
    });
    expect(getResult.data).not.toBeNull();
    expect(getResult.data.rows).toHaveLength(1);
    expect(getResult.data.rows[0].columnName).toBe('name');
    expect(getResult.data.rows[0].dataType).toBe('String');
    expect(getResult.data.rows[0].length).toBe('10');
    expect(getResult.data.updatedAt).toBeDefined();
    expect(getResult.data.metadata).toEqual(defaultMetadata);
  });

  it('persists data with a page-scoped storage key', async () => {
    const rows: TableRow[] = [makeRow({ id: 'r1', columnName: 'persisted', dataType: 'String', length: '12', sampleValue: 'ok' })];

    const saveResult = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { storageKey: 'page-123:redshift-data-dictionary', metadata: defaultMetadata, rows },
    });
    expect(saveResult.data.success).toBe(true);

    const getResult = await harness.invoke<TableData>('getTableData', {
      payload: { storageKey: 'page-123:redshift-data-dictionary', macroId: 'legacy-macro' },
    });
    expect(getResult.data).not.toBeNull();
    expect(getResult.data.rows[0].columnName).toBe('persisted');
  });

  it('keeps separate data for different macro instances on the same page', async () => {
    const firstRows: TableRow[] = [makeRow({ id: 'r1', columnName: 'first_macro', dataType: 'String', length: '8', sampleValue: 'one' })];
    const secondRows: TableRow[] = [makeRow({ id: 'r2', columnName: 'second_macro', dataType: 'String', length: '8', sampleValue: 'two' })];

    await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { storageKey: 'page-123:macro-1', macroId: 'macro-1', metadata: defaultMetadata, rows: firstRows },
    });

    await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { storageKey: 'page-123:macro-2', macroId: 'macro-2', metadata: defaultMetadata, rows: secondRows },
    });

    const firstResult = await harness.invoke<TableData>('getTableData', {
      payload: { storageKey: 'page-123:macro-1', macroId: 'macro-1' },
    });
    const secondResult = await harness.invoke<TableData>('getTableData', {
      payload: { storageKey: 'page-123:macro-2', macroId: 'macro-2' },
    });

    expect(firstResult.data?.rows[0].columnName).toBe('first_macro');
    expect(secondResult.data?.rows[0].columnName).toBe('second_macro');
  });

  it('returns validation errors when dataType is missing', async () => {
    const rows: TableRow[] = [makeRow({ id: 'r1', dataType: null })];

    const result = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { macroId: 'macro-1', metadata: defaultMetadata, rows },
    });
    expect(result.data.success).toBe(false);
    expect(result.data.errors).toBeDefined();
    expect(result.data.errors).toContainEqual(
      expect.objectContaining({ rowId: 'r1', field: 'dataType', message: 'DataType is required' }),
    );
  });

  it('returns validation errors when dataType is "String" but length is empty', async () => {
    const rows: TableRow[] = [makeRow({ id: 'r1', dataType: 'String', length: '' })];

    const result = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { macroId: 'macro-1', metadata: defaultMetadata, rows },
    });
    expect(result.data.success).toBe(false);
    expect(result.data.errors).toContainEqual(
      expect.objectContaining({
        rowId: 'r1',
        field: 'length',
        message: 'Length is required when DataType is "String"',
      }),
    );
  });

  it('returns validation errors when length is not a positive integer', async () => {
    const invalidLengths = ['abc', '-1', '0', '3.5'];

    for (const length of invalidLengths) {
      harness.reset();
      const rows: TableRow[] = [makeRow({ id: 'r1', dataType: 'Number', length })];

      const result = await harness.invoke<SaveTableDataResponse>('saveTableData', {
        payload: { macroId: 'macro-1', metadata: defaultMetadata, rows },
      });
      expect(result.data.success).toBe(false);
      expect(result.data.errors).toContainEqual(
        expect.objectContaining({
          rowId: 'r1',
          field: 'length',
          message: 'Length must be a positive integer',
        }),
      );
    }
  });

  it('accepts valid rows with non-string type and empty length', async () => {
    const rows: TableRow[] = [makeRow({ id: 'r1', dataType: 'Boolean', length: '' })];

    const result = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { macroId: 'macro-1', metadata: defaultMetadata, rows },
    });
    expect(result.data.success).toBe(true);
    expect(result.data.errors).toBeUndefined();
  });

  it('accepts valid rows with non-string type and valid length', async () => {
    const rows: TableRow[] = [makeRow({ id: 'r1', dataType: 'Number', length: '5' })];

    const result = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { macroId: 'macro-1', metadata: defaultMetadata, rows },
    });
    expect(result.data.success).toBe(true);
    expect(result.data.errors).toBeUndefined();
  });

  it('returns validation errors when columnName is empty', async () => {
    const rows: TableRow[] = [makeRow({ id: 'r1', columnName: '' })];

    const result = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { macroId: 'macro-1', metadata: defaultMetadata, rows },
    });
    expect(result.data.success).toBe(false);
    expect(result.data.errors).toContainEqual(
      expect.objectContaining({ rowId: 'r1', field: 'columnName', message: 'Column Name is required' }),
    );
  });

  it('returns validation errors when sampleValue is empty', async () => {
    const rows: TableRow[] = [makeRow({ id: 'r1', sampleValue: '' })];

    const result = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { macroId: 'macro-1', metadata: defaultMetadata, rows },
    });
    expect(result.data.success).toBe(false);
    expect(result.data.errors).toContainEqual(
      expect.objectContaining({ rowId: 'r1', field: 'sampleValue', message: 'Sample Value is required' }),
    );
  });

  it('returns default metadata for legacy records without metadata field', async () => {
    // Directly write a legacy record (without metadata) to KVS
    await kvs.set('table:legacy-macro', {
      rows: [makeRow({ id: 'r1' })],
      updatedAt: '2025-01-01T00:00:00.000Z',
    });

    const result = await harness.invoke<TableData>('getTableData', {
      payload: { macroId: 'legacy-macro' },
    });
    expect(result.data).not.toBeNull();
    expect(result.data.metadata).toEqual(getDefaultMetadata());
    expect(result.data.rows).toHaveLength(1);
    expect(result.data.updatedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('saves and retrieves metadata correctly', async () => {
    const customMetadata: TableMetadata = {
      service: 'billing-service',
      tableName: 'invoices',
      environment: 'production',
      businessReason: 'Revenue tracking',
      loadType: 'Insert only',
    };
    const rows: TableRow[] = [
      makeRow({ id: 'r1', columnName: 'invoice_id', dataType: 'String', length: '36', sampleValue: 'uuid-123' }),
    ];

    const saveResult = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { macroId: 'macro-meta', metadata: customMetadata, rows },
    });
    expect(saveResult.data.success).toBe(true);

    const getResult = await harness.invoke<TableData>('getTableData', {
      payload: { macroId: 'macro-meta' },
    });
    expect(getResult.data).not.toBeNull();
    expect(getResult.data.metadata).toEqual(customMetadata);
    expect(getResult.data.rows).toHaveLength(1);
    expect(getResult.data.rows[0].columnName).toBe('invoice_id');
  });
});

// ── validateRows direct tests ──
describe('validateRows', () => {
  it('returns empty array for valid rows', () => {
    const rows: TableRow[] = [
      makeRow({ id: 'r1', dataType: 'String', length: '255' }),
      makeRow({ id: 'r2', dataType: 'Number', length: '' }),
      makeRow({ id: 'r3', dataType: 'Boolean', length: '' }),
    ];
    const errors = validateRows(rows);
    expect(errors).toEqual([]);
  });

  it('returns error when dataType is null', () => {
    const errors = validateRows([makeRow({ id: 'r1', dataType: null })]);
    expect(errors).toContainEqual(
      expect.objectContaining({ rowId: 'r1', field: 'dataType', message: 'DataType is required' }),
    );
  });

  it('returns error for invalid dataType value', () => {
    // Force an invalid dataType value
    const row = makeRow({ id: 'r1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (row as any).dataType = 'InvalidType';
    const errors = validateRows([row]);
    expect(errors).toContainEqual(
      expect.objectContaining({ rowId: 'r1', field: 'dataType', message: 'Invalid DataType value' }),
    );
  });

  it('returns length-required error for String type with empty length', () => {
    const errors = validateRows([makeRow({ id: 'r1', dataType: 'String', length: '' })]);
    expect(errors).toContainEqual(
      expect.objectContaining({
        rowId: 'r1',
        field: 'length',
        message: 'Length is required when DataType is "String"',
      }),
    );
  });

  it('validates length as positive integer when provided', () => {
    const badValues = ['abc', '-1', '0', '3.5', '1e2', ' 5', '5 '];
    for (const length of badValues) {
      const errors = validateRows([makeRow({ id: 'r1', dataType: 'Number', length })]);
      expect(errors).toContainEqual(
        expect.objectContaining({
          rowId: 'r1',
          field: 'length',
          message: 'Length must be a positive integer',
        }),
      );
    }
  });

  it('accepts valid positive integer lengths', () => {
    const goodValues = ['1', '10', '255', '9999'];
    for (const length of goodValues) {
      const errors = validateRows([makeRow({ id: 'r1', dataType: 'Number', length })]);
      const lengthErrors = errors.filter((e) => e.field === 'length');
      expect(lengthErrors).toHaveLength(0);
    }
  });

  it('can return multiple errors for the same row', () => {
    const row = makeRow({ id: 'r1', columnName: '', dataType: null, length: '-5', sampleValue: '' });
    const errors = validateRows([row]);
    expect(errors.filter((e) => e.rowId === 'r1').length).toBeGreaterThanOrEqual(3);
  });

  it('validates each row independently', () => {
    const rows: TableRow[] = [
      makeRow({ id: 'r1', dataType: 'String', length: '10' }), // valid
      makeRow({ id: 'r2', dataType: null, length: '' }), // invalid
    ];
    const errors = validateRows(rows);
    expect(errors.filter((e) => e.rowId === 'r1')).toHaveLength(0);
    expect(errors.filter((e) => e.rowId === 'r2').length).toBeGreaterThan(0);
  });

  it('returns empty array for empty rows array', () => {
    const errors = validateRows([]);
    expect(errors).toEqual([]);
  });

  it('returns error when columnName is empty', () => {
    const errors = validateRows([makeRow({ id: 'r1', columnName: '' })]);
    expect(errors).toContainEqual(
      expect.objectContaining({ rowId: 'r1', field: 'columnName', message: 'Column Name is required' }),
    );
  });

  it('returns error when sampleValue is empty', () => {
    const errors = validateRows([makeRow({ id: 'r1', sampleValue: '' })]);
    expect(errors).toContainEqual(
      expect.objectContaining({ rowId: 'r1', field: 'sampleValue', message: 'Sample Value is required' }),
    );
  });
});
