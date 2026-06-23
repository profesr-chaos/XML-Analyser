import { diffLines, type Change } from "diff";
import type { AnalysisResult, DataType, ElementStats } from "./types";

// Pretty-printer now lives in format.ts (streaming, DOM-free, lossless).
export { formatXml as prettyXml } from "./format";
import { formatXml } from "./format";

export interface LineDiffResult {
  changes: Change[];
  added: number;
  removed: number;
}

export function lineDiff(a: string, b: string): LineDiffResult {
  const changes = diffLines(formatXml(a), formatXml(b));
  let added = 0;
  let removed = 0;
  for (const c of changes) {
    if (c.added) added += c.count ?? 0;
    if (c.removed) removed += c.count ?? 0;
  }
  return { changes, added, removed };
}

export interface TypeChange {
  path: string;
  fromType: DataType;
  toType: DataType;
}

export interface SchemaDiffResult {
  elementsOnlyInA: string[];
  elementsOnlyInB: string[];
  attrsOnlyInA: string[];
  attrsOnlyInB: string[];
  typeChanges: TypeChange[];
  common: string[];
}

/** Dominant non-empty content type for an element (or "empty"). */
export function contentType(stats: ElementStats): DataType {
  let best: DataType = "empty";
  let bestN = -1;
  for (const [type, n] of Object.entries(stats.types) as [DataType, number][]) {
    if (type === "empty") continue;
    if (n > bestN) {
      best = type;
      bestN = n;
    }
  }
  return best;
}

function diffSets(a: Set<string>, b: Set<string>): [string[], string[], string[]] {
  const onlyA: string[] = [];
  const onlyB: string[] = [];
  const both: string[] = [];
  for (const x of a) (b.has(x) ? both : onlyA).push(x);
  for (const x of b) if (!a.has(x)) onlyB.push(x);
  return [onlyA.sort(), onlyB.sort(), both.sort()];
}

export function schemaDiff(a: AnalysisResult, b: AnalysisResult): SchemaDiffResult {
  const [elementsOnlyInA, elementsOnlyInB, common] = diffSets(a.allPaths, b.allPaths);
  const [attrsOnlyInA, attrsOnlyInB] = diffSets(a.allAttrPaths, b.allAttrPaths);

  const typeChanges: TypeChange[] = [];
  for (const path of common) {
    const fromType = contentType(a.pathStats.get(path)!);
    const toType = contentType(b.pathStats.get(path)!);
    if (fromType !== toType) typeChanges.push({ path, fromType, toType });
  }

  return {
    elementsOnlyInA,
    elementsOnlyInB,
    attrsOnlyInA,
    attrsOnlyInB,
    typeChanges,
    common,
  };
}
