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
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { BrandHourEntry, VenueCategory } from "../types/brand";
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
    type: "image" | "video" | "gif";
    isNew: boolean;
  } | null;
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
  // ORCH-1263 — the claim block must survive activateBrand stash/restore.
  claim: s.claim,
  step: s.step,
});

/** True when a draft has real operator progress worth resuming. */
export const draftVenueInProgress = (d: DraftVenueState): boolean =>
  d.displayName.trim().length > 0 ||
  d.workingName.trim().length > 0 ||
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
      .map((r) => `${r.weekday}|${r.isClosed ? "c" : `${r.openTime ?? ""}-${r.closeTime ?? ""}`}`)
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

interface DraftVenuePersisted extends DraftVenueState {
  /** META-ORCH-1255 — which brand owns the ACTIVE (top-level) draft fields. */
  activeBrandId: string | null;
  /** META-ORCH-1255 — parked drafts of the NON-active brands. */
  drafts: Record<string, DraftVenueState>;
}

interface DraftVenueStore extends DraftVenuePersisted {
  /**
   * META-ORCH-1255 — make `brandId`'s draft the active one: stash the current
   * fields under the previous brand, load (or blank) the new brand's draft.
   * No-op when already active.
   */
  activateBrand: (brandId: string) => void;
  /**
   * Clear a draft. With `brandId`: only that brand's draft (active or parked).
   * Without: EVERYTHING (logout — Constitution #6).
   */
  reset: (brandId?: string) => void;
  patch: (p: Partial<DraftVenueState>) => void;
  setStep: (step: number) => void;
  setHoursRow: (weekday: number, part: Partial<BrandHourEntry>) => void;
  /** META-ORCH-1009 Sub-F WS3: apply one open/close patch to many days at once. */
  setHoursRows: (weekdays: number[], part: Partial<BrandHourEntry>) => void;
}

export const useDraftVenueStore = create<DraftVenueStore>()(
  persist(
    (set) => ({
      ...initial,
      activeBrandId: null,
      drafts: {},
      activateBrand: (brandId) =>
        set((s) => {
          if (s.activeBrandId === brandId) return {};
          const drafts = { ...s.drafts };
          if (s.activeBrandId !== null) {
            drafts[s.activeBrandId] = pickDraft(s);
          }
          const next = drafts[brandId] ?? blankDraft();
          delete drafts[brandId];
          return { ...next, activeBrandId: brandId, drafts };
        }),
      reset: (brandId) =>
        set((s) => {
          if (brandId === undefined) {
            // Full wipe (logout / legacy no-arg callers).
            return { ...blankDraft(), activeBrandId: null, drafts: {} };
          }
          const drafts = { ...s.drafts };
          delete drafts[brandId];
          if (s.activeBrandId === brandId || s.activeBrandId === null) {
            return { ...blankDraft(), activeBrandId: s.activeBrandId, drafts };
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
      name: "mingla-business-draft-venue-v3",
      storage: createJSONStorage(() => AsyncStorage),
      // Only the data fields are persisted; the action functions are recreated on
      // each store init, so we partialize them out.
      partialize: (s): DraftVenuePersisted => ({
        ...pickDraft(s),
        activeBrandId: s.activeBrandId,
        drafts: s.drafts,
      }),
    },
  ),
);

/**
 * META-ORCH-1255 — read a brand's draft regardless of active status (pure;
 * for `getState()` call sites and the to-do gate).
 */
export const draftVenueForBrand = (
  s: DraftVenuePersisted,
  brandId: string | null,
): DraftVenueState => {
  if (brandId === null) return blankDraft();
  if (s.activeBrandId === brandId) return pickDraft(s);
  return s.drafts[brandId] ?? blankDraft();
};
