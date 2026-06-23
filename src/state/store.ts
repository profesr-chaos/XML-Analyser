import { create } from "zustand";
import type { AnalysisResult } from "../core/types";
import { analyseInWorker } from "../parseClient";

export type TabKey =
  | "summary"
  | "elements"
  | "detail"
  | "statistics"
  | "documentation"
  | "editor"
  | "diff";

/** One open file. raw is always kept; result is parsed lazily on activation. */
export interface OpenTab {
  id: string;
  name: string;
  raw: string;
  result?: AnalysisResult;
  error?: string;
}

interface State {
  tabs: OpenTab[];
  activeId?: string;
  compareId?: string; // tab to diff the active one against

  // Mirrors of the active (a) / compare (b) tab, kept in sync so the analysis
  // components can keep taking a/b/raw*/name* without knowing about tabs.
  a?: AnalysisResult;
  b?: AnalysisResult;
  rawA?: string;
  rawB?: string;
  nameA?: string;
  nameB?: string;

  loading: boolean;
  error?: string;
  selectedPath?: string;
  tab: TabKey;
  nsFilter?: string; // namespace URI to filter by, or undefined for all
  fullPaths: boolean; // show full /a/b/c vs just the leaf tag

  openFile(file: File): Promise<void>;
  setActive(id: string): void;
  closeTab(id: string): void;
  closeAll(): void;
  setCompare(id?: string): void;
  setEditedRaw(id: string, raw: string): void;

  setSelected(path: string): void;
  setTab(tab: TabKey): void;
  setNsFilter(uri?: string): void;
  toggleFullPaths(): void;
}

/** Render a path as the full thing or just its leaf, per the global toggle. */
export function leaf(path: string): string {
  return path.split("/").pop() || path;
}

/** Recompute the a/b mirrors from the active + compare tabs. */
function mirror(tabs: OpenTab[], activeId?: string, compareId?: string) {
  const at = tabs.find((t) => t.id === activeId);
  const bt = tabs.find((t) => t.id === compareId);
  return {
    a: at?.result,
    rawA: at?.raw,
    nameA: at?.name,
    b: bt?.result,
    rawB: bt?.raw,
    nameB: bt?.name,
  };
}

let nextId = 1;

// Above this raw size, don't re-analyse on every edit — wait until the user
// navigates to an analysis view. Keeps editing a huge doc responsive.
const LIVE_REPARSE_MAX = 2_000_000; // ~2 MB

export const useStore = create<State>((set, get) => {
  const inFlight = new Set<string>(); // tab ids currently parsing in the worker

  /** Parse a tab's raw into a result off-thread if it hasn't been parsed yet. */
  function ensureParsed(id: string, opts: { silent?: boolean } = {}) {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || tab.result || tab.error || inFlight.has(id)) return;
    inFlight.add(id);
    if (!opts.silent) set({ loading: true, error: undefined });
    const raw = tab.raw; // pin: discard the result if the tab was edited meanwhile
    analyseInWorker(raw, tab.name).then(
      (result) => {
        inFlight.delete(id);
        const t = get().tabs.find((x) => x.id === id);
        if (!t || t.raw !== raw) {
          if (!opts.silent) set({ loading: false });
          return; // stale (edited or closed) — a later ensureParsed will cover it
        }
        set((s) => {
          const tabs = s.tabs.map((x) => (x.id === id ? { ...x, result } : x));
          return { tabs, loading: false, ...mirror(tabs, s.activeId, s.compareId) };
        });
      },
      (e: Error) => {
        inFlight.delete(id);
        const error = `${tab.name}: ${e.message}`;
        set((s) => {
          const tabs = s.tabs.map((x) => (x.id === id ? { ...x, error } : x));
          return { tabs, loading: false, error, ...mirror(tabs, s.activeId, s.compareId) };
        });
      },
    );
  }

  return {
    tabs: [],
    loading: false,
    tab: "summary",
    fullPaths: localStorage.getItem("fullPaths") !== "false",

    async openFile(file) {
      const raw = await file.text();
      const id = `t${nextId++}`;
      set((s) => {
        const tabs = [...s.tabs, { id, name: file.name, raw }];
        return {
          tabs,
          activeId: id,
          error: undefined,
          selectedPath: undefined,
          ...mirror(tabs, id, s.compareId),
        };
      });
      ensureParsed(id);
    },

    setActive(id) {
      set((s) => ({ activeId: id, selectedPath: undefined, error: undefined, ...mirror(s.tabs, id, s.compareId) }));
      ensureParsed(id);
    },

    closeTab(id) {
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.id === id);
        const tabs = s.tabs.filter((t) => t.id !== id);
        let activeId = s.activeId;
        if (s.activeId === id) {
          const next = tabs[idx] ?? tabs[idx - 1]; // neighbour to the right, else left
          activeId = next?.id;
        }
        const compareId = s.compareId === id ? undefined : s.compareId;
        if (activeId) ensureParsed(activeId);
        return { tabs, activeId, compareId, ...mirror(tabs, activeId, compareId) };
      });
    },

    closeAll: () =>
      set({
        tabs: [],
        activeId: undefined,
        compareId: undefined,
        selectedPath: undefined,
        error: undefined,
        a: undefined,
        b: undefined,
        rawA: undefined,
        rawB: undefined,
        nameA: undefined,
        nameB: undefined,
      }),

    setCompare(id) {
      set((s) => ({ compareId: id, ...mirror(s.tabs, s.activeId, id) }));
      if (id) ensureParsed(id, { silent: true });
    },

    setEditedRaw(id, raw) {
      // Edit invalidates the parsed result.
      set((s) => {
        const tabs = s.tabs.map((t) => (t.id === id ? { ...t, raw, result: undefined, error: undefined } : t));
        return { tabs, ...mirror(tabs, s.activeId, s.compareId) };
      });
      // Re-analyse live only for small files; large ones defer to navigation
      // (setTab/setActive) so editing a 20 MB doc isn't a full reparse per pause.
      if (raw.length <= LIVE_REPARSE_MAX) ensureParsed(id, { silent: true });
    },

    // In the editor, a tree click highlights occurrences in place; elsewhere it
    // opens Element Detail as before.
    setSelected: (selectedPath) =>
      set((s) => ({ selectedPath, tab: s.tab === "editor" ? "editor" : "detail" })),
    setTab: (tab) => {
      set({ tab });
      // Leaving the editor for an analysis view: make sure the active (and, for
      // diff, the compare) tab is parsed — covers deferred large-file edits.
      if (tab !== "editor") {
        const { activeId, compareId } = get();
        if (activeId) ensureParsed(activeId);
        if (tab === "diff" && compareId) ensureParsed(compareId, { silent: true });
      }
    },
    setNsFilter: (nsFilter) => set({ nsFilter }),
    toggleFullPaths: () =>
      set((s) => {
        const fullPaths = !s.fullPaths;
        localStorage.setItem("fullPaths", String(fullPaths));
        return { fullPaths };
      }),
  };
});
