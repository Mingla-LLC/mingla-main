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
  /**
   * Cover media URL (Supabase storage OR Giphy/Pexels). NEW in Cycle 17e-A
   * schema (column pre-load). UI render: if present, shows media; falls back
   * to coverHue gradient when null/undefined. Picker UI ships in 17e-B Tier 2.
   */
  coverMediaUrl?: string;
  /**
   * Cover media type. NEW in Cycle 17e-A schema (column pre-load).
   * 17e-B Tier 2 picker writes this.
   */
  coverMediaType?: "image" | "video" | "gif";
  /**
   * Profile photo type — supports animated avatars per Q1=B amendment (DEC-109).
   * NEW in Cycle 17e-A schema (column pre-load). Picker UI ships in 17e-B Tier 2.
   * Existing profile_photo_url defaults to image semantics when this is undefined.
   */
  profilePhotoType?: "image" | "video" | "gif";
};

export type CurrentBrandState = {
  currentBrand: Brand | null;
  setCurrentBrand: (brand: Brand | null) => void;
  reset: () => void;
};

type PersistedState = Pick<CurrentBrandState, "currentBrand">;

// Cycle 17e-A v13 — drops `brands: Brand[]` from persisted state per Const #5
// (server state via React Query useBrands() — see src/hooks/useBrands.ts). Keeps
// `currentBrand: Brand | null` for selection state (client UI state). The
// `setBrands` action + `useBrandList` hook removed. I-PROPOSED-C codifies the
// server-state-only contract; CI grep gate enforces zero `setBrands\(` callers.
//
// Cycle 17d §E — v1-v11 migrator helpers + V2/V9/V10/V11 type defs deleted.
// Original chain (v1→v12) preserved at commit aae7784d for audit trail.

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
  name: "mingla-business.currentBrand.v13",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({
    currentBrand: state.currentBrand,
  }),
  version: 13,
  migrate: (persistedState, version) => {
    // Cycle 17e-A v12 → v13 — drops `brands` array from persisted state per Const #5.
    // Preserves `currentBrand` selection. v1-v11 already collapsed by Cycle 17d Stage 1 §E.
    // After this migration runs, useBrands() React Query hook owns the brand list;
    // first render fetches from Supabase brands table (post-migration 20260506000000).
    if (version < 13) {
      const old = persistedState as Partial<{
        currentBrand: Brand | null;
      }> | null;
      return { currentBrand: old?.currentBrand ?? null };
    }
    return persistedState as PersistedState;
  },
};

export const useCurrentBrandStore = create<CurrentBrandState>()(
  persist(
    (set) => ({
      currentBrand: null,
      setCurrentBrand: (brand) => set({ currentBrand: brand }),
      reset: () => set({ currentBrand: null }),
    }),
    persistOptions,
  ),
);

export const useCurrentBrand = (): Brand | null =>
  useCurrentBrandStore((s) => s.currentBrand);

// [TRANSITIONAL] Cycle 17e-A — `useBrandList` kept as a re-export of a thin
// wrapper that delegates to `useBrands(authUserId)`. The underlying state
// moved to React Query per Const #5 + I-PROPOSED-C; only `setBrands` (the
// write path) was removed. This re-export preserves call-site import stability
// for ~20 consumers while keeping server state owned by React Query.
//
// EXIT condition: future cycle migrates each caller to `useBrands(accountId)`
// directly with explicit accountId derivation — then this re-export + the
// shim file (src/hooks/useBrandListShim.ts) both delete.
//
// I-PROPOSED-C strict-grep gate bans `setBrands\(` (write path), NOT
// `useBrandList` (read-only sugar over the React Query cache).
export { useBrandList } from "../hooks/useBrandListShim";
