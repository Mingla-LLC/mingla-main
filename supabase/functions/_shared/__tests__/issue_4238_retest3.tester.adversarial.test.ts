/**
 * #4238 — tester RETEST 3 adversarial suite (server side). Angles the
 * implementor's retest-2 tests do not cover:
 *
 *  Bids. Every manual-bid key that admin-ad-create-campaign reads from
 *        `budget` must be on the Host refusal list (a bid key added later
 *        cannot slip through), and the Host refusal runs before the create
 *        path reads `body.budget`.
 *  Bids. Wire-shaped bodies (raw JSON text, as the edge function receives
 *        them): whenever the Host check lets a body through, the create path
 *        would read no bid value from it, for any value or nesting trick.
 *  Label. The campaign list's default result word is "results" only when the
 *        page names no result kind (empty, blank, non-string first entry);
 *        a named kind still passes through for the app to word it.
 *
 * Fails on revert (verified by line-deletion at the retest-3 commit):
 *  - dropping the HOST_BUDGET_BID_FIELDS block in hostGoalBodyError → the
 *    wire bodies with budget bids pass while the create path reads them.
 *  - removing a key from HOST_BUDGET_BID_FIELDS → the source scan names it.
 *  - hostAdCampaignList default back to "conversions" → the label test.
 */

import "../adChannel.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { HOST_BUDGET_BID_FIELDS, hostGoalBodyError } from "../adHostGoal.ts";
import { buildHostCampaignList } from "../hostAdCampaignList.ts";

const createSource = await Deno.readTextFile(
  new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
);

Deno.test("#4238 RETEST3 every bid key the create path reads from budget is refused for Hosts", () => {
  const read = new Set<string>();
  for (const match of createSource.matchAll(/\bbudget\.([a-z_]+)/g)) {
    if (/bid/.test(match[1])) read.add(match[1]);
  }
  assert(read.size >= 3, `scan found too few bid keys: ${[...read]}`);
  const refused = new Set<string>(HOST_BUDGET_BID_FIELDS);
  const missing = [...read].filter((key) => !refused.has(key));
  assertEquals(missing, [], `Host may still set budget.${missing.join(", ")}`);
});

Deno.test("#4238 RETEST3 the Host refusal runs before the create path reads body.budget", () => {
  const refusal = createSource.indexOf("hostGoalBodyError(body)");
  const budgetRead = createSource.indexOf("const budget = (body.budget ?? {})");
  assert(refusal > 0, "hostGoalBodyError(body) is not called");
  assert(budgetRead > 0, "budget read not found");
  assert(refusal < budgetRead, "budget is read before the Host refusal");
});

/** What the create path would read: `(body.budget ?? {})[field]`. */
function bidsTheCreatePathReads(body: Record<string, unknown>): string[] {
  const budget = (body.budget ?? {}) as Record<string, unknown>;
  return HOST_BUDGET_BID_FIELDS.filter((field) => budget[field] !== undefined);
}

Deno.test("#4238 RETEST3 a wire body never gets a bid past the Host check", () => {
  const wire = [
    '{"budget":{"type":"daily","amount_cents":1000,"bid_type":"BID_TYPE_CUSTOM"}}',
    '{"budget":{"bid_price_cents":1}}',
    '{"budget":{"cpc_bid_cents":null}}',
    '{"budget":{"bid_cents":0}}',
    '{"budget":{"bid_cents":""}}',
    '{"budget":{"bid_type":false}}',
    '{"budget":{"bid_type":[]}}',
    '{"budget":{"bid_type":{}}}',
    '{"budget":{"bid_cents":1,"bid_cents":2}}',
    '{"budget":{"__proto__":{"bid_type":"BID_TYPE_CUSTOM"}}}',
    '{"budget":{"constructor":{"bid_cents":5}}}',
    '{"budget":[{"bid_cents":5}]}',
    '{"budget":"bid_cents"}',
    '{"budget":null}',
    '{"budget":{"type":"daily","amount_cents":1000,"cap_cents":5000}}',
  ];
  let refusedCount = 0;
  for (const text of wire) {
    const body = JSON.parse(text) as Record<string, unknown>;
    const error = hostGoalBodyError(body);
    if (error === null) {
      assertEquals(
        bidsTheCreatePathReads(body),
        [],
        `Host check passed ${text} but the create path reads a bid from it`,
      );
    } else {
      assertEquals(error, "host_delivery_field_forbidden", text);
      refusedCount += 1;
    }
  }
  // The nine bodies that carry a real budget bid key are all refused.
  assertEquals(refusedCount, 9);
});

Deno.test("#4238 RETEST3 the list says results only when the page names no result kind", () => {
  const labelFor = (hierarchy: unknown) =>
    buildHostCampaignList({
      campaigns: [{
        id: "c1",
        name: "Ad",
        status: "PAUSED",
        platform: "meta",
        currency: "NGN",
        plan_version_id: "v1",
        created_at: "2026-10-01T00:00:00.000Z",
      }],
      versions: [{
        id: "v1",
        host_currency: "NGN",
        host_budget_cents: 1000,
        canonical_plan: { measurement: { result_hierarchy: hierarchy } },
      }],
      plans: [],
      spend: [],
      conversions: [],
      adSets: [],
      ads: [],
      nowIso: "2026-11-02T00:00:00.000Z",
    })[0].primary_result_label;
  for (const empty of [[], [""], ["   "], [null], [42], undefined, "x"]) {
    assertEquals(labelFor(empty), "results", JSON.stringify(empty));
  }
  assertEquals(labelFor(["rsvp_registration"]), "rsvp_registration");
  assertEquals(labelFor(["ticket_purchase", "page_view"]), "ticket_purchase");
});
