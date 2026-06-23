import { SaxesParser, type SaxesTag } from "saxes";

// Pretty-print XML from a streaming parse — no DOM (so it runs in a Worker) and,
// unlike the old DOMParser version, it preserves comments, CDATA and PIs.
// Lenient: malformed input is returned untouched rather than throwing.

const esc = (s: string) =>
  s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
const escAttr = (s: string) =>
  s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

type Tok = { el: true; s: string } | { el: false; s: string }; // el = already-indented child block

interface Frame {
  name: string;
  attrs: string;
  selfClosing: boolean;
  depth: number;
  text: string; // accumulated direct text (mixed content collapses to one block)
  parts: Tok[];
}

export function formatXml(xml: string): string {
  const parser = new SaxesParser();
  const out: string[] = [];
  const stack: Frame[] = [];
  let failed = false;
  const ind = (d: number) => "  ".repeat(d);
  const top = () => stack[stack.length - 1];

  parser.on("error", () => {
    failed = true;
  });

  parser.on("opentag", (tag: SaxesTag) => {
    let attrs = "";
    for (const [k, v] of Object.entries(tag.attributes as Record<string, string>)) {
      attrs += ` ${k}="${escAttr(v)}"`;
    }
    stack.push({ name: tag.name, attrs, selfClosing: tag.isSelfClosing, depth: stack.length, text: "", parts: [] });
  });

  parser.on("text", (t: string) => {
    const f = top();
    if (f) f.text += t;
  });

  // Block-level nodes that force an element to render multi-line.
  const block = (s: string) => {
    const f = top();
    if (f) f.parts.push({ el: false, s });
    else out.push(s);
  };
  parser.on("cdata", (t: string) => block(`<![CDATA[${t}]]>`));
  parser.on("comment", (c: string) => block(`<!--${c}-->`));
  parser.on("processinginstruction", (pi: { target: string; body: string }) =>
    block(`<?${pi.target}${pi.body ? " " + pi.body : ""}?>`),
  );
  parser.on("doctype", (dt: string) => out.push(`<!DOCTYPE${dt}>`));
  parser.on("xmldecl", (d: { version?: string; encoding?: string; standalone?: string }) => {
    let s = `<?xml version="${d.version ?? "1.0"}"`;
    if (d.encoding) s += ` encoding="${d.encoding}"`;
    if (d.standalone) s += ` standalone="${d.standalone}"`;
    out.push(s + "?>");
  });

  parser.on("closetag", () => {
    const f = stack.pop()!;
    const i = ind(f.depth);
    const text = f.text.trim();
    let rendered: string;
    if (f.selfClosing || (!f.parts.length && !text)) {
      rendered = `${i}<${f.name}${f.attrs}/>`;
    } else if (!f.parts.length) {
      rendered = `${i}<${f.name}${f.attrs}>${esc(text)}</${f.name}>`;
    } else {
      const ci = ind(f.depth + 1);
      const lines = [`${i}<${f.name}${f.attrs}>`];
      if (text) lines.push(`${ci}${esc(text)}`);
      for (const p of f.parts) lines.push(p.el ? p.s : `${ci}${p.s}`);
      lines.push(`${i}</${f.name}>`);
      rendered = lines.join("\n");
    }
    const parent = top();
    if (parent) parent.parts.push({ el: true, s: rendered });
    else out.push(rendered);
  });

  try {
    parser.write(xml).close();
  } catch {
    failed = true;
  }

  return failed ? xml : out.join("\n");
}
