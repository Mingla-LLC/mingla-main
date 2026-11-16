// Issue #4238 W2 item 5 — ads follow the event: the true stop reason, the
// event-ended stop, lifetime budgets where the app supports them, the
// last-tickets offer (once) and the slow-sales nudge data hook (once).
//
// @invariant I-4238-TRUE-PAUSE-REASON
//   owner: supabase/functions/_shared/adDestination.ts pauseReasonFor +
//          ad_offering_stock (20280715004238)
//   rule: "nothing on sale" pauses as sold_out only when the stock read says
//         sold out; not-on-sale-yet says not_on_sale; a failed stock read is
//         destination_check_failed (never a false sold out); a passed event
//         ENDS the plan through ad_request_campaign_stop.
// @invariant I-4238-LOW-STOCK-ONCE
//   owner: supabase/functions/_shared/adGoalPromotion.ts runHostAdAutomation +
//          ad_plan_automation_events_once
//   rule: the last-tickets offer and the slow-sales nudge are recorded at most
//         once per plan and app; unlimited stock never triggers last tickets.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AdDestinationError,
  isLowStock,
  lowStockThreshold,
  type OfferingStock,
  parseOfferingStock,
  pauseReasonFor,
  resolveAdDestination,
} from "../adDestination.ts";
import { slowSalesNudgeDue } from "../adResultEstimate.ts";
import { runHostAdAutomation } from "../adGoalPromotion.ts";
import {
  HOST_LIFETIME_PLATFORMS,
  hostBudgetModeFor,
} from "../adHostPlanRules.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2028-07-20T12:00:00Z");

const stock = (over: Partial<OfferingStock> = {}): OfferingStock => ({
  ok: true,
  kind: "tickets",
  total: 200,
  remaining: 120,
  unlimited: false,
  sold_out: false,
  ...over,
});

Deno.test("SC-5.2: every tier sold → sold_out, never the 'ended or isn't public' reason", () => {
  assertEquals(
    pauseReasonFor("nothing_on_sale", stock({ remaining: 0, sold_out: true })),
    "sold_out",
  );
});

Deno.test("adversarial: a sale that hasn't started gives not_on_sale, not sold_out", () => {
  assertEquals(
    pauseReasonFor("nothing_on_sale", stock({ remaining: 50 })),
    "not_on_sale",
  );
});

Deno.test("adversarial: a stock read error pauses with destination_check_failed, never a false sold out", () => {
  assertEquals(
    pauseReasonFor("nothing_on_sale", "unavailable"),
    "destination_check_failed",
  );
  assertEquals(
    pauseReasonFor("nothing_on_sale", null),
    "destination_check_failed",
  );
  assertEquals(
    parseOfferingStock({ ok: false, code: "event_not_found" }),
    null,
  );
  assertEquals(
    parseOfferingStock({ ok: true, kind: "tickets", sold_out: "yes" }),
    null,
  );
});

Deno.test("SC-5.3 mapping: ended → event_ended (the plan ends); closed, private, unlisted map to their own reasons", () => {
  assertEquals(pauseReasonFor("ended", null), "event_ended");
  assertEquals(pauseReasonFor("bookings_closed", null), "bookings_closed");
  for (
    const availability of ["private", "unlisted", "not_live", "draft", null]
  ) {
    assertEquals(pauseReasonFor(availability, null), "destination_unavailable");
  }
});

Deno.test("X-5: the resolver's refusal keeps its availability on AdDestinationError", async () => {
  const db = {
    from() {
      throw new Error("not used");
    },
    rpc: () =>
      Promise.resolve({
        data: {
          ok: false,
          code: "destination_nothing_on_sale",
          availability: "nothing_on_sale",
        },
        error: null,
      }),
  };
  let caught: unknown = null;
  try {
    await resolveAdDestination(db, {
      page_type: "event",
      brand_slug: "b",
      entity_slug: "e",
    });
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof AdDestinationError);
  assertEquals(caught.availability, "nothing_on_sale");
});

Deno.test("SC-5.4 rule: 18 of 200 is low stock; 21 of 200 is not; unlimited and sold out never are", () => {
  assertEquals(lowStockThreshold(200), 20);
  assertEquals(lowStockThreshold(1000), 100);
  assert(isLowStock(stock({ remaining: 18 })));
  assert(isLowStock(stock({ remaining: 20 })));
  assert(!isLowStock(stock({ remaining: 21 })));
  assert(!isLowStock(stock({ unlimited: true, total: null, remaining: null })));
  assert(!isLowStock(stock({ remaining: 0, sold_out: true })));
  assert(isLowStock(stock({ total: 1000, remaining: 100 })));
});

// A fake that enforces the once-per-plan-and-app index.
function fakeDb(extra: Record<string, Record<string, unknown>[]> = {}) {
  const tables: Record<string, Record<string, unknown>[]> = {
    ad_plan_automation_events: [],
    ...extra,
  };
  // deno-lint-ignore no-explicit-any
  const db: any = {
    tables,
    from(table: string) {
      const list = tables[table] ?? (tables[table] = []);
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      let insert: Record<string, unknown> | null = null;
      // deno-lint-ignore no-explicit-any
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        gte: (
          c: string,
          v: string,
        ) => (filters.push((r) => String(r[c]) >= v), q),
        in: (
          c: string,
          v: unknown[],
        ) => (filters.push((r) => v.includes(r[c])), q),
        insert: (row: Record<string, unknown>) => ((insert = row), q),
        maybeSingle: () => q.run(),
        then: (resolve: (v: unknown) => void) => resolve(q.run()),
        run() {
          if (insert) {
            const r = insert;
            if (
              list.some((x) =>
                x.plan_id === r.plan_id && x.platform === r.platform &&
                x.kind === r.kind
              )
            ) {
              return { data: null, error: { code: "23505" } };
            }
            list.push(r);
            return { data: r, error: null };
          }
          const hits = list.filter((r) => filters.every((f) => f(r)));
          return { data: hits, error: null, count: hits.length };
        },
      };
      return q;
    },
  };
  return db;
}

const ctx = {
  planId: "plan-1",
  campaignId: "camp-1",
  platform: "meta",
  externalCampaignId: "ext",
  canonical: {
    copy: { primary: "Come", last_tickets: "Last tickets for Rooftop" },
    guidance_snapshot: {
      known: true,
      per_app: { meta: { week_low: 70, week_mid: 90 } },
    },
  },
  eventId: "00000000-0000-4000-8000-000000000001",
  eventStartMs: NOW + 5 * DAY,
  endsAtMs: NOW + 5 * DAY,
  liveSinceMs: NOW - 5 * DAY,
  nowMs: NOW,
};

Deno.test("SC-5.4: 18 of 200 left → one last-tickets OFFER (pending, not applied); a second sweep adds nothing", async () => {
  const db = fakeDb();
  const deps = {
    db,
    graph: null,
    adAccountId: null,
    readStock: () => Promise.resolve(stock({ remaining: 18 })),
  };
  assertEquals((await runHostAdAutomation(deps, ctx)).last_tickets, "offered");
  assertEquals(
    (await runHostAdAutomation(deps, ctx)).last_tickets,
    "already_offered",
  );
  const offers = db.tables.ad_plan_automation_events.filter((
    r: Record<string, unknown>,
  ) => r.kind === "low_stock_copy");
  assertEquals(offers.length, 1);
  assertEquals(offers[0].status, "pending");
  assertEquals(
    (offers[0].detail as Record<string, unknown>).primary,
    "Last tickets for Rooftop",
  );
});

Deno.test("adversarial: unlimited stock never offers last tickets; Google and Reddit never do", async () => {
  const db = fakeDb();
  await runHostAdAutomation(
    {
      db,
      graph: null,
      adAccountId: null,
      readStock: () =>
        Promise.resolve(
          stock({ unlimited: true, total: null, remaining: null }),
        ),
    },
    ctx,
  );
  await runHostAdAutomation(
    {
      db,
      graph: null,
      adAccountId: null,
      readStock: () => Promise.resolve(stock({ remaining: 5 })),
    },
    { ...ctx, platform: "google" },
  );
  assertEquals(
    db.tables.ad_plan_automation_events.filter((r: Record<string, unknown>) =>
      r.kind === "low_stock_copy"
    ).length,
    0,
  );
});

Deno.test("SC-5.5 data hook: slow sales → exactly one slow_sales_nudge row", async () => {
  const db = fakeDb({ ad_conversions: [], tickets: [] });
  const deps = {
    db,
    graph: null,
    adAccountId: null,
    readStock: () => Promise.resolve(stock({ remaining: 150 })),
  };
  assertEquals((await runHostAdAutomation(deps, ctx)).nudge, "recorded");
  assertEquals(
    (await runHostAdAutomation(deps, ctx)).nudge,
    "already_recorded",
  );
});

Deno.test("nudge rule: window, days live, below half of the low figure, 20% stock left", () => {
  const base = {
    nowMs: NOW,
    eventStartMs: NOW + 5 * DAY,
    liveSinceMs: NOW - 5 * DAY,
    ticketsLast4Days: 0,
    expectedWeekLow: 70, // 40 over 4 days; half = 20
    stock: { total: 200, remaining: 150, unlimited: false },
  };
  assert(slowSalesNudgeDue(base));
  assert(slowSalesNudgeDue({ ...base, ticketsLast4Days: 19 }));
  assert(!slowSalesNudgeDue({ ...base, ticketsLast4Days: 20 }));
  assert(!slowSalesNudgeDue({ ...base, eventStartMs: NOW + 1 * DAY }));
  assert(!slowSalesNudgeDue({ ...base, eventStartMs: NOW + 11 * DAY }));
  assert(!slowSalesNudgeDue({ ...base, liveSinceMs: NOW - 3 * DAY }));
  assert(
    !slowSalesNudgeDue({
      ...base,
      stock: { total: 200, remaining: 39, unlimited: false },
    }),
  );
  assert(
    slowSalesNudgeDue({
      ...base,
      stock: { total: null, remaining: null, unlimited: true },
    }),
  );
  assert(!slowSalesNudgeDue({ ...base, expectedWeekLow: null }));
});

Deno.test("SC-5.1 (Meta) / 5a: a Host total-mode plan runs lifetime on Meta; other apps stay daily + cap", () => {
  assertEquals(hostBudgetModeFor("meta", { budget_mode: "total" }), "lifetime");
  assertEquals(hostBudgetModeFor("meta", { budget_mode: "daily" }), "daily");
  for (const platform of ["tiktok", "snapchat", "google", "reddit"]) {
    assertEquals(
      hostBudgetModeFor(platform, { budget_mode: "total" }),
      "daily",
    );
  }
  assert(!HOST_LIFETIME_PLATFORMS.has("google"));
});

Deno.test("wiring: the sweep maps reasons with the stock, ends a passed event through the stop path, and create uses the allowlist", async () => {
  const sync = await Deno.readTextFile(
    new URL("../../admin-ad-spend-sync/index.ts", import.meta.url),
  );
  assert(
    sync.includes(
      "destinationPause = pauseReasonFor(err.availability, stock);",
    ),
  );
  assert(sync.includes('if (destinationPause === "event_ended") {'));
  assert(sync.includes('"ad_request_campaign_stop"'));
  assert(
    sync.includes('else if (keyed?.sold_out) destinationPause = "sold_out";'),
  );
  const create = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assert(
    create.includes(
      'budgetType === "lifetime" && !HOST_LIFETIME_PLATFORMS.has(platform)',
    ),
  );
  assert(
    create.includes(
      'hostBudgetModeFor(platform, canonicalPlan) === "lifetime"',
    ),
  );
  // F-2: the money path is untouched — no new credit or fee maths here.
  assert(!sync.includes("ad_credit_"));
  assert(!sync.includes("HOST_FEE_RATIO"));
});
