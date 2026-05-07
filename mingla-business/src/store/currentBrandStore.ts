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

// Cycle 2 / ORCH-0743 — Brand types co-located in src/types/brand.ts to break
// the currentBrandStore ↔ useCurrentBrand require cycle introduced by ORCH-0742.
// Both store and wrapper hook now import the type from that leaf file
// independently. Re-exported here for backwards-compat with ~25 import sites
// (TopBar, home, events, brand/edit, services, hooks, components/orders, etc.)
// that import `Brand` (and friends) from this file.
export type {
  Brand,
  BrandRole,
  BrandStripeStatus,
  BrandPayoutStatus,
  BrandPayout,
  BrandRefund,
  BrandEventStub,
  BrandStats,
  BrandLiveEvent,
  BrandContact,
  BrandCustomLink,
  BrandLinks,
} from "../types/brand";

import type { Brand } from "../types/brand";

export type CurrentBrandState = {
  currentBrandId: string | null;
  setCurrentBrand: (brand: Brand | null) => void;
  setCurrentBrandId: (id: string | null) => void;
  reset: () => void;
};

type PersistedState = Pick<CurrentBrandState, "currentBrandId">;

// Cycle 17e-A v13 — drops `brands: Brand[]` from persisted state per Const #5
// (server state via React Query useBrands() — see src/hooks/useBrands.ts). Keeps
// `currentBrand: Brand | null` for selection state (client UI state). The
// `setBrands` action + `useBrandList` hook removed. I-PROPOSED-C codifies the
// server-state-only contract; CI grep gate enforces zero `setBrands\(` callers.
//
// Cycle 17d §E — v1-v11 migrator helpers + V2/V9/V10/V11 type defs deleted.
// Original chain (v1→v12) preserved at commit aae7784d for audit trail.
//
// Cycle 2 / ORCH-0742 v14 — drops the persisted full Brand snapshot. Only
// `currentBrandId: string | null` survives in storage; the live Brand record
// is read at render time via React Query (`useBrand(currentBrandId)`) so a
// brand renamed/deleted on another device can never appear stale on cold-start
// or replay phantom selection. I-PROPOSED-J codifies the rule.

const persistOptions: PersistOptions<CurrentBrandState, PersistedState> = {
  name: "mingla-business.currentBrand.v14",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({
    currentBrandId: state.currentBrandId,
  }),
  version: 14,
  migrate: (persistedState, version) => {
    // Cycle 2 / ORCH-0742 v13 → v14 — drops `currentBrand: Brand | null`
    // server snapshot. Extracts only the ID. Server data refreshes on next
    // mount via React Query useBrand(currentBrandId).
    if (version < 14) {
      const old = persistedState as Partial<{
        currentBrand: { id?: string } | null;
        currentBrandId: string | null;
      }> | null;
      const id =
        old?.currentBrandId !== undefined
          ? old.currentBrandId
          : (old?.currentBrand?.id ?? null);
      return { currentBrandId: id ?? null };
    }
    return persistedState as PersistedState;
  },
};

export const useCurrentBrandStore = create<CurrentBrandState>()(
  persist(
    (set) => ({
      currentBrandId: null,
      // Option A — preserved API. Internally extracts the ID; full Brand
      // objects no longer live in persisted state.
      setCurrentBrand: (brand) => set({ currentBrandId: brand?.id ?? null }),
      setCurrentBrandId: (id) => set({ currentBrandId: id }),
      reset: () => set({ currentBrandId: null }),
    }),
    persistOptions,
  ),
);

/**
 * useCurrentBrandId — direct ID selector (no React Query roundtrip). Use when
 * the consumer only needs the active brand's identifier (permission gating,
 * conditional rendering by ID, equality checks against another brand).
 *
 * For the live Brand record, import `useCurrentBrand` directly from
 * `src/hooks/useCurrentBrand` (wraps useBrand(currentBrandId)). The
 * re-export from this file was dropped in ORCH-0743 to break the
 * currentBrandStore ↔ useCurrentBrand require cycle.
 *
 * Cycle 2 / ORCH-0742; re-export dropped in ORCH-0743.
 */
export const useCurrentBrandId = (): string | null =>
  useCurrentBrandStore((s) => s.currentBrandId);

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

// Cycle 2 / ORCH-0743 — `useCurrentBrand` re-export DROPPED to break the
// `currentBrandStore.ts ↔ useCurrentBrand.ts` require cycle introduced by
// ORCH-0742. Consumers now import directly from `src/hooks/useCurrentBrand`.
// Type ownership lives in `src/types/brand.ts` (re-exported above for
// backwards-compat). See SPEC_ORCH_0743 §3.4.
