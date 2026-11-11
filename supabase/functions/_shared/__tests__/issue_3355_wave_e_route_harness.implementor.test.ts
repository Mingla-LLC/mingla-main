// Issue #3355 Wave E (E1, E2) — the deterministic route harness.
//
// A table of real-shaped host messages (this morning's Lagos thread, the
// #3355 body's examples and the everyday asks around them). Each row runs
// twice through the shipped route code:
//   1. with the intent read stubbed to a plausible Flash read — every row
//      must take the expected route (0 misroutes);
//   2. with the intent read failing — the classifier hints route (today's
//      behaviour); the misroute rate is measured and ratcheted, and printed
//      for the Wave E report.
// Rows with an open setup are driven through decideFlowTurn on a live card
// (the real runner), so "park / cancel / answer / side" are outcomes, not
// labels. Live-model evals of the same table are Wave F.
//
// MINGLA-INVARIANT: I-ARI-ROUTE-HARNESS | issue #3355 | Every row of the Wave E route table takes its expected route with the stubbed intent read, and the hint-only fallback never misroutes more rows than the recorded ratchet.
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_wave_e_route_harness.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AGENT_TOOLS } from "../agentTools.ts";
import {
  ariDeterministicSafetyReply,
  inferAriToolsets,
} from "../agentToolsets.ts";
import {
  ariOpenFlowView,
  collectAriIntentHints,
  readAriIntent,
  routeAriTurn,
} from "../ariIntentRead.ts";
import { readFlowRequest } from "../ariFlows/requestRead.ts";
import { decideFlowTurn } from "../ariFlows/edge.ts";
import { runFlowStep } from "../ariFlows/runner.ts";
import {
  CHAT,
  current,
  freshWorld,
  HOST_FAVY10_SENTENCE,
  HOST_INFLUENCER_SENTENCE,
  MemoryStore,
  OWNER,
  probesFor,
  startEventRun,
  turnArgs,
} from "./_issue3355WaveEFlowWorld.ts";

type Open = "none" | "live" | "parked";
interface Row {
  text: string;
  open?: Open;
  /** start:<flow> | agent | agent:<toolset> | readiness | flow:<action> | safety */
  expect: string;
  read: Record<string, unknown>;
}

const tool = (target: string | null, extra: Record<string, unknown> = {}) => ({
  intent: "tool",
  target,
  confidence: 0.9,
  stated_values: {},
  ...extra,
});
const flow = (target: string) => ({
  intent: "flow",
  target,
  confidence: 0.9,
  stated_values: {},
});
const question = (target: string | null = null) => ({
  intent: "question",
  target,
  confidence: 0.85,
  stated_values: {},
});
const chat = {
  intent: "chat",
  target: null,
  confidence: 0.9,
  stated_values: {},
};
const action = (
  intent: string,
  flowAction?: string,
  confidence = 0.9,
) => ({
  intent,
  target: null,
  confidence,
  stated_values: {},
  ...(flowAction ? { flow_action: flowAction } : {}),
});

export const ROUTE_TABLE: Row[] = [
  // ── This morning's Lagos host thread (2026-11-10) ──
  {
    text: HOST_INFLUENCER_SENTENCE,
    expect: "agent:marketing",
    read: tool("create_discount"),
  },
  {
    text: HOST_FAVY10_SENTENCE,
    expect: "agent:marketing",
    read: tool("create_discount", {
      stated_values: { code: "FAVY10", percent_off: 10, ends_on: "2026-12-19" },
    }),
  },
  {
    text: HOST_FAVY10_SENTENCE,
    open: "live",
    expect: "flow:park",
    read: action("tool", "park", 0.95),
  },
  {
    text:
      "Why does it keep asking me about my tagline? I just want the discount code",
    open: "live",
    expect: "flow:park",
    read: action("tool", "park"),
  },
  {
    text: "Create the codes GIRLSTRIPLAGOS and FFBTSCOM10, 10% off each",
    expect: "agent:marketing",
    read: tool("create_discount"),
  },
  // ── #3355 body examples ──
  {
    text: "I want to upload my customer list",
    expect: "start:import_contacts",
    read: flow("import_contacts"),
  },
  {
    text: "Import my contacts from this spreadsheet",
    expect: "start:import_contacts",
    read: flow("import_contacts"),
  },
  {
    text: "Can you create a website for my brand?",
    expect: "start:website_setup",
    read: flow("website_setup"),
  },
  {
    text: "Start Website setup",
    expect: "start:website_setup",
    read: flow("website_setup"),
  },
  {
    text: "Set up my website and publish it",
    expect: "start:website_setup",
    read: flow("website_setup"),
  },
  {
    text: "Create an event next Friday at 8pm",
    expect: "start:create_event",
    read: flow("create_event"),
  },
  {
    text: "Schedule an event called Seth's Party for next Friday at 8pm",
    expect: "start:create_event",
    read: flow("create_event"),
  },
  {
    text: "Throw a party on the 20th with paid tickets at ₦5,000",
    expect: "start:create_event",
    read: flow("create_event"),
  },
  {
    text: "I want to plan a trip to Lisbon in March",
    expect: "start:create_trip",
    read: flow("create_trip"),
  },
  {
    text: "Add a venue",
    expect: "start:create_venue",
    read: flow("create_venue"),
  },
  {
    text: "Set up a stay at our venue",
    expect: "start:create_stay",
    read: flow("create_stay"),
  },
  {
    text: "Make a new cooking experience for Saturdays",
    expect: "start:create_experience",
    read: flow("create_experience"),
  },
  // ── Readiness ──
  {
    text: "What does my brand still need before I can sell paid tickets?",
    expect: "readiness",
    read: question("readiness"),
  },
  {
    text: "Is my brand ready to publish?",
    expect: "readiness",
    read: question("readiness"),
  },
  {
    text: "What's missing before I can get paid out to my bank?",
    expect: "readiness",
    read: question("readiness"),
  },
  // ── Discount codes, ticket tiers, refunds, payouts ──
  {
    text: "Create a promo code for the party",
    expect: "agent:marketing",
    read: tool("create_discount"),
  },
  {
    text: "Create discount codes for influencers on my trip",
    expect: "agent:marketing",
    read: tool("create_discount"),
  },
  {
    text: "List my discount codes",
    expect: "agent:marketing",
    read: tool("list_discounts"),
  },
  {
    text: "End the FAVY10 code today",
    expect: "agent:marketing",
    read: tool("end_discount"),
  },
  {
    text: "Add a VIP ticket tier at ₦20,000 for Saturday's event",
    expect: "agent:listings",
    read: tool("upsert_ticket_tier"),
  },
  {
    text: "Set up ticket tiers for my event: early bird and regular",
    expect: "agent:listings",
    read: tool("upsert_ticket_tier"),
  },
  {
    text: "Refund the order from Ada for the brunch",
    expect: "agent:money",
    read: tool("refund_order"),
  },
  {
    text: "Why is my payout still pending?",
    expect: "agent:money",
    read: tool("get_payout_status"),
  },
  // ── Everyday asks ──
  {
    text: "How do I create discount codes?",
    expect: "agent",
    read: question(),
  },
  {
    text: "How do I create an event?",
    expect: "agent",
    read: question(),
  },
  { text: "Thanks!", expect: "agent", read: chat },
  { text: "hello", expect: "agent", read: chat },
  { text: "Not now", expect: "agent", read: chat },
  {
    text: "Send a blast to everyone who came last month",
    expect: "agent:marketing",
    read: tool("draft_campaign"),
  },
  {
    text: "Invite Tolu to my team as a scanner",
    expect: "agent:people",
    read: tool("invite_scanner"),
  },
  {
    text: "Show me my events",
    expect: "agent:listings",
    read: tool("list_events"),
  },
  // ── Inside an open setup ──
  { text: "stop", open: "live", expect: "flow:cancel", read: action("stop") },
  {
    text: "never mind, cancel this",
    open: "live",
    expect: "flow:cancel",
    read: action("stop", "cancel"),
  },
  {
    text: "I'm done with this setup for today",
    open: "live",
    expect: "flow:cancel",
    read: action("stop", "cancel", 0.85),
  },
  {
    text: "I've done it",
    open: "live",
    expect: "flow:answer",
    read: action("flow_answer", "answer"),
  },
  {
    text: "what does this step mean?",
    open: "live",
    expect: "flow:side",
    read: question(),
  },
  {
    text: "How much does Mingla charge per ticket?",
    open: "live",
    expect: "flow:side",
    read: question(),
  },
  {
    text: "Can you also make a discount code FAVY10 for 10% off?",
    open: "live",
    expect: "flow:park",
    read: action("tool", "park"),
  },
  {
    text: "Refund Ada's ticket for last week's brunch",
    open: "live",
    expect: "flow:park",
    read: action("tool", "park"),
  },
  {
    text: "honestly the influencer codes matter more right now",
    open: "live",
    expect: "flow:park",
    read: action("tool", "park"),
  },
  {
    text: "I just want the influencer codes sorted first",
    open: "live",
    expect: "flow:park",
    read: tool("create_discount"),
  },
  {
    text: "hmm ok, and the tagline thing is optional right",
    open: "live",
    expect: "flow:side",
    read: question(),
  },
  // ── A parked setup ──
  {
    text: "ok let's carry on with the event setup",
    open: "parked",
    expect: "flow:resume",
    read: action("chat", "resume"),
  },
  {
    text: "Create a promo code for the party",
    open: "parked",
    expect: "agent:marketing",
    read: tool("create_discount"),
  },
  // ── Safety (never routed by the read) ──
  {
    text: "Here are my bank details: account number 0123456789",
    expect: "safety",
    read: tool("set_brand_payout_country"),
  },
  {
    text: "Here are my bank details: account number 0123456789",
    open: "live",
    expect: "safety",
    read: action("flow_answer", "answer"),
  },
];

/** Recorded fallback misroutes (the ratchet; lower it when hints improve). */
export const FALLBACK_MISROUTE_RATCHET = 13;

const TOOL_NAMES = AGENT_TOOLS.map((item) => item.name);

async function worldFor(open: Open) {
  const store = new MemoryStore(OWNER);
  const world = freshWorld({ roleOk: false });
  if (open !== "none") {
    await runFlowStep({ store, probes: probesFor(world) }, {
      run: await startEventRun(store, "Create an event"),
      trigger: "turn",
      brandName: "Favy Lagos",
    });
    if (open === "parked") {
      await decideFlowTurn(turnArgs(store, world, HOST_FAVY10_SENTENCE));
    }
  }
  return { store, world };
}

/** The route class one path takes for a row. */
async function routeClass(row: Row, useModel: boolean): Promise<string> {
  const open = row.open ?? "none";
  const { store, world } = await worldFor(open);
  const openFlow = ariOpenFlowView(
    open === "none" ? null : await store.getForConversation(CHAT),
  );
  const hints = collectAriIntentHints(row.text, openFlow);
  const result = await readAriIntent({
    input: {
      message: row.text,
      snapshotText: "Brand: Favy Lagos",
      openFlow,
      recentOwnerTurns: [],
      hints,
      toolNames: TOOL_NAMES,
    },
    call: () =>
      useModel
        ? Promise.resolve(row.read)
        : Promise.reject(new Error("model down")),
  });
  if (useModel) assertEquals(result.source, "model", row.text);
  const route = routeAriTurn({
    result,
    hints,
    openFlow,
    engineOn: true,
    message: row.text,
    safetyReply: ariDeterministicSafetyReply(row.text) !== null,
  });
  if (route.label === "safety") return "safety";
  if (route.label === "readiness") return "readiness";

  // An open setup: the real runner decides, with the route's flow part.
  if (open !== "none") {
    const before = await current(store);
    const decision = await decideFlowTurn({
      ...turnArgs(store, world, row.text),
      route: route.flow,
    });
    const after = await current(store);
    if (decision.kind === "parked") return "flow:park";
    if (open === "parked" && after.status !== "parked") return "flow:resume";
    if (after.status === "cancelled") return "flow:cancel";
    if (decision.kind === "reply") {
      return /didn't catch that/.test(decision.text)
        ? "flow:refused"
        : "flow:answer";
    }
    if (decision.kind === "none" && open === "live") {
      assertEquals(after.revision, before.revision, row.text);
      return "flow:side";
    }
  }
  if (route.startFlowHint) return `start:${route.startFlowHint}`;
  if (route.label.startsWith("flow:")) return route.label;
  // The agent loop: the toolsets agent-chat would select.
  const toolsets = new Set([
    ...inferAriToolsets(row.text, [
      readFlowRequest(row.text),
      ...route.toolsetHints,
    ]),
    ...route.toolsets,
  ]);
  const wanted = row.expect.startsWith("agent:")
    ? row.expect.slice("agent:".length)
    : null;
  if (wanted) return toolsets.has(wanted as never) ? row.expect : `agent`;
  return "agent";
}

Deno.test("E harness: the table is real-shaped and large enough", () => {
  assert(ROUTE_TABLE.length >= 40, `${ROUTE_TABLE.length} rows`);
  const texts = ROUTE_TABLE.map((row) => row.text);
  assert(texts.includes(HOST_INFLUENCER_SENTENCE));
  assert(texts.includes(HOST_FAVY10_SENTENCE));
  for (
    const needle of [
      /customer list/,
      /website/i,
      /event/,
      /trip/,
      /venue/,
      /readiness|still need|ready to/,
      /discount|promo/,
      /ticket tier/,
      /[Rr]efund/,
      /payout/,
      /^stop$/,
      /^Not now$/,
    ]
  ) {
    assert(texts.some((text) => needle.test(text)), String(needle));
  }
});

Deno.test("E harness: with the intent read, every row takes its expected route", async () => {
  const misses: string[] = [];
  for (const row of ROUTE_TABLE) {
    const got = await routeClass(row, true);
    if (got !== row.expect) {
      misses.push(
        `${row.open ?? "none"} | ${row.text} → ${got} (want ${row.expect})`,
      );
    }
  }
  assertEquals(misses, []);
});

Deno.test("E harness: with the intent read failing, the hint fallback misroute rate is measured and ratcheted", async () => {
  const misses: string[] = [];
  for (const row of ROUTE_TABLE) {
    const got = await routeClass(row, false);
    if (got !== row.expect) {
      misses.push(
        `${row.open ?? "none"} | ${row.text} → ${got} (want ${row.expect})`,
      );
    }
  }
  const rate = (misses.length / ROUTE_TABLE.length * 100).toFixed(1);
  console.log(
    `[wave-e harness] fallback misroutes: ${misses.length}/${ROUTE_TABLE.length} (${rate}%)\n${
      misses.map((miss) => `  - ${miss}`).join("\n")
    }`,
  );
  assert(
    misses.length <= FALLBACK_MISROUTE_RATCHET,
    `fallback misroutes rose to ${misses.length} (ratchet ${FALLBACK_MISROUTE_RATCHET})`,
  );
});
