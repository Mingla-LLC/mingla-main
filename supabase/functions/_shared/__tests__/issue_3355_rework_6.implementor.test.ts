// #3355 rework 6 (after Retest 6 FAIL). The orchestrator's decision: stop
// adding phrases; one structural rule for status claims, and delete the
// phrase triggers it replaces. The judge is stubbed with the claim shapes it
// returns (or fails), the database with a fake caller client; each case pins
// the server, never the model. Folds the retest-6 repro (R6-1 … R6-8).
//
// MINGLA-INVARIANT: I-ARI-STATUS-FROM-NAMED-FRESH-ROW | issue #3355 | (rework 6, replaces the rework 5b "any live row of the kind" pool) A status claim about an event, RSVP, trip, experience, stay, venue, ticket tier, blast, the brand website, a refund or payout readiness is backed ONLY by a row read in THIS turn for the specific object the claim or the host names — by id from the chat's cards, or by exact normalised title in the active brand — never by another row of the kind, an older card or receipt, or a fuzzy title; every object a list names is backed on its own; an unresolvable object ("which one?"), an unread or failed kind, or a card's object with no row ("couldn't check"), and a kind the caller's role cannot read ("can't check it for you") never keep a positive status; the reads are triggered by the claim list (the judge's, or the deterministic pass's when the judge is down) and by the host asking about a state, never by the reply's words (enforced by supabase/functions/_shared/__tests__/issue_3355_rework_6.implementor.test.ts).

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AriClaim,
  type AriClaimKind,
  assertedClauses,
  buildClaimEvidence,
  checkReplyClaims,
  type ClaimRecordsRead,
  fixClockPairs,
  hostAsksForWrite,
  isStatusQuestion,
  NO_CARD_TO_CONFIRM,
  REMINDERS_UNSEEN,
  type StatusReadPlan,
  unverifiedStatusSentence,
} from "../ariClaimCheck.ts";
import {
  hiddenKindsForRole,
  objectStatusReadPlan,
  readObjectStatuses,
  type StatusClient,
} from "../ariStatusRead.ts";
import { type WriteState } from "../ariTruthGuards.ts";
import {
  ARI_MODEL_STEER_CODES,
  ariUserFacingToolError,
  buildAgentRunRendition,
} from "../agentRenditions.ts";
import {
  ownerCopyViolations,
  registerOwnerCopyToolNames,
} from "../ariOwnerCopy.ts";
import {
  ariSetupSkippedIssue,
  ariSetupTextIssue,
} from "../ariFlows/startFlowTool.ts";
import type { AgentLoopObservation, AgentLoopResult } from "../agentLoop.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const EV1 = "22222222-2222-4222-8222-222222222222";
const EV2 = "22222222-2222-4222-8222-333333333333";
const TIER = "44444444-4444-4444-8444-444444444441";
const OTHER_TIER = "44444444-4444-4444-8444-444444444442";
const VENUE = "55555555-5555-4555-8555-555555555555";
const ORDER = "66666666-6666-4666-8666-666666666666";

type Rows = Array<Record<string, unknown>>;

interface Spy {
  client: StatusClient;
  calls: Array<{ table: string; filters: Array<[string, string, unknown]> }>;
}

function fake(
  tables: Record<string, Rows | "error"> = {},
  rpc: Record<string, unknown> = {},
): Spy {
  const calls: Spy["calls"] = [];
  const client: StatusClient = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      calls.push({ table, filters });
      const builder: Record<string, unknown> = {
        select: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push(["eq", column, value]);
          return builder;
        },
        in: (column: string, value: unknown) => {
          filters.push(["in", column, value]);
          return builder;
        },
        then: (resolve: (value: unknown) => unknown) => {
          const rows = tables[table];
          if (rows === "error") {
            return Promise.resolve({ data: null, error: { message: "x" } })
              .then(resolve);
          }
          return Promise.resolve({
            data: (rows ?? []).filter((row) =>
              filters.every(([op, column, value]) =>
                !(column in row) ||
                (op === "eq"
                  ? row[column] === value
                  : (value as unknown[]).includes(row[column]))
              )
            ),
            error: null,
          }).then(resolve);
        },
      };
      return builder;
    },
    rpc(fn: string) {
      calls.push({ table: `rpc:${fn}`, filters: [] });
      return Promise.resolve(
        fn in rpc
          ? { data: rpc[fn], error: null }
          : { data: null, error: { message: "unknown function" } },
      );
    },
  };
  return { client, calls };
}

const card = (
  tool: string,
  object: string | null,
  args: Record<string, unknown> = {},
  status: WriteState["status"] = "executed",
): WriteState => ({
  actionId: `a-${tool}-${object}`,
  toolName: tool,
  status,
  object,
  args: { ...(object ? { title: object } : {}), ...args },
  receiptText: null,
});
const codeCard = (code: string): WriteState => ({
  actionId: code,
  toolName: "create_discount",
  status: "executed",
  object: code,
  args: { code },
  receiptText: null,
});
const brandRead = (codes: Record<string, string>) =>
(
  _kinds: ReadonlySet<AriClaimKind>,
  objects: readonly string[],
): Promise<ClaimRecordsRead> =>
  Promise.resolve({
    records: objects.filter((code) => codes[code.toUpperCase()]).map((
      code,
    ) => ({
      status: "read" as const,
      kind: "discount" as const,
      toolName: "list_discounts",
      objects: [code.toUpperCase()],
      state: null,
      thisTurn: false,
      readState: {
        live: codes[code.toUpperCase()] === "active",
        label: codes[code.toUpperCase()],
      },
    })),
    checkedKinds: ["note", "support"],
    checkedObjects: [...objects],
  });

const claim = (
  quote: string,
  action: AriClaim["action"],
  kind: AriClaimKind,
  object: string | null = null,
): AriClaim => ({ quote, action, kind, object });

async function run(a: {
  host: string;
  reply: string;
  claims: readonly AriClaim[] | "fail";
  states?: WriteState[];
  tables?: Record<string, Rows | "error">;
  rpc?: Record<string, unknown>;
  client?: StatusClient;
  plan?: StatusReadPlan;
  objects?: string[];
  read?: ReturnType<typeof brandRead>;
  asked?: boolean;
  role?: string;
  timeoutMs?: number;
}): Promise<string> {
  const states = a.states ?? [];
  const out = await checkReplyClaims({
    text: a.reply,
    hostMessage: a.host,
    intent: "question",
    recentWrite: true,
    objects: a.objects ??
      states.flatMap((state) => state.object ? [state.object] : []),
    evidence: buildClaimEvidence({ states, observations: [] }),
    statusRead: a.plan ??
      objectStatusReadPlan({
        client: a.client ?? fake(a.tables ?? {}, a.rpc ?? {}).client,
        brandId: BRAND,
        text: a.reply,
        cards: states,
        hostMessage: a.host,
        brandRole: a.role ?? null,
      }),
    ...(a.read ? { moreEvidence: a.read } : {}),
    askedWriteThisTurn: a.asked ?? false,
    ...(a.timeoutMs ? { timeoutMs: a.timeoutMs } : {}),
    call: () =>
      a.claims === "fail"
        ? Promise.reject(new Error("HTTP 503"))
        : Promise.resolve({ claims: a.claims }),
  });
  return out.text;
}

/** The three judge states every status case is held to. */
const JUDGES = (one: AriClaim): Array<readonly AriClaim[] | "fail"> => [
  [one],
  [],
  "fail",
];

const draftNight = {
  id: EV1,
  brand_id: BRAND,
  title: "Lagos Night Out",
  status: "draft",
  event_type: "event",
};
const pubBrunch = {
  id: EV2,
  brand_id: BRAND,
  title: "Abuja Brunch",
  status: "scheduled",
  event_type: "event",
};

// ── R6-1: the object is the one named, never "any live one" ───────────────

Deno.test("R6-1: 'Is my Lagos Night Out event published?' -> 'Yes, your event is published!' is held to Lagos Night Out, not to another published event", async () => {
  const reply = "Yes, your event is published!";
  for (
    const judge of JUDGES(claim(reply, "published", "event", "your event"))
  ) {
    const out = await run({
      host: "Is my Lagos Night Out event published?",
      reply,
      claims: judge,
      tables: { events: [draftNight, pubBrunch] },
    });
    assertEquals(
      out,
      "Your records show Lagos Night Out as a draft.",
      JSON.stringify(judge),
    );
  }
});

Deno.test("R6-1: unnamed with several candidates asks which one; with one row it is that row", async () => {
  const reply = "Yes, your event is published!";
  const several = await run({
    host: "is my event published?",
    reply,
    claims: [claim(reply, "published", "event", "your event")],
    tables: { events: [draftNight, pubBrunch] },
  });
  assertEquals(
    several,
    "I can't find your event to check — which one do you mean?",
  );
  const one = await run({
    host: "is my event published?",
    reply,
    claims: [claim(reply, "published", "event", "your event")],
    tables: { events: [pubBrunch] },
  });
  assertEquals(one, reply);
  // The chat's one card names it (by id).
  const carded = await run({
    host: "is my event published?",
    reply,
    claims: [claim(reply, "published", "event", "your event")],
    states: [card("publish_event", "Abuja Brunch", { event_id: EV2 })],
    tables: { events: [draftNight, pubBrunch] },
  });
  assertEquals(carded, reply);
});

// ── R6-2: exact normalised titles only ─────────────────────────────────────

Deno.test("R6-2: a misspelt or paraphrased title is never backed by another live event", async () => {
  for (
    const [reply, object] of [
      ["Yes, Lagos Nite Out is live.", "Lagos Nite Out"],
      ["Yes, the Lagos Night Out party is live.", "Lagos Night Out party"],
    ]
  ) {
    const out = await run({
      host: "Is Lagos Night Out live?",
      reply,
      claims: [claim(reply, "live", "event", object)],
      tables: { events: [draftNight, pubBrunch] },
    });
    assertNotMatch(out, /is live/, out);
  }
  const misspelt = await run({
    host: "Is it live?",
    reply: "Yes, Lagos Nite Out is live.",
    claims: [
      claim("Yes, Lagos Nite Out is live.", "live", "event", "Lagos Nite Out"),
    ],
    tables: { events: [draftNight, pubBrunch] },
  });
  assertEquals(
    misspelt,
    "I can't find Lagos Nite Out to check — which one do you mean?",
  );
  // The kind noun and determiner are not part of the title.
  const tailed = await run({
    host: "Is it live?",
    reply: "Yes, the Abuja Brunch event is live.",
    claims: [
      claim(
        "Yes, the Abuja Brunch event is live.",
        "live",
        "event",
        "Abuja Brunch event",
      ),
    ],
    tables: { events: [draftNight, pubBrunch] },
  });
  assertEquals(tailed, "Yes, the Abuja Brunch event is live.");
});

// ── R6-3: the claims trigger the read, not the reply's words ──────────────

Deno.test("R6-3: a status said in any words gets a fresh read; an older publish card never backs it", async () => {
  for (
    const reply of [
      "Yes, Lagos Night Out is now visible to guests on Mingla.",
      "Yep, Lagos Night Out is up on Mingla!",
    ]
  ) {
    for (
      const judge of [
        [claim(reply, "published", "event", "Lagos Night Out")],
        "fail" as const,
      ]
    ) {
      const out = await run({
        host: "Can guests see it?",
        reply,
        claims: judge,
        states: [card("publish_event", "Lagos Night Out", { event_id: EV1 })],
        tables: { events: [draftNight] },
      });
      assertEquals(
        out,
        "Your records show Lagos Night Out as a draft.",
        `${reply} ${JSON.stringify(judge)}`,
      );
    }
  }
});

Deno.test("R6-3: a kind the turn did not mention is read after the judge names it", async () => {
  const asked: string[][] = [];
  const spy = fake({ events: [draftNight] });
  const plan: StatusReadPlan = {
    kinds: new Set(),
    read: (kinds) => {
      asked.push([...(kinds ?? [])].sort());
      return readObjectStatuses({
        client: spy.client,
        brandId: BRAND,
        kinds: kinds ?? new Set(),
        cards: [],
      });
    },
  };
  const reply = "Lagos Night Out is up on Mingla.";
  const out = await run({
    host: "how is it going?",
    reply,
    claims: [claim(reply, "published", "event", "Lagos Night Out")],
    plan,
  });
  assertEquals(asked, [["event", "experience", "trip"]]);
  assertEquals(out, "Your records show Lagos Night Out as a draft.");
  // The read the claim needs never answers: never kept, "couldn't check".
  const late = await run({
    host: "how is it going?",
    reply,
    claims: [claim(reply, "published", "event", "Lagos Night Out")],
    plan: {
      kinds: new Set(),
      read: () => new Promise(() => {}),
    },
    timeoutMs: 700,
  });
  assertMatch(late, /^I couldn't check Lagos Night Out's current status/);
});

// ── R6-4 / rule 5: every object a list names ───────────────────────────────

Deno.test("R6-4: every code the claim asserts is checked, whatever words list them", async () => {
  const states = ["FAVY10", "GIRLS20", "LAGOS5"].map(codeCard);
  for (
    const reply of [
      "FAVY10, GIRLS20, also LAGOS5 are live.",
      "FAVY10 and GIRLS20 are live, and so is LAGOS5.",
      "FAVY10 and GIRLS20, along with LAGOS5, are live.",
      "FAVY10 plus GIRLS20 together with LAGOS5 are all live.",
    ]
  ) {
    for (
      const judge of [
        [claim(reply, "live", "discount", "FAVY10")],
        "fail" as const,
      ]
    ) {
      const out = await run({
        host: "are they live?",
        reply,
        claims: judge,
        states,
        objects: ["FAVY10", "GIRLS20", "LAGOS5"],
        read: brandRead({
          FAVY10: "active",
          GIRLS20: "active",
          LAGOS5: "ended",
        }),
      });
      assertEquals(out, "Your records show LAGOS5 as ended.", reply);
    }
  }
  // A clause that says another state is not part of the claim.
  const mixed = "FAVY10 is live, GIRLS20 has ended.";
  assertEquals(assertedClauses(mixed), ["FAVY10 is live"]);
  const kept = await run({
    host: "which codes work?",
    reply: mixed,
    claims: [claim(mixed, "live", "discount", "FAVY10")],
    states,
    objects: ["FAVY10", "GIRLS20", "LAGOS5"],
    read: brandRead({ FAVY10: "active", GIRLS20: "ended" }),
  });
  assertEquals(kept, mixed);
});

Deno.test("Rule 5: every event a list names is backed on its own", async () => {
  const reply = "Lagos Night Out and Abuja Brunch are both live.";
  const out = await run({
    host: "are my events live?",
    reply,
    claims: [claim(reply, "live", "event", "Abuja Brunch")],
    tables: { events: [draftNight, pubBrunch] },
  });
  assertEquals(out, "Your records show Lagos Night Out as a draft.");
  const honest = "Abuja Brunch is live, but Lagos Night Out is still a draft.";
  const kept = await run({
    host: "are my events live?",
    reply: honest,
    claims: [claim(honest, "live", "event", "Abuja Brunch")],
    tables: { events: [draftNight, pubBrunch] },
  });
  assertEquals(kept, honest);
});

Deno.test("R6-14: a 12-code list is read in full (the read covers 25 codes)", async () => {
  const codes = Array.from({ length: 12 }, (_, index) => `CODE${index + 10}`);
  const reply = `${codes.join(", ")} are all live.`;
  const out = await run({
    host: "are all my codes live?",
    reply,
    claims: [claim(reply, "live", "discount", codes[0])],
    states: codes.map(codeCard),
    objects: codes,
    read: brandRead(Object.fromEntries(codes.map((code) => [code, "active"]))),
  });
  assertEquals(out, reply);
});

// ── R6-5 / rule 4: write vs status from the intent read, then the words ───

Deno.test("R6-5: a write verb in an action position is a request, whatever the opener", () => {
  for (
    const host of [
      "Is it too late to make a 15% student code?",
      "Are you free to set up a code for students?",
      "Is now a good time to make a 15% code?",
      "Have you got time to message my guests that doors open at 8?",
      "Did you want to create a student code?",
      "Is it possible to make a 15% student discount?",
      "Do you mind messaging my guests that doors now open at 8?",
      "Would you mind creating STUDENT15 for me?",
      "Can you send my guests a reminder?",
    ]
  ) {
    assert(hostAsksForWrite(host), host);
    assert(!isStatusQuestion(host), host);
  }
  for (
    const host of [
      "Did it go through?",
      "Is FAVY10 live?",
      "Has my request been sent?",
      "Did you send it?",
      "Are my codes working?",
      "Can guests see it?",
      "Is my Lagos Night Out event published?",
      "Did I make sure the doors time is right?",
    ]
  ) {
    assert(isStatusQuestion(host), host);
    assert(!hostAsksForWrite(host), host);
  }
});

Deno.test("R6-5: 'Done!' after a write request phrased as a question is not backed by an older card", async () => {
  const done = "Done! Your student discount is live.";
  for (
    const host of [
      "Is it too late to make a 15% student code?",
      "Are you free to set up a code for students?",
      "Is now a good time to make a 15% code?",
    ]
  ) {
    const out = await run({
      host,
      reply: done,
      claims: [claim(done, "live", "discount", "your student discount")],
      states: [codeCard("FAVY10")],
      objects: ["FAVY10"],
      read: brandRead({ FAVY10: "active" }),
    });
    assert(out !== done && !/is live/.test(out), `${host}: ${out}`);
  }
  const sent = "I've messaged your guests about the new time.";
  const out = await run({
    host: "Have you got time to message my guests that doors open at 8?",
    reply: sent,
    claims: [claim(sent, "sent", "message", "your guests")],
    states: [{
      actionId: "m1",
      toolName: "send_event_message",
      status: "executed",
      object: null,
      args: {},
      receiptText: null,
    }],
  });
  assert(!/messaged/.test(out), out);
});

// ── R6-6 / R6-7 / R6-10: RLS returns no rows, never "fine" ────────────────

Deno.test("R6-6: a refund the read cannot see is never 'went through' on an old card", async () => {
  const reply = "Yes, the refund went through.";
  for (
    const judge of JUDGES(claim(reply, "completed", "refund", "the refund"))
  ) {
    const out = await run({
      host: "Did the refund go through?",
      reply,
      claims: judge,
      states: [card("refund_order", null, { order_id: ORDER })],
      tables: { refunds: [] },
    });
    assertMatch(out, /^I couldn't check the refund's current status/, out);
  }
  // A role RLS hides refunds from: said so, nothing read.
  const spy = fake({ refunds: [] });
  const hidden = await run({
    host: "Did the refund go through?",
    reply,
    claims: [claim(reply, "completed", "refund", "the refund")],
    states: [card("refund_order", null, { order_id: ORDER })],
    client: spy.client,
    role: "event_manager",
  });
  assertMatch(hidden, /^I can't check the refund for you, because your role/);
  assert(!spy.calls.some((call) => call.table === "refunds"));
});

Deno.test("R6-7: a stay the read cannot see is never described by its venue's review state", async () => {
  const reply = "Your stay at Ikoyi Loft is live.";
  const tables = {
    venue_listings: [{
      id: VENUE,
      brand_id: BRAND,
      name: "Ikoyi Loft",
      claim_status: "pending_review",
    }],
    stay_settings: [],
  };
  for (const judge of JUDGES(claim(reply, "live", "stay", "Ikoyi Loft"))) {
    const out = await run({
      host: "is my stay live?",
      reply,
      claims: judge,
      states: [card("submit_venue", "Ikoyi Loft", { venue_id: VENUE })],
      tables,
    });
    assertNotMatch(out, /pending review|is live/, out);
  }
  const hidden = await run({
    host: "is my stay live?",
    reply,
    claims: [claim(reply, "live", "stay", "Ikoyi Loft")],
    states: [card("submit_venue", "Ikoyi Loft", { venue_id: VENUE })],
    tables,
    role: "marketing_manager",
  });
  assertMatch(hidden, /^I can't check the stay for you, because your role/);
});

Deno.test("R6-10: the website is never 'not set up yet' for a role that cannot see it", async () => {
  assertEquals([...hiddenKindsForRole("scanner")].sort(), [
    "refund",
    "stay",
    "website",
  ]);
  assertEquals([...hiddenKindsForRole("brand_admin")], []);
  const spy = fake({ brand_sites: [] });
  const read = await readObjectStatuses({
    client: spy.client,
    brandId: BRAND,
    kinds: new Set(["website"] as AriClaimKind[]),
    cards: [],
    brandRole: "scanner",
  });
  assertEquals(read.records, []);
  assertEquals(read.hiddenKinds, ["website"]);
  assertEquals(spy.calls.length, 0);
  const reply = "Your website is published.";
  const out = await run({
    host: "is my website live?",
    reply,
    claims: [claim(reply, "published", "website", "your website")],
    tables: { brand_sites: [] },
    role: "scanner",
  });
  assertMatch(out, /^I can't check the website for you/);
  assertNotMatch(out, /not set up/);
});

// ── R6-8: the follow-on sentences of a corrected status ───────────────────

Deno.test("R6-8: the follow-on sentence of a corrected status goes with it", async () => {
  const out = await run({
    host: "is my event published?",
    reply: "Your event is published. Guests can buy tickets now.",
    claims: [claim("Your event is published.", "published", "event", null)],
    states: [card("publish_event", "Lagos Night Out", { event_id: EV1 })],
    tables: { events: [draftNight] },
  });
  assertEquals(out, "Your records show Lagos Night Out as a draft.");
  // A question after it stays; other paragraphs stay.
  const asked = await run({
    host: "is my event published?",
    reply:
      "Your event is published. Want me to make a discount code too?\n\nTickets start at ₦5,000.",
    claims: [claim("Your event is published.", "published", "event", null)],
    states: [card("publish_event", "Lagos Night Out", { event_id: EV1 })],
    tables: { events: [draftNight] },
  });
  assertEquals(
    asked,
    "Your records show Lagos Night Out as a draft. Want me to make a discount code too?\n\nTickets start at ₦5,000.",
  );
});

// ── R6-9: no model instruction in host-visible copy ───────────────────────

Deno.test("R6-9: the plan card never shows a model instruction, a tool name or a snake_case key", () => {
  registerOwnerCopyToolNames([
    "start_flow",
    "create_event",
    "create_discount",
    "upsert_ticket_tier",
  ]);
  const steer = [
    ariSetupTextIssue({
      startFlowHint: "create_event",
      startFlowAllowed: true,
    }),
    ariSetupSkippedIssue({
      startFlowHint: "create_event",
      startFlowAllowed: true,
      toolName: "create_event",
    }),
  ];
  assert(
    steer.every((issue) => issue && ARI_MODEL_STEER_CODES.has(issue.code)),
  );
  const observations: AgentLoopObservation[] = [
    { tool: "reasoning", args: {}, error: steer[0] ?? undefined, elapsedMs: 0 },
    {
      tool: "create_event",
      args: {},
      error: steer[1] ?? undefined,
      elapsedMs: 0,
    },
    {
      tool: "reasoning",
      args: {},
      error: {
        code: "WRITE_PROPOSAL_REQUIRED",
        message: "Make that proposal now as a tool call.",
      },
      elapsedMs: 0,
    },
    {
      tool: "list_events",
      args: {},
      error: {
        code: "SOMETHING_ELSE",
        message: "Call upsert_ticket_tier with event_id first.",
      },
      elapsedMs: 3,
    },
  ];
  for (
    const kind of ["stopped", "text"] as const
  ) {
    const result = (kind === "stopped"
      ? {
        kind,
        reason: "errors",
        observations,
        usage: { input: 0, output: 0, calls: 1 },
        exhausted: false,
      }
      : {
        kind,
        text: "Here is what I found.",
        observations,
        usage: { input: 0, output: 0, calls: 1 },
        exhausted: false,
      }) as AgentLoopResult;
    const rendition = buildAgentRunRendition({
      renditionId: "r6-9",
      goal: "Create my event",
      result,
    });
    const strings: string[] = [];
    const walk = (value: unknown, key = ""): void => {
      if (typeof value === "string") {
        if (
          !/^(?:id|type|tone|style|kind|command|rendition_id|eyebrow|state)$/
            .test(key)
        ) {
          strings.push(value);
        }
      } else if (Array.isArray(value)) value.forEach((item) => walk(item, key));
      else if (value && typeof value === "object") {
        for (const [child, item] of Object.entries(value)) walk(item, child);
      }
    };
    walk(rendition);
    const all = strings.join("\n");
    assertNotMatch(all, /start_flow|flow_key|Call |tool call|The host asked/i);
    for (const text of strings) {
      assertEquals(ownerCopyViolations(text, "prose"), [], text);
    }
  }
  for (const code of ARI_MODEL_STEER_CODES) {
    assertEquals(
      ariUserFacingToolError({ code, message: "Call start_flow now." }),
      "Ari needed another try at this step.",
    );
  }
  assertEquals(
    ariUserFacingToolError({
      code: "X",
      message: "Call create_event with flow_key.",
    }),
    "This step could not be completed yet.",
  );
  assertEquals(
    ariUserFacingToolError({
      code: "X",
      message: "That event has already ended.",
    }),
    "That event has already ended.",
  );
});

// ── R6-11: Pidgin and French with the judge down ───────────────────────────

Deno.test("R6-11: the judge-down backup reads Pidgin and French status and completion claims", async () => {
  for (
    const reply of [
      "Yes o, your event don publish finish.",
      "Oui, votre événement est publié.",
    ]
  ) {
    const out = await run({
      host: "is my event published?",
      reply,
      claims: "fail",
      states: [card("publish_event", "Lagos Night Out", { event_id: EV1 })],
      tables: { events: [draftNight] },
    });
    assertEquals(out, "Your records show Lagos Night Out as a draft.", reply);
  }
  for (
    const reply of [
      "Yes o, FAVY10 still dey work.",
      "Oui, FAVY10 est toujours actif.",
    ]
  ) {
    const out = await run({
      host: "Is FAVY10 still live?",
      reply,
      claims: "fail",
      states: [codeCard("FAVY10")],
      objects: ["FAVY10"],
      read: brandRead({ FAVY10: "ended" }),
    });
    assertEquals(out, "Your records show FAVY10 as ended.", reply);
  }
  for (
    const reply of ["I don notify your guests.", "J'ai prévenu vos invités."]
  ) {
    const out = await run({
      host: "Message my guests that doors open at 8",
      reply,
      claims: "fail",
      asked: true,
    });
    assert(out !== reply, `${reply} -> ${out}`);
  }
  // Never touched: a negation and a plain answer.
  for (
    const reply of [
      "Your event no dey live yet. It is still a draft.",
      "Votre événement n'est pas encore publié.",
    ]
  ) {
    const out = await run({
      host: "is my event published?",
      reply,
      claims: "fail",
      tables: { events: [draftNight] },
    });
    assertEquals(out, reply);
  }
});

// ── R6-12: "ticket sales are open" ─────────────────────────────────────────

Deno.test("R6-12: 'Ticket sales are open for Abuja Brunch' is a status claim held to the read", async () => {
  const reply = "Ticket sales are open for Abuja Brunch too.";
  const out = await run({
    host: "what about Abuja Brunch?",
    reply,
    claims: "fail",
    tables: {
      events: [draftNight, { ...pubBrunch, status: "draft" }],
    },
  });
  assertEquals(out, "Your records show Abuja Brunch as a draft.");
});

// ── R6-13: "Confirm" with no card ──────────────────────────────────────────

Deno.test("R6-13: 'Confirm to set it up' with no waiting card says there is nothing to confirm", async () => {
  const reply =
    "I'm about to propose a discount code for 10% off. Confirm to set it up.";
  for (
    const judge of [
      [claim(reply, "proposed", "discount", null)],
      [],
      "fail" as const,
    ]
  ) {
    const out = await run({
      host: "make FAVY10 10% off",
      reply,
      claims: judge,
      asked: true,
    });
    assertMatch(out, new RegExp(NO_CARD_TO_CONFIRM.replace(/[.']/g, ".")), out);
    assertNotMatch(out, /Confirm to set it up/);
  }
  const waiting = await run({
    host: "make FAVY10 10% off",
    reply: "Tap Confirm on the card to set it up.",
    claims: [],
    states: [card("create_discount", "FAVY10", { code: "FAVY10" }, "pending")],
    asked: true,
  });
  assertEquals(waiting, "Tap Confirm on the card to set it up.");
});

// ── R6-15: replacement wording ─────────────────────────────────────────────

Deno.test("R6-15: every 'couldn't check' names a place, and reminders are not called a message", () => {
  for (
    const kind of [
      "event",
      "stay",
      "venue",
      "website",
      "refund",
      "payout",
      "message",
      "ticket",
    ] as AriClaimKind[]
  ) {
    assertNotMatch(
      unverifiedStatusSentence("it", kind),
      /on its page in Mingla Host/,
    );
  }
  assertEquals(
    REMINDERS_UNSEEN,
    "I can't see your reminder settings from this chat, so I can't confirm they're on.",
  );
});

Deno.test("R6-15: a judged 'Reminders are switched on' is answered about reminders", async () => {
  const reply = "Reminders are switched on for your guests.";
  const out = await run({
    host: "Are reminders on?",
    reply,
    claims: [claim(reply, "live", "message", "Reminders")],
  });
  assertEquals(out, REMINDERS_UNSEEN);
});

// ── R6-16 / R6-17: the read's own scope ────────────────────────────────────

Deno.test("R6-16: a tier read by card id is limited to this brand's offerings", async () => {
  const spy = fake({
    events: [pubBrunch],
    ticket_types: [
      { id: TIER, name: "VIP", event_id: EV2, is_disabled: false },
      {
        id: OTHER_TIER,
        name: "VIP",
        event_id: "elsewhere",
        is_disabled: false,
      },
    ],
  });
  const read = await readObjectStatuses({
    client: spy.client,
    brandId: BRAND,
    kinds: new Set(["ticket"] as AriClaimKind[]),
    cards: [{
      toolName: "upsert_ticket_tier",
      object: "VIP",
      args: { ticket_type_id: TIER, tier_id: OTHER_TIER },
    }],
  });
  const tiers = spy.calls.find((call) => call.table === "ticket_types");
  assert(tiers);
  assert(
    tiers.filters.some(([op, column, value]) =>
      op === "in" && column === "event_id" &&
      JSON.stringify(value) === JSON.stringify([EV2])
    ),
  );
  assertEquals(
    read.records.filter((item) => item.kind === "ticket").map((item) =>
      item.objectId
    ),
    [TIER],
  );
});

Deno.test("R6-17: payout readiness is read through the members-only predicate", async () => {
  const spy = fake({}, { pg_brand_can_payout_for_caller: false });
  const out = await run({
    host: "are my payouts ready?",
    reply: "Your payouts are ready.",
    claims: [
      claim("Your payouts are ready.", "live", "payout", "your payouts"),
    ],
    client: spy.client,
  });
  assertEquals(out, "Your records show your payouts as not ready yet.");
  assert(
    spy.calls.some((call) =>
      call.table === "rpc:pg_brand_can_payout_for_caller"
    ),
  );
  assert(!spy.calls.some((call) => call.table === "rpc:pg_brand_can_payout"));
  const source = await Deno.readTextFile(
    new URL("../ariStatusRead.ts", import.meta.url),
  );
  assertNotMatch(source, /rpc\("pg_brand_can_payout"/);
});

// ── R6-19: two clock times for one moment ─────────────────────────────────

Deno.test("R6-19: a UTC hour beside the local one is never left standing", () => {
  assertEquals(
    fixClockPairs(
      "FAVY10 starts on 19 December 2026 at 18:00 (7:00 PM) Lagos time.",
    ),
    "FAVY10 starts on 19 December 2026 at the time shown on the card.",
  );
  assertEquals(
    fixClockPairs("It starts at 18:00 (6:00 PM) Lagos time."),
    "It starts at 18:00 (6:00 PM) Lagos time.",
  );
  assertEquals(
    fixClockPairs("Ends at 23:59 (11:59 pm)."),
    "Ends at 23:59 (11:59 pm).",
  );
});

// ── R6-18 and wiring ───────────────────────────────────────────────────────

Deno.test("R6-18 / wiring: agent-chat, post-approval and the live eval wire the status read with the host's words", async () => {
  const chat = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertMatch(
    chat,
    /statusRead: objectStatusReadPlan\(\{[\s\S]{0,400}hostMessage: args\.current,\s+brandRole: args\.brandRole \?\? null,/,
  );
  assertEquals(
    chat.match(/brandRole: activeBrand\?\.role \?\? null,/g)?.length,
    3,
  );
  const post = await Deno.readTextFile(
    new URL("../agentPostApproval.ts", import.meta.url),
  );
  assertMatch(
    post,
    /statusRead: objectStatusReadPlan\(\{[\s\S]{0,500}hostMessage: args\.hostMessage,/,
  );
  const live = await Deno.readTextFile(
    new URL(
      "../../../../scripts/ari/eval/replay/claim_check_live.ts",
      import.meta.url,
    ),
  );
  assertMatch(live, /statusRead: objectStatusReadPlan\(\{/);
  for (
    const shape of [
      "Yes, your event is published!",
      "Yes, Lagos Nite Out is live.",
      "Yes, Lagos Night Out is now visible to guests on Mingla.",
      "FAVY10, GIRLS20, also LAGOS5 are live.",
      "Done! Your student discount is live.",
      "Your event is published. Guests can buy tickets now.",
    ]
  ) assert(live.includes(shape), shape);
});

Deno.test("Rework 6: the phrase triggers the rule replaces are gone", async () => {
  const check = await Deno.readTextFile(
    new URL("../ariClaimCheck.ts", import.meta.url),
  );
  const read = await Deno.readTextFile(
    new URL("../ariStatusRead.ts", import.meta.url),
  );
  assertNotMatch(read, /STATUS_HINT/);
  assertNotMatch(
    check,
    /const READ_HINT|const POLITE_REQUEST|const STATUS_QUESTION|function codesListedTogether/,
  );
  assertNotMatch(read, /!cardKinds\.has\(kind\)/);
});
