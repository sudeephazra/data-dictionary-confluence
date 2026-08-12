import { createTestHarness } from '@forge/testing-framework';
import { handler } from '../resolvers';
import type { SaveTableDataResponse, TableData, TableMetadata, TableRow } from '../types';
import {
  getDefaultMetadata,
  parseMacroTableData,
  serializeMacroTableData,
} from '../types';

const harness = createTestHarness({
  manifest: './manifest.yml',
  handlers: { resolver: handler },
});

const metadata: TableMetadata = {
  ...getDefaultMetadata(),
  service: 'analytics-platform',
  tableName: 'page_views',
  environment: 'production',
  businessReason: 'Tracks page view events',
  loadType: 'Updatable',
  contactNameEmail: 'Owner (owner@example.com)',
  teamNameEmail: 'Analytics Team (analytics@example.com)',
  managerNameEmail: 'Manager (manager@example.com)',
};

const rows: TableRow[] = [
  {
    id: 'row-1',
    columnName: 'page_url',
    dataType: 'String',
    length: '2048',
    nullable: false,
    sortPartitionKey: 'SortKey',
    copyToRedshift: true,
    sampleValue: 'https://example.com',
    pii: false,
  },
  {
    id: 'row-2',
    columnName: 'properties',
    dataType: 'JSON',
    length: '',
    nullable: true,
    sortPartitionKey: null,
    copyToRedshift: false,
    sampleValue: '{"source":"email"}',
    pii: true,
  },
];

beforeEach(() => {
  harness.reset();
});

describe('Confluence page-owned table configuration', () => {
  it('round-trips nested rows and nullable values through one config string', () => {
    const parsed = parseMacroTableData(serializeMacroTableData(metadata, rows));

    expect(parsed?.metadata).toEqual(metadata);
    expect(parsed?.rows).toEqual(rows);
    expect(parsed?.updatedAt).toEqual(expect.any(String));
  });

  it.each([
    undefined,
    '',
    'not-json',
    JSON.stringify({ version: 2, metadata, rows, updatedAt: 'now' }),
    JSON.stringify({ version: 1, metadata, rows: 'not-an-array', updatedAt: 'now' }),
  ])('rejects malformed or unsupported configuration: %p', (value) => {
    expect(parseMacroTableData(value)).toBeNull();
  });
});

describe('macro-instance storage isolation', () => {
  it('keeps two macros on one page independent', async () => {
    const firstKey = 'page-123:redshift-data-dictionary:macro-a';
    const secondKey = 'page-123:redshift-data-dictionary:macro-b';
    const firstRows = [rows[0]];
    const secondRows = [rows[1]];
    const secondMetadata = { ...metadata, tableName: 'event_properties' };

    const firstSave = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { storageKey: firstKey, metadata, rows: firstRows },
    });
    const secondSave = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { storageKey: secondKey, metadata: secondMetadata, rows: secondRows },
    });

    const first = await harness.invoke<TableData>('getTableData', { payload: { storageKey: firstKey } });
    const second = await harness.invoke<TableData>('getTableData', { payload: { storageKey: secondKey } });

    expect(firstSave.data.success).toBe(true);
    expect(secondSave.data.success).toBe(true);
    expect(first.data.rows).toEqual(firstRows);
    expect(first.data.metadata).toEqual(metadata);
    expect(second.data.rows).toEqual(secondRows);
    expect(second.data.metadata).toEqual(secondMetadata);
  });

  it('reads page-scoped legacy data through the migration fallback', async () => {
    const legacyKey = 'page-123:redshift-data-dictionary';
    const currentKey = `${legacyKey}:macro-new`;
    const legacyRecord: TableData = {
      metadata,
      rows,
      updatedAt: '2026-07-15T00:00:00.000Z',
    };
    await harness.storage.set(`table:${legacyKey}`, legacyRecord);

    const result = await harness.invoke<TableData>('getTableData', {
      payload: { storageKey: currentKey, legacyStorageKey: legacyKey },
    });

    expect(result.data).toEqual(legacyRecord);
    expect(await harness.storage.get(`table:${currentKey}`)).toBeUndefined();
  });
});

describe('sample-value validation', () => {
  it('rejects a String sample value longer than the declared column length', async () => {
    const storageKey = 'page-123:redshift-data-dictionary:invalid-sample';
    const result = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: {
        storageKey,
        metadata,
        rows: [{ ...rows[0], length: '10', sampleValue: '12345678901' }],
      },
    });

    expect(result.data.success).toBe(false);
    expect(result.data.errors).toContainEqual(expect.objectContaining({
      field: 'sampleValue',
      message: 'Sample value exceeds the maximum length of 10 characters.',
    }));
    expect(await harness.storage.get(`table:${storageKey}`)).toBeUndefined();
  });
});
