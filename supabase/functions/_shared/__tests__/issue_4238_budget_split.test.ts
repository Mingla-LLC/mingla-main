// MINGLA-INVARIANT: I-4238-FEWER-APPS-VIABLE | issue #4238 | Under "Let Mingla choose" an app is funded only at max(F, 500) ad spend a day (or alone at F with learning "slow" when nothing reaches that); the split conserves the total and matches Admin splitBudget.
/**
 * #4238 W3 T-6 + amendment B item 3 — fewer apps for small budgets, and the
 * smallest working amount when the budget funds no app.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  hostAppsForBudget,
  splitBudget,
  viabilityCents,
} from "../adBudgetSplit.ts";

const adminUrl = new URL(
  "../../../../mingla-admin/src/lib/adBuilder/channelPlan.js",
  import.meta.url,
).href;
const admin: Record<string, unknown> = await import(adminUrl);
const adminSplit = admin.splitBudget as (input: unknown) => unknown;

const ALL = [
  { platform: "reddit", floorCents: 500 },
  { platform: "snapchat", floorCents: 500 },
  { platform: "google", floorCents: 0 },
  { platform: "tiktok", floorCents: 2000 },
  { platform: "meta", floorCents: 100 },
];

Deno.test("T-6 parity: the shared splitBudget equals Admin's on a table of totals, sets and strategies", () => {
  const sets = [
    ALL,
    ALL.filter((row) => row.platform === "meta" || row.platform === "tiktok"),
    ALL.filter((row) =>
      row.platform === "snapchat" || row.platform === "tiktok"
    ),
    ALL.filter((row) => row.platform === "reddit"),
  ];
  for (const set of sets) {
    for (const strategy of ["auto", "concentrate", "diversify"] as const) {
      for (
        const total of [
          0,
          1,
          99,
          100,
          499,
          500,
          680,
          2499,
          2500,
          3400,
          5000,
          12345,
          100000,
        ]
      ) {
        const channelRows = set.map((row, index) => ({
          ...row,
          eligible: index !== 99,
        }));
        const input = { totalDailyCents: total, channelRows, strategy };
        assertEquals(
          splitBudget(input),
          adminSplit(input),
          `${strategy} ${total}`,
        );
      }
    }
  }
});

Deno.test("SC-T6: Meta + TikTok — 680 spend → Meta only; 3,400 → both; amounts add up", () => {
  const apps = ALL.filter((row) =>
    row.platform === "meta" || row.platform === "tiktok"
  );
  const small = hostAppsForBudget({ spendCents: 680, apps });
  assertEquals(small.fit, "ok");
  assertEquals(small.funded, [{ platform: "meta", dailyCents: 680 }]);
  assertEquals(small.trimmed.map((row) => [row.platform, row.reason]), [[
    "tiktok",
    "below_app_minimum",
  ]]);
  assertEquals(small.trimmed[0].needs_more_cents, 500 + 2000 - 680);
  const big = hostAppsForBudget({ spendCents: 3400, apps });
  assertEquals(big.funded.map((row) => row.platform), ["meta", "tiktok"]);
  assertEquals(big.funded.reduce((sum, row) => sum + row.dailyCents, 0), 3400);
  for (const row of big.funded) {
    const floor = apps.find((app) => app.platform === row.platform)!.floorCents;
    assertEquals(row.dailyCents >= viabilityCents(floor), true);
  }
});

Deno.test("SC-B3: 99 → none (Meta smallest); 300 → slow, Meta; 600 → ok, Meta", () => {
  const apps = ALL.filter((row) =>
    row.platform === "meta" || row.platform === "tiktok"
  );
  const none = hostAppsForBudget({ spendCents: 99, apps });
  assertEquals([none.fit, none.funded.length], ["none", 0]);
  assertEquals(none.smallest_overall, { platform: "meta", spend_cents: 100 });
  const slow = hostAppsForBudget({ spendCents: 300, apps });
  assertEquals([slow.fit, slow.funded], ["slow", [{
    platform: "meta",
    dailyCents: 300,
  }]]);
  const ok = hostAppsForBudget({ spendCents: 600, apps });
  assertEquals([ok.fit, ok.funded], ["ok", [{
    platform: "meta",
    dailyCents: 600,
  }]]);
});

Deno.test("T-6 adversarial: no apps; TikTok alone at 600 → none; Snap+TikTok at 600 never funds TikTok", () => {
  assertEquals(hostAppsForBudget({ spendCents: 5000, apps: [] }).fit, "none");
  assertEquals(
    hostAppsForBudget({
      spendCents: 600,
      apps: [{ platform: "tiktok", floorCents: 2000 }],
    }).fit,
    "none",
  );
  // Admin's concentrate answer is the top-priority eligible app; the Host
  // wrapper passes only apps the total can fund, so TikTok (2000) is never
  // handed 600.
  const mixed = hostAppsForBudget({
    spendCents: 600,
    apps: [{ platform: "tiktok", floorCents: 2000 }, {
      platform: "snapchat",
      floorCents: 500,
    }],
  });
  assertEquals(mixed.funded, [{ platform: "snapchat", dailyCents: 600 }]);
});

Deno.test("T-6 conservation + viability: every total 0..6,000 on five apps", () => {
  for (let spend = 0; spend <= 6000; spend += 7) {
    const plan = hostAppsForBudget({ spendCents: spend, apps: ALL });
    const sum = plan.funded.reduce((total, row) => total + row.dailyCents, 0);
    assertEquals(sum, plan.fit === "none" ? 0 : spend);
    for (const row of plan.funded) {
      const floor = ALL.find((app) =>
        app.platform === row.platform
      )!.floorCents;
      assertEquals(
        row.dailyCents >= (plan.fit === "ok" ? viabilityCents(floor) : floor),
        true,
        `${spend} ${row.platform}`,
      );
    }
    assertEquals(plan.funded.length + plan.trimmed.length, ALL.length);
  }
});
