// Re-export all Forge UI types for convenient importing
export * from './forge-ui-types';

// You can also import specific types like:
// import { ButtonProps, BoxProps } from './forge-ui-types';

// ── Domain types for the Redshift Data Dictionary ──

/** Allowed values for the DataType column dropdown */
export type DataType = 'String' | 'Number' | 'Date' | 'DateTime' | 'Boolean' | 'JSON';

/** Allowed values for the Sort/Partition Key dropdown */
export type SortPartitionKeyType = 'SortKey' | 'PartitionKey';

/** A single row in the data dictionary table */
export interface TableRow {
  /** Unique row identifier (UUID generated client-side) */
  id: string;
  /** Free-text column name */
  columnName: string;
  /** Selected data type; one of the DataType values, or null if unset */
  dataType: DataType | null;
  /** Length value as string (empty string if not set) */
  length: string;
  /** Whether the column is nullable; defaults to false */
  nullable: boolean;
  /** One of "SortKey", "PartitionKey", or null if not set */
  sortPartitionKey: SortPartitionKeyType | null;
  /** Whether to copy to Redshift; defaults to false */
  copyToRedshift: boolean;
  /** Multiline sample value text */
  sampleValue: string;
  /** Whether the column contains PII; defaults to false */
  pii: boolean;
}

/** Allowed values for the Load Type metadata dropdown */
export type LoadType = 'Insert only' | 'Updatable';

/** The allowed load type values as an array for validation */
export const ALLOWED_LOAD_TYPES: LoadType[] = ['Insert only', 'Updatable'];

export type Environment = 'development' | 'integration' | 'staging' | 'uat' | 'production';

export const AVAILABLE_ENVIRONMENTS : Environment[] = ['development', 'integration', 'staging', 'uat', 'production'];

/** High-level table metadata stored alongside column rows */
export interface TableMetadata {
  /** Free-text service name (empty string if not set) */
  service: string;
  /** Free-text table name (empty string if not set) */
  tableName: string;
  /** Free-text environment (empty string if not set) */
  environment: Environment | null;
  /** Free-text business reason (empty string if not set) */
  businessReason: string;
  /** One of "Insert only", "Updatable", or null if not set */
  loadType: LoadType | null;
  contactNameEmail: string;
  teamNameEmail: string;
  managerNameEmail: string;

}

/** Returns a default empty TableMetadata object */
export function getDefaultMetadata(): TableMetadata {
  return {
    service: '',
    tableName: '',
    environment: null,
    businessReason: '',
    loadType: null,
    contactNameEmail: '',
    teamNameEmail: '',
    managerNameEmail: ''
  };
}

/** Persisted table data for a macro instance */
export interface TableData {
  /** Metadata header fields */
  metadata: TableMetadata;
  /** Ordered list of rows */
  rows: TableRow[];
  /** ISO timestamp of last save */
  updatedAt: string;
}

/** Versioned payload stored in the Confluence macro configuration. */
export interface MacroTableData {
  version: 1;
  metadata: TableMetadata;
  rows: TableRow[];
  updatedAt: string;
}

/** Macro configuration property containing the serialized table payload. */
export const TABLE_DATA_CONFIG_KEY = 'tableData';

/**
 * Serializes table data into a single string because the payload contains
 * arrays and nullable values that are not supported directly by macro config.
 */
export function serializeMacroTableData(metadata: TableMetadata, rows: TableRow[]): string {
  const payload: MacroTableData = {
    version: 1,
    metadata,
    rows,
    updatedAt: new Date().toISOString(),
  };

  return JSON.stringify(payload);
}

/** Parses a versioned table payload from Confluence macro configuration. */
export function parseMacroTableData(value: unknown): TableData | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  try {
    const payload = JSON.parse(value) as Partial<MacroTableData>;
    if (
      payload.version !== 1
      || !payload.metadata
      || typeof payload.metadata !== 'object'
      || !Array.isArray(payload.rows)
      || typeof payload.updatedAt !== 'string'
    ) {
      return null;
    }

    return {
      metadata: payload.metadata as TableMetadata,
      rows: payload.rows as TableRow[],
      updatedAt: payload.updatedAt,
    };
  } catch {
    return null;
  }
}

/** Field names that can have validation errors */
export type ValidationField = 'columnName' | 'dataType' | 'length' | 'sampleValue';

/** A validation error for a specific field in a specific row */
export interface ValidationError {
  /** ID of the row with the error */
  rowId: string;
  /** Field name with the error */
  field: ValidationField;
  /** Human-readable error message */
  message: string;
}

/** Input payload for the getTableData resolver */
export interface GetTableDataPayload {
  macroId?: string;
  storageKey?: string;
}

/** The allowed data type values as an array for validation */
export const ALLOWED_DATA_TYPES: DataType[] = ['String', 'Number', 'Date', 'DateTime', 'Boolean', 'JSON'];

/** The allowed sort/partition key values as an array for validation */
export const ALLOWED_SORT_PARTITION_KEYS: SortPartitionKeyType[] = ['SortKey', 'PartitionKey'];
