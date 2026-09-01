import readXlsxFile from "read-excel-file/node";

/**
 * File parsing for the import system (spec §68: "Support CSV, Excel, Bulk
 * uploads"). Both formats are normalised to one `ParsedTable` so nothing
 * downstream — mapping, validation, dedup — has to know which it came from.
 *
 * Values are kept as strings on purpose. A spreadsheet cell holding `75201`
 * is a ZIP code, not a number, and letting a parser decide otherwise is how
 * leading zeros vanish from postal codes. Typing happens in validation,
 * where the target field is known.
 */
export interface ParsedTable {
  headers: string[];
  /** One entry per data row; always the same length as `headers`. */
  rows: string[][];
  /** Rows dropped because they were entirely empty, for the summary. */
  skippedEmptyRows: number;
  /** Which worksheet was read, and the others that were ignored (xlsx only). */
  sheetName?: string;
  otherSheetNames?: string[];
}

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportParseError";
  }
}

/** 5MB of spreadsheet is already ~50k properties; beyond that is a mistake. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;

export function detectFormat(filename: string): "csv" | "tsv" | "xlsx" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return "xlsx";
  if (lower.endsWith(".tsv") || lower.endsWith(".tab")) return "tsv";
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return "csv";
  throw new ImportParseError(
    `Unsupported file type. Upload a .csv, .tsv, or .xlsx file (got "${filename}").`,
  );
}

export async function parseImportFile(filename: string, bytes: Buffer): Promise<ParsedTable> {
  if (bytes.byteLength === 0) throw new ImportParseError("That file is empty.");
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ImportParseError(
      `That file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_IMPORT_BYTES / 1024 / 1024}MB — split it into smaller files.`,
    );
  }

  const format = detectFormat(filename);
  const table = format === "xlsx" ? await parseXlsx(bytes) : parseDelimited(bytes.toString("utf8"), format === "tsv" ? "\t" : ",");

  if (table.headers.length === 0) throw new ImportParseError("No column headers were found in the first row.");
  if (table.rows.length === 0) throw new ImportParseError("The file has headers but no data rows.");
  if (table.rows.length > MAX_IMPORT_ROWS) {
    throw new ImportParseError(`That file has ${table.rows.length} rows. The limit is ${MAX_IMPORT_ROWS} per import.`);
  }
  return table;
}

/**
 * RFC 4180 delimited parsing, hand-written because the rules are small and
 * the failure modes are specific: a quoted field may contain the delimiter,
 * a newline, or an escaped `""` quote, and getting that wrong silently
 * shifts every subsequent column. Handles a UTF-8 BOM and CRLF, both of
 * which arrive constantly from Excel exports.
 */
export function parseDelimited(text: string, delimiter: string): ParsedTable {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      record.push(field);
      field = "";
    } else if (char === "\r") {
      // Swallow CR; the LF that follows ends the record.
      if (input[i + 1] !== "\n") {
        record.push(field);
        records.push(record);
        record = [];
        field = "";
      }
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  // A file not ending in a newline still has a final record.
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return toTable(records.map((r) => r.map((cell) => cell.trim())));
}

/** What `read-excel-file/node` returns for a Buffer: one entry per sheet. */
interface SheetResult {
  sheet: string;
  data: unknown[][];
}

async function parseXlsx(bytes: Buffer): Promise<ParsedTable> {
  let raw: unknown;
  try {
    // read-excel-file handles the parts that make hand-rolling xlsx risky:
    // shared vs inline strings, style-driven date detection, sparse cells.
    raw = await readXlsxFile(bytes);
  } catch (err) {
    throw new ImportParseError(
      `That .xlsx file could not be read (${err instanceof Error ? err.message : "unknown error"}). ` +
        "If it was exported from another system, try saving it as CSV instead.",
    );
  }

  // Given a Buffer this returns [{sheet, data}], NOT a flat 2D array — a
  // difference a round-trip test caught, and the reason the shape is
  // checked here rather than assumed.
  const sheets = toSheetResults(raw);
  if (sheets.length === 0 || sheets[0].data.length === 0) {
    throw new ImportParseError("That workbook has no readable rows in its first sheet.");
  }

  const [first, ...rest] = sheets;
  const table = toTable(first.data.map((row) => (Array.isArray(row) ? row.map(cellToString) : [])));
  // Only the first sheet is imported. Surfaced rather than silent, so a user
  // whose data is on "Sheet2" finds out from the preview instead of from an
  // empty import.
  return { ...table, sheetName: first.sheet, otherSheetNames: rest.map((s) => s.sheet) };
}

function toSheetResults(raw: unknown): SheetResult[] {
  if (!Array.isArray(raw)) return [];
  // Tolerate the flat 2D form too, in case a future version returns it for
  // a single-sheet workbook.
  if (raw.length > 0 && Array.isArray(raw[0])) {
    return [{ sheet: "Sheet1", data: raw as unknown[][] }];
  }
  return raw
    .filter((entry): entry is SheetResult =>
      Boolean(entry) && typeof entry === "object" && "data" in (entry as object) && Array.isArray((entry as SheetResult).data),
    )
    .map((entry) => ({ sheet: String(entry.sheet ?? "Sheet1"), data: entry.data }));
}

/**
 * Dates are the one type worth preserving as an ISO date rather than
 * whatever `String(value)` produces, since "Mon Jan 01 1998 00:00:00 GMT+0000"
 * is useless to a downstream date parser.
 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/**
 * Turns raw records into a rectangular table: the first non-empty record is
 * the header, and every data row is padded or truncated to match it. Ragged
 * rows are normal in exported files, and silently letting them shift columns
 * is far worse than padding.
 */
function toTable(records: string[][]): ParsedTable {
  const nonEmpty = (r: string[]) => r.some((cell) => cell !== "");

  const headerIndex = records.findIndex(nonEmpty);
  if (headerIndex === -1) return { headers: [], rows: [], skippedEmptyRows: 0 };

  const headers = records[headerIndex].map((h, i) => (h === "" ? `Column ${i + 1}` : h));
  const body = records.slice(headerIndex + 1);
  const rows: string[][] = [];
  let skippedEmptyRows = 0;

  for (const record of body) {
    if (!nonEmpty(record)) {
      skippedEmptyRows++;
      continue;
    }
    const row = headers.map((_, i) => record[i] ?? "");
    rows.push(row);
  }

  return { headers, rows, skippedEmptyRows };
}
