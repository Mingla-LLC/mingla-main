// META-ORCH-1290 (B2 addendum) [venue authoring — one submission] — resolves
// blocker B-2: the listing-page pitch edit must NOT write place_pool via a
// client-side RLS UPDATE. The `update_pitch` pipeline action now owns the write.
//
// Invariant: I-PROPOSED-1290-PITCH-WRITES-VIA-PIPELINE-ACTION —
//   the pitch write is a USER action on the authoring pipeline (requireUser →
//   loadOwnedBrand → loadOwnedVenue), COLUMN-SCOPED to the pitch only, and the
//   apply-vs-stage split is decided SERVER-SIDE via placeWriteMode. It writes NO
//   serving/scoring column (is_servable / ai_signal_scores / etc.).
//
// These tests drive the REAL handler + the REAL ownership helper with a fake
// supabase client and assert the EXACT place_pool update payload KEY-SET. They
// MUST FAIL when the fix is reverted:
//   * B2a — apply mode writes {generative_summary} ONLY; if the handler is
//     reverted to write a serving column (or the whole row) the key-set fails.
//   * B2b — stage mode writes {business_authoring_inputs} ONLY (tier1.description
//     = the pitch), NEVER a serving column.
//   * B2c — empty pitch: apply → NULL, stage → "".
//   * B2d — ownership rejection: loadOwnedVenue 403s a foreign-brand venue.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { handleUpdatePitch, loadOwnedVenue } from "../index.ts";

// ── fake supabase client (mirrors orch_1263_stage_only_claim.test.ts) ─────────

interface CapturedWrite {
  table: string;
  op: "update" | "upsert" | "insert";
  payload: unknown;
}

function makeFakeClient(config: {
  rows?: Record<string, Record<string, unknown> | null>;
}): {
  client: { from: (table: string) => unknown };
  writes: CapturedWrite[];
} {
  const writes: CapturedWrite[] = [];
  const rows = config.rows ?? {};

  function makeQuery(table: string) {
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
      maybeSingle() {
        return Promise.resolve({ data: rows[table] ?? null, error: null });
      },
      single() {
        return Promise.resolve({ data: rows[table] ?? null, error: null });
      },
      update(payload: unknown) {
        writes.push({ table, op: "update", payload });
        return q;
      },
      insert(payload: unknown) {
        writes.push({ table, op: "insert", payload });
        return q;
      },
      upsert(payload: unknown, _opts?: unknown) {
        writes.push({ table, op: "upsert", payload });
        return q;
      },
    };
    return q;
  }

  return {
    client: { from: (table: string) => makeQuery(table) },
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

function venue(overrides: Record<string, unknown> = {}): Loose {
  return {
    id: "5b000000-0000-4000-8000-000000000002",
    brand_id: BRAND.id,
    place_pool_id: PLACE_ID,
    google_place_id: "gp-lantern",
    venue_category: "restaurant",
    name: "The Lantern Room",
    cover_media_url: null,
    cover_media_type: null,
    claim_status: "pending_review",
    ...overrides,
  };
}

function placeUpdates(writes: CapturedWrite[]): Record<string, unknown>[] {
  return writes
    .filter((w) => w.table === "place_pool" && w.op === "update")
    .map((w) => w.payload as Record<string, unknown>);
}

const SERVING_OR_SCORING = [
  "is_servable",
  "ai_signal_scores",
  "bouncer_reason",
  "stored_photo_urls",
  "opening_hours",
  "price_level",
  "photo_analysis",
  "claimed_by",
  "is_claimed",
];

// ── B2a — apply (verified venue) writes {generative_summary} ONLY ─────────────
Deno.test("B2a: update_pitch on a VERIFIED venue writes place_pool.generative_summary ONLY (column-scoped)", async () => {
  const { client, writes } = makeFakeClient({
    rows: { place_pool: { business_author_brand_id: null, business_authoring_inputs: {} } },
  });
  const res = await handleUpdatePitch(client as Loose, BRAND, venue({ claim_status: "verified" }), {
    action: "update_pitch",
    brand_id: BRAND.id,
    venue_id: venue().id,
    place_pool_id: PLACE_ID,
    pitch: "  A candlelit natural-wine bar with a long list and moody corners.  ",
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.action, "update_pitch");
  assertEquals(body.mode, "apply");

  const updates = placeUpdates(writes);
  assertEquals(updates.length, 1, "exactly ONE place_pool update");
  const payload = updates[0];
  // EXACT key-set — apply mode writes the live pitch column and NOTHING else.
  assertEquals(Object.keys(payload), ["generative_summary"]);
  assertEquals(
    payload.generative_summary,
    "A candlelit natural-wine bar with a long list and moody corners.",
  );
  for (const banned of [...SERVING_OR_SCORING, "business_authoring_inputs"]) {
    assert(!(banned in payload), `${banned} must NOT be written by update_pitch`);
  }
});

// ── B2b — stage (pending claim of a seeded place) writes ONLY the staged pitch ─
Deno.test("B2b: update_pitch on a PENDING CLAIM (author-null place) stages tier1.description ONLY — no serving column", async () => {
  const { client, writes } = makeFakeClient({
    rows: {
      place_pool: {
        business_author_brand_id: null, // seeded place → placeWriteMode = stage
        business_authoring_inputs: {
          tier1: { name: "The Lantern Room", description: "old pitch" },
          tier2: { website: "https://lantern.example", price_tiers: ["comfy"] },
          selected_place_pool_id: PLACE_ID,
        },
      },
    },
  });
  const res = await handleUpdatePitch(client as Loose, BRAND, venue({ claim_status: "pending_review" }), {
    action: "update_pitch",
    brand_id: BRAND.id,
    venue_id: venue().id,
    place_pool_id: PLACE_ID,
    pitch: "A moody wine bar with candlelit corners and a long natural list.",
  });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).mode, "stage");

  const updates = placeUpdates(writes);
  assertEquals(updates.length, 1);
  const payload = updates[0];
  // EXACT key-set — stage mode writes ONLY the staging column.
  assertEquals(Object.keys(payload), ["business_authoring_inputs"]);
  // generative_summary (the serving pitch column) is NEVER written pre-approve.
  assert(!("generative_summary" in payload), "generative_summary is approve-owned on the claim path");
  for (const banned of SERVING_OR_SCORING) {
    assert(!(banned in payload), `${banned} must NOT be staged pre-approve`);
  }
  const inputs = payload.business_authoring_inputs as Record<string, unknown>;
  const tier1 = inputs.tier1 as Record<string, unknown>;
  assertEquals(tier1.description, "A moody wine bar with candlelit corners and a long natural list.");
  // Existing staging survives the merge (never clobbered).
  assertEquals(tier1.name, "The Lantern Room");
  assertEquals((inputs.tier2 as Record<string, unknown>).website, "https://lantern.example");
  assertEquals(inputs.selected_place_pool_id, PLACE_ID);
});

// ── B2c — empty pitch: apply → NULL, stage → "" (Leg B semantics preserved) ───
Deno.test("B2c: empty pitch — apply writes generative_summary=NULL; stage writes tier1.description=''", async () => {
  const apply = makeFakeClient({
    rows: { place_pool: { business_author_brand_id: null, business_authoring_inputs: {} } },
  });
  await handleUpdatePitch(apply.client as Loose, BRAND, venue({ claim_status: "verified" }), {
    action: "update_pitch",
    brand_id: BRAND.id,
    venue_id: venue().id,
    place_pool_id: PLACE_ID,
    pitch: "   ",
  });
  const applyPayload = placeUpdates(apply.writes)[0];
  assertEquals(Object.keys(applyPayload), ["generative_summary"]);
  assertEquals(applyPayload.generative_summary, null);

  const stage = makeFakeClient({
    rows: { place_pool: { business_author_brand_id: null, business_authoring_inputs: { tier1: {} } } },
  });
  await handleUpdatePitch(stage.client as Loose, BRAND, venue({ claim_status: "pending_review" }), {
    action: "update_pitch",
    brand_id: BRAND.id,
    venue_id: venue().id,
    place_pool_id: PLACE_ID,
    pitch: "",
  });
  const stagePayload = placeUpdates(stage.writes)[0];
  const tier1 = (stagePayload.business_authoring_inputs as Record<string, unknown>).tier1 as Record<string, unknown>;
  assertEquals(tier1.description, "");
});

// ── B2d — create-owned (business-authored, still pending) → apply mode ────────
Deno.test("B2d: update_pitch on a create-owned (author-brand) pending row uses APPLY mode (generative_summary)", async () => {
  const { client, writes } = makeFakeClient({
    rows: {
      place_pool: { business_author_brand_id: BRAND.id, business_authoring_inputs: {} },
    },
  });
  const res = await handleUpdatePitch(client as Loose, BRAND, venue({ claim_status: "none" }), {
    action: "update_pitch",
    brand_id: BRAND.id,
    venue_id: venue().id,
    place_pool_id: PLACE_ID,
    pitch: "A neighbourhood listening bar with a rotating vinyl program.",
  });
  assertEquals((await res.json()).mode, "apply");
  const payload = placeUpdates(writes)[0];
  assertEquals(Object.keys(payload), ["generative_summary"]);
});

// ── B2e — ownership rejection: loadOwnedVenue 403s a foreign-brand venue ──────
Deno.test("B2e: loadOwnedVenue rejects a venue whose brand_id != the authed brand (403), accepts the owned one", async () => {
  // Non-owner: the venue_listings row belongs to a DIFFERENT brand.
  const foreign = makeFakeClient({
    rows: { venue_listings: { ...venue(), brand_id: "ffffffff-0000-4000-8000-00000000ffff" } },
  });
  const rejected = await loadOwnedVenue(foreign.client as Loose, venue().id, BRAND);
  assert(rejected instanceof Response, "a foreign-brand venue must return a Response, not a row");
  assertEquals((rejected as Response).status, 403);

  // Owner: same brand_id → returns the venue row (not a Response).
  const owned = makeFakeClient({ rows: { venue_listings: venue() } });
  const ok = await loadOwnedVenue(owned.client as Loose, venue().id, BRAND);
  assert(!(ok instanceof Response), "the owned venue must return the row");
  assertEquals((ok as unknown as { id: string }).id, venue().id);
});
