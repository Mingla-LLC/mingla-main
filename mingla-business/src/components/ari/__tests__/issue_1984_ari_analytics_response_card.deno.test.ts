// #1984 — ResponseCard mapping for analytics tool_results (happy + adversarial).
// Pure helper coverage — MessageList source-contract is asserted separately.
//
// Run:
//   deno test --allow-read mingla-business/src/components/ari/__tests__/issue_1984_ari_analytics_response_card.deno.test.ts

import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildAnalyticsCardForTool,
  formatCentsByCurrency,
} from "../ariAnalyticsResponseCard.ts";

Deno.test("#1984 card: formats cents per currency without cross-summing", () => {
  assertEquals(
    formatCentsByCurrency({ USD: 1500, GBP: 200 }),
    "GBP 2.00 · USD 15.00",
  );
});

Deno.test("#1984 card: brand analytics rows from conversion + venue", () => {
  const card = buildAnalyticsCardForTool("get_brand_analytics", {
    brand_id: "b1",
    conversion: {
      authorized: true,
      customers_driven_30d: 4,
      customers_driven_lifetime: 9,
      value_cents_30d: { USD: 400 },
    },
    venue: {
      order_count: 7,
      rev7d_by_currency: { USD: 700 },
    },
  });
  assertEquals(card?.state, "default");
  const labels = (card?.rows ?? []).map((r) => r.label);
  assertEquals(labels.includes("Driven customers (30d)"), true);
  assertEquals(labels.includes("Orders"), true);
  assertEquals(labels.includes("Revenue (7d)"), true);
});

Deno.test("#1984 card: listing / reservation / reconciliation shapes", () => {
  assertEquals(
    buildAnalyticsCardForTool("get_listing_conversion", {
      conversion: {
        authorized: true,
        mingla_drove_count: 3,
        value_cents: { USD: 1500 },
        by_source: [{ source: "organic", customers: 2 }],
      },
    })?.rows[0],
    { label: "Customers", value: "3" },
  );

  const reservationLabels = (
    buildAnalyticsCardForTool("get_reservation_metrics", {
      metrics: {
        authorized: true,
        covers_30d: 12,
        no_show_rate: 0.1,
        avg_party_size: 2.5,
      },
    })?.rows ?? []
  ).map((r) => r.label);
  assertEquals(reservationLabels.includes("Covers (30d)"), true);
  assertEquals(reservationLabels.includes("No-show rate"), true);
  assertEquals(reservationLabels.includes("Avg party size"), true);

  assertEquals(
    buildAnalyticsCardForTool("get_event_order_reconciliation", {
      sold_count: 1,
      revenue_cents: 2000,
      refunded_cents: 500,
      net_revenue_cents: 1500,
      currency: "usd",
    })?.rows,
    [
      { label: "Sold", value: "1" },
      { label: "Gross", value: "USD 20.00" },
      { label: "Refunded", value: "USD 5.00" },
      { label: "Net", value: "USD 15.00" },
    ],
  );
});

Deno.test("#1984 card: missing / unauthorized payloads do not throw", () => {
  const unauthorized = buildAnalyticsCardForTool("get_listing_conversion", {
    conversion: { authorized: false },
  });
  assertMatch(unauthorized?.rows[0]?.value ?? "", /Not authorized/);

  assertEquals(
    buildAnalyticsCardForTool("get_brand_analytics", {
      conversion: { error: "boom" },
      venue: { error: "boom" },
    })?.state,
    "error",
  );

  assertEquals(buildAnalyticsCardForTool("unknown_tool", {}), null);
});

Deno.test("#1984 card: MessageList wires buildAnalyticsCardForTool", () => {
  const src = Deno.readTextFileSync(
    new URL("../MessageList.tsx", import.meta.url),
  );
  assertEquals(src.includes("buildAnalyticsCardForTool"), true);
});
