/**
 * #4238 media-buyer, wave C (server) — the Host's button mapped to each
 * app's own value, words refused (never cut) when over an app's limit, each
 * app's daily minimum checked before money, and standard UTM tags.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HOST_AD_CTA_BY_PLATFORM,
  HOST_AD_CTAS,
  hostAdUtmQuery,
  hostAdUtmSlug,
  hostCopyTooLong,
  hostCtaAllowlisted,
  hostCtaForPlatform,
} from "../adHostCreative.ts";
import {
  allocationBelowMinimum,
  providerDailyMinimumCents,
} from "../adHostPlanRules.ts";
import { metaHostUrlTags } from "../meta.ts";
import { buildRedditAdBody } from "../reddit.ts";

Deno.test("C3 four buttons map to each app's own value; Google has none", () => {
  assertEquals([...HOST_AD_CTAS], ["tickets", "book", "signup", "learn"]);
  assertEquals(hostCtaForPlatform("meta", "tickets"), "BUY_TICKETS");
  assertEquals(hostCtaForPlatform("snapchat", "learn"), "MORE");
  assertEquals(hostCtaForPlatform("reddit", "book"), "Book Now");
  assertEquals(hostCtaForPlatform("google", "tickets"), null);
  // Snapchat and Reddit values sit in those apps' pinned allowlists.
  assert(hostCtaAllowlisted());
  // Reddit's are Title-Case display strings, never upper-cased.
  for (const value of Object.values(HOST_AD_CTA_BY_PLATFORM.reddit)) {
    assert(value !== value.toUpperCase());
  }
});

Deno.test("C4 over-limit words are refused per app, never cut", () => {
  assertEquals(
    hostCopyTooLong(["tiktok"], { primary: "x".repeat(101), headline: "ok" }),
    { platform: "tiktok", field: "primary", max: 100 },
  );
  assertEquals(
    hostCopyTooLong(["snapchat"], { primary: "x", headline: "y".repeat(35) }),
    { platform: "snapchat", field: "headline", max: 34 },
  );
  assertEquals(
    hostCopyTooLong(["meta", "reddit"], { primary: "x".repeat(300), headline: "y" }),
    null,
  );
  // Emoji count as one character each.
  assertEquals(hostCopyTooLong(["tiktok"], { primary: "🎉".repeat(100) }), null);
});

Deno.test("C1 each app's daily minimum is checked in the account's money", () => {
  assertEquals(providerDailyMinimumCents("tiktok", { currency: "USD" }, "visits"), 5000);
  assertEquals(providerDailyMinimumCents("snapchat", { currency: "USD" }, "visits"), 2000);
  assertEquals(
    providerDailyMinimumCents("meta", {
      currency: "USD",
      extra: { minimum_budgets: { high_freq: 120, low_freq: 4000 } },
    }, "sales"),
    4000,
  );
  assertEquals(providerDailyMinimumCents("tiktok", { currency: "EUR" }, "visits"), null);
  assertEquals(
    allocationBelowMinimum([
      { platform: "meta", provider_delivery_budget_cents: 1000, minimum_cents: 120 },
      { platform: "tiktok", provider_delivery_budget_cents: 4999, minimum_cents: 5000 },
    ]),
    { platform: "tiktok", minimum_cents: 5000 },
  );
});

Deno.test("C6 standard UTM tags; Mingla's click ids stay alongside", () => {
  assertEquals(hostAdUtmSlug("Sunday Rooftop Sessions!"), "sunday-rooftop-sessions");
  assertEquals(hostAdUtmSlug("Ẹ̀kọ́ Nights"), "eko-nights");
  assertEquals(
    hostAdUtmQuery("meta", "Sunday Rooftop"),
    "utm_source=facebook&utm_medium=paid_social&utm_campaign=sunday-rooftop",
  );
  const tags = metaHostUrlTags(hostAdUtmQuery("meta", "Sunday"));
  assertStringIncludes(tags, "utm_medium=paid_social");
  assertStringIncludes(tags, "mc_id={{campaign.id}}");
  const reddit = buildRedditAdBody({
    adGroupExternalId: "t6_1",
    name: "Sunday Rooftop ad",
    postId: "t3_abc",
    profileId: "t2_abc",
    clickUrl: "https://usemingla.com/e/b/sunday",
    utmCampaign: "sunday-rooftop",
    utmMedium: "paid_social",
    extraQueryParameters: [{ name: "mc_id", value: "row-1" }],
  });
  const params = reddit.click_url_query_parameters as { name: string; value: string }[];
  assertEquals(params.find((p) => p.name === "utm_medium")?.value, "paid_social");
  assertEquals(params.find((p) => p.name === "utm_campaign")?.value, "sunday-rooftop");
  assertEquals(params.find((p) => p.name === "mc_id")?.value, "row-1");
});

Deno.test("C3 create-campaign uses the plan's button for Host ads, never the client's", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assertStringIncludes(src, "const frozenCta = hostCanonical.call_to_action;");
  assertStringIncludes(src, "delete creativeBody.call_to_action;");
  assertStringIncludes(src, "delete creativeBody.call_to_action_type;");
  assertStringIncludes(src, "urlTags: metaHostUrlTags(hostUtmQuery)");
});
