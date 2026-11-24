import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/app-error.js";

export const CSV_HEADERS = [
  "product_id",
  "part_number",
  "sku",
  "condition",
  "unit_price",
  "stock_quantity",
  "minimum_stock",
  "preparation_time_minutes",
  "is_available",
  "notes",
] as const;

export const CSV_TEMPLATE = `${CSV_HEADERS.join(",")}\n,90915-YZZD2,FILTER-001,NEW,1250.00,10,3,60,true,Example row\n`;

export type CsvInventoryRow = Record<(typeof CSV_HEADERS)[number], string> & {
  rowNumber: number;
};

function csvError(message: string, details: unknown[] = []) {
  return new AppError(message, {
    code: "INVALID_INVENTORY_CSV",
    statusCode: 400,
    details,
  });
}

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (quoted) throw csvError("CSV contains an unterminated quoted value");
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records.filter((row) => row.some((value) => value.trim().length > 0));
}

export function parseInventoryCsv(buffer: Buffer): {
  rows: CsvInventoryRow[];
  sourceHash: string;
} {
  if (buffer.length === 0) throw csvError("CSV file is empty");
  if (buffer.length > 512 * 1024) throw csvError("CSV file exceeds the 512 KiB limit");
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (text.includes("\uFFFD") || text.includes("\0")) {
    throw csvError("CSV must be valid UTF-8 text");
  }
  const records = parseRecords(text);
  if (records.length < 2)
    throw csvError("CSV must contain a header and at least one row");
  if (records.length - 1 > 500) throw csvError("CSV exceeds the 500-row limit");

  const header = records[0]!.map((value) => value.trim().toLowerCase());
  if (
    header.length !== CSV_HEADERS.length ||
    header.some((value, index) => value !== CSV_HEADERS[index])
  ) {
    throw csvError("CSV columns do not match the inventory template", [
      { expected: CSV_HEADERS },
    ]);
  }

  const rows = records.slice(1).map((values, rowIndex) => {
    if (values.length !== CSV_HEADERS.length) {
      throw csvError("CSV row has an incorrect number of columns", [
        { row: rowIndex + 2, expected: CSV_HEADERS.length, received: values.length },
      ]);
    }
    const row = { rowNumber: rowIndex + 2 } as CsvInventoryRow;
    for (const [index, key] of CSV_HEADERS.entries()) {
      row[key] = values[index]!.trim();
    }
    return row;
  });

  return {
    rows,
    sourceHash: createHash("sha256").update(buffer).digest("hex"),
  };
}
