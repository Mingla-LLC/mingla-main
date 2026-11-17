/**
 * #4238 W4c (sub-item 6, Z-6): each app's attribution window is set only
 * where its official docs confirm the field and value — Meta ad set
 * attribution_spec [{CLICK_THROUGH, 7}] and TikTok ad group
 * click_attribution_window SEVEN_DAYS + view_attribution_window OFF (a pair,
 * website conversions only). Snapchat (no ad-squad attribution field; stats
 * only), Reddit (account level only) and Google (conversion action, #4452)
 * are not set.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildMetaAdSetBody } from "../meta.ts";
import { buildTikTokAdGroupBody } from "../tiktok.ts";

const read = (path: string) =>
  Deno.readTextFile(new URL(path, import.meta.url));

Deno.test("Meta: a 7-day click-only ad set sends attribution_spec CLICK_THROUGH 7, nothing else does", () => {
  const base = {
    name: "s",
    optimizationGoal: "OFFSITE_CONVERSIONS",
    billingEvent: "IMPRESSIONS",
    targeting: { geo_locations: { countries: ["US"] } },
  };
  assertEquals(
    buildMetaAdSetBody("c1", { ...base, clickOnlyAttributionDays: 7 })
      .attribution_spec,
    [{ event_type: "CLICK_THROUGH", window_days: 7 }],
  );
  assertEquals("attribution_spec" in buildMetaAdSetBody("c1", base), false);
});

Deno.test("TikTok: website conversions send click SEVEN_DAYS + view OFF together; other goals send neither", () => {
  const spec = {
    name: "g",
    optimizationGoal: "CONVERT",
    billingEvent: "OCPM",
    budgetCents: 2_500,
    locationIds: ["6252001"],
    scheduleStartTime: "2026-12-01 12:00:00",
    nowMs: Date.parse("2026-11-16T00:00:00Z"),
    promotionType: "WEBSITE",
    pixelId: "PX1",
    optimizationEvent: "SHOPPING",
    clickAttributionWindow: "SEVEN_DAYS" as const,
    viewAttributionWindow: "OFF" as const,
  };
  // deno-lint-ignore no-explicit-any
  const body = buildTikTokAdGroupBody("123", "456", spec as any);
  assertEquals(body.click_attribution_window, "SEVEN_DAYS");
  assertEquals(body.view_attribution_window, "OFF");
  const traffic = buildTikTokAdGroupBody("123", "456", {
    ...spec,
    optimizationGoal: "CLICK",
    billingEvent: "CPC",
    promotionType: undefined,
    pixelId: undefined,
    optimizationEvent: undefined,
    // deno-lint-ignore no-explicit-any
  } as any);
  assertEquals("click_attribution_window" in traffic, false);
  assertEquals("view_attribution_window" in traffic, false);
});

Deno.test("create wiring: only Host conversion ad sets ask for 7-day click; the ladder's purchases ad set keeps it", async () => {
  const source = await read("../../admin-ad-create-campaign/index.ts");
  assert(source.includes(`...(requestedOwnerKind === "host" &&
        optimizationGoal === "OFFSITE_CONVERSIONS"
      ? { clickOnlyAttributionDays: 7 as const }`));
  assert(
    source.includes(
      `...(requestedOwnerKind === "host" && objectiveT === "WEB_CONVERSIONS"
          ? { clickOnlyAttributionDays: 7 as const }`,
    ),
  );
  // Not on Snapchat, Reddit or Google create bodies.
  assertEquals(source.split("clickOnlyAttributionDays").length - 1, 2);
  const tiktok = await read("../tiktok.ts");
  assert(tiktok.includes(`input.clickOnlyAttributionDays === 7`));
  const ladder = await read("../adGoalPromotion.ts");
  assert(
    ladder.includes(
      `body.attribution_spec = [{ event_type: "CLICK_THROUGH", window_days: 7 }];`,
    ),
  );
});
