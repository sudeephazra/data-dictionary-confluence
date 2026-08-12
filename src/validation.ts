import type { TableRow, ValidationError } from './types';
import { ALLOWED_DATA_TYPES } from './types';

function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function validateSampleValue(row: TableRow): string | null {
  if (!row.sampleValue.trim()) {
    return 'Sample Value is required';
  }

  if (row.dataType !== 'String') {
    return null;
  }

  const maximumLength = parsePositiveInteger(row.length);
  if (maximumLength !== null && Array.from(row.sampleValue).length > maximumLength) {
    return `Sample value exceeds the maximum length of ${maximumLength} characters.`;
  }

  return null;
}

export function validateRows(rows: TableRow[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const row of rows) {
    if (!row.columnName.trim()) {
      errors.push({ rowId: row.id, field: 'columnName', message: 'Column Name is required' });
    }

    if (!row.dataType) {
      errors.push({ rowId: row.id, field: 'dataType', message: 'DataType is required' });
    } else if (!ALLOWED_DATA_TYPES.includes(row.dataType)) {
      errors.push({ rowId: row.id, field: 'dataType', message: 'Invalid DataType value' });
    }

    if (row.dataType === 'String' && !row.length) {
      errors.push({ rowId: row.id, field: 'length', message: 'Length is required when DataType is "String"' });
    }

    if (row.dataType === 'String' && Number(row.length) > 65535) {
      errors.push({ rowId: row.id, field: 'length', message: 'String length cannot be greater than 65535' });
    }

    if (row.length && parsePositiveInteger(row.length) === null) {
      errors.push({ rowId: row.id, field: 'length', message: 'Length must be a positive integer' });
    }

    const sampleValueError = validateSampleValue(row);
    if (sampleValueError) {
      errors.push({ rowId: row.id, field: 'sampleValue', message: sampleValueError });
    }
  }

  return errors;
}
