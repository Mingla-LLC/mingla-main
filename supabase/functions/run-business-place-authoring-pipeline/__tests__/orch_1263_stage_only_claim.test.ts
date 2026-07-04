// ORCH-1263 [claim-adoption] Leg C — T-A1 / T-A3 / T-A4 / T-A5 / T-A6 / T-A7.
// Invariants: I-PROPOSED-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE +
//             I-PROPOSED-1263-GALLERY-NEVER-WIPED-BY-HERO.
//
// These tests assert the EXACT place_pool update payload KEY-SETS of the
// stage-only pre-approval write model (SPEC §A3.1–§A3.4) by driving the real
// handlers with a fake supabase client. They MUST FAIL when the D-A/D-E change
// is reverted:
//   * restore the tier-1 opening_hours/claimed_by/is_claimed writes → T-A1's
//     exact key-set assertion fails;
//   * restore the one-element `stored_photo_urls = [mediaUrl]` hero wipe →
//     T-A3 (stage key-set) and T-A4 (⊇-gallery law) fail;
//   * restore the confirm-time generative_summary/price/facets/is_servable
//     writes on a pending claim → T-A5's key-set fails;
//   * restore the tier-2 website/is_servable writes on a pending claim →
//     T-A6's key-set fails;
//   * flip placeWriteMode's arms → T-A7 matrix fails.
// (T-A2 — create-new unchanged — is the EXISTING pinned pipeline_behavioral /
//  stage_contract suites staying green, run in the same directory pass.)

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  handleConfirmAiOutputs,
  handleSyncHeroMedia,
  handleTier1,
  handleTier2,
  nextStoredPhotosForHero,
  placeWriteMode,
} from "../index.ts";

// ── fake supabase client ─────────────────────────────────────────────────────

interface CapturedWrite {
  table: string;
  op: "update" | "upsert" | "insert";
  payload: unknown;
}

function makeFakeClient(config: {
  rows?: Record<string, Record<string, unknown> | null>;
  lists?: Record<string, unknown[]>;
}): {
  client: {
    from: (table: string) => unknown;
    functions: { invoke: (name: string, opts: unknown) => Promise<unknown> };
  };
  writes: CapturedWrite[];
} {
  const writes: CapturedWrite[] = [];
  const rows = config.rows ?? {};
  const lists = config.lists ?? {};

  function makeQuery(table: string) {
    let op: "select" | "update" | "upsert" | "insert" = "select";
    const q = {
      select(_cols?: string) {
        return q;
      },
      eq(_k: string, _v: unknown) {
        return q;
      },
      is(_k: string, _v: unknown) {
        return q;
      },
      order(_k: string, _o?: unknown) {
        return q;
      },
      maybeSingle() {
        return Promise.resolve({ data: rows[table] ?? null, error: null });
      },
      single() {
        return Promise.resolve({ data: rows[table] ?? null, error: null });
      },
      update(payload: unknown) {
        op = "update";
        writes.push({ table, op: "update", payload });
        return q;
      },
      insert(payload: unknown) {
        op = "insert";
        writes.push({ table, op: "insert", payload });
        return q;
      },
      upsert(payload: unknown, _opts?: unknown) {
        op = "upsert";
        writes.push({ table, op: "upsert", payload });
        return q;
      },
      // deno-lint-ignore no-explicit-any
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown): any {
        const value = op === "select"
          ? { data: lists[table] ?? null, error: null }
          : { data: null, error: null };
        return Promise.resolve(value).then(resolve, reject);
      },
    };
    return q;
  }

  return {
    client: {
      from: (table: string) => makeQuery(table),
      functions: {
        invoke: (_name: string, _opts: unknown) =>
          Promise.resolve({ data: {}, error: null }),
      },
    },
    writes,
  };
}

const PLACE_ID = "3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0";

// deno-lint-ignore no-explicit-any
type Loose = any;

const BRAND: Loose = {
  id: "9a000000-0000-4000-8000-000000000001",
  account_id: "7a000000-0000-4000-8000-000000000009",
  name: "Lantern Brand",
  description: null,
  place_pool_id: null,
  google_place_id: null,
  venue_category: null,
  cover_media_url: null,
  cover_media_type: null,
};

function pendingVenue(): Loose {
  return {
    id: "5b000000-0000-4000-8000-000000000002",
    brand_id: BRAND.id,
    place_pool_id: PLACE_ID,
    google_place_id: "gp-lantern",
    venue_category: "restaurant",
    name: "The Lantern Room",
    cover_media_url: "https://cdn/cover.jpg",
    cover_media_type: "image",
    claim_status: "pending_review",
  };
}

function placeUpdates(writes: CapturedWrite[]): Record<string, unknown>[] {
  return writes
    .filter((w) => w.table === "place_pool" && w.op === "update")
    .map((w) => w.payload as Record<string, unknown>);
}

// ── T-A7 — placeWriteMode matrix (4 combos → apply/stage/apply/apply) ───────
Deno.test("T-A7: placeWriteMode — verified/null=apply, pending/null=stage, verified/brand=apply, pending/brand=apply", () => {
  assertEquals(placeWriteMode("verified", null), "apply");
  assertEquals(placeWriteMode("pending_review", null), "stage");
  assertEquals(placeWriteMode("verified", BRAND.id), "apply");
  assertEquals(placeWriteMode("pending_review", BRAND.id), "apply");
  // Edges: undefined author / missing status behave as the pre-approval claim.
  assertEquals(placeWriteMode("pending_review", undefined), "stage");
  assertEquals(placeWriteMode(null, null), "stage");
});

// ── T-A1 — tier-1 claim stage payload (EXACT §A3.1 key-set) ─────────────────
Deno.test("T-A1: tier-1 claim (pending venue, author-null place) stages EXACTLY §A3.1 — no opening_hours/claimed_by/is_claimed", async () => {
  const { client, writes } = makeFakeClient({
    rows: {
      place_pool: {
        id: PLACE_ID,
        google_place_id: "gp-lantern",
        business_author_brand_id: null,
      },
    },
  });
  const draft = {
    name: "The Lantern Room",
    website: "https://lantern.example",
    priceTiers: ["comfy"],
    adoptedGalleryUrls: ["https://cdn/g1.jpg", "https://cdn/g2.jpg"],
    adoption: {
      source: "place_pool" as const,
      adoptedAt: "2026-07-02T00:00:00.000Z",
      summarySource: "generative" as const,
      wantsReservations: false,
    },
    hours: [{ weekday: 4, isClosed: false, openTime: "22:00", closeTime: "02:00" }],
  };
  const res = await handleTier1(client as Loose, BRAND.account_id, BRAND, pendingVenue(), {
    action: "upsert_tier1_place",
    brand_id: BRAND.id,
    venue_id: pendingVenue().id,
    selected_place_pool_id: PLACE_ID,
    draft,
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.claim_path, "existing");

  const updates = placeUpdates(writes);
  assertEquals(updates.length, 1, "exactly ONE place_pool update at tier-1");
  const payload = updates[0];
  // EXACT key-set per §A3.1 (business_gallery_urls included — adopted gallery non-empty).
  assertEquals(Object.keys(payload).sort(), [
    "business_authoring_inputs",
    "business_authoring_status",
    "business_gallery_urls",
    "business_hero_video_present",
  ]);
  // The three killed live-place writes (D-A) must NEVER reappear here.
  assert(!("opening_hours" in payload), "opening_hours overwrite is approve-owned");
  assert(!("claimed_by" in payload), "claimed_by is approve-owned");
  assert(!("is_claimed" in payload), "is_claimed is approve-owned");

  assertEquals(payload.business_authoring_status, "processing");
  assertEquals(payload.business_gallery_urls, ["https://cdn/g1.jpg", "https://cdn/g2.jpg"]);
  const inputs = payload.business_authoring_inputs as Record<string, unknown>;
  assertEquals(Object.keys(inputs).sort(), [
    "adoption",
    "selected_place_pool_id",
    "tier1",
    "tier2",
  ]);
  // c6/c7 staging seed → deck-readiness resume + tier-2 AI.
  assertEquals(inputs.tier2, {
    website: "https://lantern.example",
    price_tiers: ["comfy"],
    vibe_chips: [],
  });
  assertEquals((inputs.adoption as Record<string, unknown>).source, "place_pool");

  // Venue-row stamp + pipeline upsert unchanged.
  assert(writes.some((w) => w.table === "venue_listings" && w.op === "update"));
  assert(writes.some((w) => w.table === "brand_place_pipeline_state" && w.op === "upsert"));
});

// ── T-A4 — nextStoredPhotosForHero pure law (⊇ gallery, never a wipe) ───────
Deno.test("T-A4: nextStoredPhotosForHero ⊇ gallery always; never [hero] with non-empty gallery; [] only when all empty", () => {
  // Prior w/ old hero + gallery + new hero → hero swapped, gallery intact.
  assertEquals(
    nextStoredPhotosForHero(
      ["https://cdn/old-hero.jpg", "https://cdn/g1.jpg", "https://cdn/g2.jpg"],
      ["https://cdn/g1.jpg", "https://cdn/g2.jpg"],
      "https://cdn/new-hero.jpg",
    ),
    ["https://cdn/new-hero.jpg", "https://cdn/g1.jpg", "https://cdn/g2.jpg"],
  );
  // Hero null (clear) → gallery ∪ prior-non-hero, never [].
  assertEquals(
    nextStoredPhotosForHero(
      ["https://cdn/old-hero.jpg", "https://cdn/g1.jpg"],
      ["https://cdn/g1.jpg"],
      null,
    ),
    ["https://cdn/g1.jpg"],
  );
  // Clearing when prior held ONLY the hero → prior kept (never regress to []).
  assertEquals(
    nextStoredPhotosForHero(["https://cdn/only.jpg"], [], null),
    ["https://cdn/only.jpg"],
  );
  // All empty → [] (the only legal empty).
  assertEquals(nextStoredPhotosForHero([], [], null), []);
  // Seeded place (5 google photos, no gallery yet) + hero pick → NEVER [hero]:
  // first prior entry (the de-facto deck hero) is swapped, the rest survive.
  const seeded = ["https://cdn/p1.jpg", "https://cdn/p2.jpg", "https://cdn/p3.jpg"];
  const out = nextStoredPhotosForHero(seeded, [], "https://cdn/hero.jpg");
  assertEquals(out[0], "https://cdn/hero.jpg");
  assert(out.length >= 3, `hero pick shrank the stored set: ${out.join(",")}`);
  // ⊇ gallery law under every combination above.
  const gallery = ["https://cdn/g1.jpg", "https://cdn/g2.jpg"];
  for (
    const hero of ["https://cdn/h.jpg", null] as const
  ) {
    const r = nextStoredPhotosForHero(["https://cdn/x.jpg"], gallery, hero);
    for (const g of gallery) assert(r.includes(g), `gallery member ${g} dropped`);
  }
});

// ── T-A3 — hero sync: stage vs apply ─────────────────────────────────────────
Deno.test("T-A3: sync_hero_media — stage writes {business_hero_video_present} ONLY; apply uses nextStoredPhotosForHero; venue cover always", async () => {
  // STAGE: pending claim of a seeded (author-null) place.
  const stage = makeFakeClient({
    rows: {
      place_pool: {
        business_author_brand_id: null,
        stored_photo_urls: ["https://cdn/p1.jpg", "https://cdn/p2.jpg"],
        business_gallery_urls: [],
      },
    },
  });
  const stageRes = await handleSyncHeroMedia(stage.client as Loose, BRAND, pendingVenue(), {
    action: "sync_hero_media",
    brand_id: BRAND.id,
    venue_id: pendingVenue().id,
    place_pool_id: PLACE_ID,
    cover_media_url: "https://cdn/hero.jpg",
    cover_media_type: "image",
  });
  assertEquals(stageRes.status, 200);
  const stagePayloads = placeUpdates(stage.writes);
  assertEquals(stagePayloads.length, 1);
  assertEquals(Object.keys(stagePayloads[0]), ["business_hero_video_present"]);
  // Venue row cover still written (venue row = hero truth, 1255(C) D-C).
  const stageVenueCover = stage.writes.find(
    (w) => w.table === "venue_listings" && w.op === "update",
  );
  assert(stageVenueCover !== undefined);
  assertEquals(
    (stageVenueCover.payload as Record<string, unknown>).cover_media_url,
    "https://cdn/hero.jpg",
  );

  // APPLY (verified claim): non-destructive hero swap, result ⊇ gallery.
  const verified = { ...pendingVenue(), claim_status: "verified" };
  const apply = makeFakeClient({
    rows: {
      place_pool: {
        business_author_brand_id: null,
        stored_photo_urls: ["https://cdn/old-hero.jpg", "https://cdn/g1.jpg"],
        business_gallery_urls: ["https://cdn/g1.jpg", "https://cdn/g2.jpg"],
      },
    },
  });
  await handleSyncHeroMedia(apply.client as Loose, BRAND, verified, {
    action: "sync_hero_media",
    brand_id: BRAND.id,
    venue_id: verified.id,
    place_pool_id: PLACE_ID,
    cover_media_url: "https://cdn/new-hero.jpg",
    cover_media_type: "image",
  });
  const applyPayloads = placeUpdates(apply.writes);
  assertEquals(applyPayloads.length, 1);
  const applied = applyPayloads[0];
  assertEquals(Object.keys(applied).sort(), [
    "business_hero_video_present",
    "stored_photo_urls",
  ]);
  const stored = applied.stored_photo_urls as string[];
  assertEquals(stored[0], "https://cdn/new-hero.jpg");
  assert(stored.includes("https://cdn/g1.jpg") && stored.includes("https://cdn/g2.jpg"));
  assert(stored.length >= 3, "apply-mode hero pick must never shrink below the gallery");

  // CREATE-NEW (author-brand row, venue still pending) → apply mode too.
  const createNew = makeFakeClient({
    rows: {
      place_pool: {
        business_author_brand_id: BRAND.id,
        stored_photo_urls: [],
        business_gallery_urls: [],
      },
    },
  });
  await handleSyncHeroMedia(createNew.client as Loose, BRAND, pendingVenue(), {
    action: "sync_hero_media",
    brand_id: BRAND.id,
    venue_id: pendingVenue().id,
    place_pool_id: PLACE_ID,
    cover_media_url: "https://cdn/first.jpg",
    cover_media_type: "image",
  });
  const createPayload = placeUpdates(createNew.writes)[0];
  assertEquals((createPayload.stored_photo_urls as string[]), ["https://cdn/first.jpg"]);
});

// ── T-A5 — confirm stage payload (EXACT §A3.3 key-set) ───────────────────────
Deno.test("T-A5: confirm_ai_outputs on a pending claim stages EXACTLY §A3.3 — place summary/price/photos/facets/is_servable untouched", async () => {
  const servablePlace: Record<string, unknown> = {
    id: PLACE_ID,
    google_place_id: "gp-lantern",
    business_author_brand_id: null,
    name: "The Lantern Room",
    lat: 38.9,
    lng: -77.0,
    types: ["restaurant", "food", "point_of_interest"],
    business_status: "OPERATIONAL",
    website: "https://lantern.example",
    opening_hours: { periods: [] },
    photos: [{ ref: "x" }],
    stored_photo_urls: ["https://cdn/p1.jpg"],
    is_servable: true,
    business_authoring_inputs: {},
    business_gallery_urls: [],
    fetched_via: "nearby_search",
    review_count: 100,
    rating: 4.4,
  };
  const { client, writes } = makeFakeClient({ rows: { place_pool: servablePlace } });
  const res = await handleConfirmAiOutputs(client as Loose, BRAND, pendingVenue(), {
    action: "confirm_ai_outputs",
    brand_id: BRAND.id,
    venue_id: pendingVenue().id,
    place_pool_id: PLACE_ID,
    sales_bio: "A moody wine bar with candlelit corners and a long natural list.",
    facets: { serves_dinner: true, bogus_column: true },
    tier2: { website: "https://lantern.example", price_tiers: ["comfy"] },
  });
  assertEquals(res.status, 200);
  const updates = placeUpdates(writes);
  assertEquals(updates.length, 1);
  const payload = updates[0];
  // EXACT stage key-set per §A3.3.
  assertEquals(Object.keys(payload).sort(), [
    "bouncer_reason",
    "bouncer_validated_at",
    "business_authoring_inputs",
    "business_authoring_status",
  ]);
  // Everything killed on the stage path stays killed.
  for (
    const banned of [
      "generative_summary",
      "is_servable",
      "website",
      "price_tiers",
      "price_level",
      "stored_photo_urls",
      "serves_dinner",
    ]
  ) {
    assert(!(banned in payload), `${banned} must not be written pre-approve`);
  }
  // The confirmation itself IS recorded (staging, admin bundle reads it).
  const inputs = payload.business_authoring_inputs as Record<string, unknown>;
  const confirmed = inputs.confirmed_ai_outputs as Record<string, unknown>;
  assert(typeof confirmed.sales_bio === "string" && (confirmed.sales_bio as string).length >= 20);
});

// ── T-A6 — tier-2 stage payload (no is_servable / website keys) ──────────────
Deno.test("T-A6: run_tier2_pipeline on a pending claim (prior servable TRUE) omits is_servable + website", async () => {
  const servablePlace: Record<string, unknown> = {
    id: PLACE_ID,
    google_place_id: "gp-lantern",
    business_author_brand_id: null,
    name: "The Lantern Room",
    address: "12 Vine St",
    city: "Raleigh",
    country: "US",
    primary_type: "wine_bar",
    types: ["bar", "restaurant"],
    business_status: "OPERATIONAL",
    website: null, // no website → scanWebsite(null) → no network
    opening_hours: { periods: [] },
    photos: [{ ref: "x" }],
    stored_photo_urls: ["https://cdn/p1.jpg"],
    is_servable: true,
    business_authoring_inputs: { tier1: { name: "The Lantern Room" } },
    business_gallery_urls: [], // no gallery → no image fetches
    business_recommend_edit_count: 0,
    fetched_via: "nearby_search",
    review_count: 100,
    rating: 4.4,
    generative_summary: "Seeded summary that must survive.",
  };
  const { client, writes } = makeFakeClient({
    rows: { place_pool: servablePlace },
    lists: { signal_definitions: [{ id: "date_night", label: "Date night" }] },
  });

  // Stub the ONE outbound call (Gemini) — everything else is offline.
  Deno.env.set("GEMINI_API_KEY", "test-key-not-real");
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("generativelanguage.googleapis.com")) {
      return Promise.reject(new Error(`unexpected fetch in T-A6: ${url}`));
    }
    const geminiJson = {
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              bio: "An AI bio pending confirmation.",
              facets: { serves_dinner: true },
              photo_analysis: null,
              evaluations: [{
                signal_id: "date_night",
                score_0_to_100: 80,
                inappropriate_for: false,
                reasoning: "candlelit",
              }],
              consistency: null,
            }),
          }],
        },
      }],
    };
    return Promise.resolve(
      new Response(JSON.stringify(geminiJson), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;

  try {
    const res = await handleTier2(client as Loose, BRAND, pendingVenue(), {
      action: "run_tier2_pipeline",
      brand_id: BRAND.id,
      venue_id: pendingVenue().id,
      place_pool_id: PLACE_ID,
      tier2: {},
    });
    assertEquals(res.status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }

  const updates = placeUpdates(writes);
  assertEquals(updates.length, 1);
  const payload = updates[0];
  // EXACT stage key-set per §A3.4 — diagnostics kept, live-place writes omitted.
  // META-ORCH-1290 supersession: `ai_signal_scores` is NO LONGER written at tier-2
  // (submit) — the 16-signal eval moved to the approve path (D-2). [TEST-MOD-APPROVED META-ORCH-1290]
  assertEquals(Object.keys(payload).sort(), [
    "bouncer_reason",
    "bouncer_validated_at",
    "business_authoring_inputs",
    "business_authoring_status",
    "business_recommend_edit_count",
    "photo_analysis",
    "raw_google_data",
  ]);
  assert(!("is_servable" in payload), "prior servable TRUE preserved by omission");
  assert(!("website" in payload), "website is approve-owned on the claim path");
  assert(!("generative_summary" in payload), "tier-2 never publishes the bio (pre-existing law)");
});
