/**
 * #4238 media-buyer, tester round 10 — adversarial checks after the r9
 * rework. A different angle from issue_4238_mb_live_edit_r9.implementor.test.ts
 * (R6 lowers Meta + Google once; R7 makes the record call throw before
 * anything is saved).
 *
 *   W1  The record call SAVES the edit, then its answer is lost (a dropped
 *       connection after commit). Mingla's record now holds the new daily
 *       amount, so undoing the push leaves the app on the old amount with
 *       nothing to tell anyone: the Host reads "Nothing was changed", a retry
 *       with the same key is replayed as "Your ad is updated", and staff are
 *       never told. Seen live on the r10 harness (record committed, Meta put
 *       back from 10,803 to 10,000, no status event, no email). The run must
 *       end with the app on the recorded amount, or staff told.
 *       RED at 37f17f1db.
 *   W2  Lowers across every mix of apps Mingla can and can't push to (Meta,
 *       Snapchat, TikTok vs Google, Reddit): an app Mingla can't push to is
 *       never marked as a changed daily amount, is always named in "keeps
 *       its daily amount" when its recorded daily moves, and its recorded
 *       daily never sits above its new cap. GREEN at 37f17f1db.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HOST_LIVE_DAILY_PUSH,
  type HostLiveCampaign,
  type HostLiveEditProblem,
  planHostLiveEdit,
  runHostLiveEdit,
} from "../adHostLiveEdit.ts";
import type { ChannelAdapter, Platform } from "../adChannelCore.ts";

Deno.test("W1 a record that saved but lost its answer never leaves the app off the record silently", async () => {
  const budgets = new Map<string, number>([["meta-c", 10_000]]);
  const saved: Array<Record<string, unknown>> = [];
  const problems: HostLiveEditProblem[] = [];
  const adapter = {
    setBudget: (_c: unknown, _l: unknown, id: string, cents: number) => {
      budgets.set(id, cents);
      return Promise.resolve();
    },
    getBudget: (_c: unknown, _l: unknown, id: string) =>
      Promise.resolve({ cents: budgets.get(id) ?? 0, field: "daily_budget" }),
  } as unknown as ChannelAdapter;
  const db = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (column: string, value: unknown) => {
        filters[column] = value;
        return q;
      };
      q.order = () => q;
      q.limit = () => q;
      const rows = () =>
        table === "host_ad_live_edits"
          ? saved.filter((row) =>
            Object.entries(filters).every(([k, v]) => row[k] === v)
          )
          : [];
      q.maybeSingle = () =>
        Promise.resolve({
          data: table === "ad_connections"
            ? { connected: true, status: "connected" }
            : rows()[0] ?? null,
          error: null,
        });
      (q as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
        resolve({ data: rows(), error: null });
      return q;
    },
    // Postgres commits the edit; the answer never reaches the function.
    rpc: (_name: string, args: Record<string, unknown>) => {
      saved.push({
        id: "edit-1",
        idempotency_key: args.p_idempotency_key,
        plan_version_id: args.p_plan_version_id,
        new_host_budget_cents: args.p_new_host_budget_cents,
        changes: args.p_changes,
      });
      return Promise.resolve({
        data: null,
        error: { code: "XX000", message: "upstream connection reset" },
      });
    },
  };
  const result = await runHostLiveEdit({
    db,
    getAdapter: () => adapter,
    onProblem: (problem) => {
      problems.push(problem);
      return Promise.resolve();
    },
  }, {
    plan: {
      ok: true,
      newHostBudgetCents: 200_000_000,
      newEndsAt: null,
      dailyNotPushed: [],
      lines: [{
        campaign_id: "m",
        platform: "meta",
        new_provider_budget_cents: 74_015,
        new_provider_delivery_budget_cents: 10_803,
        daily_changed: true,
      }],
    },
    versionId: "v",
    planHash: "h".repeat(64),
    campaigns: [{
      id: "m",
      platform: "meta",
      external_campaign_id: "meta-c",
      connection_id: "k",
      provider_delivery_budget_cents: 10_000,
      provider_budget_cents: 100_000,
    }],
    actorId: "a",
    idempotencyKey: "host_live_p_r10-answer-lost",
    previousEndsAt: null,
  });
  assertEquals(saved.length, 1, "the edit was saved");
  const recordedDaily = 10_803;
  const appMatchesRecord = budgets.get("meta-c") === recordedDaily;
  assert(
    appMatchesRecord || problems.length > 0,
    `the edit is saved with a daily of ${recordedDaily}, but Meta was put back to ` +
      `${
        budgets.get("meta-c")
      } and nobody was told (status ${result.status}, ` +
      `${JSON.stringify(result.body)})`,
  );
});

Deno.test("W2 apps Mingla can't push to are never pushed, always named, never above their cap", () => {
  const all: Platform[] = ["meta", "snapchat", "tiktok", "google", "reddit"];
  let seed = 4238;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  let checked = 0;
  for (let mask = 1; mask < 1 << all.length; mask++) {
    const apps = all.filter((_, i) => mask & (1 << i));
    for (let round = 0; round < 40; round++) {
      // NGN plan, USD apps at 1,550 (fee ignored): a host share and its
      // provider cap, a daily, and some spend under the cap.
      const campaigns: HostLiveCampaign[] = apps.map((platform, i) => {
        const prov = 20_000 + Math.floor(rand() * 200_000);
        const provDaily = 500 + Math.floor(rand() * 20_000);
        return {
          id: `${platform}-${i}`,
          platform,
          host_budget_cents: prov * 1550,
          host_delivery_budget_cents: provDaily * 1550,
          provider_budget_cents: prov,
          provider_delivery_budget_cents: provDaily,
          current_cap_cents: prov,
          current_daily_cents: provDaily,
          provider_spend_cents: Math.floor(rand() * prov * 0.6),
          provider_daily_minimum_cents: null,
        };
      });
      const total = campaigns.reduce((s, c) => s + c.host_budget_cents, 0);
      const spend = campaigns.reduce(
        (s, c) => s + c.provider_spend_cents * 1550,
        0,
      );
      const newTotal = spend + 1 + Math.floor(rand() * (total - spend));
      const planned = planHostLiveEdit({
        planState: "live",
        lastEditAt: null,
        nowMs: Date.parse("2026-11-04T00:00:00Z"),
        newHostBudgetCents: newTotal,
        newEndsAt: null,
        currentHostBudgetCents: total,
        currentEndsAt: "2026-11-09T00:00:00Z",
        lastBookableAt: "2026-12-06T22:59:00Z",
        hostSpendCents: spend,
        campaigns,
      });
      if (!planned.ok) continue;
      for (const line of planned.lines) {
        const row = campaigns.find((c) => c.id === line.campaign_id)!;
        assert(
          line.new_provider_delivery_budget_cents <=
            line.new_provider_budget_cents,
          `${line.platform}: recorded daily over its cap`,
        );
        if (!HOST_LIVE_DAILY_PUSH.has(line.platform)) {
          assertEquals(
            line.daily_changed,
            false,
            `${line.platform} marked as a daily push`,
          );
          if (
            line.new_provider_delivery_budget_cents !== row.current_daily_cents
          ) {
            assert(
              planned.dailyNotPushed.includes(line.platform),
              `${line.platform}'s recorded daily moved but the Host isn't told it keeps its own`,
            );
          }
        }
        checked++;
      }
    }
  }
  assert(checked > 1_000, `only ${checked} lines checked`);
});
