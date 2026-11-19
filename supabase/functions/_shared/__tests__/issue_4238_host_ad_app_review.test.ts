// MINGLA-INVARIANT: I-4238-HOST-AD-APP-REVIEW | issue #4238 | a launched Host ad says In review until an app shows it: the Ads list reports each app's own review (in_review / showing / not_approved), and a live plan whose every app is still checking is listed as in_review, not live.
/**
 * #4238 — Tinoe's Yard launch (19 Nov 2026). The plan went live and the Ads
 * list said "Running" while Meta's three ads were IN_PROCESS and Snapchat's
 * were PENDING: nothing had been shown or spent.
 *
 * FAILS-ON-REVERT: drop the app_reviews block in buildHostCampaignList and
 * the live-but-checking plan lists as "live" with no app_reviews.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  appReviewState,
  buildHostCampaignList,
} from "../hostAdCampaignList.ts";

function launch(input: {
  metaReview: Array<string | null>;
  snapReview: Array<string | null>;
  metaImpressions?: number;
  snapImpressions?: number;
}) {
  const campaign = (id: string, platform: string) => ({
    id,
    name: "Tinoe's Yard: 2nd Edition",
    status: "ACTIVE",
    platform,
    currency: platform === "meta" ? "USD" : "USD",
    plan_version_id: "version-1",
    starts_at: "2026-11-19T00:00:00.000Z",
    created_at: "2026-11-19T03:10:00.000Z",
    updated_at: "2026-11-19T03:11:00.000Z",
  });
  const ads = [
    ...input.metaReview.map((review_status, i) => ({
      id: `meta-ad-${i}`,
      ad_set_id: "set-meta",
      status: "ACTIVE",
      review_status,
    })),
    ...input.snapReview.map((review_status, i) => ({
      id: `snap-ad-${i}`,
      ad_set_id: "set-snap",
      status: "ACTIVE",
      review_status,
    })),
  ];
  return buildHostCampaignList({
    campaigns: [campaign("c-meta", "meta"), campaign("c-snap", "snapchat")],
    versions: [{
      id: "version-1",
      host_currency: "NGN",
      host_budget_cents: 3_300_000,
      canonical_plan: { name: "Tinoe's Yard: 2nd Edition" },
    }],
    plans: [{
      id: "plan-1",
      current_version_id: "version-1",
      state: "live",
      updated_at: "2026-11-19T03:11:14.000Z",
    }],
    spend: [
      ...(input.metaImpressions
        ? [{
          campaign_id: "c-meta",
          spend_cents: 10,
          currency: "USD",
          impressions: input.metaImpressions,
          clicks: 0,
        }]
        : []),
      ...(input.snapImpressions
        ? [{
          campaign_id: "c-snap",
          spend_cents: 10,
          currency: "USD",
          impressions: input.snapImpressions,
          clicks: 0,
        }]
        : []),
    ],
    conversions: [],
    adSets: [
      { id: "set-meta", campaign_id: "c-meta" },
      { id: "set-snap", campaign_id: "c-snap" },
    ],
    ads,
    nowIso: "2026-11-19T04:00:00.000Z",
  })[0];
}

Deno.test("#4238 one app's review: truth table", () => {
  assertEquals(appReviewState([null, null], 0), "in_review");
  assertEquals(appReviewState(["IN_PROCESS"], 0), "in_review");
  assertEquals(appReviewState(["PENDING_REVIEW"], 0), "in_review");
  assertEquals(appReviewState(["PENDING", "PENDING"], 0), "in_review");
  assertEquals(appReviewState(["ACTIVE"], 0), "showing");
  assertEquals(appReviewState(["APPROVED"], 0), "showing");
  assertEquals(appReviewState([null], 120), "showing");
  assertEquals(appReviewState(["DISAPPROVED"], 0), "not_approved");
  assertEquals(appReviewState(["REJECTED", "REJECTED"], 50), "not_approved");
  // One ad turned down, another still checking: the app is still checking.
  assertEquals(appReviewState(["REJECTED", "PENDING"], 0), "in_review");
  // One ad turned down, another approved: the app shows the approved one.
  assertEquals(appReviewState(["REJECTED", "APPROVED"], 0), "showing");
  assertEquals(appReviewState([], 0), "showing");
});

Deno.test("#4238 just launched, both apps checking: In review, not live", () => {
  const row = launch({
    metaReview: [null, null, null],
    snapReview: ["PENDING", "PENDING", "PENDING"],
  });
  assertEquals(row.lifecycle, "in_review");
  assertEquals(row.next_action, "Track review");
  assertEquals(row.app_reviews, [
    { platform: "meta", state: "in_review" },
    { platform: "snapchat", state: "in_review" },
  ]);
});

Deno.test("#4238 Meta showing, Snapchat checking: live, with each app's state", () => {
  const row = launch({
    metaReview: ["ACTIVE", "ACTIVE", "ACTIVE"],
    snapReview: ["PENDING", "PENDING", "PENDING"],
    metaImpressions: 900,
  });
  assertEquals(row.lifecycle, "live");
  assertEquals(row.app_reviews, [
    { platform: "meta", state: "showing" },
    { platform: "snapchat", state: "in_review" },
  ]);
});

Deno.test("#4238 every app turned it down: needs a look", () => {
  const row = launch({
    metaReview: ["DISAPPROVED"],
    snapReview: ["REJECTED"],
  });
  assertEquals(row.lifecycle, "needs_attention");
});
