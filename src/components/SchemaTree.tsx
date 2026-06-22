import { useMemo, useState } from "react";
import type { AnalysisResult } from "../core/types";
import { useStore } from "../state/store";

interface Node {
  tag: string;
  path: string;
  count: number;
  children: Node[];
}

function buildTree(r: AnalysisResult): Node {
  const root: Node = { tag: "", path: "", count: 0, children: [] };
  const index = new Map<string, Node>([["", root]]);
  for (const path of Array.from(r.allPaths).sort()) {
    const segs = path.split("/").filter(Boolean);
    let parentPath = "";
    let acc = "";
    for (const seg of segs) {
      acc += "/" + seg;
      let node = index.get(acc);
      if (!node) {
        node = { tag: seg, path: acc, count: r.pathStats.get(acc)?.count ?? 0, children: [] };
        index.set(acc, node);
        index.get(parentPath)!.children.push(node);
      }
      parentPath = acc;
    }
  }
  return root;
}

/** Does this subtree contain a node whose tag matches the query? */
function matches(node: Node, q: string): boolean {
  if (node.tag.toLowerCase().includes(q)) return true;
  return node.children.some((c) => matches(c, q));
}

/** Collect every path that has children (i.e. is expandable). */
function expandablePaths(node: Node, depth: number, out: Set<string>, defaultOnly: boolean) {
  for (const c of node.children) {
    if (c.children.length) {
      if (!defaultOnly || depth < 1) out.add(c.path);
      expandablePaths(c, depth + 1, out, defaultOnly);
    }
  }
}

function TreeNode({
  node,
  q,
  depth,
  expanded,
  toggle,
}: {
  node: Node;
  q: string;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
}) {
  const selected = useStore((s) => s.selectedPath);
  const setSelected = useStore((s) => s.setSelected);
  const hasKids = node.children.length > 0;
  const isOpen = q ? true : expanded.has(node.path);

  const visibleKids = q ? node.children.filter((c) => matches(c, q)) : node.children;
  const isMatch = q && node.tag.toLowerCase().includes(q);

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer hover:bg-[var(--color-panel2)] ${
          selected === node.path ? "bg-[var(--color-panel2)] text-[var(--color-accent)]" : ""
        }`}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => setSelected(node.path)}
      >
        {hasKids ? (
          <button
            className="w-4 text-[var(--color-muted)] shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.path);
            }}
          >
            {isOpen ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className={isMatch ? "text-[var(--color-accent)]" : ""}>{node.tag}</span>
        <span className="text-[var(--color-muted)] text-xs">({node.count}×)</span>
      </div>
      {isOpen &&
        visibleKids.map((c) => (
          <TreeNode key={c.path} node={c} q={q} depth={depth + 1} expanded={expanded} toggle={toggle} />
        ))}
    </div>
  );
}

export default function SchemaTree({ result }: { result: AnalysisResult }) {
  const [q, setQ] = useState("");
  const tree = useMemo(() => buildTree(result), [result]);
  const allExpandable = useMemo(() => {
    const s = new Set<string>();
    expandablePaths(tree, 0, s, false);
    return s;
  }, [tree]);

  // default: top two levels open
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    expandablePaths(tree, 0, s, true);
    return s;
  });
  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const query = q.trim().toLowerCase();

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 m-2 mb-0">
        <button className="btn flex-1" onClick={() => setExpanded(new Set(allExpandable))}>
          Expand all
        </button>
        <button className="btn flex-1" onClick={() => setExpanded(new Set())}>
          Collapse all
        </button>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter elements…"
        className="m-2 px-2 py-1 bg-[var(--color-panel2)] border border-[var(--color-border)] rounded text-sm outline-none focus:border-[var(--color-accent)]"
      />
      <div className="overflow-auto flex-1 text-sm px-1 pb-2">
        {tree.children.map((c) => (
          <TreeNode key={c.path} node={c} q={query} depth={0} expanded={expanded} toggle={toggle} />
        ))}
      </div>
    </div>
  );
}
