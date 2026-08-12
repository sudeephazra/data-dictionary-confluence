import type { DataType, TableRow, ValidationError } from './types';
import { ALLOWED_DATA_TYPES } from './types';

const REQUIRED_LENGTH_TYPES = new Set<DataType>(['CHAR', 'VARCHAR', 'STRING', 'String']);
const CHARACTER_TYPES = new Set<DataType>(['CHAR', 'VARCHAR', 'STRING', 'TEXT', 'String']);
const INTEGER_TYPES = new Set<DataType>(['SMALLINT', 'INTEGER', 'BIGINT']);
const DECIMAL_TYPES = new Set<DataType>(['DECIMAL', 'NUMERIC']);
const FLOAT_TYPES = new Set<DataType>(['FLOAT', 'DOUBLE', 'REAL', 'Number']);
const BOOLEAN_TYPES = new Set<DataType>(['BOOLEAN', 'Boolean']);
const DATE_TYPES = new Set<DataType>(['DATE', 'Date']);
const TIMESTAMP_TYPES = new Set<DataType>(['TIMESTAMP', 'DATETIME', 'DateTime']);
const BINARY_TYPES = new Set<DataType>(['BINARY', 'VARBINARY']);

interface DecimalConstraint {
  precision: number;
  scale: number;
}

function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDecimalConstraint(value: string): DecimalConstraint | null {
  const match = value.trim().match(/^\(?\s*(\d+)\s*,\s*(\d+)\s*\)?$/);
  if (!match) {
    return null;
  }

  const precision = Number(match[1]);
  const scale = Number(match[2]);
  if (
    !Number.isInteger(precision)
    || !Number.isInteger(scale)
    || precision < 1
    || precision > 38
    || scale > 37
    || scale > precision
  ) {
    return null;
  }

  return { precision, scale };
}

function getLengthError(row: TableRow): string | null {
  const { dataType, length } = row;
  if (!dataType) {
    return null;
  }

  if (DECIMAL_TYPES.has(dataType)) {
    if (!length.trim()) {
      return 'Precision and scale are required, for example 8,2.';
    }

    return parseDecimalConstraint(length)
      ? null
      : 'Enter precision and scale as p,s (precision 1-38; scale 0-37 and no greater than precision).';
  }

  if (REQUIRED_LENGTH_TYPES.has(dataType) && !length.trim()) {
    return `Length is required when DataType is "${dataType}".`;
  }

  if (!length.trim()) {
    return null;
  }

  const parsed = parsePositiveInteger(length);
  if (parsed === null) {
    return 'Length must be a positive integer.';
  }

  if (dataType === 'CHAR' && parsed > 4096) {
    return 'CHAR length cannot be greater than 4096.';
  }

  if (CHARACTER_TYPES.has(dataType) && parsed > 65535) {
    return `${dataType} length cannot be greater than 65535.`;
  }

  return null;
}

function isCalendarDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isTime(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  return Boolean(match)
    && Number(match?.[1]) <= 23
    && Number(match?.[2]) <= 59
    && Number(match?.[3]) <= 59;
}

function validateDecimal(value: string, dataType: DataType, length: string): string | null {
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
    return 'Expected a numeric value.';
  }

  const constraint = parseDecimalConstraint(length);
  if (!constraint) {
    return null;
  }

  const unsignedValue = value.replace(/^[+-]/, '');
  const [integerPart = '', fractionPart = ''] = unsignedValue.split('.');
  const fractionDigits = fractionPart.length;
  if (fractionDigits > constraint.scale) {
    return `Value exceeds ${dataType}(${constraint.precision},${constraint.scale}) scale.`;
  }

  const integerDigits = integerPart.replace(/^0+/, '').length;
  if (integerDigits > constraint.precision - constraint.scale) {
    return `Value exceeds ${dataType}(${constraint.precision},${constraint.scale}) precision.`;
  }

  return null;
}

export function validateSampleValue(row: TableRow): string | null {
  const value = row.sampleValue.trim();
  const { dataType } = row;

  if (!value) {
    return row.nullable ? null : 'Sample Value is required for a non-nullable column.';
  }

  if (!dataType) {
    return null;
  }

  if (CHARACTER_TYPES.has(dataType)) {
    const maximumLength = parsePositiveInteger(row.length);
    if (maximumLength !== null && Array.from(row.sampleValue).length > maximumLength) {
      return `Sample value exceeds the maximum length of ${maximumLength} characters.`;
    }
    return null;
  }

  if (INTEGER_TYPES.has(dataType)) {
    return /^[+-]?\d+$/.test(value) ? null : 'Expected an integer value.';
  }

  if (DECIMAL_TYPES.has(dataType)) {
    return validateDecimal(value, dataType, row.length);
  }

  if (FLOAT_TYPES.has(dataType)) {
    const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
    return numericPattern.test(value) && Number.isFinite(Number(value)) ? null : 'Expected a numeric value.';
  }

  if (BOOLEAN_TYPES.has(dataType)) {
    return /^(true|false)$/.test(value) ? null : 'Expected true or false.';
  }

  if (DATE_TYPES.has(dataType)) {
    return isCalendarDate(value) ? null : 'Invalid date. Expected YYYY-MM-DD.';
  }

  if (TIMESTAMP_TYPES.has(dataType)) {
    const match = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
    return match && isCalendarDate(match[1]) && isTime(match[2])
      ? null
      : 'Invalid timestamp. Expected YYYY-MM-DD HH:MM:SS.';
  }

  if (dataType === 'TIME') {
    return isTime(value) ? null : 'Invalid time. Expected HH:MM:SS.';
  }

  if (dataType === 'JSON') {
    try {
      JSON.parse(value);
      return null;
    } catch {
      return 'Invalid JSON.';
    }
  }

  if (BINARY_TYPES.has(dataType)) {
    const hexadecimal = value.startsWith('0x') ? value.slice(2) : value;
    if (!hexadecimal || !/^[0-9a-fA-F]+$/.test(hexadecimal) || hexadecimal.length % 2 !== 0) {
      return 'Expected a hexadecimal value, for example 0x0A1B.';
    }

    const maximumBytes = parsePositiveInteger(row.length);
    if (maximumBytes !== null && hexadecimal.length / 2 > maximumBytes) {
      return `Binary sample exceeds the maximum length of ${maximumBytes} bytes.`;
    }
  }

  return null;
}

export function validateRows(rows: TableRow[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const row of rows) {
    if (!row.columnName.trim()) {
      errors.push({ rowId: row.id, field: 'columnName', message: 'Column Name is required.' });
    }

    if (!row.dataType) {
      errors.push({ rowId: row.id, field: 'dataType', message: 'DataType is required.' });
    } else if (!ALLOWED_DATA_TYPES.includes(row.dataType)) {
      errors.push({ rowId: row.id, field: 'dataType', message: 'Invalid DataType value.' });
    }

    const lengthError = getLengthError(row);
    if (lengthError) {
      errors.push({ rowId: row.id, field: 'length', message: lengthError });
    }

    const sampleValueError = validateSampleValue(row);
    if (sampleValueError) {
      errors.push({ rowId: row.id, field: 'sampleValue', message: sampleValueError });
    }
  }

  return errors;
}
