/**
 * The tabs a venue page can show. #4490 widens the closed three-tab union so a
 * venue's FEATURES (not its category) decide the tabs. `reservations` keeps its
 * key (and so `?tab=reservations`, the testIDs and the Sites pre-fill) for the
 * table flow; `rooms` is the stay body when a venue also sells something else.
 * `safePublicVenueTab` sends any tab missing from the page model to `overview`.
 */
export type PublicVenueTab =
  | "overview"
  | "entry"
  | "groups"
  | "hire"
  | "by_the_hour"
  | "plans"
  | "rooms"
  | "whats_on"
  | "guest_list"
  | "menu"
  | "reservations";

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
