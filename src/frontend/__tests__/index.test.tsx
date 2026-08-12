import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bridge } from '@forge/bridge';
import { createFrontendContext } from '@forge/testing-framework';
import { App } from '../index';
import type { TableRow, TableMetadata, TableData, SaveTableDataResponse } from '../../types';
import { getDefaultMetadata } from '../../types';

const TEST_MACRO_ID = 'test-macro-id';
const TEST_CONTENT_ID = 'page-123';
const TEST_MODULE_KEY = 'redshift-data-dictionary';
const TEST_STORAGE_KEY = `${TEST_CONTENT_ID}:${TEST_MODULE_KEY}:${TEST_MACRO_ID}`;
const TEST_LEGACY_STORAGE_KEY = `${TEST_CONTENT_ID}:${TEST_MODULE_KEY}`;

function setupContext(overrides?: Record<string, unknown>): void {
  bridge.setContext(
    createFrontendContext('confluence:macro', {
      localId: TEST_MACRO_ID,
      moduleKey: TEST_MODULE_KEY,
      extension: {
        content: { id: TEST_CONTENT_ID },
        ...overrides,
      },
    }),
  );
}

function mockGetTableData(rows: TableRow[] = [], metadata: TableMetadata = getDefaultMetadata()): void {
  const data: TableData = { metadata, rows, updatedAt: new Date().toISOString() };
  bridge.mockInvoke('getTableData', data);
}

function mockSaveTableData(response: SaveTableDataResponse = { success: true }): void {
  bridge.mockInvoke('saveTableData', response);
}

describe('App', () => {
  beforeEach(() => {
    bridge.reset();
    delete (window as unknown as Record<string, unknown>).__FORGE_PREVIEW__;
  });

  it('renders loading spinner initially then shows data after invoke resolves', async () => {
    setupContext();
    mockGetTableData([
      { id: 'row-1', columnName: 'user_id', dataType: 'String', length: '100', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: 'test', pii: false },
    ]);

    render(<App />);

    // Spinner should be present initially
    expect(screen.getByTestId('forge-spinner')).toBeInTheDocument();

    // After data loads, spinner should be gone
    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });
  });

  it('shows mock data in preview mode without calling invoke', async () => {
    (window as unknown as Record<string, unknown>).__FORGE_PREVIEW__ = true;
    setupContext();

    render(<App />);

    // In preview mode, no invoke calls should be made
    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    // Should not have called getTableData
    expect(bridge.invocations).toHaveLength(0);
  });

  it('renders the table UI when macro context is unavailable', async () => {
    bridge.setContext(createFrontendContext('confluence:macro', { extension: {} }));

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    expect(screen.getByText(/No rows yet/i)).toBeInTheDocument();
  });

  it('loads data with a page- and macro-instance-scoped storage key', async () => {
    setupContext();
    mockGetTableData([]);

    render(<App />);

    await waitFor(() => {
      expect(bridge.invocations).toContainEqual(
        expect.objectContaining({
          functionKey: 'getTableData',
          payload: expect.objectContaining({
            storageKey: TEST_STORAGE_KEY,
            legacyStorageKey: TEST_LEGACY_STORAGE_KEY,
          }),
        }),
      );
    });
  });

  it('Add Row button adds a new empty row', async () => {
    setupContext();
    mockGetTableData([]);

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    // Find and click the Add Row button
    const addButton = screen.getByText('Add Row');
    await userEvent.click(addButton);

    // Should now have Select elements rendered for the new row (DataType + Sort/Partition Key)
    await waitFor(() => {
      const selects = screen.getAllByTestId('forge-select');
      expect(selects.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('Save button triggers validation and shows errors for empty columnName', async () => {
    setupContext();
    mockGetTableData([
      { id: 'row-1', columnName: '', dataType: null, length: '', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: '', pii: false },
    ]);
    mockSaveTableData();

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    // Click Save
    const saveButton = screen.getByText('Save');
    await userEvent.click(saveButton);

    // Validation errors should appear
    await waitFor(() => {
      expect(screen.getByText('Column Name is required')).toBeInTheDocument();
      expect(screen.getByText('DataType is required')).toBeInTheDocument();
      expect(screen.getByText('Sample Value is required')).toBeInTheDocument();
    });

    // invoke('saveTableData') should NOT have been called
    expect(
      bridge.invocations.filter((inv) => inv.functionKey === 'saveTableData'),
    ).toHaveLength(0);
  });

  it('Save button calls saveTableData when validation passes', async () => {
    setupContext();
    const validRow: TableRow = { id: 'row-1', columnName: 'user_id', dataType: 'String', length: '255', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: 'test value', pii: false };
    mockGetTableData([validRow]);
    mockSaveTableData({ success: true });

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    const saveButton = screen.getByText('Save');
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(bridge.invocations).toContainEqual(
        expect.objectContaining({
          functionKey: 'saveTableData',
          payload: expect.objectContaining({
            storageKey: TEST_STORAGE_KEY,
            metadata: getDefaultMetadata(),
            rows: [validRow],
          }),
        }),
      );
    });
  });

  it('displays success message after successful save', async () => {
    setupContext();
    mockGetTableData([
      { id: 'row-1', columnName: 'age', dataType: 'Number', length: '', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: '25', pii: false },
    ]);
    mockSaveTableData({ success: true });

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    const saveButton = screen.getByText('Save');
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Table saved successfully')).toBeInTheDocument();
    });
  });

  it('displays error message when save fails', async () => {
    setupContext();
    mockGetTableData([
      { id: 'row-1', columnName: 'is_active', dataType: 'Boolean', length: '', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: 'true', pii: false },
    ]);
    mockSaveTableData({ success: false });

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    const saveButton = screen.getByText('Save');
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Failed to save table data')).toBeInTheDocument();
    });
  });

  it('Delete button removes a row', async () => {
    setupContext();
    mockGetTableData([
      { id: 'row-1', columnName: 'user_id', dataType: 'String', length: '50', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: 'abc', pii: false },
      { id: 'row-2', columnName: 'age', dataType: 'Number', length: '', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: '25', pii: false },
    ]);
    mockSaveTableData();

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    // Should have 2 delete buttons (one per row)
    const deleteButtons = screen.getAllByText('✕');
    expect(deleteButtons).toHaveLength(2);

    // Click the first delete button
    await userEvent.click(deleteButtons[0]);

    // Now should only have 1 delete button
    await waitFor(() => {
      expect(screen.getAllByText('✕')).toHaveLength(1);
    });
  });

  it('validates length as positive integer when provided', async () => {
    setupContext();
    mockGetTableData([
      { id: 'row-1', columnName: 'age', dataType: 'Number', length: '-5', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: '25', pii: false },
    ]);
    mockSaveTableData();

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    const saveButton = screen.getByText('Save');
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Length must be a positive integer')).toBeInTheDocument();
    });
  });

  it('validates length is required when dataType is String', async () => {
    setupContext();
    mockGetTableData([
      { id: 'row-1', columnName: 'name', dataType: 'String', length: '', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: 'John', pii: false },
    ]);
    mockSaveTableData();

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    const saveButton = screen.getByText('Save');
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/Length is required when DataType is/)).toBeInTheDocument();
    });
  });

  it('validates sampleValue is required', async () => {
    setupContext();
    mockGetTableData([
      { id: 'row-1', columnName: 'age', dataType: 'Number', length: '', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: '', pii: false },
    ]);
    mockSaveTableData();

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    const saveButton = screen.getByText('Save');
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Sample Value is required')).toBeInTheDocument();
    });
  });

  it('renders metadata header section with labels', async () => {
    setupContext();
    mockGetTableData([]);

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Table Metadata')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Table Name')).toBeInTheDocument();
    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.getByText('Business Reason')).toBeInTheDocument();
    expect(screen.getByText('Load Type')).toBeInTheDocument();
  });

  it('renders metadata fields from loaded data', async () => {
    setupContext();
    const customMetadata: TableMetadata = {
      service: 'order-service',
      tableName: 'orders',
      environment: 'staging',
      businessReason: 'Tracks customer orders',
      loadType: 'Updatable',
    };
    mockGetTableData([], customMetadata);

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    await waitFor(() => {
      const textfields = screen.getAllByTestId('forge-textfield');
      const values = textfields.map((el) => el.getAttribute('value'));
      expect(values).toContain('order-service');
      expect(values).toContain('orders');
      expect(values).toContain('Tracks customer orders');
    });

    const selects = screen.getAllByTestId('forge-select');
    expect(selects.some((select) => select.getAttribute('data-options')?.includes('staging'))).toBe(true);
  });

  it('includes metadata in save payload', async () => {
    setupContext();
    const customMetadata: TableMetadata = {
      service: 'payment-service',
      tableName: 'payments',
      environment: 'production',
      businessReason: 'Payment records',
      loadType: 'Insert only',
    };
    const validRow: TableRow = { id: 'row-1', columnName: 'amount', dataType: 'Number', length: '', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: '100', pii: false };
    mockGetTableData([validRow], customMetadata);
    mockSaveTableData({ success: true });

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    const saveButton = screen.getByText('Save');
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(bridge.invocations).toContainEqual(
        expect.objectContaining({
          functionKey: 'saveTableData',
          payload: expect.objectContaining({
            storageKey: TEST_STORAGE_KEY,
            metadata: customMetadata,
            rows: [validRow],
          }),
        }),
      );
    });
  });

  it('shows mock metadata in preview mode', async () => {
    (window as unknown as Record<string, unknown>).__FORGE_PREVIEW__ = true;
    setupContext();

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });

    const textfields = screen.getAllByTestId('forge-textfield');
    const values = textfields.map((el) => el.getAttribute('value'));
    expect(values).toContain('user-service');
    expect(values).toContain('users');
    expect(values).toContain('Stores user account data');

    const selects = screen.getAllByTestId('forge-select');
    expect(selects.some((select) => select.getAttribute('data-options')?.includes('production'))).toBe(true);
  });
});
