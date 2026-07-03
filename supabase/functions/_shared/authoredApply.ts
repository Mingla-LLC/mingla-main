// ─────────────────────────────────────────────────────────────────────────────
// authoredApply.ts — ORCH-1263 [claim-adoption] §A4 (D-A approve-time application)
//
// ONE owner for the approve-time authored patch + the price/facet vocabulary.
// A pre-approval CLAIM stages everything (business_* columns + venue row) and
// NEVER touches the live place's serving columns
// (I-PROPOSED-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE). At admin approve,
// admin-review-venue-claim builds ONE patch from authored truth — the venue row
// (cover), venue-keyed brand_hours, business_authoring_inputs, and
// business_gallery_urls (the META-ORCH-1255 one-owner reads) — applies it to
// place_pool, and archives every pre-application value under
// raw_google_data.business_claim_diff.archived_google (FIRST ARCHIVE WINS — it
// holds the Google original; a re-approve never clobbers it).
//
// PRICE_TIER_* / priceTiersFromTier2 / priceLevelFromTiers / FACET_COLUMNS
// moved here VERBATIM from run-business-place-authoring-pipeline/index.ts
// (:18–42, :423–446) so the pipeline and the approve application can never
// drift (one owner, ORCH-1263 §A4). The pipeline re-imports them.
// ─────────────────────────────────────────────────────────────────────────────

import {
  type BusinessHourRow,
  type GoogleOpeningHours,
  normalizeBusinessHoursForPool,
} from "./businessHoursToGoogle.ts";

// The 23 adoptable facet columns (moved verbatim from the pipeline fn :18–42).
export const FACET_COLUMNS = new Set([
  "serves_brunch",
  "serves_lunch",
  "serves_dinner",
  "serves_breakfast",
  "serves_beer",
  "serves_wine",
  "serves_cocktails",
  "serves_coffee",
  "serves_dessert",
  "serves_vegetarian_food",
  "outdoor_seating",
  "live_music",
  "good_for_groups",
  "good_for_children",
  "good_for_watching_sports",
  "allows_dogs",
  "has_restroom",
  "reservable",
  "menu_for_children",
  "dine_in",
  "takeout",
  "delivery",
  "curbside_pickup",
]);

// WS6: map the Mingla price tiers (chill/comfy/bougie/lavish — the consumer deck
// taxonomy) to Google price levels. The deck DISPLAYS price_level, so we persist
// the highest selected tier's level alongside the price_tiers array.
// (Moved verbatim from the pipeline fn :423–446.)
export const PRICE_TIER_ORDER = ["chill", "comfy", "bougie", "lavish"] as const;
export const PRICE_TIER_TO_GOOGLE_LEVEL: Record<string, string> = {
  chill: "PRICE_LEVEL_INEXPENSIVE",
  comfy: "PRICE_LEVEL_MODERATE",
  bougie: "PRICE_LEVEL_EXPENSIVE",
  lavish: "PRICE_LEVEL_VERY_EXPENSIVE",
};
export function priceTiersFromTier2(tier2: Record<string, unknown>): string[] {
  const raw = (tier2 as { price_tiers?: unknown }).price_tiers;
  return Array.isArray(raw)
    ? raw.filter(
        (t): t is string =>
          typeof t === "string" && PRICE_TIER_TO_GOOGLE_LEVEL[t] !== undefined,
      )
    : [];
}
export function priceLevelFromTiers(tiers: string[]): string | null {
  let best = -1;
  for (const t of tiers) {
    const i = PRICE_TIER_ORDER.indexOf(t as (typeof PRICE_TIER_ORDER)[number]);
    if (i > best) best = i;
  }
  return best >= 0 ? PRICE_TIER_TO_GOOGLE_LEVEL[PRICE_TIER_ORDER[best]] : null;
}

/** venue-keyed brand_hours row as read from the DB (time comes back "HH:MM:SS";
 *  businessHoursToGoogle.parseHm accepts that shape). */
export interface BrandHoursDbRow {
  weekday: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
}

function cleanStringArray(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export interface AuthoredApplyInput {
  /** Current place_pool row (pre-application — supplies archive values + inputs). */
  place: Record<string, unknown>;
  /** Venue row cover truth (META-ORCH-1255(C) D-C: the venue row owns the cover). */
  venue: { cover_media_url: string | null; cover_media_type: string | null };
  /** Venue-keyed brand_hours rows (0 rows → opening_hours omitted). */
  brandHours: BrandHoursDbRow[];
  /** The venue's brand account_id — becomes place_pool.claimed_by at approve. */
  ownerUserId: string;
}

/**
 * ORCH-1263 §A4 — the ONE approve-time place_pool patch, built pure from
 * authored truth. Idempotent: a re-approve re-applies current authored truth;
 * the archive extends first-archive-wins and is omitted entirely when no new
 * key needs archiving.
 *
 * Keys (each omitted when its authored source is absent — never blank a live
 * value with nothing):
 *   opening_hours        ← brand_hours via normalizeBusinessHoursForPool
 *   stored_photo_urls    ← dedup([venue.cover_media_url?, ...business_gallery_urls])
 *   generative_summary   ← confirmed_ai_outputs.sales_bio → tier1.description(≥20) → omit
 *   price_tiers/price_level ← inputs.tier2.price_tiers via the tier→level map
 *   <facet columns>      ← confirmed_ai_outputs.facets ∩ FACET_COLUMNS
 *   website              ← inputs.tier2.website (non-empty)
 *   is_claimed/claimed_by  (ownership lands HERE, at approve — never pre-approve)
 *   raw_google_data      ← business_claim_diff.archived_google extended with the
 *                          PRE-application value of every key this patch
 *                          overwrites (first archive wins).
 */
export function buildAuthoredApplyPatch(input: AuthoredApplyInput): Record<string, unknown> {
  const { place, venue, brandHours, ownerUserId } = input;
  const patch: Record<string, unknown> = {};

  // ── opening_hours (authored weekly hours → canonical Google {periods}) ────
  if (brandHours.length > 0) {
    const rows: BusinessHourRow[] = brandHours.map((h) => ({
      weekday: h.weekday,
      isClosed: h.is_closed,
      openTime: h.open_time,
      closeTime: h.close_time,
    }));
    // The converter already emits overnight close.day = +1 (businessHoursToGoogle
    // :140–152), so a claimed late-night venue round-trips losslessly (D-D).
    const normalized: GoogleOpeningHours | null = normalizeBusinessHoursForPool(rows);
    if (normalized !== null) patch.opening_hours = normalized;
  }

  // ── stored_photo_urls (cover + authored gallery — same merge family as
  //    storedPhotosForDeck; I-PROPOSED-1263-GALLERY-NEVER-WIPED-BY-HERO) ──────
  const gallery = cleanStringArray(place.business_gallery_urls);
  const cover = typeof venue.cover_media_url === "string" && venue.cover_media_url.length > 0
    ? venue.cover_media_url
    : null;
  const storedUnion = Array.from(new Set([...(cover ? [cover] : []), ...gallery]));
  if (storedUnion.length > 0) patch.stored_photo_urls = storedUnion;

  // ── generative_summary ────────────────────────────────────────────────────
  const inputs = asRecord(place.business_authoring_inputs);
  const confirmed = asRecord(inputs.confirmed_ai_outputs);
  const tier1 = asRecord(inputs.tier1);
  const tier2 = asRecord(inputs.tier2);
  const salesBio = typeof confirmed.sales_bio === "string" ? confirmed.sales_bio.trim() : "";
  const pitch = typeof tier1.description === "string" ? tier1.description.trim() : "";
  if (salesBio.length > 0) {
    patch.generative_summary = salesBio;
  } else if (pitch.length >= 20) {
    // Admin may approve pre-confirm — the operator's c5 pitch stands in.
    patch.generative_summary = pitch;
  }
  // else: omit — never blank a live summary.

  // ── price ─────────────────────────────────────────────────────────────────
  const tiers = priceTiersFromTier2(tier2);
  if (tiers.length > 0) {
    patch.price_tiers = tiers;
    const level = priceLevelFromTiers(tiers);
    if (level !== null) patch.price_level = level;
  }

  // ── facets (confirmed only) ───────────────────────────────────────────────
  const confirmedFacets = asRecord(confirmed.facets);
  for (const [key, value] of Object.entries(confirmedFacets)) {
    if (FACET_COLUMNS.has(key) && (typeof value === "boolean" || value === null)) {
      patch[key] = value;
    }
  }

  // ── website ───────────────────────────────────────────────────────────────
  const website = typeof tier2.website === "string" ? tier2.website.trim() : "";
  if (website.length > 0) patch.website = website;

  // ── ownership lands at approve (D-A) — never pre-approve ─────────────────
  patch.is_claimed = true;
  patch.claimed_by = ownerUserId;

  // ── archive: first archive wins (holds the Google original) ──────────────
  // Every key the patch overwrites gets its PRE-application value recorded
  // under raw_google_data.business_claim_diff.archived_google — merged
  // non-destructively; an existing archived key is NEVER overwritten. Closes
  // the "no archive, no restore path" gap (inventory §3.2) and powers the
  // Raleigh revert (SPEC §13).
  const overwrittenKeys = Object.keys(patch).filter(
    (k) => k !== "is_claimed" && k !== "claimed_by" && k !== "raw_google_data",
  );
  const existingRaw = asRecord(place.raw_google_data);
  const existingDiff = asRecord(existingRaw.business_claim_diff);
  const existingArchive = asRecord(existingDiff.archived_google);
  const additions: Record<string, unknown> = {};
  for (const key of overwrittenKeys) {
    if (!(key in existingArchive)) {
      additions[key] = key in place ? (place[key] ?? null) : null;
    }
  }
  if (Object.keys(additions).length > 0) {
    patch.raw_google_data = {
      ...existingRaw,
      business_claim_diff: {
        ...existingDiff,
        archived_google: { ...additions, ...existingArchive },
      },
    };
  }
  // No new keys → raw_google_data omitted entirely (idempotent re-approve
  // leaves the first archive byte-identical).

  return patch;
}
