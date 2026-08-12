import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bridge, view } from '@forge/bridge';
import { createFrontendContext } from '@forge/testing-framework';
import { App } from '../index';
import type { TableData, TableMetadata, TableRow } from '../../types';
import {
  getDefaultMetadata,
  parseMacroTableData,
  serializeMacroTableData,
  TABLE_DATA_CONFIG_KEY,
} from '../../types';

const TEST_MACRO_ID = 'test-macro-id';
const TEST_CONTENT_ID = 'page-123';
const TEST_MODULE_KEY = 'redshift-data-dictionary';
const TEST_STORAGE_KEY = `${TEST_CONTENT_ID}:${TEST_MODULE_KEY}:${TEST_MACRO_ID}`;
const TEST_LEGACY_STORAGE_KEY = `${TEST_CONTENT_ID}:${TEST_MODULE_KEY}`;

const validRow: TableRow = {
  id: 'row-1',
  columnName: 'user_id',
  dataType: 'String',
  length: '255',
  nullable: false,
  sortPartitionKey: 'PartitionKey',
  copyToRedshift: true,
  sampleValue: 'abc-123',
  pii: true,
};

const metadata: TableMetadata = {
  ...getDefaultMetadata(),
  service: 'user-service',
  tableName: 'users',
  environment: 'production',
  businessReason: 'Stores user accounts',
  loadType: 'Updatable',
};

function setupContext(options: {
  isEditing?: boolean;
  isConfiguring?: boolean;
  configValue?: unknown;
} = {}): void {
  const config = options.configValue === undefined
    ? {}
    : { [TABLE_DATA_CONFIG_KEY]: options.configValue };

  bridge.setContext(
    createFrontendContext('confluence:macro', {
      localId: TEST_MACRO_ID,
      moduleKey: TEST_MODULE_KEY,
      extension: {
        isEditing: options.isEditing ?? false,
        macro: {
          id: TEST_MACRO_ID,
          key: 'redshift-data-dictionary',
          isConfiguring: options.isConfiguring ?? false,
        },
        config,
        content: { id: TEST_CONTENT_ID },
      },
    }),
  );
}

function mockLegacyData(rows: TableRow[] = [], tableMetadata: TableMetadata = getDefaultMetadata()): void {
  const data: TableData = {
    metadata: tableMetadata,
    rows,
    updatedAt: '2026-08-12T00:00:00.000Z',
  };
  bridge.mockInvoke('getTableData', data);
}

function configuredValue(rows: TableRow[] = [validRow], tableMetadata: TableMetadata = metadata): string {
  return serializeMacroTableData(tableMetadata, rows);
}

describe('App', () => {
  beforeEach(() => {
    bridge.reset();
    jest.restoreAllMocks();
    jest.spyOn(view, 'onClose').mockResolvedValue(undefined);
    jest.spyOn(view, 'submit').mockResolvedValue(undefined);
    delete (window as unknown as Record<string, unknown>).__FORGE_PREVIEW__;
  });

  it('loads page-owned macro configuration without reading legacy KVS', async () => {
    setupContext({ configValue: configuredValue() });

    render(<App />);

    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    expect(screen.getByText('View mode — read only')).toBeInTheDocument();
    expect(bridge.invocations).toHaveLength(0);

    const values = screen.getAllByTestId('forge-textfield').map((field) => field.getAttribute('value'));
    expect(values).toContain('user-service');
    expect(values).toContain('user_id');
  });

  it('falls back to existing KVS data when the macro has not migrated yet', async () => {
    setupContext();
    mockLegacyData([validRow], metadata);

    render(<App />);

    await waitFor(() => {
      expect(bridge.invocations).toContainEqual(expect.objectContaining({
        functionKey: 'getTableData',
        payload: expect.objectContaining({
          storageKey: TEST_STORAGE_KEY,
          legacyStorageKey: TEST_LEGACY_STORAGE_KEY,
        }),
      }));
    });
    const values = screen.getAllByTestId('forge-textfield').map((field) => field.getAttribute('value'));
    expect(values).toContain('user_id');
  });

  it('shows a live error instead of silently replacing invalid configuration', async () => {
    setupContext({ configValue: '{not-json' });

    render(<App />);

    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    expect(screen.getByText(/saved table configuration is invalid/i)).toBeInTheDocument();
    expect(bridge.invocations).toHaveLength(0);
  });

  it('keeps the inline macro read-only while the Confluence page is being edited', async () => {
    setupContext({ isEditing: true, configValue: configuredValue() });

    render(<App />);

    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    expect(screen.getByText(/choose Edit to change the table/i)).toBeInTheDocument();
    expect(screen.queryByText('Add Row')).not.toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('forge-textfield')[0]).toHaveAttribute('data-isdisabled', 'true');
  });

  it('enables fields only inside the macro configuration editor', async () => {
    setupContext({ isEditing: true, isConfiguring: true, configValue: configuredValue() });

    render(<App />);

    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    expect(screen.getByText(/persisted when you save the Confluence page/i)).toBeInTheDocument();
    expect(screen.getByText('Add Row')).toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('forge-textfield')[0]).toHaveAttribute('data-isdisabled', 'false');
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it('submits metadata changes to the Confluence page draft', async () => {
    setupContext({ isEditing: true, isConfiguring: true, configValue: configuredValue() });

    render(<App />);
    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());

    const serviceField = screen.getAllByTestId('forge-textfield')[0];
    fireEvent.change(serviceField, { target: { value: 'billing-service' } });

    await waitFor(() => expect(view.submit).toHaveBeenCalled());
    const payload = (view.submit as jest.Mock).mock.calls.at(-1)?.[0] as {
      config: Record<string, string>;
      keepEditing: boolean;
    };
    const submitted = parseMacroTableData(payload.config[TABLE_DATA_CONFIG_KEY]);
    expect(payload.keepEditing).toBe(true);
    expect(submitted?.metadata.service).toBe('billing-service');
    expect(submitted?.rows).toEqual([validRow]);
    expect(bridge.invocations.filter((call) => call.functionKey === 'saveTableData')).toHaveLength(0);
  });

  it('submits valid row deletion but keeps a newly added invalid row out of the page draft', async () => {
    setupContext({ isEditing: true, isConfiguring: true, configValue: configuredValue() });

    render(<App />);
    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());

    await userEvent.click(screen.getAllByText('Delete')[0]);
    await waitFor(() => expect(view.submit).toHaveBeenCalledTimes(1));

    const payload = (view.submit as jest.Mock).mock.calls.at(-1)?.[0] as { config: Record<string, string> };
    expect(parseMacroTableData(payload.config[TABLE_DATA_CONFIG_KEY])?.rows).toHaveLength(0);

    await userEvent.click(screen.getByText('Add Row'));
    await waitFor(() => expect(screen.getByText('Column Name is required.')).toBeInTheDocument());
    expect(view.submit).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/last valid page draft is preserved/i)).toBeInTheDocument();
  });

  it('shows validation feedback immediately for invalid configured data', async () => {
    const invalidRow: TableRow = {
      ...validRow,
      columnName: '',
      dataType: null,
      length: '',
      sampleValue: '',
    };
    setupContext({ isEditing: true, isConfiguring: true, configValue: configuredValue([invalidRow]) });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Column Name is required.')).toBeInTheDocument());
    expect(screen.getByText('DataType is required.')).toBeInTheDocument();
    expect(screen.getByText('Sample Value is required for a non-nullable column.')).toBeInTheDocument();
    expect(screen.getByText(/last valid page draft is preserved/i)).toBeInTheDocument();
  });

  it('retains the Redshift string-length validation in the page editor', async () => {
    setupContext({
      isEditing: true,
      isConfiguring: true,
      configValue: configuredValue([{ ...validRow, length: '65536' }]),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('String length cannot be greater than 65535.')).toBeInTheDocument();
    });
  });

  it('does not submit an invalid sample and resumes draft updates after correction', async () => {
    setupContext({
      isEditing: true,
      isConfiguring: true,
      configValue: configuredValue([{ ...validRow, dataType: 'VARCHAR', length: '3', sampleValue: 'abc' }]),
    });

    render(<App />);
    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());

    const sampleField = screen.getByTestId('forge-textarea');
    fireEvent.change(sampleField, { target: { value: 'four' } });

    await waitFor(() => {
      expect(screen.getByText('Sample value exceeds the maximum length of 3 characters.')).toBeInTheDocument();
    });
    expect(view.submit).not.toHaveBeenCalled();

    fireEvent.change(sampleField, { target: { value: 'two' } });
    await waitFor(() => expect(view.submit).toHaveBeenCalledTimes(1));

    const payload = (view.submit as jest.Mock).mock.calls[0][0] as { config: Record<string, string> };
    expect(parseMacroTableData(payload.config[TABLE_DATA_CONFIG_KEY])?.rows[0].sampleValue).toBe('two');
  });

  it('displays page-draft submission failures to the user', async () => {
    (view.submit as jest.Mock).mockRejectedValueOnce(new Error('bridge unavailable'));
    setupContext({ isEditing: true, isConfiguring: true, configValue: configuredValue() });

    render(<App />);
    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    fireEvent.change(screen.getAllByTestId('forge-textfield')[0], { target: { value: 'failed-change' } });

    await waitFor(() => {
      expect(screen.getByText(/could not be added to the page draft/i)).toBeInTheDocument();
    });
  });

  it('shows editable mock data in preview mode without bridge calls', async () => {
    (window as unknown as Record<string, unknown>).__FORGE_PREVIEW__ = true;
    setupContext();

    render(<App />);

    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    expect(screen.getByText('Add Row')).toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
    expect(bridge.invocations).toHaveLength(0);
    expect(view.submit).not.toHaveBeenCalled();
  });
});
