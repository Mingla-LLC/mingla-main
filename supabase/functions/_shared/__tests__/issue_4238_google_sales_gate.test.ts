// MINGLA-INVARIANT: I-4238-GOOGLE-NEVER-SILENT-VISITS | issue #4238 | a ticket-sales Host plan that includes Google is refused (host_ad_google_needs_setup) unless Google is ready for sales; the visits acknowledgement never applies to Google.
// Issue #4238 W4b §6 — Google for ticket sales: "needs setup" until the
// purchase conversion action exists AND the Z-4 docs check passes. A sales
// plan never runs Google as page visits quietly.
//
// @invariant I-4238-GOOGLE-NEVER-SILENT-VISITS
//   owner: supabase/functions/_shared/adHostGoal.ts validateHostOptimization
//          + adSalesReadiness.ts googleSalesReadiness
//   rule: a ticket-sales Host plan that includes Google is refused
//         (host_ad_google_needs_setup) unless Google is ready for sales; the
//         visits acknowledgement never applies to Google.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateHostOptimization } from "../adHostGoal.ts";
import {
  googlePurchaseActionResource,
  googleSalesReadiness,
  HOST_SALES_PLATFORMS,
  salesReadiness,
} from "../adSalesReadiness.ts";
import type { AdConnectionRow } from "../adChannelCore.ts";

const ticketsPage = { page_type: "event", result_kind: "tickets" };
const google = (extra: Record<string, unknown>) =>
  ({ id: "g1", platform: "google", extra }) as unknown as AdConnectionRow;
const purchase = "customers/1/conversionActions/9";

Deno.test("SC-B6: no purchase action → needs_setup", async () => {
  assertEquals(googleSalesReadiness(google({})), {
    ready: false,
    reason: "needs_setup",
  });
  assertEquals(await salesReadiness(google({})), {
    ready: false,
    reason: "needs_setup",
  });
  assertEquals(HOST_SALES_PLATFORMS.includes("google"), true);
});

Deno.test("adversarial: a lead or sign-up action never stands in for purchase", () => {
  const conn = google({
    conversion_actions: {
      lead: "customers/1/conversionActions/2",
      rsvp_signup: "x",
    },
  });
  assertEquals(googlePurchaseActionResource(conn), null);
  assertEquals(googleSalesReadiness(conn, true).reason, "needs_setup");
});

Deno.test("lookup order matches the sender: purchase, alias, google alias", () => {
  assertEquals(
    googlePurchaseActionResource(google({
      conversion_actions: { purchase },
      conversion_action_resource: "alias",
    })),
    purchase,
  );
  assertEquals(
    googlePurchaseActionResource(
      google({ conversion_action_resource: "alias" }),
    ),
    "alias",
  );
  assertEquals(
    googlePurchaseActionResource(
      google({ google: { conversion_action_resource: "nested" } }),
    ),
    "nested",
  );
});

Deno.test("SC-B6: the action alone is not enough while Z-4 is open; with both → ready", () => {
  const conn = google({ conversion_actions: { purchase } });
  assertEquals(googleSalesReadiness(conn).reason, "needs_setup");
  assertEquals(googleSalesReadiness(conn, true), {
    ready: true,
    reason: "ready",
  });
});

Deno.test("SC-B6: a sales plan with Google not ready is refused, even acknowledged", () => {
  const result = validateHostOptimization(
    { meta: "sales", google: "visits" },
    ["meta", "google"],
    ticketsPage,
    {
      ready: { meta: { sales: true } },
      requestedGoal: "sales",
      acknowledgedFallback: ["google"],
    },
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.detail, "host_ad_google_needs_setup");
    assertEquals(result.platforms, ["google"]);
  }
});

Deno.test("a visits plan with Google is unchanged; a sales plan without Google is unchanged", () => {
  assertEquals(
    validateHostOptimization({ google: "visits" }, ["google"], ticketsPage, {
      requestedGoal: "visits",
    }).ok,
    true,
  );
  assertEquals(
    validateHostOptimization({ meta: "sales" }, ["meta"], ticketsPage, {
      ready: { meta: { sales: true } },
      requestedGoal: "sales",
    }).ok,
    true,
  );
});
