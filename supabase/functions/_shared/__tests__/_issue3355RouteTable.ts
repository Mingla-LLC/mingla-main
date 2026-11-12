// Issue #3355 Wave E/F — the route table and the route-class reader, shared
// by the deterministic route harness (stub read) and the Wave F live route
// eval (scripts/ari/eval/replay/route_table_live.ts, real Flash read).
// Not a test file.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AGENT_TOOLS } from "../agentTools.ts";
import {
  ariDeterministicSafetyReply,
  inferAriToolsets,
} from "../agentToolsets.ts";
import {
  type AriIntentModelCall,
  type AriIntentResult,
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

/** The last intent result routeClass saw (the live eval reports it). */
export let lastIntentResult: AriIntentResult | null = null;

/** A stub model call that returns the row's plausible Flash read. */
export const stubRead = (row: Row): AriIntentModelCall => () =>
  Promise.resolve(row.read);

export type Open = "none" | "live" | "parked";
export interface Row {
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
export async function routeClass(
  row: Row,
  call: AriIntentModelCall | null,
  snapshotText = "Brand: Favy Lagos",
): Promise<string> {
  const open = row.open ?? "none";
  const { store, world } = await worldFor(open);
  const openFlow = ariOpenFlowView(
    open === "none" ? null : await store.getForConversation(CHAT),
  );
  const hints = collectAriIntentHints(row.text, openFlow);
  const result = await readAriIntent({
    input: {
      message: row.text,
      snapshotText,
      openFlow,
      recentOwnerTurns: [],
      hints,
      toolNames: TOOL_NAMES,
    },
    call: call ?? (() => Promise.reject(new Error("model down"))),
  });
  lastIntentResult = result;
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
