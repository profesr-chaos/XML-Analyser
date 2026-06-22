export type DataType =
  | "integer"
  | "float"
  | "date"
  | "datetime"
  | "boolean"
  | "string"
  | "empty";

export interface CardinalityStats {
  min: number; // min occurrences under a single parent (0 => optional)
  max: number; // max occurrences (>1 => repeating)
  avg: number;
}

export interface ElementStats {
  path: string;
  count: number;
  namespace: string | null; // resolved namespace URI of this element, or null
  types: Partial<Record<DataType, number>>;
  samples: string[];
  attrs: Record<string, Partial<Record<DataType, number>>>;
  requiredAttrs: Set<string>;
  children: Set<string>;
  parents: Set<string>;
  cardinality: CardinalityStats;
  valueFrequency?: Record<string, number>; // enum-like fields only (< ~50 distinct)
  presentPct: number; // present vs parent occurrences
  emptyPct: number;
  isMixedType: boolean;
  lengthStats?: { min: number; max: number; avg: number }; // strings
  numericRange?: { min: number; max: number }; // numbers
}

export interface NamespaceInfo {
  prefix: string | null; // null = default namespace
  uri: string;
  elementCount: number;
}

export interface AnalysisResult {
  filePath: string;
  fileSize: number;
  encoding: string;
  rootTag: string;
  totalElements: number;
  uniquePaths: number;
  totalAttrs: number;
  maxDepth: number;
  namespaces: NamespaceInfo[];
  undefinedNamespaces: string[];
  pathStats: Map<string, ElementStats>;
  allPaths: Set<string>;
  allAttrPaths: Set<string>; // e.g. "/root/elem@id"
}
