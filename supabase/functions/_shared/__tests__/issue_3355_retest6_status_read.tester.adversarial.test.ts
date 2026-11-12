// #3355 Retest 6 (tester adversarial): the rework 5b fresh status read,
// attacked from angles the implementor's suite does not cover. Each case pins
// a behaviour that holds at the tested commit and fails when its fix line is
// deleted (fails-on-revert recorded in the Retest 6 verdict):
//   1. a status read row is matched to the reply's title whatever its case
//      and punctuation ("LAGOS NIGHT OUT is live!!");
//   2. a payout read that answers with no boolean is a failed kind, never a
//      "ready" (the predicate is not re-derived);
//   3. "sold out" with remaining inventory: an unlimited tier (remaining
//      null) is never sold out; a reader error is "couldn't check";
//   4. a tier whose sale ended is "no longer on sale", a sending campaign is
//      not "sent";
//   5. a malformed brand id reads nothing and asserts nothing (every kind
//      failed, so a positive status becomes "couldn't check");
//   6. the shape RLS really gives a hidden row (an empty result, not an
//      error, measured on the local stack for a scanner): an unpublished
//      website reads as "not set up yet", never as published;
//   7. a mixed reply (event + blast) where only the blast read failed keeps
//      the event decision and never asserts the blast.
// The judge is stubbed; the database is a fake caller client.

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
} from "../ariClaimCheck.ts";
import {
  objectStatusReadPlan,
  readObjectStatuses,
  soldOutOf,
  type StatusClient,
} from "../ariStatusRead.ts";
import { type WriteState } from "../ariTruthGuards.ts";

const BRAND = "a6a6a6a6-0000-4000-8000-000000000001";
const EVENT = "a6a6a6a6-0000-4000-8000-0000000000e1";
const TIER = "a6a6a6a6-0000-4000-8000-0000000000f1";
const CAMPAIGN = "a6a6a6a6-0000-4000-8000-0000000000c1";

type Rows = Array<Record<string, unknown>>;

function client(
  tables: Record<string, Rows | "error"> = {},
  rpc: Record<string, unknown> = {},
): StatusClient {
  return {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
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
            return Promise.resolve({
              data: null,
              error: { message: "permission denied" },
            }).then(resolve);
          }
          const kept = (rows ?? []).filter((row) =>
            filters.every(([op, column, value]) =>
              !(column in row) ||
              (op === "eq"
                ? row[column] === value
                : (value as unknown[]).includes(row[column]))
            )
          );
          return Promise.resolve({ data: kept, error: null }).then(resolve);
        },
      };
      return builder;
    },
    rpc(fn: string) {
      const value = rpc[fn];
      return Promise.resolve(
        value === "error"
          ? { data: null, error: { message: "denied" } }
          : { data: value ?? null, error: null },
      );
    },
  };
}

function card(
  tool: string,
  object: string | null,
  args: Record<string, unknown> = {},
): WriteState {
  return {
    actionId: `a-${tool}-${object}`,
    toolName: tool,
    status: "executed",
    object,
    args: { ...(object ? { title: object } : {}), ...args },
    receiptText: null,
  };
}

const claim = (
  quote: string,
  action: AriClaim["action"],
  kind: AriClaimKind,
  object: string | null,
): AriClaim => ({ quote, action, kind, object });

async function check(args: {
  reply: string;
  claims: readonly AriClaim[] | "fail";
  states?: WriteState[];
  db: StatusClient;
  brandId?: string;
}) {
  const states = args.states ?? [];
  return await checkReplyClaims({
    text: args.reply,
    hostMessage: "what's the status?",
    intent: "question",
    recentWrite: true,
    objects: states.flatMap((state) => state.object ? [state.object] : []),
    evidence: buildClaimEvidence({ states }),
    statusRead: objectStatusReadPlan({
      client: args.db,
      brandId: args.brandId ?? BRAND,
      text: args.reply,
      cards: states,
    }),
    askedWriteThisTurn: false,
    call: () =>
      args.claims === "fail"
        ? Promise.reject(new Error("HTTP 503"))
        : Promise.resolve({ claims: args.claims }),
  });
}

const draft = {
  id: EVENT,
  brand_id: BRAND,
  title: "Lagos Night Out",
  status: "draft",
  event_type: "event",
};

Deno.test("retest6 1: the reply's title matches the row whatever its case and punctuation", async () => {
  const reply = "LAGOS NIGHT OUT is live!!";
  const out = await check({
    reply,
    claims: [claim(reply, "live", "event", "LAGOS NIGHT OUT")],
    states: [card("publish_event", "Lagos Night Out", { event_id: EVENT })],
    db: client({ events: [draft] }),
  });
  assertEquals(out.statusRead, "ok");
  assertEquals(out.text, "Your records show Lagos Night Out as a draft.");
});

Deno.test("retest6 2: a payout read without a boolean is a failed kind, never 'ready'", async () => {
  for (const data of [null, "true", 1, { ok: true }]) {
    const read = await readObjectStatuses({
      client: client({}, { pg_brand_can_payout_for_caller: data }),
      brandId: BRAND,
      kinds: new Set<AriClaimKind>(["payout"]),
      cards: [],
    });
    assertEquals(read.failedKinds, ["payout"], JSON.stringify(data));
    assertEquals(read.records.length, 0);
  }
  const reply = "Your payouts are ready.";
  const out = await check({
    reply,
    claims: [claim(reply, "live", "payout", "your payouts")],
    db: client({}, { pg_brand_can_payout_for_caller: "true" }),
  });
  assertEquals(out.statusRead, "failed");
  assertMatch(out.text, /couldn't check your payouts' current status/);
  assert(!/ready\./.test(out.text), out.text);
});

Deno.test("retest6 3: sold out — unlimited tiers are never sold out; a reader error is 'couldn't check'", async () => {
  assertEquals(soldOutOf([{ ticket_type_id: TIER, remaining: null }]), false);
  assertEquals(
    soldOutOf([{ remaining: 0 }, { remaining: null }]),
    false,
  );
  assertEquals(soldOutOf([{ remaining: 0 }, { remaining: 0 }]), true);
  assertEquals(soldOutOf([]), undefined);
  const published = { ...draft, status: "scheduled" };
  const reply = "Lagos Night Out is sold out!";
  const unlimited = await check({
    reply,
    claims: [claim(reply, "live", "event", "Lagos Night Out")],
    db: client({ events: [published] }, {
      pg_public_ticket_types_remaining: [{
        ticket_type_id: TIER,
        remaining: null,
      }],
    }),
  });
  assertEquals(unlimited.text, "Lagos Night Out still has tickets available.");
  const broken = await check({
    reply,
    claims: [claim(reply, "live", "event", "Lagos Night Out")],
    db: client({ events: [published] }, {
      pg_public_ticket_types_remaining: "error",
    }),
  });
  assertEquals(
    broken.text,
    "I couldn't check whether Lagos Night Out is sold out just now.",
  );
});

Deno.test("retest6 4: a tier whose sale ended is not on sale; a sending blast is not sent", async () => {
  const published = { ...draft, status: "scheduled" };
  const tier = {
    id: TIER,
    event_id: EVENT,
    name: "Early Bird",
    is_disabled: false,
    sale_end_at: "2026-01-01T00:00:00Z",
  };
  const reply = "The Early Bird tier is on sale.";
  const out = await check({
    reply,
    claims: [claim(reply, "live", "ticket", "Early Bird")],
    states: [card("update_ticket_tier", "Early Bird", {
      ticket_type_id: TIER,
      event_id: EVENT,
    })],
    db: client({ events: [published], ticket_types: [tier] }),
  });
  assertEquals(out.text, "Your records show Early Bird as no longer on sale.");
  const blast = "The Friday Lineup blast went out.";
  const sending = await check({
    reply: blast,
    claims: [claim(blast, "sent", "message", "Friday Lineup")],
    states: [card("send_campaign", "Friday Lineup", { campaign_id: CAMPAIGN })],
    db: client({
      marketing_campaigns: [{
        id: CAMPAIGN,
        brand_id: BRAND,
        name: "Friday Lineup",
        status: "sending",
      }],
    }),
  });
  assertEquals(
    sending.text,
    "Your records show Friday Lineup is still sending.",
  );
});

Deno.test("retest6 5: a malformed brand id reads nothing and asserts nothing", async () => {
  let touched = 0;
  const spy: StatusClient = {
    from: () => {
      touched++;
      return client().from("events");
    },
    rpc: () => {
      touched++;
      return Promise.resolve({ data: true, error: null });
    },
  };
  for (const brandId of ["", "not-a-uuid", `${BRAND}' or '1'='1`]) {
    const read = await readObjectStatuses({
      client: spy,
      brandId,
      kinds: new Set<AriClaimKind>(["event", "payout", "website"]),
      cards: [],
    });
    assertEquals(read.records, []);
    // Rework 6: one events read answers events, trips and experiences.
    assertEquals(read.failedKinds.sort(), [
      "event",
      "experience",
      "payout",
      "trip",
      "website",
    ]);
  }
  assertEquals(touched, 0);
  const reply = "Your payouts are ready.";
  const out = await check({
    reply,
    claims: [claim(reply, "live", "payout", "your payouts")],
    db: spy,
    brandId: "not-a-uuid",
  });
  assertMatch(out.text, /couldn't check/);
});

Deno.test("retest6 6: a website row hidden by RLS (empty result) is never published", async () => {
  // Measured on the local stack (Retest 6): a scanner's brand_sites read
  // returns [] with no error.
  const reply = "Your website is published.";
  for (
    const claims of [
      [claim(reply, "published", "website", "your website")],
      "fail",
    ] as const
  ) {
    const out = await check({
      reply,
      claims,
      db: client({ brand_sites: [] }),
    });
    assertEquals(out.statusRead, "ok");
    assert(!/is published/.test(out.text), out.text);
    assertEquals(out.text, "Your records show your website as not set up yet.");
  }
});

Deno.test("retest6 7: a mixed reply keeps the event decision when only the blast read fails", async () => {
  const reply =
    "Lagos Night Out is published. The Friday Lineup blast went out.";
  const out = await check({
    reply,
    claims: [
      claim(
        "Lagos Night Out is published.",
        "published",
        "event",
        "Lagos Night Out",
      ),
      claim(
        "The Friday Lineup blast went out.",
        "sent",
        "message",
        "Friday Lineup",
      ),
    ],
    states: [
      card("publish_event", "Lagos Night Out", { event_id: EVENT }),
      card("send_campaign", "Friday Lineup", { campaign_id: CAMPAIGN }),
    ],
    db: client({ events: [draft], marketing_campaigns: "error" }),
  });
  assertEquals(out.statusRead, "partial");
  assertMatch(out.text, /Your records show Lagos Night Out as a draft\./);
  assertMatch(out.text, /couldn't check Friday Lineup's current status/);
  assert(!/went out/.test(out.text), out.text);
  assert(!/is published/.test(out.text), out.text);
});
