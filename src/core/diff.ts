import { diffLines, type Change } from "diff";
import type { AnalysisResult, DataType, ElementStats } from "./types";

const esc = (s: string) =>
  s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
const escAttr = (s: string) =>
  s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

/** Opening tag built directly from name + attributes — O(1) per element. */
function openTag(el: Element): string {
  let s = "<" + el.tagName;
  for (const a of Array.from(el.attributes)) s += ` ${a.name}="${escAttr(a.value)}"`;
  return s;
}

function directText(el: Element): string {
  let t = "";
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) t += n.nodeValue ?? "";
  return t.trim();
}

/**
 * Pretty-print XML with indentation so line diffs are meaningful.
 * O(N): each element's tag is constructed once, never re-serialized.
 * ponytail: recursive walk; switch to an explicit stack if XML nests past ~10k deep.
 */
export function prettyXml(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror") || !doc.documentElement) return xml;
  const out: string[] = [];

  function walk(el: Element, indent: string) {
    const childEls = el.children;
    const text = directText(el);
    if (!childEls.length) {
      out.push(text ? `${indent}${openTag(el)}>${esc(text)}</${el.tagName}>` : `${indent}${openTag(el)}/>`);
      return;
    }
    out.push(indent + openTag(el) + ">" + (text ? " " + esc(text) : ""));
    for (let i = 0; i < childEls.length; i++) walk(childEls[i], indent + "  ");
    out.push(`${indent}</${el.tagName}>`);
  }
  walk(doc.documentElement, "");
  return out.join("\n");
}

export interface LineDiffResult {
  changes: Change[];
  added: number;
  removed: number;
}

export function lineDiff(a: string, b: string): LineDiffResult {
  const changes = diffLines(prettyXml(a), prettyXml(b));
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
