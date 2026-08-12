import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
  useProductContext,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { v4 as uuid } from 'uuid';
import { setupGlobalErrorHandlers, logError, ErrorBoundary } from './utils/errorLogger';
import type { TableRow, TableMetadata, ValidationError, ValidationField, TableData, SaveTableDataResponse } from '../types';
import { getDefaultMetadata } from '../types';

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

interface MacroStorageIdentity {
  storageKey?: string;
  legacyStorageKey?: string;
}

function getStorageIdentity(context: unknown): MacroStorageIdentity {
  const productContext = context as {
    extension?: Record<string, unknown>;
    localId?: string;
    moduleKey?: string;
  } | undefined;
  const extension = productContext?.extension;
  const content = extension?.content as { id?: string | number } | undefined;
  const contentId = content?.id ? String(content.id) : undefined;
  const moduleKey = productContext?.moduleKey ?? 'redshift-data-dictionary';
  const localId = productContext?.localId;

  if (!contentId || !localId) {
    return {};
  }

  return {
    storageKey: `${contentId}:${moduleKey}:${localId}`,
    legacyStorageKey: `${contentId}:${moduleKey}`,
  };
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
  console.log("Starting App component");
  const context = useProductContext();
  const preview = useMemo(() => isPreviewMode(), []);
  const storageIdentity = useMemo(() => getStorageIdentity(context), [context]);
  const { storageKey, legacyStorageKey } = storageIdentity;
  const isEditing = context?.extension?.isEditing ?? false;

  const [rows, setRows] = useState<TableRow[]>(() => (preview ? MOCK_ROWS : []));
  const [metadata, setMetadata] = useState<TableMetadata>(() => preview ? MOCK_METADATA : getDefaultMetadata());
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Set up global error handlers on app initialization
  useEffect(() => {
    setupGlobalErrorHandlers();
  }, []);

  // Load data on mount (only in non-preview mode)
  useEffect(() => {
    if (preview || !storageKey) {
      return;
    }

    let cancelled = false;

    invoke<TableData>('getTableData', { storageKey, legacyStorageKey })
      .then((data) => {
        if (cancelled) return;
        setRows(data?.rows ?? []);
        setMetadata(data?.metadata ?? getDefaultMetadata());
      })
      .catch((error: Error) => {
        if (cancelled) return;
        console.error('Failed to load table data:', error);
        logError({
          message: 'Failed to load table data',
          stack: error?.stack || String(error),
        });
      })
      .finally(() => {
        if (!cancelled) {
          setLoadedStorageKey(storageKey);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [storageKey, legacyStorageKey, preview]);

  const handleColumnNameChange = useCallback(
    (rowId: string, value: string) => {
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, columnName: value } : r)));
      setValidationErrors((prev) => prev.filter((e) => !(e.rowId === rowId && e.field === 'columnName')));
    },
    [],
  );

  const handleDataTypeChange = useCallback(
    (rowId: string, option: { label: string; value: string } | null) => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, dataType: (option?.value as TableRow['dataType']) ?? null } : r,
        ),
      );
      // Clear validation errors for dataType and length when type changes
      setValidationErrors((prev) => prev.filter((e) => !(e.rowId === rowId && (e.field === 'dataType' || e.field === 'length'))));
    },
    [],
  );

  const handleLengthChange = useCallback(
    (rowId: string, value: string) => {
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, length: value } : r)));
      setValidationErrors((prev) => prev.filter((e) => !(e.rowId === rowId && e.field === 'length')));
    },
    [],
  );

  const handleNullableChange = useCallback(
    (rowId: string, isChecked: boolean) => {
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, nullable: isChecked } : r)));
    },
    [],
  );

  const handleSortPartitionKeyChange = useCallback(
    (rowId: string, option: { label: string; value: string } | null) => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, sortPartitionKey: (option?.value as TableRow['sortPartitionKey']) ?? null } : r,
        ),
      );
    },
    [],
  );

  const handleCopyToRedshiftChange = useCallback(
    (rowId: string, isChecked: boolean) => {
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, copyToRedshift: isChecked } : r)));
    },
    [],
  );

  const handleSampleValueChange = useCallback(
    (rowId: string, value: string) => {
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, sampleValue: value } : r)));
      setValidationErrors((prev) => prev.filter((e) => !(e.rowId === rowId && e.field === 'sampleValue')));
    },
    [],
  );

  const handlePiiChange = useCallback(
    (rowId: string, isChecked: boolean) => {
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, pii: isChecked } : r)));
    },
    [],
  );

  const handleServiceChange = useCallback(
    (e: { target?: { value?: string } }) => {
      setMetadata((prev) => ({ ...prev, service: e.target?.value ?? '' }));
    },
    [],
  );

  const handleTableNameChange = useCallback(
    (e: { target?: { value?: string } }) => {
      setMetadata((prev) => ({ ...prev, tableName: e.target?.value ?? '' }));
    },
    [],
  );

  const handleEnvironmentChange = useCallback(
    (option: { label: string; value: string } | null) => {
      setMetadata((prev) => ({ ...prev, environment: (option?.value as TableMetadata['environment']) ?? null }));
    },
    [],
  );

  const handleBusinessReasonChange = useCallback(
    (e: { target?: { value?: string } }) => {
      setMetadata((prev) => ({ ...prev, businessReason: e.target?.value ?? '' }));
    },
    [],
  );

  const handleLoadTypeChange = useCallback(
    (option: { label: string; value: string } | null) => {
      setMetadata((prev) => ({ ...prev, loadType: (option?.value as TableMetadata['loadType']) ?? null }));
    },
    [],
  );

  const handleContactNameEmailChange = useCallback(
    (e: { target?: { value?: string } }) => {
      setMetadata((prev) => ({ ...prev, contactNameEmail: e.target?.value ?? '' }));
    },
    [],
  );

  const handleTeamNameEmailChange = useCallback(
    (e: { target?: { value?: string } }) => {
      setMetadata((prev) => ({ ...prev, teamNameEmail: e.target?.value ?? '' }));
    },
    [],
  );

  const handleManagerNameEmailChange = useCallback(
    (e: { target?: { value?: string } }) => {
      setMetadata((prev) => ({ ...prev, managerNameEmail: e.target?.value ?? '' }));
    },
    [],
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
    setRows((prev) => [...prev, newRow]);
  }, []);

  const handleDeleteRow = useCallback((rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    setValidationErrors((prev) => prev.filter((e) => e.rowId !== rowId));
  }, []);

  const handleSave = useCallback(async () => {
    // Clear previous messages
    setSaveMessage(null);

    // Client-side validation
    const errors = validateRows(rows);
    setValidationErrors(errors);
    if (errors.length > 0) {
      return;
    }

    if (preview) {
      setSaveMessage({ type: 'success', text: 'Table saved successfully (preview mode)' });
      globalThis.setTimeout(() => setSaveMessage(null), 3000);
      return;
    }

    setSaving(true);
    try {
      const response = await invoke<SaveTableDataResponse>('saveTableData', { storageKey, metadata, rows });
      if (response?.success) {
        setSaveMessage({ type: 'success', text: 'Table saved successfully' });
        globalThis.setTimeout(() => setSaveMessage(null), 3000);
      } else {
        const serverErrors = response?.errors;
        if (serverErrors && serverErrors.length > 0) {
          setValidationErrors(serverErrors);
          setSaveMessage({ type: 'error', text: 'Validation failed. Please fix the errors below.' });
        } else {
          setSaveMessage({ type: 'error', text: 'Failed to save table data' });
        }
      }
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Failed to save table data:', err);
      logError({
        message: 'Failed to save table data',
        stack: err.stack || String(err),
      });
      setSaveMessage({ type: 'error', text: 'Failed to save table data' });
    } finally {
      setSaving(false);
    }
  }, [rows, metadata, storageKey, preview]);

  const loading = !preview && (!context || Boolean(storageKey && loadedStorageKey !== storageKey));

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
        {/* Metadata Header */}
        <Box xcss={metadataContainerStyles}>
          <Stack space="space.150">
            <Heading as="h4">Table Metadata</Heading>
            <Inline space="space.200" spread="space-between">
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Service</Text>
                <Textfield value={metadata.service} onChange={handleServiceChange} placeholder="e.g. user-service" isDisabled={!isEditing} />
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Table Name</Text>
                <Textfield value={metadata.tableName} onChange={handleTableNameChange} placeholder="e.g. users" isDisabled={!isEditing} />
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Environment</Text>
                <Select
                    options={ENVIRONMENT_OPTIONS}
                    value={metadata.environment ? { label: metadata.environment, value: metadata.environment } : null}
                    onChange={handleEnvironmentChange}
                    placeholder="Select environment"
                    isClearable
                    isDisabled={!isEditing}
                />
              </Stack>
            </Inline>
            <Inline space="space.200" spread="space-between">
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Business Reason</Text>
                <Textfield value={metadata.businessReason} onChange={handleBusinessReasonChange} placeholder="e.g. Stores user account data" isDisabled={!isEditing} />
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Load Type</Text>
                <Select
                  options={LOAD_TYPE_OPTIONS}
                  value={metadata.loadType ? { label: metadata.loadType, value: metadata.loadType } : null}
                  onChange={handleLoadTypeChange}
                  placeholder="Select load type"
                  isClearable
                  isDisabled={!isEditing}
                />
              </Stack>
            </Inline>
            <Inline space="space.200" spread="space-between">
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Contact Name (Email)</Text>
                <Textfield value={metadata.contactNameEmail} onChange={handleContactNameEmailChange} placeholder="e.g. Name and Email of the contact person responsible for this table" isDisabled={!isEditing} />
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Team Name (Email)</Text>
                <Textfield value={metadata.teamNameEmail} onChange={handleTeamNameEmailChange} placeholder="e.g. Name and Email of the team responsible for this table" isDisabled={!isEditing} />
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Manager Name (Email)</Text>
                <Textfield value={metadata.managerNameEmail} onChange={handleManagerNameEmailChange} placeholder="e.g. Name and Email of the team Manager" isDisabled={!isEditing} />
              </Stack>
            </Inline>
          </Stack>
        </Box>

        {/* Save message */}
        {saveMessage && (
          <SectionMessage appearance={saveMessage.type === 'success' ? 'success' : 'error'}>
            <Text>{saveMessage.text}</Text>
          </SectionMessage>
        )}

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
                        isDisabled={!isEditing}
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
                        isDisabled={!isEditing}
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
                          isDisabled={!isEditing}
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
                      isDisabled={!isEditing}
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
                    isDisabled={!isEditing}
                  />
                </Box>

                {/* Copy To Redshift */}
                <Box xcss={colCopyToRedshiftStyles}>
                  <Inline alignInline="center" alignBlock="center">
                    <Checkbox
                      isChecked={row.copyToRedshift}
                      onChange={(e) => handleCopyToRedshiftChange(row.id, e.target.checked ?? false)}
                      isDisabled={!isEditing}
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
                        isDisabled={!isEditing}
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
                      isDisabled={!isEditing}
                    />
                  </Inline>
                </Box>

                {/* Actions */}
                <Box xcss={colActionsStyles}>
                  <Button appearance="danger" onClick={() => handleDeleteRow(row.id)} isDisabled={!isEditing}>
                    ✕
                  </Button>
                </Box>
              </Inline>
            </Box>
          );
        })}

        {/* Empty state */}
        {rows.length === 0 && (
          <Box xcss={cellStyles}>
            <Text color="color.text.subtle">No rows yet. Click &ldquo;Add Row&rdquo; to get started.</Text>
          </Box>
        )}

        {/* Action buttons */}
        <Box xcss={buttonRowStyles}>
          <Inline space="space.100">
            <Button appearance="default" onClick={handleAddRow} isDisabled={!isEditing}>
              Add Row
            </Button>
            <Button appearance="primary" onClick={handleSave} isDisabled={saving || !isEditing}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </Inline>
        </Box>
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
