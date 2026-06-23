// Off-thread XML work. analyse() and formatXml() are pure-JS (saxes, no DOM) so
// they run here; keeping them off the main thread is what stops large files
// freezing the UI.
import { analyse, XmlParseError } from "./core/analyse";
import { formatXml } from "./core/format";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

type Req =
  | { id: number; op: "analyse"; xml: string; name: string }
  | { id: number; op: "format"; xml: string };

ctx.onmessage = (e: MessageEvent<Req>) => {
  const msg = e.data;
  try {
    if (msg.op === "format") {
      ctx.postMessage({ id: msg.id, text: formatXml(msg.xml) });
    } else {
      // AnalysisResult holds Maps/Sets — structured clone carries those across fine.
      ctx.postMessage({ id: msg.id, result: analyse(msg.xml, msg.name) });
    }
  } catch (err) {
    const pe = err instanceof XmlParseError ? err : null;
    ctx.postMessage({ id: msg.id, error: { message: (err as Error).message, line: pe?.line, column: pe?.column } });
  }
};
