/**
 * #4238 media-buyer, tester round 9 — adversarial checks after the r8 rework.
 * A different angle from issue_4238_mb_live_edit_r9.implementor.test.ts and
 * issue_4238_mb_r9_rework.implementor.test.ts: apps Mingla cannot push a
 * daily amount to, many random plans across currencies, and TikTok's own
 * button list.
 *
 *   U1  Lowering a live Meta + Google ad so Google's new cap falls under its
 *       current daily amount must not ask Google for a daily push (Mingla
 *       can't push Google's daily; it stops Google at the cap). Seen live on
 *       the r9 harness: a lower to NGN 1,000,000 came back
 *       502 google_budget_update_failed / provider_budget_readback_unavailable
 *       and the Host read "Nothing was changed; try again in a minute".
 *       RED at 16e1997a3.
 *   U2  Over 3,000 random plans (1–3 apps, NGN/GBP/USD-like frozen ratios,
 *       one app often past its share): the caps, converted back at the frozen
 *       ratio, never add up to more than the new total, and no cap is under
 *       that app's spend. GREEN at 16e1997a3.
 *   U3  Every TikTok button Mingla can send is a key of TikTok's own
 *       CallToAction enum (tiktok-business-api-sdk yml_files/
 *       smart_plus_ad_create.yml, enum_package_name CallToAction), old
 *       display labels map to those keys, and an unknown label is refused
 *       before any request. GREEN at 16e1997a3.
 */
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HOST_LIVE_DAILY_PUSH,
  type HostLiveCampaign,
  planHostLiveEdit,
} from "../adHostLiveEdit.ts";
import {
  type Platform,
  TIKTOK_CTA_CODES,
  TIKTOK_CTA_MAP,
  tiktokCallToActionCode,
} from "../adChannelCore.ts";
import { HOST_AD_CTA_BY_PLATFORM } from "../adHostCreative.ts";
import { buildTikTokAdBody } from "../tiktok.ts";

const NOW = Date.parse("2026-11-04T00:00:00Z");
const END_5_DAYS = "2026-11-09T00:00:00Z";

Deno.test("U1 a lower never pushes a daily amount to an app Mingla can't push to", () => {
  // The r9 harness plan: NGN 3,100,000; Meta and Google each NGN 1,550,000
  // = USD 1,000 (rate 1,550), both USD 100 a day. Meta spent USD 490 and
  // Google USD 10 (NGN 775,000 together). The Host lowers to NGN 1,000,000.
  const camp = (platform: Platform, id: string, spend: number): HostLiveCampaign => ({
    id,
    platform,
    host_budget_cents: 155_000_000,
    host_delivery_budget_cents: 15_500_000,
    provider_budget_cents: 100_000,
    provider_delivery_budget_cents: 10_000,
    current_cap_cents: 100_000,
    current_daily_cents: 10_000,
    provider_spend_cents: spend,
    provider_daily_minimum_cents: platform === "meta" ? 500 : 0,
  });
  const planned = planHostLiveEdit({
    planState: "live",
    lastEditAt: null,
    nowMs: NOW,
    newHostBudgetCents: 100_000_000,
    newEndsAt: null,
    currentHostBudgetCents: 310_000_000,
    currentEndsAt: END_5_DAYS,
    lastBookableAt: "2026-12-06T22:59:00Z",
    hostSpendCents: 77_500_000,
    campaigns: [camp("meta", "m", 49_000), camp("google", "g", 1_000)],
  });
  assert(planned.ok, `planned: ${JSON.stringify(planned)}`);
  const google = planned.lines.find((line) => line.platform === "google")!;
  assert(!HOST_LIVE_DAILY_PUSH.has("google"));
  // Google's cap shrinks under its USD 100 a day; that is fine, Mingla stops
  // Google at the cap. What must not happen is a daily push to Google.
  assert(google.new_provider_budget_cents < 10_000);
  assertEquals(
    google.daily_changed,
    false,
    "Google's daily can't be pushed; daily_changed=true makes runHostLiveEdit call Google and fail the whole edit",
  );
  assert(planned.dailyNotPushed.includes("google"));
  // The recorded daily may never exceed the cap (host_ad_amend_live refuses that).
  assert(google.new_provider_delivery_budget_cents <= google.new_provider_budget_cents);
});

// Small deterministic PRNG so a failure names its seed.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

Deno.test("U2 random plans: caps fit the new total at the frozen ratio, never under spend", () => {
  const platforms: Platform[] = ["meta", "google", "reddit", "tiktok", "snapchat"];
  // host minor units per provider minor unit (NGN 15.5 kobo per US cent,
  // GBP 0.78 pence per cent, USD 1:1 and a fee-style 1.15).
  const ratios = [15.5, 0.78, 1, 1.15, 13.7];
  let checked = 0;
  for (let seed = 1; seed <= 3_000; seed++) {
    const r = rng(seed);
    const hostPerProvider = ratios[Math.floor(r() * ratios.length)];
    const count = 1 + Math.floor(r() * 3);
    const campaigns: HostLiveCampaign[] = [];
    let hostSpend = 0;
    let total = 0;
    for (let i = 0; i < count; i++) {
      const host = 50_000 + Math.floor(r() * 5_000_000);
      const provider = Math.max(1, Math.floor(host / hostPerProvider));
      const spendShare = r() < 0.4 ? 0.6 + r() * 0.5 : r() * 0.3; // often past its share
      const spend = Math.floor(provider * spendShare);
      hostSpend += Math.ceil(spend * hostPerProvider);
      total += host;
      campaigns.push({
        id: `c${i}`,
        platform: platforms[i],
        host_budget_cents: host,
        host_delivery_budget_cents: Math.max(1, Math.floor(host / 10)),
        provider_budget_cents: provider,
        provider_delivery_budget_cents: Math.max(1, Math.floor(provider / 10)),
        current_cap_cents: provider,
        current_daily_cents: Math.max(1, Math.floor(provider / 10)),
        provider_spend_cents: spend,
        provider_daily_minimum_cents: null,
      });
    }
    const newBudget = hostSpend + 1 + Math.floor(r() * total);
    const planned = planHostLiveEdit({
      planState: "live",
      lastEditAt: null,
      nowMs: NOW,
      newHostBudgetCents: newBudget,
      newEndsAt: null,
      currentHostBudgetCents: total,
      currentEndsAt: END_5_DAYS,
      lastBookableAt: "2026-12-06T22:59:00Z",
      hostSpendCents: hostSpend,
      campaigns,
    });
    if (!planned.ok) {
      // Only "too little left" may refuse (a share under one cent).
      assertEquals(planned.error, "host_ad_live_edit_below_spend", `seed ${seed}`);
      continue;
    }
    let capsHost = 0;
    for (const line of planned.lines) {
      const row = campaigns.find((c) => c.id === line.campaign_id)!;
      assert(
        line.new_provider_budget_cents >= row.provider_spend_cents,
        `seed ${seed}: cap under spend`,
      );
      const ratio = row.provider_budget_cents / row.host_budget_cents;
      capsHost += ratio === 1
        ? line.new_provider_budget_cents
        : Math.round(line.new_provider_budget_cents / ratio);
    }
    // The spend in host money was rounded up per app above, so allow the
    // same rounding (one minor unit per app) and no more.
    assert(
      capsHost <= newBudget + campaigns.length,
      `seed ${seed}: caps ${capsHost} > total ${newBudget}`,
    );
    checked++;
  }
  assert(checked > 2_000, `only ${checked} plans were checked`);
});

// Keys of TikTok's CallToAction enum, copied from the SDK spec cited in
// adChannelCore.ts (yml_files/smart_plus_ad_create.yml, read 2026-11-03).
const TIKTOK_SDK_CALL_TO_ACTION = new Set([
  "APPLY_NOW", "BOOK_NOW", "CALL_NOW", "CHECK_AVAILABILITY", "CONTACT_US",
  "DOWNLOAD_NOW", "EXPERIENCE_NOW", "GET_QUOTE", "GET_SHOWTIMES",
  "GET_TICKETS_NOW", "INSTALL_NOW", "INTERESTED", "JOIN_THIS_HASHTAG",
  "LEARN_MORE", "LISTEN_NOW", "ORDER_NOW", "PLAY_GAME", "PREORDER_NOW",
  "READ_MORE", "SEND_MESSAGE", "SHOOT_WITH_THIS_EFFECT", "SHOP_NOW",
  "SIGN_UP", "SUBSCRIBE", "VIEW_NOW", "VIEW_PROFILE",
  "VIEW_VIDEO_WITH_THIS_EFFECT", "VISIT_STORE", "WATCH_LIVE", "WATCH_NOW",
]);

Deno.test("U3 every TikTok button is a TikTok CallToAction key; labels map; unknown refused", () => {
  for (const code of TIKTOK_CTA_CODES) {
    assert(TIKTOK_SDK_CALL_TO_ACTION.has(code), `${code} is not in TikTok's enum`);
  }
  for (const code of Object.values(TIKTOK_CTA_MAP)) {
    assert(TIKTOK_SDK_CALL_TO_ACTION.has(code), `map: ${code}`);
  }
  assertEquals(HOST_AD_CTA_BY_PLATFORM.tiktok, {
    tickets: "GET_TICKETS_NOW",
    book: "BOOK_NOW",
    signup: "SIGN_UP",
    learn: "LEARN_MORE",
  });
  // Admin's builder (mingla-admin/src/lib/adBuilder/copyRules.js) and saved
  // drafts still send display labels.
  const labels: Record<string, string> = {
    "Get ticket now": "GET_TICKETS_NOW",
    "Book now": "BOOK_NOW",
    "Get showtimes": "GET_SHOWTIMES",
    "Learn more": "LEARN_MORE",
    "Sign up": "SIGN_UP",
    " learn more ": "LEARN_MORE",
  };
  for (const [label, code] of Object.entries(labels)) {
    assertEquals(tiktokCallToActionCode(label), code, label);
  }
  for (const bad of ["Buy now!!", "DOWNLOAD", "", "Get directions"]) {
    assertEquals(tiktokCallToActionCode(bad), null, bad);
  }
  // The real ad body: each Host button lands as its code; an unknown one is
  // refused before any request is built.
  const spec = (callToAction: string | undefined) => ({
    adName: "r9",
    adFormat: "SINGLE_VIDEO",
    imageIds: ["ad-cover-r9-0001"],
    videoId: "v_r9_0001",
    identityType: "TT_USER",
    identityId: "7423800000000000009",
    adText: "Sundays on the roof",
    callToAction,
    landingPageUrl: "https://host.usemingla.com/e/femzy/sunday-rooftop",
  });
  // deno-lint-ignore no-explicit-any
  const build = (cta: string | undefined) => buildTikTokAdBody("7423800000000000001", "1800000000000000001", spec(cta) as any);
  const bodyCta = (body: Record<string, unknown>): unknown => {
    const creatives = body.creatives as Array<Record<string, unknown>> | undefined;
    return creatives?.[0]?.call_to_action ?? body.call_to_action;
  };
  for (const code of Object.values(HOST_AD_CTA_BY_PLATFORM.tiktok)) {
    assertEquals(bodyCta(build(code) as Record<string, unknown>), code);
  }
  assertEquals(bodyCta(build("Get ticket now") as Record<string, unknown>), "GET_TICKETS_NOW");
  assertEquals(bodyCta(build(undefined) as Record<string, unknown>), "LEARN_MORE");
  assertThrows(() => build("Buy now!!"));
});
