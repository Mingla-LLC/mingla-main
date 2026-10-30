#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ARI_EVAL_SCENARIOS } from "./scenarios.mjs";

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function loadRegistryNames() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const source = await readFile(
    join(root, "supabase/functions/_shared/agentToolAuthorization.ts"),
    "utf8",
  );
  return new Set(
    [...source.matchAll(/^\s{2}([a-z][a-z0-9_]+): role\(/gm)].map((match) => match[1]),
  );
}

async function traceForContract(scenario) {
  const registry = await loadRegistryNames();
  const required = scenario.expected.required_tools ?? [];
  const forbidden = scenario.expected.forbidden_tools ?? [];
  const failures = [
    ...required.filter((name) => !registry.has(name)).map((name) => `unregistered_required_tool:${name}`),
    ...forbidden.filter((name) => required.includes(name)).map((name) => `required_and_forbidden:${name}`),
  ];
  return {
    contract_only: true,
    contract_failures: failures,
    tool_calls: [],
    error_codes: [],
    reply: "",
    canonical_readback: false,
    latency_ms: 0,
    estimated_cost_micros: 0,
  };
}

export function evaluateScenario(scenario, trace) {
  if (trace.contract_only) {
    const failures = trace.contract_failures ?? [];
    return { passed: failures.length === 0, failures };
  }
  const tools = (trace.tool_calls ?? []).map((call) => call.name);
  const reply = String(trace.reply ?? "");
  const codes = trace.error_codes ?? [];
  const failures = [];
  for (const name of scenario.expected.required_tools ?? []) {
    if (!tools.includes(name)) failures.push(`missing_tool:${name}`);
  }
  for (const name of scenario.expected.forbidden_tools ?? []) {
    if (tools.includes(name)) failures.push(`forbidden_tool:${name}`);
  }
  for (const phrase of scenario.expected.forbidden_phrases ?? []) {
    if (reply.toLowerCase().includes(phrase.toLowerCase())) {
      failures.push(`forbidden_phrase:${phrase}`);
    }
  }
  for (const code of scenario.expected.expected_codes ?? []) {
    if (!codes.includes(code)) failures.push(`missing_code:${code}`);
  }
  if (scenario.expected.require_canonical_readback && trace.canonical_readback !== true) {
    failures.push("canonical_readback_missing");
  }
  return { passed: failures.length === 0, failures };
}

async function callLocalAri(scenario) {
  const endpoint = process.env.ARI_EVAL_ENDPOINT;
  const token = process.env.ARI_EVAL_TOKEN;
  if (!endpoint || !token) {
    throw new Error("ARI_EVAL_ENDPOINT and ARI_EVAL_TOKEN are required for model/staging mode");
  }
  const startedAt = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: scenario.input.message,
      client_turn_id: crypto.randomUUID(),
      client_timezone: process.env.ARI_EVAL_TIMEZONE ?? "America/New_York",
      locale: process.env.ARI_EVAL_LOCALE ?? "en-US",
      brand_id: process.env.ARI_EVAL_BRAND_ID ?? undefined,
      eval_scenario_id: scenario.id,
    }),
  });
  const body = await response.json();
  const payload = body?.kind === "success" ? body.data : body;
  if (!response.ok || body?.kind === "error" || payload?.kind === "error") {
    throw new Error(`${scenario.id}: ${body?.code ?? payload?.code ?? response.status}`);
  }
  const canonical = await readCanonicalTrace(payload?.message_id, token);
  const observations = Array.isArray(
      canonical?.content?.structured?.agent_run?.observations,
    )
    ? canonical.content.structured.agent_run.observations
    : [];
  const observedTools = observations.flatMap((item) =>
    typeof item?.tool === "string" ? [{ name: item.tool }] : []
  );
  const proposalTool = typeof canonical?.tool_calls?.tool_name === "string"
    ? [{ name: canonical.tool_calls.tool_name }]
    : typeof payload?.tool_name === "string"
    ? [{ name: payload.tool_name }]
    : [];
  const toolCalls = [...observedTools, ...proposalTool].filter(
    (item, index, all) =>
      all.findIndex((candidate) => candidate.name === item.name) === index,
  );
  const reply = typeof canonical?.content?.text === "string"
    ? canonical.content.text
    : payload?.text ?? payload?.followup_text ?? "";
  return {
    tool_calls: toolCalls,
    error_codes: observations.flatMap((item) =>
      typeof item?.error_code === "string" ? [item.error_code] : []
    ),
    reply,
    canonical_readback: payload?.kind === "text" &&
      /verified|read back|confirmed|receipt/i.test(reply),
    response_kind: payload?.kind ?? "unknown",
    conversation_id: payload?.conversation_id ?? null,
    message_id: payload?.message_id ?? null,
    canonical_trace_loaded: canonical !== null,
    latency_ms: Math.round(performance.now() - startedAt),
    estimated_cost_micros: 0,
  };
}

async function readCanonicalTrace(messageId, token) {
  if (typeof messageId !== "string" || !messageId) return null;
  const configuredBase = process.env.ARI_EVAL_SUPABASE_URL;
  const endpoint = process.env.ARI_EVAL_ENDPOINT;
  const anonKey = process.env.ARI_EVAL_ANON_KEY;
  const base = configuredBase || endpoint?.split("/functions/v1/")[0];
  if (!base || !anonKey) return null;
  const query = new URL(`${base.replace(/\/$/, "")}/rest/v1/agent_messages`);
  query.searchParams.set("id", `eq.${messageId}`);
  query.searchParams.set("select", "content,tool_calls,tool_results");
  const response = await fetch(query, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows[0] && typeof rows[0] === "object"
    ? rows[0]
    : null;
}

async function cachedModelTrace(scenario, mode) {
  const version = process.env.ARI_EVAL_RUNTIME_VERSION ?? "local";
  const digest = createHash("sha256").update(JSON.stringify({ scenario, mode, version })).digest("hex");
  const cacheDir = join(tmpdir(), "mingla-ari-eval-cache");
  const path = join(cacheDir, `${digest}.json`);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    const trace = await callLocalAri(scenario);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path, JSON.stringify(trace), "utf8");
    return trace;
  }
}

export async function runScenarios({
  mode = "contract",
  maxCalls = 70,
  ids = null,
  observedTraces = null,
} = {}) {
  const selected = ARI_EVAL_SCENARIOS.filter((scenario) =>
    scenario.status === "active" && (!ids || ids.includes(scenario.id))
  );
  const results = [];
  let calls = 0;
  for (const scenario of selected) {
    if (["local_live", "model", "pilot"].includes(mode) && calls >= maxCalls) break;
    let trace;
    if (mode === "contract") {
      trace = await traceForContract(scenario);
    } else if (mode === "deterministic") {
      trace = observedTraces?.[scenario.id] ?? null;
      if (!trace) throw new Error(`Observed deterministic trace required for ${scenario.id}`);
    } else {
      trace = await cachedModelTrace(scenario, mode);
      calls += 1;
    }
    const verdict = evaluateScenario(scenario, trace);
    results.push({
      scenario_key: scenario.id,
      passed: verdict.passed,
      score: verdict.passed ? 1 : 0,
      failure_codes: verdict.failures,
      trace: [trace],
      metrics: {
        latency_ms: Number(trace.latency_ms ?? 0),
        estimated_cost_micros: Number(trace.estimated_cost_micros ?? 0),
      },
    });
  }
  return {
    mode,
    selected: selected.length,
    executed: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    calls,
    results,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = option("mode", "contract");
  const maxCalls = Number(option("max-calls", "70"));
  const ids = option("ids")?.split(",").filter(Boolean) ?? null;
  const traceFile = option("trace-file");
  const observedTraces = traceFile ? JSON.parse(await readFile(traceFile, "utf8")) : null;
  const output = await runScenarios({ mode, maxCalls, ids, observedTraces });
  const serialized = JSON.stringify(output, null, 2);
  const outputPath = option("output");
  if (outputPath) await writeFile(outputPath, serialized, "utf8");
  console.log(serialized);
  process.exitCode = output.failed > 0 ? 1 : 0;
}
