// Issue #3355 Wave E (D3a) — guided setups start only when the model calls
// start_flow; the keyword classifiers are hints, never the router.
//
// MINGLA-INVARIANT: I-ARI-FLOWS-START-BY-TOOL | issue #3355 | A guided setup (create_event/trip/experience/venue/stay, website_setup, import_contacts) starts from typed words only when the model calls start_flow with a registered flow_key; no keyword classifier starts a setup or routes to the event slot planner before the model.
// MINGLA-INVARIANT: I-ARI-FLOW-ACTION-PRIMARY | issue #3355 | Inside an open setup the intent read's flow_action (answer / park / resume / cancel, or a side question) decides what typed words do; the Wave A keyword re-read decides only when the intent read failed.
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_wave_e_start_flow.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { ReadinessAction } from "../readinessCatalog.ts";

import { runAgentLoop } from "../agentLoop.ts";
import {
  decideFlowTurn,
  flowRouteFromHints,
  startFlowFromTool,
} from "../ariFlows/edge.ts";
import { runFlowStep } from "../ariFlows/runner.ts";
import {
  ARI_START_FLOW_DECLARATION,
  ARI_START_FLOW_KEYS,
  ARI_START_FLOW_TOOL,
  parseStartFlowArgs,
} from "../ariFlows/startFlowTool.ts";
import { FLOW_DEFINITIONS } from "../ariFlows/index.ts";
import { compileGeminiToolDeclarations } from "../agentGemini.ts";
import {
  current,
  freshWorld,
  HOST_FAVY10_SENTENCE,
  HOST_INFLUENCER_SENTENCE,
  MemoryStore,
  OWNER,
  probesFor,
  readinessFor,
  startEventRun,
  turnArgs,
} from "./_issue3355WaveEFlowWorld.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

// ── start_flow is the one way in ────────────────────────────────────────────

Deno.test("E/D3a: typed words alone start no setup — the old keyword starts are hints now", async () => {
  for (
    const text of [
      "Create an event next Friday",
      "I want to plan a trip to Lisbon",
      "Import my contacts",
      "Upload my contact list",
      "Add a venue",
      "Make a new experience",
      "Set up a stay at our venue",
      HOST_INFLUENCER_SENTENCE,
    ]
  ) {
    const store = new MemoryStore(OWNER);
    const decision = await decideFlowTurn(
      turnArgs(store, freshWorld(), text),
    );
    assertEquals(decision.kind, "none", text);
    assertEquals(store.runs.size, 0, `no run for: ${text}`);
  }
});

Deno.test("E/D3a: start_flow covers every registered setup, strictly", () => {
  assertEquals(
    [...ARI_START_FLOW_KEYS].sort(),
    [...new Set(FLOW_DEFINITIONS.map((def) => def.key))].sort(),
  );
  for (
    const key of [
      "create_event",
      "create_trip",
      "create_experience",
      "create_venue",
      "create_stay",
      "website_setup",
      "import_contacts",
    ]
  ) {
    assert(ARI_START_FLOW_KEYS.includes(key), key);
    assertEquals(parseStartFlowArgs({ flow_key: key })?.flow_key, key);
  }
  assertEquals(parseStartFlowArgs({ flow_key: "create_discount" }), null);
  assertEquals(parseStartFlowArgs({ flow_key: "create_event", x: 1 }), null);
  assertEquals(
    parseStartFlowArgs({ flow_key: "create_event", prefills: { a: {} } }),
    null,
  );
  assertEquals(
    parseStartFlowArgs({
      flow_key: "create_event",
      intent_text: "  Party   on Friday ",
      prefills: { title: "Party", paid: true, price: 5000 },
    }),
    {
      flow_key: "create_event",
      intent_text: "Party on Friday",
      prefills: { title: "Party", paid: true, price: 5000 },
    },
  );
  // The declaration compiles for Gemini and names discounts as NOT a setup.
  compileGeminiToolDeclarations([ARI_START_FLOW_DECLARATION]);
  assertMatch(
    ARI_START_FLOW_DECLARATION.description,
    /Do not use it for discount codes/,
  );
});

Deno.test("E/D3a: start_flow starts the setup from the host's own words (facts are the owner's, prefills are hints)", async () => {
  const store = new MemoryStore(OWNER);
  const words = "Plan a paid trip to Lisbon at ₦50,000 with deposits";
  const decision = await startFlowFromTool({
    ...turnArgs(store, freshWorld(), words),
    call: {
      flow_key: "create_trip",
      intent_text: "a free trip", // the model's paraphrase is not a fact
      prefills: { paid: false, title: "Lisbon" },
    },
  });
  assertEquals(decision.kind, "reply");
  const run = await current(store);
  assertEquals(run.flow_key, "create_trip");
  assertEquals(run.answers.intent_text, { value: words, source: "owner" });
  assertEquals(run.answers.paid, { value: true, source: "owner" });
  assertEquals(run.answers.installments, { value: true, source: "owner" });
  assertEquals(run.answers.model_prefills?.source, "engine");
});

Deno.test("E/D3a: start_flow never forks a live setup; an unknown key or the engine off starts nothing", async () => {
  const store = new MemoryStore(OWNER);
  const world = freshWorld({ roleOk: false });
  await runFlowStep({ store, probes: probesFor(world) }, {
    run: await startEventRun(store, "Create an event"),
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  const again = await startFlowFromTool({
    ...turnArgs(store, world, "plan a trip"),
    call: { flow_key: "create_trip" },
  });
  if (again.kind !== "reply") throw new Error(again.kind);
  assertMatch(again.text, /already have a setup open/);
  assertEquals(store.runs.size, 1);

  const empty = new MemoryStore(OWNER);
  assertEquals(
    (await startFlowFromTool({
      ...turnArgs(empty, freshWorld(), "x"),
      call: { flow_key: "nope" },
    })).kind,
    "none",
  );
  assertEquals(
    (await startFlowFromTool({
      ...turnArgs(empty, freshWorld(), "Create an event"),
      engineEnabled: false,
      call: { flow_key: "create_event" },
    })).kind,
    "none",
  );
  assertEquals(empty.runs.size, 0);
});

Deno.test("E/D3a: in the loop, start_flow is flow control — never a write proposal, never executed as a tool", async () => {
  let executed = 0;
  const result = await runAgentLoop({
    callModel: () =>
      Promise.resolve({
        toolCalls: [{
          name: ARI_START_FLOW_TOOL,
          args: { flow_key: "create_event" },
        }],
      }),
    classifyTool: (call) =>
      call.name === ARI_START_FLOW_TOOL && parseStartFlowArgs(call.args)
        ? "flow"
        : "write",
    executeTool: () => {
      executed += 1;
      return Promise.resolve(null);
    },
  });
  assertEquals(result.kind, "flow_start");
  assertEquals(executed, 0);
  // A write is still a proposal (the confirmation card path is unchanged).
  const write = await runAgentLoop({
    callModel: () =>
      Promise.resolve({
        toolCalls: [{ name: "create_discount", args: { code: "FAVY10" } }],
      }),
    classifyTool: () => "write",
    executeTool: () => Promise.resolve(null),
  });
  assertEquals(write.kind, "proposal");
});

// ── flow_action is primary inside an open setup ─────────────────────────────

async function openEventCard(store: MemoryStore) {
  const world = freshWorld({ roleOk: false });
  await runFlowStep({ store, probes: probesFor(world) }, {
    run: await startEventRun(store, "Create an event"),
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  return world;
}

Deno.test("E1: flow_action park serves words the keyword re-read cannot hear as a request", async () => {
  const store = new MemoryStore(OWNER);
  const world = await openEventCard(store);
  // No keyword request in these words: the Wave A rules would refuse once.
  const words = "honestly the influencer thing matters more right now";
  const fallback = await decideFlowTurn(turnArgs(store, world, words));
  assertEquals(fallback.kind, "reply", "the hint route keeps Wave A's rules");
  assertEquals((await current(store)).status, "awaiting_handoff");
  // A fresh card (no remembered words), the model's read says park.
  const store2 = new MemoryStore(OWNER);
  const world2 = await openEventCard(store2);
  const parked = await decideFlowTurn({
    ...turnArgs(store2, world2, words),
    route: { source: "model", readiness: null, flowAction: "park" },
  });
  assertEquals(parked.kind, "parked");
  assertEquals((await current(store2)).status, "parked");
});

Deno.test("E1: flow_action answer takes request-shaped words as a form card's answer", async () => {
  // The v2 event setup's first card on a ready brand is the title form.
  const words = "Promo Night 2026";
  const heuristic = new MemoryStore(OWNER);
  const world = freshWorld({ roleOk: true });
  await startFlowFromTool({
    ...turnArgs(heuristic, world, "Create an event"),
    call: { flow_key: "create_event" },
  });
  const card = (await current(heuristic)).current_artefact;
  assertEquals(card?.answer_mode, "form");
  const parkedByRules = await decideFlowTurn(
    turnArgs(heuristic, world, words),
  );
  assertEquals(parkedByRules.kind, "parked", "fallback: Wave A parks it");
  const read = new MemoryStore(OWNER);
  await startFlowFromTool({
    ...turnArgs(read, world, "Create an event"),
    call: { flow_key: "create_event" },
  });
  const answered = await decideFlowTurn({
    ...turnArgs(read, world, words),
    route: { source: "model", readiness: null, flowAction: "answer" },
  });
  assertNotEquals(answered.kind, "parked");
  const run = await current(read);
  assertEquals(run.step_states[card!.step_key]?.state, "done");
});

Deno.test("E1: flow_action cancel, side and answer; the heuristic stays the fallback", async () => {
  const store = new MemoryStore(OWNER);
  const world = await openEventCard(store);
  // side: the run is untouched and the model answers.
  const side = await decideFlowTurn({
    ...turnArgs(store, world, "ok so what is this card about"),
    route: { source: "model", readiness: null, flowAction: "side" },
  });
  assertEquals(side.kind, "none");
  const live = await current(store);
  assertEquals(live.status, "awaiting_handoff");
  assert(live.current_artefact);
  // answer: the FAVY10 sentence is NOT parked when the read calls it an answer
  // (the heuristic alone would park it).
  const store2 = new MemoryStore(OWNER);
  const world2 = await openEventCard(store2);
  const heuristic = await decideFlowTurn(
    turnArgs(store2, world2, HOST_FAVY10_SENTENCE),
  );
  assertEquals(heuristic.kind, "parked", "fallback: Wave A parks it");
  const store3 = new MemoryStore(OWNER);
  const world3 = await openEventCard(store3);
  const answered = await decideFlowTurn({
    ...turnArgs(store3, world3, HOST_FAVY10_SENTENCE),
    route: { source: "model", readiness: null, flowAction: "answer" },
  });
  assertEquals(answered.kind, "reply");
  assertEquals((await current(store3)).status, "awaiting_handoff");
  // cancel: "I'm done with this" is no stop keyword; the read cancels it.
  const cancelled = await decideFlowTurn({
    ...turnArgs(store, world, "I'm done with this for today"),
    route: { source: "model", readiness: null, flowAction: "cancel" },
  });
  if (cancelled.kind !== "reply") throw new Error(cancelled.kind);
  assertMatch(cancelled.text, /I've stopped here/);
  assertEquals(
    [...store.runs.values()][0].status,
    "cancelled",
  );
});

Deno.test("E1: flow_action resume brings a parked setup back from typed words", async () => {
  const store = new MemoryStore(OWNER);
  const world = await openEventCard(store);
  await decideFlowTurn(turnArgs(store, world, HOST_FAVY10_SENTENCE));
  assertEquals((await current(store)).status, "parked");
  // Fallback: typed words never resume (only the Resume card did).
  const typed = "ok let's carry on with my event now";
  assertEquals(
    (await decideFlowTurn(turnArgs(store, world, typed))).kind,
    "none",
  );
  assertEquals((await current(store)).status, "parked");
  const resumed = await decideFlowTurn({
    ...turnArgs(store, world, typed),
    route: { source: "model", readiness: null, resumeParked: true },
  });
  if (resumed.kind !== "reply") throw new Error(resumed.kind);
  assertMatch(resumed.text, /back to your event setup/);
  assertNotMatch((await current(store)).status, /parked/);
});

Deno.test("E1: readiness answers come only when the route says readiness", async () => {
  const question =
    "What does my brand still need before I can sell paid tickets?";
  assertEquals(flowRouteFromHints(question).readiness, "publish_paid");
  const world = freshWorld();
  const rpcClient = {
    rpc: (_name: string, args: { p_action: ReadinessAction | null }) =>
      Promise.resolve({
        data: readinessFor(world, args.p_action),
        error: null,
      }),
  } as unknown as SupabaseClient;
  const store = new MemoryStore(OWNER);
  const offRoute = await decideFlowTurn({
    ...turnArgs(store, world, question),
    userClient: rpcClient,
    route: { source: "model", readiness: null },
  });
  assertEquals(offRoute.kind, "none", "the read said not a readiness question");
  // The read hears a readiness question the keyword rule misses.
  const asked = "Is my brand ready to publish?";
  assertEquals(flowRouteFromHints(asked).readiness, null);
  const answered = await decideFlowTurn({
    ...turnArgs(store, world, asked),
    userClient: rpcClient,
    route: { source: "model", readiness: "publish_free" },
  });
  if (answered.kind !== "reply") throw new Error(answered.kind);
  assertEquals(answered.classification, "readiness_answer");
});

// ── agent-chat wiring ──────────────────────────────────────────────────────

Deno.test("E/D3a: agent-chat has no pre-model setup start or keyword planner entry", () => {
  const chat = read("supabase/functions/agent-chat/index.ts");
  const edge = read("supabase/functions/_shared/ariFlows/edge.ts");
  const code = (src: string) => src.replace(/\/\/[^\n]*/g, "");
  // The keyword starts are gone from the engine's pre-model say.
  // #3355 ship-prep: origin/main's typed starts survive only on the rollout
  // switch's off path (legacyTypedStart), behind args.legacy.
  const decide = code(edge.slice(
    edge.indexOf("export async function decideFlowTurn("),
    edge.indexOf("async function legacyTypedStart("),
  ));
  assertNotMatch(decide, /classifyOfferingIntent\(|isContactImportIntent\(/);
  assertNotMatch(decide, /store\.start\(/);
  assertMatch(
    decide,
    /if \(!args\.legacy\) return \{ kind: "none" \};\s*return await legacyTypedStart\(args, store, deps\);/,
  );
  // agent-chat: no keyword planner entry, no typed Website start (on path).
  assertEquals(
    [...code(chat).matchAll(/isCreateEventPlanningRequest\(/g)].length,
    1,
  );
  assertMatch(
    chat,
    /const eventPlannerRequest = understandFirst\s*\? turnRoute\.planner\s*: isCreateEventPlanningRequest\(semanticMessage\);/,
  );
  assertEquals([...code(chat).matchAll(/isWebsiteSetupRequest\(/g)].length, 1);
  assertMatch(
    chat,
    /websiteSetup: body\.workflow_context === "website_setup" \|\|\s*\(!understandFirst && isWebsiteSetupRequest\(semanticMessage\)\),/,
  );
  assertMatch(chat, /\(activeEventPlan \|\| eventPlannerRequest\)/);
  assertMatch(chat, /route: understandFirst\s*\? turnRoute\.flow\s*:/);
  // start_flow is offered, classified as flow, and handled by the engine.
  assertMatch(chat, /\.\.\.startFlowDeclarations,/);
  assertMatch(chat, /call\.name === ARI_START_FLOW_TOOL/);
  assertMatch(chat, /loopResult\.kind === "flow_start"/);
  assertMatch(chat, /await startFlowFromTool\(\{/);
  // The legacy single-call path can start one too.
  assertMatch(chat, /gemini\.toolCall\?\.name === ARI_START_FLOW_TOOL/);
});
