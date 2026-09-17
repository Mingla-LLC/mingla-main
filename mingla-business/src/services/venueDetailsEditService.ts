/**
 * Issue #3386 — a host edits their venue's details.
 *
 * Seth's decisions (2026-09-15):
 *   1. Contact phone and email: edited directly, no review. The phone is saved
 *      as E.164 with the country it was typed under.
 *   2. Name, category and address while the venue is in review: edited
 *      directly. Mingla checks the latest values at approval.
 *   3. Name, category or address on a LIVE venue: sent to Mingla as a request.
 *      Guests keep seeing the current details until an admin approves. One
 *      request per venue; a new one replaces the old; the host can withdraw it.
 *
 * Every write is a SECURITY DEFINER RPC that checks event_manager+ on the brand
 * (supabase/migrations/20270710003386_issue_3386_venue_details_host_edit.sql).
 * The read goes through the existing brand-member SELECT policy on
 * `venue_listings`; guests never read this row, so the pending values never
 * reach a public surface.
 *
 * Kept apart from venueListingsService.ts on purpose: that file is a trigger
 * path for #2099's lane and its bundle budget, and nothing here changes it.
 */

import type { BrandClaimStatus, VenueCategory } from "../types/brand";
import { supabase } from "./supabase";

export type CoordinatePrecision = "exact" | "approximate";

export interface VenueAddressValue {
  address: string;
  city: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
  coordinatePrecision: CoordinatePrecision;
}

export interface VenueDetailsChangeRequest {
  requestId: string;
  status: "pending" | "rejected";
  name: string | null;
  venueCategory: VenueCategory | null;
  address: VenueAddressValue | null;
  requestedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export interface VenueDetailsForHost {
  id: string;
  brandId: string;
  name: string;
  venueCategory: VenueCategory;
  address: string | null;
  city: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  coordinatePrecision: CoordinatePrecision | null;
  contactPhone: string | null;
  contactPhoneCountryIso: string | null;
  contactEmail: string | null;
  claimStatus: BrandClaimStatus;
  changeRequest: VenueDetailsChangeRequest | null;
}

export interface VenueDetailsRow {
  id: string;
  brand_id: string;
  name: string;
  venue_category: string;
  address: string | null;
  city: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  coordinate_precision: string | null;
  contact_phone: string | null;
  contact_phone_country_iso: string | null;
  contact_email: string | null;
  claim_status: string;
  details_change_request_id: string | null;
  details_change_status: string | null;
  details_change_name: string | null;
  details_change_venue_category: string | null;
  details_change_address: string | null;
  details_change_city: string | null;
  details_change_country_code: string | null;
  details_change_lat: number | null;
  details_change_lng: number | null;
  details_change_coordinate_precision: string | null;
  details_change_requested_at: string | null;
  details_change_reviewed_at: string | null;
  details_change_rejection_reason: string | null;
}

export const VENUE_DETAILS_HOST_COLUMNS =
  "id, brand_id, name, venue_category, address, city, country_code, lat, lng, coordinate_precision, contact_phone, contact_phone_country_iso, contact_email, claim_status, details_change_request_id, details_change_status, details_change_name, details_change_venue_category, details_change_address, details_change_city, details_change_country_code, details_change_lat, details_change_lng, details_change_coordinate_precision, details_change_requested_at, details_change_reviewed_at, details_change_rejection_reason";

const asPrecision = (value: string | null): CoordinatePrecision | null =>
  value === "exact" || value === "approximate" ? value : null;

export function mapVenueDetailsRow(row: VenueDetailsRow): VenueDetailsForHost {
  let changeRequest: VenueDetailsChangeRequest | null = null;
  if (
    row.details_change_request_id !== null &&
    (row.details_change_status === "pending" ||
      row.details_change_status === "rejected")
  ) {
    const precision = asPrecision(row.details_change_coordinate_precision);
    const address =
      row.details_change_address !== null &&
      typeof row.details_change_lat === "number" &&
      typeof row.details_change_lng === "number" &&
      precision !== null
        ? {
            address: row.details_change_address,
            city: row.details_change_city,
            countryCode: row.details_change_country_code,
            lat: row.details_change_lat,
            lng: row.details_change_lng,
            coordinatePrecision: precision,
          }
        : null;
    changeRequest = {
      requestId: row.details_change_request_id,
      status: row.details_change_status,
      name: row.details_change_name,
      venueCategory: (row.details_change_venue_category as VenueCategory | null) ?? null,
      address,
      requestedAt: row.details_change_requested_at,
      reviewedAt: row.details_change_reviewed_at,
      rejectionReason: row.details_change_rejection_reason,
    };
  }
  return {
    id: row.id,
    brandId: row.brand_id,
    name: row.name,
    venueCategory: row.venue_category as VenueCategory,
    address: row.address,
    city: row.city,
    countryCode: row.country_code,
    lat: row.lat,
    lng: row.lng,
    coordinatePrecision: asPrecision(row.coordinate_precision),
    contactPhone: row.contact_phone,
    contactPhoneCountryIso: row.contact_phone_country_iso,
    contactEmail: row.contact_email,
    claimStatus: row.claim_status as BrandClaimStatus,
    changeRequest,
  };
}

/** The venue's own details for its host (brand-member RLS). Null when not visible. */
export async function fetchVenueDetailsForHost(
  venueId: string,
): Promise<VenueDetailsForHost | null> {
  const { data, error } = await supabase
    .from("venue_listings")
    .select(VENUE_DETAILS_HOST_COLUMNS)
    .eq("id", venueId)
    .maybeSingle<VenueDetailsRow>();
  if (error !== null) throw error;
  return data === null ? null : mapVenueDetailsRow(data);
}

/** A refusal from one of the #3386 RPCs, with the server's code kept intact. */
export class VenueDetailsEditError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(venueDetailsEditErrorCopy(code));
    this.name = "VenueDetailsEditError";
    this.code = code;
  }
}

const KNOWN_CODES = new Set([
  "not_authenticated",
  "forbidden",
  "venue_not_found",
  "venue_revoked",
  "contact_required",
  "invalid_phone",
  "phone_country_required",
  "phone_country_mismatch",
  "invalid_email",
  "venue_not_in_review",
  "venue_not_live",
  "invalid_name",
  "invalid_venue_category",
  "category_stay_change_not_supported",
  "address_required",
  "address_location_required",
  "invalid_location",
  "invalid_coordinate_precision",
  "nothing_to_change",
  "request_superseded",
]);

/** What a host reads for each refusal. Plain words; never a raw code. */
export function venueDetailsEditErrorCopy(code: string): string {
  switch (code) {
    case "not_authenticated":
      return "Sign in again to change your venue's details.";
    case "forbidden":
      return "Only a manager or owner of this brand can change venue details.";
    case "venue_not_found":
      return "We couldn't find this venue. Refresh and try again.";
    case "venue_revoked":
      return "This venue was removed from Mingla, so its details can't be changed.";
    case "contact_required":
      return "Add a phone number or an email so guests can reach you.";
    case "invalid_phone":
      return "That phone number doesn't look right. Check it and try again.";
    case "phone_country_required":
      return "Choose the country for this phone number.";
    case "phone_country_mismatch":
      return "That number doesn't match the country you picked. Check the country code next to the field.";
    case "invalid_email":
      return "That email address doesn't look right.";
    case "venue_not_in_review":
    case "venue_not_live":
      return "Your venue's status just changed. Refresh to see what you can change now.";
    case "invalid_name":
      return "Your venue's name needs 1 to 80 characters.";
    case "invalid_venue_category":
      return "Choose a category.";
    case "category_stay_change_not_supported":
      return "Moving a venue into or out of Stay needs Mingla. Use Request a change.";
    case "address_required":
    case "address_location_required":
    case "invalid_location":
    case "invalid_coordinate_precision":
      return "Search for the address and choose it from the list, so your map pin is right.";
    case "nothing_to_change":
      return "Nothing has changed yet.";
    case "request_superseded":
      return "That request was already replaced. Refresh to see the latest one.";
    default:
      return "Couldn't save your changes. Check your connection and try again.";
  }
}

/** Keep the server's refusal code when it is one we know; otherwise rethrow. */
export function toVenueDetailsEditError(error: { message?: string } | Error): Error {
  const message = (error.message ?? "").trim();
  if (KNOWN_CODES.has(message)) return new VenueDetailsEditError(message);
  return error instanceof Error ? error : new Error(message || "unknown_error");
}

export interface VenueContactInput {
  venueId: string;
  /** E.164, or null to clear the phone. */
  phoneE164: string | null;
  /** ISO 3166-1 alpha-2 the phone was typed under; ignored when the phone is null. */
  phoneCountryIso: string | null;
  email: string | null;
}

/** Decision 1 — contact phone and email, no review. */
export async function updateVenueContact(input: VenueContactInput): Promise<void> {
  const { error } = await supabase.rpc("biz_update_venue_contact", {
    p_venue_id: input.venueId,
    p_contact_phone: input.phoneE164 ?? "",
    p_contact_phone_country_iso:
      input.phoneE164 === null ? "" : input.phoneCountryIso ?? "",
    p_contact_email: input.email ?? "",
  });
  if (error !== null) throw toVenueDetailsEditError(error);
}

/** Only the fields that change. An address always carries its pin and precision. */
export interface VenueIdentityPatch {
  name?: string;
  venueCategory?: VenueCategory;
  address?: VenueAddressValue;
}

export function identityPatchToRpcArgs(
  venueId: string,
  patch: VenueIdentityPatch,
): Record<string, string | number | null> {
  return {
    p_venue_id: venueId,
    p_name: patch.name ?? null,
    p_venue_category: patch.venueCategory ?? null,
    p_address: patch.address?.address ?? null,
    p_city: patch.address === undefined ? null : patch.address.city ?? "",
    p_country_code:
      patch.address === undefined ? null : patch.address.countryCode ?? "",
    p_lat: patch.address?.lat ?? null,
    p_lng: patch.address?.lng ?? null,
    p_coordinate_precision: patch.address?.coordinatePrecision ?? null,
  };
}

/** Decision 2 — name, category and address while the venue is in review. */
export async function updateVenueIdentityInReview(
  venueId: string,
  patch: VenueIdentityPatch,
): Promise<{ changed: boolean }> {
  const { data, error } = await supabase.rpc(
    "biz_update_venue_identity_in_review",
    identityPatchToRpcArgs(venueId, patch),
  );
  if (error !== null) throw toVenueDetailsEditError(error);
  const changed =
    data !== null &&
    typeof data === "object" &&
    (data as { changed?: unknown }).changed === true;
  return { changed };
}

/** Decision 3 — a live venue's name, category or address, sent to Mingla. */
export async function submitVenueDetailsChangeRequest(
  venueId: string,
  patch: VenueIdentityPatch,
): Promise<{ requestId: string; replaced: boolean }> {
  const { data, error } = await supabase.rpc(
    "biz_submit_venue_details_change_request",
    identityPatchToRpcArgs(venueId, patch),
  );
  if (error !== null) throw toVenueDetailsEditError(error);
  const result = (data ?? {}) as { request_id?: unknown; replaced?: unknown };
  if (typeof result.request_id !== "string") {
    throw new Error("submitVenueDetailsChangeRequest: no request id returned");
  }
  return { requestId: result.request_id, replaced: result.replaced === true };
}

/** Withdraw the pending request, or dismiss a rejected one. */
export async function withdrawVenueDetailsChangeRequest(
  venueId: string,
  requestId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc(
    "biz_withdraw_venue_details_change_request",
    { p_venue_id: venueId, p_request_id: requestId },
  );
  if (error !== null) throw toVenueDetailsEditError(error);
}
