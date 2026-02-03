/**
 * CSV Adapter for SAP SE16/SE16N Exports
 *
 * Parses CSV files exported from SAP's SE16/SE16N transaction, which
 * is the standard way consultants extract table data during assessments.
 *
 * Supports:
 * - Pipe-delimited (SE16N default) and comma-delimited formats
 * - SAP date formats (YYYYMMDD, DD.MM.YYYY)
 * - SAP amount formats (comma as decimal separator in EU locales)
 * - Multiple tables in a single load (BKPF, BSEG, SKA1, etc.)
 * - Auto-detection of delimiter and format
 *
 * Architecture:
 * - Extends BaseDataAdapter (required by adapter registry)
 * - Adds FI/CO-specific methods beyond the standard 8 O2C tools
 * - Stores parsed FI/CO data in a FICoDataset for forensic tools
 */

import { BaseDataAdapter, registerAdapter } from '../adapter-interface.js';
import {
  SearchDocTextParams,
  SearchResult,
  DocTextParams,
  DocTextResult,
  DocFlowParams,
  DocFlowResult,
  SalesDocHeaderParams,
  SalesDocHeader,
  SalesDocItemsParams,
  SalesDocItem,
  DeliveryTimingParams,
  DeliveryTimingResult,
  InvoiceTimingParams,
  InvoiceTimingResult,
  MasterStubParams,
  MasterStub,
} from '../../types/index.js';

import { BKPF, BSEG, SKA1, SKAT, CSKS, COEP, T001, FICoDataset } from '../../types/fi-co.js';

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, basename } from 'path';

// ============================================================================
// CSV Parsing Utilities
// ============================================================================

/**
 * Detect the delimiter used in a CSV file
 * SAP SE16N typically uses pipe '|', but comma and tab are also common
 */
function detectDelimiter(firstLine: string): string {
  const candidates = [
    { char: '|', count: (firstLine.match(/\|/g) || []).length },
    { char: '\t', count: (firstLine.match(/\t/g) || []).length },
    { char: ';', count: (firstLine.match(/;/g) || []).length },
    { char: ',', count: (firstLine.match(/,/g) || []).length },
  ];

  // SE16N pipe-delimited lines often start and end with '|'
  if (firstLine.startsWith('|') && firstLine.endsWith('|')) {
    return '|';
  }

  // Pick the delimiter with the highest count
  candidates.sort((a, b) => b.count - a.count);
  return candidates[0]?.char || ',';
}

/**
 * Parse a SAP date string into YYYYMMDD format
 * Handles: YYYYMMDD, DD.MM.YYYY, YYYY-MM-DD, MM/DD/YYYY
 */
function parseSAPDate(value: string): string {
  if (!value || value.trim() === '' || value === '00000000') return '';

  const trimmed = value.trim();

  // Already YYYYMMDD
  if (/^\d{8}$/.test(trimmed)) return trimmed;

  // DD.MM.YYYY (European format, common in SAP)
  const euMatch = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (euMatch) return `${euMatch[3]}${euMatch[2]}${euMatch[1]}`;

  // YYYY-MM-DDTHH:MM:SS (ISO datetime from SQLite/database exports)
  const isoDateTimeMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoDateTimeMatch) return `${isoDateTimeMatch[1]}${isoDateTimeMatch[2]}${isoDateTimeMatch[3]}`;

  // YYYY-MM-DD (ISO format)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;

  // MM/DD/YYYY (US format)
  const usMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (usMatch) return `${usMatch[3]}${usMatch[1]}${usMatch[2]}`;

  return trimmed;
}

/**
 * Parse a SAP amount field
 * SAP can use comma as decimal separator (1.234,56) or period (1,234.56)
 */
function parseSAPAmount(value: string): number {
  if (!value || value.trim() === '') return 0;

  let trimmed = value.trim();

  // Remove currency symbols and whitespace
  trimmed = trimmed.replace(/[A-Z]{3}\s*/g, '').trim();

  // Handle negative amounts indicated by trailing minus or parentheses
  let negative = false;
  if (trimmed.endsWith('-')) {
    negative = true;
    trimmed = trimmed.slice(0, -1);
  }
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    negative = true;
    trimmed = trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('-')) {
    negative = true;
    trimmed = trimmed.slice(1);
  }

  // Detect European vs US number format
  // European: 1.234,56 (period as thousands, comma as decimal)
  // US/Standard: 1,234.56 (comma as thousands, period as decimal)
  const lastComma = trimmed.lastIndexOf(',');
  const lastPeriod = trimmed.lastIndexOf('.');

  let parsed: number;
  if (lastComma > lastPeriod) {
    // European format: comma is decimal separator
    parsed = parseFloat(trimmed.replace(/\./g, '').replace(',', '.'));
  } else {
    // US/Standard format: period is decimal separator
    parsed = parseFloat(trimmed.replace(/,/g, ''));
  }

  if (isNaN(parsed)) return 0;
  return negative ? -parsed : parsed;
}

/**
 * Parse a single CSV line respecting quotes
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());

  return fields;
}

/**
 * Detect which SAP table a CSV file represents based on column headers
 */
function detectTableType(headers: string[]): string | null {
  const headerSet = new Set(headers.map(h => h.toUpperCase()));

  // BKPF: Must have BUKRS, BELNR, GJAHR, BLART
  if (
    headerSet.has('BUKRS') &&
    headerSet.has('BELNR') &&
    headerSet.has('GJAHR') &&
    headerSet.has('BLART')
  ) {
    // Distinguish BKPF from BSEG by checking for BUZEI (line item number)
    if (headerSet.has('BUZEI') || headerSet.has('BSCHL') || headerSet.has('HKONT')) {
      return 'BSEG';
    }
    return 'BKPF';
  }

  // BSEG: Has BUZEI and HKONT
  if (headerSet.has('BUZEI') && headerSet.has('HKONT')) {
    return 'BSEG';
  }

  // SKA1: Chart of accounts
  if (headerSet.has('KTOPL') && headerSet.has('SAKNR') && !headerSet.has('SPRAS')) {
    return 'SKA1';
  }

  // SKAT: Account descriptions (has SPRAS language key)
  if (headerSet.has('KTOPL') && headerSet.has('SAKNR') && headerSet.has('SPRAS')) {
    return 'SKAT';
  }

  // CSKS: Cost centers
  if (headerSet.has('KOKRS') && headerSet.has('KOSTL')) {
    return 'CSKS';
  }

  // COEP: CO line items
  if (headerSet.has('KOKRS') && headerSet.has('KSTAR') && headerSet.has('OBJNR')) {
    return 'COEP';
  }

  // T001: Company codes
  if (headerSet.has('BUKRS') && headerSet.has('BUTXT') && headerSet.has('LAND1')) {
    return 'T001';
  }

  return null;
}

// ============================================================================
// Field Mapping: CSV columns → TypeScript interfaces
// ============================================================================

/** Date fields that need SAP date parsing */
const DATE_FIELDS = new Set([
  'BLDAT',
  'BUDAT',
  'CPUDT',
  'AUDAT',
  'ERDAT',
  'AEDAT',
  'AUGDT',
  'ZFBDT',
  'DATAB',
  'DATBI',
  'MADAT',
  'TXDAT',
]);

/** Time fields — extract HH:MM:SS from ISO datetime if needed */
const TIME_FIELDS = new Set(['CPUTM']);

/** Amount fields that need SAP amount parsing */
const AMOUNT_FIELDS = new Set([
  'WRBTR',
  'DMBTR',
  'NETWR',
  'MWSBK',
  'WKGBTR',
  'WOGBTR',
  'MWSTS',
  'HWBAS',
  'FWBAS',
  'NAVHW',
  'NAVFW',
  'SKFBT',
  'SKNTO',
]);

/**
 * Transform a raw CSV row into a typed record
 */
function transformRow(
  headers: string[],
  values: string[],
  _tableType: string
): Record<string, unknown> {
  const record: Record<string, unknown> = {};

  for (let i = 0; i < headers.length && i < values.length; i++) {
    const field = headers[i]!.toUpperCase();
    const value = values[i] || '';

    if (DATE_FIELDS.has(field)) {
      record[field] = parseSAPDate(value);
    } else if (TIME_FIELDS.has(field)) {
      // Extract time from ISO datetime (e.g., "1970-01-01T11:44:35" → "114435")
      const timeMatch = value.match(/T(\d{2}):(\d{2}):(\d{2})/);
      if (timeMatch) {
        record[field] = `${timeMatch[1]}${timeMatch[2]}${timeMatch[3]}`;
      } else if (/^\d{6}$/.test(value.trim())) {
        record[field] = value.trim(); // Already HHMMSS
      } else {
        record[field] = value;
      }
    } else if (AMOUNT_FIELDS.has(field)) {
      record[field] = parseSAPAmount(value);
    } else {
      record[field] = value;
    }
  }

  return record;
}

// ============================================================================
// CSV Data Store (shared with forensic tools)
// ============================================================================

/** Singleton store for loaded FI/CO data */
let activeDataset: FICoDataset | null = null;

/**
 * Get the currently loaded FI/CO dataset
 * Used by forensic analysis tools to access parsed data
 */
export function getFICoDataset(): FICoDataset | null {
  return activeDataset;
}

// ============================================================================
// CSV Adapter Implementation
// ============================================================================

export class CSVAdapter extends BaseDataAdapter {
  readonly name = 'csv';
  private filePaths: string[];
  private dataset: FICoDataset;

  constructor(filePaths?: string | string[]) {
    super();
    if (!filePaths) {
      this.filePaths = [];
    } else if (typeof filePaths === 'string') {
      this.filePaths = [filePaths];
    } else {
      this.filePaths = filePaths;
    }

    this.dataset = {
      bkpf: [],
      bseg: [],
      ska1: [],
      skat: [],
      csks: [],
      coep: [],
      t001: [],
      metadata: {
        source: 'csv',
        loaded_at: new Date().toISOString(),
        record_counts: {},
      },
    };
  }

  /**
   * Parse a single CSV file and add records to the dataset
   */
  async loadCSVFile(filePath: string): Promise<{ table: string; records: number }> {
    const absolutePath = resolve(filePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`CSV file not found: ${absolutePath}`);
    }

    const content = await readFile(absolutePath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');

    if (lines.length < 2) {
      throw new Error(`CSV file has no data rows: ${absolutePath}`);
    }

    // SE16N exports sometimes have a header line starting with '|'
    let headerLine = lines[0]!;
    let dataStartIndex = 1;

    // Skip separator lines (e.g., |---|---|---|)
    if (lines[1] && /^[|\-+\s]+$/.test(lines[1])) {
      dataStartIndex = 2;
    }

    // Detect delimiter
    const delimiter = detectDelimiter(headerLine);

    // For pipe-delimited SE16N exports, strip leading/trailing pipes
    if (delimiter === '|') {
      headerLine = headerLine.replace(/^\|/, '').replace(/\|$/, '');
      // Also handle lines that start/end with pipe
    }

    // Parse headers
    const headers = parseCSVLine(headerLine, delimiter).map(h => h.trim().toUpperCase());

    // Detect table type
    const tableType = detectTableType(headers);
    if (!tableType) {
      throw new Error(
        `Cannot determine SAP table type from headers: ${headers.slice(0, 10).join(', ')}. ` +
          `File: ${basename(absolutePath)}`
      );
    }

    // Parse data rows
    const records: Record<string, unknown>[] = [];
    for (let i = dataStartIndex; i < lines.length; i++) {
      let line = lines[i]!;

      // Skip empty lines and separator lines
      if (!line.trim() || /^[|\-+\s]+$/.test(line)) continue;

      // Strip leading/trailing pipes for SE16N format
      if (delimiter === '|') {
        line = line.replace(/^\|/, '').replace(/\|$/, '');
      }

      const values = parseCSVLine(line, delimiter);
      if (values.length < 2) continue; // Skip malformed lines

      const record = transformRow(headers, values, tableType);
      records.push(record);
    }

    // Add records to appropriate dataset collection
    switch (tableType) {
      case 'BKPF':
        this.dataset.bkpf.push(...(records as unknown as BKPF[]));
        break;
      case 'BSEG':
        this.dataset.bseg.push(...(records as unknown as BSEG[]));
        break;
      case 'SKA1':
        this.dataset.ska1.push(...(records as unknown as SKA1[]));
        break;
      case 'SKAT':
        this.dataset.skat.push(...(records as unknown as SKAT[]));
        break;
      case 'CSKS':
        this.dataset.csks.push(...(records as unknown as CSKS[]));
        break;
      case 'COEP':
        this.dataset.coep.push(...(records as unknown as COEP[]));
        break;
      case 'T001':
        this.dataset.t001.push(...(records as unknown as T001[]));
        break;
    }

    this.dataset.metadata.record_counts[tableType] =
      (this.dataset.metadata.record_counts[tableType] || 0) + records.length;

    return { table: tableType, records: records.length };
  }

  /**
   * Load data from a combined CSV file containing multiple tables
   * Tables are separated by a blank line and a new header row
   */
  async loadCombinedCSV(filePath: string): Promise<Array<{ table: string; records: number }>> {
    const absolutePath = resolve(filePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`CSV file not found: ${absolutePath}`);
    }

    const content = await readFile(absolutePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const results: Array<{ table: string; records: number }> = [];

    // Split into sections by blank lines
    let currentSection: string[] = [];
    const sections: string[][] = [];

    for (const line of lines) {
      if (line.trim() === '' && currentSection.length > 0) {
        sections.push(currentSection);
        currentSection = [];
      } else if (line.trim() !== '') {
        currentSection.push(line);
      }
    }
    if (currentSection.length > 0) {
      sections.push(currentSection);
    }

    // Process each section as a separate table
    for (const section of sections) {
      if (section.length < 2) continue;

      const headerLine = section[0]!;
      const delimiter = detectDelimiter(headerLine);
      let cleanHeader = headerLine;
      if (delimiter === '|') {
        cleanHeader = headerLine.replace(/^\|/, '').replace(/\|$/, '');
      }

      const headers = parseCSVLine(cleanHeader, delimiter).map(h => h.trim().toUpperCase());
      const tableType = detectTableType(headers);
      if (!tableType) continue;

      let dataStart = 1;
      if (section[1] && /^[|\-+\s]+$/.test(section[1])) {
        dataStart = 2;
      }

      const records: Record<string, unknown>[] = [];
      for (let i = dataStart; i < section.length; i++) {
        let line = section[i]!;
        if (!line.trim() || /^[|\-+\s]+$/.test(line)) continue;
        if (delimiter === '|') {
          line = line.replace(/^\|/, '').replace(/\|$/, '');
        }
        const values = parseCSVLine(line, delimiter);
        if (values.length < 2) continue;
        records.push(transformRow(headers, values, tableType));
      }

      switch (tableType) {
        case 'BKPF':
          this.dataset.bkpf.push(...(records as unknown as BKPF[]));
          break;
        case 'BSEG':
          this.dataset.bseg.push(...(records as unknown as BSEG[]));
          break;
        case 'SKA1':
          this.dataset.ska1.push(...(records as unknown as SKA1[]));
          break;
        case 'SKAT':
          this.dataset.skat.push(...(records as unknown as SKAT[]));
          break;
        case 'CSKS':
          this.dataset.csks.push(...(records as unknown as CSKS[]));
          break;
        case 'COEP':
          this.dataset.coep.push(...(records as unknown as COEP[]));
          break;
        case 'T001':
          this.dataset.t001.push(...(records as unknown as T001[]));
          break;
      }

      this.dataset.metadata.record_counts[tableType] =
        (this.dataset.metadata.record_counts[tableType] || 0) + records.length;
      results.push({ table: tableType, records: records.length });
    }

    return results;
  }

  /**
   * Get the loaded FI/CO dataset
   */
  getDataset(): FICoDataset {
    return this.dataset;
  }

  // ============================================================================
  // BaseDataAdapter Lifecycle
  // ============================================================================

  protected async doInitialize(): Promise<void> {
    // Load all configured CSV files
    for (const filePath of this.filePaths) {
      if (filePath.endsWith('.csv') || filePath.endsWith('.txt')) {
        await this.loadCSVFile(filePath);
      }
    }

    this.dataset.metadata.loaded_at = new Date().toISOString();

    // Set as active dataset for forensic tools
    activeDataset = this.dataset;
  }

  protected async doShutdown(): Promise<void> {
    if (activeDataset === this.dataset) {
      activeDataset = null;
    }
    this.dataset = {
      bkpf: [],
      bseg: [],
      ska1: [],
      skat: [],
      csks: [],
      coep: [],
      t001: [],
      metadata: {
        source: 'csv',
        loaded_at: '',
        record_counts: {},
      },
    };
  }

  // ============================================================================
  // IDataAdapter Methods (O2C tools — minimal implementation for CSV)
  // The CSV adapter is primarily for FI/CO forensics, not O2C analysis.
  // These return empty/null results since CSV data is FI/CO focused.
  // ============================================================================

  async searchDocText(_params: SearchDocTextParams): Promise<SearchResult[]> {
    this.ensureInitialized();
    return [];
  }

  async getDocText(_params: DocTextParams): Promise<DocTextResult> {
    this.ensureInitialized();
    return { header_texts: [], item_texts: [] };
  }

  async getDocFlow(_params: DocFlowParams): Promise<DocFlowResult> {
    this.ensureInitialized();
    return { root_document: '', flow: [] };
  }

  async getSalesDocHeader(_params: SalesDocHeaderParams): Promise<SalesDocHeader | null> {
    this.ensureInitialized();
    return null;
  }

  async getSalesDocItems(_params: SalesDocItemsParams): Promise<SalesDocItem[]> {
    this.ensureInitialized();
    return [];
  }

  async getDeliveryTiming(_params: DeliveryTimingParams): Promise<DeliveryTimingResult | null> {
    this.ensureInitialized();
    return null;
  }

  async getInvoiceTiming(_params: InvoiceTimingParams): Promise<InvoiceTimingResult | null> {
    this.ensureInitialized();
    return null;
  }

  async getMasterStub(_params: MasterStubParams): Promise<MasterStub | null> {
    this.ensureInitialized();
    return null;
  }
}

// Register in the adapter registry
registerAdapter('csv', () => new CSVAdapter());
