import { SaxesParser, type SaxesTag, type SaxesTagNS } from "saxes";
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

/** One open element on the parse stack, accumulating until its close tag. */
interface Frame {
  path: string;
  acc: Acc;
  textParts: string[];
  childCounts: Map<string, number>; // child path -> occurrences under this instance
  hasChildren: boolean;
}

/**
 * Stream the document with a namespace-aware SAX parser (saxes) — no DOM, so it
 * runs in a Web Worker and keeps peak memory flat on large files. Behaviour
 * matches the former DOMParser walk: local names in paths, namespace tallies,
 * a thrown XmlParseError (with line) on malformed input or unbound prefixes.
 */
export function analyse(xml: string, filePath = ""): AnalysisResult {
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
  let rootTag = "";

  function getAcc(path: string): Acc {
    let a = accs.get(path);
    if (!a) accs.set(path, (a = newAcc(path)));
    return a;
  }

  const stack: Frame[] = [];
  let parseError: Error | null = null;
  let errLine = 0;
  let errCol = 0;

  const parser = new SaxesParser({ xmlns: true, fileName: filePath || undefined });

  parser.on("error", (e) => {
    if (!parseError) {
      parseError = e;
      errLine = parser.line;
      errCol = parser.column;
    }
  });

  parser.on("opentag", (tag: SaxesTag) => {
    const node = tag as SaxesTagNS; // xmlns:true => local/prefix/uri/attributes are present
    const local = node.local;
    const parent = stack[stack.length - 1];
    const path = parent ? `${parent.path}/${local}` : `/${local}`;
    const depth = stack.length;
    if (depth > maxDepth) maxDepth = depth;
    if (!rootTag) rootTag = local;
    totalElements++;

    const acc = getAcc(path);
    acc.count++;
    acc.namespace = node.uri || null;
    if (parent) acc.parents.add(parent.path);

    if (node.uri) {
      const entry = nsByUri.get(node.uri);
      if (entry) entry.count++;
      else nsByUri.set(node.uri, { prefix: node.prefix || null, count: 1 });
    }

    for (const [qname, attr] of Object.entries(node.attributes)) {
      if (qname === "xmlns" || qname.startsWith("xmlns:") || attr.prefix === "xmlns") continue;
      const an = attr.local || qname.replace(/^.*:/, "");
      totalAttrs++;
      acc.attrPresence[an] = (acc.attrPresence[an] ?? 0) + 1;
      const t = inferType(attr.value);
      const bag = (acc.attrs[an] ??= {});
      bag[t] = (bag[t] ?? 0) + 1;
    }

    if (parent) {
      parent.hasChildren = true;
      parent.acc.children.add(local);
      parent.childCounts.set(path, (parent.childCounts.get(path) ?? 0) + 1);
    }

    stack.push({ path, acc, textParts: [], childCounts: new Map(), hasChildren: false });
  });

  const onText = (t: string) => {
    const f = stack[stack.length - 1];
    if (f) f.textParts.push(t);
  };
  parser.on("text", onText);
  parser.on("cdata", onText);

  parser.on("closetag", () => {
    const frame = stack.pop();
    if (!frame) return;
    const acc = frame.acc;
    const text = frame.textParts.join("").trim();
    const t = inferType(text);
    acc.types[t] = (acc.types[t] ?? 0) + 1;
    if (t === "empty") acc.emptyCount++;
    else {
      if (acc.samples.length < MAX_SAMPLES && !acc.samples.includes(text)) acc.samples.push(text);
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
    if (frame.hasChildren) {
      let arr = instanceChildren.get(frame.path);
      if (!arr) instanceChildren.set(frame.path, (arr = []));
      arr.push(frame.childCounts);
    }
  });

  try {
    parser.write(xml).close();
  } catch (e) {
    if (!parseError) {
      parseError = e as Error;
      errLine = parser.line;
      errCol = parser.column;
    }
  }

  if (parseError) {
    throw new XmlParseError((parseError as Error).message || "Malformed XML", errLine || 1, errCol);
  }
  if (!rootTag) throw new XmlParseError("Empty or invalid XML document");

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
    rootTag,
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
