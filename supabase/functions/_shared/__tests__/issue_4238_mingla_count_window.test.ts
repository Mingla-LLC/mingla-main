// Issue #4238 W4b §5 — Mingla's own count: a result counts only within 7
// days after the ad tap it was credited to (no view-through).
//
// @invariant I-4238-MINGLA-COUNT-7D
//   owner: supabase/functions/_shared/hostAdAttribution.ts countedByMingla,
//          used by host-ad-campaign get and ad_campaign_daily_series
//   rule: a conversion older than 7 days after its tap, before its tap, or
//         with no readable tap time is never shown as a Host result.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  countedByMingla,
  HOST_AD_CLICK_WINDOW_DAYS,
  HOST_AD_CLICK_WINDOW_MS,
  HOST_AD_RESULTS_COPY,
  minglaCountedConversions,
} from "../hostAdAttribution.ts";

const DAY = 24 * 60 * 60 * 1000;
const sale = "2026-11-16T12:00:00.000Z";
const ago = (days: number) =>
  new Date(Date.parse(sale) - days * DAY).toISOString();

Deno.test("SC-B5: a 6-day-old tap counts, an 8-day-old tap does not", () => {
  assertEquals(countedByMingla(ago(6), sale), true);
  assertEquals(countedByMingla(ago(8), sale), false);
  assertEquals(countedByMingla(ago(7), sale), true, "exactly 7 days counts");
  assertEquals(
    countedByMingla(new Date(Date.parse(ago(7)) - 1).toISOString(), sale),
    false,
  );
});

Deno.test("adversarial: a future-dated tap and a missing tap time are expired", () => {
  assertEquals(countedByMingla(ago(-1), sale), false);
  assertEquals(countedByMingla(null, sale), false);
  assertEquals(countedByMingla(undefined, sale), false);
  assertEquals(countedByMingla("not a date", sale), false);
  assertEquals(countedByMingla(ago(1), null), false);
});

Deno.test("the filter keeps only counted rows; a row with no tap is dropped", () => {
  const touches = new Map<string, unknown>([
    ["t6", ago(6)],
    ["t8", ago(8)],
  ]);
  const rows = [
    { touch_id: "t6", created_at: sale, platform: "meta" },
    { touch_id: "t8", created_at: sale, platform: "tiktok" },
    { touch_id: null, created_at: sale, platform: "snapchat" },
    { touch_id: "missing", created_at: sale, platform: "meta" },
  ];
  assertEquals(
    minglaCountedConversions(rows, touches).map((row) => row.platform),
    ["meta"],
  );
});

Deno.test("parity: the server window equals the browser's stored-tap TTL", async () => {
  const web = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/analytics/webAnalytics.web.ts",
      import.meta.url,
    ),
  );
  const match = web.match(
    /export const AD_CLICK_TTL_MS = (\d+) \* 24 \* 60 \* 60 \* 1000;/,
  );
  assertEquals(match?.[1], String(HOST_AD_CLICK_WINDOW_DAYS));
  assertEquals(HOST_AD_CLICK_WINDOW_MS, 7 * DAY);
});

Deno.test("results read Mingla's count and say how it was counted", async () => {
  const src = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  assertEquals(src.includes("minglaCountedConversions("), true);
  assertEquals(src.includes('counted_by: "mingla"'), true);
  assertEquals(src.includes("view_through: false"), true);
  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20280717004238_issue_4238_host_ad_notices_roles.sql",
      import.meta.url,
    ),
  );
  assertEquals(
    sql.includes("c.created_at - t.created_at <= interval '7 days'"),
    true,
  );
  assertEquals(HOST_AD_RESULTS_COPY.tickets.includes("within 7 days"), true);
  assertEquals(HOST_AD_RESULTS_COPY.signups.includes("sign-ups"), true);
});
