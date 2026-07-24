import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPaystackTransferLeg,
  computePendingItems,
  matureTemporaryDebt,
  MoneyCandidate,
  openPostponementDebt,
  resolveLiveAnchor,
  withholdTemporaryDebt,
} from "../engine.ts";
import { handlePayoutReleaseSweep, providerReferenceRoute } from "../index.ts";

const DAY = 24 * 60 * 60 * 1000;
const iso = (day: number, seconds = 0) =>
  new Date(Date.UTC(2026, 6, 1) + day * DAY + seconds * 1000).toISOString();

const base = (overrides: Partial<MoneyCandidate> = {}): MoneyCandidate => ({
  sourceType: "order",
  sourceId: "source-1",
  brandId: "brand-a",
  eventId: "event-a",
  eventDateId: "date-1",
  provider: "stripe",
  currency: "usd",
  finalizedAt: iso(1),
  cutoverAt: iso(0),
  eventStatus: "scheduled",
  occurrences: [{ id: "date-1", endAt: iso(3) }],
  grossCents: 20_000,
  refundedCents: 1_000,
  disputedCents: 500,
  minglaFeeCents: 300,
  partnerShareCents: 30,
  providerFeeCents: 610,
  ...overrides,
});

Deno.test("seeded dark sweep emits exact single/multi/recurring/fallback rows and math", () => {
  const candidates = [
    base(),
    base({
      sourceId: "source-2",
      eventId: "event-multi",
      eventDateId: "date-late",
      occurrences: [
        { id: "date-early", endAt: iso(2) },
        { id: "date-late", endAt: iso(4) },
      ],
    }),
    base({
      sourceId: "source-3",
      eventId: "event-recurring",
      eventDateId: "date-current",
      occurrences: [
        { id: "date-current", endAt: iso(5) },
        { id: "future-top-up", endAt: iso(200) },
      ],
    }),
    base({
      sourceId: "source-4",
      eventId: "event-fallback",
      eventDateId: null,
      finalizedAt: iso(4),
      occurrences: [
        { id: "past", endAt: iso(2) },
        { id: "first-after", endAt: iso(5) },
        { id: "later", endAt: iso(20) },
      ],
    }),
    base({
      sourceId: "source-5",
      eventId: "door-sale",
      eventDateId: null,
      finalizedAt: iso(30),
      occurrences: [{ id: "a", endAt: iso(2) }, { id: "final", endAt: iso(6) }],
    }),
  ];
  const rows = computePendingItems(candidates, iso(40));
  assertEquals(rows.length, 5);
  assertEquals(rows[0].netCents, 17_560);
  assertEquals(rows.map((r) => r.anchorEndAt), [
    iso(3),
    iso(4),
    iso(5),
    iso(5),
    iso(6),
  ]);
  assertEquals(rows.map((r) => r.eventDateId), [
    "date-1",
    "date-late",
    "date-current",
    "first-after",
    "final",
  ]);
  assert(
    rows.every((r) =>
      Date.parse(r.releasableAt) === Date.parse(r.anchorEndAt) + 3 * DAY
    ),
  );
});

Deno.test("fallback occurrence identity cannot collide across events sharing an end time", () => {
  const rows = computePendingItems([
    base({
      sourceId: "fallback-a",
      eventId: "event-a",
      eventDateId: null,
      occurrences: [{ id: "event-a-date", endAt: iso(5) }],
    }),
    base({
      sourceId: "fallback-b",
      eventId: "event-b",
      eventDateId: null,
      occurrences: [{ id: "event-b-date", endAt: iso(5) }],
    }),
  ], iso(20));
  assertEquals(rows.map((row) => row.eventDateId), [
    "event-a-date",
    "event-b-date",
  ]);
  assert(rows[0].releaseKey !== rows[1].releaseKey);
});

Deno.test("provider references route by rail before any provider retrieval", () => {
  assertEquals(
    providerReferenceRoute("paystack", "pi_paystack_reference"),
    "paystack_reference",
  );
  assertEquals(providerReferenceRoute("stripe", "ch_123"), "stripe_charge");
  assertEquals(
    providerReferenceRoute("stripe", "pi_123"),
    "stripe_payment_intent",
  );
});

Deno.test("strict cutover, cancellation and one-money-object/one-release guards", () => {
  const candidates = [
    base({ sourceId: "equal", finalizedAt: iso(0), cutoverAt: iso(0) }),
    base({ sourceId: "before", finalizedAt: iso(0, -1), cutoverAt: iso(0) }),
    base({ sourceId: "after", finalizedAt: iso(0, 1), cutoverAt: iso(0) }),
    base({ sourceId: "cancelled", eventStatus: "cancelled" }),
    base({ sourceId: "already-attached" }),
  ];
  const rows = computePendingItems(
    candidates,
    iso(20),
    new Set(["order:already-attached"]),
  );
  assertEquals(rows.map((row) => row.sourceId), ["after"]);
});

Deno.test("live anchor moves at run time and never-ending recurrence stays per-occurrence", () => {
  const candidate = base({
    eventDateId: "booked",
    occurrences: [
      { id: "booked", endAt: iso(8) },
      { id: "rolling-future", endAt: iso(400) },
    ],
  });
  assertEquals(resolveLiveAnchor(candidate), iso(8));
  candidate.occurrences[0].endAt = iso(12);
  assertEquals(resolveLiveAnchor(candidate), iso(12));
});

Deno.test("provider charge fee stays separate from normalized Paystack transfer costs", () => {
  const row = computePendingItems([
    base({ provider: "paystack", currency: "ngn", providerFeeCents: 2_500 }),
  ], iso(20))[0];
  const organiser = buildPaystackTransferLeg("organiser", 2_000_000);
  const partner = buildPaystackTransferLeg("partner", 600_000);
  assertEquals(row.providerFeeCents, 2_500);
  assertEquals(organiser, {
    kind: "organiser",
    principalCents: 2_000_000,
    estimatedFeeCents: 2_500,
    stampDutyCents: 5_000,
    scheduleVersion: "verified-2026-07-24",
  });
  assertEquals(partner?.estimatedFeeCents, 2_500);
  assertEquals(partner?.stampDutyCents, 0);
  assertEquals(buildPaystackTransferLeg("partner", 4_999), null);
});

Deno.test("post-release postponement debt withholds same brand/currency and recredits recovered cash only", () => {
  let debt = openPostponementDebt({
    id: "debt-1",
    originReleaseId: "release-original",
    brandId: "brand-a",
    currency: "NGN",
    deliveredOrganiserCashCents: 10_000,
    liveEndAt: iso(10),
  });
  const wrongCurrency = withholdTemporaryDebt({
    debt,
    releaseId: "release-usd",
    releaseBrandId: "brand-a",
    releaseCurrency: "usd",
    availableCents: 9_000,
  });
  assertEquals(wrongCurrency.application, null);
  const partial = withholdTemporaryDebt({
    debt,
    releaseId: "release-next",
    releaseBrandId: "brand-a",
    releaseCurrency: "ngn",
    availableCents: 6_000,
  });
  debt = partial.debt;
  assertEquals(partial.remainingCents, 0);
  assertEquals(partial.application?.amountCents, 6_000);
  assertEquals(matureTemporaryDebt(debt, iso(12)).recreditCents, 0);
  const matured = matureTemporaryDebt(debt, iso(13));
  assertEquals(matured.recreditCents, 6_000);
  assertEquals(matured.unrecoveredClosedCents, 4_000);
  assertEquals(matured.debt.status, "closed");
  // The original occurrence never appears as a new payout; maturity is a recredit only.
  assertEquals(matured.debt.originReleaseId, "release-original");
});

Deno.test("internal handler fails closed before client creation and exact bearer reaches dark RPC only", async () => {
  let clientCreations = 0;
  let rpcCalls = 0;
  const rpcNames: string[] = [];
  const deps = {
    env: (key: string) =>
      key === "SUPABASE_URL"
        ? "https://example.test"
        : key === "SUPABASE_SERVICE_ROLE_KEY"
        ? "service-secret"
        : undefined,
    createAdmin: (() => {
      clientCreations++;
      return {
        rpc: (name: string) => {
          rpcCalls++;
          rpcNames.push(name);
          return Promise.resolve({
            data: name === "list_missing_payout_source_fees"
              ? []
              : { dark: true, executed: 0 },
            error: null,
          });
        },
        from: () => {
          throw new Error("no fee candidates means no write");
        },
      };
    }) as never,
    resolveProviderFee: () => {
      throw new Error("no fee candidates means no provider read");
    },
  };
  for (
    const value of [
      "",
      "Bearer wrong",
      "xBearer service-secret",
      "Bearer service-secretx",
    ]
  ) {
    const response = await handlePayoutReleaseSweep(
      new Request("https://example.test", {
        method: "POST",
        headers: value ? { authorization: value } : {},
      }),
      deps,
    );
    assertEquals(response.status, 401);
  }
  assertEquals(clientCreations, 0);
  const ok = await handlePayoutReleaseSweep(
    new Request("https://example.test", {
      method: "POST",
      headers: { authorization: "Bearer service-secret" },
    }),
    deps,
  );
  assertEquals(ok.status, 200);
  assertEquals(clientCreations, 1);
  assertEquals(rpcCalls, 2);
  assertEquals(rpcNames, [
    "list_missing_payout_source_fees",
    "run_payout_release_dark_sweep",
  ]);
  assertEquals((await ok.json()).dark, true);
});
