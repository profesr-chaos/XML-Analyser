import { useEffect, useRef, useState } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  Decoration,
  type DecorationSet,
} from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { xml } from "@codemirror/lang-xml";
import {
  foldGutter,
  foldKeymap,
  codeFolding,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
} from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { showMinimap } from "@replit/codemirror-minimap";
import { tags as t } from "@lezer/highlight";
import { formatInWorker } from "../parseClient";
import { useStore, leaf } from "../state/store";

// Colours read against both themes; the editor surface itself is var(--color-bg).
const xmlHighlight = HighlightStyle.define([
  { tag: [t.tagName, t.angleBracket], color: "#7ee2b8" },
  { tag: t.attributeName, color: "#9bbbff" },
  { tag: [t.attributeValue, t.string], color: "#e6b673" },
  { tag: t.comment, color: "#7d8799", fontStyle: "italic" },
  { tag: [t.content, t.processingInstruction], color: "var(--color-fg)" },
  { tag: t.documentMeta, color: "#c792ea" },
]);

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--color-bg)", color: "var(--color-fg)" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12.5px", lineHeight: "1.5" },
  ".cm-gutters": { backgroundColor: "var(--color-panel)", color: "var(--color-muted)", border: "none" },
  ".cm-activeLineGutter": { backgroundColor: "var(--color-panel2)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--color-panel2) 45%, transparent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 30%, transparent)",
  },
  ".cm-found": { backgroundColor: "color-mix(in srgb, #e6b673 40%, transparent)", borderRadius: "2px" },
  ".cm-found-active": { backgroundColor: "#e6b673", color: "#0f1115" },
});

// --- find-all-instances: a query-driven decoration field we control ourselves,
// so we own the match list (count, navigation, minimap ticks) instead of the panel.
const setQuery = StateEffect.define<{ query: string; caseSensitive: boolean }>();

interface Matches {
  query: string;
  caseSensitive: boolean;
  ranges: { from: number; to: number }[];
  deco: DecorationSet;
}
const empty: Matches = { query: "", caseSensitive: false, ranges: [], deco: Decoration.none };

function compute(doc: string, query: string, caseSensitive: boolean): Matches {
  if (!query) return empty;
  const ranges: { from: number; to: number }[] = [];
  const hay = caseSensitive ? doc : doc.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let i = hay.indexOf(needle);
  while (i !== -1 && ranges.length < 50000) {
    ranges.push({ from: i, to: i + needle.length });
    i = hay.indexOf(needle, i + needle.length);
  }
  const deco = Decoration.set(ranges.map((r) => Decoration.mark({ class: "cm-found" }).range(r.from, r.to)));
  return { query, caseSensitive, ranges, deco };
}

const matchField = StateField.define<Matches>({
  create: () => empty,
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) if (e.is(setQuery)) next = compute(tr.newDoc.toString(), e.value.query, e.value.caseSensitive);
    if (next === value && tr.docChanged && value.query)
      next = compute(tr.newDoc.toString(), value.query, value.caseSensitive);
    return next;
  },
  provide: (f) => EditorView.decorations.from(f, (m) => m.deco),
});

// Minimap that recomputes its match gutters straight from the match field —
// painting matched lines like VS Code's overview ruler, no manual dispatch.
const minimap = showMinimap.compute([matchField], (state) => {
  const lines = state.field(matchField).ranges.map((r) => state.doc.lineAt(r.from).number);
  return {
    create: () => ({ dom: document.createElement("div") }),
    displayText: "blocks" as const,
    showOverlay: "always" as const,
    gutters: lines.length ? [Object.fromEntries(lines.map((l) => [l, "#e6b673"]))] : [],
  };
});

const HEAVY_VIEW_MAX = 3_000_000; // ~3 MB: above this, drop minimap + line wrap
const LIVE_REPARSE_MAX = 2_000_000; // ~2 MB: above this, analysis defers to nav (mirrors the store)

// A source line averaging over this many chars is almost certainly minified
// XML on one (or very few) lines — unreadable, and CodeMirror's worst case.
function looksMinified(s: string): boolean {
  const nl = (s.match(/\n/g) || []).length;
  return s.length / (nl + 1) > 200;
}

// Display-only cache of the formatted text per tab. We pretty-print minified
// files for viewing but never write the (lossy) result back to the tab's real
// bytes — so analysis/diff/export keep the original. Kept in sync on every edit.
const displayCache = new Map<string, string>();

export default function EditorTab({ id, raw }: { id: string; raw: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [query, setQ] = useState("");
  const [caseSensitive, setCase] = useState(false);
  const [count, setCount] = useState(0);
  const [cursor, setCursor] = useState(0); // index of current match for prev/next
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [doc, setDoc] = useState<string | null>(null); // null = still preparing
  const [formatting, setFormatting] = useState(false);
  const selectedPath = useStore((s) => s.selectedPath);
  const jumpRef = useRef(false); // scroll to the first match after the next query change

  // Prepare the display document: reuse the cache, else pretty-print minified
  // input (yielding first so the "Formatting…" state can paint).
  useEffect(() => {
    // Drop cached display text for tabs that have since been closed.
    const live = new Set(useStore.getState().tabs.map((t) => t.id));
    for (const k of displayCache.keys()) if (!live.has(k)) displayCache.delete(k);

    const cached = displayCache.get(id);
    if (cached !== undefined) {
      setDoc(cached);
      return;
    }
    if (!looksMinified(raw)) {
      displayCache.set(id, raw);
      setDoc(raw);
      return;
    }
    setDoc(null);
    setFormatting(true);
    let cancelled = false;
    formatInWorker(raw).then(
      (formatted) => {
        if (cancelled) return;
        displayCache.set(id, formatted);
        setFormatting(false);
        setDoc(formatted);
      },
      () => {
        if (cancelled) return; // worker crashed — show raw
        displayCache.set(id, raw);
        setFormatting(false);
        setDoc(raw);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Create the editor once the display doc is ready.
  useEffect(() => {
    if (!host.current || doc === null) return;
    // The minimap draws the whole document and line-wrapping measures every
    // line; both get expensive past a few MB, so drop them for large files.
    const big = doc.length > HEAVY_VIEW_MAX;
    const view = new EditorView({
      doc,
      parent: host.current,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        codeFolding(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        xml(),
        syntaxHighlighting(xmlHighlight),
        search({ top: true }),
        matchField,
        ...(big ? [] : [minimap, EditorView.lineWrapping]),
        editorTheme,
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            setDirty(true);
            dirtyRef.current = true;
            debounceSave(view.state.doc.toString());
          }
          if (u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(setQuery)))) {
            setCount(view.state.field(matchField).ranges.length);
            setCursor(0);
          }
        }),
      ],
    });
    viewRef.current = view;
    if (query) view.dispatch({ effects: setQuery.of({ query, caseSensitive }) }); // re-apply across rebuilds

    let saveTimer: ReturnType<typeof setTimeout>;
    function debounceSave(text: string) {
      displayCache.set(id, text); // keep the display cache in step with edits
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => useStore.getState().setEditedRaw(id, text), 350);
    }

    return () => {
      clearTimeout(saveTimer);
      if (dirtyRef.current) {
        const text = view.state.doc.toString();
        displayCache.set(id, text);
        useStore.getState().setEditedRaw(id, text); // flush pending edit
      }
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // Clicking a tree node highlights that element's occurrences here: drive the
  // same find machinery with "<tagname" so the matches, count and minimap ticks
  // all light up, then jump to the first one.
  useEffect(() => {
    if (!selectedPath) return;
    jumpRef.current = true;
    setQ("<" + leaf(selectedPath));
  }, [selectedPath]);

  // Push query changes into the editor; if a tree click triggered it, scroll to
  // the first match.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setQuery.of({ query, caseSensitive }) });
    if (jumpRef.current) {
      jumpRef.current = false;
      const m = view.state.field(matchField);
      if (m.ranges.length) {
        setCursor(0);
        const r = m.ranges[0];
        view.dispatch({ selection: { anchor: r.from, head: r.to }, effects: EditorView.scrollIntoView(r.from, { y: "center" }) });
      }
    }
  }, [query, caseSensitive]);

  function go(delta: number) {
    const view = viewRef.current;
    if (!view) return;
    const m = view.state.field(matchField);
    if (!m.ranges.length) return;
    const next = (cursor + delta + m.ranges.length) % m.ranges.length;
    setCursor(next);
    const r = m.ranges[next];
    view.dispatch({ selection: { anchor: r.from, head: r.to }, effects: EditorView.scrollIntoView(r.from, { y: "center" }) });
    view.focus();
  }

  function format() {
    const view = viewRef.current;
    if (!view) return;
    formatInWorker(view.state.doc.toString())
      .then((pretty) => {
        const v = viewRef.current;
        if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: pretty } });
      })
      .catch(() => {
        /* worker crashed — leave as-is */
      });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-2 border-b border-[var(--color-border)]">
        <div className="flex items-center bg-[var(--color-panel2)] border border-[var(--color-border)] rounded">
          <input
            value={query}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find all instances…"
            onKeyDown={(e) => e.key === "Enter" && go(e.shiftKey ? -1 : 1)}
            className="px-2 py-1 bg-transparent text-sm outline-none w-56"
          />
          <span className="px-2 text-xs text-[var(--color-muted)] tabular-nums select-none">
            {count ? `${Math.min(cursor + 1, count)}/${count}` : query ? "0" : ""}
          </span>
          <button className="px-2 py-1 text-[var(--color-muted)] hover:text-[var(--color-fg)]" title="Previous (Shift+Enter)" onClick={() => go(-1)}>↑</button>
          <button className="px-2 py-1 text-[var(--color-muted)] hover:text-[var(--color-fg)]" title="Next (Enter)" onClick={() => go(1)}>↓</button>
          <button
            className="px-2 py-1 text-xs"
            title="Match case"
            data-active={caseSensitive}
            onClick={() => setCase((c) => !c)}
            style={{ color: caseSensitive ? "var(--color-accent)" : "var(--color-muted)" }}
          >
            Aa
          </button>
        </div>
        <div className="flex-1" />
        {doc !== null && doc.length > HEAVY_VIEW_MAX && (
          <span className="text-xs text-[var(--color-muted)]" title="Minimap and line-wrap are off for large files to keep editing responsive">
            large file — minimap off
          </span>
        )}
        {dirty && (
          <span className="text-xs text-[var(--color-muted)]">
            {doc !== null && doc.length > LIVE_REPARSE_MAX ? "edited (analysis updates on tab switch)" : "edited (analysis updates live)"}
          </span>
        )}
        <button className="btn" onClick={format} title="Pretty-print the document">Format</button>
      </div>
      {doc === null ? (
        <div className="flex-1 flex items-center justify-center text-[var(--color-muted)]">
          {formatting ? "Formatting…" : "Loading…"}
        </div>
      ) : (
        <div ref={host} className="flex-1 min-h-0 overflow-hidden" />
      )}
    </div>
  );
}
