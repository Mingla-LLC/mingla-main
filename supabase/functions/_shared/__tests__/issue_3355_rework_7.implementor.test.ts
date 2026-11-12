// #3355 rework 7 (after Retest 7 FAIL). The tester's root cause: the status
// rule was applied to the whole quote / sentence, so one negation, date or
// condition word anywhere switched it off and the older card rules decided;
// and "an older / other saved record backs it" still had two exits. Each case
// pins the server, never the model: the judge is stubbed with the claim
// shapes it returns (or fails), the database with a fake caller client. Folds
// the retest-7 repro (R7-1 … R7-9, R7-14).
//
// MINGLA-INVARIANT: I-ARI-STATUS-PER-ASSERTED-CLAUSE | issue #3355 | (rework 7, extends I-ARI-STATUS-FROM-NAMED-FRESH-ROW) A reply sentence is cut into clauses; a clause that asserts a current or past positive status of an event, RSVP, trip, experience, stay, venue, tier, blast, website, refund or payout readiness is held to this turn's brand-scoped status read (never a loop read) whatever another clause negates, dates or conditions; plans, conditions and negations ("will be", "once published", "isn't yet", "if you publish") are not positive assertions, and a true negative ("still a draft") stands; once a claim is a status claim it is never decided by the older card rules; when the read fails only THIS turn's write for the same object (by id, else title), and only for the state that write produced, backs it; a valid intent read decides write vs status and the grammar rule only applies when it failed (enforced by supabase/functions/_shared/__tests__/issue_3355_rework_7.implementor.test.ts).

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AriClaim,
  type AriClaimKind,
  asksAboutExisting,
  buildClaimEvidence,
  checkReplyClaims,
  type ClaimObservation,
  type ClaimRecordsRead,
  fixClockPairs,
  previousTurnText,
  quoteAssertsLive,
  recordsShowSentence,
  stateProducedBy,
  statusAssertion,
  writeObjectId,
} from "../ariClaimCheck.ts";
import {
  objectStatusReadPlan,
  type StatusClient,
  titleCandidates,
} from "../ariStatusRead.ts";
import { type WriteState } from "../ariTruthGuards.ts";
import {
  type AriGapSignal,
  decideAriEscalation,
  readAriAskTeamDeclined,
} from "../ariGaps.ts";
import {
  canonicalizeCreateDiscountArgs,
  withHostStatedDiscountCode,
} from "../ariDiscountArgs.ts";
import {
  withAriLocalTimesInText,
  withAriLocalTimesOnlyInText,
} from "../ariLocalTime.ts";
import {
  checkPostApprovalClaims,
  readCallerBrandRole,
} from "../agentPostApproval.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER_BRAND = "99999999-9999-4999-8999-999999999999";
const USER = "77777777-7777-4777-8777-777777777777";
const EV1 = "22222222-2222-4222-8222-222222222222";
const EV2 = "22222222-2222-4222-8222-333333333333";
const EV3 = "22222222-2222-4222-8222-444444444444";
const EV4 = "22222222-2222-4222-8222-555555555555";

type Rows = Array<Record<string, unknown>>;

/** A caller client over in-memory tables (eq / in filters honoured). */
function fake(tables: Record<string, Rows | "error"> = {}): StatusClient {
  return {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        is: () => builder,
        not: () => builder,
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
    rpc() {
      return Promise.resolve({ data: null, error: { message: "unknown" } });
    },
  };
}

const card = (
  tool: string,
  object: string | null,
  args: Record<string, unknown> = {},
): WriteState => ({
  actionId: `a-${tool}-${object}`,
  toolName: tool,
  status: "executed",
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
  observations?: ClaimObservation[];
  objects?: string[];
  read?: ReturnType<typeof brandRead>;
  asked?: boolean;
  intentRead?: boolean;
  previousTurn?: string;
}): Promise<string> {
  const states = a.states ?? [];
  const out = await checkReplyClaims({
    text: a.reply,
    hostMessage: a.host,
    intent: "question",
    recentWrite: true,
    objects: a.objects ??
      states.flatMap((state) => state.object ? [state.object] : []),
    evidence: buildClaimEvidence({
      states,
      observations: a.observations ?? [],
      isReadTool: (tool) => /^(?:list|get)_/.test(tool),
    }),
    statusRead: objectStatusReadPlan({
      client: fake(a.tables ?? {}),
      brandId: BRAND,
      text: a.reply,
      cards: states,
      hostMessage: a.host,
      brandRole: null,
      ...(a.previousTurn ? { previousTurn: a.previousTurn } : {}),
    }),
    ...(a.read ? { moreEvidence: a.read } : {}),
    askedWriteThisTurn: a.asked ?? false,
    ...(a.intentRead !== undefined ? { intentRead: a.intentRead } : {}),
    ...(a.previousTurn ? { previousTurn: a.previousTurn } : {}),
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
const ended = {
  id: EV3,
  brand_id: BRAND,
  title: "October Rooftop",
  status: "ended",
  event_type: "event",
};
const trip = {
  id: EV4,
  brand_id: BRAND,
  title: "Calabar Weekend",
  status: "draft",
  event_type: "trip",
};

// ── R7-1 / R7-4: per asserted clause ───────────────────────────────────────

Deno.test("R7-1: a negation in another clause never turns the status rule off; another event's card never backs it", async () => {
  const reply =
    "Yes, your event is published, so you don't need to do anything else.";
  for (
    const judge of JUDGES(claim(reply, "published", "event", "your event"))
  ) {
    const out = await run({
      host: "Is Lagos Night Out published?",
      reply,
      claims: judge,
      tables: { events: [draftNight, pubBrunch] },
      states: [card("publish_event", "Abuja Brunch", { event_id: EV2 })],
    });
    assertNotMatch(out, /is published/, `${JSON.stringify(judge)}: ${out}`);
    assertMatch(out, /Lagos Night Out as a draft/, out);
  }
});

Deno.test("R7-4: with the judge down or empty, a status sentence with a date, condition or negation clause is checked", async () => {
  for (
    const reply of [
      "Yes, Lagos Night Out is published and starts on Friday 19 December at 8 PM.",
      "Yes, Lagos Night Out is live, so people can buy tickets before Friday.",
      "Yes, Lagos Night Out is published, and it doesn't need approval.",
    ]
  ) {
    for (const judge of [[], "fail"] as const) {
      const out = await run({
        host: "Is Lagos Night Out published?",
        reply,
        claims: judge,
        tables: { events: [draftNight, pubBrunch] },
      });
      assertMatch(out, /Lagos Night Out as a draft/, `${judge}: ${out}`);
    }
  }
});

Deno.test("R7-1/R7-4: plans, conditions and how-to answers are not positive assertions (kept)", async () => {
  for (
    const reply of [
      "Once published, guests can buy tickets.",
      "Your event will be live once you publish it.",
      "If you publish Lagos Night Out, it goes live on Mingla straight away.",
      "Lagos Night Out isn't published yet. You can publish it from Events.",
    ]
  ) {
    for (const judge of [[], "fail"] as const) {
      const out = await run({
        host: "How do I publish Lagos Night Out?",
        reply,
        claims: judge,
        tables: { events: [draftNight, pubBrunch] },
      });
      assertEquals(out, reply, `${judge}`);
    }
  }
  // Per clause: the asserted clause, not a modal elsewhere in the sentence.
  assert(quoteAssertsLive("Should I tell your guests FAVY10 now works?"));
  assert(!quoteAssertsLive("FAVY10 will be live from Friday"));
  assert(quoteAssertsLive("FAVY10 is live, so you don't need a new code"));
});

Deno.test("R7-13: judge down, a true mixed sentence keeps its true half", async () => {
  const reply =
    "Abuja Brunch is published, but Lagos Night Out is still a draft.";
  for (const judge of [[], "fail"] as const) {
    const out = await run({
      host: "Which of my events are live?",
      reply,
      claims: judge,
      tables: { events: [draftNight, pubBrunch] },
    });
    assertEquals(out, reply, `${judge}`);
  }
});

Deno.test("statusAssertion: positive, negative and plan clauses", () => {
  const event = new Set<AriClaimKind>(["event"]);
  assertEquals(
    statusAssertion(
      claim("Yes, it's published and starts on Friday.", "published", "event"),
      event,
    )?.positive,
    true,
  );
  assertEquals(
    statusAssertion(
      claim("Not yet — your event is still a draft.", "live", "event"),
      event,
    )?.positive,
    false,
  );
  assertEquals(
    statusAssertion(
      claim("It will be live once you publish it.", "live", "event"),
      event,
    ),
    null,
  );
  // A write claim that mentions a draft is decided by its receipt.
  assertEquals(
    statusAssertion(
      claim("I've created Lagos Night Out as a draft.", "created", "event"),
      event,
    ),
    null,
  );
});

// ── R7-2: a failed read is never backed by another object's write ──────────

Deno.test("R7-2: when the status read fails, only this turn's write for the same object and state backs it", async () => {
  const other = "Done! Lagos Night Out is live.";
  const out1 = await run({
    host: "Create Abuja Brunch for me",
    reply: other,
    claims: [claim(other, "live", "event", "Lagos Night Out")],
    asked: true,
    tables: { events: "error" },
    observations: [{
      tool: "create_event",
      args: { title: "Abuja Brunch" },
      result: {
        event: {
          id: EV2,
          title: "Abuja Brunch",
          status: "draft",
          event_type: "event",
        },
      },
    }],
  });
  assertNotMatch(out1, /is live/, out1);
  assertMatch(out1, /couldn't check/, out1);
  // A create saves a draft: it never backs "live".
  const live = "Your event is live!";
  for (const judge of [[claim(live, "live", "event", "your event")], "fail"]) {
    const out = await run({
      host: "Create Lagos Night Out",
      reply: live,
      claims: judge as readonly AriClaim[] | "fail",
      asked: true,
      tables: { events: "error" },
      observations: [{
        tool: "create_event",
        args: { title: "Lagos Night Out" },
        result: { ok: true },
      }],
    });
    assertNotMatch(out, /is live/, out);
  }
  // This turn's publish of ANOTHER object never backs it.
  const otherPublish = await run({
    host: "Publish Abuja Brunch",
    reply: other,
    claims: [claim(other, "live", "event", "Lagos Night Out")],
    asked: true,
    tables: { events: "error" },
    observations: [{
      tool: "publish_event",
      args: { event_id: EV2, title: "Abuja Brunch" },
      result: { event: { id: EV2, title: "Abuja Brunch" } },
    }],
  });
  assertNotMatch(otherPublish, /is live/, otherPublish);
  // This turn's publish of the same object does back it.
  const published = "Lagos Night Out is now live.";
  const out2 = await run({
    host: "Publish Lagos Night Out",
    reply: published,
    claims: [claim(published, "live", "event", "Lagos Night Out")],
    asked: true,
    tables: { events: "error" },
    observations: [{
      tool: "publish_event",
      args: { event_id: EV1 },
      result: { event: { id: EV1, title: "Lagos Night Out" } },
    }],
  });
  assertEquals(out2, published);
  assertEquals(stateProducedBy("create_event"), null);
  assertEquals(stateProducedBy("publish_event"), "live");
  assertEquals(stateProducedBy("unpublish_event"), null);
  assertEquals(stateProducedBy("send_campaign"), "sent");
  assertEquals(writeObjectId({ event_id: EV1 }, null), EV1);
  assertEquals(writeObjectId({}, { event: { id: EV2 } }), EV2);
});

Deno.test("R7-9: another brand's loop read never backs a status when the brand read fails", async () => {
  const reply = "Yes, Lagos Night Out is live.";
  const out = await run({
    host: "Is Lagos Night Out live?",
    reply,
    claims: [claim(reply, "live", "event", "Lagos Night Out")],
    tables: { events: "error" },
    observations: [{
      tool: "list_events",
      args: {},
      result: {
        events: [{
          id: "x",
          brand_id: OTHER_BRAND,
          title: "Lagos Night Out",
          status: "scheduled",
          event_type: "event",
        }],
      },
    }],
  });
  assertNotMatch(out, /is live/, out);
});

// ── R7-3: the intent read is authoritative ─────────────────────────────────

Deno.test("R7-3: a write request phrased as a question with no write verb is a write when the intent read says so", async () => {
  const done = "Done! Your student discount is live.";
  for (
    const host of [
      "Can I get a 15% code for students?",
      "How about a 15% student discount?",
      "Could I have a student code as well?",
      "What about a code for students too?",
      "Any chance you could make a student code?",
    ]
  ) {
    assert(!asksAboutExisting(host), host);
    const out = await run({
      host,
      reply: done,
      claims: [claim(done, "live", "discount", "your student discount")],
      states: [codeCard("FAVY10")],
      objects: ["FAVY10"],
      read: brandRead({ FAVY10: "active" }),
      asked: true,
      intentRead: true,
    });
    assert(out !== done && !/is live/.test(out), `${host}: ${out}`);
  }
  for (
    const host of [
      "Did it go through?",
      "Is it live?",
      "Has my blast gone out?",
      "Can guests see it?",
      "Is there a student code?",
    ]
  ) {
    assert(asksAboutExisting(host), host);
  }
});

Deno.test("R7-3: a valid intent read that says no write is not overridden by the grammar rule; a failed one is", async () => {
  const done = "Done! Your student discount is live.";
  const base = {
    host: "Can you make a student code?",
    reply: done,
    claims: [claim(done, "live", "discount", "your student discount")],
    states: [codeCard("FAVY10")],
    objects: ["FAVY10"],
    read: brandRead({ FAVY10: "active" }),
  };
  // The valid read said this is not a write: the confirmed card it follows
  // (FAVY10, read active this turn) decides.
  assertEquals(
    await run({ ...base, asked: false, intentRead: true }),
    done,
  );
  // The read failed: the grammar rule says write, and no record backs it.
  assert(
    await run({ ...base, asked: false, intentRead: false }) !== done,
  );
});

// ── R7-5: the obvious object, not "which one?" ─────────────────────────────

Deno.test("R7-5: one current object of the kind (ended rows and trips aside) is the object", async () => {
  const yes = "Yes, your event is published.";
  for (const events of [[pubBrunch, ended], [pubBrunch, trip]]) {
    const out = await run({
      host: "Is my event published?",
      reply: yes,
      claims: [claim(yes, "published", "event", "your event")],
      tables: { events },
    });
    assertEquals(out, yes);
  }
  // …and a false one is still corrected.
  const out = await run({
    host: "Is my event published?",
    reply: yes,
    claims: [claim(yes, "published", "event", "your event")],
    tables: { events: [draftNight, ended] },
  });
  assertMatch(out, /Lagos Night Out as a draft/, out);
});

Deno.test("R7-5: a claim about all of them checks each one (at most five)", async () => {
  const both = "Yes, both of your events are published.";
  const allLive = await run({
    host: "Are all my events published?",
    reply: both,
    claims: [claim(both, "published", "event", "your events")],
    tables: { events: [{ ...draftNight, status: "scheduled" }, pubBrunch] },
  });
  assertEquals(allLive, both);
  const oneDraft = await run({
    host: "Are all my events published?",
    reply: both,
    claims: [claim(both, "published", "event", "your events")],
    tables: { events: [draftNight, pubBrunch] },
  });
  assertMatch(oneDraft, /Lagos Night Out as a draft/, oneDraft);
});

Deno.test("R7-5: 'is it live?' resolves to the object the previous turn named, with no card", async () => {
  const reply = "Yes, it's live!";
  for (const judge of JUDGES(claim(reply, "live", "event", "it"))) {
    const out = await run({
      host: "Is it live?",
      reply,
      claims: judge,
      tables: { events: [draftNight, pubBrunch] },
      previousTurn:
        "What about Lagos Night Out?\nLagos Night Out has 2 ticket tiers.",
    });
    assertMatch(out, /Lagos Night Out as a draft/, `${judge}: ${out}`);
  }
  assertEquals(
    previousTurnText([
      { role: "user", content: { text: "old" } },
      { role: "assistant", content: { text: "Abuja Brunch is live." } },
      { role: "user", content: { text: "What about Lagos Night Out?" } },
      { role: "assistant", content: { text: "It has 2 tiers." } },
      { role: "tool", content: { text: "" } },
    ]),
    "What about Lagos Night Out?\nIt has 2 tiers.",
  );
});

Deno.test("R7-14: judge down, 'Yes, it's live!' after a create card is checked against that card's object", async () => {
  const reply = "Yes, it's live!";
  const out = await run({
    host: "is it live?",
    reply,
    claims: "fail",
    states: [card("create_event", "Lagos Night Out", { event_id: EV1 })],
    tables: { events: [draftNight, pubBrunch] },
  });
  assertMatch(out, /Lagos Night Out as a draft/, out);
});

// ── R7-6: a true negative stands ───────────────────────────────────────────

Deno.test("R7-6: a true 'still a draft' answer is kept; a false one is corrected", async () => {
  const reply = "Not yet — your event is still a draft.";
  const kept = await run({
    host: "Is my event published?",
    reply,
    claims: [claim(reply, "live", "event", "your event")],
    tables: { events: [draftNight, ended] },
  });
  assertEquals(kept, reply);
  const wrong = await run({
    host: "Is my event published?",
    reply,
    claims: [claim(reply, "live", "event", "your event")],
    tables: { events: [pubBrunch, ended] },
  });
  assertMatch(wrong, /Abuja Brunch as published/, wrong);
  assertNotMatch(wrong, /saved change/, wrong);
});

// ── R7-7 / R7-8: twins and judge mislabels ─────────────────────────────────

Deno.test("R7-7: twin titles are told apart by the card's id; with no card, Ari asks", async () => {
  const reply = "Yes, Friday Party is live.";
  const events = [
    { ...draftNight, title: "Friday Party" },
    { ...pubBrunch, title: "Friday Party" },
  ];
  const byId = await run({
    host: "Is Friday Party live?",
    reply,
    claims: [claim(reply, "live", "event", "Friday Party")],
    tables: { events },
    states: [card("publish_event", "Friday Party", { event_id: EV2 })],
  });
  assertEquals(byId, reply);
  const noCard = await run({
    host: "Is Friday Party live?",
    reply,
    claims: [claim(reply, "live", "event", "Friday Party")],
    tables: { events },
  });
  assertMatch(noCard, /more than one event called Friday Party/, noCard);
});

Deno.test("R7-8: a titled event claim the judge labels 'discount' is held to the event's row", async () => {
  const reply = "Yes, Lagos Night Out is live.";
  const out = await run({
    host: "Is Lagos Night Out live?",
    reply,
    claims: [claim(reply, "live", "discount", "Lagos Night Out")],
    tables: { events: [draftNight, pubBrunch] },
    states: [codeCard("FAVY10")],
  });
  assertMatch(out, /Lagos Night Out as a draft/, out);
});

// ── R7-10 / R7-11: ask-the-team and the host's own code ───────────────────

Deno.test("R7-10: a just-cancelled 'Ask the Mingla team' card is not offered again", async () => {
  const failures: AriGapSignal[] = [];
  const recentGaps = [{ type: "refusal" }, { type: "repeated_request" }];
  assertEquals(
    decideAriEscalation({ ownerSignals: failures, recentGaps }).escalate,
    true,
  );
  assertEquals(
    decideAriEscalation({
      ownerSignals: failures,
      recentGaps,
      askTeamDeclined: true,
    }).escalate,
    false,
  );
  // A new strong frustration signal still offers it.
  assertEquals(
    decideAriEscalation({
      ownerSignals: [{ type: "frustration", strong: true, excerpt: "x" }],
      recentGaps,
      askTeamDeclined: true,
    }).escalate,
    true,
  );
  const now = Date.parse("2026-11-11T12:00:00Z");
  const reader = (rows: Rows) =>
    readAriAskTeamDeclined({
      caller: fake({
        agent_pending_actions: rows,
      }) as unknown as SupabaseClient,
      conversationId: "c1",
      now,
    });
  assertEquals(
    await reader([{
      conversation_id: "c1",
      tool_name: "tell_owner_in_brand_group",
      status: "cancelled",
      created_at: "2026-11-11T11:50:00Z",
    }]),
    true,
  );
  assertEquals(
    await reader([{
      conversation_id: "c1",
      tool_name: "tell_owner_in_brand_group",
      status: "cancelled",
      created_at: "2026-11-11T10:00:00Z",
    }]),
    false,
  );
  assertEquals(
    await reader([{
      conversation_id: "c1",
      tool_name: "tell_owner_in_brand_group",
      status: "executed",
      created_at: "2026-11-11T11:50:00Z",
    }]),
    false,
  );
});

Deno.test("R7-11: the host's valid code replaces a mangled one; the host is never told their code is invalid", () => {
  const mangled = {
    kind: "code",
    code: "FAVY 10%",
    value_type: "percent",
    value_bps: 1000,
  };
  const fixed = withHostStatedDiscountCode(
    "create_discount",
    mangled,
    "FAVY10",
  );
  assertEquals(fixed.code, "FAVY10");
  assertEquals(canonicalizeCreateDiscountArgs(fixed).code, "FAVY10");
  // A valid proposal code is the model's to keep; no host code: unchanged.
  assertEquals(
    withHostStatedDiscountCode(
      "create_discount",
      { ...mangled, code: "GIRLS20" },
      "FAVY10",
    ).code,
    "GIRLS20",
  );
  assertEquals(
    withHostStatedDiscountCode("create_discount", mangled, null).code,
    "FAVY 10%",
  );
  assertEquals(
    withHostStatedDiscountCode("create_event", mangled, "FAVY10").code,
    "FAVY 10%",
  );
});

// ── R7-12 / R7-15 / R7-16 / R7-17 / R7-18 ─────────────────────────────────

Deno.test("R7-12: the records sentence reads well for every label", () => {
  assertEquals(
    recordsShowSentence("Lagos Night Out", "a draft"),
    "Your records show Lagos Night Out as a draft.",
  );
  assertEquals(
    recordsShowSentence("Ikoyi Loft", "in review"),
    "Your records show Ikoyi Loft is in review.",
  );
  assertEquals(
    recordsShowSentence("the refund", "still processing"),
    "Your records show the refund is still processing.",
  );
});

Deno.test("R7-15: the post-approval check applies the caller's role (hidden kinds said so)", async () => {
  const reply = "Your website is now live.";
  const client = fake({
    brands: [],
    brand_team_members: [{
      user_id: USER,
      brand_id: BRAND,
      role: "scanner",
      brand: { id: BRAND, name: "B", slug: "b", deleted_at: null },
    }],
    brand_sites: [{ brand_id: BRAND, status: "published" }],
  }) as unknown as SupabaseClient;
  assertEquals(await readCallerBrandRole(client, USER, BRAND), "scanner");
  const out = await checkPostApprovalClaims({
    text: reply,
    hostMessage: "Publish my site",
    toolName: "publish_event",
    toolArgs: { brand_id: BRAND, event_id: EV1 },
    result: { ok: true },
    observations: [],
    client,
    userId: USER,
    brandId: BRAND,
    call: () => Promise.resolve({ claims: [claim(reply, "live", "website")] }),
  });
  assertMatch(out.text, /your role on this brand doesn't include it/, out.text);
});

Deno.test("R7-16: an older offering named by title is read by its title", async () => {
  assertEquals(titleCandidates("Is Lagos Night Out live?"), [
    "Is Lagos Night Out",
    "Lagos Night Out",
  ]);
  const old = { ...draftNight, title: "Old Gala", id: EV3 };
  // The recent read (25 most recent) does not hold it; the title read does.
  const calls: string[] = [];
  const base = fake({ events: [old] });
  const client: StatusClient = {
    from(table: string) {
      const builder = base.from(table);
      const inner = builder.in;
      builder.in = (column: string, value: unknown) => {
        calls.push(column);
        return inner(column, value);
      };
      return builder;
    },
    rpc: base.rpc,
  };
  const plan = objectStatusReadPlan({
    client,
    brandId: BRAND,
    text: "Yes, Old Gala is published.",
    cards: [],
    hostMessage: "Is Old Gala published?",
  });
  const read = await plan.read();
  assert(calls.includes("title"), JSON.stringify(calls));
  assert(read.records.some((row) => row.objects.includes("Old Gala")));
});

Deno.test("R7-17: the brand snapshot says each instant in the brand's own time alone", () => {
  const line =
    '- event "Abuja Brunch" scheduled, starts 2026-12-05T10:00:00.000Z';
  assertEquals(
    withAriLocalTimesOnlyInText(line, "Africa/Lagos"),
    '- event "Abuja Brunch" scheduled, starts Sat 5 Dec 2026, 11:00 am Lagos time',
  );
  assertNotMatch(withAriLocalTimesOnlyInText(line, "Africa/Lagos"), /10:00/);
  // Tool results keep the raw ISO beside it (machines read it).
  assertMatch(withAriLocalTimesInText(line, "Africa/Lagos"), /10:00:00/);
});

Deno.test("R7-18: a clock pair with no card in the chat points to Mingla Host", () => {
  const text = "It starts at 18:00 (7:00 PM) Lagos time.";
  assertEquals(
    fixClockPairs(text, false),
    "It starts at the time shown in Mingla Host.",
  );
  assertEquals(
    fixClockPairs(text),
    "It starts at the time shown on the card.",
  );
});

Deno.test("rework 7 wiring: agent-chat passes the intent source, the previous turn, the decline read and the host's code", async () => {
  const source = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertEquals(
    source.match(/intentFromModel: intentResult\.source === "model"/g)?.length,
    3,
  );
  assertMatch(source, /intentRead: args\.intentFromModel/);
  assertMatch(source, /const previousTurn = previousTurnText\(args\.history\)/);
  assertMatch(
    source,
    /readAriAskTeamDeclined\(\{ caller: userClient, conversationId \}\)/,
  );
  assertMatch(source, /askTeamDeclined,\n\s+\}\)/);
  assertEquals(
    source.match(/withHostStatedDiscountCode\(\n\s+tool\.name,/g)?.length,
    2,
  );
});
