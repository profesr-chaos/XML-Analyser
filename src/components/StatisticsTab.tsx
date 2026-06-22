import { useMemo } from "react";
import type { AnalysisResult, ElementStats } from "../core/types";
import { useStore, leaf } from "../state/store";

function Group({ title, items, render }: { title: string; items: ElementStats[]; render: (s: ElementStats) => string }) {
  const setSelected = useStore((s) => s.setSelected);
  const fullPaths = useStore((s) => s.fullPaths);
  if (!items.length) return null;
  return (
    <section>
      <h3 className="font-semibold mb-2">
        {title} <span className="text-[var(--color-muted)] text-sm">({items.length})</span>
      </h3>
      <div className="space-y-1">
        {items.slice(0, 50).map((s) => (
          <div
            key={s.path}
            onClick={() => setSelected(s.path)}
            className="flex justify-between text-sm cursor-pointer hover:text-[var(--color-accent)] bg-[var(--color-panel2)] rounded px-2 py-1"
          >
            <span className="font-mono" title={s.path}>{fullPaths ? s.path : leaf(s.path)}</span>
            <span className="text-[var(--color-muted)]">{render(s)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function StatisticsTab({ result }: { result: AnalysisResult }) {
  const groups = useMemo(() => {
    const all = Array.from(result.pathStats.values());
    return {
      mixed: all.filter((s) => s.isMixedType),
      repeating: all.filter((s) => s.cardinality.max > 1).sort((a, b) => b.cardinality.max - a.cardinality.max),
      optional: all.filter((s) => s.cardinality.min === 0 && s.path.includes("/", 1)),
      sparse: all.filter((s) => s.emptyPct > 0).sort((a, b) => b.emptyPct - a.emptyPct),
      enums: all.filter((s) => s.valueFrequency && Object.keys(s.valueFrequency).length > 1),
    };
  }, [result]);

  return (
    <div className="p-4 space-y-6 overflow-auto">
      <p className="text-sm text-[var(--color-muted)]">
        Deterministic profiling — the issues that typically break integrations are ranked first.
      </p>
      <Group
        title="⚠ Mixed-type fields"
        items={groups.mixed}
        render={(s) => Object.keys(s.types).filter((t) => t !== "empty").join(" / ")}
      />
      <Group
        title="Repeating (one-to-many) elements"
        items={groups.repeating}
        render={(s) => `${s.cardinality.min}–${s.cardinality.max} per parent`}
      />
      <Group title="Optional elements" items={groups.optional} render={(s) => `present ${s.presentPct}%`} />
      <Group title="Sometimes-empty fields" items={groups.sparse} render={(s) => `empty ${s.emptyPct}%`} />
      <Group
        title="Enum-like fields"
        items={groups.enums}
        render={(s) => `${Object.keys(s.valueFrequency!).length} distinct values`}
      />
    </div>
  );
}
