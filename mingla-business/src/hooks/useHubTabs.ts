import { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  useBrandOfferingCounts,
  type BrandOfferingCounts,
} from "./useBrandOfferingCounts";

export type HubTabName = "getstarted" | "events" | "trips" | "experiences";

export interface HubVisibleTabsResult {
  data: HubTabName[] | undefined;
  counts: BrandOfferingCounts | undefined;
  isLoading: boolean;
}

export const HUB_LAST_TAB_STORAGE_KEY = "@mingla/hub/lastTab";

export const deriveHubVisibleTabs = (
  counts: BrandOfferingCounts,
): HubTabName[] => {
  const visible: HubTabName[] = [];
  if (counts.events > 0) visible.push("events");
  if (counts.trips > 0) visible.push("trips");
  if (counts.experiences > 0) visible.push("experiences");
  return visible.length === 0 ? ["getstarted"] : visible;
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
    storedTab === "experiences"
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

export function useHubVisibleTabs(brandId: string | null): HubVisibleTabsResult {
  const countsQuery = useBrandOfferingCounts(brandId);
  const data = useMemo<HubTabName[] | undefined>(() => {
    if (countsQuery.data === undefined) return undefined;
    return deriveHubVisibleTabs(countsQuery.data);
  }, [countsQuery.data]);

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
