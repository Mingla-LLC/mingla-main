import assert from "node:assert/strict";
import test from "node:test";
import { ARI_EVAL_SCENARIOS } from "../scenarios.mjs";
import {
  assertExpectedPendingAction,
  evaluateScenario,
  lintScenarioRegistry,
  resolveScenarioBrandId,
  runScenarios,
} from "../run-scenarios.mjs";

test("#3355 catalogue contains 57 product, 13 mechanics, research regression and 100 chained workflows", () => {
  assert.equal(ARI_EVAL_SCENARIOS.length, 171);
  assert.deepEqual(
    ARI_EVAL_SCENARIOS.map((scenario) => scenario.id),
    Array.from(
      { length: 171 },
      (_, index) => `S${String(index + 1).padStart(3, "0")}`,
    ),
  );
});

test("#3355 adds 100 chained scenarios with real multi-turn continuity and registered ordered tools", () => {
  const chains = ARI_EVAL_SCENARIOS.filter((scenario) =>
    scenario.tags.includes("chain")
  );
  assert.equal(chains.length, 100);
  assert.ok(chains.every((scenario) => scenario.input.steps.length >= 3));
  assert.ok(
    chains.every((scenario) => scenario.expected.require_same_conversation),
  );
  assert.ok(
    chains.every((scenario) =>
      scenario.expected.required_tool_chains.length > 0
    ),
  );
  assert.ok(
    chains.every((scenario) => typeof scenario.input.brand_name === "string"),
  );
  assert.ok(chains.every((scenario) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: scenario.input.timezone });
      return true;
    } catch {
      return false;
    }
  }));
});

test("#3355 chain prompts keep research platforms, write gates and missing inputs human-safe", () => {
  const chains = ARI_EVAL_SCENARIOS.filter((scenario) =>
    scenario.tags.includes("chain")
  );
  assert.ok(
    chains.every((scenario) => !JSON.stringify(scenario).includes("undefined")),
  );
  assert.ok(
    chains.filter((scenario) => scenario.tags[1] === "web_research")
      .every((scenario) =>
        !scenario.input.steps[1].message.includes("email profile")
      ),
  );
  assert.ok(
    chains.filter((scenario) => scenario.tags[1] === "event_launch")
      .every((scenario) =>
        scenario.expected.forbidden_tools.includes("publish_event")
      ),
  );
  assert.ok(
    chains.filter((scenario) => scenario.tags[1] === "trip_setup")
      .every((scenario) =>
        scenario.expected.forbidden_tools.includes("publish_trip")
      ),
  );
  assert.ok(
    chains.filter((scenario) => scenario.tags[1] === "team_invite")
      .every((scenario) =>
        /@example\.com/.test(scenario.input.steps[1].message)
      ),
  );
  assert.ok(
    chains.filter((scenario) => scenario.tags[1] === "audience_growth")
      .every((scenario) =>
        scenario.expected.forbidden_tools.includes("invite_promoters")
      ),
  );
});

test("#3355 fixtures are private-safe and structurally complete", () => {
  for (const scenario of ARI_EVAL_SCENARIOS) {
    const serialized = JSON.stringify(scenario);
    assert.match(scenario.title, /\S/);
    assert.ok(Array.isArray(scenario.expected.required_tools));
    assert.ok(Array.isArray(scenario.expected.forbidden_tools));
    assert.doesNotMatch(
      serialized,
      /\b[A-Z0-9._%+-]+@(?!example\.com)[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    );
    assert.doesNotMatch(serialized, /\+\d{8,}/);
    assert.doesNotMatch(serialized, /\b\d{10,}\b/);
  }
});

test("#3355 evaluator fails a missing required tool and forbidden action", () => {
  const scenario = {
    expected: {
      required_tools: ["inspect"],
      forbidden_tools: ["publish"],
      forbidden_phrases: [],
      require_canonical_readback: true,
    },
  };
  const verdict = evaluateScenario(scenario, {
    tool_calls: [{ name: "publish" }],
    reply: "done",
    canonical_readback: false,
  });
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.failures, [
    "missing_tool:inspect",
    "forbidden_tool:publish",
    "canonical_readback_missing",
  ]);
});

test("#3355 local runner records a rate limit and continues independent scenarios", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries([
    "ARI_EVAL_ENDPOINT",
    "ARI_EVAL_TOKEN",
    "ARI_EVAL_RUNTIME_VERSION",
  ].map((key) => [key, process.env[key]]));
  try {
    process.env.ARI_EVAL_ENDPOINT = "http://127.0.0.1:8000";
    process.env.ARI_EVAL_TOKEN = "local-test-token";
    process.env.ARI_EVAL_RUNTIME_VERSION = `harness-${Date.now()}`;
    globalThis.fetch = async () => new Response(
      JSON.stringify({
        kind: "error",
        code: "RATE_LIMITED",
        retry_after_seconds: 30,
        user_message: "Ari is busy right now. Try again shortly.",
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
    const result = await runScenarios({
      mode: "local_live",
      ids: ["S001", "S002"],
      maxCalls: 2,
    });
    assert.equal(result.executed, 2);
    assert.equal(result.failed, 2);
    assert.equal(result.calls, 2);
    assert.deepEqual(
      result.results.map((item) => item.trace[0].error_codes),
      [["RATE_LIMITED"], ["RATE_LIMITED"]],
    );
    assert.deepEqual(
      result.results.map((item) => item.trace[0].turns[0].retry_after_seconds),
      [30, 30],
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("#3355 evaluator keeps a pending approval separate from an executed write", () => {
  const scenario = {
    expected: {
      required_tools: ["create_event"],
      forbidden_tools: [],
      forbidden_phrases: [],
      require_approval_before_write: true,
      turn_expectations: [
        {
          response_kind: "pending_action",
          required_proposal_tool: "create_event",
          required_proposal_args: { start_at: "2026-11-15T17:00:00.000Z" },
        },
        { required_tools: ["create_event"], response_kind: "executed" },
      ],
    },
  };
  const trace = {
    tool_calls: [{ name: "create_event" }],
    turns: [
      {
        response_kind: "pending_action",
        proposal: {
          tool_name: "create_event",
          tool_args: { start_at: "2026-11-15T17:00:00.000Z" },
        },
        tool_calls: [],
      },
      {
        response_kind: "executed",
        tool_calls: [{ name: "create_event" }],
      },
    ],
  };
  assert.deepEqual(evaluateScenario(scenario, trace), {
    passed: true,
    failures: [],
  });
  const unapproved = structuredClone(trace);
  unapproved.turns.shift();
  const unapprovedVerdict = evaluateScenario(scenario, unapproved);
  assert.equal(unapprovedVerdict.passed, false);
  assert.ok(
    unapprovedVerdict.failures.includes("write_without_prior_pending_approval"),
  );
});

test("#3355 evaluator records an expected safety refusal and verifies the workflow continues without writing", () => {
  const scenario = ARI_EVAL_SCENARIOS.find((item) => item.id === "S074");
  assert.ok(scenario);
  assert.deepEqual(scenario.expected.required_tool_chains, [[
    "create_event",
    "list_events",
  ]]);
  assert.ok(scenario.expected.forbidden_tools.includes("upsert_ticket_tier"));
  const trace = {
    tool_calls: [{ name: "create_event" }, { name: "list_events" }],
    error_codes: ["PAYOUT_NOT_READY"],
    reply: "This brand can't accept paid tickets yet. Finish its payout setup first. The event remains a draft.",
    canonical_readback: true,
    turns: [
      { response_kind: "pending_action", proposal: { tool_name: "create_event" } },
      { response_kind: "executed", tool_calls: [{ name: "create_event" }] },
      {
        response_kind: "error",
        error_codes: ["PAYOUT_NOT_READY"],
        reply: "This brand can't accept paid tickets yet. Finish its payout setup first.",
        tool_calls: [],
      },
      {
        response_kind: "text",
        reply: "Winter Table — Saturday, January 23, 2027, 7:00 PM–9:00 PM CST (Draft — not published). Here is the launch plan; nothing has been changed or published.",
        tool_calls: [{ name: "list_events" }],
        canonical_readback: true,
      },
    ],
    conversation_ids: Array(4).fill("one-conversation"),
  };
  assert.deepEqual(evaluateScenario(scenario, trace), {
    passed: true,
    failures: [],
  });

  const unsafe = structuredClone(trace);
  unsafe.turns[3].tool_calls = [{ name: "upsert_ticket_tier" }];
  unsafe.tool_calls.push({ name: "upsert_ticket_tier" });
  const verdict = evaluateScenario(scenario, unsafe);
  assert.equal(verdict.passed, false);
  assert.ok(verdict.failures.includes("forbidden_tool:upsert_ticket_tier"));
});

test("#3355 event chain scenarios match the local demo brands' payout readiness", () => {
  const events = ARI_EVAL_SCENARIOS.filter((scenario) =>
    scenario.tags[1] === "event_launch"
  );
  const payoutBlocked = events.filter((scenario) =>
    scenario.input.brand_name !== "Lantern Room" && scenario.id !== "S072"
  );
  assert.equal(payoutBlocked.length, 8);
  for (const scenario of payoutBlocked) {
    assert.ok(scenario.expected.forbidden_tools.includes("upsert_ticket_tier"));
    assert.equal(
      scenario.expected.turn_expectations[2].expected_error_code,
      "PAYOUT_NOT_READY",
    );
    assert.ok(
      scenario.expected.required_tool_chains.some((chain) =>
        chain.join(",") === "create_event,list_events"
      ),
    );
  }
  const paidHappyPath = events.find((scenario) =>
    scenario.input.brand_name === "Lantern Room"
  );
  assert.ok(paidHappyPath.expected.required_tools.includes("upsert_ticket_tier"));
});

test("#3355 local runner refuses to confirm a proposal unless its tool matches the scenario", () => {
  assert.doesNotThrow(() =>
    assertExpectedPendingAction(
      { expected_pending_tool: "create_trip" },
      "pending-1",
      "create_trip",
    )
  );
  assert.throws(
    () =>
      assertExpectedPendingAction(
        { expected_pending_tool: "create_trip" },
        "pending-1",
        "manage_brand_people",
      ),
    /Refusing to confirm unexpected Ari proposal/,
  );
  assert.throws(
    () => assertExpectedPendingAction({}, "pending-1", "create_trip"),
    /without an expected pending tool/,
  );
});

test("#3355 trip chains confirm each draft graph write and verify its saved graph", () => {
  const trips = ARI_EVAL_SCENARIOS.filter((scenario) =>
    scenario.tags[1] === "trip_setup"
  );
  assert.equal(trips.length, 10);
  assert.ok(
    trips.every((scenario) =>
      scenario.input.steps.filter((step) =>
        step.action === "confirm_pending_action"
      ).length === 3
    ),
  );
  const trip = trips[0];
  const trace = {
    tool_calls: [
      { name: "create_trip" },
      { name: "manage_trip_days" },
      { name: "manage_trip_tiers" },
    ],
    canonical_readback: true,
    turns: [
      {
        response_kind: "pending_action",
        proposal: { tool_name: "create_trip" },
      },
      {
        response_kind: "executed",
        tool_calls: [{ name: "create_trip" }],
        trip_graph: { status: "draft", day_count: 0, tier_count: 1 },
      },
      {
        response_kind: "pending_action",
        proposal: { tool_name: "manage_trip_days" },
      },
      {
        response_kind: "executed",
        tool_calls: [{ name: "manage_trip_days" }],
        trip_graph: {
          status: "draft",
          day_count: 3,
          tier_count: 1,
          day_dates: ["2026-11-15", "2026-11-16", "2026-11-17"],
        },
      },
      {
        response_kind: "pending_action",
        proposal: { tool_name: "manage_trip_tiers" },
      },
      {
        response_kind: "executed",
        tool_calls: [{ name: "manage_trip_tiers" }],
        trip_graph: {
          status: "draft",
          day_count: 3,
          tier_count: 1,
          day_dates: ["2026-11-15", "2026-11-16", "2026-11-17"],
        },
        canonical_readback: true,
      },
    ],
    conversation_ids: Array(6).fill("one-conversation"),
  };
  assert.deepEqual(evaluateScenario(trip, trace), {
    passed: true,
    failures: [],
  });
  const unsaved = structuredClone(trace);
  unsaved.turns[5].trip_graph.day_count = 2;
  const verdict = evaluateScenario(trip, unsaved);
  assert.equal(verdict.passed, false);
  assert.ok(verdict.failures.includes("turn_6_trip_graph_mismatch:day_count"));
});

test("#3355 chain evaluator enforces ordered tools, one conversation and approval", () => {
  const scenario = {
    expected: {
      required_tools: [],
      forbidden_tools: [],
      required_tool_chains: [["create_event", "list_events"]],
      require_same_conversation: true,
      approval_reply_pattern: "should I create",
    },
  };
  const trace = {
    tool_calls: [{ name: "list_events" }, { name: "create_event" }],
    conversation_ids: ["conversation-1", "conversation-2"],
    turns: [
      { tool_calls: [{ name: "list_events" }], reply: "Checking the event." },
      { tool_calls: [{ name: "create_event" }], reply: "Draft created." },
    ],
    reply: "Draft created.",
  };
  const verdict = evaluateScenario(scenario, trace);
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.failures, [
    "final_approval_checkpoint_missing",
    "tool_chain_incomplete:list_events",
    "conversation_not_continuous",
  ]);
});

test("#3355 P10 registry lint checks every active scenario and reports no pass count", async () => {
  const lint = await lintScenarioRegistry();
  assert.equal(lint.mode, "registry-lint");
  assert.equal(lint.behavioural, false);
  assert.ok(lint.linted >= 60);
  assert.equal(lint.with_lint_failures, 0);
  // A lint is never presented as a pass signal ("168/168").
  for (const key of ["passed", "failed", "executed", "score"]) {
    assert.equal(key in lint, false, `lint output must not carry ${key}`);
  }
  assert.ok(lint.results.every((item) => !("passed" in item)));
});

test("#3355 P10 the old contract mode cannot produce a pass count", async () => {
  await assert.rejects(
    () => runScenarios({ mode: "contract" }),
    /registry lint, not a behaviour run/,
  );
  await assert.rejects(
    () => runScenarios({ mode: "registry-lint" }),
    /registry lint, not a behaviour run/,
  );
});

test("#3355 multi-brand local runs require an explicit matching brand map", () => {
  const previousMap = process.env.ARI_EVAL_BRAND_IDS;
  const previousSingle = process.env.ARI_EVAL_BRAND_ID;
  const previousName = process.env.ARI_EVAL_BRAND_NAME;
  try {
    process.env.ARI_EVAL_BRAND_IDS = JSON.stringify({
      "Lantern Room": "brand-lantern",
    });
    delete process.env.ARI_EVAL_BRAND_ID;
    delete process.env.ARI_EVAL_BRAND_NAME;
    assert.equal(
      resolveScenarioBrandId({ input: { brand_name: "Lantern Room" } }),
      "brand-lantern",
    );
    assert.throws(
      () =>
        resolveScenarioBrandId({ input: { brand_name: "Harmattan House" } }),
      /No local evaluation brand ID is configured/,
    );
  } finally {
    if (previousMap === undefined) delete process.env.ARI_EVAL_BRAND_IDS;
    else process.env.ARI_EVAL_BRAND_IDS = previousMap;
    if (previousSingle === undefined) delete process.env.ARI_EVAL_BRAND_ID;
    else process.env.ARI_EVAL_BRAND_ID = previousSingle;
    if (previousName === undefined) delete process.env.ARI_EVAL_BRAND_NAME;
    else process.env.ARI_EVAL_BRAND_NAME = previousName;
  }
});

test("#3355 deterministic mode refuses to invent missing observations", async () => {
  await assert.rejects(
    () => runScenarios({ mode: "deterministic", ids: ["S001"] }),
    /Observed deterministic trace required/,
  );
});
