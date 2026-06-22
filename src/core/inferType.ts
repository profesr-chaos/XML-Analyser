import type { DataType } from "./types";

const INT_RE = /^[+-]?\d+$/;
const FLOAT_RE = /^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)?$/;
const BOOL_RE = /^(true|false|yes|no)$/i;

/** Infer the data type of a single text value. Order matters: most specific first. */
export function inferType(raw: string): DataType {
  const v = raw.trim();
  if (v === "") return "empty";
  if (INT_RE.test(v)) return "integer";
  if (DATE_RE.test(v)) return "date";
  if (DATETIME_RE.test(v)) return "datetime";
  if (BOOL_RE.test(v) || v === "1" || v === "0") return "boolean";
  if (FLOAT_RE.test(v)) return "float";
  return "string";
}

// ponytail: "1"/"0" are ambiguous int-vs-bool; integer wins above so a column of
// 1/0/2 reads as integer, not boolean. BOOL_RE only catches the word forms.
