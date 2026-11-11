// Issue #3355 Wave F — closing Wave E's open ends, plus the fixes the live
// evals found.
//
//   (a) A new setup started while one is parked closes the parked one and
//       says so in the same reply; the old Resume card then answers "that
//       was closed" with the setup that is open now, and never acts.
//   (b) A setup whose gates pass hands the owner's request back (delegate):
//       inside the agent loop the model serves it in the same turn, instead
//       of "I couldn't start that setup".
//   (c) The escalated turn's own reply gaps are logged, and "Ask the Mingla
//       team" is offered on the single-call path too.
//   Live-eval fixes: a planned guide entry that an Ari tool serves is read as
//   available through that tool; a stated end day written in UTC by the
//   model is bound to the day's end in the brand's zone; a reply that copies
//   the repaired tool-call marker is sent back to the model.
//
// MINGLA-INVARIANT: I-ARI-NO-STALE-RESUME | issue #3355 | Starting a setup while one is parked tells the host the parked one was closed, and a Resume tap on a closed run never acts: it says so and shows the setup that is open now.
// MINGLA-INVARIANT: I-ARI-FLOW-HANDOFF-SAME-TURN | issue #3355 | When start_flow's setup hands the owner's request back (delegate) inside the agent loop, the loop continues and serves it in the same turn.
// MINGLA-INVARIANT: I-ARI-ESCALATED-REPLY-GAPS-LOGGED | issue #3355 | The reply of an escalated turn that ends in the Ask-the-Mingla-team card has its own gap signals recorded, and the offer is reachable on the single-call path.
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_wave_f_open_ends.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { runAgentLoop } from "../agentLoop.ts";
import {
  decideFlowTurn,
  parkedClosedNotice,
  staleFlowAnswer,
  startFlowFromTool,
} from "../ariFlows/edge.ts";
import { CHAT } from "./_issue3355WaveEFlowWorld.ts";
import { runFlowStep } from "../ariFlows/runner.ts";
import {
  ARI_START_FLOW_TOOL,
  ariOfferingDetourIssue,
  ariSetupSkippedIssue,
  ariSetupTextIssue,
} from "../ariFlows/startFlowTool.ts";
import { LIST_QUESTION } from "../ariFlows/contactImport.ts";
import {
  ariGuideReadStatus,
  ariToolsForGuideKey,
} from "../agentAri10xTools.ts";
import {
  announcesWriteWithoutCall,
  checkStatedSlots,
  preserveStatedSlots,
} from "../ariTruthGuards.ts";
import {
  HISTORY_CALL_NOTE,
  isPseudoToolCallText,
  repairGeminiContents,
} from "../agentGeminiContents.ts";
import {
  ariRequestSpecifics,
  detectAriRepeat,
  priorOwnerServedFromRows,
} from "../ariGaps.ts";
import {
  current,
  freshWorld,
  HOST_FAVY10_SENTENCE,
  MemoryStore,
  OWNER,
  probesFor,
  startEventRun,
  turnArgs,
} from "./_issue3355WaveEFlowWorld.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const AGENT_CHAT = "supabase/functions/agent-chat/index.ts";

async function parkedEventSetup() {
  const store = new MemoryStore(OWNER);
  const world = freshWorld({ roleOk: false });
  await runFlowStep({ store, probes: probesFor(world) }, {
    run: await startEventRun(store, "Create an event"),
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  const parked = await decideFlowTurn(
    turnArgs(store, world, HOST_FAVY10_SENTENCE),
  );
  if (parked.kind !== "parked") throw new Error(parked.kind);
  return { store, world, resume: parked.resume };
}

// ── (a) no stale Resume card ────────────────────────────────────────────────

Deno.test("F(a): a new setup started while one is parked says the parked one was closed", async () => {
  const { store, world } = await parkedEventSetup();
  const parkedRun = await current(store);
  assertEquals(parkedRun.status, "parked");
  const started = await startFlowFromTool({
    ...turnArgs(store, world, "I want to plan a trip to Lisbon in March"),
    call: { flow_key: "create_trip" },
  });
  if (started.kind !== "reply") throw new Error(started.kind);
  assert(
    started.text.startsWith(parkedClosedNotice("event setup")),
    started.text,
  );
  assertEquals(store.runs.get(parkedRun.id)?.status, "cancelled");
  assertEquals((await current(store)).flow_key, "create_trip");
});

Deno.test("F(a): no parked run, no notice", async () => {
  const store = new MemoryStore(OWNER);
  const started = await startFlowFromTool({
    ...turnArgs(store, freshWorld(), "I want to plan a trip to Lisbon"),
    call: { flow_key: "create_trip" },
  });
  if (started.kind !== "reply") throw new Error(started.kind);
  assertNotMatch(started.text, /closed your paused/);
});

Deno.test("F(a): the old Resume card says it was closed, shows the open setup and never acts", async () => {
  const { store, world, resume } = await parkedEventSetup();
  await startFlowFromTool({
    ...turnArgs(store, world, "I want to plan a trip to Lisbon in March"),
    call: { flow_key: "create_trip" },
  });
  const live = await current(store);
  const before = structuredClone(live);
  const tapped = await decideFlowTurn(
    turnArgs(store, world, "Resume event setup", {
      run_id: resume.run_id,
      step_key: resume.step_key,
      question_id: resume.question_id,
      choice_id: "resume",
      display_text: "Resume event setup",
    }),
  );
  if (tapped.kind !== "reply") throw new Error(tapped.kind);
  assertMatch(tapped.text, /^That event setup was closed/);
  assertEquals(tapped.classification, "flow_engine_resume_closed");
  assertEquals(
    tapped.artefact?.artefact_id,
    live.current_artefact?.artefact_id,
  );
  const after = await current(store);
  assertEquals(after.revision, before.revision);
  assertEquals(after.answers, before.answers);
});

Deno.test("F(a): agent-chat's pre-claim check answers a closed Resume card in plain words", async () => {
  const { store, world, resume } = await parkedEventSetup();
  const answer = {
    run_id: resume.run_id,
    step_key: resume.step_key,
    question_id: resume.question_id,
    choice_id: "resume",
    display_text: "Resume event setup",
  };
  // While parked, the Resume card is current (not stale).
  assertEquals(
    await staleFlowAnswer({ store, conversationId: CHAT, answer }),
    null,
  );
  await startFlowFromTool({
    ...turnArgs(store, world, "I want to plan a trip to Lisbon in March"),
    call: { flow_key: "create_trip" },
  });
  const stale = await staleFlowAnswer({ store, conversationId: CHAT, answer });
  assertMatch(stale?.taken_over_text ?? "", /^That event setup was closed/);
  assertEquals(
    stale?.next?.artefact_id,
    (await current(store)).current_artefact?.artefact_id,
  );
});

// ── (b) a hand-off runs in the same turn ────────────────────────────────────

Deno.test("F(b): a delegated start_flow continues the loop, which serves the request in the same turn", async () => {
  const seen: string[] = [];
  let modelCalls = 0;
  const result = await runAgentLoop({
    callModel: (observations) => {
      modelCalls += 1;
      seen.push(observations.map((o) => o.tool).join(","));
      return Promise.resolve(
        modelCalls === 1
          ? {
            toolCalls: [{
              name: ARI_START_FLOW_TOOL,
              args: { flow_key: "create_trip" },
            }],
          }
          : {
            toolCalls: [{
              name: "create_trip",
              args: { title: "Lisbon in March" },
            }],
          },
      );
    },
    classifyTool: (call) =>
      call.name === ARI_START_FLOW_TOOL ? "flow" : "write",
    executeTool: () => Promise.resolve(null),
    resolveFlowStart: () =>
      Promise.resolve({ result: { status: "handed_off" } }),
  });
  assertEquals(result.kind, "proposal");
  if (result.kind !== "proposal") return;
  assertEquals(result.toolCall.name, "create_trip");
  assertEquals(seen, ["", ARI_START_FLOW_TOOL]);
  assertEquals(
    (result.observations[0].result as { status: string }).status,
    "handed_off",
  );
});

Deno.test("F(b): a setup's own card still ends the loop (stop), and no resolver keeps Wave E", async () => {
  for (
    const resolveFlowStart of [
      () => Promise.resolve("stop" as const),
      undefined,
    ]
  ) {
    const result = await runAgentLoop({
      callModel: () =>
        Promise.resolve({
          toolCalls: [{
            name: ARI_START_FLOW_TOOL,
            args: { flow_key: "create_event" },
          }],
        }),
      classifyTool: () => "flow",
      executeTool: () => Promise.resolve(null),
      ...(resolveFlowStart ? { resolveFlowStart } : {}),
    });
    assertEquals(result.kind, "flow_start");
  }
});

Deno.test("F(b): agent-chat wires the hand-off into the loop and refuses a second start", () => {
  const source = read(AGENT_CHAT);
  assertMatch(source, /resolveFlowStart: resolveModelFlowStart,/);
  assertMatch(
    source,
    /if \(decision\.kind !== "delegate"\) \{\s*modelFlowDecision = decision;\s*return "stop";/,
  );
  assertMatch(source, /code: "SETUP_ALREADY_HANDED_OFF"/);
  assertMatch(
    source,
    /const decision = modelFlowDecision \?\? await startModelFlow\(rawArgs\);/,
  );
});

// ── (c) escalation: reply gaps logged, single-call path offers the team ─────

Deno.test("F(c): the escalated turn records its own reply gaps before the Ask-the-team card", () => {
  const source = read(AGENT_CHAT);
  const offer = source.slice(
    source.indexOf("const offerAskTheTeam = async"),
    source.indexOf("// Load last N messages"),
  );
  assert(offer.length > 200, "offerAskTheTeam exists");
  const gaps = offer.indexOf("await recordAriTurnGaps({");
  const card = offer.indexOf("return await commitPendingTurn({");
  assert(gaps > 0 && card > gaps, "gaps are recorded, then the card commits");
  assertMatch(offer, /messageId: leadMessageId,/);
  assertMatch(offer, /replyText: offer\.replyText,/);
});

Deno.test("F(c): both the loop and the single-call path offer Ask the Mingla team", () => {
  const source = read(AGENT_CHAT);
  const uses = source.match(/await offerAskTheTeam\(\{/g) ?? [];
  assertEquals(uses.length, 2);
  const single = source.slice(
    source.indexOf("// Text response (no tool call)"),
  );
  assertMatch(
    single,
    /const offer = await offerAskTheTeam\(\{\s*replyText: answer,/,
  );
  assertMatch(single, /gapOwnerText: semanticMessage,/);
});

// ── Live-eval fixes ─────────────────────────────────────────────────────────

Deno.test("F live: a planned guide entry an Ari tool serves reads as available through that tool", () => {
  assert(
    ariToolsForGuideKey("events-discount-codes").includes("create_discount"),
  );
  const discounts = ariGuideReadStatus("Planned", "events-discount-codes");
  assertEquals(discounts.status, "available_through_ari");
  assertEquals(discounts.how_to_say, "offer_the_ari_tool");
  assert(discounts.ari_tools.includes("create_discount"));
  // Retired never upgrades; a planned entry with no tool stays planned.
  assertEquals(
    ariGuideReadStatus("Retired", "events-discount-codes").status,
    "retired",
  );
  assertEquals(
    ariGuideReadStatus("Planned", "no-such-feature").status,
    "planned",
  );
  assertEquals(
    ariGuideReadStatus("Live", "events-discount-codes").status,
    "live",
  );
});

Deno.test("F live: Flash's UTC end of 19 Dec binds to 23:59:59 Lagos; another day still asks", () => {
  const base = {
    toolName: "create_discount",
    schemaKeys: new Set(["code", "value_bps", "value_type", "ends_at"]),
    stated: {
      code: "FAVY10",
      value_bps: 1000,
      ends_on: { year: 2026, month: 12, day: 19 },
    },
    timezone: "Africa/Lagos",
  };
  const args = {
    code: "FAVY10",
    value_type: "percent",
    value_bps: 1000,
  };
  for (const ends of ["2026-12-19T23:59:59Z", "2026-12-19T23:59:59.000Z"]) {
    const ok = checkStatedSlots({
      ...base,
      toolArgs: { ...args, ends_at: ends },
    });
    if (ok.kind !== "ok") throw new Error(`asked for ${ends}`);
    assertEquals(ok.args.ends_at, "2026-12-19T22:59:59Z");
    assertEquals(ok.bound, ["ends_at"]);
  }
  const wrong = checkStatedSlots({
    ...base,
    toolArgs: { ...args, ends_at: "2026-12-25T22:59:59Z" },
  });
  assertEquals(wrong.kind, "ask");
});

Deno.test("F live: a reply that copies the tool-call marker is caught and sent back to the model", () => {
  assert(
    isPseudoToolCallText(
      '[mingla tool call name=get_operator_snapshot] {"":""}',
    ),
  );
  assert(isPseudoToolCallText("[mingla_tool_result name=list_events] {}"));
  assert(
    !isPseudoToolCallText(
      "I can set up discount codes for your influencers and marketers.",
    ),
  );
  assertMatch(
    read(AGENT_CHAT),
    /\(isPseudoToolCallText\(text\)\s*\?\s*\{\s*code: "TOOL_CALL_AS_TEXT"/,
  );
});

Deno.test("F live: a create proposal that skips the guided setup the read named is sent back once", () => {
  const issue = ariSetupSkippedIssue({
    startFlowHint: "create_event",
    startFlowAllowed: true,
    toolName: "create_event",
  });
  assertEquals(issue?.code, "USE_GUIDED_SETUP");
  assertMatch(issue?.message ?? "", /start_flow with flow_key create_event/);
  // Not offered, another tool, or no setup named: unchanged.
  for (
    const args of [
      {
        startFlowHint: "create_event",
        startFlowAllowed: false,
        toolName: "create_event",
      },
      {
        startFlowHint: "create_event",
        startFlowAllowed: true,
        toolName: "create_discount",
      },
      { startFlowHint: null, startFlowAllowed: true, toolName: "create_event" },
    ]
  ) assertEquals(ariSetupSkippedIssue(args), null);
  assertMatch(read(AGENT_CHAT), /if \(setupSkipped\) return setupSkipped;/);
  assertMatch(
    read(AGENT_CHAT),
    /const setupSkipped = ariSetupSkippedIssue\(\{\s*startFlowHint: turnRoute\.startFlowHint,\s*startFlowAllowed: startFlowAllowed && !modelFlowDelegated,/,
  );
});

Deno.test("F live: the contact-list card points to People → Import (the guide's steps)", () => {
  assertMatch(LIST_QUESTION, /open Blast, go to People and tap Import/);
});

Deno.test("F live: the same instant with an offset is stored in the canonical UTC form", () => {
  const ok = checkStatedSlots({
    toolName: "create_discount",
    schemaKeys: new Set(["code", "value_bps", "ends_at"]),
    stated: {
      ends_on: {
        year: 2026,
        month: 12,
        day: 19,
        words: "19th of December 2026",
      },
    },
    timezone: "Africa/Lagos",
    toolArgs: { code: "FAVY10", ends_at: "2026-12-19T23:59:59+01:00" },
  });
  if (ok.kind !== "ok") throw new Error("asked");
  assertEquals(ok.args.ends_at, "2026-12-19T22:59:59Z");
});

Deno.test("F live: the next code after a proposed one is a new request, not a repeat", () => {
  const prior = [HOST_FAVY10_SENTENCE];
  // Unserved (production: the event card came back) — a repeat.
  assertEquals(
    detectAriRepeat(
      "Create the codes GIRLSTRIPLAGOS and FFBTSCOM10, 10% off each",
      prior,
    ).how,
    "same_intent",
  );
  // Served with a card — a new request.
  assertEquals(
    detectAriRepeat(
      "Create the codes GIRLSTRIPLAGOS and FFBTSCOM10, 10% off each",
      prior,
      [true],
    ).repeated,
    false,
  );
  // The same words again always count.
  assertEquals(
    detectAriRepeat(HOST_FAVY10_SENTENCE, prior, [true]).how,
    "same_text",
  );
  // Rows → served flags (newest first; this turn excluded).
  assertEquals(
    priorOwnerServedFromRows([
      { id: "u3", role: "user", content: { text: "now" } },
      { id: "a2", role: "assistant", tool_calls: { pending_action_id: "p2" } },
      { id: "u2", role: "user", content: { text: "FAVY10 …" } },
      {
        id: "a1",
        role: "assistant",
        content: { text: "What's the event called?" },
      },
      { id: "u1", role: "user", content: { text: "influencer codes" } },
    ], "u3"),
    [true, false],
  );
  assertMatch(
    read(AGENT_CHAT),
    /classifyAriOwnerTurn\(\{\s*text: ownerTurnText,\s*priorOwnerTexts,\s*priorServed,\s*\}\)/,
  );
});

Deno.test("F live (S3): an offering proposal the read did not name goes back once", () => {
  const issue = ariOfferingDetourIssue({
    readSource: "model",
    targetTool: "create_discount",
    toolName: "create_event",
  });
  assertEquals(issue?.code, "REQUESTED_TOOL_MISMATCH");
  assertMatch(
    issue?.message ?? "",
    /asked for create_discount, not a new event/,
  );
  for (
    const args of [
      {
        readSource: "hints" as const,
        targetTool: "create_discount",
        toolName: "create_event",
      },
      {
        readSource: "model" as const,
        targetTool: null,
        toolName: "create_event",
      },
      {
        readSource: "model" as const,
        targetTool: "create_event",
        toolName: "create_event",
      },
      {
        readSource: "model" as const,
        targetTool: "create_discount",
        toolName: "create_discount",
      },
      {
        readSource: "model" as const,
        targetTool: "list_events",
        toolName: "upsert_ticket_tier",
      },
    ]
  ) assertEquals(ariOfferingDetourIssue(args), null, JSON.stringify(args));
  assertMatch(
    read(AGENT_CHAT),
    /const detour = ariOfferingDetourIssue\(\{\s*readSource: turnRoute\.source,\s*targetTool: turnRoute\.targetTool,\s*toolName: call\.name,\s*\}\);\s*if \(detour\) return detour;/,
  );
});

Deno.test("F live: an unsigned history call is replayed as plain words, never a call-shaped marker", () => {
  const { contents } = repairGeminiContents([
    { role: "user", parts: [{ text: "Create FAVY10" }] },
    {
      role: "model",
      parts: [{
        functionCall: { name: "create_discount", args: { code: "FAVY10" } },
      }],
    },
    { role: "user", parts: [{ text: "Create GIRLSTRIPLAGOS too" }] },
  ] as never);
  const text = JSON.stringify(contents);
  assert(text.includes(HISTORY_CALL_NOTE), text);
  assert(text.includes("create_discount") && text.includes("FAVY10"));
  assert(!/\[mingla_tool_call/.test(text), text);
  // A reply that copies the record is caught too.
  assert(isPseudoToolCallText(`${HISTORY_CALL_NOTE} create_discount with {}.`));
});

Deno.test("F live: details for a bare request answer it; they are not a repeat", () => {
  assertEquals(
    detectAriRepeat(HOST_FAVY10_SENTENCE, [
      "I want to create discount codes for influencers and marketers of my event",
    ]).repeated,
    false,
  );
  assertEquals(ariRequestSpecifics(HOST_FAVY10_SENTENCE).sort(), [
    "code:FAVY10",
    "day:19-dec",
    "pct:10",
  ]);
  // A bare ask again is still a repeat.
  assertEquals(
    detectAriRepeat("Please create discount codes for my influencers", [
      "I want to create discount codes for influencers and marketers of my event",
    ]).how,
    "same_intent",
  );
});

Deno.test("F live: a setup answered with the model's own questions goes back once", () => {
  assertEquals(
    ariSetupTextIssue({ startFlowHint: "create_event", startFlowAllowed: true })
      ?.code,
    "USE_GUIDED_SETUP",
  );
  assertEquals(
    ariSetupTextIssue({
      startFlowHint: "create_event",
      startFlowAllowed: false,
    }),
    null,
  );
  assertEquals(
    ariSetupTextIssue({
      startFlowHint: "website_setup",
      startFlowAllowed: true,
    }),
    null,
  );
  const source = read(AGENT_CHAT);
  assertMatch(
    source,
    /\(!modelFlowDelegated && !setupTextBounced &&\s*\(setupTextBounced = true\) &&\s*ariSetupTextIssue\(/,
  );
});

Deno.test("F live: a discount code the host never named is asked for, not proposed", async () => {
  const parameters = { properties: { code: {}, value_bps: {}, kind: {} } };
  const noClient = {} as never;
  const invented = await preserveStatedSlots({
    toolName: "create_discount",
    toolArgs: { code: "VIP10", kind: "code", value_bps: 1000 },
    parameters,
    ownerMessages: [
      "I want to create discount codes for influencers and marketers of my event",
    ],
    userClient: noClient,
  });
  assertEquals(invented.kind, "ask");
  const named = await preserveStatedSlots({
    toolName: "create_discount",
    toolArgs: { code: "FAVY10", kind: "code", value_bps: 1000 },
    parameters,
    ownerMessages: ['Use "FAVY10" for 10% off'],
    userClient: noClient,
  });
  assertEquals(named.kind, "ok");
  // An automatic discount has no code to name.
  assertEquals(
    (await preserveStatedSlots({
      toolName: "create_discount",
      toolArgs: { kind: "automatic", value_bps: 1000 },
      parameters,
      ownerMessages: ["10% off everything"],
      userClient: noClient,
    })).kind,
    "ok",
  );
});

Deno.test("F live: a reply that announces a proposal and makes none goes back once", () => {
  assert(
    announcesWriteWithoutCall(
      "I am about to propose two discount codes (GIRLSTRIPLAGOS and FFBTSCOM10). I will start with GIRLSTRIPLAGOS.",
    ),
  );
  assert(announcesWriteWithoutCall("Let me create that code for you."));
  for (
    const text of [
      "Tell me the code and how much off, and I'll set it up for you to approve.",
      "No, FFBTSCOM10 has not been created yet.",
      "I can set up discount codes for your influencers and marketers.",
    ]
  ) assert(!announcesWriteWithoutCall(text), text);
  assertMatch(
    read(AGENT_CHAT),
    /: announcesWriteWithoutCall\(text\) && !announcedWriteBounced &&\s*\(announcedWriteBounced = true\)\s*\? \{\s*code: "WRITE_PROPOSAL_REQUIRED"/,
  );
});
