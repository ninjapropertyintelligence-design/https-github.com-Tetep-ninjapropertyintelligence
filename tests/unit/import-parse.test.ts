import { describe, expect, it } from "vitest";
import { ImportParseError, MAX_IMPORT_BYTES, detectFormat, parseDelimited, parseImportFile } from "@/lib/import/parse";
import { buildXlsx } from "../helpers/xlsx-fixture";

/**
 * The CSV parser is hand-written (RFC 4180), so it is tested against the
 * cases that actually break naive splitting — quoted delimiters, embedded
 * newlines, escaped quotes, BOMs, CRLF. Getting any of these wrong shifts
 * every later column silently, which is worse than failing.
 *
 * The xlsx path delegates to `read-excel-file`; it is tested by round-trip
 * against a fixture written by hand from the OOXML spec, so a disagreement
 * between writer and parser fails the test rather than passing quietly.
 */
describe("CSV parsing", () => {
  it("parses a plain file", () => {
    const table = parseDelimited("name,city\nStore 1052,Dallas\nStore 2210,Austin\n", ",");
    expect(table.headers).toEqual(["name", "city"]);
    expect(table.rows).toEqual([
      ["Store 1052", "Dallas"],
      ["Store 2210", "Austin"],
    ]);
  });

  it("keeps a delimiter inside a quoted field", () => {
    const table = parseDelimited('name,address\nStore,"1200 Main St, Suite 4"\n', ",");
    expect(table.rows[0]).toEqual(["Store", "1200 Main St, Suite 4"]);
  });

  it("keeps a newline inside a quoted field", () => {
    const table = parseDelimited('name,notes\nStore,"line one\nline two"\n', ",");
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0][1]).toBe("line one\nline two");
  });

  it('unescapes doubled quotes ("" -> ")', () => {
    const table = parseDelimited('name\n"Café ""Downtown"""\n', ",");
    expect(table.rows[0][0]).toBe('Café "Downtown"');
  });

  it("handles CRLF line endings, which Excel exports constantly", () => {
    const table = parseDelimited("name,city\r\nStore,Dallas\r\n", ",");
    expect(table.headers).toEqual(["name", "city"]);
    expect(table.rows).toEqual([["Store", "Dallas"]]);
  });

  it("strips a UTF-8 BOM instead of corrupting the first header", () => {
    const table = parseDelimited("﻿name,city\nStore,Dallas\n", ",");
    // Without this the first column is named "﻿name" and no mapping
    // rule ever matches it.
    expect(table.headers[0]).toBe("name");
  });

  it("parses a final row with no trailing newline", () => {
    const table = parseDelimited("name,city\nStore,Dallas", ",");
    expect(table.rows).toEqual([["Store", "Dallas"]]);
  });

  it("pads a short row rather than letting columns shift", () => {
    const table = parseDelimited("a,b,c\n1,2\n", ",");
    expect(table.rows[0]).toEqual(["1", "2", ""]);
  });

  it("truncates an over-long row to the header width", () => {
    const table = parseDelimited("a,b\n1,2,3\n", ",");
    expect(table.rows[0]).toEqual(["1", "2"]);
  });

  it("skips blank rows and counts them", () => {
    const table = parseDelimited("a,b\n1,2\n\n\n3,4\n", ",");
    expect(table.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(table.skippedEmptyRows).toBe(2);
  });

  it("names unnamed header columns rather than producing an empty key", () => {
    const table = parseDelimited("name,,city\nStore,x,Dallas\n", ",");
    expect(table.headers).toEqual(["name", "Column 2", "city"]);
  });

  it("supports TSV", () => {
    const table = parseDelimited("name\tcity\nStore 1052\tDallas\n", "\t");
    expect(table.rows[0]).toEqual(["Store 1052", "Dallas"]);
  });
});

describe("format detection", () => {
  it.each([
    ["portfolio.csv", "csv"],
    ["portfolio.CSV", "csv"],
    ["portfolio.tsv", "tsv"],
    ["portfolio.xlsx", "xlsx"],
    ["portfolio.xlsm", "xlsx"],
  ])("%s -> %s", (filename, expected) => {
    expect(detectFormat(filename)).toBe(expected);
  });

  it("rejects an unsupported type with a message naming what is accepted", () => {
    expect(() => detectFormat("portfolio.pdf")).toThrow(/\.csv, \.tsv, or \.xlsx/);
  });
});

describe("xlsx parsing", () => {
  it("round-trips headers and rows", async () => {
    const table = await parseImportFile(
      "portfolio.xlsx",
      buildXlsx([
        ["Store Name", "Customer ID", "City"],
        ["Store #1052", "STORE-1052", "Dallas"],
        ["Store #2210", "STORE-2210", "Austin"],
      ]),
    );
    expect(table.headers).toEqual(["Store Name", "Customer ID", "City"]);
    expect(table.rows).toEqual([
      ["Store #1052", "STORE-1052", "Dallas"],
      ["Store #2210", "STORE-2210", "Austin"],
    ]);
  });

  it("preserves a leading-zero postal code", async () => {
    // The reason every cell stays a string: a parser that decided 07030 was
    // a number would silently turn a Hoboken ZIP into 7030.
    const table = await parseImportFile("p.xlsx", buildXlsx([["Zip"], ["07030"]]));
    expect(table.rows[0][0]).toBe("07030");
  });

  it("keeps quotes and accents intact", async () => {
    const table = await parseImportFile("p.xlsx", buildXlsx([["Name"], ['Café "Downtown"']]));
    expect(table.rows[0][0]).toBe('Café "Downtown"');
  });

  it("reads the first sheet and reports the ones it ignored", async () => {
    const table = await parseImportFile("p.xlsx", buildXlsx([["Name"], ["Store"]]));
    expect(table.sheetName).toBe("Sheet1");
    expect(table.otherSheetNames).toEqual([]);
  });

  it("fills sparse cells so columns cannot shift", async () => {
    const table = await parseImportFile("p.xlsx", buildXlsx([["a", "b", "c"], ["1", null, "3"]]));
    expect(table.rows[0]).toEqual(["1", "", "3"]);
  });
});

describe("guardrails", () => {
  it("rejects an empty file", async () => {
    await expect(parseImportFile("p.csv", Buffer.alloc(0))).rejects.toThrow(/empty/i);
  });

  it("rejects a file with headers but no data rows", async () => {
    await expect(parseImportFile("p.csv", Buffer.from("name,city\n"))).rejects.toThrow(/no data rows/i);
  });

  it("rejects a file over the size limit, saying what the limit is", async () => {
    const tooBig = Buffer.alloc(MAX_IMPORT_BYTES + 1, 0x61);
    await expect(parseImportFile("p.csv", tooBig)).rejects.toThrow(/limit is 5MB/);
  });

  it("throws ImportParseError, not a generic Error, so routes can map it to a 400", async () => {
    await expect(parseImportFile("p.pdf", Buffer.from("x"))).rejects.toBeInstanceOf(ImportParseError);
  });
});
