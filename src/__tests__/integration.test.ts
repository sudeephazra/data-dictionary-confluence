import { createTestHarness } from '@forge/testing-framework';
import { handler } from '../resolvers';
import type { TableData, TableMetadata, TableRow } from '../types';
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
    const serialized = serializeMacroTableData(metadata, rows);
    const parsed = parseMacroTableData(serialized);

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

describe('legacy KVS transition', () => {
  it('keeps existing records readable until the macro is edited and saved with the page', async () => {
    const legacyRecord: TableData = {
      metadata,
      rows,
      updatedAt: '2026-07-15T00:00:00.000Z',
    };
    await harness.storage.set('table:legacy-macro', legacyRecord);

    const rowsA: TableRow[] = [
      { id: 'a1', columnName: 'username', dataType: 'String', length: '50', nullable: false, sortPartitionKey: 'PartitionKey', copyToRedshift: true, sampleValue: 'jdoe', pii: true },
    ];
    const rowsB: TableRow[] = [
      { id: 'b1', columnName: 'count', dataType: 'Number', length: '', nullable: true, sortPartitionKey: null, copyToRedshift: false, sampleValue: '42', pii: false },
      { id: 'b2', columnName: 'enabled', dataType: 'Boolean', length: '', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: 'false', pii: false },
    ];

    // Save to macro A
    const saveA = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { storageKey: 'page-123:redshift-data-dictionary:macro-a', metadata: metadataA, rows: rowsA },
    });
    expect(saveA.data.success).toBe(true);

    // Save to macro B
    const saveB = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { storageKey: 'page-123:redshift-data-dictionary:macro-b', metadata: metadataB, rows: rowsB },
    });
    expect(saveB.data.success).toBe(true);

    // Retrieve macro A — should only have its own data and metadata
    const getA = await harness.invoke<TableData>('getTableData', {
      payload: { storageKey: 'page-123:redshift-data-dictionary:macro-a' },
    });
    expect(getA.data.rows).toHaveLength(1);
    expect(getA.data.rows[0].id).toBe('a1');
    expect(getA.data.rows[0].dataType).toBe('String');
    expect(getA.data.metadata).toEqual(metadataA);

    // Retrieve macro B — should only have its own data and metadata
    const getB = await harness.invoke<TableData>('getTableData', {
      payload: { storageKey: 'page-123:redshift-data-dictionary:macro-b' },
    });
    expect(getB.data.rows).toHaveLength(2);
    expect(getB.data.rows[0].id).toBe('b1');
    expect(getB.data.rows[1].id).toBe('b2');
    expect(getB.data.metadata).toEqual(metadataB);
  });

  it('backward compatibility: legacy records without metadata return defaults', async () => {
    // Directly write a legacy KVS record WITHOUT a metadata field
    await harness.storage.set('table:legacy-macro', {
      rows: [
        { id: 'l1', columnName: 'email', dataType: 'String', length: '255', nullable: false, sortPartitionKey: null, copyToRedshift: true, sampleValue: 'test@example.com', pii: true },
      ],
      updatedAt: '2025-01-01T00:00:00.000Z',
    });

    // Retrieve via resolver — should backfill default metadata
    const result = await harness.invoke<TableData>('getTableData', {
      payload: { macroId: 'legacy-macro' },
    });

    expect(result.data).toEqual(legacyRecord);
    expect(await harness.storage.get('table:legacy-macro')).toEqual(legacyRecord);
  });
});
