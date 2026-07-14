import Resolver from '@forge/resolver';
import { kvs } from '@forge/kvs';
import type {
  TableRow,
  TableData,
  ValidationError,
  GetTableDataPayload,
  SaveTableDataPayload,
  SaveTableDataResponse,
} from '../types';
import { ALLOWED_DATA_TYPES, getDefaultMetadata } from '../types';

// Basic type for Forge resolver request
interface ResolverRequest {
  payload?: unknown;
  context?: {
    accountId?: string;
    cloudId?: string;
    [key: string]: unknown;
  };
}

function getStorageKey(payload: { storageKey?: string; macroId?: string } | undefined): string | undefined {
  return payload?.storageKey || payload?.macroId;
}

/**
 * Validates rows before persisting to storage.
 * Returns an array of ValidationError objects (empty array means valid).
 */
export function validateRows(rows: TableRow[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const row of rows) {
    // columnName must not be empty
    if (!row.columnName || !row.columnName.trim()) {
      errors.push({ rowId: row.id, field: 'columnName', message: 'Column Name is required' });
    }

    // dataType must not be null/empty
    if (!row.dataType) {
      errors.push({ rowId: row.id, field: 'dataType', message: 'DataType is required' });
    } else if (!ALLOWED_DATA_TYPES.includes(row.dataType)) {
      errors.push({ rowId: row.id, field: 'dataType', message: 'Invalid DataType value' });
    }

    // When dataType === 'String': length must be non-empty
    if (row.dataType === 'String' && !row.length) {
      errors.push({
        rowId: row.id,
        field: 'length',
        message: 'Length is required when DataType is "String"',
      });
    }

    // When dataType === 'String': length must be less than 65535
    if (row.dataType === 'String' && parseInt(row.length) > 65535) {
      errors.push({
        rowId: row.id,
        field: 'length',
        message: 'String length cannot be greater than 65535',
      });
    }

    // When length is provided (non-empty): must parse as a positive integer
    if (row.length) {
      const parsed = parseInt(row.length, 10);
      if (isNaN(parsed) || parsed <= 0 || String(parsed) !== row.length) {
        errors.push({
          rowId: row.id,
          field: 'length',
          message: 'Length must be a positive integer',
        });
      }
    }

    // sampleValue must not be empty
    if (!row.sampleValue || !row.sampleValue.trim()) {
      errors.push({ rowId: row.id, field: 'sampleValue', message: 'Sample Value is required' });
    }
  }

  return errors;
}

const resolver = new Resolver();

// Retrieve table data for a macro instance
resolver.define('getTableData', async (req: ResolverRequest) => {
  console.log("Starting resolver for getTableData");
  const payload = req.payload as GetTableDataPayload;
  const storageKey = getStorageKey(payload);
  const storageKeyName = `table:${storageKey}`;

  try {
    const data = await kvs.get(storageKeyName);
    if (!data && payload?.macroId && payload?.storageKey && payload.storageKey !== payload.macroId) {
      const legacyData = await kvs.get(`table:${payload.macroId}`);
      if (legacyData) {
        return legacyData as TableData;
      }
    }
    if (!data) return null;
    // Backward compatibility: legacy records may not have a metadata field
    const record = data as TableData;
    if (!record.metadata) {
      return { ...record, metadata: getDefaultMetadata() } as TableData;
    }
    return record;
  } catch (error) {
    console.error('[getTableData] Storage read failed', { storageKey, error });
    throw error;
  }
});

// Save table data for a macro instance (with validation)
resolver.define('saveTableData', async (req: ResolverRequest) => {
  const payload = req.payload as SaveTableDataPayload;
  const { metadata, rows } = payload;

  const errors = validateRows(rows);
  if (errors.length > 0) {
    return { success: false, errors } as SaveTableDataResponse;
  }

  const storageKey = getStorageKey(payload);
  const storageKeyName = `table:${storageKey}`;
  try {
    await kvs.set(storageKeyName, { metadata, rows, updatedAt: new Date().toISOString() });
    return { success: true } as SaveTableDataResponse;
  } catch (error) {
    console.error('[saveTableData] Storage write failed', { storageKey, error });
    throw error;
  }
});

// Error logging resolver
resolver.define('logError', (req: ResolverRequest) => {
  const errorData = req.payload as {
    message: string;
    stack?: string;
    source?: string;
    lineno?: number;
    colno?: number;
    timestamp: string;
    userAgent?: string;
    url?: string;
  };

  // Log structured error data to Forge logging platform
  console.error('[Frontend Error]', {
    message: errorData.message,
    stack: errorData.stack,
    source: errorData.source,
    line: errorData.lineno,
    column: errorData.colno,
    timestamp: errorData.timestamp,
    userAgent: errorData.userAgent,
    url: errorData.url,
  });

  return { success: true };
});

// Type assertion to avoid export naming issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = resolver.getDefinitions() as any;
