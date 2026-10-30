import assert from "node:assert/strict";
import test from "node:test";
import { ARI_EVAL_SCENARIOS } from "../scenarios.mjs";
import { evaluateScenario, runScenarios } from "../run-scenarios.mjs";

test("#3355 catalogue contains 57 product, 13 mechanics and the research evidence regression", () => {
  assert.equal(ARI_EVAL_SCENARIOS.length, 71);
  assert.deepEqual(ARI_EVAL_SCENARIOS.map((scenario) => scenario.id),
    Array.from({ length: 71 }, (_, index) => `S${String(index + 1).padStart(3, "0")}`));
});

test("#3355 fixtures are private-safe and structurally complete", () => {
  for (const scenario of ARI_EVAL_SCENARIOS) {
    const serialized = JSON.stringify(scenario);
    assert.match(scenario.title, /\S/);
    assert.ok(Array.isArray(scenario.expected.required_tools));
    assert.ok(Array.isArray(scenario.expected.forbidden_tools));
    assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@(?!example\.com)[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
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

test("#3355 contract suite validates every active executable scenario without fabricating behavior", async () => {
  const result = await runScenarios({ mode: "contract" });
  assert.ok(result.executed >= 60);
  assert.equal(result.failed, 0);
  assert.equal(result.passed, result.executed);
  assert.ok(result.results.every((item) => item.trace[0].contract_only === true));
});

test("#3355 deterministic mode refuses to invent missing observations", async () => {
  await assert.rejects(
    () => runScenarios({ mode: "deterministic", ids: ["S001"] }),
    /Observed deterministic trace required/,
  );
});
