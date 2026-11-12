// #3355 rework 5b (Seth 2026-11-11 "check all"): the fresh status read of
// every object Ari can create or change the status of, beyond discount
// codes, notes and tickets: events / RSVPs, trips, experiences, stays,
// venues, ticket tiers, blasts, the brand website, refunds and payout
// readiness. The judge is stubbed with the claim shapes it returns and the
// database with a fake caller client; each case pins the server, never the
// model.
//
// MINGLA-INVARIANT: I-ARI-STATUS-FROM-FRESH-READ-ALL-OBJECTS | issue #3355 | (rework 5b, Seth 2026-11-11 "check all"; extends I-ARI-STATUS-FROM-FRESH-READ beyond discount codes) A status answer about an event, RSVP, trip, experience, stay, venue, ticket tier, blast, the brand website, a refund or payout readiness ("Your event is published", "The blast went out", "Your website is published", said by the judge's claim or found by the deterministic pass) is decided by ONE batched, brand-scoped read done in THIS turn as the caller (ariStatusRead.ts readObjectStatuses; it starts beside the judge call and is cut at 1.5 s; each kind fails on its own): its row beats any older receipt or card; a contradicted status is replaced in place by the true state ("Your records show X as a draft."); when that kind's read failed or ran past its cap, the status is replaced by "I couldn't check X's current status just now" and is never asserted, unless a write saved in this very turn backs it (enforced by supabase/functions/_shared/__tests__/issue_3355_rework_5b.implementor.test.ts).

import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AriClaim,
  type AriClaimKind,
  buildClaimEvidence,
  checkReplyClaims,
  type StatusReadPlan,
} from "../ariClaimCheck.ts";
import {
  objectStatusReadPlan,
  readObjectStatuses,
  type StatusClient,
  statusKindsWanted,
} from "../ariStatusRead.ts";
import { type WriteState } from "../ariTruthGuards.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const EVENT = "22222222-2222-4222-8222-222222222222";
const TRIP = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const VENUE = "55555555-5555-4555-8555-555555555555";
const ORDER = "66666666-6666-4666-8666-666666666666";

type Rows = Array<Record<string, unknown>>;

interface Fake {
  client: StatusClient;
  calls: Array<{ table: string; filters: Array<[string, unknown]> }>;
}

/**
 * A caller client: each table returns its rows (filtered by eq / in), or an
 * error; `delayMs` holds every answer.
 */
function fakeClient(args: {
  tables?: Record<string, Rows | "error">;
  rpc?: Record<string, unknown>;
  delayMs?: number;
  /** Never answers (a hung read). */
  hang?: boolean;
}): Fake {
  const calls: Fake["calls"] = [];
  const answer = <T>(value: T): Promise<T> =>
    args.hang
      ? new Promise<T>(() => {})
      : new Promise((resolve) =>
        setTimeout(() => resolve(value), args.delayMs ?? 0)
      );
  const client: StatusClient = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      calls.push({ table, filters });
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push([`eq:${column}`, value]);
          return builder;
        },
        in: (column: string, value: unknown) => {
          filters.push([`in:${column}`, value]);
          return builder;
        },
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (
          resolve: (value: { data: unknown; error: unknown }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => {
          const rows = args.tables?.[table];
          if (rows === "error") {
            return answer({ data: null, error: { message: "denied" } }).then(
              resolve,
              reject,
            );
          }
          const kept = (rows ?? []).filter((row) =>
            filters.every(([key, value]) => {
              const [op, column] = key.split(":");
              if (!(column in row)) return true;
              return op === "eq"
                ? row[column] === value
                : (value as unknown[]).includes(row[column]);
            })
          );
          return answer({ data: kept, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc(fn: string, params?: Record<string, unknown>) {
      calls.push({ table: `rpc:${fn}`, filters: [["args", params]] });
      const value = args.rpc?.[fn];
      return answer(
        value === "error"
          ? { data: null, error: { message: "denied" } }
          : { data: value ?? null, error: null },
      );
    },
  };
  return { client, calls };
}

function card(
  tool: string,
  object: string | null,
  extra: Record<string, unknown> = {},
  status: WriteState["status"] = "executed",
): WriteState {
  return {
    actionId: `a-${tool}-${object}`,
    toolName: tool,
    status,
    object,
    args: { ...(object ? { title: object } : {}), ...extra },
    receiptText: null,
  };
}

const claim = (
  quote: string,
  action: AriClaim["action"],
  kind: AriClaimKind,
  object: string | null = null,
): AriClaim => ({ quote, action, kind, object });

async function check(args: {
  host: string;
  reply: string;
  claims?: readonly AriClaim[] | "fail";
  states?: WriteState[];
  objects?: string[];
  client?: StatusClient;
  plan?: StatusReadPlan;
  judgeMs?: number;
  asked?: boolean;
}) {
  const states = args.states ?? [];
  return await checkReplyClaims({
    text: args.reply,
    hostMessage: args.host,
    intent: "question",
    recentWrite: true,
    objects: args.objects ??
      states.flatMap((state) => state.object ? [state.object] : []),
    evidence: buildClaimEvidence({ states }),
    statusRead: args.plan ??
      objectStatusReadPlan({
        client: args.client as StatusClient,
        brandId: BRAND,
        text: args.reply,
        cards: states,
      }),
    askedWriteThisTurn: args.asked ?? false,
    call: () =>
      args.claims === "fail"
        ? Promise.reject(new Error("HTTP 503"))
        : new Promise((resolve) =>
          setTimeout(
            () => resolve({ claims: args.claims ?? [] }),
            args.judgeMs ?? 0,
          )
        ),
  });
}

const event = (status: string, extra: Record<string, unknown> = {}) => ({
  id: EVENT,
  brand_id: BRAND,
  title: "Lagos Night Out",
  status,
  event_type: "event",
  ...extra,
});

// ── The five required cases ─────────────────────────────────────────────────

Deno.test("5b: 'Your event is published' when the event is a draft (older publish card, fresh draft row)", async () => {
  const reply = "Your event is published. Guests can buy tickets now.";
  const fake = fakeClient({ tables: { events: [event("draft")] } });
  const out = await check({
    host: "is my event published?",
    reply,
    claims: [claim("Your event is published.", "published", "event")],
    // The chat holds an earlier publish receipt; the fresh row beats it.
    states: [card("publish_event", "Lagos Night Out", { event_id: EVENT })],
    client: fake.client,
  });
  assertEquals(out.statusRead, "ok");
  // Rework 6 (R6-8): the follow-on sentence that leaned on the false status
  // goes with it.
  assertEquals(out.text, "Your records show Lagos Night Out as a draft.");
  // Brand-scoped: every events read is filtered to the active brand.
  const reads = fake.calls.filter((call) => call.table === "events");
  assert(reads.length > 0);
  for (const read of reads) {
    assert(
      read.filters.some(([key, value]) =>
        key === "eq:brand_id" && value === BRAND
      ),
    );
  }
  // The true state is kept verbatim.
  const kept = await check({
    host: "is my event published?",
    reply,
    claims: [claim("Your event is published.", "published", "event")],
    states: [card("publish_event", "Lagos Night Out", { event_id: EVENT })],
    client: fakeClient({ tables: { events: [event("scheduled")] } }).client,
  });
  assertEquals(kept.text, reply);
});

Deno.test("5b: 'Your trip is live' when the trip is cancelled", async () => {
  const reply = "Your trip is live!";
  const out = await check({
    host: "how's my trip doing?",
    reply,
    claims: [claim(reply, "live", "trip")],
    states: [card("publish_trip", "Zanzibar Escape", { event_id: TRIP })],
    client: fakeClient({
      tables: {
        events: [{
          id: TRIP,
          brand_id: BRAND,
          title: "Zanzibar Escape",
          status: "cancelled",
          event_type: "trip",
        }],
      },
    }).client,
  });
  assertEquals(out.text, "Your records show Zanzibar Escape as cancelled.");
});

Deno.test("5b: 'The blast went out' when the blast is only scheduled", async () => {
  const reply = "The blast went out to 240 guests.";
  const out = await check({
    host: "did my blast go out?",
    reply,
    // The schedule card was executed: an older receipt that would back
    // "sent" on its own.
    claims: [claim(reply, "sent", "message")],
    states: [
      card("schedule_campaign", "Friday Lineup", { campaign_id: CAMPAIGN }),
    ],
    client: fakeClient({
      tables: {
        marketing_campaigns: [{
          id: CAMPAIGN,
          brand_id: BRAND,
          name: "Friday Lineup",
          status: "scheduled",
        }],
      },
    }).client,
  });
  assertEquals(
    out.text,
    "Your records show Friday Lineup as scheduled, not sent yet.",
  );
});

Deno.test("5b: 'Your website is published' when the website is not provisioned", async () => {
  const reply = "Your website is published at lagosnights.usemingla.com.";
  // No brand_sites row: the brand has no website.
  const none = await check({
    host: "is my site up?",
    reply,
    claims: [claim(reply, "published", "website")],
    client: fakeClient({ tables: { brand_sites: [] } }).client,
  });
  assertEquals(none.text, "Your records show your website as not set up yet.");
  // Still provisioning.
  const provisioning = await check({
    host: "is my site up?",
    reply,
    claims: [claim(reply, "published", "website")],
    client: fakeClient({
      tables: { brand_sites: [{ brand_id: BRAND, status: "provisioning" }] },
    }).client,
  });
  assertEquals(
    provisioning.text,
    "Your records show your website is still being set up.",
  );
  // Published: kept.
  const published = await check({
    host: "is my site up?",
    reply,
    claims: [claim(reply, "published", "website")],
    client: fakeClient({
      tables: { brand_sites: [{ brand_id: BRAND, status: "published" }] },
    }).client,
  });
  assertEquals(published.text, reply);
});

Deno.test("5b: a status read timeout never asserts a positive status; it is cut at 1.5 s beside the judge", async () => {
  const reply = "Your event is published.";
  const started = Date.now();
  const out = await check({
    host: "is my event published?",
    reply,
    claims: [claim(reply, "published", "event")],
    states: [card("publish_event", "Lagos Night Out", { event_id: EVENT })],
    // The read never answers.
    client: fakeClient({ tables: { events: [event("scheduled")] }, hang: true })
      .client,
  });
  const elapsed = Date.now() - started;
  assertEquals(out.statusRead, "failed");
  assert(!/is published/i.test(out.text), out.text);
  assertEquals(
    out.text,
    "I couldn't check Lagos Night Out's current status just now. You can see it in Events.",
  );
  assert(elapsed < 1_900, `the hung read held the turn ${elapsed} ms`);
  // Unnamed: the kind's noun.
  const blast = await check({
    host: "did it go out?",
    reply: "The blast went out.",
    claims: [claim("The blast went out.", "sent", "message")],
    plan: {
      kinds: new Set(["message"] as AriClaimKind[]),
      read: () => new Promise(() => {}),
    },
  });
  assertEquals(
    blast.text,
    "I couldn't check your blast's current status just now. You can see it in Marketing, under Blasts.",
  );
  // A write saved in this very turn still backs it (post-approval).
  const saved = await checkReplyClaims({
    text: reply,
    hostMessage: "publish it",
    intent: "tool",
    recentWrite: true,
    objects: ["Lagos Night Out"],
    evidence: buildClaimEvidence({
      states: [],
      observations: [{
        tool: "publish_event",
        args: { event_id: EVENT, title: "Lagos Night Out" },
        result: { status: "scheduled" },
      }],
      isReadTool: () => false,
    }),
    statusRead: {
      kinds: new Set(["event"] as AriClaimKind[]),
      read: () => new Promise(() => {}),
    },
    askedWriteThisTurn: false,
    approved: true,
    call: () =>
      Promise.resolve({
        claims: [claim(reply, "published", "event")],
      }),
  });
  assertEquals(saved.text, reply);
});

Deno.test("5b latency: the status read runs beside the judge", async () => {
  const started = Date.now();
  await check({
    host: "is my event published?",
    reply: "Your event is published.",
    claims: [claim("Your event is published.", "published", "event")],
    states: [card("publish_event", "Lagos Night Out", { event_id: EVENT })],
    judgeMs: 400,
    client:
      fakeClient({ tables: { events: [event("scheduled")] }, delayMs: 400 })
        .client,
  });
  const elapsed = Date.now() - started;
  assert(
    elapsed < 750,
    `judge and status read ran one after the other: ${elapsed}`,
  );
});

// ── The deterministic pass (judge lists nothing, or fails) ─────────────────

Deno.test("5b: with the judge listing nothing or failing, a status said as fact is held to the fresh read", async () => {
  for (const claims of [[], "fail"] as const) {
    const draft = await check({
      host: "is my event published?",
      reply: "Yes, your event is published.",
      claims,
      states: [card("publish_event", "Lagos Night Out", { event_id: EVENT })],
      client: fakeClient({ tables: { events: [event("draft")] } }).client,
    });
    assertEquals(draft.text, "Your records show Lagos Night Out as a draft.");
    // A title said as fact.
    const titled = await check({
      host: "how's Lagos Night Out?",
      reply: "Lagos Night Out is live and selling well.",
      claims,
      client: fakeClient({ tables: { events: [event("ended")] } }).client,
    });
    assertEquals(titled.text, "Your records show Lagos Night Out as ended.");
    const blast = await check({
      host: "did my blast go out?",
      reply: "Yes, the Friday Lineup blast went out this morning.",
      claims,
      client: fakeClient({
        tables: {
          marketing_campaigns: [{
            id: CAMPAIGN,
            brand_id: BRAND,
            name: "Friday Lineup",
            status: "scheduled",
          }],
        },
      }).client,
    });
    assertEquals(
      blast.text,
      "Your records show Friday Lineup as scheduled, not sent yet.",
    );
    const timeout = await check({
      host: "is my site live?",
      reply: "Your website is published.",
      claims,
      plan: {
        kinds: new Set(["website"] as AriClaimKind[]),
        read: () => new Promise(() => {}),
      },
    });
    assertMatch(
      timeout.text,
      /^I couldn't check your website's current status just now\./,
    );
  }
});

Deno.test("5b: instructions, plans, negations and true statuses are never touched", async () => {
  const client = fakeClient({
    tables: {
      events: [event("draft")],
      brand_sites: [],
      marketing_campaigns: [{
        id: CAMPAIGN,
        brand_id: BRAND,
        name: "Friday Lineup",
        status: "scheduled",
      }],
    },
  }).client;
  for (
    const reply of [
      "Once published, your event shows on Explore.",
      "Your event isn't published yet. Tap Publish when you're ready.",
      "Your blast will go out on Friday at 9am.",
      "When your website is published, guests can find it on Google.",
      "Is your event published? I can check.",
      "Lagos Night Out is a draft.",
      "Your event is a draft, so it isn't live yet.",
    ]
  ) {
    for (const claims of [[], "fail"] as const) {
      const out = await check({ host: "help", reply, claims, client });
      assertEquals(out.text, reply, reply);
    }
  }
});

// ── Every other kind ────────────────────────────────────────────────────────

Deno.test("5b: venues, stays, tiers, sold out, refunds and payouts are each read and decided", async () => {
  const venue = await check({
    host: "is my venue live?",
    reply: "Your venue is approved and live on Mingla.",
    claims: [
      claim("Your venue is approved and live on Mingla.", "live", "venue"),
    ],
    states: [card("submit_venue_claim", "Bar Rumba", { venue_id: VENUE })],
    client: fakeClient({
      tables: {
        venue_listings: [{
          id: VENUE,
          brand_id: BRAND,
          name: "Bar Rumba",
          claim_status: "pending_review",
        }],
      },
    }).client,
  });
  assertEquals(venue.text, "Your records show Bar Rumba as pending review.");

  const stay = await check({
    host: "is my stay open?",
    reply: "Your stay is live for bookings.",
    claims: [claim("Your stay is live for bookings.", "live", "stay")],
    states: [card("publish_stay", null, { venue_id: VENUE })],
    client: fakeClient({
      tables: {
        venue_listings: [{
          id: VENUE,
          brand_id: BRAND,
          name: "Bar Rumba",
          claim_status: "verified",
        }],
        stay_settings: [{
          venue_id: VENUE,
          brand_id: BRAND,
          booking_state: "review",
        }],
      },
    }).client,
  });
  assertEquals(stay.text, "Your records show Bar Rumba is in review.");

  const tier = await check({
    host: "is VIP on sale?",
    reply: "Your VIP tier is on sale.",
    claims: [claim("Your VIP tier is on sale.", "live", "ticket", "VIP")],
    states: [
      card("upsert_ticket_tier", "VIP", { event_id: EVENT, name: "VIP" }),
    ],
    client: fakeClient({
      tables: {
        events: [event("scheduled")],
        ticket_types: [{
          id: "t1",
          event_id: EVENT,
          name: "VIP",
          is_disabled: true,
        }],
      },
    }).client,
  });
  assertEquals(tier.text, "Your records show VIP as turned off.");

  const soldOut = await check({
    host: "how are sales?",
    reply: "Lagos Night Out is sold out!",
    claims: [
      claim("Lagos Night Out is sold out!", "live", "event", "Lagos Night Out"),
    ],
    client: fakeClient({
      tables: { events: [event("scheduled")] },
      rpc: {
        pg_public_ticket_types_remaining: [{
          ticket_type_id: "t1",
          remaining: 12,
        }],
      },
    }).client,
  });
  assertEquals(soldOut.text, "Lagos Night Out still has tickets available.");
  const really = await check({
    host: "how are sales?",
    reply: "Lagos Night Out is sold out!",
    claims: [
      claim("Lagos Night Out is sold out!", "live", "event", "Lagos Night Out"),
    ],
    client: fakeClient({
      tables: { events: [event("scheduled")] },
      rpc: {
        pg_public_ticket_types_remaining: [{
          ticket_type_id: "t1",
          remaining: 0,
        }],
      },
    }).client,
  });
  assertEquals(really.text, "Lagos Night Out is sold out!");

  const refund = await check({
    host: "did the refund go through?",
    reply: "The refund went through.",
    claims: [claim("The refund went through.", "completed", "refund")],
    states: [card("refund_order", null, { order_id: ORDER })],
    client: fakeClient({
      tables: { refunds: [{ order_id: ORDER, status: "pending" }] },
    }).client,
  });
  assertEquals(
    refund.text,
    "Your records show the refund is still processing.",
  );

  const payout = await check({
    host: "can I get paid out?",
    reply: "Your payouts are ready.",
    claims: [claim("Your payouts are ready.", "completed", "payout")],
    client:
      fakeClient({ rpc: { pg_brand_can_payout_for_caller: false } }).client,
  });
  assertEquals(payout.text, "Your records show your payouts as not ready yet.");
});

Deno.test("5b: one batched read; each kind fails on its own; RLS-denied kinds are never asserted", async () => {
  const fake = fakeClient({
    tables: { events: [event("draft")], venue_listings: "error" },
  });
  const reply = "Your event is published. Your venue is approved.";
  const out = await check({
    host: "status?",
    reply,
    claims: [
      claim("Your event is published.", "published", "event"),
      claim("Your venue is approved.", "live", "venue"),
    ],
    states: [card("publish_event", "Lagos Night Out", { event_id: EVENT })],
    client: fake.client,
  });
  assertEquals(out.statusRead, "partial");
  assertEquals(
    out.text,
    "Your records show Lagos Night Out as a draft. I couldn't check your venue's current status just now. You can see it in Venues.",
  );
  // Every read targets the active brand only, never another one.
  const result = await readObjectStatuses({
    client: fakeClient({
      tables: {
        events: [event("draft"), {
          ...event("scheduled"),
          id: "x",
          brand_id: OTHER,
          title: "Not Yours",
        }],
      },
    }).client,
    brandId: BRAND,
    kinds: new Set(["event"] as AriClaimKind[]),
    cards: [],
  });
  assertEquals(result.records.map((item) => item.objects[0]), [
    "Lagos Night Out",
  ]);
  // No brand: nothing is read and nothing is asserted.
  const noBrand = await readObjectStatuses({
    client: fake.client,
    brandId: null,
    kinds: new Set(["event"] as AriClaimKind[]),
    cards: [],
  });
  // Rework 6: one events read answers events, trips and experiences.
  assertEquals(noBrand.failedKinds, ["event", "trip", "experience"]);
});

Deno.test("5b: the read covers only the kinds the reply speaks about", () => {
  // Rework 6 (rule 3): this is the prefetch beside the judge, never a gate;
  // one events read answers events, trips and experiences.
  assertEquals(
    [...statusKindsWanted({ text: "Your event is published.", cards: [] })],
    ["event", "trip", "experience"],
  );
  assertEquals(
    [...statusKindsWanted({
      text: "Here is how to make a discount.",
      cards: [],
    })],
    [],
  );
  // "It's live!" with a trip card in the chat: the card's kind.
  assertEquals(
    [
      ...statusKindsWanted({
        text: "It's live!",
        cards: [card("publish_trip", "Zanzibar Escape")],
      }),
    ].sort(),
    ["event", "experience", "trip"],
  );
});

Deno.test("5b wiring: both callers pass the object status read", async () => {
  const chat = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertMatch(
    chat,
    /statusRead: objectStatusReadPlan\(\{\s*client: args\.userClient,\s*brandId: args\.brandId,/,
  );
  const post = await Deno.readTextFile(
    new URL("../agentPostApproval.ts", import.meta.url),
  );
  assertMatch(
    post,
    /statusRead: objectStatusReadPlan\(\{\s*client: args\.client,/,
  );
});
