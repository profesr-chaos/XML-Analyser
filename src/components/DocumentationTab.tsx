import { useMemo, useState } from "react";
import type { AnalysisResult } from "../core/types";
import { markdownDoc, htmlDoc, jsonDump, textReport, DEFAULT_DOC_OPTIONS, type DocOptions } from "../core/docgen";

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const TOGGLES: [keyof DocOptions, string][] = [
  ["overview", "Overview"],
  ["elementReference", "Element reference"],
  ["attributeTables", "Attribute tables"],
  ["examples", "Examples"],
  ["verbose", "Verbose"],
];

export default function DocumentationTab({ result }: { result: AnalysisResult }) {
  const [opts, setOpts] = useState<DocOptions>(DEFAULT_DOC_OPTIONS);
  const md = useMemo(() => markdownDoc(result, opts), [result, opts]);
  const base = (result.filePath || result.rootTag).replace(/\.[^.]+$/, "");

  function printPdf() {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(htmlDoc(result, opts));
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-3 p-3 border-b border-[var(--color-border)]">
        {TOGGLES.map(([key, label]) => (
          <label key={key} className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={opts[key]}
              onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
        <div className="flex-1" />
        <button className="btn" onClick={() => navigator.clipboard?.writeText(md)}>Copy MD</button>
        <button className="btn" onClick={() => download(`${base}.md`, md, "text/markdown")}>Markdown</button>
        <button className="btn" onClick={() => download(`${base}.html`, htmlDoc(result, opts), "text/html")}>HTML</button>
        <button className="btn" onClick={() => download(`${base}.json`, jsonDump(result), "application/json")}>JSON</button>
        <button className="btn" onClick={() => download(`${base}.txt`, textReport(result), "text/plain")}>Text</button>
        <button className="btn" onClick={printPdf}>PDF</button>
      </div>
      <pre className="flex-1 overflow-auto p-4 text-sm font-mono whitespace-pre-wrap">{md}</pre>
    </div>
  );
}
