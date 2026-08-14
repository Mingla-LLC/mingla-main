/**
 * ISSUE-939 — Instagram delivery for Meta ads (TESTER adversarial suite).
 *
 * DIFFERENT ANGLE from the implementor happy-path suite
 * (meta_issue939_ig_delivery.test.ts). The implementor proved the field is
 * PRESENT in the two placements when set and ABSENT when unset, with a
 * fails-on-revert that deletes BOTH assignment lines together. This suite
 * instead attacks:
 *
 *   (T1) WIRE-SHAPE LEAK-HUNT — when the IG id is set, the literal
 *        "instagram_user_id" appears in the SERIALIZED creative body EXACTLY
 *        twice (object_story_spec + top level) and NOWHERE else: not inside
 *        link_data, not inside video_data, not inside call_to_action, not in
 *        url_tags. A count of 3+ would mean a leak; a count of 1 a missing
 *        placement.
 *   (T2) TOP-LEVEL OWN-PROPERTY (the L441 line specifically) — the top-level
 *        placement is a real own-property of the adcreatives body, distinct
 *        from the object_story_spec copy. Deleting ONLY the top-level line
 *        (meta.ts:441 `body.instagram_user_id = igIdentity`) fails T1 (count→1)
 *        and T2 (own-property→false) — a fails-on-revert at a DIFFERENT line
 *        than the implementor's both-lines deletion.
 *   (T3) CROSS-BUILDER ISOLATION — buildMetaCampaignBody / buildMetaAdSetBody
 *        NEVER carry instagram_user_id even when the same env is configured:
 *        the identity must not leak into the budget/targeting/status bodies.
 *        The implementor tested only the creative builder; these two siblings
 *        are the leak surface the task names ("no leak into budget, targeting").
 *   (T4) BUSINESS-LANE ISOLATION via the REAL env resolver — with the consumer
 *        META_IG_USER_ID set and META_MINGLABIZ_IG_USER_ID UNSET (today's prod
 *        reality), resolveMetaEnvConfig("business").igUserId is null and a
 *        business-lane creative omits instagram_user_id entirely (no empty
 *        string, no consumer-IG bleed) — business stays Facebook-only.
 *   (T5) WHITESPACE-ONLY ENV — META_IG_USER_ID="   " resolves to null (the
 *        `.trim() || null` contract), and a body built from it is IG-free on
 *        the wire.
 *
 * Append-only NEW file (zero deletions). Run:
 *   deno test --allow-env supabase/functions/_shared/__tests__/meta_issue939_ig_delivery_tester_adversarial.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
// adChannel.ts ↔ meta.ts form an init cycle; evaluate adChannel first so meta.ts
// is fully initialized before the ADAPTER_REGISTRY body runs (mirrors meta.test.ts).
import "../adChannel.ts";
import {
  buildMetaAdSetBody,
  buildMetaCampaignBody,
  buildMetaCreativeBody,
  resolveMetaEnvConfig,
} from "../meta.ts";

const IG = "17841477287060530"; // @usemingla — proven linked (PROOF, 2026-07-15)
const BIZ_IG = "17999999999999999"; // distinct business IG (hypothetical)

/** Count non-overlapping occurrences of a literal substring. */
function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

// ── (T1) wire-shape leak-hunt: EXACTLY two placements, nowhere else ────────────

Deno.test("ISSUE-939 T1: IG set ⇒ 'instagram_user_id' appears EXACTLY twice in the serialized body and never inside link_data/call_to_action/url_tags (no leak)", () => {
  const body = buildMetaCreativeBody("page_1", {
    destUrl: "https://host.usemingla.com/e/lorne/tuesday-live",
    message: "m",
    headline: "h",
    description: "d",
    imageUrl: "https://img.example/x.jpg",
    callToActionType: "BUY_TICKETS",
    adName: "Ad",
    campaignName: "Camp",
  }, IG);

  const serialized = JSON.stringify(body);
  // Exactly the two intended placements — a 3rd would be a leak, a 1 a miss.
  assertEquals(countOccurrences(serialized, "\"instagram_user_id\""), 2);

  const spec = body.object_story_spec as Record<string, unknown>;
  const linkData = spec.link_data as Record<string, unknown>;
  // The IG identity must NOT contaminate link_data, its call_to_action, or url_tags.
  assertEquals("instagram_user_id" in linkData, false);
  assertEquals(
    "instagram_user_id" in (linkData.call_to_action as Record<string, unknown>),
    false,
  );
  assert(
    !String(body.url_tags ?? "").includes("instagram_user_id"),
    "url_tags UTM template must not carry the IG id",
  );
  // dest policy untouched (D-P1): the ad-visible link is still the canonical page.
  assertEquals(linkData.link, "https://host.usemingla.com/e/lorne/tuesday-live");
});

Deno.test("ISSUE-939 T1: the VIDEO branch also serializes exactly twice and never inside video_data/call_to_action", () => {
  const body = buildMetaCreativeBody("page_1", {
    destUrl: "https://host.usemingla.com/e/b/e",
    message: "m",
    headline: "t",
    videoId: "vid_123",
    videoThumbnailImageHash: "hash_1",
  }, IG);
  assertEquals(countOccurrences(JSON.stringify(body), "\"instagram_user_id\""), 2);
  const spec = body.object_story_spec as Record<string, unknown>;
  const videoData = spec.video_data as Record<string, unknown>;
  assertEquals("instagram_user_id" in videoData, false);
  assertEquals(
    "instagram_user_id" in (videoData.call_to_action as Record<string, unknown>),
    false,
  );
});

// ── (T2) top-level own-property — the meta.ts:441 line specifically ────────────

Deno.test("ISSUE-939 T2: the top-level instagram_user_id is a distinct OWN-property of the adcreatives body (deleting meta.ts:441 fails HERE, a different line than the implementor's both-lines revert)", () => {
  const body = buildMetaCreativeBody("page_1", {
    destUrl: "https://host.usemingla.com/e/b/e",
    message: "m",
    imageUrl: "https://img.example/x.jpg",
  }, IG);
  // Top-level own-property (NOT merely inherited / NOT only inside the spec).
  assert(Object.hasOwn(body, "instagram_user_id"), "top-level own-property must exist");
  assertEquals(body.instagram_user_id, IG);
  // And it is a SEPARATE copy from the object_story_spec placement.
  const spec = body.object_story_spec as Record<string, unknown>;
  assert(Object.hasOwn(spec, "instagram_user_id"), "spec own-property must exist");
  assertEquals(spec.instagram_user_id, IG);
});

// ── (T3) cross-builder isolation: no leak into campaign/ad-set budget+targeting ─

Deno.test("ISSUE-939 T3: buildMetaCampaignBody and buildMetaAdSetBody NEVER carry instagram_user_id — the identity does not leak into the budget/targeting/status bodies", () => {
  const campaign = buildMetaCampaignBody({
    name: "C",
    objective: "OUTCOME_TRAFFIC",
    dailyBudgetCents: 5000,
    validateOnly: true,
  });
  assert(
    !JSON.stringify(campaign).includes("instagram_user_id"),
    "campaign body must never contain instagram_user_id",
  );

  const adset = buildMetaAdSetBody("camp_1", {
    name: "AS",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "IMPRESSIONS",
    budgetCents: 5000,
    targeting: { geo_locations: { countries: ["GB"] } },
    validateOnly: true,
  });
  assert(
    !JSON.stringify(adset).includes("instagram_user_id"),
    "ad-set body (budget + targeting) must never contain instagram_user_id",
  );
  // Sanity: the ad-set DID build its targeting/budget — proving the negative
  // above is a real absence, not an empty object.
  assertEquals((adset as Record<string, unknown>).campaign_id, "camp_1");
  assert("targeting" in adset && "daily_budget" in adset);
});

// ── (T4) business-lane isolation via the REAL env resolver ─────────────────────

Deno.test("ISSUE-939 T4: business lane with META_MINGLABIZ_IG_USER_ID UNSET resolves igUserId=null and its creative omits instagram_user_id — no consumer-IG bleed, Facebook-only", () => {
  const keys = [
    "META_AD_ACCOUNT_ID",
    "META_PAGE_ID",
    "META_IG_USER_ID",
    "META_MINGLABIZ_AD_ACCOUNT_ID",
    "META_MINGLABIZ_PAGE_ID",
    "META_MINGLABIZ_IG_USER_ID",
  ];
  const prior = new Map(keys.map((k) => [k, Deno.env.get(k)]));
  const restore = () => {
    for (const [k, v] of prior) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  };
  try {
    // Consumer lane fully configured WITH an IG id; business lane has NO IG id.
    Deno.env.set("META_AD_ACCOUNT_ID", "act_consumer");
    Deno.env.set("META_PAGE_ID", "page_consumer");
    Deno.env.set("META_IG_USER_ID", IG);
    Deno.env.set("META_MINGLABIZ_AD_ACCOUNT_ID", "act_biz");
    Deno.env.set("META_MINGLABIZ_PAGE_ID", "page_biz");
    Deno.env.delete("META_MINGLABIZ_IG_USER_ID");

    const biz = resolveMetaEnvConfig("business");
    // Business must NOT inherit the consumer IG.
    assertEquals(biz.igUserId, null);
    assert(biz.igUserId !== IG, "business must never resolve the consumer IG");

    // A business-lane creative built from that config is Facebook-only on the wire.
    const bizBody = buildMetaCreativeBody(biz.pageId, {
      destUrl: "https://host.usemingla.com/b/venue",
      message: "m",
    }, biz.igUserId);
    assert(
      !JSON.stringify(bizBody).includes("instagram_user_id"),
      "business creative must omit instagram_user_id entirely (no empty-string leak)",
    );

    // When the business lane later gets its OWN IG, it resolves THAT, never the consumer's.
    Deno.env.set("META_MINGLABIZ_IG_USER_ID", BIZ_IG);
    assertEquals(resolveMetaEnvConfig("business").igUserId, BIZ_IG);
    assertEquals(resolveMetaEnvConfig("consumer").igUserId, IG);
  } finally {
    restore();
  }
});

// ── (T5) whitespace-only env → null (the `.trim() || null` contract) ───────────

Deno.test("ISSUE-939 T5: META_IG_USER_ID='   ' (whitespace only) resolves to null and its creative is IG-free on the wire", () => {
  const prior = Deno.env.get("META_IG_USER_ID");
  const priorAcct = Deno.env.get("META_AD_ACCOUNT_ID");
  const priorPage = Deno.env.get("META_PAGE_ID");
  try {
    Deno.env.set("META_AD_ACCOUNT_ID", "act_consumer");
    Deno.env.set("META_PAGE_ID", "page_consumer");
    Deno.env.set("META_IG_USER_ID", "   ");
    const cfg = resolveMetaEnvConfig("consumer");
    assertEquals(cfg.igUserId, null);
    const body = buildMetaCreativeBody(cfg.pageId, {
      destUrl: "https://host.usemingla.com/e/b/e",
      message: "m",
    }, cfg.igUserId);
    assertEquals(countOccurrences(JSON.stringify(body), "instagram_user_id"), 0);
  } finally {
    if (prior === undefined) Deno.env.delete("META_IG_USER_ID");
    else Deno.env.set("META_IG_USER_ID", prior);
    if (priorAcct === undefined) Deno.env.delete("META_AD_ACCOUNT_ID");
    else Deno.env.set("META_AD_ACCOUNT_ID", priorAcct);
    if (priorPage === undefined) Deno.env.delete("META_PAGE_ID");
    else Deno.env.set("META_PAGE_ID", priorPage);
  }
});
