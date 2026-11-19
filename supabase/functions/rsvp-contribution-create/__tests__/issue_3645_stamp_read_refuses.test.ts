// Issue #3645 — a chip-in whose brand payout-hold stamp cannot be read is
// refused (retryable 503) before any contribution row, provider claim or
// Paystack initialize. Reading the failure as "unstamped" split a stamped
// brand's chip-in to the organiser at charge time, and the payout sweep then
// paid the organiser a second time.
//
// Runs the real serve callback; only import boundaries are substituted (the
// harness pattern of issue_3436_rsvp_link.tester.adversarial.test.ts). The
// stamp reader itself is the real module.
//
// Fails on revert: restoring the old "treating as unstamped" read lets the
// handler continue to the contribution insert, so status is not 503 and the
// insert/initialize lists are not empty.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PAYOUT_HOLD_UNREADABLE_ERROR,
  PAYOUT_HOLD_UNREADABLE_STATUS,
  readBrandPayoutHoldStamp,
} from "../../_shared/payoutHoldStamp.ts";

type Row = Record<string, unknown>;
type Brands = "error" | "throw" | "stamped";
const EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let brands: Brands = "error";
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
              brands: { slug: "brand", name: "Brand" },
            },
            error: null,
          };
        }
        if (table === "brands") {
          if (brands === "throw") throw new Error("socket closed");
          if (brands === "error") return { data: null, error: { message: "statement timeout" } };
          return { data: { payout_hold_cutover_at: "2026-01-01T00:00:00Z" }, error: null };
        }
        if (table === "event_rsvps") return { data: [], error: null };
        if (table === "event_rsvp_contributions") return { data: null, error: null };
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
            pricing_currency: provider === "paystack" ? "NGN" : "USD",
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
    currency: provider === "paystack" ? "NGN" : "USD",
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
  paystackInitializeTransaction: (input: Row) => {
    initialized.push(input);
    return Promise.resolve({ authorization_url: "https://x.invalid", reference: "r", access_code: "a" });
  },
};
const marker = Symbol.for("mingla.issue3645.stamp.boundary");
Reflect.set(globalThis, marker, boundary);
const prelude =
  `import {resolveContributionRsvpId,supabaseRsvpLinkReader} from ${
    JSON.stringify(new URL("../rsvpLink.ts", import.meta.url).href)
  };
const {${Object.keys(boundary).join(",")}} = globalThis[Symbol.for("mingla.issue3645.stamp.boundary")];`;
await import(`data:application/typescript,${encodeURIComponent(prelude + productionBody)}`);
Reflect.deleteProperty(globalThis, marker);

async function run(): Promise<Response> {
  inserted.length = 0;
  rpcs.length = 0;
  initialized.length = 0;
  return await handler(
    new Request("https://example.invalid/chip-in", {
      method: "POST",
      body: JSON.stringify({
        eventId: EVENT,
        guestEmail: "guest@example.com",
        amountCents: 50_000,
        callerIdempotencyKey: "stamp-key",
        surface: "web",
      }),
    }),
  );
}

for (const failure of ["error", "throw"] as const) {
  for (const rail of ["paystack", "stripe"] as const) {
    Deno.test(`#3645 chip-in: a stamp read ${failure} on ${rail} refuses before any row or provider call`, async () => {
      brands = failure;
      provider = rail;
      const response = await run();
      assertEquals(response.status, 503);
      assertEquals(await response.json(), { error: "payout_settings_unavailable" });
      assertEquals(inserted, []);
      assertEquals(initialized, []);
      assertEquals(rpcs.includes("issue_1930_claim_rsvp_provider_attempt"), false);
      assertEquals(rpcs.includes("pg_brand_can_collect"), false);
    });
  }
}

Deno.test("#3645 chip-in: a readable stamp still reaches the contribution insert", async () => {
  brands = "stamped";
  provider = "paystack";
  const response = await run();
  assertEquals(response.status !== 503, true);
  assertEquals(inserted.length, 1);
});
