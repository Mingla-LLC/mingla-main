/**
 * Issue #3386 — the rules behind the Venue details editor, kept pure so every
 * branch is provable without rendering.
 *
 * Which details a host can change, and how, follows Seth's 2026-09-15 decision:
 *
 *   | Venue status   | Contact (phone, email) | Name, category, address       |
 *   |----------------|------------------------|-------------------------------|
 *   | in review      | saved directly         | saved directly                |
 *   | live           | saved directly         | sent to Mingla for approval   |
 *   | rejected etc.  | saved directly         | "Request a change" email only |
 *   | removed        | not editable           | "Request a change" email only |
 *
 * Phone numbers use the app's one phone rule set (`composeE164` /
 * `phoneEntryHint` in utils/phone.ts — the same the venue wizard and checkout
 * use; after #3395 lands it delegates to @mingla/phone-input/phoneNumber), so
 * the editor never disagrees with the server's E.164 + country check.
 */

import type { BrandClaimStatus, VenueCategory } from "../../types/brand";
import type {
  VenueAddressValue,
  VenueDetailsForHost,
  VenueIdentityPatch,
} from "../../services/venueDetailsEditService";
import { composeE164, phoneEntryHint } from "../../utils/phone";
import { phoneCountryIsoFromPlaceCountry } from "../../utils/phoneCountryIsoFromPlaceCountry";

export type VenueIdentityEditMode = "direct" | "request" | "locked";

export function venueIdentityEditMode(
  claimStatus: BrandClaimStatus | null | undefined,
): VenueIdentityEditMode {
  if (claimStatus === "pending_review") return "direct";
  if (claimStatus === "verified") return "request";
  return "locked";
}

export function canEditVenueContact(
  claimStatus: BrandClaimStatus | null | undefined,
): boolean {
  return claimStatus !== undefined && claimStatus !== null && claimStatus !== "revoked";
}

export const VENUE_NAME_MAX = 80;

export const VENUE_CATEGORY_LABEL: Record<VenueCategory, string> = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & Arts",
  stay: "Stay",
};

export interface VenueIdentityDraft {
  name: string;
  venueCategory: VenueCategory;
  /** The address label on screen. */
  addressText: string;
  /** Set only by a pick (or a resolved typed address); null while editing. */
  address: VenueAddressValue | null;
}

/**
 * The form opens on what the host is asking for: the pending request's values
 * where it proposes them, the live values everywhere else. So re-opening a
 * pending request never silently drops the half the host is not touching.
 */
export function identityDraftFromVenue(venue: VenueDetailsForHost): VenueIdentityDraft {
  const pending =
    venue.changeRequest !== null && venue.changeRequest.status === "pending"
      ? venue.changeRequest
      : null;
  const liveAddress: VenueAddressValue | null =
    venue.address !== null &&
    venue.address.trim().length > 0 &&
    typeof venue.lat === "number" &&
    typeof venue.lng === "number"
      ? {
          address: venue.address,
          city: venue.city,
          countryCode: venue.countryCode,
          lat: venue.lat,
          lng: venue.lng,
          // A venue saved before #1363 has no precision; "approximate" is the
          // honest reading and is only sent if the host moves the pin.
          coordinatePrecision: venue.coordinatePrecision ?? "approximate",
        }
      : null;
  const address = pending?.address ?? liveAddress;
  return {
    name: pending?.name ?? venue.name,
    venueCategory: pending?.venueCategory ?? venue.venueCategory,
    addressText: address?.address ?? venue.address ?? "",
    address,
  };
}

/** A problem to show next to the form, or null when it can be saved. */
export function identityDraftProblem(
  venue: VenueDetailsForHost,
  draft: VenueIdentityDraft,
): string | null {
  const name = draft.name.trim();
  if (name.length === 0) return "Add your venue's name.";
  if (name.length > VENUE_NAME_MAX) {
    return `Keep your venue's name to ${VENUE_NAME_MAX} characters.`;
  }
  if (
    draft.venueCategory !== venue.venueCategory &&
    (draft.venueCategory === "stay" || venue.venueCategory === "stay")
  ) {
    return "Moving a venue into or out of Stay needs Mingla. Use Request a change.";
  }
  // #3407 — an address never saves without the pin it was picked with.
  if (draft.address === null) {
    return draft.addressText.trim().length === 0
      ? "Add your venue's address."
      : "Choose the address from the list so your map pin is right.";
  }
  return null;
}

const sameAddress = (
  a: VenueAddressValue | null,
  venue: VenueDetailsForHost,
): boolean =>
  a !== null &&
  a.address === (venue.address ?? "") &&
  a.lat === venue.lat &&
  a.lng === venue.lng &&
  (a.city ?? null) === (venue.city ?? null) &&
  (a.countryCode ?? null) === (venue.countryCode ?? null) &&
  a.coordinatePrecision === (venue.coordinatePrecision ?? "approximate");

/**
 * Only what differs from the LIVE venue. The server compares again, so a stale
 * screen can never write a value that did not change.
 */
export function identityPatchFromDraft(
  venue: VenueDetailsForHost,
  draft: VenueIdentityDraft,
): VenueIdentityPatch {
  const patch: VenueIdentityPatch = {};
  const name = draft.name.trim();
  if (name !== venue.name) patch.name = name;
  if (draft.venueCategory !== venue.venueCategory) {
    patch.venueCategory = draft.venueCategory;
  }
  if (draft.address !== null && !sameAddress(draft.address, venue)) {
    patch.address = { ...draft.address, address: draft.address.address.trim() };
  }
  return patch;
}

export const isEmptyIdentityPatch = (patch: VenueIdentityPatch): boolean =>
  patch.name === undefined &&
  patch.venueCategory === undefined &&
  patch.address === undefined;

// ── Contact ─────────────────────────────────────────────────────────────────

/** Same shape the server accepts (biz_update_venue_contact). */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Where the phone picker starts: the country the number was saved under, then
 * the venue's own country, then the brand's. Undefined keeps the field default.
 */
export function contactStartCountryIso(
  venue: Pick<VenueDetailsForHost, "contactPhoneCountryIso" | "countryCode">,
  brandCountryCode?: string | null,
): string | undefined {
  return (
    venue.contactPhoneCountryIso ??
    phoneCountryIsoFromPlaceCountry(venue.countryCode) ??
    phoneCountryIsoFromPlaceCountry(brandCountryCode ?? null) ??
    undefined
  );
}

/**
 * The local digits to show in the phone field. A saved E.164 number under its
 * own dial code shows without the code; anything older shows as it was saved,
 * so the host sees exactly what guests see today.
 */
export function contactPhoneLocalText(
  phone: string | null,
  dialCode: string | null,
): string {
  if (phone === null) return "";
  const trimmed = phone.trim();
  if (dialCode !== null && trimmed.startsWith(dialCode)) {
    return trimmed.slice(dialCode.length);
  }
  return trimmed;
}

export type ContactDraftResult =
  | {
      ok: true;
      phoneE164: string | null;
      phoneCountryIso: string | null;
      email: string | null;
    }
  | { ok: false; field: "phone" | "email" | "both"; message: string };

export function contactPayloadFromDraft(input: {
  phoneText: string;
  countryIso: string | null;
  dialCode: string | null;
  emailText: string;
}): ContactDraftResult {
  const phoneText = input.phoneText.trim();
  const email = input.emailText.trim();
  if (phoneText.length === 0 && email.length === 0) {
    return {
      ok: false,
      field: "both",
      message: "Add a phone number or an email so guests can reach you.",
    };
  }
  let phoneE164: string | null = null;
  if (phoneText.length > 0) {
    if (input.dialCode === null || input.countryIso === null) {
      return {
        ok: false,
        field: "phone",
        message: "Choose the country for this phone number.",
      };
    }
    phoneE164 = composeE164(input.dialCode, phoneText);
    if (phoneE164 === null) {
      return {
        ok: false,
        field: "phone",
        message: phoneEntryHint(input.dialCode, phoneText),
      };
    }
  }
  if (email.length > 0 && (email.length > 254 || !EMAIL_RE.test(email))) {
    return {
      ok: false,
      field: "email",
      message: "That email address doesn't look right.",
    };
  }
  return {
    ok: true,
    phoneE164,
    phoneCountryIso: phoneE164 === null ? null : input.countryIso,
    email: email.length > 0 ? email : null,
  };
}

// ── Read-only copy ──────────────────────────────────────────────────────────

export function formatVenueAddress(
  value: Pick<VenueAddressValue, "address" | "city"> | null,
): string | null {
  if (value === null || value.address.trim().length === 0) return null;
  const city = value.city?.trim() ?? "";
  return city.length > 0 && !value.address.includes(city)
    ? `${value.address}, ${city}`
    : value.address;
}

/** One line per proposed field, for the "Pending review" card. */
export function proposedChangeLines(
  venue: VenueDetailsForHost,
): { label: string; value: string }[] {
  const request = venue.changeRequest;
  if (request === null) return [];
  const lines: { label: string; value: string }[] = [];
  if (request.name !== null) lines.push({ label: "Name", value: request.name });
  if (request.venueCategory !== null) {
    lines.push({
      label: "Category",
      value: VENUE_CATEGORY_LABEL[request.venueCategory] ?? request.venueCategory,
    });
  }
  const address = formatVenueAddress(request.address);
  if (address !== null) lines.push({ label: "Address", value: address });
  return lines;
}
