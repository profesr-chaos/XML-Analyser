# XML Analyser — Product & Engineering Spec

A local-first desktop application for inspecting, documenting, and comparing arbitrary XML files. This document is the build brief for re-implementing the existing Python/Tkinter prototype as a **React desktop app** that can be bundled and run locally on demand.

---

## 1. Goal & constraints

- **Local-first.** No backend server, no cloud, no third-party API calls. Everything runs on the user's machine.
- **Bundled as a desktop app.** Target a packaged binary (see Section 7) that launches like any native app — double-click to run.
- **Arbitrary XML.** The tool must never assume a fixed schema. Every field, data type, and nesting structure is discovered at runtime.
- **Privacy.** XML files often contain operational data (e.g. staff rosters, personnel numbers). Files are read locally and never transmitted anywhere.
- **Audience.** Engineers and integration specialists working with XML-based interfaces and exports.

---

## 2. What already exists (current Tkinter prototype)

The existing prototype is a single-window app with a left-hand schema tree and a tabbed right panel. Everything below is implemented and working — it is the baseline feature set the React app must match.

### 2.1 Core analysis engine

Walks the full XML tree and collects, per unique element path:

- **Occurrence count** — how many times each path appears.
- **Inferred data type(s)** per text value, with a per-type histogram. Type inference covers: `integer`, `float`, `date` (`YYYY-MM-DD`), `datetime` (`YYYY-MM-DDThh:mm:ss`), `boolean` (`true/false/yes/no/1/0`), `string`, and `empty`.
- **Attributes** — names, inferred types, and whether each is **required** (present on every occurrence of the element) or **optional**.
- **Children map** — the set of child tags under each element.
- **Sample values** — up to 5 example text values per element.
- **Aggregate stats** — total elements, unique paths, total attributes, maximum nesting depth, file size.

Namespaces are stripped from tags for readability (e.g. `{http://...}employee` becomes `employee`). The React version additionally **preserves and reports** namespace data — see Section 5.6.

### 2.2 Schema Tree (left panel)

- Collapsible tree of the full element hierarchy.
- Each node shows its tag and occurrence count, e.g. `employeeAllocation (165×)`.
- **Live search box** that filters the tree as you type. Parent nodes stay visible when any descendant matches, preserving context.
- Selecting a node jumps to the Element Detail tab for that path.

### 2.3 Tabs (right panel)

1. **Summary** — file metadata, structure stats, top 10 most frequent elements, and a data-type distribution breakdown with percentages.
2. **All Elements** — a searchable table of every unique path with: indented path, count, detected types, attribute names, and a sample value. The **filter box** searches across path, attribute names, and sample values simultaneously, with a live `X of Y elements` counter.
3. **Element Detail** — full inspector for a single path: identity (path, occurrences, children), data types with percentages, attributes (with required/optional flag), and sample values.
4. **Documentation** — generate schema documentation with a live preview and export to **Markdown**, **HTML**, or **PDF**. The doc includes an overview table and a full element reference (path, occurrences, attribute table, children, content type, example value).
5. **XML Diff** — compare two XML files. Contains two sub-tabs:
   - **Line Diff** — git-style unified text diff of the pretty-printed XML (`+` added / `-` removed / unchanged), with a summary count.
   - **Schema Diff** — structural comparison showing **elements only in A**, **elements only in B**, **attributes only in A/B**, **type changes** (same path, different content type), and **common elements**. Has its own search box and a headline count row. This is the feature for answering "what's new in interface v1.5 vs v1.4".

### 2.4 Other existing capabilities

- **Plain-text report export** (`.txt`) with structure summary, element inventory, and attribute inventory.
- Background-threaded parsing so the UI stays responsive on large files.
- Graceful error handling for malformed XML.
- Dark theme throughout.

---

## 3. Target architecture (React app)

### 3.1 Recommended stack

- **Shell:** Tauri (preferred — small binary, Rust backend, low memory) or Electron (fallback if the team is more comfortable with Node). Tauri is recommended for a lightweight local app.
- **UI:** React + TypeScript.
- **Styling:** Tailwind CSS (utility-first, matches the existing dark aesthetic well).
- **State:** Lightweight — Zustand or React context. No heavy state library needed.
- **XML parsing:** `fast-xml-parser` or the browser-native `DOMParser`. Parsing must run **off the main thread** (Web Worker) so the UI never freezes on large files.
- **Diff:** the `diff` npm package (Myers diff) for line-level comparison; custom set logic for schema-level comparison.
- **PDF export:** generate from rendered HTML using the print-to-PDF capability of the shell (Tauri/Electron both expose this) — no third-party service.

### 3.2 Suggested module layout

```
src/
  core/
    analyse.ts        # XML walk -> AnalysisResult (pure, testable, no UI)
    types.ts          # AnalysisResult, ElementStats, DiffResult, etc.
    inferType.ts      # value -> data type
    diff.ts           # lineDiff() and schemaDiff()
    docgen.ts         # AnalysisResult -> markdown / html
  workers/
    parse.worker.ts   # runs analyse() off the main thread
  components/
    SchemaTree.tsx
    SummaryTab.tsx
    AllElementsTab.tsx
    ElementDetailTab.tsx
    DocumentationTab.tsx
    DiffTab/ (LineDiff.tsx, SchemaDiff.tsx)
    SearchBox.tsx
  state/
    store.ts
  App.tsx
```

Keep `core/` completely UI-free so it can be unit-tested in isolation and reused.

### 3.3 Core data shape (carry over from prototype)

```ts
type DataType = "integer" | "float" | "date" | "datetime" | "boolean" | "string" | "empty";

interface CardinalityStats {
  min: number;          // min occurrences under a single parent (0 => optional)
  max: number;          // max occurrences (>1 => repeating)
  avg: number;
}

interface ElementStats {
  path: string;
  count: number;
  types: Record<DataType, number>;     // type -> occurrence count
  samples: string[];                    // up to 5
  attrs: Record<string, Record<DataType, number>>;
  requiredAttrs: Set<string>;
  children: Set<string>;
  parents: Set<string>;                 // 5.10 parent element paths
  cardinality: CardinalityStats;        // 5.9 occurrences per parent
  valueFrequency?: Record<string, number>; // 5.9 enum-like fields only (< ~50 distinct)
  presentPct: number;                   // 5.9 present vs parent occurrences
  emptyPct: number;
  isMixedType: boolean;                 // 5.9 more than one inferred type
  lengthStats?: { min: number; max: number; avg: number };   // 5.9 strings
  numericRange?: { min: number; max: number };               // 5.9 numbers
}

interface NamespaceInfo {
  prefix: string | null;                // null = default namespace
  uri: string;
  elementCount: number;
}

interface AnalysisResult {
  filePath: string;
  fileSize: number;
  encoding: string;                     // 5.6
  rootTag: string;
  totalElements: number;
  uniquePaths: number;
  totalAttrs: number;
  maxDepth: number;
  namespaces: NamespaceInfo[];          // 5.6
  undefinedNamespaces: string[];        // 5.6 prefixes used without declaration
  pathStats: Map<string, ElementStats>;
  allPaths: Set<string>;
  allAttrPaths: Set<string>;            // e.g. "/root/elem@id"
}
```

---

## 4. Feature parity checklist (must-have)

Everything in Section 2 must be reproduced:

- [ ] Runtime schema discovery with type inference (incl. required/optional attributes).
- [ ] Schema tree with live search and context-preserving filtering.
- [ ] Summary tab (stats, top elements, type distribution).
- [ ] All Elements tab with multi-field search and live result count.
- [ ] Element Detail inspector.
- [ ] Documentation generator with live preview + Markdown / HTML / PDF export.
- [ ] Diff tab with Line Diff and Schema Diff sub-tabs.
- [ ] Schema Diff showing elements/attributes unique to each file, type changes, and common nodes, with its own search.
- [ ] Plain-text report export.
- [ ] Off-main-thread parsing + graceful malformed-XML handling.
- [ ] Dark theme.

---

## 5. New features to make it excellent

All of these are local-only and require no external services.

### 5.1 High value

- **Drag-and-drop file loading.** Drop one file to analyse, or drop two to jump straight into a diff. Show a clear drop overlay.
- **Recent files list.** Persist the last N opened paths locally so the user can reopen quickly. (Use the shell's local storage / a small JSON file in the app data dir.)
- **Raw XML viewer with syntax highlighting and folding.** A tab showing the pretty-printed source with collapsible nodes, line numbers, and search. Many users want to see the actual text alongside the analysis.
- **Click-to-locate.** From the Element Detail or All Elements view, jump to the first occurrence of that element in the Raw XML viewer (and vice versa).
- **Export the analysis itself as JSON.** A machine-readable dump of `AnalysisResult` so the schema profile can be diffed in version control or fed into other tooling.
- **Side-by-side diff view.** In addition to the unified line diff, offer a two-column split view (File A | File B) with aligned, colour-coded changes — easier to read for large structural differences.
- **Diff: collapse unchanged regions.** Show only changed hunks with "N unchanged lines" expanders (like GitHub), so big files are navigable.
- **XPath / path query bar.** Let the user type a path or simple XPath and see all matching elements and their values. Hugely useful for inspecting interface fields.

### 5.2 Validation & quality

- **Well-formedness check on load** with precise line/column error reporting and a jump-to-error action.
- **Optional XSD validation.** If the user supplies an `.xsd`, validate the XML against it and list violations. (Pure local; use a JS XSD validator — no network.)
- **Schema consistency warnings.** Flag things like: an element that is sometimes empty and sometimes populated, attributes that are required in most occurrences but missing in a few, or mixed data types on the same path (e.g. a field that is usually `integer` but occasionally `string`). These are exactly the issues that break integrations.

### 5.3 Documentation enhancements

- **Configurable doc output.** Toggle which sections to include (overview, element reference, attribute tables, examples), and choose between a compact and a verbose layout.
- **Copy-to-clipboard** for any generated artifact (Markdown, JSON, a single element's reference).
- **Self-contained HTML export** (inline CSS, no external assets) so the doc opens correctly when emailed or committed to a repo.

### 5.4 Diff enhancements (building on the version-comparison use case)

- **Diff summary report export.** Export the schema diff (added/removed/changed nodes) as Markdown or HTML — a ready-made "What changed between v1.4 and v1.5" changelog.
- **Value-level diff for matched elements.** Where the same logical element exists in both files, show how its sample values or attribute values changed, not just whether the node exists.
- **Ignore options.** Toggles to ignore attribute order, whitespace, comments, or namespace prefixes so the diff focuses on meaningful changes.
- **Three-way awareness (stretch).** Allow loading more than two files to track a field across several interface versions.

### 5.5 UX & ergonomics

- **Command palette** (Ctrl/Cmd+K) for quick actions: open file, run diff, export docs, jump to element.
- **Keyboard navigation** throughout the schema tree and tables; visible focus states.
- **Resizable / persisted panel layout** — remember sash positions and last-used tab between sessions.
- **Light/dark theme toggle** (dark stays the default).
- **Large-file handling** — virtualised tree and table rendering (e.g. `react-window`) so files with tens of thousands of nodes stay smooth.
- **Progress indicator** for parsing and diffing large files.
- **Accessibility** — keyboard operability, sufficient contrast, and respect for reduced-motion preferences.

### 5.6 Namespace Explorer

The current file already uses a namespace (`http://intf.mb.ivu.de/`), and enterprise interface XML routinely uses several with prefixes (`abc:Customer`, `xyz:Address`). The prototype strips namespaces; the React app should still strip them for tree/path readability **but also surface them**:

- Add **namespace count** and **encoding** to the Summary/Overview.
- A dedicated **Namespaces** panel (sub-section of Summary, or its own small tab) listing every declared namespace as a table:

  | Prefix | Namespace URI | Element count |
  |--------|---------------|---------------|
  | (default) | `http://intf.mb.ivu.de/` | 3,635 |
  | abc | `company.com/customer` | 125 |

- **Filter by namespace** — narrow the schema tree and All Elements table to a single namespace.
- **Undefined-namespace warning** — flag any prefix used on an element/attribute that has no matching `xmlns` declaration (a common, hard-to-spot XML bug).

### 5.7 XPath Generator (click element → copy path)

Distinct from the query bar in 5.1 (which *runs* a path). This *produces* candidate XPaths from the currently selected element and offers each with a one-click **copy** button. For a selected `<Phone type="mobile">` show, for example:

```
//Phone
//Customer/Phone
//Phone[@type='mobile']
/Order/Customer[3]/Phone        (absolute path to this occurrence)
```

Low effort, high daily utility for anyone writing integration mappings or test assertions.

### 5.8 XPath breadcrumb on selection

When a node is selected in the tree or Raw XML viewer, show its absolute indexed path in the Element Detail header, e.g. `/Order/Customer[3]/Address`. Clicking a segment selects that ancestor. Trivial to add and constantly useful for orientation in deep documents.

### 5.9 Statistics & Profiling  (primary "understand, not just parse" feature)

This is the most valuable *new* capability and the one that lets the tool answer "what's actually in this file?" rather than merely rendering a tree. Add a **Statistics** tab (or fold into Element Detail per-element + a Statistics overview tab):

- **Cardinality** — for each element, the min/max/avg number of occurrences under each parent (e.g. `Customer: 1–500 per Order`). Min of 0 means the element is **optional**; a max > 1 means it **repeats**. This also yields relationship facts for free, e.g. "Customer has a one-to-many relationship with Order" — no AI required.
- **Value frequency** — for low-cardinality (enum-like) fields, a frequency table of distinct values:

  ```
  Status    ACTIVE 1200 · PENDING 450 · CLOSED 80
  ```

  Show as a small bar breakdown. Cap distinct-value tracking (e.g. only profile fields with < ~50 distinct values) to stay fast.
- **Null / missing analysis** — for each element, the percentage of parent occurrences where it is present vs absent vs empty (e.g. `Phone: present 82% · missing 18%`).
- **Mixed-type warnings** — flag any path whose values resolve to more than one inferred type (e.g. usually `integer`, occasionally `string`). These are the exact issues that break downstream integrations, so surface them prominently (also feed into the Section 5.2 consistency warnings).
- **String length / numeric range stats** — min/max/avg length for string fields and min/max for numeric fields; helpful for sizing database columns and validating field constraints.

### 5.10 Element Inventory enhancement: Parent Elements column

Extend the existing All Elements table with a **Parent Elements** column showing where each element appears (the inverse of the children map). Answers "where does this live?" at a glance and aids reverse-engineering unknown XML.

> **Out of scope — AI-assisted analysis.** Natural-language "explain this element" / prose relationship summaries are intentionally excluded: they require an LLM API, which conflicts with the local-only, bundle-and-run, no-third-party constraints. The relationship-inference value people associate with AI ("Customer is one-to-many with Order") is delivered locally and deterministically by the **Cardinality** analysis in 5.9.

---

## 6. Suggested tab structure (React app)

```
┌─ Toolbar: Open · Compare · Export ▾ · NS filter · Theme · Search (⌘K) ┐
├─ Left: Schema Tree (search) ─┬─ Right: Tabs ─────────────────────────┤
│  (filterable by namespace)   │  Summary        (+ namespaces, encoding)│  ← expanded
│                              │  All Elements   (search, + Parent col)  │  ← expanded
│                              │  Element Detail (+ XPath breadcrumb,    │  ← expanded
│                              │                  XPath generator, stats)│
│                              │  Statistics     (cardinality, freq,     │  ← new
│                              │                  null %, mixed-type)     │
│                              │  Raw XML        (highlight + fold)       │  ← new
│                              │  Documentation  (preview + export)       │
│                              │  Diff ─ Line | Side-by-side | Schema     │  ← expanded
│                              │  Validation     (well-formed / XSD / NS) │  ← new
└──────────────────────────────┴────────────────────────────────────────┘
```

Per-element profiling (cardinality, present %, value frequency, mixed-type flag) also appears inline in **Element Detail**; the **Statistics** tab gives the file-wide overview and ranks the most important findings (mixed-type fields, optional/repeating elements) at the top.

---

## 7. Packaging & local run

- Provide an npm script for dev (`dev`), build (`build`), and package (`package`).
- **Tauri:** produces a small native installer per OS (`.msi` / `.dmg` / `.AppImage`). Recommended for a "run it locally whenever" tool.
- **Electron (fallback):** use `electron-builder` for cross-platform installers.
- The packaged app must run fully offline with no runtime network dependencies.
- Include a short README covering install, build, and the no-network guarantee.

---

## 8. Testing expectations

- Unit-test the entire `core/` layer (analysis, type inference, diff, docgen) with fixture XML files, including edge cases: empty elements, deeply nested structures, repeated paths with mixed types, attributes present on some occurrences only, namespaced tags, and malformed input.
- Snapshot-test the Markdown/HTML doc output.
- Test the schema diff with a v1.4 vs v1.5 style fixture pair (added nodes, removed nodes, changed types, new attributes) and assert each category is classified correctly.

---

## 9. Build priority

1. **Core engine + Summary + All Elements + Element Detail + Schema Tree** (feature parity foundation). Extend the engine up front to capture **parents, cardinality, present/empty %, value frequency, and mixed-type flags** (5.9, 5.10) and **namespaces/encoding** (5.6) — these come almost free during the tree walk and unblock several tabs.
2. **Statistics tab + Namespace Explorer** (5.6, 5.9) — the highest-value "understand the file" capabilities.
3. **Diff (Line + Schema)** — the primary differentiator for version comparison.
4. **Documentation generator + exports** (incl. namespace and statistics sections).
5. **XPath generator + breadcrumb** (5.7, 5.8) and the **Raw XML viewer** with click-to-locate.
6. **Validation** (well-formed / XSD / undefined-namespace) and the **UX layer** (command palette, drag-and-drop, recent files, virtualisation).
7. **Packaging** for local distribution.
