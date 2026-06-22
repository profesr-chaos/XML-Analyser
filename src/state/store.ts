import { create } from "zustand";
import type { AnalysisResult } from "../core/types";
import { analyse, XmlParseError } from "../core/analyse";

export type TabKey =
  | "summary"
  | "elements"
  | "detail"
  | "statistics"
  | "documentation"
  | "diff";

interface State {
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

  loadFile(file: File, slot: "a" | "b"): Promise<void>;
  setSelected(path: string): void;
  setTab(tab: TabKey): void;
  setNsFilter(uri?: string): void;
  toggleFullPaths(): void;
  clear(): void;
}

/** Render a path as the full thing or just its leaf, per the global toggle. */
export function leaf(path: string): string {
  return path.split("/").pop() || path;
}

async function run(file: File): Promise<{ result: AnalysisResult; raw: string }> {
  const raw = await file.text();
  // ponytail: synchronous DOMParser on the main thread (it has no Worker form).
  // Yield once so the loading state paints before a big parse blocks the thread.
  await new Promise((r) => setTimeout(r, 0));
  return { result: analyse(raw, file.name), raw };
}

export const useStore = create<State>((set) => ({
  loading: false,
  tab: "summary",
  fullPaths: localStorage.getItem("fullPaths") !== "false",

  async loadFile(file, slot) {
    set({ loading: true, error: undefined });
    try {
      const { result, raw } = await run(file);
      if (slot === "a") {
        set({ a: result, rawA: raw, nameA: file.name, loading: false, selectedPath: undefined });
      } else {
        set({ b: result, rawB: raw, nameB: file.name, loading: false, tab: "diff" });
      }
    } catch (e) {
      const msg =
        e instanceof XmlParseError
          ? `${file.name}: ${e.message}`
          : `${file.name}: ${(e as Error).message}`;
      set({ loading: false, error: msg });
    }
  },

  setSelected: (selectedPath) => set({ selectedPath, tab: "detail" }),
  setTab: (tab) => set({ tab }),
  setNsFilter: (nsFilter) => set({ nsFilter }),
  toggleFullPaths: () =>
    set((s) => {
      const fullPaths = !s.fullPaths;
      localStorage.setItem("fullPaths", String(fullPaths));
      return { fullPaths };
    }),
  clear: () => set({ a: undefined, b: undefined, rawA: undefined, rawB: undefined, nameA: undefined, nameB: undefined, selectedPath: undefined, error: undefined, tab: "summary" }),
}));
