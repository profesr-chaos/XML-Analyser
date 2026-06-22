import { useMemo } from "react";
import type { AnalysisResult, DataType } from "../core/types";
import { useStore, leaf } from "../state/store";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[var(--color-panel2)] border border-[var(--color-border)] rounded p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-[var(--color-muted)] text-xs uppercase tracking-wide">{label}</div>
    </div>
  );
}

export default function SummaryTab({ result }: { result: AnalysisResult }) {
  const setSelected = useStore((s) => s.setSelected);
  const setNsFilter = useStore((s) => s.setNsFilter);
  const nsFilter = useStore((s) => s.nsFilter);
  const fullPaths = useStore((s) => s.fullPaths);

  const { top, typeDist, totalTyped } = useMemo(() => {
    const top = Array.from(result.pathStats.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const typeDist: Partial<Record<DataType, number>> = {};
    let totalTyped = 0;
    for (const s of result.pathStats.values()) {
      for (const [t, n] of Object.entries(s.types) as [DataType, number][]) {
        typeDist[t] = (typeDist[t] ?? 0) + n;
        totalTyped += n;
      }
    }
    return { top, typeDist, totalTyped };
  }, [result]);

  return (
    <div className="p-4 space-y-6 overflow-auto">
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <Stat label="Elements" value={result.totalElements} />
        <Stat label="Unique paths" value={result.uniquePaths} />
        <Stat label="Attributes" value={result.totalAttrs} />
        <Stat label="Max depth" value={result.maxDepth} />
        <Stat label="Namespaces" value={result.namespaces.length} />
        <Stat label="Size" value={`${(result.fileSize / 1024).toFixed(1)} KB`} />
      </div>

      <div className="text-sm text-[var(--color-muted)]">
        Root <code className="text-[var(--color-fg)]">{result.rootTag}</code> · Encoding{" "}
        <code className="text-[var(--color-fg)]">{result.encoding}</code>
      </div>

      <section>
        <h3 className="font-semibold mb-2">Top 10 elements</h3>
        <div className="space-y-1">
          {top.map((s) => (
            <div
              key={s.path}
              onClick={() => setSelected(s.path)}
              className="flex items-center gap-2 cursor-pointer hover:text-[var(--color-accent)]"
            >
              <div className="w-48 truncate text-sm" title={s.path}>
                {fullPaths ? s.path : leaf(s.path)}
              </div>
              <div className="flex-1 bg-[var(--color-panel2)] rounded h-3 overflow-hidden">
                <div
                  className="bg-[var(--color-accent)] h-full"
                  style={{ width: `${(s.count / top[0].count) * 100}%` }}
                />
              </div>
              <div className="w-12 text-right text-sm text-[var(--color-muted)]">{s.count}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-semibold mb-2">Data-type distribution</h3>
        <div className="space-y-1">
          {(Object.entries(typeDist) as [DataType, number][])
            .sort((a, b) => b[1] - a[1])
            .map(([t, n]) => (
              <div key={t} className="flex items-center gap-2 text-sm">
                <div className="w-20">{t}</div>
                <div className="flex-1 bg-[var(--color-panel2)] rounded h-3 overflow-hidden">
                  <div className="bg-emerald-500 h-full" style={{ width: `${(n / totalTyped) * 100}%` }} />
                </div>
                <div className="w-24 text-right text-[var(--color-muted)]">
                  {n} ({((n / totalTyped) * 100).toFixed(1)}%)
                </div>
              </div>
            ))}
        </div>
      </section>

      {result.namespaces.length > 0 && (
        <section>
          <h3 className="font-semibold mb-2">Namespaces</h3>
          {result.undefinedNamespaces.length > 0 && (
            <div className="text-amber-400 text-sm mb-2">
              ⚠️ Undefined prefixes: {result.undefinedNamespaces.join(", ")}
            </div>
          )}
          <table className="w-full text-sm border border-[var(--color-border)]">
            <thead className="bg-[var(--color-panel2)] text-left text-[var(--color-muted)]">
              <tr>
                <th className="p-2">Prefix</th>
                <th className="p-2">URI</th>
                <th className="p-2 text-right">Elements</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {result.namespaces.map((ns) => (
                <tr key={ns.uri} className="border-t border-[var(--color-border)]">
                  <td className="p-2">{ns.prefix ?? "(default)"}</td>
                  <td className="p-2 font-mono text-xs">{ns.uri}</td>
                  <td className="p-2 text-right">{ns.elementCount}</td>
                  <td className="p-2">
                    <button
                      onClick={() => setNsFilter(nsFilter === ns.uri ? undefined : ns.uri)}
                      className={`text-xs px-2 py-0.5 rounded border border-[var(--color-border)] ${
                        nsFilter === ns.uri ? "bg-[var(--color-accent)] text-black" : ""
                      }`}
                    >
                      {nsFilter === ns.uri ? "filtered" : "filter"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
