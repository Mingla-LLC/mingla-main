/**
 * #4238 W4a T-6: "Let Mingla choose" records every connected app it left
 * off as an `apps_trimmed` event on the plan, once per version, with the
 * same reason guidance gives.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { recordHostAppsTrimmed } from "../../ad-plan/index.ts";

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const inserted: Row[] = [];
  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (key: string, value: unknown) => {
        rows = rows.filter((row) => row[key] === value);
        return chain;
      },
      in: (key: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[key]));
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      insert: (items: Row[]) => {
        inserted.push(...items);
        tables[table] = [...(tables[table] ?? []), ...items];
        return Promise.resolve({ error: null });
      },
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
    };
    return chain;
  };
  return {
    inserted,
    db: {
      from: query,
      rpc: () => Promise.resolve({ data: null, error: { message: "unused" } }),
    },
  };
}

const CONNECTIONS = ["meta", "tiktok", "snapchat"].map((platform) => ({
  id: `c-${platform}`,
  platform,
  lane: "consumer",
  connected: true,
  status: "connected",
  currency: "USD",
  extra: {},
}));

Deno.test("T-6: Meta-only at $8/day pay records TikTok and Snapchat as trimmed, once", async () => {
  const { db, inserted } = fakeDb({
    ad_connections: CONNECTIONS,
    fx_rate_snapshots: [{ id: "fx1", status: "active" }],
    ad_plan_automation_events: [],
  });
  const input = {
    planId: "p1",
    versionId: "v1",
    chosen: ["meta"],
    currency: "USD",
    goal: "visits" as const,
    spendCents: 680,
  };
  assertEquals(await recordHostAppsTrimmed(db, input), 2);
  assertEquals(
    inserted.map((row) => [row.platform, row.kind, row.status]).sort(),
    [["snapchat", "apps_trimmed", "applied"], ["tiktok", "apps_trimmed", "applied"]],
  );
  for (const row of inserted) {
    const detail = row.detail as Row;
    assertEquals(detail.plan_version_id, "v1");
    assertEquals(typeof detail.reason, "string");
  }
  // A replay of the same version records nothing new.
  assertEquals(await recordHostAppsTrimmed(db, input), 0);
  assertEquals(inserted.length, 2);
});

Deno.test("T-6: an app the plan kept is never recorded as trimmed", async () => {
  const { db, inserted } = fakeDb({
    ad_connections: CONNECTIONS,
    fx_rate_snapshots: [{ id: "fx1", status: "active" }],
    ad_plan_automation_events: [],
  });
  await recordHostAppsTrimmed(db, {
    planId: "p2",
    versionId: "v2",
    chosen: ["meta", "tiktok", "snapchat"],
    currency: "USD",
    goal: "visits",
    spendCents: 4000,
  });
  assertEquals(inserted.length, 0);
});

Deno.test("create_version records trimmed apps only under Mingla's app choice", async () => {
  const source = await Deno.readTextFile(new URL("../../ad-plan/index.ts", import.meta.url));
  const at = source.indexOf("await recordHostAppsTrimmed(db, {");
  const guard = source.lastIndexOf('canonical.app_choice === "mingla"', at);
  assertEquals(at > 0 && guard > 0 && at - guard < 200, true);
});
