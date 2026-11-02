/**
 * #4238 retest 3 — one money formatter for Host ad money.
 *
 * The canonical formatter lives in _shared/adMoneyFormat.ts (edge code can
 * bundle it). The Business Ari card reads a mirror; this test fails if the
 * two ever print different text, or if either side formats money another way.
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { formatHostAdMoneyCents } from "../adMoneyFormat.ts";
import { preflightMoneyProposal } from "../agentDomainTools.ts";

import { formatHostAdMoneyCents as mirror } from "../../../../mingla-business/src/components/marketing/ads/hostAdMoney.ts";

const CASES: Array<[unknown, unknown]> = [
  [150_000_000, "NGN"],
  [150_000_000, "ngn"],
  [25_000, "GBP"],
  [0, "USD"],
  [5, "USD"],
  [99, "EUR"],
  [100_000_000_000, "NGN"],
  [123_456, null],
  [123_456, ""],
  [123_456, "NAIRA"],
  [-1, "NGN"],
  [1.5, "NGN"],
  [Number.NaN, "NGN"],
  ["2500", "GBP"],
];

Deno.test("#4238 retest 3 Host ad money is written one way", () => {
  assertEquals(formatHostAdMoneyCents(150_000_000, "NGN"), "NGN 1,500,000.00");
  assertEquals(formatHostAdMoneyCents(25_000, "GBP"), "GBP 250.00");
  assertEquals(formatHostAdMoneyCents(5, "USD"), "USD 0.05");
  assertEquals(formatHostAdMoneyCents(123_456, null), "1,234.56");
  assertEquals(formatHostAdMoneyCents(-1, "NGN"), null);
});

Deno.test("#4238 retest 3 the Business mirror prints exactly the same text", async () => {
  for (const [value, currency] of CASES) {
    assertEquals(
      mirror(value, currency),
      formatHostAdMoneyCents(value, currency),
      `${String(value)} ${String(currency)}`,
    );
  }
  const canonical = await Deno.readTextFile(
    new URL("../adMoneyFormat.ts", import.meta.url),
  );
  const copy = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/components/marketing/ads/hostAdMoney.ts",
      import.meta.url,
    ),
  );
  const body = (source: string) =>
    source.slice(source.indexOf("export function"));
  assertEquals(body(copy), body(canonical));
});

Deno.test("#4238 retest 3 Ari and its card use the one formatter", async () => {
  const ari = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  assert(
    ari.includes(
      'import { formatHostAdMoneyCents } from "./adMoneyFormat.ts";',
    ),
  );
  assert(!ari.includes("toFixed(2)} ${code}"));
  const card = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/components/ari/ToolProposalCard.tsx",
      import.meta.url,
    ),
  );
  assert(card.includes("return formatHostAdMoneyCents(cents, currency);"));
  assert(!card.includes("`${amount} ${code}`"));
});

// ── Retest 4: "What we count" on the LAUNCH card ────────────────────────────

const PLAN = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const BRAND = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);

function launchClient(
  destination: Record<string, unknown>,
  hierarchy: string[],
) {
  return {
    functions: {
      invoke: () =>
        Promise.resolve({
          error: null,
          data: {
            plan: {
              id: PLAN,
              brand_id: BRAND,
              owner_kind: "host",
              state: "ready",
            },
            version: {
              id: VERSION,
              plan_hash: HASH,
              host_currency: "NGN",
              host_budget_cents: 30000,
              canonical_plan: {
                destination,
                audience_intent: { countries: ["NG"] },
                schedule: {},
                copy: { primary: "Come along." },
                media_rights: { rights_basis: "owned", ai_generated: false },
                measurement: { result_hierarchy: hierarchy },
                delivery_budgets: { meta: { host_amount_cents: 3000 } },
              },
            },
            provider_allocations: [{
              platform: "meta",
              host_currency: "NGN",
              host_budget_cents: 30000,
              provider_currency: "NGN",
              provider_budget_cents: 30000,
            }],
            targeting_snapshots: [{ platform: "meta", verdict: "exact" }],
          },
        }),
    },
  };
}

async function launchResult(
  destination: Record<string, unknown>,
  hierarchy: string[],
): Promise<string> {
  const context = await preflightMoneyProposal(
    "approve_ad_plan",
    {
      brand_id: BRAND,
      plan_id: PLAN,
      plan_version_id: VERSION,
      plan_hash: HASH,
    },
    launchClient(destination, hierarchy),
  );
  assert(context);
  return String(context.ad_result);
}

Deno.test("#4238 retest 4 the LAUNCH card counts RSVPs on an RSVP page and bookings on a reservation page", async () => {
  assertEquals(
    await launchResult(
      { title: "Garden RSVP", page_type: "rsvp", result_kind: "signups" },
      ["rsvp_registration", "landing_page_view", "click"],
    ),
    "RSVPs",
  );
  assertEquals(
    await launchResult(
      {
        title: "Table booking",
        page_type: "reservation",
        result_kind: "bookings",
      },
      ["booking_confirmed", "landing_page_view", "click"],
    ),
    "bookings",
  );
  assertEquals(
    await launchResult(
      { title: "Deserted Island", page_type: "event", result_kind: "tickets" },
      ["ticket_purchase", "checkout_started", "landing_page_view", "click"],
    ),
    "ticket sales",
  );
  // An older plan without a measured list still falls back to the page kind.
  assertEquals(
    await launchResult({
      title: "Old",
      page_type: "rsvp",
      result_kind: "signups",
    }, []),
    "sign-ups",
  );
});
