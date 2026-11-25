/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 5
 *
 * Shared types for the experience creator wizard's Stops + Pricing steps.
 * Kept in a leaf module so the steps + the wizard host import a single source
 * (avoids a circular import).
 */

export type ExperienceLocationMode = "single" | "per_stop";
export type ExperiencePricingMode = "whole" | "per_stop";

/** issue #3281 R2 — sellable unit beside a price option. */
export type ExperiencePriceBasis = "person" | "group" | "block";

/**
 * issue #3281 R2 — hire block length (minutes). #4490: longer blocks (up to a
 * working day) so a lane, studio or room can be hired by the half day.
 */
export type ExperienceBlockMinutes =
  | 15 | 30 | 45 | 60 | 90 | 120 | 180 | 240 | 360 | 480;

export const EXPERIENCE_BLOCK_MINUTES: readonly ExperienceBlockMinutes[] = [
  15, 30, 45, 60, 90, 120, 180, 240, 360, 480,
];

/** #4490 — narrow a stored block length to a wizard choice (null = not one). */
export const toExperienceBlockMinutes = (
  value: number | null | undefined,
): ExperienceBlockMinutes | null => {
  const match = EXPERIENCE_BLOCK_MINUTES.find((m) => m === value);
  return match === undefined ? null : match;
};

/** #4490 — compact block-length label for the wizard's choice row. */
export const experienceBlockPillLabel = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

/**
 * issue #3281 R2 — one host-authored price option (maps to a ticket_types row).
 * `soldCount` is client-only: options with sales may be hidden, never removed.
 */
export interface ExperiencePriceOptionDraft {
  clientId: string;
  /** Persisted ticket_types.id when editing; null for a new option. */
  ticketTypeId: string | null;
  name: string;
  priceMajor: string;
  priceBasis: ExperiencePriceBasis;
  /** When priceBasis === "group": party size cap (at least 2; #4490 no 50 cap). */
  groupMax: number;
  /** When priceBasis === "block": length of one block. */
  blockMinutes: ExperienceBlockMinutes;
  minBlocks: number;
  maxBlocks: number;
  /** Spots for this option; null means unlimited. */
  capacity: number | null;
  isHidden: boolean;
  /** Confirmed sold quantity (live-edit). Never delete when > 0. */
  soldCount: number;
}

/** One authored stop (1:1 with a CuratedStop being built). */
export interface ExperienceStopDraft {
  /** Stable key for list reorder (NOT persisted). */
  clientId: string;
  placeId: string | null;
  placeName: string;
  address: string;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  /**
   * Issue #1363 — how lat/lng was captured. Legacy rows may be "exact"; all
   * selected-address resolutions are "approximate". Null means unset.
   */
  coordinatePrecision?: "exact" | "approximate" | null;
  /** ≤5; imageUrls[0] = primary. */
  imageUrls: string[];
  /** "HH:mm" local, or null. Used for set-date experiences. */
  startTime: string | null;
  /**
   * issue #3281 R3 — minutes after the guest's booked start (open-hours).
   * Null when unset; first stop is typically 0.
   */
  startOffsetMinutes?: number | null;
  /** Per-stop price major-unit string (used only in per_stop pricing mode). */
  priceMajor: string;
  /**
   * META-ORCH-1059 CHANGE 3 — compulsory per-stop blurb (1–280 chars).
   * Persists to experience_stops.ai_description → CuratedStop.aiDescription
   * (the per-stop line on the deck card + public page). Required at publish.
   */
  description: string;
}

/** CHANGE 3 — max length of the per-stop description. */
export const MAX_STOP_DESCRIPTION = 280;

let counter = 0;
export const newStopClientId = (): string => {
  counter += 1;
  return `stop_${Date.now().toString(36)}_${counter}`;
};

export const emptyStop = (): ExperienceStopDraft => ({
  clientId: newStopClientId(),
  placeId: null,
  placeName: "",
  address: "",
  city: null,
  region: null,
  countryCode: null,
  lat: null,
  lng: null,
  coordinatePrecision: null,
  imageUrls: [],
  startTime: null,
  startOffsetMinutes: null,
  // #3645 — starts EMPTY (the field shows "0.00" as a placeholder). An empty
  // per-stop price means that stop is free, exactly like typing 0.
  priceMajor: "",
  description: "",
});

/** Start Here / Then / End With label, derived from position + count (mirrors CuratedStop). */
export const labelForIndex = (i: number, n: number): string => {
  if (n <= 1) return "START HERE";
  if (i === 0) return "START HERE";
  if (i === n - 1) return "END WITH";
  return "THEN";
};

/**
 * A stop is location-valid when it carries an automatically resolved coordinate
 * alongside the selected display address.
 *
 * Issue #1363 (OQ-2, Seth-approved 2026-07-29) — SUPERSEDES the prior pick-only
 * predicate (placeId required). The invariant's intent — every stop carries a
 * real coordinate — is PRESERVED (lat/lng still required); only the pick-
 * placeId-required MECHANISM is dropped, so an un-indexed selected address is
 * valid. (Revises I-PROPOSED-1363-COORD-FROM-ANY-TIER.)
 *
 * SERVER PARITY: the experience PUBLISH RPC `biz_publish_experience` now matches
 * this predicate — as of issue #1363 amendment G1 (migration 20270121001363,
 * live) both the first-stop guard and the per-stop loop require lat + lng ONLY;
 * the old `place_id` requirement is DROPPED. So a selected-address stop with a
 * null place_id publishes, while a stop with a null lat/lng is still rejected
 * server-side (`stop_address_unvalidated`). Client and server are aligned.
 */
export const stopHasValidatedLocation = (s: ExperienceStopDraft): boolean =>
  s.lat !== null && s.lng !== null && s.address.trim().length > 0;

/** CHANGE 3 — a stop has a valid (non-empty, ≤280) description. */
export const stopHasValidDescription = (s: ExperienceStopDraft): boolean => {
  const len = s.description.trim().length;
  return len > 0 && len <= MAX_STOP_DESCRIPTION;
};

/**
 * issue #3645 — what the whole-experience price FIELD starts with.
 *
 * The field used to start with the literal text "0.00", so typing 30 produced
 * "0.0030". It now starts empty and shows 0.00 as its placeholder. A saved or
 * prefilled price above zero is shown as it was saved; zero, blank or anything
 * unreadable starts empty. Every reader of the value already treats an empty
 * field as zero, so free/paid logic and validation are unchanged.
 */
export const initialWholePriceInput = (
  saved: string | null | undefined,
): string => {
  if (typeof saved !== "string") return "";
  const value = parseFloat(saved);
  return Number.isFinite(value) && value > 0 ? saved : "";
};

/**
 * #3645 — is a per-stop price entry acceptable? EMPTY is: it means the stop is
 * free, the same as 0. Anything typed must be a number that is not negative.
 * Drafts saved before this rule stored "0.00", which is accepted as before.
 */
export function stopPriceEntryIsValid(priceMajor: string): boolean {
  const trimmed = priceMajor.trim();
  if (trimmed.length === 0) return true;
  if (!/^\d*(?:\.\d*)?$/.test(trimmed) || !/\d/.test(trimmed)) return false;
  const value = parseFloat(trimmed);
  return Number.isFinite(value) && value >= 0;
}

/**
 * #3645 bundle 2A — the per-stop ticket total in minor units, exactly as the
 * server resolves it: each stop's price is sent as Math.round(major * 100)
 * (empty or invalid = 0) and biz_publish_experience sums those. A paid
 * per-stop experience needs this above 0, or the server refuses it with
 * experience_price_invalid.
 */
export function perStopTotalMinor(stops: readonly { priceMajor: string }[]): number {
  return stops.reduce((sum, s) => {
    // An entry the stop field rejects ("1abc", "1e2") counts as 0, so the
    // total never disagrees with the field's own error.
    if (!stopPriceEntryIsValid(s.priceMajor)) return sum;
    const v = parseFloat(s.priceMajor);
    return sum + (Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0);
  }, 0);
}

let priceOptionCounter = 0;
export const newPriceOptionClientId = (): string => {
  priceOptionCounter += 1;
  return `price_opt_${Date.now().toString(36)}_${priceOptionCounter}`;
};

export const emptyPriceOption = (
  seed?: Partial<ExperiencePriceOptionDraft>,
): ExperiencePriceOptionDraft => ({
  clientId: seed?.clientId ?? newPriceOptionClientId(),
  ticketTypeId: seed?.ticketTypeId ?? null,
  // #4490 — the host names every price; nothing is named Standard for them.
  name: seed?.name ?? "",
  priceMajor: seed?.priceMajor ?? "",
  priceBasis: seed?.priceBasis ?? "person",
  groupMax: seed?.groupMax ?? 4,
  blockMinutes: seed?.blockMinutes ?? 60,
  minBlocks: seed?.minBlocks ?? 1,
  maxBlocks: seed?.maxBlocks ?? 4,
  capacity: seed?.capacity !== undefined ? seed.capacity : null,
  isHidden: seed?.isHidden ?? false,
  soldCount: seed?.soldCount ?? 0,
});

/** Wire a major-unit price string → cents for the RPC payload. */
export const priceMajorToCents = (priceMajor: string): number =>
  Math.round((parseFloat(priceMajor) || 0) * 100);

/**
 * issue #3281 R2 — payload shape for `price_options` on biz_* experience RPCs.
 * Always emit at least one option (forward-compat); omit unit-only fields that
 * do not apply to the chosen basis.
 */
export interface ExperiencePriceOptionPayload {
  /** Persisted ticket_types.id when updating an existing option. */
  id?: string;
  name: string;
  price_cents: number;
  price_basis: ExperiencePriceBasis;
  block_minutes?: number;
  min_blocks?: number;
  max_blocks?: number;
  group_max?: number;
  capacity?: number | null;
  is_hidden?: boolean;
}

export const priceOptionToPayload = (
  opt: ExperiencePriceOptionDraft,
): ExperiencePriceOptionPayload => {
  const base: ExperiencePriceOptionPayload = {
    // #4490 — sent as typed; the server refuses a blank name
    // (experience_price_name_required) and the step blocks Continue first.
    name: opt.name.trim(),
    price_cents: priceMajorToCents(opt.priceMajor),
    price_basis: opt.priceBasis,
    capacity: opt.capacity,
    is_hidden: opt.isHidden,
  };
  if (opt.priceBasis === "group") {
    return {
      ...base,
      group_max: Math.max(2, Math.round(opt.groupMax) || 2),
    };
  }
  if (opt.priceBasis === "block") {
    const minBlocks = Math.max(1, Math.round(opt.minBlocks) || 1);
    const maxBlocks = Math.max(minBlocks, Math.round(opt.maxBlocks) || minBlocks);
    return {
      ...base,
      block_minutes: opt.blockMinutes,
      min_blocks: minBlocks,
      max_blocks: maxBlocks,
    };
  }
  return base;
};

export const priceOptionBasisLabel = (basis: ExperiencePriceBasis): string => {
  if (basis === "group") return "per group";
  if (basis === "block") return "per block";
  return "per person";
};

/**
 * #4490 — every price needs a name guests will recognise (the server refuses a
 * blank one with experience_price_name_required). Shown under the Name field;
 * blocks Continue and Publish.
 */
export const PRICE_NAME_REQUIRED_COPY = "Give this price a name guests will recognise.";

export function priceOptionNameIssue(opt: Pick<ExperiencePriceOptionDraft, "name">): string | null {
  return opt.name.trim().length === 0 ? PRICE_NAME_REQUIRED_COPY : null;
}

/** A price option is valid for Continue (named; paid or free amount; unit fields coherent). */
export function priceOptionEntryIsValid(
  opt: ExperiencePriceOptionDraft,
  isFree: boolean,
): boolean {
  // #4490 — a blank name blocks Continue for every option, hidden ones too
  // (the server refuses a blank name at every index).
  if (priceOptionNameIssue(opt) !== null) return false;
  if (opt.isHidden) return true;
  if (!isFree && !stopPriceEntryIsValid(opt.priceMajor)) return false;
  if (!isFree && priceMajorToCents(opt.priceMajor) <= 0 && opt.priceMajor.trim().length > 0) {
    // Typed zero is allowed as free; empty is allowed when isFree.
  }
  if (opt.priceBasis === "group") {
    return Number.isFinite(opt.groupMax) && opt.groupMax >= 2;
  }
  if (opt.priceBasis === "block") {
    if (!EXPERIENCE_BLOCK_MINUTES.includes(opt.blockMinutes)) return false;
    return (
      opt.minBlocks >= 1 &&
      opt.maxBlocks >= opt.minBlocks &&
      opt.maxBlocks <= 48
    );
  }
  return true;
}
