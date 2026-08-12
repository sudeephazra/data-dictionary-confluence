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
import { validateRows } from '../validation';

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
  borderRadius: 'radius.medium',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
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

const readOnlyValueStyles = xcss({
  padding: 'space.075',
  backgroundColor: 'color.background.neutral.subtle',
  borderRadius: 'radius.small',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
});

function ReadOnlyValue({ value }: { value: string | number | null | undefined }): JSX.Element {
  const displayValue = value === null || value === undefined || String(value).trim() === ''
    ? '—'
    : String(value);

  return (
    <Box xcss={readOnlyValueStyles} testId="read-only-value">
      <Text>{displayValue}</Text>
    </Box>
  );
}

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

function getFieldError(errors: ValidationError[], rowId: string, field: ValidationField): string | undefined {
  return errors.find((e) => e.rowId === rowId && e.field === field)?.message;
}

// ── App Component ──

export const App = (): JSX.Element => {
  console.log('Starting App component');
  const context = useProductContext();
  const config = useConfig() as Record<string, unknown> | undefined;
  const preview = useMemo(() => isPreviewMode(), []);
  const { storageKey, legacyStorageKey } = useMemo(() => getStorageIdentity(context), [context]);
  const isPageEditing = context?.extension?.isEditing ?? false;
  const isConfiguring = context?.extension?.macro?.isConfiguring === true;
  const configurationReady = config !== undefined;
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
  const [isSaving, setIsSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const rows = !hasLocalEdits && configuredTableData ? configuredTableData.rows : localRows;
  const metadata = !hasLocalEdits && configuredTableData ? configuredTableData.metadata : localMetadata;
  const canEdit = preview || (isConfiguring && configurationReady);
  const validationErrors = useMemo(() => validateRows(rows), [rows]);
  const configurationError = hasConfigValue && !configuredTableData
    ? 'The saved table configuration is invalid. Edit the macro to repair it.'
    : null;
  const loading = !preview && (
    !configurationReady
    || (
      !configuredTableData
      && !hasConfigValue
      && Boolean(storageKey)
      && !legacyLoadComplete
    )
  );
  const rowsRef = useRef(rows);
  const metadataRef = useRef(metadata);
  const savedRowsRef = useRef<TableRow[]>(rows);
  const savedMetadataRef = useRef<TableMetadata>(metadata);
  const hasLocalEditsRef = useRef(false);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const isSubmittingRef = useRef(false);
  const isCancellingRef = useRef(false);

  useEffect(() => {
    rowsRef.current = rows;
    metadataRef.current = metadata;
  }, [rows, metadata]);

  // Capture the saved macro configuration as the edit-session baseline once
  // useConfig has hydrated. This must happen before local edits so an initially
  // undefined config cannot be mistaken for an empty table.
  useEffect(() => {
    if (preview || hasLocalEditsRef.current || !configuredTableData) {
      return;
    }

    rowsRef.current = configuredTableData.rows;
    metadataRef.current = configuredTableData.metadata;
    savedRowsRef.current = configuredTableData.rows;
    savedMetadataRef.current = configuredTableData.metadata;
    setRows(configuredTableData.rows);
    setMetadata(configuredTableData.metadata);
  }, [configuredTableData, preview]);
  // Set up global error handlers on app initialization
  useEffect(() => {
    setupGlobalErrorHandlers();
  }, []);

  // Macro configuration is the source of truth. KVS is retained as a read-only
  // fallback so existing macro instances transition without losing data.
  useEffect(() => {
    if (!configurationReady || preview || configuredTableData || hasConfigValue || !storageKey) {
      return;
    }

    invoke<TableData | null>('getTableData', { storageKey, legacyStorageKey })
      .then((data) => {
        const nextRows = data?.rows ?? [];
        const nextMetadata = data?.metadata ?? getDefaultMetadata();
        rowsRef.current = nextRows;
        metadataRef.current = nextMetadata;
        savedRowsRef.current = nextRows;
        savedMetadataRef.current = nextMetadata;
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
  }, [configurationReady, configuredTableData, hasConfigValue, storageKey, legacyStorageKey, preview]);

  const saveChanges = useCallback((): Promise<void> => {
    if (!isConfiguring || preview) {
      return Promise.resolve();
    }

    if (savePromiseRef.current) {
      return savePromiseRef.current;
    }

    setIsSaving(true);
    setPersistenceError(null);
    isSubmittingRef.current = true;
    const rowsToSave = hasLocalEditsRef.current
      ? rowsRef.current
      : configuredTableData?.rows ?? rowsRef.current;
    const metadataToSave = hasLocalEditsRef.current
      ? metadataRef.current
      : configuredTableData?.metadata ?? metadataRef.current;
    const serialized = serializeMacroTableData(metadataToSave, rowsToSave);
    const savePromise = Promise.resolve()
      .then(() => view.submit({
        config: { [TABLE_DATA_CONFIG_KEY]: serialized },
      }))
      .catch((error: unknown) => {
        isSubmittingRef.current = false;
        savePromiseRef.current = null;
        setIsSaving(false);
        const err = error instanceof Error ? error : new Error(String(error));
        console.error('Failed to save the macro configuration:', err);
        logError({
          message: 'Failed to save the macro configuration',
          stack: err.stack || String(err),
        });
        setPersistenceError('Changes could not be saved. Try again.');
        throw err;
      });

    savePromiseRef.current = savePromise;
    return savePromise;
  }, [configuredTableData, isConfiguring, preview]);

  useEffect(() => {
    if (!configurationReady || !isConfiguring || preview) {
      return;
    }

    void view.onClose(async () => {
      if (!isCancellingRef.current && !isSubmittingRef.current) {
        await saveChanges();
      }
    });
  }, [configurationReady, isConfiguring, preview, saveChanges]);

  const handleSave = useCallback(() => {
    void saveChanges().catch(() => undefined);
  }, [saveChanges]);

  const handleCancel = useCallback(() => {
    if (isSaving || isCancelling) {
      return;
    }

    isCancellingRef.current = true;
    setIsCancelling(true);
    const rowsToRestore = configuredTableData?.rows ?? savedRowsRef.current;
    const metadataToRestore = configuredTableData?.metadata ?? savedMetadataRef.current;
    rowsRef.current = rowsToRestore;
    metadataRef.current = metadataToRestore;
    savedRowsRef.current = rowsToRestore;
    savedMetadataRef.current = metadataToRestore;
    hasLocalEditsRef.current = false;
    setRows(rowsToRestore);
    setMetadata(metadataToRestore);
    setHasLocalEdits(false);
    setPersistenceError(null);

    void view.close().catch((error: unknown) => {
      isCancellingRef.current = false;
      setIsCancelling(false);
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Failed to close the macro configuration editor:', err);
      logError({
        message: 'Failed to close the macro configuration editor',
        stack: err.stack || String(err),
      });
      setPersistenceError('Edits were discarded, but the editor could not be closed. Try again.');
    });
  }, [configuredTableData, isCancelling, isSaving]);

  const replaceRows = useCallback((nextRows: TableRow[]) => {
    if (!hasLocalEditsRef.current && configuredTableData) {
      metadataRef.current = configuredTableData.metadata;
      savedRowsRef.current = configuredTableData.rows;
      savedMetadataRef.current = configuredTableData.metadata;
    }
    rowsRef.current = nextRows;
    hasLocalEditsRef.current = true;
    setHasLocalEdits(true);
    setRows(nextRows);
  }, [configuredTableData]);

  const replaceMetadata = useCallback((nextMetadata: TableMetadata) => {
    if (!hasLocalEditsRef.current && configuredTableData) {
      rowsRef.current = configuredTableData.rows;
      savedRowsRef.current = configuredTableData.rows;
      savedMetadataRef.current = configuredTableData.metadata;
    }
    metadataRef.current = nextMetadata;
    hasLocalEditsRef.current = true;
    setHasLocalEdits(true);
    setMetadata(nextMetadata);
  }, [configuredTableData]);

  const getSessionRows = useCallback(() => (
    hasLocalEditsRef.current ? rowsRef.current : configuredTableData?.rows ?? rowsRef.current
  ), [configuredTableData]);

  const getSessionMetadata = useCallback(() => (
    hasLocalEditsRef.current ? metadataRef.current : configuredTableData?.metadata ?? metadataRef.current
  ), [configuredTableData]);

  const handleColumnNameChange = useCallback(
    (rowId: string, value: string) => {
      replaceRows(getSessionRows().map((row) => (row.id === rowId ? { ...row, columnName: value } : row)));
    },
    [getSessionRows, replaceRows],
  );

  const handleDataTypeChange = useCallback(
    (rowId: string, option: { label: string; value: string } | null) => {
      replaceRows(
        getSessionRows().map((row) =>
          row.id === rowId ? { ...row, dataType: (option?.value as TableRow['dataType']) ?? null } : row,
        ),
      );
    },
    [getSessionRows, replaceRows],
  );

  const handleLengthChange = useCallback(
    (rowId: string, value: string) => {
      replaceRows(getSessionRows().map((row) => (row.id === rowId ? { ...row, length: value } : row)));
    },
    [getSessionRows, replaceRows],
  );

  const handleNullableChange = useCallback(
    (rowId: string, isChecked: boolean) => {
      replaceRows(getSessionRows().map((row) => (row.id === rowId ? { ...row, nullable: isChecked } : row)));
    },
    [getSessionRows, replaceRows],
  );

  const handleSortPartitionKeyChange = useCallback(
    (rowId: string, option: { label: string; value: string } | null) => {
      replaceRows(
        getSessionRows().map((row) =>
          row.id === rowId
            ? { ...row, sortPartitionKey: (option?.value as TableRow['sortPartitionKey']) ?? null }
            : row,
        ),
      );
    },
    [getSessionRows, replaceRows],
  );

  const handleCopyToRedshiftChange = useCallback(
    (rowId: string, isChecked: boolean) => {
      replaceRows(getSessionRows().map((row) => (
        row.id === rowId ? { ...row, copyToRedshift: isChecked } : row
      )));
    },
    [getSessionRows, replaceRows],
  );

  const handleSampleValueChange = useCallback(
    (rowId: string, value: string) => {
      replaceRows(getSessionRows().map((row) => (row.id === rowId ? { ...row, sampleValue: value } : row)));
    },
    [getSessionRows, replaceRows],
  );

  const handlePiiChange = useCallback(
    (rowId: string, isChecked: boolean) => {
      replaceRows(getSessionRows().map((row) => (row.id === rowId ? { ...row, pii: isChecked } : row)));
    },
    [getSessionRows, replaceRows],
  );

  const handleServiceChange = useCallback(
    (e: { target?: { value?: string } }) => {
      replaceMetadata({ ...getSessionMetadata(), service: e.target?.value ?? '' });
    },
    [getSessionMetadata, replaceMetadata],
  );

  const handleTableNameChange = useCallback(
    (e: { target?: { value?: string } }) => {
      replaceMetadata({ ...getSessionMetadata(), tableName: e.target?.value ?? '' });
    },
    [getSessionMetadata, replaceMetadata],
  );

  const handleEnvironmentChange = useCallback(
    (option: { label: string; value: string } | null) => {
      replaceMetadata({
        ...getSessionMetadata(),
        environment: (option?.value as TableMetadata['environment']) ?? null,
      });
    },
    [getSessionMetadata, replaceMetadata],
  );

  const handleBusinessReasonChange = useCallback(
    (e: { target?: { value?: string } }) => {
      replaceMetadata({ ...getSessionMetadata(), businessReason: e.target?.value ?? '' });
    },
    [getSessionMetadata, replaceMetadata],
  );

  const handleLoadTypeChange = useCallback(
    (option: { label: string; value: string } | null) => {
      replaceMetadata({
        ...getSessionMetadata(),
        loadType: (option?.value as TableMetadata['loadType']) ?? null,
      });
    },
    [getSessionMetadata, replaceMetadata],
  );

  const handleContactNameEmailChange = useCallback(
    (e: { target?: { value?: string } }) => {
      replaceMetadata({ ...getSessionMetadata(), contactNameEmail: e.target?.value ?? '' });
    },
    [getSessionMetadata, replaceMetadata],
  );

  const handleTeamNameEmailChange = useCallback(
    (e: { target?: { value?: string } }) => {
      replaceMetadata({ ...getSessionMetadata(), teamNameEmail: e.target?.value ?? '' });
    },
    [getSessionMetadata, replaceMetadata],
  );

  const handleManagerNameEmailChange = useCallback(
    (e: { target?: { value?: string } }) => {
      replaceMetadata({ ...getSessionMetadata(), managerNameEmail: e.target?.value ?? '' });
    },
    [getSessionMetadata, replaceMetadata],
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
    replaceRows([...getSessionRows(), newRow]);
  }, [getSessionRows, replaceRows]);

  const handleDeleteRow = useCallback((rowId: string) => {
    replaceRows(getSessionRows().filter((row) => row.id !== rowId));
  }, [getSessionRows, replaceRows]);

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
            <Text>Changes remain in this editor until you select Save. Cancel discards them.</Text>
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
          <Text color="color.text.subtle" as="em" size="small">View mode — read only</Text>
        )}
        {(configurationError || loadError || persistenceError) && (
          <SectionMessage appearance="error">
            <Text>{configurationError || loadError || persistenceError}</Text>
          </SectionMessage>
        )}

        {/* Metadata Header */}
        <Box xcss={metadataContainerStyles}>
          <Stack space="space.150">
            <Heading as="h4">Table Metadata</Heading>
            <Inline space="space.200" spread="space-between">
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Service</Text>
                {canEdit ? (
                  <Textfield value={metadata.service} onChange={handleServiceChange} placeholder="e.g. user-service" />
                ) : (
                  <ReadOnlyValue value={metadata.service} />
                )}
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Table Name</Text>
                {canEdit ? (
                  <Textfield value={metadata.tableName} onChange={handleTableNameChange} placeholder="e.g. users" />
                ) : (
                  <ReadOnlyValue value={metadata.tableName} />
                )}
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Environment</Text>
                {canEdit ? (
                  <Select
                    options={ENVIRONMENT_OPTIONS}
                    value={metadata.environment ? { label: metadata.environment, value: metadata.environment } : null}
                    onChange={handleEnvironmentChange}
                    placeholder="Select environment"
                    isClearable
                  />
                ) : (
                  <ReadOnlyValue value={metadata.environment} />
                )}
              </Stack>
            </Inline>
            <Inline space="space.200" spread="space-between">
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Business Reason</Text>
                {canEdit ? (
                  <Textfield value={metadata.businessReason} onChange={handleBusinessReasonChange} placeholder="e.g. Stores user account data" />
                ) : (
                  <ReadOnlyValue value={metadata.businessReason} />
                )}
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Load Type</Text>
                {canEdit ? (
                  <Select
                    options={LOAD_TYPE_OPTIONS}
                    value={metadata.loadType ? { label: metadata.loadType, value: metadata.loadType } : null}
                    onChange={handleLoadTypeChange}
                    placeholder="Select load type"
                    isClearable
                  />
                ) : (
                  <ReadOnlyValue value={metadata.loadType} />
                )}
              </Stack>
            </Inline>
            <Inline space="space.200" spread="space-between">
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Contact Name (Email)</Text>
                {canEdit ? (
                  <Textfield value={metadata.contactNameEmail} onChange={handleContactNameEmailChange} placeholder="e.g. Name and Email of the contact person responsible for this table" />
                ) : (
                  <ReadOnlyValue value={metadata.contactNameEmail} />
                )}
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Team Name (Email)</Text>
                {canEdit ? (
                  <Textfield value={metadata.teamNameEmail} onChange={handleTeamNameEmailChange} placeholder="e.g. Name and Email of the team responsible for this table" />
                ) : (
                  <ReadOnlyValue value={metadata.teamNameEmail} />
                )}
              </Stack>
              <Stack space="space.050" grow="fill">
                <Text weight="bold" size="small">Manager Name (Email)</Text>
                {canEdit ? (
                  <Textfield value={metadata.managerNameEmail} onChange={handleManagerNameEmailChange} placeholder="e.g. Name and Email of the team Manager" />
                ) : (
                  <ReadOnlyValue value={metadata.managerNameEmail} />
                )}
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
            {canEdit && (
              <Box xcss={colActionsStyles}>
                <Text weight="bold">Actions</Text>
              </Box>
            )}
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
                      {canEdit ? (
                        <Textfield
                          type="text"
                          value={row.columnName}
                          onChange={(e: { target?: { value?: string } }) => handleColumnNameChange(row.id, e.target?.value ?? '')}
                          placeholder="Required"
                        />
                      ) : (
                        <ReadOnlyValue value={row.columnName} />
                      )}
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
                      {canEdit ? (
                        <Select
                          options={DATA_TYPE_OPTIONS}
                          value={row.dataType ? { label: row.dataType, value: row.dataType } : null}
                          onChange={(option: { label: string; value: string } | null) => handleDataTypeChange(row.id, option)}
                          placeholder="Select type"
                        />
                      ) : (
                        <ReadOnlyValue value={row.dataType} />
                      )}
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
                      {canEdit ? (
                        <Inline space="space.025" alignBlock="center">
                          <Textfield
                            type="number"
                            value={row.length}
                            onChange={(e: { target?: { value?: string } }) => handleLengthChange(row.id, e.target?.value ?? '')}
                            placeholder={isLengthRequired ? 'Required' : 'Optional'}
                          />
                          {isLengthRequired && (
                            <Text color="color.text.danger" weight="bold">
                              *
                            </Text>
                          )}
                        </Inline>
                      ) : (
                        <ReadOnlyValue value={row.length} />
                      )}
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
                    {canEdit ? (
                      <Checkbox
                        isChecked={row.nullable}
                        onChange={(e) => handleNullableChange(row.id, e.target.checked ?? false)}
                      />
                    ) : (
                      <ReadOnlyValue value={row.nullable ? 'Yes' : 'No'} />
                    )}
                  </Inline>
                </Box>

                {/* Sort/Partition Key */}
                <Box xcss={colSortPartitionStyles}>
                  {canEdit ? (
                    <Select
                      options={SORT_PARTITION_KEY_OPTIONS}
                      value={row.sortPartitionKey ? { label: row.sortPartitionKey, value: row.sortPartitionKey } : null}
                      onChange={(option: { label: string; value: string } | null) => handleSortPartitionKeyChange(row.id, option)}
                      placeholder="Optional"
                      isClearable
                    />
                  ) : (
                    <ReadOnlyValue value={row.sortPartitionKey} />
                  )}
                </Box>

                {/* Copy To Redshift */}
                <Box xcss={colCopyToRedshiftStyles}>
                  <Inline alignInline="center" alignBlock="center">
                    {canEdit ? (
                      <Checkbox
                        isChecked={row.copyToRedshift}
                        onChange={(e) => handleCopyToRedshiftChange(row.id, e.target.checked ?? false)}
                      />
                    ) : (
                      <ReadOnlyValue value={row.copyToRedshift ? 'Yes' : 'No'} />
                    )}
                  </Inline>
                </Box>

                {/* Sample Value */}
                <Box xcss={colSampleValueStyles}>
                  <Stack space="space.050">
                    <Box xcss={sampleValueError ? errorCellStyles : cellStyles}>
                      {canEdit ? (
                        <TextArea
                          value={row.sampleValue}
                          onChange={(e: { target?: { value?: string } }) => handleSampleValueChange(row.id, e.target?.value ?? '')}
                          placeholder="Required"
                        />
                      ) : (
                        <ReadOnlyValue value={row.sampleValue} />
                      )}
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
                    {canEdit ? (
                      <Checkbox
                        isChecked={row.pii}
                        onChange={(e) => handlePiiChange(row.id, e.target.checked ?? false)}
                      />
                    ) : (
                      <ReadOnlyValue value={row.pii ? 'Yes' : 'No'} />
                    )}
                  </Inline>
                </Box>

                {/* Actions */}
                {canEdit && (
                  <Box xcss={colActionsStyles}>
                    <Button appearance="danger" onClick={() => handleDeleteRow(row.id)}>
                      Delete
                    </Button>
                  </Box>
                )}
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
            <Inline spread="space-between" alignBlock="center">
              <Button appearance="default" onClick={handleAddRow} isDisabled={isSaving || isCancelling}>
                Add Row
              </Button>
              {isConfiguring && !preview && (
                <Inline space="space.100">
                  <Button appearance="default" onClick={handleCancel} isDisabled={isSaving || isCancelling}>
                    {isCancelling ? 'Discarding…' : 'Cancel'}
                  </Button>
                  <Button appearance="primary" onClick={handleSave} isDisabled={isSaving || isCancelling}>
                    {isSaving ? 'Saving…' : 'Save'}
                  </Button>
                </Inline>
              )}
            </Inline>
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
