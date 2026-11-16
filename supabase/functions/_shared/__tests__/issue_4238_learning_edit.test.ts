// Issue #4238 W2 item 6a — confirm-before edits that reset the apps'
// learning, enforced on the server.
//
// @invariant I-4238-LEARNING-CONFIRM
//   owner: supabase/functions/_shared/adHostLiveEdit.ts planHostLiveEdit
//   rule: inside the first 7 days live, a change of over 20% in the DAILY
//         amount the apps get (rework 2: never the total) or any end-date
//         change is refused with host_ad_live_edit_learning_reset (409)
//         unless acknowledge_learning_reset is literally true.
//
// Fixture: 1,000 a day now, 2,000 spent, 10 days left, so a new total T
// gives a daily of (T - 2,000) / 10.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type HostLiveCampaign, planHostLiveEdit } from "../adHostLiveEdit.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2028-07-20T12:00:00Z");

const campaign = (over: Partial<HostLiveCampaign> = {}): HostLiveCampaign => ({
  id: "c1",
  platform: "meta",
  host_budget_cents: 10_000,
  host_delivery_budget_cents: 1_000,
  provider_budget_cents: 10_000,
  provider_delivery_budget_cents: 1_000,
  current_cap_cents: 10_000,
  current_daily_cents: 1_000,
  provider_spend_cents: 2_000,
  ...over,
});

const base = (over: Record<string, unknown> = {}) => ({
  planState: "live",
  lastEditAt: null,
  nowMs: NOW,
  newHostBudgetCents: 15_000, // daily 1,300: +30%
  newEndsAt: null,
  currentHostBudgetCents: 10_000,
  currentEndsAt: new Date(NOW + 10 * DAY).toISOString(),
  lastBookableAt: new Date(NOW + 20 * DAY).toISOString(),
  hostSpendCents: 2_000,
  campaigns: [campaign()],
  liveSinceMs: NOW - 2 * DAY, // day 3
  ...over,
});

Deno.test("SC-6.1: day 3, daily 1,000 → 1,300 refused; with the acknowledgement it passes; day 8 passes without", () => {
  const refused = planHostLiveEdit(base());
  assertEquals(refused.ok, false);
  if (refused.ok) return;
  assertEquals(refused.error, "host_ad_live_edit_learning_reset");
  assertEquals(refused.learning?.change_pct, 30);
  assertEquals(refused.learning?.days_live, 3);
  assertEquals(
    refused.learning?.learning_until,
    new Date(NOW + 5 * DAY).toISOString(),
  );
  assert(planHostLiveEdit(base({ acknowledgeLearningReset: true })).ok);
  assert(planHostLiveEdit(base({ liveSinceMs: NOW - 7 * DAY })).ok);
});

Deno.test("adversarial: a daily change of exactly 20% passes; 20.1% and −25% are refused", () => {
  assert(planHostLiveEdit(base({ newHostBudgetCents: 14_000 })).ok); // 1,200 a day
  assert(planHostLiveEdit(base({ newHostBudgetCents: 10_000 })).ok); // 800 a day
  const over = planHostLiveEdit(base({ newHostBudgetCents: 14_010 })); // 1,201
  assert(!over.ok && over.error === "host_ad_live_edit_learning_reset");
  const cut = planHostLiveEdit(base({ newHostBudgetCents: 9_500 })); // 750
  assert(!cut.ok && cut.error === "host_ad_live_edit_learning_reset");
});

Deno.test("adversarial: an end-date change inside 7 days needs the acknowledgement; a truthy non-true value doesn't count", () => {
  const end = new Date(NOW + 12 * DAY).toISOString();
  const refused = planHostLiveEdit(
    base({ newHostBudgetCents: null, newEndsAt: end }),
  );
  assert(!refused.ok && refused.error === "host_ad_live_edit_learning_reset");
  assertEquals(!refused.ok && refused.learning?.change_pct, null);
  assert(
    planHostLiveEdit(
      base({
        newHostBudgetCents: null,
        newEndsAt: end,
        acknowledgeLearningReset: true,
      }),
    ).ok,
  );
  // The handler passes body.acknowledge_learning_reset === true only.
  const forged = planHostLiveEdit(
    base({ acknowledgeLearningReset: "true" as unknown as boolean }),
  );
  assert(!forged.ok);
});

Deno.test("not live yet: no learning window applies", () => {
  assert(planHostLiveEdit(base({ liveSinceMs: null })).ok);
});

Deno.test("5a: a lifetime campaign never gets a daily push (Mingla's cap enforces the new total)", () => {
  const plan = planHostLiveEdit(base({
    liveSinceMs: NOW - 9 * DAY,
    campaigns: [campaign({ lifetime: true })],
  }));
  assert(plan.ok);
  if (!plan.ok) return;
  assertEquals(plan.lines[0].daily_changed, false);
  assertEquals(plan.dailyNotPushed, ["meta"]);
});

Deno.test("wiring: host-ad-campaign passes the live date and only a literal true acknowledgement, and answers 409", async () => {
  const host = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  assert(host.includes("liveSinceMs: await loadHostLiveSinceMs(db, rows),"));
  // #4238 W5: the body → edit mapping moved into resolveSuggestedEdit (one
  // place for the Host's edit and Ari's suggestion); a suggestion never
  // carries the acknowledgement.
  const suggestion = await Deno.readTextFile(
    new URL("../adSuggestion.ts", import.meta.url),
  );
  assert(host.includes("resolveSuggestedEdit("));
  assert(
    suggestion.includes(
      "acknowledgeLearningReset: body.acknowledge_learning_reset === true,",
    ),
  );
  assert(suggestion.includes("acknowledgeLearningReset: false,"));
  assert(host.includes('planned.error === "host_ad_live_edit_learning_reset"'));
});
