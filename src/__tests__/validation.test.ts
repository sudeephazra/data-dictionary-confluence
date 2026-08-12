import type { DataType, TableRow } from '../types';
import { validateRows, validateSampleValue } from '../validation';

function makeRow(overrides: Partial<TableRow> = {}): TableRow {
  return {
    id: 'row-1',
    columnName: 'example_column',
    dataType: 'VARCHAR',
    length: '20',
    nullable: false,
    sortPartitionKey: null,
    copyToRedshift: true,
    sampleValue: 'example',
    pii: false,
    ...overrides,
  };
}

describe('sample-value validation', () => {
  it.each<DataType>(['CHAR', 'VARCHAR', 'STRING', 'TEXT', 'String'])(
    'enforces configured character length for %s',
    (dataType) => {
      const row = makeRow({ dataType, length: '3', sampleValue: 'four' });
      expect(validateSampleValue(row)).toBe('Sample value exceeds the maximum length of 3 characters.');
      expect(validateSampleValue({ ...row, sampleValue: '三字文' })).toBeNull();
    },
  );

  it('allows an empty sample only for nullable columns', () => {
    expect(validateSampleValue(makeRow({ sampleValue: '', nullable: true }))).toBeNull();
    expect(validateSampleValue(makeRow({ sampleValue: '', nullable: false })))
      .toBe('Sample Value is required for a non-nullable column.');
  });

  it.each<DataType>(['SMALLINT', 'INTEGER', 'BIGINT'])(
    'accepts only integer syntax for %s',
    (dataType) => {
      expect(validateSampleValue(makeRow({ dataType, length: '', sampleValue: '-123' }))).toBeNull();
      expect(validateSampleValue(makeRow({ dataType, length: '', sampleValue: '123.45' })))
        .toBe('Expected an integer value.');
      expect(validateSampleValue(makeRow({ dataType, length: '', sampleValue: '12x' })))
        .toBe('Expected an integer value.');
    },
  );

  it.each<DataType>(['DECIMAL', 'NUMERIC'])(
    'enforces configured precision and scale for %s',
    (dataType) => {
      const base = makeRow({ dataType, length: '8,2' });
      expect(validateSampleValue({ ...base, sampleValue: '12345.67' })).toBeNull();
      expect(validateSampleValue({ ...base, sampleValue: '0.50' })).toBeNull();
      expect(validateSampleValue({ ...base, sampleValue: '.50' })).toBeNull();
      expect(validateSampleValue({ ...base, sampleValue: '123456789.10' }))
        .toBe(`Value exceeds ${dataType}(8,2) precision.`);
      expect(validateSampleValue({ ...base, sampleValue: '10.123' }))
        .toBe(`Value exceeds ${dataType}(8,2) scale.`);
      expect(validateSampleValue({ ...base, sampleValue: 'not-a-number' })).toBe('Expected a numeric value.');
    },
  );

  it.each<DataType>(['FLOAT', 'DOUBLE', 'REAL', 'Number'])(
    'accepts finite decimal and scientific notation for %s',
    (dataType) => {
      expect(validateSampleValue(makeRow({ dataType, length: '', sampleValue: '-1.25e+3' }))).toBeNull();
      expect(validateSampleValue(makeRow({ dataType, length: '', sampleValue: 'Infinity' })))
        .toBe('Expected a numeric value.');
    },
  );

  it.each<DataType>(['BOOLEAN', 'Boolean'])('accepts only lowercase true or false for %s', (dataType) => {
    expect(validateSampleValue(makeRow({ dataType, length: '', sampleValue: 'false' }))).toBeNull();
    expect(validateSampleValue(makeRow({ dataType, length: '', sampleValue: 'TRUE' })))
      .toBe('Expected true or false.');
  });

  it.each<DataType>(['DATE', 'Date'])('validates calendar dates for %s', (dataType) => {
    expect(validateSampleValue(makeRow({ dataType, length: '', sampleValue: '2024-02-29' }))).toBeNull();
    expect(validateSampleValue(makeRow({ dataType, length: '', sampleValue: '2025-02-29' })))
      .toBe('Invalid date. Expected YYYY-MM-DD.');
    expect(validateSampleValue(makeRow({ dataType, length: '', sampleValue: '31-12-2025' })))
      .toBe('Invalid date. Expected YYYY-MM-DD.');
  });

  it.each<DataType>(['TIMESTAMP', 'DATETIME', 'DateTime'])(
    'validates timestamps for %s',
    (dataType) => {
      expect(validateSampleValue(makeRow({ dataType, length: '', sampleValue: '2025-12-31 23:59:59' })))
        .toBeNull();
      expect(validateSampleValue(makeRow({ dataType, length: '', sampleValue: '2025-12-31T23:59:59' })))
        .toBe('Invalid timestamp. Expected YYYY-MM-DD HH:MM:SS.');
    },
  );

  it('validates time values', () => {
    expect(validateSampleValue(makeRow({ dataType: 'TIME', length: '', sampleValue: '23:59:59' }))).toBeNull();
    expect(validateSampleValue(makeRow({ dataType: 'TIME', length: '', sampleValue: '24:00:00' })))
      .toBe('Invalid time. Expected HH:MM:SS.');
  });

  it('validates JSON syntax', () => {
    expect(validateSampleValue(makeRow({ dataType: 'JSON', length: '', sampleValue: '{"valid":true}' }))).toBeNull();
    expect(validateSampleValue(makeRow({ dataType: 'JSON', length: '', sampleValue: '{invalid}' })))
      .toBe('Invalid JSON.');
  });

  it.each<DataType>(['BINARY', 'VARBINARY'])('validates hexadecimal binary samples for %s', (dataType) => {
    expect(validateSampleValue(makeRow({ dataType, length: '2', sampleValue: '0x0A1B' }))).toBeNull();
    expect(validateSampleValue(makeRow({ dataType, length: '2', sampleValue: '0x0A1B2C' })))
      .toBe('Binary sample exceeds the maximum length of 2 bytes.');
    expect(validateSampleValue(makeRow({ dataType, length: '', sampleValue: 'not-hex' })))
      .toBe('Expected a hexadecimal value, for example 0x0A1B.');
  });
});

describe('row metadata validation', () => {
  it('requires character length and decimal precision/scale', () => {
    expect(validateRows([makeRow({ dataType: 'VARCHAR', length: '' })]))
      .toContainEqual(expect.objectContaining({ field: 'length', message: 'Length is required when DataType is "VARCHAR".' }));
    expect(validateRows([makeRow({ dataType: 'DECIMAL', length: '' })]))
      .toContainEqual(expect.objectContaining({ field: 'length', message: 'Precision and scale are required, for example 8,2.' }));
    expect(validateRows([makeRow({ dataType: 'DECIMAL', length: '39,2' })]))
      .toContainEqual(expect.objectContaining({ field: 'length', message: expect.stringContaining('precision 1-38') }));
    expect(validateRows([makeRow({ dataType: 'DECIMAL', length: '38,38' })]))
      .toContainEqual(expect.objectContaining({ field: 'length', message: expect.stringContaining('scale 0-37') }));
  });

  it('identifies every invalid field in a row', () => {
    const errors = validateRows([makeRow({
      columnName: '',
      dataType: null,
      length: '',
      sampleValue: '',
    })]);

    expect(errors).toEqual([
      { rowId: 'row-1', field: 'columnName', message: 'Column Name is required.' },
      { rowId: 'row-1', field: 'dataType', message: 'DataType is required.' },
      { rowId: 'row-1', field: 'sampleValue', message: 'Sample Value is required for a non-nullable column.' },
    ]);
  });
});
