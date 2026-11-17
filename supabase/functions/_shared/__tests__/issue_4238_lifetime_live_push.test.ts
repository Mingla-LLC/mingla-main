/**
 * #4238 W4a (5a): a live edit of a Meta "total for the run" ad pushes the
 * new provider total as the campaign's lifetime budget (read back), and the
 * new total can never let the app spend more than the Host's new budget.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type HostLiveCampaign,
  planHostLiveEdit,
  runHostLiveEdit,
} from "../adHostLiveEdit.ts";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const END = "2026-11-30T12:00:00.000Z";

function campaign(
  spend: number,
  patch: Partial<HostLiveCampaign> = {},
): HostLiveCampaign {
  return {
    id: "c1",
    platform: "meta",
    host_budget_cents: 10_000,
    host_delivery_budget_cents: 700,
    provider_budget_cents: 10_000,
    provider_delivery_budget_cents: 700,
    current_cap_cents: 10_000,
    current_daily_cents: 700,
    provider_spend_cents: spend,
    provider_daily_minimum_cents: 100,
    lifetime: true,
    ...patch,
  };
}

function plan(
  newBudget: number,
  spend: number,
  patch: Partial<HostLiveCampaign> = {},
) {
  return planHostLiveEdit({
    planState: "live",
    lastEditAt: null,
    nowMs: NOW,
    newHostBudgetCents: newBudget,
    newEndsAt: null,
    currentHostBudgetCents: 10_000,
    currentEndsAt: END,
    lastBookableAt: null,
    hostSpendCents: spend,
    campaigns: [campaign(spend, patch)],
    liveSinceMs: NOW - 10 * 86_400_000,
  });
}

Deno.test("5a: raising a Meta lifetime total marks the lifetime push and never a daily push", () => {
  const planned = plan(15_000, 4_000);
  assert(planned.ok);
  const [line] = planned.lines;
  assertEquals(line.lifetime_changed, true);
  assertEquals(line.daily_changed, false);
  assertEquals(line.new_provider_budget_cents, 15_000);
});

Deno.test("5a: a TikTok lifetime row is never pushed (Mingla's cap only)", () => {
  const planned = plan(15_000, 4_000, {
    platform: "tiktok",
    provider_daily_minimum_cents: 2000,
  });
  assert(planned.ok);
  assertEquals(planned.lines[0].lifetime_changed, false);
});

Deno.test("adversarial: the pushed lifetime total never exceeds the new budget (any rate, any spend)", () => {
  for (const ratio of [1, 0.85, 1.37, 1550]) {
    for (let spend = 0; spend <= 9_000; spend += 750) {
      for (const total of [spend + 1, 9_999, 12_345, 40_000]) {
        if (total <= spend) continue;
        const planned = plan(total, spend, {
          provider_budget_cents: Math.round(10_000 * ratio),
          provider_delivery_budget_cents: Math.max(1, Math.round(700 * ratio)),
          current_cap_cents: Math.round(10_000 * ratio),
          current_daily_cents: Math.max(1, Math.round(700 * ratio)),
          provider_spend_cents: Math.round(spend * ratio),
          provider_daily_minimum_cents: null,
        });
        if (!planned.ok) continue;
        const line = planned.lines[0];
        // In the brand's money the pushed total is within the new budget.
        assert(
          line.new_provider_budget_cents / ratio <= total + 1,
          `${ratio}:${spend}:${total}`,
        );
      }
    }
  }
});

Deno.test("5a: the run pushes lifetime_budget at campaign level, reads it back, and undoes on a mismatch", async () => {
  const calls: string[] = [];
  let lifetime = 10_000;
  const adapter = (readbackOff: number) => ({
    setLifetimeBudget: (
      _c: unknown,
      level: string,
      id: string,
      cents: number,
    ) => {
      calls.push(`lifetime:${level}:${id}:${cents}`);
      lifetime = cents;
      return Promise.resolve();
    },
    getLifetimeBudget: () =>
      Promise.resolve({
        cents: lifetime + readbackOff,
        field: "lifetime_budget",
      }),
    setBudget: () => Promise.reject(new Error("daily must not be pushed")),
  });
  const db = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "ad_connections"
              ? { connected: true, status: "connected" }
              : null,
            error: null,
          }),
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: [], error: null }),
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: { id: "edit" }, error: null }),
  };
  const planned = plan(15_000, 4_000);
  assert(planned.ok);
  const run = (off: number) =>
    runHostLiveEdit({
      db,
      // deno-lint-ignore no-explicit-any
      getAdapter: () => adapter(off) as any,
    }, {
      plan: planned,
      versionId: "v",
      planHash: "h".repeat(64),
      campaigns: [{
        id: "c1",
        platform: "meta",
        external_campaign_id: "mc",
        connection_id: "k",
        provider_budget_cents: 10_000,
      }],
      actorId: "a",
      idempotencyKey: "host_live_p_k",
      previousEndsAt: END,
    });
  const ok = await run(0);
  assertEquals(ok.status, 200);
  assertEquals(calls, ["lifetime:campaign:mc:15000"]);
  calls.length = 0;
  lifetime = 10_000;
  const bad = await run(1);
  assertEquals(bad.status, 502);
  // Pushed, read back wrong, undone to the old total.
  assertEquals(calls, [
    "lifetime:campaign:mc:15000",
    "lifetime:campaign:mc:10000",
  ]);
});
