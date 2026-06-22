import type { AnalysisResult, DataType, ElementStats } from "../core/types";
import { useStore } from "../state/store";
import PathLabel from "./PathLabel";

function Breadcrumb({ path }: { path: string }) {
  const setSelected = useStore((s) => s.setSelected);
  const segs = path.split("/").filter(Boolean);
  return (
    <div className="text-sm font-mono text-[var(--color-muted)] mb-2">
      {segs.map((seg, i) => {
        const upto = "/" + segs.slice(0, i + 1).join("/");
        return (
          <span key={upto}>
            <span className="text-[var(--color-muted)]">/</span>
            <button onClick={() => setSelected(upto)} className="hover:text-[var(--color-accent)]">
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function Copyable({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-sm">
      <code className="flex-1 bg-[var(--color-panel2)] px-2 py-1 rounded">{text}</code>
      <button
        onClick={() => navigator.clipboard?.writeText(text)}
        className="text-xs px-2 py-1 border border-[var(--color-border)] rounded hover:border-[var(--color-accent)]"
      >
        copy
      </button>
    </div>
  );
}

function xpathCandidates(s: ElementStats): string[] {
  const tag = s.path.split("/").pop()!;
  const parent = s.path.split("/").slice(-2, -1)[0];
  const out = [`//${tag}`];
  if (parent) out.push(`//${parent}/${tag}`);
  for (const [attr, types] of Object.entries(s.attrs)) {
    out.push(`//${tag}[@${attr}]`);
    void types;
  }
  out.push(s.path); // absolute, namespace-stripped
  return out;
}

function Bars({ stats }: { stats: ElementStats }) {
  const total = Object.values(stats.types).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <div className="space-y-1">
      {(Object.entries(stats.types) as [DataType, number][])
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => (
          <div key={t} className="flex items-center gap-2 text-sm">
            <div className="w-20">{t}</div>
            <div className="flex-1 bg-[var(--color-panel2)] rounded h-3 overflow-hidden">
              <div className="bg-[var(--color-bar)] h-full" style={{ width: `${(n / total) * 100}%` }} />
            </div>
            <div className="w-20 text-right text-[var(--color-muted)]">
              {((n / total) * 100).toFixed(0)}%
            </div>
          </div>
        ))}
    </div>
  );
}

export default function ElementDetailTab({ result }: { result: AnalysisResult }) {
  const selected = useStore((s) => s.selectedPath);
  const stats = selected ? result.pathStats.get(selected) : undefined;

  if (!stats) {
    return <div className="p-6 text-[var(--color-muted)]">Select an element from the tree or a table.</div>;
  }

  const c = stats.cardinality;
  const optional = c.min === 0;
  const repeating = c.max > 1;

  return (
    <div className="p-4 space-y-5 overflow-auto">
      <div>
        <Breadcrumb path={stats.path} />
        <PathLabel path={stats.path} className="text-lg font-semibold font-mono block" />
        <div className="text-sm text-[var(--color-muted)] mt-1">
          {stats.count} occurrences
          {stats.namespace && <> · ns <code>{stats.namespace}</code></>}
          {optional && <span className="ml-2 text-amber-400">optional</span>}
          {repeating && <span className="ml-2 text-sky-400">repeating</span>}
          {stats.isMixedType && <span className="ml-2 text-amber-400">⚠ mixed types</span>}
        </div>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div className="bg-[var(--color-panel2)] rounded p-2">
          <div className="text-[var(--color-muted)] text-xs">Cardinality / parent</div>
          {c.min}–{c.max} (avg {c.avg})
        </div>
        <div className="bg-[var(--color-panel2)] rounded p-2">
          <div className="text-[var(--color-muted)] text-xs">Present</div>
          {stats.presentPct}%
        </div>
        <div className="bg-[var(--color-panel2)] rounded p-2">
          <div className="text-[var(--color-muted)] text-xs">Empty</div>
          {stats.emptyPct}%
        </div>
        {stats.lengthStats && (
          <div className="bg-[var(--color-panel2)] rounded p-2">
            <div className="text-[var(--color-muted)] text-xs">Length min/max/avg</div>
            {stats.lengthStats.min}/{stats.lengthStats.max}/{stats.lengthStats.avg}
          </div>
        )}
        {stats.numericRange && (
          <div className="bg-[var(--color-panel2)] rounded p-2">
            <div className="text-[var(--color-muted)] text-xs">Numeric range</div>
            {stats.numericRange.min} … {stats.numericRange.max}
          </div>
        )}
      </section>

      <section>
        <h3 className="font-semibold mb-2">Data types</h3>
        <Bars stats={stats} />
      </section>

      {Object.keys(stats.attrs).length > 0 && (
        <section>
          <h3 className="font-semibold mb-2">Attributes</h3>
          <table className="tbl">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Required</th></tr>
            </thead>
            <tbody>
              {Object.entries(stats.attrs).map(([an, types]) => (
                <tr key={an}>
                  <td className="font-mono">{an}</td>
                  <td>{Object.keys(types).join(", ")}</td>
                  <td>{stats.requiredAttrs.has(an) ? "required" : "optional"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {stats.valueFrequency && (
        <section>
          <h3 className="font-semibold mb-2">Value frequency</h3>
          <div className="flex flex-wrap gap-2 text-sm">
            {Object.entries(stats.valueFrequency)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 30)
              .map(([v, n]) => (
                <span key={v} className="bg-[var(--color-panel2)] rounded px-2 py-0.5">
                  {v} <span className="text-[var(--color-muted)]">{n}</span>
                </span>
              ))}
          </div>
        </section>
      )}

      {stats.children.size > 0 && (
        <section>
          <h3 className="font-semibold mb-2">Children</h3>
          <div className="flex flex-wrap gap-2 text-sm">
            {Array.from(stats.children).map((c2) => (
              <button
                key={c2}
                onClick={() => useStore.getState().setSelected(`${stats.path}/${c2}`)}
                className="bg-[var(--color-panel2)] rounded px-2 py-0.5 hover:text-[var(--color-accent)]"
              >
                {c2}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="font-semibold mb-2">XPath suggestions</h3>
        <div className="space-y-1">
          {xpathCandidates(stats).map((xp) => (
            <Copyable key={xp} text={xp} />
          ))}
        </div>
      </section>

      {stats.samples.length > 0 && (
        <section>
          <h3 className="font-semibold mb-2">Sample values</h3>
          <ul className="text-sm space-y-1">
            {stats.samples.map((v, i) => (
              <li key={i} className="font-mono bg-[var(--color-panel2)] rounded px-2 py-1">{v}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
