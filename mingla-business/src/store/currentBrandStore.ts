/**
 * currentBrandStore — persisted Zustand store for the active organiser brand.
 *
 * Cycle 1 evolved the schema from `{id, displayName}` to the full Brand shape
 * with slug, role, stats, and currentLiveEvent (v2). Cycle 2 J-A7 extends
 * Brand with bio, tagline, contact, links, and stats.attendees so the brand
 * profile screen has content to render (v3). Persist v2 → v3 migration adds
 * `stats.attendees: 0` to existing brands and leaves new optional fields as
 * undefined.
 *
 * Constitutional note: this store holds CLIENT state only — active brand ID
 * and a CACHED stub brand list during the [TRANSITIONAL] phase before B1
 * backend cycle. When B1 lands, the brand list moves to React Query (server
 * state) and this store keeps ONLY the active brand ID. Stub data is gated
 * by [TRANSITIONAL] markers in `brandList.ts` and the dev-seed button on
 * `app/(tabs)/account.tsx`.
 *
 * Schema-version history:
 *   v1 (Cycle 0a): {id, displayName} only — never seeded
 *   v2 (Cycle 1):  {id, displayName, slug, photo?, role, stats, currentLiveEvent}
 *   v3 (Cycle 2 J-A7): adds bio?, tagline?, contact?, links?, stats.attendees
 *   v4 (Cycle 2 J-A8): adds displayAttendeeCount? (passthrough migration)
 *   v5 (Cycle 2 J-A8 polish): adds links.tiktok?, links.x?, links.facebook?,
 *                              links.youtube?, links.linkedin?, links.threads?
 *                              (passthrough migration; new fields start undefined)
 *   v6 (Cycle 2 J-A8 polish): adds contact.phoneCountryIso?
 *                              (passthrough migration; defaults to "GB" at read sites)
 *   v7 (Cycle 2 J-A9): adds members?: BrandMember[] + pendingInvitations?:
 *                       BrandInvitation[] (passthrough migration; both arrays
 *                       start undefined, defaulted to [] at read sites)
 *   v8 (Cycle 2 J-A10/J-A11): adds stripeStatus?: BrandStripeStatus +
 *                       availableBalanceGbp? + pendingBalanceGbp? +
 *                       lastPayoutAt? + payouts?: BrandPayout[] +
 *                       refunds?: BrandRefund[] (passthrough migration; new
 *                       optional fields start undefined; defaulted at read
 *                       sites — stripeStatus → "not_connected", balances → 0,
 *                       payouts/refunds → []).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

// BrandRole: from the brand list, what role does the CURRENT USER hold on
// this brand? Used for permission gating in the founder-facing UI (top-nav
// chip, brand-list rendering).
//
// BrandMemberRole (below): from a brand's perspective, what role does a
// given team member hold on this brand? Used for member rendering + role
// assignment in the J-A9 team UI.
//
// These are intentionally SEPARATE enums — do NOT collapse them. Cycle 1
// only models owner/admin from the current-user perspective; J-A9 models
// the full 6-role spectrum from the team-member perspective. Future cycles
// may extend BrandRole to include 'admin' subtypes (e.g., 'event_manager')
// once permission gating per role is wired up at the route level.
export type BrandRole = "owner" | "admin";

/**
 * Full role enum used by team members on a brand. NEW in J-A9 schema v7.
 * Per Designer Handoff §6.2.2.
 */
export type BrandMemberRole =
  | "owner"
  | "brand_admin"
  | "event_manager"
  | "finance_manager"
  | "marketing_manager"
  | "scanner";

/**
 * Roles that can be ASSIGNED via invite. Owner is excluded — exactly one
 * owner per brand; ownership transfer is post-MVP. NEW in J-A9 schema v7.
 */
export type InviteRole = Exclude<BrandMemberRole, "owner">;

/**
 * Member status. Future-proof for `'suspended'` (post-MVP suspension flow).
 * NEW in J-A9 schema v7.
 */
export type BrandMemberStatus = "active";

export interface BrandMember {
  id: string;
  name: string;
  email: string;
  role: BrandMemberRole;
  status: BrandMemberStatus;
  /** ISO 8601 timestamp when the member joined the brand. */
  joinedAt: string;
  /** ISO 8601 timestamp of last activity. Optional — future B1 wiring. */
  lastActiveAt?: string;
  /** Avatar photo URL. Optional; rendering falls back to initial. */
  photo?: string;
}

export type BrandInvitationStatus = "pending";

export interface BrandInvitation {
  id: string;
  email: string;
  role: InviteRole;
  /** ISO 8601 timestamp when the invitation was sent. */
  invitedAt: string;
  /** Optional note from inviter, shown on the accept screen (B1 cycle). */
  note?: string;
  status: BrandInvitationStatus;
}

/**
 * Brand's Stripe Connect state. NEW in J-A10 schema v8.
 *
 * - not_connected: brand has not started Stripe Connect onboarding
 * - onboarding: submitted but Stripe is verifying (KYC in progress)
 * - active: fully verified, can sell tickets and receive payouts
 * - restricted: Stripe has flagged the account; payouts paused until resolved
 *
 * Per Designer Handoff §5.3.7 + §6.3.3.
 */
export type BrandStripeStatus =
  | "not_connected"
  | "onboarding"
  | "active"
  | "restricted";

/** Payout status. NEW in J-A10 schema v8. */
export type BrandPayoutStatus = "paid" | "in_transit" | "failed";

export interface BrandPayout {
  id: string;
  /** Amount in GBP, positive number. Caller formats via Intl.NumberFormat. */
  amountGbp: number;
  currency: "GBP";
  status: BrandPayoutStatus;
  /** ISO 8601 timestamp when funds arrived (paid) or expected (in_transit). */
  arrivedAt: string;
}

export interface BrandRefund {
  id: string;
  /**
   * Refund amount in GBP, positive number (the refund value, not negative).
   * The minus prefix on display is a render-time concern.
   */
  amountGbp: number;
  currency: "GBP";
  /** Display title of the event the refund relates to. */
  eventTitle: string;
  /** ISO 8601 timestamp when the refund processed. */
  refundedAt: string;
  /** Optional human-readable reason. Surfaces in row sub-text. */
  reason?: string;
}

export interface BrandStats {
  events: number;
  followers: number;
  rev: number;
  /** Total attendees across all events. NEW in J-A7 schema v3. */
  attendees: number;
}

export interface BrandLiveEvent {
  name: string;
  soldGbp: number;
  goalGbp: number;
}

export interface BrandContact {
  email?: string;
  phone?: string;
  /**
   * ISO 3166-1 alpha-2 country code for the phone's dial-code chip
   * (e.g. "GB", "US"). NEW in J-A8 polish schema v6. When undefined,
   * the phone Input defaults to "GB". Tracked separately from the
   * `phone` string so the country selection can be persisted without
   * mangling the user's typed local-number text.
   */
  phoneCountryIso?: string;
}

export interface BrandCustomLink {
  label: string;
  url: string;
}

export interface BrandLinks {
  website?: string;
  instagram?: string;
  /** TikTok handle (e.g. "@yourbrand"). NEW in J-A8 polish schema v5. */
  tiktok?: string;
  /** X (formerly Twitter) handle. NEW in J-A8 polish schema v5. */
  x?: string;
  /** Facebook page slug or URL. NEW in J-A8 polish schema v5. */
  facebook?: string;
  /** YouTube channel handle or URL. NEW in J-A8 polish schema v5. */
  youtube?: string;
  /** LinkedIn page slug or URL. NEW in J-A8 polish schema v5. */
  linkedin?: string;
  /** Threads handle. NEW in J-A8 polish schema v5. */
  threads?: string;
  /** Custom link list (post-MVP); empty in J-A7 stubs. */
  custom?: BrandCustomLink[];
}

/**
 * Cycle 2 J-A7 Brand shape (v3). `displayName` is the canonical label
 * (preserves the existing TopBar consumer contract from Cycle 0a).
 * `currentLiveEvent` is `null` when the brand has no live event tonight;
 * non-null brands drive the Home hero KPI. New v3 fields (bio, tagline,
 * contact, links) are optional — render-time guards handle undefined.
 */
export type Brand = {
  id: string;
  displayName: string;
  slug: string;
  photo?: string;
  role: BrandRole;
  stats: BrandStats;
  currentLiveEvent: BrandLiveEvent | null;
  /** Long-form description shown on profile. NEW in J-A7 schema v3. */
  bio?: string;
  /** One-line tagline. NEW in J-A7 schema v3. */
  tagline?: string;
  /** Contact info shown in profile + edit. NEW in J-A7 schema v3. */
  contact?: BrandContact;
  /** Social + custom links. NEW in J-A7 schema v3. */
  links?: BrandLinks;
  /**
   * Whether to show attendee count on public-facing surfaces. NEW in J-A8
   * schema v4. Undefined treated as `true` at read sites (default-on).
   * Consumer (Cycle 3+ public-page rendering) wires up later — J-A7 view
   * always shows attendees regardless of this toggle.
   */
  displayAttendeeCount?: boolean;
  /**
   * Active team members on this brand. Owner is always pinned at index 0
   * by the rendering layer (BrandTeamView). NEW in J-A9 schema v7.
   * Undefined treated as `[]` at read sites.
   */
  members?: BrandMember[];
  /**
   * Pending invitations for this brand. Rendered as greyed rows in the
   * team list with Resend / Cancel actions. NEW in J-A9 schema v7.
   * Undefined treated as `[]` at read sites.
   */
  pendingInvitations?: BrandInvitation[];
  /**
   * Stripe Connect status. NEW in J-A10 schema v8. Undefined treated as
   * `"not_connected"` at read sites — drives the J-A7 banner + payments
   * dashboard banner variant.
   */
  stripeStatus?: BrandStripeStatus;
  /**
   * Available balance (clears for next payout) in GBP whole-units.
   * NEW in J-A10 schema v8. Undefined treated as 0 at read sites.
   */
  availableBalanceGbp?: number;
  /**
   * Pending balance (Stripe escrow window before clearing) in GBP whole-units.
   * NEW in J-A10 schema v8. Undefined treated as 0 at read sites.
   */
  pendingBalanceGbp?: number;
  /**
   * ISO 8601 timestamp of the most recent payout. NEW in J-A10 schema v8.
   * Undefined when no payouts have occurred. Drives the "Last payout"
   * KPI tile sub-text (relative time).
   */
  lastPayoutAt?: string;
  /**
   * Recent payouts. NEW in J-A10 schema v8. Undefined treated as `[]`.
   * Sorted newest-first by arrivedAt at render time.
   */
  payouts?: BrandPayout[];
  /**
   * Recent refunds. NEW in J-A10 schema v8. Undefined treated as `[]`.
   * Sorted newest-first by refundedAt at render time.
   */
  refunds?: BrandRefund[];
};

export type CurrentBrandState = {
  currentBrand: Brand | null;
  brands: Brand[];
  setCurrentBrand: (brand: Brand | null) => void;
  setBrands: (brands: Brand[]) => void;
  reset: () => void;
};

type PersistedState = Pick<CurrentBrandState, "currentBrand" | "brands">;

/** v2 brand shape — used internally by the v2 → v3 migrator only. */
type V2BrandStats = { events: number; followers: number; rev: number; attendees?: number };
type V2Brand = {
  id: string;
  displayName: string;
  slug: string;
  photo?: string;
  role: BrandRole;
  stats: V2BrandStats;
  currentLiveEvent: BrandLiveEvent | null;
};

const upgradeV2BrandToV3 = (b: V2Brand): Brand => ({
  ...b,
  stats: {
    events: b.stats.events,
    followers: b.stats.followers,
    rev: b.stats.rev,
    attendees: b.stats.attendees ?? 0,
  },
});

const persistOptions: PersistOptions<CurrentBrandState, PersistedState> = {
  name: "mingla-business.currentBrand.v8",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({
    currentBrand: state.currentBrand,
    brands: state.brands,
  }),
  version: 8,
  migrate: (persistedState, version) => {
    // v1 → v5: schema changed from {id, displayName} to full Brand shape.
    // Cycle 0a never seeded brands, so resetting is safe and avoids partial
    // record bugs from a half-populated v1 entry.
    if (version < 2) {
      return { currentBrand: null, brands: [] };
    }
    // v2 → v3+: add stats.attendees (default 0); bio, tagline, contact, links
    // remain undefined and render with empty-state guards.
    if (version === 2) {
      const v2 = persistedState as { currentBrand: V2Brand | null; brands: V2Brand[] };
      return {
        currentBrand: v2.currentBrand !== null ? upgradeV2BrandToV3(v2.currentBrand) : null,
        brands: v2.brands.map(upgradeV2BrandToV3),
      };
    }
    // v3 → v4: passthrough. New optional `displayAttendeeCount` field starts
    // undefined for all brands; read sites default to `true`.
    // v4 → v5: passthrough. New optional `links.tiktok/x/facebook/youtube/
    // linkedin/threads` fields start undefined for all brands; render-time
    // guards on each social chip skip undefined fields.
    // v5 → v6: passthrough. New optional `contact.phoneCountryIso` field
    // starts undefined; phone Input defaults to "GB" at read sites.
    // v6 → v7: passthrough. New optional `members` + `pendingInvitations`
    // arrays start undefined; team list renders empty-state when both
    // absent. Read sites default to `[]`.
    // v7 → v8: passthrough. New optional `stripeStatus`, `availableBalanceGbp`,
    // `pendingBalanceGbp`, `lastPayoutAt`, `payouts`, `refunds` fields start
    // undefined; J-A7 banner + payments dashboard render not_connected/empty
    // states when absent. Read sites default to "not_connected" / 0 / [].
    return persistedState as PersistedState;
  },
};

export const useCurrentBrandStore = create<CurrentBrandState>()(
  persist(
    (set) => ({
      currentBrand: null,
      brands: [],
      setCurrentBrand: (brand) => set({ currentBrand: brand }),
      setBrands: (brands) => set({ brands }),
      reset: () => set({ currentBrand: null, brands: [] }),
    }),
    persistOptions,
  ),
);

export const useCurrentBrand = (): Brand | null =>
  useCurrentBrandStore((s) => s.currentBrand);

export const useBrandList = (): Brand[] =>
  useCurrentBrandStore((s) => s.brands);
