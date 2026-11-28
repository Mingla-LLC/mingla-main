import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { configureLocalLoop, kunleScore } from "../run-live.mjs";
import { AriSession, serviceRest } from "../flows/lib.mjs";
import { judgeKunleReply } from "../kunle/judge.mjs";
import {
  kunleVerdict,
  shouldRetryKunleError,
  shouldRetryKunleTurn,
} from "../kunle/index.mjs";
import {
  KUNLE_GLOBAL_HARD_PREDICATES,
  KUNLE_SCENARIOS,
} from "../kunle/scenarios.mjs";

// MINGLA-INVARIANT: I-ARI-LOOP-FLIP-NEEDS-KUNLE-EVAL | issue #4599 | Every governed Ari loop flip is exercised by ten fixture-backed Kunle scenarios and the suite's score is present in the live-eval baseline.

const ROOT = new URL("../../../../", import.meta.url);

test("the Kunle suite owns ten fixture-backed hard-predicate scenarios", () => {
  assert.equal(KUNLE_SCENARIOS.length, 10);
  assert.equal(new Set(KUNLE_SCENARIOS.map((item) => item.id)).size, 10);
  for (const scenario of KUNLE_SCENARIOS) {
    assert.ok(scenario.id.startsWith("kunle_s"), scenario.id);
    assert.equal(typeof scenario.fixture, "object", scenario.id);
    assert.ok(Object.keys(scenario.fixture).length > 0, scenario.id);
    assert.ok(scenario.prompt.length > 80, scenario.id);
    assert.ok(scenario.hardPredicates.length >= 1, scenario.id);
    assert.ok(scenario.strongerResponse.length > 40, scenario.id);
  }
});

test("the comp-zero predicate accepts the canonical order summary", () => {
  const scenario = KUNLE_SCENARIOS.find((item) =>
    item.id === "kunle_s10_cancel_followup"
  );
  const predicate = scenario.hardPredicates.find((item) =>
    item.id === "comp zero"
  );
  assert.equal(
    predicate.check({
      text: "Comp Orders: 1 order (Total value: 0.00 NGN)",
      tools: [],
      proposal: null,
      executedWrites: [],
    }),
    true,
  );
});

test("hard predicates accept safe equivalent truth wording", () => {
  const predicate = (scenarioId, predicateId) =>
    KUNLE_SCENARIOS.find((item) => item.id === scenarioId).hardPredicates.find(
      (item) => item.id === predicateId,
    );
  assert.equal(
    predicate("kunle_s2_moved_event", "both times").check({
      text: "The listing opens at 4:00 pm, but the DJ arrives at 7:00 pm.",
      tools: [],
    }),
    true,
  );
  assert.equal(
    predicate("kunle_s3_trip_holds", "rooms remain unconfirmed").check({
      text: "Are the 8 rooms officially reserved with the venue?",
      tools: [],
    }),
    true,
  );
  assert.equal(
    predicate("kunle_s3_trip_holds", "dms not bookings").check({
      text: "How should the 11 DMs be matched against the 3 paid Mingla orders?",
      tools: [],
    }),
    true,
  );
  assert.equal(
    predicate("kunle_s6_performance", "no ad increase recommendation").check({
      text: "Whether to spend more on ads cannot be concluded.",
    }),
    true,
  );
  assert.equal(
    predicate("kunle_s6_performance", "no ad increase recommendation").check({
      text: "Increase ad spend next month.",
    }),
    false,
  );
});

test("hedged proposal matching ignores ids but catches semantic values", () => {
  const predicate = KUNLE_GLOBAL_HARD_PREDICATES.find((item) =>
    item.id === "no hedged proposal"
  );
  const scenario = { hedgedValues: ["8"] };
  assert.equal(
    predicate.check({
      scenario,
      proposal: {
        args: {
          source_conversation_id: "342f78b5-0000-4000-8000-acde00000000",
          message: "Could someone help? (Ari chat 342f78b5)",
        },
      },
    }),
    true,
  );
  assert.equal(
    predicate.check({
      scenario,
      proposal: { args: { quantity_total: 8 } },
    }),
    false,
  );
});

test("Kunle retries only explicit transient turn failures", () => {
  assert.equal(
    shouldRetryKunleTurn({
      kind: "text",
      structured: {
        agent_run: {
          observations: [{ error_code: "MODEL_UNAVAILABLE" }],
        },
      },
    }),
    true,
  );
  assert.equal(
    shouldRetryKunleTurn({
      kind: "text",
      structured: { agent_run: { observations: [] } },
    }),
    false,
  );
  assert.equal(
    shouldRetryKunleTurn({ kind: "error", code: "HTTP_504" }),
    true,
  );
  assert.equal(shouldRetryKunleError(new TypeError("fetch failed")), true);
  assert.equal(shouldRetryKunleError(new Error("bad fixture")), false);
});

test("Pass, Partial and Fail stay distinct in verdicts and the gated score", () => {
  const hard = { fact: "hard: receipt", passed: true };
  const judge = { fact: "judge: complete", passed: true };
  assert.equal(kunleVerdict({ facts: [hard, judge] }), "Pass");
  assert.equal(
    kunleVerdict({ facts: [hard, { ...judge, passed: false }] }),
    "Partial",
  );
  assert.equal(
    kunleVerdict({ facts: [{ ...hard, passed: false }, judge] }),
    "Fail",
  );
  assert.equal(
    kunleScore([
      { verdict: "Pass" },
      { verdict: "Partial" },
      { verdict: "Fail" },
      { verdict: "Pass" },
    ]),
    62.5,
  );
});

test("--loop changes only the local flag and restores its previous value", async () => {
  let enabled = false;
  const writes = [];
  const rest = {
    async select(table, query) {
      assert.equal(table, "feature_flags");
      assert.match(query, /ari_agent_loop_v2/);
      return [{ flag_key: "ari_agent_loop_v2", is_enabled: enabled }];
    },
    async update(table, query, patch) {
      assert.equal(table, "feature_flags");
      assert.match(query, /ari_agent_loop_v2/);
      enabled = patch.is_enabled;
      writes.push(enabled);
      return [{ flag_key: "ari_agent_loop_v2", is_enabled: enabled }];
    },
  };
  const setting = await configureLocalLoop(rest, "on");
  assert.equal(setting.enabled, true);
  assert.equal(enabled, true);
  await setting.restore();
  await setting.restore();
  assert.equal(enabled, false);
  assert.deepEqual(writes, [true, false]);
  await assert.rejects(() => configureLocalLoop(rest, "maybe"), /on or off/);
});

test("--loop restore retries a transient local connection failure", async () => {
  let enabled = false;
  let restoreAttempts = 0;
  const rest = {
    async select() {
      return [{ flag_key: "ari_agent_loop_v2", is_enabled: enabled }];
    },
    async update(_table, _query, patch) {
      if (!patch.is_enabled) {
        restoreAttempts += 1;
        if (restoreAttempts === 1) throw new TypeError("fetch failed");
      }
      enabled = patch.is_enabled;
      return [{ flag_key: "ari_agent_loop_v2", is_enabled: enabled }];
    },
  };

  const setting = await configureLocalLoop(rest, "on", {
    restoreRetryDelays: [0, 0],
  });
  await setting.restore();
  assert.equal(enabled, false);
  assert.equal(restoreAttempts, 2);
});

test("the three-vote judge retries transient provider failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(
        JSON.stringify({ error: { status: "UNAVAILABLE" } }),
        { status: 503 },
      );
    }
    return new Response(
      JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                criteria: Array.from({ length: 5 }, (_, index) => ({
                  id: `criterion-${index}`,
                  passed: true,
                  quote: "Confirmed",
                })),
              }),
            }],
          },
        }],
      }),
      { status: 200 },
    );
  };
  try {
    const rows = await judgeKunleReply({
      apiKey: "local-test-key",
      model: "local-test-model",
      scenario: {
        title: "Test",
        prompt: "Test prompt",
        strongerResponse: "Test stronger response",
      },
      reply: "Confirmed",
    });
    assert.equal(calls, 4);
    assert.equal(rows.length, 5);
    assert.ok(rows.every((row) => row.passed));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the local eval client retries transient stack gateway failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ message: "timed out" }), { status: 504 })
      : new Response(JSON.stringify({ users: [] }), { status: 200 });
  };
  try {
    const rest = serviceRest({
      url: "http://127.0.0.1:57321",
      serviceKey: "local-test-key",
    });
    assert.deepEqual(await rest.auth("GET", "/admin/users"), { users: [] });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the local eval client retries a transient database timeout", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response(
        JSON.stringify({
          code: "57014",
          message: "canceling statement due to statement timeout",
        }),
        { status: 500 },
      )
      : new Response(JSON.stringify([{ id: "local" }]), { status: 200 });
  };
  try {
    const rest = serviceRest({
      url: "http://127.0.0.1:57321",
      serviceKey: "local-test-key",
    });
    assert.deepEqual(await rest.select("creator_accounts", "select=id"), [{
      id: "local",
    }]);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the live session retries one transient Ari response idempotently", async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) {
      return new Response(
        JSON.stringify({ code: "HTTP_504", message: "timing out" }),
        { status: 504 },
      );
    }
    return new Response(
      JSON.stringify({
        protocol_version: 1,
        data: { kind: "text", text: "Recovered", conversation_id: "c1" },
      }),
      { status: 200 },
    );
  };
  try {
    const session = new AriSession(
      { url: "http://127.0.0.1:57321", anonKey: "local" },
      { token: "local" },
      "brand-1",
    );
    const data = await session.say("How do drafts work?");
    assert.equal(data.text, "Recovered");
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].client_turn_id, bodies[1].client_turn_id);
    assert.equal(session.transcript.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the runner registers Kunle by default and the baseline gates its score", () => {
  const runner = readFileSync(
    new URL("../run-live.mjs", import.meta.url),
    "utf8",
  );
  assert.match(runner, /KUNLE_EVALS/);
  assert.match(runner, /"claim_check", "kunle"/);
  assert.match(runner, /configureLocalLoop\(rest, option\("loop"\)\)/);

  const baseline = JSON.parse(readFileSync(
    new URL("docs/contracts/ari-live-eval-baseline.json", ROOT),
    "utf8",
  ));
  assert.equal(typeof baseline.scores?.kunle, "number");
});

test("the live runner reuses its prepared fixture set", () => {
  const runner = readFileSync(
    new URL("../run-live.mjs", import.meta.url),
    "utf8",
  );
  assert.match(runner, /const seeded = \{ brands, users \}/);
  assert.match(runner, /evals: KUNLE_EVALS,[\s\S]{0,80}seeded,/);
});

test("the local fixture enables capabilities required by replay", () => {
  const seed = readFileSync(
    new URL("../seed-flow-brands.mjs", import.meta.url),
    "utf8",
  );
  assert.match(seed, /contact_import_v1/);
  assert.match(seed, /discounts_enabled/);
  assert.match(seed, /ensureEvalFeatureFlags\(rest\)/);
});

test("the Kunle trace recovers persisted answer text and tool receipts", () => {
  const source = readFileSync(
    new URL("../kunle/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /select=role,content,tool_results/);
  assert.match(source, /directText \|\| savedText/);
  assert.match(source, /persistedTools/);
});
