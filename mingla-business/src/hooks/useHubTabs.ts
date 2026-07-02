import { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  useBrandOfferingCounts,
  type BrandOfferingCounts,
} from "./useBrandOfferingCounts";

export type HubTabName =
  | "getstarted"
  | "events"
  | "trips"
  | "experiences"
  | "venue";

/**
 * ORCH-1145 — venue visibility input for the conditional Hub "Venue" pill.
 *
 * META-ORCH-1255 — the LIVE gate is `venueCount > 0` (≥1 `venue_listings`
 * row, ANY claim/pipeline state). The legacy flags are kept as OPTIONAL
 * dormant arms ([TRANSITIONAL]) because the append-only ORCH-1145 adversarial
 * runtime gate executes them; in production they are permanently false —
 * `brands.has_physical_location` / `brands.place_pool_id` lost their last
 * writers (BrandEditView toggle removed; venue flows never touch brands).
 * Exit condition: pinned tests superseded via TEST-MOD-APPROVED → drop flags.
 */
export interface HubVenueVisibility {
  /** META-ORCH-1255 — the brand's venue_listings row count (any state). */
  venueCount?: number;
  /** [TRANSITIONAL] legacy pre-1255 arm — dormant in production. EXIT: delete with the pinned-fixture retirement (ORCH-1261). */
  hasPhysicalLocation?: boolean;
  /** [TRANSITIONAL] legacy pre-1255 arm — dormant in production. EXIT: delete with the pinned-fixture retirement (ORCH-1261). */
  hasPlacePool?: boolean;
}

export interface HubVisibleTabsResult {
  data: HubTabName[] | undefined;
  counts: BrandOfferingCounts | undefined;
  isLoading: boolean;
}

export const HUB_LAST_TAB_STORAGE_KEY = "@mingla/hub/lastTab";

// ORCH-1154 A.5.2 — the draft counts are read defensively (`?? 0`) so the gate
// also accepts a legacy/published-only shape (an old-RPC response during
// rollout, or a published-only test fixture). `BrandOfferingCounts` itself
// keeps the *_draft fields REQUIRED for the fetcher contract; only this gate's
// parameter relaxes them to optional so callers passing the published-only
// triple still type-check (degrades to today's behavior, never throws).
type HubVisibleTabsCounts = Pick<
  BrandOfferingCounts,
  "events" | "trips" | "experiences"
> &
  Partial<
    Pick<BrandOfferingCounts, "events_draft" | "trips_draft" | "experiences_draft">
  >;

export const deriveHubVisibleTabs = (
  counts: HubVisibleTabsCounts,
  venue: HubVenueVisibility = { venueCount: 0 },
): HubTabName[] => {
  // ORCH-1038: no "Get started" fallback pill — when the brand has no offerings,
  // the shared to-do toggle (above the pills) carries the "Create your first
  // offering" action instead. Hub then lands on its canonical /hub/events route
  // (hub/index redirect) showing that sub-route's own empty state.
  const visible: HubTabName[] = [];
  // ORCH-1154 A.5.2 — a Hub offering tab is visible when the brand has ANY
  // non-deleted row of that type, DRAFT or published (OR, not AND). This makes
  // the snap→auto-draft→navigate destination reachable: a draft-only brand's
  // Experiences tab now EXISTS in visibleTabs, so the ORCH-1145 nav-lock
  // redirect (_layout.tsx) short-circuits and the drafts render instead of
  // bouncing to /hub/events. Defensive `?? 0` keeps an old-RPC response
  // (no *_draft fields during rollout) crash-safe — degrades to published-only.
  if (counts.events > 0 || (counts.events_draft ?? 0) > 0) visible.push("events");
  if (counts.trips > 0 || (counts.trips_draft ?? 0) > 0) visible.push("trips");
  if (counts.experiences > 0 || (counts.experiences_draft ?? 0) > 0)
    visible.push("experiences");
  // META-ORCH-1255 — Venue pill appears when the brand has ≥1 venue_listings
  // row (ANY state, D-5); the legacy flag arms stay executable but are
  // production-dormant (no writers — see HubVenueVisibility docs). Appended
  // LAST so it sits as a rightmost peer alongside the offering pills.
  if (
    (venue.venueCount ?? 0) > 0 ||
    venue.hasPhysicalLocation === true ||
    venue.hasPlacePool === true
  ) {
    visible.push("venue");
  }
  return visible;
};

export const pickHubInitialTab = (
  storedTab: string | null,
  visibleTabs: readonly HubTabName[],
): HubTabName | null => {
  if (visibleTabs.length === 0) return null;
  if (
    storedTab === "getstarted" ||
    storedTab === "events" ||
    storedTab === "trips" ||
    storedTab === "experiences" ||
    storedTab === "venue"
  ) {
    if (visibleTabs.includes(storedTab)) return storedTab;
  }
  if (visibleTabs.includes("events")) return "events";
  return visibleTabs[0] ?? null;
};

export const persistHubLastTab = (tabName: HubTabName): void => {
  void AsyncStorage.setItem(HUB_LAST_TAB_STORAGE_KEY, tabName).catch(() => {
    // Client preference only; no user-facing error.
  });
};

export function useHubVisibleTabs(
  brandId: string | null,
  // META-ORCH-1255 — the Hub layout passes `{ venueCount }` from its
  // useVenueListings read. Defaults keep older callers/tests valid.
  venue: HubVenueVisibility = { venueCount: 0 },
): HubVisibleTabsResult {
  const countsQuery = useBrandOfferingCounts(brandId);
  const data = useMemo<HubTabName[] | undefined>(() => {
    if (countsQuery.data === undefined) return undefined;
    return deriveHubVisibleTabs(countsQuery.data, venue);
    // Depend on the primitive venue fields, not the `venue` object identity, so
    // a fresh `{ ... }` literal from the caller doesn't force a re-derive each
    // render. The Hub layout memoizes the object on these same primitives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    countsQuery.data,
    venue.venueCount,
    venue.hasPhysicalLocation,
    venue.hasPlacePool,
  ]);

  return {
    data,
    counts: countsQuery.data,
    isLoading: countsQuery.isLoading,
  };
}

export function useHubInitialTab(
  brandId: string | null,
  visibleTabs: HubTabName[],
): HubTabName | null {
  const [storedTab, setStoredTab] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    setLoaded(false);
    AsyncStorage.getItem(HUB_LAST_TAB_STORAGE_KEY)
      .then((value) => {
        if (!mounted) return;
        setStoredTab(value);
      })
      .catch(() => {
        if (!mounted) return;
        setStoredTab(null);
      })
      .finally(() => {
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, [brandId]);

  if (visibleTabs.length === 0 || !loaded) return null;
  return pickHubInitialTab(storedTab, visibleTabs);
}
