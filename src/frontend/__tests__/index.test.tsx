import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  isConfigReady?: boolean;
  configValue?: unknown;
} = {}): void {
  const config = options.configValue === undefined
    ? {}
    : { [TABLE_DATA_CONFIG_KEY]: options.configValue };
  const extensionConfig = options.isConfigReady === false ? {} : { config };

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
        ...extensionConfig,
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
  let closeHandler: (() => Promise<void>) | undefined;

  beforeEach(() => {
    bridge.reset();
    jest.restoreAllMocks();
    closeHandler = undefined;
    view.close = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(view, 'onClose').mockImplementation(async (handler) => {
      closeHandler = handler;
    });
    jest.spyOn(view, 'submit').mockResolvedValue(undefined);
    delete (window as unknown as Record<string, unknown>).__FORGE_PREVIEW__;
  });

  it('loads page-owned macro configuration without reading legacy KVS', async () => {
    setupContext({ configValue: configuredValue() });

    render(<App />);

    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    expect(screen.getByText('View mode — read only')).toBeInTheDocument();
    expect(bridge.invocations).toHaveLength(0);

    expect(screen.getByText('user-service')).toBeInTheDocument();
    expect(screen.getByText('user_id')).toBeInTheDocument();
    expect(screen.queryByTestId('forge-textfield')).not.toBeInTheDocument();
    expect(screen.queryByTestId('forge-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('forge-textarea')).not.toBeInTheDocument();
    expect(screen.queryByTestId('forge-checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Row')).not.toBeInTheDocument();
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
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });
    expect(screen.getByText('user_id')).toBeInTheDocument();
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
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    expect(screen.queryByTestId('forge-textfield')).not.toBeInTheDocument();
    expect(screen.getByText('user-service')).toBeInTheDocument();
  });

  it('uses clear placeholders and text labels for read-only empty and boolean values', async () => {
    const rowWithEmptyValues: TableRow = {
      ...validRow,
      dataType: 'Number',
      length: '',
      sortPartitionKey: null,
      nullable: false,
      copyToRedshift: true,
      pii: false,
    };
    setupContext({
      configValue: configuredValue([rowWithEmptyValues], {
        ...metadata,
        contactNameEmail: '',
        teamNameEmail: '',
        managerNameEmail: '',
      }),
    });

    render(<App />);

    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5);
    expect(screen.getAllByText('Yes')).toHaveLength(1);
    expect(screen.getAllByText('No')).toHaveLength(2);
    expect(screen.getAllByTestId('read-only-value').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('forge-checkbox')).not.toBeInTheDocument();
  });

  it('enables fields only inside the macro configuration editor', async () => {
    setupContext({ isEditing: true, isConfiguring: true, configValue: configuredValue() });

    render(<App />);

    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    expect(screen.getByText(/remain in this editor until you select Save/i)).toBeInTheDocument();
    expect(screen.getByText('Add Row')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getAllByTestId('forge-textfield')[0]).not.toHaveAttribute('data-isdisabled', 'true');
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getAllByTestId('forge-checkbox')).toHaveLength(3);
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps metadata changes local until Save submits and closes the editor', async () => {
    setupContext({ isEditing: true, isConfiguring: true, configValue: configuredValue() });

    render(<App />);
    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());

    const serviceField = screen.getAllByTestId('forge-textfield')[0];
    fireEvent.change(serviceField, { target: { value: 'billing-service' } });

    expect(view.submit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(view.submit).toHaveBeenCalledTimes(1));
    const payload = (view.submit as jest.Mock).mock.calls.at(-1)?.[0] as {
      config: Record<string, string>;
      keepEditing?: boolean;
    };
    const submitted = parseMacroTableData(payload.config[TABLE_DATA_CONFIG_KEY]);
    expect(payload.keepEditing).toBeUndefined();
    expect(submitted?.metadata.service).toBe('billing-service');
    expect(submitted?.rows).toEqual([validRow]);
    expect(view.close).not.toHaveBeenCalled();
    expect(bridge.invocations.filter((call) => call.functionKey === 'saveTableData')).toHaveLength(0);
  });

  it('keeps row additions and removals local until Save', async () => {
    setupContext({ isEditing: true, isConfiguring: true, configValue: configuredValue() });

    render(<App />);
    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());

    await userEvent.click(screen.getByText('Add Row'));
    expect(view.submit).not.toHaveBeenCalled();
    expect(screen.getAllByText('Delete')).toHaveLength(2);

    await userEvent.click(screen.getAllByText('Delete')[0]);
    expect(view.submit).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(view.submit).toHaveBeenCalledTimes(1));
    const payload = (view.submit as jest.Mock).mock.calls.at(-1)?.[0] as { config: Record<string, string> };
    expect(parseMacroTableData(payload.config[TABLE_DATA_CONFIG_KEY])?.rows).toHaveLength(1);
  });

  it('preserves a hydrated existing table when a new column is added', async () => {
    const existingRows: TableRow[] = [
      validRow,
      {
        ...validRow,
        id: 'row-2',
        columnName: 'created_at',
        dataType: 'DateTime',
        length: '',
        nullable: true,
        sortPartitionKey: 'SortKey',
        sampleValue: '2026-08-12T10:00:00Z',
        pii: false,
      },
    ];
    const existingMetadata: TableMetadata = {
      ...metadata,
      contactNameEmail: 'Data Owner (owner@example.com)',
      teamNameEmail: 'Data Platform (data@example.com)',
      managerNameEmail: 'Manager (manager@example.com)',
    };
    setupContext({ isEditing: true, isConfiguring: true, isConfigReady: false });

    const rendered = render(<App />);

    expect(screen.getByTestId('forge-spinner')).toBeInTheDocument();
    expect(screen.queryByText('Add Row')).not.toBeInTheDocument();
    expect(bridge.invocations.filter((call) => call.functionKey === 'getTableData')).toHaveLength(0);

    setupContext({
      isEditing: true,
      isConfiguring: true,
      configValue: configuredValue(existingRows, existingMetadata),
    });
    rendered.rerender(<App />);

    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    expect(screen.getAllByText('Delete')).toHaveLength(2);
    expect(screen.getAllByTestId('forge-textfield')[0]).toHaveValue('user-service');

    await userEvent.click(screen.getByText('Add Row'));
    await userEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(view.submit).toHaveBeenCalledTimes(1));

    const payload = (view.submit as jest.Mock).mock.calls[0][0] as { config: Record<string, string> };
    const saved = parseMacroTableData(payload.config[TABLE_DATA_CONFIG_KEY]);
    expect(saved?.metadata).toEqual(existingMetadata);
    expect(saved?.rows.slice(0, existingRows.length)).toEqual(existingRows);
    expect(saved?.rows).toHaveLength(existingRows.length + 1);
  });

  it('discards local edits and closes without submitting when Cancel is selected', async () => {
    setupContext({ isEditing: true, isConfiguring: true, configValue: configuredValue() });
    (view.close as jest.Mock).mockImplementation(async () => {
      await closeHandler?.();
    });

    render(<App />);
    await waitFor(() => expect(closeHandler).toBeDefined());

    const serviceField = screen.getAllByTestId('forge-textfield')[0];
    fireEvent.change(serviceField, { target: { value: 'unsaved-service' } });
    await userEvent.click(screen.getByText('Add Row'));
    expect(serviceField).toHaveValue('unsaved-service');
    expect(screen.getAllByText('Delete')).toHaveLength(2);

    await userEvent.click(screen.getByText('Cancel'));

    await waitFor(() => expect(view.close).toHaveBeenCalledTimes(1));
    expect(screen.getAllByTestId('forge-textfield')[0]).toHaveValue('user-service');
    expect(screen.getAllByText('Delete')).toHaveLength(1);
    expect(view.submit).not.toHaveBeenCalled();
    expect(bridge.invocations.filter((call) => call.functionKey === 'saveTableData')).toHaveLength(0);
  });

  it('uses the same guarded save path for the Save button and modal close action', async () => {
    setupContext({ isEditing: true, isConfiguring: true, configValue: configuredValue() });
    let submitCompleted = false;
    (view.submit as jest.Mock).mockImplementation(async () => {
      await closeHandler?.();
      submitCompleted = true;
    });

    render(<App />);
    await waitFor(() => expect(closeHandler).toBeDefined());
    fireEvent.change(screen.getAllByTestId('forge-textfield')[0], {
      target: { value: 'saved-once' },
    });

    await userEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(submitCompleted).toBe(true));
    expect(view.submit).toHaveBeenCalledTimes(1);
    const payload = (view.submit as jest.Mock).mock.calls[0][0] as { config: Record<string, string> };
    expect(parseMacroTableData(payload.config[TABLE_DATA_CONFIG_KEY])?.metadata.service).toBe('saved-once');
  });

  it('saves through the registered callback when the host modal close action is used', async () => {
    setupContext({ isEditing: true, isConfiguring: true, configValue: configuredValue() });

    render(<App />);
    await waitFor(() => expect(closeHandler).toBeDefined());
    fireEvent.change(screen.getAllByTestId('forge-textfield')[0], {
      target: { value: 'saved-by-close' },
    });

    await act(async () => {
      await closeHandler?.();
    });

    expect(view.submit).toHaveBeenCalledTimes(1);
    const payload = (view.submit as jest.Mock).mock.calls[0][0] as { config: Record<string, string> };
    expect(parseMacroTableData(payload.config[TABLE_DATA_CONFIG_KEY])?.metadata.service).toBe('saved-by-close');
  });

  it('shows validation feedback immediately while editing', async () => {
    const invalidRow: TableRow = {
      ...validRow,
      columnName: '',
      dataType: null,
      length: '',
      sampleValue: '',
    };
    setupContext({ isEditing: true, isConfiguring: true, configValue: configuredValue([invalidRow]) });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Column Name is required')).toBeInTheDocument());
    expect(screen.getByText('DataType is required')).toBeInTheDocument();
    expect(screen.getByText('Sample Value is required')).toBeInTheDocument();
  });

  it('retains the Redshift string-length validation in the page editor', async () => {
    setupContext({
      isEditing: true,
      isConfiguring: true,
      configValue: configuredValue([{ ...validRow, length: '65536' }]),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('String length cannot be greater than 65535')).toBeInTheDocument();
    });
  });

  it('flags a String sample value that exceeds the configured length', async () => {
    setupContext({
      isEditing: true,
      isConfiguring: true,
      configValue: configuredValue([{
        ...validRow,
        length: '10',
        sampleValue: '1234567890',
      }]),
    });

    render(<App />);

    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    fireEvent.change(screen.getByTestId('forge-textarea'), {
      target: { value: '12345678901' },
    });

    await waitFor(() => {
      expect(screen.getByText('Sample value exceeds the maximum length of 10 characters.')).toBeInTheDocument();
    });
  });

  it('accepts a String sample value exactly equal to the configured length', async () => {
    setupContext({
      isEditing: true,
      isConfiguring: true,
      configValue: configuredValue([{
        ...validRow,
        length: '10',
        sampleValue: '1234567890',
      }]),
    });

    render(<App />);

    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    expect(screen.queryByText(/Sample value exceeds the maximum length/)).not.toBeInTheDocument();
  });

  it('displays save failures to the user and keeps the editor open for retry', async () => {
    (view.submit as jest.Mock).mockRejectedValueOnce(new Error('bridge unavailable'));
    setupContext({ isEditing: true, isConfiguring: true, configValue: configuredValue() });

    render(<App />);
    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    fireEvent.change(screen.getAllByTestId('forge-textfield')[0], { target: { value: 'failed-change' } });
    await userEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText(/changes could not be saved/i)).toBeInTheDocument();
      expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Save')).not.toHaveAttribute('data-isdisabled', 'true');
    expect(bridge.invocations.filter((call) => call.functionKey === 'saveTableData')).toHaveLength(0);
  });

  it('shows editable mock data in preview mode without bridge calls', async () => {
    (window as unknown as Record<string, unknown>).__FORGE_PREVIEW__ = true;
    setupContext();

    render(<App />);

    await waitFor(() => expect(screen.queryByTestId('forge-spinner')).not.toBeInTheDocument());
    expect(screen.getByText('Add Row')).toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(bridge.invocations).toHaveLength(0);
    expect(view.submit).not.toHaveBeenCalled();
  });
});
