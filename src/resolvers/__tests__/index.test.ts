import { createTestHarness } from '@forge/testing-framework';
import { kvs } from '@forge/kvs';
import { handler, validateRows } from '../index';
import type { SaveTableDataResponse, TableData, TableRow } from '../../types';
import { getDefaultMetadata } from '../../types';

const harness = createTestHarness({
  manifest: './manifest.yml',
  handlers: { resolver: handler },
});

function makeRow(overrides: Partial<TableRow> = {}): TableRow {
  return {
    id: 'row-1',
    columnName: 'user_id',
    dataType: 'String',
    length: '255',
    nullable: false,
    sortPartitionKey: 'PartitionKey',
    copyToRedshift: true,
    sampleValue: 'abc-123',
    pii: true,
    ...overrides,
  };
}

beforeEach(() => {
  harness.reset();
  jest.restoreAllMocks();
});

describe('getTableData', () => {
  it('returns null on a cold start', async () => {
    const result = await harness.invoke<TableData | null>('getTableData', {
      payload: { macroId: 'never-saved' },
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

  it('normalizes records created before metadata was introduced', async () => {
    await kvs.set('table:legacy-macro', {
      rows: [makeRow()],
      updatedAt: '2025-01-01T00:00:00.000Z',
    });

    const result = await harness.invoke<TableData>('getTableData', {
      payload: { macroId: 'legacy-macro' },
    });

    expect(result.data.rows).toEqual([makeRow()]);
    expect(result.data.metadata).toEqual(getDefaultMetadata());
  });
});

describe('saveTableData', () => {
  it('saves valid rows under the requested macro-instance key', async () => {
    const rows = [makeRow()];
    const storageKey = 'page-123:redshift-data-dictionary:macro-1';

    const saved = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { storageKey, metadata: getDefaultMetadata(), rows },
    });
    const loaded = await harness.invoke<TableData>('getTableData', {
      payload: { storageKey },
    });

    expect(saved.data).toEqual({ success: true });
    expect(loaded.data.rows).toEqual(rows);
    expect(loaded.data.metadata).toEqual(getDefaultMetadata());
    expect(loaded.data.updatedAt).toEqual(expect.any(String));
  });

  it('returns useful validation errors and does not persist invalid rows', async () => {
    const invalidRow = makeRow({ columnName: '', dataType: null, length: '', sampleValue: '' });
    const storageKey = 'page-123:redshift-data-dictionary:invalid';

    const result = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { storageKey, metadata: getDefaultMetadata(), rows: [invalidRow] },
    });

    expect(result.data.success).toBe(false);
    expect(result.data.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'columnName' }),
      expect.objectContaining({ field: 'dataType' }),
      expect.objectContaining({ field: 'sampleValue' }),
    ]));
    expect(await kvs.get(`table:${storageKey}`)).toBeUndefined();
  });
});

describe('validateRows', () => {
  it('enforces Redshift string length and positive-integer rules', () => {
    expect(validateRows([makeRow({ length: '65536' })])).toContainEqual(
      expect.objectContaining({ field: 'length', message: 'String length cannot be greater than 65535' }),
    );
    expect(validateRows([makeRow({ dataType: 'Number', length: '3.5' })])).toContainEqual(
      expect.objectContaining({ field: 'length', message: 'Length must be a positive integer' }),
    );
  });

  it('enforces the declared String length for sample values', () => {
    expect(validateRows([makeRow({ length: '10', sampleValue: '12345678901' })])).toContainEqual(
      expect.objectContaining({
        field: 'sampleValue',
        message: 'Sample value exceeds the maximum length of 10 characters.',
      }),
    );
    expect(validateRows([makeRow({ length: '10', sampleValue: '1234567890' })])).not.toContainEqual(
      expect.objectContaining({ field: 'sampleValue' }),
    );
  });
});

describe('logError', () => {
  it('writes structured frontend errors to Forge logs', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await harness.invoke<{ success: boolean }>('logError', {
      payload: {
        message: 'UI failed',
        stack: 'stack trace',
        timestamp: '2026-08-12T00:00:00.000Z',
      },
    });

    expect(result.data).toEqual({ success: true });
    expect(errorSpy).toHaveBeenCalledWith('[Frontend Error]', expect.objectContaining({
      message: 'UI failed',
      stack: 'stack trace',
    }));
  });
});
