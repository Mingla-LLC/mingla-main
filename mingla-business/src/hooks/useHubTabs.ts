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
 * Mirrors the retired brand-page `showVenueListing` gate
 * (BrandProfileView's `hasPhysicalLocation === true || placePoolId != null`).
 */
export interface HubVenueVisibility {
  hasPhysicalLocation: boolean;
  hasPlacePool: boolean;
}

export interface HubVisibleTabsResult {
  data: HubTabName[] | undefined;
  counts: BrandOfferingCounts | undefined;
  isLoading: boolean;
}

export const HUB_LAST_TAB_STORAGE_KEY = "@mingla/hub/lastTab";

// ORCH-1150 A.5.2 — the draft counts are read defensively (`?? 0`) so the gate
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
  venue: HubVenueVisibility = { hasPhysicalLocation: false, hasPlacePool: false },
): HubTabName[] => {
  // ORCH-1038: no "Get started" fallback pill — when the brand has no offerings,
  // the shared to-do toggle (above the pills) carries the "Create your first
  // offering" action instead. Hub then lands on its canonical /hub/events route
  // (hub/index redirect) showing that sub-route's own empty state.
  const visible: HubTabName[] = [];
  // ORCH-1150 A.5.2 — a Hub offering tab is visible when the brand has ANY
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
  // ORCH-1145 — Venue pill is conditional on hasPhysicalLocation || placePoolId
  // (mirrors the retired brand-page gate). Purely-online brands never see it.
  // Appended LAST so it sits as a rightmost peer alongside the offering pills.
  if (venue.hasPhysicalLocation || venue.hasPlacePool) visible.push("venue");
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
  // ORCH-1145 — the Hub layout already resolves `currentBrand` via
  // useCurrentBrand(); it passes the venue flags in here so we never run a
  // second brand fetch. Defaults keep older callers/tests (counts-only) valid.
  venue: HubVenueVisibility = { hasPhysicalLocation: false, hasPlacePool: false },
): HubVisibleTabsResult {
  const countsQuery = useBrandOfferingCounts(brandId);
  const data = useMemo<HubTabName[] | undefined>(() => {
    if (countsQuery.data === undefined) return undefined;
    return deriveHubVisibleTabs(countsQuery.data, venue);
    // Depend on the primitive venue flags, not the `venue` object identity, so a
    // fresh `{ ... }` literal from the caller doesn't force a re-derive each
    // render. The Hub layout memoizes the object on these same primitives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countsQuery.data, venue.hasPhysicalLocation, venue.hasPlacePool]);

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
