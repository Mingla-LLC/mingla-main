/**
 * #4304 part 3 — First Home with Ari: the one owner of "which first-run stage
 * is this host in?".
 *
 *   - `no_brand`     (State A) signed in, brand list fetched, zero brands.
 *   - `empty_brand`  (State B) the host runs the current brand (rank >= 30)
 *                    and none of their brands has a draft or listing yet
 *                    (event, experience, RSVP, trip or venue page).
 *   - `unlocked`     (State C) something has been made, or Home has already
 *                    appeared for this account once (it never disappears).
 *   - `not_applicable` staff on someone else's brand (scanner, venue staff,
 *                    marketing manager) keep their own screens unchanged.
 *   - `pending`      anything still loading. Callers MUST treat pending as the
 *                    existing (non first-run) behaviour so the reduced tab set
 *                    never flashes while brands or drafts load.
 *
 * Pure: no React, no stores. `useFirstRunStage` feeds it.
 */

import { BRAND_ROLE_RANK } from "./brandRole";

export type FirstRunStage =
  | "pending"
  | "no_brand"
  | "empty_brand"
  | "unlocked"
  | "not_applicable";

export interface FirstRunInput {
  /** Auth settled and a user is signed in. */
  signedIn: boolean;
  /** The persisted first-run store has rehydrated (Constitution #14). */
  storeHydrated: boolean;
  /** Home has already appeared for this account (persisted flag). */
  homeUnlocked: boolean;
  /** Brand list query has fetched at least once. */
  brandsFetched: boolean;
  brandCount: number;
  /** Persisted brand pointer not hydrated, or recovery still resolving. */
  brandResolving: boolean;
  /** A current brand record is selected. */
  hasCurrentBrand: boolean;
  /** Role query for the current brand is still loading. */
  roleLoading: boolean;
  /** Caller rank on the current brand. */
  rank: number;
  /** True as soon as ANY signal proves a draft or listing exists. */
  contentFound: boolean;
  /** Every content source has answered (so "no content" is trustworthy). */
  contentKnown: boolean;
  /**
   * The content probe failed. Fail open to today's screens (never lock a host
   * out of Home on a network error) and never persist an unlock from it.
   */
  contentError?: boolean;
}

export function deriveFirstRunStage(input: FirstRunInput): FirstRunStage {
  if (!input.signedIn || !input.storeHydrated) return "pending";
  if (input.homeUnlocked) return "unlocked";
  if (!input.brandsFetched || input.brandResolving) return "pending";
  if (input.brandCount === 0) return "no_brand";
  // Content anywhere wins as soon as it is seen — no need to wait for roles.
  if (input.contentFound) return "unlocked";
  // Brands exist but none is selected yet: recovery is about to pick one.
  if (!input.hasCurrentBrand || input.roleLoading) return "pending";
  // Scanners, venue staff and marketing managers keep today's screens.
  if (input.rank < BRAND_ROLE_RANK.finance_manager) return "not_applicable";
  if (input.contentError === true && !input.contentKnown) return "not_applicable";
  if (!input.contentKnown) return "pending";
  return "empty_brand";
}

export function isFirstRunLocked(stage: FirstRunStage): boolean {
  return stage === "no_brand" || stage === "empty_brand";
}

export interface StickyLock {
  userId: string;
  stage: "no_brand" | "empty_brand";
}

/**
 * A locked host stays locked through a re-resolve (State A → B: the new
 * brand's role and "anything made?" answer load). Without this the full tab
 * set would flash between the two reduced ones. Only a resolved answer, a
 * sign-out or another account clears it.
 */
export function stickyFirstRunStage(
  previous: StickyLock | null,
  derived: FirstRunStage,
  userId: string | null,
): { stage: FirstRunStage; lock: StickyLock | null } {
  if (derived === "no_brand" || derived === "empty_brand") {
    return {
      stage: derived,
      lock: userId !== null ? { userId, stage: derived } : null,
    };
  }
  if (derived !== "pending" || userId === null) {
    return { stage: derived, lock: null };
  }
  if (previous !== null && previous.userId === userId) {
    return { stage: previous.stage, lock: previous };
  }
  return { stage: derived, lock: null };
}

/** Tabs a locked host sees, in this order. */
export const FIRST_RUN_TAB_IDS = ["ari", "account"] as const;

/** The landing tab while first-run is locked (#4237: route explicitly). */
export const FIRST_RUN_LANDING_ROUTE = "/(tabs)/ari";

export function firstRunVisibleTabs<T extends { id: string }>(
  rankVisibleTabs: readonly T[],
  allTabs: readonly T[],
  stage: FirstRunStage,
): T[] {
  if (!isFirstRunLocked(stage)) return [...rankVisibleTabs];
  return FIRST_RUN_TAB_IDS.map((id) =>
    allTabs.find((tab) => tab.id === id),
  ).filter((tab): tab is T => tab !== undefined);
}

/**
 * Where a pathname must go while first-run is locked, or null to stay.
 * Only Home (and the bare tabs root) is redirected: links, pushes, emails and
 * old bookmarks all land there.
 */
export function firstRunRedirect(
  pathname: string,
  stage: FirstRunStage,
): string | null {
  if (!isFirstRunLocked(stage)) return null;
  const lower = pathname.toLowerCase().replace(/\/+$/, "");
  if (lower === "/home" || lower.startsWith("/home/") || lower === "") {
    return FIRST_RUN_LANDING_ROUTE;
  }
  return null;
}

/** What the host told Ari they host, carried from State A into State B. */
export type FirstRunIntent =
  | "brand"
  | "events"
  | "rsvp"
  | "experiences"
  | "trips"
  | "venue"
  | "about";

export interface FirstRunChip {
  id: FirstRunIntent;
  label: string;
  primary?: boolean;
}

export const NO_BRAND_CHIPS: readonly FirstRunChip[] = [
  { id: "brand", label: "Set up my brand", primary: true },
  { id: "events", label: "I host events" },
  { id: "experiences", label: "I run experiences" },
  { id: "trips", label: "I run trips" },
  { id: "venue", label: "I run a venue" },
  { id: "about", label: "What is Mingla?" },
];

export const EMPTY_BRAND_CHIPS: readonly FirstRunChip[] = [
  { id: "events", label: "An event with tickets", primary: true },
  { id: "rsvp", label: "A free RSVP" },
  { id: "experiences", label: "An experience" },
  { id: "trips", label: "A trip" },
  { id: "venue", label: "A venue page" },
];

/** State B chips, with the kind remembered from State A promoted to primary. */
export function emptyBrandChips(
  remembered: FirstRunIntent | null,
): FirstRunChip[] {
  const match =
    remembered !== null &&
    EMPTY_BRAND_CHIPS.some((chip) => chip.id === remembered);
  return EMPTY_BRAND_CHIPS.map((chip) => ({
    ...chip,
    primary: match ? chip.id === remembered : chip.primary === true,
  }));
}

export interface FirstRunGreetingCopy {
  headline: string;
  body: string;
  placeholder: string;
  chips: FirstRunChip[];
}

const firstNameOf = (displayName: string | null | undefined): string | null => {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  // Never greet someone by an email address.
  if (first.length === 0 || first.includes("@")) return null;
  return first.length > 24 ? first.slice(0, 24) : first;
};

export function firstRunGreeting(args: {
  stage: "no_brand" | "empty_brand";
  displayName: string | null | undefined;
  brandName: string | null | undefined;
  remembered: FirstRunIntent | null;
}): FirstRunGreetingCopy {
  if (args.stage === "no_brand") {
    const first = firstNameOf(args.displayName);
    return {
      headline: `${first ? `Hi ${first}.` : "Hi."} Let's get your business on Mingla.`,
      body: "First we set up your brand: name, logo and where you host. It takes about two minutes, and I'll do the typing.",
      placeholder: "Tell Ari about your business…",
      chips: [...NO_BRAND_CHIPS],
    };
  }
  const brand = (args.brandName ?? "").trim() || "Your brand";
  return {
    headline: `${brand} is set up. What are you hosting first?`,
    body: "Tell me the idea in a sentence. I'll draft it, and you check it before anything goes public.",
    placeholder: "e.g. Rooftop party, 15 Nov",
    chips: emptyBrandChips(args.remembered),
  };
}
