/**
 * ISSUE-939 — Instagram delivery for Meta ads (implementor happy-path suite).
 *
 * PROVEN LIVE (2026-07-15): the @usemingla IG account 17841477287060530 is
 * linked at the Mingla business level, the Mingla-server system user has full
 * access, and a validate-only ad creative WITH instagram_user_id=17841477287060530
 * returns {"success":true}. Before this change the creative builder passed NO
 * instagram_user_id, so Meta ads delivered Facebook-only.
 *
 * Regression contract coverage:
 *   (a) IG id set  ⇒ instagram_user_id present in BOTH object_story_spec AND at
 *       the adcreatives top level (the two placements the validate-only proof set).
 *       Deleting EITHER `body.instagram_user_id` / `objectStorySpec.instagram_user_id`
 *       line in buildMetaCreativeBody makes IG_SET fail (fails-on-revert).
 *   (b) IG id unset/empty ⇒ instagram_user_id ABSENT everywhere — no empty-string
 *       leak — so the creative behaves exactly as before (Facebook-only). This
 *       preserves the business lane (no biz IG configured yet) and any test env.
 *   (c) Per-lane resolution: consumer → META_IG_USER_ID, business →
 *       META_MINGLABIZ_IG_USER_ID; the business lane never falls back to the
 *       consumer IG (mirrors the QA P2-3 lane-correctness contract).
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/meta_issue939_ig_delivery.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
// adChannel.ts and meta.ts form an import cycle (adChannel's ADAPTER_REGISTRY
// references metaAdapter). Evaluating adChannel.ts FIRST makes meta.ts fully
// initialize before the registry body runs — mirrors meta.test.ts, which
// imports adChannel before meta. Importing meta.ts first hits a metaAdapter TDZ.
import "../adChannel.ts";
import { buildMetaCreativeBody, resolveMetaEnvConfig } from "../meta.ts";

const IG = "17841477287060530"; // @usemingla — proven linked (PROOF, 2026-07-15)

// ── (a) IG id set ⇒ instagram_user_id in BOTH placements ───────────────────────

Deno.test("ISSUE-939 (a): IG id set ⇒ instagram_user_id in BOTH object_story_spec AND the top-level creative body", () => {
  const body = buildMetaCreativeBody("page_1", {
    destUrl: "https://business.usemingla.com/e/lorne/tuesday-live",
    message: "m",
    headline: "h",
    imageUrl: "https://img.example/x.jpg",
    callToActionType: "BUY_TICKETS",
  }, IG);
  // Deleting `body.instagram_user_id = igIdentity` in buildMetaCreativeBody
  // fails this top-level assertion (fails-on-revert).
  assertEquals(body.instagram_user_id, IG);
  const spec = body.object_story_spec as Record<string, unknown>;
  // Deleting `objectStorySpec.instagram_user_id = igIdentity` fails this one.
  assertEquals(spec.instagram_user_id, IG);
  // The IG identity does NOT displace the destination policy — dest_url is still
  // canonical (A4.f / D-P1 preserved).
  const linkData = spec.link_data as Record<string, unknown>;
  assertEquals(linkData.link, "https://business.usemingla.com/e/lorne/tuesday-live");
});

Deno.test("ISSUE-939 (a): the video creative branch also carries the IG identity in BOTH placements", () => {
  const body = buildMetaCreativeBody("page_1", {
    destUrl: "https://business.usemingla.com/e/b/e",
    message: "m",
    headline: "t",
    videoId: "vid_123",
    videoThumbnailImageHash: "hash_1",
  }, IG);
  assertEquals(body.instagram_user_id, IG);
  const spec = body.object_story_spec as Record<string, unknown>;
  assertEquals(spec.instagram_user_id, IG);
  // video_data branch is intact — IG identity rides alongside, not instead.
  assertEquals((spec.video_data as Record<string, unknown>).video_id, "vid_123");
});

// ── (b) IG id unset/empty ⇒ instagram_user_id ABSENT everywhere ───────────────

Deno.test("ISSUE-939 (b): IG id unset/null/empty/whitespace ⇒ instagram_user_id ABSENT everywhere (no empty-string leak, Facebook-only preserved)", () => {
  const cases: Array<string | null | undefined> = [undefined, null, "", "   "];
  for (const ig of cases) {
    const body = buildMetaCreativeBody("page_1", {
      destUrl: "https://business.usemingla.com/e/b/e",
      message: "m",
      imageUrl: "https://img.example/x.jpg",
    }, ig);
    assertEquals("instagram_user_id" in body, false);
    const spec = body.object_story_spec as Record<string, unknown>;
    assertEquals("instagram_user_id" in spec, false);
    // Belt-and-suspenders: the literal key must not appear ANYWHERE in the
    // serialized body — proves there is no empty/undefined value being sent.
    assert(
      !JSON.stringify(body).includes("instagram_user_id"),
      `instagram_user_id must be fully omitted when the IG id is ${JSON.stringify(ig)}`,
    );
  }
});

Deno.test("ISSUE-939 (b): omitting the igUserId argument entirely behaves exactly as today (Facebook-only)", () => {
  const body = buildMetaCreativeBody("page_1", {
    destUrl: "https://business.usemingla.com/e/b/e",
    message: "m",
  });
  assertEquals("instagram_user_id" in body, false);
  assertEquals(
    "instagram_user_id" in (body.object_story_spec as Record<string, unknown>),
    false,
  );
});

// ── (c) per-lane env resolution (consumer vs business) ─────────────────────────

Deno.test("ISSUE-939 (c): resolveMetaEnvConfig sources the IG id per lane (consumer META_IG_USER_ID / business META_MINGLABIZ_IG_USER_ID) and never cross-falls-back", () => {
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
    // Both lanes have the required IDs; only the consumer lane has an IG id.
    Deno.env.set("META_AD_ACCOUNT_ID", "act_consumer");
    Deno.env.set("META_PAGE_ID", "page_consumer");
    Deno.env.set("META_IG_USER_ID", IG);
    Deno.env.set("META_MINGLABIZ_AD_ACCOUNT_ID", "act_biz");
    Deno.env.set("META_MINGLABIZ_PAGE_ID", "page_biz");
    Deno.env.delete("META_MINGLABIZ_IG_USER_ID"); // business IG NOT configured yet

    const consumer = resolveMetaEnvConfig("consumer");
    assertEquals(consumer.igUserId, IG);

    // Business lane with NO IG env ⇒ null (Facebook-only), NOT the consumer's IG.
    const business = resolveMetaEnvConfig("business");
    assertEquals(business.igUserId, null);

    // Now give the business lane its OWN distinct IG id — it must resolve that,
    // never the consumer's (lane-correctness, QA P2-3).
    const BIZ_IG = "17999999999999999";
    Deno.env.set("META_MINGLABIZ_IG_USER_ID", BIZ_IG);
    const businessWithIg = resolveMetaEnvConfig("business");
    assertEquals(businessWithIg.igUserId, BIZ_IG);
    // ...and the consumer lane is unchanged (still the consumer IG).
    assertEquals(resolveMetaEnvConfig("consumer").igUserId, IG);
  } finally {
    restore();
  }
});
