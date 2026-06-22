import { useStore } from "../state/store";

/**
 * Renders an element path with the ancestor prefix dimmed and the leaf
 * emphasised, so long monospace paths stay scannable. Honours the global
 * Full/Leaf toggle (leaf mode drops the prefix entirely).
 */
export default function PathLabel({ path, className }: { path: string; className?: string }) {
  const fullPaths = useStore((s) => s.fullPaths);
  const segs = path.split("/").filter(Boolean);
  const leaf = segs[segs.length - 1] ?? path;
  const prefix = segs.slice(0, -1);
  return (
    <span className={className} title={path}>
      {fullPaths && prefix.length > 0 && (
        <span className="text-[var(--color-muted)]">/{prefix.join("/")}/</span>
      )}
      <span className="text-[var(--color-fg)] font-medium">{leaf}</span>
    </span>
  );
}
