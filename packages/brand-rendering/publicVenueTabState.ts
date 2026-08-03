export type PublicVenueTab = "overview" | "menu" | "reservations";

export interface InitialVenueTabTransition {
  activeTab: PublicVenueTab;
  lastInitialTab: PublicVenueTab;
  shouldEmit: boolean;
}

export function reconcileInitialVenueTab(
  activeTab: PublicVenueTab,
  lastInitialTab: PublicVenueTab | null,
  safeInitialTab: PublicVenueTab,
): InitialVenueTabTransition {
  if (lastInitialTab === safeInitialTab) {
    return {
      activeTab,
      lastInitialTab,
      shouldEmit: false,
    };
  }
  return {
    activeTab: safeInitialTab,
    lastInitialTab: safeInitialTab,
    shouldEmit: true,
  };
}
