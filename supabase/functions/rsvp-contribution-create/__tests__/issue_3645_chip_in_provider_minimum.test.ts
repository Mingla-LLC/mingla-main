// Issue #3645 (18 Nov payments audit, item 7) — a chip-in below the payment
// provider's minimum charge is refused with `amount_below_min` (the code the
// host minimum already uses, so every client handles it) and the provider
// floor as `minCents`, before any contribution row, provider-attempt claim,
// Paystack initialize or Stripe call. The floors are the shared publish-time
// table (`_shared/money/providerMinimums.ts`: ₦100 by Seth's #3355 decision,
// Stripe's table for the rest).
//
// Runs the real serve callback; only import boundaries are substituted (the
// harness of issue_3645_stamp_read_refuses.test.ts). The floor helper is the
// real module.
//
// Fails on revert: without the floor the handler continues to the insert and
// the provider, so the 422 and the empty insert/provider lists fail.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PAYOUT_HOLD_UNREADABLE_ERROR,
  PAYOUT_HOLD_UNREADABLE_STATUS,
  readBrandPayoutHoldStamp,
} from "../../_shared/payoutHoldStamp.ts";
import { chargeBelowProviderMinimum } from "../../_shared/money/providerMinimums.ts";

type Row = Record<string, unknown>;
const EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let hostMinCents: number | null = null;
let stripeCurrency = "USD";
let existingRow: Row | null = null;
let stripeReached = 0;
let provider: "stripe" | "paystack" = "paystack";
const inserted: Row[] = [];
const rpcs: string[] = [];
const initialized: Row[] = [];
let handler: (request: Request) => Promise<Response>;

function client() {
  return {
    from(table: string) {
      let operation = "select";
      const result = () => {
        if (operation === "insert") return { data: { id: "contribution-1" }, error: null };
        if (table === "events") {
          return {
            data: {
              id: EVENT,
              event_type: "rsvp",
              brand_id: "brand-1",
              title: "Test",
              status: "scheduled",
              visibility: "public",
              deleted_at: null,
              rsvp_contribution_enabled: true,
              rsvp_contribution_min_cents: hostMinCents,
              brands: { slug: "brand", name: "Brand" },
            },
            error: null,
          };
        }
        if (table === "brands") {
          return { data: { payout_hold_cutover_at: "2026-01-01T00:00:00Z" }, error: null };
        }
        if (table === "event_rsvps") return { data: [], error: null };
        if (table === "event_rsvp_contributions") return { data: existingRow, error: null };
        throw new Error(`Unexpected table ${table}`);
      };
      const chain = {
        select(_columns: string) {
          return chain;
        },
        eq(_key: string, _value: unknown) {
          return chain;
        },
        is(_key: string, _value: unknown) {
          return chain;
        },
        ilike(_key: string, _value: string) {
          return chain;
        },
        in(_key: string, _value: unknown[]) {
          return chain;
        },
        limit(_count: number) {
          return Promise.resolve().then(result);
        },
        single() {
          return Promise.resolve().then(result);
        },
        maybeSingle() {
          return Promise.resolve().then(result);
        },
        insert(row: Row) {
          operation = "insert";
          inserted.push(row);
          return chain;
        },
        update(_row: Row) {
          operation = "update";
          return chain;
        },
        then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
          return Promise.resolve().then(result).then(resolve, reject);
        },
      };
      return chain;
    },
    rpc(name: string) {
      rpcs.push(name);
      if (name === "pg_brand_can_collect") return Promise.resolve({ data: true, error: null });
      if (name === "resolve_event_pricing_inputs") {
        return Promise.resolve({
          data: [{
            pricing_region: provider === "paystack" ? "NG" : "US",
            pricing_currency: provider === "paystack" ? "NGN" : stripeCurrency,
            effective_take_rate_bps: 100,
            take_rate_source: "platform_default",
            stripe_account_id: "acct_fake",
            payment_provider: provider,
            payment_country: provider === "paystack" ? "NG" : "US",
            paystack_subaccount_code: "ACCT_organiser",
          }],
          error: null,
        });
      }
      // Anything past the stamp gate stops here: the refusal cases must
      // never reach a provider claim.
      return Promise.resolve({ data: { outcome: "in_progress", epoch: 1, idempotencyKey: "k" }, error: null });
    },
  };
}

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
const productionBody = source.replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];/gm, "");
const boundary = {
  serve: (callback: typeof handler) => {
    handler = callback;
  },
  corsHeaders: {},
  serviceClient: client,
  userIdFromAuthHeader: () => Promise.resolve(null),
  resolveProviderRouting: () => ({
    provider,
    currency: provider === "paystack" ? "NGN" : stripeCurrency,
  }),
  computeBuyerSubtotal: ({ baseCents }: { baseCents: number }) => ({
    buyerSubtotalCents: baseCents,
    miglaFeeCents: 10,
  }),
  buildPricingBreakdown: ({ amountTotalCents }: { amountTotalCents: number }) => ({
    buyer_total_cents: amountTotalCents,
    application_fee_amount_cents: 10,
  }),
  MINGLA_SERVICE_FEE_BPS: 0,
  readBrandPayoutHoldStamp,
  PAYOUT_HOLD_UNREADABLE_ERROR,
  PAYOUT_HOLD_UNREADABLE_STATUS,
  chargeBelowProviderMinimum,
  // The Stripe leg's first provider touch. Reaching it proves the floor let
  // the gift through; the refusal cases must never get here.
  stripeTicketCheckout: () => {
    stripeReached += 1;
    throw new Error("stripe_reached");
  },
  paystackInitializeTransaction: (input: Row) => {
    initialized.push(input);
    return Promise.resolve({ authorization_url: "https://x.invalid", reference: "r", access_code: "a" });
  },
};
const marker = Symbol.for("mingla.issue3645.floor.boundary");
Reflect.set(globalThis, marker, boundary);
const prelude =
  `import {resolveContributionRsvpId,supabaseRsvpLinkReader} from ${
    JSON.stringify(new URL("../rsvpLink.ts", import.meta.url).href)
  };
const {${Object.keys(boundary).join(",")}} = globalThis[Symbol.for("mingla.issue3645.floor.boundary")];`;
await import(`data:application/typescript,${encodeURIComponent(prelude + productionBody)}`);
Reflect.deleteProperty(globalThis, marker);

async function run(
  amountCents: number,
): Promise<{ status: number; body: unknown; stripeThrew: boolean }> {
  inserted.length = 0;
  rpcs.length = 0;
  initialized.length = 0;
  stripeReached = 0;
  try {
    const response = await handler(
      new Request("https://example.invalid/chip-in", {
        method: "POST",
        body: JSON.stringify({
          eventId: EVENT,
          guestEmail: "guest@example.com",
          amountCents,
          callerIdempotencyKey: `floor-key-${amountCents}`,
          surface: "web",
        }),
      }),
    );
    return { status: response.status, body: await response.json(), stripeThrew: false };
  } catch (error) {
    assertEquals((error as Error).message, "stripe_reached");
    return { status: 0, body: null, stripeThrew: true };
  }
}

const rails = [
  { rail: "paystack" as const, currency: "NGN", floor: 10_000 },
  { rail: "stripe" as const, currency: "USD", floor: 50 },
  { rail: "stripe" as const, currency: "GBP", floor: 30 },
  { rail: "stripe" as const, currency: "EUR", floor: 50 },
];

for (const { rail, currency, floor } of rails) {
  Deno.test(`#3645 chip-in floor (${rail} ${currency}): one minor unit under the provider minimum is refused before any row or provider call`, async () => {
    provider = rail;
    stripeCurrency = currency;
    existingRow = null;
    hostMinCents = null;
    const result = await run(floor - 1);
    assertEquals(result.status, 422);
    assertEquals(result.body, {
      error: "amount_below_min",
      minCents: floor,
      reason: "provider_minimum",
    });
    assertEquals(inserted, []);
    assertEquals(initialized, []);
    assertEquals(stripeReached, 0);
    assertEquals(rpcs.includes("issue_1930_claim_rsvp_provider_attempt"), false);
  });

  Deno.test(`#3645 chip-in floor (${rail} ${currency}): a 1-unit gift is refused the same way`, async () => {
    provider = rail;
    stripeCurrency = currency;
    existingRow = null;
    hostMinCents = null;
    const result = await run(1);
    assertEquals(result.status, 422);
    assertEquals((result.body as Record<string, unknown>).minCents, floor);
    assertEquals(inserted, []);
    assertEquals(initialized, []);
    assertEquals(stripeReached, 0);
  });

  Deno.test(`#3645 chip-in floor (${rail} ${currency}): exactly the provider minimum goes through to the provider`, async () => {
    provider = rail;
    stripeCurrency = currency;
    existingRow = null;
    hostMinCents = null;
    const result = await run(floor);
    // Past the floor: the contribution row is written and the provider
    // attempt is claimed (the harness's claim answers "in progress", which is
    // where this run stops; the floor is what the refusal cases never pass).
    assertEquals(result.status, 202);
    assertEquals(
      (result.body as Record<string, unknown>).error,
      "contribution_in_progress",
    );
    assertEquals(inserted.length, 1);
    assertEquals(inserted[0].amount_cents, floor);
    assertEquals(rpcs.includes("issue_1930_claim_rsvp_provider_attempt"), true);
  });

  Deno.test(`#3645 chip-in floor (${rail} ${currency}): a host minimum above the floor still wins, with its own refusal`, async () => {
    provider = rail;
    stripeCurrency = currency;
    existingRow = null;
    hostMinCents = floor * 3;
    const result = await run(floor * 2);
    assertEquals(result.status, 422);
    assertEquals(result.body, { error: "amount_below_min", minCents: floor * 3 });
    assertEquals(inserted, []);
    assertEquals(initialized, []);
    assertEquals(stripeReached, 0);
  });

  Deno.test(`#3645 chip-in floor (${rail} ${currency}): a host minimum below the floor gets the provider floor`, async () => {
    provider = rail;
    stripeCurrency = currency;
    existingRow = null;
    hostMinCents = 1;
    const result = await run(floor - 1);
    assertEquals(result.status, 422);
    assertEquals(result.body, {
      error: "amount_below_min",
      minCents: floor,
      reason: "provider_minimum",
    });
    assertEquals(inserted, []);
  });
}

Deno.test("#3645 chip-in floor: a retry of an EXISTING contribution row is not refused, so its provider recovery stays reachable", async () => {
  provider = "paystack";
  stripeCurrency = "USD";
  hostMinCents = null;
  // A row written before the floor shipped, possibly already at Paystack.
  existingRow = {
    id: "contribution-old",
    status: "failed",
    provider: "paystack",
    stripe_payment_intent_id: null,
    provider_attempt_state: "provider_unknown",
    user_id: null,
    guest_email: "guest@example.com",
    rsvp_id: null,
  };
  try {
    const result = await run(5_000);
    assertEquals(
      (result.body as Record<string, unknown> | null)?.reason === "provider_minimum",
      false,
    );
    assertEquals(rpcs.includes("issue_1930_claim_rsvp_provider_attempt"), true);
  } finally {
    existingRow = null;
  }
});
