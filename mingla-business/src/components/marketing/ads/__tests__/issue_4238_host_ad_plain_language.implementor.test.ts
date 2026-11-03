/**
 * #4238 — the Host ad copy helpers return plain words.
 *
 * Behavioural half of I-PROPOSED-HOST-AD-PLAIN-LANGUAGE: every string the
 * Host ad copy modules export, and every sentence their functions build, is
 * run through the app's own hostAdCopyIsPlain() and its exact wording checked.
 * The structural half (no internal word in copy written inline in the ad
 * screens or Ari's ad tools, the plan hash never on screen, the typed
 * LAUNCH / CANCEL PLAN / END confirmations) is owned by the strict-grep gate
 * .github/scripts/strict-grep/issue-4238-host-ad-plain-language.mjs.
 *
 * Fails on revert: restoring any old sentence such as "Immutable plan hash",
 * a status label such as "Provider review", or a raw server code reaching a
 * Host reds the matching assertion with the offending text.
 */

import {
  HOST_AD_AUDIENCE_COPY,
  HOST_AD_BANNED_WORDS,
  HOST_AD_PLATFORM_NAMES,
  HOST_AD_RESULTS_COPY,
  hostAdAudienceName,
  hostAdAudienceSize,
  hostAdAudienceStatusLine,
  hostAdCopyIsPlain,
  hostAdCostPerLabel,
  hostAdCountingLines,
  hostAdErrorMessage,
  hostAdEventLabel,
  hostAdLedgerLabel,
  hostAdNoResultsLine,
  hostAdPlaceList,
  hostAdReachLine,
  hostAdResultLabel,
  hostAdReviewReason,
  hostAdStatusLabel,
  hostAdStepLabel,
  hostAdTargetingNote,
  hostAdVerdictLabel,
  platformName,
  platformNames,
} from "../hostAdCopy";
import {
  HOST_AD_UNAVAILABLE_BODY,
  HOST_AD_UNAVAILABLE_TITLE,
  hostAdSetupErrorCopy,
} from "../hostAdSetupCopy";
import {
  HOST_AD_PAGE_TYPE_LABEL,
  HOST_AD_PAGE_TYPE_ORDER,
  hostAdPageDetails,
  hostAdPageMeta,
  hostAdPageTypeLabel,
} from "../hostAdPageLabels";
import { formatHostAdMoneyCents } from "../hostAdMoney";

const PLATFORMS = ["meta", "tiktok", "snapchat", "google", "reddit"] as const;

/** Every text that is not plain, so a failure names the offending sentence. */
const notPlain = (texts: readonly string[]): string[] =>
  texts.filter((text) => !hostAdCopyIsPlain(text));

describe("#4238 the plain-language check itself", () => {
  it("catches the old wording and passes plain sentences", () => {
    for (const old of [
      "Immutable plan hash",
      "Provider estimates overlap",
      "This provider can run a broader audience. Review the exact widening before accepting it.",
      "provider create returned no campaign id",
      "Delivery snapshot frozen",
      "Saved at budget",
      "Lagos (NG:lagos)",
      "12 conversions, 4,000 impressions",
    ]) {
      expect({ old, plain: hostAdCopyIsPlain(old) }).toEqual({ old, plain: false });
    }
    expect(hostAdCopyIsPlain("Your ad is running on TikTok.")).toBe(true);
    expect(HOST_AD_BANNED_WORDS.length).toBeGreaterThanOrEqual(20);
  });
});

describe("#4238 Host ad copy modules return plain words", () => {
  it("the setup screen copy is plain", () => {
    expect(HOST_AD_UNAVAILABLE_TITLE).toBe("Ads aren't available yet");
    expect(
      notPlain([
        HOST_AD_UNAVAILABLE_TITLE,
        HOST_AD_UNAVAILABLE_BODY,
        hostAdSetupErrorCopy(null),
        hostAdSetupErrorCopy("currency_authority_unresolved"),
        hostAdSetupErrorCopy("currency_authority_unresolved:brand"),
        hostAdSetupErrorCopy("rpc_failed"),
      ]),
    ).toEqual([]);
    // A raw server code never reaches a Host.
    expect(hostAdSetupErrorCopy("currency_authority_unresolved")).toBe(
      "Set your brand's payout currency before running ads.",
    );
    expect(hostAdSetupErrorCopy("rpc_failed")).toBe("Ads setup couldn't load. Try again.");
  });

  it("page labels name pages the way Hosts know them", () => {
    const labels = HOST_AD_PAGE_TYPE_ORDER.map((type) => HOST_AD_PAGE_TYPE_LABEL[type]);
    expect(notPlain(labels)).toEqual([]);
    expect(hostAdPageTypeLabel("site")).toBe("Website");
    expect(hostAdPageTypeLabel("marketing")).toBe("Page");
    const meta = hostAdPageMeta({ page_type: "trip", starts_at: null, city: " Lagos " });
    expect(meta).toBe("Trip · Lagos");
    expect(hostAdPageDetails({ page_type: "trip", starts_at: null, city: "Lagos" })).toBe("Lagos");
  });

  it("names platforms the way Hosts know them", () => {
    expect(platformName("meta")).toBe("Facebook & Instagram");
    expect(platformName("tiktok")).toBe("TikTok");
    expect(platformNames(["meta", "snapchat", "tiktok"])).toBe(
      "Facebook & Instagram, Snapchat and TikTok",
    );
    expect(notPlain(Object.values(HOST_AD_PLATFORM_NAMES))).toEqual([]);
  });

  it("every status, step, timeline, verdict and credit label is plain", () => {
    const statuses = [
      "live", "active", "partially_live", "paused", "pause_requested", "ended",
      "archived", "deleted", "draft", "validating", "ready_for_funding",
      "funded_held", "staff_review_required", "staff_approved",
      "creating_paused_objects", "creation_failed_retryable",
      "creation_failed_terminal", "changes_requested", "cancelled_before_create",
      "launched",
    ];
    const steps = ["promote", "audience", "budget", "creative", "review"];
    const events = [
      "create", "launch", "pause", "resume", "end", "cancel", "hold", "release",
      "top_up", "withdraw", "campaign_spend", "unspend_return", "spend", "refund",
    ];
    const verdicts = ["exact", "broader", "unavailable", "check_required"];
    const ledger = ["top_up", "withdraw", "unspend_return", "campaign_spend", "provider_fee_adjustment"];
    expect(
      notPlain([
        ...statuses.map(hostAdStatusLabel),
        ...steps.map((step) => `Saved at ${hostAdStepLabel(step)}`),
        ...events.map(hostAdEventLabel),
        ...verdicts.map(hostAdVerdictLabel),
        ...ledger.map(hostAdLedgerLabel),
        hostAdReviewReason("first_three_host_campaigns"),
      ]),
    ).toEqual([]);
    expect(hostAdStatusLabel("PARTIALLY_LIVE")).toBe("Running on some apps");
    expect(hostAdStatusLabel("staff_review_required")).toBe("Mingla is checking your ad");
    expect(hostAdStepLabel("creative")).toBe("Video and words");
    // An unknown credit kind reads as a safe phrase, never the raw code.
    expect(hostAdLedgerLabel("provider_fee_adjustment")).toBe("Ads credit change");
    expect(hostAdReviewReason("first_three_host_campaigns")).toBe(
      "Mingla checks a brand's first three ads before they run",
    );
  });

  it("result words are the ones Hosts use", () => {
    const kinds = [
      "conversions", "landing_page_view", "landing page view",
      "rsvp_registration", "ticket_purchase", "link_click", "sign_up", "impressions",
    ];
    expect(
      notPlain([
        ...kinds.map(hostAdResultLabel),
        ...kinds.map(hostAdCostPerLabel),
        ...kinds.map(hostAdNoResultsLine),
        ...Object.values(hostAdCountingLines(kinds)),
        ...Object.values(HOST_AD_RESULTS_COPY),
      ]),
    ).toEqual([]);
    expect(hostAdResultLabel("conversions")).toBe("results");
    expect(hostAdResultLabel("landing page view")).toBe("page visits");
    expect(hostAdResultLabel("rsvp_registration")).toBe("RSVPs");
    // "impressions" is banned; the raw key must come back as Host words.
    expect(hostAdResultLabel("impressions")).toBe("times shown");
    expect(hostAdResultLabel("Impression")).toBe("times shown");
    expect(hostAdCopyIsPlain(hostAdResultLabel("impressions"))).toBe(true);
    expect(hostAdCopyIsPlain(hostAdCostPerLabel("impressions"))).toBe(true);
    expect(hostAdCountingLines(["rsvp_registration", "landing_page_view"]).counts).toBe(
      "We count RSVPs, then page visits.",
    );
  });

  it("targeting notes become next steps on every branch", () => {
    const lines = [
      "Resolve Meta city keys for: NG:lagos, GH:accra.",
      "Radius targeting needs at least one verified city.",
      "Reddit cannot preserve city targeting; the selected countries are broader.",
      "Radius rounded to the provider minimum.",
      "Age buckets are provider-native.",
      "Gender targeting unsupported.",
      "Interest targeting is a provider hint.",
      "Something new from the provider snapshot.",
    ];
    const notes = PLATFORMS.flatMap((platform) =>
      ["exact", "broader", "unavailable", "check_required"].flatMap((verdict) =>
        lines.map((line) => hostAdTargetingNote(platform, verdict, line, ["NG"])),
      ),
    );
    expect(notPlain(notes)).toEqual([]);
    expect(
      hostAdTargetingNote(
        "reddit",
        "broader",
        "Reddit cannot preserve city targeting; the selected countries are broader.",
        ["NG"],
      ),
    ).toBe("Reddit can't target cities, so it will show your ad across Nigeria. Accept that or turn Reddit off.");
    expect(
      hostAdTargetingNote("meta", "check_required", "Resolve Meta city keys for: Ikeja."),
    ).toBe("Facebook & Instagram couldn't find Ikeja. Remove it, or turn Facebook & Instagram off.");
    // Raw city keys are spelled out.
    expect(hostAdPlaceList("NG:lagos, GH:accra")).toBe("Lagos, Nigeria and Accra, Ghana");
  });

  it("reach and audience lines are plain", () => {
    expect(
      notPlain([
        ...PLATFORMS.map((p) => hostAdReachLine(p, { state: "available", lower_bound: 1000, upper_bound: 2000 })),
        ...PLATFORMS.map((p) => hostAdReachLine(p, null)),
        ...PLATFORMS.flatMap((p) =>
          ["ready", "below_minimum", "too_small", "pending", "terms_required", "ineligible", "unsupported", null, "rejected"].map((state) =>
            hostAdAudienceStatusLine(p, state, 120),
          ),
        ),
        ...Object.values(HOST_AD_AUDIENCE_COPY),
        hostAdAudienceName({ name: "", kind: "lookalike", lookalikeCountry: "NG" }),
        ...[
          hostAdAudienceSize({ approxSize: 250, platforms: [] }),
          hostAdAudienceSize({ approxSize: 1, platforms: [] }),
          hostAdAudienceSize({ approxSize: 0, platforms: [] }),
          hostAdAudienceSize({ kind: "lookalike", approxSize: null, platforms: [{ platform: "meta", state: "ready" }] }),
        ].filter((line): line is string => line !== null),
      ]),
    ).toEqual([]);
    expect(hostAdReachLine("tiktok", null)).toBe("TikTok didn't give us a reach number yet. Your ad can still run.");
  });

  it("errors become plain next steps; raw technical text never reaches a Host", () => {
    const codes = [
      "network", "forbidden", "currency_authority_unresolved", "staff_review_required",
      "draft_conflict", "plan_version_hash_mismatch", "budget_below_minimum",
      "pixel_no_signal", "tiktok_not_connected", "insufficient_balance",
      "destination_not_public", "creative_not_ready", "boom",
      "audience_country_mismatch", "audience_binding_mismatch", "audience_not_owned",
      "audience_selection_invalid",
    ];
    expect(notPlain(codes.map((code) => hostAdErrorMessage({ code, detail: code })))).toEqual([]);
    expect(hostAdErrorMessage({ code: "network", detail: "fetch failed" })).toBe(
      "We couldn't reach Mingla. Check your connection and try again.",
    );
    expect(
      hostAdErrorMessage({ code: "plan_preflight_failed", detail: "budget_below_minimum" }),
    ).toContain("Your daily budget is too low");
    expect(
      hostAdErrorMessage({
        code: "validation_error",
        detail: "x",
        message: "Choose at least one app to show your ad on.",
      }),
    ).toBe("Choose at least one app to show your ad on.");
    for (const message of [
      "provider_create_failed in lane business",
      "provider create returned no campaign id",
      "Immutable plan hash mismatch",
    ]) {
      expect(hostAdErrorMessage({ code: "boom", detail: "x", message })).toContain("Try again in a minute");
    }
  });

  it("money is written the one Host way, never as raw cents", () => {
    expect(formatHostAdMoneyCents(150000000, "ngn")).toBe("NGN 1,500,000.00");
    expect(formatHostAdMoneyCents("2550", "USD")).toBe("USD 25.50");
    expect(formatHostAdMoneyCents(-1, "USD")).toBeNull();
  });
});
