// MINGLA-INVARIANT: I-4238-LIVE-EDIT-ALLOWLIST | issue #4238 | host-ad-campaign change_live refuses every body key outside HOST_LIVE_EDIT_FIELDS with 400 host_ad_live_edit_field_not_editable:<key> before any claim or push.
/**
 * #4238 W4a, amendment B item 7 (SC-B7): a live Host ad changes budget and
 * end date only. Any other key (area, audience, goal, creatives, the wider
 * area offer) is refused by name before anything is claimed or pushed.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  HOST_LIVE_EDIT_FIELDS,
  hostLiveEditUnknownField,
} from "../adHostLiveEdit.ts";

const BASE = {
  action: "change_live",
  brand_id: "00000000-0000-4000-8000-000000000001",
  plan_id: "00000000-0000-4000-8000-000000000002",
  idempotency_key: "edit-key-12345",
};

Deno.test("SC-B7: a budget-only or end-only edit is accepted", () => {
  assertEquals(
    hostLiveEditUnknownField({ ...BASE, new_budget_cents: 5000 }),
    null,
  );
  assertEquals(
    hostLiveEditUnknownField({
      ...BASE,
      new_ends_at: "2027-01-01T00:00:00Z",
      acknowledge_learning_reset: true,
      suggestion_id: "s1",
    }),
    null,
  );
});

Deno.test("SC-B7: targeting, geo and every never-live field are refused by name", () => {
  for (
    const key of [
      "targeting",
      "geo",
      "countries",
      "broader_acceptance",
      "audience_selection",
      "optimization_goal",
      "platforms",
      "creative_library_ids",
      "copy",
      "age_min",
      "new_daily_cents",
    ]
  ) {
    assertEquals(
      hostLiveEditUnknownField({ ...BASE, new_budget_cents: 5000, [key]: 1 }),
      key,
      key,
    );
  }
});

Deno.test("the allowlist is exactly the amendment B list plus the learning acknowledgement", () => {
  assertEquals([...HOST_LIVE_EDIT_FIELDS].sort(), [
    "acknowledge_learning_reset",
    "action",
    "brand_id",
    "idempotency_key",
    "new_budget_cents",
    "new_ends_at",
    "plan_id",
    "suggestion_id",
  ]);
});

Deno.test("change_live refuses an unknown field before the claim (server-enforced)", async () => {
  const source = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  const start = source.indexOf("async function changeLive(");
  assert(start > 0);
  const body = source.slice(
    start,
    source.indexOf("async function planAndRunLiveEdit", start),
  );
  const guard = body.indexOf("hostLiveEditUnknownField(body)");
  const claim = body.indexOf("host_ad_live_edit_claim");
  assert(guard > 0, "the allowlist check is in changeLive");
  assert(guard < claim, "the allowlist check runs before the claim");
  assert(body.includes("host_ad_live_edit_field_not_editable:"));
  assert(body.includes("400"));
});
