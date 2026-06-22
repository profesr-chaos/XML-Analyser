import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisResult } from "../core/types";
import { lineDiff, schemaDiff, type SchemaDiffResult } from "../core/diff";
import { useStore } from "../state/store";
import PathLabel from "./PathLabel";

const CONTEXT = 3; // unchanged lines kept around each change
const ROW_CAP = 20000; // hard ceiling on rendered rows

type Row = { kind: "add" | "del" | "ctx" | "fold"; text: string };

/** Flatten diff hunks into rows, collapsing long unchanged runs to "… N unchanged …". */
function toRows(changes: ReturnType<typeof lineDiff>["changes"]): Row[] {
  const rows: Row[] = [];
  for (const c of changes) {
    const lines = c.value.replace(/\n$/, "").split("\n");
    if (c.added) lines.forEach((t) => rows.push({ kind: "add", text: t }));
    else if (c.removed) lines.forEach((t) => rows.push({ kind: "del", text: t }));
    else if (lines.length > CONTEXT * 2 + 1) {
      lines.slice(0, CONTEXT).forEach((t) => rows.push({ kind: "ctx", text: t }));
      rows.push({ kind: "fold", text: `⋯ ${lines.length - CONTEXT * 2} unchanged lines ⋯` });
      lines.slice(-CONTEXT).forEach((t) => rows.push({ kind: "ctx", text: t }));
    } else lines.forEach((t) => rows.push({ kind: "ctx", text: t }));
  }
  return rows;
}

function LineDiff({ rawA, rawB }: { rawA: string; rawB: string }) {
  const [res, setRes] = useState<ReturnType<typeof lineDiff> | null>(null);

  useEffect(() => {
    setRes(null);
    // Yield so the "Computing…" state paints before the diff blocks the thread.
    const id = setTimeout(() => setRes(lineDiff(rawA, rawB)), 0);
    return () => clearTimeout(id);
  }, [rawA, rawB]);

  const rows = useMemo(() => (res ? toRows(res.changes) : []), [res]);

  if (!res) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-muted)]">
        Computing line diff…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 text-sm text-[var(--color-muted)]">
        <span className="text-emerald-400">+{res.added}</span>{" "}
        <span className="text-rose-400">−{res.removed}</span> lines changed
      </div>
      <pre className="flex-1 overflow-auto text-xs font-mono leading-5">
        {rows.slice(0, ROW_CAP).map((r, i) =>
          r.kind === "fold" ? (
            <div key={i} className="text-center text-[var(--color-muted)] bg-[var(--color-panel2)] my-1">
              {r.text}
            </div>
          ) : (
            <div
              key={i}
              className={
                r.kind === "add"
                  ? "bg-emerald-950/60 text-emerald-300"
                  : r.kind === "del"
                    ? "bg-rose-950/60 text-rose-300"
                    : "text-[var(--color-muted)]"
              }
            >
              <span className="select-none opacity-50">
                {r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "}{" "}
              </span>
              {r.text}
            </div>
          ),
        )}
        {rows.length > ROW_CAP && (
          <div className="text-amber-400 p-2">Output truncated at {ROW_CAP} rows.</div>
        )}
      </pre>
    </div>
  );
}

function diffMarkdown(d: SchemaDiffResult, nameA: string, nameB: string): string {
  const sec = (t: string, items: string[]) =>
    items.length ? `## ${t} (${items.length})\n${items.map((i) => `- \`${i}\``).join("\n")}\n` : "";
  return [
    `# Schema diff: ${nameA} → ${nameB}\n`,
    sec("Elements added", d.elementsOnlyInB),
    sec("Elements removed", d.elementsOnlyInA),
    sec("Attributes added", d.attrsOnlyInB),
    sec("Attributes removed", d.attrsOnlyInA),
    d.typeChanges.length
      ? `## Type changes (${d.typeChanges.length})\n${d.typeChanges
          .map((t) => `- \`${t.path}\`: ${t.fromType} → ${t.toType}`)
          .join("\n")}\n`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function SchemaDiff({ a, b }: { a: AnalysisResult; b: AnalysisResult }) {
  const [q, setQ] = useState("");
  const nameA = useStore((s) => s.nameA) ?? "A";
  const nameB = useStore((s) => s.nameB) ?? "B";
  const d = useMemo(() => schemaDiff(a, b), [a, b]);
  const ql = q.trim().toLowerCase();
  const f = (xs: string[]) => xs.filter((x) => x.toLowerCase().includes(ql));

  const cats: [string, string[], string][] = [
    ["Only in A (removed)", f(d.elementsOnlyInA), "text-rose-400"],
    ["Only in B (added)", f(d.elementsOnlyInB), "text-emerald-400"],
    ["Attributes only in A", f(d.attrsOnlyInA), "text-rose-400"],
    ["Attributes only in B", f(d.attrsOnlyInB), "text-emerald-400"],
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search paths…"
          className="flex-1 px-2 py-1 bg-[var(--color-panel2)] border border-[var(--color-border)] rounded text-sm outline-none"
        />
        <button
          className="btn"
          onClick={() => navigator.clipboard?.writeText(diffMarkdown(d, nameA, nameB))}
        >
          Copy changelog
        </button>
      </div>
      <div className="px-2 pb-2 text-sm flex gap-4">
        <span className="text-emerald-400">+{d.elementsOnlyInB.length} elem</span>
        <span className="text-rose-400">−{d.elementsOnlyInA.length} elem</span>
        <span className="text-amber-400">~{d.typeChanges.length} type changes</span>
        <span className="text-[var(--color-muted)]">{d.common.length} common</span>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-4 text-sm">
        {cats.map(([title, items, color]) => (
          <section key={title}>
            <h4 className={`font-semibold mb-1 ${color}`}>{title} ({items.length})</h4>
            {items.map((i) => (
              <PathLabel key={i} path={i} className="font-mono pl-2 block" />
            ))}
          </section>
        ))}
        <section>
          <h4 className="font-semibold mb-1 text-amber-400">Type changes ({d.typeChanges.filter((t) => t.path.toLowerCase().includes(ql)).length})</h4>
          {d.typeChanges
            .filter((t) => t.path.toLowerCase().includes(ql))
            .map((t) => (
              <div key={t.path} className="font-mono pl-2">
                <PathLabel path={t.path} /> <span className="text-[var(--color-muted)]">{t.fromType} → {t.toType}</span>
              </div>
            ))}
        </section>
      </div>
    </div>
  );
}

function FileSlot({
  label,
  name,
  slot,
}: {
  label: string;
  name?: string;
  slot: "a" | "b";
}) {
  const loadFile = useStore((s) => s.loadFile);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (f?: File) => f && /\.xml$/i.test(f.name) && loadFile(f, slot);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        pick(Array.from(e.dataTransfer.files)[0]);
      }}
      className={`flex-1 border-2 border-dashed rounded-lg p-4 text-center ${
        over ? "border-[var(--color-accent)] bg-[var(--color-panel2)]" : "border-[var(--color-border)]"
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="my-1 font-mono text-sm truncate">{name ?? "no file"}</div>
      <input
        ref={input}
        type="file"
        accept=".xml"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0] ?? undefined)}
      />
      <button className="btn" onClick={() => input.current?.click()}>
        {name ? "Replace…" : "Choose file…"}
      </button>
      <div className="text-xs text-[var(--color-muted)] mt-1">or drop here</div>
    </div>
  );
}

export default function DiffTab({ a }: { a?: AnalysisResult }) {
  const b = useStore((s) => s.b);
  const rawA = useStore((s) => s.rawA);
  const rawB = useStore((s) => s.rawB);
  const nameA = useStore((s) => s.nameA);
  const nameB = useStore((s) => s.nameB);
  const [sub, setSub] = useState<"line" | "schema">("schema");

  const ready = b && rawA && rawB;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-3 border-b border-[var(--color-border)]">
        <FileSlot label="File A" name={nameA} slot="a" />
        <span className="text-[var(--color-muted)] shrink-0">↔</span>
        <FileSlot label="File B" name={nameB} slot="b" />
      </div>

      {!ready ? (
        <div className="flex-1 flex items-center justify-center text-[var(--color-muted)]">
          Load a file into each side to compare.
        </div>
      ) : (
        <>
          <div className="flex gap-1 p-2 border-b border-[var(--color-border)]">
            {(["schema", "line"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setSub(k)}
                className={`px-3 py-1 text-sm rounded ${
                  sub === k ? "bg-[var(--color-panel2)] text-[var(--color-accent)]" : "text-[var(--color-muted)]"
                }`}
              >
                {k === "schema" ? "Schema Diff" : "Line Diff"}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0">
            {sub === "schema" ? <SchemaDiff a={a!} b={b!} /> : <LineDiff rawA={rawA!} rawB={rawB!} />}
          </div>
        </>
      )}
    </div>
  );
}
