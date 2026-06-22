import type {
  AnalysisResult,
  DataType,
  ElementStats,
  NamespaceInfo,
} from "./types";
import { inferType } from "./inferType";

const MAX_SAMPLES = 5;
const ENUM_CAP = 50; // stop tracking value frequency above this many distinct values

export class XmlParseError extends Error {
  constructor(message: string, public line?: number, public column?: number) {
    super(message);
    this.name = "XmlParseError";
  }
}

/** Mutable accumulator per path; condensed to ElementStats at the end. */
interface Acc {
  path: string;
  count: number;
  namespace: string | null;
  types: Partial<Record<DataType, number>>;
  samples: string[];
  attrs: Record<string, Partial<Record<DataType, number>>>;
  attrPresence: Record<string, number>;
  children: Set<string>;
  parents: Set<string>;
  emptyCount: number;
  distinctValues: Map<string, number> | null; // null once over ENUM_CAP
  lenMin: number;
  lenMax: number;
  lenSum: number;
  lenN: number;
  numMin: number;
  numMax: number;
  numN: number;
}

function newAcc(path: string): Acc {
  return {
    path,
    count: 0,
    namespace: null,
    types: {},
    samples: [],
    attrs: {},
    attrPresence: {},
    children: new Set(),
    parents: new Set(),
    emptyCount: 0,
    distinctValues: new Map(),
    lenMin: Infinity,
    lenMax: 0,
    lenSum: 0,
    lenN: 0,
    numMin: Infinity,
    numMax: -Infinity,
    numN: 0,
  };
}

function localName(el: Element): string {
  // strip namespace prefix for readability (spec 2.1 / 5.6)
  return el.localName || el.tagName.replace(/^.*:/, "");
}

/** Concatenated direct text of an element (ignores text inside child elements). */
function directText(el: Element): string {
  let s = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 /* TEXT */ || node.nodeType === 4 /* CDATA */) {
      s += node.nodeValue ?? "";
    }
  }
  return s.trim();
}

export function analyse(xml: string, filePath = ""): AnalysisResult {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const perr = doc.querySelector("parsererror");
  if (perr) {
    const msg = perr.textContent?.trim() || "Malformed XML";
    const lc = /^(\d+):(\d+):/.exec(msg);
    throw new XmlParseError(msg, lc ? +lc[1] : undefined, lc ? +lc[2] : undefined);
  }
  const root = doc.documentElement;
  if (!root) throw new XmlParseError("Empty or invalid XML document");

  const encoding =
    /encoding\s*=\s*["']([^"']+)["']/i.exec(xml.slice(0, 200))?.[1] ?? "UTF-8";

  const accs = new Map<string, Acc>();
  // For cardinality: per parent path, the list of child-count maps (one per parent instance).
  const instanceChildren = new Map<string, Array<Map<string, number>>>();
  // Namespace tallies: uri -> { prefix, count }
  const nsByUri = new Map<string, { prefix: string | null; count: number }>();
  const undefinedNs = new Set<string>();
  let totalElements = 0;
  let totalAttrs = 0;
  let maxDepth = 0;

  function getAcc(path: string): Acc {
    let a = accs.get(path);
    if (!a) accs.set(path, (a = newAcc(path)));
    return a;
  }

  function walk(el: Element, parentPath: string | null, depth: number) {
    const path = parentPath === null ? `/${localName(el)}` : `${parentPath}/${localName(el)}`;
    if (depth > maxDepth) maxDepth = depth;
    totalElements++;

    const acc = getAcc(path);
    acc.count++;
    acc.namespace = el.namespaceURI;
    if (parentPath !== null) acc.parents.add(parentPath);

    // namespace
    if (el.namespaceURI) {
      const entry = nsByUri.get(el.namespaceURI);
      if (entry) entry.count++;
      else nsByUri.set(el.namespaceURI, { prefix: el.prefix || null, count: 1 });
    } else if (el.tagName.includes(":")) {
      undefinedNs.add(el.tagName.split(":")[0]);
    }

    // attributes
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) continue;
      if (!attr.namespaceURI && attr.name.includes(":") && attr.name.split(":")[0] !== "xml") {
        undefinedNs.add(attr.name.split(":")[0]);
      }
      const an = attr.localName || attr.name.replace(/^.*:/, "");
      totalAttrs++;
      acc.attrPresence[an] = (acc.attrPresence[an] ?? 0) + 1;
      const t = inferType(attr.value);
      const bag = (acc.attrs[an] ??= {});
      bag[t] = (bag[t] ?? 0) + 1;
    }

    // text value
    const text = directText(el);
    const t = inferType(text);
    acc.types[t] = (acc.types[t] ?? 0) + 1;
    if (t === "empty") acc.emptyCount++;
    else {
      if (acc.samples.length < MAX_SAMPLES && !acc.samples.includes(text)) {
        acc.samples.push(text);
      }
      if (acc.distinctValues) {
        acc.distinctValues.set(text, (acc.distinctValues.get(text) ?? 0) + 1);
        if (acc.distinctValues.size > ENUM_CAP) acc.distinctValues = null;
      }
      if (t === "string") {
        acc.lenMin = Math.min(acc.lenMin, text.length);
        acc.lenMax = Math.max(acc.lenMax, text.length);
        acc.lenSum += text.length;
        acc.lenN++;
      } else if (t === "integer" || t === "float") {
        const n = Number(text);
        acc.numMin = Math.min(acc.numMin, n);
        acc.numMax = Math.max(acc.numMax, n);
        acc.numN++;
      }
    }

    // children + cardinality bookkeeping
    const childEls = Array.from(el.children);
    const childCounts = new Map<string, number>();
    for (const child of childEls) {
      const cpath = `${path}/${localName(child)}`;
      acc.children.add(localName(child));
      childCounts.set(cpath, (childCounts.get(cpath) ?? 0) + 1);
    }
    if (childEls.length) {
      let arr = instanceChildren.get(path);
      if (!arr) instanceChildren.set(path, (arr = []));
      arr.push(childCounts);
    }

    for (const child of childEls) walk(child, path, depth + 1);
  }

  walk(root, null, 0);

  // Condense accumulators -> ElementStats
  const pathStats = new Map<string, ElementStats>();
  const allAttrPaths = new Set<string>();

  for (const acc of accs.values()) {
    const nonEmptyTypes = Object.keys(acc.types).filter((k) => k !== "empty");

    // cardinality + presentPct from parent instances
    const parentPath = acc.path.includes("/", 1)
      ? acc.path.slice(0, acc.path.lastIndexOf("/"))
      : null;
    let min = 1, max = 1, avg = 1, presentPct = 100;
    if (parentPath) {
      const instances = instanceChildren.get(parentPath) ?? [];
      if (instances.length) {
        const counts = instances.map((m) => m.get(acc.path) ?? 0);
        min = Math.min(...counts);
        max = Math.max(...counts);
        avg = counts.reduce((a, b) => a + b, 0) / counts.length;
        presentPct = (counts.filter((c) => c > 0).length / counts.length) * 100;
      }
    }

    const requiredAttrs = new Set<string>();
    for (const [an, present] of Object.entries(acc.attrPresence)) {
      allAttrPaths.add(`${acc.path}@${an}`);
      if (present === acc.count) requiredAttrs.add(an);
    }

    const stats: ElementStats = {
      path: acc.path,
      count: acc.count,
      namespace: acc.namespace,
      types: acc.types,
      samples: acc.samples,
      attrs: acc.attrs,
      requiredAttrs,
      children: acc.children,
      parents: acc.parents,
      cardinality: { min, max, avg: round2(avg) },
      presentPct: round2(presentPct),
      emptyPct: round2((acc.emptyCount / acc.count) * 100),
      isMixedType: nonEmptyTypes.length > 1,
    };
    if (acc.distinctValues && acc.distinctValues.size > 0 && acc.distinctValues.size <= ENUM_CAP) {
      stats.valueFrequency = Object.fromEntries(acc.distinctValues);
    }
    if (acc.lenN) {
      stats.lengthStats = {
        min: acc.lenMin,
        max: acc.lenMax,
        avg: round2(acc.lenSum / acc.lenN),
      };
    }
    if (acc.numN) {
      stats.numericRange = { min: acc.numMin, max: acc.numMax };
    }
    pathStats.set(acc.path, stats);
  }

  const namespaces: NamespaceInfo[] = Array.from(nsByUri.entries())
    .map(([uri, { prefix, count }]) => ({ prefix, uri, elementCount: count }))
    .sort((a, b) => b.elementCount - a.elementCount);

  return {
    filePath,
    fileSize: xml.length,
    encoding,
    rootTag: localName(root),
    totalElements,
    uniquePaths: pathStats.size,
    totalAttrs,
    maxDepth,
    namespaces,
    undefinedNamespaces: Array.from(undefinedNs),
    pathStats,
    allPaths: new Set(pathStats.keys()),
    allAttrPaths,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
