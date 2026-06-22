# XML Analyser

Local-first tool for inspecting, documenting, and comparing arbitrary XML files.
No backend, no network, no schema assumptions — everything is discovered at runtime
and runs entirely in your browser.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static bundle in dist/
npm test           # core engine unit tests
```

Open a file (or drag one in). Drop **two** files to jump straight into a diff.
Try the pair in `examples/` (`interface-v1.4.xml` vs `v1.5.xml`).

## What it does

- **Schema discovery** — per-path occurrence counts, inferred types, required/optional
  attributes, children, parents, cardinality, present/empty %, value frequency,
  mixed-type flags, string-length and numeric ranges.
- **Tabs** — Summary, All Elements (search + parent column), Element Detail
  (stats, XPath breadcrumb + suggestions), Statistics (ranked integration risks),
  Documentation (Markdown / HTML / JSON / Text / PDF export), Diff (Schema + Line).
- **Namespaces** — stripped from paths for readability but reported, counted, and
  filterable.

## No-network guarantee

Parsing uses the browser-native `DOMParser`; exports use `Blob` downloads and the
browser's print-to-PDF. Nothing is ever transmitted. Open `dist/index.html` and run
offline.

## Notes / not yet built

`DOMParser` is `[Exposed=Window]` only, so analysis runs on the main thread (it has
no Web Worker form). Typical interface XML parses in well under a second; very large
files would benefit from a `fast-xml-parser` worker — add when it bites.

Deferred (spec §5.x, priority 6–7): XSD validation, raw-XML folding viewer,
command palette, recent-files list, row virtualisation, side-by-side diff, and the
Tauri/Electron desktop wrapper. The web app is the wrapper-ready core.
