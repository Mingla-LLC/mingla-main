/**
 * Ve1 — Zustand draft for venue onboarding wizard + pre-wizard gates.
 *
 * META-ORCH-1009 Sub-E: now PERSISTED via AsyncStorage. Previously this was a
 * plain in-memory `create(...)`, so leaving the wizard (backgrounding the app,
 * navigating away, or a JS reload) wiped every field and the operator had to
 * start the multi-step venue from scratch. We now persist the draft data AND the
 * current wizard step so "Add a venue" resumes exactly where it stopped. The
 * draft is cleared on successful submit (VenueCreatorWizard) and on logout
 * (clearAllStores, Constitution #6).
 *
 * META-ORCH-1255 Leg B — PER-BRAND MULTI-DRAFT (v2, F-13c/R-5 fix). Venues now
 * attach to the operator's CURRENT brand, so two brands must be able to hold
 * concurrent in-progress drafts without colliding. Shape:
 *   - The top-level fields stay the ACTIVE working draft (step components keep
 *     their `useDraftVenueStore((s) => s.field)` selectors untouched).
 *   - `activeBrandId` names which brand owns the active fields.
 *   - `drafts` is the per-brand parking lot: `activateBrand(brandId)` stashes
 *     the current fields under the previous brand and loads (or blanks) the
 *     new brand's draft. `reset(brandId)` clears ONE brand's draft;
 *     `reset()` (no arg) wipes everything (logout, Constitution #6).
 *
 * ORCH-1263 [claim-adoption] — v3 (D-B copy-on-start adoption):
 *   - NEW `claim` block: an immutable snapshot of the seeded listing copied at
 *     "Yes, this is me" (I-PROPOSED-1263-CLAIM-ADOPTION-COPY-ON-START —
 *     pre-submit abandon leaves zero server writes; the snapshot only ever
 *     lives in this client draft).
 *   - NEW top-level `website` / `priceTiers` / `wantsReservations` (claim
 *     collects c6/c7/c8; the create path ignores them — website/price stay
 *     deck-readiness-owned for create, SC-12).
 *   - Provenance is COMPUTED, never stored (`provenanceFor` below): editing an
 *     adopted field flips its chip to Edited; reverting to the exact adopted
 *     value flips it back (DESIGN §3).
 *   - `photoUris` REMOVED (dead since the Sub-E cover-step removal — nothing
 *     read it downstream of the wizard).
 * Persist name bumped v2 → v3 (house precedent v1→v2); the v2 blob is
 * abandoned (prod-safe: pre-submit drafts only).
 *
 * Issue #1685 [venue-draft-multi] — DRAFT-ID-KEYED LIST (persist `version: 4`):
 *   - `drafts` was `Record<brandId, DraftVenueState>` — ONE parking slot per
 *     brand — which made `/venue/create` simultaneously the create door and the
 *     resume door, so pressing "+" silently resumed an abandoned draft in the
 *     middle of the wizard. It is now `DraftVenueEntry[]`, keyed by a client
 *     `dv_<ts36><rand6>` id, exactly like `draftEventStore`'s `DraftEvent[]`.
 *   - `activeDraftId` names which draft the top-level (active) fields hold.
 *   - `createDraft(brandId)` ALWAYS mints; it never reads an existing draft.
 *     `activateDraft(id, brandId)` is the ONLY resume path and refuses a
 *     cross-brand id (META-ORCH-1255 isolation).
 *   - `deleteActiveDraft()` replaces `reset(brandId)` on the submit path: under
 *     multi-draft, `reset(brandId)` destroys the brand's OTHER half-built venues.
 *   - The HOISTED-ACTIVE-DRAFT model is unchanged: the top-level fields stay the
 *     working draft and `drafts` holds only the PARKED ones, which is what keeps
 *     all 10 create steps and 11 claim steps byte-identical
 *     (`useDraftVenueStore((s) => s.field)` is the ABI this design preserves).
 *   - `DraftVenueState` itself is NOT modified — not one field.
 *   Invariants: I-PROPOSED-1685-CREATE-DOOR-NEVER-RESUMES,
 *   I-PROPOSED-1685-VENUE-DRAFTS-ARE-ID-KEYED-AND-BRAND-SCOPED.
 */

import { useMemo } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ThemeInput } from "@mingla/offering-rendering";

import type { BrandHourEntry, VenueCategory } from "../types/brand";
import { generateVenueDraftId } from "../utils/draftVenueId";
import { defaultBrandHoursWeek } from "../utils/venueBrandHours";

/**
 * ORCH-1263 — the copy-on-start snapshot of the seeded listing. IMMUTABLE
 * after prefill: chips and the review groups diff live fields against it.
 * `hours: []` means NO seeded hours (the grid then holds the default week and
 * renders no chip — an empty field with an "On Mingla" chip would be a lie).
 */
export interface DraftVenueClaimAdopted {
  name: string;
  address: string;
  hours: BrandHourEntry[];
  phone: string | null;
  website: string | null;
  priceTiers: string[];
  facets: Record<string, boolean | null>;
  summary: string | null;
  summarySource: "generative" | "editorial" | null;
  galleryUrls: string[];
  category: VenueCategory;
  categoryConfident: boolean;
  reservableHint: boolean;
}

export interface DraftVenueClaim {
  adopted: DraftVenueClaimAdopted;
  /**
   * The ordered c3 grid (= the public gallery order and the submit payload
   * order). Holds every photo currently in the gallery — adopted keeps AND
   * operator uploads — so "Make first" works on an upload too (DESIGN §6.4
   * orders the WHOLE grid). Provenance per tile is derived from membership:
   * adopted ⇔ url ∈ adopted.galleryUrls, New ⇔ url ∈ addedGalleryUrls.
   */
  keptGalleryUrls: string[];
  /** Operator uploads (`New` chips) — always a subset of keptGalleryUrls. */
  addedGalleryUrls: string[];
  /** c4 — THE mandatory decision. null until chosen; dock blocks on it. */
  coverChoice: {
    url: string;
    /** #1719 — stable still used for GIF/video shares; image falls back to url. */
    posterUrl?: string | null;
    type: "image" | "video" | "gif";
    isNew: boolean;
  } | null;
  /** false on "Continue anyway" — chips render only for arrived fields. */
  detailFetched: boolean;
  /** Copy-on-start timestamp — rides the tier-1 adoption payload (R-5). */
  adoptedAt: string;
}

export interface DraftVenueState {
  /** Ve2 — set when operator accepts a pool match card */
  placePoolId: string | null;
  /** Business / venue name typed at the place_pool gate */
  workingName: string;
  venueCategory: VenueCategory | null;
  displayName: string;
  slug: string;
  formattedAddress: string;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  countryCode: string | null;
  /**
   * Issue #1363 — how lat/lng was captured. Legacy values may be "exact";
   * selected-address resolution is "approximate"; null when unset. Rides
   * the create RPC + drives honest map rendering (no fabricated precision, rule
   * 9). Optional at the type level so a pre-1363 persisted v3 blob rehydrates via
   * `?? null` (additive — no persist-version bump).
   */
  coordinatePrecision?: "exact" | "approximate" | null;
  hours: BrandHourEntry[];
  contactEmail: string;
  contactPhone: string;
  /**
   * ORCH-1269 — ISO alpha-2 country for the c6 phone picker. Set by the claim
   * prefill (mapped from the adopted place's country) and by the operator's
   * manual picker choice; null = unknown (picker keeps its own default).
   * OPTIONAL at the type level ONLY so pinned pre-1269 full-literal test
   * drafts keep compiling (append-only gate — same precedent as PoolMatch's
   * 1263 fields); `initial`/`pickDraft` always carry it.
   */
  contactPhoneCountryIso?: string | null;
  tagline: string;
  description: string;
  /** ORCH-1263 — claim c6 website (create path ignores; deck-readiness owns). */
  website: string;
  /** ORCH-1263 — claim c7 price tiers. META-ORCH-1290 Leg B — the folded create
   *  wizard (s7) now collects these too (no longer deck-readiness-owned). */
  priceTiers: string[];
  /**
   * Issue #1384 source-money input only. These are unsaved input strings, not
   * server state; currency authority is fetched separately for every render
   * and submit.
   */
  discoveryPriceMinInput?: string;
  discoveryPriceMaxInput?: string;
  /** ORCH-1263 — claim c8 reservations intent (switch always starts OFF). */
  wantsReservations: boolean;
  /**
   * META-ORCH-1290 Leg B (D-1 folded create wizard) — the create path's own
   * photo gallery (s3) + cover choice (s4), collected IN the wizard now that the
   * post-submit deck-readiness leg is gone. Claim keeps its gallery/cover under
   * `claim.*` (adopted-photo provenance); these top-level fields are the
   * create-from-scratch equivalents (no adoption, no provenance). Optional at
   * the type level so a pre-1290 persisted blob (fields absent) rehydrates via
   * pickDraft's `?? []`/`?? null` — no persist-version bump needed.
   */
  galleryUrls?: string[];
  coverChoice?: {
    url: string;
    /** #1719 — optional only for backwards-compatible v3 draft hydration. */
    posterUrl?: string | null;
    type: "image" | "video" | "gif";
    isNew: boolean;
  } | null;
  /**
   * Issue #1467 — the own-brand pending venue row already created for this
   * submission saga. Persisted immediately after the create RPC so a failed
   * downstream Tier 1/gallery/currency step resumes this row instead of
   * inserting a duplicate. Optional for backwards-compatible v3 hydration.
   */
  submissionVenueId?: string | null;
  /**
   * issue #1564 — the venue's OWN theme override. `null` (and `undefined`, for
   * a pre-1564 persisted blob) means every axis is inherited from the brand,
   * which is what every venue in the pool is today.
   *
   * Held at the TOP level, not inside `claim`, because both wizards author it:
   * create at s4/s9 and claim at c4/c9. That mirrors `website` / `priceTiers` /
   * `wantsReservations`, which are also collected by both paths.
   *
   * Optional at the type level so a persisted v3 blob written before this
   * change rehydrates through `pickDraft`'s `?? null` — additive, exactly like
   * #1363's `coordinatePrecision` and META-ORCH-1290's `galleryUrls`, so no
   * persist-version bump is needed and no operator loses an in-progress draft.
   */
  themeOverrides?: ThemeInput | null;
  /**
   * Issue #1648 — place_pool ids this brand has already waved away on the s0
   * address match ("No, different business" / "Skip"). Held in the DRAFT, not
   * in component state, because s0 unmounts the moment they press Continue:
   * a ref would forget the answer and re-prompt on every visit back to the
   * address step.
   *
   * Optional at the type level so a persisted v3 blob written before this
   * change rehydrates through `pickDraft`'s `?? []` — additive, exactly like
   * #1363's `coordinatePrecision`, so no persist-version bump is needed and no
   * operator loses an in-progress draft.
   */
  dismissedPoolMatchIds?: string[];
  /** ORCH-1263 — non-null ⇔ claim mode (10-step wizard variant). */
  claim: DraftVenueClaim | null;
  /**
   * Current wizard step index (0-based) so re-entry resumes where the operator
   * stopped instead of always restarting at step 0. Owned here (not in the
   * wizard's local state) precisely so it survives a reload alongside the draft.
   */
  step: number;
}

const initial: DraftVenueState = {
  placePoolId: null,
  workingName: "",
  venueCategory: null,
  displayName: "",
  slug: "",
  formattedAddress: "",
  googlePlaceId: null,
  lat: null,
  lng: null,
  city: null,
  countryCode: null,
  coordinatePrecision: null,
  hours: defaultBrandHoursWeek(),
  contactEmail: "",
  contactPhone: "",
  contactPhoneCountryIso: null,
  tagline: "",
  description: "",
  website: "",
  priceTiers: [],
  discoveryPriceMinInput: "",
  discoveryPriceMaxInput: "",
  wantsReservations: false,
  galleryUrls: [],
  coverChoice: null,
  submissionVenueId: null,
  // issue #1564 — NOT SET is the default path: inherit the brand.
  themeOverrides: null,
  dismissedPoolMatchIds: [],
  claim: null,
  step: 0,
};

const blankDraft = (): DraftVenueState => ({
  ...initial,
  hours: defaultBrandHoursWeek(),
});

const pickDraft = (s: DraftVenueState): DraftVenueState => ({
  placePoolId: s.placePoolId,
  workingName: s.workingName,
  venueCategory: s.venueCategory,
  displayName: s.displayName,
  slug: s.slug,
  formattedAddress: s.formattedAddress,
  googlePlaceId: s.googlePlaceId,
  lat: s.lat,
  lng: s.lng,
  city: s.city,
  countryCode: s.countryCode,
  // Issue #1363 — `?? null` tolerates a pre-1363 persisted v3 blob (field absent).
  coordinatePrecision: s.coordinatePrecision ?? null,
  hours: s.hours,
  contactEmail: s.contactEmail,
  contactPhone: s.contactPhone,
  // ORCH-1269 — `?? null` tolerates a pre-1269 persisted v3 blob (field absent).
  contactPhoneCountryIso: s.contactPhoneCountryIso ?? null,
  tagline: s.tagline,
  description: s.description,
  website: s.website,
  priceTiers: s.priceTiers,
  discoveryPriceMinInput: s.discoveryPriceMinInput ?? "",
  discoveryPriceMaxInput: s.discoveryPriceMaxInput ?? "",
  wantsReservations: s.wantsReservations,
  // META-ORCH-1290 — `?? []`/`?? null` tolerates a pre-1290 persisted blob.
  galleryUrls: s.galleryUrls ?? [],
  coverChoice: s.coverChoice ?? null,
  submissionVenueId: s.submissionVenueId ?? null,
  // issue #1564 — `?? null` tolerates a pre-1564 persisted v3 blob (field
  // absent), and carries the venue's theme through the per-brand stash/restore
  // so switching brands mid-draft cannot silently drop a chosen colour.
  themeOverrides: s.themeOverrides ?? null,
  // Issue #1648 — `?? []` tolerates a persisted v3 blob written before the
  // field existed, and carries the s0 dismissals through the per-brand
  // stash/restore so switching brands mid-draft cannot resurrect a card the
  // operator already answered.
  dismissedPoolMatchIds: s.dismissedPoolMatchIds ?? [],
  // ORCH-1263 — the claim block must survive activateBrand stash/restore.
  claim: s.claim,
  step: s.step,
});

/** True when a draft has real operator progress worth resuming. */
export const draftVenueInProgress = (d: DraftVenueState): boolean =>
  d.displayName.trim().length > 0 ||
  d.workingName.trim().length > 0 ||
  (d.submissionVenueId ?? null) !== null ||
  d.step > 0;

// ─── ORCH-1263 — computed provenance (DESIGN §3; never stored) ──────────────

export type ProvenanceState = "adopted" | "edited" | "new";

export type ProvenanceField =
  | "category"
  | "name"
  | "address"
  | "hours"
  | "pitch"
  | "phone"
  | "website"
  | "price";

const sameHours = (a: BrandHourEntry[], b: BrandHourEntry[]): boolean => {
  if (a.length !== b.length) return false;
  const key = (rows: BrandHourEntry[]): string =>
    [...rows]
      .sort((x, y) => x.weekday - y.weekday)
      .map(
        (r) =>
          `${r.weekday}|${r.isClosed ? "c" : `${r.openTime ?? ""}-${r.closeTime ?? ""}`}`,
      )
      .join(";");
  return key(a) === key(b);
};

const sameTierSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

const textProvenance = (
  current: string,
  adopted: string | null,
): ProvenanceState | null => {
  const cur = current.trim();
  const adp = (adopted ?? "").trim();
  if (adp.length === 0) {
    return cur.length > 0 ? "new" : null;
  }
  if (cur.length === 0) return null;
  return cur === adp ? "adopted" : "edited";
};

/**
 * ORCH-1263 — live provenance for one field: `adopted` (came from the listing,
 * untouched), `edited` (adopted then changed), `new` (operator-added, nothing
 * seeded), null (no chip — nothing seeded and nothing entered, or the field's
 * variant renders chipless per the DESIGN). Reverting a field to the exact
 * adopted value flips the chip back (DESIGN §3 rules).
 */
export const provenanceFor = (
  field: ProvenanceField,
  d: DraftVenueState,
): ProvenanceState | null => {
  const claim = d.claim;
  if (claim === null) return null;
  const a = claim.adopted;
  switch (field) {
    case "category": {
      // DESIGN §6.1 — the unconfident variant is chipless (nothing was
      // honestly adopted; 34k silent "restaurant"s would be fabrication).
      if (!a.categoryConfident) return null;
      if (d.venueCategory === null) return null;
      return d.venueCategory === a.category ? "adopted" : "edited";
    }
    case "name":
      return textProvenance(d.displayName, a.name);
    case "address":
      return textProvenance(d.formattedAddress, a.address);
    case "hours": {
      if (a.hours.length === 0) return null;
      return sameHours(d.hours, a.hours) ? "adopted" : "edited";
    }
    case "pitch": {
      // OQ-2 — only OUR generative summary pre-fills the pitch; an editorial
      // (Google-authored) summary rides the snapshot as AI seed only, so the
      // textarea starts empty and stays chipless until the operator types.
      const surfaced =
        a.summarySource === "generative" && (a.summary ?? "").trim().length > 0
          ? a.summary
          : null;
      return textProvenance(d.description, surfaced);
    }
    case "phone":
      return textProvenance(d.contactPhone, a.phone);
    case "website":
      return textProvenance(d.website, a.website);
    case "price": {
      const hasSourceMoney = (d.discoveryPriceMinInput ?? "").trim().length > 0;
      if (hasSourceMoney) {
        return a.priceTiers.length > 0 ? "edited" : "new";
      }
      // Pre-#1384 claim drafts can still carry the legacy tier selection.
      // Preserve their review/provenance behavior until the operator replaces
      // the tier with an exact source-money range.
      if (a.priceTiers.length === 0) {
        return d.priceTiers.length > 0 ? "new" : null;
      }
      if (d.priceTiers.length === 0) return null;
      return sameTierSet(d.priceTiers, a.priceTiers) ? "adopted" : "edited";
    }
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
};

/**
 * Issue #1685 — ONE unfinished venue draft, addressable by its own client id.
 * Mirrors draftEventStore's DraftEvent list model. CLIENT-ONLY: a venue draft
 * NEVER has a server row before submit (I-PROPOSED-1263-CLAIM-ADOPTION-COPY-ON-START).
 */
export interface DraftVenueEntry {
  /** Client-minted `dv_<ts36><rand6>` (src/utils/draftVenueId.ts). Never a server id. */
  id: string;
  /**
   * META-ORCH-1255 — the brand that owns this draft. `null` ONLY for a draft
   * carried forward by the v3 -> v4 migrator out of a legacy blob that had no
   * `activeBrandId` (the #1461 unscoped-draft case); the first brand to activate
   * it stamps its id, and it is never null again.
   */
  brandId: string | null;
  /** ISO-8601. Set at mint; refreshed every time the entry is parked. Orders resume rows. */
  updatedAt: string;
  /** The draft payload — exactly the existing DraftVenueState, unchanged. */
  state: DraftVenueState;
}

interface DraftVenuePersisted extends DraftVenueState {
  /** META-ORCH-1255 — which brand owns the ACTIVE (top-level) draft fields. UNCHANGED. */
  activeBrandId: string | null;
  /** Issue #1685 — which draft id the top-level fields hold. null = no active draft. NEW. */
  activeDraftId: string | null;
  /** Issue #1685 — parked drafts. WAS `Record<string, DraftVenueState>`. */
  drafts: DraftVenueEntry[];
}

interface DraftVenueStore extends DraftVenuePersisted {
  /**
   * Issue #1685 — mint a FRESH draft for `brandId`, make it active, return its
   * id. NEVER reads or resumes an existing draft. This is the ONLY mint path,
   * and it is what makes the create door structurally incapable of resuming
   * (I-PROPOSED-1685-CREATE-DOOR-NEVER-RESUMES).
   */
  createDraft: (brandId: string) => string;
  /**
   * Issue #1685 — load an existing draft into the active fields. Returns false
   * (and changes nothing) when the id is unknown or owned by another brand.
   */
  activateDraft: (draftId: string, brandId: string) => boolean;
  /** Issue #1685 — read one draft (active or parked) without activating it. */
  getDraftEntry: (draftId: string) => DraftVenueEntry | null;
  /** Issue #1685 — delete ONE draft by id (active or parked). */
  deleteDraft: (draftId: string) => void;
  /** Issue #1685 — delete whatever draft is currently active. Submit-success path. */
  deleteActiveDraft: () => void;
  /**
   * META-ORCH-1255 — make `brandId`'s draft the active one: stash the current
   * fields under their own draft id, load (or blank) the brand's most recent
   * draft. No-op when already active. UNCHANGED observable semantics.
   *
   * Issue #1685 D-3 — this KEEPS its auto-resume behaviour and simply loses its
   * production caller: `app/venue/create.tsx` no longer calls it. The ambush
   * lived at the ROUTE, not in this primitive.
   */
  activateBrand: (brandId: string) => void;
  /**
   * Clear a draft. With `brandId`: EVERY draft of that brand (active or parked).
   * Without: EVERYTHING (logout — Constitution #6).
   *
   * Issue #1685 — the venue SUBMIT path must NOT use this: it would destroy the
   * operator's other half-built venues. Use `deleteActiveDraft()`.
   */
  reset: (brandId?: string) => void;
  patch: (p: Partial<DraftVenueState>) => void;
  setStep: (step: number) => void;
  setHoursRow: (weekday: number, part: Partial<BrandHourEntry>) => void;
  /** META-ORCH-1009 Sub-F WS3: apply one open/close patch to many days at once. */
  setHoursRows: (weekdays: number[], part: Partial<BrandHourEntry>) => void;
}

/**
 * Issue #1685 — park the ACTIVE top-level fields into the list under their own
 * id (replace by id when already present, else append). A no-op when there is
 * no active draft id: an id-less top-level blob is not addressable, so parking
 * it would mint an orphan nobody can resume.
 *
 * `adoptingBrandId` is the brand on whose behalf the park is happening, and it
 * is used ONLY when the active draft is UNOWNED (`activeBrandId === null`, i.e.
 * a migrated legacy unscoped draft — #1461). Parking such a draft as
 * `brandId: null` would strand it forever: `draftVenuesForBrand` filters on
 * `brandId`, so a null owner matches NO brand's resume rows and the half-built
 * venue becomes invisible to every surface until logout wipes it (the exact
 * silent loss this work item exists to prevent). Stamping the arriving brand at
 * park time IS the #1461 adoption rule — "the first brand to arrive owns an
 * unscoped draft" — applied at the moment ownership first becomes knowable.
 * An already-owned draft is NEVER re-stamped: that would be the cross-brand
 * leak META-ORCH-1255 Leg B forbids.
 */
const parkActive = (
  s: DraftVenuePersisted,
  list: DraftVenueEntry[],
  adoptingBrandId: string | null,
): DraftVenueEntry[] => {
  if (s.activeDraftId === null) return list;
  const entry: DraftVenueEntry = {
    id: s.activeDraftId,
    brandId: s.activeBrandId ?? adoptingBrandId,
    updatedAt: new Date().toISOString(),
    state: pickDraft(s),
  };
  const index = list.findIndex((e) => e.id === entry.id);
  if (index === -1) return [...list, entry];
  const next = [...list];
  next[index] = entry;
  return next;
};

/** Issue #1685 — newest-first by `updatedAt`; tie-break = later array position. */
const newestEntryForBrand = (
  list: DraftVenueEntry[],
  brandId: string,
): DraftVenueEntry | null => {
  let chosen: DraftVenueEntry | null = null;
  for (const entry of list) {
    if (entry.brandId !== brandId) continue;
    if (chosen === null || entry.updatedAt >= chosen.updatedAt) chosen = entry;
  }
  return chosen;
};

/**
 * Issue #1685 — the legacy (pre-v4) persisted shape: per-brand parking lot.
 */
type V3Persisted = DraftVenueState & {
  activeBrandId: string | null;
  drafts: Record<string, DraftVenueState>;
};

/**
 * Issue #1685 — v3 -> v4 migrator. Carries EVERY legacy draft forward with ZERO
 * field loss: each per-brand record entry becomes one list entry with a minted
 * id and its owning brand stamped, and the legacy top-level (active) draft stays
 * at top level and gains an id.
 *
 * MUST NEVER THROW — a throw out of `migrate` makes zustand discard the blob,
 * which is precisely the data loss this work item exists to prevent. Every
 * branch is defensive and the whole body is wrapped.
 */
function migrateDraftVenuePersisted(
  persistedState: unknown,
  version: number,
): DraftVenuePersisted {
  try {
    if (version >= 4) {
      // Terminal pattern (draftEventStore.ts:938): already current shape.
      return persistedState as DraftVenuePersisted;
    }
    const legacy = (persistedState ?? {}) as Partial<V3Persisted>;
    const now = new Date().toISOString();
    const carried: DraftVenueEntry[] = [];
    const legacyDrafts: unknown = legacy.drafts;
    if (Array.isArray(legacyDrafts)) {
      // Defensive: an already-list-shaped blob written by a newer build that
      // was rolled back. Carry every well-formed entry rather than dropping it.
      for (const raw of legacyDrafts) {
        const entry = raw as Partial<DraftVenueEntry> | null;
        if (
          entry === null ||
          typeof entry !== "object" ||
          typeof entry.id !== "string" ||
          entry.state === null ||
          typeof entry.state !== "object"
        ) {
          continue;
        }
        carried.push({
          id: entry.id,
          brandId: typeof entry.brandId === "string" ? entry.brandId : null,
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : now,
          state: pickDraft({ ...blankDraft(), ...entry.state }),
        });
      }
    } else if (typeof legacyDrafts === "object" && legacyDrafts !== null) {
      // The real v3 shape: Record<brandId, DraftVenueState>. Iteration order is
      // the record's own key order; `updatedAt` is identical across entries
      // because ordering among legacy drafts is not knowable and must not be
      // fabricated (Constitution #9).
      for (const [brandId, state] of Object.entries(
        legacyDrafts as Record<string, DraftVenueState>,
      )) {
        if (state === null || typeof state !== "object") continue;
        carried.push({
          id: generateVenueDraftId(),
          brandId,
          updatedAt: now,
          state: pickDraft({ ...blankDraft(), ...state }),
        });
      }
    }
    // `pickDraft` over a blank base materialises the additive-optional defaults
    // exactly as hydration does today, so no legacy field is dropped and no
    // absent field arrives as `undefined`.
    return {
      ...pickDraft({ ...blankDraft(), ...(legacy as DraftVenueState) }),
      activeBrandId: legacy.activeBrandId ?? null,
      activeDraftId: generateVenueDraftId(),
      drafts: carried,
    };
  } catch {
    // Never throw: a corrupt blob degrades to an empty, VALID shape rather than
    // taking the whole persisted store down with it.
    return {
      ...blankDraft(),
      activeBrandId: null,
      activeDraftId: null,
      drafts: [],
    };
  }
}

export const useDraftVenueStore = create<DraftVenueStore>()(
  persist(
    (set, get) => ({
      ...initial,
      activeBrandId: null,
      activeDraftId: null,
      drafts: [],
      createDraft: (brandId) => {
        // Minted BEFORE the set() only so the id can be returned synchronously;
        // it is not in `drafts`, so the prune below cannot see it.
        const id = generateVenueDraftId();
        set((s) => {
          // 1 — park whatever is currently active under its OWN id (nothing is
          //     lost by pressing "+", META-ORCH-1009 Sub-E). An UNOWNED active
          //     draft (a migrated legacy unscoped one) is adopted by this brand
          //     as it parks, so it stays reachable instead of becoming a draft
          //     no brand can see (#1461 adoption — see `parkActive`).
          const parked = parkActive(s, s.drafts, brandId);
          // 2 — prune litter: this brand's parked-but-EMPTY drafts. Replaces the
          //     old on-entry `venueDraftBrandToReset` garbage collection and is
          //     strictly better (id-precise and brand-scoped), so ten "+" presses
          //     with no typing leave at most the one active blank draft.
          const pruned = parked.filter(
            (e) => !(e.brandId === brandId && !draftVenueInProgress(e.state)),
          );
          // 3/4 — the fresh draft lives at TOP LEVEL until parked; it is never
          //       appended to `drafts` (this is the existing hoisted model).
          return {
            ...blankDraft(),
            activeBrandId: brandId,
            activeDraftId: id,
            drafts: pruned,
          };
        });
        return id;
      },
      activateDraft: (draftId, brandId) => {
        const s = get();
        if (s.activeDraftId === draftId) {
          // META-ORCH-1255 isolation boundary — CHECKED HERE FIRST, BEFORE the
          // "already active" success path. The requested draft being the ACTIVE
          // one does not make it this brand's draft: nothing in production calls
          // `activateBrand` any more, so `activeBrandId` keeps pointing at the
          // brand the operator last authored under while they browse Home under
          // another brand. Returning `true` on that state hands brand B the
          // open edit session of brand A's half-built venue — and the wizard
          // submits under `currentBrand`, so brand A's content would be filed
          // under brand B. Reachable on Business web by ordinary browser Back:
          // the draft id sits in the address bar (`/venue/create?draft=dv_…`).
          // SC-7 + I-PROPOSED-1685-VENUE-DRAFTS-ARE-ID-KEYED-AND-BRAND-SCOPED.
          if (s.activeBrandId !== null && s.activeBrandId !== brandId) {
            return false;
          }
          // Owned by this brand, or UNOWNED — a legacy unscoped draft, which the
          // arriving brand adopts exactly once (#1461). Do not weaken this to
          // fix the leak above: it is the only in-product path that gives a
          // migrated orphan an owner.
          if (s.activeBrandId === null) set({ activeBrandId: brandId });
          return true;
        }
        const entry = s.drafts.find((e) => e.id === draftId);
        if (entry === undefined) return false;
        // META-ORCH-1255 isolation boundary: brand B may never open brand A's
        // draft. A `null` brandId is a legacy migrated draft, adoptable once.
        if (entry.brandId !== null && entry.brandId !== brandId) return false;
        set((cur) => {
          const parked = parkActive(cur, cur.drafts, brandId);
          return {
            ...entry.state,
            activeBrandId: brandId,
            activeDraftId: draftId,
            drafts: parked.filter((e) => e.id !== draftId),
          };
        });
        return true;
      },
      getDraftEntry: (draftId) => {
        const s = get();
        if (s.activeDraftId === draftId) {
          return {
            id: draftId,
            brandId: s.activeBrandId,
            updatedAt: new Date().toISOString(),
            state: pickDraft(s),
          };
        }
        return s.drafts.find((e) => e.id === draftId) ?? null;
      },
      deleteDraft: (draftId) =>
        set((s) => {
          const drafts = s.drafts.filter((e) => e.id !== draftId);
          if (s.activeDraftId !== draftId) return { drafts };
          // `activeBrandId` is deliberately KEPT — this matches the existing
          // `reset(brandId)` behaviour for the active brand.
          return {
            ...blankDraft(),
            activeBrandId: s.activeBrandId,
            activeDraftId: null,
            drafts,
          };
        }),
      deleteActiveDraft: () => {
        const id = get().activeDraftId;
        if (id === null) return;
        get().deleteDraft(id);
      },
      activateBrand: (brandId) =>
        set((s) => {
          if (s.activeBrandId === brandId) return {};
          const chosen = newestEntryForBrand(s.drafts, brandId);
          // #1461 — current-brand resolution can legitimately happen after a
          // persisted, formerly-unscoped draft has hydrated. Adopt those live
          // top-level fields into the first arriving brand instead of replacing
          // the operator's in-progress venue with a blank draft. Deliberately
          // NOT parked first — that would duplicate the very draft being adopted.
          if (chosen === null && s.activeBrandId === null) {
            return {
              ...pickDraft(s),
              activeBrandId: brandId,
              activeDraftId: s.activeDraftId ?? generateVenueDraftId(),
              drafts: s.drafts,
            };
          }
          const parked = parkActive(s, s.drafts, brandId);
          if (chosen !== null) {
            return {
              ...chosen.state,
              activeBrandId: brandId,
              activeDraftId: chosen.id,
              drafts: parked.filter((e) => e.id !== chosen.id),
            };
          }
          // A blank active draft still gets an id: an id-less top-level blob
          // cannot be parked, so anything typed into it would be lost on the
          // next brand switch.
          return {
            ...blankDraft(),
            activeBrandId: brandId,
            activeDraftId: generateVenueDraftId(),
            drafts: parked,
          };
        }),
      reset: (brandId) =>
        set((s) => {
          if (brandId === undefined) {
            // Full wipe (logout / legacy no-arg callers).
            return {
              ...blankDraft(),
              activeBrandId: null,
              activeDraftId: null,
              drafts: [],
            };
          }
          const drafts = s.drafts.filter((e) => e.brandId !== brandId);
          if (s.activeBrandId === brandId || s.activeBrandId === null) {
            return {
              ...blankDraft(),
              activeBrandId: s.activeBrandId,
              activeDraftId: null,
              drafts,
            };
          }
          return { drafts };
        }),
      patch: (p) => set(p),
      setStep: (step) => set({ step }),
      setHoursRow: (weekday, part) =>
        set((s) => ({
          hours: s.hours.map((h) =>
            h.weekday === weekday ? { ...h, ...part } : h,
          ),
        })),
      setHoursRows: (weekdays, part) =>
        set((s) => {
          const set2 = new Set(weekdays);
          return {
            hours: s.hours.map((h) =>
              set2.has(h.weekday) ? { ...h, ...part } : h,
            ),
          };
        }),
    }),
    {
      // ORCH-1263 — v3: claim-adoption block + website/price/reservations;
      // photoUris dropped. v2 blob abandoned (pre-submit drafts, prod-safe).
      //
      // Issue #1685 — THE KEY IS DELIBERATELY UNCHANGED. Renaming it to
      // "-v4" would orphan every operator's in-progress draft on update, which
      // is exactly the loss this reshape exists to prevent. Shape changes are
      // carried by `version` + `migrate`, per the house precedent recorded at
      // draftEventStore.ts:790-791 ("renaming the storage key would orphan
      // existing user drafts"). "v4" in the operator ruling is the VERSION
      // NUMBER, not a new name.
      name: "mingla-business-draft-venue-v3",
      storage: createJSONStorage(() => AsyncStorage),
      // Issue #1685 — the store declared no `version` before, so every existing
      // blob carries `version: 0` in its envelope and routes through migrate().
      version: 4,
      migrate: migrateDraftVenuePersisted,
      // Only the data fields are persisted; the action functions are recreated on
      // each store init, so we partialize them out.
      partialize: (s): DraftVenuePersisted => ({
        ...pickDraft(s),
        activeBrandId: s.activeBrandId,
        activeDraftId: s.activeDraftId,
        drafts: s.drafts,
      }),
    },
  ),
);

/** Await the same persisted envelope Zustand writes after a draft mutation. */
export const flushDraftVenuePersistence = async (): Promise<void> => {
  const state = useDraftVenueStore.getState();
  const options = useDraftVenueStore.persist.getOptions();
  const storage = options.storage;
  if (!storage) throw new Error("draft_venue_storage_unavailable");
  if (typeof options.name !== "string") throw new Error("draft_venue_storage_name_unavailable");
  await storage.setItem(options.name, {
    state: {
      ...pickDraft(state),
      activeBrandId: state.activeBrandId,
      activeDraftId: state.activeDraftId,
      drafts: state.drafts,
    },
    version: 4,
  });
};

/**
 * META-ORCH-1255 — read a brand's draft regardless of active status (pure;
 * for `getState()` call sites and the to-do gate). UNCHANGED SIGNATURE.
 *
 * Issue #1685 — now returns the brand's MOST RECENT draft: the active one when
 * the brand owns it, else the newest parked entry, else a blank. The
 * `activeDraftId !== null` guard means an emptied active slot never hides a
 * real parked draft.
 */
export const draftVenueForBrand = (
  s: DraftVenuePersisted,
  brandId: string | null,
): DraftVenueState => {
  if (brandId === null) return blankDraft();
  if (s.activeBrandId === brandId && s.activeDraftId !== null) {
    return pickDraft(s);
  }
  const newest = newestEntryForBrand(s.drafts, brandId);
  return newest !== null ? newest.state : blankDraft();
};

/**
 * Issue #1685 — EVERY draft for a brand, newest first, active one included.
 * Returns them UNFILTERED; the caller applies `draftVenueInProgress`.
 */
export const draftVenuesForBrand = (
  s: DraftVenuePersisted,
  brandId: string | null,
): DraftVenueEntry[] => {
  if (brandId === null) return [];
  const parked = s.drafts
    .filter((e) => e.brandId === brandId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  if (s.activeDraftId === null) return parked;
  // Issue #1685 — an UNOWNED active draft (`activeBrandId === null`: a migrated
  // legacy unscoped draft, #1461) is offered to WHICHEVER brand is asking, so it
  // earns a "Finish adding …" row instead of sitting in storage where no surface
  // can ever show it. Tapping that row routes to `?draft=<id>`, which calls
  // `activateDraft(id, currentBrand)` and stamps the owner — the adoption
  // completes through the product's own resume path. An owned draft is NEVER
  // offered to another brand (META-ORCH-1255 Leg B).
  if (s.activeBrandId !== null && s.activeBrandId !== brandId) return parked;
  // The active draft is by definition the most recently touched, so it sorts
  // FIRST by construction rather than by a fabricated timestamp comparison.
  // `brandId` is reported exactly as the store holds it — `null` means UNOWNED,
  // never "owned by the asking brand": a read accessor must not invent
  // ownership the store has not stamped (Constitution #9).
  return [
    {
      id: s.activeDraftId,
      brandId: s.activeBrandId,
      updatedAt: new Date().toISOString(),
      state: pickDraft(s),
    },
    ...parked,
  ];
};

/**
 * Issue #1685 — resume rows for one brand.
 *
 * HARD requirement: this selects the RAW `drafts` array (stable reference) plus
 * SCALARS, and filters/derives in `useMemo`. Inlining
 * `s => draftVenuesForBrand(s, id)` returns a NEW array every render and
 * produces an infinite useSyncExternalStore loop — the identical hazard
 * documented on `useDraftsForBrand` (draftEventStore.ts:1180-1194).
 *
 * The scalars are exactly the fields that decide a resume row's existence
 * (`draftVenueInProgress`) and its label, so the memo recomputes precisely when
 * a row could change. The ACTIVE entry's `state` is read fresh via `getState()`
 * inside the memo — a REAL, complete `DraftVenueState`, never a synthesised or
 * partially-defaulted one (Constitution #9).
 */
export const useVenueDraftEntriesForBrand = (
  brandId: string | null,
): DraftVenueEntry[] => {
  const drafts = useDraftVenueStore((s) => s.drafts);
  const activeDraftId = useDraftVenueStore((s) => s.activeDraftId);
  const activeBrandId = useDraftVenueStore((s) => s.activeBrandId);
  const displayName = useDraftVenueStore((s) => s.displayName);
  const workingName = useDraftVenueStore((s) => s.workingName);
  const step = useDraftVenueStore((s) => s.step);
  const submissionVenueId = useDraftVenueStore((s) => s.submissionVenueId);
  return useMemo((): DraftVenueEntry[] => {
    if (brandId === null) return [];
    const parked = drafts
      .filter((e) => e.brandId === brandId)
      .sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
      );
    if (activeDraftId === null) return parked;
    // Issue #1685 — mirrors `draftVenuesForBrand`: an UNOWNED active draft
    // (`activeBrandId === null`, the migrated #1461 case) is offered to the
    // asking brand so it gets a resume row and can be adopted; an OWNED draft is
    // never offered to another brand (META-ORCH-1255 Leg B). `activeBrandId` is
    // already a subscribed scalar, so the memo recomputes when ownership is
    // stamped.
    if (activeBrandId !== null && activeBrandId !== brandId) return parked;
    return [
      {
        id: activeDraftId,
        brandId: activeBrandId,
        updatedAt: new Date().toISOString(),
        // The complete, REAL draft (never a synthesised or partially-defaulted
        // one), with the four subscribed scalars threaded through explicitly so
        // the row's existence and label are provably derived from what this
        // hook is subscribed to.
        //
        // WARNING for future consumers (#1685 F-5): every OTHER field here comes
        // from an UNSUBSCRIBED `getState()` read. The four threaded scalars are
        // exactly what decides a row's existence (`draftVenueInProgress`) and its
        // label, which is why this memo is correct today. If you start reading
        // another field off this entry (`venueCategory`, `formattedAddress`, …),
        // you MUST add its selector above and to the dep array, or you will
        // silently render a stale value. Do NOT subscribe to the whole draft
        // object: that returns a new reference every render and reintroduces the
        // useSyncExternalStore loop this hook exists to avoid (T-17).
        state: {
          ...pickDraft(useDraftVenueStore.getState()),
          displayName,
          workingName,
          step,
          submissionVenueId: submissionVenueId ?? null,
        },
      },
      ...parked,
    ];
  }, [
    activeBrandId,
    activeDraftId,
    brandId,
    displayName,
    drafts,
    step,
    submissionVenueId,
    workingName,
  ]);
};
