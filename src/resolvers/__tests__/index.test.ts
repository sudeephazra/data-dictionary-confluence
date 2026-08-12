import { createTestHarness } from '@forge/testing-framework';
import { kvs } from '@forge/kvs';
import { handler } from '../index';
import type { TableData, TableMetadata, TableRow } from '../../types';
import { getDefaultMetadata } from '../../types';

const harness = createTestHarness({
  manifest: './manifest.yml',
  handlers: { resolver: handler },
});

const metadata: TableMetadata = {
  ...getDefaultMetadata(),
  service: 'legacy-service',
  tableName: 'legacy-table',
};

const rows: TableRow[] = [{
  id: 'row-1',
  columnName: 'user_id',
  dataType: 'String',
  length: '255',
  nullable: false,
  sortPartitionKey: 'PartitionKey',
  copyToRedshift: true,
  sampleValue: 'abc-123',
  pii: true,
}];

beforeEach(() => {
  harness.reset();
  jest.restoreAllMocks();
});

describe('getTableData legacy migration reader', () => {
  it('returns null on a cold start', async () => {
    const result = await harness.invoke<TableData | null>('getTableData', {
      payload: { macroId: 'never-saved' },
    });
    expect(result.data).toBeNull();
  });

  it('falls back to page-scoped data saved by an older release', async () => {
    await kvs.set('table:page-123:redshift-data-dictionary', {
      rows: [{ ...rows[0], id: 'legacy-row', columnName: 'legacy_column' }],
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
  it('returns null when no storage key is available', async () => {
    const result = await harness.invoke<TableData | null>('getTableData', { payload: {} });

    expect(result.data).toBeNull();
  });

  it('reads an existing page-scoped KVS record without changing it', async () => {
    const stored: TableData = {
      metadata,
      rows,
      updatedAt: '2026-07-15T00:00:00.000Z',
    };
    await kvs.set('table:page-123:redshift-data-dictionary', stored);

    const result = await harness.invoke<TableData>('getTableData', {
      payload: { storageKey: 'page-123:redshift-data-dictionary' },
    });

    expect(result.data).toEqual(stored);
    expect(await kvs.get('table:page-123:redshift-data-dictionary')).toEqual(stored);
  });

  it('falls back to the old macro ID when the page-scoped key has no data', async () => {
    const stored: TableData = {
      metadata,
      rows,
      updatedAt: '2026-07-15T00:00:00.000Z',
    };
    await kvs.set('table:legacy-macro-id', stored);

    const result = await harness.invoke<TableData>('getTableData', {
      payload: {
        storageKey: 'page-123:redshift-data-dictionary:new-id',
        macroId: 'legacy-macro-id',
      },
    });

    expect(result.data).toEqual(stored);
  });

  it('backfills metadata for records created before metadata was introduced', async () => {
    await kvs.set('table:legacy-without-metadata', {
      rows,
      updatedAt: '2025-01-01T00:00:00.000Z',
    });

    const result = await harness.invoke<TableData>('getTableData', {
      payload: { macroId: 'legacy-without-metadata' },
    });

    expect(result.data.rows).toEqual(rows);
    expect(result.data.metadata).toEqual(getDefaultMetadata());
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
