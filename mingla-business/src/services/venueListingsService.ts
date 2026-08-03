/**
 * META-ORCH-1255 Leg B — venue-listings service (first-class venue rows).
 *
 * A venue listing is a `public.venue_listings` ROW under the operator's
 * CURRENT brand — creation NEVER inserts a brands row
 * (I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE). Reads go through the
 * owner-member RLS SELECT policy on `venue_listings`; the create goes through
 * the SECURITY DEFINER RPC `biz_create_venue_listing` (Leg A M4), which
 * validates inputs, inserts the venue row `pending_review`, writes the 7
 * `brand_hours` rows and the per-venue pipeline row, and returns the new
 * venue id.
 *
 * Arg mapping mirrors the retired hidden-brand create path in
 * `brandsService.createVenueBrandPendingReview` (23505 → SlugCollisionError /
 * duplicate-place copy), with the AppsFlyer event renamed
 * `mingla_venue_listing_submitted`.
 */

import type { BrandClaimStatus, BrandHourEntry, VenueCategory } from "../types/brand";
import { brandHoursToRpcPayload } from "../utils/venueBrandHours";
import { logAppsFlyerEvent } from "./appsFlyerService";
import { SlugCollisionError } from "./brandsService";
import { supabase } from "./supabase";

export interface VenueListing {
  id: string;
  brandId: string;
  placePoolId: string | null;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  countryCode: string | null;
  venueCategory: VenueCategory;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  claimStatus: BrandClaimStatus;
  claimFollowUpAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface VenueListingRow {
  id: string;
  brand_id: string;
  place_pool_id: string | null;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  country_code: string | null;
  venue_category: string;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  claim_status: string;
  claim_follow_up_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

/**
 * ORCH-1263 — `venue_listings_place_uniq` 23505: the place already has a
 * listing row (any claim state). The claim wizard branches own-vs-foreign on
 * this; every other consumer still sees the same friendly message.
 */
export class PlaceClaimConflictError extends Error {
  constructor() {
    super(
      "This place is already in our verification queue. Contact support if you need help.",
    );
    this.name = "PlaceClaimConflictError";
  }
}

const VENUE_LISTING_COLUMNS =
  "id, brand_id, place_pool_id, slug, name, address, city, country_code, venue_category, cover_media_url, cover_media_type, claim_status, claim_follow_up_at, rejection_reason, created_at";

const mapRow = (row: VenueListingRow): VenueListing => ({
  id: row.id,
  brandId: row.brand_id,
  placePoolId: row.place_pool_id,
  slug: row.slug,
  name: row.name,
  address: row.address,
  city: row.city,
  countryCode: row.country_code,
  venueCategory: row.venue_category as VenueCategory,
  coverMediaUrl: row.cover_media_url,
  coverMediaType: row.cover_media_type,
  claimStatus: row.claim_status as BrandClaimStatus,
  claimFollowUpAt: row.claim_follow_up_at,
  rejectionReason: row.rejection_reason,
  createdAt: row.created_at,
});

/** All venue listings of a brand (any claim state), oldest first. */
export async function fetchVenueListings(
  brandId: string,
): Promise<VenueListing[]> {
  const { data, error } = await supabase
    .from("venue_listings")
    .select(VENUE_LISTING_COLUMNS)
    .eq("brand_id", brandId)
    .order("created_at", { ascending: true })
    .returns<VenueListingRow[]>();
  if (error !== null) throw error;
  return (data ?? []).map(mapRow);
}

/** One venue listing by id (owner-member RLS). Null when absent/not visible. */
export async function fetchVenueListing(
  venueId: string,
): Promise<VenueListing | null> {
  const { data, error } = await supabase
    .from("venue_listings")
    .select(VENUE_LISTING_COLUMNS)
    .eq("id", venueId)
    .maybeSingle<VenueListingRow>();
  if (error !== null) throw error;
  return data === null ? null : mapRow(data);
}

/**
 * ORCH-1263 §B1 (R-10 resume probe) — the CURRENT brand's own listing for a
 * place, if any (own-RLS read). Powers the half-claim resume-not-recreate
 * pre-check (SC-10): an own row + incomplete tier-1 means the earlier submit
 * died mid-flight and the retry must reuse the venue row, never re-insert.
 */
export async function findOwnListingForPlace(
  brandId: string,
  placePoolId: string,
): Promise<VenueListing | null> {
  const { data, error } = await supabase
    .from("venue_listings")
    .select(VENUE_LISTING_COLUMNS)
    .eq("brand_id", brandId)
    .eq("place_pool_id", placePoolId)
    .maybeSingle<VenueListingRow>();
  if (error !== null) throw error;
  return data === null ? null : mapRow(data);
}

export interface CreateVenueListingInput {
  brandId: string;
  name: string;
  slug: string;
  tagline?: string;
  description?: string;
  placePoolId?: string | null;
  googlePlaceId?: string | null;
  lat: number;
  lng: number;
  city: string | null;
  countryCode: string | null;
  /** Issue #1363 — legacy "exact", selected-address "approximate", or null. */
  coordinatePrecision?: "exact" | "approximate" | null;
  address: string;
  venueCategory: VenueCategory;
  contact: { email?: string; phone?: string };
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  hours: BrandHourEntry[];
}

/**
 * Create a venue listing under the CURRENT brand via `biz_create_venue_listing`
 * and fire the claim-submitted email. Returns the new venue id.
 */
export async function createVenueListing(
  input: CreateVenueListingInput,
): Promise<string> {
  const description = [input.tagline, input.description]
    .map((s) => s?.trim())
    .filter((s): s is string => s !== undefined && s.length > 0)
    .join("\n\n");
  const { data, error } = await supabase.rpc("biz_create_venue_listing", {
    p_brand_id: input.brandId,
    p_name: input.name,
    p_slug: input.slug,
    p_description: description,
    p_google_place_id: input.googlePlaceId ?? "",
    p_lat: input.lat,
    p_lng: input.lng,
    p_city: input.city ?? "",
    p_country_code: input.countryCode ?? "",
    p_address: input.address,
    p_venue_category: input.venueCategory,
    p_contact_email: input.contact.email ?? "",
    p_contact_phone: input.contact.phone ?? "",
    p_cover_media_url: input.coverMediaUrl ?? "",
    p_cover_media_type: input.coverMediaType ?? "",
    p_hours: brandHoursToRpcPayload(input.hours),
    p_place_pool_id: input.placePoolId ?? null,
    // Issue #1363 — empty string → NULL server-side (RPC default); an unknown
    // value is ignored server-side so a stale client never breaks venue create.
    p_coordinate_precision: input.coordinatePrecision ?? "",
  });

  if (error !== null) {
    const msg = error.message ?? "";
    if (error.code === "23505") {
      if (msg.includes("slug")) {
        throw new SlugCollisionError(input.slug);
      }
      // venue_listings_place_uniq — the place is already claimed by a listing.
      // ORCH-1263 — typed so the claim wizard's 23505 backstop can branch
      // own-row (resume, DESIGN §8.3) vs foreign (§8.2 card) without string
      // matching. Message unchanged for pre-1263 consumers.
      throw new PlaceClaimConflictError();
    }
    throw error;
  }
  if (data === null || typeof data !== "string") {
    throw new Error("createVenueListing: RPC returned no venue id");
  }

  const venueId = data;
  logAppsFlyerEvent("mingla_venue_listing_submitted", { venue_id: venueId });
  await invokeVenueClaimSubmittedEmail(venueId);
  return venueId;
}

/**
 * Fire-and-forget claim-submitted email (Leg A re-keyed the edge fn body to
 * `{ venue_id }`). Failures are logged, never blocking the create flow.
 */
export async function invokeVenueClaimSubmittedEmail(
  venueId: string,
): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke(
      "venue-claim-submitted-email",
      { body: { venue_id: venueId } },
    );
    if (error !== null) {
      console.warn("[invokeVenueClaimSubmittedEmail]", error.message);
    }
  } catch (e) {
    console.warn("[invokeVenueClaimSubmittedEmail]", e);
  }
}
