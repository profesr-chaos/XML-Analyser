import type { AnalysisResult, ElementStats } from "./types";
import { contentType } from "./diff";

export interface DocOptions {
  overview: boolean;
  elementReference: boolean;
  attributeTables: boolean;
  examples: boolean;
  verbose: boolean;
}

export const DEFAULT_DOC_OPTIONS: DocOptions = {
  overview: true,
  elementReference: true,
  attributeTables: true,
  examples: true,
  verbose: false,
};

function sortedPaths(r: AnalysisResult): ElementStats[] {
  return Array.from(r.pathStats.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function typeList(s: ElementStats): string {
  return Object.entries(s.types)
    .map(([t, n]) => `${t} (${n})`)
    .join(", ");
}

export function markdownDoc(r: AnalysisResult, opts: DocOptions = DEFAULT_DOC_OPTIONS): string {
  const out: string[] = [];
  const title = r.filePath || r.rootTag;
  out.push(`# XML Schema: ${title}`, "");

  if (opts.overview) {
    out.push("## Overview", "");
    out.push(`- **Root element:** \`${r.rootTag}\``);
    out.push(`- **Encoding:** ${r.encoding}`);
    out.push(`- **Total elements:** ${r.totalElements}`);
    out.push(`- **Unique paths:** ${r.uniquePaths}`);
    out.push(`- **Total attributes:** ${r.totalAttrs}`);
    out.push(`- **Max depth:** ${r.maxDepth}`);
    out.push(`- **Namespaces:** ${r.namespaces.length}`, "");
    out.push("| Path | Count | Content type | Attributes |", "|---|---|---|---|");
    for (const s of sortedPaths(r)) {
      out.push(
        `| \`${s.path}\` | ${s.count} | ${contentType(s)} | ${Object.keys(s.attrs).join(", ") || "—"} |`,
      );
    }
    out.push("");
  }

  if (opts.elementReference) {
    out.push("## Element reference", "");
    for (const s of sortedPaths(r)) {
      out.push(`### \`${s.path}\``, "");
      out.push(`- Occurrences: ${s.count}`);
      out.push(`- Content type: ${typeList(s)}`);
      out.push(`- Cardinality: ${s.cardinality.min}–${s.cardinality.max} per parent (avg ${s.cardinality.avg})`);
      if (s.children.size) out.push(`- Children: ${Array.from(s.children).join(", ")}`);
      if (opts.verbose && s.parents.size) out.push(`- Parents: ${Array.from(s.parents).join(", ")}`);
      if (opts.verbose && s.isMixedType) out.push(`- ⚠️ Mixed types`);
      if (opts.attributeTables && Object.keys(s.attrs).length) {
        out.push("", "| Attribute | Type | Required |", "|---|---|---|");
        for (const [an, types] of Object.entries(s.attrs)) {
          const t = Object.keys(types).join(", ");
          out.push(`| ${an} | ${t} | ${s.requiredAttrs.has(an) ? "yes" : "no"} |`);
        }
      }
      if (opts.examples && s.samples.length) {
        out.push("", `Example: \`${s.samples[0]}\``);
      }
      out.push("");
    }
  }
  return out.join("\n");
}

export function htmlDoc(r: AnalysisResult, opts: DocOptions = DEFAULT_DOC_OPTIONS): string {
  // Self-contained: inline CSS, no external assets (spec 5.3).
  const body = mdToBasicHtml(markdownDoc(r, opts));
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>XML Schema: ${escapeHtml(r.filePath || r.rootTag)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#1a1a1a;line-height:1.5}
code{background:#f0f0f0;padding:.1em .3em;border-radius:3px;font-size:.9em}
table{border-collapse:collapse;width:100%;margin:1rem 0}
th,td{border:1px solid #ddd;padding:.4rem .6rem;text-align:left;font-size:.9em}
th{background:#f6f6f6}
h3{margin-top:2rem;border-top:1px solid #eee;padding-top:1rem}
</style></head><body>
${body}
</body></html>`;
}

export function textReport(r: AnalysisResult): string {
  const out: string[] = [];
  out.push("XML ANALYSIS REPORT", "=".repeat(60), "");
  out.push(`File:            ${r.filePath || "(in memory)"}`);
  out.push(`Root:            ${r.rootTag}`);
  out.push(`Encoding:        ${r.encoding}`);
  out.push(`Total elements:  ${r.totalElements}`);
  out.push(`Unique paths:    ${r.uniquePaths}`);
  out.push(`Total attrs:     ${r.totalAttrs}`);
  out.push(`Max depth:       ${r.maxDepth}`);
  out.push("", "ELEMENT INVENTORY", "-".repeat(60));
  for (const s of sortedPaths(r)) {
    out.push(`${s.path}  (${s.count}x)  [${contentType(s)}]`);
    if (s.samples.length) out.push(`    e.g. ${s.samples[0]}`);
  }
  out.push("", "ATTRIBUTE INVENTORY", "-".repeat(60));
  for (const s of sortedPaths(r)) {
    for (const [an, types] of Object.entries(s.attrs)) {
      out.push(
        `${s.path}@${an}  [${Object.keys(types).join(",")}]  ${s.requiredAttrs.has(an) ? "required" : "optional"}`,
      );
    }
  }
  return out.join("\n");
}

/** Machine-readable dump of the analysis (Sets/Maps -> arrays/objects). */
export function jsonDump(r: AnalysisResult): string {
  const pathStats: Record<string, unknown> = {};
  for (const [path, s] of r.pathStats) {
    pathStats[path] = {
      ...s,
      requiredAttrs: Array.from(s.requiredAttrs),
      children: Array.from(s.children),
      parents: Array.from(s.parents),
    };
  }
  return JSON.stringify(
    {
      ...r,
      pathStats,
      allPaths: Array.from(r.allPaths),
      allAttrPaths: Array.from(r.allAttrPaths),
    },
    null,
    2,
  );
}

// Minimal markdown -> HTML (headings, tables, bold, inline code, lists).
function mdToBasicHtml(md: string): string {
  const lines = md.split("\n");
  const html: string[] = [];
  let i = 0;
  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  while (i < lines.length) {
    const line = lines[i];
    if (/^\| .* \|$/.test(line) && /^\|[-| ]+\|$/.test(lines[i + 1] ?? "")) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\| .* \|$/.test(lines[i])) rows.push(splitRow(lines[i++]));
      html.push("<table><thead><tr>" + header.map((h) => `<th>${inline(h)}</th>`).join("") + "</tr></thead><tbody>");
      for (const r of rows) html.push("<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      html.push("</tbody></table>");
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = h[1].length;
      html.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
    } else if (/^- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(`<li>${inline(lines[i++].slice(2))}</li>`);
      html.push("<ul>" + items.join("") + "</ul>");
      continue;
    } else if (line.trim() === "") {
      // skip
    } else {
      html.push(`<p>${inline(line)}</p>`);
    }
    i++;
  }
  return html.join("\n");
}

function splitRow(line: string): string[] {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
