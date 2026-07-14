import { createTestHarness } from '@forge/testing-framework';
import { handler } from '../resolvers/index';
import type { TableRow, SaveTableDataResponse, TableData, TableMetadata } from '../types';
import { getDefaultMetadata } from '../types';

const harness = createTestHarness({
  manifest: './manifest.yml',
  handlers: { resolver: handler },
});

const sampleMetadata: TableMetadata = {
  service: 'user-service',
  tableName: 'users',
  environment: 'production',
  businessReason: 'Stores user account data',
  loadType: 'Insert only',
};

beforeEach(() => {
  harness.reset();
});

describe('Integration: Redshift Data Dictionary', () => {
  it('saves data then retrieves it (full round-trip)', async () => {
    const rows: TableRow[] = [
      { id: 'r1', columnName: 'first_name', dataType: 'String', length: '100', nullable: false, sortPartitionKey: null, copyToRedshift: true, sampleValue: 'John', pii: true },
      { id: 'r2', columnName: 'age', dataType: 'Number', length: '', nullable: true, sortPartitionKey: null, copyToRedshift: true, sampleValue: '25', pii: false },
      { id: 'r3', columnName: 'is_active', dataType: 'Boolean', length: '', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: 'true', pii: false },
    ];

    // Save with sample metadata
    const saveResult = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { macroId: 'integration-macro', metadata: sampleMetadata, rows },
    });
    expect(saveResult.data.success).toBe(true);

    // Retrieve
    const getResult = await harness.invoke<TableData>('getTableData', {
      payload: { macroId: 'integration-macro' },
    });
    expect(getResult.data).not.toBeNull();
    expect(getResult.data.metadata).toEqual(sampleMetadata);
    expect(getResult.data.rows).toHaveLength(3);
    expect(getResult.data.rows[0]).toEqual(
      expect.objectContaining({ id: 'r1', columnName: 'first_name', dataType: 'String', length: '100' }),
    );
    expect(getResult.data.rows[1]).toEqual(
      expect.objectContaining({ id: 'r2', columnName: 'age', dataType: 'Number' }),
    );
    expect(getResult.data.rows[2]).toEqual(
      expect.objectContaining({ id: 'r3', columnName: 'is_active', dataType: 'Boolean' }),
    );
    expect(getResult.data.updatedAt).toBeDefined();
  });

  it('cold start returns null', async () => {
    const result = await harness.invoke<TableData | null>('getTableData', {
      payload: { macroId: 'never-saved' },
    });
    expect(result.data).toBeNull();
  });

  it('multiple macro instances are independent', async () => {
    const metadataA: TableMetadata = {
      service: 'auth-service',
      tableName: 'sessions',
      environment: 'staging',
      businessReason: 'Tracks user sessions',
      loadType: 'Insert only',
    };
    const metadataB: TableMetadata = {
      service: 'billing-service',
      tableName: 'invoices',
      environment: 'production',
      businessReason: 'Stores billing invoices',
      loadType: 'Updatable',
    };

    const rowsA: TableRow[] = [
      { id: 'a1', columnName: 'username', dataType: 'String', length: '50', nullable: false, sortPartitionKey: 'PartitionKey', copyToRedshift: true, sampleValue: 'jdoe', pii: true },
    ];
    const rowsB: TableRow[] = [
      { id: 'b1', columnName: 'count', dataType: 'Number', length: '', nullable: true, sortPartitionKey: null, copyToRedshift: false, sampleValue: '42', pii: false },
      { id: 'b2', columnName: 'enabled', dataType: 'Boolean', length: '', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: 'false', pii: false },
    ];

    // Save to macro A
    const saveA = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { macroId: 'macro-a', metadata: metadataA, rows: rowsA },
    });
    expect(saveA.data.success).toBe(true);

    // Save to macro B
    const saveB = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { macroId: 'macro-b', metadata: metadataB, rows: rowsB },
    });
    expect(saveB.data.success).toBe(true);

    // Retrieve macro A — should only have its own data and metadata
    const getA = await harness.invoke<TableData>('getTableData', {
      payload: { macroId: 'macro-a' },
    });
    expect(getA.data.rows).toHaveLength(1);
    expect(getA.data.rows[0].id).toBe('a1');
    expect(getA.data.rows[0].dataType).toBe('String');
    expect(getA.data.metadata).toEqual(metadataA);

    // Retrieve macro B — should only have its own data and metadata
    const getB = await harness.invoke<TableData>('getTableData', {
      payload: { macroId: 'macro-b' },
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
    expect(result.data).not.toBeNull();
    expect(result.data.rows).toHaveLength(1);
    expect(result.data.metadata).toEqual(getDefaultMetadata());
  });

  it('saves and retrieves metadata with all fields populated', async () => {
    const fullMetadata: TableMetadata = {
      service: 'analytics-platform',
      tableName: 'page_views',
      environment: 'production',
      businessReason: 'Tracks page view events for analytics dashboard',
      loadType: 'Updatable',
    };
    const rows: TableRow[] = [
      { id: 'f1', columnName: 'page_url', dataType: 'String', length: '2048', nullable: false, sortPartitionKey: 'SortKey', copyToRedshift: true, sampleValue: 'https://example.com', pii: false },
    ];

    // Save with fully populated metadata
    const saveResult = await harness.invoke<SaveTableDataResponse>('saveTableData', {
      payload: { macroId: 'full-metadata-macro', metadata: fullMetadata, rows },
    });
    expect(saveResult.data.success).toBe(true);

    // Retrieve and verify all metadata fields
    const getResult = await harness.invoke<TableData>('getTableData', {
      payload: { macroId: 'full-metadata-macro' },
    });
    expect(getResult.data).not.toBeNull();
    expect(getResult.data.metadata).toEqual(fullMetadata);
    expect(getResult.data.metadata.service).toBe('analytics-platform');
    expect(getResult.data.metadata.tableName).toBe('page_views');
    expect(getResult.data.metadata.environment).toBe('production');
    expect(getResult.data.metadata.businessReason).toBe('Tracks page view events for analytics dashboard');
    expect(getResult.data.metadata.loadType).toBe('Updatable');
    expect(getResult.data.rows).toHaveLength(1);
    expect(getResult.data.updatedAt).toBeDefined();
  });
});
