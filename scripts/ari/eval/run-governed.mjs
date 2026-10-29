#!/usr/bin/env node
/**
 * Issue #3355 — execute an observed Ari evaluation and persist its complete
 * result set through the audited Improvement Lab RPCs.
 *
 * Contract-only checks deliberately cannot be persisted as behavioral runs.
 */

import { readFile } from "node:fs/promises";
import { runScenarios } from "./run-scenarios.mjs";

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const supabaseUrl = process.env.ARI_EVAL_SUPABASE_URL;
const anonKey = process.env.ARI_EVAL_ANON_KEY;
const adminToken = process.env.ARI_EVAL_ADMIN_TOKEN;
const mode = option("mode", "local_live");
const proposalId = option("proposal-id");
const candidateVersionId = option("candidate-version-id");
const ids = option("ids")?.split(",").filter(Boolean) ?? null;
const maxCalls = Number(option("max-calls", "70"));
const traceFile = option("trace-file");

if (!supabaseUrl || !anonKey || !adminToken) {
  throw new Error("ARI_EVAL_SUPABASE_URL, ARI_EVAL_ANON_KEY and ARI_EVAL_ADMIN_TOKEN are required");
}
if (!["deterministic", "model", "local_live", "pilot"].includes(mode)) {
  throw new Error("Governed behavioral mode must be deterministic, model, local_live or pilot");
}

async function rpc(name, args) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${name}: ${body?.message ?? body?.code ?? response.status}`);
  return body;
}

const run = await rpc("ari_admin_start_evaluation", {
  p_mode: mode,
  p_candidate_version_id: candidateVersionId,
  p_proposal_id: proposalId,
  p_reason: `Starting governed ${mode} evaluation from the local runner`,
});

try {
  const observedTraces = traceFile
    ? JSON.parse(await readFile(traceFile, "utf8"))
    : null;
  const output = await runScenarios({ mode, maxCalls, ids, observedTraces });
  const finished = await rpc("ari_admin_finish_evaluation", {
    p_run_id: run.id,
    p_results: output.results,
    p_reason: `Recording ${output.executed} measured ${mode} scenario results`,
  });
  console.log(JSON.stringify({ run: finished, evaluation: output }, null, 2));
  process.exitCode = output.failed > 0 ? 1 : 0;
} catch (error) {
  await rpc("ari_admin_cancel_evaluation", {
    p_run_id: run.id,
    p_reason: `Local runner stopped before completion: ${String(error?.message ?? error).slice(0, 300)}`,
  }).catch(() => undefined);
  throw error;
}
