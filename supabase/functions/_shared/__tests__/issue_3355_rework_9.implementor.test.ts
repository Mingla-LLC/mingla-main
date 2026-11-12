// #3355 rework 9 (Seth "fix first", after the local Host web demo
// 2026-11-12, ~/.mingla-private/3355/reports/ui-vet-setup.md):
//   1  a memory claim ("I remember that…", "I've saved that") with no
//      memory save this turn is corrected, whatever the judge did; a recall
//      a note backs is kept; the loop asks the model once for the tool.
//   2  "from now" / a past or bare-today start is "as soon as you confirm";
//      a stated future start is kept exactly.
//   4  "confirm with the host" to the host is dropped; "the host" is "you".
//   5  list_events says ticket types and tickets sold apart; a sold count in
//      a reply must match this turn's read.
//   6  a chat title comes from the first message: never generic, never a
//      duplicate of the host's other chats, contact details scrubbed.
//   7  a screen path the App Map and the Feature Guide do not know is
//      replaced by an honest pointer; real paths are untouched.
// (Fix 3, the chat-delete flow run, is the pg17 proof
// issue_3355_flow_runs_close_on_chat_delete.implementor.pg17.test.sql.)
// The judge and the database are stubbed.

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AriClaim,
  buildClaimEvidence,
  checkReplyClaims,
  type ClaimObservation,
  correctMemoryClaimWithoutSave,
  correctSoldCountClaims,
  hostAsksToRemember,
  MEMORY_NOT_SAVED_SENTENCE,
  memoryClaimWithoutSave,
  replyClaimsMemorySave,
  SOLD_NOT_READ_SENTENCE,
  writeRequestTrueState,
} from "../ariClaimCheck.ts";
import { preserveStatedSlots } from "../ariTruthGuards.ts";
import { hostMeansStartNow, withImmediateStart } from "../ariDiscountArgs.ts";
import { speakToHost } from "../ariOwnerCopy.ts";
import {
  labelEventTickets,
  soldCountFacts,
  withTicketsSold,
} from "../ariEventSales.ts";
import { ariTurnAgentTools, findAriTurnTool } from "../ariRolloutTurn.ts";
import { AGENT_TOOLS, findTool } from "../agentTools.ts";
import {
  ARI_CHAT_TITLE_VERSION,
  ariChatTitle,
  retitleAriChat,
} from "../ariChatTitle.ts";
import {
  ARI_UNKNOWN_PATH_SENTENCE,
  guardReplyNavigation,
  navigationPathsIn,
} from "../ariAppMap.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const EV = "c3c3c3c3-0000-4000-8000-000000003302";

const JUDGES: Array<readonly AriClaim[] | "fail"> = [
  [{
    quote: "I remember that",
    action: "saved",
    kind: "note",
    object: null,
  } as AriClaim],
  [],
  "fail",
];

async function check(a: {
  host: string;
  reply: string;
  judge: readonly AriClaim[] | "fail";
  observations?: ClaimObservation[];
  memoryNotes?: string[];
  soldCounts?: Array<{ title: string | null; sold: number | null }>;
}): Promise<string> {
  const out = await checkReplyClaims({
    text: a.reply,
    hostMessage: a.host,
    intent: "question",
    recentWrite: false,
    objects: [],
    evidence: buildClaimEvidence({
      states: [],
      observations: a.observations ?? [],
      isReadTool: (tool) => /^(?:list|get|search)_/.test(tool),
    }),
    askedWriteThisTurn: false,
    ...(a.memoryNotes ? { memoryNotes: a.memoryNotes } : {}),
    ...(a.soldCounts ? { soldCounts: a.soldCounts } : {}),
    call: () =>
      a.judge === "fail"
        ? Promise.reject(new Error("HTTP 503"))
        : Promise.resolve({ claims: a.judge }),
  });
  return out.text;
}

// ── Fix 1: memory claims ────────────────────────────────────────────────────

const REMEMBER_HOST =
  "Remember that our food events usually start 30 minutes after the advertised time.";
const DEMO_REPLY =
  "I remember that events always start 30 minutes late, so real start times should be advertised time plus 30 minutes in reminders. \n\nWhat would you like to do next?";

Deno.test("#3355 R9-1 the demo's false 'I remember that…' is corrected in every judge state", async () => {
  for (const judge of JUDGES) {
    const text = await check({
      host: REMEMBER_HOST,
      reply: DEMO_REPLY,
      judge,
    });
    assertMatch(text, /I haven't saved that yet — want me to remember it\?/);
    assertNotMatch(text, /I remember that/);
    assertMatch(text, /What would you like to do next\?/);
  }
});

Deno.test("#3355 R9-1 a successful remember_note this turn keeps the claim", async () => {
  for (const judge of JUDGES) {
    const text = await check({
      host: REMEMBER_HOST,
      reply: "Got it. I'll remember that your events start 30 minutes late.",
      judge,
      observations: [{
        tool: "remember_note",
        args: { scope: "brand", kind: "fact", text: "Events start late" },
        result: { id: "n1" },
      }],
    });
    assertMatch(text, /I'll remember that your events start 30 minutes late/);
  }
});

Deno.test("#3355 R9-1 a failed memory save is no receipt", async () => {
  const text = await check({
    host: REMEMBER_HOST,
    reply: "Noted! I've saved that for next time.",
    judge: "fail",
    observations: [{
      tool: "remember_note",
      args: {},
      error: { code: "RATE_LIMITED" },
    }],
  });
  assertEquals(text, MEMORY_NOT_SAVED_SENTENCE);
});

Deno.test("#3355 R9-1 a recall the host's notes back is never corrected", async () => {
  const told = await check({
    host: "When do our events usually start?",
    reply:
      "You told me earlier that your food events start 30 minutes after the advertised time.",
    judge: "fail",
  });
  assertMatch(told, /You told me earlier/);
  const backed = await check({
    host: REMEMBER_HOST,
    reply:
      "I remember that your food events usually start 30 minutes after the advertised time.",
    judge: [],
    memoryNotes: [
      "Our food events usually start 30 minutes after the advertised time.",
    ],
  });
  assertMatch(backed, /^I remember that your food events/);
});

Deno.test("#3355 R9-1 memory words: strong claims on any turn, weak ones only on a remember request", () => {
  assert(hostAsksToRemember("Please remember prices are in naira"));
  assert(hostAsksToRemember("Note that we never sell at the door"));
  assert(!hostAsksToRemember("Do you remember what I said about prices?"));
  assert(replyClaimsMemorySave("I'll keep that in mind.", "Prices are NGN"));
  assert(replyClaimsMemorySave("I've added that to my memory.", "ok"));
  assert(!replyClaimsMemorySave("I've saved the draft.", "Save my draft"));
  assert(replyClaimsMemorySave("I've saved that.", "Remember this"));
  assert(!replyClaimsMemorySave("I haven't saved that yet.", "Remember this"));
  assert(!replyClaimsMemorySave("Want me to remember that?", "x"));
  const out = correctMemoryClaimWithoutSave({
    text: "Noted, I'll remember it. Anything else?",
    hostMessage: "Remember that Fridays work best",
    evidence: [],
  });
  assertEquals(out.text, `${MEMORY_NOT_SAVED_SENTENCE} Anything else?`);
  // The write tie-break says the same words for a memory request.
  assertEquals(
    writeRequestTrueState("Remember that Fridays work best"),
    MEMORY_NOT_SAVED_SENTENCE,
  );
});

Deno.test("#3355 R9-1 the loop asks the model once for the memory tool", () => {
  const issue = memoryClaimWithoutSave({
    text: "I remember that events start late.",
    hostMessage: REMEMBER_HOST,
    observations: [],
  });
  assertEquals(issue?.code, "MEMORY_SAVE_REQUIRED");
  assertMatch(issue?.message ?? "", /remember_note/);
  assertEquals(
    memoryClaimWithoutSave({
      text: "I remember that events start late.",
      hostMessage: REMEMBER_HOST,
      observations: [{ tool: "remember_note", args: {}, result: {} }],
    }),
    null,
  );
  const source = Deno.readTextFileSync(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertMatch(
    source,
    /understandFirst && !memoryClaimBounced &&\s+\(memoryClaimIssue = memoryClaimWithoutSave\(/,
  );
});

// ── Fix 2: "from now" is as soon as the host confirms ──────────────────────

const NOW = new Date("2026-11-12T16:05:00Z");
const FAVY =
  'Create a discount code for me using "FAVY10" as the code and 10% off this code and let it run from now until 19th of December 2026.';
const brandClient = {
  from: () => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () =>
        Promise.resolve({
          data: {
            default_timezone: "Africa/Lagos",
            country_code: "NG",
            default_currency: "NGN",
          },
          error: null,
        }),
    };
    return builder;
  },
} as unknown as Parameters<typeof preserveStatedSlots>[0]["userClient"];

function discountArgs(starts: string | null): Record<string, unknown> {
  return {
    brand_id: BRAND,
    kind: "code",
    name: "FAVY10",
    code: "FAVY10",
    value_type: "percent",
    value_bps: 1000,
    scope_kind: "listings",
    targets: [{ target_kind: "event", target_id: EV }],
    ...(starts ? { starts_at: starts } : {}),
    ends_at: "2026-12-19T22:59:59Z",
  };
}

const discountTool = findTool("create_discount");

Deno.test("#3355 R9-2 FAVY10 'from now' with a midnight-UTC start goes to 'as soon as you confirm'", async () => {
  assert(discountTool);
  const out = await preserveStatedSlots({
    toolName: "create_discount",
    toolArgs: discountArgs("2026-11-12T00:00:00Z"),
    parameters: discountTool.parameters,
    ownerMessages: [FAVY],
    userClient: brandClient,
    now: NOW,
  });
  assertEquals(out.kind, "ok");
  if (out.kind !== "ok") return;
  assertEquals("starts_at" in out.args, false);
  assertEquals(out.args.ends_at, "2026-12-19T22:59:59Z");
  assert(out.bound.includes("starts_at"));
});

Deno.test("#3355 R9-2 a past start, a bare date of today and 'starting now' all drop; a stated future start stays exactly", async () => {
  assert(discountTool);
  const base = {
    toolName: "create_discount",
    parameters: discountTool.parameters,
    userClient: brandClient,
    now: NOW,
  };
  for (
    const [words, starts] of [
      ["Create FAVY10 for 10% off", "2026-11-12T09:00:00Z"],
      ["Create FAVY10 for 10% off", "2026-11-12"],
      ["Create FAVY10 for 10% off starting now", "2026-11-13T09:00:00Z"],
      ["Make FAVY10 10% off, effective immediately", "2026-11-12T17:00:00Z"],
    ] as const
  ) {
    const out = await preserveStatedSlots({
      ...base,
      toolArgs: discountArgs(starts),
      ownerMessages: [words],
    });
    assert(
      out.kind === "ok" && !("starts_at" in out.args),
      `${words} / ${starts}`,
    );
  }
  // The host stated a start: 1 December, Lagos midnight.
  const stated = await preserveStatedSlots({
    ...base,
    toolArgs: discountArgs("2026-11-30T23:00:00.000Z"),
    ownerMessages: [
      "Create FAVY10 for 10% off starting 1 December 2026 until 19 December 2026",
    ],
  });
  assertEquals(stated.kind, "ok");
  if (stated.kind === "ok") {
    assertEquals(stated.args.starts_at, "2026-11-30T23:00:00.000Z");
  }
});

Deno.test("#3355 R9-2 the same rule covers create_referral_offer, never a tool without a save-time start", () => {
  assert(hostMeansStartNow(["let it run from now until 19 Dec"]));
  assert(!hostMeansStartNow(["let it run until 19 Dec"]));
  const referral = withImmediateStart({
    toolName: "create_referral_offer",
    toolArgs: { starts_at: "2026-11-01T00:00:00Z", name: "x" },
    ownerMessages: ["Set up a referral offer"],
    statedStart: false,
    now: NOW,
  });
  assertEquals(referral.dropped, true);
  const ad = withImmediateStart({
    toolName: "create_ad_campaign",
    toolArgs: { starts_at: "2026-11-01T00:00:00Z" },
    ownerMessages: ["from now"],
    statedStart: false,
    now: NOW,
  });
  assertEquals(ad.dropped, false);
  const future = withImmediateStart({
    toolName: "create_discount",
    toolArgs: { starts_at: "2026-12-01T09:00:00Z" },
    ownerMessages: ["Start it on 1 December, from now on it's 10%"],
    statedStart: true,
    now: NOW,
  });
  assertEquals(future.dropped, false);
});

// ── Fix 4: "the host" is the reader ─────────────────────────────────────────

Deno.test("#3355 R9-4 the BRUNCH15 receipt never sends the host to 'the host'", () => {
  const demo =
    "The discount code BRUNCH15 for 15% off Suya Sunday Brunch tickets is now active and ends on 5 December 2026. You still need to confirm with the host that the discount is live and visible to buyers.";
  assertEquals(
    speakToHost(demo),
    "The discount code BRUNCH15 for 15% off Suya Sunday Brunch tickets is now active and ends on 5 December 2026.",
  );
  assertEquals(
    speakToHost("Live now. Let the host know it's ready."),
    "Live now.",
  );
  assertEquals(
    speakToHost("Mingla pays the host three working days after the event."),
    "Mingla pays you three working days after the event.",
  );
  assertEquals(
    speakToHost("As the host, you can share the code."),
    "As the host, you can share the code.",
  );
  assertEquals(
    speakToHost("Open the Mingla Host app."),
    "Open the Mingla Host app.",
  );
});

// ── Fix 5: ticket types are not tickets sold ────────────────────────────────

const BRUNCH_ROW = {
  id: EV,
  title: "Suya Sunday Brunch",
  status: "scheduled",
  tickets: { count: 1, capacity: 80, free: false },
};

function ticketsClient(rows: Array<{ event_id: string }> | "error") {
  return {
    from: (table: string) => {
      assertEquals(table, "tickets");
      const builder: Record<string, unknown> = {
        select: () => builder,
        in: () => builder,
        not: () => builder,
        range: () =>
          Promise.resolve(
            rows === "error"
              ? { data: null, error: { message: "denied" } }
              : { data: rows, error: null },
          ),
      };
      return builder;
    },
  } as unknown as Parameters<typeof withTicketsSold>[1];
}

Deno.test("#3355 R9-5 list_events rows say ticket types and tickets sold apart", async () => {
  const none = await withTicketsSold(
    { events: [BRUNCH_ROW] },
    ticketsClient([]),
  ) as { events: Array<{ tickets: Record<string, unknown> }> };
  assertEquals(none.events[0].tickets, {
    ticket_type_count: 1,
    total_capacity: 80,
    all_free: false,
    tickets_sold: 0,
    tickets_sold_known: true,
  });
  const two = await withTicketsSold(
    { events: [BRUNCH_ROW] },
    ticketsClient([{ event_id: EV }, { event_id: EV }]),
  ) as { events: Array<{ tickets: Record<string, unknown> }> };
  assertEquals(two.events[0].tickets.tickets_sold, 2);
  const failed = await withTicketsSold(
    { events: [BRUNCH_ROW] },
    ticketsClient("error"),
  ) as { events: Array<{ tickets: Record<string, unknown> }> };
  assertEquals(failed.events[0].tickets.tickets_sold, null);
  assertEquals(failed.events[0].tickets.tickets_sold_known, false);
  assertEquals("count" in failed.events[0].tickets, false);
  assertEquals(labelEventTickets("x", null), "x");
});

Deno.test("#3355 R9-5 the on path's list_events is labelled; the off path's is origin/main's", () => {
  const on = findAriTurnTool("list_events", true);
  const off = findAriTurnTool("list_events", false);
  assert(on && off);
  assert(on !== findTool("list_events"), "on path wraps list_events");
  assertEquals(off.executor, findTool("list_events")?.executor);
  assertEquals(on.parameters, off.parameters);
  assertEquals(on.description, off.description);
  // Same registry order and every other tool untouched.
  const onTools = ariTurnAgentTools(true);
  assertEquals(
    onTools.map((tool) => tool.name),
    AGENT_TOOLS.map((t) => t.name),
  );
  onTools.forEach((tool, index) => {
    if (tool.name !== "list_events") assert(tool === AGENT_TOOLS[index]);
  });
});

Deno.test("#3355 R9-5 a sold count in the reply must match this turn's read", async () => {
  const demo =
    '"Suya Sunday Brunch" is scheduled for Sunday 6 December 2026 at 11:00 am Lagos time. It has 1 ticket sold out of a capacity of 80.';
  const facts = soldCountFacts([{
    tool: "list_events",
    result: await withTicketsSold({ events: [BRUNCH_ROW] }, ticketsClient([])),
  }]);
  assertEquals(facts, [{ title: "Suya Sunday Brunch", sold: 0 }]);
  for (const judge of JUDGES) {
    const text = await check({
      host: "How is Suya Sunday Brunch doing?",
      reply: demo,
      judge,
      soldCounts: facts,
    });
    assertMatch(text, /It has 0 tickets sold out of a capacity of 80\./);
  }
  // No read of this turn knows the count.
  assertEquals(
    correctSoldCountClaims({ text: "You've sold 12 tickets.", facts: [] })
      .text,
    SOLD_NOT_READ_SENTENCE,
  );
  // A matching count, capacity and ticket types stay as written.
  const kept = "Suya Sunday Brunch has 3 tickets sold and 2 ticket types.";
  assertEquals(
    correctSoldCountClaims({
      text: kept,
      facts: [{ title: "Suya Sunday Brunch", sold: 3 }],
    }).text,
    kept,
  );
  assertEquals(
    correctSoldCountClaims({ text: "It has 80 places in total.", facts: [] })
      .text,
    "It has 80 places in total.",
  );
});

// ── Fix 6: titles ───────────────────────────────────────────────────────────

Deno.test("#3355 R9-6 the demo's five chats get five specific titles", () => {
  const firsts = [
    FAVY,
    "Make BRUNCH15 15% off Suya Sunday Brunch until 5 Dec",
    "How do I add a co-host to scan tickets at the door for Suya Sunday Brunch?",
    "Is Jollof & Jazz Night published?",
    "Hi Ari, can you help me set up a new event called Yaba Street Eats",
  ];
  const titles: string[] = [];
  for (const first of firsts) {
    const title = ariChatTitle({ firstMessage: first, recentTitles: titles });
    assert(title, first);
    titles.push(title);
  }
  assertEquals(titles, [
    "FAVY10 discount code",
    "BRUNCH15 discount code",
    "How do I add a co-host to scan tickets",
    "Is Jollof & Jazz Night published?",
    "Set up a new event called Yaba Street Eats",
  ]);
  assertEquals(new Set(titles).size, titles.length);
  for (const title of titles) {
    assertNotMatch(title, /^Review event operations$|^Plan with Ari$/);
    assert(title.length <= 48);
  }
});

Deno.test("#3355 R9-6 never generic, never a duplicate, never contact details", () => {
  assertEquals(ariChatTitle({ firstMessage: "hi" }), null);
  assertEquals(ariChatTitle({ firstMessage: "Review event operations" }), null);
  const again = ariChatTitle({
    firstMessage: "Is Jollof & Jazz Night published?",
    recentTitles: ["Is Jollof & Jazz Night published?"],
  });
  assertEquals(again, "Is Jollof & Jazz Night published? (2)");
  const longer = ariChatTitle({
    firstMessage: "Check my tickets. I mean the VIP tier please",
    recentTitles: ["Check my tickets"],
  });
  assertEquals(
    longer,
    "Check my tickets. I mean the VIP tier please",
  );
  const scrubbed = ariChatTitle({
    firstMessage: "Email the guest list to ada@example.com or call 08031234567",
  }) ?? "";
  assertNotMatch(scrubbed, /@|0803|\[email\]|\[phone\]/);
});

Deno.test("#3355 R9-6 retitle keeps a manual title and writes the generated one", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const service = (source: string) =>
    ({
      from: () => {
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: () => builder,
          neq: () => builder,
          order: () => builder,
          limit: () =>
            Promise.resolve({
              data: [{ title: "FAVY10 discount code" }],
              error: null,
            }),
          maybeSingle: () =>
            Promise.resolve({
              data: {
                id: "c1",
                title: "Review event operations",
                title_source: source,
              },
              error: null,
            }),
          update: (row: Record<string, unknown>) => {
            writes.push(row);
            return builder;
          },
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ error: null }).then(resolve),
        };
        return builder;
      },
    }) as unknown as Parameters<typeof retitleAriChat>[0]["service"];
  assertEquals(
    await retitleAriChat({
      service: service("manual"),
      userId: "u1",
      conversationId: "c1",
      brandId: BRAND,
      firstMessage: "Create FAVY10 10% off",
    }),
    null,
  );
  assertEquals(writes.length, 0);
  const title = await retitleAriChat({
    service: service("provisional"),
    userId: "u1",
    conversationId: "c1",
    brandId: BRAND,
    firstMessage: "Create FAVY10 10% off",
  });
  // Another chat already has "FAVY10 discount code".
  assertEquals(title, "Create FAVY10 10% off");
  assertEquals(writes[0].title_source, "generated");
  assertEquals(writes[0].title_generation_version, ARI_CHAT_TITLE_VERSION);
  const chat = Deno.readTextFileSync(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertMatch(
    chat,
    /if \(understandFirst && !body\.conversation_id && ownerTurnText\.trim\(\)\) \{\s+const retitled = await retitleAriChat\(/,
  );
  const conversation = Deno.readTextFileSync(
    new URL("../../agent-conversation/index.ts", import.meta.url),
  );
  assertMatch(conversation, /if \(understandFirst && firstText\.trim\(\)\) \{/);
});

// ── Fix 7: screen paths ─────────────────────────────────────────────────────

Deno.test("#3355 R9-7 the demo's invented 'Manage > Scanners' steps become an honest pointer", () => {
  const demo = [
    "Door scanning requires a scanner on the event.",
    "",
    "To add a co-host who can scan tickets at the door:",
    "",
    '1. Go to the event "Suya Sunday Brunch" in the Mingla Host app.',
    '2. Tap "Manage" > "Scanners" on the event page.',
    '3. Tap "Add scanner" and enter the co-host’s email.',
    "4. Confirm the invite.",
    "",
    "Would you like me to help with anything else?",
  ].join("\n");
  const out = guardReplyNavigation(demo).text;
  assertNotMatch(out, /Manage/);
  assertNotMatch(out, /Add scanner/);
  assertMatch(
    out,
    new RegExp(ARI_UNKNOWN_PATH_SENTENCE.replace(/[?]/g, "\\?")),
  );
  assertMatch(out, /^1\. Go to the event "Suya Sunday Brunch"/m);
  assertMatch(out, /Would you like me to help with anything else\?$/);
  assertEquals(
    guardReplyNavigation("Tap Manage > Scanners on the event page.").text,
    ARI_UNKNOWN_PATH_SENTENCE,
  );
});

Deno.test("#3355 R9-7 real paths, numbers and prose are never touched", () => {
  for (
    const text of [
      'Open the brand (Account > "Your brands") and tap "Team & permissions".',
      "Account > Help & Support > Support tab.",
      "Open Hub > Venues and pick the venue.",
      'Tap "Guests" then "+" to add someone.',
      "If the price > 1000 it shows a warning.",
      "Go to Account → your brand → Payments & Bank.",
      "Open Discounts from the brand page and create a code.",
    ]
  ) {
    assertEquals(guardReplyNavigation(text).text, text, text);
  }
  assertEquals(
    navigationPathsIn("Events > Suya Sunday Brunch > Scanners", [
      "Suya Sunday Brunch",
    ])[0]?.known,
    true,
  );
  assertEquals(
    navigationPathsIn("Events > Suya Sunday Brunch > Scanners")[0]?.known,
    false,
  );
  const wired = Deno.readTextFileSync(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertMatch(
    wired,
    /return guardReplyNavigation\(\s+speakToHost\(check\.text\),/,
  );
});
