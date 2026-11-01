#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ARI_EVAL_SCENARIOS } from "./scenarios.mjs";

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(
    prefix.length,
  ) ?? fallback;
}

function evaluatorErrorDetails(error) {
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/:\s*([A-Z][A-Z0-9_]{2,80})$/);
  const record = error && typeof error === "object"
    ? error
    : {};
  const cause = record.cause && typeof record.cause === "object"
    ? record.cause
    : {};
  const code = typeof cause.code === "string" &&
      /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.code)
    ? cause.code
    : typeof record.code === "string" &&
        /^[A-Z][A-Z0-9_]{2,80}$/.test(record.code)
    ? record.code
    : match?.[1] ?? "LOCAL_EVAL_STEP_FAILED";
  const retrySeconds = cause.retry_after_seconds ??
    record.retry_after_seconds;
  const retryAfter = typeof retrySeconds === "number" &&
      Number.isFinite(retrySeconds) && retrySeconds >= 0
    ? Math.min(86_400, Math.ceil(retrySeconds))
    : null;
  return { code, retry_after_seconds: retryAfter };
}

async function loadRegistryNames() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const source = await readFile(
    join(root, "supabase/functions/_shared/agentToolAuthorization.ts"),
    "utf8",
  );
  return new Set(
    [...source.matchAll(/^\s{2}([a-z][a-z0-9_]+): role\(/gm)].map((match) =>
      match[1]
    ),
  );
}

async function traceForContract(scenario) {
  const registry = await loadRegistryNames();
  const required = scenario.expected.required_tools ?? [];
  const forbidden = scenario.expected.forbidden_tools ?? [];
  const chains = scenario.expected.required_tool_chains ?? [];
  const failures = [
    ...required.filter((name) => !registry.has(name)).map((name) =>
      `unregistered_required_tool:${name}`
    ),
    ...forbidden.filter((name) => required.includes(name)).map((name) =>
      `required_and_forbidden:${name}`
    ),
    ...chains.flatMap((chain, index) =>
      chain.filter((name) => !registry.has(name)).map((name) =>
        `unregistered_chain_tool:${index}:${name}`
      )
    ),
    ...(scenario.expected.turn_expectations ?? []).flatMap((turn, index) => [
      ...(turn.required_tools ?? []).filter((name) => !registry.has(name)).map((
        name,
      ) => `unregistered_turn_tool:${index}:${name}`),
      ...(turn.forbidden_tools ?? []).filter((name) => !registry.has(name)).map(
        (name) => `unregistered_turn_forbidden_tool:${index}:${name}`,
      ),
    ]),
    ...(scenario.input?.steps ?? []).flatMap((step, index) =>
      step?.action === "confirm_pending_action"
        ? [
          ...(typeof step.expected_pending_tool !== "string"
            ? [`confirmation_tool_missing:${index + 1}`]
            : []),
          ...(typeof step.expected_pending_tool === "string" &&
              !registry.has(step.expected_pending_tool)
            ? [`confirmation_tool_unregistered:${index + 1}`]
            : []),
        ]
        : []
    ),
    ...(scenario.expected.require_approval_before_write &&
        !scenario.input?.steps?.some((step) =>
          /approve|approval|confirm|confirmation|don't|do not|wait for|ask me before/i
            .test(
              step.message,
            )
        )
      ? ["approval_gate_not_defined_in_conversation"]
      : []),
    ...(scenario.tags?.includes("chain") &&
        (scenario.input?.steps?.length ?? 0) < 2
      ? ["chain_requires_multiple_turns"]
      : []),
    ...(scenario.tags?.includes("chain") &&
        scenario.expected.require_same_conversation !== true
      ? ["chain_conversation_scope_missing"]
      : []),
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

export function resolveScenarioBrandId(scenario) {
  const brandName = scenario.input?.brand_name;
  if (!brandName) return process.env.ARI_EVAL_BRAND_ID ?? undefined;
  const rawMap = process.env.ARI_EVAL_BRAND_IDS;
  if (rawMap) {
    let mapping;
    try {
      mapping = JSON.parse(rawMap);
    } catch {
      throw new Error(
        "ARI_EVAL_BRAND_IDS must be a JSON object keyed by brand name",
      );
    }
    const id = mapping && typeof mapping === "object" && !Array.isArray(mapping)
      ? mapping[brandName]
      : null;
    if (typeof id === "string" && id) return id;
  }
  if (
    process.env.ARI_EVAL_BRAND_NAME === brandName &&
    process.env.ARI_EVAL_BRAND_ID
  ) {
    return process.env.ARI_EVAL_BRAND_ID;
  }
  throw new Error(
    `No local evaluation brand ID is configured for ${brandName}; set ARI_EVAL_BRAND_IDS`,
  );
}

export function assertExpectedPendingAction(step, pendingActionId, toolName) {
  if (!pendingActionId) {
    throw new Error("Cannot confirm an action without Ari's pending action ID");
  }
  if (
    typeof step.expected_pending_tool !== "string" ||
    !step.expected_pending_tool
  ) {
    throw new Error(
      "Refusing confirmation without an expected pending tool in the scenario",
    );
  }
  if (toolName !== step.expected_pending_tool) {
    throw new Error(
      `Refusing to confirm unexpected Ari proposal: expected ${step.expected_pending_tool}, received ${
        toolName ?? "none"
      }`,
    );
  }
}

function verifiedTripGraphSummary(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const graph = result.graph && typeof result.graph === "object"
    ? result.graph
    : result;
  const event = graph.event;
  if (
    !event || typeof event !== "object" || !Array.isArray(graph.days) ||
    !Array.isArray(graph.tiers)
  ) return null;
  return {
    status: typeof event.status === "string" ? event.status : null,
    day_count: graph.days.length,
    tier_count: graph.tiers.length,
    day_dates: graph.days.map((day) => day.date ?? null),
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
  if (
    scenario.tags?.includes("chain") && trace.turns &&
    trace.turns.length < (scenario.input?.steps?.length ?? 0)
  ) {
    failures.push("chain_incomplete_turns");
  }
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
  if (scenario.expected.approval_reply_pattern && trace.turns?.length) {
    const finalReply = String(trace.turns.at(-1)?.reply ?? "");
    if (
      !new RegExp(scenario.expected.approval_reply_pattern, "i").test(
        finalReply,
      )
    ) {
      failures.push("final_approval_checkpoint_missing");
    }
  }
  for (const code of scenario.expected.expected_codes ?? []) {
    if (!codes.includes(code)) failures.push(`missing_code:${code}`);
  }
  for (const chain of scenario.expected.required_tool_chains ?? []) {
    let cursor = 0;
    for (const tool of tools) {
      if (tool === chain[cursor]) cursor += 1;
      if (cursor === chain.length) break;
    }
    if (cursor < chain.length) {
      failures.push(`tool_chain_incomplete:${chain.slice(cursor).join("->")}`);
    }
  }
  if (scenario.expected.require_approval_before_write && trace.turns?.length) {
    let pendingApprovals = 0;
    for (const turn of trace.turns) {
      if (turn.response_kind === "pending_action" && turn.proposal?.tool_name) {
        pendingApprovals += 1;
      } else if (turn.response_kind === "executed") {
        if (pendingApprovals === 0) {
          failures.push("write_without_prior_pending_approval");
          break;
        }
        pendingApprovals -= 1;
      }
    }
  }
  if (scenario.expected.require_same_conversation && trace.conversation_ids) {
    const ids = trace.conversation_ids.filter(Boolean);
    if (ids.length !== trace.turns?.length || new Set(ids).size !== 1) {
      failures.push("conversation_not_continuous");
    }
  }
  for (
    const [turnIndex, expectation]
      of (scenario.expected.turn_expectations ?? []).entries()
  ) {
    const turn = trace.turns?.[turnIndex];
    if (!turn) {
      failures.push(`missing_turn:${turnIndex + 1}`);
      continue;
    }
    const turnTools = (turn.tool_calls ?? []).map((call) => call.name);
    const turnReply = String(turn.reply ?? "");
    if (
      expectation.response_kind &&
      turn.response_kind !== expectation.response_kind
    ) {
      failures.push(
        `turn_${turnIndex + 1}_unexpected_response_kind:${turn.response_kind}`,
      );
    }
    if (
      expectation.expected_error_code &&
      !turn.error_codes?.includes(expectation.expected_error_code)
    ) {
      failures.push(
        `turn_${turnIndex + 1}_missing_error:${expectation.expected_error_code}`,
      );
    }
    if (
      expectation.required_proposal_tool &&
      turn.proposal?.tool_name !== expectation.required_proposal_tool
    ) {
      failures.push(
        `turn_${
          turnIndex + 1
        }_missing_proposal:${expectation.required_proposal_tool}`,
      );
    }
    for (
      const [key, value] of Object.entries(
        expectation.required_proposal_args ?? {},
      )
    ) {
      if (turn.proposal?.tool_args?.[key] !== value) {
        failures.push(`turn_${turnIndex + 1}_proposal_arg_mismatch:${key}`);
      }
    }
    for (const name of expectation.required_tools ?? []) {
      if (!turnTools.includes(name)) {
        failures.push(`turn_${turnIndex + 1}_missing_tool:${name}`);
      }
    }
    for (const name of expectation.forbidden_tools ?? []) {
      if (turnTools.includes(name)) {
        failures.push(`turn_${turnIndex + 1}_forbidden_tool:${name}`);
      }
    }
    for (const pattern of expectation.required_reply_patterns ?? []) {
      if (!new RegExp(pattern, "i").test(turnReply)) {
        failures.push(`turn_${turnIndex + 1}_missing_reply_pattern:${pattern}`);
      }
    }
    for (
      const [key, value] of Object.entries(
        expectation.required_trip_graph ?? {},
      )
    ) {
      if (JSON.stringify(turn.trip_graph?.[key]) !== JSON.stringify(value)) {
        failures.push(`turn_${turnIndex + 1}_trip_graph_mismatch:${key}`);
      }
    }
  }
  if (scenario.expected.require_approval_before_write && trace.turns?.length) {
    const proposalIndex = trace.turns.findIndex((turn) =>
      turn.response_kind === "pending_action" && turn.proposal?.tool_name
    );
    const executionIndex = trace.turns.findIndex((turn) =>
      turn.response_kind === "executed"
    );
    if (
      executionIndex >= 0 &&
      (proposalIndex < 0 || proposalIndex >= executionIndex)
    ) {
      failures.push("write_without_prior_pending_approval");
    }
  }
  if (
    scenario.expected.require_canonical_readback && trace.turns?.length &&
    trace.turns.at(-1)?.canonical_readback !== true
  ) {
    failures.push("final_turn_canonical_readback_missing");
  }
  if (
    scenario.expected.require_canonical_readback &&
    trace.canonical_readback !== true
  ) {
    failures.push("canonical_readback_missing");
  }
  return { passed: failures.length === 0, failures };
}

async function callLocalAri(
  scenario,
  step,
  conversationId,
  turnIndex,
  pendingActionId,
  pendingActionTool,
) {
  const chatEndpoint = process.env.ARI_EVAL_ENDPOINT;
  const token = process.env.ARI_EVAL_TOKEN;
  if (!chatEndpoint || !token) {
    throw new Error(
      "ARI_EVAL_ENDPOINT and ARI_EVAL_TOKEN are required for model/staging mode",
    );
  }
  const confirmsAction = step.action === "confirm_pending_action";
  if (confirmsAction) {
    try {
      assertExpectedPendingAction(
        step,
        pendingActionId,
        pendingActionTool,
      );
    } catch (error) {
      throw new Error(`${scenario.id}: ${error.message}`);
    }
  }
  const endpoint = confirmsAction
    ? process.env.ARI_EVAL_CONFIRM_ENDPOINT ?? chatEndpoint.replace(
      /\/agent-chat\/?$/,
      "/agent-confirm-action",
    )
    : chatEndpoint;
  const startedAt = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(
      confirmsAction
        ? { action: "confirm", pending_action_id: pendingActionId }
        : {
          message: step.message,
          client_turn_id: crypto.randomUUID(),
          client_timezone: scenario.input.timezone ??
            process.env.ARI_EVAL_TIMEZONE ?? "America/New_York",
          locale: process.env.ARI_EVAL_LOCALE ?? "en-US",
          brand_id: resolveScenarioBrandId(scenario),
          eval_scenario_id: scenario.id,
          eval_turn_index: turnIndex,
          conversation_id: conversationId ?? undefined,
        },
    ),
  });
  const body = await response.json();
  const payload = body?.kind === "success" ? body.data : body;
  if (!response.ok || body?.kind === "error" || payload?.kind === "error") {
    const expectation = scenario.expected.turn_expectations?.[turnIndex];
    const errorCode = body?.code ?? payload?.code ?? response.status;
    if (
      expectation?.response_kind === "error" &&
      expectation.expected_error_code === errorCode
    ) {
      return {
        tool_calls: [],
        error_codes: [errorCode],
        reply: typeof body?.user_message === "string"
          ? body.user_message
          : typeof payload?.user_message === "string"
          ? payload.user_message
          : typeof body?.message === "string"
          ? body.message
          : "Ari could not complete that step.",
        canonical_readback: false,
        response_kind: "error",
        conversation_id: body?.conversation_id ?? payload?.conversation_id ??
          conversationId ?? null,
        message_id: body?.message_id ?? payload?.message_id ?? null,
        canonical_trace_loaded: false,
        latency_ms: Math.round(performance.now() - startedAt),
        estimated_cost_micros: 0,
      };
    }
    throw new Error(
      `${scenario.id}: ${errorCode}`,
      {
        cause: Object.assign(new Error(errorCode), {
          code: errorCode,
          retry_after_seconds: typeof body?.retry_after_seconds === "number"
            ? body.retry_after_seconds
            : payload?.retry_after_seconds,
        }),
      },
    );
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
  const proposalTool = payload?.kind === "executed" &&
      typeof payload.tool_name === "string"
    ? [{ name: payload.tool_name }]
    : [];
  const toolCalls = [...observedTools, ...proposalTool];
  const reply = typeof canonical?.content?.text === "string" &&
      canonical.content.text.length > 0
    ? canonical.content.text
    : payload?.text ?? payload?.followup_text ?? "";
  const tripGraph = payload?.kind === "executed"
    ? verifiedTripGraphSummary(payload.result)
    : null;
  const proposal = payload?.kind === "pending_action"
    ? {
      tool_name: payload.tool_name ?? null,
      tool_args: payload.tool_args ?? null,
    }
    : null;
  return {
    tool_calls: toolCalls,
    error_codes: observations.flatMap((item) =>
      typeof item?.error_code === "string" ? [item.error_code] : []
    ),
    reply,
    canonical_readback: payload?.kind === "text" && canonical !== null &&
        observations.some((item) =>
          item.tool === "list_events" && !item.error
        ) ||
      tripGraph !== null,
    ...(tripGraph ? { trip_graph: tripGraph } : {}),
    response_kind: payload?.kind ?? "unknown",
    ...(proposal ? { proposal } : {}),
    ...(typeof payload?.pending_action_id === "string"
      ? { pending_action_id: payload.pending_action_id }
      : {}),
    conversation_id: payload?.conversation_id ?? conversationId ?? null,
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

async function cachedModelTrace(
  scenario,
  mode,
  step,
  conversationId,
  turnIndex,
  pendingActionId,
  pendingActionTool,
) {
  const version = process.env.ARI_EVAL_RUNTIME_VERSION ?? "local";
  const digest = createHash("sha256").update(
    JSON.stringify({
      scenario: scenario.id,
      step,
      conversationId,
      turnIndex,
      pendingActionId,
      pendingActionTool,
      mode,
      version,
    }),
  ).digest("hex");
  const cacheDir = join(tmpdir(), "mingla-ari-eval-cache");
  const path = join(cacheDir, `${digest}.json`);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    const trace = await callLocalAri(
      scenario,
      step,
      conversationId,
      turnIndex,
      pendingActionId,
      pendingActionTool,
    );
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path, JSON.stringify(trace), "utf8");
    return trace;
  }
}

export async function runScenarios({
  mode = "contract",
  maxCalls = 450,
  ids = null,
  observedTraces = null,
} = {}) {
  const selected = ARI_EVAL_SCENARIOS.filter((scenario) =>
    scenario.status === "active" && (!ids || ids.includes(scenario.id))
  );
  const results = [];
  let calls = 0;
  for (const scenario of selected) {
    if (["local_live", "model", "pilot"].includes(mode) && calls >= maxCalls) {
      break;
    }
    let trace;
    if (mode === "contract") {
      trace = await traceForContract(scenario);
    } else if (mode === "deterministic") {
      trace = observedTraces?.[scenario.id] ?? null;
      if (!trace) {
        throw new Error(
          `Observed deterministic trace required for ${scenario.id}`,
        );
      }
    } else {
      const turns = [];
      let conversationId = null;
      let pendingActionId = null;
      let pendingActionTool = null;
      const steps = scenario.input.steps?.length
        ? scenario.input.steps
        : [{ message: scenario.input.message }];
      for (
        let turnIndex = 0;
        turnIndex < steps.length && calls < maxCalls;
        turnIndex += 1
      ) {
        const step = typeof steps[turnIndex] === "string"
          ? { message: steps[turnIndex] }
          : steps[turnIndex];
        const stepStartedAt = performance.now();
        let current;
        try {
          current = await cachedModelTrace(
            scenario,
            mode,
            step,
            conversationId,
            turnIndex,
            pendingActionId,
            pendingActionTool,
          );
        } catch (error) {
          // Stop only this chain at an uncertain step. Keep the bounded reason
          // in its result and let independent scenarios in the batch continue.
          const failure = evaluatorErrorDetails(error);
          current = {
            tool_calls: [],
            error_codes: [failure.code],
            reply: "",
            canonical_readback: false,
            response_kind: "runner_error",
            conversation_id: conversationId,
            latency_ms: Math.round(performance.now() - stepStartedAt),
            estimated_cost_micros: 0,
            ...(failure.retry_after_seconds !== null
              ? { retry_after_seconds: failure.retry_after_seconds }
              : {}),
          };
          calls += 1;
          turns.push(current);
          break;
        }
        calls += 1;
        turns.push(current);
        conversationId = current.conversation_id ?? conversationId;
        if (current.response_kind === "executed") {
          pendingActionId = null;
          pendingActionTool = null;
        } else if (current.pending_action_id) {
          pendingActionId = current.pending_action_id;
          pendingActionTool = current.proposal?.tool_name ?? null;
        }
      }
      trace = {
        turns,
        tool_calls: turns.flatMap((turn) => turn.tool_calls ?? []),
        error_codes: turns.flatMap((turn) => turn.error_codes ?? []),
        reply: turns.map((turn) => turn.reply ?? "").join("\n"),
        canonical_readback: turns.at(-1)?.canonical_readback === true,
        conversation_ids: turns.map((turn) => turn.conversation_id),
        latency_ms: turns.reduce(
          (total, turn) => total + Number(turn.latency_ms ?? 0),
          0,
        ),
        estimated_cost_micros: turns.reduce(
          (total, turn) => total + Number(turn.estimated_cost_micros ?? 0),
          0,
        ),
      };
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
  const maxCalls = Number(option("max-calls", "450"));
  const ids = option("ids")?.split(",").filter(Boolean) ?? null;
  const traceFile = option("trace-file");
  const observedTraces = traceFile
    ? JSON.parse(await readFile(traceFile, "utf8"))
    : null;
  const output = await runScenarios({ mode, maxCalls, ids, observedTraces });
  const serialized = JSON.stringify(output, null, 2);
  const outputPath = option("output");
  if (outputPath) await writeFile(outputPath, serialized, "utf8");
  console.log(serialized);
  process.exitCode = output.failed > 0 ? 1 : 0;
}
