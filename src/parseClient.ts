// Promise wrapper around the parse worker. One lazily-created, inlined worker
// (?worker&inline => Blob URL, the only form that runs under file://); requests
// are matched to replies by id.
import ParseWorker from "./parse.worker?worker&inline";
import type { AnalysisResult } from "./core/types";
import type { LineDiffResult } from "./core/diff";
import { XmlParseError } from "./core/analyse";

type Reply = {
  id: number;
  result?: AnalysisResult;
  text?: string;
  diff?: LineDiffResult;
  error?: { message: string; line?: number; column?: number };
};

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new ParseWorker();
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const { id, result, text, diff, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new XmlParseError(error.message, error.line, error.column));
    else p.resolve(result ?? text ?? diff);
  };
  worker.onerror = () => {
    // Worker crashed: fail everything in flight and rebuild on next call.
    for (const p of pending.values()) p.reject(new Error("Parse worker failed"));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function request<T>(msg: Record<string, unknown>): Promise<T> {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, ...msg });
  });
}

export function analyseInWorker(xml: string, name: string): Promise<AnalysisResult> {
  return request<AnalysisResult>({ op: "analyse", xml, name });
}

export function formatInWorker(xml: string): Promise<string> {
  return request<string>({ op: "format", xml });
}

export function lineDiffInWorker(a: string, b: string): Promise<LineDiffResult> {
  return request<LineDiffResult>({ op: "linediff", a, b });
}
