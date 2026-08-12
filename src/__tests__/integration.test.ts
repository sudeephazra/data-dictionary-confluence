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

    const result = await harness.invoke<TableData>('getTableData', {
      payload: { macroId: 'legacy-macro' },
    });

    expect(result.data).toEqual(legacyRecord);
    expect(await harness.storage.get('table:legacy-macro')).toEqual(legacyRecord);
  });
});
