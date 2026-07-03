/**
 * Ve2 — apply pool match row to venue onboarding draft store fields.
 *
 * ORCH-1263 §B2 — two prefills now exist:
 *   - `prefillDraftFromPoolMatch(match)` — the LEAN fallback ("Continue
 *     anyway", DESIGN §4.2): whitelist search fields only, `claim` block set
 *     with `detailFetched: false` so chips render only for fields that DID
 *     arrive.
 *   - `prefillDraftFromAdoption(match, detail)` — the full copy-on-start
 *     adoption (D-B): everything lean does PLUS phone/website/price/summary/
 *     full gallery/facets/reservable hint, snapshotted immutably under
 *     `claim.adopted` so provenance chips + the c9 review groups can diff.
 * Category preselects ONLY on a confident mapping (DESIGN §6.1 / OQ-D7:
 * ambiguous — incl. drinks_and_music bars — arrives UNSELECTED).
 * OQ-2: `editorialSummary` (Google-authored) NEVER pre-fills the pitch
 * verbatim; it rides `claim.adopted.summary` as AI seed only. Our own
 * `generativeSummary` does pre-fill.
 */

import type { PoolAdoptionDetail, PoolMatch } from "../types/poolMatch";
import type {
  DraftVenueClaimAdopted,
  DraftVenueState,
} from "../store/draftVenueStore";
import { slugifyBrandSlug } from "./brandSlugify";
import { mapPoolOpeningHoursToBrandHours } from "./mapPoolOpeningHoursToBrandHours";

/** The four price tiers the wizard's c7 chips understand (consumer taxonomy). */
const KNOWN_PRICE_TIERS = new Set(["chill", "comfy", "bougie", "lavish"]);

const filterTiers = (tiers: string[]): string[] =>
  tiers.filter((t) => KNOWN_PRICE_TIERS.has(t));

export interface PoolMatchPrefill extends Partial<DraftVenueState> {
  /**
   * [TRANSITIONAL] legacy Ve2 field — the draft store dropped `photoUris`
   * (ORCH-1263 v3), but the pinned append-only suite
   * `src/utils/__tests__/prefillDraftFromPoolMatch.test.ts` asserts on it.
   * Call sites strip it before `patch(...)`. Exit condition: a
   * [TEST-MOD-APPROVED] ORCH retires the pinned assertion.
   */
  photoUris?: string[];
}

export function prefillDraftFromPoolMatch(
  match: PoolMatch,
): PoolMatchPrefill {
  const name = match.name.trim();
  const hours = mapPoolOpeningHoursToBrandHours(match.openingHours);
  const adopted: DraftVenueClaimAdopted = {
    name,
    address: match.address?.trim() ?? "",
    // [] = no seeded hours (default week renders chipless — DESIGN §3 rules).
    hours: match.openingHours === null ? [] : hours,
    phone: null,
    website: null,
    priceTiers: [],
    facets: {},
    summary: null,
    summarySource: null,
    galleryUrls: [...match.photoUrls],
    category: match.venueCategory,
    categoryConfident: match.venueCategoryConfident === true,
    reservableHint: false,
  };
  return {
    placePoolId: match.id,
    workingName: name,
    displayName: name,
    slug: slugifyBrandSlug(name),
    formattedAddress: match.address?.trim() ?? "",
    googlePlaceId: match.googlePlaceId,
    lat: match.lat,
    lng: match.lng,
    city: match.city,
    countryCode: match.country?.slice(0, 2) ?? null,
    // DESIGN §6.1 — preselect only a CONFIDENT mapping; an EXPLICIT false
    // (the live edge always sets the flag) arrives unselected. An ABSENT flag
    // = the pre-1263 response shape → legacy preselect (old-fn tolerance;
    // also keeps the pinned Ve2 prefill suite compiling against its
    // pre-1263 literal).
    venueCategory: match.venueCategoryConfident === false
      ? null
      : match.venueCategory,
    hours,
    contactEmail: "",
    contactPhone: "",
    tagline: "",
    description: "",
    website: "",
    priceTiers: [],
    wantsReservations: false,
    step: 0,
    claim: {
      adopted,
      keptGalleryUrls: [...match.photoUrls],
      addedGalleryUrls: [],
      coverChoice: null,
      detailFetched: false,
      adoptedAt: new Date().toISOString(),
    },
    photoUris: [...match.photoUrls],
  };
}

/**
 * ORCH-1263 §B2 — full adoption prefill (D-B copy-on-start), applied when the
 * detail fetch succeeds after "Yes, this is me".
 */
export function prefillDraftFromAdoption(
  match: PoolMatch,
  detail: PoolAdoptionDetail,
): PoolMatchPrefill {
  const name = detail.name.trim();
  const hours = mapPoolOpeningHoursToBrandHours(detail.openingHours);
  const generative = (detail.generativeSummary ?? "").trim();
  const editorial = (detail.editorialSummary ?? "").trim();
  const summary = generative.length > 0
    ? generative
    : editorial.length > 0
      ? editorial
      : null;
  const summarySource: "generative" | "editorial" | null =
    generative.length > 0
      ? "generative"
      : editorial.length > 0
        ? "editorial"
        : null;
  const priceTiers = filterTiers(detail.priceTiers);
  const adopted: DraftVenueClaimAdopted = {
    name,
    address: detail.address?.trim() ?? "",
    hours: detail.openingHours === null ? [] : hours,
    phone: detail.nationalPhoneNumber,
    website: detail.website,
    priceTiers,
    facets: { ...detail.facets },
    summary,
    summarySource,
    galleryUrls: [...detail.photoUrls],
    category: detail.venueCategory,
    categoryConfident: detail.venueCategoryConfident,
    reservableHint: detail.reservable,
  };
  return {
    placePoolId: match.id,
    workingName: name,
    displayName: name,
    slug: slugifyBrandSlug(name),
    formattedAddress: detail.address?.trim() ?? "",
    googlePlaceId: detail.googlePlaceId ?? match.googlePlaceId,
    lat: detail.lat,
    lng: detail.lng,
    city: detail.city,
    countryCode: detail.country?.slice(0, 2) ?? null,
    venueCategory: detail.venueCategoryConfident ? detail.venueCategory : null,
    hours,
    contactEmail: "",
    contactPhone: detail.nationalPhoneNumber ?? "",
    tagline: "",
    // OQ-2 — generative (our AI) pre-fills; editorial seeds AI context only.
    description: summarySource === "generative" ? (summary ?? "") : "",
    website: detail.website ?? "",
    priceTiers,
    wantsReservations: false,
    step: 0,
    claim: {
      adopted,
      keptGalleryUrls: [...detail.photoUrls],
      addedGalleryUrls: [],
      coverChoice: null,
      detailFetched: true,
      adoptedAt: new Date().toISOString(),
    },
    photoUris: [...detail.photoUrls],
  };
}
