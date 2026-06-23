import { useEffect, useRef, useState } from "react";
import { useStore, type TabKey } from "./state/store";
import SchemaTree from "./components/SchemaTree";
import SummaryTab from "./components/SummaryTab";
import AllElementsTab from "./components/AllElementsTab";
import ElementDetailTab from "./components/ElementDetailTab";
import StatisticsTab from "./components/StatisticsTab";
import DocumentationTab from "./components/DocumentationTab";
import DiffTab from "./components/DiffTab";
import EditorTab from "./components/EditorTab";

const TABS: [TabKey, string][] = [
  ["summary", "Summary"],
  ["elements", "All Elements"],
  ["detail", "Element Detail"],
  ["statistics", "Statistics"],
  ["documentation", "Documentation"],
  ["editor", "Editor"],
  ["diff", "Diff"],
];

export default function App() {
  const { a, b, loading, error, tab, nsFilter, fullPaths, tabs, activeId, rawA } = useStore();
  const setTab = useStore((s) => s.setTab);
  const openFile = useStore((s) => s.openFile);
  const setActive = useStore((s) => s.setActive);
  const closeTab = useStore((s) => s.closeTab);
  const closeAll = useStore((s) => s.closeAll);
  const setNsFilter = useStore((s) => s.setNsFilter);
  const toggleFullPaths = useStore((s) => s.toggleFullPaths);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [light, setLight] = useState(() => localStorage.getItem("theme") === "light");
  const [sidebarW, setSidebarW] = useState(() => Number(localStorage.getItem("sidebarW")) || 288);

  useEffect(() => {
    document.documentElement.classList.toggle("light", light);
    localStorage.setItem("theme", light ? "light" : "dark");
  }, [light]);

  function startResize() {
    const onMove = (e: MouseEvent) => setSidebarW(Math.min(640, Math.max(180, e.clientX)));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      localStorage.setItem("sidebarW", String(sidebarRef.current));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
  }
  const sidebarRef = useRef(sidebarW);
  sidebarRef.current = sidebarW;

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => /\.xml$/i.test(f.name));
    files.forEach((f) => openFile(f)); // each dropped file opens its own tab
  }

  return (
    <div
      className="h-full flex flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-panel)]">
        {/* Left: brand */}
        <span className="font-semibold tracking-tight flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
          XML Analyser
        </span>
        <input
          ref={fileInput}
          type="file"
          accept=".xml"
          multiple
          className="hidden"
          onChange={(e) => {
            Array.from(e.target.files ?? []).forEach((f) => openFile(f));
            e.target.value = ""; // allow re-opening the same file
          }}
        />

        {/* Center: open file tabs + open/close-all */}
        <div className="flex-1 flex items-center gap-1 min-w-0 overflow-x-auto px-1">
          {tabs.map((t) => (
            <div
              key={t.id}
              onClick={() => setActive(t.id)}
              title={t.name}
              className={`group flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded text-sm cursor-pointer shrink-0 max-w-52 ${
                t.id === activeId
                  ? "bg-[var(--color-bg)] text-[var(--color-fg)] border border-[var(--color-border)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel2)]"
              }`}
            >
              {t.error && <span title={t.error}>⚠</span>}
              <span className="truncate">{t.name}</span>
              <button
                className="w-4 h-4 rounded text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-fg)] shrink-0"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <button className="btn-primary shrink-0" onClick={() => fileInput.current?.click()} title="Open XML file(s)">
            + Open
          </button>
          {tabs.length > 1 && (
            <button className="btn shrink-0" onClick={closeAll} title="Close all tabs">
              Close all
            </button>
          )}
          {nsFilter && (
            <button className="chip shrink-0" onClick={() => setNsFilter(undefined)}>
              ns: {nsFilter} ✕
            </button>
          )}
          {loading && <span className="text-sm text-[var(--color-accent)] shrink-0">Parsing…</span>}
        </div>

        {/* Right: view controls */}
        <div className="flex items-center gap-2 pl-2 border-l border-[var(--color-border)]">
          <div className="seg" title="Path display">
            <button data-active={fullPaths} onClick={() => fullPaths || toggleFullPaths()}>Full</button>
            <button data-active={!fullPaths} onClick={() => fullPaths && toggleFullPaths()}>Leaf</button>
          </div>
          <button
            className="icon-btn"
            title={light ? "Switch to dark" : "Switch to light"}
            onClick={() => setLight((l) => !l)}
          >
            {light ? "🌙" : "☀"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-950 text-rose-200 px-3 py-2 text-sm border-b border-rose-800">{error}</div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Left: schema tree */}
        <aside
          className="bg-[var(--color-panel)] shrink-0 overflow-hidden"
          style={{ width: sidebarW }}
        >
          {a ? (
            <SchemaTree result={a} />
          ) : (
            <div className="p-3 text-sm text-[var(--color-muted)]">No file loaded.</div>
          )}
        </aside>
        {/* Drag handle */}
        <div
          onMouseDown={startResize}
          className="w-1 shrink-0 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent)]"
          title="Drag to resize"
        />
        {/* Right: tabs */}
        <main className="flex-1 flex flex-col min-w-0">
          <nav className="flex gap-1 px-2 pt-2 border-b border-[var(--color-border)] bg-[var(--color-panel)]">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 text-sm rounded-t ${
                  tab === key
                    ? "bg-[var(--color-bg)] text-[var(--color-fg)] border-x border-t border-[var(--color-border)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                }`}
              >
                {label}
                {key === "diff" && b && " •"}
              </button>
            ))}
          </nav>
          <div className="flex-1 min-h-0">
            {!activeId ? (
              <EmptyState onOpen={() => fileInput.current?.click()} dragging={dragging} />
            ) : tab === "editor" ? (
              <EditorTab id={activeId} raw={rawA ?? ""} />
            ) : tab === "diff" ? (
              <DiffTab a={a} />
            ) : !a ? (
              <div className="flex-1 flex items-center justify-center h-full text-[var(--color-muted)]">
                {loading ? "Parsing…" : "Select a tab to analyse."}
              </div>
            ) : (
              <>
                {tab === "summary" && <SummaryTab result={a} />}
                {tab === "elements" && <AllElementsTab result={a} />}
                {tab === "detail" && <ElementDetailTab result={a} />}
                {tab === "statistics" && <StatisticsTab result={a} />}
                {tab === "documentation" && <DocumentationTab result={a} />}
              </>
            )}
          </div>
        </main>
      </div>

      {dragging && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 pointer-events-none">
          <div className="border-2 border-dashed border-[var(--color-accent)] rounded-xl px-12 py-8 text-lg">
            Drop XML to {a ? "compare" : "analyse"} (drop two to diff)
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onOpen, dragging }: { onOpen: () => void; dragging: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
      <div className="text-5xl opacity-30">⟨ / ⟩</div>
      <h1 className="text-2xl font-semibold">Inspect any XML file</h1>
      <p className="text-[var(--color-muted)] max-w-md">
        Everything runs locally — files never leave your machine. Open a file or drop one
        anywhere. Drop two to jump straight into a diff.
      </p>
      <button className="btn" onClick={onOpen}>Open XML file…</button>
      {dragging && <p className="text-[var(--color-accent)]">Release to analyse</p>}
    </div>
  );
}
