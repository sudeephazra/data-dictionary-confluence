import Resolver from '@forge/resolver';
import { kvs } from '@forge/kvs';
import type {
  TableData,
  GetTableDataPayload,
} from '../types';
import { getDefaultMetadata } from '../types';

// Basic type for Forge resolver request
interface ResolverRequest {
  payload?: unknown;
  context?: {
    accountId?: string;
    cloudId?: string;
    [key: string]: unknown;
  };
}

function getStorageKeyName(storageKey: string | undefined): string {
  if (!storageKey?.trim()) {
    throw new Error('Macro storage key is unavailable');
  }

  return `table:${storageKey}`;
}

function getRequestedStorageKey(payload: { storageKey?: string; macroId?: string } | undefined): string | undefined {
  return payload?.storageKey ?? payload?.macroId;
}

function normalizeTableData(data: unknown): TableData {
  const record = data as TableData;
  return record.metadata ? record : { ...record, metadata: getDefaultMetadata() };
}

const resolver = new Resolver();

// Retrieve table data for a macro instance
resolver.define('getTableData', async (req: ResolverRequest) => {
  console.log("Starting resolver for getTableData");
  const payload = req.payload as GetTableDataPayload;
  const storageKey = getStorageKey(payload);
  if (!storageKey) {
    console.log('[getTableData] No legacy storage key was provided');
    return null;
  }
  const storageKeyName = `table:${storageKey}`;
  const storageKey = getRequestedStorageKey(payload);
  const legacyStorageKey = payload?.legacyStorageKey
    ?? (payload?.storageKey && payload.macroId !== payload.storageKey ? payload.macroId : undefined);
  const storageKeyName = getStorageKeyName(storageKey);

  try {
    const data = await kvs.get(storageKeyName);
    if (!data && legacyStorageKey && legacyStorageKey !== storageKey) {
      const legacyData = await kvs.get(getStorageKeyName(legacyStorageKey));
      if (legacyData) {
        return normalizeTableData(legacyData);
      }
    }
    if (!data) return null;
    return normalizeTableData(data);
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

  const storageKey = getRequestedStorageKey(payload);
  const storageKeyName = getStorageKeyName(storageKey);
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
