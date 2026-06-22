import { useMemo, useState } from "react";
import type { AnalysisResult } from "../core/types";
import { contentType } from "../core/diff";
import { useStore } from "../state/store";

export default function AllElementsTab({ result }: { result: AnalysisResult }) {
  const [q, setQ] = useState("");
  const setSelected = useStore((s) => s.setSelected);
  const nsFilter = useStore((s) => s.nsFilter);

  const all = useMemo(
    () => Array.from(result.pathStats.values()).sort((a, b) => a.path.localeCompare(b.path)),
    [result],
  );

  const query = q.trim().toLowerCase();
  const rows = all.filter((s) => {
    if (nsFilter && s.namespace !== nsFilter) return false;
    if (!query) return true;
    return (
      s.path.toLowerCase().includes(query) ||
      Object.keys(s.attrs).some((a) => a.toLowerCase().includes(query)) ||
      s.samples.some((v) => v.toLowerCase().includes(query))
    );
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search path, attributes, sample values…"
          className="flex-1 px-2 py-1 bg-[var(--color-panel2)] border border-[var(--color-border)] rounded text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <span className="text-sm text-[var(--color-muted)] whitespace-nowrap">
          {rows.length} of {all.length} elements
        </span>
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--color-panel)] text-left text-[var(--color-muted)]">
            <tr>
              <th className="p-2">Path</th>
              <th className="p-2 text-right">Count</th>
              <th className="p-2">Type</th>
              <th className="p-2">Attributes</th>
              <th className="p-2">Parents</th>
              <th className="p-2">Sample</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const depth = s.path.split("/").length - 2;
              return (
                <tr
                  key={s.path}
                  onClick={() => setSelected(s.path)}
                  className="border-t border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-panel2)]"
                >
                  <td className="p-2" style={{ paddingLeft: depth * 12 + 8 }}>
                    {s.path.split("/").pop()}
                    {s.isMixedType && <span className="ml-1 text-amber-400" title="Mixed types">⚠</span>}
                  </td>
                  <td className="p-2 text-right text-[var(--color-muted)]">{s.count}</td>
                  <td className="p-2">{contentType(s)}</td>
                  <td className="p-2 text-[var(--color-muted)]">{Object.keys(s.attrs).join(", ")}</td>
                  <td className="p-2 text-[var(--color-muted)] text-xs">
                    {Array.from(s.parents).map((p) => p.split("/").pop()).join(", ")}
                  </td>
                  <td className="p-2 text-[var(--color-muted)] truncate max-w-xs">{s.samples[0] ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
