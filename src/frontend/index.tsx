import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import ForgeReconciler, {
  Text,
  Button,
  Box,
  Stack,
  Inline,
  Spinner,
  Select,
  Textfield,
  TextArea,
  Checkbox,
  SectionMessage,
  Heading,
  xcss,
  useConfig,
  useProductContext,
} from '@forge/react';
import { invoke, view } from '@forge/bridge';
import { v4 as uuid } from 'uuid';
import { setupGlobalErrorHandlers, logError, ErrorBoundary } from './utils/errorLogger';
import type { TableRow, TableMetadata, ValidationError, ValidationField, TableData } from '../types';
import {
  getDefaultMetadata,
  parseMacroTableData,
  serializeMacroTableData,
  TABLE_DATA_CONFIG_KEY,
} from '../types';

// Define allowed types locally to avoid pulling runtime values from the types barrel
const ALLOWED_DATA_TYPES = ['String', 'Number', 'Date', 'DateTime', 'Boolean', 'JSON'] as const;
const DATA_TYPE_OPTIONS = ALLOWED_DATA_TYPES.map((t) => ({ label: t, value: t }));
const SORT_PARTITION_KEY_OPTIONS = [
  { label: 'SortKey', value: 'SortKey' },
  { label: 'PartitionKey', value: 'PartitionKey' },
];

const LOAD_TYPE_OPTIONS = [
  { label: 'Insert only', value: 'Insert only' },
  { label: 'Updatable', value: 'Updatable' },
];

const ENVIRONMENT_OPTIONS = [
  { label: 'Development', value: 'development' },
  { label: 'Integration', value: 'integration' },
  { label: 'Staging', value: 'staging' },
  { label: 'UAT', value: 'uat' },
  { label: 'Production', value: 'production' },
];

const MOCK_METADATA: TableMetadata = {
  service: 'user-service',
  tableName: 'users',
  environment: 'production',
  businessReason: 'Stores user account data',
  loadType: 'Insert only',
  contactNameEmail: 'John Doe (john.doe@internet.com)',
  teamNameEmail: 'User Service Team',
  managerNameEmail: 'Jane Doe (jane.doe@internet.com)'
};

const MOCK_ROWS: TableRow[] = [
  { id: 'mock-1', columnName: 'user_id', dataType: 'String', length: '255', nullable: false, sortPartitionKey: 'PartitionKey', copyToRedshift: true, sampleValue: 'abc123', pii: true },
  { id: 'mock-2', columnName: 'age', dataType: 'Number', length: '', nullable: true, sortPartitionKey: null, copyToRedshift: true, sampleValue: '25', pii: false },
  { id: 'mock-3', columnName: 'is_active', dataType: 'Boolean', length: '', nullable: false, sortPartitionKey: null, copyToRedshift: false, sampleValue: 'true', pii: false },
];

function isPreviewMode(): boolean {
  return typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__FORGE_PREVIEW__ === true;
}

function getStorageKey(context: unknown): string | undefined {
  const extension = (context as { extension?: Record<string, unknown> } | undefined)?.extension;
  const content = extension?.content as { id?: string | number } | undefined;
  const contentId = content?.id ? String(content.id) : undefined;
  const macro = extension?.macro as { id?: string; key?: string } | undefined;
  const macroKey = macro?.key ?? 'redshift-data-dictionary';
  const macroId = macro?.id ?? (extension?.id as string | undefined);

  if (contentId && macroId && macroKey) {
    return `${contentId}:${macroKey}:${macroId}`;
  }

  if (contentId && macroKey) {
    return `${contentId}:${macroKey}`;
  }

  return macroId;
}

// ── Styles ──

const containerStyles = xcss({
  padding: 'space.200',
});

const tableHeaderStyles = xcss({
  backgroundColor: 'color.background.neutral',
  padding: 'space.100',
});

const rowStyles = xcss({
  padding: 'space.050',
  borderBottomWidth: 'border.width',
  borderBottomStyle: 'solid',
  borderBottomColor: 'color.border',
});

const cellStyles = xcss({
  padding: 'space.050',
});

const errorCellStyles = xcss({
  padding: 'space.050',
  borderColor: 'color.border.danger',
  borderWidth: 'border.width',
  borderStyle: 'solid',
});

const buttonRowStyles = xcss({
  paddingTop: 'space.200',
});

const metadataContainerStyles = xcss({
  padding: 'space.200',
  backgroundColor: 'color.background.neutral.subtle',
  borderRadius: 'radius.small',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
});

// ── Column width styles (shared between header and data rows) ──

const colColumnNameStyles = xcss({
  width: '14%',
  minWidth: '100px',
  padding: 'space.050',
});

const colDataTypeStyles = xcss({
  width: '12%',
  minWidth: '100px',
  padding: 'space.050',
});

const colLengthStyles = xcss({
  width: '8%',
  minWidth: '60px',
  padding: 'space.050',
});

const colNullableStyles = xcss({
  width: '6%',
  minWidth: '50px',
  padding: 'space.050',
  textAlign: 'center',
});

const colSortPartitionStyles = xcss({
  width: '13%',
  minWidth: '100px',
  padding: 'space.050',
});

const colCopyToRedshiftStyles = xcss({
  width: '10%',
  minWidth: '60px',
  padding: 'space.050',
  textAlign: 'center',
});

const colSampleValueStyles = xcss({
  width: '16%',
  minWidth: '100px',
  padding: 'space.050',
});

const colPiiStyles = xcss({
  width: '5%',
  minWidth: '40px',
  padding: 'space.050',
  textAlign: 'center',
});

const colActionsStyles = xcss({
  width: '5%',
  minWidth: '40px',
  padding: 'space.050',
});

// ── Validation ──

function validateRows(rows: TableRow[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const row of rows) {
    // columnName must not be empty
    if (!row.columnName.trim()) {
      errors.push({ rowId: row.id, field: 'columnName', message: 'Column Name is required' });
    }

    // dataType must not be null/empty and must be in ALLOWED_DATA_TYPES
    if (!row.dataType) {
      errors.push({ rowId: row.id, field: 'dataType', message: 'DataType is required' });
    } else if (!(ALLOWED_DATA_TYPES as readonly string[]).includes(row.dataType)) {
      errors.push({ rowId: row.id, field: 'dataType', message: 'Invalid DataType value' });
    }

    // When dataType is 'String', length is required
    if (row.dataType === 'String' && !row.length) {
      errors.push({ rowId: row.id, field: 'length', message: 'Length is required when DataType is "String"' });
    }

    if (row.dataType === 'String' && Number(row.length) > 65535) {
      errors.push({ rowId: row.id, field: 'length', message: 'String length cannot be greater than 65535' });
    }

    // When length is provided, must be a positive integer
    if (row.length) {
      const parsed = Number(row.length);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        errors.push({ rowId: row.id, field: 'length', message: 'Length must be a positive integer' });
      }
    }

    // sampleValue must not be empty
    if (!row.sampleValue.trim()) {
      errors.push({ rowId: row.id, field: 'sampleValue', message: 'Sample Value is required' });
    }
  }

  return errors;
}

function getFieldError(errors: ValidationError[], rowId: string, field: ValidationField): string | undefined {
  return errors.find((e) => e.rowId === rowId && e.field === field)?.message;
}

// ── App Component ──

export const App = (): JSX.Element => {
  console.log('Starting App component');
  const context = useProductContext();
  const config = useConfig() as Record<string, unknown> | undefined;
  const preview = useMemo(() => isPreviewMode(), []);
  const storageKey = useMemo(() => getStorageKey(context), [context]);
  const isPageEditing = context?.extension?.isEditing ?? false;
  const isConfiguring = context?.extension?.macro?.isConfiguring === true;
  const canEdit = preview || isConfiguring;
  const configValue = config?.[TABLE_DATA_CONFIG_KEY];
  const hasConfigValue = typeof configValue === 'string' && configValue.length > 0;
  const configuredTableData = useMemo(() => parseMacroTableData(configValue), [configValue]);

  const [localRows, setRows] = useState<TableRow[]>(() => (
    preview ? MOCK_ROWS : configuredTableData?.rows ?? []
  ));
  const [localMetadata, setMetadata] = useState<TableMetadata>(() => (
    preview ? MOCK_METADATA : configuredTableData?.metadata ?? getDefaultMetadata()
  ));
  const [hasLocalEdits, setHasLocalEdits] = useState(false);
  const [legacyLoadComplete, setLegacyLoadComplete] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const rows = !hasLocalEdits && configuredTableData ? configuredTableData.rows : localRows;
  const metadata = !hasLocalEdits && configuredTableData ? configuredTableData.metadata : localMetadata;
  const validationErrors = useMemo(() => validateRows(rows), [rows]);
  const configurationError = hasConfigValue && !configuredTableData
    ? 'The saved table configuration is invalid. Edit the macro to repair it.'
    : null;
  const loading = !preview
    && !configuredTableData
    && !hasConfigValue
    && Boolean(storageKey)
    && !legacyLoadComplete;
  const rowsRef = useRef(rows);
  const metadataRef = useRef(metadata);
  const submitQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    rowsRef.current = rows;
    metadataRef.current = metadata;
  }, [rows, metadata]);

  // Set up global error handlers on app initialization
  useEffect(() => {
    setupGlobalErrorHandlers();
  }, []);

  // Macro configuration is the source of truth. KVS is retained as a read-only
  // fallback so existing macro instances transition without losing data.
  useEffect(() => {
    if (preview || configuredTableData || hasConfigValue || !storageKey) {
      return;
    }

    invoke<TableData | null>('getTableData', { storageKey, macroId: storageKey })
      .then((data) => {
        const nextRows = data?.rows ?? [];
        const nextMetadata = data?.metadata ?? getDefaultMetadata();
        rowsRef.current = nextRows;
        metadataRef.current = nextMetadata;
        setRows(nextRows);
        setMetadata(nextMetadata);
        setLegacyLoadComplete(true);
      })
      .catch((error: Error) => {
        console.error('Failed to load table data:', error);
        logError({
          message: 'Failed to load table data',
          stack: error?.stack || String(error),
        });
        setLoadError('Failed to load the saved table data. Refresh the page to try again.');
        setLegacyLoadComplete(true);
      });
  }, [configuredTableData, hasConfigValue, storageKey, preview]);

  const persistPageDraft = useCallback((nextRows: TableRow[], nextMetadata: TableMetadata) => {
    if (!isConfiguring || preview) {
      return;
    }

    const serialized = serializeMacroTableData(nextMetadata, nextRows);
    const submission = submitQueueRef.current
      .catch(() => undefined)
      .then(() => view.submit({
        config: { [TABLE_DATA_CONFIG_KEY]: serialized },
        keepEditing: true,
      }));

    submitQueueRef.current = submission;
    void submission
      .then(() => setPersistenceError(null))
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error('Failed to update the Confluence page draft:', err);
        logError({
          message: 'Failed to update the Confluence page draft',
          stack: err.stack || String(err),
        });
        setPersistenceError('Changes could not be added to the page draft. Try editing the field again.');
      });
  }, [isConfiguring, preview]);

  useEffect(() => {
    if (!isConfiguring || preview) {
      return;
    }

    void view.onClose(async () => {
      await submitQueueRef.current.catch(() => undefined);
    });
  }, [isConfiguring, preview]);

  const replaceRows = useCallback((nextRows: TableRow[]) => {
    rowsRef.current = nextRows;
    setHasLocalEdits(true);
    setRows(nextRows);
    persistPageDraft(nextRows, metadataRef.current);
  }, [persistPageDraft]);

  const replaceMetadata = useCallback((nextMetadata: TableMetadata) => {
    metadataRef.current = nextMetadata;
    setHasLocalEdits(true);
    setMetadata(nextMetadata);
    persistPageDraft(rowsRef.current, nextMetadata);
  }, [persistPageDraft]);

  const handleColumnNameChange = useCallback(
    (rowId: string, value: string) => {
      replaceRows(rowsRef.current.map((row) => (row.id === rowId ? { ...row, columnName: value } : row)));
    },
    [replaceRows],
  );

  const handleDataTypeChange = useCallback(
    (rowId: string, option: { label: string; value: string } | null) => {
      replaceRows(
        rowsRef.current.map((row) =>
          row.id === rowId ? { ...row, dataType: (option?.value as TableRow['dataType']) ?? null } : row,
        ),
      );
    },
    [replaceRows],
  );

  const handleLengthChange = useCallback(
    (rowId: string, value: string) => {
      replaceRows(rowsRef.current.map((row) => (row.id === rowId ? { ...row, length: value } : row)));
    },
    [replaceRows],
  );

  const handleNullableChange = useCallback(
    (rowId: string, isChecked: boolean) => {
      replaceRows(rowsRef.current.map((row) => (row.id === rowId ? { ...row, nullable: isChecked } : row)));
    },
    [replaceRows],
  );

  const handleSortPartitionKeyChange = useCallback(
    (rowId: string, option: { label: string; value: string } | null) => {
      replaceRows(
        rowsRef.current.map((row) =>
          row.id === rowId
            ? { ...row, sortPartitionKey: (option?.value as TableRow['sortPartitionKey']) ?? null }
            : row,
        ),
      );
    },
    [replaceRows],
  );

  const handleCopyToRedshiftChange = useCallback(
    (rowId: string, isChecked: boolean) => {
      replaceRows(rowsRef.current.map((row) => (row.id === rowId ? { ...row, copyToRedshift: isChecked } : row)));
    },
    [replaceRows],
  );

  const handleSampleValueChange = useCallback(
    (rowId: string, value: string) => {
      replaceRows(rowsRef.current.map((row) => (row.id === rowId ? { ...row, sampleValue: value } : row)));
    },
    [replaceRows],
  );

  const handlePiiChange = useCallback(
    (rowId: string, isChecked: boolean) => {
      replaceRows(rowsRef.current.map((row) => (row.id === rowId ? { ...row, pii: isChecked } : row)));
    },
    [replaceRows],
  );

  const handleServiceChange = useCallback(
    (e: { target?: { value?: string } }) => {
      replaceMetadata({ ...metadataRef.current, service: e.target?.value ?? '' });
    },
    [replaceMetadata],
  );

  const handleTableNameChange = useCallback(
    (e: { target?: { value?: string } }) => {
      replaceMetadata({ ...metadataRef.current, tableName: e.target?.value ?? '' });
    },
    [replaceMetadata],
  );

  const handleEnvironmentChange = useCallback(
    (option: { label: string; value: string } | null) => {
      replaceMetadata({
        ...metadataRef.current,
        environment: (option?.value as TableMetadata['environment']) ?? null,
      });
    },
    [replaceMetadata],
  );

  const handleBusinessReasonChange = useCallback(
    (e: { target?: { value?: string } }) => {
      replaceMetadata({ ...metadataRef.current, businessReason: e.target?.value ?? '' });
    },
    [replaceMetadata],
  );

  const handleLoadTypeChange = useCallback(
    (option: { label: string; value: string } | null) => {
      replaceMetadata({
        ...metadataRef.current,
        loadType: (option?.value as TableMetadata['loadType']) ?? null,
      });
    },
    [replaceMetadata],
  );

  const handleContactNameEmailChange = useCallback(
    (e: { target?: { value?: string } }) => {
      replaceMetadata({ ...metadataRef.current, contactNameEmail: e.target?.value ?? '' });
    },
    [replaceMetadata],
  );

  const handleTeamNameEmailChange = useCallback(
    (e: { target?: { value?: string } }) => {
      replaceMetadata({ ...metadataRef.current, teamNameEmail: e.target?.value ?? '' });
    },
    [replaceMetadata],
  );

  const handleManagerNameEmailChange = useCallback(
    (e: { target?: { value?: string } }) => {
      replaceMetadata({ ...metadataRef.current, managerNameEmail: e.target?.value ?? '' });
    },
    [replaceMetadata],
  );

  const handleAddRow = useCallback(() => {
    const newRow: TableRow = {
      id: uuid(),
      columnName: '',
      dataType: null,
      length: '',
      nullable: false,
      sortPartitionKey: null,
      copyToRedshift: false,
      sampleValue: '',
      pii: false,
    };
    replaceRows([...rowsRef.current, newRow]);
  }, [replaceRows]);

  const handleDeleteRow = useCallback((rowId: string) => {
    replaceRows(rowsRef.current.filter((row) => row.id !== rowId));
  }, [replaceRows]);

  // Show spinner while loading
  if (loading) {
    return (
      <Box xcss={containerStyles}>
        <Spinner size="medium" />
      </Box>
    );
  }

  return (
    <Box xcss={containerStyles}>
      <Stack space="space.200">
        {isConfiguring && (
          <SectionMessage appearance="information">
            <Text>Changes are added to the page draft automatically and are persisted when you save the Confluence page.</Text>
          </SectionMessage>
        )}
        {preview && !isConfiguring && (
          <SectionMessage appearance="information">
            <Text>Preview mode uses editable sample data and does not persist changes.</Text>
          </SectionMessage>
        )}
        {!preview && !isConfiguring && isPageEditing && (
          <SectionMessage appearance="information">
            <Text>Select this macro and choose Edit to change the table. The inline preview stays read-only.</Text>
          </SectionMessage>
        )}
        {!preview && !isConfiguring && !isPageEditing && (
          <Text color="color.text.subtle" size="small">View mode — read only</Text>
        )}
        {(configurationError || loadError || persistenceError) && (
          <SectionMessage appearance="error">
            <Text>{configurationError || loadError || persistenceError}</Text>
          </SectionMessage>
        )}

        {/* Metadata Header */}
        <Box xcss={metadataContainerStyles}>
          <Stack space="space.150">
            <Heading as="h4">Table Metadata*</Heading>
            <Text color="color.text.accent.gray" size="small" weight="semibold" as="em">*Only one table available per page</Text>
            <Inline space="space.200" spread="space-between">
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Service</Text>
                <Textfield value={metadata.service} onChange={handleServiceChange} placeholder="e.g. user-service" isDisabled={!canEdit} />
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Table Name</Text>
                <Textfield value={metadata.tableName} onChange={handleTableNameChange} placeholder="e.g. users" isDisabled={!canEdit} />
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Environment</Text>
                <Select
                    options={ENVIRONMENT_OPTIONS}
                    value={metadata.environment ? { label: metadata.environment, value: metadata.environment } : null}
                    onChange={handleEnvironmentChange}
                    placeholder="Select environment"
                    isClearable
                    isDisabled={!canEdit}
                />
              </Stack>
            </Inline>
            <Inline space="space.200" spread="space-between">
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Business Reason</Text>
                <Textfield value={metadata.businessReason} onChange={handleBusinessReasonChange} placeholder="e.g. Stores user account data" isDisabled={!canEdit} />
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Load Type</Text>
                <Select
                  options={LOAD_TYPE_OPTIONS}
                  value={metadata.loadType ? { label: metadata.loadType, value: metadata.loadType } : null}
                  onChange={handleLoadTypeChange}
                  placeholder="Select load type"
                  isClearable
                  isDisabled={!canEdit}
                />
              </Stack>
            </Inline>
            <Inline space="space.200" spread="space-between">
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Contact Name (Email)</Text>
                <Textfield value={metadata.contactNameEmail} onChange={handleContactNameEmailChange} placeholder="e.g. Name and Email of the contact person responsible for this table" isDisabled={!canEdit} />
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Team Name (Email)</Text>
                <Textfield value={metadata.teamNameEmail} onChange={handleTeamNameEmailChange} placeholder="e.g. Name and Email of the team responsible for this table" isDisabled={!canEdit} />
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Manager Name (Email)</Text>
                <Textfield value={metadata.managerNameEmail} onChange={handleManagerNameEmailChange} placeholder="e.g. Name and Email of the team Manager" isDisabled={!canEdit} />
              </Stack>
            </Inline>
          </Stack>
        </Box>

        {/* Table header */}
        <Box xcss={tableHeaderStyles}>
          <Inline space="space.100" alignBlock="center">
            <Box xcss={colColumnNameStyles}>
              <Text weight="bold">Column Name</Text>
            </Box>
            <Box xcss={colDataTypeStyles}>
              <Text weight="bold">DataType</Text>
            </Box>
            <Box xcss={colLengthStyles}>
              <Text weight="bold">Length</Text>
            </Box>
            <Box xcss={colNullableStyles}>
              <Inline alignInline="center">
                <Text weight="bold">Nullable</Text>
              </Inline>
            </Box>
            <Box xcss={colSortPartitionStyles}>
              <Text weight="bold">Sort/Partition Key</Text>
            </Box>
            <Box xcss={colCopyToRedshiftStyles}>
              <Inline alignInline="center">
                <Text weight="bold">Copy To Redshift</Text>
              </Inline>
            </Box>
            <Box xcss={colSampleValueStyles}>
              <Text weight="bold">Sample Value</Text>
            </Box>
            <Box xcss={colPiiStyles}>
              <Inline alignInline="center">
                <Text weight="bold">PII</Text>
              </Inline>
            </Box>
            <Box xcss={colActionsStyles}>
              <Text weight="bold">Actions</Text>
            </Box>
          </Inline>
        </Box>

        {/* Table rows */}
        {rows.map((row) => {
          const columnNameError = getFieldError(validationErrors, row.id, 'columnName');
          const dataTypeError = getFieldError(validationErrors, row.id, 'dataType');
          const lengthError = getFieldError(validationErrors, row.id, 'length');
          const sampleValueError = getFieldError(validationErrors, row.id, 'sampleValue');
          const isLengthRequired = row.dataType === 'String';

          return (
            <Box key={row.id} xcss={rowStyles}>
              <Inline space="space.100" alignBlock="start">
                {/* Column Name */}
                <Box xcss={colColumnNameStyles}>
                  <Stack space="space.050">
                    <Box xcss={columnNameError ? errorCellStyles : cellStyles}>
                      <Textfield
                        type="text"
                        value={row.columnName}
                        onChange={(e: { target?: { value?: string } }) => handleColumnNameChange(row.id, e.target?.value ?? '')}
                        placeholder="Required"
                        isDisabled={!canEdit}
                      />
                    </Box>
                    {columnNameError && (
                      <Text color="color.text.danger" size="small">
                        {columnNameError}
                      </Text>
                    )}
                  </Stack>
                </Box>

                {/* DataType */}
                <Box xcss={colDataTypeStyles}>
                  <Stack space="space.050">
                    <Box xcss={dataTypeError ? errorCellStyles : cellStyles}>
                      <Select
                        options={DATA_TYPE_OPTIONS}
                        value={row.dataType ? { label: row.dataType, value: row.dataType } : null}
                        onChange={(option: { label: string; value: string } | null) => handleDataTypeChange(row.id, option)}
                        placeholder="Select type"
                        isDisabled={!canEdit}
                      />
                    </Box>
                    {dataTypeError && (
                      <Text color="color.text.danger" size="small">
                        {dataTypeError}
                      </Text>
                    )}
                  </Stack>
                </Box>

                {/* Length */}
                <Box xcss={colLengthStyles}>
                  <Stack space="space.050">
                    <Box xcss={lengthError ? errorCellStyles : cellStyles}>
                      <Inline space="space.025" alignBlock="center">
                        <Textfield
                          type="number"
                          value={row.length}
                          onChange={(e: { target?: { value?: string } }) => handleLengthChange(row.id, e.target?.value ?? '')}
                          placeholder={isLengthRequired ? 'Required' : 'Optional'}
                          isDisabled={!canEdit}
                        />
                        {isLengthRequired && (
                          <Text color="color.text.danger" weight="bold">
                            *
                          </Text>
                        )}
                      </Inline>
                    </Box>
                    {lengthError && (
                      <Text color="color.text.danger" size="small">
                        {lengthError}
                      </Text>
                    )}
                  </Stack>
                </Box>

                {/* Nullable */}
                <Box xcss={colNullableStyles}>
                  <Inline alignInline="center" alignBlock="center">
                    <Checkbox
                      isChecked={row.nullable}
                      onChange={(e) => handleNullableChange(row.id, e.target.checked ?? false)}
                      isDisabled={!canEdit}
                    />
                  </Inline>
                </Box>

                {/* Sort/Partition Key */}
                <Box xcss={colSortPartitionStyles}>
                  <Select
                    options={SORT_PARTITION_KEY_OPTIONS}
                    value={row.sortPartitionKey ? { label: row.sortPartitionKey, value: row.sortPartitionKey } : null}
                    onChange={(option: { label: string; value: string } | null) => handleSortPartitionKeyChange(row.id, option)}
                    placeholder="Optional"
                    isClearable
                    isDisabled={!canEdit}
                  />
                </Box>

                {/* Copy To Redshift */}
                <Box xcss={colCopyToRedshiftStyles}>
                  <Inline alignInline="center" alignBlock="center">
                    <Checkbox
                      isChecked={row.copyToRedshift}
                      onChange={(e) => handleCopyToRedshiftChange(row.id, e.target.checked ?? false)}
                      isDisabled={!canEdit}
                    />
                  </Inline>
                </Box>

                {/* Sample Value */}
                <Box xcss={colSampleValueStyles}>
                  <Stack space="space.050">
                    <Box xcss={sampleValueError ? errorCellStyles : cellStyles}>
                      <TextArea
                        value={row.sampleValue}
                        onChange={(e: { target?: { value?: string } }) => handleSampleValueChange(row.id, e.target?.value ?? '')}
                        placeholder="Required"
                        isDisabled={!canEdit}
                      />
                    </Box>
                    {sampleValueError && (
                      <Text color="color.text.danger" size="small">
                        {sampleValueError}
                      </Text>
                    )}
                  </Stack>
                </Box>

                {/* PII */}
                <Box xcss={colPiiStyles}>
                  <Inline alignInline="center" alignBlock="center">
                    <Checkbox
                      isChecked={row.pii}
                      onChange={(e) => handlePiiChange(row.id, e.target.checked ?? false)}
                      isDisabled={!canEdit}
                    />
                  </Inline>
                </Box>

                {/* Actions */}
                <Box xcss={colActionsStyles}>
                  <Button appearance="danger" onClick={() => handleDeleteRow(row.id)} isDisabled={!canEdit}>
                    Delete
                  </Button>
                </Box>
              </Inline>
            </Box>
          );
        })}

        {/* Empty state */}
        {rows.length === 0 && (
          <Box xcss={cellStyles}>
            <Text color="color.text.subtle">
              {canEdit ? 'No rows yet. Click “Add Row” to get started.' : 'No rows have been added.'}
            </Text>
          </Box>
        )}

        {/* Editing actions */}
        {canEdit && (
          <Box xcss={buttonRowStyles}>
            <Button appearance="default" onClick={handleAddRow}>
              Add Row
            </Button>
          </Box>
        )}
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
