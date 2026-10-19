import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCreativeLibrary } from "../adCreativeLibrary.ts";

const CREATIVE_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN_ID = "44444444-4444-4444-8444-444444444444";
const AD_SET_ID = "55555555-5555-4555-8555-555555555555";

Deno.test("#3697 Creative Library reports usage, rights, fit and worst provider truth", () => {
  const rows = buildCreativeLibrary({
    creatives: [{
      id: CREATIVE_ID,
      name: "Island reel",
      kind: "video",
      status: "active",
      poster_url: "https://media.example/poster.jpg",
      aspect_ratio: 0.5625,
      duration_seconds: 15,
      ai_generated: false,
      brand_id: null,
      // #3040/#3697 — house media is decided by provenance, not a null brand.
      source: "admin_upload",
      // #3040 rework (P1-3) — and by the absence of an owning-brand snapshot.
      source_brand_id: null,
      variants: {
        "4:5": {
          source_url: "https://media.example/portrait.jpg",
          storage_path: "private/path.jpg",
          content_hash: "do-not-return",
        },
      },
      storage_path: "private/master.mov",
      bunny_video_id: "provider-secret-id",
      content_hash: "do-not-return",
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-01T00:00:00.000Z",
    }],
    versions: [{
      id: VERSION_ID,
      plan_id: PLAN_ID,
      version_number: 3,
      canonical_plan: {
        creative_library_id: CREATIVE_ID,
        media_rights: {
          rights_confirmed: true,
          rights_basis: "authorized_by_brand",
          ai_generated: false,
        },
      },
      created_at: "2026-10-02T00:00:00.000Z",
    }],
    plans: [{ id: PLAN_ID, state: "active", owner_kind: "mingla" }],
    campaigns: [{
      id: CAMPAIGN_ID,
      plan_version_id: VERSION_ID,
      platform: "meta",
      status: "ACTIVE",
      created_at: "2026-10-03T00:00:00.000Z",
      updated_at: "2026-10-04T00:00:00.000Z",
    }],
    adSets: [{ id: AD_SET_ID, campaign_id: CAMPAIGN_ID }],
    ads: [{ creative_id: CREATIVE_ID, ad_set_id: AD_SET_ID }],
    providerRefs: [{
      creative_id: CREATIVE_ID,
      platform: "meta",
      lane: "consumer",
      status: "ready",
      external_account_id: "must-not-return",
      external_ref: "must-not-return",
      updated_at: "2026-10-03T00:00:00.000Z",
    }, {
      creative_id: CREATIVE_ID,
      platform: "tiktok",
      lane: "consumer",
      status: "failed",
      retryable: true,
      error: "raw-provider-response-must-not-return",
      updated_at: "2026-10-03T00:00:00.000Z",
    }],
  });

  assertEquals(rows.length, 1);
  assertEquals(rows[0].version_label, "v3");
  assertEquals(rows[0].house_reuse_allowed, true);
  assertEquals(rows[0].rights, {
    state: "confirmed",
    basis: "authorized_by_brand",
    ai_generated: false,
  });
  assertEquals(rows[0].placement_formats, [
    "Portrait feed · 4:5",
    "Reels & stories · 9:16",
  ]);
  assertEquals(rows[0].usage.campaign_count, 1);
  assertEquals(rows[0].usage.active_campaign_count, 1);
  assertEquals(rows[0].processing_summary, "needs_attention");
  assertEquals(rows[0].provider_readiness[1], {
    platform: "tiktok",
    lane: "consumer",
    status: "failed",
    retryable: true,
    last_checked_at: null,
    updated_at: "2026-10-03T00:00:00.000Z",
  });

  const serialized = JSON.stringify(rows[0]);
  for (
    const secret of [
      "provider-secret-id",
      "private/master.mov",
      "private/path.jpg",
      "do-not-return",
      "must-not-return",
      "raw-provider-response-must-not-return",
    ]
  ) {
    assertFalse(serialized.includes(secret), `leaked ${secret}`);
  }
});

Deno.test("#3697 unused Creative Library items remain honest and reusable", () => {
  const [row] = buildCreativeLibrary({
    creatives: [{
      id: CREATIVE_ID,
      name: "Square still",
      kind: "image",
      status: "active",
      source_url: "https://media.example/square.jpg",
      aspect_ratio: 1,
      ai_generated: true,
      brand_id: "66666666-6666-4666-8666-666666666666",
      variants: {},
      created_at: "2026-10-01T00:00:00.000Z",
    }],
    versions: [],
    plans: [],
    campaigns: [],
    adSets: [],
    ads: [],
    providerRefs: [],
  });

  assertEquals(row.source_summary, "Host brand library");
  assertEquals(row.house_reuse_allowed, false);
  assertEquals(row.preview_url, "https://media.example/square.jpg");
  assertEquals(row.placement_formats, ["Square feed · 1:1"]);
  assertEquals(row.version_label, "Not used in a plan");
  assertEquals(row.rights.state, "not_recorded");
  assertEquals(row.processing_summary, "not_started");
  assertEquals(row.usage, {
    plan_count: 0,
    campaign_count: 0,
    active_campaign_count: 0,
    last_used_at: null,
    plan_states: [],
  });
});
