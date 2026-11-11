// Issue #3355 Wave F (F1) — the replay harness in CI mode: the scripted host
// threads (scripts/ari/eval/replay/fixtures.mjs) through the deterministic
// layers of the turn pipeline, with a stub model, graded by the same grader
// the live run uses (scripts/ari/eval/replay/grade.mjs).
//
// Per turn: the stub intent read goes through the shipped intent-read
// parser and routeAriTurn; the typed words go through decideFlowTurn (no
// keyword may start a setup); a stub proposal goes through the stated-slot
// guard (checkStatedSlots, the brand's zone); a stub reply goes through the
// write-claim guard (guardWriteClaims). What comes out is graded on route,
// proposal args, reply claims and no-same-card-twice. No network, no model.
//
// The live twin: node scripts/ari/eval/run-live.mjs (local stack, real Flash).
//
// MINGLA-INVARIANT: I-ARI-REPLAY-HARNESS | issue #3355 | Every scripted replay thread (this morning's Lagos host thread, the #3355 body scenarios) passes the replay grader through the shipped deterministic turn layers with a stub model, and the release gate fails a 2+ point drop.
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_wave_f_replay.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AGENT_TOOLS } from "../agentTools.ts";
import { ariDeterministicSafetyReply } from "../agentToolsets.ts";
import {
  collectAriIntentHints,
  readAriIntent,
  routeAriTurn,
} from "../ariIntentRead.ts";
import { decideFlowTurn } from "../ariFlows/edge.ts";
import {
  checkStatedSlots,
  extractStatedSlots,
  guardWriteClaims,
  mergeModelStatedSlots,
} from "../ariTruthGuards.ts";
import {
  freshWorld,
  MemoryStore,
  OWNER,
  turnArgs,
} from "./_issue3355WaveEFlowWorld.ts";
// The fixtures and the grader are plain ES modules shared with the Node
// live runner.
import {
  REPLAY_FIXTURES,
} from "../../../../scripts/ari/eval/replay/fixtures.mjs";
import {
  compareToBaseline,
  GATE_DROP_POINTS,
  gradeThread,
  gradeTurn,
  percentiles,
  scoreRun,
} from "../../../../scripts/ari/eval/replay/grade.mjs";

const TOOL_NAMES = AGENT_TOOLS.map((tool) => tool.name);
const ZONES: Record<string, string> = {
  "Africa/Lagos": "Africa/Lagos",
  "Europe/London": "Europe/London",
};

interface Stub {
  read: Record<string, unknown>;
  proposal?: { tool: string; args: Record<string, unknown> };
  reply?: string;
}

function schemaKeys(toolName: string): Set<string> {
  const tool = AGENT_TOOLS.find((item) => item.name === toolName);
  const properties = (tool?.parameters as { properties?: unknown } | undefined)
    ?.properties;
  return new Set(
    properties && typeof properties === "object" ? Object.keys(properties) : [],
  );
}

/** One fixture turn through the deterministic layers (stub model). */
async function replayTurn(args: {
  say: string;
  stub: Stub;
  ownerSinceProposal: string[];
  evidence: unknown[];
  timezone: string;
  store: MemoryStore;
}) {
  const hints = collectAriIntentHints(args.say, null);
  const result = await readAriIntent({
    input: {
      message: args.say,
      snapshotText: "Brand: Harmattan Kitchen",
      openFlow: null,
      recentOwnerTurns: [],
      hints,
      toolNames: TOOL_NAMES,
    },
    call: () => Promise.resolve(args.stub.read),
  });
  assertEquals(result.source, "model", `stub read accepted: ${args.say}`);
  const route = routeAriTurn({
    result,
    hints,
    openFlow: null,
    engineOn: true,
    message: args.say,
    safetyReply: ariDeterministicSafetyReply(args.say) !== null,
  });
  // The flow engine on the same words: no keyword may start a setup.
  const before = args.store.runs.size;
  const decision = await decideFlowTurn({
    ...turnArgs(args.store, freshWorld(), args.say),
    route: route.flow,
  });
  const keywordStarted = args.store.runs.size > before ||
    decision.kind === "reply";
  const modelStarted = args.stub.read.intent === "flow"
    ? [String(args.stub.read.target)]
    : [];
  const newRuns = keywordStarted ? ["keyword"] : modelStarted;

  if (args.stub.proposal) {
    const stated = mergeModelStatedSlots(
      extractStatedSlots(args.ownerSinceProposal, new Date("2026-11-10T09:47:00Z")),
      route.statedValues,
      args.ownerSinceProposal,
    );
    const check = checkStatedSlots({
      toolName: args.stub.proposal.tool,
      toolArgs: args.stub.proposal.args,
      schemaKeys: schemaKeys(args.stub.proposal.tool),
      stated,
      timezone: ZONES[args.timezone] ?? null,
    });
    if (check.kind === "ok") {
      return {
        route: `proposal:${args.stub.proposal.tool}`,
        tool: args.stub.proposal.tool,
        args: check.args,
        text: "",
        card_id: null,
        new_flow_runs: newRuns,
        handoffs: [],
      };
    }
    return {
      route: "text",
      tool: null,
      args: null,
      text: check.text,
      card_id: null,
      new_flow_runs: newRuns,
      handoffs: [],
    };
  }
  const guarded = guardWriteClaims({
    text: args.stub.reply ?? "",
    pendingThisTurn: false,
    evidence: args.evidence,
  });
  return {
    route: modelStarted.length > 0 ? `flow_card:${modelStarted[0]}` : "text",
    tool: null,
    args: null,
    text: guarded.text,
    card_id: null,
    new_flow_runs: newRuns,
    handoffs: [],
  };
}

async function replayFixture(fixture: typeof REPLAY_FIXTURES[number]) {
  const store = new MemoryStore(OWNER);
  const observed = [];
  const evidence: unknown[] = [];
  let sinceProposal: string[] = [];
  for (const turn of fixture.turns) {
    sinceProposal = [...sinceProposal, turn.say];
    const out = await replayTurn({
      say: turn.say,
      stub: turn.stub as Stub,
      ownerSinceProposal: sinceProposal,
      evidence,
      timezone: fixture.timezone,
      store,
    });
    observed.push(out);
    if (out.route.startsWith("proposal:")) {
      evidence.push({ tool_name: out.tool, tool_args: out.args });
      sinceProposal = [];
    }
  }
  return gradeThread(fixture, observed);
}

Deno.test("F1 CI replay: the fixtures cover this morning's thread and the #3355 body scenarios", () => {
  const ids = REPLAY_FIXTURES.map((fixture) => fixture.id);
  assertEquals(ids, [
    "host_thread_2026_11_10",
    "issue_3355_customer_list_upload",
    "issue_3355_website_no_site",
  ]);
  const thread = REPLAY_FIXTURES[0];
  assert(thread.turns.some((turn) => /influencers and marketers/.test(turn.say)));
  assert(thread.turns.some((turn) => /FAVY10/.test(turn.say)));
  // PII: the synthetic brand only; the production brand never appears.
  for (const fixture of REPLAY_FIXTURES) {
    assert(["ng", "new", "sell"].includes(fixture.brand));
    assert(!/@|\+234|\b0[789]\d{9}\b/.test(JSON.stringify(fixture)));
  }
});

Deno.test("F1 CI replay: every fixture passes through the deterministic layers with a stub model", async () => {
  const failures: string[] = [];
  for (const fixture of REPLAY_FIXTURES) {
    const graded = await replayFixture(fixture);
    for (const turn of graded.turns) {
      for (const item of turn.facts.filter((entry) => !entry.passed)) {
        failures.push(
          `${fixture.id} | ${turn.say.slice(0, 60)} | ${item.fact}: expected ${
            JSON.stringify(item.expected)
          }, got ${JSON.stringify(item.actual)}`,
        );
      }
    }
    assertEquals(graded.score, graded.passed ? 100 : graded.score);
  }
  assertEquals(failures, []);
});

Deno.test("F1 CI replay: the FAVY10 turn proposes ends_at 2026-12-19T22:59:59Z (Flash's UTC end re-bound)", async () => {
  const graded = await replayFixture(REPLAY_FIXTURES[0]);
  const favy = graded.turns[1].observed as { args: Record<string, unknown> };
  assertEquals(favy.args.code, "FAVY10");
  assertEquals(favy.args.value_bps, 1000);
  assertEquals(favy.args.ends_at, "2026-12-19T22:59:59Z");
  // The production lie ("I proposed creating … FFBTSCOM10" with no card) is
  // rewritten to the true state, so the claim fact passes.
  const asked = graded.turns[3].observed as { text: string };
  assert(asked.text.startsWith("I haven't made that change yet"), asked.text);
});

Deno.test("F1 grader: this morning's production behaviour fails the grader", () => {
  const thread = REPLAY_FIXTURES[0];
  const production = [
    {
      route: "flow_card:create_event",
      text: "What's the event called?",
      card_id: "c1",
      new_flow_runs: ["create_event"],
      handoffs: [],
    },
    {
      route: "flow_card:create_event",
      text:
        "I didn't catch that as an answer to this step, so nothing was changed.",
      card_id: "c1",
      new_flow_runs: [],
      handoffs: ["timezone"],
    },
    {
      route: "proposal:create_discount",
      tool: "create_discount",
      args: { code: "FFBTSCOM10", value_bps: 1000 },
      text: "",
      card_id: null,
      new_flow_runs: [],
    },
    {
      route: "text",
      text: "I proposed creating the discount code FFBTSCOM10.",
      card_id: null,
      new_flow_runs: [],
    },
  ];
  const graded = gradeThread(thread, production);
  assert(!graded.passed);
  const failed = graded.turns.flatMap((turn) =>
    turn.facts.filter((item) => !item.passed).map((item) => item.fact)
  );
  for (
    const expected of [
      "route",
      "no setup started",
      "never the same card twice",
      "no time zone handoff",
      "claims match the card on screen",
      "proposal ends_at",
    ]
  ) {
    assert(failed.includes(expected), `${expected} not failed: ${failed}`);
  }
});

Deno.test("F1 grader: a website over-promise and a refusal fail; the guide answer passes", () => {
  const [, customers, website] = REPLAY_FIXTURES;
  const overPromise = gradeTurn(website.turns[0].expect, {
    route: "text",
    text: "Done! Your website is now live at lantern.mingla.site.",
  });
  assert(overPromise.some((item) => !item.passed));
  const refused = gradeTurn(customers.turns[0].expect, {
    route: "text",
    text: "Uploading a customer list is not available yet.",
  });
  assert(refused.some((item) => !item.passed));
  const guide = gradeTurn(customers.turns[0].expect, {
    route: "text",
    text:
      "Open the Blast tab, go to People, tap Import and choose your CSV file.",
  });
  assert(guide.every((item) => item.passed));
});

Deno.test("F1 gate: a drop of 2+ points on any suite or overall fails; 1.9 passes; a missing suite fails", () => {
  const baseline = {
    scores: { replay: 100, flows: 84.6, route_table: 100, overall: 94.9 },
  };
  assertEquals(GATE_DROP_POINTS, 2);
  assert(compareToBaseline(baseline, { scores: { ...baseline.scores } }).ok);
  const small = compareToBaseline(baseline, {
    scores: { ...baseline.scores, route_table: 98.1, overall: 94.3 },
  });
  assert(small.ok, JSON.stringify(small));
  const drop = compareToBaseline(baseline, {
    scores: { ...baseline.scores, route_table: 98, overall: 94.2 },
  });
  assert(!drop.ok);
  assertEquals(drop.drops.map((item) => item.suite), ["route_table"]);
  const missing = compareToBaseline(baseline, {
    scores: { replay: 100, overall: 100 },
  });
  assertEquals(missing.drops.map((item) => item.suite), ["flows", "route_table"]);
});

Deno.test("F1 scores and latency: suite scores out of 100, overall the mean; nearest-rank percentiles", () => {
  const scores = scoreRun({
    replay: [{ score: 100 }, { score: 50 }],
    flows: [{ passed: true }, { passed: false }, { skipped: "x" }],
    route_table: { total: 50, misroutes: 1 },
  });
  assertEquals(scores, { replay: 75, flows: 50, route_table: 98, overall: 74.3 });
  assertEquals(percentiles([5, 1, 3, 2, 4]), { n: 5, p50: 3, p95: 5 });
});

Deno.test("F1 baseline: the stored baseline the gate reads has every suite", () => {
  const baseline = JSON.parse(
    Deno.readTextFileSync(
      new URL(
        "../../../../docs/contracts/ari-live-eval-baseline.json",
        import.meta.url,
      ),
    ),
  );
  for (const suite of ["replay", "flows", "route_table", "overall"]) {
    assertEquals(typeof baseline.scores[suite], "number", suite);
  }
  assert(baseline.route_table.total >= 51);
  assertEquals(baseline.ownerIssue, "#3355");
});
