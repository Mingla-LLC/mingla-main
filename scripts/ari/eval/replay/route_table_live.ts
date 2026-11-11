// Issue #3355 Wave F (F1) — the Wave E route table, read by the REAL model.
//
// Each of the 51 rows goes through the shipped intent read (Gemini Flash,
// the same callGeminiStructured agent-chat uses) and the shipped route code
// (routeAriTurn, and the real flow runner for rows inside an open setup).
// No database: the open setup is the in-memory store the deterministic
// harness uses. Prints one JSON object (rows + misroute rate + latency) for
// scripts/ari/eval/run-live.mjs to score.
//
//   GEMINI_API_KEY_ARI=... deno run --allow-read --allow-env --allow-net \
//     scripts/ari/eval/replay/route_table_live.ts
//
// LOCAL ONLY: it reads the key from the local environment and calls the
// model provider directly; it never talks to a Supabase project.

import {
  lastIntentResult,
  ROUTE_TABLE,
  routeClass,
} from "../../../../supabase/functions/_shared/__tests__/_issue3355RouteTable.ts";
import { callGeminiStructured } from "../../../../supabase/functions/_shared/agentGemini.ts";

if (Deno.env.get("SUPABASE_URL")) {
  const host = new URL(Deno.env.get("SUPABASE_URL")!).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(`SUPABASE_URL host "${host}" is not local; refusing to run`);
  }
}
if (!Deno.env.get("GEMINI_API_KEY_ARI")) {
  throw new Error("GEMINI_API_KEY_ARI is required (local env only)");
}

const SNAPSHOT = [
  "Brand: Harmattan Kitchen (NG, currency NGN, time zone Africa/Lagos).",
  "Upcoming or draft offerings: none.",
  "Live discount codes: none.",
  "Selling: free events ready; paid tickets need payout setup.",
].join("\n");

const only = Deno.args.find((arg) => arg.startsWith("--limit="));
const limit = only ? Number(only.slice("--limit=".length)) : ROUTE_TABLE.length;

const rows = [];
for (const row of ROUTE_TABLE.slice(0, limit)) {
  const started = performance.now();
  let got: string;
  let failure: string | null = null;
  try {
    got = await routeClass(
      row,
      async (request) =>
        (await callGeminiStructured({
          systemPrompt: request.systemPrompt,
          contents: request.contents,
          responseSchema: request.schema,
          signal: request.signal,
        })).value,
      SNAPSHOT,
    );
  } catch (error) {
    got = "error";
    failure = String((error as Error)?.message ?? error).slice(0, 200);
  }
  const result = lastIntentResult;
  rows.push({
    text: row.text,
    open: row.open ?? "none",
    expect: row.expect,
    got,
    passed: got === row.expect,
    source: result?.source ?? null,
    reason: result && result.source === "hints" ? result.reason : null,
    intent: result?.read.intent ?? null,
    target: result?.read.target ?? null,
    flow_action: result?.read.flow_action ?? null,
    confidence: result?.read.confidence ?? null,
    read_ms: result?.elapsedMs ?? null,
    elapsed_ms: Math.round(performance.now() - started),
    ...(failure ? { error: failure } : {}),
  });
}
const misses = rows.filter((row) => !row.passed);
const sorted = rows.map((row) => row.read_ms ?? row.elapsed_ms).sort((a, b) =>
  a - b
);
const pct = (p: number) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]
    : null;
console.log(JSON.stringify({
  suite: "route_table_live",
  rows,
  total: rows.length,
  misroutes: misses.length,
  misroute_rate: rows.length ? misses.length / rows.length : 0,
  model_reads: rows.filter((row) => row.source === "model").length,
  latency_ms: { p50: pct(0.5), p95: pct(0.95) },
}));
