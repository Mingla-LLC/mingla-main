/**
 * Ve1 + META-ORCH-1009 Sub-E — inline validation for venue wizard steps.
 *
 * ORCH-1263 [claim-adoption] — re-keyed to stable STEP IDs (spec §B0) and
 * extended with the claim variant's step model + dock-label + prefill math:
 *   create: s0 Address · s1 Name+slug · s2 Hours · s3 Contact · s4 Story ·
 *           s5 Review (rules byte-equal to pre-1263 except D-D below)
 *   claim:  c0 Category · c1 Place · c2 Hours · c3 Photos · c4 Cover ·
 *           c5 Pitch · c6 Contact · c7 Price · c8 Bookings · c9 Review
 *
 * D-D (I-PROPOSED-1263-OVERNIGHT-HOURS-VALID): `close < open` is a VALID
 * overnight span (22:00→02:00); ONLY `open === close` is rejected. The old
 * "Overnight hours … aren't supported yet" copy is dead.
 */

import type { DraftVenueState } from "../../store/draftVenueStore";
import type { BrandHourEntry } from "../../types/brand";
import { provenanceFor } from "../../store/draftVenueStore";
import { composeE164 } from "../../utils/phone";
import { COUNTRIES } from "../../../../packages/phone-input/countries";

// ─── Step model ─────────────────────────────────────────────────────────────

/** Structurally compatible with ui/Stepper's StepperStep. */
export interface VenueWizardStep {
  id: string;
  label: string;
  prefilled?: boolean;
}

const CREATE_STEPS: readonly VenueWizardStep[] = [
  { id: "s0", label: "Address" },
  { id: "s1", label: "Name" },
  { id: "s2", label: "Hours" },
  { id: "s3", label: "Contact" },
  { id: "s4", label: "Inputs" },
  { id: "s5", label: "Review" },
];

const CLAIM_STEPS: readonly VenueWizardStep[] = [
  { id: "c0", label: "Category" },
  { id: "c1", label: "Place" },
  { id: "c2", label: "Hours" },
  { id: "c3", label: "Photos" },
  { id: "c4", label: "Cover" },
  { id: "c5", label: "Pitch" },
  { id: "c6", label: "Contact" },
  { id: "c7", label: "Price" },
  { id: "c8", label: "Bookings" },
  { id: "c9", label: "Review" },
];

/** The fillable claim steps (c0–c8) — banner denominator (DESIGN §5.1). */
export const CLAIM_FILLABLE_TOTAL = 9;

export function venueWizardSteps(isClaim: boolean): VenueWizardStep[] {
  return (isClaim ? CLAIM_STEPS : CREATE_STEPS).map((s) => ({ ...s }));
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * D-D shared hours rule (both wizard arms; VenueSettingsModule mirrors the
 * same predicate): missing times on an open day → error; `open === close` →
 * error (24h venues out of scope); `close < open` = overnight, VALID.
 */
function hoursError(rows: BrandHourEntry[]): string | null {
  for (const h of rows) {
    if (h.isClosed) continue;
    const o = h.openTime ?? "";
    const c = h.closeTime ?? "";
    if (o.length === 0 || c.length === 0) {
      return "Open and close times are required for open days.";
    }
    if (o === c) {
      return "Open and close can't be the same time.";
    }
  }
  return null;
}

/** Loose URL shape for the optional claim website field (c6). */
const looksLikeUrl = (v: string): boolean =>
  /^(https?:\/\/)?[^\s/]+\.[^\s]{2,}$/i.test(v.trim());

/**
 * ORCH-1269 — dial code for the c6 picker's CURRENT country. Mirrors the
 * Input phone variant exactly: null/unknown ISO → the GB default. Shared
 * directory truth (`packages/phone-input/countries.ts`), no new table.
 */
const c6DialCode = (iso: string | null | undefined): string =>
  COUNTRIES.find((c) => c.code === (iso ?? "GB").toUpperCase())?.dialCode ??
  "+44";

export function venueStepError(
  stepId: string,
  d: DraftVenueState,
): string | null {
  switch (stepId) {
    // ── create path (rules unchanged except D-D in hoursError) ─────────────
    case "s0":
      if (d.formattedAddress.trim().length === 0) return "Address is required.";
      if (d.lat === null || d.lng === null) return "Address is missing location.";
      return null;
    case "s1": {
      if (d.displayName.trim().length === 0) return "Venue name is required.";
      if (d.slug.trim().length === 0) return "URL slug is required.";
      return null;
    }
    case "s2":
      return hoursError(d.hours);
    case "s3": {
      const em = d.contactEmail.trim();
      const ph = d.contactPhone.trim();
      if (em.length === 0 && ph.length === 0) {
        return "Add an email or phone number.";
      }
      return null;
    }
    case "s4": {
      const bio = d.description.trim();
      if (bio.length < 20) {
        return "Description must be at least 20 characters.";
      }
      return null;
    }
    case "s5":
      return null; // Review — submit handled separately

    // ── claim path (ORCH-1263 §B4) ──────────────────────────────────────────
    case "c0":
      return d.venueCategory === null ? "Pick a category to continue." : null;
    case "c1": {
      if (d.formattedAddress.trim().length === 0) return "Address is required.";
      if (d.lat === null || d.lng === null) return "Address is missing location.";
      if (d.displayName.trim().length === 0) return "Venue name is required.";
      if (d.slug.trim().length === 0) return "URL slug is required.";
      return null;
    }
    case "c2":
      return hoursError(d.hours);
    case "c3":
      return null; // GALLERY_MIN is enforced at go-live, not at claim.
    case "c4":
      return d.claim?.coverChoice == null ? "Pick a cover to continue" : null;
    case "c5": {
      // Binding: the claim pitch may be EMPTY (59% seeded-empty; the AI pitch
      // flow still exists post-submit). If text is entered, ≥20 chars.
      const bio = d.description.trim();
      if (bio.length === 0) return null;
      if (bio.length < 20) {
        return "Your pitch needs at least 20 characters — or clear it for now.";
      }
      return null;
    }
    case "c6": {
      const em = d.contactEmail.trim();
      const ph = d.contactPhone.trim();
      if (em.length === 0 && ph.length === 0) {
        return "Add an email or phone number.";
      }
      // ORCH-1269 belt-and-braces — a phone that cannot compose to E.164
      // under the picker's current country never leaves this step (blocks
      // storing a mangled number; the s3 create rule is untouched).
      if (
        ph.length > 0 &&
        composeE164(c6DialCode(d.contactPhoneCountryIso), ph) === null
      ) {
        return "That phone number doesn't look right — check it.";
      }
      const web = d.website.trim();
      if (web.length > 0 && !looksLikeUrl(web)) {
        return "That website doesn't look like a link — check it.";
      }
      return null;
    }
    case "c7":
      return d.priceTiers.length === 0 ? "Pick at least one price range." : null;
    case "c8":
      return null; // Off is a valid keep — this step can never block.
    case "c9":
      return null; // Review — submit handled separately
    default:
      return null;
  }
}

// ─── Claim prefill math (banner `n` + stepper prefilled dots) ───────────────

/**
 * True when a claim step's ADOPTED payload exists AND passes that step's
 * validation (DESIGN §5.1 — live math, never a constant). c4 (Cover) is never
 * prefilled by definition (0% of seeded places have covers).
 */
export function claimStepPrefilled(
  stepId: string,
  d: DraftVenueState,
): boolean {
  const a = d.claim?.adopted;
  if (a === undefined || a === null) return false;
  switch (stepId) {
    case "c0":
      return a.categoryConfident;
    case "c1":
      return a.name.trim().length > 0 && a.address.trim().length > 0;
    case "c2":
      return a.hours.length > 0 && hoursError(a.hours) === null;
    case "c3":
      return a.galleryUrls.length > 0;
    case "c5":
      // Only OUR generative summary pre-fills the textarea (OQ-2).
      return (
        a.summarySource === "generative" &&
        (a.summary ?? "").trim().length >= 20
      );
    case "c6":
      return (a.phone ?? "").trim().length > 0;
    case "c7":
      return a.priceTiers.length > 0;
    case "c8":
      return a.reservableHint;
    default:
      return false;
  }
}

/** Banner `n` — count of steps c0–c8 whose adopted payload passes validation. */
export function claimPrefilledStepCount(d: DraftVenueState): number {
  return ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].filter((id) =>
    claimStepPrefilled(id, d),
  ).length;
}

// ─── Half-claim submit plan (D-C/R-7 — resume-not-recreate, DESIGN §8.3) ────

export type ClaimSubmitPlan =
  | { kind: "create" }
  | { kind: "resume"; venueId: string }
  | { kind: "already-submitted"; venueId: string };

/**
 * Pure decision for the claim submit pre-check (T-B6): an own listing row
 * with tier-1 incomplete = the earlier submit died mid-flight → RESUME the
 * venue row (skip createVenue, re-run tier-1 only). Tier-1 complete = the
 * claim is already in review → route to the venue, never a duplicate submit.
 * No own row → normal create.
 */
export function resolveClaimSubmitPlan(
  ownListingId: string | null,
  tier1CompletedAt: string | null,
): ClaimSubmitPlan {
  if (ownListingId === null) return { kind: "create" };
  if (tier1CompletedAt === null) {
    return { kind: "resume", venueId: ownListingId };
  }
  return { kind: "already-submitted", venueId: ownListingId };
}

// ─── Dock CTA labels (DESIGN §5.3 — the zero-effort keep affordance) ────────

/** Has the operator changed THIS step away from its adopted payload? */
function claimStepChanged(stepId: string, d: DraftVenueState): boolean {
  const claim = d.claim;
  if (claim === null) return false;
  const a = claim.adopted;
  const p = (f: Parameters<typeof provenanceFor>[0]): string | null =>
    provenanceFor(f, d);
  switch (stepId) {
    case "c0":
      return p("category") === "edited";
    case "c1":
      return p("name") === "edited" || p("address") === "edited";
    case "c2":
      return p("hours") === "edited";
    case "c3": {
      const kept = claim.keptGalleryUrls;
      const untouched =
        claim.addedGalleryUrls.length === 0 &&
        kept.length === a.galleryUrls.length &&
        kept.every((u, i) => u === a.galleryUrls[i]);
      return !untouched;
    }
    case "c5":
      return p("pitch") === "edited" || p("pitch") === "new";
    case "c6":
      return (
        p("phone") === "edited" ||
        p("phone") === "new" ||
        p("website") === "edited" ||
        p("website") === "new" ||
        d.contactEmail.trim().length > 0
      );
    case "c7":
      return p("price") === "edited" || p("price") === "new";
    case "c8":
      return d.wantsReservations;
    default:
      return false;
  }
}

/**
 * Primary dock label for a claim step (DESIGN §5.3):
 *  - arrived adopted AND untouched AND valid → "Keep & continue"
 *  - operator changed anything this step     → "Save & continue"
 *  - nothing adopted for this step           → "Continue"
 *  - c4 always "Continue" (disabled until a cover is chosen)
 *  - c9 → "Submit for review" (review owns its own button; dock hidden there)
 */
export function claimDockLabel(stepId: string, d: DraftVenueState): string {
  if (stepId === "c9") return "Submit for review";
  if (stepId === "c4") return "Continue";
  // DESIGN §6.9 — c8's off-state is itself a valid keep (never blocks).
  if (stepId === "c8") {
    return claimStepChanged(stepId, d) ? "Save & continue" : "Keep & continue";
  }
  if (claimStepChanged(stepId, d)) return "Save & continue";
  if (
    claimStepPrefilled(stepId, d) &&
    venueStepError(stepId, d) === null
  ) {
    return "Keep & continue";
  }
  return "Continue";
}
