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
 *   v9 (Cycle 2 J-A12): adds events?: BrandEventStub[] (passthrough
 *                       migration; new optional field starts undefined;
 *                       defaulted to [] at read sites). FINAL Cycle-2
 *                       schema bump. Real per-event records ship Cycle 3
 *                       in a separate table; this Brand-level stub array
 *                       drives J-A12 finance reports until then.
 *   v10 (Cycle 7 public brand page): adds kind: "physical" | "popup"
 *                       (required, default "popup") + address: string | null
 *                       (default null). Operator-steered addendum to Cycle 7
 *                       so the public brand page renders truthful location:
 *                       physical brands show address after handle, pop-up
 *                       brands show clean handle-only (no faked location).
 *                       Per Constitution #9 (no fabricated data).
 *   v11 (Cycle 7 FX2 brand cover editing): adds coverHue: number (required,
 *                       default 25 = warm orange matching accent.warm).
 *                       Drives the gradient on the public brand page hero.
 *                       Founder picks from a 6-swatch row in BrandEditView
 *                       (mirrors Cycle 3 CreatorStep4Cover hue array
 *                       [25, 100, 180, 220, 290, 320]). Hue-only stub for
 *                       now; image upload lands in B-cycle when storage
 *                       pipelines + edge functions are ready.
 *   v12 (Cycle 13a — DEC-092): DROPS J-A9 fields `members?: BrandMember[]`
 *                       and `pendingInvitations?: BrandInvitation[]` along
 *                       with the BrandMember / BrandInvitation /
 *                       BrandMemberRole / InviteRole / BrandMemberStatus /
 *                       BrandInvitationStatus types. Brand-team state
 *                       authority moves to `src/store/brandTeamStore.ts`
 *                       (Cycle 13a SPEC §4.7) per Const #2 (one owner per
 *                       truth) + Const #8 (subtract before adding). v11→v12
 *                       migration silently strips both fields from cached
 *                       brands; any local stub data lost is acceptable per
 *                       I-31 TRANSITIONAL semantics.
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
// Cycle 13a (DEC-092): the J-A9 BrandMemberRole + BrandMember + BrandInvitation
// + InviteRole types were dropped. The canonical 6-role enum now lives in
// `src/utils/brandRole.ts` (mirrors SQL biz_role_rank verbatim per I-32).
// Brand membership state lives in `src/store/brandTeamStore.ts` (TRANSITIONAL
// per I-31 until B-cycle wires invite-brand-member edge function). v11→v12
// persist migration silently strips `members` + `pendingInvitations` from
// the local cache.
export type BrandRole = "owner" | "admin";

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

/**
 * Stub of an event for Brand-level summarization. NEW in J-A12 schema v9.
 *
 * Real event records ship in Cycle 3 (event creator) and live in a
 * separate table; this Brand-level stub field exists ONLY to drive the
 * J-A12 finance reports' Top events list + revenue breakdown until
 * Cycle 3 wires per-event records.
 *
 * Per Designer Handoff finance-reports design (screens-brand.jsx
 * FinanceReportsScreen line 411-417).
 */
export interface BrandEventStub {
  id: string;
  title: string;
  /**
   * Gross revenue from this event in GBP whole-units (before fees / refunds).
   * Drives both the Top events list amount and the breakdown computation.
   */
  revenueGbp: number;
  /** Number of tickets sold for this event. */
  soldCount: number;
  /** Status drives the row sub-text label fallback. */
  status: "upcoming" | "in_progress" | "ended";
  /** ISO 8601 — when the event was held (or scheduled to be held). */
  heldAt: string;
  /**
   * Optional explicit context blurb for the row sub-text (e.g.,
   * "in person", "brunch series"). When undefined, rendering falls back
   * to a status-derived label (e.g., "ended", "upcoming").
   */
  contextLabel?: string;
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
  /**
   * URL-safe brand slug. FROZEN at brand creation per I-17.
   * NEVER add an edit path — IG-bio links and shared brand URLs
   * (Cycle 7 `/b/{brandSlug}` surface) depend on this slug being
   * immutable. If a future cycle needs brand renaming for typo
   * correction, ship a slug-redirect table + 301 to the new slug;
   * do NOT mutate this field directly.
   */
  slug: string;
  /**
   * Brand kind. Drives whether the public brand page shows a location
   * after the handle. NEW in Cycle 7 schema v10.
   *   - "physical" — brand owns/leases a venue. Public page renders address.
   *   - "popup"    — brand operates across multiple venues. No location shown.
   *
   * Required field. Defaults to "popup" on migration from v9 (safer default —
   * no fake address shown). Set per-brand in stub data; founder edits via
   * BrandEditView.
   */
  kind: "physical" | "popup";
  /**
   * Public-facing address for physical brands. Free-form string (matches
   * the existing event-venue pattern). Only meaningful when
   * `kind === "physical"`. UI hides the address input entirely when
   * kind === "popup". When kind switches popup → physical, any previously-
   * entered address is preserved and re-shown (don't clear).
   *
   * NEW in Cycle 7 schema v10. Optional — null even on physical brands
   * means founder hasn't shared an address yet (clean omission, no fake).
   */
  address: string | null;
  /**
   * Cover band hue — drives the gradient on the public brand page hero.
   * Founder picks from a 6-swatch row in BrandEditView. Defaults to 25
   * (warm orange — matches the existing accent.warm Cycle 0 scheme).
   *
   * NEW in Cycle 7 FX2 schema v11. Hue-only stub for now; image upload
   * lands in B-cycle when storage pipelines + edge functions are ready
   * (mirrors the event-cover Cycle 3 hue-only pattern).
   */
  coverHue: number;
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
  /**
   * Recent events for finance-reports rendering. NEW in J-A12 schema v9.
   * Undefined treated as `[]` at read sites. Real per-event records ship
   * Cycle 3 (event creator) in a separate table; this Brand-level stub
   * exists ONLY to populate J-A12 finance reports until Cycle 3 lands.
   */
  events?: BrandEventStub[];
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

/**
 * v2 → v3 upgrade returns a v9-shaped brand (the v3..v9 fields are all
 * optional/passthrough). The migrate function chains this output through
 * upgradeV9BrandToV10 to land at the current Brand shape.
 */
const upgradeV2BrandToV3 = (b: V2Brand): V9Brand => ({
  ...b,
  stats: {
    events: b.stats.events,
    followers: b.stats.followers,
    rev: b.stats.rev,
    attendees: b.stats.attendees ?? 0,
  },
});

/**
 * Pre-v12 J-A9 fields (DEC-092 dropped): used internally by the v11 → v12
 * migrator to silently strip leaked keys without referencing the dropped
 * BrandMember / BrandInvitation types.
 */
type V11Extras = {
  members?: unknown;
  pendingInvitations?: unknown;
};

/** v9 brand shape — used internally by the v9 → v10 migrator only. */
type V9Brand = Omit<Brand, "kind" | "address" | "coverHue"> & V11Extras;

/** v10 brand shape — used internally by the v10 → v11 migrator only. */
type V10Brand = Omit<Brand, "coverHue"> & V11Extras;

/** v11 brand shape — used internally by the v11 → v12 migrator only. */
type V11Brand = Brand & V11Extras;

/**
 * v9 → v10 migration: add `kind` (default "popup") + `address` (default null).
 * Pop-up is the safer default — no fake address shown; founder upgrades to
 * "physical" + address via BrandEditView when applicable.
 */
const upgradeV9BrandToV10 = (b: V9Brand): V10Brand => ({
  ...b,
  kind: "popup",
  address: null,
});

/**
 * v10 → v11 migration: add `coverHue` (default 25 = warm orange).
 * Mirrors event-cover Cycle 3 hue-only pattern. Founder edits via
 * BrandEditView's BRAND COVER section.
 */
const upgradeV10BrandToV11 = (b: V10Brand): V11Brand => ({
  ...b,
  coverHue: 25,
});

/**
 * v11 → v12 migration (Cycle 13a / DEC-092): silently strip the dropped
 * J-A9 fields `members` + `pendingInvitations` from the cached brand.
 * Brand-team state moves to `brandTeamStore` per Cycle 13a SPEC §4.7.
 */
const upgradeV11BrandToV12 = (b: V11Brand): Brand => {
  const { members: _m, pendingInvitations: _p, ...rest } = b;
  return rest;
};

const persistOptions: PersistOptions<CurrentBrandState, PersistedState> = {
  name: "mingla-business.currentBrand.v12",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({
    currentBrand: state.currentBrand,
    brands: state.brands,
  }),
  version: 12,
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
      // v2 → v9-shaped → v10 → v11 → v12 in one chain.
      const v9CurrentBrand =
        v2.currentBrand !== null ? upgradeV2BrandToV3(v2.currentBrand) : null;
      const v9Brands = v2.brands.map(upgradeV2BrandToV3);
      const v10CurrentBrand =
        v9CurrentBrand !== null ? upgradeV9BrandToV10(v9CurrentBrand) : null;
      const v10Brands = v9Brands.map(upgradeV9BrandToV10);
      const v11CurrentBrand =
        v10CurrentBrand !== null ? upgradeV10BrandToV11(v10CurrentBrand) : null;
      const v11Brands = v10Brands.map(upgradeV10BrandToV11);
      return {
        currentBrand:
          v11CurrentBrand !== null ? upgradeV11BrandToV12(v11CurrentBrand) : null,
        brands: v11Brands.map(upgradeV11BrandToV12),
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
    // v8 → v9: passthrough. New optional `events` array starts undefined;
    // finance reports render empty-state when absent. Read sites default
    // to []. FINAL Cycle-2 schema bump — real per-event records ship Cycle 3.
    if (version >= 3 && version < 10) {
      // v3-v9 → v10 → v11 → v12: add kind/address, then coverHue, then drop J-A9 keys.
      const v9 = persistedState as { currentBrand: V9Brand | null; brands: V9Brand[] };
      const v10CurrentBrand =
        v9.currentBrand !== null ? upgradeV9BrandToV10(v9.currentBrand) : null;
      const v10Brands = v9.brands.map(upgradeV9BrandToV10);
      const v11CurrentBrand =
        v10CurrentBrand !== null ? upgradeV10BrandToV11(v10CurrentBrand) : null;
      const v11Brands = v10Brands.map(upgradeV10BrandToV11);
      return {
        currentBrand:
          v11CurrentBrand !== null ? upgradeV11BrandToV12(v11CurrentBrand) : null,
        brands: v11Brands.map(upgradeV11BrandToV12),
      };
    }
    if (version === 10) {
      // v10 → v11 → v12: add coverHue, then drop J-A9 keys.
      const v10 = persistedState as { currentBrand: V10Brand | null; brands: V10Brand[] };
      const v11CurrentBrand =
        v10.currentBrand !== null ? upgradeV10BrandToV11(v10.currentBrand) : null;
      const v11Brands = v10.brands.map(upgradeV10BrandToV11);
      return {
        currentBrand:
          v11CurrentBrand !== null ? upgradeV11BrandToV12(v11CurrentBrand) : null,
        brands: v11Brands.map(upgradeV11BrandToV12),
      };
    }
    if (version === 11) {
      // v11 → v12 (Cycle 13a): drop J-A9 members + pendingInvitations.
      const v11 = persistedState as { currentBrand: V11Brand | null; brands: V11Brand[] };
      return {
        currentBrand:
          v11.currentBrand !== null ? upgradeV11BrandToV12(v11.currentBrand) : null,
        brands: v11.brands.map(upgradeV11BrandToV12),
      };
    }
    // v3 → v4: passthrough. New optional `displayAttendeeCount` field starts
    // undefined for all brands; read sites default to `true`.
    // v4 → v5: passthrough. New optional `links.tiktok/x/facebook/youtube/
    // linkedin/threads` fields start undefined for all brands; render-time
    // guards on each social chip skip undefined fields.
    // v5 → v6: passthrough. New optional `contact.phoneCountryIso` field
    // starts undefined; phone Input defaults to "GB" at read sites.
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
