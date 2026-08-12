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

function getStorageKey(payload: { storageKey?: string; macroId?: string } | undefined): string | undefined {
  return payload?.storageKey || payload?.macroId;
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
