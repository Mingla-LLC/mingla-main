// META-ORCH-1009 Sub-E — business-app supply-side feeder.
//
// Gemini structured JSON contract:
// https://ai.google.dev/gemini-api/docs/models/gemini#gemini-2.5-flash
// https://ai.google.dev/gemini-api/docs/structured-output

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { bounce } from "../_shared/bouncer.ts";
// ORCH-1068 [business-authored venues render on deck]: normalize the wizard hours
// ARRAY [{weekday(0=Mon),isClosed,openTime,closeTime}] → canonical Google v1
// {periods,…} object on the place_pool write so the consumer deck's open-hours
// filter (which reads {periods}) includes the venue. day = (weekday+1)%7.
// I-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE: since ORCH-1263 the ONLY legal
// call site for this converter in THIS function is the create-new place INSERT
// (that row is never served pre-approve). The claim path stages hours in the
// venue-keyed brand_hours rows; they reach place_pool.opening_hours at admin
// approve via _shared/authoredApply.ts (gate: orch-1263-claim-stage-only-preapprove.mjs).
import { normalizeBusinessHoursForPool } from "../_shared/businessHoursToGoogle.ts";
// ORCH-1263 §A4: the price/facet vocabulary + the approve-time patch builder
// moved to _shared/authoredApply.ts (ONE owner — the pipeline and the admin
// approve application can never drift). Re-exported below for the pinned
// behavioral suite which imports them from this module.
import {
  FACET_COLUMNS,
  priceLevelFromTiers,
  priceTiersFromTier2,
} from "../_shared/authoredApply.ts";
export { priceLevelFromTiers, priceTiersFromTier2 };

const GEMINI_MODEL = "gemini-2.5-flash";
const PROMPT_VERSION = "v4";

// META-ORCH-1009 Sub-E: FORCE Gemini's output shape with a responseSchema
// (structured output) instead of relying on the model to volunteer the right
// JSON keys. The earlier free-form `responseMimeType: application/json` let
// Gemini return a structure WITHOUT an `evaluations` array -> "gemini_missing
// _evaluations". A schema guarantees the array (and the per-signal object shape)
// is always present. Schema vocabulary per the Gemini structured-output docs:
//   https://ai.google.dev/gemini-api/docs/structured-output
const GEMINI_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    bio: { type: "string" },
    facets: {
      type: "object",
      properties: Object.fromEntries(
        [...FACET_COLUMNS].map((k) => [k, { type: "boolean", nullable: true }]),
      ),
    },
    photo_analysis: {
      type: "object",
      nullable: true,
      properties: {
        lighting: { type: "string", nullable: true },
        ambience: { type: "string", nullable: true },
        composition_score_0_to_100: { type: "integer", nullable: true },
        reasoning: { type: "string", nullable: true },
      },
    },
    evaluations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          signal_id: { type: "string" },
          score_0_to_100: { type: "integer" },
          inappropriate_for: { type: "boolean" },
          reasoning: { type: "string" },
        },
        required: ["signal_id", "score_0_to_100", "inappropriate_for", "reasoning"],
      },
    },
    // WS6: consistency check (operator claims vs website/photos) — informational.
    consistency: {
      type: "object",
      nullable: true,
      properties: {
        verdict: { type: "string", nullable: true },
        confidence_0_to_100: { type: "integer", nullable: true },
        summary: { type: "string", nullable: true },
        flags: { type: "array", nullable: true, items: { type: "string" } },
      },
    },
  },
  required: ["bio", "facets", "evaluations"],
};

type Action =
  | "upsert_tier1_place"
  | "run_tier2_pipeline"
  | "regenerate_sales_bio"
  | "confirm_ai_outputs"
  | "refresh_deck_readiness"
  | "get_authoring_context"
  | "sync_hero_media"
  | "sync_gallery";
type VenueCategory = "restaurant" | "play" | "creative_and_arts";

// META-ORCH-1009 Sub-E: a self-listed/claimed venue must upload 5–20 gallery
// photos (in addition to the hero) before it can go live. The min is a hard
// go-live gate; the max bounds storage + the AI vision set.
const GALLERY_MIN = 5;
const GALLERY_MAX = 20;
// WS7: "Recommend me" allowed runs = initial + 3 changes. Reset on admin reject.
const RECOMMEND_EDIT_CAP = 4;

interface Tier1Draft {
  name?: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  city?: string | null;
  countryCode?: string | null;
  venueCategory?: VenueCategory | null;
  coverMediaUrl?: string | null;
  coverMediaType?: "image" | "video" | "gif" | null;
  website?: string | null;
  openingHours?: unknown | null;
  hours?: unknown | null;
  photoUrls?: string[];
  tagline?: string | null;
  description?: string | null;
  priceTier?: string | null;
  vibeAnswers?: Record<string, unknown> | null;
  // ORCH-1263 §B1/§A3.1 — claim-adoption draft additions. website (above) +
  // priceTiers seed business_authoring_inputs.tier2 at tier-1 so the
  // deck-readiness resume + tier-2 AI start from the adopted values;
  // adoptedGalleryUrls (kept+added, in c3 order) stages business_gallery_urls;
  // adoption carries provenance (R-5).
  priceTiers?: string[];
  adoptedGalleryUrls?: string[];
  adoption?: {
    source: "place_pool";
    adoptedAt: string;
    summarySource: "generative" | "editorial" | null;
    wantsReservations: boolean;
  } | null;
}

interface RequestBody {
  action?: Action;
  brand_id?: string;
  // META-ORCH-1255 Leg A: the pipeline is keyed one-row-per-VENUE. venue_id is
  // REQUIRED on every action; the venue must belong to the authed brand.
  venue_id?: string;
  selected_place_pool_id?: string | null;
  place_pool_id?: string | null;
  draft?: Tier1Draft;
  tier2?: Record<string, unknown>;
  sales_bio?: string;
  facets?: Record<string, boolean | null>;
  cover_media_url?: string | null;
  cover_media_type?: "image" | "video" | "gif" | null;
  gallery_urls?: string[];
}

interface OwnedBrand {
  id: string;
  account_id: string;
  name: string | null;
  description: string | null;
  place_pool_id: string | null;
  google_place_id: string | null;
  venue_category: VenueCategory | null;
  cover_media_url: string | null;
  cover_media_type: string | null;
}

// META-ORCH-1255 Leg A: the venue row the pipeline run is scoped to. The venue
// row (NOT brands.place_pool_id) is the place-pointer truth from here on.
interface OwnedVenue {
  id: string;
  brand_id: string;
  place_pool_id: string | null;
  google_place_id: string | null;
  venue_category: VenueCategory | null;
  name: string | null;
  cover_media_url: string | null;
  cover_media_type: string | null;
  // ORCH-1263 §A3 plumbing: claim_status feeds placeWriteMode (stage vs apply).
  claim_status: string | null;
}

interface SignalRow {
  id: string;
  label: string | null;
}

interface AiEvaluation {
  signal_id: string;
  score_0_to_100: number;
  inappropriate_for: boolean;
  reasoning: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { kind: "error", code, message });
}

export function isUuid(v: unknown): v is string {
  // ROOT CAUSE of every "brand_id must be a uuid" failure (META-ORCH-1009 Sub-E,
  // 2026-05-31): the original pattern had only FOUR groups (8-4-4-12) and was
  // missing the 4th `[0-9a-f]{4}-` group, so it rejected EVERY valid UUID — e.g.
  // 3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0. A canonical UUID is 8-4-4-4-12 (36
  // chars, five hyphen-separated groups). This is why 0 business_authored places
  // ever got created and why selected_place_pool_id (same isUuid) would also have
  // failed the claim path.
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function categoryTypes(category: VenueCategory | null | undefined): {
  primaryType: string;
  types: string[];
} {
  if (category === "play") {
    return { primaryType: "amusement_center", types: ["amusement_center"] };
  }
  if (category === "creative_and_arts") {
    return { primaryType: "art_gallery", types: ["art_gallery", "point_of_interest"] };
  }
  return { primaryType: "restaurant", types: ["restaurant", "food", "point_of_interest"] };
}

// Exported for the C4 behavioral test (no behavior change; pure function).
export function coachingForReasons(reasons: string[]): Array<{
  code: string;
  title: string;
  body: string;
  fix: string;
}> {
  return reasons.map((reason) => {
    const code = reason.split(":")[0] ?? reason;
    switch (code) {
      case "B3":
        return {
          code,
          title: "Add the missing venue basics",
          body: "We need your venue name and map location before we can recommend you to customers.",
          fix: "edit_address",
        };
      case "B4":
        return {
          code,
          title: "Add your website",
          body: "Commercial venues need an official website so guests can verify the place.",
          fix: "edit_website",
        };
      case "B5":
        return {
          code,
          title: "Use an official domain",
          body: "A social-only link isn't enough. Add the venue's own website so customers can verify you.",
          fix: "edit_website",
        };
      case "B6":
        return {
          code,
          title: "Confirm opening hours",
          body: "We need clear opening hours before we can recommend your venue.",
          fix: "edit_hours",
        };
      case "B8":
        return {
          code,
          title: "Add a hero photo or video",
          body: "Add at least one photo or video so customers can see your space.",
          fix: "edit_cover",
        };
      // SPEC §8.5: B9-B12 are the bouncer codes most likely to block real venues
      // (child-venue, fast-food type, fast-food/coffee chain, casual chain). They
      // are not self-serve fixable, so the one-tap action requests a human review.
      case "B9":
        return {
          code,
          title: "This looks like a sub-location",
          body: "This looks like a sub-location inside another business. If that's wrong, request a review and we'll take a closer look.",
          fix: "request_review",
        };
      case "B10":
        return {
          code,
          title: "This looks like fast food",
          body: "This looks like a fast-food/snack category we don't serve in the deck yet. If that's wrong, request a review.",
          fix: "request_review",
        };
      case "B11":
        return {
          code,
          title: "This looks like a chain",
          body: "This looks like a fast-food or coffee chain. If you're an independent venue, request a review.",
          fix: "request_review",
        };
      case "B12":
        return {
          code,
          title: "This looks like a casual chain",
          body: "This looks like a casual chain. If you're an independent venue, request a review.",
          fix: "request_review",
        };
      case "GALLERY_MIN":
        return {
          code,
          title: "Add more photos",
          body: `Add at least ${GALLERY_MIN} photos of your venue (you can pick several at once) so customers can see what to expect.`,
          fix: "edit_cover",
        };
      case "CONFIRM":
        return {
          code,
          title: "Approve your pitch",
          body: "Review your AI-written pitch and approve it before it goes live to customers.",
          fix: "confirm_ai_outputs",
        };
      default:
        return {
          code,
          title: "One more quick check",
          body: "One more quick check before your venue goes live to customers.",
          fix: "review_pipeline",
        };
    }
  });
}

function fullStageStatus(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    menu_ocr: "not_applicable_or_existing",
    activity_extraction: "not_applicable_or_existing",
    photo_analysis: "pending",
    sales_bio_generation: "pending_confirmation",
    structured_facet_inference: "pending_confirmation",
    signal_pre_evaluation: "pending",
    google_cross_validation: "not_applicable_or_pending",
    bouncer_servability: "pending",
    ...overrides,
  };
}

// Exported for the B7 business-authored-photos behavioral test.
export function placeForBouncer(
  placePoolId: string,
  place: Record<string, unknown>,
  tier2: Record<string, unknown> = {},
) {
  const googlePhotos = (place as { photos?: unknown[] | null }).photos ?? null;
  const storedPhotos = (place as { stored_photo_urls?: string[] | null }).stored_photo_urls ?? null;
  const isBusinessAuthored =
    (place as { fetched_via?: string | null }).fetched_via === "business_authored";
  // META-ORCH-1009 Sub-E: a business-AUTHORED venue isn't on Google, so it has no
  // Google photos and could never clear the B7 "Google photos required" gate —
  // it would be stuck on "Action needed" forever even after uploading its own
  // hero. Operator decision (2026-06-01): the operator's uploaded photo IS the
  // venue's visual, so let stored_photo_urls satisfy the photo gate for
  // business-authored rows. Real Google venues (incl. claim-existing) keep their
  // Google photos and are unaffected.
  const photosForGate =
    Array.isArray(googlePhotos) && googlePhotos.length > 0
      ? googlePhotos
      : isBusinessAuthored && Array.isArray(storedPhotos) && storedPhotos.length > 0
        ? storedPhotos
        : googlePhotos;
  return {
    id: placePoolId,
    name: (place as { name?: string | null }).name ?? null,
    lat: (place as { lat?: number | null }).lat ?? null,
    lng: (place as { lng?: number | null }).lng ?? null,
    types: (place as { types?: string[] | null }).types ?? null,
    business_status: (place as { business_status?: string | null }).business_status ?? null,
    website: (tier2.website as string | undefined) ?? (place as { website?: string | null }).website ?? null,
    opening_hours: (place as { opening_hours?: unknown }).opening_hours ?? null,
    photos: photosForGate,
    stored_photo_urls: storedPhotos,
    // ORCH-1067 — pass provenance through so the canonical bounce() B7-skip
    // predicate (isBusinessAuthored) sees it. The photosForGate swap above is now
    // redundant for the B7 verdict but harmless (kept; produces a passing verdict
    // either way).
    fetched_via: (place as { fetched_via?: string | null }).fetched_via ?? null,
    review_count: (place as { review_count?: number | null }).review_count ?? null,
    rating: (place as { rating?: number | null }).rating ?? null,
  };
}

// Exported for the gallery-gate behavioral test.
export function galleryUrls(place: Record<string, unknown>): string[] {
  const raw = (place as { business_gallery_urls?: unknown }).business_gallery_urls;
  return Array.isArray(raw)
    ? raw.filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];
}

// META-ORCH-1009 Sub-E: business-pipeline go-live blockers BEYOND the shared
// bouncer. The required 5-photo gallery is enforced here (the shared bouncer is
// generic to Google-ingested places and has no gallery concept). Returns a
// GALLERY_MIN reason when the venue has fewer than the required gallery photos.
export function businessGateReasons(place: Record<string, unknown>): string[] {
  const count = galleryUrls(place).length;
  return count < GALLERY_MIN ? [`GALLERY_MIN:${count}`] : [];
}

// META-ORCH-1062 Phase 3 (I-NO-CLAIM-DEMOTION + I-NET-NEW-HOLD): the prior-
// state-preserving is_servable decision for the Tier-2 confirm step. A net-new
// business-authored row enters with is_servable=false and stays false (held off
// the deck until admin approve). A CLAIM of an already-live place (prior true)
// is NEVER demoted by the confirm — preserve the prior true. Pure + exported so
// the regression test exercises the exact rule.
export function nextIsServableForConfirm(
  priorIsServable: boolean | null | undefined,
): boolean {
  return priorIsServable === true;
}

// ORCH-1263 §A3 (D-A) — the pre-approve/post-approve place write boundary.
// "apply" iff the venue's claim is already verified OR the place is a
// create-new business-authored row (it owns its never-served-until-approve
// row); everything else — i.e. a pre-approval CLAIM of a seeded place — is
// "stage": staging columns (business_*) + the venue row only, NEVER a
// serving-read place column and NEVER claimed_by/is_claimed
// (I-PROPOSED-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE). Pure + exported for
// the T-A7 matrix test.
export function placeWriteMode(
  venueClaimStatus: string | null | undefined,
  placeAuthorBrandId: string | null | undefined,
): "apply" | "stage" {
  if (venueClaimStatus === "verified") return "apply";
  if (placeAuthorBrandId !== null && placeAuthorBrandId !== undefined) return "apply";
  return "stage";
}

// ORCH-1263 §A3.2 (D-E) — non-destructive hero semantics for apply mode.
// Replaces the pre-1263 one-element wipe (`stored_photo_urls = [mediaUrl]`).
// previous-hero = the FIRST prior entry not in the gallery (mirror of
// storedPhotosForDeck below): the deck's hero IS the first stored entry that
// isn't a gallery photo, so replacing exactly that one entry is "swap the
// hero, keep everything else". Guarantees (I-PROPOSED-1263-GALLERY-NEVER-
// WIPED-BY-HERO, T-A4): result ⊇ gallery always; never [hero] with a
// non-empty gallery; [] only when prior, gallery AND hero are all empty —
// clearing the hero never empties a non-empty set.
export function nextStoredPhotosForHero(
  prior: string[],
  gallery: string[],
  hero: string | null,
): string[] {
  const cleanPrior = prior.filter((u) => typeof u === "string" && u.length > 0);
  const cleanGallery = gallery.filter((u) => typeof u === "string" && u.length > 0);
  const previousHero =
    cleanPrior.find((u) => !cleanGallery.includes(u) && u !== hero) ?? null;
  const keptPrior = cleanPrior.filter((u) => u !== previousHero);
  const merged = Array.from(
    new Set([...(hero ? [hero] : []), ...cleanGallery, ...keptPrior]),
  );
  if (merged.length === 0 && cleanPrior.length > 0) {
    // Degenerate clear (no gallery, prior held only the hero): keep the prior
    // set rather than regressing a non-empty stored_photo_urls to [].
    return Array.from(new Set(cleanPrior));
  }
  return merged;
}

// WS6: the consumer deck shows photos from stored_photo_urls (NOT the gallery
// column). Mirror hero + gallery into stored_photo_urls so a self-listed venue's
// photos actually render on its deck card. Hero = the first existing stored URL
// (sync_hero_media wrote it); gallery appended, deduped.
export function storedPhotosForDeck(
  place: Record<string, unknown>,
  gallery: string[],
): string[] {
  const existing = Array.isArray((place as { stored_photo_urls?: unknown }).stored_photo_urls)
    ? (place as { stored_photo_urls: unknown[] }).stored_photo_urls.filter(
        (u): u is string => typeof u === "string" && u.length > 0,
      )
    : [];
  const hero = existing.find((u) => !gallery.includes(u));
  return Array.from(new Set([...(hero ? [hero] : []), ...gallery]));
}

async function requireUser(req: Request): Promise<
  | { userId: string; authHeader: string; serviceClient: SupabaseClient }
  | Response
> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return errorResponse(401, "UNAUTHORIZED", "Missing authorization");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return errorResponse(500, "INTERNAL", "Supabase config missing");
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(tokenMatch[1]);
  if (userErr || !userData?.user) {
    return errorResponse(401, "UNAUTHORIZED", "Invalid or expired session");
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { userId: userData.user.id, authHeader, serviceClient };
}

async function loadOwnedBrand(
  client: SupabaseClient,
  brandId: string,
  userId: string,
): Promise<OwnedBrand | Response> {
  const { data, error } = await client
    .from("brands")
    .select("id, account_id, name, description, place_pool_id, google_place_id, venue_category, cover_media_url, cover_media_type")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return errorResponse(500, "BRAND_READ_FAILED", error.message);
  if (!data) return errorResponse(404, "BRAND_NOT_FOUND", "Brand not found");
  const brand = data as OwnedBrand;
  if (brand.account_id !== userId) {
    return errorResponse(403, "FORBIDDEN", "Brand not owned by caller");
  }
  return brand;
}

// META-ORCH-1255 Leg A: load the venue row and assert it belongs to the authed
// brand (loadOwnedBrand already proved the caller owns the brand).
async function loadOwnedVenue(
  client: SupabaseClient,
  venueId: string,
  brand: OwnedBrand,
): Promise<OwnedVenue | Response> {
  const { data, error } = await client
    .from("venue_listings")
    // ORCH-1263 §A3: + claim_status (placeWriteMode input).
    .select("id, brand_id, place_pool_id, google_place_id, venue_category, name, cover_media_url, cover_media_type, claim_status")
    .eq("id", venueId)
    .maybeSingle();

  if (error) return errorResponse(500, "VENUE_READ_FAILED", error.message);
  if (!data) return errorResponse(404, "VENUE_NOT_FOUND", "Venue not found");
  const venue = data as OwnedVenue;
  if (venue.brand_id !== brand.id) {
    return errorResponse(403, "FORBIDDEN", "Venue does not belong to this brand");
  }
  return venue;
}

// ORCH-1263: exported (was module-private) so the T-A1 stage-payload contract
// test can drive the handler with a fake client. No behavior change from the
// export keyword itself.
export async function handleTier1(
  client: SupabaseClient,
  userId: string,
  brand: OwnedBrand,
  venue: OwnedVenue,
  body: RequestBody,
): Promise<Response> {
  const draft = body.draft ?? {};
  const selectedPlacePoolId = body.selected_place_pool_id ?? null;
  const category = draft.venueCategory ?? venue.venue_category ?? brand.venue_category ?? "restaurant";
  const name = asString(draft.name, venue.name ?? brand.name ?? "");
  const address = asString(draft.address, "");
  const lat = typeof draft.lat === "number" ? draft.lat : null;
  const lng = typeof draft.lng === "number" ? draft.lng : null;
  const coverMediaType = draft.coverMediaType ??
    (venue.cover_media_type as Tier1Draft["coverMediaType"]) ??
    (brand.cover_media_type as Tier1Draft["coverMediaType"]) ?? null;
  const coverMediaUrl = draft.coverMediaUrl ?? venue.cover_media_url ?? brand.cover_media_url ?? null;

  if (selectedPlacePoolId !== null) {
    if (!isUuid(selectedPlacePoolId)) {
      return errorResponse(400, "BAD_REQUEST", "selected_place_pool_id must be a uuid");
    }

    const { data: place, error: placeErr } = await client
      .from("place_pool")
      // ORCH-1263 §A3 plumbing: + business_author_brand_id (placeWriteMode input).
      .select("id, google_place_id, business_author_brand_id")
      .eq("id", selectedPlacePoolId)
      .eq("is_active", true)
      .maybeSingle();
    if (placeErr) return errorResponse(500, "PLACE_READ_FAILED", placeErr.message);
    if (!place) return errorResponse(404, "PLACE_NOT_FOUND", "Selected place not found");

    // ORCH-1263 §A3.1 (D-A stage-only tier-1). A pre-approval claim of a
    // seeded place is ALWAYS "stage" (placeWriteMode); and on THIS branch even
    // a vestigial "apply" caller gets the same staging payload — serving-column
    // + ownership writes are approve-owned in every mode.
    // I-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE: the pre-1263 writes of
    // opening_hours (live deck-hours overwrite at submit), is_claimed and
    // claimed_by (raw RLS place-UPDATE power before any admin review) are
    // KILLED here — all three move to admin approve
    // (admin-review-venue-claim → buildAuthoredApplyPatch).
    const tier1Mode = placeWriteMode(
      venue.claim_status,
      (place as { business_author_brand_id?: string | null }).business_author_brand_id ?? null,
    );
    void tier1Mode; // computed for parity with §A3.2–.4; both modes stage here.
    const adoptedGallery = Array.from(
      new Set(
        (draft.adoptedGalleryUrls ?? []).filter(
          (u): u is string => typeof u === "string" && /^https?:\/\//i.test(u),
        ),
      ),
    ).slice(0, GALLERY_MAX);
    const { error: placeUpdateErr } = await client
      .from("place_pool")
      .update({
        business_authoring_status: "processing",
        business_hero_video_present: coverMediaType === "video",
        business_authoring_inputs: {
          tier1: draft,
          selected_place_pool_id: selectedPlacePoolId,
          // Provenance (R-5): source, adoptedAt, summarySource, wantsReservations.
          adoption: draft.adoption ?? null,
          // c6/c7 staging seed → deck-readiness resume + tier-2 AI.
          tier2: {
            website: draft.website ?? null,
            price_tiers: draft.priceTiers ?? [],
            vibe_chips: [],
          },
        },
        // kept+added, in c3 order (cleaned exactly like the authoritative
        // sync_gallery write: http(s)-only, de-duped, capped GALLERY_MAX).
        ...(adoptedGallery.length > 0 ? { business_gallery_urls: adoptedGallery } : {}),
      })
      .eq("id", selectedPlacePoolId);
    if (placeUpdateErr) return errorResponse(500, "PLACE_UPDATE_FAILED", placeUpdateErr.message);

    // META-ORCH-1255: the VENUE row is the place-pointer truth. brands.
    // place_pool_id gains NO new writers — one owner per truth
    // (I-PROPOSED-1255-VENUE-APPROVAL-PER-VENUE-ROW; the brand column is
    // legacy-inert, readers migrate in Legs B/C).
    const { error: venueUpdateErr } = await client
      .from("venue_listings")
      .update({
        place_pool_id: selectedPlacePoolId,
        google_place_id: (place as { google_place_id: string | null }).google_place_id,
      })
      .eq("id", venue.id);
    if (venueUpdateErr) return errorResponse(500, "VENUE_UPDATE_FAILED", venueUpdateErr.message);

    await upsertPipelineState(client, brand.id, venue.id, selectedPlacePoolId, "processing", {
      stageStatus: { tier1: "linked_existing" },
      coaching: [],
      bouncerReasons: [],
      tier1CompletedAt: new Date().toISOString(),
    });

    return jsonResponse(200, {
      kind: "ok",
      action: "upsert_tier1_place",
      place_pool_id: selectedPlacePoolId,
      claim_path: "existing",
    });
  }

  if (!name || lat === null || lng === null) {
    return errorResponse(400, "BAD_REQUEST", "name, lat, and lng are required");
  }

  const typeInfo = categoryTypes(category);
  const storedPhotoUrls = coverMediaUrl ? [coverMediaUrl] : [];
  const { data: inserted, error: insertErr } = await client
    .from("place_pool")
    .insert({
      google_place_id: null,
      name,
      address,
      lat,
      lng,
      city: asString(draft.city, ""),
      country: asString(draft.countryCode, ""),
      types: typeInfo.types,
      primary_type: typeInfo.primaryType,
      fetched_via: "business_authored",
      raw_google_data: {
        source: "business_authored",
        not_google_reviewed: true,
      },
      business_status: "OPERATIONAL",
      is_claimed: true,
      claimed_by: userId,
      is_active: true,
      is_servable: false,
      bouncer_reason: "pending_business_pipeline",
      // ORCH-1068: normalize wizard array hours → Google {periods} object.
      opening_hours: normalizeBusinessHoursForPool(draft.hours ?? draft.openingHours),
      stored_photo_urls: storedPhotoUrls,
      business_author_brand_id: brand.id,
      business_authoring_status: "processing",
      business_hero_video_present: coverMediaType === "video",
      business_authoring_inputs: { tier1: draft },
      generative_summary: asString(draft.description) || null,
    })
    .select("id")
    .single();
  if (insertErr) return errorResponse(500, "PLACE_INSERT_FAILED", insertErr.message);

  const placePoolId = (inserted as { id: string }).id;
  // META-ORCH-1255: pointer + location land on the VENUE row (brands gains NO
  // new writers — one owner per truth; the venue row IS the truth).
  const { error: venueCreateUpdateErr } = await client
    .from("venue_listings")
    .update({
      place_pool_id: placePoolId,
      google_place_id: null,
      lat,
      lng,
      city: asString(draft.city, ""),
      country_code: asString(draft.countryCode, ""),
    })
    .eq("id", venue.id);
  if (venueCreateUpdateErr) return errorResponse(500, "VENUE_UPDATE_FAILED", venueCreateUpdateErr.message);

  await upsertPipelineState(client, brand.id, venue.id, placePoolId, "processing", {
    stageStatus: { tier1: "created_business_authored" },
    coaching: [],
    bouncerReasons: [],
    tier1CompletedAt: new Date().toISOString(),
  });

  return jsonResponse(200, {
    kind: "ok",
    action: "upsert_tier1_place",
    place_pool_id: placePoolId,
    claim_path: "create_new",
  });
}

interface PipelineStatePatch {
  stageStatus: Record<string, unknown>;
  coaching: unknown[];
  bouncerReasons: string[];
  tier1CompletedAt?: string | null;
  tier2CompletedAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}

// SPEC §5.2 canonical shape: writes bouncer_reasons text[] (plural),
// tier1_completed_at / tier2_completed_at, last_error_code / last_error_message.
// META-ORCH-1255 (R-1 kill): the pipeline row is keyed one-per-VENUE. The
// conflict target is venue_id — NEVER the brand column (a brand-keyed conflict
// target was the venue-#2-clobbers-venue-#1 bug; CI gate
// .github/scripts/strict-grep/orch-1255-pipeline-no-brand-onconflict.mjs
// fails any revert).
async function upsertPipelineState(
  client: SupabaseClient,
  brandId: string,
  venueId: string,
  placePoolId: string | null,
  status: "draft" | "processing" | "needs_fix" | "deck_eligible" | "failed",
  patch: PipelineStatePatch,
): Promise<void> {
  const row: Record<string, unknown> = {
    brand_id: brandId,
    venue_id: venueId,
    place_pool_id: placePoolId,
    status,
    stage_status: patch.stageStatus,
    coaching: patch.coaching,
    bouncer_reasons: patch.bouncerReasons,
    last_error_code: patch.lastErrorCode ?? null,
    last_error_message: patch.lastErrorMessage ?? null,
  };
  if (patch.tier1CompletedAt !== undefined) row.tier1_completed_at = patch.tier1CompletedAt;
  if (patch.tier2CompletedAt !== undefined) row.tier2_completed_at = patch.tier2CompletedAt;
  await client
    .from("brand_place_pipeline_state")
    .upsert(row, { onConflict: "venue_id" });
}

async function loadSignals(client: SupabaseClient): Promise<SignalRow[]> {
  const { data, error } = await client
    .from("signal_definitions")
    .select("id, label")
    .eq("is_active", true)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SignalRow[];
}

// D1 (SPEC §7 Stage 3) — Gemini 2.5 Flash vision image-understanding.
// Inline image bytes are sent as `inline_data` { mime_type, data: base64 } parts
// per the official image-understanding API:
//   https://ai.google.dev/gemini-api/docs/image-understanding
// We cap at 5 images (hero + up to 4 gallery) to bound request size + cost, and
// only fetch http(s) URLs of an image content-type. If NO usable image bytes can
// be fetched, photo_analysis is returned EMPTY (-> persisted NULL by the caller)
// — never fabricated from metadata (Constitution rule 9, no-fabricated-data).
// WS6/Sub-F: cap the vision set so the edge function stays within its memory/CPU
// budget. Downloading + base64-encoding many multi-MB photos in one invocation is
// what triggered the "not enough compute resources" (546) crash. 4 images is a
// strong multi-image read while keeping peak memory small.
const MAX_VISION_IMAGES = 4;
const SUPPORTED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchImageParts(
  imageUrls: string[],
): Promise<Array<{ inline_data: { mime_type: string; data: string } }>> {
  const parts: Array<{ inline_data: { mime_type: string; data: string } }> = [];
  for (const url of imageUrls.slice(0, MAX_VISION_IMAGES)) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) continue;
      const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!SUPPORTED_IMAGE_MIME.has(mime)) {
        // Drain body so the connection can be reused, then skip.
        await res.arrayBuffer().catch(() => undefined);
        continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > 3_000_000) continue; // skip empty / >3MB (bound peak memory)
      parts.push({ inline_data: { mime_type: mime, data: bytesToBase64(buf) } });
    } catch (_err) {
      // Network/decoding failure on one image must not fabricate analysis;
      // skip this image and continue. An empty result -> NULL photo_analysis.
      continue;
    }
  }
  return parts;
}

// META-ORCH-1009 Sub-F WS6: scan the venue's website for real context. Fetches the
// homepage, follows a few same-origin internal links (About / Menu / Story /
// Visit / Contact), strips HTML to text, and concatenates — so Gemini reasons
// about ACTUAL content (and can flag claims that don't match). Plain fetch only
// (no dependency). Hard caps on pages, bytes, total text, and wall-clock so a
// slow/hostile site can't hang the function.
const WEBSITE_LINK_HINTS = /about|menu|story|visit|contact|food|drink|experience|gallery|our-|whats-on|what-s-on/i;
// Sub-F: keep the function within edge compute — 3 pages, 8k chars, 5s/page.
const WEBSITE_MAX_PAGES = 3;
const WEBSITE_MAX_TOTAL_CHARS = 8_000;
const WEBSITE_PER_FETCH_TIMEOUT_MS = 5_000;

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), WEBSITE_PER_FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "MinglaBot/1.0 (+venue-verification)" },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ctype.includes("text/html") && !ctype.includes("text/plain") && ctype !== "") {
      await res.arrayBuffer().catch(() => undefined);
      return null;
    }
    const body = await res.text();
    return body.slice(0, 200_000); // cap raw bytes per page
  } catch {
    return null;
  }
}

// Exported for the website-scan behavioral test.
export function extractInternalLinks(html: string, baseUrl: string): string[] {
  let origin = "";
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }
  const out = new Set<string>();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!WEBSITE_LINK_HINTS.test(href)) continue;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    // Same-origin only; drop fragments/mailto/tel.
    if (!abs.startsWith(origin)) continue;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
    out.add(abs.split("#")[0]);
    if (out.size >= WEBSITE_MAX_PAGES - 1) break;
  }
  return [...out];
}

export async function scanWebsite(
  websiteUrl: string | null | undefined,
): Promise<{ text: string; pages_read: number } | null> {
  if (typeof websiteUrl !== "string" || websiteUrl.trim().length === 0) return null;
  let url = websiteUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const homeHtml = await fetchText(url);
  if (homeHtml === null) return null;

  const pages: string[] = [stripHtmlToText(homeHtml)];
  const links = extractInternalLinks(homeHtml, url);
  for (const link of links) {
    if (pages.length >= WEBSITE_MAX_PAGES) break;
    const html = await fetchText(link);
    if (html !== null) pages.push(stripHtmlToText(html));
  }
  const text = pages.join("\n\n").slice(0, WEBSITE_MAX_TOTAL_CHARS).trim();
  if (text.length === 0) return null;
  return { text, pages_read: pages.length };
}

async function callGeminiForEvaluations(input: {
  brand: OwnedBrand;
  place: Record<string, unknown>;
  signals: SignalRow[];
  tier2: Record<string, unknown>;
  imageUrls: string[];
  websiteText: string | null;
}): Promise<{
  bio: string;
  photo_analysis: Record<string, unknown> | null;
  facets: Record<string, unknown>;
  evaluations: AiEvaluation[];
  consistency: Record<string, unknown> | null;
}> {
  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GOOGLE_AI_API_KEY") ?? "";
  if (!apiKey) {
    throw new Error("gemini_unconfigured");
  }

  // D1: fetch real image bytes for the vision stage. May be empty -> no fabrication.
  const imageParts = await fetchImageParts(input.imageUrls);
  const hasImages = imageParts.length > 0;

  // META-ORCH-1009 Sub-E: send a SLIM place projection, not the whole row. The
  // raw place_pool row carries raw_google_data / stored_photo_urls / large JSON
  // blobs that bloat the prompt, push Gemini toward the output-token cap, and
  // cause truncated JSON (which previously threw gemini_missing_signal -> opaque
  // 546/500). Only the fields the model actually needs to reason are included.
  const slimPlace = {
    name: (input.place as { name?: unknown }).name ?? null,
    address: (input.place as { address?: unknown }).address ?? null,
    city: (input.place as { city?: unknown }).city ?? null,
    country: (input.place as { country?: unknown }).country ?? null,
    primary_type: (input.place as { primary_type?: unknown }).primary_type ?? null,
    types: (input.place as { types?: unknown }).types ?? null,
    website: (input.place as { website?: unknown }).website ?? null,
    business_status: (input.place as { business_status?: unknown }).business_status ?? null,
    generative_summary: (input.place as { generative_summary?: unknown }).generative_summary ?? null,
  };

  const prompt = {
    instruction: hasImages
      ? "You are given venue photos as inline images plus structured venue data. Generate (1) an AI-authored sales bio, (2) a photo_analysis object from the ACTUAL images provided (lighting, ambience, composition_score_0_to_100, near_duplicate_groups, facet_hints, reasoning), (3) structured facet inference, and (4) one Q2 score per active Mingla signal. You MUST return exactly one evaluation object per signal id provided in `signals` — never omit a signal. Return strict JSON only."
      : "Generate an AI-authored sales bio, structured facet inference, and one score per active Mingla signal from the venue's text details. You MUST return exactly one evaluation object per signal id provided in `signals` — never omit a signal. Keep each signal's reasoning to ONE short phrase (max 10 words). Set photo_analysis to null. Return strict JSON only.",
    model_contract: {
      model: GEMINI_MODEL,
      prompt_version: PROMPT_VERSION,
      score_keys: ["score_0_to_100", "inappropriate_for", "reasoning"],
      photo_analysis_shape: {
        model: GEMINI_MODEL,
        evaluated_at: "ISO-8601",
        aesthetic: { lighting: "string", ambience: "string", composition_score_0_to_100: 0 },
        dedupe: { near_duplicate_groups: [] },
        facet_hints: {},
        reasoning: "short plain-English summary",
      },
    },
    has_images: hasImages,
    image_count: imageParts.length,
    brand: { id: input.brand.id, name: (input.brand as { name?: unknown }).name ?? null },
    place: slimPlace,
    tier2: input.tier2,
    // WS6: the venue's own website content (homepage + About/Menu pages) for real
    // context — base the bio + scores on this, not guesswork.
    website_content: input.websiteText,
    signals: input.signals.map((s) => ({ id: s.id, label: s.label })),
    // WS6: also return a `consistency` object judging whether the website +
    // photos SUPPORT the operator's claims (tier2 price_tiers, facet answers,
    // vibe signal picks). Informational for an admin — do NOT change scores
    // because of it. Shape: { verdict: "consistent"|"mixed"|"contradicted",
    // confidence_0_to_100: int, summary: short text, flags: [short strings] }.
    consistency_required: true,
  };

  const parts: Array<Record<string, unknown>> = [{ text: JSON.stringify(prompt) }, ...imageParts];
  const requiredSignalIds = new Set(input.signals.map((s) => s.id));

  // META-ORCH-1009 Sub-E: a bio + facets + photo_analysis + 16 per-signal
  // evaluations is a large JSON payload. Gemini occasionally truncates or omits a
  // signal even with the token cap. We do NOT fabricate the missing score
  // (buildAiSignalScores fail-closes by design). Instead we retry the model call
  // up to ONE extra time when the response is truncated, unparseable, or doesn't
  // cover every signal — re-asking the model rather than inventing data.
  const MAX_ATTEMPTS = 2;
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: GEMINI_RESPONSE_SCHEMA,
            // WS6: bio + facets + 16 evals + a consistency block. 6144 fits it with
            // terse per-signal reasoning.
            maxOutputTokens: 6144,
            temperature: 0.4,
          },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      lastErr = `gemini_failed:${res.status}:${body.slice(0, 200)}`;
      // 4xx (bad key / quota / bad request) won't fix on retry — fail fast.
      if (res.status < 500) throw new Error(lastErr);
      continue;
    }
    const payload = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      lastErr = "gemini_empty";
      continue;
    }
    let parsed: {
      bio?: unknown;
      photo_analysis?: unknown;
      facets?: unknown;
      evaluations?: unknown;
      consistency?: unknown;
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      // Truncated / malformed JSON — retry once.
      lastErr = "gemini_unparseable_json";
      continue;
    }
    if (!Array.isArray(parsed.evaluations)) {
      lastErr = "gemini_missing_evaluations";
      continue;
    }

    const evaluations = parsed.evaluations.map((ev) => {
      const row = ev as Record<string, unknown>;
      return {
        signal_id: asString(row.signal_id),
        score_0_to_100: Math.max(0, Math.min(100, Number(row.score_0_to_100) || 0)),
        inappropriate_for: row.inappropriate_for === true,
        reasoning: asString(row.reasoning, "No reasoning returned."),
      };
    }).filter((ev) => ev.signal_id.length > 0);

    // Coverage check: every active signal must have an evaluation. If not, retry
    // (re-ask the model) before letting buildAiSignalScores fail-close.
    const covered = new Set(evaluations.map((ev) => ev.signal_id));
    const missing = [...requiredSignalIds].filter((id) => !covered.has(id));
    if (missing.length > 0 && attempt < MAX_ATTEMPTS) {
      lastErr = `gemini_incomplete_coverage:${missing.slice(0, 5).join(",")}`;
      continue;
    }

    // D1 honesty guard: only accept photo_analysis when we actually sent images.
    // With no images, photo_analysis is NULL regardless of what Gemini returned.
    let photoAnalysis: Record<string, unknown> | null = null;
    if (hasImages && parsed.photo_analysis && typeof parsed.photo_analysis === "object") {
      photoAnalysis = {
        ...(parsed.photo_analysis as Record<string, unknown>),
        model: GEMINI_MODEL,
        evaluated_at: new Date().toISOString(),
        image_count: imageParts.length,
      };
    }
    return {
      bio: asString(parsed.bio, ""),
      photo_analysis: photoAnalysis,
      facets: parsed.facets && typeof parsed.facets === "object"
        ? parsed.facets as Record<string, unknown>
        : {},
      evaluations,
      consistency:
        parsed.consistency && typeof parsed.consistency === "object"
          ? parsed.consistency as Record<string, unknown>
          : null,
    };
  }
  throw new Error(lastErr || "gemini_failed");
}

// D2 (SPEC §7 Stage 7) — deterministic, NO-AI Google cross-validation.
// claim-existing: diff Sarah's Tier1/Tier2 inputs against the existing Google
//   place_pool row, archive the Google values, persist the diff under
//   raw_google_data.business_claim_diff. Operator-confirmed values win on the
//   live columns; the original Google values are archived, not overwritten.
// create-new: stamp raw_google_data.source='business_authored' +
//   business_authored_inputs_hash. Never call the row Google-verified.
async function djb2Hash(input: string): Promise<string> {
  // Deterministic content hash for business_authored_inputs_hash (SHA-256 hex).
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeForDiff(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim().toLowerCase();
  return String(v).trim().toLowerCase();
}

// Exported for the C4 behavioral test (no behavior change; deterministic, no AI).
export async function buildCrossValidation(
  place: Record<string, unknown>,
  tier1: Record<string, unknown>,
  tier2: Record<string, unknown>,
): Promise<{
  raw_google_data: Record<string, unknown>;
  stage_status: string;
  conflicts: string[];
}> {
  const existingRaw =
    (place.raw_google_data && typeof place.raw_google_data === "object")
      ? { ...(place.raw_google_data as Record<string, unknown>) }
      : {};
  const googlePlaceId = (place as { google_place_id?: string | null }).google_place_id ?? null;
  const isClaimExisting = typeof googlePlaceId === "string" && googlePlaceId.length > 0;

  const sarahName = asString(tier1.name) || asString((place as { name?: string }).name);
  const sarahAddress = asString(tier1.address) || asString((place as { address?: string }).address);
  const sarahWebsite = asString(tier2.website) || asString((place as { website?: string }).website);

  if (isClaimExisting) {
    // Compare Sarah inputs vs the Google/place-pool authoritative fields.
    const fields: Array<{ field: string; sarah: unknown; google: unknown }> = [
      { field: "name", sarah: sarahName, google: (place as { name?: unknown }).name },
      { field: "address", sarah: sarahAddress, google: (place as { address?: unknown }).address },
      { field: "website", sarah: sarahWebsite, google: (place as { website?: unknown }).website },
    ];
    const diff = fields
      .filter((f) => normalizeForDiff(f.sarah) !== "" &&
        normalizeForDiff(f.sarah) !== normalizeForDiff(f.google))
      .map((f) => ({
        field: f.field,
        business_value: f.sarah,
        google_value: f.google ?? null,
      }));
    existingRaw.business_claim_diff = {
      compared_at: new Date().toISOString(),
      google_place_id: googlePlaceId,
      diff,
      // Archive the Google values so operator-confirmed values can win on the
      // live columns without losing the original Google authority.
      archived_google: {
        name: (place as { name?: unknown }).name ?? null,
        address: (place as { address?: unknown }).address ?? null,
        website: (place as { website?: unknown }).website ?? null,
      },
    };
    return {
      raw_google_data: existingRaw,
      stage_status: diff.length > 0 ? "claim_diff_recorded" : "claim_no_conflicts",
      conflicts: diff.map((d) => d.field),
    };
  }

  // create-new path.
  const inputsHash = await djb2Hash(JSON.stringify({ tier1, tier2 }));
  existingRaw.source = "business_authored";
  existingRaw.not_google_reviewed = true;
  existingRaw.business_authored_inputs_hash = inputsHash;
  return {
    raw_google_data: existingRaw,
    stage_status: "create_new_no_google",
    conflicts: [],
  };
}

// Exported for the C4 behavioral test (no behavior change; pure function).
export function buildAiSignalScores(
  signals: SignalRow[],
  evaluations: AiEvaluation[],
  evaluatedAt: string,
): Record<string, {
  score_0_to_100: number;
  inappropriate_for: boolean;
  reasoning: string;
  evaluated_at: string;
  prompt_version: string;
  model: string;
}> {
  const bySignal = new Map(evaluations.map((ev) => [ev.signal_id, ev]));
  const out: Record<string, {
    score_0_to_100: number;
    inappropriate_for: boolean;
    reasoning: string;
    evaluated_at: string;
    prompt_version: string;
    model: string;
  }> = {};
  for (const signal of signals) {
    const ev = bySignal.get(signal.id);
    if (!ev) {
      throw new Error(`gemini_missing_signal:${signal.id}`);
    }
    out[signal.id] = {
      score_0_to_100: ev.score_0_to_100,
      inappropriate_for: ev.inappropriate_for,
      reasoning: ev.reasoning,
      evaluated_at: evaluatedAt,
      prompt_version: PROMPT_VERSION,
      model: GEMINI_MODEL,
    };
  }
  return out;
}

// ORCH-1263: exported (was module-private) so the T-A6 stage-payload contract
// test can drive the handler with a fake client + stubbed Gemini fetch.
export async function handleTier2(
  client: SupabaseClient,
  brand: OwnedBrand,
  venue: OwnedVenue,
  body: RequestBody,
): Promise<Response> {
  const placePoolId = body.place_pool_id ?? venue.place_pool_id;
  if (!isUuid(placePoolId)) {
    return errorResponse(400, "BAD_REQUEST", "place_pool_id is required");
  }

  const { data: place, error: placeErr } = await client
    .from("place_pool")
    .select("*")
    .eq("id", placePoolId)
    .maybeSingle();
  if (placeErr) return errorResponse(500, "PLACE_READ_FAILED", placeErr.message);
  if (!place) return errorResponse(404, "PLACE_NOT_FOUND", "Place not found");

  // META-ORCH-1009 Sub-F WS7: cap "Recommend me" at the initial run + 3 changes.
  // Admin rejection resets the count to 0 (see admin-review-venue-claim).
  const editCount = Number(
    (place as { business_recommend_edit_count?: unknown }).business_recommend_edit_count ?? 0,
  );
  if (editCount >= RECOMMEND_EDIT_CAP) {
    return errorResponse(
      429,
      "RECOMMEND_EDIT_LIMIT",
      "You've used your 3 changes. An admin review (or a rejection) re-opens editing.",
    );
  }

  const signals = await loadSignals(client);
  const tier2 = body.tier2 ?? {};
  const existingInputs =
    ((place as { business_authoring_inputs?: Record<string, unknown> | null }).business_authoring_inputs ?? {});
  const tier1 = typeof existingInputs.tier1 === "object" && existingInputs.tier1 !== null
    ? existingInputs.tier1 as Record<string, unknown>
    : {};

  // META-ORCH-1009 Sub-F WS6: send ALL operator-uploaded gallery photos to Gemini
  // (multi-image, no stitch — zero Supabase conversion cost) so vision analyzes
  // the real set. Also scan the venue's website (homepage + About/Menu internal
  // links) for genuine context the model bases the bio + scores + consistency on.
  // The funny client loader covers the wait. (Hero/video boosts the recommendation
  // separately; the gallery is the analysis input.)
  const imageUrls = galleryUrls(place as Record<string, unknown>);
  const websiteForScan =
    (tier2 as { website?: unknown }).website ??
    (place as { website?: unknown }).website ?? null;
  const websiteScan = await scanWebsite(
    typeof websiteForScan === "string" ? websiteForScan : null,
  );

  // META-ORCH-1009 Sub-E: the AI stage (Gemini call + fail-closed score assembly)
  // is the one place this handler can throw on external/model conditions. Persist
  // the real reason to brand_place_pipeline_state.last_error_* so a failed
  // "Generate AI bio and scores" is diagnosable instead of an opaque 500/546, then
  // rethrow to the top-level catch (which returns the structured error body the
  // client now surfaces).
  let gemini: Awaited<ReturnType<typeof callGeminiForEvaluations>>;
  let evaluatedAt: string;
  let aiSignalScores: ReturnType<typeof buildAiSignalScores>;
  try {
    gemini = await callGeminiForEvaluations({
      brand,
      place,
      signals,
      tier2,
      imageUrls,
      websiteText: websiteScan?.text ?? null,
    });
    evaluatedAt = new Date().toISOString();
    aiSignalScores = buildAiSignalScores(signals, gemini.evaluations, evaluatedAt);
  } catch (aiErr) {
    const aiMsg = aiErr instanceof Error ? aiErr.message : "ai_stage_failed";
    await upsertPipelineState(client, brand.id, venue.id, placePoolId, "needs_fix", {
      stageStatus: { tier2: "ai_stage_failed" },
      coaching: coachingForReasons(["AI_STAGE_FAILED"]),
      bouncerReasons: [],
      lastErrorCode: "AI_STAGE_FAILED",
      lastErrorMessage: aiMsg.slice(0, 500),
    });
    throw aiErr;
  }
  // D1: photo_analysis is NULL when no real images were analyzed (no fabrication).
  const photoAnalysis = gemini.photo_analysis;
  const facetPatch = Object.fromEntries(
    Object.entries(gemini.facets).filter(([key, value]) =>
      FACET_COLUMNS.has(key) && (typeof value === "boolean" || value === null)
    ),
  );

  // D2 (Stage 7): deterministic Google cross-validation (no AI).
  const crossValidation = await buildCrossValidation(
    place as Record<string, unknown>,
    tier1,
    tier2,
  );

  const mergedInputs = {
    ...existingInputs,
    tier2,
    // WS6: store the consistency check + website-scan provenance for the admin
    // review (informational; does not change scores).
    consistency: gemini.consistency,
    website_scan: websiteScan === null
      ? null
      : {
          pages_read: websiteScan.pages_read,
          chars: websiteScan.text.length,
          scanned_at: evaluatedAt,
        },
    images_analyzed: imageUrls.length,
    pending_ai_outputs: {
      generated_bio: gemini.bio,
      facets: gemini.facets,
      generated_at: evaluatedAt,
      prompt_version: PROMPT_VERSION,
      model: GEMINI_MODEL,
    },
  };

  const bouncerPlace = placeForBouncer(placePoolId, place as Record<string, unknown>, tier2);
  const verdict = bounce(bouncerPlace);
  const reasons = crossValidation.conflicts.length > 0
    ? [...verdict.reasons, ...crossValidation.conflicts.map((c) => `CLAIM_CONFLICT:${c}`)]
    : verdict.reasons;
  const nextStatus = verdict.is_servable ? "processing" : "needs_fix";
  const coaching = verdict.is_servable
    ? coachingForReasons(["CONFIRM:ai_outputs"])
    : coachingForReasons(reasons);

  // META-ORCH-1062 Phase 3 (I-NO-CLAIM-DEMOTION): the Tier-2 AI step must not
  // strip an already-live claim's servability either. Preserve a prior true;
  // net-new (prior false) stays false. Same rule as confirm_ai_outputs.
  const tier2NextIsServable = nextIsServableForConfirm(
    (place as { is_servable?: boolean | null }).is_servable,
  );

  // ORCH-1263 §A3.4 (D-A): a pre-approval claim ("stage") keeps every
  // authoring/diagnostic column the admin bundle needs (ai_signal_scores,
  // photo_analysis, raw_google_data claim-diff archive, inputs, status,
  // bouncer_*, edit count — none serving-read) but OMITS the two live-place
  // writes: website (:pre-1263 wrote it here) and is_servable (prior true is
  // preserved by omission — stricter than the identity write).
  // I-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE.
  const tier2Mode = placeWriteMode(
    venue.claim_status,
    (place as { business_author_brand_id?: string | null }).business_author_brand_id ?? null,
  );
  const { error: updateErr } = await client
    .from("place_pool")
    .update({
      ai_signal_scores: aiSignalScores,
      photo_analysis: photoAnalysis,
      raw_google_data: crossValidation.raw_google_data,
      business_authoring_inputs: mergedInputs,
      business_authoring_status: nextStatus,
      bouncer_reason: reasons.join(",") || null,
      bouncer_validated_at: evaluatedAt,
      business_recommend_edit_count: editCount + 1,
      ...(tier2Mode === "apply"
        ? { is_servable: tier2NextIsServable, website: bouncerPlace.website }
        : {}),
    })
    .eq("id", placePoolId);
  if (updateErr) return errorResponse(500, "PLACE_UPDATE_FAILED", updateErr.message);

  await upsertPipelineState(client, brand.id, venue.id, placePoolId, nextStatus, {
    stageStatus: fullStageStatus({
      photo_analysis: photoAnalysis && Object.keys(photoAnalysis).length > 0 ? "complete" : "skipped_no_images",
      sales_bio_generation: "generated_pending_confirmation",
      structured_facet_inference: "generated_pending_confirmation",
      signal_pre_evaluation: "complete",
      google_cross_validation: crossValidation.stage_status,
      bouncer_servability: verdict.is_servable ? "passed_pending_confirmation" : "needs_fix",
    }),
    coaching,
    bouncerReasons: reasons,
  });

  return jsonResponse(200, {
    kind: "ok",
    action: body.action === "regenerate_sales_bio" ? "regenerate_sales_bio" : "run_tier2_pipeline",
    place_pool_id: placePoolId,
    status: nextStatus,
    signals_evaluated: signals.length,
    generated_bio: gemini.bio,
    facets: facetPatch,
    coaching,
  });
}

// ORCH-1263: exported (was module-private) so the T-A5 stage-payload contract
// test can drive the handler with a fake client.
export async function handleConfirmAiOutputs(
  client: SupabaseClient,
  brand: OwnedBrand,
  venue: OwnedVenue,
  body: RequestBody,
): Promise<Response> {
  const placePoolId = body.place_pool_id ?? venue.place_pool_id;
  if (!isUuid(placePoolId)) {
    return errorResponse(400, "BAD_REQUEST", "place_pool_id is required");
  }
  const salesBio = asString(body.sales_bio);
  if (salesBio.length < 20) {
    return errorResponse(400, "BAD_REQUEST", "sales_bio must be at least 20 characters");
  }

  const { data: place, error: placeErr } = await client
    .from("place_pool")
    .select("*")
    .eq("id", placePoolId)
    .maybeSingle();
  if (placeErr) return errorResponse(500, "PLACE_READ_FAILED", placeErr.message);
  if (!place) return errorResponse(404, "PLACE_NOT_FOUND", "Place not found");

  const submittedFacets = body.facets ?? {};
  const facetPatch = Object.fromEntries(
    Object.entries(submittedFacets).filter(([key, value]) =>
      FACET_COLUMNS.has(key) && (typeof value === "boolean" || value === null)
    ),
  );
  const tier2 = body.tier2 ?? {};
  const mergedInputs = {
    ...((place as { business_authoring_inputs?: Record<string, unknown> | null }).business_authoring_inputs ?? {}),
    tier2,
    confirmed_ai_outputs: {
      sales_bio: salesBio,
      facets: facetPatch,
      confirmed_at: new Date().toISOString(),
      prompt_version: PROMPT_VERSION,
      model: GEMINI_MODEL,
    },
  };
  const bouncerPlace = placeForBouncer(placePoolId, place as Record<string, unknown>, tier2);
  const verdict = bounce(bouncerPlace);
  // META-ORCH-1009 Sub-E: combine the shared bouncer verdict with the business
  // gallery gate (>=5 photos). The venue is only servable when BOTH pass.
  const reasons = [...verdict.reasons, ...businessGateReasons(place as Record<string, unknown>)];
  const servable = verdict.is_servable && reasons.length === verdict.reasons.length;
  const nextStatus = servable ? "deck_eligible" : "needs_fix";
  const coaching = coachingForReasons(reasons);

  // WS6: deck-integration data. price_tiers (consumer taxonomy) + derived
  // price_level (deck displays this); stored_photo_urls = hero + gallery (deck
  // image source). place_scores is produced by run-signal-scorer on admin
  // go-live (WS7), since per-place scoring requires is_servable=true.
  const priceTiers = priceTiersFromTier2(tier2);
  const priceLevel = priceLevelFromTiers(priceTiers);
  const storedPhotos = storedPhotosForDeck(
    place as Record<string, unknown>,
    galleryUrls(place as Record<string, unknown>),
  );

  // META-ORCH-1062 Phase 3 (I-NO-CLAIM-DEMOTION + I-NET-NEW-HOLD): never strip
  // an already-live claim. A net-new business-authored row is inserted with
  // is_servable=false and stays held off-deck until admin approve (Phase 4
  // flips it + runs the scorer). But a CLAIM of a place that was ALREADY
  // is_servable=true (e.g. a live Google-seeded place) must NOT be demoted by
  // the Tier-2 confirm — that would silently remove a live venue from the deck
  // with no restore path. So preserve a prior true; only default-false for rows
  // that were not already servable. The bouncer verdict still gates
  // business_authoring_status (deck_eligible vs needs_fix) unchanged above.
  const nextIsServable = nextIsServableForConfirm(
    (place as { is_servable?: boolean | null }).is_servable,
  );

  // ORCH-1263 §A3.3 (D-A): a pre-approval claim ("stage") confirms the AI
  // outputs into business_authoring_inputs.confirmed_ai_outputs + status +
  // bouncer diagnostics ONLY — the live place's generative_summary, website,
  // price, stored_photo_urls, facet columns and is_servable stay byte-identical
  // until admin approve applies authored truth (authoredApply.ts).
  // I-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE. Apply mode (verified claim /
  // create-new authored row) keeps the pre-1263 behavior unchanged.
  const confirmMode = placeWriteMode(
    venue.claim_status,
    (place as { business_author_brand_id?: string | null }).business_author_brand_id ?? null,
  );
  const confirmPatch: Record<string, unknown> = confirmMode === "stage"
    ? {
      business_authoring_inputs: mergedInputs,
      business_authoring_status: nextStatus,
      bouncer_reason: reasons.join(",") || null,
      bouncer_validated_at: new Date().toISOString(),
    }
    : {
      business_authoring_inputs: mergedInputs,
      business_authoring_status: nextStatus,
      generative_summary: salesBio,
      // META-ORCH-1062 Phase 3: prior-state-preserving. Net-new (prior false)
      // stays false (hold-until-admin); an already-servable claim (prior true)
      // stays true (no demotion). See nextIsServable above.
      is_servable: nextIsServable,
      bouncer_reason: reasons.join(",") || null,
      bouncer_validated_at: new Date().toISOString(),
      website: bouncerPlace.website,
      price_tiers: priceTiers.length > 0 ? priceTiers : null,
      ...(priceLevel !== null ? { price_level: priceLevel } : {}),
      ...(storedPhotos.length > 0 ? { stored_photo_urls: storedPhotos } : {}),
      ...facetPatch,
    };
  const { error: updateErr } = await client
    .from("place_pool")
    .update(confirmPatch)
    .eq("id", placePoolId);
  if (updateErr) return errorResponse(500, "PLACE_UPDATE_FAILED", updateErr.message);

  await upsertPipelineState(client, brand.id, venue.id, placePoolId, nextStatus, {
    stageStatus: fullStageStatus({
      photo_analysis: "complete",
      sales_bio_generation: "confirmed",
      structured_facet_inference: "confirmed",
      signal_pre_evaluation: "complete",
      google_cross_validation: "complete_or_not_applicable",
      bouncer_servability: servable ? "passed" : "needs_fix",
    }),
    coaching,
    bouncerReasons: reasons,
    tier2CompletedAt: nextStatus === "deck_eligible" ? new Date().toISOString() : null,
  });

  return jsonResponse(200, {
    kind: "ok",
    action: "confirm_ai_outputs",
    place_pool_id: placePoolId,
    status: nextStatus,
    coaching,
  });
}

async function handleRefreshDeckReadiness(
  client: SupabaseClient,
  brand: OwnedBrand,
  venue: OwnedVenue,
  body: RequestBody,
): Promise<Response> {
  const placePoolId = body.place_pool_id ?? venue.place_pool_id;
  if (!isUuid(placePoolId)) {
    return errorResponse(400, "BAD_REQUEST", "place_pool_id is required");
  }
  const { data: place, error: placeErr } = await client
    .from("place_pool")
    .select("*")
    .eq("id", placePoolId)
    .maybeSingle();
  if (placeErr) return errorResponse(500, "PLACE_READ_FAILED", placeErr.message);
  if (!place) return errorResponse(404, "PLACE_NOT_FOUND", "Place not found");

  const inputs =
    ((place as { business_authoring_inputs?: Record<string, unknown> | null }).business_authoring_inputs ?? {});
  const tier2 = typeof inputs.tier2 === "object" && inputs.tier2 !== null
    ? inputs.tier2 as Record<string, unknown>
    : {};
  const confirmed = typeof inputs.confirmed_ai_outputs === "object" &&
      inputs.confirmed_ai_outputs !== null;
  const verdict = bounce(placeForBouncer(placePoolId, place as Record<string, unknown>, tier2));
  // META-ORCH-1009 Sub-E: include the business gallery gate (>=5 photos).
  const reasons = [...verdict.reasons, ...businessGateReasons(place as Record<string, unknown>)];
  const servable = verdict.is_servable && reasons.length === verdict.reasons.length;
  const status = servable && confirmed ? "deck_eligible" : "needs_fix";
  const coaching = servable && !confirmed
    ? coachingForReasons(["CONFIRM:ai_outputs"])
    : coachingForReasons(reasons);

  const { error: updateErr } = await client
    .from("place_pool")
    .update({
      business_authoring_status: status,
      bouncer_reason: reasons.join(",") || null,
      bouncer_validated_at: new Date().toISOString(),
    })
    .eq("id", placePoolId);
  if (updateErr) return errorResponse(500, "PLACE_UPDATE_FAILED", updateErr.message);

  await upsertPipelineState(client, brand.id, venue.id, placePoolId, status, {
    stageStatus: fullStageStatus({
      photo_analysis: "complete_or_not_applicable",
      sales_bio_generation: confirmed ? "confirmed" : "pending_confirmation",
      structured_facet_inference: confirmed ? "confirmed" : "pending_confirmation",
      signal_pre_evaluation: "complete_or_pending",
      google_cross_validation: "complete_or_not_applicable",
      bouncer_servability: verdict.is_servable ? "passed" : "needs_fix",
    }),
    coaching,
    bouncerReasons: reasons,
    tier2CompletedAt: status === "deck_eligible" ? new Date().toISOString() : null,
  });

  return jsonResponse(200, {
    kind: "ok",
    action: "refresh_deck_readiness",
    place_pool_id: placePoolId,
    status,
    coaching,
  });
}

async function handleGetAuthoringContext(
  client: SupabaseClient,
  brand: OwnedBrand,
  venue: OwnedVenue,
  body: RequestBody,
): Promise<Response> {
  const placePoolId = body.place_pool_id ?? venue.place_pool_id;
  if (!isUuid(placePoolId)) {
    return errorResponse(400, "BAD_REQUEST", "place_pool_id is required");
  }
  const { data: place, error: placeErr } = await client
    .from("place_pool")
    .select("id, business_authoring_status, business_authoring_inputs, stored_photo_urls, business_hero_video_present, website, business_gallery_urls, business_recommend_edit_count, ai_signal_scores")
    .eq("id", placePoolId)
    .maybeSingle();
  if (placeErr) return errorResponse(500, "PLACE_READ_FAILED", placeErr.message);
  if (!place) return errorResponse(404, "PLACE_NOT_FOUND", "Place not found");

  const { data: pipeline } = await client
    .from("brand_place_pipeline_state")
    .select("status, coaching")
    // META-ORCH-1255: one pipeline row PER VENUE — the brand-keyed
    // .maybeSingle() breaks the moment a brand has 2 venues (F-2 client leg).
    .eq("venue_id", venue.id)
    .maybeSingle();
  const inputs =
    ((place as { business_authoring_inputs?: Record<string, unknown> | null }).business_authoring_inputs ?? {});
  const tier2 = typeof inputs.tier2 === "object" && inputs.tier2 !== null
    ? inputs.tier2 as Record<string, unknown>
    : {};
  const pending = typeof inputs.pending_ai_outputs === "object" &&
      inputs.pending_ai_outputs !== null
    ? inputs.pending_ai_outputs as Record<string, unknown>
    : null;
  const confirmed = typeof inputs.confirmed_ai_outputs === "object" &&
      inputs.confirmed_ai_outputs !== null
    ? inputs.confirmed_ai_outputs as Record<string, unknown>
    : null;
  return jsonResponse(200, {
    kind: "ok",
    action: "get_authoring_context",
    place_pool_id: placePoolId,
    status:
      (pipeline as { status?: string } | null)?.status ??
      (place as { business_authoring_status?: string | null }).business_authoring_status ??
      "processing",
    tier2,
    pending_ai_outputs: pending,
    confirmed_ai_outputs: confirmed,
    // ORCH-1263 §A3.5 (Q-1 fix): the VENUE row is the cover truth (1255(C)
    // D-C). The pre-1263 `stored_photo_urls[0]` + video-flag inference
    // misreported a seeded gallery photo as "the cover" on claim resumes.
    cover_media_url: venue.cover_media_url ?? null,
    cover_media_type: venue.cover_media_type ?? null,
    website: (place as { website?: string | null }).website ?? null,
    gallery_urls: galleryUrls(place as Record<string, unknown>),
    gallery_min: GALLERY_MIN,
    gallery_max: GALLERY_MAX,
    // WS7: results view — the AI signal scores + how many "Recommend" changes remain.
    ai_signal_scores:
      (place as { ai_signal_scores?: Record<string, unknown> | null }).ai_signal_scores ?? null,
    recommend_edits_remaining: Math.max(
      0,
      RECOMMEND_EDIT_CAP -
        Number((place as { business_recommend_edit_count?: unknown }).business_recommend_edit_count ?? 0),
    ),
    coaching: (pipeline as { coaching?: unknown[] } | null)?.coaching ?? [],
  });
}

// ORCH-1263: exported (was module-private) so the T-A3 stage/apply contract
// test can drive the handler with a fake client.
export async function handleSyncHeroMedia(
  client: SupabaseClient,
  brand: OwnedBrand,
  venue: OwnedVenue,
  body: RequestBody,
): Promise<Response> {
  const placePoolId = body.place_pool_id ?? venue.place_pool_id;
  if (!isUuid(placePoolId)) {
    return errorResponse(400, "BAD_REQUEST", "place_pool_id is required");
  }
  const mediaType = body.cover_media_type ?? null;
  const mediaUrl = asString(body.cover_media_url ?? "");
  // ORCH-1263 §A3.2 (D-E) plumbing: one place read supplies the placeWriteMode
  // input plus the prior stored set + authored gallery apply mode needs.
  const { data: heroPlace, error: heroPlaceErr } = await client
    .from("place_pool")
    .select("business_author_brand_id, stored_photo_urls, business_gallery_urls")
    .eq("id", placePoolId)
    .maybeSingle();
  if (heroPlaceErr) return errorResponse(500, "PLACE_READ_FAILED", heroPlaceErr.message);
  if (!heroPlace) return errorResponse(404, "PLACE_NOT_FOUND", "Place not found");

  const heroMode = placeWriteMode(
    venue.claim_status,
    (heroPlace as { business_author_brand_id?: string | null }).business_author_brand_id ?? null,
  );
  // I-1263-GALLERY-NEVER-WIPED-BY-HERO: the pre-1263 one-element write
  // (`stored_photo_urls = [mediaUrl]`) wiped a seeded place's entire live
  // gallery the moment a hero was picked. KILLED. Stage mode (pre-approval
  // claim) writes the video flag ONLY — stored_photo_urls is untouched until
  // approve. Apply mode swaps the hero non-destructively via
  // nextStoredPhotosForHero (result ⊇ gallery, never a wipe).
  const priorStored = Array.isArray(
      (heroPlace as { stored_photo_urls?: unknown }).stored_photo_urls,
    )
    ? ((heroPlace as { stored_photo_urls: unknown[] }).stored_photo_urls.filter(
      (u): u is string => typeof u === "string" && u.length > 0,
    ))
    : [];
  const heroPatch: Record<string, unknown> = heroMode === "stage"
    ? { business_hero_video_present: mediaType === "video" }
    : {
      business_hero_video_present: mediaType === "video",
      stored_photo_urls: nextStoredPhotosForHero(
        priorStored,
        galleryUrls(heroPlace as Record<string, unknown>),
        mediaUrl.length > 0 ? mediaUrl : null,
      ),
    };
  const { error } = await client
    .from("place_pool")
    .update(heroPatch)
    .eq("id", placePoolId);
  if (error) return errorResponse(500, "PLACE_UPDATE_FAILED", error.message);
  // META-ORCH-1255(C) D-C: the venue row owns the venue listing's cover (M1
  // columns cover_media_url/cover_media_type). Pre-fix the hero pick only
  // reached place_pool here while the client CoverPicker's "brand" target
  // clobbered brands.cover_media_url — two venues fought over the parent
  // brand's cover. `client` is the service-role client (venue_listings has no
  // client write policy by design); ownership was asserted upstream by
  // loadOwnedBrand → loadOwnedVenue. mediaType is constrained by the
  // RequestBody union (image|video|gif|null), matching the M1 CHECK.
  const { error: venueCoverErr } = await client
    .from("venue_listings")
    .update({
      cover_media_url: mediaUrl.length > 0 ? mediaUrl : null,
      cover_media_type: mediaUrl.length > 0 ? mediaType : null,
    })
    .eq("id", venue.id);
  if (venueCoverErr) {
    return errorResponse(500, "VENUE_UPDATE_FAILED", venueCoverErr.message);
  }
  return jsonResponse(200, {
    kind: "ok",
    action: "sync_hero_media",
    place_pool_id: placePoolId,
    business_hero_video_present: mediaType === "video",
  });
}

async function handleSyncGallery(
  client: SupabaseClient,
  brand: OwnedBrand,
  venue: OwnedVenue,
  body: RequestBody,
): Promise<Response> {
  const placePoolId = body.place_pool_id ?? venue.place_pool_id;
  if (!isUuid(placePoolId)) {
    return errorResponse(400, "BAD_REQUEST", "place_pool_id is required");
  }
  // Client has already uploaded the photos to storage (brand_covers bucket, gated
  // by brand-id path). Here we just persist the resulting public URLs, de-duped,
  // http(s)-only, capped at GALLERY_MAX. This is the authoritative gallery write.
  const raw = Array.isArray(body.gallery_urls) ? body.gallery_urls : [];
  const cleaned = Array.from(
    new Set(
      raw.filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u)),
    ),
  ).slice(0, GALLERY_MAX);
  const { error } = await client
    .from("place_pool")
    .update({ business_gallery_urls: cleaned })
    .eq("id", placePoolId);
  if (error) return errorResponse(500, "PLACE_UPDATE_FAILED", error.message);
  return jsonResponse(200, {
    kind: "ok",
    action: "sync_gallery",
    place_pool_id: placePoolId,
    gallery_count: cleaned.length,
    gallery_min: GALLERY_MIN,
    gallery_max: GALLERY_MAX,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "POST required");
  }

  const userResult = await requireUser(req);
  if (userResult instanceof Response) return userResult;

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (!isUuid(body.brand_id)) {
    return errorResponse(400, "BAD_REQUEST", "brand_id must be a uuid");
  }
  // META-ORCH-1255 Leg A: venue_id is REQUIRED on every action (the pipeline
  // is one-row-per-venue). Validated at entry next to brand_id.
  if (!isUuid(body.venue_id)) {
    return errorResponse(400, "BAD_REQUEST", "venue_id must be a uuid");
  }
  const brand = await loadOwnedBrand(userResult.serviceClient, body.brand_id, userResult.userId);
  if (brand instanceof Response) return brand;
  const venue = await loadOwnedVenue(userResult.serviceClient, body.venue_id, brand);
  if (venue instanceof Response) return venue;

  try {
    if (body.action === "upsert_tier1_place") {
      return await handleTier1(userResult.serviceClient, userResult.userId, brand, venue, body);
    }
    if (body.action === "run_tier2_pipeline" || body.action === "regenerate_sales_bio") {
      return await handleTier2(userResult.serviceClient, brand, venue, body);
    }
    if (body.action === "confirm_ai_outputs") {
      return await handleConfirmAiOutputs(userResult.serviceClient, brand, venue, body);
    }
    if (body.action === "refresh_deck_readiness") {
      return await handleRefreshDeckReadiness(userResult.serviceClient, brand, venue, body);
    }
    if (body.action === "get_authoring_context") {
      return await handleGetAuthoringContext(userResult.serviceClient, brand, venue, body);
    }
    if (body.action === "sync_hero_media") {
      return await handleSyncHeroMedia(userResult.serviceClient, brand, venue, body);
    }
    if (body.action === "sync_gallery") {
      return await handleSyncGallery(userResult.serviceClient, brand, venue, body);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Pipeline failed";
    console.error("[run-business-place-authoring-pipeline]", msg.slice(0, 400));
    return errorResponse(500, "PIPELINE_FAILED", msg);
  }

  return errorResponse(400, "BAD_REQUEST", "Unknown action");
});
