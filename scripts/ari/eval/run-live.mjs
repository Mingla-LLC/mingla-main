#!/usr/bin/env node
/**
 * #3355 Wave F (F1) — Ari's live eval, against the LOCAL stack only.
 *
 *   node scripts/ari/eval/run-live.mjs \
 *     --env-file=<local stack env: ARI_EVAL_URL, ANON_KEY, SERVICE_ROLE_KEY> \
 *     --functions-env=<local functions env with GEMINI_API_KEY_ARI> \
 *     [--out=<dir>] [--only=replay,flows,route_table] [--write-baseline]
 *
 * Three suites, one score each (out of 100), and their mean:
 *   - replay: the scripted host threads in replay/fixtures.mjs, sent through
 *     the real turn pipeline (agent-chat; proposal cards are cancelled, never
 *     confirmed) and graded turn by turn (replay/grade.mjs);
 *   - flows: the flow evals in flows/ (S3–S6 and the guided setups), which
 *     drive agent-chat and agent-confirm-action like the Host does;
 *   - route_table: the 51-row Wave E route table, read by the real model
 *     (replay/route_table_live.ts, Deno);
 *   - answers (#3355 rework 3): answer quality for read, how-to, remember and
 *     support turns, graded on the words the host reads (answers/);
 *   - claim_check (#3355 rework 3): the reply claim check on the real model,
 *     the tester's must-catch list and the must-keep answers
 *     (replay/claim_check_live.ts), with the check's own latency.
 * "overall" is the mean of replay, flows and route_table (the baseline the
 * gate has always compared); answers and claim_check have their own scores.
 * Latency: p50 / p95 per turn for setup starts, typed turns and card answers.
 *
 * Writes <out>/<run id>.json and .md (default ~/.mingla-private/3355/evals).
 * --write-baseline also writes docs/contracts/ari-live-eval-baseline.json,
 * which the release gate (scripts/ari/eval/gate.mjs) compares runs with.
 *
 * Refuses any non-loopback Supabase URL (lib.mjs localConfig). The model key
 * is read from the local functions env file and never printed.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AriSession,
  artefactOf,
  localConfig,
  option,
  serviceRest,
  signIn,
} from "./flows/lib.mjs";
import {
  FLOW_ACCOUNTS,
  FLOW_EVAL_PASSWORD,
  resetTurnWindow,
  seedFlowBrands,
} from "./seed-flow-brands.mjs";
import { runFlowEvals } from "./flows/run.mjs";
import { ANSWER_EVALS } from "./answers/index.mjs";
import { LIVE_FLOW_EVAL_IDS, REPLAY_FIXTURES } from "./replay/fixtures.mjs";
import {
  baselineFromRun,
  gradeThread,
  percentiles,
  round,
  scoreRun,
} from "./replay/grade.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const BASELINE_PATH = "docs/contracts/ari-live-eval-baseline.json";

function readEnvFile(path) {
  const out = {};
  if (!path) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * #3355 rework 5 (R5-19): the model a run really used. The functions run on
 * the local Ollama model when ARI_LOCAL_MODEL_ENABLED is true (agentGemini
 * localModelConfig), whatever key the env carries; the run says so.
 */
export function evalModel(env = process.env, functionsEnv = {}) {
  const pick = (name) => functionsEnv[name] ?? env[name];
  if (pick("ARI_LOCAL_MODEL_ENABLED") === "true") {
    const id = String(pick("ARI_LOCAL_MODEL_ID") ?? "qwen3:4b-instruct").trim();
    return { local: true, id, label: `local (${id}, Ollama)` };
  }
  return {
    local: false,
    id: pick("GEMINI_MODEL_ID") ?? null,
    label: "gemini (GEMINI_MODEL_ID, Flash)",
  };
}

/**
 * R5-19: the Gemini baseline is never written from a local-model run (local
 * scores are for finding defects, not a pass mark).
 */
export function assertBaselineWritable(model) {
  if (model.local) {
    throw new Error(
      `--write-baseline refused: this run uses the local model ${model.id} (ARI_LOCAL_MODEL_ENABLED=true). The baseline is Gemini-only.`,
    );
  }
}

function revision() {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    const dirty = execFileSync(
      "git",
      ["status", "--porcelain", "--", "supabase/functions"],
      { cwd: ROOT, encoding: "utf8" },
    ).trim().length > 0;
    return { sha, functions_dirty: dirty };
  } catch {
    return { sha: null, functions_dirty: null };
  }
}

async function chatRuns(rest, conversationId) {
  if (!conversationId) return [];
  return await rest.select(
    "ari_flow_runs",
    `select=id,flow_key,status&conversation_id=eq.${conversationId}`,
  );
}

async function cancelPending(rest, conversationId) {
  if (!conversationId) return [];
  const pending = await rest.select(
    "agent_pending_actions",
    `select=id,tool_name,tool_args&conversation_id=eq.${conversationId}&status=eq.pending`,
  );
  for (const row of pending) {
    await rest.update("agent_pending_actions", `id=eq.${row.id}`, {
      status: "cancelled",
      failure_reason: "EVAL_CLEANUP",
    });
  }
  return pending;
}

/** What one live turn became, in the grader's terms. */
function observe(data, runsBefore, runsAfter, ms) {
  const artefact = artefactOf(data);
  const before = new Set(runsBefore.map((run) => run.id));
  const newRuns = runsAfter.filter((run) => !before.has(run.id));
  const cardRun = artefact
    ? runsAfter.find((run) => run.id === artefact.run_id)
    : null;
  const route = data.kind === "pending_action"
    ? `proposal:${data.tool_name}`
    : data.kind === "error"
    ? "error"
    : artefact?.reuse_key === "parked"
    ? "parked"
    : artefact
    ? `flow_card:${cardRun?.flow_key ?? "unknown"}`
    : "text";
  const text = [
    data.text ?? data.message ?? "",
    artefact?.text && !String(data.text ?? "").includes(artefact.text)
      ? artefact.text
      : "",
  ].filter(Boolean).join("\n\n");
  return {
    route,
    tool: data.tool_name ?? null,
    args: data.tool_args ?? null,
    text,
    card_id: artefact?.artefact_id ?? null,
    new_flow_runs: newRuns.map((run) => run.flow_key),
    runs: runsAfter.map((run) => ({
      flow_key: run.flow_key,
      status: run.status,
    })),
    handoffs: artefact?.handoff?.item_key ? [artefact.handoff.item_key] : [],
    ms,
    setup_start: newRuns.length > 0 && Boolean(artefact),
    ...(data.kind === "error"
      ? { error: `${data.code}: ${data.message}` }
      : {}),
  };
}

export async function runReplay(config, rest, brands) {
  const tokens = new Map();
  const auth = async (account) => {
    if (!tokens.has(account)) {
      tokens.set(
        account,
        await signIn(config, FLOW_ACCOUNTS[account], FLOW_EVAL_PASSWORD),
      );
    }
    return tokens.get(account);
  };
  const graded = [];
  for (const fixture of REPLAY_FIXTURES) {
    const session = new AriSession(
      config,
      await auth(fixture.account),
      brands[fixture.brand],
      { timezone: fixture.timezone },
    );
    const observed = [];
    for (const turn of fixture.turns) {
      const runsBefore = await chatRuns(rest, session.conversationId);
      const started = Date.now();
      let data;
      try {
        data = await session.say(turn.say);
      } catch (error) {
        data = {
          kind: "error",
          code: "EVAL",
          message: String(error?.message ?? error),
        };
      }
      const ms = Date.now() - started;
      const runsAfter = await chatRuns(rest, session.conversationId);
      observed.push(observe(data, runsBefore, runsAfter, ms));
      // Nothing is ever written: each proposal card is cancelled.
      await cancelPending(rest, session.conversationId);
    }
    graded.push(gradeThread(fixture, observed));
  }
  return graded;
}

function runRouteTable(functionsEnv) {
  return runDenoSuite(
    functionsEnv,
    "scripts/ari/eval/replay/route_table_live.ts",
    "route_table_live",
  );
}

function runClaimCheck(functionsEnv) {
  return runDenoSuite(
    functionsEnv,
    "scripts/ari/eval/replay/claim_check_live.ts",
    "claim_check_live",
  );
}

function runDenoSuite(functionsEnv, script, suiteName) {
  const result = spawnSync(
    "deno",
    [
      "run",
      // #3355 rework 1 (tester P3-17): never leave a stray scripts/deno.lock.
      "--no-lock",
      "--allow-read",
      "--allow-env",
      "--allow-net",
      script,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        GEMINI_API_KEY_ARI: functionsEnv.GEMINI_API_KEY_ARI ?? "",
        SUPABASE_URL: functionsEnv.SUPABASE_URL ?? "",
        // R5-19: the suites use the same model lane as the functions.
        ...Object.fromEntries(
          [
            "ARI_LOCAL_MODEL_ENABLED",
            "ARI_LOCAL_MODEL_BASE_URL",
            "ARI_LOCAL_MODEL_ID",
          ].flatMap((name) =>
            functionsEnv[name] !== undefined ? [[name, functionsEnv[name]]] : []
          ),
        ),
      },
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  const line = String(result.stdout ?? "").split("\n").find((item) =>
    item.startsWith(`{"suite":"${suiteName}"`)
  );
  if (!line) {
    throw new Error(
      `${suiteName} run failed: ${String(result.stderr ?? "").slice(-400)}`,
    );
  }
  return JSON.parse(line);
}

function latencyBuckets(replay, flows) {
  const setup = [];
  const typed = [];
  const answers = [];
  for (const thread of replay) {
    for (const turn of thread.turns) {
      (turn.observed.setup_start ? setup : typed).push(turn.observed.ms);
    }
  }
  for (const result of flows) {
    let firstCard = true;
    for (const line of result.transcript ?? []) {
      if (typeof line.ms !== "number") continue;
      if (line.typed && line.got?.step && firstCard) {
        setup.push(line.ms);
        firstCard = false;
      } else if (line.typed) typed.push(line.ms);
      else answers.push(line.ms);
    }
  }
  return {
    setup_start: percentiles(setup),
    typed_turn: percentiles(typed),
    card_answer_or_confirm: percentiles(answers),
  };
}

function markdown(run) {
  const lines = [
    `# Ari live eval ${run.run_id}`,
    "",
    `Revision ${run.revision.sha ?? "?"}${
      run.revision.functions_dirty ? " (functions dirty)" : ""
    }, ${run.ran_at}, model ${run.model}, target local.`,
    "",
    "| Suite | Score |",
    "|---|---|",
    ...Object.entries(run.scores).map(([suite, score]) =>
      `| ${suite} | ${score} |`
    ),
    "",
    "## Replay",
    "",
    "| Scenario | Score | Facts | Pass |",
    "|---|---|---|---|",
    ...run.suites.replay.map((item) =>
      `| ${item.id} | ${item.score} | ${item.facts_passed}/${item.facts_total} | ${
        item.passed ? "yes" : "no"
      } |`
    ),
    "",
  ];
  for (const item of run.suites.replay.filter((entry) => !entry.passed)) {
    lines.push(`### ${item.id}: failing facts`, "");
    for (const turn of item.turns) {
      for (const failed of turn.facts.filter((entry) => !entry.passed)) {
        lines.push(
          `- "${turn.say.slice(0, 70)}" → ${failed.fact}: expected ${
            JSON.stringify(failed.expected)
          }, got ${JSON.stringify(failed.actual)}`,
        );
      }
    }
    lines.push("");
  }
  lines.push(
    "## Flow evals",
    "",
    "| Eval | Result |",
    "|---|---|",
    ...run.suites.flows.map((item) =>
      `| ${item.id} | ${
        item.skipped ? "skipped" : item.passed ? "pass" : "FAIL"
      } |`
    ),
    "",
  );
  for (const item of run.suites.flows.filter((e) => !e.skipped && !e.passed)) {
    const diffs = (item.facts ?? []).filter((f) => !f.passed).map((f) =>
      `${f.fact}: expected ${JSON.stringify(f.expected)}, saved ${
        JSON.stringify(f.actual)
      }`
    );
    lines.push(
      `- ${item.id}: ${item.error ?? diffs.join("; ")}`.slice(0, 600),
    );
  }
  const table = run.suites.route_table;
  lines.push(
    "",
    "## Route table (live model)",
    "",
    `${table.misroutes}/${table.total} misroutes (${
      round(table.misroute_rate * 100)
    }%), ${table.model_reads} model reads; read latency p50 ${table.latency_ms.p50} ms, p95 ${table.latency_ms.p95} ms.`,
    "",
    ...table.rows.filter((row) => !row.passed).map((row) =>
      `- ${row.open} | ${
        row.text.slice(0, 80)
      } → ${row.got} (want ${row.expect}; ${row.source}${
        row.reason ? `/${row.reason}` : ""
      })`
    ),
    "",
    "## Answer quality (#3355 rework 3)",
    "",
    "| Eval | Facts | Pass |",
    "|---|---|---|",
    ...(run.suites.answers ?? []).map((item) =>
      `| ${item.id} | ${(item.facts ?? []).filter((f) => f.passed).length}/${
        (item.facts ?? []).length
      } | ${item.passed ? "yes" : "no"} |`
    ),
    "",
    ...(run.suites.answers ?? []).flatMap((item) =>
      (item.facts ?? []).filter((f) => !f.passed).map((f) =>
        `- ${item.id}: ${f.fact}: expected ${JSON.stringify(f.expected)}, got ${
          JSON.stringify(f.actual).slice(0, 300)
        }`
      ).concat(item.error ? [`- ${item.id}: error ${item.error}`] : [])
    ),
    "",
    "## Claim check on the live model (#3355 rework 3)",
    "",
    run.suites.claim_check
      ? `${run.suites.claim_check.passed}/${run.suites.claim_check.total} (must catch ${run.suites.claim_check.must_catch.passed}/${run.suites.claim_check.must_catch.total}, must keep ${run.suites.claim_check.must_keep.passed}/${run.suites.claim_check.must_keep.total}, ${run.suites.claim_check.fallbacks} fallbacks); check latency p50 ${run.suites.claim_check.latency_ms.p50} ms, p95 ${run.suites.claim_check.latency_ms.p95} ms.`
      : "not run",
    "",
    ...((run.suites.claim_check?.rows ?? []).filter((row) => !row.passed).map((
      row,
    ) =>
      `- ${row.group}: ${JSON.stringify(row.reply)} → ${
        JSON.stringify(row.text)
      }`
    )),
    "",
    "## Latency (per turn, ms)",
    "",
    "| Bucket | n | p50 | p95 |",
    "|---|---|---|---|",
    ...Object.entries(run.latency).map(([bucket, value]) =>
      `| ${bucket} | ${value.n} | ${value.p50} | ${value.p95} |`
    ),
    "",
  );
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const functionsEnv = readEnvFile(option("functions-env"));
  const model = evalModel(process.env, functionsEnv);
  if (process.argv.includes("--write-baseline")) assertBaselineWritable(model);
  const only = option("only")?.split(",").filter(Boolean) ??
    ["replay", "flows", "route_table", "answers", "claim_check"];
  const config = localConfig();
  const rest = serviceRest(config);
  const { brands, users } = await seedFlowBrands(config);
  await resetTurnWindow(rest, Object.values(users));
  const runId = `live-${
    new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)
  }Z-${randomUUID().slice(0, 8)}`;
  const suites = {
    replay: [],
    flows: [],
    route_table: null,
    answers: [],
    claim_check: null,
  };
  if (only.includes("replay")) {
    suites.replay = await runReplay(config, rest, brands);
  }
  if (only.includes("flows")) {
    await resetTurnWindow(rest, Object.values(users));
    suites.flows = (await runFlowEvals({ ids: LIVE_FLOW_EVAL_IDS })).map((
      item,
    ) => ({
      id: item.id,
      passed: item.passed ?? false,
      skipped: item.skipped ?? null,
      facts: item.facts,
      error: item.error ?? null,
      transcript: item.transcript,
    }));
  }
  if (only.includes("answers")) {
    await resetTurnWindow(rest, Object.values(users));
    suites.answers = (await runFlowEvals({ evals: ANSWER_EVALS })).map((
      item,
    ) => ({
      id: item.id,
      passed: item.passed ?? false,
      facts: item.facts,
      error: item.error ?? null,
      transcript: item.transcript,
    }));
  }
  if (only.includes("claim_check")) {
    if (!functionsEnv.GEMINI_API_KEY_ARI) {
      throw new Error(
        "--functions-env must name a local env with GEMINI_API_KEY_ARI",
      );
    }
    suites.claim_check = runClaimCheck(functionsEnv);
  }
  if (only.includes("route_table")) {
    if (!functionsEnv.GEMINI_API_KEY_ARI) {
      throw new Error(
        "--functions-env must name a local env with GEMINI_API_KEY_ARI",
      );
    }
    suites.route_table = runRouteTable(functionsEnv);
  }
  const run = {
    run_id: runId,
    ran_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    revision: revision(),
    target: "local",
    model: model.label,
    model_local: model.local,
    model_id: model.id,
    scores: scoreRun(suites),
    latency: latencyBuckets(suites.replay, suites.flows),
    suites: {
      ...suites,
      route_table: suites.route_table ??
        {
          total: 0,
          misroutes: 0,
          misroute_rate: 0,
          model_reads: 0,
          rows: [],
          latency_ms: {},
        },
    },
  };
  const out = option("out") ?? join(homedir(), ".mingla-private/3355/evals");
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, `${runId}.json`),
    `${JSON.stringify(run, null, 2)}\n`,
  );
  writeFileSync(join(out, `${runId}.md`), markdown(run));
  if (process.argv.includes("--write-baseline")) {
    assertBaselineWritable(model);
    const baseline = baselineFromRun(run);
    writeFileSync(
      join(ROOT, BASELINE_PATH),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    console.log(`baseline written to ${BASELINE_PATH}`);
  }
  console.log(markdown(run));
  console.log(`\nwrote ${join(out, `${runId}.json`)} and .md`);
}
